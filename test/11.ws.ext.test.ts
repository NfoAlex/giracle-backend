import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
// 循環import(ws.ts→index.ts→ws.ts)のため、まず../srcを完全評価してからwsHandlerを取る
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import {
  botChannelPermissions,
  botManages,
  roleInfos,
  roleLinks,
  users,
} from "../src/db/schema";
import { wsHandler } from "../src/ws";
import { FETCH, INIT } from "./util";

describe("WS (Bot)", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    await INIT();
    // 未承認Bot(TESTBOT3)用のトークンを用意
    await db
      .update(botManages)
      .set({ tokenCode: "TESTTOKEN3" })
      .where(eq(botManages.id, "TESTBOT3"));
    // 承認API用に管理者権限を付与(07と同内容。単体実行時も叩けるよう重複時は無視する)
    await db
      .insert(roleInfos)
      .values({
        id: "GOD",
        name: "Role for testing server configs",
        createdUserId: "SYSTEM",
        manageServer: true,
      })
      .onConflictDoNothing();
    await db
      .insert(roleLinks)
      .values({ roleId: "GOD", userId: "TESTUSER" })
      .onConflictDoNothing();
    // Elysiaはupgradeをapp.server.upgrade()で行うため、listen()相当の設定が要る:
    // serve側ディスパッチャ(ws.data経由でルートハンドラへ振り分け) + app.server設定
    type WsRouteHandlers = {
      open?: (ws: Bun.ServerWebSocket<unknown>) => unknown;
      message?: (
        ws: Bun.ServerWebSocket<unknown>,
        message: string | Buffer,
      ) => unknown;
      close?: (
        ws: Bun.ServerWebSocket<unknown>,
        code: number,
        reason: string,
      ) => unknown;
    };
    const dispatch = (ws: Bun.ServerWebSocket<unknown>) =>
      ws.data as WsRouteHandlers;
    server = Bun.serve({
      port: 0,
      fetch: wsHandler.fetch,
      websocket: {
        open: (ws: Bun.ServerWebSocket<unknown>) => dispatch(ws).open?.(ws),
        message: (ws: Bun.ServerWebSocket<unknown>, message: string | Buffer) =>
          dispatch(ws).message?.(ws, message),
        close: (
          ws: Bun.ServerWebSocket<unknown>,
          code: number,
          reason: string,
        ) => dispatch(ws).close?.(ws, code, reason),
      },
    } as unknown as Parameters<typeof Bun.serve>[0]);
    wsHandler.server = server;
  });

  afterAll(() => server.stop(true));

  /** BotとしてWS接続する。resolve時点でonopen後(または切断済み) */
  const connectBot = (token: string) =>
    new Promise<{ ws: WebSocket; messages: string[]; closed: boolean }>(
      (resolve) => {
        const messages: string[] = [];
        let closed = false;
        const ws = new WebSocket(
          `ws://localhost:${server.port}/ws`,
          // biome-ignore lint/suspicious/noExplicitAny: headersはBun固有オプションで型定義が無い
          { headers: { Authorization: token } } as any,
        );
        ws.onmessage = (e: MessageEvent) => messages.push(String(e.data));
        ws.onclose = () => {
          closed = true;
          resolve({ ws, messages, closed });
        };
        ws.onopen = () =>
          setTimeout(() => resolve({ ws, messages, closed }), 50);
      },
    );

  test("承認済みBotは接続できping/pongが通る", async () => {
    const { ws, messages, closed } = await connectBot("TESTTOKEN1");
    expect(closed).toBe(false);
    ws.send(JSON.stringify({ signal: "ping", data: "ping" }));
    await Bun.sleep(50);
    expect(messages.some((m) => m.includes("pong"))).toBe(true);
    ws.close();
  });

  test("未承認BotはERRORで切断される", async () => {
    const { messages, closed } = await connectBot("TESTTOKEN3");
    expect(messages.some((m) => m.includes("not approved"))).toBe(true);
    expect(closed).toBe(true);
  });

  test("無効なトークンはERRORで切断される", async () => {
    const { messages, closed } = await connectBot("INVALID");
    expect(messages.some((m) => m.includes("not valid"))).toBe(true);
    expect(closed).toBe(true);
  });

  /** 期待するメッセージが届くまで待つ。届かなければ最後まで待って呼び出し側の expect が落ちる */
  const waitForMessage = async (messages: string[], probe: string) => {
    for (let i = 0; i < 40 && !messages.some((m) => m.includes(probe)); i++) {
      await Bun.sleep(25);
    }
  };

  const setBotUserFlag = (flag: "isBanned" | "isDeleted", value: boolean) =>
    db
      .update(users)
      .set({ [flag]: value })
      .where(eq(users.id, "TESTUSER_BOT_1"));

  /** TESTBOT2 の全透過フラグを切り替える(呼び出し側で必ず戻す) */
  const setAllChannel = (value: boolean) =>
    db
      .update(botManages)
      .set({ useAllChannel: value })
      .where(eq(botManages.id, "TESTBOT2"));

  // BANと論理削除は同じ拒否経路のため同一ケースを共有する
  for (const flag of ["isBanned", "isDeleted"] as const) {
    test(`${flag} のBotは接続できない`, async () => {
      try {
        await setBotUserFlag(flag, true);
        const { messages, closed } = await connectBot("TESTTOKEN1");
        expect(messages.some((m) => m.includes("This bot is disabled"))).toBe(
          true,
        );
        expect(closed).toBe(true);
      } finally {
        await setBotUserFlag(flag, false);
      }
    });
  }

  test("再申請で未承認に戻ったBotは切断される", async () => {
    const { ws, messages } = await connectBot("TESTTOKEN1");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    try {
      // 権限を変えると再申請(PENDING)になり、承認済みでなくなる
      const res = await FETCH({
        path: "/server/bot",
        method: "PATCH",
        body: { botId: "TESTBOT1", canManageServerConfig: true },
      });
      expect(res.ok).toBe(true);
      expect(
        db
          .select({ approveStatus: botManages.approveStatus })
          .from(botManages)
          .where(eq(botManages.id, "TESTBOT1"))
          .get()?.approveStatus,
      ).toBe("PENDING");
      // 接続を維持すると channel::* の配信を受け続けるため切断される必要がある
      await waitForMessage(messages, "not approved");
      for (let i = 0; i < 40 && ws.readyState !== WebSocket.CLOSED; i++) {
        await Bun.sleep(25);
      }
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      // 後続のテストのため承認済み・権限フラグを戻す(権限を戻さないと後続テストに漏れる)
      await db
        .update(botManages)
        .set({ approveStatus: "APPROVED", canManageServerConfig: false })
        .where(eq(botManages.id, "TESTBOT1"));
    }
  });
  test("承認取消で接続中のBotは切断される", async () => {
    const { ws, messages } = await connectBot("TESTTOKEN1");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    try {
      const res = await FETCH({
        path: "/server/bot/approval",
        method: "PATCH",
        body: { botId: "TESTBOT1", approvalStatus: "DENIED" },
      });
      expect(res.ok).toBe(true);
      // 非APPROVED化は接続中WSを切断する
      await waitForMessage(messages, "not approved");
      for (let i = 0; i < 40 && ws.readyState !== WebSocket.CLOSED; i++) {
        await Bun.sleep(25);
      }
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      // 後続のテストのため承認済みへ戻す
      await db
        .update(botManages)
        .set({ approveStatus: "APPROVED" })
        .where(eq(botManages.id, "TESTBOT1"));
    }
  });

  test("非透過Botは許可されたチャンネルのみ受信する", async () => {
    // TESTBOT1 は TESTCHANNEL1 のみ許可
    const { ws, messages } = await connectBot("TESTTOKEN1");
    server.publish(
      "channel::TESTCHANNEL2",
      JSON.stringify({ signal: "test::ProbeRandom", data: "x" }),
    );
    server.publish(
      "channel::TESTCHANNEL1",
      JSON.stringify({ signal: "test::ProbeGeneral", data: "x" }),
    );
    // 後から publish した許可チャンネルの受信を待つ(同一接続内は到着順が保たれるため、
    // 先の許可外チャンネルが届いていればこの時点で messages に入っている)
    await waitForMessage(messages, "test::ProbeGeneral");
    expect(messages.some((m) => m.includes("test::ProbeGeneral"))).toBe(true);
    expect(messages.some((m) => m.includes("test::ProbeRandom"))).toBe(false);
    ws.close();
  });

  test("接続中にチャンネル許可を変更すると購読が張り替わる", async () => {
    // 自動承諾ONなら再申請(PENDING)にならず切断されないため、購読の張り替えだけを検証できる
    const beforeAutoApprove = GIRACLE_SERVER_CONFIG.BotAutoApprove;
    GIRACLE_SERVER_CONFIG.BotAutoApprove = true;
    // TESTBOT1 は TESTCHANNEL1 のみ許可
    const { ws, messages } = await connectBot("TESTTOKEN1");
    try {
      const res = await FETCH({
        path: "/server/bot",
        method: "PATCH",
        body: { botId: "TESTBOT1", permissionChannelIds: ["TESTCHANNEL2"] },
      });
      expect(res.ok).toBe(true);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      server.publish(
        "channel::TESTCHANNEL1",
        JSON.stringify({ signal: "test::ProbeOld", data: "x" }),
      );
      server.publish(
        "channel::TESTCHANNEL2",
        JSON.stringify({ signal: "test::ProbeNew", data: "x" }),
      );
      await waitForMessage(messages, "test::ProbeNew");
      expect(messages.some((m) => m.includes("test::ProbeNew"))).toBe(true);
      // 解除しないと許可を失ったチャンネルの配信を受け続けてしまう
      expect(messages.some((m) => m.includes("test::ProbeOld"))).toBe(false);
      ws.close();
    } finally {
      GIRACLE_SERVER_CONFIG.BotAutoApprove = beforeAutoApprove;
      // 後続のテストのため許可を戻す(TESTBOT1はTESTCHANNEL1のみ許可)
      await db
        .delete(botChannelPermissions)
        .where(eq(botChannelPermissions.botId, "TESTBOT1"));
      await db
        .insert(botChannelPermissions)
        .values({ channelId: "TESTCHANNEL1", botId: "TESTBOT1" });
    }
  });

  test("全透過Botは全チャンネルを受信する", async () => {
    try {
      await setAllChannel(true);
      // TESTBOT2 は botChannelPermissions に行を持たない
      const { ws, messages } = await connectBot("TESTTOKEN2");
      server.publish(
        "channel::TESTCHANNEL2",
        JSON.stringify({ signal: "test::ProbeRandom", data: "x" }),
      );
      await waitForMessage(messages, "test::ProbeRandom");
      expect(messages.some((m) => m.includes("test::ProbeRandom"))).toBe(true);
      ws.close();
    } finally {
      await setAllChannel(false);
    }
  });

  test("全透過Botは接続後に作成されたチャンネルも受信する", async () => {
    try {
      await setAllChannel(true);
      const { ws, messages } = await connectBot("TESTTOKEN2");

      // TESTUSER は manageChannel を持つ
      const res = await FETCH({
        path: "/channel/create",
        method: "PUT",
        body: { channelName: "bot-ext-new-channel" },
      });
      const newChannelId = (await res.json()).data.channelId as string;
      expect(newChannelId).toBeString();

      server.publish(
        `channel::${newChannelId}`,
        JSON.stringify({ signal: "test::ProbeNew", data: "x" }),
      );
      await waitForMessage(messages, "test::ProbeNew");
      expect(messages.some((m) => m.includes("test::ProbeNew"))).toBe(true);
      ws.close();
    } finally {
      await setAllChannel(false);
    }
  });
});
