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
