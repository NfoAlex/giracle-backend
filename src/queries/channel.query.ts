import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "..";
import { channelJoins, channels, channelViewableRoles } from "../db/schema";
import { Util } from "../Util";

export namespace QueryChannel {
  //参加情報
  export const getJoin = (query: { channelId: string; userId: string }) => {
    return db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, query.userId),
        eq(channelJoins.channelId, query.channelId),
      ),
    });
  };

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

  export const insertJoin = async (query: {
    channelId: string;
    userId: string;
  }) => {
    await db.insert(channelJoins).values({
      userId: query.userId,
      channelId: query.channelId,
    });
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

  //TODO: 分離
  export const getJoinsByChannel = async (query: { channelId: string }) => {
    return await db.query.channelJoins.findMany({
      where: eq(channelJoins.channelId, query.channelId),
    });
  };

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

  export const replaceViewableRoles = async (query: {
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
}
