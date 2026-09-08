import { beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src";
import { inboxes } from "../src/db/schema";
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
