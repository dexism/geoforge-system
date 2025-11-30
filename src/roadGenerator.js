// ================================================================
// GeoForge System - 街道生成モジュール (v18.1 - 階層生成バグ修正)
// ================================================================
import * as config from './config.js';
import { getIndex, getDistance, formatProgressBar } from './utils.js';
import * as d3 from 'd3';

// createCostFunction 
const createCostFunction = (allHexes, ownerNationId) => (nodeA, nodeB) => {
    const hexA = allHexes[getIndex(nodeA.x, nodeA.y)];
    const hexB = allHexes[getIndex(nodeB.x, nodeB.y)];
    const pB = hexB.properties;

    if (pB.isWater) return Infinity;

    // 全ての既存道路のコストをレベルに応じて下げる
    if (pB.roadLevel && pB.roadLevel > 0) {
        // 道路レベルが高いほどコストが低くなるように設定
        // レベル6 (交易路): 0.2
        // レベル5 (交易路): 0.333
        // レベル4 (街道):   0.466
        // レベル3 (町道):   0.6
        // レベル2 (村道):   0.733
        const roadCost = 1.0 - (pB.roadLevel / 6) * 0.8; // 簡易的な計算式
        return roadCost;
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
 * 各首都間を結ぶ「通商路」を生成する関数
 * @param {Array<object>} capitals - 首都のリスト
 * @param {Array<object>} allHexes - 全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用関数
 * @returns {Array<object>} - 生成された通商路の経路データ
 */
export async function generateMainTradeRoutes(capitals, allHexes, addLogMessage) {
    if (capitals.length < 2) return [];

    await addLogMessage("国家間の主要幹線（通商路）を探索しています...");
    const mainRoutes = [];

    // この時点では既存の道路はないため、国籍ボーナスなしのコスト関数を使用
    const costFunc = createCostFunction(allHexes, null);
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({ col: nodeA.x, row: nodeA.y }, { col: nodeB.x, row: nodeB.y });

    // 全ての首都のペアに対してA*探索を実行
    for (let i = 0; i < capitals.length; i++) {
        for (let j = i + 1; j < capitals.length; j++) {
            const capital1 = capitals[i];
            const capital2 = capitals[j];
            const result = findAStarPath({
                start: { x: capital1.col, y: capital1.row },
                goal: { x: capital2.col, y: capital2.row },
                getNeighbors,
                heuristic,
                cost: costFunc
            });

            if (result) {
                // 通商路は特定の国に所属しない（中立）ため、nationId は 0 とする
                mainRoutes.push({
                    path: result.path,
                    level: 6, // 道路レベル6を通商路とする
                    nationId: 0
                });
            }
        }
    }

    return mainRoutes;
}

/**
 * 全ての都市間に交易路を敷設し、移動日数も計算する
 */
export async function generateTradeRoutes(cities, allHexes, addLogMessage) {
    const roadPaths = [];
    const routeData = [];
    if (cities.length < 2) return { roadPaths, routeData };

    const progressId = 'trade-route-progress';
    await addLogMessage(`交易路の経路探索...`, progressId);

    const costFunc = createCostFunction(allHexes, null);
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({ col: nodeA.x, row: nodeA.y }, { col: nodeB.x, row: nodeB.y });

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

    await addLogMessage(`交易路：探索完了。全 ${allEdges.length} 経路を発見しました。`);

    // MSTは使わず、全ての経路を返す
    allEdges.forEach(edge => {
        const pathNodes = edge.path.map(p => ({ x: p.x, y: p.y }));
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
 * ⑪～⑬ 下位の道路網を生成する (孤立集落の所属決定ロジック追加版 - 完全・修正済版)
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
    if (lowerSettlements.length === 0) return roadPaths;

    const prefixMap = { '街': '街道:', '町': '町道:', '村': '村道:' };
    const prefix = prefixMap[type] || `${type}道:`;
    const progressId = `feeder-road-scan-${type}`;
    await addLogMessage(`${type}道：主要な接続を探索中...`, progressId);

    // --- カウンター変数を正しく宣言 ---
    let processedCount = 0;
    const totalCount = lowerSettlements.length;
    let lastReportedPercent = -1;

    const costFunc = createCostFunction(allHexes, null);
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({ col: nodeA.x, row: nodeA.y }, { col: nodeB.x, row: nodeB.y });

    const unprocessedSettlements = [];

    // --- フェーズ1 & 2: 通常の最短経路接続 ---
    for (const lower of lowerSettlements) {
        let bestRoute = null;
        let minTravelDays = Infinity;

        if (upperSettlements && upperSettlements.length > 0) {
            const sortedUppers = [...upperSettlements].sort((a, b) => getDistance(lower, a) - getDistance(lower, b));
            const targetCandidates = sortedUppers.slice(0, 7);
            for (const upper of targetCandidates) {
                const result = findAStarPath({
                    start: { x: lower.col, y: lower.row },
                    goal: { x: upper.col, y: upper.row },
                    getNeighbors, heuristic, cost: costFunc
                });
                if (result) {
                    const travelDays = calculateTravelDays(result.path, roadLevel, allHexes);
                    if (travelDays < (config.MAX_TRAVEL_DAYS[roadLevel] || Infinity) && travelDays < minTravelDays) {
                        minTravelDays = travelDays;
                        bestRoute = { from: lower, to: upper, path: result.path, travelDays: travelDays };
                    }
                }
            }
        }

        if (bestRoute) {
            const fromHex = bestRoute.from;
            const toHex = bestRoute.to;
            const newNationId = toHex.properties.nationId;
            fromHex.properties.nationId = newNationId;
            fromHex.properties.parentHexId = getIndex(toHex.col, toHex.row);
            fromHex.properties.distanceToParent = calculateRoadDistance(bestRoute.path, roadLevel, allHexes);
            fromHex.properties.travelDaysToParent = bestRoute.travelDays;
            bestRoute.path.forEach(pos => {
                const hex = allHexes[getIndex(pos.x, pos.y)];
                if (hex && !hex.properties.isWater) {
                    if (hex.properties.nationId === 0) { hex.properties.nationId = newNationId; }
                    if (!hex.properties.roadLevel || hex.properties.roadLevel < roadLevel) { hex.properties.roadLevel = roadLevel; }
                }
            });
            roadPaths.push({ path: bestRoute.path.map(p => ({ x: p.x, y: p.y })), level: roadLevel, nationId: newNationId });
        } else {
            unprocessedSettlements.push(lower);
        }

        // --- プログレスバー更新処理 ---
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

    // --- フェーズ3: 孤立集落の所属決定 ---
    if (unprocessedSettlements.length > 0) {
        await addLogMessage(`${type}：孤立集落の所属を決定中...`);
        const activityRangeHexes = 30 / config.HEX_SIZE_KM;

        for (const lower of unprocessedSettlements) {
            let nearestCivilization = null;
            let minDistance = Infinity;

            // 孤立集落の所属先を探すためのループ
            for (let i = 0; i < allHexes.length; i++) {
                const targetHex = allHexes[i];
                const p = targetHex.properties;
                if ((p.settlement || p.roadLevel > 0) && p.territoryId !== null) {
                    const dist = getDistance(lower, targetHex);
                    if (dist < activityRangeHexes && dist < minDistance) {
                        minDistance = dist;
                        nearestCivilization = targetHex;
                    }
                }
            }

            if (!nearestCivilization) continue;

            let hub = allHexes[nearestCivilization.properties.territoryId];
            if (!hub) continue;

            const p_nearest = nearestCivilization.properties;
            let finalHub = hub;

            if (p_nearest.settlement && p_nearest.settlement === lower.properties.settlement) {
                if (allHexes[p_nearest.parentHexId]) {
                    finalHub = allHexes[p_nearest.parentHexId];
                }
            }

            const finalNationId = finalHub.properties.nationId;
            const finalHubIndex = getIndex(finalHub.col, finalHub.row);

            if (nearestCivilization) {
                const result = findAStarPath({
                    start: { x: lower.col, y: lower.row },
                    goal: { x: nearestCivilization.col, y: nearestCivilization.row },
                    getNeighbors, heuristic, cost: costFunc
                });

                if (result) {
                    lower.properties.nationId = finalNationId;
                    lower.properties.parentHexId = finalHubIndex;
                    const newPath = result.path;
                    newPath.forEach(pos => {
                        const hex = allHexes[getIndex(pos.x, pos.y)];
                        if (hex && !hex.properties.isWater) {
                            if (hex.properties.nationId === 0) hex.properties.nationId = finalNationId;
                            if (!hex.properties.roadLevel || hex.properties.roadLevel < roadLevel) hex.properties.roadLevel = roadLevel;
                        }
                    });
                    roadPaths.push({ path: newPath.map(p => ({ x: p.x, y: p.y })), level: roadLevel, nationId: finalNationId });
                }
            }
        }
    }

    return roadPaths;
}

/**
 * 海上航路用のA*コスト関数を生成する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @param {object} ship - 使用する船のスペック (SHIP_TYPESのオブジェクト)
 * @returns {Function} A*アルゴリズムで使うコスト関数
 */
function createSeaCostFunction(allHexes, ship) {
    // 事前に海岸からの距離を計算しておく
    const distanceToCoast = new Map();
    const queue = allHexes.filter(h => h.properties.isWater && h.neighbors.some(n => !allHexes[n].properties.isWater));
    queue.forEach(h => distanceToCoast.set(getIndex(h.col, h.row), 1));
    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        const dist = distanceToCoast.get(getIndex(current.col, current.row));
        current.neighbors.forEach(nIdx => {
            if (allHexes[nIdx].properties.isWater && !distanceToCoast.has(nIdx)) {
                distanceToCoast.set(nIdx, dist + 1);
                queue.push(allHexes[nIdx]);
            }
        });
    }

    return (nodeA, nodeB) => {
        const hexB = allHexes[getIndex(nodeB.x, nodeB.y)];
        const pB = hexB.properties;

        // 陸地は通行不可
        if (!pB.isWater) return Infinity;

        // 船が航行するには浅すぎる海域は通行不可
        if (Math.abs(pB.elevation) < config.PORT_PARAMS.MIN_NAVIGATION_DEPTH[Object.keys(config.SHIP_TYPES).find(key => config.SHIP_TYPES[key] === ship)]) {
            return Infinity;
        }

        // 船の離岸可能距離を超えている場合は通行不可
        const dist = distanceToCoast.get(getIndex(nodeB.x, nodeB.y)) || 0;
        if (dist * config.HEX_SIZE_KM > ship.max_offshore_km) {
            return Infinity;
        }

        let cost = 1;

        // 海の魔物ランクによるコスト増
        switch (pB.monsterRank) {
            case 'S': cost *= 100; break;
            case 'A': cost *= 10; break;
            case 'B': cost *= 3; break;
        }

        return cost;
    };
}

/**
 * 航路を生成するメイン関数 (海域グルーping、接続ロジック修正、プログレスバー対応)
 * @param {Array<object>} allHexes - 全ヘックスデータ
 * @param {Function} addLogMessage - ログ関数
 * @returns {Array<object>} - 生成された航路データの配列
 */
export async function generateSeaRoutes(allHexes, addLogMessage) {
    await addLogMessage("海域を特定し、航路の探索準備をしています...");

    // ================================================================
    // STEP 1: 海域のグルーピング
    // 陸地で分断された海を別々のグループとして認識する
    // ================================================================
    const seaGroupId = new Map(); // 各ヘックスがどの海のグループに属するかを記録
    let currentGroupId = 0;

    // 湖沼（標高 > 0）を除いた、標高0以下の「海」ヘックスのみを対象とする
    const oceanHexes = allHexes.filter(h => h.properties.isWater && h.properties.elevation <= 0);

    for (const startHex of oceanHexes) {
        const startIndex = getIndex(startHex.col, startHex.row);
        if (seaGroupId.has(startIndex)) continue; // 既にグループ分け済みならスキップ

        currentGroupId++;
        const queue = [startHex];
        seaGroupId.set(startIndex, currentGroupId);
        let head = 0;

        // 幅優先探索（BFS）で、繋がっている海ヘックスをすべて同じグループIDで塗りつぶす
        while (head < queue.length) {
            const current = queue[head++];
            current.neighbors.forEach(nIdx => {
                const neighbor = allHexes[nIdx];
                if (neighbor.properties.isWater && neighbor.properties.elevation <= 0 && !seaGroupId.has(nIdx)) {
                    seaGroupId.set(nIdx, currentGroupId);
                    queue.push(neighbor);
                }
            });
        }
    }

    // ================================================================
    // STEP 2: 港湾都市の特定と、所属グループの紐付け
    // ================================================================
    const portCities = allHexes.filter(h => {
        const p = h.properties;
        return ['町', '街', '領都', '都市', '首都'].includes(p.settlement) &&
            h.neighbors.some(nIdx => seaGroupId.has(nIdx)); // グループ分けされた海に隣接している港のみ
    });

    if (portCities.length < 2) {
        await addLogMessage("航路を探索できる港が2つ未満のため、処理をスキップします。");
        return [];
    }

    // 各港に、隣接する海のグループIDをプロパティとして追加
    portCities.forEach(port => {
        const neighborSeaIndex = port.neighbors.find(nIdx => seaGroupId.has(nIdx));
        port.seaGroupId = seaGroupId.get(neighborSeaIndex);
    });

    // ================================================================
    // STEP 3: グループごとに航路を探索
    // ================================================================
    const progressId = 'sea-route-progress';
    await addLogMessage(`航路の経路探索...`, progressId);

    const seaRoutes = [];
    const getNeighbors = node => allHexes[getIndex(node.x, node.y)].neighbors.map(i => allHexes[i]).map(h => ({ x: h.col, y: h.row }));
    const heuristic = (nodeA, nodeB) => getDistance({ col: nodeA.x, row: nodeA.y }, { col: nodeB.x, row: nodeB.y });

    // プログレスバー用に、探索するペアの総数を事前に計算
    let totalPairs = 0;
    for (let gid = 1; gid <= currentGroupId; gid++) {
        const groupPorts = portCities.filter(p => p.seaGroupId === gid);
        if (groupPorts.length >= 2) {
            totalPairs += (groupPorts.length * (groupPorts.length - 1)) / 2;
        }
    }
    let processedPairs = 0;
    let lastReportedPercent = -1;

    // 海域グループごとにループ
    for (let gid = 1; gid <= currentGroupId; gid++) {
        const groupPorts = portCities.filter(p => p.seaGroupId === gid);
        if (groupPorts.length < 2) continue;

        // 同じグループに属する港の間でのみ、ペアを作って探索
        for (let i = 0; i < groupPorts.length; i++) {
            for (let j = i + 1; j < groupPorts.length; j++) {
                const startPort = groupPorts[i];
                const endPort = groupPorts[j];

                // --- 探索の始点・終点を、港町自身ではなく「隣接する海ヘックス」に設定 ---
                const startSeaHex = allHexes[startPort.neighbors.find(nIdx => seaGroupId.has(nIdx))];
                const endSeaHex = allHexes[endPort.neighbors.find(nIdx => seaGroupId.has(nIdx))];
                if (!startSeaHex || !endSeaHex) {
                    processedPairs++;
                    continue;
                }

                // --- 船の選定 ---
                const startShipKeys = config.SHIP_AVAILABILITY[startPort.properties.settlement] || [];
                const endShipKeys = config.SHIP_AVAILABILITY[endPort.properties.settlement] || [];
                const availableShipKeys = startShipKeys.filter(key => endShipKeys.includes(key));
                if (availableShipKeys.length === 0) {
                    processedPairs++;
                    continue;
                }
                const bestShipKey = availableShipKeys[availableShipKeys.length - 1];
                const bestShip = config.SHIP_TYPES[bestShipKey];

                const seaCostFunc = createSeaCostFunction(allHexes, bestShip);

                // --- A*探索の実行 ---
                const result = findAStarPath({
                    start: { x: startSeaHex.col, y: startSeaHex.row },
                    goal: { x: endSeaHex.col, y: endSeaHex.row },
                    getNeighbors, heuristic, cost: seaCostFunc
                });

                if (result) {
                    // --- 航路パスを再構築し、フィルタリング ---
                    // パスの前後に港町自身を追加して、UIが扱いやすい完全な経路にする
                    const finalPath = [
                        { x: startPort.col, y: startPort.row },
                        ...result.path,
                        { x: endPort.col, y: endPort.row }
                    ];
                    const routeDistanceKm = finalPath.length * config.HEX_SIZE_KM;

                    if (routeDistanceKm <= bestShip.range_km) {
                        const endPortNeighborDepths = endPort.neighbors.map(nIdx => allHexes[nIdx].properties.elevation).filter(elev => elev < 0);
                        const maxEndPortDepth = Math.abs(Math.min(0, ...endPortNeighborDepths));
                        if (maxEndPortDepth >= config.PORT_PARAMS.MIN_NAVIGATION_DEPTH[bestShipKey]) {
                            seaRoutes.push({ path: finalPath, level: 10, shipKey: bestShipKey });
                        }
                    }
                }

                // --- プログレスバー更新 ---
                processedPairs++;
                if (totalPairs > 0) {
                    const percent = Math.floor((processedPairs / totalPairs) * 100);
                    if (percent > lastReportedPercent) {
                        const message = formatProgressBar({ current: processedPairs, total: totalPairs, prefix: "航路探索:" });
                        await addLogMessage(message, progressId);
                        lastReportedPercent = percent;
                    }
                }
            }
        }
    }

    await addLogMessage(`航路を${seaRoutes.length}本発見しました。`);
    return seaRoutes;
}

export { calculateRoadDistance, calculateTravelDays };

/**
 * A* Pathfinding Algorithm
 * @param {object} params
 * @param {object} params.start - Start node {x, y}
 * @param {object} params.goal - Goal node {x, y}
 * @param {function} params.getNeighbors - Function(node) returning array of neighbor nodes
 * @param {function} params.heuristic - Function(nodeA, nodeB) returning estimated cost
 * @param {function} params.cost - Function(nodeA, nodeB) returning actual cost
 * @returns {object|null} - { path: Array<node>, cost: number } or null if not found
 */
export function findAStarPath({ start, goal, getNeighbors, heuristic, cost }) {
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