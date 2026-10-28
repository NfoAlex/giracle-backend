// GetUserIcon / GetUserBanner が参照する拡張子と揃える
const IMAGE_DIRS = ["./STORAGE/icon", "./STORAGE/banner"];
const IMAGE_EXTENSIONS = ["png", "gif", "jpeg", "webp"];

/**
 * ユーザー(Botのリモートユーザー含む)のアイコン・バナー画像を削除する。
 * 論理削除ではDB行が残るため、ストレージだけ明示的に消す。
 * @param userId
 */
export default async function RemoveUserImages(userId: string) {
  for (const dir of IMAGE_DIRS)
    for (const ext of IMAGE_EXTENSIONS) {
      const targetFile = Bun.file(`${dir}/${userId}.${ext}`);
      if (await targetFile.exists()) await targetFile.delete();
    }
}
