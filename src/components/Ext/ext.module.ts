import { Elysia, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { Util } from "../../Util";
import { ServiceMessage } from "../Message/message.service";
import { ServiceUser } from "../User/user.service";

export const ext = new Elysia({ prefix: "/ext" })
  .use(Middleware.CheckBotToken)
  .post(
    "/message/send",
    async ({
      CheckBotToken: { _remoteUserId },
      body: { channelId, message, replyingMessageId },
      server,
    }) => {
      const { messageSaved, messageReplyingTo } = await ServiceMessage.Send(
        channelId,
        message,
        undefined,
        replyingMessageId,
        _remoteUserId,
      );

      //WS通知、Botには通知しない
      server?.publish(
        `channel::${channelId}`,
        JSON.stringify({
          signal: "message::SendMessage",
          data: messageSaved,
        }),
      );

      //メッセージ本文をもとに相手Inboxへ追加
      const mentionedUserIds = await ServiceMessage.addToInbox(
        messageSaved.id,
        messageSaved.content,
        messageSaved.channelId,
      );

      //メッセージ送信に伴う通知(メンション / 返信 / 全通知)
      await Util.sendMessageNotifications({
        channelId,
        messageSaved,
        mentionedUserIds,
        messageReplyingTo,
        senderId: _remoteUserId,
        server,
      });

      return messageSaved;
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
        message: t.String(),
        replyingMessageId: t.Optional(t.String()),
      }),
      detail: {
        description: "Botとしてメッセージを送信します",
        tags: ["Bot", "Message"],
      },
      bindUrlPreview: true,
    },
  )
  .post(
    "/message/edit",
    async ({
      CheckBotToken: { _remoteUserId },
      body: { messageId, message },
      server,
    }) => {
      const messageEditing = await ServiceMessage.Edit(
        messageId,
        message,
        _remoteUserId,
      );

      //WS通知、Botには通知しない
      server?.publish(
        `channel::${messageEditing.channelId}`,
        JSON.stringify({
          signal: "message::UpdateMessage",
          data: messageEditing,
        }),
      );

      return messageEditing;
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
        message: t.String(),
      }),
      detail: {
        description: "Botとしてメッセージを編集します",
        tags: ["Bot", "Message"],
      },
      bindUrlPreview: true,
    },
  )
  .delete(
    "/message/delete",
    async ({
      body: { messageId },
      CheckBotToken: { _remoteUserId },
      server,
    }) => {
      const messageDeleted = await ServiceMessage.Delete(
        messageId,
        _remoteUserId,
      );

      //WSで通知、Botには通知しない
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

      return messageDeleted;
    },
    {
      body: t.Object({
        messageId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "Botとして自分のメッセージを削除する",
        tags: ["Bot", "Message"],
      },
    },
  )
  .get(
    "/user/:userId",
    async ({ params: { userId }, CheckBotToken: { _remoteUserId } }) => {
      const user = await ServiceUser.GetUserInfo(_remoteUserId, userId);

      return user;
    },
    {
      params: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
    },
  );
