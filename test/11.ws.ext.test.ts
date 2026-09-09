import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
// 循環import(ws.ts→index.ts→ws.ts)のため、まず../srcを完全評価してからwsHandlerを取る
import { db } from "../src";
import { botManages } from "../src/db/schema";
import { wsHandler } from "../src/ws";
import { INIT } from "./util";

describe("WS (Bot)", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    await INIT();
    // 未承認Bot(TESTBOT3)用のトークンを用意
    await db
      .update(botManages)
      .set({ tokenCode: "TESTTOKEN3" })
      .where(eq(botManages.id, "TESTBOT3"));
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
});
