import { db, sqlite } from "./index";
import { roleInfos, serverConfigs, users } from "./schema";

async function main() {
  await db.insert(serverConfigs).values({
    name: "Giracle",
    introduction: "みんなで楽しめるチャットサーバー。",
  });

  await db.insert(users).values({
    id: "SYSTEM",
    name: "SYSTEM",
    selfIntroduction: "This is a system user.",
  });

  const [HOST] = await db
    .insert(roleInfos)
    .values({
      id: "HOST",
      name: "Host",
      manageServer: true,
      createdUserId: "SYSTEM",
    })
    .returning();

  const [MEMBER] = await db
    .insert(roleInfos)
    .values({
      id: "MEMBER",
      name: "Member",
      manageServer: false,
      createdUserId: "SYSTEM",
    })
    .returning();

  console.log("Created HOST role: ", HOST, MEMBER);
}

main()
  .then(() => {
    sqlite.close();
  })
  .catch((e) => {
    console.error(e);
    sqlite.close();
    process.exit(1);
  });
