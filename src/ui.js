// ================================================================
// GeoForge System - UIモジュール (v1.8.7 - 可読性最優先 最終版)
// ================================================================
// このスクリプトは、生成された世界データを基にD3.jsを用いてインタラクティブな
// ヘックスマップを描画し、サイドバーからのレイヤー操作や情報表示ウィンドウの
// 機能を提供します。
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, formatProgressBar, formatLocation, getSharedEdgePoints, getSharedEdgeMidpoint, getDistance } from './utils.js';
import {
    initInfoWindow,
    setAllHexesData,
    updateChildrenMap,
    updateOverallInfo,
    getInfoText,
    updateLegend,
    childrenMap,
    generateHexJson
} from './infoWindow.js';

// --- グローバル変数 ---
// 全ての描画レイヤー（<g>要素）を管理するオブジェクト
const layers = {};
// 凡例表示用コンテナはinfoWindow.jsで管理

let hexes = []; // 描画用データ（座標などを含む）
let roadPathsData = [];
let svg;        // SVG要素
let currentTransform = d3.zoomIdentity; // 現在のズーム状態
let allHexesData = [];
let infoWindow;
let infoContent;
let tooltipContainer; // ツールチップ用コンテナ
// childrenMapはinfoWindow.jsからインポート
const nationColor = d3.scaleOrdinal(d3.schemeTableau10); // 国家ごとの色を固定するためのカラースケール
// ミニマップ関連の変数を追加
let minimapContainer;
let minimapSvg;
let minimapViewport;
let minimapScaleX;
let minimapScaleY;
let currentSelectedHex = null;

// ブロック分割レンダリング用定数・変数
const BLOCK_COLS = 5;
const BLOCK_ROWS = 5;
let blocks = [];
let blockLoaderRef = null; // Dynamic Block Loader Interface

// ================================================================
// ■ ヘルパー関数 (モジュールスコープ)
// ================================================================

// updateOverallInfo is imported from infoWindow.js

/**
 * 汎用的なレイヤー切り替え関数。
 * @param {string} layerName - 操作対象となるレイヤー名
 * @param {HTMLElement} buttonElement - クリックされたボタン要素
 */
function toggleLayerVisibility(layerName, buttonElement) {
    console.log(`toggleLayerVisibility: ${layerName}`);
    const layer = layers[layerName];
    if (!layer) {
        console.error(`レイヤー "${layerName}" が見つかりません。`);
        return;
    }
    layer.visible = !layer.visible;

    // 合成対象のレイヤーかどうかを判定
    const compositeLayers = ['terrain', 'white-map-overlay', 'vegetation-overlay', 'snow', 'shading', 'territory-overlay',
        'climate-zone-overlay', 'temp-overlay', 'precip-overlay', 'population-overlay', 'monster-overlay',
        'mana-overlay', 'agri-overlay', 'forest-overlay', 'mining-overlay', 'fishing-overlay',
        'hunting-overlay', 'pastoral-overlay', 'livestock-overlay'];

    if (compositeLayers.includes(layerName)) {
        // 合成レイヤーの場合は、色を再計算して再描画
        updateAllHexColors();
    }

    // ブロックレンダリングのリセットと再描画
    // 可視性が変わったので、ブロック内の該当レイヤーの表示状態を更新する必要がある
    // updateVisibleBlocks 内で layers[name].visible をチェックしているので、
    // 再度 updateVisibleBlocks を呼べば反映されるはずだが、
    // 独立レイヤーの場合、非表示 -> 表示 に切り替わったときに renderBlock が呼ばれる必要がある
    // 既に rendered=true のブロックは再描画されないため、強制的に再描画させるか、
    // updateVisibleBlocks 内で display スタイルを切り替えるだけで十分か確認が必要。

    // updateVisibleBlocksの実装を見ると:
    // if (isVisible) { blockGroup.style('display', 'inline'); ... } else { blockGroup.style('display', 'none'); }
    // となっており、blockGroup は layers[layerName].group.select(...) で取得している。
    // しかし、layers[layerName].visible が false の場合、updateVisibleBlocks 内で
    // if (!layers[layerName]) return; となっているので、そもそも処理されない可能性がある？
    // いや、layers[layerName]自体はある。

    // updateVisibleBlocksのループ:
    // partitionedLayers.forEach(layerName => {
    //    if (!layers[layerName]) return;
    //    const blockGroup = ...
    //    if (isVisible) { ... }
    // });

    // ここで layers[layerName].visible をチェックしていない！
    // つまり、updateVisibleBlocks は「ブロックが画面内にあるか」だけで display を制御している。
    // レイヤー自体の表示/非表示は、layers[layerName].group.style('display', ...) で制御すべきだが、
    // ブロック化されたレイヤーの場合、親グループ (layers[layerName].group) の display を切り替えるのが最も効率的。

    if (layer.visible) {
        layer.group.style('display', 'inline');
        // 表示になった場合、まだ描画されていないブロックがあるかもしれないので更新
        if (svg) updateVisibleBlocks(currentTransform);
        // settlementレイヤーのトグル時にラベルの表示も切り替える
        if (layerName === 'settlement') {
            layers.labels.group.selectAll('.settlement-label')
                .style('display', layer.visible ? 'inline' : 'none');
        }
    } else {
        layer.group.style('display', 'none');
        if (layerName === 'settlement') {
            layers.labels.group.selectAll('.settlement-label')
                .style('display', 'none');
        }
    }

    // 連動レイヤーの処理
    if (layerName === 'vegetation-overlay') {
        // 植生と砂浜は連動
        const beachLayer = layers['beach'];
        if (beachLayer) {
            beachLayer.visible = layer.visible;
            beachLayer.group.style('display', layer.visible ? 'inline' : 'none');
        }
    } else if (layerName === 'road') {
        // 道路と航路は連動
        const seaRouteLayer = layers['sea-route'];
        if (seaRouteLayer) {
            seaRouteLayer.visible = layer.visible;
            seaRouteLayer.group.style('display', layer.visible ? 'inline' : 'none');
        }
    }

    // ボタンの状態を同期 (サイドバーとショートカット)
    // buttonElementが渡された場合はそれをトグル
    if (buttonElement) {
        buttonElement.classList.toggle('active', layer.visible);
    }

    // 対応するもう一方のボタンも探してトグル
    // マッピング定義
    const buttonMapping = {
        'vegetation-overlay': { sidebar: '#toggleVegetationLayer', shortcut: '#shortcut-vegetation' },
        'shading': { sidebar: '#toggleReliefLayer', shortcut: '#shortcut-relief' },
        'contour': { sidebar: '#toggleContourLayer', shortcut: '#shortcut-contour' },
        'settlement': { sidebar: '#toggleSettlementLayer', shortcut: '#shortcut-settlement' },
        'road': { sidebar: '#toggleRoadLayer', shortcut: '#shortcut-road' },
        'territory-overlay': { sidebar: '#toggleTerritoryLayer', shortcut: '#shortcut-territory' },
        'hex-border': { sidebar: '#toggleHexBorderLayer', shortcut: '#shortcut-hex-border' }
    };

    const mapping = buttonMapping[layerName];
    if (mapping) {
        const sidebarBtn = document.querySelector(mapping.sidebar);
        const shortcutBtn = document.querySelector(mapping.shortcut);

        if (sidebarBtn) sidebarBtn.classList.toggle('active', layer.visible);
        if (shortcutBtn) shortcutBtn.classList.toggle('active', layer.visible);
    }
}

// Legend functions are imported from infoWindow.js

/**
 * ヘックスの最終的な表示色を計算する関数 (合成レイヤー用)
 * @param {Object} d - ヘックスデータ
 * @returns {string} - 合成された色文字列 (rgb/rgba)
 */
function calculateCompositeColor(d) {
    const p = d.properties;
    let baseColor;

    // 1. ベースレイヤーの決定
    // 白地図モードかどうかは、DOMの状態から判定するか、グローバル変数で管理するのが効率的だが、
    // ここでは既存のロジックに合わせてDOMを参照する (パフォーマンスへの影響は軽微と想定)
    const isWhiteMap = document.querySelector('input[name="map-type"][value="white"]')?.checked;

    if (isWhiteMap) {
        baseColor = d.properties.isWater ? config.WHITE_MAP_COLORS.WATER : config.whiteMapElevationColor(d.properties.elevation);
    } else {
        // 地形レイヤー
        if (p.isWater && p.elevation > 0) {
            baseColor = config.TERRAIN_COLORS['湖沼'];
        } else {
            baseColor = config.getElevationColor(p.elevation);
        }
    }

    // d3.colorでパースして操作可能なオブジェクトにする
    let c = d3.color(baseColor);
    if (!c) return '#000'; // ベースカラーが無効な場合は黒を返す (安全策)

    // 2. 植生オーバーレイ (陸地のみ)
    if (!p.isWater && layers['vegetation-overlay'] && layers['vegetation-overlay'].visible) {
        let displayVeg = p.vegetation;
        if (displayVeg === '森林' || displayVeg === '針葉樹林') {
            if (p.landUse.forest < 0.10) {
                displayVeg = '草原';
            }
        }
        const vegColorStr = config.TERRAIN_COLORS[displayVeg];
        if (vegColorStr) {
            const vegColor = d3.color(vegColorStr);
            vegColor.opacity = 0.6;
            c = interpolateColor(c, vegColor);
        }
    }

    // 3. 積雪レイヤー (陸地のみ)
    if (!p.isWater && layers.snow && layers.snow.visible && p.hasSnow) {
        const snowColor = d3.color('#fff');
        snowColor.opacity = 0.8;
        c = interpolateColor(c, snowColor);
    }

    // 4. 各種情報オーバーレイ (ベース+植生+積雪の上に重ねる)

    // 排他制御されている地理情報レイヤー
    // 気候ゾーン
    if (layers['climate-zone-overlay'] && layers['climate-zone-overlay'].visible) {
        const overlayColor = d3.color(config.CLIMATE_ZONE_COLORS[p.climateZone]);
        if (overlayColor) {
            overlayColor.opacity = 0.6;
            c = interpolateColor(c, overlayColor);
        }
    }
    // 気温
    else if (layers['temp-overlay'] && layers['temp-overlay'].visible) {
        const overlayColor = d3.color(config.tempColor(p.temperature));
        if (overlayColor) {
            overlayColor.opacity = 0.6;
            c = interpolateColor(c, overlayColor);
        }
    }
    // 降水量
    else if (layers['precip-overlay'] && layers['precip-overlay'].visible) {
        const overlayColor = d3.color(config.precipColor(p.precipitation_mm));
        if (overlayColor) {
            overlayColor.opacity = 0.6;
            c = interpolateColor(c, overlayColor);
        }
    }
    // 人口
    else if (layers['population-overlay'] && layers['population-overlay'].visible && p.population > 0) {
        const overlayColor = d3.color(config.populationColor(p.population));
        if (overlayColor) {
            overlayColor.opacity = 0.9;
            c = interpolateColor(c, overlayColor);
        }
    }
    // 魔物
    else if (layers['monster-overlay'] && layers['monster-overlay'].visible && p.monsterRank) {
        const overlayColor = d3.color(config.MONSTER_COLORS[p.monsterRank]);
        if (overlayColor) {
            overlayColor.opacity = 0.5;
            c = interpolateColor(c, overlayColor);
        }
    }

    // 資源系
    const resourceLayers = [
        { name: 'mana-overlay', colorFunc: d => config.manaColor(d.properties.manaValue), opacity: 0.6 },
        { name: 'agri-overlay', colorFunc: d => config.agriColor(d.properties.agriPotential), opacity: 0.7 },
        { name: 'forest-overlay', colorFunc: d => config.forestColor(d.properties.forestPotential), opacity: 0.7 },
        { name: 'mining-overlay', colorFunc: d => config.miningColor(d.properties.miningPotential), opacity: 0.7 },
        { name: 'fishing-overlay', colorFunc: d => config.fishingColor(d.properties.fishingPotential), opacity: 0.7 },
        { name: 'hunting-overlay', colorFunc: d => config.huntingColor(d.properties.huntingPotential), opacity: 0.7 },
        { name: 'pastoral-overlay', colorFunc: d => config.pastoralColor(d.properties.pastoralPotential), opacity: 0.7 },
        { name: 'livestock-overlay', colorFunc: d => config.livestockColor(d.properties.livestockPotential), opacity: 0.7 },
    ];

    // 資源レイヤーが1つでも有効なら、背景を彩度ダウン・明度アップする
    const activeResourceLayer = resourceLayers.find(l => layers[l.name] && layers[l.name].visible);
    if (activeResourceLayer) {
        const hsl = d3.hsl(c);
        hsl.s *= 0.3; // 彩度を下げる
        hsl.l = Math.min(1, hsl.l * 1.4); // 明度を上げる
        c = hsl.rgb();
    }

    resourceLayers.forEach(layer => {
        if (layers[layer.name] && layers[layer.name].visible) {
            const col = d3.color(layer.colorFunc(d));
            if (col) {
                col.opacity = layer.opacity;
                c = interpolateColor(c, col);
            }
        }
    });

    // 5. 領土オーバーレイ
    if (layers['territory-overlay'] && layers['territory-overlay'].visible) {
        const nationId = p.nationId || 0;
        if (nationId > 0) {
            const territoryColor = d3.color(nationColor(nationId));
            territoryColor.opacity = 0.5;
            c = interpolateColor(c, territoryColor);
        }
    }

    // 6. 陰影 (レリーフ) レイヤー
    // 乗算(Multiply)のような効果を出すため、RGB値を調整
    if (layers.shading && layers.shading.visible) {
        const shadingValue = p.shadingValue || 0;
        // ユーザー要望により少し濃くする (0.10 -> 0.20)
        const shadingOpacity = d3.scaleLinear().domain([0, 400]).range([0, 0.20]).clamp(true)(Math.abs(shadingValue));

        if (shadingValue > 0) {
            // 明るくする (白をブレンド)
            const white = d3.color('#fff');
            white.opacity = shadingOpacity;
            c = interpolateColor(c, white);
        } else {
            // 暗くする (黒をブレンド)
            const black = d3.color('#000');
            black.opacity = shadingOpacity;
            c = interpolateColor(c, black);
        }
    }

    return c.formatRgb();
}

/**
 * 2つの色をアルファブレンドするヘルパー関数
 * @param {d3.Color} base - 背景色
 * @param {d3.Color} overlay - 前景色 (opacityを持つこと)
 * @returns {d3.Color} - 合成後の色
 */
function interpolateColor(base, overlay) {
    if (!base || !overlay) return base || overlay;
    const alpha = overlay.opacity;
    if (isNaN(alpha)) return base;

    const invAlpha = 1 - alpha;

    // 単純なアルファブレンド: out = overlay * alpha + base * (1 - alpha)
    const r = overlay.r * alpha + base.r * invAlpha;
    const g = overlay.g * alpha + base.g * invAlpha;
    const b = overlay.b * alpha + base.b * invAlpha;

    return d3.rgb(r, g, b);
}

