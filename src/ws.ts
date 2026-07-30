import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { websocket } from "elysia/websocket";
import type { ElysiaWSLike } from "elysia/ws";
import { db } from ".";
import { tokens } from "./db/schema";

//ユーザーごとのWSインスタンス管理 ( Map <UserId, WSインスタンス>)
// Elysia 2.0でwsハンドラの引数型がElysiaWSLikeに変更されたため型更新
// biome-ignore lint/suspicious/noExplicitAny: 全WSインスタンスを受け付けるためany
export const userWSInstance = new Map<string, ElysiaWSLike<any, any>[]>();

/**
 * WebSocket用 ハンドラ
 */
export const wsHandler = new Elysia().use(websocket()).ws("/ws", {
  body: t.Object({
    signal: t.String({ minLength: 1 }),
    data: t.String({ minLength: 1 }),
  }),
  query: t.Object({
    token: t.Optional(t.String({ minLength: 1 })),
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
    // Elysia 2.0でcontextがwsへ直下にインライン化されたためws.cookie/ws.queryを参照
    const tokenFromCookie = ws.cookie?.token?.value || ws.query?.token;
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
        columns: {},
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
    //userWSInstance.set(user.id, ws);
    WSaddUserInstance(user.id, ws);
    //ユーザー接続通知
    ws.publish(
      "GLOBAL",
      JSON.stringify({
        signal: "user::Connected",
        data: user.id,
      }),
    );

    //console.log("index :: 新しいWS接続");
  },

  async close(ws) {
    //console.log("ws :: WS切断");

    // Elysia 2.0でcontextがwsへ直下にインライン化されたためws.cookie/ws.queryを参照
    const token = ws.cookie?.token?.value || ws.query?.token;
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
    WSremoveUserInstance(userToken.userId, ws);

    if (!userWSInstance.has(userToken.userId)) {
      //ユーザー接続通知
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

/**
 * WSインスタンスマップにユーザーのインスタンスを新しく追加
 * @param userId
 * @param ws
 * @returns
 */
// Elysia 2.0でのWSオブジェクト型受容
// biome-ignore lint/suspicious/noExplicitAny: どのwsインスタンスでも受け付けるためにany
function WSaddUserInstance(userId: string, ws: ElysiaWSLike<any, any>) {
  const currentInstance = userWSInstance.get(userId);
  //存在しない場合普通にset
  if (!currentInstance) {
    userWSInstance.set(userId, [ws]);
    return;
  }
  userWSInstance.set(userId, [...currentInstance, ws]);
}

/**
 * WSインスタンスマップからユーザーのインスタンスを削除
 * @param userId
 * @param ws
 * @returns
 */
// Elysia 2.0でのWSオブジェクト型受容
// biome-ignore lint/suspicious/noExplicitAny: どのwsインスタンスでも受け付けるためにany
function WSremoveUserInstance(userId: string, ws: ElysiaWSLike<any, any>) {
  const currentInstance = userWSInstance.get(userId);
  //存在しない場合スルー
  if (!currentInstance) {
    return;
  }

  //インスタンス自体の同一性で削除対象を特定する(クエリトークン接続時はcookieが無くクラッシュするため)
  const indexToRemove = currentInstance.indexOf(ws);
  if (indexToRemove !== -1) {
    currentInstance.splice(indexToRemove, 1);
  }

  //もしインスタンスが0になったら削除
  if (userWSInstance.get(userId)?.length === 0) {
    userWSInstance.delete(userId);
  }
}

/**
 * 指定のユーザーIdのWSインスタンスすべてに対し指定のWSチャンネルから登録させる
 * @param userId
 * @param wsChannel
 * @returns
 */
export function WSSubscribe(userId: string, wsChannel: `${string}::${string}`) {
  const currentInstance = userWSInstance.get(userId);
  //存在しない場合スルー
  if (!currentInstance) {
    return;
  }
  for (const ws of currentInstance) {
    ws.subscribe(wsChannel);
  }
}

/**
 * 指定のユーザーIdのWSインスタンスすべてに対し指定のWSチャンネルから登録解除させる
 * @param userId
 * @param wsChannel
 * @returns
 */
export function WSUnsubscribe(
  userId: string,
  wsChannel: `${string}::${string}`,
) {
  const currentInstance = userWSInstance.get(userId);
  //存在しない場合スルー
  if (!currentInstance) {
    return;
  }
  for (const ws of currentInstance) {
    ws.unsubscribe(wsChannel);
  }
}
