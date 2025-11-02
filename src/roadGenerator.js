// ================================================================
// GeoForge System - 街道生成モジュール
// ================================================================

import * as config from './config.js';
import { getIndex, getDistance } from './utils.js'; // ★ 後で作成するヘルパー関数です

/**
 * A* Pathfinding Algorithm (自己完結型)
 */
function findAStarPath(options) {
    const start = options.start;
    const isEnd = options.isEnd;
    const neighbor = options.neighbor;
    const cost = options.cost;
    const heuristic = options.heuristic;

    const toVisit = [{ node: start, f: 0, g: 0 }];
    const visited = new Map();
    visited.set(`${start.x}-${start.y}`, { parent: null, g: 0 });

    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.f - b.f);
        const current = toVisit.shift();

        if (isEnd(current.node)) {
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
            const gScore = current.g + cost(current.node, n, parentNode);
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
 * @param {Array<object>} allHexes - 経済シミュレーション後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 街道情報が追加された全ヘックスデータ
 */
export async function generateRoads(allHexes, addLogMessage) {
    await addLogMessage("街道の整備を開始しました...");

    const maxPopulation = allHexes.reduce((max, h) => Math.max(max, h.properties.population || 0), 0);
    let totalRoadHexes = 0;

    // 1. 各ヘックスに移動コストの基本値を設定
    allHexes.forEach(h => {
        const p = h.properties;
        let cost = 1;
        if (p.isWater) cost = Infinity;
        else {
            if (p.vegetation === '湖沼') cost = 50;
            if (p.vegetation === '森林' || p.vegetation === '疎林') cost += 2;
            if (p.vegetation === '密林' || p.vegetation === '針葉樹林') cost += 4;
            if (p.elevation > 1000) {
                const elevationFactor = p.elevation / 700;
                const elevationPenalty = Math.pow(elevationFactor, 2.8);
                cost += elevationPenalty;
            }
            if (p.flow > 2) cost += p.flow * 3;
        }
        p.movementCost = cost;
    });

    // 2. A*探索のためのヘルパー関数を定義
    const findPath = (startHex, endHex) => {
        const path = findAStarPath({
            start: {x: startHex.col, y: startHex.row},
            isEnd: (node) => node.x === endHex.col && node.y === endHex.row,
            neighbor: (node) => {
                const hex = allHexes[getIndex(node.x, node.y)];
                return hex.neighbors
                    .map(nIndex => allHexes[nIndex])
                    .filter(neighborHex => !neighborHex.properties.isWater)
                    .map(neighborHex => ({ x: neighborHex.col, y: neighborHex.row }));
            },
            cost: (nodeA, nodeB, parentNode) => {
                const targetHex = allHexes[getIndex(nodeB.x, nodeB.y)];
                if (targetHex.properties.roadTraffic > 0) return 0.1;

                const startHex = allHexes[getIndex(nodeA.x, nodeA.y)];
                const elevationDifference = Math.abs(startHex.properties.elevation - targetHex.properties.elevation);
                const slopePenaltyFactor = 20;
                let terrainCost = 1 + Math.pow(elevationDifference / 100, 2) * slopePenaltyFactor;
                terrainCost += (targetHex.properties.movementCost - 1) * 0.5;

                let turnPenalty = 0;
                if (parentNode) {
                    const dx1 = nodeA.x - parentNode.x; const dy1 = nodeA.y - parentNode.y;
                    const dx2 = nodeB.x - nodeA.x;   const dy2 = nodeB.y - nodeA.y;
                    if (dx1 !== dx2 || dy1 !== dy2) turnPenalty = 20;
                }
                
                const populationFactor = 1.0 - (targetHex.properties.population / maxPopulation);
                const populationPenalty = populationFactor * 5;

                return terrainCost + turnPenalty + populationPenalty;
            },
            heuristic: (node) => getDistance(allHexes[getIndex(node.x, node.y)], endHex)
        });

        if (path) return path.map(node => getIndex(node.x, node.y));
        return [];
    };

    const findClosest = (source, targets) => {
        let closest = null;
        let minDistance = Infinity;
        targets.forEach(target => {
            const d = getDistance(source, target);
            if (d < minDistance) {
                minDistance = d;
                closest = target;
            }
        });
        return closest;
    };

    // 3. 階層的に街道を生成
    allHexes.forEach(h => { h.properties.roadTraffic = 0; });

    const allSettlements = allHexes.filter(h => h.properties.settlement);
    const capitals = allSettlements.filter(h => h.properties.settlement === '都');
    const cities = allSettlements.filter(h => h.properties.settlement === '街');
    const towns = allSettlements.filter(h => h.properties.settlement === '町');
    const villages = allSettlements.filter(h => h.properties.settlement === '村');

    console.log(`[DEBUG] 居住地チェック: 都(${capitals.length}), 街(${cities.length}), 町(${towns.length}), 村(${villages.length})`);

    const connectSettlements = (sourceList, targetList) => {
        sourceList.forEach(source => {
            const closest = findClosest(source, targetList);
            if (closest) {
                const path = findPath(source, closest);
                if (path.length > 0) {
                    path.forEach(hexIndex => {
                        allHexes[hexIndex].properties.roadTraffic += source.properties.population;
                        totalRoadHexes++;
                    });
                }
            }
        });
    };

    await addLogMessage("集落間の道を整備中...");
    connectSettlements(villages, [...towns, ...cities, ...capitals]);
    await addLogMessage("地方の道を幹線に接続中...");
    connectSettlements(towns, [...cities, ...capitals]);
    await addLogMessage("主要都市間を結んでいます...");
    connectSettlements(cities, capitals);
    await addLogMessage("国家間の大動脈を敷設中...");

    for (let i = 0; i < capitals.length; i++) {
        for (let j = i + 1; j < capitals.length; j++) {
            const path = findPath(capitals[i], capitals[j]);
            if (path.length > 0) {
                path.forEach(hexIndex => {
                    allHexes[hexIndex].properties.roadTraffic += 100000;
                    totalRoadHexes++;
                });
            }
        }
    }

    const totalRoadKm = totalRoadHexes * config.HEX_SIZE_KM;
    await addLogMessage(`街道網が完成しました！ 総延長: ${totalRoadKm.toLocaleString()} km`);

    return allHexes;
}