import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { GIRACLE_SERVER_CONFIG } from "../src";
import { db } from "../src/db";
import {
  botChannelPermissions,
  botManages,
  channelJoinOnDefaults,
  invitations,
  messages,
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
        BotEnabled: true,
        BotAutoApprove: false,
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
    expect(j.data.BotEnabled).toBeTrue();
    expect(GIRACLE_SERVER_CONFIG.BotEnabled).toBeTrue();
    expect(j.data.BotAutoApprove).toBeFalse();
    expect(GIRACLE_SERVER_CONFIG.BotAutoApprove).toBeFalse();
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
    //申請者が自分のBotの審査状況を確認できる
    expect(j.data[0].approveStatus).toBe("APPROVED");
    expect(j.data[1].approveStatus).toBe("APPROVED");
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
let TEST__deletingBotRemoteUserId = "";
describe("PUT /server/bot", () => {
  it("正常", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: {
        name: "newBot",
        description: "This is a new bot",
        canFetchUserinfo: true,
        canManageUser: true,
        //同じチャンネルの重複指定(UNIQUE制約で落ちず1件に畳まれること)
        permissionChannelIds: ["TESTCHANNEL1", "TESTCHANNEL1"],
      },
    });
    const j = await res.json();
    expect(j.data.botName).toBe("newBot");
    expect(j.data.botDescription).toBe("This is a new bot");
    expect(j.data.useAllChannel).toBeFalse();
    expect(j.data.canFetchUserinfo).toBeTrue();

    //チャンネル透過もできていることを確認
    const perms = db
      .select({ channelId: botChannelPermissions.channelId })
      .from(botChannelPermissions)
      .where(eq(botChannelPermissions.botId, j.data.id))
      .all();
    expect(perms.length).toBe(1);
    expect(perms[0].channelId).toBe("TESTCHANNEL1");

    TEST__deletingBotId = j.data.id;
    TEST__deletingBotRemoteUserId = j.data.remoteUserId;
  });

  it("正常2 :: 全チャンネル透過", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newBot2", useAllChannel: true },
    });
    const j = await res.json();
    expect(j.data.botName).toBe("newBot2");
    expect(j.data.useAllChannel).toBeTrue();
    expect(j.data.canFetchUserinfo).toBeFalse();
  });

  it("正常3 :: 自動透過時には勝手にApproved", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    GIRACLE_SERVER_CONFIG.BotAutoApprove = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newBot3", useAllChannel: true },
    });
    const j = await res.json();
    expect(j.data.botName).toBe("newBot3");
    expect(j.data.useAllChannel).toBeTrue();
    expect(j.data.canFetchUserinfo).toBeFalse();
    expect(j.data.approveStatus).toBe("APPROVED");
    GIRACLE_SERVER_CONFIG.BotAutoApprove = false;
  });

  it("見えないチャンネルでBot作成しようとする", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newBotDeny", permissionChannelIds: ["TESTCHANNEL3"] },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("You cannot use a channel you cannot see");
  });

  it("ボット利用が許可されてないないときの作成", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "newbotX", canFetchUserinfo: true, canManageUser: true },
    });
    expect(res.ok).toBe(false);
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
  });

  it("Bot作成失敗時にユーザー行が残らない", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    //BOT_TEST_1 は INIT() が作る TESTBOT1 の botName と衝突する
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "BOT_TEST_1" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bot name already exists");

    //トランザクションが巻き戻り、Bot用のユーザー行が孤児として残らない
    const orphan = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, "BOT_TEST_1"));
    expect(orphan.length).toBe(0);
  });

  it("既存ユーザー名と衝突するBotは作成できない", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PUT",
      body: { name: "testsystemuser2" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bot name already exists");

    const orphan = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, "testsystemuser2"));
    expect(orphan.length).toBe(1);
  });
});

