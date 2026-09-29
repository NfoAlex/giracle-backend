import { and, eq } from "drizzle-orm";
import { status } from "elysia";
import { db } from "../";
import { type BotManage, botChannelPermissions, channels } from "../db/schema";

/**
 * Bot のチャンネル透過許可の有無を返す。
 * 権限が無い場合のエラー文言・status はルートごとに異なるため、throw は呼び出し側で行う。
 * ただしチャンネル自体が存在しない場合は文言が全ルート共通("Channel not found")なので
 * ここで 404 を投げる。全透過Botは許可テーブルを引かずに通過するため、存在確認を
 * しないと messages への INSERT が FK 違反で 500 になる。
 */
export namespace ExtUtil {
  export const isChannelPermitted = (
    channelId: string,
    bot: Pick<BotManage, "id" | "useAllChannel">,
  ) => {
    //全透過Botはチャンネル許可テーブルに行を持たないため無条件で許可
    if (bot.useAllChannel) {
      //存在しないチャンネルまで許可してしまうとFK違反で500になるため、ここで弾く
      const channelExists =
        db
          .select({ id: channels.id })
          .from(channels)
          .where(eq(channels.id, channelId))
          .get() !== undefined;
      if (!channelExists) throw status(404, "Channel not found");
      return true;
    }

    //非透過Botはチャンネル許可テーブルにFK(botChannelPermissions.channelId)があるため、
    //許可行があればチャンネルの存在は保証される(存在確認は不要)
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
