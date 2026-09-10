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
  )
  .post(
    "/edit",
    async ({
      body: { message, targetMessageId },
      CheckApiCode: { id, remoteUserId },
      server,
    }) => {
      const msg = await ExtServiceMessage.Edit(
        targetMessageId,
        message,
        id,
        remoteUserId,
      );

      server?.publish(
        `channel::${msg.channelId}`,
        JSON.stringify({
          signal: "message::UpdateMessage",
          data: msg,
        }),
      );

      return msg;
    },
    {
      checkPermission: "canSendMessage",
      body: t.Object({
        targetMessageId: t.String(),
        message: t.String(),
      }),
      detail: {
        description: "メッセージを編集します。",
        tags: ["External", "Message"],
      },
      bindUrlPreview: true,
    },
  )
  .delete(
    "/delete",
    async ({
      body: { targetMessageId },
      CheckApiCode: { id, remoteUserId },
      server,
    }) => {
      const msg = await ExtServiceMessage.Delete(
        targetMessageId,
        id,
        remoteUserId,
      );

      //WSで通知(内部 /message/delete と同一シグナル)
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "message::MessageDeleted",
          data: {
            messageId: msg.id,
            channelId: msg.channelId,
          },
        }),
      );

      return msg;
    },
    {
      checkPermission: "canSendMessage",
      body: t.Object({
        targetMessageId: t.String(),
      }),
      detail: {
        description:
          "メッセージを削除します。(自分のBotが送信したメッセージのみ)",
        tags: ["External", "Message"],
      },
    },
  );
