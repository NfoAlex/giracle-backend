import { beforeAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../src";
import { runRefreshUrlPreview } from "../src/Cron";
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

  test("選択後にfileNameが変わった行は削除しない(孤児化防止)", async () => {
    const oldFileName = crypto.randomUUID();
    const newFileName = crypto.randomUUID();
    const url = `https://example.com/race-${crypto.randomUUID()}`;

    await db.insert(messageUrlPreviewThumbnails).values({
      url,
      fileName: oldFileName,
      createdAt: new Date(Date.now() - OLD_MS),
    });
    await Bun.write(`./STORAGE/thumbnail/${oldFileName}`, "old");

    const originalFile = Bun.file;
    let injected = false;
    // Bun.fileを差し替えて削除直前に再生成を注入する (実行時は関数プロパティ)
    const mutableBun = Bun as unknown as { file: typeof Bun.file };
    mutableBun.file = ((p: string) => {
      const bunFile = originalFile(p);
      if (!injected && p.endsWith(oldFileName)) {
        const originalDelete = bunFile.delete.bind(bunFile);
        bunFile.delete = async () => {
          injected = true;
          //Cronが選択した後に再生成が走った状態を再現する
          await Bun.write(`./STORAGE/thumbnail/${newFileName}`, "new");
          await db
            .update(messageUrlPreviewThumbnails)
            .set({ fileName: newFileName, createdAt: new Date() })
            .where(eq(messageUrlPreviewThumbnails.url, url));
          return originalDelete();
        };
      }
      return bunFile;
    }) as unknown as typeof Bun.file;

    try {
      await runRefreshUrlPreview();

      expect(injected).toBeTrue();
      const row = db
        .select()
        .from(messageUrlPreviewThumbnails)
        .where(eq(messageUrlPreviewThumbnails.url, url))
        .get();
      expect(row?.fileName).toBe(newFileName);
      expect(
        await Bun.file(`./STORAGE/thumbnail/${newFileName}`).exists(),
      ).toBe(true);
    } finally {
      mutableBun.file = originalFile;
      await db
        .delete(messageUrlPreviewThumbnails)
        .where(eq(messageUrlPreviewThumbnails.url, url));
      await unlink(`./STORAGE/thumbnail/${oldFileName}`).catch(() => {});
      await unlink(`./STORAGE/thumbnail/${newFileName}`).catch(() => {});
    }
  });
});
