import { beforeAll, describe, expect, it } from "bun:test";
import { PrismaClient } from "../prisma/generated/client";
import { adapter, FETCH } from "./util";

beforeAll(async () => {
  const dbTest = new PrismaClient({ adapter });
  //await dbTest.message.deleteMany({});
  //await dbTest.channel.deleteMany({});
  await dbTest.channel.createMany({
    data: [
      {
        id: "TESTCHANNEL1",
        name: "General",
        description: "General channel",
        createdUserId: "TESTUSER",
      },
      {
        id: "TESTCHANNEL2",
        name: "Random",
        description: "Random discussions",
        createdUserId: "TESTUSER",
      },
      {
        id: "TESTCHANNEL3",
        name: "Private Channel",
        description: "Private discussions",
        createdUserId: "TESTUSER",
      },
    ],
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
    },
    create: {
      id: "TESTMESSAGE2",
      channelId: "TESTCHANNEL2",
      content: "Feel free to chat here.",
      userId: "TESTUSER",
    },
    update: {},
  });
  await dbTest.message.upsert({
    where: {
      id: "TESTMESSAGE3",
    },
    create: {
      id: "TESTMESSAGE3",
      channelId: "TESTCHANNEL3",
      content: "Secret message.",
      userId: "TESTUSER",
    },
    update: {},
  });
  await dbTest.channelJoin.createMany({
    data: [
      {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL1",
      },
      {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL2",
      },
    ],
  });
  await dbTest.roleInfo.create({
    data: {
      id: "ChannelManage",
      name: "Channel Manage Role",
      createdUserId: "TESTUSER",
      manageChannel: true,
    },
  });
  await dbTest.roleLink.create({
    data: {
      userId: "TESTUSER",
      roleId: "ChannelManage",
    },
  });
  await dbTest.roleInfo.create({
    data: {
      id: "ChannelPrivateViewer",
      name: "Channel Private Viewer Role",
      createdUserId: "TESTUSER",
    },
  });
  await dbTest.roleLink.create({
    data: {
      userId: "TESTUSER",
      roleId: "ChannelPrivateViewer",
    },
  });
  await dbTest.channelViewableRole.create({
    data: {
      channelId: "TESTCHANNEL3",
      roleId: "ChannelPrivateViewer",
    },
  });
});

describe("/channel/join", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/join",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL2",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j).toEqual({
      message: "Channel joined",
      data: {
        channelId: "TESTCHANNEL2",
      },
    });
  });

  it("再参加してみる", async () => {
    const res = await FETCH({
      path: "/channel/join",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL2",
      },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(t).toBe("Already joined");
  });

  it("存在しないチャンネルに参加しようとする", async () => {
    const res = await FETCH({
      path: "/channel/join",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "NON_EXISTENT_CHANNEL",
      },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });

  it("Private Channelにロール無しで入ろうとする", async () => {
    const res = await FETCH({
      path: "/channel/join",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL3",
      },
      useSecondaryUser: true
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });
});

describe("/channel/leave", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/leave",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL2",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j).toEqual({
      message: "Channel left",
    });
  });

  it("また抜けてみる", async () => {
    const res = await FETCH({
      path: "/channel/leave",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL2",
      },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("You are not joined this channel");
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/leave",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL999",
      },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("You are not joined this channel");
  });
});

describe("/channel/get-info/:channelId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/get-info/TESTCHANNEL1",
      method: "GET",
      body: {
        userId: "TESTUSER",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("TESTCHANNEL1");
    expect(j.data.name).toBe("General");
    expect(j.data.description).toBe("General channel");
    expect(j.data.createdUserId).toBe("TESTUSER");
    expect(j.data).toContainKey("ChannelViewableRole");
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/get-info/TESTCHANNEL999",
      method: "GET",
      body: {
        userId: "TESTUSER",
      },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });

  it("プライベートチャンネルを取得しようとする", async () => {
    const res = await FETCH({
      path: "/channel/get-info/TESTCHANNEL3",
      method: "GET",
      useSecondaryUser: true
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });
});

describe("/channel/list", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/list",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(3);
    expect(j.data[0].id).toBe("TESTCHANNEL1");
    expect(j.data[0].name).toBe("General");
    expect(j.data[1].id).toBe("TESTCHANNEL2");
    expect(j.data[1].name).toBe("Random");
    expect(j.data[2].id).toBe("TESTCHANNEL3");
    expect(j.data[2].name).toBe("Private Channel");
  });

  it("正常 :: プライベートチャンネルが非表示になっていることを確認", async () => {
    const res = await FETCH({
      path: "/channel/list",
      method: "GET",
      useSecondaryUser: true
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(2);
    expect(j.data[0].id).toBe("TESTCHANNEL1");
    expect(j.data[0].name).toBe("General");
    expect(j.data[1].id).toBe("TESTCHANNEL2");
    expect(j.data[1].name).toBe("Random");
  });
});

