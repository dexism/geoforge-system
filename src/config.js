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
export const r = 20; // 1へクスのサイズ (px)
export const HEX_AREA_HA = 8660; // ヘクス1マスあたりの面積 (ha)

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
export const PRECIPITATION_PARAMS = {
    // --- ノイズ周波数 ---
    LARGE_NOISE_FREQ:  0.8, // 大域的な降水量のムラを生成するノイズ
    DETAIL_NOISE_FREQ: 3.5, // 局所的な降水量の変化を生成するノイズ

    // --- 大域的な降水勾配 (mm/年) ---
    WEST_COAST_MM:    0,   // 西端の基本降水量
    EAST_COAST_MM: 1500,   // 東端の基本降水量
    GRADIENT_POWER:   0.8, // 西から東への降水量増加カーブ（1.0未満で緩やかに）
    
    // --- 地域的な補正 (mm/年) ---
    SOUTHEAST_BIAS_INTENSITY: 1300, // 南東部の最大追加降水量
    MOUNTAIN_UPLIFT_BONUS:     400, // 山岳による地形性降水の最大ボーナス
    RAIN_SHADOW_PENALTY:      -600, // 山脈風下（雨陰）の最大減少量

    // --- ケッペンの乾燥限界式 r = 20(t+x) のための季節性係数 'x' ---
    SEASONALITY_SUMMER_RAIN: 14, // 夏に雨が集中する地域の係数
    SEASONALITY_WINTER_RAIN:  0, // 冬に雨が集中する地域の係数
    SEASONALITY_UNIFORM:      7, // 通年で平均的に雨が降る地域の係数
    
    // --- 人口生成で参照する閾値 (mm/年) ---
    DRYNESS_FARMING_THRESHOLD:  600, // 安定した定住農耕が可能になる年間降水量
    DRYNESS_PASTORAL_THRESHOLD: 250, // 牧畜が可能になる最低限の年間降水量

    // 湿地と密林の生成条件パラメータ
    JUNGLE_MIN_TEMP:        22, // 密林が生成される最低気温 (℃)
    JUNGLE_MIN_PRECIP_MM: 1500, // 密林が生成される最低年間降水量 (mm)

    // 新しい湿地生成モデルのパラメータ
    WETLAND_PARAMS: {
        MAX_ELEVATION:       400,   // 湿地が生成される最大標高 (m)
        // 「平坦さ」を測るための閾値。周囲との標高差がこの値以下だと平坦とみなす
        FLATNESS_THRESHOLD:  100,      
        // 「豊富な水源」を評価するためのパラメータ
        PRECIP_THRESHOLD_MM: 800,   // この降水量を超えると、水源として評価され始める
        COASTAL_WATER_BONUS:   0.5, // 海や湖に隣接している場合の水源ボーナス
        // 最終的な湿地化を決定するスコアの閾値
        // (平坦度スコア + 水源スコア) がこの値を超えると湿地になる
        SCORE_THRESHOLD: 1.2       
    }
};

// 植生生成の閾値パラメータ
export const VEGETATION_PARAMS = {
    // 温帯林が生成される最低年間降水量 (mm)
    // これ未満だと草原や荒れ地になる
    TEMPERATE_FOREST_MIN_PRECIP_MM: 600,

    // 熱帯林（サバンナとの境界）が生成される最低年間降水量 (mm)
    TROPICAL_FOREST_MIN_PRECIP_MM: 1500,

    // 針葉樹林が生成される最低年間降水量 (mm)
    // 寒冷地でこれ未満だと荒れ地（ツンドラ）になる
    CONIFEROUS_FOREST_MIN_PRECIP_MM: 200,
};

export const TERRAIN_ELEVATION = { MOUNTAIN_PEAK: 3000, MOUNTAIN: 2000, HILLS: 1000 };
export const SNOW_THRESHOLDS = { TEMPERATURE: -10, PRECIPITATION_LIGHT: 0.3 };
export const TEMP_ZONES = { COLD: 5, TEMPERATE: 22 };

// ================================================================
// ■ 4. 文明・経済パラメータ
// ================================================================
export const NUM_NATIONS = 4;
export const NATION_NAMES = ["アルファ国", "ブラボー国", "チャーリー国", "デルタ国", "エコー国", "フォクストロット国", "ゴルフ国", "ホテル国"];

