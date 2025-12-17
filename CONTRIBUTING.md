# 開発者ガイド (CONTRIBUTING.md)

GeoForge SystemおよびRuleBookの開発に参加していただきありがとうございます。
チーム開発を円滑に進めるため、以下のガイドラインに従ってください。

## 開発環境のセットアップ

1. **リポジトリのクローン**
   ```bash
   git clone https://github.com/dexism/geoforge-system.git
   cd geoforge-system
   ```

2. **依存関係のインストール**
   ```bash
   npm install
   ```

3. **ローカルサーバーの起動**
   ```bash
   npm run dev
   ```
   ブラウザで `http://localhost:5173` (Viteデフォルト) にアクセスして確認します。

## 開発フロー

1. **Issueの確認・作成**
   - 着手するタスクのIssueが存在するか確認してください。なければ作成してください。
   - バグ報告や機能提案はテンプレートを使用してください。

2. **ブランチの作成**
   - `main` ブランチから新しいブランチを作成します。
   - ブランチ名の命名規則: `type/issue-id/description`
     - 例: `feat/123/add-save-button`
     - 例: `fix/456/map-rendering-bug`
     - `type`: `feat`, `fix`, `docs`, `refactor`, `style`, `test` など

3. **コミット**
   - コミットメッセージは日本語で記述し、プレフィックスを付けてください。
   - 例: `feat: 保存ボタンの実装 (#123)`
   - 変更はできるだけ小さく分割してコミットしてください。

4. **Pull Request (PR) の作成**
   - GitHub上でPRを作成します。テンプレートに従って内容を記述してください。
   - レビューを行い、承認されたらマージします。

## コーディング規約

- **言語**: 変数名や関数名は英語、コメントは日本語で記述してください。
- **TypeScript**: 新規コードはTypeScript (`.ts`) で記述することを推奨します。
  - 基本的に `any` は避け、型定義を行ってください。
  - 段階的移行中のため、既存のJSファイルとの混在は許容されます。
- **フォーマット**: プロジェクトの設定に従ってください。

## ディレクトリ構造

- `src/`: ソースコード
  - `main.js`: エントリーポイント
  - `MapView.js`: 地図描画ロジック
  - `WorldMap.js`: データモデル
  - `ui.js`: UI操作
- `public/`: 静的アセット
- `.github/`: GitHub設定（テンプレート等）

質問がある場合は、IssueやDiscordで相談してください。