describe("/channel/get-history/:channelId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
      },
    });
    const j = await res.json();
    console.log("j:", j);
    expect(res.ok).toBe(true);
    expect(j.data.history[0].content).toBe("Welcome to the General channel!");
  });

  it("正常 :: 違うポジションから", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageIdFrom: "TESTMESSAGE1",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.history[0].content).toBe("Welcome to the General channel!");
  });

  it("過去を取得してみる", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageTimeFrom: "2001-01-01",
        fetchDirection: "older"
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.atEnd).toBeFalse();
    expect(j.data.atTop).toBeTrue();
  });

  it("未来を取得してみる", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageTimeFrom: "2099-01-01",
        fetchDirection: "newer"
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.atEnd).toBeTrue();
    expect(j.data.atTop).toBeFalse();
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL999",
      method: "POST",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });

  it("権限がないチャンネルを取得しようとする", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL3",
      method: "POST",
      useSecondaryUser: true
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");
  });
});

describe("/channel/search", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/search/?query=Gen",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(1);
    expect(j.data[0].id).toBe("TESTCHANNEL1");
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/search/?query=123",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("クエリー無し", async () => {
    const res = await FETCH({
      path: "/channel/search",
      method: "GET",
    });
    expect(res.ok).toBe(false);
  });

  it("プライベートが非表示なのを確認 :: 二番目のユーザー", async () => {
    const res = await FETCH({
      path: "/channel/search/?query=Private",
      method: "GET",
      useSecondaryUser: true
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });
});

describe("/channel/invite", async () => {
  it("存在しないユーザー", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER999",
        channelId: "TESTCHANNEL1",
      },
    });
    const t = await res.text();
    expect(t).toBe("User not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL999",
      },
    });
    const t = await res.text();
    expect(t).toBe("You are not joined this channel or channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it("自分がいないチャンネルへ招待", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL2",
      },
    });
    const t = await res.text();
    expect(t).toBe("You are not joined this channel or channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL1",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("User invited");
  });

  it("同じチャンネルに再度招待", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL1",
      },
    });
    const t = await res.text();
    expect(t).toBe("Already joined");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("ロールを持たない人による招待", async () => {
    const res = await FETCH({
      path: "/channel/invite",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL2",
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});

describe("/channel/kick", async () => {
  it("自分をキック", async () => {
    const res = await FETCH({
      path: "/channel/kick",
      method: "POST",
      body: {
        userId: "TESTUSER",
        channelId: "TESTCHANNEL1",
      },
    });
    const t = await res.text();
    expect(t).toBe("You cannot kick yourself");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("自分が参加していないチャンネルからキック", async () => {
    const res = await FETCH({
      path: "/channel/kick",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL2",
      },
    });
    const t = await res.text();
    expect(t).toBe("You are not joined this channel");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/kick",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        channelId: "TESTCHANNEL1",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.message).toBe("User kicked");
  });
});

describe("/channel/update", async () => {
  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL999",
        name: "Updated",
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("何も渡さない", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
      },
    });
    const t = await res.text();
    expect(t).toBe("There is no data to update");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("ロール持たない人が更新", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        name: "Updated",
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it("編集ロールを持っているが閲覧できないチャンネル", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL3",
        name: "Updated",
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        name: "Updated general",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Channel updated");
    expect(j.data.name).toBe("Updated general");
    expect(res.ok).toBe(true);
  });

  it("正常 :: 一応戻す", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        name: "General",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Channel updated");
    expect(j.data.name).toBe("General");
    expect(res.ok).toBe(true);
  });
});

//作成したチャンネルをすぐ削除テストで使うためにグローバル変数で保持しておく
let TEST__NEW_CREATED_CHANNELID = "";
describe("/channel/create", async () => {
  it("名前空欄", async () => {
    const res = await FETCH({
      path: "/channel/create",
      method: "PUT",
      body: {
        channelName: "",
        description: "new created channel",
      },
    });
    expect(res.ok).toBe(false);
  });

  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/create",
      method: "PUT",
      body: {
        channelName: "new channel",
        description: "new created channel",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Channel created");
    expect(j.data).toContainKey("channelId");
    expect(res.ok).toBe(true);
    //グローバル変数に保存
    TEST__NEW_CREATED_CHANNELID = j.data.channelId;
  });
});

describe("/channel/delete", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/delete",
      method: "DELETE",
      body: {
        channelId: TEST__NEW_CREATED_CHANNELID,
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Channel deleted");
    expect(res.ok).toBe(true);
  });

  it("存在しないチャンネルを削除", async () => {
    const res = await FETCH({
      path: "/channel/delete",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("チャンネル管理ロールを持った状態で閲覧できないチャンネルを削除", async () => {
    const res = await FETCH({
      path: "/channel/delete",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL3",
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("チャンネル管理ロールを持たずにチャンネルを削除", async () => {
    const res = await FETCH({
      path: "/channel/delete",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
