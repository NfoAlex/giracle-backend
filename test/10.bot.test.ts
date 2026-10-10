import { beforeAll, describe, expect, it } from "bun:test";
import { GIRACLE_SERVER_CONFIG } from "../src";
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
});
