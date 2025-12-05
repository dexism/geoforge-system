// ================================================================
// GeoForge System - 大陸生成モジュール (統合版)
// ================================================================

import { createNoise2D } from 'simplex-noise';
import * as config from './config.js';
import { getIndex } from './utils.js';
import * as d3 from 'd3';
import { WorldMap } from './WorldMap.js';

// ノイズ変数を let で宣言のみ行う
let continentNoise,
    mountainNoise,
    hillNoise,
    detailNoise,
    manaNoise,
    climateNoise,
    forestPotentialNoise,
    grasslandPotentialNoise,
    miningPotentialNoise,
    precipitationNoise,
    seasonalityNoise,
    beachNoise,
    shelfNoise;

/**
 * 全てのノイズ関数を新しいシードで再初期化する関数
 */
export function initializeNoiseFunctions() {
    const seedFn = Math.random;

    continentNoise = createNoise2D(seedFn);
    mountainNoise = createNoise2D(seedFn);
    hillNoise = createNoise2D(seedFn);
    detailNoise = createNoise2D(seedFn);
    manaNoise = createNoise2D(seedFn);
    climateNoise = createNoise2D(seedFn);
    forestPotentialNoise = createNoise2D(seedFn);
    grasslandPotentialNoise = createNoise2D(seedFn);
    miningPotentialNoise = createNoise2D(seedFn);
    precipitationNoise = createNoise2D(seedFn);
    seasonalityNoise = createNoise2D(seedFn);
    beachNoise = createNoise2D(seedFn);
    shelfNoise = createNoise2D(seedFn);
}

// ================================================================
// ■ 定数定義 (保水力計算用)
// ================================================================

const TERRAIN_RETENTION = {
    '深海': 0, // N/A
    '海洋': 0, // N/A
    '湖沼': 0, // N/A
    '平地': 0.60,
    '丘陵': 0.50,
    '山地': 0.40,
    '山岳': 0.30,
    '水域': 0 // フォールバック
};

const CLIMATE_RETENTION_PARAMS = {
    '砂漠気候(寒)': { retention: 0.1, evap: 0.85 },
    'ツンドラ気候': { retention: 0.35, evap: 0.55 },
    '亜寒帯湿潤気候': { retention: 0.65, evap: 0.40 },
    'ステップ気候': { retention: 0.25, evap: 0.75 },
    '地中海性気候': { retention: 0.55, evap: 0.55 },
    '温暖湿潤気候': { retention: 0.65, evap: 0.45 },
    '砂漠気候(熱)': { retention: 0.08, evap: 0.95 },
    '熱帯草原気候': { retention: 0.40, evap: 0.65 },
    '熱帯雨林気候': { retention: 0.75, evap: 0.35 },
    '亜熱帯湿潤気候': { retention: 0.60, evap: 0.50 },
    '亜寒帯乾燥気候': { retention: 0.30, evap: 0.70 },
    '氷雪気候': { retention: 0.12, evap: 0.80 }
};

// ================================================================
// ■ ヘルパー関数
// ================================================================

function clip01(x) {
    return Math.max(0, Math.min(1, x));
}

/**
 * 水源発生確率を計算する関数
 */
function waterSourceProbability(E, P, R, {
    Emax = 4500,   // 最大標高 [m]
    P_half = 800,  // 降水量の半飽和定数 [mm]
    alpha = 1.2,   // 降水の閾値強調係数
    beta = 0.7     // 標高寄与の指数
} = {}) {
    // 標高の正規化と源頭寄与
    const E_norm = clip01(E / Emax);
    const E_src = Math.pow(E_norm, beta); // 標高寄与

    // 降水の飽和（ミカエリス・メンテン型）
    const P_eff = P / (P + P_half);

    // 保水・標高のブースト因子
    const retentionBoost = 0.5 + 0.5 * R;
    const elevationBoost = 0.4 + 0.6 * E_src;

    // 最終確率
    const prob = Math.pow(P_eff, alpha) * retentionBoost * elevationBoost;
    return clip01(prob);
}

/**
 * 保水力を計算する関数
 */
function calculateWaterRetention(terrainType, climateZone) {
    const terrainR = TERRAIN_RETENTION[terrainType] !== undefined ? TERRAIN_RETENTION[terrainType] : 0.5;
    const climateParams = CLIMATE_RETENTION_PARAMS[climateZone] || { retention: 0.5, evap: 0.5 };
    const climateR = climateParams.retention;
    const evap = climateParams.evap;

    // 保水力 = clip((0.6 * 地形保水基準 + 0.4 * 気候保水基準) * (1 - 0.7 * 蒸発散係数), 0, 1)
    const retention = (0.6 * terrainR + 0.4 * climateR) * (1 - 0.7 * evap);
    return clip01(retention);
}

/**
 * 気候区分判定
 */
