// ================================================================
// GeoForge System - メインスクリプト (v2.0 - 新文明生成ロジック)
// ================================================================

import * as d3 from 'd3'; 
import * as config from './config.js';
import { generateContinent } from './continentGenerator.js';
import { generateCivilization, determineTerritories } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates } from './economySimulator.js';
// generateRoads は civilizationGenerator から呼び出されるため、直接のインポートは不要
// import { generateRoads } from './roadGenerator.js'; 
import { setupUI } from './ui.js';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const sidebar = document.querySelector('.sidebar');
const menuToggle = document.querySelector('.menu-toggle-label');
// const uiContainer = document.querySelector('.ui-container');
const populationDisplay = document.getElementById('population-display');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ★★★ [改修] ログメッセージを出力する (IDを指定するとその要素を更新) ★★★
 * @param {string} message - 表示するメッセージ
 * @param {string|null} id - メッセージ要素のDOM ID (nullなら新規作成)
 */
async function addLogMessage(message, id = null) {
    console.log(message);
    let entry;
    // IDが指定されていれば、既存の要素を探す
    if (id) {
        entry = document.getElementById(id);
    }

    if (entry) {
        // 既存の要素があれば、内容を更新する
        entry.textContent = `・ ${message}`;
    } else {
        // なければ新しい要素を作成する
        entry = document.createElement('p');
        entry.className = 'log-entry';
        if (id) {
            entry.id = id;
        }
        entry.textContent = `・ ${message}`;
        logContainer.appendChild(entry);
    }
    
    logContainer.scrollTop = logContainer.scrollHeight;
    // プログレスバーの高速な更新のため、ID付きの場合はsleepを短くする
    await sleep(id ? 1 : 20);
}

async function runWorldGeneration() {
    // --- 1. 大陸生成 (変更なし) ---
    let allHexes = await generateContinent(addLogMessage);
    
    // --- 2. 新・文明生成 (人口→集落→国家→街道網の順で生成) ---
    const civResult = await generateCivilization(allHexes, addLogMessage);
    allHexes = civResult.allHexes;
    const roadPaths = civResult.roadPaths;
    
    // --- 3. 領土の最終確定 (集落を基点に空白地を塗り分ける) ---
    allHexes = await determineTerritories(allHexes, addLogMessage);
    
    // --- 4. 経済シミュレーション ---
    allHexes = await simulateEconomy(allHexes, addLogMessage);
    
    // --- 5. 主要都市の支配領域データを集計 ---
    allHexes = await calculateTerritoryAggregates(allHexes, addLogMessage);
    
    // --- 6. UIのセットアップと描画 ---
    await addLogMessage("世界を描画しています...");
    // ★★★ [修正] setupUIをawaitで呼び出し、addLogMessageを渡す ★★★
    await setupUI(allHexes, roadPaths, addLogMessage);

    // --- 7. ローディング画面の終了処理 ---
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await sleep(500); 
    loadingOverlay.style.opacity = '0';
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';
    // uiContainer.style.display = 'block';

    // ★★★ [変更] サイドバーとメニューボタンを表示する ★★★
    sidebar.style.display = 'block';
    menuToggle.style.display = 'flex'; // SP用のハンバーガーメニューボタン

    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500);
}

runWorldGeneration();