// ================================================================
// GeoForge System - 街道生成モジュール (v18.1 - 階層生成バグ修正)
// ================================================================
import * as config from './config.js';
import { getIndex, getDistance, formatProgressBar } from './utils.js';

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
    // 河川コスト
    cost += pB.flow > 2 ? pB.flow * 3 : 0;
    // 植生コスト
    if (pB.vegetation === '森林' || pB.vegetation === '疎林') cost += 2;
    if (pB.vegetation === '密林' || pB.vegetation === '針葉樹林') cost += 4;
    // 標高コスト
    if (pB.elevation > 1000) cost += Math.pow(pB.elevation / 700, 2.8);

    // ★★★ [新規] 稜線を横断する際の追加コスト ★★★
    // ridgeFlow（稜線の太さ）が大きいほど、コストが指数関数的に増加する
    if (pB.ridgeFlow > 0) {
        cost += pB.ridgeFlow * config.RIDGE_CROSSING_COST_MULTIPLIER;
    }
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

    // 高低差コスト
    const elevationDiff = Math.abs(hexA.properties.elevation - hexB.properties.elevation);
    cost += elevationDiff * 0.05;

    // 他国領土コスト
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

    const progressId = 'trade-route-progress';
    await addLogMessage(`交易路の経路探索...`, progressId);
    
    const costFunc = createCostFunction(allHexes, null);
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});

    const allEdges = [];
    const totalPairs = (cities.length * (cities.length - 1)) / 2;
    let processedPairs = 0;
    let lastReportedPercent = -1;

    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
            const city1 = cities[i];
            const city2 = cities[j];
            const result = findAStarPath({ start: { x: city1.col, y: city1.row }, goal: { x: city2.col, y: city2.row }, getNeighbors, heuristic, cost: costFunc });
            if (result) {
                allEdges.push({ from: city1, to: city2, path: result.path, cost: result.cost });
            }

            processedPairs++;
            const percent = Math.floor((processedPairs / totalPairs) * 100);
            if (percent > lastReportedPercent) {
                 // ★★★ [変更] 汎用関数を呼び出す ★★★
                 const message = formatProgressBar({ current: processedPairs, total: totalPairs, prefix: "交易路:" });
                 await addLogMessage(message, progressId);
                 lastReportedPercent = percent;
            }
        }
    }

    await addLogMessage(`交易路: 探索完了。全 ${allEdges.length} 経路を発見しました。`, progressId);

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
 * ★★★ [新規] パスに沿った道のりを計算する関数 ★★★
 * @param {Array<object>} path - ヘックスの座標リスト ({x, y})
 * @param {number} roadLevel - 道路のレベル (5:交易路, 4:街道, etc.)
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @returns {number} 計算された道のり (km)
 */
function calculateRoadDistance(path, roadLevel, allHexes) {
    if (path.length < 2) return 0;
    
    // ★★★ [修正] 隣接ヘックス間の中心距離は、どの方向でもHEX_SIZE_KM(高さ)と等しい ★★★
    const distancePerHex = config.HEX_SIZE_KM;
    const totalDirectDistance = distancePerHex * (path.length - 1);

    const terrainMultipliers = path.map(pos => {
        const hex = allHexes[getIndex(pos.x, pos.y)];
        const p = hex.properties;
        let multiplier = 1.0;
        switch (p.terrainType) {
            case '山岳': multiplier = config.TERRAIN_MULTIPLIERS.山岳; break;
            case '山地': multiplier = config.TERRAIN_MULTIPLIERS.山地; break;
            case '丘陵': multiplier = config.TERRAIN_MULTIPLIERS.丘陵; break;
            case '平地':
                if (p.vegetation === '密林') multiplier = config.TERRAIN_MULTIPLIERS.密林;
                else if (p.vegetation === '森林' || p.vegetation === '針葉樹林') multiplier = config.TERRAIN_MULTIPLIERS.森林;
                else multiplier = config.TERRAIN_MULTIPLIERS.平地;
                break;
        }
        if (p.flow > 1) multiplier += config.TERRAIN_MULTIPLIERS.RIVER_BONUS;
        return multiplier;
    });
    const productOfMultipliers = terrainMultipliers.reduce((acc, val) => acc * val, 1);
    const geometricMeanMultiplier = Math.pow(productOfMultipliers, 1 / terrainMultipliers.length);
    const roadMultiplier = config.ROAD_MULTIPLIERS[roadLevel] || 1.0;
    const finalDistance = totalDirectDistance * geometricMeanMultiplier * roadMultiplier;
    return finalDistance;
}

