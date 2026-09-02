import { inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { messageUrlPreviewThumbnails } from "./db/schema";

let isRunning = false;

//作成から１時間経過したサムネイルを削除する（テストから直接呼ぶためexport）
export const runRefreshUrlPreview = async (): Promise<boolean> => {
  if (isRunning) return false;
  isRunning = true;

  try {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const BATCH_SIZE = 100; //１回の処理で１００個取得
    const MAX_LOOPS = 50; //無限ループ防止の安全弁
    const THUMBNAIL_DIR = "./STORAGE/thumbnail";

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const expiredRows = db
        .select()
        .from(messageUrlPreviewThumbnails)
        .where(
          lt(
            messageUrlPreviewThumbnails.createdAt,
            new Date(Date.now() - ONE_HOUR_MS),
          ),
        )
        .limit(BATCH_SIZE)
        .all();

      if (expiredRows.length === 0) return true;

      //画像ファイルを削除（Bun API。ファイル不在時のENOENTは無視）
      for (const row of expiredRows) {
        await Bun.file(`${THUMBNAIL_DIR}/${row.fileName}`)
          .delete()
          .catch(() => {});
      }

      await db.delete(messageUrlPreviewThumbnails).where(
        inArray(
          messageUrlPreviewThumbnails.id,
          expiredRows.map((row) => row.id),
        ),
      );
    }
    return true;
  } finally {
    isRunning = false;
  }
};

export const CronInstances = {
  refreshUrlPreview:
    process.env.NODE_ENV !== "test"
      ? Bun.cron("0 * * * *", runRefreshUrlPreview)
      : undefined,
};
