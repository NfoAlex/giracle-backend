import { and, desc, eq, lt, or } from "drizzle-orm";
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

  //カーソル用にピン留め行の位置(createdAt)と属するチャンネルを取得する
  export const getCursorPin = (query: { messageId: string }) => {
    return db.query.messagePinned.findFirst({
      columns: { id: true, channelId: true, createdAt: true },
      where: eq(messagePinned.messageId, query.messageId),
    });
  };

  //チャンネルのピン留めをピン留め順(新しい順)で取得する。カーソル自身は含めない
  export const listByChannel = (query: {
    channelId: string;
    cursor: { createdAt: Date; id: number } | undefined;
    fetchLength: number;
  }) => {
    return db.query.messagePinned.findMany({
      where: and(
        eq(messagePinned.channelId, query.channelId),
        query.cursor
          ? or(
              lt(messagePinned.createdAt, query.cursor.createdAt),
              and(
                eq(messagePinned.createdAt, query.cursor.createdAt),
                lt(messagePinned.id, query.cursor.id),
              ),
            )
          : undefined,
      ),
      with: {
        message: {
          with: {
            MessageUrlPreview: true,
            MessageFileAttached: true,
          },
        },
      },
      orderBy: [desc(messagePinned.createdAt), desc(messagePinned.id)],
      limit: query.fetchLength,
    });
  };

  export const removeInTx = (tx: Tx, query: { messageId: string }) => {
    return tx
      .delete(messagePinned)
      .where(eq(messagePinned.messageId, query.messageId))
      .returning({ id: messagePinned.id })
      .run();
  };
}