/**
 * ★★★ [新規] パスに沿った荷馬車の移動日数を計算する関数 ★★★
 * @param {Array<object>} path - ヘックスの座標リスト ({x, y})
 * @param {number} roadLevel - 道路のレベル
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @returns {number} 計算された平均移動日数
 */
function calculateTravelDays(path, roadLevel, allHexes) {
    if (path.length < 2) return 0;

    // ★★★ [修正] 1ヘックス進むごとの距離を正しい値に修正 ★★★
    const segmentDistance = config.HEX_SIZE_KM;
    let totalTravelHours = 0;

    // 道路整備による速度乗数を取得
    const roadSpeedMultiplier = config.WAGON_PARAMS.ROAD_SPEED_MULTIPLIERS[roadLevel] || 0.3;

    // パスの各区間（ヘックスから次のヘックスへ）の移動時間を計算して合計する
    for (let i = 0; i < path.length - 1; i++) {
        const currentHex = allHexes[getIndex(path[i].x, path[i].y)];
        const p = currentHex.properties;

        // 地形による速度係数を取得
        let terrainSpeedMultiplier = config.WAGON_PARAMS.TERRAIN_SPEED_MULTIPLIERS[p.terrainType] || 1.0;
        // 平地の場合、植生による係数をさらに考慮
        if (p.terrainType === '平地') {
             if (p.vegetation === '密林') terrainSpeedMultiplier = config.WAGON_PARAMS.TERRAIN_SPEED_MULTIPLIERS.密林;
             else if (p.vegetation === '森林' || p.vegetation === '針葉樹林') terrainSpeedMultiplier = config.WAGON_PARAMS.TERRAIN_SPEED_MULTIPLIERS.森林;
        }

        if (p.hasSnow) {
            terrainSpeedMultiplier *= config.WAGON_PARAMS.SNOW_SPEED_MULTIPLIER;
        }

        // この区間での実効速度を計算
        const effectiveSpeed = config.WAGON_PARAMS.BASE_SPEED_KMH * roadSpeedMultiplier * terrainSpeedMultiplier;

        // この区間を移動するのにかかる時間を加算
        if (effectiveSpeed > 0) {
            totalTravelHours += segmentDistance / effectiveSpeed;
        } else {
            totalTravelHours += Infinity; // 速度0なら時間は無限大
        }
    }

    // 合計時間から日数を計算
    const totalDays = totalTravelHours / config.WAGON_PARAMS.OPERATING_HOURS_PER_DAY;
    return totalDays;
}

/**
 * ★★★ [改修] ⑪～⑬ 下位の道路網を生成し、プログレスバーを表示する ★★★
 * @param {Array<object>} lowerSettlements - 下位の集落リスト
 * @param {Array<object>} upperSettlements - 上位の集落リスト
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @param {string} type - 集落の種類 ('街', '町', '村')
 * @param {Function} addLogMessage - ログ出力用の関数
 */
