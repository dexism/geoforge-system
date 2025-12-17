// ================================================================
// GeoForge System - Block IO (ブロック入出力モジュール)
// ================================================================

import { BlockData, CompressedHexData } from './types.ts';
import * as config from './config.ts';
import * as blockUtils from './BlockUtils.ts';
import * as utils from './utils.ts';
import { WorldMap, Hex } from './WorldMap.ts'; // Ensure Hex is imported if available, checking WorldMap exports later
import { updateUIWithBlockData } from './ui.js';

// ================================================================
// ■ 定数・マッピング定義 (main.js から移行)
// ================================================================

// プロパティ名の短縮マッピング
// JSONサイズを削減するため、長いプロパティ名を1-3文字の短縮キーに変換する
export const KEY_MAP = {
    // 基本プロパティ
    isWater: 'w',
    elevation: 'el',
    temperature: 't',
    precipitation_mm: 'pm',
    precipitation: 'p', // 
    climate: 'c',
    climateZone: 'cz',
    vegetation: 'v',
    terrainType: 'tt',
    flow: 'fl',
    isAlluvial: 'ia',
    hasSnow: 'hs',
    isLakeside: 'il',
    beachNeighbors: 'bn',

    // マナ・資源・魔物
    manaValue: 'mv',
    manaRank: 'mr',
    resourceRank: 'rr',
    monsterRank: 'mor',

    // ポテンシャル・評価
    agriPotential: 'ap',
    forestPotential: 'fp',
    miningPotential: 'mp',
    fishingPotential: 'fip',
    huntingPotential: 'hp',
    pastoralPotential: 'pp',
    livestockPotential: 'lp',
    cultivatedArea: 'ca',
    habitability: 'hab',

    // 人口・集落・産業
    population: 'pop',
    settlement: 's',
    industry: 'ind',
    surplus: 'sur',
    shortage: 'sho',
    territoryData: 'tdat',
    nationId: 'n',
    parentHexId: 'ph',
    territoryId: 'ti',
    distanceToParent: 'dp',
    travelDaysToParent: 'td',

    // 道路関連
    roadLevel: 'rl',
    roadUsage: 'ru',
    roadLoss: 'rlo',
    landUsage: 'lu',
    waterUsage: 'wu',

    // landUse (フラット化して保存)
    'landUse.river': 'lu_r',
    'landUse.desert': 'lu_d',
    'landUse.barren': 'lu_b',
    'landUse.grassland': 'lu_g',
    'landUse.forest': 'lu_f',

    // 社会構成 (ロード時に再計算可能なため、保存時はスキップされることが多い)
    demographics: 'dem',
    facilities: 'fac',
    livingConditions: 'lc',
    logistics: 'log',
    vegetationAreas: 'va',
    downstreamIndex: 'ds',
    ridgeUpstreamIndex: 'rus'
};

// 逆マッピング（解凍用）
export const REVERSE_KEY_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

// 辞書化対象のキー (頻出する文字列値をインデックス化して圧縮する)
export const DICTIONARY_KEYS = ['cz', 'v', 'tt', 's', 'mr', 'rr'];

