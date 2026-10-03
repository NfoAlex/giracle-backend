import { and, eq } from "drizzle-orm";
import { db } from "..";
import { inboxes } from "../db/schema";

export namespace QueryInbox {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //ユーザーの通知一覧(メッセージ付き)
  export const getByUserWithMessage = (query: { userId: string }) => {
    return db.query.inboxes.findMany({
      where: eq(inboxes.userId, query.userId),
      with: {
        Message: true,
      },
    });
  };

  //通知を単体削除(削除した行を返す。呼び出し側で件数を確認する)
  export const removeSingle = (query: {
    messageId: string;
    userId: string;
  }) => {
    return db
      .delete(inboxes)
      .where(
        and(
          eq(inboxes.messageId, query.messageId),
          eq(inboxes.userId, query.userId),
        ),
      )
      .returning();
  };

  //ユーザーの通知を全削除
  export const removeAllByUser = (query: { userId: string }) => {
    return db.delete(inboxes).where(eq(inboxes.userId, query.userId));
  };

  //通知を1件保存
  export const insertOne = (query: {
    userId: string;
    messageId: string;
    type: string;
  }) => {
    return db.insert(inboxes).values({
      userId: query.userId,
      messageId: query.messageId,
      type: query.type,
    });
  };

  //通知をまとめて保存
  export const insertMany = (query: {
    items: (typeof inboxes.$inferInsert)[];
  }) => {
    return db.insert(inboxes).values(query.items);
  };

  //トランザクション内でメッセージに紐づく通知を削除する
  export const removeByMessageInTx = (tx: Tx, query: { messageId: string }) => {
    tx.delete(inboxes).where(eq(inboxes.messageId, query.messageId)).run();
  };
}
