import * as d3 from 'd3';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

const loadingOverlay = document.getElementById('loading-overlay');
const logContainer = document.getElementById('loading-log'); // ログコンテナを取得
const uiContainer = document.querySelector('.ui-container');
const populationDisplay = document.getElementById('population-display');

// ★★★ 処理を一時停止し、ブラウザに描画する時間を与えるためのヘルパー関数 ★★★
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ★★★ メッセージを「追加」していく新しい関数 ★★★
async function addLogMessage(message) {
    console.log(message);
    const entry = document.createElement('p');
    entry.className = 'log-entry';
    entry.textContent = `・ ${message}`;
    logContainer.appendChild(entry);
    // 自動で一番下までスクロールさせる
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // ★★★ メッセージを描画させるために、ここで必ず少し待つ ★★★
    await sleep(20);
}

// ★★★ 全体の処理を非同期関数でラップする ★★★
async function runWorldGeneration() {
// ================================================================
// GeoForge System 設定
// ================================================================
await addLogMessage("世界の原型を創造中...");
// ----------------------------------------------------------------
// ■ 基本設定
// ----------------------------------------------------------------
const COLS = 100;
const ROWS = 87;
const HEX_SIZE_KM = 20;
const r = 20;

// ----------------------------------------------------------------
// ■ ノイズジェネレーター
//    - 各種データを生成するための、それぞれ独立したノイズ関数
// ----------------------------------------------------------------
const terrainNoise = createNoise2D(); // 地形・標高のベース
const manaNoise = createNoise2D(); // 龍脈（魔力）
const climateNoise = createNoise2D(); // 気温のゆらぎ
const precipitationNoise = createNoise2D(); // 降水量のゆらぎ
const forestPotentialNoise = createNoise2D(); // 森林の育ちやすさ
const taigaPotentialNoise = createNoise2D(); // 針葉樹林の育ちやすさ
const junglePotentialNoise = createNoise2D(); // 密林の育ちやすさ
const vegetationCoverageNoise = createNoise2D(); // 植生全体の量
const grasslandPotentialNoise = createNoise2D(); // 草原の育ちやすさ
const miningPotentialNoise = createNoise2D(); // 鉱業ポテンシャル

// ----------------------------------------------------------------
// ■ 地形生成パラメータ
//    - 大陸の形状や険しさをコントロールする
// ----------------------------------------------------------------
const NOISE_SCALE =               0.05; 
const LAND_BIAS =                 0.7; 
const ELEVATION_PEAK_FACTOR =     2.0; 
const CONTINENT_FALLOFF_FACTOR =  4.0;
const LAKE_THRESHOLD_PLAINS =    -0.90;
const LAKE_THRESHOLD_MOUNTAINS = -0.85;
const elevationScale = d3.scaleLinear().domain([0.0, 1.6]).range([0, 7000]).clamp(true);
const lakeThresholdScale = d3.scaleLinear()
    .domain([0.3, 1.3])
    .range([LAKE_THRESHOLD_PLAINS, LAKE_THRESHOLD_MOUNTAINS])
    .clamp(true);

// ----------------------------------------------------------------
// ■ デフォルト表示用の配色設定
// ----------------------------------------------------------------
// 1. 各標高帯に対応するグラデーションを定義
const elevationColor_0_1k = d3.scaleLinear()
    .domain([0, 1000])
    .range(['#d8ecd3', '#a8d5a2']); // 明るい黄緑〜淡緑

// 丘陵〜低山（1000–2000m）：緑から薄いベージュ
const elevationColor_1k_2k = d3.scaleLinear()
    .domain([1000, 2000])
    .range(['#a8d5a2', '#dcd5c9']); // 淡緑〜砂色

// 中山帯（2000–3000m）：ベージュから薄茶
const elevationColor_2k_3k = d3.scaleLinear()
    .domain([2000, 3000])
    .range(['#dcd5c9', '#c2a383']); // 砂色〜薄茶

// 高山帯（3000–4000m）：薄茶からグレー
const elevationColor_3k_4k = d3.scaleLinear()
    .domain([3000, 4000])
    .range(['#c2a383', '#b0b0b0']); // 薄茶〜明るい灰色

// 雪山（4000m以上）：グレーから白
const elevationColor_4k_plus = d3.scaleLinear()
    .domain([4000, 7000])
    .range(['#b0b0b0', '#ffffff']); // 灰色〜白

// 2. 水域と、標高図に上書きする植生の固定色を定義
const TERRAIN_COLORS = {
    深海: '#136', 
    海洋: '#248', 
    湖沼: '#058',
    砂漠: '#e8d9b5', 
    森林: '#6aa84f', 
    針葉樹林: '#3b6e4f', 
    密林: '#1b5e20',
    // 沖積平野: '#b8d698'
};

// 3. 標高値から対応するグラデーション色を返すヘルパー関数
function getElevationColor(elevation) {
    if (elevation < 1000) return elevationColor_0_1k(elevation);
    if (elevation < 2000) return elevationColor_1k_2k(elevation);
    if (elevation < 3000) return elevationColor_2k_3k(elevation);
    if (elevation < 4000) return elevationColor_3k_4k(elevation);
    return elevationColor_4k_plus(elevation);
}

// ----------------------------------------------------------------
// ■ 気候・植生関連の定義
// ----------------------------------------------------------------
// 植生タイプを決定するための物理的な閾値
const VEGETATION_THRESHOLDS = {
    ALPINE_ELEVATION: 4000, 
    TUNDRA_TEMP:  -10, 
    DESERT_PRECIP: 0.04,
    JUNGLE_MIN_PRECIP: 0.10, 
    FOREST_MIN_PRECIP: 0.10,
    SPARSE_MIN_PRECIP: 0.10, 
    TAIGA_MIN_PRECIP: 0.00,
};

// ★★★ 新規：積雪を判定するための閾値 ★★★
const SNOW_THRESHOLDS = {
    TEMPERATURE: -10,       // -15℃以下で積雪の可能性
    PRECIPITATION_LIGHT: 0.1, // 降水量10%以上で積雪
    PRECIPITATION_HEAVY: 0.4, // 降水量40%以上で深雪
};

// 基準気候と降水量から9つの気候帯を定義するための閾値
const TEMP_ZONES = { COLD: 0, TEMPERATE: 20 };
const PRECIP_ZONES = { DRY: 0.35, MODERATE: 0.65 };

// 9つの気候帯の色分け
const CLIMATE_ZONE_COLORS = {
    "砂漠気候(寒)":   '#d2b48c', // タン系：寒冷砂漠の乾いた土色
    "ツンドラ気候":   '#5dade2', // 明るい寒色：氷雪と苔をイメージ
    "亜寒帯湿潤気候": '#2874a6', // 濃い青緑：タイガの深い森
    "ステップ気候":   '#e67e22', // オレンジ寄り：乾いた草原
    "地中海性気候":   '#58d68d', // 明るい緑：オリーブや低木林
    "温暖湿潤気候":   '#239b56', // 深緑：落葉広葉樹林
    "砂漠気候(熱)":   '#f4d03f', // 鮮やかな黄色：灼熱の砂漠
    "熱帯草原気候":   '#f5b041', // 黄土色：サバンナの草原
    "熱帯雨林気候":   '#145a32'  // 濃い緑：密林の深い緑
};
// ----------------------------------------------------------------
// ■ オーバーレイ用のカラーマップ
// ----------------------------------------------------------------
const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]);
const tempColor = d3.scaleSequential(d3.interpolateTurbo).domain([-15, 35]);
const precipColor = d3.scaleSequential(d3.interpolateBlues).domain([0, 1]);
// const elevationOverlayColor = d3.scaleSequential(d3.interpolateTurbo).domain([0, 7000]);
// ★★★ 新規：各産業ポテンシャル用のカラーマップ ★★★
const agriColor = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);
const forestColor = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
const miningColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);
const fishingColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]);
const populationColor = d3.scaleLinear().domain([0, 150000]).range(["black", "red"]);

