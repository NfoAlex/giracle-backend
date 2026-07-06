# ツーリング・マイグレーション・シード・ドキュメント更新

## パッケージ変更

```bash
bun add drizzle-orm
bun add -d drizzle-kit
bun remove @prisma/client @prisma/adapter-libsql prisma
```

DB ドライバは Bun 組み込みの `bun:sqlite` を使用（追加パッケージ不要）。Drizzle 側アダプターは `drizzle-orm/bun-sqlite`。

`package.json` の `"prisma": { "seed": ... }` セクションを削除し、scripts に追加:

```json
"db:push": "drizzle-kit push",
"db:seed": "bun ./src/db/seeds.ts"
```

## ディレクトリ構成（案）

```
src/db/
├── index.ts      # createClient + drizzle() インスタンス（export const db）
├── schema.ts     # 全テーブル + relations + 型 export
└── seeds.ts      # シード（prisma/seeds.ts の移植）
drizzle.config.ts # drizzle-kit 設定
```

移行完了後に `prisma/` ディレクトリ（schema.prisma, migrations/, generated/, seeds.ts）を削除。

## drizzle.config.ts

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL || "file:./dev.db" },
});
```

- **`bun:sqlite` 採用によりリモート libsql (`libsql://`) 接続は不可になる。** 現運用はローカルファイルのみなので問題ないが、README の `DATABASE_URL` 説明を「ローカル SQLite ファイルパス」に改めること。
- **パス形式の差（落とし穴）:** drizzle-kit は `file:./dev.db` 形式を受けるが、`bun:sqlite` の `new Database()` は**素のファイルパス**（`./dev.db`）を取る。`DATABASE_URL` の値をそのまま両方に渡すとランタイム側で `file:` プレフィックスの除去が必要。`src/db/index.ts` で `url.replace(/^file:/, "")` のような正規化を1箇所で行う。
- 既存 dev.db の場所はリポジトリルート直下。drizzle-kit の相対パス基準は CWD で一致する。

## クライアント初期化（src/db/index.ts）

```ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

// DATABASE_URL は "file:./dev.db" 形式なので bun:sqlite 用にプレフィックス除去
const dbPath = (process.env.DATABASE_URL || "file:./dev.db").replace(/^file:/, "");
const sqlite = new Database(dbPath, { create: true });
sqlite.run("PRAGMA foreign_keys = ON;"); // Cascade 動作に必須
sqlite.run("PRAGMA journal_mode = WAL;"); // 推奨（読み書き並行性向上）
export const db = drizzle(sqlite, { schema });
export { sqlite }; // seeds 等で close() する用
```

- 既存コードは `import { db } from "../index"`（src/index.ts から）。**互換のため `src/index.ts` で `export { db } from "./db"` を再 export すると呼び出し側の import 変更が不要**（もしくは全ファイルの import を `src/db` に付け替え。どちらかに統一）。
- relational query (`db.query.*`) には `{ schema }` の受け渡しが必須。忘れると `db.query` が空になる。

## 既存データベースとの互換

開発 DB（dev.db）は**再作成を推奨**:

1. `dev.db` を削除（またはリネームでバックアップ）
2. `bunx drizzle-kit push`
3. `bun ./src/db/seeds.ts`

理由:
- Prisma と drizzle-kit で index / FK の内部名が異なり push が差分を出す
- 旧 seeds.ts が `timestampFormat` 未指定インスタンスで日時を投入しており形式混在の可能性

本番データを引き継ぐ場合のみ、`sqlite3 dev.db .schema` で既存 DDL を取得し、Drizzle スキーマから `drizzle-kit push --dry-run`（or `generate`）した DDL と突き合わせて名前・型を合わせる作業が必要。

## シード移植（src/db/seeds.ts）

prisma/seeds.ts と同一内容を Drizzle で:

1. `ServerConfig`: name "Giracle", introduction "みんなで楽しめるチャットサーバー。"
2. `User`: id "SYSTEM", name "SYSTEM", selfIntroduction "This is a system user."
3. `RoleInfo`: id "HOST", name "Host", manageServer: true, createdUserId "SYSTEM"
4. `RoleInfo`: id "MEMBER", name "Member", manageServer: false, createdUserId "SYSTEM"

順序維持（FK 依存: RoleInfo.createdUserId → User）。終了時 `sqlite.close()`。

## ドキュメント・設定の更新箇所

| ファイル | 変更 |
|----------|------|
| README.md | 技術スタック表（ORM 行）、初回セットアップコマンド（`bunx prisma db push` → `bunx drizzle-kit push`、seeds パス）、ディレクトリ構成図（prisma/ → src/db/） |
| AGENTS.md | Prisma 前提の記述があれば Drizzle に更新（要確認） |
| .gitignore | `prisma/generated` 等の記述を整理、`drizzle/`（generate 使用時のマイグレーション出力）の扱いを決定 |
| biome 設定 | `prisma/generated` の除外設定があれば削除 |

## ビルドへの影響

`bun build --compile` でのバイナリ化スクリプトあり（build-win / build-linux）。`bun:sqlite` は Bun 組み込みのため **`--compile` と完全互換**で、Prisma の生成クライアント同梱問題も消える（この構成が bun-sqlite 採用の主な利点）。
一方、**build-node-js スクリプト（`--target=node`）は `bun:sqlite` が Node で動かないため使用不能になる。** Node ターゲットを残す必要があるか確認し、不要なら scripts から削除、必要なら `better-sqlite3` 分岐等の別対応が要る。

## 検証チェックリスト

- [ ] `bun dev` 起動、seeds 後に sign-up → 初回ユーザーが HOST になる
- [ ] メッセージ送信 / 編集 / 削除 + WS 通知のペイロード形状が移行前と一致（リレーションキー名 `MessageUrlPreview` 等）
- [ ] チャンネル削除で Message / ChannelJoin / Reaction 等が cascade で消える（PRAGMA foreign_keys 検証）
- [ ] `/channel/get-history` のページネーション（createdAt 比較 = timestamp_ms が正しく Date で返る）
- [ ] `/message/get-new` の groupBy 集約
- [ ] user 系レスポンスに password / salt / token が含まれない
- [ ] 存在しない ID への update/delete が移行前と同じエラー応答（404 等）を返す
- [ ] URL プレビュー生成（Middlewares の UrlPreviewControl）と WS `message::UpdateMessage`
- [ ] レート制限の BlockedIPAddress upsert
- [ ] `bun build --compile` が通り、バイナリが起動する
