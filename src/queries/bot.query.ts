import { eq } from "drizzle-orm";
import type { db } from "..";
import { botManages } from "../db/schema";

export namespace QueryBot {
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  export const insertWithRemoteUserIdInTx = async (
    tx: Tx,
    query: {
      remoteUserId: string;
      requestSender: string;
    },
  ) => {
    const [newBot] = await tx
      .insert(botManages)
      .values({
        remoteUserId: query.remoteUserId,
        createdBy: query.requestSender,
      })
      .returning();

    return newBot;
  };

  export const deleteInTx = async (tx: Tx, query: { botId: string }) => {
    const botDeleted = await tx
      .delete(botManages)
      .where(eq(botManages.id, query.botId))
      .returning();

    return botDeleted[0] !== undefined ? botDeleted[0] : undefined;
  }
}
