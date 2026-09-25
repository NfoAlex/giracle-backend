import { and, eq } from "drizzle-orm";
import { db } from "..";
import { roleInfos, roleLinks } from "../db/schema";

/**
 * 指定のユーザーがmanageServer権限のロールを引いているか確認する
 * ボット作成・更新時の承認免除の判定に使う
 * @param _userId
 */
export default async function HasManageServerRole(
  _userId: string,
): Promise<boolean> {
  const row = db
    .select({ userId: roleLinks.userId })
    .from(roleLinks)
    .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
    .where(and(eq(roleLinks.userId, _userId), eq(roleInfos.manageServer, true)))
    .get();

  return row !== undefined;
}
