// ================================================================
// GeoForge System - UIモジュール
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex } from './utils.js';

// グローバル変数としてレイヤー管理オブジェクトを定義
const layers = {};

/**
 * 汎用的なレイヤー切り替え関数
 * @param {string} layerName - 対象のレイヤー名
 * @param {HTMLElement} buttonElement - クリックされたボタン要素
 * @param {string} showText - 表示時のボタンテキスト
 * @param {string} hideText - 非表示時のボタンテキスト
 */
function toggleLayerVisibility(layerName, buttonElement, showText, hideText) {
    const layer = layers[layerName];
    layer.visible = !layer.visible;
    layer.group.style('display', layer.visible ? 'inline' : 'none');
    buttonElement.textContent = layer.visible ? hideText : showText;
}

/**
 * UIのセットアップメイン関数 (main.js から呼び出される)
 * @param {Array<object>} allHexes - 生成された全ヘックスのデータ
 */
export function setupUI(allHexes) {
    const svg = d3.select('#hexmap');
    const g = svg.append('g');

    // フローティングウィンドウのDOM要素を取得
    const infoWindow = document.getElementById('info-window');
    const infoCoord = document.getElementById('info-coord');
    const infoContent = document.getElementById('info-window-content');
    const infoCloseBtn = document.getElementById('info-close-btn');

    // --- 1. 描画用データの事前計算 ---
    const hexes = [];
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;

    for (let row = 0; row < config.ROWS; row++) {
        for (let col = 0; col < config.COLS; col++) {
            const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
            const cx = col * (hexWidth * 3 / 4) + config.r;
            const cy = row * hexHeight + offsetY + config.r;
            const hexData = allHexes[getIndex(col, row)];
            
            let downstreamHex = null;
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
                    const downOffsetY = (lowestNeighbor.col % 2 === 0) ? 0 : hexHeight / 2;
                    downstreamHex = {
                        cx: lowestNeighbor.col * (hexWidth * 3 / 4) + config.r,
                        cy: lowestNeighbor.row * hexHeight + downOffsetY + config.r
                    };
                }
            }

            hexes.push({
                x: col, y: (config.ROWS - 1) - row, cx: cx, cy: cy,
                points: d3.range(6).map(i => [cx + config.r * Math.cos(Math.PI / 3 * i), cy + config.r * Math.sin(Math.PI / 3 * i)]),
                properties: hexData.properties,
                downstream: downstreamHex,
                neighbors: hexData.neighbors,
            });
        }
    }

    // --- 2. レイヤー管理のセットアップ ---
    function createLayer(name, visibleByDefault = true) {
        const layerGroup = g.append('g').attr('class', `${name}-layer`);
        layers[name] = { group: layerGroup, visible: visibleByDefault };
        if (!visibleByDefault) { layerGroup.style('display', 'none'); }
        return layerGroup;
    }

    const terrainLayer = createLayer('terrain');
    const snowLayer = createLayer('snow');
    const elevationOverlayLayer = createLayer('elevation-overlay', false);
    const riverLayer = createLayer('river');
    const roadLayer = createLayer('road');
    const precipOverlayLayer = createLayer('precip-overlay', false);
    const tempOverlayLayer = createLayer('temp-overlay', false);
    const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false);
    const manaOverlayLayer = createLayer('mana-overlay', false);
    const agriOverlayLayer = createLayer('agri-overlay', false);
    const forestOverlayLayer = createLayer('forest-overlay', false);
    const miningOverlayLayer = createLayer('mining-overlay', false);
    const fishingOverlayLayer = createLayer('fishing-overlay', false);
    const populationOverlayLayer = createLayer('population-overlay', false);
    const labelLayer = createLayer('labels');
    const interactionLayer = createLayer('interaction');

    // --- 3. 各レイヤーの描画 ---
    // 3a. 地形レイヤー
    terrainLayer.selectAll('.hex').data(hexes).enter().append('polygon')
        .attr('class', 'hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => {
            if (d.properties.settlement === '都') return '#f00';
            if (d.properties.settlement === '街') return '#f80';
            if (d.properties.settlement === '町') return '#ff0';
            const veg = d.properties.vegetation;
            if (config.TERRAIN_COLORS[veg]) return config.TERRAIN_COLORS[veg];
            return config.getElevationColor(d.properties.elevation);
        });

    // 3b. 川レイヤー
    riverLayer.selectAll('.river-path').data(hexes.filter(d => d.properties.flow > 0 && d.downstream)).enter().append('line')
        .attr('class', 'river-path')
        .attr('x1', d => d.cx).attr('y1', d => d.cy)
        .attr('x2', d => d.downstream.cx).attr('y2', d => d.downstream.cy)
        .attr('stroke', '#058')
        .attr('stroke-width', d => Math.min(Math.sqrt(d.properties.flow) * 2, config.r))
        .attr('stroke-linecap', 'round').style('pointer-events', 'none');

    // 3c. 積雪レイヤー
    snowLayer.selectAll('.snow-hex').data(hexes.filter(d => d.properties.hasSnow)).enter().append('polygon')
        .attr('class', 'snow-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', '#fff').style('fill-opacity', 0.8).style('pointer-events', 'none');

    // 3d. 街道レイヤー
    const roadSegments = [];
    hexes.forEach(h => {
        if (h.properties.roadTraffic > 0) {
            h.neighbors.map(i => hexes[i]).forEach(n => {
                if (n && n.properties.roadTraffic > 0 && getIndex(h.x, (config.ROWS - 1) - h.y) < getIndex(n.x, (config.ROWS - 1) - n.y)) {
                    roadSegments.push({
                        source: { cx: h.cx, cy: h.cy },
                        target: { cx: n.cx, cy: n.cy },
                        traffic: (h.properties.roadTraffic + n.properties.roadTraffic) / 2
                    });
                }
            });
        }
    });
    roadLayer.selectAll('.road-segment').data(roadSegments).enter().append('line')
        .attr('x1', d => d.source.cx).attr('y1', d => d.source.cy)
        .attr('x2', d => d.target.cx).attr('y2', d => d.target.cy)
        .attr('stroke', '#f00')
        .attr('stroke-width', d => Math.min(Math.log(d.traffic) * 0.5, config.r * 0.3))
        .attr('stroke-dasharray', '4, 4').style('pointer-events', 'none');

    // 3e. 各種オーバーレイヤー
    elevationOverlayLayer.selectAll('.elevation-hex').data(hexes.filter(d => !d.properties.isWater)).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.getElevationColor(d.properties.elevation))
        .style('fill-opacity', 0.9).style('pointer-events', 'none');
    climateZoneOverlayLayer.selectAll('.climate-zone-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.CLIMATE_ZONE_COLORS[d.properties.climateZone])
        .style('fill-opacity', 0.8).style('pointer-events', 'none');
    tempOverlayLayer.selectAll('.temp-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.tempColor(d.properties.temperature))
        .style('fill-opacity', 0.6).style('pointer-events', 'none');
    precipOverlayLayer.selectAll('.precip-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.precipColor(d.properties.precipitation))
        .style('fill-opacity', 0.6).style('pointer-events', 'none');
    manaOverlayLayer.selectAll('.mana-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.manaColor(d.properties.manaValue))
        .style('fill-opacity', 0.6).style('pointer-events', 'none');
    agriOverlayLayer.selectAll('.agri-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.agriColor(d.properties.agriPotential))
        .style('fill-opacity', 0.7).style('pointer-events', 'none');
    forestOverlayLayer.selectAll('.forest-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.forestColor(d.properties.forestPotential))
        .style('fill-opacity', 0.7).style('pointer-events', 'none');
    miningOverlayLayer.selectAll('.mining-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.miningColor(d.properties.miningPotential))
        .style('fill-opacity', 0.7).style('pointer-events', 'none');
    fishingOverlayLayer.selectAll('.fishing-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.fishingColor(d.properties.fishingPotential))
        .style('fill-opacity', 0.7).style('pointer-events', 'none');
    populationOverlayLayer.selectAll('.population-hex').data(hexes.filter(d => d.properties.population > 0)).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' ')).attr('fill', d => config.populationColor(d.properties.population))
        .style('fill-opacity', 0.7).style('pointer-events', 'none');

    // --- 3f. 情報ウィンドウとインタラクション ---
    
    // 情報を整形する共有関数
    function getInfoText(d) {
        let text = `座標　　：E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
                   `土地利用： ${d.properties.vegetation}${d.properties.isAlluvial ? ' (河川)' : ''}${d.properties.hasSnow ? ' (積雪)' : ''}\n` +
                   `人口　　： ${d.properties.population.toLocaleString()}人\n` +
                   `農地面積： ${Math.round(d.properties.cultivatedArea).toLocaleString()} ha\n` +
                   `居住適性： ${d.properties.habitability.toFixed(1)}\n` +
                   `\n--- 土地詳細 ---\n` +
                   `気候帯　： ${d.properties.climateZone}\n` +
                   `標高　　： ${Math.round(d.properties.elevation)}m\n` +
                   `気温　　： ${d.properties.temperature.toFixed(1)}℃\n` +
                   `降水量　： ${(d.properties.precipitation * 100).toFixed(0)}%\n` +
                   `魔力　　： ${d.properties.manaRank}\n` +
                   `資源　　： ${d.properties.resourceRank}\n` +
                   `\n--- 資源ポテンシャル ---\n` +
                   `農業適正： ${(d.properties.agriPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `林業適正： ${(d.properties.forestPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `鉱業適正： ${(d.properties.miningPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `漁業適正： ${(d.properties.fishingPotential * 100).toFixed(0).padStart(3, ' ')}%`;
        const surplusKeys = Object.keys(d.properties.surplus || {});
        const shortageKeys = Object.keys(d.properties.shortage || {});
        if (surplusKeys.length > 0 || shortageKeys.length > 0) {
            text += `\n\n--- 食料需給 (t/年) ---`;
            if (surplusKeys.length > 0) text += `\n余剰：${surplusKeys.map(key => `${key} ${d.properties.surplus[key]}`).join('t\n　　　')}t`;
            if (shortageKeys.length > 0) text += `\n不足：${shortageKeys.map(key => `${key} ${d.properties.shortage[key]}`).join('t\n　　　')}t`;
        }
        return text;
    }
    
    // 情報ウィンドウを更新する関数
    function updateInfoWindow(d) {
        infoCoord.textContent = `E${String(d.x).padStart(2, '0')} - N${String(d.y).padStart(2, '0')}`;
        infoContent.textContent = getInfoText(d);
        infoWindow.classList.remove('hidden');
    }

    // interactionLayerにイベントとツールチップを設定
    const interactiveHexes = interactionLayer.selectAll('.interactive-hex')
        .data(hexes)
        .enter().append('polygon')
        .attr('class', 'interactive-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .style('fill', 'transparent')
        .style('cursor', 'pointer');

    // ツールチップ用の<title>要素を追加
    interactiveHexes.append('title')
        .text(d => getInfoText(d));
    
    // クリックイベントをポリゴン自体に再設定
    interactiveHexes.on('click', (event, d) => {
        updateInfoWindow(d);
        event.stopPropagation();
    });
        
    // --- 3g. ラベルレイヤーの描画 ---
    const hexLabelGroups = labelLayer.selectAll('.hex-label-group').data(hexes).enter().append('g');

    // 座標ラベル
    hexLabelGroups.append('text').attr('class', 'hex-label')
        .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('font-size', `${config.r / 4}px`)
        .style('display', 'none')
        .text(d => `${String(d.x).padStart(2, '0')}${String(d.y).padStart(2, '0')}`);

    // 居住区ラベル
    hexLabelGroups.filter(d => d.properties.settlement).append('text').attr('class', 'settlement-label')
        .attr('x', d => d.cx).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('font-size', `${config.r / 1.5}px`).text(d => d.properties.settlement);
        
    // 魔力ラベル
    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx - config.r * 0.7).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('font-size', `${config.r / 4}px`)
        .style('display', 'none')
        .text(d => d.properties.manaRank);

    // 資源ラベル
    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx + config.r * 0.7).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('font-size', `${config.r / 4}px`)
        .style('display', 'none')
        .text(d => d.properties.resourceRank);
    

    // --- 4. ZoomとUIイベントハンドラ ---
    const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
        g.attr('transform', event.transform);
        const effectiveRadius = config.r * event.transform.k;
        labelLayer.selectAll('.hex-label, .property-label')
            .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
    });
    svg.call(zoom);

    // ウィンドウを閉じるためのイベントリスナー
    // ウィンドウを閉じるためのイベントリスナーをタッチ対応に変更
    function closeInfoWindow(event) {
        infoWindow.classList.add('hidden');
        if (event) event.preventDefault(); // ゴーストクリック防止
    }

    infoCloseBtn.addEventListener('click', closeInfoWindow);
    infoCloseBtn.addEventListener('touchend', closeInfoWindow);

    svg.on('click', closeInfoWindow);
    svg.on('touchend', (event) => {
        // ヘックス以外の部分(SVGの背景)をタップした時のみ閉じる
        if (event.target === svg.node()) {
            closeInfoWindow(event);
        }
    });

    d3.select('#toggleManaOverlay').on('click', function() { toggleLayerVisibility('mana-overlay', this, '龍脈表示', '龍脈非表示'); });
    d3.select('#toggleClimateZoneOverlay').on('click', function() { toggleLayerVisibility('climate-zone-overlay', this, '気候帯表示', '気候帯非表示'); });
    d3.select('#togglePrecipOverlay').on('click', function() { toggleLayerVisibility('precip-overlay', this, '降水量表示', '降水量非表示'); });
    d3.select('#toggleTempOverlay').on('click', function() { toggleLayerVisibility('temp-overlay', this, '気温表示', '気温非表示'); });
    d3.select('#toggleElevationOverlay').on('click', function() { toggleLayerVisibility('elevation-overlay', this, '土地利用消去', '土地利用表示'); });
    d3.select('#toggleAgriOverlay').on('click', function() { toggleLayerVisibility('agri-overlay', this, '農業', '農業'); });
    d3.select('#toggleForestOverlay').on('click', function() { toggleLayerVisibility('forest-overlay', this, '林業', '林業'); });
    d3.select('#toggleMiningOverlay').on('click', function() { toggleLayerVisibility('mining-overlay', this, '鉱業', '鉱業'); });
    d3.select('#toggleFishingOverlay').on('click', function() { toggleLayerVisibility('fishing-overlay', this, '漁業', '漁業'); });
    d3.select('#togglePopulationOverlay').on('click', function() { toggleLayerVisibility('population-overlay', this, '人口', '人口'); });

    // --- 5. 初期表示位置の設定 ---
    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        svg.call(zoom.transform, initialTransform);
    }
}