/**
 * 全ヘックスの表示色を一括更新する関数
 */
function updateAllHexColors() {
    if (!blocks || blocks.length === 0) return;

    // console.time('updateAllHexColors');

    // 1. 各ブロックの保持するヘックスインスタンスに対して色を計算し、プロパティとしてキャッシュする
    // (Flyweightパターン対応: WorldMapではなく、レンダリング用の永続インスタンスを更新する)
    blocks.forEach(block => {
        if (block.hexes) {
            block.hexes.forEach(d => {
                d._displayColor = calculateCompositeColor(d);
            });
        }

        // 2. DOM要素の色を更新 (キャッシュされた_displayColorを使用)
        if (block.rendered) {
            const blockGroup = layers['terrain'].group.select(`#terrain-${block.id}`);
            if (!blockGroup.empty()) {
                blockGroup.selectAll('.hex') // D3のdatum(d)はblock.hexesの要素
                    .attr('fill', d => d._displayColor || '#000');
            }
        }
    });
    // console.timeEnd('updateAllHexColors');
}

// ================================================================
// ■ UIセットアップ メイン関数
// ================================================================

/**
 * 道路網と航路レイヤーを再描画する関数
 * @param {Array<object>} roadPaths - 描画対象の道路・航路データ
 */
function drawRoads(roadPaths) {
    // レイヤーをクリア
    layers.road.group.selectAll('*').remove();
    layers['sea-route'].group.selectAll('*').remove();
    if (!roadPaths || roadPaths.length === 0) return;

    // ================================================================
    // 1. 陸路データの処理と描画
    // ================================================================
    const landRoadPathData = [];
    const roadSegmentGrid = new Map();
    const landRoads = roadPaths.filter(d => d.level < 10);

    landRoads.forEach(road => {
        if (road.path.length < 2) return;
        const pathHexes = road.path.map(p => hexes[getIndex(p.x, p.y)]);
        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];
            if (!currentHex) continue;
            const prevHex = i > 0 ? pathHexes[i - 1] : null;
            const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;
            const startPoint = prevHex ? getSharedEdgeMidpoint(currentHex, prevHex) : [currentHex.cx, currentHex.cy];
            const endPoint = nextHex ? getSharedEdgeMidpoint(currentHex, nextHex) : [currentHex.cx, currentHex.cy];
            if (!startPoint || !endPoint || (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])) continue;
            const pathString = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);
            const fromIndex = prevHex ? prevHex.index : currentHex.index;
            const toIndex = nextHex ? nextHex.index : currentHex.index;
            const segmentKey = Math.min(fromIndex, toIndex) + '-' + Math.max(fromIndex, toIndex);
            if (!roadSegmentGrid.has(segmentKey)) {
                roadSegmentGrid.set(segmentKey, true);
                landRoadPathData.push({ path: pathString, level: road.level, nationId: road.nationId });
            }
        }
    });

    layers.road.group.selectAll('.road-segment')
        .data(landRoadPathData.sort((a, b) => a.level - b.level))
        .enter()
        .append('path')
        .attr('class', 'road-segment')
        .attr('d', d => d.path)
        .attr('stroke', d => ({
            6: '#f0f', // 通商路
            5: '#f00', // 交易路
            4: '#f80', // 街道
            3: '#ff0', // 町道
            2: '#0f0', // 村道
            1: '#800'  // その他
        }[d.level] || '#000'))
        .attr('stroke-width', d => ({
            6: 6.0,
            5: 5.0,
            4: 4.0,
            3: 3.0,
            2: 2.0,
            1: 1.0
        }[d.level] || 1))
        .attr('stroke-dasharray', d => ({
            6: '2, 2',
            5: '2, 2',
            4: '2, 2',
            3: '2, 2',
            2: '1, 1',
            1: '1, 2'
        }[d.level] || '2, 2'))
        .style('pointer-events', 'none')
        .style('fill', 'none');

    // ================================================================
    // 2. 航路データの処理と描画
    // ================================================================
    const seaRoutes = roadPaths.filter(d => d.level === 10);

    // 航路の色を定義
    const seaRouteColors = {
        'dinghy': '#0f0', // 小舟・漁船
        'small_trader': '#ff0', // 小型商船
        'coastal_trader': '#f00', // 沿岸交易船
        'medium_merchant': '#a0f', // 中型商船
        'large_sailing_ship': '#00f'  // 大型帆船
    };

    // 船のランクを数値化するための順序マップ
    const shipOrder = {
        'dinghy': 1,
        'small_trader': 2,
        'coastal_trader': 3,
        'medium_merchant': 4,
        'large_sailing_ship': 5
    };

    // 航路のパスデータを生成
    const seaRoutePathData = [];
    seaRoutes.forEach(route => {
        const pathHexes = route.path.map(p => hexes[getIndex(p.x, p.y)]).filter(Boolean);
        if (pathHexes.length < 2) return;

        // 航路の各ヘックスを通り抜けるセグメントを生成
        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];

            // 港町（陸地）ヘックスは経路の中継点としてのみ使い、その上には線を描画しない
            if (!currentHex.properties.isWater && i > 0 && i < pathHexes.length - 1) {
                continue;
            }

            const prevHex = i > 0 ? pathHexes[i - 1] : null;
            const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;

            // 始点と終点を決定 (辺の中心)
            const startPoint = prevHex ? getSharedEdgeMidpoint(currentHex, prevHex) : [currentHex.cx, currentHex.cy];
            const endPoint = nextHex ? getSharedEdgeMidpoint(currentHex, nextHex) : [currentHex.cx, currentHex.cy];

            if (!startPoint || !endPoint) continue;

            // 二次ベジェ曲線のパス文字列を生成
            const pathString = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);

            seaRoutePathData.push({
                path: pathString,
                shipKey: route.shipKey
            });
        }
    });

    // 航路を描画
    layers['sea-route'].group.selectAll('.sea-route-segment')
        // ソート処理を追加
        .data(seaRoutePathData.sort((a, b) => (shipOrder[a.shipKey] || 0) - (shipOrder[b.shipKey] || 0)))
        .enter()
        .append('path')
        .attr('class', 'sea-route-segment')
        .attr('d', d => d.path)
        .attr('stroke', d => seaRouteColors[d.shipKey] || '#fff') // 船のランクに応じて色分け
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '2, 4')
        .style('pointer-events', 'none')
        .style('fill', 'none');
}

/**
 * 国境線レイヤーを再描画する関数
 * @param {Array<object>} visibleHexes - 現在表示されているヘックスの配列 (カリング用)
 */
function drawBorders(visibleHexes) {
    // 1. 古い国境をクリア
    layers.border.group.selectAll('*').remove();

    // visibleHexesが指定されていない場合は全ヘックスを使用
    const targetHexes = visibleHexes || hexes;

    // 2. 新しい国境データを計算して描画
    const borderSegments = [];
    targetHexes.forEach(h => {
        const hNation = h.properties.nationId || 0;
        if (hNation === 0) return;
        h.neighbors.map(i => hexes[i]).forEach(n => {
            if (h.index < n.index) {
                const nNation = n.properties.nationId || 0;
                if (nNation > 0 && hNation !== nNation) {
                    const commonPoints = [];
                    h.points.forEach(p1 => n.points.forEach(p2 => {
                        if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) commonPoints.push(p1);
                    }));
                    if (commonPoints.length === 2) borderSegments.push({ p1: commonPoints[0], p2: commonPoints[1] });
                }
            }
        });
    });

    layers.border.group.selectAll('.border-segment')
        .data(borderSegments).enter().append('line')
        .attr('class', 'border-segment')
        .attr('x1', d => d.p1[0]).attr('y1', d => d.p1[1])
        .attr('x2', d => d.p2[0]).attr('y2', d => d.p2[1])
        .attr('stroke', '#f00').attr('stroke-width', 4)
        .attr('stroke-linecap', 'round').style('pointer-events', 'none');
}

// 砂浜描画関数
async function drawBeaches(visibleHexes) {
    layers.beach.group.selectAll('*').remove();
    const beachSegments = [];

    // visibleHexesが指定されていない場合は全ヘックスを使用
    const targetHexes = visibleHexes || hexes;

    targetHexes.forEach(h => {
        if (h.properties.beachNeighbors && h.properties.beachNeighbors.length > 0) {
            h.properties.beachNeighbors.forEach(neighborIndex => {
                const neighborHex = hexes[neighborIndex];
                const edgePoints = getSharedEdgePoints(h, neighborHex);
                if (edgePoints) {
                    beachSegments.push(edgePoints);
                }
            });
        }
    });

    layers.beach.group.selectAll('.beach-segment')
        .data(beachSegments)
        .enter().append('line')
        .attr('class', 'beach-segment')
        .attr('x1', d => d[0][0])
        .attr('y1', d => d[0][1])
        .attr('x2', d => d[1][0])
        .attr('y2', d => d[1][1])
        .attr('stroke', config.TERRAIN_COLORS.砂浜) // 砂浜の色
        .attr('stroke-width', 6)   // 幅6px
        .attr('stroke-linecap', 'round') // 線の端を丸くする
        .style('pointer-events', 'none');

    console.log(`[BeachDebug] Drawn ${beachSegments.length} beach segments. VisibleHexes: ${targetHexes.length}`);
}

/**
 * 河川レイヤーを再描画する関数
 * @param {Array<object>} visibleHexes - 現在表示されているヘックスの配列
 */
function drawRivers(visibleHexes) {
    layers.river.group.selectAll('*').remove();
    const targetHexes = visibleHexes || hexes;
    const riverPathData = [];

    targetHexes.forEach(d => {
        if (d.properties.flow > 0 && !d.properties.isWater) {
            const downstreamHex = d.downstreamIndex !== -1 ? hexes[d.downstreamIndex] : null;
            if (!downstreamHex) return;

            const endPoint = getSharedEdgeMidpoint(d, downstreamHex);
            if (!endPoint) return;

            // 制御点をヘックスの中心に設定
            const controlPoint = [d.cx, d.cy];

            const upstreamNeighbors = hexes.filter(h => h.downstreamIndex === d.index);
            if (upstreamNeighbors.length === 0) { // 水源の場合
                const startPoint = [d.cx, d.cy];
                const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                riverPathData.push({ path: path, flow: d.properties.flow, riverWidth: d.properties.riverWidth });
            } else { // 中流の場合
                upstreamNeighbors.forEach(upstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        riverPathData.push({ path: path, flow: upstreamHex.properties.flow, riverWidth: upstreamHex.properties.riverWidth });
                    }
                });
            }
        }
    });

    layers.river.group.selectAll('.river-segment')
        .data(riverPathData)
        .enter()
        .append('path')
        .attr('class', 'river-segment')
        .attr('d', d => d.path)
        .attr('stroke', config.TERRAIN_COLORS.河川)
        // 川幅(m)をピクセル幅に変換。10km(1ヘックス) = 2*config.r px と仮定
        // width(m) / 10000 * (2 * config.r) だが、視認性のため少し強調する
        .attr('stroke-width', d => {
            // データから川幅を取得 (なければflowから推定する旧ロジックへのフォールバック)
            const riverWidth = d.riverWidth || (Math.sqrt(d.flow) * 5);
            // 最小1px, 最大 config.r * 0.8
            return Math.max(1.5, Math.min(riverWidth / 15, config.r * 0.8));
            // return 0.1 + riverWidth / 50;
        })
        .attr('stroke-linecap', 'round')
        .style('pointer-events', 'none');
}

/**
 * 稜線・水系図レイヤーを再描画する関数
 * @param {Array<object>} visibleHexes - 現在表示されているヘックスの配列
 */
function drawRidges(visibleHexes) {
    layers['ridge-water-system'].group.selectAll('*').remove();
    const targetHexes = visibleHexes || hexes;
    const ridgePathData = [];
    const hexOverlapScale = 1.01;

    // 水系図（水域ヘックス）
    layers['ridge-water-system'].group.selectAll('.rws-water-hex')
        .data(targetHexes.filter(d => d.properties.isWater))
        .enter()
        .append('polygon')
        .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
        .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
        .attr('fill', config.RIDGE_WATER_SYSTEM_COLORS.RIVER);

    // 稜線データ生成
    targetHexes.forEach(sourceHex => {
        if (sourceHex.properties.ridgeFlow > 0 && !sourceHex.properties.isWater) {
            const upstreamHex = sourceHex.ridgeUpstreamIndex !== -1 ? hexes[sourceHex.ridgeUpstreamIndex] : null;

            let endPoint;
            if (upstreamHex) {
                endPoint = getSharedEdgeMidpoint(sourceHex, upstreamHex);
            } else {
                endPoint = [sourceHex.cx, sourceHex.cy];
            }

            if (!endPoint) return;

            const controlPoint = [sourceHex.cx, sourceHex.cy];
            const downstreamRidgeNeighbors = hexes.filter(h => h.ridgeUpstreamIndex === sourceHex.index);

            if (downstreamRidgeNeighbors.length === 0) {
                const startPoint = [sourceHex.cx, sourceHex.cy];
                const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                ridgePathData.push({ path: path, flow: sourceHex.properties.ridgeFlow });
            } else {
                downstreamRidgeNeighbors.forEach(downstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(sourceHex, downstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        ridgePathData.push({ path: path, flow: downstreamHex.properties.ridgeFlow });
                    }
                });
            }
        }
    });

    layers['ridge-water-system'].group.selectAll('.rws-ridge-segment')
        .data(ridgePathData)
        .enter()
        .append('path')
        .attr('d', d => d.path)
        .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIDGE)
        .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
        .attr('stroke-linecap', 'round')
        .style('fill', 'none');
}

/**
 * ブロック単位で等高線を描画する関数
 * @param {Object} block - ブロックオブジェクト
 */
