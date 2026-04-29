import { Elysia, status, t } from "elysia";
import ogs from "open-graph-scraper";
import { db } from ".";
import type { Message } from "../prisma/generated/client";

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
        return { _userId: cachedToken.userId };
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

      return {
        _userId: tokenData.userId,
      };
    });

  export const CheckRoleTerm = new Elysia({ name: "checkRoleTerm" })
    .use(Middleware.CheckToken)
    //.macro(({ onBeforeHandle }) => ({
    .macro({
      checkRoleTerm(roleTerm: string) {
        return {
          async beforeHandle({ _userId }) {
            //console.log("Middlewares :: checkRoleTerm : 送信者のユーザーId->", _userId);

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
    .resolve({ as: "scoped" }, async ({ request, cookie: { token } }) => {
      //未ログインであるかどうか
      let isAnonymous = false;
      //識別キー
      let key: string = (token.value as string | undefined) ?? "anonymous";

      //未ログインの場合は状態を設定しIPアドレス等をキーにする
      if (token?.value === undefined) {
        isAnonymous = true;
        key =
          request.headers.get("x-real-ip") ??
          request.headers.get("x-forwarded-for") ??
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-client-ip") ??
          request.headers.get("x-forwarded") ??
          request.headers.get("forwarded") ??
          request.headers.get("via") ??
          request.headers.get("remote-addr") ??
          request.headers.get("x-cluster-client-ip") ??
          request.headers.get("proxy-client-ip") ??
          request.headers.get("wl-proxy-client-ip") ??
          request.headers.get("x-forwarded-host") ??
          request.headers.get("x-forwarded-server") ??
          request.headers.get("host") ??
          request.headers.get("user-agent") ??
          ("anonymous" as string);

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
            //レスポンスデータ取り出し
            const responseData = responseValue?.data;
            //URLプレビューが無効あるいはレスポンスが存在しないなら何もしない
            if (!isEnabled || responseData === undefined || responseData === null)
              return;

            //メッセージデータを取得
            const messageData = responseData;
            //メッセージId取り出し
            const messageId = messageData.id;

            //URLを抽出
            const urlRegex: RegExp =
              /https?:\/\/[-_.!~*\'()a-zA-Z0-9;\/?:\@&=+\$,%#\u3000-\u30FE\u4E00-\u9FA0\uFF01-\uFFE3]+/g;
            const urlMatched = messageData.content?.match(urlRegex) ?? [];

            //URLが含まれていないかつ編集された状態じゃないなら何もしない
            if (urlMatched.length === 0 && !messageData.isEdited) return;

            //TwitterのリンクがあればfxTwitterへ
            for (const index in urlMatched) {
              if (
                (urlMatched[index].includes("twitter.com") ||
                  urlMatched[index].includes("x.com")) &&
                urlMatched[index].includes("status") &&
                !urlMatched[index].includes("fxtwitter.com")
              ) {
                urlMatched[index] = urlMatched[index].replace(
                  "twitter.com",
                  "fxtwitter.com",
                );
                urlMatched[index] = urlMatched[index].replace(
                  "x.com",
                  "fxtwitter.com",
                );
              }
            }

            //編集された時用に現在のURLプレビュー情報を削除
            await db.messageUrlPreview.deleteMany({
              where: {
                messageId,
              },
            });

            //URLプレビュー情報取得、格納
            for (const url of urlMatched) {
              await ogs({ url }).then(async (data) => {
                if (data.error) {
                  //console.error("Middleware :: urlPreviewControl : URLプレビュー情報取得エラー->", data.error);
                  return;
                }

                //メッセージデータにURLプレビュー情報を紐付けしながら変数として保存
                await db.message.update({
                  where: {
                    id: messageId,
                  },
                  data: {
                    MessageUrlPreview: {
                      create: {
                        url: data.result.requestUrl || "",
                        type: data.result.ogType || "UNKNOWN",
                        title: data.result.ogTitle || "",
                        description: data.result.ogDescription || "",
                        faviconLink: data.result.favicon || "",
                        imageLink:
                          data.result.ogImage !== undefined
                            ? data.result.ogImage[0].url
                            : null,
                        videoLink:
                          data.result.ogVideo !== undefined
                            ? data.result.ogVideo[0].url
                            : null,
                      },
                    },
                  },
                });
              });
            }

            //現在のメッセージを取得
            const message = await db.message.findUnique({
              where: {
                id: messageId,
              },
              include: {
                MessageUrlPreview: true,
              },
            });
            //WSで通知
            server?.publish(
              `channel::${messageData.channelId}`,
              JSON.stringify({
                signal: "message::UpdateMessage",
                data: message,
              }),
            );
          },
        };
      },
    });

};
