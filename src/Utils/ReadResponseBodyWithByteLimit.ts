/**
 * レスポンスボディを最大バイト数まで読み込む
 * 上限を超えた場合は打ち切らずに破棄し、読み込みに失敗した場合とあわせてnullを返す
 * @param response
 * @param maxBytes 読み込みを許可する最大バイト数
 */
export default async function ReadResponseBodyWithByteLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      //Content-Length未申告・偽装に備えて読み込み中も上限を判定する
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch (e) {
    console.error("ReadResponseBodyWithByteLimit :: 読み込みエラー->", e);
    return null;
  }

  //チャンクを1つのバイト列に結合
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