async function drawBlockContours(block) {
    const layerName = 'contour';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    // クリップパスを適用 (defsに定義されたパスを使用)
    blockGroup.attr('clip-path', `url(#clip-block-${block.id})`);

    // 既存の内容をクリア
    blockGroup.selectAll('*').remove();

    const blockHexes = block.allHexes; // バッファ込みのヘックスを使用
    if (!blockHexes || blockHexes.length === 0) return;

    const hexWidth = 2 * config.r;
    const resolution = config.CONTOUR_RESOLUTION;

    // ブロックのバウンディングボックスより少し広めに計算範囲を取る
    // グリッドをグローバルな解像度に合わせるために、resolutionの倍数にスナップする
    const margin = hexWidth * 2;
    const rawXMin = block.bounds.xMin - margin;
    const rawYMin = block.bounds.yMin - margin;
    const rawXMax = block.bounds.xMax + margin;
    const rawYMax = block.bounds.yMax + margin;

    const xMin = Math.floor(rawXMin / resolution) * resolution;
    const yMin = Math.floor(rawYMin / resolution) * resolution;
    const xMax = Math.ceil(rawXMax / resolution) * resolution;
    const yMax = Math.ceil(rawYMax / resolution) * resolution;

    const width = xMax - xMin;
    const height = yMax - yMin;

    const gridWidth = Math.floor(width / resolution);
    const gridHeight = Math.floor(height / resolution);
    const elevationValues = new Array(gridWidth * gridHeight);

    // Delaunay三角形分割 (計算対象ヘックスのみ)
    const delaunay = d3.Delaunay.from(blockHexes.map(h => [h.cx, h.cy]));

    // グリッド点ごとの標高を計算
    for (let j = 0; j < gridHeight; ++j) {
        for (let i = 0; i < gridWidth; ++i) {
            const px = xMin + i * resolution;
            const py = yMin + j * resolution;

            // 最寄りのヘックスを探す
            const nearestIdx = delaunay.find(px, py);
            const centerHex = blockHexes[nearestIdx];

            // 近傍ヘックスを取得 (global hexes arrayを参照)
            // centerHex.neighbors はグローバルインデックス
            const neighbors = centerHex.neighbors.map(ni => hexes[ni]).filter(Boolean);
            const points = [centerHex, ...neighbors];

            let totalWeight = 0;
            let weightedSum = 0;
            let exactMatch = false;

            for (const h of points) {
                const distSq = (h.cx - px) ** 2 + (h.cy - py) ** 2;
                if (distSq < 1e-6) {
                    // 湖沼も実際の標高を使用する (ユーザー要望)
                    // [FIX] 標高を整数に丸めて整合性を確保 (生成時とロード時の微細な差異を吸収)
                    weightedSum = Math.round(h.properties.elevation);
                    totalWeight = 1;
                    exactMatch = true;
                    break;
                }
                const weight = 1.0 / distSq;
                totalWeight += weight;
                // 湖沼も実際の標高を使用する
                // [FIX] 標高を整数に丸めて整合性を確保
                weightedSum += weight * Math.round(h.properties.elevation);
            }

            if (exactMatch) {
                elevationValues[j * gridWidth + i] = weightedSum;
            } else {
                elevationValues[j * gridWidth + i] = (totalWeight > 0) ? weightedSum / totalWeight : -1;
            }
        }
    }

    // 等高線生成
    // 閾値はマップ全体で統一する必要があるため、固定値または設定値を使用
    const maxElevation = 7500; // 高標高部(7000m級)もカバーできるように値を設定 
    const thresholds = d3.range(config.CONTOUR_INTERVAL, maxElevation, config.CONTOUR_INTERVAL);

    const contours = d3.contours()
        .size([gridWidth, gridHeight])
        .thresholds(thresholds)
        (elevationValues);

    // パスを描画
    blockGroup.selectAll("path")
        .data(contours)
        .join("path")
        .attr("class", d => `contour-path ${d.value % 1000 === 0 ? 'contour-index' : 'contour-intermediate'}`)
        .attr("d", d3.geoPath())
        .attr("transform", `translate(${xMin - resolution / 2}, ${yMin - resolution / 2}) scale(${resolution})`)
        .style('fill', 'none')
        .style('stroke', '#642')
        .style('stroke-width', d => d.value % 1000 === 0 ? 0.1 : 0.05)
        .style('pointer-events', 'none');
}

// getInfoText is imported from infoWindow.js

// getAllSubordinateSettlements and updateChildrenMap are imported from infoWindow.js

// ================================================================
// ビューポートカリングのための描画関数
// 表示範囲内の要素のみを描画する責務を担う
// ================================================================
/**
 * ビューポートカリングのための描画関数
 * @param {d3.ZoomTransform} transform - 現在のズーム情報
 */
/**
 * 情報ウィンドウの表示状態に合わせてサイドバーの高さを調整する関数
 */
function adjustSidebarHeight() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || !infoWindow) return;

    if (infoWindow.classList.contains('hidden')) {
        sidebar.style.height = '100dvh';
    } else {
        // 情報ウィンドウの高さを取得して調整
        // レンダリング待ちのために少し遅延させる
        requestAnimationFrame(() => {
            const infoHeight = infoWindow.offsetHeight;
            // サイドバーの下端が情報ウィンドウの上端に合うようにする
            // window.innerHeight - infoHeight - マージン
            const newHeight = window.innerHeight - infoHeight - 10;
            sidebar.style.height = `${newHeight}px`;
        });
    }
}

/**
 * ブロック分割の初期化関数
 * マップを5x5のブロックに分割し、各ブロックの範囲と所属ヘックスを計算する
 * また、各レイヤーにブロックごとのグループを作成する
 */
function initializeBlocks() {
    console.log("initializeBlocks: Starting...");
    blocks = []; // リセット

    const blockColSize = Math.ceil(config.COLS / BLOCK_COLS);
    const blockRowSize = Math.ceil(config.ROWS / BLOCK_ROWS);
    const buffer = 1; // 1ヘックス分のバッファ

    // クリップパス用のdefs要素を取得または作成
    let defs = svg.select('defs');
    if (defs.empty()) {
        defs = svg.append('defs');
    }
    // 既存のブロック用クリップパスをクリア
    defs.selectAll('.block-clip-path').remove();

    for (let by = 0; by < BLOCK_ROWS; by++) {
        for (let bx = 0; bx < BLOCK_COLS; bx++) {
            const startCol = bx * blockColSize;
            const endCol = Math.min((bx + 1) * blockColSize, config.COLS);
            const startRow = by * blockRowSize;
            const endRow = Math.min((by + 1) * blockRowSize, config.ROWS);

            // バッファを含めた範囲 (データの取得用)
            const bufferedStartCol = Math.max(0, startCol - buffer);
            const bufferedEndCol = Math.min(config.COLS, endCol + buffer);
            const bufferedStartRow = Math.max(0, startRow - buffer);
            const bufferedEndRow = Math.min(config.ROWS, endRow + buffer);

            // ブロックのバウンディングボックス計算 (表示判定用)
            // 座標系はヘックスの中心座標に基づく

            // ヘックスのサイズ
            const hexWidth = 2 * config.r;
            const hexHeight = Math.sqrt(3) * config.r;

            const xMin = startCol * (hexWidth * 3 / 4);
            const xMax = endCol * (hexWidth * 3 / 4) + hexWidth; // 少し余裕を持たせる
            const yMin = startRow * hexHeight;
            const yMax = endRow * hexHeight + hexHeight; // 少し余裕を持たせる

            // [FIX] Map Block Indices to Data File IDs (map_EE_NN)
            // Spec: Start EE=48, NN=71. Center(2,2) -> 50,73
            const ee = 48 + bx;
            const nn = 71 + by;
            const blockId = `map_${ee}_${nn}`;

            const block = {
                id: blockId,
                bx: bx,
                by: by,
                bounds: { xMin, xMax, yMin, yMax },
                hexes: [],      // 互換性のために残すが、基本は coreHexes を使用推奨
                coreHexes: [],  // 描画対象（バッファなし）
                allHexes: [],   // 計算対象（バッファあり）
                rendered: false, // 遅延レンダリング用フラグ
                visible: false
            };

            // 1. coreHexes (本来のブロック領域) を抽出
            for (let r = startRow; r < endRow; r++) {
                for (let c = startCol; c < endCol; c++) {
                    const hexIndex = getIndex(c, r);
                    if (hexes[hexIndex]) {
                        block.coreHexes.push(hexes[hexIndex]);
                    }
                }
            }

            // 2. allHexes (バッファ込み) を抽出
            for (let r = bufferedStartRow; r < bufferedEndRow; r++) {
                for (let c = bufferedStartCol; c < bufferedEndCol; c++) {
                    const hexIndex = getIndex(c, r);
                    if (hexes[hexIndex]) {
                        block.allHexes.push(hexes[hexIndex]);
                    }
                }
            }

            // 互換性維持: hexes は coreHexes を指すようにする
            block.hexes = block.coreHexes;

            blocks.push(block);

            // 3. クリップパスの生成
            const clipPathId = `clip-block-${block.id}`;
            const clipPath = defs.append('clipPath')
                .attr('id', clipPathId)
                .attr('class', 'block-clip-path');

            clipPath.selectAll('polygon')
                .data(block.coreHexes)
                .enter()
                .append('polygon')
                .attr('points', d => d.points.map(p => `${p[0]},${p[1]}`).join(' ')); // 絶対座標

            // 各レイヤーにブロックごとのグループを作成
            Object.keys(layers).forEach(layerName => {
                const layer = layers[layerName];
                // 既存のブロックグループがあれば削除（再生成時）
                layer.group.select(`#${layerName}-${block.id}`).remove();

                // 新しいブロックグループを作成
                layer.group.append('g')
                    .attr('id', `${layerName}-${block.id}`)
                    .attr('class', 'block-group')
                    .style('display', 'none'); // 初期状態は非表示
            });
        }
    }
    console.log(`initializeBlocks: Initialized ${blocks.length} blocks.`);
}

/**
 * ビューポートカリングのための描画関数 (ブロック分割版)
 * @param {d3.ZoomTransform} transform - 現在のズーム情報
 */
function updateVisibleBlocks(transform) {
    // console.log("updateVisibleBlocks: Called", transform);
    if (!svg) {
        console.error("updateVisibleBlocks: svg is undefined");
        return;
    }
    if (blocks.length === 0) {
        console.warn("updateVisibleBlocks: blocks array is empty");
        return;
    }

    // 1. 現在の表示範囲を計算
    const svgNode = svg.node();
    const svgWidth = svgNode.clientWidth;
    const svgHeight = svgNode.clientHeight;
    const topLeft = transform.invert([0, 0]);
    const bottomRight = transform.invert([svgWidth, svgHeight]);

    const viewBounds = {
        xMin: topLeft[0],
        xMax: bottomRight[0],
        yMin: topLeft[1],
        yMax: bottomRight[1]
    };

    // 2. ブロックの可視判定と描画
    const visibleBlocks = blocks.filter(block =>
        block.bounds.xMin < viewBounds.xMax && block.bounds.xMax > viewBounds.xMin &&
        block.bounds.yMin < viewBounds.yMax && block.bounds.yMax > viewBounds.yMin
    );
    // console.log(`updateVisibleBlocks: ${visibleBlocks.length} blocks visible out of ${blocks.length}`);

    blocks.forEach(block => {
        // ブロックがビューポートと交差しているか判定
        const isVisible = (
            block.bounds.xMin < viewBounds.xMax &&
            block.bounds.xMax > viewBounds.xMin &&
            block.bounds.yMin < viewBounds.yMax &&
            block.bounds.yMax > viewBounds.yMin
        );

        block.visible = isVisible;

        // レイヤーごとの表示切り替え (Definition restored)
        const partitionedLayers = [
            'terrain', 'settlement', 'hex-border', 'labels',
            'road', 'sea-route', 'river', 'beach', 'ridge-water-system', 'contour', 'interaction', 'border',
            'white-map-overlay', 'vegetation-overlay', 'snow', 'shading', 'territory-overlay',
            'climate-zone-overlay', 'temp-overlay', 'precip-overlay', 'mana-overlay',
            'agri-overlay', 'forest-overlay', 'mining-overlay', 'fishing-overlay',
            'hunting-overlay', 'pastoral-overlay', 'livestock-overlay', 'monster-overlay', 'population-overlay'
        ];

        // [New] Dynamic Loading Logic
        if (isVisible) {
            if (blockLoaderRef && !block.loaded && !block.loading) {
                // console.log(`[UI] Requesting load for visible block ${block.id}`);
                block.loading = true;

                // Load block data
                blockLoaderRef.load(block.id).then(success => {
                    block.loading = false;
                    if (success) {
                        block.loaded = true;
                        block.rendered = false; // Force re-render
                        // Trigger update to render the newly loaded block
                        // Use current transform from global state or fetch from svg
                        if (svg) {
                            updateVisibleBlocks(d3.zoomTransform(svg.node()));
                        }
                    }
                });
            }

            // 表示: まだレンダリングされていなければ描画
            if (!block.rendered && block.loaded) { // Only render if loaded
                // console.log(`Triggering renderBlock for ${block.id}`);
                renderBlock(block);
                block.rendered = true;
            } else if (!block.rendered && !block.loaded) {
                // Loading... placeholder?
            }

            // 各レイヤーのグループを表示
            partitionedLayers.forEach(layerName => {
                if (layers[layerName]) {
                    layers[layerName].group.select(`#${layerName}-${block.id}`).style('display', 'inline');
                }
            });
        } else { // !isVisible
            // 非表示: レンダリング済みならDOMを削除してメモリ解放
            if (block.rendered) {
                partitionedLayers.forEach(layerName => {
                    if (layers[layerName]) {
                        const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
                        blockGroup.selectAll('*').remove();
                        blockGroup.style('display', 'none');
                    }
                });
                block.rendered = false;
            }

            // [New] Dynamic Unloading Logic
            // If block is hidden and loaded, unload data to free memory
            if (blockLoaderRef && block.loaded && !block.loading) {
                // console.log(`[UI] Requesting unload for hidden block ${block.id}`);
                blockLoaderRef.unload(block.id);
                block.loaded = false;
            }
        }
    });

    // 3. 非ブロック化レイヤー（ハイライトなど）の更新
    // これらは全画面共通または動的なので、従来通りか別途制御
    // ハイライトなどはクリック時生成なのでここでは何もしなくて良い

    // ラベルの表示レベル制御 (ズームレベルに応じて)
    const effectiveRadius = config.r * transform.k;
    layers.labels.group.selectAll('.hex-label, .property-label')
        .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
}

/**
 * 指定されたブロックのコンテンツを描画する
 * @param {Object} block - ブロックオブジェクト
 */
function renderBlock(block) {
    // console.log(`renderBlock: Rendering block ${block.id}`);
    // 各レイヤーの描画関数を呼び出す
    // 注意: ここで呼び出す描画関数は、ブロック内の要素のみを描画するように修正が必要

    // 地形 (Terrain)
    drawBlockTerrain(block);

    // 河川 (River)
    drawBlockRivers(block);

    // 砂浜 (Beach)
    drawBlockBeaches(block);

    // 国境 (Border)
    drawBlockBorders(block);

    // 稜線・水系 (Ridge/Water System)
    drawBlockRidgeLines(block);

    // 等高線 (Contour)
    drawBlockContours(block);

    // 集落 (Settlement)
    drawBlockSettlements(block);

    // 道路 (Road) - 集落の上に描画して接続を確認
    drawBlockRoads(block);

    // ラベル (Labels)
    drawBlockLabels(block);

    // ヘックス境界 (Hex Borders)
    drawBlockHexBorders(block);

    // インタラクション (Interaction)
    drawBlockInteraction(block);
}

