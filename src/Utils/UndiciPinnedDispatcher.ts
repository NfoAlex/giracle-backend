// undici専用: dispatcher経由で検証済みIPにのみ接続しDNS rebinding(TOCTOU)を防ぐ
// global fetch用のPinnedFetchとは別物。ogs等のundiciベースfetchに dispatcher として渡す
import type { LookupAddress, LookupOptions } from "node:dns";
import { Agent } from "undici";
import { ValidateUrl } from "./ValidateUrl";

export namespace UndiciPinnedDispatcher {
  // 公開IPのみ返すlookup。解決と検証を1回で行う
  export function safeLookup(
    hostname: string,
    options: LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) {
    Bun.dns
      .lookup(hostname)
      .then((addresses) => {
        const valid = addresses.filter(
          (a) => !ValidateUrl.isBlockedIp(a.address),
        );
        if (valid.length === 0) {
          callback(
            new Error(`blocked or unresolvable host: ${hostname}`),
            "",
            4,
          );
          return;
        }
        if (options.all) {
          callback(
            null,
            valid.map((a) => ({ address: a.address, family: a.family })),
          );
          return;
        }
        callback(null, valid[0].address, valid[0].family);
      })
      .catch((e) =>
        callback(e instanceof Error ? e : new Error(String(e)), "", 4),
      );
  }

  // undiciベースfetchへ渡すdispatcher
  export function create(): Agent {
    return new Agent({ connect: { lookup: safeLookup } });
  }
}
