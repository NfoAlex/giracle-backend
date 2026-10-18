import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { ext } from "../src/components/Ext/ext.module";
import {
  botManages,
  channelJoins,
  inboxes,
  messageReactions,
  messages,
  users,
} from "../src/db/schema";
import { Util } from "../src/Util";
import { extWsHandler } from "../src/ws.ext";
import { FETCH, INIT } from "./util";

//ext.module は index.ts の app に登録済みだが、RequestLogger等を挟まずルート単体で検証するため単体マウントする
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
  GIRACLE_SERVER_CONFIG.BotEnabled = true;
  await setBotApproved(true);
  //BOTMANAGETOKEN の持ち主(BOTUSER)を送信先チャンネルへ参加させる
  await db
    .insert(channelJoins)
    .values({ userId: "BOTUSER", channelId: "TESTCHANNEL1" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(inboxes).where(eq(inboxes.userId, "TESTUSER"));
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
    expect(j.content).toBe("Hello from bot");
    expect(j.channelId).toBe("TESTCHANNEL1");
    //CheckBotToken が解決した remoteUserId(BOTUSER)名義になる
    expect(j.userId).toBe("BOTUSER");
    expect(j.replyingMessageId).toBeNull();
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
    expect(j.replyingMessageId).toBe("TESTMESSAGE1");
    expect(j.replyingMessageId).toBe("TESTMESSAGE1");

    const inboxAdded = db
      .select({ messageId: inboxes.messageId })
      .from(inboxes)
      .where(eq(inboxes.messageId, j.id))
      .get();
    expect(inboxAdded?.messageId).toBe(j.id);
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

describe("/ext/message/edit", async () => {
  beforeAll(async () => {
    //編集対象はBot名義(BOTUSER)のメッセージに限られる
    await db
      .insert(messages)
      .values([
        {
          id: "BOTMESSAGE1",
          channelId: "TESTCHANNEL1",
          content: "bot message 1",
          userId: "BOTUSER",
        },
        {
          id: "BOTMESSAGE2",
          channelId: "TESTCHANNEL1",
          content: "bot message 2",
          userId: "BOTUSER",
        },
      ])
      .onConflictDoNothing();
  });

  it("サーバーでBotが無効化されている", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "edited" },
    });
    GIRACLE_SERVER_CONFIG.BotEnabled = true;

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bot is not enabled on this server");
  });

  it("未承認のBot", async () => {
    await setBotApproved(false);
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "edited" },
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
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "edited" },
    });
    await db
      .update(users)
      .set({ isBanned: false })
      .where(eq(users.id, "TESTUSER"));

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("This bot is disabled");
  });

  it("未知のtokenCode", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      token: "NOT_EXIST_TOKEN",
      body: { messageId: "BOTMESSAGE1", message: "edited" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("authorizationヘッダ無し", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      token: null,
      body: { messageId: "BOTMESSAGE1", message: "edited" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("正常 :: Bot名義のメッセージが編集される", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "bot message 1 (edited)" },
    });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(j.id).toBe("BOTMESSAGE1");
    expect(j.channelId).toBe("TESTCHANNEL1");
    expect(j.content).toBe("bot message 1 (edited)");
    expect(j.userId).toBe("BOTUSER");
    expect(j.isEdited).toBeTrue();

    //DB側も更新されている
    const saved = db
      .select({ content: messages.content, isEdited: messages.isEdited })
      .from(messages)
      .where(eq(messages.id, "BOTMESSAGE1"))
      .get();
    expect(saved?.content).toBe("bot message 1 (edited)");
    expect(saved?.isEdited).toBeTrue();
  });

  it("内容が同じ", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "bot message 1 (edited)" },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message is already same");
  });

  it("空白のみのメッセージ", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "BOTMESSAGE1", message: "   \n " },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message is empty");
  });

  it("Bot名義でないメッセージの編集", async () => {
    //TESTMESSAGE2 は TESTUSER 名義なので、BotのremoteUserIdとは一致しない
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "TESTMESSAGE2", message: "hijack" },
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("You are not sender of this message");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "TESTMESSAGE999", message: "edited" },
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Message not found");
  });

  it("messageIdが空", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/edit",
      method: "POST",
      body: { messageId: "", message: "edited" },
    });

    expect(res.status).toBe(422);
  });
});