const getTooltipText = (d) => {
    const p = d.properties;

    // --- STEP 1: 新しいヘッダーセクションを生成 ---
    let headerText = '';

    const terrain = p.isWater ? '水域' : (p.terrainType || '不明');
    const vegetation = p.vegetation || 'なし';

    headerText += `地形：${terrain}\n`;
    headerText += `代表植生：${vegetation}\n`;

    // 特性リストを動的に生成
    const features = [];
    if (p.isAlluvial) features.push('河川');
    if (p.hasSnow) features.push('積雪');
    if (p.beachNeighbors && p.beachNeighbors.length > 0) features.push('砂浜');

    if (features.length > 0) {
        headerText += `特性：${features.join(', ')}\n`;
    }

    headerText += '---\n';

    // --- STEP 2: 既存の本文セクションを生成 ---
    let bodyText = '';
    const locationText = formatLocation(d, 'short');
    const settlementType = (p.settlement || '散居').padEnd(2, '　');
    const populationText = `人口：${(p.population || 0).toLocaleString()}人`;
    bodyText += `${settlementType}：${locationText}\n${populationText}`;

    // 親集落の階層をたどって表示
    if (p.parentHexId !== null) {
        bodyText += `\n---`;
        let currentHex = d;
        let safety = 0;
        while (currentHex && currentHex.properties.parentHexId !== null && safety < 10) {
            const parentHex = hexes[currentHex.properties.parentHexId];
            if (!parentHex) break;

            const parentType = (parentHex.properties.settlement || '').padEnd(2, '　');
            const parentCoords = formatLocation(parentHex, 'short');
            bodyText += `\n${parentType}：${parentCoords}`;

            currentHex = parentHex;
            safety++;
        }
    }

    // 国家情報を表示
    const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1]
        ? config.NATION_NAMES[p.nationId - 1]
        : '辺境';
    bodyText += `\n${nationName}`;

    // --- STEP 3: ヘッダーと本文を結合して返す ---
    return headerText + bodyText;
};

function drawBlockTerrain(block) {
    // console.log(`drawBlockTerrain: Drawing block ${block.id}, hexes: ${block.hexes.length}`);
    const layerName = 'terrain';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const hexOverlapScale = 1.01;

    blockGroup.selectAll('.hex')
        .data(block.hexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'hex')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                .attr('stroke', 'none'),
            update => update,
            exit => exit.remove()
        )
        .attr('fill', d => d._displayColor || '#000');
}

function drawBlockSettlements(block) {
    const layerName = 'settlement';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const settlementHexes = block.hexes.filter(d => ['村', '町', '街', '領都', '首都', '都市'].includes(d.properties.settlement));

    blockGroup.selectAll('.settlement-hex')
        .data(settlementHexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'settlement-hex')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(0.6)`)
                .attr('fill', d => ({
                    '首都': '#f0f',
                    '都市': '#f00',
                    '領都': '#f00',
                    '街': '#f80',
                    '町': '#ff0',
                    '村': '#0f0'
                }[d.properties.settlement]))
                .style('fill-opacity', 0.9)
                .style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );
}

function drawBlockLabels(block) {
    const layerName = 'labels';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const hexHeight = Math.sqrt(3) * config.r;

    // ラベルグループの更新
    const hexLabelGroups = blockGroup.selectAll('.hex-label-group')
        .data(block.hexes, d => d.index)
        .join(enter => enter.append('g').attr('class', 'hex-label-group'));

    // 既存の内容をクリアして再生成（シンプルにするため）
    hexLabelGroups.selectAll('*').remove();

    // 座標と標高
    const coordinateLabel = hexLabelGroups.append('text')
        .attr('class', 'hex-label')
        .attr('x', d => d.cx)
        .attr('y', d => d.cy + hexHeight * 0.28)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle');

    coordinateLabel.append('tspan')
        .text(d => formatLocation(d, 'coords'));

    coordinateLabel.append('tspan')
        .attr('x', d => d.cx)
        .attr('dy', '1.0em')
        .text(d => formatLocation(d, 'elevation'));

    // 集落名
    if (layers.settlement.visible) {
        hexLabelGroups.filter(d => d.properties.settlement)
            .append('text').attr('class', 'settlement-label')
            .attr('x', d => d.cx).attr('y', d => d.cy)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .text(d => d.properties.settlement);
    }

    // Update visibility based on current layer state
    const settlementLabels = hexLabelGroups.selectAll('.settlement-label');
    if (!layers.settlement.visible) {
        settlementLabels.style('display', 'none');
    } else {
        settlementLabels.style('display', 'inline');
    }

    // プロパティラベル
    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx - config.r * 0.75).attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(d => d.properties.manaRank);

    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx + config.r * 0.75).attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(d => {
            const potentials = [];
            if (d.properties.agriPotential >= 3) potentials.push('農');
            if (d.properties.forestPotential >= 3) potentials.push('林');
            if (d.properties.miningPotential >= 3) potentials.push('鉱');
            if (d.properties.fishingPotential >= 3) potentials.push('漁');
            if (d.properties.huntingPotential >= 3) potentials.push('狩');
            if (d.properties.pastoralPotential >= 3) potentials.push('牧');
            if (d.properties.livestockPotential >= 3) potentials.push('畜');
            return potentials.join('');
        });
}

function drawBlockInteraction(block) {
    const layerName = 'interaction';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const hexOverlapScale = 1.01;

    blockGroup.selectAll('.interactive-hex')
        .data(block.hexes, d => d.index)
        .join(
            enter => {
                const newHexes = enter.append('polygon')
                    .attr('class', 'interactive-hex')
                    .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                    .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                    .style('fill', 'transparent')
                    .style('cursor', 'pointer')
                    .style('pointer-events', 'all')
                    .attr('data-index', d => d.index);

                // ツールチップイベント
                newHexes.on('mousemove', (event) => {
                    if (window.innerWidth <= 600) return; // スマホでは表示しない
                    if (tooltipContainer.style('visibility') === 'visible') {
                        const tooltipWidth = tooltipContainer.node().offsetWidth;
                        const offset = 40;
                        let leftPos = event.pageX + offset;

                        // 画面右半分の場合は左側に表示
                        if (event.pageX > window.innerWidth * 0.7) {
                            leftPos = event.pageX - tooltipWidth - offset;
                        }

                        tooltipContainer
                            .style('top', (event.pageY - 10) + 'px')
                            .style('left', leftPos + 'px');
                    }
                })

                    .on('mouseover', (event, d) => {
                        if (window.innerWidth <= 600) return; // スマホでは表示しない
                        if (d) {
                            tooltipContainer.text(getTooltipText(d));
                            tooltipContainer.style('visibility', 'visible');
                            /*
                            // カーソルハイライト (白枠)
                            const cursorLayer = layers['cursor-highlight-overlay'].group;
                            cursorLayer.selectAll('*').remove(); // 念のためクリア
                            cursorLayer.append('polygon')
                                .attr('points', d.points.map(p => `${p[0]},${p[1]}`).join(' ')) // translateなしの絶対座標
                                //.attr('transform', `translate(0,0)`) // 不要
                                .style('fill', 'none')
                                .style('stroke', 'white')
                                .style('stroke-width', '2px')
                                .style('pointer-events', 'none')
                            */
                        }
                    })
                    .on('mouseout', () => {
                        tooltipContainer.style('visibility', 'hidden');
                        /*
                        // ハイライト消去
                        if (layers['cursor-highlight-overlay']) {
                            layers['cursor-highlight-overlay'].group.selectAll('*').remove();
                        }
                        */
                    });

                newHexes.on('click', (event, d) => {
                    // [DEBUG] プロパティ検査
                    console.log('[Click Debug] Hex Index:', d.index);
                    console.log('[Click Debug] Properties:', d.properties);
                    console.log('[Click Debug] Logistics:', d.properties.logistics);
                    console.log('[Click Debug] LivingConditions:', d.properties.livingConditions);

                    event.stopPropagation();

                    // ハイライト更新
                    const highlightLayer = layers['highlight-overlay'].group;
                    highlightLayer.selectAll('*').remove();
                    const p = d.properties;
                    if (['首都', '都市', '領都', '街', '町', '村'].includes(p.settlement)) {
                        const findAllDescendants = (startIndex) => {
                            const descendants = [];
                            const queue = [{ index: startIndex, depth: 0 }];
                            const visited = new Set([startIndex]);
                            let head = 0;
                            while (head < queue.length) {
                                const current = queue[head++];
                                const children = childrenMap.get(current.index) || [];
                                children.forEach(childIndex => {
                                    if (!visited.has(childIndex)) {
                                        visited.add(childIndex);
                                        const childDepth = current.depth + 1;
                                        descendants.push({ hex: hexes[childIndex], depth: childDepth });
                                        queue.push({ index: childIndex, depth: childDepth });
                                    }
                                });
                            }
                            return descendants;
                        };
                        const descendants = findAllDescendants(d.index);
                        if (descendants.length > 0) {
                            const maxDepth = Math.max(0, ...descendants.map(item => item.depth));
                            const colorScale = d3.scaleLinear().domain([2, Math.max(2, maxDepth)])
                                .range(['#600', 'black']).interpolate(d3.interpolateRgb);
                            descendants.forEach(item => {
                                let color = (item.depth === 1) ? 'red' : colorScale(item.depth);
                                highlightLayer.append('polygon')
                                    .attr('points', item.hex.points.map(pt => pt.join(',')).join(' '))
                                    .attr('fill', color)
                                    .style('fill-opacity', 0.8)
                                    .style('pointer-events', 'none');
                            });
                        }

                        if (p.parentHexId !== null) {
                            const superiorHex = hexes[p.parentHexId];
                            if (superiorHex) {
                                highlightLayer.append('polygon')
                                    .attr('points', superiorHex.points.map(pt => pt.join(',')).join(' '))
                                    .attr('fill', '#0ff')
                                    .style('fill-opacity', 1.0)
                                    .style('pointer-events', 'none');

                                const childIndex = d.index;
                                const parentIndex = superiorHex.index;
                                const targetRoad = roadPathsData.find(road => {
                                    if (road.path.length < 2) return false;
                                    const startNodeIndex = getIndex(road.path[0].x, road.path[0].y);
                                    const endNodeIndex = getIndex(road.path[road.path.length - 1].x, road.path[road.path.length - 1].y);
                                    return (startNodeIndex === childIndex && endNodeIndex === parentIndex) || (startNodeIndex === parentIndex && endNodeIndex === childIndex);
                                });

                                if (targetRoad) {
                                    const pathSegments = [];
                                    const pathHexes = targetRoad.path.map(pos => hexes[getIndex(pos.x, pos.y)]);

                                    for (let i = 0; i < pathHexes.length; i++) {
                                        const currentHex = pathHexes[i];
                                        if (!currentHex) continue;
                                        const prevHex = i > 0 ? pathHexes[i - 1] : null;
                                        const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;

                                        const startPoint = prevHex ? getSharedEdgeMidpoint(currentHex, prevHex) : [currentHex.cx, currentHex.cy];
                                        const endPoint = nextHex ? getSharedEdgeMidpoint(currentHex, nextHex) : [currentHex.cx, currentHex.cy];
                                        if (!startPoint || !endPoint || (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])) continue;

                                        const pathString = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);
                                        pathSegments.push({ path: pathString });
                                    }
                                    highlightLayer.selectAll('.connection-path')
                                        .data(pathSegments)
                                        .enter()
                                        .append('path')
                                        .attr('class', 'connection-path')
                                        .attr('d', segment => segment.path)
                                        .attr('stroke', 'cyan')
                                        .attr('stroke-width', 4)
                                        .attr('fill', 'none')
                                        .style('pointer-events', 'none');
                                }
                            }
                        }
                    }

                    // --- 3. 航路ハイライトのロジック ---
                    const clickedIndex = d.index;
                    // クリックされた港から発着する全ての航路をフィルタリング
                    const relatedSeaRoutes = roadPathsData.filter(road => {
                        if (road.level !== 10 || road.path.length < 2) return false;
                        const startIndex = getIndex(road.path[0].x, road.path[0].y);
                        const endIndex = getIndex(road.path[road.path.length - 1].x, road.path[road.path.length - 1].y);
                        return startIndex === clickedIndex || endIndex === clickedIndex;
                    });

                    if (relatedSeaRoutes.length > 0) {
                        const seaRouteSegments = [];
                        relatedSeaRoutes.forEach(route => {
                            const pathHexes = route.path.map(p => hexes[getIndex(p.x, p.y)]).filter(Boolean);
                            if (pathHexes.length < 2) return;

                            for (let i = 0; i < pathHexes.length; i++) {
                                const currentHex = pathHexes[i];
                                if (!currentHex.properties.isWater && i > 0 && i < pathHexes.length - 1) continue;
                                const prevHex = i > 0 ? pathHexes[i - 1] : null;
                                const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;
                                const startPoint = prevHex ? getSharedEdgeMidpoint(currentHex, prevHex) : [currentHex.cx, currentHex.cy];
                                const endPoint = nextHex ? getSharedEdgeMidpoint(currentHex, nextHex) : [currentHex.cx, currentHex.cy];
                                if (!startPoint || !endPoint) continue;
                                const pathString = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);
                                seaRouteSegments.push({ path: pathString });
                            }
                        });

                        // ハイライトレイヤーに航路を描画
                        highlightLayer.selectAll('.sea-route-highlight')
                            .data(seaRouteSegments).enter().append('path')
                            .attr('class', 'sea-route-highlight')
                            .attr('d', d => d.path)
                            .attr('stroke', 'cyan')
                            .attr('stroke-width', 4)
                            .attr('fill', 'none')
                            .style('pointer-events', 'none');
                    }

                    // --- 4. 共通の処理 (変更なし) ---
                    highlightLayer.append('polygon').attr('points', d.points.map(p => p.join(',')).join(' '))
                        .attr('fill', 'none')
                        .attr('stroke', 'cyan')
                        .attr('stroke-width', 5)
                        .style('pointer-events', 'none');

                    // 情報ウィンドウ表示
                    if (infoContent) {
                        currentSelectedHex = d; // 選択されたヘックスを保存
                        infoContent.innerHTML = getInfoText(d);
                        infoWindow.classList.remove('hidden');
                        adjustSidebarHeight();
                    }
                });
                return newHexes;
            },
            update => {
                // update.select('title').text(d => getTooltipText(d)); // Removed
                return update;
            },
            exit => exit.remove()
        );
}

/**
 * 3つのヘックス（前、現在、次）が共有する頂点を特定するヘルパー関数
 */
function getCommonVertex(h1, h2, h3) {
    const edge1 = getSharedEdgePoints(h1, h2);
    const edge2 = getSharedEdgePoints(h2, h3);
    if (!edge1 || !edge2) return null;
    const epsilon = 0.1;
    for (const p1 of edge1) {
        for (const p2 of edge2) {
            if (Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon) {
                return p1;
            }
        }
    }
    return null;
}

function getSettlementLevel(name) {
    const levels = { '首都': 6, '都市': 5, '領都': 4, '街': 4, '町': 3, '村': 2 };
    return levels[name] || 0;
}

/**
 * 道路・航路のパス文字列を生成するヘルパー関数
 * 急カーブ（隣接辺への移動）の場合は円弧、それ以外は二次ベジェ曲線を使用
 */
function generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex) {
    const controlPoint = [currentHex.cx, currentHex.cy];

    // 1. 中心-辺接続（6パターン）: 始点または終点がヘックス中心の場合 -> 直線（L）
    const isStartCenter = Math.abs(startPoint[0] - controlPoint[0]) < 1e-6 && Math.abs(startPoint[1] - controlPoint[1]) < 1e-6;
    const isEndCenter = Math.abs(endPoint[0] - controlPoint[0]) < 1e-6 && Math.abs(endPoint[1] - controlPoint[1]) < 1e-6;

    if (isStartCenter || isEndCenter) {
        return `M ${startPoint[0]},${startPoint[1]} L ${controlPoint[0]},${controlPoint[1]} L ${endPoint[0]},${endPoint[1]}`;
    }

    // 2. 対辺接続/直進（3パターン）: 始点と終点が中心に対して対称（一直線）の場合 -> 直線（L）
    // 座標誤差を考慮して判定
    const midX = (startPoint[0] + endPoint[0]) / 2;
    const midY = (startPoint[1] + endPoint[1]) / 2;
    if (Math.abs(midX - controlPoint[0]) < 1.0 && Math.abs(midY - controlPoint[1]) < 1.0) {
        return `M ${startPoint[0]},${startPoint[1]} L ${controlPoint[0]},${controlPoint[1]} L ${endPoint[0]},${endPoint[1]}`;
    }

    // 3. 急カーブ（6パターン）: 前後のヘックスが互いに隣接している場合 -> 円弧（A）
    const isSharpTurn = prevHex && nextHex &&
        prevHex.neighbors &&
        prevHex.neighbors.includes(nextHex.index);

    if (isSharpTurn) {
        const vertex = getCommonVertex(prevHex, currentHex, nextHex);
        if (vertex) {
            const r = Math.hypot(startPoint[0] - vertex[0], startPoint[1] - vertex[1]);
            const vs = [startPoint[0] - vertex[0], startPoint[1] - vertex[1]];
            const ve = [endPoint[0] - vertex[0], endPoint[1] - vertex[1]];
            const cp = vs[0] * ve[1] - vs[1] * ve[0];
            const sweep = cp > 0 ? 1 : 0;
            return `M ${startPoint[0]},${startPoint[1]} A ${r},${r} 0 0,${sweep} ${endPoint[0]},${endPoint[1]}`;
        }
    }

    // 4. 緩やかカーブ（6パターン）: 上記以外 -> ベジェ曲線（Q）
    return `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
}

