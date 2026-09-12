import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { db } from "..";
import { botManages, channels } from "../db/schema";
import { Util } from "../Util";

/**
 * Bot用 WebSocket ハンドラ ( /ext/ws )
 * 通常ユーザー用(/ws, src/ws.ts)とは認証方法が異なる(AuthorizationヘッダのtokenCode)ため分離している。
 * Elysiaの静的ルーターは同一パスのWSルートを上書きするため、両者を1つのパスに共存させることはできない。
 * prefixは登録先の externalApi(prefix: "/ext")が付与するため、ここでは付けない。
 */
export const extWs = new Elysia().ws("/ws", {
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
  },

  async close(ws) {
    const botToken = ws.data.headers.authorization;
    if (botToken === undefined) {
      return;
    }

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
  },
});

/**
 * useAllChannel の Bot に新規チャンネルの購読を追加する（接続後に作られたチャンネルへ追従させるため）
 * @param channelId
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
