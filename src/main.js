import * as d3 from 'd3';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

// ================================================================
// GeoForge System 設定
// ================================================================

// --- 地図全体の規模 ---
const COLS = 100;
const ROWS = 100;

// --- ヘックスのサイズ ---
const HEX_SIZE_KM = 30;
const r = 20;

// --- 地形生成パラメータ ---
const noise2D = createNoise2D(); 
// ノイズを少し粗くして、地形の起伏を大陸スケールにします
const NOISE_SCALE = 0.03; 

// ★★★ 変更点：陸地を広げるための強力なバイアス ★★★
const LAND_BIAS = 0.5; // 全体の標高を底上げします（値を大きくすると陸地が増えます）

// ★★★ 変更点：海を端に追いやる設定 ★★★
// 数値を大きくするほど、中央部の標高が下がりにくくなり、海が端だけに限定されます
const CONTINENT_FALLOFF_FACTOR = 100.0; 

// 内海・湖の閾値
const INLAND_SEA_THRESHOLD = -100.0; 

// 標高のしきい値
const ELEVATION_THRESHOLDS = {
    DEEP_OCEAN: -0.3,
    OCEAN: -0.1,
    PLAINS: 0.2,  // 少し調整：平地を広げやすく
    HILLS: 0.8,
    MOUNTAINS: 1.1, // 少し調整：山脈を少しレアに
    PEAKS: 10.0, 
};

// 北緯の寒冷地設定
const SNOW_LINE_NORTH = 0.15; // 北側の15%を完全な寒冷地とする
const DESERT_LATITUDE = 0.4;

// SLG風カラーパレット
const TERRAIN_COLORS_SLG = {
    DEEP_OCEAN:    '#136',
    OCEAN:         '#248',
    LAKE:          '#42a5f5',
    PLAINS:        '#9a8',
    HILLS:         '#465',
    MOUNTAINS:     '#987',
    PEAKS:         '#abb',
    DESERT:        '#ddb',
    TUNDRA:        '#dee',
    SNOW_MOUNTAIN: '#fff',
};

// ================================================================
// 地図生成ロジック
// ================================================================

const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

function generateTerrain(col, row) {
  const nx = col * NOISE_SCALE;
  const ny = row * NOISE_SCALE;
  const baseElevation = noise2D(nx, ny);

  // --- 大陸形成ロジック ---
  const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2));
  // マップの端の方だけ急激に標高を下げるカーブを作ります
  const falloff = Math.pow(distFromCenter / maxDist, CONTINENT_FALLOFF_FACTOR);
  
  // ★★★ 変更点：ベース標高にバイアスを加え、全体を陸地化します
  const continentElevation = baseElevation + LAND_BIAS - falloff;

  // --- 内海・湖判定 ---
  const inlandWaterNoise = noise2D(nx + 100, ny + 100);
  let terrain;

  if (inlandWaterNoise < INLAND_SEA_THRESHOLD && continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) {
    return 'LAKE';
  }

  // --- 基本地形判定 ---
  if (continentElevation < ELEVATION_THRESHOLDS.DEEP_OCEAN) terrain = 'DEEP_OCEAN';
  else if (continentElevation < ELEVATION_THRESHOLDS.OCEAN) terrain = 'OCEAN';
  else if (continentElevation < ELEVATION_THRESHOLDS.PLAINS) terrain = 'PLAINS';
  else if (continentElevation < ELEVATION_THRESHOLDS.HILLS) terrain = 'HILLS';
  else if (continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) terrain = 'MOUNTAINS';
  else terrain = 'PEAKS';
  
  // --- 気候判定 ---
  const latitude = row / ROWS; // 0.0(北) -> 1.0(南)

  // 北部寒冷地帯
  if (latitude < SNOW_LINE_NORTH) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') {
      terrain = 'TUNDRA';
    } else if (terrain === 'MOUNTAINS' || terrain === 'PEAKS') {
      terrain = 'SNOW_MOUNTAIN';
    }
  }
  // 乾燥地帯
  else if (latitude > DESERT_LATITUDE && latitude < (1 - DESERT_LATITUDE)) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') {
        const desertNoise = noise2D(nx + 200, ny + 200);
        if (desertNoise > 0.3) {
            terrain = 'DESERT';
        }
    }
  }

  return terrain;
}

// ================================================================
// D3.jsによる描画
// ================================================================

const svg = d3.select('#hexmap');
const g = svg.append('g');

function hexPoints(cx, cy) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push([x, y]);
  }
  return points;
}

const hexes = [];
const hexWidth = 2 * r;
const hexHeight = Math.sqrt(3) * r;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const offsetY = (col % 2 === 0) ? 0 : hexHeight / 2;
    const cx = col * (hexWidth * 3 / 4) + r;
    const cy = row * hexHeight + offsetY + r;

    hexes.push({
      x: col,
      // 北(画面上部)ほど値が大きくなるN座標
      y: (ROWS - 1) - row,
      cx: cx,
      cy: cy,
      points: hexPoints(cx, cy),
      terrain: generateTerrain(col, row),
    });
  }
}

g.selectAll('.hex')
  .data(hexes)
  .enter()
  .append('polygon')
  .attr('class', 'hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => TERRAIN_COLORS_SLG[d.terrain])
  .append('title')
  .text(d => `(X: ${d.x}, N: ${d.y})\nTerrain: ${d.terrain}`);

const zoom = d3.zoom()
  .scaleExtent([0.2, 10])
  .on('zoom', (event) => {
    g.attr('transform', event.transform);
  });

svg.call(zoom);