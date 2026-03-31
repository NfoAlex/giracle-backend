import { db } from "..";

/**
 * メッセージのリアクション総数を自分のがあるかを調べつつ計算する
 * @param messageId 調べるメッセージのId
 * @param myUserId 自分がリアクションしているかどうかを調べるためのユーザーId
 * @constructor
 */
export default async function CalculateReactionTotal(
  messageId: string,
  myUserId: string,
): Promise<
  {
    emojiCode: string;
    count: number;
    includingYou: boolean;
  }[]
> {
  //全リアクションを取得し、集計・自分判定
  const allReactions = await db.messageReaction.findMany({
    where: {
      messageId: messageId,
    },
    orderBy: {
      reactedAt: "asc",
    },
  });

  //emojiCodeごとにカウントと自分のリアクション有無をまとめる
  const emojiMap = new Map<string, { count: number; includingYou: boolean }>();

  for (const reaction of allReactions) {
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

  const emojiTotalJson = Array.from(emojiMap.entries()).map(([emojiCode, data]) => ({
    emojiCode,
    ...data,
  }));

  return emojiTotalJson;
}
