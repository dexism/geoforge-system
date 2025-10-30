import * as d3 from 'd3';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

// ================================================================
// GeoForge System 設定
// ================================================================
const COLS = 100;
const ROWS = 100;
const HEX_SIZE_KM = 20;
const r = 20;

const terrainNoise = createNoise2D();
const manaNoise = createNoise2D(); // ★★★ 魔力用のNoiseを追加
const NOISE_SCALE = 0.05;
const LAND_BIAS = 1.0;
const CONTINENT_FALLOFF_FACTOR = 2;
const INLAND_SEA_THRESHOLD = -0.9;

const ELEVATION_THRESHOLDS = {
    DEEP_OCEAN: -0.4, OCEAN: 0.0, PLAINS: 0.3,
    HILLS: 0.8, MOUNTAINS: 1.3, PEAKS: 2.0, 
};

const SNOW_LINE_NORTH = 0.15;
const DESERT_LATITUDE = 0.4;

const TERRAIN_COLORS_SLG = {
    DEEP_OCEAN: '#136', OCEAN: '#248', LAKE: '#358',
    PLAINS: '#9a8', HILLS: '#465', MOUNTAINS: '#987',
    PEAKS: '#abb', DESERT: '#ddb', TUNDRA: '#dee',
    SNOW_MOUNTAIN: '#fff',
};

// ★★★ 魔力オーバーレイ用のカラーマッピング ★★★
// 0(低)から1(高)の値を紫系の色に変換
const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]);


// ================================================================
// データ生成ロジック (プロパティ追加)
// ================================================================
const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

function generateHexData(col, row) {
  const nx = col * NOISE_SCALE;
  const ny = row * NOISE_SCALE;
  
  // --- 地形生成 ---
  const baseElevation = terrainNoise(nx, ny);
  const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2));
  const falloff = Math.pow(distFromCenter / maxDist, CONTINENT_FALLOFF_FACTOR);
  const continentElevation = baseElevation + LAND_BIAS - falloff;

  let terrain;
  const inlandWaterNoise = terrainNoise(nx + 100, ny + 100);
  if (inlandWaterNoise < INLAND_SEA_THRESHOLD && continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) {
    terrain = 'LAKE';
  } else {
    if (continentElevation < ELEVATION_THRESHOLDS.DEEP_OCEAN) terrain = 'DEEP_OCEAN';
    else if (continentElevation < ELEVATION_THRESHOLDS.OCEAN) terrain = 'OCEAN';
    else if (continentElevation < ELEVATION_THRESHOLDS.PLAINS) terrain = 'PLAINS';
    else if (continentElevation < ELEVATION_THRESHOLDS.HILLS) terrain = 'HILLS';
    else if (continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) terrain = 'MOUNTAINS';
    else terrain = 'PEAKS';
  }
  
  const latitude = row / ROWS;
  if (latitude < SNOW_LINE_NORTH) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') terrain = 'TUNDRA';
    else if (terrain === 'MOUNTAINS' || terrain === 'PEAKS') terrain = 'SNOW_MOUNTAIN';
  } else if (latitude > DESERT_LATITUDE && latitude < (1 - DESERT_LATITUDE)) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') {
        const desertNoise = terrainNoise(nx + 200, ny + 200);
        if (desertNoise > 0.3) terrain = 'DESERT';
    }
  }

  // ★★★ 魔力・資源・居住区などのプロパティを生成 ★★★
  const properties = {};
  
  // 魔力値の生成 (0-1の範囲)
  // absとpowで加工し、値が0に近い場所を線状のピーク(地脈)にする
  const rawManaValue = manaNoise(nx / 2, ny / 2); // 地形より細かいパターンにする
  properties.manaValue = Math.pow(1.0 - Math.abs(rawManaValue), 8);
  
  // 魔力量ランク (S,A,B,C,D)
  if (properties.manaValue > 0.9) properties.manaRank = 'S';
  else if (properties.manaValue > 0.7) properties.manaRank = 'A';
  else if (properties.manaValue > 0.4) properties.manaRank = 'B';
  else if (properties.manaValue > 0.1) properties.manaRank = 'C';
  else properties.manaRank = 'D';

  // 資源量ランク (仮でランダム生成)
  const resourceSymbols = ['木', '石', '鉄', '金', '晶'];
  properties.resourceRank = resourceSymbols[Math.floor(Math.random() * resourceSymbols.length)];
  
  // 居住区の生成 (仮でランダム生成、陸地のみ)
  if (!['OCEAN', 'DEEP_OCEAN', 'LAKE'].includes(terrain)) {
      const rand = Math.random();
      if (rand > 0.999) properties.settlement = '都';
      else if (rand > 0.99) properties.settlement = '街';
      else if (rand > 0.97) properties.settlement = '町';
      else if (rand > 0.9) properties.settlement = '村';
  }

  return { terrain, properties };
}

