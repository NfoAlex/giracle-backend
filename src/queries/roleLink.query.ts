import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "..";
import { roleInfos, roleLinks } from "../db/schema";

export namespace QueryRoleLink {
  //bun-sqliteの同期トランザクション。呼び出し側のdb.transactionから受け取る
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  //ユーザーのロール付与情報(ロールIdのみ)
  export const getLinksByUser = async (query: { userId: string }) => {
    return await db
      .select({ roleId: roleLinks.roleId })
      .from(roleLinks)
      .where(eq(roleLinks.userId, query.userId));
  };

  //ユーザーが指定ロール群のいずれかを持つか(可視判定用)
  export const getLinkByRoles = (query: {
    userId: string;
    roleIds: string[];
  }) => {
    return db.query.roleLinks.findFirst({
      where: and(
        eq(roleLinks.userId, query.userId),
        inArray(roleLinks.roleId, query.roleIds),
      ),
    });
  };

  //ユーザーがmanageServer権限を持つか(管理者判定用)
  export const getManageServerLink = (query: { userId: string }) => {
    return db
      .select({ userId: roleLinks.userId })
      .from(roleLinks)
      .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
      .where(
        and(
          eq(roleLinks.userId, query.userId),
          eq(roleInfos.manageServer, true),
        ),
      )
      .get();
  };

  //指定権限を持つロール付与情報(サーバー管理権限を含む。権限チェック用)
  export const getLinkByRoleTerm = (query: {
    userId: string;
    roleTerm: string;
  }) => {
    //roleTermはルート定義から渡される動的なカラム名のため
    const roleTermColumn = (roleInfos as unknown as Record<string, unknown>)[
      query.roleTerm
    ];

    return db
      .select({ userId: roleLinks.userId })
      .from(roleLinks)
      .innerJoin(roleInfos, eq(roleLinks.roleId, roleInfos.id))
      .where(
        and(
          eq(roleLinks.userId, query.userId),
          sql`(${roleTermColumn} = 1 OR ${roleInfos.manageServer} = 1)`,
        ),
      )
      .get();
  };

  //ユーザーにロールを付与
  export const insertLink = async (query: {
    userId: string;
    roleId: string;
  }) => {
    const [roleLinkInserted] = await db
      .insert(roleLinks)
      .values({
        userId: query.userId,
        roleId: query.roleId,
      })
      .returning()
      .catch((e) => {
        console.error(
          "roleLink.query :: QueryRoleLink.insertLink : db error",
          e,
        );
        throw new Error("Database error");
      });

    return roleLinkInserted;
  };

  //ユーザーからロールを剥奪(剥奪した行を返す)
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
        console.error(
          "roleLink.query :: QueryRoleLink.removeLink : db error",
          e,
        );
        throw new Error("Database error");
      });

    return roleUnlinked;
  };

  //トランザクション内でロールに紐づく付与情報を削除する
  export const removeByRoleInTx = (tx: Tx, query: { roleId: string }) => {
    tx.delete(roleLinks).where(eq(roleLinks.roleId, query.roleId)).run();
  };

  //トランザクション内でユーザーにロールを付与する
  export const insertLinkInTx = (
    tx: Tx,
    query: { userId: string; roleId: string },
  ) => {
    tx.insert(roleLinks)
      .values({ userId: query.userId, roleId: query.roleId })
      .run();
  };
}
