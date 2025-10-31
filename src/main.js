import * as d3 from 'd3';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

// ================================================================
// GeoForge System 設定
// ================================================================

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

// ----------------------------------------------------------------
// ■ 地形生成パラメータ
//    - 大陸の形状や険しさをコントロールする
// ----------------------------------------------------------------
const NOISE_SCALE = 0.06; 
const LAND_BIAS =   0.8; 
const ELEVATION_PEAK_FACTOR =    4.0; 
const CONTINENT_FALLOFF_FACTOR = 4.0;
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
    // 積雪地形（上書き用）
    // 積雪ツンドラ: '#eef',
    // 積雪地: '#dde',
    // 深雪地: '#fff',
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
const elevationOverlayColor = d3.scaleSequential(d3.interpolateTurbo).domain([0, 7000]);


// ================================================================
// データ生成ロジック
// ================================================================
const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

/**
 * 座標(col, row)に基づいて、そのヘックスの全プロパティを生成する関数
 * @param {number} col - 列番号
 * @param {number} row - 行番号
 * @returns {object} { properties } - そのヘックスの全プロパティを含むオブジェクト
 */
function generateHexData(col, row) {
  const nx = col * NOISE_SCALE;
  const ny = row * NOISE_SCALE;
  
  // --- 1. 標高の計算 ---
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
  
  // --- 2. 気候・降水量の計算 ---
  const latitude = row / ROWS;
  const baseTemp = -5 + (latitude * 35);
  properties.climate = baseTemp + climateNoise(nx, ny) * 5; // 基準気候
  
  let elevationCorrection = 0;
  if (properties.elevation > 0) {
      elevationCorrection = (properties.elevation / 100) * 0.6;
  }
  properties.temperature = properties.climate - elevationCorrection; // 実効気温

  const basePrecip = (col / COLS);
  const precipNoiseValue = precipitationNoise(nx, ny) * 0.2;
  properties.precipitation = Math.max(0, Math.min(1, basePrecip + precipNoiseValue));
  
  // --- 3. 気候帯の決定 ---
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

  // --- 4. 植生の決定 ---
  // 1. まず、ポテンシャルモデルに基づいて「基本となる植生」を決定
  if (isWater) {
      if (internalElevation < -0.4) properties.vegetation = '深海';
      else if (internalElevation < 0.0) properties.vegetation = '海洋';
      else properties.vegetation = '湖沼';
  } else if (properties.elevation > VEGETATION_THRESHOLDS.ALPINE_ELEVATION) {
      properties.vegetation = '高山';
  } else if (properties.temperature < VEGETATION_THRESHOLDS.TUNDRA_TEMP) {
      properties.vegetation = '荒れ地';
  } else if (properties.precipitation < VEGETATION_THRESHOLDS.DESERT_PRECIP) {
      properties.vegetation = '砂漠';
  } else {
      // (ポテンシャルモデルのロジックは前回から変更なし)
      const totalCoverage = (1 + vegetationCoverageNoise(nx, ny)) / 2;
      const potentials = {
          '密林':     (1 + junglePotentialNoise(nx * 0.5, ny * 0.5)) / 2,
          '森林':     (1 + forestPotentialNoise(nx, ny)) / 2,
          '疎林':     (1 + forestPotentialNoise(nx, ny)) / 2,
          '針葉樹林': (1 + taigaPotentialNoise(nx * 2, ny * 2)) / 2,
          '草原':     (1 + grasslandPotentialNoise(nx, ny)) / 2,
          '荒れ地':   0.1,
      };
      
      const candidates = [];
      if (properties.climate > TEMP_ZONES.TEMPERATE) {
          if (properties.precipitation > VEGETATION_THRESHOLDS.JUNGLE_MIN_PRECIP) candidates.push('密林');
          candidates.push('草原');
      } else if (properties.climate > TEMP_ZONES.COLD) {
          if (properties.precipitation > VEGETATION_THRESHOLDS.FOREST_MIN_PRECIP) candidates.push('森林');
          if (properties.precipitation > VEGETATION_THRESHOLDS.SPARSE_MIN_PRECIP) candidates.push('疎林');
          candidates.push('草原');
      } else {
          if (properties.precipitation > VEGETATION_THRESHOLDS.TAIGA_MIN_PRECIP) candidates.push('針葉樹林');
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
      proportions.forEach(p => {
          if (p.percentage > dominantVeg.percentage) { dominantVeg = p; }
      });
      
      properties.vegetation = (dominantVeg.type === '裸地') ? '標高ベース' : dominantVeg.type;
  }
  
  // 2. 次に、植生とは独立して「積雪しているか」を判定し、フラグを立てる
  properties.hasSnow = false;
  if (!isWater && properties.temperature <= SNOW_THRESHOLDS.TEMPERATURE && properties.precipitation > SNOW_THRESHOLDS.PRECIPITATION_LIGHT) {
      properties.hasSnow = true;
  }

  // --- 5. その他のプロパティ生成 ---
  const rawManaValue = manaNoise(nx / 2, ny / 2);
  properties.manaValue = Math.pow(1.0 - Math.abs(rawManaValue), 8);
  if (properties.manaValue > 0.9) properties.manaRank = 'S';
  else if (properties.manaValue > 0.7) properties.manaRank = 'A';
  else if (properties.manaValue > 0.4) properties.manaRank = 'B';
  else if (properties.manaValue > 0.1) properties.manaRank = 'C';
  else properties.manaRank = 'D';

  const resourceSymbols = ['木', '石', '鉄', '金', '晶'];
  properties.resourceRank = resourceSymbols[Math.floor(Math.random() * resourceSymbols.length)];
  
  if (!isWater && properties.vegetation !== '高山') {
      const rand = Math.random();
      if (rand > 0.999) properties.settlement = '都';
      else if (rand > 0.99) properties.settlement = '街';
      else if (rand > 0.97) properties.settlement = '町';
      else if (rand > 0.9) properties.settlement = '村';
  }

  return { properties };
}


// ================================================================
// D3.jsによる描画
// ================================================================
const svg = d3.select('#hexmap');
const g = svg.append('g');

// --- 1. ヘックスデータの事前計算 ---
const hexes = [];
const hexWidth = 2 * r;
const hexHeight = Math.sqrt(3) * r;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
    const cx = col * (hexWidth * 3 / 4) + r;
    const cy = row * hexHeight + offsetY + r;
    const { properties } = generateHexData(col, row);

    hexes.push({
      x: col, y: (ROWS - 1) - row, cx: cx, cy: cy,
      points: d3.range(6).map(i => [cx + r * Math.cos(Math.PI / 3 * i), cy + r * Math.sin(Math.PI / 3 * i)]),
      properties: properties,
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
const precipOverlayLayer = createLayer('precip-overlay', false);
const tempOverlayLayer = createLayer('temp-overlay', false);
const climateZoneOverlayLayer = createLayer('climate-zone-overlay', false);
const manaOverlayLayer = createLayer('mana-overlay', false);
const labelLayer = createLayer('labels');

// --- 3. 各レイヤーの描画 ---
// 1. 地形レイヤー (積雪のロジックを削除)
terrainLayer.selectAll('.hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => {
      const veg = d.properties.vegetation;
      if (TERRAIN_COLORS[veg]) {
          return TERRAIN_COLORS[veg];
      }
      return getElevationColor(d.properties.elevation);
  });

// ★★★ 新規：積雪レイヤーの描画 ★★★
snowLayer.selectAll('.snow-hex')
  // hasSnowがtrueのヘックスのみをフィルタリング
  .data(hexes.filter(d => d.properties.hasSnow))
  .enter().append('polygon')
  .attr('class', 'snow-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', '#ffffff') // 雪の色
  .style('fill-opacity', 0.7) // 半透明にして下の地形がうっすら見えるように
  .style('pointer-events', 'none'); // マウスイベントを透過させる

// 3f. 標高オーバーレイ (植生なしの標高グラデーション)
elevationOverlayLayer.selectAll('.elevation-hex')
  .data(hexes.filter(d => !d.properties.isWater))
  .enter().append('polygon')
  .attr('class', 'elevation-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => getElevationColor(d.properties.elevation))
  .style('fill-opacity', 0.8) // 少し不透明度を上げて見やすく
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

// 3g. ラベルレイヤー
const hexLabelGroups = labelLayer.selectAll('.hex-label-group')
  .data(hexes).enter().append('g')
  .attr('class', 'hex-label-group');

// ツールチップ
hexLabelGroups.append('polygon')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .style('fill', 'transparent')
  .append('title')
  .text(d => 
    `E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
    // 積雪している場合は、植生名に（積雪）を追記
    `Vegetation: ${d.properties.vegetation}${d.properties.hasSnow ? ' (積雪)' : ''}\n` +
    `Climate Zone: ${d.properties.climateZone}\n` +
    `Elevation: ${Math.round(d.properties.elevation)}m\n` +
    `Temp: ${d.properties.temperature.toFixed(1)}℃\n` +
    `Precipitation: ${(d.properties.precipitation * 100).toFixed(0)}%\n` +
    `Mana: ${d.properties.manaRank} (${d.properties.manaValue.toFixed(2)})\n` +
    `Resource: ${d.properties.resourceRank}`
  );
             
// 座標ラベル
hexLabelGroups.append('text').attr('class', 'hex-label')
  .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => `${String(d.x).padStart(2, '0')}-${String(d.y).padStart(2, '0')}`);

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
      .style('display', effectiveRadius >= 70 ? 'inline' : 'none');
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

// --- 5. 初期表示位置の設定 ---
const targetX = 50;
const targetY = 43;
const svgWidth = svg.node().getBoundingClientRect().width;
const svgHeight = svg.node().getBoundingClientRect().height;
const targetHex = hexes.find(h => h.x === targetX && h.y === targetY);
if (targetHex) {
  const initialScale = 1.5;
  const translateX = svgWidth / 2 - targetHex.cx * initialScale;
  const translateY = svgHeight / 2 - targetHex.cy * initialScale;
  const initialTransform = d3.zoomIdentity.translate(translateX, translateY).scale(initialScale);
  svg.call(zoom.transform, initialTransform);
}