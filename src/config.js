// ================================================================
// GeoForge System - 設定ファイル
// ================================================================

import * as d3 from 'd3';

// ----------------------------------------------------------------
// ■ 基本設定
// ----------------------------------------------------------------
export const COLS = 115;
export const ROWS = 100; 
export const HEX_SIZE_KM = 10; // 1ヘックスの差し渡し距離 (km)
export const r = 20; // 描画用のヘックス半径 (pixel)

// ----------------------------------------------------------------
// ■ 地形生成パラメータ
// ----------------------------------------------------------------
export const NOISE_SCALE =               0.05; 
export const LAND_BIAS =                 0.6; 
export const ELEVATION_PEAK_FACTOR =     5.0; 
export const CONTINENT_FALLOFF_FACTOR =  5.0;
export const LAKE_THRESHOLD_PLAINS =    -0.90;
export const LAKE_THRESHOLD_MOUNTAINS = -0.85;
export const elevationScale = d3.scaleLinear().domain([0.0, 1.6]).range([0, 7000]).clamp(true);
export const lakeThresholdScale = d3.scaleLinear()
    .domain([0.3, 1.3])
    .range([LAKE_THRESHOLD_PLAINS, LAKE_THRESHOLD_MOUNTAINS])
    .clamp(true);

// ★★★ [新規] 中央平野生成用のパラメータ ★★★
export const CENTRAL_PLAIN_RADIUS =   0.8; // 平野を生成する範囲（マップ半径の0-1）
export const CENTRAL_PLAIN_FLATNESS = 1.0; // 中心の標高を抑制する強さ（0-1抑制）

// ★★★ [新規] 地形分類のための標高しきい値 ★★★
export const TERRAIN_ELEVATION = {
    MOUNTAIN_PEAK: 3000, // これ以上は「山岳」
    MOUNTAIN: 2000,      // これ以上は「山地」
    HILLS: 1000           // これ以上は「丘陵」
};

// ----------------------------------------------------------------
// ■ 気候・植生関連の定義
// ----------------------------------------------------------------
export const VEGETATION_THRESHOLDS = {
    ALPINE_ELEVATION: 4000, 
    TUNDRA_TEMP:  -10, 
    DESERT_PRECIP: 0.04,
    JUNGLE_MIN_PRECIP: 0.10, 
    FOREST_MIN_PRECIP: 0.05,
    SPARSE_MIN_PRECIP: 0.10, 
    TAIGA_MIN_PRECIP: 0.00,
};

export const SNOW_THRESHOLDS = {
    TEMPERATURE: -10,
    PRECIPITATION_LIGHT: 0.1,
    PRECIPITATION_HEAVY: 0.4,
};

export const TEMP_ZONES = { COLD: 0, TEMPERATE: 20 };
export const PRECIP_ZONES = { DRY: 0.40, MODERATE: 0.70 };

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
export const populationColor = d3.scaleLog().domain([1, 150000]).range(["black", "red"]).clamp(true);

// ★★★ [新規] 白地図モード用の配色 ★★★
export const WHITE_MAP_COLORS = {
    LAND:         '#fff', // 平地・丘陵
    MOUNTAIN:     '#fee', // 山地
    MOUNTAIN_PEAK:'#edd', // 山岳
    WATER:        '#bbb', // 海・湖・川
};

// ----------------------------------------------------------------
// ■ 文明生成パラメータ
// ----------------------------------------------------------------
export const NUM_NATIONS = 4; // 国家の数
export const NATION_NAMES = [
    "アルファ国", 
    "ブラボー国", 
    "チャーリー国", 
    "デルタ国",
    "エコー国", 
    "フォクストロット国", 
    "ゴルフ国", 
    "ホテル国"
];
export const CAPITAL_MIN_DISTANCE = 40; // 国家間の首都の最低距離
export const CITY_MIN_DISTANCE = 15;    // 主要都市間の最低距離
export const TOWN_MIN_DISTANCE = 5;     // 街や町との最低距離

