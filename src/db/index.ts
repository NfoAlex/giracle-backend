import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

// DATABASE_URL は "file:./dev.db" 形式なので bun:sqlite 用にプレフィックス除去
const dbPath = (process.env.DATABASE_URL || "file:./dev.db").replace(
  /^file:/,
  "",
);
const sqlite = new Database(dbPath, { create: true });
sqlite.run("PRAGMA foreign_keys = ON;"); // Cascade動作に必須
sqlite.run("PRAGMA journal_mode = WAL;"); // 読み書き並行性向上

export const db = drizzle(sqlite, { schema });
export { sqlite };