// ================================================================
// D3.jsによる描画
// ================================================================
const svg = d3.select('#hexmap');
const g = svg.append('g');

const hexes = [];
const hexWidth = 2 * r;
const hexHeight = Math.sqrt(3) * r;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
    const cx = col * (hexWidth * 3 / 4) + r;
    const cy = row * hexHeight + offsetY + r;
    const { terrain, properties } = generateHexData(col, row);

    hexes.push({
      x: col, y: (ROWS - 1) - row, cx: cx, cy: cy,
      points: d3.range(6).map(i => [cx + r * Math.cos(Math.PI / 3 * i), cy + r * Math.sin(Math.PI / 3 * i)]),
      terrain: terrain,
      properties: properties,
    });
  }
}

// ★★★ レイヤー構造に変更 ★★★
// 1. 地形レイヤー
const terrainGroup = g.append('g').attr('class', 'terrain-layer');
// 2. 魔力オーバーレイレイヤー (初期は非表示)
const manaOverlayGroup = g.append('g').attr('class', 'mana-overlay-layer').style('display', 'none');
// 3. ラベルレイヤー
const labelGroup = g.append('g').attr('class', 'label-layer');

// --- 1. 地形レイヤーの描画 ---
terrainGroup.selectAll('.hex')
  .data(hexes)
  .enter().append('polygon')
  .attr('class', 'hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => TERRAIN_COLORS_SLG[d.terrain]);

// --- 2. 魔力オーバーレイレイヤーの描画 ---
manaOverlayGroup.selectAll('.mana-hex')
  .data(hexes)
  .enter().append('polygon')
  .attr('class', 'mana-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => manaColor(d.properties.manaValue))
  .style('fill-opacity', 0.6)
  .style('pointer-events', 'none'); // マウスイベントを透過させる

// --- 3. ラベルレイヤーの描画 (グループ化) ---
const hexLabelGroups = labelGroup.selectAll('.hex-label-group')
  .data(hexes)
  .enter().append('g')
  .attr('class', 'hex-label-group')
  // .style('display', 'none'); // グループ全体を初期非表示

// ツールチップ用タイトル (透明な領域)
hexLabelGroups.append('polygon')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .style('fill', 'transparent')
  .append('title')
  .text(d => `E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
             `Terrain: ${d.terrain}\n` +
             `Mana: ${d.properties.manaRank} (${d.properties.manaValue.toFixed(2)})\n` +
             `Resource: ${d.properties.resourceRank}`);
             
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

// 魔力量ラベル
hexLabelGroups.append('text').attr('class', 'property-label')
  .attr('x', d => d.cx - r * 0.7).attr('y', d => d.cy)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => d.properties.manaRank);

// 資源量ラベル
hexLabelGroups.append('text').attr('class', 'property-label')
  .attr('x', d => d.cx + r * 0.7).attr('y', d => d.cy)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => d.properties.resourceRank);

// --- Zoomイベントハンドラ ---
const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
    g.attr('transform', event.transform);
    const effectiveRadius = r * event.transform.k;
    
    // 居住区以外のラベル（座標、魔力、資源）の表示/非表示を切り替える
    labelGroup.selectAll('.hex-label, .property-label')
      .style('display', effectiveRadius >= 70 ? 'inline' : 'none');
  });
svg.call(zoom);

// --- UIイベントハンドラ ---
d3.select('#toggleManaOverlay').on('click', function() {
  const overlay = manaOverlayGroup;
  const isHidden = overlay.style('display') === 'none';
  overlay.style('display', isHidden ? 'inline' : 'none');
  this.textContent = isHidden ? '龍脈非表示' : '龍脈表示';
});