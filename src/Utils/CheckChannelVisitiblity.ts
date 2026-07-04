import { db } from "..";

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
  const roleViewable = await db.channelViewableRole.findMany({
    where: {
      channelId: _channelId,
    },
    select: {
      roleId: true,
    },
  });

  if (roleViewable.length > 0) {
    // チャンネルに参加しているか調べる
    const channelJoined = await db.channelJoin.findUnique({
      where: {
        userId_channelId: {
          userId: _userId,
          channelId: _channelId,
        },
      },
    });

    // チャンネルに参加していないならロールで調べる
    if (!channelJoined) {
      const hasViewableRole = await db.roleLink.findFirst({
        where: {
          userId: _userId,
          roleId: { in: roleViewable.map((role) => role.roleId) },
        },
      });

      // ロールを持っていれば閲覧可能
      if (hasViewableRole) {
        return true;
      }

      // サーバー管理者の場合は閲覧可能
      const userAdminRole = await db.roleLink.findFirst({
        where: {
          userId: _userId,
          role: { manageServer: true },
        },
      });

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
