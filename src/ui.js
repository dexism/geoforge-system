// ================================================================
// GeoForge System - UI Controller
// ================================================================
import * as config from './config.js';
import * as d3 from 'd3';
import { MapView } from './MapView.js';
import {
    updateOverallInfo,
    generateHexJson
} from './infoWindow.js';

/**
 * サイドバーの高さを動的に調整する関数
 * 情報ウィンドウの表示状態に応じて、サイドバーの高さを変更します。
 */
function adjustSidebarHeight() {
    const sidebar = document.querySelector('.sidebar');
    const infoWindow = document.getElementById('info-window');
    if (!sidebar || !infoWindow) return;

    if (infoWindow.classList.contains('hidden')) {
        sidebar.style.height = '100dvh';
    } else {
        requestAnimationFrame(() => {
            const infoHeight = infoWindow.offsetHeight;
            const newHeight = window.innerHeight - infoHeight - 10;
            sidebar.style.height = `${newHeight}px`;
        });
    }
}

// グローバル変数 (互換性のため残すものもあるが、基本はMapViewへ移動)
let mapView;
let blockLoaderRef;

/**
 * UIのセットアップを行うメイン関数
 * MapViewの初期化、イベントハンドラの設定、初期UI状態の適用を行います。
 * @param {WorldMap} allHexes - 全てのヘックスデータ (またはProxy)
 * @param {Array} roadPaths - 道路パスデータの配列
 * @param {Function} addLogMessage - ログ出力用関数
 * @param {Object} blockLoader - ブロックロード管理オブジェクト
 */
export async function setupUI(allHexes, roadPaths, addLogMessage, blockLoader) {
    blockLoaderRef = blockLoader;

    // MapViewの初期化
    console.log("[UI Setup] Initializing MapView...");
    mapView = new MapView('#hexmap');
    await mapView.initialize(allHexes, roadPaths, blockLoader);

    console.log("[UI Setup] MapView initialized.");

    // --- イベントハンドラの設定 ---
    console.log("[UI Setup] Setting up event handlers...");
    setupEventHandlers();
    console.log("[UI Setup] Event handlers set.");

    // 初期ロード時のUI状態適用
    console.log("[UI Setup] Applying initial UI state...");
    applyInitialUIState();
    console.log("[UI Setup] Initial UI state applied. setupUI COMPLETED.");
}

/**
 * 各種UI要素へのイベントリスナーを設定する関数
 */
