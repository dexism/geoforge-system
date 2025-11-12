// ================================================================
// GeoForge System - 大陸生成モジュール (v3.2 - 新降水モデル)
// ================================================================

import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';
import * as config from './config.js';
import { getIndex } from './utils.js';
import * as d3 from 'd3'; // d3-scaleをスケール計算に利用

// --- ノイズジェネレーターの初期化 ---
const continentNoise = createNoise2D();
const mountainNoise = createNoise2D();
const hillNoise = createNoise2D();
const detailNoise = createNoise2D();
const manaNoise = createNoise2D();
const climateNoise = createNoise2D(); 
const forestPotentialNoise = createNoise2D();
const grasslandPotentialNoise = createNoise2D();
const miningPotentialNoise = createNoise2D();
const precipitationNoise = createNoise2D();
const seasonalityNoise = createNoise2D();


/**
 * 安定した手法で自然な地形を生成する
 * @param {number} col - ヘックスの列
 * @param {number} row - ヘックスの行
 * @returns {object} - 計算されたプロパティ
 */
function generateBaseProperties(col, row) {
    const nx = col / config.COLS;
    const ny = row / config.ROWS;

    // --- 1. 大陸マスクの生成 ---
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

    // --- 2. 陸地に地形の起伏を追加 ---
    let elevation = 0;
    if (!isWater) {
        let mountain = (mountainNoise(nx * config.MOUNTAIN_NOISE_FREQ, ny * config.MOUNTAIN_NOISE_FREQ) + 1) / 2;
        mountain = Math.pow(mountain, config.MOUNTAIN_DISTRIBUTION_POWER);
        mountain *= Math.pow(landStrength, config.MOUNTAIN_SHAPE_POWER);
        mountain *= config.MOUNTAIN_HEIGHT_MAX;
        let hills = (hillNoise(nx * config.HILL_NOISE_FREQ, ny * config.HILL_NOISE_FREQ) + 1) / 2;
        hills *= config.HILL_HEIGHT_MAX;
        let details = (detailNoise(nx * config.DETAIL_NOISE_FREQ, ny * config.DETAIL_NOISE_FREQ) + 1) / 2;
        details *= config.DETAIL_HEIGHT_MAX;
        elevation = mountain + hills + details;
    }

    // --- 3. 気温と標高を計算 ---
    const properties = {};
    properties.isWater = isWater;
    properties.elevation = isWater ? 0 : config.elevationScale(elevation);
    const latitude = row / config.ROWS;
    const baseTemp = 0 + (latitude * 40);
    properties.climate = baseTemp + climateNoise(nx, ny) * 5;
    let elevationCorrection = 0;
    if (properties.elevation > 0) {
        elevationCorrection = (properties.elevation / 100) * 0.6;
    }
    properties.temperature = properties.climate - elevationCorrection;

    // a. 大域勾配: 西から東へ行くほど降水量が増加するベースを作成
    const gradient = Math.pow(nx, config.PRECIPITATION_PARAMS.GRADIENT_POWER);
    let basePrecip = d3.scaleLinear()
        .domain([0, 1])
        .range([config.PRECIPITATION_PARAMS.WEST_COAST_MM, config.PRECIPITATION_PARAMS.EAST_COAST_MM])(gradient);

    // b. 局所ノイズ: 大域的なムラと、局所的な変化を追加
    const largeNoise = (precipitationNoise(nx * config.PRECIPITATION_PARAMS.LARGE_NOISE_FREQ, ny * config.PRECIPITATION_PARAMS.LARGE_NOISE_FREQ) + 1) / 2;
    const detailNoiseValue = (precipitationNoise(nx * config.PRECIPITATION_PARAMS.DETAIL_NOISE_FREQ, ny * config.PRECIPITATION_PARAMS.DETAIL_NOISE_FREQ) + 1) / 2;
    // 乾燥地帯は大きなムラ、湿潤地帯は細かい変化の影響を強く受けるように合成
    const noiseEffect = d3.scaleLinear().domain([250, 800]).range([300, 600]).clamp(true)(basePrecip);
    basePrecip += (largeNoise * 0.6 + detailNoiseValue * 0.4 - 0.5) * noiseEffect;
    
    // c. 南東部の多雨バイアス: 南東角に近いほど降水量をブースト
    const distFromSE = Math.hypot(1.0 - nx, 1.0 - ny);
    const southeastBias = Math.max(0, 1.0 - distFromSE / 0.5); // 南東角から半径50%の範囲
    basePrecip += Math.pow(southeastBias, 2) * config.PRECIPITATION_PARAMS.SOUTHEAST_BIAS_INTENSITY;
    
    // d. 海上では陸地よりも降水量を少し多めにする補正
    if (isWater) {
        basePrecip *= 1.2;
    }
    
    properties.precipitation_mm = Math.max(0, basePrecip);
    // 古い0-1スケールの降水量は廃止。互換性のため最大3000mmで正規化した値を残す。
    properties.precipitation = Math.min(1.0, properties.precipitation_mm / 3000);

    // ケッペンの乾燥限界に基づいた新しい気候帯判定
    // (山脈補正は、全ヘックス生成後の第2パスで行うため、ここでは仮計算)

    // a. 季節性係数 'x' をノイズで決定
    const seasonNoise = (seasonalityNoise(nx * 0.5, ny * 0.5) + 1) / 2;
    let seasonalityFactor;
    if (seasonNoise < 0.33) seasonalityFactor = config.PRECIPITATION_PARAMS.SEASONALITY_WINTER_RAIN; // 冬雨
    else if (seasonNoise > 0.66) seasonalityFactor = config.PRECIPITATION_PARAMS.SEASONALITY_SUMMER_RAIN; // 夏雨
    else seasonalityFactor = config.PRECIPITATION_PARAMS.SEASONALITY_UNIFORM; // 通年

    // b. 乾燥限界 r = 20(t+x) を計算
    const drynessLimit = 20 * (properties.temperature + seasonalityFactor);

    // c. 新しい基準で気候帯を判定
    if (properties.precipitation_mm < drynessLimit * 0.5) {
        properties.climateZone = properties.temperature < 18 ? "砂漠気候(寒)" : "砂漠気候(熱)";
    } else if (properties.precipitation_mm < drynessLimit) {
        properties.climateZone = "ステップ気候";
    } else { // 湿潤気候の場合、従来の気温ベースの判定を行う
        if (properties.temperature < config.TEMP_ZONES.COLD) {
            properties.climateZone = "亜寒帯湿潤気候";
        } else if (properties.temperature < config.TEMP_ZONES.TEMPERATE) {
            properties.climateZone = "温暖湿潤気候";
        } else {
            properties.climateZone = "熱帯雨林気候";
        }
    }
    
    // --- 4. その他のプロパティ ---
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
    const resourceSymbols = ['木', '石', '鉄', '金', '晶'];
    properties.resourceRank = resourceSymbols[Math.floor(Math.random() * resourceSymbols.length)];
    
    return properties;
}

