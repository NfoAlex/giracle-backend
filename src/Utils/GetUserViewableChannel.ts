import { db } from "..";
import type { Channel } from "../../prisma/generated/client";

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
  const userRolesLinks = await db.roleLink.findMany({
    where: {
      userId: _userId,
    },
    select: {
      roleId: true,
    },
  });
  //ユーザーのロールIdを配列化
  const userRoleIds = userRolesLinks.map((role) => role.roleId);

  //このユーザーが見れるチャンネルIdを取得
  return (await db.channel.findMany({
    where: {
      AND: [
        {
          OR: [
            //ここで見れるチャンネルをすべて抜き出す
            {
              //チャンネル作成者は見れる
              createdUserId: _userId,
            },
            {
              //閲覧ロールが設定されているもので自分のロールがあるなら見れる
              ChannelViewableRole: {
                some: {
                  roleId: {
                    in: userRoleIds,
                  },
                },
              },
            },
            {
              //チャンネルの閲覧限定ロールが設定されているもので、自分のロールが含まれないものは見れない
              NOT: {
                ChannelViewableRole: {
                  some: {
                    roleId: {
                      notIn: userRoleIds,
                    },
                  },
                },
              },
            },
            {
              ChannelJoin: {
                some: {
                  userId: _userId,
                },
              },
            },
          ],
        },
        _onlyJoinedChannel //参加しているチャンネルのみを取得する場合はチャンネルに参加しているか確認
          ? {
            ChannelJoin: {
              some: {
                userId: _userId,
              },
            },
          }
          : {},
      ],
    },
  })) as Channel[];
}
