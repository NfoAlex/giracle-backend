import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { botManages, users } from "../src/db/schema";
import { FETCH, INIT } from "./util";

beforeAll(async () => {
  await INIT();
  GIRACLE_SERVER_CONFIG.BotEnabled = true;
});

describe("PUT /bot", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "PUT",
      body: {
        name: "BotTestCreated1",
        introduction: "Created this for test",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot created");
    expect(j.data.remoteUser.isBot).toBeTrue();
    expect(j.data.remoteUser.name).toBe("BotTestCreated1");
    expect(j.data.remoteUser.selfIntroduction).toBe("Created this for test");
    expect(j.data.bot.createdBy).toBe("TESTUSER");
  });

  it("空名前で作成してみる", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "PUT",
      body: {
        name: "",
        introduction: "",
      },
    });
    expect(res.ok).toBe(false);
  });
});

describe("DELETE /bot", async () => {
  it("正常 :: BotManage行が消えリモートユーザーが論理削除される", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestDeleted1", introduction: "to be deleted" },
      })
    ).json();
    const { botId, remoteUserId } = {
      botId: created.data.bot.id,
      remoteUserId: created.data.remoteUser.id,
    };

    const res = await FETCH({
      path: "/bot",
      method: "DELETE",
      body: { botId },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot deleted");

    //BotManage行は物理削除される
    expect(
      await db.query.botManages.findFirst({
        where: eq(botManages.id, botId),
      }),
    ).toBeUndefined();
    //リモートユーザーは残り、論理削除フラグが立っている
    const deletedUser = await db.query.users.findFirst({
      where: eq(users.id, remoteUserId),
    });
    expect(deletedUser).not.toBeUndefined();
    expect(deletedUser?.isDeleted).toBe(true);
  });

  it("存在しないBotを削除しようとする", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "DELETE",
      body: { botId: "NOT_EXISTING_BOT" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });
});

describe("POST /server/bot/set-approve", async () => {
  it("正常 :: isApprovedがtrueへ更新される", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestApproved1", introduction: "to be approved" },
        useAdminUser: true,
      })
    ).json();
    const botId = created.data.bot.id;

    const res = await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId, isApproved: true },
      useAdminUser: true,
    });
    const t = await res.clone().text();
    console.log("10.bot :: t", t);
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot updated");
    expect(j.data.id).toBe(botId);
    expect(j.data.isApproved).toBe(true);

    //DB側も更新されている
    const bot = await db.query.botManages.findFirst({
      where: eq(botManages.id, botId),
    });
    expect(bot?.isApproved).toBe(true);
  });

  it("正常 :: isApprovedをfalseへ戻せる", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestApproved2", introduction: "to be unapproved" },
        useAdminUser: true,
      })
    ).json();
    const botId = created.data.bot.id;

    //作成直後は既定で未承認
    expect(created.data.bot.isApproved).toBe(false);

    await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId, isApproved: true },
      useAdminUser: true,
    });
    const res = await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId, isApproved: false },
      useAdminUser: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.isApproved).toBe(false);
  });

  it("存在しないBotを承認しようとする", async () => {
    const res = await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId: "NOT_EXISTING_BOT", isApproved: true },
      useAdminUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });

  it("権限無しでの承認", async () => {
    const res = await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId: "BotTestApproved2", isApproved: true },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});

describe("GET /bot/list", () => {
  //同一ミリ秒の複数件(タイブレーク必須)と別時刻の件を混在させる。取得順はid順とも挿入順とも限らない
  const SAME_MS = new Date("2026-01-01T00:00:00.000Z");
  const LATER = new Date("2026-01-02T00:00:00.000Z");
  //期待順: createdAt昇順 → 同一createdAtはid昇順(挿入順 C,A,B,D とは異なる)
  const EXPECTED = ["BOTLIST_A", "BOTLIST_B", "BOTLIST_C", "BOTLIST_D"];

  beforeAll(async () => {
    await db.insert(botManages).values([
      {
        id: "BOTLIST_C",
        remoteUserId: "BOTUSER",
        createdBy: "TESTUSER",
        createdAt: SAME_MS,
        tokenCode: "tokBotlistC",
      },
      {
        id: "BOTLIST_A",
        remoteUserId: "BOTUSER",
        createdBy: "TESTUSER",
        createdAt: SAME_MS,
        tokenCode: "tokBotlistA",
      },
      {
        id: "BOTLIST_B",
        remoteUserId: "BOTUSER",
        createdBy: "TESTUSER",
        createdAt: SAME_MS,
        tokenCode: "tokBotlistB",
      },
      {
        id: "BOTLIST_D",
        remoteUserId: "BOTUSER",
        createdBy: "TESTUSER",
        createdAt: LATER,
        tokenCode: "tokBotlistD",
      },
      //別ユーザー作成分は混ざらないことの確認用
      {
        id: "BOTLIST_X",
        remoteUserId: "BOTUSER",
        createdBy: "TESTUSER2",
        createdAt: SAME_MS,
        tokenCode: "tokBotlistX",
      },
    ]);
  });

  afterAll(async () => {
    //INITが用意したBOTMANAGE等を消さないよう、このテストで作ったidだけを削除する
    await db.delete(botManages).where(like(botManages.id, "BOTLIST\\_%"));
  });

  it("正常 :: 作成順に全件取得できる(cursorBotIdで継続取得)", async () => {
    const got: string[] = [];
    let cursorBotId: string | undefined;
    //cursorBotIdだけを渡して継続取得する(初回は未指定)
    for (let page = 0; page < 5; page++) {
      const path =
        `/bot/list?length=2${cursorBotId ? `&cursorBotId=${cursorBotId}` : ""}` as const;
      const res = await FETCH({ path, method: "GET" });
      expect(res.ok).toBe(true);
      const j = await res.json();
      if (j.data.length === 0) break;
      got.push(...j.data.map((b: { id: string }) => b.id));
      cursorBotId = j.data[j.data.length - 1].id;
    }

    //INITのBOTMANAGEや同ファイル前半で作成したBotも同じ作成者のため、このテストの分だけ抜き出して順序を見る
    expect(got.filter((id) => id.startsWith("BOTLIST_"))).toEqual(EXPECTED);
    //他ユーザー作成分は含まれない
    expect(got).not.toContain("BOTLIST_X");
  });

  it("正常 :: 初回はlimit件のみ返る", async () => {
    const res = await FETCH({ path: "/bot/list?length=2", method: "GET" });
    const j = await res.json();
    expect(j.data.map((b: { id: string }) => b.id)).toEqual([
      "BOTLIST_A",
      "BOTLIST_B",
    ]);
  });

  it("正常 :: 別ユーザーからは自分の作成分だけ返る", async () => {
    const res = await FETCH({
      path: "/bot/list?length=50",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.data.map((b: { id: string }) => b.id)).toEqual(["BOTLIST_X"]);
  });

  it("異常 :: 存在しないcursorBotIdは404", async () => {
    const res = await FETCH({
      path: "/bot/list?cursorBotId=NOT_EXISTING_BOT",
      method: "GET",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Cursor bot not found");
  });

  it("異常 :: 未認証", async () => {
    const res = await FETCH({
      path: "/bot/list",
      method: "GET",
      excludeCredential: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
