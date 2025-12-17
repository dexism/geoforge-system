# GeoForge
- `AI_RULES.md`を遵守すること。
- `仕様.md`を確認すること。
- 現在、最小構成の表示から、逐次機能を復旧中です。
- コード内のコメントは、日本語ベースで記載すること。
- コード内の各関数の使用を、コメントで記載すること。
- 必ずバックアップを取ること。

# AI Assistant Rules

1. **Language**: すべての応答、思考過程、計画書、およびアーティファクトは日本語で記述すること。

2. **Scope Discipline (スコープの厳守)**:
   - UIや見た目の変更タスクにおいて、コアロジックやエンジン部分（データ計算、座標計算、アルゴリズムなど）には**絶対に手を触れないこと**。
   - 目的外のコード修正は、たとえ善意であってもバグの温床となるため禁止する。

3. **Safety First (安全第一)**:
   - 破壊的な変更や大規模な置換を行う前には、必ず対象ファイルのバックアップを作成すること。
   - ファイル操作ツールを使用する際は、既存のコードを誤って削除しないよう細心の注意を払うこと。
   - **バックアップファイルの命名規則**: バックアップファイルを作成する際は、必ず末尾が `.bak` となるように命名すること（例: `filename.js.bak`、`filename.feature_name.bak`）。これは `.gitignore` で無視されるようにするためである。

4. **Fail-Safe Recovery (確実な復旧)**:
   - 変更によりアプリケーションが破損した場合、当てずっぽうな修正（Fix Forward）を繰り返して傷口を広げるのではなく、**直ちにGit等のバージョン管理システムを使用して稼働していた状態（Last Known Good State）に戻すこと**。
   - 復旧にかかる時間を最小限に抑えることが、ユーザーの利益となる。

5. **Verification (検証の徹底)**:
   - 作業開始前に現在の環境が正常に動作しているかを確認すること。
   - 変更を加えるたびに、アプリケーションが起動し、主要機能が動作することを確認すること。

6. **マイナーバージョンを増やす（GeoForge のみ適用）**: 
   - `index.html`のバージョン3桁目(rev)は、コードの改修時に必ず増やす。2桁目以上は私が運用する。`<h1 id="loading-title">GeoForge SYSTEM<br>ver.2.7 <small>rev.27</small><br>世界を創造しています！</h1>`

7. **Verification-Driven Development (検証駆動開発)**:
   - 複雑なロジック変更やパフォーマンス改善を行う際は、いきなり既存ファイルを編集せず、まず`test_xxx.js`のような一時ファイルを作成してロジックを実装・検証すること。
   - 一時ファイルで動作と効果（メモリ削減量など）が確認できてから、本番ファイルに適用する。これにより、既存環境を破壊するリスクを最小限に抑えられる。
   - 検証後は、一時ファイルを削除して環境をクリーンに保つこと。

8. **Performance Awareness (パフォーマンスへの意識)**:
   - 大量のオブジェクト（例: 1万以上のヘックス）を扱う際は、オブジェクトの生成コストとメモリ使用量を常に意識する。
   - 安易なオブジェクト生成を避け、TypedArrayやFlyweightパターンの導入を検討する。

9. **データ構造の変更（GeoForge のみ適用）**: 
   - 保存データ形式は world_data.json と GAS によるスプレッドシート保存とし、データサイズを減少させるために「基盤情報として保持すべきデータ」と「読み込み時に補完するデータ」、「クリック時に生成するデータ」に分ける。
   - 検証時は、「大陸生成から実施しなければならないもの」と「既存のデータから確認できるもの」を明確に分けて試験要領を提案する。

10. **Lessons Learned (2025-12-04: Map Rendering Optimization)**:
    - **Block-based Rendering**: For large-scale map rendering, partitioning into blocks and using `clip-path` is essential for performance and memory management.
    - **Memory Management**: Use lazy loading (render on demand) and aggressive cleanup (remove DOM when off-screen) for heavy SVG elements.
    - **Variable Shadowing**: Be extremely careful with local variable names (e.g., `hexes`) shadowing global variables, especially when refactoring code from global to local scope.
    - **Grid Alignment**: When using grid-based algorithms (like marching squares) on partitioned data, ensure the grid origin is aligned to the resolution (e.g., `Math.floor(x / res) * res`) to prevent seams between blocks.
    - **Coordinate Systems**: Pay attention to coordinate transformations and offsets when porting logic. Original implementations often have specific offsets (e.g., `- resolution / 2`) that are critical for correct alignment.
