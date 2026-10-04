import { eq } from "drizzle-orm";
import { db } from "..";
import { channelJoinOnDefaults } from "../db/schema";

export namespace QueryChannelJoinOnDefault {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //デフォルト参加チャンネル一覧(チャンネル情報付き)
  export const getListWithChannel = () => {
    return db.query.channelJoinOnDefaults.findMany({
      with: {
        channel: true,
      },
    });
  };

  //デフォルト参加チャンネルId一覧
  export const getList = async () => {
    return await db.query.channelJoinOnDefaults.findMany();
  };

  //デフォルト参加チャンネルを総入れ替え(1トランザクションで中間状態を無くす)
  export const replaceAll = (query: { channelIds: string[] }) => {
    db.transaction((tx) => {
      tx.delete(channelJoinOnDefaults).run();
      if (query.channelIds.length > 0) {
        tx.insert(channelJoinOnDefaults)
          .values(query.channelIds.map((channelId) => ({ channelId })))
          .run();
      }
    });
  };

  //トランザクション内でチャンネル配下のデフォルト参加情報を削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(channelJoinOnDefaults)
      .where(eq(channelJoinOnDefaults.channelId, query.channelId))
      .run();
  };
}
