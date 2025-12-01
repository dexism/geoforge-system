
export function calculateFacilities(hex) {
    const p = hex.properties;
    const facilities = {};
    const pop = p.population;
    const settlement = p.settlement;

    if (pop <= 0) return facilities;

    // 1. 基本施設 (人口依存)
    if (pop >= 100) facilities['集会所'] = 1;
    if (pop >= 500) facilities['市場'] = Math.floor(pop / 1000) + 1;
    if (pop >= 1000) facilities['宿屋'] = Math.floor(pop / 2000) + 1;

    // 2. 行政・軍事
    if (['首都', '都市', '領都'].includes(settlement)) {
        facilities['役所'] = 1;
        facilities['兵舎'] = Math.floor(pop / 5000) + 1;
        facilities['城壁'] = 1;
    }
    if (p.fortress) facilities['砦'] = 1;

    // 3. 産業施設
    // 工房: 第二次産業労働者数に基づく
    const labor2 = (p.demographics && (p.demographics['職人'] || 0)) || 0;
    if (labor2 > 0) {
        facilities['工房'] = Math.floor(labor2 / 8);
    }

    const smiths = (p.demographics && (p.demographics['鍛冶屋'] || 0)) || 0;
    if (smiths > 0) {
        facilities['鍛冶屋'] = Math.floor(smiths / 6);
    }

    // 4. 宗教・文化
    if (pop >= 2000) facilities['教会'] = Math.floor(pop / 3000);
    if (pop >= 10000) facilities['大聖堂'] = 1;

    // 5. 港湾・水運
    if (p.isCoastal) {
        if (pop >= 1000) facilities['港'] = Math.floor(pop / 2000);
        if (['首都', '都市', '領都'].includes(settlement)) facilities['大型造船所'] = 1;
    } else if (p.isLakeside) {
        facilities['渡し場'] = 1;
        if (['街', '都市', '領都'].includes(settlement)) facilities['桟橋'] = 1;
    }

    // 6. 特殊 (マナ、魔物)
    if (p.manaValue > 1.5) facilities['魔導塔'] = 1;

    return facilities;
}

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

        // ハブ自身をカウント
        if (aggregatedData.settlementCounts[hubProps.settlement] !== undefined) {
            aggregatedData.settlementCounts[hubProps.settlement]++;
        }

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
            if (dProps.settlement && aggregatedData.settlementCounts[dProps.settlement] !== undefined) {
                aggregatedData.settlementCounts[dProps.settlement]++;
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
