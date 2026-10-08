/**
 * 空白・全角空白・改行のみなら空扱い
 * @param text
 * @returns
 */
export default function IsBlankString(text: string) {
  const spaceCount =
    (text.match(/ /g) || "").length +
    (text.match(/　/g) || "").length +
    (text.match(/\n/g) || "").length;
  return spaceCount === text.length;
}
