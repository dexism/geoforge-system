// ================================================================
// GeoForge System - UIモジュール (v1.8.7 - 可読性最優先 最終版)
// ================================================================
// このスクリプトは、生成された世界データを基にD3.jsを用いてインタラクティブな
// ヘックスマップを描画し、サイドバーからのレイヤー操作や情報表示ウィンドウの
// 機能を提供します。
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, formatProgressBar } from './utils.js';

// --- グローバル変数 ---
// 全ての描画レイヤー（<g>要素）を管理するオブジェクト
const layers = {};
// ★★★ [ここが変更点] 凡例表示用コンテナをグローバル変数として保持 ★★★
let legendContainer = null;

// ================================================================
// ■ ヘルパー関数 (モジュールスコープ)
// ================================================================

/**
 * 2つのヘックスが共有する辺の中点を返すヘルパー関数。
 * 道路や河川がヘックスの中心ではなく、辺から辺へ滑らかに繋がるように見せるために使用します。
 * @param {object} hex1 - 1つ目のヘックスオブジェクト
 * @param {object} hex2 - 2つ目のヘックスオブジェクト
 * @returns {Array<number>|null} - 中点の座標 [x, y] または null
 */
function getSharedEdgeMidpoint(hex1, hex2) {
    if (!hex1 || !hex2) {
        return null;
    }
    const commonPoints = [];
    for (const p1 of hex1.points) {
        for (const p2 of hex2.points) {
            if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) {
                commonPoints.push(p1);
            }
        }
    }
    if (commonPoints.length === 2) {
        return [(commonPoints[0][0] + commonPoints[1][0]) / 2, (commonPoints[0][1] + commonPoints[1][1]) / 2];
    }
    return null;
}

/**
 * 汎用的なレイヤー切り替え関数。
 * @param {string} layerName - 操作対象となるレイヤー名
 * @param {HTMLElement} buttonElement - クリックされたボタン要素
 */
function toggleLayerVisibility(layerName, buttonElement) {
    const layer = layers[layerName];
    if (!layer) {
        console.error(`レイヤー "${layerName}" が見つかりません。`);
        return;
    }
    layer.visible = !layer.visible;
    layer.group.style('display', layer.visible ? 'inline' : 'none');
    buttonElement.classList.toggle('active', layer.visible);
}

/**
 * 気温の凡例を生成する
 */
function createTemperatureLegend() {
    const scale = config.tempColor;
    const gradientColors = d3.range(0, 1.01, 0.1).map(t => scale.interpolator()(t));
    
    return `
        <h4>気温凡例</h4>
        <div class="legend-gradient-bar" style="background: linear-gradient(to right, ${gradientColors.join(',')});"></div>
        <div class="legend-gradient-labels">
            <span>${scale.domain()[0]}℃</span>
            <span>${scale.domain()[1]}℃</span>
        </div>
    `;
}

/**
 * 降水量の凡例を生成する
 */
function createPrecipitationLegend() {
    const scale = config.precipColor;
    const domain = scale.domain();
    const range = scale.range();
    let itemsHtml = '';

    for (let i = 0; i < range.length; i++) {
        const color = range[i];
        const lowerBound = domain[i - 1] ? domain[i-1] : 0;
        const upperBound = domain[i];
        const label = i === 0 ? `～ ${upperBound} mm` : `${lowerBound} - ${upperBound} mm`;
        itemsHtml += `
            <div class="legend-item">
                <div class="legend-color-box" style="background-color: ${color};"></div>
                <span>${label}</span>
            </div>
        `;
    }

    return `<h4>降水量凡例 (mm/年)</h4>${itemsHtml}`;
}

/**
 * 気候帯の凡例を生成する
 */
function createClimateZoneLegend() {
    let itemsHtml = '';
    for (const [zone, color] of Object.entries(config.CLIMATE_ZONE_COLORS)) {
        itemsHtml += `
            <div class="legend-item">
                <div class="legend-color-box" style="background-color: ${color};"></div>
                <span>${zone}</span>
            </div>
        `;
    }
    return `<h4>気候帯凡例</h4>${itemsHtml}`;
}

/**
 * 人口分布の凡例を生成する
 */
