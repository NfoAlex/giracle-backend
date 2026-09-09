import { and, eq } from "drizzle-orm";
import { db } from "../";
import { botChannelPermissions } from "../db/schema";

/**
 * Bot のチャンネル透過許可の有無を返す。
 * エラー文言・status はルートごとに異なるため、throw は呼び出し側で行う。
 */
export namespace ExtUtil {
  export const isChannelPermitted = (channelId: string, botId: string) =>
    db
      .select({ id: botChannelPermissions.channelId })
      .from(botChannelPermissions)
      .where(
        and(
          eq(botChannelPermissions.channelId, channelId),
          eq(botChannelPermissions.botId, botId),
        ),
      )
      .get() !== undefined;
}
