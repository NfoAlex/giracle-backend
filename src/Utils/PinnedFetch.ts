// global fetch用: 検証済みIPに直接接続し、DNS rebinding(TOCTOU)を防ぐ
// undiciベースのfetchには UndiciPinnedDispatcher を使うこと
import { ValidateUrl } from "./ValidateUrl";

export namespace PinnedFetch {
  // 検証済みIPへ直接接続し、Host/SNIで元ホスト名を維持する
  export async function fetchPinned(
    urlStr: string,
    init?: RequestInit,
  ): Promise<Response | null> {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return null;
    }

    // http/https以外は取得しない (ValidateUrl.isValidと同じ制約)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

    let addresses: { address: string; family: number }[];
    try {
      addresses = await Bun.dns.lookup(hostname);
    } catch {
      return null;
    }

    const valid = addresses.filter((a) => !ValidateUrl.isBlockedIp(a.address));
    if (valid.length === 0) return null;

    // 検証済みIPに置き換え。証明書検証はservername側で元ホスト名に対して行われる
    let pinned: URL;
    try {
      pinned = new URL(urlStr);
    } catch {
      return null;
    }
    pinned.hostname =
      valid[0].family === 6 ? `[${valid[0].address}]` : valid[0].address;

    const headers = new Headers(init?.headers);
    headers.set("Host", parsed.host);

    return fetch(pinned.toString(), {
      ...init,
      headers,
      // @ts-expect-error Bun拡張のtlsオプション
      tls: { servername: hostname },
    }).catch(() => null);
  }
}