// ================================================================
// データ生成ロジック
// ================================================================
const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

const getIndex = (col, row) => row * COLS + col;

/**
 * 第1パス：物理的な基本プロパティを生成する関数
 */
function generateBaseProperties(col, row) {
    const nx = col * NOISE_SCALE;
    const ny = row * NOISE_SCALE;
    
    let baseElevation = terrainNoise(nx, ny);
    if (baseElevation > 0) {
        baseElevation = Math.pow(baseElevation, ELEVATION_PEAK_FACTOR);
    }
    const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2));
    const falloff = Math.pow(distFromCenter / maxDist, CONTINENT_FALLOFF_FACTOR);
    const internalElevation = baseElevation + LAND_BIAS - falloff;

    const properties = {};
    
    const inlandWaterNoise = terrainNoise(nx + 100, ny + 100);
    const dynamicLakeThreshold = lakeThresholdScale(internalElevation);
    const isWater = internalElevation < 0.0 || (inlandWaterNoise < dynamicLakeThreshold && internalElevation < 1.3);
    properties.isWater = isWater;
    properties.elevation = isWater ? 0 : elevationScale(internalElevation);
    
    const latitude = row / ROWS;
    const baseTemp = -5 + (latitude * 35);
    properties.climate = baseTemp + climateNoise(nx, ny) * 5;
    
    let elevationCorrection = 0;
    if (properties.elevation > 0) {
        elevationCorrection = (properties.elevation / 100) * 0.6;
    }
    properties.temperature = properties.climate - elevationCorrection;

    const basePrecip = (col / COLS);
    const precipNoiseValue = precipitationNoise(nx, ny) * 0.2;
    properties.precipitation = Math.max(0, Math.min(1, basePrecip + precipNoiseValue));
    
    if (properties.climate < TEMP_ZONES.COLD) {
        if (properties.precipitation < PRECIP_ZONES.DRY) properties.climateZone = "砂漠気候(寒)";
        else if (properties.precipitation < PRECIP_ZONES.MODERATE) properties.climateZone = "ツンドラ気候";
        else properties.climateZone = "亜寒帯湿潤気候";
    } else if (properties.climate < TEMP_ZONES.TEMPERATE) {
        if (properties.precipitation < PRECIP_ZONES.DRY) properties.climateZone = "ステップ気候";
        else if (properties.precipitation < PRECIP_ZONES.MODERATE) properties.climateZone = "地中海性気候";
        else properties.climateZone = "温暖湿潤気候";
    } else {
        if (properties.precipitation < PRECIP_ZONES.DRY) properties.climateZone = "砂漠気候(熱)";
        else if (properties.precipitation < PRECIP_ZONES.MODERATE) properties.climateZone = "熱帯草原気候";
        else properties.climateZone = "熱帯雨林気候";
    }

    properties.hasSnow = false;
    if (!isWater && properties.temperature <= SNOW_THRESHOLDS.TEMPERATURE && properties.precipitation > SNOW_THRESHOLDS.PRECIPITATION_LIGHT) {
        properties.hasSnow = true;
    }

    const rawManaValue = manaNoise(nx / 2, ny / 2);
    properties.manaValue = Math.pow(1.0 - Math.abs(rawManaValue), 8);
    if (properties.manaValue > 0.9) properties.manaRank = 'S';
    else if (properties.manaValue > 0.7) properties.manaRank = 'A';
    else if (properties.manaValue > 0.4) properties.manaRank = 'B';
    else if (properties.manaValue > 0.1) properties.manaRank = 'C';
    else properties.manaRank = 'D';

    const resourceSymbols = ['木', '石', '鉄', '金', '晶'];
    properties.resourceRank = resourceSymbols[Math.floor(Math.random() * resourceSymbols.length)];
    
    return properties;
}


// ================================================================
// ★★★ 変更点：データ生成プロセスを3つのパスに再構築 ★★★
// ================================================================

// --- 第1パス：全ヘックスの基本プロパティを生成 ---
await addLogMessage("地面の起伏を生成しています...");
const allHexes = [];
for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
        allHexes.push({ col, row, properties: generateBaseProperties(col, row) });
    }
}
// 隣接情報をキャッシュ
allHexes.forEach(h => {
    const { col, row } = h;
    const isOddCol = col % 2 !== 0;
    h.neighbors = [
        { col: col, row: row - 1 }, { col: col, row: row + 1 },
        { col: col - 1, row: row }, { col: col + 1, row: row },
        { col: col - 1, row: isOddCol ? row + 1 : row - 1 },
        { col: col + 1, row: isOddCol ? row + 1 : row - 1 },
    ].filter(n => n.col >= 0 && n.col < COLS && n.row >= 0 && n.row < ROWS)
     .map(n => getIndex(n.col, n.row));
});

// --- 第2パス：水系を生成 ---
await addLogMessage("水系と河川を配置しています...");
const riverSources = allHexes.filter(h => {
    if (h.properties.isWater || h.properties.elevation < 1000) return false;
    const isRainyMountain = h.properties.elevation > 1500 && h.properties.precipitation > 0.5;
    const isHighPeak = h.properties.elevation > 2000;
    let probability = 0;
    if (isRainyMountain) probability = 0.20;
    else if (isHighPeak) probability = 0.20;
    return Math.random() < probability;
});

allHexes.forEach(h => h.properties.flow = 0);

riverSources.forEach(source => {
    let currentCol = source.col;
    let currentRow = source.row;
    for (let i = 0; i < 50; i++) {
        const currentIndex = getIndex(currentCol, currentRow);
        allHexes[currentIndex].properties.flow += 1;
        const neighbors = allHexes[currentIndex].neighbors.map(i => allHexes[i]);
        let lowestNeighbor = null;
        let minElevation = allHexes[currentIndex].properties.elevation;
        neighbors.forEach(n => {
            if (n.properties.elevation < minElevation) {
                minElevation = n.properties.elevation;
                lowestNeighbor = n;
            }
        });
        if (lowestNeighbor) {
            currentCol = lowestNeighbor.col;
            currentRow = lowestNeighbor.row;
            if (lowestNeighbor.properties.isWater) {
                lowestNeighbor.properties.flow += 1;
                break;
            }
        } else {
            if (!allHexes[currentIndex].properties.isWater) {
                 allHexes[currentIndex].properties.isWater = true;
            }
            break;
        }
    }
});

// --- 第3パス：水系情報を元に、最終的なプロパティ（植生、産業ポテンシャル）を計算 ---
 await addLogMessage("気候と植生を計算しています...");
