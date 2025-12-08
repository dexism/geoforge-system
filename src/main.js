// ================================================================
// GeoForge System - メインスクリプト (v2.2 - 分割生成モデル)
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { generatePhysicalMap, generateClimateAndVegetation, generateRidgeLines, recalculateGeographicFlags, calculateFinalProperties, initializeNoiseFunctions, recalculateRiverProperties, generateWaterSystems, generateBeaches, initializeWaterVegetation } from './continentGenerator.js';
import { generateCivilization, determineTerritories, defineNations, assignTerritoriesByTradeRoutes, generateMonsterDistribution, generateHuntingPotential, generateLivestockPotential } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates, calculateRoadTraffic, calculateDemographics, calculateFacilities, calculateLivingConditions, generateCityCharacteristics, calculateShipOwnership } from './economySimulator.js';
import { setupUI, redrawClimate, redrawSettlements, redrawRoadsAndNations, resetUI, redrawMap, updateMinimap } from './ui.js';
import { generateTradeRoutes, generateFeederRoads, generateMainTradeRoutes, calculateRoadDistance, calculateTravelDays, generateSeaRoutes } from './roadGenerator.js';
import { getIndex, initGlobalRandom, globalRandom, getNeighborIndices } from './utils.js';
import { WorldMap } from './WorldMap.js';
// GASのデプロイで取得したウェブアプリのURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyS8buNL8u2DK9L3UZRtQqLWgDLvuj0WE5ZrzzdXNXSWH3bnGo-JsiO9KSrHp6YOjmtvg/exec';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const progressBarContainer = document.getElementById('progress-bar-container');

// 分割生成のための状態管理変数
let worldData = {
    allHexes: null,
    roadPaths: null,
    seed: 0
};
let uiInitialized = false;

// ボタン要素を取得
const step1Btn = document.getElementById('step1-continent-btn');
const step2Btn = document.getElementById('step2-climate-btn');
const step3Btn = document.getElementById('step3-settlement-btn');
const step4Btn = document.getElementById('step4-nation-btn');
const step5Btn = document.getElementById('step5-save-btn');
const downloadJsonBtn = document.getElementById('download-json-btn');
const loadGasBtn = document.getElementById('load-gas-btn');
const regenerateBtn = document.getElementById('force-regenerate-btn');


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function addLogMessage(message, id = null) {
    console.log(message);
    let entry;
    if (id) {
        entry = document.getElementById(id);
    }

    if (entry) {
        entry.textContent = `・ ${message}`;
    } else {
        entry = document.createElement('p');
        entry.className = 'log-entry';
        if (id) {
            entry.id = id;
        }
        entry.textContent = `・ ${message}`;
        logContainer.appendChild(entry);
    }

    logContainer.scrollTop = logContainer.scrollHeight;
    await sleep(id ? 1 : 20);
}

// ボタンの有効/無効を管理する関数
function updateButtonStates(currentStep) {
    step1Btn.disabled = false; // 大陸生成はいつでも可能
    step2Btn.disabled = currentStep < 1;
    step3Btn.disabled = currentStep < 2;
    step4Btn.disabled = currentStep < 3;
    step5Btn.disabled = currentStep < 4;
    downloadJsonBtn.disabled = currentStep < 4;
    loadGasBtn.disabled = false; // 常時有効
}

/**
 * 世界とUIの状態を完全にリセットする関数
 */
function resetWorld() {
    // D3.jsで描画された古いSVG要素を全て削除
    d3.select('#hexmap').selectAll('*').remove();

    resetUI();

    // グローバルな状態管理変数を初期化
    worldData = {
        allHexes: null,
        roadPaths: null,
        seed: 0
    };
    uiInitialized = false;

    // UI要素を初期状態に戻す
    updateButtonStates(0); // ボタンの状態もリセット
}

// ================================================================
// ■ 各生成ステップの関数
// ================================================================

// ステップ1: 大陸・河川生成
async function runStep1_Continent() {
    resetWorld();

    // シード生成とPRNG初期化
    const seed = Date.now();
    initGlobalRandom(seed);
    worldData.seed = seed;
    await addLogMessage(`新しい世界のためのシード値を生成しました: ${seed}`);

    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ1: 大陸の土台を生成しています...");

    // 物理マップ生成のみを呼び出す
    // 途中経過を描画するためのコールバック関数
    const redrawFn = async (currentHexes) => {
        if (!uiInitialized) {
            await addLogMessage("初回描画を準備しています...");
            await setupUI(currentHexes, [], addLogMessage);
            uiInitialized = true;
        } else {
            // 既に初期化されている場合は、データと色を更新して再描画
            await redrawMap(currentHexes);
            // UI更新のために少し待機
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };

    worldData.allHexes = await generatePhysicalMap(addLogMessage, redrawFn);

    if (!uiInitialized) {
        await addLogMessage("初回描画を準備しています...");
        // この時点では植生データは不完全だが、エラーにはならない
        await setupUI(worldData.allHexes, [], addLogMessage);
        uiInitialized = true;
    }

    updateButtonStates(1);
    loadingOverlay.style.display = 'none';
}

// ステップ2: 気候・植生生成
async function runStep2_Climate() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ2: 気候と植生を計算しています...");

    // ステップ1のデータに気候・植生情報を追加する
    worldData.allHexes = await generateClimateAndVegetation(worldData.allHexes, addLogMessage);

    await addLogMessage("気候と植生を再描画しています...");
    await redrawClimate(worldData.allHexes);

    // [DEBUG] 植生データの検証
    const missingVeg = worldData.allHexes.filter(h => !h.properties.vegetation).length;
    if (missingVeg > 0) {
        console.error(`[ERROR] Step 2 finished but ${missingVeg} hexes have no vegetation!`);
        await addLogMessage(`[警告] ${missingVeg} 個のヘックスで植生が設定されていません。`);
    } else {
        console.log("[INFO] Step 2 finished. All hexes have vegetation.");
    }

    updateButtonStates(2);
    loadingOverlay.style.display = 'none';
}

// ステップ3: 集落生成
async function runStep3_Settlements() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ3: 文明を生成しています...");

    const civResult = await generateCivilization(worldData.allHexes, addLogMessage);
    worldData.allHexes = civResult.allHexes;
    worldData.roadPaths = civResult.roadPaths; // この時点ではまだ空に近い

    await addLogMessage("生態系（魔物）の分布を計算しています...");
    worldData.allHexes = generateMonsterDistribution(worldData.allHexes);

    await addLogMessage("狩猟のポテンシャルを評価しています...");
    worldData.allHexes = generateHuntingPotential(worldData.allHexes);

    await addLogMessage("畜産のポテンシャルを評価しています...");
    worldData.allHexes = generateLivestockPotential(worldData.allHexes);

    await addLogMessage("集落と人口分布を再描画しています...");
    await redrawSettlements(worldData.allHexes);

    // populationDisplay.style.display = 'block';

    updateButtonStates(3);
    loadingOverlay.style.display = 'none';
}

