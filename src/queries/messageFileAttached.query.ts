import { eq, inArray } from "drizzle-orm";
import { db } from "..";
import { messageFileAttached } from "../db/schema";

export namespace QueryMessageFileAttached {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //添付ファイル単体(全列)
  export const getSingle = (query: { fileId: string }) => {
    return db.query.messageFileAttached.findFirst({
      where: eq(messageFileAttached.id, query.fileId),
    });
  };

  //メッセージに紐づく添付ファイル一覧(実体ファイル削除用)
  export const getByMessage = (query: { messageId: string }) => {
    return db.query.messageFileAttached.findMany({
      where: eq(messageFileAttached.messageId, query.messageId),
    });
  };

  //ファイルId群で取得(メッセージへの添付時の存在・所有者確認用)
  export const getByIds = (query: { fileIds: string[] }) => {
    return db.query.messageFileAttached.findMany({
      where: inArray(messageFileAttached.id, query.fileIds),
    });
  };

  //添付ファイル情報を保存
  export const insertFile = (query: {
    channelId: string;
    userId: string;
    actualFileName: string;
    savedFileName: string;
    size: number;
    type: string;
  }) => {
    return db
      .insert(messageFileAttached)
      .values({
        channelId: query.channelId,
        userId: query.userId,
        actualFileName: query.actualFileName,
        savedFileName: query.savedFileName,
        size: query.size,
        type: query.type,
      })
      .returning({ id: messageFileAttached.id })
      .get();
  };

  //アップロード済みファイルをメッセージに紐付ける
  export const attachToMessage = (query: {
    fileIds: string[];
    messageId: string;
  }) => {
    return db
      .update(messageFileAttached)
      .set({ messageId: query.messageId })
      .where(inArray(messageFileAttached.id, query.fileIds));
  };

  //トランザクション内でメッセージに紐づく添付ファイルを削除する
  export const removeByMessageInTx = (tx: Tx, query: { messageId: string }) => {
    tx.delete(messageFileAttached)
      .where(eq(messageFileAttached.messageId, query.messageId))
      .run();
  };

  //トランザクション内でチャンネル配下の添付ファイルを削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(messageFileAttached)
      .where(eq(messageFileAttached.channelId, query.channelId))
      .run();
  };
}
