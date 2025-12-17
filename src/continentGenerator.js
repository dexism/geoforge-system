// ================================================================
// GeoForge System - 大陸生成モジュール (統合版)
// ================================================================

import { createNoise2D } from 'simplex-noise';
import * as config from './config.ts';
import { getIndex, globalRandom, getNeighborIndices, initGlobalRandom } from './utils.ts';
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
export function initializeNoiseFunctions(seed) {
    if (seed) {
        initGlobalRandom(seed);
    }
    const seedFn = () => globalRandom.next();

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

    console.log(`[Noise Init] Noise functions initialized (seed: ${seed})`);
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

export { CLIMATE_RETENTION_PARAMS };

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
/**
 * 気候区分判定
 */
export function classifyClimate(T_mean, P_annual, H_m) {
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
        elevationCorrection = elevation * 0.0065;
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
export function generateContinentalShelves(allHexes) {
    const distanceFromLand = new Map();
    // 陸地に隣接する海ヘックスをキューに入れる
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
            // 大陸棚の深度を計算
            const shelfSlope = d3.scaleLinear()
                .domain([1, shelfWidthInHexes])
                .range([-10, randomizedShelfDepth])
                .clamp(true);
            p.elevation = Math.round(shelfSlope(dist));
        } else {
            // 深海の深度を計算
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
 * 山岳による雨陰効果などを適用します。
 */
export function applyGeographicPrecipitationEffects(allHexes) {
    const precipCorrections = new Array(allHexes.length).fill(0);

    allHexes.forEach((h, index) => {
        const p = h.properties;
        if (p.isWater) return;

        // 高山による降水量増加
        if (p.elevation > 1500) {
            precipCorrections[index] += config.PRECIPITATION_PARAMS.MOUNTAIN_UPLIFT_BONUS * (p.elevation / 7000);
        }

        // 雨陰効果 (Rain Shadow)
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

        if (globalRandom.next() < prob) {
            riverSources.push(h);
        }
    });

    console.log(`[River Generation] Sources found: ${riverSources.length}`);
    if (riverSources.length > 0) {
        const sample = riverSources[0];
        console.log(`[River Generation] Sample Source: Elev=${sample.properties.elevation}, Precip=${sample.properties.precipitation_mm}, Retention=${sample.properties.retention}`);
    } else {
        console.log("[River Generation] No sources found. Checking probability stats...");
        let maxProb = 0;
        let maxP = 0;
        allHexes.forEach(h => {
            const p = h.properties;
            if (p.isWater) return;
            const retention = calculateWaterRetention(p.terrainType, p.climateZone);
            const prob = waterSourceProbability(p.elevation, p.precipitation_mm, retention);
            if (prob > maxProb) maxProb = prob;
            if (p.precipitation_mm > maxP) maxP = p.precipitation_mm;
        });
        console.log(`[River Generation] Max Prob: ${maxProb}, Max Precip: ${maxP}`);
    }

    // 2. 流量と下流インデックスの初期化
    allHexes.forEach(h => {
        h.properties.flow = 0;
        h.downstreamIndex = -1; // 下流インデックスを初期化
        h.properties.riverWidth = 0;
        h.properties.riverDepth = 0;
        h.properties.riverVelocity = 0;
        h.properties.waterArea = 0;
        h.properties.Qin = 0; // 一時的な流入量累積用
        h.properties.inflowCount = 0; // 入次数
    });

    // 3. 河川の流下経路決定 (物理ベース: 既存河川への合流優先)
    // ここでは経路(downstreamIndex)のみを確定させる

    // 一時的に「川である」フラグを管理 (Setでインデックスを保持)
    const riverPathSet = new Set();

    riverSources.forEach(source => {
        let currentHex = source;
        riverPathSet.add(currentHex.index);

        for (let i = 0; i < 100; i++) { // ループ回数を少し増やす
            const neighbors = currentHex.neighbors.map(i => allHexes[i]);

            // 候補: 現在地より低いヘックス
            const lowerNeighbors = neighbors.filter(n => n.properties.elevation < currentHex.properties.elevation);

            if (lowerNeighbors.length === 0) {
                // 窪地 (湖)
                if (!currentHex.properties.isWater) {
                    currentHex.properties.isWater = true;
                    currentHex.properties.terrainType = '湖沼';
                }
                break;
            }

            let nextHex = null;

            // 優先順位: 
            // 1. 最も低い場所へ (最大勾配・物理法則)
            // 2. 標高が同じなら、既存の川への合流を優先
            lowerNeighbors.sort((a, b) => {
                const diff = a.properties.elevation - b.properties.elevation;
                if (Math.abs(diff) < 0.1) { // ほぼ同じ高さなら
                    const aIsRiver = riverPathSet.has(a.index);
                    const bIsRiver = riverPathSet.has(b.index);
                    if (aIsRiver && !bIsRiver) return -1;
                    if (!aIsRiver && bIsRiver) return 1;
                }
                return diff;
            });
            nextHex = lowerNeighbors[0];

            if (nextHex) {
                // 既存の経路があれば合流とする（上書きしない）
                if (currentHex.downstreamIndex === -1) {
                    currentHex.downstreamIndex = nextHex.index;
                    riverPathSet.add(nextHex.index);

                    // 終点チェック
                    if (nextHex.properties.isWater && nextHex.properties.elevation <= 0) {
                        break;
                    }
                    currentHex = nextHex;
                } else {
                    // 既に流出先が決まっている場合はそこで終了（合流）
                    break;
                }
            } else {
                break;
            }
        }
    });



    let flowPathCount = 0;
    allHexes.forEach(h => {
        if (h.downstreamIndex !== -1) flowPathCount++;
    });
    console.log(`[River Generation] Hexes with downstream: ${flowPathCount}`);

    // 4. 流量・水域面積の計算 (トポロジカルソート順)

    // 入次数の計算
    allHexes.forEach(h => {
        if (h.downstreamIndex !== -1) {
            const downstream = allHexes[h.downstreamIndex];
            downstream.properties.inflowCount = (downstream.properties.inflowCount || 0) + 1;
        }
    });

    // 入次数0のヘックス（水源）をキューに追加
    const queue = [];
    allHexes.forEach(h => {
        // 川の一部である（下流がある）か、または川が流れ込んでいる（inflowCount > 0）場合のみ対象
        // ただし、inflowCountが0なら水源候補
        if (h.downstreamIndex !== -1 || h.properties.inflowCount > 0) {
            if (h.properties.inflowCount === 0) {
                queue.push(h);
            }
        }
    });

    // トポロジカル順序で処理
    while (queue.length > 0) {
        const current = queue.shift();
        const p = current.properties;

        // 流入方向の特定 (最大の流入量を持つ上流ヘックスを探す)
        // Note: 単純化のため、neighborsBufferを直接参照して方向インデックスを取得
        let maxInflowQ = -1;
        let upstreamIndex = -1;

        // currentへ流れ込むヘックスを探す（逆参照は持っていないため、neighborsを走査）
        // パフォーマンスのため、neighborsBufferの逆引きマップがあれば早いが、
        // ここではneighborsが少ないのでループで許容
        // 実際には、前のステップで「誰から流れてきたか」を記録しておくと良いが、
        // ここでは「最大の流入元」を決定するために、neighborsの中で downstreamIndex === current.index のものを探す

        const upstreamNeighbors = current.neighbors.map(i => allHexes[i]).filter(n => n.downstreamIndex === current.index);

        if (upstreamNeighbors.length > 0) {
            upstreamNeighbors.forEach(up => {
                if (up.properties.flow > maxInflowQ) {
                    maxInflowQ = up.properties.flow;
                    upstreamIndex = up.index;
                }
            });
        }

        // 流出方向
        const downstreamIndex = current.downstreamIndex;

        // 流れのタイプ判定
        let type = "source";
        if (upstreamIndex !== -1 && downstreamIndex !== -1) {
            const getDir = (fromHex, toIdx) => {
                const start = fromHex.index * 6;
                for (let i = 0; i < 6; i++) {
                    if (fromHex._map.neighborsBuffer[start + i] === toIdx) return i;
                }
                return -1;
            };

            const inDir = getDir(current, upstreamIndex); // currentから見たupstreamの方向
            const outDir = getDir(current, downstreamIndex); // currentから見たdownstreamの方向

            if (inDir !== -1 && outDir !== -1) {
                const diff = Math.abs(inDir - outDir);
                // inDirは「上流がいる方向」。流れが入ってくる方向はその逆サイドだが、
                // 角度差の計算としては「上流へのベクトル」と「下流へのベクトル」のなす角を見るのが直感的
                // diff=3 (180度) -> 直線 (Opposite)
                // diff=2 or 4 (120度) -> Second
                // diff=1 or 5 (60度) -> Adjacent
                // diff=0 -> ありえない（逆流）

                if (diff === 3) type = "opposite";
                else if (diff === 2 || diff === 4) type = "second";
            }
        } else if (upstreamIndex !== -1) {
            // 下流がない（湖、海への河口など）
            type = "opposite"; // 仮
        }

        // 高低差 (下流への勾配)
        let dH = 0;
        if (downstreamIndex !== -1) {
            dH = Math.max(0, p.elevation - allHexes[downstreamIndex].properties.elevation);
        } else {
            dH = 10; // デフォルト勾配
        }

        // 海洋性 (簡易判定)
        let oceanicity = 0.2;
        if (current.neighbors.some(ni => {
            const n = allHexes[ni];
            return n.properties.isWater && n.properties.elevation <= 0;
        })) {
            oceanicity = 0.9;
        }

        // 河口判定 (下流が海または湖)
        let isRiverMouth = false;
        let downstreamTerrain = null;
        if (downstreamIndex !== -1) {
            const ds = allHexes[downstreamIndex];
            if (ds.properties.isWater) {
                isRiverMouth = true;
                downstreamTerrain = ds.properties.terrainType;
            }
        }

        // 面積計算
        const result = calcWaterArea({
            Qin: p.Qin, // 累積された流入量
            P: p.precipitation_mm,
            R: p.retention || 0.5,
            dH: dH,
            flatness: p.flatness,
            type: type,
            oceanicity: oceanicity,
            isRiverMouth: isRiverMouth,
            downstreamTerrain: downstreamTerrain
        });

        // 結果を格納
        p.flow = result.Qout; // Qoutをflowとして保存
        p.waterArea = result.WaterArea_ha;
        p.riverWidth = result.width;
        p.riverDepth = result.depth;
        p.riverVelocity = result.v;

        // 1000ha以上の水域は「湖沼」として扱うロジックは削除 (リアルさに欠けるため)
        // if (p.waterArea >= 1000) { ... }

        // 下流へ伝播
        if (downstreamIndex !== -1) {
            const downstream = allHexes[downstreamIndex];
            downstream.properties.Qin += result.Qout;
            downstream.properties.inflowCount--;
            if (downstream.properties.inflowCount === 0) {
                queue.push(downstream);
            }
        }
    }
}

/**
 * 水域面積算定 (ヘルパー関数)
 */
function calcWaterArea({
    Qin, P, R, dH, flatness = 0.5, type, oceanicity, isRiverMouth, downstreamTerrain
}) {
    // --- 区間直線距離 ---
    let L_straight = 10;
    if (type === "second") L_straight = 8.66;
    else if (type === "source") L_straight = 5;

    // --- 蛇行度補正 ---
    const meanderFactor = 1 + (dH / 1000) * (1 - flatness);
    const L_actual = L_straight * meanderFactor; // km

    // --- 流量計算 ---
    // k = 0.0027: 物理的根拠に基づく設定
    // 1 hex = 8660 ha = 86.6 km^2
    // 降水量 P (mm/year) を 流量 Q (m^3/s) に換算する係数
    // Q = P * Area * RunoffRatio / (seconds in year)
    // 1000 mm/y * 86.6 km^2 = 8.66 * 10^7 m^3/y
    // 1 year approx 3.15 * 10^7 sec
    // Q approx 2.74 m^3/s (if RunoffRatio=1.0)
    // dQ = k * P * R  =>  k * 1000 * 1.0 = 2.74  =>  k = 0.00274
    const k = 0.0027;
    const dQ = k * P * R; // 降水・保水寄与
    const Qout = Qin + dQ;

    // --- 水域面積算定 (新ロジック) ---
    // 幅・深さの計算 (物理ベースの指数に戻す)
    // w = a * Q^b, d = c * Q^f
    // b=0.5, f=0.4 が標準的
    const a = 2.0, b = 0.5;
    const c = 0.2, f = 0.4;
    const width = Math.max(2.0, a * Math.pow(Qout, b)); // 最小幅2m
    const depth = Math.max(0.5, c * Math.pow(Qout, f)); // 最小水深0.5m
    const A = width * depth;
    const v = Qout / A;

    const areaResult = waterAreasRiverMouthV2({
        hexHa: config.HEX_AREA_HA,
        L_km: L_actual,
        Q: Qout,
        flatness: flatness,
        oceanicity: oceanicity || 0.2, // デフォルト
        R: R,
        tidalRange: 2.0,
        isRiverMouth: isRiverMouth,
        downstreamTerrain: downstreamTerrain
    });

    return {
        L_actual_km: L_actual,
        Qout,
        v,
        width,
        depth,
        WaterArea_ha: areaResult.waterTotalHa,
        areaDetails: areaResult
    };
}

/**
 * 河口・デルタ向け水域面積算定（タイプ別に分離）
 * 入力:
 *  - hexHa: ヘックス面積[ha]
 *  - L_km: 実流長[km]（河口でも8.66〜10を採用可）
 *  - Q: 累積流量[m3/s]
 *  - flatness[0..1], oceanicity[0..1], R[0..1] 保水力
 *  - tidalRange[m] 潮汐レンジ（例：1〜4m）
 *  - isRiverMouth: 河口フラグ
 * 出力: { channelHa, deltaHa, marshHa, lagoonHa, waterTotalHa }
 */
export function waterAreasRiverMouthV2({
    hexHa = 8660,
    L_km = 8.66,
    Q,
    flatness,
    oceanicity,
    R,
    tidalRange = 2.0,
    isRiverMouth = false,
    downstreamTerrain = null
}) {
    const clip01 = x => Math.max(0, Math.min(1, x));
    const L_m = L_km * 1000;

    // 幅・深さの経験式（物理ベース）
    const a = 2.0, b = 0.5;     // w = a * Q^b
    const c = 0.2, f = 0.4;    // d = c * Q^f
    const w_m = Math.max(2.0, a * Math.pow(Q, b));
    const d_m = Math.max(0.5, c * Math.pow(Q, f));

    // 河道面積
    const channelHa_raw = (L_m * w_m) / 1e4;

    // 河口・デルタ拡張係数
    const tideFactor = clip01(tidalRange / 3.0);               // 0〜1
    const flatWet = clip01(0.6 * flatness + 0.4 * R);          // 0〜1
    const coastFactor = clip01(oceanicity);                     // 0〜1

    // デルタ・干潟面積（河道の数倍に拡張）
    // 河口なら強化、内陸なら抑制
    const deltaMultiplier = isRiverMouth
        ? 1.0 + 4.0 * (0.5 * tideFactor + 0.3 * flatWet + 0.2 * coastFactor)
        : 0.5 + 1.0 * flatWet;

    const deltaHa_raw = channelHa_raw * deltaMultiplier;

    // 湿地（塩湿地・感潮湿地）
    const marshHa_raw = channelHa_raw * (0.8 + 2.5 * flatWet) * (0.5 + 0.5 * coastFactor);

    // 潟湖（lagoon）：潮汐＋海洋性が高く、平坦で保水力が高いほど成立
    // 修正: ヘックス面積依存ではなく、河川規模(channelHa)に依存させる
    // 修正2: 湖への流入時はラグーンを小さくする
    let baseLagoonMult = 2.0 + 6.0 * (0.4 * tideFactor + 0.4 * coastFactor + 0.2 * flatWet); // Max 8.0
    if (downstreamTerrain === '湖沼') {
        baseLagoonMult *= 0.3; // 湖の場合は30%に抑制
    }

    const lagoonMultiplier = isRiverMouth ? baseLagoonMult : 0;

    // channelHaが小さい(小河川)ならラグーンも小さい。大河川なら大きくなる。
    const lagoonHa_raw = channelHa_raw * lagoonMultiplier;

    // 上限（cap）
    const channelCapFrac = isRiverMouth ? 0.20 : 0.10;  // 河道の面積上限
    const deltaCapFrac = isRiverMouth ? 0.60 : 0.20;  // デルタ・干潟の上限
    const marshCapFrac = isRiverMouth ? 0.50 : 0.30;  // 湿地の上限
    const lagoonCapFrac = isRiverMouth ? 0.50 : 0.10;  // 潟湖の上限

    let channelHa = Math.min(channelHa_raw, hexHa * channelCapFrac);
    let deltaHa = Math.min(deltaHa_raw, hexHa * deltaCapFrac);
    let marshHa = marshHa_raw;
    let lagoonHa = lagoonHa_raw;

    // 総面積
    let waterTotalHa = channelHa + deltaHa + marshHa + lagoonHa;

    return {
        channelHa: Math.round(channelHa),
        deltaHa: Math.round(deltaHa),
        marshHa: Math.round(marshHa),
        lagoonHa: Math.round(lagoonHa),
        waterTotalHa: Math.round(waterTotalHa)
    };
}

/**
 * 陸地標高補正 (既存ロジック)
 * 小さすぎる島や低地を修正するなどの後処理を行います。
 */
export function adjustLandElevation(allHexes) {
    const MIN_ELEVATION_TARGET = 10; // 定数定義が見つからない場合のフォールバック

    const landHexes = allHexes.filter(h => !h.properties.isWater);
    if (landHexes.length === 0) return;

    // 連結成分分解
    const visited = new Set();
    const clusters = [];

    landHexes.forEach(h => {
        if (!visited.has(h.index)) {
            const cluster = [];
            const queue = [h];
            visited.add(h.index);
            while (queue.length > 0) {
                const current = queue.shift();
                cluster.push(current);
                current.neighbors.forEach(nIdx => {
                    const nHex = allHexes[nIdx];
                    if (!nHex.properties.isWater && !visited.has(nIdx)) {
                        visited.add(nIdx);
                        queue.push(nHex);
                    }
                });
            }
            clusters.push(cluster);
        }
    });

    // 最大の島を見つける
    clusters.sort((a, b) => b.length - a.length);
    const targetHexes = clusters[0];

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
            // [FIX] 整数に丸めて整合性を確保
            h.properties.elevation = Math.round(h.properties.elevation + elevationToAdd);
        });
    }
}