allHexes.forEach(h => {
    const { properties, col, row } = h;
    const { isWater, elevation, temperature, precipitation, climate } = properties;
    const nx = col * NOISE_SCALE;
    const ny = row * NOISE_SCALE;

    // 1. 沖積平野フラグ
    properties.isAlluvial = properties.flow > 0 && !isWater && elevation < 4000;

    // 2. 最終的な植生
    if (isWater) {
        if (elevationScale.invert(elevation) < -0.4) properties.vegetation = '深海';
        else if (elevationScale.invert(elevation) < 0.0) properties.vegetation = '海洋';
        else properties.vegetation = '湖沼';
    } else if (elevation > VEGETATION_THRESHOLDS.ALPINE_ELEVATION) {
        properties.vegetation = '高山';
    } else if (temperature < VEGETATION_THRESHOLDS.TUNDRA_TEMP) {
        properties.vegetation = '荒れ地';
    } else if (precipitation < VEGETATION_THRESHOLDS.DESERT_PRECIP) {
        properties.vegetation = '砂漠';
    } else {
        const totalCoverage = (1 + vegetationCoverageNoise(nx, ny)) / 2;
        const potentials = {
            '密林': (1 + junglePotentialNoise(nx * 0.5, ny * 0.5)) / 2,
            '森林': (1 + forestPotentialNoise(nx, ny)) / 2,
            '疎林': (1 + forestPotentialNoise(nx, ny)) / 2,
            '針葉樹林': (1 + taigaPotentialNoise(nx * 2, ny * 2)) / 2,
            '草原': (1 + grasslandPotentialNoise(nx, ny)) / 2,
            '荒れ地': 0.1,
        };
        const candidates = [];
        if (climate > TEMP_ZONES.TEMPERATE) {
            if (precipitation > VEGETATION_THRESHOLDS.JUNGLE_MIN_PRECIP) candidates.push('密林');
            candidates.push('草原');
        } else if (climate > TEMP_ZONES.COLD) {
            if (precipitation > VEGETATION_THRESHOLDS.FOREST_MIN_PRECIP) candidates.push('森林');
            if (precipitation > VEGETATION_THRESHOLDS.SPARSE_MIN_PRECIP) candidates.push('疎林');
            candidates.push('草原');
        } else {
            if (precipitation > VEGETATION_THRESHOLDS.TAIGA_MIN_PRECIP) candidates.push('針葉樹林');
            candidates.push('荒れ地');
        }
        let totalPotential = 0;
        const proportions = [];
        candidates.forEach(veg => { totalPotential += potentials[veg] || 0; });
        if (totalPotential > 0) {
            candidates.forEach(veg => {
                proportions.push({ type: veg, percentage: (potentials[veg] / totalPotential) * totalCoverage });
            });
        }
        const bareGroundPercentage = 1.0 - proportions.reduce((sum, p) => sum + p.percentage, 0);
        proportions.push({ type: '裸地', percentage: bareGroundPercentage });
        let dominantVeg = { type: '裸地', percentage: -1 };
        proportions.forEach(p => { if (p.percentage > dominantVeg.percentage) { dominantVeg = p; } });
        properties.vegetation = (dominantVeg.type === '裸地') ? '標高ベース' : dominantVeg.type;
    }

    // 3. 産業ポテンシャル
    let agriPotential = 0;
    if (!isWater) {
        if (properties.isAlluvial) agriPotential += 0.5;
        if (h.neighbors.some(nIndex => allHexes[nIndex].properties.vegetation === '湖沼')) agriPotential += 0.3;
        if (properties.vegetation === '草原') agriPotential += 0.2;
        const idealTemp = 17.5;
        const tempFactor = Math.max(0, 1 - Math.abs(temperature - idealTemp) / 15);
        agriPotential += tempFactor * 0.3;
        const idealPrecip = 0.55;
        const precipFactor = Math.max(0, 1 - Math.abs(precipitation - idealPrecip) / 0.3);
        agriPotential += precipFactor * 0.2;
    }
    properties.agriPotential = Math.min(1.0, agriPotential);

    let forestPotential = 0;
    switch (properties.vegetation) {
        case '密林': forestPotential = 1.0; break;
        case '森林': forestPotential = 0.8; break;
        case '針葉樹林': forestPotential = 0.6; break;
        case '疎林': forestPotential = 0.3; break;
    }
    properties.forestPotential = forestPotential;

    let miningPotential = 0;
    if (!isWater) {
        miningPotential += (elevation / 7000) * 0.5;
        miningPotential += ((1 + miningPotentialNoise(nx * 3, ny * 3)) / 2) * 0.5;
    }
    properties.miningPotential = Math.min(1.0, miningPotential);
    
    let fishingPotential = 0;
    if (!isWater) {
        let waterBonus = 0;
        h.neighbors.forEach(nIndex => {
            const neighborHex = allHexes[nIndex];
            if (neighborHex.properties.isWater) {
                if (neighborHex.properties.vegetation === '海洋' || neighborHex.properties.vegetation === '深海') waterBonus = Math.max(waterBonus, 0.9);
                else if (neighborHex.properties.vegetation === '湖沼') waterBonus = Math.max(waterBonus, 0.6);
            }
        });
        fishingPotential += waterBonus;
        if (properties.isAlluvial) {
            fishingPotential += Math.min(Math.sqrt(properties.flow) * 0.15, 0.4);
            const isEstuary = h.neighbors.some(nIndex => {
                const neighborVeg = allHexes[nIndex].properties.vegetation;
                return neighborVeg === '海洋' || neighborVeg === '深海';
            });
            if (isEstuary) fishingPotential += 0.2;
        }
    }
    properties.fishingPotential = Math.min(1.0, fishingPotential);
});

// --- ★★★ 新規：第4パス：居住地の配置 ★★★ ---
await addLogMessage("居住に適した土地を探しています...");
// 1. 各ヘックスの居住適性スコアを計算
allHexes.forEach(h => {
    const p = h.properties;
    let score = 0;
    if (!p.isWater && p.vegetation !== '高山' && p.vegetation !== '砂漠') {
        // 農業ポテンシャルは最も重要
        score += p.agriPotential * 40;
        // 漁業ポテンシャルも重要
        score += p.fishingPotential * 20;
        // 気温が快適か (10-25度が最適)
        const idealTemp = 17.5;
        score += Math.max(0, 1 - Math.abs(p.temperature - idealTemp) / 15) * 15;
        // 魔力も少し影響
        score += p.manaValue * 10;
        // 鉱業・林業も少し影響
        score += p.miningPotential * 5;
        score += p.forestPotential * 5;
    }
    p.habitability = score; // 0-100のスコア
});

// 2. 居住地候補をスコア順にソート
const settlementCandidates = allHexes
    .filter(h => h.properties.habitability > 0)
    .sort((a, b) => b.properties.habitability - a.properties.habitability);

// 距離を計算するヘルパー関数
const getDistance = (h1, h2) => {
    // 簡易的なヘックス距離計算
    const dx = Math.abs(h1.col - h2.col);
    const dy = Math.abs(h1.row - h2.row);
    return Math.max(dx, dy);
};

// 3. 都市を階層的に配置
const settlements = [];
const MIN_DISTANCES = { '都': 20, '街': 10, '町': 4 };

// 3a. 「都」を配置
// ★★★ 変更点：都の数と人口を調整 ★★★
const numCapitals = 3;
for (let i = 0; i < settlementCandidates.length && settlements.filter(s => s.type === '都').length < numCapitals; i++) {
    const candidate = settlementCandidates[i];
    // isSettledプロパティで配置済みかを確認
    if (!candidate.properties.isSettled && settlements.every(s => getDistance(s.hex, candidate) > MIN_DISTANCES['都'])) {
        candidate.properties.settlement = '都';
        // 人口を5万〜15万人に設定
        candidate.properties.population = Math.floor(50000 + Math.random() * 100000);
        candidate.properties.isSettled = true; // 配置済みフラグ
        settlements.push({ hex: candidate, type: '都' });
    }
}

