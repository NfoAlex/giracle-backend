import { eq, sql } from "drizzle-orm";
import { db } from "..";
import { blockedIPAddresses } from "../db/schema";

export namespace QueryBlockedIPAddress {
  //ブロック済みIPアドレスを取得(存在確認用)
  export const getSingle = (query: { address: string }) => {
    return db.query.blockedIPAddresses.findFirst({
      where: eq(blockedIPAddresses.address, query.address),
    });
  };

  //アクセスを検知したIPアドレスのブロックカウントを加算する
  export const incrementByAddress = async (query: { address: string }) => {
    await db
      .update(blockedIPAddresses)
      .set({
        blockedCount: sql`${blockedIPAddresses.blockedCount} + 1`,
        latestAccess: new Date(),
      })
      .where(eq(blockedIPAddresses.address, query.address));
  };

  //IPアドレスをブロック登録(既に存在すればカウント加算)
  export const upsertByAddress = async (query: { address: string }) => {
    await db
      .insert(blockedIPAddresses)
      .values({ address: query.address, blockedCount: 1 })
      .onConflictDoUpdate({
        target: blockedIPAddresses.address,
        set: {
          blockedCount: sql`${blockedIPAddresses.blockedCount} + 1`,
          latestAccess: new Date(),
        },
      });
  };
}
