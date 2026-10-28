//初期処理(ディレクトリ作成・Cron・シード・Web Push・ServerConfig読み込み)
import "./init";
import { cors } from "@elysiajs/cors";
import { Elysia, status } from "elysia";
import { bot } from "./components/Bot/bot.module";
import { channel } from "./components/Channel/channel.module";
import { ext } from "./components/Ext/ext.module";
import { message } from "./components/Message/message.module";
import { notification } from "./components/Notification/notification.module";
import { role } from "./components/Role/role.module";
import { server } from "./components/Server/server.module";
import { user } from "./components/User/user.module";
import { Middleware } from "./Middlewares";
import { wsHandler } from "./ws";
import { extWsHandler } from "./ws.ext";

//共通の定数
export { NAME_MAX_LENGTH } from "./Consts";
//DB設定 (Drizzle)
export { db } from "./db";
//初期処理から
export {
  ConstWebPush,
  GIRACLE_SERVER_CONFIG,
  reloadServerConfig,
} from "./init";

export const app = new Elysia({
  //16MB
  serve: { maxRequestBodySize: 16 * 1024 * 1024 },
})
  .use(
    cors({
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : false,
      credentials: true,
    }),
  )
  .onError(({ error, code }) => {
    if (code === "NOT_FOUND") return status(404, "Not Found :(");
    if (process.env.NODE_ENV !== "test") {
      console.error("index :: エラー->", error);
    }
    if (typeof code === "number") {
      return status(code, error.response || "somethin went wrong :(");
    }
    return status(500, "somethin went wrong :(");
  })
  .use(Middleware.RequestLogger)
  //Bot(/ext)はBotRateLimiterで別に制限するため、共通RateLimiterの対象外にする
  //(scopedミドルウェアは後から登録したルートにしか効かない)
  .use(extWsHandler)
  .use(ext)
  .use(
    process.env.RATE_LIMIT_ENABLED === "true"
      ? Middleware.RateLimiter
      : undefined,
  )
  .use(wsHandler)
  .use(user)
  .use(channel)
  .use(role)
  .use(message)
  .use(server)
  .use(notification)
  .use(bot)
  .listen(3000);

console.log("Server running at http://localhost:3000");