// 3b. 「街」を配置
// ★★★ 変更点：街の数と人口を調整 ★★★
const numCities = 8;
for (let i = 0; i < settlementCandidates.length && settlements.filter(s => s.type === '街').length < numCities; i++) {
    const candidate = settlementCandidates[i];
    if (!candidate.properties.isSettled && settlements.every(s => getDistance(s.hex, candidate) > MIN_DISTANCES['街'])) {
        candidate.properties.settlement = '街';
        // 人口を1万〜5万人に設定
        candidate.properties.population = Math.floor(10000 + Math.random() * 40000);
        candidate.properties.isSettled = true;
        settlements.push({ hex: candidate, type: '街' });
    }
}

// 4. 町と村を拡散させる
settlements.forEach(city => {
    const 庇護人口 = city.hex.properties.population * 1.5;
    let currentPopulation = 0;
    const nearbyHexes = allHexes
        .filter(h => h.properties.habitability > 0 && !h.properties.isSettled) // 未配置の土地のみ
        .sort((a, b) => getDistance(city.hex, a) - getDistance(city.hex, b));

    for (const nearbyHex of nearbyHexes) {
        if (currentPopulation > 庇護人口) break;
        if (nearbyHex.properties.isSettled) continue;

        const dist = getDistance(city.hex, nearbyHex);
        const probability = (nearbyHex.properties.habitability / 100) * Math.pow(0.85, dist);
        
        if (Math.random() < probability) {
            // ★★★ 変更点：町と村の人口を調整 ★★★
            if (probability > 0.3 && dist < 10) {
                nearbyHex.properties.settlement = '町';
                // 人口を1,000〜10,000人に設定
                const pop = Math.floor(1000 + Math.random() * 9000);
                nearbyHex.properties.population = pop;
                currentPopulation += pop;
            } else {
                nearbyHex.properties.settlement = '村';
                // 人口を100〜1,000人に設定
                const pop = Math.floor(100 + Math.random() * 900);
                nearbyHex.properties.population = pop;
                currentPopulation += pop;
            }
            nearbyHex.properties.isSettled = true; // 配置済みにする
        }
    }
});

// 5. 人口が設定されていないヘックスに、居住適性に応じた「散居人口」を設定する
allHexes.forEach(h => {
    // ↓↓↓ このブロック全体を以下のように書き換えます ↓↓↓
    if (!h.properties.isSettled && h.properties.habitability > 5) {
        // 居住適性スコアが高いほど、100人未満の人口が割り当てられやすくなる
        // Math.random() < (h.properties.habitability / 150) で発生確率を制御
        if (Math.random() < (h.properties.habitability / 150)) {
            // 人口はスコアに応じて1〜99人の間で変動
            h.properties.population = Math.floor((h.properties.habitability / 100) * 80 + Math.random() * 20);
        } else {
            h.properties.population = 0;
        }
    } else if (!h.properties.population) {
        // 居住適性が低い場所や、既に都市がある場所の人口が未設定なら0にする
        h.properties.population = 0;
    }
});

// ★★★ 居住地生成の後に人口を計算して表示 ★★★
const totalPopulation = allHexes.reduce((sum, h) => sum + (h.properties.population || 0), 0);
await addLogMessage(`居住地が生まれました... 総人口: ${totalPopulation.toLocaleString()}人`);

// --- ★★★ 新規：第4.5パス：辺境のハブとなる「町」の追加 ★★★ ---
await addLogMessage("辺境のハブ都市を創設しています...");
// 1. 既存の町や都市から遠く離れた、孤立している村をリストアップする
const HUB_SEARCH_RADIUS = 10; // この半径内に町がない村を「孤立」と見なす
const majorSettlements = allHexes.filter(h => ['町', '街', '都'].includes(h.properties.settlement));

let isolatedVillages = allHexes.filter(h => {
    if (h.properties.settlement !== '村') {
        return false;
    }
    // 最も近い主要な居住地を探し、その距離を測る
    const isIsolated = !majorSettlements.some(s => getDistance(h, s) <= HUB_SEARCH_RADIUS);
    return isIsolated;
});

// 2. 孤立した村々を、地理的に近いクラスター（集団）にグループ化する
const isolatedClusters = [];
while (isolatedVillages.length > 0) {
    const seed = isolatedVillages.shift(); // 最初の村をクラスタの核とする
    const currentCluster = [seed];
    
    // 核の周辺にある他の孤立した村をクラスタに追加する
    // Arrayを逆順でループすると、安全に要素を削除できる
    for (let i = isolatedVillages.length - 1; i >= 0; i--) {
        const otherVillage = isolatedVillages[i];
        if (getDistance(seed, otherVillage) < HUB_SEARCH_RADIUS) {
            currentCluster.push(otherVillage);
            isolatedVillages.splice(i, 1); // クラスタに追加した村はリストから削除
        }
    }
    isolatedClusters.push(currentCluster);
}

// 3. 各クラスター内で、最もポテンシャルの高い村を「町」に昇格させる
isolatedClusters.forEach(cluster => {
    if (cluster.length > 0) {
        // クラスター内で最も人口の多い村をハブ候補とする
        cluster.sort((a, b) => b.properties.population - a.properties.population);
        const hubVillage = cluster[0];

        // 候補の村を「町」に昇格させる
        hubVillage.properties.settlement = '町';
        // 人口も町らしく少し増やす（最低1000人を保証）
        hubVillage.properties.population = Math.max(hubVillage.properties.population, 1000 + Math.floor(Math.random() * 2000));
        
        console.log(`[DEBUG] 辺境ハブ生成: E${hubVillage.col}-N${(ROWS - 1) - hubVillage.row} の村を町に昇格させました。`);
    }
});

// --- ★★★ 新規：第4.7パス：食料経済のシミュレーション ★★★ ---
await addLogMessage("各地域の食料需給を計算中...");

// 1. 経済パラメータの定義
const HEX_AREA_HA = 34641; // 1ヘックスの面積 (ha)
const CROP_DATA = {
    '小麦': { yield: 0.60, type: '畑作', cultivation_ha_per_person: 1.5 },
    '大麦': { yield: 0.75, type: '畑作', cultivation_ha_per_person: 1.5 },
    '雑穀': { yield: 0.65, type: '畑作', cultivation_ha_per_person: 1.5 },
    '稲':   { yield: 1.35, type: '水田', cultivation_ha_per_person: 0.8 },
};

const SETTLEMENT_PARAMS = {
    '都':     { labor_rate: 0.25, consumption_t_per_person: 0.30, infra_coeff: 1.1, head_cap_base: 0.40, head_cap_bonus: 0.10 },
    '街':     { labor_rate: 0.40, consumption_t_per_person: 0.25, infra_coeff: 1.05, head_cap_base: 0.35, head_cap_bonus: 0.05 },
    '町':     { labor_rate: 0.60, consumption_t_per_person: 0.22, infra_coeff: 1.0, head_cap_base: 0.30, head_cap_bonus: 0.0 },
    '村':     { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.9, head_cap_base: 0.25, head_cap_bonus: 0.0 },
    '散居':   { labor_rate: 0.80, consumption_t_per_person: 0.20, infra_coeff: 0.85, head_cap_base: 0.20, head_cap_bonus: 0.0 }
};

const LIVESTOCK_COEFF = 1.0; // 家畜係数 (人力1.0) ※家畜利用は1.8
const CONSOLIDATION_COEFF = 1.0; // 連坦係数 (連坦1.0) ※分散は0.8