function drawBlockRoads(block) {
    const layerName = 'road';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    const seaRouteGroup = layers['sea-route'].group.select(`#sea-route-${block.id}`);

    if (blockGroup.empty() && seaRouteGroup.empty()) return;
    if (!roadPathsData || roadPathsData.length === 0) return;

    const blockHexIds = new Set(block.hexes.map(h => h.index));
    const landRoadPathData = [];
    const roadSegmentGrid = new Map();

    // 道路レベルの降順でソート（高レベル優先）
    const landRoads = roadPathsData.filter(d => d.level < 10).sort((a, b) => b.level - a.level);

    landRoads.forEach(road => {
        if (road.path.length < 2) return;
        const pathHexes = road.path.map(p => hexes[getIndex(p.x, p.y)]);

        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];
            if (!currentHex) continue;
            const prevHex = i > 0 ? pathHexes[i - 1] : null;
            const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;

            const isRelevant = blockHexIds.has(currentHex.index) ||
                (prevHex && blockHexIds.has(prevHex.index)) ||
                (nextHex && blockHexIds.has(nextHex.index));
            if (!isRelevant) continue;

            // 分割判定
            let shouldSplit = false;

            // 1. 直進判定（対辺接続）
            if (prevHex && nextHex) {
                // 簡易判定: 座標の中点が中心に近いか
                const startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
                const endPoint = getSharedEdgeMidpoint(currentHex, nextHex);
                if (startPoint && endPoint) {
                    const midX = (startPoint[0] + endPoint[0]) / 2;
                    const midY = (startPoint[1] + endPoint[1]) / 2;
                    if (Math.abs(midX - currentHex.cx) < 1.0 && Math.abs(midY - currentHex.cy) < 1.0) {
                        shouldSplit = true;
                    }
                }
            }

            // 2. 集落経由判定
            if (currentHex.properties.settlement) {
                const settlementLevel = getSettlementLevel(currentHex.properties.settlement);
                // 同等以下の集落がある場合は中心を経由する
                if (settlementLevel <= road.level) {
                    shouldSplit = true;
                }
            }

            // 始点・終点は常に分割扱い（片側のみ描画）
            if (!prevHex || !nextHex) shouldSplit = true;

            if (shouldSplit) {
                // 分割描画: Prev->Center, Center->Next
                if (prevHex) {
                    const start = getSharedEdgeMidpoint(currentHex, prevHex);
                    const end = [currentHex.cx, currentHex.cy];
                    if (start) {
                        const key = `${currentHex.index}-${Math.min(prevHex.index, currentHex.index)}-${Math.max(prevHex.index, currentHex.index)}-Center`;
                        if (!roadSegmentGrid.has(key)) {
                            roadSegmentGrid.set(key, true);
                            const path = generateCurvePath(start, end, currentHex, prevHex, null);
                            landRoadPathData.push({ path: path, level: road.level, nationId: road.nationId });
                        }
                    }
                }
                if (nextHex) {
                    const start = [currentHex.cx, currentHex.cy];
                    const end = getSharedEdgeMidpoint(currentHex, nextHex);
                    if (end) {
                        const key = `${currentHex.index}-${Math.min(nextHex.index, currentHex.index)}-${Math.max(nextHex.index, currentHex.index)}-Center`;
                        if (!roadSegmentGrid.has(key)) {
                            roadSegmentGrid.set(key, true);
                            const path = generateCurvePath(start, end, currentHex, null, nextHex);
                            landRoadPathData.push({ path: path, level: road.level, nationId: road.nationId });
                        }
                    }
                }
            } else {
                // 通常描画（カーブ）
                const startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
                const endPoint = getSharedEdgeMidpoint(currentHex, nextHex);
                if (startPoint && endPoint) {
                    const key = `${currentHex.index}-${Math.min(prevHex.index, nextHex.index)}-${Math.max(prevHex.index, nextHex.index)}`;
                    if (!roadSegmentGrid.has(key)) {
                        roadSegmentGrid.set(key, true);
                        const path = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);
                        landRoadPathData.push({ path: path, level: road.level, nationId: road.nationId });
                    }
                }
            }
        }
    });

    if (!blockGroup.empty()) {
        blockGroup.selectAll('.road-segment')
            .data(landRoadPathData.sort((a, b) => a.level - b.level))
            .join(
                enter => enter.append('path')
                    .attr('class', 'road-segment')
                    .attr('d', d => d.path)
                    .attr('stroke', d => ({
                        6: '#f0f', 5: '#f00', 4: '#f80', 3: '#ff0', 2: '#0f0', 1: '#600'
                    }[d.level] || '#000'))
                    .attr('stroke-width', d => ({
                        6: 6.0, 5: 5.0, 4: 4.0, 3: 3.0, 2: 2.0, 1: 1.0
                    }[d.level] || 1))
                    .attr('stroke-dasharray', d => ({
                        6: '2, 3', 5: '2, 3', 4: '2, 3', 3: '2, 3', 2: '2, 3', 1: '1, 2'
                    }[d.level] || '2, 2'))
                    .style('pointer-events', 'none')
                    .style('fill', 'none'),
                update => update,
                exit => exit.remove()
            );
    }

    const seaRoutes = roadPathsData.filter(d => d.level === 10);
    const seaRouteColors = {
        'dinghy': '#0f0', 'small_trader': '#ff0', 'coastal_trader': '#f00',
        'medium_merchant': '#a0f', 'large_sailing_ship': '#00f'
    };
    const shipOrder = {
        'dinghy': 1, 'small_trader': 2, 'coastal_trader': 3,
        'medium_merchant': 4, 'large_sailing_ship': 5
    };

    const seaRoutePathData = [];
    seaRoutes.forEach(route => {
        const pathHexes = route.path.map(p => hexes[getIndex(p.x, p.y)]).filter(Boolean);
        if (pathHexes.length < 2) return;

        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];
            if (!currentHex.properties.isWater && i > 0 && i < pathHexes.length - 1) continue;
            const prevHex = i > 0 ? pathHexes[i - 1] : null;
            const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : null;
            const isRelevant = blockHexIds.has(currentHex.index) ||
                (prevHex && blockHexIds.has(prevHex.index)) ||
                (nextHex && blockHexIds.has(nextHex.index));
            if (!isRelevant) continue;

            // 陸地ヘックスの場合は描画しない（ただし、始点・終点が陸地の場合は、その境界まで描画する）
            // 航路は基本的に海ヘックスを通るが、港（陸地）に接続する部分は陸地ヘックスを含む
            // ここでは、currentHexが陸地の場合、海側の隣接ヘックスとの境界（中点）を端点とする

            let startPoint, endPoint;

            // 始点の計算
            if (prevHex) {
                if (!currentHex.properties.isWater) {
                    // 現在地が陸地の場合、前のヘックス（海のはず）との境界まで
                    startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
                } else if (!prevHex.properties.isWater) {
                    // 前のヘックスが陸地の場合、境界から開始
                    startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
                } else {
                    // 両方海なら通常通り中点（あるいは中心）から
                    // ベジェ曲線のつなぎ目を滑らかにするため、通常は中点を使う
                    startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
                }
            } else {
                // パスの始点
                if (!currentHex.properties.isWater) {
                    // 始点が陸地（港）の場合、次のヘックスとの境界を開始点とする（つまり描画しない？）
                    // いや、港から出る船を描画したいなら、港の中心から出るべきか、それとも海岸線から出るべきか。
                    // 要件「海岸線のヘックス辺までしか描画しない」に従うなら、
                    // 陸地ヘックス内のパスは描画せず、境界から海側のみ描画する。
                    // つまり、currentHexが陸地なら、このセグメントは描画対象外（または境界点のみ）
                    // しかしループは「ヘックスごと」ではなく「パスのノードごと」に回っている
                    // i番目のヘックスにおける描画範囲を考える。

                    // シンプルに考える：
                    // セグメントは prevHex -> currentHex ではなく、
                    // getSharedEdgeMidpoint(prev, current) -> current -> getSharedEdgeMidpoint(current, next)
                    // という区間で描画されている（Q controlPoint）。

                    // currentHexが陸地の場合：描画しない。
                    // currentHexが海の場合：
                    //   prevHexが陸地 -> startPointは境界（getSharedEdgeMidpoint）
                    //   nextHexが陸地 -> endPointは境界（getSharedEdgeMidpoint）
                    // これで「陸地内は描画されず、境界で止まる」ことになる。
                }
            }

            // ロジック再構築
            // currentHexが陸地（港）の場合、そのヘックス内の描画はスキップする。
            if (!currentHex.properties.isWater) continue;

            // currentHexは海。
            // prevHexが存在する場合、startPointを決める
            if (prevHex) {
                startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
            } else {
                // パスの始点かつ海（洋上スタート）。中心から開始
                startPoint = [currentHex.cx, currentHex.cy];
            }

            // nextHexが存在する場合、endPointを決める
            if (nextHex) {
                endPoint = getSharedEdgeMidpoint(currentHex, nextHex);
            } else {
                // パスの終点かつ海。中心で終了
                endPoint = [currentHex.cx, currentHex.cy];
            }

            if (!startPoint || !endPoint) continue;
            if (!startPoint || !endPoint) continue;

            const pathString = generateCurvePath(startPoint, endPoint, currentHex, prevHex, nextHex);
            seaRoutePathData.push({ path: pathString, shipKey: route.shipKey });
        }
    });

    if (!seaRouteGroup.empty()) {
        seaRouteGroup.selectAll('.sea-route-segment')
            .data(seaRoutePathData.sort((a, b) => (shipOrder[a.shipKey] || 0) - (shipOrder[b.shipKey] || 0)))
            .join(
                enter => enter.append('path')
                    .attr('class', 'sea-route-segment')
                    .attr('d', d => d.path)
                    .attr('stroke', d => seaRouteColors[d.shipKey] || '#fff')
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '2, 4')
                    .style('pointer-events', 'none')
                    .style('fill', 'none'),
                update => update,
                exit => exit.remove()
            );
    }
}

function drawBlockRivers(block) {
    const layerName = 'river';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const riverPathData = [];
    block.hexes.forEach(d => {
        if (d.properties.flow > 0 && !d.properties.isWater) {
            const downstreamHex = d.downstreamIndex !== -1 ? hexes[d.downstreamIndex] : null;
            if (!downstreamHex) return;

            const endPoint = getSharedEdgeMidpoint(d, downstreamHex);
            if (!endPoint) return;

            // 制御点をヘックスの中心に設定
            const controlPoint = [d.cx, d.cy];

            const upstreamNeighbors = hexes.filter(h => h.downstreamIndex === d.index);
            if (upstreamNeighbors.length === 0) { // 水源の場合
                const startPoint = [d.cx, d.cy];
                const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                riverPathData.push({ path: path, flow: d.properties.flow, width: d.properties.riverWidth });
            } else { // 中流の場合
                upstreamNeighbors.forEach(upstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        riverPathData.push({ path: path, flow: upstreamHex.properties.flow, width: upstreamHex.properties.riverWidth });
                    }
                });
            }
        }
    });

    const isWhiteMap = d3.select('input[name="map-type"]:checked').property('value') === 'white';
    const isRidgeWaterSystemVisible = layers['ridge-water-system'] && layers['ridge-water-system'].visible;

    let riverColor;
    if (isRidgeWaterSystemVisible) {
        riverColor = config.RIDGE_WATER_SYSTEM_COLORS.RIVER;
    } else if (isWhiteMap) {
        riverColor = config.WHITE_MAP_COLORS.WATER;
    } else {
        riverColor = config.TERRAIN_COLORS.河川;
    }

    blockGroup.selectAll('path')
        .data(riverPathData)
        .join(
            enter => enter.append('path')
                .attr('d', d => d.path)
                .attr('stroke', riverColor)
                .attr('stroke-width', d => {
                    // [USER REQUEST] 1m:0.1px - 100m:10.0px のスケーリング
                    // 線形補間: px = 0.05 * width_m + 0.05 (approx 0.05 * width_m)
                    // 1m -> 0.1px, 100m -> 5.0px
                    // 傾き a = (5.0 - 0.1) / (100 - 1) = 4.9 / 99 = 0.04949...
                    // 切片 b = 0.1 - a * 1 = 0.1 - 0.04949 = 0.0505...
                    // 簡易的に width * 0.05 をベースにしつつ、最小値を確保する
                    const width_m = d.width || 1.0; // widthプロパティを使用 (データにない場合は1.0)
                    const scale = 0.1;
                    const px = 0.5 + width_m * scale;
                    return Math.min(px, config.r); // 最小0.1px, 最大はヘックスサイズ
                })
                .attr('stroke-linecap', 'round')
                .style('fill', 'none')
                .style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );
}