// 産業・領土データのキー短縮マップ
export const INDUSTRY_ITEM_MAP = {
    // 第一次産業
    '雑穀': 'mi', '大麦': 'ba', '小麦': 'wh', '稲': 'ri', '果物': 'fr', '薬草': 'he',
    '魚介類': 'fi', '木材': 'wo', '鉱石': 'or', '魔鉱石': 'mo',
    '牧畜肉': 'mp', '乳製品': 'da', '革': 'le', '魔獣素材': 'mt',
    '家畜肉': 'ml', '狩猟肉': 'mh',
    // 第二次産業
    '武具・道具': 'tl', '織物': 'tx', 'ポーション・魔導具': 'mg',
    '酒(穀物)': 'ag', '酒(果実)': 'af', '建築': 'bd',
    // 第三次産業
    '商業・交易': 'cm', '宿屋・酒場': 'in', '医療・教会': 'md', '運送・交通': 'tr',
    // 第四次産業
    '魔法研究': 'rs', '学問・歴史': 'ac', '戦略・軍事': 'mil', '情報・予言': 'it',
    // 第五次産業
    '行政・税収': 'ad', 'ギルド統括': 'gu', '芸術・文化': 'ar', '世界儀式': 'rt',
    // 領土データ用パラメータ
    'population': 'pop', 'cultivatedArea': 'ca', 'production': 'prod', 'settlementCounts': 'sc',
    '都市': 'cit', '領都': 'reg', '街': 'str', '町': 'twn', '村': 'vil', '首都': 'cap',
    // 人口構成
    '貴族': 'nob', '騎士': 'kni', '正規兵': 'sol', '衛兵・自警団': 'gua', '傭兵': 'mer',
    '農夫': 'far', '木こり': 'lum', '鉱夫': 'min', '漁師': 'fis', '牧畜民': 'pas', '狩人': 'hun',
    '職人': 'art', '商人': 'tra', '学者': 'sch', '官僚': 'bur', '神官・医師・薬師': 'pri', '冒険者': 'adv', '浮浪者': 'vag',
    '錬金術師': 'alc',
    // 施設
    '商会・商店': 'shp', '行商・露店': 'ped', '宿屋': 'inn', '酒場・食堂': 'tav',
    '鍛冶屋': 'smi', '工房': 'wor', '診療所': 'cli', '教会': 'chu', '運送屋': 'car', '厩舎': 'sta',
    '研究所': 'lab', '学校': 'col', '兵舎': 'bar', '砦': 'for', '役所': 'off', 'ギルド': 'gui',
    '劇場・美術館': 'the', '儀式場': 'rit', '魔道具店': 'mag',
    // 施設(港湾)
    '大型港湾': 'lpt', '港': 'prt', '船着き場': 'dck', '桟橋': 'pie', '渡し場': 'fer', '造船所': 'shy',
    // 物流・輸送手段
    'wagons': 'wag', 'animals': 'ani', 'ships': 'shp_l', 'drivers': 'dri',
    '馬': 'hrs', '牛': 'ox', 'ラクダ': 'cam', 'トナカイ': 'rei', '水牛': 'buf', '象': 'ele', 'ラバ': 'mul', '犬': 'dog',
    'dinghy': 'din', 'small_trader': 's_tr', 'coastal_trader': 'c_tr', 'medium_merchant': 'm_mr', 'large_sailing_ship': 'l_ss',
    '小舟': 's_bt', '商船': 'm_bt', '大型帆船': 'l_bt',
    // 生活水準
    'hunger': 'hun', 'poverty': 'pov', 'luxury': 'lux', 'security': 'sec', 'prices': 'prc',
    'tax': 'tax', 'happiness': 'hap', 'food': 'fd', 'necessities': 'nec',
    // 植生エリア (v3.4)
    'desert': 'des',
    'wasteland': 'was',
    'grassland': 'gra',
    'wetland': 'wet',
    'temperateForest': 't_for',
    'subarcticForest': 's_for',
    'tropicalRainforest': 'tr_for',
    'alpine': 'alp',
    'tundra': 'tun',
    'savanna': 'sav',
    'steppe': 'ste',
    'coastal': 'coa',
    'water': 'wat',

    // Road/River Patterns (v2.2 Block-Based)
    'roadPatterns': 'rp',
    'riverPatterns': 'rv'
};
export const REVERSE_INDUSTRY_ITEM_MAP = Object.fromEntries(Object.entries(INDUSTRY_ITEM_MAP).map(([k, v]) => [v, k]));

// 産業階層の短縮キー
export const INDUSTRY_LEVEL_MAP = {
    'primary': 'p',
    'secondary': 's',
    'tertiary': 't',
    'quaternary': 'q4',
    'quinary': 'q5'
};
export const REVERSE_INDUSTRY_LEVEL_MAP = Object.fromEntries(Object.entries(INDUSTRY_LEVEL_MAP).map(([k, v]) => [v, k]));

// ================================================================
// ■ BlockManager クラス
// ================================================================

/**
 * ブロックの読み込み状態とキューを管理するクラス
 */
