import { status } from "elysia";
import { db } from "../..";
import type { WebPushKeys } from "./types";

export const NOTIFICATION_MODES = ["off", "mention", "all"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

const isValidMode = (v: string): v is NotificationMode =>
  (NOTIFICATION_MODES as readonly string[]).includes(v);

export namespace ServiceNotification {
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
}
