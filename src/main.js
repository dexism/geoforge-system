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
const manaNoise = createNoise2D();
const climateNoise = createNoise2D();

const NOISE_SCALE = 0.06; 
const LAND_BIAS =   0.8; 
const ELEVATION_PEAK_FACTOR =    5.0; 
const CONTINENT_FALLOFF_FACTOR = 4.0;

const LAKE_THRESHOLD_PLAINS =    -0.95;
const LAKE_THRESHOLD_MOUNTAINS = -0.9;

const elevationScale = d3.scaleLinear().domain([0.0, 1.6]).range([0, 7000]).clamp(true);

const lakeThresholdScale = d3.scaleLinear()
    .domain([0.3, 1.3])
    .range([LAKE_THRESHOLD_PLAINS, LAKE_THRESHOLD_MOUNTAINS])
    .clamp(true);

const ELEVATION_THRESHOLDS_METERS = {
    PLAINS:     500,
    HILLS:     1000,
    HIGHLANDS: 2000,
    MOUNTAINS: 3000,
    PEAKS:     4000,
};

const SNOW_TRANSITION_LATITUDE = 0.1; 
const DESERT_LATITUDE_START = 0.5;
const DESERT_LATITUDE_END =   0.6;

const TERRAIN_COLORS_SLG = {
    DEEP_OCEAN: '#136', OCEAN:      '#248', LAKE:       '#058',
    PLAINS:    '#ab7', HILLS:     '#897', HIGHLANDS: '#9a9',
    MOUNTAINS: '#997', PEAKS:     '#666', DESERT:    '#edb',
    TUNDRA:              '#fff', SNOWY_HILLS:         '#eee',
    DEEP_SNOW_HIGHLANDS: '#ddd', DEEP_SNOW_MOUNTAINS: '#ccc',
    DEEP_SNOW_PEAKS:     '#fff',
};

// ★★★ 変更点：気候帯の定義を追加 ★★★
// 気候帯を分ける温度の境界値
const CLIMATE_ZONE_THRESHOLDS = {
    COLD: 0,      // 0℃未満は「寒冷」
    TEMPERATE: 20 // 20℃未満は「温帯」、それ以上は「熱帯」
};
// 気候帯ごとの色
const CLIMATE_ZONE_COLORS = {
    COLD: '#aed6f1',      // 寒冷 (水色)
    TEMPERATE: '#a9dfbf', // 温帯 (緑色)
    TROPICAL: '#f9e79f'   // 熱帯 (黄色)
};

// カラーマッピング
const manaColor = d3.scaleSequential(d3.interpolatePurples).domain([0, 1]);
// 気温表示(temp-overlay)は従来通り連続的な色を使用
const tempColor = d3.scaleSequential(d3.interpolateTurbo).domain([-15, 35]);
const elevationColor = d3.scaleSequential(d3.interpolateCividis).domain([0, 7000]);


// ================================================================
// データ生成ロジック
// ================================================================
const centerX = COLS / 2;
const centerY = ROWS / 2;
const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

