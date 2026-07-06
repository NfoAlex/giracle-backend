# スキーマ変換仕様 (schema.prisma → Drizzle)

`drizzle-orm/sqlite-core` の `sqliteTable` で全18モデルを定義する。

## 最重要: 既存 DB との互換性

既存の `dev.db` をそのまま読めるようにするには、**テーブル名・カラム名を Prisma の生成物と完全一致**させる必要がある。

- Prisma の SQLite テーブル名は**モデル名そのまま**（PascalCase）: `User`, `NotificationDevice`, `ChannelJoin` など。`@@map` は未使用。
- カラム名もフィールド名そのまま（camelCase / PascalCase 混在。例: `ServerConfig.RegisterAvailable`）。
- Drizzle 側は `sqliteTable("User", { ... })` のように第一引数で名前を固定する。TypeScript 変数名は `users` 等好みで良いが、DB 名は一致必須。
- インデックス名・FK 制約名は Prisma と Drizzle で命名規則が異なる。`drizzle-kit push` で差分が出るため、**既存 DB 継続利用か、DB 再作成（開発環境なら seeds 再実行で可）かを最初に決める**こと。開発 DB は再作成が簡単。本番データがあるなら手書きマイグレーション or 名前合わせが必要。

## 型マッピング

| Prisma | Drizzle (sqlite-core) | 備考 |
|--------|----------------------|------|
| `String @id @default(uuid())` | `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())` | Prisma の uuid() は**クライアント側生成**。Drizzle も `$defaultFn` でクライアント側生成にする（DB DEFAULT なし、既存 DDL と一致） |
| `Int @id @default(autoincrement())` | `integer("id").primaryKey({ autoIncrement: true })` | |
| `String` / `String?` | `text("...").notNull()` / `text("...")` | **Prisma は非 `?` が NOT NULL。Drizzle はデフォルト nullable なので `.notNull()` の付け忘れに注意** |
| `Boolean @default(false)` | `integer("...", { mode: "boolean" }).notNull().default(false)` | SQLite に boolean はなく整数 0/1 |
| `Int` | `integer("...").notNull()` | |
| `DateTime` | `integer("...", { mode: "timestamp_ms" })` | 下記参照 |

## DateTime の扱い（落とし穴 #1）

`src/index.ts` の adapter は `timestampFormat: "unixepoch-ms"` → **DateTime カラムは Unix epoch ミリ秒の整数**として保存されている。

- Drizzle では `integer("createdAt", { mode: "timestamp_ms" })` を使う。読み書きとも `Date` オブジェクトになり、アプリコードの `Date` 前提を維持できる。
- `@default(now())` は Prisma がクライアント側で生成している。Drizzle では `.$defaultFn(() => new Date())` で再現（`.default(sql\`CURRENT_TIMESTAMP\`)` は**文字列が入るため不可**）。
- `MessageReadTime.readTime` はデフォルトなしの必須 DateTime。アプリから常に渡される。
- **注意:** `prisma/seeds.ts` は `timestampFormat` 未指定の別インスタンスで投入しているため、既存 dev.db 内に ISO 文字列形式の日時が混在している可能性がある。DB 再作成を推奨する理由の一つ。

## nullable + unique（落とし穴 #2）

`User.name` は `String? @unique`。Drizzle: `text("name").unique()`（notNull なし）。SQLite は NULL 同士を unique 違反にしないので挙動は一致する。

## 複合主キー

`primaryKey({ columns: [...] })` を第3引数（table callback）で定義:

| テーブル | 複合PK |
|----------|--------|
| ChannelMute | `[userId, channelId]` |
| ChannelViewableRole | `[channelId, roleId]` |
| ChannelJoin | `[userId, channelId]` |
| MessageReadTime | `[channelId, userId]` |
| Inbox | `[messageId, userId]` |
| RoleLink | `[userId, roleId]` |

**PK のカラム順序も Prisma 定義と同一にする**（`@@id([userId, channelId])` の順のまま）。

## 外部キーと onDelete

Prisma スキーマの `onDelete: Cascade, onUpdate: Cascade` は DB レベルの FK 制約として DDL に出力されている。Drizzle では:

```ts
userId: text("userId").notNull()
  .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
```

- `onDelete` **指定なし**のリレーション（Password, Token, ChannelJoin.user, Inbox, RoleLink, RoleInfo.user, CustomEmoji, Invitation, Channel.user, MessageFileAttached.user）は Prisma のデフォルトで **RESTRICT**。Drizzle でも `{ onDelete: "restrict", onUpdate: "cascade" }`（Prisma の必須リレーションのデフォルトは onUpdate: Cascade）。既存 DDL を `sqlite3 dev.db .schema` で確認して合わせるのが確実。
- **落とし穴 #3:** SQLite は `PRAGMA foreign_keys` がコネクション毎にデフォルト OFF。`bun:sqlite` も同様（Bun 1.x では `new Database(path)` 時点で FK は無効）。Prisma adapter は内部で有効化していた。Drizzle + bun:sqlite 構成では接続直後に `db.run("PRAGMA foreign_keys = ON;")`（または `new Database(path, { strict: true })` に加えて明示 PRAGMA）を必ず実行する。**これを忘れると Cascade 削除が全て無効になり、チャンネル削除・ユーザー削除周りが静かに壊れる。**

## インデックス

各モデルの `@@index([...])` を `index("...").on(...)` で再現する。unique は `text().unique()` またはテーブル callback の `uniqueIndex`。対象:

- NotificationDevice: `token` unique, `userId` index
- Token: `token` unique, `userId` index
- ChannelMute / ChannelViewableRole / ChannelJoin / MessageReadTime: 各 `userId`(or `roleId`) / `channelId` index
- MessageFileAttached / MessageReaction: `channelId`, `messageId`, `userId` index
- Inbox: `userId` index
- Message: `channelId`, `userId` index
- CustomEmoji: `code` unique, `uploadedUserId` index
- RoleLink: `userId`, `roleId` index
- Channel.name / RoleInfo.name / Invitation.inviteCode / BlockedIPAddress.address / ChannelJoinOnDefault.channelId / User.name: unique

## リレーション定義（relational queries 用）

コードベースは `include:` / ネスト select を多用している（02 参照）。Drizzle の relational query API (`db.query.<table>.findMany({ with: ... })`) を使うため、全テーブルの `relations()` 定義が必要。

- 1対1: `User ↔ Password`, `User ↔ NotificationConfig`, `Channel ↔ ChannelJoinOnDefault`
- 1対多: 残り全て（User は 16 リレーションを持つハブ）
- Message ↔ MessageFileAttached / MessageReaction は `messageId` が nullable（メッセージ送信前のアップロードを許す設計）

## 型 export

`prisma/generated/client` からの型 import の置き換え:

```ts
export type Message = typeof messages.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type NewMessageUrlPreview = typeof messageUrlPreviews.$inferInsert;
// ← Middlewares.ts の MessageUrlPreviewCreateManyMessageInput の代替
```

使用箇所: `src/Middlewares.ts`, `src/components/Channel/channel.service.ts`, `src/components/Message/message.service.ts`, `src/Utils/GetUserViewableChannel.ts`。

**注意:** Prisma の `include` 付き戻り値型（例: `Message & { MessageUrlPreview: [...] }`）を手書きで受けている箇所は、Drizzle の `with` の戻り値型（推論）に置き換わる。シグネチャで Prisma 型を参照している関数は戻り値型注釈の見直しが必要。