describe("/ext/message/delete", async () => {
  beforeAll(async () => {
    //削除対象はBot名義(BOTUSER)のメッセージに限られる
    await db
      .insert(messages)
      .values({
        id: "BOTMESSAGEDEL",
        channelId: "TESTCHANNEL1",
        content: "bot message to delete",
        userId: "BOTUSER",
      })
      .onConflictDoNothing();
    await db
      .insert(inboxes)
      .values({
        type: "message",
        messageId: "BOTMESSAGEDEL",
        userId: "TESTUSER",
      })
      .onConflictDoNothing();
    await db
      .insert(messageReactions)
      .values({
        channelId: "TESTCHANNEL1",
        userId: "TESTUSER",
        emojiCode: "👍",
        messageId: "BOTMESSAGEDEL",
      })
      .onConflictDoNothing();
  });

  it("サーバーでBotが無効化されている", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "BOTMESSAGEDEL" },
    });
    GIRACLE_SERVER_CONFIG.BotEnabled = true;

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bot is not enabled on this server");
  });

  it("未承認のBot", async () => {
    await setBotApproved(false);
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "BOTMESSAGEDEL" },
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
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "BOTMESSAGEDEL" },
    });
    await db
      .update(users)
      .set({ isBanned: false })
      .where(eq(users.id, "TESTUSER"));

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("This bot is disabled");
  });

  it("未知のtokenCode", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      token: "NOT_EXIST_TOKEN",
      body: { messageId: "BOTMESSAGEDEL" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("authorizationヘッダ無し", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      token: null,
      body: { messageId: "BOTMESSAGEDEL" },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "TESTMESSAGE999" },
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Message not found");
  });

  it("Bot名義でないメッセージの削除", async () => {
    //TESTMESSAGE2 は TESTUSER 名義なのでBotには削除できない
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "TESTMESSAGE2" },
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("You are not owner of this message");
  });

  it("正常 :: Bot名義のメッセージと関連データが削除される", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "BOTMESSAGEDEL" },
    });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(j.id).toBe("BOTMESSAGEDEL");
    expect(j.channelId).toBe("TESTCHANNEL1");

    //メッセージ本体と関連データ(通知/リアクション)が消えている
    expect(
      db.select().from(messages).where(eq(messages.id, "BOTMESSAGEDEL")).get(),
    ).toBeUndefined();
    expect(
      db
        .select()
        .from(inboxes)
        .where(eq(inboxes.messageId, "BOTMESSAGEDEL"))
        .get(),
    ).toBeUndefined();
    expect(
      db
        .select()
        .from(messageReactions)
        .where(eq(messageReactions.messageId, "BOTMESSAGEDEL"))
        .get(),
    ).toBeUndefined();
  });

  it("messageIdが空", async () => {
    const res = await FETCHBOT({
      path: "/ext/message/delete",
      method: "DELETE",
      body: { messageId: "" },
    });

    expect(res.status).toBe(422);
  });
});