export class BlockManager {
    private loadedBlockIds: Set<string>;
    private loadingBlockIds: Set<string>;
    private queue: Promise<any>;

    constructor() {
        this.loadedBlockIds = new Set();
        this.loadingBlockIds = new Set();
        this.queue = Promise.resolve();
    }

    isLoaded(blockId: string): boolean {
        return this.loadedBlockIds.has(blockId);
    }

    isLoading(blockId: string): boolean {
        return this.loadingBlockIds.has(blockId);
    }

    markAsLoading(blockId: string): void {
        this.loadingBlockIds.add(blockId);
    }

    markAsLoaded(blockId: string): void {
        this.loadingBlockIds.delete(blockId);
        this.loadedBlockIds.add(blockId);
    }

    reset(): void {
        this.loadedBlockIds.clear();
        this.loadingBlockIds.clear();
        this.queue = Promise.resolve();
    }

    /**
     * 指定されたブロックIDのデータをロードする
     * @param {string} blockId - 例: "map_50_73"
     * @param {Object} worldData - グローバルなWorldDataオブジェクト
     */
    async load(blockId: string, worldData: any): Promise<boolean | any> {
        if (this.isLoading(blockId) || this.isLoaded(blockId)) return true;

        // キューにタスクを追加（並列リクエストによる競合を防ぐため直列化）
        this.queue = this.queue.then(async () => {
            // キュー実行時に再度状態を確認
            if (this.isLoading(blockId) || this.isLoaded(blockId)) return true;
            this.markAsLoading(blockId);

            try {
                console.log(`[BlockManager] Starting load for ${blockId}`);
                // NOTE: fetch path is relative to the index.html location
                const res = await fetch(`./map/${blockId}.json`);

                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("text/html")) {
                    throw new Error("Received HTML instead of JSON (likely 404)");
                }
                if (!res.ok) throw new Error("Not found");

                const data = await res.json();

                // processLoadedDataを利用してデータを展開・統合する
                // 初期ロード時以外は重い再計算処理をスキップする (skipCalculations: true)
                // この processLoadedData は BlockIO.js 内のエクスポート関数を指す

                // [FIX] 共有バッファのクリア (Ghost Data防止)
                if (worldData) {
                    // console.log('[BlockManager] worldData exists');
                    if (worldData.allHexes) {
                        // console.log('[BlockManager] worldData.allHexes exists');
                        // [FIX] バッファクリアを有効化（ゴースト防止）
                        if (typeof worldData.allHexes.clear === 'function') {
                            worldData.allHexes.clear();
                        } else {
                            console.warn('[BlockManager] worldData.allHexes.clear is NOT a function', worldData.allHexes);
                        }
                    } else {
                        console.warn('[BlockManager] worldData.allHexes is missing');
                    }
                } else {
                    console.warn('[BlockManager] worldData is missing');
                }

                await processLoadedData(data, { skipCalculations: true, blockId: blockId, existingWorldData: worldData });

                // 新しくロードされたブロックの周囲の描画を更新するため、UI用データを更新
                // updateUIWithBlockData は ui.js からインポート
                if (worldData && worldData.allHexes) {
                    updateUIWithBlockData(blockId, worldData.allHexes);
                }

                this.markAsLoaded(blockId);
                return true;
            } catch (e) {
                // ファイルが見つからない場合などは、ダミー生成などで対応されるため、ここでは警告のみ
                console.warn(`[BlockManager] Failed to load ${blockId}:`, e);
                this.loadingBlockIds.delete(blockId);
                return false;
            }
        });

        return this.queue;
    }
}

// シングルトンインスタンスとして公開（必要に応じてnewして使う）
export const blockManager = new BlockManager();


// ================================================================
// ■ データ圧縮ロジック
// ================================================================

/**
 * ヘルパー: ネストされたオブジェクトの圧縮 (x1000整数化 + キー短縮)
 */
