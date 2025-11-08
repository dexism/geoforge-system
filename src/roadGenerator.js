// ================================================================
// GeoForge System - 街道生成モジュール (v18.1 - 階層生成バグ修正)
// ================================================================
import * as config from './config.js';
import { getIndex, getDistance } from './utils.js';

// Union-Find (変更なし)
class UnionFind {
    constructor(elements) { this.parent = new Map(); elements.forEach(el => this.parent.set(el, el)); }
    find(i) { if (this.parent.get(i) === i) { return i; } const root = this.find(this.parent.get(i)); this.parent.set(i, root); return root; }
    union(i, j) { const rootI = this.find(i); const rootJ = this.find(j); if (rootI !== rootJ) { this.parent.set(rootJ, rootI); return true; } return false; }
}

// findAStarPath (変更なし)
function findAStarPath({ start, goal, getNeighbors, heuristic, cost }) {
    const toVisit = [{ node: start, f: 0, g: 0, path: [start] }];
    const visited = new Map();
    visited.set(`${start.x}-${start.y}`, 0);

    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.f - b.f);
        const current = toVisit.shift();

        if (current.node.x === goal.x && current.node.y === goal.y) {
            return { path: current.path, cost: current.g };
        }

        getNeighbors(current.node).forEach(n => {
            const gScore = current.g + cost(current.node, n);
            const visitedNeighborCost = visited.get(`${n.x}-${n.y}`);
            
            if (visitedNeighborCost === undefined || gScore < visitedNeighborCost) {
                visited.set(`${n.x}-${n.y}`, gScore);
                const hScore = heuristic(n, goal);
                const fScore = gScore + hScore;
                toVisit.push({ node: n, f: fScore, g: gScore, path: [...current.path, n] });
            }
        });
    }
    return null;
}

// createCostFunction (変更なし)
const createCostFunction = (allHexes, ownerNationId) => (nodeA, nodeB) => {
    const hexA = allHexes[getIndex(nodeA.x, nodeA.y)];
    const hexB = allHexes[getIndex(nodeB.x, nodeB.y)];
    const pB = hexB.properties;

    if (pB.isWater) return Infinity;

    let cost = 1;
    cost += pB.flow > 2 ? pB.flow * 3 : 0;
    if (pB.vegetation === '森林' || pB.vegetation === '疎林') cost += 2;
    if (pB.vegetation === '密林' || pB.vegetation === '針葉樹林') cost += 4;
    if (pB.elevation > 1000) cost += Math.pow(pB.elevation / 700, 2.8);

    const elevationDiff = Math.abs(hexA.properties.elevation - hexB.properties.elevation);
    cost += elevationDiff * 0.05;

    if (ownerNationId && pB.nationId !== 0 && pB.nationId !== ownerNationId) {
        cost *= 50; 
    }

    return cost;
};

/**
 * ★★★ [改修] 交易路を生成し、プログレスバーを表示する ★★★
 */
export async function generateTradeRoutes(cities, allHexes, addLogMessage) {
    const roadPaths = [];
    const routeData = [];
    if (cities.length < 2) return { roadPaths, routeData };

    await addLogMessage(`全${cities.length}都市間の経路を探索しています...`);
    const progressId = 'trade-route-progress';
    await addLogMessage(`経路探索の初期化`, progressId);
    
    const costFunc = createCostFunction(allHexes, null);
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors
        .map(i => allHexes[i])
        .map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});

    const allEdges = [];
    const totalPairs = (cities.length * (cities.length - 1)) / 2;
    let processedPairs = 0;
    let lastReportedPercent = -1;

    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
            const city1 = cities[i];
            const city2 = cities[j];
            const result = findAStarPath({
                start: { x: city1.col, y: city1.row },
                goal: { x: city2.col, y: city2.row },
                getNeighbors, heuristic, cost: costFunc
            });
            if (result) {
                allEdges.push({ from: city1, to: city2, path: result.path, cost: result.cost });
            }

            // プログレスバーの更新
            processedPairs++;
            const percent = Math.floor((processedPairs / totalPairs) * 100);
            if (percent > lastReportedPercent) {
                 const barWidth = 20;
                 const filledLength = Math.round((barWidth * percent) / 100);
                 const bar = '>'.repeat(filledLength) + ' '.repeat(barWidth - filledLength);
                 // const message = `経路探索中... [${bar}] ${percent}% (${processedPairs}/${totalPairs})`;
                 const message = `${bar} ${percent}% (${processedPairs}/${totalPairs})`;
                 await addLogMessage(message, progressId);
                 lastReportedPercent = percent;
            }
        }
    }

    await addLogMessage(`経路探索完了。全 ${allEdges.length} 経路を発見しました。`, progressId);

    allEdges.sort((a, b) => a.cost - b.cost);
    
    const cityIndices = cities.map(c => getIndex(c.col, c.row));
    const unionFind = new UnionFind(cityIndices);
    
    allEdges.forEach(edge => {
        const fromId = getIndex(edge.from.col, edge.from.row);
        const toId = getIndex(edge.to.col, edge.to.row);
        if (unionFind.union(fromId, toId)) {
            const pathNodes = edge.path.map(p => ({x: p.x, y: p.y}));
            roadPaths.push({ path: pathNodes, level: 5, nationId: 0 });
            routeData.push(edge);
        }
    });

    return { roadPaths, routeData };
}

/**
 * ⑪～⑬ 下位の道路網を生成する
 */
export async function generateFeederRoads(lowerSettlements, upperSettlements, allHexes, type) {
    const roadPaths = [];
    if (lowerSettlements.length === 0 || upperSettlements.length === 0) return roadPaths;

    const roadLevelMap = { '街': 4, '町': 3, '村': 2 };
    const roadLevel = roadLevelMap[type];

    for (const lower of lowerSettlements) {
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        // ★★★ [修正] 時期尚早な nationId チェックを削除 ★★★
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        // const ownerNationId = lower.properties.nationId;
        // if (ownerNationId === 0) continue; 
        // この時点では lower.properties.nationId は 0 のため、このチェックは不要

        let bestTarget = null;
        let minCost = Infinity;

        // 接続先候補は、まず自国内、なければ全域から探す
        // この時点では ownerNationId が未定なので、単純に全上位集落を候補とする
        const targetCandidates = upperSettlements;

        // 最寄りの接続先を見つける (直線距離で候補を絞る)
        targetCandidates.sort((a,b) => getDistance(lower, a) - getDistance(lower, b));
        const searchCandidates = targetCandidates.slice(0, 5);

        // ★★★ [修正] コスト計算時に渡す ownerNationId は、まだ未定なので null とする ★★★
        const costFunc = createCostFunction(allHexes, null); // どの国にも属していない前提で探索
        const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors
            .map(i => allHexes[i])
            .map(h => ({ x: h.col, y: h.row }));
        const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});
        
        for (const upper of searchCandidates) {
             const result = findAStarPath({
                start: { x: lower.col, y: lower.row },
                goal: { x: upper.col, y: upper.row },
                getNeighbors, heuristic, cost: costFunc
             });
             if (result && result.cost < minCost) {
                 minCost = result.cost;
                 bestTarget = { path: result.path, superior: upper };
             }
        }
        
        if (bestTarget) {
            lower.properties.parentHexId = getIndex(bestTarget.superior.col, bestTarget.superior.row);
            // 道に国家IDを設定。この時点ではまだ親のIDが不明なため、暫定的に 0 としておく
            // 正しい nationId は civilizationGenerator の propagateNationId で設定される
            roadPaths.push({ path: bestTarget.path.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: 0 });
        }
    }
    return roadPaths;
}