function setupEventHandlers() {
    // 1. Zoom/Pan は MapView 内部で処理されるため記述不要

    // 2. Info Window Close
    // 情報ウィンドウを閉じるボタンの処理
    const closeInfoWindow = () => {
        const infoWindow = document.getElementById('info-window');
        if (infoWindow) infoWindow.classList.add('hidden');
        adjustSidebarHeight();
        // ハイライト解除はMapViewに任せるか、ここで呼ぶ
        if (mapView) mapView.toggleLayer('highlight-overlay', false); // 仮: 実際はクリアメソッドが必要
    };

    const infoCloseBtn = document.getElementById('info-close-btn');
    if (infoCloseBtn) {
        infoCloseBtn.addEventListener('click', closeInfoWindow);
    }
    // SVGクリック時の処理はMapView内で伝播ストップされなければbodyへ抜けるが、
    // ここではMapView側で特定の要素以外をクリックした場合の処理が必要。

    // 3. Copy JSON Button
    // 選択中のヘックスデータをJSONとしてクリップボードにコピーする処理
    const copyInfoBtn = document.getElementById('copy-info-btn');
    if (copyInfoBtn) {
        copyInfoBtn.addEventListener('click', () => {
            if (mapView && mapView.currentSelectedHex) {
                const jsonStr = generateHexJson(mapView.currentSelectedHex);
                navigator.clipboard.writeText(jsonStr).then(() => {
                    alert('JSONをクリップボードにコピーしました。');
                }).catch(err => {
                    console.error('コピーに失敗しました:', err);
                    alert('コピーに失敗しました。');
                });
            }
        });
    }

    // 4. Map Type Switch
    // マップタイプ（地形図/白地図）の切り替え処理
    const layerMemory = JSON.parse(JSON.stringify(config.INITIAL_LAYER_SETTINGS));
    let currentMapType = 'terrain';

    // UIボタンの状態をMapViewのレイヤー状態と同期させる関数
    const updateLayerUI = () => {
        const layersToCheck = [
            { id: '#toggleVegetationLayer', layer: 'vegetation-overlay' },
            { id: '#toggleReliefLayer', layer: 'shading' },
            { id: '#toggleContourLayer', layer: 'contour' },
            { id: '#toggleSettlementLayer', layer: 'settlement' },
            { id: '#toggleRoadLayer', layer: 'road' },
            { id: '#toggleTerritoryLayer', layer: 'territory-overlay' },
            { id: '#toggleHexBorderLayer', layer: 'hex-border' },
            { id: '#toggleRidgeWaterSystemLayer', layer: 'ridge-water-system' },
            // ショートカットボタン
            { id: '#shortcut-vegetation', layer: 'vegetation-overlay' },
            { id: '#shortcut-relief', layer: 'shading' },
            { id: '#shortcut-contour', layer: 'contour' },
            { id: '#shortcut-settlement', layer: 'settlement' },
            { id: '#shortcut-road', layer: 'road' },
            { id: '#shortcut-territory', layer: 'territory-overlay' },
            { id: '#shortcut-hex-border', layer: 'hex-border' }
        ];

        layersToCheck.forEach(item => {
            const isVisible = mapView.layers[item.layer] ? mapView.layers[item.layer].visible : false;
            d3.select(item.id).classed('active', isVisible);
        });
    };

    // マップタイプ変更時の処理
    d3.selectAll('input[name="map-type"]').on('change', function () {
        const newType = d3.select(this).property('value');
        if (newType === currentMapType) return;

        // 現在の状態を保存
        const currentMemory = layerMemory[currentMapType];
        Object.keys(currentMemory).forEach(layerName => {
            if (mapView.layers[layerName]) {
                currentMemory[layerName] = mapView.layers[layerName].visible;
            }
        });

        // 新しい状態をロード
        currentMapType = newType;
        const newMemory = layerMemory[newType];
        Object.keys(newMemory).forEach(layerName => {
            mapView.toggleLayer(layerName, newMemory[layerName]);
        });

        // 植生と雪の表示同期
        if (newMemory['vegetation-overlay'] !== undefined) {
            mapView.toggleLayer('snow', newMemory['vegetation-overlay']);
        }

        mapView.updateAllHexColors();
        mapView.updateRiverColor(); // 河川の色を更新 (青 vs グレー)
        mapView.updateVisibleBlocks(mapView.currentTransform);

        updateLayerUI();
    });

    // キーボードショートカット等でマップタイプを切り替えるボタン
    d3.select('#shortcut-map-type').on('click', function () {
        const currentType = d3.select('input[name="map-type"]:checked').property('value');
        const newType = currentType === 'terrain' ? 'white' : 'terrain';
        d3.select(`input[name="map-type"][value="${newType}"]`).property('checked', true).dispatch('change');
    });

    // 5. Layer Toggles
    // 各レイヤーの表示/非表示切り替えボタン
    const layerToggles = [
        { id: '#toggleVegetationLayer', layer: 'vegetation-overlay' },
        { id: '#toggleSnowLayer', layer: 'snow' }, // ボタンはないが連動用
        { id: '#toggleReliefLayer', layer: 'shading' },
        { id: '#toggleContourLayer', layer: 'contour' },
        { id: '#toggleSettlementLayer', layer: 'settlement' },
        { id: '#toggleRoadLayer', layer: 'road' },
        { id: '#toggleTerritoryLayer', layer: 'territory-overlay' },
        { id: '#toggleHexBorderLayer', layer: 'hex-border' },
        { id: '#toggleRidgeWaterSystemLayer', layer: 'ridge-water-system' }
    ];

    layerToggles.forEach(item => {
        d3.select(item.id).on('click', function () {
            const isVisible = mapView.toggleLayer(item.layer);
            this.classList.toggle('active', isVisible);

            // 特殊連動
            if (item.layer === 'vegetation-overlay') {
                mapView.toggleLayer('snow', isVisible);
            }
            if (item.layer === 'ridge-water-system') {
                mapView.updateRiverColor();
            }
        });
    });

    // 6. Shortcuts
    // 画面上のショートカットボタン用
    const shortcuts = [
        { id: '#shortcut-vegetation', layer: 'vegetation-overlay' },
        { id: '#shortcut-relief', layer: 'shading' },
        { id: '#shortcut-contour', layer: 'contour' },
        { id: '#shortcut-settlement', layer: 'settlement' },
        { id: '#shortcut-road', layer: 'road' },
        { id: '#shortcut-territory', layer: 'territory-overlay' },
        { id: '#shortcut-hex-border', layer: 'hex-border' }
    ];

    shortcuts.forEach(item => {
        d3.select(item.id).on('click', function () {
            const isVisible = mapView.toggleLayer(item.layer);
            this.classList.toggle('active', isVisible);

            // サイドバーのボタン状態も同期
            const sidebarBtnId = layerToggles.find(t => t.layer === item.layer)?.id;
            if (sidebarBtnId) d3.select(sidebarBtnId).classed('active', isVisible);

            if (item.layer === 'vegetation-overlay') {
                mapView.toggleLayer('snow', isVisible);
            }
        });
    });

    // 7. Data Overlays (Only one active at a time)
    // データオーバーレイ（気温、降水量、人口など）の切り替え
    // これらは排他的（一度に一つだけ）に表示される
    const overlayIds = [
        '#toggleTempLayer', '#togglePrecipLayer', '#toggleClimateZoneLayer',
        '#togglePopulationLayer', '#toggleMonsterLayer',
        '#toggleManaLayer', '#toggleAgriLayer', '#toggleForestLayer',
        '#toggleMiningLayer', '#toggleFishingLayer', '#toggleHuntingLayer',
        '#togglePastoralLayer', '#toggleLivestockLayer'
    ];

    overlayIds.forEach(id => {
        d3.select(id).on('click', function () {
            let layerName = id.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
            // [FIX] 明示的なマッピング（複数単語のキーに対応）
            if (id === '#toggleClimateZoneLayer') {
                layerName = 'climate-zone-overlay';
            }

            const isActive = this.classList.contains('active');

            // 全て非アクティブ化
            overlayIds.forEach(oid => {
                let lname = oid.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
                if (oid === '#toggleClimateZoneLayer') {
                    lname = 'climate-zone-overlay';
                }
                d3.select(oid).classed('active', false);
                mapView.toggleLayer(lname, false);
            });

            // ターゲットが非アクティブだった場合のみアクティブ化（トグル動作）
            if (!isActive) {
                d3.select(this).classed('active', true);
                mapView.toggleLayer(layerName, true);
                // 凡例の更新が必要な場合はここで呼び出す
                // updateLegend(layerName); // infoWindow.js
            } else {
                // updateLegend(null);
            }
        });
    });
}