export const compressNestedObject = (obj) => {
    if (!obj) return null;
    const compressed = {};
    Object.entries(obj).forEach(([k, v]) => {
        const shortKey = INDUSTRY_ITEM_MAP[k] || k;
        if (typeof v === 'number') {
            // 1000倍して整数化 (小数点以下3桁まで保持)
            compressed[shortKey] = Math.round(v * 1000);
        } else if (typeof v === 'object' && v !== null) {
            compressed[shortKey] = compressNestedObject(v);
        } else {
            compressed[shortKey] = v;
        }
    });
    // 空オブジェクトならnullを返す（さらに削減）
    if (Object.keys(compressed).length === 0) return null;
    return compressed;
};

/**
 * Creates a compressed data object (dictionaries + hexes) from a list of hexes.
 * ブロック単位のエクスポートなどで使用される汎用圧縮関数。
 * @param {Array} hexList List of hex objects (or BlockHex objects)
 * @returns {Object} { dictionaries, hexes }
 */
export function createCompressedData(hexList) {
    if (!hexList) return null;

    // 1. 辞書の作成
    const dictionaries = {};
    DICTIONARY_KEYS.forEach(k => dictionaries[k] = []);

    const getDictIndex = (key, value) => {
        if (value === null || value === undefined) return null;
        let idx = dictionaries[key].indexOf(value);
        if (idx === -1) {
            idx = dictionaries[key].length;
            dictionaries[key].push(value);
        }
        return idx;
    };

    // 2. ヘックスデータの圧縮
    const compressedHexes = hexList.map(h => {
        const cHex: any = {};

        // Hexクラスのゲッターは列挙されないため、KEY_MAPとlandUseからキーリストを作成して反復
        const keysToProcess = Object.keys(KEY_MAP).filter(k => !k.includes('.'));
        keysToProcess.push('landUse');
        keysToProcess.push('blockId');

        keysToProcess.forEach(key => {
            let value = h[key];
            if (value === undefined && h.properties) {
                value = h.properties[key];
            }
            if (value === undefined) return;

            // blockIdの特別処理
            if (key === 'blockId') {
                cHex['bid'] = value;
                return;
            }

            // Road/River Patternsの特別処理
            if (key === 'roadPatterns' || key === 'riverPatterns') {
                if (Array.isArray(value)) {
                    cHex[KEY_MAP[key]] = value;
                }
                return;
            }

            // landUseの特別処理 (フラット化)
            if (key === 'landUse' && value) {
                if (value.river > 0) cHex[KEY_MAP['landUse.river']] = parseFloat(value.river.toFixed(2));
                if (value.desert > 0) cHex[KEY_MAP['landUse.desert']] = parseFloat(value.desert.toFixed(2));
                if (value.barren > 0) cHex[KEY_MAP['landUse.barren']] = parseFloat(value.barren.toFixed(2));
                if (value.grassland > 0) cHex[KEY_MAP['landUse.grassland']] = parseFloat(value.grassland.toFixed(2));
                if (value.forest > 0) cHex[KEY_MAP['landUse.forest']] = parseFloat(value.forest.toFixed(2));
                return;
            }

            const shortKey = KEY_MAP[key];
            if (!shortKey) return;

            // 辞書対象のキーか判定
            if (DICTIONARY_KEYS.includes(shortKey)) {
                const idx = getDictIndex(shortKey, value);
                if (idx !== null) cHex[shortKey] = idx;
            } else if (typeof value === 'number') {
                // 浮動小数点の丸め (座標などはそのまま)
                if (Number.isInteger(value)) {
                    cHex[shortKey] = value;
                } else {
                    cHex[shortKey] = parseFloat(value.toFixed(3));
                }
            } else if (typeof value === 'object' && value !== null) {
                // 産業・社会データ (v3.2) - ネスト圧縮
                if (key === 'industry' || key === 'demographics' || key === 'territoryData' ||
                    key === 'facilities' || key === 'livingConditions' || key === 'logistics' || key === 'vegetationAreas') {
                    cHex[shortKey] = compressNestedObject(value);
                }
            } else {
                cHex[shortKey] = value;
            }
        });

        // Coordinates (座標)
        cHex.c = h.col;
        cHex.r = h.row;
        if (h.x !== undefined) cHex.x = h.x;
        if (h.y !== undefined) cHex.y = h.y;

        return cHex;
    });

    return {
        dictionaries: dictionaries,
        hexes: compressedHexes
    };
}

