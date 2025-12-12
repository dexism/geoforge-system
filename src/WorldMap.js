
import * as config from './config.js';

// ================================================================
// ■ 定数・Enum定義 (Constants & Enums)
// ================================================================

/** 気候区分 (Climate Zones) */
export const CLIMATE_ZONES = [
    "砂漠気候(寒)",
    "ツンドラ気候",
    "亜寒帯湿潤気候",
    "亜寒帯乾燥気候",
    "ステップ気候",
    "地中海性気候",
    "温暖湿潤気候",
    "亜熱帯湿潤気候",
    "砂漠気候(熱)",
    "熱帯草原気候",
    "熱帯雨林気候",
    "氷雪気候"
];

/** 植生 (Vegetations) */
export const VEGETATIONS = [
    "荒れ地", "針葉樹林", "砂漠", "草原", "森林", "密林", "湿地", "アルパイン", "深海", "海洋", "湖沼",
    "温帯林", "熱帯雨林", "亜寒帯林", "サバンナ", "ステップ", "ツンドラ", "沿岸植生", "氷雪帯"
];

/** 地形タイプ (Terrain Types) */
export const TERRAIN_TYPES = [
    "水域", "山岳", "山地", "丘陵", "平地"
];

/** 集落タイプ (Settlement Types) */
export const SETTLEMENT_TYPES = [
    "首都", "都市", "領都", "街", "町", "村", "散居"
];

/** ランク定義 (Ranks) */
export const RANKS = ['S', 'A', 'B', 'C', 'D'];
export const RESOURCE_RANKS = ['石', '鉄', '金', '晶'];

// 文字列からIDへのマッピング (Helpers for ID Mapping)
const createMap = (arr) => arr.reduce((acc, val, idx) => { acc[val] = idx + 1; return acc; }, {});
const createReverseMap = (arr) => arr.reduce((acc, val, idx) => { acc[idx + 1] = val; return acc; }, {});

const CLIMATE_ZONE_MAP = createMap(CLIMATE_ZONES);
const REVERSE_CLIMATE_ZONE_MAP = createReverseMap(CLIMATE_ZONES);

const VEGETATION_MAP = createMap(VEGETATIONS);
const REVERSE_VEGETATION_MAP = createReverseMap(VEGETATIONS);

const TERRAIN_TYPE_MAP = createMap(TERRAIN_TYPES);
const REVERSE_TERRAIN_TYPE_MAP = createReverseMap(TERRAIN_TYPES);

const SETTLEMENT_TYPE_MAP = createMap(SETTLEMENT_TYPES);
const REVERSE_SETTLEMENT_TYPE_MAP = createReverseMap(SETTLEMENT_TYPES);

const RANK_MAP = createMap(RANKS);
const REVERSE_RANK_MAP = createReverseMap(RANKS);

const RESOURCE_RANK_MAP = createMap(RESOURCE_RANKS);
const REVERSE_RESOURCE_RANK_MAP = createReverseMap(RESOURCE_RANKS);


// ================================================================
// ■ WorldMap クラス
// ================================================================

/**
 * 世界地図データを管理するクラス。
 * SoA (Structure of Arrays) パターンを採用し、データを TypedArray で管理してメモリ効率とパフォーマンスを最適化しています。
 */
export class WorldMap {
    /**
     * コンストラクタ
     * @param {number} cols - 列数
     * @param {number} rows - 行数
     */
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.size = cols * rows;

        // --- TypedArrays for Scalar Data (スカラーデータ用 TypedArray) ---
        // 座標 (Uint16)
        this.col = new Uint16Array(this.size);
        this.row = new Uint16Array(this.size);

        // 基本プロパティ (Basic Properties)
        this.isWater = new Uint8Array(this.size).fill(1); // Default to Ocean (1)
        this.elevation = new Int16Array(this.size);
        this.temperature = new Float32Array(this.size);
        this.precipitation_mm = new Float32Array(this.size);
        this.precipitation = new Float32Array(this.size);
        this.climate = new Float32Array(this.size);
        this.flow = new Float32Array(this.size);
        this.isAlluvial = new Uint8Array(this.size);
        this.hasSnow = new Uint8Array(this.size);
        this.isCoastal = new Uint8Array(this.size); // Added
        this.isLakeside = new Uint8Array(this.size); // Added
        this.ridgeFlow = new Int16Array(this.size);
        this.riverWidth = new Float32Array(this.size);
        this.riverDepth = new Float32Array(this.size);
        this.riverVelocity = new Float32Array(this.size);
        this.waterArea = new Float32Array(this.size);
        this.Qin = new Float32Array(this.size);
        this.Qin = new Float32Array(this.size); // [Duplicate Declaration Note: keeping to match original structure]
        this.inflowCount = new Uint8Array(this.size);
        this.beachArea = new Float32Array(this.size); // Added for beach calculation

