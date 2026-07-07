import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  and,
  eq,
  exists,
  gte,
  inArray,
  like,
  max,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import { status } from "elysia";
import sharp from "sharp";
import { db } from "../..";
import type { Message } from "../../db/schema";
import {
  channelJoins,
  channels,
  inboxes,
  messageFileAttached,
  messageReactions,
  messageReadTimes,
  messages,
  messageUrlPreviews,
  roleInfos,
  roleLinks,
  serverConfigs,
} from "../../db/schema";
import { Util } from "../../Util";

export namespace ServiceMessage {
  export const Get = async (messageId: string, _userId: string) => {
    const messageData = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
    });
    //メッセージが見つからなければエラー
    if (messageData === undefined) {
      throw status(404, "Message not found");
    }

    //チャンネルの閲覧制限があるか確認してから返す
    if (!(await Util.checkChannelVisibility(messageData.channelId, _userId))) {
      throw status(404, "Message not found");
    }

    return messageData;
  };

  export const GetNew = async (_userId: string) => {
    // 参加チャンネルと既読時間を並列取得
    const [userChannelJoined, messageReadTime] = await Promise.all([
      db.query.channelJoins.findMany({
        where: eq(channelJoins.userId, _userId),
        columns: { channelId: true },
      }),
      db.query.messageReadTimes.findMany({
        where: eq(messageReadTimes.userId, _userId),
        columns: { channelId: true, readTime: true },
      }),
    ]);

    const channelIds = userChannelJoined.map((c) => c.channelId);
    if (channelIds.length === 0) return {};

    // チャンネルごとの最新createdAtをDB側で集約（groupByはDB集約なので軽い）
    const latestTimes = await db
      .select({
        channelId: messages.channelId,
        maxCreatedAt: max(messages.createdAt),
      })
      .from(messages)
      .where(inArray(messages.channelId, channelIds))
      .groupBy(messages.channelId);

    // 既読時間をMapに変換して参照
    const readTimeMap = new Map(
      messageReadTime.map((r) => [r.channelId, r.readTime]),
    );

    // _max.createdAt を直接比較して新着設定
    const JSONNews: { [key: string]: boolean } = {};
    for (const lt of latestTimes) {
      const latestCreatedAt = lt.maxCreatedAt;
      if (!latestCreatedAt) continue;

      const readTime = readTimeMap.get(lt.channelId);
      JSONNews[lt.channelId] = readTime
        ? new Date(latestCreatedAt).valueOf() > readTime.valueOf()
        : false;
    }

    return JSONNews;
  };

  export const GetReadTime = async (_userId: string) => {
    const readTime = await db.query.messageReadTimes.findMany({
      where: eq(messageReadTimes.userId, _userId),
    });
    //既読時間がない場合はエラー
    if (readTime === null) {
      throw status(404, "Read time not found");
    }

    return readTime;
  };

  export const UpdateReadTime = async (
    channelId: string,
    readTime: Date,
    _userId: string,
  ) => {
    const channelWithReadtime = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
      with: {
        MessageReadTime: {
          where: and(
            eq(messageReadTimes.channelId, channelId),
            eq(messageReadTimes.userId, _userId),
          ),
        },
      },
    });
    //チャンネルの存在確認
    if (channelWithReadtime === undefined) {
      throw status(404, "Channel not found");
    }
    //既読時間があるなら現在の既読時間と更新予定時間を比較
    if (channelWithReadtime.MessageReadTime.length !== 0) {
      //時間取得
      const readTimeNow = channelWithReadtime.MessageReadTime[0];
      //比較
      if (readTimeNow.readTime.valueOf() > readTime.valueOf()) {
        throw status(400, "Read time is already newer");
      }
    }

    const [readTimeUpdated] = await db
      .insert(messageReadTimes)
      .values({
        readTime,
        channelId,
        userId: _userId,
      })
      .onConflictDoUpdate({
        target: [messageReadTimes.channelId, messageReadTimes.userId],
        set: { readTime },
      })
      .returning();

    return readTimeUpdated;
  };

  export const Search = async (
    content: string | undefined,
    channelId: string | undefined,
    userId: string | undefined,
    hasUrlPreview: boolean | undefined,
    hasFileAttachment: boolean | undefined,
    loadIndex: number | undefined,
    _userId: string,
    sort: "asc" | "desc" | undefined = "desc",
  ) => {
    const SEARCH_PAGE_SIZE = 30;
    //読み込みインデックス指定があるならスキップするメッセ数を計算
    const messageSkipping = loadIndex ? (loadIndex - 1) * SEARCH_PAGE_SIZE : 0;

    //チャンネル指定が無かった時用のユーザーが閲覧できるチャンネルId配列
    let viewableChannelIds: string[] = [];
    //チャンネル指定があるなら閲覧制限を確認する、無いならユーザーが閲覧できるチャンネルを取得
    if (channelId) {
      //チャンネルの閲覧制限があるか確認
      if (!(await Util.checkChannelVisibility(channelId, _userId))) {
        throw status(403, "You are not allowed to view this channel");
      }
    } else {
      const viewableChannels = await Util.getUserViewableChannel(
        _userId,
        false,
      );
      viewableChannelIds = viewableChannels.map((channel) => channel.id);
    }

    //URLプレビュー/ファイル添付があるかどうかの条件を変換
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
    const channelCondition = channelId
      ? eq(messages.channelId, channelId)
      : viewableChannelIds.length > 0
        ? inArray(messages.channelId, viewableChannelIds)
        : sql`false`;

    const conditions: (SQL | undefined)[] = [
      content !== undefined
        ? like(messages.content, `%${content}%`)
        : undefined,
      channelCondition,
      userId !== undefined ? eq(messages.userId, userId) : undefined,
      relationOptionGetter(hasUrlPreview, messageUrlPreviews),
      relationOptionGetter(hasFileAttachment, messageFileAttached),
    ];

    //メッセージを検索する
    const foundMessages = await db.query.messages.findMany({
      where: and(...conditions.filter((c): c is SQL => c !== undefined)),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      limit: SEARCH_PAGE_SIZE,
      offset: messageSkipping,
      orderBy: (t, { asc, desc }) =>
        sort === "asc" ? asc(t.createdAt) : desc(t.createdAt),
    });

    return foundMessages;
  };

  export const UploadFile = async (
    channelId: string,
    file: File,
    _userId: string,
  ) => {
    const joinedChannel = await db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, _userId),
        eq(channelJoins.channelId, channelId),
      ),
    });
    console.log("message.service :: UploadFile : ", { joinedChannel });
    if (joinedChannel === undefined)
      throw status(400, "You are not joined to this channel");

    //サーバー設定からメッセージの最大ファイルサイズを取得
    const serverConfig = await db.query.serverConfigs.findFirst();
    const maxFileSize = serverConfig?.MessageMaxFileSize ?? 1024 * 1024 * 100;
    //ファイルサイズが最大ファイルサイズを超える場合はエラー
    if (file.size > maxFileSize) {
      throw status(400, "File size is too large");
    }

    //channelIdにパス要素が混入していないか検証(パストラバーサル対策)
    if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      throw status(400, "Invalid channelId");
    }

    //ファイル名からディレクトリ要素を除去(パストラバーサル対策)
    const safeFileName = path.basename(file.name).replace(/[/\\]/g, "_");
    //保存するためのファイル名保存
    const fileNameGen = `${Date.now()}_${safeFileName}`;
    //チャンネルIdのディレクトリを作成
    await mkdir(`./STORAGE/file/${channelId}`, { recursive: true }).catch(
      () => {},
    );

    //console.log("message.module :: /file/upload : file.type->", file.type);
    //webpファイルであるかどうかフラグ
    let isWebp = false;

    //ファイルを保存する
    if (file.type.startsWith("image/") && file.type !== "image/gif") {
      const buffer = Buffer.from(await file.arrayBuffer());
      await sharp(buffer)
        .rotate()
        .webp({ quality: 95 })
        .toFile(`./STORAGE/file/${channelId}/${fileNameGen}.webp`);
      //webpで保存されたことと設定
      isWebp = true;
    } else if (file.type === "image/gif") {
      const buffer = Buffer.from(await file.arrayBuffer());
      await sharp(buffer, { animated: true })
        .gif({
          colours: 128, // 色数を128に削減
          dither: 0, // ディザリングを無効化
          effort: 7, // パレット生成の計算量を設定
        })
        .toFile(`./STORAGE/file/${channelId}/${fileNameGen}`);
    } else {
      //ファイルを保存
      await Bun.write(`./STORAGE/file/${channelId}/${fileNameGen}`, file);
    }

    //ファイル情報を作成、保存する
    const [fileData] = await db
      .insert(messageFileAttached)
      .values({
        channelId,
        userId: _userId,
        size: file.size,
        actualFileName: isWebp ? `${file.name}.webp` : file.name,
        savedFileName: isWebp ? `${fileNameGen}.webp` : fileNameGen,
        type: isWebp ? "image/webp" : file.type,
      })
      .returning({ id: messageFileAttached.id });

    return fileData;
  };

  export const GetFile = async (fileId: string, _userId: string) => {
    const fileData = await db.query.messageFileAttached.findFirst({
      where: eq(messageFileAttached.id, fileId),
    });
    if (fileData === undefined) {
      throw status(404, "File not found");
    }

    const canView = await Util.checkChannelVisibility(
      fileData?.channelId,
      _userId,
    );
    if (!canView) {
      throw status(400, "This file is hidden in private channel");
    }

    return fileData;
  };

  export const Delete = async (messageId: string, _userId: string) => {
    //取得
    const messageData = await db.query.messages.findFirst({
      columns: {
        id: true,
        userId: true,
        channelId: true,
      },
      where: eq(messages.id, messageId),
    });
    if (messageData === undefined) {
      throw status(404, "Message not found");
    }
    if (messageData.userId !== _userId) {
      //メッセージの送信者でないならサーバー管理権限を確認する
      const canManageServer = await db
        .select({ userId: roleLinks.userId })
        .from(roleLinks)
        .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
        .where(
          and(eq(roleLinks.userId, _userId), eq(roleInfos.manageServer, true)),
        )
        .get();

      if (!canManageServer)
        throw status(403, "You are not owner of this message");
    }

    //URLプレビューの削除
    await db
      .delete(messageUrlPreviews)
      .where(eq(messageUrlPreviews.messageId, messageId));
    //ファイル情報の取得、削除
    const fileData = await db.query.messageFileAttached.findMany({
      where: eq(messageFileAttached.messageId, messageId),
    });
    for (const file of fileData) {
      try {
        await unlink(`./STORAGE/file/${file.channelId}/${file.savedFileName}`);
      } catch (e) {
        console.error("message.module :: /message/delete : 削除エラー->", e);
      }
    }
    //リアクションデータを削除
    await db
      .delete(messageReactions)
      .where(eq(messageReactions.messageId, messageId));
    //添付ファイル情報の削除
    await db
      .delete(messageFileAttached)
      .where(eq(messageFileAttached.messageId, messageId));
    //このメッセージからできているInboxデータの削除
    await db.delete(inboxes).where(eq(inboxes.messageId, messageId));

    //メッセージの削除
    await db.delete(messages).where(eq(messages.id, messageId));

    return messageData;
  };

  export const GetInbox = async (_userId: string) => {
    //通知を取得する
    const inboxAll = await db.query.inboxes.findMany({
      where: eq(inboxes.userId, _userId),
      with: {
        Message: true,
      },
    });

    return inboxAll;
  };

  export const ReadInbox = async (messageId: string, _userId: string) => {
    //通知を削除
    const deleted = await db
      .delete(inboxes)
      .where(and(eq(inboxes.messageId, messageId), eq(inboxes.userId, _userId)))
      .returning()
      .catch((e) => {
        console.error(
          "message.module :: /message/inbox/read : 削除エラー->",
          e,
        );
        throw status(404, "Inbox not found");
      });

    if (deleted.length === 0) {
      throw status(404, "Inbox not found");
    }

    return;
  };

  export const ClearInbox = async (_userId: string) => {
    //通知を全部削除
    await db.delete(inboxes).where(eq(inboxes.userId, _userId));

    return;
  };

  export const Reaction = async (
    messageId: string,
    channelId: string,
    emojiCode: string,
    _userId: string,
  ) => {
    //チャンネルの閲覧制限があるか確認する
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Message not found");
    }

    //自分のリアクションデータを取得して条件確認する
    const targetMessage = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageReaction: {
          columns: {
            id: true,
            emojiCode: true,
          },
          where: eq(messageReactions.userId, _userId),
        },
      },
    });
    //メッセージが存在しなければエラー
    if (targetMessage === undefined) {
      throw status(404, "Message not found");
    }
    //自分による同じ絵文字コードのリアクションがあればエラー
    if (targetMessage.MessageReaction.some((r) => r.emojiCode === emojiCode)) {
      throw status(400, "You already reacted this message");
    }
    //自分のリアクションが10以上ならエラー
    if (targetMessage.MessageReaction.length >= 10) {
      throw status(400, "You can't react more than 10 times");
    }

    //リアクションを格納
    const [reaction] = await db
      .insert(messageReactions)
      .values({
        messageId,
        userId: _userId,
        channelId,
        emojiCode,
      })
      .returning();

    return reaction;
  };

  export const GetWhoReacted = async (
    messageId: string,
    emojiCode: string,
    _userId: string,
    cursor = 1,
  ) => {
    //スキップ数と取得数を設定
    const skip = (cursor - 1) * 30;
    const length = 30;
    //メッセージが存在するか確認
    const message = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageReaction: {
          offset: skip,
          limit: length,
          columns: {
            userId: true,
          },
          where: eq(messageReactions.emojiCode, emojiCode),
        },
      },
    });
    if (message === undefined) {
      throw status(400, "Message not found or is private");
    }

    //チャンネルの閲覧制限があるか確認
    const viewable = await Util.checkChannelVisibility(
      message.channelId,
      _userId,
    );
    if (!viewable) {
      throw status(400, "Message not found or is private");
    }

    return message;
  };

  export const DeleteEmojiReaction = async (
    messageId: string,
    emojiCode: string,
    _userId: string,
  ) => {
    const messageWithReaction = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageReaction: {
          where: and(
            eq(messageReactions.userId, _userId),
            eq(messageReactions.emojiCode, emojiCode),
          ),
        },
      },
    });
    //メッセージの存在確認
    if (messageWithReaction === undefined) {
      throw status(404, "Message not found");
    }
    //自分による指定リアクションの存在確認
    if (messageWithReaction.MessageReaction.length === 0) {
      throw status(404, "Reaction does not exists");
    }

    //リアクションを削除
    const [reactionDeleted] = await db
      .delete(messageReactions)
      .where(eq(messageReactions.id, messageWithReaction.MessageReaction[0].id))
      .returning();

    return reactionDeleted;
  };

  export const Send = async (
    channelId: string,
    message: string,
    // biome-ignore lint/style/useDefaultParameterLast: 許して
    fileIds: string[] = [],
    replyingMessageId: string | undefined,
    _userId: string,
  ) => {
    //メッセージが空白か改行しか含まれていないならエラー(ファイル添付があるなら除外)
    const spaceCount =
      (message.match(/ /g) || "").length +
      (message.match(/　/g) || "").length +
      (message.match(/\n/g) || "").length;
    if (spaceCount === message.length && fileIds.length === 0)
      throw status(400, "Message is empty");

    //チャンネル参加情報を取得
    const channelJoined = await db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, _userId),
        eq(channelJoins.channelId, channelId),
      ),
    });
    //チャンネルに参加していない
    if (channelJoined === undefined) {
      throw status(400, "You are not joined this channel");
    }

    //返信先メッセージ用変数(メッセージ保存処理後に使用)
    let messageReplyingTo: Message | undefined;
    //返信先メッセージがあるなら存在するか確認
    if (replyingMessageId) {
      messageReplyingTo = await db.query.messages.findFirst({
        where: eq(messages.id, replyingMessageId),
      });
      //返信先メッセージが存在しないならエラー
      if (messageReplyingTo === undefined) {
        throw status(400, "Replying message not found");
      }
      //返信先メッセージがこのチャンネルに存在するか確認
      if (messageReplyingTo.channelId !== channelId) {
        throw status(400, "Replying message not found in this channel");
      }
    }

    //アップロードしているファイルId配列があるならファイル情報を取得
    const fileData =
      fileIds.length > 0
        ? await db.query.messageFileAttached.findMany({
            where: inArray(messageFileAttached.id, fileIds),
          })
        : [];

    //メッセージを保存
    const [messageSavedRow] = await db
      .insert(messages)
      .values({
        channelId,
        userId: _userId,
        content: message,
        replyingMessageId: replyingMessageId ?? undefined,
      })
      .returning();

    //アップロード済みファイルをこのメッセージに紐付ける(Prismaのconnect相当)
    if (fileData.length > 0) {
      await db
        .update(messageFileAttached)
        .set({ messageId: messageSavedRow.id })
        .where(
          inArray(
            messageFileAttached.id,
            fileData.map((f) => f.id),
          ),
        );
    }

    const messageSaved = await db.query.messages.findFirst({
      where: eq(messages.id, messageSavedRow.id),
      with: {
        MessageFileAttached: true,
      },
    });
    if (messageSaved === undefined) {
      throw status(500, "Internal Server Error");
    }

    //メッセージから "@<userId>" を検知
    const mentionedUserIds =
      message.match(/@<([\w-]+)>/g)?.map((mention) => mention.slice(2, -1)) ||
      [];
    const mentionedUserIdsMerged = [...new Set(mentionedUserIds)];

    //DBに保存するInbox用データを作成
    const savingInboxData = [];
    for (const mentionedUserId of mentionedUserIdsMerged) {
      savingInboxData.push({
        userId: mentionedUserId,
        messageId: messageSaved.id,
        type: "mention",
      });
    }
    //inboxに保存
    if (savingInboxData.length > 0) {
      await db.insert(inboxes).values(savingInboxData);
    }

    return { messageSaved, messageReplyingTo, mentionedUserIds };
  };

  export const Edit = async (
    messageId: string,
    message: string,
    _userId: string,
  ) => {
    const messageEditing = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
    });
    //メッセージが無かった時エラー
    if (messageEditing === undefined) {
      throw status(404, "Message not found");
    }
    //送信者が自分と違うならエラー
    if (messageEditing.userId !== _userId) {
      throw status(403, "You are not sender of this message");
    }
    //内容が同じならエラー
    if (messageEditing.content === message) {
      throw status(400, "Message is already same");
    }

    //メッセージデータを更新する
    const [msgUpdated] = await db
      .update(messages)
      .set({
        content: message,
        isEdited: true,
      })
      .where(eq(messages.id, messageId))
      .returning();

    return msgUpdated;
  };
}
