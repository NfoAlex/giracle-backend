//ユーザーアップロード用のディレクトリ作成
import { mkdir } from "node:fs/promises";
import { cors } from "@elysiajs/cors";
import { Elysia, NotFound, status } from "elysia";
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

export const app = new Elysia()
  .use(
    cors({
      origin: Bun.env.CORS_ORIGIN,
    }),
  )
  .use(
    Bun.env.RATE_LIMIT_ENABLED === "true" ? Middleware.RateLimiter : undefined,
  )
  // Elysia 2.0仕様: onErrorはerrorへ改名されcodeプロパティが廃止されたため個別/汎用ハンドラーに分離
  .error(NotFound, () => status(404, "Not Found :("))
  .error(({ error }) => {
    process.env.NODE_ENV !== "test" &&
      console.error("index :: エラー->", error);
    if ("status" in error && typeof error.status === "number") {
      return status(
        error.status,
        (error as { response?: string }).response ||
          error.message ||
          "something went wrong :(",
      );
    }
    return status(500, `somethin went wrong :( ${error.message})`);
  })
  .use(wsHandler)
  .use(user)
  .use(channel)
  .use(role)
  .use(message)
  .use(server)
  .use(notification)
  .listen(3000);

console.log("Server running at http://localhost:3000");
