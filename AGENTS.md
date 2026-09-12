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

- `db:*` は package.json の scripts（中身は `drizzle-kit generate` / `bun ./src/db/migrate.ts` / `bun ./src/db/seeds.ts`）。`db:migrate` は [src/db/migrate.ts](src/db/migrate.ts) で drizzle-orm の migrator を直接叩く（drizzle-kit migrate はエラー詳細を表示せず exit 1 するため）。`bun run db:baseline` は Prisma 時代の既存 DB に Drizzle を後付けする初回専用スクリプト（[src/db/baseline.ts](src/db/baseline.ts)）で、新規環境では使わない。
- `npm test` に相当する package.json の `test` スクリプトは未設定（`exit 1` を返すダミー）。テストは必ず `bun test` を直接叩く。
- Swagger 定義は各ルートの `detail`（tags / description）から生成される。

### テスト

[test/](test/) に `bun:test` ベースの結合テストがある。`src/index.ts` の `app` を直接 `app.handle()` する形式で、HTTP サーバーは立てない。

- **必ず `NODE_ENV=test` を付けて実行する。** Bun が `.env.test` を読み込み `DATABASE_URL` が `file:./test.db` に切り替わる。付け忘れると開発用の `dev.db` が全削除される。
- [test/util.ts](test/util.ts) の `INIT()` が全テスト共通の前処理（migrate → 全テーブル削除 → seeds 投入 → `TESTUSER` / `TESTUSER2` とトークン作成）。各テストファイルの `beforeAll` で呼ぶ。多重呼び出しはフラグで抑止される。
- リクエストは `FETCH({ path, method, body })` ヘルパー経由（内部で `app.handle(new Request(...))`）。デフォルトで `TESTUSER` の Cookie が付く。`useSecondaryUser: true` で `TESTUSER2`、`excludeCredential: true` で未認証リクエストになる。
- `NODE_ENV=test` のとき index.ts の `.onError()` はエラーログを抑制する。
- リクエストヘッダが必要な場合は `FETCH({ headers })` を使う。`PATCH` も可。
- Bot 用テストユーザー（`TESTUSER_BOT_1..3`）と `TESTBOT1..3`（BotManage）、`TESTBOT1` と `TESTCHANNEL1` のチャンネル許可が `INIT()` で作られる。Bot 関連テストはこれを使う（`tokenCode` は `TESTTOKEN1` / `TESTTOKEN2`）。`TESTBOT1` / `TESTBOT2` は `APPROVED`、`TESTBOT3` は既定の `PENDING`。
- **Bot 作成テストは `GIRACLE_SERVER_CONFIG.BotEnabled = true` を直接立てる必要がある**（seed 直後は false。`INIT()` の `reloadServerConfig()` で DB の値に戻るため、テスト内で毎回設定する）。
- 機能を追加したら対応するテストファイルに追記する。

## アーキテクチャの約束事

### db クライアントは src/index.ts からの import 一択

`db` インスタンスは [src/db/index.ts](src/db/index.ts) で `bun:sqlite` + `drizzle-orm/bun-sqlite` を使い生成され、[src/index.ts](src/index.ts) から re-export される。各 module / service / Utils は `import { db } from "../.."` のように **index.ts から相対 import** する（循環 import に見えるが意図された構成）。新しいインスタンスを作らないこと。

- 接続直後に `PRAGMA foreign_keys = ON;`（onDelete: cascade の動作に必須）と `PRAGMA journal_mode = WAL;` を実行している。
- DB のパスは環境変数 `DATABASE_URL`（`file:` プレフィックスは除去される。既定は `./dev.db`）。
- テーブル定義・relations・型 export は [src/db/schema.ts](src/db/schema.ts) にまとめてある。relational query (`db.query.<table>.findFirst/findMany`) を使うため `drizzle(sqlite, { schema })` で初期化されている。
- `db.query.*.findFirst` は該当なしで `undefined` を返す（Prisma の `null` とは異なるので `!== undefined` で判定する）。`update`/`delete` は対象0件でも例外を投げない（事前 `findFirst` か `.returning()` の行数で判定する）。
- `GIRACLE_SERVER_CONFIG` は起動時に select した値を**ミュータブルなオブジェクト**で保持する（旧来の「起動時の `const [config] = ...`」とは別物）。ServerConfig を書き換えたら index.ts の `reloadServerConfig()` を呼んでメモリを更新すること。テストの `INIT()` でも呼ばれる。DB 未初期化（マイグレーション前・テストロード時）でも起動が落ちないよう try/catch で握り潰している。