function drawBlockBeaches(block) {
    const layerName = 'beach';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const beachPathData = [];
    let beachCount = 0;
    block.hexes.forEach(d => {
        if (d.properties.beachNeighbors && d.properties.beachNeighbors.length > 0) {
            beachCount++;
            d.properties.beachNeighbors.forEach(neighborIndex => {
                const neighbor = hexes[neighborIndex];
                if (neighbor) {
                    const edge = getSharedEdgePoints(d, neighbor);
                    if (edge) {
                        const path = `M ${edge[0][0]},${edge[0][1]} L ${edge[1][0]},${edge[1][1]}`;
                        beachPathData.push({ path: path });
                    }
                }
            });
        }
    });

    // [DEBUG] Always log for beaches analysis
    if (block.id === '0-0' || beachCount > 0) {
        console.log(`[Beach Debug] Block ${block.id}: Found ${beachCount} hexes with beaches.`);
        if (beachPathData.length > 0) {
            console.log(`[Beach Debug] Generated ${beachPathData.length} paths. Sample: ${beachPathData[0].path}`);
        } else {
            console.log(`[Beach Debug] Found hexes but NO paths generated. getSharedEdgePoints failed?`);
            // 詳細デバッグ: 最初の1件だけ検証
            block.hexes.some(d => {
                if (d.properties.beachNeighbors && d.properties.beachNeighbors.length > 0) {
                    const neighborIndex = d.properties.beachNeighbors[0];
                    const neighbor = hexes[neighborIndex];
                    console.log(`[Beach Detail] Hex[${d.index}] (x:${d.x}, y:${d.y}) vs Neighbor[${neighborIndex}] (x:${neighbor.x}, y:${neighbor.y})`);
                    console.log(`[Beach Detail] Hex points:`, d.points ? d.points[0] : 'undefined');
                    console.log(`[Beach Detail] Neighbor points:`, neighbor.points ? neighbor.points[0] : 'undefined');
                    return true;
                }
                return false;
            });
        }
    }

    blockGroup.selectAll('path')
        .data(beachPathData)
        .join(
            enter => enter.append('path')
                .attr('d', d => d.path)
                .attr('stroke', config.TERRAIN_COLORS.砂浜)
                .attr('stroke-width', 6)
                .attr('stroke-linecap', 'round')
                .style('fill', 'none')
                .style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );
}

function drawBlockBorders(block) {
    const layerName = 'border';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const borderSegments = [];
    block.hexes.forEach(h => {
        const hNation = h.properties.nationId || 0;
        if (hNation === 0) return;
        h.neighbors.map(i => hexes[i]).filter(n => n).forEach(n => {
            if (h.index < n.index) {
                const nNation = n.properties.nationId || 0;
                if (nNation > 0 && hNation !== nNation) {
                    const commonPoints = [];
                    h.points.forEach(p1 => n.points.forEach(p2 => {
                        if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) commonPoints.push(p1);
                    }));
                    if (commonPoints.length === 2) borderSegments.push({ p1: commonPoints[0], p2: commonPoints[1] });
                }
            }
        });
    });

    blockGroup.selectAll('.border-segment')
        .data(borderSegments)
        .join(
            enter => enter.append('line')
                .attr('class', 'border-segment')
                .attr('x1', d => d.p1[0]).attr('y1', d => d.p1[1])
                .attr('x2', d => d.p2[0]).attr('y2', d => d.p2[1])
                .attr('stroke', '#f00').attr('stroke-width', 4)
                .attr('stroke-linecap', 'round').style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );
}

function drawBlockRidgeLines(block) {
    const layerName = 'ridge-water-system';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const ridgePathData = [];
    const hexOverlapScale = 1.01;

    blockGroup.selectAll('.rws-water-hex')
        .data(block.hexes.filter(d => d.properties.isWater), d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'rws-water-hex')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                .attr('fill', config.RIDGE_WATER_SYSTEM_COLORS.RIVER),
            update => update,
            exit => exit.remove()
        );

    block.hexes.forEach(sourceHex => {
        if (sourceHex.properties.ridgeFlow > 0 && !sourceHex.properties.isWater) {
            const upstreamHex = sourceHex.ridgeUpstreamIndex !== -1 ? hexes[sourceHex.ridgeUpstreamIndex] : null;
            let endPoint;
            if (upstreamHex) {
                endPoint = getSharedEdgeMidpoint(sourceHex, upstreamHex);
            } else {
                endPoint = [sourceHex.cx, sourceHex.cy];
            }
            if (!endPoint) return;
            const controlPoint = [sourceHex.cx, sourceHex.cy];
            const downstreamRidgeNeighbors = hexes.filter(h => h.ridgeUpstreamIndex === sourceHex.index);
            if (downstreamRidgeNeighbors.length === 0) {
                const startPoint = [sourceHex.cx, sourceHex.cy];
                const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                ridgePathData.push({ path: path, flow: sourceHex.properties.ridgeFlow });
            } else {
                downstreamRidgeNeighbors.forEach(downstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(sourceHex, downstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        ridgePathData.push({ path: path, flow: downstreamHex.properties.ridgeFlow });
                    }
                });
            }
        }
    });

    blockGroup.selectAll('.rws-ridge-segment')
        .data(ridgePathData)
        .join(
            enter => enter.append('path')
                .attr('class', 'rws-ridge-segment')
                .attr('d', d => d.path)
                .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIDGE)
                .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
                .attr('stroke-linecap', 'round')
                .style('fill', 'none'),
            update => update,
            exit => exit.remove()
        );
}

function drawBlockHexBorders(block) {
    const layerName = 'hex-border';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    if (blockGroup.empty()) return;

    const hexOverlapScale = 1.0; // Borders should be exact

    blockGroup.selectAll('.hex-border')
        .data(block.hexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'hex-border')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                .attr('fill', 'none')
                .attr('stroke', '#fff')
                .attr('stroke-width', 0.2)
                .style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );
}

/**
 * ミニマップ上のビューポート矩形を更新する関数
 * @param {d3.ZoomTransform} transform - 現在のズーム情報
 */
function updateMinimapViewport(transform) {
    if (!minimapViewport || !svg) return;

    // メインビューのサイズを取得
    const svgNode = svg.node();
    const svgWidth = svgNode.clientWidth;
    const svgHeight = svgNode.clientHeight;

    // 現在の表示範囲の左上と右下の座標を、メインマップの座標系で計算
    const [topLeftX, topLeftY] = transform.invert([0, 0]);
    const [bottomRightX, bottomRightY] = transform.invert([svgWidth, svgHeight]);

    // ミニマップ座標系に変換
    const minimapX = topLeftX * minimapScaleX;
    const minimapY = topLeftY * minimapScaleY;
    const minimapWidth = (bottomRightX - topLeftX) * minimapScaleX;
    const minimapHeight = (bottomRightY - topLeftY) * minimapScaleY;

    // ビューポート矩形の属性を更新
    minimapViewport
        .attr('x', minimapX)
        .attr('y', minimapY)
        .attr('width', minimapWidth)
        .attr('height', minimapHeight);
}