// 2. 各ヘックスの食料需給を計算
allHexes.forEach(h => {
    const p = h.properties;
    p.surplus = {}; // 余剰プロパティを初期化
    p.shortage = {}; // 不足プロパティを初期化
    p.cultivatedArea = 0; // ★★★ 変更点：農地面積を初期化 ★★★
    
    if (p.population <= 0 || p.isWater) {
        return; // 人口がいない、または水域なら計算しない
    }

    // A. 需要の計算
    // ---------------------------------
    const settlementType = p.settlement ? p.settlement : '散居';
    const settlementInfo = SETTLEMENT_PARAMS[settlementType];
    const annualConsumptionPerPerson = settlementInfo.consumption_t_per_person;
    const totalDemand = p.population * annualConsumptionPerPerson;

    // B. 供給の計算
    // ---------------------------------
    // B-1. 主食と作付け割合の決定
    let mainCrops = {};
    const climate = p.climateZone;
    if (climate.includes("亜寒帯") || climate.includes("ツンドラ") || climate.includes("ステップ") || climate.includes("砂漠(寒)")) {
        mainCrops = { '大麦': 0.6, '雑穀': 0.4 };
    } else if (climate.includes("温暖") || climate.includes("地中海")) {
        mainCrops = { '小麦': 0.7, '雑穀': 0.3 };
    } else if (climate.includes("熱帯")) {
        mainCrops = p.isAlluvial ? { '稲': 0.8, '雑穀': 0.2 } : { '雑穀': 1.0 };
    } else {
        mainCrops = { '雑穀': 1.0 }; // デフォルト
    }

    // B-2. 耕作可能面積の計算
    // ヘッドキャップ (上限)
    // 居住地3%, 土地ポテンシャルに応じて20%～50%、都市部はボーナス
    const headCapPotential = settlementInfo.head_cap_base + p.agriPotential * (0.5 - settlementInfo.head_cap_base) + settlementInfo.head_cap_bonus;
    const maxCultivationArea = HEX_AREA_HA * Math.max(0.03, headCapPotential);

    // 労働力ベース
    const laborPopulation = p.population * settlementInfo.labor_rate;
    let avgCultivationHaPerPerson = 0;
    Object.keys(mainCrops).forEach(cropName => {
        avgCultivationHaPerPerson += CROP_DATA[cropName].cultivation_ha_per_person * mainCrops[cropName];
    });
    
    // 家畜係数と連坦係数を仮で設定（本来は地域や文化レベルで変動）
    const livestockCoeff = p.settlement === '村' ? 1.0 : 1.8; // 村は人力、町以上は家畜利用が多いと仮定
    const consolidationCoeff = p.settlement === '村' ? 0.8 : 1.0; // 村は分散、町以上は連坦と仮定

    const laborBasedArea = laborPopulation * avgCultivationHaPerPerson * livestockCoeff * consolidationCoeff * settlementInfo.infra_coeff;

    // 最終的な耕作面積の決定
    const finalCultivationArea = Math.min(maxCultivationArea, laborBasedArea);
    p.cultivatedArea = finalCultivationArea; // ★★★ 変更点：農地面積をプロパティに保存 ★★★
    
    // B-3. 収穫量の計算
    let totalSupply = 0;
    const yieldFluctuation = 0.7 + Math.random() * 0.6; // 並作(1.0)から±30%の変動
    
    Object.keys(mainCrops).forEach(cropName => {
        const crop = CROP_DATA[cropName];
        const cropArea = finalCultivationArea * mainCrops[cropName];
        const cropYield = cropArea * crop.yield * yieldFluctuation;
        totalSupply += cropYield;
    });
    
    // C. 需給バランスの決定
    // ---------------------------------
    const balance = totalSupply - totalDemand;
    
    if (balance > 0) {
        // 自給量、備蓄を差し引いた残りを余剰とする（租税＋商品化量）
        const surplusAmount = balance * 0.7; // 30%は備蓄やロスと仮定
        if (surplusAmount > 0) {
            Object.keys(mainCrops).forEach(cropName => {
                const share = (surplusAmount * mainCrops[cropName]).toFixed(1);
                if (parseFloat(share) > 0) p.surplus[cropName] = share;
            });
        }
    } else {
        Object.keys(mainCrops).forEach(cropName => {
            const share = (Math.abs(balance) * mainCrops[cropName]).toFixed(1);
             if (parseFloat(share) > 0) p.shortage[cropName] = share;
        });
    }
});


// --- 第5パス：街道の生成 ---
await addLogMessage("街道の整備を開始しました...");

// 事前に全ヘックスの最大人口を計算しておく
// これを基準に、人口が少ない場所へのペナルティを計算する
const maxPopulation = allHexes.reduce((max, h) => Math.max(max, h.properties.population || 0), 0);
// ★★★ 街道生成ロジック内で総延長を計算する ★★★
let totalRoadHexes = 0; // 街道が通るヘックスの総数をカウント

// 1. 各ヘックスに移動コストを設定
allHexes.forEach(h => {
    // ... (この部分は前回から変更なし) ...
    const p = h.properties;
    let cost = 1;
    if (p.isWater) cost = Infinity; // ★★★ isWaterフラグで一括して通行不可にする ★★★
    else {
        if (p.vegetation === '湖沼') cost = 50; // isWaterがfalseの湖沼(干拓地など)は高コスト
        if (p.vegetation === '森林' || p.vegetation === '疎林') cost += 2;
        if (p.vegetation === '密林' || p.vegetation === '針葉樹林') cost += 4;
        if (p.elevation > 1000) {
            const elevationFactor = p.elevation / 700;
            const elevationPenalty = Math.pow(elevationFactor, 2.8);
            cost += elevationPenalty;
        }
        if (p.flow > 2) cost += p.flow * 3;
    }
    p.movementCost = cost;
});

/**
 * A* Pathfinding Algorithm (自己完結型)
 */
function findAStarPath(options) {
    const start = options.start;
    const isEnd = options.isEnd;
    const neighbor = options.neighbor;
    const cost = options.cost;
    const heuristic = options.heuristic;

    const toVisit = [{ node: start, f: 0, g: 0 }];
    const visited = new Map();
    visited.set(`${start.x}-${start.y}`, { parent: null, g: 0 });

    while (toVisit.length > 0) {
        toVisit.sort((a, b) => a.f - b.f);
        const current = toVisit.shift();

        if (isEnd(current.node)) {
            const path = [];
            let curr = current.node;
            while (curr) {
                path.unshift(curr);
                const visitedNode = visited.get(`${curr.x}-${curr.y}`);
                curr = visitedNode ? visitedNode.parent : null;
            }
            return path;
        }

        // ★★★ この neighbor(current.node).forEach の中を修正 ★★★
        const parentNode = visited.get(`${current.node.x}-${current.node.y}`).parent;
        neighbor(current.node).forEach(n => {
            // cost関数に3番目の引数として parentNode を渡す
            const gScore = current.g + cost(current.node, n, parentNode);
            const visitedNeighbor = visited.get(`${n.x}-${n.y}`);

            if (!visitedNeighbor || gScore < visitedNeighbor.g) {
                visited.set(`${n.x}-${n.y}`, { parent: current.node, g: gScore });
                const fScore = gScore + heuristic(n);
                toVisit.push({ node: n, f: fScore, g: gScore });
            }
        });
    }
    return null;
}

/**
 * A* Pathfinding Algorithm (自己完結型)
 */
