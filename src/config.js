// ================================================================
// GeoForge System - 設定ファイル (v3.2 - 大陸生成パラメータ再調整版)
// ================================================================
// 解説:
// アプリケーション全体で共有される定数・設定値を管理するモジュール。
// 地形生成、気候シミュレーション、経済、文明、描画など、各サブシステムの挙動を制御する。
// ================================================================

import * as d3 from 'd3';

// ================================================================
// ■ 1. マップ基本設定
// ================================================================
// グリッドの基本サイズとスケールを定義します。
export const COLS = 25; // ブロックの列数 (マップの管理単位: 23ブロック + パディング2)
export const ROWS = 22; // ブロックの行数 (マップの管理単位: 20ブロック + パディング2)
export const HEX_SIZE_KM = 10; // 1ヘックスの対角線距離に相当するスケール基準 (km)
export const r = 20; // 描画時の1ヘックスの半径 (px)。SVG上でのサイズ。
export const HEX_AREA_HA = 8660; // ヘックス1マスの面積 (ヘクタール)。人口収容力などの計算に使用。
export const HEX_SIDE_LENGTH_KM = 5.77; // ヘックス1辺の長さ (km)。移動距離計算の基礎。
export const BEACH_WIDTH_M = 50; // 植生詳細の土地利用面積計算用の砂浜の基準幅（m）

// 初期表示位置とズームレベル
// ワールド座標系 (Block-Local) で指定: { x: BlockX, y: BlockY } ではなく特定のヘックス座標を指す
export const INITIAL_ZOOM_LOC = { x: 5011, y: 7309 };
export const INITIAL_SCALE = 2.0; // 初期の拡大率

// ================================================================
// ■ 2. 地形生成パラメータ (v3.2 - 大陸生成パラメータ再調整版)
// ================================================================
// パーリンノイズを用いた大陸・地形生成の挙動を制御します。

// --- 大陸の形状と配置 ---
export const CONTINENT_NOISE_FREQ = 9.0;  // 大陸形状のノイズ周波数。値が大きいほど複雑で細かい地形になる。
export const CONTINENT_FALLOFF_START = 1.40; // マップ中心からの距離減衰(Falloff)の開始位置。1.0で端、1.4は画面外まで陸地が続く設定。
export const CONTINENT_FALLOFF_RANGE = 0.20; // 減衰が始まってから完全に海になるまでの距離。
export const SEA_LEVEL = 0.02; // 海面閾値。ノイズ値がこれを下回ると海、上回ると陸地となる。

// --- 地形バイアス (特定のエリアの地形傾向を操作) ---
export const EAST_SEA_BIAS_X_START = 0.7;  // 東側を海にするバイアスの開始X座標 (0.0-1.0)。0.7は右側30%のエリア。
export const EAST_SEA_BIAS_INTENSITY = 0.6;  // 東側を海にする力の強さ。
export const NW_SEA_BIAS_RADIUS = 0.3;  // 北西からの距離半径。この範囲内を海にする。
export const NW_SEA_BIAS_INTENSITY = 0.6;  // 北西を海にする力の強さ。

// --- 山岳と起伏 ---
export const MOUNTAIN_NOISE_FREQ = 5.0;  // 山脈分布のノイズ周波数。
export const MOUNTAIN_DISTRIBUTION_POWER = 3.0;  // 山脈の集中度。高いほど特定の場所に山が偏り、平野が増える。
export const MOUNTAIN_SHAPE_POWER = 0.001;  // 山の形状係数。
export const MOUNTAIN_HEIGHT_MAX = 4.5;  // 生成される山の最大標高係数。実際のメートル値は elevationScale で変換される。

export const HILL_NOISE_FREQ = 1.0;  // 丘陵地帯の分布ノイズ周波数。
export const HILL_HEIGHT_MAX = 1.0;  // 丘陵の最大高さ係数。

export const DETAIL_NOISE_FREQ = 9.0;  // 地形の微細な凹凸を作るための高周波ノイズ。
export const DETAIL_HEIGHT_MAX = 0.5;  // 微細ノイズの高さ影響度。

