import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { status } from "elysia";
import sharp from "sharp";
import { db, GIRACLE_SERVER_CONFIG } from "../..";
import type { Message } from "../../db/schema";
import { QueryChannel } from "../../queries/channel.query";
import { QueryChannelJoin } from "../../queries/channelJoin.query";
import { QueryInbox } from "../../queries/inbox.query";
import { QueryMessage } from "../../queries/message.query";
import { QueryMessageFileAttached } from "../../queries/messageFileAttached.query";
import { QueryMessageReaction } from "../../queries/messageReaction.query";
import { QueryMessageReadTime } from "../../queries/messageReadTime.query";
import { QueryMessageUrlPreview } from "../../queries/messageUrlPreview.query";
import { QueryMessageUrlPreviewThumbnail } from "../../queries/messageUrlPreviewThumbnail.query";
import { QueryRoleLink } from "../../queries/roleLink.query";
import { Util } from "../../Util";

export namespace ServiceMessage {
  export const Get = async (messageId: string, _userId: string) => {
    const messageData = await QueryMessage.getSingleWithRelations({
      messageId,
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
      QueryChannelJoin.getJoinsByUser({ userId: _userId }),
      QueryMessageReadTime.getByUser({ userId: _userId }),
    ]);

    const channelIds = userChannelJoined.map((c) => c.channelId);
    if (channelIds.length === 0) return {};

    // チャンネルごとの最新createdAtをDB側で集約（groupByはDB集約なので軽い）
    const latestTimes = await QueryMessage.getLatestCreatedAtByChannel({
      channelIds,
    });

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
    const readTime = await QueryMessageReadTime.getByUserAll({
      userId: _userId,
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
    const channelWithReadtime = await QueryChannel.getSingleWithReadTime({
      channelId,
      userId: _userId,
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

    const readTimeUpdated = await QueryMessageReadTime.upsert({
      channelId,
      userId: _userId,
      readTime,
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
    //チャンネル指定が無かった時用のユーザーが閲覧できるチャンネルId配列
    let viewableChannelIds: string[] = [];
    //チャンネル指定があるなら閲覧制限を確認する、無いならユーザーが閲覧できるチャンネルを取得
    if (channelId) {
      //チャンネルの閲覧制限があるか確認
      if (!(await Util.checkChannelVisibility(channelId, _userId))) {
        throw status(403, "You are not allowed to view this channel");
      }
    } else {
      const viewableChannels = await Util.getUserViewableChannel(_userId);
      viewableChannelIds = viewableChannels.map((channel) => channel.id);
    }

    //メッセージを検索する
    return await QueryMessage.search({
      content,
      channelId,
      viewableChannelIds,
      userId,
      hasUrlPreview,
      hasFileAttachment,
      loadIndex,
      sort,
    });
  };

  export const UploadFile = async (
    channelId: string,
    file: File,
    _userId: string,
  ) => {
    //channelIdにパス要素が混入していないか検証(パストラバーサル対策)。DB参照より先に、無効入力でDBを叩かない
    if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      throw status(400, "Invalid channelId");
    }

    const joinedChannel = await QueryChannelJoin.getJoin({
      userId: _userId,
      channelId,
    });
    if (joinedChannel === undefined)
      throw status(400, "You are not joined to this channel");

    //サーバー設定からメッセージの最大ファイルサイズを取得
    const maxFileSize =
      GIRACLE_SERVER_CONFIG.MessageMaxFileSize ?? 1024 * 1024 * 100;
    //ファイルサイズが最大ファイルサイズを超える場合はエラー
    if (file.size > maxFileSize) {
      throw status(400, "File size is too large");
    }

    //表示用ファイル名はパストラバーサル対策としてサニタイズして保持
    const safeFileName = path.basename(file.name).replace(/[/\\]/g, "_");
    //保存ファイル名はサーバー生成のIDのみを使用(オリジナル拡張子を使わせない)
    const fileId = crypto.randomUUID();
    //保存先ディレクトリ
    const dir = `./STORAGE/file/${channelId}`;
    //チャンネルIdのディレクトリを作成
    await mkdir(dir, { recursive: true }).catch(() => {});

    //MIMEタイプを正規化する(クライアント指定値は大文字や `;charset=...` を含み得るため)
    const mimeType = file.type.split(";")[0].trim().toLowerCase();

    //保存後の拡張子とMIMEタイプ
    let savedFileName: string;
    let type: string;

    if (mimeType.startsWith("image/")) {
      //画像はすべて再エンコードして保存する(オリジナルバイトを保存しない)
      try {
        if (mimeType === "image/gif") {
          const buffer = Buffer.from(await file.arrayBuffer());
          await sharp(buffer, { animated: true })
            .gif({
              colours: 128, // 色数を128に削減
              dither: 0, // ディザリングを無効化
              effort: 7, // パレット生成の計算量を設定
            })
            .toFile(`${dir}/${fileId}.gif`);
          savedFileName = `${fileId}.gif`;
          type = "image/gif";
        } else {
          const buffer = Buffer.from(await file.arrayBuffer());
          await sharp(buffer)
            .rotate()
            .webp({ quality: 95 })
            .toFile(`${dir}/${fileId}.webp`);
          savedFileName = `${fileId}.webp`;
          type = "image/webp";
        }
      } catch {
        //画像として解釈できないバイト列(例: HTMLをimage/pngと偽装)は保存しない
        throw status(400, "File type is invalid");
      }
    } else {
      //画像以外はホワイトリスト登録済みの安全な種別のみ許可する
      const safeExt = Util.getSafeFileExtension(mimeType);
      if (!safeExt) {
        throw status(400, "File type is invalid");
      }
      //画像以外はそのまま保存する(ブラウザ上での実行は配信時のattachment/nosniffで防止)
      await Bun.write(`${dir}/${fileId}.${safeExt}`, file);
      savedFileName = `${fileId}.${safeExt}`;
      type = mimeType;
    }

    //ファイル情報を作成、保存する
    return QueryMessageFileAttached.insertFile({
      channelId,
      userId: _userId,
      size: file.size,
      actualFileName: safeFileName,
      savedFileName,
      type,
    });
  };

  export const GetFile = async (fileId: string, _userId: string) => {
    const fileData = await QueryMessageFileAttached.getSingle({ fileId });
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

  export const GetUrlThumbnail = async (
    targetUrl: string,
    forFavicon: boolean,
  ) => {
    // ダウンロード/デコードの上限 (DoS対策)
    const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5MB
    const MAX_THUMBNAIL_PIXELS = 4096 * 4096; // 約16.7MP

    const thumbnail = QueryMessageUrlPreviewThumbnail.getFileNameByUrl({
      url: targetUrl,
    });

    // キャッシュ済みサムネイルがあれば返す
    const cachedFile = thumbnail
      ? Bun.file(`./STORAGE/thumbnail/${thumbnail.fileName}`)
      : null;
    if (cachedFile && (await cachedFile.exists())) {
      return cachedFile;
    }

    // 無効URL (内部IP・解決不能) は取得しない (SSRF対策)
    if (!(await Util.validateUrl.isValid(targetUrl))) {
      return null;
    }

    // リダイレクト先も検証しながら追跡 (自動追従は検証前の内部IPへ飛ぶためmanual)
    const MAX_THUMBNAIL_REDIRECT = 3;
    let url = targetUrl;
    let response: Response | null = null;
    for (let i = 0; i <= MAX_THUMBNAIL_REDIRECT; i++) {
      response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      }).catch(() => null);
      if (!response) return null;

      // 304はリダイレクトではなく本体応答として扱う
      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get("location");
      if (!location) return null;

      try {
        url = new URL(location, url).toString();
      } catch {
        return null;
      }
      if (!(await Util.validateUrl.isValid(url))) return null;
      if (i === MAX_THUMBNAIL_REDIRECT) return null;
    }

    if (!response?.ok) {
      return null;
    }

    // 画像以外は取得しない
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }

    // Content-Length が上限超過なら事前に取得しない
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_THUMBNAIL_BYTES) {
      return null;
    }

    // 未申告・偽装 Content-Length 対策として読み込み中も上限を判定する
    const bytes = await Util.readResponseBodyWithByteLimit(
      response,
      MAX_THUMBNAIL_BYTES,
    );
    if (bytes === null) {
      return null;
    }

    // ファイル名と保存パスを決める
    const isSvg = contentType.includes("image/svg");
    const fileName = `${crypto.randomUUID()}.${isSvg ? "svg" : "webp"}`;
    const filePath = `./STORAGE/thumbnail/${fileName}`;

    try {
      // SVG は Bun.Image 非対応のためバイト列をそのまま保存
      if (isSvg) {
        await Bun.write(filePath, bytes);
      } else {
        const image = new Bun.Image(bytes, { maxPixels: MAX_THUMBNAIL_PIXELS });
        // 長辺を枠内に収める (縦長パノラマの肥大化防止。幅のみ指定だと高さが無制限に残る)
        const box = forFavicon ? 32 : 512;
        await image
          .resize(box, box, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 90 })
          .write(filePath);
      }
    } catch (e) {
      console.error("message.service :: GetUrlThumbnail : 失敗", e);
      return null;
    }

    // DBへ保存
    await QueryMessageUrlPreviewThumbnail.upsert({
      url: targetUrl,
      fileName,
    });

    return Bun.file(filePath);
  };

  export const Delete = async (messageId: string, _userId: string) => {
    //取得
    const messageData = await QueryMessage.getSingleWithMinimum({ messageId });
    if (messageData === undefined) {
      throw status(404, "Message not found");
    }
    if (messageData.userId !== _userId) {
      //メッセージの送信者でないならサーバー管理権限を確認する
      const canManageServer = QueryRoleLink.getManageServerLink({
        userId: _userId,
      });

      if (!canManageServer)
        throw status(403, "You are not owner of this message");
    }

    //ファイル情報を取得(実体ファイルの削除はトランザクション外で先に実施)
    const fileData = await QueryMessageFileAttached.getByMessage({
      messageId,
    });
    for (const file of fileData) {
      try {
        await unlink(`./STORAGE/file/${file.channelId}/${file.savedFileName}`);
      } catch (e) {
        console.error("message.module :: /message/delete : 削除エラー->", e);
      }
    }

    //DB上の関連データを子→親の順にまとめて削除(途中失敗による孤児データ防止のため1トランザクションにまとめる)
    db.transaction((tx) => {
      QueryMessageUrlPreview.removeByMessageInTx(tx, { messageId });
      QueryMessageReaction.removeByMessageInTx(tx, { messageId });
      QueryMessageFileAttached.removeByMessageInTx(tx, { messageId });
      QueryInbox.removeByMessageInTx(tx, { messageId });
      QueryMessage.removeInTx(tx, { messageId });
    });

    return messageData;
  };

  export const GetInbox = async (_userId: string) => {
    //通知を取得する
    return QueryInbox.getByUserWithMessage({ userId: _userId });
  };

  export const ReadInbox = async (messageId: string, _userId: string) => {
    //通知を削除
    const deleted = await QueryInbox.removeSingle({
      messageId,
      userId: _userId,
    }).catch((e) => {
      console.error("message.module :: /message/inbox/read : 削除エラー->", e);
      throw status(404, "Inbox not found");
    });

    if (deleted.length === 0) {
      throw status(404, "Inbox not found");
    }

    return;
  };

  export const ClearInbox = async (_userId: string) => {
    //通知を全部削除
    await QueryInbox.removeAllByUser({ userId: _userId });

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
    const targetMessage = await QueryMessage.getSingleWithOwnReaction({
      messageId,
      channelId,
      userId: _userId,
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
    const reaction = await QueryMessageReaction.insertReaction({
      messageId,
      userId: _userId,
      channelId,
      emojiCode,
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
    //メッセージが存在するか確認 (チャンネル可視性判定にchannelIdだけ必要)
    const message = await QueryMessage.getSingleWithMinimum({ messageId });
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

    //ネストリレーションにoffset不可のため直接ページネーション取得
    const reactions = await QueryMessageReaction.getByMessageAndEmoji({
      messageId,
      emojiCode,
      fetchLength: length,
      skip,
    });

    return { ...message, MessageReaction: reactions };
  };

  export const DeleteEmojiReaction = async (
    messageId: string,
    emojiCode: string,
    _userId: string,
  ) => {
    const messageWithReaction =
      await QueryMessage.getSingleWithOwnReactionByEmoji({
        messageId,
        userId: _userId,
        emojiCode,
      });
    //メッセージの存在確認
    if (messageWithReaction === undefined) {
      throw status(404, "Message not found");
    }
    //自分による指定リアクションの存在確認
    if (messageWithReaction.MessageReaction.length === 0) {
      throw status(404, "Reaction does not exist");
    }

    //リアクションを削除
    const reactionDeleted = await QueryMessageReaction.removeById({
      reactionId: messageWithReaction.MessageReaction[0].id,
    });

    return reactionDeleted;
  };

  export const Send = async (
    channelId: string,
    message: string,
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
    const channelJoined = await QueryChannelJoin.getJoin({
      userId: _userId,
      channelId,
    });
    //チャンネルに参加していない
    if (channelJoined === undefined) {
      throw status(400, "You are not joined this channel");
    }

    //返信先メッセージ用変数(メッセージ保存処理後に使用)
    let messageReplyingTo: Message | undefined;
    //返信先メッセージがあるなら存在するか確認
    if (replyingMessageId) {
      messageReplyingTo = await QueryMessage.getSingle({
        messageId: replyingMessageId,
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
        ? await QueryMessageFileAttached.getByIds({ fileIds })
        : [];

    //渡されたfileIdsが全て取得できているか、かつ自分がこのチャンネルへアップロードした未添付ファイルであるかを検証
    //(他ユーザーのファイルや他メッセージに添付済みのファイルの付け替えを防止)
    if (fileData.length !== fileIds.length) {
      throw status(400, "Attached file not found");
    }
    for (const file of fileData) {
      if (
        file.userId !== _userId ||
        file.channelId !== channelId ||
        file.messageId !== null
      ) {
        throw status(400, "Invalid file attachment");
      }
    }

    //メッセージを保存
    const messageSavedRow = await QueryMessage.insertMessage({
      channelId,
      userId: _userId,
      content: message,
      replyingMessageId: replyingMessageId ?? undefined,
    });

    //アップロード済みファイルをこのメッセージに紐付ける(Prismaのconnect相当)
    if (fileData.length > 0) {
      await QueryMessageFileAttached.attachToMessage({
        fileIds: fileData.map((f) => f.id),
        messageId: messageSavedRow.id,
      });
    }

    const messageSaved = await QueryMessage.getSingleWithFiles({
      messageId: messageSavedRow.id,
    });
    if (messageSaved === undefined) {
      throw status(500, "Internal Server Error");
    }

    return { messageSaved, messageReplyingTo };
  };

  export const addToInbox = async (
    sourceMessageId: string,
    content: string,
    channelId: string
  ) => {
    //メッセージから "@<userId>" を検知
    const mentionedUserIds =
      content.match(/@<([\w-]+)>/g)?.map((mention) => mention.slice(2, -1)) ||
      [];
    const mentionedUserIdsMerged = Array.from(new Set(mentionedUserIds));

    //チャンネル参加者限定
    const existingMentionedUsers =
      mentionedUserIdsMerged.length > 0
        ? await QueryChannelJoin.getJoinsByUsersInChannel({
            userIds: mentionedUserIdsMerged,
            channelId,
          })
        : [];
    const existingMentionedUserIds = new Set(
      existingMentionedUsers.map((u) => u.userId),
    );

    //DBに保存するInbox用データを作成
    const savingInboxData = [];
    for (const mentionedUserId of Array.from(existingMentionedUserIds)) {
      savingInboxData.push({
        userId: mentionedUserId,
        messageId: sourceMessageId,
        type: "mention",
      });
    }
    //inboxに保存
    if (savingInboxData.length > 0) {
      await QueryInbox.insertMany({ items: savingInboxData });
    }

    return mentionedUserIdsMerged;
  };

  export const Edit = async (
    messageId: string,
    message: string,
    _userId: string,
  ) => {
    const messageEditing = await QueryMessage.getSingle({ messageId });
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
    const msgUpdated = await QueryMessage.updateMessage({
      messageId,
      content: message,
    });

    return msgUpdated;
  };
}