// ヘルパー：2点間の最短経路を探す関数
const findPath = (startHex, endHex) => {
    const path = findAStarPath({
        start: {x: startHex.col, y: startHex.row},
        isEnd: (node) => node.x === endHex.col && node.y === endHex.row,
        neighbor: (node) => {
            const hex = allHexes[getIndex(node.x, node.y)];
            return hex.neighbors
                .map(nIndex => allHexes[nIndex])
                .filter(neighborHex => !neighborHex.properties.isWater)
                .map(neighborHex => ({ x: neighborHex.col, y: neighborHex.row }));
        },
        // ★★★ この cost 関数を以下のように全面的に書き換えます ★★★
        cost: (nodeA, nodeB, parentNode) => {
            const targetHex = allHexes[getIndex(nodeB.x, nodeB.y)];

            // --- ルール1：既存の街道があるなら、それが最優先 ---
            // 既存の街道上を移動するコストは限りなくゼロに近い。
            if (targetHex.properties.roadTraffic > 0) {
                return 0.1;
            }

            const startHex = allHexes[getIndex(nodeA.x, nodeA.y)];
            
            // --- ルール2：地形のコストは「勾配」を最重視する ---
            // 標高差が大きい（急な坂）ほど、コストが爆発的に増加する。
            const elevationDifference = Math.abs(startHex.properties.elevation - targetHex.properties.elevation);
            const slopePenaltyFactor = 20; // 勾配へのペナルティを強化 (調整点)
            let terrainCost = 1 + Math.pow(elevationDifference / 100, 2) * slopePenaltyFactor;

            // 絶対的な標高や植生は、補助的なコストとして少しだけ加算する
            terrainCost += (targetHex.properties.movementCost -1) * 0.5; // movementCostの基本値1を除いたペナルティを半減させて加える

            // --- ルール3：遠回りの三角形や不自然な蛇行を抑制する「直進性」ペナルティ ---
            let turnPenalty = 0;
            if (parentNode) {
                const dx1 = nodeA.x - parentNode.x;
                const dy1 = nodeA.y - parentNode.y;
                const dx2 = nodeB.x - nodeA.x;
                const dy2 = nodeB.y - nodeA.y;
                // 移動方向が変わった場合（直進でない場合）にペナルティ
                if (dx1 !== dx2 || dy1 !== dy2) {
                    turnPenalty = 20; // 直進を促すための固定ペナルティ (調整点)
                }
            }
            
            // --- ルール4：人口は、最終的な微調整のための要素 ---
            // 人口が少ない場所へのペナルティは、他の要因に比べ影響を小さくする
            const populationFactor = 1.0 - (targetHex.properties.population / maxPopulation);
            const populationPenalty = populationFactor * 5; // ペナルティの重みを下げる (調整点)

            // 全てのコストを合計して返す
            return terrainCost + turnPenalty + populationPenalty;
        },
        heuristic: (node) => {
            return getDistance(allHexes[getIndex(node.x, node.y)], endHex);
        }
    });

    if (path) {
        return path.map(node => getIndex(node.x, node.y));
    }
    return [];
};

// ヘルパー：最も近いターゲットを探す関数
const findClosest = (source, targets) => {
    let closest = null;
    let minDistance = Infinity;
    targets.forEach(target => {
        const d = getDistance(source, target);
        if (d < minDistance) {
            minDistance = d;
            closest = target;
        }
    });
    return closest;
};

// 2. 交通量を初期化し、階層的に街道を生成・交通量を即時反映

// 2a. 全ヘックスの交通量をリセット
allHexes.forEach(h => {
    h.properties.roadTraffic = 0;
});

// 2b. 居住地リストを取得
const allSettlements = allHexes.filter(h => h.properties.settlement);
const capitals = allSettlements.filter(h => h.properties.settlement === '都');
const cities = allSettlements.filter(h => h.properties.settlement === '街');
const towns = allSettlements.filter(h => h.properties.settlement === '町');
const villages = allSettlements.filter(h => h.properties.settlement === '村');

console.log(`[DEBUG] 居住地チェック: 都(${capitals.length}), 街(${cities.length}), 町(${towns.length}), 村(${villages.length})`);

// 2c. 経路を探索し、見つけ次第すぐに交通量を更新する関数
const connectSettlements = (sourceList, targetList) => {
    sourceList.forEach(source => {
        const closest = findClosest(source, targetList);
        if (closest) {
            const path = findPath(source, closest);
            if (path.length > 0) {
                // 経路が見つかったら、その経路上の各ヘックスの交通量をすぐに増やす
                path.forEach(hexIndex => {
                    allHexes[hexIndex].properties.roadTraffic += source.properties.population;
                    totalRoadHexes++; // ★★★ カウントを増やす ★★★
                });
            }
        }
    });
};

// 2d. 階層が下の居住地から順に、上位の居住地へ道を繋いでいく
// これにより、村が作った道を町が利用し、町が作った道を街が利用する...という流れが生まれる
await addLogMessage("集落間の道を整備中...");
connectSettlements(villages, [...towns, ...cities, ...capitals]);
await addLogMessage("地方の道を幹線に接続中...");
connectSettlements(towns, [...cities, ...capitals]);
await addLogMessage("主要都市間を結んでいます...");
connectSettlements(cities, capitals);
await addLogMessage("国家間の大動脈を敷設中...");
// 2e. 最後に、都同士を幹線道路で結ぶ
for (let i = 0; i < capitals.length; i++) {
    for (let j = i + 1; j < capitals.length; j++) {
        const path = findPath(capitals[i], capitals[j]);
        if (path.length > 0) {
            path.forEach(hexIndex => {
                allHexes[hexIndex].properties.roadTraffic += 100000; // 幹線は高い交通量
                totalRoadHexes++; // ★★★ カウントを増やす ★★★
            });
        }
    }
}
// ★★★ 街道生成完了後に総延長を表示 ★★★
const totalRoadKm = totalRoadHexes * HEX_SIZE_KM;
await addLogMessage(`街道網が完成しました！ 総延長: ${totalRoadKm.toLocaleString()} km`);

// ================================================================
// D3.jsによる描画
// ================================================================
await addLogMessage("世界を描画しています...");
const svg = d3.select('#hexmap');
const g = svg.append('g');

// --- 1. ヘックスデータの事前計算 ---
const hexes = [];
const hexWidth = 2 * r;
const hexHeight = Math.sqrt(3) * r;

// ★★★ 変更点：下流のヘックス情報をプロパティに追加 ★★★
for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
        const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
        const cx = col * (hexWidth * 3 / 4) + r;
        const cy = row * hexHeight + offsetY + r;
        const hexData = allHexes[getIndex(col, row)];
        
        // 川が流れる場合、下流のヘックスを探す
        let downstreamHex = null;
        if (hexData.properties.flow > 0 && !hexData.properties.isWater) {
            const isOddCol = col % 2 !== 0;
            const neighborsCoords = [
                { col: col, row: row - 1 }, { col: col, row: row + 1 },
                { col: col - 1, row: row }, { col: col + 1, row: row },
                { col: col - 1, row: isOddCol ? row + 1 : row - 1 },
                { col: col + 1, row: isOddCol ? row + 1 : row - 1 },
            ];
            let lowestNeighbor = null;
            let minElevation = hexData.properties.elevation;
            neighborsCoords.forEach(n => {
                if (n.col >= 0 && n.col < COLS && n.row >= 0 && n.row < ROWS) {
                    const neighbor = allHexes[getIndex(n.col, n.row)];
                    if (neighbor.properties.elevation < minElevation) {
                        minElevation = neighbor.properties.elevation;
                        lowestNeighbor = n;
                    }
                }
            });
            if(lowestNeighbor) {
                // 下流のヘックスの中心座標を計算して保存
                const downOffsetY = (lowestNeighbor.col % 2 === 0) ? 0 : hexHeight / 2;
                downstreamHex = {
                    cx: lowestNeighbor.col * (hexWidth * 3 / 4) + r,
                    cy: lowestNeighbor.row * hexHeight + downOffsetY + r
                };
            }
        }

        hexes.push({
            x: col, y: (ROWS - 1) - row, cx: cx, cy: cy,
            points: d3.range(6).map(i => [cx + r * Math.cos(Math.PI / 3 * i), cy + r * Math.sin(Math.PI / 3 * i)]),
            properties: hexData.properties,
            downstream: downstreamHex, // 下流の情報を追加
            neighbors: hexData.neighbors, // 描画用データに隣接情報をコピーする
        });
    }
}