function createPopulationLegend() {
    const scale = config.populationColor;
    // ★★★ ここを修正 ★★★
    // scaleLogにはinterpolatorがないため、rangeの色から直接補間関数を作成する
    const interpolator = d3.interpolate(scale.range()[0], scale.range()[1]);
    const gradientColors = d3.range(0, 1.01, 0.1).map(interpolator);
    
    return `
        <h4>人口分布凡例</h4>
        <div class="legend-gradient-bar" style="background: linear-gradient(to right, ${gradientColors.join(',')});"></div>
        <div class="legend-gradient-labels">
            <span>${scale.domain()[0].toLocaleString()}人</span>
            <span>${scale.domain()[1].toLocaleString()}人</span>
        </div>
    `;
}

/**
 * 表示する凡例を更新する
 * @param {string|null} layerName 表示したい凡例のレイヤー名、または非表示にする場合はnull
 */
function updateLegend(layerName) {
    if (!legendContainer) return;

    let legendHtml = '';
    switch (layerName) {
        case 'temp-overlay':
            legendHtml = createTemperatureLegend();
            break;
        case 'precip-overlay':
            legendHtml = createPrecipitationLegend();
            break;
        case 'climate-zone-overlay':
            legendHtml = createClimateZoneLegend();
            break;
        case 'population-overlay':
            legendHtml = createPopulationLegend();
            break;
        default:
            legendHtml = ''; // 対応する凡例がなければ空にする
            break;
    }
    
    legendContainer.innerHTML = legendHtml;
    legendContainer.style.display = legendHtml ? 'block' : 'none';
}

// ================================================================
// ■ UIセットアップ メイン関数
// ================================================================

