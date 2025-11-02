// ================================================================
// GeoForge System - 街道生成モジュール (v17.4 - 村グループ分割対応)
// ================================================================
import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, getDistance } from './utils.js';

const ROAD_LEVELS = { NONE: 0, PATH: 1, VILLAGE: 2, TOWN: 3, MAIN: 4, TRADE: 5 };
const MAX_COST_FOR_NATION = 15000;
// ★★★ [新規追加] 村グループの最大サイズを定義 ★★★
const MAX_VILLAGE_CLUSTER_SIZE = 7;

// (findAStarPath, calculateCostField は変更なし)
function findAStarPath(options) {
    const { start, isEnd, neighbor, cost: costFunc, heuristic } = options;
    const toVisit = [{ node: start, f: 0, g: 0, path: [start] }];
    const visited = new Map();
    visited.set(`${start.x}-${start.y}`, 0);
    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.f - b.f);
        const current = toVisit.shift();
        if (isEnd(current.node, start)) { return { path: current.path, cost: current.g }; }
        neighbor(current.node).forEach(n => {
            const gScore = current.g + costFunc(current.node, n);
            const visitedNeighborCost = visited.get(`${n.x}-${n.y}`);
            if (visitedNeighborCost === undefined || gScore < visitedNeighborCost) {
                visited.set(`${n.x}-${n.y}`, gScore);
                const hScore = heuristic(n);
                const fScore = gScore + hScore;
                const newPath = [...current.path, n];
                toVisit.push({ node: n, f: fScore, g: gScore, path: newPath });
            }
        });
    }
    return null;
}
function calculateCostField(allHexes, sources, costFunc) {
    const costMap = new Map();
    const sourceMap = new Map();
    const toVisit = [];
    sources.forEach(sourceHex => {
        const sourceNode = { x: sourceHex.col, y: sourceHex.row };
        const sourceIndex = getIndex(sourceNode.x, sourceNode.y);
        toVisit.push({ node: sourceNode, cost: 0 });
        costMap.set(sourceIndex, 0);
        sourceMap.set(sourceIndex, sourceHex);
    });
    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.cost - b.cost);
        const current = toVisit.shift();
        const currentIndex = getIndex(current.node.x, current.node.y);
        if (current.cost > costMap.get(currentIndex)) { continue; }
        const currentHex = allHexes[currentIndex];
        currentHex.neighbors.forEach(neighborIndex => {
            const neighborHex = allHexes[neighborIndex];
            if(neighborHex.properties.isWater) return;
            const neighborNode = { x: neighborHex.col, y: neighborHex.row };
            const newCost = current.cost + costFunc(current.node, neighborNode);
            if (!costMap.has(neighborIndex) || newCost < costMap.get(neighborIndex)) {
                costMap.set(neighborIndex, newCost);
                sourceMap.set(neighborIndex, sourceMap.get(currentIndex));
                toVisit.push({ node: neighborNode, cost: newCost });
            }
        });
    }
    return { costMap, sourceMap };
}

/**
 * ★★★ [修正] 隣接する村を、最大サイズを考慮してクラスタリングする ★★★
 * @param {Array<object>} settlementList - 村のリスト
 * @returns {Array<Array<object>>} - 分割された村クラスタの配列
 */
function findSettlementClusters(settlementList) {
    const clusters = [];
    const visited = new Set(); // 訪問済みの村を管理

    // 探索を始める村を人口の降順でソート（大きな村からグループを形成）
    const sortedList = [...settlementList].sort((a, b) => b.properties.population - b.properties.population);

    sortedList.forEach(startNode => {
        const startIndex = getIndex(startNode.col, startNode.row);
        if (!visited.has(startIndex)) {
            const currentCluster = [];
            const queue = [startNode]; // これから探索する村のキュー
            visited.add(startIndex);

            // キューが空になるか、クラスタサイズが上限に達するまで探索
            while (queue.length > 0 && currentCluster.length < MAX_VILLAGE_CLUSTER_SIZE) {
                const currentNode = queue.shift();
                currentCluster.push(currentNode);

                // 隣接する未訪問の村を探してキューに追加
                settlementList.forEach(nextNode => {
                    const nextIndex = getIndex(nextNode.col, nextNode.row);
                    if (!visited.has(nextIndex) && getDistance(currentNode, nextNode) <= 1) {
                        visited.add(nextIndex);
                        queue.push(nextNode);
                    }
                });
            }
            // 形成されたクラスタを結果に追加
            clusters.push(currentCluster);
        }
    });
    return clusters;
}