        // Enum IDs (Uint8) - 文字列をIDとして保存
        this.climateZoneId = new Uint8Array(this.size);
        this.vegetationId = new Uint8Array(this.size);
        this.terrainTypeId = new Uint8Array(this.size).fill(1); // Default to Water (1)
        this.settlementId = new Uint8Array(this.size);
        this.manaRankId = new Uint8Array(this.size);
        this.resourceRankId = new Uint8Array(this.size);
        this.monsterRankId = new Uint8Array(this.size);

        // ポテンシャル・評価 (Float32) - Potentials & Evaluations
        this.manaValue = new Float32Array(this.size);
        this.agriPotential = new Float32Array(this.size);
        this.forestPotential = new Float32Array(this.size);
        this.miningPotential = new Float32Array(this.size);
        this.fishingPotential = new Float32Array(this.size);
        this.huntingPotential = new Float32Array(this.size);
        this.pastoralPotential = new Float32Array(this.size);
        this.livestockPotential = new Float32Array(this.size);
        this.cultivatedArea = new Float32Array(this.size);
        this.habitability = new Float32Array(this.size);

        // 人口・ID関係 (Population & IDs)
        this.population = new Uint32Array(this.size);
        this.nationId = new Uint8Array(this.size);
        this.parentHexId = new Int32Array(this.size).fill(-1);
        this.territoryId = new Int32Array(this.size).fill(-1);
        this.distanceToParent = new Float32Array(this.size);
        this.travelDaysToParent = new Float32Array(this.size);
        this.roadLevel = new Uint8Array(this.size);

        // LandUse (Float32) - 土地利用率
        this.landUse_river = new Float32Array(this.size);
        this.landUse_desert = new Float32Array(this.size);
        this.landUse_barren = new Float32Array(this.size);
        this.landUse_grassland = new Float32Array(this.size);
        this.landUse_barren = new Float32Array(this.size); // [Duplicate Declaration Note]
        this.landUse_grassland = new Float32Array(this.size); // [Duplicate Declaration Note]
        this.landUse_forest = new Float32Array(this.size);
        this.landUse_beach = new Float32Array(this.size); // Added for beach ratio storage

        // Neighbors (Fixed size 6 per hex, Int32) - 隣接ヘックスID (バッファ)
        this.neighborsBuffer = new Int32Array(this.size * 6).fill(-1);

        // Complex Objects (Sparse Arrays) - オジェクトデータ (疎配列)
        this.industry = new Array(this.size).fill(null);
        this.demographics = new Array(this.size).fill(null);
        this.facilities = new Array(this.size).fill(null);
        this.production = new Array(this.size).fill(null);
        this.surplus = new Array(this.size).fill(null);
        this.shortage = new Array(this.size).fill(null);
        this.territoryData = new Array(this.size).fill(null);
        this.beachNeighbors = new Array(this.size).fill(null);
        this.vegetationAreas = new Array(this.size).fill(null);
        this.logistics = new Array(this.size).fill(null); // Added
        this.livingConditions = new Array(this.size).fill(null); // Added
        this.ships = new Array(this.size).fill(null); // Added

        this.roadUsage = new Float32Array(this.size);
        this.roadLoss = new Float32Array(this.size);

        // Flow Indices (Int32) - Added for persistence (川の流出入インデックス)
        this.downstreamIndex = new Int32Array(this.size).fill(-1);
        this.ridgeUpstreamIndex = new Int32Array(this.size).fill(-1);