// --- 標高スケーリング ---
// 内部的なノイズ値(0.0-5.0程度)を、実際の標高メートル値(0-7000m)に変換する関数。
// d3.scalePow(exponent) を使い、高い山ほど急峻になるよう調整している。
export const elevationScale = d3.scalePow().exponent(1.2).domain([0.0, 5.0]).range([0, 7000]).clamp(true);

// --- 大陸棚の生成 ---
// 海岸線付近の浅瀬（大陸棚）の生成パラメータ。
export const SHELF_PARAMS = {
    BASE_WIDTH_HEXES: 2, // 基礎となる大陸棚の幅 (ヘックス数)
    NOISE_WIDTH_HEXES: 8, // ノイズによる変動幅の最大値 (ヘックス数)
    NOISE_FREQ: 5.0, // 変動ノイズの周波数
    MAX_DEPTH: -200, // 大陸棚の境界となる水深 (m)
    ABYSSAL_DEPTH: -4000 // 最深部の水深 (m)
};

// ================================================================
// ■ 3. 気候・植生パラメータ
// ================================================================
// 降水量や気温、それに基づいた植生の決定ロジック用パラメータ。

export const PRECIPITATION_PARAMS = {
    // --- ノイズ周波数 ---
    LARGE_NOISE_FREQ: 0.8, // 広域の降雨パターン用ノイズ
    DETAIL_NOISE_FREQ: 3.5, // 局所的な降雨変動用ノイズ

    // --- 大域的な降水勾配 (mm/年) ---
    // 西から東への気候変化をシミュレート
    WEST_COAST_MM: 0,   // 西端の基準降水量
    EAST_COAST_MM: 1500,   // 東端の基準降水量
    GRADIENT_POWER: 0.8, // 勾配の変化カーブ

    // --- 地域的な補正 (mm/年) ---
    SOUTHEAST_BIAS_INTENSITY: 1300, // 南東部のモンスーン等を想定した降水ボーナス
    MOUNTAIN_UPLIFT_BONUS: 400, // 地形性降雨（山の風上側）のボーナス
    RAIN_SHADOW_PENALTY: -600, // 雨陰効果（山の風下側）のペナルティ

    // --- ケッペンの乾燥限界式 r = 20(t+x) のための季節性係数 'x' ---
    SEASONALITY_SUMMER_RAIN: 14, // 夏雨型
    SEASONALITY_WINTER_RAIN: 0, // 冬雨型
    SEASONALITY_UNIFORM: 7, // 年中平均型

    // --- 人口生成・農業可否の閾値 (mm/年) ---
    DRYNESS_FARMING_THRESHOLD: 600, // 農業可能な最低ライン
    DRYNESS_PASTORAL_THRESHOLD: 250, // 牧畜可能な最低ライン

    // 湿地と密林の生成条件パラメータ
    JUNGLE_MIN_TEMP: 22, // 熱帯雨林の最低気温 (℃)
    JUNGLE_MIN_PRECIP_MM: 1500, // 熱帯雨林の最低降水量 (mm)

    // 新しい湿地生成モデルのパラメータ
    WETLAND_PARAMS: {
        MAX_ELEVATION: 400,   // 湿地ができる標高上限
        FLATNESS_THRESHOLD: 100, // 平坦とみなす標高差
        PRECIP_THRESHOLD_MM: 800,   // 水源となる降水量
        COASTAL_WATER_BONUS: 0.5, // 水辺ボーナス
        SCORE_THRESHOLD: 1.2 // 湿地判定スコア閾値
    }
};

// 植生生成の閾値パラメータ (降水量 mm/年)
export const VEGETATION_PARAMS = {
    TEMPERATE_FOREST_MIN_PRECIP_MM: 600, // 温帯林
    TROPICAL_RAINFOREST_MIN_PRECIP_MM: 1500, // 熱帯雨林
    BOREAL_FOREST_MIN_PRECIP_MM: 200, // 亜寒帯林
};

// 地形・気候判定用の定数
export const TERRAIN_ELEVATION = { MOUNTAIN_PEAK: 3000, MOUNTAIN: 2000, HILLS: 1000 };
export const SNOW_THRESHOLDS = { TEMPERATURE: -10, PRECIPITATION_LIGHT: 0.3 };
export const TEMP_ZONES = { COLD: 5, TEMPERATE: 22 };

