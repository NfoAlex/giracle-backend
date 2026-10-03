import { QueryMessageUrlPreviewThumbnail } from "../queries/messageUrlPreviewThumbnail.query";

export default function GetUrlPreviewThumbnailFileName(
  url: string,
): string | undefined {
  const previewFileName = QueryMessageUrlPreviewThumbnail.getFileNameByUrl({
    url,
  });

  return previewFileName?.fileName;
}
