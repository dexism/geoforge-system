// ================================================================
// GeoForge System - 大陸生成モジュール (v2.3 - 鉱業適正の鋭敏化)
// ================================================================

import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';
import * as config from './config.js';
import { getIndex } from './utils.js';

// ----------------------------------------------------------------
// ■ ノイズジェネレーターの初期化
// ----------------------------------------------------------------
const terrainNoise = createNoise2D();
const manaNoise = createNoise2D();
const climateNoise = createNoise2D();
const precipitationNoise = createNoise2D();
const forestPotentialNoise = createNoise2D();
const taigaPotentialNoise = createNoise2D();
const junglePotentialNoise = createNoise2D();
const vegetationCoverageNoise = createNoise2D();
const grasslandPotentialNoise = createNoise2D();
const miningPotentialNoise = createNoise2D();

/**
 * 第1パス：物理的な基本プロパティを生成する
 * @param {number} col - ヘックスの列
 * @param {number} row - ヘックスの行
 * @returns {object} - 計算されたプロパティ
 */
function generateBaseProperties(col, row) {
    const nx = col * config.NOISE_SCALE;
    const ny = row * config.NOISE_SCALE;
    
    // 大陸形状と標高の計算
    let baseElevation = terrainNoise(nx, ny);

    // ★★★ [変更/新規] ここから中央平野を生成するロジック ★★★
    const centerX = config.COLS / 2;
    const centerY = config.ROWS / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
    const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2));

    // 1. 中央平野を適用する半径を計算
    const plainRadius = maxDist * config.CENTRAL_PLAIN_RADIUS;

    // 2. もしヘックスがこの半径内なら、標高を抑制する
    if (distFromCenter < plainRadius) {
        // 中​​心に近いほど1.0に、半径の端に近づくほど0.0になる係数を計算
        const suppressionFactor = Math.pow(1.0 - (distFromCenter / plainRadius), 2);
        // 係数と設定値を使って、元の標高を抑制（平坦化）する
        baseElevation -= baseElevation * suppressionFactor * config.CENTRAL_PLAIN_FLATNESS;
    }

    if (baseElevation > 0) {
        baseElevation = Math.pow(baseElevation, config.ELEVATION_PEAK_FACTOR);
    }
    
    const falloff = Math.pow(distFromCenter / maxDist, config.CONTINENT_FALLOFF_FACTOR);
    const internalElevation = baseElevation + config.LAND_BIAS - falloff;

    const properties = {};
    
    // ... (以降のプロパティ計算は変更なし) ...
    const inlandWaterNoise = terrainNoise(nx + 100, ny + 100);
    const dynamicLakeThreshold = config.lakeThresholdScale(internalElevation);
    const isWater = internalElevation < 0.0 || (inlandWaterNoise < dynamicLakeThreshold && internalElevation < 1.3);
    properties.isWater = isWater;

    // ★★★ [変更] 海(大陸外)なら標高0、それ以外(陸地や湖)なら地形に応じた標高を設定 ★★★
    properties.elevation = internalElevation < 0.0 ? 0 : config.elevationScale(internalElevation);
    // properties.elevation = isWater ? 0 : config.elevationScale(internalElevation);
    
    // 気温と降水量の計算
    const latitude = row / config.ROWS;
    const baseTemp = 0 + (latitude * 35);
    properties.climate = baseTemp + climateNoise(nx, ny) * 5;
    
    let elevationCorrection = 0;
    if (properties.elevation > 0) {
        elevationCorrection = (properties.elevation / 100) * 0.6;
    }
    properties.temperature = properties.climate - elevationCorrection;

    const basePrecip = (col / config.COLS);
    const precipNoiseValue = precipitationNoise(nx, ny) * 0.2;
    properties.precipitation = Math.max(0, Math.min(1, basePrecip + precipNoiseValue));
    
    // 気候帯の決定
    if (properties.climate < config.TEMP_ZONES.COLD) {
        if (properties.precipitation < config.PRECIP_ZONES.DRY) properties.climateZone = "砂漠気候(寒)";
        else if (properties.precipitation < config.PRECIP_ZONES.MODERATE) properties.climateZone = "ツンドラ気候";
        else properties.climateZone = "亜寒帯湿潤気候";
    } else if (properties.climate < config.TEMP_ZONES.TEMPERATE) {
        if (properties.precipitation < config.PRECIP_ZONES.DRY) properties.climateZone = "ステップ気候";
        else if (properties.precipitation < config.PRECIP_ZONES.MODERATE) properties.climateZone = "地中海性気候";
        else properties.climateZone = "温暖湿潤気候";
    } else {
        if (properties.precipitation < config.PRECIP_ZONES.DRY) properties.climateZone = "砂漠気候(熱)";
        else if (properties.precipitation < config.PRECIP_ZONES.MODERATE) properties.climateZone = "熱帯草原気候";
        else properties.climateZone = "熱帯雨林気候";
    }

    // 積雪判定
    properties.hasSnow = false;
    if (!isWater && properties.temperature <= config.SNOW_THRESHOLDS.TEMPERATURE && properties.precipitation > config.SNOW_THRESHOLDS.PRECIPITATION_LIGHT) {
        properties.hasSnow = true;
    }

    // 魔力と資源の基礎値
    const rawManaValue = manaNoise(nx / 2, ny / 2);
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
                // ★★★ [変更] 川の終点を、標高0の水域(海)に到達した場合のみとする ★★★
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
        const { isWater, elevation, temperature, precipitation, climate } = properties;
        const nx = col * config.NOISE_SCALE;
        const ny = row * config.NOISE_SCALE;

        // ★★★ [新規] 標高から地形タイプを決定 ★★★
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
            // ★★★ [変更] 水域の植生タイプを標高ベースで判定する ★★★
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
            // 2. 陸地ヘックスの場合、各土地利用タイプの「ポテンシャル」を計算
            const potentials = {
                river: 0,
                desert: 0,
                barren: 0,
                grassland: 0,
                forest: 0,
            };

            potentials.river = Math.sqrt(properties.flow) * 2;
            potentials.desert = Math.pow(Math.max(0, 1 - precipitation / 0.1), 2) * 10;
            const alpineFactor = Math.pow(Math.max(0, elevation - 3500) / 3500, 2);
            const tundraFactor = Math.pow(Math.max(0, -5 - temperature) / 20, 2);
            potentials.barren = (alpineFactor + tundraFactor) * 10;
            const forestTempFactor = Math.max(0, 1 - Math.abs(temperature - 15) / 20);
            const forestPrecipFactor = Math.max(0, precipitation - 0.05);
            potentials.forest = ((1 + forestPotentialNoise(nx, ny)) / 2) * forestTempFactor * forestPrecipFactor * 5;
            const grasslandTempFactor = Math.max(0, 1 - Math.abs(temperature - 18) / 25);
            const grasslandPrecipFactor = 1 - Math.abs(precipitation - 0.3) * 2;
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
            let dominantVeg = '荒れ地';
            
            if (properties.landUse.forest >= 0.5) {
                if (climate > config.TEMP_ZONES.TEMPERATE && precipitation > config.VEGETATION_THRESHOLDS.JUNGLE_MIN_PRECIP) {
                    dominantVeg = '密林';
                } else if (climate < config.TEMP_ZONES.COLD) {
                    dominantVeg = '針葉樹林';
                } else {
                    dominantVeg = '森林';
                }
            } else {
                let maxRatio = 0;
                if (properties.landUse.grassland > maxRatio){ maxRatio = properties.landUse.grassland; dominantVeg = '草原'; }
                if (properties.landUse.desert > maxRatio)   { maxRatio = properties.landUse.desert;    dominantVeg = '砂漠'; }
                if (properties.landUse.barren > maxRatio)   { maxRatio = properties.landUse.barren;    dominantVeg = '荒れ地'; }
            }
            properties.vegetation = dominantVeg;
        }

        // 産業ポテンシャル
        let agriPotential = 0;
        if (!isWater) {
            if (properties.isAlluvial) agriPotential += 0.5;
            if (h.neighbors.some(nIndex => allHexes[nIndex].properties.vegetation === '湖沼')) agriPotential += 0.3;
            agriPotential += properties.landUse.grassland * 0.2;
            const idealTemp = 17.5;
            const tempFactor = Math.max(0, 1 - Math.abs(temperature - idealTemp) / 15);
            agriPotential += tempFactor * 0.3;
            const idealPrecip = 0.55;
            const precipFactor = Math.max(0, 1 - Math.abs(precipitation - idealPrecip) / 0.3);
            agriPotential += precipFactor * 0.2;
        }
        properties.agriPotential = Math.min(1.0, agriPotential);

        properties.forestPotential = properties.landUse.forest || 0;

        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        // ★★★ [修正] ここから鉱業適正の計算ロジックを全面的に刷新 ★★★
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        let miningPotential = 0;
        if (!isWater) {
            // 1. ノイズ関数から-1.0～1.0の範囲で「鉱脈の素」となる値を取得
            //    龍脈より周波数を高く（nx*2）して、より細かい分布にする
            const rawMiningValue = miningPotentialNoise(nx * 0.5, ny * 0.5);

            // 2. 龍脈と同様の計算で、値のピークを鋭くする
            //    powの指数を大きくするほど、ピークはより鋭く、希少になる (龍脈は8)
            const peakFactor = 5;
            let noisePotential = Math.pow(1.0 - Math.abs(rawMiningValue), peakFactor);
            
            // 3. 標高が高いほど鉱脈が存在しやすい、という補正を加える
            //    標高4000m以上で最大1.5倍のボーナスがかかる
            const elevationFactor = 1 + (Math.min(4000, elevation) / 4000) * 0.5;
            
            // 4. 最終的なポテンシャルを計算
            miningPotential = noisePotential * elevationFactor;
        }
        // 最終的な値を 0.0 ～ 1.0 の範囲に収める
        properties.miningPotential = Math.min(1.0, miningPotential);
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        // ★★★ 修正はここまで ★★★
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        
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

    // パス2：水系を生成
    await addLogMessage("水系と河川を配置しています...");
    generateWaterSystems(allHexes);

    // ★★★ [新規] パス2.5：稜線を生成 ★★★
    await addLogMessage("山系の稜線を計算しています...");
    generateRidgeLines(allHexes);

    // パス3：最終的なプロパティを計算
    await addLogMessage("気候と植生を計算しています...");
    calculateFinalProperties(allHexes);

    return allHexes;
}