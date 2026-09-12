import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { db } from ".";
import { tokens } from "./db/schema";
import { Util } from "./Util";

/**
 * 通常ユーザー用 WebSocket ハンドラ ( /ws )
 * Bot用は認証方法が異なるため src/external/ws.ext.ts ( /ext/ws ) に分離している。
 */
export const wsHandler = new Elysia().ws("/ws", {
  body: t.Object({
    signal: t.String({ minLength: 1 }),
    data: t.String({ minLength: 1 }),
  }),

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
    //トークンを取得して有効か調べる
    const tokenFromCookie = ws.data.cookie?.token?.value;
    if (!tokenFromCookie) {
      ws.send({
        signal: "ERROR",
        data: "token not valid",
      });
      ws.close();
      return;
    }

    const tokenWithUser = await db.query.tokens
      .findFirst({
        where: (tokens, { eq }) => eq(tokens.token, tokenFromCookie as string),
        columns: { expiresAt: true },
        with: {
          user: {
            with: {
              ChannelJoin: {
                columns: {
                  channelId: true,
                },
              },
            },
            columns: {
              id: true,
              isBanned: true,
            },
          },
        },
      })
      .catch((e) => {
        console.error("ws :: open : e", { e });
        throw new Error("ws :: 想定外のエラーが発生しました");
      });

    if (!tokenWithUser?.user) {
      ws.send({
        signal: "ERROR",
        data: "token not valid",
      });
      ws.close();
      return;
    }

    // トークンの期限確認（期限切れは切断する。放置するとHTTPでは無効なトークンでWS受信が永続する）
    if (Date.now().valueOf() > tokenWithUser.expiresAt.valueOf()) {
      ws.send({
        signal: "ERROR",
        data: "token is expired",
      });
      ws.close();
      return;
    }

    const user = tokenWithUser.user;

    //BANされているユーザーは接続させない
    if (user.isBanned) {
      ws.send({
        signal: "ERROR",
        data: "token not valid",
      });
      ws.close();
      return;
    }

    //ハンドラのリンク
    ws.subscribe(`user::${user.id}`);
    ws.subscribe("GLOBAL");
    //チャンネル用ハンドラのリンク
    for (const channelData of user.ChannelJoin) {
      ws.subscribe(`channel::${channelData.channelId}`);
    }

    //このユーザーWSインスタンス保存
    Util.wsUserInstance.add(user.id, ws);
    //ユーザー接続通知
    ws.publish(
      "GLOBAL",
      JSON.stringify({
        signal: "user::Connected",
        data: user.id,
      }),
    );
  },

  async close(ws) {
    //トークンを取得して有効か調べる
    const token = ws.data.cookie?.token?.value;
    if (!token) {
      return;
    }

    const userToken = await db.query.tokens.findFirst({
      where: eq(tokens.token, token as string),
    });
    if (!userToken) {
      return;
    }

    //このユーザーWSインスタンス削除
    Util.wsUserInstance.remove(userToken.userId, ws);

    if (!Util.wsUserInstance.instances.has(userToken.userId)) {
      //ユーザー切断通知
      ws.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::Disconnected",
          data: userToken.userId,
        }),
      );
    }
  },
});
