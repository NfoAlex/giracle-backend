import {
  and,
  eq,
  exists,
  gte,
  inArray,
  lte,
  max,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "..";
import {
  messageFileAttached,
  messageReactions,
  messages,
  messageUrlPreviews,
} from "../db/schema";
import { Util } from "../Util";
import { QueryInbox } from "./inbox.query";
import { QueryMessageFileAttached } from "./messageFileAttached.query";
import { QueryMessageReaction } from "./messageReaction.query";
import { QueryMessageUrlPreview } from "./messageUrlPreview.query";

export namespace QueryMessage {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  const SEARCH_PAGE_SIZE = 30;

  //メッセージ単体(呼び出し元が必要とする列ごとに分ける)
  export const getSingle = (query: { messageId: string }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
    });
  };

  //メッセージの存在確認や基本情報確認用の最低限取得
  export const getSingleWithMinimum = (query: { messageId: string }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
      columns: { id: true, userId: true, channelId: true },
    });
  };

  export const getSingleWithRelations = (query: { messageId: string }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
    });
  };

  export const getSingleWithFiles = (query: { messageId: string }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
      with: {
        MessageFileAttached: true,
      },
    });
  };

  export const getSingleWithPreviews = (query: { messageId: string }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
      with: {
        MessageUrlPreview: true,
      },
    });
  };

  export const getSingleWithOwnReaction = (query: {
    messageId: string;
    channelId: string;
    userId: string;
  }) => {
    return db.query.messages.findFirst({
      where: and(
        eq(messages.id, query.messageId),
        eq(messages.channelId, query.channelId),
      ),
      with: {
        MessageReaction: {
          columns: {
            id: true,
            emojiCode: true,
          },
          where: eq(messageReactions.userId, query.userId),
        },
      },
    });
  };

  export const getSingleWithOwnReactionByEmoji = (query: {
    messageId: string;
    userId: string;
    emojiCode: string;
  }) => {
    return db.query.messages.findFirst({
      where: eq(messages.id, query.messageId),
      with: {
        MessageReaction: {
          where: and(
            eq(messageReactions.userId, query.userId),
            eq(messageReactions.emojiCode, query.emojiCode),
          ),
        },
      },
    });
  };

  //一覧・集約
  export const getLatestCreatedAtByChannel = (query: {
    channelIds: string[];
  }) => {
    return db
      .select({
        channelId: messages.channelId,
        maxCreatedAt: max(messages.createdAt),
      })
      .from(messages)
      .where(inArray(messages.channelId, query.channelIds))
      .groupBy(messages.channelId);
  };

  export const getHistory = (query: {
    channelId: string;
    timeFrom: Date | undefined;
    fetchNewer: boolean;
    fetchLength: number | undefined;
  }) => {
    return db.query.messages.findMany({
      where:
        query.timeFrom !== undefined
          ? and(
              eq(messages.channelId, query.channelId),
              query.fetchNewer
                ? gte(messages.createdAt, query.timeFrom)
                : lte(messages.createdAt, query.timeFrom),
            )
          : eq(messages.channelId, query.channelId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      limit: query.fetchLength,
      orderBy: (t, { asc, desc }) =>
        query.fetchNewer ? asc(t.createdAt) : desc(t.createdAt),
    });
  };

  export const getOldestId = (query: { channelId: string }) => {
    return db.query.messages.findFirst({
      columns: { id: true },
      where: eq(messages.channelId, query.channelId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
  };

  export const getNewestId = (query: { channelId: string }) => {
    return db.query.messages.findFirst({
      columns: { id: true },
      where: eq(messages.channelId, query.channelId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  };

  //メッセージ検索
  export const search = (query: {
    content?: string | undefined;
    channelId?: string | undefined;
    viewableChannelIds: string[];
    userId?: string | undefined;
    hasUrlPreview?: boolean | undefined;
    hasFileAttachment?: boolean | undefined;
    loadIndex?: number | undefined;
    sort?: "asc" | "desc" | undefined;
  }) => {
    //読み込みインデックス指定があるならスキップするメッセ数を計算
    const messageSkipping = query.loadIndex
      ? (query.loadIndex - 1) * SEARCH_PAGE_SIZE
      : 0;

    //URLプレビュー/ファイル添付があるかどうかの条件を変換
    //EXISTSサブクエリはmessages検索の内部条件のため、専用のQuery層は作らない
    const relationOptionGetter = (
      _opt: boolean | undefined,
      relTable: typeof messageUrlPreviews | typeof messageFileAttached,
    ) => {
      switch (_opt) {
        case undefined:
          return undefined;
        case true:
          return exists(
            db
              .select()
              .from(relTable)
              .where(eq(relTable.messageId, messages.id)),
          );
        case false:
          return notExists(
            db
              .select()
              .from(relTable)
              .where(eq(relTable.messageId, messages.id)),
          );
      }
    };

    //チャンネル条件(指定が無い場合は閲覧可能チャンネルに限定、0件なら結果無し)
    const channelCondition = query.channelId
      ? eq(messages.channelId, query.channelId)
      : query.viewableChannelIds.length > 0
        ? inArray(messages.channelId, query.viewableChannelIds)
        : sql`false`;

    const conditions: (SQL | undefined)[] = [
      query.content !== undefined
        ? sql`${messages.content} LIKE ${`%${Util.escapeLikePattern(query.content)}%`} ESCAPE '\\'`
        : undefined,
      channelCondition,
      query.userId !== undefined
        ? eq(messages.userId, query.userId)
        : undefined,
      relationOptionGetter(query.hasUrlPreview, messageUrlPreviews),
      relationOptionGetter(query.hasFileAttachment, messageFileAttached),
    ];

    return db.query.messages.findMany({
      where: and(...conditions.filter((c): c is SQL => c !== undefined)),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      limit: SEARCH_PAGE_SIZE,
      offset: messageSkipping,
      orderBy: (t, { asc, desc }) =>
        query.sort === "asc" ? asc(t.createdAt) : desc(t.createdAt),
    });
  };

  //更新・作成
  export const insertMessage = async (query: {
    channelId: string;
    userId: string;
    content: string;
    isSystemMessage?: boolean;
    replyingMessageId?: string | undefined;
  }) => {
    const [row] = await db
      .insert(messages)
      .values({
        channelId: query.channelId,
        userId: query.userId,
        content: query.content,
        isSystemMessage: query.isSystemMessage ?? false,
        replyingMessageId: query.replyingMessageId ?? undefined,
      })
      .returning();

    return row;
  };

  export const updateMessage = async (query: {
    messageId: string;
    content: string;
  }) => {
    const [row] = await db
      .update(messages)
      .set({
        content: query.content,
        isEdited: true,
      })
      .where(eq(messages.id, query.messageId))
      .returning({
        id: messages.id,
        channelId: messages.channelId,
        content: messages.content,
        isEdited: messages.isEdited,
        userId: messages.userId,
      });

    return row;
  };

  //メッセージに紐づく子データ(inboxのrestrict FKを含む)を子→親の順に1トランザクションで削除
  export const deleteMessage = (query: { messageId: string }) => {
    db.transaction((tx) => {
      QueryMessageUrlPreview.removeByMessageInTx(tx, {
        messageId: query.messageId,
      });
      QueryMessageReaction.removeByMessageInTx(tx, {
        messageId: query.messageId,
      });
      QueryMessageFileAttached.removeByMessageInTx(tx, {
        messageId: query.messageId,
      });
      QueryInbox.removeByMessageInTx(tx, { messageId: query.messageId });
      tx.delete(messages).where(eq(messages.id, query.messageId)).run();
    });
  };

  //呼び出し側のトランザクション内でチャンネル配下のメッセージを削除する
  export const removeByChannelInTx = (tx: Tx, query: { channelId: string }) => {
    tx.delete(messages).where(eq(messages.channelId, query.channelId)).run();
  };
}
