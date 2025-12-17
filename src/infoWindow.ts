// ================================================================
// GeoForge System - Info Window & Legend Module
// ================================================================
// このモジュールは、情報ウィンドウのコンテンツ生成、
// サイドバーの統計情報更新、および凡例の生成を担当します。
// ================================================================

import * as d3 from 'd3';
import * as config from './config.ts';
import { getIndex, formatLocation } from './utils.ts';
import { allocateVegetation } from './continentGenerator.js';
import { calculateHexIndustry, calculateHexDemographics, calculateHexFacilities, calculateHexShipOwnership } from './economyHelpers.ts';
import { WorldMap, Hex } from './WorldMap.ts';

interface SettlementStats {
    '首都': number;
    '領都': number;
    '街': number;
    '町': number;
    '村': number;
    [key: string]: number;
}

interface NationStat {
    name: string;
    population: number;
    capital: Hex | any | null;
    settlements: SettlementStats;
}

// --- モジュールスコープ変数 ---
export let childrenMap: Map<number, number[]> = new Map();
let allHexesData: WorldMap | any[] = [];
let legendContainer: HTMLElement | null = null;

/**
 * 情報ウィンドウモジュールの初期化
 * @param {HTMLElement} container - 凡例を表示するコンテナ要素
 */
export function initInfoWindow(container: HTMLElement) {
    legendContainer = container;
}

/**
 * 全ヘックスデータを設定する
 * @param {Array<object> | WorldMap} data - 全ヘックスデータ
 */
export function setAllHexesData(data: WorldMap | any[]) {
    allHexesData = data;
}

/**
 * 集落の親子関係マップを更新する関数
 * @param {Array<object> | WorldMap} hexesData - 全ヘックスのデータ
 */
export function updateChildrenMap(hexesData: WorldMap | any[]) {
    allHexesData = hexesData; // データも更新しておく
    childrenMap.clear(); // 古いデータをクリア
    hexesData.forEach((h: any, index: number) => {
        const parentId = h.properties.parentHexId;
        if (parentId !== null) {
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId)!.push(index);
        }
    });
}

/**
 * 指定されたヘックスを起点として、全ての隷下集落を再帰的に集計する関数
 * @param {number} rootIndex - 起点となるヘックスのインデックス
 * @returns {object} 集落タイプごとのカウント { '街': 1, '村': 5, ... }
 */
export function getAllSubordinateSettlements(rootIndex: number): { [key: string]: number } {
    const counts: { [key: string]: number } = {};
    const queue = [rootIndex];

    // 循環参照防止のためのSet
    const visited = new Set([rootIndex]);

    while (queue.length > 0) {
        const currentIdx = queue.shift();
        const children = childrenMap.get(currentIdx) || [];

        children.forEach(childIdx => {
            if (visited.has(childIdx)) return;
            visited.add(childIdx);

            const childHex = allHexesData[childIdx];
            if (childHex && childHex.properties.settlement) {
                const type = childHex.properties.settlement;
                counts[type] = (counts[type] || 0) + 1;
                queue.push(childIdx);
            }
        });
    }
    return counts;
}

/**
 * サイドバーの全体情報パネルを更新する (辺境地帯の集計に対応)
 * @param {Array<object> | WorldMap} allHexes - 全てのヘックスデータ
 */
