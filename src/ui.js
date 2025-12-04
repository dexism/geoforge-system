// ================================================================
// GeoForge System - UIモジュール (v1.8.7 - 可読性最優先 最終版)
// ================================================================
// このスクリプトは、生成された世界データを基にD3.jsを用いてインタラクティブな
// ヘックスマップを描画し、サイドバーからのレイヤー操作や情報表示ウィンドウの
// 機能を提供します。
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, formatProgressBar, formatLocation, getSharedEdgePoints, getSharedEdgeMidpoint } from './utils.js';
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

// ブロック分割レンダリング用定数・変数
const BLOCK_COLS = 5;
const BLOCK_ROWS = 5;
let blocks = [];

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
    if (!hexes) return;
    // console.time('updateAllHexColors');
    hexes.forEach(d => {
        d._displayColor = calculateCompositeColor(d);
    });

    // 既存のDOM要素の色も更新する
    if (blocks && blocks.length > 0) {
        blocks.forEach(block => {
            if (block.rendered) {
                const blockGroup = layers['terrain'].group.select(`#terrain-${block.id}`);
                if (!blockGroup.empty()) {
                    blockGroup.selectAll('.hex')
                        .attr('fill', d => d._displayColor || '#000');
                }
            }
        });
    }
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
            const controlPoint = [currentHex.cx, currentHex.cy];
            if (!startPoint || !endPoint || (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])) continue;
            const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
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
            6: 8.0,
            5: 6.0,
            4: 4.0,
            3: 2.0,
            2: 1.0,
            1: 1.0
        }[d.level] || 1))
        .attr('stroke-dasharray', d => ({
            6: '8, 8',
            5: '6, 6',
            4: '4, 4',
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

            // 制御点は現在のヘックスの中心
            const controlPoint = [currentHex.cx, currentHex.cy];

            // 二次ベジェ曲線のパス文字列を生成
            const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;

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
                riverPathData.push({ path: path, flow: d.properties.flow });
            } else { // 中流の場合
                upstreamNeighbors.forEach(upstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        riverPathData.push({ path: path, flow: upstreamHex.properties.flow });
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
        .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
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
                    weightedSum = h.properties.elevation;
                    totalWeight = 1;
                    exactMatch = true;
                    break;
                }
                const weight = 1.0 / distSq;
                totalWeight += weight;
                // 湖沼も実際の標高を使用する
                weightedSum += weight * h.properties.elevation;
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

            const block = {
                id: `${bx}-${by}`,
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
    console.log("updateVisibleBlocks: Called", transform);
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
    console.log(`updateVisibleBlocks: ${visibleBlocks.length} blocks visible out of ${blocks.length}`);

    blocks.forEach(block => {
        // ブロックがビューポートと交差しているか判定
        const isVisible = (
            block.bounds.xMin < viewBounds.xMax &&
            block.bounds.xMax > viewBounds.xMin &&
            block.bounds.yMin < viewBounds.yMax &&
            block.bounds.yMax > viewBounds.yMin
        );

        block.visible = isVisible;

        // レイヤーごとの表示切り替え
        const partitionedLayers = [
            'terrain', 'settlement', 'hex-border', 'labels',
            'road', 'sea-route', 'river', 'beach', 'ridge-water-system', 'contour', 'interaction', 'border',
            'white-map-overlay', 'vegetation-overlay', 'snow', 'shading', 'territory-overlay',
            'climate-zone-overlay', 'temp-overlay', 'precip-overlay', 'mana-overlay',
            'agri-overlay', 'forest-overlay', 'mining-overlay', 'fishing-overlay',
            'hunting-overlay', 'pastoral-overlay', 'livestock-overlay', 'monster-overlay', 'population-overlay'
        ];

        if (isVisible) {
            // 表示: まだレンダリングされていなければ描画
            if (!block.rendered) {
                console.log(`Triggering renderBlock for ${block.id}`);
                renderBlock(block);
                block.rendered = true;
            }
            // 各レイヤーのグループを表示
            partitionedLayers.forEach(layerName => {
                if (layers[layerName]) {
                    layers[layerName].group.select(`#${layerName}-${block.id}`).style('display', 'inline');
                }
            });
        } else {
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
    console.log(`renderBlock: Rendering block ${block.id}`);
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
    const settlementType = (p.settlement || '未開地').padEnd(2, '　');
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
                        tooltipContainer
                            .style('top', (event.pageY - 10) + 'px')
                            .style('left', (event.pageX + 10) + 'px');
                    }
                })
                    .on('mouseover', (event, d) => {
                        if (window.innerWidth <= 600) return; // スマホでは表示しない
                        if (d) {
                            tooltipContainer.text(getTooltipText(d));
                            tooltipContainer.style('visibility', 'visible');
                        }
                    })
                    .on('mouseout', () => {
                        tooltipContainer.style('visibility', 'hidden');
                    });

                newHexes.on('click', (event, d) => {
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
                                        const controlPoint = [currentHex.cx, currentHex.cy];

                                        if (!startPoint || !endPoint || (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])) continue;

                                        const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
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
                                const controlPoint = [currentHex.cx, currentHex.cy];
                                const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
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
                        infoContent.innerHTML = getInfoText(d);
                        infoWindow.classList.remove('hidden');
                        adjustSidebarHeight();
                    }

                    // コピーボタンのイベントリスナーを設定
                    const copyBtn = document.getElementById('copy-info-json-btn');
                    if (copyBtn) {
                        copyBtn.addEventListener('click', () => {
                            const jsonStr = generateHexJson(d);
                            navigator.clipboard.writeText(jsonStr).then(() => {
                                alert('JSONをクリップボードにコピーしました。');
                            }).catch(err => {
                                console.error('コピーに失敗しました:', err);
                                alert('コピーに失敗しました。');
                            });
                        });
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

function drawBlockRoads(block) {
    const layerName = 'road';
    const blockGroup = layers[layerName].group.select(`#${layerName}-${block.id}`);
    const seaRouteGroup = layers['sea-route'].group.select(`#sea-route-${block.id}`);

    if (blockGroup.empty() && seaRouteGroup.empty()) return;
    if (!roadPathsData || roadPathsData.length === 0) return;

    const blockHexIds = new Set(block.hexes.map(h => h.index));
    const landRoadPathData = [];
    const roadSegmentGrid = new Map();
    const landRoads = roadPathsData.filter(d => d.level < 10);

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

            const startPoint = prevHex ? getSharedEdgeMidpoint(currentHex, prevHex) : [currentHex.cx, currentHex.cy];
            const endPoint = nextHex ? getSharedEdgeMidpoint(currentHex, nextHex) : [currentHex.cx, currentHex.cy];
            const controlPoint = [currentHex.cx, currentHex.cy];

            if (!startPoint || !endPoint || (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])) continue;

            const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
            const fromIndex = prevHex ? prevHex.index : currentHex.index;
            const toIndex = nextHex ? nextHex.index : currentHex.index;
            const segmentKey = Math.min(fromIndex, toIndex) + '-' + Math.max(fromIndex, toIndex);

            if (!roadSegmentGrid.has(segmentKey)) {
                roadSegmentGrid.set(segmentKey, true);
                landRoadPathData.push({ path: pathString, level: road.level, nationId: road.nationId });
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
                        6: '#f0f', 5: '#f00', 4: '#f80', 3: '#ff0', 2: '#0f0', 1: '#800'
                    }[d.level] || '#000'))
                    .attr('stroke-width', d => ({
                        6: 8.0, 5: 6.0, 4: 4.0, 3: 2.0, 2: 1.0, 1: 1.0
                    }[d.level] || 1))
                    .attr('stroke-dasharray', d => ({
                        6: '8, 8', 5: '6, 6', 4: '4, 4', 3: '2, 2', 2: '1, 1', 1: '1, 2'
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
            const controlPoint = [currentHex.cx, currentHex.cy];
            const pathString = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
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
                riverPathData.push({ path: path, flow: d.properties.flow });
            } else { // 中流の場合
                upstreamNeighbors.forEach(upstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                    if (startPoint) {
                        const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                        riverPathData.push({ path: path, flow: upstreamHex.properties.flow });
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
                .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
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
    block.hexes.forEach(d => {
        if (d.properties.beachNeighbors && d.properties.beachNeighbors.length > 0) {
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

export async function setupUI(allHexes, roadPaths, addLogMessage) {
    allHexesData = allHexes;
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
        .style('background-color', 'rgba(0, 0, 0, 0.8)')
        .style('color', '#fff')
        .style('padding', '5px')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('pointer-events', 'none') // マウスイベントを透過
        .style('white-space', 'pre-wrap') // 改行を有効化
        .style('z-index', '9999');

    // ミニマップ用の地形レイヤーを追加
    const minimapTerrain = minimapSvg.append('g');

    // メインマップ全体のサイズを計算
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;
    const mapTotalWidth = (config.COLS * hexWidth * 3 / 4 + hexWidth / 4);
    const mapTotalHeight = (config.ROWS * hexHeight + hexHeight / 2);

    // スケールを設定 (マップ全体が200x200のSVGに収まるように)
    minimapScaleX = 200 / mapTotalWidth;
    minimapScaleY = 200 / mapTotalHeight;
    const scale = Math.min(minimapScaleX, minimapScaleY);

    // ミニマップに簡易的な地形を描画
    minimapTerrain.selectAll('.minimap-hex')
        .data(allHexes)
        .enter()
        .append('rect')
        .attr('x', d => (d.col * (hexWidth * 3 / 4)) * scale)
        .attr('y', d => (d.row * hexHeight + (d.col % 2 === 0 ? 0 : hexHeight / 2)) * scale)
        .attr('width', hexWidth * scale)
        .attr('height', hexHeight * scale)
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

    // infoWindowモジュールの初期化
    initInfoWindow(document.getElementById('legend-container'));
    setAllHexesData(allHexes);

    // --- 2. 描画用データの事前計算 ---
    hexes = []; // データをリセット (Use module-level variable)

    for (let row = 0; row < config.ROWS; row++) {
        for (let col = 0; col < config.COLS; col++) {
            const hexData = allHexes[getIndex(col, row)];
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

            // 河川の流下方向を計算
            let downstreamIndex = -1;
            if (hexData.properties.flow > 0 && !hexData.properties.isWater) {
                let lowestNeighbor = null;
                let minElevation = hexData.properties.elevation;
                hexData.neighbors.map(i => allHexes[i]).forEach(n => {
                    if (n.properties.elevation < minElevation) {
                        minElevation = n.properties.elevation;
                        lowestNeighbor = n;
                    }
                });
                if (lowestNeighbor) {
                    downstreamIndex = getIndex(lowestNeighbor.col, lowestNeighbor.row);
                }
            }

            // 稜線の流れを計算するロジック
            let ridgeUpstreamIndex = -1;
            if (hexData.properties.ridgeFlow > 0 && !hexData.properties.isWater) {
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
                properties: { ...hexData.properties, shadingValue: elevationDifference },
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

    // 4h. 河川と稜線

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
    const targetHex = hexes.find(h => h.x === 56 && h.y === 49);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(2.0);

        // D3にtransformを適用させる
        svg.call(zoom.transform, initialTransform);

        // 適用されたtransformを基に、初回の表示要素を描画する
        updateVisibleBlocks(initialTransform);
        updateOverallInfo(allHexes);
    } else {
        // フォールバックとして、現在のtransformで初回描画
        updateVisibleBlocks(d3.zoomTransform(svg.node()));
        updateOverallInfo(allHexes);
    }
}

// ================================================================
// 分割生成のための再描画関数
// ================================================================

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

    updatedAllHexes.forEach((h, index) => {
        if (hexes[index]) {
            // プロパティをマージするのではなく、完全に上書きする
            // これにより、roadGeneratorで変更された nationId が確実に反映される
            hexes[index].properties = h.properties;
            // 描画用のシェーディング値のみ、追加で計算する
            hexes[index].properties.shadingValue = calculateShading(h, updatedAllHexes);
        }
    });
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
 * 気候・植生情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
export async function redrawClimate(allHexes) {
    updateHexesData(allHexes);
    updateAllHexColors(); // 色を再計算

    resetBlockRenderStatus(); // ブロック再描画をスケジュール

    // updateVisibleBlocksを呼び出して、表示を更新する
    if (svg) updateVisibleBlocks(currentTransform);
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
