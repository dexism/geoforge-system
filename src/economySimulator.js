// ================================================================
// GeoForge System - 経済シミュレーションモジュール (v2.0 - 産業階層・完全農業ロジック統合版)
// ================================================================

import * as config from './config.js';
import { getIndex } from './utils.js';
import { findAStarPath } from './roadGenerator.js';

/**
 * 経済シミュレーションのメイン関数 (main.js から呼び出される)
 */
export async function simulateEconomy(allHexes, addLogMessage) {
    await addLogMessage("産業構造と経済連関をシミュレーション中...");

    allHexes.forEach(h => {
        const p = h.properties;

        // 初期化: 産業データ構造を作成
        p.industry = {
            primary: {},    // 第一次
            secondary: {},  // 第二次
            tertiary: {},   // 第三次
            quaternary: {}, // 第四次
            quinary: {}     // 第五次
        };

        // 互換性維持のため p.production も残すが、内容は primary の内容と同期させる
        p.production = {};
        p.surplus = {};
        p.shortage = {};
        p.cultivatedArea = 0;
        p.imports = { '食料': 0 }; // 初期化

        if (p.population <= 0 || p.isWater) return;

        const settlementType = p.settlement || '散居';
        // config.js に追加された産業人口比率を使用
        const alloc = config.INDUSTRY_ALLOCATION[settlementType];
        const settlementInfo = config.SETTLEMENT_PARAMS[settlementType];

        // 総労働力 (人口 * 労働率)
        const totalLabor = p.population * settlementInfo.labor_rate;

        // =================================================
        // 1. 第一次産業 (資源獲得)
        // =================================================
        // この階層に割り当てられる労働力
        const labor1 = totalLabor * alloc[1];

        // 労働力の配分（適性に応じて傾斜配分）
        const pot = {
            agri: p.agriPotential,
            forest: p.forestPotential,
            mining: p.miningPotential,
            fish: p.fishingPotential,
            pastoral: p.pastoralPotential,
            livestock: p.livestockPotential
        };
        const totalPot1 = Object.values(pot).reduce((a, b) => a + b, 0) || 1;

        // 各分野の労働者数
        const workers = {
            agri: labor1 * (pot.agri / totalPot1),
            forest: labor1 * (pot.forest / totalPot1),
            mining: labor1 * (pot.mining / totalPot1),
            fish: labor1 * (pot.fish / totalPot1),
            pastoral: labor1 * (pot.pastoral / totalPot1),
            livestock: labor1 * (pot.livestock / totalPot1)
        };

        const C = config.PRODUCTION_PARAMS;
        const prod1 = p.industry.primary;

        // ---------------------------------------------------------
        // 【農業ロジック】 (既存の詳細ロジックを完全移植)
        // ---------------------------------------------------------
        if (workers.agri > 0.1) {
            const climate = p.climateZone || "";
            let mainCrops = {};

            // --- 作物決定ロジック (既存仕様を維持) ---
            if (climate.includes("亜寒帯") || climate.includes("ツンドラ") || climate.includes("ステップ") || climate.includes("砂漠(寒)")) {
                // 寒冷・乾燥地帯: 大麦と雑穀が中心
                mainCrops = { '大麦': 0.6, '雑穀': 0.4 };
            } else if (climate.includes("温暖") || climate.includes("地中海")) {
                // 温帯: 小麦が中心
                mainCrops = { '小麦': 0.7, '雑穀': 0.3 };
            } else if (climate.includes("熱帯")) {
                // 熱帯: 河川沿い（沖積平野）なら稲、それ以外は雑穀
                mainCrops = p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 };
            } else {
                // その他（デフォルト）
                mainCrops = { '雑穀': 1.0 };
            }

            // 1人あたりの必要耕作面積の加重平均を計算
            let avgHaPerPerson = 0;
            Object.keys(mainCrops).forEach(crop => {
                if (config.CROP_DATA[crop]) {
                    avgHaPerPerson += config.CROP_DATA[crop].cultivation_ha_per_person * mainCrops[crop];
                }
            });

            // 労働力に基づき耕作可能面積を計算 (インフラ係数含む)
            // settlementInfo.infra_coeff は集落ランクによる効率補正
            const laborBasedArea = workers.agri * avgHaPerPerson * settlementInfo.infra_coeff;

            // 土地の限界面積 (最大でヘックスの面積 * (基本値 + 適性補正))
            const maxArea = config.HEX_AREA_HA * (0.03 + p.agriPotential * 0.5);
            p.cultivatedArea = Math.min(laborBasedArea, maxArea);

            // 収穫量の計算 (ランダムな豊作・不作係数あり)
            const yieldFluctuation = 0.7 + Math.random() * 0.6;

            Object.keys(mainCrops).forEach(cropName => {
                const cropData = config.CROP_DATA[cropName];
                if (cropData) {
                    const cropArea = p.cultivatedArea * mainCrops[cropName];
                    const cropYield = cropArea * cropData.yield * yieldFluctuation;
                    prod1[cropName] = (prod1[cropName] || 0) + cropYield;
                }
            });

            // 果樹園: 農業適性が高く温暖な土地で、農業労働力の一部が果樹栽培を行う
            if (p.agriPotential > 0.6 && p.temperature > 10) {
                // 農業労働者の10%が従事すると仮定し、適性に基づいて算出
                prod1['果物'] = (workers.agri * 0.1) * (p.agriPotential * 0.5);
            }
        }

        // --- 狩猟・林業 ---
        if (workers.forest > 0) {
            prod1['木材'] = workers.forest * 10 * p.forestPotential;
            prod1['狩猟肉'] = workers.forest * 2 * p.huntingPotential;
            prod1['薬草'] = workers.forest * 1 * p.manaValue;
        }

        // --- 鉱業 ---
        if (workers.mining > 0) {
            prod1['鉱石'] = workers.mining * 20 * p.miningPotential;
            prod1['鉄'] = workers.mining * 5 * p.miningPotential;
            if (p.manaValue > 1.5) prod1['魔鉱石'] = workers.mining * 0.5 * p.manaValue;
        }

        // --- 漁業 ---
        if (workers.fish > 0) {
            let coastalBonus = 1.0;
            if (p.isCoastal) coastalBonus = 1.5;
            prod1['魚介類'] = workers.fish * 15 * p.fishingPotential * coastalBonus;
        }

        // --- 牧畜・畜産 ---
        if (workers.pastoral > 0) {
            prod1['牧畜肉'] = workers.pastoral * 8 * p.pastoralPotential;
            prod1['乳製品'] = workers.pastoral * 10 * p.pastoralPotential;
            prod1['羊毛'] = workers.pastoral * 5 * p.pastoralPotential;
            if (p.pastoralPotential > 0.8) prod1['特産チーズ'] = workers.pastoral * 1;
        }
        if (workers.livestock > 0) {
            prod1['家畜肉'] = workers.livestock * 12 * p.livestockPotential;
            if (p.livestockPotential > 0.8) prod1['高級肉'] = workers.livestock * 2;
        }

        // 旧データ構造へのコピー（互換性確保）
        Object.assign(p.production, prod1);

        // =================================================
        // 2. 第二次産業 (加工・製造)
        // =================================================
        const labor2 = totalLabor * alloc[2];
        const prod2 = p.industry.secondary;
        const I = config.INDUSTRY_PARAMS;

        // 鍛冶・工房: 鉱石と木材を利用
        const resourceMetal = (prod1['鉱石'] || 0) + (prod1['木材'] || 0) * 0.5;
        if (resourceMetal > 0 && labor2 > 0) {
            const capacity = labor2 * 0.4;
            // 効率係数を用いて産出
            const output = Math.min(capacity * 2, resourceMetal * I.SMITHING_EFFICIENCY);
            prod2['武具・道具'] = output;
        }

        // 織物・染色: 革や植物繊維(農業の副産物と仮定)を利用
        const resourceFiber = (prod1['革'] || 0) + (prod1['雑穀'] || 0) * 0.2 + (prod1['羊毛'] || 0);
        if (resourceFiber > 0 && labor2 > 0) {
            const capacity = labor2 * 0.3;
            prod2['織物'] = Math.min(capacity * 2, resourceFiber * 1.5);
        }

        // 錬金術・魔導具: 薬草、魔鉱石、魔獣素材を利用
        const resourceMagic = (prod1['薬草'] || 0) + (prod1['魔鉱石'] || 0) + (prod1['魔獣素材'] || 0);
        if (resourceMagic > 0 && labor2 > 0) {
            const capacity = labor2 * 0.2;
            // マナ濃度が高いほど効率アップ
            const efficiency = I.MAGIC_CRAFT_EFFICIENCY * (1 + p.manaValue);
            prod2['ポーション・魔導具'] = Math.min(capacity, resourceMagic * efficiency);
        }

        // 酒造 (既存ロジックの統合)
        const grainAvailable = (prod1['小麦'] || 0) + (prod1['雑穀'] || 0);
        const fruitAvailable = (prod1['果物'] || 0);
        if (grainAvailable > 0) prod2['酒(穀物)'] = grainAvailable * 0.1 * C.PROCESSING_RATES.GRAIN_TO_ALCOHOL;
        if (fruitAvailable > 0) prod2['酒(果実)'] = fruitAvailable * 0.2 * C.PROCESSING_RATES.FRUIT_TO_ALCOHOL;

        // 建築: 木材と石材(鉱業副産物)
        prod2['建築'] = labor2 * 0.1 * settlementInfo.infra_coeff;

        // =================================================
        // 3. 第三次産業 (サービス)
        // =================================================
        const labor3 = totalLabor * alloc[3];
        const prod3 = p.industry.tertiary;

        // 商業: 道路Lvが高いほど発展
        const roadBonus = (p.roadLevel || 1) * 0.5;
        prod3['商業・交易'] = labor3 * 0.15 * roadBonus * I.COMMERCE_BASE;

        // 宿泊・飲食
        prod3['宿屋・酒場'] = labor3 * 0.3 * (roadBonus * 0.8);

        // 医療・癒し: 宗教施設や人口規模に依存
        prod3['医療・教会'] = labor3 * 0.2 * (1 + p.manaValue);

        // 交通: 船や馬車の運用
        if (p.roadLevel >= 4 || (p.isWater || h.neighbors.some(n => allHexes[n].properties.isWater))) {
            prod3['運送・交通'] = labor3 * 0.1 * roadBonus;
        }

        // =================================================
        // 4. 第四次産業 (知識・情報)
        // =================================================
        const labor4 = totalLabor * alloc[4];
        if (labor4 > 10) {
            const prod4 = p.industry.quaternary;

            // 魔法研究: マナ濃度に強く依存
            prod4['魔法研究'] = labor4 * 0.4 * p.manaValue * I.MAGIC_RESEARCH_BASE;

            // 学問・教育
            prod4['学問・歴史'] = labor4 * 0.3 * 10;

            // 軍事・戦略 (魔物ランクが高い地域の近くでは発達)
            let dangerBonus = 1;
            if (p.huntingPotential > 0.5) dangerBonus = 1.5;
            prod4['戦略・軍事'] = labor4 * 0.2 * dangerBonus;

            // 諜報・占い
            prod4['情報・予言'] = labor4 * 0.1 * (1 + p.manaValue);
        }

        // =================================================
        // 5. 第五次産業 (統治・創造)
        // =================================================
        const labor5 = totalLabor * alloc[5];
        if (labor5 > 5) {
            const prod5 = p.industry.quinary;
            const isCapital = (p.settlement === '首都');
            const rankBonus = isCapital ? 5 : (p.settlement === '都市' || p.settlement === '領都' ? 2 : 1);

            // 王政・行政: 自国IDがある場合
            if (p.nationId > 0) {
                prod5['行政・税収'] = labor5 * 0.1 * rankBonus * 100;
            }

            // ギルド運営
            prod5['ギルド統括'] = labor5 * 0.1 * rankBonus * 50;

            // 芸術・文化
            prod5['芸術・文化'] = labor5 * 0.2 * (1 + p.manaValue);

            // 創造的魔法 (非常に稀)
            if (p.manaRank === 'S' || isCapital) {
                prod5['世界儀式'] = labor5 * 0.1 * p.manaValue * 500;
            }
        }

        // =================================================
        // 食料需給計算 (既存ロジックの維持)
        // =================================================
        const totalDemand = p.population * settlementInfo.consumption_t_per_person;
        let totalSupply = 0;

        // 第一次産業で生産された食料品目を集計
        const foodItems = ['小麦', '大麦', '雑穀', '稲', '魚介類', '狩猟肉', '牧畜肉', '家畜肉', '乳製品', '果物'];
        foodItems.forEach(item => {
            if (prod1[item]) {
                totalSupply += prod1[item];
            }
        });

        p.surplus['食料'] = Math.max(0, totalSupply - totalDemand);
        p.shortage['食料'] = Math.max(0, totalDemand - totalSupply);
    });

    // 第2パス: 統計、施設、交通、生活水準
    generateCityCharacteristics(allHexes);
    calculateDemographics(allHexes);
    calculateFacilities(allHexes);
    calculateTerritoryAggregates(allHexes);
    await calculateRoadTraffic(allHexes, addLogMessage);
    calculateLivingConditions(allHexes);
    return allHexes;
}

