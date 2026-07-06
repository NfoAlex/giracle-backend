import { and, eq, exists, gte, inArray, like, lte, notExists, or, type SQL } from "drizzle-orm";
import { status } from "elysia";
import { imageSize } from "image-size";
import { db } from "../..";
import {
  channelJoinOnDefaults,
  channelJoins,
  channelViewableRoles,
  channels,
  messageReadTimes,
  messages,
  users,
} from "../../db/schema";
import type { Message } from "../../db/schema";
import { Util } from "../../Util";
import { WSUnsubscribe } from "../../ws";

export namespace ServiceChannel {
  export const Join = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoined = await db.query.channelJoins.findFirst({
      where: and(eq(channelJoins.userId, _userId), eq(channelJoins.channelId, channelId)),
    });
    //既に参加している
    if (channelJoined !== undefined) {
      throw status(400, "Already joined");
    }

    //チャンネルが存在するか確認
    const channelData = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });
    //チャンネルが存在しない
    if (channelData === undefined) {
      throw status(404, "Channel not found");
    }
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    await db.insert(channelJoins).values({
      userId: _userId,
      channelId,
    });

    return;
  };

  export const Leave = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoinData = await db.query.channelJoins.findFirst({
      where: and(eq(channelJoins.userId, _userId), eq(channelJoins.channelId, channelId)),
    });
    if (channelJoinData === undefined) {
      throw status(404, "You are not joined this channel");
    }

    //既読時間データを削除
    await db
      .delete(messageReadTimes)
      .where(and(eq(messageReadTimes.channelId, channelId), eq(messageReadTimes.userId, _userId)));
    //チャンネル参加データを削除
    await db
      .delete(channelJoins)
      .where(and(eq(channelJoins.userId, _userId), eq(channelJoins.channelId, channelId)));
  };

  export const GetInfo = async (channelId: string, _userId: string) => {
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await Util.checkChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    const channelData = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
      with: {
        ChannelViewableRole: {
          columns: {
            roleId: true,
          },
        },
      },
    });

    if (channelData === undefined) {
      throw status(404, "Channel not found");
    }

    return channelData;
  };

  export const List = async (_userId: string) => {
    //ロール閲覧制限のないチャンネルリストから取得
    const channelList = await db
      .select()
      .from(channels)
      .where(
        notExists(
          db.select().from(channelViewableRoles).where(eq(channelViewableRoles.channelId, channels.id)),
        ),
      );

    //ユーザーのロールを取得
    const user = await db.query.users.findFirst({
      where: eq(users.id, _userId),
      with: {
        RoleLink: true,
      },
    });
    if (!user) {
      throw status(500, "Internal Server Error");
    }
    //指定のロールでしか閲覧できない、また他条件でのチャンネルを取得
    const roleIds = user.RoleLink.map((roleLink) => roleLink.roleId);
    //HOSTロールがあるなら全チャンネルを取得
    if (roleIds.includes("HOST")) {
      return await db.select().from(channels);
    }

    const channelsLimited = await db
      .select()
      .from(channels)
      .where(
        or(
          //閲覧制限があり、自分がそのロールに所属している
          roleIds.length > 0
            ? exists(
                db
                  .select()
                  .from(channelViewableRoles)
                  .where(
                    and(
                      eq(channelViewableRoles.channelId, channels.id),
                      inArray(channelViewableRoles.roleId, roleIds),
                    ),
                  ),
              )
            : undefined,
          //自分が作成した
          eq(channels.createdUserId, _userId),
          //自分が参加している
          exists(
            db
              .select()
              .from(channelJoins)
              .where(and(eq(channelJoins.channelId, channels.id), eq(channelJoins.userId, _userId))),
          ),
        ),
      );

    //重複を取り除く
    const mergedChannels = [...channelList, ...channelsLimited];
    //channelIdをキーにしてMapに格納することで重複を排除
    const uniqueChannelsMap = new Map<string, (typeof mergedChannels)[0]>();
    for (const channel of mergedChannels) {
      uniqueChannelsMap.set(channel.id, channel);
    }
    //配列化
    const uniqueChannels = Array.from(uniqueChannelsMap.values());

    return uniqueChannels;
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
    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
      columns: { id: true },
    });
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

    let messageDataFrom: Message | undefined = undefined;
    //基準位置になるメッセージIdが指定されているなら
    if (messageIdFrom !== undefined) {
      //取得、格納
      messageDataFrom = await db.query.messages.findFirst({
        where: eq(messages.id, messageIdFrom),
      });
      //無ければエラー
      if (!messageDataFrom) {
        throw status(404, "Message cursor position not found");
      }
    }

    //基準のメッセージIdか時間指定があるなら時間を取得、取得設定として設定
    let dateCondition: SQL | undefined = undefined;
    if (messageDataFrom !== undefined) {
      //基準のメッセージIdによる取得データがあるなら
      //取得時間方向に合わせて設定を指定
      if (fetchDirection === "older") {
        //古い方向に取得する場合
        dateCondition = lte(messages.createdAt, messageDataFrom.createdAt);
      } else {
        //新しい方向に取得する場合
        //指定時間以降の最初のメッセージを取得
        const messageTakingFrom = await db.query.messages.findMany({
          where: and(eq(messages.channelId, channelId), gte(messages.createdAt, messageDataFrom.createdAt)),
          orderBy: (t, { asc }) => asc(t.createdAt),
          limit: fetchLength,
        });
        const optionLte = messageTakingFrom[messageTakingFrom.length - 1]?.createdAt;
        //指定時間以降のメッセージの時間より前のメッセージを取得するように設定
        dateCondition =
          optionLte !== undefined
            ? and(lte(messages.createdAt, optionLte), gte(messages.createdAt, messageDataFrom.createdAt))
            : gte(messages.createdAt, messageDataFrom.createdAt);
      }
    } else if (messageTimeFrom !== undefined) {
      //メッセージId指定がない場合、時間指定を使う
      //取得時間方向に合わせて設定を指定
      if (fetchDirection === "older") {
        //古い方向に取得する場合
        dateCondition = lte(messages.createdAt, new Date(messageTimeFrom));
      } else {
        //新しい方向に取得する場合
        //指定時間以降の最初のメッセージを取得
        const messageTakingFrom = await db.query.messages.findMany({
          where: and(eq(messages.channelId, channelId), gte(messages.createdAt, new Date(messageTimeFrom))),
          orderBy: (t, { asc }) => asc(t.createdAt),
          limit: fetchLength,
        });
        const optionLte = messageTakingFrom[messageTakingFrom.length - 1]?.createdAt;
        //指定時間以降のメッセージの時間より前のメッセージを取得するように設定
        dateCondition =
          optionLte !== undefined
            ? and(lte(messages.createdAt, optionLte), gte(messages.createdAt, new Date(messageTimeFrom)))
            : gte(messages.createdAt, new Date(messageTimeFrom));
      }
    }

    //履歴を取得する
    const history = await db.query.messages.findMany({
      where: dateCondition !== undefined ? and(eq(messages.channelId, channelId), dateCondition) : eq(messages.channelId, channelId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      limit: fetchLength,
      orderBy: (t, { desc }) => desc(t.createdAt),
    });

    //履歴の最新まで取ったかどうかを判別するために最初と最後のメッセージを取得
    const firstMessageOfChannel = await db.query.messages.findFirst({
      columns: {
        id: true,
      },
      where: eq(messages.channelId, channelId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
    const latestMessageOfChannel = await db.query.messages.findFirst({
      columns: {
        id: true,
      },
      where: eq(messages.channelId, channelId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });

    //取得した履歴が最新まで取得したか、または最初まで取得したかを判別
    let atEnd = false;
    let atTop = false;
    //取得方向によって判別方法が異なる
    if (fetchDirection === "newer") {
      if (history.length === 0 && firstMessageOfChannel !== undefined) {
        //取得した履歴が空だけど最古のメッセージが存在する場合
        atTop = false;
      } else if (history[0] !== undefined && firstMessageOfChannel !== undefined) {
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
      } else if (history[0] !== undefined && latestMessageOfChannel !== undefined) {
        //取得した履歴がある場合
        atEnd = latestMessageOfChannel?.id === history[0].id;
      } else {
        //取得した履歴がない場合、最初まで取得したと判定
        atEnd = true;
      }
      atTop = history.length < (fetchLength || 30);
    }

    //画像の添付ファイルがあれば画像のメタデータ（縦幅など）を含める
    const ImageDimensions: {
      [fileId: string]: { height: number; width: number };
    } = {};
    for (const index in history) {
      for (const file of history[index].MessageFileAttached) {
        if (file.type.startsWith("image/")) {
          try {
            //画像を読み込む
            const imageArrBuffer = await Bun.file(
              `./STORAGE/file/${channelId}/${file.savedFileName}`,
            ).arrayBuffer();
            const buffer = new Uint8Array(imageArrBuffer);
            //画像のメタデータを取得
            const { width, height } = imageSize(buffer);

            if (width !== undefined && height !== undefined) {
              ImageDimensions[file.id] = {
                height,
                width,
              };
            }
          } catch (e) { }
        }
      }
    }

    //最後にメッセージごとにリアクションの合計数をそれぞれ格納する
    for (const index in history) {
      const emojiTotalJson = await Util.calculateReactionTotal(
        history[index].id,
        _userId,
      );

      //結果をこのメッセージ部分に格納する
      history[index] = {
        ...history[index],
        // @ts-ignore - reactionSummaryの追加
        reactionSummary: emojiTotalJson,
      };
    }

    return {
      history, //履歴データ
      ImageDimensions, //画像用のサイズデータ(縦幅、横幅)
      atTop, //最初まで取得したかどうか
      atEnd, //最新まで取得したかどうか
    };
  };

  export const Search = async (query: string, _userId: string) => {
    //閲覧できるチャンネルをId配列で取得
    const channelViewable = await Util.getUserViewableChannel(_userId);
    const channelIdsViewable = channelViewable.map((c) => c.id);

    //チャンネル検索
    if (channelIdsViewable.length === 0) return [];
    const channelInfos = await db
      .select()
      .from(channels)
      .where(and(like(channels.name, `%${query}%`), inArray(channels.id, channelIdsViewable)));

    return channelInfos;
  };

  export const Invite = async (
    channelId: string,
    targetUserId: string,
    _userId: string,
  ) => {
    //このリクエストをしたユーザーがチャンネルに参加しているかどうかをチャンネル情報と共に確認
    const requestedUsersChannelJoin = await db.query.channelJoins.findFirst({
      where: and(eq(channelJoins.userId, _userId), eq(channelJoins.channelId, channelId)),
      with: {
        channel: true,
      },
    });
    if (!requestedUsersChannelJoin || !requestedUsersChannelJoin.channel) {
      throw status(403, "You are not joined this channel or channel not found");
    }

    //対象ユーザーの存在を参加情報とともに確認
    const user = await db.query.users.findFirst({
      where: eq(users.id, targetUserId),
      with: {
        ChannelJoin: {
          where: eq(channelJoins.channelId, channelId),
          columns: {
            userId: true,
          },
        },
      },
    });
    if (!user) {
      throw status(404, "User not found");
    }
    //対象ユーザーがすでに参加しているかどうかを確認
    if (user.ChannelJoin.length > 0) {
      throw status(400, "Already joined");
    }

    //チャンネル参加させる
    await db.insert(channelJoins).values({
      userId: targetUserId,
      channelId,
    });

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
    const requestedUsersChannelJoin = await db.query.channelJoins.findFirst({
      where: and(eq(channelJoins.userId, _userId), eq(channelJoins.channelId, channelId)),
    });
    if (!requestedUsersChannelJoin) {
      throw status(403, "You are not joined this channel");
    }

    //チャンネル参加データを削除(退出させる)
    await db
      .delete(channelJoins)
      .where(and(eq(channelJoins.userId, targetUserId), eq(channelJoins.channelId, channelId)));

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
    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });
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
      await db.update(channels).set(updatingValues).where(eq(channels.id, channelId));
    }

    //チャンネル閲覧ロールを更新
    if (viewableRole !== undefined) {
      // 既存のroleIdを取得
      const existingRoles = await db
        .select({ roleId: channelViewableRoles.roleId })
        .from(channelViewableRoles)
        .where(eq(channelViewableRoles.channelId, channelId));

      // 既存のroleIdをセットに変換
      const existingRoleIds = new Set(existingRoles.map((role) => role.roleId));

      // 新しいroleIdをフィルタリング
      const newRoleIds = viewableRole.filter(
        (roleId) => !existingRoleIds.has(roleId),
      );

      //現在の閲覧可能roleIdを削除、新しいroleIdを挿入(1トランザクションにまとめて中間状態を無くす)
      db.transaction((tx) => {
        tx.delete(channelViewableRoles).where(eq(channelViewableRoles.channelId, channelId)).run();

        if (newRoleIds.length > 0) {
          tx.insert(channelViewableRoles)
            .values(newRoleIds.map((roleId) => ({ channelId, roleId })))
            .run();
        }
      });
    }

    //更新後のデータを取得
    const channelDataUpdated = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
      with: {
        ChannelViewableRole: {
          columns: {
            roleId: true,
          },
        },
      },
    });

    return channelDataUpdated;
  };

  export const Create = async (
    channelName: string,
    description: string,
    _userId: string,
  ) => {
    const [newChannel] = await db
      .insert(channels)
      .values({
        name: channelName,
        description: description,
        createdUserId: _userId,
      })
      .returning();

    return newChannel;
  };

  export const Delete = async (channelId: string, _userId: string, server: Bun.Server<unknown> | null) => {
    //チャンネルの存在を確認
    const channel = await db.query.channels.findFirst({
      where: eq(channels.id, channelId),
    });
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
    const joinedUsers = await db.query.channelJoins.findMany({
      where: eq(channelJoins.channelId, channelId),
    });
    for (const channelJoinData of joinedUsers) {
      WSUnsubscribe(channelJoinData.userId, `channel::${channelId}`);
    }

    //メッセージ・チャンネル参加データ・デフォルト参加データ・チャンネル本体を1トランザクションで削除
    db.transaction((tx) => {
      tx.delete(messages).where(eq(messages.channelId, channelId)).run();
      tx.delete(channelJoins).where(eq(channelJoins.channelId, channelId)).run();
      tx.delete(channelJoinOnDefaults).where(eq(channelJoinOnDefaults.channelId, channelId)).run();
      tx.delete(channels).where(eq(channels.id, channelId)).run();
    });

    return;
  };
}
