// ================================================================
// GeoForge System - メインスクリプト (v2.2 - 分割生成モデル)
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { generatePhysicalMap, generateClimateAndVegetation, generateRidgeLines } from './continentGenerator.js';
import { generateCivilization, determineTerritories, defineNations, assignTerritoriesByTradeRoutes, generateMonsterDistribution, generateHuntingPotential, generateLivestockPotential } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates, calculateRoadTraffic, calculateDemographics, calculateFacilities, calculateLivingConditions } from './economySimulator.js';
import { setupUI, redrawClimate, redrawSettlements, redrawRoadsAndNations, resetUI } from './ui.js';
import { generateTradeRoutes, generateFeederRoads, generateMainTradeRoutes, calculateRoadDistance, calculateTravelDays, generateSeaRoutes } from './roadGenerator.js';
import { getIndex } from './utils.js';

// GASのデプロイで取得したウェブアプリのURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyS8buNL8u2DK9L3UZRtQqLWgDLvuj0WE5ZrzzdXNXSWH3bnGo-JsiO9KSrHp6YOjmtvg/exec';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const progressBarContainer = document.getElementById('progress-bar-container');

// 分割生成のための状態管理変数
let worldData = {
    allHexes: null,
    roadPaths: null,
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
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ1: 大陸の土台を生成しています...");

    // 物理マップ生成のみを呼び出す
    worldData.allHexes = await generatePhysicalMap(addLogMessage);

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

    // ④ 領土の最終決定、経済シミュレーションを実行
    worldData.allHexes = await determineTerritories(worldData.allHexes, addLogMessage);
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

    // landUse (フラット化)
    'landUse.river': 'lu_r',
    'landUse.desert': 'lu_d',
    'landUse.barren': 'lu_b',
    'landUse.grassland': 'lu_g',
    'landUse.forest': 'lu_f',

    // 社会構成
    demographics: 'dem',
    facilities: 'fac',
    livingConditions: 'lc'
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
    // 生活水準
    'hunger': 'hun', 'poverty': 'pov', 'luxury': 'lux', 'security': 'sec', 'prices': 'prc',
    'tax': 'tax', 'happiness': 'hap', 'food': 'fd', 'necessities': 'nec'
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

            // livingConditionsの特別処理
            if (key === 'livingConditions' && value) {
                const cLc = compressNestedObject(value);
                if (cLc) cHex[KEY_MAP['livingConditions']] = cLc;
                return;
            }

            const shortKey = KEY_MAP[key];
            if (!shortKey) return;

            // デフォルト値の省略
            if (value === null || value === undefined) return;
            if (key === 'roadLevel' && value === 0) return;
            if (key === 'nationId' && (value === 0 || isNaN(value))) return;
            if (key === 'isWater' && value === false) return;
            if (key === 'flow' && value === 0) return;
            if (key === 'population' && value === 0) return;

            // 容量削減: ロード時に再計算可能なデータは保存しない
            if (key === 'livingConditions' || key === 'demographics' || key === 'facilities') return;

            // 空のオブジェクトは保存しない
            if (typeof value === 'object' && Object.keys(value).length === 0) return;

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
    const { allHexes } = worldData;
    if (!allHexes) return;

    allHexes.forEach(h => {
        // 人口構成がなければ計算
        if (!h.properties.demographics) {
            h.properties.demographics = calculateDemographics(h);
        }
        // 施設がなければ計算
        if (!h.properties.facilities) {
            h.properties.facilities = calculateFacilities(h);
        }
        // 生活水準を計算 (常に最新ロジックで上書き推奨だが、既存値がある場合は維持するか？
        // ここでは「表示されない」問題解決のため、無条件で再計算して最新化する)
        h.properties.livingConditions = calculateLivingConditions(h, allHexes);
    });
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
        worldData.allHexes = loadedData.hexes.map((h, index) => {
            // 座標の復元
            const col = index % loadedData.cols;
            const row = Math.floor(index / loadedData.cols);

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

                // livingConditions (ネスト解凍)
                if (originalKey === 'livingConditions') {
                    props.livingConditions = decompressNestedObject(v);
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
            if (props.isWater === undefined) props.isWater = false;
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

            return {
                col: col,
                row: row,
                x: col, // 互換性のため
                y: row, // 互換性のため
                properties: props,
                index: index,
                neighbors: [] // 後で再計算
            };
        });

        // neighborsの再計算
        const COLS = loadedData.cols;
        const ROWS = loadedData.rows;
        worldData.allHexes.forEach(h => {
            const neighbors = [];
            const directions = [
                [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]
            ];
            const isEvenCol = h.col % 2 === 0;

            directions.forEach((d, i) => {
                let neighborCol = h.col + d[0];
                let neighborRow = h.row + d[1];

                // 六角形グリッドの隣接補正
                if (d[0] !== 0) {
                    if (isEvenCol) {
                        if (d[1] === -1) neighborRow = h.row - 1; // 上
                        if (d[1] === 1) neighborRow = h.row;      // 下
                    } else {
                        if (d[1] === -1) neighborRow = h.row;
                        if (d[1] === 1) neighborRow = h.row + 1;
                    }
                }
            });
        });

        // 道路データの復元
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

    } else {
        // V1 (旧形式)
        worldData = loadedData;
        await addLogMessage('旧形式のデータを読み込みました。');
    }

    // コンフィグ更新 (必要なら)
    // config.COLS = loadedData.cols || config.COLS; 

    // neighborsの完全再計算 (utils.jsの機能を利用したいが、ここでは直接計算)
    // 既存のgetIndex関数を利用
    worldData.allHexes.forEach(h => {
        h.neighbors = [];
        const directions = [
            [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]
        ];
        const isEvenCol = h.col % 2 === 0;
        directions.forEach(d => {
            let nc = h.col + d[0];
            let nr = h.row + d[1];
            if (d[0] !== 0) {
                if (isEvenCol) {
                    if (d[1] === -1) nr = h.row - 1; // 右上・左上
                    if (d[1] === 0) nr = h.row;      // 右下・左下
                    if (d[1] === 1) nr = h.row;      // 補正
                } else {
                    if (d[1] === -1) nr = h.row;
                    if (d[1] === 0) nr = h.row + 1;
                    if (d[1] === 1) nr = h.row + 1;
                }
            }
        });
    });

    // 簡易的なneighbors再構築 (utils.jsのロジックを模倣)
    const getN = (c, r) => {
        if (c < 0 || c >= config.COLS || r < 0 || r >= config.ROWS) return null;
        return getIndex(c, r);
    };

    worldData.allHexes.forEach(h => {
        const c = h.col;
        const r = h.row;
        const neighbors = [];
        const isEven = c % 2 === 0;

        // 上
        neighbors.push(getN(c, r - 1));
        // 下
        neighbors.push(getN(c, r + 1));

        if (isEven) {
            neighbors.push(getN(c + 1, r - 1)); // 右上
            neighbors.push(getN(c + 1, r));     // 右下
            neighbors.push(getN(c - 1, r));     // 左下
            neighbors.push(getN(c - 1, r - 1)); // 左上
        } else {
            neighbors.push(getN(c + 1, r));     // 右上
            neighbors.push(getN(c + 1, r + 1)); // 右下
            neighbors.push(getN(c - 1, r + 1)); // 左下
            neighbors.push(getN(c - 1, r));     // 左上
        }
        h.neighbors = neighbors.filter(n => n !== null);
    });

    // 稜線データの再生成 (保存されていないため)
    generateRidgeLines(worldData.allHexes);

    // 距離の再計算
    await recalculateDistances(worldData);

    // 経済指標の再計算 (不足データの補完)
    await recalculateEconomyMetrics(worldData);

    // UI初期化・再描画
    if (!uiInitialized) {
        await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage);
        uiInitialized = true;
    } else {
        await redrawRoadsAndNations(worldData.allHexes, worldData.roadPaths);
    }

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
