import fs from "node:fs";
import { unlink } from "node:fs/promises";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { status } from "elysia";
import sharp from "sharp";
import { db, GIRACLE_SERVER_CONFIG } from "../..";
import {
  channelJoinOnDefaults,
  customEmojis,
  invitations,
  serverConfigs,
  users,
} from "../../db/schema";

export namespace ServiceServer {
  export const Config = async () => {
    //サーバーの情報取得
    const config = await db.query.serverConfigs.findFirst();
    //最初のユーザーになるかどうか
    const firstUser = db.select().from(users).offset(1).limit(1).get();
    const isFirstUser = firstUser === undefined;
    //デフォルトで参加するチャンネル
    const defaultJoinChannelFetched =
      await db.query.channelJoinOnDefaults.findMany({
        with: {
          channel: true,
        },
      });
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
    const invites = await db.query.invitations.findMany();
    return invites;
  };

  export const CreateInvite = async (
    inviteCode: string,
    maxUsage: number = 5,
    _userId: string,
  ) => {
    const [newInvite] = await db
      .insert(invitations)
      .values({
        inviteCode,
        createdUserId: _userId,
        maxUsage,
      })
      .returning();

    return newInvite;
  };

  export const DeleteInvite = async (inviteId: number) => {
    await db.delete(invitations).where(eq(invitations.id, inviteId));

    return;
  };

  export const ChangeInfo = async (name: string, introduction: string) => {
    const [serverinfo] = await db
      .update(serverConfigs)
      .set({
        name,
        introduction,
      })
      .returning();

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
    const [serverinfo] = await db
      .update(serverConfigs)
      .set({
        RegisterAvailable,
        RegisterInviteOnly,
        RegisterAnnounceChannelId,
        MessageMaxLength,
        MessageMaxFileSize,
      })
      .returning();

    if (serverinfo === undefined) throw status(500, "Server config not found");

    if (RegisterAvailable)
      GIRACLE_SERVER_CONFIG.RegisterAvailable = RegisterAvailable;
    if (RegisterInviteOnly)
      GIRACLE_SERVER_CONFIG.RegisterInviteOnly = RegisterInviteOnly;
    if (RegisterAnnounceChannelId)
      GIRACLE_SERVER_CONFIG.RegisterAnnounceChannelId =
        RegisterAnnounceChannelId;
    if (MessageMaxLength)
      GIRACLE_SERVER_CONFIG.MessageMaxLength = MessageMaxLength;
    if (MessageMaxFileSize)
      GIRACLE_SERVER_CONFIG.MessageMaxFileSize = MessageMaxFileSize;

    //デフォルト参加チャンネル設定もあるなら更新する
    if (DefaultJoinChannel) {
      //デフォルト参加チャンネル全部削除して渡されたチャンネルIdを挿入(1トランザクションで)
      const defaultChannelIdsPushing = DefaultJoinChannel.map((channelId) => ({
        channelId,
      }));
      db.transaction((tx) => {
        tx.delete(channelJoinOnDefaults).run();
        if (defaultChannelIdsPushing.length > 0) {
          tx.insert(channelJoinOnDefaults)
            .values(defaultChannelIdsPushing)
            .run();
        }
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
    const emoji = await db.query.customEmojis.findFirst({
      where: eq(customEmojis.code, code),
    });
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
    const emojis = await db.query.customEmojis.findMany();
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
    const emojiExist = await db.query.customEmojis.findFirst({
      where: eq(customEmojis.code, emojiCode),
    });
    if (emojiExist !== undefined)
      throw status(400, "Emoji code already exists");

    //DBに登録
    const [emojiUploaded] = await db
      .insert(customEmojis)
      .values({
        code: emojiCode,
        uploadedUserId: _userId,
      })
      .returning();

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
    const [emojiDeleted] = await db
      .delete(customEmojis)
      .where(eq(customEmojis.code, emojiCode))
      .returning();

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
}
