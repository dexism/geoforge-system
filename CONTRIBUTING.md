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

## コードレビューとテスト (For Reviewers)

他のメンバーの変更を確認する際は、以下の手順を推奨します。

1. **GitHub上での確認**:
   - プルリクエストの「Files changed」タブで、変更内容を確認・レビューします。

2. **ローカルでの動作確認**:
   - 変更をローカル環境で実際に動かしてダブルチェックします。
   ```bash
   # リモートの最新情報を取得
   git fetch origin
   
   # 相手のブランチに切り替える (例: feature/xxx)
   git checkout feature/xxx
   
   # 開発サーバー起動
   npm run dev
   ```

## 管理者向け手順 (For Maintainers)

プルリクエストのマージを行う際の手順です。

1. **マージ基準**:
   - [x] CI (Buildチェック) が緑色になっていること。
   - [x] 内容に問題がないこと（必要であればコードレビューを行う）。

2. **マージ実行**:
   - GitHub画面の「Merge pull request」ボタンを押してマージします。

3. **ブランチ削除 (Cleanup)**:
   - マージ後、「Delete branch」ボタンを押して、不要になった機能ブランチを削除してください。
   - ブランチを削除しても、マージされたコミットは `main` に残りますので安心してください。

### 補足: ローカル環境のクリーンアップ

GitHub上でブランチを削除しても、手元のPCには古いブランチが残ったままになります。
定期的に以下のコマンドを実行して整理すると、リストが綺麗になります。

```bash
# GitHubで削除されたブランチ情報を手元に反映 (prune)
git fetch -p

# 手元の不要なブランチを削除 (例)
git branch -d feature/deploy-yyyyMMdd-Hmmss
```