/**
 * 世界データを圧縮形式に変換する共通関数
 * compressWorldData()は、worldData.allHexes全体を対象とし、GAS保存用に使用される。
 * @param {Object} worldData - グローバルなworldDataオブジェクト
 * @returns {Object} 圧縮データ
 */
export function compressWorldData(worldData) {
    if (!worldData || !worldData.allHexes) return null;

    // 1. 辞書の作成
    const dictionaries = {};
    DICTIONARY_KEYS.forEach(k => dictionaries[k] = []);

    const getDictIndex = (key, value) => {
        if (value === null || value === undefined) return null;
        let idx = dictionaries[key].indexOf(value);
        if (idx === -1) {
            idx = dictionaries[key].length;
            dictionaries[key].push(value);
        }
        return idx;
    };

    // 2. ヘックスデータの圧縮
    const compressedHexes = worldData.allHexes.map(h => {
        const cHex = {};

        // Hexクラスのゲッターは列挙されないため、KEY_MAPとlandUseからキーリストを作成して反復
        const keysToProcess = Object.keys(KEY_MAP).filter(k => !k.includes('.'));
        keysToProcess.push('landUse');

        keysToProcess.forEach(key => {
            let value = h.properties[key];

            // blockId (No short key yet, manual handling)
            if (key === 'blockId') {
                cHex['bid'] = value;
                return;
            }

            // roadPatterns / riverPatterns handling
            if (key === 'roadPatterns' || key === 'riverPatterns') return; // Handle later

            // landUseの特別処理 (フラット化)
            if (key === 'landUse' && value) {
                if (value.river > 0) cHex[KEY_MAP['landUse.river']] = parseFloat(value.river.toFixed(2));
                if (value.desert > 0) cHex[KEY_MAP['landUse.desert']] = parseFloat(value.desert.toFixed(2));
                if (value.barren > 0) cHex[KEY_MAP['landUse.barren']] = parseFloat(value.barren.toFixed(2));
                if (value.grassland > 0) cHex[KEY_MAP['landUse.grassland']] = parseFloat(value.grassland.toFixed(2));
                if (value.forest > 0) cHex[KEY_MAP['landUse.forest']] = parseFloat(value.forest.toFixed(2));
                return;
            }

            // 容量削減: ロード時に再計算可能なデータは保存しない (v3.0.1: サイズ最適化)
            if (key === 'industry' || key === 'livingConditions' || key === 'demographics' || key === 'facilities' || key === 'logistics' || key === 'vegetationAreas' || key === 'ships' || key === 'isCoastal' || key === 'isLakeside') return;

            // industryの特別処理 (ネスト圧縮) - 上記でスキップ済みだがロジック保持
            if (key === 'industry' && value) {
                // ... (Logic removed for optimization, but block retained for structure consistency if reverted)
                return;
            }

            // territoryDataの特別処理 (ネスト圧縮)
            if (key === 'territoryData' && value) {
                const cTdat = compressNestedObject(value);
                if (cTdat) cHex[KEY_MAP['territoryData']] = cTdat;
                return;
            }

            const shortKey = KEY_MAP[key];
            if (!shortKey) return;

            // デフォルト値の省略により容量削減
            if (value === null || value === undefined) return;
            if (key === 'roadLevel' && value === 0) return;
            if (key === 'nationId' && (value === 0 || isNaN(value))) return;

            if (key === 'isWater') {
                if (!value) return; // 陸地(false)は保存しない
                // 標高が0以下なら深さは自明なので保存しない... とする仕様もあるが
                // ここではelevation側で制御する。
                // 仕様.mdによると isWater (w): false, null, 0 は保存されない。
                if (!value) return;
            }
            if (key === 'flow' && value === 0) return;
            if (key === 'population' && value === 0) return;

            // 値の変換・圧縮
            if (DICTIONARY_KEYS.includes(shortKey)) {
                cHex[shortKey] = getDictIndex(shortKey, value);
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    cHex[shortKey] = value;
                } else {
                    cHex[shortKey] = parseFloat(value.toFixed(3));
                }
            } else {
                cHex[shortKey] = value;
            }
        });

        // --- NEW PROPERTIES ---
        // blockId
        if (h.properties.blockId) {
            cHex['bid'] = h.properties.blockId;
        }

        // 道路・河川パターンの保存
        if (h.properties.roadPatterns && h.properties.roadPatterns.length > 0) {
            cHex['rp'] = h.properties.roadPatterns.flatMap(x => [x.pattern, x.level, x.nationId]);
        }
        if (h.properties.riverPatterns && h.properties.riverPatterns.length > 0) {
            cHex['rv'] = h.properties.riverPatterns.flatMap(x => [x.pattern, parseFloat(x.width.toFixed(2))]);
        }

        // downstreamIndexの保存
        if (h.downstreamIndex !== undefined && h.downstreamIndex !== -1) {
            cHex[KEY_MAP['downstreamIndex']] = h.downstreamIndex;
        }

        return cHex;
    });

    // 3. 道路データの圧縮 (座標リストをフラット化)
    const compressedRoads = worldData.roadPaths ? worldData.roadPaths.map(r => {
        const cr = {
            l: r.level,
            n: r.nationId,
            p: r.path.flatMap(p => [
                Number.isInteger(p.x) ? p.x : parseFloat(p.x.toFixed(2)),
                Number.isInteger(p.y) ? p.y : parseFloat(p.y.toFixed(2))
            ])
        };

        // Attach blockId to road if possible?
        if (r.path.length > 0) {
            const start = r.path[0];
            // Global Coords -> Block ID
            const sx = Math.round(start.x);
            const sy = Math.round(start.y);
            cr['bid'] = blockUtils.getBlockIdFromGlobal(sx, sy);
        }
        return cr;
    }) : [];

    return {
        version: 2,
        seed: worldData.seed || utils.globalRandom.initialSeed || Date.now(),
        cols: config.COLS,
        rows: config.ROWS,
        dicts: dictionaries,
        hexes: compressedHexes, // Includes 'bid', 'rp', 'rv'
        roads: compressedRoads  // Includes 'bid'
    };
}

