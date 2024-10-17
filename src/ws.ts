import Elysia, { t } from "elysia";
import { PrismaClient } from "@prisma/client";
import UserHandler from "./wsHandler/user.ws";
import ChannelHandler from "./wsHandler/channel.ws";
import MessageHandler from "./wsHandler/message.ws";

/**
 * WebSocket用 ハンドラ
 */
export const wsHandler = new Elysia()
  .ws("/ws",
    {
      query: t.Object({
        token: t.String({ minLength: 1 }),
      }),

      async open(ws) {
        console.log("ws :: WS接続 :: ぱらめーた", ws.data.query.token);
        //トークンを取得して有効か調べる
        const token = ws.data.cookie.token.value || ws.data.query.token;
        if (!token) {
          console.log("ws :: WS接続 :: token not valid");
          ws.send({
            signal: "ERROR",
            data: "token not valid",
          });
          ws.close();
          return;
        }

        console.log("ws :: WS接続 :: token ->", token);

        const db = new PrismaClient();
        const user = await db.user.findFirst({
          where: {
            Token: {
              some: {
                token: token,
              },
            },
          },
          include: {
            ChannelJoin: true,
          }
        });
        if (!user) {
          console.log("ws :: WS接続 :: user not found");
          ws.send({
            signal: "ERROR",
            data: "token not valid",
          });
          ws.close();
          return
        }

        //ハンドラのリンク
        ws.subscribe(`user::${user.id}`);
        ws.subscribe("GLOBAL");
        //チャンネル用ハンドラのリンク
        for (const channelData of user.ChannelJoin) {
          ws.subscribe(`channel::${channelData.channelId}`);
        }

        console.log("index :: 新しいWS接続");
      },

      close(ws) {
        console.log("ws :: WS切断");
      },
  })