export function generateCityCharacteristics(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        p.characteristics = [];

        // 特産品
        if (p.industry.primary['特産チーズ']) p.characteristics.push('特産品: チーズ');
        if (p.industry.primary['高級肉']) p.characteristics.push('特産品: 高級肉');
        if (p.industry.primary['魚介類'] > 500) p.characteristics.push('特産品: 海産物');
        if (p.industry.secondary['織物'] > 200) p.characteristics.push('特産品: 織物');
        if (p.industry.secondary['酒(果実)'] > 100) p.characteristics.push('特産品: 果実酒');

        // 基幹サービス
        if (p.industry.tertiary['医療・教会'] > 100) p.characteristics.push('基幹: 医療・教会');
        if (p.industry.tertiary['宿屋・酒場'] > 200) p.characteristics.push('基幹: 観光・宿泊');

        // 文化・祭礼
        if (p.industry.quinary['芸術・文化'] > 50) p.characteristics.push('文化: 芸術の都');
        if (p.industry.quinary['世界儀式'] > 0) p.characteristics.push('文化: 聖地');

        // 戦略的役割
        if (p.industry.quaternary['戦略・軍事'] > 100) p.characteristics.push('戦略: 軍事拠点');
        if (p.industry.quaternary['魔法研究'] > 100) p.characteristics.push('戦略: 魔導研究');

        // 象徴・ブランド
        if (p.settlement === '首都') p.characteristics.push('象徴: 王都');
        if (p.population > 10000) p.characteristics.push('象徴: 大都市');
    });
    return allHexes;
}