// ================================================================
// ■ データ解凍ロジック (main.js から移行)
// ================================================================

/**
 * 読み込まれたJSONデータを解析し、WorldMapインスタンスを復元する
 * @param {Object} loadedData - 解凍されたJSONデータ
 * @param {Object} options - オプション (例: { buffer: 0, existingWorldData: worldData })
 * @returns {Promise<Object>} { allHexes, roadPaths, seed }
 */
export async function processLoadedData(loadedData: any, options: any = {}): Promise<any> {
    // console.log(`[BlockIO] processLoadedData started. Data version: ${loadedData.version}`);

    let worldData;

    // 既存のWorldDataがあればそれを使用（マージモード）
    if (options.existingWorldData) {
        worldData = options.existingWorldData;
        if (!worldData.seed && loadedData.seed) worldData.seed = loadedData.seed;
    } else {
        worldData = {
            allHexes: null,
            roadPaths: [],
            seed: loadedData.seed
        };
    }

    // 1. WorldMapの初期化
    // 保存時の設定サイズがあればそれを使用、なければConfigのデフォルト
    // 注意: loadedData.rows / cols はブロック単位のROWS/COLSではなく、全体の可能性もあるが、
    // 現在の仕様では map_X_Y.json はブロック単位で保存されるため、
    // ここで `WorldMap` 全体を `config.COLS * config.ROWS` で初期化するのは、
    // 「モノリシックなロード」を前提としている。
    // ブロックベースの場合は、既存の WorldMap に対してパッチを当てる必要がある。
    // ここでは互換性維持のため、新規作成ロジックを含める。

    // ロードされたデータが「部分的（ブロック）」か「全体」かを判別する必要がある。
    // loadedData.hexes の中身を見る。

    // しかし、WorldMapは固定サイズ配列なので、動的に拡張できない。
    // main.jsではCOLS/ROWSは定数として扱われている。
    if (!worldData.allHexes) {
        worldData.allHexes = new WorldMap(config.COLS, config.ROWS);
    }

    // 2. 辞書の展開準備
    const dicts = loadedData.dictionaries || loadedData.dicts || {};
    const getDictValue = (key, idx) => {
        if (!dicts[key]) return idx;
        // V2 format: dictionaries (full names), V2.2: dicts (full names?)
        // Check if dicts[key] exists
        return dicts[key][idx];
    };

    // ヘルパー: ネストされたオブジェクトの解凍
    const decompressNestedObject = (compressedObj) => {
        if (!compressedObj) return null;
        const decompressed = {};
        Object.entries(compressedObj).forEach(([k, v]) => {
            const originalKey = REVERSE_INDUSTRY_ITEM_MAP[k] || k;
            if (typeof v === 'number') {
                // x1000されているので戻す
                decompressed[originalKey] = v / 1000;
            } else if (typeof v === 'object' && v !== null) {
                decompressed[originalKey] = decompressNestedObject(v);
            } else {
                decompressed[originalKey] = v;
            }
        });
        return decompressed;
    };

    // 3. ヘックスデータの復元
    if (loadedData.hexes) {
        loadedData.hexes.forEach(cHex => {
            // 座標の復元
            let col = cHex.c;
            let row = cHex.r;

            // 座標が無い場合はスキップ（異常データ）
            if (col === undefined || row === undefined) return;

            // Parse Block ID for coordinate translation
            let blockEE = null;
            let blockNN = null;
            const bid = options.blockId || loadedData.id;
            if (bid && bid.startsWith("map_")) {
                const parts = bid.split('_');
                if (parts.length >= 3) {
                    blockEE = parseInt(parts[1]);
                    blockNN = parseInt(parts[2]);
                }
            }

            let hex;

            if (blockEE !== null && blockNN !== null) {
                // Convert Global Coords to Local Buffer Coords
                const CORE_COL = 23;
                const CORE_ROW = 20;

                const originGlobalCol = (blockEE - blockUtils.BLOCK_START_EE) * CORE_COL;
                const originGlobalRow = (blockNN - blockUtils.BLOCK_START_NN) * CORE_ROW;

                let localCol, localRow;

                // データが既にローカル座標系の場合 (ヒューリスティック)
                if (col < 50 && row < 50) {
                    localCol = col;
                    localRow = row;
                } else {
                    localCol = col - originGlobalCol;
                    localRow = row - originGlobalRow;
                }

                if (localCol >= 0 && localCol < config.COLS && localRow >= 0 && localRow < config.ROWS) {
                    const idx = localCol + localRow * config.COLS;
                    hex = worldData.allHexes.getHex(idx);
                    // [DEBUG] 位置合わせ確認用のログ
                    if (loadedData.hexes.indexOf(cHex) < 1) {
                        // console.log(`[BlockIO Debug] Block:${bid} Local(${localCol},${localRow}) Idx:${idx} HexFound:${!!hex}`);
                    }
                } else {
                    return;
                }
            } else {
                hex = worldData.allHexes.getHex(col, row);
            }

            if (!hex) return;

            // [DEBUG] Monitor crucial property update
            const debugMonitor = (loadedData.hexes.indexOf(cHex) === 0);
            let preElev = 0;
            if (debugMonitor) preElev = hex.elevation;

            // BlockID
            if (cHex.bid) hex.properties.blockId = cHex.bid;

            // Downstream Index (Main logic used KEY_MAP)
            if (cHex[KEY_MAP['downstreamIndex']] !== undefined) {
                hex.downstreamIndex = cHex[KEY_MAP['downstreamIndex']];
            } else if (cHex.ds) { // Short key fallback if defined
                hex.downstreamIndex = cHex.ds;
            }

            // Road/River Patterns (Flattened Arrays -> Objects)
            if (cHex['rp']) {
                hex.properties.roadPatterns = [];
                for (let i = 0; i < cHex['rp'].length; i += 3) {
                    hex.properties.roadPatterns.push({
                        pattern: cHex['rp'][i],
                        level: cHex['rp'][i + 1],
                        nationId: cHex['rp'][i + 2]
                    });
                }
            }
            if (cHex['rv']) {
                hex.properties.riverPatterns = [];
                for (let i = 0; i < cHex['rv'].length; i += 2) {
                    hex.properties.riverPatterns.push({
                        pattern: cHex['rv'][i],
                        width: cHex['rv'][i + 1]
                    });
                }
            }

            // プロパティの展開
            Object.entries(cHex).forEach(([key, value]) => {
                if (['c', 'r', 'x', 'y', 'bid', 'rp', 'rv', KEY_MAP['downstreamIndex'], 'ds'].includes(key)) return;

                const originalKey = REVERSE_KEY_MAP[key];
                if (!originalKey) {
                    // if (debugMonitor) console.log(`[BlockIO Debug] Key skipped/unknown: ${key}`);
                    return;
                }

                // 特殊処理
                if (originalKey.startsWith('landUse.')) {
                    if (!hex.properties.landUse) hex.properties.landUse = {};
                    const type = originalKey.split('.')[1];
                    hex.properties.landUse[type] = value;
                    return;
                }

                if (key === 'tdat' || originalKey === 'territoryData') {
                    hex.properties.territoryData = decompressNestedObject(value);
                    return;
                }

                // 産業・社会データのネスト解凍 (v3.2)
                if (['ind', 'dem', 'fac', 'lc', 'log', 'va'].includes(key)) {
                    hex.properties[originalKey] = decompressNestedObject(value);
                    return;
                }

                // 辞書参照の解決
                if (DICTIONARY_KEYS.includes(key)) {
                    hex.properties[originalKey] = getDictValue(key, value);
                } else {
                    hex.properties[originalKey] = value;
                }

                if (debugMonitor && originalKey === 'elevation') {
                    console.log(`[BlockIO Debug] Elev Update: Key(${key})->Prop(${originalKey}) Val(${value}) Pre(${preElev}) Post(${hex.elevation})`);
                }
            });

            // 必須プロパティの補完（保存されていない場合のデフォルト値）
            // 必須プロパティの補完（保存されていない場合のデフォルト値）
            if (hex.properties.isWater === undefined) {
                // elevation <= 0 なら water とみなすロジック
                if (hex.properties.elevation !== undefined) {
                    if (hex.properties.elevation <= config.SEA_LEVEL) {
                        hex.properties.isWater = true;
                    } else {
                        hex.properties.isWater = false;
                    }
                } else {
                    hex.properties.isWater = false;
                }
            }

        }); // End forEach

        // 4. 道路データの復元 (マージ時は重複に注意だが、ロードされるブロックの道路だけが来る想定)
        if (loadedData.roads) {
            if (!worldData.roadPaths) worldData.roadPaths = [];
            const newRoads = loadedData.roads.map(cr => {
                const rawPath = cr.p;
                const path = [];
                for (let i = 0; i < rawPath.length; i += 2) {
                    path.push({ x: rawPath[i], y: rawPath[i + 1] });
                }
                return {
                    level: cr.l,
                    nationId: cr.n,
                    path: path
                };
            });
            worldData.roadPaths.push(...newRoads);
        }

        return worldData;
    }
}


// ================================================================
// ■ ブロック読み込み・統合ロジック
// ================================================================

/**
 * 初期ブロック読み込みエントリポイント
 * (互換性のため維持されているが、実際は processLoadedData を直接呼ぶか、loadBlock を呼ぶ)
 */
export async function loadInitialBlock(initialBlockId = '50_73', addLogMessage) {
    if (addLogMessage) await addLogMessage(`BlockIO: 初期ブロック(${initialBlockId})を読み込んでいます...`);

    // config.GAS_WEB_APP_URL が main.js 側にあるため、fetchBlockは外部依存性が高い。
    // いったん loadExistingWorld (main.js) からのデータ渡しを想定するが、
    // ここでは簡易的なフェッチ関数を定義しておく。

    // TODO: 実際の実装ではここで fetch する。
    // const data = await fetchBlockFromGAS(initialBlockId);
    // return processLoadedData(data);

    return null; // Placeholder
}
