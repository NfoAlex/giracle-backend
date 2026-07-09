/**
 * LIKE検索用にユーザー入力をエスケープする
 * `%` / `_` がワイルドカードとして解釈されないよう `\` でエスケープする
 * 呼び出し側では `LIKE ... ESCAPE '\\'` と組み合わせて使用する
 * @param value エスケープ対象の文字列
 */
export default function EscapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
