import { Elysia, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { ServiceMessage } from "../Message/message.service";

export const bot = new Elysia({ prefix: "/ext" })
  .use(Middleware.CheckBotToken)
  .post(
    "/message/send",
    async ({
      CheckBotToken: { _remoteUserId },
      body: { channelId, message, replyingMessageId },
    }) => {
      const sentMessage = await ServiceMessage.Send(
        channelId,
        message,
        undefined,
        replyingMessageId,
        _remoteUserId,
      );

      return {
        message: "Sent message",
        data: sentMessage,
      };
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
