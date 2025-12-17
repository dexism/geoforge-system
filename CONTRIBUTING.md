# 開発ガイド (Contributing Guide)

GeoForge Systemの開発に参加していただきありがとうございます。

## 開発環境

- **Language**: TypeScript (徐々にJSから移行中) / HTML / CSS
- **Runtime**: Node.js v22+
- **Package Manager**: npm
- **Build Tool**: Vite

## 開発サイクル (Workflow)

このプロジェクトでは **Pull Request (PR) ベース** の開発フローを採用しています。
`main` ブランチへの直接プッシュは禁止されています。

### 1. 準備
作業を始める前に、必ずローカルの `main` を最新にしてください。
```bash
git checkout main
git pull
```

### 2. コード編集
自由にコードを編集・修正してください。
開発サーバー (`npm run dev`) を起動しておくと、リアルタイムで確認できます。

### 3. 保存と投稿 (Deploy)
付属のスクリプトを使用すると、ブランチ作成からPR案内まで自動で行えます。
```powershell
.\scripts\deploy.ps1 "変更内容の概要"
```
スクリプトが完了すると、ブラウザでPR作成画面を開くか確認されます。

### 4. マージ (Merge)
GitHub上でPRを作成し、CI (ビルドチェック) が通ったらマージしてください。
マージ後は手順1に戻り、最新のコードを取り込んでください。

## コミットメッセージの規約

- 日本語で記述してください。
- プレフィックス推奨:
  - `Feat`: 新機能
  - `Fix`: バグ修正
  - `Docs`: ドキュメント更新
  - `Refactor`: リファクタリング

## 問題報告 (Issues)

バグや機能要望は [Issues](https://github.com/dexism/geoforge-system/issues) に投稿してください。
テンプレートが用意されていますので、それに沿って記入してください。
