import { and, eq, inArray } from "drizzle-orm";
import { db } from "..";
import { messageReactions } from "../db/schema";

export namespace QueryMessageReaction {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //複数メッセージのリアクションをまとめて取得(集計用)
  export const getByMessageIds = (query: { messageIds: string[] }) => {
    return db.query.messageReactions.findMany({
      where: inArray(messageReactions.messageId, query.messageIds),
      orderBy: (t, { asc }) => asc(t.reactedAt),
    });
  };

  //メッセージ・絵文字単位のリアクション(ページネーション付き。誰がリアクションしたか表示用)
  export const getByMessageAndEmoji = (query: {
    messageId: string;
    emojiCode: string;
    fetchLength: number;
    skip: number;
  }) => {
    return db.query.messageReactions.findMany({
      where: and(
        eq(messageReactions.messageId, query.messageId),
        eq(messageReactions.emojiCode, query.emojiCode),
      ),
      columns: {
        userId: true,
      },
      orderBy: (t, { asc }) => asc(t.reactedAt),
      limit: query.fetchLength,
      offset: query.skip,
    });
  };

  //リアクションを保存
  export const insertReaction = async (query: {
    messageId: string;
    userId: string;
    channelId: string;
    emojiCode: string;
  }) => {
    const [reaction] = await db
      .insert(messageReactions)
      .values({
        messageId: query.messageId,
        userId: query.userId,
        channelId: query.channelId,
        emojiCode: query.emojiCode,
      })
      .returning();

    return reaction;
  };

  //リアクションを削除(削除した行を返す)
  export const removeById = async (query: { reactionId: string }) => {
    const [reactionDeleted] = await db
      .delete(messageReactions)
      .where(eq(messageReactions.id, query.reactionId))
      .returning();

    return reactionDeleted;
  };

  //トランザクション内でメッセージに紐づくリアクションを削除する
  export const removeByMessageInTx = (tx: Tx, query: { messageId: string }) => {
    tx.delete(messageReactions)
      .where(eq(messageReactions.messageId, query.messageId))
      .run();
  };
}
