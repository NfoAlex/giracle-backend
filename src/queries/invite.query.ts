import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import { invitations } from "../db/schema";

export namespace QueryInvite {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //招待コード一覧
  export const getList = async () => {
    return await db.query.invitations.findMany();
  };

  //招待コード単体(存在確認用)
  export const getSingle = (query: { inviteCode: string }) => {
    return db.query.invitations.findFirst({
      where: eq(invitations.inviteCode, query.inviteCode),
    });
  };

  export const insertInvite = async (query: {
    inviteCode: string;
    maxUsage: number;
    requestSender: string;
  }) => {
    const [newInvite] = await db
      .insert(invitations)
      .values({
        inviteCode: query.inviteCode,
        createdUserId: query.requestSender,
        maxUsage: query.maxUsage,
      })
      .returning();

    return newInvite;
  };

  export const removeInvite = async (query: { inviteId: number }) => {
    await db.delete(invitations).where(eq(invitations.id, query.inviteId));
  };

  //呼び出し側のトランザクション内で使用回数を条件付き加算する(maxUsage=-1は無制限。上限到達なら0件更新でundefined)
  export const consumeInTx = (tx: Tx, query: { inviteCode: string }) => {
    return tx
      .update(invitations)
      .set({
        usedCount: sql`${invitations.usedCount} + 1`,
      })
      .where(
        and(
          eq(invitations.inviteCode, query.inviteCode),
          or(
            eq(invitations.maxUsage, -1),
            lt(invitations.usedCount, invitations.maxUsage),
          ),
        ),
      )
      .returning()
      .get();
  };
}
