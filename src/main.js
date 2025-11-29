// ================================================================
// GeoForge System - メインスクリプト (v2.2 - 分割生成モデル)
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { generatePhysicalMap, generateClimateAndVegetation } from './continentGenerator.js';
import { generateCivilization, determineTerritories, defineNations, assignTerritoriesByTradeRoutes, generateMonsterDistribution, generateHuntingPotential, generateLivestockPotential } from './civilizationGenerator.js'; 
import { simulateEconomy, calculateTerritoryAggregates } from './economySimulator.js';
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
        return { path: route.path.map(p => ({x: p.x, y: p.y})), level: 5, nationId: route.nationId };
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
              body: JSON.stringify(worldData),
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

// JSONダウンロード機能
function downloadWorldData() {
    if (!worldData || !worldData.allHexes) {
        alert("ダウンロードするデータがありません。");
        return;
    }

    const dataStr = JSON.stringify(worldData, null, 2);
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

async function loadExistingWorld() {
    try {
        await addLogMessage('既存の世界データを読み込み中...');
        progressBarContainer.style.display = 'block';

        let loadedData = null;

        // 1. まず静的ファイル (world_data.json) の読み込みを試みる
        try {
            const staticRes = await fetch('./world_data.json');
            if (staticRes.ok) {
                loadedData = await staticRes.json();
                await addLogMessage('静的ファイルからデータを読み込みました。');
            }
        } catch (e) {
            // 静的ファイルがない場合は無視して次へ
        }

        // 2. 静的ファイルがなければ GAS から取得
        if (!loadedData) {
             if (!GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
                await addLogMessage('[設定注意] GASのURLが設定されていません。新規生成のみ行います。');
                return false;
            }

            await addLogMessage('データベース(GAS)からデータを取得しています...');
            const response = await fetch(GAS_WEB_APP_URL);
            if (!response.ok) throw new Error(`サーバーからの応答が不正です (ステータス: ${response.status})`);
            loadedData = await response.json();
        }

        if (loadedData && loadedData.allHexes && loadedData.allHexes.length > 0) {
            await addLogMessage('データの読み込みに成功しました。世界を再構築します。');
            worldData = loadedData; // 読み込んだデータをグローバル変数に格納

            // 読み込みデータの後処理を追加
            // neighborsはJSON化で失われることがあるため、ここで再計算して復元する
            worldData.allHexes.forEach(h => {
                const { col, row } = h;
                const isOddCol = col % 2 !== 0;
                h.neighbors = [
                    { col: col, row: row - 1 }, { col: col, row: row + 1 },
                    { col: col - 1, row: row }, { col: col + 1, row: row },
                    { col: col - 1, row: isOddCol ? row + 1 : row - 1 },
                    { col: col + 1, row: isOddCol ? row + 1 : row - 1 },
                ].filter(n => n.col >= 0 && n.col < config.COLS && n.row >= 0 && n.row < config.ROWS)
                 .map(n => getIndex(n.col, n.row));
            });

            // 距離と日数を再計算する関数を呼び出す
            await recalculateDistances(worldData);

            await addLogMessage("世界を描画しています...");
            await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage);
            uiInitialized = true;

            // populationDisplay.style.display = 'block';
            
            updateButtonStates(4); // 読み込み完了時は全ステップ完了済み
            loadingOverlay.style.display = 'none';
            return true;
        } else {
            await addLogMessage('既存のデータが見つかりませんでした。');
            return false;
        }
    } catch (error) {
        await addLogMessage(`データ読み込みに失敗しました: ${error.message}。`);
        return false;
    } finally {
        progressBarContainer.style.display = 'none';
    }
}

async function main() {
    loadingOverlay.style.display = 'flex';
    const loaded = await loadExistingWorld();
    if (!loaded) {
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

regenerateBtn.addEventListener('click', async () => {
    // ボタンが押されたら、確認ダイアログを出す前に（または同時に）通知処理を投げる
    // awaitをつけないことで、通知の完了を待たずにダイアログを表示させる
    notifyRegenerationAttempt(); 

    const confirmationMessage = "【警告】\n\n" +
                                "世界の再生成には数分かかる場合があります。\n" +
                                "現在の生成ステップは全てリセットされます。\n\n" +
                                "覚悟はよろしいですか？";
                              
    if (window.confirm(confirmationMessage)) {
        await generateNewWorld();
    }
});

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

main();