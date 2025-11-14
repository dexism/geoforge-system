// ================================================================
// GeoForge System - 経済シミュレーションモジュール (v1.2 - 新集計ロジック)
// ================================================================

import * as config from './config.js';
import { getIndex } from './utils.js';

/**
 * 経済シミュレーションのメイン関数 (main.js から呼び出される)
 */
export async function simulateEconomy(allHexes, addLogMessage) {
    await addLogMessage("各地域の食料需給を計算中...");

    allHexes.forEach(h => {
        const p = h.properties;
        // 初期化
        p.production = {};
        p.surplus = {};
        p.shortage = {};
        p.cultivatedArea = 0;

        if (p.population <= 0 || p.isWater) {
            return;
        }

        const settlementType = p.settlement ? p.settlement : '散居';
        const settlementInfo = config.SETTLEMENT_PARAMS[settlementType];

        // --- STEP 1: 労働人口の算出 ---
        const primaryLaborPopulation = p.population * settlementInfo.labor_rate; // 第一次産業の労働力
        const hunterPopulation = p.population * settlementInfo.hunter_rate; // 狩猟専門の労働力

        // --- STEP 2: 労働力の配分 ---
        const potentials = {
            agriculture: p.agriPotential,
            forestry: p.forestPotential,
            mining: p.miningPotential,
            fishing: p.fishingPotential,
            pastoral: p.pastoralPotential,
            livestock: p.livestockPotential,
        };
        const totalPotential = Object.values(potentials).reduce((sum, val) => sum + val, 0);

        const workers = {};
        if (totalPotential > 0) {
            workers.agriculture = primaryLaborPopulation * (potentials.agriculture / totalPotential);
            workers.forestry = primaryLaborPopulation * (potentials.forestry / totalPotential);
            workers.mining = primaryLaborPopulation * (potentials.mining / totalPotential);
            workers.fishing = primaryLaborPopulation * (potentials.fishing / totalPotential);
            workers.pastoral = primaryLaborPopulation * (potentials.pastoral / totalPotential);
            workers.livestock = primaryLaborPopulation * (potentials.livestock / totalPotential);
        }

        // --- STEP 3: 各産業の生産量を計算 ---
        const C = config.PRODUCTION_PARAMS;

        // 漁業
        if (workers.fishing > 0.1) {
            const laborYield = workers.fishing * C.YIELD_PER_WORKER.FISHING * p.fishingPotential;
            // 漁業の資源限界は単純化のため労働力ベースのみとする
            p.production['魚介類'] = laborYield;
        }

        // 狩猟 (専用の労働力で計算)
        if (hunterPopulation > 0.1 && p.huntingPotential > 0) {
            const laborYield = hunterPopulation * config.HUNTING_PARAMS.BASE_HUNTING_YIELD_T_PER_HUNTER * p.huntingPotential;
            const resourceYield = config.HEX_AREA_HA * config.HUNTING_PARAMS.MAX_HUNTING_YIELD_T_PER_HA * p.huntingPotential;
            p.production['狩猟肉'] = Math.min(laborYield, resourceYield);
        }

        // 牧畜 (肉と乳製品)
        if (workers.pastoral > 0.1) {
            p.production['牧畜肉'] = workers.pastoral * C.YIELD_PER_WORKER.PASTORAL_MEAT * p.pastoralPotential;
            p.production['乳製品'] = workers.pastoral * C.YIELD_PER_WORKER.PASTORAL_DAIRY * p.pastoralPotential;
        }

        // 家畜 (肉)
        if (workers.livestock > 0.1) {
            p.production['家畜肉'] = workers.livestock * C.YIELD_PER_WORKER.LIVESTOCK_MEAT * p.livestockPotential;
        }

        // 農業 (穀物、果樹、農地面積)
        if (workers.agriculture > 0.1) {
            // 以前のロジックを、農業従事者数に基づいて再計算
            const climate = p.climateZone;
            let mainCrops = {};

            // ★★★ ここからが提示を求められた部分 ★★★
            if (climate.includes("亜寒帯") || climate.includes("ツンドラ") || climate.includes("ステップ") || climate.includes("砂漠(寒)")) {
                mainCrops = { '大麦': 0.6, '雑穀': 0.4 };
            } else if (climate.includes("温暖") || climate.includes("地中海")) {
                mainCrops = { '小麦': 0.7, '雑穀': 0.3 };
            } else if (climate.includes("熱帯")) {
                mainCrops = p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 };
            } else {
                mainCrops = { '雑穀': 1.0 };
            }
            // ★★★ ここまでが提示を求められた部分 ★★★

            let avgHaPerPerson = 0;
            Object.keys(mainCrops).forEach(crop => avgHaPerPerson += config.CROP_DATA[crop].cultivation_ha_per_person * mainCrops[crop]);

            const laborBasedArea = workers.agriculture * avgHaPerPerson * 1.2; // 簡易的なインフラ係数
            const maxArea = config.HEX_AREA_HA * (0.03 + p.agriPotential * 0.5);
            p.cultivatedArea = Math.min(laborBasedArea, maxArea);

            const yieldFluctuation = 0.7 + Math.random() * 0.6;
            Object.keys(mainCrops).forEach(cropName => {
                const crop = config.CROP_DATA[cropName];
                const cropArea = p.cultivatedArea * mainCrops[cropName];
                const cropYield = cropArea * crop.yield * yieldFluctuation;
                p.production[cropName] = (p.production[cropName] || 0) + cropYield;
            });
            
            // 果樹園: 農業適性が高く温暖な土地で、農業労働力の一部が果樹栽培を行う
            if (p.agriPotential > 0.6 && p.temperature > 10) {
                p.production['果物'] = (workers.agriculture * 0.1) * (p.agriPotential * 0.5); // 簡易モデル
            }
        }

        // --- STEP 4: 食料需給の計算 ---
        const totalDemand = p.population * settlementInfo.consumption_t_per_person;
        let totalSupply = 0;
        const foodItems = ['小麦', '大麦', '雑穀', '稲', '魚介類', '狩猟肉', '牧畜肉', '家畜肉', '乳製品', '果物'];
        foodItems.forEach(item => {
            if (p.production[item]) {
                totalSupply += p.production[item];
            }
        });
        
        const balance = totalSupply - totalDemand;

        // 余剰・不足の計算 (簡略化: 食料全体で計算)
        if (balance > 0) { p.surplus['食料'] = balance.toFixed(1); }
        else { p.shortage['食料'] = Math.abs(balance).toFixed(1); }

        // --- STEP 5: 加工品の生産 (酒) ---
        const grainSurplus = (p.production['小麦'] || 0) + (p.production['雑穀'] || 0) - (totalDemand * 0.8);
        const fruitSurplus = (p.production['果物'] || 0) - (totalDemand * 0.1);
        if (grainSurplus > 0) {
            p.production['酒(穀物)'] = grainSurplus * C.PROCESSING_RATES.GRAIN_TO_ALCOHOL;
        }
        if (fruitSurplus > 0) {
            p.production['酒(果実)'] = fruitSurplus * C.PROCESSING_RATES.FRUIT_TO_ALCOHOL;
        }
    });

    return allHexes;
}

