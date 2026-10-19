//起動時の初期処理。index.ts の先頭で import され、副作用として実行される
import { mkdir } from "node:fs/promises";
import webpush from "web-push";
import "./Cron";
import type { serverConfigs } from "./db/schema";
import { seedIt } from "./db/seeds";
import { QueryServerConfig } from "./queries/serverConfig.query";

console.log("init :: ====== 初期処理開始 ======");

//ユーザーアップロード用のディレクトリ作成(冪等)
const STORAGE_DIRS = [
  "",
  "file",
  "icon",
  "banner",
  "custom-emoji",
  "thumbnail",
];
await Promise.all(
  STORAGE_DIRS.map((dir) =>
    mkdir(`./STORAGE/${dir}`, { recursive: true }).catch((_) => {}),
  ),
);

//起動時にシードを投入(migrate済みDBが前提)。
await seedIt();

//プッシュ通知設定
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (e) {
    console.warn("init :: VAPID setVapidDetails failed, web push disabled:", e);
  }
} else {
  console.warn("init :: VAPID keys are not set. Web push is disabled.");
}
export const ConstWebPush = {
  isWebPushReady: vapidReady,
  getVapidPublicKey: VAPID_PUBLIC_KEY,
};

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
  console.error("init :: ServerConfigの取得に失敗。既定値で起動します", e);
}

console.log("init :: ====== 終了 ======");
