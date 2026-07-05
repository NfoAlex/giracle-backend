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
 * デバイスに紐付いた鍵情報。プラットフォームごとにスキーマが違うので JSON 文字列で保持。
 * - web  : { p256dh: string, auth: string }
 * - android/ios : (将来) FCM/APNs では追加鍵不要のため空
 */
export type WebPushKeys = {
  p256dh: string;
  auth: string;
};

export type SendResult = {
  ok: boolean;
  /** true の場合、このデバイストークンは無効なので DB から削除すべき */
  invalidateToken: boolean;
};

export interface PushProvider {
  send(
    token: string,
    keys: string | null,
    payload: PushPayload,
  ): Promise<SendResult>;
}
