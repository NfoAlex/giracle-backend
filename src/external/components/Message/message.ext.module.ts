import { Elysia, t } from "elysia";
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
  );
