# AGENTS.md — 開発エージェント向けガイド

Giracle（セルフホスト型チャットサービス）のバックエンド。プロジェクト概要・エンドポイント一覧・WS シグナル一覧・環境変数は [README.md](README.md) を参照。このファイルは **コードを書く際に必要なコンテキスト**（アーキテクチャの約束事・落とし穴）をまとめる。

## コマンド

```bash
bun i                      # 依存インストール（Bun 必須。npm/yarn は使わない）
bun run db:generate        # schema.ts 変更時にマイグレーションSQLを drizzle/ へ生成
bun run db:migrate         # マイグレーションを DB へ適用（初回セットアップ必須）
bun run db:seed            # シード投入（ServerConfig と HOST/MEMBER ロール。初回必須）
bun dev                    # 開発サーバー起動（--watch 付き、ポート 3000 固定）
NODE_ENV=test bun test     # テスト実行（後述。dev.db ではなく test.db を使う）
bunx biome check --write . # リント＋フォーマット（CI 相当のチェック）
```

- `db:*` は package.json の scripts（中身は `drizzle-kit generate` / `drizzle-kit migrate` / `bun ./src/db/seeds.ts`）。`bun run db:baseline` は Prisma 時代の既存 DB に Drizzle を後付けする初回専用スクリプト（[src/db/baseline.ts](src/db/baseline.ts)）で、新規環境では使わない。
- `npm test` に相当する package.json の `test` スクリプトは未設定（`exit 1` を返すダミー）。テストは必ず `bun test` を直接叩く。
- Swagger 定義は各ルートの `detail`（tags / description）から生成される。

### テスト

[test/](test/) に `bun:test` ベースの結合テストがある。`src/index.ts` の `app` を直接 `app.handle()` する形式で、HTTP サーバーは立てない。

- **必ず `NODE_ENV=test` を付けて実行する。** Bun が `.env.test` を読み込み `DATABASE_URL` が `file:./test.db` に切り替わる。付け忘れると開発用の `dev.db` が全削除される。
- [test/util.ts](test/util.ts) の `INIT()` が全テスト共通の前処理（migrate → 全テーブル削除 → seeds 投入 → `TESTUSER` / `TESTUSER2` とトークン作成）。各テストファイルの `beforeAll` で呼ぶ。多重呼び出しはフラグで抑止される。
- リクエストは `FETCH({ path, method, body })` ヘルパー経由（内部で `app.handle(new Request(...))`）。デフォルトで `TESTUSER` の Cookie が付く。`useSecondaryUser: true` で `TESTUSER2`、`excludeCredential: true` で未認証リクエストになる。
- `NODE_ENV=test` のとき index.ts の `.onError()` はエラーログを抑制する。
- 機能を追加したら対応するテストファイルに追記する。

## アーキテクチャの約束事

### db クライアントは src/index.ts からの import 一択

`db` インスタンスは [src/db/index.ts](src/db/index.ts) で `bun:sqlite` + `drizzle-orm/bun-sqlite` を使い生成され、[src/index.ts](src/index.ts) から re-export される。各 module / service / Utils は `import { db } from "../.."` のように **index.ts から相対 import** する（循環 import に見えるが意図された構成）。新しいインスタンスを作らないこと。

- 接続直後に `PRAGMA foreign_keys = ON;`（onDelete: cascade の動作に必須）と `PRAGMA journal_mode = WAL;` を実行している。
- DB のパスは環境変数 `DATABASE_URL`（`file:` プレフィックスは除去される。既定は `./dev.db`）。
- テーブル定義・relations・型 export は [src/db/schema.ts](src/db/schema.ts) にまとめてある。relational query (`db.query.<table>.findFirst/findMany`) を使うため `drizzle(sqlite, { schema })` で初期化されている。
- `db.query.*.findFirst` は該当なしで `undefined` を返す（Prisma の `null` とは異なるので `!== undefined` で判定する）。`update`/`delete` は対象0件でも例外を投げない（事前 `findFirst` か `.returning()` の行数で判定する）。

### モジュール構成: module（ルーティング）+ service（ロジック）

機能追加は `src/components/<Name>/` に以下のペアで作り、[src/index.ts](src/index.ts) の `app` に `.use()` で登録する。

- **`<name>.module.ts`** — `new Elysia({ prefix: "/<name>" })`。ルート定義・`t.Object` によるバリデーション・`response` スキーマ（成功/エラーの status ごとに定義。エラーは `t.Literal("...")` で文言まで固定）・Swagger 用 `detail` を持つ。レスポンス形式は `{ message: string, data?: ... }` が慣習。
- **`<name>.service.ts`** — `export namespace Service<Name> { ... }` にビジネスロジックを置く。エラーは Elysia の `throw status(4xx, "メッセージ")` で投げる。**service で投げる status とメッセージは module 側の `response` スキーマと一致させる**（ずれるとバリデーションエラーになる）。

グローバルエラーハンドラは index.ts の `.onError()`。`NODE_ENV=test` のときはエラーログを抑制する分岐がある。

### 認証・権限

