// ================================================================
// GeoForge System - Info Window & Legend Module
// ================================================================
// このモジュールは、情報ウィンドウのコンテンツ生成、
// サイドバーの統計情報更新、および凡例の生成を担当します。
// ================================================================

import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, formatLocation } from './utils.js';

// --- モジュールスコープ変数 ---
export let childrenMap = new Map();
let allHexesData = [];
let legendContainer = null;

/**
 * 情報ウィンドウモジュールの初期化
 * @param {HTMLElement} container - 凡例を表示するコンテナ要素
 */
export function initInfoWindow(container) {
    legendContainer = container;
}

/**
 * 全ヘックスデータを設定する
 * @param {Array<object>} data - 全ヘックスデータ
 */
export function setAllHexesData(data) {
    allHexesData = data;
}

/**
 * 集落の親子関係マップを更新する関数
 * @param {Array<object>} hexesData - 全ヘックスのデータ
 */
export function updateChildrenMap(hexesData) {
    allHexesData = hexesData; // データも更新しておく
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

/**
 * 指定されたヘックスを起点として、全ての隷下集落を再帰的に集計する関数
 * @param {number} rootIndex - 起点となるヘックスのインデックス
 * @returns {object} 集落タイプごとのカウント { '街': 1, '村': 5, ... }
 */
export function getAllSubordinateSettlements(rootIndex) {
    const counts = {};
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
 * @param {Array<object>} allHexes - 全てのヘックスデータ
 */
export function updateOverallInfo(allHexes) {
    if (!allHexes || allHexes.length === 0) return;

    // --- DOM要素の取得 ---
    const popEl = document.getElementById('info-total-population');
    const nationCountEl = document.getElementById('info-nation-count');
    const settlementSummaryEl = document.getElementById('info-settlement-summary');
    const nationsDetailsEl = document.getElementById('info-nations-details');
    if (nationsDetailsEl) nationsDetailsEl.innerHTML = ''; // 事前にクリア

    // --- 集計用データ構造の初期化 ---
    const globalStats = {
        population: 0,
        nations: new Set(),
        settlements: { '首都': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
    };
    const nationStats = new Map();
    // 辺境地帯用の集計オブジェクトを追加
    const frontierStats = {
        population: 0,
        settlements: { '首都': 0, '領都': 0, '街': 0, '町': 0, '村': 0 }
    };

    // --- STEP 1: 全ヘックスを走査し、データ集計 ---
    allHexes.forEach(h => {
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
            const currentNation = nationStats.get(p.nationId);
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
export function getInfoText(d) {
    const p = d.properties;

    // --- ヘルパー: アイコン付き行の生成 ---
    const createRow = (icon, label, value, unit = '') => {
        return `<div class="info-row"><span class="label"><span class="material-icons-round" style="font-size: 20px; vertical-align: middle; margin-right: 4px;">${icon}</span>${label}</span><span class="value">${value}${unit}</span></div>`;
    };

    // --- 1. 基本情報カード ---
    let basicInfoHtml = '';

    // 位置・所属
    const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺　境';
    basicInfoHtml += createRow('flag', '所　属', nationName);
    basicInfoHtml += createRow('place', '座　標', `E${String(d.x).padStart(3, '0')}-N${String(d.y).padStart(3, '0')}`);

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
    envInfoHtml += createRow('forest', '植　生', p.vegetation || 'なし');

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

    // 8. 魔力ランク
    envInfoHtml += createRow('auto_awesome', '魔力ランク', p.manaRank);

    // 9. 資源
    envInfoHtml += createRow('diamond', '資　源', p.resourceRank);

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

        // 2. 河川の面積 (流量^2 x 1ha x 河川長)
        if (p.flow > 0) {
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

            // 面積計算: 流量^2 * 1ha * 長さ
            let calculatedArea = Math.pow(p.flow, 2) * 1 * riverLengthKm;

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
    if (oceanArea > 1) envInfoHtml += createRow('water', '海洋水域', Math.round(oceanArea).toLocaleString(), ' ha');
    // 13. 湖沼水域
    if (lakeArea > 1) envInfoHtml += createRow('water', '湖沼水域', Math.round(lakeArea).toLocaleString(), ' ha');
    // 14. 河川水域
    if (riverArea > 1) envInfoHtml += createRow('water', '河川水域', Math.round(riverArea).toLocaleString(), ' ha');

    // 15. 農地面積
    if (p.cultivatedArea > 1) {
        envInfoHtml += createRow('agriculture', '農地面積', Math.round(p.cultivatedArea).toLocaleString(), ' ha');
    }

    // 16. 集落面積
    let settlementArea = 0;
    if (p.population > 0) {
        settlementArea = 0.02 * Math.pow(p.population, 0.85);
    }
    if (settlementArea > 1) {
        envInfoHtml += createRow('location_city', '集落面積', Math.round(settlementArea).toLocaleString(), ' ha');
    }

    // 17. 道路面積
    let roadArea = 0;
    if (p.roadEdges) {
        roadArea = p.roadEdges.reduce((a, b) => a + b, 0);
    }
    if (roadArea > 0) {
        envInfoHtml += createRow('add_road', '道路面積', Math.round(roadArea).toLocaleString(), ' ha');
    }

    // 18. 森林面積
    if (p.landUse && p.landUse.forest > 0) {
        const forestArea = p.landUse.forest * config.HEX_AREA_HA;
        if (forestArea > 1) {
            envInfoHtml += createRow('forest', '森林面積', Math.round(forestArea).toLocaleString(), ' ha');
        }
    }

    const envCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">nature</span>環　境</div><div class="card-content">${envInfoHtml}</div></div></div>`;

    // --- 3. 資源カード ---
    let resourceInfoHtml = '';
    // ポテンシャル
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

            const formatSector = (title, icon, data, unit) => {
                const entries = Object.entries(data || {}).filter(([, val]) => val > 0.1);
                if (entries.length === 0) return '';

                let html = `<div class="sector-block"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">${icon}</span>${title}</h6>`;

                // グルーピング
                const groups = {};
                const others = [];
                entries.forEach(([key, val]) => {
                    const cat = categoryMap[key];
                    const valStr = `${Math.round(val).toLocaleString()}${unit}`;
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

        // 人口構成
        if (p.demographics && Object.keys(p.demographics).length > 0) {
            societyHtml += `<div class="sector-block"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">groups</span>人口構成</h6>`;
            societyHtml += `<div class="industry-group" style="display:flex; flex-wrap:wrap; gap:4px;">`;
            for (const [role, count] of Object.entries(p.demographics)) {
                if (count > 0) {
                    societyHtml += `<div class="industry-item" style="width:100%;"><span class="label">${role}</span><span class="value">${count.toLocaleString()}人</span></div>`;
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
        const createBar = (label, value, color) => {
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

        // 物流資産 (ストック)
        logisticsHtml += `<div class="sector-block" style="margin-top:8px;"><h6><span class="material-icons-round" style="font-size:14px; vertical-align:text-bottom; margin-right:4px;">inventory</span>物流資産 (保有)</h6>`;
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

        // 船舶
        if (p.logistics.ships && typeof p.logistics.ships === 'object') {
            for (const [type, count] of Object.entries(p.logistics.ships)) {
                logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">${type}</span><span class="value">${count}隻</span></div>`;
            }
        }

        logisticsHtml += `<div class="industry-item" style="width:100%;"><span class="label">人員(御者/船頭)</span><span class="value">${p.logistics.drivers}人</span></div>`;
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
        const counts = Object.entries(data.settlementCounts).filter(([, c]) => c > 0)
            .map(([t, c]) => `${t}:${c}`).join(', ');
        if (counts) {
            territoryHtml += `<div class="info-row" style="display:block;"><span class="label" style="display:block; margin-bottom:2px;">直轄集落</span><span class="value" style="font-size:12px;">${counts}</span></div>`;
        }

        // 集落数 (全隷下)
        const allSubordinateCounts = getAllSubordinateSettlements(d.index);
        const allCountsStr = Object.entries(allSubordinateCounts).filter(([, c]) => c > 0)
            .map(([t, c]) => `${t}:${c}`).join(', ');
        if (allCountsStr) {
            territoryHtml += `<div class="info-row" style="display:block;"><span class="label" style="display:block; margin-bottom:2px;">全隷下集落</span><span class="value" style="font-size:12px;">${allCountsStr}</span></div>`;
        }

        territoryHtml += createRow('group', '合計人口', data.population.toLocaleString(), '人');
        territoryHtml += createRow('landscape', '合計農地', Math.round(data.cultivatedArea).toLocaleString(), 'ha');

        // 収支
        const settlementInfo = config.SETTLEMENT_PARAMS[p.settlement];
        const totalDemand = data.population * settlementInfo.consumption_t_per_person;
        const totalSupply = Object.values(data.production).reduce((a, b) => a + b, 0);
        const balance = totalSupply - totalDemand;

        if (balance >= 0) {
            territoryHtml += `<div class="food-balance surplus">領内余剰: +${Math.round(balance).toLocaleString()}t</div>`;
        } else {
            territoryHtml += `<div class="food-balance shortage">領内不足: ${Math.round(balance).toLocaleString()}t</div>`;
        }

        territoryCard = `<div class="info-card"><div class="card-header"><span class="material-icons-round" style="margin-right: 6px;">domain</span>領地管理</div><div class="card-content">${territoryHtml}</div></div>`;
    }

    // --- 結合してコンテナに入れる ---
    // コピーボタンを追加
    const copyBtnHtml = `<button id="copy-info-json-btn" class="copy-btn" title="JSONでコピー"><span class="material-icons-round" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">content_copy</span></button>`;

    return `<div class="info-scroll-container">${copyBtnHtml}${basicCard}${envCard}${resourceCard}${industryCard}${societyCard}${livingCard}${logisticsCard}${territoryCard}</div>`;
}

/**
 * ヘックスデータをJSON形式で返す
 * @param {object} d - ヘックスデータ
 * @returns {string} - JSON文字列
 */
export function generateHexJson(d) {
    // 隣接ヘックスの情報を取得
    const neighborsInfo = [];
    if (d.neighbors && d.neighbors.length > 0) {
        d.neighbors.forEach(neighborIndex => {
            const neighborHex = allHexesData[neighborIndex];
            if (neighborHex) {
                const p = neighborHex.properties;
                neighborsInfo.push({
                    index: neighborIndex,
                    x: neighborHex.col, // allHexesData uses col/row
                    y: neighborHex.row,
                    isWater: p.isWater,
                    elevation: p.elevation,
                    terrainType: p.terrainType,
                    vegetation: p.vegetation,
                    isAlluvial: p.isAlluvial,
                    hasSnow: p.hasSnow,
                    beachNeighbors: p.beachNeighbors,
                    settlement: p.settlement
                });
            }
        });
    }

    const exportData = {
        index: d.index,
        x: d.x,
        y: d.y,
        properties: d.properties,
        // ユーザー要望の地理フラグを明示的に追加
        isCoastal: d.properties.isCoastal,
        isLakeside: d.properties.isLakeside,
        beachNeighbors: d.properties.beachNeighbors,
        isRiver: d.properties.isRiver,
        riverFlow: d.properties.riverFlow,
        neighbors: neighborsInfo
    };
    return JSON.stringify(exportData, null, 2);
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
