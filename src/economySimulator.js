// ================================================================
// GeoForge System - 経済シミュレーションモジュール (v2.0 - 産業階層・完全農業ロジック統合版)
// ================================================================

import * as config from './config.js';
import { getIndex } from './utils.js';

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
            const climate = p.climateZone;
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

            // 薬草 (魔法産業の基礎 - 新規追加要素だが既存ロジックと競合しない形で配置)
            if (p.manaValue > 0.3) {
                prod1['薬草'] = workers.agri * 0.05 * p.manaValue * 10; 
            }
        }

        // ---------------------------------------------------------
        // 【その他 第一次産業】
        // ---------------------------------------------------------
        
        // 漁業
        if (workers.fish > 0.1) {
            const laborYield = workers.fish * C.YIELD_PER_WORKER.FISHING * p.fishingPotential;
            // 資源限界チェック (面積ベース)
            const resourceLimit = config.HEX_AREA_HA * C.MAX_YIELD_PER_HA.FISHING; 
            prod1['魚介類'] = Math.min(laborYield, resourceLimit);
        }

        // 林業
        if (workers.forest > 0.1) {
             prod1['木材'] = workers.forest * C.YIELD_PER_WORKER.FORESTRY * p.forestPotential;
        }

        // 鉱業
        if (workers.mining > 0.1) {
            prod1['鉱石'] = workers.mining * C.YIELD_PER_WORKER.MINING * p.miningPotential;
            // 魔鉱石 (魔力依存)
            if (p.manaValue > 0.5) {
                prod1['魔鉱石'] = prod1['鉱石'] * p.manaValue * 0.1;
            }
        }

        // 牧畜 (遊牧的)
        if (workers.pastoral > 0.1) {
            prod1['牧畜肉'] = workers.pastoral * C.YIELD_PER_WORKER.PASTORAL_MEAT * p.pastoralPotential;
            prod1['乳製品'] = workers.pastoral * C.YIELD_PER_WORKER.PASTORAL_DAIRY * p.pastoralPotential;
            prod1['革'] = workers.pastoral * 0.05 * p.pastoralPotential;
            
            // 魔獣素材 (高ランク魔物地域での牧畜)
            if (p.monsterRank && ['A', 'B'].includes(p.monsterRank)) {
                prod1['魔獣素材'] = workers.pastoral * 0.01;
            }
        }

        // 家畜 (定住的)
        if (workers.livestock > 0.1) {
            prod1['家畜肉'] = workers.livestock * C.YIELD_PER_WORKER.LIVESTOCK_MEAT * p.livestockPotential;
        }

        // 狩猟 (人口の一部が狩人として活動 - 設定値に基づく)
        const hunterPopulation = p.population * settlementInfo.hunter_rate;
        if (hunterPopulation > 0.1 && p.huntingPotential > 0) {
            const laborYield = hunterPopulation * config.HUNTING_PARAMS.BASE_HUNTING_YIELD_T_PER_HUNTER * p.huntingPotential;
            const resourceYield = config.HEX_AREA_HA * config.HUNTING_PARAMS.MAX_HUNTING_YIELD_T_PER_HA * p.huntingPotential;
            prod1['狩猟肉'] = Math.min(laborYield, resourceYield);
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
        const resourceFiber = (prod1['革'] || 0) + (prod1['雑穀'] || 0) * 0.2; 
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
        // 食料需給計算前に余剰予測を行うのは難しいため、ここでは生産能力としての酒造を計算
        // 実際の生産量は、後段の余剰計算後に補正される可能性があるが、ここでは産業規模として算出
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
        prod3['商業・交易'] = labor3 * 0.4 * roadBonus * I.COMMERCE_BASE;

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
                prod5['行政・税収'] = labor5 * 0.4 * rankBonus * 100;
            }

            // ギルド運営
            prod5['ギルド統括'] = labor5 * 0.3 * rankBonus * 50;

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
        
        const balance = totalSupply - totalDemand;

        // 余剰・不足の計算
        if (balance > 0) { p.surplus['食料'] = balance.toFixed(1); }
        else { p.shortage['食料'] = Math.abs(balance).toFixed(1); }
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

        // 集計の初期値を「ハブ自身の値」からスタートさせる
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