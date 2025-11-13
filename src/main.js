// ================================================================
// GeoForge System - メインスクリプト (v2.2 - 分割生成モデル)
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { generatePhysicalMap, generateClimateAndVegetation } from './continentGenerator.js';
import { generateCivilization, determineTerritories, defineNations, assignTerritoriesByTradeRoutes } from './civilizationGenerator.js'; 
import { simulateEconomy, calculateTerritoryAggregates } from './economySimulator.js';
import { setupUI, redrawClimate, redrawSettlements, redrawRoadsAndNations } from './ui.js';
import { generateTradeRoutes, generateFeederRoads } from './roadGenerator.js';
import { getIndex } from './utils.js';

// GASのデプロイで取得したウェブアプリのURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyS8buNL8u2DK9L3UZRtQqLWgDLvuj0WE5ZrzzdXNXSWH3bnGo-JsiO9KSrHp6YOjmtvg/exec';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const populationDisplay = document.getElementById('population-display');
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
}

/**
 * ★★★ [新規] 世界とUIの状態を完全にリセットする関数 ★★★
 */
function resetWorld() {
    // D3.jsで描画された古いSVG要素を全て削除
    d3.select('#hexmap').selectAll('*').remove();
    
    // グローバルな状態管理変数を初期化
    worldData = {
        allHexes: null,
        roadPaths: null,
    };
    uiInitialized = false;

    // UI要素を初期状態に戻す
    populationDisplay.style.display = 'none';
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
    
    // ★★★ [変更] 物理マップ生成のみを呼び出す ★★★
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

    // ★★★ [変更] ステップ1のデータに気候・植生情報を追加する ★★★
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

    await addLogMessage("集落と人口分布を再描画しています...");
    await redrawSettlements(worldData.allHexes);
    
    const totalPopulation = worldData.allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';

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

    // ★★★ [ここから手順の追加/移動] ★★★
    
    // ① 全都市間の交易路を探索し、移動日数も計算
    await addLogMessage("都市間の全交易路を探索し、MST敷設を開始しています...");
    const { roadPaths: tradeRoutePaths, routeData: tradeRouteData } = await generateTradeRoutes(cities, allHexes, addLogMessage);
    let allRoadPaths = tradeRoutePaths; // 交易路は全て描画対象

    // ② 交易路の日数に基づき、首都の初期領土（領都）を決定
    await addLogMessage("交易路網に基づき、首都の初期領土を割り当てています...");
    // assignTerritoriesByTradeRoutes が必要 (civilizationGenerator.js で export すること)
    const { regionalCapitals } = assignTerritoriesByTradeRoutes(cities, capitals, tradeRouteData, allHexes);
    
    // ③ 階層的な道路網を生成
    await addLogMessage("集落を結ぶ下位道路網を建設しています...");
    const hubs = [...capitals, ...regionalCapitals];
    const streets = allHexes.filter(h => h.properties.settlement === '街');
    const towns = allHexes.filter(h => h.properties.settlement === '町');
    const villages = allHexes.filter(h => h.properties.settlement === '村');
    
    const streetRoads = await generateFeederRoads(streets, hubs, allHexes, '街', addLogMessage);
    allRoadPaths.push(...streetRoads);

    const townRoads = await generateFeederRoads(towns, [...hubs, ...streets], allHexes, '町', addLogMessage);
    allRoadPaths.push(...townRoads);

    const villageRoads = await generateFeederRoads(villages, [...hubs, ...streets, ...towns], allHexes, '村', addLogMessage);
    allRoadPaths.push(...villageRoads);
    
    // roadPaths を worldData に保存
    worldData.roadPaths = allRoadPaths;

    // ④ 領土の最終決定、経済シミュレーションを実行
    worldData.allHexes = await determineTerritories(worldData.allHexes, addLogMessage);
    worldData.allHexes = await simulateEconomy(worldData.allHexes, addLogMessage);
    worldData.allHexes = await calculateTerritoryAggregates(worldData.allHexes, addLogMessage);
    
    // ★★★ [手順の追加/移動ここまで] ★★★

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
          await addLogMessage('生成した世界をスプレッドシートに保存しています...');
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
          await addLogMessage(`スプレッドシートへの保存に失敗しました: ${error.message}`);
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

async function loadExistingWorld() {
    if (!GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
        await addLogMessage('[設定注意] GASのURLが設定されていません。新規生成のみ行います。');
        return false;
    }
    
    try {
        await addLogMessage('既存の世界データをスプレッドシートから読み込み中...');
        progressBarContainer.style.display = 'block';

        const response = await fetch(GAS_WEB_APP_URL);
        if (!response.ok) throw new Error(`サーバーからの応答が不正です (ステータス: ${response.status})`);
        
        const loadedData = await response.json();

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

            await addLogMessage("世界を描画しています...");
            await setupUI(worldData.allHexes, worldData.roadPaths, addLogMessage);
            uiInitialized = true;

            const totalPopulation = worldData.allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
            populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
            populationDisplay.style.display = 'block';
            
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

regenerateBtn.addEventListener('click', async () => {
    const confirmationMessage = "【警告】\n\n" +
                                "世界の再生成には数分かかる場合があります。\n" +
                                "現在の生成ステップは全てリセットされます。\n\n" +
                                "覚悟はよろしいですか？";
                              
    if (window.confirm(confirmationMessage)) {
        await generateNewWorld();
    }
});

main();