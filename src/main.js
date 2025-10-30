import * as d3 from 'd3';
import { createNoise2D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

// ================================================================
// GeoForge System 設定
// (このセクションに変更はありません)
// ================================================================
const COLS = 100;
const ROWS = 100;
const HEX_SIZE_KM = 20;
const r = 20; // 描画上の初期半径

const noise2D = createNoise2D(); 
const NOISE_SCALE = 0.05; 
const LAND_BIAS = 1.0; 
const CONTINENT_FALLOFF_FACTOR = 2; 
const INLAND_SEA_THRESHOLD = -0.88; 

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

// ================================================================
// 地図生成ロジック
// (このセクションに変更はありません)
// ================================================================
const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

function generateTerrain(col, row) {
  const nx = col * NOISE_SCALE;
  const ny = row * NOISE_SCALE;
  const baseElevation = noise2D(nx, ny);

  const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2));
  const falloff = Math.pow(distFromCenter / maxDist, CONTINENT_FALLOFF_FACTOR);
  const continentElevation = baseElevation + LAND_BIAS - falloff;

  const inlandWaterNoise = noise2D(nx + 100, ny + 100);
  let terrain;

  if (inlandWaterNoise < INLAND_SEA_THRESHOLD && continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) return 'LAKE';
  
  if (continentElevation < ELEVATION_THRESHOLDS.DEEP_OCEAN) terrain = 'DEEP_OCEAN';
  else if (continentElevation < ELEVATION_THRESHOLDS.OCEAN) terrain = 'OCEAN';
  else if (continentElevation < ELEVATION_THRESHOLDS.PLAINS) terrain = 'PLAINS';
  else if (continentElevation < ELEVATION_THRESHOLDS.HILLS) terrain = 'HILLS';
  else if (continentElevation < ELEVATION_THRESHOLDS.MOUNTAINS) terrain = 'MOUNTAINS';
  else terrain = 'PEAKS';
  
  const latitude = row / ROWS;
  if (latitude < SNOW_LINE_NORTH) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') terrain = 'TUNDRA';
    else if (terrain === 'MOUNTAINS' || terrain === 'PEAKS') terrain = 'SNOW_MOUNTAIN';
  } else if (latitude > DESERT_LATITUDE && latitude < (1 - DESERT_LATITUDE)) {
    if (terrain === 'PLAINS' || terrain === 'HILLS') {
        const desertNoise = noise2D(nx + 200, ny + 200);
        if (desertNoise > 0.3) terrain = 'DESERT';
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
      x: col, y: (ROWS - 1) - row, cx: cx, cy: cy,
      points: hexPoints(cx, cy), terrain: generateTerrain(col, row),
    });
  }
}

// ★★★ 変更点：ポリゴンとテキストをグループ化して描画します ★★★
const hexGroups = g.selectAll('.hex-group')
  .data(hexes)
  .enter()
  .append('g')
  .attr('class', 'hex-group');

// ヘックス本体（ポリゴン）の描画
hexGroups.append('polygon')
  .attr('class', 'hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => TERRAIN_COLORS_SLG[d.terrain])
  .append('title')
  .text(d => `E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n${d.terrain}`);

// 座標ラベル（テキスト）の描画
hexGroups.append('text')
  .attr('class', 'hex-label')
  .attr('x', d => d.cx)
  .attr('y', d => d.cy + hexHeight * 0.4) // ヘックスの下部に配置
  .attr('text-anchor', 'middle')
  .attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`) // フォントサイズをヘックスのサイズに連動させる
  .style('display', 'none') // 初期状態では非表示
  .text(d => `${String(d.x).padStart(2, '0')}-${String(d.y).padStart(2, '0')}`);


// ★★★ 変更点：zoomイベントハンドラを修正します ★★★
const zoom = d3.zoom()
  .scaleExtent([0.2, 10])
  .on('zoom', (event) => {
    // グループ全体を移動・拡縮
    g.attr('transform', event.transform);

    // 現在のズーム倍率を取得
    const currentScale = event.transform.k;
    // ズーム後の実質的なヘックスの半径を計算
    const effectiveRadius = r * currentScale;

    // 半径が50px以上ならラベルを表示、未満なら非表示
    g.selectAll('.hex-label')
      .style('display', effectiveRadius >= 50 ? 'inline' : 'none');
  });

svg.call(zoom);