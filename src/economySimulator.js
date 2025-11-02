// ================================================================
// GeoForge System - 経済シミュレーションモジュール
// ================================================================

import * as config from './config.js';

/**
 * 経済シミュレーションのメイン関数 (main.js から呼び出される)
 * @param {Array<object>} allHexes - 文明生成後の全ヘックスデータ
 * @param {Function} addLogMessage - ログ出力用の関数
 * @returns {Array<object>} - 経済情報が追加された全ヘックスデータ
 */
export async function simulateEconomy(allHexes, addLogMessage) {
    await addLogMessage("各地域の食料需給を計算中...");

    allHexes.forEach(h => {
        const p = h.properties;
        p.surplus = {};       // 余剰プロパティを初期化
        p.shortage = {};      // 不足プロパティを初期化
        p.cultivatedArea = 0; // 農地面積を初期化
        
        if (p.population <= 0 || p.isWater) {
            return; // 人口がいない、または水域なら計算しない
        }

        // --- A. 需要の計算 ---
        const settlementType = p.settlement ? p.settlement : '散居';
        const settlementInfo = config.SETTLEMENT_PARAMS[settlementType];
        const annualConsumptionPerPerson = settlementInfo.consumption_t_per_person;
        const totalDemand = p.population * annualConsumptionPerPerson;

        // --- B. 供給の計算 ---
        
        // B-1. 主食と作付け割合の決定
        let mainCrops = {};
        const climate = p.climateZone;
        if (climate.includes("亜寒帯") || climate.includes("ツンドラ") || climate.includes("ステップ") || climate.includes("砂漠(寒)")) {
            mainCrops = { '大麦': 0.6, '雑穀': 0.4 };
        } else if (climate.includes("温暖") || climate.includes("地中海")) {
            mainCrops = { '小麦': 0.7, '雑穀': 0.3 };
        } else if (climate.includes("熱帯")) {
            mainCrops = p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 };
        } else {
            mainCrops = { '雑穀': 1.0 }; // デフォルト
        }

        // B-2. 耕作可能面積の計算
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
        
        // B-3. 収穫量の計算
        let totalSupply = 0;
        const yieldFluctuation = 0.7 + Math.random() * 0.6; // 並作(1.0)から±30%の変動
        
        Object.keys(mainCrops).forEach(cropName => {
            const crop = config.CROP_DATA[cropName];
            const cropArea = finalCultivationArea * mainCrops[cropName];
            const cropYield = cropArea * crop.yield * yieldFluctuation;
            totalSupply += cropYield;
        });
        
        // --- C. 需給バランスの決定 ---
        const balance = totalSupply - totalDemand;
        
        if (balance > 0) {
            const surplusAmount = balance * 0.7; // 30%は備蓄やロスと仮定
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