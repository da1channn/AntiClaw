# AntiClaw → Antigravity 引き継ぎドキュメント

> **AntiClaw** = モバイルからAntigravity IDEを操作するゲートウェイ。
> ベッドの中からスマホでタスク指示 → AIチームが設計・実装・テスト・レビュー → 承認してコミット。

---

## 1. 全体アーキテクチャ

```
┌────────────────────────────────┐
│         ユーザー (スマホ)        │
│     Next.js PWA + Zustand      │
└──────────────┬─────────────────┘
               │ WebSocket (JWT認証)
               │
┌──────────────▼─────────────────────────────────────┐
│              AntiClaw Server (Express)               │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │         Cloudflare Access Middleware             │ │
│  │    JWT検証 → ユーザー特定 → セッション管理      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Agent        │  │ Team         │  │ Git       │  │
│  │ Orchestrator │  │ Orchestrator │  │ Bridge    │  │
│  │ (チャット)    │  │ (パイプライン) │  │ (コミット) │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                 │        │
│  ┌──────▼─────────────────▼──┐              │        │
│  │     GeminiRunner ×N       │              │        │
│  │   (CLIラッパー/ストリーム)  │              │        │
│  └───────────────────────────┘              │        │
│                                             │        │
│  ┌──────────────┐  ┌───────────────────┐    │        │
│  │ CDP Bridge   │  │ code-server Proxy │    │        │
│  │ (IDE操作)    │  │ (ブラウザエディタ) │    │        │
│  └──────┬───────┘  └────────┬──────────┘    │        │
└─────────┼──────────────────┼────────────────┼────────┘
          │                  │                │
   ┌──────▼──────┐   ┌──────▼──────┐   ┌─────▼─────┐
   │ Antigravity │   │ code-server │   │  git CLI  │
   │ IDE :9222   │   │   :8080     │   │           │
   └─────────────┘   └─────────────┘   └───────────┘
```

---

## 2. ディレクトリ構成

```
src/
├── shared/
│   └── types.ts              # クライアント・サーバー共通型定義
├── server/
│   ├── index.ts              # エントリーポイント (Express + WS + ルーティング)
│   ├── auth/
│   │   └── cloudflare-access.ts  # Cloudflare Access JWT検証
│   ├── agents/
│   │   ├── gemini-runner.ts      # Gemini CLIラッパー (ストリーミング)
│   │   ├── orchestrator.ts       # エージェント管理 (チャットモード)
│   │   └── team-orchestrator.ts  # パイプライン管理 (Bed-to-Commit)
│   ├── git/
│   │   └── git-bridge.ts        # 安全なgit操作 (HMAC承認トークン)
│   └── antigravity/
│       ├── cdp-bridge.ts        # CDP経由でAntigravity IDE操作
│       └── code-server-proxy.ts # code-serverへのリバースプロキシ
└── client/
    ├── app/
    │   ├── layout.tsx           # ルートレイアウト (PWAメタ)
    │   ├── page.tsx             # メインダッシュボード
    │   └── globals.css          # グローバルスタイル
    ├── components/
    │   ├── Header.tsx           # ヘッダー (接続状態/アクティブエージェント)
    │   ├── ViewSwitcher.tsx     # タブ切替 (Agents/Commit/IDE/Editor)
    │   ├── AgentSidebar.tsx     # エージェント一覧 (モバイル: スライドイン)
    │   ├── AgentCreator.tsx     # エージェント作成フォーム
    │   ├── ChatView.tsx         # チャット表示 (マークダウン/ストリーミング)
    │   ├── MessageInput.tsx     # メッセージ入力
    │   ├── CommitBridge.tsx     # パイプラインUI + コミット承認
    │   ├── IDEMonitor.tsx       # Antigravity IDEライブモニター
    │   ├── ErrorBoundary.tsx    # Reactエラーキャッチ
    │   └── StatusOverlays.tsx   # エラートースト + 接続切断バナー
    ├── lib/
    │   └── store.ts             # Zustand状態管理 (WS接続/セッション/UI)
    └── public/
        ├── manifest.json        # PWAマニフェスト
        └── icon-192.svg         # アプリアイコン
```