export async function generateFeederRoads(lowerSettlements, upperSettlements, allHexes, type, addLogMessage) {
    const roadPaths = [];
    const totalCount = lowerSettlements.length;
    if (totalCount === 0 || upperSettlements.length === 0) return roadPaths;

    const roadLevelMap = { '街': 4, '町': 3, '村': 2 };
    const roadLevel = roadLevelMap[type];
    const prefixMap = { '街': '街道:', '町': '町道:', '村': '村道:' };
    const prefix = prefixMap[type] || `${type}道:`;

    // ★★★ [新規] configから最大日数を取得 ★★★
    const maxDays = config.MAX_TRAVEL_DAYS[roadLevel] || Infinity;

    const progressId = `feeder-road-${type}`;
    let processedCount = 0;
    let lastReportedPercent = -1;
    if (addLogMessage) await addLogMessage(`${prefix} 敷設準備...`, progressId);

    for (const lower of lowerSettlements) {
        let bestTarget = null;
        let minCost = Infinity;

        // ★★★ [変更] 自国の上位集落を優先的に探索候補とする ★★★
        const lowerNationId = lower.properties.nationId;
        const targetCandidates = upperSettlements.sort((a, b) => {
            // 自国の集落を優先
            const aIsOwn = a.properties.nationId === lowerNationId;
            const bIsOwn = b.properties.nationId === lowerNationId;
            if (aIsOwn && !bIsOwn) return -1;
            if (!aIsOwn && bIsOwn) return 1;
            // 同じ国なら距離順
            return getDistance(lower, a) - getDistance(lower, b);
        });

        const searchCandidates = targetCandidates.slice(0, 10); // 探索候補を増やす

        // ★★★ [変更] A*のコスト関数に自国領土ボーナスを追加 ★★★
        const costFunc = createCostFunction(allHexes, lowerNationId);
        const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
        const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});
        
        for (const upper of searchCandidates) {
             const result = findAStarPath({ start: { x: lower.col, y: lower.row }, goal: { x: upper.col, y: upper.row }, getNeighbors, heuristic, cost: costFunc });
             if (result && result.cost < minCost) {
                 minCost = result.cost;
                 bestTarget = { path: result.path, superior: upper };
             }
        }
        
        if (bestTarget) {
            // ★★★ [ここから修正] 移動日数を計算し、上限を超えていないかチェック ★★★
            const travelDays = calculateTravelDays(bestTarget.path, roadLevel, allHexes);

            // 移動日数が上限を超えていない場合のみ、道路を敷設し所属を決定
            if (travelDays <= maxDays) {
                const superiorNationId = bestTarget.superior.properties.nationId;
                
                // 1. 下位集落に親のIDと国籍を設定
                lower.properties.parentHexId = getIndex(bestTarget.superior.col, bestTarget.superior.row);
                lower.properties.nationId = superiorNationId;

                // 2. 道のり・日数を計算して設定
                const distance = calculateRoadDistance(bestTarget.path, roadLevel, allHexes);
                lower.properties.distanceToParent = distance;
                lower.properties.travelDaysToParent = travelDays;
                
                // 3. 道路オブジェクトに国籍を設定して追加
                roadPaths.push({ path: bestTarget.path.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: superiorNationId });
                
                // 4. 道路経路上の全ヘックスに国籍を設定
                bestTarget.path.forEach(pos => {
                    const hex = allHexes[getIndex(pos.x, pos.y)];
                    if (hex && hex.properties.nationId === 0 && !hex.properties.isWater) {
                        hex.properties.nationId = superiorNationId;
                    }
                });
            } else {
                // 移動日数が上限を超えた場合、所属をリセットして「辺境」にする
                lower.properties.parentHexId = null;
                lower.properties.nationId = 0; // nationIdを0にすることで辺境扱いとなる
                lower.properties.distanceToParent = null;
                lower.properties.travelDaysToParent = null;
            }
        }
        
        processedCount++;
        if (addLogMessage) {
            const percent = Math.floor((processedCount / totalCount) * 100);
            if (percent > lastReportedPercent) {
                const message = formatProgressBar({ current: processedCount, total: totalCount, prefix: prefix });
                await addLogMessage(message, progressId);
                lastReportedPercent = percent;
            }
        }
    }

    if (addLogMessage) {
        await addLogMessage(`${prefix} 敷設完了。全 ${roadPaths.length} 経路を建設しました。`, progressId);
    }
    
    return roadPaths;
}