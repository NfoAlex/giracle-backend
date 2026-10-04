import fs from "node:fs";
import { unlink } from "node:fs/promises";
import * as path from "node:path";
import { status } from "elysia";
import sharp from "sharp";
import { GIRACLE_SERVER_CONFIG } from "../..";
import { QueryChannelJoinOnDefault } from "../../queries/channelJoinOnDefault.query";
import { QueryCustomEmoji } from "../../queries/customEmoji.query";
import { QueryInvite } from "../../queries/invite.query";
import { QueryRequestLog } from "../../queries/requestLog.query";
import { QueryServerConfig } from "../../queries/serverConfig.query";
import { QueryUser } from "../../queries/user.query";

export namespace ServiceServer {
  export const Config = async () => {
    //サーバーの情報取得
    const config = await QueryServerConfig.getSingle();
    //最初のユーザーになるかどうか
    const secondUser = QueryUser.getSecondUser();
    const isFirstUser = secondUser === undefined;
    //デフォルトで参加するチャンネル
    const defaultJoinChannelFetched =
      await QueryChannelJoinOnDefault.getListWithChannel();
    const defaultJoinChannel = defaultJoinChannelFetched.map((c) => c.channel);

    return {
      config,
      isFirstUser,
      defaultJoinChannel,
    };
  };

  export const Banner = async () => {
    //バナー読み取り、存在確認して返す
    const serverFilePng = Bun.file("./STORAGE/banner/SERVER.png");
    if (await serverFilePng.exists()) {
      return serverFilePng;
    }
    const serverFileGif = Bun.file("./STORAGE/banner/SERVER.gif");
    if (await serverFileGif.exists()) {
      return serverFileGif;
    }
    const bannerFileJpeg = Bun.file("./STORAGE/banner/SERVER.jpeg");
    if (await bannerFileJpeg.exists()) {
      return bannerFileJpeg;
    }

    throw status(404, "Banner not found");
  };

  export const GetInvite = async () => {
    const invites = await QueryInvite.getList();
    return invites;
  };

  export const CreateInvite = async (
    inviteCode: string,
    maxUsage: number = 5,
    _userId: string,
  ) => {
    const newInvite = await QueryInvite.insertInvite({
      inviteCode,
      maxUsage,
      requestSender: _userId,
    });

    return newInvite;
  };

  export const DeleteInvite = async (inviteId: number) => {
    await QueryInvite.removeInvite({ inviteId });

    return;
  };

  export const ChangeInfo = async (name: string, introduction: string) => {
    const serverinfo = await QueryServerConfig.updateInfo({
      name,
      introduction,
    });

    //ここでデータ取得失敗したら500エラー
    if (serverinfo === undefined) throw status(500, "Server config not found");

    GIRACLE_SERVER_CONFIG.introduction = introduction;
    GIRACLE_SERVER_CONFIG.name = name;

    return serverinfo;
  };

  export const ChangeConfig = async (
    RegisterAvailable?: boolean,
    RegisterInviteOnly?: boolean,
    RegisterAnnounceChannelId?: string,
    MessageMaxLength?: number,
    MessageMaxFileSize?: number,
    DefaultJoinChannel?: string[],
  ) => {
    const serverinfo = await QueryServerConfig.updateConfig({
      RegisterAvailable,
      RegisterInviteOnly,
      RegisterAnnounceChannelId,
      MessageMaxLength,
      MessageMaxFileSize,
    });

    if (serverinfo === undefined) throw status(500, "Server config not found");

    if (RegisterAvailable !== undefined)
      GIRACLE_SERVER_CONFIG.RegisterAvailable = RegisterAvailable;
    if (RegisterInviteOnly !== undefined)
      GIRACLE_SERVER_CONFIG.RegisterInviteOnly = RegisterInviteOnly;
    if (RegisterAnnounceChannelId)
      GIRACLE_SERVER_CONFIG.RegisterAnnounceChannelId =
        RegisterAnnounceChannelId;
    if (MessageMaxLength !== undefined)
      GIRACLE_SERVER_CONFIG.MessageMaxLength = MessageMaxLength;
    if (MessageMaxFileSize !== undefined)
      GIRACLE_SERVER_CONFIG.MessageMaxFileSize = MessageMaxFileSize;

    //デフォルト参加チャンネル設定もあるなら更新する
    if (DefaultJoinChannel) {
      //デフォルト参加チャンネル全部削除して渡されたチャンネルIdを挿入(1トランザクションで)
      QueryChannelJoinOnDefault.replaceAll({
        channelIds: DefaultJoinChannel,
      });
    }

    return serverinfo;
  };

