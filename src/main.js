// ================================================================
// GeoForge System - メインスクリプト (v2.1 - Googleスプレッドシート連携)
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { generateContinent } from './continentGenerator.js';
import { generateCivilization, determineTerritories } from './civilizationGenerator.js';
import { simulateEconomy, calculateTerritoryAggregates } from './economySimulator.js';
import { setupUI } from './ui.js';

// GASのデプロイで取得したウェブアプリのURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyS8buNL8u2DK9L3UZRtQqLWgDLvuj0WE5ZrzzdXNXSWH3bnGo-JsiO9KSrHp6YOjmtvg/exec';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log');
const sidebar = document.querySelector('.sidebar');
const menuToggle = document.querySelector('.menu-toggle-label');
const populationDisplay = document.getElementById('population-display');
const regenerateBtn = document.getElementById('force-regenerate-btn');
const progressBarContainer = document.getElementById('progress-bar-container');

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

// 世界を「新規生成」する処理
async function generateNewWorld() {
    // 1. ローディング画面をリセットして表示
    logContainer.innerHTML = ''; // ログをクリア
    loadingOverlay.style.opacity = '1';
    loadingOverlay.style.display = 'flex';

    // 2. 大陸生成
    let allHexes = await generateContinent(addLogMessage);
    
    // 3. 文明生成
    const civResult = await generateCivilization(allHexes, addLogMessage);
    allHexes = civResult.allHexes;
    const roadPaths = civResult.roadPaths;
    
    // 4. 領土の最終確定
    allHexes = await determineTerritories(allHexes, addLogMessage);
    
    // 5. 経済シミュレーション
    allHexes = await simulateEconomy(allHexes, addLogMessage);
    
    // 6. 主要都市の支配領域データを集計
    allHexes = await calculateTerritoryAggregates(allHexes, addLogMessage);
    
    // 7. UIのセットアップと描画
    await addLogMessage("世界を描画しています...");
    await setupUI(allHexes, roadPaths, addLogMessage);

    // 8. スプレッドシートに保存
    if (GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
      try {
          await addLogMessage('生成した世界をスプレッドシートに保存しています...');
          fetch(GAS_WEB_APP_URL, {
              method: 'POST',
              mode: 'no-cors', 
              cache: 'no-cache',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ allHexes, roadPaths }),
              redirect: 'follow'
          });
          await addLogMessage('保存リクエストを送信しました。');
      } catch (error) {
          await addLogMessage(`スプレッドシートへの保存に失敗しました: ${error.message}`);
      }
    }

    // 9. ローディング画面の終了処理
    const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
    await sleep(500); 
    loadingOverlay.style.opacity = '0';
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';
    sidebar.style.display = 'block';
    menuToggle.style.display = 'flex'; 

    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500);
}

// 読み込み関数にプログレスバーの表示/非表示処理
async function loadExistingWorld() {
    if (!GAS_WEB_APP_URL.startsWith('https://script.google.com')) {
        await addLogMessage('[設定注意] GASのURLが設定されていません。新規生成のみ行います。');
        return false;
    }
    
    // try...finally を使って、成功しても失敗しても必ずバーを非表示にする
    try {
        await addLogMessage('既存の世界データをスプレッドシートから読み込み中...');
        // プログレスバーを表示
        progressBarContainer.style.display = 'block';

        const response = await fetch(GAS_WEB_APP_URL);
        if (!response.ok) {
            throw new Error(`サーバーからの応答が不正です (ステータス: ${response.status})`);
        }
        const worldData = await response.json();

        if (worldData && worldData.allHexes && worldData.allHexes.length > 0) {
            await addLogMessage('データの読み込みに成功しました。世界を再構築します。');
            
            const { allHexes, roadPaths } = worldData;
            await addLogMessage("世界を描画しています...");
            await setupUI(allHexes, roadPaths, addLogMessage);

            const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
            await sleep(500); 
            loadingOverlay.style.opacity = '0';
            populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
            populationDisplay.style.display = 'block';
            sidebar.style.display = 'block';
            menuToggle.style.display = 'flex';

            setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
            
            return true; // 読み込み成功
        } else {
            await addLogMessage('既存のデータが見つかりませんでした。');
            return false; // データが空なので読み込み失敗
        }
    } catch (error) {
        await addLogMessage(`データ読み込みに失敗しました: ${error.message}。`);
        return false; // エラーなので読み込み失敗
    } finally {
        // 処理が完了したらプログレスバーを非表示にする
        progressBarContainer.style.display = 'none';
    }
}

// メインの実行フローを制御
async function main() {
    // 最初に読み込みを試行
    const loaded = await loadExistingWorld();
    
    // 読み込みに失敗した場合のみ、新規生成を実行
    if (!loaded) {
        await addLogMessage('新しい世界を創造します。');
        await generateNewWorld();
    }
}

// 強制再生成ボタンのイベントリスナー
regenerateBtn.addEventListener('click', async () => {
    const confirmationMessage = "【警告】\n" +
                                "世界の再生成には10分以上かかる場合があります。\n" +
                                "保存されているデータは上書きされます。\n\n" +
                                "覚悟はよろしいですか？";
                              
    if (window.confirm(confirmationMessage)) {
        await generateNewWorld();
    }
});

// アプリケーションの実行
main();