// (determineAffiliation は変更なし)
function determineAffiliation(targets, allSuperiors, params) {
    const { allHexes, costFunc } = params;
    const results = new Map();
    const targetsByNation = new Map();
    targets.forEach(t => {
        const nationId = t.properties.nationId;
        if (!targetsByNation.has(nationId)) {
            targetsByNation.set(nationId, []);
        }
        targetsByNation.get(nationId).push(t);
    });
    for (const [nationId, nationTargets] of targetsByNation.entries()) {
        if (nationId === 0) continue;
        const domesticSuperiors = allSuperiors.filter(s => s.properties.nationId === nationId);
        if (domesticSuperiors.length === 0) continue;
        const { costMap, sourceMap } = calculateCostField(allHexes, domesticSuperiors, costFunc);
        nationTargets.forEach(target => {
            const targetIndex = getIndex(target.col, target.row);
            results.set(target, {
                superior: sourceMap.get(targetIndex),
                cost: costMap.get(targetIndex)
            });
        });
    }
    const remainingTargets = targets.filter(t => !results.has(t) || !results.get(t).superior);
    if (remainingTargets.length > 0) {
        const { costMap, sourceMap } = calculateCostField(allHexes, allSuperiors, costFunc);
        remainingTargets.forEach(target => {
            const targetIndex = getIndex(target.col, target.row);
             results.set(target, {
                superior: sourceMap.get(targetIndex),
                cost: costMap.get(targetIndex)
            });
        });
    }
    return results;
}

/**
 * 街道生成のメイン関数
 */
