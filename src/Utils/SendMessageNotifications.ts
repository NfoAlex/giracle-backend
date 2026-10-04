import type { Server } from "bun";
import type { Message } from "../db/schema";
import { QueryChannelJoin } from "../queries/channelJoin.query";
import { QueryInbox } from "../queries/inbox.query";
import { QueryUser } from "../queries/user.query";
import SendPushNotification from "./SendPushNotification";

/**
 * メッセージ送信に伴う通知(メンション / 返信 / 全通知)をまとめて配信する。
 * メンション分のInbox保存は ServiceMessage.addToInbox が担うためここでは行わない。
 * @param input.channelId 対象チャンネルId
 * @param input.messageSaved 保存済みメッセージ
 * @param input.mentionedUserIds 本文から検出したメンション対象ユーザーId群
 * @param input.messageReplyingTo 返信先メッセージ(返信でなければundefined)
 * @param input.senderId 送信者のユーザーId
 * @param input.server WS通信をするためのServerインスタンス、なければWS通知をしない
 */
export default async function SendMessageNotifications(input: {
  channelId: string;
  messageSaved: Message;
  mentionedUserIds: string[];
  messageReplyingTo: Message | undefined;
  senderId: string;
  server: Server<unknown> | null;
}) {
  const {
    channelId,
    messageSaved,
    mentionedUserIds,
    messageReplyingTo,
    senderId,
    server,
  } = input;

  //プッシュ通知用のメタ情報 (送信者名 / 本文プレビュー)
  const senderInfo = await QueryUser.getSingleName({ userId: senderId });
  const senderName = senderInfo?.name ?? "誰か";
  //通知内容
  const bodyPreview =
    messageSaved.content.length > 120
      ? `${messageSaved.content.slice(0, 120)}…`
      : messageSaved.content;

  //メンションされたユーザーに通知
  const mentionedSet = new Set(mentionedUserIds);
  for (const mentionedUserId of mentionedSet) {
    //メンションされたWSで通知
    server?.publish(
      `user::${mentionedUserId}`,
      JSON.stringify({
        signal: "inbox::Added",
        data: {
          message: messageSaved,
          type: "mention",
        },
      }),
    );

    if (mentionedUserId !== senderId) {
      SendPushNotification({
        userId: mentionedUserId,
        channelId,
        eventType: "mention",
        payload: {
          title: `${senderName} さんからのメンション`,
          body: bodyPreview,
          tag: `mention-${messageSaved.id}`,
          data: {
            type: "mention",
            messageId: messageSaved.id,
            channelId,
          },
        },
      }).catch((e) => console.error("push mention error", e));
    }
  }

  //返信メッセージがあるなら返信先の送信者に通知(自分自身には通知しない)
  const replyTargetUserId =
    messageReplyingTo && messageReplyingTo.userId !== senderId
      ? messageReplyingTo.userId
      : null;

  if (replyTargetUserId) {
    //返信先の送信者がこのチャンネルに参加していることを確認(メンション通知と同じ条件)
    const channelJoin = await QueryChannelJoin.getJoin({
      channelId,
      userId: replyTargetUserId,
    });

    if (channelJoin !== undefined) {
      await QueryInbox.insertOne({
        userId: replyTargetUserId,
        messageId: messageSaved.id,
        type: "reply",
      });
      //WS通知
      server?.publish(
        `user::${replyTargetUserId}`,
        JSON.stringify({
          signal: "inbox::Added",
          data: {
            message: messageSaved,
            type: "reply",
          },
        }),
      );
      //プッシュ通知
      SendPushNotification({
        userId: replyTargetUserId,
        channelId,
        eventType: "reply",
        payload: {
          title: `${senderName} さんからの返信`,
          body: bodyPreview,
          tag: `reply-${messageSaved.id}`,
          data: {
            type: "reply",
            messageId: messageSaved.id,
            channelId,
          },
        },
      }).catch((e) => console.error("push reply error", e));
    }
  }

  //「全通知」モードのユーザー向け: チャンネル参加者へ配信
  //  除外対象: 送信者本人 / mention 済 / reply 対象 (二重通知防止)
  const channelMembers = await QueryChannelJoin.getUserIdsByChannel({
    channelId,
  });
  const excluded = new Set<string>([senderId, ...mentionedSet]);
  if (replyTargetUserId) excluded.add(replyTargetUserId);
  for (const { userId: memberId } of channelMembers) {
    if (excluded.has(memberId)) continue;
    SendPushNotification({
      userId: memberId,
      channelId,
      eventType: "message",
      payload: {
        title: `${senderName} さんからのメッセージ`,
        body: bodyPreview,
        tag: `message-${messageSaved.id}`,
        data: {
          type: "message",
          messageId: messageSaved.id,
          channelId,
        },
      },
    }).catch((e) => console.error("push all-message error", e));
  }
}