function classifyClimate(T_mean, P_annual, H_m) {
    const H_ice = 3600;
    const H_alpine = 3000;
    const C = 140;
    const Rb = 20 * T_mean + C;
    const P_rainforest = 2000;
    const P_humid = 800;
    const P_mediterranean_upper = 700;

    if (H_m >= H_ice || T_mean < -5) return "氷雪気候";
    if (H_m >= H_alpine || T_mean < 0.5) return "ツンドラ気候";

    if (P_annual < 0.5 * Rb) return T_mean >= 18 ? "砂漠気候(熱)" : "砂漠気候(寒)";
    if (P_annual < Rb) return "ステップ気候";

    if (T_mean < -3) return P_annual >= Rb ? "亜寒帯湿潤気候" : "亜寒帯乾燥気候";

    if (T_mean >= -3 && T_mean < 18) {
        if (P_annual <= P_mediterranean_upper && P_annual >= 0.5 * Rb) return "地中海性気候";
        return "温暖湿潤気候";
    }

    if (T_mean >= 18 && T_mean < 24) {
        if (P_annual >= P_humid) return "亜熱帯湿潤気候";
        return "熱帯草原気候";
    }

    if (T_mean >= 24) {
        if (P_annual >= P_rainforest) return "熱帯雨林気候";
        return "熱帯草原気候";
    }

    return "温暖湿潤気候";
}

// ================================================================
// ■ 生成ロジック
// ================================================================

/**
 * ベースプロパティ生成 (標高、気温、降水量)
 */
function generateBaseProperties(col, row) {
    const nx = col / config.COLS;
    const ny = row / config.ROWS;

    // --- 1. 大陸マスク ---
    let landStrength = (continentNoise(nx * config.CONTINENT_NOISE_FREQ, ny * config.CONTINENT_NOISE_FREQ) + 1) / 2;
    const distFromCenter = Math.hypot(nx - 0.5, ny - 0.5) * 2;
    if (distFromCenter > config.CONTINENT_FALLOFF_START) {
        const falloff = (distFromCenter - config.CONTINENT_FALLOFF_START) / config.CONTINENT_FALLOFF_RANGE;
        landStrength *= (1 - Math.min(1, falloff));
    }
    if (nx > config.EAST_SEA_BIAS_X_START) {
        const bias = (nx - config.EAST_SEA_BIAS_X_START) / (1 - config.EAST_SEA_BIAS_X_START);
        landStrength -= bias * config.EAST_SEA_BIAS_INTENSITY;
    }
    const distFromNW = Math.hypot(nx, ny);
    if (distFromNW < config.NW_SEA_BIAS_RADIUS) {
        const bias = (config.NW_SEA_BIAS_RADIUS - distFromNW) / config.NW_SEA_BIAS_RADIUS;
        landStrength -= bias * config.NW_SEA_BIAS_INTENSITY;
    }
    landStrength = Math.max(0, landStrength);
    const isWater = landStrength < config.SEA_LEVEL;

    // --- 2. 標高 ---
    let elevation = 0;
    if (!isWater) {
        const coastalDampeningFactor = d3.scaleLinear()
            .domain([config.SEA_LEVEL, config.SEA_LEVEL + 0.2])
            .range([0.1, 1.0])
            .clamp(true)(landStrength);

        let mountain = (mountainNoise(nx * config.MOUNTAIN_NOISE_FREQ, ny * config.MOUNTAIN_NOISE_FREQ) + 1) / 2;
        mountain = Math.pow(mountain, config.MOUNTAIN_DISTRIBUTION_POWER);
        mountain *= Math.pow(landStrength, config.MOUNTAIN_SHAPE_POWER);
        mountain *= config.MOUNTAIN_HEIGHT_MAX;

        let hills = (hillNoise(nx * config.HILL_NOISE_FREQ, ny * config.HILL_NOISE_FREQ) + 1) / 2;
        hills *= config.HILL_HEIGHT_MAX;

        let details = (detailNoise(nx * config.DETAIL_NOISE_FREQ, ny * config.DETAIL_NOISE_FREQ) + 1) / 2;
        details *= config.DETAIL_HEIGHT_MAX;

        const finalElevation = (mountain + hills + details) * coastalDampeningFactor;
        elevation = config.elevationScale(finalElevation);
    }

    // --- 3. 気温 ---
    const latitude = row / config.ROWS;
    const baseTemp = 0 + (latitude * 40);
    const climateVal = baseTemp + climateNoise(nx, ny) * 5;
    let elevationCorrection = 0;
    if (elevation > 0) {
        elevationCorrection = (elevation / 100) * 0.6;
    }
    const temperature = climateVal - elevationCorrection;

    // --- 4. 降水量 ---
    const gradient = Math.pow(nx, config.PRECIPITATION_PARAMS.GRADIENT_POWER);
    let basePrecip = d3.scaleLinear()
        .domain([0, 1])
        .range([config.PRECIPITATION_PARAMS.WEST_COAST_MM, config.PRECIPITATION_PARAMS.EAST_COAST_MM])(gradient);

    const largeNoise = (precipitationNoise(nx * config.PRECIPITATION_PARAMS.LARGE_NOISE_FREQ, ny * config.PRECIPITATION_PARAMS.LARGE_NOISE_FREQ) + 1) / 2;
    const detailNoiseValue = (precipitationNoise(nx * config.PRECIPITATION_PARAMS.DETAIL_NOISE_FREQ, ny * config.PRECIPITATION_PARAMS.DETAIL_NOISE_FREQ) + 1) / 2;
    const noiseEffect = d3.scaleLinear().domain([250, 800]).range([300, 600]).clamp(true)(basePrecip);
    basePrecip += (largeNoise * 0.6 + detailNoiseValue * 0.4 - 0.5) * noiseEffect;

    const distFromSE = Math.hypot(1.0 - nx, 1.0 - ny);
    const southeastBias = Math.max(0, 1.0 - distFromSE / 0.5);
    basePrecip += Math.pow(southeastBias, 2) * config.PRECIPITATION_PARAMS.SOUTHEAST_BIAS_INTENSITY;

    if (isWater) {
        basePrecip *= 1.2;
    }

    const precipitation_mm = Math.max(0, basePrecip);

    return {
        isWater,
        elevation: Math.round(elevation),
        temperature,
        precipitation_mm,
        climate: climateVal // base temp without elevation correction
    };
}

