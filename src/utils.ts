// ================================================================
// GeoForge System - ユーティリティモジュール (utils.ts)
// ================================================================
// 解説:
// アプリケーション全体で使用される汎用的な関数群を提供するモジュール。
// 依存関係: config.js (定数), BlockUtils.js (座標変換)
// ================================================================

import * as config from './config.ts';
import { globalToBlock } from './BlockUtils.ts';

// 基本的なPoint型 (CoordinateSystem.tsと重複するが、疎結合のためここで定義またはanyで済ます)
interface Point2D {
    x: number;
    y: number;
}

// ヘックスの最低限のインターフェース
interface HexMinimal {
    col: number;
    row: number;
    x?: number;
    y?: number;
    properties?: {
        elevation?: number;
        [key: string]: any;
    };
    ee?: number;
    nn?: number;
    localCol?: number;
    localRow?: number;
    points?: number[][];
}

/**
 * 座標からallHexes配列のインデックスを計算する
 * 
 * 仕様:
 * 2次元配列ではなく、1次元配列で管理されるヘックスデータへのアクセスに使用する。
 * 行(row) * 最大列数(config.COLS) + 列(col) でインデックスを算出。
 * 
 * @param {number} col - ヘックスの列 (X成分相当)
 * @param {number} row - ヘックスの行 (Y成分相当)
 * @returns {number} 1次元配列上のインデックス。範囲外チェックは行わないため呼び出し側で注意が必要。
 */
export function getIndex(col: number, row: number): number {
    return row * config.COLS + col;
}

/**
 * 指定された座標の隣接ヘックスのインデックス配列を取得する
 * 
 * 仕様:
 * ヘックスグリッドは「Flat-Top / Odd-Q (奇数列が垂直方向に半段ずれる)」形式を採用。
 * 偶数列(Even)と奇数列(Odd)で、隣接する6方向の座標計算式が異なる。
 * グリッド範囲外の座標は結果に含まれない。
 * 
 * @param {number} col - 中心ヘックスの列番号
 * @param {number} row - 中心ヘックスの行番号
 * @param {number} maxCols - グリッドの最大列数 (通常 config.COLS)
 * @param {number} maxRows - グリッドの最大行数 (通常 config.ROWS)
 * @returns {Array<number>} 隣接する有効なヘックスの1次元配列インデックスのリスト
 */
export function getNeighborIndices(col: number, row: number, maxCols: number, maxRows: number): number[] {
    const isOddCol = col % 2 !== 0;
    const candidates = [
        { col: col, row: row - 1 },     // N (北)
        { col: col, row: row + 1 },     // S (南)
        { col: col - 1, row: row },     // NW (北西)
        { col: col + 1, row: row },     // NE (北東)
        { col: col - 1, row: isOddCol ? row + 1 : row - 1 }, // SW (南西: 偶数列ならrow-1, 奇数列ならrow+1)
        { col: col + 1, row: isOddCol ? row + 1 : row - 1 }, // SE (南東: 偶数列ならrow-1, 奇数列ならrow+1)
    ];

    const neighbors: number[] = [];
    candidates.forEach(n => {
        // グリッド範囲内かチェック
        if (n.col >= 0 && n.col < maxCols && n.row >= 0 && n.row < maxRows) {
            neighbors.push(n.row * maxCols + n.col); // getIndexと同様のロジックでインデックス化
        }
    });
    return neighbors;
}

/**
 * 2つのヘックス間の簡易的な距離を計算する
 * 
 * 仕様:
 * 正確な3軸座標(Cube Coordinates)変換を行わず、Axial座標の差分からマンハッタン距離を近似計算する。
 * GeoForgeのグリッド系では、dx, dyの最大値をとることで十分な近似となる。
 * 
 * @param {object} h1 - 1つ目のヘックスオブジェクト (要: col, row プロパティ)
 * @param {object} h2 - 2つ目のヘックスオブジェクト (要: col, row プロパティ)
 * @returns {number} ヘックス単位でのステップ距離（近似値）
 */
export function getDistance(h1: { col: number; row: number }, h2: { col: number; row: number }): number {
    const dx = Math.abs(h1.col - h2.col);
    const dy = Math.abs(h1.row - h2.row);

    // ヘックス距離 = max(|dx|, |dy|, |dx+dy|) だが、この座標系では簡易的に以下で算出
    return Math.max(dx, dy);
}

interface ProgressBarParams {
    current: number;
    total: number;
    prefix?: string;
    barWidth?: number;
}

