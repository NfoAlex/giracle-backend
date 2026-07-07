import { and, eq } from "drizzle-orm";
import { status } from "elysia";
import { db } from "../..";
import {
  channelMutes,
  channels,
  notificationConfigs,
  notificationDevices,
} from "../../db/schema";
import type { WebPushKeys } from "./types";

export const NOTIFICATION_MODES = ["off", "mention", "all"] as const;
export type TNotificationMode = (typeof NOTIFICATION_MODES)[number];

const isValidMode = (v: string): v is TNotificationMode =>
  (NOTIFICATION_MODES as readonly string[]).includes(v);

export namespace ServiceNotification {
  export const GetConfig = async (_userId: string) => {
    const config = await db.query.notificationConfigs.findFirst({
      where: eq(notificationConfigs.userId, _userId),
    });
    return (
      config ?? {
        userId: _userId,
        enabled: true,
        mode: "mention" as TNotificationMode,
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
    const [config] = await db
      .insert(notificationConfigs)
      .values({
        userId: _userId,
        enabled: input.enabled ?? true,
        mode: (input.mode as TNotificationMode | undefined) ?? "mention",
      })
      .onConflictDoUpdate({
        target: notificationConfigs.userId,
        set: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
        },
      })
      .returning();
    return config;
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
    const [device] = await db
      .insert(notificationDevices)
      .values({
        token: input.token,
        platform: input.platform,
        keys: keysJson,
        deviceName: input.deviceName,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        target: notificationDevices.token,
        set: {
          platform: input.platform,
          keys: keysJson,
          deviceName: input.deviceName,
          userId: input.userId,
          lastUsedAt: new Date(),
        },
      })
      .returning();
    return device;
  };

  export const UnregisterDevice = async (token: string, _userId: string) => {
    const device = await db.query.notificationDevices.findFirst({
      where: eq(notificationDevices.token, token),
    });
    if (device === undefined) return null;
    if (device.userId !== _userId) {
      throw status(403, "Cannot unregister another user's device");
    }
    await db
      .delete(notificationDevices)
      .where(eq(notificationDevices.token, token));
    return token;
  };

  export const GetMutedChannels = async (_userId: string) => {
    const rows = await db.query.channelMutes.findMany({
      where: eq(channelMutes.userId, _userId),
      columns: { channelId: true, mutedAt: true },
    });
    return rows;
  };

  export const MuteChannel = async (channelId: string, _userId: string) => {
    // チャンネル存在確認
    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });
    if (channel === undefined) throw status(404, "Channel not found");

    //既にミュート済みならそのまま返す(Prismaのupsert update:{}相当)
    const existing = await db.query.channelMutes.findFirst({
      where: and(
        eq(channelMutes.userId, _userId),
        eq(channelMutes.channelId, channelId),
      ),
    });
    if (existing !== undefined) return existing;

    const [muted] = await db
      .insert(channelMutes)
      .values({ userId: _userId, channelId })
      .returning();
    return muted;
  };

  export const UnmuteChannel = async (channelId: string, _userId: string) => {
    await db
      .delete(channelMutes)
      .where(
        and(
          eq(channelMutes.userId, _userId),
          eq(channelMutes.channelId, channelId),
        ),
      )
      .catch(() => null);
    return channelId;
  };
}
