// ================================================================
// GeoForge System - 文明生成モジュール
// ================================================================

import * as config from './config.js';
import { getDistance, getIndex } from './utils.js'; // ★ getIndexをインポート

/**
 * 各ヘックスの居住適性スコアを計算する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */calculateHabitability
function calculateHabitability(allHexes) {
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
    });
}

/**
 * 国家を生成し、各ヘックスに領土を割り当てる
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @param {Array<object>} candidates - 居住地の候補ヘックス
 * @returns {Array<object>} 生成された国家の配列
 */
function generateNationsAndTerritories(allHexes, candidates) {
    const nations = [];
    // 首都を配置
    for (const candidate of candidates) {
        if (nations.length >= config.NUM_NATIONS) break;

        if (nations.every(n => getDistance(n.capital, candidate) > config.CAPITAL_MIN_DISTANCE)) {
            const nationId = nations.length + 1;
            candidate.properties.settlement = '首都';
            candidate.properties.population = 100000 + Math.floor(Math.random() * 50000);
            candidate.properties.isSettled = true;
            candidate.properties.nationId = nationId;
            nations.push({ id: nationId, capital: candidate, settlements: [candidate] });
        }
    }

    // 各ヘックスに所属国家を割り当て
    allHexes.forEach(h => {
        if (h.properties.isSettled) return;
        let closestCapital = null;
        let minDistance = Infinity;

        nations.forEach(n => {
            const d = getDistance(h, n.capital);
            if (d < minDistance) {
                minDistance = d;
                closestCapital = n;
            }
        });
        
        if (closestCapital && minDistance < config.FRONTIER_DISTANCE_THRESHOLD) {
            h.properties.nationId = closestCapital.id;
        } else {
            h.properties.nationId = 0; // 0は辺境
        }
    });

    return nations;
}

/**
 * 特定の居住地タイプを配置するヘルパー関数
 * @param {Array<object>} candidates - 候補ヘックス
 * @param {Array<object>} existingSettlements - 既存の居住地
 * @param {number} nationId - 対象の国家ID
 * @param {string} type - 居住地の種類
 * @param {number} count - 配置する数
 * @param {number} minDistance - 最低離間距離
 * @param {object} populationRange - 人口の範囲 {min, max}
 * @returns {Array<object>} 新たに配置された居住地
 */
function placeSettlementType(candidates, existingSettlements, nationId, type, count, minDistance, populationRange) {
    const territoryCandidates = candidates.filter(h => h.properties.nationId === nationId && !h.properties.isSettled);
    const newSettlements = [];

    for (const candidate of territoryCandidates) {
        if (newSettlements.length >= count) break;

        const allSettlements = [...existingSettlements, ...newSettlements];
        if (allSettlements.every(s => getDistance(s, candidate) > minDistance)) {
            candidate.properties.settlement = type;
            candidate.properties.population = populationRange.min + Math.floor(Math.random() * (populationRange.max - populationRange.min));
            candidate.properties.isSettled = true;
            newSettlements.push(candidate);
        }
    }
    return newSettlements;
}

/**
 * 国境に防衛拠点を配置する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 * @param {Array<object>} existingSettlements - 既存の居住地
 */
function placeDefenseHubs(allHexes, existingSettlements) {
    const borderHexes = allHexes.filter(h => {
        if (h.properties.isWater || h.properties.nationId === 0 || h.properties.isSettled) return false;
        
        const neighborNations = new Set(h.neighbors.map(i => allHexes[i].properties.nationId));
        return [...neighborNations].some(id => id !== h.properties.nationId && id !== 0);
    });

    const strategicCandidates = borderHexes.filter(h => 
        h.properties.elevation > 800 && // 山岳・丘陵地帯
        h.properties.habitability > 15
    ).sort((a,b) => b.properties.habitability - a.properties.habitability);

    const placedPerNation = {};
    strategicCandidates.forEach(candidate => {
        const nationId = candidate.properties.nationId;
        if ((placedPerNation[nationId] || 0) < 2) { // 各国2つまで
             if (existingSettlements.every(s => getDistance(s, candidate) > config.TOWN_MIN_DISTANCE)) {
                candidate.properties.settlement = '街'; // 防衛拠点は「街」扱い
                candidate.properties.population = 2000 + Math.floor(Math.random() * 3000);
                candidate.properties.isSettled = true;
                candidate.properties.isFortress = true; // 砦フラグ
                existingSettlements.push(candidate);
                placedPerNation[nationId] = (placedPerNation[nationId] || 0) + 1;
             }
        }
    });
}

/**
 * 文明生成のメイン関数 (main.js から呼び出される)
 * @param {Array<object>} allHexes - 大陸生成後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 文明情報が追加された全ヘックスデータ
 */
