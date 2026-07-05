export type NotificationPlatform = "web" | "android" | "ios";

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

/**
 * Webプッシュ購読時に受け取る鍵。DBには JSON文字列で保存する。
 */
export type WebPushKeys = {
  p256dh: string;
  auth: string;
};
