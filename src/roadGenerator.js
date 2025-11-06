// ================================================================
// GeoForge System - 街道生成モジュール (v17.10 - コスト計算ロジック修正)
// ================================================================
import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, getDistance } from './utils.js';

const ROAD_LEVELS = { NONE: 0, PATH: 1, VILLAGE: 2, TOWN: 3, MAIN: 4, TRADE: 5 };
const MAX_COST_FOR_NATION = 15000;
const MAX_VILLAGE_CLUSTER_SIZE = 7; 
const MAX_TRADE_ROUTE_COST = 10000; 

/**
 * 最小全域木を構築するためのUnion-Findデータ構造
 */
class UnionFind {
    constructor(elements) {
        this.parent = new Map();
        elements.forEach(el => this.parent.set(el, el));
    }

    find(i) {
        if (this.parent.get(i) === i) {
            return i;
        }
        const root = this.find(this.parent.get(i));
        this.parent.set(i, root); // Path compression
        return root;
    }

    union(i, j) {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent.set(rootJ, rootI);
            return true;
        }
        return false;
    }
}


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


function findSettlementClusters(settlementList) {
    const clusters = [];
    const visited = new Set(); 

    const sortedList = [...settlementList].sort((a, b) => b.properties.population - a.properties.population);

    sortedList.forEach(startNode => {
        const startIndex = getIndex(startNode.col, startNode.row);
        if (!visited.has(startIndex)) {
            const currentCluster = [];
            const queue = [startNode]; 
            visited.add(startIndex);

            while (queue.length > 0 && currentCluster.length < MAX_VILLAGE_CLUSTER_SIZE) {
                const currentNode = queue.shift();
                currentCluster.push(currentNode);

                settlementList.forEach(nextNode => {
                    const nextIndex = getIndex(nextNode.col, nextNode.row);
                    if (!visited.has(nextIndex) && getDistance(currentNode, nextNode) <= 1) {
                        visited.add(nextIndex);
                        queue.push(nextNode);
                    }
                });
            }
            clusters.push(currentCluster);
        }
    });
    return clusters;
}


