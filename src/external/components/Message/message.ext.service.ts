import { and, eq } from "drizzle-orm";
import { status } from "elysia";
import { db } from "../../../";
import { botChannelPermissions, messages } from "../../../db/schema";

export namespace ExtServiceMessage {
  export const GetMessage = async (messageId: string, botId: string) => {
    const messageData = await db.query.messages.findFirst({
      where: eq(messages.id, messageId),
      with: {
        MessageUrlPreview: true,
        MessageFileAttached: true,
      },
    });
    //メッセージが見つからなければエラー
    if (messageData === undefined) {
      throw status(404, "Message not found");
    }
    const isChannelPermitted = db
      .select({ id: botChannelPermissions.channelId })
      .from(botChannelPermissions)
      .where(
        and(
          eq(botChannelPermissions.channelId, messageData.channelId),
          eq(botChannelPermissions.botId, botId),
        ),
      )
      .get();
    if (isChannelPermitted === undefined) {
      throw status(404, "Message not found");
    }

    return messageData;
  };
}