export function calculateDemographics(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.population <= 0) return;

        const totalPop = p.population;
        const demographics = {};

        // 職業人口の推計 (産業配分に基づく)
        // 第一次
        demographics['農民'] = Math.floor(totalPop * 0.4 * (p.agriPotential || 0.5));
        demographics['漁師'] = Math.floor(totalPop * 0.1 * (p.fishingPotential || 0));
        demographics['鉱夫'] = Math.floor(totalPop * 0.1 * (p.miningPotential || 0));
        demographics['木こり'] = Math.floor(totalPop * 0.1 * (p.forestPotential || 0));
        demographics['畜夫'] = Math.floor(totalPop * 0.1 * ((p.pastoralPotential || 0) + (p.livestockPotential || 0)));

        // 第二次
        demographics['職人'] = Math.floor(totalPop * 0.1);

        // 第三次
        demographics['商人'] = Math.floor(totalPop * 0.05);

        // 第四次・第五次
        demographics['学者'] = Math.floor(totalPop * 0.02);
        demographics['兵士'] = Math.floor(totalPop * 0.03);
        demographics['官僚'] = Math.floor(totalPop * 0.01);
        demographics['聖職者'] = Math.floor(totalPop * 0.02);

        p.demographics = demographics;
    });
    return allHexes;
}

