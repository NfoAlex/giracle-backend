import { and, eq } from "drizzle-orm";
import { db } from "..";
import { messageReadTimes } from "../db/schema";

export namespace QueryMessageReadTime {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //ユーザーの既読時間一覧(チャンネルIdと時間のみ。新着判定用)
  export const getByUser = (query: { userId: string }) => {
    return db.query.messageReadTimes.findMany({
      where: eq(messageReadTimes.userId, query.userId),
      columns: { channelId: true, readTime: true },
    });
  };

  //ユーザーの既読時間一覧(全列。既読時間表示用)
  export const getByUserAll = (query: { userId: string }) => {
    return db.query.messageReadTimes.findMany({
      where: eq(messageReadTimes.userId, query.userId),
    });
  };

  //チャンネル・ユーザー単位の既読時間(更新時の比較用)
  export const getSingle = (query: { channelId: string; userId: string }) => {
    return db.query.messageReadTimes.findFirst({
      where: and(
        eq(messageReadTimes.channelId, query.channelId),
        eq(messageReadTimes.userId, query.userId),
      ),
    });
  };

  //既読時間を保存(存在すれば更新)
  export const upsert = async (query: {
    channelId: string;
    userId: string;
    readTime: Date;
  }) => {
    const [readTimeUpdated] = await db
      .insert(messageReadTimes)
      .values({
        readTime: query.readTime,
        channelId: query.channelId,
        userId: query.userId,
      })
      .onConflictDoUpdate({
        target: [messageReadTimes.channelId, messageReadTimes.userId],
        set: { readTime: query.readTime },
      })
      .returning();

    return readTimeUpdated;
  };

  //チャンネル・ユーザー単位の既読時間を削除(退出・キック用)
  export const removeByChannelAndUser = async (query: {
    channelId: string;
    userId: string;
  }) => {
    await db
      .delete(messageReadTimes)
      .where(
        and(
          eq(messageReadTimes.channelId, query.channelId),
          eq(messageReadTimes.userId, query.userId),
        ),
      );
  };

  //トランザクション内でチャンネル配下の既読時間を削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(messageReadTimes)
      .where(eq(messageReadTimes.channelId, query.channelId))
      .run();
  };
}
