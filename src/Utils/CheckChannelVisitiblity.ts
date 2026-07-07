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

  if (roleViewable.length > 0) {
    // チャンネルに参加しているか調べる
    const channelJoined = await db.query.channelJoins.findFirst({
      where: and(
        eq(channelJoins.userId, _userId),
        eq(channelJoins.channelId, _channelId),
      ),
    });

    // チャンネルに参加していないならロールで調べる
    if (!channelJoined) {
      const hasViewableRole = await db.query.roleLinks.findFirst({
        where: and(
          eq(roleLinks.userId, _userId),
          inArray(
            roleLinks.roleId,
            roleViewable.map((role) => role.roleId),
          ),
        ),
      });

      // ロールを持っていれば閲覧可能
      if (hasViewableRole) {
        return true;
      }

      // サーバー管理者の場合は閲覧可能
      const userAdminRole = await db
        .select({ userId: roleLinks.userId })
        .from(roleLinks)
        .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
        .where(
          and(eq(roleLinks.userId, _userId), eq(roleInfos.manageServer, true)),
        )
        .get();

      if (userAdminRole) {
        return true;
      }
    } else {
      // チャンネルに参加している場合はそのまま返す
      return true;
    }
  } else {
    // 閲覧制限がない場合はそのまま返す
    return true;
  }

  //ここにたどり着いたらアクセス不可
  return false;
}