/**
 * 稜線生成 (安定版ロジック + 描画用インデックス修正)
 * 川とは逆に、低いところから高いところへ昇るラインを形成します。
 */
export function generateRidgeLines(allHexes) {
    const ridgeSources = allHexes.filter(h => {
        const p = h.properties;
        if (p.isWater || p.flow > 0) return false;
        const elevation = p.elevation;
        const isCandidate = elevation >= 1000 && elevation < 6000;
        if (!isCandidate) return false;
        return globalRandom.next() < 1.0;
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
export function allocateVegetation({
    T, P, H, waterHa,
    flatness, soilFert, D,
    coastalDist, oceanicity,
    deductedHa = 0 // 水系以外に控除する面積 (砂浜、集落、道路など)
}) {
    const hexAreaHa = config.HEX_AREA_HA || 8660;
    const landHa = Math.max(0, hexAreaHa - waterHa - deductedHa);

    const s = {
        desert: 0, wasteland: 0, grassland: 0, wetland: 0,
        temperateForest: 0, subarcticForest: 0, tropicalRainforest: 0,
        alpine: 0, tundra: 0, savanna: 0, steppe: 0, coastal: 0,
        iceSnow: 0
    };

    // 氷雪帯: 高標高 or 極低温
    if (T <= -5 || H >= 4000) {
        s.iceSnow = 1.2;
    }

    s.wasteland += 0.05;
    s.grassland += 0.05;

    if (flatness < 0.5) {
        s.wasteland += 0.2 * (1.0 - flatness);
        if (H > 1500) s.alpine += 0.1;
    }

    if (D < 0.5 && s.iceSnow === 0) {
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

    if (H >= 2500 && s.iceSnow === 0) {
        s.alpine += (H - 2500) / 1000;
        s.wasteland += 0.2;
    }

    if (T < 2 && s.iceSnow === 0) {
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

    // Random noise removed per specification (no noise in vegetation distribution as it's recalculated on startup)
    // Object.keys(s).forEach(k => {
    //     if (s[k] > 0) {
    //         s[k] *= (0.8 + globalRandom.next() * 0.4);
    //     }
    // });

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
 * 砂浜生成
 * 海岸線に沿って砂浜を配置します。
 */
export function generateBeaches(allHexes, mapCols = config.COLS, mapRows = config.ROWS) {
    const landElevationScale = d3.scaleLinear().domain([50, 300]).range([1.0, 0.0]).clamp(true);
    const seaDepthScale = d3.scaleLinear().domain([0, -500]).range([1.0, 0.0]).clamp(true);

    const sideLen = config.HEX_SIDE_LENGTH_KM || 5.77;
    const widthM = config.BEACH_WIDTH_M || 50;

    allHexes.forEach(h => {
        if (!beachNoise) {
            console.error("[ERROR] beachNoise is not initialized!");
            return;
        }
        const p = h.properties;
        if (p.isWater) return;
        p.beachNeighbors = [];
        p.beachArea = 0; // 初期化

        const nx = h.col / mapCols;
        const ny = h.row / mapRows;

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
            const randomFactor = 0.7 + (beachNoise(nx * 15, ny * 15) + 1) / 2 * 0.6;
            beachScore *= randomFactor;

            if (beachScore > 0.8) {
                p.beachNeighbors.push(neighborIndex);

                // 面積計算
                const effectiveScore = Math.min(1.0, beachScore);
                const area = effectiveScore * sideLen * widthM / 10;
                p.beachArea += area;
            }
        });

        // vegetationAreasにも入れておく
        if (!p.vegetationAreas) p.vegetationAreas = {};
        p.vegetationAreas.beach = p.beachArea;
    });
}

/**
 * 最終プロパティ計算 (植生、産業ポテンシャル)
 * 気候・地形・水系データに基づき、ヘックスごとの最終的な植生や産業価値を算出します。
 */
export function calculateFinalProperties(allHexes, mapCols = config.COLS, mapRows = config.ROWS, options = {}) {
    // 事前に海岸からの距離をBFSで全計算 (Flyweightパターン対応のため、TypedArrayを使用)
    const distArray = new Float32Array(allHexes.length).fill(Infinity);
    const queue = []; // Store indices

    allHexes.forEach(h => {
        const veg = h.properties.vegetation;
        // ソースは海洋または深海 (大陸棚の外縁も考慮)
        // [FIX] ロード直後でvegが未設定の場合でも、標高とisWaterで判定してBFS起点に追加する
        const isOceanOrDeep = (veg === '海洋' || veg === '深海') ||
            (!veg && h.properties.isWater && h.properties.elevation <= 0);

        if (isOceanOrDeep && h.properties.isWater) {
            distArray[h.index] = 0;
            queue.push(h.index);
        }
    });

    // [DEBUG] Log BFS queue size and sample check
    // console.log(`[Geo Internal] BFS Queue initialized with ${queue.length} water hexes.`);

    let pointer = 0;
    while (pointer < queue.length) {
        const uIdx = queue[pointer++];
        const currentDist = distArray[uIdx];

        // Neighbors are accessed via WorldMap/allHexes
        const uHex = allHexes[uIdx];
        uHex.neighbors.forEach(vIdx => {
            if (distArray[vIdx] > currentDist + 1) {
                distArray[vIdx] = currentDist + 1;
                queue.push(vIdx);
            }
        });
    }

    allHexes.forEach(h => {
        const { properties, col, row } = h;
        const { isWater, elevation, temperature } = properties;
        const nx = col / mapCols;
        const ny = row / mapRows;

        // terrainType, flatness は calculateDerivedProperties で計算済みだが、
        // 湖沼化などで変更されている可能性があるため、必要なら再確認
        // ここでは既存の値を信頼する

        properties.isAlluvial = properties.flow > 0 && !isWater && elevation < 4000;
        properties.landUse = { river: 0, desert: 0, barren: 0, grassland: 0, forest: 0 };

        if (isWater) {
            // [FIX] 既存の植生判定(initializeWaterVegetationで設定されたもの)があればそれを優先する
            // 無ければ(生成時など)、標高ベースのフォールバックを行う
            if (!properties.vegetation || !['深海', '海洋', '湖沼'].includes(properties.vegetation)) {
                if (properties.elevation < config.SHELF_PARAMS.MAX_DEPTH) {
                    properties.vegetation = '深海';
                } else if (properties.elevation <= 0) {
                    properties.vegetation = '海洋';
                } else {
                    properties.vegetation = '湖沼';
                }
            }
            properties.vegetationAreas = { water: config.HEX_AREA_HA };
        } else {
            const T = properties.temperature;
            const P = properties.precipitation_mm;
            const H = properties.elevation;

            let waterHa = 0;
            if (properties.flow > 0) {
                // 新しい計算結果を使用
                waterHa = properties.waterArea || 0;
                // 安全策: 極端な値のクリップ (ヘックス面積の80%まで)
                waterHa = Math.min(config.HEX_AREA_HA * 0.8, waterHa);
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

            // 沿岸距離と海洋性の計算
            // 1ステップ ≈ 5.77km (HEX_SIDE_LENGTH_KM) と仮定
            const stepKm = config.HEX_SIDE_LENGTH_KM || 5.77;
            const distSteps = distArray[h.index]; // Use TypedArray
            let coastalDist = (distSteps === Infinity) ? 1000 : distSteps * stepKm;

            // 海洋性 (oceanicity): 距離に応じて減衰
            // 0km -> 1.0, 50km -> 0.5, 100km -> 0.0
            let oceanicity = Math.max(0, 1.0 - (coastalDist / 100));

            // 湖沼の影響を加味 (局所的な湿気)
            let hasLakeNeighbor = false;
            h.neighbors.forEach(nIdx => {
                const nHex = allHexes[nIdx];
                if (nHex.properties.vegetation === '湖沼') hasLakeNeighbor = true;
            });
            if (hasLakeNeighbor) {
                // 湖岸は少し海洋性を持つが、沿岸植生("Coastal")にはなりにくいように調整
                oceanicity = Math.max(oceanicity, 0.4);
            }

            const beachHa = properties.beachArea || 0;
            const settlementHa = properties.settlementArea || 0;
            const roadHa = properties.roadArea || 0;
            const totalDeduction = beachHa + settlementHa + roadHa;

            // 植生割り当て (決定論的: ノイズ除去済み)
            const vegAreas = allocateVegetation({
                T, P, H, waterHa,
                flatness, soilFert, D,
                coastalDist, oceanicity,
                deductedHa: totalDeduction
            });

            // 砂浜面積をvegetationAreasに統合
            if (beachHa > 0) {
                vegAreas.beach = beachHa;
            }

            properties.vegetationAreas = vegAreas;

            if (options.preserveVegetation && properties.vegetation) {
                // 既存の植生を維持 (ロード時)
            } else {
                let maxArea = -1;
                let dominantVeg = 'wasteland';
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
                    coastal: '沿岸植生',
                    iceSnow: '氷雪帯'
                };

                properties.vegetation = vegNameMap[dominantVeg] || dominantVeg;
            }

            const totalLandArea = config.HEX_AREA_HA - waterHa;
            const safeTotal = totalLandArea > 0 ? totalLandArea : 1;

            properties.landUse = {
                river: waterHa / config.HEX_AREA_HA,
                beach: (vegAreas.beach || 0) / safeTotal,
                desert: (vegAreas.desert || 0) / safeTotal,
                barren: ((vegAreas.wasteland || 0) + (vegAreas.alpine || 0) + (vegAreas.tundra || 0) + (vegAreas.iceSnow || 0)) / safeTotal,
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
        // [FIX] Preserve existing miningPotential if loading
        if (options.preserveVegetation && typeof properties.miningPotential !== 'undefined') {
            miningPotential = properties.miningPotential;
        } else if (!isWater) {
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

        // [FIX] Preserve existing isCoastal/isLakeside if already set (by recalculateGeographicFlags)
        if (properties.isCoastal) isCoastal = true;
        if (properties.isLakeside) isLakeside = true;

        properties.isCoastal = isCoastal;
        properties.isLakeside = isLakeside;

        let fishingPotential = 0;
        // [FIX] Preserve existing fishingPotential if loading
        if (options.preserveVegetation && typeof properties.fishingPotential !== 'undefined') {
            fishingPotential = properties.fishingPotential;
        } else if (!isWater) {
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
        // [FIX] Preserve existing huntingPotential if loading
        if (options.preserveVegetation && typeof properties.huntingPotential !== 'undefined') {
            huntingPotential = properties.huntingPotential;
        }
        properties.huntingPotential = Math.max(0.0, Math.min(1.0, huntingPotential));

        // その他のプロパティ
        properties.hasSnow = false;
        if (!isWater && properties.temperature <= config.SNOW_THRESHOLDS.TEMPERATURE && properties.precipitation > config.SNOW_THRESHOLDS.PRECIPITATION_LIGHT) {
            properties.hasSnow = true;
        }

        // [FIX] Preserve existing manaValue/manaRank/resourceRank if loading
        if (options.preserveVegetation && typeof properties.manaValue !== 'undefined') {
            // Keep existing mana and resource values
        } else {
            const rawManaValue = manaNoise(nx * 2, ny * 2);
            properties.manaValue = Math.pow(1.0 - Math.abs(rawManaValue), 8);
            if (properties.manaValue > 0.9) properties.manaRank = 'S';
            else if (properties.manaValue > 0.7) properties.manaRank = 'A';
            else if (properties.manaValue > 0.4) properties.manaRank = 'B';
            else if (properties.manaValue > 0.1) properties.manaRank = 'C';
            else properties.manaRank = 'D';
            const resourceSymbols = ['石', '鉄', '金', '晶'];
            properties.resourceRank = resourceSymbols[Math.floor(globalRandom.next() * resourceSymbols.length)];
        }
    });
}

// Export recalculateGeographicFlags so it can be used in main.js
// 外部からも利用可能な地理フラグ再計算関数
export function recalculateGeographicFlags(allHexes) {
    let debugCount = 0;
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) {
            p.isCoastal = false;
            p.isLakeside = false;
            return;
        }

        let isCoastal = false;
        let isLakeside = false;

        // [DEBUG] Trace specific hex (e.g. index 0)
        const isDebugTarget = (h.col === 0 && h.row === 0);

        h.neighbors.forEach(nIndex => {
            const nHex = allHexes[nIndex];
            if (nHex && nHex.properties.isWater) {
                const veg = nHex.properties.vegetation;
                // if (isDebugTarget) console.log(`[GeoFlag Internal] Hex[0,0] neighbor ${nIndex} isWater=true, veg=${veg}`);

                if (veg === '海洋' || veg === '深海') {
                    isCoastal = true;
                } else if (veg === '湖沼') {
                    isLakeside = true;
                } else {
                    // 植生情報が不十分な場合のフォールバック: 標高で判定
                    // 標高 <= 0 なら海、> 0 なら湖
                    if (nHex.properties.elevation <= 0) {
                        isCoastal = true;
                    } else {
                        isLakeside = true;
                    }
                }
            } else if (isDebugTarget) {
                // console.log(`[GeoFlag Internal] Hex[0,0] neighbor ${nIndex} isWater=${nHex ? nHex.properties.isWater : 'null'}`);
            }
        });

        p.isCoastal = isCoastal;
        p.isLakeside = isLakeside;

        if (isCoastal && debugCount < 5) {
            console.log(`[GeoFlag Internal] Hex [${h.col},${h.row}] set to Coastal.`);
            debugCount++;
        }
        // [DEBUG] Lakeside failure trace
        if (p.vegetation === '湖沼' && !isLakeside && debugCount < 20) {
            debugCount++;
            const neighborsDebug = h.neighbors.map(ni => {
                const n = allHexes[ni];
                return `[${ni}: W=${n.properties.isWater}, V=${n.properties.vegetation}, E=${n.properties.elevation}]`;
            }).join(', ');
            console.log(`[GeoFlag Debug] Lake Hex [${h.col},${h.row}] (Veg:湖沼) FAILED Lakeside check. Neighbors: ${neighborsDebug}`);
        }
    });
}

/**
 * 統合マップ生成関数 (メインエントリポイント)
 * マップ生成の全工程を統括し、各フェーズを順次実行します。
 */
export async function generateIntegratedMap(addLogMessage, redrawFn) {
    initializeNoiseFunctions();

    await addLogMessage("大陸の土台と気候を生成しています...");
    const allHexes = new WorldMap(config.COLS, config.ROWS);

    // Pass 1: Base Properties
    // 基本プロパティ（大陸形状、標高、気温、基本降水量）の生成
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
    // 近隣ヘックスのインデックスをキャッシュ
    allHexes.forEach(h => {
        h.neighbors = getNeighborIndices(h.col, h.row, config.COLS, config.ROWS);
    });

    // Pass 1.2: Continental Shelves
    // 大陸棚と深海の形成
    await addLogMessage("大陸棚と深海を形成しています...");
    generateContinentalShelves(allHexes);
    if (redrawFn) await redrawFn(allHexes);

    // Pass 1.5: Geographic Precip
    // 風と地形による降水量の計算
    await addLogMessage("風と地形による降水量を計算しています...");
    applyGeographicPrecipitationEffects(allHexes);

    // Pass 2: Derived Properties (Terrain, Flatness, ClimateZone)
    // 派生プロパティ（地形、平坦度、気候帯）の計算
    await addLogMessage("気候区分と地形タイプを判定しています...");
    calculateDerivedProperties(allHexes);

    // Pass 3: Water Systems (New Logic)
    // 水系と河川の生成（新しい保水モデル）
    await addLogMessage("水系と河川を配置しています (新保水モデル)...");
    generateWaterSystems(allHexes);
    if (redrawFn) await redrawFn(allHexes);

    // Pass 4: Adjust Land Elevation
    // 陸地の標高調整
    adjustLandElevation(allHexes);

    // Pass 5: Ridge Lines
    // 山系の稜線の計算
    await addLogMessage("山系の稜線を計算しています...");
    generateRidgeLines(allHexes);

    // Pass 5.5: Beaches (Moved before allocation)
    // 海岸線の砂浜の形成
    await addLogMessage("海岸線の砂浜を形成しています...");
    generateBeaches(allHexes);

    // Debug: Check beach generation
    let beachCount = 0;
    let totalBeachArea = 0;
    allHexes.forEach(h => {
        if (h.properties.beachArea > 0) {
            beachCount++;
            totalBeachArea += h.properties.beachArea;
        }
    });
    console.log(`[DEBUG] Beaches generated: count=${beachCount}, totalArea=${totalBeachArea}ha`);
    await addLogMessage(`砂浜生成完了: ${beachCount}箇所, 計${Math.round(totalBeachArea)}ha`);

    // Pass 6: Final Properties (Vegetation, etc.)
    // 最終プロパティ（植生、資源など）の決定
    await addLogMessage("植生と資源分布を決定しています...");
    calculateFinalProperties(allHexes);

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

/**
 * 既存の流量データから河川の形状プロパティ（幅、深さ、面積）を再計算する関数
 * ロード時にこれらのデータが保存されていない場合に補完するために使用
 */
export function recalculateRiverProperties(allHexes) {
    console.log("Recalculating river properties from flow data (Full Restoration)...");

    // 物理ベースの係数 (continentGenerator.js内の生成ロジックと一致させる)
    const a = 2.0, b = 0.5;
    const c = 0.2, f = 0.4;

    allHexes.forEach(h => {
        const p = h.properties;
        if (p.flow > 0 && !p.isWater) {
            // 1. 周辺情報の再取得 (Flatness, Oceanicity, RiverMouth)
            let elevationRange = 0;
            let hasSeaNeighbor = false;
            let minNeighborElev = p.elevation;

            if (h.neighbors && h.neighbors.length > 0) {
                const neighborElevations = h.neighbors.map(nIndex => allHexes[nIndex].properties.elevation);
                const maxNeighborElev = Math.max(...neighborElevations);
                minNeighborElev = Math.min(...neighborElevations);
                elevationRange = maxNeighborElev - minNeighborElev;

                h.neighbors.forEach(nIdx => {
                    const n = allHexes[nIdx];
                    if (n.properties.isWater && n.properties.elevation <= 0) hasSeaNeighbor = true;
                });
            }

            const flatness = Math.max(0, 1.0 - (elevationRange / 1000));
            const oceanicity = hasSeaNeighbor ? 0.9 : 0.2;

            // 下流が海/湖かどうか (RiverMouth判定)
            // downstreamIndexがないため、neighborsの中で「自分より低く、かつ水域」のものがあれば河口とみなす簡易判定
            // または、isCoastalフラグがあれば河口の可能性が高い
            let isRiverMouth = false;
            let downstreamTerrain = null;

            // Try to deduce downstream from neighbors with lower elevation (heuristic)
            const downNeighbors = h.neighbors.map(i => allHexes[i]).filter(n => n.properties.elevation < p.elevation);
            if (downNeighbors.length > 0) {
                // The one with max flow is likely the downstream? Or just any water?
                // If neighbor is water, it's likely a mouth
                const waterNeighbor = downNeighbors.find(n => n.properties.isWater);
                if (waterNeighbor) {
                    isRiverMouth = true;
                    downstreamTerrain = waterNeighbor.properties.terrainType;
                }
            }
            if (p.isCoastal) isRiverMouth = true;


            // Calculate area using the logic
            // Need Qin logic? No, just use flow as Qout approximation for restoration
            // (Ideally we have Qin, but flow is Qout)

            // calcWaterArea logic:
            // Q = flow (Qout)
            // width = a * flow^b
            // depth = c * flow^f
            // A = width * depth
            // v = flow / A
            const width = Math.max(2.0, a * Math.pow(p.flow, b));
            const depth = Math.max(0.5, c * Math.pow(p.flow, f));
            const A = width * depth;
            const v = p.flow / A;

            p.riverWidth = width;
            p.riverDepth = depth;
            p.riverVelocity = v;

            // Area from waterAreasRiverMouthV2
            // We need L_actual. Estimate from flatness.
            let dH = 10; // Default
            const meanderFactor = 1 + (dH / 1000) * (1 - flatness);
            const L_actual = 8.66 * meanderFactor; // approx

            // Retention? Unknown, use default
            const R = 0.5;

            const areaResult = waterAreasRiverMouthV2({
                hexHa: config.HEX_AREA_HA,
                L_km: L_actual,
                Q: p.flow,
                flatness: flatness,
                oceanicity: oceanicity,
                R: R,
                tidalRange: 2.0,
                isRiverMouth: isRiverMouth,
                downstreamTerrain: downstreamTerrain
            });

            p.waterArea = areaResult.waterTotalHa;
        }
    });
}

/**
 * 水域ヘックスの植生プロパティを初期化する (ロード時復元用)
 * @param {Array<object>} allHexes
 */
export function initializeWaterVegetation(allHexes) {
    if (!allHexes || allHexes.length === 0) return;

    allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) {
            // 生成ロジック(calculateDerivedProperties)との完全一致
            // 標高0以下は海洋、0より上は湖沼
            if (p.elevation < config.SHELF_PARAMS.MAX_DEPTH) {
                p.vegetation = '深海';
                p.terrainType = '深海';
            } else if (p.elevation <= 0) {
                p.vegetation = '海洋';
                p.terrainType = '海洋';
            } else {
                p.vegetation = '湖沼';
                p.terrainType = '湖沼';
            }
            // 面積も初期化
            if (!p.vegetationAreas) p.vegetationAreas = {};
            p.vegetationAreas.water = config.HEX_AREA_HA;
        }
    });
    console.log(`[Restoration] Water vegetation initialized (Elevation-based).`);
}



