// ================================================================
// GeoForge System - Block Utilities (ブロックユーティリティ)
// ================================================================

export const BLOCK_CORE_COLS = 23;
export const BLOCK_CORE_ROWS = 20;
export const BLOCK_PADDING = 1;

export const BLOCK_TOTAL_COLS = BLOCK_CORE_COLS + (BLOCK_PADDING * 2); // 25
export const BLOCK_TOTAL_ROWS = BLOCK_CORE_ROWS + (BLOCK_PADDING * 2); // 22

export const BLOCK_START_EE = 0;
export const BLOCK_START_NN = 0;
export const BLOCK_END_EE = 99;
export const BLOCK_END_NN = 99;

// グローバルマップの制約
// 5x5ブロック (コアサイズ 23x20) の場合、総コアサイズは 115x100。
// グローバルな端に1ヘックスのパディングがあるため、全体のサイズは 117x102 となる。
export const GLOBAL_OFFSET_X = 1; // グローバル(0,0)はパディング。(1,1)がコアデータの開始位置。
export const GLOBAL_OFFSET_Y = 1;

/**
 * 指定されたブロック座標からブロックID（ファイル名互換）を返します。
 * @param {number} ee - 経度インデックス (例: 48-52)
 * @param {number} nn - 緯度インデックス (例: 71-75)
 * @returns {string} ID文字列 (例: "map_50_73")
 */
export function getBlockId(ee, nn) {
    return `map_${ee}_${nn}`;
}

/**
 * グローバル座標からブロックIDを取得します。
 * @param {number} col - グローバル列番号
 * @param {number} row - グローバル行番号
 * @returns {string|null} ID文字列 (例: "map_50_73")、範囲外の場合は null
 */
export function getBlockIdFromGlobal(col, row) {
    const coords = globalToBlock(col, row);
    if (!coords) return null;
    return getBlockId(coords.ee, coords.nn);
}

/**
 * グローバルヘックス座標をブロック座標系に変換します。
 * グローバル (0,0) は、マップ全体（グローバルパディングを含む）の左下隅です。
 * 
 * @param {number} globalCol - グローバル列インデックス (0 から 116)
 * @param {number} globalRow - グローバル行インデックス (0 から 101)
 * @returns {Object|null} { ee, nn, localCol, localRow } または範囲外の場合 null
 */
export function globalToBlock(globalCol, globalRow) {
    // 1. グローバルパディングを考慮して「コア」座標を取得
    const coreX = globalCol - GLOBAL_OFFSET_X;
    const coreY = globalRow - GLOBAL_OFFSET_Y;

    // 2. ブロックインデックスの決定 (ブロックグリッドの0,0に対する相対位置)
    // 補足: coreXが-1 (左パディング) の場合、それは「左側のゴーストブロック」に属するか、
    // あるいは最初のブロックのローカル座標 -1 として扱われるか？
    // 仕様では「ブロックは周囲2ヘックス (実装上は1ヘックス?) を共有する」とある。
    // 「ブロックは 23x20 のコアを持つ」「ブロックは 25x22 のデータを保持する」
    // これは、1つのブロックにはコア部分とその隣接部分が含まれることを意味します。

    // ここでは、ある座標が属する「プライマリーブロック (Master Block)」を見つけるロジックを実装します。
    // 座標は（パディングとして）複数のブロックに存在し得ますが、
    // この関数は「そのヘックスがコアの一部となる」所有者ブロックを返します。

    // 境界チェック
    // コアエリア: 0〜114 (115列), 0〜99 (100行)
    // 許容されるグローバル範囲: 0〜116, 0〜101

    const blockX = Math.floor(coreX / BLOCK_CORE_COLS);
    const blockY = Math.floor(coreY / BLOCK_CORE_ROWS);

    // EE と NN の計算
    const ee = BLOCK_START_EE + blockX;
    // [FIX] NN は南に向かって増加します (0=北)。
    // blockY は北に向かって増加します (0=コアの南端)。
    // したがって nn = 99 - blockY となります。
    const nn = BLOCK_END_NN - blockY;

    // そのブロック内でのローカル座標の計算
    // ローカル (0,0) は 25x22 グリッドの左下です。
    // コアは (1,1) から始まります。
    // coreX % BLOCK_CORE_COLS はコア内のインデックス (0..22) を与えます。
    // よって localCol = (coreX % BLOCK_CORE_COLS) + BLOCK_PADDING となります。

    // 負のコア座標 (パディングエリア) の処理
    // もし coreX = -1 なら、Math.floor(-1/23) = -1 となりロジックは破綻しませんが、
    // ここでは有効なブロックに厳密にマッピングします。

    let localCol = (coreX % BLOCK_CORE_COLS);
    if (localCol < 0) localCol += BLOCK_CORE_COLS;
    localCol += BLOCK_PADDING; // 左パディングをスキップしてシフト

    let localRow = (coreY % BLOCK_CORE_ROWS);
    if (localRow < 0) localRow += BLOCK_CORE_ROWS;
    localRow += BLOCK_PADDING;

    // 境界保護 (Boundary Protection)
    if (ee < BLOCK_START_EE || ee > BLOCK_END_EE || nn < BLOCK_START_NN || nn > BLOCK_END_NN) {
        return null; // 世界の外側
    }

    return { ee, nn, localCol, localRow };
}