// ステップ4: 道路・国家生成
async function runStep4_Nations() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ4: 国家とインフラを形成しています...");

    // 必要なデータを取得
    const allHexes = worldData.allHexes;
    const cities = allHexes.filter(h => h.properties.settlement === '都市' || h.properties.settlement === '首都' || h.properties.settlement === '領都');
    const capitals = cities.filter(h => h.properties.settlement === '首都');

    // STEP 0: 各首都間を結ぶ「通商路」を最優先で確定する
    const mainTradeRoutePaths = await generateMainTradeRoutes(capitals, allHexes, addLogMessage);
    let allRoadPaths = mainTradeRoutePaths; // 最終的な道路リストをまず通商路で初期化

    // 通商路の情報をヘックスに書き込み、後のA*探索でコストが下がるようにする
    mainTradeRoutePaths.forEach(route => {
        route.path.forEach(pos => {
            const hex = allHexes[getIndex(pos.x, pos.y)];
            if (hex && !hex.properties.isWater) {
                if (!hex.properties.roadLevel || hex.properties.roadLevel < 6) {
                    hex.properties.roadLevel = 6;
                }
            }
        });
    });

    // STEP 1: 全都市間の「交易路」の候補を探索
    await addLogMessage("都市間の交易路の可能性を探索しています...");
    // generateTradeRoutesは、内部のコスト関数が通商路を優先するため、より効率的なルートを見つける
    const { routeData: allTradeRoutes } = await generateTradeRoutes(cities, allHexes, addLogMessage);

    // STEP 2: 領都の決定
    await addLogMessage("交易路網に基づき、首都の初期領土を割り当てています...");
    const { regionalCapitals } = assignTerritoriesByTradeRoutes(cities, capitals, allTradeRoutes, allHexes);

    regionalCapitals.forEach(rc => {
        const capitalId = rc.properties.parentHexId;
        const regionalCapitalId = getIndex(rc.col, rc.row);

        // 対応する交易路データを再検索
        const route = allTradeRoutes.find(r =>
            (r.fromId === regionalCapitalId && r.toId === capitalId) ||
            (r.fromId === capitalId && r.toId === regionalCapitalId)
        );

        if (route) {
            // 道路レベル5 (交易路) として距離と日数を計算
            const distance = calculateRoadDistance(route.path, 5, allHexes);
            const travelDays = calculateTravelDays(route.path, 5, allHexes);

            // 計算結果をプロパティに保存
            rc.properties.distanceToParent = distance;
            rc.properties.travelDaysToParent = travelDays;
        }
    });

    // STEP 3: 交易路の選別
    const finalTradeRoutes = [];
    const guaranteedRoutes = new Set();

    // 手順2: 領都から直上の首都までのルートを必ず確保する
    regionalCapitals.forEach(rc => {
        const capitalId = rc.properties.parentHexId;
        const regionalCapitalId = getIndex(rc.col, rc.row);

        const route = allTradeRoutes.find(r =>
            (r.fromId === regionalCapitalId && r.toId === capitalId) ||
            (r.fromId === capitalId && r.toId === regionalCapitalId)
        );
        if (route) {
            // ルートデータ自体に国籍情報を付与
            route.nationId = rc.properties.nationId;
            finalTradeRoutes.push(route);
            const routeKey = Math.min(route.fromId, route.toId) + '-' + Math.max(route.fromId, route.toId);
            guaranteedRoutes.add(routeKey);
        }
    });

    // 手順3: それ以外の交易路は、30日以上かかるものを削除する
    allTradeRoutes.forEach(route => {
        const routeKey = Math.min(route.fromId, route.toId) + '-' + Math.max(route.fromId, route.toId);
        // 保証済みのルートではなく、かつ30日未満のルートのみを追加
        if (!guaranteedRoutes.has(routeKey) && route.travelDays < config.MAX_TRADE_ROUTE_DAYS) {
            // 未所属の交易路として国籍ID:0 を設定
            route.nationId = 0; // 中立的な交易路
            finalTradeRoutes.push(route);
        }
    });

    await addLogMessage(`交易路を選別し、${finalTradeRoutes.length}本に絞り込みました。`);

    // 選別された交易路を描画用データに変換し、allRoadPaths に追加
    const finalTradeRoutePaths = finalTradeRoutes.map(route => {
        return { path: route.path.map(p => ({ x: p.x, y: p.y })), level: 5, nationId: route.nationId };
    });
    allRoadPaths.push(...finalTradeRoutePaths);

    // 交易路の情報をヘックスに書き込む (通商路を上書きしないように)
    finalTradeRoutes.forEach(route => {
        route.path.forEach(pos => {
            const hex = allHexes[getIndex(pos.x, pos.y)];
            if (hex && !hex.properties.isWater) {
                if (!hex.properties.roadLevel || hex.properties.roadLevel < 5) {
                    hex.properties.roadLevel = 5;
                }
                // ヘックスの国籍も更新
                if (route.nationId > 0) {
                    hex.properties.nationId = route.nationId;
                }
            }
        });
    });

    // STEP 4: 階層的な下位道路の生成
    await addLogMessage("集落を結ぶ下位道路網を建設しています...");
    const hubs = [...capitals, ...regionalCapitals];
    const streets = allHexes.filter(h => h.properties.settlement === '街');
    const towns = allHexes.filter(h => h.properties.settlement === '町');
    const villages = allHexes.filter(h => h.properties.settlement === '村');

    // generateFeederRoadsは、更新されたcreateCostFunctionを内部で使うため、自動的に交易路を優先する
    const streetRoads = await generateFeederRoads(streets, hubs, allHexes, '街', addLogMessage);
    allRoadPaths.push(...streetRoads);

    // ... (町道、村道の生成も同様) ...
    const townRoads = await generateFeederRoads(towns, [...hubs, ...streets], allHexes, '町', addLogMessage);
    allRoadPaths.push(...townRoads);

    const villageRoads = await generateFeederRoads(villages, [...hubs, ...streets, ...towns], allHexes, '村', addLogMessage);
    allRoadPaths.push(...villageRoads);

    const seaRoutePaths = await generateSeaRoutes(worldData.allHexes, addLogMessage);
    allRoadPaths.push(...seaRoutePaths);

    // roadPaths を worldData に保存
    worldData.roadPaths = allRoadPaths;

    // ④ 領都の最終決定、経済シミュレーションを実行
    worldData.allHexes = await determineTerritories(worldData.allHexes, addLogMessage);

    // [CRITICAL] 経済シミュレーションの前に必ずシードをリセットし、再現性を保証する
    initGlobalRandom(worldData.seed);
    worldData.allHexes = await simulateEconomy(worldData.allHexes, addLogMessage);
    worldData.allHexes = await calculateTerritoryAggregates(worldData.allHexes, addLogMessage);
    worldData.allHexes = await calculateRoadTraffic(worldData.allHexes, worldData.roadPaths, addLogMessage);

    await addLogMessage("道路網、国境、経済情報を再描画しています...");
    await redrawRoadsAndNations(worldData.allHexes, worldData.roadPaths);

    updateButtonStates(4);
    loadingOverlay.style.display = 'none';
}

