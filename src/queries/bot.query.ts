import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "..";
import { botManages, users } from "../db/schema";

export namespace QueryBot {
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  export const insertWithRemoteUserIdInTx = async (
    tx: Tx,
    query: {
      remoteUserId: string;
      requestSender: string;
    },
  ) => {
    const tokenCode = crypto.randomBytes(32).toString("hex");
    const [newBot] = await tx
      .insert(botManages)
      .values({
        remoteUserId: query.remoteUserId,
        createdBy: query.requestSender,
        tokenCode,
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
  };

  export const updateBotIsApproved = async (query: {
    botId: string;
    isApproved: boolean;
  }) => {
    const bot = await db
      .update(botManages)
      .set({ isApproved: query.isApproved })
      .where(eq(botManages.id, query.botId))
      .returning();

    return bot[0] !== undefined ? bot[0] : undefined;
  };

  export const getSingle = async (query: { botId: string }) => {
    const bot = await db
      .select()
      .from(botManages)
      .where(eq(botManages.id, query.botId));

    return bot;
  };

  export const getSingleWithRemoteUser = async (query: { botId: string }) => {
    const bot = await db
      .select({ bot: botManages, user: users })
      .from(botManages)
      .where(eq(botManages.id, query.botId))
      .leftJoin(users, eq(users.id, botManages.remoteUserId));

    return bot;
  };

  export const getBotMinimumByTokenCode = async (query: {
    tokenCode: string;
  }) => {
    const bot = await db
      .select({
        id: botManages.id,
        isApproved: botManages.isApproved,
        remoteUserId: botManages.remoteUserId,
        createdBy: botManages.createdBy,
      })
      .from(botManages)
      .where(eq(botManages.tokenCode, query.tokenCode));

    return bot[0] !== undefined ? bot[0] : undefined;
  };
}
