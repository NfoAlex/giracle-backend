// メッセージ文からプレビュー対象URL抽出・正規化・SSRF検証まとめ取得
// UrlPreviewControl afterResponse重くしないよう低レベル判定ここ集約
// 参照形: Util.extractValidPreviewUrls.extract(...) / .isBlockedIp(...) / .normalize(...) / .isLiteralIp(...)

export namespace ExtractValidPreviewUrls {
  // メッセージ文からURL抜き出す正規表現
  export const pattern =
    /https?:\/\/[-_.!~*'()a-zA-Z0-9;/?:@&=+$,%#　-ヾ一-龠！-￣]+/g;

  // X/Twitter埋め込みプレビュー取得用置換先
  export const fxHost = "fxtwitter.com";

  // X/Twitter判定対象ホスト
  export const twitterHosts = new Set([
    "twitter.com",
    "www.twitter.com",
    "x.com",
    "www.x.com",
  ]);

  // プライベート/予約IPv4レンジ判定 (SSRF対策)
  export const blockedIpv4Pattern =
    /^(0\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.(0\.(0|2)\.|168\.)|198\.(1[89]\.|51\.100\.)|203\.0\.113\.|2(2[4-9]|3\d)\.|2[4-5]\d\.)/;

  // 未指定/ループバック/NAT64/ドキュメント/ULA/リンクローカル/マルチキャストIPv6判定
  export const blockedIpv6Pattern =
    /^(::1$|::$|64:ff9b:|100::|2001:db8:|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:|ff[0-9a-f]*:)/;

  // プレビュー取得禁止IP判定 (名前解決後アドレス用)
  export function isBlockedIp(ip: string): boolean {
    const lower = ip.toLowerCase();

    // IPv4-mapped IPv6は埋め込みIPv4部分で判定
    const v4 = lower.replace(/^::ffff:/, "");

    return blockedIpv4Pattern.test(v4) || blockedIpv6Pattern.test(lower);
  }

  // X/TwitterステータスURLをfxtwitterへ置換 (OGP取得用)
  export function normalize(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);

      if (
        twitterHosts.has(parsed.hostname) &&
        parsed.pathname.includes("/status/")
      ) {
        parsed.hostname = fxHost;
        return parsed.toString();
      }

      return urlStr;
    } catch {
      // パース失敗時はそのまま返す (後段で除外)
      return urlStr;
    }
  }

  // リテラルIP (IPv4/IPv6) 判定
  export function isLiteralIp(hostname: string): boolean {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
  }

  /**
   * メッセージ文からプレビュー取得可能URLだけ返す
   * @param content メッセージ本文
   */
  export async function extract(content: string): Promise<string[]> {
    // 重複URL排除 (同一URLのOGP多重取得防止)
    const matched = [...new Set(content.match(pattern) ?? [])];

    // X/Twitterリンクをfxtwitterに置換
    const normalized = matched.map(normalize);

    // 不正URL (リテラルIP・内部ネットワーク) 除外
    const validUrls: string[] = [];

    for (const urlStr of normalized) {
      try {
        const hostname = new URL(urlStr).hostname.replace(/^\[|\]$/g, "");

        // リテラルIPは除外
        if (isLiteralIp(hostname)) continue;

        // 名前解決し、全アドレス公開IP確認
        const addresses = await Bun.dns.lookup(hostname);
        if (
          addresses.length === 0 ||
          addresses.some((addr) => isBlockedIp(addr.address))
        ) {
          continue;
        }

        validUrls.push(urlStr);
      } catch {
        // 無効URL・解決不能ホスト除外
      }
    }

    return validUrls;
  }
}