/**
 * 大陸棚生成 (既存ロジック)
 */
function generateContinentalShelves(allHexes) {
    const distanceFromLand = new Map();
    const queue = allHexes.filter(h =>
        h.properties.isWater && h.neighbors.some(n => !allHexes[n].properties.isWater)
    );
    queue.forEach(h => distanceFromLand.set(getIndex(h.col, h.row), 1));

    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        const dist = distanceFromLand.get(getIndex(current.col, current.row));
        current.neighbors.forEach(nIdx => {
            if (allHexes[nIdx].properties.isWater && !distanceFromLand.has(nIdx)) {
                distanceFromLand.set(nIdx, dist + 1);
                queue.push(allHexes[nIdx]);
            }
        });
    }

    const C = config.SHELF_PARAMS;
    const seaHexes = allHexes.filter(h => h.properties.isWater);

    seaHexes.forEach(h => {
        const p = h.properties;
        const nx = h.col / config.COLS;
        const ny = h.row / config.ROWS;
        const noise = (shelfNoise(nx * C.NOISE_FREQ, ny * C.NOISE_FREQ) + 1) / 2;

        const shelfWidthInHexes = C.BASE_WIDTH_HEXES + Math.floor(noise * C.NOISE_WIDTH_HEXES);
        const dist = distanceFromLand.get(getIndex(h.col, h.row));
        const randomizedShelfDepth = C.MAX_DEPTH + noise * 100;

        if (dist !== undefined && dist <= shelfWidthInHexes) {
            const shelfSlope = d3.scaleLinear()
                .domain([1, shelfWidthInHexes])
                .range([-10, randomizedShelfDepth])
                .clamp(true);
            p.elevation = Math.round(shelfSlope(dist));
        } else {
            const landStrength = (continentNoise(nx * config.CONTINENT_NOISE_FREQ, ny * config.CONTINENT_NOISE_FREQ) + 1) / 2;
            const abyssalSlope = d3.scaleLinear()
                .domain([config.SEA_LEVEL * 0.8, 0])
                .range([randomizedShelfDepth, C.ABYSSAL_DEPTH])
                .clamp(true);
            p.elevation = Math.round(abyssalSlope(landStrength));
        }
    });
}

/**
 * 降水量補正 (既存ロジック)
 */
export function applyGeographicPrecipitationEffects(allHexes) {
    const precipCorrections = new Array(allHexes.length).fill(0);

    allHexes.forEach((h, index) => {
        const p = h.properties;
        if (p.isWater) return;

        if (p.elevation > 1500) {
            precipCorrections[index] += config.PRECIPITATION_PARAMS.MOUNTAIN_UPLIFT_BONUS * (p.elevation / 7000);
        }

        const westNeighbor = h.col > 0 ? allHexes[getIndex(h.col - 1, h.row)] : null;
        if (westNeighbor && !westNeighbor.properties.isWater) {
            const elevationDiff = westNeighbor.properties.elevation - p.elevation;
            if (elevationDiff > 800) {
                precipCorrections[index] += config.PRECIPITATION_PARAMS.RAIN_SHADOW_PENALTY;
            }
        }
    });

    allHexes.forEach((h, index) => {
        if (!h.properties.isWater) {
            h.properties.precipitation_mm = Math.max(0, h.properties.precipitation_mm + precipCorrections[index]);
            h.properties.precipitation = Math.min(1.0, h.properties.precipitation_mm / 3000);
        }
    });
}

/**
 * 派生プロパティ計算 (地形、平坦度、気候区分)
 */
