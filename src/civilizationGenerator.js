// ================================================================
// GeoForge System - 文明生成モジュール (v2.4 - 首都直轄モデル)
// ================================================================

import * as config from './config.js';
import { getDistance, getIndex } from './utils.js';
import { generateTradeRoutes, generateFeederRoads } from './roadGenerator.js';

// ================================================================
// ■ K-Means クラスタリング関連の関数 (変更なし)
// ================================================================

function squaredDistance(point1, point2) {
    const dx = point1.col - point2.col;
    const dy = point1.row - point2.row;
    return dx * dx + dy * dy;
}

// ================================================================
// ■ ヘルパー関数群 (一部変更)
// ================================================================

// ★★★ [関数全体を新しいロジックに書き換え] ★★★
function generatePopulation(allHexes) {
    let maxHabitability = 0;

    // --- ステップ1: 全ヘックスの居住適性スコアを計算し、最大値を取得 ---
    allHexes.forEach(h => {
        const p = h.properties;
        let score = 0;
        if (!p.isWater && p.vegetation !== '高山' && p.vegetation !== '砂漠') {
            score += p.agriPotential * 30;
            score += p.fishingPotential * 20;
            const idealTemp = 5.0;
            score += Math.max(0, 1 - Math.abs(p.temperature - idealTemp) / 15) * 15;
            
            // ★★★ [新規] 降水量を居住適性に加える ★★★
            // 農耕限界(600mm)前後が最も快適とし、それ以上/以下はスコアが下がるように設定
            const idealPrecip = config.PRECIPITATION_PARAMS.DRYNESS_FARMING_THRESHOLD;
            const precipScore = Math.max(0, 1 - Math.abs(p.precipitation_mm - idealPrecip) / 800) * 10;
            score += precipScore;
            
            score += p.manaValue * 10;
            score += p.miningPotential * 5;
            score += p.forestPotential * 5;
        }
        p.habitability = score;
        if (p.habitability > maxHabitability) {
            maxHabitability = p.habitability;
        }
    });

    // --- ステップ2: スコアを正規化し、新しいパラメータを使って人口を計算 ---
    allHexes.forEach(h => {
        const p = h.properties;
        if (maxHabitability > 0) {
            // スコアを 0.0 - 1.0 の範囲に正規化
            const normalizedHabitability = p.habitability / maxHabitability;

            // 足切り判定
            if (normalizedHabitability >= config.POPULATION_PARAMS.HABITABILITY_THRESHOLD) {
                // 足切り値からの差分を再計算して人口密度に影響させる
                const effectiveHabitability = (normalizedHabitability - config.POPULATION_PARAMS.HABITABILITY_THRESHOLD) / (1.0 - config.POPULATION_PARAMS.HABITABILITY_THRESHOLD);
                
                // 人口増加曲線を適用
                const populationFactor = Math.pow(effectiveHabitability, config.POPULATION_PARAMS.POPULATION_CURVE);
                
                // 最大人口スケールを適用
                p.population = Math.floor(populationFactor * config.POPULATION_PARAMS.MAX_POPULATION_PER_HEX);
            } else {
                p.population = 0;
            }
        } else {
            p.population = 0;
        }

        // プロパティの初期化
        p.settlement = null;
        p.nationId = 0;
        p.parentHexId = null;
        p.territoryId = null;
    });
}

function classifySettlements(allHexes) {
    allHexes.forEach(h => {
        const pop = h.properties.population;
        if (pop >= 10000) h.properties.settlement = '都市';
        else if (pop >= 5000) h.properties.settlement = '街';
        else if (pop >= 1000) h.properties.settlement = '町';
        else if (pop >= 100) h.properties.settlement = '村';
    });
}

/**
 * ★★★ [改訂] K-Meansの結果から国家と首都を定義し、領都を首都に直轄させる ★★★
 */