---

## 3. 主要フロー詳細

### 3.1 認証フロー (Cloudflare Access)

```
ブラウザ → Cloudflare Access (SSO) → JWT発行
    → AntiClaw: Cf-Access-Jwt-Assertion ヘッダー or CF_Authorization Cookie
    → JWKSで公開鍵取得 → JWT署名検証 + audience/issuer確認
    → req.user にユーザー情報セット
```

- **開発モード**: `CF_POLICY_BYPASS=true` → SSO不要、モックユーザー `dev@localhost`
- **本番**: `CF_POLICY_BYPASS=true` + `NODE_ENV=production` → 起動エラー (安全措置)
- **実装**: `src/server/auth/cloudflare-access.ts`

### 3.2 エージェントチャット

```
ユーザー → sendMessage(agentId, content)
    → AgentOrchestrator.sendMessage()
    → GeminiRunner.execute(prompt)  [Gemini CLIをspawn]
    → ストリーミング: EventEmitter("stream") → WS broadcast
    → 完了: レスポンスからArtifact(コードブロック)抽出
    → セッションに保存
```

- 1セッション最大4エージェント同時
- ロール: `architect` / `frontend` / `backend` / `tester` / `reviewer` / `devops` / `general`
- 各ロールに専用システムプロンプト
- **実装**: `orchestrator.ts` + `gemini-runner.ts`

### 3.3 Bed-to-Commit パイプライン (コア機能)

```
ユーザーがタスク入力
    ↓
┌─────────────────────────────────────────────┐
│ Stage 0: Architect (設計)                    │
│ → タスク分析、ファイル変更計画、セキュリティ考慮 │
└──────────────────┬──────────────────────────┘
                   ↓ (出力を次ステージに渡す)
┌──────────────────┴──────────────────────────┐
│ Stage 1a: Frontend Dev  ┃ Stage 1b: Backend │ ← 並列実行
│ → フロントエンド実装     ┃ → バックエンド実装  │
└──────────────────┬──────────────────────────┘
                   ↓
┌──────────────────┴──────────────────────────┐
│ Stage 2: Tester (テスト)                     │
│ → 正確性、エッジケース、脆弱性チェック         │
└──────────────────┬──────────────────────────┘
                   ↓
┌──────────────────┴──────────────────────────┐
│ Stage 3: Reviewer (レビュー)                  │
│ → コード品質、OWASP Top 10、コミットメッセージ提案 │
└──────────────────┬──────────────────────────┘
                   ↓
        status = "awaiting_approval"
        HMAC承認トークン生成 (10分有効)
                   ↓
        ユーザーがスマホで差分確認 → 承認/拒否
                   ↓ (承認)
┌──────────────────┴──────────────────────────┐
│ GitBridge.executeCommit()                    │
│ → トークン検証 → パス検証 → ファイル書込      │
│ → git add → git commit → (push)             │
└─────────────────────────────────────────────┘
```

- 各ステージの出力はリアルタイムストリーミング
- ファイル変更はコードブロック内のアノテーションで検出:
  ```
  ```typescript
  // file: src/components/Button.tsx
  <ファイル全体>
  ```
  ```
- **実装**: `team-orchestrator.ts` + `git-bridge.ts`

### 3.4 CDP Bridge (IDE操作)

```
AntiClaw → HTTP GET http://CDP_HOST:CDP_PORT/json → ターゲット一覧
    → Antigravityのワークベンチウィンドウ検出
    → CDP WebSocket接続
    → 2秒ごとにRuntime.evaluate()でDOM状態ポーリング
        → チャットメッセージ、モデル、生成状態を取得
    → メッセージ送信: DOMのinputに値セット → Enterキー発火
    → 生成停止: stopボタンをクリック
```

