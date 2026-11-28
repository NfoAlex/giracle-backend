import { eq } from "drizzle-orm";
import { db } from "..";
import { messagePinned } from "../db/schema";

export namespace QueryMessagePinned {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  export const insertPin = (query: {
    userId: string;
    channelId: string;
    messageId: string;
  }) => {
    return db
      .insert(messagePinned)
      .values({
        messageId: query.messageId,
        channelId: query.channelId,
        pinnedBy: query.userId,
      })
      .returning();
  };

  export const remove = (query: { messageId: string }) => {
    return db
      .delete(messagePinned)
      .where(eq(messagePinned.messageId, query.messageId))
      .returning();
  };

  export const removeInTx = (tx: Tx, query: { messageId: string }) => {
    return tx
      .delete(messagePinned)
      .where(eq(messagePinned.messageId, query.messageId))
      .returning({ id: messagePinned.id })
      .run();
  };
}
