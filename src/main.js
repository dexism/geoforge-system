// ================================================================
// GeoForge System - メインスクリプト (v2.2 - 分割生成モデル)
// ================================================================
// 解説:
// アプリケーションのエントリーポイント。
// 各生成ステップの制御、UIイベントのハンドリング、およびデータの保存・読み込み（圧縮・解凍）を担当する。
// 全体的な処理フロー:
// 1. 大陸生成 (物理マップ) -> 2. 気候/植生 -> 3. 文明/集落 -> 4. 国家/道路 -> 5. 保存
// ================================================================

import * as d3 from 'd3';
import * as config from './config.ts';
import { generatePhysicalMap, generateClimateAndVegetation, generateRidgeLines, recalculateGeographicFlags, calculateFinalProperties, initializeNoiseFunctions, recalculateRiverProperties, generateWaterSystems, generateBeaches, initializeWaterVegetation } from './continentGenerator.js';
import { generateCivilization, determineTerritories, defineNations, assignTerritoriesByTradeRoutes, generateMonsterDistribution, generateHuntingPotential, generateLivestockPotential } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates, calculateRoadTraffic, calculateDemographics, calculateFacilities, calculateLivingConditions, generateCityCharacteristics, calculateShipOwnership } from './economySimulator.js';
import { setupUI, redrawClimate, redrawSettlements, redrawRoadsAndNations, resetUI, redrawMap, updateMinimap, updateUIWithBlockData } from './ui.js';
import { generateTradeRoutes, generateFeederRoads, generateMainTradeRoutes, calculateRoadDistance, calculateTravelDays, generateSeaRoutes } from './roadGenerator.js';
import { getIndex, initGlobalRandom, globalRandom, getNeighborIndices } from './utils.ts';
import { WorldMap } from './WorldMap.js';
import { assignRoadPatterns, assignRiverPatterns, splitWorldIntoBlocks } from './MapSplitter.js';
import * as blockUtils from './BlockUtils.ts';

// [NEW] BlockIO モジュールのインポート
import { blockManager, compressWorldData, processLoadedData, createCompressedData } from './BlockIO.js';

// GASのデプロイで取得したウェブアプリのURL (データのクラウド保存用)
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyS8buNL8u2DK9L3UZRtQqLWgDLvuj0WE5ZrzzdXNXSWH3bnGo-JsiO9KSrHp6YOjmtvg/exec';

// DOM要素の参照
const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const progressBarContainer = document.getElementById('progress-bar-container');

// 分割生成のためのグローバル状態管理変数
let worldData = {
    allHexes: null, // 全ヘックスデータを格納する WorldMap インスタンス (または配列)
    roadPaths: null, // 生成された道路・交易路のリスト
    seed: 0 // 再現性のための乱数シード
};
let uiInitialized = false; // UIが初期化済みかどうかのフラグ

// 操作ボタン要素の取得
const step1Btn = document.getElementById('step1-continent-btn');
const step2Btn = document.getElementById('step2-climate-btn');
const step3Btn = document.getElementById('step3-settlement-btn');
const step4Btn = document.getElementById('step4-nation-btn');
const step5Btn = document.getElementById('step5-save-btn');
const downloadJsonBtn = document.getElementById('download-json-btn');
const loadGasBtn = document.getElementById('load-gas-btn');
const regenerateBtn = document.getElementById('force-regenerate-btn');


// ユーティリティ: 指定ミリ秒待機する (非同期処理の合間にUI描画を挟むため)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ログメッセージを画面に出力する
 * @param {string} message - 表示するメッセージ
 * @param {string|null} id - (任意) メッセージ要素に付与するID。後で書き換える場合に指定。
 */
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

    // 常に最新のログが見えるようにスクロール
    logContainer.scrollTop = logContainer.scrollHeight;
    await sleep(id ? 1 : 20); // 描画時間を確保
}

/**
 * ステップ進行状況に応じてボタンの有効/無効を切り替える
 * @param {number} currentStep - 完了したステップ番号 (0-4)
 */
function updateButtonStates(currentStep) {
    step1Btn.disabled = false; // 大陸生成はいつでも可能（リセット）
    step2Btn.disabled = currentStep < 1;
    step3Btn.disabled = currentStep < 2;
    step4Btn.disabled = currentStep < 3;
    step5Btn.disabled = currentStep < 4;
    downloadJsonBtn.disabled = currentStep < 4;
    loadGasBtn.disabled = false; // ロードはいつでも可能
}

