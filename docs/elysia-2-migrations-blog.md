# Elysia 2.0 (beta) - DayDream まとめ

Elysia 2.0 (コードネーム: DayDream) 公式ブログ記事のAI参照用まとめ。

- Source: https://elysiajs.com/blog/elysia-20.html
- 対象バージョン: Elysia 2.0.0-beta (`elysia@next`)

---

## 1. 概要 (Overview)
- **コンセプト**: ゼロからの完全再構築 (Complete rewrite)。スループットだけでなくバンドルサイズ、起動時間、メモリ消費量を最重視。
- **背景**: State of JavaScript 2025 で 9th 最多利用 JS バックエンドフレームワーク選出。実運用フィードバック反映。
- **移行**:
  - 自動: `bunx @elysia/codemod@latest`
  - 手動: `bun add elysia@next`

---

## 2. パフォーマンス & リソース最適化 (Performance & Benchmarks)

### バンドルサイズ (Bundle Size)
- 1.4比 **50%以上削減**。
- **TypeBox ツリーシェイク対応**: 未使用時 TypeBox 完全除外。
- **AOT ビルドプラグイン併用**: Minified 時 **141KB** (Hono: 21KB, Express: 603KB, Fastify: 729KB)。
- フットプリントの約50%は Sucrose (静的コード解析) および AOT コンパイラ。

### 起動時間 (Startup Time)
- 1.4比 **30%以上高速化** (TypeBox利用時)。
- **25 ルート**: ~28ms
- **1,000 ルート**: ~43ms (TypeBox利用時、事前全コンパイル済み状態)
- サーバーレス / エッジ環境 (Cloudflare Workers, Vercel Edge) のコールドスタート削減に有効。

### メモリ消費量 (Memory Usage)
- ロードテスト前後のメモリ増加量 最小・高予測性。
  - Elysia 2: 37MB (Before) → 45.7MB (After)
  - Hono: 32.4MB → 73.9MB
  - Fastify: 98.5MB → 192.4MB
- **マルチプロセス / クラスタモード (10 workers)**:
  - Elysia 2: ~450 MB
  - Hono: ~740 MB
  - Fastify: ~2,100 MB

---

## 3. スキーマ & TypeBox 改善 (Schema & TypeBox)

- **TypeBox 1.3 対応**: (1.0 移行ガイド準拠必要)。
- **フィールド単位 Cookie スキーマ**: `cookie: t.Object({ a: t.Cookie(t.String(), { sign: true }) })`
- **`t.Accelerate` (Alpha)**: Standard JSON Schema を TypeBox Compiler に変換し最高性能化。
- **Ref:Rain (スキーマ参照共有)**:
  - プリミティブ型・パラメータ型参照共有。10万呼び出し時メモリ: 33.86MB (1.4) → 17.69MB (2.0)。
- **スキーマコンパイルキャッシュ**:
  - OpenAPI メタデータ (description/tags等) 無視し判定。
  - 10万ルートコンパイル時間: 174,603ms (1.4) → 310ms (2.0)。メモリ: 1.15GB → 228MB。

---

## 4. 事前コンパイル (AOT - Ahead of Time Compilation)

- **仕組み**: ハンドラ・スキーマのコンパイル処理をビルド時にオフロード。
- **対応ビルドツール**:
  - `elysia/plugin/aot/bun` (Bun.build)
  - `elysia/plugin/aot/vite` (Vite)
  - `elysia/plugin/aot/esbuild` (Esbuild)
  - `elysia/plugin/aot/rspack` (Rspack)
  - `elysia/plugin/aot/unplugin` (Rollup / Rolldown / Webpack / Farm)
- **利点**: 起動時・初回リクエスト時のコンパイルオーバーヘッド完全排除。ピークメモリ大幅低減。
- **注意点**:
  - **ビルド時ドライラン実行**: DBプール等の長寿命接続存在時、ビルド完了時 `process.exit(0)` 明示推奨。
  - **条件分岐制御**: `Manifest.isCapturing()` で AOT ドライラン時コード分岐可能。
  - **Cloudflare Workers**: `new Function` 不可のため AOT モード推奨。

---

## 5. アダプター & ランタイム (Adapter & Runtime)

- **Web Standard 準拠**: Request / Response ベース。Hono と同等のポータビリティ。
- **Adapter v2 (公開 API 化)**:
  - `import { createAdapter } from 'elysia/adapter'`
  - 文字列コード化廃止、全フィールド関数型安全化。
