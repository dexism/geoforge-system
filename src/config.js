// ================================================================
// GeoForge System - 設定ファイル (v3.2 - 大陸生成パラメータ再調整版)
// ================================================================

import * as d3 from 'd3';

// ================================================================
// ■ 1. マップ基本設定
// ================================================================
export const COLS = 115;
export const ROWS = 100;
export const HEX_SIZE_KM = 10;
export const r = 20;

// ================================================================
// ■ 2. 地形生成パラメータ (v3.2 - 大陸生成パラメータ再調整版)
// ================================================================
// --- 大陸の形状と配置 ---
export const CONTINENT_NOISE_FREQ =        2.0;  // 大陸形状の複雑さ。2.0-3.0が推奨
export const CONTINENT_FALLOFF_START =     1.40; // マップ中央からx%の距離までは大陸が一切削られない
export const CONTINENT_FALLOFF_RANGE =     0.20; // そこからx%の距離をかけて海になる
export const SEA_LEVEL =                   0.10; // 陸地強度がこれより低いと海になる。0.3-0.4が推奨

// --- 地形バイアス (特定のエリアの傾向を緩やかに操作) ---
export const EAST_SEA_BIAS_X_START =       0.8;  // マップの東側x%地点から海になりやすくなる
export const EAST_SEA_BIAS_INTENSITY =     0.2;  // 東側を海にする力の強さ（弱めに設定）
export const NW_SEA_BIAS_RADIUS =          0.2;  // 北西の角からこの半径内を海になりやすくする
export const NW_SEA_BIAS_INTENSITY =       0.3;  // 北西を海にする力の強さ（弱めに設定）

// --- 山岳と起伏 ---
export const MOUNTAIN_NOISE_FREQ =         7.0;  // 山脈の分布を決めるノイズの周波数
export const MOUNTAIN_DISTRIBUTION_POWER = 2.0;  // 山脈を特定のエリアに集中させる度合い（下げて範囲を広げる）
export const MOUNTAIN_SHAPE_POWER =        1.0;  // 山の鋭さ
export const MOUNTAIN_HEIGHT_MAX =         5.0;  // 山の最大標高（スケーリング前の内部値）

export const HILL_NOISE_FREQ =             3.0;  // 丘陵のノイズ周波数
export const HILL_HEIGHT_MAX =             1.0;  // 丘陵の最大標高（内部値）

export const DETAIL_NOISE_FREQ =           1.0;  // 細かい起伏のノイズ周波数
export const DETAIL_HEIGHT_MAX =           0.1;  // 細かい起伏の最大標高（内部値）

// --- 標高スケーリング ---
// 内部計算された標高値を、最終的なメートル表記に変換する。
// exponent > 1にすることで、低い土地はより低く、高い土地はより高くなり、メリハリがつく
export const elevationScale = d3.scalePow().exponent(1.2).domain([0.0, 5.0]).range([0, 7000]).clamp(true);

// ================================================================
// ■ 3. 気候・植生パラメータ
// ================================================================
// ★★★ [新規] 降水量モデルのパラメータ ★★★
export const PRECIPITATION_PARAMS = {
    // --- ノイズ周波数 ---
    LARGE_NOISE_FREQ: 0.8,  // 大域的な降水量のムラを生成するノイズ
    DETAIL_NOISE_FREQ: 3.5, // 局所的な降水量の変化を生成するノイズ

    // --- 大域的な降水勾配 (mm/年) ---
    WEST_COAST_MM: 200,     // 西端の基本降水量
    EAST_COAST_MM: 1200,    // 東端の基本降水量
    GRADIENT_POWER: 0.8,    // 西から東への降水量増加カーブ（1.0未満で緩やかに）
    
    // --- 地域的な補正 (mm/年) ---
    SOUTHEAST_BIAS_INTENSITY: 1300, // 南東部の最大追加降水量
    MOUNTAIN_UPLIFT_BONUS: 400,    // 山岳による地形性降水の最大ボーナス
    RAIN_SHADOW_PENALTY: -600,   // 山脈風下（雨陰）の最大減少量

    // --- ケッペンの乾燥限界式 r = 20(t+x) のための季節性係数 'x' ---
    SEASONALITY_SUMMER_RAIN: 14, // 夏に雨が集中する地域の係数
    SEASONALITY_WINTER_RAIN: 0,  // 冬に雨が集中する地域の係数
    SEASONALITY_UNIFORM: 7,      // 通年で平均的に雨が降る地域の係数
    
    // --- 人口生成で参照する閾値 (mm/年) ---
    DRYNESS_FARMING_THRESHOLD: 600,  // 安定した定住農耕が可能になる年間降水量
    DRYNESS_PASTORAL_THRESHOLD: 250, // 牧畜が可能になる最低限の年間降水量
};