/**
 * ブロック座標をグローバルヘックス座標に変換します。
 * 
 * @param {number} ee - ブロック経度
 * @param {number} nn - ブロック緯度
 * @param {number} localCol - ローカル列 (0〜24)
 * @param {number} localRow - ローカル行 (0〜21)
 * @returns {Object} { col, row } グローバル座標
 */
export function blockToGlobal(ee, nn, localCol, localRow) {
    const blockIndexX = ee - BLOCK_START_EE;
    const blockIndexY = nn - BLOCK_START_NN;

    const coreStartX = blockIndexX * BLOCK_CORE_COLS;
    const coreStartY = blockIndexY * BLOCK_CORE_ROWS;

    // localCol にはパディングが含まれます。
    // localCol 1 がコアの開始位置です。
    const relativeCoreX = localCol - BLOCK_PADDING;
    const relativeCoreY = localRow - BLOCK_PADDING;

    const globalCoreX = coreStartX + relativeCoreX;
    const globalCoreY = coreStartY + relativeCoreY;

    // グローバルオフセットによるシフト
    const col = globalCoreX + GLOBAL_OFFSET_X;
    const row = globalCoreY + GLOBAL_OFFSET_Y;

    return { col, row };
}

/**
 * ヘックスを通過する道路・河川のパターンIDを計算します。
 * 
 * パターン定義:
 * 0-5: Center-Edge (放射状) - エッジ N と中心を接続。
 * 6-11: Edge-to-Adj (急カーブ) - エッジ N とエッジ (N+1)%6 を接続。
 * 12-17: Edge-to-Skip (緩カーブ) - エッジ N とエッジ (N+2)%6 を接続。
 * 
 * @param {number} inDir - 前のヘックスからの方向 (0-5)。-1 の場合は始点。
 * @param {number} outDir - 次のヘックスへの方向 (0-5)。-1 の場合は終点。
 * @returns {number[]} パターンIDの配列
 */
