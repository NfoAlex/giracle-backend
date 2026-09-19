/**
 * GLOB検索用にユーザー入力をエスケープする
 * `*` / `?` / `[` / `]` がワイルドカードとして解釈されないよう `[...]` で囲む
 * 呼び出し側では前方一致させるため末尾に `*` を付けて使用する
 * @param value エスケープ対象の文字列
 */
export default function EscapeGlobPattern(value: string): string {
  return value.replace(/[*?[\]]/g, (char) => `[${char}]`);
}