        // [FIX] clearメソッドをインスタンスプロパティとして定義 (Proxy回避)
        this.clear = () => {
            console.log('[WorldMap] Clearing buffer... (Instance Method)');
            this.col.fill(0);
            this.row.fill(0);

            this.isWater.fill(1);
            this.elevation.fill(0);
            this.temperature.fill(0);
            this.precipitation_mm.fill(0);
            this.precipitation.fill(0);
            this.climate.fill(0);
            this.flow.fill(0);
            this.isAlluvial.fill(0);
            this.hasSnow.fill(0);
            this.isCoastal.fill(0);
            this.isLakeside.fill(0);
            this.ridgeFlow.fill(0);
            this.riverWidth.fill(0);
            this.riverDepth.fill(0);
            this.riverVelocity.fill(0);
            this.waterArea.fill(0);
            this.Qin.fill(0);
            this.inflowCount.fill(0);
            this.beachArea.fill(0);

            this.climateZoneId.fill(0);
            this.vegetationId.fill(0);
            this.terrainTypeId.fill(1);
            this.settlementId.fill(0);
            this.manaRankId.fill(0);
            this.resourceRankId.fill(0);
            this.monsterRankId.fill(0);

            this.manaValue.fill(0);
            this.agriPotential.fill(0);
            this.forestPotential.fill(0);
            this.miningPotential.fill(0);
            this.fishingPotential.fill(0);
            this.huntingPotential.fill(0);
            this.pastoralPotential.fill(0);
            this.livestockPotential.fill(0);
            this.cultivatedArea.fill(0);
            this.habitability.fill(0);

            this.population.fill(0);
            this.nationId.fill(0);
            this.parentHexId.fill(-1);
            this.territoryId.fill(-1);
            this.distanceToParent.fill(0);
            this.travelDaysToParent.fill(0);
            this.roadLevel.fill(0);

            this.landUse_river.fill(0);
            this.landUse_desert.fill(0);
            this.landUse_barren.fill(0);
            this.landUse_grassland.fill(0);
            this.landUse_forest.fill(0);
            this.landUse_beach.fill(0);

            this.neighborsBuffer.fill(-1);

            this.roadUsage.fill(0);
            this.roadLoss.fill(0);
            this.downstreamIndex.fill(-1);
            this.ridgeUpstreamIndex.fill(-1);

            this.industry.fill(null);
            this.demographics.fill(null);
            this.facilities.fill(null);
            this.production.fill(null);
            this.surplus.fill(null);
            this.shortage.fill(null);
            this.territoryData.fill(null);
            this.beachNeighbors.fill(null);
            this.vegetationAreas.fill(null);
            this.logistics.fill(null);
            this.livingConditions.fill(null);
            this.ships.fill(null);
        };

        // 配列のようなアクセスを可能にするプロキシ
        return new Proxy(this, {
            get: (target, prop) => {
                if (typeof prop === 'string' && !isNaN(prop)) {
                    const index = parseInt(prop, 10);
                    if (index >= 0 && index < target.size) {
                        return target.getHex(index);
                    }
                }
                return target[prop];
            }
        });

    }

/**
 * 指定されたインデックスの Hex オブジェクト (Flyweight) を取得します。
 * @param {number} index 
 * @returns {Hex}
 */
getHex(index) {
    // Always create a new flyweight object
    return new Hex(this, index);
}

// Array-like iterator (イテレータ実装)
[Symbol.iterator]() {
    let index = 0;
    return {
        next: () => {
            if (index < this.size) {
                return { value: this.getHex(index++), done: false };
            } else {
                return { done: true };
            }
        }
    };
}

// Array-like methods (配列風メソッド)

forEach(callback) {
    for (let i = 0; i < this.size; i++) {
        callback(this.getHex(i), i, this);
    }
}

map(callback) {
    const result = [];
    for (let i = 0; i < this.size; i++) {
        result.push(callback(this.getHex(i), i, this));
    }
    return result;
}

filter(callback) {
    const result = [];
    for (let i = 0; i < this.size; i++) {
        const hex = this.getHex(i);
        if (callback(hex, i, this)) {
            result.push(hex);
        }
    }
    return result;
}

find(callback) {
    for (let i = 0; i < this.size; i++) {
        const hex = this.getHex(i);
        if (callback(hex, i, this)) {
            return hex;
        }
    }
    return undefined;
}

