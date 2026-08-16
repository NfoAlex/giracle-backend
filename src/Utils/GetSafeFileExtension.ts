// アップロードを許可する安全なファイル種別(Content-Type → 保存拡張子)。
// ブラウザがアクティブコンテンツとして解釈し得る型(text/html / svg / xml / javascript 等)は含めない。
// 画像以外のXSSは配信時の Content-Disposition: attachment + X-Content-Type-Options: nosniff で防ぐ。
const SAFE_FILE_EXTENSIONS = new Map<string, string>([
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

// 許可済みのContent-Typeなら保存用の安全な拡張子を返し、許可外なら undefined を返す
export default function GetSafeFileExtension(
  mimeType: string,
): string | undefined {
  return SAFE_FILE_EXTENSIONS.get(mimeType);
}
