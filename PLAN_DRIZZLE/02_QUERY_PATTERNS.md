# クエリパターン変換仕様

本プロジェクトで**実際に使われている** Prisma パターンの一覧と、Drizzle での対応方針。
（`db.<model>.<op>` 約150箇所 / 17ファイル）

## 1. 基本 CRUD

| Prisma | Drizzle |
|--------|---------|
| `db.user.findUnique({ where: { id } })` | `db.query.users.findFirst({ where: eq(users.id, id) })` または `db.select().from(users).where(eq(users.id, id)).get()` |
| `db.user.findFirst / findMany` | `db.query.users.findFirst / findMany` |
| `db.user.create({ data })` | `db.insert(users).values(data).returning().get()` — **Prisma の create は作成行を返す。呼び出し側が戻り値を使う箇所では `.returning()` 必須** |
| `db.user.update({ where, data })` | `db.update(users).set(data).where(...).returning().get()` — 同上 |
| `db.user.delete({ where })` | `db.delete(users).where(...)`（戻り値使用時は `.returning()`） |
| `db.x.createMany({ data: [...] })` | `db.insert(x).values([...])` — **空配列を values() に渡すとエラー。呼び出し前に length チェック（既存コードは概ねチェック済みだが要確認）** |
| `db.x.deleteMany({ where })` | `db.delete(x).where(...)` |
| `db.x.updateMany / updateManyAndReturn` | `db.update(x).set().where().returning()`（server.service.ts の ServerConfig 更新2箇所で `updateManyAndReturn` 使用） |
| `db.x.upsert({ where, update, create })` | `db.insert(x).values(create).onConflictDoUpdate({ target: ..., set: update })` — 使用箇所: notification.service.ts×3, message.service.ts (MessageReadTime), Middlewares.ts (BlockedIPAddress) |
| `db.x.count({ where })` | `db.$count(x, where)` または `select({ c: count() })` |

## 2. where 演算子

使用中: `in`, `contains`（検索系: user/channel/message/role の search）, `OR`, `not`, `gt/lt`（履歴ページネーション・新着判定）, `startsWith` 相当なし。

- `contains: word` → `like(col, \`%${word}%\`)`。**LIKE のワイルドカード文字 `%` `_` はエスケープされない点は Prisma も同様だが、挙動差（大文字小文字）に注意: SQLite の LIKE は ASCII のみ case-insensitive。Prisma の SQLite `contains` も LIKE ベースなので実挙動は同じ。**
- `where: { id: { in: ids } }` → `inArray(col, ids)`。**`inArray` に空配列を渡すと SQL エラーになる版があるため、空配列時は早期 return（既存コードは channelIds.length === 0 チェックあり、他も確認）。**
- 複数条件のオブジェクト → `and(...)` を明示。`OR:` → `or(...)`。

## 3. include / ネスト select（最頻出・最大の書き換えポイント）

`include:` は message / channel / user / role service で多用。Drizzle の relational query API で置き換える:

```ts
// Prisma
db.message.findUnique({ where: { id }, include: { MessageUrlPreview: true, MessageFileAttached: true } })
// Drizzle
db.query.messages.findFirst({ where: eq(messages.id, id), with: { MessageUrlPreview: true, MessageFileAttached: true } })
```

- **リレーション名を Prisma と同じ大文字始まり（`MessageUrlPreview` 等）で relations() に定義すれば、レスポンス JSON の形が保たれる。** フロントエンドが `msg.MessageUrlPreview` 等のキー名に依存しているため、リレーションのプロパティ名変更は API 破壊になる。維持すること。
- ネストの `orderBy` / `take` / `select` 付き include（履歴取得等）→ `with: { X: { orderBy: ..., limit: ..., columns: ... } }`。
- `include` 内の `where` 付き → `with: { X: { where: ... } }`。

## 4. select（カラム絞り込み）

`select: { id: true, name: true }` → relational API では `columns: { id: true, name: true }`、select builder では `db.select({ id: users.id, ... })`。
**password / salt / token を返さないための select が User 系に多い。書き換え時に絞り込みを落とすと情報漏洩になる。移行後、`/user/info` `/user/list` 等のレスポンスに password が含まれないことを必ず確認。**

## 5. orderBy / take / skip（ページネーション）