function defineNations(allCities, numNations) {
    const capitals = [];
    const regionalCapitals = [];
    
    // 1. マップを3x3の9地域に分割し、各地域の代表都市（最も人口が多い都市）を選出
    const regionBests = new Array(9).fill(null);
    const regionWidth = config.COLS / 3;
    const regionHeight = config.ROWS / 3;

    allCities.forEach(city => {
        const regionX = Math.floor(city.col / regionWidth);
        const regionY = Math.floor(city.row / regionHeight);
        const regionIndex = regionY * 3 + regionX;

        if (!regionBests[regionIndex] || city.properties.population > regionBests[regionIndex].properties.population) {
            regionBests[regionIndex] = city;
        }
    });

    // 2. 代表都市の中から、人口が多い順に指定された国家数だけ「首都」として選抜
    const capitalCandidates = regionBests.filter(c => c !== null);
    capitalCandidates.sort((a, b) => b.properties.population - a.properties.population);
    
    const finalCapitals = capitalCandidates.slice(0, numNations);

    // 3. 首都を正式に定義
    finalCapitals.forEach((capital, index) => {
        const nationId = index + 1;
        capital.properties.nationId = nationId;
        capital.properties.settlement = '首都';
        capitals.push(capital);
    });

    // 4. 首都以外の全都市を、最も近い首都の国家に所属させ「領都」とする
    allCities.forEach(city => {
        // 既に首都になっている都市はスキップ
        if (city.properties.settlement === '首都') return;

        let closestCapital = null;
        let minDistance = Infinity;
        capitals.forEach(capital => {
            const dist = getDistance(city, capital);
            if (dist < minDistance) {
                minDistance = dist;
                closestCapital = capital;
            }
        });

        if (closestCapital) {
            city.properties.nationId = closestCapital.properties.nationId;
            city.properties.settlement = '領都';
            city.properties.parentHexId = getIndex(closestCapital.col, closestCapital.row);
            regionalCapitals.push(city);
        }
    });

    return { capitals, regionalCapitals };
}


// propagateNationId は変更ありません
function propagateNationId(allHexes, hubs) {
    const childrenMap = new Map();
    allHexes.forEach((h, index) => {
        const parentId = h.properties.parentHexId;
        if (parentId !== null) {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId).push(h);
        }
    });

    const queue = [...hubs];
    const visited = new Set(hubs.map(h => getIndex(h.col, h.row)));
    let head = 0;

    while (head < queue.length) {
        const parent = queue[head++];
        const parentIndex = getIndex(parent.col, parent.row);
        const children = childrenMap.get(parentIndex) || [];

        children.forEach(child => {
            const childIndex = getIndex(child.col, child.row);
            if (!visited.has(childIndex)) {
                child.properties.nationId = parent.properties.nationId;
                visited.add(childIndex);
                queue.push(child);
            }
        });
    }
}


