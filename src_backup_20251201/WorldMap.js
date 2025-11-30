
import * as config from './config.js';

// ================================================================
// ■ 定数・Enum定義
// ================================================================

export const CLIMATE_ZONES = [
    "砂漠気候(寒)", "ツンドラ気候", "亜寒帯湿潤気候", "ステップ気候",
    "地中海性気候", "温暖湿潤気候", "砂漠気候(熱)", "熱帯草原気候", "熱帯雨林気候"
];

export const VEGETATIONS = [
    "荒れ地", "針葉樹林", "砂漠", "草原", "森林", "密林", "湿地", "高山", "深海", "海洋", "湖沼"
];

export const TERRAIN_TYPES = [
    "水域", "山岳", "山地", "丘陵", "平地"
];

export const SETTLEMENT_TYPES = [
    "首都", "都市", "領都", "街", "町", "村", "散居"
];

export const RANKS = ['S', 'A', 'B', 'C', 'D'];
export const RESOURCE_RANKS = ['石', '鉄', '金', '晶'];

// 文字列からIDへのマッピング
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

export class WorldMap {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.size = cols * rows;

        // --- TypedArrays for Scalar Data ---
        // 座標 (Uint16)
        this.col = new Uint16Array(this.size);
        this.row = new Uint16Array(this.size);

        // 基本プロパティ
        this.isWater = new Uint8Array(this.size); // 0 or 1
        this.elevation = new Int16Array(this.size);
        this.temperature = new Float32Array(this.size);
        this.precipitation_mm = new Float32Array(this.size);
        this.precipitation = new Float32Array(this.size);
        this.climate = new Float32Array(this.size);
        this.flow = new Float32Array(this.size);
        this.isAlluvial = new Uint8Array(this.size);
        this.hasSnow = new Uint8Array(this.size);
        this.ridgeFlow = new Int16Array(this.size);

        // Enum IDs (Uint8)
        this.climateZoneId = new Uint8Array(this.size);
        this.vegetationId = new Uint8Array(this.size);
        this.terrainTypeId = new Uint8Array(this.size);
        this.settlementId = new Uint8Array(this.size);
        this.manaRankId = new Uint8Array(this.size);
        this.resourceRankId = new Uint8Array(this.size);
        this.monsterRankId = new Uint8Array(this.size);

        // ポテンシャル・評価 (Float32)
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

        // 人口・ID関係
        this.population = new Uint32Array(this.size);
        this.nationId = new Uint8Array(this.size);
        this.parentHexId = new Int32Array(this.size).fill(-1);
        this.territoryId = new Int32Array(this.size).fill(-1);
        this.distanceToParent = new Float32Array(this.size);
        this.travelDaysToParent = new Float32Array(this.size);
        this.roadLevel = new Uint8Array(this.size);

        // LandUse (Float32)
        this.landUse_river = new Float32Array(this.size);
        this.landUse_desert = new Float32Array(this.size);
        this.landUse_barren = new Float32Array(this.size);
        this.landUse_grassland = new Float32Array(this.size);
        this.landUse_forest = new Float32Array(this.size);

        // Neighbors (Fixed size 6 per hex, Int32)
        this.neighborsBuffer = new Int32Array(this.size * 6).fill(-1);

        // Complex Objects (Sparse Arrays)
        this.industry = new Array(this.size).fill(null);
        this.production = new Array(this.size).fill(null);
        this.surplus = new Array(this.size).fill(null);
        this.shortage = new Array(this.size).fill(null);
        this.territoryData = new Array(this.size).fill(null);

        // Road Usage (Float32)
        this.roadUsage = new Float32Array(this.size);
        this.roadLoss = new Float32Array(this.size);

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

    getHex(index) {
        // Always create a new flyweight object
        return new Hex(this, index);
    }

    // Array-like iterator
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

    // Array-like methods
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

    get length() {
        return this.size;
    }
}

// ================================================================
// ■ Hex クラス (Flyweight)
// ================================================================

class Hex {
    constructor(map, index) {
        this._map = map;
        this._index = index;
        // Properties proxy to maintain compatibility with h.properties.xxx
        this.properties = this;
    }

    get col() { return this._map.col[this._index]; }
    set col(v) { this._map.col[this._index] = v; }

    get row() { return this._map.row[this._index]; }
    set row(v) { this._map.row[this._index] = v; }

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
    get landUse() {
        return {
            river: this._map.landUse_river[this._index],
            desert: this._map.landUse_desert[this._index],
            barren: this._map.landUse_barren[this._index],
            grassland: this._map.landUse_grassland[this._index],
            forest: this._map.landUse_forest[this._index],
        };
    }
    set landUse(v) {
        if (!v) return;
        this._map.landUse_river[this._index] = v.river || 0;
        this._map.landUse_desert[this._index] = v.desert || 0;
        this._map.landUse_barren[this._index] = v.barren || 0;
        this._map.landUse_grassland[this._index] = v.grassland || 0;
        this._map.landUse_forest[this._index] = v.forest || 0;
    }

    get industry() { return this._map.industry[this._index]; }
    set industry(v) { this._map.industry[this._index] = v; }

    get production() { return this._map.production[this._index]; }
    set production(v) { this._map.production[this._index] = v; }

    get surplus() { return this._map.surplus[this._index]; }
    set surplus(v) { this._map.surplus[this._index] = v; }

    get shortage() { return this._map.shortage[this._index]; }
    set shortage(v) { this._map.shortage[this._index] = v; }

    get territoryData() { return this._map.territoryData[this._index]; }
    set territoryData(v) { this._map.territoryData[this._index] = v; }

    get roadUsage() { return this._map.roadUsage[this._index]; }
    set roadUsage(v) { this._map.roadUsage[this._index] = v; }

    get roadLoss() { return this._map.roadLoss[this._index]; }
    set roadLoss(v) { this._map.roadLoss[this._index] = v; }
}
