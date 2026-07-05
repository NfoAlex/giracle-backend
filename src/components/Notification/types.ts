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

/**
 * WebPush.sendToDevice の戻り値。invalidateToken=true なら Dispatch 側で
 * DB から購読を削除する。
 */
export type WebPushSendResult = {
  ok: boolean;
  invalidateToken: boolean;
};

/**
 * Middleware.WebPush の decorate 型。
 * ハンドラ引数から `webpush` を型付きで受け取れる。
 */
export type WebPushClient = {
  isReady: () => boolean;
  getPublicKey: () => string;
  sendToDevice: (
    endpoint: string,
    keysJson: string | null,
    payload: PushPayload,
  ) => Promise<WebPushSendResult>;
};
