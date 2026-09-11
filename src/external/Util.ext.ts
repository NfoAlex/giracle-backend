import { and, eq } from "drizzle-orm";
import { db } from "../";
import { type BotManage, botChannelPermissions } from "../db/schema";

/**
 * Bot のチャンネル透過許可の有無を返す。
 * エラー文言・status はルートごとに異なるため、throw は呼び出し側で行う。
 */
export namespace ExtUtil {
  export const isChannelPermitted = (
    channelId: string,
    bot: Pick<BotManage, "id" | "useAllChannel">,
  ) => {
    //全透過Botはチャンネル許可テーブルに行を持たないため無条件で許可
    if (bot.useAllChannel) return true;

    return (
      db
        .select({ id: botChannelPermissions.channelId })
        .from(botChannelPermissions)
        .where(
          and(
            eq(botChannelPermissions.channelId, channelId),
            eq(botChannelPermissions.botId, bot.id),
          ),
        )
        .get() !== undefined
    );
  };
}
