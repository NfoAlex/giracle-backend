import { eq } from "drizzle-orm";
import { db } from "../db";
import { messageUrlPreviewThumbnails } from "../db/schema";

export default function GetUrlPreviewThumbnailFileName(
  url: string,
): string | undefined {
  const previewFileName = db
    .select({ fileName: messageUrlPreviewThumbnails.fileName })
    .from(messageUrlPreviewThumbnails)
    .where(eq(messageUrlPreviewThumbnails.url, url))
    .get();

  return previewFileName?.fileName;
}
