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
| POST | `/message/file/upload` | ✅ | - | ファイルアップロード |
| GET | `/message/file/:fileId` | ✅ | - | ファイル取得（キャッシュ: 1週間） |
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
| `RateLimiter` | 未認証は IP ベース、認証済みはトークンベースでリクエスト数を制限。超過で 429。環境変数で閾値設定可 |
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

| ファイル | 概要 |
|----------|------|
| `SendSystemMessage.ts` | システムメッセージ送信（WELCOME / CHANNEL_JOIN / CHANNEL_LEFT / CHANNEL_INVITED / CHANNEL_KICKED） |
| `CalculateReactionTotal.ts` | リアクション集計 |
| `CalculateRoleLevel.ts` | ロールレベル計算 |
| `CheckChannelVisitiblity.ts` | チャンネル閲覧権限チェック |
| `CompareRoleLevelToRole.ts` | ロールレベル比較 |
| `GetUserViewableChannel.ts` | ユーザーが閲覧可能なチャンネル一覧取得 |
| `getUsersRoleLevel.ts` | ユーザーのロールレベル取得 |

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
