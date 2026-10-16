import { status } from "elysia";
import { db } from "../..";
import { QueryBot } from "../../queries/bot.query";
import { QueryUser } from "../../queries/user.query";

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

        return {
          remoteUser: botUser,
          bot: botManage,
        };
      });

      return botData;
    } catch(e) {
      if (e instanceof Error && e.message.includes("UNIQUE constraint failed: ")) {
        throw status(400, "Requested name is used by other bot or user");
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
      const user = QueryUser.setDeletedInTx(tx, {
        userId: botDeleted.remoteUserId,
      });

      //userが存在しなくともエラーとせず、続行させる

      return {
        bot: botDeleted,
        remoteUser: user,
      };
    });

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

    const userUpdated = await QueryUser.updateProfile({
      userId: botData.bot.remoteUserId,
      name,
      selfIntroduction,
    });

    //名前を変えているなら承諾状況を切り替え
    if (botNameChanged) {
      await QueryBot.updateBotIsApproved({ botId, isApproved: false });
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
