import Elysia, { status, t, file } from "elysia";
import { db } from "../..";
import { Middleware } from "../../Middlewares";
import SendSystemMessage from "../../Utils/SendSystemMessage";
import { ServiceUser } from "./user.service";

export const user = new Elysia({ prefix: "/user" })
  .put(
    "/sign-up",
    async ({ body: { username, password, inviteCode }, server }) => {
      const { createdUser } = await ServiceUser.SignUp(
        username,
        password,
        inviteCode,
      );

      //新規登録を通知するチャンネルId
      const serverConfigAnnounceChannelId = await db.serverConfig.findFirst({
        select: {
          RegisterAnnounceChannelId: true,
        },
      });
      //登録通知用チャンネルIdが登録されているならそこへ通知、ないなら他を探して通知
      if (
        serverConfigAnnounceChannelId !== null &&
        serverConfigAnnounceChannelId?.RegisterAnnounceChannelId !== ""
      ) {
        SendSystemMessage(
          serverConfigAnnounceChannelId.RegisterAnnounceChannelId,
          createdUser.id,
          "WELCOME",
          server,
        );
      } else {
        //通知チャンネルが無いなら...
        //最初のチャンネルを探して通知
        const firstChannel = await db.channel.findFirst({
          select: {
            id: true,
          },
        });
        if (firstChannel) {
          SendSystemMessage(firstChannel.id, createdUser.id, "WELCOME", server);
        }
        //それでも無いなら通知しない
      }

      return {
        message: "User created",
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 4 }),
        inviteCode: t.Optional(t.String({ minLength: 1 })),
      }),
      detail: {
        description: "ユーザーの新規登録",
        tags: ["User"],
      },
    },
  )
  .post(
    "/sign-in",
    async ({ body: { username, password }, cookie: { token } }) => {
      const tokenGenerated = await ServiceUser.SignIn(username, password);
      //console.log("user.module :: /sign-in :: tokenGenerated", tokenGenerated);
      //クッキーに格納
      token.value = tokenGenerated.token;
      token.sameSite = "lax";
      token.expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 15); //15日間有効

      return {
        message: `Signed in as ${username}`,
        data: {
          userId: tokenGenerated.userId,
        },
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 4 }),
      }),
      cookie: t.Cookie({ token: t.Optional(t.String()) }),
      detail: {
        description: "ユーザーのサインイン",
        tags: ["User"],
      },
    },
  )

  .use(Middleware.CheckToken)

  .get(
    "/get-online",
    async () => {
      const uniqueOnlineUserIds = await ServiceUser.GetOnline();

      return {
        message: "Fetched online user list",
        data: uniqueOnlineUserIds,
      };
    },
    {
      detail: {
        description: "オンラインユーザーを取得します",
        tags: ["User"],
      },
    },
  )
  .get(
    "/search",
    async ({ query: { username, joinedChannel, cursor }, _userId }) => {
      const users = await ServiceUser.Search(
        _userId,
        username,
        joinedChannel,
        cursor,
      );

      return {
        message: "User search result",
        data: users,
      };
    },
    {
      query: t.Object({
        username: t.Optional(t.String({ minLength: 0 })),
        joinedChannel: t.Optional(t.String()),
        cursor: t.Optional(t.Number({ default: 0 })),
      }),
      detail: {
        description: "ユーザーを検索します",
        tags: ["User"],
      },
    },
  )
  .get(
    "/icon/:userId",
    async ({ params: { userId }, set }) => {
      const userIcon = await ServiceUser.GetUserIcon(userId);
      if (userIcon) {
        set.headers["cache-control"] = "public, max-age=86400, immutable"; //キャッシュを１日有効にする
        return userIcon;
      }

      //存在しない場合はデフォルトアイコンを返す
      return file("./STORAGE/icon/default.png");
    },
    {
      params: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ユーザーのアイコン画像を取得します",
        tags: ["User"],
      },
    },
  )
  .get(
    "/banner/:userId",
    async ({ params: { userId }, set }) => {
      const userBanner = await ServiceUser.GetUserBanner(userId);
      if (userBanner) {
        set.headers["cache-control"] = "public, max-age=86400, immutable"; //キャッシュを１日有効にする
        return userBanner;
      }

      //存在しない場合はデフォルトアイコンを返す
      return status(404, "User banner not found");
    },
    {
      params: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ユーザーのバナー画像を取得します",
        tags: ["User"],
      },
    },
  )
  .post(
    "/change-icon",
    async ({ body: { icon }, _userId }) => {
      await ServiceUser.ChangeIcon(icon, _userId);

      return {
        message: "Icon changed",
      };
    },
    {
      body: t.Object({
        icon: t.File(),
      }),
      detail: {
        description: "ユーザーのアイコン画像を変更します",
        tags: ["User"],
      },
    },
  )
  .post(
    "/change-banner",
    async ({ _userId, body: { banner } }) => {
      await ServiceUser.ChangeBanner(banner, _userId);

      return {
        message: "Banner changed",
      };
    },
    {
      body: t.Object({
        banner: t.File(),
      }),
      detail: {
        description: "ユーザーのバナー画像を変更します",
        tags: ["User"],
      },
    },
  )
  .post(
    "/change-password",
    async ({ body: { currentPassword, newPassword }, _userId }) => {
      await ServiceUser.ChangePassword(currentPassword, newPassword, _userId);

      return {
        message: "Password changed",
      };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 4 }),
        newPassword: t.String({ minLength: 4 }),
      }),
      cookie: t.Cookie({ token: t.String() }),
      detail: {
        description: "パスワードの変更",
        tags: ["User"],
      },
    },
  )
  .post(
    "/profile-update",
    async ({ body: { name, selfIntroduction }, _userId, server }) => {
      const userUpdated = await ServiceUser.UpdateProfile(
        _userId,
        name,
        selfIntroduction,
      );

      //WSで全体へ通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::ProfileUpdate",
          data: userUpdated,
        }),
      );

      return {
        message: "Profile updated",
        data: userUpdated,
      };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        selfIntroduction: t.Optional(t.String()),
      }),
      detail: {
        description: "プロフィールの更新",
        tags: ["User"],
      },
    },
  )
  .get(
    "/session",
    async ({ _userId, query: { cursor }, cookie: { token } }) => {
      const sessions = await ServiceUser.GetSessions(_userId, token.value, cursor);

      return {
        message: "Fetched your sessions",
        data: sessions,
      };
    },
    {
      query: t.Object({
        cursor: t.Optional(t.Number({ default: 1 })),
      }),
      cookie: t.Cookie({
        token: t.String()
      })
    }
  )
  .post(
    "/change-session-name",
    async ({ _userId, body: { sessionId, name } }) => {
      const updatedSession = await ServiceUser.ChangeSessionName(_userId, sessionId, name);

      return {
        message: "Session name updated",
        data: updatedSession
      };
    },
    {
      body: t.Object({
        sessionId: t.Number(),
        name: t.String({ minLength: 1 })
      })
    }
  )
  .delete(
    "/session",
    async ({ body: { sessionId }, cookie: { token }, _userId }) => {
      await ServiceUser.RemoveSession(_userId, sessionId, token.value);

      return {
        message: "Session removed",
        data: {
          sessionId,
        }
      };
    },
    {
      body: t.Object({
        sessionId: t.Number({ minLength: 1 }),
      }),
      cookie: t.Cookie({
        token: t.String()
      })
    }
  )
  .get(
    "/sign-out",
    async ({ cookie: { token } }) => {
      //トークン確認
      const tokenValue = token.value;
      if (!tokenValue) {
        throw status(400, "No token provided");
      }

      //サインアウト処理
      await ServiceUser.SignOut(tokenValue);

      //クッキー削除
      token.remove();

      return {
        message: "Signed out",
      };
    },
    {
      cookie: t.Cookie({ token: t.String() }),
      detail: {
        description: "ユーザーのサインアウト",
        tags: ["User"],
      },
    },
  )
  .get(
    "/verify-token",
    ({ _userId }) => {
      //もし空ならトークンが無効
      if (_userId === "") {
        throw status(401, "Token is invalid");
      }

      //トークンが有効
      return {
        message: "Token is valid",
        data: {
          userId: _userId,
        },
      };
    },
    {
      detail: {
        description: "トークンの検証",
        tags: ["User"],
      },
      response: {
        200: t.Object({
          message: t.Literal("Token is valid"),
          data: t.Object({
            userId: t.String(),
          }),
        }),
        401: t.Literal("Token is invalid"),
      },
    },
  )
  .get(
    "/info/:id",
    async ({ params: { id } }) => {
      const user = await ServiceUser.GetUserInfo(id);

      return {
        message: "User info",
        data: user,
      };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ユーザー情報を取得します",
        tags: ["User"],
      },
    },
  )
  .get(
    "/list",
    async () => {
      const users = await ServiceUser.GetUserList();

      return {
        message: "User list",
        data: users,
      };
    },
    {
      detail: {
        description: "ユーザーの情報を一覧で取得します",
        tags: ["User"],
      },
    },
  )
  .use(Middleware.CheckRoleTerm)
  .post(
    "/ban",
    async ({ body: { userId }, server, _userId }) => {
      const userBanned = await ServiceUser.Ban(userId, _userId);

      //WSで全体へ通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::ProfileUpdate",
          data: userBanned,
        }),
      );

      return {
        message: "User banned",
        data: userId,
      };
    },
    {
      body: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ユーザーをBANします",
        tags: ["User"],
      },
      checkRoleTerm: "manageUser",
    },
  )
  .post(
    "/unban",
    async ({ body: { userId }, server, _userId }) => {
      const userUnbanned = await ServiceUser.Unban(userId, _userId);

      //WSで全体へ通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::ProfileUpdate",
          data: userUnbanned,
        }),
      );

      return {
        message: "User unbanned",
        data: userId,
      };
    },
    {
      body: t.Object({
        userId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ユーザーのBANを解除します",
        tags: ["User"],
      },
      checkRoleTerm: "manageUser",
    },
  );
