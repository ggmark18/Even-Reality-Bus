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

## 環境変数による開発・本番の切り替え

ソースコードを変更せず、`.env` ファイルだけで開発・本番を切り替えます。

### ファイル構成

| ファイル | コミット | 用途 |
|---|---|---|
| `plugin/.env` | ✅ | プラグイン開発デフォルト（localhost・認証なし） |
| `plugin/.env.production.local` | ❌ | プラグイン本番値（実際のURL・認証情報） |
| `server/.env.example` | ✅ | サーバー設定テンプレート |
| `server/.env` | ❌ | サーバー実際の値（ローカル・EC2それぞれに配置） |

### プラグイン（Vite）

`plugin/.env`（開発用・コミット済み）:
```env
VITE_API_BASE=http://localhost:3000
VITE_AUTH_USER=
VITE_AUTH_PASS=
```

`plugin/.env.production.local`（本番用・gitignore対象）:
```env
VITE_API_BASE=https://YOUR_DOMAIN/bus
VITE_AUTH_USER=YOUR_USERNAME
VITE_AUTH_PASS=YOUR_PASSWORD
```

`npm run dev` は `.env`（開発用）を、`npm run build` は `.env.production.local`（本番用）を自動的に読み込みます。

### Web画面（index.html）

`server/.env`（ローカル開発用）:
```env
AUTH_USER=
AUTH_PASS=
```

サーバーが起動時に `.env` を読み込み、`/config.js` エンドポイントで認証情報を動的生成します。`index.html` はこの `config.js` を読み込むため、ソースコードの変更は不要です。

EC2本番環境では `server/.env.example` をコピーして値を設定します：
```bash
cp .env.example .env
nano .env   # 実際の値を入力
pm2 restart buscheck-gateway
```

---

## 1. サーバーをローカルで起動

```bash
cd server
npm install   # 初回のみ（dotenv 等を含む）
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
npm install   # 初回のみ
npm run dev
# → http://localhost:5173 で起動（.env を自動読み込み）
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

`server/.env` の `AUTH_USER` が空の場合、認証ヘッダーなしで動作します。

---

## 4. プラグインのビルドと実機テスト

`plugin/.env.production.local` に本番の値を設定した上でビルドします：

```bash
cd plugin
npm run build
# → .env.production.local を読み込んで dist/ にビルド
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
| `GET /config.js` | 認証設定（環境変数から動的生成） |
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
BusCheck/
├── plugin/
│   ├── .env                   # 開発デフォルト（コミット済み）
│   ├── .env.production.local  # 本番値（gitignore対象・各自で作成）
│   ├── src/
│   │   └── main.ts            # Even Hub プラグイン本体
│   │                          # import.meta.env で環境変数を参照
│   └── app.json               # パッケージ設定・ネットワーク許可リスト
└── server/
    ├── .env                   # 実際の値（gitignore対象）
    ├── .env.example           # 設定テンプレート（コミット済み）
    ├── gateway.js             # 常駐プロセス（本番用・ポート3000）
    ├── server.js              # Express サーバー（ポート3001 or 3000）
    │                          # dotenv で .env を読み込み
    │                          # /config.js で認証情報を動的提供
    ├── scraper.js             # Puppeteer スクレイパー
    └── public/
        └── index.html         # スマートフォン用Web画面
                               # <script src="config.js"> で認証情報を取得
```