function applyInitialUIState() {
    // 1. 現在のマップタイプを取得 (HTMLのchecked属性準拠)
    const currentMapType = d3.select('input[name="map-type"]:checked').property('value') || 'terrain';

    // 2. configから初期設定を取得
    const initialSettings = config.INITIAL_LAYER_SETTINGS[currentMapType];

    if (!initialSettings) {
        console.warn(`[UI] No initial settings found for map type: ${currentMapType}`);
        return;
    }

    // 3. 各レイヤーの状態を適用
    // ボタンのIDとレイヤー名の対応表 (setupEventHandlers内と重複するが、スコープ外のため再定義)
    const layerToggles = [
        { id: '#toggleVegetationLayer', layer: 'vegetation-overlay' },
        { id: '#toggleReliefLayer', layer: 'shading' },
        { id: '#toggleContourLayer', layer: 'contour' },
        { id: '#toggleSettlementLayer', layer: 'settlement' },
        { id: '#toggleRoadLayer', layer: 'road' },
        { id: '#toggleTerritoryLayer', layer: 'territory-overlay' },
        { id: '#toggleHexBorderLayer', layer: 'hex-border' },
        { id: '#toggleRidgeWaterSystemLayer', layer: 'ridge-water-system' }
    ];

    Object.keys(initialSettings).forEach(layerName => {
        const isVisible = initialSettings[layerName];

        // MapViewの状態更新
        if (mapView) {
            mapView.toggleLayer(layerName, isVisible);

            // 特殊連動: 植生オンなら雪もオン
            if (layerName === 'vegetation-overlay') {
                mapView.toggleLayer('snow', isVisible);
            }
        }

        // UIボタンの更新 (メインのトグルボタン)
        const toggleBtn = layerToggles.find(t => t.layer === layerName);
        if (toggleBtn) {
            d3.select(toggleBtn.id).classed('active', isVisible);
        }

        // ショートカットボタンの更新
        // ショートカットボタンIDは #shortcut-{key} の形式。マッピングが必要。
        let shortcutId = null;
        if (layerName === 'vegetation-overlay') shortcutId = '#shortcut-vegetation';
        else if (layerName === 'shading') shortcutId = '#shortcut-relief';
        else if (layerName === 'contour') shortcutId = '#shortcut-contour';
        else if (layerName === 'settlement') shortcutId = '#shortcut-settlement';
        else if (layerName === 'road') shortcutId = '#shortcut-road';
        else if (layerName === 'territory-overlay') shortcutId = '#shortcut-territory';
        else if (layerName === 'hex-border') shortcutId = '#shortcut-hex-border';

        if (shortcutId) {
            d3.select(shortcutId).classed('active', isVisible);
        }
    });

    // 4. マップ全体の再描画 (初期状態反映)
    if (mapView) {
        mapView.updateAllHexColors();
        mapView.updateRiverColor();
        mapView.updateVisibleBlocks(mapView.currentTransform);
    }
}

