import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../src";
import { bot as extBot } from "../src/components/Ext/ext.module";
import { channelJoins, messages } from "../src/db/schema";
import { INIT } from "./util";

//ext.module は index.ts の app に未登録のため、テスト内で単体マウントする
const botApp = new Elysia().use(extBot);

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

beforeAll(async () => {
  await INIT();
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
