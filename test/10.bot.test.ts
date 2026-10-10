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