### モジュール構成: module（ルーティング）+ service（ロジック）

機能追加は `src/components/<Name>/` に以下のペアで作り、[src/index.ts](src/index.ts) の `app` に `.use()` で登録する。

- **`<name>.module.ts`** — `new Elysia({ prefix: "/<name>" })`。ルート定義・`t.Object` によるバリデーション・`response` スキーマ（成功/エラーの status ごとに定義。エラーは `t.Literal("...")` で文言まで固定）・Swagger 用 `detail` を持つ。レスポンス形式は `{ message: string, data?: ... }` が慣習。
- **`<name>.service.ts`** — `export namespace Service<Name> { ... }` にビジネスロジックを置く。エラーは Elysia の `throw status(4xx, "メッセージ")` で投げる。**service で投げる status とメッセージは module 側の `response` スキーマと一致させる**（ずれるとバリデーションエラーになる）。

グローバルエラーハンドラは index.ts の `.onError()`。`NODE_ENV=test` のときはエラーログを抑制する分岐がある。

### 認証・権限

- 認証必須ルート: module の先頭で `.use(Middleware.CheckToken)`。ハンドラでは `CheckToken: { _userId }` がコンテキストに注入される。トークンは 5 分キャッシュされる（[src/Middlewares.ts](src/Middlewares.ts)）ため、BAN 反映等に最大 5 分の遅延があり得る。
- 権限チェック: `.use(Middleware.CheckRoleTerm)` を併用し、ルートオプションに `checkRoleTerm: "manageChannel"` のように指定する（macro 実装）。権限は `manageServer` / `manageChannel` / `manageRole` / `manageUser` / `manageEmoji` の 5 種。`manageServer` は全チェックを通過する。
- **管理系ルートに `checkRoleTerm` を付け忘れると「ログイン済みなら誰でも実行可」になる。** 追加時は必ず確認。
- **macro と事前ミドルウェアの併用（二重処理の有無）**: `CheckRoleTerm`（内部で `.use(Middleware.CheckToken)`）や `ExtMiddleware.CheckPermission`（内部で `.use(CheckApiCode)`）のように macro 定義側で事前ミドルウェアを `.use()` していても、各 module 側で `.use(CheckToken).use(CheckRoleTerm)`（または `.use(CheckApiCode).use(CheckPermission)`）と併用して二重処理にはならない。Elysia の同一インスタンス/名前による重複排除に加え、`as: "scoped"` は孫モジュールへ自動伝播しないため。module 側の `.use(CheckToken)` はコンテキスト注入と検証実行に必須で、macro 側の `.use(CheckToken)` は macro 内の型解決に必要。

### Bot（外部 API）

Bot は `src/external/` 配下の外部 API（prefix `/ext`、[external.module.ts](src/external/external.module.ts)）経由で操作する。module/service 構成は通常の `src/components/<Name>/` と同じ。**Bot 自身の操作（メッセージ送受信など）は `/ext` 配下、Bot の管理（作成・承認・一覧）は `src/components/Server/` 配下の `/server/bot*` にある。** **Bot は `remoteUserId`（紐付いた users の行。`users.isBot` が true）経由でユーザーアカウントを持つ。** メッセージ送信・編集などの操作もすべて `remoteUserId` 名義で行う（`messages.userId = remoteUserId` かつ `isBot: true`）。

- 認証: `ExtMiddleware.CheckApiCode`（[Middleware.ext.ts](src/external/Middleware.ext.ts)）。`Authorization` ヘッダで `BotManage.tokenCode` を照合し、`approveStatus === "APPROVED"` でないと 401。コンテキストに `CheckApiCode: { ...BotManage }` が注入される。
- 権限: `ExtMiddleware.CheckPermission` macro + ルートオプション `checkPermission: "canSendMessage"` 等で `can*` フラグ（6 種）をチェック。認証同様 module 側で `.use(CheckApiCode).use(CheckPermission)` を併用する。
- チャンネル許可は `botChannelPermissions`（Bot × Channel の複合）。判定は [src/external/Util.ext.ts](src/external/Util.ext.ts) の `ExtUtil.isChannelPermitted` に集約している。許可のないチャンネルへの読み書きは 403。
  - 全透過（`useAllChannel: true`）は許可テーブルを引かず無条件で許可するが、**存在しないチャンネルは同関数が 404 `Channel not found` を投げる**（存在確認しないと `messages` への INSERT が FK 違反で 500 になるため）。
  - 非透過は `botChannelPermissions.channelId` の FK により、許可行があればチャンネルの存在が保証されるので存在確認クエリを足さない（存在しないチャンネルは 403 のまま）。
