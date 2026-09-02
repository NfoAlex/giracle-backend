import { eq } from "drizzle-orm";
import Elysia, { file, status, t } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../..";
import { channelJoins, inboxes, users } from "../../db/schema";
import { Middleware } from "../../Middlewares";
import { Util } from "../../Util";
import { ServiceMessage } from "./message.service";

export const message = new Elysia({ prefix: "/message" })
  .use(Middleware.CheckToken)
  .get(
    "/:messageId",
    async ({ params: { messageId }, CheckToken: { _userId } }) => {
      const message = await ServiceMessage.Get(messageId, _userId);

      return {
        message: "Fetched message",
        data: message,
      };
    },
    {
      params: t.Object({
        messageId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "メッセージを単体で取得します",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/get-new",
    async ({ CheckToken: { _userId } }) => {
      const news = await ServiceMessage.GetNew(_userId);

      return {
        message: "Fetched news",
        data: news,
      };
    },
    {
      detail: {
        description: "チャンネルごとの新着メッセージがあるかどうかを取得します",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/read-time/get",
    async ({ CheckToken: { _userId } }) => {
      const readTime = await ServiceMessage.GetReadTime(_userId);

      return {
        message: "Fetched read time",
        data: readTime,
      };
    },
    {
      detail: {
        description: "既読時間の設定を取得します",
        tags: ["Message"],
      },
    },
  )
  .post(
    "/read-time/update",
    async ({
      CheckToken: { _userId },
      body: { channelId, readTime },
      server,
    }) => {
      const readTimeUpdated = await ServiceMessage.UpdateReadTime(
        channelId,
        readTime,
        _userId,
      );

      //WSで通知
      server?.publish(
        `user::${_userId}`,
        JSON.stringify({
          signal: "message::ReadTimeUpdated",
          data: readTimeUpdated,
        }),
      );

      return {
        message: "Updated read time",
        data: readTimeUpdated,
      };
    },
    {
      body: t.Object({
        readTime: t.Date(),
        channelId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "既読時間の設定を更新します",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/search",
    async ({
      query: {
        content,
        channelId,
        userId,
        hasUrlPreview,
        hasFileAttachment,
        loadIndex,
        sort,
      },
      CheckToken: { _userId },
    }) => {
      const messages = await ServiceMessage.Search(
        content,
        channelId,
        userId,
        hasUrlPreview,
        hasFileAttachment,
        loadIndex,
        _userId,
        sort,
      );

      return {
        message: "Searched messages",
        data: messages,
      };
    },
    {
      query: t.Object({
        content: t.Optional(t.String({ minLength: 1 })),
        channelId: t.Optional(t.String({ minLength: 1 })),
        userId: t.Optional(t.String({ minLength: 1 })),
        hasUrlPreview: t.Optional(t.Union([t.Boolean(), t.Undefined()])),
        hasFileAttachment: t.Optional(t.Union([t.Boolean(), t.Undefined()])),
        loadIndex: t.Optional(t.Number({ minimum: 1, default: 1 })),
        sort: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
      }),
      detail: {
        description: "メッセージを検索します",
        tags: ["Message"],
      },
    },
  )
  .post(
    "/file/upload",
    async ({ body: { channelId, file }, CheckToken: { _userId } }) => {
      const fileId = await ServiceMessage.UploadFile(channelId, file, _userId);

      return {
        message: "File uploaded",
        data: {
          fileId,
        },
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
        file: t.File(),
      }),
      detail: {
        description: "ファイルをアップロードします",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/file/:fileId",
    async ({ params: { fileId }, set, CheckToken: { _userId } }) => {
      const fileData = await ServiceMessage.GetFile(fileId, _userId);

      //画像のキャッシュ期間を設定
      set.headers["Cache-Control"] = "public, max-age=604800"; // 1週間
      //格納型XSS対策: インライン実行を防ぐ
      set.headers["Content-Disposition"] = "attachment";
      set.headers["X-Content-Type-Options"] = "nosniff";

      return file(
        `./STORAGE/file/${fileData.channelId}/${fileData.savedFileName}`,
      );
    },
    {
      params: t.Object({
        fileId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ファイルをアップロードします",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/url-thumbnail/:targetUrl",
    async ({ params: { targetUrl } }) => {
      const image = await ServiceMessage.GetUrlThumbnail(targetUrl);
      if (image === null) throw status(500, "Internal Server Error");

      return image;
    },
    {
      params: t.Object({
        targetUrl: t.String({ format: "uri" })
      }),
      detail: {
        description: "URLプレビュー用に圧縮されたサムネイルを取得します",
        tags: ["Message"]
      }
    }
  )
  .delete(
    "/delete",
    async ({ body: { messageId }, CheckToken: { _userId }, server }) => {
      const messageDeleted = await ServiceMessage.Delete(messageId, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "message::MessageDeleted",
          data: {
            messageId: messageDeleted.id,
            channelId: messageDeleted.channelId,
          },
        }),
      );

      return {
        message: "Message deleted",
        data: messageDeleted.id,
      };
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "メッセージを削除します",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/inbox",
    async ({ CheckToken: { _userId } }) => {
      //通知を取得する
      const inboxAll = await ServiceMessage.GetInbox(_userId);

      return {
        message: "Fetched inbox",
        data: inboxAll,
      };
    },
    {
      detail: {
        description: "通知を取得します",
        tags: ["Message"],
      },
    },
  )
  .post(
    "/inbox/read",
    async ({ body: { messageId }, CheckToken: { _userId }, server }) => {
      await ServiceMessage.ReadInbox(messageId, _userId);

      //WSで通知の既読を通知
      server?.publish(
        `user::${_userId}`,
        JSON.stringify({
          signal: "inbox::Deleted",
          data: {
            messageId,
            type: "mention",
          },
        }),
      );

      return {
        message: "Inbox read",
        data: messageId,
      };
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "通知を既読にします",
        tags: ["Message"],
      },
    },
  )
  .post(
    "/inbox/clear",
    async ({ CheckToken: { _userId }, server }) => {
      await ServiceMessage.ClearInbox(_userId);

      //WSで通知の全既読を通知
      server?.publish(
        `user::${_userId}`,
        JSON.stringify({
          signal: "inbox::Clear",
          data: null,
        }),
      );

      return {
        message: "Inbox cleared",
        data: null,
      };
    },
    {
      detail: {
        description: "通知をすべて既読したとして削除する",
        tags: ["Message"],
      },
    },
  )
  .post(
    "/emoji-reaction",
    async ({
      body: { messageId, channelId, emojiCode },
      CheckToken: { _userId },
      server,
    }) => {
      const reaction = await ServiceMessage.Reaction(
        messageId,
        channelId,
        emojiCode,
        _userId,
      );

      //WSで通知
      server?.publish(
        `channel::${channelId}`,
        JSON.stringify({
          signal: "message::AddReaction",
          data: reaction,
        }),
      );

      return {
        message: "Message reacted.",
        data: reaction,
      };
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
        channelId: t.String({ minLength: 1 }),
        emojiCode: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "絵文字リアクションをする",
        tags: ["Message"],
      },
    },
  )
  .get(
    "/who-reacted",
    async ({
      query: { messageId, emojiCode, cursor },
      CheckToken: { _userId },
    }) => {
      //リアクションしたユーザーを取得
      const messageWithReactions = await ServiceMessage.GetWhoReacted(
        messageId,
        emojiCode,
        _userId,
        cursor,
      );

      return {
        message: "Fetched reactions",
        data: messageWithReactions.MessageReaction.map((r) => r.userId),
      };
    },
    {
      query: t.Object({
        messageId: t.String({ minLength: 1 }),
        emojiCode: t.String({ minLength: 1 }),
        cursor: t.Optional(t.Number({ minimum: 1 })),
      }),
      detail: {
        description: "絵文字リアクションをしたユーザーを取得する",
        tags: ["Message"],
      },
    },
  )
  .delete(
    "/delete-emoji-reaction",
    async ({
      body: { messageId, channelId, emojiCode },
      CheckToken: { _userId },
      server,
    }) => {
      const reactionDeleted = await ServiceMessage.DeleteEmojiReaction(
        messageId,
        emojiCode,
        _userId,
      );

      //WSで通知
      server?.publish(
        `channel::${channelId}`,
        JSON.stringify({
          signal: "message::DeleteReaction",
          data: reactionDeleted,
        }),
      );

      return {
        message: "Reaction deleted",
        data: reactionDeleted,
      };
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
        channelId: t.String({ minLength: 1 }),
        emojiCode: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "自分の絵文字リアクションを削除する",
        tags: ["Message"],
      },
    },
  )

  .use(Middleware.UrlPreviewControl)

  .post(
    "/send",
    async ({
      body: { channelId, message, fileIds, replyingMessageId },
      CheckToken: { _userId },
      server,
      status,
    }) => {
      if (message.length > GIRACLE_SERVER_CONFIG.MessageMaxLength) {
        throw status(
          400,
          `Message is too long. Maximum length is ${GIRACLE_SERVER_CONFIG.MessageMaxLength}`,
        );
      }

      //メッセージの保存処理
      const { messageSaved, messageReplyingTo, mentionedUserIds } =
        await ServiceMessage.Send(
          channelId,
          message,
          fileIds,
          replyingMessageId,
          _userId,
        );

      //WSで通知
      server?.publish(
        `channel::${channelId}`,
        JSON.stringify({
          signal: "message::SendMessage",
          data: messageSaved,
        }),
      );

      //プッシュ通知用のメタ情報 (送信者名 / 本文プレビュー)
      const senderInfo = await db.query.users.findFirst({
        where: eq(users.id, _userId),
        columns: { name: true },
      });
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

        if (mentionedUserId !== _userId) {
          Util.sendPushNotification({
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

      //返信用通知
      {
        //返信メッセージがあるなら返信先の送信者に通知(自分自身には通知しない)
        const replyTargetUserId =
          replyingMessageId &&
          messageReplyingTo &&
          messageReplyingTo.userId !== _userId
            ? messageReplyingTo.userId
            : null;

        if (replyTargetUserId) {
          //チャンネル参加していることを確認
          const channelJoin = await db
            .select({ userId: channelJoins.userId })
            .from(channelJoins)
            .where(eq(channelJoins.userId, replyTargetUserId));

          if (channelJoin.length !== 0) {
            await db.insert(inboxes).values({
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
            Util.sendPushNotification({
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
        const channelMembers = await db.query.channelJoins.findMany({
          where: eq(channelJoins.channelId, channelId),
          columns: { userId: true },
        });
        const excluded = new Set<string>([_userId, ...mentionedSet]);
        if (replyTargetUserId) excluded.add(replyTargetUserId);
        for (const { userId: memberId } of channelMembers) {
          if (excluded.has(memberId)) continue;
          Util.sendPushNotification({
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

      return {
        message: "Message sent",
        data: messageSaved,
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
        message: t.String(),
        fileIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
        replyingMessageId: t.Optional(t.String()),
      }),
      detail: {
        description: "メッセージを送信します",
        tags: ["Message"],
      },
      bindUrlPreview: true,
    },
  )
  .post(
    "/edit",
    async ({
      body: { messageId, message },
      CheckToken: { _userId },
      server,
      status,
    }) => {
      if (message.length > GIRACLE_SERVER_CONFIG.MessageMaxLength) {
        throw status(
          400,
          `Message is too long. Maximum length is ${GIRACLE_SERVER_CONFIG.MessageMaxLength}`,
        );
      }

      const messageEditing = await ServiceMessage.Edit(
        messageId,
        message,
        _userId,
      );

      //WSで通知
      server?.publish(
        `channel::${messageEditing.channelId}`,
        JSON.stringify({
          signal: "message::UpdateMessage",
          data: messageEditing,
        }),
      );

      return {
        message: "Message edited",
        data: messageEditing,
      };
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
        message: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "メッセージを編集します",
        tags: ["Message"],
      },
      bindUrlPreview: true,
    },
  );
