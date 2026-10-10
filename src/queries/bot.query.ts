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
}