- 認証必須ルート: module の先頭で `.use(Middleware.CheckToken)`。ハンドラでは `CheckToken: { _userId }` がコンテキストに注入される。トークンは 5 分キャッシュされる（[src/Middlewares.ts](src/Middlewares.ts)）ため、BAN 反映等に最大 5 分の遅延があり得る。
- 権限チェック: `.use(Middleware.CheckRoleTerm)` を併用し、ルートオプションに `checkRoleTerm: "manageChannel"` のように指定する（macro 実装）。権限は `manageServer` / `manageChannel` / `manageRole` / `manageUser` / `manageEmoji` の 5 種。`manageServer` は全チェックを通過する。
- **管理系ルートに `checkRoleTerm` を付け忘れると「ログイン済みなら誰でも実行可」になる。** 追加時は必ず確認。

### WebSocket 通知

リアルタイム通知は Bun の pub/sub を使う。ハンドラのコンテキストにある `server` から publish する:

```ts
server?.publish(
  `channel::${channelId}`, // "GLOBAL" | `user::${userId}` | `channel::${channelId}`
  JSON.stringify({ signal: "message::SendMessage", data: ... }),
);
```

- signal 名は `対象::イベント名`（PascalCase）。新規 signal を追加したら README の一覧に追記する。
- ユーザーの購読チャンネルを増減させるときは [src/ws.ts](src/ws.ts) の `WSSubscribe(userId, wsChannel)` / `WSUnsubscribe(userId, wsChannel)` を使う。`userWSInstance`（Map<userId, ws[]>）が複数端末の同時接続を管理している。
- URL プレビューはミドルウェア `UrlPreviewControl` が担当。メッセージ送信/編集ルートにルートオプション `bindUrlPreview: true` を付けると `afterResponse` で OGP 取得 → DB 保存 → `message::UpdateMessage` を publish する。

### 通知（Inbox / Web Push）

- メンション・リプライ時の通知は DB の `Inbox` + WS `inbox::Added` + Web Push（[src/Utils/SendPushNotification.ts](src/Utils/SendPushNotification.ts)）の 3 経路。
- Web Push は VAPID 鍵（環境変数）未設定でも起動する設計。送信前に `isWebPushReady()` で判定する。
- `/notification` モジュール（デバイス登録・通知設定・チャンネルミュート）のエンドポイントは README の一覧に記載済み。リクエスト/レスポンスの詳細は [notification.module.ts](src/components/Notification/notification.module.ts) を読む。

### Utils

横断的な処理は `src/Utils/` に 1 ファイル 1 機能（default export。補助関数のみ named export を併用する場合がある）で置く。

- チャンネルへのアクセス制御を伴う処理では `CheckChannelVisibility` / `GetUserViewableChannel` の再利用を優先する。

呼び出し側は個々のファイルを直接 import せず、[src/Util.ts](src/Util.ts) が re-export する `Util` namespace 経由で参照する（`import { Util } from "../../Util"` → `Util.sendSystemMessage(...)` のように使う）。プロパティ名は camelCase（例: `CheckChannelVisibility` → `Util.checkChannelVisibility`）。**新しい Utils ファイルを追加したら `src/Util.ts` に import + namespace export を追記すること。**

## DB（Drizzle / bun:sqlite）

- スキーマは [src/db/schema.ts](src/db/schema.ts)。
- スキーマ変更フロー: `src/db/schema.ts` 編集 → `bun run db:generate`（[drizzle/](drizzle/) にマイグレーションSQL生成）→ `bun run db:migrate`（DBへ適用）。型は生成物なしで `$inferSelect` / `$inferInsert` から推論する。
  - **`drizzle-kit push` は使わないこと。** 複合主キーを持つテーブル（ChannelJoin 等）で既存インデックスを正しく認識できず `index ... already exists` で失敗するバグが drizzle-kit v0.31.10 にある。generate + migrate は DB の現在状態を pull せず履歴ベースで差分適用するためこの問題を踏まない。
- SQLite なので高並列書き込みは不可。ヘビーな書き込みループを追加しない。
- シード（`src/db/seeds.ts`）投入前はサーバーが正常動作しない前提のコードが多い。

## コーディング規約

- リンター/フォーマッターは **Biome**（[biome.json](biome.json)）。ESLint/Prettier は導入しない。
- 型は Drizzle の `$inferSelect` / `$inferInsert` を活用する。
- コメントは日本語。既存コードのコメント密度（処理ブロックごとに短い説明）に合わせる。
- `biome-ignore` を使う場合は既存同様に理由を書く（例: WS インスタンスの `any`）。
- バージョンが新しめな点に注意: **Elysia v1.4**（macro は object 形式、`resolve({ as: "scoped" }, ...)`）、**Drizzle ORM**（`drizzle-orm/bun-sqlite` は同期ドライバ。クエリは thenable なので `await` は可、`db.transaction()` のコールバック内では `await` 不可）。古い API の記憶で書かない。

## 変更時のチェックリスト

1. ルート追加 → `t.Object` バリデーション + `response` スキーマ + `detail` を必ず定義
2. 認証が必要か → `Middleware.CheckToken`、管理操作か → `checkRoleTerm`
3. 状態変化をクライアントへ通知するか → `server?.publish` の WS シグナル追加
4. README のエンドポイント表・WS シグナル表・環境変数表を更新
5. `test/` の対応するテストファイルにケースを追記し、`NODE_ENV=test bun test` を通す
6. `bunx biome check --write .` を通す
