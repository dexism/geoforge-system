// ================================================================
// GeoForge System - 街道生成モジュール (v18.1 - 階層生成バグ修正)
// ================================================================
import * as config from './config.js';
import { getIndex, getDistance, formatProgressBar } from './utils.js';
import * as d3 from 'd3';

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

    // ★★★ [新規] 既存の交易路上はコストを大幅に下げる ★★★
    // hexに roadLevel プロパティを追加しておく必要がある（後述）
    if (pB.roadLevel === 5) {
        return 0.2; // 通常のコストよりはるかに低い固定値を返す
    }

    let cost = 1;
    // 河川コスト
    cost += pB.flow > 2 ? pB.flow * 3 : 0;
    // 植生コスト
    if (pB.vegetation === '森林' || pB.vegetation === '疎林') cost += 2;
    if (pB.vegetation === '密林' || pB.vegetation === '針葉樹林') cost += 4;
    // 標高コスト
    if (pB.elevation > 1000) cost += Math.pow(pB.elevation / 700, 2.8);

    // 稜線を横断する際の追加コスト
    // ridgeFlow（稜線の太さ）が大きいほど、コストが指数関数的に増加する
    if (pB.ridgeFlow > 0) {
        cost += pB.ridgeFlow * config.RIDGE_CROSSING_COST_MULTIPLIER;
    }
    
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
 * ★★★ [改訂] 全ての都市間に交易路を敷設し、移動日数も計算する ★★★
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
                // 手順2-1: 移動日数を計算して記憶
                const travelDays = calculateTravelDays(result.path, 5, allHexes);
                allEdges.push({ 
                    from: city1, to: city2, 
                    fromId: getIndex(city1.col, city1.row), toId: getIndex(city2.col, city2.row),
                    path: result.path, cost: result.cost, travelDays: travelDays 
                });
            }
            processedPairs++;
            const percent = Math.floor((processedPairs / totalPairs) * 100);
            if (percent > lastReportedPercent) {
                 // 汎用関数を呼び出す
                 const message = formatProgressBar({ current: processedPairs, total: totalPairs, prefix: "交易路:" });
                 await addLogMessage(message, progressId);
                 lastReportedPercent = percent;
            }
        }
    }

    await addLogMessage(`交易路: 探索完了。全 ${allEdges.length} 経路を発見しました。`, progressId);

    // MSTは使わず、全ての経路を返す
    allEdges.forEach(edge => {
        const pathNodes = edge.path.map(p => ({x: p.x, y: p.y}));
        roadPaths.push({ path: pathNodes, level: 5, nationId: 0 }); // この時点では国籍は未定
    });
    
    return { roadPaths, routeData: allEdges };
}

// 辺の中点を返すヘルパー関数 (ui.jsから移植)
function getSharedEdgeMidpoint(hex1, hex2, hexWidth, hexHeight) {
    if (!hex1 || !hex2) return null;

    const getPoints = (h) => {
        const offsetY = (h.col % 2 === 0) ? 0 : hexHeight / 2;
        const cx = h.col * (hexWidth * 3 / 4) + config.r;
        const cy = h.row * hexHeight + offsetY + config.r;
        return d3.range(6).map(i => [cx + config.r * Math.cos(Math.PI / 3 * i), cy + config.r * Math.sin(Math.PI / 3 * i)]);
    };

    const points1 = getPoints(hex1);
    const points2 = getPoints(hex2);
    
    const commonPoints = [];
    for (const p1 of points1) {
        for (const p2 of points2) {
            if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) {
                commonPoints.push(p1);
            }
        }
    }
    if (commonPoints.length === 2) {
        return [(commonPoints[0][0] + commonPoints[1][0]) / 2, (commonPoints[0][1] + commonPoints[1][1]) / 2];
    }
    return null;
}

/**
 * パスに沿った道のりを計算する関数
 * @param {Array<object>} path - ヘックスの座標リスト ({x, y})
 * @param {number} roadLevel - 道路のレベル (5:交易路, 4:街道, etc.)
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @returns {number} 計算された道のり (km)
 */