some(callback) {
    for (let i = 0; i < this.size; i++) {
        if (callback(this.getHex(i), i, this)) {
            return true;
        }
    }
    return false;
}

    // [Duplicate Method Note: forEach appeared twice in original]
    // Keeping for strict integrity if needed, but safer to remove duplicate in refactor.
    // However, tool instruction is to add comments. I will comment out duplicate or merge.
    // The original code had two forEach methods. I will simply keep one commented/merged.
    /*
    forEach(callback) {
        for (let i = 0; i < this.size; i++) {
            callback(this.getHex(i), i, this);
        }
    }
    */

    get length() {
    return this.size;
}
}


// ================================================================
// ■ Hex クラス (Flyweight)
// ================================================================

/**
 * 個々のヘックスデータを操作するための Flyweight オブジェクト。
 * 実体は持たず、WorldMap の TypedArray への参照を通じてデータを読み書きします。
 * これにより、メモリ使用量を大幅に削減しています。
 */
class Hex {
    /**
     * コンストラクタ
     * @param {WorldMap} map - 親となる WorldMap インスタンス
     * @param {number} index - ヘックスのインデックス
     */
    constructor(map, index) {
        this._map = map;
        this._index = index;
        // Properties proxy to maintain compatibility with h.properties.xxx
        // 従来の h.properties.xxx というアクセス方法との互換性を維持するためのプロキシ
        this.properties = this;
    }

    get index() { return this._index; }

    // Compatibility aliases for UI (UI互換用エイリアス)
    get x() { return this.col; }
    get y() { return this.row; }


    /**
     * ピクセルX座標 (Flat-Top Geometry)
     * v3.2: UIの描画ロジックに合わせて Flat-Top ジオメトリを採用。
     */
    get cx() {
        // v3.2: Flat-Top Geometry (matches ui.js and neighbor logic)
        // width = 2 * r (but ui.js implies sqrt(3)*r?? No, let's trust neighbor logic which is Flat Top)
        // OR ui.js is Pointy Top but oriented weirdly?
        // User said "Minimap internal not drawn... Regenerated display shows weird aspect ratio" when I used Pointy Top logic.
        // So I must use Flat Top logic.
        const r = config.r;
        const width = 2 * r; // Flat Top Width
        return this.col * (width * 0.75);
    }

    /**
     * ピクセルY座標 (Flat-Top Geometry)
     */
    get cy() {
        const r = config.r;
        const height = Math.sqrt(3) * r; // Flat Top Height
        const offset = (this.col % 2 !== 0) ? height / 2 : 0; // Odd-Q offset (col parity)
        return this.row * height + offset;
    }

