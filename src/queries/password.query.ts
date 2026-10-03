import { eq } from "drizzle-orm";
import { db } from "..";
import { passwords } from "../db/schema";

export namespace QueryPassword {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //ユーザーのパスワードを更新
  export const updatePassword = async (query: {
    userId: string;
    password: string;
  }) => {
    await db
      .update(passwords)
      .set({ password: query.password })
      .where(eq(passwords.userId, query.userId));
  };

  //トランザクション内でユーザーのパスワードとソルトを更新する
  export const updateInTx = (
    tx: Tx,
    query: { userId: string; password: string; salt: string },
  ) => {
    tx.update(passwords)
      .set({ password: query.password, salt: query.salt })
      .where(eq(passwords.userId, query.userId))
      .run();
  };

  //トランザクション内でユーザーのパスワードを作成する
  export const insertInTx = (
    tx: Tx,
    query: { userId: string; password: string; salt: string },
  ) => {
    tx.insert(passwords)
      .values({
        userId: query.userId,
        password: query.password,
        salt: query.salt,
      })
      .run();
  };
}