export async function setupUI(allHexes, roadPaths, addLogMessage, blockLoader) {
    blockLoaderRef = blockLoader; // Store reference
    // [FIX] WorldMapインスタンス(TypedArrayラッパー)が渡された場合、
    // UI側の描画関数が配列アクセス(hexes[i])を前提としているため、標準配列に変換する。
    // メモリ使用量は増えるが、UI操作の安定性を優先する。
    if (typeof allHexes.getHex === 'function') {
        const tempHexes = [];
        const count = allHexes.size || (allHexes.cols * allHexes.rows);
        for (let i = 0; i < count; i++) {
            // [FIX] .toObject()を使うと properties プロパティ(互換性用)が失われるため、
            // Hexインスタンスそのものを格納する。Hexインスタンスは軽量な参照オブジェクトなので問題ない。
            tempHexes.push(allHexes.getHex(i));
        }
        // [FIX] cols/rowsプロパティをコピーする (重要: これがないとconfig.COLSが使われて座標がずれる)
        tempHexes.cols = allHexes.cols;
        tempHexes.rows = allHexes.rows;

        allHexes = tempHexes;
        // console.log(`[UI Setup] Converted WorldMap to Array(${allHexes.length}) for compatibility.`);
    }

    allHexesData = allHexes;
    hexes = allHexes; // [FIX] hexesグローバル変数も更新する (drawBlockRidgeLinesなどで使用)
    roadPathsData = roadPaths;
    // --- 1. 初期設定とDOM要素の取得 ---
    // グローバル変数を使用するように変更
    svg = d3.select('#hexmap');
    const g = svg.append('g');

    // ここからミニマップ関連の初期化を追加
    minimapContainer = d3.select('body').append('div').attr('id', 'minimap-container');
    minimapSvg = minimapContainer.append('svg').attr('id', 'minimap-svg');

    // ツールチップ用コンテナの作成
    tooltipContainer = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('visibility', 'hidden')
        .style('background-color', '#000c')
        .style('color', '#fff')
        .style('padding', '5px')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('pointer-events', 'none') // マウスイベントを透過
        .style('white-space', 'pre-wrap') // 改行を有効化
        .style('z-index', '9999');

    // ミニマップ用の地形レイヤーを追加
    const minimapTerrain = minimapSvg.append('g').attr('id', 'minimap-terrain');

    // メインマップ全体のサイズを計算
    const mapCols = allHexes.cols || config.COLS;
    const mapRows = allHexes.rows || config.ROWS;
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;
    const mapTotalWidth = (mapCols * hexWidth * 3 / 4 + hexWidth / 4);
    const mapTotalHeight = (mapRows * hexHeight + hexHeight / 2);

    // スケールを設定 (マップ全体が200x200のSVGに収まるように)
    minimapScaleX = 200 / mapTotalWidth;
    minimapScaleY = 200 / mapTotalHeight;
    const scale = Math.min(minimapScaleX, minimapScaleY);

    // 初回描画
    updateMinimap(allHexes);

    // ビューポート矩形を初期状態で追加
    minimapViewport = minimapSvg.append('rect').attr('id', 'minimap-viewport');

    // ミニマップを初期状態で非表示（アイコン表示）にする
    minimapContainer.style('display', 'block').classed('hidden', true);

    // --- ミニマップの表示切り替え機能 ---
    // アイコン要素の作成
    const minimapIcon = d3.select('body').append('div')
        .attr('id', 'minimap-icon')
        .html('<span class="material-icons-round">map</span>')
        .style('display', 'flex'); // 初期状態で表示

    // 切り替え関数の定義
    const toggleMinimap = () => {
        const isHidden = minimapContainer.classed('hidden');
        if (isHidden) {
            // 表示する
            minimapContainer.classed('hidden', false);
            minimapIcon.style('display', 'none');
        } else {
            // 非表示にする（アイコン化）
            minimapContainer.classed('hidden', true);
            minimapIcon.style('display', 'flex');
        }
    };

    // イベントリスナーの登録
    minimapContainer.on('click', (event) => {
        event.stopPropagation(); // マップへのクリック伝播を防ぐ
        toggleMinimap();
    });

    minimapIcon.on('click', (event) => {
        event.stopPropagation();
        toggleMinimap();
    });

    const hexOverlapScale = 1.01; // 隙間を埋めるための拡大率を定義。1%拡大

    infoWindow = document.getElementById('info-window');
    infoContent = document.getElementById('info-window-content');
    const infoCloseBtn = document.getElementById('info-close-btn');
    const copyInfoBtn = document.getElementById('copy-info-btn');

    // infoWindowモジュールの初期化
    initInfoWindow(document.getElementById('legend-container'));
    setAllHexesData(allHexes);

    // --- 2. 描画用データの事前計算 ---
    hexes = []; // データをリセット (Use module-level variable)

    const iterRows = allHexes.rows || config.ROWS;
    const iterCols = allHexes.cols || config.COLS;
    for (let row = 0; row < iterRows; row++) {
        for (let col = 0; col < iterCols; col++) {
            const hexData = allHexes[getIndex(col, row)];
            if (!hexData) continue; // Skip if hex data is missing
            const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
            const cx = col * (hexWidth * 3 / 4) + config.r;
            const cy = row * hexHeight + offsetY + config.r;

            // レリーフ（陰影）計算のための南北標高差を取得
            let northElevation = hexData.properties.elevation;
            let southElevation = hexData.properties.elevation;
            if (row > 0) {
                const northNeighbor = allHexes[getIndex(col, row - 1)];
                if (northNeighbor) northElevation = northNeighbor.properties.elevation;
            }
            if (row < config.ROWS - 1) {
                const southNeighbor = allHexes[getIndex(col, row + 1)];
                if (southNeighbor) southElevation = southNeighbor.properties.elevation;
            }
            const elevationDifference = southElevation - northElevation;

            // 河川の流下方向を取得 (生成器で計算済みの値を使用)
            let downstreamIndex = hexData.downstreamIndex;

            // 保存されたデータがある場合はそれを優先し、再計算しない
            // 未設定の場合のみ再計算 (互換性のため)
            if ((downstreamIndex === undefined || downstreamIndex === -1) && hexData.properties.flow > 0 && !hexData.properties.isWater) {
                // [WARN] 保存されたdownstreamIndexがないため、簡易ロジックで再計算します。
                // 1. 既存の川（flow > current.flow）への合流を優先
                let bestNeighbor = null;
                let maxFlow = hexData.properties.flow; // 自分より大きい流量を探す

                hexData.neighbors.map(i => allHexes[i]).forEach(n => {
                    // 自分より流量が大きく、かつ標高が低い（または同じ）場所へ
                    // ※水域(isWater)も合流先として有効
                    if ((n.properties.flow > maxFlow || n.properties.isWater) && n.properties.elevation <= hexData.properties.elevation) {
                        // 流量が最大のものを優先したいが、ここでは最初に見つけた「より大きな川」を採用するだけでも効果あり
                        // より厳密には、候補の中で最も標高が低い、あるいは流量が大きいものを選ぶべき
                        if (!bestNeighbor || n.properties.flow > bestNeighbor.properties.flow) {
                            bestNeighbor = n;
                            maxFlow = n.properties.flow;
                        }
                    }
                });

                // 2. 見つからなければ、最も低い場所へ (従来のロジック)
                if (!bestNeighbor) {
                    let minElevation = hexData.properties.elevation;
                    hexData.neighbors.map(i => allHexes[i]).forEach(n => {
                        if (n.properties.elevation < minElevation) {
                            minElevation = n.properties.elevation;
                            bestNeighbor = n;
                        }
                    });
                }

                if (bestNeighbor) {
                    downstreamIndex = getIndex(bestNeighbor.col, bestNeighbor.row);
                    // メモリ上のデータも更新しておく
                    hexData.downstreamIndex = downstreamIndex;
                }
            }

            // 稜線の流れを取得 (生成器で計算済みの値を使用)
            let ridgeUpstreamIndex = hexData.ridgeUpstreamIndex;
            // 未設定の場合のみ再計算
            if ((ridgeUpstreamIndex === undefined || ridgeUpstreamIndex === -1) && hexData.properties.ridgeFlow > 0 && !hexData.properties.isWater) {
                let highestNeighbor = null;
                let maxElevation = hexData.properties.elevation;
                // 隣接ヘックスの中から、自身より標高が最も高いものを探す
                hexData.neighbors.map(i => allHexes[i]).forEach(n => {
                    if (n.properties.elevation > maxElevation) {
                        maxElevation = n.properties.elevation;
                        highestNeighbor = n;
                    }
                });
                // 見つかった場合、そのインデックスを保存
                if (highestNeighbor) {
                    ridgeUpstreamIndex = getIndex(highestNeighbor.col, highestNeighbor.row);
                }
            }

            // 最終的な描画用オブジェクトを配列に追加
            hexes.push({
                index: getIndex(col, row),
                x: col, y: (config.ROWS - 1) - row,
                cx: cx, cy: cy,
                points: d3.range(6).map(i => [cx + config.r * Math.cos(Math.PI / 3 * i), cy + config.r * Math.sin(Math.PI / 3 * i)]),
                properties: { ...hexData.toObject(), shadingValue: elevationDifference },
                downstreamIndex: downstreamIndex,
                ridgeUpstreamIndex: ridgeUpstreamIndex,
                neighbors: hexData.neighbors,
                upstreamIndex: -1 // 初期化
            });
        }
    }

    // upstreamIndex (河川の上流) を設定
    hexes.forEach(h => {
        if (h.downstreamIndex !== -1 && hexes[h.downstreamIndex]) {
            // 下流のヘックスに、自身を上流として登録
            // 複数の上流がある場合、最後の一つが上書きされる（描画ロジックが単一上流を前提としているため）
            hexes[h.downstreamIndex].upstreamIndex = h.index;
        }
    });

    updateChildrenMap(allHexes);

    // --- 3. レイヤー管理のセットアップ ---
    function createLayer(name, visibleByDefault = true) {
        const layerGroup = g.append('g').attr('class', `${name}-layer`);
        layers[name] = { group: layerGroup, visible: visibleByDefault };
        if (!visibleByDefault) {
            layerGroup.style('display', 'none');
        }
        return layerGroup;
    }

    // ----- [描画順序: 奥] -----
    const terrainLayer = createLayer('terrain');                                // 基本地形 (標高)
    const whiteMapOverlayLayer = createLayer('white-map-overlay', false);       // 白地図
    const vegetationOverlayLayer = createLayer('vegetation-overlay', true);     // 植生 (森林、砂漠など)
    const beachLayer = createLayer('beach', true);                              // 砂浜
    const snowLayer = createLayer('snow', true);                                // 積雪
    const riverLayer = createLayer('river');                                    // 河川
    const shadingLayer = createLayer('shading');                                // レリーフ (陰影)
    const contourLayer = createLayer('contour', true);                          // 等高線
    const ridgeWaterSystemLayer = createLayer('ridge-water-system', false);     // 稜線・水系図

    const territoryOverlayLayer = createLayer('territory-overlay', false);      // 領地
    const hexBorderLayer = createLayer('hex-border', false);                    // ヘックスの境界線 (デフォルトOFF)
    const roadLayer = createLayer('road');                                      // 道路網
    const seaRouteLayer = createLayer('sea-route');                             // 海路
    const borderLayer = createLayer('border');                                  // 国境線
    const highlightOverlayLayer = createLayer('highlight-overlay');             // クリック時のハイライト
    const settlementLayer = createLayer('settlement');                          // 集落シンボル
    // const cursorHighlightLayer = createLayer('cursor-highlight-overlay');       // カーソルホバー時のハイライト (白枠)
    // --- 情報オーバーレイ ---
    const monsterOverlayLayer = createLayer('monster-overlay', false);          // 魔物分布
    const populationOverlayLayer = createLayer('population-overlay', false);    // 人口分布
    const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false); // 気候帯
    const tempOverlayLayer = createLayer('temp-overlay', false);                // 気温
    const precipOverlayLayer = createLayer('precip-overlay', false);            // 降水量
    const manaOverlayLayer = createLayer('mana-overlay', false);                // 魔力 (龍脈)
    const agriOverlayLayer = createLayer('agri-overlay', false);                // 農業適性
    const forestOverlayLayer = createLayer('forest-overlay', false);            // 林業適性
    const miningOverlayLayer = createLayer('mining-overlay', false);            // 鉱業適性
    const fishingOverlayLayer = createLayer('fishing-overlay', false);          // 漁業適性
    const huntingOverlayLayer = createLayer('hunting-overlay', false);          // 狩猟適性
    const pastoralOverlayLayer = createLayer('pastoral-overlay', false);        // 牧畜適性
    const livestockOverlayLayer = createLayer('livestock-overlay', false);      // 家畜適性
    // --- UI操作用 ---
    const labelLayer = createLayer('labels');                                   // ラベル (集落名など)
    const interactionLayer = createLayer('interaction');                        // クリックイベントを受け取る透明レイヤー
    interactionLayer.style('pointer-events', 'none'); // グループ自体はイベントを透過
    // ----- [描画順序: 手前] -----

    // ブロック分割の初期化 (レイヤー作成後に実行する必要がある)
    initializeBlocks();

    // レイヤー作成後に全ヘックスの色を計算 (layersオブジェクトが参照可能な状態で実行)
    updateAllHexColors();

    // --- 4. 静的なレイヤーの描画 (初回のみ) ---

    // ヘックスに依存せず、ズーム中に再描画する必要がないレイヤーをここで描画

    // 4f. 国境線 (初回描画)
    // drawBorders();

    // drawBeaches(hexes);

    // 4g. 等高線
    // ブロックレンダリングに移行したため、ここでの一括描画は廃止
    // await addLogMessage("等高線の補間計算を開始します...");
    // await drawContours(hexes);

    // 4h. 河川と稜線 (初回描画)
    // drawRivers(hexes); // 初回は全ヘックスで描画（または空で呼んでupdateVisibleHexesに任せる）
    // drawRidges(hexes);

    // 4i. 道路網 (初回描画)
    // drawRoads(roadPaths);

    // --- 5. 情報ウィンドウとインタラクション ---


    // パフォーマンス向上のため、ズーム操作中のレイヤー表示を制御する
    const zoom = d3.zoom()
        .scaleExtent([0.2, 10])
        .on('start', () => {
            // ズーム開始時に負荷の高いレイヤーを非表示にする処理
            svg.style('cursor', 'grabbing');
            Object.entries(layers).forEach(([name, layer]) => {
                // 基本地図、インタラクション、ハイライト用のレイヤーは常に表示しておく
                const isEssential = ['terrain', 'white-map-overlay', 'interaction', 'highlight-overlay'].includes(name);
                if (!isEssential && layer.visible) {
                    layer.group.style('display', 'none');
                }
            });
        })
        .on('zoom', (event) => {
            // ズーム中は全体の変形のみ適用
            g.attr('transform', event.transform);
            // 現在のズーム状態を保存
            currentTransform = event.transform;
            updateMinimapViewport(event.transform);
        })
        .on('end', (event) => {
            // ズーム終了時に、もともと表示すべきレイヤーを再表示する
            Object.entries(layers).forEach(([name, layer]) => {
                if (layer.visible) {
                    // 合成レイヤーの場合は、terrainレイヤー以外は非表示のままにする
                    // (ただし、toggleLayerVisibilityで制御されているため、ここでは単純にvisibleフラグに従って表示すれば良い)
                    // terrainレイヤーは常に表示（合成色で描画されるため）
                    layer.group.style('display', 'inline');
                }
            });

            // 最後に、スクリーン内の要素のみを再描画する
            updateVisibleBlocks(event.transform);
            svg.style('cursor', 'grab');
        });

    svg.call(zoom);

    const closeInfoWindowAndHighlight = () => {
        infoWindow.classList.add('hidden');
        adjustSidebarHeight();
        highlightOverlayLayer.selectAll('*').remove();
    };
    infoCloseBtn.addEventListener('click', closeInfoWindowAndHighlight);
    svg.on('click', closeInfoWindowAndHighlight);

    if (copyInfoBtn) {
        copyInfoBtn.addEventListener('click', () => {
            if (currentSelectedHex) {
                const jsonStr = generateHexJson(currentSelectedHex);
                navigator.clipboard.writeText(jsonStr).then(() => {
                    alert('JSONをクリップボードにコピーしました。');
                }).catch(err => {
                    console.error('コピーに失敗しました:', err);
                    alert('コピーに失敗しました。');
                });
            }
        });
    }

    // --- 6. UIイベントハンドラの設定 ---

    // レイヤー状態記憶用オブジェクト
    const mapTypeLayerStates = {
        terrain: {
            'vegetation-overlay': true,
            'shading': true,
            'contour': true,
            'settlement': true,
            'road': true,
            'territory-overlay': false,
            'hex-border': false
        },
        white: {
            'vegetation-overlay': false,
            'shading': false,
            'contour': false,
            'settlement': true,
            'road': true,
            'territory-overlay': true,
            'hex-border': false
        }
    };

    // 初期状態の適用（地形図）
    // setupUIの最後の方で実行されるが、ここでは初期化として定義
    // 実際にはtoggleLayerVisibilityで制御されるため、初期ロード時はHTMLのclass="active"等に依存する部分もあるが、
    // ここで明示的に設定することも可能。ただし、setupUI内での初期化順序に注意。

    // 6a. 基本地図の切り替え
    d3.selectAll('input[name="map-type"]').on('change', function () {
        const selectedType = d3.select(this).property('value');
        const prevType = selectedType === 'white' ? 'terrain' : 'white';
        const isWhiteMap = selectedType === 'white';

        // 1. 現在の状態を保存 (前のタイプに対して)
        Object.keys(mapTypeLayerStates[prevType]).forEach(layerName => {
            if (layers[layerName]) {
                mapTypeLayerStates[prevType][layerName] = layers[layerName].visible;
            }
        });

        // 2. 新しい状態をロード
        Object.keys(mapTypeLayerStates[selectedType]).forEach(layerName => {
            const shouldBeVisible = mapTypeLayerStates[selectedType][layerName];
            if (layers[layerName]) {
                // toggleLayerVisibilityを使うとトグルしてしまうので、直接制御するか、
                // 現在の状態と比較して必要な場合のみトグルする
                if (layers[layerName].visible !== shouldBeVisible) {
                    // toggleLayerVisibilityはボタンの状態も更新してくれるので便利
                    // ただし、ボタン要素を特定する必要がある
                    // buttonMappingはtoggleLayerVisibility内に隠蔽されているので、
                    // ここでは直接レイヤーとボタンを操作するヘルパーを使うか、
                    // toggleLayerVisibilityをうまく使う。

                    // toggleLayerVisibilityを呼ぶために、対応するショートカットボタンを取得してクリックイベントを発火させるのが手っ取り早いが、
                    // 無限ループや予期せぬ副作用を防ぐため、内部ロジックで処理する。

                    layers[layerName].visible = shouldBeVisible;
                    layers[layerName].group.style('display', shouldBeVisible ? 'inline' : 'none');

                    // ボタンの同期
                    // toggleLayerVisibility内のロジックを再利用したいが、スコープ外。
                    // ここで再実装する。
                    const buttonMapping = {
                        'vegetation-overlay': { sidebar: '#toggleVegetationLayer', shortcut: '#shortcut-vegetation' },
                        'shading': { sidebar: '#toggleReliefLayer', shortcut: '#shortcut-relief' },
                        'contour': { sidebar: '#toggleContourLayer', shortcut: '#shortcut-contour' },
                        'settlement': { sidebar: '#toggleSettlementLayer', shortcut: '#shortcut-settlement' },
                        'road': { sidebar: '#toggleRoadLayer', shortcut: '#shortcut-road' },
                        'territory-overlay': { sidebar: '#toggleTerritoryLayer', shortcut: '#shortcut-territory' },
                        'hex-border': { sidebar: '#toggleHexBorderLayer', shortcut: '#shortcut-hex-border' }
                    };
                    const mapping = buttonMapping[layerName];
                    if (mapping) {
                        const sidebarBtn = document.querySelector(mapping.sidebar);
                        const shortcutBtn = document.querySelector(mapping.shortcut);
                        if (sidebarBtn) sidebarBtn.classList.toggle('active', shouldBeVisible);
                        if (shortcutBtn) shortcutBtn.classList.toggle('active', shouldBeVisible);
                    }

                    // 連動レイヤーの処理 (toggleLayerVisibilityから抜粋・簡略化)
                    if (layerName === 'vegetation-overlay') {
                        const beachLayer = layers['beach'];
                        if (beachLayer) {
                            beachLayer.visible = shouldBeVisible;
                            beachLayer.group.style('display', shouldBeVisible ? 'inline' : 'none');
                        }
                        // 積雪も連動
                        const snowLayer = layers['snow'];
                        if (snowLayer) {
                            snowLayer.visible = shouldBeVisible;
                            snowLayer.group.style('display', shouldBeVisible ? 'inline' : 'none');
                        }
                    } else if (layerName === 'road') {
                        const seaRouteLayer = layers['sea-route'];
                        if (seaRouteLayer) {
                            seaRouteLayer.visible = shouldBeVisible;
                            seaRouteLayer.group.style('display', shouldBeVisible ? 'inline' : 'none');
                        }
                    } else if (layerName === 'settlement') {
                        layers.labels.group.selectAll('.settlement-label')
                            .style('display', shouldBeVisible ? 'inline' : 'none');
                        layers.border.visible = shouldBeVisible;
                        layers.border.group.style('display', shouldBeVisible ? 'inline' : 'none');
                    }
                }
            }
        });

        // 合成レイヤー方式では、terrainレイヤーの表示/非表示を切り替える必要はない
        // 代わりに色を再計算する
        updateAllHexColors();

        // 河川の色を変更 (ブロック内のパスも対象にするため、クラス指定ではなく全パスを対象にするか、再描画時に色を適用する必要がある)
        // ここでは既存のDOM要素の色を変更する
        updateRiverColor();
        // layers.beach.group.style('display', isWhiteMap ? 'none' : 'inline'); // 植生連動に変更されたため削除
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });

    // 6b. レイヤーカテゴリのボタン
    // 植生ボタンの処理を、他のボタンと統一する
    d3.select('#toggleVegetationLayer').on('click', function () {
        // 植生と積雪は連動させる
        toggleLayerVisibility('vegetation-overlay', this);
        toggleLayerVisibility('snow', this);
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });

    d3.select('#toggleSettlementLayer').on('click', function () {
        toggleLayerVisibility('settlement', this);
        const isVisible = layers.settlement.visible;
        layers.border.visible = isVisible;
        layers.border.group.style('display', isVisible ? 'inline' : 'none'); // 国境線は静的なので直接操作
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });

    d3.select('#toggleHexBorderLayer').on('click', function () {
        toggleLayerVisibility('hex-border', this);
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });
    d3.select('#toggleReliefLayer').on('click', function () {
        toggleLayerVisibility('shading', this);
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });
    d3.select('#toggleContourLayer').on('click', function () {
        toggleLayerVisibility('contour', this);
        // 等高線は静的レイヤーなので直接表示を切り替えるだけで良い
    });
    d3.select('#toggleRoadLayer').on('click', function () {
        toggleLayerVisibility('road', this);
        // 道路網は静的レイヤーなので直接表示を切り替えるだけで良い
    });
    d3.select('#toggleTerritoryLayer').on('click', function () {
        toggleLayerVisibility('territory-overlay', this);
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
    });
    // 河川の色を更新するヘルパー関数
    function updateRiverColor() {
        const isRidgeWaterSystemVisible = layers['ridge-water-system'] && layers['ridge-water-system'].visible;
        const isWhiteMap = d3.select('input[name="map-type"]:checked').property('value') === 'white';

        let riverColor;
        if (isRidgeWaterSystemVisible) {
            riverColor = config.RIDGE_WATER_SYSTEM_COLORS.RIVER; // 青色
        } else if (isWhiteMap) {
            riverColor = config.WHITE_MAP_COLORS.WATER; // グレー
        } else {
            riverColor = config.TERRAIN_COLORS.河川; // 通常色
        }

        if (layers.river) {
            layers.river.group.selectAll('path').attr('stroke', riverColor);
        }
    }

    d3.select('#toggleRidgeWaterSystemLayer').on('click', function () {
        toggleLayerVisibility('ridge-water-system', this);
        updateRiverColor(); // 色を更新
        // 稜線水系図は静的レイヤーなので直接表示を切り替えるだけで良い
    });

    // 6c. 地理情報カテゴリのボタン
    // 地理情報ボタンの排他的な動作を実装
    const geoInfoButtons = {
        '#toggleTempLayer': 'temp-overlay',
        '#togglePrecipLayer': 'precip-overlay',
        '#toggleClimateZoneLayer': 'climate-zone-overlay',
        '#togglePopulationLayer': 'population-overlay',
        '#toggleMonsterLayer': 'monster-overlay'
    };

    const geoInfoButtonSelectors = Object.keys(geoInfoButtons);

    geoInfoButtonSelectors.forEach(selector => {
        d3.select(selector).on('click', function () {
            const clickedButton = this;
            const targetLayerName = geoInfoButtons[selector];
            const isDisabling = clickedButton.classList.contains('active');

            // 最初に、すべての地理情報ボタンとレイヤーを非アクティブ/非表示にする
            geoInfoButtonSelectors.forEach(s => {
                const btn = d3.select(s).node();
                const layerName = geoInfoButtons[s];
                if (layers[layerName]) {
                    layers[layerName].visible = false;
                    layers[layerName].group.style('display', 'none');
                    btn.classList.remove('active');
                }
            });

            updateLegend(null);

            // もし非アクティブ化（トグルオフ）でなければ、クリックされたものを再度有効化する
            if (!isDisabling) {
                if (layers[targetLayerName]) {
                    layers[targetLayerName].visible = true;
                    layers[targetLayerName].group.style('display', 'inline');
                    clickedButton.classList.add('active');
                    updateLegend(targetLayerName);
                }
            }
            // レイヤーの可視状態が変わったので、色を再計算する
            updateAllHexColors();
            updateVisibleBlocks(d3.zoomTransform(svg.node()));
        });
    });

    // 6d. 資源カテゴリのボタン
    const resourceButtons = ['#toggleManaLayer', '#toggleAgriLayer', '#toggleForestLayer', '#toggleMiningLayer', '#toggleFishingLayer', '#toggleHuntingLayer', '#togglePastoralLayer', '#toggleLivestockLayer'];
    resourceButtons.forEach(selector => {
        d3.select(selector).on('click', function () {
            const layerName = selector.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
            toggleLayerVisibility(layerName, this);
            // 変更を即時反映するために描画関数を呼び出す
            updateVisibleBlocks(d3.zoomTransform(svg.node()));
        });
    });

    // 6e. ショートカットバーのボタン
    const shortcutMapping = [
        { id: '#shortcut-vegetation', layer: 'vegetation-overlay' },
        { id: '#shortcut-relief', layer: 'shading' },
        { id: '#shortcut-contour', layer: 'contour' },
        { id: '#shortcut-settlement', layer: 'settlement' },
        { id: '#shortcut-road', layer: 'road' },
        { id: '#shortcut-territory', layer: 'territory-overlay' },
        { id: '#shortcut-hex-border', layer: 'hex-border' }
    ];

    shortcutMapping.forEach(item => {
        d3.select(item.id).on('click', function () {
            toggleLayerVisibility(item.layer, this);
            // 国境線はsettlementと連動するので特別扱い
            if (item.layer === 'settlement') {
                const isVisible = layers.settlement.visible;
                layers.border.visible = isVisible;
                layers.border.group.style('display', isVisible ? 'inline' : 'none');
            }
            // 植生の場合は積雪も連動
            if (item.layer === 'vegetation-overlay') {
                toggleLayerVisibility('snow', this);
            }
            updateVisibleBlocks(d3.zoomTransform(svg.node()));
        });
    });

    // 基本地図切り替えショートカット
    d3.select('#shortcut-map-type').on('click', function () {
        const currentType = d3.select('input[name="map-type"]:checked').property('value');
        const newType = currentType === 'terrain' ? 'white' : 'terrain';

        // ラジオボタンを更新
        d3.select(`input[name="map-type"][value="${newType}"]`).property('checked', true).dispatch('change');
    });


    // --- 7. 初期ズーム位置の設定 ---
    // 画面中央に表示するための座標計算
    // SVGのサイズが取得できない場合（非表示状態など）はwindowサイズをフォールバックとして使用
    const svgNode = svg.node();
    let svgWidth = svgNode.clientWidth || svgNode.getBoundingClientRect().width;
    let svgHeight = svgNode.clientHeight || svgNode.getBoundingClientRect().height;

    if (svgWidth === 0 || svgHeight === 0) {
        console.warn('SVG dimensions are 0, using window dimensions as fallback.');
        svgWidth = window.innerWidth;
        svgHeight = window.innerHeight;
    }

    const targetHex = hexes.find(h => h.x === 56 && h.y === 49);

    if (targetHex) {
        console.log(`Setting initial zoom to hex: [${targetHex.x}, ${targetHex.y}] (${targetHex.cx}, ${targetHex.cy})`);

        const initialScale = 3.0;
        const initialTransform = d3.zoomIdentity
            .translate(svgWidth / 2 - targetHex.cx * initialScale, svgHeight / 2 - targetHex.cy * initialScale)
            .scale(initialScale);

        // D3にtransformを適用させる
        // 注意: call(zoom.transform) は 'zoom' イベントを発火させる
        svg.call(zoom.transform, initialTransform);

        // 適用されたtransformを基に、初回の表示要素を描画する
        // updateVisibleBlocksはzoomイベントハンドラからも呼ばれるが、確実に行うためにここでも呼ぶ
        // (イベント発火が非同期の場合があるため)
        updateVisibleBlocks(initialTransform);
        updateOverallInfo(allHexes);
    } else {
        console.warn('Target hex for initial zoom not found. Using default transform.');
        // フォールバックとして、現在のtransformで初回描画
        updateVisibleBlocks(d3.zoomTransform(svgNode));
        updateOverallInfo(allHexes);
    }
}

