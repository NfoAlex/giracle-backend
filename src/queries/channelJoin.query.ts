import { and, eq, inArray } from "drizzle-orm";
import { db } from "..";
import { channelJoins } from "../db/schema";

export namespace QueryChannelJoin {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //参加情報(存在確認・可視判定用)
  export const getJoin = (query: { channelId: string; userId: string }) => {
    return db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, query.userId),
        eq(channelJoins.channelId, query.channelId),
      ),
    });
  };

  //チャンネル情報付きの参加情報(招待時の存在確認用)
  export const getJoinWithChannel = (query: {
    channelId: string;
    userId: string;
  }) => {
    return db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, query.userId),
        eq(channelJoins.channelId, query.channelId),
      ),
      with: {
        channel: true,
      },
    });
  };

  //チャンネルの参加者一覧(WS購読解除用)
  export const getJoinsByChannel = async (query: { channelId: string }) => {
    return await db.query.channelJoins.findMany({
      where: eq(channelJoins.channelId, query.channelId),
    });
  };

  //チャンネル参加者のユーザーId一覧(全通知配信用)
  export const getUserIdsByChannel = (query: { channelId: string }) => {
    return db.query.channelJoins.findMany({
      where: eq(channelJoins.channelId, query.channelId),
      columns: { userId: true },
    });
  };

  //ユーザーがチャンネルに参加しているか(返信通知の参加確認用。ユーザーIdのみ)
  export const getJoinByUserId = (query: { userId: string }) => {
    return db
      .select({ userId: channelJoins.userId })
      .from(channelJoins)
      .where(eq(channelJoins.userId, query.userId));
  };

  //ユーザーの参加チャンネル一覧(新着判定用)
  export const getJoinsByUser = (query: { userId: string }) => {
    return db.query.channelJoins.findMany({
      where: eq(channelJoins.userId, query.userId),
      columns: { channelId: true },
    });
  };

  //指定ユーザー群のうちチャンネルに参加しているもの(メンション通知対象の絞り込み用)
  export const getJoinsByUsersInChannel = (query: {
    userIds: string[];
    channelId: string;
  }) => {
    return db.query.channelJoins.findMany({
      where: and(
        inArray(channelJoins.userId, query.userIds),
        eq(channelJoins.channelId, query.channelId),
      ),
      columns: { userId: true },
    });
  };

  export const insertJoin = async (query: {
    channelId: string;
    userId: string;
  }) => {
    await db.insert(channelJoins).values({
      userId: query.userId,
      channelId: query.channelId,
    });
  };

  //参加情報をまとめて保存(デフォルト参加チャンネルへの一括参加用)
  export const insertMany = async (query: {
    items: { userId: string; channelId: string }[];
  }) => {
    if (query.items.length === 0) return;
    await db.insert(channelJoins).values(query.items);
  };

  export const removeJoin = async (query: {
    channelId: string;
    userId: string;
  }) => {
    await db
      .delete(channelJoins)
      .where(
        and(
          eq(channelJoins.userId, query.userId),
          eq(channelJoins.channelId, query.channelId),
        ),
      );
  };

  //トランザクション内でチャンネル配下の参加情報を削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(channelJoins)
      .where(eq(channelJoins.channelId, query.channelId))
      .run();
  };
}
