import { inArray } from "drizzle-orm";
import { db } from "..";
import { messageReactions } from "../db/schema";

export type ReactionSummary = {
  emojiCode: string;
  count: number;
  includingYou: boolean;
}[];

/**
 * 複数メッセージのリアクション総数を1クエリでまとめて集計する
 * @param messageIds 調べるメッセージのId配列
 * @param myUserId 自分がリアクションしているかどうかを調べるためのユーザーId
 * @returns messageIdをキーにした集計結果Map（リアクションが無いメッセージはキー自体なし）
 */
export async function CalculateReactionTotalBulk(
  messageIds: string[],
  myUserId: string,
): Promise<Map<string, ReactionSummary>> {
  const result = new Map<string, ReactionSummary>();
  if (messageIds.length === 0) return result;

  //対象メッセージの全リアクションを一括取得
  const allReactions = await db.query.messageReactions.findMany({
    where: inArray(messageReactions.messageId, messageIds),
    orderBy: (t, { asc }) => asc(t.reactedAt),
  });

  //messageIdごと、emojiCodeごとにカウントと自分のリアクション有無をまとめる
  const emojiMaps = new Map<
    string,
    Map<string, { count: number; includingYou: boolean }>
  >();
  for (const reaction of allReactions) {
    //型上はnull許容だが、inArrayで一致した行は必ず対象のmessageIdを持つ
    if (reaction.messageId === null) continue;
    let emojiMap = emojiMaps.get(reaction.messageId);
    if (emojiMap === undefined) {
      emojiMap = new Map();
      emojiMaps.set(reaction.messageId, emojiMap);
    }
    const existing = emojiMap.get(reaction.emojiCode);
    if (existing) {
      existing.count++;
      if (reaction.userId === myUserId) existing.includingYou = true;
    } else {
      emojiMap.set(reaction.emojiCode, {
        count: 1,
        includingYou: reaction.userId === myUserId,
      });
    }
  }

  for (const [messageId, emojiMap] of emojiMaps) {
    result.set(
      messageId,
      Array.from(emojiMap.entries()).map(([emojiCode, data]) => ({
        emojiCode,
        ...data,
      })),
    );
  }

  return result;
}

/**
 * メッセージのリアクション総数を自分のがあるかを調べつつ計算する
 * @param messageId 調べるメッセージのId
 * @param myUserId 自分がリアクションしているかどうかを調べるためのユーザーId
 * @constructor
 */
export default async function CalculateReactionTotal(
  messageId: string,
  myUserId: string,
): Promise<ReactionSummary> {
  const summaries = await CalculateReactionTotalBulk([messageId], myUserId);
  return summaries.get(messageId) ?? [];
}
