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

function generatePopulation(allHexes) {
    let maxHabitability = 0;

    // --- ステップ1: 全ヘックスの居住適性スコアを計算し、最大値を取得 ---
    allHexes.forEach(h => {
        const p = h.properties;
        let score = 0;

        // いったん全ての陸地でスコアを計算する
        if (!p.isWater) {
            score += p.agriPotential * 30;
            score += p.fishingPotential * 20;
            const idealTemp = 10.0;
            score += Math.max(0, 1 - Math.abs(p.temperature - idealTemp) / 15) * 15;
            
            const idealPrecip = config.PRECIPITATION_PARAMS.DRYNESS_FARMING_THRESHOLD;
            const precipScore = Math.max(0, 1 - Math.abs(p.precipitation_mm - idealPrecip) / 800) * 10;
            score += precipScore;
            
            score += p.manaValue * 10;
            score += p.miningPotential * 5;
            score += p.forestPotential * 5;

            // 特定の植生タイプに対して厳しいペナルティを課す
            // スコアを乗算で減らすことで、元のスコアが高いほどペナルティの影響が大きくなる
            switch (p.vegetation) {
                case '高山':
                    // 非常に厳しいペナルティ (元のスコアの10%に)
                    score *= 0.1; 
                    break;
                case '砂漠':
                    // 厳しいペナルティ (元のスコアの20%に)
                    score *= 0.2;
                    break;
                case '湿地':
                    // 中程度のペナルティ (元のスコアの40%に)
                    score *= 0.4;
                    break;
            }
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
                const effectiveHabitability = (normalizedHabitability - config.POPULATION_PARAMS.HABITABILITY_THRESHOLD) / (1.0 - config.POPULATION_PARAMS.HABITABILITY_THRESHOLD);
                const populationFactor = Math.pow(effectiveHabitability, config.POPULATION_PARAMS.POPULATION_CURVE);
                const calculatedPopulation = Math.floor(populationFactor * config.POPULATION_PARAMS.MAX_POPULATION_PER_HEX);
                
                // 10人以下のヘックスは人口0とする
                if (calculatedPopulation <= 10) {
                    p.population = 0;
                } else {
                    p.population = calculatedPopulation;
                }

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
 * 指定された数の首都を定義する関数
 * K-Meansは使用せず、地理的バランスと人口に基づいて首都を選定する。
 * @param {Array<object>} allCities - 全ての「都市」ランクの集落リスト
 * @param {number} numNations - 生成する国家の数
 * @returns {object} - capitals: 首都オブジェクトの配列
 */
function defineNations(allCities, numNations) {
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
    
    const capitals = capitalCandidates.slice(0, numNations);

    // 3. 首都を正式に定義
    capitals.forEach((capital, index) => {
        const nationId = index + 1;
        capital.properties.nationId = nationId;
        capital.properties.settlement = '首都';
    });

    return { capitals };
}

/**
 * 交易路の移動日数に基づき、首都の初期領土（領都）を割り当てる関数
 * @param {Array<object>} allCities - 全ての都市
 * @param {Array<object>} capitals - 首都のリスト
 * @param {Array<object>} tradeRouteData - 全都市間の経路データ
 * @param {Array<object>} allHexes - 全ヘックスデータ
 * @returns {object} - regionalCapitals: 領都になった都市のリスト
 */
function assignTerritoriesByTradeRoutes(allCities, capitals, tradeRouteData, allHexes) {
    const regionalCapitals = [];
    const capitalIds = new Set(capitals.map(c => getIndex(c.col, c.row)));

    allCities.forEach(city => {
        const cityIndex = getIndex(city.col, city.row);
        if (capitalIds.has(cityIndex)) return; // 首都自身はスキップ

        let closestCapital = null;
        let minDays = Infinity;
        let connectingRoute = null;

        capitals.forEach(capital => {
            const capitalIndex = getIndex(capital.col, capital.row);
            const route = tradeRouteData.find(r => 
                (r.fromId === cityIndex && r.toId === capitalIndex) ||
                (r.fromId === capitalIndex && r.toId === cityIndex)
            );
            if (route && route.travelDays < minDays) {
                minDays = route.travelDays;
                closestCapital = capital;
                connectingRoute = route;
            }
        });

        if (closestCapital) {
            // 2-2: 都市を最も近い首都の「領都」とし、国籍を設定
            city.properties.nationId = closestCapital.properties.nationId;
            city.properties.settlement = '領都';
            city.properties.parentHexId = getIndex(closestCapital.col, closestCapital.row);
            regionalCapitals.push(city);

            // 2-2: 使用する交易路上のヘックスも領土とする
            if (connectingRoute) {
                connectingRoute.path.forEach(pos => {
                    const hex = allHexes[getIndex(pos.x, pos.y)];
                    if (hex && hex.properties.nationId === 0) {
                        hex.properties.nationId = closestCapital.properties.nationId;
                    }
                });
            }
        }
    });

    return { regionalCapitals };
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

    // 集落数の集計とログ出力
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

    // configの値をローカル変数にコピーして使用する
    let numNations = config.NUM_NATIONS; 

    if (cities.length < numNations) {
        await addLogMessage(`警告: 都市が${cities.length}個しか形成されませんでした。国家数を${cities.length}に減らします。`);
        numNations = Math.max(1, cities.length); // ローカル変数を更新
    }
    if (numNations === 0) { // ローカル変数で判定
         await addLogMessage("都市が全く生成されなかったため、文明生成を中断します。");
         return { allHexes, roadPaths: [] };
    }

    // 手順1-2: 首都を定義
    await addLogMessage("地理的バランスを考慮して国家を配置しています...");
    const { capitals } = defineNations(cities, numNations);
    await addLogMessage(`世界の${numNations}大国（首都）を定義しました。`);

    await addLogMessage("集落の初期配置が完了しました。");
    // この時点で roadPaths は空で返す
    return { allHexes, roadPaths: [] };
}

export { defineNations, assignTerritoriesByTradeRoutes };

export async function determineTerritories(allHexes, addLogMessage) {
    await addLogMessage("国家の最終的な領土を確定させています...");

    const queue = allHexes.filter(h => h.properties.nationId > 0);
    const visited = new Set(queue.map(h => getIndex(h.col, h.row)));
    let head = 0;

    while (head < queue.length) {
        const currentHex = queue[head++];
        
        // territoryId の設定ロジックは変更なし
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

        // 近隣の「未所属」かつ「人口あり」のヘックスのみを自国領土に広げる
        currentHex.neighbors.forEach(neighborIndex => {
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                const neighborHex = allHexes[neighborIndex];
                
                // 条件を「人口が0より大きく、かつ未所属」に戻す
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

/**
 * 魔物の分布を計算して各ヘックスにランクを割り当てる関数 (海上分布対応版)
 * @param {Array<object>} allHexes - 全てのヘックスデータ
 * @returns {Array<object>} - monsterRankプロパティが追加されたヘックスデータ
 */
export function generateMonsterDistribution(allHexes) {
    // --- STEP 1: 事前準備 ---
    allHexes.forEach(h => h.properties.monsterRank = null);

    const civilizedHexIndexes = new Set();
    allHexes.forEach((h, index) => {
        if (h.properties.population >= 100) {
            civilizedHexIndexes.add(index);
            h.neighbors.forEach(nIndex => civilizedHexIndexes.add(nIndex));
        }
    });

    // 陸地と海域の候補リストを作成
    let landCandidates = allHexes.filter(h => !h.properties.isWater);
    let seaCandidates = allHexes.filter(h => h.properties.isWater);

    // --- STEP 2: 陸上のSランク決定 ---
    const sRankLandCandidates = landCandidates.filter(h => {
        const p = h.properties;
        return p.vegetation === '密林' || p.elevation > 3000;
    });
    sRankLandCandidates.sort((a, b) => b.properties.manaValue - a.properties.manaValue);
    const sRankLandHexes = sRankLandCandidates.slice(0, 4); // 陸上Sランクは4体
    sRankLandHexes.forEach(h => h.properties.monsterRank = 'S');
    const sRankLandIndexes = new Set(sRankLandHexes.map(h => getIndex(h.col, h.row)));
    landCandidates = landCandidates.filter(h => !sRankLandIndexes.has(getIndex(h.col, h.row)));

    // ★★★ ここから海上の魔物分布ロジックを追加 ★★★

    // --- STEP 2.5: 海上のSランク（クラーケンなど）の決定 ---
    // 候補：水深が深く(-800m以下)、魔力が濃い(0.8以上)海域
    const sRankSeaCandidates = seaCandidates.filter(h => {
        const p = h.properties;
        return p.elevation < -800 && p.manaValue > 0.8;
    });
    sRankSeaCandidates.sort((a, b) => b.properties.manaValue - a.properties.manaValue);
    const sRankSeaHexes = sRankSeaCandidates.slice(0, 2); // 海上Sランクも2体
    sRankSeaHexes.forEach(h => h.properties.monsterRank = 'S');
    const sRankSeaIndexes = new Set(sRankSeaHexes.map(h => getIndex(h.col, h.row)));
    seaCandidates = seaCandidates.filter(h => !sRankSeaIndexes.has(getIndex(h.col, h.row)));

    // --- STEP 3: 海上の A, B, C, D ランクの決定 ---
    // 海岸からの距離を事前計算（効率化のため）
    const distanceToCoast = new Map();
    const queue = allHexes.filter(h => h.neighbors.some(n => !allHexes[n].properties.isWater));
    queue.forEach(h => distanceToCoast.set(getIndex(h.col, h.row), 1));
    let head = 0;
    while(head < queue.length) {
        const current = queue[head++];
        const dist = distanceToCoast.get(getIndex(current.col, current.row));
        current.neighbors.forEach(nIdx => {
            if (allHexes[nIdx].properties.isWater && !distanceToCoast.has(nIdx)) {
                distanceToCoast.set(nIdx, dist + 1);
                queue.push(allHexes[nIdx]);
            }
        });
    }

    seaCandidates.forEach(h => {
        const p = h.properties;
        const dist = distanceToCoast.get(getIndex(h.col, h.row)) || 999;

        // Aランク (リヴァイアサン等): 深海(-300m以下)で魔力が高い(0.6以上)
        if (p.elevation < -300 && p.manaValue > 0.6) {
            p.monsterRank = 'A';
        }
        // Bランク (大海蛇等): 外洋(海岸から5ヘックス以上離れている)
        else if (dist > 4 && p.elevation < -200) {
            p.monsterRank = 'B';
        }
        // Cランク (シーサーペント等): 沿岸(海岸から5ヘックス以内)
        else if (dist <= 4) {
            p.monsterRank = 'C';
        }
        // Dランク (大型魚等): 浅瀬のどこにでもいる
        else {
            p.monsterRank = 'D';
        }
    });

    // ★★★ 海上ロジックここまで ★★★

    // --- STEP 4: 陸上の A, B, C, Dランクの割り当て (既存ロジック) ---
    const assignRank = (rank, criteria, sortLogic, percentage) => {
        if (landCandidates.length === 0) return;
        const targetCount = Math.floor(allHexes.filter(h => !h.properties.isWater).length * percentage);
        let rankCandidates = landCandidates.filter(criteria);
        if (sortLogic) { rankCandidates.sort(sortLogic); }
        const assignedHexes = rankCandidates.slice(0, targetCount);
        assignedHexes.forEach(h => h.properties.monsterRank = rank);
        const assignedIndexes = new Set(assignedHexes.map(h => getIndex(h.col, h.row)));
        landCandidates = landCandidates.filter(h => !assignedIndexes.has(getIndex(h.col, h.row)));
    };

    assignRank('A', h => (h.properties.vegetation === '密林' || h.properties.elevation > 3000) && h.properties.manaValue > 0.7, (a, b) => b.properties.manaValue - a.properties.manaValue, 0.10);
    assignRank('B', h => ['密林', '針葉樹林'].includes(h.properties.vegetation) || h.properties.elevation > 2000, (a, b) => b.properties.elevation - a.properties.elevation, 0.10);
    assignRank('C', h => !civilizedHexIndexes.has(getIndex(h.col, h.row)), () => Math.random() - 0.5, 0.30);
    landCandidates.forEach(h => { if (h.properties.population < 500) { h.properties.monsterRank = 'D'; } });

    return allHexes;
}

/**
 * 狩猟適性を計算する関数
 * @param {Array<object>} allHexes - 魔物分布計算後の全ヘックスデータ
 * @returns {Array<object>} - huntingPotentialプロパティが追加されたヘックスデータ
 */
export function generateHuntingPotential(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        let huntingPotential = 0;

        if (!p.isWater) {
            // [基準1] 基本スコア
            let baseScore = 0;
            switch (p.vegetation) {
                case '森林': case '密林': case '針葉樹林':
                    baseScore = 0.6; break;
                case '草原':
                    baseScore = 0.3; break;
                case '湿地':
                    baseScore = 0.2; break;
                case '荒れ地':
                    baseScore = 0.1; break;
            }
            if (p.terrainType === '丘陵' || p.terrainType === '山地') {
                baseScore = Math.max(baseScore, 0.5);
            }
            if (p.terrainType === '山岳' || p.vegetation === '砂漠' || p.vegetation === '高山') {
                baseScore = 0;
            }
            huntingPotential = baseScore;

            // [基準2] ボーナス要素
            if (p.monsterRank) {
                switch (p.monsterRank) {
                    case 'S': case 'A': case 'B': huntingPotential += 0.4; break;
                    case 'C': case 'D': huntingPotential += 0.2; break;
                }
            }
            if (p.flow > 0 || h.neighbors.some(nIndex => allHexes[nIndex].properties.isWater && allHexes[nIndex].properties.elevation > 0)) {
                huntingPotential += 0.1;
            }

            // [基準3] ペナルティ要素
            if (p.population > 0) {
                const populationPenalty = Math.pow(Math.min(5000, p.population) / 5000, 2);
                huntingPotential -= populationPenalty;
            }
            huntingPotential -= p.agriPotential * 0.2;
        }

        p.huntingPotential = Math.max(0.0, Math.min(1.0, huntingPotential));
    });
    return allHexes;
}

/**
 * 牧畜・家畜適正を計算する関数
 * @param {Array<object>} allHexes - 狩猟適正計算後の全ヘックスデータ
 * @returns {Array<object>} - pastoralPotentialとlivestockPotentialプロパティが追加されたヘックスデータ
 */
export function generateLivestockPotential(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        let pastoralPotential = 0;
        let livestockPotential = 0;

        if (!p.isWater) {
            // --- A. 牧畜適正 (Pastoral Potential) の計算 ---
            let pastoralScore = 0;
            // プラス要素
            if (p.vegetation === '草原') pastoralScore += 0.8;
            if (p.terrainType === '平地' || p.terrainType === '丘陵') pastoralScore += 0.2;
            if (p.flow > 0 || h.neighbors.some(nIndex => allHexes[nIndex].properties.isWater && allHexes[nIndex].properties.elevation > 0)) {
                pastoralScore += 0.1;
            }
            // マイナス要素
            pastoralScore -= p.huntingPotential * 1.2; // 狩猟適正が高いと大幅マイナス
            if (['森林', '密林', '針葉樹林', '湿地', '砂漠', '高山'].includes(p.vegetation)) pastoralScore -= 1.0;
            pastoralScore -= p.agriPotential * 0.3; // 農地とも競合
            if (p.population > 100) pastoralScore -= 0.2;

            pastoralPotential = Math.max(0.0, Math.min(1.0, pastoralScore));

            // --- B. 家畜適正 (Livestock Potential) の計算 ---
            let livestockScore = 0;
            // プラス要素
            livestockScore += p.agriPotential * 0.9; // 農業適性が高いほど餌が豊富
            if (p.flow > 0 || h.neighbors.some(nIndex => allHexes[nIndex].properties.isWater && allHexes[nIndex].properties.elevation > 0)) {
                livestockScore += 0.1;
            }
            // マイナス要素
            livestockScore -= p.huntingPotential * 0.3; // 捕食者の影響は牧畜より小さい
            if (p.vegetation === '砂漠' || p.vegetation === '高山') livestockScore -= 1.0;
            if (p.temperature < -5) livestockScore -= 0.5; // 寒すぎると飼育が困難

            livestockPotential = Math.max(0.0, Math.min(1.0, livestockScore));
        }

        p.pastoralPotential = pastoralPotential;
        p.livestockPotential = livestockPotential;
    });
    return allHexes;
}