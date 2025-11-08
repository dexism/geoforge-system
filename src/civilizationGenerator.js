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

function kMeansCluster(cities, k) {
    if (cities.length === 0) return [];
    
    let centroids = cities.slice(0, k).map(city => ({ col: city.col, row: city.row }));
    let assignments = [];
    let changed = true;
    const MAX_ITERATIONS = 50;
    let iterations = 0;

    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        assignments = new Array(k).fill(0).map(() => []);

        cities.forEach(city => {
            let minDistance = Infinity;
            let closestCentroidIndex = 0;
            centroids.forEach((centroid, index) => {
                const dist = squaredDistance(city, centroid);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestCentroidIndex = index;
                }
            });
            assignments[closestCentroidIndex].push(city);
        });

        const newCentroids = [];
        assignments.forEach((cluster, index) => {
            if (cluster.length > 0) {
                const sum = cluster.reduce((acc, city) => {
                    acc.col += city.col;
                    acc.row += city.row;
                    return acc;
                }, { col: 0, row: 0 });
                
                const newCentroid = {
                    col: sum.col / cluster.length,
                    row: sum.row / cluster.length,
                };
                newCentroids.push(newCentroid);

                if (centroids[index].col !== newCentroid.col || centroids[index].row !== newCentroid.row) {
                    changed = true;
                }
            } else {
                newCentroids.push(centroids[index]); 
            }
        });
        
        centroids = newCentroids;
        iterations++;
    }

    return assignments;
}


// ================================================================
// ■ ヘルパー関数群 (一部変更)
// ================================================================

// generatePopulation, classifySettlements は変更ありません

function generatePopulation(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        let score = 0;
        if (!p.isWater && p.vegetation !== '高山' && p.vegetation !== '砂漠') {
            score += p.agriPotential * 30;   
            score += p.fishingPotential * 20; 
            const idealTemp = 17.5;
            score += Math.max(0, 1 - Math.abs(p.temperature - idealTemp) / 15) * 15;
            score += p.manaValue * 10;        
            score += p.miningPotential * 5;   
            score += p.forestPotential * 5;   
        }
        p.habitability = score;
        
        if (p.habitability > 0) {
            const normalizedHabitability = p.habitability / 50.0;
            const populationFactor = Math.pow(normalizedHabitability, 8);
            p.population = Math.floor(populationFactor * 1000);
        } else {
            p.population = 0;
        }
        
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
function defineNations(cityClusters) {
    const capitals = [];
    const regionalCapitals = [];

    cityClusters.forEach((cluster, index) => {
        if (cluster.length === 0) return; 

        const nationId = index + 1;
        
        const capital = cluster.sort((a, b) => b.properties.population - a.properties.population)[0];
        capital.properties.nationId = nationId;
        capital.properties.settlement = '首都';
        capitals.push(capital);

        cluster.forEach(city => {
            if (city !== capital) {
                city.properties.nationId = nationId;
                city.properties.settlement = '領都';
                // ★★★ [変更] 無条件に自国の首都を親とする ★★★
                city.properties.parentHexId = getIndex(capital.col, capital.row);
                regionalCapitals.push(city);
            }
        });
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

    const cities = allHexes.filter(h => h.properties.settlement === '都市');
    if (cities.length < config.NUM_NATIONS) {
        await addLogMessage(`警告: 都市が${cities.length}個しか形成されませんでした。国家数を${cities.length}に減らします。`);
        config.NUM_NATIONS = Math.max(1, cities.length);
    }
    if (config.NUM_NATIONS === 0) {
         await addLogMessage("都市が全く生成されなかったため、文明生成を中断します。");
         return { allHexes, roadPaths: [] };
    }

    // K-Meansで都市を地理的にグループ化
    await addLogMessage("地理的に近い都市をグループ化しています...");
    const cityClusters = kMeansCluster(cities, config.NUM_NATIONS);

    // グループから国家、首都、そして首都直轄の領都を定義
    await addLogMessage(`世界の${config.NUM_NATIONS}大国を定義しています...`);
    const { capitals, regionalCapitals } = defineNations(cityClusters);

    // ③ 都市間の交易路を生成 (親子関係には影響しない)
    await addLogMessage("集落を結ぶ道路網を建設しています...");
    // await addLogMessage("主要都市を結ぶ交易路を建設しています...");
    const { roadPaths: tradeRoutePaths, routeData: tradeRoutes } = await generateTradeRoutes(cities, allHexes, addLogMessage);
    let allRoadPaths = tradeRoutePaths;

    // ★★★ [変更] refineHubAffiliations の呼び出しを削除 ★★★
    // await addLogMessage("国内の支配関係を最適化しています...");
    // refineHubAffiliations(capitals, regionalCapitals, tradeRoutes);
    
    // ⑪～⑬ 下位集落の所属決定とインフラ整備
    const hubs = [...capitals, ...regionalCapitals];
    const streets = allHexes.filter(h => h.properties.settlement === '街');
    const towns = allHexes.filter(h => h.properties.settlement === '町');
    const villages = allHexes.filter(h => h.properties.settlement === '村');
    
    // await addLogMessage("街から主要都市へ街道を敷設しています...");
    const streetRoads = await generateFeederRoads(streets, hubs, allHexes, '街', addLogMessage);
    allRoadPaths.push(...streetRoads);

    // await addLogMessage("町から街や都市へ町道を敷設しています...");
    const townRoads = await generateFeederRoads(towns, [...hubs, ...streets], allHexes, '町', addLogMessage);
    allRoadPaths.push(...townRoads);

    // await addLogMessage("村から上位の集落へ村道を敷設しています...");
    const villageRoads = await generateFeederRoads(villages, [...hubs, ...streets, ...towns], allHexes, '村', addLogMessage);
    allRoadPaths.push(...villageRoads);

    await addLogMessage("各集落の所属を確定させています...");
    propagateNationId(allHexes, hubs);

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