import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src";
import { botManages, inboxes, users } from "../src/db/schema";
import { FETCH, INIT } from "./util";

// open-graph-scraperをモック化（外部リクエスト不要）
// let lastOgsOptions:
//   | { url?: string; fetchOptions?: { redirect?: string } }
//   | undefined;
mock.module("open-graph-scraper", () => ({
  default: async (options: {
    url: string;
    fetchOptions?: { redirect?: string };
  }) => {
    // lastOgsOptions = options;
    const { url } = options;
    if (url === "http://1.2.3.4") {
      return {
        error: false,
        result: {
          requestUrl: url,
          ogType: "website",
          ogTitle: "You should not see this",
          ogDescription: "Hidden Description",
          favicon: "https://example.com/favicon.ico",
          ogImage: [{ url: "https://example.com/image.png" }],
          ogVideo: undefined,
        },
      };
    }
    if (url === "https://fxtwitter.com/TEST/status/00000000") {
      return {
        error: false,
        result: {
          requestUrl: url,
          ogType: "website",
          ogTitle: "Test",
          ogDescription: "this is a tweet",
          favicon: "https://x.com/favicon.ico",
          ogImage: undefined,
          ogVideo: undefined,
        },
      };
    }
    if (url === "https://example.com/ogs-error") {
      return {
        error: true,
        result: undefined,
      };
    }

    return {
      error: false,
      result: {
        requestUrl: url,
        ogType: "website",
        ogTitle: "Mock OG Title",
        ogDescription: "Mock OG Description",
        favicon: "https://example.com/favicon.ico",
        ogImage: [{ url: "https://example.com/image.png" }],
        ogVideo: undefined,
      },
    };
  },
}));

beforeAll(async () => {
  await INIT();
});

describe("GET /ext/message/:messageId", () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE1",
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j.id).toBe("TESTMESSAGE1");
  });

  it("閲覧権限無しのボット", async () => {
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE1",
      method: "GET",
      headers: { authorization: "TESTTOKEN2" },
      excludeCredential: true,
    });
    const t = await res.text();
    expect(t).toBe("Permission not enough");
  });
});

