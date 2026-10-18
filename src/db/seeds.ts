import { db, sqlite } from "./index";
import { roleInfos, serverConfigs, users } from "./schema";

// 起動毎に呼ばれる冪等シード。非冪等な処理を足さないこと
// (既存行は onConflictDoNothing で無視される前提)
export async function seedIt() {
  await db
    .insert(serverConfigs)
    .values({
      name: "Giracle",
      introduction: "みんなで楽しめるチャットサーバー。",
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: "SYSTEM",
      name: "SYSTEM",
      selfIntroduction: "This is a system user.",
    })
    .onConflictDoNothing();

  await db
    .insert(roleInfos)
    .values({
      id: "HOST",
      name: "Host",
      manageServer: true,
      createdUserId: "SYSTEM",
    })
    .onConflictDoNothing()
    .returning();

  await db
    .insert(roleInfos)
    .values({
      id: "MEMBER",
      name: "Member",
      manageServer: false,
      createdUserId: "SYSTEM",
    })
    .onConflictDoNothing()
    .returning();

  await db
    .insert(roleInfos)
    .values({
      id: "BOT",
      name: "Bot",
      manageServer: false,
      createdUserId: "SYSTEM",
      color: "#0000FF"
    })
    .onConflictDoNothing()
    .returning();

  console.log("seeds :: main : Seed完了");
}

// `bun run src/db/seeds.ts` の単発実行用。index.ts から import されたときは走らせない
if (import.meta.main) {
  seedIt()
    .then(() => {
      sqlite.close();
    })
    .catch((e) => {
      console.error(e);
      sqlite.close();
      process.exit(1);
    });
}