- 承認管理: `approveStatus` は PENDING/APPROVED/DENIED/BLOCKED。管理者向けは `/server/bot/all`（一覧）と `/server/bot/approval`（承認状況更新、`checkRoleTerm: "manageServer"`）。Bot 作成者向けは `/server/bot/me` と `/server/bot/me/:botId`。
- 一覧系は審査に必要な情報を返す。`GetBotMe` は `approveStatus`、管理者用 `GetBot`（`/server/bot/all`）は `approveStatus` + `useAllChannel` + `can*`（要求権限を伏せたまま承認させないため）。
- **Bot を承認済みでない状態にする・無効化する操作は、接続中の WS も切断する**（`Util.wsUserInstance.disconnect`）。該当は `PatchBotApproval`（BLOCKED/DENIED/PENDING へ変更時）、`PatchBot`（再申請で PENDING に戻った時）、`DeleteBot`（`users.isDeleted` で無効化）。切断しないと接続済み Bot が `channel::*` の配信を受け続ける。
- WS 接続時の拒否: `approveStatus !== "APPROVED"` は `Your bot is not approved yet`、BAN/論理削除は `This bot is disabled` を送って切断（[src/external/ws.ext.ts](src/external/ws.ext.ts) の open）。
- Bot 名は `botManages.botName` と `users.name` の二重保持。`PatchBot` の改名は同一トランザクションで両方を更新する（片方だけだと表示名が参照する `users.name` が旧名のまま残る）。どちらも UNIQUE なので衝突時は 400 `Bot name already exists` に寄せて両方ロールバックする。
- `PUT /server/bot` の入力検証: `name` は `maxLength: 64`（PATCH と揃える）、`permissionChannelIds` は `Set` で重複排除してから件数・可視性を検査する。
- **チャンネル許可は `PATCH /server/bot` でも変更できる**（`permissionChannelIds` / `useAllChannel`）。指定された場合は `PUT` と同じ検証（件数 ≤ 100・チャンネルの実在・可視性）を行う。許可テーブルは指定された内容で**差し替え**（全削除 → 再挿入）し、`useAllChannel: true` への切り替え時は行を消す。全透過中は許可リストが使われないため消さないと、後で非透過に戻したときに古い許可が復活してしまう。
  - `checkChannelVisibility` は閲覧制限ロールの無いチャンネルを無条件で許可するので、実在しないチャンネル ID を弾くには別途 `Channel` の存在確認が要る（`PUT` / `PATCH` の両方のループで行っている）。
- **チャンネル許可が変わったときは、接続中の WS の購読を張り替える**（`WSSubscribe` / `WSUnsubscribe`）。解除しないと許可を失ったチャンネルの `channel::*` 配信を受け続ける。全透過の Bot は接続時に全チャンネルを購読しているため、解除側は全チャンネルを対象にする。
- ServerConfig の `BotEnabled` / `BotAutoApprove`（既定はいずれも false）は `POST /server/change-config` で変更でき、DB とメモリ（`GIRACLE_SERVER_CONFIG`）の両方を更新する。
  - `BotEnabled`: false の間は `PUT /server/bot` が 400 `Using or creating bot is not allowed` になる。**既定 false なので、有効化しない限り Bot は作成できない。**
  - `BotAutoApprove`: 承認レビュー自体を省く設定。true なら新規作成は `PENDING` ではなく `APPROVED` で作られる（`PutBot`）。
- WS も `Authorization` ヘッダに tokenCode を付ければ Bot として接続できる（[src/external/ws.ext.ts](src/external/ws.ext.ts) の open/close）。`user::${remoteUserId}` と許可チャンネル（全透過は既存の全チャンネル）を購読する。**Bot の WS エンドポイントは `/ext/ws`**（通常ユーザーは `/ws`、[src/ws.ts](src/ws.ts)）。Elysia の静的ルーターは同一パスの WS ルートを上書きするため、1 つのパスに両方を登録することはできない。

