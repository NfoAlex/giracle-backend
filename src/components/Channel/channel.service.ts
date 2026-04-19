import { status } from "elysia";
import { imageSize } from "image-size";
import { db } from "../..";
import type { Message } from "../../../prisma/generated/client";
import CalculateReactionTotal from "../../Utils/CalculateReactionTotal";
import CheckChannelVisibility from "../../Utils/CheckChannelVisitiblity";
import GetUserViewableChannel from "../../Utils/GetUserViewableChannel";

export namespace ServiceChannel {
  export const Join = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoined = await db.channelJoin.findFirst({
      where: {
        userId: _userId,
        channelId,
      },
    });
    //既に参加している
    if (channelJoined !== null) {
      throw status(400, "Already joined");
    }

    //チャンネルが存在するか確認
    const channelData = await db.channel.findUnique({
      where: {
        id: channelId,
      },
    });
    //チャンネルが存在しない
    if (channelData === null) {
      throw status(404, "Channel not found");
    }
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await CheckChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    await db.channelJoin.create({
      data: {
        userId: _userId,
        channelId,
      },
    });

    return;
  };

  export const Leave = async (channelId: string, _userId: string) => {
    //チャンネル参加データが存在するか確認
    const channelJoinData = await db.channelJoin.findFirst({
      where: {
        userId: _userId,
        channelId,
      },
    });
    if (channelJoinData === null) {
      throw status(404, "You are not joined this channel");
    }

    //既読時間データを削除
    await db.messageReadTime
      .delete({
        where: {
          channelId_userId: {
            channelId,
            userId: _userId,
          },
        },
      })
      .catch(() => { });
    //チャンネル参加データを削除
    await db.channelJoin.deleteMany({
      where: {
        userId: _userId,
        channelId,
      },
    });
  };

  export const GetInfo = async (channelId: string, _userId: string) => {
    //チャンネルを見られないようなユーザーだと存在しないとしてエラーを出す
    if (!(await CheckChannelVisibility(channelId, _userId))) {
      throw status(404, "Channel not found");
    }

    const channelData = await db.channel.findUnique({
      where: {
        id: channelId,
      },
      include: {
        ChannelViewableRole: {
          select: {
            roleId: true,
          },
        },
      },
    });

    if (channelData === null) {
      throw status(404, "Channel not found");
    }

    return channelData;
  };

  export const List = async (_userId: string) => {
    //ロール閲覧制限のないチャンネルリストから取得
    const channelList = await db.channel.findMany({
      where: {
        ChannelViewableRole: {
          none: {},
        },
      },
    });

    //ユーザーのロールを取得
    const user = await db.user.findUnique({
      where: {
        id: _userId,
      },
      include: {
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
      return await db.channel.findMany();
    }

    const channelsLimited = await db.channel.findMany({
      where: {
        OR: [
          {
            //閲覧制限があり、自分がそのロールに所属している
            ChannelViewableRole: {
              some: {
                roleId: {
                  in: roleIds,
                },
              },
            },
          },
          {
            //自分が作成した
            createdUserId: _userId,
          },
          {
            //自分が参加している
            ChannelJoin: {
              some: {
                userId: _userId,
              },
            },
          },
        ],
      },
    });

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
    const channel = await db.channel.findUnique({
      where: {
        id: channelId,
      },
      select: { id: true },
    });
    if (channel === null) {
      throw status(404, "Channel not found");
    }
    //チャンネルへのアクセス権限があるか調べる
    if (!(await CheckChannelVisibility(channelId, _userId))) {
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

    let messageDataFrom: Message | null = null;
    //基準位置になるメッセージIdが指定されているなら
    if (messageIdFrom !== undefined) {
      //取得、格納
      messageDataFrom = await db.message.findUnique({
        where: {
          id: messageIdFrom,
        },
      });
      //無ければエラー
      if (!messageDataFrom) {
        throw status(404, "Message cursor position not found");
      }
    }

    //基準のメッセージIdか時間指定があるなら時間を取得、取得設定として設定
    let optionDate: { createdAt: { lte: Date } | { gte: Date } } | null = null;
    if (messageDataFrom !== null) {
      //基準のメッセージIdによる取得データがあるなら
      //取得時間方向に合わせて設定を指定
      if (fetchDirection === "older") {
        //古い方向に取得する場合
        optionDate = {
          createdAt: {
            lte: messageDataFrom.createdAt,
          },
        };
      } else {
        //新しい方向に取得する場合
        //指定時間以降の最初のメッセージを取得
        const messageTakingFrom = await db.message.findMany({
          where: {
            channelId: channelId,
            createdAt: {
              gte: messageDataFrom.createdAt,
            },
          },
          orderBy: {
            createdAt: "asc",
          },
          take: fetchLength,
        });
        const optionLte =
          messageTakingFrom[messageTakingFrom.length - 1]?.createdAt;
        //指定時間以降のメッセージの時間より前のメッセージを取得するように設定
        optionDate = {
          createdAt: {
            lte: optionLte,
            gte: messageDataFrom.createdAt,
          },
        };
      }
    } else if (messageTimeFrom !== undefined) {
      //メッセージId指定がない場合、時間指定を使う
      //取得時間方向に合わせて設定を指定
      if (fetchDirection === "older") {
        //古い方向に取得する場合
        optionDate = {
          createdAt: {
            lte: new Date(messageTimeFrom),
          },
        };
      } else {
        //新しい方向に取得する場合
        //指定時間以降の最初のメッセージを取得
        const messageTakingFrom = await db.message.findMany({
          where: {
            channelId: channelId,
            createdAt: {
              gte: new Date(messageTimeFrom),
            },
          },
          orderBy: {
            createdAt: "asc",
          },
          take: fetchLength,
        });
        //指定時間以降のメッセージの時間より前のメッセージを取得するように設定
        optionDate = {
          createdAt: {
            lte:
              messageTakingFrom[messageTakingFrom.length - 1]?.createdAt ||
              undefined,
            gte: new Date(messageTimeFrom),
          },
        };
      }
    }

    //履歴を取得する
    const history = await db.message.findMany({
      where: {
        channelId: channelId,
        ...optionDate,
      },
      include: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
      take: fetchLength,
      orderBy: { createdAt: "desc" },
    });

    //履歴の最新まで取ったかどうかを判別するために最初と最後のメッセージを取得
    const firstMessageOfChannel = await db.message.findFirst({
      select: {
        id: true,
      },
      where: {
        channelId: channelId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    const latestMessageOfChannel = await db.message.findFirst({
      select: {
        id: true,
      },
      where: {
        channelId: channelId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    //取得した履歴が最新まで取得したか、または最初まで取得したかを判別
    let atEnd = false;
    let atTop = false;
    //取得方向によって判別方法が異なる
    if (fetchDirection === "newer") {
      if (history.length === 0 && firstMessageOfChannel !== null) {
        //取得した履歴が空だけど最古のメッセージが存在する場合
        atTop = false;
      } else if (history[0] !== undefined && firstMessageOfChannel !== null) {
        //取得した履歴がある場合
        atTop = firstMessageOfChannel?.id === history.at(-1)?.id;
      } else {
        //取得した履歴がない場合、最初まで取得したと判定
        atTop = true;
      }
      atEnd = history.length < (fetchLength || 30);
    } else {
      if (history.length === 0 && latestMessageOfChannel !== null) {
        //取得した履歴が空だけど最新のメッセージが存在する場合
        atEnd = false;
      } else if (history[0] !== undefined && latestMessageOfChannel !== null) {
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
      const emojiTotalJson = await CalculateReactionTotal(
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
    const channelViewable = await GetUserViewableChannel(_userId);
    const channelIdsViewable = channelViewable.map((c) => c.id);

    //チャンネル検索
    const channelInfos = await db.channel.findMany({
      where: {
        name: {
          contains: query,
        },
        id: {
          in: channelIdsViewable,
        },
      },
    });

    return channelInfos;
  };

  export const Invite = async (
    channelId: string,
    targetUserId: string,
    _userId: string,
  ) => {
    //このリクエストをしたユーザーがチャンネルに参加しているかどうかをチャンネル情報と共に確認
    const requestedUsersChannelJoin = await db.channelJoin.findFirst({
      where: {
        userId: _userId,
        channelId,
      },
      include: {
        channel: true,
      },
    });
    if (!requestedUsersChannelJoin || !requestedUsersChannelJoin.channel) {
      throw status(403, "You are not joined this channel or channel not found");
    }

    //対象ユーザーの存在を参加情報とともに確認
    const user = await db.user.findUnique({
      where: {
        id: targetUserId,
      },
      include: {
        ChannelJoin: {
          where: {
            channelId,
          },
          select: {
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
    await db.channelJoin.create({
      data: {
        userId: targetUserId,
        channelId,
      },
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
    const requestedUsersChannelJoin = await db.channelJoin.findFirst({
      where: {
        userId: _userId,
        channelId,
      },
    });
    if (!requestedUsersChannelJoin) {
      throw status(403, "You are not joined this channel");
    }

    //チャンネル参加データを削除(退出させる)
    await db.channelJoin.deleteMany({
      where: {
        userId: targetUserId,
        channelId,
      },
    });

    return;
  };

  export const Update = async (
    channelId: string,
    name: string | undefined,
    description: string | undefined,
    isArchived: boolean | undefined,
    viewableRole: string[] | undefined,
  ) => {
    //チャンネルの存在を確認
    const channel = await db.channel.findUnique({
      where: {
        id: channelId,
      },
    });
    if (channel === null) {
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
    await db.channel.update({
      where: {
        id: channelId,
      },
      data: {
        ...updatingValues,
      },
    });

    //チャンネル閲覧ロールを更新
    if (viewableRole !== undefined) {
      // 既存のroleIdを取得
      const existingRoles = await db.channelViewableRole.findMany({
        where: {
          channelId: channelId,
        },
        select: {
          roleId: true,
        },
      });

      // 既存のroleIdをセットに変換
      //const existingRoleIds = new Set(existingRoles.map(role => role.roleId));
      const _existingRoleIds = existingRoles.map((role) => role.roleId);
      const existingRoleIds = new Set(_existingRoleIds);

      // 新しいroleIdをフィルタリング
      const newRoleIds = viewableRole.filter(
        (roleId) => !existingRoleIds.has(roleId),
      );

      //現在の閲覧可能roleIdを削除
      await db.channelViewableRole.deleteMany({
        where: {
          channelId,
        },
      });

      // 新しいroleIdを挿入
      if (newRoleIds.length > 0) {
        await db.channel.update({
          where: {
            id: channelId,
          },
          data: {
            ChannelViewableRole: {
              createMany: {
                data: newRoleIds.map((roleId) => ({
                  roleId,
                })),
              },
            },
          },
        });
      }
    }

    //更新後のデータを取得
    const channelDataUpdated = await db.channel.findUnique({
      where: {
        id: channelId,
      },
      include: {
        ChannelViewableRole: {
          select: {
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
    const newChannel = await db.channel.create({
      data: {
        name: channelName,
        description: description,
        user: {
          connect: {
            id: _userId,
          },
        },
      },
    });

    return newChannel;
  };

  export const Delete = async (channelId: string) => {
    //チャンネルの存在を確認
    const channel = await db.channel.findUnique({
      where: {
        id: channelId,
      },
    });
    if (channel === null) {
      throw status(404, "Channel not found");
    }

    //メッセージデータを削除
    const delMessage = db.message.deleteMany({
      where: {
        channelId,
      },
    });
    //チャンネル参加データを削除
    const delChannelJoin = db.channelJoin.deleteMany({
      where: {
        channelId,
      },
    });
    //チャンネルデフォルト参加データを削除
    const delJoinOnDefault = db.channelJoinOnDefault.deleteMany({
      where: {
        channelId,
      },
    });
    //チャンネルデータを削除
    const delChannel = db.channel.delete({
      where: {
        id: channelId,
      },
    });

    await db.$transaction([
      delMessage,
      delChannelJoin,
      delJoinOnDefault,
      delChannel,
    ]);

    return;
  };
}
