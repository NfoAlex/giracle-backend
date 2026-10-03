import { and, desc, eq, gte, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { db } from "..";
import { requestLog } from "../db/schema";

export namespace QueryRequestLog {
  //カーソル位置のログ(日付範囲の検証用。Idと作成日時のみ)
  export const getCursorLog = (query: { logId: string }) => {
    return db
      .select({ id: requestLog.id, createdAt: requestLog.createdAt })
      .from(requestLog)
      .where(eq(requestLog.id, query.logId))
      .get();
  };

  //指定日のログ一覧(カーソルページネーション付き)
  export const getByDateRange = async (query: {
    dayStart: Date;
    dayEnd: Date;
    cursor: { id: string; createdAt: Date } | undefined;
  }) => {
    return await db
      .select()
      .from(requestLog)
      .where(
        and(
          gte(requestLog.createdAt, query.dayStart),
          lte(requestLog.createdAt, query.dayEnd),
          query.cursor
            ? or(
                lt(requestLog.createdAt, query.cursor.createdAt),
                and(
                  eq(requestLog.createdAt, query.cursor.createdAt),
                  lt(requestLog.id, query.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(requestLog.createdAt), desc(requestLog.id))
      .limit(50);
  };

  //JST日付ごとの成功/エラー件数集計(週次)
  export const getGroupByDay = async (query: {
    weekStart: Date;
    weekEnd: Date;
    type?: "success" | "error";
    userId?: string;
  }) => {
    //日付バケットは JST(UTC+9) 固定。サーバーTZ依存にせず決定的にする
    //SQLite: createdAt は ms なので /1000 で unixepoch(秒) 化 → +9時間 → YYYY-MM-DD
    const day = sql<string>`strftime(
      '%Y-%m-%d',
      ${requestLog.createdAt} / 1000,
      'unixepoch',
      '+9 hours'
    )`;

    const cnt = (cond: SQL) =>
      sql<number>`cast(sum(case when ${cond} then 1 else 0 end) as int)`;

    return await db
      .select({
        date: day,
        successCount: cnt(sql`${requestLog.status} = 200`),
        errorCount: cnt(sql`${requestLog.status} >= 500`),
        otherCount: cnt(
          sql`${requestLog.status} != 200 and ${requestLog.status} < 500`,
        ),
      })
      .from(requestLog)
      .where(
        and(
          gte(requestLog.createdAt, query.weekStart),
          lt(requestLog.createdAt, query.weekEnd),
          query.type
            ? (
                {
                  success: eq(requestLog.status, 200),
                  error: gte(requestLog.status, 500),
                } as const
              )[query.type]
            : undefined,
          query.userId ? eq(requestLog.userId, query.userId) : undefined,
        ),
      )
      .groupBy(day)
      .orderBy(day);
  };

  //リクエストログを記録
  export const insertLog = async (query: {
    userId: string | null;
    method: string;
    path: string;
    status: number;
  }) => {
    await db.insert(requestLog).values({
      userId: query.userId,
      method: query.method,
      path: query.path,
      status: query.status,
    });
  };
}
