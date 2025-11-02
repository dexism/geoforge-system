// ================================================================
// GeoForge System - 街道生成モジュール (v16 - 初期設計への完全回帰)
// ================================================================
import * as d3 from 'd3'; 
import * as config from './config.js';
import { getIndex, getDistance } from './utils.js';

const ROAD_LEVELS = { NONE: 0, PATH: 1, VILLAGE: 2, TOWN: 3, MAIN: 4, TRADE: 5 };

function findSettlementClusters(settlementList) {
    const clusters = [];
    const visited = new Set();
    settlementList.forEach(startNode => {
        if (!visited.has(startNode)) {
            const currentCluster = [];
            const queue = [startNode];
            visited.add(startNode);
            while (queue.length > 0) {
                const currentNode = queue.shift();
                currentCluster.push(currentNode);
                settlementList.forEach(nextNode => {
                    if (!visited.has(nextNode) && getDistance(currentNode, nextNode) <= 1) {
                        visited.add(nextNode);
                        queue.push(nextNode);
                    }
                });
            }
            clusters.push(currentCluster);
        }
    });
    return clusters;
}

function findAStarPath(options) {
    const start = options.start;
    const isEnd = options.isEnd; 
    const neighbor = options.neighbor;
    const costFunc = options.cost;
    const heuristic = options.heuristic;

    const toVisit = [{ node: start, f: 0, g: 0 }];
    const visited = new Map();
    visited.set(`${start.x}-${start.y}`, { parent: null, g: 0 });

    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.f - b.f);
        const current = toVisit.shift();

        if (isEnd(current.node, start)) { 
            const path = [];
            let curr = current.node;
            while (curr) {
                path.unshift(curr);
                const visitedNode = visited.get(`${curr.x}-${curr.y}`);
                curr = visitedNode ? visitedNode.parent : null;
            }
            return path;
        }

        const parentNode = visited.get(`${current.node.x}-${current.node.y}`).parent;
        neighbor(current.node).forEach(n => {
            const gScore = current.g + costFunc(current.node, n, parentNode);
            const visitedNeighbor = visited.get(`${n.x}-${n.y}`);

            if (!visitedNeighbor || gScore < visitedNeighbor.g) {
                visited.set(`${n.x}-${n.y}`, { parent: current.node, g: gScore });
                const fScore = gScore + heuristic(n);
                toVisit.push({ node: n, f: fScore, g: gScore });
            }
        });
    }
    return null;
}

/**
 * 街道生成のメイン関数 (main.js から呼び出される)
 */
