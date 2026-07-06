import { eq } from "drizzle-orm";
import { db } from "..";
import { users } from "../db/schema";

/**
 * ユーザーのロールレベルを取得する関数
 * @param _userId
 */
export default async function getUsersRoleLevel(
  _userId: string,
): Promise<number> {
  //ユーザー情報を付与されたロールと同時に取得
  const userWithRoles = await db.query.users.findFirst({
    where: eq(users.id, _userId),
    with: {
      RoleLink: {
        with: {
          role: true,
        },
      },
    },
  });
  //ユーザーが存在しない場合はfalseを返す
  if (userWithRoles === undefined) return 0;

  //送信者のロールレベル用変数
  let userRoleLevel = 0;
  //送信者のロール分ループしてレベルを計算(高ければ格納)
  for (const roleData of userWithRoles.RoleLink) {
    if (roleData.role.manageServer) {
      //管理者権限を持つユーザーなら問答無用でtrueを返す
      userRoleLevel = 5;
      break;
    }

    if (roleData.role.manageRole && userRoleLevel < 4) {
      userRoleLevel = 4;
      continue;
    }
    if (roleData.role.manageUser && userRoleLevel < 3) {
      userRoleLevel = 3;
      continue;
    }
    if (roleData.role.manageChannel && userRoleLevel < 2) {
      userRoleLevel = 2;
    }
    if (roleData.role.manageEmoji && userRoleLevel < 1) {
      userRoleLevel = 1;
    }
  }

  return userRoleLevel;
}