export function updateOverallInfo(allHexes: WorldMap | any[]) {
    if (!allHexes || allHexes.length === 0) return;

    // --- DOM要素の取得 ---
    const popEl = document.getElementById('info-total-population');
    const nationCountEl = document.getElementById('info-nation-count');
    const settlementSummaryEl = document.getElementById('info-settlement-summary');
    const nationsDetailsEl = document.getElementById('info-nations-details');
    if (nationsDetailsEl) nationsDetailsEl.innerHTML = ''; // 事前にクリア

    // --- 集計用データ構造の初期化 ---
    const globalStats: {
        population: number;
        nations: Set<number>;
        settlements: SettlementStats;
    } = {
        population: 0,
        nations: new Set(),
        settlements: { '首都': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
    };
    const nationStats = new Map<number, NationStat>();
    // 辺境地帯用の集計オブジェクトを追加
    const frontierStats: {
        population: number;
        settlements: SettlementStats;
    } = {
        population: 0,
        settlements: { '首都': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
    };

    // --- STEP 1: 全ヘックスを走査し、データ集計 ---
    allHexes.forEach((h: any) => {
        const p = h.properties;
        globalStats.population += p.population || 0;
        if (p.settlement && globalStats.settlements[p.settlement] !== undefined) {
            globalStats.settlements[p.settlement]++;
        }

        if (p.nationId > 0) {
            globalStats.nations.add(p.nationId);
            // 国家別の集計 (変更なし)
            if (!nationStats.has(p.nationId)) {
                nationStats.set(p.nationId, {
                    name: config.NATION_NAMES[p.nationId - 1] || `国家${p.nationId}`,
                    population: 0, capital: null,
                    settlements: { '首都': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
                });
            }
            const currentNation = nationStats.get(p.nationId)!;
            currentNation.population += p.population || 0;
            if (p.settlement && currentNation.settlements[p.settlement] !== undefined) {
                currentNation.settlements[p.settlement]++;
                if (p.settlement === '首都') { currentNation.capital = h; }
            }
        } else {
            // nationIdが0の場合、辺境として集計
            frontierStats.population += p.population || 0;
            if (p.settlement && frontierStats.settlements[p.settlement] !== undefined) {
                frontierStats.settlements[p.settlement]++;
            }
        }
    });

    // --- STEP 2: グローバル情報の描画 (変更なし) ---
    if (popEl) popEl.textContent = `${globalStats.population.toLocaleString()}人`;
    if (nationCountEl) nationCountEl.textContent = `${globalStats.nations.size}カ国`;
    const summaryText = [`首${globalStats.settlements['首都']}`, `領${globalStats.settlements['領都']}`, `街${globalStats.settlements['街']}`, `町${globalStats.settlements['町']}`, `村${globalStats.settlements['村']}`].join(' ');
    if (settlementSummaryEl) settlementSummaryEl.textContent = summaryText;

    // --- STEP 3: 国家別情報の描画 ---
    const sortedNations = Array.from(nationStats.values()).sort((a, b) => a.name.localeCompare(b.name));
    let nationsHtml = '';
    sortedNations.forEach(nation => {
        const capitalCoords = nation.capital ? `(${formatLocation(nation.capital, 'coords')})` : '';
        const nationSettlementSummary = [`首${nation.settlements['首都']}`, `領${nation.settlements['領都']}`, `街${nation.settlements['街']}`, `町${nation.settlements['町']}`, `村${nation.settlements['村']}`].join(' ');
        nationsHtml += `
            <div class="nation-info-block">
                <h5>${nation.name} <span>${capitalCoords}</span></h5>
                <div class="info-line"><span>人口</span><span>${nation.population.toLocaleString()}人</span></div>
                <div class="info-line" style="justify-content: flex-start; font-size: 13px;"><span>${nationSettlementSummary}</span></div>
            </div>`;
    });

    // STEP 4: 辺境地帯情報の描画を追加
    if (frontierStats.population > 0) {
        const frontierSettlementSummary = [`街${frontierStats.settlements['街']}`, `町${frontierStats.settlements['町']}`, `村${frontierStats.settlements['村']}`].join(' ');
        nationsHtml += `
            <div class="nation-info-block">
                <h5>辺境</h5>
                <div class="info-line"><span>人口</span><span>${frontierStats.population.toLocaleString()}人</span></div>
                <div class="info-line" style="justify-content: flex-start; font-size: 13px;"><span>${frontierSettlementSummary}</span></div>
            </div>`;
    }

    if (nationsDetailsEl) nationsDetailsEl.innerHTML = nationsHtml;
}

/**
 * クリックされたヘックスの詳細情報を整形して返す関数。
 * 情報ウィンドウの表示内容を生成します。
 * @param {object} d - ヘックスデータ
 * @returns {string} - 整形された情報テキスト (HTML)
 */
export function getInfoText(d: any, allHexes: WorldMap | any[]) {
    // [FIX] Lazy Restoration of missing data
    // d is a POJO (display data). We need to access the WorldMap/Buffer to calculate details.
    if (allHexes) {
        // Try to get the Flyweight Hex object
        let h = null;
        if (typeof (allHexes as any).getHex === 'function') {
            h = (allHexes as any).getHex(d.index);
        } else if ((allHexes as any)[d.index]) {
            h = (allHexes as any)[d.index];
        }

        if (h) {
            // [FIX] Buffer Mismatch Check
            // d (View Hex) vs h (Buffer Hex).
            // バッファは再利用されるため、座標が一致しない場合は「古いデータ」を見ていると判断して無視する。
            if (h.col !== d.col || h.row !== d.row) {
                console.warn(`[Info] Buffer Mismatch (Coords): View(${d.col},${d.row}) vs Buffer(${h.col},${h.row}). Skipping restore.`);
                h = null;
            } else if (d.blockId && h.properties.blockId && d.blockId !== h.properties.blockId) {
                // 念のためIDチェックも維持
                console.warn(`[Info] Buffer Mismatch (ID): View(${d.blockId}) vs Buffer(${h.properties.blockId}). Skipping restore.`);
                h = null;
            }
        }

        // [FIX] Buffer Mismatch Fallback: Use View Data (d) if Buffer (h) is invalid
        // d comes from MapView with copied properties (vegetationAreas etc.)
        const hp = h ? h.properties : d;

        if (hp) {
            // Validate essential property existence to avoid errors
            if (!h && !hp.vegetation) {
                // Should act as 'h' for subsequent logic?
                // Logic below relies on 'hp' being a valid hex-like object.
            }

            // 1. Restore Vegetation Areas (if missing)
            if (!hp.vegetationAreas && !hp.landUse) {
                // Estimate stats for allocation
                const T = hp.temperature || 0;
                const P = hp.precipitation_mm || 0;
                const H = hp.elevation || 0;
                const waterHa = hp.waterArea || (hp.isWater ? config.HEX_AREA_HA : 0);

                // Estimates
                const flatness = 1.0; // Default
                const soilFert = 0.5; // Default
                const coastalDist = hp.isCoastal ? 0 : 20;
                const D = 0.5; // Aridity index estimate (not critical for re-allocation of saved vegetation type)

                // Oceanicity estimate
                let oceanicity = 0.0;
                if (hp.vegetation === '海洋' || hp.vegetation === '深海') oceanicity = 1.0;
                else if (hp.isCoastal) oceanicity = 0.8;

                const areas = allocateVegetation({
                    T, P, H, waterHa, flatness, soilFert, D, coastalDist, oceanicity
                });

                // Persistence (Session)
                hp.vegetationAreas = areas;
            }

            // 2. Restore Economy (if missing and populated)
            if (hp.population > 0) {
                // Ships (Pre-requisite for fishery)
                // [FIX] Only calculate if we have a valid Hex object (buffer context)
                // If using 'd' (View POJO), we rely on copied data (ships/industry etc)
                if (h && !hp.ships) calculateHexShipOwnership(h, allHexes);

                // Industry
                if (h && !hp.industry) calculateHexIndustry(h, allHexes);

                // Demographics
                if (h && !hp.demographics) calculateHexDemographics(h, allHexes);

                // Facilities
                if (h && !hp.facilities) calculateHexFacilities(h, allHexes);

                // Production (Depends on Industry)
                // if (h && !hp.production) calculateHexProduction(h, allHexes);
            }

            // Sync calculated props back to display POJO 'd'
            // We use Object.assign to copy the properties proxy or values
            if (h) {
                Object.assign(d.properties, h.toObject());
            }
            // Note: toObject() creates a POJO with all props.
            // This ensures d.properties has everything including the newly calculated ones.
        }
    }

    const p = d.properties;

    // --- ヘルパー: アイコン付き行の生成 ---
    const createRow = (icon: string, label: string, value: string | number, unit = '', color: string | null = null) => {
        let legendHtml = '';
        if (color) {
            legendHtml = `<span class="legend-icon" style="background-color:${color};"></span>`;
        }
        return `<div class="info-row"><span class="label">${legendHtml}<span class="material-icons-round" style="font-size: 20px; vertical-align: middle; margin-right: 4px;">${icon}</span>${label}</span><span class="value">${value}${unit}</span></div>`;
    };

    // --- 1. 基本情報カード ---
    let basicInfoHtml = '';

    // 位置・所属
    const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺　境';
    basicInfoHtml += createRow('flag', '所　属', nationName);

    // [FIX] Use col/row if available
    // [FIX] Use col/row if available and use World Coordinate format helper
    basicInfoHtml += createRow('place', '座　標', formatLocation(d, 'coords'));

    // 集落・拠点
    if (p.settlement) {
        basicInfoHtml += createRow('location_city', '集落規模', p.settlement);
    }

    // 上位集落
    if (p.parentHexId != null) {
        const superiorHex = allHexesData[p.parentHexId];
        if (superiorHex) {
            basicInfoHtml += createRow('arrow_upward', '上位集落', `${superiorHex.properties.settlement}`);
            if (p.distanceToParent) {
                basicInfoHtml += createRow('straighten', '距　離', `${p.distanceToParent.toFixed(1)}`, 'km');
            }
            if (p.travelDaysToParent !== undefined) {
                basicInfoHtml += createRow('directions_bus', '荷馬車', p.travelDaysToParent.toFixed(1), '日');
            }
        }
    } else if (p.territoryId != null && getIndex(d.x, (config.ROWS - 1) - d.y) !== p.territoryId) {
        const territoryHub = allHexesData[p.territoryId];
        if (territoryHub) {
            basicInfoHtml += createRow('stars', '中　枢', `${territoryHub.properties.settlement}`);
        }
    }

    // 人口・農地
    basicInfoHtml += createRow('people', '人　口', (p.population || 0).toLocaleString(), '人');
    // basicInfoHtml += createRow('agriculture', '農　地', Math.round(p.cultivatedArea || 0).toLocaleString(), ' ha'); // Moved to Environment
    basicInfoHtml += createRow('home', '居住適性', (p.habitability || 0).toFixed(1));

    if (p.characteristics && p.characteristics.length > 0) {
        basicInfoHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">stars</span>特　徴</h6>`;
        p.characteristics.forEach(c => {
            let key = '特徴';
            let val = c;
            if (c.includes(':')) {
                [key, val] = c.split(':');
            }
            basicInfoHtml += createRow('label_important', key.trim(), val.trim());
        });
        basicInfoHtml += `</div>`;
    }

    const basicCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">info</span>基本情報</div><div class="card-content">${basicInfoHtml}</div></div>`;

    // --- 2. 環境カード ---
    let envInfoHtml = '';

    // 土地利用
    let landUseText = p.isWater ? p.vegetation : (p.terrainType || p.vegetation);
    // if (!p.isWater && p.isAlluvial) landUseText += ' (河川)';
    envInfoHtml += createRow('landscape', '地　形', landUseText);

    // 2. 植生
    if (!p.vegetation) {
        console.warn(`[WARN] Vegetation is missing for Hex[${d.index}] (x:${d.x}, y:${d.y}). Properties:`, p);
    }
    envInfoHtml += createRow('forest', '代表植生', p.vegetation || 'なし');

    // 3. 特性
    const features = [];
    if (p.isAlluvial) features.push('河川');
    if (p.hasSnow) features.push('積雪');
    if (p.isCoastal) features.push('海岸');
    if (p.isLakeside) features.push('湖岸');
    if (p.beachNeighbors && p.beachNeighbors.length > 0) features.push('砂浜');
    envInfoHtml += createRow('star', '特　性', features.length > 0 ? features.join('・') : 'なし');

    // 4. 標高
    envInfoHtml += createRow('terrain', p.elevation < 0 ? '水　深' : '標　高', Math.abs(Math.round(p.elevation)), 'm');

    // 5. 気候帯
    envInfoHtml += createRow('public', '気候帯', p.climateZone);

    // 6. 気温
    envInfoHtml += createRow('thermostat', '気　温', p.temperature.toFixed(1), '℃');

    // 7. 降水量
    envInfoHtml += createRow('water_drop', '降水量', p.precipitation_mm.toFixed(0), 'mm');

    // 10. 魔物ランク
    envInfoHtml += createRow('warning', '魔　物', p.monsterRank ? p.monsterRank + 'ランク' : '見かけない');

    // 水域面積 (v3.3 - 詳細ロジック & カテゴリ分け)
    let riverArea = 0;
    let lakeArea = 0;
    let oceanArea = 0;

    if (p.isWater) {
        // 水域ヘックスの場合、そのヘックス全体を該当する水域とする
        if (p.vegetation === '湖沼') {
            lakeArea = config.HEX_AREA_HA;
        } else {
            oceanArea = config.HEX_AREA_HA;
        }
    } else {
        // 陸域ヘックスの場合、隣接や河川情報から水域を算出

        // 1. 湖岸・海岸の面積 (隣接数 x 100ha)
        let lakeNeighbors = 0;
        let oceanNeighbors = 0;
        if (d.neighbors) {
            d.neighbors.forEach(nIdx => {
                const nHex = allHexesData[nIdx];
                if (nHex && nHex.properties.isWater) {
                    if (nHex.properties.vegetation === '湖沼') lakeNeighbors++;
                    else if (nHex.properties.vegetation === '海洋' || nHex.properties.vegetation === '深海') oceanNeighbors++;
                }
            });
        }
        lakeArea += lakeNeighbors * 100;
        oceanArea += oceanNeighbors * 100;

        // 2. 河川の面積 (流量^2 x 1ha x 河川長) -> 修正: 生成時に計算された waterArea を使用
        if (p.waterArea > 0) {
            riverArea += p.waterArea;
        } else if (p.flow > 0) {
            // フォールバック (古いデータなど、waterAreaがない場合)
            // 下流（流出先）を特定: 最も標高が低い隣接ヘックス
            let outflow = null;
            let minElev = p.elevation;
            let outflowIdx = -1;

            // 上流（流入元）を特定: 標高が高く、flowを持つ隣接ヘックスのうち、最大のflowを持つもの（本流）
            let mainUpstream = null;
            let maxUpstreamFlow = -1;
            let upstreamIdx = -1;

            if (d.neighbors) {
                d.neighbors.forEach((nIdx, i) => {
                    const nHex = allHexesData[nIdx];
                    if (!nHex) return;

                    // Outflow check
                    if (nHex.properties.elevation < minElev) {
                        minElev = nHex.properties.elevation;
                        outflow = nHex;
                        outflowIdx = i;
                    }

                    // Upstream check
                    if (nHex.properties.elevation > p.elevation && nHex.properties.flow > 0) {
                        if (nHex.properties.flow > maxUpstreamFlow) {
                            maxUpstreamFlow = nHex.properties.flow;
                            mainUpstream = nHex;
                            upstreamIdx = i;
                        }
                    }
                });
            }

            // 基本河川長の決定
            let baseLength = 6; // デフォルト（水源のみ。河口は下流があるため計算される）
            if (outflow && mainUpstream) {
                // 流入と流出がある場合（中間地点および河口）、角度（インデックス差）で長さを判定
                let diff = Math.abs(outflowIdx - upstreamIdx);
                if (diff > 3) diff = 6 - diff; // Normalize to 0-3

                if (diff === 3) baseLength = 12; // 対辺 (直進)
                else if (diff === 2) baseLength = 10; // 2つ隣 (緩カーブ)
                else if (diff === 1) baseLength = 6; // 隣 (急カーブ)
            }

            // 平坦度係数の計算 (0.9 ~ 1.5)
            let elevDiff = 0;
            if (outflow) {
                elevDiff = p.elevation - outflow.properties.elevation;
            }
            // 標高差が大きいほど係数は小さくなる (急流は短い)
            let flatness = 1.5 - (elevDiff * 0.0012);

            // 稜線レベルによる補正
            if (p.ridgeFlow > 0) {
                flatness -= p.ridgeFlow * 0.05;
            }

            flatness = Math.max(0.9, Math.min(1.5, flatness));

            // 河川長 (km)
            const riverLengthKm = baseLength * flatness;

            // 面積計算: 物理ベースに近い近似 (w = 2 * Q^0.5)
            // Area = w * L = 2 * Q^0.5 * L * 1000 / 10000 (ha) = 0.2 * Q^0.5 * L
            // 旧ロジック (Q^2) は過大評価すぎるため修正
            let calculatedArea = 0.2 * Math.sqrt(p.flow) * riverLengthKm;

            // 湿地帯係数 (v3.3): 湿地の場合は水域が広いとみなして2倍
            if (p.vegetation === '湿地') {
                calculatedArea *= 2.0;
            }

            riverArea += calculatedArea;
        }
    }

    // 11. 土地利用面積 (カテゴリ)
    envInfoHtml += `<div class="sector-block" style="margin-top:8px; padding-top: 4px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">square_foot</span>土地利用面積</h6>`;

    // 12. 海洋水域
    if (oceanArea > 1) envInfoHtml += createRow('water', '海洋水域', Math.round(oceanArea).toLocaleString(), ' ha', '#48d');
    // 13. 湖沼水域
    if (lakeArea > 1) envInfoHtml += createRow('water', '湖沼水域', Math.round(lakeArea).toLocaleString(), ' ha', '#058');
    // 14. 河川水域
    if (riverArea > 1) envInfoHtml += createRow('water', '河川水域', Math.round(riverArea).toLocaleString(), ' ha', '#37b');

    // --- 16.5. 農地面積の動的計算 (v3.5) ---
    // p.cultivatedArea は生成時の値だが、人口が多い集落では過小評価されがち。
    // ここで植生適性と人口に基づき、ローカルで再計算して表示する。

    // 植生ごとの開墾適性 (0.0 - 1.0)
    const RECLAMATION_SUITABILITY = {
        'grassland': 0.9,  // 草原: 開墾容易
        'savanna': 0.8,    // サバンナ: 比較的容易
        'steppe': 0.8,     // ステップ: 比較的容易
        'temperateForest': 0.6, // 温帯林: 伐採が必要
        'subarcticForest': 0.4, // 亜寒帯林: 寒冷で手間
        'tropicalRainforest': 0.3, // 熱帯雨林: 困難
        'wetland': 0.2,    // 湿地: 排水が必要
        'coastal': 0.3,    // 沿岸: 砂地など
        'beach': 0.1,      // 砂浜: 不適
        'desert': 0.1,     // 砂漠: 灌漑必須
        'wasteland': 0.2,   // 荒地: 岩石除去など
        'tundra': 0.05,    // ツンドラ: 極めて困難
        'alpine': 0.05,    // アルパイン: ほぼ無理
        'iceSnow': 0.0     // 氷雪: 無理
    };

    // 日本語名 -> 英語キーのマッピング (フォールバック用)
    const VEG_JP_TO_EN = {
        '草原': 'grassland', '草原帯': 'grassland',
        'サバンナ': 'savanna',
        'ステップ': 'steppe',
        '温帯林': 'temperateForest', '森林': 'temperateForest',
        '亜寒帯林': 'subarcticForest', '針葉樹林': 'subarcticForest',
        '熱帯雨林': 'tropicalRainforest', '密林': 'tropicalRainforest',
        '湿地': 'wetland', '湿地帯': 'wetland',
        '沿岸': 'coastal', '沿岸植生': 'coastal',
        '砂浜': 'beach',
        '砂漠': 'desert', '砂漠帯': 'desert',
        '荒地': 'wasteland', '荒地帯': 'wasteland',
        'ツンドラ': 'tundra',
        'アルパイン': 'alpine', '高山': 'alpine',
        '氷雪': 'iceSnow', '氷雪帯': 'iceSnow'
    };

    // 1. 最大農地ポテンシャルの計算
    let maxPotentialFarmland = 0;
    if (p.vegetationAreas) {
        Object.entries(p.vegetationAreas).forEach(([vegType, area]) => {
            const suitability = RECLAMATION_SUITABILITY[vegType] || 0;
            maxPotentialFarmland += (area as number) * suitability;
        });
    } else {
        // vegetationAreasがない場合のフォールバック
        const vegKey = VEG_JP_TO_EN[p.vegetation] || 'grassland';
        const suitability = RECLAMATION_SUITABILITY[vegKey] || 0.5;
        const landArea = config.HEX_AREA_HA - (oceanArea + lakeArea + riverArea);
        maxPotentialFarmland = landArea * suitability;
    }

    // 2. 農民人口の算出
    let farmers = 0;
    if (p.demographics && p.demographics['農民']) {
        farmers = p.demographics['農民'];
    } else {
        // 人口構成データがない場合、集落タイプから推定
        // 第一次産業比率のうち、8割程度が農民と仮定
        let primaryRate = 0.8; // デフォルト (村など)
        if (p.industry && p.industry.primary) {
            // 産業データがあればそれを使う手もあるが、ここでは簡易的にConfigから
            const limit = config.INDUSTRY_ALLOCATION[p.settlement] || config.INDUSTRY_ALLOCATION['散居'];
            primaryRate = limit[1]; // 第一次産業比率
        }
        farmers = p.population * primaryRate * 0.8;
    }

    // 3. 必要農地面積の算出
    // 1農民あたりに必要な農地面積 (ha)
    // CROP_DATAの平均値 (1.5ha程度) を採用するが、生産性向上などで少し減じて1.2haとする
    const HA_PER_FARMER = 1.2;
    const requiredFarmland = farmers * HA_PER_FARMER;

    // 4. 実効農地面積の決定 (最大ポテンシャルでキャップ)

    // [New Logic] 主要な作物が魔力を必要とする場合、農地ポテンシャルを魔力で制限する
    if (p.industry && p.industry.primary) {
        // 最も生産量の多い作物を探す
        let majorCrop = null;
        let maxYield = -1;
        Object.entries(p.industry.primary).forEach(([crop, amount]) => {
            if ((amount as number) > maxYield) {
                maxYield = amount as number;
                majorCrop = crop;
            }
        });

        if (majorCrop) {
            const cropData = config.CROP_DATA[majorCrop];
            if (cropData && cropData.requires_mana) {
                // 魔力 (0.0 - 1.0) を係数として乗算
                // p.manaValue (WorldMap定義) または p.mana (旧定義互換) を使用
                const manaFactor = (p.manaValue !== undefined) ? p.manaValue : (p.mana !== undefined ? p.mana : 0.0);
                maxPotentialFarmland *= manaFactor;
            }
        }
    }

    // ただし、p.cultivatedArea (生成時計算値) がもし大きければそちらを優先しても良いが、
    // 今回の目的は「小さすぎる」のを直すことなので、計算値(required)とポテンシャルの小さい方をとる。
    // 生成時の値とも比較し、大きい方を採用する（既存データへの配慮）
    let actualFarmland = Math.min(requiredFarmland, maxPotentialFarmland);
    if (actualFarmland < (p.cultivatedArea || 0)) {
        actualFarmland = p.cultivatedArea;
    }

    // --- 16. 集落面積・道路面積 (再掲) ---
    // (上で計算済みだが、humanUseAreaの再計算のために変数として確保)
    let settlementArea = 0;
    if (p.population > 0) {
        settlementArea = 0.02 * Math.pow(p.population, 0.85);
    }

    let roadArea = 0;
    if (p.roadEdges) {
        roadArea = p.roadEdges.reduce((a, b) => a + b, 0);
    }

    // --- 18. 詳細植生面積 (v3.4 + v3.5改修) ---
    // バーグラフ用のデータ収集配列
    const landUseSegments = [];

    // 水域・人為的利用の追加
    if (oceanArea > 1) landUseSegments.push({ label: '海洋', area: oceanArea, color: '#48d' });
    if (lakeArea > 1) landUseSegments.push({ label: '湖沼', area: lakeArea, color: '#058' });
    if (riverArea > 1) landUseSegments.push({ label: '河川', area: riverArea, color: '#37b' });

    // 農地 (計算値を使用)
    if (actualFarmland > 1) {
        envInfoHtml += createRow('agriculture', '農地等', Math.round(actualFarmland).toLocaleString(), ' ha', '#fb7');
        landUseSegments.push({ label: '農地', area: actualFarmland, color: '#fb7' });
    }

    // 集落
    if (settlementArea > 1) {
        envInfoHtml += createRow('location_city', '集落等', Math.round(settlementArea).toLocaleString(), ' ha', '#d33');
        landUseSegments.push({ label: '集落', area: settlementArea, color: '#d33' });
    }

    // 道路
    if (roadArea > 0) {
        envInfoHtml += createRow('add_road', '道路等', Math.round(roadArea).toLocaleString(), ' ha', '#d3d');
        landUseSegments.push({ label: '道路', area: roadArea, color: '#d3d' });
    }


    if (p.vegetationAreas) {
        const vegLabelMap = {
            desert: { label: '砂漠帯', icon: 'landscape', color: '#eca' },
            wasteland: { label: '荒地帯', icon: 'terrain', color: '#ccb' },
            grassland: { label: '草原帯', icon: 'grass', color: '#bda' },
            wetland: { label: '湿地帯', icon: 'water_drop', color: '#676' },
            temperateForest: { label: '温帯林', icon: 'forest', color: '#7a5' },
            subarcticForest: { label: '亜寒帯林', icon: 'forest', color: '#475' },
            tropicalRainforest: { label: '熱帯雨林', icon: 'forest', color: '#262' },
            alpine: { label: 'アルパイン', icon: 'terrain', color: '#aaa' },
            tundra: { label: 'ツンドラ', icon: 'ac_unit', color: '#bcd' },
            savanna: { label: 'サバンナ', icon: 'grass', color: '#dcb' },
            steppe: { label: 'ステップ', icon: 'grass', color: '#cda' },
            coastal: { label: '沿岸植生', icon: 'waves', color: '#8db' },
            iceSnow: { label: '氷雪帯', icon: 'ac_unit', color: '#eff' },
            beach: { label: '砂浜', icon: 'beach_access', color: '#feb' }
        };

        // 人為的な土地利用面積の合計を計算 (計算された農地を使用)
        const humanUseArea = (settlementArea || 0) + (roadArea || 0) + (actualFarmland || 0);
        const landArea = config.HEX_AREA_HA - (oceanArea + lakeArea + riverArea);
        const remainingNatureArea = Math.max(0, landArea - humanUseArea);

        // 元の植生面積の合計（水域除く）
        let totalVegArea = 0;
        Object.entries(p.vegetationAreas).forEach(([k, v]) => {
            if (k !== 'water') totalVegArea += (v as number);
        });

        const scaleFactor = totalVegArea > 0 ? remainingNatureArea / totalVegArea : 0;

        Object.entries(p.vegetationAreas)
            .filter(([key, area]) => key !== 'water')
            .map(([key, area]) => [key, (area as number) * scaleFactor])
            .filter(([, area]) => (area as number) > 1)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .forEach(([key, area]) => {
                const info = vegLabelMap[key as keyof typeof vegLabelMap];
                if (info) {
                    envInfoHtml += createRow(info.icon, info.label, Math.round(area as number).toLocaleString(), ' ha', info.color);
                    landUseSegments.push({ label: info.label, area: area as number, color: info.color });
                } else {
                    envInfoHtml += createRow('help_outline', key as string, Math.round(area as number).toLocaleString(), ' ha', '#ccc');
                    landUseSegments.push({ label: key as string, area: area as number, color: '#ccc' });
                }
            });
    } else {
        // フォールバック: landUse から復元 (vegetationAreasが永続化されていない場合)
        const humanUseArea = (settlementArea || 0) + (roadArea || 0) + (actualFarmland || 0);
        const landArea = config.HEX_AREA_HA - (oceanArea + lakeArea + riverArea);
        const remainingNatureArea = Math.max(0, landArea - humanUseArea);

        // landUse の各要素をリストアップ
        // landUse は割合 (0.0-1.0) で保持されているが、totalLandAreaに対する比率である
        // ここでは簡易的に remainingNatureArea を分配するのではなく、
        // landUse の比率 * HEX_AREA_HA (ただし水域などは除く) で面積を出す必要があるが、
        // 単純に landUse の比率の合計が 1.0 に近いはずなので、
        // (landUse.vals * safeTotal) で計算済みの値に近いものが取れるはず。

        // WorldMap.js の landUse 定義:
        // river, desert, barren, grassland, forest, beach
        if (p.landUse) {
            const safeTotal = config.HEX_AREA_HA - (oceanArea + lakeArea + riverArea); // 近似的な陸地合計

            // [FIX] 除外リストのみを定義し、それ以外はすべて表示する
            const excludeKeys = ['water', 'total', 'road', 'settlement', 'river']; // riverも別途計算済みのため除外
            const vegLabelMap = {
                'beach': { label: '砂浜', icon: 'beach_access', color: '#feb' },
                'forest': { label: '森林', icon: 'forest', color: '#228b22' },
                'grassland': { label: '草原', icon: 'grass', color: '#bda' },
                'barren': { label: '荒地', icon: 'terrain', color: '#ccb' },
                'desert': { label: '砂漠', icon: 'landscape', color: '#eca' },
                'savanna': { label: 'サバンナ', icon: 'grass', color: '#dcb' },
                'steppe': { label: 'ステップ', icon: 'grass', color: '#cda' },
                'coastal': { label: '沿岸植生', icon: 'waves', color: '#8db' },
                'iceSnow': { label: '氷雪帯', icon: 'ac_unit', color: '#eff' }
            };

            Object.entries(p.landUse).forEach(([key, ratio]) => {
                if (excludeKeys.includes(key)) return;

                if ((ratio as number) > 0) {
                    const area = (ratio as number) * safeTotal;
                    if (area > 1) {
                        const info = vegLabelMap[key] || { label: key, icon: 'help_outline', color: '#ccc' };
                        envInfoHtml += createRow(info.icon, info.label, Math.round(area).toLocaleString(), ' ha', info.color);
                        landUseSegments.push({ label: info.label, area: area, color: info.color });
                    }
                }
            });
        }
    }

    // --- カラーバーグラフの生成 ---
    if (landUseSegments.length > 0) {
        const totalArea = landUseSegments.reduce((sum, seg) => sum + seg.area, 0);
        let barHtml = '<div class="land-use-bar">';

        landUseSegments.forEach(seg => {
            const ratio = (seg.area / totalArea) * 100;
            if (ratio > 0) {
                barHtml += `<div class="land-use-segment" style="width:${ratio}%; background-color:${seg.color};" title="${seg.label}: ${Math.round(seg.area).toLocaleString()}ha (${ratio.toFixed(1)}%)"></div>`;
            }
        });
        barHtml += '</div>';

        // 「土地利用面積」ヘッダーの直後に挿入したいが、envInfoHtmlは文字列連結で構築されているため、
        // 既存の createRow 呼び出しの後に挿入する形になる。
        // ここでは、envInfoHtmlの最後にdivを追加するのではなく、
        // 「土地利用面積」セクションの直下に追加するために、少し工夫が必要。
        // しかし、現状のコード構造ではセクションの途中に挿入するのは難しい。
        // そこで、セクションの最後にバーを追加する形にするか、
        // あるいは `createRow` でリストアップされた項目の上に表示するか。
        // ユーザーの要望は「『土地利用面積』のすぐ下」なので、
        // envInfoHtml の構築順序を少し変えるか、文字列置換を行う必要がある。

        // 文字列置換で挿入する
        const headerStr = '<h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">square_foot</span>土地利用面積</h6>';
        if (envInfoHtml.includes(headerStr)) {
            envInfoHtml = envInfoHtml.replace(headerStr, headerStr + barHtml);
        } else {
            // ヘッダーが見つからない場合は末尾に追加（フォールバック）
            envInfoHtml += barHtml;
        }
    }

    const envCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">nature</span>環　境</div><div class="card-content">${envInfoHtml}</div></div></div>`;

    // --- 3. 資源カード ---
    let resourceInfoHtml = '';
    // ポテンシャル
    resourceInfoHtml += createRow('diamond', '代表鉱物', p.resourceRank);
    resourceInfoHtml += createRow('auto_awesome', '魔　力', p.manaRank);
    resourceInfoHtml += createRow('grass', '農　業', (p.agriPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('forest', '林　業', (p.forestPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('construction', '鉱　業', (p.miningPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('phishing', '漁　業', (p.fishingPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('pets', '牧　畜', (p.pastoralPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('egg', '畜　産', (p.livestockPotential * 100).toFixed(0), '%');
    resourceInfoHtml += createRow('pest_control', '狩　猟', (p.huntingPotential * 100).toFixed(0), '%');

    const resourceCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">diamond</span>資源ポテンシャル</div><div class="card-content">${resourceInfoHtml}</div></div>`;

    // --- 3. 産業構造カード (存在する場合) ---
    let industryCard = '';
    if (p.population > 0) {
        if (p.industry) {
            let industryHtml = '';

            // カテゴリ定義マップ (既存ロジック流用)
            const categoryMap = {
                '小　麦': '農　業', '大　麦': '農　業', '雑　穀': '農　業', '稲': '農　業', '果　物': '農　業', '薬　草': '農　業',
                '木　材': '林　業',
                '鉱　石': '鉱　業', '魔鉱石': '鉱　業',
                '魚介類': '漁　業',
                '牧畜肉': '畜　産', '家畜肉': '畜　産', '乳製品': '畜　産', '革': '畜　産', '魔獣素材': '畜　産',
                '狩猟肉': '狩　猟',
                '武具・道具': '鍛　冶', '織　物': '繊　維', 'ポーション・魔導具': '魔　導', '酒(穀物)': '食　品', '酒(果実)': '食　品', '建　築': '建　築'
            };

            const formatSector = (title: string, icon: string, data: { [key: string]: number }, unit: string) => {
                const entries = Object.entries(data || {}).filter(([, val]) => (val as number) > 0.1);
                if (entries.length === 0) return '';

                let html = `<div class="sector-block"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">${icon}</span>${title}</h6>`;

                // グルーピング
                const groups: { [key: string]: { key: string, val: string }[] } = {};
                const others: { key: string, val: string }[] = [];
                entries.forEach(([key, val]) => {
                    const cat = categoryMap[key as keyof typeof categoryMap];
                    const valStr = `${Math.round(val as number).toLocaleString()}${unit}`;
                    if (cat) {
                        if (!groups[cat]) groups[cat] = [];
                        groups[cat].push({ key, val: valStr });
                    } else {
                        others.push({ key, val: valStr });
                    }
                });

                for (const [cat, items] of Object.entries(groups)) {
                    html += `<div class="industry-group"><div class="group-title">${cat}</div>`;
                    items.forEach(item => {
                        html += `<div class="industry-item"><span class="label">${item.key}</span><span class="value">${item.val}</span></div>`;
                    });
                    html += `</div>`;
                }
                others.forEach(item => {
                    html += `<div class="industry-item"><span class="label">${item.key}</span><span class="value">${item.val}</span></div>`;
                });

                html += `</div>`;
                return html;
            };

            industryHtml += formatSector('第一次産業', 'agriculture', p.industry.primary, 't');
            industryHtml += formatSector('第二次産業', 'factory', p.industry.secondary, '');
            industryHtml += formatSector('第三次産業', 'store', p.industry.tertiary, 'G');
            industryHtml += formatSector('第四次産業', 'school', p.industry.quaternary, 'pt');
            industryHtml += formatSector('第五次産業', 'account_balance', p.industry.quinary, 'pt');



            industryCard = `<div class="info-card wide-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">precision_manufacturing</span>産業構造</div><div class="card-content">${industryHtml}</div></div>`;
        }
    }

    // --- 3.5. 社会構成カード (人口構成・施設) ---
    let societyCard = '';
    if (p.demographics || p.facilities) {
        let societyHtml = '';

        // 人口構成 (v2.7.6: 海軍人員のグループ化)
        if (p.demographics) {
            societyHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">people_alt</span>人口構成</h6>`;
            societyHtml += `<div class="industry-group" style="display:flex; flex-direction:column; gap:4px;">`;

            // カテゴリ分け
            const categories = {
                '第一次産業': ['農民', '漁師', '鉱夫', '木こり', '畜夫'],
                '第二次産業': ['職人'],
                '第三次産業': ['商人', '宿屋・酒場', '運送', '水夫'],
                '知識・統治': ['学者', '官僚', '聖職者'],
                '軍事・警察': ['騎士', '正規兵', '衛兵・自警団', '海軍士官', '海軍船員', '海兵', '海軍工廠・支援'],
                'その他': ['スラム', '孤児']
            };

            for (const [catName, jobs] of Object.entries(categories)) {
                let catTotal = 0;
                let catHtml = '';
                jobs.forEach(job => {
                    if (p.demographics[job] > 0) {
                        catTotal += p.demographics[job];
                        catHtml += `<div class="industry-item" style="width:100%; padding:0 8px; box-sizing: border-box;"><span class="label">${job}</span><span class="value">${p.demographics[job].toLocaleString()}人</span></div>`;
                    }
                });

                if (catTotal > 0) {
                    societyHtml += `<div class="industry-item" style="width:100%; font-weight:bold; background:#fff2; box-sizing: border-box;"><span class="label">${catName}</span><span class="value">${catTotal.toLocaleString()}人</span></div>`;
                    societyHtml += catHtml;
                }
            }
            societyHtml += `</div></div>`;
        }

        // 施設
        if (p.facilities && p.facilities.length > 0) {
            societyHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">storefront</span>施設</h6>`;
            p.facilities.forEach(f => {
                if (typeof f === 'string') {
                    societyHtml += `<div class="info-row"><span class="label">${f}</span><span class="value"></span></div>`;
                } else {
                    const levelStr = f.level > 1 ? ` <span style="font-size:0.8em; color:#666;">Lv.${f.level}</span>` : '';
                    societyHtml += `<div class="info-row"><span class="label">${f.name}${levelStr}</span><span class="value">${f.count}</span></div>`;
                }
            });
            societyHtml += `</div>`;
        }

        if (societyHtml) {
            societyCard = `<div class="info-card wide-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">deck</span>社会構成</div><div class="card-content">${societyHtml}</div></div>`;
        }
    }

    // --- 3.6. 生活水準カード (新規追加) ---
    let livingCard = '';
    if (p.livingConditions) {
        const lc = p.livingConditions;
        let livingHtml = '';

        // 治安と幸福度
        const getSecurityIcon = (score) => {
            if (score >= 80) return 'verified_user';
            if (score >= 50) return 'shield';
            if (score >= 30) return 'gpp_maybe';
            return 'gpp_bad';
        };
        const getHappinessIcon = (score) => {
            if (score >= 80) return 'sentiment_very_satisfied';
            if (score >= 50) return 'sentiment_satisfied';
            if (score >= 30) return 'sentiment_dissatisfied';
            return 'sentiment_very_dissatisfied';
        };

        livingHtml += `<div class="info-row"><span class="label"><span class="material-icons-round" style="font-size: 20px; vertical-align: middle; margin-right: 4px;">${getSecurityIcon(lc.security)}</span>治安</span><span class="value">${lc.security}/100</span></div>`;
        livingHtml += `<div class="info-row"><span class="label"><span class="material-icons-round" style="font-size: 20px; vertical-align: middle; margin-right: 4px;">${getHappinessIcon(lc.happiness)}</span>幸福度</span><span class="value">${Math.round(lc.happiness)}/100</span></div>`;

        // 食料事情
        const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement || '散居'];
        const annualDemand = p.population * (settlementInfo ? settlementInfo.consumption_t_per_person : 0.2);
        const monthlyDemand = annualDemand / 12;

        let selfSufficiency = p.selfSufficiencyRate !== undefined ? p.selfSufficiencyRate : (annualDemand > 0 ? (1 - (p.netShortage || 0) / annualDemand) : 1.0);
        selfSufficiency = Math.min(1.0, selfSufficiency); // 100%を超えないようにキャップ

        livingHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">restaurant</span>食料事情</h6>`;
        livingHtml += `<div class="info-row"><span class="label">月間消費</span><span class="value">${Math.round(monthlyDemand).toLocaleString()}t</span></div>`;
        livingHtml += `<div class="info-row"><span class="label">自給率</span><span class="value" style="${selfSufficiency < 1.0 ? 'color:#e74c3c;' : 'color:#2ecc71;'}">${(selfSufficiency * 100).toFixed(1)}%</span></div>`;
        /*
        if (p.shortage && p.shortage['食料'] > 0) {
            // 不足分も月間に換算して表示するか？とりあえず年間のままだと誤解を招くので月間に
            livingHtml += `<div class="info-row"><span class="label">月間不足</span><span class="value" style="color:#e74c3c;">-${Math.round(p.shortage['食料'] / 12).toLocaleString()}t</span></div>`;
        }
        */
        livingHtml += `</div>`;

        // 租税
        // livingHtml += `<div class="info-row"><span class="label"><span class="material-icons-round" style="font-size: 20px; vertical-align: middle; margin-right: 4px;">account_balance_wallet</span>租税</span><span class="value">${(lc.tax || 0).toLocaleString()}G</span></div>`;

        // 世帯収入・租税 (v2.2)
        if (lc.householdIncome !== undefined) {
            livingHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">account_balance_wallet</span>世帯経済 (月間)</h6>`;
            // 平均世帯人数 (v2.3)
            const householdSize = config.HOUSEHOLD_SIZE[p.settlement || '散居'] || 5.0;
            livingHtml += `<div class="info-row"><span class="label">平均世帯人数</span><span class="value">${householdSize.toFixed(1)}人</span></div>`;
            livingHtml += `<div class="info-row"><span class="label">平均世帯収入</span><span class="value">${Math.round(lc.householdIncome).toLocaleString()}G</span></div>`;
            livingHtml += `<div class="info-row"><span class="label">平均租税支出</span><span class="value" style="color:#e74c3c;">-${Math.round(lc.monthlyTax).toLocaleString()}G</span></div>`;
            livingHtml += `</div>`;
        }

        // 物価
        livingHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">payments</span>物価指数 (基準1.0)</h6>`;
        const getPriceClass = (val) => val > 1.5 ? 'shortage' : (val < 0.8 ? 'surplus' : '');
        livingHtml += `<div class="industry-item"><span class="label">食料品</span><span class="value ${getPriceClass(lc.prices.food)}">${lc.prices.food.toFixed(2)}</span></div>`;
        livingHtml += `<div class="industry-item"><span class="label">必需品</span><span class="value ${getPriceClass(lc.prices.necessities)}">${lc.prices.necessities.toFixed(2)}</span></div>`;
        livingHtml += `<div class="industry-item"><span class="label">嗜好品</span><span class="value ${getPriceClass(lc.prices.luxuries)}">${(lc.prices.luxuries || 1.0).toFixed(2)}</span></div>`;
        livingHtml += `<div class="industry-item"><span class="label">贅沢品</span><span class="value ${getPriceClass(lc.prices.high_luxuries)}">${(lc.prices.high_luxuries || 1.0).toFixed(2)}</span></div>`;
        livingHtml += `<div class="industry-item"><span class="label">野戦具</span><span class="value ${getPriceClass(lc.prices.field_gear)}">${(lc.prices.field_gear || 1.0).toFixed(2)}</span></div>`;
        livingHtml += `</div>`;

        // 詳細指標 (バー表示)
        const createBar = (label: string, value: number, color: string) => {
            const width = Math.min(100, value * 100);
            return `<div class="industry-item" style="flex-direction:column; align-items:flex-start; gap:2px;">
                <div style="display:flex; justify-content:space-between; width:100%; font-size:11px;"><span>${label}</span><span>${(value * 100).toFixed(0)}%</span></div>
                <div style="width:100%; height:4px; background:#eee; border-radius:2px;"><div style="width:${width}%; height:100%; background:${color}; border-radius:2px;"></div></div>
            </div>`;
        };

        livingHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">analytics</span>詳細指標</h6>`;
        livingHtml += createBar('貧困度', lc.poverty, '#ff6b6b');
        livingHtml += createBar('飢餓度', lc.hunger, '#e74c3c');
        livingHtml += createBar('贅沢度', lc.luxury, '#f1c40f');
        livingHtml += `</div>`;

        livingCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">family_restroom</span>生活水準</div><div class="card-content">${livingHtml}</div></div>`;
    }

    // --- 3.7. 物流・交通カード (新規追加) ---
    let logisticsCard = '';
    if (p.logistics) {
        let logisticsHtml = '';

        // 輸送能力 (v2.6) - 最上部に移動
        if (p.logistics.transportCapacity) {
            const tc = p.logistics.transportCapacity;
            logisticsHtml += `<div class="sector-block"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">local_shipping</span>輸送能力 (月間)</h6>`;
            logisticsHtml += `<div class="info-row"><span class="label">総輸送力</span><span class="value" style="font-weight:bold;">${Math.round(tc.total).toLocaleString()} t</span></div>`;
            logisticsHtml += `<div class="info-row"><span class="label">陸上輸送</span><span class="value">${Math.round(tc.land).toLocaleString()} t</span></div>`;
            if (tc.water > 0) {
                logisticsHtml += `<div class="info-row"><span class="label">水上輸送</span><span class="value">${Math.round(tc.water).toLocaleString()} t</span></div>`;
            }
            logisticsHtml += `</div>`;
        }

        // 物流資産 (陸上)
        logisticsHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">inventory</span>物流資産 (陸上)</h6>`;
        logisticsHtml += `<div class="industry-group" style="display:flex; flex-direction:column; gap:4px;">`;
        logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">荷馬車</span><span class="value">${p.logistics.wagons}台</span></div>`;

        // 役畜 (複数種類対応)
        if (p.logistics.animals && typeof p.logistics.animals === 'object') {
            for (const [type, count] of Object.entries(p.logistics.animals)) {
                logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">${type}</span><span class="value">${count}頭</span></div>`;
            }
        } else {
            // 旧形式互換
            logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">役畜</span><span class="value">${p.logistics.animals}頭</span></div>`;
        }
        logisticsHtml += `</div></div>`;
        // 物流資産 (水上)
        if (p.logistics.ships && Object.keys(p.logistics.ships).length > 0) {
            logisticsHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">sailing</span>物流資産 (水上)</h6>`;
            logisticsHtml += `<div class="industry-group" style="display:flex; flex-direction:column; gap:4px;">`;

            // 商船と軍艦を分ける
            const merchantShips = [];
            const warShips = [];

            for (const [type, count] of Object.entries(p.logistics.ships)) {
                const isWarship = config.WARSHIP_TYPES && Object.values(config.WARSHIP_TYPES).some(t => t.name === type);
                if (isWarship) {
                    warShips.push({ type, count });
                } else {
                    merchantShips.push({ type, count });
                }
            }

            // ソート順定義
            const sortOrder = [
                '河川用カヌー', '湖沼用ボート', '小舟・漁船', '湖沼交易船', '商船・大型漁船', '河川用平底船', '沿岸交易船', '中型商船', '大型帆船',
                '警備艇', '護衛艦', 'ガレー船', '戦列艦', '旗艦'
            ];

            const sorter = (a, b) => {
                const idxA = sortOrder.indexOf(a.type);
                const idxB = sortOrder.indexOf(b.type);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            };

            merchantShips.sort(sorter);
            warShips.sort(sorter);

            if (merchantShips.length > 0) {
                logisticsHtml += `<div class="industry-item" style="width:100%; font-weight:bold; font-size:11px; color:#666;">商船・漁船</div>`;
                merchantShips.forEach(s => {
                    logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">${s.type}</span><span class="value">${s.count}隻</span></div>`;
                });
            }

            if (warShips.length > 0) {
                logisticsHtml += `<div class="industry-item" style="width:100%; font-weight:bold; font-size:11px; color:#c0392b; margin-top:4px;">軍艦・警備艇</div>`;
                warShips.forEach(s => {
                    logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label" style="color:#c0392b;">${s.type}</span><span class="value" style="font-weight:bold;">${s.count}隻</span></div>`;
                });
            }

            logisticsHtml += `</div></div>`;
        }

        // 人員
        logisticsHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">badge</span>人員</h6>`;
        logisticsHtml += `<div class="industry-group" style="display:flex; flex-direction:column; gap:4px;">`;

        if (p.logistics.personnel) {
            // v2.7.5: 詳細区分
            logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">御者</span><span class="value">${p.logistics.personnel.drivers}人</span></div>`;
            if (p.logistics.personnel.skippers > 0) {
                logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">船頭</span><span class="value">${p.logistics.personnel.skippers}人</span></div>`;
            }
            if (p.logistics.personnel.crew > 0) {
                logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">船員</span><span class="value">${p.logistics.personnel.crew}人</span></div>`;
            }
        } else {
            // 旧形式互換
            logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">御者/船頭</span><span class="value">${p.logistics.drivers}人</span></div>`;
        }
        logisticsHtml += `</div></div>`;

        if (logisticsHtml) {
            logisticsCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">commute</span>物流・交通</div><div class="card-content">${logisticsHtml}</div></div>`;
        }
    }

    // --- 4. 領地集計カード (拠点の場合) ---
    let territoryCard = '';
    if (p.territoryData && ['首都', '都市', '領都', '街', '町'].includes(p.settlement)) {
        const data = p.territoryData;
        let territoryHtml = '';

        // 集落数 (直轄)
        const counts = Object.entries(data.settlementCounts).filter(([, c]) => (c as number) > 0)
            .map(([t, c]) => `${t}:${c}`).join(', ');
        if (counts) {
            territoryHtml += `<div class="info-row" style="display:block;"><span class="label" style="display:block; margin-bottom:2px;">直轄集落</span><span class="value" style="font-size:12px;">${counts}</span></div>`;
        }

        // 集落数 (全隷下)
        const allSubordinateCounts = getAllSubordinateSettlements(d.index);
        const allCountsStr = Object.entries(allSubordinateCounts).filter(([, c]) => (c as number) > 0)
            .map(([t, c]) => `${t}:${c}`).join(', ');
        if (allCountsStr) {
            territoryHtml += `<div class="info-row" style="display:block;"><span class="label" style="display:block; margin-bottom:2px;">全隷下集落</span><span class="value" style="font-size:12px;">${allCountsStr}</span></div>`;
        }

        territoryHtml += createRow('group', '合計人口', data.population.toLocaleString(), '人');
        territoryHtml += createRow('landscape', '合計農地', Math.round(data.cultivatedArea).toLocaleString(), 'ha');

        // 収支
        const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement];
        const totalDemand = data.population * settlementInfo.consumption_t_per_person;
        const totalSupply = Object.values(data.production as { [key: string]: number }).reduce((a, b) => a + b, 0);
        const balance = totalSupply - totalDemand;

        if (balance >= 0) {
            territoryHtml += `<div class="food-balance surplus">領内余剰: +${Math.round(balance).toLocaleString()}t</div>`;
        } else {
            territoryHtml += `<div class="food-balance shortage">領内不足: ${Math.round(balance).toLocaleString()}t</div>`;
        }

        territoryCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">domain</span>領地管理</div><div class="card-content">${territoryHtml}</div></div>`;
    }

    // --- 結合してコンテナに入れる ---
    // info-scroll-container自体はスクロールさせる
    // 以前のレイアウト構成を復元 (ボタンはindex.htmlの静的要素を使用するためここには含めない)
    return `<div style="position: relative; height: 100%; width: 100%; overflow: hidden;">
        <div class="info-scroll-container" style="height: 100%; overflow-y: auto; padding-top: 10px;">
            ${basicCard}${envCard}${resourceCard}${industryCard}${societyCard}${livingCard}${logisticsCard}${territoryCard}
        </div>
    </div>`;
}

/**
 * ヘックスデータをJSON形式(日本語キー)で返す
 * 情報ウィンドウの表示内容に準拠
 * @param {object} d - ヘックスデータ
 * @returns {string} - JSON文字列
 */
export function generateHexJson(d) {
    const p = d.properties;
    const json = {};

    // 1. 基本情報
    json['基本情報'] = {
        'ID': d.index,
        '所属': p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺境',
        '座標': `E${String(d.x).padStart(3, '0')}-N${String(d.y).padStart(3, '0')}`,
        '集落規模': p.settlement || null,
        '上位集落ID': p.parentHexId,
        '人口': p.population || 0,
        '居住適性': (p.habitability || 0).toFixed(1)
    };
    if (p.characteristics && p.characteristics.length > 0) {
        json['基本情報']['特徴'] = p.characteristics;
    }

    // 2. 環境
    // 水域面積計算 (getInfoTextのロジック再利用)
    let lakeNeighbors = 0;
    let oceanNeighbors = 0;
    if (d.neighbors) {
        d.neighbors.forEach(nIdx => {
            const nHex = allHexesData[nIdx];
            if (nHex && nHex.properties.isWater) {
                if (nHex.properties.vegetation === '湖沼') lakeNeighbors++;
                else if (nHex.properties.vegetation === '海洋' || nHex.properties.vegetation === '深海') oceanNeighbors++;
            }
        });
    }
    const lakeArea = p.isWater && p.vegetation === '湖沼' ? config.HEX_AREA_HA : (!p.isWater ? lakeNeighbors * 100 : 0);
    const oceanArea = p.isWater && p.vegetation !== '湖沼' ? config.HEX_AREA_HA : (!p.isWater ? oceanNeighbors * 100 : 0);

    let riverArea = 0;
    if (!p.isWater) {
        if (p.waterArea > 0) {
            riverArea = p.waterArea;
        } else if (p.flow > 0) {
            // 簡易計算 (詳細ロジックは複雑なため、単純化して対応)
            riverArea = 0.2 * Math.sqrt(p.flow) * 6; // 平均的な長さと仮定
        }
    }

    // 農地面積計算
    const RECLAMATION_SUITABILITY = {
        'grassland': 0.9, 'savanna': 0.8, 'steppe': 0.8, 'temperateForest': 0.6,
        'subarcticForest': 0.4, 'tropicalRainforest': 0.3, 'wetland': 0.2,
        'coastal': 0.3, 'beach': 0.1, 'desert': 0.1, 'wasteland': 0.2,
        'tundra': 0.05, 'alpine': 0.05, 'iceSnow': 0.0
    };
    let maxPotentialFarmland = 0;
    if (p.vegetationAreas) {
        Object.entries(p.vegetationAreas).forEach(([vegType, area]) => {
            maxPotentialFarmland += (area as number) * (RECLAMATION_SUITABILITY[vegType as keyof typeof RECLAMATION_SUITABILITY] || 0);
        });
    } else {
        const landArea = config.HEX_AREA_HA - (oceanArea + lakeArea + riverArea);
        maxPotentialFarmland = landArea * 0.5; // フォールバック
    }
    let actualFarmland = p.cultivatedArea || 0;
    if (p.population > 0) {
        let farmers = 0;
        if (p.demographics && p.demographics['農民']) {
            farmers = p.demographics['農民'];
        } else {
            farmers = p.population * 0.64; // Fallback
        }
        const required = farmers * 1.2;
        actualFarmland = Math.min(required, maxPotentialFarmland);
        if (actualFarmland < (p.cultivatedArea || 0)) actualFarmland = p.cultivatedArea;
    }

    // 住居・道路
    const settlementArea = p.population > 0 ? 0.02 * Math.pow(p.population, 0.85) : 0;
    const roadArea = p.roadEdges ? p.roadEdges.reduce((a, b) => a + b, 0) : 0;

    json['環境'] = {
        '地形': p.isWater ? p.vegetation : (p.terrainType || p.vegetation),
        '代表植生': p.vegetation || 'なし',
        '標高': Math.round(p.elevation) + 'm',
        '気候帯': p.climateZone,
        '気温': p.temperature.toFixed(1) + '℃',
        '降水量': p.precipitation_mm.toFixed(0) + 'mm',
        '魔物ランク': p.monsterRank,
        '土地利用': {
            '海洋': oceanArea > 1 ? Math.round(oceanArea) + 'ha' : undefined,
            '湖沼': lakeArea > 1 ? Math.round(lakeArea) + 'ha' : undefined,
            '河川': riverArea > 1 ? Math.round(riverArea) + 'ha' : undefined,
            '農地': actualFarmland > 1 ? Math.round(actualFarmland) + 'ha' : undefined,
            '集落': settlementArea > 1 ? Math.round(settlementArea) + 'ha' : undefined,
            '道路': roadArea > 1 ? Math.round(roadArea) + 'ha' : undefined
        }
    };
    // Clean up undefined land use
    Object.keys(json['環境']['土地利用']).forEach(key => {
        if (json['環境']['土地利用'][key] === undefined) delete json['環境']['土地利用'][key];
    });

    // 3. 資源
    json['資源ポテンシャル'] = {
        '魔力ランク': p.manaRank,
        '代表鉱物': p.resourceRank,
        '農業': (p.agriPotential * 100).toFixed(0) + '%',
        '林業': (p.forestPotential * 100).toFixed(0) + '%',
        '鉱業': (p.miningPotential * 100).toFixed(0) + '%',
        '漁業': (p.fishingPotential * 100).toFixed(0) + '%',
        '牧畜': (p.pastoralPotential * 100).toFixed(0) + '%',
        '畜産': (p.livestockPotential * 100).toFixed(0) + '%',
        '狩猟': (p.huntingPotential * 100).toFixed(0) + '%'
    };

    // 4. 産業 (人口がいる場合)
    if (p.population > 0 && p.industry) {
        json['産業'] = {};
        const formatInd = (src) => {
            const res: { [key: string]: number } = {};
            Object.entries(src).forEach(([k, v]) => {
                if ((v as number) > 0.1) res[k] = Math.round(v as number);
            });
            return Object.keys(res).length > 0 ? res : null;
        };
        const prim = formatInd(p.industry.primary);
        if (prim) json['産業']['第一次産業'] = prim;
        const sec = formatInd(p.industry.secondary);
        if (sec) json['産業']['第二次産業'] = sec;
        const tert = formatInd(p.industry.tertiary);
        if (tert) json['産業']['第三次産業'] = tert;
    }

    // 5. 社会 (人口がいる場合)
    if (p.population > 0 && p.demographics) {
        json['社会'] = {
            '人口構成': p.demographics
        };
        if (p.facilities && p.facilities.length > 0) {
            json['社会']['施設'] = p.facilities.map(f => `${f.name}(Lv.${f.level}) x${f.count}`);
        }
    }

    // 6. 生活 (Living conditions)
    if (p.livingConditions) {
        json['生活水準'] = {
            '治安': p.livingConditions.security,
            '幸福度': Math.round(p.livingConditions.happiness),
            '自給率': (Math.min(1.0, p.selfSufficiencyRate || 0) * 100).toFixed(1) + '%',
            '物価': p.livingConditions.prices
        };
        if (p.livingConditions.householdIncome) {
            json['生活水準']['平均世帯年収'] = Math.round(p.livingConditions.householdIncome);
        }
    }

    // 7. 物流
    if (p.logistics) {
        json['物流'] = {
            '荷馬車': p.logistics.wagons,
            '役畜': p.logistics.animals,
            '輸送能力': p.logistics.transportCapacity ? Math.round(p.logistics.transportCapacity.total) + 't' : undefined
        };
        if (p.logistics.ships && Object.keys(p.logistics.ships).length > 0) {
            json['物流']['船舶'] = p.logistics.ships;
        }
    }

    // 8. 隣接情報
    const neighborsInfo = [];
    const directMap = ['北東', '東', '南東', '南西', '西', '北西']; // 偶数行(even-r)の場合の方向など、六角形グリッドの方向定義に注意が必要だが、ここでは単純なインデックス順とする

    if (d.neighbors && d.neighbors.length > 0) {
        d.neighbors.forEach((neighborIndex, i) => {
            const neighborHex = allHexesData[neighborIndex];
            if (neighborHex) {
                const np = neighborHex.properties;
                neighborsInfo.push({
                    '方向': i, // 正確な方位はcol/rowの偶奇によるが、ここではインデックスのみ
                    'ID': neighborIndex,
                    '地形': np.isWater ? np.vegetation : (np.terrainType || np.vegetation),
                    '標高': Math.round(np.elevation),
                    '所属': np.nationId > 0 && config.NATION_NAMES[np.nationId - 1] ? config.NATION_NAMES[np.nationId - 1] : '辺境',
                    '集落': np.settlement || 'なし'
                });
            }
        });
    }
    json['隣接情報'] = neighborsInfo;

    return JSON.stringify(json, null, 2);
}

// ================================================================
// 凡例生成関数
// ================================================================

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
        const lowerBound = domain[i - 1] ? domain[i - 1] : 0;
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
export function updateLegend(layerName) {
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
