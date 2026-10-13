import crypto from "node:crypto";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { db } from "..";
import { botManages, users } from "../db/schema";

export namespace QueryBot {
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //トランザクション内でBotの管理情報を作成する
  export const insertWithRemoteUserIdInTx = (
    tx: Tx,
    query: {
      remoteUserId: string;
      requestSender: string;
    },
  ) => {
    const tokenCode = crypto.randomBytes(32).toString("hex");
    return tx
      .insert(botManages)
      .values({
        remoteUserId: query.remoteUserId,
        createdBy: query.requestSender,
        tokenCode,
      })
      .returning()
      .get();
  };

  //トランザクション内でBotの管理情報を削除する
  export const deleteInTx = (tx: Tx, query: { botId: string }) => {
    return tx
      .delete(botManages)
      .where(eq(botManages.id, query.botId))
      .returning()
      .get();
  };

  export const updateBotIsApproved = async (query: {
    botId: string;
    isApproved: boolean;
  }) => {
    const bot = await db
      .update(botManages)
      .set({ isApproved: query.isApproved })
      .where(eq(botManages.id, query.botId))
      .returning();

    return bot[0] !== undefined ? bot[0] : undefined;
  };

  export const getSingle = async (query: { botId: string }) => {
    const bot = await db
      .select()
      .from(botManages)
      .where(eq(botManages.id, query.botId));

    return bot;
  };

  export const getSingleWithRemoteUser = async (query: { botId: string }) => {
    const bot = await db
      .select({ bot: botManages, user: users })
      .from(botManages)
      .where(eq(botManages.id, query.botId))
      .leftJoin(users, eq(users.id, botManages.remoteUserId));

    return bot;
  };

  export const getBotMinimumByTokenCode = async (query: {
    tokenCode: string;
  }) => {
    const bot = await db
      .select({
        id: botManages.id,
        isApproved: botManages.isApproved,
        remoteUserId: botManages.remoteUserId,
        createdBy: botManages.createdBy,
      })
      .from(botManages)
      .where(eq(botManages.tokenCode, query.tokenCode));

    return bot[0] !== undefined ? bot[0] : undefined;
  };

  //カーソル解決用(開始位置のソートキーのみ)
  export const getCursorBot = (query: { botId: string }) => {
    return db.query.botManages.findFirst({
      columns: { createdAt: true, id: true },
      where: eq(botManages.id, query.botId),
    });
  };

  //ユーザーが作成したBotのリモートユーザーId一覧(BAN・削除時にWSを切るため)
  export const getRemoteUserIdsByCreatedBy = async (query: {
    createdBy: string;
  }) => {
    return await db
      .select({ remoteUserId: botManages.remoteUserId })
      .from(botManages)
      .where(eq(botManages.createdBy, query.createdBy));
  };

  //ユーザーが作成したBot一覧(作成順。cursorBotで継続取得)
  export const getList = async (query: {
    createdBy: string;
    length: number;
    cursorBot?: { createdAt: Date; id: string } | undefined;
  }) => {
    return await db.query.botManages.findMany({
      where: and(
        eq(botManages.createdBy, query.createdBy),
        //作成日時とBotId基準で取得(cursorBotIdだけで継続取得できる形に解決して渡す)
        query.cursorBot
          ? or(
              gt(botManages.createdAt, query.cursorBot.createdAt),
              //同一ミリ秒で作成されたとき用考慮
              and(
                eq(botManages.createdAt, query.cursorBot.createdAt),
                gt(botManages.id, query.cursorBot.id),
              ),
            )
          : undefined,
      ),
      orderBy: [asc(botManages.createdAt), asc(botManages.id)],
      limit: query.length,
    });
  };
}
