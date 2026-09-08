import { and, eq, inArray } from "drizzle-orm";
import { status } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../../../";
import {
  botChannelPermissions,
  channelJoins,
  inboxes,
  type Message,
  messages,
} from "../../../db/schema";
import { Util } from "../../../Util";

export namespace ExtServiceMessage {
  export const GetMessage = async (messageId: string, botId: string) => {
    const messageData = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
    });
    //メッセージが見つからなければエラー
    if (messageData === undefined) {
      throw status(404, "Message not found");
    }
    const isChannelPermitted = db
      .select({ id: botChannelPermissions.channelId })
      .from(botChannelPermissions)
      .where(
        and(
          eq(botChannelPermissions.channelId, messageData.channelId),
          eq(botChannelPermissions.botId, botId),
        ),
      )
      .get();
    if (isChannelPermitted === undefined) {
      throw status(404, "Message not found");
    }

    return messageData;
  };

  export const SendMessage = async (
    channelId: string,
    message: string,
    botId: string,
    botName: string,
    remoteUserId: string,
    replyingMessageId?: string,
    server?: Bun.Server<unknown> | null,
  ) => {
    // メッセージが空白のみならエラー
    if ((message.match(/[ 　\n]/g) || []).length === message.length) {
      throw status(400, "Message is empty");
    }

    if (
      GIRACLE_SERVER_CONFIG.MessageMaxLength &&
      message.length > GIRACLE_SERVER_CONFIG.MessageMaxLength
    ) {
      throw status(
        400,
        `Message is too long. Maximum length is ${GIRACLE_SERVER_CONFIG.MessageMaxLength}`,
      );
    }

    // チャンネル送信権限確認
    const isChannelPermitted = db
      .select({ id: botChannelPermissions.channelId })
      .from(botChannelPermissions)
      .where(
        and(
          eq(botChannelPermissions.channelId, channelId),
          eq(botChannelPermissions.botId, botId),
        ),
      )
      .get();
    if (isChannelPermitted === undefined) {
      throw status(403, "Channel not permitted");
    }

    let messageReplyingTo: Message | undefined;
    // 返信先メッセージ確認
    if (replyingMessageId) {
      messageReplyingTo = await db.query.messages.findFirst({
        where: and(
          eq(messages.id, replyingMessageId),
          eq(messages.channelId, channelId),
        ),
      });
      if (messageReplyingTo === undefined) {
        throw status(400, "Replying message not found");
      }
    }

    const [messageSavedRow] = await db
      .insert(messages)
      .values({
        channelId,
        userId: remoteUserId,
        content: message,
        replyingMessageId: replyingMessageId ?? undefined,
        isBot: true,
      })
      .returning({ id: messages.id });

    const messageSaved = await db.query.messages.findFirst({
      where: eq(messages.id, messageSavedRow.id),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
    });
    if (messageSaved === undefined) {
      throw status(500, "Internal Server Error");
    }

    //本文を120字で切り詰める(通知body用)
    const body =
      messageSaved.content.length > 120
        ? `${messageSaved.content.slice(0, 120)}…`
        : messageSaved.content;

    //メッセージから "@<userId>" を検知(重複除去)
    const mentionedUserIds = new Set(
      message.match(/@<([\w-]+)>/g)?.map((m) => m.slice(2, -1)),
    );

    //返信先の送信者に通知(自分自身には通知しない)
    const replyTargetUserId =
      replyingMessageId &&
      messageReplyingTo &&
      messageReplyingTo.userId !== remoteUserId
        ? messageReplyingTo.userId
        : null;

    //メンション用のInbox保存、通知
    {
      //inboxに保存するデータ(reply + メンション)
      //  メンションはチャンネル参加者限定
      const existingMentionedUsers =
        mentionedUserIds.size > 0
          ? await db.query.channelJoins.findMany({
              where: and(
                inArray(channelJoins.userId, [...mentionedUserIds]),
                eq(channelJoins.channelId, channelId),
              ),
              columns: { userId: true },
            })
          : [];
      const memberIds = new Set(existingMentionedUsers.map((u) => u.userId));
      const savingInboxData = [
        ...(replyTargetUserId
          ? [
              {
                userId: replyTargetUserId,
                messageId: messageSaved.id,
                type: "reply",
              },
            ]
          : []),
        ...[...mentionedUserIds]
          .filter((id) => memberIds.has(id))
          .map((userId) => ({
            userId,
            messageId: messageSaved.id,
            type: "mention",
          })),
      ];
      if (savingInboxData.length > 0) {
        await db.insert(inboxes).values(savingInboxData);
      }

      //返信先へ WS + プッシュ通知
      if (replyTargetUserId) {
        server?.publish(
          `user::${replyTargetUserId}`,
          JSON.stringify({
            signal: "inbox::Added",
            data: { message: messageSaved, type: "reply" },
          }),
        );
        Util.sendPushNotification({
          userId: replyTargetUserId,
          channelId,
          eventType: "reply",
          payload: {
            title: `${botName} さんからの返信`,
            body,
            tag: `reply-${messageSaved.id}`,
            data: { type: "reply", messageId: messageSaved.id, channelId },
          },
        });
      }
    }

    //「全通知」モードのユーザー向け: チャンネル参加者へ配信
    //除外対象: 送信者本人 / mention 済 / reply 対象 (二重通知防止)
    //TODO :: Util.SendPushNotificationに移動
    {
      const channelMembers = await db.query.channelJoins.findMany({
        where: eq(channelJoins.channelId, channelId),
        columns: { userId: true },
      });
      const excluded = new Set<string>([remoteUserId, ...mentionedUserIds]);
      if (replyTargetUserId) excluded.add(replyTargetUserId);
      for (const { userId: memberId } of channelMembers) {
        if (excluded.has(memberId)) continue;
        Util.sendPushNotification({
          userId: memberId,
          channelId,
          eventType: "message",
          payload: {
            title: `${botName} さんからのメッセージ`,
            body,
            tag: `message-${messageSaved.id}`,
            data: { type: "message", messageId: messageSaved.id, channelId },
          },
        }).catch((e) => console.error("push all-message error", e));
      }
    }

    return messageSaved;
  };

  export const Edit = async (
    messageId: string,
    message: string,
    botId: string,
    remoteUserId: string,
  ) => {
    const spaceCount =
      (message.match(/ /g) || "").length +
      (message.match(/　/g) || "").length +
      (message.match(/\n/g) || "").length;
    if (spaceCount === message.length) throw status(400, "Message is empty");

    if (message.length > GIRACLE_SERVER_CONFIG.MessageMaxLength) {
      throw status(
        400,
        `Message is too long. Maximum length is ${GIRACLE_SERVER_CONFIG.MessageMaxLength}`,
      );
    }

    const messageEditing = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
    });
    //メッセージが無かった時エラー
    if (messageEditing === undefined) {
      throw status(404, "Message not found");
    }
    //送信者が自分と違うならエラー
    if (messageEditing.userId !== remoteUserId) {
      throw status(403, "You are not sender of this message");
    }
    //内容が同じならエラー
    if (messageEditing.content === message) {
      throw status(400, "Message is already same");
    }

    //Botのアクセス許可
    const isPermitted = db
      .select({ id: botChannelPermissions.id })
      .from(botChannelPermissions)
      .where(
        and(
          eq(botChannelPermissions.channelId, messageEditing.channelId),
          eq(botChannelPermissions.botId, botId),
        ),
      )
      .get();
    if (isPermitted === undefined) {
      throw status(403, "Channel not permitted");
    }

    //メッセージデータを更新する
    const [msgUpdated] = await db
      .update(messages)
      .set({
        content: message,
        isEdited: true,
      })
      .where(eq(messages.id, messageId))
      .returning({
        id: messages.id,
        channelId: messages.channelId,
        content: messages.content,
        isEdited: messages.isEdited,
        userId: messages.userId,
      });

    return msgUpdated;
  };
}
