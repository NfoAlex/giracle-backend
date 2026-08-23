// マイグレーション適用スクリプト。
// drizzle-kit migrate はエラー詳細を表示せず exit 1 するため、
// 代わりに drizzle-orm の migrator を直接叩いてエラーを出力する。
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./index";

try {
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrate :: migrate実行完了");
} catch (e) {
  console.error(
    "migrate :: migration 失敗 ",
    e instanceof Error ? e.message : e,
  );
  if (e instanceof Error && e.cause)
    console.error("migrater :: cause: ", e.cause);
  process.exit(1);
}
