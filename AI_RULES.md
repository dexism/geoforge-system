# GeoForge System - AI Development Rules

このファイルは、AIアシスタントがGeoForge Systemの開発に従事する際に遵守すべきルールを定めたものである。

## 1. 基本原則 (General Principles)

1. **Language**: すべての応答、思考過程、計画書、およびアーティファクトは**日本語**で記述すること。
2. **Scope Discipline**: 
   - 依頼されたタスクの範囲外、特にコアロジックやエンジン部分には無断で手を触れないこと。
   - UIの修正がロジックに波及する場合は、必ず事前にユーザーの許可を得ること。
3. **Safety First**:
   - 破壊的な変更を行う前には、対象ファイルのバックアップ（`filename.js.bak`）を作成すること。
   - アプリケーションが破損した場合は、Fix Forwardではなく、直ちにGitで安全な状態にロールバックすること。

## 2. 技術スタックと環境 (Tech Stack)

- **Runtime**: Node.js v22+
- **Language**: TypeScript (新規作成時推奨) / JavaScript (既存)
- **Framework**: Vite (Vanilla JS/TS configuration)
- **Deployment**: GitHub Actions (CI) -> Render (Auto Deploy)

## 3. 開発フロー (Development Workflow)

**GitHub Flow** を厳格に適用する。

1. **直接プッシュ禁止**: `main` ブランチへの直接プッシュは禁止されている（Branch Protection有効）。
2. **スクリプトによるデプロイ**:
   - 変更の適用には必ず `.\scripts\deploy.ps1 "コミットメッセージ"` を使用すること。
   - これにより自動的にFeatureブランチが作成され、PRフローに乗る。
3. **Pull Request (PR)**:
   - 全ての変更はPRを通じて `main` にマージされる。
   - CI (Buildチェック) が通過していることを確認すること。

## 4. ファイル管理と制限 (Files & Restrictions)

1. **編集禁止**:
   - `dist/`: 自動生成ディレクトリ。編集しても無駄になるため触れない。
   - `code.gs` (ルート): Git管理外の機密ファイル。Google Apps Scriptエディタでのみ管理する。
2. **バージョン管理**:
   - `package.json` のバージョン番号は、コード改修時に必ずインクリメントする。
     - 例: `"version": "2.8.34"` -> `"version": "2.8.35"`

## 5. コーディング規約 (Coding Standards)

1. **コメント**: 日本語で記述すること。関数の役割や引数の説明をJSDoc形式で残すのが望ましい。
2. **パフォーマンス**:
   - 1万以上のオブジェクト（Hexなど）を扱うループ処理には細心の注意を払う。
   - 不要なオブジェクト生成を避け、メモリ効率を考慮する。
3. **検証駆動開発 (VDD)**:
   - 複雑なロジック変更時は、いきなり本番ファイルを触らず `test_xxx.ts` などで検証してから適用する。

## 6. プロジェクト固有ルール (Project Specifics)

1. **データ構造**:
   - マップデータは `world_data.json` 形式を基本とする。
   - GAS連携時はスプレッドシートの仕様に従う。
2. **マップレンダリング**:
   - 大規模マップはブロック単位でレンダリングし、`clip-path` 等で描画負荷を制御する（Lessons Learned参照）。
