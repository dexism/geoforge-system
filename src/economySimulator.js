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

    // 第0パス: 船舶保有数の計算 (漁業計算より前に行う必要がある)
    calculateShipOwnership(allHexes);

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
        // --- 漁業 ---
        if (workers.fish > 0) {
            let totalYield = 0;
            let remainingFishers = workers.fish;

            // 1. 船による漁獲
            if (p.ships) {
                Object.entries(p.ships).forEach(([shipName, count]) => {
                    const typeKey = Object.keys(config.SHIP_TYPES).find(key => config.SHIP_TYPES[key].name === shipName);
                    if (!typeKey) return;

                    const shipData = config.SHIP_TYPES[typeKey];
                    if (shipData && shipData.fishing_capacity > 0) {
                        // この船種に割り当て可能な最大漁師数
                        const maxFishersForType = count * shipData.fishing_capacity;
                        const assignedFishers = Math.min(remainingFishers, maxFishersForType);

                        if (assignedFishers > 0) {
                            // 水域係数の決定
                            let waterCoeff = 1.0;
                            // 船種から水域を推測
                            if (typeKey.includes('lake')) waterCoeff = config.WATER_BODY_COEFFICIENTS.LAKE;
                            else if (typeKey.includes('river')) waterCoeff = config.WATER_BODY_COEFFICIENTS.RIVER;
                            else waterCoeff = config.WATER_BODY_COEFFICIENTS.OCEAN;

                            // 漁獲量 = 漁師数 * 船種係数 * 水域係数
                            totalYield += assignedFishers * shipData.fishing_coefficient * waterCoeff;

                            remainingFishers -= assignedFishers;
                        }
                    }
                });
            }

            // 2. 船に乗れない漁師 (岸からの釣りなど)
            if (remainingFishers > 0) {
                // 効率は低い (小舟の半分程度と仮定)
                totalYield += remainingFishers * 0.5;
            }

            // 最終的な補正 (fishingPotentialなど)
            prod1['魚介類'] = totalYield * p.fishingPotential;
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
    // calculateRoadTraffic is called separately in main.js with roadPaths
    calculateLivingConditions(allHexes);
    return allHexes;
}