  export const ChangeBanner = async (banner: File) => {
    if (banner.size > 15 * 1024 * 1024) {
      throw status(400, "File size is too large");
    }
    if (
      banner.type !== "image/png" &&
      banner.type !== "image/gif" &&
      banner.type !== "image/jpeg"
    ) {
      throw status(400, "File type is invalid");
    }

    //拡張子取得
    const ext = banner.type.split("/")[1];

    //既存のバナーを削除
    await unlink("./STORAGE/banner/SERVER.png").catch(() => {});
    await unlink("./STORAGE/banner/SERVER.gif").catch(() => {});
    await unlink("./STORAGE/banner/SERVER.jpeg").catch(() => {});

    //バナーを保存
    Bun.write(`./STORAGE/banner/SERVER.${ext}`, banner);

    return;
  };

  export const GetCustomEmoji = async (code: string) => {
    //絵文字データを取得、無ければエラー
    const emoji = await QueryCustomEmoji.getSingle({ code });
    if (emoji === undefined) throw status(404, "Custom emoji not found");

    //アイコン読み取り、存在確認して返す
    const emojiGif = Bun.file(`./STORAGE/custom-emoji/${emoji.id}.gif`);
    if (await emojiGif.exists()) return emojiGif;
    const emojiJpeg = Bun.file(`./STORAGE/custom-emoji/${emoji.id}.jpeg`);
    if (await emojiJpeg.exists()) return emojiJpeg;
    const emojiWebp = Bun.file(`./STORAGE/custom-emoji/${emoji.id}.webp`);
    if (await emojiWebp.exists()) return emojiWebp;

    return null;
  };

  export const GetCustomEmojis = async () => {
    const emojis = await QueryCustomEmoji.getList();
    return emojis;
  };

  export const uploadCustomEmoji = async (
    emoji: File,
    emojiCode: string,
    _userId: string,
  ) => {
    if (emoji.size > 8 * 1024 * 1024) {
      throw status(400, "Emoji's file size is too large");
    }
    if (
      emoji.type !== "image/png" &&
      emoji.type !== "image/gif" &&
      emoji.type !== "image/jpeg"
    ) {
      throw status(400, "File type is invalid");
    }

    //絵文字コードのバリデーション
    if (emojiCode.includes(" "))
      throw status(400, "Emoji code cannot contain spaces");
    if (/[^ -~]/.test(emojiCode))
      throw status(400, "Emoji code cannot contain full-width characters");

    //絵文字コードが既に存在するか確認
    const emojiExist = await QueryCustomEmoji.getSingle({ code: emojiCode });
    if (emojiExist !== undefined)
      throw status(400, "Emoji code already exists");

    //DBに登録
    const emojiUploaded = await QueryCustomEmoji.insertEmoji({
      code: emojiCode,
      uploadedUserId: _userId,
    });

    //拡張子取得
    const ext = emoji.type.split("/")[1];
    //拡張子に合わせて画像を変換
    if (ext === "gif") {
      await sharp(await emoji.arrayBuffer(), { animated: true })
        .resize(32, 32)
        .gif({
          colours: 128, // 色数を128に削減
          dither: 0, // ディザリングを無効化
          effort: 7, // パレット生成の計算量を設定
        })
        .toFile(`./STORAGE/custom-emoji/${emojiUploaded.id}.gif`);
    } else {
      await sharp(await emoji.arrayBuffer())
        .rotate()
        .resize(32, 32)
        .webp({ quality: 95 })
        .toFile(`./STORAGE/custom-emoji/${emojiUploaded.id}.webp`);
    }

    return emojiUploaded;
  };