// ================================================================
// ■ 外部連携用各種関数 (main.jsなどからコールされる)
// ================================================================

/**
 * 気候データの再描画
 * @param {WorldMap} allHexes - ヘックスデータ
 */
export async function redrawClimate(allHexes) {
    if (mapView) mapView.redrawClimate(allHexes);
}

/**
 * 集落データの再描画と情報更新
 */
export async function redrawSettlements(allHexes) {
    if (mapView) {
        mapView.redrawClimate(allHexes); // 実質同じ再描画
        // infoWindow側などUI更新
        updateOverallInfo(allHexes);
    }
}

/**
 * 道路・国境・領土の再描画
 * ロード完了時などに呼び出され、必要なデータを更新し再描画を行う。
 */
export async function redrawRoadsAndNations(allHexes, roadPaths) {
    if (mapView) {
        // [FIX] 完全なリセットは行わず、データの参照を更新するのみ
        mapView.hexes = allHexes;
        mapView.roadPathsData = roadPaths;

        // 必要なレイヤーのみ再描画
        mapView.updateAllHexColors();
        // 現在のTransform（ズーム状態）を維持したまま表示ブロックを更新
        mapView.updateVisibleBlocks(mapView.currentTransform);
    }
}

/**
 * マップ全体の再描画
 */
export async function redrawMap(allHexes) {
    if (mapView) {
        mapView.updateAllHexColors();
        mapView.updateVisibleBlocks(mapView.currentTransform);
        mapView.updateMinimap(allHexes);
    }
}

/**
 * UIのリセット
 * ミニマップ等の要素を削除します。
 */
export function resetUI() {
    if (mapView && mapView.minimapContainer) {
        mapView.minimapContainer.remove();
        mapView.minimapContainer = null;
    }
    d3.select('#minimap-icon').remove();
}

/**
 * ミニマップの更新
 */
export function updateMinimap(allHexes) {
    if (mapView) mapView.updateMinimap(allHexes);
}

/**
 * ブロックごとのデータ更新をUIに反映
 */
export function updateUIWithBlockData(blockId, updatedAllHexes) {
    console.log(`[UI] Updating UI for block ${blockId}`);
    if (mapView) mapView.updateUIWithBlockData(blockId, updatedAllHexes);
}