/**
 * 主要都市の庇護下にある領土の各種データを集計する関数 (集計ロジック修正版)
 * @param {Array<object>} allHexes - 経済シミュレーション後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 集計データが追加された全ヘックスデータ
 */
export async function calculateTerritoryAggregates(allHexes, addLogMessage) {
    await addLogMessage("主要都市の支配領域データを集計しています...");

    // 集計対象を「町」以上の、実質的な拠点となりうる集落に限定する
    const territoryHubs = allHexes.filter(h => ['首都', '都市', '領都', '街', '町'].includes(h.properties.settlement));
    
    // --- STEP 1: 親から子の関係をマップ化する ---
    const childrenMap = new Map();
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.parentHexId !== null) {
            if (!childrenMap.has(p.parentHexId)) {
                childrenMap.set(p.parentHexId, []);
            }
            childrenMap.get(p.parentHexId).push(h);
        }
    });

    // --- STEP 2: 各ハブごとに、配下の全領域を集計する ---
    territoryHubs.forEach(hub => {
        const hubIndex = getIndex(hub.col, hub.row);
        const hubProps = hub.properties;

        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        // 【修正点】集計の初期値を「ハブ自身の値」からスタートさせる
        // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
        const aggregatedData = {
            population: hubProps.population,              // 修正: 0ではなくハブ自身の人口からスタート
            cultivatedArea: hubProps.cultivatedArea,      // 修正: 0ではなくハブ自身の農地からスタート
            production: { ...hubProps.production }, 
            settlementCounts: { '都市': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
        };

        // --- 幅優先探索で、ハブ配下のすべての子孫（孫、ひ孫...）をたどる ---
        const queue = [...(childrenMap.get(hubIndex) || [])]; 
        const visited = new Set(queue.map(h => getIndex(h.col, h.row)));
        let head = 0;

        while (head < queue.length) {
            const descendant = queue[head++];
            const dProps = descendant.properties;

            // 1. 配下集落のデータを合計に加算
            aggregatedData.population += dProps.population;
            aggregatedData.cultivatedArea += dProps.cultivatedArea;
            for (const item in dProps.production) {
                aggregatedData.production[item] = (aggregatedData.production[item] || 0) + dProps.production[item];
            }

            // 2. 「直轄地」の種類をカウント
            if (dProps.parentHexId === hubIndex) {
                if (dProps.settlement && aggregatedData.settlementCounts[dProps.settlement] !== undefined) {
                    aggregatedData.settlementCounts[dProps.settlement]++;
                }
            }

            // 3. この子孫がさらに子（ハブから見て孫）を持っているなら、キューに追加
            const descendantIndex = getIndex(descendant.col, descendant.row);
            const grandchildren = childrenMap.get(descendantIndex) || [];
            grandchildren.forEach(child => {
                const childIndex = getIndex(child.col, child.row);
                if (!visited.has(childIndex)) {
                    visited.add(childIndex);
                    queue.push(child);
                }
            });
        }

        // --- STEP 3: 計算した集計データをハブのプロパティに格納 ---
        hubProps.territoryData = aggregatedData;
    });

    return allHexes;
}