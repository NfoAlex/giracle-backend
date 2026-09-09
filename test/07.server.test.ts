import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { GIRACLE_SERVER_CONFIG } from "../src";
import { db } from "../src/db";
import {
  channelJoinOnDefaults,
  invitations,
  roleInfos,
  roleLinks,
  serverConfigs,
} from "../src/db/schema";
import { FETCH, INIT } from "./util";

// TESTUSERに管理者権限をつける
beforeAll(async () => {
  await INIT();
  await db.insert(roleInfos).values({
    id: "GOD",
    name: "Role for testing server configs",
    createdUserId: "SYSTEM",
    manageServer: true,
  });
  await db.insert(roleLinks).values({
    roleId: "GOD",
    userId: "TESTUSER",
  });
});

describe("PUT /server/create-invite", () => {
  it("正常 :: maxUsage指定", async () => {
    const res = await FETCH({
      path: "/server/create-invite",
      method: "PUT",
      body: { inviteCode: "testinvite-max2", maxUsage: 2 },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.maxUsage).toBe(2);
    expect(j.data.usedCount).toBe(0);

    const invite = await db.query.invitations.findFirst({
      where: eq(invitations.inviteCode, "testinvite-max2"),
    });
    expect(invite?.maxUsage).toBe(2);
  });

  it("正常 :: maxUsage省略時はデフォルト5", async () => {
    const res = await FETCH({
      path: "/server/create-invite",
      method: "PUT",
      body: { inviteCode: "testinvite-default" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.maxUsage).toBe(5);
  });

  it("バリデーション :: maxUsageが範囲外(-2)", async () => {
    const res = await FETCH({
      path: "/server/create-invite",
      method: "PUT",
      body: { inviteCode: "testinvite-invalid", maxUsage: -2 },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toContain("somethin went wrong :(");
  });

  it("権限無", async () => {
    const res = await FETCH({
      path: "/server/create-invite",
      method: "PUT",
      body: { inviteCode: "testinvite-noperm", maxUsage: 1 },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("POST /server/change-info", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/change-info",
      method: "POST",
      body: {
        name: "test-name",
        introduction: "test-intro",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.name).toBe("test-name");
    expect(GIRACLE_SERVER_CONFIG.name).toBe("test-name");
    expect(j.data.introduction).toBe("test-intro");
    expect(GIRACLE_SERVER_CONFIG.introduction).toBe("test-intro");
  });

  it("権限無", async () => {
    const res = await FETCH({
      path: "/server/change-info",
      method: "POST",
      body: {
        name: "test-name",
        introduction: "test-intro",
      },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("POST /server/change-config", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/change-config",
      method: "POST",
      body: {
        RegisterAvailable: true,
        RegisterInviteOnly: true,
        RegisterAnnounceChannelId: "TESTCHANNEL2",
        MessageMaxLength: 123,
        MessageMaxFileSize: 2048,
        DefaultJoinChannel: ["TESTCHANNEL1", "TESTCHANNEL2"],
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.name).toBe("test-name"); //変更無い
    expect(j.data.RegisterAvailable).toBeTrue();
    GIRACLE_SERVER_CONFIG.RegisterAvailable = true;
    expect(j.data.RegisterInviteOnly).toBeTrue();
    GIRACLE_SERVER_CONFIG.RegisterInviteOnly = true;
    expect(j.data.RegisterAnnounceChannelId).toBe("TESTCHANNEL2");
    GIRACLE_SERVER_CONFIG.RegisterAnnounceChannelId = "TESTCHANNEL2";
    expect(j.data.MessageMaxLength).toBe(123);
    GIRACLE_SERVER_CONFIG.MessageMaxLength = 123;
    expect(j.data.MessageMaxFileSize).toBe(2048);
    GIRACLE_SERVER_CONFIG.MessageMaxFileSize = 2048;

    const sc = db.select().from(serverConfigs).limit(1).get();
    expect(sc).toBeDefined();
    expect(sc?.MessageMaxFileSize).toBe(2048);
    const defaultJoinChannelFromDb = await db
      .select()
      .from(channelJoinOnDefaults);
    expect(defaultJoinChannelFromDb.length).toBe(2);
    expect(
      defaultJoinChannelFromDb.some((c) => c.channelId === "TESTCHANNEL1"),
    ).toBeTrue();
  });

  it("権限無", async () => {
    const res = await FETCH({
      path: "/server/change-config",
      method: "POST",
      body: {
        RegisterAvailable: true,
        RegisterInviteOnly: true,
        RegisterAnnounceChannelId: "TESTCHANNEL2",
        MessageMaxLength: 123,
        MessageMaxFileSize: 2048,
        DefaultJoinChannel: ["TESTCHANNEL1", "TESTCHANNEL2"],
      },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("GET /server/bot/me", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/bot/me",
      method: "GET",
    });
    const j = await res.json();
    // GetBotMeはdesc(createdAt)順(新しい順)
    expect(j.data.length).toBe(2);
    expect(j.data[0].botName).toBe("BOT_TEST_2");
    expect(j.data[1].botName).toBe("BOT_TEST_1");
  });

  it("正常 :: secondary", async () => {
    const res = await FETCH({
      path: "/server/bot/me",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.data.length).toBe(1);
    expect(j.data[0].botName).toBe("BOT_TEST_3");
  });
});

let TEST__deletingBotId = "";
describe("PUT /server/bot", () => {
  it("正常", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newBot", canFetchUserinfo: true, canManageUser: true },
    });
    const j = await res.json();
    expect(j.data.botName).toBe("newBot");
    TEST__deletingBotId = j.data.id;
  });

  it("ボット利用が許可されてないない", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newbot2", canFetchUserinfo: true, canManageUser: true },
    });
    expect(res.ok).toBe(false);
  });
});

describe("DELETE /server/bot", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "DELETE",
      body: { botId: TEST__deletingBotId },
    });
    const j = await res.json();
    expect(j.message).toBe("Bot deleted");
  });

  it("他人のBotは削除できない", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "DELETE",
      body: { botId: TEST__deletingBotId },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("GET /server/bot", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/bot/all",
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.length).toBe(3);
    expect(j.data[0].botName).toBe("BOT_TEST_3");
    expect(j.data[1].botName).toBe("BOT_TEST_2");
    expect(j.data[2].botName).toBe("BOT_TEST_1");
  });

  it("権限無し", async () => {
    const res = await FETCH({
      path: "/server/bot/all",
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBeFalse();
  });
});

describe("PATCH /server/bot/approval", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/bot/approval",
      method: "PATCH",
      body: {
        botId: "TESTBOT1",
        approvalValue: "APPROVED",
      },
    });
    const j = await res.json();
    console.log("j", j);
    expect(j.data).toBe("TESTBOT1");
  });

  it("存在しないBotデータ", async () => {
    const res = await FETCH({
      path: "/server/bot/approval",
      method: "PATCH",
      body: {
        botId: "TESTBOT999",
        approvalValue: "APPROVED",
      },
    });
    expect(res.ok).toBeFalse();
    const t = await res.text();
    expect(t).toBe("Bot not found");
  });

  it("権限無し", async () => {
    const res = await FETCH({
      path: "/server/bot/approval",
      method: "PATCH",
      body: {
        botId: "TESTBOT1",
        approvalValue: "APPROVED",
      },
      useSecondaryUser: true,
    });
    expect(res.ok).toBeFalse();
  });
});
