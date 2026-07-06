# メインプロンプト: Prisma → Drizzle 移行実施用

以下を移行実施時に AI へ渡すプロンプトとして使用する。

---

## プロンプト本文

あなたは giracle-backend（Bun + Elysia + SQLite/libsql）の ORM を Prisma v7 から Drizzle ORM へ完全移行します。

**作業前に必ず以下を読むこと:**

1. `PLAN_DRIZZLE/00_OVERVIEW.md` — 全体像と規模
2. `PLAN_DRIZZLE/01_SCHEMA_MAPPING.md` — スキーマ変換仕様（timestamp_ms、複合PK、cascade、命名維持）
3. `PLAN_DRIZZLE/02_QUERY_PATTERNS.md` — クエリ書き換え仕様（include→with、ネスト書き込みの分解、null/undefined 差異）
4. `PLAN_DRIZZLE/03_MIGRATION_SEED_TOOLING.md` — ツーリング・シード・検証チェックリスト
5. `prisma/schema.prisma` — 正の情報源（18モデル）
6. `AGENTS.md` / `README.md` — プロジェクト規約

### 絶対に守る制約

- **API のレスポンス形状を一切変えない。** リレーションのキー名（`MessageUrlPreview`, `ChannelJoin` 等の大文字始まり）を Drizzle の relations 定義でもそのまま使う。フロントエンドが依存している。
- **DateTime は Unix epoch ミリ秒。** Drizzle では `integer(..., { mode: "timestamp_ms" })`、デフォルトは `.$defaultFn(() => new Date())`。`CURRENT_TIMESTAMP` の DB デフォルトは使用禁止（文字列が入る）。
- **DB ドライバは Bun 組み込みの `bun:sqlite` + `drizzle-orm/bun-sqlite` を使う**（`@libsql/client` は使わない）。`new Database()` に渡すパスは `DATABASE_URL` から `file:` プレフィックスを除去する。
- **接続直後に `sqlite.run("PRAGMA foreign_keys = ON;")` を実行する。** これがないと onDelete: cascade が全て無効になる。
- **`drizzle-orm/bun-sqlite` は同期ドライバ。** Drizzle クエリは thenable なので既存の `await` は残してよい。`db.transaction()` のコールバックは同期で、内部に `await` を書かない。
- **`.notNull()` の付け忘れ禁止。** Prisma で `?` なしのフィールドは全て notNull。
- **select 絞り込みを維持。** password / salt / token がレスポンスに漏れないこと。
- **Prisma の `findUnique` は null、Drizzle の `findFirst` は undefined を返す。** 既存の `=== null` / `!== null` 判定と整合するよう各呼び出し箇所で調整する。
- **`update`/`delete` の対象0件時、Prisma は例外（P2025）、Drizzle は無言で成功する。** エラー応答（404 等）の挙動を変えないよう、必要箇所は事前取得 or `.returning()` の行数チェックに置き換える。
- **ネスト書き込み（Middlewares.ts の MessageUrlPreview createMany、channel.service.ts の ChannelViewableRole createMany）は個別クエリ＋トランザクションに分解する。**
- `db` は `src/db/index.ts` で生成し、`src/index.ts` から `export { db } from "./db"` で再 export して既存 import を壊さない。
- Utils は `Util` namespace 経由参照の規約を維持（AGENTS.md / README 参照）。
- コードスタイルは Biome 設定に従い、既存コードのコメント密度・命名に合わせる。

### 作業手順

1. **準備:** `bun add drizzle-orm`、`bun add -d drizzle-kit`（ドライバは `bun:sqlite` 組み込みのため追加不要）。この時点では Prisma を削除しない（並行して型参照を確認するため）。
2. **スキーマ:** `src/db/schema.ts` に全18テーブル + relations + 型 export（`Message`, `Channel`, insert 型）を作成。テーブル名・カラム名は schema.prisma と完全一致。`drizzle.config.ts` 作成。
3. **クライアント:** `src/db/index.ts` 作成（`new Database()` + PRAGMA + `drizzle(sqlite, { schema })`）。`src/index.ts` の Prisma 初期化を差し替え。
4. **シード:** `src/db/seeds.ts` を prisma/seeds.ts から移植（内容・順序同一）。
5. **DB 再作成:** `dev.db` をバックアップ後削除 → `bunx drizzle-kit push` → `bun ./src/db/seeds.ts`。
6. **書き換え:** ファイル単位で Prisma 呼び出しを Drizzle に変換。順序: Utils（依存が少ない）→ Middlewares.ts → 各 service → 各 module → ws.ts。1ファイル終わるごとに `bunx tsc --noEmit` 相当（bun の型チェック）で確認。
7. **クリーンアップ:** `bun remove @prisma/client @prisma/adapter-libsql prisma`、`prisma/` ディレクトリ削除、package.json の prisma.seed 削除、scripts に db:push / db:seed 追加。
8. **ドキュメント:** README.md（スタック表・セットアップ手順・ディレクトリ図）、AGENTS.md、.gitignore を更新。
9. **検証:** `PLAN_DRIZZLE/03_MIGRATION_SEED_TOOLING.md` の検証チェックリストを上から全て実施。`bun dev` で実際に sign-up → チャンネル作成 → メッセージ送信 → 削除の一連を curl 等で叩いて確認する。`bun build --compile` の成功も確認。

### 進め方の注意

- 一度に全ファイルを書き換えず、ステップ6は1ファイルずつコミット可能な単位で進める。
- 変換に迷う Prisma クエリが出たら、まず `PLAN_DRIZZLE/02_QUERY_PATTERNS.md` の該当パターンを確認する。載っていない場合は挙動（戻り値の型・null か undefined か・例外の有無）を Prisma ドキュメント基準で調べてから変換する。
- 挙動を「ついでに改善」しない。例外は 02 の §7-2（deleteMany + createMany の tx 化）のみ許可。

---

## プロンプト運用メモ

- 実施はコンテキストの大きいモデル + 長時間セッション推奨（触るファイル約20、変更行数は千行規模）。
- ステップ 2〜5（スキーマ確立）とステップ 6（書き換え）でセッションを分けても良い。その場合は各セッション冒頭で本プロンプトと PLAN_DRIZZLE 一式を再読させる。