export function calculateFacilities(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        p.facilities = [];

        if (p.population <= 0) return;

        // 基本施設
        if (p.population > 100) p.facilities.push('集会所');
        if (p.population > 500) p.facilities.push('市場');
        if (p.population > 1000) p.facilities.push('宿屋');

        // 産業施設
        if (p.industry.secondary['武具・道具'] > 50) p.facilities.push('鍛冶屋');
        if (p.industry.secondary['織物'] > 50) p.facilities.push('機織り小屋');
        if (p.industry.secondary['酒(穀物)'] > 50 || p.industry.secondary['酒(果実)'] > 50) p.facilities.push('酒造所');

        // 港湾・水運
        const isCoastal = p.isCoastal;
        const isLakeside = p.isLakeside || (h.neighbors.some(n => allHexes[n].properties.isWater) && !isCoastal);

        if (isCoastal && p.population > 500) p.facilities.push('港');
        if (isCoastal && p.population > 5000) p.facilities.push('大型造船所');
        if (isLakeside && p.population > 100) p.facilities.push('渡し場');
        if (isLakeside && p.population > 1000) p.facilities.push('桟橋');

        // 特殊施設
        if (p.industry.quaternary['魔法研究'] > 50) p.facilities.push('魔導塔');
        if (p.industry.quaternary['学問・歴史'] > 50) p.facilities.push('図書館');
        if (p.industry.quinary['芸術・文化'] > 50) p.facilities.push('劇場');
        if (p.industry.quinary['世界儀式'] > 0) p.facilities.push('大聖堂');

        // 物流能力
        const wagonCount = Math.floor(p.population / 60);
        const draftAnimals = Math.floor(wagonCount * 2.2);
        const drivers = Math.floor(wagonCount * 1.3);

        // 役畜の種類を決定
        let animalType = '馬';
        const climate = p.climateZone || '';
        const vegetation = p.vegetation || '';
        const terrain = p.terrainType || '';

        if (climate.includes('ツンドラ') || climate.includes('氷雪')) {
            animalType = 'トナカイ';
            if (p.population < 500) animalType = '犬'; // 小規模集落は犬ぞり
        } else if (climate.includes('砂漠')) {
            animalType = 'ラクダ';
        } else if (climate.includes('熱帯')) {
            if (p.isAlluvial || p.industry.primary['稲']) {
                animalType = '水牛';
            } else if (vegetation === '密林') {
                animalType = '象';
            }
        } else if (terrain === '山岳' || terrain === '山地') {
            animalType = 'ラバ';
            if (p.population < 1000) animalType = 'ロバ';
        } else if (p.industry.primary['小麦'] || p.industry.primary['大麦']) {
            if ((h.col + h.row) % 2 === 0) animalType = '牛';
        }

        p.logistics = {
            wagons: wagonCount,
            animals: draftAnimals,
            animalType: animalType,
            drivers: drivers
        };
    });
    return allHexes;
}