// ================================================================
// ■ 4. 文明・経済パラメータ
// ================================================================
export const NUM_NATIONS = 4; // 生成する国家数
export const NATION_NAMES = ["アルファ国", "ブラボー国", "チャーリー国", "デルタ国", "エコー国", "フォクストロット国", "ゴルフ国", "ホテル国"];

// 人口生成パラメータ
export const POPULATION_PARAMS = {
    HABITABILITY_THRESHOLD: 0.0, // 居住可能スコア(0-1)の足切りライン
    MAX_POPULATION_PER_HEX: 30000, // ヘックスあたりの最大人口キャパシティ
    POPULATION_CURVE: 10.0, // 人口集中のバイアス。高いほど都市部に一極集中する。
};

// 作物データ (EconomySimulatorで使用)
export const CROP_DATA = {
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲': { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
    '果物': { yield: 0.80, type: '樹園', cultivation_ha_per_person: 1.0 },
    '野菜': { yield: 2.00, type: '畑作', cultivation_ha_per_person: 0.6 },
    '薬草': { yield: 0.10, type: '畑作', cultivation_ha_per_person: 0.5, requires_mana: true }
};

// --- 農業適性パラメータ (植生 -> 適性値 0.0-1.0) ---
export const SUITABILITY_FIELD = { // 畑作
    'grassland': 0.95, 'savanna': 0.9, 'steppe': 0.9, 'temperateForest': 0.7,
    'subarcticForest': 0.5, 'tropicalRainforest': 0.4, 'wetland': 0.1,
    'coastal': 0.3, 'beach': 0.1, 'desert': 0.1, 'wasteland': 0.2,
    'tundra': 0.1, 'alpine': 0.1, 'iceSnow': 0.0
};
export const SUITABILITY_PADDY = { // 稲作
    'grassland': 0.9, 'savanna': 0.8, 'steppe': 0.8, 'temperateForest': 0.6,
    'subarcticForest': 0.4, 'tropicalRainforest': 0.5, 'wetland': 0.9,
    'coastal': 0.4, 'beach': 0.1, 'desert': 0.1, 'wasteland': 0.2,
    'tundra': 0.0, 'alpine': 0.0, 'iceSnow': 0.0
};
export const SUITABILITY_ORCHARD = { // 果樹
    'temperateForest': 0.8, 'subarcticForest': 0.4, 'tropicalRainforest': 0.6,
    'grassland': 0.7, 'savanna': 0.6, 'steppe': 0.6, 'coastal': 0.5,
    'wetland': 0.1, 'beach': 0.1, 'desert': 0.1, 'wasteland': 0.3,
    'tundra': 0.0, 'alpine': 0.1, 'iceSnow': 0.0
};

// 植生名の日本語 -> 英語キー変換マップ
export const VEG_JP_TO_EN = {
    '草原': 'grassland', '草原帯': 'grassland',
    'サバンナ': 'savanna',
    'ステップ': 'steppe',
    '温帯林': 'temperateForest', '森林': 'temperateForest',
    '亜寒帯林': 'subarcticForest', '針葉樹林': 'subarcticForest',
    '熱帯雨林': 'tropicalRainforest', '密林': 'tropicalRainforest',
    '湿地': 'wetland', '湿地帯': 'wetland',
    '沿岸': 'coastal', '沿岸植生': 'coastal',
    '砂浜': 'beach',
    '砂漠': 'desert', '砂漠帯': 'desert',
    '荒地': 'wasteland', '荒地帯': 'wasteland',
    'ツンドラ': 'tundra',
    'アルパイン': 'alpine', '高山': 'alpine',
    '氷雪': 'iceSnow', '氷雪帯': 'iceSnow'
};

