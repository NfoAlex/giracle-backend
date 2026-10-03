import type { Channel } from "../db/schema";
import { QueryChannel } from "../queries/channel.query";
import { QueryRoleLink } from "../queries/roleLink.query";

/**
 * 指定のユーザーが閲覧できるチャンネル情報を取得する
 * @param _userId - ユーザーId
 * @returns
 */
export default async function GetUserViewableChannel(
  _userId: string,
): Promise<Channel[]> {
  //ユーザーのロールを取得して可視判定の材料にする
  const userRolesLinks = await QueryRoleLink.getLinksByUser({
    userId: _userId,
  });
  const userRoleIds = userRolesLinks.map((role) => role.roleId);
  //manageServer権限を持つなら全チャンネルが見れる
  const hasManageServer =
    userRoleIds.length > 0 &&
    QueryRoleLink.getManageServerLink({ userId: _userId }) !== undefined;

  return await QueryChannel.getViewable({
    userId: _userId,
    userRoleIds,
    hasManageServer,
  });
}
