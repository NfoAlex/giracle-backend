import { and, eq, sql } from "drizzle-orm";
import { db } from "..";
import { roleInfos, roleLinks } from "../db/schema";
import { Util } from "../Util";

export namespace QueryRole {
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

  export const removeRole = async (query: { roleId: string }) => {
    //ロール付与情報→ロール本体の順に削除(FKがrestrictのため)。bun-sqlite は同期トランザクションなのでコールバックに await を入れない
    db.transaction((tx) => {
      tx.delete(roleLinks).where(eq(roleLinks.roleId, query.roleId)).run();
      tx.delete(roleInfos).where(eq(roleInfos.id, query.roleId)).run();
    });
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

  export const insertLink = async (query: {
    userId: string;
    roleId: string;
  }) => {
    const [roleLinkInserted] = await db
      .insert(roleLinks)
      .values({
        userId: query.userId, //指定のユーザーId
        roleId: query.roleId,
      })
      .returning()
      .catch((e) => {
        console.error("role.query :: QueryRole.insertLink : db error", e);
        throw new Error("Database error");
      });

    return roleLinkInserted;
  };

  export const removeLink = async (query: {
    userId: string;
    roleId: string;
  }) => {
    const [roleUnlinked] = await db
      .delete(roleLinks)
      .where(
        and(
          eq(roleLinks.userId, query.userId),
          eq(roleLinks.roleId, query.roleId),
        ),
      )
      .returning()
      .catch((e) => {
        console.error("role.query :: QueryRole.remoteUnlink : db error", e);
        throw new Error("Database error");
      });

    return roleUnlinked;
  };
}