export function calculateShipOwnership(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        p.ships = {}; // 初期化

        const settlementLevel = p.settlement || '散居';
        if (!config.SHIP_AVAILABILITY[settlementLevel]) return;

        // 水域判定
        const isCoastal = p.isCoastal;
        const isLakeside = p.isLakeside || (h.neighbors.some(n => allHexes[n].properties.isWater) && !isCoastal);
        const isRiver = p.rivers && p.rivers.some(r => r > 0); // 川があるか

        if (!isCoastal && !isLakeside && !isRiver) return;

        // 保有可能な船種リスト
        const availTypes = config.SHIP_AVAILABILITY[settlementLevel];

        // 1. 基準艦数 (H0) の決定
        let minShips = 0;
        let maxShips = 0;

        // 基準テーブル (集落規模ベース)
        if (settlementLevel === '村') { minShips = 8; maxShips = 20; }
        else if (settlementLevel === '町') { minShips = 25; maxShips = 60; }
        else if (settlementLevel === '街') { minShips = 50; maxShips = 100; }
        else if (['領都', '都市'].includes(settlementLevel)) { minShips = 120; maxShips = 200; }
        else if (settlementLevel === '首都') { minShips = 220; maxShips = 380; }

        // 海に面している場合は基準数を増やす
        if (isCoastal) {
            minShips = Math.floor(minShips * 1.5);
            maxShips = Math.floor(maxShips * 1.5);
        }

        // ランダムな基準値
        let baseShips = minShips + Math.floor(Math.random() * (maxShips - minShips + 1));

        // 2. スケーリング (人口・交易・水系)
        const popFactor = (p.population / 1000) * 0.8;

        // 交易係数 T (0-3)
        let tradeFactor = 0;
        if (settlementLevel === '町') tradeFactor = 1;
        else if (settlementLevel === '街') tradeFactor = 2;
        else if (['領都', '都市', '首都'].includes(settlementLevel)) tradeFactor = 3;

        // 水系係数 P (0-2)
        let waterFactor = 0;
        if (isCoastal) waterFactor = 1;
        if (p.fishingPotential > 0.7) waterFactor += 1; // 良港の代替指標

        const totalShips = Math.floor(baseShips + popFactor + (10 * tradeFactor) + (8 * waterFactor));

        // 3. タイプ別配分 (Mix) - 水域に応じて動的に決定
        let ratios = {};

        // 配分ロジック: 利用可能な水域に応じて比率を変える
        // 優先度: 海 > 湖 > 川 (ただし併用もあり)

        if (isCoastal) {
            // 海岸集落
            if (settlementLevel === '村') {
                ratios = { 'dinghy': 0.90, 'small_trader': 0.10 };
            } else if (settlementLevel === '町') {
                ratios = { 'dinghy': 0.65, 'small_trader': 0.30, 'coastal_trader': 0.05 };
            } else if (settlementLevel === '街') {
                ratios = { 'dinghy': 0.55, 'small_trader': 0.30, 'coastal_trader': 0.15 };
            } else if (['領都', '都市'].includes(settlementLevel)) {
                ratios = { 'dinghy': 0.45, 'small_trader': 0.25, 'coastal_trader': 0.20, 'medium_merchant': 0.10 };
            } else if (settlementLevel === '首都') {
                ratios = { 'dinghy': 0.40, 'small_trader': 0.25, 'coastal_trader': 0.20, 'medium_merchant': 0.10, 'large_sailing_ship': 0.05 };
            }
        } else if (isLakeside) {
            // 湖畔集落
            if (settlementLevel === '村') {
                ratios = { 'lake_boat': 0.90, 'dinghy': 0.10 }; // dinghyも汎用小舟として少し混ぜる
            } else if (settlementLevel === '町') {
                ratios = { 'lake_boat': 0.70, 'lake_trader': 0.30 };
            } else if (settlementLevel === '街') {
                ratios = { 'lake_boat': 0.60, 'lake_trader': 0.40 };
            } else {
                ratios = { 'lake_boat': 0.50, 'lake_trader': 0.50 };
            }
        } else if (isRiver) {
            // 河川集落
            if (settlementLevel === '村') {
                ratios = { 'river_canoe': 0.90, 'dinghy': 0.10 };
            } else if (settlementLevel === '町') {
                ratios = { 'river_canoe': 0.70, 'river_barge': 0.30 };
            } else if (settlementLevel === '街') {
                ratios = { 'river_canoe': 0.60, 'river_barge': 0.40 };
            } else {
                ratios = { 'river_canoe': 0.50, 'river_barge': 0.50 };
            }
        }

        // 4. 配分適用
        Object.entries(ratios).forEach(([typeKey, ratio]) => {
            if (availTypes.includes(typeKey)) {
                let count = Math.floor(totalShips * ratio);

                // ユーザー指定の調整係数 (v2.7.6)
                // 商船・大型漁船(small_trader): 50%
                // 沿岸交易船(coastal_trader): 50%
                // 中型商船(medium_merchant): 30%
                // 大型帆船(large_sailing_ship): 20%
                if (typeKey === 'small_trader' || typeKey === 'lake_trader') count = Math.floor(count * 0.5);
                else if (typeKey === 'coastal_trader') count = Math.floor(count * 0.5);
                else if (typeKey === 'medium_merchant') count = Math.floor(count * 0.3);
                else if (typeKey === 'large_sailing_ship') count = Math.floor(count * 0.2);

                if (count > 0) {
                    const shipName = config.SHIP_TYPES[typeKey].name;
                    p.ships[shipName] = count;
                }
            }
        });

        // 外洋対応最低保証 (沿岸のみ)
        if (isCoastal) {
            let minOcean = 0;
            if (settlementLevel === '街') minOcean = Math.floor(Math.random() * 5);
            else if (['領都', '都市'].includes(settlementLevel)) minOcean = 2 + Math.floor(Math.random() * 11);
            else if (settlementLevel === '首都') minOcean = 8 + Math.floor(Math.random() * 18);

            if (minOcean > 0) {
                const mediumName = config.SHIP_TYPES['medium_merchant'].name;
                const largeName = config.SHIP_TYPES['large_sailing_ship'].name;

                let currentOcean = (p.ships[mediumName] || 0) + (p.ships[largeName] || 0);
                if (currentOcean < minOcean) {
                    if (availTypes.includes('medium_merchant')) {
                        p.ships[mediumName] = (p.ships[mediumName] || 0) + (minOcean - currentOcean);
                    }
                }
            }
        }

        // --- 軍艦の保有 (v2.7.6) ---
        // 沿岸部の集落のみ軍艦を保有する可能性がある (河川・湖沼の警備艇は一旦除外または簡易扱い)
        if (isCoastal && config.NAVAL_SETTINGS) {
            const navalRatio = config.NAVAL_SETTINGS.STANDING_NAVY_RATIO[settlementLevel] || 0;
            if (navalRatio > 0) {
                // 常備海軍人数
                const navalPersonnel = Math.floor(p.population * navalRatio);

                // 艦隊構成の決定
                // 予算(人員)の配分: 旗艦 > 戦列艦 > ガレー > 護衛艦 > 警備艇
                // 簡易的に、上位の船から順に人員を割り当てていく

                let remainingPersonnel = navalPersonnel * 0.6; // 船員枠として6割を充てる (残りは海兵・陸上支援)

                const warshipTypes = config.WARSHIP_TYPES;
                const availableWarships = [];

                // 保有可能な軍艦レベル
                if (settlementLevel === '首都') availableWarships.push('flagship', 'ship_of_the_line', 'galley', 'escort_ship', 'patrol_boat');
                else if (['領都', '都市'].includes(settlementLevel)) availableWarships.push('ship_of_the_line', 'galley', 'escort_ship', 'patrol_boat');
                else if (settlementLevel === '街') availableWarships.push('galley', 'escort_ship', 'patrol_boat');
                else if (settlementLevel === '町') availableWarships.push('patrol_boat');

                availableWarships.forEach(typeKey => {
                    const shipData = warshipTypes[typeKey];
                    if (!shipData) return;

                    // この船種に必要な船員数 (skipper + crew)
                    const crewPerShip = (shipData.crew_requirements.skipper || 0) + (shipData.crew_requirements.crew || 0);
                    if (crewPerShip <= 0) return;

                    // 配分比率 (上位ほど少なく、下位ほど多く)
                    // 簡易ロジック: 残り人員の一定割合をこの船種に割り当てる
                    let allocRatio = 0.2;
                    if (typeKey === 'patrol_boat') allocRatio = 1.0; // 残り全て
                    else if (typeKey === 'escort_ship') allocRatio = 0.5;

                    const allocPersonnel = remainingPersonnel * allocRatio;
                    let count = Math.floor(allocPersonnel / crewPerShip);

                    // 最低1隻保証 (首都の旗艦など)
                    if (typeKey === 'flagship' && settlementLevel === '首都' && count === 0) count = 1;

                    if (count > 0) {
                        p.ships[shipData.name] = (p.ships[shipData.name] || 0) + count;
                        remainingPersonnel -= count * crewPerShip;
                    }
                });
            }
        }
    });
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

        // 兵士の細分化
        const soldierTotal = Math.floor(totalPop * 0.03);
        if (soldierTotal > 0) {
            // 都市規模や施設によって比率を変えるのが理想だが、まずは基本比率で
            demographics['騎士'] = Math.floor(soldierTotal * 0.05); // エリート
            demographics['正規兵'] = Math.floor(soldierTotal * 0.45); // 主力
            demographics['衛兵・自警団'] = Math.max(0, soldierTotal - demographics['騎士'] - demographics['正規兵']);
        }

        demographics['官僚'] = Math.floor(totalPop * 0.01);
        demographics['聖職者'] = Math.floor(totalPop * 0.02);

        // --- スラム・孤児の推計 (v2.1) ---
        // スラム: 都市部('街'以上)で発生。産業構造の歪みや治安悪化で増えるが、ここでは簡易的に人口の一定割合とする。
        // 街: 3%, 領都: 5%, 都市: 7%, 首都: 10% (仮)
        let slumRate = 0;
        const settlement = p.settlement || '散居';
        if (settlement === '街') slumRate = 0.03;
        else if (settlement === '領都') slumRate = 0.05;
        else if (settlement === '都市') slumRate = 0.07;
        else if (settlement === '首都') slumRate = 0.10;

        if (slumRate > 0) {
            demographics['スラム'] = Math.floor(totalPop * slumRate);
        } else {
            demographics['スラム'] = 0;
        }

        // 孤児: 基本2%。治安(security)が低いと増えるが、この時点ではsecurity計算前なので、
        // 前回のsecurityを使うか、簡易的に固定+ランダムで計算。
        // ここでは基本2% + 魔物ランクによる補正とする。
        let orphanRate = 0.02;
        if (p.monsterRank) {
            if (p.monsterRank === 'S') orphanRate += 0.05;
            else if (p.monsterRank === 'A') orphanRate += 0.03;
            else if (p.monsterRank === 'B') orphanRate += 0.01;
        }
        demographics['孤児'] = Math.floor(totalPop * orphanRate);

        // 水夫の推計 (v2.7.5)
        // 船舶保有数に基づき、必要な船員数を計算
        let totalSailors = 0;
        let totalNavalSailors = 0; // 軍属船員
        let totalMarines = 0;      // 海兵
        let totalNavalOfficers = 0; // 海軍士官

        if (p.ships) {
            Object.entries(p.ships).forEach(([shipName, count]) => {
                // 商船・漁船のチェック
                const civTypeKey = Object.keys(config.SHIP_TYPES).find(key => config.SHIP_TYPES[key].name === shipName);
                if (civTypeKey) {
                    const req = config.SHIP_TYPES[civTypeKey].crew_requirements;
                    if (req) {
                        totalSailors += count * ((req.skipper || 0) + (req.crew || 0));
                    }
                }

                // 軍艦のチェック (v2.7.6)
                const warTypeKey = config.WARSHIP_TYPES ? Object.keys(config.WARSHIP_TYPES).find(key => config.WARSHIP_TYPES[key].name === shipName) : null;
                if (warTypeKey) {
                    const req = config.WARSHIP_TYPES[warTypeKey].crew_requirements;
                    if (req) {
                        totalNavalOfficers += count * (req.skipper || 0); // 艦長クラス
                        totalNavalSailors += count * (req.crew || 0);
                        totalMarines += count * (req.marine || 0);
                    }
                }
            });
        }

        if (totalSailors > 0) demographics['水夫'] = totalSailors;

        // 海軍人員の計上 (v2.7.6)
        // 常備海軍比率に基づく補正 (船に乗っていない陸上勤務・予備人員も含める)
        // 沿岸部のみ海軍を保有する (湖沼・河川は対象外)
        if (p.isCoastal && config.NAVAL_SETTINGS) {
            const settlementLevel = p.settlement || '散居';
            const ratio = config.NAVAL_SETTINGS.STANDING_NAVY_RATIO[settlementLevel] || 0;
            if (ratio > 0) {
                const totalNavy = Math.floor(totalPop * ratio);

                // 艦艇乗組員との整合性チェック (最低でも艦艇を動かせる人数は必要)
                const minNavy = totalNavalOfficers + totalNavalSailors + totalMarines;
                const actualNavy = Math.max(totalNavy, minNavy);

                // 内訳比率
                const comp = config.NAVAL_SETTINGS.PERSONNEL_COMPOSITION[settlementLevel] || { sailor: 0.5, marine: 0.3, support: 0.2 };

                demographics['海軍船員'] = Math.max(totalNavalSailors, Math.floor(actualNavy * comp.sailor));
                demographics['海兵'] = Math.max(totalMarines, Math.floor(actualNavy * comp.marine));
                demographics['海軍士官'] = Math.max(totalNavalOfficers, Math.floor(actualNavy * comp.support * 0.3)); // 支援の3割を士官と仮定
                demographics['海軍工廠・支援'] = Math.floor(actualNavy * comp.support * 0.7); // 残りを陸上支援
            }
        }

        p.demographics = demographics;
    });
    return allHexes;
}

