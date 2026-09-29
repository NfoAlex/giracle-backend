import { eq } from "drizzle-orm";
import { Elysia, status, t } from "elysia";
import { db } from "../";
import { type BotManage, botManages } from "../db/schema";

//Bot権限フラグのみ抽出(真偽値列限定。文字列/日付列混入防止)
type TBotManagePermission = Pick<
  BotManage,
  | "canFetchUserinfo"
  | "canFetchRoleinfo"
  | "canManageUser"
  | "canManageServerConfig"
  | "canReadMessage"
  | "canSendMessage"
>;

// CheckApiCode がコンテキストへ注入するBot認証情報（tokenCode は秘匿するため型に含めない）
export type TBotCredential = Pick<
  BotManage,
  "id" | "botName" | "remoteUserId" | "useAllChannel"
>;

//Bot API用レート制限のバケット（キーは検証済みの Bot の Id。Bot 数で頭打ちになるため定期削除は不要）
const botBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Bot 単位の簡易レート制限（固定ウィンドウ）。CheckApiCode の認証通過後＝Botの実在が確定した後に呼ぶ。
 * 認証されていないリクエストは Bucket を作らない（IPアドレス判定は Middleware.RateLimiter 側の担当）。
 * @param botId 制限の対象となる Bot の Id
 */
function checkBotRateLimit(botId: string) {
  //通常APIの RateLimiter と同じく RATE_LIMIT_ENABLED でのみ有効
  if (Bun.env.RATE_LIMIT_ENABLED !== "true") return;

  const limit = Number.parseInt(Bun.env.RATE_LIMIT_BOT_COUNT ?? "200", 10);
  const windowMs =
    Number.parseInt(Bun.env.RATE_LIMIT_BOT_TIMEOUT ?? "60", 10) * 1000;

  const now = Date.now();
  const bucket = botBuckets.get(botId);

  //バケットが無いかリセット時間を過ぎているなら新規作成
  if (bucket === undefined || bucket.resetAt <= now) {
    botBuckets.set(botId, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw status(429, "Too Many Requests");
  }

  bucket.count += 1;
}

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
      if (botManage.user?.isBanned || botManage.user?.isDeleted) {
        throw status(401, "This bot is disabled");
      }

      //認証を通った Bot 単位でレート制限（未認証リクエストはここに到達しない）
      checkBotRateLimit(botManage.id);

      return {
        CheckApiCode: {
          ...botManage,
        },
      };
    });

  export const CheckPermission = new Elysia({ name: "CheckPermission" })
    .use(CheckApiCode)
    .macro({
      checkPermission(permissionTerm: keyof TBotManagePermission) {
        return {
          async beforeHandle({ CheckApiCode }) {
            if (CheckApiCode === undefined) {
              throw status(500, "CheckApiCode should be alive");
            }

            if (!CheckApiCode[permissionTerm]) {
              throw status(403, "Permission not enough");
            }
          },
        };
      },
    });
}