export async function generateRoads(allHexes, addLogMessage) {
    await addLogMessage("街道網の整備を開始しました...");

    // 1. 初期化とコスト計算
    allHexes.forEach(h => {
        h.properties.roadLevel = ROAD_LEVELS.NONE;
        h.properties.roadTraffic = 0;
        const p = h.properties;
        let cost = 1;
        if (p.isWater) cost = Infinity;
        else {
            if (p.vegetation === '湖沼') cost = 50;
            if (p.vegetation === '森林' || p.vegetation === '疎林') cost += 2;
            if (p.vegetation === '密林' || p.vegetation === '針葉樹林') cost += 4;
            if (p.elevation > 1000) cost += Math.pow(p.elevation / 700, 2.8);
            if (p.flow > 2) cost += p.flow * 3;
        }
        p.movementCost = cost;
    });

    const pathfindingCostFunc = (nodeA, nodeB) => {
        const hexA = allHexes[getIndex(nodeA.x, nodeA.y)];
        const hexB = allHexes[getIndex(nodeB.x, nodeB.y)];
        let cost = hexB.properties.movementCost;
        cost += Math.pow(Math.abs(hexA.properties.elevation - hexB.properties.elevation) / 100, 2) * 10;
        return cost;
    };
    
    // (applyRoadPath, findPathToExistingNetwork は変更なし)
     const applyRoadPath = (path, level, traffic) => {
        if (!path || path.length === 0) return;
        path.forEach(node => {
            const hex = allHexes[getIndex(node.x, node.y)];
            if (hex.properties.roadLevel < level) hex.properties.roadLevel = level;
            hex.properties.roadTraffic += traffic;
        });
    };
     const findPathToExistingNetwork = (startHex, targetUpperLevel) => findAStarPath({
        start: { x: startHex.col, y: startHex.row },
        isEnd: (node, startNode) => {
            if (node.x === startNode.x && node.y === startNode.y) return false;
            const targetHex = allHexes[getIndex(node.x, node.y)];
            return targetHex.properties.roadLevel > targetUpperLevel && targetHex.properties.nationId === startHex.properties.nationId;
        },
        neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({ x: h.col, y: h.row })),
        cost: pathfindingCostFunc,
        heuristic: (node) => 0
    });

    // 2. 居住地を階層ごとに分類
    const villages = allHexes.filter(s => s.properties.settlement === '村');
    const towns = allHexes.filter(s => s.properties.settlement === '町');
    const streets = allHexes.filter(s => s.properties.settlement === '街');
    const allMajorCities = allHexes.filter(s => ['領都', '都市', '首都'].includes(s.properties.settlement));
    const capitals = allHexes.filter(s => s.properties.settlement === '首都');
    const allSettlements = allHexes.filter(h => h.properties.settlement);

    // 3. トップダウン式アプローチ
    // ① 仮の所属国家を割り当て
    await addLogMessage("国家の勢力圏を仮決定しています...");
    const { sourceMap: capitalSourceMap } = calculateCostField(allHexes, capitals, pathfindingCostFunc);
    allSettlements.forEach(s => {
        const sIndex = getIndex(s.col, s.row);
        const capital = capitalSourceMap.get(sIndex);
        if (capital) {
            s.properties.nationId = capital.properties.nationId;
        } else {
            s.properties.nationId = 0;
        }
    });

    // ② 主要都市ネットワーク（交易路）を生成
    await addLogMessage("交易路の幹線網を設計しています...");
    if (allMajorCities.length >= 2) {
        const points = allMajorCities.map(c => [c.col, c.row]);
        const delaunay = d3.Delaunay.from(points);
        const { halfedges, triangles } = delaunay;
        for (let i = 0; i < halfedges.length; i++) {
            const j = halfedges[i];
            if (j < i) continue;
            const city1 = allMajorCities[triangles[i]];
            const city2 = allMajorCities[triangles[j]];
            if (getDistance(city1, city2) > 40) continue;
            
            const result = findAStarPath({ 
                start: {x: city1.col, y: city1.row},
                isEnd: (node) => (node.x === city2.col && node.y === city2.row),
                neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({x: h.col, y: h.row})),
                cost: pathfindingCostFunc,
                heuristic: (node) => getDistance(allHexes[getIndex(node.x, node.y)], city2)
            });
            if (result && result.path) {
                applyRoadPath(result.path.map(p=>({x:p.x, y:p.y})), ROAD_LEVELS.TRADE, city1.properties.population + city2.properties.population);
            }
        }
    }

    // ③ 街 (Street) の所属と街道を決定
    await addLogMessage("地方の主要道を幹線に接続しています...");
    const streetAffiliations = determineAffiliation(streets, allMajorCities, { allHexes, costFunc: pathfindingCostFunc });
    streets.forEach(street => {
        if (street.properties.population <= 100) { street.properties.nationId = 0; return; }
        const { superior, cost } = streetAffiliations.get(street) || {};

        if (superior && cost < MAX_COST_FOR_NATION) {
            street.properties.nationId = superior.properties.nationId;
            street.properties.parentHexId = getIndex(superior.col, superior.row);
            const pathToNetwork = findPathToExistingNetwork(street, ROAD_LEVELS.MAIN);
            if(pathToNetwork && pathToNetwork.path) {
                 applyRoadPath(pathToNetwork.path.map(p=>({x:p.x, y:p.y})), ROAD_LEVELS.MAIN, street.properties.population);
            }
        } else {
            street.properties.nationId = 0;
        }
    });
    
    // ④ 町 (Town) の所属と街道を決定
    await addLogMessage("町と街を町道で結んでいます...");
    const streetAndHigher = [...streets.filter(s => s.properties.nationId > 0), ...allMajorCities];
    const townAffiliations = determineAffiliation(towns, streetAndHigher, { allHexes, costFunc: pathfindingCostFunc });
    towns.forEach(town => {
        if (town.properties.population <= 100) { town.properties.nationId = 0; return; }
        const { superior, cost } = townAffiliations.get(town) || {};

        if (superior && cost < MAX_COST_FOR_NATION) {
            town.properties.nationId = superior.properties.nationId;
            town.properties.parentHexId = getIndex(superior.col, superior.row);
            const pathToNetwork = findPathToExistingNetwork(town, ROAD_LEVELS.TOWN);
            if(pathToNetwork && pathToNetwork.path) {
                applyRoadPath(pathToNetwork.path.map(p=>({x:p.x, y:p.y})), ROAD_LEVELS.TOWN, town.properties.population);
            }
        } else {
            town.properties.nationId = 0;
        }
    });

    // ⑤ 村 (Village) の所属と街道を決定
    await addLogMessage("村と町を村道で接続しています...");
    const townAndHigher = [...towns.filter(t => t.properties.nationId > 0), ...streetAndHigher];
    // ★★★ [修正] サイズ制限を考慮したクラスタリング関数を呼び出す ★★★
    const villageClusters = findSettlementClusters(villages);
    const representativeVillages = villageClusters.map(cluster => cluster.sort((a,b) => b.properties.population - a.properties.population)[0]);
    const villageAffiliations = determineAffiliation(representativeVillages, townAndHigher, { allHexes, costFunc: pathfindingCostFunc });
    
    villageClusters.forEach((cluster, index) => {
        const representative = representativeVillages[index];
        if (!representative || representative.properties.population <= 100) { cluster.forEach(v => v.properties.nationId = 0); return; }
        
        const { superior, cost } = villageAffiliations.get(representative) || {};

        if (superior && cost < MAX_COST_FOR_NATION) {
            const parentId = getIndex(superior.col, superior.row);
            const nationId = superior.properties.nationId;
            cluster.forEach(village => { 
                village.properties.nationId = nationId;
                village.properties.parentHexId = parentId;
            });
            const pathToNetwork = findPathToExistingNetwork(representative, ROAD_LEVELS.VILLAGE);
            if(pathToNetwork && pathToNetwork.path) {
                applyRoadPath(pathToNetwork.path.map(p=>({x:p.x, y:p.y})), ROAD_LEVELS.VILLAGE, representative.properties.population);
            }
        } else {
             cluster.forEach(village => { village.properties.nationId = 0; });
        }
    });

    await addLogMessage("街道網が完成しました！");
    return allHexes;
}