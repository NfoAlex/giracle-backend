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
    const botData = await db.transaction(async (tx) => {
      const botUser = QueryUser.insertInTx(tx, {
        name,
        isBot: true,
        selfIntroduction: introduction ?? "",
      });

      const botManage = await QueryBot.insertWithRemoteUserIdInTx(tx, {
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
    const botData = await db.transaction(async (tx) => {
      const botDeleted = await QueryBot.deleteInTx(tx, { botId });
      if (botDeleted === undefined) {
        throw status(404, "Bot not found");
      }
      const user = await QueryUser.setDeleted({
        userId: botDeleted.remoteUserId,
      });
      if (user === undefined) {
        throw status(404, "User not found");
      }

      return {
        bot: botDeleted,
        remoteUser: user,
      };
    });

    return botData;
  };
}
