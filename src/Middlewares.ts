import { Elysia, status, t } from "elysia";
import ogs from "open-graph-scraper";
import webpush from "web-push";
import { db } from ".";
import type { Message } from "../prisma/generated/client";
import { MessageUrlPreviewCreateManyMessageInput } from "../prisma/generated/models";
import type {
  PushPayload,
  WebPushKeys,
  WebPushSendResult,
} from "./components/Notification/types";

// トークンキャッシュ (5分間有効)
const tokenCache = new Map<string, { userId: string; isBanned: boolean; cachedAt: number }>();

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

//制限設定
const limitConfig = {
  anonymous: {
    limit: Number.parseInt(Bun.env.RATE_LIMIT_ANONYMOUS_COUNT ?? "25"),
    windowMs:
      Number.parseInt(Bun.env.RATE_LIMIT_ANONYMOUS_TIMEOUT ?? "60") * 1000,
  },
  authenticated: {
    limit: Number.parseInt(Bun.env.RATE_LIMIT_AUTHORIZED_COUNT ?? "200"),
    windowMs:
      Number.parseInt(Bun.env.RATE_LIMIT_AUTHORIZED_TIMEOUT ?? "60") * 1000,
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

//Web Push (VAPID) 初期化
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
} else {
  console.warn(
    "Middlewares :: WebPush : VAPID keys are not set. Web push is disabled.",
  );
}

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
        token.expires = new Date(now + ONE_MINUITE * 60 * 24 * 15);
        return { CheckToken: { _userId: cachedToken.userId } };
      }

      //トークンがDBにあるか確認
      const tokenData = await db.token.findUnique({
        where: {
          token: tokenValue,
        },
        select: {
          userId: true,
          user: {
            select: {
              isBanned: true,
            },
          },
        },
      });

      //トークンが無効ならエラー
      if (tokenData === null) {
        return status(401, "Invalid token");
      }

      // キャッシュに保存
      tokenCache.set(tokenValue, { userId: tokenData.userId, isBanned: tokenData.user.isBanned, cachedAt: now });

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
            const roleLink = await db.roleLink.findFirst({
              where: {
                userId: _userId,
                OR: [
                  {
                    role: { [roleTerm]: true },
                  },
                  {
                    role: { manageServer: true },
                  },
                ],
              },
            });

            //該当権限を持つロール付与情報が無いなら停止
            if (roleLink === null) {
              return status(401, "Role level not enough");
            }
          },
        };
      },
    });

  export const RateLimiter = new Elysia({ name: "rateLimiter" })
    .resolve({ as: "scoped" }, async ({ request, cookie: { token }, server }) => {
      //未ログインであるかどうか
      let isAnonymous = false;
      //識別キー
      let key: string = (token.value as string | undefined) ?? "anonymous";

      //未ログインの場合は状態を設定しIPアドレス等をキーにする
      if (token?.value === undefined) {
        isAnonymous = true;
        const socketAddress = server?.requestIP(request);
        if (socketAddress === null || socketAddress === undefined) {
          return status(500, "somethin went wrong :(");
        }
        key = socketAddress.address;

        //IPアドレスが既にブロックされているか確認
        const blockedIP = await db.blockedIPAddress.findUnique({
          where: {
            address: key,
          },
        });
        if (blockedIP) {
          //ブロックされている場合はカウントを増加させて429を返す
          db.blockedIPAddress.update({
            where: {
              address: key,
            },
            data: {
              blockedCount: blockedIP.blockedCount + 1,
              latestAccess: new Date(),
            },
          });
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
          db.token.delete({
            where: {
              token: key,
            },
          });
        } else {
          //匿名の場合の処理
          //カウントがプラス10を超過している場合はIPアドレスでブロック
          if (bucket.count > configUsing.limit + 10) {
            db.blockedIPAddress.upsert({
              where: {
                address: key,
              },
              create: {
                address: key,
                blockedCount: 1,
              },
              update: {
                blockedCount: {
                  increment: 1,
                },
                latestAccess: new Date(),
              },
            });
          }
        }

        return status(429, "Too Many Requests");
      }

      //カウント増加
      bucket.count += 1;
    });

  export const WebPush = new Elysia({ name: "WebPush" })
    .decorate("webpush", {
      isReady: (): boolean => vapidReady,
      getPublicKey: (): string => VAPID_PUBLIC_KEY,
      sendToDevice: async (
        endpoint: string,
        keysJson: string | null,
        payload: PushPayload,
      ): Promise<WebPushSendResult> => {
        if (!vapidReady) return { ok: false, invalidateToken: false };
        if (!keysJson) return { ok: false, invalidateToken: true };

        let keys: WebPushKeys;
        try {
          keys = JSON.parse(keysJson) as WebPushKeys;
        } catch {
          return { ok: false, invalidateToken: true };
        }

        try {
          await webpush.sendNotification(
            {
              endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth },
            },
            JSON.stringify(payload),
          );
          return { ok: true, invalidateToken: false };
        } catch (e: unknown) {
          const statusCode = (e as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            return { ok: false, invalidateToken: true };
          }
          console.error("Middlewares :: WebPush : send error", endpoint, e);
          return { ok: false, invalidateToken: false };
        }
      },
    });

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
              /https?:\/\/[-_.!~*\'()a-zA-Z0-9;\/?:\@&=+\$,%#\u3000-\u30FE\u4E00-\u9FA0\uFF01-\uFFE3]+/g;

            // 重複したURLを排除（同じURLのOGPを何度も取得しないようにする）
            let urlMatched = [...new Set(messageData.content?.match(urlRegex) ?? [])];

            if (urlMatched.length === 0 && !messageData.isEdited) return;

            // Twitter/Xのリンクをfxtwitterに置換（URLオブジェクトを使って安全にパース）
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
                  return parsedUrl.toString();
                }
                return urlStr;
              } catch {
                return urlStr; // パース失敗時はそのまま返す
              }
            });

            // 編集された時用に現在のURLプレビュー情報を削除
            await db.messageUrlPreview.deleteMany({
              where: { messageId },
            });

            // URLリストから不正なもの（ローカルIPなど）を事前にフィルタリング
            const validUrls = urlMatched.filter((urlStr) => {
              try {
                const parsedUrl = new URL(urlStr);
                const hostname = parsedUrl.hostname;

                // 基本的なSSRF対策（より強固にするならDNS名前解決の結果をチェックする必要があります）
                if (hostname === "localhost" || hostname === "127.0.0.1") return false;
                if (hostname.includes("169.254.")) return false; // クラウドのメタデータサーバー

                const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
                if (isIpAddress) return false;

                return true;
              } catch {
                return false; // 無効なURLは除外
              }
            });

            // 並列でOGPデータを取得（Promise.allSettledで一部失敗しても他を活かす）
            const fetchPromises = validUrls.map(async (url) => {
              const data = await ogs({ url });
              if (data.error) {
                throw new Error(`OGS Fetch Error for ${url}`);
              }
              return data.result;
            });

            const results = await Promise.allSettled(fetchPromises);

            // 成功した結果だけをDB保存用のフォーマットに変換
            const creatingPreviewDataArr: MessageUrlPreviewCreateManyMessageInput[] = results
              .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
              .map((result) => {
                const res = result.value;
                return {
                  url: res.requestUrl || "",
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
              const messageUpdated = await db.message.update({
                where: { id: messageId },
                data: {
                  MessageUrlPreview: {
                    createMany: {
                      data: creatingPreviewDataArr,
                    },
                  },
                },
                include: {
                  MessageUrlPreview: true,
                },
              });

              server?.publish(
                `channel::${messageUpdated.channelId}`,
                JSON.stringify({
                  signal: "message::UpdateMessage",
                  data: messageUpdated,
                }),
              );
            }
          },
        };
      },
    });

};
