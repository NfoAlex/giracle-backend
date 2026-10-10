import { and, asc, eq, gt, inArray, not, or, sql } from "drizzle-orm";
import { db } from "..";
import { channelJoins, roleLinks, users } from "../db/schema";
import { Util } from "../Util";

export namespace QueryUser {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //ユーザー総数
  export const countAll = async () => {
    return await db.$count(users);
  };

  //2人目以降のユーザー(初回セットアップ判定用。1件も無ければundefined)
  export const getSecondUser = () => {
    return db.select().from(users).offset(1).limit(1).get();
  };

  //ユーザー単体(全列)
  export const getSingle = (query: { userId: string }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
    });
  };

  //存在確認・削除判定用の最低限取得
  export const getSingleWithMinimum = (query: { userId: string }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      columns: { id: true, isDeleted: true, isBanned: true },
    });
  };

  //パスワード付き取得(ユーザーId基準)
  export const getSingleWithPassword = (query: { userId: string }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      with: {
        password: true,
      },
    });
  };

  //ユーザー名基準の取得
  export const getSingleWithMinimumByName = (query: { name: string }) => {
    return db.query.users.findFirst({
      where: eq(users.name, query.name),
      columns: {
        id: true,
        name: true,
        isBanned: true,
        isDeleted: true,
      },
    });
  };

  //ユーザー名基準のパスワード付き取得(サインイン用)
  export const getSingleByNameWithPassword = (query: { name: string }) => {
    return db.query.users.findFirst({
      where: eq(users.name, query.name),
      with: {
        password: true,
      },
    });
  };

  //カーソル用(日付とIDのみ)
  export const getCursorUser = (query: { userId: string }) => {
    return db.query.users.findFirst({
      columns: { createdAt: true, id: true },
      where: eq(users.id, query.userId),
    });
  };

  //名前のみ(通知の送信者名表示用)
  export const getSingleName = (query: { userId: string }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      columns: { name: true },
    });
  };

  //ロール(権限)付き取得(ロールレベル計算用)
  export const getSingleWithRoles = (query: { userId: string }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      with: {
        RoleLink: {
          with: {
            role: true,
          },
        },
      },
    });
  };

  //指定チャンネルへの参加情報付き取得(チャンネル招待時の存在・重複確認用)
  export const getSingleWithChannelJoin = (query: {
    userId: string;
    channelId: string;
  }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      with: {
        ChannelJoin: {
          where: eq(channelJoins.channelId, query.channelId),
          columns: {
            userId: true,
          },
        },
      },
    });
  };

  //指定ロールのリンク情報付き取得(ロール付与・剥奪時の確認用)
  export const getSingleWithRoleLink = (query: {
    userId: string;
    roleId: string;
  }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      with: {
        RoleLink: {
          where: eq(roleLinks.roleId, query.roleId),
        },
      },
    });
  };

  //閲覧可能チャンネルの参加情報とロール付き取得(ユーザー情報表示用)
  export const getSingleWithChannelsAndRoles = (query: {
    userId: string;
    viewableChannelIds: string[];
  }) => {
    return db.query.users.findFirst({
      where: eq(users.id, query.userId),
      with: {
        ChannelJoin: {
          columns: {
            channelId: true,
          },
          where: inArray(channelJoins.channelId, query.viewableChannelIds),
        },
        RoleLink: {
          columns: {
            roleId: true,
          },
        },
      },
    });
  };

  //ユーザー一覧(カーソルページネーションと名前・参加チャンネル絞り込み付き)
  export const getList = async (query: {
    viewableChannelIds: string[];
    length: number;
    cursorUser?: { createdAt: Date; id: string } | undefined;
    username?: string | undefined;
    joinedChannel?: string | undefined;
  }) => {
    //検索条件を組み立て
    const conditions = [];
    if (query.username !== undefined) {
      //ワイルドカード(%,_)を無効化してLIKE検索(前方一致)
      const escapedQuery = Util.escapeLikePattern(query.username);
      conditions.push(
        sql`${users.name} LIKE ${`${escapedQuery}%`} ESCAPE '\\'`,
      );
    }
    if (query.joinedChannel !== undefined) {
      //指定チャンネルへ参加しているユーザーIdをサブクエリで絞る(空文字ならいずれかのチャンネルへ参加しているユーザー)
      conditions.push(
        inArray(
          users.id,
          db
            .select({ userId: channelJoins.userId })
            .from(channelJoins)
            .where(
              query.joinedChannel !== ""
                ? eq(channelJoins.channelId, query.joinedChannel)
                : undefined,
            ),
        ),
      );
    }

    return await db.query.users.findMany({
      where: and(
        not(eq(users.id, "SYSTEM")),
        //削除済みユーザーは除外
        eq(users.isDeleted, false),
        // 日付とユーザーId基準で取得
        query.cursorUser
          ? or(
              gt(users.createdAt, query.cursorUser.createdAt),
              // 同じ秒で作成されたとき用考慮
              and(
                eq(users.createdAt, query.cursorUser.createdAt),
                gt(users.id, query.cursorUser.id),
              ),
            )
          : undefined,
        // ユーザー名・参加チャンネルによる絞り込み
        conditions.length > 0 ? and(...conditions) : undefined,
      ),
      orderBy: [asc(users.createdAt), asc(users.id)],
      with: {
        ChannelJoin: {
          columns: {
            channelId: true,
          },
          where: inArray(channelJoins.channelId, query.viewableChannelIds),
        },
        RoleLink: {
          columns: {
            roleId: true,
          },
        },
      },
      limit: query.length,
    });
  };

  //トランザクション内でのユーザー作成(パスワード・ロールは呼び出し側で同一トランザクションに作る)
  export const insertInTx = (
    tx: Tx,
    query: { name: string; selfIntroduction: string; isBot?: boolean },
  ) => {
    return tx
      .insert(users)
      .values({
        name: query.name,
        selfIntroduction: query.selfIntroduction,
        isBot: query.isBot,
      })
      .returning()
      .get();
  };

  //プロフィール更新(指定された項目のみ更新)
  export const updateProfile = async (query: {
    userId: string;
    name?: string;
    selfIntroduction?: string;
  }) => {
    // 更新データの準備
    const updatingValue: { name?: string; selfIntroduction?: string } = {};
    if (query.name !== undefined) {
      updatingValue.name = query.name;
    }
    if (query.selfIntroduction !== undefined) {
      updatingValue.selfIntroduction = query.selfIntroduction;
    }

    const [userUpdated] = await db
      .update(users)
      .set(updatingValue)
      .where(eq(users.id, query.userId))
      .returning();

    return userUpdated;
  };

  //BAN/UNBAN
  export const setBanned = async (query: {
    userId: string;
    isBanned: boolean;
  }) => {
    const [userUpdated] = await db
      .update(users)
      .set({ isBanned: query.isBanned })
      .where(eq(users.id, query.userId))
      .returning();

    return userUpdated;
  };

  //論理削除
  export const setDeleted = async (query: { userId: string }) => {
    await db
      .update(users)
      .set({ isDeleted: true })
      .where(eq(users.id, query.userId));
  };
}
