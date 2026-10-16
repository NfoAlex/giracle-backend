import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { ext } from "../src/components/Ext/ext.module";
import { botManages, channelJoins, messages, users } from "../src/db/schema";
import { Util } from "../src/Util";
import { extWsHandler } from "../src/ws.ext";
import { INIT } from "./util";

//ext.module は index.ts の app に未登録のため、テスト内で単体マウントする
const botApp = new Elysia().use(ext);

/**
 * Botとしてリクエストを送るためのFETCHクライアント。
 * 認証はCookieではなく `authorization` ヘッダにtokenCodeを載せる点が FETCH と異なる。
 */
async function FETCHBOT({
  path,
  method,
  body,
  token = "BOTMANAGETOKEN",
}: {
  path: `/${string}`;
  method: "GET" | "POST" | "PUT" | "DELETE";
  // biome-ignore lint/suspicious/noExplicitAny: for test
  body?: any;
  token?: string | null;
}): Promise<Response> {
  return await botApp.handle(
    new Request(`http://localhost${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { authorization: token }),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** テストBotの承認状態を切り替える */
async function setBotApproved(isApproved: boolean) {
  await db
    .update(botManages)
    .set({ isApproved })
    .where(eq(botManages.id, "BOTMANAGE"));
}

beforeAll(async () => {
  await INIT();
  await setBotApproved(true);
  //BOTMANAGETOKEN の持ち主(BOTUSER)を送信先チャンネルへ参加させる
  await db
    .insert(channelJoins)
    .values({ userId: "BOTUSER", channelId: "TESTCHANNEL1" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(messages).where(eq(messages.userId, "BOTUSER"));
  await db.delete(channelJoins).where(eq(channelJoins.userId, "BOTUSER"));
});

describe("/ext/message/send", async () => {
  it("サーバーでBotが無効化されている", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "Hello from bot" },
    });
    expect(res.ok).toBeFalse();
    const t = await res.text();
    expect(t).toBe("Bot is not enabled on this server");
    GIRACLE_SERVER_CONFIG.BotEnabled = true;
  });

  it("未承認のBot", async () => {
    await setBotApproved(false);
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "unapproved" },
    });
    await setBotApproved(true);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Bot is not approved yet");
  });

  it("作成者がBANされたBot", async () => {
    await db
      .update(users)
      .set({ isBanned: true })
      .where(eq(users.id, "TESTUSER"));
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "banned creator" },
    });
    await db
      .update(users)
      .set({ isBanned: false })
      .where(eq(users.id, "TESTUSER"));

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("This bot is disabled");
  });

  it("正常 :: Bot名義でメッセージが保存される", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "Hello from bot" },
    });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(j.message).toBe("Sent message");
    expect(j.data.messageSaved.content).toBe("Hello from bot");
    expect(j.data.messageSaved.channelId).toBe("TESTCHANNEL1");
    //CheckBotToken が解決した remoteUserId(BOTUSER)名義になる
    expect(j.data.messageSaved.userId).toBe("BOTUSER");
    expect(j.data.messageReplyingTo).toBeUndefined();
  });

  it("正常 :: 返信先メッセージを指定して送信", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "reply from bot",
        replyingMessageId: "TESTMESSAGE1",
      },
    });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(j.data.messageSaved.replyingMessageId).toBe("TESTMESSAGE1");
    expect(j.data.messageReplyingTo.id).toBe("TESTMESSAGE1");
  });

  it("空白のみのメッセージ", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "   \n " },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message is empty");
  });

  it("Botが未参加のチャンネルへ送信", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL2", message: "not joined" },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("You are not joined this channel");
  });

  it("存在しないメッセージへの返信", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "reply",
        replyingMessageId: "TESTMESSAGE999",
      },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Replying message not found");
  });

  it("別チャンネルのメッセージへの返信", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "cross channel reply",
        //TESTMESSAGE2 は TESTCHANNEL2 に存在する
        replyingMessageId: "TESTMESSAGE2",
      },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Replying message not found in this channel");
  });

  it("未知のtokenCode", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      token: "NOT_EXIST_TOKEN",
      body: { channelId: "TESTCHANNEL1", message: "hi" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("authorizationヘッダ無し", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      token: null,
      body: { channelId: "TESTCHANNEL1", message: "hi" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("channelIdが空", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/send",
      method: "POST",
      body: { channelId: "", message: "hi" },
    });

    expect(res.status).toBe(422);
  });
});

describe("ext WS close", () => {
  //close 時に Bot 行が消えている(削除直後等)ケースを模擬するダミーWS
  function fakeWs(raw: object) {
    const published: unknown[] = [];
    return {
      ws: {
        data: { headers: { authorization: "DELETED_BOT_TOKEN" } },
        raw,
        send: () => {},
        close: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        publish: (_topic: string, payload: string) =>
          published.push(JSON.parse(payload)),
        // biome-ignore lint/suspicious/noExplicitAny: WSハンドラの型はElysia内部のためanyで受け取る
      } as any,
      published,
    };
  }

  it("Bot行が引けないcloseでもWSインスタンスが残留しない", async () => {
    const { ws, published } = fakeWs({ id: "RAW_EXT_CLOSE" });
    Util.wsUserInstance.add("BOTUSER", ws);

    // biome-ignore lint/suspicious/noExplicitAny: Elysiaのルートフック呼び出しのためany
    const close = (extWsHandler.routes[0].hooks as any).close;
    await close(ws);

    expect(Util.wsUserInstance.instances.has("BOTUSER")).toBe(false);
    expect(published).toContainEqual({
      signal: "user::Disconnected",
      data: "BOTUSER",
    });
  });
});