/**
 * プログレスバーの表示用文字列を生成する汎用関数
 * 
 * 仕様:
 * ターミナルやログ出力用に、テキストベースのプログレスバーを生成する。
 * 例: "Prefix [||||||||||..........] 50% (50/100)"
 * 
 * @param {object} params - パラメータオブジェクト
 * @param {number} params.current - 現在の進捗数
 * @param {number} params.total - 全体の作業総数
 * @param {string} [params.prefix=""] - バーの先頭に付与するラベル
 * @param {number} [params.barWidth=40] - バー部分の文字数幅
 * @returns {string} フォーマットされたプログレスバー文字列
 */
export function formatProgressBar({ current, total, prefix = "", barWidth = 40 }: ProgressBarParams): string {
    if (total === 0) return `${prefix} [${'-'.repeat(barWidth)}] 0% (0/0)`;

    const percent = Math.floor((current / total) * 100);
    const filledLength = Math.round((barWidth * percent) / 100);
    const emptyLength = barWidth - filledLength;

    const bar = '|'.repeat(filledLength) + '.'.repeat(emptyLength);

    return `${prefix} [${bar}] ${percent}% (${current}/${total})`;
}

/**
 * ヘックスの位置情報を指定されたフォーマットの文字列に変換する
 * 
 * 仕様:
 * UIのツールチップやデバッグ表示用。
 * ブロック座標系(World Coords)とローカル座標系の両方に対応し、可能な限り詳細な情報を表示する。
 * 
 * @param {object} hexData - ヘックスデータ (x, y, col, row, properties.elevation, ee/nnブロック座標 等)
 * @param {string} formatType - 出力形式
 *   - 'full': "Loc EEXX-NNYY H 100" 形式 (詳細)
 *   - 'short': "EEXX-NNYY H 100" 形式 (標準)
 *   - 'coords': "EEXX-NNYY" 形式 (座標のみ)
 *   - 'elevation': "H 100" 形式 (標高のみ)
 * @returns {string} フォーマット結果
 */
export function formatLocation(hexData: HexMinimal | null | undefined, formatType: 'full' | 'short' | 'coords' | 'elevation'): string {
    if (!hexData) return 'N/A';

    const p = hexData.properties || {};

    // col/row プロパティを優先、無ければ x/y (互換性維持)
    const col = hexData.col !== undefined ? hexData.col : (hexData.x || 0);
    const row = hexData.row !== undefined ? hexData.row : (hexData.y || 0);

    // 標高の表示形式処理 (負の値はDepth 'D', 正の値はHeight 'H')
    const elevation = Math.round(p.elevation || 0);
    const isDepth = elevation < 0;
    const elevLabel = isDepth ? 'D' : 'H';
    const elevValue = isDepth ? Math.abs(elevation) : elevation;

    let ee: number | undefined, nn: number | undefined, lx: string, ly: string;
    let coordsStr = '00-00'; // デフォルト値

    // ブロック座標情報 (ee/nn) を持っている場合
    if (hexData.ee !== undefined && hexData.nn !== undefined) {
        ee = hexData.ee;
        nn = hexData.nn;
        // ブロック内ローカル座標があれば使用、なければグローバルcol/rowを使用
        const lCol = hexData.localCol !== undefined ? hexData.localCol : col;
        const lRow = hexData.localRow !== undefined ? hexData.localRow : row;

        lx = String(lCol).padStart(2, '0');
        ly = String(lRow).padStart(2, '0');
        coordsStr = `${ee}${lx}-${nn}${ly}`;
    } else {
        // フォールバック: グローバル座標からブロック座標を逆算 (BlockUtils利用)
        const blockCoords = globalToBlock(col, row);

        if (blockCoords) {
            // EEXX-NNYY 形式に整形
            ee = blockCoords.ee;
            nn = blockCoords.nn;
            lx = String(blockCoords.localCol).padStart(2, '0');
            ly = String(blockCoords.localRow).padStart(2, '0');
            coordsStr = `${ee}${lx}-${nn}${ly}`;
        }
    }

    switch (formatType) {
        case 'full':
            return `Loc ${coordsStr} ${elevLabel} ${elevValue}`;
        case 'short':
            return `${coordsStr} ${elevLabel} ${elevValue}`;
        case 'coords':
            return coordsStr;
        case 'elevation':
            return `${elevLabel} ${elevValue}`;
        default:
            return coordsStr;
    }
}

/**
 * 2つの隣接するヘックスの共有辺の端点（2点）を計算する
 * 
 * 仕様:
 * 川の描画などで使用。2つのヘックスポリゴンの頂点座標を比較し、
 * 座標が一致する（誤差epsilon未満）2つの点を見つけ出す。
 * 
 * @param {object} h1 - 1つ目のヘックス
 * @param {object} h2 - 2つ目のヘックス
 * @returns {Array<Array<number>>|null} [[x1, y1], [x2, y2]] 形式の座標配列。共有辺が無い場合はnull
 */
