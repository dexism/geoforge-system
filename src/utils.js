// ================================================================
// GeoForge System - ユーティリティモジュール
// ================================================================

import * as config from './config.js';
import { globalToBlock } from './BlockUtils.js';


/**
 * 座標からallHexes配列のインデックスを計算する
 * @param {number} col - ヘックスの列
 * @param {number} row - ヘックスの行
 * @returns {number} 配列のインデックス
 */
export function getIndex(col, row) {
    return row * config.COLS + col;
}

/**
 * 指定された座標の隣接ヘックスのインデックス配列を取得する
 * (Flat-Top / Odd-Q 垂直列オフセット)
 * @param {number} col - 中心ヘックスの列
 * @param {number} row - 中心ヘックスの行
 * @param {number} maxCols - グリッドの最大列数 (config.COLS)
 * @param {number} maxRows - グリッドの最大行数 (config.ROWS)
 * @returns {Array<number>} 隣接ヘックスのインデックス配列 (範囲外は含まない)
 */
export function getNeighborIndices(col, row, maxCols, maxRows) {
    const isOddCol = col % 2 !== 0;
    const candidates = [
        { col: col, row: row - 1 },     // N (North)
        { col: col, row: row + 1 },     // S (South)
        { col: col - 1, row: row },     // NW (North West)
        { col: col + 1, row: row },     // NE (North East)
        { col: col - 1, row: isOddCol ? row + 1 : row - 1 }, // SW (South West)
        { col: col + 1, row: isOddCol ? row + 1 : row - 1 }, // SE (South East)
    ];

    const neighbors = [];
    candidates.forEach(n => {
        if (n.col >= 0 && n.col < maxCols && n.row >= 0 && n.row < maxRows) {
            neighbors.push(n.row * maxCols + n.col); // getIndexと同様のRow-Major順
        }
    });
    return neighbors;
}

/**
 * 2つのヘックス間の簡易的な距離を計算する (マンハッタン距離のヘックス版)
 * @param {object} h1 - 1つ目のヘックスオブジェクト ({ col, row })
 * @param {object} h2 - 2つ目のヘックスオブジェクト ({ col, row })
 * @returns {number} ヘックス単位での距離
 */
export function getDistance(h1, h2) {
    // 軸座標系への変換は不要な、簡略化された距離計算
    const dx = Math.abs(h1.col - h2.col);
    const dy = Math.abs(h1.row - h2.row);

    // ヘックスグリッドの距離計算は、dx, dy, dzの差の最大値に等しい
    // このグリッド系ではこれで十分な近似となる
    return Math.max(dx, dy);
}

/**
 * Calculates determine direction from h1 to h2 (0-5 Clockwise starting N).
 * Flat-Top Hexes, Odd-Q (odd columns shifted down).
 * 
 * @param {object} h1 - From Hex ({col, row})
 * @param {object} h2 - To Hex ({col, row})
 * @returns {number} 0:N, 1:NE, 2:SE, 3:S, 4:SW, 5:NW. Returns -1 if not neighbors.
 */
