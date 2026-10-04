import { and, eq, lt, or } from "drizzle-orm";
import { db } from "..";
import { messageUrlPreviewThumbnails } from "../db/schema";

export namespace QueryMessageUrlPreviewThumbnail {
  //URLに紐づくサムネイルのファイル名(キャッシュ判定用)
  export const getFileNameByUrl = (query: { url: string }) => {
    return db
      .select({ fileName: messageUrlPreviewThumbnails.fileName })
      .from(messageUrlPreviewThumbnails)
      .where(eq(messageUrlPreviewThumbnails.url, query.url))
      .get();
  };

  //指定時刻より前に作成されたサムネイルを古い順に取得(定期削除用)
  export const getExpired = (query: { before: Date; limit: number }) => {
    return db
      .select()
      .from(messageUrlPreviewThumbnails)
      .where(lt(messageUrlPreviewThumbnails.createdAt, query.before))
      .limit(query.limit)
      .all();
  };

  //選択後に再生成されてファイル名が変わっていない行だけ削除する(孤児ファイル防止)
  export const removeByIdAndFileName = async (query: {
    rows: { id: number; fileName: string }[];
  }) => {
    if (query.rows.length === 0) return;
    await db
      .delete(messageUrlPreviewThumbnails)
      .where(
        or(
          ...query.rows.map((row) =>
            and(
              eq(messageUrlPreviewThumbnails.id, row.id),
              eq(messageUrlPreviewThumbnails.fileName, row.fileName),
            ),
          ),
        ),
      );
  };

  //サムネイルを保存(存在すればファイル名と作成日時を更新)
  export const upsert = async (query: { url: string; fileName: string }) => {
    await db
      .insert(messageUrlPreviewThumbnails)
      .values({
        url: query.url,
        fileName: query.fileName,
      })
      .onConflictDoUpdate({
        target: messageUrlPreviewThumbnails.url,
        set: { fileName: query.fileName, createdAt: new Date() },
      });
  };
}
