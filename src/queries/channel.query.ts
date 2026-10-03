import {
  and,
  eq,
  exists,
  inArray,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "..";
import {
  channelJoins,
  channels,
  channelViewableRoles,
  messageReadTimes,
} from "../db/schema";
import { Util } from "../Util";
import { QueryRoleLink } from "./roleLink.query";

export namespace QueryChannel {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //チャンネル本体
  export const getSingle = (query: { channelId: string }) => {
    return db.query.channels.findFirst({
      where: eq(channels.id, query.channelId),
    });
  };

  export const getSingleId = (query: { channelId: string }) => {
    return db.query.channels.findFirst({
      where: eq(channels.id, query.channelId),
      columns: { id: true },
    });
  };

  //チャンネル作成者Idのみ(可視判定用)
  export const getCreatedUserId = (query: { channelId: string }) => {
    return db
      .select({ createdUserId: channels.createdUserId })
      .from(channels)
      .where(eq(channels.id, query.channelId))
      .get();
  };

  export const getSingleWithViewableRole = (query: { channelId: string }) => {
    return db.query.channels.findFirst({
      where: eq(channels.id, query.channelId),
      with: {
        ChannelViewableRole: {
          columns: {
            roleId: true,
          },
        },
      },
    });
  };

  //チャンネル本体と指定ユーザーの既読時間(既読時間更新時の比較用)
  export const getSingleWithReadTime = (query: {
    channelId: string;
    userId: string;
  }) => {
    return db.query.channels.findFirst({
      where: eq(channels.id, query.channelId),
      with: {
        MessageReadTime: {
          where: and(
            eq(messageReadTimes.channelId, query.channelId),
            eq(messageReadTimes.userId, query.userId),
          ),
        },
      },
    });
  };

  export const getCursorChannel = (query: {
    cursorChannelId: string;
    viewableChannelIds: string[];
  }) => {
    return db
      .select({ name: channels.name })
      .from(channels)
      .where(
        and(
          eq(channels.id, query.cursorChannelId),
          inArray(channels.id, query.viewableChannelIds),
        ),
      )
      .get();
  };

  export const searchViewableChannels = async (query: {
    query: string;
    viewableChannelIds: string[];
    cursorChannelName?: string | undefined;
  }) => {
    return await db
      .select()
      .from(channels)
      .where(
        and(
          //ワイルドカード(%,_)を無効化してLIKE検索(item 15)
          sql`${channels.name} LIKE ${`${Util.escapeLikePattern(query.query)}%`} ESCAPE '\\'`,
          inArray(channels.id, query.viewableChannelIds),
          //NOCASEで畳むと別名が同値になるため、nameで決定的にタイブレークして取りこぼしを防ぐ
          query.cursorChannelName !== undefined
            ? sql`(${channels.name} COLLATE NOCASE, ${channels.name}) > (${query.cursorChannelName}, ${query.cursorChannelName})`
            : undefined,
        ),
      )
      .orderBy(sql`${channels.name} COLLATE NOCASE`, channels.name)
      .limit(50);
  };

  //最初のチャンネル(登録通知の送信先フォールバック用)
  export const getFirstChannel = () => {
    return db.query.channels.findFirst({
      columns: {
        id: true,
      },
    });
  };

  //ユーザーが閲覧できるチャンネル一覧(可視判定の合成。EXISTSサブクエリは検索内部条件のためここに置く)
  export const getViewable = async (query: { userId: string }) => {
    //ユーザーのロールを取得
    const userRolesLinks = await QueryRoleLink.getLinksByUser({
      userId: query.userId,
    });
    //ユーザーのロールIdを配列化
    const userRoleIds = userRolesLinks.map((role) => role.roleId);

    //manageServer権限を持つなら全チャンネルが見れる(CheckChannelVisibilityの判定と揃える)
    if (userRoleIds.length > 0) {
      const hasManageServer = QueryRoleLink.getManageServerLink({
        userId: query.userId,
      });
      if (hasManageServer !== undefined)
        return await db.select().from(channels);
    }

    //閲覧ロールが設定されているもので自分のロールがあるなら見れる
    const hasViewableRoleCondition =
      userRoleIds.length > 0
        ? exists(
            db
              .select()
              .from(channelViewableRoles)
              .where(
                and(
                  eq(channelViewableRoles.channelId, channels.id),
                  inArray(channelViewableRoles.roleId, userRoleIds),
                ),
              ),
          )
        : sql`false`;

    //チャンネルの閲覧限定ロールが設定されているもので、自分のロールが含まれないものは見れない
    const noUnviewableRoleCondition =
      userRoleIds.length > 0
        ? notExists(
            db
              .select()
              .from(channelViewableRoles)
              .where(
                and(
                  eq(channelViewableRoles.channelId, channels.id),
                  notInArray(channelViewableRoles.roleId, userRoleIds),
                ),
              ),
          )
        : notExists(
            db
              .select()
              .from(channelViewableRoles)
              .where(eq(channelViewableRoles.channelId, channels.id)),
          );

    const joinedCondition = exists(
      db
        .select()
        .from(channelJoins)
        .where(
          and(
            eq(channelJoins.channelId, channels.id),
            eq(channelJoins.userId, query.userId),
          ),
        ),
    );

    //このユーザーが見れるチャンネルを取得
    return await db
      .select()
      .from(channels)
      .where(
        or(
          //チャンネル作成者は見れる
          eq(channels.createdUserId, query.userId),
          hasViewableRoleCondition,
          noUnviewableRoleCondition,
          joinedCondition,
        ),
      );
  };

  //更新・作成
  export const updateChannel = async (query: {
    channelId: string;
    values: {
      name?: string;
      description?: string;
      isArchived?: boolean;
    };
  }) => {
    await db
      .update(channels)
      .set(query.values)
      .where(eq(channels.id, query.channelId));
  };

  export const insertChannel = async (query: {
    channelName: string;
    description: string;
    requestSender: string;
  }) => {
    const [newChannel] = await db
      .insert(channels)
      .values({
        name: query.channelName,
        description: query.description,
        createdUserId: query.requestSender,
      })
      .returning();

    return newChannel;
  };

  //トランザクション内でチャンネル本体を削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(channels).where(eq(channels.id, query.channelId)).run();
  };
}