export function getDirection(h1, h2) {
    const dc = h2.col - h1.col;
    const dr = h2.row - h1.row;
    const isOdd = (h1.col % 2 !== 0);

    // Standard Odd-Q Offsets for Neighbors
    // Even Col: N(0,-1), NE(1,-1), SE(1,0), S(0,1), SW(-1,0), NW(-1,-1)
    // Odd Col:  N(0,-1), NE(1,0), SE(1,1), S(0,1), SW(-1,1), NW(-1,0)

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

/**
 * プログレスバーの表示用文字列を生成する汎用関数
 * @param {object} params - パラメータオブジェクト
 * @param {number} params.current - 現在の処理数
 * @param {number} params.total - 全体の処理数
 * @param {string} [params.prefix=""] - バーの前に表示する接頭辞
 * @param {number} [params.barWidth=20] - バーの文字数
 * @returns {string} フォーマットされたプログレスバー文字列
 */
export function formatProgressBar({ current, total, prefix = "", barWidth = 40 }) {
    if (total === 0) return `${prefix} [${'-'.repeat(barWidth)}] 0% (0/0)`;

    const percent = Math.floor((current / total) * 100);
    const filledLength = Math.round((barWidth * percent) / 100);
    const emptyLength = barWidth - filledLength;

    const bar = '|'.repeat(filledLength) + '.'.repeat(emptyLength);

    return `${prefix} [${bar}] ${percent}% (${current}/${total})`;
}

/**
 * ヘックスの位置情報を指定されたフォーマットの文字列に変換する
 * @param {object} hexData - ヘックスのデータオブジェクト (x, y, properties.elevation を持つ)
 * @param {string} formatType - 'full', 'short', 'coords', 'elevation' のいずれか
 * @returns {string} フォーマットされた位置情報文字列
 */
export function formatLocation(hexData, formatType) {
    if (!hexData) return 'N/A';

    const p = hexData.properties || {};
    // Use col/row if available (System Standard), fall back to x/y (Legacy/UI)
    const col = (hexData.col !== undefined) ? hexData.col : (hexData.x || 0);
    const row = (hexData.row !== undefined) ? hexData.row : (hexData.y || 0);

    const blockInfo = globalToBlock(col, row);

    let xStr, yStr;
    if (blockInfo) {
        // World Coordinate Format: EEXX-NNYY (e.g. 5012-7308)
        // EE: Block EE (2 digits), XX: Local Col (2 digits)
        xStr = `${blockInfo.ee}${String(blockInfo.localCol).padStart(2, '0')}`;
        yStr = `${blockInfo.nn}${String(blockInfo.localRow).padStart(2, '0')}`;
    } else {
        // Fallback for out of bounds
        xStr = String(col).padStart(4, '0');
        yStr = String(row).padStart(4, '0');
    }

    const elevation = Math.round(p.elevation || 0);

    const isDepth = elevation < 0;
    const elevLabel = isDepth ? 'D' : 'H';
    const elevValue = isDepth ? Math.abs(elevation) : elevation;

    switch (formatType) {
        case 'full':
            return `E ${xStr} N ${yStr} ${elevLabel} ${elevValue}`;
        case 'short':
            return `${xStr}-${yStr} ${elevLabel} ${elevValue}`;
        case 'coords':
            return `${xStr}-${yStr}`;
        case 'elevation':
            return `${elevLabel} ${elevValue}`;
        default:
            return `${xStr}-${yStr}`;
    }
}

/**
 * 2つの隣接するヘックスの共有辺の端点（2点）を計算する
 * @param {object} h1 - 1つ目のヘックス
 * @param {object} h2 - 2つ目のヘックス
 * @returns {Array<Array<number>>|null} [[x1, y1], [x2, y2]] 形式の座標配列。隣接していない場合はnull
 */
export function getSharedEdgePoints(h1, h2) {
    if (!h1 || !h2) return null;

    // ヘックスの頂点を比較して、共有されている2点を見つける
    // 座標の許容誤差
    const epsilon = 0.1;
    const sharedPoints = [];

    for (const p1 of h1.points) {
        for (const p2 of h2.points) {
            if (Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon) {
                sharedPoints.push(p1);
                break; // h2のループを抜けて次のh1の点へ
            }
        }
    }

    if (sharedPoints.length === 2) {
        return sharedPoints;
    }
    return null;
}

/**
 * 2つの隣接するヘックスの共有辺の中点を計算する
 * @param {object} h1 - 1つ目のヘックス
 * @param {object} h2 - 2つ目のヘックス
 * @returns {Array<number>|null} [x, y] 形式の座標。隣接していない場合はnull
 */
export function getSharedEdgeMidpoint(h1, h2) {
    const points = getSharedEdgePoints(h1, h2);
    if (points) {
        return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    }
    return null;
}

/**
 * シード付き疑似乱数生成器 (Xorshift128+)
 */
export class SeededRandom {
    constructor(seed) {
        // シードが指定されない、または0の場合は現在時刻を使用
        if (seed === undefined || seed === null || seed === 0) {
            seed = Date.now();
        }

        // 文字列シード対応 (ハッシュ化して数値に変換)
        if (typeof seed === 'string') {
            let h = 0xdeadbeef;
            for (let i = 0; i < seed.length; i++) {
                h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
            }
            seed = (h ^ h >>> 16) >>> 0;
        }

        // 状態変数の初期化 (SplitMix64で初期状態を生成)
        this.s0 = this._splitmix64(seed);
        this.s1 = this._splitmix64(this.s0);
        this.s2 = this._splitmix64(this.s1);
        this.s3 = this._splitmix64(this.s2);

        this.initialSeed = seed;
    }

    // 初期化用ヘルパー (SplitMix64)
    _splitmix64(a) {
        a |= 0; a = a + 0x9e3779b9 | 0;
        let t = a ^ a >>> 16;
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ t >>> 15;
        t = Math.imul(t, 0x735a2d97);
        return ((t = t ^ t >>> 15) >>> 0);
    }

    /**
     * 0以上1未満の乱数を返す (Math.random() 互換)
     */
    next() {
        // Xorshift128
        let t = this.s3;
        const s = this.s0;
        this.s3 = this.s2;
        this.s2 = this.s1;
        this.s1 = s;

        t ^= t << 11;
        t ^= t >>> 8;
        this.s0 = t ^ s ^ (s >>> 19);

        return (this.s0 >>> 0) / 4294967296;
    }

    /**
     * 指定された範囲の整数を返す (min以上 max以下)
     */
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
}

// グローバルなPRNGインスタンス
export let globalRandom = new SeededRandom();

/**
 * グローバルPRNGを初期化する
 * @param {number|string} seed 
 */
export function initGlobalRandom(seed) {
    globalRandom = new SeededRandom(seed);
    console.log(`[PRNG] Initialized with seed: ${seed}`);
}