export function getPatternIds(inDir, outDir) {
    // 1. 端点の場合 (始点または終点)
    if (inDir === -1 && outDir !== -1) {
        return [outDir]; // 中心 -> 外
    }
    if (inDir !== -1 && outDir === -1) {
        return [inDir]; // 外 -> 中心 (inDIrは接続元への方向ではなく、接続元からの流入方向＝中心から見たエッジ方向として扱われる前提)
        // ※ 呼び出し元が「中心から見たエッジ方向」を渡していることを想定。
    }
    if (inDir === -1 && outDir === -1) {
        return []; // 孤立点
    }

    // 2. 通過点の場合 (Through case)
    // 通常、パスは Prev -> Curr -> Next。
    // 入力されるneighbor方向は「中心から見た接続の方向」であるべきです。
    // 例: Prevが方向3にあるなら、inDir=3。

    // 無向接続として正規化 (ソートしてもロジック上の接続関係は変わらないが、差分計算には必要)
    // 厳密な定義を使用:
    // 急カーブ (Sharp Patterns):
    // 6: 0-1
    // 7: 1-2
    // 8: 2-3
    // 9: 3-4
    // 10: 4-5
    // 11: 5-0 (wrap)

    // 緩カーブ (Gentle Patterns):
    // 12: 0-2
    // 13: 1-3
    // 14: 2-4
    // 15: 3-5
    // 16: 4-0 (wrap)
    // 17: 5-1 (wrap)

    const d1 = inDir;
    const d2 = outDir;

    let diff = Math.abs(d1 - d2);
    if (diff > 3) diff = 6 - diff;

    // A. Center-Edge (直線)
    if (diff === 0) return [d1]; // 同じ方向？ ループバック？ 中心接続として扱う。
    if (diff === 3) return [d1, d2]; // 直線通過 -> 2つのCenter-Edgeラインとして描画。

    // B. Sharp Curve (差分 = 1)
    if (diff === 1) {
        // wrapを考慮して「小さい方」のインデックスを探す。
        // ペアは (0,1), (1,2), (2,3), (3,4), (4,5), (5,0)。
        // (0,5) の場合のみ 5-0 -> ID 11 となる。

        let min = Math.min(d1, d2);
        let max = Math.max(d1, d2);

        if (min === 0 && max === 5) return [11]; // 特別な wrap ケース

        // それ以外は、Base ID = 6 + min
        return [6 + min];
    }

    // C. Gentle Curve (差分 = 2)
    if (diff === 2) {
        // ペアは (0,2), (1,3), (2,4), (3,5), (4,0), (5,1)。
        // (4,0) は wrap -> ID 16. (5,1) は wrap -> ID 17.

        let min = Math.min(d1, d2);
        let max = Math.max(d1, d2);

        if (min === 0 && max === 4) return [16]; // 4-0
        if (min === 1 && max === 5) return [17]; // 5-1

        // それ以外は、Base ID = 12 + min
        return [12 + min];
    }

    return [];
}

/**
 * h1 から h2 への方向 (0-5: 北から時計回り) を判定します。
 * フラットトップヘックス (Flat-Top Hexes), Odd-Q (奇数列が下にずれる) 座標系。
 * 
 * @param {object} h1 - 始点ヘックス ({col, row})
 * @param {object} h2 - 終点ヘックス ({col, row})
 * @returns {number} 0:N, 1:NE, 2:SE, 3:S, 4:SW, 5:NW。隣接していない場合は -1。
 */
export function getDirection(h1, h2) {
    // 必要に応じて入力オブジェクトからcol/rowを取り出す
    const c1 = h1.col !== undefined ? h1.col : h1.x;
    const r1 = h1.row !== undefined ? h1.row : h1.y;
    const c2 = h2.col !== undefined ? h2.col : h2.x;
    const r2 = h2.row !== undefined ? h2.row : h2.y;

    const dc = c2 - c1;
    const dr = r2 - r1;
    const isOdd = (c1 % 2 !== 0);

    // Odd-Q における隣接オフセットの標準
    // 偶数列 (Even Col): N(0,-1), NE(1,-1), SE(1,0), S(0,1), SW(-1,0), NW(-1,-1)
    // 奇数列 (Odd Col):  N(0,-1), NE(1,0), SE(1,1), S(0,1), SW(-1,1), NW(-1,0)

    if (dc === 0 && dr === -1) return 0; // N
    if (dc === 0 && dr === 1) return 3; // S

    if (isOdd) {
        if (dc === 1 && dr === 0) return 1; // NE
        if (dc === 1 && dr === 1) return 2; // SE
        if (dc === -1 && dr === 1) return 4; // SW
        if (dc === -1 && dr === 0) return 5; // NW
    } else {
        if (dc === 1 && dr === -1) return 1; // NE
        if (dc === 1 && dr === 0) return 2; // SE
        if (dc === -1 && dr === 0) return 4; // SW
        if (dc === -1 && dr === -1) return 5; // NW
    }

    return -1;
}