function calculateDerivedProperties(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;

        // 地形タイプ
        if (p.isWater) {
            if (p.elevation < config.SHELF_PARAMS.MAX_DEPTH) {
                p.terrainType = '深海'; // カスタムタイプ (WorldMap.jsのTERRAIN_TYPESにはないが、処理用に使用)
            } else if (p.elevation <= 0) {
                p.terrainType = '海洋';
            } else {
                p.terrainType = '湖沼';
            }
        } else {
            if (p.elevation >= config.TERRAIN_ELEVATION.MOUNTAIN_PEAK) {
                p.terrainType = '山岳';
            } else if (p.elevation >= config.TERRAIN_ELEVATION.MOUNTAIN) {
                p.terrainType = '山地';
            } else if (p.elevation >= config.TERRAIN_ELEVATION.HILLS) {
                p.terrainType = '丘陵';
            } else {
                p.terrainType = '平地';
            }
        }

        // 平坦度
        let elevationRange = 0;
        if (h.neighbors.length > 0) {
            const neighborElevations = h.neighbors.map(nIndex => allHexes[nIndex].properties.elevation);
            const maxNeighborElev = Math.max(...neighborElevations);
            const minNeighborElev = Math.min(...neighborElevations);
            elevationRange = maxNeighborElev - minNeighborElev;
        }
        // 標高差0m -> 1.0, 標高差1000m -> 0.0
        p.flatness = Math.max(0, 1.0 - (elevationRange / 1000));

        // 気候区分
        p.climateZone = classifyClimate(p.temperature, p.precipitation_mm, p.elevation);
    });
}

/**
 * 水系生成 (新ロジック)
 */
/**
 * 水系生成 (安定版ロジック + 描画用インデックス修正)
 */
/**
 * 水系生成 (新水源ロジック + 安定版流下ロジック + 描画用インデックス)
 */
/**
 * 保水力計算 (ヘルパー)
 */


export function generateWaterSystems(allHexes) {
    const riverSources = [];

    // 1. 水源の決定 (新ロジック: 保水力モデル)
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) return;

        // 保水力計算
        const retention = calculateWaterRetention(p.terrainType, p.climateZone);
        p.retention = retention; // デバッグ用に保存

        // 水源発生確率
        const prob = waterSourceProbability(p.elevation, p.precipitation_mm, retention);

        if (Math.random() < prob) {
            riverSources.push(h);
        }
    });

    // 2. 流量と下流インデックスの初期化
    allHexes.forEach(h => {
        h.properties.flow = 0;
        h.downstreamIndex = -1; // 下流インデックスを初期化
    });

    // 3. 河川の流下 (安定版ロジック)
    riverSources.forEach(source => {
        let currentCol = source.col;
        let currentRow = source.row;
        for (let i = 0; i < 50; i++) {
            const currentIndex = getIndex(currentCol, currentRow);
            allHexes[currentIndex].properties.flow += 1;
            const neighbors = allHexes[currentIndex].neighbors.map(i => allHexes[i]);
            let lowestNeighbor = null;
            let minElevation = allHexes[currentIndex].properties.elevation;

            neighbors.forEach(n => {
                if (n.properties.elevation < minElevation) {
                    minElevation = n.properties.elevation;
                    lowestNeighbor = n;
                }
            });

            if (lowestNeighbor) {
                // 下流への接続を設定 (描画用)
                allHexes[currentIndex].downstreamIndex = lowestNeighbor.index;

                currentCol = lowestNeighbor.col;
                currentRow = lowestNeighbor.row;

                // 川の終点を、標高0の水域(海)に到達した場合のみとする (安定版の条件)
                if (lowestNeighbor.properties.isWater && lowestNeighbor.properties.elevation <= 0) {
                    lowestNeighbor.properties.flow += 1;
                    break;
                }
            } else {
                // 窪地の場合
                if (!allHexes[currentIndex].properties.isWater) {
                    allHexes[currentIndex].properties.isWater = true;
                    // 湖になった場合、地形タイプを更新 (整合性のため)
                    allHexes[currentIndex].properties.terrainType = '湖沼';
                }
                break;
            }
        }
    });
}

/**
 * 陸地標高補正 (既存ロジック)
 */
function adjustLandElevation(allHexes) {
    const MIN_ELEVATION_TARGET = 10;
    const targetHexes = allHexes.filter(h => !h.properties.isWater || (h.properties.isWater && h.properties.elevation > 0));

    if (targetHexes.length === 0) return;

    let minElevation = Infinity;
    targetHexes.forEach(h => {
        if (h.properties.elevation < minElevation) {
            minElevation = h.properties.elevation;
        }
    });

    if (minElevation < MIN_ELEVATION_TARGET) {
        const elevationToAdd = MIN_ELEVATION_TARGET - minElevation;
        targetHexes.forEach(h => {
            h.properties.elevation += elevationToAdd;
        });
    }
}
/**
 * 稜線生成 (安定版ロジック + 描画用インデックス修正)
 */