// 人口生成パラメータ
export const POPULATION_PARAMS = {
    // 正規化された居住適性(0-1)がこの値を下回る場合、人口は0になる (足切り値)
    HABITABILITY_THRESHOLD: 0.0,

    // 1ヘックスあたりの最大人口数。居住適性が1.0の地点の理論上の最大値。
    MAX_POPULATION_PER_HEX: 50000,

    // 人口の集中度合いを調整する指数。値が大きいほど、ごく一部の好立地に人口が集中する。
    POPULATION_CURVE: 10.0,
};
export const CROP_DATA = { // 収量(t/ha), 種類, 1人当たり必要耕作面積(ha)
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲':   { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
};
export const SETTLEMENT_PARAMS = { // 労働力率, 消費量, インフラ係数, 頭数制限, ボーナス, ★狩人率
    '首都': { 
        labor_rate: 0.20, 
        consumption_t_per_person: 0.32, 
        infra_coeff: 1.20, 
        head_cap_base: 0.30, 
        head_cap_bonus: 0.15, 
        hunter_rate: 0.001 
    },
    '都市': { 
        labor_rate: 0.30, 
        consumption_t_per_person: 0.28, 
        infra_coeff: 1.10, 
        head_cap_base: 0.25, 
        head_cap_bonus: 0.10, 
        hunter_rate: 0.005 
    },
    '領都': { 
        labor_rate: 0.45, 
        consumption_t_per_person: 0.24, 
        infra_coeff: 1.05, 
        head_cap_base: 0.30, 
        head_cap_bonus: 0.05, 
        hunter_rate: 0.01 
    },
    '街':   { 
        labor_rate: 0.55, 
        consumption_t_per_person: 0.22, 
        infra_coeff: 1.00, 
        head_cap_base: 0.35, 
        head_cap_bonus: 0.0,  
        hunter_rate: 0.03 
    },
    '町':   { 
        labor_rate: 0.70, 
        consumption_t_per_person: 0.21, 
        infra_coeff: 0.95, 
        head_cap_base: 0.40, 
        head_cap_bonus: 0.0,  
        hunter_rate: 0.06 
    },
    '村':   { 
        labor_rate: 0.80, 
        consumption_t_per_person: 0.20, 
        infra_coeff: 0.90, 
        head_cap_base: 0.60, 
        head_cap_bonus: 0.0,  
        hunter_rate: 0.10 
    },
    '散居': { 
        labor_rate: 0.80, 
        consumption_t_per_person: 0.20, 
        infra_coeff: 0.85, 
        head_cap_base: 0.50, 
        head_cap_bonus: 0.0,  
        hunter_rate: 0.15 
    }
};

// ================================================================
// ■ 5. 街道・移動パラメータ
// ================================================================
// 交易路の最大移動日数
export const MAX_TRADE_ROUTE_DAYS = 10; // これを超える(以上)交易路は原則として敷設されない

