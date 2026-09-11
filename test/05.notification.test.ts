import { beforeAll, describe, expect, it, mock } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src";
import {
  channelMutes,
  notificationConfigs,
  notificationDevices,
} from "../src/db/schema";
import { Util } from "../src/Util";
import { FETCH, INIT } from "./util";

// web-push の sendNotification をモック化: 実際のFCMは叩かない
// setVapidDetails は .env.test の実VAPIDキーで通るのでモック不要
const sendNotificationMock = mock(async () => undefined);
mock.module("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: sendNotificationMock,
  },
}));

beforeAll(async () => {
  await INIT();
});

//
// /notification/config
//
describe("/notification/config", () => {
  it("GET :: 未設定なら既定値", async () => {
    const res = await FETCH({ path: "/notification/config", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.enabled).toBe(true);
    expect(j.data.mode).toBe("mention");
  });

  it("POST :: モード・enabled変更", async () => {
    const res = await FETCH({
      path: "/notification/config",
      method: "POST",
      body: { mode: "all", enabled: false },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.mode).toBe("all");
    expect(j.data.enabled).toBe(false);

    // GETに反映される
    const resGet = await FETCH({ path: "/notification/config", method: "GET" });
    const jGet = await resGet.json();
    expect(jGet.data.enabled).toBe(false);
    expect(jGet.data.mode).toBe("all");
  });

  it("POST :: 不正な mode はバリデーションエラー", async () => {
    const res = await FETCH({
      path: "/notification/config",
      method: "POST",
      body: { mode: "unknown" },
    });
    expect(res.ok).toBe(false);
  });
});

//
// /notification/device/register /unregister
//
describe("/notification/device", () => {
  const webToken = "https://fcm.googleapis.com/fcm/test-web-endpoint-1";
  const androidToken = "test-fcm-android-token-1";

  it("register :: バリデーションエラー (web keys無し・未対応platform)", async () => {
    const noKeys = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: webToken,
        platform: "web",
      },
    });
    expect(noKeys.ok).toBe(false);
    expect(noKeys.status).toBe(400);

    // 未対応platform
    const badPlatform = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: "unknown-token",
        platform: "windows",
      },
    });
    expect(badPlatform.ok).toBe(false);
  });

  it("register :: web + keys で登録成功", async () => {
    const res = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: webToken,
        platform: "web",
        keys: { p256dh: "test-p256dh-key", auth: "test-auth-key" },
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBeDefined();
  });

  it("register :: android は keys 無しでも登録可", async () => {
    const res = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: androidToken,
        platform: "android",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBeDefined();
  });

  it("register :: 同一 token を再登録すると upsert (id 一致)", async () => {
    const first = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: webToken,
        platform: "web",
        keys: { p256dh: "new-p256dh", auth: "new-auth" },
        deviceName: "chrome-mac",
      },
    });
    const second = await FETCH({
      path: "/notification/device/register",
      method: "POST",
      body: {
        token: webToken,
        platform: "web",
        keys: { p256dh: "new-p256dh", auth: "new-auth" },
      },
    });
    const j1 = await first.json();
    const j2 = await second.json();
    expect(j1.data.id).toBe(j2.data.id);
  });

  it("unregister :: 他人の token は 403", async () => {
    const res = await FETCH({
      path: "/notification/device/unregister",
      method: "POST",
      body: { token: webToken },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it("unregister :: 存在しない token は null 返却で成功扱い", async () => {
    const res = await FETCH({
      path: "/notification/device/unregister",
      method: "POST",
      body: { token: "definitely-not-registered" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.token).toBeNull();
  });

  it("unregister :: 自分の端末を解除", async () => {
    const res = await FETCH({
      path: "/notification/device/unregister",
      method: "POST",
      body: { token: webToken },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.token).toBe(webToken);
  });
});

//
// /notification/mute-channel / unmute-channel / muted-channels
//
describe("/notification/mute", () => {
  it("mute-channel :: 存在しないチャンネルは 404", async () => {
    const res = await FETCH({
      path: "/notification/mute-channel",
      method: "POST",
      body: { channelId: "NONEXISTENT-CHANNEL" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("mute-channel :: 正常追加", async () => {
    const res = await FETCH({
      path: "/notification/mute-channel",
      method: "POST",
      body: { channelId: "TESTCHANNEL1" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.channelId).toBe("TESTCHANNEL1");
    expect(j.data.userId).toBe("TESTUSER");
  });

  it("muted-channels :: 追加後リストに現れる", async () => {
    const res = await FETCH({
      path: "/notification/muted-channels",
      method: "GET",
    });
    const j = await res.json();
    expect(
      j.data.some((m: { channelId: string }) => m.channelId === "TESTCHANNEL1"),
    ).toBe(true);
  });

  it("unmute-channel :: 正常解除", async () => {
    const res = await FETCH({
      path: "/notification/unmute-channel",
      method: "POST",
      body: { channelId: "TESTCHANNEL1" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.channelId).toBe("TESTCHANNEL1");
  });

  it("unmute-channel :: 未mute でも 200 (冪等)", async () => {
    const res = await FETCH({
      path: "/notification/unmute-channel",
      method: "POST",
      body: { channelId: "TESTCHANNEL1" },
    });
    expect(res.ok).toBe(true);
  });
});

//
// /notification/vapid-public-key
//
describe("/notification/vapid-public-key", () => {
  it("VAPID 設定済なら 200 + キー", async () => {
    const res = await FETCH({
      path: "/notification/vapid-public-key",
      method: "GET",
      excludeCredential: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(typeof j.data.publicKey).toBe("string");
    expect(j.data.publicKey.length).toBeGreaterThan(0);
  });
});

//
// SendPushNotification (Util) の分岐ロジック検証
// web-push の sendNotification は mock されているので実ネットワークには出ない。
//
describe("SendPushNotification :: 分岐", () => {
  const testUser = "TESTUSER2";
  const testChannel = "TESTCHANNEL2";
  const testDeviceToken = "dispatch-test-token";
  const testDeviceKeys = JSON.stringify({ p256dh: "x", auth: "y" });

  const setupDevice = async () => {
    await db
      .insert(notificationDevices)
      .values({
        token: testDeviceToken,
        platform: "web",
        keys: testDeviceKeys,
        userId: testUser,
      })
      .onConflictDoUpdate({
        target: notificationDevices.token,
        set: { keys: testDeviceKeys, platform: "web", userId: testUser },
      });
  };

  it("送信スキップ :: enabled=false / mode不一致 / Mute", async () => {
    await setupDevice();
    await db
      .insert(notificationConfigs)
      .values({ userId: testUser, enabled: false, mode: "all" })
      .onConflictDoUpdate({
        target: notificationConfigs.userId,
        set: { enabled: false, mode: "all" },
      });
    sendNotificationMock.mockClear();
    await Util.sendPushNotification({
      userId: testUser,
      channelId: testChannel,
      eventType: "mention",
      payload: { title: "t", body: "b" },
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // mode=mention のとき message はスキップ
    await db
      .update(notificationConfigs)
      .set({ enabled: true, mode: "mention" })
      .where(eq(notificationConfigs.userId, testUser));
    sendNotificationMock.mockClear();
    await Util.sendPushNotification({
      userId: testUser,
      channelId: testChannel,
      eventType: "message",
      payload: { title: "t", body: "b" },
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // Mute があるとスキップ
    const existingMute = await db.query.channelMutes.findFirst({
      where: and(
        eq(channelMutes.userId, testUser),
        eq(channelMutes.channelId, testChannel),
      ),
    });
    if (existingMute === undefined) {
      await db
        .insert(channelMutes)
        .values({ userId: testUser, channelId: testChannel });
    }
    sendNotificationMock.mockClear();
    await Util.sendPushNotification({
      userId: testUser,
      channelId: testChannel,
      eventType: "mention",
      payload: { title: "t", body: "b" },
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // クリーンアップ
    await db
      .delete(channelMutes)
      .where(
        and(
          eq(channelMutes.userId, testUser),
          eq(channelMutes.channelId, testChannel),
        ),
      );
  });

  it("mode=mention + eventType=mention なら送信", async () => {
    sendNotificationMock.mockClear();
    await setupDevice();

    await Util.sendPushNotification({
      userId: testUser,
      channelId: testChannel,
      eventType: "mention",
      payload: { title: "t", body: "b" },
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("410 Gone なら DB から購読削除", async () => {
    await setupDevice();
    // 一度だけ 410 でエラーを返すよう再モック
    const goneError = Object.assign(new Error("Gone"), { statusCode: 410 });
    sendNotificationMock.mockImplementationOnce(async () => {
      throw goneError;
    });

    await Util.sendPushNotification({
      userId: testUser,
      channelId: testChannel,
      eventType: "mention",
      payload: { title: "t", body: "b" },
    });

    const remain = await db.query.notificationDevices.findFirst({
      where: eq(notificationDevices.token, testDeviceToken),
    });
    expect(remain).toBeUndefined();
  });
});