describe("POST /ext/message/send", () => {
  let TEST__MESSAGE_ID_WITH_URL = "";
  it("正常 :: URL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out https://example.com",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j).toContainKey("id");
    TEST__MESSAGE_ID_WITH_URL = j.id;
  });
  it("正常 :: URL含むメッセージ送信 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(250);

    const res = await FETCH({
      path: `/ext/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j.MessageUrlPreview).toBeArray();
    expect(j.MessageUrlPreview.length).toBeGreaterThan(0);
    expect(j.MessageUrlPreview[0].url).toBe("https://example.com");
    expect(j.MessageUrlPreview[0].title).toBe("Mock OG Title");
  });

  //メンションはチャンネル参加者(TESTUSER)のみinbox化される
  it("正常 :: メンション付き送信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "@<TESTUSER> hello" },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j).toContainKey("id");
    const rows = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.messageId, j.id));
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe("TESTUSER");
    expect(rows[0].type).toBe("mention");
  });

  it("正常 :: 同一ユーザーへの重複メンションは1件", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "@<TESTUSER> @<TESTUSER> hi",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j).toContainKey("id");
    const rows = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.messageId, j.id));
    expect(rows.length).toBe(1);
  });

  it("存在しない・未参加ユーザーへのメンションはinbox化されない", async () => {
    for (const userId of ["GHOSTUSER999", "TESTUSER2"]) {
      const res = await FETCH({
        path: "/ext/message/send",
        method: "POST",
        body: { channelId: "TESTCHANNEL1", message: `@<${userId}> hello` },
        headers: { authorization: "TESTTOKEN1" },
        excludeCredential: true,
      });
      const j = await res.json();
      expect(j).toContainKey("id");
      const rows = await db
        .select()
        .from(inboxes)
        .where(eq(inboxes.messageId, j.id));
      expect(rows.length).toBe(0);
    }
  });

  //返信先(TESTMESSAGE1の送信者TESTUSER)へreply通知される
  it("正常 :: 返信付き送信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "reply test",
        replyingMessageId: "TESTMESSAGE1",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j).toContainKey("id");
    expect(j.replyingMessageId).toBe("TESTMESSAGE1");
    const rows = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.messageId, j.id));
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe("TESTUSER");
    expect(rows[0].type).toBe("reply");
  });

  it("存在しないメッセージへの返信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "reply test",
        replyingMessageId: "TESTMESSAGE999",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Replying message not found");
  });
});

describe("POST /ext/message/edit", () => {
  let TEST__BOT_MESSAGE_ID = "";
  it("正常 :: 送信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "edit me" },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    TEST__BOT_MESSAGE_ID = (await res.json()).id;
    expect(TEST__BOT_MESSAGE_ID).toBeString();
  });

  it("正常 :: 編集", async () => {
    const res = await FETCH({
      path: "/ext/message/edit",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        targetMessageId: TEST__BOT_MESSAGE_ID,
        message: "edited by bot",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j.id).toBe(TEST__BOT_MESSAGE_ID);
    expect(j.content).toBe("edited by bot");
    expect(j.isEdited).toBeTrue();
  });

  it("正常 :: GETで永続化確認", async () => {
    const res = await FETCH({
      path: `/ext/message/${TEST__BOT_MESSAGE_ID}`,
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j.content).toBe("edited by bot");
  });

  it("同一内容", async () => {
    const res = await FETCH({
      path: "/ext/message/edit",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        targetMessageId: TEST__BOT_MESSAGE_ID,
        message: "edited by bot",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message is already same");
  });

  it("他人のメッセージ", async () => {
    const res = await FETCH({
      path: "/ext/message/edit",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        targetMessageId: "TESTMESSAGE1",
        message: "hijack",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("You are not sender of this message");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/ext/message/edit",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        targetMessageId: "TESTMESSAGE999",
        message: "ghost edit",
      },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Message not found");
  });
});

describe("DELETE /ext/message/delete", () => {
  let TEST__BOT_MESSAGE_ID = "";
  it("正常 :: 送信", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "delete me" },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    TEST__BOT_MESSAGE_ID = (await res.json()).id;
    expect(TEST__BOT_MESSAGE_ID).toBeString();
  });

  it("正常 :: 削除", async () => {
    const res = await FETCH({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { targetMessageId: TEST__BOT_MESSAGE_ID },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(j.id).toBe(TEST__BOT_MESSAGE_ID);
    expect(j.channelId).toBe("TESTCHANNEL1");
  });

  it("正常 :: GETで削除確認", async () => {
    const res = await FETCH({
      path: `/ext/message/${TEST__BOT_MESSAGE_ID}`,
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(404);
  });

  it("他人のメッセージ", async () => {
    const res = await FETCH({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { targetMessageId: "TESTMESSAGE1" },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("You are not sender of this message");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { targetMessageId: "TESTMESSAGE999" },
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Message not found");
  });
});

describe("全透過Bot(useAllChannel)", () => {
  beforeAll(async () => {
    // TESTBOT2 は既定で権限フラグを持たないため、全透過 + 読み書き許可を一時的に付与する
    await db
      .update(botManages)
      .set({ useAllChannel: true, canReadMessage: true, canSendMessage: true })
      .where(eq(botManages.id, "TESTBOT2"));
  });

  afterAll(async () => {
    await db
      .update(botManages)
      .set({
        useAllChannel: false,
        canReadMessage: false,
        canSendMessage: false,
      })
      .where(eq(botManages.id, "TESTBOT2"));
  });

  it("チャンネル許可が無くても全チャンネルのメッセージを取得できる", async () => {
    // TESTBOT2 は botChannelPermissions に行を持たない
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE2",
      method: "GET",
      headers: { authorization: "TESTTOKEN2" },
      excludeCredential: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("TESTMESSAGE2");
  });

  it("非透過Botは許可の無いチャンネルのメッセージを取得できない", async () => {
    // TESTBOT1 は TESTCHANNEL1 のみ許可
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE2",
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });
    expect(res.status).toBe(404);
  });

  it("全透過Botはチャンネル許可が無くても送信できる", async () => {
    const res = await FETCH({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL2", message: "useAllChannel send" },
      headers: { authorization: "TESTTOKEN2" },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.channelId).toBe("TESTCHANNEL2");
    expect(j.userId).toBe("TESTUSER_BOT_2");
  });
});

describe("無効化されたBotの拒否", () => {
  const getAsTestBot1 = () =>
    FETCH({
      path: "/ext/message/TESTMESSAGE1",
      method: "GET",
      headers: { authorization: "TESTTOKEN1" },
      excludeCredential: true,
    });

  const setBotUserFlag = (flag: "isBanned" | "isDeleted", value: boolean) =>
    db
      .update(users)
      .set({ [flag]: value })
      .where(eq(users.id, "TESTUSER_BOT_1"));

  // BANと論理削除は同じ拒否経路のため同一ケースを共有する
  for (const flag of ["isBanned", "isDeleted"] as const) {
    it(`${flag} のBotは401で拒否され、解除で復帰する`, async () => {
      try {
        await setBotUserFlag(flag, true);
        const res = await getAsTestBot1();
        expect(res.status).toBe(401);
        expect(await res.text()).toBe("This bot is disabled");
      } finally {
        await setBotUserFlag(flag, false);
      }

      const res = await getAsTestBot1();
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe("TESTMESSAGE1");
    });
  }
});
