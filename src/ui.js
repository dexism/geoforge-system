// ================================================================
// GeoForge System - UIモジュール (v1.8 - 街道描画ロジック改修)
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
 * @param {Array<object>} roadPaths - 生成された全道路の経路データ
 */
export function setupUI(allHexes, roadPaths) {
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

            hexes.push({
                index: getIndex(col, row),
                x: col, y: (config.ROWS - 1) - row, cx: cx, cy: cy,
                points: d3.range(6).map(i => [cx + config.r * Math.cos(Math.PI / 3 * i), cy + config.r * Math.sin(Math.PI / 3 * i)]),
                properties: hexData.properties,
                downstreamIndex: downstreamIndex,
                neighbors: hexData.neighbors,
            });
        }
    }
    
    const childrenMap = new Map();
    allHexes.forEach((h, index) => {
        const parentId = h.properties.parentHexId;
        if (parentId !== null) {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId).push(index);
        }
    });

    // 河川描画のためのデータ前処理
    hexes.forEach(h => h.upstreamNeighbors = []);
    hexes.forEach(sourceHex => {
        if (sourceHex.downstreamIndex !== -1) {
            const targetHex = hexes[sourceHex.downstreamIndex];
            if (targetHex) {
                targetHex.upstreamNeighbors.push(sourceHex);
            }
        }
    });

    function getSharedEdgeMidpoint(hex1, hex2) {
        if (!hex1 || !hex2) return null;
        const commonPoints = [];
        for (const p1 of hex1.points) {
            for (const p2 of hex2.points) {
                if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) {
                    commonPoints.push(p1);
                }
            }
        }
        if (commonPoints.length === 2) {
            return [
                (commonPoints[0][0] + commonPoints[1][0]) / 2,
                (commonPoints[0][1] + commonPoints[1][1]) / 2
            ];
        }
        return null;
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
    const precipOverlayLayer = createLayer('precip-overlay', false);
    const tempOverlayLayer = createLayer('temp-overlay', false);
    const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false);
    const manaOverlayLayer = createLayer('mana-overlay', false);
    const agriOverlayLayer = createLayer('agri-overlay', false);
    const forestOverlayLayer = createLayer('forest-overlay', false);
    const miningOverlayLayer = createLayer('mining-overlay', false);
    const fishingOverlayLayer = createLayer('fishing-overlay', false);
    const populationOverlayLayer = createLayer('population-overlay', false);
    const territoryOverlayLayer = createLayer('territory-overlay', false);
    const highlightOverlayLayer = createLayer('highlight-overlay');
    const borderLayer = createLayer('border');
    const roadLayer = createLayer('road');
    const labelLayer = createLayer('labels');
    const interactionLayer = createLayer('interaction');

    // --- 3. 各レイヤーの描画 ---
    // 3a. 地形レイヤー (変更なし)
    terrainLayer.selectAll('.hex').data(hexes).enter().append('polygon')
    .attr('class', 'hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => {
        switch (d.properties.settlement) {
            case '首都': return '#f0f';
            case '都市': return '#f00';
            case '領都': return '#f60';
            case '街':   return '#fa0';
            case '町':   return '#ff0';
        }
        const veg = d.properties.vegetation;
        if (config.TERRAIN_COLORS[veg]) return config.TERRAIN_COLORS[veg];
        return config.getElevationColor(d.properties.elevation);
    });

    // 3b. 国境線レイヤー (変更なし)
    const borderSegments = [];
    hexes.forEach(h => {
        const hNation = h.properties.nationId;
        if (hNation === 0) return;

        h.neighbors.map(i => hexes[i]).forEach(n => {
            if (h.index < n.index) {
                const nNation = n.properties.nationId;
                if (nNation > 0 && hNation !== nNation) {
                    const commonPoints = [];
                    h.points.forEach(p1 => {
                        n.points.forEach(p2 => {
                            if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < 1e-6) {
                                commonPoints.push(p1);
                            }
                        });
                    });

                    if (commonPoints.length === 2) {
                        borderSegments.push({
                            p1: commonPoints[0],
                            p2: commonPoints[1]
                        });
                    }
                }
            }
        });
    });

    borderLayer.selectAll('.border-segment')
        .data(borderSegments)
        .enter().append('line')
        .attr('class', 'border-segment')
        .attr('x1', d => d.p1[0])
        .attr('y1', d => d.p1[1])
        .attr('x2', d => d.p2[0])
        .attr('y2', d => d.p2[1])
        .attr('stroke', '#a00')
        .attr('stroke-width', 4)
        .attr('stroke-linecap', 'round')
        .style('pointer-events', 'none');


    // 3c. 河川レイヤー (変更なし)
    const riverSegmentsData = [];
    hexes.filter(d => d.properties.flow > 0 && !d.properties.isWater).forEach(d => {
        const downstreamHex = d.downstreamIndex !== -1 ? hexes[d.downstreamIndex] : null;
        let endPoint = downstreamHex ? getSharedEdgeMidpoint(d, downstreamHex) : [d.cx, d.cy];
        if (!endPoint) endPoint = [d.cx, d.cy];

        const upstreamLandNeighbors = d.upstreamNeighbors.filter(n => !n.properties.isWater);

        if (upstreamLandNeighbors.length === 0) {
            const startPoint = [d.cx, d.cy];
            riverSegmentsData.push({ start: startPoint, end: endPoint, flow: d.properties.flow });
        } else {
            upstreamLandNeighbors.forEach(upstreamHex => {
                const startPoint = getSharedEdgeMidpoint(d, upstreamHex);
                if (startPoint) {
                    riverSegmentsData.push({ start: startPoint, end: endPoint, flow: upstreamHex.properties.flow });
                }
            });
        }
    });
    
    riverLayer.selectAll('.river-segment')
        .data(riverSegmentsData)
        .enter().append('line')
        .attr('class', 'river-segment')
        .attr('x1', d => d.start[0])
        .attr('y1', d => d.start[1])
        .attr('x2', d => d.end[0])
        .attr('y2', d => d.end[1])
        .attr('stroke', '#058')
        .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
        .attr('stroke-linecap', 'round')
        .style('pointer-events', 'none');


    // 3d. 積雪レイヤー (変更なし)
    snowLayer.selectAll('.snow-hex').data(hexes.filter(d => d.properties.hasSnow)).enter().append('polygon')
        .attr('class', 'snow-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', '#fff').style('fill-opacity', 0.8).style('pointer-events', 'none');

    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    // ★★★ [改修] 河川と同様に辺で結ぶ新しい街道描画ロジック ★★★
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    const roadSegments = [];
    // 1. 描画すべき全街道セグメントの情報を計算して配列に格納
    roadPaths.forEach(road => {
        // パスが2ヘックス未満の場合は描画できないのでスキップ
        if (road.path.length < 2) return;

        // パスの座標リストを、対応するヘックスオブジェクトのリストに変換
        const pathHexes = road.path.map(p => hexes[getIndex(p.x, p.y)]);

        // パスを構成する各ヘックス内での線分を計算
        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];
            let startPoint, endPoint;

            // [始点の決定]
            if (i === 0) {
                // パスの最初のヘックス：中心から開始
                startPoint = [currentHex.cx, currentHex.cy];
            } else {
                // 2番目以降のヘックス：前のヘックスとの境界線から開始
                const prevHex = pathHexes[i - 1];
                startPoint = getSharedEdgeMidpoint(currentHex, prevHex);
            }

            // [終点の決定]
            if (i === pathHexes.length - 1) {
                // パスの最後のヘックス：中心で終了
                endPoint = [currentHex.cx, currentHex.cy];
            } else {
                // 最後から2番目以前のヘックス：次のヘックスとの境界線で終了
                const nextHex = pathHexes[i + 1];
                endPoint = getSharedEdgeMidpoint(currentHex, nextHex);
            }
            
            // 始点と終点が正しく計算できた場合のみ、描画リストに追加
            if (startPoint && endPoint) {
                roadSegments.push({
                    start: startPoint,
                    end: endPoint,
                    level: road.level
                });
            }
        }
    });

    // 2. 計算されたセグメント情報を元に、一括でline要素を描画
    roadLayer.selectAll('.road-segment').data(roadSegments).enter().append('line')
        .attr('class', 'road-segment')
        .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
        .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
        .attr('stroke', d => {
            switch (d.level) {
                case 5: return '#a0f'; 
                case 4: return '#f00'; 
                case 3: return '#f00'; 
                case 2: return '#f00'; 
                case 1: return '#800'; 
                default: return '#000';
            }
        })
        .attr('stroke-width', d => {
            switch (d.level) {
                case 5: return 6.0; 
                case 4: return 4.0; 
                case 3: return 2.0; 
                case 2: return 1.0; 
                case 1: return 1.0; 
                default: return 1;
            }
        })
        .attr('stroke-dasharray', d => {
            if (d.level === 5) return '6, 6'; 
            if (d.level === 4) return '4, 4'; 
            if (d.level === 3) return '2, 2'; 
            if (d.level === 2) return '1, 1'; 
            if (d.level === 1) return '1, 2'; 
            return '2, 2';
        })
        .style('pointer-events', 'none');


    // 3f. 各種オーバーレイヤー (変更なし)
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
        .style('fill-opacity', 0.9).style('pointer-events', 'none');

    const nationColor = d3.scaleOrdinal(d3.schemeTableau10);
    territoryOverlayLayer.selectAll('.territory-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => d.properties.nationId === 0 ? '#555' : nationColor(d.properties.nationId))
        .style('fill-opacity', 0.5)
        .style('pointer-events', 'none');
        

    // --- 3g. 情報ウィンドウとインタラクション (以降、変更なし) ---
    function findAllDescendants(startIndex) {
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
    }

    function getInfoText(d) {
        const p = d.properties;
        let superiorText = 'なし';
        if (p.parentHexId != null) {
            const superiorHex = allHexes[p.parentHexId];
            if (superiorHex) {
                superiorText = `${superiorHex.properties.settlement} (E${superiorHex.col}-N${(config.ROWS-1)-superiorHex.row})`;
            }
        } else if (p.territoryId != null && getIndex(d.x, (config.ROWS - 1) - d.y) !== p.territoryId) {
            const territoryHub = allHexes[p.territoryId];
             if (territoryHub) {
                superiorText = `[中枢] ${territoryHub.properties.settlement} (E${territoryHub.col}-N${(config.ROWS-1)-territoryHub.row})`;
            }
        }

        const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] 
            ? config.NATION_NAMES[p.nationId - 1] 
            : '辺境';

        let text = `座標　　：E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
                   `所属国家：${nationName}\n` +
                   `直轄上位：${superiorText}\n`+
                   `土地利用： ${p.vegetation}${p.isAlluvial ? ' (河川)' : ''}${p.hasSnow ? ' (積雪)' : ''}\n` +
                   `人口　　： ${p.population.toLocaleString()}人\n` +
                   `農地面積： ${Math.round(p.cultivatedArea).toLocaleString()} ha\n` +
                   `居住適性： ${p.habitability.toFixed(1)}\n` +
                   `--- 土地詳細 ---\n` +
                   `気候帯　： ${p.climateZone}\n` +
                   `標高　　： ${Math.round(p.elevation)}m\n` +
                   `気温　　： ${p.temperature.toFixed(1)}℃\n` +
                   `降水量　： ${(p.precipitation * 100).toFixed(0)}%\n` +
                   `魔力　　： ${p.manaRank}\n` +
                   `資源　　： ${p.resourceRank}\n` +
                   `--- 資源ポテンシャル ---\n` +
                   `農業適正： ${(p.agriPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `林業適正： ${(p.forestPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `鉱業適正： ${(p.miningPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                   `漁業適正： ${(p.fishingPotential * 100).toFixed(0).padStart(3, ' ')}%`;

        const surplusKeys = Object.keys(p.surplus || {});
        const shortageKeys = Object.keys(p.shortage || {});
        if (Object.keys(p.production || {}).length > 0 || surplusKeys.length > 0 || shortageKeys.length > 0) {
            text += `\n--- 食料需給 (t/年) ---`;
            const productionText = Object.entries(p.production || {})
                .map(([crop, amount]) => `${crop} ${Math.round(amount).toLocaleString()}`)
                .join('t\n　　　') + 't';
            if(Object.keys(p.production || {}).length > 0) text += `\n生産：${productionText}`;
            if (surplusKeys.length > 0) text += `\n余剰：${surplusKeys.map(key => `${key} ${p.surplus[key]}`).join('t\n　　　')}t`;
            if (shortageKeys.length > 0) text += `\n不足：${shortageKeys.map(key => `${key} ${p.shortage[key]}`).join('t\n　　　')}t`;
        }
        
        if (['首都', '都市', '領都'].includes(p.settlement) && p.territoryData) {
            const data = p.territoryData;
            text += `\n--- 庇護下領域 集計 ---`;

            const settlementCountText = Object.entries(data.settlementCounts)
                .filter(([, count]) => count > 0)
                .map(([type, count]) => {
                    const shortName = { '都市': '都', '領都': '領', '街': '街', '町': '町', '村': '村' }[type];
                    return `${shortName}${count}`;
                })
                .join(', ');
            if(settlementCountText) text += `\n直轄地　： ${settlementCountText}`;

            text += `\n合計人口： ${data.population.toLocaleString()}人`;
            text += `\n合計農地： ${Math.round(data.cultivatedArea).toLocaleString()}ha`;

            const totalProductionText = Object.entries(data.production)
                .map(([crop, amount]) => `${crop} ${Math.round(amount).toLocaleString()}t`)
                .join('\n　　　　　');
            text += `\n生産合計：${totalProductionText}`;

            const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement];
            const totalDemand = data.population * settlementInfo.consumption_t_per_person; 
            const totalSupply = Object.values(data.production).reduce((a, b) => a + b, 0);
            const balance = totalSupply - totalDemand;
            
            if (balance >= 0) {
                text += `\n食料収支：+${Math.round(balance).toLocaleString()}t の余剰`;
            } else {
                text += `\n食料収支：${Math.round(balance).toLocaleString()}t の不足`;
            }
        }
        
        return text;
    }
    
    function updateInfoWindow(d) {
        infoCoord.textContent = `E${String(d.x).padStart(2, '0')} - N${String(d.y).padStart(2, '0')}`;
        infoContent.textContent = getInfoText(d);
        infoWindow.classList.remove('hidden');
    }

    const interactiveHexes = interactionLayer.selectAll('.interactive-hex')
        .data(hexes).enter().append('polygon')
        .attr('class', 'interactive-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .style('fill', 'transparent').style('cursor', 'pointer');

    interactiveHexes.append('title').text(d => getInfoText(d));

    interactiveHexes.on('click', (event, d) => {
        highlightOverlayLayer.selectAll('*').remove();
        const p = d.properties;

        if (['首都', '都市', '領都', '街', '町', '村'].includes(p.settlement)) {
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
            
            const descendants = findAllDescendants(d.index);
            
            if (descendants.length > 0) {
                const maxDepth = Math.max(0, ...descendants.map(item => item.depth));
                const colorScale = d3.scaleLinear()
                    .domain([2, Math.max(2, maxDepth)])
                    .range(['#660000', 'black'])
                    .interpolate(d3.interpolateRgb);

                descendants.forEach(item => {
                    let color;
                    if (item.depth === 1) {
                        color = 'red';
                    } else {
                        color = colorScale(item.depth);
                    }
                    
                    highlightOverlayLayer.append('polygon')
                        .attr('points', item.hex.points.map(pt => pt.join(',')).join(' '))
                        .attr('fill', color)
                        .style('fill-opacity', 0.8)
                        .style('pointer-events', 'none');
                });
            }
        }
        
        updateInfoWindow(d);
        event.stopPropagation();
    });
        
    const hexLabelGroups = labelLayer.selectAll('.hex-label-group').data(hexes).enter().append('g');
    hexLabelGroups.append('text').attr('class', 'hex-label')
        .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => `${String(d.x).padStart(2, '0')}${String(d.y).padStart(2, '0')}`);
    hexLabelGroups.filter(d => d.properties.settlement).append('text').attr('class', 'settlement-label')
        .attr('x', d => d.cx).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .text(d => d.properties.settlement);
    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx - config.r * 0.7).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => d.properties.manaRank);
    hexLabelGroups.append('text').attr('class', 'property-label')
        .attr('x', d => d.cx + config.r * 0.7).attr('y', d => d.cy)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('display', 'none')
        .text(d => d.properties.resourceRank);
    
    const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
        g.attr('transform', event.transform);
        const effectiveRadius = config.r * event.transform.k;
        labelLayer.selectAll('.hex-label, .property-label')
            .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
    });
    svg.call(zoom);

    function closeInfoWindow(event) {
        infoWindow.classList.add('hidden');
        highlightOverlayLayer.selectAll('*').remove();
        if (event) event.preventDefault();
    }
    infoCloseBtn.addEventListener('click', closeInfoWindow);
    infoCloseBtn.addEventListener('touchend', closeInfoWindow);
    svg.on('click', closeInfoWindow);
    svg.on('touchend', (event) => {
        if (event.target === svg.node()) { closeInfoWindow(event); }
    });

    d3.select('#toggleManaOverlay').on('click', function() { toggleLayerVisibility('mana-overlay', this, '龍脈表示', '龍脈非表示'); });
    d3.select('#toggleClimateZoneOverlay').on('click', function() { toggleLayerVisibility('climate-zone-overlay', this, '気候帯表示', '気候帯非表示'); });
    d3.select('#togglePrecipOverlay').on('click', function() { toggleLayerVisibility('precip-overlay', this, '降水量表示', '降水量非表示'); });
    d3.select('#toggleTempOverlay').on('click', function() { toggleLayerVisibility('temp-overlay', this, '気温表示', '気温非表示'); });
    d3.select('#toggleElevationOverlay').on('click', function() { toggleLayerVisibility('elevation-overlay', this, '土地利用非表示', '土地利用表示'); });
    d3.select('#toggleAgriOverlay').on('click', function() { toggleLayerVisibility('agri-overlay', this, '農業', '農業'); });
    d3.select('#toggleForestOverlay').on('click', function() { toggleLayerVisibility('forest-overlay', this, '林業', '林業'); });
    d3.select('#toggleMiningOverlay').on('click', function() { toggleLayerVisibility('mining-overlay', this, '鉱業', '鉱業'); });
    d3.select('#toggleFishingOverlay').on('click', function() { toggleLayerVisibility('fishing-overlay', this, '漁業', '漁業'); });
    d3.select('#togglePopulationOverlay').on('click', function() { toggleLayerVisibility('population-overlay', this, '人口分布', '人口分布'); });
    d3.select('#toggleTerritoryOverlay').on('click', function() { toggleLayerVisibility('territory-overlay', this, '領地表示', '領地非表示'); });

    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        svg.call(zoom.transform, initialTransform);
    }
}