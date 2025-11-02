// ================================================================
// GeoForge System - 文明生成モジュール
// ================================================================

import * as config from './config.js';
import { getDistance } from './utils.js'; // ★ 後で作成するヘルパー関数です

/**
 * 各ヘックスの居住適性スコアを計算する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function calculateHabitability(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        let score = 0;
        if (!p.isWater && p.vegetation !== '高山' && p.vegetation !== '砂漠') {
            score += p.agriPotential * 40;   // 農業ポテンシャルは最も重要
            score += p.fishingPotential * 20; // 漁業ポテンシャルも重要
            const idealTemp = 17.5;
            score += Math.max(0, 1 - Math.abs(p.temperature - idealTemp) / 15) * 15; // 気温
            score += p.manaValue * 10;        // 魔力
            score += p.miningPotential * 5;   // 鉱業
            score += p.forestPotential * 5;   // 林業
        }
        p.habitability = score;
    });
}

/**
 * 居住地を階層的に配置する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function placeSettlements(allHexes) {
    // 1. 居住地候補をスコア順にソート
    const settlementCandidates = allHexes
        .filter(h => h.properties.habitability > 0)
        .sort((a, b) => b.properties.habitability - a.properties.habitability);

    const settlements = [];

    // 2a. 「都」を配置
    for (let i = 0; i < settlementCandidates.length && settlements.filter(s => s.type === '都').length < config.NUM_CAPITALS; i++) {
        const candidate = settlementCandidates[i];
        if (!candidate.properties.isSettled && settlements.every(s => getDistance(s.hex, candidate) > config.MIN_DISTANCES['都'])) {
            candidate.properties.settlement = '都';
            candidate.properties.population = Math.floor(50000 + Math.random() * 100000);
            candidate.properties.isSettled = true;
            settlements.push({ hex: candidate, type: '都' });
        }
    }

    // 2b. 「街」を配置
    for (let i = 0; i < settlementCandidates.length && settlements.filter(s => s.type === '街').length < config.NUM_CITIES; i++) {
        const candidate = settlementCandidates[i];
        if (!candidate.properties.isSettled && settlements.every(s => getDistance(s.hex, candidate) > config.MIN_DISTANCES['街'])) {
            candidate.properties.settlement = '街';
            candidate.properties.population = Math.floor(10000 + Math.random() * 40000);
            candidate.properties.isSettled = true;
            settlements.push({ hex: candidate, type: '街' });
        }
    }

    // 3. 町と村を拡散させる
    settlements.forEach(city => {
        const 庇護人口 = city.hex.properties.population * 1.5;
        let currentPopulation = 0;
        const nearbyHexes = allHexes
            .filter(h => h.properties.habitability > 0 && !h.properties.isSettled)
            .sort((a, b) => getDistance(city.hex, a) - getDistance(city.hex, b));

        for (const nearbyHex of nearbyHexes) {
            if (currentPopulation > 庇護人口) break;
            if (nearbyHex.properties.isSettled) continue;

            const dist = getDistance(city.hex, nearbyHex);
            const probability = (nearbyHex.properties.habitability / 100) * Math.pow(0.85, dist);
            
            if (Math.random() < probability) {
                if (probability > 0.3 && dist < 10) {
                    nearbyHex.properties.settlement = '町';
                    const pop = Math.floor(1000 + Math.random() * 9000);
                    nearbyHex.properties.population = pop;
                    currentPopulation += pop;
                } else {
                    nearbyHex.properties.settlement = '村';
                    const pop = Math.floor(100 + Math.random() * 900);
                    nearbyHex.properties.population = pop;
                    currentPopulation += pop;
                }
                nearbyHex.properties.isSettled = true;
            }
        }
    });

    // 4. 散居人口を設定する
    allHexes.forEach(h => {
        if (!h.properties.isSettled && h.properties.habitability > 5) {
            if (Math.random() < (h.properties.habitability / 150)) {
                h.properties.population = Math.floor((h.properties.habitability / 100) * 80 + Math.random() * 20);
            } else {
                h.properties.population = 0;
            }
        } else if (!h.properties.population) {
            h.properties.population = 0;
        }
    });
}

/**
 * 辺境のハブとなる町を追加する
 * @param {Array<object>} allHexes - 全ヘックスのデータ
 */
function createFrontierHubs(allHexes) {
    const majorSettlements = allHexes.filter(h => ['町', '街', '都'].includes(h.properties.settlement));

    let isolatedVillages = allHexes.filter(h => {
        if (h.properties.settlement !== '村') return false;
        return !majorSettlements.some(s => getDistance(h, s) <= config.HUB_SEARCH_RADIUS);
    });

    const isolatedClusters = [];
    while (isolatedVillages.length > 0) {
        const seed = isolatedVillages.shift();
        const currentCluster = [seed];
        
        for (let i = isolatedVillages.length - 1; i >= 0; i--) {
            const otherVillage = isolatedVillages[i];
            if (getDistance(seed, otherVillage) < config.HUB_SEARCH_RADIUS) {
                currentCluster.push(otherVillage);
                isolatedVillages.splice(i, 1);
            }
        }
        isolatedClusters.push(currentCluster);
    }

    isolatedClusters.forEach(cluster => {
        if (cluster.length > 0) {
            cluster.sort((a, b) => b.properties.population - a.properties.population);
            const hubVillage = cluster[0];
            hubVillage.properties.settlement = '町';
            hubVillage.properties.population = Math.max(hubVillage.properties.population, 1000 + Math.floor(Math.random() * 2000));
            console.log(`[DEBUG] 辺境ハブ生成: E${hubVillage.col}-N${(config.ROWS - 1) - hubVillage.row} の村を町に昇格させました。`);
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

    // パス2：居住地を配置
    placeSettlements(allHexes);
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await addLogMessage(`居住地が生まれました... 総人口: ${totalPopulation.toLocaleString()}人`);
    
    // パス3：辺境のハブを創設
    await addLogMessage("辺境のハブ都市を創設しています...");
    createFrontierHubs(allHexes);
    
    return allHexes;
}