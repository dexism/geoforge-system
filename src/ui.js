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
// 凡例表示用コンテナをグローバル変数として保持
let legendContainer = null;

let hexes = []; // 描画用データ（座標などを含む）
let roadPathsData = [];
let svg;        // SVG要素
let currentTransform = d3.zoomIdentity; // 現在のズーム状態
let allHexesData = [];
let infoWindow;
let infoContent;
let childrenMap = new Map();
const nationColor = d3.scaleOrdinal(d3.schemeTableau10); // 国家ごとの色を固定するためのカラースケール
// ミニマップ関連の変数を追加
let minimapContainer;
let minimapSvg;
let minimapViewport;
let minimapScaleX;
let minimapScaleY;

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
 * 魔物分布の凡例を生成する
 */
function createMonsterLegend() {
    let itemsHtml = '';
    // 各ランクの説明を追加
    const rankDescriptions = {
        'S': '伝説級',
        'A': '高脅威',
        'B': '危険',
        'C': '要注意',
        'D': '低脅威'
    };

    // config.jsから色情報を取得して凡例項目を生成
    for (const [rank, color] of Object.entries(config.MONSTER_COLORS)) {
        const description = rankDescriptions[rank] || '';
        itemsHtml += `
            <div class="legend-item">
                <div class="legend-color-box" style="background-color: ${color};"></div>
                <span>${rank}ランク: ${description}</span>
            </div>
        `;
    }
    return `<h4>魔物分布凡例</h4>${itemsHtml}`;
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
        case 'monster-overlay': 
            legendHtml = createMonsterLegend();
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

/**
 * 道路網レイヤーを再描画する関数
 * @param {Array<object>} roadPaths - 描画対象の道路データ
 */
function drawRoads(roadPaths) {
    // 1. 古い道路をクリア
    layers.road.group.selectAll('*').remove();
    if (!roadPaths || roadPaths.length === 0) return;

    // 2. 新しい道路データを描画 (setupUIからロジックを移植)
    const roadPathData = [];
    const roadSegmentGrid = new Map();

    // roadPathData に nationId を追加
    [...roadPaths].sort((a, b) => b.level - a.level).forEach(road => {
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
            const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
            const fromIndex = prevHex ? prevHex.index : currentHex.index;
            const toIndex = nextHex ? nextHex.index : currentHex.index;
            const segmentKey = Math.min(fromIndex, toIndex) + '-' + Math.max(fromIndex, toIndex);
            if (!roadSegmentGrid.has(segmentKey)) {
                roadSegmentGrid.set(segmentKey, true);
                // ★★★ [修正] nationIdを渡す ★★★
                roadPathData.push({ path: path, level: road.level, nationId: road.nationId });
            }
        }
    });

    layers.road.group.selectAll('.road-segment')
        .data(roadPathData).enter()
        .append('path')
            .attr('class', 'road-segment')
            .attr('d', d => d.path)
            // 国籍に応じて色を変える
            .attr('stroke', d => ({ 
                6: '#f0f', // 通商路
                5: '#f00', // 交易路 (紫)
                4: '#f80', // 街道 (赤)
                3: '#ff0', // 町道 (赤)
                2: '#0f0', // 村道 (赤)
                1: '#800'  // その他 (暗赤)
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
}

/**
 * 国境線レイヤーを再描画する関数
 */
function drawBorders() {
    // 1. 古い国境をクリア
    layers.border.group.selectAll('*').remove();

    // 2. 新しい国境データを計算して描画 (setupUIからロジックを移植)
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

    layers.border.group.selectAll('.border-segment')
        .data(borderSegments).enter().append('line')
        .attr('class', 'border-segment')
        .attr('x1', d => d.p1[0]).attr('y1', d => d.p1[1])
        .attr('x2', d => d.p2[0]).attr('y2', d => d.p2[1])
        .attr('stroke', '#f00').attr('stroke-width', 4)
        .attr('stroke-linecap', 'round').style('pointer-events', 'none');
}

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
        const superiorHex = allHexesData[p.parentHexId]; 
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
        const territoryHub = allHexesData[p.territoryId]; 
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
    
    // 未定義の可能性があるプロパティにデフォルト値を設定
    const population = p.population ?? 0;
    const cultivatedArea = p.cultivatedArea ?? 0;
    const habitability = p.habitability ?? 0;
    
    // --- 全ての情報を結合して最終的なテキストを生成 ---
    let text = `座標　　：E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
                `所属国家：${nationName}\n` +
                `直轄上位：${superiorText}\n`+
                `土地利用： ${landUseText}\n` +
                `人口　　： ${population.toLocaleString()}人\n` +
                `農地面積： ${Math.round(cultivatedArea).toLocaleString()} ha\n` +
                `居住適性： ${habitability.toFixed(1)}\n` +
                `--- 土地詳細 ---\n` +
                `気候帯　： ${p.climateZone}\n` +
                `標高　　： ${Math.round(p.elevation)}m\n` +
                `気温　　： ${p.temperature.toFixed(1)}℃\n` +
                `降水量　： ${p.precipitation_mm.toFixed(0)}mm/年\n` +
                `魔力　　： ${p.manaRank}\n` +
                `資源　　： ${p.resourceRank}\n` +
                `魔物分布： ${(p.monsterRank ? p.monsterRank + 'ランク' : '観測されず')}\n` +
                `--- 資源ポテンシャル ---\n` +
                `農業適性： ${(p.agriPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                `林業適性： ${(p.forestPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                `鉱業適性： ${(p.miningPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
                `漁業適性： ${(p.fishingPotential * 100).toFixed(0).padStart(3, ' ')}%\n` + 
                `狩猟適性： ${(p.huntingPotential * 100).toFixed(0).padStart(3, ' ')}%\n` + 
                `牧畜適性： ${(p.pastoralPotential * 100).toFixed(0).padStart(3, ' ')}%\n` + 
                `家畜適性： ${(p.livestockPotential * 100).toFixed(0).padStart(3, ' ')}%`;
    
    // --- 食料需給情報の追加 (経済シミュレーション後にのみ表示) ---
    if (p.production) {
        const surplusKeys = Object.keys(p.surplus || {});
        const shortageKeys = Object.keys(p.shortage || {});
        if (Object.keys(p.production).length > 0) { // 生産物が何かあればセクションを表示
            text += `\n--- 産業生産 (t/年) ---`; // セクション名を変更
            // 生産物をフィルタリングして表示 (0より大きいもののみ)
            const productionText = Object.entries(p.production)
                .filter(([, amount]) => amount > 0.1)
                .map(([item, amount]) => `${item} ${Math.round(amount).toLocaleString()}`)
                .join('t\n　　　') + 't';
            text += `\n生産：${productionText}`;

            // 全体の食料収支を表示
            if (p.surplus['食料']) {
                text += `\n食料収支：+${p.surplus['食料']}t の余剰`;
            } else if (p.shortage['食料']) {
                text += `\n食料収支：${p.shortage['食料']}t の不足`;
            }
        }
    }
    
    // --- 主要都市の場合、支配領域の集計情報を追加 (経済シミュレーション後にのみ表示) ---
    if (p.territoryData && ['首都', '都市', '領都', '街', '町'].includes(p.settlement)) {
        const data = p.territoryData;
        text += `\n--- 領地集計 ---`;
        const settlementCountText = Object.entries(data.settlementCounts).filter(([, count]) => count > 0).map(([type, count]) => { const shortName = { '都市': '都', '領都': '領', '街': '街', '町': '町', '村': '村' }[type]; return `${shortName}${count}`; }).join(', ');
        if(settlementCountText) text += `\n直轄集落： ${settlementCountText}`;
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

/**
 * 集落の親子関係マップを更新する関数
 * @param {Array<object>} hexesData - 全ヘックスのデータ
 */
function updateChildrenMap(hexesData) {
    childrenMap.clear(); // 古いデータをクリア
    hexesData.forEach((h, index) => {
        const parentId = h.properties.parentHexId;
        if (parentId !== null) {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId).push(index);
        }
    });
}

// ================================================================
// ビューポートカリングのための描画関数
// 表示範囲内の要素のみを描画する責務を担う
// ================================================================
/**
 * ビューポートカリングのための描画関数
 * @param {d3.ZoomTransform} transform - 現在のズーム情報
 */
function updateVisibleHexes(transform) {
    if (!svg || !hexes || hexes.length === 0) return; // 安全装置

    const hexHeight = Math.sqrt(3) * config.r;
    const hexOverlapScale = 1.01;

    // 1. 現在の表示範囲を計算
    const svgNode = svg.node();
    const svgWidth = svgNode.clientWidth;
    const svgHeight = svgNode.clientHeight;
    const topLeft = transform.invert([0, 0]);
    const bottomRight = transform.invert([svgWidth, svgHeight]);
    
    // 2. 表示範囲内のヘックスをフィルタリング
    const buffer = config.r * 2;
    const visibleHexes = hexes.filter(d => 
        d.cx >= topLeft[0] - buffer && d.cx <= bottomRight[0] + buffer &&
        d.cy >= topLeft[1] - buffer && d.cy <= bottomRight[1] + buffer
    );

    // 3. 各種スケールを定義
    const shadingOpacityScale = d3.scaleLinear().domain([0, 400]).range([0, 0.10]).clamp(true);

    // 全てのレイヤー変数を "layers.xxx.group" 形式で参照

    // 4a. 基本地形レイヤー
    layers.terrain.group.selectAll('.hex')
        .data(visibleHexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'hex')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                .attr('fill', d => {
                    if (d.properties.isWater) return config.TERRAIN_COLORS[d.properties.vegetation] || config.TERRAIN_COLORS['海洋'];
                    return config.getElevationColor(d.properties.elevation);
                })
                .attr('stroke', 'none'),
            update => update,
            exit => exit.remove()
        );
    
    // 4b. 白地図オーバーレイヤー
    layers['white-map-overlay'].group.selectAll('.white-map-hex')
        .data(visibleHexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'white-map-hex')
                .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                .attr('fill', d => d.properties.isWater ? config.WHITE_MAP_COLORS.WATER : config.whiteMapElevationColor(d.properties.elevation))
                .style('pointer-events', 'none'),
            update => update,
            exit => exit.remove()
        );

    const visibleLandHexes = visibleHexes.filter(d => !d.properties.isWater);
    
    // 4c. 植生オーバーレイヤー
        if (layers['vegetation-overlay'].visible) {
            layers['vegetation-overlay'].group.selectAll('.veg-overlay-hex')
                .data(visibleLandHexes, d => d.index)
                .join(
                    enter => enter.append('polygon')
                        .attr('class', 'veg-overlay-hex')
                        .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                        .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                        // 表示ルールのみを変更する
                        .attr('fill', d => {
                            const p = d.properties;
                            let displayVeg = p.vegetation; // まずはデータ上の優勢植生を取得

                            // もし優勢植生が森林系なら、優勢度チェックを行う
                            if (displayVeg === '森林' || displayVeg === '針葉樹林') {
                                // landUse.forest が 10%未満なら、表示上は「草原」として扱う
                                if (p.landUse.forest < 0.10) {
                                    displayVeg = '草原';
                                }
                            }
                            // 最終的に表示する植生の色を返す
                            return config.TERRAIN_COLORS[displayVeg] || 'transparent';
                        })
                        .style('fill-opacity', 0.6)
                        .style('pointer-events', 'none'),
                    update => update, // updateのロジックも必要であれば追記
                    exit => exit.remove()
                );
        } else {
            layers['vegetation-overlay'].group.selectAll('.veg-overlay-hex').remove();
        }
    
    // 4d. 積雪レイヤー
    if (layers.snow.visible) {
        layers.snow.group.selectAll('.snow-hex')
            .data(visibleLandHexes.filter(d => d.properties.hasSnow), d => d.index)
            .join(
                enter => enter.append('polygon')
                    .attr('class', 'snow-hex')
                    .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                    .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                    .attr('fill', '#fff')
                    .style('fill-opacity', 0.8)
                    .style('pointer-events', 'none'),
                update => update,
                exit => exit.remove()
            );
    } else {
        layers.snow.group.selectAll('.snow-hex').remove();
    }
    
    // 4e. レリーフ（陰影）レイヤー
    if (layers.shading.visible) {
        layers.shading.group.selectAll('.shading-hex')
            .data(visibleLandHexes, d => d.index)
            .join(
                enter => enter.append('polygon')
                    .attr('class', 'shading-hex')
                    .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                    .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                    .attr('fill', d => d.properties.shadingValue > 0 ? '#fff' : '#000')
                    .style('fill-opacity', d => shadingOpacityScale(Math.abs(d.properties.shadingValue)))
                    .style('pointer-events', 'none'),
                update => update,
                exit => exit.remove()
            );
    } else {
        layers.shading.group.selectAll('.shading-hex').remove();
    }
    
    // 4j. 集落シンボル
    layers.settlement.group.selectAll('.settlement-hex')
        .data(visibleHexes.filter(d => ['村', '町', '街', '領都', '首都', '都市'].includes(d.properties.settlement)), d => d.index)
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

    // 4k. 各種情報オーバーレイヤー
    const overlayDefinitions = {
        'climate-zone-overlay': { data: visibleHexes, fill: d => config.CLIMATE_ZONE_COLORS[d.properties.climateZone], opacity: 0.6 },
        'temp-overlay': { data: visibleHexes, fill: d => config.tempColor(d.properties.temperature), opacity: 0.6 },
        'precip-overlay': { data: visibleHexes, fill: d => config.precipColor(d.properties.precipitation_mm), opacity: 0.6 },
        'mana-overlay': { data: visibleHexes, fill: d => config.manaColor(d.properties.manaValue), opacity: 0.6 },
        'agri-overlay': { data: visibleHexes, fill: d => config.agriColor(d.properties.agriPotential), opacity: 0.7 },
        'forest-overlay': { data: visibleHexes, fill: d => config.forestColor(d.properties.forestPotential), opacity: 0.7 },
        'mining-overlay': { data: visibleHexes, fill: d => config.miningColor(d.properties.miningPotential), opacity: 0.7 },
        'fishing-overlay': { data: visibleHexes, fill: d => config.fishingColor(d.properties.fishingPotential), opacity: 0.7 },
        'hunting-overlay': { data: visibleHexes, fill: d => config.huntingColor(d.properties.huntingPotential), opacity: 0.7 },
        'pastoral-overlay': { data: visibleHexes, fill: d => config.pastoralColor(d.properties.pastoralPotential), opacity: 0.7 }, 
        'livestock-overlay': { data: visibleHexes, fill: d => config.livestockColor(d.properties.livestockPotential), opacity: 0.7 }, 
        'monster-overlay': { data: visibleHexes.filter(d => d.properties.monsterRank), fill: d => config.MONSTER_COLORS[d.properties.monsterRank], opacity: 0.5 },
        'population-overlay': { data: visibleHexes.filter(d => d.properties.population > 0), fill: d => config.populationColor(d.properties.population), opacity: 0.9 },
        'territory-overlay': { data: visibleHexes, fill: d => d.properties.nationId === 0 ? '#fff0' : nationColor(d.properties.nationId), opacity: 0.5 }
    };

    for (const [layerName, { data, fill, opacity }] of Object.entries(overlayDefinitions)) {
        if (!layers[layerName].visible) {
            layers[layerName].group.selectAll('*').remove();
            continue;
        };
        layers[layerName].group.selectAll(`.${layerName}-hex`)
            .data(data, d => d.index)
            .join(
                enter => enter.append('polygon')
                    .attr('class', `${layerName}-hex`)
                    .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
                    .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
                    .attr('fill', fill)
                    .style('fill-opacity', opacity)
                    .style('pointer-events', 'none'),
                update => update,
                exit => exit.remove()
            );
    }

    // 4l. ヘックス境界線レイヤー
    layers['hex-border'].group.selectAll('.hex-border')
        .data(visibleHexes, d => d.index)
        .join(
            enter => enter.append('polygon')
                .attr('class', 'hex-border')
                .attr('points', d => d.points.map(p => p.join(',')).join(' ')),
            update => update,
            exit => exit.remove()
        );

    // ラベルレイヤー
    layers.labels.group.selectAll('.hex-label-group').remove(); 
    const hexLabelGroups = layers.labels.group.selectAll('.hex-label-group')
        .data(visibleHexes, d => d.index)
        .join(enter => enter.append('g').attr('class', 'hex-label-group'));

    // 座標と標高を2行で表示するための<text>コンテナ
    const coordinateLabel = hexLabelGroups.append('text')
        .attr('class', 'hex-label')
        .attr('x', d => d.cx)
        .attr('y', d => d.cy + hexHeight * 0.28) // 少し上に調整
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle');

    // 1行目: 座標
    coordinateLabel.append('tspan')
        .text(d => `${String(d.x).padStart(3, '0')} ${String(d.y).padStart(3, '0')}`);

    // 2行目: 標高
    coordinateLabel.append('tspan')
        .attr('x', d => d.cx) // X座標を親と同じ位置にリセット
        .attr('dy', '1.0em')  // 1.2文字分だけ下にずらす (改行)
        .text(d => `H ${Math.round(d.properties.elevation)}`);
    
    if (layers.settlement.visible) {
        hexLabelGroups.filter(d => d.properties.settlement)
            .append('text').attr('class', 'settlement-label')
            .attr('x', d => d.cx).attr('y', d => d.cy)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .text(d => d.properties.settlement);
    }

    hexLabelGroups.append('text').attr('class', 'property-label') // 魔力ランク
        .attr('x', d => d.cx - config.r * 0.75).attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(d => d.properties.manaRank);
    hexLabelGroups.append('text').attr('class', 'property-label') // 資源
        .attr('x', d => d.cx + config.r * 0.75).attr('y', d => d.cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(d => d.properties.resourceRank);
    
    const effectiveRadius = config.r * transform.k;
    layers.labels.group.selectAll('.hex-label, .property-label')
        .style('display', effectiveRadius >= 50 ? 'inline' : 'none');

    // インタラクションレイヤー
    layers.interaction.group.selectAll('.interactive-hex')
        .data(visibleHexes, d => d.index)
        .join(
            enter => {
                const newHexes = enter.append('polygon').attr('class', 'interactive-hex')
                    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
                    .style('fill', 'transparent')
                    .style('cursor', 'pointer');
                newHexes.append('title').text(d => getInfoText(d));
                newHexes.on('click', (event, d) => {
                    const highlightLayer = layers['highlight-overlay'].group;
                    highlightLayer.selectAll('*').remove();
                    const p = d.properties;
                    if (['首都', '都市', '領都', '街', '町', '村'].includes(p.settlement)) {
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
                                
                                // ★★★ ここから経路描画ロジックを追加 ★★★
                                const childIndex = d.index;
                                const parentIndex = superiorHex.index;

                                // 該当する道路を検索
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

                                    // 経路をハイライトレイヤーに描画
                                    highlightLayer.selectAll('.connection-path')
                                        .data(pathSegments)
                                        .enter()
                                        .append('path')
                                        .attr('class', 'connection-path')
                                        .attr('d', segment => segment.path)
                                        .attr('stroke', 'cyan')
                                        .attr('stroke-width', 4) // 常に4px
                                        .attr('fill', 'none')
                                        .style('pointer-events', 'none');
                                }
                                // ★★★ 経路描画ロジックここまで ★★★
                            }
                        }
                    }
                    highlightLayer.append('polygon').attr('points', d.points.map(p => p.join(',')).join(' '))
                        .attr('fill', 'none')
                        .attr('stroke', 'cyan')
                        .attr('stroke-width', 5)
                        .style('pointer-events', 'none');

                    infoContent.textContent = getInfoText(d);
                    infoWindow.classList.remove('hidden');
                    event.stopPropagation();
                });
                return newHexes;
            },
            update => {
                update.select('title').text(d => getInfoText(d));
                return update;
            },
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
    
    // ミニマップ用の地形レイヤーを追加
    const minimapTerrain = minimapSvg.append('g');
    
    // メインマップ全体のサイズを計算
    const hexWidth = 2 * config.r;
    const hexHeight = Math.sqrt(3) * config.r;
    const mapTotalWidth = (config.COLS * hexWidth * 3/4 + hexWidth/4);
    const mapTotalHeight = (config.ROWS * hexHeight + hexHeight/2);

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
                if (d.properties.elevation >= 2000) return '#222'; // 山岳
                if (d.properties.settlement === '首都') return '#f0f'; // 首都
                if (d.properties.settlement === '都市' || d.properties.settlement === '領都') return '#f004'; // 領都
                if (d.properties.settlement === '街') return '#f804'; // 街
                if (d.properties.settlement === '町') return '#ff04'; // 町
                if (d.properties.settlement === '村') return '#0f04'; // 村
                return '#000'; // 平地・森林
            });

    // ビューポート矩形を初期状態で追加
    minimapViewport = minimapSvg.append('rect').attr('id', 'minimap-viewport');

    // ミニマップを表示
    minimapContainer.style('display', 'block');

    const hexOverlapScale = 1.01; // 隙間を埋めるための拡大率を定義。1%拡大
    
    infoWindow = document.getElementById('info-window');
    infoContent = document.getElementById('info-window-content');
    const infoCloseBtn = document.getElementById('info-close-btn');

    legendContainer = document.getElementById('legend-container');

    // --- 2. 描画用データの事前計算 ---
    hexes = []; // データをリセット

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
            });
        }
    }
    
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
    const snowLayer = createLayer('snow', true);                                // 積雪
    const riverLayer = createLayer('river');                                    // 河川
    const shadingLayer = createLayer('shading');                                // レリーフ (陰影)
    const contourLayer = createLayer('contour', true);                          // 等高線
    const ridgeWaterSystemLayer = createLayer('ridge-water-system', false);     // 稜線・水系図

    const territoryOverlayLayer = createLayer('territory-overlay', false);      // 領地
    const hexBorderLayer = createLayer('hex-border', true);                     // ヘックスの境界線
    const roadLayer = createLayer('road');                                      // 道路網
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
    // ----- [描画順序: 手前] -----

    // --- 4. 静的なレイヤーの描画 (初回のみ) ---

    // ヘックスに依存せず、ズーム中に再描画する必要がないレイヤーをここで描画
    
    // 4f. 国境線 (初回描画)
    drawBorders();

    // 4g. 等高線
    await addLogMessage("等高線の補間計算を開始します...");
    // getBBox() は初回描画前に正確な値が取れないため、計算でマップ全体のサイズを算出する
    const mapBBox = {x:0, y:0, width: (config.COLS * hexWidth * 3/4 + hexWidth/4), height: (config.ROWS * hexHeight + hexHeight/2)};
    const resolution = 10;
    const gridWidth = Math.floor(mapBBox.width / resolution);
    const gridHeight = Math.floor(mapBBox.height / resolution);
    const elevationValues = new Array(gridWidth * gridHeight);
    const delaunay = d3.Delaunay.from(hexes.map(h => [h.cx, h.cy]));
    const totalPixels = gridWidth * gridHeight;
    let processedPixels = 0;

    // UIフリーズを防ぐため、ループの構造を全面的に変更
    // 一行ずつ計算し、一行ごとにブラウザに制御を返すことで、プログレスバーの描画を確実に行う
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
        }

        processedPixels += gridWidth;

        // ブラウザにUIを更新する時間を与えるための非常に重要な一行
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    await addLogMessage("等高線のパスを生成中...");
    const maxElevation = d3.max(hexes, h => h.properties.elevation);
    const thresholds = d3.range(200, maxElevation, 200);
    const contours = d3.contours().size([gridWidth, gridHeight]).thresholds(thresholds)(elevationValues);
    contourLayer.selectAll("path")
        .data(contours).join("path")
        .attr("class", d => `contour-path ${d.value % 1000 === 0 ? 'contour-index' : 'contour-intermediate'}`)
        .attr("d", d3.geoPath()).attr("transform", `translate(${mapBBox.x}, ${mapBBox.y}) scale(${resolution})`);
    
    // 4h. 河川と稜線
    
    // --- 河川の曲線パスデータを生成 ---
    const riverPathData = [];
    hexes.forEach(d => {
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
    
    // --- 稜線の曲線パスデータを生成 ---
    const ridgePathData = [];
    hexes.forEach(sourceHex => {
        if (sourceHex.properties.ridgeFlow > 0 && !sourceHex.properties.isWater) {
            const upstreamHex = sourceHex.ridgeUpstreamIndex !== -1 ? hexes[sourceHex.ridgeUpstreamIndex] : null;

            // 山頂かどうかで終点を変更する
            let endPoint;
            if (upstreamHex) {
                // 通常の稜線：終点は、より標高が高い上流ヘックスとの境界の中点
                endPoint = getSharedEdgeMidpoint(sourceHex, upstreamHex);
            } else {
                // 山頂の処理：上流ヘックスがない場合、ここが山頂。終点はヘックスの中心。
                endPoint = [sourceHex.cx, sourceHex.cy];
            }

            if (!endPoint) return; // 終点が計算できなければスキップ
            
            // 制御点をヘックスの中心に設定
            const controlPoint = [sourceHex.cx, sourceHex.cy];

            const downstreamRidgeNeighbors = hexes.filter(h => h.ridgeUpstreamIndex === sourceHex.index);
            if (downstreamRidgeNeighbors.length === 0) { // 稜線の末端の場合
                const startPoint = [sourceHex.cx, sourceHex.cy];
                const path = `M ${startPoint[0]},${startPoint[1]} Q ${controlPoint[0]},${controlPoint[1]} ${endPoint[0]},${endPoint[1]}`;
                ridgePathData.push({ path: path, flow: sourceHex.properties.ridgeFlow });
            } else { // 稜線の途中
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
    
    // --- 各レイヤーへの描画 ---

    // 河川レイヤーに描画
    riverLayer.selectAll('.river-segment')
        .data(riverPathData)
        .enter()
        .append('path')
            .attr('class', 'river-segment')
            .attr('d', d => d.path)
            .attr('stroke', config.TERRAIN_COLORS.河川) 
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
            .attr('stroke-linecap', 'round')
            .style('pointer-events', 'none');
        
    // 稜線・水系図レイヤーに描画
    ridgeWaterSystemLayer.selectAll('.rws-water-hex')
        .data(hexes.filter(d => d.properties.isWater))
        .enter()
        .append('polygon')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${hexOverlapScale})`)
            .attr('fill', config.RIDGE_WATER_SYSTEM_COLORS.RIVER);
        
    ridgeWaterSystemLayer.selectAll('.rws-river-segment')
        .data(riverPathData)
        .enter()
        .append('path')
            .attr('d', d => d.path)
            .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIVER)
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 2, config.r))
            .attr('stroke-linecap', 'round')
            .style('fill', 'none');
        
    ridgeWaterSystemLayer.selectAll('.rws-ridge-segment')
        .data(ridgePathData) // 稜線の曲線データを使用
        .enter()
        .append('path') // pathで描画
            .attr('d', d => d.path)
            .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIDGE)
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
            .attr('stroke-linecap', 'round')
            .style('fill', 'none'); // fillを無効化
    
    // 4i. 道路網 (初回描画)
    drawRoads(roadPaths);
        
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
            // ★★★ [新規] 現在のズーム状態を保存 ★★★
            currentTransform = event.transform;
            updateMinimapViewport(event.transform);
        })
        .on('end', (event) => {
            // ズーム終了時に、もともと表示すべきレイヤーを再表示する
            Object.entries(layers).forEach(([name, layer]) => {
                 if (layer.visible) {
                    // 基本地図の切り替え状態を考慮
                    if (name === 'terrain' && d3.select('input[value="white"]').property('checked')) {
                        layer.group.style('display', 'none');
                    } else if (name === 'white-map-overlay' && !d3.select('input[value="white"]').property('checked')) {
                         layer.group.style('display', 'none');
                    } else {
                        layer.group.style('display', 'inline');
                    }
                }
            });

            // 最後に、スクリーン内の要素のみを再描画する
            updateVisibleHexes(event.transform);
            svg.style('cursor', 'grab');
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
        layers.river.group.selectAll('.river-segment').attr('stroke', isWhiteMap ? config.WHITE_MAP_COLORS.WATER : config.TERRAIN_COLORS.河川);
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });

    // 6b. レイヤーカテゴリのボタン
    // 植生ボタンの処理を、他のボタンと統一する
    d3.select('#toggleVegetationLayer').on('click', function() {
        // 植生と積雪は連動させる
        toggleLayerVisibility('vegetation-overlay', this);
        toggleLayerVisibility('snow', this); 
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });
    
    d3.select('#toggleSettlementLayer').on('click', function() {
        toggleLayerVisibility('settlement', this);
        const isVisible = layers.settlement.visible;
        layers.border.visible = isVisible;
        layers.border.group.style('display', isVisible ? 'inline' : 'none'); // 国境線は静的なので直接操作
        // 変更を即時反映するために描画関数を呼び出す
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });

    d3.select('#toggleHexBorderLayer').on('click', function() { 
        toggleLayerVisibility('hex-border', this); 
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });
    d3.select('#toggleReliefLayer').on('click', function() { 
        toggleLayerVisibility('shading', this); 
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });
    d3.select('#toggleContourLayer').on('click', function() { 
        toggleLayerVisibility('contour', this); 
        // 等高線は静的レイヤーなので直接表示を切り替えるだけで良い
    });
    d3.select('#toggleRoadLayer').on('click', function() { 
        toggleLayerVisibility('road', this); 
        // 道路網は静的レイヤーなので直接表示を切り替えるだけで良い
    });
    d3.select('#toggleTerritoryLayer').on('click', function() { 
        toggleLayerVisibility('territory-overlay', this); 
        updateVisibleHexes(d3.zoomTransform(svg.node()));
    });
    d3.select('#toggleRidgeWaterSystemLayer').on('click', function() { 
        toggleLayerVisibility('ridge-water-system', this); 
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
            updateVisibleHexes(d3.zoomTransform(svg.node()));
        });
    });

    // 6d. 資源カテゴリのボタン
    const resourceButtons = ['#toggleManaLayer', '#toggleAgriLayer', '#toggleForestLayer', '#toggleMiningLayer', '#toggleFishingLayer', '#toggleHuntingLayer', '#togglePastoralLayer', '#toggleLivestockLayer'];
    resourceButtons.forEach(selector => {
        d3.select(selector).on('click', function() {
            const layerName = selector.replace('#toggle', '').replace('Layer', '-overlay').toLowerCase();
            toggleLayerVisibility(layerName, this);
            // 変更を即時反映するために描画関数を呼び出す
            updateVisibleHexes(d3.zoomTransform(svg.node()));
        });
    });


    // --- 7. 初期ズーム位置の設定 ---
    const targetHex = hexes.find(h => h.x === 50 && h.y === 43);
    if (targetHex) {
        const svgWidth = svg.node().getBoundingClientRect().width;
        const svgHeight = svg.node().getBoundingClientRect().height;
        const initialTransform = d3.zoomIdentity.translate(svgWidth / 2 - targetHex.cx, svgHeight / 2 - targetHex.cy).scale(1.0);
        
        // D3にtransformを適用させる
        svg.call(zoom.transform, initialTransform);
        
        // 適用されたtransformを基に、初回の表示要素を描画する
        updateVisibleHexes(initialTransform);
    } else {
        // フォールバックとして、現在のtransformで初回描画
        updateVisibleHexes(d3.zoomTransform(svg.node()));
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
            // ★★★ [ここを修正] プロパティをマージするのではなく、完全に上書きする ★★★
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
export async function redrawClimate(allHexes) {
    updateHexesData(allHexes);
    // ★★★ [修正] updateVisibleHexesを呼び出して、表示を完全に再構築する ★★★
    if (svg) updateVisibleHexes(currentTransform);
    console.log("気候・植生が更新され、再描画されました。");
}

/**
 * 集落情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 */
export async function redrawSettlements(allHexes) {
    updateHexesData(allHexes);
    updateChildrenMap(allHexes);
    // ★★★ [修正] updateVisibleHexesを呼び出して、表示を完全に再構築する ★★★
    if (svg) updateVisibleHexes(currentTransform);
    console.log("集落が更新され、再描画されました。");
}

/**
 * 道路・国家情報が更新されたときに呼び出される再描画関数
 * @param {Array<object>} allHexes - 更新された全ヘックスデータ
 * @param {Array<object>} roadPaths - 更新された道路データ
 */
export async function redrawRoadsAndNations(allHexes, roadPaths) {
    updateHexesData(allHexes);
    updateChildrenMap(allHexes);

    // 静的レイヤーを新しいデータで再描画
    drawRoads(roadPaths);
    drawBorders();
    
    // ★★★ [修正] updateVisibleHexesを呼び出して、表示を完全に再構築する ★★★
    if (svg) updateVisibleHexes(currentTransform);
    console.log("道路・国家が更新され、再描画されました。");
}

/**
 * ★★★ [新規] UIの状態をリセットする関数 ★★★
 */
export function resetUI() {
    if (minimapContainer) {
        minimapContainer.remove(); // 古いミニマップを削除
        minimapContainer = null;
    }
}