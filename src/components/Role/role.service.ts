import { status } from "elysia";
import { QueryRole } from "../../queries/role.query";
import { QueryRoleLink } from "../../queries/roleLink.query";
import { QueryUser } from "../../queries/user.query";
import { Util } from "../../Util";

export namespace ServiceRole {
  export const Search = async (name: string) => {
    const roles = await QueryRole.getList({ name });

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

    const newRole = await QueryRole.insertRole({
      roleName,
      rolePower,
      requestSender: _userId,
    }).catch((e) => {
      const E = e as Error;
      if (E.message === "Role name already exists") {
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

    const roleUpdated = await QueryRole.update({
      roleId,
      roleData,
    }).catch(() => {
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
    const userWithRoleLink = await QueryUser.getSingleWithRoleLink({
      userId,
      roleId,
    });
    if (!userWithRoleLink) {
      throw status(404, "User not found");
    }
    if (userWithRoleLink.RoleLink.length > 0) {
      throw status(400, "Role already linked");
    }

    await QueryRoleLink.insertLink({
      userId,
      roleId,
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
    const targetUserWithRole = await QueryUser.getSingleWithRoleLink({
      userId,
      roleId,
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

    await QueryRoleLink.removeLink({
      userId,
      roleId,
    }).catch(() => {
      throw status(500, "Database error");
    });

    return;
  };

  export const Delete = async (roleId: string, _userId: string) => {
    //送信者のロールレベルが足りるか確認
    if (!(await Util.compareRoleLevelToRole(_userId, roleId))) {
      throw status(400, "Role level not enough or role not found");
    }

    await QueryRole.removeRole({ roleId });

    return;
  };

  export const GetInfo = async (id: string) => {
    const role = QueryRole.getSingle({ roleId: id });
    //ロールが存在しない
    if (!role) {
      throw status(404, "Role not found");
    }

    return role;
  };

  export const List = async () => {
    const roles = await QueryRole.getList();
    return roles;
  };
}
