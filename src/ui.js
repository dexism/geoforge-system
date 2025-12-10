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
    d3.selectAll('input[name="map-type"]').on('change', function () {
        // const selectedType = d3.select(this).property('value');
        // MapView側で状態管理していない場合は、ここでUI状態を管理してtoggleLayerを呼ぶ
        // ここでは簡易的に全色の再計算をトリガー
        mapView.updateAllHexColors();
        mapView.updateVisibleBlocks(mapView.currentTransform);
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
            const layerName = id.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
            const isActive = this.classList.contains('active');

            // Deactivate all first
            overlayIds.forEach(oid => {
                const lname = oid.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
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