export const TERRAIN_ELEVATION = { MOUNTAIN_PEAK: 3000, MOUNTAIN: 2000, HILLS: 1000 };
export const VEGETATION_THRESHOLDS = { JUNGLE_MIN_IPREC: 0.10 }; // この値は使われなくなります
export const SNOW_THRESHOLDS = { TEMPERATURE: -10, PRECIPITATION_LIGHT: 0.1 };
export const TEMP_ZONES = { COLD: 0, TEMPERATE: 30 };
// precipitationの0-1スケールは使われなくなるため、PRECIP_ZONESは廃止します
// export const PRECIP_ZONES = { DRY: 0.50, MODERATE: 0.70 };

// ================================================================
// ■ 4. 文明・経済パラメータ
// ================================================================
export const NUM_NATIONS = 4;
export const NATION_NAMES = ["アルファ国", "ブラボー国", "チャーリー国", "デルタ国", "エコー国", "フォクストロット国", "ゴルフ国", "ホテル国"];
export const HEX_AREA_HA = 8660; // ヘクス1マスあたりの面積 (ha)

// ★★★ [変更] 人口生成パラメータを刷新 ★★★
export const POPULATION_PARAMS = {
    // 正規化された居住適性(0-1)がこの値を下回る場合、人口は0になる (足切り値)
    HABITABILITY_THRESHOLD: 0.15,

    // 1ヘックスあたりの最大人口数。居住適性が1.0の地点の理論上の最大値。
    MAX_POPULATION_PER_HEX: 15000,

    // 人口の集中度合いを調整する指数。値が大きいほど、ごく一部の好立地に人口が集中する。
    POPULATION_CURVE: 5.0,
};
export const CROP_DATA = { // 収量(t/ha), 種類, 1人当たり必要耕作面積(ha)
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲':   { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
};
export const SETTLEMENT_PARAMS = { // 労働力率, 1人当たり消費量(t), インフラ係数, 基本頭数制限率, 頭数制限ボーナス
    '首都': { labor_rate: 0.20, consumption_t_per_person: 0.32, infra_coeff: 1.20, head_cap_base: 0.30, head_cap_bonus: 0.15 },
    '都市': { labor_rate: 0.30, consumption_t_per_person: 0.28, infra_coeff: 1.10, head_cap_base: 0.25, head_cap_bonus: 0.10 },
    '領都': { labor_rate: 0.45, consumption_t_per_person: 0.24, infra_coeff: 1.05, head_cap_base: 0.30, head_cap_bonus: 0.05 },
    '街':   { labor_rate: 0.55, consumption_t_per_person: 0.22, infra_coeff: 1.00, head_cap_base: 0.35, head_cap_bonus: 0.0 },
    '町':   { labor_rate: 0.70, consumption_t_per_person: 0.21, infra_coeff: 0.95, head_cap_base: 0.40, head_cap_bonus: 0.0 },
    '村':   { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.90, head_cap_base: 0.60, head_cap_bonus: 0.0 },
    '散居': { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.85, head_cap_base: 0.50, head_cap_bonus: 0.0 }
};

