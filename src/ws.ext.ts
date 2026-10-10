import Elysia, { t } from "elysia";
import { QueryBot } from "./queries/bot.query";
import { QueryUser } from "./queries/user.query";
import { Util } from "./Util";
import GetUserViewableChannel from "./Utils/GetUserViewableChannel";

/**
 * Bot用 WebSocket ハンドラ ( /ext/ws )
 * 通常ユーザー用(/ws, src/ws.ts)とは認証方法が異なる(AuthorizationヘッダのtokenCode)ため分離している。
 * Elysiaの静的ルーターは同一パスのWSルートを上書きするため、両者を1つのパスに共存させることはできない。
 * prefixは登録先の externalApi(prefix: "/ext")が付与するため、ここでは付けない。
 */
export const extWsHandler = new Elysia().ws("/ws", {
  body: t.Object({
    signal: t.String({ minLength: 1 }),
    data: t.String({ minLength: 1 }),
  }),
  headers: t.Optional(
    t.Object({
      authorization: t.Union([t.String(), t.Undefined()]),
    }),
  ),

  message(ws, { signal }) {
    //pingを受け取ったらpongを返す
    if (signal === "ping") {
      ws.send({
        signal: "pong",
        data: "pong",
      });
      return;
    }
  },

  async open(ws) {
    const botToken = ws.data.headers.authorization;
    if (botToken === undefined) {
      ws.send({
        signal: "ERROR",
        data: "Bot token not valid",
      });
      ws.close();
      return;
    }

    const botData = await QueryBot.getBotMinimumByTokenCode({
      tokenCode: botToken,
    });
    if (botData === undefined) {
      ws.send({
        signal: "ERROR",
        data: "Bot token not valid",
      });
      ws.close();
      return;
    }
    if (botData.isApproved) {
      ws.send({
        signal: "ERROR",
        data: "Your bot is not approved yet",
      });
      ws.close();
      return;
    }

    const botCreatedUser = await QueryUser.getSingle({
      userId: botData.createdBy,
    });
    if (
      botCreatedUser?.isDeleted === undefined ||
      botCreatedUser?.isDeleted === false
    ) {
      ws.send({
        signal: "ERROR",
        data: "User not found. This is a server side issue",
      });
      ws.close();
      return;
    }

    if (botCreatedUser.isBanned || botCreatedUser.isDeleted) {
      ws.send({
        signal: "ERROR",
        data: "This bot is disabled",
      });
      ws.close();
      return;
    }

    ws.subscribe(`user::${botData.remoteUserId}`);

    //Botユーザーの閲覧可能チャンネルへサブスク
    const channelsViewable = await GetUserViewableChannel(botData.createdBy);
    for (const channel of channelsViewable) {
      ws.subscribe(`bot::channel::${channel.id}`);
    }

    //BotとしてユーザーWSインスタンス保存
    Util.wsUserInstance.add(botData.remoteUserId, ws);
    //ユーザー接続通知
    ws.publish(
      "GLOBAL",
      JSON.stringify({
        signal: "user::Connected",
        data: botData.remoteUserId,
      }),
    );
  },

  async close(ws) {
    const botToken = ws.data.headers.authorization;
    if (botToken === undefined) {
      return;
    }

    const botData = await QueryBot.getBotMinimumByTokenCode({
      tokenCode: botToken,
    });
    if (botData === undefined) {
      return;
    }

    //このbotWSインスタンス削除
    Util.wsUserInstance.remove(botData.remoteUserId, ws);

    if (!Util.wsUserInstance.instances.has(botData.remoteUserId)) {
      ws.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::Disconnected",
          data: botData.remoteUserId,
        }),
      );
    }
  },
});