describe("DELETE /server/bot", () => {
  it("正常 :: メッセージを送ったBotも削除できる", async () => {
    // Botがメッセージを送った状態にする(投稿済みメッセージは削除で消えないこと)
    await db.insert(messages).values({
      content: "bot message",
      userId: TEST__deletingBotRemoteUserId,
      channelId: "TESTCHANNEL1",
      isBot: true,
    });

    const res = await FETCH({
      path: "/server/bot",
      method: "DELETE",
      body: { botId: TEST__deletingBotId },
    });
    const j = await res.json();
    expect(j.message).toBe("Bot deleted");

    // ユーザーはソフトデリートされ、メッセージは残る
    const [botUser] = await db
      .select({ isDeleted: users.isDeleted })
      .from(users)
      .where(eq(users.id, TEST__deletingBotRemoteUserId));
    expect(botUser?.isDeleted).toBe(true);
    const remain = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, TEST__deletingBotRemoteUserId));
    expect(remain.length).toBe(1);

    // チャンネル権限は botId cascade で消えていること
    const perms = await db
      .select({ id: botChannelPermissions.id })
      .from(botChannelPermissions)
      .where(eq(botChannelPermissions.botId, TEST__deletingBotId));
    expect(perms.length).toBe(0);
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
    expect(j.data.length).toBe(5);
    expect(j.data[0].botName).toBe("newBot3");
    expect(j.data[1].botName).toBe("newBot2");
    expect(j.data[2].botName).toBe("BOT_TEST_3");
    expect(j.data[3].botName).toBe("BOT_TEST_2");
    expect(j.data[4].botName).toBe("BOT_TEST_1");

    //承認者が審査状況と要求権限を確認できる
    const target = j.data.find((b: { id: string }) => b.id === "TESTBOT1");
    expect(target.approveStatus).toBe("APPROVED");
    expect(target.useAllChannel).toBeFalse();
    expect(target.canReadMessage).toBeTrue();
    //全透過の申請もそのまま見える
    expect(j.data[0].useAllChannel).toBeTrue();
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

describe("GET /server/bot/me/:botId", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/server/bot/me/TESTBOT1",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Fetched my bot info");
    expect(j.data.id).toBe("TESTBOT1");
    expect(j.data.botName).toBe("BOT_TEST_1");
    // tokenCodeは返らない
    expect(j.data.tokenCode).toBeUndefined();
    // remoteUserIdで紐付いたユーザーが展開される
    expect(j.data.user.id).toBe("TESTUSER_BOT_1");
    // チャンネル透過も展開される
    expect(j.data.channelPermissions.length).toBe(1);
    expect(j.data.channelPermissions[0].channelId).toBe("TESTCHANNEL1");
  });

  it("他人のBot", async () => {
    const res = await FETCH({
      path: "/server/bot/me/TESTBOT3",
      method: "GET",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("You are not owner of this bot");
  });

  it("存在しないBot", async () => {
    const res = await FETCH({
      path: "/server/bot/me/TESTBOT999",
      method: "GET",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });
});

describe("PATCH /server/bot/approval", () => {
  it("正常", async () => {
    // 既定値(APPROVED)以外を送り、暗黙補完されずに指定値が反映されることを見る
    const res = await FETCH({
      path: "/server/bot/approval",
      method: "PATCH",
      body: {
        botId: "TESTBOT1",
        approvalStatus: "DENIED",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data).toBe("TESTBOT1");
    expect(
      db
        .select({ approveStatus: botManages.approveStatus })
        .from(botManages)
        .where(eq(botManages.id, "TESTBOT1"))
        .get()?.approveStatus,
    ).toBe("DENIED");

    // 後続へ漏らさない(このdescribeはTESTBOT1の状態を書き換えるため)
    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED" })
      .where(eq(botManages.id, "TESTBOT1"));
  });

  it("存在しないBotデータ", async () => {
    const res = await FETCH({
      path: "/server/bot/approval",
      method: "PATCH",
      body: {
        botId: "TESTBOT999",
        approvalStatus: "APPROVED",
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
        approvalStatus: "APPROVED",
      },
      useSecondaryUser: true,
    });
    expect(res.ok).toBeFalse();
  });
});

// ファイル末尾に置く(TESTBOT1のbotNameを書き換えるため、GET /server/bot/all の期待値と干渉する)
describe("PATCH /server/bot", () => {
  it("正常 :: 権限変更でapproveStatusがPENDINGに戻る", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: {
        botId: "TESTBOT1",
        name: "BOT_TEST_1_RENAMED",
        canSendMessage: true,
        canManageUser: true,
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.botName).toBe("BOT_TEST_1_RENAMED");
    expect(j.data.canManageUser).toBeTrue();
    expect(j.data.approveStatus).toBe("PENDING");
    // tokenCodeは返らない
    expect(j.data.tokenCode).toBeUndefined();

    // 表示名を参照するusers.name側も揃っている(乖離すると改名が画面に出ない)
    const botUser = db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, "TESTUSER_BOT_1"))
      .get();
    expect(botUser?.name).toBe("BOT_TEST_1_RENAMED");
  });

  it("正常 :: 名前変更でもapproveStatusがPENDINGに戻る", async () => {
    // 申請承認済みの状態に戻す
    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED" })
      .where(eq(botManages.id, "TESTBOT1"));

    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", name: "BOT_TEST_1_RENAMED2" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.botName).toBe("BOT_TEST_1_RENAMED2");
    expect(j.data.approveStatus).toBe("PENDING");
  });

  it("正常 :: サーバー設定が自動承諾になっているなら承諾のまま", async () => {
    // 申請承認済みの状態に戻す
    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED" })
      .where(eq(botManages.id, "TESTBOT1"));

    GIRACLE_SERVER_CONFIG.BotAutoApprove = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", name: "BOT_TEST_1_RENAMED3" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.botName).toBe("BOT_TEST_1_RENAMED3");
    expect(j.data.approveStatus).toBe("APPROVED");
    GIRACLE_SERVER_CONFIG.BotAutoApprove = false;
  });

  it("自動承諾でもブロック済みのBotは復活しない", async () => {
    // 管理者によるBLOCKEDは制裁なので、所有者の変更操作で解除されてはならない
    await db
      .update(botManages)
      .set({ approveStatus: "BLOCKED", canReadMessage: true })
      .where(eq(botManages.id, "TESTBOT1"));

    GIRACLE_SERVER_CONFIG.BotAutoApprove = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      // 権限を実際に変えても(再審査扱いになる差分でも)ステータスは据え置き
      body: { botId: "TESTBOT1", canReadMessage: false },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.approveStatus).toBe("BLOCKED");
    // 編集自体は弾かれない
    expect(j.data.canReadMessage).toBeFalse();
    GIRACLE_SERVER_CONFIG.BotAutoApprove = false;

    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED", canReadMessage: true })
      .where(eq(botManages.id, "TESTBOT1"));
  });

  it("自動承諾なら拒否済み(DENIED)のBotも編集で復帰する", async () => {
    // 自動承諾は管理者が承認レビュー自体を不要とする設定なので、DENIEDでも承認に戻す
    await db
      .update(botManages)
      .set({ approveStatus: "DENIED", canReadMessage: true })
      .where(eq(botManages.id, "TESTBOT1"));

    GIRACLE_SERVER_CONFIG.BotAutoApprove = true;
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", canReadMessage: false },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.approveStatus).toBe("APPROVED");
    GIRACLE_SERVER_CONFIG.BotAutoApprove = false;

    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED", canReadMessage: true })
      .where(eq(botManages.id, "TESTBOT1"));
  });

  it("正常 :: 概要の変更だけだとPENDINGにならない", async () => {
    // 申請承認済みの状態に戻す
    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED" })
      .where(eq(botManages.id, "TESTBOT1"));

    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", description: "testing new description" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("TESTBOT1");
    expect(j.data.botDescription).toBe("testing new description");
    expect(j.data.approveStatus).toBe("APPROVED");
  });

  it("既存のBot名には変更できない", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", name: "BOT_TEST_2" },
    });
    expect(res.ok).toBeFalse();
    const t = await res.text();
    expect(t).toBe("Bot name already exists");
  });

  it("他人のBotは更新できない", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT3", name: "hijack" },
    });
    expect(res.ok).toBeFalse();
  });

  it("存在しないBot", async () => {
    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT999", name: "ghost" },
    });
    expect(res.ok).toBeFalse();
    const t = await res.text();
    expect(t).toBe("Bot not found");
  });

  it("正常 :: 権限のみ変更でもapproveStatusがPENDINGに戻る", async () => {
    await db
      .update(botManages)
      .set({ approveStatus: "APPROVED" })
      .where(eq(botManages.id, "TESTBOT1"));

    const res = await FETCH({
      path: "/server/bot",
      method: "PATCH",
      body: { botId: "TESTBOT1", canFetchUserinfo: true },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.canFetchUserinfo).toBeTrue();
    expect(j.data.approveStatus).toBe("PENDING");
  });
});

// PATCHは共有状態(TESTBOT1のbotName/approveStatus)を書き換えるため、後続のテストファイルへ漏らさないよう戻す
afterAll(async () => {
  await db
    .update(botManages)
    .set({ botName: "BOT_TEST_1", approveStatus: "APPROVED" })
    .where(eq(botManages.id, "TESTBOT1"));
  // 改名でusers.nameも書き換わるため揃えて戻す
  await db
    .update(users)
    .set({ name: "testbotuser" })
    .where(eq(users.id, "TESTUSER_BOT_1"));
});