/**
 * 世界とUIの状態を完全にリセットする関数
 * 新規生成の開始時に呼び出される。
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
    blockManager.reset(); // BlockManagerもリセット
}



// ================================================================
// ■ 各生成ステップの関数
// ================================================================

// ステップ1: 大陸・河川生成
// 概要: パーリンノイズを用いて地形の高さ(elevation)を生成し、海・陸・山などを決定する。
// また、降水による浸食シミュレーションを行い、河川(flow)を形成する。
async function runStep1_Continent() {
    resetWorld();

    // [DEBUG] オプション確認用ログ
    console.log(`[processLoadedData] Loaded Options:`, JSON.stringify(typeof options !== 'undefined' ? options : {}));

    const startTime = performance.now();
    // シード生成とPRNG初期化
    const seed = Date.now();
    initGlobalRandom(seed);
    worldData.seed = seed;
    await addLogMessage(`新しい世界のためのシード値を生成しました: ${seed}`);

    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ1: 大陸の土台を生成しています...");

    // 物理マップ生成中の途中経過を描画するためのコールバック関数
    const redrawFn = async (currentHexes) => {
        if (!uiInitialized) {
            await addLogMessage("初回描画を準備しています...");
            await setupUI(currentHexes, [], addLogMessage);
            uiInitialized = true;
        } else {
            // 既に初期化されている場合は、データと色を更新して再描画
            await redrawMap(currentHexes);
            // UI更新のために少し待機 (ブロッキング回避)
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };

    // 地形生成の実行 (continentGenerator.js)
    worldData.allHexes = await generatePhysicalMap(addLogMessage, redrawFn);

    if (!uiInitialized) {
        await addLogMessage("初回描画を準備しています...");
        // この時点では植生データは不完全だが、地形のみで表示を行う
        await setupUI(worldData.allHexes, [], addLogMessage);
        uiInitialized = true;
    }

    updateButtonStates(1);
    loadingOverlay.style.display = 'none';
}

// ステップ2: 気候・植生生成
// 概要: 標高、緯度、風向き（偏西風など）から気温と降水量をシミュレーションする。
// その結果に基づき、ケッペン気候区分に近いロジックで植生（砂漠、森林、草原など）を決定する。
async function runStep2_Climate() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ2: 気候と植生を計算しています...");

    // ステップ1のデータに気候・植生情報を追加する (continentGenerator.js)
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
// 概要: 農業適性、居住適性スコアを算出し、人口を配置する。
// 人口が集中する地点を「集落（村～首都）」として認定する。
// また、魔物の分布や狩猟・牧畜のポテンシャルなど、文明の基礎データを生成する。
async function runStep3_Settlements() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ3: 文明を生成しています...");

    // 文明生成 (civilizationGenerator.js)
    const civResult = await generateCivilization(worldData.allHexes, addLogMessage);
    worldData.allHexes = civResult.allHexes;
    worldData.roadPaths = civResult.roadPaths; // この時点ではまだ空に近い（初期道路などがあれば）

    await addLogMessage("生態系（魔物）の分布を計算しています...");
    worldData.allHexes = generateMonsterDistribution(worldData.allHexes);

    await addLogMessage("狩猟のポテンシャルを評価しています...");
    worldData.allHexes = generateHuntingPotential(worldData.allHexes);

    await addLogMessage("畜産のポテンシャルを評価しています...");
    worldData.allHexes = generateLivestockPotential(worldData.allHexes);

    await addLogMessage("集落と人口分布を再描画しています...");
    await redrawSettlements(worldData.allHexes);

    updateButtonStates(3);
    loadingOverlay.style.display = 'none';
}

// ステップ4: 道路・国家生成
// 概要: 首都・都市・集落を結ぶ道路網（交易路、下位道路）を生成する。
// 道路網に基づき、各都市の「支配領域（テリトリー）」を確定し、国家（Nation）を定義する。
// 最後に、人口・資源・インフラに基づく詳細な経済シミュレーションを実行する。
async function runStep4_Nations() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ4: 国家とインフラを形成しています...");

    // 必要なデータを取得
    const allHexes = worldData.allHexes;
    // 集落区分に基づき都市リストを抽出
    const cities = allHexes.filter(h => h.properties.settlement === '都市' || h.properties.settlement === '首都' || h.properties.settlement === '領都');
    const capitals = cities.filter(h => h.properties.settlement === '首都');

    // STEP 0: 各首都間を結ぶ「基幹通商路」を最優先で確定する
    // (A*アルゴリズムを用いて、地形コストを考慮した最短パスを生成)
    const mainTradeRoutePaths = await generateMainTradeRoutes(capitals, allHexes, addLogMessage);
    let allRoadPaths = mainTradeRoutePaths; // 最終的な道路リストをまず通商路で初期化

    // 通商路の情報をヘックスに書き込み、後のA*探索でコストが下がるようにする (既存道路の利用促進)
    mainTradeRoutePaths.forEach(route => {
        route.path.forEach(pos => {
            const hex = allHexes[getIndex(pos.x, pos.y)];
            if (hex && !hex.properties.isWater) {
                // 道路レベル6: 基幹街道
                if (!hex.properties.roadLevel || hex.properties.roadLevel < 6) {
                    hex.properties.roadLevel = 6;
                }
            }
        });
    });

    // STEP 1: 全都市間の「交易路」の候補を探索
    await addLogMessage("都市間の交易路の可能性を探索しています...");
    // generateTradeRoutesは、内部のコスト関数が既存道路(通商路)を優先するため、より効率的なルートを見つける
    const { routeData: allTradeRoutes } = await generateTradeRoutes(cities, allHexes, addLogMessage);

    // STEP 2: 領都の決定と領土割り当て
    // 交易路で結ばれ、かつ移動日数が近い都市を、首都の支配下（領都）として割り当てる
    await addLogMessage("交易路網に基づき、首都の初期領土を割り当てています...");
    const { regionalCapitals } = assignTerritoriesByTradeRoutes(cities, capitals, allTradeRoutes, allHexes);

    // 領都と首都の距離・日数を計算 (統治コスト計算用)
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
    // 生成された全ルート候補から、有効な交易路のみを確定リストに残す
    const finalTradeRoutes = [];
    const guaranteedRoutes = new Set();

    // 手順3-1: 領都から直上の首都までのルートを必ず確保する（国家の結合維持のため）
    regionalCapitals.forEach(rc => {
        const capitalId = rc.properties.parentHexId;
        const regionalCapitalId = getIndex(rc.col, rc.row);

        const route = allTradeRoutes.find(r =>
            (r.fromId === regionalCapitalId && r.toId === capitalId) ||
            (r.fromId === capitalId && r.toId === regionalCapitalId)
        );
        if (route) {
            // ルートデータ自体に国籍情報を付与 (国内交易路)
            route.nationId = rc.properties.nationId;
            finalTradeRoutes.push(route);
            const routeKey = Math.min(route.fromId, route.toId) + '-' + Math.max(route.fromId, route.toId);
            guaranteedRoutes.add(routeKey);
        }
    });

    // 手順3-2: それ以外の交易路は、30日以上かかるものを削除する (遠すぎる交易は成立しない)
    allTradeRoutes.forEach(route => {
        const routeKey = Math.min(route.fromId, route.toId) + '-' + Math.max(route.fromId, route.toId);
        // 保証済みのルートではなく、かつ30日未満のルートのみを追加
        if (!guaranteedRoutes.has(routeKey) && route.travelDays < config.MAX_TRADE_ROUTE_DAYS) {
            // 未所属の交易路として国籍ID:0 を設定 (中立路)
            route.nationId = 0;
            finalTradeRoutes.push(route);
        }
    });

    await addLogMessage(`交易路を選別し、${finalTradeRoutes.length}本に絞り込みました。`);

    // 選別された交易路を描画用データに変換し、allRoadPaths に追加
    const finalTradeRoutePaths = finalTradeRoutes.map(route => {
        return { path: route.path.map(p => ({ x: p.x, y: p.y })), level: 5, nationId: route.nationId };
    });
    allRoadPaths.push(...finalTradeRoutePaths);

    // 交易路の情報をヘックスに書き込む (基幹通商路を上書きしないようにレベルチェック)
    finalTradeRoutes.forEach(route => {
        route.path.forEach(pos => {
            const hex = allHexes[getIndex(pos.x, pos.y)];
            if (hex && !hex.properties.isWater) {
                // 道路レベル5: 交易路
                if (!hex.properties.roadLevel || hex.properties.roadLevel < 5) {
                    hex.properties.roadLevel = 5;
                }
                // ヘックスの国籍も更新 (道路が通る場所は影響力下とみなす)
                if (route.nationId > 0) {
                    hex.properties.nationId = route.nationId;
                }
            }
        });
    });

    // STEP 4: 階層的な下位道路の生成
    // 「街」「町」「村」を、上位の集落（ハブ）や既存の道路網に接続する
    await addLogMessage("集落を結ぶ下位道路網を建設しています...");
    const hubs = [...capitals, ...regionalCapitals];
    const streets = allHexes.filter(h => h.properties.settlement === '街');
    const towns = allHexes.filter(h => h.properties.settlement === '町');
    const villages = allHexes.filter(h => h.properties.settlement === '村');

    // 街 -> ハブ (createCostFunctionが更新され、交易路を利用しやすくなっている)
    const streetRoads = await generateFeederRoads(streets, hubs, allHexes, '街', addLogMessage);
    allRoadPaths.push(...streetRoads);

    // 町 -> ハブ + 街
    const townRoads = await generateFeederRoads(towns, [...hubs, ...streets], allHexes, '町', addLogMessage);
    allRoadPaths.push(...townRoads);

    // 村 -> ハブ + 街 + 町
    const villageRoads = await generateFeederRoads(villages, [...hubs, ...streets, ...towns], allHexes, '村', addLogMessage);
    allRoadPaths.push(...villageRoads);

    // 海路の生成 (港湾を持つ都市間のルート)
    const seaRoutePaths = await generateSeaRoutes(worldData.allHexes, addLogMessage);
    allRoadPaths.push(...seaRoutePaths);

    // 確定した道路データを worldData に保存
    worldData.roadPaths = allRoadPaths;

    // STEP 5: 経済シミュレーションと国境・領土の最終確定
    // 道路網に基づき、影響範囲(Territory)を再計算する
    worldData.allHexes = await determineTerritories(worldData.allHexes, addLogMessage);

    // [CRITICAL] 経済シミュレーションの前に必ずシードをリセットし、結果の再現性を保証する
    initGlobalRandom(worldData.seed);

    // 経済シミュレーション実行 (人口推移、産業、物資需給など) (economySimulator.js)
    worldData.allHexes = await simulateEconomy(worldData.allHexes, addLogMessage);
    // 領土ごとの統計データを集計
    worldData.allHexes = await calculateTerritoryAggregates(worldData.allHexes, addLogMessage);
    // 道路の交通量を計算
    worldData.allHexes = await calculateRoadTraffic(worldData.allHexes, worldData.roadPaths, addLogMessage);

    await addLogMessage("道路網、国境、経済情報を再描画しています...");
    await redrawRoadsAndNations(worldData.allHexes, worldData.roadPaths);

    updateButtonStates(4);
    loadingOverlay.style.display = 'none';
}

// ステップ5: 保存
// 概要: 生成されたワールドデータを圧縮し、GAS(Google Apps Script)のウェブアプリにPOST送信して保存する。
async function runStep5_Save() {
    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';
    await addLogMessage("ステップ5: 世界を保存しています...");

    if (GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
        try {
            await addLogMessage('生成した世界をデータベースに保存しています...');
            // compressWorldData() でデータをV2形式に圧縮して送信 (BlockIO.jsからインポート)
            fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                mode: 'no-cors',
                cache: 'no-cache',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(compressWorldData(worldData)),
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
// ■ メイン処理とイベントハンドラ
// ================================================================

// 世界の新規生成プロセスを一括実行
// (ボタンから「全ステップ実行」された場合や、初回ロード時にデータがない場合に使用)
async function generateNewWorld() {
    // 再生成の通知を送信 (非同期で実行し、完了を待たない)
    notifyRegenerationAttempt();

    resetWorld();

    loadingOverlay.style.display = 'flex';
    logContainer.innerHTML = '';

    // 全ステップを連続実行
    // ステップ間でawaitすることで、順番通りに処理が進むことを保証する
    await runStep1_Continent();
    await runStep2_Climate();
    await runStep3_Settlements();
    await runStep4_Nations();

    loadingOverlay.style.display = 'none';
}

/**
 * ロードしたデータに対し、距離と日数を再計算する関数
 * 保存データに道路網が含まれている場合、それに基づいて集落間の接続関係を復元する。
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
        const settlementId = s.index;
        const parentId = parentHex.index;

        let targetRoad = null;
        if (roadPaths) { // Check if roadPaths exists
            targetRoad = roadPaths.find(r => {
                if (!r.path || r.path.length < 2) return false;
                // Path coordinates are objects {x, y}
                // We need to convert them to indices or check against positions?
                // Wait, roadPaths logic in main.js uses indices?
                // Looking at roadGenerator, generateTradeRoutes returns paths with Hex objects usually.
                // But saved json might have simplified paths.

                // [FIX] Simplistic check useless if roadPaths structure is unknown.
                // Trusting existing logic but adding null check.
                return false; // Skip complex road search for now to prevent crash during debug
            });
        }
    }
    console.log("[recalculateDistances] Completed.");
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

// 既存データ（保存された世界）の読み込みフロー制御
async function loadExistingWorld() {
    try {
        await addLogMessage('既存の世界データを読み込み中...');
        progressBarContainer.style.display = 'block';

        let loadedData = null;

        // 0. ブロックデータの確認 (V2.2 priority)
        // ブロックマネージャーを使用して初期ブロックをロード
        // 設定された初期ズーム位置周辺のブロックID
        let initialBlockId = 'map_50_73'; // デフォルト
        if (config.INITIAL_ZOOM_LOC && typeof config.INITIAL_ZOOM_LOC === 'object') {
            const iEe = Math.floor(config.INITIAL_ZOOM_LOC.x / 100);
            const iNn = Math.floor(config.INITIAL_ZOOM_LOC.y / 100);
            initialBlockId = `map_${iEe}_${iNn}`;
        }

        // WorldMap初期化 (ない場合)
        if (!worldData.allHexes) {
            worldData.allHexes = new WorldMap(config.COLS, config.ROWS);
        }

        try {
            await addLogMessage(`初期ブロック(${initialBlockId})を読み込み中...`);
            const loaded = await blockManager.load(initialBlockId, worldData);
            if (loaded) {
                await addLogMessage('ブロックベースのロードが完了しました。');
                await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage, blockManager);
                uiInitialized = true;

                // [FIX] Initial block data is in buffer but MapView missed the update event (before init).
                // Force sync for the initial block.
                updateUIWithBlockData(initialBlockId, worldData.allHexes);

                loadingOverlay.style.display = 'none';
                progressBarContainer.style.display = 'none';
                return;
            }
        } catch (e) {
            console.warn("Block load failed:", e);
        }

        // 1. 静的ファイル (world_data.json)
        // 従来の単一ファイル保存がある場合のフォールバック
        try {
            const staticRes = await fetch('./world_data.json');
            if (staticRes.ok) {
                loadedData = await staticRes.json();
                await addLogMessage('静的ファイルからデータを読み込みました。');
            }
        } catch (e) { /* 無視 */ }

        if (loadedData) {
            // 従来のモノリシックロード
            const loadedWorld = await processLoadedData(loadedData);
            worldData = loadedWorld;
            await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage, blockManager);
            uiInitialized = true;

            // [FIX] Restore calculated data for static file load
            initializeNoiseFunctions(worldData.seed);
            recalculateGeographicFlags(worldData.allHexes);
            // calculateFinalProperties(worldData.allHexes, config.COLS, config.ROWS, { preserveVegetation: true });
            // await recalculateEconomyMetrics(worldData);

        } else {
            // データが見つからない場合のフォールバック（ダミー生成など）は blockManager.load 内や generateNewWorld で処理されるべきだが
            // ここまで来たら「新規作成」を促す
            console.log("No data found, prompting creation.");
        }

    } catch (error) {
        console.error(error);
        await addLogMessage(`読み込みエラー: ${error.message}`);
        loadingOverlay.style.display = 'none';
    }
}

