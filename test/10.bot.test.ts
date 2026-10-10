import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
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
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
