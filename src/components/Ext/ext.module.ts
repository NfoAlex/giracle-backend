import { Elysia, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { Util } from "../../Util";
import { ServiceMessage } from "../Message/message.service";

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
  );