describe("/ext/user/:userId", () => {
  it("未知のtokenCode", async () => {
    const res = await FETCHBOT({
      path: "/ext/user/TESTUSER",
      method: "GET",
      token: "NOT_EXIST_TOKEN",
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("authorizationヘッダ無し", async () => {
    const res = await FETCHBOT({
      path: "/ext/user/TESTUSER",
      method: "GET",
      token: null,
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid token");
  });

  it("存在しないユーザー", async () => {
    const res = await FETCHBOT({
      path: "/ext/user/NOTEXISTUSER999",
      method: "GET",
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("User not found");
  });

  it("正常 :: ユーザー情報が取得できる", async () => {
    const res = await FETCHBOT({ path: "/ext/user/TESTUSER", method: "GET" });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(j.id).toBe("TESTUSER");
    expect(j.name).toBe("testsystemuser");
  });

  it("正常 :: Botが参加していないチャンネルはChannelJoinから除外される", async () => {
    //TESTUSER は TESTCHANNEL1/2 に参加しているが、BOTUSER は TESTCHANNEL1 のみ
    const res = await FETCHBOT({ path: "/ext/user/TESTUSER", method: "GET" });
    const j = await res.json();

    expect(res.ok).toBe(true);
    expect(
      j.ChannelJoin.map((c: { channelId: string }) => c.channelId),
    ).toEqual(["TESTCHANNEL1"]);
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

describe("ext WS open", () => {
  //biome-ignore lint/suspicious/noExplicitAny: Elysiaのルートフック呼び出しのためany
  const getOpen = () => (extWsHandler.routes[0].hooks as any).open;

  function fakeOpenWs(token?: string) {
    const sent: { signal: string; data: string }[] = [];
    const subscribed: string[] = [];
    let closed = false;
    return {
      ws: {
        data: { headers: token === undefined ? {} : { authorization: token } },
        raw: { id: `RAW_EXT_OPEN_${Math.random()}` },
        send: (payload: string | { signal: string; data: string }) =>
          sent.push(
            typeof payload === "string" ? JSON.parse(payload) : payload,
          ),
        close: () => {
          closed = true;
        },
        subscribe: (topic: string) => subscribed.push(topic),
        unsubscribe: () => {},
        publish: () => {},
        //biome-ignore lint/suspicious/noExplicitAny: WSハンドラの型はElysia内部のためanyで受け取る
      } as any,
      sent,
      subscribed,
      isClosed: () => closed,
    };
  }

  it("authorizationヘッダ無しは接続しない", async () => {
    const { ws, sent, isClosed } = fakeOpenWs();

    await getOpen()(ws);

    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "Bot token not valid",
    });
    expect(isClosed()).toBeTrue();
  });

  it("未知のtokenCodeは接続しない", async () => {
    const { ws, sent, isClosed } = fakeOpenWs("NOT_EXISTING_TOKEN");

    await getOpen()(ws);

    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "Bot token not valid",
    });
    expect(isClosed()).toBeTrue();
  });

  it("未承認のBotは接続しない", async () => {
    await setBotApproved(false);
    const { ws, sent, isClosed } = fakeOpenWs("BOTMANAGETOKEN");

    try {
      await getOpen()(ws);
    } finally {
      await setBotApproved(true);
    }

    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "Your bot is not approved yet",
    });
    expect(isClosed()).toBeTrue();
  });

  it("作成者がBANされたBotは接続しない", async () => {
    await db
      .update(users)
      .set({ isBanned: true })
      .where(eq(users.id, "TESTUSER"));
    const { ws, sent, isClosed } = fakeOpenWs("BOTMANAGETOKEN");

    try {
      await getOpen()(ws);
    } finally {
      await db
        .update(users)
        .set({ isBanned: false })
        .where(eq(users.id, "TESTUSER"));
    }

    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "This bot is disabled",
    });
    expect(isClosed()).toBeTrue();
  });

  it("作成者が削除されたBotは接続しない", async () => {
    await db
      .update(users)
      .set({ isDeleted: true })
      .where(eq(users.id, "TESTUSER"));
    const { ws, sent, isClosed } = fakeOpenWs("BOTMANAGETOKEN");

    try {
      await getOpen()(ws);
    } finally {
      await db
        .update(users)
        .set({ isDeleted: false })
        .where(eq(users.id, "TESTUSER"));
    }

    expect(isClosed()).toBeTrue();
    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "User not found. This is a server side issue",
    });
  });

  it("サーバーでBotが無効化されているときは接続しない", async () => {
    GIRACLE_SERVER_CONFIG.BotEnabled = false;
    const { ws, sent, isClosed } = fakeOpenWs("BOTMANAGETOKEN");

    try {
      await getOpen()(ws);
    } finally {
      GIRACLE_SERVER_CONFIG.BotEnabled = true;
    }

    expect(sent).toContainEqual({
      signal: "ERROR",
      data: "Bot is not enabled on this server",
    });
    expect(isClosed()).toBeTrue();
  });

  it("正常 :: 購読するのはBot自身が見れるチャンネルのみ", async () => {
    const { ws, subscribed, isClosed } = fakeOpenWs("BOTMANAGETOKEN");

    try {
      await getOpen()(ws);
    } finally {
      Util.wsUserInstance.instances.delete("BOTUSER");
    }

    expect(isClosed()).toBeFalse();
    expect(subscribed).toContain("user::BOTUSER");
    //BOTUSERが参加しているチャンネルは購読される
    expect(subscribed).toContain("bot::channel::TESTCHANNEL1");
    //作成者(TESTUSER)だけが見れる非公開チャンネルは購読しない
    expect(subscribed).not.toContain("bot::channel::TESTCHANNEL3");
    expect(subscribed).not.toContain("bot::channel::TESTCHANNEL4");
  });

  it("BotEnabledを無効化すると接続中のBotも切れる", async () => {
    const { ws, isClosed } = fakeOpenWs("BOTMANAGETOKEN");
    Util.wsUserInstance.add("BOTUSER", ws);

    const res = await FETCH({
      path: "/server/change-config",
      method: "POST",
      body: { BotEnabled: false },
      useAdminUser: true,
    });

    try {
      expect(res.ok).toBe(true);
      expect(Util.wsUserInstance.instances.has("BOTUSER")).toBe(false);
      expect(isClosed()).toBeTrue();
    } finally {
      GIRACLE_SERVER_CONFIG.BotEnabled = true;
    }
  });
});
