import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import type { ServerWebSocket } from "elysia/ws/bun";
import { db } from ".";
import { botManages, channels, tokens } from "./db/schema";
import { Util } from "./Util";

export const wsHandler = new Elysia().ws("/ws", {
  body: t.Object({
    signal: t.String({ minLength: 1 }),
    data: t.String({ minLength: 1 }),
  }),
  headers: t.Optional(t.Object({
    authorization: t.Union([t.String(), t.Undefined()]),
  })),

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
    //Bot用
    if (ws.data.headers.authorization) {
      const botToken = ws.data.headers.authorization;
      const [botData] = await db.query.botManages.findMany({
        where: eq(botManages.tokenCode, botToken),
        with: {
          channelPermissions: {
            columns: { channelId: true },
          },
          user: { columns: { isBanned: true, isDeleted: true } },
        },
        limit: 1,
      });
      if (botData === undefined) {
        ws.send({
          signal: "ERROR",
          data: "Bot token not valid",
        });
        ws.close();
        return;
      }
      if (botData.approveStatus !== "APPROVED") {
        ws.send({
          signal: "ERROR",
          data: "Your bot is not approved yet",
        });
        ws.close();
        return;
      }

      if (botData.user?.isBanned || botData.user?.isDeleted) {
        ws.send({
          signal: "ERROR",
          data: "This bot is disabled",
        });
        ws.close();
        return;
      }

      ws.subscribe(`user::${botData.remoteUserId}`);
      if (botData.useAllChannel) {
        // 全透過Botは既存の全チャンネルを購読する（Bunのpub/subにワイルドカードが無いため）
        const allChannels = await db.select({ id: channels.id }).from(channels);
        for (const { id } of allChannels) {
          ws.subscribe(`channel::${id}`);
        }
      } else {
        //チャンネル用ハンドラのリンク
        for (const channelData of botData.channelPermissions) {
          ws.subscribe(`channel::${channelData.channelId}`);
        }
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

      return;
    }

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

    //console.log("index :: 新しいWS接続");
  },

  async close(ws) {
    //console.log("ws :: WS切断");
    //Bot用
    if (ws.data.headers.authorization) {
      const botToken = ws.data.headers.authorization;
      const botData = db
        .select({ remoteUserId: botManages.remoteUserId })
        .from(botManages)
        .where(eq(botManages.tokenCode, botToken))
        .get();
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

      return;
    }

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
/**
 * useAllChannel の Bot に新規チャンネルの購読を追加する（接続後に作られたチャンネルへ追従させるため）
 */
export async function WSSubscribeAllChannelBots(channelId: string) {
  const bots = await db
    .select({ remoteUserId: botManages.remoteUserId })
    .from(botManages)
    .where(eq(botManages.useAllChannel, true));

  for (const { remoteUserId } of bots) {
    for (const ws of Util.wsUserInstance.instances.get(remoteUserId) ?? []) {
      ws.subscribe(`channel::${channelId}`);
    }
  }
}
