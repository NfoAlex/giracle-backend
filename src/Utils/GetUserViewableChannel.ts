import { and, eq, exists, inArray, notExists, notInArray, or, sql } from "drizzle-orm";
import { db } from "..";
import { channelJoins, channelViewableRoles, channels, roleLinks } from "../db/schema";
import type { Channel } from "../db/schema";

/**
 * 指定のユーザーが閲覧できるチャンネル情報を取得する
 * @param _userId - ユーザーId
 * @param _onlyJoinedChannel - 参加しているチャンネルのみを取得するか
 * @returns
 */
export default async function GetUserViewableChannel(
  _userId: string,
  _onlyJoinedChannel = false,
): Promise<Channel[]> {
  //ユーザーのロールを取得
  const userRolesLinks = await db
    .select({ roleId: roleLinks.roleId })
    .from(roleLinks)
    .where(eq(roleLinks.userId, _userId));
  //ユーザーのロールIdを配列化
  const userRoleIds = userRolesLinks.map((role) => role.roleId);

  //閲覧ロールが設定されているもので自分のロールがあるなら見れる
  const hasViewableRoleCondition =
    userRoleIds.length > 0
      ? exists(
          db
            .select()
            .from(channelViewableRoles)
            .where(
              and(
                eq(channelViewableRoles.channelId, channels.id),
                inArray(channelViewableRoles.roleId, userRoleIds),
              ),
            ),
        )
      : sql`false`;

  //チャンネルの閲覧限定ロールが設定されているもので、自分のロールが含まれないものは見れない
  const noUnviewableRoleCondition =
    userRoleIds.length > 0
      ? notExists(
          db
            .select()
            .from(channelViewableRoles)
            .where(
              and(
                eq(channelViewableRoles.channelId, channels.id),
                notInArray(channelViewableRoles.roleId, userRoleIds),
              ),
            ),
        )
      : notExists(
          db
            .select()
            .from(channelViewableRoles)
            .where(eq(channelViewableRoles.channelId, channels.id)),
        );

  const joinedCondition = exists(
    db
      .select()
      .from(channelJoins)
      .where(
        and(eq(channelJoins.channelId, channels.id), eq(channelJoins.userId, _userId)),
      ),
  );

  //このユーザーが見れるチャンネルIdを取得
  const viewableOr = or(
    //チャンネル作成者は見れる
    eq(channels.createdUserId, _userId),
    hasViewableRoleCondition,
    noUnviewableRoleCondition,
    joinedCondition,
  );

  const whereCondition = _onlyJoinedChannel
    ? //参加しているチャンネルのみを取得する場合はチャンネルに参加しているか確認
      and(viewableOr, joinedCondition)
    : viewableOr;

  return await db.select().from(channels).where(whereCondition);
}