export async function setupUI(allHexes, roadPaths, addLogMessage) {

    // --- 1. 初期設定とDOM要素の取得 ---
    const svg = d3.select('#hexmap');
    const g = svg.append('g');

    const infoWindow = document.getElementById('info-window');
    const infoContent = document.getElementById('info-window-content');
    const infoCloseBtn = document.getElementById('info-close-btn');

    legendContainer = document.getElementById('legend-container');

    // --- 2. 描画用データの事前計算 ---
    const hexes = [];
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;

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
                if(lowestNeighbor) {
                    downstreamIndex = getIndex(lowestNeighbor.col, lowestNeighbor.row);
                }
            }
            
            // ★★★【修正箇所：欠落していた稜線の流れを計算するロジックを復元】★★★
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
                ridgeUpstreamIndex: ridgeUpstreamIndex, // ★★★【修正箇所】計算結果をオブジェクトに追加
                neighbors: hexData.neighbors,
            });
        }
    }
    
    const childrenMap = new Map();
    allHexes.forEach((h, index) => {
        const parentId = h.properties.parentHexId;
        if (parentId !== null) {
            if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
            childrenMap.get(parentId).push(index);
        }
    });

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
    const snowLayer = createLayer('snow', true);                                // 積雪
    const shadingLayer = createLayer('shading');                                // レリーフ (陰影)
    const contourLayer = createLayer('contour', true);                          // 等高線
    const settlementLayer = createLayer('settlement');                          // 集落シンボル
    const riverLayer = createLayer('river');                                    // 河川
    const roadLayer = createLayer('road');                                      // 道路網
    const borderLayer = createLayer('border');                                  // 国境線
    // --- 情報オーバーレイ ---
    const territoryOverlayLayer = createLayer('territory-overlay', false);      // 領地
    const ridgeWaterSystemLayer = createLayer('ridge-water-system', false);     // 稜線・水系図
    const populationOverlayLayer = createLayer('population-overlay', false);    // 人口分布
    const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false); // 気候帯
    const tempOverlayLayer = createLayer('temp-overlay', false);                // 気温
    const precipOverlayLayer = createLayer('precip-overlay', false);            // 降水量
    const manaOverlayLayer = createLayer('mana-overlay', false);                // 魔力 (龍脈)
    const agriOverlayLayer = createLayer('agri-overlay', false);                // 農業適性
    const forestOverlayLayer = createLayer('forest-overlay', false);            // 林業適性
    const miningOverlayLayer = createLayer('mining-overlay', false);            // 鉱業適性
    const fishingOverlayLayer = createLayer('fishing-overlay', false);          // 漁業適性
    // --- UI操作用 ---
    const highlightOverlayLayer = createLayer('highlight-overlay');             // クリック時のハイライト
    const labelLayer = createLayer('labels');                                   // ラベル (集落名など)
    const interactionLayer = createLayer('interaction');                        // クリックイベントを受け取る透明レイヤー
    // ----- [描画順序: 手前] -----


    // --- 4. 各レイヤーの描画 ---

    // 4a. 基本地形レイヤー (標高と水域のみ)
    terrainLayer.selectAll('.hex')
        .data(hexes)
        .enter()
        .append('polygon')
            .attr('class', 'hex')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', d => {
                if (d.properties.isWater) return config.TERRAIN_COLORS[d.properties.vegetation];
                return config.getElevationColor(d.properties.elevation);
            });

    // 4b. 白地図オーバーレイヤー
    whiteMapOverlayLayer.selectAll('.white-map-hex')
        .data(hexes)
        .enter()
        .append('polygon')
            .attr('class', 'white-map-hex')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', d => d.properties.isWater ? config.WHITE_MAP_COLORS.WATER : config.whiteMapElevationColor(d.properties.elevation))
            .style('pointer-events', 'none');

    // 4c. 植生オーバーレイヤー
    vegetationOverlayLayer.selectAll('.veg-overlay-hex')
        .data(hexes.filter(d => !d.properties.isWater))
        .enter()
        .append('polygon')
            .attr('class', 'veg-overlay-hex')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', d => config.TERRAIN_COLORS[d.properties.vegetation] || 'transparent')
            .style('fill-opacity', 0.8)
            .style('pointer-events', 'none');

    // 4d. 積雪レイヤー
    snowLayer.selectAll('.snow-hex')
        .data(hexes.filter(d => d.properties.hasSnow))
        .enter()
        .append('polygon')
            .attr('class', 'snow-hex')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', '#fff')
            .style('fill-opacity', 0.8)
            .style('pointer-events', 'none');

    // 4e. レリーフ（陰影）レイヤー
    const shadingOpacityScale = d3.scaleLinear().domain([0, 400]).range([0, 0.10]).clamp(true);
    shadingLayer.selectAll('.shading-hex')
        .data(hexes.filter(d => !d.properties.isWater))
        .enter()
        .append('polygon')
            .attr('class', 'shading-hex')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', d => d.properties.shadingValue > 0 ? '#fff' : '#000')
            .style('fill-opacity', d => shadingOpacityScale(Math.abs(d.properties.shadingValue)))
            .style('pointer-events', 'none');
    
    // 4f. 国境線
    const borderSegments = [];
    hexes.forEach(h => {
        const hNation = h.properties.nationId;
        if (hNation === 0) return;
        h.neighbors.map(i => hexes[i]).forEach(n => {
            if (h.index < n.index) {
                const nNation = n.properties.nationId;
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
    borderLayer.selectAll('.border-segment')
        .data(borderSegments).enter().append('line')
        .attr('class', 'border-segment')
        .attr('x1', d => d.p1[0]).attr('y1', d => d.p1[1])
        .attr('x2', d => d.p2[0]).attr('y2', d => d.p2[1])
        .attr('stroke', '#f00').attr('stroke-width', 4)
        .attr('stroke-linecap', 'round').style('pointer-events', 'none');

    // 4g. 等高線
    const progressId = 'contour-progress';
    await addLogMessage("等高線の補間計算を開始します...", progressId);
    const mapBBox = g.node().getBBox();
    const resolution = 2;
    const gridWidth = Math.floor(mapBBox.width / resolution);
    const gridHeight = Math.floor(mapBBox.height / resolution);
    const elevationValues = new Array(gridWidth * gridHeight);
    const delaunay = d3.Delaunay.from(hexes.map(h => [h.cx, h.cy]));
    const totalPixels = gridWidth * gridHeight;
    let processedPixels = 0;
    let lastReportedPercent = -1;

    for (let j = 0; j < gridHeight; ++j) {
        for (let i = 0; i < gridWidth; ++i) {
            const px = mapBBox.x + i * resolution, py = mapBBox.y + j * resolution;
            const nearestHexIndex = delaunay.find(px, py), centerHex = hexes[nearestHexIndex];
            const neighborIndices = centerHex.neighbors;
            const pointsToConsider = [centerHex, ...neighborIndices.map(idx => hexes[idx])].filter(Boolean);
            let totalWeight = 0, weightedElevationSum = 0;
            pointsToConsider.forEach(hex => {
                const dist = Math.hypot(hex.cx - px, hex.cy - py);
                if (dist < 1e-6) { weightedElevationSum = hex.properties.isWater ? -1 : hex.properties.elevation; totalWeight = 1; return; }
                const weight = 1.0 / Math.pow(dist, 2);
                totalWeight += weight; weightedElevationSum += weight * (hex.properties.isWater ? -1 : hex.properties.elevation);
            });
            elevationValues[j * gridWidth + i] = (totalWeight > 0) ? weightedElevationSum / totalWeight : -1;
            
            processedPixels++;
            const percent = Math.floor((processedPixels / totalPixels) * 100);
            if (percent > lastReportedPercent) {
                const message = formatProgressBar({ current: processedPixels, total: totalPixels, prefix: "等高線:" });
                await addLogMessage(message, progressId);
                lastReportedPercent = percent;
            }
        }
    }
    await addLogMessage("等高線: 計算完了。パスを生成中...", progressId);
    const maxElevation = d3.max(hexes, h => h.properties.elevation);
    const thresholds = d3.range(200, maxElevation, 200);
    const contours = d3.contours().size([gridWidth, gridHeight]).thresholds(thresholds)(elevationValues);
    contourLayer.selectAll("path")
        .data(contours).join("path")
        .attr("class", d => `contour-path ${d.value % 1000 === 0 ? 'contour-index' : 'contour-intermediate'}`)
        .attr("d", d3.geoPath()).attr("transform", `translate(${mapBBox.x}, ${mapBBox.y}) scale(${resolution})`);

    // 4h. 河川と稜線
    
    // 河川セグメントのデータを生成
    const riverSegmentsData = [];
    hexes.forEach(d => {
        if (d.properties.flow > 0 && !d.properties.isWater) {
            const downstreamHex = d.downstreamIndex !== -1 ? hexes[d.downstreamIndex] : null;
            let endPoint = downstreamHex ? getSharedEdgeMidpoint(d, downstreamHex) : [d.cx, d.cy];
            if (!endPoint) {
                endPoint = [d.cx, d.cy];
            }
            const upstreamNeighbors = hexes.filter(h => h.downstreamIndex === d.index);
            if (upstreamNeighbors.length === 0) {
                riverSegmentsData.push({ start: [d.cx, d.cy], end: endPoint, flow: d.properties.flow });
            } else {
                upstreamNeighbors.forEach(upstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                    if (startPoint) {
                        riverSegmentsData.push({ start: startPoint, end: endPoint, flow: upstreamHex.properties.flow });
                    }
                });
            }
        }
    });
    
    // ★★★【修正箇所：稜線データの計算ロジックを完全な形で復元】★★★
    const ridgeSegmentsData = [];
    hexes.forEach(sourceHex => {
        if (sourceHex.properties.ridgeFlow > 0 && !sourceHex.properties.isWater) {
            const upstreamHex = sourceHex.ridgeUpstreamIndex !== -1 ? hexes[sourceHex.ridgeUpstreamIndex] : null;
            let endPoint = upstreamHex ? getSharedEdgeMidpoint(sourceHex, upstreamHex) : [sourceHex.cx, sourceHex.cy];
            if (!endPoint) {
                endPoint = [sourceHex.cx, sourceHex.cy];
            }

            const downstreamRidgeNeighbors = hexes.filter(h => h.ridgeUpstreamIndex === sourceHex.index);
            if (downstreamRidgeNeighbors.length === 0) {
                const startPoint = [sourceHex.cx, sourceHex.cy];
                ridgeSegmentsData.push({ start: startPoint, end: endPoint, flow: sourceHex.properties.ridgeFlow });
            } else {
                downstreamRidgeNeighbors.forEach(downstreamHex => {
                    const startPoint = getSharedEdgeMidpoint(sourceHex, downstreamHex);
                    if (startPoint) {
                        ridgeSegmentsData.push({ start: startPoint, end: endPoint, flow: downstreamHex.properties.ridgeFlow });
                    }
                });
            }
        }
    });
    
    // 河川レイヤーに描画
    riverLayer.selectAll('.river-segment')
        .data(riverSegmentsData)
        .enter()
        .append('line')
            .attr('class', 'river-segment')
            .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
            .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
            .attr('stroke', '#058')
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
            .attr('stroke-linecap', 'round')
            .style('pointer-events', 'none');
        
    // 稜線・水系図レイヤーに描画
    ridgeWaterSystemLayer.selectAll('.rws-water-hex')
        .data(hexes.filter(d => d.properties.isWater))
        .enter()
        .append('polygon')
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', '#0077be');
        
    ridgeWaterSystemLayer.selectAll('.rws-river-segment')
        .data(riverSegmentsData)
        .enter()
        .append('line')
            .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
            .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
            .attr('stroke', '#07c')
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
            .attr('stroke-linecap', 'round');
        
    ridgeWaterSystemLayer.selectAll('.rws-ridge-segment')
        .data(ridgeSegmentsData)
        .enter()
        .append('line')
            .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
            .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
            .attr('stroke', '#a00')
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
            .attr('stroke-linecap', 'round');
    
    // 4i. 道路網
    const finalRoadSegments = [];
    const roadSegmentGrid = new Map();
    [...roadPaths].sort((a, b) => b.level - a.level).forEach(road => {
        if (road.path.length < 2) return;
        const pathHexes = road.path.map(p => hexes[getIndex(p.x, p.y)]);
        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i]; if (!currentHex) continue;
            let startPoint, endPoint;
            if (i === 0) startPoint = [currentHex.cx, currentHex.cy]; else startPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i - 1]);
            if (i === pathHexes.length - 1) endPoint = [currentHex.cx, currentHex.cy]; else endPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i + 1]);
            const prevHex = i > 0 ? pathHexes[i - 1] : currentHex, nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : currentHex;
            const fromIndex = (i === 0) ? currentHex.index : prevHex.index, toIndex = (i === pathHexes.length - 1) ? currentHex.index : nextHex.index;
            const segmentKey = Math.min(fromIndex, toIndex) + '-' + Math.max(fromIndex, toIndex);
            if (startPoint && endPoint && !roadSegmentGrid.has(segmentKey)) {
                roadSegmentGrid.set(segmentKey, true);
                finalRoadSegments.push({ start: startPoint, end: endPoint, level: road.level });
            }
        }
    });
    roadLayer.selectAll('.road-segment')
        .data(finalRoadSegments).enter().append('line')
        .attr('class', 'road-segment')
        .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
        .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
        .attr('stroke', d => ({ 5: '#a0f', 4: '#f00', 3: '#f00', 2: '#f00', 1: '#800' }[d.level] || '#000'))
        .attr('stroke-width', d => ({ 5: 6.0, 4: 4.0, 3: 2.0, 2: 1.0, 1: 1.0 }[d.level] || 1))
        .attr('stroke-dasharray', d => ({ 5: '6, 6', 4: '4, 4', 3: '2, 2', 2: '1, 1', 1: '1, 2' }[d.level] || '2, 2'))
        .style('pointer-events', 'none');
    
    // 4j. 集落シンボル
    settlementLayer.selectAll('.settlement-hex')
        .data(hexes.filter(d => ['町', '街', '領都', '首都'].includes(d.properties.settlement))).enter().append('polygon')
        .attr('class', 'settlement-hex').attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => ({ '首都': '#f0f', '都市': '#f00', '領都': '#f60', '街': '#fa0', '町': '#ff0' }[d.properties.settlement]))
        .style('pointer-events', 'none');
    
    // 4k. 各種情報オーバーレイヤー
    const nationColor = d3.scaleOrdinal(d3.schemeTableau10);
    const overlayLayers = {
        'climate-zone-overlay': { data: hexes, fill: d => config.CLIMATE_ZONE_COLORS[d.properties.climateZone], opacity: 0.6 },
        'temp-overlay': { data: hexes, fill: d => config.tempColor(d.properties.temperature), opacity: 0.6 },
        'precip-overlay': { data: hexes, fill: d => config.precipColor(d.properties.precipitation_mm), opacity: 0.6 },
        'mana-overlay': { data: hexes, fill: d => config.manaColor(d.properties.manaValue), opacity: 0.6 },
        'agri-overlay': { data: hexes, fill: d => config.agriColor(d.properties.agriPotential), opacity: 0.7 },
        'forest-overlay': { data: hexes, fill: d => config.forestColor(d.properties.forestPotential), opacity: 0.7 },
        'mining-overlay': { data: hexes, fill: d => config.miningColor(d.properties.miningPotential), opacity: 0.7 },
        'fishing-overlay': { data: hexes, fill: d => config.fishingColor(d.properties.fishingPotential), opacity: 0.7 },
        'population-overlay': { data: hexes.filter(d => d.properties.population > 0), fill: d => config.populationColor(d.properties.population), opacity: 0.9 },
        'territory-overlay': { data: hexes, fill: d => d.properties.nationId === 0 ? '#555' : nationColor(d.properties.nationId), opacity: 0.5 }
    };

    for (const [layerName, { data, fill, opacity }] of Object.entries(overlayLayers)) {
        layers[layerName].group.selectAll(`.${layerName}-hex`)
            .data(data).enter().append('polygon')
            .attr('class', `${layerName}-hex`)
            .attr('points', d => d.points.map(p => p.join(',')).join(' '))
            .attr('fill', fill)
            .style('fill-opacity', opacity)
            .style('pointer-events', 'none');
    }
    
    // --- 5. 情報ウィンドウとインタラクション ---
    
    /**
     * クリックされたヘックスの詳細情報を整形して返す関数。
     * 情報ウィンドウの表示内容を生成します。
     * @param {object} d - ヘックスデータ
     * @returns {string} - 整形された情報テキスト
     */
    function getInfoText(d) {
        const p = d.properties;
        
        // --- 上位集落の情報を整形 ---
        let superiorText = 'なし';
        if (p.parentHexId != null) {
            const superiorHex = allHexes[p.parentHexId];
            if (superiorHex) {
                let detailsText = '';
                if (p.distanceToParent) {
                    const distanceStr = `\n　道のり：${p.distanceToParent.toFixed(1)}km`;
                    let travelDaysStr = '';
                    if (p.travelDaysToParent) {
                        travelDaysStr = `\n　荷馬車：${p.travelDaysToParent.toFixed(1)}日`;
                    }
                    detailsText = `${distanceStr}${travelDaysStr}`;
                }
                superiorText = `${superiorHex.properties.settlement} (E${superiorHex.col}-N${(config.ROWS-1)-superiorHex.row})${detailsText}`;
            }
        } else if (p.territoryId != null && getIndex(d.x, (config.ROWS - 1) - d.y) !== p.territoryId) {
            const territoryHub = allHexes[p.territoryId];
             if (territoryHub) {
                superiorText = `[中枢] ${territoryHub.properties.settlement} (E${territoryHub.col}-N${(config.ROWS-1)-territoryHub.row})`;
            }
        }

        // --- 土地利用情報の整形 ---
        let landUseText;
        if (p.isWater) {
            landUseText = p.vegetation;
        } else {
            const landUseParts = [];
            if (p.terrainType) landUseParts.push(p.terrainType);
            if (p.vegetation) landUseParts.push(p.vegetation);
            if (p.isAlluvial) landUseParts.push('河川');
            if (p.hasSnow) landUseParts.push('積雪');
            landUseText = landUseParts.join(', ');
        }
        
        // --- 国家情報の整形 ---
        const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺境';
        
        // --- 全ての情報を結合して最終的なテキストを生成 ---
        let text = `座標　　：E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
                   `所属国家：${nationName}\n` +
                   `直轄上位：${superiorText}\n`+
                   `土地利用： ${landUseText}\n` +
                   `人口　　： ${p.population.toLocaleString()}人\n` +
                   `農地面積： ${Math.round(p.cultivatedArea).toLocaleString()} ha\n` +
                   `居住適性： ${p.habitability.toFixed(1)}\n` +
                   `--- 土地詳細 ---\n` +
                   `気候帯　： ${p.climateZone}\n` +
                   `標高　　： ${Math.round(p.elevation)}m\n` +
                   `気温　　： ${p.temperature.toFixed(1)}℃\n` +
                   // ★★★ [変更] 降水量の表示を mm/年 に変更 ★★★
                   `降水量　： ${p.precipitation_mm.toFixed(0)}mm/年\n` +
                   `魔力　　： ${p.manaRank}\n` +
                   `資源　　： ${p.resourceRank}\n` +
                   `--- 資源ポテンシャル ---\n` +
                   `農業適正： ${(p.agriPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `林業適正： ${(p.forestPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `鉱業適正： ${(p.miningPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `漁業適正： ${(p.fishingPotential * 100).toFixed(0).padStart(3, ' ')}%`;
        
        // --- 食料需給情報の追加 ---
        const surplusKeys = Object.keys(p.surplus || {});
        const shortageKeys = Object.keys(p.shortage || {});
        if (Object.keys(p.production || {}).length > 0 || surplusKeys.length > 0 || shortageKeys.length > 0) {
            text += `\n--- 食料需給 (t/年) ---`;
            const productionText = Object.entries(p.production || {}).map(([crop, amount]) => `${crop} ${Math.round(amount).toLocaleString()}`).join('t\n　　　') + 't';
            if(Object.keys(p.production || {}).length > 0) text += `\n生産：${productionText}`;
            if (surplusKeys.length > 0) text += `\n余剰：${surplusKeys.map(key => `${key} ${p.surplus[key]}`).join('t\n　　　')}t`;
            if (shortageKeys.length > 0) text += `\n不足：${shortageKeys.map(key => `${key} ${p.shortage[key]}`).join('t\n　　　')}t`;
        }
        
        // --- 主要都市の場合、支配領域の集計情報を追加 ---
        if (['首都', '都市', '領都'].includes(p.settlement) && p.territoryData) {
            const data = p.territoryData;
            text += `\n--- 庇護下領域 集計 ---`;
            const settlementCountText = Object.entries(data.settlementCounts).filter(([, count]) => count > 0).map(([type, count]) => { const shortName = { '都市': '都', '領都': '領', '街': '街', '町': '町', '村': '村' }[type]; return `${shortName}${count}`; }).join(', ');
            if(settlementCountText) text += `\n直轄地　： ${settlementCountText}`;
            text += `\n合計人口： ${data.population.toLocaleString()}人`;
            text += `\n合計農地： ${Math.round(data.cultivatedArea).toLocaleString()}ha`;
            const totalProductionText = Object.entries(data.production).map(([crop, amount]) => `${crop} ${Math.round(amount).toLocaleString()}t`).join('\n　　　　　');
            text += `\n生産合計：${totalProductionText}`;
            const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement];
            const totalDemand = data.population * settlementInfo.consumption_t_per_person; 
            const totalSupply = Object.values(data.production).reduce((a, b) => a + b, 0);
            const balance = totalSupply - totalDemand;
            if (balance >= 0) { text += `\n食料収支：+${Math.round(balance).toLocaleString()}t の余剰`; } else { text += `\n食料収支：${Math.round(balance).toLocaleString()}t の不足`; }
        }
        
        return text;
    }
    
    // インタラクション用の透明なヘックスを最前面に配置
    const interactiveHexes = interactionLayer.selectAll('.interactive-hex')
        .data(hexes).enter().append('polygon')
        .attr('class', 'interactive-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .style('fill', 'transparent')
        .style('cursor', 'pointer');
    
    // title属性に情報を設定（ホバーで表示されるツールチップ）
    interactiveHexes.append('title').text(d => getInfoText(d));

    // ヘックスクリック時のイベント
    interactiveHexes.on('click', (event, d) => {
        // 既存のハイライトをすべてクリア
        highlightOverlayLayer.selectAll('*').remove();
        const p = d.properties;

        // 集落がクリックされた場合、支配下の領域をハイライト表示
        if (['首都', '都市', '領都', '街', '町', '村'].includes(p.settlement)) {
            // 直属の親をハイライト
            if (p.parentHexId !== null) {
                const superiorHex = hexes[p.parentHexId];
                if (superiorHex) {
                    highlightOverlayLayer.append('polygon')
                        .attr('points', superiorHex.points.map(pt => pt.join(',')).join(' '))
                        .attr('fill', '#0ff')
                        .style('fill-opacity', 1.0)
                        .style('pointer-events', 'none');
                }
            }
            
            // 全ての子孫を再帰的に検索する関数
            const findAllDescendants = (startIndex) => {
                const descendants = [];
                const queue = [{ index: startIndex, depth: 0 }];
                const visited = new Set([startIndex]);
                let head = 0;
                while(head < queue.length) {
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
            
            // 子孫を階層に応じて色分けしてハイライト
            if (descendants.length > 0) {
                const maxDepth = Math.max(0, ...descendants.map(item => item.depth));
                const colorScale = d3.scaleLinear().domain([2, Math.max(2, maxDepth)]).range(['#660000', 'black']).interpolate(d3.interpolateRgb);
                descendants.forEach(item => {
                    let color = (item.depth === 1) ? 'red' : colorScale(item.depth);
                    highlightOverlayLayer.append('polygon')
                        .attr('points', item.hex.points.map(pt => pt.join(',')).join(' '))
                        .attr('fill', color)
                        .style('fill-opacity', 0.8)
                        .style('pointer-events', 'none');
                });
            }
        }
        
        // 情報ウィンドウを更新して表示
        infoContent.textContent = getInfoText(d);
        infoWindow.classList.remove('hidden');
        // イベントの伝播を停止し、マップ全体のクリックイベントが発火しないようにする
        event.stopPropagation();
    });
        
    // 各種ラベルの描画
    const hexLabelGroups = labelLayer.selectAll('.hex-label-group').data(hexes).enter().append('g');
    
    // 座標ラベル (ズームインで表示)
    hexLabelGroups.append('text')
        .attr('class', 'hex-label')
        .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => `${String(d.x).padStart(2, '0')}${String(d.y).padStart(2, '0')}`);
        
    // 集落ラベル
    hexLabelGroups.filter(d => d.properties.settlement)
        .append('text')
        .attr('class', 'settlement-label')
        .attr('x', d => d.cx).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .text(d => d.properties.settlement);

    // ★★★【ここから修正】欠落していたプロパティラベルの描画コードを追記 ★★★
    
    // 魔力ランクラベル (左側・ズームインで表示)
    hexLabelGroups.append('text')
        .attr('class', 'property-label')
        .attr('x', d => d.cx - config.r * 0.7) // ヘックス中心から少し左に配置
        .attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => d.properties.manaRank);

    // 資源ランクラベル (右側・ズームインで表示)
    hexLabelGroups.append('text')
        .attr('class', 'property-label')
        .attr('x', d => d.cx + config.r * 0.7) // ヘックス中心から少し右に配置
        .attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => d.properties.resourceRank);

    const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
        g.attr('transform', event.transform);
        const effectiveRadius = config.r * event.transform.k;
        labelLayer.selectAll('.hex-label, .property-label').style('display', effectiveRadius >= 50 ? 'inline' : 'none');
    });
    svg.call(zoom);

    const closeInfoWindowAndHighlight = () => {
        infoWindow.classList.add('hidden');
        highlightOverlayLayer.selectAll('*').remove();
    };
    infoCloseBtn.addEventListener('click', closeInfoWindowAndHighlight);
    svg.on('click', closeInfoWindowAndHighlight);

    // --- 6. UIイベントハンドラの設定 ---
    
    // 6a. 基本地図の切り替え
    d3.selectAll('input[name="map-type"]').on('change', function() {
        const selectedType = d3.select(this).property('value');
        const isWhiteMap = selectedType === 'white';
        layers.terrain.group.style('display', isWhiteMap ? 'none' : 'inline');
        layers['white-map-overlay'].group.style('display', isWhiteMap ? 'inline' : 'none');
        layers.river.group.selectAll('.river-segment').attr('stroke', isWhiteMap ? config.WHITE_MAP_COLORS.WATER : '#058');
    });

    // 6b. レイヤーカテゴリのボタン
    
    d3.select('#toggleVegetationLayer').on('click', function() {
        this.classList.toggle('active');
        const isNowActive = this.classList.contains('active');
        layers['vegetation-overlay'].visible = isNowActive;
        layers['vegetation-overlay'].group.style('display', isNowActive ? 'inline' : 'none');
        layers.snow.visible = isNowActive;
        layers.snow.group.style('display', isNowActive ? 'inline' : 'none');
    });
    
    d3.select('#toggleSettlementLayer').on('click', function() {
        toggleLayerVisibility('settlement', this);
        const isVisible = layers.settlement.visible;
        layers.border.visible = isVisible;
        layers.border.group.style('display', isVisible ? 'inline' : 'none');
        labelLayer.selectAll('.settlement-label').style('display', isVisible ? 'inline' : 'none');
    });

    d3.select('#toggleReliefLayer').on('click', function() { toggleLayerVisibility('shading', this); });
    d3.select('#toggleContourLayer').on('click', function() { toggleLayerVisibility('contour', this); });
    d3.select('#toggleRoadLayer').on('click', function() { toggleLayerVisibility('road', this); });
    d3.select('#toggleTerritoryLayer').on('click', function() { toggleLayerVisibility('territory-overlay', this); });
    d3.select('#toggleRidgeWaterSystemLayer').on('click', function() { toggleLayerVisibility('ridge-water-system', this); });

    // 6c. 地理情報カテゴリのボタン
    // ★★★ [ここから修正] 地理情報ボタンの排他的な動作を実装 ★★★
    const geoInfoButtons = {
        '#toggleTempLayer': 'temp-overlay',
        '#togglePrecipLayer': 'precip-overlay',
        '#toggleClimateZoneLayer': 'climate-zone-overlay',
        '#togglePopulationLayer': 'population-overlay'
    };

    const geoInfoButtonSelectors = Object.keys(geoInfoButtons);

    geoInfoButtonSelectors.forEach(selector => {
        d3.select(selector).on('click', function() {
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
        });
    });

    // 6d. 資源カテゴリのボタン
    d3.select('#toggleManaLayer').on('click', function() { toggleLayerVisibility('mana-overlay', this); });
    d3.select('#toggleAgriLayer').on('click', function() { toggleLayerVisibility('agri-overlay', this); });
    d3.select('#toggleForestLayer').on('click', function() { toggleLayerVisibility('forest-overlay', this); });
    d3.select('#toggleMiningLayer').on('click', function() { toggleLayerVisibility('mining-overlay', this); });
    d3.select('#toggleFishingLayer').on('click', function() { toggleLayerVisibility('fishing-overlay', this); });

    // --- 7. 初期ズーム位置の設定 ---
    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        svg.call(zoom.transform, initialTransform);
    }
}