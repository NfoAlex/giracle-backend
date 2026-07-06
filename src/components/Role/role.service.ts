import { status } from "elysia";
import { db } from "../..";
import { Util } from "../../Util";

export namespace ServiceRole {
  export const Search = async (name: string) => {
    const roles = await db.roleInfo.findMany({
      where: {
        name: {
          contains: name,
        },
      },
    });

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

    const newRole = await db.roleInfo
      .create({
        data: {
          name: roleName,
          createdUserId: _userId,
          ...rolePower,
        },
      })
      .catch((e) => {
        if (e.code === "P2002") {
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

    const roleUpdated = await db.roleInfo
      .update({
        where: {
          id: roleId,
        },
        data: {
          createdUserId: _userId,
          ...roleData,
        },
      })
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
    const userWithRoleLink = await db.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        RoleLink: {
          where: {
            roleId,
          },
        },
      },
    });
    if (!userWithRoleLink) {
      throw status(404, "User not found");
    }
    if (userWithRoleLink.RoleLink.length > 0) {
      throw status(400, "Role already linked");
    }

    await db.roleLink
      .create({
        data: {
          userId, //指定のユーザーId
          roleId,
        },
      })
      .catch((e) => {
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
    const targetUserWithRole = await db.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        RoleLink: {
          where: {
            roleId,
          },
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

    await db.roleLink
      .deleteMany({
        where: {
          userId, //指定のユーザーId
          roleId,
        },
      })
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
    await db.roleLink.deleteMany({
      where: {
        roleId,
      },
    });
    //ロール情報を削除
    await db.roleInfo.delete({
      where: {
        id: roleId,
      },
    });

    return;
  };

  export const GetInfo = async (id: string) => {
    const role = await db.roleInfo.findUnique({
      where: {
        id,
      },
    });
    //ロールが存在しない
    if (!role) {
      throw status(404, "Role not found");
    }

    return role;
  };

  export const List = async () => {
    const roles = await db.roleInfo.findMany();
    return roles;
  };
}