export function generateRidgeLines(allHexes) {
    const ridgeSources = allHexes.filter(h => {
        const p = h.properties;
        if (p.isWater || p.flow > 0) return false;
        const elevation = p.elevation;
        const isCandidate = elevation >= 1000 && elevation < 6000;
        if (!isCandidate) return false;
        return Math.random() < 1.0;
    });

    allHexes.forEach(h => {
        h.properties.ridgeFlow = 0;
        h.ridgeUpstreamIndex = -1; // 稜線上流インデックスを初期化
    });

    ridgeSources.forEach(source => {
        let currentHex = source;
        for (let i = 0; i < 50; i++) {
            currentHex.properties.ridgeFlow += 1;
            let highestNeighbor = null;
            let maxElevation = currentHex.properties.elevation;

            currentHex.neighbors.map(i => allHexes[i]).forEach(n => {
                if (n.properties.elevation > maxElevation) {
                    maxElevation = n.properties.elevation;
                    highestNeighbor = n;
                }
            });

            if (highestNeighbor) {
                // 稜線上流への接続を設定
                currentHex.ridgeUpstreamIndex = highestNeighbor.index;

                currentHex = highestNeighbor;
            } else {
                break;
            }
        }
    });
}

/**
 * 植生分布計算 (ヘルパー)
 */
function allocateVegetation({
    T, P, H, waterHa,
    flatness, soilFert, D,
    coastalDist, oceanicity
}) {
    const hexAreaHa = config.HEX_AREA_HA || 8660;
    const landHa = Math.max(0, hexAreaHa - waterHa);

    const s = {
        desert: 0, wasteland: 0, grassland: 0, wetland: 0,
        temperateForest: 0, subarcticForest: 0, tropicalRainforest: 0,
        alpine: 0, tundra: 0, savanna: 0, steppe: 0, coastal: 0
    };

    s.wasteland += 0.05;
    s.grassland += 0.05;

    if (flatness < 0.5) {
        s.wasteland += 0.2 * (1.0 - flatness);
        if (H > 1500) s.alpine += 0.1;
    }

    if (D < 0.5) {
        s.desert += (0.5 - D) * (T >= 18 ? 2.0 : 1.5);
        s.wasteland += 0.2;
    }

    if (soilFert < 0.4 || P < 500) {
        s.wasteland += 0.4 * (1.0 - soilFert);
        if (P >= 300) s.grassland += 0.2 * (1.0 - soilFert);
    }

    if (D >= 0.8 && P >= 300) {
        let score = 0.6 * flatness;
        if (P < 800) score *= 1.2;
        s.grassland += score;
    }

    if (flatness > 0.8 && (P > 1200 || oceanicity > 0.6 || waterHa > 50)) {
        s.wetland += 0.8 * flatness;
    }

    if (P >= 500) {
        if (T >= 24) {
            if (P >= 1500) s.tropicalRainforest += 1.0 * (P / 2000);
            else s.savanna += 0.5;
        } else if (T >= 5) {
            s.temperateForest += 0.8 * soilFert * (P / 1000);
        } else if (T >= -5) {
            s.subarcticForest += 0.7 * (P / 800);
        }
    }

    if (H >= 2500) {
        s.alpine += (H - 2500) / 1000;
        s.wasteland += 0.2;
    }

    if (T < 2) {
        s.tundra += (2 - T) * 0.2;
    }

    if (D >= 0.4 && D < 1.0) {
        if (T >= 18) s.savanna += 0.5;
        else s.steppe += 0.5;
    }

    if (coastalDist < 20) {
        s.coastal += Math.max(0, (20 - coastalDist) / 20) * 0.8;
        s.grassland += 0.2;
    }
    if (oceanicity > 0.7) {
        s.coastal += 0.3;
    }

    Object.keys(s).forEach(k => {
        if (s[k] > 0) {
            s[k] *= (0.8 + Math.random() * 0.4);
        }
    });

    const sum = Object.values(s).reduce((a, b) => a + b, 0);
    const areas = {};
    if (sum === 0) {
        areas.wasteland = landHa;
    } else {
        let total = 0;
        for (const [k, v] of Object.entries(s)) {
            areas[k] = Math.floor((v / sum) * landHa);
            total += areas[k];
        }
        const diff = landHa - total;
        if (diff > 0) {
            const maxKey = Object.keys(areas).reduce((a, b) => areas[a] > areas[b] ? a : b);
            areas[maxKey] += diff;
        }
    }
    areas.water = waterHa;
    return areas;
}

/**
 * 最終プロパティ計算 (植生、産業ポテンシャル)
 */
