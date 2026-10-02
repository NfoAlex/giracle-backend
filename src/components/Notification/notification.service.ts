import { status } from "elysia";
import { QueryNotification } from "../../queries/notification.query";
import { Util } from "../../Util";
import type { WebPushKeys } from "./types";

export const NOTIFICATION_MODES = ["off", "mention", "all"] as const;
export type TNotificationMode = (typeof NOTIFICATION_MODES)[number];

const isValidMode = (v: string): v is TNotificationMode =>
  (NOTIFICATION_MODES as readonly string[]).includes(v);

export namespace ServiceNotification {
  export const GetConfig = async (_userId: string) => {
    const config = QueryNotification.getSingle({ requestSender: _userId });
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
    const config = QueryNotification.updateConfig({
      enabled: input.enabled,
      mode: input.mode,
      requestSender: _userId,
    });
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

    const deviceRegistered = await QueryNotification.insertDevice({
      token: input.token,
      platform: input.platform,
      keys: input.keys,
      deviceName: input.deviceName,
      requestSender: input.userId,
    }).catch((e) => {
      const E = e as Error;
      if (E.message === "Cannot register another user's device") {
        throw status(403, "Cannot register another user's device");
      }
      throw e;
    });

    return deviceRegistered;
  };

  export const UnregisterDevice = async (token: string, _userId: string) => {
    const deviceDeleted = await QueryNotification.removeDevice({
      token,
      requestSender: _userId,
    }).catch((e) => {
      const E = e as Error;
      if (E.message === "Device not found") {
        throw status(400, "Device not found");
      }
      if (E.message === "Cannot unregister another user's device") {
        throw status(403, "Cannot unregister another user's device");
      }
      throw e;
    });

    return deviceDeleted.token;
  };

  export const GetMutedChannels = async (_userId: string) => {
    const channels = QueryNotification.getMutedChannels({
      requestSender: _userId,
    });
    return channels;
  };

  export const MuteChannel = async (channelId: string, _userId: string) => {
    // 閲覧不可チャンネルは存在しないものと同じ扱い（存在列挙を防ぐ）
    const visible = await Util.checkChannelVisibility(channelId, _userId);
    if (!visible) throw status(404, "Channel not found");

    const channelMuted = await QueryNotification.insertMuteChannel({
      channelId,
      requestSender: _userId,
    }).catch((e) => {
      const E = e as Error;
      if (E.message === "Channel not found") {
        throw status(404, "Channel not found");
      }
      throw e;
    });
    return channelMuted;
  };

  export const UnmuteChannel = async (channelId: string, _userId: string) => {
    const channelUnmuted = await QueryNotification.removeMutedChannel({
      channelId,
      requestSender: _userId,
    });
    return channelUnmuted;
  };
}
