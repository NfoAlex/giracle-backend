import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { ext } from "../src/components/Ext/ext.module";
import { botManages } from "../src/db/schema";
import { Middleware } from "../src/Middlewares";
import { INIT } from "./util";

//レート制限のバケットはプロセス内で共有されるため、他のテストファイルと混ざらないよう専用Botを使う
//extはBOT_RATE_LIMIT_ENABLEDで有効化されるため、テストではリミッターをextと同じ順でマウントする
const botApp = new Elysia()
  .use(Middleware.CheckBotToken)
  .use(Middleware.BotRateLimiter)
  .get("/ping", () => "ok");

//実際の/ext(フラグが無効なら制限されない)
const extApp = new Elysia().use(ext);

//独立性検証用に不同的Botを2つ作る
const BOT1 = { id: "BOTMANAGE_RL1", token: "BOTRATE1TOKEN" };
const BOT2 = { id: "BOTMANAGE_RL2", token: "BOTRATE2TOKEN" };

const fetchBot = (token: string) =>
  botApp.handle(
    new Request("http://localhost/ping", {
      method: "GET",
      headers: { authorization: token },
    }),
  );

beforeAll(async () => {
  await INIT();
  GIRACLE_SERVER_CONFIG.BotEnabled = true;
  await db
    .update(botManages)
    .set({ isApproved: true })
    .where(eq(botManages.id, "BOTMANAGE"));

  for (const [i, bot] of [BOT1, BOT2].entries()) {
    await db
      .insert(botManages)
      .values({
        id: bot.id,
        remoteUserId: i === 0 ? "BOTUSER" : "TESTUSER2",
        tokenCode: bot.token,
        createdBy: "TESTUSER",
        isApproved: true,
      })
      .onConflictDoNothing();
  }
});

describe("BotRateLimiter", () => {
  it("正常 :: 上限内のBotは通る", async () => {
    expect((await fetchBot(BOT1.token)).status).toBe(200);
    expect((await fetchBot(BOT2.token)).status).toBe(200);
  });

  it("上限を超えると429 :: バケットはBot単位で独立している", async () => {
    let hitsLimit = false;
    //既定の上限(RATE_LIMIT_BOT_COUNT)に依存しないよう、429まで叩く
    for (let i = 0; i < 400; i++) {
      const res = await fetchBot(BOT1.token);
      if (res.status === 429) {
        hitsLimit = true;
        break;
      }
      expect(res.status).toBe(200);
    }

    expect(hitsLimit).toBeTrue();
    //同一ウィンドウ内では超過が続く
    expect((await fetchBot(BOT1.token)).status).toBe(429);
    //別のBotは巻き込まれない
    expect((await fetchBot(BOT2.token)).status).toBe(200);
  });

  it("429でもBotトークンは無効化されない(ユーザートークンとの違い)", async () => {
    const bot = db
      .select({ id: botManages.id })
      .from(botManages)
      .where(eq(botManages.tokenCode, BOT1.token))
      .get();

    expect(bot?.id).toBe(BOT1.id);
  });

  it("/ext の制限は BOT_RATE_LIMIT_ENABLED に従う", async () => {
    //BOT1は直マウント側で上限超過済みなので、配線されていれば/extでも429になる
    const res = await extApp.handle(
      new Request("http://localhost/ext/user/TESTUSER", {
        method: "GET",
        headers: { authorization: BOT1.token },
      }),
    );

    expect(res.status).toBe(
      Bun.env.BOT_RATE_LIMIT_ENABLED === "true" ? 429 : 200,
    );
  });

  it("/ext は共通RateLimiterの対象外", async () => {
    //extをRateLimiterより先に登録した場合、scopedなRateLimiterは/extに効かない
    const isolated = new Elysia().use(ext).use(Middleware.RateLimiter);
    const res = await isolated.handle(
      new Request("http://localhost/ext/user/TESTUSER", {
        method: "GET",
        headers: { authorization: BOT2.token },
      }),
    );

    //効いていた場合はrequestIPが取れず500になる(テストではHTTPサーバーを立てないため)
    expect(res.status).toBe(200);
  });
});
