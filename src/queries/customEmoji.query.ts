import { eq } from "drizzle-orm";
import { db } from "..";
import { customEmojis } from "../db/schema";

export namespace QueryCustomEmoji {
  //絵文字コード単位の取得(存在確認・画像配信用)
  export const getSingle = (query: { code: string }) => {
    return db.query.customEmojis.findFirst({
      where: eq(customEmojis.code, query.code),
    });
  };

  //登録済み絵文字一覧
  export const getList = async () => {
    return await db.query.customEmojis.findMany();
  };

  //絵文字を登録
  export const insertEmoji = async (query: {
    code: string;
    uploadedUserId: string;
  }) => {
    const [emojiUploaded] = await db
      .insert(customEmojis)
      .values({
        code: query.code,
        uploadedUserId: query.uploadedUserId,
      })
      .returning();

    return emojiUploaded;
  };

  //絵文字を削除(削除した行を返す)
  export const removeEmoji = async (query: { code: string }) => {
    const [emojiDeleted] = await db
      .delete(customEmojis)
      .where(eq(customEmojis.code, query.code))
      .returning();

    return emojiDeleted;
  };
}
