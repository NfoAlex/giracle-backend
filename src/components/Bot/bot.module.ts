import { Elysia, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { ServiceBot } from "./bot.service";

export const bot = new Elysia({ prefix: "/bot" })
  .use(Middleware.CheckToken)
  .put(
    "/",
    async ({ body: { name, introduction }, CheckToken: { _userId } }) => {
      const botCreated = await ServiceBot.PutBot(_userId, name, introduction);

      return {
        message: "Bot created",
        data: botCreated,
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 32 }),
        introduction: t.Optional(t.String({ maxLength: 128 })),
      }),
    },
  )
  .delete(
    "/",
    async ({ body: { botId }, CheckToken: { _userId } }) => {
      await ServiceBot.DeleteBot(_userId, botId);

      return {
        message: "Bot deleted",
      };
    },
    {
      body: t.Object({
        botId: t.String(),
      }),
    },
  );