/**
 * ★★★ [新規] 第1.5パス：山脈や海岸線に応じて降水量を補正する ★★★
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function applyGeographicPrecipitationEffects(allHexes) {
    const precipCorrections = new Array(allHexes.length).fill(0);

    allHexes.forEach((h, index) => {
        const p = h.properties;
        if (p.isWater) return;

        // a. 山岳による地形性降水 (風上)
        if (p.elevation > 1500) {
            precipCorrections[index] += config.PRECIPITATION_PARAMS.MOUNTAIN_UPLIFT_BONUS * (p.elevation / 7000);
        }

        // b. 雨陰効果 (風下)
        const westNeighbor = h.col > 0 ? allHexes[getIndex(h.col - 1, h.row)] : null;
        if (westNeighbor && !westNeighbor.properties.isWater) {
            const elevationDiff = westNeighbor.properties.elevation - p.elevation;
            if (elevationDiff > 800) { // 西側が800m以上高い山なら雨陰
                precipCorrections[index] += config.PRECIPITATION_PARAMS.RAIN_SHADOW_PENALTY;
            }
        }
    });

    // 補正を適用
    allHexes.forEach((h, index) => {
        if (!h.properties.isWater) {
            h.properties.precipitation_mm = Math.max(0, h.properties.precipitation_mm + precipCorrections[index]);
            h.properties.precipitation = Math.min(1.0, h.properties.precipitation_mm / 3000);
        }
    });
}

/**
 * 第2パス：水系（河川）を生成する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function generateWaterSystems(allHexes) {
    const riverSources = allHexes.filter(h => {
        if (h.properties.isWater || h.properties.elevation < 1000) return false;
        const isRainyMountain = h.properties.elevation > 1500 && h.properties.precipitation > 0.5;
        const isHighPeak = h.properties.elevation > 2000;
        let probability = 0;
        if (isRainyMountain) probability = 0.25;
        else if (isHighPeak) probability = 0.10;
        return Math.random() < probability;
    });

    allHexes.forEach(h => h.properties.flow = 0);

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
                currentCol = lowestNeighbor.col;
                currentRow = lowestNeighbor.row;
                // 川の終点を、標高0の水域(海)に到達した場合のみとする
                if (lowestNeighbor.properties.isWater && lowestNeighbor.properties.elevation <= 0) {
                    lowestNeighbor.properties.flow += 1;
                    break;
                }
            } else {
                if (!allHexes[currentIndex].properties.isWater) {
                     allHexes[currentIndex].properties.isWater = true;
                }
                break;
            }
        }
    });
}

/**
 * ★★★ [新規] 第2.5パス：稜線を生成する ★★★
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function generateRidgeLines(allHexes) {
    // 1. 稜線の起点となるヘックスを選定
    const ridgeSources = allHexes.filter(h => {
        const p = h.properties;
        // 水域と、川が流れているヘックス（水系）は除外
        if (p.isWater || p.flow > 0) return false;
        
        const elevation = p.elevation;
        // 標高1000m～6000mの陸地ヘックスを候補とする
        const isCandidate = elevation >= 1000 && elevation < 6000;
        if (!isCandidate) return false;

        // その中から30%をランダムで選ぶ
        return Math.random() < 1.0;
    });

    // 2. 全ヘックスのridgeFlowプロパティを初期化
    allHexes.forEach(h => h.properties.ridgeFlow = 0);

    // 3. 各起点から、標高が最も高い隣人に向かって探索
    ridgeSources.forEach(source => {
        let currentHex = source;
        for (let i = 0; i < 50; i++) { // 無限ループ防止
            // 現在地のridgeFlowをインクリメント
            currentHex.properties.ridgeFlow += 1;
            
            // 隣接ヘックスの中で、最も標高が高いものを探す
            let highestNeighbor = null;
            let maxElevation = currentHex.properties.elevation;
            
            currentHex.neighbors.map(i => allHexes[i]).forEach(n => {
                // 自分より標高が高い隣人のみ対象
                if (n.properties.elevation > maxElevation) {
                    maxElevation = n.properties.elevation;
                    highestNeighbor = n;
                }
            });

            // より高い隣人が見つかれば、そちらへ移動
            if (highestNeighbor) {
                currentHex = highestNeighbor;
            } else {
                // 見つからなければ（＝尾根の頂上）、探索終了
                break;
            }
        }
    });
}

/**
 * 第3パス：最終的なプロパティ（植生、産業ポテンシャル）を計算する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function calculateFinalProperties(allHexes) {
    allHexes.forEach(h => {
        const { properties, col, row } = h;
        const { isWater, elevation, temperature } = properties; // precipitation は直接使わないので削除
        // 座標の正規化手法をgenerateBasePropertiesと統一する
        const nx = col / config.COLS;
        const ny = row / config.ROWS;

        // 標高から地形タイプを決定
        if (isWater) {
            properties.terrainType = '水域';
        } else if (elevation >= config.TERRAIN_ELEVATION.MOUNTAIN_PEAK) {
            properties.terrainType = '山岳';
        } else if (elevation >= config.TERRAIN_ELEVATION.MOUNTAIN) {
            properties.terrainType = '山地';
        } else if (elevation >= config.TERRAIN_ELEVATION.HILLS) {
            properties.terrainType = '丘陵';
        } else {
            properties.terrainType = '平地';
        }

        // 沖積平野フラグ
        properties.isAlluvial = properties.flow > 0 && !isWater && elevation < 4000;
        
        // 1. 新しいプロパティ landUse を初期化
        properties.landUse = { river: 0, desert: 0, barren: 0, grassland: 0, forest: 0 };

        if (isWater) {
            // 水域の植生タイプを標高ベースで判定する
            if (properties.elevation <= 0) { // 標高0以下は海
                if (config.elevationScale.invert(elevation) < -0.4) {
                    properties.vegetation = '深海';
                } else {
                    properties.vegetation = '海洋';
                }
            } else { // 標高が0より大きい水域は湖
                properties.vegetation = '湖沼';
            }
        } else {
            // --- ステップ1: 特別な植生（湿地・密林）を優先的に判定 ---
            
            // a. 湿地の判定
            // 条件: 標高が低く、かつ川の流れが一定以上ある
            const isMarshCondition = 
                elevation < config.PRECIPITATION_PARAMS.MARSH_MAX_ELEVATION && 
                properties.flow >= config.PRECIPITATION_PARAMS.MARSH_MIN_FLOW;

            if (isMarshCondition) {
                properties.vegetation = '湿地';
            } 
            // b. 密林の判定 (湿地でない場合のみ)
            // 条件: 気温が高く、かつ降水量が非常に多い
            else if (
                temperature >= config.PRECIPITATION_PARAMS.JUNGLE_MIN_TEMP && 
                properties.precipitation_mm >= config.PRECIPITATION_PARAMS.JUNGLE_MIN_PRECIP_MM
            ) {
                properties.vegetation = '密林';
            }
            // --- ステップ2: 上記以外の場合、従来のポテンシャルベースの判定を行う ---
            else {
                // 2. 陸地ヘックスの場合、各土地利用タイプの「ポテンシャル」を計算
                const potentials = {
                    river: 0,
                    desert: 0,
                    barren: 0,
                    grassland: 0,
                    forest: 0,
                };

                // 1. 川による森林へのボーナスを計算
                // 川の流れ(flow)が強いほどボーナスが大きくなるが、効果が過剰にならないよう上限を設ける
                const riverBonusToForest = 1.0 + Math.min(2.0, Math.sqrt(properties.flow) * 0.5);

                // 2. 各ポテンシャルを計算。森林ポテンシャルに川のボーナスを乗算する
                potentials.river = Math.sqrt(properties.flow) * 2;
                potentials.desert = Math.pow(Math.max(0, 1 - properties.precipitation / 0.1), 2) * 10;
                const alpineFactor = Math.pow(Math.max(0, elevation - 3500) / 3500, 2);
                const tundraFactor = Math.pow(Math.max(0, -5 - temperature) / 20, 2);
                potentials.barren = (alpineFactor + tundraFactor) * 10;

                const forestTempFactor = Math.max(0, 1 - Math.abs(temperature - 15) / 20);
                const forestPrecipFactor = Math.max(0, properties.precipitation - 0.05);
                // 元の森林ポテンシャル計算式に、川からのボーナスを掛け合わせる
                potentials.forest = ((1 + forestPotentialNoise(nx, ny)) / 2) * forestTempFactor * forestPrecipFactor * 5 * riverBonusToForest;

                const grasslandTempFactor = Math.max(0, 1 - Math.abs(temperature - 18) / 25);
                const grasslandPrecipFactor = 1 - Math.abs(properties.precipitation - 0.3) * 2;
                potentials.grassland = ((1 + grasslandPotentialNoise(nx, ny)) / 2) * grasslandTempFactor * grasslandPrecipFactor * 3;

                // 3. 全ポテンシャルの合計値を計算
                const totalPotential = Object.values(potentials).reduce((sum, val) => sum + val, 0);

                // 4. 合計値を使って各ポテンシャルを正規化し、割合（%）を算出
                if (totalPotential > 0) {
                    properties.landUse.river = potentials.river / totalPotential;
                    properties.landUse.desert = potentials.desert / totalPotential;
                    properties.landUse.barren = potentials.barren / totalPotential;
                    properties.landUse.grassland = potentials.grassland / totalPotential;
                    properties.landUse.forest = potentials.forest / totalPotential;
                } else {
                    properties.landUse.barren = 1.0;
                }

                // 5. 従来の vegetation プロパティ（最も優勢な地目）を決定
                // ★★★ [ここからロジックを全面的に改訂] ★★★
                // 気候帯ラベルへの直接依存を廃止し、気温・降水量・標高の組み合わせで植生を決定する
                let dominantVeg = '荒れ地'; // デフォルトは荒れ地
                const precip_mm = properties.precipitation_mm;

                // --- STEP 0: 標高や特殊条件による優先判定 ---
                if (elevation >= 3500) {
                    dominantVeg = '高山'; // 標高3500m以上は問答無用で高山植生
                } 
                // (湿地と密林の判定は既にSTEP 1で完了している)

                // --- STEP 1: 気温帯ごとの植生判定（ホイッタカーのバイオーム図を簡易的に模倣） ---
                else {
                    // 【a. 寒冷地 (Cold Zone)】
                    if (temperature < config.TEMP_ZONES.COLD) {
                        if (precip_mm < 200) {
                            dominantVeg = '荒れ地'; // 寒冷な荒れ地（ツンドラに近い）
                        } else {
                            dominantVeg = '針葉樹林'; // タイガ
                        }
                    } 
                    // 【b. 温帯 (Temperate Zone)】
                    else if (temperature < config.TEMP_ZONES.TEMPERATE) {
                        if (precip_mm < 150) {
                            dominantVeg = '砂漠';
                        } else if (precip_mm < 350) {
                            // 砂漠の周辺に荒れ地を生成
                            dominantVeg = '荒れ地'; 
                        } else if (precip_mm < 600) {
                            dominantVeg = '草原'; // ステップ気候に相当
                        } else {
                            dominantVeg = '森林'; // 温暖湿潤気候の森林
                        }
                    }
                    // 【c. 熱帯・亜熱帯 (Hot Zone)】
                    else {
                        if (precip_mm < 200) {
                            dominantVeg = '砂漠';
                        } else if (precip_mm < 500) {
                            dominantVeg = '荒れ地';
                        } else if (precip_mm < 1500) {
                            // 熱帯の草原（サバンナ）
                            dominantVeg = '草原'; 
                        } else {
                            // 既に '密林' 判定済みだが、ここに来る場合は通常の熱帯林とする
                            dominantVeg = '森林'; 
                        }
                    }
                }
                
                properties.vegetation = dominantVeg;
            }
        }

        // 産業ポテンシャル
        // 農業ポテンシャルの計算で新しい降水量基準を使用
        let agriPotential = 0;
        if (!isWater) {
            if (properties.isAlluvial) agriPotential += 0.5;
            if (h.neighbors.some(nIndex => allHexes[nIndex].properties.vegetation === '湖沼')) agriPotential += 0.3;
            agriPotential += properties.landUse.grassland * 0.2;
            const idealTemp = 17.5;
            const tempFactor = Math.max(0, 1 - Math.abs(temperature - idealTemp) / 15);
            agriPotential += tempFactor * 0.3;

            // 新しい降水量スケール(mm/年)で農業適性を評価
            const precipFactor = d3.scaleLinear()
                .domain([config.PRECIPITATION_PARAMS.DRYNESS_PASTORAL_THRESHOLD, config.PRECIPITATION_PARAMS.DRYNESS_FARMING_THRESHOLD])
                .range([0.1, 1.0]) // 牧畜限界で少し、農耕限界で最大のボーナス
                .clamp(true)(properties.precipitation_mm);
            agriPotential += precipFactor * 0.2;
        }
        properties.agriPotential = Math.min(1.0, agriPotential);

        properties.forestPotential = properties.landUse.forest || 0;

        // 鉱業適正の計算ロジック
        let miningPotential = 0;
        if (!isWater) {
            // 1. ノイズ関数から-1.0～1.0の範囲で「鉱脈の素」となる値を取得
            const rawMiningValue = miningPotentialNoise(nx * 2.0, ny * 2.0); // 周波数を調整

            // 2. 値のピークを鋭くする (powの指数を大きくするほど鋭くなる)
            const peakFactor = 8;
            let noisePotential = Math.pow(1.0 - Math.abs(rawMiningValue), peakFactor);
            
            // 3. 標高が高いほど鉱脈が存在しやすい、という補正を加える
            const elevationFactor = 1 + (Math.min(4000, elevation) / 4000) * 0.5;
            
            // 4. 最終的なポテンシャルを計算
            miningPotential = noisePotential * elevationFactor;
        }
        // 最終的な値を 0.0 ～ 1.0 の範囲に収める
        properties.miningPotential = Math.min(1.0, miningPotential);

        let fishingPotential = 0;
        if (!isWater) {
            let waterBonus = 0;
            h.neighbors.forEach(nIndex => {
                const neighborHex = allHexes[nIndex];
                if (neighborHex.properties.isWater) {
                    if (neighborHex.properties.vegetation === '海洋' || neighborHex.properties.vegetation === '深海') waterBonus = Math.max(waterBonus, 0.9);
                    else if (neighborHex.properties.vegetation === '湖沼') waterBonus = Math.max(waterBonus, 0.6);
                }
            });
            fishingPotential += waterBonus;
            fishingPotential += properties.landUse.river * 0.5;
        }
        properties.fishingPotential = Math.min(1.0, fishingPotential);
    });
}


/**
 * 大陸生成のメイン関数 (main.js から呼び出される)
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 生成された全ヘックスのデータ
 */
export async function generateContinent(addLogMessage) {
    
    // パス1：全ヘックスの基本プロパティを生成
    await addLogMessage("地面の起伏を生成しています...");
    const allHexes = [];
    for (let row = 0; row < config.ROWS; row++) {
        for (let col = 0; col < config.COLS; col++) {
            allHexes.push({ 
                col, 
                row, 
                properties: generateBaseProperties(col, row) 
            });
        }
    }
    // 隣接情報をキャッシュ
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

    // パス1.5：降水量の地理的補正を適用
    await addLogMessage("風と地形による降水量を計算しています...");
    applyGeographicPrecipitationEffects(allHexes);

    // パス2：水系を生成
    await addLogMessage("水系と河川を配置しています...");
    generateWaterSystems(allHexes);

    // パス2.5：稜線を生成
    await addLogMessage("山系の稜線を計算しています...");
    generateRidgeLines(allHexes);

    // パス3：最終的なプロパティを計算
    await addLogMessage("気候と植生を計算しています...");
    calculateFinalProperties(allHexes);

    return allHexes;
}