export function calculateFinalProperties(allHexes) {
    allHexes.forEach(h => {
        const { properties, col, row } = h;
        const { isWater, elevation, temperature } = properties;
        const nx = col / config.COLS;
        const ny = row / config.ROWS;

        // terrainType, flatness は calculateDerivedProperties で計算済みだが、
        // 湖沼化などで変更されている可能性があるため、必要なら再確認
        // ここでは既存の値を信頼する

        properties.isAlluvial = properties.flow > 0 && !isWater && elevation < 4000;
        properties.landUse = { river: 0, desert: 0, barren: 0, grassland: 0, forest: 0 };

        if (isWater) {
            if (properties.elevation < config.SHELF_PARAMS.MAX_DEPTH) {
                properties.vegetation = '深海';
            } else if (properties.elevation <= 0) {
                properties.vegetation = '海洋';
            } else {
                properties.vegetation = '湖沼';
            }
            properties.vegetationAreas = { water: config.HEX_AREA_HA };
        } else {
            const T = properties.temperature;
            const P = properties.precipitation_mm;
            const H = properties.elevation;

            let waterHa = 0;
            if (properties.flow > 0) {
                waterHa = Math.min(config.HEX_AREA_HA * 0.5, properties.flow * 10);
            }

            // 平坦度 (flatness): 周囲との標高差から計算
            let elevationRange = 0;
            if (h.neighbors.length > 0) {
                const neighborElevations = h.neighbors.map(nIndex => allHexes[nIndex].properties.elevation);
                const maxNeighborElev = Math.max(...neighborElevations);
                const minNeighborElev = Math.min(...neighborElevations);
                elevationRange = maxNeighborElev - minNeighborElev;
            }
            // 標高差0m -> 1.0, 標高差1000m -> 0.0
            const flatness = Math.max(0, 1.0 - (elevationRange / 1000));
            properties.flatness = flatness; // プロパティにも保存しておく

            const soilNoiseVal = (forestPotentialNoise(nx * 5, ny * 5) + 1) / 2;
            const soilFert = Math.max(0, Math.min(1, soilNoiseVal + (properties.isAlluvial ? 0.3 : 0)));

            const C = 140;
            const D = P / (20 * T + C);

            let coastalDist = 100;
            let oceanicity = 0.2;
            let hasSeaNeighbor = false;
            h.neighbors.forEach(nIdx => {
                const nHex = allHexes[nIdx];
                if (nHex.properties.isWater && nHex.properties.elevation <= 0) {
                    hasSeaNeighbor = true;
                }
            });

            if (hasSeaNeighbor) {
                coastalDist = 5;
                oceanicity = 0.9;
            } else if (properties.isCoastal) {
                coastalDist = 10;
                oceanicity = 0.8;
            }

            const vegAreas = allocateVegetation({
                T, P, H, waterHa,
                flatness, soilFert, D,
                coastalDist, oceanicity
            });

            properties.vegetationAreas = vegAreas;

            let maxArea = -1;
            let dominantVeg = '荒れ地';
            const excludeKeys = ['water'];
            for (const [key, area] of Object.entries(vegAreas)) {
                if (excludeKeys.includes(key)) continue;
                if (area > maxArea) {
                    maxArea = area;
                    dominantVeg = key;
                }
            }

            const vegNameMap = {
                desert: '砂漠',
                wasteland: '荒れ地',
                grassland: '草原',
                wetland: '湿地',
                temperateForest: '温帯林',
                subarcticForest: '亜寒帯林',
                tropicalRainforest: '熱帯雨林',
                alpine: 'アルパイン',
                tundra: 'ツンドラ',
                savanna: 'サバンナ',
                steppe: 'ステップ',
                coastal: '沿岸植生'
            };

            properties.vegetation = vegNameMap[dominantVeg] || dominantVeg;

            const totalLandArea = config.HEX_AREA_HA - waterHa;
            const safeTotal = totalLandArea > 0 ? totalLandArea : 1;

            properties.landUse = {
                river: waterHa / config.HEX_AREA_HA,
                desert: (vegAreas.desert || 0) / safeTotal,
                barren: ((vegAreas.wasteland || 0) + (vegAreas.alpine || 0) + (vegAreas.tundra || 0)) / safeTotal,
                grassland: ((vegAreas.grassland || 0) + (vegAreas.savanna || 0) + (vegAreas.steppe || 0) + (vegAreas.wetland || 0) + (vegAreas.coastal || 0)) / safeTotal,
                forest: ((vegAreas.temperateForest || 0) + (vegAreas.subarcticForest || 0) + (vegAreas.tropicalRainforest || 0)) / safeTotal
            };
        }

        // 産業ポテンシャル (既存ロジック)
        let agriPotential = 0;
        if (!isWater) {
            if (properties.isAlluvial) agriPotential += 0.5;
            if (h.neighbors.some(nIndex => allHexes[nIndex].properties.vegetation === '湖沼')) agriPotential += 0.3;
            agriPotential += properties.landUse.grassland * 0.2;
            const idealTemp = 17.5;
            const tempFactor = Math.max(0, 1 - Math.abs(temperature - idealTemp) / 15);
            agriPotential += tempFactor * 0.3;

            const precipFactor = d3.scaleLinear()
                .domain([config.PRECIPITATION_PARAMS.DRYNESS_PASTORAL_THRESHOLD, config.PRECIPITATION_PARAMS.DRYNESS_FARMING_THRESHOLD])
                .range([0.1, 1.0])
                .clamp(true)(properties.precipitation_mm);
            agriPotential += precipFactor * 0.2;
        }
        const elevationFactor = d3.scaleLinear()
            .domain([500, 2500])
            .range([1.0, 0.1])
            .clamp(true)(properties.elevation);
        agriPotential *= elevationFactor;
        properties.agriPotential = Math.min(1.0, agriPotential);

        properties.forestPotential = properties.landUse.forest || 0;

        let miningPotential = 0;
        if (!isWater) {
            const rawMiningValue = miningPotentialNoise(nx * 2.0, ny * 2.0);
            const peakFactor = 8;
            let noisePotential = Math.pow(1.0 - Math.abs(rawMiningValue), peakFactor);
            const elevationFactor = 1 + (Math.min(4000, elevation) / 4000) * 0.5;
            miningPotential = noisePotential * elevationFactor;
        }
        properties.miningPotential = Math.min(1.0, miningPotential);

        let isCoastal = false;
        let isLakeside = false;
        if (!isWater) {
            h.neighbors.forEach(nIndex => {
                const nHex = allHexes[nIndex];
                if (nHex.properties.isWater) {
                    const veg = nHex.properties.vegetation;
                    if (veg === '海洋' || veg === '深海') {
                        isCoastal = true;
                    } else if (veg === '湖沼') {
                        isLakeside = true;
                    }
                }
            });
        }
        properties.isCoastal = isCoastal;
        properties.isLakeside = isLakeside;

        let fishingPotential = 0;
        if (!isWater) {
            let waterBonus = 0;
            if (isCoastal) waterBonus = 0.4;
            h.neighbors.forEach(nIndex => {
                const neighborHex = allHexes[nIndex];
                if (neighborHex.properties.isWater) {
                    if (neighborHex.properties.vegetation === '海洋' || neighborHex.properties.vegetation === '深海') {
                        waterBonus = Math.max(waterBonus, 0.9);
                    } else if (neighborHex.properties.vegetation === '湖沼') {
                        waterBonus = Math.max(waterBonus, 0.6);
                    }
                }
            });
            fishingPotential += waterBonus;
            fishingPotential += Math.min(0.8, Math.sqrt(properties.flow) * 0.1);
        }
        properties.fishingPotential = Math.min(1.0, fishingPotential);

        let huntingPotential = 0;
        if (!isWater) {
            let baseScore = 0;
            switch (properties.vegetation) {
                case '温帯林':
                case '熱帯雨林':
                case '亜寒帯林':
                    baseScore = 0.6;
                    break;
                case '草原':
                    baseScore = 0.3;
                    break;
                case '湿地':
                    baseScore = 0.2;
                    break;
                case '荒れ地':
                    baseScore = 0.1;
                    break;
            }
            if (properties.terrainType === '丘陵' || properties.terrainType === '山地') {
                baseScore = Math.max(baseScore, 0.5);
            }
            if (properties.terrainType === '山岳' || properties.vegetation === '砂漠') {
                baseScore = 0;
            }
            huntingPotential = baseScore;

            if (properties.monsterRank) {
                switch (properties.monsterRank) {
                    case 'S': case 'A': case 'B': huntingPotential += 0.4; break;
                    case 'C': case 'D': huntingPotential += 0.2; break;
                }
            }
            if (properties.flow > 0 || h.neighbors.some(nIndex => allHexes[nIndex].properties.vegetation === '湖沼')) {
                huntingPotential += 0.1;
            }
            if (properties.population > 0) {
                const populationPenalty = Math.pow(Math.min(5000, properties.population) / 5000, 2);
                huntingPotential -= populationPenalty;
            }
            huntingPotential -= properties.agriPotential * 0.2;
        }
        properties.huntingPotential = Math.max(0.0, Math.min(1.0, huntingPotential));

        // その他のプロパティ
        properties.hasSnow = false;
        if (!isWater && properties.temperature <= config.SNOW_THRESHOLDS.TEMPERATURE && properties.precipitation > config.SNOW_THRESHOLDS.PRECIPITATION_LIGHT) {
            properties.hasSnow = true;
        }

        const rawManaValue = manaNoise(nx * 2, ny * 2);
        properties.manaValue = Math.pow(1.0 - Math.abs(rawManaValue), 8);
        if (properties.manaValue > 0.9) properties.manaRank = 'S';
        else if (properties.manaValue > 0.7) properties.manaRank = 'A';
        else if (properties.manaValue > 0.4) properties.manaRank = 'B';
        else if (properties.manaValue > 0.1) properties.manaRank = 'C';
        else properties.manaRank = 'D';
        const resourceSymbols = ['石', '鉄', '金', '晶'];
        properties.resourceRank = resourceSymbols[Math.floor(Math.random() * resourceSymbols.length)];
    });
}