function generateHexData(col, row) {
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
  properties.elevation = isWater ? 0 : elevationScale(internalElevation);
  
  let terrain;
  if (isWater) {
      if (internalElevation < -0.4) terrain = 'DEEP_OCEAN';
      else if (internalElevation < 0.0) terrain = 'OCEAN';
      else terrain = 'LAKE';
  } else {
      if (properties.elevation >= ELEVATION_THRESHOLDS_METERS.PEAKS) terrain = 'PEAKS';
      else if (properties.elevation >= ELEVATION_THRESHOLDS_METERS.MOUNTAINS) terrain = 'MOUNTAINS';
      else if (properties.elevation >= ELEVATION_THRESHOLDS_METERS.HIGHLANDS) terrain = 'HIGHLANDS';
      else if (properties.elevation >= ELEVATION_THRESHOLDS_METERS.HILLS) terrain = 'HILLS';
      else terrain = 'PLAINS';
  }

  const latitude = row / ROWS;

  // 1. 基準気候（標高補正前）
  const baseTemp = -5 + (latitude * 35);
  properties.climate = baseTemp + climateNoise(nx, ny) * 5;

  // ★★★ 変更点：基準気候に基づいて気候帯名をプロパティとして保存 ★★★
  if (properties.climate < CLIMATE_ZONE_THRESHOLDS.COLD) {
      properties.climateZone = '寒冷';
  } else if (properties.climate < CLIMATE_ZONE_THRESHOLDS.TEMPERATE) {
      properties.climateZone = '温帯';
  } else {
      properties.climateZone = '熱帯';
  }

  // 2. 実効気温（標高補正後）
  let elevationCorrection = 0;
  if (properties.elevation > 0) {
      elevationCorrection = (properties.elevation / 100) * 0.6;
  }
  properties.temperature = properties.climate - elevationCorrection;

  // 実効気温に基づいて最終的な地形を決定
  if (properties.temperature <= -10) {
      switch(terrain) {
          case 'PLAINS':    terrain = 'TUNDRA'; break;
          case 'HILLS':     terrain = 'SNOWY_HILLS'; break;
          case 'HIGHLANDS': terrain = 'DEEP_SNOW_HIGHLANDS'; break;
          case 'MOUNTAINS': terrain = 'DEEP_SNOW_MOUNTAINS'; break;
          case 'PEAKS':     terrain = 'DEEP_SNOW_PEAKS'; break;
      }
  } 
  else if (latitude > DESERT_LATITUDE_START && latitude < DESERT_LATITUDE_END) {
      if (terrain === 'PLAINS' || terrain === 'HILLS') {
          const desertNoise = terrainNoise(nx + 200, ny + 200);
          if (desertNoise > 0.3) terrain = 'DESERT';
      }
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

const layers = {};
function createLayer(name, visibleByDefault = true) {
  const layerGroup = g.append('g').attr('class', `${name}-layer`);
  layers[name] = { group: layerGroup, visible: visibleByDefault };
  if (!visibleByDefault) {
    layerGroup.style('display', 'none');
  }
  return layerGroup;
}

const terrainLayer = createLayer('terrain');
const manaOverlayLayer = createLayer('mana-overlay', false);
const climateOverlayLayer = createLayer('climate-overlay', false);
const tempOverlayLayer = createLayer('temp-overlay', false);
const elevationOverlayLayer = createLayer('elevation-overlay', false);
const labelLayer = createLayer('labels');

terrainLayer.selectAll('.hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => TERRAIN_COLORS_SLG[d.terrain]);

manaOverlayLayer.selectAll('.mana-hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'mana-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => manaColor(d.properties.manaValue))
  .style('fill-opacity', 0.6)
  .style('pointer-events', 'none');

// ★★★ 変更点：気候帯(climateZone)の色を描画するレイヤー ★★★
climateOverlayLayer.selectAll('.climate-hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'climate-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => {
      switch(d.properties.climateZone) {
          case '寒冷': return CLIMATE_ZONE_COLORS.COLD;
          case '温帯': return CLIMATE_ZONE_COLORS.TEMPERATE;
          case '熱帯': return CLIMATE_ZONE_COLORS.TROPICAL;
      }
  })
  .style('fill-opacity', 0.6)
  .style('pointer-events', 'none');

// 実効気温(temperature)を描画するレイヤー (変更なし)
tempOverlayLayer.selectAll('.temp-hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'temp-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => tempColor(d.properties.temperature))
  .style('fill-opacity', 0.6)
  .style('pointer-events', 'none');

elevationOverlayLayer.selectAll('.elevation-hex')
  .data(hexes).enter().append('polygon')
  .attr('class', 'elevation-hex')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .attr('fill', d => elevationColor(d.properties.elevation))
  .style('fill-opacity', 0.6)
  .style('pointer-events', 'none');

const hexLabelGroups = labelLayer.selectAll('.hex-label-group')
  .data(hexes).enter().append('g')
  .attr('class', 'hex-label-group');

hexLabelGroups.append('polygon')
  .attr('points', d => d.points.map(p => p.join(',')).join(' '))
  .style('fill', 'transparent')
  .append('title')
  .text(d => 
    `E${String(d.x).padStart(2, '0')}-N${String(d.y).padStart(2, '0')}\n` +
    `Terrain: ${d.terrain}\n` +
    `Elevation: ${Math.round(d.properties.elevation)}m\n` +
    `Climate: ${d.properties.climateZone} (${d.properties.climate.toFixed(1)}℃)\n` +
    `Temp: ${d.properties.temperature.toFixed(1)}℃\n` +
    `Mana: ${d.properties.manaRank} (${d.properties.manaValue.toFixed(2)})\n` +
    `Resource: ${d.properties.resourceRank}`
  );
             
hexLabelGroups.append('text').attr('class', 'hex-label')
  .attr('x', d => d.cx).attr('y', d => d.cy + hexHeight * 0.4)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => `${String(d.x).padStart(2, '0')}-${String(d.y).padStart(2, '0')}`);

hexLabelGroups.filter(d => d.properties.settlement).append('text').attr('class', 'settlement-label')
  .attr('x', d => d.cx).attr('y', d => d.cy)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 1.5}px`)
  .text(d => d.properties.settlement);

hexLabelGroups.append('text').attr('class', 'property-label')
  .attr('x', d => d.cx - r * 0.7).attr('y', d => d.cy)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => d.properties.manaRank);

hexLabelGroups.append('text').attr('class', 'property-label')
  .attr('x', d => d.cx + r * 0.7).attr('y', d => d.cy)
  .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
  .style('font-size', `${r / 4}px`)
  .style('display', 'none')
  .text(d => d.properties.resourceRank);

const zoom = d3.zoom().scaleExtent([0.2, 10]).on('zoom', (event) => {
    g.attr('transform', event.transform);
    const effectiveRadius = r * event.transform.k;
    
    labelLayer.selectAll('.hex-label, .property-label')
      .style('display', effectiveRadius >= 70 ? 'inline' : 'none');
  });
svg.call(zoom);

function toggleLayerVisibility(layerName, buttonElement, showText, hideText) {
  const layer = layers[layerName];
  layer.visible = !layer.visible;
  layer.group.style('display', layer.visible ? 'inline' : 'none');
  buttonElement.textContent = layer.visible ? hideText : showText;
}

d3.select('#toggleManaOverlay').on('click', function() {
  toggleLayerVisibility('mana-overlay', this, '龍脈表示', '龍脈非表示');
});
d3.select('#toggleClimateOverlay').on('click', function() {
  toggleLayerVisibility('climate-overlay', this, '気候表示', '気候非表示');
});
d3.select('#toggleTempOverlay').on('click', function() {
    toggleLayerVisibility('temp-overlay', this, '気温表示', '気温非表示');
});
d3.select('#toggleElevationOverlay').on('click', function() {
  toggleLayerVisibility('elevation-overlay', this, '標高表示', '標高非表示');
});

// --- 初期表示位置の設定 ---
const targetX = 50;
const targetY = 50;
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