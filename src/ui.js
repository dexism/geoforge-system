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
                index: getIndex(col, row),
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
    const territoryOverlayLayer = createLayer('territory-overlay', false); // ★★★ 新規追加 ★★★
    const highlightOverlayLayer = createLayer('highlight-overlay');
    const borderLayer = createLayer('border');
    const labelLayer = createLayer('labels');
    const interactionLayer = createLayer('interaction');

    // --- 3. 各レイヤーの描画 ---
    // 3a. 地形レイヤー
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

    // 3b. 国境線レイヤー
    const borderSegments = [];
    hexes.forEach(h => {
        const hNation = h.properties.nationId;
        if (hNation === 0) return; // 辺境は国境線の起点にならない

        h.neighbors.map(i => hexes[i]).forEach(n => {
            // 重複描画を避けるため、インデックスが小さい方から大きい方へのみ線を描画
            if (h.index < n.index) {
                const nNation = n.properties.nationId;
                // 隣接ヘックスが異なる国の場合、国境とみなす
                if (nNation > 0 && hNation !== nNation) {
                    // 2つのヘックスに共通する頂点を探す
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
        .attr('stroke', '#a00') // 赤色
        .attr('stroke-width', 4)
        .attr('stroke-linecap', 'round')
        .style('pointer-events', 'none');

    // 3b. 川レイヤー (変更なし)
    riverLayer.selectAll('.river-path').data(hexes.filter(d => d.properties.flow > 0 && d.downstream)).enter().append('line')
        .attr('class', 'river-path')
        .attr('x1', d => d.cx).attr('y1', d => d.cy)
        .attr('x2', d => d.downstream.cx).attr('y2', d => d.downstream.cy)
        .attr('stroke', '#058')
        .attr('stroke-width', d => Math.min(Math.sqrt(d.properties.flow) * 2, config.r))
        .attr('stroke-linecap', 'round').style('pointer-events', 'none');

    // 3c. 積雪レイヤー (変更なし)
    snowLayer.selectAll('.snow-hex').data(hexes.filter(d => d.properties.hasSnow)).enter().append('polygon')
        .attr('class', 'snow-hex')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', '#fff').style('fill-opacity', 0.8).style('pointer-events', 'none');

    // 3d. 街道レイヤー (変更なし)
    const roadSegments = [];
    hexes.forEach(h => {
        if (h.properties.roadLevel > 0) {
            h.neighbors.map(i => hexes[i]).forEach(n => {
                if (n && n.properties.roadLevel > 0) {
                    if (getIndex(h.x, (config.ROWS - 1) - h.y) < getIndex(n.x, (config.ROWS - 1) - n.y)) {
                        const level = Math.min(h.properties.roadLevel, n.properties.roadLevel);
                        roadSegments.push({
                            source: { cx: h.cx, cy: h.cy },
                            target: { cx: n.cx, cy: n.cy },
                            level: level
                        });
                    }
                }
            });
        }
    });
    roadLayer.selectAll('.road-segment').data(roadSegments).enter().append('line')
    .attr('x1', d => d.source.cx).attr('y1', d => d.source.cy)
    .attr('x2', d => d.target.cx).attr('y2', d => d.target.cy)
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
            case 5: return 4.0; 
            case 4: return 4.0; 
            case 3: return 1.0; 
            case 2: return 0.5; 
            case 1: return 0.5; 
            default: return 1;
        }
    })
    .attr('stroke-dasharray', d => {
        if (d.level === 5) return '8, 4'; 
        if (d.level === 2) return '2, 1'; 
        if (d.level === 1) return '1, 2'; 
        return '4, 2';
    })
    .style('pointer-events', 'none');

    // 3e. 各種オーバーレイヤー (変更なし)
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

    // ★★★ [更新] 領地オーバーレイヤーの描画ロジック ★★★
    const nationColor = d3.scaleOrdinal(d3.schemeTableau10); // 色覚多様性対応のカラースケール
    territoryOverlayLayer.selectAll('.territory-hex').data(hexes).enter().append('polygon')
        .attr('points', d => d.points.map(p => p.join(',')).join(' '))
        .attr('fill', d => d.properties.nationId === 0 ? '#555' : nationColor(d.properties.nationId))
        .style('fill-opacity', 0.5)
        .style('pointer-events', 'none');
        
    // ★★★ [バグ修正版 v6] 支配下の全領土を正しく取得する最終修正版 ★★★
    function getVassalTerritories(startHub, allHexes) {
        const territories = new Map();
        const allSettlements = allHexes.filter(h => h.properties.settlement);
        const startHubId = getIndex(startHub.col, startHub.row);

        // 探索キュー。 [集落ID, 階層の深さ] を格納
        const queue = [[startHubId, 0]];
        const visited = new Set([startHubId]);

        // 1. まず、支配下の全集落を幅優先探索(BFS)でリストアップする
        const vassalSettlements = [];
        let head = 0;
        while(head < queue.length) {
            const [parentId, depth] = queue[head++];
            
            const parentSettlement = allHexes[parentId];
            if(parentSettlement) {
                vassalSettlements.push({settlement: parentSettlement, depth: depth});
            }

            allSettlements.forEach(s => {
                if (s.properties.parentHexId === parentId) {
                    const childId = getIndex(s.col, s.row);
                    if (!visited.has(childId)) {
                        visited.add(childId);
                        queue.push([childId, depth + 1]);
                    }
                }
            });
        }
        
        // 2. リストアップした集落が所属する領土(territoryId)ごとにグループ化する
        vassalSettlements.forEach(({settlement, depth}) => {
            const terrId = settlement.properties.territoryId;
            if (terrId != null) {
                if (!territories.has(terrId)) {
                    territories.set(terrId, { depth: depth, hexes: [] });
                }
            }
        });

        // 3. ★★★ [バグ修正] 描画用の `hexes` 配列からデータを構築する ★★★
        hexes.forEach(h => { // allHexes -> hexes に修正
            const terrId = h.properties.territoryId;
            if (territories.has(terrId)) {
                territories.get(terrId).hexes.push(h);
            }
        });

        return territories;
    }

    // --- 3f. 情報ウィンドウとインタラクション ---
    // ★★★ [更新] 情報を整形する共有関数 ★★★
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

        // ★★★ [復元] あなたの元の詳細な情報表示を完全に復元 ★★★
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
        // ★★★ [修正] 食料需給セクションを、生産量->余剰/不足の順で表示するように整形 ★★★
        if (Object.keys(p.production || {}).length > 0 || surplusKeys.length > 0 || shortageKeys.length > 0) {
            text += `\n--- 食料需給 (t/年) ---`;
            const productionText = Object.entries(p.production || {})
                .map(([crop, amount]) => `${crop} ${Math.round(amount).toLocaleString()}`)
                .join('t\n　　　') + 't';
            if(Object.keys(p.production || {}).length > 0) text += `\n生産：${productionText}`;
            if (surplusKeys.length > 0) text += `\n余剰：${surplusKeys.map(key => `${key} ${p.surplus[key]}`).join('t\n　　　')}t`;
            if (shortageKeys.length > 0) text += `\n不足：${shortageKeys.map(key => `${key} ${p.shortage[key]}`).join('t\n　　　')}t`;
        }
        
        // ★★★ [新規] 主要都市の場合、庇護下の集計情報を表示 ★★★
        if (['首都', '都市', '領都'].includes(p.settlement) && p.territoryData) {
            const data = p.territoryData;
            text += `\n--- 庇護下領域 集計 ---`;

            // ★★★ [新規] 庇護下集落の数を指定フォーマットで表示 ★★★
            const settlementCountText = Object.entries(data.settlementCounts)
                .filter(([, count]) => count > 0) // 数が0のものは表示しない
                .map(([type, count]) => {
                    // あなたの指定フォーマットに合わせてタイプ名を短縮
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
    
    // 情報ウィンドウを更新する関数
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
    // ★★★ [バグ修正版 v5] クリック時の階層ハイライト処理 ★★★
    interactiveHexes.on('click', (event, d) => {
        highlightOverlayLayer.selectAll('*').remove();

        const p = d.properties;
        if (['首都', '都市', '領都'].includes(p.settlement)) {
            const vassalTerritories = getVassalTerritories(allHexes[d.index], allHexes);
            
            if (vassalTerritories.size > 0) {
                const maxDepth = Math.max(0, ...Array.from(vassalTerritories.values()).map(v => v.depth));
                const colorScale = d3.scaleLinear()
                    .domain([0, Math.max(1, maxDepth)])
                    .range(['red', 'black'])
                    .interpolate(d3.interpolateRgb);

                vassalTerritories.forEach((data, territoryId) => {
                    // ここで data と data.hexes が存在することは保証されている
                    highlightOverlayLayer.selectAll(`.highlight-hex-${territoryId}`)
                        .data(data.hexes)
                        .enter().append('polygon')
                        .attr('class', `highlight-hex-${territoryId}`)
                        .attr('points', h => h.points.map(pt => pt.join(',')).join(' '))
                        .attr('fill', colorScale(data.depth))
                        .style('fill-opacity', 0.7)
                        .style('pointer-events', 'none');
                });
            }
        }

        updateInfoWindow(d);
        event.stopPropagation();
    });
        
    // 3g. ラベルレイヤーの描画 (変更なし)
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
    
    // --- 4. ZoomとUIイベントハンドラ ---
    const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
        g.attr('transform', event.transform);
        const effectiveRadius = config.r * event.transform.k;
        labelLayer.selectAll('.hex-label, .property-label')
            .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
    });
    svg.call(zoom);

    // ★★★ [更新] ウィンドウを閉じる際にハイライトもクリアする ★★★
    function closeInfoWindow(event) {
        infoWindow.classList.add('hidden');
        highlightOverlayLayer.selectAll('*').remove(); // ハイライトをクリア
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
    d3.select('#toggleElevationOverlay').on('click', function() { toggleLayerVisibility('elevation-overlay', this, '土地利用消去', '土地利用表示'); });
    d3.select('#toggleAgriOverlay').on('click', function() { toggleLayerVisibility('agri-overlay', this, '農業', '農業'); });
    d3.select('#toggleForestOverlay').on('click', function() { toggleLayerVisibility('forest-overlay', this, '林業', '林業'); });
    d3.select('#toggleMiningOverlay').on('click', function() { toggleLayerVisibility('mining-overlay', this, '鉱業', '鉱業'); });
    d3.select('#toggleFishingOverlay').on('click', function() { toggleLayerVisibility('fishing-overlay', this, '漁業', '漁業'); });
    d3.select('#togglePopulationOverlay').on('click', function() { toggleLayerVisibility('population-overlay', this, '人口', '人口'); });
    // ★★★ 新規：領地表示ボタンのイベントハンドラ ★★★
    d3.select('#toggleTerritoryOverlay').on('click', function() { toggleLayerVisibility('territory-overlay', this, '領地表示', '領地非表示'); });

    // --- 5. 初期表示位置の設定 ---
    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        svg.call(zoom.transform, initialTransform);
    }
}