function calculateRoadDistance(path, roadLevel, allHexes) {
    if (path.length < 2) return 0;
        
    // ヘックスの描画サイズを計算
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;
    
    // ピクセル距離をkmに変換するスケール
    // ヘックスの高さ(config.r * sqrt(3))がHEX_SIZE_KMに対応する
    const pixelToKm = config.HEX_SIZE_KM / hexHeight;

    let totalDistanceKm = 0;

    const pathHexes = path.map(p => allHexes[getIndex(p.x, p.y)]);

    for (let i = 0; i < pathHexes.length; i++) {
        const currentHex = pathHexes[i];
        if (!currentHex) continue;

        // セグメントの始点と終点を決定
        let startPoint, endPoint;

        // 始点の決定
        if (i === 0) {
            // パスの始点：最初のヘックスの中心
            const offsetY = (currentHex.col % 2 === 0) ? 0 : hexHeight / 2;
            startPoint = [
                currentHex.col * (hexWidth * 3 / 4) + config.r,
                currentHex.row * hexHeight + offsetY + config.r
            ];
        } else {
            // パスの途中：前のヘックスとの境界の中点
            startPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i - 1], hexWidth, hexHeight);
        }

        // 終点の決定
        if (i === pathHexes.length - 1) {
            // パスの終点：最後のヘックスの中心
            const offsetY = (currentHex.col % 2 === 0) ? 0 : hexHeight / 2;
            endPoint = [
                currentHex.col * (hexWidth * 3 / 4) + config.r,
                currentHex.row * hexHeight + offsetY + config.r
            ];
        } else {
            // パスの途中：次のヘックスとの境界の中点
            endPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i + 1], hexWidth, hexHeight);
        }

        if (!startPoint || !endPoint) continue;

        // このセグメントのピクセル単位での直線距離を計算
        const segmentPixelDistance = Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]);
        
        // 地形乗数を取得
        const p = currentHex.properties;
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

        // セグメントの道のりを計算し、合計に加算
        totalDistanceKm += (segmentPixelDistance * pixelToKm) * multiplier;
    }

    const roadMultiplier = config.ROAD_MULTIPLIERS[roadLevel] || 1.0;
    return totalDistanceKm * roadMultiplier;
}

/**
 * パスに沿った荷馬車の移動日数を計算する関数
 * @param {Array<object>} path - ヘックスの座標リスト ({x, y})
 * @param {number} roadLevel - 道路のレベル
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @returns {number} 計算された平均移動日数
 */
