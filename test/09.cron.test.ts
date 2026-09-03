import { beforeAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../src";
import { CronInstances, runRefreshUrlPreview } from "../src/Cron";
import { messageUrlPreviewThumbnails } from "../src/db/schema";
import { INIT } from "./util";

const OLD_MS = 2 * 60 * 60 * 1000; //2時間前

//cronジョブ（1時間経過したURLプレビューサムネイルの削除）の検証
describe("Cron/refreshUrlPreview", () => {
  beforeAll(async () => {
    await INIT();
  });

  test("1時間以上経過したサムネイルのファイルとDB行を削除する", async () => {
    const oldFileName = crypto.randomUUID();
    const newFileName = crypto.randomUUID();
    const now = Date.now();

    //古い行（2時間前）と新しい行（現在）を用意し、対応する画像ファイルも作成
    await db.insert(messageUrlPreviewThumbnails).values([
      {
        url: `https://example.com/${oldFileName}`,
        fileName: oldFileName,
        createdAt: new Date(now - OLD_MS),
      },
      {
        url: `https://example.com/${newFileName}`,
        fileName: newFileName,
        createdAt: new Date(now),
      },
    ]);
    await Bun.write(`./STORAGE/thumbnail/${oldFileName}`, "old");
    await Bun.write(`./STORAGE/thumbnail/${newFileName}`, "new");

    try {
      await runRefreshUrlPreview();

      //古い行・ファイルは削除される
      expect(
        db
          .select()
          .from(messageUrlPreviewThumbnails)
          .where(eq(messageUrlPreviewThumbnails.fileName, oldFileName))
          .get(),
      ).toBeUndefined();
      expect(
        await Bun.file(`./STORAGE/thumbnail/${oldFileName}`).exists(),
      ).toBe(false);

      //新しい行・ファイルは残る
      expect(
        db
          .select()
          .from(messageUrlPreviewThumbnails)
          .where(eq(messageUrlPreviewThumbnails.fileName, newFileName))
          .get(),
      ).toBeDefined();
      expect(
        await Bun.file(`./STORAGE/thumbnail/${newFileName}`).exists(),
      ).toBe(true);
    } finally {
      //テストで作ったデータを後片付け
      await db
        .delete(messageUrlPreviewThumbnails)
        .where(eq(messageUrlPreviewThumbnails.fileName, newFileName));
      await unlink(`./STORAGE/thumbnail/${newFileName}`).catch(() => {});
    }
  });

  test("NODE_ENV=testではBun.cronが登録されない", () => {
    expect(CronInstances.refreshUrlPreview).toBeUndefined();
  });

  test("多重実行時に安全にスキップ・完了する", async () => {
    const fileName = crypto.randomUUID();
    const now = Date.now();

    await db.insert(messageUrlPreviewThumbnails).values({
      url: `https://example.com/${fileName}`,
      fileName,
      createdAt: new Date(now - OLD_MS),
    });
    await Bun.write(`./STORAGE/thumbnail/${fileName}`, "concurrent-test");

    try {
      const results = await Promise.all([
        runRefreshUrlPreview(),
        runRefreshUrlPreview(),
      ]);
      expect(results).toContain(true);
      expect(results).toContain(false);
    } finally {
      await db
        .delete(messageUrlPreviewThumbnails)
        .where(eq(messageUrlPreviewThumbnails.fileName, fileName));
      await unlink(`./STORAGE/thumbnail/${fileName}`).catch(() => {});
    }
  });
});