- **ターゲット検出**: title に "Antigravity"/"workbench"/"Visual Studio Code" を含むもの
- **自動再接続**: 指数バックオフ (1s〜60s + ジッター)
- **実装**: `cdp-bridge.ts`

---

## 4. WebSocket プロトコル

### クライアント → サーバー

| type | 用途 | パラメータ |
|------|------|-----------|
| `send_message` | エージェントにメッセージ | `agentId`, `content` |
| `create_agent` | エージェント作成 | `role`, `model?` |
| `stop_agent` | エージェント停止 | `agentId` |
| `delete_agent` | エージェント削除 | `agentId` |
| `ide_send_message` | IDEにメッセージ | `content` |
| `ide_stop_generation` | IDE生成停止 | - |
| `ide_request_state` | IDE状態取得 | - |
| `pipeline_start` | パイプライン開始 | `task`, `model?` |
| `pipeline_cancel` | パイプライン中止 | `pipelineId` |
| `commit_approve` | コミット承認 | `pipelineId`, `approvalToken`, `message?`, `push?` |
| `commit_reject` | コミット拒否 | `pipelineId` |
| `git_status_request` | Git状態取得 | - |
| `diff_request` | 差分プレビュー | `pipelineId` |

### サーバー → クライアント

| type | 用途 | データ |
|------|------|--------|
| `session_sync` | 初期セッション同期 | `session` |
| `agent_created` | エージェント作成通知 | `agent` |
| `agent_updated` | エージェント状態変更 | `agent` |
| `agent_deleted` | エージェント削除通知 | `agentId` |
| `message` | 新メッセージ | `message` |
| `message_stream` | ストリーミング | `agentId`, `chunk`, `messageId` |
| `message_stream_end` | ストリーム完了 | `agentId`, `messageId` |
| `ide_state` | IDE状態更新 | `state` |
| `pipeline_update` | パイプライン状態 | `pipeline` |
| `pipeline_stage_stream` | ステージ出力 | `pipelineId`, `stageId`, `chunk` |
| `commit_ready` | 承認待ち | `pipeline` |
| `commit_result` | コミット完了 | `pipelineId`, `result` |
| `git_status` | Git状態 | `status` |
| `diff_response` | 差分 | `pipelineId`, `diff` |
| `error` | エラー | `error`, `agentId?` |

---

## 5. セキュリティ実装

| 対策 | 内容 | 場所 |
|------|------|------|
| **認証** | Cloudflare Access JWT (JWKS検証) | `cloudflare-access.ts` |
| **承認トークン** | HMAC-SHA256署名、パイプラインID紐付け、10分TTL | `git-bridge.ts` |
| **タイミング攻撃防止** | `crypto.timingSafeEqual()` | `git-bridge.ts` |
| **パス検証** | `..`禁止、絶対パス禁止、隠しファイル禁止、実行ファイル禁止 | `git-bridge.ts` |
| **ブランチ制限** | ホワイトリスト + globパターン | `git-bridge.ts` |
| **コマンドインジェクション防止** | `execFile`使用 (shell=false) | `git-bridge.ts` |
| **XSS防止** | HTMLエスケープ後にマークダウン変換 | `ChatView.tsx` |
| **入力サイズ制限** | `express.json({ limit: "64kb" })`, WS `maxPayload: 64KB` | `index.ts` |
| **レート制限** | 20コミット/時/ユーザー | `git-bridge.ts` |
| **モデルホワイトリスト** | `ALLOWED_MODELS`環境変数 | `orchestrator.ts` |
| **ロール検証** | 7ロール固定セット | `orchestrator.ts` |
| **メール検証** | 正規表現バリデーション | `git-bridge.ts` |
| **メッセージサニタイズ** | 非ASCII除去 (日本語除く)、500字制限 | `git-bridge.ts` |
| **監査ログ** | 全git操作を記録 (直近1000件) | `git-bridge.ts` |
| **本番ガード** | `CF_POLICY_BYPASS=true` + `production` → 起動拒否 | `index.ts` |

---

