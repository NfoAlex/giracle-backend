import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db, GIRACLE_SERVER_CONFIG } from "../src";
import { ext } from "../src/components/Ext/ext.module";
import { botManages } from "../src/db/schema";
import { Middleware } from "../src/Middlewares";
import { INIT } from "./util";

//レート制限のバケットはプロセス内で共有されるため、このファイル内の実行順に依存する
//extはBOT_RATE_LIMIT_ENABLEDで有効化されるため、テストではリミッターをextと同じ順でマウントする
const botApp = new Elysia()
  .use(Middleware.CheckBotToken)
  .use(Middleware.BotRateLimiter)
  .get("/ping", () => "ok");

//1つ目のBot(共通のシード)と、独立性検証用の2つ目のBot
const BOT1_TOKEN = "BOTMANAGETOKEN";
const BOT2 = { id: "BOTMANAGE2", token: "BOTMANAGE2TOKEN" };

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
  await db
    .insert(botManages)
    .values({
      id: BOT2.id,
      remoteUserId: "TESTUSER2",
      tokenCode: BOT2.token,
      createdBy: "TESTUSER",
      isApproved: true,
    })
    .onConflictDoNothing();
});

describe("BotRateLimiter", () => {
  it("正常 :: 上限内のBotは通る", async () => {
    expect((await fetchBot(BOT1_TOKEN)).status).toBe(200);
    expect((await fetchBot(BOT2.token)).status).toBe(200);
  });

  it("上限を超えると429 :: バケットはBot単位で独立している", async () => {
    let hitsLimit = false;
    //既定の上限(RATE_LIMIT_BOT_COUNT)に依存しないよう、429まで叩く
    for (let i = 0; i < 400; i++) {
      const res = await fetchBot(BOT1_TOKEN);
      if (res.status === 429) {
        hitsLimit = true;
        break;
      }
      expect(res.status).toBe(200);
    }

    expect(hitsLimit).toBeTrue();
    //同一ウィンドウ内では超過が続く
    expect((await fetchBot(BOT1_TOKEN)).status).toBe(429);
    //別のBotは巻き込まれない
    expect((await fetchBot(BOT2.token)).status).toBe(200);
  });

  it("429でもBotトークンは無効化されない(ユーザートークンとの違い)", async () => {
    const bot = db
      .select({ id: botManages.id })
      .from(botManages)
      .where(eq(botManages.tokenCode, BOT1_TOKEN))
      .get();

    expect(bot?.id).toBe("BOTMANAGE");
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
