import { unlink } from "node:fs/promises";
import { status } from "elysia";
import sharp from "sharp";

// アイコンとして受け付ける上限サイズ
const MAX_ICON_BYTES = 8 * 1024 * 1024;
// 保存時の一辺(px)。GIFはアニメーション維持のため縦横とも固定
const ICON_EDGE = 125;
const ICON_DIR = "./STORAGE/icon";
const ALLOWED_ICON_TYPES = ["image/png", "image/gif", "image/jpeg"];
const ICON_EXTENSIONS = ["png", "gif", "jpeg", "webp"];

async function removeIfExists(path: string) {
  try {
    await unlink(path);
  } catch {
    //未作成の拡張子は消すものが無いだけなので無視する
  }
}

/**
 * ユーザー(Botのリモートユーザー含む)のアイコン画像を検証・圧縮して保存する。
 * 同一userIdの既存アイコンは拡張子違いも含めて削除する。
 * @param icon
 * @param _userId
 */
export default async function SaveUserIcon(icon: File, _userId: string) {
  if (icon.size > MAX_ICON_BYTES) {
    throw status(400, "File size is too large");
  }
  if (!ALLOWED_ICON_TYPES.includes(icon.type)) {
    throw status(400, "File type is invalid");
  }

  //既存のアイコンを削除
  for (const ext of ICON_EXTENSIONS) {
    await removeIfExists(`${ICON_DIR}/${_userId}.${ext}`);
  }

  //画像を圧縮、保存する(GIFとそれ以外で処理を分ける)
  if (icon.type === "image/gif") {
    await sharp(await icon.arrayBuffer(), { animated: true })
      .resize(ICON_EDGE, ICON_EDGE)
      .gif({
        colours: 128, // 色数を128に削減
        dither: 0, // ディザリングを無効化
        effort: 7, // パレット生成の計算量を設定
      })
      .toFile(`${ICON_DIR}/${_userId}.gif`);

    return;
  }

  await sharp(await icon.arrayBuffer())
    .resize(ICON_EDGE, ICON_EDGE)
    .webp({ quality: 90 })
    .toFile(`${ICON_DIR}/${_userId}.webp`);
}
