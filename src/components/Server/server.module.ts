import Elysia, { status, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { ServiceServer } from "./server.service";

export const server = new Elysia({ prefix: "/server" })
  .get(
    "/config",
    async () => {
      const { config, isFirstUser, defaultJoinChannel } =
        await ServiceServer.Config();

      return {
        message: "Server config fetched",
        data: { ...config, isFirstUser, defaultJoinChannel, id: undefined }, // idは返さない,
      };
    },
    {
      detail: {
        description: "サーバーの設定を取得します",
        tags: ["Server"],
      },
    },
  )
  .get(
    "/banner",
    async () => {
      //statusも含めこの中で行う
      await ServiceServer.Banner();
      //念の為
      return status(500, "Something went wrong");
    },
    {
      detail: {
        description: "サーバーのアイコン画像を取得します",
        tags: ["Server"],
      },
    },
  )

  .use(Middleware.CheckToken)
  .use(Middleware.CheckRoleTerm)
  .get(
    "/get-invite",
    async () => {
      const invites = await ServiceServer.GetInvite();

      return {
        message: "Server invites fetched",
        data: invites,
      };
    },
    {
      detail: {
        description: "サーバーの招待コード情報を取得します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .put(
    "/create-invite",
    async ({ body: { inviteCode }, _userId }) => {
      const newInvite = await ServiceServer.CreateInvite(inviteCode, _userId);

      return {
        message: "Server invite created",
        data: newInvite,
      };
    },
    {
      body: t.Object({
        inviteCode: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "サーバーの招待コードを作成します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .delete(
    "/delete-invite",
    async ({ body: { inviteId } }) => {
      await ServiceServer.DeleteInvite(inviteId);

      return {
        message: "Server invite deleted",
        data: {
          id: inviteId,
        },
      };
    },
    {
      body: t.Object({
        inviteId: t.Number(),
      }),
      detail: {
        description: "サーバーの招待コードを作成します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .post(
    "/change-info",
    async ({ body: { name, introduction }, server }) => {
      const serverinfo = await ServiceServer.ChangeInfo(name, introduction);

      //WSで全体へ通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "server::ConfigUpdate",
          data: { ...serverinfo, id: undefined },
        }),
      );

      return {
        message: "Server info updated",
        data: { ...serverinfo, id: undefined }, // idは返さない
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        introduction: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "サーバーの基本情報を変更します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .post(
    "/change-config",
    async ({
      body: {
        RegisterAvailable,
        RegisterInviteOnly,
        RegisterAnnounceChannelId,
        MessageMaxLength,
        MessageMaxFileSize,
        DefaultJoinChannel,
      },
      server,
    }) => {
      const serverinfo = await ServiceServer.ChangeConfig(
        RegisterAvailable,
        RegisterInviteOnly,
        RegisterAnnounceChannelId,
        MessageMaxLength,
        MessageMaxFileSize,
        DefaultJoinChannel,
      );

      //WSで全体へ通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "server::ConfigUpdate",
          data: { ...serverinfo, id: undefined }, // idは返さない
        }),
      );

      return {
        message: "Server config updated",
        data: { ...serverinfo, id: undefined }, // idは返さない
      };
    },
    {
      body: t.Object({
        RegisterAvailable: t.Optional(t.Boolean()),
        RegisterInviteOnly: t.Optional(t.Boolean()),
        RegisterAnnounceChannelId: t.Optional(t.String()),
        MessageMaxLength: t.Optional(t.Number()),
        MessageMaxFileSize: t.Optional(t.Number()),
        DefaultJoinChannel: t.Optional(t.Array(t.String())),
      }),
      detail: {
        description: "サーバーの設定を変更します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .post(
    "/change-banner",
    async ({ body: { banner } }) => {
      await ServiceServer.ChangeBanner(banner);
      return {
        message: "Server banner changed",
      };
    },
    {
      body: t.Object({
        banner: t.File(),
      }),
      detail: {
        description: "サーバーのバナー画像を変更します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  )
  .get(
    "/custom-emoji/:code",
    async ({ params: { code }, set }) => {
      //画像のキャッシュ期間を設定
      set.headers["Cache-Control"] = "public, max-age=259200"; // 3日
      //絵文字を返す
      const customEmoji = await ServiceServer.GetCustomEmoji(code);
      if (customEmoji === null) {
        throw status(404, "Custom emoji not found");
      }

      return customEmoji;
    },
    {
      params: t.Object({
        code: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "指定のカスタム絵文字を取得します",
        tags: ["Server"],
      },
    },
  )
  .get(
    "/custom-emoji",
    async () => {
      const customEmojis = await ServiceServer.GetCustomEmojis();

      return {
        message: "Custom emojis fetched",
        data: customEmojis,
      };
    },
    {
      detail: {
        description: "カスタム絵文字一覧を取得します",
        tags: ["Server"],
      },
    },
  )
  .put(
    "/custom-emoji/upload",
    async ({ body: { emoji, emojiCode }, server, _userId }) => {
      const emojiUploaded = await ServiceServer.uploadCustomEmoji(
        emoji,
        emojiCode,
        _userId,
      );

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "server::CustomEmojiUploaded",
          data: emojiUploaded,
        }),
      );

      return {
        message: "Emoji uploaded",
        data: emojiUploaded,
      };
    },
    {
      body: t.Object({
        emojiCode: t.String({ minLength: 1 }),
        emoji: t.File(),
      }),
      detail: {
        description: "カスタム絵文字を追加します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageEmoji",
    },
  )
  .delete(
    "/custom-emoji/delete",
    async ({ body: { emojiCode }, server }) => {
      const emojiDeleted = await ServiceServer.DeleteCustomEmoji(emojiCode);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "server::CustomEmojiDeleted",
          data: emojiDeleted,
        }),
      );

      return {
        message: "Emoji deleted",
        data: emojiDeleted,
      };
    },
    {
      body: t.Object({
        emojiCode: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "カスタム絵文字を削除します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageEmoji",
    },
  )
  .get(
    "/storage-usage",
    async () => {
      const totalSize = await ServiceServer.StorageUsage();

      return {
        message: "Server storage usage fetched",
        data: totalSize,
      };
    },
    {
      detail: {
        description: "サーバーのストレージ使用量を取得します",
        tags: ["Server"],
      },
      checkRoleTerm: "manageServer",
    },
  );
