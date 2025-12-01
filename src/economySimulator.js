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

    // 2nd Pass: Calculate Demographics, Facilities, and Living Conditions
    allHexes.forEach(h => {
        h.properties.demographics = calculateDemographics(h);
        h.properties.facilities = calculateFacilities(h);
    });

    allHexes.forEach(h => {
        h.properties.livingConditions = calculateLivingConditions(h, allHexes);
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
            population: hubProps.population,
            cultivatedArea: hubProps.cultivatedArea,
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

            // 3. さらにその下の子孫をキューに追加
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

/**
 * 街道の交通量（月間輸送量：トン）を計算する
 * ユーザー定義: 街などのキャラバンは荷馬車20台を1個小隊として、数個小隊が年に6回ほど行動する。
 * 1回のキャラバン = 20台 * 3小隊 = 60台 と仮定。
 * 年6回 = 2ヶ月に1回 => 月あたり0.5回。
 * 月間荷馬車数 = 30台。
 * 荷馬車1台 = 積載量1トン (御者1人+護衛1人=2人) とする。
 * 
 * 追加要件:
 * 1. 街道上の魔物や治安に応じた輸送成功量と損失を加味する。
 * 2. 海上輸送も考慮する（船種により大量輸送可能）。
 * 
 * @param {Array<object>} allHexes - 全ヘックスデータ
 * @param {Array<object>} roadPaths - 生成された全道路パス
 * @param {Function} addLogMessage - ログ出力用
 */
export async function calculateRoadTraffic(allHexes, roadPaths, addLogMessage) {
    if (!roadPaths) return allHexes;
    await addLogMessage("街道および海路の交通量（月間輸送量・損失）を計算しています...");

    // 1. 初期化: 全ヘックスの交通量と損失をリセット
    allHexes.forEach(h => {
        h.properties.roadUsage = 0;
        h.properties.roadLoss = 0;
    });

    // -------------------------------------------------------
    // A. 陸路の交通量計算
    // -------------------------------------------------------
    roadPaths.forEach(route => {
        if (!route.path || route.path.length < 2) return;

        const startNode = route.path[0];
        const endNode = route.path[route.path.length - 1];
        const startHex = allHexes[getIndex(startNode.x, startNode.y)];
        const endHex = allHexes[getIndex(endNode.x, endNode.y)];

        if (!startHex || !endHex) return;

        const pStart = startHex.properties;
        const pEnd = endHex.properties;

        let trafficTons = 0;

        // --- 1. 定期交易キャラバン ---
        const getBaseTradeVolume = (settlement) => {
            if (settlement === '首都') return 300;
            if (settlement === '都市') return 150;
            if (settlement === '領都') return 100;
            if (settlement === '街') return 30;
            if (settlement === '町') return 5;
            return 1;
        };

        // 相乗平均 (幾何平均) を採用することで、片方が小さければ交通量も抑制されるようにする
        const volA = getBaseTradeVolume(pStart.settlement);
        const volB = getBaseTradeVolume(pEnd.settlement);
        const baseVolume = Math.sqrt(volA * volB);

        const distanceDecay = Math.max(0.1, 1.0 - (route.travelDays || 0) / 60);
        trafficTons += baseVolume * distanceDecay;

        // --- 2. 物流需給 (食料・資源の輸送) ---
        const startFoodSurplus = parseFloat(pStart.surplus['食料'] || 0);
        const endFoodSurplus = parseFloat(pEnd.surplus['食料'] || 0);
        const startFoodShortage = parseFloat(pStart.shortage['食料'] || 0);
        const endFoodShortage = parseFloat(pEnd.shortage['食料'] || 0);

        let foodTraffic = 0;
        if (startFoodSurplus > 0 && endFoodShortage > 0) foodTraffic += Math.min(startFoodSurplus, endFoodShortage);
        if (endFoodSurplus > 0 && startFoodShortage > 0) foodTraffic += Math.min(endFoodSurplus, startFoodShortage);

        // 食料需給は「年間」なので、月間に換算して加算 (1/12)
        trafficTons += foodTraffic / 12;

        const getResourceExport = (p) => {
            let out = 0;
            if (p.production) {
                out += (p.production['鉱石'] || 0);
                out += (p.production['木材'] || 0);
                out += (p.production['鉄'] || 0);
                out += (p.production['魚介類'] || 0);
            }
            return out * 0.5;
        };
        if (['首都', '都市', '領都'].includes(pStart.settlement)) trafficTons += getResourceExport(pEnd);
        if (['首都', '都市', '領都'].includes(pEnd.settlement)) trafficTons += getResourceExport(pStart);

        // --- 3. 租税輸送 ---
        let taxTraffic = 0;
        if (pStart.parentHexId === getIndex(endNode.x, endNode.y)) {
            let totalProd = 0;
            for (let k in pStart.production) totalProd += pStart.production[k];
            taxTraffic += totalProd * 0.1;
        }
        if (pEnd.parentHexId === getIndex(startNode.x, startNode.y)) {
            let totalProd = 0;
            for (let k in pEnd.production) totalProd += pEnd.production[k];
            taxTraffic += totalProd * 0.1;
        }
        trafficTons += taxTraffic;

        // --- 4. 損失計算 (魔物ランク・治安) ---
        // パス上の最大危険度または累積危険度を計算
        let totalRisk = 0;
        route.path.forEach(node => {
            const h = allHexes[getIndex(node.x, node.y)];
            const rank = h.properties.monsterRank;
            // ランクごとの損失率 (通過するごとに発生)
            // S: 5%, A: 2%, B: 1%, C: 0.5%, D: 0.1%
            if (rank === 'S') totalRisk += 0.05;
            else if (rank === 'A') totalRisk += 0.02;
            else if (rank === 'B') totalRisk += 0.01;
            else if (rank === 'C') totalRisk += 0.005;
            else if (rank === 'D') totalRisk += 0.001;
        });

        // 損失率は最大50%で頭打ち
        const lossRate = Math.min(0.5, totalRisk);
        const lossAmount = trafficTons * lossRate;

        // パス上の全ヘックスに加算
        route.path.forEach(node => {
            const index = getIndex(node.x, node.y);
            const hex = allHexes[index];
            if (hex) {
                hex.properties.roadUsage += trafficTons;
                hex.properties.roadLoss += lossAmount;
            }
        });
    });

    // -------------------------------------------------------
    // B. 海上輸送の計算 (主要港湾間)
    // -------------------------------------------------------
    // 港湾候補: 「首都」「都市」「領都」で、かつ水域に隣接している場所
    const ports = allHexes.filter(h => {
        const p = h.properties;
        if (!['首都', '都市', '領都'].includes(p.settlement)) return false;
        // 隣接ヘックスに水域があるか
        const neighbors = h.neighbors; // neighborsはインデックスの配列と仮定
        return neighbors.some(nIdx => allHexes[nIdx].properties.isWater);
    });

    if (ports.length >= 2) {
        await addLogMessage(`主要港湾数: ${ports.length} - 海路を計算中...`);

        // 港湾間の組み合わせ (総当たりは重いので、距離制限またはハブ＆スポークにする)
        // ここではシンプルに、各港から「最も近い他の3つの港」に対してルートを引く
        for (let i = 0; i < ports.length; i++) {
            const startHex = ports[i];

            // 距離でソートして近い順に3つ選ぶ
            const targets = ports.filter((_, idx) => idx !== i)
                .map(p => ({ hex: p, dist: Math.abs(p.col - startHex.col) + Math.abs(p.row - startHex.row) }))
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 3);

            for (const target of targets) {
                const endHex = target.hex;

                // A* で海路探索
                // コスト関数: 水域なら1、それ以外はInfinity (ただし発着点は陸地なので例外処理必要)
                const seaPath = findAStarPath({
                    start: { x: startHex.col, y: startHex.row },
                    goal: { x: endHex.col, y: endHex.row },
                    getNeighbors: (node) => {
                        const idx = getIndex(node.x, node.y);
                        const h = allHexes[idx];
                        if (!h) return [];
                        return h.neighbors.map(nIdx => {
                            const nHex = allHexes[nIdx];
                            return { x: nHex.col, y: nHex.row };
                        });
                    },
                    heuristic: (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
                    cost: (a, b) => {
                        const idxB = getIndex(b.x, b.y);
                        const hexB = allHexes[idxB];
                        // 目的地なら陸地でもOK
                        if (b.x === endHex.col && b.y === endHex.row) return 1;
                        // 水域ならコスト1
                        if (hexB.properties.isWater) return 1;
                        // それ以外（陸地）は通行不可
                        return Infinity;
                    }
                });

                if (seaPath && seaPath.path.length > 0) {
                    // 海上交通量: 陸路の10倍 (大型船)
                    // 基礎量は都市ランク依存
                    const pStart = startHex.properties;
                    const pEnd = endHex.properties;

                    const getSeaBaseVolume = (settlement) => {
                        if (settlement === '首都') return 3000;
                        if (settlement === '都市') return 1500;
                        if (settlement === '領都') return 1000;
                        return 100;
                    };
                    const seaVolume = (getSeaBaseVolume(pStart.settlement) + getSeaBaseVolume(pEnd.settlement)) / 2;

                    // 海路には魔物による損失も発生する (クラーケンなど)
                    // 海域の魔物ランクは未設定の場合が多いが、便宜上ランダムまたは固定リスク
                    // ここでは一律 1% の海難事故リスクとする
                    const seaLoss = seaVolume * 0.01 * seaPath.path.length; // 距離比例

                    seaPath.path.forEach(node => {
                        const index = getIndex(node.x, node.y);
                        const hex = allHexes[index];
                        if (hex && hex.properties.isWater) {
                            hex.properties.roadUsage += seaVolume;
                            hex.properties.roadLoss += seaLoss;
                        }
                    });
                }
            }
        }
    }

    return allHexes;
}

export function calculateDemographics(hex) {
    const p = hex.properties;
    const totalPop = p.population;
    if (totalPop <= 0) return {};

    const demo = {};

    const settlementType = p.settlement || '散居';
    const alloc = config.INDUSTRY_ALLOCATION[settlementType] || { 1: 0.8, 2: 0.1, 3: 0.1, 4: 0, 5: 0 };
    const settlementInfo = config.SETTLEMENT_PARAMS[settlementType] || { labor_rate: 0.6 };

    const laborPop = totalPop * settlementInfo.labor_rate;

    // A. 上流階級
    let nobleRate = 0;
    if (settlementType === '首都') nobleRate = 0.02;
    else if (settlementType === '都市') nobleRate = 0.01;
    else if (settlementType === '領都') nobleRate = 0.015;
    else if (settlementType === '街') nobleRate = 0.005;

    demo['貴族'] = Math.floor(totalPop * nobleRate);
    demo['騎士'] = Math.floor(demo['貴族'] * 2 + (p.fortress ? 50 : 0));

    // B. 軍事・治安
    let securityRate = 0.01;
    if (p.monsterRank === 'S') securityRate += 0.05;
    else if (p.monsterRank === 'A') securityRate += 0.03;
    else if (p.monsterRank === 'B') securityRate += 0.02;

    if (['首都', '都市', '領都'].includes(settlementType)) securityRate += 0.02;

    const totalSecurity = Math.floor(totalPop * securityRate);
    demo['正規兵'] = Math.floor(totalSecurity * 0.6);
    demo['衛兵・自警団'] = Math.floor(totalSecurity * 0.3);
    demo['傭兵'] = Math.max(0, totalSecurity - demo['正規兵'] - demo['衛兵・自警団']);

    // C. 産業別労働者
    const labor1 = laborPop * alloc[1];
    const pot = {
        agri: p.agriPotential || 0,
        forest: p.forestPotential || 0,
        mining: p.miningPotential || 0,
        fish: p.fishingPotential || 0,
        pastoral: p.pastoralPotential || 0,
        livestock: p.livestockPotential || 0
    };
    const totalPot1 = Object.values(pot).reduce((a, b) => a + b, 0) || 1;

    demo['農夫'] = Math.floor(labor1 * (pot.agri / totalPot1));
    demo['木こり'] = Math.floor(labor1 * (pot.forest / totalPot1));
    demo['鉱夫'] = Math.floor(labor1 * (pot.mining / totalPot1));
    demo['漁師'] = Math.floor(labor1 * (pot.fish / totalPot1));
    demo['牧童'] = Math.floor(labor1 * ((pot.pastoral + pot.livestock) / totalPot1));

    const labor2 = laborPop * alloc[2];
    demo['鍛冶屋'] = Math.floor(labor2 * 0.2);
    demo['職人'] = Math.floor(labor2 * 0.5);
    demo['建築夫'] = Math.floor(labor2 * 0.3);

    const labor3 = laborPop * alloc[3];
    demo['商人'] = Math.floor(labor3 * 0.4);
    demo['宿屋・店員'] = Math.floor(labor3 * 0.3);
    demo['神官・医師・薬師'] = Math.floor(labor3 * 0.1);
    demo['御者・船員'] = Math.floor(labor3 * 0.2);

    const labor4 = laborPop * alloc[4];
    if (labor4 > 0) {
        demo['学者・研究員'] = Math.floor(labor4 * 0.6);
        demo['錬金術師'] = Math.floor(labor4 * 0.4);
    }

    const labor5 = laborPop * alloc[5];
    if (labor5 > 0) {
        demo['官僚・役人'] = Math.floor(labor5 * 0.7);
        demo['芸術家'] = Math.floor(labor5 * 0.3);
    }

    let adventurerRate = 0;
    if (['首都', '都市', '領都', '街'].includes(settlementType)) {
        adventurerRate = 0.005;
        if (p.monsterRank && ['S', 'A', 'B'].includes(p.monsterRank)) adventurerRate *= 3;
    }
    demo['冒険者'] = Math.floor(totalPop * adventurerRate);

    let slumRate = 0;
    if (settlementType === '首都') slumRate = 0.15;
    else if (settlementType === '都市') slumRate = 0.10;
    else if (settlementType === '領都') slumRate = 0.05;

    demo['スラム街住人'] = Math.floor(totalPop * slumRate);

    return demo;
}

export function calculateFacilities(hex) {
    const p = hex.properties;
    const demo = p.demographics || {};
    const facilities = {};

    if (demo['商人']) {
        facilities['商会・商店'] = Math.ceil(demo['商人'] / 5);
        facilities['行商・露店'] = Math.ceil(demo['商人'] / 2);
    }

    if (demo['宿屋・店員']) {
        facilities['宿屋'] = Math.ceil(demo['宿屋・店員'] / 10);
        facilities['酒場・食堂'] = Math.ceil(demo['宿屋・店員'] / 5);
    }

    if (demo['鍛冶屋']) {
        facilities['鍛冶屋'] = Math.ceil(demo['鍛冶屋'] / 3);
    }
    if (demo['職人']) {
        facilities['工房'] = Math.ceil(demo['職人'] / 4);
    }

    if (demo['神官・医師・薬師']) {
        facilities['教会'] = Math.ceil(demo['神官・医師・薬師'] / 5);
        facilities['診療所'] = Math.ceil(demo['神官・医師・薬師'] / 3);
    }

    if (demo['錬金術師']) {
        facilities['魔道具店'] = Math.ceil(demo['錬金術師'] / 10);
    }
    if (demo['冒険者']) {
        facilities['職能ギルド'] = Math.ceil(demo['冒険者'] / 50);
    }

    if (['首都', '都市', '領都'].includes(p.settlement)) {
        facilities['役所'] = 1;
        if (p.settlement === '首都') facilities['王城'] = 1;
        if (p.settlement === '領都') facilities['領主館'] = 1;
    }

    if (p.settlement === '村') {
        facilities['集会場'] = 1;
    }

    return facilities;
}

export function calculateLivingConditions(h, allHexes) {
    const p = h.properties;
    const conditions = {
        hunger: 0,
        poverty: 0,
        luxury: 0,
        security: 50,
        prices: { food: 1.0, necessities: 1.0, luxury: 1.0 },
        tax: 0,
        happiness: 50
    };

    if (!p.population || p.population <= 0) return conditions;

    // 1. Hunger
    const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement] || config.SETTLEMENT_PARAMS['散居'];
    const consumptionUnit = settlementInfo ? settlementInfo.consumption_t_per_person : 0.1;
    const totalFoodDemand = p.population * consumptionUnit;
    const foodShortage = p.shortage && p.shortage['食料'] ? parseFloat(p.shortage['食料']) : 0;
    
    let baseHunger = Math.min(1.0, foodShortage / (totalFoodDemand || 1));
    if (isNaN(baseHunger)) baseHunger = 0;

    // 輸入による飢餓緩和 (User Feedback)
    // 都市部は物流により食料を輸入できるため、飢餓度が下がる
    if (['首都', '都市', '領都', '街'].includes(p.settlement) && (p.roadLevel || 0) >= 3) {
        // 道路レベルと集落規模に応じて緩和
        const importCap = (p.roadLevel || 0) * 0.1; // Lv5なら50%緩和
        baseHunger = Math.max(0, baseHunger - importCap);
    }
    conditions.hunger = baseHunger;

    // 2. Poverty
    const demo = p.demographics || {};
    const poorPop = (demo['浮浪者'] || 0) + (demo['スラム街住人'] || 0) +
                    ((demo['農夫'] || 0) + (demo['鉱夫'] || 0) + (demo['漁師'] || 0) + (demo['木こり'] || 0)) * 0.5;
    conditions.poverty = Math.min(1.0, poorPop / p.population);

    // 3. Luxury
    let luxurySupply = 0;
    if (p.production) {
        luxurySupply += (p.production['酒(穀物)'] || 0) + (p.production['酒(果実)'] || 0);
        luxurySupply += (p.production['織物'] || 0) * 0.5;
        luxurySupply += (p.production['ポーション・魔導具'] || 0) * 2;
        luxurySupply += (p.production['芸術・文化'] || 0) * 5;
    }
    conditions.luxury = Math.min(1.0, luxurySupply / (p.population * 0.01));

    // 4. Security
    let securityScore = 50;
    const securityForces = (demo['衛兵・自警団'] || 0) + (demo['騎士'] || 0) * 5 + (demo['正規兵'] || 0) * 2;
    securityScore += Math.min(30, (securityForces / p.population) * 1000);
    
    const facilities = p.facilities || {};
    if (facilities['兵舎']) securityScore += 5;
    if (facilities['砦']) securityScore += 10;
    if (facilities['役所']) securityScore += 5;
    if (facilities['教会']) securityScore += 3;

    securityScore -= conditions.poverty * 30;
    securityScore -= conditions.hunger * 20;
    
    if (p.monsterRank === 'S') securityScore -= 30;
    else if (p.monsterRank === 'A') securityScore -= 20;
    else if (p.monsterRank === 'B') securityScore -= 10;
    else if (p.monsterRank === 'C') securityScore -= 5;

    conditions.security = Math.max(0, Math.min(100, Math.floor(securityScore)));

    // 5. Prices
    const foodSupplyRate = 1.0 - conditions.hunger;
    conditions.prices.food = foodSupplyRate > 0 ? 1.0 / Math.max(0.1, foodSupplyRate) : 2.0;
    
    let necessitySupply = 0;
    if (p.production) {
        necessitySupply += (p.production['武具・道具'] || 0) + (p.production['織物'] || 0) + (p.production['建築'] || 0);
    }
    const necessityPerCapita = necessitySupply / p.population;
    conditions.prices.necessities = 0.05 / Math.max(0.001, necessityPerCapita);
    conditions.prices.luxury = 1.0 / Math.max(0.1, conditions.luxury);

    for (let key in conditions.prices) {
        conditions.prices[key] = Math.max(0.5, Math.min(3.0, parseFloat(conditions.prices[key].toFixed(2))));
    }

    // 6. Tax
    let estimatedGdp = 0;
    if (p.industry) {
        for (let k in p.industry.primary) estimatedGdp += (p.industry.primary[k] || 0) * 10;
        for (let k in p.industry.secondary) estimatedGdp += (p.industry.secondary[k] || 0) * 20;
        for (let k in p.industry.tertiary) estimatedGdp += (p.industry.tertiary[k] || 0) * 30;
        for (let k in p.industry.quaternary) estimatedGdp += (p.industry.quaternary[k] || 0) * 50;
        for (let k in p.industry.quinary) estimatedGdp += (p.industry.quinary[k] || 0) * 100;
    }
    
    let taxRate = 0.1;
    if (p.settlement === '首都') taxRate += 0.10;
    else if (p.settlement === '都市') taxRate += 0.05;
    
    conditions.tax = Math.floor(estimatedGdp * taxRate);

    // 7. Happiness
    let happinessScore = 50;
    
    // 贅沢度の影響 (User Feedback: 村などは質素でも幸福)
    if (['首都', '都市', '領都'].includes(p.settlement)) {
        happinessScore += conditions.luxury * 20; // 都市部は贅沢が重要
    } else {
        happinessScore += conditions.luxury * 10; // 村落部はそこまで重要ではない
        happinessScore += 10; // 質素な暮らしボーナス (コミュニティの絆)
    }

    happinessScore += (conditions.security - 50) * 0.5;
    if (facilities['教会']) happinessScore += 5;
    if (facilities['劇場・美術館']) happinessScore += 10;
    if (facilities['診療所']) happinessScore += 5;
    
    happinessScore -= conditions.hunger * 50;
    happinessScore -= conditions.poverty * 30;
    if (conditions.prices.food > 1.5) happinessScore -= 10;
    if (conditions.prices.necessities > 1.5) happinessScore -= 5;
    
    const taxPerCapita = conditions.tax / p.population;
    if (taxPerCapita > 5) happinessScore -= 5;
    if (taxPerCapita > 10) happinessScore -= 10;

    // A. Connectivity
    const connectivity = (p.roadLevel || 0) * 2;
    happinessScore += connectivity;

    // B. Distance to Ruler
    if (p.parentHexId !== null && p.parentHexId !== undefined) {
        const parent = allHexes[p.parentHexId];
        if (parent) {
            const dist = Math.abs(h.col - parent.col) + Math.abs(h.row - parent.row);
            if (dist > 15) happinessScore -= 10;
            else if (dist > 8) happinessScore -= 5;
            else if (dist < 3) happinessScore += 5;
        }
    } else {
        if (p.settlement !== '首都') happinessScore -= 5;
    }

    // C. Crowding
    if (p.population > 20000) happinessScore -= 10;
    else if (p.population > 5000) happinessScore -= 5;
    else if (p.population < 100) happinessScore -= 5;

    conditions.happiness = Math.max(0, Math.min(100, Math.floor(happinessScore)));

    return conditions;
}