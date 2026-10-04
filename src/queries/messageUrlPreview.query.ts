import { eq } from "drizzle-orm";
import { db } from "..";
import { messageUrlPreviews } from "../db/schema";

export namespace QueryMessageUrlPreview {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //メッセージに紐づくURLプレビューを削除(編集時の入れ替え用)
  export const removeByMessage = async (query: { messageId: string }) => {
    await db
      .delete(messageUrlPreviews)
      .where(eq(messageUrlPreviews.messageId, query.messageId));
  };

  //URLプレビューをまとめて保存
  export const insertMany = async (query: {
    items: (typeof messageUrlPreviews.$inferInsert)[];
  }) => {
    if (query.items.length === 0) return;
    await db.insert(messageUrlPreviews).values(query.items);
  };

  //トランザクション内でメッセージに紐づくURLプレビューを削除する
  export const removeByMessageInTx = (tx: Tx, query: { messageId: string }) => {
    tx.delete(messageUrlPreviews)
      .where(eq(messageUrlPreviews.messageId, query.messageId))
      .run();
  };
}