// ステップ5: 保存
async function runStep5_Save() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ5: 世界を保存しています...");

    if (GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
        try {
            await addLogMessage('生成した世界をデータベースに保存しています...');
            fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                mode: 'no-cors',
                cache: 'no-cache',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(compressWorldData()),
                redirect: 'follow'
            });
            await addLogMessage('保存リクエストを送信しました。');
        } catch (error) {
            await addLogMessage(`データベースへの保存に失敗しました: ${error.message}`);
        }
    } else {
        await addLogMessage('[設定注意] GASのURLが設定されていません。保存は行われません。');
    }

    await sleep(1000);
    loadingOverlay.style.display = 'none';
}

// ================================================================
// ■ データ圧縮・解凍ロジック (V2)
// ================================================================

// プロパティ名の短縮マッピング
const KEY_MAP = {
    // 基本プロパティ
    isWater: 'w',
    elevation: 'el',
    temperature: 't',
    precipitation_mm: 'pm',
    precipitation: 'p',
    climate: 'c',
    climateZone: 'cz',
    vegetation: 'v',
    terrainType: 'tt',
    flow: 'fl',
    isAlluvial: 'ia',
    hasSnow: 'hs',
    isCoastal: 'ic',
    isLakeside: 'il',
    beachNeighbors: 'bn',

    // マナ・資源・魔物
    manaValue: 'mv',
    manaRank: 'mr',
    resourceRank: 'rr',
    monsterRank: 'mor',

    // ポテンシャル・評価
    agriPotential: 'ap',
    forestPotential: 'fp',
    miningPotential: 'mp',
    fishingPotential: 'fip',
    huntingPotential: 'hp',
    pastoralPotential: 'pp',
    livestockPotential: 'lp',
    cultivatedArea: 'ca',
    habitability: 'hab',

    // 人口・集落・産業
    population: 'pop',
    settlement: 's',
    industry: 'ind',
    surplus: 'sur',
    shortage: 'sho',
    territoryData: 'tdat',
    nationId: 'n',
    parentHexId: 'ph',
    territoryId: 'ti',
    distanceToParent: 'dp',
    travelDaysToParent: 'td',

    // 道路
    roadLevel: 'rl',
    roadUsage: 'ru',
    roadLoss: 'rlo',
    landUsage: 'lu',
    waterUsage: 'wu',

    // landUse (フラット化)
    'landUse.river': 'lu_r',
    'landUse.desert': 'lu_d',
    'landUse.barren': 'lu_b',
    'landUse.grassland': 'lu_g',
    'landUse.forest': 'lu_f',

    // 社会構成
    demographics: 'dem',
    facilities: 'fac',
    livingConditions: 'lc',
    logistics: 'log',
    vegetationAreas: 'va'
};

// 逆マッピング（解凍用）
const REVERSE_KEY_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

// 辞書化対象のキー
const DICTIONARY_KEYS = ['cz', 'v', 'tt', 's', 'mr', 'rr'];

// 産業・領土データのキー短縮マップ
const INDUSTRY_ITEM_MAP = {
    // 第一次
    '雑穀': 'mi', '大麦': 'ba', '小麦': 'wh', '稲': 'ri', '果物': 'fr', '薬草': 'he',
    '魚介類': 'fi', '木材': 'wo', '鉱石': 'or', '魔鉱石': 'mo',
    '牧畜肉': 'mp', '乳製品': 'da', '革': 'le', '魔獣素材': 'mt',
    '家畜肉': 'ml', '狩猟肉': 'mh',
    // 第二次
    '武具・道具': 'tl', '織物': 'tx', 'ポーション・魔導具': 'mg',
    '酒(穀物)': 'ag', '酒(果実)': 'af', '建築': 'bd',
    // 第三次
    '商業・交易': 'cm', '宿屋・酒場': 'in', '医療・教会': 'md', '運送・交通': 'tr',
    // 第四次
    '魔法研究': 'rs', '学問・歴史': 'ac', '戦略・軍事': 'mil', '情報・予言': 'it',
    // 第五次
    '行政・税収': 'ad', 'ギルド統括': 'gu', '芸術・文化': 'ar', '世界儀式': 'rt',
    // 領土データ用
    'population': 'pop', 'cultivatedArea': 'ca', 'production': 'prod', 'settlementCounts': 'sc',
    '都市': 'cit', '領都': 'reg', '街': 'str', '町': 'twn', '村': 'vil', '首都': 'cap',
    // 人口構成
    '貴族': 'nob', '騎士': 'kni', '正規兵': 'sol', '衛兵・自警団': 'gua', '傭兵': 'mer',
    '農夫': 'far', '木こり': 'lum', '鉱夫': 'min', '漁師': 'fis', '牧畜民': 'pas', '狩人': 'hun',
    '職人': 'art', '商人': 'tra', '学者': 'sch', '官僚': 'bur', '神官・医師・薬師': 'pri', '冒険者': 'adv', '浮浪者': 'vag',
    '錬金術師': 'alc',
    // 施設
    '商会・商店': 'shp', '行商・露店': 'ped', '宿屋': 'inn', '酒場・食堂': 'tav',
    '鍛冶屋': 'smi', '工房': 'wor', '診療所': 'cli', '教会': 'chu', '運送屋': 'car', '厩舎': 'sta',
    '研究所': 'lab', '学校': 'col', '兵舎': 'bar', '砦': 'for', '役所': 'off', 'ギルド': 'gui',
    '劇場・美術館': 'the', '儀式場': 'rit', '魔道具店': 'mag',
    // 施設(港湾)
    '大型港湾': 'lpt', '港': 'prt', '船着き場': 'dck', '桟橋': 'pie', '渡し場': 'fer', '造船所': 'shy',
    // 物流
    'wagons': 'wag', 'animals': 'ani', 'ships': 'shp_l', 'drivers': 'dri',
    '馬': 'hrs', '牛': 'ox', 'ラクダ': 'cam', 'トナカイ': 'rei', '水牛': 'buf', '象': 'ele', 'ラバ': 'mul', '犬': 'dog',
    'dinghy': 'din', 'small_trader': 's_tr', 'coastal_trader': 'c_tr', 'medium_merchant': 'm_mr', 'large_sailing_ship': 'l_ss',
    '小舟': 's_bt', '商船': 'm_bt', '大型帆船': 'l_bt',
    // 生活水準
    'hunger': 'hun', 'poverty': 'pov', 'luxury': 'lux', 'security': 'sec', 'prices': 'prc',
    'tax': 'tax', 'happiness': 'hap', 'food': 'fd', 'necessities': 'nec',
    // 植生エリア (v3.4)
    'desert': 'des', 'wasteland': 'was', 'grassland': 'gra', 'wetland': 'wet',
    'temperateForest': 't_for', 'subarcticForest': 's_for', 'tropicalRainforest': 'tr_for',
    'alpine': 'alp', 'tundra': 'tun', 'savanna': 'sav', 'steppe': 'ste', 'coastal': 'coa', 'water': 'wat'
};
const REVERSE_INDUSTRY_ITEM_MAP = Object.fromEntries(Object.entries(INDUSTRY_ITEM_MAP).map(([k, v]) => [v, k]));

