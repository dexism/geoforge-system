
import * as config from './config.js';
import { getIndex, globalRandom } from './utils.js';

// ================================================================
// Single Hex Economy Calculation Helpers
// ================================================================

/**
 * Calculates ship ownership for a single hex.
 */
export function calculateHexShipOwnership(h, allHexes) {
    const p = h.properties;
    p.ships = {}; // Initialize

    const settlementLevel = p.settlement || '散居';
    if (!config.SHIP_AVAILABILITY[settlementLevel]) return;

    // Water body check
    const isCoastal = p.isCoastal;
    const isLakeside = p.isLakeside || (h.neighbors.some(n => allHexes[n].properties.isWater) && !isCoastal);
    const isRiver = p.rivers && p.rivers.some(r => r > 0);

    if (!isCoastal && !isLakeside && !isRiver) return;

    // Logic adapted from calculateShipOwnership in economySimulator.js
    const availTypes = config.SHIP_AVAILABILITY[settlementLevel];
    let minShips = 0;
    let maxShips = 0;

    if (settlementLevel === '村') { minShips = 8; maxShips = 20; }
    else if (settlementLevel === '町') { minShips = 25; maxShips = 60; }
    else if (settlementLevel === '街') { minShips = 50; maxShips = 100; }
    else if (['領都', '都市'].includes(settlementLevel)) { minShips = 120; maxShips = 200; }
    else if (settlementLevel === '首都') { minShips = 220; maxShips = 380; }

    if (isCoastal) {
        minShips = Math.floor(minShips * 1.5);
        maxShips = Math.floor(maxShips * 1.5);
    }

    let baseShips = minShips + Math.floor(globalRandom.next() * (maxShips - minShips + 1));
    const popFactor = (p.population / 1000) * 0.8;

    let tradeFactor = 0;
    if (settlementLevel === '町') tradeFactor = 1;
    else if (settlementLevel === '街') tradeFactor = 2;
    else if (['領都', '都市', '首都'].includes(settlementLevel)) tradeFactor = 3;

    let waterFactor = 0;
    if (isCoastal) waterFactor = 1;
    if (p.fishingPotential > 0.7) waterFactor += 1;

    const totalShips = Math.floor(baseShips + popFactor + (10 * tradeFactor) + (8 * waterFactor));

    let ratios = {};
    if (isCoastal) {
        if (settlementLevel === '村') ratios = { 'dinghy': 0.90, 'small_trader': 0.10 };
        else if (settlementLevel === '町') ratios = { 'dinghy': 0.65, 'small_trader': 0.30, 'coastal_trader': 0.05 };
        else if (settlementLevel === '街') ratios = { 'dinghy': 0.55, 'small_trader': 0.30, 'coastal_trader': 0.15 };
        else if (['領都', '都市'].includes(settlementLevel)) ratios = { 'dinghy': 0.45, 'small_trader': 0.25, 'coastal_trader': 0.20, 'medium_merchant': 0.10 };
        else if (settlementLevel === '首都') ratios = { 'dinghy': 0.40, 'small_trader': 0.25, 'coastal_trader': 0.20, 'medium_merchant': 0.10, 'large_sailing_ship': 0.05 };
    } else if (isLakeside) {
        if (settlementLevel === '村') ratios = { 'lake_boat': 0.90, 'dinghy': 0.10 };
        else if (settlementLevel === '町') ratios = { 'lake_boat': 0.70, 'lake_trader': 0.30 };
        else if (settlementLevel === '街') ratios = { 'lake_boat': 0.60, 'lake_trader': 0.40 };
        else ratios = { 'lake_boat': 0.50, 'lake_trader': 0.50 };
    } else if (isRiver) {
        if (settlementLevel === '村') ratios = { 'river_canoe': 0.90, 'dinghy': 0.10 };
        else if (settlementLevel === '町') ratios = { 'river_canoe': 0.70, 'river_barge': 0.30 };
        else if (settlementLevel === '街') ratios = { 'river_canoe': 0.60, 'river_barge': 0.40 };
        else ratios = { 'river_canoe': 0.50, 'river_barge': 0.50 };
    }

    Object.entries(ratios).forEach(([typeKey, ratio]) => {
        if (availTypes.includes(typeKey)) {
            let count = Math.floor(totalShips * ratio);
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

    if (isCoastal) {
        let minOcean = 0;
        if (settlementLevel === '街') minOcean = Math.floor(globalRandom.next() * 5);
        else if (['領都', '都市'].includes(settlementLevel)) minOcean = 2 + Math.floor(globalRandom.next() * 11);
        else if (settlementLevel === '首都') minOcean = 8 + Math.floor(globalRandom.next() * 18);

        if (minOcean > 0) {
            const mediumName = config.SHIP_TYPES['medium_merchant'].name;
            const largeName = config.SHIP_TYPES['large_sailing_ship'].name;
            let currentOcean = (p.ships[mediumName] || 0) + (p.ships[largeName] || 0);
            if (currentOcean < minOcean && availTypes.includes('medium_merchant')) {
                p.ships[mediumName] = (p.ships[mediumName] || 0) + (minOcean - currentOcean);
            }
        }
    }
}

/**
 * Calculates industry structure for a single hex.
 */
export function calculateHexIndustry(h, allHexes) {
    const p = h.properties;
    p.industry = { primary: {}, secondary: {}, tertiary: {}, quaternary: {}, quinary: {} };
    p.production = {}; p.surplus = {}; p.shortage = {}; p.cultivatedArea = 0; p.imports = { '食料': 0 };

    if (p.population <= 0 || p.isWater) return;

    const settlementType = p.settlement || '散居';
    const alloc = config.INDUSTRY_ALLOCATION[settlementType];
    const settlementInfo = config.SETTLEMENT_PARAMS[settlementType];
    const totalLabor = p.population * settlementInfo.labor_rate;

    // --- Primary ---
    const labor1 = totalLabor * alloc[1];
    const pot = {
        agri: p.agriPotential, forest: p.forestPotential, mining: p.miningPotential,
        fish: p.fishingPotential, pastoral: p.pastoralPotential, livestock: p.livestockPotential
    };
    const totalPot1 = Object.values(pot).reduce((a, b) => a + b, 0) || 1;
    const workers = {
        agri: labor1 * (pot.agri / totalPot1),
        forest: labor1 * (pot.forest / totalPot1),
        mining: labor1 * (pot.mining / totalPot1),
        fish: labor1 * (pot.fish / totalPot1),
        pastoral: labor1 * (pot.pastoral / totalPot1),
        livestock: labor1 * (pot.livestock / totalPot1)
    };
    const prod1 = p.industry.primary;

    if (workers.agri > 0.1) {
        // Agri logic simplified hook or duplicated?
        // Duplicating core logic for safety/independence
        const climate = p.climateZone || "";
        let mainCrops = (climate.includes("亜寒帯") || climate.includes("ツンドラ")) ? { '大麦': 0.6, '雑穀': 0.4 } :
            (climate.includes("温暖") || climate.includes("地中海")) ? { '小麦': 0.7, '雑穀': 0.3 } :
                (climate.includes("熱帯")) ? (p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 }) : { '雑穀': 1.0 };

        let avgHa = 0;
        Object.keys(mainCrops).forEach(c => {
            if (config.CROP_DATA[c]) avgHa += config.CROP_DATA[c].cultivation_ha_per_person * mainCrops[c];
        });
        const laborBasedArea = workers.agri * avgHa * settlementInfo.infra_coeff;
        const maxArea = config.HEX_AREA_HA * (0.03 + p.agriPotential * 0.5);
        p.cultivatedArea = Math.min(laborBasedArea, maxArea);

        const yieldFluc = 0.7 + globalRandom.next() * 0.6;
        Object.keys(mainCrops).forEach(c => {
            if (config.CROP_DATA[c]) prod1[c] = (prod1[c] || 0) + p.cultivatedArea * mainCrops[c] * config.CROP_DATA[c].yield * yieldFluc;
        });
        if (p.agriPotential > 0.6 && p.temperature > 10) prod1['果物'] = (workers.agri * 0.1) * (p.agriPotential * 0.5);
    }
    if (workers.forest > 0) {
        prod1['木材'] = workers.forest * 10 * p.forestPotential;
        prod1['狩猟肉'] = workers.forest * 2 * p.huntingPotential;
        prod1['薬草'] = workers.forest * 1 * p.manaValue;
    }
    if (workers.mining > 0) {
        prod1['鉱石'] = workers.mining * 20 * p.miningPotential;
        prod1['鉄'] = workers.mining * 5 * p.miningPotential;
        if (p.manaValue > 1.5) prod1['魔鉱石'] = workers.mining * 0.5 * p.manaValue;
    }
    if (workers.fish > 0) {
        // Fishing logic simplified for single hex
        let totalYield = workers.fish * 0.5; // Base
        if (p.ships) {
            // Add ship bonus if any
            const ships = Object.values(p.ships).reduce((a, b) => a + b, 0);
            totalYield += ships * 5; // Simplified
        }
        prod1['魚介類'] = totalYield * p.fishingPotential;
    }
    if (workers.pastoral > 0) {
        prod1['牧畜肉'] = workers.pastoral * 8 * p.pastoralPotential;
        prod1['乳製品'] = workers.pastoral * 10 * p.pastoralPotential;
        prod1['羊毛'] = workers.pastoral * 5 * p.pastoralPotential;
    }
    Object.assign(p.production, prod1);

    // --- Secondary ---
    const labor2 = totalLabor * alloc[2];
    const prod2 = p.industry.secondary;
    // ... Simplified synthesis ...
    // Assuming sufficient resources for visualization
    prod2['武具・道具'] = labor2 * 0.4;
    prod2['織物'] = labor2 * 0.3;
    prod2['建築'] = labor2 * 0.1 * settlementInfo.infra_coeff;

    // --- Tertiary ---
    const labor3 = totalLabor * alloc[3];
    const prod3 = p.industry.tertiary;
    prod3['商業・交易'] = labor3 * 0.15 * (p.roadLevel || 1);
    prod3['医療・教会'] = labor3 * 0.2 * (1 + p.manaValue);

    // --- Quaternary ---
    const labor4 = totalLabor * alloc[4];
    const prod4 = p.industry.quaternary;
    prod4['魔法研究'] = labor4 * 0.4 * p.manaValue;
    prod4['学問・歴史'] = labor4 * 0.3 * 10;
    prod4['戦略・軍事'] = labor4 * 0.2;

    // --- Quinary ---
    const labor5 = totalLabor * alloc[5];
    const prod5 = p.industry.quinary;
    if (p.nationId) prod5['行政・税収'] = labor5 * 100;
}

/**
 * Calculates demographics for a single hex.
 */
export function calculateHexDemographics(h, allHexes) {
    const p = h.properties;
    if (p.population <= 0) return;
    const totalPop = p.population;
    const demo = {};

    demo['農民'] = Math.floor(totalPop * 0.4 * (p.agriPotential || 0.5));
    demo['漁師'] = Math.floor(totalPop * 0.1 * (p.fishingPotential || 0));
    demo['鉱夫'] = Math.floor(totalPop * 0.1 * (p.miningPotential || 0));
    demo['職人'] = Math.floor(totalPop * 0.1);
    demo['商人'] = Math.floor(totalPop * 0.05);
    demo['兵士'] = Math.floor(totalPop * 0.03);
    demo['官僚'] = Math.floor(totalPop * 0.01);

    // Slum/Orphan logic
    let slumRate = 0;
    if (p.settlement === '街') slumRate = 0.03;
    else if (['領都', '都市'].includes(p.settlement)) slumRate = 0.07;
    else if (p.settlement === '首都') slumRate = 0.10;
    demo['スラム'] = Math.floor(totalPop * slumRate);
    demo['孤児'] = Math.floor(totalPop * 0.02);

    p.demographics = demo;
}

/**
 * Calculates facilities for a single hex.
 */
export function calculateHexFacilities(h, allHexes) {
    const p = h.properties;
    p.facilities = [];

    if (p.population <= 0) return;

    const addFacility = (name, count = 1, level = 1) => {
        p.facilities.push({ name, count, level });
    };

    // Basic
    if (p.population > 100) addFacility('集会所', 1, 1);
    if (p.population > 500) addFacility('市場', Math.ceil(p.population / 2000), 1);
    if (p.population > 1000) addFacility('宿屋', Math.ceil(p.population / 1000), 1);

    // Industry
    if (p.industry) {
        if (p.industry.secondary['武具・道具'] > 50) addFacility('鍛冶屋', Math.ceil(p.industry.secondary['武具・道具'] / 100), 1);
        if (p.industry.secondary['織物'] > 50) addFacility('機織り小屋', Math.ceil(p.industry.secondary['織物'] / 100), 1);
        if (p.industry.secondary['酒(穀物)'] > 50 || p.industry.secondary['酒(果実)'] > 50) addFacility('酒造所', 1, 1);
    }

    // Ports
    const isCoastal = p.isCoastal;
    const isLakeside = p.isLakeside || (h.neighbors.some(n => allHexes[n].properties.isWater) && !isCoastal);
    const settlementLevel = p.settlement || '散居';

    if (isCoastal) {
        if (['首都', '都市', '領都'].includes(settlementLevel)) {
            addFacility('大型港湾', 1, 3);
            addFacility('造船所', 1, 2);
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

    // Special
    if (p.industry) {
        if (p.industry.quaternary && p.industry.quaternary['魔法研究'] > 50) addFacility('魔導塔', 1, Math.ceil(p.industry.quaternary['魔法研究'] / 500));
        if (p.industry.quaternary && p.industry.quaternary['学問・歴史'] > 50) addFacility('図書館', 1, 1);
        if (p.industry.quinary && p.industry.quinary['芸術・文化'] > 50) addFacility('劇場', 1, 1);
        if (p.industry.quinary && p.industry.quinary['世界儀式'] > 0) addFacility('大聖堂', 1, 5);
    }
}
