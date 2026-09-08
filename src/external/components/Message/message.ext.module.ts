import { Elysia, t } from "elysia";
import { Middleware } from "../../../Middlewares";
import { ExtMiddleware } from "../../Middleware.ext";
import { ExtServiceMessage } from "./message.ext.service";

export const extMessage = new Elysia({ prefix: "/message" })
  .use(ExtMiddleware.CheckApiCode)
  .use(ExtMiddleware.CheckPermission)
  .get(
    "/:messageId",
    async ({ params: { messageId }, CheckApiCode: { id } }) => {
      const msg = await ExtServiceMessage.GetMessage(messageId, id);
      return msg;
    },
    {
      checkPermission: "canReadMessage",
      params: t.Object({
        messageId: t.String(),
      }),
      detail: {
        description: "メッセージを取得します。",
        tags: ["External", "Message"],
      },
    },
  )
  //URLpreviewだけ借りる
  .use(Middleware.UrlPreviewControl)
  .post(
    "/send",
    async ({
      body: { channelId, message, replyingMessageId },
      CheckApiCode: { id, botName, remoteUserId },
      server,
    }) => {
      const msg = await ExtServiceMessage.SendMessage(
        channelId,
        message,
        id,
        botName,
        remoteUserId,
        replyingMessageId,
        server,
      );

      server?.publish(
        `channel::${channelId}`,
        JSON.stringify({
          signal: "message::SendMessage",
          data: msg,
        }),
      );

      return msg;
    },
    {
      checkPermission: "canSendMessage",
      body: t.Object({
        channelId: t.String(),
        message: t.String(),
        replyingMessageId: t.Optional(t.String()),
      }),
      detail: {
        description: "メッセージを送信します。",
        tags: ["External", "Message"],
      },
      bindUrlPreview: true,
    },
  );