function determineAffiliation(targets, allSuperiors, params) {
    const { allHexes, costFunc, targetType } = params; 
    const results = new Map();

    if (targetType === 'majorCity') {
        const capitals = allSuperiors.filter(s => s.properties.settlement === '首都');
        targets.forEach(target => {
            const myCapital = capitals.find(c => c.properties.nationId === target.properties.nationId);
            if (myCapital) {
                results.set(target, { superior: myCapital, cost: 0 });
            }
        });
        return results;
    }
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
    const roadPaths = [];

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
        const propsB = hexB.properties;

        let cost;

        if (propsB.roadLevel > ROAD_LEVELS.NONE) {
            cost = 1.0 - (propsB.roadLevel / (Object.keys(ROAD_LEVELS).length));
            cost = Math.max(0.1, cost);
        } else {
            cost = propsB.movementCost;
        }
        
        // ★★★ [根本修正] 標高差コストを「2乗」から「線形（比例）」に変更 ★★★
        const ELEVATION_COST_FACTOR = 0.05; // この値で坂道のコストへの影響度を調整
        cost += Math.abs(hexA.properties.elevation - hexB.properties.elevation) * ELEVATION_COST_FACTOR;
        
        return cost;
    };
    
    const applyRoadPath = (path, level, traffic) => {
        if (!path || path.length === 0) return;
        path.forEach(node => {
            const hex = allHexes[getIndex(node.x, node.y)];
            if (hex.properties.roadLevel < level) hex.properties.roadLevel = level;
            hex.properties.roadTraffic += traffic;
        });
        roadPaths.push({ path: path.map(p => ({ x: p.x, y: p.y })), level: level });
    };
    
    const applyFeederRoadPath = (path, level, traffic) => {
        if (!path || path.length <= 1) return;
        const actualPath = path.slice(0, -1);
        actualPath.forEach(node => {
            const hex = allHexes[getIndex(node.x, node.y)];
            if (hex.properties.roadLevel < level) hex.properties.roadLevel = level;
            hex.properties.roadTraffic += traffic;
        });
        roadPaths.push({ path: actualPath.map(p => ({ x: p.x, y: p.y })), level: level });
    };

    const findPathToExistingNetwork = (startHex, targetUpperLevel) => findAStarPath({
        start: { x: startHex.col, y: startHex.row },
        isEnd: (node, startNode) => {
            if (node.x === startNode.x && node.y === startNode.y) return false;
            const targetHex = allHexes[getIndex(node.x, node.y)];
            return targetHex.properties.roadLevel >= targetUpperLevel && targetHex.properties.nationId === startHex.properties.nationId;
        },
        neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({ x: h.col, y: h.row })),
        cost: pathfindingCostFunc,
        heuristic: (node) => 0
    });

    // 2. 居住地を階層ごとに分類
    const villages = allHexes.filter(s => s.properties.settlement === '村');
    const towns = allHexes.filter(s => s.properties.settlement === '町');
    const streets = allHexes.filter(s => s.properties.settlement === '街');
    const majorsToProcess = allHexes.filter(s => ['都市', '領都'].includes(s.properties.settlement));
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

    await addLogMessage("主要都市の所属を確定しています...");
    const majorCityAffiliations = determineAffiliation(majorsToProcess, capitals, { allHexes, costFunc: pathfindingCostFunc, targetType: 'majorCity' });
    majorsToProcess.forEach(city => {
        const { superior } = majorCityAffiliations.get(city) || {};
        if (superior) {
            city.properties.parentHexId = getIndex(superior.col, superior.row);
        }
    });

    // ② 主要都市ネットワーク（交易路）を生成 (高速な K_NEAREST 方式)
    await addLogMessage("交易路の幹線網を設計しています...");
    if (allMajorCities.length >= 2) {
        const K_NEAREST = 4;
        const candidateEdges = new Map();

        await addLogMessage(`全${allMajorCities.length}都市から近傍${K_NEAREST}都市への経路を探索...`);
        for (const [index, city1] of allMajorCities.entries()) {
            const otherCities = allMajorCities
                .filter(c => c !== city1)
                .sort((a, b) => getDistance(city1, a) - getDistance(city1, b));

            const nearestNeighbors = otherCities.slice(0, K_NEAREST);

            for (const city2 of nearestNeighbors) {
                const result = findAStarPath({
                    start: { x: city1.col, y: city1.row },
                    isEnd: (node) => (node.x === city2.col && node.y === city2.row),
                    neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({ x: h.col, y: h.row })),
                    cost: pathfindingCostFunc,
                    heuristic: (node) => getDistance(allHexes[getIndex(node.x, node.y)], city2)
                });
                
                if (result && result.cost < MAX_TRADE_ROUTE_COST) {
                    const key = [getIndex(city1.col, city1.row), getIndex(city2.col, city2.row)].sort().join('-');
                    if (!candidateEdges.has(key) || candidateEdges.get(key).cost > result.cost) {
                        candidateEdges.set(key, { from: city1, to: city2, path: result.path, cost: result.cost });
                    }
                }
            }
        }
        
        const allPossibleEdges = Array.from(candidateEdges.values()).sort((a, b) => a.cost - b.cost);

        await addLogMessage("候補経路から最適なネットワークを構築しています...");
        const finalEdges = new Set();
        const cityIndices = allMajorCities.map(c => getIndex(c.col, c.row));
        const unionFind = new UnionFind(cityIndices);
        
        allPossibleEdges.forEach(edge => {
            const fromId = getIndex(edge.from.col, edge.from.row);
            const toId = getIndex(edge.to.col, edge.to.row);
            if (unionFind.union(fromId, toId)) {
                finalEdges.add(edge);
            }
        });

        let roots = new Set(cityIndices.map(id => unionFind.find(id)));
        if (roots.size > 1) {
            await addLogMessage(`ネットワークが${roots.size}個に分断されています。再接続します...`);
            while (roots.size > 1) {
                let bestBridgeEdge = null;
                for(const edge of allPossibleEdges) {
                    if (finalEdges.has(edge)) continue;
                    const fromRoot = unionFind.find(getIndex(edge.from.col, edge.from.row));
                    const toRoot = unionFind.find(getIndex(edge.to.col, edge.to.row));
                    if(fromRoot !== toRoot) {
                        if (!bestBridgeEdge || edge.cost < bestBridgeEdge.cost) {
                            bestBridgeEdge = edge;
                        }
                    }
                }

                if (bestBridgeEdge) {
                    finalEdges.add(bestBridgeEdge);
                    unionFind.union(getIndex(bestBridgeEdge.from.col, bestBridgeEdge.from.row), getIndex(bestBridgeEdge.to.col, bestBridgeEdge.to.row));
                    const newRoots = new Set(cityIndices.map(id => unionFind.find(id)));
                    await addLogMessage(`[再接続] 経路を追加し、分断数を ${roots.size} -> ${newRoots.size} に削減しました。`);
                    roots = newRoots;
                } else {
                    await addLogMessage("警告: これ以上接続できる経路が見つかりませんでした。");
                    break;
                }
            }
        }

        const degree = new Map(cityIndices.map(id => [id, 0]));
        finalEdges.forEach(edge => {
            const fromId = getIndex(edge.from.col, edge.from.row);
            const toId = getIndex(edge.to.col, edge.to.row);
            degree.set(fromId, degree.get(fromId) + 1);
            degree.set(toId, degree.get(toId) + 1);
        });

        const remainingEdges = allPossibleEdges.filter(edge => !finalEdges.has(edge));
        for (const edge of remainingEdges) {
            const fromId = getIndex(edge.from.col, edge.from.row);
            const toId = getIndex(edge.to.col, edge.to.row);
            if (degree.get(fromId) < 2 || degree.get(toId) < 2) {
                finalEdges.add(edge);
                degree.set(fromId, degree.get(fromId) + 1);
                degree.set(toId, degree.get(toId) + 1);
            }
        }

        finalEdges.forEach(edge => {
            applyRoadPath(edge.path, ROAD_LEVELS.TRADE, edge.from.properties.population + edge.to.properties.population);
        });
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
                 applyFeederRoadPath(pathToNetwork.path, ROAD_LEVELS.MAIN, street.properties.population);
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
                applyFeederRoadPath(pathToNetwork.path, ROAD_LEVELS.TOWN, town.properties.population);
            }
        } else {
            town.properties.nationId = 0;
        }
    });

    // ⑤ 村 (Village) の所属と街道を決定
    await addLogMessage("村と町を村道で接続しています...");
    const townAndHigher = [...towns.filter(t => t.properties.nationId > 0), ...streetAndHigher];
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
                applyFeederRoadPath(pathToNetwork.path, ROAD_LEVELS.VILLAGE, representative.properties.population);
            }
        } else {
             cluster.forEach(village => { village.properties.nationId = 0; });
        }
    });

    await addLogMessage("街道網が完成しました！");

    return { allHexes, roadPaths };
}