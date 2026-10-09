import { Elysia, status, t } from "elysia";
import ogs from "open-graph-scraper";
import type { Message, NewMessageUrlPreview } from "./db/schema";
import { QueryBlockedIPAddress } from "./queries/blockedIPAddress.query";
import { QueryMessage } from "./queries/message.query";
import { QueryMessageUrlPreview } from "./queries/messageUrlPreview.query";
import { QueryRequestLog } from "./queries/requestLog.query";
import { QueryRoleLink } from "./queries/roleLink.query";
import { QueryToken } from "./queries/token.query";
import { Util } from "./Util";

// トークンキャッシュ (5分間有効)
const tokenCache = new Map<
  string,
  { userId: string; isBanned: boolean; cachedAt: number; expiresAt: Date }
>();

const ONE_MINUITE = 60 * 1000;
// 古いキャッシュを定期削除 (1分毎)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache.entries()) {
    if (now - value.cachedAt > ONE_MINUITE * 5) {
      tokenCache.delete(key);
    }
  }
}, ONE_MINUITE);

/**
 * 指定トークンのキャッシュを無効化する（サインアウト・セッション削除時に使用）
 * @param token 無効化するトークン
 */
export function invalidateTokenCache(token: string) {
  tokenCache.delete(token);
}

/**
 * 指定ユーザーIdに紐づく全トークンキャッシュを無効化する
 * @param userId 無効化するユーザーId
 */
export function invalidateUserCache(userId: string) {
  for (const [key, value] of tokenCache.entries()) {
    if (value.userId === userId) {
      tokenCache.delete(key);
    }
  }
}

//制限設定
const limitConfig = {
  anonymous: {
    limit: Number.parseInt(Bun.env.RATE_LIMIT_ANONYMOUS_COUNT ?? "25", 10),
    windowMs:
      Number.parseInt(Bun.env.RATE_LIMIT_ANONYMOUS_TIMEOUT ?? "60", 10) * 1000,
  },
  authenticated: {
    limit: Number.parseInt(Bun.env.RATE_LIMIT_AUTHORIZED_COUNT ?? "200", 10),
    windowMs:
      Number.parseInt(Bun.env.RATE_LIMIT_AUTHORIZED_TIMEOUT ?? "60", 10) * 1000,
  },
};
//レート制限用クライアントごとのバケット管理
const buckets = new Map<string, { count: number; resetAt: number }>();
//レート制限用バケットの古いデータを定期的に削除
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, ONE_MINUITE);

export namespace Middleware {
  export const CheckToken = new Elysia({ name: "CheckToken" })
    .guard({
      cookie: t.Object({ token: t.String({ minLength: 1 }) }),
    })
    .resolve({ as: "scoped" }, async ({ cookie: { token } }) => {
      const tokenValue = token.value as string | undefined;
      //そもそもCookieが無いならエラー
      if (tokenValue === undefined) {
        return status(401, "Invalid token");
      }

      const now = Date.now();
      const cachedToken = tokenCache.get(tokenValue);

      // キャッシュ有効時
      if (cachedToken && now - cachedToken.cachedAt <= ONE_MINUITE * 5) {
        if (cachedToken.isBanned) {
          return status(401, "User is banned");
        }
        //キャッシュの寿命を延長
        token.expires = new Date(now + ONE_MINUITE * 60 * 24 * 15);

        //トークンの期限確認
        if (Date.now().valueOf() > cachedToken.expiresAt.valueOf()) {
          invalidateTokenCache(tokenValue);
          return status(401, "Invalid token");
        }
        return { CheckToken: { _userId: cachedToken.userId } };
      }

      //トークンがDBにあるか確認
      const tokenData = await QueryToken.getSingleWithUser({
        token: tokenValue,
      });

      //トークンが無効ならエラー
      if (tokenData === undefined) {
        return status(401, "Invalid token");
      }
      //トークンの期限確認
      if (Date.now().valueOf() > tokenData.expiresAt.valueOf()) {
        return status(401, "Invalid token");
      }

      // キャッシュに保存
      tokenCache.set(tokenValue, {
        userId: tokenData.userId,
        isBanned: tokenData.user.isBanned,
        cachedAt: now,
        expiresAt: tokenData.expiresAt,
      });

      //BAN確認
      if (tokenData.user.isBanned) {
        return status(401, "User is banned");
      }

      //トークンの期限を延長
      token.expires = new Date(now + 1000 * 60 * 60 * 24 * 15); //15日間有効

      return { CheckToken: { _userId: tokenData.userId } };
    });