export function calculateFacilities(allHexes) {
    allHexes.forEach(h => {
        const p = h.properties;
        p.facilities = []; // オブジェクト配列に変更: { name: string, count: number, level: number }

        if (p.population <= 0) return;

        const addFacility = (name, count = 1, level = 1) => {
            p.facilities.push({ name, count, level });
        };

        // 基本施設
        if (p.population > 100) addFacility('集会所', 1, 1);
        if (p.population > 500) addFacility('市場', Math.ceil(p.population / 2000), 1);
        if (p.population > 1000) addFacility('宿屋', Math.ceil(p.population / 1000), 1);

        // 産業施設
        if (p.industry.secondary['武具・道具'] > 50) addFacility('鍛冶屋', Math.ceil(p.industry.secondary['武具・道具'] / 100), 1);
        if (p.industry.secondary['織物'] > 50) addFacility('機織り小屋', Math.ceil(p.industry.secondary['織物'] / 100), 1);
        if (p.industry.secondary['酒(穀物)'] > 50 || p.industry.secondary['酒(果実)'] > 50) addFacility('酒造所', 1, 1);

        // 港湾・水運
        const isCoastal = p.isCoastal;
        const isLakeside = p.isLakeside || (h.neighbors.some(n => allHexes[n].properties.isWater) && !isCoastal);
        const settlementLevel = p.settlement || '散居';

        // 領都以上で海に面していれば必ず港を持つ
        if (isCoastal) {
            if (['首都', '都市', '領都'].includes(settlementLevel)) {
                addFacility('大型港湾', 1, 3);
                addFacility('造船所', 1, 2);
                // 軍港 (v2.7.6)
                if (settlementLevel === '首都') addFacility('海軍総司令部', 1, 5);
                else addFacility('海軍基地', 1, 3);
            } else if (['街', '町'].includes(settlementLevel) || p.population > 500) {
                addFacility('港', 1, 2);
                if (settlementLevel === '街') addFacility('沿岸警備隊詰所', 1, 1);
            } else {
                addFacility('船着き場', 1, 1);
            }
        } else if (isLakeside) {
            if (p.population > 1000) addFacility('桟橋', 2, 1);
            else addFacility('渡し場', 1, 1);
        }

        // 特殊施設
        if (p.industry.quaternary['魔法研究'] > 50) addFacility('魔導塔', 1, Math.ceil(p.industry.quaternary['魔法研究'] / 500));
        if (p.industry.quaternary['学問・歴史'] > 50) addFacility('図書館', 1, 1);
        if (p.industry.quinary['芸術・文化'] > 50) addFacility('劇場', 1, 1);
        if (p.industry.quinary['世界儀式'] > 0) addFacility('大聖堂', 1, 5);

        // 物流能力
        const roadLevel = p.roadLevel || 0;
        let wagonCount = Math.floor(p.population / 60);

        // ユーザーヒント: 水運が使える場合、荷馬車を2-3割削減
        if (isCoastal || isLakeside) {
            wagonCount = Math.floor(wagonCount * 0.75);
        }
        // ユーザーヒント: 道路が悪い場合、荷馬車を減らす (破損対策)
        if (roadLevel < 3) {
            wagonCount = Math.floor(wagonCount * 0.9);
        }

        // 予備率 (10-15%)
        wagonCount = Math.floor(wagonCount * 1.15);

        let totalDraftAnimals = Math.floor(wagonCount * 2.2);
        // ユーザーヒント: 道路が悪い場合、牽引動物を増やす
        if (roadLevel < 3) {
            totalDraftAnimals = Math.floor(totalDraftAnimals * 1.2);
        }
        // 予備率 (15-20%)
        totalDraftAnimals = Math.floor(totalDraftAnimals * 1.2);

        let drivers = Math.floor(wagonCount * 1.3);
        // ユーザーヒント: 水運がある場合、御者→船頭/荷役へ一部置換
        if (isCoastal || isLakeside) {
            drivers = Math.floor(drivers * 1.1);
        }

        // 役畜の構成比率を決定
        const animals = {};
        const climate = p.climateZone || '';
        const terrain = p.terrainType || '';

        // デフォルト構成 (馬と牛のミックス)
        let horseRatio = 0.6;
        let oxRatio = 0.4;
        let otherType = null;
        let otherRatio = 0;

        // ユーザーヒント: 道路が悪い場合、牛比率を上げる
        if (roadLevel < 3) {
            horseRatio -= 0.2;
            oxRatio += 0.2;
        }

        if (climate.includes('ツンドラ') || climate.includes('氷雪')) {
            horseRatio = 0.1; oxRatio = 0.1; otherType = 'トナカイ'; otherRatio = 0.8;
            if (p.population < 500) { otherType = '犬'; otherRatio = 1.0; horseRatio = 0; oxRatio = 0; }
        } else if (climate.includes('砂漠')) {
            horseRatio = 0.2; oxRatio = 0.1; otherType = 'ラクダ'; otherRatio = 0.7;
        } else if (climate.includes('熱帯')) {
            horseRatio = 0.1; oxRatio = 0.2; otherType = '水牛'; otherRatio = 0.7;
            if (p.vegetation === '熱帯雨林') { otherType = '象'; otherRatio = 0.2; oxRatio = 0.7; horseRatio = 0.1; }
        } else if (terrain === '山岳' || terrain === '山地') {
            horseRatio = 0.1; oxRatio = 0.1; otherType = 'ラバ'; otherRatio = 0.8;
        }

        if (totalDraftAnimals > 0) {
            if (horseRatio > 0) animals['馬'] = Math.floor(totalDraftAnimals * horseRatio);
            if (oxRatio > 0) animals['牛'] = Math.floor(totalDraftAnimals * oxRatio);
            if (otherType && otherRatio > 0) animals[otherType] = Math.floor(totalDraftAnimals * otherRatio);
        }

        // 船舶の保有 (v2.5: 詳細ロジック)
        // 既に calculateShipOwnership で計算済み
        const ships = p.ships || {};

        // 輸送能力の計算 (v2.6)
        let waterCapacity = 0;
        Object.entries(ships).forEach(([shipName, count]) => {
            // 名前からタイプを逆引き
            const typeKey = Object.keys(config.SHIP_TYPES).find(key => config.SHIP_TYPES[key].name === shipName);
            if (typeKey) {
                waterCapacity += count * config.SHIP_TYPES[typeKey].cargo_capacity_t;
            }
        });

        let landCapacity = 0;
        landCapacity += wagonCount * (config.TRANSPORT_CAPACITY.wagon || 1.0);
        // 荷馬車以外の駄獣も考慮 (荷馬車用以外の動物)
        // ここでは簡易的に、荷馬車牽引に使われていない動物を駄獣とする
        // 牽引必要数: wagonCount * 2 (馬/牛)
        let usedDraftAnimals = wagonCount * 2;
        let totalAnimals = Object.values(animals).reduce((sum, count) => sum + count, 0);
        let packAnimals = Math.max(0, totalAnimals - usedDraftAnimals);
        landCapacity += packAnimals * (config.TRANSPORT_CAPACITY.pack_animal || 0.15);

        const totalCapacity = waterCapacity + landCapacity;

        // 人員計算 (v2.7.5: 詳細化)
        // 陸上: 御者
        // 水上: 船頭、船員
        let skippers = 0;
        let crew = 0;

        Object.entries(ships).forEach(([shipName, count]) => {
            const typeKey = Object.keys(config.SHIP_TYPES).find(key => config.SHIP_TYPES[key].name === shipName);
            if (typeKey) {
                const req = config.SHIP_TYPES[typeKey].crew_requirements;
                if (req) {
                    skippers += count * (req.skipper || 0);
                    crew += count * (req.crew || 0);
                }
            }
        });

        p.logistics = {
            wagons: wagonCount,
            animals: animals,
            ships: ships,
            personnel: {
                drivers: drivers,
                skippers: skippers,
                crew: crew
            },
            transportCapacity: {
                water: waterCapacity,
                land: landCapacity,
                total: totalCapacity
            }
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

export async function calculateRoadTraffic(allHexes, roadPaths, addLogMessage) {
    // Reset traffic and road edges
    allHexes.forEach(h => {
        h.properties.roadUsage = 0;
        h.properties.landUsage = 0;
        h.properties.waterUsage = 0;
        h.properties.roadLoss = 0;
        h.properties.roadEdges = [0, 0, 0, 0, 0, 0]; // Initialize road edges (v3.3)
    });

    // Calculate Road Edges from roadPaths (v3.3)
    if (roadPaths) {
        roadPaths.forEach(road => {
            if (!road.path || road.path.length < 2) return;
            const level = road.level;

            for (let i = 0; i < road.path.length - 1; i++) {
                const p1 = road.path[i];
                const p2 = road.path[i + 1];
                const idx1 = getIndex(p1.x, p1.y);
                const idx2 = getIndex(p2.x, p2.y);
                const h1 = allHexes[idx1];
                const h2 = allHexes[idx2];

                if (h1 && h2) {
                    // Find direction from h1 to h2
                    const dir1 = h1.neighbors.indexOf(idx2);
                    if (dir1 !== -1) {
                        if (!h1.properties.roadEdges) h1.properties.roadEdges = [0, 0, 0, 0, 0, 0];
                        h1.properties.roadEdges[dir1] = Math.max(h1.properties.roadEdges[dir1], level);
                    }

                    // Find direction from h2 to h1
                    const dir2 = h2.neighbors.indexOf(idx1);
                    if (dir2 !== -1) {
                        if (!h2.properties.roadEdges) h2.properties.roadEdges = [0, 0, 0, 0, 0, 0];
                        h2.properties.roadEdges[dir2] = Math.max(h2.properties.roadEdges[dir2], level);
                    }
                }
            }
        });
    }

    const addUsage = (hexIndex, volume) => {
        if (!allHexes[hexIndex]) return;
        const p = allHexes[hexIndex].properties;
        p.roadUsage += volume;
        if (p.isWater) {
            p.waterUsage += volume;
        } else {
            p.landUsage += volume;
        }
    };

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
                        addUsage(idx, volume);
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
                        addUsage(idx, volume);
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
        // 年間需要 (t) = 人口 * 1人当たり年間消費量 (デフォルト0.2t)
        // 例: 人口14,640人 * 0.2 = 2,928t/年 (月間244t)
        const consumptionPerPerson = settlementInfo ? settlementInfo.consumption_t_per_person : 0.2;
        const totalDemand = p.population * consumptionPerPerson;

        // 供給 = 自給 + 輸入
        let localSupply = 0;
        const foodItems = ['小麦', '大麦', '雑穀', '稲', '魚介類', '狩猟肉', '牧畜肉', '家畜肉', '乳製品', '果物'];

        if (p.industry && p.industry.primary) {
            foodItems.forEach(item => {
                if (p.industry.primary[item]) localSupply += p.industry.primary[item];
            });
        }

        const imports = p.imports ? (p.imports['食料'] || 0) : 0;
        const totalSupply = localSupply + imports;

        // 自給率は「主食（穀物）」のみで計算 (v2.4)
        // 対象: 小麦, 大麦, 雑穀, 稲
        let stapleSupply = 0;
        const stapleItems = ['小麦', '大麦', '雑穀', '稲'];
        if (p.industry && p.industry.primary) {
            stapleItems.forEach(item => {
                if (p.industry.primary[item]) stapleSupply += p.industry.primary[item];
            });
        }

        // 自給率 = 主食年間生産量 / 主食年間需要 (人口 * 0.1t)
        const stapleDemand = p.population * 0.1;
        p.selfSufficiencyRate = (stapleDemand > 0) ? Math.min(1.0, stapleSupply / stapleDemand) : 1.0;

        // 実質不足 (供給 >= 需要 なら 0)
        // こちらは全食料供給(totalSupply)で計算する
        const netShortage = Math.max(0, totalDemand - totalSupply);
        p.netShortage = netShortage;

        // 価格計算 (上限3.0)
        let price = 1.0;

        // 自給率による輸入コスト加算 (v3.6)
        const gap = 1.0 - p.selfSufficiencyRate;
        if (gap > 0) {
            price += gap * (0.6 + gap * 0.5);
        }

        if (totalDemand > 0) {
            const shortageRate = netShortage / totalDemand;
            price += (shortageRate * 2.0); // 不足ペナルティを加算

            // 過剰供給時の価格低下
            if (totalSupply > totalDemand * 1.1) {
                const surplusRate = (totalSupply - totalDemand) / totalDemand;
                // 余剰割引はベース価格から引くが、下限は0.8
                price = Math.max(0.8, price - (surplusRate * 0.2));
            }
        }
        price = Math.min(3.0, Math.max(0.8, price));
        p.priceIndex = price;

        // 幸福度計算
        let happiness = 50; // 基準
        if (netShortage > 0) {
            happiness -= (netShortage / totalDemand) * 50;
        } else {
            happiness += 5; // 食料充足ボーナス
        }

        if (price > 1.5) {
            happiness -= (price - 1.5) * 10;
        } else if (price < 0.8) {
            happiness += 5;
        }

        // 産業によるボーナス (存在チェックを追加)
        if (p.industry && p.industry.tertiary && p.industry.tertiary['医療・教会'] > 0) happiness += 5;
        if (p.industry && p.industry.quinary && p.industry.quinary['芸術・文化'] > 0) happiness += 5;

        happiness = Math.max(0, Math.min(100, happiness));
        p.happiness = happiness;

        // --- 貧困度・飢餓度の算定 (v2.1) ---
        // 1. 貧困度 (Poverty)
        // 労働人口 * 所得 / 人口 = 一人当たり月収
        // これを基準生活費と比較する
        let totalIncome = 0;
        let workerCount = 0;
        if (p.demographics) {
            Object.entries(p.demographics).forEach(([job, count]) => {
                const income = config.JOB_INCOME[job] || 20; // 未定義は20G(農村レベル)
                totalIncome += count * income;
                workerCount += count;
            });
        }

        // 一人当たり月収 (世帯ではなく個人ベース)
        const perCapitaIncome = p.population > 0 ? (totalIncome / p.population) : 0;

        // 基準生活費
        const livingCost = config.LIVING_COST[p.settlement || '散居'] || 20;

        // 貧困度 = 1.0 - (収入 / 生活費)
        // 収入が生活費と同じなら0.0、半分なら0.5、ゼロなら1.0
        // 収入が生活費を超えていれば0.0 (マイナスにはしない)
        let poverty = 0;
        if (livingCost > 0) {
            poverty = 1.0 - (perCapitaIncome / livingCost);
        }
        poverty = Math.max(0, Math.min(1.0, poverty));

        // 2. 飢餓度 (Hunger)
        // (スラム人口 + (孤児 / 2)) / 人口
        let hunger = 0;
        if (p.population > 0 && p.demographics) {
            const slum = p.demographics['スラム'] || 0;
            const orphan = p.demographics['孤児'] || 0;
            hunger = (slum + (orphan / 2)) / p.population;
        }
        hunger = Math.max(0, Math.min(1.0, hunger));

        // --- 世帯収入・租税の計算 (v2.2) ---
        const settlementType = p.settlement || '散居';
        const householdSize = config.HOUSEHOLD_SIZE[settlementType] || 5.0;
        const taxRate = config.TAX_RATE[settlementType] || 0.3;

        const householdIncome = perCapitaIncome * householdSize;
        const taxAmount = householdIncome * taxRate;

        // InfoWindow用のオブジェクト構造を作成
        p.livingConditions = {
            prices: {
                food: price,
                necessities: price,
                luxuries: price * 1.2,
                high_luxuries: price * 1.5,
                field_gear: (() => {
                    // 野戦具の価格計算 (v3.5 - 需要増・価格変動幅調整)

                    // 1. 供給 (Supply)
                    // 武具・道具の生産量をベースにする
                    let baseSupply = (p.industry.secondary['武具・道具'] || 0) * 1.0;

                    // 闇ルート供給 (治安が悪いほど増える)
                    const securityScore = 100 - (p.monsterRank ? (p.monsterRank === 'S' ? 50 : (p.monsterRank === 'A' ? 30 : (p.monsterRank === 'B' ? 20 : 10))) : 0);
                    const blackMarketSupply = (100 - securityScore) * (p.population * 0.0001);

                    const supply = baseSupply + blackMarketSupply;

                    // 2. 需要 (Demand)
                    // 基本需要: 人口 * 0.05 (1人あたり50kg/年 - 修正: 需要増)
                    const baseDemand = p.population * 0.05;

                    // 兵士需要: 兵士数 * 0.2 (兵士は一般人の4倍消費 - 修正: 需要増)
                    let soldierCount = 0;
                    if (p.demographics) {
                        soldierCount += (p.demographics['騎士'] || 0);
                        soldierCount += (p.demographics['正規兵'] || 0);
                        soldierCount += (p.demographics['衛兵・自警団'] || 0);
                    }
                    const soldierDemand = soldierCount * 0.2;

                    // 自衛需要: 治安が悪いほど一般人が武装する (修正: 係数増)
                    const selfDefenseDemand = (100 - securityScore) * p.population * 0.001;

                    const demand = baseDemand + soldierDemand + selfDefenseDemand;

                    // 3. 価格計算
                    let fgPrice = 1.0;

                    if (demand <= 0) {
                        fgPrice = 1.0; // 需要なし
                    } else if (supply <= 0) {
                        // 供給なし -> 輸入に頼るため高騰 (最大3.0)
                        fgPrice = 3.0;
                    } else {
                        // 需給比率
                        const ratio = demand / supply;

                        if (ratio > 1.0) {
                            // 需要過多 (不足) -> 価格上昇
                            fgPrice = 1.0 + (ratio - 1.0) * 0.5;
                        } else {
                            // 供給過多 (余剰) -> 価格低下
                            // 修正: 値下げ幅を抑制 (0.5 -> 0.3)
                            fgPrice = 1.0 - (1.0 - ratio) * 0.3;
                        }
                    }

                    // キャップ適用 (下限0.8, 上限3.0)
                    return Math.max(0.8, Math.min(3.0, parseFloat(fgPrice.toFixed(2))));
                })()
            },
            happiness: happiness,
            security: 100 - (p.monsterRank ? (p.monsterRank === 'S' ? 50 : (p.monsterRank === 'A' ? 30 : (p.monsterRank === 'B' ? 20 : 10))) : 0),
            poverty: poverty,
            hunger: hunger,
            luxury: (perCapitaIncome > livingCost * 2) ? 1.0 : (perCapitaIncome > livingCost ? (perCapitaIncome - livingCost) / livingCost : 0), // 簡易的な贅沢度
            tax: p.population * 10, // 旧ロジック(互換性のため残す)

            // 新規追加項目
            householdIncome: householdIncome,
            monthlyTax: taxAmount,

            // デバッグ用情報を追加
            perCapitaIncome: perCapitaIncome,
            livingCost: livingCost,
            monthlyDemand: totalDemand / 12,
            monthlySupply: localSupply / 12
        };
    });
    return allHexes;
}