## 6. 環境変数一覧

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `3000` | サーバーポート |
| `NODE_ENV` | `development` | 環境 |
| `CF_TEAM_DOMAIN` | (必須) | Cloudflare Accessチームドメイン |
| `CF_APP_AUD` | (必須) | Cloudflare Accessアプリオーディエンス |
| `CF_POLICY_BYPASS` | `false` | 開発時SSO無効化 |
| `GEMINI_API_KEY` | (必須) | Google Gemini APIキー |
| `GEMINI_MODEL` | `gemini-3-pro` | デフォルトモデル |
| `GEMINI_CLI_PATH` | `gemini` | Gemini CLIパス |
| `ALLOWED_MODELS` | `gemini-3-pro,gemini-3-flash,gemini-2.5-pro` | 許可モデル |
| `MAX_CONCURRENT_AGENTS` | `4` | 最大同時エージェント数 |
| `AGENT_TIMEOUT_MS` | `300000` | エージェント実行タイムアウト (5分) |
| `CDP_HOST` | `127.0.0.1` | Antigravity IDEホスト |
| `CDP_PORT` | `9222` | Antigravity IDEデバッグポート |
| `POLL_INTERVAL_MS` | `2000` | IDE状態ポーリング間隔 |
| `CODE_SERVER_URL` | `http://127.0.0.1:8080` | code-server URL |
| `WORKSPACE_PATH` | カレントディレクトリ | 共有ワークスペースパス |
| `PIPELINE_TIMEOUT_MS` | `600000` | パイプラインタイムアウト (10分) |
| `ALLOWED_BRANCHES` | `main,master,develop,feature/*` | 許可ブランチ |
| `APPROVAL_TTL_MS` | `600000` | 承認トークン有効期間 (10分) |
| `HMAC_SECRET` | (自動生成) | 承認トークン署名鍵 |
| `MAX_COMMITS_PER_HOUR` | `20` | ユーザーごとの時間あたりコミット上限 |
| `CF_TUNNEL_TOKEN` | (任意) | Cloudflare Tunnelトークン |

---

## 7. REST API 一覧

| Method | Path | 認証 | 用途 |
|--------|------|------|------|
| `GET` | `/api/health` | 不要 | ヘルスチェック |
| `GET` | `/api/session` | 必要 | セッション取得/作成 |
| `POST` | `/api/agents` | 必要 | エージェント作成 |
| `DELETE` | `/api/agents/:agentId` | 必要 | エージェント削除 |
| `GET` | `/api/ide/state` | 必要 | IDE状態取得 |
| `POST` | `/api/ide/message` | 必要 | IDEにメッセージ送信 |
| `POST` | `/api/ide/stop` | 必要 | IDE生成停止 |
| `GET` | `/api/git/status` | 必要 | Git状態取得 |
| `POST` | `/api/pipeline/start` | 必要 | パイプライン開始 |
| `POST` | `/api/pipeline/:id/cancel` | 必要 | パイプラインキャンセル |
| `POST` | `/api/pipeline/:id/commit` | 必要 | コミット承認・実行 |
| `GET` | `/api/git/audit` | 必要 | 監査ログ取得 |
| `GET` | `/api/code/*` | 必要 | code-serverプロキシ |

---

## 8. 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | Next.js 15, React 19, TypeScript, Zustand, Tailwind CSS |
| **バックエンド** | Node.js 22, Express 4, TypeScript, ws (WebSocket) |
| **認証** | Cloudflare Access, JWT/JWKS, jsonwebtoken, jwks-rsa |
| **AI** | Google Gemini CLI (spawn), ストリーミング出力 |
| **IDE連携** | Chrome DevTools Protocol (WebSocket), DOM状態ポーリング |
| **Git** | Node.js `child_process.execFile`, HMAC承認トークン |
| **インフラ** | Docker, Docker Compose, Cloudflare Tunnel |
| **エディタ** | code-server (http-proxy-middleware経由) |

---

## 9. 設計パターン

