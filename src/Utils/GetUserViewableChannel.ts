import type { Channel } from "../db/schema";
import { QueryChannel } from "../queries/channel.query";

/**
 * 指定のユーザーが閲覧できるチャンネル情報を取得する
 * @param _userId - ユーザーId
 * @returns
 */
export default async function GetUserViewableChannel(
  _userId: string,
): Promise<Channel[]> {
  return await QueryChannel.getViewable({ userId: _userId });
}