export async function generateCivilization(allHexes, addLogMessage) {
    // パス1：居住適性を計算
    await addLogMessage("居住に適した土地を探しています...");
    calculateHabitability(allHexes);

    const settlementCandidates = allHexes
        .filter(h => h.properties.habitability > 20)
        .sort((a, b) => b.properties.habitability - a.properties.habitability);

    // パス2：国家と首都の生成
    await addLogMessage("世界の国家を形成しています...");
    const nations = generateNationsAndTerritories(allHexes, settlementCandidates);
    let allSettlements = nations.flatMap(n => n.settlements);

    // パス3：各国家の主要都市を配置
    await addLogMessage("主要な都市を配置しています...");
    nations.forEach(nation => {
        let newCities = placeSettlementType(settlementCandidates, allSettlements, nation.id, '都市', config.CITIES_PER_NATION, config.CITY_MIN_DISTANCE, {min: 30000, max: 70000});
        allSettlements.push(...newCities);
        let newRegionalCapitals = placeSettlementType(settlementCandidates, allSettlements, nation.id, '領都', config.REGIONAL_CAPITALS_PER_NATION, config.TOWN_MIN_DISTANCE, {min: 10000, max: 20000});
        allSettlements.push(...newRegionalCapitals);
        let newTowns = placeSettlementType(settlementCandidates, allSettlements, nation.id, '街', config.TOWNS_PER_NATION, config.TOWN_MIN_DISTANCE, {min: 3000, max: 7000});
        allSettlements.push(...newTowns);
    });
    
    // パス4: 町と村の拡散
    await addLogMessage("町や村を生成しています...");
    allSettlements.forEach(city => {
        const influencePopulation = city.properties.population * 3.5;
        let currentPopulation = 0;
        const nearbyHexes = allHexes
            .filter(h => h.properties.habitability > 10 && !h.properties.isSettled)
            .sort((a, b) => getDistance(city, a) - getDistance(city, b));

        for (const nearbyHex of nearbyHexes) {
            if (currentPopulation > influencePopulation) break;
            if (nearbyHex.properties.isSettled) continue;

            const dist = getDistance(city, nearbyHex);
            const probability = (nearbyHex.properties.habitability / 100) * Math.pow(0.90, dist);
            
            if (Math.random() < probability) {
                if (probability > 0.25 && dist < 12) {
                    nearbyHex.properties.settlement = '町';
                    const pop = 1000 + Math.floor(Math.random() * 1500);
                    nearbyHex.properties.population = pop;
                    currentPopulation += pop;
                } else {
                    nearbyHex.properties.settlement = '村';
                    const pop = 200 + Math.floor(Math.random() * 800);
                    nearbyHex.properties.population = pop;
                    currentPopulation += pop;
                }
                nearbyHex.properties.isSettled = true;
            }
        }
    });

    // パス5: 防衛拠点の配置
    await addLogMessage("国境の防衛拠点を築いています...");
    placeDefenseHubs(allHexes, allSettlements.filter(s => s.properties.isSettled));

    // パス6: 散居人口とプロパティ初期化
    allHexes.forEach(h => {
        if (!h.properties.isSettled && h.properties.habitability > 5) {
            if (Math.random() < (h.properties.habitability / 70)) {
                h.properties.population = Math.floor((h.properties.habitability / 100) * 90 + Math.random() * 50);
            } else {
                h.properties.population = 0;
            }
        } else if (!h.properties.population) {
            h.properties.population = 0;
        }
        h.properties.parentHexId = null;
        h.properties.territoryId = null;
    });
    
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await addLogMessage(`文明が生まれました... 総人口: ${totalPopulation.toLocaleString()}人`);
    
    return allHexes;
}

/**
 * ★★★ [バグ修正版 v2] 階層を辿り、すべての集落に正しい中枢IDを設定する関数 ★★★
 * @param {Array<object>} allHexes - 街道生成後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 領地情報が追加された全ヘックスデータ
 */
export async function determineTerritories(allHexes, addLogMessage) {
    await addLogMessage("国家の領土を確定させています...");

    const UNCLAIMED_HABITABILITY_THRESHOLD = 5;
    const settlements = allHexes.filter(h => h.properties.settlement);
    const hubs = new Map(allHexes.filter(h => ['首都', '都市', '領都'].includes(h.properties.settlement)).map(h => [getIndex(h.col, h.row), h]));

    // 1. ★★★ [バグ修正] 全ての集落に対して、parentHexIdの連鎖を辿り、最終的な中枢ID (territoryId) を設定する ★★★
    settlements.forEach(s => {
        let current = s;
        let visited = new Set([getIndex(s.col, s.row)]); // 無限ループ防止用
        let loops = 0;

        // 現在地が中枢都市になるか、親がなくなるまで、parentHexIdを辿り続ける
        while (current && !hubs.has(getIndex(current.col, current.row)) && loops < 100) {
            const parentId = current.properties.parentHexId;

            // 親がいない、またはループが検出されたら探索終了
            if (parentId == null || visited.has(parentId)) {
                current = null; // 中枢が見つからなかったことを示す
                break;
            }
            
            const parentHex = allHexes[parentId];
            if (!parentHex) { // 親データが存在しない場合も終了
                current = null;
                break;
            }

            current = parentHex;
            visited.add(parentId);
            loops++;
        }

        // 最終的に辿り着いたのが中枢都市であれば、そのIDを元の集落のterritoryIdに設定
        if (current && hubs.has(getIndex(current.col, current.row))) {
             s.properties.territoryId = getIndex(current.col, current.row);
        } else {
             // 中枢が見つからなければ、自分自身が中枢（小規模な独立勢力）となる
             s.properties.territoryId = getIndex(s.col, s.row);
        }
    });
    
    // 2. 空白地の所属を、洪水充填法で確定させる（ここは変更なし）
    allHexes.forEach(h => {
        if (!h.properties.settlement) {
            h.properties.nationId = 0;
            h.properties.territoryId = null;
        }
    });
    const queue = allHexes.filter(h => 
        h.properties.settlement && 
        h.properties.nationId > 0 && 
        h.properties.population > 100
    );
    const visited = new Set(queue.map(h => getIndex(h.col, h.row)));
    let head = 0;
    while (head < queue.length) {
        const currentHex = queue[head++];
        currentHex.neighbors.forEach(neighborIndex => {
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                const neighborHex = allHexes[neighborIndex];
                const p = neighborHex.properties;
                if (!p.isWater && p.habitability > UNCLAIMED_HABITABILITY_THRESHOLD && !p.settlement) {
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