/**
 * 気候・植生情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
/**
 * ブロックのレンダリング状態をリセットする関数
 * データ更新時に呼び出し、次回の可視判定時に再描画をトリガーする
 */
function resetBlockRenderStatus() {
    blocks.forEach(block => {
        block.rendered = false;
    });
}

/**
 * 内部の描画用ヘックスデータを更新するヘルパー関数
 * @param {Array<object>} updatedAllHexes - 更新された全ヘックスデータ
 */
function updateHexesData(updatedAllHexes) {
    if (!hexes || hexes.length === 0) return;

    // ヘルパー関数を内部に定義
    function calculateShading(hexData, allHexes) {
        let northElevation = hexData.properties.elevation;
        let southElevation = hexData.properties.elevation;
        if (hexData.row > 0) {
            const northNeighbor = allHexes[getIndex(hexData.col, hexData.row - 1)];
            if (northNeighbor) northElevation = northNeighbor.properties.elevation;
        }
        if (hexData.row < config.ROWS - 1) {
            const southNeighbor = allHexes[getIndex(hexData.col, hexData.row + 1)];
            if (southNeighbor) southElevation = southNeighbor.properties.elevation;
        }
        return southElevation - northElevation;
    }

    let updatedCount = 0;
    let flowCount = 0;

    updatedAllHexes.forEach((h, index) => {
        if (hexes[index]) {
            // プロパティをマージするのではなく、完全に上書きする
            // これにより、roadGeneratorで変更された nationId が確実に反映される
            hexes[index].properties = h.properties;

            // 河川・稜線の流下インデックスも更新する (重要: これがないと再生成後に河川が描画されない)
            hexes[index].downstreamIndex = h.downstreamIndex;
            hexes[index].ridgeUpstreamIndex = h.ridgeUpstreamIndex;

            // 描画用のシェーディング値のみ、追加で計算する
            if (typeof h.toObject === 'function') {
                hexes[index].properties = { ...h.toObject(), shadingValue: calculateShading(h, updatedAllHexes) };
            } else {
                hexes[index].properties = { ...h.properties, shadingValue: calculateShading(h, updatedAllHexes) };
            }

            updatedCount++;
            if (h.properties.flow > 0) flowCount++;

        }
    });
    console.log(`updateHexesData: Updated ${updatedCount} hexes. Flow > 0 count: ${flowCount}`);
}

/**
 * 気候・植生情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
export async function redrawClimate(allHexes) {
    updateHexesData(allHexes);
    updateAllHexColors(); // 色を再計算

    resetBlockRenderStatus(); // ブロック再描画をスケジュール

    // updateVisibleBlocksを呼び出して、表示を更新する
    if (svg) updateVisibleBlocks(currentTransform);
    // ミニマップも更新
    updateMinimap(allHexes);
    console.log("気候・植生が更新され、再描画されました。");
}

/**
 * 集落情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
export async function redrawSettlements(allHexes) {
    updateHexesData(allHexes);
    setAllHexesData(allHexes); // infoWindow側のデータも更新
    updateChildrenMap(allHexes);
    updateOverallInfo(allHexes);
    updateAllHexColors(); // 色を再計算

    resetBlockRenderStatus(); // ブロック再描画をスケジュール

    // updateVisibleBlocksを呼び出して、表示を更新する
    if (svg) updateVisibleBlocks(currentTransform);
    // ミニマップも更新
    updateMinimap(allHexes);
    console.log("集落が更新され、再描画されました。");
}

/**
 * 道路・国家情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 * @param {Array<object>} roadPaths - 更新された道路データ
 */
export async function redrawRoadsAndNations(allHexes, roadPaths) {
    updateHexesData(allHexes);
    setAllHexesData(allHexes); // infoWindow側のデータも更新
    updateChildrenMap(allHexes);
    updateOverallInfo(allHexes);
    updateAllHexColors(); // 色を再計算

    // 静的レイヤーの再描画は renderBlock で行われるため、ここではリセットのみ
    resetBlockRenderStatus();

    // updateVisibleBlocksを呼び出して、表示を更新する
    if (svg) updateVisibleBlocks(currentTransform);
    // ミニマップも更新
    updateMinimap(allHexes);
    console.log("道路・国家が更新され、再描画されました。");
}

/**
 * 汎用的な再描画関数 (大陸生成中などに使用)
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
export async function redrawMap(allHexes) {
    updateHexesData(allHexes);
    updateAllHexColors();

    resetBlockRenderStatus();

    if (svg) updateVisibleBlocks(currentTransform);
    // ミニマップも更新
    updateMinimap(allHexes);
}

/**
 * UIの状態をリセットする関数
 */
export function resetUI() {
    if (minimapContainer) {
        minimapContainer.remove(); // 古いミニマップを削除
        minimapContainer = null;
    }
    d3.select('#minimap-icon').remove(); // アイコンも削除
}

/**
 * ミニマップを更新する関数
 * @param {Array<object>} allHexes - 全ヘックスデータ
 */
export function updateMinimap(allHexes) {
    if (!minimapSvg) return;

    const minimapTerrain = minimapSvg.select('#minimap-terrain');
    if (minimapTerrain.empty()) return;

    // メインマップ全体のサイズを計算 (setupUIと同様)
    const mapCols = allHexes.cols || config.COLS;
    const mapRows = allHexes.rows || config.ROWS;
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;
    const mapTotalWidth = (mapCols * hexWidth * 3 / 4 + hexWidth / 4);
    const mapTotalHeight = (mapRows * hexHeight + hexHeight / 2);

    // スケールを設定 (マップ全体が200x200のSVGに収まるように)
    const scale = Math.min(200 / mapTotalWidth, 200 / mapTotalHeight);

    const minimapData = Array.isArray(allHexes) ? allHexes : Array.from(allHexes);
    console.log(`[Minimap] Updating minimap for ${minimapData.length} hexes. Scale: ${scale}. Container present: ${!minimapTerrain.empty()}`);
    // [DEBUG] Inspect first 3 hexes
    for (let i = 0; i < 3; i++) {
        const d = minimapData[i];
        console.log(`[Minimap Debug] Hex[${i}] (x:${d.col},y:${d.row}): isWater=${d.properties.isWater}, elev=${d.properties.elevation}, veg=${d.properties.vegetation}, color=${d.properties.isWater ? '#004' : '#444'}`);
    }

    minimapTerrain.selectAll('.minimap-hex')
        .data(minimapData)
        .join(
            enter => enter.append('rect')
                .attr('class', 'minimap-hex')
                .attr('x', d => (d.cx || (d.col * (hexWidth * 3 / 4))) * scale)
                .attr('y', d => (d.cy || (d.row * hexHeight + (d.col % 2 === 0 ? 0 : hexHeight / 2))) * scale)
                .attr('width', hexWidth * scale)
                .attr('height', hexHeight * scale),
            update => update,
            exit => exit.remove()
        )
        // 色については更新時も再評価する
        .attr('fill', d => {
            if (d.properties.isWater) return '#004'; // 海洋
            if (d.properties.settlement === '首都') return '#f0f'; // 首都
            if (d.properties.settlement === '都市' || d.properties.settlement === '領都') return '#f00f'; // 領都
            if (d.properties.settlement === '街') return '#f80f'; // 街
            if (d.properties.settlement === '町') return '#ff0f'; // 町
            if (d.properties.settlement === '村') return '#0f0f'; // 村
            if (d.properties.elevation >= 4000) return '#000'; // 山岳
            if (d.properties.elevation >= 3000) return '#111'; // 山岳
            if (d.properties.elevation >= 2000) return '#222'; // 山岳
            if (d.properties.elevation >= 1000) return '#333'; // 山岳
            return '#444'; // 平地・森林
        });
    console.log("[Minimap] Update complete.");
}