// ================================================================
// ■ メイン関数 (ロジックフローを一部変更)
// ================================================================
export async function generateCivilization(allHexes, addLogMessage) {
    // ① 人口生成 & ② 集落階層化
    await addLogMessage("居住適性に基づき、世界の人口を生成しています...");
    generatePopulation(allHexes);
    await addLogMessage("人口分布から都市や村を形成しています...");
    classifySettlements(allHexes);

    // ★★★ [ここから新規] 集落数の集計とログ出力 ★★★
    const settlementCounts = {
        '都市': 0,
        '街': 0,
        '町': 0,
        '村': 0,
    };
    allHexes.forEach(h => {
        const settlementType = h.properties.settlement;
        if (settlementCounts[settlementType] !== undefined) {
            settlementCounts[settlementType]++;
        }
    });

    // ログメッセージを生成
    const countMessage = Object.entries(settlementCounts)
        .map(([type, count]) => `${type}×${count}`)
        .join('、');
    await addLogMessage(` ${countMessage}`);

    const cities = allHexes.filter(h => h.properties.settlement === '都市');

    // ★★★ [修正] configの値をローカル変数にコピーして使用する ★★★
    let numNations = config.NUM_NATIONS; 

    if (cities.length < numNations) {
        await addLogMessage(`警告: 都市が${cities.length}個しか形成されませんでした。国家数を${cities.length}に減らします。`);
        numNations = Math.max(1, cities.length); // ローカル変数を更新
    }
    if (numNations === 0) { // ローカル変数で判定
         await addLogMessage("都市が全く生成されなかったため、文明生成を中断します。");
         return { allHexes, roadPaths: [] };
    }

    // ★★★ [変更] K-Meansを廃止し、新しい国家定義関数を呼び出す ★★★
    await addLogMessage("地理的バランスを考慮して国家を配置しています...");
    // ★★★ [修正] ローカル変数を関数に渡す ★★★
    const { capitals, regionalCapitals } = defineNations(cities, numNations);
    await addLogMessage(`世界の${numNations}大国を定義しました。`); // ログもローカル変数を使用

    // ③ 都市間の交易路を生成
    await addLogMessage("集落を結ぶ道路網を建設しています...");
    const { roadPaths: tradeRoutePaths } = await generateTradeRoutes(cities, allHexes, addLogMessage);
    let allRoadPaths = tradeRoutePaths;
    
    // ⑪～⑬ 下位集落の所属決定とインフラ整備
    const hubs = [...capitals, ...regionalCapitals];
    const streets = allHexes.filter(h => h.properties.settlement === '街');
    const towns = allHexes.filter(h => h.properties.settlement === '町');
    const villages = allHexes.filter(h => h.properties.settlement === '村');
    
    const streetRoads = await generateFeederRoads(streets, hubs, allHexes, '街', addLogMessage);
    allRoadPaths.push(...streetRoads);

    const townRoads = await generateFeederRoads(towns, [...hubs, ...streets], allHexes, '町', addLogMessage);
    allRoadPaths.push(...townRoads);

    const villageRoads = await generateFeederRoads(villages, [...hubs, ...streets, ...towns], allHexes, '村', addLogMessage);
    allRoadPaths.push(...villageRoads);
    
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await addLogMessage(`文明が生まれました... 総人口: ${totalPopulation.toLocaleString()}人`);

    return { allHexes, roadPaths: allRoadPaths };
}

export async function determineTerritories(allHexes, addLogMessage) {
    await addLogMessage("国家の最終的な領土を確定させています...");

    allHexes.forEach(h => {
        if (h.properties.population === 0) {
            h.properties.nationId = 0; 
        }
    });

    const queue = allHexes.filter(h => h.properties.nationId > 0);
    const visited = new Set(queue.map(h => getIndex(h.col, h.row)));
    let head = 0;

    while (head < queue.length) {
        const currentHex = queue[head++];
        
        if (currentHex.properties.territoryId === null) {
            let hub = currentHex;
            let visitedLoop = new Set();
            while(hub.properties.parentHexId !== null && !visitedLoop.has(getIndex(hub.col, hub.row))) {
                visitedLoop.add(getIndex(hub.col, hub.row));
                const parent = allHexes[hub.properties.parentHexId];
                if (!parent) break;
                hub = parent;
            }
            currentHex.properties.territoryId = getIndex(hub.col, hub.row);
        }

        currentHex.neighbors.forEach(neighborIndex => {
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                const neighborHex = allHexes[neighborIndex];
                if (neighborHex.properties.population > 0 && neighborHex.properties.nationId === 0 && !neighborHex.properties.isWater) {
                    neighborHex.properties.nationId = currentHex.properties.nationId;
                    neighborHex.properties.territoryId = currentHex.properties.territoryId;
                    queue.push(neighborHex);
                }
            }
        });
    }

    await addLogMessage("領土の割り当てが完了しました。");
    return allHexes;
}