#### `BotAutoApprove` と更新時の `approveStatus`

`PatchBot`（`PATCH /server/bot`）で Bot を更新したときの `approveStatus` は次のとおり。**`BLOCKED` は管理者による制裁なので据え置き、`BotAutoApprove: true` なら `DENIED` も `APPROVED` に戻る。**

| 更新前の状態 | `BotAutoApprove: true` | `BotAutoApprove: false` |
|---|---|---|
| `BLOCKED` | `BLOCKED` のまま | `BLOCKED` のまま |
| `DENIED` | `APPROVED` | 差分があれば `PENDING`、無ければ `DENIED` のまま |
| `PENDING` | `APPROVED` | 差分があれば `PENDING`、無ければ `PENDING` のまま |
| `APPROVED` | `APPROVED` | 差分があれば `PENDING`、無ければ `APPROVED` のまま |

- 「差分」= Bot 名の変更、`can*` 権限フラグの実際の変更、またはチャンネル許可（`useAllChannel` / `permissionChannelIds`）の実際の変更。`description` のみの変更は再申請にしない。
  - チャンネル許可は全透過中なら実効性が無いため、全透過が指定されているときの `permissionChannelIds` の差分は数えない。
- 差分が無い場合は `approveStatus` を UPDATE の対象に含めない（据え置き）。
- `BLOCKED` の判定は他の分岐より先に行うため、`BotAutoApprove` の値に関わらず解除されない。

### WebSocket 通知

リアルタイム通知は Bun の pub/sub を使う。ハンドラのコンテキストにある `server` から publish する:

```ts
server?.publish(
  `channel::${channelId}`, // "GLOBAL" | `user::${userId}` | `channel::${channelId}`
  JSON.stringify({ signal: "message::SendMessage", data: ... }),
);
```

- signal 名は `対象::イベント名`（PascalCase）。新規 signal を追加したら README の一覧に追記する。
- ユーザーの購読チャンネルを増減させるときは [src/Utils/WSUserInstance.ts](src/Utils/WSUserInstance.ts)（`Util.wsUserInstance.subscribe(userId, wsChannel)` / `.unsubscribe(...)`）を使う。`Util.wsUserInstance.instances`（Map<userId, ws[]>）が通常ユーザーと Bot の両方の接続を一括管理し、複数端末の同時接続を許容する。BAN・Bot 無効化時の切断は `Util.wsUserInstance.disconnect(userId, reason)`。
  - この共通処理を通常ユーザー用 [src/ws.ts](src/ws.ts) と Bot 用 [src/external/ws.ext.ts](src/external/ws.ext.ts) が共有する。**WS 接続は `/ws`（通常ユーザー・Cookie 認証）と `/ext/ws`（Bot・Authorization ヘッダ）でエンドポイントが分かれている**（Elysia の静的ルーターが同一パスの WS ルートを上書きするため同居できない）。
  - 新規チャンネル作成時は `WSSubscribeAllChannelBots(channelId)`（[src/external/ws.ext.ts](src/external/ws.ext.ts)）で全透過 Bot を追従させる。
- URL プレビューはミドルウェア `UrlPreviewControl` が担当。メッセージ送信/編集ルートにルートオプション `bindUrlPreview: true` を付けると `afterResponse` で OGP 取得 → DB 保存 → `message::UpdateMessage` を publish する。

### 通知（Inbox / Web Push）

- メンション・リプライ時の通知は DB の `Inbox` + WS `inbox::Added` + Web Push（[src/Utils/SendPushNotification.ts](src/Utils/SendPushNotification.ts)）の 3 経路。
- Web Push は VAPID 鍵（環境変数）未設定でも起動する設計。送信前に `isWebPushReady()` で判定する。
- `/notification` モジュール（デバイス登録・通知設定・チャンネルミュート）のエンドポイントは README の一覧に記載済み。リクエスト/レスポンスの詳細は [notification.module.ts](src/components/Notification/notification.module.ts) を読む。

### Utils

横断的な処理は `src/Utils/` に 1 ファイル 1 機能（default export。補助関数のみ named export を併用する場合がある）で置く。