function generateBeaches(allHexes) {
    const landElevationScale = d3.scaleLinear().domain([50, 300]).range([1.0, 0.0]).clamp(true);
    const seaDepthScale = d3.scaleLinear().domain([0, -500]).range([1.0, 0.0]).clamp(true);

    allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) return;
        p.beachNeighbors = [];

        const nx = h.col / config.COLS;
        const ny = h.row / config.ROWS;

        h.neighbors.forEach(neighborIndex => {
            const neighbor = allHexes[neighborIndex];
            const n_p = neighbor.properties;
            if (!n_p.isWater) return;

            if (p.vegetation === '湿地') {
                if (p.flow < 20) return;
            }

            const landScore = landElevationScale(p.elevation);
            const seaScore = seaDepthScale(n_p.elevation);
            let beachScore = landScore * seaScore;
            if (beachScore < 0.1) return;

            const riverBonus = 1.0 + Math.min(0.5, Math.sqrt(p.flow / 10) * 0.5);
            beachScore *= riverBonus;

            const landNeighborCount = neighbor.neighbors.filter(idx => !allHexes[idx].properties.isWater).length;
            const bayBonus = 1.0 + (landNeighborCount / 6) * 0.5;
            beachScore *= bayBonus;

            const randomFactor = 0.7 + (beachNoise(nx * 15, ny * 15) + 1) / 2 * 0.6;
            beachScore *= randomFactor;

            if (beachScore > 0.8) {
                p.beachNeighbors.push(neighborIndex);
            }
        });
    });
}

