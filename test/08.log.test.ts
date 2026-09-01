import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { requestLog, roleInfos, roleLinks } from "../src/db/schema";
import { FETCH, INIT } from "./util";

// JST helper: "2025-01-10" + "03:00:00" -> Date at JST
const jst = (date: string, time = "12:00:00") =>
  new Date(`${date}T${time}+09:00`);

// GET /server/log-group のレスポンス要素型
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

  // [method, status, userId, date, time]
  const rows: [string, number, string, string, string][] = [
    ["GET", 200, "TESTUSER", "2025-01-10", "01:00:00"],
    ["GET", 200, "TESTUSER", "2025-01-10", "12:00:00"],
    ["GET", 500, "TESTUSER", "2025-01-10", "23:00:00"],
    ["GET", 404, "TESTUSER2", "2025-01-10", "15:00:00"],
    ["GET", 200, "TESTUSER", "2025-01-11", "02:00:00"],
    ["POST", 500, "TESTUSER2", "2025-01-11", "03:00:00"],
    ["GET", 200, "TESTUSER", "2025-01-10", "03:00:00"], // JST境界
    ["GET", 200, "TESTUSER", "2025-01-09", "23:59:00"], // 窓外
    ["GET", 500, "TESTUSER", "2025-01-17", "00:00:00"], // 窓外 exclusive
  ];

  await db.insert(requestLog).values(
    rows.map(([method, status, userId, date, time]) => ({
      method,
      path: "/test",
      status,
      userId,
      createdAt: jst(date, time),
    })),
  );
}

describe("GET /server/log-group", () => {
  it(
    "正常 :: 日付別 success/error/other 集計",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.message).toBe("Fetched request log counts by day");
      // 2025-01-10 は 4件(+境界1件) -> success 3, error 1, other 1
      const d10 = j.data.group.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10).toBeDefined();
      expect(d10.successCount).toBe(3);
      expect(d10.errorCount).toBe(1);
      expect(d10.otherCount).toBe(1);
      const d11 = j.data.group.find((d: LogDaily) => d.date === "2025-01-11");
      expect(d11.successCount).toBe(1);
      expect(d11.errorCount).toBe(1);
      expect(d11.otherCount).toBe(0);
      // 窓外の日付は含まれない
      expect(
        j.data.group.find((d: LogDaily) => d.date === "2025-01-09"),
      ).toBeUndefined();
      expect(
        j.data.group.find((d: LogDaily) => d.date === "2025-01-17"),
      ).toBeUndefined();
      // 日付昇順
      expect(j.data.group[0].date < j.data.group[1].date).toBe(true);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: type=success フィルタ",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2025-01-10&type=success",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.group.find((d: LogDaily) => d.date === "2025-01-10");
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
        path: "/server/log-group?cursorLogDate=2025-01-10&type=error",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.group.find((d: LogDaily) => d.date === "2025-01-10");
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
        path: "/server/log-group?cursorLogDate=2025-01-10&userId=TESTUSER2",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const d10 = j.data.group.find((d: LogDaily) => d.date === "2025-01-10");
      expect(d10.successCount).toBe(0);
      expect(d10.errorCount).toBe(0);
      expect(d10.otherCount).toBe(1);
      const d11 = j.data.group.find((d: LogDaily) => d.date === "2025-01-11");
      expect(d11.errorCount).toBe(1);
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
      const res = await FETCH({ path: "/server/log-group", method: "GET" });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(
        j.data.group.find((d: LogDaily) => d.date === todayStr),
      ).toBeDefined();
    },
    { timeout: 10000 },
  );

  it(
    "空 :: 該当期間ログなしは空配列",
    async () => {
      await db.delete(requestLog);
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2099-01-01",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.group).toEqual([]);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: includeFirstLogs省略時は firstDayLog なし",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.firstDayLog).toBeUndefined();
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: includeFirstLogs=true で初日生ログを返す",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2025-01-10&includeFirstLogs=true",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.data.group.length).toBe(2);
      // 初日(2025-01-10)の生ログ 5件
      expect(j.data.firstDayLog).toHaveLength(5);
    },
    { timeout: 10000 },
  );

  it(
    "権限無 :: manageServerなし",
    async () => {
      const res = await FETCH({
        path: "/server/log-group?cursorLogDate=2025-01-10",
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
        path: "/server/log-group?cursorLogDate=2025-01-10",
        method: "GET",
        excludeCredential: true,
      });
      expect(res.ok).toBe(false);
    },
    { timeout: 10000 },
  );
});

describe("GET /server/log", () => {
  it(
    "正常 :: 対象日の生ログのみ返す",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?targetDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(j.message).toBe("Fetched request logs");
      // seedLog の 2025-01-10 は5件(status 3x200 / 1x500 / 1x404)。窓外(01-09,01-17)は含まれない
      expect(j.data.length).toBe(5);
      const statuses = j.data.map((l: { status: number }) => l.status);
      expect(statuses.filter((s: number) => s === 200).length).toBe(3);
      expect(statuses.filter((s: number) => s === 500).length).toBe(1);
      expect(statuses.filter((s: number) => s === 404).length).toBe(1);
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: 新しい順で返す",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?targetDate=2025-01-10",
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      const times = j.data.map((l: { createdAt: string }) =>
        new Date(l.createdAt).getTime(),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
    },
    { timeout: 10000 },
  );

  it(
    "正常 :: cursorLogId で継続取得",
    async () => {
      await seedLog();
      const cursor = await db.query.requestLog.findFirst({
        where: eq(requestLog.createdAt, jst("2025-01-10", "12:00:00")),
      });
      const res = await FETCH({
        path: `/server/log?targetDate=2025-01-10&cursorLogId=${cursor?.id}`,
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      // 12:00 より古い 03:00 / 01:00 の2件のみ
      expect(j.data).toHaveLength(2);
      const times = j.data.map((l: { createdAt: string }) =>
        new Date(l.createdAt).getTime(),
      );
      expect(times).toContain(jst("2025-01-10", "03:00:00").getTime());
      expect(times).toContain(jst("2025-01-10", "01:00:00").getTime());
    },
    { timeout: 10000 },
  );

  it(
    "異常 :: 存在しない cursorLogId は 400",
    async () => {
      await seedLog();
      const res = await FETCH({
        path: "/server/log?targetDate=2025-01-10&cursorLogId=nonexistent",
        method: "GET",
      });
      expect(res.status).toBe(400);
    },
    { timeout: 10000 },
  );

  it(
    "異常 :: 対象日と異なる cursorLogId は 400",
    async () => {
      await seedLog();
      const cursor = await db.query.requestLog.findFirst({
        where: eq(requestLog.createdAt, jst("2025-01-11", "02:00:00")),
      });
      const res = await FETCH({
        path: `/server/log?targetDate=2025-01-10&cursorLogId=${cursor?.id}`,
        method: "GET",
      });
      expect(res.status).toBe(400);
    },
    { timeout: 10000 },
  );

  it(
    "権限無 :: manageServerなし",
    async () => {
      const res = await FETCH({
        path: "/server/log?targetDate=2025-01-10",
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
        path: "/server/log?targetDate=2025-01-10",
        method: "GET",
        excludeCredential: true,
      });
      expect(res.ok).toBe(false);
    },
    { timeout: 10000 },
  );
});