// --- 2. レイヤー管理のセットアップ ---
const layers = {};
function createLayer(name, visibleByDefault = true) {
    const layerGroup = g.append('g').attr('class', `${name}-layer`);
    layers[name] = { group: layerGroup, visible: visibleByDefault };
    if (!visibleByDefault) { layerGroup.style('display', 'none'); }
    return layerGroup;
}

// レイヤーを定義順に作成
const terrainLayer = createLayer('terrain');
const snowLayer = createLayer('snow');
const elevationOverlayLayer = createLayer('elevation-overlay', false);
const riverLayer = createLayer('river');
const roadLayer = createLayer('road');
const precipOverlayLayer = createLayer('precip-overlay', false);
const tempOverlayLayer = createLayer('temp-overlay', false);
const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false);
const manaOverlayLayer = createLayer('mana-overlay', false);
// ★★★ 新規：産業ポテンシャルレイヤーを追加 ★★★
const agriOverlayLayer = createLayer('agri-overlay', false);
const forestOverlayLayer = createLayer('forest-overlay', false);
const miningOverlayLayer = createLayer('mining-overlay', false);
const fishingOverlayLayer = createLayer('fishing-overlay', false);
const populationOverlayLayer = createLayer('population-overlay', false);

const labelLayer = createLayer('labels');

// --- 3. 各レイヤーの描画 ---
// 1. 地形レイヤー (積雪のロジックを削除)
terrainLayer.selectAll('.hex')
    .data(hexes).enter().append('polygon')
    .attr('class', 'hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => {
        // 最優先で居住地の種類をチェックし、色を決定する
        if (d.properties.settlement === '都') {
            return '#f00'; // やや落ち着いた赤
        }
        if (d.properties.settlement === '街') {
            return '#f80'; // やや落ち着いたオレンジ
        }
        if (d.properties.settlement === '町') {
            return '#ff0'; // やや落ち着いたオレンジ
        }

        // 既存の地形・植生の色分けロジック
        if (d.properties.vegetation === '湖沼') return TERRAIN_COLORS['湖沼'];
        const veg = d.properties.vegetation;
        if (TERRAIN_COLORS[veg]) {
            return TERRAIN_COLORS[veg];
        }
        return getElevationColor(d.properties.elevation);
    });

// 2. 川レイヤー
riverLayer.selectAll('.river-path')
    .data(hexes.filter(d => d.properties.flow > 0 && d.downstream))
    .enter().append('line')
    .attr('class', 'river-path')
    .attr('x1', d => d.cx)
    .attr('y1', d => d.cy)
    .attr('x2', d => d.downstream.cx) // 保存した下流の座標を使用
    .attr('y2', d => d.downstream.cy) // 保存した下流の座標を使用
    .attr('stroke', '#058')
    .attr('stroke-width', d => Math.min(Math.sqrt(d.properties.flow) * 2, r)) // 太くなりすぎないように上限を設定
    .attr('stroke-linecap', 'round')
    .style('pointer-events', 'none');

// ★★★ 新規：積雪レイヤーの描画 ★★★
snowLayer.selectAll('.snow-hex')
    // hasSnowがtrueのヘックスのみをフィルタリング
    .data(hexes.filter(d => d.properties.hasSnow))
    .enter().append('polygon')
    .attr('class', 'snow-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', '#fff') // 雪の色
    .style('fill-opacity', 0.8) // 半透明にして下の地形がうっすら見えるように
    .style('pointer-events', 'none'); // マウスイベントを透過させる

// 2b. 街道レイヤー
const roadSegments = [];
hexes.forEach(h => {
    if (h.properties.roadTraffic > 0) {
        // 隣接ヘックスをループ
        h.neighbors.map(i => hexes[i]).forEach(n => {
            // 重複描画を避けるため、インデックスが小さい方から大きい方へのみ線を描画
            if (n && n.properties.roadTraffic > 0 && getIndex(h.x, (ROWS-1)-h.y) < getIndex(n.x, (ROWS-1)-n.y)) {
                roadSegments.push({
                    source: { cx: h.cx, cy: h.cy },
                    target: { cx: n.cx, cy: n.cy },
                    traffic: (h.properties.roadTraffic + n.properties.roadTraffic) / 2
                });
            }
        });
    }
});
roadLayer.selectAll('.road-segment')
    .data(roadSegments)
    .enter().append('line')
    .attr('x1', d => d.source.cx)
    .attr('y1', d => d.source.cy)
    .attr('x2', d => d.target.cx)
    .attr('y2', d => d.target.cy)
    .attr('stroke', '#f00') // 赤色
    .attr('stroke-width', d => Math.min(Math.log(d.traffic) * 0.5, r * 0.3))
    .attr('stroke-dasharray', '4, 4')
    .style('pointer-events', 'none');

// 3f. 標高オーバーレイ (植生なしの標高グラデーション)
elevationOverlayLayer.selectAll('.elevation-hex')
    .data(hexes.filter(d => !d.properties.isWater))
    .enter().append('polygon')
    .attr('class', 'elevation-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => getElevationColor(d.properties.elevation))
    .style('fill-opacity', 0.9) // 少し不透明度を上げて見やすく
    .style('pointer-events', 'none');

// 3c. 気候帯オーバーレイ
climateZoneOverlayLayer.selectAll('.climate-zone-hex')
    .data(hexes).enter().append('polygon')
    .attr('class', 'climate-zone-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => CLIMATE_ZONE_COLORS[d.properties.climateZone])
    .style('fill-opacity', 0.8).style('pointer-events', 'none');

// 3e. 気温オーバーレイ
tempOverlayLayer.selectAll('.temp-hex')
    .data(hexes).enter().append('polygon')
    .attr('class', 'temp-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => tempColor(d.properties.temperature))
    .style('fill-opacity', 0.6).style('pointer-events', 'none');

// 3d. 降水量オーバーレイ
precipOverlayLayer.selectAll('.precip-hex')
    .data(hexes).enter().append('polygon')
    .attr('class', 'precip-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => precipColor(d.properties.precipitation))
    .style('fill-opacity', 0.6).style('pointer-events', 'none');

// 3b. 魔力オーバーレイ
manaOverlayLayer.selectAll('.mana-hex')
    .data(hexes).enter().append('polygon')
    .attr('class', 'mana-hex')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => manaColor(d.properties.manaValue))
    .style('fill-opacity', 0.6).style('pointer-events', 'none');

// ★★★ 新規：産業ポテンシャルレイヤーの描画 ★★★
// 農業
agriOverlayLayer.selectAll('.agri-hex')
    .data(hexes).enter().append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => agriColor(d.properties.agriPotential))
    .style('fill-opacity', 0.7).style('pointer-events', 'none');

// 林業
forestOverlayLayer.selectAll('.forest-hex')
    .data(hexes).enter().append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => forestColor(d.properties.forestPotential))
    .style('fill-opacity', 0.7).style('pointer-events', 'none');

// 鉱業
miningOverlayLayer.selectAll('.mining-hex')
    .data(hexes).enter().append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => miningColor(d.properties.miningPotential))
    .style('fill-opacity', 0.7).style('pointer-events', 'none');

// 漁業
fishingOverlayLayer.selectAll('.fishing-hex')
    .data(hexes).enter().append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => fishingColor(d.properties.fishingPotential))
    .style('fill-opacity', 0.7).style('pointer-events', 'none');