// 集落レベルごとのパラメータ定義
// labor_rate: 労働力率, consumption: 消費係数, infra: インフラ効率, head_cap: 人口上限係数, hunter: 狩人比率
export const SETTLEMENT_PARAMS = {
    '首都': { labor_rate: 0.20, consumption_t_per_person: 0.40, infra_coeff: 1.20, head_cap_base: 0.30, head_cap_bonus: 0.15, hunter_rate: 0.001 },
    '都市': { labor_rate: 0.30, consumption_t_per_person: 0.35, infra_coeff: 1.10, head_cap_base: 0.25, head_cap_bonus: 0.10, hunter_rate: 0.005 },
    '領都': { labor_rate: 0.45, consumption_t_per_person: 0.30, infra_coeff: 1.05, head_cap_base: 0.30, head_cap_bonus: 0.05, hunter_rate: 0.01 },
    '街': { labor_rate: 0.55, consumption_t_per_person: 0.25, infra_coeff: 1.00, head_cap_base: 0.35, head_cap_bonus: 0.0, hunter_rate: 0.03 },
    '町': { labor_rate: 0.70, consumption_t_per_person: 0.22, infra_coeff: 0.95, head_cap_base: 0.40, head_cap_bonus: 0.0, hunter_rate: 0.06 },
    '村': { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.90, head_cap_base: 0.60, head_cap_bonus: 0.0, hunter_rate: 0.10 },
    '散居': { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.85, head_cap_base: 0.50, head_cap_bonus: 0.0, hunter_rate: 0.15 }
};

// ================================================================
// ■ 5. 街道・移動パラメータ
// ================================================================
// 道路網生成と経路探索コストのパラメータ。

export const MAX_TRADE_ROUTE_DAYS = 10; // 交易路の最大許容移動日数
export const MAX_TRAVEL_DAYS = {
    4: 15, // 街道 (街 -> 上位)
    3: 10, // 町道 (町 -> 上位)
    2: 5,  // 村道 (村 -> 上位)
};

export const RIDGE_CROSSING_COST_MULTIPLIER = 8.0; // 稜線(険しい山脈)越えのコスト倍率
export const TERRAIN_MULTIPLIERS = { // 地形による移動コスト係数 (1.0 = 標準)
    '平地': 1.4,
    '温帯林': 1.6,
    '熱帯雨林': 2.5,
    '亜寒帯林': 1.6,
    '丘陵': 1.8,
    '山地': 2.0,
    '山岳': 2.5,
    RIVER_BONUS: 0.3 // 川沿い移動のボーナス (コスト軽減)
};
export const ROAD_MULTIPLIERS = { // 道路ランクによる移動コスト削減率
    6: 0.80, // 通商路
    5: 0.85, // 交易路 
    4: 0.90, // 街道
    3: 0.95, // 町道
    2: 1.0,  // 村道
    1: 1.0
};
export const WAGON_PARAMS = { // 荷馬車の移動パラメータ
    BASE_SPEED_KMH: 3.5,
    OPERATING_HOURS_PER_DAY: 7.0,
    ROAD_SPEED_MULTIPLIERS: { // 道路Lvごとの速度補正
        6: 1.30, 5: 1.25, 4: 1.15, 3: 1.05, 2: 1.0, 1: 1.0, 0: 0.3
    },
    TERRAIN_SPEED_MULTIPLIERS: { // 地形ごとの速度補正
        '山岳': 0.6, '山地': 0.7, '温帯林': 0.75, '熱帯雨林': 0.5,
        '亜寒帯林': 0.75, '丘陵': 0.8, '平地': 1.0
    },
    SNOW_SPEED_MULTIPLIER: 0.7 // 積雪時の減速
};
export const HUNTING_PARAMS = {
    BASE_HUNTING_YIELD_T_PER_HUNTER: 0.8, // 狩人1人の年間収穫量(t)
    MAX_HUNTING_YIELD_T_PER_HA: 0.001, // 面積あたりの限界収穫量(t/ha)
};

// ================================================================
// ■ 6.5. 等高線生成パラメータ
// ================================================================
export const CONTOUR_RESOLUTION = 20; // 描画解像度。高い(数値が小さい)ほど精密だが重い。
export const CONTOUR_INTERVAL = 200;  // 等高線を引く標高間隔 (m)。

// ================================================================
// ■ 6. 描画・配色設定
// ================================================================
// D3.jsスケール関数を用いた配色の定義。

const elevationColor_0_1k = d3.scaleLinear().domain([0, 1000]).range(['#d8ecd3', '#a8d5a2']);
const elevationColor_1k_2k = d3.scaleLinear().domain([1000, 2000]).range(['#a8d5a2', '#dcd5c9']);
const elevationColor_2k_3k = d3.scaleLinear().domain([2000, 3000]).range(['#dcd5c9', '#c2a383']);
const elevationColor_3k_4k = d3.scaleLinear().domain([3000, 4000]).range(['#c2a383', '#b0b0b0']);
const elevationColor_4k_plus = d3.scaleLinear().domain([4000, 7000]).range(['#b0b0b0', '#ffffff']);

