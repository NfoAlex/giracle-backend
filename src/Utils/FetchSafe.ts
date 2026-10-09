// 安全fetch (SSRF対策): URLプレビュー・サムネイル共用。正規化→検証→IP固定→各hop検証まで一括
// undiciベースのfetch (ogs等) には使えない。ogsは { html } でオフライン解析すること
import { ValidateUrl } from "./ValidateUrl";

// リダイレクト上限 (短縮URL解決用)
const MAX_REDIRECT = 3;
// 単一hopの取得制限 (OWASP: 短いtimeout)
const TIMEOUT_MS = 5000;

export type TSafeFetchResult = { response: Response; finalUrl: string };

/**
 * OWASP準拠で取得する。失敗・検証NGはnull (理由の区別はしない)
 * @param urlStr 取得元URL
 * @param opts.maxRedirects 追跡上限。fxtwitter変換済み等、追跡禁止時は0
 */
export default async function FetchSafe(
  urlStr: string,
  opts?: { maxRedirects?: number },
): Promise<TSafeFetchResult | null> {
  const maxRedirects = opts?.maxRedirects ?? MAX_REDIRECT;
  let current = urlStr.normalize("NFC");

  for (let i = 0; i <= maxRedirects; i++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }

    // http/https以外は取得しない
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    // 認証情報付きは取得しない (userinfo混入防止)
    if (parsed.username || parsed.password) return null;

    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

    // リテラルIP除外 + 全IPが公開IPかの検証 (DNS rebinding対策)。NGはnull
    const addresses = await ValidateUrl.resolvePublicHost(hostname);
    if (!addresses) return null;

    // 証明書検証はservername側で元ホスト名に対して行われる
    // currentは上記で検証済み。fetch先は検証済みIPに固定したpinnedのみ
    let pinned: URL;
    try {
      pinned = new URL(current);
    } catch {
      return null;
    }
    pinned.hostname =
      addresses[0].family === 6
        ? `[${addresses[0].address}]`
        : addresses[0].address;

    const headers = new Headers();
    headers.set("Host", parsed.host);

    // 自動追従は検証前の内部IPへ飛ぶためmanual固定
    const res = await fetch(pinned.toString(), {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // @ts-expect-error Bun拡張のtlsオプション
      tls: { servername: hostname },
    }).catch(() => null);
    if (!res) return null;

    // リダイレクト以外は追跡完了
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return { response: res, finalUrl: current };
    }

    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!location) return null;

    try {
      current = new URL(location, current).toString();
    } catch {
      return null;
    }

    if (i === maxRedirects) return null;
  }

  return null;
}