export async function generateRoads(allHexes, addLogMessage) {
    await addLogMessage("街道網の整備を開始しました...");

    // 1. 初期化
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

    // 2. あなたの設計通りの、高速な経路探索ヘルパー
    const pathfindingCostFunc = (nodeA, nodeB) => {
        const targetHex = allHexes[getIndex(nodeB.x, nodeB.y)];
        let cost = targetHex.properties.movementCost;
        const startHex = allHexes[getIndex(nodeA.x, nodeA.y)];
        cost += Math.pow(Math.abs(startHex.properties.elevation - targetHex.properties.elevation) / 100, 2) * 10;
        return cost;
    };
    
    const findPathForMajorNetwork = (startHex, endHex) => findAStarPath({
        start: {x: startHex.col, y: startHex.row},
        isEnd: (node) => (node.x === endHex.col && node.y === endHex.row),
        neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({x: h.col, y: h.row})),
        cost: pathfindingCostFunc,
        heuristic: (node) => getDistance(allHexes[getIndex(node.x, node.y)], endHex)
    });

    // ★★★ [復元] あなたの高速な「既存ネットワークへの接続」関数 ★★★
    const findPathToExistingNetwork = (startHex, targetUpperLevel) => findAStarPath({
        start: {x: startHex.col, y: startHex.row},
        isEnd: (node, startNode) => {
            if (node.x === startNode.x && node.y === startNode.y) return false;
            return allHexes[getIndex(node.x, node.y)].properties.roadLevel > targetUpperLevel;
        },
        neighbor: (node) => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).filter(h => !h.properties.isWater).map(h => ({x: h.col, y: h.row})),
        cost: pathfindingCostFunc,
        heuristic: (node) => 0
    });
    
    // 3. ★★★ [修正] 親子関係のみを正しく決定するデータ適用ヘルパー ★★★
    const applyConnectingRoadPath = (path, level, traffic, sourceHex, allHigherSettlements) => {
        if (!path || path.length <= 1) return;
        
        // 道が接続した地点のヘックスを取得
        const lastNode = path[path.length - 1];
        const connectionPointHex = allHexes[getIndex(lastNode.x, lastNode.y)];
        
        // 接続地点から「地理的に最も近い」上位集落を親とする (高速な処理)
        let closestSuperior = null;
        let minDistance = Infinity;
        allHigherSettlements.forEach(superior => {
            // ★★★ 国が同じという条件を追加 ★★★
            if (sourceHex.properties.nationId === superior.properties.nationId) {
                const d = getDistance(connectionPointHex, superior);
                if (d < minDistance) {
                    minDistance = d;
                    closestSuperior = superior;
                }
            }
        });

        // もし自国内に親が見つからなければ、国境を越えて探す（辺境など）
        if (!closestSuperior) {
            allHigherSettlements.forEach(superior => {
                const d = getDistance(connectionPointHex, superior);
                if (d < minDistance) {
                    minDistance = d;
                    closestSuperior = superior;
                }
            });
        }

        if (closestSuperior) {
            sourceHex.properties.parentHexId = getIndex(closestSuperior.col, closestSuperior.row);
        }

        // 道路を敷設
        const pathToBuild = path.slice(0, -1);
        pathToBuild.forEach(node => {
            const hex = allHexes[getIndex(node.x, node.y)];
            if (hex.properties.roadLevel < level) hex.properties.roadLevel = level;
            hex.properties.roadTraffic += traffic;
        });
    };

    // 4. 居住地を階層ごとに分類
    const villages = allHexes.filter(s => s.properties.settlement === '村');
    const towns = allHexes.filter(s => s.properties.settlement === '町');
    const streets = allHexes.filter(s => s.properties.settlement === '街');
    const majorCities = allHexes.filter(s => ['領都', '都市', '首都'].includes(s.properties.settlement));

    // 5. あなたの設計通りのトップダウン式アプローチ
    // ① 主要都市ネットワーク
    await addLogMessage("交易路の幹線網を設計しています...");
    if (majorCities.length >= 2) {
        const points = majorCities.map(c => [c.col, c.row]);
        const delaunay = d3.Delaunay.from(points);
        const { halfedges, triangles } = delaunay;
        for (let i = 0; i < halfedges.length; i++) {
            const j = halfedges[i];
            if (j < i) continue;
            const city1 = majorCities[triangles[i]];
            const city2 = majorCities[triangles[j]];
            if (getDistance(city1, city2) > 40) continue;
            const path = findPathForMajorNetwork(city1, city2);
            if(path) {
                path.forEach(node => {
                    const hex = allHexes[getIndex(node.x, node.y)];
                    if (hex.properties.roadLevel < ROAD_LEVELS.TRADE) hex.properties.roadLevel = ROAD_LEVELS.TRADE;
                    hex.properties.roadTraffic += city1.properties.population + city2.properties.population;
                });
            }
        }
    }

    // ② 街は、既存の主要道（交易路）へ接続
    await addLogMessage("地方の主要道を幹線に接続しています...");
    streets.forEach(street => {
        const path = findPathToExistingNetwork(street, ROAD_LEVELS.MAIN);
        if (path) {
            applyConnectingRoadPath(path, ROAD_LEVELS.MAIN, street.properties.population, street, majorCities);
        }
    });

    // ③ 町は、既存の街以上の道へ接続
    await addLogMessage("町と街を町道で結んでいます...");
    const streetAndHigher = [...streets, ...majorCities];
    towns.forEach(town => {
        const path = findPathToExistingNetwork(town, ROAD_LEVELS.TOWN);
        if (path) {
            applyConnectingRoadPath(path, ROAD_LEVELS.TOWN, town.properties.population, town, streetAndHigher);
        }
    });

    // ④ 村グループは、既存の町以上の道へ接続
    await addLogMessage("村と町を村道で接続しています...");
    const townAndHigher = [...towns, ...streetAndHigher];
    const villageClusters = findSettlementClusters(villages);
    villageClusters.forEach(cluster => {
        const representative = cluster.sort((a,b) => b.properties.population - a.properties.population)[0];
        const path = findPathToExistingNetwork(representative, ROAD_LEVELS.VILLAGE);
        if (path) {
            const lastNode = path[path.length - 1];
            const connectionPointHex = allHexes[getIndex(lastNode.x, lastNode.y)];
            let closestSuperior = null;
            let minDistance = Infinity;
            
            // まずは自国内で探す
            townAndHigher.forEach(superior => {
                if (representative.properties.nationId === superior.properties.nationId) {
                    const d = getDistance(connectionPointHex, superior);
                    if (d < minDistance) {
                        minDistance = d;
                        closestSuperior = superior;
                    }
                }
            });
            // 見つからなければ他国も探す
            if (!closestSuperior) {
                 townAndHigher.forEach(superior => {
                    const d = getDistance(connectionPointHex, superior);
                    if (d < minDistance) {
                        minDistance = d;
                        closestSuperior = superior;
                    }
                });
            }
            
            if (closestSuperior) {
                const parentId = getIndex(closestSuperior.col, closestSuperior.row);
                const pathToBuild = path.slice(0, -1);
                pathToBuild.forEach(node => {
                    const hex = allHexes[getIndex(node.x, node.y)];
                    if (hex.properties.roadLevel < ROAD_LEVELS.VILLAGE) hex.properties.roadLevel = ROAD_LEVELS.VILLAGE;
                    hex.properties.roadTraffic += representative.properties.population;
                });
                cluster.forEach(village => { village.properties.parentHexId = parentId; });
            }
        }
    });

    await addLogMessage("街道網が完成しました！");
    return allHexes;
}