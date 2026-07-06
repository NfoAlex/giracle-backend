# Prisma → Drizzle 移行計画: 概要

## 目的

giracle-backend の ORM を Prisma v7 (adapter: `@prisma/adapter-libsql`) から Drizzle ORM に置き換える。
ランタイム (Bun) / フレームワーク (Elysia) / DB (SQLite / libsql) は変更しない。

## 現状の構成

| 項目 | 現在 | 移行後 |
|------|------|--------|
| ORM | Prisma v7 (`@prisma/client` + `prisma`) | Drizzle ORM (`drizzle-orm`) |
| DBドライバ | `@prisma/adapter-libsql` | `bun:sqlite`（Bun 組み込み）+ `drizzle-orm/bun-sqlite` |
| スキーマ定義 | `prisma/schema.prisma` (18モデル) | `src/db/schema.ts` (TypeScript) |
| マイグレーション | `bunx prisma db push` + `prisma/migrations/` | `drizzle-kit push` または `drizzle-kit generate/migrate` |
| 生成クライアント | `prisma/generated/` | 不要（Drizzle は生成物なし、型は `$inferSelect`） |
| シード | `bun ./prisma/seeds.ts` | `bun ./src/db/seeds.ts`（書き換え） |

## クライアント初期化の現状（重要）

[src/index.ts:24-28](../src/index.ts#L24-L28):

```ts
const adapter = new PrismaLibSql(
  { url: process.env.DATABASE_URL || "file:./dev.db" },
  { timestampFormat: "unixepoch-ms" },   // ← DateTime は Unix epoch ミリ秒の整数で保存
);
export const db = new PrismaClient({ adapter });
```

- `db` は `src/index.ts` から export され、全 service / Utils / Middlewares が `import { db } from "../index"` 形式で参照。この export 名とパスを維持すれば呼び出し側の import 変更は最小化できる（ただしクエリ本体は全書き換え）。
- `prisma/seeds.ts` は**別インスタンス**を生成しており、こちらは `timestampFormat` 指定なし（デフォルト）。移行時に統一すること。

## Prisma 利用箇所の規模

`db.<model>.<operation>` の呼び出し: **約150箇所 / 17ファイル**

| ファイル | 呼び出し数（概算） |
|----------|------|
| src/components/Channel/channel.service.ts | 36 |
| src/components/Message/message.service.ts | 34 |
| src/components/User/user.service.ts | 24 |
| src/components/Server/server.service.ts | 15 |
| src/Middlewares.ts | 8 |
| src/components/Notification/notification.service.ts | 8 |
| src/components/Role/role.service.ts | 7 |
| src/Utils/*（8ファイル） | 各1〜4 |
| src/ws.ts, src/components/*/\*.module.ts | 各2〜3 |

型 import（`prisma/generated/client` からの `Message`, `Channel` 等）:
- `src/Middlewares.ts`（`Message` 型 + `MessageUrlPreviewCreateManyMessageInput`）
- `src/components/Channel/channel.service.ts`, `src/components/Message/message.service.ts`（`Message` 型）
- `src/Utils/GetUserViewableChannel.ts`（`Channel` 型）

## ドキュメント構成

| ファイル | 内容 |
|----------|------|
| [01_SCHEMA_MAPPING.md](01_SCHEMA_MAPPING.md) | schema.prisma → Drizzle スキーマ変換の仕様と注意点 |
| [02_QUERY_PATTERNS.md](02_QUERY_PATTERNS.md) | 本プロジェクトで実際に使われている Prisma クエリパターンと Drizzle 対応 |
| [03_MIGRATION_SEED_TOOLING.md](03_MIGRATION_SEED_TOOLING.md) | drizzle-kit 設定、既存 DB との互換、シード、ドキュメント更新 |
| [AI_PROMPT.md](AI_PROMPT.md) | 移行実施用のメイン AI プロンプト |