    /**
     * 頂点座標配列を取得
     * @returns {Array<Array<number>>} [[x1,y1], [x2,y2], ...]
     */
    get points() {
        const r = config.r;
        const cx = this.cx;
        const cy = this.cy;
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle_deg = 60 * i; // Flat Top: 0, 60, 120...
            const angle_rad = Math.PI / 180 * angle_deg;
            points.push([
                cx + r * Math.cos(angle_rad),
                cy + r * Math.sin(angle_rad)
            ]);
        }
        return points;
    }

    get col() { return this._map.col[this._index]; }
    set col(v) { this._map.col[this._index] = v; }

    get row() { return this._map.row[this._index]; }
    set row(v) { this._map.row[this._index] = v; }

    /**
     * 隣接ヘックスのID配列を取得
     * @returns {number[]}
     */
    get neighbors() {
        const start = this._index * 6;
        const result = [];
        for (let i = 0; i < 6; i++) {
            const nIdx = this._map.neighborsBuffer[start + i];
            if (nIdx !== -1) {
                result.push(nIdx);
            }
        }
        return result;
    }

    /**
     * 隣接ヘックスを設定
     * @param {number[]} indices
     */
    set neighbors(indices) {
        const start = this._index * 6;
        for (let i = 0; i < 6; i++) {
            this._map.neighborsBuffer[start + i] = (i < indices.length) ? indices[i] : -1;
        }
    }


    // --- Boolean / Uint8 ---
    get isWater() { return !!this._map.isWater[this._index]; }
    set isWater(v) { this._map.isWater[this._index] = v ? 1 : 0; }

    get isAlluvial() { return !!this._map.isAlluvial[this._index]; }
    set isAlluvial(v) { this._map.isAlluvial[this._index] = v ? 1 : 0; }

    get hasSnow() { return !!this._map.hasSnow[this._index]; }
    set hasSnow(v) { this._map.hasSnow[this._index] = v ? 1 : 0; }

    get isCoastal() { return !!this._map.isCoastal[this._index]; }
    set isCoastal(v) { this._map.isCoastal[this._index] = v ? 1 : 0; }

    get isLakeside() { return !!this._map.isLakeside[this._index]; }
    set isLakeside(v) { this._map.isLakeside[this._index] = v ? 1 : 0; }

    // --- Numeric ---
    get elevation() { return this._map.elevation[this._index]; }
    set elevation(v) { this._map.elevation[this._index] = v; }

    get temperature() { return this._map.temperature[this._index]; }
    set temperature(v) { this._map.temperature[this._index] = v; }

    get precipitation_mm() { return this._map.precipitation_mm[this._index]; }
    set precipitation_mm(v) { this._map.precipitation_mm[this._index] = v; }

    get precipitation() { return this._map.precipitation[this._index]; }
    set precipitation(v) { this._map.precipitation[this._index] = v; }

    get climate() { return this._map.climate[this._index]; } // numeric value in code
    set climate(v) { this._map.climate[this._index] = v; }

    get flow() { return this._map.flow[this._index]; }
    set flow(v) { this._map.flow[this._index] = v; }

    get ridgeFlow() { return this._map.ridgeFlow[this._index]; }
    set ridgeFlow(v) { this._map.ridgeFlow[this._index] = v; }

    get riverWidth() { return this._map.riverWidth[this._index]; }
    set riverWidth(v) { this._map.riverWidth[this._index] = v; }

    get riverDepth() { return this._map.riverDepth[this._index]; }
    set riverDepth(v) { this._map.riverDepth[this._index] = v; }

    get riverVelocity() { return this._map.riverVelocity[this._index]; }
    set riverVelocity(v) { this._map.riverVelocity[this._index] = v; }

    get waterArea() { return this._map.waterArea[this._index]; }
    set waterArea(v) { this._map.waterArea[this._index] = v; }

    get Qin() { return this._map.Qin[this._index]; }
    set Qin(v) { this._map.Qin[this._index] = v; }

    get inflowCount() { return this._map.inflowCount[this._index]; }
    get inflowCount() { return this._map.inflowCount[this._index]; }
    set inflowCount(v) { this._map.inflowCount[this._index] = v; }

    get beachArea() { return this._map.beachArea[this._index]; }
    set beachArea(v) { this._map.beachArea[this._index] = v; }


    get manaValue() { return this._map.manaValue[this._index]; }
    set manaValue(v) { this._map.manaValue[this._index] = v; }

    get agriPotential() { return this._map.agriPotential[this._index]; }
    set agriPotential(v) { this._map.agriPotential[this._index] = v; }

    get forestPotential() { return this._map.forestPotential[this._index]; }
    set forestPotential(v) { this._map.forestPotential[this._index] = v; }

    get miningPotential() { return this._map.miningPotential[this._index]; }
    set miningPotential(v) { this._map.miningPotential[this._index] = v; }

    get fishingPotential() { return this._map.fishingPotential[this._index]; }
    set fishingPotential(v) { this._map.fishingPotential[this._index] = v; }

    get huntingPotential() { return this._map.huntingPotential[this._index]; }
    set huntingPotential(v) { this._map.huntingPotential[this._index] = v; }

    get pastoralPotential() { return this._map.pastoralPotential[this._index]; }
    set pastoralPotential(v) { this._map.pastoralPotential[this._index] = v; }

    get livestockPotential() { return this._map.livestockPotential[this._index]; }
    set livestockPotential(v) { this._map.livestockPotential[this._index] = v; }

    get cultivatedArea() { return this._map.cultivatedArea[this._index]; }
    set cultivatedArea(v) { this._map.cultivatedArea[this._index] = v; }

    get habitability() { return this._map.habitability[this._index]; }
    set habitability(v) { this._map.habitability[this._index] = v; }

    get population() { return this._map.population[this._index]; }
    set population(v) { this._map.population[this._index] = v; }

    get nationId() { return this._map.nationId[this._index]; }
    set nationId(v) { this._map.nationId[this._index] = v; }

    get parentHexId() {
        const v = this._map.parentHexId[this._index];
        return v === -1 ? null : v;
    }
    set parentHexId(v) { this._map.parentHexId[this._index] = (v === null) ? -1 : v; }

    get territoryId() {
        const v = this._map.territoryId[this._index];
        return v === -1 ? null : v;
    }
    set territoryId(v) { this._map.territoryId[this._index] = (v === null) ? -1 : v; }

    get distanceToParent() { return this._map.distanceToParent[this._index]; }
    set distanceToParent(v) { this._map.distanceToParent[this._index] = v; }

    get travelDaysToParent() { return this._map.travelDaysToParent[this._index]; }
    set travelDaysToParent(v) { this._map.travelDaysToParent[this._index] = v; }

    get downstreamIndex() { return this._map.downstreamIndex[this._index]; }
    set downstreamIndex(v) { this._map.downstreamIndex[this._index] = v; }

    get ridgeUpstreamIndex() { return this._map.ridgeUpstreamIndex[this._index]; }
    set ridgeUpstreamIndex(v) { this._map.ridgeUpstreamIndex[this._index] = v; }

    get roadLevel() { return this._map.roadLevel[this._index]; }
    set roadLevel(v) { this._map.roadLevel[this._index] = v; }

    // --- Enums ---
    get climateZone() { return REVERSE_CLIMATE_ZONE_MAP[this._map.climateZoneId[this._index]] || null; }
    set climateZone(v) { this._map.climateZoneId[this._index] = CLIMATE_ZONE_MAP[v] || 0; }

    get vegetation() { return REVERSE_VEGETATION_MAP[this._map.vegetationId[this._index]] || null; }
    set vegetation(v) { this._map.vegetationId[this._index] = VEGETATION_MAP[v] || 0; }

    get terrainType() { return REVERSE_TERRAIN_TYPE_MAP[this._map.terrainTypeId[this._index]] || null; }
    set terrainType(v) { this._map.terrainTypeId[this._index] = TERRAIN_TYPE_MAP[v] || 0; }

    get settlement() { return REVERSE_SETTLEMENT_TYPE_MAP[this._map.settlementId[this._index]] || null; }
    set settlement(v) { this._map.settlementId[this._index] = SETTLEMENT_TYPE_MAP[v] || 0; }

    get manaRank() { return REVERSE_RANK_MAP[this._map.manaRankId[this._index]] || null; }
    set manaRank(v) { this._map.manaRankId[this._index] = RANK_MAP[v] || 0; }

    get resourceRank() { return REVERSE_RESOURCE_RANK_MAP[this._map.resourceRankId[this._index]] || null; }
    set resourceRank(v) { this._map.resourceRankId[this._index] = RESOURCE_RANK_MAP[v] || 0; }

    get monsterRank() { return REVERSE_RANK_MAP[this._map.monsterRankId[this._index]] || null; }
    set monsterRank(v) { this._map.monsterRankId[this._index] = RANK_MAP[v] || 0; }

    // --- Complex Objects ---

    /**
     * 土地利用データを取得 (常に新しいオブジェクトを返します)
     */
    get landUse() {
        return {
            river: this._map.landUse_river[this._index],
            desert: this._map.landUse_desert[this._index],
            barren: this._map.landUse_barren[this._index],
            grassland: this._map.landUse_grassland[this._index],
            forest: this._map.landUse_forest[this._index],
            beach: this._map.landUse_beach[this._index],
        };
    }

    /**
     * 土地利用データを設定
     * @param {Object} v
     */
    set landUse(v) {
        if (!v) return;
        this._map.landUse_river[this._index] = v.river || 0;
        this._map.landUse_desert[this._index] = v.desert || 0;
        this._map.landUse_barren[this._index] = v.barren || 0;
        this._map.landUse_grassland[this._index] = v.grassland || 0;
        this._map.landUse_forest[this._index] = v.forest || 0;
        this._map.landUse_beach[this._index] = v.beach || 0;
    }

    get industry() { return this._map.industry[this._index]; }
    set industry(v) { this._map.industry[this._index] = v; }

    get demographics() { return this._map.demographics[this._index]; }
    set demographics(v) { this._map.demographics[this._index] = v; }

    get facilities() { return this._map.facilities[this._index]; }
    set facilities(v) { this._map.facilities[this._index] = v; }

    get production() { return this._map.production[this._index]; }
    set production(v) { this._map.production[this._index] = v; }

    get surplus() { return this._map.surplus[this._index]; }
    set surplus(v) { this._map.surplus[this._index] = v; }

    get shortage() { return this._map.shortage[this._index]; }
    set shortage(v) { this._map.shortage[this._index] = v; }

    get territoryData() { return this._map.territoryData[this._index]; }
    set territoryData(v) { this._map.territoryData[this._index] = v; }

    get beachNeighbors() { return this._map.beachNeighbors[this._index]; }
    set beachNeighbors(v) { this._map.beachNeighbors[this._index] = v; }

    get vegetationAreas() { return this._map.vegetationAreas[this._index]; }
    set vegetationAreas(v) { this._map.vegetationAreas[this._index] = v; }

    get logistics() { return this._map.logistics[this._index]; }
    set logistics(v) { this._map.logistics[this._index] = v; }

    get livingConditions() { return this._map.livingConditions[this._index]; }
    set livingConditions(v) { this._map.livingConditions[this._index] = v; }

    get ships() { return this._map.ships[this._index]; }
    set ships(v) { this._map.ships[this._index] = v; }


    get roadUsage() { return this._map.roadUsage[this._index]; }
    set roadUsage(v) { this._map.roadUsage[this._index] = v; }

    get roadLoss() { return this._map.roadLoss[this._index]; }
    set roadLoss(v) { this._map.roadLoss[this._index] = v; }


    /**
     * プロパティをプレーンオブジェクトとしてエクスポートする
     * (スプレッド構文などでのコピー用)
     * @returns {Object}
     */
    toObject() {
        return {
            index: this.index,
            col: this.col,
            row: this.row,

            isWater: this.isWater,
            isAlluvial: this.isAlluvial,
            hasSnow: this.hasSnow,
            isCoastal: this.isCoastal,
            isLakeside: this.isLakeside,

            elevation: this.elevation,
            temperature: this.temperature,
            precipitation_mm: this.precipitation_mm,
            precipitation: this.precipitation,
            climate: this.climate,
            flow: this.flow,
            ridgeFlow: this.ridgeFlow,
            riverWidth: this.riverWidth,
            riverDepth: this.riverDepth,
            riverVelocity: this.riverVelocity,
            waterArea: this.waterArea,
            beachArea: this.beachArea,
            inflowCount: this.inflowCount,
            Qin: this.Qin,

            climateZone: this.climateZone,
            vegetation: this.vegetation,
            terrainType: this.terrainType,
            settlement: this.settlement,
            manaRank: this.manaRank,
            resourceRank: this.resourceRank,
            monsterRank: this.monsterRank,

            landUse: this.landUse, // getter returns new object
            industry: this.industry,
            demographics: this.demographics,
            facilities: this.facilities,
            production: this.production,
            surplus: this.surplus,
            shortage: this.shortage,

            nationId: this.nationId,
            territoryId: this.territoryId,
            parentHexId: this.parentHexId,
            distanceToParent: this.distanceToParent,
            travelDaysToParent: this.travelDaysToParent,
            roadLevel: this.roadLevel,
            roadUsage: this.roadUsage,
            roadLoss: this.roadLoss,

            territoryData: this.territoryData,
            beachNeighbors: this.beachNeighbors,
            vegetationAreas: this.vegetationAreas,

            downstreamIndex: this.downstreamIndex,
            ridgeUpstreamIndex: this.ridgeUpstreamIndex,

            manaValue: this.manaValue,
            agriPotential: this.agriPotential,
            forestPotential: this.forestPotential,
            miningPotential: this.miningPotential,
            fishingPotential: this.fishingPotential,
            huntingPotential: this.huntingPotential,
            pastoralPotential: this.pastoralPotential,
            livestockPotential: this.livestockPotential,
            cultivatedArea: this.cultivatedArea,
            habitability: this.habitability,
            population: this.population,

            // Added for Info Window display
            logistics: this.logistics,
            livingConditions: this.livingConditions,
            ships: this.ships
        };
    }

}

// Iterator implementation for WorldMap (イテレータの実装)
WorldMap.prototype[Symbol.iterator] = function* () {
    for (let i = 0; i < this.size; i++) {
        yield this.getHex(i);
    }
};
