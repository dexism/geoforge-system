// ================================================================
// GeoForge System - 経済シミュレーションモジュール (v2.0 - 産業階層・完全農業ロジック統合版)
// ================================================================

import * as config from './config.ts';
import { getIndex, globalRandom } from './utils.ts';
import { findAStarPath } from './roadGenerator.js';
import { WorldMap, Hex } from './WorldMap.ts';
import { calculateHexShipOwnership, calculateHexIndustry, calculateHexDemographics, calculateHexFacilities } from './economyHelpers.ts';

/**
 * 経済シミュレーションのメイン関数 (main.js から呼び出される)
 */
export async function simulateEconomy(allHexes, addLogMessage) {
    await addLogMessage("産業構造と経済連関をシミュレーション中...");

    // 第0パス & 第1パス: 船舶・産業
    allHexes.forEach(h => {
        calculateHexShipOwnership(h, allHexes);
        calculateHexIndustry(h, allHexes);
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
        calculateHexDemographics(h, allHexes);
    });
    return allHexes;
}

export function calculateFacilities(allHexes) {
    console.log("[Econ] calculateFacilities started.");
    let processedCount = 0;
    allHexes.forEach(h => {
        calculateHexFacilities(h, allHexes);
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
                        return hex.neighbors
                            .filter(nIdx => nIdx !== -1) // Filter invalid indices
                            .map(nIdx => {
                                const nHex = allHexes[nIdx];
                                if (!nHex) return null;
                                return { x: nHex.col, y: nHex.row };
                            })
                            .filter(n => n !== null);
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
    console.log("[Econ] calculateLivingConditions started.");
    let processedCount = 0;
    allHexes.forEach(h => {
        processedCount++;
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
                const c = count as number;
                const income = config.JOB_INCOME[job] || 20; // 未定義は20G(農村レベル)
                totalIncome += c * income;
                workerCount += c;
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
