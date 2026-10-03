import { eq, sql } from "drizzle-orm";
import { db } from "..";
import { roleInfos } from "../db/schema";
import { Util } from "../Util";

export namespace QueryRole {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  export const getList = async (opt?: { name: string }) => {
    const roles = await db
      .select()
      .from(roleInfos)
      .where(
        //ワイルドカード(%,_)を無効化してLIKE検索(監査#16)
        opt
          ? sql`${roleInfos.name} LIKE ${`%${Util.escapeLikePattern(opt.name)}%`} ESCAPE '\\'`
          : undefined,
      );

    return roles;
  };

  export const getSingle = (query: { roleId: string }) => {
    return db
      .select()
      .from(roleInfos)
      .where(eq(roleInfos.id, query.roleId))
      .get();
  };

  export const insertRole = async (query: {
    roleName: string;
    rolePower: {
      manageServer?: boolean;
      manageChannel?: boolean;
      manageRole?: boolean;
      manageUser?: boolean;
      manageEmoji?: boolean;
    };
    requestSender: string;
  }) => {
    const [newRole] = await db
      .insert(roleInfos)
      .values({
        name: query.roleName,
        createdUserId: query.requestSender,
        ...query.rolePower,
      })
      .returning()
      .catch((e) => {
        if (
          e instanceof Error &&
          e.message.includes("UNIQUE constraint failed")
        ) {
          console.error("role.query :: QueryRole.insertRole : ", e);
          throw new Error("Role name already exists");
        }
        console.error("role.query :: QueryRole.insertRole : ", e);
        throw new Error("Database error");
      });

    return newRole;
  };

  //呼び出し側のトランザクション内でロール本体を削除する
  export const removeInTx = (tx: Tx, query: { roleId: string }) => {
    tx.delete(roleInfos).where(eq(roleInfos.id, query.roleId)).run();
  };

  export const update = async (query: {
    roleId: string;
    roleData: {
      manageServer?: boolean;
      manageChannel?: boolean;
      manageUser?: boolean;
      manageRole?: boolean;
      manageEmoji?: boolean;
      name: string;
      color: string;
    };
  }) => {
    const [roleUpdated] = await db
      .update(roleInfos)
      .set({
        ...query.roleData,
      })
      .where(eq(roleInfos.id, query.roleId))
      .returning()
      .catch((e) => {
        console.error("role.query :: QueryRole.update :: db error", e);
        throw new Error("Database error");
      });

    return roleUpdated;
  };
}
