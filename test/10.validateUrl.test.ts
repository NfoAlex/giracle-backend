import { describe, expect, test } from "bun:test";
import FetchSafe from "../src/Utils/FetchSafe";
import { ValidateUrl } from "../src/Utils/ValidateUrl";

//指定アドレスを返すDNSを再現する。戻り値は復元関数
const mockDns = (addresses: string[]) => {
  const original = Bun.dns.lookup;
  Bun.dns.lookup = (async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
      ttl: 0,
    }))) as typeof Bun.dns.lookup;

  return () => {
    Bun.dns.lookup = original;
  };
};

//DNS解決後のアドレスでSSRFフィルタが表記ゆれにより通過しないことの検証
describe("ValidateUrl/resolvePublicHost", () => {
  test("IPv4埋め込みIPv6はhex形・完全展開形でもブロックする", async () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1", //127.0.0.1のhex形
      "::7f00:1", //IPv4互換形
      "::127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1", //完全展開形
      "::ffff:a00:1", //10.0.0.1
      "::ffff:a9fe:a9fe", //169.254.169.254 (クラウドメタデータ)
      "::ffff:c0a8:101", //192.168.1.1
      "127.0.0.1",
      "fe80::1",
    ]) {
      const restore = mockDns([ip]);
      try {
        expect(await ValidateUrl.resolvePublicHost("example.com")).toBeNull();
      } finally {
        restore();
      }
    }
  });

  test("公開IPのみなら解決結果を返す", async () => {
    const restore = mockDns(["93.184.216.34", "::ffff:808:808"]); //8.8.8.8
    try {
      const addresses = await ValidateUrl.resolvePublicHost("example.com");
      expect(addresses?.map((a) => a.address)).toEqual([
        "93.184.216.34",
        "::ffff:808:808",
      ]);
    } finally {
      restore();
    }
  });

  test("内部IPが1つでも混ざれば拒否する", async () => {
    const restore = mockDns(["93.184.216.34", "127.0.0.1"]);
    try {
      expect(await ValidateUrl.resolvePublicHost("example.com")).toBeNull();
    } finally {
      restore();
    }
  });

  test("解決結果が空なら拒否する", async () => {
    const restore = mockDns([]);
    try {
      expect(await ValidateUrl.resolvePublicHost("example.com")).toBeNull();
    } finally {
      restore();
    }
  });

  test("リテラルIPは名前解決せず拒否する", async () => {
    let lookupCount = 0;
    const original = Bun.dns.lookup;
    Bun.dns.lookup = (async () => {
      lookupCount++;
      return [];
    }) as typeof Bun.dns.lookup;
    try {
      for (const host of ["127.0.0.1", "::1", ":::"]) {
        expect(await ValidateUrl.resolvePublicHost(host)).toBeNull();
      }
      expect(lookupCount).toBe(0);
    } finally {
      Bun.dns.lookup = original;
    }
  });

  test("応答が無いホストはtimeoutMsで打ち切る", async () => {
    const original = Bun.dns.lookup;
    //応答しないDNSを再現
    Bun.dns.lookup = (() => new Promise(() => {})) as typeof Bun.dns.lookup;
    try {
      const start = Date.now();
      expect(await ValidateUrl.resolvePublicHost("example.com", 50)).toBeNull();
      expect(Date.now() - start).toBeLessThan(1000);
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
