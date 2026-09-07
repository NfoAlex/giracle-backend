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
        columns: { tokenCode: false }
      });
      if (botManage === undefined)
        throw status(401, "Authorization header is invalid");
      if (botManage.approveStatus !== "APPROVED")
        throw status(401, "Your bot is not approved");

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
