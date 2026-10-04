import { QueryChannel } from "../queries/channel.query";
import { QueryChannelJoin } from "../queries/channelJoin.query";
import { QueryChannelViewableRole } from "../queries/channelViewableRole.query";
import { QueryRoleLink } from "../queries/roleLink.query";

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
  const roleViewable = await QueryChannelViewableRole.getRoleIdsByChannel({
    channelId: _channelId,
  });
  if (roleViewable.length === 0) return true;

  //チャンネル作成者は無条件で閲覧可能(GetUserViewableChannelの判定と揃える)
  const channel = QueryChannel.getCreatedUserId({ channelId: _channelId });
  if (channel !== undefined && channel.createdUserId === _userId) return true;

  // チャンネルに参加しているか調べる
  const channelJoined = await QueryChannelJoin.getJoin({
    channelId: _channelId,
    userId: _userId,
  });
  if (channelJoined !== undefined) return true;

  // チャンネルに参加していないならロールで調べる
  const hasViewableRole = await QueryRoleLink.getLinkByRoles({
    userId: _userId,
    roleIds: roleViewable.map((role) => role.roleId),
  });
  if (hasViewableRole) {
    return true;
  }

  // サーバー管理者の場合は閲覧可能
  const userAdminRole = QueryRoleLink.getManageServerLink({ userId: _userId });

  if (userAdminRole) {
    return true;
  }

  //ここにたどり着いたらアクセス不可
  return false;
}