// 国家ごとの都市数に関する設定
export const CITIES_PER_NATION = 2; // 「都市」の数
export const REGIONAL_CAPITALS_PER_NATION = 5; // 「領都」の数
export const TOWNS_PER_NATION = 10; // 「街」の数

// 辺境設定
export const FRONTIER_DISTANCE_THRESHOLD = 35; // 首都からこの距離以上離れると辺境の可能性

// 居住地の階層定義 (数値が大きいほど上位)
export const SETTLEMENT_HIERARCHY = {
    '首都': 6,
    '都市': 5,
    '領都': 4,
    '街':   3,
    '町':   2,
    '村':   1,
    '散居': 0
};

// ----------------------------------------------------------------
// ■ 経済シミュレーションパラメータ
// ----------------------------------------------------------------
export const HEX_AREA_HA = 8660; // 1ヘックスの面積 (ha) - 10kmスケールに合わせて修正

export const CROP_DATA = {
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲':   { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
};

export const SETTLEMENT_PARAMS = {
    '首都': { labor_rate: 0.20, consumption_t_per_person: 0.32, infra_coeff: 1.2, head_cap_base: 0.30, head_cap_bonus: 0.15 },
    '都市': { labor_rate: 0.30, consumption_t_per_person: 0.28, infra_coeff: 1.1, head_cap_base: 0.25, head_cap_bonus: 0.10 },
    '領都': { labor_rate: 0.45, consumption_t_per_person: 0.24, infra_coeff: 1.05, head_cap_base: 0.30, head_cap_bonus: 0.05 },
    '街':   { labor_rate: 0.55, consumption_t_per_person: 0.22, infra_coeff: 1.0, head_cap_base: 0.35, head_cap_bonus: 0.0 },
    '町':   { labor_rate: 0.70, consumption_t_per_person: 0.21, infra_coeff: 0.95, head_cap_base: 0.40, head_cap_bonus: 0.0 },
    '村':   { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.9, head_cap_base: 0.60, head_cap_bonus: 0.0 },
    '散居': { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.85, head_cap_base: 0.50, head_cap_bonus: 0.0 }
};

// ■ 道のり計算用の地形乗数
export const TERRAIN_MULTIPLIERS = {
    '平地': 1.4,
    '森林': 1.6,
    '密林': 1.8,
    '丘陵': 1.8,
    '山地': 2.0,
    '山岳': 2.5,
    RIVER_BONUS: 0.3 // 河川がある場合の追加乗数
};

// ■ 道のり計算用の道路整備乗数
export const ROAD_MULTIPLIERS = {
    5: 0.8,  // 交易路
    4: 0.9,  // 街道
    3: 0.95, // 町道
    2: 1.0,  // 村道
    1: 1.0   // 村道以下
};

// ★★★ [新規] 輸送・移動パラメータ ★★★
export const WAGON_PARAMS = {
    BASE_SPEED_KMH: 3.5,            // 荷馬車の基準速度 (km/h)
    OPERATING_HOURS_PER_DAY: 7.0,   // 1日の基準運行時間 (h)

    // 道路レベルごとの速度乗数
    ROAD_SPEED_MULTIPLIERS: {
        5: 1.25, // 交易路
        4: 1.15, // 街道
        3: 1.05, // 町道
        2: 1.0,  // 村道
        1: 1.0,  // 整備度の低い道
        0: 0.3,  // 未整備（道がない場所を無理に進む場合など）
    },

    // 地形ごとの速度係数（減速率）
    TERRAIN_SPEED_MULTIPLIERS: {
        '山岳': 0.6,
        '山地': 0.7,
        '森林': 0.75, // 「森林」
        '密林': 0.8,
        '丘陵': 0.8,
        '平地': 1.0, // 「平地」「疎林」
    },

    // ★★★ [新規] 積雪時の追加速度係数 ★★★
    SNOW_SPEED_MULTIPLIER: 0.7
};