// URL検証 (SSRF対策): プロトコル制限 + リテラルIP排除 + DNS解決 + 禁止IP判定まとめ
// 参照形: Util.validateUrl.resolvePublicHost(...)

export namespace ValidateUrl {
  // プライベート/予約IPv4レンジ判定 (SSRF対策)
  const blockedIpv4Pattern =
    /^(0\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.(0\.(0|2)\.|168\.)|198\.(1[89]\.|51\.100\.)|203\.0\.113\.|2(2[4-9]|3\d)\.|2[4-5]\d\.)/;

  // 未指定/ループバック/NAT64/ドキュメント/ULA/リンクローカル/マルチキャストIPv6判定
  const blockedIpv6Pattern =
    /^(::1$|::$|64:ff9b:|100::|2001:db8:|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:|ff[0-9a-f]*:)/;

  // DNS解決の上限。c-ares/getaddrinfoの既定待ち時間に依存させない (OWASP: 短いtimeout)
  const DNS_TIMEOUT_MS = 3000;

  // リテラルIP (IPv4/IPv6) 判定。名前解決の前に弾く
  function isLiteralIp(hostname: string): boolean {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
  }

  // IPv4埋め込みIPv6 (::ffff:127.0.0.1 / ::ffff:7f00:1 / 完全展開形) の埋め込みIPv4を
  // dotted-quadへ変換する。埋め込み形でなければnull
  function readV4fromV6(lower: string): string | null {
    const m = lower.match(
      /^(?:(?:0{1,4}:){5}|::)(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{1,4}(?::[0-9a-f]{1,4})?)$/,
    );
    if (!m) return null;

    // 既にdotted-quadならそのまま
    if (m[1].includes(".")) return m[1];

    // hex形 (7f00:1) は32bitへ詰める
    const [hi, lo] = m[1].split(":");
    const n = ((parseInt(hi, 16) << 16) | (lo ? parseInt(lo, 16) : 0)) >>> 0;

    // 32bitへ詰めたhexをネットワークバイト順 (上位バイトから) に分解する。
    // こうして作ったdotted-quadを既存のblockedIpv4Patternへそのまま渡せる
    return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }

  // 名前解決後アドレスの禁止IP判定
  function isBlockedIp(ip: string): boolean {
    const lower = ip.toLowerCase();

    // IPv4-mapped IPv6は表記形 (dotted/hex/完全展開) に依らず埋め込みIPv4で判定
    const target = readV4fromV6(lower) ?? lower;

    return blockedIpv4Pattern.test(target) || blockedIpv6Pattern.test(lower);
  }

  /**
   * 取得可能なホストか検証しつつ名前解決する。リテラルIP・禁止IP・解決不能・timeoutはnull
   * @param hostname 解決対象ホスト名 (括弧除去済み)
   * @param timeoutMs 打ち切りまでの時間
   */
  export async function resolvePublicHost(
    hostname: string,
    timeoutMs = DNS_TIMEOUT_MS,
  ): Promise<{ address: string; family: number }[] | null> {
    if (isLiteralIp(hostname)) return null;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("dns timeout")), timeoutMs);
    });

    let addresses: { address: string; family: number }[] | null;
    try {
      // Bun.dns.lookupはsignal非対応のためraceで打ち切る
      addresses = await Promise.race([Bun.dns.lookup(hostname), timeout]);
    } catch {
      addresses = null; // 解決不能・timeout
    } finally {
      clearTimeout(timer);
    }

    if (!addresses || addresses.length === 0) return null;

    // 全アドレスが公開IPのときだけ返す (内部IPが1つでもあれば呼び出し側へ渡さない)
    if (addresses.some((a) => isBlockedIp(a.address))) return null;

    return addresses;
  }
}
