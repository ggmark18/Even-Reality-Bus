# BusCheck

**Even G2 スマートグラスと スマートフォンで、リアルタイムにバスの運行状況を確認するアプリケーションです。**

東洋バス「ゆりのき台第三 → 八千代中央駅」の次のバス時刻・遅延情報・停留所通過状況を、グラスのHUD表示とスマートフォンのWeb画面の両方で確認できます。

---

## 特徴

- **Even G2 グラス表示** — 次のバスの予定時刻・予測時刻・残り分数・停留所通過情報をHUDに表示
- **スマートフォン Web画面** — ブラウザからいつでも確認。30秒ごとに自動更新
- **リアルタイム時計** — 秒単位の現在時刻を常時表示
- **オンデマンド起動** — スクレイパーサーバーはリクエスト時のみ起動し、1時間無通信で自動終了（EC2コスト削減）
- **Basic認証** — ApacheのBasic認証でWebとプラグイン両方のアクセスを保護

---

## システム構成

```
Even G2 グラス
    ↕ Bluetooth
スマートフォン（Even Hub WebView）
    ↕ HTTPS（Wi-Fi / モバイルデータ）
Apache（リバースプロキシ + Basic認証）
    ↕ localhost:3000
AWS EC2 — gateway.js（常駐・軽量）
    ↕ オンデマンド起動
AWS EC2 — server.js（Puppeteer・1時間で自動終了）
    ↕ Headless Chrome
東洋バス bus-navigation.jp
```

---

## リポジトリ構成

```
BusCheck/
├── plugin/           # Even Hub プラグイン（Vite + TypeScript）
│   ├── src/main.ts   # プラグイン本体
│   └── app.json      # パッケージ設定・ネットワーク許可リスト
└── server/           # EC2サーバー（Node.js）
    ├── gateway.js    # 常駐プロセス（ポート3000）
    ├── server.js     # Puppeteerワーカー（ポート3001）
    ├── scraper.js    # 東洋バスサイトのスクレイパー
    └── public/
        └── index.html  # スマートフォン用Web画面
```

---

## セットアップ手順

### 1. EC2サーバーのセットアップ

#### 1-1. 必要パッケージのインストール

**Ubuntu 22.04 の場合:**
```bash
# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Chromium と依存ライブラリ
sudo apt-get install -y chromium-browser \
  libgbm-dev libasound2 libxss1 libxtst6 \
  libxrandr2 libxcomposite1 libxdamage1 libxfixes3

# PM2
sudo npm install -g pm2
```

**Amazon Linux 2 の場合:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs chromium
sudo npm install -g pm2
```

#### 1-2. サーバーコードをデプロイ

```bash
# ローカルから EC2 へ転送
scp -r ./server/* ec2-user@YOUR_EC2_IP:~/buscheck/

# EC2上で依存パッケージをインストール
ssh ec2-user@YOUR_EC2_IP
cd ~/buscheck && npm install
```

#### 1-3. PM2でゲートウェイを起動・常駐化

```bash
cd ~/buscheck
pm2 start gateway.js --name buscheck-gateway
pm2 startup   # 表示されたコマンドを実行
pm2 save
```

#### 1-4. 動作確認

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/bus
```

---

### 2. Apache の設定（リバースプロキシ + Basic認証）

```bash
# モジュール有効化
sudo a2enmod proxy proxy_http
sudo systemctl restart apache2
```

```apache
<VirtualHost *:443>
    ServerName YOUR_DOMAIN

    # Basic認証（Web・プラグイン共通）
    <Location /bus/>
        AuthType Basic
        AuthName "BusCheck"
        AuthUserFile /etc/apache2/.htpasswd
        Require valid-user
    </Location>

    # 静的ファイルを直接配信
    Alias /bus /home/bus/server/public
    <Directory /home/bus/server/public>
        Require all granted
    </Directory>

    # APIのみプロキシ（Aliasより前に記述）
    ProxyPass        /bus/api/ http://localhost:3000/api/
    ProxyPassReverse /bus/api/ http://localhost:3000/api/
</VirtualHost>
```

```bash
# ユーザー作成
htpasswd -c /etc/apache2/.htpasswd YOUR_USERNAME
```

#### EC2 セキュリティグループ

- ポート **443**（HTTPS）: 開放
- ポート **3000**: **削除**（外部から直接アクセス不可にする）

---

### 3. 認証情報・URLの設定

**`plugin/.env`（プラグイン用・ビルド時に埋め込まれる）:**
```
VITE_API_BASE=https://YOUR_DOMAIN/bus
VITE_AUTH_USER=YOUR_USERNAME
VITE_AUTH_PASS=YOUR_PASSWORD
```

**`plugin/app.json` のホワイトリスト:**
```json
"whitelist": ["https://YOUR_DOMAIN"]
```

**`server/.env`（サーバー用・実行時に読み込まれる）:**
```
AUTH_USER=YOUR_USERNAME
AUTH_PASS=YOUR_PASSWORD
```

---

### 4. Even Hub プラグインのビルドと実行

#### ローカル開発（シミュレーター）

```bash
cd plugin
npm install
npm run dev          # Viteサーバー起動（localhost:5173）
```

#### ビルドとパッケージング

```bash
cd plugin
npm run build        # dist/ を生成
npm run pack         # buscheck.ehpk を生成
```

#### 実機インストール（Even Hub ポータル経由）

1. [https://hub.evenrealities.com/hub](https://hub.evenrealities.com/hub) にアクセスしてログイン
2. `buscheck.ehpk` をアップロード
3. iPhone の Even Realities アプリに自動的に反映される

アップロード後は Even Realities アプリの Even Hub タブからアプリを起動できます。

#### 一般公開

同じポータルから公開申請を行うと、すべての G2 ユーザーが Even Hub ストアからインストールできるようになります。

---

## 操作方法

### Even G2 グラス / R1 リング

| 操作 | 動作 |
|---|---|
| アプリ起動 | 自動でバス情報を取得・表示 |
| シングルプレス | バス情報を再取得（キャッシュ使用） |
| ダブルプレス | バス情報を強制再取得（最新） |
| スワイプ上下 | 画面スクロール |
| バックグラウンド移動 | 自動更新を停止 |
| フォアグラウンド復帰 | 自動でバス情報を再取得 |

自動更新: **15秒**ごと

### Web画面

| 操作 | 動作 |
|---|---|
| ブラウザでアクセス | `https://YOUR_DOMAIN/bus/` |
| ダブルタップ | 強制再取得 |

自動更新: **30秒**ごと

---

## デバッグ

```bash
# スクレイピング生データの確認
curl -u YOUR_USERNAME:YOUR_PASSWORD \
  https://YOUR_DOMAIN/bus/api/debug | python3 -m json.tool

# PM2 管理
pm2 logs buscheck-gateway   # ログ確認
pm2 restart buscheck-gateway # 再起動
pm2 stop buscheck-gateway    # 停止
```
