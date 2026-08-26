import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "../src/db";
import { requestLog, roleInfos, roleLinks } from "../src/db/schema";
import { FETCH, INIT } from "./util";

// JST helper: "2025-01-10" + "03:00:00" -> Date at JST
const jst = (date: string, time = "12:00:00") =>
  new Date(`${date}T${time}+09:00`);

// GET /server/log のレスポンス要素型
type LogDaily = {
  date: string;
  successCount: number;
  errorCount: number;
  otherCount: number;
};

beforeAll(async () => {
  await INIT();
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
    .values({
      roleId: "GOD",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();
});

// 固定ウィンドウ [2025-01-10 .. 2025-01-17) で検証
async function seedLog() {
  await db.delete(requestLog);
  await db.insert(requestLog).values([
    // 2025-01-10 JST: success x2, error x1, other(404) x1
    {
      method: "GET",
      path: "/test",
      status: 200,
      userId: "TESTUSER",
      createdAt: jst("2025-01-10", "01:00:00"),
    },
    {
      method: "GET",
      path: "/test",
      status: 200,
      userId: "TESTUSER",
      createdAt: jst("2025-01-10", "12:00:00"),
    },
    {
      method: "GET",
      path: "/test",
      status: 500,
      userId: "TESTUSER",
      createdAt: jst("2025-01-10", "23:00:00"),
    },
    {
      method: "GET",
      path: "/test",
      status: 404,
      userId: "TESTUSER2",
      createdAt: jst("2025-01-10", "15:00:00"),
    },
    // 2025-01-11 JST
    {
      method: "GET",
      path: "/test",
      status: 200,
      userId: "TESTUSER",
      createdAt: jst("2025-01-11", "02:00:00"),
    },
    {
      method: "POST",
      path: "/test",
      status: 500,
      userId: "TESTUSER2",
      createdAt: jst("2025-01-11", "03:00:00"),
    },
    // JST境界: 2025-01-10T03:00 JST = 前日18:00 UTC -> JSTでは10日に集計されるべき
    {
      method: "GET",
      path: "/test",
      status: 200,
      userId: "TESTUSER",
      createdAt: new Date("2025-01-10T03:00:00+09:00"),
    },
    // 窓外
    {
      method: "GET",
      path: "/test",
      status: 200,
      userId: "TESTUSER",
      createdAt: jst("2025-01-09", "23:59:00"),
    },
    {
      method: "GET",
      path: "/test",
      status: 500,
      userId: "TESTUSER",
      createdAt: new Date("2025-01-17T00:00:00+09:00"),
    }, // exclusive
  ]);
}

describe("GET /server/log", () => {
  it(
    "正常 :: 日付別 success/error/other 集計",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.message).toBe("Fetched request logs");
      // 2025-01-10 は 4件(+境界1件) -> success 3, error 1, other 1
      const d10 = j.data.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10).toBeDefined();
      expect(d10.successCount).toBe(3);
      expect(d10.errorCount).toBe(1);
      expect(d10.otherCount).toBe(1);
      const d11 = j.data.find((d: LogDaily) => d.date === "2025-01-11");
      expect(d11.successCount).toBe(1);
      expect(d11.errorCount).toBe(1);
      expect(d11.otherCount).toBe(0);
      // 窓外の日付は含まれない
      expect(
        j.data.find((d: LogDaily) => d.date === "2025-01-09"),
      ).toBeUndefined();
      expect(
        j.data.find((d: LogDaily) => d.date === "2025-01-17"),
      ).toBeUndefined();
      // 日付昇順
      expect(j.data[0].date < j.data[1].date).toBe(true);
      console.log("08.log.test :: /server/log : 正常", j);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: type=success フィルタ",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10&type=success",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10.successCount).toBe(3);
      expect(d10.errorCount).toBe(0);
      expect(d10.otherCount).toBe(0);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: type=error フィルタ",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10&type=error",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10.successCount).toBe(0);
      expect(d10.errorCount).toBe(1);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: userId フィルタ",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10&userId=TESTUSER2",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10.successCount).toBe(0);
      expect(d10.errorCount).toBe(0);
      expect(d10.otherCount).toBe(1);
      const d11 = j.data.find((d: LogDaily) => d.date === "2025-01-11");
      expect(d11.errorCount).toBe(1);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: JST境界 UTC前日でもJST当日集計",
    async () => {
      await db.delete(requestLog);
      // UTC 2025-01-09 18:00 = JST 2025-01-10 03:00
      await db.insert(requestLog).values({
        method: "GET",
        path: "/test",
        status: 200,
        userId: "TESTUSER",
        createdAt: new Date("2025-01-10T03:00:00+09:00"),
      });
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.length).toBe(1);
      expect(j.data[0].date).toBe("2025-01-10");
      expect(j.data[0].successCount).toBe(1);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: cursorLogDate省略時は直近7日",
    async () => {
      await db.delete(requestLog);
      const todayStr = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Tokyo",
      });
      await db.insert(requestLog).values({
        method: "GET",
        path: "/test",
        status: 200,
        userId: "TESTUSER",
        createdAt: new Date(`${todayStr}T12:00:00+09:00`),
      });
      const res = await FETCH({ path: "/server/log", method: "GET" });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.find((d: LogDaily) => d.date === todayStr)).toBeDefined();
    },
    { timeout: 10000 },
  );

  it(
    "空 :: 該当期間ログなしは空配列",
    async () => {
      await db.delete(requestLog);
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2099-01-01",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data).toEqual([]);
    },
    { timeout: 10000 },
  );

  it(
    "権限無 :: manageServerなし",
    async () => {
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10",
        method: "GET",
        useSecondaryUser: true,
      });
      expect(res.ok).toBe(false);
    },
    { timeout: 10000 },
  );

  it(
    "未認証",
    async () => {
      const res = await FETCH({
        path: "/server/log?cursorLogDate=2025-01-10",
        method: "GET",
        excludeCredential: true,
      });
      expect(res.ok).toBe(false);
    },
    { timeout: 10000 },
  );
});