  export const CheckRoleTerm = new Elysia({ name: "checkRoleTerm" })
    .use(Middleware.CheckToken)
    //.macro(({ onBeforeHandle }) => ({
    .macro({
      checkRoleTerm(roleTerm: string) {
        return {
          async beforeHandle({ CheckToken }) {
            if (CheckToken === undefined) return status(401, "Unauthorized");
            const _userId = CheckToken._userId;

            //該当権限を持つロール付与情報あるいはサーバー管理権限を検索
            const roleLink = QueryRoleLink.getLinkByRoleTerm({
              userId: _userId,
              roleTerm,
            });

            //該当権限を持つロール付与情報が無いなら停止
            if (roleLink === undefined) {
              return status(401, "Role level not enough");
            }
          },
        };
      },
    });

  export const RateLimiter = new Elysia({ name: "rateLimiter" }).resolve(
    { as: "scoped" },
    async ({ request, cookie: { token }, server }) => {
      //未ログインであるかどうか
      let isAnonymous = false;
      //識別キー
      let key: string = (token.value as string | undefined) ?? "anonymous";

      const tokenValue = token.value as string | undefined;

      //トークンがあってもキャッシュ・DBに実在しないなら無効なので匿名扱いにする(なりすましによるIPブロック回避防止)
      if (tokenValue === undefined) {
        isAnonymous = true;
      } else {
        const cachedToken = tokenCache.get(tokenValue);
        let tokenValid = cachedToken !== undefined;
        if (!tokenValid) {
          const tokenExists = await QueryToken.getSingleWithUserId({
            token: tokenValue,
          });
          tokenValid = tokenExists !== undefined;
        }
        if (!tokenValid) {
          isAnonymous = true;
        }
      }

      //未ログイン(または無効トークン)の場合は状態を設定しIPアドレス等をキーにする
      if (isAnonymous) {
        const socketAddress = server?.requestIP(request);
        if (socketAddress === null || socketAddress === undefined) {
          return status(500, "somethin went wrong :(");
        }
        key = socketAddress.address;

        //IPアドレスが既にブロックされているか確認
        const blockedIP = await QueryBlockedIPAddress.getSingle({
          address: key,
        });
        if (blockedIP) {
          //ブロックされている場合はカウントを増加させて429を返す
          await QueryBlockedIPAddress.incrementByAddress({ address: key });
          return status(429, "Too Many Requests");
        }
      }

      const now = Date.now();
      const bucket = buckets.get(key);

      //認証しているかどうかで使用設定を変更
      const configUsing = isAnonymous
        ? limitConfig.anonymous
        : limitConfig.authenticated;

      //バケットが無いかリセット時間を過ぎているなら新規作成
      if (!bucket || bucket.resetAt < now) {
        buckets.set(key, { count: 1, resetAt: now + configUsing.windowMs });
        return;
      }

      //制限を超過しているか確認、超過しているなら429を返す
      if (bucket.count >= configUsing.limit) {
        //ブロックされるけどカウント増加
        bucket.count += 1;

        //認証済みで制限を超えたならトークンを無効化
        if (!isAnonymous) {
          await QueryToken.removeByToken({ token: key });
          //キャッシュにも残っていると最大5分間有効なままになるため合わせて無効化
          invalidateTokenCache(key);
        } else {
          //匿名の場合の処理
          //カウントがプラス10を超過している場合はIPアドレスでブロック
          if (bucket.count > configUsing.limit + 10) {
            await QueryBlockedIPAddress.upsertByAddress({ address: key });
          }
        }

        return status(429, "Too Many Requests");
      }

      //カウント増加
      bucket.count += 1;
    },
  );