export function calculateTerritoryAggregates(allHexes) {
    // 支配領域の集計
    allHexes.forEach(h => {
        if (['首都', '都市', '領都'].includes(h.properties.settlement)) {
            h.properties.territoryStats = {
                totalPopulation: h.properties.population,
                totalFoodProduction: 0,
                settlementCounts: { [h.properties.settlement]: 1 }
            };
        }
    });

    allHexes.forEach(h => {
        const p = h.properties;
        if (p.parentHexId !== undefined && p.parentHexId !== null) {
            const parentIndex = p.parentHexId;
            const parentHex = allHexes[parentIndex];
            if (parentHex && parentHex.properties.territoryStats) {
                const stats = parentHex.properties.territoryStats;
                stats.totalPopulation += p.population;

                let foodProd = 0;
                const foodItems = ['小麦', '大麦', '雑穀', '稲', '魚介類', '狩猟肉', '牧畜肉', '家畜肉', '乳製品', '果物'];
                foodItems.forEach(item => {
                    if (p.industry.primary[item]) foodProd += p.industry.primary[item];
                });
                stats.totalFoodProduction += foodProd;

                stats.settlementCounts[p.settlement] = (stats.settlementCounts[p.settlement] || 0) + 1;
            }
        }
    });
    return allHexes;
}

