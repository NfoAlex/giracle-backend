import { and, eq } from "drizzle-orm";
import type { WebPushKeys } from "../components/Notification/types";
import { db } from "../db";
import {
  channelMutes,
  notificationConfigs,
  notificationDevices,
} from "../db/schema";

export const NOTIFICATION_MODES = ["off", "mention", "all"] as const;
export type TNotificationMode = (typeof NOTIFICATION_MODES)[number];

export namespace QueryNotification {
  export const getSingle = (query: { requestSender: string }) => {
    return db
      .select()
      .from(notificationConfigs)
      .where(eq(notificationConfigs.userId, query.requestSender))
      .get();
  };

  export const updateConfig = async (query: {
    enabled?: boolean;
    mode?: TNotificationMode;
    requestSender: string;
  }) => {
    return db
      .insert(notificationConfigs)
      .values({
        userId: query.requestSender,
        enabled: query.enabled ?? true,
        mode: (query.mode as TNotificationMode | undefined) ?? "mention",
      })
      .onConflictDoUpdate({
        target: notificationConfigs.userId,
        set: {
          ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
          ...(query.mode !== undefined ? { mode: query.mode } : {}),
        },
      })
      .returning()
      .get();
  };

  export const insertDevice = async (query: {
    token: string;
    platform: string;
    keys?: WebPushKeys;
    deviceName?: string;
    requestSender: string;
  }) => {
    const keysJson = query.keys ? JSON.stringify(query.keys) : null;

    // 既存トークンの所有者が別人なら拒否（upsert での userId 上書きで乗っ取られるのを防ぐ）
    const existing = await db.query.notificationDevices.findFirst({
      where: eq(notificationDevices.token, query.token),
    });
    if (existing !== undefined && existing.userId !== query.requestSender) {
      throw new Error("Cannot register another user's device");
    }

    const [device] = await db
      .insert(notificationDevices)
      .values({
        token: query.token,
        platform: query.platform,
        keys: keysJson,
        deviceName: query.deviceName,
        userId: query.requestSender,
      })
      .onConflictDoUpdate({
        target: notificationDevices.token,
        set: {
          platform: query.platform,
          keys: keysJson,
          deviceName: query.deviceName,
          userId: query.requestSender,
          lastUsedAt: new Date(),
        },
      })
      .returning();

    return device;
  };

  export const removeDevice = async (query: {
    token: string;
    requestSender: string;
  }) => {
    const device = await db.query.notificationDevices.findFirst({
      where: eq(notificationDevices.token, query.token),
    });

    if (device === undefined) {
      throw new Error("Device not found");
    }
    if (device.userId !== query.requestSender) {
      throw new Error("Cannot unregister another user's device");
    }

    const [deviceRemoved] = await db
      .delete(notificationDevices)
      .where(eq(notificationDevices.token, query.token))
      .returning();

    return deviceRemoved;
  };

  export const getMutedChannels = async (query: { requestSender: string }) => {
    return await db.query.channelMutes.findMany({
      where: eq(channelMutes.userId, query.requestSender),
      columns: { channelId: true, mutedAt: true },
    });
  };

  export const insertMuteChannel = async (query: {
    channelId: string;
    requestSender: string;
  }) => {
    // 既にミュート済みなら挿入せず既存行を返す（mutedAt は保持）
    // 存在しない channelId は FK 制約で弾かれる
    const muted = await db
      .insert(channelMutes)
      .values({ userId: query.requestSender, channelId: query.channelId })
      .onConflictDoNothing({
        target: [channelMutes.userId, channelMutes.channelId],
      })
      .returning()
      .catch((e) => {
        if (e instanceof Error && e.message.includes("FOREIGN KEY")) {
          throw new Error("Channel not found");
        }
        throw e;
      });

    if (muted.length > 0) return muted[0];

    return await db.query.channelMutes.findFirst({
      where: and(
        eq(channelMutes.userId, query.requestSender),
        eq(channelMutes.channelId, query.channelId),
      ),
    });
  };

  export const removeMutedChannel = async (query: {
    channelId: string;
    requestSender: string;
  }) => {
    const [removedMutedChannel] = await db
      .delete(channelMutes)
      .where(
        and(
          eq(channelMutes.userId, query.requestSender),
          eq(channelMutes.channelId, query.channelId),
        ),
      )
      .returning();
    return removedMutedChannel;
  };
}
