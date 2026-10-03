import { rm } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { status } from "elysia";
import { imageSize } from "image-size";
import { db } from "../..";
import type { Message } from "../../db/schema";
import {
  channelJoinOnDefaults,
  channelJoins,
  channels,
  channelViewableRoles,
  messageFileAttached,
  messageReadTimes,
} from "../../db/schema";
import { QueryChannel } from "../../queries/channel.query";
import { QueryMessage } from "../../queries/message.query";
import { QueryUser } from "../../queries/user.query";
import { Util } from "../../Util";

export namespace ServiceChannel {
  export const Join = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoined = await QueryChannel.getJoin({
      channelId,
      userId: _userId,
    });
    //既に参加している
    if (channelJoined !== undefined) {
      throw status(400, "Already joined");
    }

    //チャンネルが存在するか確認
    const channelData = await QueryChannel.getSingle({ channelId });
    //チャンネルが存在しない
    if (channelData === undefined) {
      throw status(404, "Channel not found");
    }
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    await QueryChannel.insertJoin({ channelId, userId: _userId });

    return;
  };

  export const Leave = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoinData = await QueryChannel.getJoin({
      channelId,
      userId: _userId,
    });
    if (channelJoinData === undefined) {
      throw status(404, "You are not joined this channel");
    }

    //TODO: 既読時間用のQuery層を作ったときに置き換える
    //既読時間データを削除
    await db
      .delete(messageReadTimes)
      .where(
        and(
          eq(messageReadTimes.channelId, channelId),
          eq(messageReadTimes.userId, _userId),
        ),
      );
    //チャンネル参加データを削除
    await QueryChannel.removeJoin({ channelId, userId: _userId });
  };

  export const GetInfo = async (channelId: string, _userId: string) => {
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    const channelData = await QueryChannel.getSingleWithViewableRole({
      channelId,
    });

    if (channelData === undefined) {
      throw status(404, "Channel not found");
    }

    return channelData;
  };

  export const List = async (_userId: string) => {
    //閲覧できるチャンネルを取得(可視判定はGetUserViewableChannelに集約)
    return await Util.getUserViewableChannel(_userId);
  };

  export const GetHistory = async (
    channelId: string,
    body: {
      messageIdFrom?: string | undefined;
      messageTimeFrom?: string | undefined;
      fetchLength?: number | undefined;
      fetchDirection?: "older" | "newer" | undefined;
    } | null,
    _userId: string,
  ) => {
    //チャンネルの存在確認
    const channel = await QueryChannel.getSingleId({ channelId });
    if (channel === undefined) {
      throw status(404, "Channel not found");
    }
    //チャンネルへのアクセス権限があるか調べる
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    const { messageIdFrom, fetchDirection, fetchLength, messageTimeFrom } =
      body || {};

    //基準位置に時間指定があるなら有効か確認
    if (messageTimeFrom !== undefined) {
      if (Number.isNaN(Date.parse(messageTimeFrom))) {
        throw status(400, "Invalid time format");
      }
    }

    let messageDataFrom: Message | undefined;
    //基準位置になるメッセージIdが指定されているなら
    if (messageIdFrom !== undefined) {
      //取得、格納
      messageDataFrom = await QueryMessage.getSingle({
        messageId: messageIdFrom,
      });
      //無ければエラー
      if (!messageDataFrom) {
        throw status(404, "Message cursor position not found");
      }
    }

    //基準になる時間を決定（メッセージId指定を優先、なければ時間指定）
    const timeFrom =
      messageDataFrom !== undefined
        ? messageDataFrom.createdAt
        : messageTimeFrom !== undefined
          ? new Date(messageTimeFrom)
          : undefined;

    //履歴を取得する
    //新しい方向への取得は昇順で直接取得することで、範囲境界を求める事前クエリを省く
    const fetchNewer = fetchDirection === "newer" && timeFrom !== undefined;
    const history = await QueryMessage.getHistory({
      channelId,
      timeFrom,
      fetchNewer,
      fetchLength,
    });
    //レスポンスは常に新しい順で返す
    if (fetchNewer) history.reverse();

    //履歴の最新・最初まで取得したかどうかを判別するため、取得方向に必要な側のみ取得
    const firstMessageOfChannel =
      fetchDirection === "newer"
        ? await QueryMessage.getOldestId({ channelId })
        : undefined;
    const latestMessageOfChannel =
      fetchDirection !== "newer"
        ? await QueryMessage.getNewestId({ channelId })
        : undefined;

    //取得した履歴が最新まで取得したか、または最初まで取得したかを判別
    let atEnd = false;
    let atTop = false;
    //取得方向によって判別方法が異なる
    if (fetchDirection === "newer") {
      if (history.length === 0 && firstMessageOfChannel !== undefined) {
        //取得した履歴が空だけど最古のメッセージが存在する場合
        atTop = false;
      } else if (
        history[0] !== undefined &&
        firstMessageOfChannel !== undefined
      ) {
        //取得した履歴がある場合
        atTop = firstMessageOfChannel?.id === history.at(-1)?.id;
      } else {
        //取得した履歴がない場合、最初まで取得したと判定
        atTop = true;
      }
      atEnd = history.length < (fetchLength || 30);
    } else {
      if (history.length === 0 && latestMessageOfChannel !== undefined) {
        //取得した履歴が空だけど最新のメッセージが存在する場合
        atEnd = false;
      } else if (
        history[0] !== undefined &&
        latestMessageOfChannel !== undefined
      ) {
        //取得した履歴がある場合
        atEnd = latestMessageOfChannel?.id === history[0].id;
      } else {
        //取得した履歴がない場合、最初まで取得したと判定
        atEnd = true;
      }
      atTop = history.length < (fetchLength || 30);
    }

    //画像の添付ファイルがあれば画像のメタデータ（縦幅など）を含める（並列実行）
    const ImageDimensions: {
      [fileId: string]: { height: number; width: number };
    } = {};
    const imageFilesAttached = history.flatMap((m) =>
      m.MessageFileAttached.filter((file) => file.type.startsWith("image/")),
    );
    await Promise.all(
      imageFilesAttached.map(async (file) => {
        try {
          const filePath = `./STORAGE/file/${channelId}/${file.savedFileName}`;
          //画像サイズはヘッダー部分から取得できるため、まずファイル先頭のみ読み込む
          let buffer = new Uint8Array(
            await Bun.file(filePath)
              .slice(0, 512 * 1024)
              .arrayBuffer(),
          );
          let dimensions: { width?: number; height?: number };
          try {
            dimensions = imageSize(buffer);
          } catch {
            //先頭だけで解析できない画像はファイル全体を読み込む
            buffer = new Uint8Array(await Bun.file(filePath).arrayBuffer());
            dimensions = imageSize(buffer);
          }

          const { width, height } = dimensions;
          if (width !== undefined && height !== undefined) {
            ImageDimensions[file.id] = {
              height,
              width,
            };
          }
        } catch (e) {
          console.error("channel.service :: GetHistory : 画像取得で失敗", {
            e,
          });
        }
      }),
    );

    //最後にメッセージごとにリアクションの合計数をそれぞれ格納する（1クエリで一括集計）
    const reactionSummaries = await Util.calculateReactionTotalBulk(
      history.map((m) => m.id),
      _userId,
    );
    for (const index in history) {
      //結果をこのメッセージ部分に格納する
      history[index] = {
        ...history[index],
        // @ts-expect-error - reactionSummaryの追加
        reactionSummary: reactionSummaries.get(history[index].id) ?? [],
      };
    }

    return {
      history, //履歴データ
      ImageDimensions, //画像用のサイズデータ(縦幅、横幅)
      atTop, //最初まで取得したかどうか
      atEnd, //最新まで取得したかどうか
    };
  };

  export const Search = async (
    query: string,
    _userId: string,
    cursorChannelId?: string,
  ) => {
    //閲覧できるチャンネルをId配列で取得
    const channelViewable = await Util.getUserViewableChannel(_userId);
    const channelIdsViewable = channelViewable.map((c) => c.id);

    //見えるチャンネルが無ければ検索結果も空
    if (channelIdsViewable.length === 0) return [];

    let cursorChannelName: string | undefined;
    if (cursorChannelId !== undefined) {
      const cursorChannel = await QueryChannel.getCursorChannel({
        cursorChannelId,
        viewableChannelIds: channelIdsViewable,
      });
      if (cursorChannel === undefined)
        throw status(400, "Cursor channel does not exist");
      cursorChannelName = cursorChannel.name;
    }

    //チャンネル検索(大小を区別しない前方一致)
    return await QueryChannel.searchViewableChannels({
      query,
      viewableChannelIds: channelIdsViewable,
      cursorChannelName,
    });
  };

  export const Invite = async (
    channelId: string,
    targetUserId: string,
    _userId: string,
  ) => {
    //このリクエストをしたユーザーがチャンネルに参加しているかどうかをチャンネル情報と共に確認
    const requestedUsersChannelJoin = await QueryChannel.getJoinWithChannel({
      channelId,
      userId: _userId,
    });
    if (!requestedUsersChannelJoin?.channel) {
      throw status(403, "You are not joined this channel or channel not found");
    }

    //対象ユーザーの存在を参加情報とともに確認
    const user = await QueryUser.getSingleWithChannelJoin({
      userId: targetUserId,
      channelId,
    });
    if (!user) {
      throw status(404, "User not found");
    }
    //対象ユーザーがすでに参加しているかどうかを確認
    if (user.ChannelJoin.length > 0) {
      throw status(400, "Already joined");
    }

    //チャンネル参加させる
    await QueryChannel.insertJoin({ channelId, userId: targetUserId });

    return;
  };

  export const Kick = async (
    channelId: string,
    targetUserId: string,
    _userId: string,
  ) => {
    //自分はKickできない
    if (targetUserId === _userId) {
      throw status(400, "You cannot kick yourself");
    }

    //このリクエストをしたユーザーがチャンネルに参加しているかどうかを確認
    const requestedUsersChannelJoin = await QueryChannel.getJoin({
      channelId,
      userId: _userId,
    });
    if (!requestedUsersChannelJoin) {
      throw status(403, "You are not joined this channel");
    }

    //TODO: 既読時間用のQuery層を作ったときに置き換える
    //既読時間データを削除(Leaveと対称にする)
    await db
      .delete(messageReadTimes)
      .where(
        and(
          eq(messageReadTimes.channelId, channelId),
          eq(messageReadTimes.userId, targetUserId),
        ),
      );
    //チャンネル参加データを削除(退出させる)
    await QueryChannel.removeJoin({ channelId, userId: targetUserId });

    return;
  };

  export const Update = async (
    channelId: string,
    name: string | undefined,
    description: string | undefined,
    isArchived: boolean | undefined,
    viewableRole: string[] | undefined,
    _userId: string,
  ) => {
    //チャンネルの存在を確認
    const channel = await QueryChannel.getSingle({ channelId });
    if (channel === undefined) {
      throw status(404, "Channel not found");
    }

    //チャンネルへのアクセス権限があるか調べる
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    //更新データが一つも無い場合はエラー
    if (
      name === undefined &&
      description === undefined &&
      isArchived === undefined &&
      viewableRole === undefined
    ) {
      throw status(400, "There is no data to update");
    }

    //適用するデータ群のJSON
    const updatingValues: {
      name?: string;
      description?: string;
      isArchived?: boolean;
    } = {};

    //渡されたデータを調べて適用するデータを格納
    if (name !== undefined && name !== "") updatingValues.name = name;
    if (description !== undefined) updatingValues.description = description;
    if (isArchived !== undefined) updatingValues.isArchived = isArchived;

    //チャンネルデータを更新する
    if (Object.keys(updatingValues).length > 0) {
      await QueryChannel.updateChannel({ channelId, values: updatingValues });
    }

    //チャンネル閲覧ロールを更新
    if (viewableRole !== undefined) {
      //重複を除去
      const uniqueRoleIds = [...new Set(viewableRole)];

      //現在の閲覧可能roleIdを削除、指定されたroleId全件を挿入(1トランザクションにまとめて中間状態を無くす)
      await QueryChannel.replaceViewableRoles({
        channelId,
        roleIds: uniqueRoleIds,
      });
    }

    //更新後のデータを取得
    const channelDataUpdated = await QueryChannel.getSingleWithViewableRole({
      channelId,
    });

    return channelDataUpdated;
  };

  export const Create = async (
    channelName: string,
    description: string,
    _userId: string,
  ) => {
    const newChannel = await QueryChannel.insertChannel({
      channelName,
      description,
      requestSender: _userId,
    });

    return newChannel;
  };

  export const Delete = async (
    channelId: string,
    _userId: string,
    server: Bun.Server<unknown> | null,
  ) => {
    //チャンネルの存在を確認
    const channel = await QueryChannel.getSingle({ channelId });
    if (channel === undefined) {
      throw status(404, "Channel not found");
    }

    //チャンネルへのアクセス権限があるか調べる
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    //チャンネル参加者にWSで通知
    server?.publish(
      `channel::${channelId}`,
      JSON.stringify({
        signal: "channel::Deleted",
        data: {
          channelId,
        },
      }),
    );
    //チャンネルに参加しているユーザーのWS登録を解除
    const joinedUsers = await QueryChannel.getJoinsByChannel({ channelId });
    for (const channelJoinData of joinedUsers) {
      Util.wsUserInstance.unsubscribe(
        channelJoinData.userId,
        `channel::${channelId}`,
      );
    }

    //メッセージ・チャンネル参加データ・デフォルト参加データ・既読時間・閲覧ロール・添付ファイル情報・チャンネル本体を1トランザクションで削除(孤児データ防止)
    db.transaction((tx) => {
      //TODO: 既読時間用のQuery層を作ったときに置き換える
      tx.delete(messageReadTimes)
        .where(eq(messageReadTimes.channelId, channelId))
        .run();
      tx.delete(channelViewableRoles)
        .where(eq(channelViewableRoles.channelId, channelId))
        .run();
      //TODO: 添付ファイル用のQuery層を作ったときに置き換える
      tx.delete(messageFileAttached)
        .where(eq(messageFileAttached.channelId, channelId))
        .run();
      QueryMessage.removeByChannelInTx(tx, { channelId });
      tx.delete(channelJoins)
        .where(eq(channelJoins.channelId, channelId))
        .run();
      tx.delete(channelJoinOnDefaults)
        .where(eq(channelJoinOnDefaults.channelId, channelId))
        .run();
      tx.delete(channels).where(eq(channels.id, channelId)).run();
    });

    //添付ファイルの実体を削除(DBの外側なのでトランザクション後に実行)
    await rm(`./STORAGE/file/${channelId}`, {
      recursive: true,
      force: true,
    }).catch((e) => {
      console.error("channel.service :: Delete : ストレージ削除エラー->", e);
    });

    return;
  };
}
