import { eq } from "drizzle-orm";
import { Elysia, status, t } from "elysia";
import { db } from "../";
import { type BotManage, botManages } from "../db/schema";

//Bot権限フラグ(can*)のキーのみ抽出
type TBotManagePermission = Extract<keyof BotManage, `can${string}`>;

// CheckApiCode がコンテキストへ注入するBot認証情報（tokenCode は秘匿するため型に含めない）
export type TBotCredential = Pick<
  BotManage,
  "id" | "botName" | "remoteUserId" | "useAllChannel"
>;

//Bot API用レート制限のバケット（キーは検証済みの Bot の Id。Bot 数で頭打ちになるため定期削除は不要）
const botBuckets = new Map<string, { count: number; resetAt: number }>();

export namespace ExtMiddleware {
  export const CheckApiCode = new Elysia({ name: "CheckApiCode" })
    .guard({
      headers: t.Object({ authorization: t.String() }),
    })
    .resolve({ as: "scoped" }, async ({ headers: { authorization } }) => {
      if (authorization === undefined)
        throw status(401, "Authorization header is invalid");

      const botManage = await db.query.botManages.findFirst({
        where: eq(botManages.tokenCode, authorization),
        columns: { tokenCode: false },
        with: {
          user: { columns: { isBanned: true, isDeleted: true } },
        },
      });
      if (botManage === undefined)
        throw status(401, "Authorization header is invalid");
      if (botManage.approveStatus !== "APPROVED")
        throw status(401, "Your bot is not approved");

      // BAN・論理削除された Bot のユーザーは操作させない
      if (botManage.user?.isBanned || botManage.user?.isDeleted)
        throw status(401, "This bot is disabled");

      return { CheckApiCode: botManage };
    });

  // Bot 単位のレート制限（固定ウィンドウ）。認証通過後（Bot の実在が確定した後）に Bot の Id で数える。
  // 認証されていないリクエストはバケットを作らない（IP 判定は Middleware.RateLimiter 側の担当）。
  // 有効化は RATE_LIMIT_BOT_ENABLED 単独で行い、無効ならルート側で .use() しない
  //（Middleware.RateLimiter と同じくモジュール読込時に環境変数を1度だけ評価する）。
  // ルート側で CheckApiCode の後に .use() すること（先に使うと CheckApiCode がコンテキストに無い）。
  export const BotRateLimit = new Elysia({ name: "BotRateLimit" })
    .use(CheckApiCode)
    .onBeforeHandle({ as: "scoped" }, ({ CheckApiCode }) => {
      if (CheckApiCode === undefined)
        throw status(500, "CheckApiCode should be alive");

      const limit = Number.parseInt(Bun.env.RATE_LIMIT_BOT_COUNT ?? "200", 10);
      const windowMs =
        Number.parseInt(Bun.env.RATE_LIMIT_BOT_TIMEOUT ?? "60", 10) * 1000;

      const botId = CheckApiCode.id;
      const now = Date.now();
      const bucket = botBuckets.get(botId);

      //バケットが無いかリセット時間を過ぎているなら新規作成
      if (bucket === undefined || bucket.resetAt <= now) {
        botBuckets.set(botId, { count: 1, resetAt: now + windowMs });
        return;
      }

      if (bucket.count >= limit) throw status(429, "Too Many Requests");

      bucket.count += 1;
    });

  export const CheckPermission = new Elysia({ name: "CheckPermission" })
    .use(CheckApiCode)
    .macro({
      checkPermission(permissionTerm: TBotManagePermission) {
        return {
          beforeHandle({ CheckApiCode }) {
            if (CheckApiCode === undefined)
              throw status(500, "CheckApiCode should be alive");

            if (!CheckApiCode[permissionTerm]) {
              throw status(403, "Permission not enough");
            }
          },
        };
      },
    });
}