const shelfDepthColor = d3.scaleLinear().domain([0, SHELF_PARAMS.MAX_DEPTH]).range(['#8cf', '#37b']).clamp(true);
const abyssalDepthColor = d3.scaleLinear().domain([SHELF_PARAMS.MAX_DEPTH, SHELF_PARAMS.ABYSSAL_DEPTH]).range(['#26a', '#136']).clamp(true);

// 標高に応じた色を返す関数
export function getElevationColor(elevation) {
    if (elevation <= 0) {
        if (elevation > SHELF_PARAMS.MAX_DEPTH) {
            return shelfDepthColor(elevation); // 大陸棚
        } else {
            return abyssalDepthColor(elevation); // 深海
        }
    }
    if (elevation < 1000) return elevationColor_0_1k(elevation);
    if (elevation < 2000) return elevationColor_1k_2k(elevation);
    if (elevation < 3000) return elevationColor_2k_3k(elevation);
    if (elevation < 4000) return elevationColor_3k_4k(elevation);
    return elevationColor_4k_plus(elevation);
}

// 地形タイプ別の色定義
export const TERRAIN_COLORS = {
    深海: '#147', 海洋: '#48d', 水域: '#48d', 湖沼: '#058', 河川: '#37b',
    砂浜: '#feb', 砂漠: '#eca', 荒れ地: '#ccb', 草原: '#bda', 湿地: '#676',
    温帯林: '#7a5', 亜寒帯林: '#475', 熱帯雨林: '#262',
    アルパイン: '#aaa', ツンドラ: '#acc', サバンナ: '#dcb', ステップ: '#cda',
    沿岸植生: '#8db', 氷雪帯: '#dee'
};
// 稜線・水系図の配色
export const RIDGE_WATER_SYSTEM_COLORS = { RIVER: '#07c', RIDGE: '#b00' };
// 気候区分ごとの色 (ケッペン気候区分風)
export const CLIMATE_ZONE_COLORS = {
    "氷雪気候": '#ffffff', "ツンドラ気候": '#5dade2', "亜寒帯湿潤気候": '#2874a6', "亜寒帯乾燥気候": '#5d6d7e',
    "ステップ気候": '#e67e22', "砂漠気候(寒)": '#d2b48c', "地中海性気候": '#58d68d', "温暖湿潤気候": '#239b56',
    "亜熱帯湿潤気候": '#2ecc71', "砂漠気候(熱)": '#f4d03f', "熱帯草原気候": '#f5b041', "熱帯雨林気候": '#145a32'
};

// 各種データ可視化用のスケール
export const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]); // 魔力
export const tempColor = d3.scaleSequential(d3.interpolateTurbo).domain([-15, 35]); // 気温
export const precipColor = d3.scaleLog() // 降水量 (対数スケール)
    .domain([1, 150, 400, 800, 1200, 1600, 2000, 2500])
    .range(["#fff", "#0ff", "#00f", "#8f8", "#0a0", "#ff0", "#f00", "#808"])
    .clamp(true);
export const agriColor = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);     // 農業
export const forestColor = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);     // 林業
export const miningColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);  // 鉱業
export const fishingColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]); // 漁業
export const huntingColor = d3.scaleSequential(d3.interpolateYlOrBr).domain([0, 1]);  // 狩猟
export const populationColor = d3.scaleLog().domain([1, POPULATION_PARAMS.MAX_POPULATION_PER_HEX]).range(["black", "red"]).clamp(true);

// 白地図の配色
export const WHITE_MAP_COLORS = { WATER: '#777' };
export const whiteMapElevationColor = d3.scaleLinear()
    .domain([0, 1000, 2000, 4000, 7000])
    .range(['#fff', '#fff', '#fee', '#edd', '#cbb']).clamp(true);

// 魔物ランク色
export const MONSTER_COLORS = { 'S': '#ff00ff', 'A': '#ff0000', 'B': '#ff8800', 'C': '#ffff00', 'D': '#aaaaaa' };

