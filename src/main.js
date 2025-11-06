// ================================================================
// GeoForge System - メインスクリプト (v1.2 - 描画連携修正)
// ================================================================

import * as d3 from 'd3'; 
import * as config from './config.js';
import { generateContinent } from './continentGenerator.js';
import { generateCivilization, determineTerritories } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates } from './economySimulator.js';
import { generateRoads } from './roadGenerator.js';
import { setupUI } from './ui.js';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const uiContainer = document.querySelector('.ui-container');
const populationDisplay = document.getElementById('population-display');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function addLogMessage(message) {
    console.log(message);
    const entry = document.createElement('p');
    entry.className = 'log-entry';
    entry.textContent = `・ ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    await sleep(20);
}

async function runWorldGeneration() {
    // --- 1. 大陸生成 ---
    let allHexes = await generateContinent(addLogMessage);
    // --- 2. 文明生成 (居住地の配置) ---
    allHexes = await generateCivilization(allHexes, addLogMessage);
    // --- 3. 経済シミュレーション ---
    allHexes = await simulateEconomy(allHexes, addLogMessage);
    
    // --- 4. 街道生成と国家所属の決定 ---
    const roadGenResult = await generateRoads(allHexes, addLogMessage);
    allHexes = roadGenResult.allHexes;
    const roadPaths = roadGenResult.roadPaths;
    
    // --- 5. 最終的な領土の確定 (空白地の割り当て) ---
    allHexes = await determineTerritories(allHexes, addLogMessage);
    // --- 6. 主要都市の支配領域データを集計 ---
    allHexes = await calculateTerritoryAggregates(allHexes, addLogMessage);
    
    // --- 7. UIのセットアップと描画 ---
    await addLogMessage("世界を描画しています...");
    setupUI(allHexes, roadPaths);

    // --- 8. ローディング画面の終了処理 ---
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await sleep(500); 
    loadingOverlay.style.opacity = '0';
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';
    uiContainer.style.display = 'block';
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500);
}

runWorldGeneration();