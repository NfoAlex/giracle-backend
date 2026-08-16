const SAFE_FILE_TYPES = new Map<string, string>([
  // ドキュメント
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
  // テキスト
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  // 圧縮
  ["application/zip", "zip"],
  ["application/x-7z-compressed", "7z"],
  ["application/x-rar-compressed", "rar"],
  ["application/gzip", "gz"],
  ["application/x-tar", "tar"],
  ["application/x-bzip2", "bz2"],
  // 音声
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/webm", "weba"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  // 動画
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
  ["video/quicktime", "mov"],
  ["video/x-msvideo", "avi"],
  ["video/x-matroska", "mkv"],
]);

export default function CheckFileExtensionIsSafe(ext: string) {
  if (SAFE_FILE_TYPES.get(ext) !== undefined) return true;
  return false;
}