// ================================================================
// ■ 6.1. 初期レイヤー設定
// ================================================================
export const INITIAL_LAYER_SETTINGS = {
    'terrain': {
        'vegetation-overlay': true,
        'snow': true,
        'shading': true, // レリーフ (仕様書指示に合わせてtrueに修正)
        'contour': true,
        'settlement': true,
        'road': true,
        'territory-overlay': false,
        'hex-border': true,
        'ridge-water-system': false
    },
    'white': {
        'vegetation-overlay': false,
        'snow': false,
        'shading': false,
        'contour': true,
        'settlement': true,
        'road': true,
        'territory-overlay': true,
        'hex-border': false,
        'ridge-water-system': false
    }
};

// 牧畜・家畜用スケール
export const pastoralColor = d3.scaleSequential(d3.interpolateBrBG).domain([0, 1]);
export const livestockColor = d3.scaleSequential(d3.interpolatePuRd).domain([0, 1]);

// ================================================================
// ■ 7. 生産シミュレーションパラメータ
// ================================================================
export const PRODUCTION_PARAMS = {
    // --- 労働者・従事者1人あたりの年間基本生産量 ---
    YIELD_PER_WORKER: {
        FISHING: 2.0, FORESTRY: 25, MINING: 1.5,
        PASTORAL_MEAT: 0.2, PASTORAL_DAIRY: 1.0, LIVESTOCK_MEAT: 0.4,
    },
    // --- 土地1haあたりの年間最大生産量 (限界値) ---
    MAX_YIELD_PER_HA: {
        FISHING: 0.005, FORESTRY: 0.5, MINING: 0.002,
    },
    // --- 加工効率 ---
    PROCESSING_RATES: {
        GRAIN_TO_ALCOHOL: 0.5, // 穀物 -> 酒
        FRUIT_TO_ALCOHOL: 0.7, // 果物 -> 酒
    }
};

// ================================================================
// ■ 産業構造パラメータ
// ================================================================
export const INDUSTRY_ALLOCATION = {
    // 集落レベルごとの労働人口配分 (合計1.0)
    // 1:資源(農林水産), 2:加工(工業), 3:サービス(商業), 4:知識(学術), 5:統治(行政)
    '首都': { 1: 0.05, 2: 0.15, 3: 0.30, 4: 0.20, 5: 0.30 },
    '都市': { 1: 0.10, 2: 0.25, 3: 0.30, 4: 0.20, 5: 0.15 },
    '領都': { 1: 0.15, 2: 0.25, 3: 0.30, 4: 0.15, 5: 0.15 },
    '街': { 1: 0.30, 2: 0.30, 3: 0.25, 4: 0.10, 5: 0.05 },
    '町': { 1: 0.55, 2: 0.25, 3: 0.15, 4: 0.03, 5: 0.02 },
    '村': { 1: 0.85, 2: 0.10, 3: 0.04, 4: 0.01, 5: 0.00 },
    '散居': { 1: 0.95, 2: 0.03, 3: 0.02, 4: 0.00, 5: 0.00 }
};

// 産業別の生産性・規模係数
export const INDUSTRY_PARAMS = {
    SMITHING_EFFICIENCY: 1.5, // 鍛冶生産性
    MAGIC_CRAFT_EFFICIENCY: 2.0, // 魔導工芸生産性
    COMMERCE_BASE: 10,        // 商業価値係数
    MAGIC_RESEARCH_BASE: 50,  // 魔導研究係数
    GOVERNANCE_BASE: 0.01     // 統治コスト係数
};

// ================================================================
// ■ 経済・生活パラメータ (v2.1 - 貧困・飢餓算定用)
// ================================================================
// 職業別平均月収 (G)
export const JOB_INCOME = {
    // 1次産業
    '農民': 30, '漁師': 35, '鉱夫': 40, '木こり': 35, '畜夫': 35,
    // 2次産業
    '職人': 120,
    // 3次産業
    '商人': 150, '宿屋・酒場': 100, '運送': 80,
    // その他
    '学者': 100, '騎士': 200, '正規兵': 80, '衛兵・自警団': 40, '官僚': 150, '聖職者': 60,
    'スラム': 5, '孤児': 0
};

// 生活費基準 (貧困ライン)
export const LIVING_COST = {
    '首都': 80, '都市': 70, '領都': 60, '街': 50,
    '町': 30, '村': 20, '散居': 15
};

