import Elysia, { t } from "elysia";
import { QueryToken } from "./queries/token.query";
import { Util } from "./Util";

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

    const tokenWithUser = await QueryToken.getSingleWithUserChannels({
      token: tokenFromCookie as string,
    }).catch((e) => {
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
    //ユーザー接続通知(複数端末接続では最初の1回だけ。切断側の最終1回と揃える)
    if (Util.wsUserInstance.instances.get(user.id)?.length === 1) {
      ws.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::Connected",
          data: user.id,
        }),
      );
    }

    //console.log("index :: 新しいWS接続");
  },

  async close(ws) {
    //console.log("ws :: WS切断");

    //トークンを取得して有効か調べる
    const token = ws.data.cookie?.token?.value;
    //トークン行が消えている(サインアウト直後等)場合でも切断は記録する必要があるため
    //トークンが無い/引けないときは生WSの同一性からuserIdを引く
    const userToken =
      token !== undefined
        ? await QueryToken.getSingle({ token: token as string })
        : undefined;

    //このユーザーWSインスタンス削除
    let removedUserId: string | undefined;
    if (userToken !== undefined) {
      Util.wsUserInstance.remove(userToken.userId, ws);
      removedUserId = userToken.userId;
    } else {
      removedUserId = Util.wsUserInstance.removeByInstance(ws);
    }

    if (
      removedUserId !== undefined &&
      !Util.wsUserInstance.instances.has(removedUserId)
    ) {
      //ユーザー切断通知
      ws.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "user::Disconnected",
          data: removedUserId,
        }),
      );
    }
  },
});
