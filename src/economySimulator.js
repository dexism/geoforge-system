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
        p.surplus = {};
        p.shortage = {};
        p.cultivatedArea = 0;
        p.production = {};
        
        if (p.population <= 0 || p.isWater) {
            return;
        }

        const settlementType = p.settlement ? p.settlement : '散居';
        const settlementInfo = config.SETTLEMENT_PARAMS[settlementType];
        const totalDemand = p.population * settlementInfo.consumption_t_per_person;

        let mainCrops = {};
        const climate = p.climateZone;
        if (climate.includes("亜寒帯") || climate.includes("ツンドラ") || climate.includes("ステップ") || climate.includes("砂漠(寒)")) {
            mainCrops = { '大麦': 0.6, '雑穀': 0.4 };
        } else if (climate.includes("温暖") || climate.includes("地中海")) {
            mainCrops = { '小麦': 0.7, '雑穀': 0.3 };
        } else if (climate.includes("熱帯")) {
            mainCrops = p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 };
        } else {
            mainCrops = { '雑穀': 1.0 };
        }

        const headCapPotential = settlementInfo.head_cap_base + p.agriPotential * (0.5 - settlementInfo.head_cap_base) + settlementInfo.head_cap_bonus;
        const maxCultivationArea = config.HEX_AREA_HA * Math.max(0.03, headCapPotential);
        const laborPopulation = p.population * settlementInfo.labor_rate;
        let avgCultivationHaPerPerson = 0;
        Object.keys(mainCrops).forEach(cropName => {
            avgCultivationHaPerPerson += config.CROP_DATA[cropName].cultivation_ha_per_person * mainCrops[cropName];
        });
        const livestockCoeff = p.settlement === '村' ? 1.0 : 1.8;
        const consolidationCoeff = p.settlement === '村' ? 0.8 : 1.0;
        const laborBasedArea = laborPopulation * avgCultivationHaPerPerson * livestockCoeff * consolidationCoeff * settlementInfo.infra_coeff;
        const finalCultivationArea = Math.min(maxCultivationArea, laborBasedArea);
        p.cultivatedArea = finalCultivationArea;
        
        let totalSupply = 0;
        const yieldFluctuation = 0.7 + Math.random() * 0.6;
        
        Object.keys(mainCrops).forEach(cropName => {
            const crop = config.CROP_DATA[cropName];
            const cropArea = finalCultivationArea * mainCrops[cropName];
            const cropYield = cropArea * crop.yield * yieldFluctuation;
            p.production[cropName] = cropYield;
            totalSupply += cropYield;
        });
        
        const balance = totalSupply - totalDemand;
        
        if (balance > 0) {
            const surplusAmount = balance * 0.7;
            if (surplusAmount > 0) {
                Object.keys(mainCrops).forEach(cropName => {
                    const share = (surplusAmount * mainCrops[cropName]).toFixed(1);
                    if (parseFloat(share) > 0) p.surplus[cropName] = share;
                });
            }
        } else {
            Object.keys(mainCrops).forEach(cropName => {
                const share = (Math.abs(balance) * mainCrops[cropName]).toFixed(1);
                 if (parseFloat(share) > 0) p.shortage[cropName] = share;
            });
        }
    });

    return allHexes;
}

/**
 * 主要都市の庇護下にある領土の各種データを集計する関数
 * @param {Array<object>} allHexes - 経済シミュレーション後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 集計データが追加された全ヘックスデータ
 */
export async function calculateTerritoryAggregates(allHexes, addLogMessage) {
    await addLogMessage("主要都市の支配領域データを集計しています...");

    const territoryHubs = allHexes.filter(h => ['首都', '都市', '領都'].includes(h.properties.settlement));
    const territoryDataMap = new Map();

    // 1. 各ハブのデータオブジェクトを初期化
    territoryHubs.forEach(hub => {
        const hubIndex = getIndex(hub.col, hub.row);
        territoryDataMap.set(hubIndex, {
            population: 0,
            cultivatedArea: 0,
            production: {},
            settlementCounts: { '都市': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
        });
    });

    // 2. 全ヘックスをスキャンして、2種類の集計を同時に行う
    allHexes.forEach(h => {
        const p = h.properties;

        // --- 集計A: 領域全体の合計値（人口、生産量など）---
        // territoryId（最終的な支配者）を基に、孫以降もすべて含めて集計
        const terrId = p.territoryId;
        if (terrId != null && territoryDataMap.has(terrId)) {
            const data = territoryDataMap.get(terrId);
            data.population += p.population;
            data.cultivatedArea += p.cultivatedArea;
            for (const crop in p.production) {
                data.production[crop] = (data.production[crop] || 0) + p.production[crop];
            }
        }

        // --- 集計B: 直轄の集落数 ---
        // parentHexId（直接の親）を基に、子集落のみをカウント
        const parentId = p.parentHexId;
        if (parentId != null && territoryDataMap.has(parentId)) {
            const parentData = territoryDataMap.get(parentId);
            const settlementType = p.settlement;
            if (settlementType && parentData.settlementCounts[settlementType] !== undefined) {
                parentData.settlementCounts[settlementType]++;
            }
        }
    });

    // 3. 集計結果を各ハブのプロパティに格納
    territoryHubs.forEach(hub => {
        const hubIndex = getIndex(hub.col, hub.row);
        hub.properties.territoryData = territoryDataMap.get(hubIndex);
    });
    
    return allHexes;
}