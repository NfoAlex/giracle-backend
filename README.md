# giracle-backend

Giracle のバックエンドサーバー。[Elysia](https://elysiajs.com/) (Bun) + [Prisma](https://www.prisma.io/) (libsql/SQLite) 構成。

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| ランタイム | Bun |
| フレームワーク | Elysia v1.4 |
| ORM | Prisma v7 (adapter: libsql) |
| DB | SQLite (libsql) |
| リンター | Biome |

---


## 必要パッケージのインストール
Bunが必須です。Bunが入っているならこのリポジトリのディレクトリで次のコマンドを実行。
```bash
bun i
```

## Development 開発用実行
初回の実行ならDBのプッシュと初期データの挿入を行う。
```bash
bunx prisma db push #DB構造の適用
bun ./prisma/seeds.ts #初期データの挿入
```
開発用に実行するなら

## 起動方法

```bash
bun dev
```

---

## ディレクトリ構成

```
giracle-backend/
├── src/
│   ├── index.ts              # エントリーポイント・サーバー起動
│   ├── ws.ts                 # WebSocket ハンドラ
│   ├── Middlewares.ts        # ミドルウェア定義
│   ├── Utils/                # 共通ユーティリティ
│   └── components/           # 機能モジュール
│       ├── Channel/
│       │   ├── channel.module.ts   # ルーティング
│       │   └── channel.service.ts  # ビジネスロジック
│       ├── Message/
│       │   ├── message.module.ts
│       │   └── message.service.ts
│       ├── Notification/
│       │   ├── notification.module.ts
│       │   ├── notification.service.ts
│       │   └── types.ts
│       ├── Role/
│       │   ├── role.module.ts
│       │   └── role.service.ts
│       ├── Server/
│       │   ├── server.module.ts
│       │   └── server.service.ts
│       └── User/
│           ├── user.module.ts
│           └── user.service.ts
├── prisma/
│   ├── schema.prisma         # DBスキーマ定義
│   ├── seeds.ts              # シードデータ
│   └── generated/            # Prisma 生成クライアント
└── STORAGE/                  # アップロードファイル保存先
    ├── file/
    ├── icon/
    ├── banner/
    └── custom-emoji/
```

---

## モジュール構成

各コンポーネントは `*.module.ts`（ルーティング）と `*.service.ts`（ビジネスロジック）のペアで構成される。

### User モジュール (`/user`)

認証不要のルートと認証済みルートが混在する。

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| PUT | `/user/sign-up` | ❌ | - | ユーザー登録 |
| POST | `/user/sign-in` | ❌ | - | サインイン（Cookie にトークンをセット） |
| GET | `/user/sign-out` | ✅ | - | サインアウト（Cookie 削除） |
| GET | `/user/verify-token` | ✅ | - | トークン有効性確認 |
| GET | `/user/get-online` | ✅ | - | オンラインユーザー一覧取得 |
| GET | `/user/search` | ✅ | - | ユーザー検索 |
| GET | `/user/info/:id` | ✅ | - | ユーザー情報取得 |
| GET | `/user/list` | ✅ | - | ユーザー一覧取得 |
| GET | `/user/icon/:userId` | ✅ | - | アイコン画像取得 |
| GET | `/user/banner/:userId` | ✅ | - | バナー画像取得 |
| POST | `/user/change-icon` | ✅ | - | アイコン変更 |
| POST | `/user/change-banner` | ✅ | - | バナー変更 |
| POST | `/user/change-password` | ✅ | - | パスワード変更 |
| POST | `/user/profile-update` | ✅ | - | プロフィール更新（WS通知: `user::ProfileUpdate`） |
| GET | `/user/session` | ✅ | - | セッション一覧取得 |
| POST | `/user/change-session-name` | ✅ | - | セッション名変更 |
| DELETE | `/user/session` | ✅ | - | セッション削除 |
| POST | `/user/ban` | ✅ | `manageUser` | ユーザー BAN（WS通知: `user::ProfileUpdate`） |
| POST | `/user/unban` | ✅ | `manageUser` | ユーザー BAN 解除（WS通知: `user::ProfileUpdate`） |

---

### Channel モジュール (`/channel`)

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| POST | `/channel/join` | ✅ | - | チャンネル参加（WS通知: `channel::Join`） |
| POST | `/channel/leave` | ✅ | - | チャンネル退出（WS通知: `channel::Left`） |
| GET | `/channel/get-info/:channelId` | ✅ | - | チャンネル情報取得 |
| GET | `/channel/list` | ✅ | - | チャンネル一覧取得 |
| POST | `/channel/get-history/:channelId` | ✅ | - | メッセージ履歴取得（ページネーション対応） |
| GET | `/channel/search` | ✅ | - | チャンネル検索 |
| POST | `/channel/invite` | ✅ | `manageChannel` | ユーザーをチャンネルへ招待（WS通知: `channel::Join`） |
| POST | `/channel/kick` | ✅ | `manageChannel` | ユーザーをチャンネルからキック（WS通知: `channel::Left`） |
| POST | `/channel/update` | ✅ | `manageChannel` | チャンネル情報更新（WS通知: `channel::UpdateChannel`） |
| PUT | `/channel/create` | ✅ | `manageChannel` | チャンネル作成 |
| DELETE | `/channel/delete` | ✅ | `manageChannel` | チャンネル削除 |

---

### Message モジュール (`/message`)

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| GET | `/message/:messageId` | ✅ | - | メッセージ単体取得 |
| GET | `/message/get-new` | ✅ | - | 新着メッセージ確認 |
| GET | `/message/read-time/get` | ✅ | - | 既読時刻取得 |
| POST | `/message/read-time/update` | ✅ | - | 既読時刻更新（WS通知: `message::ReadTimeUpdated`） |
| GET | `/message/search` | ✅ | - | メッセージ検索 |
| POST | `/message/file/upload` | ✅ | - | ファイルアップロード（チャンネル参加を確認） |
| GET | `/message/file/:fileId` | ✅ | - | ファイル取得（キャッシュ: 1週間、チャンネル閲覧権限を確認） |
| DELETE | `/message/delete` | ✅ | - | メッセージ削除（WS通知: `message::MessageDeleted`） |
| GET | `/message/inbox` | ✅ | - | 通知（inbox）一覧取得 |
| POST | `/message/inbox/read` | ✅ | - | 通知を既読（WS通知: `inbox::Deleted`） |
| POST | `/message/inbox/clear` | ✅ | - | 全通知を既読（WS通知: `inbox::Clear`） |
| POST | `/message/emoji-reaction` | ✅ | - | 絵文字リアクション追加（WS通知: `message::AddReaction`） |
| GET | `/message/who-reacted` | ✅ | - | リアクションしたユーザー取得 |
| DELETE | `/message/delete-emoji-reaction` | ✅ | - | 絵文字リアクション削除（WS通知: `message::DeleteReaction`） |
| POST | `/message/send` | ✅ | - | メッセージ送信（WS通知: `message::SendMessage`、URLプレビュー生成） |
| POST | `/message/edit` | ✅ | - | メッセージ編集（WS通知: `message::UpdateMessage`、URLプレビュー更新） |

---

### Role モジュール (`/role`)

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| GET | `/role/search` | ✅ | - | ロール検索 |
| GET | `/role/list` | ✅ | - | ロール一覧取得 |
| GET | `/role/:roleId` | ✅ | - | ロール情報取得 |
| PUT | `/role/create` | ✅ | `manageRole` | ロール作成（WS通知: `role::Created`） |
| POST | `/role/update` | ✅ | `manageRole` | ロール更新（WS通知: `role::Updated`） |
| POST | `/role/link` | ✅ | `manageRole` | ユーザーへロール付与（WS通知: `role::Linked`） |
| POST | `/role/unlink` | ✅ | `manageRole` | ユーザーからロール剥奪（WS通知: `role::Unlinked`） |
| DELETE | `/role/delete` | ✅ | `manageRole` | ロール削除（WS通知: `role::Deleted`） |

---

### Server モジュール (`/server`)

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| GET | `/server/config` | ❌ | - | サーバー設定取得 |
| GET | `/server/banner` | ❌ | - | サーバーバナー画像取得 |
| GET | `/server/custom-emoji` | ✅ | - | カスタム絵文字一覧取得 |
| GET | `/server/custom-emoji/:code` | ✅ | - | カスタム絵文字取得（キャッシュ: 3日） |
| GET | `/server/get-invite` | ✅ | `manageServer` | 招待コード一覧取得 |
| PUT | `/server/create-invite` | ✅ | `manageServer` | 招待コード作成 |
| DELETE | `/server/delete-invite` | ✅ | `manageServer` | 招待コード削除 |
| POST | `/server/change-info` | ✅ | `manageServer` | サーバー基本情報変更（WS通知: `server::ConfigUpdate`） |
| POST | `/server/change-config` | ✅ | `manageServer` | サーバー設定変更（WS通知: `server::ConfigUpdate`） |
| POST | `/server/change-banner` | ✅ | `manageServer` | バナー画像変更 |
| PUT | `/server/custom-emoji/upload` | ✅ | `manageEmoji` | カスタム絵文字追加（WS通知: `server::CustomEmojiUploaded`） |
| DELETE | `/server/custom-emoji/delete` | ✅ | `manageEmoji` | カスタム絵文字削除（WS通知: `server::CustomEmojiDeleted`） |
| GET | `/server/storage-usage` | ✅ | `manageServer` | ストレージ使用量取得 |

---

### Notification モジュール (`/notification`)

| メソッド | パス | 認証 | 権限 | 概要 |
|----------|------|------|------|------|
| GET | `/notification/vapid-public-key` | ❌ | - | Web Push 用 VAPID 公開鍵取得（未設定時は 503） |
| GET | `/notification/config` | ✅ | - | 自分の通知設定取得 |
| POST | `/notification/config` | ✅ | - | 自分の通知設定更新（enabled / mode） |
| POST | `/notification/device/register` | ✅ | - | プッシュ通知端末の登録（platform: web / android / ios） |
| POST | `/notification/device/unregister` | ✅ | - | プッシュ通知端末の解除 |
| GET | `/notification/muted-channels` | ✅ | - | ミュート中チャンネル一覧取得 |
| POST | `/notification/mute-channel` | ✅ | - | チャンネルをミュート |
| POST | `/notification/unmute-channel` | ✅ | - | チャンネルのミュート解除 |

---

## WebSocket (`/ws`)

接続時に Cookie または `?token` クエリパラメータでトークン認証。

### 接続時の購読チャンネル

| WS チャンネル | 対象 |
|---------------|------|
| `GLOBAL` | 全ユーザー共通イベント |
| `user::{userId}` | 該当ユーザー向けイベント |
| `channel::{channelId}` | 参加済みチャンネルのイベント |

### クライアント → サーバー シグナル

| signal | 概要 |
|--------|------|
| `ping` | 疎通確認（`pong` を返す） |

### サーバー → クライアント シグナル一覧

| signal | 説明 |
|--------|------|
| `user::Connected` | ユーザー接続 |
| `user::Disconnected` | ユーザー切断 |
| `user::ProfileUpdate` | プロフィール更新 / BAN 状態変化 |
| `channel::Join` | チャンネル参加 |
| `channel::Left` | チャンネル退出 |
| `channel::UpdateChannel` | チャンネル情報更新 |
| `message::SendMessage` | 新規メッセージ |
| `message::UpdateMessage` | メッセージ編集 / URLプレビュー更新 |
| `message::MessageDeleted` | メッセージ削除 |
| `message::ReadTimeUpdated` | 既読時刻更新 |
| `message::AddReaction` | リアクション追加 |
| `message::DeleteReaction` | リアクション削除 |
| `inbox::Added` | 通知追加（mention / reply） |
| `inbox::Deleted` | 通知既読 |
| `inbox::Clear` | 全通知クリア |
| `role::Created` | ロール作成 |
| `role::Updated` | ロール更新 |
| `role::Deleted` | ロール削除 |
| `role::Linked` | ロール付与 |
| `role::Unlinked` | ロール剥奪 |
| `server::ConfigUpdate` | サーバー設定更新 |
| `server::CustomEmojiUploaded` | カスタム絵文字追加 |
| `server::CustomEmojiDeleted` | カスタム絵文字削除 |

---

## ミドルウェア

`src/Middlewares.ts` に Elysia プラグインとして定義。

| 名前 | 概要 |
|------|------|
| `CheckToken` | Cookie の `token` を検証し `_userId` をコンテキストへ注入。トークンキャッシュ（5分）で DB 負荷軽減 |
| `CheckRoleTerm` | ルート定義時の `checkRoleTerm` オプションに指定したロール権限を `beforeHandle` で確認 |
| `RateLimiter` | 未認証は接続元 IP（`server.requestIP()`）ベース、認証済みはトークンベースでリクエスト数を制限。超過で 429。環境変数で閾値設定可 |
| `UrlPreviewControl` | メッセージ送信・編集後に URL を抽出し OGP 情報を DB 保存。Twitter/X は fxTwitter へ変換。`bindUrlPreview: true` で有効化 |

### 権限（`checkRoleTerm`）の種類

| 権限名 | 対象操作 |
|--------|----------|
| `manageServer` | サーバー設定・招待コード・ストレージ管理 |
| `manageChannel` | チャンネル作成・更新・削除・招待・キック |
| `manageRole` | ロール作成・更新・削除・付与・剥奪 |
| `manageUser` | ユーザー BAN / BAN 解除 |
| `manageEmoji` | カスタム絵文字追加・削除 |

> `manageServer` 権限を持つロールはすべての権限チェックを通過する。

---

## ユーティリティ (`src/Utils/`)

各ファイルは `src/Util.ts` の `Util` namespace 経由で参照する（`import { Util } from "../../Util"` → `Util.xxx(...)`）。個々のファイルへの直接 import は行わない。

| ファイル | `Util.` プロパティ名 | 概要 |
|----------|----------------------|------|
| `SendSystemMessage.ts` | `sendSystemMessage` | システムメッセージ送信（WELCOME / CHANNEL_JOIN / CHANNEL_LEFT / CHANNEL_INVITED / CHANNEL_KICKED） |
| `SendPushNotification.ts` | `sendPushNotification` | Web Push 送信（VAPID 初期化・端末別送信・無効端末の自動削除） |
| `CalculateReactionTotal.ts` | `calculateReactionTotal` | リアクション集計 |
| `CalculateRoleLevel.ts` | `calculateRoleLevel` | ロールレベル計算 |
| `CheckChannelVisitiblity.ts` | `checkChannelVisibility` | チャンネル閲覧権限チェック（※ファイル名は typo のまま、namespace 経由の名前は正しいスペル） |
| `CompareRoleLevelToRole.ts` | `compareRoleLevelToRole` | ロールレベル比較 |
| `GetUserViewableChannel.ts` | `getUserViewableChannel` | ユーザーが閲覧可能なチャンネル一覧取得 |
| `getUsersRoleLevel.ts` | `getUsersRoleLevel` | ユーザーのロールレベル取得 |

新しい Utils ファイルを追加した場合は `src/Util.ts` に import と namespace export を追記する。

---

## 環境変数

| 変数名 | デフォルト | 概要 |
|--------|-----------|------|
| `DATABASE_URL` | `file:./dev.db` | DB 接続 URL |
| `CORS_ORIGIN` | - | CORS 許可オリジン |
| `RATE_LIMIT_ENABLED` | - | `"true"` でレート制限有効化 |
| `RATE_LIMIT_ANONYMOUS_COUNT` | `25` | 未認証の制限リクエスト数 |
| `RATE_LIMIT_ANONYMOUS_TIMEOUT` | `60` | 未認証のウィンドウ幅（秒） |
| `RATE_LIMIT_AUTHORIZED_COUNT` | `200` | 認証済みの制限リクエスト数 |
| `RATE_LIMIT_AUTHORIZED_TIMEOUT` | `60` | 認証済みのウィンドウ幅（秒） |
| `VAPID_PUBLIC_KEY` | - | Web Push 用 VAPID 公開鍵 |
| `VAPID_PRIVATE_KEY` | - | Web Push 用 VAPID 秘密鍵 |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Web Push の subject (mailto: または https:)主目的はPush Service (FCM / Mozilla autopush / Apple push) の運営者がアプリサーバ運営者に連絡を取るための連絡先 |

### プッシュ通知 (Web Push) セットアップ

現状は Web のみ対応。Android(Flutter) / iOS(Swift) は将来対応予定。

1. VAPID キーを生成
   ```bash
   bunx web-push generate-vapid-keys
   ```
2. 出力を `.env` の `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` に設定

`VAPID_*` 未設定でもサーバーは起動するが、Web プッシュは無効化 (`/notification/vapid-public-key` が 503)。

---

## このプロジェクトを扱う人への注意点

### セキュリティ・本番運用

- **HTTPS 必須。** 認証トークンは Cookie（`httpOnly`）で扱う。TLS 終端の背後でのみ運用すること。平文 HTTP ではトークンが盗聴される。
- **`CORS_ORIGIN` を必ず設定する。** 未設定だとオリジン制限が効かず、Cookie 認証と組み合わさると危険。本番では信頼するフロントエンドのオリジンを明示する。
- **レート制限はデフォルト無効。** `RATE_LIMIT_ENABLED=true` にしない限りログインの総当たりに無防備。本番では有効化する。
- **未認証リクエストの IP 判定は接続元ソケットの IP（`server.requestIP()`）を基準にする。** ヘッダー偽装では回避できないが、リバースプロキシ配下ではリクエストが全てプロキシの IP として扱われ、レート制限が実質機能しなくなる（あるいは利用者全員が同一キーとして巻き込まれる）。プロキシ経由で運用する場合は、プロキシ側で L4/L7 のレート制限・IP ブロックを別途用意するか、信頼できるプロキシのみが到達できる構成にすること。
- **パスワードの最小長は 4 文字と緩い。** 必要なら運用ポリシーやフロント側のバリデーションで補う。
- **URL プレビュー取得時は SSRF 対策として `localhost` / `127.0.0.1` / `169.254.` 始まり（クラウドのメタデータサーバー想定）/ 生 IP アドレス指定の URL を除外している。** 完全な対策ではない（DNS 解決結果までは検証していない）ため、内部ネットワークからの到達性が問題になる場合は追加の対策を検討すること。

### インフラ・データ

- **DB は SQLite (libsql)。** 高い同時書き込みには不向き。`dev.db`（`DATABASE_URL`）の定期バックアップ手順を用意すること。
- **`DATABASE_URL` は本番で明示指定する。** 未設定時は `file:./dev.db` にフォールバックする。
- **`STORAGE/` はユーザーがアップロードした画像・ファイルの実体。** ディレクトリ権限を絞り、バックアップ対象に含める。Web から直接配信できる場所には置かない。

### 開発・セットアップ

- **初回セットアップの順序を守る。** `bunx prisma db push` → `bun ./prisma/seeds.ts` の順で実行する。シードで `ServerConfig` と `HOST` / `MEMBER` ロールが作られる。これらの投入前はサーバーが正常に動作しない。
- **最初に登録したユーザーが `HOST`（全権限）になる。** セットアップ直後の初回登録は必ず管理者本人が行うこと。
- **モジュールは `*.module.ts`（ルーティング＋バリデーション）と `*.service.ts`（ロジック）のペアで構成される。** 認証は `Middleware.CheckToken`、権限チェックはルート定義の `checkRoleTerm` オプションで付与する。
- **管理系ルートを追加するときは `checkRoleTerm` の付け忘れに注意する。** 指定しないと「認証さえ通れば誰でも実行可能」になる。
