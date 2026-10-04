import { beforeAll, describe, expect, it } from "bun:test";
import { eq, ne } from "drizzle-orm";
import { GIRACLE_SERVER_CONFIG } from "../src";
import { db, sqlite } from "../src/db";
import {
  channelJoinOnDefaults,
  invitations,
  roleInfos,
  roleLinks,
  serverConfigs,
  users,
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

describe("GET /server/get-invite", () => {
  it("正常 :: 招待一覧を返す", async () => {
    const res = await FETCH({ path: "/server/get-invite", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Server invites fetched");
    // シードのtestinviteに加え、create-inviteのテストで作った分も含む
    expect(j.data.length).toBeGreaterThanOrEqual(1);
    expect(
      j.data.some((i: { inviteCode: string }) => i.inviteCode === "testinvite"),
    ).toBeTrue();
  });

  it("権限無", async () => {
    const res = await FETCH({
      path: "/server/get-invite",
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("DELETE /server/delete-invite", () => {
  it("正常 :: 指定した招待を削除", async () => {
    const [invite] = await db
      .insert(invitations)
      .values({ inviteCode: "testinvite-delete", createdUserId: "TESTUSER" })
      .returning();

    const res = await FETCH({
      path: "/server/delete-invite",
      method: "DELETE",
      body: { inviteId: invite.id },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe(invite.id);

    const deleted = await db.query.invitations.findFirst({
      where: eq(invitations.id, invite.id),
    });
    expect(deleted).toBeUndefined();
  });

  it("権限無", async () => {
    const res = await FETCH({
      path: "/server/delete-invite",
      method: "DELETE",
      body: { inviteId: 1 },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
  });
});

describe("GET /server/config", () => {
  it("isFirstUser :: ユーザーが1人だけならtrue", async () => {
    // 他ユーザーの行だけを退避して1人にする(子テーブルを巻き込まないようFKを切る)
    const others = await db
      .select()
      .from(users)
      .where(ne(users.id, "TESTUSER"));
    sqlite.run("PRAGMA foreign_keys = OFF;");
    try {
      await db.delete(users).where(ne(users.id, "TESTUSER"));

      const res = await FETCH({ path: "/server/config", method: "GET" });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.isFirstUser).toBeTrue();
    } finally {
      if (others.length > 0) await db.insert(users).values(others);
      sqlite.run("PRAGMA foreign_keys = ON;");
    }
  });

  it("isFirstUser :: 複数ユーザーがいればfalse", async () => {
    const res = await FETCH({ path: "/server/config", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.isFirstUser).toBeFalse();
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
        RegisterInviteOnly: false,
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
    expect(GIRACLE_SERVER_CONFIG.RegisterAvailable).toBeTrue();
    expect(j.data.RegisterInviteOnly).toBeFalse();
    expect(GIRACLE_SERVER_CONFIG.RegisterInviteOnly).toBeFalse();
    expect(j.data.RegisterAnnounceChannelId).toBe("TESTCHANNEL2");
    expect(GIRACLE_SERVER_CONFIG.RegisterAnnounceChannelId).toBe(
      "TESTCHANNEL2",
    );
    expect(j.data.MessageMaxLength).toBe(123);
    expect(GIRACLE_SERVER_CONFIG.MessageMaxLength).toBe(123);
    expect(j.data.MessageMaxFileSize).toBe(2048);
    expect(GIRACLE_SERVER_CONFIG.MessageMaxFileSize).toBe(2048);

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
