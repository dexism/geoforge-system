
import * as config from './config.js';
import { getIndex } from './utils.js';

/**
 * 街道の交通量（月間通行者数）を計算する
 * @param {Array<object>} allHexes - 全ヘックスデータ
 * @param {Array<object>} roadPaths - 生成された全道路パス
 * @param {Function} addLogMessage - ログ出力用
 */
export async function calculateRoadTraffic(allHexes, roadPaths, addLogMessage) {
    if (!roadPaths) return;
    await addLogMessage("街道の交通量（月間通行者数）を計算しています...");

    // 1. 初期化: 全ヘックスの交通量をリセット
    allHexes.forEach(h => h.properties.roadUsage = 0);

    // 2. 各道路パスごとの交通量を計算して加算
    roadPaths.forEach(route => {
        if (!route.path || route.path.length < 2) return;

        const startNode = route.path[0];
        const endNode = route.path[route.path.length - 1];
        const startHex = allHexes[getIndex(startNode.x, startNode.y)];
        const endHex = allHexes[getIndex(endNode.x, endNode.y)];

        if (!startHex || !endHex) return;

        const pStart = startHex.properties;
        const pEnd = endHex.properties;

        let traffic = 0;

        // A. 基礎交通量 (人口に比例)
        // 村同士の道でも、住人の往来はある。人口の1%が月に1回往復すると仮定。
        traffic += (pStart.population + pEnd.population) * 0.02;

        // B. 交易交通量 (都市間、または拠点間)
        // 重力モデル的アプローチ: (P1 * P2) / 距離^2 だが、
        // ここではシンプルに「産業規模の積」をベースにする
        if (route.level >= 4) { // 街道以上
            // 産業規模スコア (人口 * 0.1 + 産業施設数的なもの)
            // 簡易的に人口を使うが、都市ランクで重み付け
            const getRankWeight = (settlement) => {
                if (settlement === '首都') return 10;
                if (settlement === '都市') return 5;
                if (settlement === '領都') return 4;
                if (settlement === '街') return 2;
                return 1;
            };
            const wStart = getRankWeight(pStart.settlement);
            const wEnd = getRankWeight(pEnd.settlement);

            // 交易係数
            const tradeFactor = (wStart * wEnd);
            traffic += tradeFactor * 10; // ランク積 * 10人
        }

        // C. 物流交通量 (食料・資源)
        // 余剰と不足のマッチングは複雑なので、簡易モデルで近似
        // 「片方が余剰、片方が不足」なら、その差分だけ輸送が発生するとみなす

        // 食料
        const startFoodSurplus = parseFloat(pStart.surplus['食料'] || 0);
        const endFoodSurplus = parseFloat(pEnd.surplus['食料'] || 0);
        const startFoodShortage = parseFloat(pStart.shortage['食料'] || 0);
        const endFoodShortage = parseFloat(pEnd.shortage['食料'] || 0);

        let foodTraffic = 0;
        // Start -> End への輸送 (Startが余剰、Endが不足)
        if (startFoodSurplus > 0 && endFoodShortage > 0) {
            foodTraffic += Math.min(startFoodSurplus, endFoodShortage);
        }
        // End -> Start への輸送
        if (endFoodSurplus > 0 && startFoodShortage > 0) {
            foodTraffic += Math.min(endFoodSurplus, startFoodShortage);
        }
        // 食料1トンあたり、馬車1台(御者1人+護衛1人=2人)と換算して交通量に加算
        traffic += foodTraffic * 2;


        // D. 資源・特産品ボーナス
        // 鉱山や林業拠点からの輸送
        const getResourceOutput = (p) => {
            let out = 0;
            if (p.production) {
                out += (p.production['鉱石'] || 0);
                out += (p.production['木材'] || 0);
                out += (p.production['鉄'] || 0); // 加工品
            }
            return out;
        };
        const resourceTraffic = getResourceOutput(pStart) + getResourceOutput(pEnd);
        traffic += resourceTraffic * 1; // 資源1トンあたり1人


        // E. 観光・巡礼 (マナ濃度や文化)
        if (pStart.manaRank === 'S' || pEnd.manaRank === 'S') traffic += 50;
        if (pStart.settlement === '首都' || pEnd.settlement === '首都') traffic += 100;


        // 3. パス上の全ヘックスに加算
        // ※ 交差点では重複して加算されるため、自然と交通量が増える
        route.path.forEach(node => {
            const index = getIndex(node.x, node.y);
            const hex = allHexes[index];
            if (hex) {
                hex.properties.roadUsage += traffic;
            }
        });
    });

    // 4. 仕上げ: 極端な値を丸める、または最低値を保証する
    allHexes.forEach(h => {
        if (h.properties.roadLevel > 0) {
            // 道路があるのに交通量0はおかしいので、最低値を設定
            // レベルが高いほど最低保証値を高く
            const minTraffic = h.properties.roadLevel * 5;
            if (h.properties.roadUsage < minTraffic) {
                h.properties.roadUsage = minTraffic;
            }

            // 整数に丸める
            h.properties.roadUsage = Math.round(h.properties.roadUsage);
        } else {
            h.properties.roadUsage = 0;
        }
    });

    return allHexes;
}
