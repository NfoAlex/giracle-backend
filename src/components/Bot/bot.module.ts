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
  )
  .get(
    "/list",
    async ({
      query: { length, cursorBotId, query },
      CheckToken: { _userId },
    }) => {
      const list = await ServiceBot.GetList(
        _userId,
        length,
        cursorBotId,
        query,
      );

      return {
        message: "Bot list fetched",
        data: list,
      };
    },
    {
      query: t.Object({
        length: t.Number({ default: 30, maximum: 50, minimum: 1 }),
        cursorBotId: t.Optional(t.String({ minLength: 1 })),
        query: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      }),
      detail: {
        description:
          "自分が作成したBotの一覧を作成順で取得します。queryで名前の前方一致絞り込み、cursorBotIdで継続取得できます",
        tags: ["Bot"],
      },
    },
  )
  .post(
    "/",
    async ({
      body: { botId, name, selfIntroduction },
      CheckToken: { _userId },
      status,
    }) => {
      //名前と自己紹介どちらかは必須
      if (name === undefined && selfIntroduction === undefined) {
        throw status(400, "Name or self introduction is essential");
      }

      const user = await ServiceBot.Update(
        _userId,
        botId,
        name,
        selfIntroduction,
      );

      return {
        message: "Bot user updated",
        data: user,
      };
    },
    {
      body: t.Object({
        botId: t.String(),
        name: t.Optional(t.String({ minLength: 2, maxLength: 32 })),
        selfIntroduction: t.Optional(t.String({ maxLength: 128 })),
      }),
      detail: {
        description: "Botの更新を行います",
        tags: ["Bot"],
      },
    },
  )
  .post(
    "/change-icon",
    async ({ body: { botId, icon }, CheckToken: { _userId } }) => {
      await ServiceBot.ChangeIcon(icon, _userId, botId);

      return {
        message: "Bot icon changed",
      };
    },
    {
      body: t.Object({
        botId: t.String(),
        icon: t.File(),
      }),
      detail: {
        description: "自分のBotユーザー用アイコン画像を変更します",
        tags: ["Bot"],
      },
    },
  )
  .get(
    "/:remoteUserId",
    async ({ params: { remoteUserId } }) => {
      const bot = await ServiceBot.GetByRemoteUserId(remoteUserId);

      return {
        message: "Bot info",
        data: bot,
      };
    },
    {
      params: t.Object({
        remoteUserId: t.String({ minLength: 1 }),
      }),
      detail: {
        description:
          "リモートユーザーIdからBotの管理情報(承認状態・作成者)を取得します。tokenCodeは含みません",
        tags: ["Bot"],
      },
    },
  )
  .use(Middleware.CheckRoleTerm)
  .get(
    "/all",
    async ({ query: { length, cursorBotId, query } }) => {
      const list = await ServiceBot.GetListAll(length, cursorBotId, query);

      return {
        message: "Bot list fetched",
        data: list,
      };
    },
    {
      query: t.Object({
        length: t.Number({ default: 30, maximum: 50, minimum: 1 }),
        cursorBotId: t.Optional(t.String({ minLength: 1 })),
        query: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      }),
      detail: {
        description:
          "全Botの一覧を新しい順で取得します。queryで名前の前方一致絞り込み、cursorBotIdで継続取得できます",
        tags: ["Bot"],
      },
      checkRoleTerm: "manageServer",
    },
  );