// 平均世帯人員
export const HOUSEHOLD_SIZE = {
    '首都': 4.0, '都市': 4.2, '領都': 4.5, '街': 4.6,
    '町': 4.8, '村': 5.2, '散居': 5.5
};

// 税率 (推定実効税率)
export const TAX_RATE = {
    '首都': 0.10, '都市': 0.12, '領都': 0.15, '街': 0.18,
    '町': 0.25, '村': 0.30, '散居': 0.30
};

// 輸送積載量 (トン)
export const TRANSPORT_CAPACITY = { 'wagon': 1.0, 'pack_animal': 0.15 };

// ================================================================
// ■ 8. 海運パラメータ (v1.0 - 船種定義)
// ================================================================
// 船舶ごとの性能、必要クルー、運用条件の定義。

export const SHIP_TYPES = {
    'dinghy': {
        name: '小舟・漁船', 
        cargo_capacity_t: 1, 
        range_km: 20, 
        max_offshore_km: 10,
        min_settlement_level: '村', 
        avg_speed_kmh: 4, 
        fishing_capacity: 2, 
        fishing_coefficient: 1,
        crew_requirements: { skipper: 0, crew: 0, fisher: 2 }
    },
    'small_trader': {
        name: '商船・大型漁船', 
        cargo_capacity_t: 10, 
        range_km: 100, 
        max_offshore_km: 20,
        min_settlement_level: '町', 
        avg_speed_kmh: 5, 
        fishing_capacity: 10, 
        fishing_coefficient: 4,
        crew_requirements: { skipper: 1, crew: 5, fisher: 10 }
    },
    'coastal_trader': {
        name: '沿岸交易船', 
        cargo_capacity_t: 30, 
        range_km: 200, 
        max_offshore_km: 20,
        min_settlement_level: '街', 
        avg_speed_kmh: 6, 
        fishing_capacity: 10, 
        fishing_coefficient: 5,
        crew_requirements: { skipper: 1, crew: 10, fisher: 0 }
    },
    'medium_merchant': {
        name: '中型商船', 
        cargo_capacity_t: 200, 
        range_km: 1000, 
        max_offshore_km: Infinity,
        min_settlement_level: '領都', 
        avg_speed_kmh: 8, 
        fishing_capacity: 20, 
        fishing_coefficient: 8,
        crew_requirements: { skipper: 1, crew: 20, fisher: 0 }
    },
    'large_sailing_ship': {
        name: '大型帆船', 
        cargo_capacity_t: 500, 
        range_km: 3000, 
        max_offshore_km: Infinity,
        min_settlement_level: '首都', 
        avg_speed_kmh: 10, 
        fishing_capacity: 50, 
        fishing_coefficient: 10,
        crew_requirements: { skipper: 1, crew: 50, fisher: 0 }
    },
    'lake_boat': {
        name: '湖沼用ボート', 
        cargo_capacity_t: 0.5, 
        range_km: 15, 
        max_offshore_km: 5,
        min_settlement_level: '村', 
        avg_speed_kmh: 4, 
        fishing_capacity: 2, 
        fishing_coefficient: 1,
        crew_requirements: { skipper: 0, crew: 0, fisher: 2 }
    },
    'lake_trader': {
        name: '湖沼交易船', 
        cargo_capacity_t: 5, 
        range_km: 50, 
        max_offshore_km: 10,
        min_settlement_level: '町', 
        avg_speed_kmh: 5, 
        fishing_capacity: 4, 
        fishing_coefficient: 2,
        crew_requirements: { skipper: 1, crew: 2, fisher: 4 }
    },
    'river_canoe': {
        name: '河川用カヌー', 
        cargo_capacity_t: 0.2, 
        range_km: 10, 
        max_offshore_km: 0,
        min_settlement_level: '村', 
        avg_speed_kmh: 3, 
        fishing_capacity: 2, 
        fishing_coefficient: 1,
        crew_requirements: { skipper: 0, crew: 0, fisher: 2 }
    },
    'river_barge': {
        name: '河川用平底船', 
        cargo_capacity_t: 20, 
        range_km: 100, 
        max_offshore_km: 0,
        min_settlement_level: '町', 
        avg_speed_kmh: 5, 
        fishing_capacity: 4, 
        fishing_coefficient: 3,
        crew_requirements: { skipper: 1, crew: 3, fisher: 4 }
    }
};

