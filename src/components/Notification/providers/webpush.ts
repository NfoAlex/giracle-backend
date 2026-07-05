import webpush from "web-push";
import type {
  PushPayload,
  PushProvider,
  SendResult,
  WebPushKeys,
} from "../types";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
} else {
  console.warn(
    "notification/providers/webpush :: VAPID keys are not set. Web push is disabled.",
  );
}

export const isWebPushReady = () => vapidReady;

export const getVapidPublicKey = () => VAPID_PUBLIC_KEY;

export const WebPushProvider: PushProvider = {
  async send(
    endpoint: string,
    keysJson: string | null,
    payload: PushPayload,
  ): Promise<SendResult> {
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
      console.error("webpush :: send error", endpoint, e);
      return { ok: false, invalidateToken: false };
    }
  },
};
