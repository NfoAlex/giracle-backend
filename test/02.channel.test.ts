import { beforeAll, describe, expect, it } from "bun:test";
import { FETCH, INIT } from "./util";

beforeAll(async () => {
  await INIT();
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
    const channelOne = j.data.find((channel: { id: string; }) => channel.id === "TESTCHANNEL1");
    const channelTwo = j.data.find((channel: { id: string; }) => channel.id === "TESTCHANNEL2");
    const channelThree = j.data.find((channel: { id: string; }) => channel.id === "TESTCHANNEL3");
    expect(channelOne?.id).toBe("TESTCHANNEL1");
    expect(channelOne?.name).toBe("General");
    expect(channelTwo?.id).toBe("TESTCHANNEL2");
    expect(channelTwo?.name).toBe("Random");
    expect(channelThree?.id).toBe("TESTCHANNEL3");
    expect(channelThree?.name).toBe("Private Channel");
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
    const channelOne = j.data.find((channel: { id: string; }) => channel.id === "TESTCHANNEL1");
    const channelTwo = j.data.find((channel: { id: string; }) => channel.id === "TESTCHANNEL2");
    expect(channelOne?.id).toBe("TESTCHANNEL1");
    expect(channelOne?.name).toBe("General");
    expect(channelTwo?.id).toBe("TESTCHANNEL2");
    expect(channelTwo?.name).toBe("Random");
  });
});

describe("/channel/get-history/:channelId", async () => {
  //firstMessageOfChannel/latestMessageOfChannelの判定を検証するため、
  //TESTCHANNEL1に既存のTESTMESSAGE1(最古)へ加えて新規メッセージを2件追加投入しておく
  let TEST__HISTORY_MSG_A = "";
  let TEST__HISTORY_MSG_B = "";

  it("準備 :: 検証用メッセージを2件追加投入", async () => {
    const resA = await FETCH({
      path: "/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "history test message A" },
    });
    const jA = await resA.json();
    expect(resA.ok).toBe(true);
    TEST__HISTORY_MSG_A = jA.data.id;

    const resB = await FETCH({
      path: "/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "history test message B" },
    });
    const jB = await resB.json();
    expect(resB.ok).toBe(true);
    TEST__HISTORY_MSG_B = jB.data.id;
  });

  it("正常", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.history).toBeArray();
    expect(j.data.history.length).toBeGreaterThan(0);
    expect(j.data.history[0].channelId).toBe("TESTCHANNEL1");
  });

  it("正常 :: 基準指定無し(fetchDirection省略=older扱い) :: 最新まで取得済みでlatestMessageOfChannelと一致しatEnd=true", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.history[0].id).toBe(TEST__HISTORY_MSG_B);
    expect(j.data.atEnd).toBeTrue();
    expect(j.data.atTop).toBeTrue();
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
    // TESTMESSAGE1(最古)基準のolder取得なので、latestMessageOfChannel(MSG_B)とは一致せずatEnd=false
    expect(j.data.atEnd).toBeFalse();
    expect(j.data.atTop).toBeTrue();
  });

  it("正常 :: 最新メッセージ基準でolder方向 :: latestMessageOfChannelと一致しatEnd=true", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageIdFrom: TEST__HISTORY_MSG_B,
        fetchDirection: "older",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.history[0].id).toBe(TEST__HISTORY_MSG_B);
    expect(j.data.atEnd).toBeTrue();
  });

  it("正常 :: 最古メッセージ基準でnewer方向 :: firstMessageOfChannelと一致しatTop=true", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageIdFrom: "TESTMESSAGE1",
        fetchDirection: "newer",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // 最古のTESTMESSAGE1以降を新しい方向へ辿ると全件(TESTMESSAGE1, MSG_A, MSG_B)取得できる
    expect(j.data.history.at(-1).id).toBe("TESTMESSAGE1");
    expect(j.data.atTop).toBeTrue();
  });

  it("正常 :: 最新メッセージ基準でnewer方向 :: firstMessageOfChannelと不一致でatTop=false", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageIdFrom: TEST__HISTORY_MSG_B,
        fetchDirection: "newer",
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.history.length).toBe(1);
    expect(j.data.history[0].id).toBe(TEST__HISTORY_MSG_B);
    expect(j.data.atTop).toBeFalse();
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

  it("権限がないチャンネルを取得しようとする with CompletePrivate", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL4",
      method: "POST",
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
        channelId: "TESTCHANNEL4",
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
        channelId: "TESTCHANNEL4",
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
