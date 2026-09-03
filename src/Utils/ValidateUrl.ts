// URL検証 (SSRF対策): リテラルIP排除 + DNS解決 + 禁止IP判定まとめ
// 参照形: Util.validateUrl.isValid(...) / .isBlockedIp(...) / .isLiteralIp(...)

export namespace ValidateUrl {
  // プライベート/予約IPv4レンジ判定 (SSRF対策)
  const blockedIpv4Pattern =
    /^(0\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.(0\.(0|2)\.|168\.)|198\.(1[89]\.|51\.100\.)|203\.0\.113\.|2(2[4-9]|3\d)\.|2[4-5]\d\.)/;

  // 未指定/ループバック/NAT64/ドキュメント/ULA/リンクローカル/マルチキャストIPv6判定
  const blockedIpv6Pattern =
    /^(::1$|::$|64:ff9b:|100::|2001:db8:|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:|ff[0-9a-f]*:)/;

  // プレビュー取得禁止IP判定 (名前解決後アドレス用)
  function isBlockedIp(ip: string): boolean {
    const lower = ip.toLowerCase();

    // IPv4-mapped IPv6は埋め込みIPv4部分で判定
    const v4 = lower.replace(/^::ffff:/, "");

    return blockedIpv4Pattern.test(v4) || blockedIpv6Pattern.test(lower);
  }

  // リテラルIP (IPv4/IPv6) 判定
  function isLiteralIp(hostname: string): boolean {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
  }

  /**
   * プレビュー取得可能URLか検証する
   * @param urlStr 検証対象URL
   */
  export async function isValid(urlStr: string): Promise<boolean> {
    try {
      const parsed = new URL(urlStr);

      // http/https以外は取得しない
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }

      const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

      // リテラルIPは除外
      if (isLiteralIp(hostname)) return false;

      // 名前解決し、全アドレス公開IP確認
      const addresses = await Bun.dns.lookup(hostname);
      if (
        addresses.length === 0 ||
        addresses.some((addr) => isBlockedIp(addr.address))
      ) {
        return false;
      }

      return true;
    } catch {
      // 無効URL・解決不能ホスト除外
      return false;
    }
  }
}
