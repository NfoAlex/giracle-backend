import { status } from "elysia";
import { db } from "../..";
import { QueryBot } from "../../queries/bot.query";
import { QueryRoleLink } from "../../queries/roleLink.query";
import { QueryUser } from "../../queries/user.query";
import { Util } from "../../Util";

const DUPLICATE_NAME_MESSAGE = "Requested name is used by other bot or user";

//名前のUNIQUE制約違反を400へ変換する(作成と改名で同じ応答にする)
async function updateProfile(query: {
  userId: string;
  name?: string | undefined;
  selfIntroduction?: string | undefined;
}) {
  try {
    return await QueryUser.updateProfile(query);
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("UNIQUE constraint failed: ")
    ) {
      throw status(400, DUPLICATE_NAME_MESSAGE);
    }
    throw e;
  }
}

export namespace ServiceBot {
  export const PutBot = async (
    _userId: string,
    name: string,
    introduction?: string,
  ) => {
    //bun-sqliteは同期トランザクションなのでコールバック内でawaitしない
    try {
      const botData = db.transaction((tx) => {
        const botUser = QueryUser.insertInTx(tx, {
          name,
          isBot: true,
          selfIntroduction: introduction ?? "",
        });

        const botManage = QueryBot.insertWithRemoteUserIdInTx(tx, {
          remoteUserId: botUser.id,
          requestSender: _userId,
        });

        //Bot専用ロールをリンク
        QueryRoleLink.insertLinkInTx(tx, {
          userId: botUser.id,
          roleId: "BOT",
        });

        return {
          remoteUser: botUser,
          bot: botManage,
        };
      });

      return botData;
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.includes("UNIQUE constraint failed: ")
      ) {
        throw status(400, DUPLICATE_NAME_MESSAGE);
      }
      throw e;
    }
  };

  export const DeleteBot = async (_userId: string, botId: string) => {
    const [targetBot] = await QueryBot.getSingle({ botId });
    if (targetBot === undefined || targetBot.createdBy !== _userId) {
      throw status(404, "Bot not found");
    }

    const botData = db.transaction((tx) => {
      const botDeleted = QueryBot.deleteInTx(tx, { botId });
      if (botDeleted === undefined) {
        throw status(404, "Bot not found");
      }
      //削除したBotにBotロールを残さない
      QueryRoleLink.removeLinkInTx(tx, {
        userId: botDeleted.remoteUserId,
        roleId: "BOT",
      });

      const user = QueryUser.setDeletedInTx(tx, {
        userId: botDeleted.remoteUserId,
      });

      //userが存在しなくともエラーとせず、続行させる

      return {
        bot: botDeleted,
        remoteUser: user,
      };
    });

    //削除済みトークンのWSが購読を続けないように切る
    Util.wsUserInstance.disconnect(
      botData.bot.remoteUserId,
      "This bot was deleted",
    );

    return botData;
  };

  export const GetList = async (
    _userId: string,
    length: number,
    cursorBotId?: string,
    query?: string,
  ) => {
    //cursorBotIdは外部にidのみ公開し、ソートキー(createdAt,id)への解決はここで行う
    let cursorBot: { createdAt: Date; id: string } | undefined;
    if (cursorBotId !== undefined) {
      cursorBot = await QueryBot.getCursorBot({ botId: cursorBotId });
      if (cursorBot === undefined) {
        throw status(404, "Cursor bot not found");
      }
    }

    return await QueryBot.getList({
      createdBy: _userId,
      length,
      cursorBot,
      query,
    });
  };

  export const Update = async (
    _userId: string,
    botId: string,
    name?: string,
    selfIntroduction?: string,
  ) => {
    const [botData] = await QueryBot.getSingleWithRemoteUser({ botId });
    if (botData === undefined) {
      throw status(404, "Bot not found");
    }
    if (_userId !== botData.bot.createdBy) {
      throw status(400, "This is not your bot");
    }
    //name未指定は改名ではないため、同名判定より先に弾く(自己紹介だけの更新で承認を剥がさない)
    const botNameChanged = name !== undefined && name !== botData.user?.name;

    const userUpdated = await updateProfile({
      userId: botData.bot.remoteUserId,
      name,
      selfIntroduction,
    });

    //名前を変えているなら承諾状況を切り替え
    if (botNameChanged) {
      await QueryBot.updateBotIsApproved({ botId, isApproved: false });
      //未承認になったらHTTPだけでなくWSも止める(open時の判定しか効かないため)
      Util.wsUserInstance.disconnect(
        botData.bot.remoteUserId,
        "Your bot is not approved yet",
      );
    }
    return userUpdated;
  };

  export const GetListAll = async (
    length: number,
    cursorBotId?: string,
    query?: string,
  ) => {
    //cursorBotIdは外部にidのみ公開し、ソートキー(createdAt,id)への解決はここで行う
    let cursorBot: { createdAt: Date; id: string } | undefined;
    if (cursorBotId !== undefined) {
      cursorBot = await QueryBot.getCursorBot({ botId: cursorBotId });
      if (cursorBot === undefined) {
        throw status(404, "Cursor bot not found");
      }
    }

    return await QueryBot.getListAll({ length, query, cursorBot });
  };

  export const GetByRemoteUserId = async (remoteUserId: string) => {
    const bot = await QueryBot.getBotByRemoteUserId({ remoteUserId });
    if (bot === undefined) throw status(404, "Bot not found");

    return bot;
  };
}