  export const UrlPreviewControl = new Elysia({ name: "urlPreviewControl" })
    .guard({
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
        message: t.String({ minLength: 1 }),
      }),
      response: t.Object({
        data: t.Union([t.Unsafe<Message>(), t.Undefined()]),
      }),
    })
    .onError(({ error }) => {
      console.error("Middleware :: urlPreviewControl : エラー->", error);
    })
    .macro({
      bindUrlPreview(isEnabled: boolean) {
        return {
          async afterResponse({ server, responseValue }) {
            const responseData = responseValue?.data;
            if (!isEnabled || responseData === undefined) return;

            const messageData = responseData;
            const messageId = messageData.id;

            const urlRegex: RegExp =
              /https?:\/\/[-_.!~*'()a-zA-Z0-9;/?:@&=+$,%#　-ヾ一-龠！-￣]+/g;

            // 重複したURLを排除（同じURLのOGPを何度も取得しないようにする）
            let urlMatched = [
              ...new Set(messageData.content?.match(urlRegex) ?? []),
            ];

            if (urlMatched.length === 0 && !messageData.isEdited) return;

            // Twitter/Xのリンクをfxtwitterに置換（URLオブジェクトを使って安全にパース）
            // 変換済みURLは追跡除外用に記録 (追跡するとx.comに戻りOGPが取れない)
            const convertedUrls = new Set<string>();
            urlMatched = urlMatched.map((urlStr) => {
              try {
                const parsedUrl = new URL(urlStr);
                const isTwitterOrX =
                  parsedUrl.hostname === "twitter.com" ||
                  parsedUrl.hostname === "www.twitter.com" ||
                  parsedUrl.hostname === "x.com" ||
                  parsedUrl.hostname === "www.x.com";

                if (isTwitterOrX && parsedUrl.pathname.includes("/status/")) {
                  parsedUrl.hostname = "fxtwitter.com";
                  const converted = parsedUrl.toString();
                  convertedUrls.add(converted);
                  return converted;
                }
                return urlStr;
              } catch {
                return urlStr; // パース失敗時はそのまま返す
              }
            });

            // 編集された時用に現在のURLプレビュー情報を削除
            await QueryMessageUrlPreview.removeByMessage({ messageId });

            // 並列でOGPデータを取得（Promise.allSettledで一部失敗しても他を活かす）
            const fetchPromises = urlMatched.map(async (url) => {
              // 安全fetchでHTML取得 (検証・IP固定・各hop検証・timeout内蔵)
              // fxtwitter変換済みは追跡しない (追跡するとx.comに戻りOGPが取れない)
              const fetched = await Util.fetchSafe(
                url,
                convertedUrls.has(url) ? { maxRedirects: 0 } : undefined,
              );
              if (!fetched) {
                throw new Error(`Safe fetch failed for ${url}`);
              }

              // 取得HTMLをオフライン解析 (ogs内蔵fetchは使わない)
              const html = await fetched.response.text().catch(() => null);
              if (html === null) {
                throw new Error(`HTML read failed for ${url}`);
              }
              const data = await ogs({ html });
              if (data.error) {
                throw new Error(`OGS Parse Error for ${url}`);
              }
              return { result: data.result, finalUrl: fetched.finalUrl };
            });

            const results = await Promise.allSettled(fetchPromises);

            // 成功した結果だけをDB保存用のフォーマットに変換
            const creatingPreviewDataArr: Omit<
              NewMessageUrlPreview,
              "id" | "messageId"
            >[] = results
              .filter(
                // biome-ignore lint/suspicious/noExplicitAny: すべてのパターンを受け付ける
                (result): result is PromiseFulfilledResult<any> =>
                  result.status === "fulfilled",
              )
              .map((result) => {
                const { result: res, finalUrl } = result.value;
                return {
                  url: finalUrl,
                  type: res.ogType || "UNKNOWN",
                  title: res.ogTitle || "",
                  description: res.ogDescription || "",
                  faviconLink: res.favicon || "",
                  // オプショナルチェーンを用いて、配列が空の場合のクラッシュを防ぐ
                  imageLink: res.ogImage?.[0]?.url ?? null,
                  videoLink: res.ogVideo?.[0]?.url ?? null,
                };
              });

            // OGPデータが存在する場合、または編集によってURLがすべて消えた場合のみ更新・通知
            if (creatingPreviewDataArr.length > 0 || messageData.isEdited) {
              if (creatingPreviewDataArr.length > 0) {
                await QueryMessageUrlPreview.insertMany({
                  items: creatingPreviewDataArr.map((p) => ({
                    ...p,
                    messageId,
                  })),
                });
              }

              const messageUpdated = await QueryMessage.getSingleWithPreviews({
                messageId,
              });

              if (messageUpdated) {
                server?.publish(
                  `channel::${messageUpdated.channelId}`,
                  JSON.stringify({
                    signal: "message::UpdateMessage",
                    data: messageUpdated,
                  }),
                );
              }
            }
          },
        };
      },
    });

  export const RequestLogger = new Elysia({ name: "requestLogger" })
    .onAfterResponse({ as: "global" }, async (ctx) => {
      //CheckToken分の型補完がされないので変数で抜き出して指定
      const { request, set } = ctx;
      const { CheckToken } = ctx as typeof ctx & {
        CheckToken?: { _userId: string };
      };

      //set.statusは string | number | undefined なので数値に揃える
      const responseStatus =
        typeof set.status === "number"
          ? set.status
          : set.status
            ? Number(set.status)
            : 200;

      //レート制限で弾いたリクエストは記録しない(拒否1回ごとにDB書き込みさせない)
      if (responseStatus === 429) return;
      if (request.method === "OPTIONS") return;

      let path: string;
      try {
        path = new URL(request.url).pathname;
      } catch {
        path = request.url;
      }

      try {
        await QueryRequestLog.insertLog({
          userId: CheckToken?._userId ?? null,
          method: request.method,
          path,
          status: responseStatus,
        });
      } catch (e) {
        console.error("Middlewares :: RequestLogger : dbの記録に失敗", {
          Error: e,
        });
      }
    })
    .onError(({ error }) => {
      console.error("Middleware :: ApiLogger : エラー->", error);
    });
}