export function recalculateGeographicFlags(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) {
            p.isCoastal = false;
            p.isLakeside = false;
            return;
        }

        let isCoastal = false;
        let isLakeside = false;

        h.neighbors.forEach(nIndex => {
            const nHex = allHexes[nIndex];
            if (nHex && nHex.properties.isWater) {
                const veg = nHex.properties.vegetation;
                if (veg === '海洋' || veg === '深海') {
                    isCoastal = true;
                } else if (veg === '湖沼') {
                    isLakeside = true;
                }
            }
        });

        p.isCoastal = isCoastal;
        p.isLakeside = isLakeside;
    });
}

/**
 * 統合マップ生成関数 (メインエントリポイント)
 */
export async function generateIntegratedMap(addLogMessage, redrawFn) {
    initializeNoiseFunctions();

    await addLogMessage("大陸の土台と気候を生成しています...");
    const allHexes = new WorldMap(config.COLS, config.ROWS);

    // Pass 1: Base Properties
    for (let row = 0; row < config.ROWS; row++) {
        for (let col = 0; col < config.COLS; col++) {
            const index = getIndex(col, row);
            const hex = allHexes[index];
            hex.col = col;
            hex.row = row;
            const props = generateBaseProperties(col, row);
            Object.assign(hex.properties, props);
        }
    }

    // Neighbors cache
    allHexes.forEach(h => {
        const { col, row } = h;
        const isOddCol = col % 2 !== 0;
        h.neighbors = [
            { col: col, row: row - 1 }, { col: col, row: row + 1 },
            { col: col - 1, row: row }, { col: col + 1, row: row },
            { col: col - 1, row: isOddCol ? row + 1 : row - 1 },
            { col: col + 1, row: isOddCol ? row + 1 : row - 1 },
        ].filter(n => n.col >= 0 && n.col < config.COLS && n.row >= 0 && n.row < config.ROWS)
            .map(n => getIndex(n.col, n.row));
    });

    // Pass 1.2: Continental Shelves
    await addLogMessage("大陸棚と深海を形成しています...");
    generateContinentalShelves(allHexes);
    if (redrawFn) await redrawFn(allHexes);

    // Pass 1.5: Geographic Precip
    await addLogMessage("風と地形による降水量を計算しています...");
    applyGeographicPrecipitationEffects(allHexes);

    // Pass 2: Derived Properties (Terrain, Flatness, ClimateZone)
    await addLogMessage("気候区分と地形タイプを判定しています...");
    calculateDerivedProperties(allHexes);

    // Pass 3: Water Systems (New Logic)
    await addLogMessage("水系と河川を配置しています (新保水モデル)...");
    generateWaterSystems(allHexes);
    if (redrawFn) await redrawFn(allHexes);

    // Pass 4: Adjust Land Elevation
    adjustLandElevation(allHexes);

    // Pass 5: Ridge Lines
    await addLogMessage("山系の稜線を計算しています...");
    generateRidgeLines(allHexes);

    // Pass 6: Final Properties (Vegetation, etc.)
    await addLogMessage("植生と資源分布を決定しています...");
    calculateFinalProperties(allHexes);

    await addLogMessage("海岸線の砂浜を形成しています...");
    generateBeaches(allHexes);

    if (redrawFn) await redrawFn(allHexes);

    return allHexes;
}

// 互換性のためのダミー関数 (Step 2が呼ばれた場合用)
export async function generateClimateAndVegetation(allHexes, addLogMessage) {
    await addLogMessage("気候と植生は既に統合生成されています。");
    return allHexes;
}

// 互換性のためのエイリアス
export const generatePhysicalMap = generateIntegratedMap;
