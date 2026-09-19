import { beforeAll, describe, expect, it } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src";
import {
  channels,
  channelViewableRoles,
  messageFileAttached,
  messageReadTimes,
  roleLinks,
} from "../src/db/schema";
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
      useSecondaryUser: true,
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
      useSecondaryUser: true,
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
    const channelOne = j.data.find(
      (channel: { id: string }) => channel.id === "TESTCHANNEL1",
    );
    const channelTwo = j.data.find(
      (channel: { id: string }) => channel.id === "TESTCHANNEL2",
    );
    const channelThree = j.data.find(
      (channel: { id: string }) => channel.id === "TESTCHANNEL3",
    );
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
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(2);
    const channelOne = j.data.find(
      (channel: { id: string }) => channel.id === "TESTCHANNEL1",
    );
    const channelTwo = j.data.find(
      (channel: { id: string }) => channel.id === "TESTCHANNEL2",
    );
    expect(channelOne?.id).toBe("TESTCHANNEL1");
    expect(channelOne?.name).toBe("General");
    expect(channelTwo?.id).toBe("TESTCHANNEL2");
    expect(channelTwo?.name).toBe("Random");
  });
});

describe("/channel/get-history/:channelId", async () => {
  //firstMessageOfChannel/latestMessageOfChannelの判定を検証するため、
  //TESTCHANNEL1に既存のTESTMESSAGE1(最古)へ加えて新規メッセージを2件追加投入しておく
  //let TEST__HISTORY_MSG_A = "";
  let TEST__HISTORY_MSG_B = "";

  it("準備 :: 検証用メッセージを2件追加投入", async () => {
    const resA = await FETCH({
      path: "/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "history test message A" },
    });
    //const _jA = await resA.json();
    expect(resA.ok).toBe(true);
    //TEST__HISTORY_MSG_A = jA.data.id;

    const resB = await FETCH({
      path: "/message/send",
      method: "POST",
      body: { channelId: "TESTCHANNEL1", message: "history test message B" },
    });
    const jB = await resB.json();
    expect(resB.ok).toBe(true);
    TEST__HISTORY_MSG_B = jB.data.id;
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

  it("過去・未来を取得してみる", async () => {
    const resPast = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageTimeFrom: "2001-01-01",
        fetchDirection: "older",
      },
    });
    const jPast = await resPast.json();
    expect(resPast.ok).toBe(true);
    expect(jPast.data.atEnd).toBeFalse();
    expect(jPast.data.atTop).toBeTrue();

    const resFuture = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        userId: "TESTUSER",
        messageTimeFrom: "2099-01-01",
        fetchDirection: "newer",
      },
    });
    const jFuture = await resFuture.json();
    expect(resFuture.ok).toBe(true);
    expect(jFuture.data.atEnd).toBeTrue();
    expect(jFuture.data.atTop).toBeFalse();
  });

  it("fetchLengthに0以下を渡すとバリデーションエラー", async () => {
    //負値でLIMITが無効化され全件取得されるのを防ぐminimum:1の確認
    const resZero = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        fetchLength: 0,
      },
    });
    expect(resZero.ok).toBe(false);

    const resNegative = await FETCH({
      path: "/channel/get-history/TESTCHANNEL1",
      method: "POST",
      body: {
        fetchLength: -5,
      },
    });
    expect(resNegative.ok).toBe(false);
  });

  it("権限がないチャンネルを取得しようとする", async () => {
    const res = await FETCH({
      path: "/channel/get-history/TESTCHANNEL3",
      method: "POST",
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("Channel not found");

    // CompletePrivateなチャンネルも同様に見えない
    const resPrivate = await FETCH({
      path: "/channel/get-history/TESTCHANNEL4",
      method: "POST",
    });
    const tPrivate = await resPrivate.text();
    expect(resPrivate.ok).toBe(false);
    expect(resPrivate.status).toBe(404);
    expect(tPrivate).toBe("Channel not found");
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

  it("クエリー無し", async () => {
    const res = await FETCH({
      path: "/channel/search",
      method: "GET",
    });
    expect(res.ok).toBe(false);
  });

  it("クエリー空文字", async () => {
    //空文字を許すとLIKE '%%'になり可視チャンネル全件が返ってしまう
    const res = await FETCH({
      path: "/channel/search/?query=",
      method: "GET",
    });
    expect(res.ok).toBe(false);
  });

  it("クエリー長すぎ", async () => {
    const res = await FETCH({
      path: `/channel/search/?query=${"a".repeat(101)}`,
      method: "GET",
    });
    expect(res.ok).toBe(false);
  });

  it("ワイルドカード文字(%)がリテラル扱いされる", async () => {
    //エスケープ無しだとLIKE時代の`%%%`は全チャンネルにマッチしていた
    const res = await FETCH({
      path: "/channel/search/?query=%25",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("前方一致で検索する", async () => {
    //部分一致(以前のLIKE '%query%')だと"eneral"が"General"にヒットしていた
    const res = await FETCH({
      path: "/channel/search/?query=eneral",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("正常 :: name順で返る", async () => {
    await db.insert(channels).values([
      {
        id: "TESTCHANNEL_CURSOR_B",
        name: "CursorChan B",
        description: "",
        createdUserId: "TESTUSER",
      },
      {
        id: "TESTCHANNEL_CURSOR_A",
        name: "CursorChan A",
        description: "",
        createdUserId: "TESTUSER",
      },
    ]);
    try {
      const res = await FETCH({
        path: "/channel/search/?query=CursorChan",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.map((c: { id: string }) => c.id)).toEqual([
        "TESTCHANNEL_CURSOR_A",
        "TESTCHANNEL_CURSOR_B",
      ]);
    } finally {
      await db
        .delete(channels)
        .where(
          inArray(channels.id, [
            "TESTCHANNEL_CURSOR_A",
            "TESTCHANNEL_CURSOR_B",
          ]),
        );
    }
  });

  it("正常 :: cursorChannelId指定でカーソルより後のみ返る", async () => {
    await db.insert(channels).values([
      {
        id: "TESTCHANNEL_CURSOR_A",
        name: "CursorChan A",
        description: "",
        createdUserId: "TESTUSER",
      },
      {
        id: "TESTCHANNEL_CURSOR_B",
        name: "CursorChan B",
        description: "",
        createdUserId: "TESTUSER",
      },
      {
        id: "TESTCHANNEL_CURSOR_C",
        name: "CursorChan C",
        description: "",
        createdUserId: "TESTUSER",
      },
    ]);
    try {
      const res = await FETCH({
        path: "/channel/search/?query=CursorChan&cursorChannelId=TESTCHANNEL_CURSOR_B",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.map((c: { id: string }) => c.id)).toEqual([
        "TESTCHANNEL_CURSOR_C",
      ]);
    } finally {
      await db
        .delete(channels)
        .where(
          inArray(channels.id, [
            "TESTCHANNEL_CURSOR_A",
            "TESTCHANNEL_CURSOR_B",
            "TESTCHANNEL_CURSOR_C",
          ]),
        );
    }
  });

  it("異常 :: 存在しないcursorChannelIdは400", async () => {
    const res = await FETCH({
      path: "/channel/search/?query=Gen&cursorChannelId=garbage",
      method: "GET",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Cursor channel does not exists");
  });

  it("ワイルドカード文字(*,?,[,])がリテラル扱いされる", async () => {
    //エスケープ無しだと`*`/`?`が全チャンネルにマッチしてしまう
    for (const query of ["*", "?", "[", "]"]) {
      const res = await FETCH({
        path: `/channel/search/?query=${encodeURIComponent(query)}`,
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.length).toBe(0);
    }
  });

  it("プライベートが非表示なのを確認 :: 二番目のユーザー", async () => {
    const res = await FETCH({
      path: "/channel/search/?query=Private",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("正常 :: 自分が作成した閲覧制限チャンネルが見える", async () => {
    //TESTUSER2作成・閲覧ロールはTESTUSERのみのチャンネルを用意する
    await db.insert(channels).values({
      id: "TESTCHANNEL_CREATOR",
      name: "CreatorOnly Room",
      description: "Created by TESTUSER2",
      createdUserId: "TESTUSER2",
    });
    await db.insert(channelViewableRoles).values({
      channelId: "TESTCHANNEL_CREATOR",
      roleId: "ChannelPrivateViewer",
    });
    try {
      //search/get-info/listで可視集合が揃っていることを確認する
      const res = await FETCH({
        path: "/channel/search/?query=CreatorOnly",
        method: "GET",
        useSecondaryUser: true,
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.map((c: { id: string }) => c.id)).toEqual([
        "TESTCHANNEL_CREATOR",
      ]);
      //同じチャンネルがget-infoでも取得できる(以前は404で不一致だった)
      const info = await FETCH({
        path: "/channel/get-info/TESTCHANNEL_CREATOR",
        method: "GET",
        useSecondaryUser: true,
      });
      expect(info.status).toBe(200);

      const list = await FETCH({
        path: "/channel/list",
        method: "GET",
        useSecondaryUser: true,
      });
      const jList = await list.json();
      expect(jList.data.map((c: { id: string }) => c.id)).toContain(
        "TESTCHANNEL_CREATOR",
      );
    } finally {
      await db.delete(channels).where(eq(channels.id, "TESTCHANNEL_CREATOR"));
    }
  });

  it("正常 :: サーバー管理者は閲覧制限チャンネルも検索できる", async () => {
    //TESTUSERへ一時的にHOST(manageServer)を付与し、List/Searchの可視集合が管理権限で広がることを確認する
    await db.insert(roleLinks).values({ userId: "TESTUSER", roleId: "HOST" });
    try {
      const res = await FETCH({
        path: "/channel/search/?query=Private",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.map((c: { id: string }) => c.id)).toContain("TESTCHANNEL4");

      const list = await FETCH({ path: "/channel/list", method: "GET" });
      const jList = await list.json();
      expect(jList.data.map((c: { id: string }) => c.id)).toContain(
        "TESTCHANNEL4",
      );
    } finally {
      await db
        .delete(roleLinks)
        .where(
          and(eq(roleLinks.userId, "TESTUSER"), eq(roleLinks.roleId, "HOST")),
        );
    }
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
    //Kick時に既読時間データも削除される(Leaveと対称)ことを確認するため事前投入
    await db
      .insert(messageReadTimes)
      .values({
        channelId: "TESTCHANNEL1",
        userId: "TESTUSER2",
        readTime: new Date(),
      })
      .onConflictDoNothing();

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

    //既読時間データが残っていないことを確認
    const readTimesLeft = await db
      .select()
      .from(messageReadTimes)
      .where(
        and(
          eq(messageReadTimes.channelId, "TESTCHANNEL1"),
          eq(messageReadTimes.userId, "TESTUSER2"),
        ),
      );
    expect(readTimesLeft.length).toBe(0);
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

    // 後続テストのため名前を戻す
    const resRestore = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        name: "General",
      },
    });
    const jRestore = await resRestore.json();
    expect(jRestore.message).toBe("Channel updated");
    expect(jRestore.data.name).toBe("General");
    expect(resRestore.ok).toBe(true);
  });

  it("正常 :: viewableRoleが指定した全件に置換される(既存ロールが消えない)", async () => {
    //旧実装では既存分(ChannelPrivateViewer)が差分計算で消えてしまうバグがあった
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL3",
        viewableRole: ["ChannelPrivateViewer", "ChannelManage"],
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    const roleIds = j.data.ChannelViewableRole.map(
      (r: { roleId: string }) => r.roleId,
    ).sort();
    expect(roleIds).toEqual(["ChannelManage", "ChannelPrivateViewer"]);
  });

  it("正常 :: viewableRoleを元に戻す", async () => {
    const res = await FETCH({
      path: "/channel/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL3",
        viewableRole: ["ChannelPrivateViewer"],
      },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.ChannelViewableRole.length).toBe(1);
    expect(j.data.ChannelViewableRole[0].roleId).toBe("ChannelPrivateViewer");
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
    //削除時に関連データも消えることを確認するため事前投入
    await db.insert(messageReadTimes).values({
      channelId: TEST__NEW_CREATED_CHANNELID,
      userId: "TESTUSER",
      readTime: new Date(),
    });
    await db.insert(channelViewableRoles).values({
      channelId: TEST__NEW_CREATED_CHANNELID,
      roleId: "ChannelPrivateViewer",
    });
    await db.insert(messageFileAttached).values({
      channelId: TEST__NEW_CREATED_CHANNELID,
      userId: "TESTUSER",
      actualFileName: "orphan-check.png",
      savedFileName: "orphan-check.png",
      size: 1,
      type: "image/png",
    });

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

    //既読時間・閲覧ロール・添付ファイル情報が孤児として残っていないことを確認
    const readTimesLeft = await db
      .select()
      .from(messageReadTimes)
      .where(eq(messageReadTimes.channelId, TEST__NEW_CREATED_CHANNELID));
    expect(readTimesLeft.length).toBe(0);
    const viewableRolesLeft = await db
      .select()
      .from(channelViewableRoles)
      .where(eq(channelViewableRoles.channelId, TEST__NEW_CREATED_CHANNELID));
    expect(viewableRolesLeft.length).toBe(0);
    const filesLeft = await db
      .select()
      .from(messageFileAttached)
      .where(eq(messageFileAttached.channelId, TEST__NEW_CREATED_CHANNELID));
    expect(filesLeft.length).toBe(0);
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
