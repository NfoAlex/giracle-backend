import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { ServiceBot } from "../src/components/Bot/bot.service";
import { botManages, users } from "../src/db/schema";
import { QueryBot } from "../src/queries/bot.query";
import { QueryRoleLink } from "../src/queries/roleLink.query";
import { QueryUser } from "../src/queries/user.query";
import { Util } from "../src/Util";
import { FETCH, INIT, pngFile } from "./util";

beforeAll(async () => {
  await INIT();
  GIRACLE_SERVER_CONFIG.BotEnabled = true;
});

//disconnect() は文字列(JSON)を send してから close する
function fakeDisconnectWs() {
  let closed = false;
  return {
    ws: {
      raw: { id: `RAW_BOT_DISCONNECT_${Math.random()}` },
      send: () => {},
      close: () => {
        closed = true;
      },
      subscribe: () => {},
      unsubscribe: () => {},
      publish: () => {},
      // biome-ignore lint/suspicious/noExplicitAny: WSハンドラの型はElysia内部のためanyで受け取る
    } as any,
    isClosed: () => closed,
  };
}

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

  it("正常 :: 作成時にBOTロールがリンクされる", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotRoleLink1", introduction: "" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);

    const links = await QueryRoleLink.getLinksByUser({
      userId: j.data.remoteUser.id,
    });
    expect(links.map((l) => l.roleId)).toContain("BOT");
  });

  it("同名で作成してみる", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotTestCreated1", introduction: "duplicate" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      "Requested name is used by other bot or user",
    );

    //ロールバックされBotManage行は残らない
    const duplicated = await db.query.users.findMany({
      where: eq(users.name, "BotTestCreated1"),
    });
    expect(duplicated.length).toBe(1);
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

  it("正常 :: BOTロールリンクが消える", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestDeleted3", introduction: "to be deleted" },
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
    expect(res.ok).toBe(true);

    //削除済みBotにロール付与が残らない
    const links = await QueryRoleLink.getLinksByUser({ userId: remoteUserId });
    expect(links).toEqual([]);
  });

  it("存在しないBotを削除しようとする", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "DELETE",
      body: { botId: "NOT_EXISTING_BOT" },
    });
    const t = await res.clone().text();
    console.log("10.bot.test :: t", t);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });

  it("他人のBotを削除しようとする", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestDeleted2", introduction: "to be deleted" },
      })
    ).json();
    const { botId } = {
      botId: created.data.bot.id,
    };

    const res = await FETCH({
      path: "/bot",
      method: "DELETE",
      body: { botId },
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });

  it("正常 :: 削除したBotのWS接続も切れる", async () => {
    const { bot, remoteUser } = await ServiceBot.PutBot(
      "TESTUSER",
      "BotDeleteWs1",
      "",
    );
    const { ws, isClosed } = fakeDisconnectWs();
    Util.wsUserInstance.add(remoteUser.id, ws);

    await ServiceBot.DeleteBot("TESTUSER", bot.id);

    expect(Util.wsUserInstance.instances.has(remoteUser.id)).toBe(false);
    expect(isClosed()).toBeTrue();
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

  it("正常 :: 承認を剥がすと接続中のBot WSが切断される", async () => {
    //WSはopen時にしか承認を判定しないため、剥がす側で切らないと接続が残り続ける
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestUnapproved1", introduction: "to be unapproved" },
        useAdminUser: true,
      })
    ).json();
    const { botId, remoteUserId } = {
      botId: created.data.bot.id,
      remoteUserId: created.data.remoteUser.id,
    };

    await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId, isApproved: true },
      useAdminUser: true,
    });

    //承認済みで接続中の状態を模す
    const closed: string[] = [];
    Util.wsUserInstance.instances.set(remoteUserId, [
      {
        send: () => {},
        close: () => {
          closed.push(remoteUserId);
        },
        subscribe: () => {},
        unsubscribe: () => {},
      },
    ]);

    const res = await FETCH({
      path: "/server/bot/set-approve",
      method: "POST",
      body: { botId, isApproved: false },
      useAdminUser: true,
    });
    expect(res.ok).toBe(true);
    expect(closed).toEqual([remoteUserId]);
    expect(Util.wsUserInstance.instances.has(remoteUserId)).toBe(false);
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

  it("正常 :: queryで名前の前方一致絞り込み", async () => {
    await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotListQuery1", introduction: "" },
    });
    await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotListQueryOther1", introduction: "" },
    });

    const res = await FETCH({
      path: "/bot/list?length=50&query=BotListQuery1",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(1);
    expect(j.data[0].remoteUserName).toBe("BotListQuery1");
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

describe("GET /bot/all", () => {
  it("正常 :: 全Botが返る", async () => {
    const res = await FETCH({
      path: "/bot/all?length=50",
      method: "GET",
      useAdminUser: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot list fetched");
    expect(j.data.length).toBeGreaterThan(0);
    //tokenCodeは管理者一覧には含めない
    expect(Object.keys(j.data[0])).not.toContain("tokenCode");
    const botManage = j.data.find((b: { id: string }) => b.id === "BOTMANAGE");
    expect(botManage.remoteUserName).toBe("botuser");
  });

  it("正常 :: 新しい順に並ぶ", async () => {
    const res = await FETCH({
      path: "/bot/all?length=50",
      method: "GET",
      useAdminUser: true,
    });
    const j = await res.json();
    for (let i = 1; i < j.data.length; i++) {
      const prev = new Date(j.data[i - 1].createdAt).getTime();
      const cur = new Date(j.data[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it("正常 :: queryで名前の前方一致絞り込み", async () => {
    await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotAllSearch1", introduction: "" },
      useAdminUser: true,
    });
    await FETCH({
      path: "/bot",
      method: "PUT",
      body: { name: "BotAllOther1", introduction: "" },
      useAdminUser: true,
    });

    const res = await FETCH({
      path: "/bot/all?length=50&query=BotAllSearch",
      method: "GET",
      useAdminUser: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
    for (const bot of j.data) {
      expect(bot.remoteUserName.startsWith("BotAllSearch")).toBe(true);
    }
    expect(
      j.data.map((b: { remoteUserName: string }) => b.remoteUserName),
    ).toContain("BotAllSearch1");
  });

  it("正常 :: cursorBotIdで継続取得", async () => {
    const first = await (
      await FETCH({
        path: "/bot/all?length=1",
        method: "GET",
        useAdminUser: true,
      })
    ).json();
    expect(first.data.length).toBe(1);

    const second = await (
      await FETCH({
        path: `/bot/all?length=1&cursorBotId=${first.data[0].id}`,
        method: "GET",
        useAdminUser: true,
      })
    ).json();
    expect(second.data.length).toBe(1);
    expect(second.data[0].id).not.toBe(first.data[0].id);
    //新しい順なので2件目は1件目より古いか同一
    expect(new Date(second.data[0].createdAt).getTime()).toBeLessThanOrEqual(
      new Date(first.data[0].createdAt).getTime(),
    );
  });

  it("異常 :: 存在しないcursorBotIdは404", async () => {
    const res = await FETCH({
      path: "/bot/all?cursorBotId=NOT_EXISTING_BOT",
      method: "GET",
      useAdminUser: true,
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Cursor bot not found");
  });

  it("異常 :: 権限無し", async () => {
    const res = await FETCH({
      path: "/bot/all",
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Role level not enough");
  });

  it("異常 :: 未認証", async () => {
    const res = await FETCH({
      path: "/bot/all",
      method: "GET",
      excludeCredential: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});

describe("GET /bot/:remoteUserId", () => {
  it("正常 :: 作成者と承認状態が返りtokenCodeは含まない", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotInfoGet1", introduction: "info get" },
      })
    ).json();
    const remoteUserId = created.data.remoteUser.id;

    const res = await FETCH({
      path: `/bot/${remoteUserId}`,
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot info");
    expect(j.data.id).toBe(created.data.bot.id);
    expect(j.data.remoteUserId).toBe(remoteUserId);
    expect(j.data.createdBy).toBe("TESTUSER");
    expect(j.data.isApproved).toBe(false);
    expect(j.data.tokenCode).toBeUndefined();
  });

  it("正常 :: 作成者が論理削除済みでも取得できる", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotInfoDeleted1", introduction: "" },
      })
    ).json();
    const remoteUserId = created.data.remoteUser.id;

    await db
      .update(users)
      .set({ isDeleted: true })
      .where(eq(users.id, remoteUserId));

    const res = await FETCH({
      path: `/bot/${remoteUserId}`,
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.createdBy).toBe("TESTUSER");
  });

  it("異常 :: 存在しないremoteUserIdは404", async () => {
    const res = await FETCH({
      path: "/bot/NOT_EXISTING_USER",
      method: "GET",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });
});

describe("POST /", () => {
  //更新対象のBotはサービス直呼びで作る(PUT /bot経由だと更新対象の作成者が常にTESTUSERになる)
  const createBot = (name: string, introduction = "") =>
    ServiceBot.PutBot("TESTUSER", name, introduction);

  //status(4xx, ...)はErrorではなくElysiaCustomStatusResponseを投げるため、code/responseで見る
  const catchStatus = async (promise: Promise<unknown>) =>
    await promise.then(
      () => undefined,
      (err: { code: number; response: string }) => err,
    );

  it("正常 :: 名前と自己紹介が更新され、更新後のユーザーが返る", async () => {
    const { bot, remoteUser } = await createBot("BotUpdate1", "before");

    const updated = await ServiceBot.Update(
      "TESTUSER",
      bot.id,
      "BotUpdate1Renamed",
      "after",
    );

    expect(updated?.id).toBe(remoteUser.id);
    expect(updated?.name).toBe("BotUpdate1Renamed");
    expect(updated?.selfIntroduction).toBe("after");

    const row = await db.query.users.findFirst({
      where: eq(users.id, remoteUser.id),
    });
    expect(row?.name).toBe("BotUpdate1Renamed");
    expect(row?.selfIntroduction).toBe("after");
  });

  it("正常 :: 名前を変更すると承認が取り消される", async () => {
    const { bot } = await createBot("BotUpdate2");
    await QueryBot.updateBotIsApproved({ botId: bot.id, isApproved: true });

    await ServiceBot.Update("TESTUSER", bot.id, "BotUpdate2Renamed");

    const row = await db.query.botManages.findFirst({
      where: eq(botManages.id, bot.id),
    });
    expect(row?.isApproved).toBe(false);
  });

  it("正常 :: 名前が変わらないなら承認は維持される", async () => {
    const { bot } = await createBot("BotUpdate3", "before");
    await QueryBot.updateBotIsApproved({ botId: bot.id, isApproved: true });

    //同名を渡して自己紹介だけ変える(改名ではないので承認は剥がさない)
    await ServiceBot.Update("TESTUSER", bot.id, "BotUpdate3", "after");

    const row = await db.query.botManages.findFirst({
      where: eq(botManages.id, bot.id),
    });
    expect(row?.isApproved).toBe(true);
  });

  it("正常 :: name未指定なら名前は変わらず、自己紹介だけ更新される", async () => {
    const { bot, remoteUser } = await createBot("BotUpdate4", "before");
    await QueryBot.updateBotIsApproved({ botId: bot.id, isApproved: true });

    await ServiceBot.Update("TESTUSER", bot.id, undefined, "after");

    const row = await db.query.users.findFirst({
      where: eq(users.id, remoteUser.id),
    });
    expect(row?.name).toBe("BotUpdate4");
    expect(row?.selfIntroduction).toBe("after");

    //改名していないので承認は剥がれない
    const botRow = await db.query.botManages.findFirst({
      where: eq(botManages.id, bot.id),
    });
    expect(botRow?.isApproved).toBe(true);
  });

  it("異常 :: 他人のBotは更新できない", async () => {
    const { bot, remoteUser } = await createBot("BotUpdate5", "before");

    const err = await catchStatus(
      ServiceBot.Update("TESTUSER2", bot.id, "BotUpdate5Renamed"),
    );
    expect(err?.code).toBe(400);
    expect(err?.response).toBe("This is not your bot");

    //他人の操作では何も書き換わらない
    const row = await db.query.users.findFirst({
      where: eq(users.id, remoteUser.id),
    });
    expect(row?.name).toBe("BotUpdate5");
    expect(row?.selfIntroduction).toBe("before");
  });

  it("異常 :: 存在しないBotは404", async () => {
    const err = await catchStatus(
      ServiceBot.Update("TESTUSER", "NOT_EXISTING_BOT", "BotUpdate6Renamed"),
    );
    expect(err?.code).toBe(404);
    expect(err?.response).toBe("Bot not found");
  });

  it("正常 :: POST /bot(body)経由で更新できる", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotUpdateHttp1", introduction: "before" },
      })
    ).json();
    const { botId, remoteUserId } = {
      botId: created.data.bot.id,
      remoteUserId: created.data.remoteUser.id,
    };

    const res = await FETCH({
      path: "/bot",
      method: "POST",
      body: { botId, name: "BotUpdateHttp1Renamed", selfIntroduction: "after" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot user updated");
    expect(j.data.id).toBe(remoteUserId);
    expect(j.data.name).toBe("BotUpdateHttp1Renamed");
    expect(j.data.selfIntroduction).toBe("after");
  });

  it("異常 :: 名前も自己紹介も未指定なら400", async () => {
    const { bot, remoteUser } = await createBot("BotUpdateEmpty1", "before");

    const res = await FETCH({
      path: "/bot",
      method: "POST",
      body: { botId: bot.id },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Name or self introduction is essential");

    //何も書き換わらない
    const row = await db.query.users.findFirst({
      where: eq(users.id, remoteUser.id),
    });
    expect(row?.name).toBe("BotUpdateEmpty1");
    expect(row?.selfIntroduction).toBe("before");
  });

  it("正常 :: 自己紹介だけ空文字で指定しても更新できる", async () => {
    const { bot, remoteUser } = await createBot("BotUpdateEmpty2", "before");

    const res = await FETCH({
      path: "/bot",
      method: "POST",
      body: { botId: bot.id, selfIntroduction: "" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe(remoteUser.id);
    expect(j.data.selfIntroduction).toBe("");
  });

  it("異常 :: POST /botで存在しないBotIdは404", async () => {
    const res = await FETCH({
      path: "/bot",
      method: "POST",
      body: { botId: "NOT_EXISTING_BOT", name: "BotUpdateHttp2Renamed" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });

  it("正常 :: 改名で未承認になったBotのWS接続も切れる", async () => {
    const { bot, remoteUser } = await createBot("BotUpdateWs1", "");
    await QueryBot.updateBotIsApproved({ botId: bot.id, isApproved: true });
    const { ws, isClosed } = fakeDisconnectWs();
    Util.wsUserInstance.add(remoteUser.id, ws);

    await ServiceBot.Update("TESTUSER", bot.id, "BotUpdateWs1Renamed");

    expect(Util.wsUserInstance.instances.has(remoteUser.id)).toBe(false);
    expect(isClosed()).toBeTrue();
  });

  it("異常 :: 既存名への改名は400", async () => {
    await createBot("BotUpdateDupA", "");
    const { bot } = await createBot("BotUpdateDupB", "");

    const err = await catchStatus(
      ServiceBot.Update("TESTUSER", bot.id, "BotUpdateDupA"),
    );

    expect(err?.code).toBe(400);
    expect(err?.response).toBe("Requested name is used by other bot or user");
  });

  it("異常 :: 32文字を超える名前では更新されない", async () => {
    const { bot, remoteUser } = await createBot("BotUpdateLong1", "");

    const res = await FETCH({
      path: "/bot",
      method: "POST",
      body: { botId: bot.id, name: "a".repeat(33) },
    });

    //app経由ではバリデーションエラーがonErrorで500になるため状態コードは固定しない
    expect(res.ok).toBeFalse();
    const row = await db.query.users.findFirst({
      where: eq(users.id, remoteUser.id),
    });
    expect(row?.name).toBe("BotUpdateLong1");
  });
});

describe("トランザクションの原子性", () => {
  it("Bot作成に失敗したらリモートユーザーも残らない", async () => {
    //テスト用にBot行の挿入だけを失敗させる(名前空間オブジェクトは型上readonlyのためキャストする)
    const stub = QueryBot as {
      insertWithRemoteUserIdInTx: typeof QueryBot.insertWithRemoteUserIdInTx;
    };
    const original = stub.insertWithRemoteUserIdInTx;
    stub.insertWithRemoteUserIdInTx = () => {
      throw new Error("bot insert failed");
    };
    try {
      await expect(
        ServiceBot.PutBot("TESTUSER", "BotTestOrphan1"),
      ).rejects.toThrow("bot insert failed");
    } finally {
      stub.insertWithRemoteUserIdInTx = original;
    }

    expect(
      await db.query.users.findFirst({
        where: eq(users.name, "BotTestOrphan1"),
      }),
    ).toBeUndefined();
  });

  it("ロールリンクの作成に失敗したらリモートユーザーもBot行も残らない", async () => {
    //ロールリンク挿入だけを失敗させ、ユーザーとBot行が巻き戻ることを見る
    const stub = QueryRoleLink as {
      insertLinkInTx: typeof QueryRoleLink.insertLinkInTx;
    };
    const original = stub.insertLinkInTx;
    stub.insertLinkInTx = () => {
      throw new Error("role link failed");
    };
    try {
      await expect(
        ServiceBot.PutBot("TESTUSER", "BotTestOrphan2"),
      ).rejects.toThrow("role link failed");
    } finally {
      stub.insertLinkInTx = original;
    }

    expect(
      await db.query.users.findFirst({
        where: eq(users.name, "BotTestOrphan2"),
      }),
    ).toBeUndefined();
  });

  it("Bot削除に失敗したらBot行もリモートユーザーも残る", async () => {
    const created = await (
      await FETCH({
        path: "/bot",
        method: "PUT",
        body: { name: "BotTestRollback1", introduction: "rollback" },
      })
    ).json();
    const botId = created.data.bot.id;
    const remoteUserId = created.data.remoteUser.id;

    //リモートユーザーの論理削除だけを失敗させ、先に消したBot行が戻ることを見る
    const stub = QueryUser as {
      setDeletedInTx: (tx: never, query: { userId: string }) => void;
    };
    const original = stub.setDeletedInTx;
    stub.setDeletedInTx = () => {
      throw new Error("user delete failed");
    };
    try {
      await expect(ServiceBot.DeleteBot("TESTUSER", botId)).rejects.toThrow(
        "user delete failed",
      );
    } finally {
      stub.setDeletedInTx = original;
    }

    expect(
      await db.query.botManages.findFirst({ where: eq(botManages.id, botId) }),
    ).not.toBeUndefined();
    const user = await db.query.users.findFirst({
      where: eq(users.id, remoteUserId),
    });
    expect(user?.isDeleted).toBe(false);
  });
});

describe("POST /bot/change-icon", () => {
  const ICON_DIR = "./STORAGE/icon";
  const iconPathOf = (remoteUserId: string) =>
    `${ICON_DIR}/${remoteUserId}.webp`;
  const createBot = (name: string) => ServiceBot.PutBot("TESTUSER", name, "");
  const createdRemoteUserIds: string[] = [];

  const changeIcon = (botId: string, icon: File) => {
    const formData = new FormData();
    formData.append("botId", botId);
    formData.append("icon", icon);
    return FETCH({ path: "/bot/change-icon", method: "POST", body: formData });
  };

  afterAll(async () => {
    //このテストで作ったBotのアイコンだけを掃除する
    for (const remoteUserId of createdRemoteUserIds) {
      await Bun.file(iconPathOf(remoteUserId))
        .delete()
        .catch(() => {});
    }
  });

  it("正常 :: Botのリモートユーザーのアイコンが変更される", async () => {
    const { bot, remoteUser } = await createBot("BotIconChange1");
    createdRemoteUserIds.push(remoteUser.id);

    const res = await changeIcon(bot.id, pngFile());
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("Bot icon changed");

    //保存先はBot(リモートユーザー)であり、作成者ではない
    expect(await Bun.file(iconPathOf(remoteUser.id)).exists()).toBe(true);
    const iconRes = await FETCH({
      path: `/user/icon/${remoteUser.id}`,
      method: "GET",
    });
    expect(iconRes.ok).toBe(true);
  });

  it("正常 :: 作成者自身のアイコンは変更されない", async () => {
    const ownerIconPath = iconPathOf("TESTUSER");
    const ownerIconBefore = await Bun.file(ownerIconPath)
      .stat()
      .catch(() => null);
    const { bot, remoteUser } = await createBot("BotIconChange2");
    createdRemoteUserIds.push(remoteUser.id);

    expect((await changeIcon(bot.id, pngFile())).ok).toBe(true);

    const ownerIconAfter = await Bun.file(ownerIconPath)
      .stat()
      .catch(() => null);
    expect(ownerIconAfter?.mtimeMs).toBe(ownerIconBefore?.mtimeMs);
  });

  it("異常 :: 不正なファイル形式は400", async () => {
    const { bot, remoteUser } = await createBot("BotIconChange3");
    createdRemoteUserIds.push(remoteUser.id);
    const txt = new File(["hello"], "icon.txt", { type: "text/plain" });

    const res = await changeIcon(bot.id, txt);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("File type is invalid");

    //保存されない
    expect(await Bun.file(iconPathOf(remoteUser.id)).exists()).toBe(false);
  });

  it("異常 :: 他人のBotは変更できない", async () => {
    const { bot, remoteUser } = await createBot("BotIconChange4");
    createdRemoteUserIds.push(remoteUser.id);

    //作成者TESTUSERのBotをTESTUSER2が変更しようとする
    const formData = new FormData();
    formData.append("botId", bot.id);
    formData.append("icon", pngFile());
    const res = await FETCH({
      path: "/bot/change-icon",
      method: "POST",
      body: formData,
      useSecondaryUser: true,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("This is not your bot");

    expect(await Bun.file(iconPathOf(remoteUser.id)).exists()).toBe(false);
  });

  it("異常 :: 存在しないBotは404", async () => {
    const res = await changeIcon("NOT_EXISTING_BOT", pngFile());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Bot not found");
  });

  it("異常 :: botId未指定はバリデーションエラー", async () => {
    const formData = new FormData();
    formData.append("icon", pngFile());
    const res = await FETCH({
      path: "/bot/change-icon",
      method: "POST",
      body: formData,
    });
    expect(res.ok).toBe(false);
  });

  it("異常 :: 未認証", async () => {
    const { bot } = await createBot("BotIconChange5");

    const formData = new FormData();
    formData.append("botId", bot.id);
    formData.append("icon", pngFile());
    const res = await FETCH({
      path: "/bot/change-icon",
      method: "POST",
      body: formData,
      excludeCredential: true,
    });
    expect(res.status).toBe(401);
  });
});