- チャンネルへのアクセス制御を伴う処理では `CheckChannelVisibility` / `GetUserViewableChannel` の再利用を優先する。

呼び出し側は個々のファイルを直接 import せず、[src/Util.ts](src/Util.ts) が re-export する `Util` namespace 経由で参照する（`import { Util } from "../../Util"` → `Util.sendSystemMessage(...)` のように使う）。プロパティ名は camelCase（例: `CheckChannelVisibility` → `Util.checkChannelVisibility`）。**新しい Utils ファイルを追加したら `src/Util.ts` に import + namespace export を追記すること。**

- Bot 外部 API 専用のヘルパは [src/external/Util.ext.ts](src/external/Util.ext.ts) の `ExtUtil` namespace に置く（`src/Util.ts` の `Util` とは別系統なので追記先を間違えない）。
- `ExtUtil.isChannelPermitted` は権限なしを `false` で返しエラーは呼び出し側が投げるが、チャンネル不在は文言が全ルート共通なので同関数が 404 を投げる（前述の Bot 節を参照）。

## DB（Drizzle / bun:sqlite）

- スキーマは [src/db/schema.ts](src/db/schema.ts)。
- スキーマ変更フロー: `src/db/schema.ts` 編集 → `bun run db:generate`（[drizzle/](drizzle/) にマイグレーションSQL生成）→ `bun run db:migrate`（DBへ適用）。型は生成物なしで `$inferSelect` / `$inferInsert` から推論する。
  - **`drizzle-kit push` は使わないこと。** 複合主キーを持つテーブル（ChannelJoin 等）で既存インデックスを正しく認識できず `index ... already exists` で失敗するバグが drizzle-kit v0.31.10 にある。generate + migrate は DB の現在状態を pull せず履歴ベースで差分適用するためこの問題を踏まない。
  - **既存テーブルへの列追加に `.default(sql\`...\`)` は使わない。** SQLite の `ALTER TABLE ADD COLUMN`は式デフォルト（括弧式・`CURRENT_*`）を許可しないため、drizzle-kit が生成した SQL の適用が`Cannot add a column with non-constant default` で失敗する（CREATE TABLE では許可されるため新規テーブルなら問題ない）。既存テーブルへ列を足す場合は `.$defaultFn(() => new Date())` を使う。もし生成済みマイグレーションがこの形になってしまったら、手で「ADD COLUMN（デフォルトなし）→ バックフィル UPDATE」に分割して直す（drizzle-orm は INSERT 時に sql デフォルトをクエリ側に埋め込むため DB 側デフォルトは不要）。
- SQLite なので高並列書き込みは不可。ヘビーな書き込みループを追加しない。
- シード（`src/db/seeds.ts`）投入前はサーバーが正常動作しない前提のコードが多い。

## コーディング規約

- リンター/フォーマッターは **Biome**（[biome.json](biome.json)）。ESLint/Prettier は導入しない。
- 型は Drizzle の `$inferSelect` / `$inferInsert` を活用する。
- コメントは日本語。既存コードのコメント密度（処理ブロックごとに短い説明）に合わせる。
- `biome-ignore` を使う場合は既存同様に理由を書く（例: WS インスタンスの `any`）。
- バージョンが新しめな点に注意: **Elysia v1.4**（macro は object 形式、`resolve({ as: "scoped" }, ...)`）、**Drizzle ORM**（`drizzle-orm/bun-sqlite` は同期ドライバ。クエリは thenable なので `await` は可、`db.transaction()` のコールバック内では `await` 不可）。古い API の記憶で書かない。

## 変更時のチェックリスト

1. ルート追加 → `t.Object` バリデーション + `detail` を必ず定義
2. 認証が必要か → `Middleware.CheckToken`、管理操作か → `checkRoleTerm`
3. 状態変化をクライアントへ通知するか → `server?.publish` の WS シグナル追加
4. README のエンドポイント表・WS シグナル表・環境変数表を更新
5. `test/` の対応するテストファイルにケースを追記し、`NODE_ENV=test bun test` を通す
6. `bunx biome check --write .` を通す
7. Bot の承認・権限フローを変えたら、`APPROVED` でなくなった時の WS 切断（`Util.wsUserInstance.disconnect`）と、改名時の `users.name` 同期を確認する