- **Node.js サポート (`@elysia/node`)**:
  - `srvx` (0.12) / `crossws` 採用。`FastResponse` による高速化 (Node環境: 93,845 req/s)。
  - **Node WebSocket 分離**: バンドル削減のため `@elysia/node/websocket` から別インポート。

---

## 6. Elysia 内部 API 高速化 (Faster Internal APIs)

- **10万ルート追加**: 7ms (Elysia 2) vs 23ms (Elysia 1.4) vs 172ms (Hono)
- **10万ルーター適用 (.use)**: 5ms vs 116ms vs 192ms
- **10万フック付きプラグイン適用**: 10ms vs 58ms vs 252,847ms

---

## 7. 新機能 (New Features)

### `defer`
- レスポンス送信後に実行されるクリーンアップ / 後処理用フック。`afterResponse` 後にキュー順実行。
```ts
new Elysia()
  .get('/', ({ defer }) => {
    const disconnect = connect()
    defer(() => { disconnect() })
  })
```

---

## 8. 破壊的変更 & 移行ガイド (Breaking Changes)

### 1. ルート引数順序変更 (Route Parameter Swap)
- スキーマ / フック定義をハンドラ**前**に配置。
```ts
// 2.0
app.post('/', { body: t.Object({ name: t.String() }) }, (ctx) => {})
```

### 2. Lifecycle イベント名 `on` プレフィックス削除
| 旧 (1.x) | 新 (2.0) |
|---|---|
| `onRequest` | `request` |
| `onParse` | `parse` |
| `onTransform` | `transform` |
| `onBeforeHandle` | `beforeHandle` |
| `onAfterHandle` | `afterHandle` |
| `onAfterResponse` | `afterResponse` |
| `onError` | `error` |
| `onStart` | `setup` |
| `onStop` | `cleanup` |

### 3. エラーハンドリング刷新 (Error Handling)
- エラーコード (`code`) 廃止。Error クラス直接指定 API へ移行。
```ts
// 2.0
import { NotFound, ValidationError } from 'elysia'

new Elysia()
  .error(MyCustomError, ({ error }) => { /* ... */ })
  .error(NotFound, () => { /* ... */ })
```
- **Eden 型推論向上**: レスポンス型にエラー型が正しく伝播。
- **RFC 9457 (Problem Details)** 準拠:
  - デフォルトエラーレスポンス形式が `application/problem+json` に変更。
  - `problem(statusCode, { detail: '...' })` ヘルパー追加。
- **`NODE_ENV=production`**: 未ハンドルの 500 エラーメッセージ隠蔽 (`Internal Server Error` 固定)。

### 4. Macro API 簡略化
- `.macro(name, definition)` 削除。オブジェクト形式 `.macro({ auth: { ... } })` に統一。

### 5. WebSocket API 変更
- オプトイン化: `.use(websocket())` 明示追加。
- ジェネレータ関数 / `yield` 推奨 (型安全なメッセージ送信)。
- 引数順: `.ws('/path', options, handler)`
- `ws.data` が `ws` 直下にインライン化。

### 6. `resolve` の `derive` 統合
- 旧 `resolve` (beforeHandle で実行) を新 `derive` に統合。旧 `resolve` 削除。
```ts
// 2.0
app.derive(({ headers }) => ({ user: auth(headers) }))
```

### 7. `'scoped'` → `'plugin'` 名称変更
- `app.beforeHandle('plugin', fn)` / `app.as('plugin')`
- `{ as: 'scoped' }` オブジェクト形式削除。

### 8. Guard / Group のデフォルト挙動
- デフォルトで **`override`** (上位スキーマを置換)。
- スキーマ結合・独立追加の場合 `schema: 'standalone'` 明記必須。

### 9. 非推奨機能・デフォルト除去
- **`aot: false` (Dynamic mode)** 完全削除。
- **`file-type` パッケージデフォルト除外**: `t.File` / `t.Files` 判定用。使用時 `setFileTypeDetector(fileTypeFromFile)` 明示設定。

---

## 9. まとめ・現状の評価 (Status & Recommendation)

- **テスト拡充**: ユニットテスト expect 数 2,800 → 10,000+。
- **Codemod 補完率**: 公式・コミュニティプラグインの ~95% を自動移行可能。
- **Beta ラベル理由**: 主要エコシステムプラグインの Elysia 2.0 対応期間確保のため。
- **アップグレード推奨度**:
  - クラスタ運用 / Cloudflare Workers / メモリ削減目的のプロジェクトは早期導入有効。
  - 依存プラグインの 2.0 対応状況を確認のうえ移行推奨。