// 産業階層の短縮キー
const INDUSTRY_LEVEL_MAP = {
    'primary': 'p', 'secondary': 's', 'tertiary': 't', 'quaternary': 'q4', 'quinary': 'q5'
};
const REVERSE_INDUSTRY_LEVEL_MAP = Object.fromEntries(Object.entries(INDUSTRY_LEVEL_MAP).map(([k, v]) => [v, k]));

/**
 * 世界データを圧縮形式に変換する共通関数
 */
function compressWorldData() {
    if (!worldData || !worldData.allHexes) return null;

    // [DEBUG] 保存前のデータ検証
    const missingVeg = worldData.allHexes.filter(h => !h.properties.vegetation).length;
    if (missingVeg > 0) {
        console.warn(`[WARN] Compressing data but ${missingVeg} hexes are missing vegetation.`);
    }

    // 1. 辞書の作成
    const dictionaries = {};
    DICTIONARY_KEYS.forEach(k => dictionaries[k] = []);

    const getDictIndex = (key, value) => {
        if (value === null || value === undefined) return null;
        let idx = dictionaries[key].indexOf(value);
        if (idx === -1) {
            idx = dictionaries[key].length;
            dictionaries[key].push(value);
        }
        return idx;
    };

    // ヘルパー: ネストされたオブジェクトの圧縮 (x1000整数化 + キー短縮)
    const compressNestedObject = (obj) => {
        if (!obj) return null;
        const compressed = {};
        Object.entries(obj).forEach(([k, v]) => {
            const shortKey = INDUSTRY_ITEM_MAP[k] || k;
            if (typeof v === 'number') {
                // 1000倍して整数化 (小数点以下3桁まで保持)
                compressed[shortKey] = Math.round(v * 1000);
            } else if (typeof v === 'object' && v !== null) {
                compressed[shortKey] = compressNestedObject(v);
            } else {
                compressed[shortKey] = v;
            }
        });
        // 空オブジェクトならnullを返す（さらに削減）
        if (Object.keys(compressed).length === 0) return null;
        return compressed;
    };

    // 2. ヘックスデータの圧縮
    const compressedHexes = worldData.allHexes.map(h => {
        const cHex = {};

        // Hexクラスのゲッターは列挙されないため、KEY_MAPとlandUseからキーリストを作成して反復
        const keysToProcess = Object.keys(KEY_MAP).filter(k => !k.includes('.'));
        keysToProcess.push('landUse');

        keysToProcess.forEach(key => {
            const value = h.properties[key];

            // landUseの特別処理 (フラット化)
            if (key === 'landUse' && value) {
                if (value.river > 0) cHex[KEY_MAP['landUse.river']] = parseFloat(value.river.toFixed(2));
                if (value.desert > 0) cHex[KEY_MAP['landUse.desert']] = parseFloat(value.desert.toFixed(2));
                if (value.barren > 0) cHex[KEY_MAP['landUse.barren']] = parseFloat(value.barren.toFixed(2));
                if (value.grassland > 0) cHex[KEY_MAP['landUse.grassland']] = parseFloat(value.grassland.toFixed(2));
                if (value.forest > 0) cHex[KEY_MAP['landUse.forest']] = parseFloat(value.forest.toFixed(2));
                return;
            }

            // 容量削減: ロード時に再計算可能なデータは保存しない (v3.0.1: 強力なサイズ最適化)
            // industryも含めることでファイルサイズを劇的に削減 (ロード時に simulateEconomy で再構築されるため不要)
            // 容量削減: ロード時に再計算可能なデータは保存しない (v3.0.1: 強力なサイズ最適化)
            // industryも含めることでファイルサイズを劇的に削減 (ロード時に simulateEconomy で再構築されるため不要)
            if (key === 'industry' || key === 'livingConditions' || key === 'demographics' || key === 'facilities' || key === 'logistics' || key === 'vegetationAreas' || key === 'ships' || key === 'isCoastal' || key === 'isLakeside') return;

            // industryの特別処理 (ネスト圧縮)
            if (key === 'industry' && value) {
                const cInd = {};
                let hasContent = false;
                Object.entries(value).forEach(([level, data]) => {
                    const compressedLevelData = compressNestedObject(data);
                    if (compressedLevelData) {
                        cInd[INDUSTRY_LEVEL_MAP[level] || level] = compressedLevelData;
                        hasContent = true;
                    }
                });
                if (hasContent) cHex[KEY_MAP['industry']] = cInd;
                return;
            }

            // territoryDataの特別処理 (ネスト圧縮)
            if (key === 'territoryData' && value) {
                const cTdat = compressNestedObject(value);
                if (cTdat) cHex[KEY_MAP['territoryData']] = cTdat;
                return;
            }

            // demographicsの特別処理
            if (key === 'demographics' && value) {
                const cDem = compressNestedObject(value);
                if (cDem) cHex[KEY_MAP['demographics']] = cDem;
                return;
            }

            // facilitiesの特別処理
            if (key === 'facilities' && value) {
                const cFac = compressNestedObject(value);
                if (cFac) cHex[KEY_MAP['facilities']] = cFac;
                return;
            }

            // logisticsの特別処理
            if (key === 'logistics' && value) {
                const cLog = compressNestedObject(value);
                if (cLog) cHex[KEY_MAP['logistics']] = cLog;
                return;
            }

            // livingConditionsの特別処理
            if (key === 'livingConditions' && value) {
                const cLc = compressNestedObject(value);
                if (cLc) cHex[KEY_MAP['livingConditions']] = cLc;
                return;
            }

            // vegetationAreasの特別処理 (ネスト圧縮)
            if (key === 'vegetationAreas' && value) {
                const cVa = compressNestedObject(value);
                if (cVa) cHex[KEY_MAP['vegetationAreas']] = cVa;
                return;
            }

            const shortKey = KEY_MAP[key];
            if (!shortKey) return;

            // デフォルト値の省略
            if (value === null || value === undefined) return;
            if (key === 'roadLevel' && value === 0) return;
            if (key === 'nationId' && (value === 0 || isNaN(value))) return;
            if (key === 'nationId' && (value === 0 || isNaN(value))) return;
            // 海水域 (elevation <= 0) の場合は isWater フラグを保存しない (復元時に推定)
            if (key === 'isWater') {
                if (!value) return; // falseなら保存しない
                if (h.properties.elevation <= 0) return; // 海域なら保存しない（湖沼のみ保存）
            }
            if (key === 'flow' && value === 0) return;
            if (key === 'population' && value === 0) return;

            // 容量削減: ロード時に再計算可能なデータは保存しない (v3.0.1: サイズ最適化)
            // 値の変換・圧縮
            if (DICTIONARY_KEYS.includes(shortKey)) {
                cHex[shortKey] = getDictIndex(shortKey, value);
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    cHex[shortKey] = value;
                } else {
                    cHex[shortKey] = parseFloat(value.toFixed(2));
                }
            } else {
                cHex[shortKey] = value;
            }
        });

        // downstreamIndexの保存
        if (h.downstreamIndex !== undefined && h.downstreamIndex !== -1) {
            cHex[KEY_MAP['downstreamIndex']] = h.downstreamIndex;
        }

        return cHex;
    });

    // 3. 道路データの圧縮 (座標リストをフラット化)
    const compressedRoads = worldData.roadPaths ? worldData.roadPaths.map(r => ({
        l: r.level,
        n: r.nationId,
        p: r.path.flatMap(p => [
            Number.isInteger(p.x) ? p.x : parseFloat(p.x.toFixed(2)),
            Number.isInteger(p.y) ? p.y : parseFloat(p.y.toFixed(2))
        ])
    })) : [];

    return {
        version: 2,
        seed: worldData.seed || globalRandom.initialSeed || Date.now(), // シードを保存
        cols: config.COLS,
        rows: config.ROWS,
        dicts: dictionaries,
        hexes: compressedHexes,
        roads: compressedRoads
    };
}