// 下位道路の最大敷設日数
export const MAX_TRAVEL_DAYS = {
    4: 15, // 街道 (街 -> 上位) は最大15日
    3: 10, // 町道 (町 -> 上位) は最大10日
    2:  5, // 村道 (村 -> 上位) は最大5日
};

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
    6: 0.80, // 通商路
    5: 0.85, // 交易路 
    4: 0.90, // 街道
    3: 0.95, // 町道
    2: 1.0,  // 村道
    1: 1.0 
};
export const WAGON_PARAMS = {
    BASE_SPEED_KMH: 3.5, // 基本移動速度 (km/h)
    OPERATING_HOURS_PER_DAY: 7.0, // 1日の稼働時間 (時間)
    ROAD_SPEED_MULTIPLIERS: { 
        6: 1.30, // 通商路
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
export const HUNTING_PARAMS = {
    // 最高の環境(huntingPotential=1.0)で、狩人1人が年間に得られる肉の基本量 (トン)
    BASE_HUNTING_YIELD_T_PER_HUNTER: 0.8,
    
    // 最高の環境(huntingPotential=1.0)で、1ヘクタールあたり年間に持続的に供給される肉の最大量 (トン)
    MAX_HUNTING_YIELD_T_PER_HA: 0.001,
};

// ================================================================
// ■ 6. 描画・配色設定
// ================================================================
const elevationColor_0_1k    = d3.scaleLinear().domain([   0, 1000]).range(['#d8ecd3', '#a8d5a2']);
const elevationColor_1k_2k   = d3.scaleLinear().domain([1000, 2000]).range(['#a8d5a2', '#dcd5c9']);
const elevationColor_2k_3k   = d3.scaleLinear().domain([2000, 3000]).range(['#dcd5c9', '#c2a383']);
const elevationColor_3k_4k   = d3.scaleLinear().domain([3000, 4000]).range(['#c2a383', '#b0b0b0']);
const elevationColor_4k_plus = d3.scaleLinear().domain([4000, 7000]).range(['#b0b0b0', '#ffffff']);
const depthColor = d3.scaleLinear()
    .domain([0, -1000]) // 水深0mから-5000m
    .range(['#5ae', '#136']) // 明るい青から暗い青へ
    .clamp(true);

export function getElevationColor(elevation) {
    if (elevation <= 0) {
        return depthColor(elevation); // 標高が0以下なら水深の色を返す
    }
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
    河川: '#37b',
    砂漠: '#edc', 
    森林: '#7a5', 
    針葉樹林: '#475', 
    密林: '#262', 
    湿地: '#676',
    草原: '#bda',
    荒れ地: '#ccb',
    高山: '#aaa'
};
// 稜線・水系図の配色
export const RIDGE_WATER_SYSTEM_COLORS = {
    RIVER: '#07c', // 水系（河川・水域）の色
    RIDGE: '#b00'  // 稜線の色
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
export const precipColor = d3.scaleLog()
    // 0mmに近い値でもエラーにならないように、最小値を1に設定
    .domain([1, 150, 400, 800, 1200, 1600, 2000, 2500]) // 降水量(mm)の区切り
    .range([
        "#fff", // 白 (～1mm)
        "#0ff", // 水色 (～150mm)
        "#00f", // 青 (～400mm)
        "#8f8", // 黄緑 (～800mm)
        "#0a0", // 緑 (～1200mm)
        "#ff0", // 黄 (～1600mm)
        "#f00", // 赤 (～2000mm)
        "#808"  // 紫 (～2500mm+)
    ])
    .clamp(true); // domainの範囲外の値は、範囲の端の色を適用する
export const agriColor = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);     // 農業適性
export const forestColor = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);     // 林業適性
export const miningColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);  // 鉱業適性
export const fishingColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]); // 漁業適性
export const huntingColor = d3.scaleSequential(d3.interpolateYlOrBr).domain([0, 1]);  // 狩猟適性
export const populationColor = d3.scaleLog().domain([1, 150000]).range(["black", "red"]).clamp(true);

// 白地図の配色
export const WHITE_MAP_COLORS = { WATER: '#aaa' };
export const whiteMapElevationColor = d3.scaleLinear()
    .domain([0, 1000, 2000, 4000, 7000])
    .range(['#fff', '#fff', '#fee', '#edd', '#cbb']).clamp(true);

// 魔物ランクの配色
export const MONSTER_COLORS = {
    'S': '#ff00ff', // Sランク (紫)
    'A': '#ff0000', // Aランク (赤)
    'B': '#ff8800', // Bランク (オレンジ)
    'C': '#ffff00', // Cランク (黄)
    'D': '#aaaaaa'  // Dランク (灰)
};

export const pastoralColor = d3.scaleSequential(d3.interpolateBrBG).domain([0, 1]);
export const livestockColor = d3.scaleSequential(d3.interpolatePuRd).domain([0, 1]);

// config.js の末尾あたりに追加

// ================================================================
// ■ 7. 生産シミュレーションパラメータ
// ================================================================
export const PRODUCTION_PARAMS = {
    // --- 1人あたりの年間基本生産量 (適性1.0の場合) ---
    YIELD_PER_WORKER: {
        FISHING: 2.0,   // 漁師1人あたりの漁獲量 (トン)
        FORESTRY: 25,   // 林業従事者1人あたりの木材産出量 (立方メートル)
        MINING: 1.5,    // 鉱夫1人あたりの鉱石産出量 (トン)
        PASTORAL_MEAT: 0.2, // 牧畜従事者1人あたりの食肉生産量 (トン)
        PASTORAL_DAIRY: 1.0,  // 牧畜従事者1人あたりの乳製品生産量 (トン)
        LIVESTOCK_MEAT: 0.4,  // 家畜飼育者1人あたりの食肉生産量 (トン)
    },

    // --- 1haあたりの年間最大生産量 (土地の限界) ---
    MAX_YIELD_PER_HA: {
        FISHING: 0.005, // (沿岸・河川面積に対する値)
        FORESTRY: 0.5,
        MINING: 0.002,
    },

    // --- 加工品の変換率 ---
    PROCESSING_RATES: {
        // 穀物1トンから醸造できる酒の量 (キロリットル)
        GRAIN_TO_ALCOHOL: 0.5,
        // 果物1トンから醸造できる酒の量 (キロリットル)
        FRUIT_TO_ALCOHOL: 0.7,
    }
};