export const WARSHIP_TYPES = {
    'patrol_boat': { 
        name: '警備艇', 
        combat_power: 10, 
        crew_requirements: { skipper: 1, crew: 5, marine: 5 }, 
        min_settlement_level: '町', 
        type: 'small' 
    },
    'escort_ship': { 
        name: '護衛艦', 
        combat_power: 30, 
        crew_requirements: { skipper: 1, crew: 15, marine: 10 }, 
        min_settlement_level: '街', 
        type: 'medium' 
    },
    'galley': { 
        name: 'ガレー船', 
        combat_power: 50, 
        crew_requirements: { skipper: 1, crew: 50, marine: 30 }, 
        min_settlement_level: '街', 
        type: 'medium' 
    },
    'ship_of_the_line': { 
        name: '戦列艦', 
        combat_power: 100, 
        crew_requirements: { skipper: 1, crew: 80, marine: 40 }, 
        min_settlement_level: '領都', 
        type: 'large' 
    },
    'flagship': { 
        name: '旗艦', 
        combat_power: 200, 
        crew_requirements: { skipper: 1, crew: 150, marine: 60 }, 
        min_settlement_level: '首都', 
        type: 'huge' 
    }
};

export const NAVAL_SETTINGS = {
    // 常備海軍比率
    STANDING_NAVY_RATIO: {
        '村': 0.005, '町': 0.015, '街': 0.025, '領都': 0.035, '都市': 0.035, '首都': 0.05
    },
    // 人員構成 (船員, 海兵, 支援)
    PERSONNEL_COMPOSITION: {
        '村': { sailor: 0.4, marine: 0.4, support: 0.2 },
        '町': { sailor: 0.45, marine: 0.35, support: 0.2 },
        '街': { sailor: 0.5, marine: 0.3, support: 0.2 },
        '領都': { sailor: 0.55, marine: 0.25, support: 0.2 },
        '都市': { sailor: 0.55, marine: 0.25, support: 0.2 },
        '首都': { sailor: 0.6, marine: 0.2, support: 0.2 }
    }
};

export const WATER_BODY_COEFFICIENTS = { RIVER: 0.5, LAKE: 1.0, OCEAN: 2.0 };

// 集落lv -> 保有可能な船種リスト (逆引き用)
export const SHIP_AVAILABILITY = {
    '村': ['dinghy', 'lake_boat', 'river_canoe'],
    '町': ['dinghy', 'small_trader', 'lake_boat', 'lake_trader', 'river_canoe', 'river_barge'],
    '街': ['dinghy', 'small_trader', 'coastal_trader', 'lake_boat', 'lake_trader', 'river_canoe', 'river_barge'],
    '領都': ['dinghy', 'small_trader', 'coastal_trader', 'medium_merchant', 'lake_boat', 'lake_trader', 'river_canoe', 'river_barge'],
    '都市': ['dinghy', 'small_trader', 'coastal_trader', 'medium_merchant', 'lake_boat', 'lake_trader', 'river_canoe', 'river_barge'],
    '首都': ['dinghy', 'small_trader', 'coastal_trader', 'medium_merchant', 'large_sailing_ship', 'lake_boat', 'lake_trader', 'river_canoe', 'river_barge']
};

// ================================================================
// ■ 9. 港湾・海事パラメータ
// ================================================================
export const PORT_PARAMS = {
    // 港の規模による接岸可能最大吃水(m)
    MAX_DRAFT_DEPTH: {
        '村': 2,    // 自然の入り江
        '町': 5,    // 桟橋
        '街': 10,   // 港湾
        '領都': 20, // 大型港
        '都市': 20,
        '首都': 30  // 巨大港
    },
    // 船種ごとの最低航行水深(m)
    MIN_NAVIGATION_DEPTH: {
        'dinghy': 1, 
        'small_trader': 2, 
        'coastal_trader': 4,
        'medium_merchant': 8, 
        'large_sailing_ship': 12,
        'lake_boat': 1, 
        'lake_trader': 2, 
        'river_canoe': 0.5, 
        'river_barge': 1.5
    }
};
