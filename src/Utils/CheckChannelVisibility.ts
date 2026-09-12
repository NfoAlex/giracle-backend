import { and, eq, inArray } from "drizzle-orm";
import { db } from "..";
import {
  channelJoins,
  channelViewableRoles,
  roleInfos,
  roleLinks,
} from "../db/schema";

/**
 * 指定のユーザーIdが指定のチャンネルにアクセス可能かどうかを確認する
 * @param _channelId
 * @param _userId
 */
export default async function CheckChannelVisibility(
  _channelId: string,
  _userId: string,
): Promise<boolean> {
  //チャンネルの閲覧制限があるか確認
  const roleViewable = await db
    .select({ roleId: channelViewableRoles.roleId })
    .from(channelViewableRoles)
    .where(eq(channelViewableRoles.channelId, _channelId));
  if (roleViewable.length === 0) return true;

  // チャンネルに参加しているか調べる
  const channelJoined = await db.query.channelJoins.findFirst({
    where: and(
      eq(channelJoins.userId, _userId),
      eq(channelJoins.channelId, _channelId),
    ),
  });
  if (channelJoined !== undefined) return true;

  // チャンネルに参加していないならロールで調べる
  const hasViewableRole = await db.query.roleLinks.findFirst({
    where: and(
      eq(roleLinks.userId, _userId),
      inArray(
        roleLinks.roleId,
        roleViewable.map((role) => role.roleId),
      ),
    ),
  });
  if (hasViewableRole) {
    return true;
  }

  // サーバー管理者の場合は閲覧可能
  const userAdminRole = db
    .select({ userId: roleLinks.userId })
    .from(roleLinks)
    .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
    .where(and(eq(roleLinks.userId, _userId), eq(roleInfos.manageServer, true)))
    .get();

  if (userAdminRole) {
    return true;
  }

  //ここにたどり着いたらアクセス不可
  return false;
}