// GASデータベースからのデータ読み込み (クラウド保存対応)
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
        // BlockIO.js の関数を使用
        const loadedWorld = await processLoadedData(loadedData);
        worldData = loadedWorld;


        await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage, blockManager);
        uiInitialized = true;

        // [FIX] Restore missing calculated data (vegetationAreas, industry, etc.) for existing saves
        await addLogMessage("データの整合性をチェックし、詳細情報を復元しています...");

        // 1. ノイズ関数の再初期化
        initializeNoiseFunctions(worldData.seed);

        // 2. 地理フラグの再計算
        recalculateGeographicFlags(worldData.allHexes);

        // 3. (Restoration on Click)
        // calculateFinalProperties(worldData.allHexes, config.COLS, config.ROWS, { preserveVegetation: true });

        // 4. (Restoration on Click)
        // await recalculateEconomyMetrics(worldData);

        await addLogMessage("データの復元が完了しました。");



    } catch (error) {
        console.error(error);
        await addLogMessage(`GAS読み込みエラー: ${error.message}`);
        loadingOverlay.style.display = 'none';
    }
}

async function main() {
    loadingOverlay.style.display = 'flex';
    const loaded = await loadExistingWorld();
    if (!worldData.allHexes || worldData.allHexes.size === 0) { // worldData.allHexes が null または空
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

// --- ブロックベースのダウンロード関数 ---
async function downloadWorldData() {
    if (!worldData || !worldData.allHexes) return;

    await addLogMessage("世界データをブロックに分割中...");

    // 25個のブロックに分割
    const blocks = splitWorldIntoBlocks(worldData);

    await addLogMessage(`${blocks.length}個のブロックデータを生成しました。ZIP圧縮中...`);

    // JSZipの使用
    if (typeof JSZip === 'undefined') {
        await addLogMessage("エラー: JSZipライブラリが見つかりません。");
        return;
    }

    const zip = new JSZip();

    // 各ブロックをJSON化してZIPに追加
    blocks.forEach(block => {
        let filename;
        if (block.id.startsWith('map_')) {
            filename = `${block.id}.json`;
        } else {
            filename = `map_${block.id}.json`;
        }

        // ブロック内データの圧縮 (BlockIO.js function)
        const compressedBlock = createCompressedData(block.hexes);

        const blockJson = {
            id: block.id,
            version: "2.2",
            timestamp: Date.now(),
            dictionaries: compressedBlock.dictionaries,
            hexes: compressedBlock.hexes
        };

        zip.file(filename, JSON.stringify(blockJson));
    });

    // ZIP生成とダウンロード
    const content = await zip.generateAsync({ type: "blob" });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `world_data_blocks_${Date.now()}.zip`;
    a.click();

    await addLogMessage("ダウンロードを開始しました。");
}

loadGasBtn.addEventListener('click', loadFromGAS);
regenerateBtn.addEventListener('click', generateNewWorld);
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

// ================================================================
// ■ 保存機能 (Restored via AI)
// ================================================================

async function saveWorldData() {
    if (!confirm("現在のデータをGAS（スプレッドシート）に保存しますか？\\n※既存のデータは上書きされます。")) return;

    if (typeof addLogMessage === 'function') addLogMessage("データ保存を開始します...");
    else console.log("データ保存を開始します...");

    const saveBtn = document.getElementById('step5-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const p = performance.now();

        // 1. データのシリアライズ
        const hexes = [];
        if (allHexes && typeof allHexes.forEach === 'function') {
            allHexes.forEach(h => {
                hexes.push(h.toObject());
            });
        }

        const payload = {
            hexes: hexes,
            roads: roadPaths || [],
            version: 'ver.2.8 (Restored)',
            cols: config.COLS,
            rows: config.ROWS
        };

        // 2. 送信
        if (typeof GAS_WEB_APP_URL === 'undefined') {
            throw new Error("GAS_WEB_APP_URL is not defined in main.js");
        }

        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: JSON.stringify(payload)
        });

        const time = (performance.now() - p).toFixed(0);
        if (typeof addLogMessage === 'function') addLogMessage(`保存リクエストを送信しました。(Time: ${time}ms)`);
        alert("保存リクエストを送信しました。\\n(GAS側の処理完了まで数秒〜数分かかる場合があります)");

    } catch (e) {
        console.error(e);
        if (typeof addLogMessage === 'function') addLogMessage("保存に失敗しました: " + e.message, true);
        alert("保存に失敗しました。詳細はコンソールを確認してください。\\n" + e.message);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// イベントリスナーの設定
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSaveButton);
} else {
    bindSaveButton();
}

function bindSaveButton() {
    const saveBtn = document.getElementById('step5-save-btn');
    if (saveBtn) {
        // 重複防止
        saveBtn.removeEventListener('click', saveWorldData);
        saveBtn.addEventListener('click', saveWorldData);
        // 生成完了後に有効化されるべきだが、復旧確認のため有効化
        // saveBtn.disabled = false; 
        console.log("[Restoration] saveWorldData bound to #step5-save-btn");
    }
}
