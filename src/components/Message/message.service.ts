import { mkdir } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { status } from "elysia";
import sharp from "sharp";
import { db } from "../..";
import type { Message } from "../../../prisma/generated/client";
import CheckChannelVisibility from "../../Utils/CheckChannelVisitiblity";
import GetUserViewableChannel from "../../Utils/GetUserViewableChannel";

export namespace ServiceMessage {
  export const Get = async (messageId: string, _userId: string) => {
    const messageData = await db.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        MessageUrlPreview: true,
      },
    });
    //メッセージが見つからなければエラー
    if (messageData === null) {
      throw status(404, "Message not found");
    }

    //チャンネルの閲覧制限があるか確認してから返す
    if (!(await CheckChannelVisibility(messageData.channelId, _userId))) {
      throw status(404, "Message not found");
    }

    return messageData;
  };

  export const GetNew = async (_userId: string) => {
    // 参加チャンネルと既読時間を並列取得
    const [userChannelJoined, messageReadTime] = await Promise.all([
      db.channelJoin.findMany({
        where: { userId: _userId },
        select: { channelId: true },
      }),
      db.messageReadTime.findMany({
        where: { userId: _userId },
        select: { channelId: true, readTime: true },
      }),
    ]);

    const channelIds = userChannelJoined.map((c) => c.channelId);
    if (channelIds.length === 0) return {};

    // チャンネルごとの最新createdAtをDB側で集約（groupByはDB集約なので軽い）
    const latestTimes = await db.message.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds } },
      _max: { createdAt: true },
    });

    // 既読時間をMapに変換して参照
    const readTimeMap = new Map(
      messageReadTime.map((r) => [r.channelId, r.readTime]),
    );

    // _max.createdAt を直接比較して新着設定
    const JSONNews: { [key: string]: boolean } = {};
    for (const lt of latestTimes) {
      const latestCreatedAt = lt._max.createdAt;
      if (!latestCreatedAt) continue;

      const readTime = readTimeMap.get(lt.channelId);
      JSONNews[lt.channelId] = readTime
        ? latestCreatedAt.valueOf() > readTime.valueOf()
        : false;
    }

    return JSONNews;
  };

  export const GetReadTime = async (_userId: string) => {
    const readTime = await db.messageReadTime.findMany({
      where: {
        userId: _userId,
      },
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
    const channelWithReadtime = await db.channel.findUnique({
      where: {
        id: channelId,
      },
      include: {
        MessageReadTime: {
          where: {
            channelId: channelId,
            userId: _userId,
          },
        },
      },
    });
    //チャンネルの存在確認
    if (channelWithReadtime === null) {
      throw status(404, "Channel not found");
    }
    //既読時間があるなら現在の既読時間と更新予定時間を比較
    if (channelWithReadtime.MessageReadTime.length !== 0) {
      //時間取得
      const readTimeNow = channelWithReadtime.MessageReadTime[0];
      //比較
      if (
        readTimeNow !== null &&
        readTimeNow.readTime.valueOf() > readTime.valueOf()
      ) {
        throw status(400, "Read time is already newer");
      }
    }

    const readTimeUpdated = await db.messageReadTime.upsert({
      where: {
        channelId_userId: {
          channelId,
          userId: _userId,
        },
      },
      create: {
        readTime,
        channelId,
        userId: _userId,
      },
      update: {
        readTime,
      },
    });

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
      if (!(await CheckChannelVisibility(channelId, _userId))) {
        throw status(403, "You are not allowed to view this channel");
      }
    } else {
      const viewableChannels = await GetUserViewableChannel(_userId, false);
      viewableChannelIds = viewableChannels.map((channel) => channel.id);
    }

    //URLプレビューがあるかどうかの条件を変換
    const relationOptionGetter = (_opt: boolean | undefined) => {
      switch (_opt) {
        case undefined:
          return undefined;
        case true:
          return {
            some: {},
          };
        case false:
          return {
            none: {},
          };
      }
    };

    //メッセージを検索する
    const messages = await db.message.findMany({
      where: {
        content: {
          contains: content,
        },
        channelId: channelId
          ? { equals: channelId }
          : { in: viewableChannelIds },
        userId: userId ? { equals: userId } : undefined,
        MessageUrlPreview: relationOptionGetter(hasUrlPreview),
        MessageFileAttached: relationOptionGetter(hasFileAttachment),
      },
      include: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      take: SEARCH_PAGE_SIZE,
      skip: messageSkipping,
      orderBy: {
        createdAt: sort,
      },
    });

    return messages;
  };

  export const UploadFile = async (
    channelId: string,
    file: File,
    _userId: string,
  ) => {
    //サーバー設定からメッセージの最大ファイルサイズを取得
    const serverConfig = await db.serverConfig.findFirst();
    const maxFileSize = serverConfig?.MessageMaxFileSize ?? 1024 * 1024 * 100;
    //ファイルサイズが最大ファイルサイズを超える場合はエラー
    if (file.size > maxFileSize) {
      throw status(400, "File size is too large");
    }

    //保存するためのファイル名保存
    const fileNameGen = `${Date.now()}_${file.name}`;
    //チャンネルIdのディレクトリを作成
    await mkdir(`./STORAGE/file/${channelId}`, { recursive: true }).catch(
      () => { },
    );

    //console.log("message.module :: /file/upload : file.type->", file.type);
    //webpファイルであるかどうかフラグ
    let isWebp = false;

    //ファイルを保存する
    if (file.type.startsWith("image/") && file.type !== "image/gif") {
      await sharp(await file.arrayBuffer())
        .rotate()
        .webp({ quality: 95 })
        .toFile(`./STORAGE/file/${channelId}/${fileNameGen}.webp`);
      //webpで保存されたことと設定
      isWebp = true;
    } else if (file.type === "image/gif") {
      await sharp(await file.arrayBuffer(), { animated: true })
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
    const fileData = await db.messageFileAttached.create({
      data: {
        channelId,
        userId: _userId,
        size: file.size,
        actualFileName: isWebp ? `${file.name}.webp` : file.name,
        savedFileName: isWebp ? `${fileNameGen}.webp` : fileNameGen,
        type: isWebp ? "image/webp" : file.type,
      },
      select: {
        id: true,
      },
    });

    return fileData;
  };

  export const GetFile = async (fileId: string) => {
    const fileData = await db.messageFileAttached.findUnique({
      where: {
        id: fileId,
      },
    });

    if (fileData === null) {
      throw status(404, "File not found");
    }

    return fileData;
  };

  export const Delete = async (messageId: string, _userId: string) => {
    //取得
    const messageData = await db.message.findUnique({
      select: {
        id: true,
        userId: true,
        channelId: true,
      },
      where: {
        id: messageId,
      },
    });
    if (messageData === null) {
      throw status(404, "Message not found");
    }
    if (messageData.userId !== _userId) {
      //メッセージの送信者でないならサーバー管理権限を確認する
      const canManageServer = await db.roleLink.findFirst({
        where: {
          userId: _userId,
          role: {
            manageServer: true,
          },
        },
      });

      if (!canManageServer)
        throw status(403, "You are not owner of this message");
    }

    //URLプレビューの削除
    await db.messageUrlPreview.deleteMany({
      where: {
        messageId,
      },
    });
    //ファイル情報の取得、削除
    const fileData = await db.messageFileAttached.findMany({
      where: {
        messageId,
      },
    });
    for (const file of fileData) {
      try {
        await unlink(`./STORAGE/file/${file.channelId}/${file.savedFileName}`);
      } catch (e) {
        console.error("message.module :: /message/delete : 削除エラー->", e);
      }
    }
    //リアクションデータを削除
    await db.messageReaction.deleteMany({
      where: {
        messageId,
      },
    });
    //添付ファイル情報の削除
    await db.messageFileAttached.deleteMany({
      where: {
        messageId,
      },
    });
    //このメッセージからできているInboxデータの削除
    await db.inbox.deleteMany({
      where: {
        messageId: messageId,
      },
    });

    //メッセージの削除
    await db.message.delete({
      where: {
        id: messageId,
      },
    });

    return messageData;
  };

  export const GetInbox = async (_userId: string) => {
    //通知を取得する
    const inboxAll = await db.inbox.findMany({
      where: {
        userId: _userId,
      },
      include: {
        Message: true,
      },
    });

    return inboxAll;
  };

  export const ReadInbox = async (messageId: string, _userId: string) => {
    //通知を削除
    await db.inbox
      .delete({
        where: {
          messageId_userId: {
            messageId,
            userId: _userId,
          },
        },
      })
      .catch((e) => {
        console.error(
          "message.module :: /message/inbox/read : 削除エラー->",
          e,
        );
        throw status(404, "Inbox not found");
      });

    return;
  };

  export const ClearInbox = async (_userId: string) => {
    //通知を全部削除
    await db.inbox.deleteMany({
      where: {
        userId: _userId,
      },
    });

    return;
  };

  export const Reaction = async (
    messageId: string,
    channelId: string,
    emojiCode: string,
    _userId: string,
  ) => {
    //チャンネルの閲覧制限があるか確認する
    if (!(await CheckChannelVisibility(channelId, _userId))) {
      throw status(404, "Message not found");
    }

    //自分のリアクションデータを取得して条件確認する
    const targetMessage = await db.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        MessageReaction: {
          select: {
            id: true,
            emojiCode: true,
          },
          where: {
            userId: _userId,
          },
        },
      },
    });
    //メッセージが存在しなければエラー
    if (targetMessage === null) {
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
    const reaction = await db.messageReaction.create({
      data: {
        messageId,
        userId: _userId,
        channelId,
        emojiCode,
      },
    });

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
    const message = await db.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        MessageReaction: {
          skip: skip,
          take: length,
          select: {
            userId: true,
          },
          where: {
            emojiCode,
          },
        },
      },
    });
    if (message === null) {
      throw status(400, "Message not found or is private");
    }

    //チャンネルの閲覧制限があるか確認
    const viewable = await CheckChannelVisibility(message.channelId, _userId);
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
    const messageWithReaction = await db.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        MessageReaction: {
          where: {
            userId: _userId,
            emojiCode,
          },
        },
      },
    });
    //メッセージの存在確認
    if (messageWithReaction === null) {
      throw status(404, "Message not found");
    }
    //自分による指定リアクションの存在確認
    if (messageWithReaction.MessageReaction.length === 0) {
      throw status(404, "Reaction does not exists");
    }

    //リアクションを削除
    const reactionDeleted = await db.messageReaction.delete({
      where: {
        id: messageWithReaction.MessageReaction[0].id,
      },
    });

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
    const channelJoined = await db.channelJoin.findFirst({
      where: {
        userId: _userId,
        channelId,
      },
    });
    //チャンネルに参加していない
    if (channelJoined === null) {
      throw status(400, "You are not joined this channel");
    }

    //返信先メッセージ用変数(メッセージ保存処理後に使用)
    let messageReplyingTo: Message | null = null;
    //返信先メッセージがあるなら存在するか確認
    if (replyingMessageId) {
      messageReplyingTo = await db.message.findUnique({
        where: {
          id: replyingMessageId,
        },
      });
      //返信先メッセージが存在しないならエラー
      if (messageReplyingTo === null) {
        throw status(400, "Replying message not found");
      }
      //返信先メッセージがこのチャンネルに存在するか確認
      if (messageReplyingTo.channelId !== channelId) {
        throw status(400, "Replying message not found in this channel");
      }
    }

    //アップロードしているファイルId配列があるならファイル情報を取得
    const fileData = await db.messageFileAttached.findMany({
      where: {
        id: {
          in: fileIds,
        },
      },
    });

    //メッセージを保存
    const messageSaved = await db.message.create({
      data: {
        channelId,
        userId: _userId,
        content: message,
        replyingMessageId: replyingMessageId ?? undefined,
        MessageFileAttached: {
          connect: fileData.map((data) => {
            return {
              id: data.id,
            };
          }),
        },
      },
      include: {
        MessageFileAttached: true,
      },
    });

    //メッセージから "@<userId>" を検知
    const mentionedUserIds =
      message.match(/@<([\w-]+)>/g)?.map((mention) => mention.slice(2, -1)) ||
      [];

    //DBに保存するInbox用データを作成
    const savingInboxData = [];
    for (const mentionedUserId of mentionedUserIds) {
      savingInboxData.push({
        userId: mentionedUserId,
        messageId: messageSaved.id,
        type: "mention",
      });
    }
    //inboxに保存
    await db.inbox.createMany({
      data: savingInboxData,
    });

    return { messageSaved, messageReplyingTo, mentionedUserIds };
  };

  export const Edit = async (
    messageId: string,
    message: string,
    _userId: string,
  ) => {
    const messageEditing = await db.message.findUnique({
      where: {
        id: messageId,
      },
    });
    //メッセージが無かった時エラー
    if (messageEditing === null) {
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
    const msgUpdated = await db.message.update({
      where: {
        id: messageId,
      },
      data: {
        content: message,
        isEdited: true,
      },
    });

    return msgUpdated;
  };
}
