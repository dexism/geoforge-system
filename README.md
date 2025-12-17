# GeoForge System

GeoForge Systemは、架空の世界地図を生成し、文明、経済、歴史をシミュレートするためのWebアプリケーションです。
Hex（六角形）グリッドベースの地図上で、大陸生成から国家興亡までを可視化します。

## 機能概要

- **世界生成**: プレートテクトニクス風のアルゴリズムによる大陸生成。
- **環境シミュレーション**: 気温、降水量、バイオーム、河川の計算。
- **文明・経済**: 人口分布、産業構造、交易ルート（道路・海路）のシミュレーション。
- **データ保存**: Google Apps Script (GAS) と連携したスプレッドシートへのデータ永続化。

## セットアップ

### 必要要件
- Node.js (v22以上推奨)
- npm

### インストール
```bash
git clone https://github.com/dexism/geoforge-system.git
cd geoforge-system
npm install
```

### 開発サーバー起動
```bash
npm run dev
```
ブラウザで `http://localhost:5173` にアクセスしてください。

## デプロイ

本リポジトリはRender.com等でのホスティングを想定しています。
GitHubへのプッシュにより自動デプロイがトリガーされる設定（Render側）を推奨します。

手動デプロイ（プッシュ）用スクリプト:
```powershell
./script/deploy.ps1
```

## 環境変数 (Secrets)

以下の変数を環境変数（ローカル `.env` または GitHub Secrets / Render Environment Variables）として設定してください。

- `GAS_WEB_APP_URL`: データ保存用GAS WebアプリのURL
- `VITE_DISCORD_WEBHOOK_URL`: 通知用Webhook URL

## ディレクトリ構造

- `src/`: ソースコード
- `docs/`: 仕様書・ドキュメント
- `script/`: 運用スクリプト
- `backup/`: バックアップデータ（Git管理外）

## ライセンス

[MIT License](LICENSE)
