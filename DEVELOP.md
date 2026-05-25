# BusCheck 開発ガイド

ローカル環境での開発・動作確認手順をまとめます。

---

## 前提条件

- Node.js 20.x 以上
- npm 10.x 以上
- Even Hub CLI（プラグインシミュレーター用）

```bash
node -v   # v20.x.x
npm -v    # 10.x.x
evenhub --version
```

---

## ローカル設定（本番との切り替え）

ローカル開発時は `plugin/src/main.ts` の上部を以下に変更します：

```typescript
// ローカル開発用
const API_BASE  = 'http://localhost:3000';
const AUTH_USER = '';   // ローカルは認証不要
const AUTH_PASS = '';
```

> 本番デプロイ前に `https://YOUR_DOMAIN/bus` と認証情報に戻すことを忘れずに。

---

## 1. サーバーをローカルで起動

```bash
cd server
npm install
node server.js
```

起動確認：
```bash
# ヘルスチェック
curl http://localhost:3000/api/health

# バス情報の取得（スクレイピングが走るため数秒かかる）
curl http://localhost:3000/api/bus | python3 -m json.tool

# スクレイピング生データの確認（セレクタ調整時に使用）
curl http://localhost:3000/api/debug | python3 -m json.tool
```

> `server.js` を直接起動するとポート3000で動作します（gateway不要）。  
> EC2本番環境では `gateway.js` を経由しますが、ローカル開発では不要です。

---

## 2. プラグインをシミュレーターで動かす

ターミナルを2つ開いて実行します。

**ターミナル1 — Vite 開発サーバー:**
```bash
cd plugin
npm install
npm run dev
# → http://localhost:5173 で起動
```

**ターミナル2 — グラスシミュレーター:**
```bash
cd plugin
npx evenhub-simulator
# → シミュレーターウィンドウが起動
```

シミュレーターが起動したら Vite の URL（`http://localhost:5173`）を接続先として指定します。

### デバッグ（Safari Web Inspector）

シミュレーターの WebView ログは Chrome ではなく **Safari** で確認します：

1. Safari → 開発メニュー → シミュレーターの WebView を選択
2. コンソールタブで `[buscheck]` プレフィックスのログを確認

---

## 3. Web画面をローカルで確認

サーバーが起動している状態でブラウザからアクセス：

```
http://localhost:3000
```

ローカルでは Basic認証は不要です（`index.html` の `AUTH_USER` / `AUTH_PASS` が空でも動作します）。

---

## 4. プラグインのビルドと実機テスト

```bash
cd plugin
npm run build
```

**QRサイドロード（実機確認）:**
```bash
evenhub sideload dist
# QRコードが表示される → スマートフォンの Even Realities App でスキャン
```

**パッケージング（配布用）:**
```bash
npm run pack
# → plugin/buscheck.ehpk が生成される
```

---

## 5. APIエンドポイント一覧

| エンドポイント | 説明 |
|---|---|
| `GET /` | Web画面（index.html） |
| `GET /api/bus` | 次のバス一覧（60秒キャッシュ） |
| `GET /api/bus?refresh=1` | 強制再取得（キャッシュ無視） |
| `GET /api/health` | サーバー状態確認 |
| `GET /api/debug` | スクレイピング生データ（セレクタ調整用） |

---

## 6. スクレイパーの調整

バス情報が正しく取れない場合は `/api/debug` で HTML 構造を確認します：

```bash
curl http://localhost:3000/api/debug | python3 -m json.tool
```

確認ポイント：

| フィールド | 内容 |
|---|---|
| `debug.centerBoxHtml.children` | `div.center_box` の直下子要素の構造 |
| `debug.rawBuses` | `page.evaluate` が返した生データ |
| `debug.bodyPreview` | ページ全体のテキスト先頭500文字 |
| `buses` | 最終的に整形されたバスデータ |

`buses` が空の場合は `server/scraper.js` の `page.evaluate` 内のセレクタを調整してください。

---

## 7. ファイル構成と役割

```
server/
├── gateway.js    # 常駐プロセス（本番用・ポート3000）
│                 # リクエスト時に server.js を起動してプロキシ
├── server.js     # Express サーバー（ポート3001 or 3000）
│                 # /api/bus, /api/health, /api/debug を提供
│                 # 1時間無通信で自動終了（本番のみ）
├── scraper.js    # Puppeteer スクレイパー
│                 # div.center_box から時刻・停留所通過情報を抽出
└── public/
    └── index.html  # スマートフォン用Web画面

plugin/
├── src/
│   └── main.ts   # Even Hub プラグイン本体
│                 # API_BASE / AUTH_USER / AUTH_PASS を上部で設定
└── app.json      # パッケージ設定・ネットワーク許可リスト（whitelist）
```
