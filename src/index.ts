//ユーザーアップロード用のディレクトリ作成
import { mkdir } from "node:fs/promises";
import { cors } from "@elysiajs/cors";
import { Elysia, status } from "elysia";
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

import { db } from "./db";
import { serverConfigs } from "./db/schema";
import { externalApi } from "./external/external.module";

//グローバルに使えるGiracleサーバーの設定
export const GIRACLE_SERVER_CONFIG: typeof serverConfigs.$inferSelect =
  {} as typeof serverConfigs.$inferSelect;

export async function reloadServerConfig() {
  const [config] = await db.select().from(serverConfigs);
  if (config) Object.assign(GIRACLE_SERVER_CONFIG, config);
}

try {
  await reloadServerConfig();
} catch {
  // DB未初期化時（マイグレーション前やテストロード時）は握りつぶす
}

/////////////////////////////////////////////////////////////////

const corsOrigins = (Bun.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const app = new Elysia({
  //16MB
  serve: { maxRequestBodySize: 16 * 1024 * 1024 },
})
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
  .use(externalApi)
  .use(
    cors({
      //Bot用API(/ext)はサーバー間通信専用のためCORSヘッダを付けない。
      //corsプラグインのonRequestはアプリ全体に効く(use順では絞れない)ため、origin関数で判定する
      origin: [
        (request) =>
          !new URL(request.url).pathname.startsWith("/ext") &&
          corsOrigins.includes(request.headers.get("Origin") ?? ""),
      ],
      credentials: true,
    }),
  )
  .use(wsHandler)
  .use(user)
  .use(channel)
  .use(role)
  .use(message)
  .use(server)
  .use(notification)
  .listen(3000);

console.log("Server running at http://localhost:3000");