- `orderBy: { createdAt: "desc" }` → `orderBy: desc(messages.createdAt)`（relational API は `orderBy: (t, { desc }) => desc(t.createdAt)` 形式も可）
- `take` → `limit`, `skip` → `offset`
- メッセージ履歴 (`/channel/get-history`) はカーソル的に `createdAt` の gt/lt + take を使用。ロジック同一に移植。

## 6. groupBy + _max（message.service.ts:51）

```ts
// Prisma
db.message.groupBy({ by: ["channelId"], where: {...}, _max: { createdAt: true } })
// Drizzle
db.select({
  channelId: messages.channelId,
  maxCreatedAt: max(messages.createdAt),
}).from(messages).where(inArray(messages.channelId, channelIds)).groupBy(messages.channelId)
```

**注意: `max(integer timestamp_ms)` の戻りは Drizzle では `Date` にならない場合がある（集約はカラム mode を通らない）。戻り値を `new Date(n)` 変換するか `.mapWith()` を使う。既存コードは `.valueOf()` 比較なので数値のままでも比較可能だが型を合わせること。**

## 7. ネスト書き込み（要分解）

Prisma のネスト `createMany` を親 update 経由で行う箇所が2つ。Drizzle にネスト書き込みはないため**個別クエリ＋トランザクションに分解**:

1. [src/Middlewares.ts:336-348](../src/Middlewares.ts#L336-L348) — `db.message.update({ data: { MessageUrlPreview: { createMany } }, include: { MessageUrlPreview: true } })`
   → tx 内で `insert(messageUrlPreviews).values(...)` → その後 message + previews を再取得（WS 通知ペイロードに使うため include 相当の形で返す）。**isEdited 時にプレビュー0件でも update→通知する分岐があるので挙動を変えないこと。**
2. [src/components/Channel/channel.service.ts:610-623](../src/components/Channel/channel.service.ts#L610-L623) — `channel.update({ data: { ChannelViewableRole: { createMany } } })`
   → 直前の `deleteMany` と合わせて 1 トランザクションに（現状は delete と insert が別々で、間に失敗すると閲覧ロールが消えたままになる。移行時に tx 化して改善可）。

## 8. トランザクション

- 配列形式 `db.$transaction([q1, q2, q3, q4])` が channel 削除 ([channel.service.ts:729](../src/components/Channel/channel.service.ts#L729)) で使用。
  → `db.transaction((tx) => { tx.delete(...).run(); ... })` に置き換え。
- **`drizzle-orm/bun-sqlite` は同期ドライバ。`db.transaction()` のコールバックは同期実行され、内部で `await`（別テーブルの async 処理など）を挟めない。** DB 操作のみを tx 内に置き、WS 通知等の副作用は tx 完了後に行う（既存コードもその構造なので大きな変更は不要）。
- 同期ドライバのため libsql のような `db.batch()` はないが、tx で同等。並行性は Bun プロセス内で直列化されるので Prisma 時代の SQLite ロック問題はむしろ起きにくい。

## 9. 型と null 戻り

- `findUnique` / `findFirst` は該当なしで `null`。Drizzle の `findFirst` は `undefined`。**`=== null` 比較や `!== null` ガードが多数あるため、`?? null` で揃えるか比較を truthy 判定に統一する。ここが最も見落としやすいバグ源。**
- `update` / `delete` は Prisma では対象なしで**例外 (P2025)**、Drizzle では**無言で0行**。「存在しない ID を update → 404 を返す」ロジックが Prisma 例外 or 事前 findUnique のどちらに依存しているか、書き換え時に各箇所確認。catch で P2025 を拾っている箇所があれば戻り行数チェックに置換。

## 10. その他

- `db.$disconnect()`（seeds.ts）→ `bun:sqlite` の `sqlite.close()`。
- **同期/非同期の差:** Prisma は全操作が Promise。`drizzle-orm/bun-sqlite` は同期だが、Drizzle のクエリは thenable なので既存の `await` を付けたままでも動く。書き換え時に `await` を機械的に剥がす必要はない（残してよい）。
- Elysia ルート定義（*.module.ts）内の直接 db 呼び出しも数箇所あり（user.module.ts, message.module.ts）。service だけ見て漏らさないこと。
- `src/ws.ts` にも db 呼び出しあり（接続時のチャンネル購読用）。
