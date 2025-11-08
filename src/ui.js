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

    // ★★★ [新規] 稜線描画のためのデータ前処理 ★★★
    hexes.forEach(h => {
        // 稜線がどこに向かうか（最も標高が高い隣人）のインデックスを計算
        let highestNeighborIndex = -1;
        if (h.properties.ridgeFlow > 0 && !h.properties.isWater) {
            let highestNeighbor = null;
            let maxElevation = h.properties.elevation;
            h.neighbors.map(i => hexes[i]).forEach(n => {
                if (n.properties.elevation > maxElevation) {
                    maxElevation = n.properties.elevation;
                    highestNeighbor = n;
                }
            });
            if (highestNeighbor) {
                highestNeighborIndex = highestNeighbor.index;
            }
        }
        h.ridgeUpstreamIndex = highestNeighborIndex;
    });
    // 逆引きマップを作成
    hexes.forEach(h => h.downstreamRidgeNeighbors = []);
    hexes.forEach(sourceHex => {
        if (sourceHex.ridgeUpstreamIndex !== -1) {
            const targetHex = hexes[sourceHex.ridgeUpstreamIndex];
            if (targetHex) {
                targetHex.downstreamRidgeNeighbors.push(sourceHex);
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

    const terrainLayer = createLayer('terrain');                                // 地形
    const snowLayer = createLayer('snow');                                      // 積雪
    const whiteMapOverlayLayer = createLayer('white-map-overlay', false);       // 白地図
    const elevationOverlayLayer = createLayer('elevation-overlay', false);      // 土地利用
    const riverLayer = createLayer('river');                                    // 河川
    const precipOverlayLayer = createLayer('precip-overlay', false);            // 降水量
    const tempOverlayLayer = createLayer('temp-overlay', false);                // 気温
    const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false); // 気候帯
    const settlementLayer = createLayer('settlement');                          // 集落
    const manaOverlayLayer = createLayer('mana-overlay', false);                // 龍脈
    const agriOverlayLayer = createLayer('agri-overlay', false);                // 農業
    const forestOverlayLayer = createLayer('forest-overlay', false);            // 林業
    const miningOverlayLayer = createLayer('mining-overlay', false);            // 鉱業
    const fishingOverlayLayer = createLayer('fishing-overlay', false);          // 漁業
    const populationOverlayLayer = createLayer('population-overlay', false);    // 人口
    const territoryOverlayLayer = createLayer('territory-overlay', false);      // 領土
    const ridgeWaterSystemLayer = createLayer('ridge-water-system', false);     // 稜線水系
    const highlightOverlayLayer = createLayer('highlight-overlay');             // ハイライト
    const borderLayer = createLayer('border');                                  // 国境
    const roadLayer = createLayer('road');                                      // 道路
    const labelLayer = createLayer('labels');                                   // ラベル
    const interactionLayer = createLayer('interaction');                        // インタラクション

    // --- 3. 各レイヤーの描画 ---
    // 3a. 地形レイヤー (変更なし)
    terrainLayer.selectAll('.hex').data(hexes).enter().append('polygon')
    .attr('class', 'hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => {
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

    // ★★★ [新規] 白地図オーバーレイの描画 ★★★
    whiteMapOverlayLayer.selectAll('.white-map-hex')
        .data(hexes)
        .enter().append('polygon')
        .attr('class', 'white-map-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => {
            if (d.properties.isWater) return config.WHITE_MAP_COLORS.WATER;
            if (d.properties.terrainType === '山岳') return config.WHITE_MAP_COLORS.MOUNTAIN_PEAK;
            if (d.properties.terrainType === '山地') return config.WHITE_MAP_COLORS.MOUNTAIN;
            return config.WHITE_MAP_COLORS.LAND;
        })
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
    
    // 3c-2. 稜線部分 (茶色)
    const ridgeSegmentsData = [];
    hexes.filter(d => d.properties.ridgeFlow > 0 && !d.properties.isWater).forEach(d => {
        const upstreamHex = d.ridgeUpstreamIndex !== -1 ? hexes[d.ridgeUpstreamIndex] : null;
        let endPoint = upstreamHex ? getSharedEdgeMidpoint(d, upstreamHex) : [d.cx, d.cy];
        if (!endPoint) endPoint = [d.cx, d.cy];

        const downstreamRidgeNeighbors = d.downstreamRidgeNeighbors.filter(n => !n.properties.isWater);

        if (downstreamRidgeNeighbors.length === 0) {
            const startPoint = [d.cx, d.cy];
            ridgeSegmentsData.push({ start: startPoint, end: endPoint, flow: d.properties.ridgeFlow });
        } else {
            downstreamRidgeNeighbors.forEach(downstreamHex => {
                const startPoint = getSharedEdgeMidpoint(d, downstreamHex);
                if (startPoint) {
                    ridgeSegmentsData.push({ start: startPoint, end: endPoint, flow: downstreamHex.properties.ridgeFlow });
                }
            });
        }
    });

    // 通常の河川レイヤー描画
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

    // ★★★ [新規] 稜線水系図レイヤーの描画 ★★★
    // 3c-1. 水系部分 (青)
    ridgeWaterSystemLayer.selectAll('.rws-water-hex')
        .data(hexes.filter(d => d.properties.isWater))
        .enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', '#0077be'); // 鮮やかな青
    
    ridgeWaterSystemLayer.selectAll('.rws-river-segment')
        .data(riverSegmentsData) // 既存の重複排除済み河川データを利用
        .enter().append('line')
        .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
        .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
        .attr('stroke', '#07c')
        .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
        .attr('stroke-linecap', 'round');

    ridgeWaterSystemLayer.selectAll('.rws-ridge-segment')
        .data(ridgeSegmentsData)
        .enter().append('line')
        .attr('x1', d => d.start[0]).attr('y1', d => d.start[1])
        .attr('x2', d => d.end[0]).attr('y2', d => d.end[1])
        .attr('stroke', '#a00') // 茶色 (SaddleBrown)
        .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8)) // 川より少し細めに
        .attr('stroke-linecap', 'round');

    // 3d. 積雪レイヤー (変更なし)
    snowLayer.selectAll('.snow-hex').data(hexes.filter(d => d.properties.hasSnow)).enter().append('polygon')
        .attr('class', 'snow-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', '#fff').style('fill-opacity', 0.8).style('pointer-events', 'none');

    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    // ★★★ [改修] 重複を排除する新しい街道描画ロジック ★★★
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    const finalRoadSegments = [];
    const roadSegmentGrid = new Map(); // 描画済みセグメントを記録する (key: "minIdx-maxIdx")

    // 1. 道路をレベルが高い順にソートする (交易路が先に来るように)
    const sortedRoadPaths = [...roadPaths].sort((a, b) => b.level - a.level);

    // 2. ソートされたパスをループして、重複しないセグメントだけを finalRoadSegments に追加
    sortedRoadPaths.forEach(road => {
        if (road.path.length < 2) return;
        const pathHexes = road.path.map(p => hexes[getIndex(p.x, p.y)]);

        for (let i = 0; i < pathHexes.length; i++) {
            const currentHex = pathHexes[i];
            if (!currentHex) continue; // 念のため

            let startPoint, endPoint;
            
            // 2a. 線分の始点と終点を計算 (既存の辺から辺へのロジック)
            if (i === 0) {
                startPoint = [currentHex.cx, currentHex.cy];
            } else {
                startPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i - 1]);
            }
            if (i === pathHexes.length - 1) {
                endPoint = [currentHex.cx, currentHex.cy];
            } else {
                endPoint = getSharedEdgeMidpoint(currentHex, pathHexes[i + 1]);
            }

            // 2b. 始点と終点から、そのセグメントがどのヘックス間を結ぶかを特定
            const prevHex = i > 0 ? pathHexes[i - 1] : currentHex;
            const nextHex = i < pathHexes.length - 1 ? pathHexes[i + 1] : currentHex;
            
            // 2c. 始点・終点に対応するヘックス間のユニークなIDを作成
            const fromIndex = (i === 0) ? currentHex.index : prevHex.index;
            const toIndex = (i === pathHexes.length - 1) ? currentHex.index : nextHex.index;
            const segmentKey = Math.min(fromIndex, toIndex) + '-' + Math.max(fromIndex, toIndex);

            // 2d. 重複チェック
            if (startPoint && endPoint && !roadSegmentGrid.has(segmentKey)) {
                roadSegmentGrid.set(segmentKey, true); // このセグメントは描画済みとして記録
                finalRoadSegments.push({
                    start: startPoint,
                    end: endPoint,
                    level: road.level
                });
            }
        }
    });

    // 3. 最終的に重複排除されたセグメントリストを使って描画
    roadLayer.selectAll('.road-segment').data(finalRoadSegments).enter().append('line')
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

    // ★★★ [新規] 集落専用レイヤーの描画 ★★★
    settlementLayer.selectAll('.settlement-hex')
        // 町以上の集落のみをデータとして選択
        .data(hexes.filter(d => ['町', '街', '領都', '首都'].includes(d.properties.settlement)))
        .enter().append('polygon')
        .attr('class', 'settlement-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => {
            // 元の地形レイヤーにあった色分けロジックをここに移動
            switch (d.properties.settlement) {
                case '首都': return '#f0f';
                case '都市': return '#f00'; // 都市は現在このリストに含まれていないが、念のため残す
                case '領都': return '#f60';
                case '街':   return '#fa0';
                case '町':   return '#ff0';
            }
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
                // ★★★ [変更] 道のりと移動日数を併記するロジック ★★★
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

        let landUseText;
        if (p.isWater) {
            // 水域の場合は、従来通り '海洋', '湖沼' などを表示
            landUseText = p.vegetation;
        } else {
            // 陸地の場合は、各要素を配列に格納してから連結する
            const landUseParts = [];
            if (p.terrainType) {
                landUseParts.push(p.terrainType); // "平地", "丘陵" など
            }
            if (p.vegetation) {
                landUseParts.push(p.vegetation); // "森林", "草原" など
            }
            if (p.isAlluvial) {
                landUseParts.push('河川');
            }
            if (p.hasSnow) {
                landUseParts.push('積雪');
            }
            landUseText = landUseParts.join(', '); // "丘陵, 荒れ地" のように連結
        }

        const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] 
            ? config.NATION_NAMES[p.nationId - 1] 
            : '辺境';

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
        // infoCoord.textContent = `E${String(d.x).padStart(2, '0')} - N${String(d.y).padStart(2, '0')}`;
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

    // 4. 白地図モードの切り替えイベントハンドラ
    d3.select('#toggleWhiteMapOverlay').on('click', function() {
        const turnOn = !layers['white-map-overlay'].visible;
        toggleLayerVisibility('white-map-overlay', this, '白地図表示', '通常表示');
        
        // ★★★ [変更] 地形レイヤーに加えて、集落レイヤーも考慮 ★★★
        // 白地図ON -> 通常地形OFF
        terrainLayer.style('display', turnOn ? 'none' : 'inline');
        snowLayer.style('display', turnOn ? 'none' : 'inline');
        
        // 川の色を白地図モードに合わせて変更
        riverLayer.selectAll('.river-segment')
            .attr('stroke', turnOn ? config.WHITE_MAP_COLORS.WATER : '#058');
        
        // ★★★ [変更] 集落レイヤーは常に表示されるので、操作は不要 ★★★
        // これにより、白地図の上にも集落が表示される
    });

    // ★★★ [新規] 稜線水系図の切り替えイベントハンドラ ★★★
    d3.select('#toggleRidgeWaterSystemOverlay').on('click', function() {
        toggleLayerVisibility('ridge-water-system', this, '稜線水系図', '通常表示');
    });

    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        svg.call(zoom.transform, initialTransform);
    }
}