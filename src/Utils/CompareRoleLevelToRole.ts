import { eq } from "drizzle-orm";
import { db } from "..";
import { roleInfos } from "../db/schema";
import getUsersRoleLevel from "./getUsersRoleLevel";

// const levelIndex = {
//   manageServer: 5,
//   manageRole: 4,
//   manageUser: 3,
//   manageChannel: 2,
//   manageEmoji: 1,
// };

/**
 * 操作者と対象のロールレベルを比較する関数
 * @param _userId - 操作者のユーザーID
 * @param _roleId - 対象のロールID
 * @returns boolean - 操作者のロールレベルが、対象ロールより高いか等しい場合はtrueを返す
 */
export default async function CompareRoleLevelToRole(
  _userId: string,
  _roleId: string,
): Promise<boolean> {
  //HOSTロールに対する操作は許可しない
  if (_roleId === "HOST") return false;

  //対象のロール情報を取得
  const role = await db.query.roleInfos.findFirst({
    where: eq(roleInfos.id, _roleId),
  });
  //対象ロールが見つからなかったらfalseを返す
  if (role === undefined) return false;

  const userRoleLevel = await getUsersRoleLevel(_userId);

  //対象のロールのレベル用変数
  let targetRoleLevel = 0;
  //対象のロールのレベルを計算(高ければ格納)
  if (role.manageServer) {
    targetRoleLevel = 5;
  }
  if (role.manageRole && targetRoleLevel < 4) {
    targetRoleLevel = 4;
  }
  if (role.manageUser && targetRoleLevel < 3) {
    targetRoleLevel = 3;
  }
  if (role.manageChannel && targetRoleLevel < 2) {
    targetRoleLevel = 2;
  }
  if (role.manageEmoji && targetRoleLevel < 1) {
    targetRoleLevel = 1;
  }

  // console.log(
  //   "compareRoleLevelToRole :: userRoleLevel->",
  //   userRoleLevel,
  //   " targetRoleLevel->",
  //   targetRoleLevel,
  // );

  //送信者のロールレベルが高いか等しい場合はtrueを返す
  return userRoleLevel >= targetRoleLevel;
}