// ★★★ 新規：人口レイヤーの描画 ★★★
populationOverlayLayer.selectAll('.population-hex')
    .data(hexes.filter(d => d.properties.population > 0))
    .enter().append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .attr('fill', d => populationColor(d.properties.population))
    .style('fill-opacity', 0.7)
    .style('pointer-events', 'none');

// 3g. ラベルレイヤー
const hexLabelGroups = labelLayer.selectAll('.hex-label-group')
    .data(hexes).enter().append('g')
    .attr('class', 'hex-label-group');

// ツールチップ
// ★★★ 変更点：ツールチップに農地面積を追加 ★★★
hexLabelGroups.append('polygon')
    .attr('points', d => d.points.map(p => p.join(',')).join(' '))
    .style('fill', 'transparent')
    .append('title')
    .text(d => {
        let text = `座標　　：E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
               `土地利用：${d.properties.vegetation}${d.properties.isAlluvial ? ' (河川)' : ''}${d.properties.hasSnow ? ' (積雪)' : ''}\n` +
               `人口　　：${d.properties.population.toLocaleString()}人\n` +
               `農地面積：${Math.round(d.properties.cultivatedArea).toLocaleString()} ha\n` + // ★★★ 変更点 ★★★
               `居住適性：${d.properties.habitability.toFixed(1)}\n` +
               `--- 土地詳細 ---\n` +
               `気候帯　：${d.properties.climateZone}\n` +
               `標高　　：${Math.round(d.properties.elevation)}m\n` +
               `気温　　：${d.properties.temperature.toFixed(1)}℃\n` +
               `降水量　：${(d.properties.precipitation * 100).toFixed(0)}%\n` +
               `魔力　　：${d.properties.manaRank}\n` +
               `資源　　：${d.properties.resourceRank}\n` +
               `--- 資源ポテンシャル ---\n` +
               `農業適正：${(d.properties.agriPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
               `林業適正：${(d.properties.forestPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
               `鉱業適正：${(d.properties.miningPotential * 100).toFixed(0).padStart(3, ' ')}%\n` +
               `漁業適正：${(d.properties.fishingPotential * 100).toFixed(0).padStart(3, ' ')}%`;
        
        const surplusKeys = Object.keys(d.properties.surplus || {});
        const shortageKeys = Object.keys(d.properties.shortage || {});

        if (surplusKeys.length > 0 || shortageKeys.length > 0) {
            text += `\n--- 食料需給 (t/年) ---`;
            if (surplusKeys.length > 0) {
                let surplusText = surplusKeys.map(key => `${key} ${d.properties.surplus[key]}`).join('t\n　　　　　');
                text += `\n余剰　　：${surplusText}t`;
            }
            if (shortageKeys.length > 0) {
                let shortageText = shortageKeys.map(key => `${key} ${d.properties.shortage[key]}`).join('t\n　　　　　');
                text += `\n不足　　：${shortageText}t`;
            }
        }
        return text;
    });
             
// 座標ラベル
hexLabelGroups.append('text').attr('class', 'hex-label')
    .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .style('font-size', `${r / 4}px`)
    .style('display', 'none')
    .text(d => `${String(d.x).padStart(2, '0')}${String(d.y).padStart(2, '0')}`);

// 居住区ラベル
hexLabelGroups.filter(d => d.properties.settlement).append('text').attr('class', 'settlement-label')
    .attr('x', d => d.cx).attr('y', d => d.cy)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .style('font-size', `${r / 1.5}px`)
    .text(d => d.properties.settlement);

// 魔力ラベル
hexLabelGroups.append('text').attr('class', 'property-label')
    .attr('x', d => d.cx - r * 0.7).attr('y', d => d.cy)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .style('font-size', `${r / 4}px`)
    .style('display', 'none')
    .text(d => d.properties.manaRank);

// 資源ラベル
hexLabelGroups.append('text').attr('class', 'property-label')
    .attr('x', d => d.cx + r * 0.7).attr('y', d => d.cy)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .style('font-size', `${r / 4}px`)
    .style('display', 'none')
    .text(d => d.properties.resourceRank);

// --- 4. ZoomとUIイベントハンドラ ---
const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
    g.attr('transform', event.transform);
    const effectiveRadius = r * event.transform.k;
    
    labelLayer.selectAll('.hex-label, .property-label')
        .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
});
svg.call(zoom);

// 汎用的なレイヤー切り替え関数
function toggleLayerVisibility(layerName, buttonElement, showText, hideText) {
    const layer = layers[layerName];
    layer.visible = !layer.visible;
    layer.group.style('display', layer.visible ? 'inline' : 'none');
    buttonElement.textContent = layer.visible ? hideText : showText;
}

// 各ボタンにイベントを割り当て
d3.select('#toggleManaOverlay').on('click', function() {
    toggleLayerVisibility('mana-overlay', this, '龍脈表示', '龍脈非表示');
});
d3.select('#toggleClimateZoneOverlay').on('click', function() {
    toggleLayerVisibility('climate-zone-overlay', this, '気候帯表示', '気候帯非表示');
});
d3.select('#togglePrecipOverlay').on('click', function() {
    toggleLayerVisibility('precip-overlay', this, '降水量表示', '降水量非表示');
});
d3.select('#toggleTempOverlay').on('click', function() {
    toggleLayerVisibility('temp-overlay', this, '気温表示', '気温非表示');
});
d3.select('#toggleElevationOverlay').on('click', function() {
    toggleLayerVisibility('elevation-overlay', this, '土地利用消去', '土地利用表示');
});
// ★★★ 新規：産業ポテンシャルボタンのイベントハンドラを追加 ★★★
d3.select('#toggleAgriOverlay').on('click', function() {
    toggleLayerVisibility('agri-overlay', this, '農業', '農業');
});
d3.select('#toggleForestOverlay').on('click', function() {
    toggleLayerVisibility('forest-overlay', this, '林業', '林業');
});
d3.select('#toggleMiningOverlay').on('click', function() {
    toggleLayerVisibility('mining-overlay', this, '鉱業', '鉱業');
});
d3.select('#toggleFishingOverlay').on('click', function() {
    toggleLayerVisibility('fishing-overlay', this, '漁業', '漁業');
});
// ★★★ 新規：人口ボタンのイベントハンドラを追加 ★★★
d3.select('#togglePopulationOverlay').on('click', function() {
  toggleLayerVisibility('population-overlay', this, '人口', '人口');
});

// --- 5. 初期表示位置の設定 ---
const targetX = 50;
const targetY = 43;
const svgWidth = svg.node().getBoundingClientRect().width;
const svgHeight = svg.node().getBoundingClientRect().height;
const targetHex = hexes.find(h => h.x === targetX && h.y === targetY);
if (targetHex) {
    const initialScale = 1.0;
    const translateX = svgWidth / 2 - targetHex.cx * initialScale;
    const translateY = svgHeight / 2 - targetHex.cy * initialScale;
    const initialTransform = d3.zoomIdentity.translate(translateX, translateY).scale(initialScale);
    svg.call(zoom.transform, initialTransform);
}

// ★★★ 最後にローディング画面を非表示にする ★★★
    await sleep(500); // 最後のメッセージを読む時間を少し確保
    loadingOverlay.style.opacity = '0';
    populationDisplay.textContent = `総人口: ${totalPopulation.toLocaleString()}人`;
    populationDisplay.style.display = 'block';
    uiContainer.style.display = 'block';

    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500);
}

// ★★★ 非同期関数を実行してワールド生成を開始 ★★★
runWorldGeneration();