export function getSharedEdgePoints(h1: HexMinimal, h2: HexMinimal): number[][] | null {
    if (!h1 || !h2 || !h1.points || !h2.points) return null;

    // 座標比較の許容誤差 (浮動小数点演算対策)
    const epsilon = 0.1;
    const sharedPoints: number[][] = [];

    // 総当たりで頂点を比較
    for (const p1 of h1.points) {
        for (const p2 of h2.points) {
            if (Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon) {
                sharedPoints.push(p1);
                break; // マッチしたら次のh1の点へ
            }
        }
    }

    // 共有頂点がちょうど2つ見つかれば辺として成立
    if (sharedPoints.length === 2) {
        return sharedPoints;
    }
    return null;
}

/**
 * 2つの隣接するヘックスの共有辺の中点を計算する
 * 
 * 仕様:
 * getSharedEdgePoints で取得した2点の中間座標を返す。
 * 川の流路計算や、境界線上のポイント特定などに使用。
 * 
 * @param {object} h1 - 1つ目のヘックス
 * @param {object} h2 - 2つ目のヘックス
 * @returns {Array<number>|null} [x, y] 形式の座標。共有辺が無い場合はnull
 */
export function getSharedEdgeMidpoint(h1: HexMinimal, h2: HexMinimal): number[] | null {
    const points = getSharedEdgePoints(h1, h2);
    if (points) {
        return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    }
    return null;
}

/**
 * シード付き疑似乱数生成器 (Xorshift128+)
 * 
 * 仕様:
 * 再現性のある乱数を生成するためのクラス。
 * Math.random() はシード指定できないため、このカスタムクラスを使用する。
 * アルゴリズムには高速で品質の良い Xorshift128+ を採用。
 */
export class SeededRandom {
    private s0: number;
    private s1: number;
    private s2: number;
    private s3: number;
    public readonly initialSeed: number;

    /**
     * コンストラクタ
     * @param {number|string} seed - 乱数シード。省略時は現在時刻を使用。
     */
    constructor(seed?: number | string) {
        // シード未指定時は現在時刻
        let numericSeed: number;
        if (seed === undefined || seed === null || seed === 0) {
            numericSeed = Date.now();
        } else if (typeof seed === 'string') {
            // 文字列シード対応: 文字列をハッシュ化して数値シードに変換
            let h = 0xdeadbeef;
            for (let i = 0; i < seed.length; i++) {
                h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
            }
            numericSeed = (h ^ h >>> 16) >>> 0;
        } else {
            numericSeed = seed;
        }

        // 状態変数の初期化 (SplitMix64アルゴリズムで初期シードから内部状態を生成)
        this.s0 = this._splitmix64(numericSeed);
        this.s1 = this._splitmix64(this.s0);
        this.s2 = this._splitmix64(this.s1);
        this.s3 = this._splitmix64(this.s2);

        this.initialSeed = numericSeed;
    }

    /**
     * 初期化用ヘルパー (SplitMix64)
     * シード値から偏りのない初期状態変数を生成する
     */
    private _splitmix64(a: number): number {
        a |= 0; a = a + 0x9e3779b9 | 0;
        let t = a ^ a >>> 16;
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ t >>> 15;
        t = Math.imul(t, 0x735a2d97);
        return ((t = t ^ t >>> 15) >>> 0);
    }

    /**
     * 0以上1未満の乱数を返す (Math.random() 互換)
     * @returns {number} 0 <= n < 1
     */
    next(): number {
        // Xorshift128+ アルゴリズム
        let t = this.s3;
        const s = this.s0;
        this.s3 = this.s2;
        this.s2 = this.s1;
        this.s1 = s;

        t ^= t << 11;
        t ^= t >>> 8;
        this.s0 = t ^ s ^ (s >>> 19);

        // 符号なし32ビット整数に変換して正規化
        return (this.s0 >>> 0) / 4294967296;
    }

    /**
     * 指定された範囲の整数を返す
     * @param {number} min - 最小値 (含む)
     * @param {number} max - 最大値 (含む)
     * @returns {number} min <= n <= max の整数
     */
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
}

// グローバルなPRNGインスタンス（アプリケーション全体で共有）
export let globalRandom = new SeededRandom();

/**
 * グローバルPRNGを初期化する
 * 
 * 仕様:
 * アプリケーション起動時や、新しいマップ生成時に呼び出し、
 * 全体で使用する乱数系列をリセットする。これにより処理の再現性を確保する。
 * 
 * @param {number|string} seed - 新しいシード値
 */
export function initGlobalRandom(seed: number | string): void {
    globalRandom = new SeededRandom(seed);
    console.log(`[PRNG] Initialized with seed: ${seed}`);
}