### イベント駆動アーキテクチャ
- Orchestratorがコールバック関数を公開
- 状態変更時にコールバック発火 → WebSocket全クライアントにブロードキャスト
- リアルタイムストリーミングUI更新を実現

### パイプラインパターン
- 順次実行 (一部並列)、各ステージにコンテキスト伝搬
- 後段のステージは前段の出力を全て受け取る
- 同一ファイルへの変更は後段が優先

### トークンベース承認
- HMAC-SHA256署名、パイプラインID紐付け、TTL付き
- タイミングセーフ比較でサイドチャネル攻撃防止
- ユーザーが明示的に承認しない限りコミットされない

### セッションベース状態
- メールアドレスでユーザー特定 → 1ユーザー1セッション
- 複数WebSocket接続が同一セッションを共有
- 再接続してもセッション状態は保持

---

## 10. デプロイ

### 開発環境

```bash
cp .env.example .env
# .env を編集 (GEMINI_API_KEY, CF_POLICY_BYPASS=true)
npm install
npm run dev
```

### Docker Compose

```bash
docker compose up -d
# anticlaw:3000, code-server:8080, cloudflared
```

### 本番環境

1. Cloudflare Accessでアプリ登録 → `CF_TEAM_DOMAIN`, `CF_APP_AUD` 取得
2. Cloudflare Tunnel作成 → `CF_TUNNEL_TOKEN` 取得
3. `.env` に本番設定
4. `docker compose -f docker-compose.yml up -d`
5. Antigravityを `--remote-debugging-port=9222` で起動

---

## 11. Antigravityへの統合ポイント

### 現在のAntiClaw → Antigravityの接続点

| 接続点 | 方式 | 説明 |
|--------|------|------|
| **CDP Bridge** | WebSocket (CDP) | Antigravityのデバッグポートに接続し、DOMを操作してチャット送受信 |
| **code-server Proxy** | HTTP Proxy | Antigravityと同じワークスペースをcode-serverで共有 |
| **Git Bridge** | CLI (`execFile`) | 同一ワークスペースのgitを操作 |

### 統合時の検討事項

1. **CDP Bridgeの置き換え**: DOM操作は脆弱。AntigravityにネイティブAPI (WebSocket/REST) を追加すれば、より安定的に連携可能
2. **認証の統一**: AntigravityのユーザーシステムとCloudflare Accessの統合
3. **ワークスペース共有**: 現在はファイルシステムレベルで共有。ファイルロックやコンフリクト検出は未実装
4. **Gemini → Antigravity内蔵AI**: パイプラインのGeminiRunnerをAntigravityのAI機能に差し替え可能

---

## 12. 既知の制限事項

| 項目 | 現状 | 改善案 |
|------|------|--------|
| **セッション永続化** | メモリ内のみ (再起動で消失) | Redis/SQLite |
| **ファイルロック** | なし (競合状態あり) | ファイルレベルロック |
| **テスト** | E2Eテストなし | Playwright追加 |
| **Service Worker** | 未実装 (オフラインキャッシュなし) | next-pwa |
| **CDP安定性** | DOM構造変更で壊れる | ネイティブAPI |
| **マルチユーザー** | セッション分離のみ (リソース共有) | ワークスペース分離 |
| **監査ログ** | メモリ内1000件 | 永続化 (DB) |

---

## 13. コミット履歴

```
475143f fix: comprehensive security, stability, and UX hardening (12 fixes)
786aa54 fix: resolve 7 critical issues for reliable mobile usage
5e38efd feat: add bed-to-commit bridge - team pipeline with secure git operations
94e6111 fix: share workspace between code-server and host Antigravity IDE
c9080d9 fix: resolve 5 bugs found in codebase review
76fe4a1 feat: integrate hybrid architecture - IDE monitor, code-server, Docker
639510a feat: add CDP bridge for Antigravity IDE and code-server proxy
af7c111 feat: initial AntiClaw project - mobile gateway for Antigravity with Cloudflare SSO
```