/**
 * データを圧縮してダウンロードする
 */
function downloadWorldData() {
    const finalData = compressWorldData();
    if (!finalData) {
        alert("ダウンロードするデータがありません。");
        return;
    }

    const dataStr = JSON.stringify(finalData);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "world_data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ================================================================
// ■ メイン処理とイベントハンドラ
// ================================================================

async function generateNewWorld() {
    // 再生成の通知を送信 (非同期で実行し、完了を待たない)
    notifyRegenerationAttempt();

    resetWorld();

    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';

    // 全ステップを連続実行
    await runStep1_Continent();
    await runStep2_Climate();
    await runStep3_Settlements();
    await runStep4_Nations();

    loadingOverlay.style.display = 'none';
}

/**
 * ロードしたデータに対し、距離と日数を再計算する関数
 */
async function recalculateDistances(worldData) {
    await addLogMessage("集落間の距離を再計算しています...");
    const { allHexes, roadPaths } = worldData;
    if (!allHexes || !roadPaths) return;

    const settlementsWithParent = allHexes.filter(h => h.properties.parentHexId !== null);

    for (const s of settlementsWithParent) {
        const parentHex = allHexes[s.properties.parentHexId];
        if (!parentHex) continue;

        // この集落と親を結ぶ道路を roadPaths から探す
        const settlementId = getIndex(s.col, s.row);
        const parentId = s.properties.parentHexId;

        let targetRoad = roadPaths.find(road => {
            const startId = getIndex(road.path[0].x, road.path[0].y);
            const endId = getIndex(road.path[road.path.length - 1].x, road.path[road.path.length - 1].y);
            return (startId === settlementId && endId === parentId) || (startId === parentId && endId === settlementId);
        });

        // もし道路が見つかったら、距離と日数を計算してセット
        if (targetRoad) {
            const roadLevel = targetRoad.level;
            const distance = calculateRoadDistance(targetRoad.path, roadLevel, allHexes);
            const travelDays = calculateTravelDays(targetRoad.path, roadLevel, allHexes);
            s.properties.distanceToParent = distance;
            s.properties.travelDaysToParent = travelDays;
        }
    }
}

/**
 * 経済指標（治安、物価、租税、幸福度）を再計算する関数
 * ロード時にデータが不足している場合や、最新のロジックを適用する場合に使用
 */
async function recalculateEconomyMetrics(worldData) {
    await addLogMessage("経済指標を再計算しています...");
    const { allHexes, roadPaths } = worldData;
    if (!allHexes) return;

    // 1. 産業構造・人口内訳・施設などを再シミュレーション (Industry, Logistics base)
    // warn: simulateEconomy initializes p.industry={}, so it requires p.population > 0
    try {
        console.log("[Econ] Starting simulateEconomy...");
        // [CRITICAL] 再計算時も生成時と同じシード状態で開始する
        if (worldData.seed) initGlobalRandom(worldData.seed);
        await simulateEconomy(allHexes, addLogMessage);
        console.log("[Econ] simulateEconomy finished.");
    } catch (e) {
        console.error("[Econ] Error in simulateEconomy:", e);
        await addLogMessage(`シミュレーションエラー: ${e.message}`);
    }

    // [FIX] 削除してしまった重要計算ロジックを復元
    calculateShipOwnership(allHexes);
    generateCityCharacteristics(allHexes);
    calculateDemographics(allHexes);
    calculateFacilities(allHexes);
    calculateTerritoryAggregates(allHexes);

    // 2. 交通量の再計算 (simulateEconomy内ではスキップされているためここで行う)
    if (roadPaths) {
        await calculateRoadTraffic(allHexes, roadPaths, addLogMessage);
    }

    // 3. 生活水準の再計算 (交通量や物価変動を反映するため、最後にもう一度実行)
    // simulateEconomy内でも呼ばれるが、RoadTrafficの後に行うのが確実
    calculateLivingConditions(allHexes);

    return allHexes;
}

async function loadExistingWorld() {
    try {
        await addLogMessage('既存の世界データを読み込み中...');
        progressBarContainer.style.display = 'block';

        let loadedData = null;

        // 1. 静的ファイル (world_data.json)
        try {
            const staticRes = await fetch('./world_data.json');
            if (staticRes.ok) {
                loadedData = await staticRes.json();
                await addLogMessage('静的ファイルからデータを読み込みました。');
            }
        } catch (e) { /* 無視 */ }

        // 2. GASフォールバック
        if (!loadedData) {
            await loadFromGAS();
            return;
        }

        await processLoadedData(loadedData);

    } catch (error) {
        console.error(error);
        await addLogMessage(`読み込みエラー: ${error.message}`);
        loadingOverlay.style.display = 'none';
    }
}

async function loadFromGAS() {
    try {
        loadingOverlay.style.display = 'flex';
        progressBarContainer.style.display = 'block';
        logContainer.innerHTML = '';

        if (!GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
            await addLogMessage('[設定注意] GASのURLが設定されていません。');
            loadingOverlay.style.display = 'none';
            return;
        }

        await addLogMessage('データベース(GAS)からデータを取得しています...');
        const response = await fetch(GAS_WEB_APP_URL);
        if (!response.ok) throw new Error(`サーバーからの応答が不正です (ステータス: ${response.status})`);

        const loadedData = await response.json();
        await processLoadedData(loadedData);

    } catch (error) {
        console.error(error);
        await addLogMessage(`GAS読み込みエラー: ${error.message}`);
        loadingOverlay.style.display = 'none';
    }
}

async function processLoadedData(loadedData) {
    // シードの復元とPRNG初期化
    if (loadedData.seed) {
        worldData.seed = loadedData.seed;
        initGlobalRandom(loadedData.seed);
        // [FIX] ノイズ関数も初期化する (砂浜生成などに必要)
        initializeNoiseFunctions(worldData.seed);
        await addLogMessage(`シード値を復元しました: ${loadedData.seed}`);
    } else {
        await addLogMessage(`[WARN] 保存データにシードが含まれていません。再現性が保証されません。`);
        initGlobalRandom(Date.now());
        initializeNoiseFunctions(Date.now());
    }

    // V2フォーマット (圧縮版) の場合
    if (loadedData.version === 2) {
        await addLogMessage('圧縮データ(V2)を展開しています...');

        // 辞書の復元
        const dicts = loadedData.dicts;
        const getDictValue = (key, idx) => {
            if (idx === null || idx === undefined) return null;
            return dicts[key][idx];
        };

        // ヘルパー: ネストされたオブジェクトの解凍 (x1000復元 + キー復元)
        const decompressNestedObject = (obj) => {
            if (!obj) return null;
            const decompressed = {};
            Object.entries(obj).forEach(([k, v]) => {
                const originalKey = REVERSE_INDUSTRY_ITEM_MAP[k] || k;
                if (typeof v === 'number') {
                    // 1000で割って元のスケールに戻す
                    decompressed[originalKey] = v / 1000;
                } else if (typeof v === 'object' && v !== null) {
                    decompressed[originalKey] = decompressNestedObject(v);
                } else {
                    decompressed[originalKey] = v;
                }
            });
            return decompressed;
        };

        // ヘックスデータの展開
        // [FIX] 配列ではなくWorldMapインスタンスとして初期化
        worldData.allHexes = new WorldMap(loadedData.cols, loadedData.rows);

        loadedData.hexes.forEach((h, index) => {
            const hex = worldData.allHexes[index];

            // プロパティの展開
            const props = {};

            // landUseの再構築
            const landUse = {};
            let hasLandUse = false;

            Object.entries(h).forEach(([k, v]) => {
                const originalKey = REVERSE_KEY_MAP[k];
                if (!originalKey) return;

                // landUse関連
                if (originalKey.startsWith('landUse.')) {
                    const subKey = originalKey.split('.')[1];
                    landUse[subKey] = v;
                    hasLandUse = true;
                    return;
                }

                // industry (ネスト解凍)
                if (originalKey === 'industry') {
                    const ind = {};
                    Object.entries(v).forEach(([lvl, data]) => {
                        const originalLvl = REVERSE_INDUSTRY_LEVEL_MAP[lvl] || lvl;
                        ind[originalLvl] = decompressNestedObject(data);
                    });
                    // 空の階層も初期化しておく（安全性のため）
                    ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'].forEach(l => {
                        if (!ind[l]) ind[l] = {};
                    });
                    props.industry = ind;
                    // production互換性
                    props.production = { ...ind.primary };
                    return;
                }

                // territoryData (ネスト解凍)
                if (originalKey === 'territoryData') {
                    props.territoryData = decompressNestedObject(v);
                    return;
                }

                // demographics (ネスト解凍)
                if (originalKey === 'demographics') {
                    props.demographics = decompressNestedObject(v);
                    return;
                }

                // facilities (ネスト解凍)
                if (originalKey === 'facilities') {
                    props.facilities = decompressNestedObject(v);
                    return;
                }

                // logistics (ネスト解凍)
                if (originalKey === 'logistics') {
                    props.logistics = decompressNestedObject(v);
                    return;
                }

                // livingConditions (ネスト解凍)
                if (originalKey === 'livingConditions') {
                    props.livingConditions = decompressNestedObject(v);
                    return;
                }

                // vegetationAreas (ネスト解凍)
                if (originalKey === 'vegetationAreas') {
                    props.vegetationAreas = decompressNestedObject(v);
                    return;
                }

                // 辞書参照
                if (DICTIONARY_KEYS.includes(k)) {
                    props[originalKey] = getDictValue(k, v);
                } else {
                    props[originalKey] = v;
                }
            });

            if (hasLandUse) {
                props.landUse = {
                    river: landUse.river || 0,
                    desert: landUse.desert || 0,
                    barren: landUse.barren || 0,
                    grassland: landUse.grassland || 0,
                    forest: landUse.forest || 0
                };
            }

            // デフォルト値の復元
            // 海水域の推定: フラグがない場合、標高0以下なら水域とする
            if (props.isWater === undefined) props.isWater = (props.elevation <= 0);
            if (props.roadLevel === undefined) props.roadLevel = 0;
            if (props.nationId === undefined || props.nationId === null || isNaN(props.nationId)) props.nationId = 0;
            if (props.flow === undefined) props.flow = 0;
            if (props.population === undefined) props.population = 0;
            if (props.settlement === undefined) props.settlement = null;
            if (props.roadUsage === undefined) props.roadUsage = 0;
            if (props.roadLoss === undefined) props.roadLoss = 0;
            if (!props.landUse) {
                props.landUse = {
                    river: 0,
                    desert: 0,
                    barren: 0,
                    grassland: 0,
                    forest: 0
                };
            }
            if (!props.industry) props.industry = { primary: {}, secondary: {}, tertiary: {}, quaternary: {}, quinary: {} };
            if (!props.production) props.production = {};
            if (!props.surplus) props.surplus = {};
            if (!props.shortage) props.shortage = {};

            // Hexオブジェクトにプロパティを適用
            Object.assign(hex.properties, props);

            // downstreamIndexの復元
            if (h[KEY_MAP['downstreamIndex']] !== undefined) {
                hex.downstreamIndex = h[KEY_MAP['downstreamIndex']];
            } else {
                hex.downstreamIndex = -1;
            }
        });
        worldData.roadPaths = loadedData.roads.map(r => {
            const path = [];
            for (let i = 0; i < r.p.length; i += 2) {
                path.push({ x: r.p[i], y: r.p[i + 1] });
            }
            return {
                level: r.l,
                nationId: r.n,
                path: path
            };
        });

        // [CRITICAL] 配列にcols/rowsプロパティを付与 (UI等で使用)
        worldData.allHexes.cols = loadedData.cols;
        worldData.allHexes.rows = loadedData.rows;

    } else {
        // V1 (旧形式)
        worldData = loadedData;
        // V1でもプロパティがない場合はconfigから補完（サイズ不一致リスクあり）
        if (!worldData.allHexes.cols) worldData.allHexes.cols = loadedData.cols || config.COLS;
        if (!worldData.allHexes.rows) worldData.allHexes.rows = loadedData.rows || config.ROWS;

        await addLogMessage('旧形式のデータを読み込みました。');
    }

    // コンフィグ更新 (必要なら)
    // neighborsの完全再計算
    const mapCols = worldData.allHexes.cols;
    const mapRows = worldData.allHexes.rows;
    worldData.allHexes.forEach(h => {
        h.neighbors = getNeighborIndices(h.col, h.row, mapCols, mapRows);
    });

    // 既存のgetIndex関数を利用
    worldData.allHexes.forEach(h => {
        // [CRITICAL] isWaterフラグの復元
        // ユーザー要件: "w"は湖沼のみ保存。標高がマイナスなら海洋。

        // 英語→日本語マッピング (Legacy data support)
        const LEGACY_VEG_MAP = {
            'grassland': '草原',
            'forest': '森林',
            'temperateForest': '温帯林',
            'subarcticForest': '亜寒帯林',
            'tropicalRainforest': '熱帯雨林',
            'desert': '砂漠',
            'wetland': '湿地',
            'tundra': 'ツンドラ',
            'ice': '氷雪帯',
            'savanna': 'サバンナ',
            'steppe': 'ステップ',
            'alpine': 'アルパイン',
            'wasteland': '荒れ地',
            'coastal': '沿岸植生',
            'ocean': '海洋',
            'deep_ocean': '深海',
            'lake': '湖沼'
        };

        if (LEGACY_VEG_MAP[h.properties.vegetation]) {
            h.properties.vegetation = LEGACY_VEG_MAP[h.properties.vegetation];
        }

        const veg = h.properties.vegetation;
        const w = h.properties.w || h.properties.isWater;

        if (h.properties.elevation <= 0) {
            h.properties.isWater = true;
            // 植生が未設定または不整合なら補正
            // v3.2: '湖沼'はelevation <= 0でもあり得るので上書きしない
            if (!veg || (veg !== '海洋' && veg !== '深海' && veg !== '湖沼')) {
                if (h.properties.elevation < -500) h.properties.vegetation = '深海';
                else h.properties.vegetation = '海洋';
            }
        } else if (w === true || veg === '湖沼') {
            h.properties.isWater = true;
            if (!veg) h.properties.vegetation = '湖沼';
        } else {
            h.properties.isWater = false;
        }

    });

    // 簡易的なneighbors再構築ブロックは除去 (utils.jsのgetNeighborIndicesを用いた正確なロジックに置き換えたため)
    // 以前のコードがここで上書きしていたため、バグが再発していた。

    // データ補完: 河川プロパティの再計算
    // downstreamIndexが保存されていない(V2初期)場合、または河川が表示されない場合は再構築が必要
    const riverHexes = worldData.allHexes.filter(h => h.properties.flow > 0);
    const missingRivers = riverHexes.some(h => h.downstreamIndex === -1);

    // [DEBUG] 河川データの状態確認
    console.log(`[River Debug] Flow > 0 hexes: ${riverHexes.length}`);
    console.log(`[River Debug] Missing downstreamIndex: ${riverHexes.filter(h => h.downstreamIndex === -1).length}`);

    // データ救済措置: flowデータが全くない場合は再生成する (v3.Xデータ消失対応)
    if (riverHexes.length === 0) {
        await addLogMessage("河川データが検出されません。河川システムを再生成します...");
        initializeNoiseFunctions();
        generateWaterSystems(worldData.allHexes);

        // 再生成後のステータス更新
        recalculateRiverProperties(worldData.allHexes);

    } else if (missingRivers) {
        await addLogMessage(`河川接続データ欠損を検出: ${riverHexes.filter(h => h.downstreamIndex === -1).length}箇所`);

        // 簡易復元: flowがある全ヘックスについて、最も標高が低い隣接ヘックスを下流とみなす
        let restoredCount = 0;
        worldData.allHexes.forEach(h => {
            if (h.properties.flow > 0 && h.downstreamIndex === -1 && !h.properties.isWater) {
                let minElev = h.properties.elevation;
                let targetIndex = -1;

                // 隣接ヘックスを走査
                h.neighbors.forEach(nIndex => {
                    const n = worldData.allHexes[nIndex];
                    if (n.properties.elevation < minElev) {
                        minElev = n.properties.elevation;
                        targetIndex = nIndex;
                    }
                });

                // 下流が見つかれば接続
                if (targetIndex !== -1) {
                    h.downstreamIndex = targetIndex;
                    restoredCount++;
                }
            }
        });

        console.log(`[River Debug] Restored connections: ${restoredCount}`);
        if (restoredCount > 0) {
            await addLogMessage(`${restoredCount}箇所の河川接続を復元しました`);
        }

        recalculateRiverProperties(worldData.allHexes);
    } else {
        recalculateRiverProperties(worldData.allHexes);
    }

    // [MOVED] generateRidgeLines called later after seed init

    // 水域植生の初期化 (沿岸判定の前に必須)
    initializeWaterVegetation(worldData.allHexes);

    // [DEBUG] Diagnosing why Coastal becomes 0
    let waterCount = 0;
    let oceanCount = 0;
    let lakeCount = 0;
    let deepSeaCount = 0;
    let validNeighborCount = 0;

    worldData.allHexes.forEach(h => {
        if (h.properties.isWater) {
            waterCount++;
            if (h.properties.vegetation === '海洋') oceanCount++;
            if (h.properties.vegetation === '湖沼') lakeCount++;
            if (h.properties.vegetation === '深海') deepSeaCount++;
        } else {
            // Check neighbors for land hexes
            if (h.neighbors && h.neighbors.length > 0) validNeighborCount++;
        }
    });
    console.log(`[Geo Flag Debug] Water: ${waterCount} (Ocean: ${oceanCount}, Lake: ${lakeCount}, DeepSea: ${deepSeaCount}), Land with Neighbors: ${validNeighborCount}`);

    // Check a sample land hex
    const sampleLand = worldData.allHexes.find(h => !h.properties.isWater && h.properties.elevation > 0);
    if (sampleLand) {
        console.log(`[Geo Flag Debug] Sample Land Hex [${sampleLand.col},${sampleLand.row}] Neighbors:`, sampleLand.neighbors);
        sampleLand.neighbors.forEach(ni => {
            const n = worldData.allHexes[ni];
            console.log(`  - Neighbor ${ni}: isWater=${n.properties.isWater}, Veg=${n.properties.vegetation}`);
        });
    }

    // 地理的フラグ（沿岸・湖岸）の再計算
    recalculateGeographicFlags(worldData.allHexes);

    // 植生エリアデータが欠落している場合の再計算
    const missingVegAreas = worldData.allHexes.filter(h => !h.properties.vegetationAreas && !h.properties.isWater).length;

    // データが欠落しているか、あるいは念のため常に再計算/復元する
    if (missingVegAreas > 0) {
        await addLogMessage(`植生詳細データ(${missingVegAreas}件)を再計算しています...`);
    } else {
        await addLogMessage(`地形特性を復元しています...`);
    }

    // ノイズ関数の再初期化
    // initGlobalRandomでシードを設定してからinitializeNoiseFunctionsを呼ぶ必要があります
    if (worldData.seed) {
        initGlobalRandom(worldData.seed);
        initializeNoiseFunctions(); // 引数不要、グローバルなglobalRandomを使用
        console.log(`[Restoration Debug] Global Random re-initialized with seed: ${worldData.seed}`);
    } else {
        console.warn(`[Restoration Warning] No seed found in worldData!`);
    }

    // 稜線データの再生成 (シード初期化後に実行)
    // generateRidgeLines calls globalRandom, so it MUST be here
    generateRidgeLines(worldData.allHexes);

    // 地理的フラグ（沿岸・湖岸）の再計算 (念のため再実行 - 正確なvegetationが必要)
    recalculateGeographicFlags(worldData.allHexes);

    // 砂浜の形成 (再計算)
    generateBeaches(worldData.allHexes, loadedData.cols, loadedData.rows);

    // [DEBUG] Check beach generation
    let totalBeachHexes = 0;
    let coastalHexes = 0;
    worldData.allHexes.forEach(h => {
        if (h.properties.isCoastal) coastalHexes++;
        if (h.properties.beachNeighbors && h.properties.beachNeighbors.length > 0) totalBeachHexes++;
    });
    console.log(`[Beach Debug] Coastal: ${coastalHexes}, Beaches: ${totalBeachHexes}`);
    if (totalBeachHexes === 0 && coastalHexes > 0) {
        console.warn("[Beach Debug] Beaches not generated likely due to missing beachNoise initialization.");
    }

    // 最終プロパティ計算 (植生、産業ポテンシャル)
    // ノイズ関数が正しく初期化されているので、ここで正しい値になるはず
    // [FIX] 既存の植生(vegetation)を維持しつつ、vegetationAreasなどの詳細データのみ再計算する
    calculateFinalProperties(worldData.allHexes, loadedData.cols, loadedData.rows, { preserveVegetation: true });

    // 距離の再計算
    await recalculateDistances(worldData);

    // 人口データの復元チェック (散居対応)
    // 保存データを使用し、未設定(0またはnull)のもののみ補完する。
    // ただし、意図的に0の荒野などは上書きしないよう注意が必要だが、
    // ここでは settlement が '散居' と定義されているが人口がないケースなどを救済する
    let popRestored = 0;
    worldData.allHexes.forEach(h => {
        const p = h.properties;
        if (p.isWater) return; // 水域には人口なし

        // 人口が正しくロードされている場合はスキップ
        if (p.population > 0) return;

        // settlementタイプがあり、かつ人口がない場合のみ復元
        // (本来は保存されるべきだが、圧縮で消えている場合など)
        if (p.settlement && p.settlement !== 'none') {
            let basePop = 0;
            const sType = p.settlement;

            if (sType === '首都') basePop = 15000 + Math.floor(globalRandom.next() * 10000);
            else if (sType === '都市' || sType === '領都') basePop = 8000 + Math.floor(globalRandom.next() * 5000);
            else if (sType === '街') basePop = 3000 + Math.floor(globalRandom.next() * 2000);
            else if (sType === '町') basePop = 1000 + Math.floor(globalRandom.next() * 1000);
            else if (sType === '村') basePop = 200 + Math.floor(globalRandom.next() * 300);
            else if (sType === '散居') {
                basePop = 20 + Math.floor(globalRandom.next() * 50);
            }

            if (basePop > 0) {
                p.population = basePop;
                popRestored++;
            }
        }
    });

    if (popRestored > 0) {
        await addLogMessage(`${popRestored}箇所の集落人口を復元しました`);
    }

    // 経済指標の再計算 (不足データの補完 - 船舶数などもここ)
    await recalculateEconomyMetrics(worldData);

    // UI初期化・再描画
    if (!uiInitialized) {
        await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage);
        uiInitialized = true;
    } else {
        await redrawRoadsAndNations(worldData.allHexes, worldData.roadPaths);
    }

    // ミニマップの強制更新 (UI初期化後に実行)
    // 色分けデータが正しく反映されているか確認
    setTimeout(() => {
        updateMinimap(worldData.allHexes);
        console.log("[Minimap] Forced update triggered.");
    }, 500);

    updateButtonStates(4);
    loadingOverlay.style.display = 'none';
}



