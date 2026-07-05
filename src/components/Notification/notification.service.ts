import { status } from "elysia";
import { db } from "../..";
import type {
  NotificationPlatform,
  PushPayload,
  PushProvider,
  WebPushKeys,
} from "./types";
import {
  WebPushProvider,
  getVapidPublicKey,
  isWebPushReady,
} from "./providers/webpush";

//プラットフォームごとの Provider マッピング
//将来 FCM (android)、APNs (ios) をここに追加する
const providers: Partial<Record<NotificationPlatform, PushProvider>> = {
  web: WebPushProvider,
};

export const NOTIFICATION_MODES = ["off", "mention", "all"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

const isValidMode = (v: string): v is NotificationMode =>
  (NOTIFICATION_MODES as readonly string[]).includes(v);

export type NotifyEventType = "mention" | "reply" | "message";

export namespace ServiceNotification {
  export const GetVapidPublicKey = () => {
    if (!isWebPushReady()) {
      throw status(503, "Web push is not configured on this server");
    }
    return getVapidPublicKey();
  };

  export const GetConfig = async (_userId: string) => {
    const config = await db.notificationConfig.findUnique({
      where: { userId: _userId },
    });
    return (
      config ?? {
        userId: _userId,
        enabled: true,
        mode: "mention" as NotificationMode,
      }
    );
  };

  export const UpdateConfig = async (
    _userId: string,
    input: { enabled?: boolean; mode?: string },
  ) => {
    if (input.mode !== undefined && !isValidMode(input.mode)) {
      throw status(400, "Invalid mode");
    }
    return db.notificationConfig.upsert({
      where: { userId: _userId },
      create: {
        userId: _userId,
        enabled: input.enabled ?? true,
        mode: (input.mode as NotificationMode | undefined) ?? "mention",
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
      },
    });
  };

  export const RegisterDevice = async (input: {
    token: string;
    platform: string;
    keys?: WebPushKeys;
    deviceName?: string;
    userId: string;
  }) => {
    if (
      input.platform !== "web" &&
      input.platform !== "android" &&
      input.platform !== "ios"
    ) {
      throw status(400, "Invalid platform");
    }
    // web は keys 必須
    if (input.platform === "web" && !input.keys) {
      throw status(400, "Missing keys for web platform");
    }
    const keysJson = input.keys ? JSON.stringify(input.keys) : null;
    return db.notificationDevice.upsert({
      where: { token: input.token },
      create: {
        token: input.token,
        platform: input.platform,
        keys: keysJson,
        deviceName: input.deviceName,
        userId: input.userId,
      },
      update: {
        platform: input.platform,
        keys: keysJson,
        deviceName: input.deviceName,
        userId: input.userId,
        lastUsedAt: new Date(),
      },
    });
  };

  export const UnregisterDevice = async (token: string, _userId: string) => {
    const device = await db.notificationDevice.findUnique({
      where: { token },
    });
    if (device === null) return null;
    if (device.userId !== _userId) {
      throw status(403, "Cannot unregister another user's device");
    }
    await db.notificationDevice.delete({ where: { token } });
    return token;
  };

  export const GetMutedChannels = async (_userId: string) => {
    const rows = await db.channelMute.findMany({
      where: { userId: _userId },
      select: { channelId: true, mutedAt: true },
    });
    return rows;
  };

  export const MuteChannel = async (channelId: string, _userId: string) => {
    // チャンネル存在確認
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (channel === null) throw status(404, "Channel not found");
    return db.channelMute.upsert({
      where: { userId_channelId: { userId: _userId, channelId } },
      create: { userId: _userId, channelId },
      update: {},
    });
  };

  export const UnmuteChannel = async (channelId: string, _userId: string) => {
    await db.channelMute
      .delete({
        where: { userId_channelId: { userId: _userId, channelId } },
      })
      .catch(() => null);
    return channelId;
  };

  /**
   * 通知を配信する。configとミュート、eventTypeを見て振り分ける。
   */
  export const Dispatch = async (input: {
    userId: string;
    channelId: string;
    eventType: NotifyEventType;
    payload: PushPayload;
  }) => {
    const { userId, channelId, eventType, payload } = input;

    // 設定取得
    const config = await GetConfig(userId);
    if (!config.enabled || config.mode === "off") return;

    // メンションのみモードなら message は無視
    if (
      config.mode === "mention" &&
      eventType !== "mention" &&
      eventType !== "reply"
    ) {
      return;
    }

    // チャンネルミュートチェック
    const muted = await db.channelMute.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    if (muted !== null) return;

    // デバイス取得
    const devices = await db.notificationDevice.findMany({
      where: { userId },
    });
    if (devices.length === 0) return;

    const invalidTokens: string[] = [];

    await Promise.all(
      devices.map(async (device) => {
        const provider = providers[device.platform as NotificationPlatform];
        if (!provider) return;
        const result = await provider.send(device.token, device.keys, payload);
        if (result.invalidateToken) {
          invalidTokens.push(device.token);
        }
      }),
    );

    if (invalidTokens.length > 0) {
      await db.notificationDevice.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }
  };
}
