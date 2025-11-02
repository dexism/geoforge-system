// ================================================================
// GeoForge System - 設定ファイル
// ================================================================

import * as d3 from 'd3';

// ----------------------------------------------------------------
// ■ 基本設定
// ----------------------------------------------------------------
export const COLS = 100;
export const ROWS = 87;
export const HEX_SIZE_KM = 20; // 1ヘックスの差し渡し距離 (km)
export const r = 20; // 描画用のヘックス半径 (pixel)

// ----------------------------------------------------------------
// ■ 地形生成パラメータ
// ----------------------------------------------------------------
export const NOISE_SCALE =               0.05; 
export const LAND_BIAS =                 0.7; 
export const ELEVATION_PEAK_FACTOR =     2.0; 
export const CONTINENT_FALLOFF_FACTOR =  4.0;
export const LAKE_THRESHOLD_PLAINS =    -0.90;
export const LAKE_THRESHOLD_MOUNTAINS = -0.85;
export const elevationScale = d3.scaleLinear().domain([0.0, 1.6]).range([0, 7000]).clamp(true);
export const lakeThresholdScale = d3.scaleLinear()
    .domain([0.3, 1.3])
    .range([LAKE_THRESHOLD_PLAINS, LAKE_THRESHOLD_MOUNTAINS])
    .clamp(true);

// ----------------------------------------------------------------
// ■ 気候・植生関連の定義
// ----------------------------------------------------------------
export const VEGETATION_THRESHOLDS = {
    ALPINE_ELEVATION: 4000, 
    TUNDRA_TEMP:  -10, 
    DESERT_PRECIP: 0.04,
    JUNGLE_MIN_PRECIP: 0.10, 
    FOREST_MIN_PRECIP: 0.10,
    SPARSE_MIN_PRECIP: 0.10, 
    TAIGA_MIN_PRECIP: 0.00,
};

export const SNOW_THRESHOLDS = {
    TEMPERATURE: -10,
    PRECIPITATION_LIGHT: 0.1,
    PRECIPITATION_HEAVY: 0.4,
};

export const TEMP_ZONES = { COLD: 0, TEMPERATE: 20 };
export const PRECIP_ZONES = { DRY: 0.35, MODERATE: 0.65 };

// ----------------------------------------------------------------
// ■ 配色設定
// ----------------------------------------------------------------
// 標高グラデーション
const elevationColor_0_1k = d3.scaleLinear().domain([0, 1000]).range(['#d8ecd3', '#a8d5a2']);
const elevationColor_1k_2k = d3.scaleLinear().domain([1000, 2000]).range(['#a8d5a2', '#dcd5c9']);
const elevationColor_2k_3k = d3.scaleLinear().domain([2000, 3000]).range(['#dcd5c9', '#c2a383']);
const elevationColor_3k_4k = d3.scaleLinear().domain([3000, 4000]).range(['#c2a383', '#b0b0b0']);
const elevationColor_4k_plus = d3.scaleLinear().domain([4000, 7000]).range(['#b0b0b0', '#ffffff']);

export function getElevationColor(elevation) {
    if (elevation < 1000) return elevationColor_0_1k(elevation);
    if (elevation < 2000) return elevationColor_1k_2k(elevation);
    if (elevation < 3000) return elevationColor_2k_3k(elevation);
    if (elevation < 4000) return elevationColor_3k_4k(elevation);
    return elevationColor_4k_plus(elevation);
}

// 地形・植生の固定色
export const TERRAIN_COLORS = {
    深海: '#136', 
    海洋: '#248', 
    湖沼: '#058',
    砂漠: '#e8d9b5', 
    森林: '#6aa84f', 
    針葉樹林: '#3b6e4f', 
    密林: '#1b5e20',
};

// 気候帯の色
export const CLIMATE_ZONE_COLORS = {
    "砂漠気候(寒)":   '#d2b48c',
    "ツンドラ気候":   '#5dade2',
    "亜寒帯湿潤気候": '#2874a6',
    "ステップ気候":   '#e67e22',
    "地中海性気候":   '#58d68d',
    "温暖湿潤気候":   '#239b56',
    "砂漠気候(熱)":   '#f4d03f',
    "熱帯草原気候":   '#f5b041',
    "熱帯雨林気候":   '#145a32'
};

// オーバーレイ用カラーマップ
export const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]);
export const tempColor = d3.scaleSequential(d3.interpolateTurbo).domain([-15, 35]);
export const precipColor = d3.scaleSequential(d3.interpolateBlues).domain([0, 1]);
export const agriColor = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);
export const forestColor = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
export const miningColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);
export const fishingColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]);
export const populationColor = d3.scaleLinear().domain([0, 150000]).range(["black", "red"]);

// ----------------------------------------------------------------
// ■ 文明生成パラメータ
// ----------------------------------------------------------------
export const MIN_DISTANCES = { '都': 20, '街': 10, '町': 4 };
export const NUM_CAPITALS = 3;
export const NUM_CITIES = 8;
export const HUB_SEARCH_RADIUS = 10;

// ----------------------------------------------------------------
// ■ 経済シミュレーションパラメータ
// ----------------------------------------------------------------
export const HEX_AREA_HA = 34641; // 1ヘックスの面積 (ha)

export const CROP_DATA = {
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲':   { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
};

export const SETTLEMENT_PARAMS = {
    '都':     { labor_rate: 0.25, consumption_t_per_person: 0.30, infra_coeff: 1.1, head_cap_base: 0.40, head_cap_bonus: 0.10 },
    '街':     { labor_rate: 0.40, consumption_t_per_person: 0.25, infra_coeff: 1.05, head_cap_base: 0.35, head_cap_bonus: 0.05 },
    '町':     { labor_rate: 0.60, consumption_t_per_person: 0.22, infra_coeff: 1.0, head_cap_base: 0.30, head_cap_bonus: 0.0 },
    '村':     { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.9, head_cap_base: 0.25, head_cap_bonus: 0.0 },
    '散居':   { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.85, head_cap_base: 0.20, head_cap_bonus: 0.0 }
};