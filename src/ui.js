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

export async function setupUI(allHexes, roadPaths, addLogMessage, blockLoader) {
    blockLoaderRef = blockLoader;

    // MapViewの初期化
    mapView = new MapView('#hexmap');
    await mapView.initialize(allHexes, roadPaths, blockLoader);

    console.log("[UI Setup] MapView initialized.");

    // --- イベントハンドラの設定 ---
    setupEventHandlers();

    // 初期ロード時のUI状態適用
    applyInitialUIState();
}

function setupEventHandlers() {
    // 1. Zoom/Pan は MapView 内部で処理されるため記述不要

    // 2. Info Window Close
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
    // MapView.g (またはsvg) に click リスナーがついているはず。

    // 3. Copy JSON Button
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
    // 4. Map Type Switch
    const layerMemory = {
        'terrain': {
            'vegetation-overlay': true, 'snow': true, 'shading': false, 'contour': true,
            'settlement': true, 'road': true, 'territory-overlay': false, 'hex-border': false, 'ridge-water-system': false
        },
        'white': {
            'vegetation-overlay': false, 'snow': false, 'shading': true, 'contour': true,
            'settlement': true, 'road': true, 'territory-overlay': false, 'hex-border': false, 'ridge-water-system': false
        }
    };
    let currentMapType = 'terrain';

    const updateLayerUI = () => {
        // Sync UI buttons with MapView state
        const layersToCheck = [
            { id: '#toggleVegetationLayer', layer: 'vegetation-overlay' },
            { id: '#toggleReliefLayer', layer: 'shading' },
            { id: '#toggleContourLayer', layer: 'contour' },
            { id: '#toggleSettlementLayer', layer: 'settlement' },
            { id: '#toggleRoadLayer', layer: 'road' },
            { id: '#toggleTerritoryLayer', layer: 'territory-overlay' },
            { id: '#toggleHexBorderLayer', layer: 'hex-border' },
            { id: '#toggleRidgeWaterSystemLayer', layer: 'ridge-water-system' },
            // Shortcuts
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

    d3.selectAll('input[name="map-type"]').on('change', function () {
        const newType = d3.select(this).property('value');
        if (newType === currentMapType) return;

        // Save current state to memory
        const currentMemory = layerMemory[currentMapType];
        Object.keys(currentMemory).forEach(layerName => {
            if (mapView.layers[layerName]) {
                currentMemory[layerName] = mapView.layers[layerName].visible;
            }
        });

        // Load new state
        currentMapType = newType;
        const newMemory = layerMemory[newType];
        Object.keys(newMemory).forEach(layerName => {
            mapView.toggleLayer(layerName, newMemory[layerName]);
        });

        // Special handling for vegetation/snow sync
        if (newMemory['vegetation-overlay'] !== undefined) {
            mapView.toggleLayer('snow', newMemory['vegetation-overlay']);
            // Note: 'snow' key exists in memory but is synced with veg mostly
        }

        mapView.updateAllHexColors();
        mapView.updateRiverColor(); // Sync river color (Blue vs Grey)
        mapView.updateVisibleBlocks(mapView.currentTransform);

        updateLayerUI();
    });

    d3.select('#shortcut-map-type').on('click', function () {
        const currentType = d3.select('input[name="map-type"]:checked').property('value');
        const newType = currentType === 'terrain' ? 'white' : 'terrain';
        d3.select(`input[name="map-type"][value="${newType}"]`).property('checked', true).dispatch('change');
    });

    // 5. Layer Toggles
    const layerToggles = [
        { id: '#toggleVegetationLayer', layer: 'vegetation-overlay' },
        { id: '#toggleSnowLayer', layer: 'snow' }, // ボタンがないかもしれないが連動用
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
                // beach連動などもMapView内で処理済
            }
            if (item.layer === 'ridge-water-system') {
                mapView.updateRiverColor();
            }
        });
    });

    // 6. Shortcuts
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

            // Sidebar button sync
            const sidebarBtnId = layerToggles.find(t => t.layer === item.layer)?.id;
            if (sidebarBtnId) d3.select(sidebarBtnId).classed('active', isVisible);

            if (item.layer === 'vegetation-overlay') {
                mapView.toggleLayer('snow', isVisible);
            }
        });
    });

    // 7. Data Overlays (Only one active at a time)
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
            // [FIX] Explicit mapping for multi-word keys
            if (id === '#toggleClimateZoneLayer') {
                layerName = 'climate-zone-overlay';
            }

            const isActive = this.classList.contains('active');

            // Deactivate all first
            overlayIds.forEach(oid => {
                let lname = oid.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
                if (oid === '#toggleClimateZoneLayer') {
                    lname = 'climate-zone-overlay';
                }
                d3.select(oid).classed('active', false);
                mapView.toggleLayer(lname, false);
            });

            // Activate target if it wasn't active
            if (!isActive) {
                d3.select(this).classed('active', true);
                mapView.toggleLayer(layerName, true);
                // legend update needed in MapView or InfoWindow
                // updateLegend(layerName); // infoWindow.js
            } else {
                // updateLegend(null);
            }
        });
    });
}

function applyInitialUIState() {
    // ボタンの初期状態をマップの状態に合わせる
    // 今回は初期化時にデフォルトで設定されていると仮定
}

// 外部連携用 (main.jsなどから呼ばれる)
export async function redrawClimate(allHexes) {
    if (mapView) mapView.redrawClimate(allHexes);
}

export async function redrawSettlements(allHexes) {
    if (mapView) {
        mapView.redrawClimate(allHexes); // 実質同じ再描画
        // infoWindow側などUI更新
        updateOverallInfo(allHexes);
    }
}

export async function redrawRoadsAndNations(allHexes, roadPaths) {
    if (mapView) {
        // [FIX] Do NOT full reset (initialize) as it resets transform/zoom state.
        // Instead, update data references and redraw specific layers.
        mapView.hexes = allHexes;
        mapView.roadPathsData = roadPaths;

        // Re-render specific layers if necessary
        // For now, updating hex colors and potentially road layer is enough
        // mapView.drawRoads(); // If such method exists, or re-init layers
        mapView.updateAllHexColors();
        // Force update of visible blocks to refresh data, but KEEP current transform
        mapView.updateVisibleBlocks(mapView.currentTransform);
    }
}

export async function redrawMap(allHexes) {
    if (mapView) {
        mapView.updateAllHexColors();
        mapView.updateVisibleBlocks(mapView.currentTransform);
        mapView.updateMinimap(allHexes);
    }
}

export function resetUI() {
    if (mapView && mapView.minimapContainer) {
        mapView.minimapContainer.remove();
        mapView.minimapContainer = null;
    }
    d3.select('#minimap-icon').remove();
}

export function updateMinimap(allHexes) {
    if (mapView) mapView.updateMinimap(allHexes);
}

export function updateUIWithBlockData(blockId, updatedAllHexes) {
    if (mapView) mapView.updateUIWithBlockData(blockId, updatedAllHexes);
}
