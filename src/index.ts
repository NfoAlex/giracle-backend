//ユーザーアップロード用のディレクトリ作成
import { mkdir } from "node:fs/promises";
import { cors } from "@elysiajs/cors";
import { Elysia, status } from "elysia";
import { bot } from "./components/Bot/bot.module";
import { channel } from "./components/Channel/channel.module";
import { message } from "./components/Message/message.module";
import { notification } from "./components/Notification/notification.module";
import { role } from "./components/Role/role.module";
import { server } from "./components/Server/server.module";
import { user } from "./components/User/user.module";
import { Middleware } from "./Middlewares";
import { wsHandler } from "./ws";

await mkdir("./STORAGE", { recursive: true }).catch((_) => {});
await mkdir("./STORAGE/file", { recursive: true }).catch((_) => {});
await mkdir("./STORAGE/icon", { recursive: true }).catch((_) => {});
await mkdir("./STORAGE/banner", { recursive: true }).catch((_) => {});
await mkdir("./STORAGE/custom-emoji", { recursive: true }).catch((_) => {});
await mkdir("./STORAGE/thumbnail", { recursive: true }).catch((_) => {});

//cron適用
import "./Cron";

//DB設定 (Drizzle)
export { db } from "./db";

//プッシュ通知設定
import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (e) {
    console.warn(
      "index :: VAPID setVapidDetails failed, web push disabled:",
      e,
    );
  }
} else {
  console.warn("index :: VAPID keys are not set. Web push is disabled.");
}
export const ConstWebPush = {
  isWebPushReady: vapidReady,
  getVapidPublicKey: VAPID_PUBLIC_KEY,
};

import type { serverConfigs } from "./db/schema";
import { QueryServerConfig } from "./queries/serverConfig.query";
//グローバルに使えるGiracleサーバーの設定
//ServerConfigが引けないときはスキーマ既定値で埋める(未設定で招待制チェックや文字数上限が素通りするのを防ぐ)
export const GIRACLE_SERVER_CONFIG: typeof serverConfigs.$inferSelect = {
  id: 0,
  name: "Giracle",
  introduction: "",
  RegisterAvailable: true,
  RegisterInviteOnly: true,
  RegisterAnnounceChannelId: "",
  MessageMaxLength: 3000,
  MessageMaxFileSize: 512000,
  BotEnabled: false,
};

export async function reloadServerConfig() {
  const config = await QueryServerConfig.getSingle();
  if (!config) {
    throw new Error("Server config not found");
  }
  Object.assign(GIRACLE_SERVER_CONFIG, config);
}

try {
  await reloadServerConfig();
} catch (e) {
  // 取得できない場合スキーマ既定値のまま。設定変更が効かないので通知は出す
  console.error("index :: ServerConfigの取得に失敗。既定値で起動します", e);
}

export const app = new Elysia({
  //16MB
  serve: { maxRequestBodySize: 16 * 1024 * 1024 },
})
  .use(
    cors({
      origin: Bun.env.CORS_ORIGIN
        ? Bun.env.CORS_ORIGIN.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : false,
      credentials: true,
    }),
  )
  .use(
    Bun.env.RATE_LIMIT_ENABLED === "true" ? Middleware.RateLimiter : undefined,
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
