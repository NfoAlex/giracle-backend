import { beforeAll, describe, expect, it } from "bun:test";
import { PrismaClient } from "../prisma/generated/client";
import { adapter, FETCH } from "./util";

beforeAll(async () => {
  const dbTest = new PrismaClient({ adapter });

  await dbTest.messageReadTime.deleteMany({});
  await dbTest.messageReaction.deleteMany({});
  await dbTest.message.deleteMany({
    where: {
      channelId: "TESTCHANNEL1",
      id: {
        not: "TESTMESSAGE1",
      },
    },
  });

  await dbTest.message.upsert({
    where: {
      id: "TESTMESSAGE1",
    },
    create: {
      id: "TESTMESSAGE1",
      channelId: "TESTCHANNEL1",
      content: "Welcome to the General channel!",
      userId: "TESTUSER",
    },
    update: {},
  });
  await dbTest.message.upsert({
    where: {
      id: "TESTMESSAGE2",
      userId: "TESTUSER",
      content: "Feel free to chat here.",
    },
    create: {
      id: "TESTMESSAGE2",
      channelId: "TESTCHANNEL1",
      content: "Feel free to chat here.",
      userId: "TESTUSER",
    },
    update: {},
  });

  //第１ユーザーのみ見れるチャンネルを作るために整備
  await dbTest.roleInfo.upsert({
    where: {
      id: "CHANNELVIEWABLEROLE1",
    },
    create: {
      id: "CHANNELVIEWABLEROLE1",
      name: "channelviewablerole1",
      createdUserId: "SYSTEM",
    },
    update: {},
  });
  await dbTest.channelViewableRole.upsert({
    where: {
      channelId_roleId: {
        channelId: "TESTCHANNEL1",
        roleId: "CHANNELVIEWABLEROLE1",
      },
    },
    create: {
      channelId: "TESTCHANNEL1",
      roleId: "CHANNELVIEWABLEROLE1",
    },
    update: {},
  });
  await dbTest.roleLink.upsert({
    where: {
      userId_roleId: {
        userId: "TESTUSER",
        roleId: "CHANNELVIEWABLEROLE1",
      },
    },
    create: {
      userId: "TESTUSER",
      roleId: "CHANNELVIEWABLEROLE1",
    },
    update: {},
  });

  //通知検証用のInbox作成(２つ)
  await dbTest.inbox.upsert({
    where: {
      messageId_userId: {
        messageId: "TESTMESSAGE1",
        userId: "TESTUSER",
      },
    },
    create: {
      type: "message",
      messageId: "TESTMESSAGE1",
      userId: "TESTUSER",
    },
    update: {},
  });
  await dbTest.inbox.upsert({
    where: {
      messageId_userId: {
        messageId: "TESTMESSAGE1",
        userId: "TESTUSER2",
      },
    },
    create: {
      type: "message",
      messageId: "TESTMESSAGE1",
      userId: "TESTUSER2",
    },
    update: {},
  });
});

describe("/message/:messageId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE1",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.id).toBe("TESTMESSAGE1");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE999",
      method: "GET",
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });

  it("見れないユーザーからの取得", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE1",
      method: "GET",
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

//ここではまだ既読時間が無いため、すべて未読扱いになるはず
describe("/message/get-new :: 既読時間無し", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
    });
    const j = await res.json();
    console.log("/message/get-new :: j->", j);
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL1).toBeFalse();
  });

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL2).toBeFalse();
  });
});

describe("/message/read-time/update", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        readTime: new Date("2000-01-01T00:00:00Z"),
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Updated read time");
    expect(j.data.channelId).toBe("TESTCHANNEL1");
  });

  it("さらに過去に設定してみる", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        readTime: new Date("1999-01-01T00:00:00Z"),
      },
    });
    const t = await res.text();
    expect(t).toBe("Read time is already newer");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL999",
        readTime: new Date("2000-01-01T00:00:00Z"),
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/get-new :: 既読時間アリ", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
    });
    const j = await res.json();
    console.log("/message/get-new :: j->", j);
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL1).toBeTrue();
  });

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL2).toBeFalse();
  });
});

describe("/message/search", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/search?content=free",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
  });

  it("正常 :: 全探索", async () => {
    const res = await FETCH({
      path: "/message/search",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(5);
  });

  it("正常 :: 単一チャンネル", async () => {
    const res = await FETCH({
      path: "/message/search?channelId=TESTCHANNEL1",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
  });

  it("見れないユーザーからの検索", async () => {
    const res = await FETCH({
      path: "/message/search?channelId=TESTCHANNEL1",
      method: "GET",
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("You are not allowed to view this channel");
    expect(res.status).toBe(403);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/file/upload", async () => {
  it("存在しないファイル", async () => {
    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: {
        file: undefined,
      },
    });
    const t = await res.text();
    expect(t).toBe("somethin went wrong :(");
    expect(res.status).toBe(500);
    expect(res.ok).toBeFalse();
  });
});

// /message/file/:dileId
// /message/file/delete

describe("/message/inbox", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched inbox");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
    expect(j.data[0].messageId).toBe("TESTMESSAGE1");
  });
});

describe("/message/inbox/read", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox/read",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE1",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Inbox read");
    expect(j.data).toBe("TESTMESSAGE1");
  });

  it("存在しないメッセージId", async () => {
    const res = await FETCH({
      path: "/message/inbox/read",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Inbox not found");
  });
});

describe("/inbox/clear", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox/clear",
      method: "POST",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Inbox cleared");
  });
});

describe("/message/emoji-reaction", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message reacted.");
    expect(j.data.emojiCode).toBe("robot");
  });

  it("見れないメッセージへのリアクション", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
  });

  it("同じメッセに同じリアクション", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("You already reacted this message");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE999",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/who-reacted", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE1&emojiCode=robot",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched reactions");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
    expect(j.data[0]).toBe("TESTUSER");
  });

  it("ついていないリアクション", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE1&emojiCode=smile",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched reactions");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(0);
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE999&emojiCode=robot",
      method: "GET",
    });
    const t = await res.text();
    expect(t).toBe("Message not found or is private");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/delete-emoji-reaction", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Reaction deleted");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("messageId");
    expect(j.data).toContainKey("emojiCode");
    expect(j.data.emojiCode).toBe("robot");
  });

  it("同じリアクションを消そうとしてみる（存在しない）", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Reaction does not exists");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE999",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
  });
});

let TEST__MESSAGE_ID = "";
describe("/message/send", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Hello, world!",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("content");
    expect(j.data.content).toBe("Hello, world!");
    TEST__MESSAGE_ID = j.data.id;
  });

  it("存在しないメッセージへの返信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Hello, world!",
        replyingMessageId: "TESTMESSAGE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Replying message not found");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("空白のみ送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message is empty");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/edit", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "Hello, world! (edited)",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message edited");
    expect(j.data).toContainKey("id");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("content");
    expect(j.data.content).toBe("Hello, world! (edited)");
    expect(j.data.isEdited).toBeTrue();
  });

  it("空白にしてみる", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "",
      },
    });
    expect(res.status).toBe(500);
    expect(res.ok).toBeFalse();
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE999",
        channelId: "TESTCHANNEL1",
        message: "Try to edit non-existent message",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});
