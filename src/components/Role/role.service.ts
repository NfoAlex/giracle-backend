import { and, eq, like } from "drizzle-orm";
import { status } from "elysia";
import { db } from "../..";
import { roleInfos, roleLinks, users } from "../../db/schema";
import { Util } from "../../Util";

export namespace ServiceRole {
  export const Search = async (name: string) => {
    const roles = await db
      .select()
      .from(roleInfos)
      .where(like(roleInfos.name, `%${name}%`));

    return roles;
  };

  export const Create = async (
    roleName: string,
    rolePower: {
      manageServer?: boolean;
      manageChannel?: boolean;
      manageRole?: boolean;
      manageUser?: boolean;
      manageEmoji?: boolean;
    },
    _userId: string,
  ) => {
    //ロールレベルの計算
    const levelFromThis = Util.calculateRoleLevel(rolePower);
    const userRoleLevel = await Util.getUsersRoleLevel(_userId);
    if (userRoleLevel <= levelFromThis) {
      throw status(400, "Role power is too powerful");
    }

    const [newRole] = await db
      .insert(roleInfos)
      .values({
        name: roleName,
        createdUserId: _userId,
        ...rolePower,
      })
      .returning()
      .catch((e) => {
        if (
          e instanceof Error &&
          e.message.includes("UNIQUE constraint failed")
        ) {
          throw status(400, "Role name already exists");
        }
        throw status(500, "Database error");
      });

    return newRole;
  };

  export const Update = async (
    roleId: string,
    roleData: {
      manageServer?: boolean;
      manageChannel?: boolean;
      manageUser?: boolean;
      manageRole?: boolean;
      manageEmoji?: boolean;
      name: string;
      color: string;
    },
    _userId: string,
  ) => {
    if (roleId === "HOST") throw status(400, "You cannot update HOST role");
    //事前にロールの存在と送信者のロールレベルが足りるか確認
    if ((await Util.compareRoleLevelToRole(_userId, roleId)) === false) {
      throw status(400, "Role level not enough or role not found");
    }
    //更新予定のロールレベルが送信者のロールレベルを超えていないか確認
    const roleLevelIfUpdated = Util.calculateRoleLevel(roleData);
    const userRoleLevel = await Util.getUsersRoleLevel(_userId);
    if (userRoleLevel < roleLevelIfUpdated) {
      throw status(400, "Role power is too powerful");
    }

    const [roleUpdated] = await db
      .update(roleInfos)
      .set({
        createdUserId: _userId,
        ...roleData,
      })
      .where(eq(roleInfos.id, roleId))
      .returning()
      .catch((e) => {
        console.error("role.service :: Update :: db error", e);
        throw status(500, "Database error");
      });

    return roleUpdated;
  };

  export const Link = async (
    userId: string,
    roleId: string,
    _userId: string,
  ) => {
    //デフォルトのロールはリンク不可
    if (roleId === "MEMBER" || roleId === "HOST") {
      throw status(400, "You cannot link default role");
    }

    //送信者のロールレベルが足りるか確認
    if (!(await Util.compareRoleLevelToRole(_userId, roleId))) {
      throw status(400, "Role level not enough or role not found");
    }

    //ユーザー存在とロールリンクの確認
    const userWithRoleLink = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        RoleLink: {
          where: eq(roleLinks.roleId, roleId),
        },
      },
    });
    if (!userWithRoleLink) {
      throw status(404, "User not found");
    }
    if (userWithRoleLink.RoleLink.length > 0) {
      throw status(400, "Role already linked");
    }

    await db
      .insert(roleLinks)
      .values({
        userId, //指定のユーザーId
        roleId,
      })
      .catch((e) => {
        console.error("role.service :: Link(db ロール付与処理) : ", { e });
        throw status(500, "Database error");
      });

    return;
  };

  export const Unlink = async (
    userId: string,
    roleId: string,
    _userId: string,
  ) => {
    //デフォルトのロールはリンク取り消し不可
    if (roleId === "MEMBER" || roleId === "HOST") {
      throw status(400, "You cannot unlink default role");
    }

    //ユーザー存在とロールリンクの確認
    const targetUserWithRole = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        RoleLink: {
          where: eq(roleLinks.roleId, roleId),
        },
      },
    });
    if (!targetUserWithRole) {
      throw status(404, "User not found");
    }
    if (targetUserWithRole.RoleLink.length === 0) {
      throw status(400, "Role not linked to user");
    }

    //送信者のロールレベルが足りるか確認
    if (!(await Util.compareRoleLevelToRole(_userId, roleId))) {
      throw status(400, "Role level not enough or role not found");
    }

    await db
      .delete(roleLinks)
      .where(and(eq(roleLinks.userId, userId), eq(roleLinks.roleId, roleId)))
      .catch((e) => {
        console.error("role.service :: Unlink :: db error", e);
        throw status(500, "Database error");
      });

    return;
  };

  export const Delete = async (roleId: string, _userId: string) => {
    //送信者のロールレベルが足りるか確認
    if (!(await Util.compareRoleLevelToRole(_userId, roleId))) {
      throw status(400, "Role level not enough or role not found");
    }

    //ユーザーのロール付与情報を全削除
    await db.delete(roleLinks).where(eq(roleLinks.roleId, roleId));
    //ロール情報を削除
    await db.delete(roleInfos).where(eq(roleInfos.id, roleId));

    return;
  };

  export const GetInfo = async (id: string) => {
    const role = await db.query.roleInfos.findFirst({
      where: eq(roleInfos.id, id),
    });
    //ロールが存在しない
    if (!role) {
      throw status(404, "Role not found");
    }

    return role;
  };

  export const List = async () => {
    const roles = await db.query.roleInfos.findMany();
    return roles;
  };
}
