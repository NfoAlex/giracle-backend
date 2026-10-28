/**
 * Prisma時代に作成済みのSQLiteに対してDrizzleを初回導入するためのスクリプト。
 * 既存テーブルはPrismaスキーマとDrizzleスキーマが一致している前提で、
 * drizzle/meta/_journal.json に記載済みのmigrationを「適用済み」として
 * __drizzle_migrations に記録するだけで、CREATE TABLE等は一切実行しない。
 *
 * 実行後は `bun db:migrate` が差分なしとして成功するようになる。
 *
 * ただし Prisma 時代のスキーマと一致するのは LEGACY_LAST_TAG まで。
 * それ以降は実DBに適用しないと列不足で壊れるため、適用済みとして記録せず db:migrate に任せる。
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dbPath = (process.env.DATABASE_URL || "file:./dev.db").replace(
  /^file:/,
  "",
);
const drizzleDir = join(import.meta.dir, "..", "..", "drizzle");

const sqlite = new Database(dbPath, { create: true });

sqlite.run(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash text NOT NULL,
    created_at numeric
  )
`);

const journal = JSON.parse(
  readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8"),
) as {
  entries: { tag: string; when: number }[];
};

const appliedHashes = new Set(
  sqlite
    .query("SELECT hash FROM __drizzle_migrations")
    .all()
    // biome-ignore lint/suspicious/noExplicitAny: accepts any line
    .map((row: any) => row.hash),
);

// Prisma 時代のスキーマと一致する最後のマイグレーション
const LEGACY_LAST_TAG = "0014_bumpy_baron_strucker";

const legacyEnd = journal.entries.findIndex((e) => e.tag === LEGACY_LAST_TAG);
if (legacyEnd < 0) {
  throw new Error(`journal に ${LEGACY_LAST_TAG} が見つかりません`);
}

for (const entry of journal.entries.slice(0, legacyEnd + 1)) {
  const sqlPath = join(drizzleDir, `${entry.tag}.sql`);
  const content = readFileSync(sqlPath, "utf8");
  const hash = createHash("sha256").update(content).digest("hex");

  if (appliedHashes.has(hash)) {
    console.log(`skip (already recorded): ${entry.tag}`);
    continue;
  }

  sqlite.run(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    [hash, entry.when],
  );
  console.log(`baselined: ${entry.tag}`);
}

sqlite.close();

console.log(
  `${LEGACY_LAST_TAG} 以降のマイグレーションは未適用。\`bun run db:migrate\` で適用すること`,
);