async function main() {
    loadingOverlay.style.display = 'flex';
    const loaded = await loadExistingWorld();
    if (!worldData.allHexes) { // worldData.allHexes が null のままならロード失敗
        await addLogMessage('新しい世界を創造します。「① 大陸・河川生成」ボタンを押してください。');
        updateButtonStates(0);
        loadingOverlay.style.display = 'none';
    }
}

// --- イベントリスナーの設定 ---
step1Btn.addEventListener('click', runStep1_Continent);
step2Btn.addEventListener('click', runStep2_Climate);
step3Btn.addEventListener('click', runStep3_Settlements);
step4Btn.addEventListener('click', runStep4_Nations);
step5Btn.addEventListener('click', runStep5_Save);
downloadJsonBtn.addEventListener('click', downloadWorldData);
loadGasBtn.addEventListener('click', loadFromGAS);
regenerateBtn.addEventListener('click', generateNewWorld);

// 初期ロード
window.addEventListener('load', main);

// --- 通知送信用のヘルパー関数 ---
async function notifyRegenerationAttempt() {
    try {
        // 1. 無料APIを使ってIPアドレスと場所情報を取得
        const ipResponse = await fetch('https://ipapi.co/json/');
        const ipData = await ipResponse.json();

        // 2. ユーザーエージェント（ブラウザ情報）を取得
        const userAgent = navigator.userAgent;

        // 3. GASにデータを送信
        if (GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
            fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                mode: 'no-cors',
                cache: 'no-cache',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    type: 'notification',       // 処理分岐用タグ
                    action: 'force_regenerate', // アクション名
                    ipData: ipData,             // IP情報オブジェクト
                    userAgent: userAgent        // ブラウザ情報
                })
            });
        }
    } catch (e) {
        console.warn("通知送信に失敗しましたが、処理は続行します。", e);
    }
}