// ================================================================
// ■ 5. 街道・移動パラメータ
// ================================================================
export const RIDGE_CROSSING_COST_MULTIPLIER = 8.0;
export const TERRAIN_MULTIPLIERS = { 
    '平地': 1.4, 
    '森林': 1.6, 
    '密林': 1.8, 
    '丘陵': 1.8, 
    '山地': 2.0, 
    '山岳': 2.5, 
    RIVER_BONUS: 0.3 
};
export const ROAD_MULTIPLIERS = { 
    5: 0.8,  // 交易路 
    4: 0.9,  // 街道
    3: 0.95, // 町道
    2: 1.0,  // 村道
    1: 1.0 
};
export const WAGON_PARAMS = {
    BASE_SPEED_KMH: 3.5, // 基本移動速度 (km/h)
    OPERATING_HOURS_PER_DAY: 7.0, // 1日の稼働時間 (時間)
    ROAD_SPEED_MULTIPLIERS: { 
        5: 1.25, // 交易路
        4: 1.15, // 街道
        3: 1.05, // 町道
        2: 1.0,  // 村道
        1: 1.0, 
        0: 0.3 
    },
    TERRAIN_SPEED_MULTIPLIERS: { 
        '山岳': 0.6, 
        '山地': 0.7, 
        '森林': 0.75, 
        '密林': 0.8, 
        '丘陵': 0.8, 
        '平地': 1.0 
    },
    SNOW_SPEED_MULTIPLIER: 0.7
};

// ================================================================
// ■ 6. 描画・配色設定
// ================================================================
const elevationColor_0_1k    = d3.scaleLinear().domain([   0, 1000]).range(['#d8ecd3', '#a8d5a2']);
const elevationColor_1k_2k   = d3.scaleLinear().domain([1000, 2000]).range(['#a8d5a2', '#dcd5c9']);
const elevationColor_2k_3k   = d3.scaleLinear().domain([2000, 3000]).range(['#dcd5c9', '#c2a383']);
const elevationColor_3k_4k   = d3.scaleLinear().domain([3000, 4000]).range(['#c2a383', '#b0b0b0']);
const elevationColor_4k_plus = d3.scaleLinear().domain([4000, 7000]).range(['#b0b0b0', '#ffffff']);
export function getElevationColor(elevation) {
    if (elevation < 1000) return elevationColor_0_1k(elevation);
    if (elevation < 2000) return elevationColor_1k_2k(elevation);
    if (elevation < 3000) return elevationColor_2k_3k(elevation);
    if (elevation < 4000) return elevationColor_3k_4k(elevation);
    return elevationColor_4k_plus(elevation);
}
export const TERRAIN_COLORS = { 
    深海: '#136', 
    海洋: '#248', 
    湖沼: '#058', 
    砂漠: '#e8d9b5', 
    森林: '#6aa84f', 
    針葉樹林: '#3b6e4f', 
    密林: '#1b5e20' 
};
export const CLIMATE_ZONE_COLORS = { 
    "砂漠気候(寒)": '#d2b48c', 
    "ツンドラ気候": '#5dade2', 
    "亜寒帯湿潤気候": '#2874a6', 
    "ステップ気候": '#e67e22', 
    "地中海性気候": '#58d68d', 
    "温暖湿潤気候": '#239b56', 
    "砂漠気候(熱)": '#f4d03f', 
    "熱帯草原気候": '#f5b041', 
    "熱帯雨林気候": '#145a32' 
};
export const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]); 
export const tempColor = d3.scaleSequential(d3.interpolateTurbo).domain([-15, 35]);
export const precipColor = d3.scaleSequential(d3.interpolateBlues).domain([0, 1]);
export const agriColor = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);
export const forestColor = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
export const miningColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);
export const fishingColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]);
export const populationColor = d3.scaleLog().domain([1, 150000]).range(["black", "red"]).clamp(true);
export const WHITE_MAP_COLORS = { WATER: '#aaa' };
export const whiteMapElevationColor = d3.scaleLinear().domain([0, 1000, 2000, 4000, 7000]).range(['#fff', '#fff', '#fee', '#edd', '#cbb']).clamp(true);