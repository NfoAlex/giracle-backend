import webpush from "web-push";
import { db } from "..";
import type {
  NotificationPlatform,
  PushPayload,
  WebPushKeys,
} from "../components/Notification/types";

//Web Push (VAPID) 初期化
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
      "SendPushNotification :: VAPID setVapidDetails failed, web push disabled:",
      e,
    );
  }
} else {
  console.warn(
    "SendPushNotification :: VAPID keys are not set. Web push is disabled.",
  );
}

export const isWebPushReady = (): boolean => vapidReady;
export const getVapidPublicKey = (): string => VAPID_PUBLIC_KEY;

export type NotifyEventType = "mention" | "reply" | "message";

/**
 * 単一のWeb Push端末へ送信する内部関数
 */
async function sendToWebDevice(
  endpoint: string,
  keysJson: string | null,
  payload: PushPayload,
): Promise<{ ok: boolean; invalidateToken: boolean }> {
  if (!vapidReady) return { ok: false, invalidateToken: false };
  if (!keysJson) return { ok: false, invalidateToken: true };

  let keys: WebPushKeys;
  try {
    keys = JSON.parse(keysJson) as WebPushKeys;
  } catch {
    return { ok: false, invalidateToken: true };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      JSON.stringify(payload),
    );
    return { ok: true, invalidateToken: false };
  } catch (e: unknown) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return { ok: false, invalidateToken: true };
    }
    console.error(
      "SendPushNotification :: web push send error",
      endpoint,
      e,
    );
    return { ok: false, invalidateToken: false };
  }
}

/**
 * プッシュ通知を配信する。configとミュートを見て振り分け、
 * 該当プラットフォームの端末に送信する。
 * 現状 web のみ対応。将来 android/ios を追加する時はここに分岐を足す。
 *
 * @param input.userId 通知対象のユーザーId
 * @param input.channelId 該当チャンネルId (ミュート判定に使う)
 * @param input.eventType 通知イベント種別 ("mention" | "reply" | "message")
 * @param input.payload SW へ届ける通知内容
 */
export default async function SendPushNotification(input: {
  userId: string;
  channelId: string;
  eventType: NotifyEventType;
  payload: PushPayload;
}) {
  const { userId, channelId, eventType, payload } = input;

  //ユーザー通知設定を確認
  const config = await db.notificationConfig.findUnique({
    where: { userId },
  });
  const enabled = config?.enabled ?? true;
  const mode = config?.mode ?? "mention";

  if (!enabled || mode === "off") return;

  //メンションのみモードなら message は無視
  if (mode === "mention" && eventType !== "mention" && eventType !== "reply") {
    return;
  }

  //チャンネルミュートを確認
  const muted = await db.channelMute.findUnique({
    where: { userId_channelId: { userId, channelId } },
  });
  if (muted !== null) return;

  //登録済み端末を取得
  const devices = await db.notificationDevice.findMany({
    where: { userId },
  });
  if (devices.length === 0) return;

  const invalidTokens: string[] = [];

  await Promise.all(
    devices.map(async (device) => {
      const platform = device.platform as NotificationPlatform;
      if (platform === "web") {
        const result = await sendToWebDevice(
          device.token,
          device.keys,
          payload,
        );
        if (result.invalidateToken) {
          invalidTokens.push(device.token);
        }
        return;
      }
      //未対応プラットフォーム (android/ios) は将来対応
    }),
  );

  //無効になったトークンをDBから削除
  if (invalidTokens.length > 0) {
    await db.notificationDevice.deleteMany({
      where: { token: { in: invalidTokens } },
    });
  }
}
