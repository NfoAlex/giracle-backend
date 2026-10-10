import { db } from "../..";
import { QueryBot } from "../../queries/bot.query";
import { QueryUser } from "../../queries/user.query";

export namespace ServiceBot {
  export const PutBot = async (
    createdBy: string,
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
        requestSender: createdBy,
      });

      return {
        remoteUser: botUser,
        bot: botManage,
      };
    });

    return botData;
  };
}
