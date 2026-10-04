import { and, eq, not } from "drizzle-orm";
import { db } from "..";
import { tokens } from "../db/schema";

export namespace QueryToken {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //トークン単体(全列)
  export const getSingle = (query: { token: string }) => {
    return db.query.tokens.findFirst({
      where: eq(tokens.token, query.token),
    });
  };

  //トークンとBAN状態(認証時用)
  export const getSingleWithUser = (query: { token: string }) => {
    return db.query.tokens.findFirst({
      where: eq(tokens.token, query.token),
      columns: {
        userId: true,
        expiresAt: true,
      },
      with: {
        user: {
          columns: {
            isBanned: true,
          },
        },
      },
    });
  };

  //トークンと参加チャンネル(WS接続用)
  export const getSingleWithUserChannels = (query: { token: string }) => {
    return db.query.tokens.findFirst({
      where: eq(tokens.token, query.token),
      columns: { expiresAt: true },
      with: {
        user: {
          with: {
            ChannelJoin: {
              columns: {
                channelId: true,
              },
            },
          },
          columns: {
            id: true,
            isBanned: true,
          },
        },
      },
    });
  };

  //トークン存在確認・匿名判定用のユーザーId(レート制限用)
  export const getSingleWithUserId = (query: { token: string }) => {
    return db.query.tokens.findFirst({
      where: eq(tokens.token, query.token),
      columns: { userId: true },
    });
  };

  //Id・ユーザー単位のトークン(セッション削除時の存在確認用)
  export const getSingleByIdAndUser = (query: {
    sessionId: number;
    userId: string;
  }) => {
    return db.query.tokens.findFirst({
      where: and(
        eq(tokens.id, query.sessionId),
        eq(tokens.userId, query.userId),
      ),
    });
  };

  //ユーザーのセッション一覧(ページネーション付き)
  export const getListByUser = (query: {
    userId: string;
    limit: number;
    offset: number;
  }) => {
    return db.query.tokens.findMany({
      where: eq(tokens.userId, query.userId),
      limit: query.limit,
      offset: query.offset,
    });
  };

  //ユーザーのトークン文字列一覧(キャッシュ無効化用)
  export const getTokensByUser = async (query: { userId: string }) => {
    return await db
      .select({ token: tokens.token })
      .from(tokens)
      .where(eq(tokens.userId, query.userId));
  };

  //トークンを発行
  export const insertToken = async (query: {
    token: string;
    userId: string;
  }) => {
    const [tokenGenerated] = await db
      .insert(tokens)
      .values({
        token: query.token,
        userId: query.userId,
      })
      .returning();

    return tokenGenerated;
  };

  //セッション名を更新(対象0件ならundefined)
  export const updateName = async (query: {
    sessionId: number;
    userId: string;
    name: string;
  }) => {
    const [newSession] = await db
      .update(tokens)
      .set({ name: query.name })
      .where(
        and(eq(tokens.id, query.sessionId), eq(tokens.userId, query.userId)),
      )
      .returning();

    return newSession;
  };

  //トークンを削除(サインアウト・レート制限超過時)
  export const removeByToken = async (query: { token: string }) => {
    await db.delete(tokens).where(eq(tokens.token, query.token));
  };

  //Id・ユーザー単位でトークンを削除
  export const removeByIdAndUser = async (query: {
    sessionId: number;
    userId: string;
  }) => {
    await db
      .delete(tokens)
      .where(
        and(eq(tokens.id, query.sessionId), eq(tokens.userId, query.userId)),
      );
  };

  //ユーザーの全トークンを削除
  export const removeByUser = async (query: { userId: string }) => {
    await db.delete(tokens).where(eq(tokens.userId, query.userId));
  };

  //現在のセッションを除いてユーザーのトークンを削除(パスワード変更時)
  export const removeByUserExceptToken = async (query: {
    userId: string;
    exceptToken: string;
  }) => {
    await db
      .delete(tokens)
      .where(
        and(
          eq(tokens.userId, query.userId),
          not(eq(tokens.token, query.exceptToken)),
        ),
      );
  };

  //トランザクション内でユーザーの全トークンを削除する
  export const removeByUserInTx = (tx: Tx, query: { userId: string }) => {
    tx.delete(tokens).where(eq(tokens.userId, query.userId)).run();
  };
}
