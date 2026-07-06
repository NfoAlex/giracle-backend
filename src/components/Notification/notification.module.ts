import Elysia, { status, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { NOTIFICATION_MODES, ServiceNotification } from "./notification.service";
import { ConstWebPush } from "../..";

export const notification = new Elysia({ prefix: "/notification" })
  .get(
    "/vapid-public-key",
    () => {
      if (!ConstWebPush.isWebPushReady) {
        throw status(503, "Web push is not configured on this server");
      }
      return {
        message: "Fetched VAPID public key",
        data: { publicKey: ConstWebPush.getVapidPublicKey },
      };
    },
    {
      detail: {
        description: "Web Push 用の VAPID 公開鍵を取得します",
        tags: ["Notification"],
      },
    },
  )
  .use(Middleware.CheckToken)
  .get(
    "/config",
    async ({ CheckToken: { _userId } }) => {
      const config = await ServiceNotification.GetConfig(_userId);
      return {
        message: "Fetched notification config",
        data: config,
      };
    },
    {
      detail: {
        description: "自分の通知設定を取得します",
        tags: ["Notification"],
      },
    },
  )
  .post(
    "/config",
    async ({ body, CheckToken: { _userId } }) => {
      const config = await ServiceNotification.UpdateConfig(_userId, body);
      return {
        message: "Updated notification config",
        data: config,
      };
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        mode: t.Optional(
          t.Union(NOTIFICATION_MODES.map((m) => t.Literal(m))),
        ),
      }),
      detail: {
        description: "自分の通知設定を更新します",
        tags: ["Notification"],
      },
    },
  )
  .post(
    "/device/register",
    async ({
      body: { token, platform, keys, deviceName },
      CheckToken: { _userId },
    }) => {
      const device = await ServiceNotification.RegisterDevice({
        token,
        platform,
        keys,
        deviceName,
        userId: _userId,
      });
      return {
        message: "Device registered",
        data: { id: device.id },
      };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        platform: t.Union([
          t.Literal("web"),
          t.Literal("android"),
          t.Literal("ios"),
        ]),
        keys: t.Optional(
          t.Object({
            p256dh: t.String({ minLength: 1 }),
            auth: t.String({ minLength: 1 }),
          }),
        ),
        deviceName: t.Optional(t.String()),
      }),
      detail: {
        description: "プッシュ通知の端末を登録します",
        tags: ["Notification"],
      },
    },
  )
  .post(
    "/device/unregister",
    async ({ body: { token }, CheckToken: { _userId } }) => {
      const result = await ServiceNotification.UnregisterDevice(token, _userId);
      return {
        message: "Device unregistered",
        data: { token: result },
      };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "プッシュ通知の端末を解除します",
        tags: ["Notification"],
      },
    },
  )
  .get(
    "/muted-channels",
    async ({ CheckToken: { _userId } }) => {
      const rows = await ServiceNotification.GetMutedChannels(_userId);
      return {
        message: "Fetched muted channels",
        data: rows,
      };
    },
    {
      detail: {
        description: "ミュートしているチャンネル一覧を取得します",
        tags: ["Notification"],
      },
    },
  )
  .post(
    "/mute-channel",
    async ({ body: { channelId }, CheckToken: { _userId } }) => {
      const row = await ServiceNotification.MuteChannel(channelId, _userId);
      return {
        message: "Channel muted",
        data: row,
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "チャンネルをミュートします",
        tags: ["Notification"],
      },
    },
  )
  .post(
    "/unmute-channel",
    async ({ body: { channelId }, CheckToken: { _userId } }) => {
      const result = await ServiceNotification.UnmuteChannel(
        channelId,
        _userId,
      );
      return {
        message: "Channel unmuted",
        data: { channelId: result },
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "チャンネルのミュートを解除します",
        tags: ["Notification"],
      },
    },
  );
