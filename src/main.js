// ================================================================
// GeoForge System - メインスクリプト
// ================================================================

// 外部ライブラリ
import * as d3 from 'd3'; 

// 作成したモジュールをインポート
import * as config from './config.js';
import { generateContinent } from './continentGenerator.js';
import { generateCivilization } from './civilizationGenerator.js';
import { simulateEconomy } from './economySimulator.js';
import { generateRoads } from './roadGenerator.js';
import { setupUI } from './ui.js';

// DOM要素の取得
const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const uiContainer = document.querySelector('.ui-container');
const populationDisplay = document.getElementById('population-display');

/**
 * 処理を一時停止し、ブラウザに描画する時間を与えるためのヘルパー関数
 * @param {number} ms - 待機するミリ秒
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ローディング画面にログメッセージを追加する非同期関数
 * @param {string} message - 表示するメッセージ
 */
async function addLogMessage(message) {
    console.log(message);
    const entry = document.createElement('p');
    entry.className = 'log-entry';
    entry.textContent = `・ ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    await sleep(20); // メッセージを描画させるために少し待つ
}

/**
 * ワールド生成プロセス全体を管理するメイン非同期関数
 */
async function runWorldGeneration() {
    // --- 1. 大陸生成 ---
    // 世界の物理的な土台（地形、気候、植生）を作成
    let allHexes = await generateContinent(addLogMessage);

    // --- 2. 文明生成 ---
    // 大陸に居住地と人口を配置
    allHexes = await generateCivilization(allHexes, addLogMessage);

    // --- 3. 経済シミュレーション ---
    // 各居住地の食料需給を計算
    allHexes = await simulateEconomy(allHexes, addLogMessage);

    // --- 4. 街道生成 ---
    // 居住地間を街道で接続
    allHexes = await generateRoads(allHexes, addLogMessage);

    // --- 5. UIのセットアップと描画 ---
    // 計算結果を元にマップを描画し、UIイベントを設定
    await addLogMessage("世界を描画しています...");
    setupUI(allHexes);

    // --- 6. ローディング画面の終了処理 ---
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await sleep(500); // 最後のメッセージを読む時間を確保
    
    loadingOverlay.style.opacity = '0';
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';
    uiContainer.style.display = 'block';

    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500);
}

// ワールド生成を開始
runWorldGeneration();