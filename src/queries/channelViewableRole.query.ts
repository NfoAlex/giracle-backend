import { eq } from "drizzle-orm";
import { db } from "..";
import { channelViewableRoles } from "../db/schema";

export namespace QueryChannelViewableRole {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //チャンネルに設定された閲覧ロールId一覧(可視判定用)
  export const getRoleIdsByChannel = async (query: { channelId: string }) => {
    return await db
      .select({ roleId: channelViewableRoles.roleId })
      .from(channelViewableRoles)
      .where(eq(channelViewableRoles.channelId, query.channelId));
  };

  //閲覧可能ロールを丸ごと入れ替える(中間状態を無くすため1トランザクション)
  export const replaceByChannel = (query: {
    channelId: string;
    roleIds: string[];
  }) => {
    db.transaction((tx) => {
      tx.delete(channelViewableRoles)
        .where(eq(channelViewableRoles.channelId, query.channelId))
        .run();

      if (query.roleIds.length > 0) {
        tx.insert(channelViewableRoles)
          .values(
            query.roleIds.map((roleId) => ({
              channelId: query.channelId,
              roleId,
            })),
          )
          .run();
      }
    });
  };

  //トランザクション内でチャンネル配下の閲覧ロールを削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(channelViewableRoles)
      .where(eq(channelViewableRoles.channelId, query.channelId))
      .run();
  };
}
