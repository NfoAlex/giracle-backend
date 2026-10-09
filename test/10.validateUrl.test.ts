import { describe, expect, test } from "bun:test";
import FetchSafe from "../src/Utils/FetchSafe";
import { ValidateUrl } from "../src/Utils/ValidateUrl";

//DNS解決後のアドレスでSSRFフィルタが表記ゆれにより通過しないことの検証
describe("ValidateUrl/isBlockedIp", () => {
  test("IPv4埋め込みIPv6はhex形・完全展開形でもブロックする", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1", //127.0.0.1のhex形
      "::7f00:1", //IPv4互換形
      "::127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1", //完全展開形
      "::ffff:a00:1", //10.0.0.1
      "::ffff:a9fe:a9fe", //169.254.169.254 (クラウドメタデータ)
      "::ffff:c0a8:101", //192.168.1.1
    ]) {
      expect(ValidateUrl.isBlockedIp(ip)).toBe(true);
    }
  });

  test("公開IPv4にマップされたIPv6はブロックしない", () => {
    expect(ValidateUrl.isBlockedIp("::ffff:808:808")).toBe(false); //8.8.8.8
    expect(ValidateUrl.isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  test("素のIPv4/IPv6の判定は維持する", () => {
    expect(ValidateUrl.isBlockedIp("127.0.0.1")).toBe(true);
    expect(ValidateUrl.isBlockedIp("8.8.8.8")).toBe(false);
    expect(ValidateUrl.isBlockedIp("::1")).toBe(true);
    expect(ValidateUrl.isBlockedIp("fe80::1")).toBe(true);
    expect(ValidateUrl.isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });
});

//DNS解決がハングしても取得が無制限に待たないことの検証
describe("ValidateUrl/resolveHost", () => {
  test("応答が無いホストはtimeoutMsで打ち切る", async () => {
    const original = Bun.dns.lookup;
    //応答しないDNSを再現
    Bun.dns.lookup = (() => new Promise(() => {})) as typeof Bun.dns.lookup;
    try {
      await expect(ValidateUrl.resolveHost("example.com", 50)).rejects.toThrow(
        "dns timeout",
      );
    } finally {
      Bun.dns.lookup = original;
    }
  });

  test("解決結果はそのまま返る", async () => {
    const original = Bun.dns.lookup;
    const resolved = [{ address: "93.184.216.34", family: 4, ttl: 0 }];
    Bun.dns.lookup = (async () => resolved) as typeof Bun.dns.lookup;
    try {
      expect(await ValidateUrl.resolveHost("example.com")).toEqual(resolved);
    } finally {
      Bun.dns.lookup = original;
    }
  });
});

//IPアドレス直指定の入力は取得前に弾く（DNS解決へ進まないため実通信は発生しない）
describe("FetchSafe/入力検証", () => {
  test("リテラルIP・非http(s)・不正表記はnullで拒否する", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://:::/",
      "http://0x7f000001/", //WHATWGで127.0.0.1へ正規化される
      "http://2130706433/",
      "file:///etc/passwd",
      "http://user:pass@example.com/", //userinfo付き
    ]) {
      expect(await FetchSafe(url)).toBeNull();
    }
  });
});