export async function calculateRoadTraffic(allHexes, addLogMessage) {
    // Reset traffic
    allHexes.forEach(h => {
        h.properties.roadUsage = 0;
        h.properties.roadLoss = 0;
    });

    // 1. Hierarchy Traffic (Tax/Tribute from child to parent)
    for (const h of allHexes) {
        const p = h.properties;
        if (p.parentHexId !== undefined && p.parentHexId !== null) {
            const parent = allHexes[p.parentHexId];
            if (parent) {
                const path = findAStarPath({
                    start: { x: h.col, y: h.row },
                    goal: { x: parent.col, y: parent.row },
                    getNeighbors: (node) => {
                        const idx = getIndex(node.x, node.y);
                        const hex = allHexes[idx];
                        if (!hex) return [];
                        return hex.neighbors.map(nIdx => {
                            const nHex = allHexes[nIdx];
                            return { x: nHex.col, y: nHex.row };
                        });
                    },
                    heuristic: (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
                    cost: (a, b) => {
                        const idx = getIndex(b.x, b.y);
                        const hex = allHexes[idx];
                        // Road level reduces cost
                        const roadLevel = hex.properties.roadLevel || 0;
                        return 10 - roadLevel;
                    }
                });

                if (path && path.path) {
                    const volume = (p.population || 0) * 0.01;
                    path.path.forEach(node => {
                        const idx = getIndex(node.x, node.y);
                        if (allHexes[idx]) allHexes[idx].properties.roadUsage += volume;
                    });
                }
            }
        }
    }

    // 2. Trade Traffic (Between major cities)
    const cities = allHexes.filter(h => ['首都', '都市', '領都'].includes(h.properties.settlement));
    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
            const c1 = cities[i];
            const c2 = cities[j];
            const dist = Math.abs(c1.col - c2.col) + Math.abs(c1.row - c2.row);
            if (dist < 30) {
                const path = findAStarPath({
                    start: { x: c1.col, y: c1.row },
                    goal: { x: c2.col, y: c2.row },
                    getNeighbors: (node) => {
                        const idx = getIndex(node.x, node.y);
                        const hex = allHexes[idx];
                        if (!hex) return [];
                        return hex.neighbors.map(nIdx => {
                            const nHex = allHexes[nIdx];
                            return { x: nHex.col, y: nHex.row };
                        });
                    },
                    heuristic: (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
                    cost: (a, b) => {
                        const idx = getIndex(b.x, b.y);
                        const hex = allHexes[idx];
                        const roadLevel = hex.properties.roadLevel || 0;
                        return 10 - roadLevel;
                    }
                });
                if (path && path.path) {
                    const volume = 100;
                    path.path.forEach(node => {
                        const idx = getIndex(node.x, node.y);
                        if (allHexes[idx]) allHexes[idx].properties.roadUsage += volume;
                    });
                }
            }
        }
    }
    return allHexes;
}

export function calculateLivingConditions(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        if (p.population <= 0) return;

        const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement || '散居'];
        const totalDemand = p.population * (settlementInfo ? settlementInfo.consumption_t_per_person : 1.0);

        // 供給 = 自給 + 輸入
        let localSupply = 0;
        const foodItems = ['小麦', '大麦', '雑穀', '稲', '魚介類', '狩猟肉', '牧畜肉', '家畜肉', '乳製品', '果物'];
        foodItems.forEach(item => {
            if (p.industry.primary[item]) localSupply += p.industry.primary[item];
        });

        const imports = p.imports ? (p.imports['食料'] || 0) : 0;
        const totalSupply = localSupply + imports;

        p.selfSufficiencyRate = (totalDemand > 0) ? (localSupply / totalDemand) : 1.0;

        // 実質不足
        const netShortage = Math.max(0, totalDemand - totalSupply);
        p.netShortage = netShortage;

        // 価格計算 (上限3.0)
        let price = 1.0;
        if (totalDemand > 0) {
            const shortageRate = netShortage / totalDemand;
            price = 1.0 + (shortageRate * 2.0); // 不足率100%で価格3.0
        }
        price = Math.min(3.0, Math.max(0.5, price));
        p.priceIndex = price;

        // 幸福度計算
        let happiness = 50; // 基準
        if (netShortage > 0) {
            happiness -= (netShortage / totalDemand) * 50;
        }
        if (price > 1.5) {
            happiness -= (price - 1.5) * 10;
        }
        // 産業によるボーナス
        if (p.industry.tertiary['医療・教会'] > 0) happiness += 5;
        if (p.industry.quinary['芸術・文化'] > 0) happiness += 5;

        happiness = Math.max(0, Math.min(100, happiness));
        p.happiness = happiness;

        // InfoWindow用のオブジェクト構造を作成
        p.livingConditions = {
            prices: {
                food: price,
                necessities: price,
                luxuries: price * 1.2,
                high_luxuries: price * 1.5
            },
            happiness: happiness,
            security: 100 - (p.monsterRank ? (p.monsterRank === 'S' ? 50 : (p.monsterRank === 'A' ? 30 : (p.monsterRank === 'B' ? 20 : 10))) : 0),
            poverty: (netShortage / totalDemand) || 0,
            hunger: (netShortage / totalDemand) || 0,
            luxury: 0.5,
            tax: p.population * 10
        };
    });
    return allHexes;
}