  export const DeleteCustomEmoji = async (emojiCode: string) => {
    //絵文字を削除しデータ取得
    const emojiDeleted = await QueryCustomEmoji.removeEmoji({
      code: emojiCode,
    });

    //絵文字の画像ファイルを削除
    await unlink(`./STORAGE/custom-emoji/${emojiDeleted.id}.png`).catch(
      () => {},
    );
    await unlink(`./STORAGE/custom-emoji/${emojiDeleted.id}.gif`).catch(
      () => {},
    );
    await unlink(`./STORAGE/custom-emoji/${emojiDeleted.id}.jpeg`).catch(
      () => {},
    );
    await unlink(`./STORAGE/custom-emoji/${emojiDeleted.id}.webp`).catch(
      () => {},
    );

    return emojiDeleted;
  };

  export const StorageUsage = async () => {
    //ディレクトリ一覧を取得
    const dirs = fs.readdirSync("./STORAGE/file");
    if (dirs.length === 0) return 0;

    //合計サイズ
    let totalSize = 0;

    //ディレクトリごとにファイルを取得、パスを格納する
    for (const dir of dirs) {
      const insideDir = fs.readdirSync(`./STORAGE/file/${dir}`);
      for (const f of insideDir) {
        totalSize += fs.statSync(path.join(`./STORAGE/file/${dir}`, f)).size;
      }
    }
    return totalSize;
  };

  export const GetLogs = async (targetDate: Date, cursorLogId?: string) => {
    if (Number.isNaN(targetDate.getTime())) throw status(400, "Invalid date");

    const dashedDateString = targetDate.toLocaleDateString("sv-SE", {
      timeZone: "Asia/Tokyo",
    });
    const dayStart = new Date(`${dashedDateString}T00:00:00+09:00`);
    const dayEnd = new Date(`${dashedDateString}T23:59:59.999+09:00`);

    const cursorRequestLog = cursorLogId
      ? QueryRequestLog.getCursorLog({ logId: cursorLogId })
      : undefined;

    if (cursorLogId && !cursorRequestLog)
      throw status(400, "Invalid cursorLogId");

    if (
      cursorRequestLog &&
      (cursorRequestLog.createdAt < dayStart ||
        cursorRequestLog.createdAt > dayEnd)
    )
      throw status(400, "cursorLogId is out of the target date range");

    const logs = await QueryRequestLog.getByDateRange({
      dayStart,
      dayEnd,
      cursor: cursorRequestLog,
    });

    return logs;
  };

  export const GetLogGroup = async (
    filters: {
      type?: "success" | "error";
      userId?: string;
      cursorLogDate?: string;
    },
    includeFirstDayLogs?: boolean,
  ) => {
    // JST 00:00 決定的変換ヘルパ — service内に集約しmodule側二重解釈を解消
    const jstMidnight = (s: string) => new Date(`${s}T00:00:00+09:00`);
    const jstTodayMidnight = () =>
      jstMidnight(
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
      );

    const weekStart = filters.cursorLogDate
      ? jstMidnight(filters.cursorLogDate)
      : new Date(jstTodayMidnight().getTime() - 6 * 24 * 60 * 60 * 1000);
    // 半開区間 [weekStart, weekEnd) にしカーソル連番時の重複を防ぐ
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const logByGroup = await QueryRequestLog.getGroupByDay({
      weekStart,
      weekEnd,
      type: filters.type,
      userId: filters.userId,
    });

    return {
      group: logByGroup,
      firstDayLog: includeFirstDayLogs ? await GetLogs(weekStart) : undefined,
    };
  };
}