function calculateTravelDays(path, roadLevel, allHexes) {
    if (path.length < 2) return 0;

    // 1ヘックス進むごとの距離を正しい値に修正
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
 * ⑪～⑬ 下位の道路網を生成し、プログレスバーを表示する
 * @param {Array<object>} lowerSettlements - 下位の集落リスト
 * @param {Array<object>} upperSettlements - 上位の集落リスト
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @param {string} type - 集落の種類 ('街', '町', '村')
 * @param {Function} addLogMessage - ログ出力用の関数
 */
export async function generateFeederRoads(lowerSettlements, upperSettlements, allHexes, type, addLogMessage) {
    const roadLevelMap = { '街': 4, '町': 3, '村': 2 };
    const roadLevel = roadLevelMap[type];
    const roadPaths = [];
    if (lowerSettlements.length === 0 || upperSettlements.length === 0) return roadPaths;

    const prefixMap = { '街': '街道:', '町': '町道:', '村': '村道:' };
    const prefix = prefixMap[type] || `${type}道:`;

    const potentialRoutes = []; // 未所属集落の接続候補を格納する配列
    const processedLower = new Set(); // 接続が確定した下位集落を管理

    // --- フェーズ1: 接続候補の経路を、最適化しながら探索 ---
    const progressId = `feeder-road-scan-${type}`;
    await addLogMessage(`[${type}] 接続候補経路を探索中...`, progressId);
    let processedCount = 0;
    const totalCount = lowerSettlements.length;
    let lastReportedPercent = -1;

    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});

    for (const lower of lowerSettlements) {
        // --- [最適化1] 仕様3-1: 既に国土内の集落を優先処理 ---
        if (lower.properties.nationId > 0) {
            const sameNationUppers = upperSettlements.filter(u => u.properties.nationId === lower.properties.nationId);
            
            let closestUpper = null;
            let minDistance = Infinity;

            if (sameNationUppers.length > 0) {
                sameNationUppers.forEach(upper => {
                    const dist = getDistance(lower, upper);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestUpper = upper;
                    }
                });
            }

            // 最寄りの自国上位集落への経路を確定ルートとして敷設
            if (closestUpper) { // これで安全にチェックできる
                const costFunc = createCostFunction(allHexes, lower.properties.nationId);
                const result = findAStarPath({ start: { x: lower.col, y: lower.row }, goal: { x: closestUpper.col, y: closestUpper.row }, getNeighbors, heuristic, cost: costFunc });
                
                if (result) {
                    const distance = calculateRoadDistance(result.path, roadLevel, allHexes);
                    const travelDays = calculateTravelDays(result.path, roadLevel, allHexes);
                    lower.properties.distanceToParent = distance;
                    lower.properties.travelDaysToParent = travelDays;

                    roadPaths.push({ path: result.path.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: lower.properties.nationId });
                    lower.properties.parentHexId = getIndex(closestUpper.col, closestUpper.row);
                    processedLower.add(getIndex(lower.col, lower.row));
                }
            }
        } 
        // --- [最適化2] 仕様3-3: 未所属の集落は、近い上位集落に探索を限定 ---
        // まだ国籍が決まっていない集落の場合、全ての候補ではなく、近傍の候補に絞って探索する。
        else {
            // ----------------------------------------------------------------
            // STEP 1: 探索候補の絞り込み
            // ----------------------------------------------------------------
            // 全ての上位集落を、この下位集落(`lower`)からの直線距離が近い順に並び替える。
            const sortedUppers = [...upperSettlements].sort((a, b) => getDistance(lower, a) - getDistance(lower, b));
            
            // 探索対象を、最も近い上位7つに限定する。
            // これにより、例えば上位集落が20個あっても、7回しかA*探索を行わないため、
            // 計算量を大幅に削減できる。
            const targetCandidates = sortedUppers.slice(0, 7);

            // ----------------------------------------------------------------
            // STEP 2: 限定された候補への経路探索
            // ----------------------------------------------------------------
            // この時点ではどの国に所属するか不明なため、国籍ボーナスなしのコスト関数を使用する。
            const costFunc = createCostFunction(allHexes, null);
            
            // 限定された7つの候補に対してのみ、A*アルゴリズムで経路探索を実行する。
            for (const upper of targetCandidates) {
                const result = findAStarPath({ 
                    start: { x: lower.col, y: lower.row }, 
                    goal: { x: upper.col, y: upper.row }, 
                    getNeighbors, // ループの外で定義された共通関数
                    heuristic,    // ループの外で定義された共通関数
                    cost: costFunc 
                });

                // 経路が見つかった場合、移動日数を計算し、候補リスト(`potentialRoutes`)に追加する。
                if (result) {
                    const travelDays = calculateTravelDays(result.path, roadLevel, allHexes);
                    potentialRoutes.push({ 
                        from: lower, 
                        to: upper, 
                        path: result.path, 
                        travelDays: travelDays 
                    });
                }
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

    // --- フェーズ2: 候補の中から、移動日数が少なく衝突のないルートを確定 ---
    await addLogMessage(`[${type}] 最適な道路を敷設中...`);
    potentialRoutes.sort((a, b) => a.travelDays - b.travelDays); // 仕様3-5: 移動日数が少ない順にソート
    
    for (const route of potentialRoutes) {
        const lowerIndex = getIndex(route.from.col, route.from.row);
        if (processedLower.has(lowerIndex)) continue; // 既に所属が確定した集落はスキップ

        const targetNationId = route.to.properties.nationId;
        if (targetNationId === 0) continue;

        let hasConflict = false; // 仕様3-6
        for (const pos of route.path) {
            const hexNationId = allHexes[getIndex(pos.x, pos.y)].properties.nationId;
            if (hexNationId !== 0 && hexNationId !== targetNationId) {
                hasConflict = true;
                break;
            }
        }
        
        if (!hasConflict) { // 仕様3-7
            const nationId = route.to.properties.nationId;
            route.from.properties.nationId = nationId;
            route.from.properties.parentHexId = getIndex(route.to.col, route.to.row);

            const distance = calculateRoadDistance(route.path, roadLevel, allHexes);
            // travelDays は既に計算済みなので再利用
            route.from.properties.distanceToParent = distance;
            route.from.properties.travelDaysToParent = route.travelDays;
            
            route.path.forEach(pos => {
                const hex = allHexes[getIndex(pos.x, pos.y)];
                if (hex && hex.properties.nationId === 0) {
                    hex.properties.nationId = nationId;
                }
            });
            
            roadPaths.push({ path: route.path.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: nationId });
            processedLower.add(lowerIndex);
        }
    }

    // --- フェーズ3:最後まで国籍が決まらなかった辺境集落の処理 (仕様3-9) ---
    const remainingLower = lowerSettlements.filter(l => !processedLower.has(getIndex(l.col, l.row)));
    if (remainingLower.length > 0) {
        await addLogMessage(`[${type}] 辺境地域の所属を決定中...`);
        
        remainingLower.forEach(lower => {
            // この集落からの全仮経路の中から、最も日数が少ないものを探す
            const ownRoutes = potentialRoutes.filter(r => getIndex(r.from.col, r.from.row) === getIndex(lower.col, lower.row));
            if (ownRoutes.length === 0) return;
            
            const bestRoute = ownRoutes[0]; // ソート済みなので先頭が最短
            
            // 手順3-9: 経路をたどり、最初に衝突する他国領土を探す
            let connectionPoint = null;
            let connectionNationId = 0;
            let pathToConnection = [];

            for(const pos of bestRoute.path) {
                pathToConnection.push(pos);
                const hexNationId = allHexes[getIndex(pos.x, pos.y)].properties.nationId;
                if (hexNationId !== 0) {
                    connectionPoint = allHexes[getIndex(pos.x, pos.y)];
                    connectionNationId = hexNationId;
                    break;
                }
            }

            if (connectionPoint) {
                // 衝突点までの道路を敷設し、その国籍とする
                lower.properties.nationId = connectionNationId;
                pathToConnection.forEach(pos => {
                    const hex = allHexes[getIndex(pos.x, pos.y)];
                    if (hex) hex.properties.nationId = connectionNationId;
                });
                roadPaths.push({ path: pathToConnection.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: connectionNationId });

                // そこから一番近い「同じ国籍の」上位集落まで道を敷設する
                const sameNationUppers = upperSettlements.filter(u => u.properties.nationId === connectionNationId);
                if (sameNationUppers.length > 0) {
                    // (この部分は簡略化のため、最も近い上位集落へ単純に接続します)
                    let closestUpper = null;
                    let minDistance = Infinity;
                    sameNationUppers.forEach(upper => {
                        const dist = getDistance(connectionPoint, upper);
                        if(dist < minDistance) {
                            minDistance = dist;
                            closestUpper = upper;
                        }
                    });
                    
                    if(closestUpper) {
                        const costFunc = createCostFunction(allHexes, connectionNationId);
                        const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
                        const heuristic = (nodeA, nodeB) => getDistance({col: nodeA.x, row: nodeA.y}, {col: nodeB.x, row: nodeB.y});
                        const result = findAStarPath({ start: { x: connectionPoint.col, y: connectionPoint.row }, goal: { x: closestUpper.col, y: closestUpper.row }, getNeighbors, heuristic, cost: costFunc });
                        if(result) {
                            // ★★★ [ここから修正] 距離と日数を計算・保存 ★★★
                            // 辺境集落から最終的な親までの完全な経路
                            const fullPath = [...pathToConnection, ...result.path.slice(1)];
                            const distance = calculateRoadDistance(fullPath, roadLevel, allHexes);
                            const travelDays = calculateTravelDays(fullPath, roadLevel, allHexes);
                            lower.properties.distanceToParent = distance;
                            lower.properties.travelDaysToParent = travelDays;
                            // ★★★ [修正ここまで] ★★★

                            result.path.forEach(pos => allHexes[getIndex(pos.x, pos.y)].properties.nationId = connectionNationId);
                            roadPaths.push({ path: result.path.map(p => ({x: p.x, y: p.y})), level: roadLevel, nationId: connectionNationId });
                            lower.properties.parentHexId = getIndex(closestUpper.col, closestUpper.row);
                        }
                    }
                }
            }
        });
    }

    return roadPaths;
}

export { calculateRoadDistance, calculateTravelDays };