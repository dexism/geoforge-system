// ================================================================
// GeoForge System - MapView Module
// ================================================================
import * as d3 from 'd3';
import * as config from './config.js';
import { getIndex, formatLocation, getSharedEdgePoints, getSharedEdgeMidpoint } from './utils.js';
import { BLOCK_START_EE, BLOCK_START_NN, BLOCK_END_NN } from './BlockUtils.js';
import { getInfoText, updateOverallInfo, generateHexJson, childrenMap } from './infoWindow.js';

export class MapView {
    constructor(containerSelector) {
        this.containerSelector = containerSelector;
        this.svg = d3.select(containerSelector);
        this.g = this.svg.append('g');
        this.layers = {};
        this.hexes = []; // Global hex data (reference)
        this.roadPathsData = [];
        this.currentTransform = d3.zoomIdentity;
        this.blocks = []; // Array of block objects
        this.blockLoaderRef = null;
        this.minimapContainer = null;
        this.minimapSvg = null;
        this.currentSelectedHex = null;
        this.tooltipContainer = this.createTooltip();

        // Constants
        this.nationColor = d3.scaleOrdinal(d3.schemeTableau10);
        this.BLOCK_COLS = 23;
        this.BLOCK_ROWS = 20;
    }

    createTooltip() {
        d3.select('#tooltip').remove();
        return d3.select('body').append('div')
            .attr('id', 'tooltip')
            .attr('class', 'tooltip')
            .style('position', 'absolute')
            .style('visibility', 'hidden')
            .style('background-color', 'rgba(0, 0, 0, 0.8)')
            .style('color', '#fff')
            .style('padding', '5px')
            .style('border-radius', '5px')
            .style('font-size', '12px')
            .style('pointer-events', 'none')
            .style('z-index', '1000')
            .style('white-space', 'pre-wrap');
    }

    getTooltipText(d) {
        const p = d.properties;
        let headerText = '';
        const terrain = p.isWater ? '水域' : (p.terrainType || '不明');
        const vegetation = p.vegetation || 'なし';
        headerText += `地形：${terrain}\n代表植生：${vegetation}\n`;

        const features = [];
        if (p.isAlluvial) features.push('河川');
        if (p.hasSnow) features.push('積雪');
        if (p.beachNeighbors && p.beachNeighbors.length > 0) features.push('砂浜');
        if (features.length > 0) headerText += `特性：${features.join(', ')}\n`;
        headerText += '---\n';

        let bodyText = '';
        const locationText = formatLocation(d, 'short');
        const settlementType = (p.settlement || '散居').padEnd(2, '　');
        const populationText = `人口：${(p.population || 0).toLocaleString()} 人`;
        bodyText += `${settlementType}：${locationText}\n${populationText}`;

        if (p.parentHexId !== null) {
            bodyText += `\n---`;
            let currentHex = d;
            let safety = 0;
            while (currentHex && currentHex.properties.parentHexId !== null && safety < 10) {
                const parentHex = this.hexes[currentHex.properties.parentHexId];
                if (!parentHex) break;
                const parentType = (parentHex.properties.settlement || '').padEnd(2, '　');
                const parentCoords = formatLocation(parentHex, 'short');
                bodyText += `\n${parentType}：${parentCoords}`;
                currentHex = parentHex;
                safety++;
            }
        }
        const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺境';
        bodyText += `\n${nationName}`;

        return headerText + bodyText;
    }

    async initialize(allHexes, roadPaths, blockLoader) {
        this.blockLoaderRef = blockLoader;

        if (typeof allHexes.getHex === 'function') {
            const tempHexes = [];
            const count = allHexes.size || (allHexes.cols * allHexes.rows);
            for (let i = 0; i < count; i++) {
                tempHexes.push(allHexes.getHex(i));
            }
            tempHexes.cols = allHexes.cols;
            tempHexes.rows = allHexes.rows;
            allHexes = tempHexes;
        }

        this.hexes = allHexes;
        this.roadPathsData = roadPaths || []; // Ensure array

        this.initLayers();
        this.initMinimap();
        this.initZoom();
        this.setInitialView();

        this.updateAllHexColors();
        updateOverallInfo(this.hexes);
    }

    initLayers() {
        this.g.selectAll('*').remove();
        this.layers = {};

        const createLayer = (name, visibleByDefault = true) => {
            const layerGroup = this.g.append('g').attr('class', `${name} -layer`);
            this.layers[name] = { group: layerGroup, visible: visibleByDefault };
            if (!visibleByDefault) {
                layerGroup.style('display', 'none');
            }
            return layerGroup;
        };

        createLayer('terrain');
        createLayer('white-map-overlay', false);
        createLayer('vegetation-overlay', true);
        createLayer('beach', true);
        createLayer('snow', true);
        createLayer('river');
        createLayer('shading');
        createLayer('contour', true);
        createLayer('ridge-water-system', false);
        createLayer('territory-overlay', false);
        createLayer('hex-border', false);
        createLayer('road');
        createLayer('sea-route');
        createLayer('border');
        createLayer('highlight-overlay');
        createLayer('settlement');

        const overlays = [
            'monster-overlay', 'population-overlay', 'climate-zone-overlay',
            'temp-overlay', 'precip-overlay', 'mana-overlay',
            'agri-overlay', 'forest-overlay', 'mining-overlay', 'fishing-overlay',
            'hunting-overlay', 'pastoral-overlay', 'livestock-overlay'
        ];
        overlays.forEach(name => createLayer(name, false));

        createLayer('labels');
        const interactionLayer = createLayer('interaction');
        interactionLayer.style('pointer-events', 'none');
    }

    initMinimap() {
        d3.select('#minimap-container').remove();
        this.minimapContainer = d3.select('body').append('div').attr('id', 'minimap-container');
        this.minimapSvg = this.minimapContainer.append('svg').attr('id', 'minimap-svg');
        this.minimapSvg.append('g').attr('id', 'minimap-terrain');
        this.minimapViewport = this.minimapSvg.append('rect')
            .attr('id', 'minimap-viewport')
            .attr('fill', 'none')
            .attr('stroke', 'red')
            .attr('stroke-width', 2);
    }

    initZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.2, 10])
            .on('start', () => {
                this.svg.style('cursor', 'grabbing');
                Object.entries(this.layers).forEach(([name, layer]) => {
                    const isEssential = ['terrain', 'white-map-overlay', 'interaction', 'highlight-overlay'].includes(name);
                    if (!isEssential && layer.visible) {
                        layer.group.style('display', 'none');
                    }
                });
            })
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
                this.currentTransform = event.transform;
                // Minimap update can be throttled if needed
            })
            .on('end', (event) => {
                Object.entries(this.layers).forEach(([name, layer]) => {
                    if (layer.visible) layer.group.style('display', 'inline');
                });
                this.updateVisibleBlocks(event.transform);
                this.svg.style('cursor', 'grab');
                this.updateMinimapViewport();
            });

        this.svg.call(this.zoom);
    }

    setInitialView() {
        const svgNode = this.svg.node();
        const width = svgNode ? svgNode.clientWidth || window.innerWidth : window.innerWidth;
        const height = svgNode ? svgNode.clientHeight || window.innerHeight : window.innerHeight;

        let initialCx = 0;
        let initialCy = 0;

        if (config.INITIAL_ZOOM_LOC) {
            let nEe, nNn, lx, ly;
            // Expecting '5012' -> EE=50, ee=12
            // OR format '50-73' for block center??
            // User said: World '5012-7308' is Block 50-73 Local 12-08.

            if (typeof config.INITIAL_ZOOM_LOC === 'object') {
                // Assume config object { x: 5012, y: 7308 }
                const xx = config.INITIAL_ZOOM_LOC.x;
                const yy = config.INITIAL_ZOOM_LOC.y;
                nEe = Math.floor(xx / 100);
                nNn = Math.floor(yy / 100);
                lx = xx % 100;
                ly = yy % 100;
            } else {
                nEe = 50; nNn = 73; lx = 12; ly = 8; // Fallback default
            }

            const relativeBx = nEe - BLOCK_START_EE;
            // North is Plus (Up). In screen coordinates (Down is Plus), higher N means lower Y index.
            // Block 75 is at index 0 (Top). Block 71 is at index 4 (Bottom).
            const relativeBy = BLOCK_END_NN - nNn;

            const hexWidth = 2 * config.r;
            const hexHeight = Math.sqrt(3) * config.r;
            const blockWidthPx = this.BLOCK_COLS * (hexWidth * 0.75);
            const blockHeightPx = this.BLOCK_ROWS * hexHeight;

            // Coordinates are relative to Block 48 start
            initialCx = relativeBx * blockWidthPx + lx * (hexWidth * 0.75);
            initialCy = relativeBy * blockHeightPx + ly * hexHeight;
        }

        const initialScale = config.INITIAL_SCALE || 3.0;
        const initialTransform = d3.zoomIdentity
            .translate(width / 2 - initialCx * initialScale, height / 2 - initialCy * initialScale)
            .scale(initialScale);

        this.svg.call(this.zoom.transform, initialTransform);
        this.currentTransform = initialTransform;
        this.updateVisibleBlocks(initialTransform);
        this.updateMinimap();
    }

    // ================================================================
    // Rendering & Layers
    // ================================================================

    toggleLayer(layerName, forceVisible = null) {
        const layer = this.layers[layerName];
        if (!layer) return false;

        const newState = forceVisible !== null ? forceVisible : !layer.visible;
        layer.visible = newState;
        layer.group.style('display', newState ? 'inline' : 'none');

        if (layerName === 'settlement') {
            this.layers.labels.group.selectAll('.settlement-label').style('display', newState ? 'inline' : 'none');
            this.toggleLayer('border', newState);
        }

        const compositeLayers = ['terrain', 'white-map-overlay', 'vegetation-overlay', 'snow', 'shading', 'territory-overlay',
            'climate-zone-overlay', 'temp-overlay', 'precip-overlay', 'population-overlay', 'monster-overlay',
            'mana-overlay', 'agri-overlay', 'forest-overlay', 'mining-overlay', 'fishing-overlay',
            'hunting-overlay', 'pastoral-overlay', 'livestock-overlay'];

        if (compositeLayers.includes(layerName)) {
            this.updateAllHexColors();
        }

        this.updateVisibleBlocks(this.currentTransform);
        return newState;
    }

    calculateCompositeColor(d) {
        const p = d.properties;
        const isWhiteMap = document.querySelector('input[name="map-type"][value="white"]')?.checked;

        let baseColor;
        if (isWhiteMap) {
            baseColor = d.properties.isWater ? config.WHITE_MAP_COLORS.WATER : config.whiteMapElevationColor(p.elevation);
        } else {
            if (p.isWater && p.elevation > 0) baseColor = config.TERRAIN_COLORS['湖沼'];
            else baseColor = config.getElevationColor(p.elevation);
        }

        let c = d3.color(baseColor);
        if (!c) c = d3.color('#000');

        if (!p.isWater && this.layers['vegetation-overlay']?.visible) {
            let displayVeg = p.vegetation;
            if ((displayVeg === '森林' || displayVeg === '針葉樹林') && p.landUse?.forest < 0.10) {
                displayVeg = '草原';
            }
            const vegColor = d3.color(config.TERRAIN_COLORS[displayVeg]);
            if (vegColor) {
                vegColor.opacity = 0.6;
                c = this.interpolateColor(c, vegColor);
            }
        }

        if (!p.isWater && this.layers.snow?.visible && p.hasSnow) {
            const snowColor = d3.color('#fff');
            snowColor.opacity = 0.8;
            c = this.interpolateColor(c, snowColor);
        }

        const overlayMap = [
            { name: 'climate-zone-overlay', func: p => config.CLIMATE_ZONE_COLORS[p.climateZone], opacity: 0.6 },
            { name: 'temp-overlay', func: p => config.tempColor(p.temperature), opacity: 0.6 },
            { name: 'precip-overlay', func: p => config.precipColor(p.precipitation_mm), opacity: 0.6 },
            { name: 'population-overlay', func: p => p.population > 0 ? config.populationColor(p.population) : null, opacity: 0.9 },
            { name: 'monster-overlay', func: p => p.monsterRank ? config.MONSTER_COLORS[p.monsterRank] : null, opacity: 0.5 },
            { name: 'mana-overlay', func: p => config.manaColor(p.manaValue), opacity: 0.6 },
            { name: 'agri-overlay', func: p => config.agriColor(p.agriPotential), opacity: 0.7 },
            { name: 'forest-overlay', func: p => config.forestColor(p.forestPotential), opacity: 0.7 },
            { name: 'mining-overlay', func: p => config.miningColor(p.miningPotential), opacity: 0.7 },
            { name: 'fishing-overlay', func: p => config.fishingColor(p.fishingPotential), opacity: 0.7 },
            { name: 'hunting-overlay', func: p => config.huntingColor(p.huntingPotential), opacity: 0.7 },
            { name: 'pastoral-overlay', func: p => config.pastoralColor(p.pastoralPotential), opacity: 0.7 },
            { name: 'livestock-overlay', func: p => config.livestockColor(p.livestockPotential), opacity: 0.7 }
        ];

        const isResourceActive = overlayMap.slice(5).some(l => this.layers[l.name] && this.layers[l.name].visible);
        if (isResourceActive) {
            const hsl = d3.hsl(c);
            hsl.s *= 0.3;
            hsl.l = Math.min(1, hsl.l * 1.4);
            c = hsl.rgb();
        }

        overlayMap.forEach(l => {
            if (this.layers[l.name]?.visible) {
                const colorVal = l.func(p);
                if (colorVal) {
                    const col = d3.color(colorVal);
                    if (col) {
                        col.opacity = l.opacity;
                        c = this.interpolateColor(c, col);
                    }
                }
            }
        });

        if (this.layers['territory-overlay']?.visible && p.nationId > 0) {
            const tColor = d3.color(this.nationColor(p.nationId));
            tColor.opacity = 0.7;
            c = this.interpolateColor(c, tColor);
        }

        if (this.layers.shading?.visible) {
            const val = p.shadingValue || 0;
            const opacity = d3.scaleLinear().domain([0, 400]).range([0, 0.2]).clamp(true)(Math.abs(val));
            const shadeColor = d3.color(val > 0 ? '#fff' : '#000');
            shadeColor.opacity = opacity;
            c = this.interpolateColor(c, shadeColor);
        }

        return c.formatRgb();
    }

    interpolateColor(base, overlay) {
        if (!base || !overlay) return base || overlay;
        const alpha = overlay.opacity;
        if (isNaN(alpha)) return base;
        const invAlpha = 1 - alpha;
        return d3.rgb(
            overlay.r * alpha + base.r * invAlpha,
            overlay.g * alpha + base.g * invAlpha,
            overlay.b * alpha + base.b * invAlpha
        );
    }

    updateAllHexColors() {
        if (!this.blocks) return;
        this.blocks.forEach(block => {
            if (block.hexes) {
                block.hexes.forEach(d => {
                    d._displayColor = this.calculateCompositeColor(d);
                });
            }
            if (block.rendered) {
                this.layers['terrain'].group.select(`#terrain-${block.id}`).selectAll('.hex')
                    .attr('fill', d => d._displayColor || '#000');
            }
        });
    }

    updateRiverColor() {
        const isRidge = this.layers['ridge-water-system']?.visible;
        const isWhite = document.querySelector('input[name="map-type"][value="white"]')?.checked;
        const color = isRidge ? config.RIDGE_WATER_SYSTEM_COLORS.RIVER : (isWhite ? config.WHITE_MAP_COLORS.WATER : config.TERRAIN_COLORS.河川);
        this.layers.river.group.selectAll('path').attr('stroke', color);
        // Ridge water hexes
        this.layers['ridge-water-system'].group.selectAll('.rws-water-hex').attr('fill', color);
    }

    // ================================================================
    // Block Management
    // ================================================================

    updateVisibleBlocks(transform) {
        if (!this.svg) return;
        const svgNode = this.svg.node();
        const width = svgNode.clientWidth || window.innerWidth;
        const height = svgNode.clientHeight || window.innerHeight;

        // Center of the viewport in screen coordinates
        const screenCenter = [width / 2, height / 2];
        // Center of the viewport in world coordinates
        const worldCenter = transform.invert(screenCenter);

        const topLeft = transform.invert([0, 0]);
        const bottomRight = transform.invert([width, height]);

        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;
        const blockWidthPx = this.BLOCK_COLS * (hexWidth * 0.75);
        const blockHeightPx = this.BLOCK_ROWS * hexHeight;

        // Calculate Relative Block Coordinate (0-based from Block BLOCK_START_EE, BLOCK_START_NN)
        // [FIX] Strict Visibility: Do not prospectively load neighbors. Use BUFFER = 0.
        // User requirement: Only load what is strictly visible or operated on.
        const BUFFER = 0;
        const relBxMin = Math.floor(topLeft[0] / blockWidthPx) - BUFFER;
        const relBxMax = Math.floor(bottomRight[0] / blockWidthPx) + BUFFER;
        const relByMin = Math.floor(topLeft[1] / blockHeightPx) - BUFFER;
        const relByMax = Math.floor(bottomRight[1] / blockHeightPx) + BUFFER;

        // console.log(`[MapView Debug] Transform: k=${transform.k}, x=${transform.x}, y=${transform.y}`);
        // console.log(`[MapView Debug] Viewport: TL(${topLeft[0].toFixed(0)}, ${topLeft[1].toFixed(0)}) - BR(${bottomRight[0].toFixed(0)}, ${bottomRight[1].toFixed(0)})`);
        // console.log(`[MapView Debug] Visible Relative Range: RBX ${relBxMin} -${relBxMax}, RBY ${relByMin} -${relByMax} `);

        const visibleIds = new Set();
        let activeBlocks = [];

        for (let rby = relByMin; rby <= relByMax; rby++) {
            for (let rbx = relBxMin; rbx <= relBxMax; rbx++) {
                // Determine Absolute ID
                const absEe = rbx + BLOCK_START_EE;
                // Invert N-axis: relBy=0 is Top (North, Max N), relBy=MAX is Bottom (South, Min N)
                const absNn = BLOCK_END_NN - rby;

                const id = `map_${absEe}_${absNn}`;
                visibleIds.add(id);

                let block = this.blocks.find(b => b.id === id);
                if (!block) {
                    // Create block with ID and RELATIVE indices for rendering
                    block = this.createBlock(id, rbx, rby, absEe, absNn);
                    this.blocks.push(block);
                }
                block.visible = true;
                activeBlocks.push(block);
            }
        }

        // Debug Loading/Unloading Logic
        // console.log(`[MapView Debug] Viewport: TL(${topLeft[0].toFixed(0)}, ${topLeft[1].toFixed(0)}) - BR(${bottomRight[0].toFixed(0)}, ${bottomRight[1].toFixed(0)})`);
        // console.log(`[MapView Debug] Visible IDs: ${Array.from(visibleIds).join(', ')}`);

        // Sort blocks by distance from world center (User Requirement)
        activeBlocks.sort((a, b) => {
            // Calculate block center in world pixels using relative coordinates
            const acx = (a.relBx + 0.5) * blockWidthPx;
            const acy = (a.relBy + 0.5) * blockHeightPx;
            const bcx = (b.relBx + 0.5) * blockWidthPx;
            const bcy = (b.relBy + 0.5) * blockHeightPx;

            const distA = (acx - worldCenter[0]) ** 2 + (acy - worldCenter[1]) ** 2;
            const distB = (bcx - worldCenter[0]) ** 2 + (bcy - worldCenter[1]) ** 2;
            return distA - distB;
        });

        // Process blocks in sorted order
        // [FIX] Ensure Group Elements exist for visible blocks BEFORE rendering.
        // Otherwise, synchronous renderBlock (cached) will fail to find the group.
        const allLayerNames = Object.keys(this.layers);
        allLayerNames.forEach(name => {
            if (!this.layers[name]) return;
            this.layers[name].group.selectAll(`.block-group-${name}`)
                .data(activeBlocks, d => d.id)
                .join(
                    enter => enter.append('g').attr('class', `block-group block-group-${name}`).attr('id', d => `${name}-${d.id}`),
                    update => update,
                    exit => exit.remove()
                );
        });

        // Process blocks in sorted order
        activeBlocks.forEach(block => {
            this.handleBlockAndRender(block);
        });

        // Cleanup invisible blocks
        this.blocks.forEach(b => {
            if (!visibleIds.has(b.id)) {
                if (b.rendered) {
                    // console.log(`[MapView Debug] Unloading Block: ${b.id}`);
                    this.unloadBlockDOM(b);
                }
                b.visible = false;
            }
        });
    }

    createBlock(id, rbx, rby, absEe, absNn) {
        // console.log(`[MapView] Creating block ${ id } (Rel ${ rbx },${ rby })`);
        return {
            id: id,
            relBx: rbx, // 0-based relative index for pixel calcs
            relBy: rby,
            absEe: absEe,
            absNn: absNn,
            hexes: [],
            rendered: false,
            visible: true,
            loaded: false,
            loading: false
        };
    }

    handleBlockAndRender(block) {
        // If already rendered, ensure display is on
        if (block.rendered) {
            // Optional: check if display:none and show it
            return;
        }

        console.log(`[Buffer Operation] Start Processing Block: ${block.id}`);

        if (!block.loaded && !block.loading) {
            if (this.blockLoaderRef) {
                block.loading = true;
                // console.log(`[MapView] Loading block ${ block.id }...`);
                this.blockLoaderRef.load(block.id).then(success => {
                    block.loading = false;
                    block.loaded = true;
                    if (success) {
                        // Data assumes to be in global this.hexes updated by loader
                        // Clone data immediately while buffer is valid
                        console.log(`[Buffer Operation] Loader Buffer populated for ${block.id}. Creating Screen Buffer Snapshot...`);
                        this.generateBlockHexes(block);
                    } else {
                        console.warn(`[MapView] Block ${block.id} load failed or invalid. Filling Dummy Data.`);
                        // [FIX] Fill Global Map with Dummy Data (Inner Core Overwrite)
                        this.ensureDummyData(block);
                        // [FIX] Render from Global Map
                        this.generateBlockHexes(block);
                    }
                    this.renderBlock(block);
                });
            } else {
                block.loaded = true;
                console.log(`[Buffer Operation] No Loader. Generating Default/Dummy Screen Buffer for ${block.id}...`);
                this.ensureDummyData(block);
                this.generateBlockHexes(block);
                this.renderBlock(block);
            }
        } else if (block.loaded && !block.rendered) {
            console.log(`[Buffer Operation] Block ${block.id} already loaded. Re-rendering from Screen Buffer.`);
            this.renderBlock(block);
        }
    }

    // [FEAT] Relief Shading Logic
    applyRelief(hex, northHex, southHex) {
        // [RESTORE] Original Logic from ui.js reference
        // South > North -> Positive (Brighter)
        // North > South -> Negative (Darker)
        // Removed arbitrary scaling (* 5) to restore original gradient feel.

        const delta = (southHex.elevation - northHex.elevation);
        hex.shadingValue = delta;

        if (this.layers.shading && this.layers.shading.visible) {
            const val = hex.shadingValue;
            // Use same scale as calculateCompositeColor for consistency
            // Domain [0, 400] -> Opacity [0, 0.2]
            const opacity = Math.min(0.2, Math.abs(val) / 400 * 0.2);
            const shading = val > 0 ? opacity : -opacity;

            hex._displayColor = this.adjustBrightness(hex._displayColor, shading);
        }
    }

    adjustBrightness(hexColor, percent) {
        if (!hexColor || typeof hexColor !== 'string') return hexColor;
        // Simple RGB adjustment
        // hexColor format assumed: "#RRGGBB"
        if (hexColor.length < 7) return hexColor; // Safety for short/named colors

        let r = parseInt(hexColor.substr(1, 2), 16);
        let g = parseInt(hexColor.substr(3, 2), 16);
        let b = parseInt(hexColor.substr(5, 2), 16);

        // Apply percentage (e.g. +0.1 for 10% brighter)
        // 0.0 is neutral.
        // Logic: Add/Subtract from channels? Or Multiply?
        // Standard "Lighten/Darken":
        // Target is White (255) for lighten, Black (0) for darken.

        if (percent > 0) {
            // Lighten: approach 255
            r = r + (255 - r) * percent;
            g = g + (255 - g) * percent;
            b = b + (255 - b) * percent;
        } else {
            // Darken: approach 0
            const p = Math.abs(percent);
            r = r * (1 - p);
            g = g * (1 - p);
            b = b * (1 - p);
        }

        r = Math.min(255, Math.max(0, Math.round(r)));
        g = Math.min(255, Math.max(0, Math.round(g)));
        b = Math.min(255, Math.max(0, Math.round(b)));

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    unloadBlockDOM(block) {
        Object.keys(this.layers).forEach(name => {
            const sel = this.layers[name].group.select(`#${name}-${block.id}`);
            if (!sel.empty()) {
                sel.remove();
            }
        });
        block.rendered = false;
        // console.log(`[Buffer Operation] Unloaded DOM for Block ${block.id}`);
    }

    // [FIX] Ensure Dummy Data exists in Global Map (this.hexes)
    // Called when block load fails, or to fill gaps.
    ensureDummyData(block) {
        const CORE_COL = 23;
        const CORE_ROW = 20;
        const GLOBAL_OFFSET_X = 1;
        const GLOBAL_OFFSET_Y = 1;

        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;

        let absNn = block.absNn;
        if (absNn === undefined) { const p = block.id.split('_'); absNn = parseInt(p[2]); absEe = parseInt(p[1]); }
        let absEe = block.absEe;
        if (absEe === undefined) { const p = block.id.split('_'); absEe = parseInt(p[1]); }

        const coreStartCol = GLOBAL_OFFSET_X + (absEe - BLOCK_START_EE) * CORE_COL;
        const coreStartRow = GLOBAL_OFFSET_Y + (absNn - BLOCK_START_NN) * CORE_ROW;

        // [FIX] Loop Full Range (0..25 cols, 0..22 rows) to update Global Map
        const rowStart = 0;
        const rowEnd = 22; 
        const colStart = 0;
        const colEnd = 25; 

        for (let lr = rowStart; lr < rowEnd; lr++) {
            for (let lc = colStart; lc < colEnd; lc++) {
                // Global Coords
                const c = coreStartCol + (lc - 1);
                // [FIX] Vertical Inversion (Match generateBlockHexes)
                // lr 1..20 -> r (High..Low)
                const r = coreStartRow + (CORE_ROW - 1) - (lr - 1);

                // [CRITICAL FIX] Use Local Index for Buffer Access
                // The shared buffer seems to rely on local keys/indices.
                const hexIndex = getIndex(lc, lr);
                let hex = this.hexes[hexIndex];

                // [FIX] 2-Cell Overlap Definition
                // Inner Core (Exclusive): Col 2..22, Row 2..19.
                const isInnerCore = (lc >= 2 && lc <= 22) && (lr >= 2 && lr <= 19);

                // If Inner Core -> Force Overwrite (Clear Ghosts).
                // If Overlap -> Only Fill if Missing (Copy/Preserve Neighbor).
                if (isInnerCore || !hex) {
                     hex = {
                        col: c,
                        row: r,
                        isWater: true,
                        terrainType: '海洋',
                        elevation: -1,
                        vegetation: '海洋',
                        properties: {}, 
                        _displayColor: config.TERRAIN_COLORS['海洋'] || '#8cf',
                        shadingValue: 0
                    };
                    hex.properties = hex;
                    
                    // Display Coords
                    hex.ee = absEe;
                    hex.nn = absNn;
                    hex.localCol = lc;
                    hex.localRow = (CORE_ROW + 1) - lr;

                    // Geometry
                    const WORLD_ROWS = 2002;
                    const cx = c * (hexWidth * 0.75) + config.r;
                    const cy = ((WORLD_ROWS - 1) - r) * hexHeight + (c % 2 === 0 ? 0 : hexHeight / 2) + config.r;

                    hex.cx = cx;
                    hex.cy = cy;
                    const points = [];
                    for (let i = 0; i < 6; i++) {
                        const angle_deg = 60 * i;
                        const angle_rad = Math.PI / 180 * angle_deg;
                        points.push([cx + config.r * Math.cos(angle_rad), cy + config.r * Math.sin(angle_rad)]);
                    }
                    hex.points = points;

                    // Update Global Map
                    this.hexes[hexIndex] = hex;
                }
            }
        }
    }

    updateUIWithBlockData(blockId, allHexes) {
        const block = this.blocks.find(b => b.id === blockId);
        if (!block) return;

        // [FIX] Ensure Screen Buffer is populated from Loader Buffer immediately upon load completion.
        // This prevents "0 hexes" error if render is called before the promise chain in handleBlockAndRender.
        // Also protects against Loader Buffer being overwritten by next block.
        console.log(`[Buffer Operation] updateUIWithBlockData trigger for ${blockId}. Syncing Screen Buffer...`);
        this.generateBlockHexes(block);

        // Force re-render if updated
        block.rendered = false;
        this.renderBlock(block);
    }

    generateBlockHexes(block) {
        block.hexes = [];
        const CORE_COL = 23;
        const CORE_ROW = 20;
        const GLOBAL_OFFSET_X = 1;
        const GLOBAL_OFFSET_Y = 1;
        const BUFFER = 1;



        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;

        // console.log(`[MapView] Generating hexes for ${ block.id }(Rel ${ block.relBx }, ${ block.relBy }).Range: C${ coreStartCol } -${ coreStartCol + CORE_COL }, R${ coreStartRow } -${ coreStartRow + CORE_ROW } `);

        // [Buffer Log]
        console.log(`[Buffer Operation] Cloning hexes from Shared Loader Buffer to Block Screen Buffer (${block.id})...`);

        // Use loose bounds


        // Calculate Core Start relative to the Global Grid
        // Determine absNn first
        let absNn = block.absNn;
        if (absNn === undefined) {
            const parts = block.id.split('_');
            absNn = parseInt(parts[2], 10);
        }
        let absEe = block.absEe;
        if (absEe === undefined) {
            const parts = block.id.split('_');
            absEe = parseInt(parts[1], 10);
        }

        const coreStartCol = GLOBAL_OFFSET_X + (absEe - BLOCK_START_EE) * CORE_COL;
        const coreStartRow = GLOBAL_OFFSET_Y + (absNn - BLOCK_START_NN) * CORE_ROW;

        // [FIX] Generate Full Buffer Range (Including Overlap)
        // Buffer: 0..24 (Cols), 0..21 (Rows)
        // Previous: 1..24, 1..21 skipped edges.
        // Use STRICT bounds (Core Only) to avoid overlap rendering
        // Buffer Access: 0=Pad, 1=CoreStart ... 
        // Core Cols: 1 to 23 (Inclusive) -> < 24
        // Core Rows: 1 to 20 (Inclusive) -> < 21
        const rowStart = 1;
        const rowEnd = 21;
        const colStart = 1;
        const colEnd = 24;

        // console.log(`[MapView] Generating hexes for ${ block.id }. Local Buffer Iteration.`);

        for (let lr = rowStart; lr < rowEnd; lr++) {
            for (let lc = colStart; lc < colEnd; lc++) {
                // Buffer Access (Local)
                // const hexIndex = getIndex(lc, lr); // [BUG] This was using Local Index for Global Map!
                // const sourceHex = this.hexes[hexIndex];

                const c = coreStartCol + (lc - 1);

                // [FIX] Vertical Inversion
                // Buffer Data is Top-Left (Row 1 is North).
                // World Coords are Cartesian (Row 0 is South).
                // Must invert the row index mapping.
                // lr goes 1..20.
                // r should go (coreStartRow + 19) .. (coreStartRow).
                const r = coreStartRow + (CORE_ROW - 1) - (lr - 1);

                // [CRITICAL FIX] Use Local Index (Revert)
                const hexIndex = getIndex(lc, lr);
                const sourceHex = this.hexes[hexIndex];

                // Assign Block & Local Coords for correct display
                // Note: Spec says Local is 01-23. Data array buffer is 00-24.
                // Loop lc is 1..23. So localCol should be lc.
                const localCol = lc;
                // [FIX] Local Row Inversion for Property
                // lr=1 (Physically North/Top) -> Spec North is 20.
                // lr=20 (Physically South/Bottom) -> Spec South is 01.
                const localRow = (CORE_ROW + 1) - lr;

                let hex;
                if (sourceHex) {
                    // [CRITICAL] CLONE data from shared buffer to prevent overwrite by subsequent blocks.
                    hex = {
                        index: sourceHex.index,
                        col: c, // Global Col
                        row: r, // Global Row

                        // Data Properties from Flyweight (Safe Explicit Copy)
                        isWater: sourceHex.isWater,
                        terrainType: sourceHex.terrainType,
                        elevation: sourceHex.elevation,
                        vegetation: sourceHex.vegetation,

                        flow: sourceHex.flow,
                        riverWidth: sourceHex.riverWidth, // Important if river flow is used
                        waterArea: sourceHex.waterArea,
                        downstreamIndex: sourceHex.downstreamIndex, // For rivers

                        isAlluvial: sourceHex.isAlluvial,
                        isCoastal: sourceHex.isCoastal,
                        isLakeside: sourceHex.isLakeside,

                        settlement: sourceHex.settlement,
                        population: sourceHex.population,
                        roadLevel: sourceHex.roadLevel,

                        temperature: sourceHex.temperature,
                        precipitation_mm: sourceHex.precipitation_mm,
                        climateZone: sourceHex.climateZone,

                        monsterElement: sourceHex.monsterElement,
                        monsterDanger: sourceHex.monsterDanger,

                        // Complex objects (Copy if exist)
                        landUse: sourceHex.landUse ? { ...sourceHex.landUse } : {},

                        // IDs
                        nationId: sourceHex.nationId,
                        territoryId: sourceHex.territoryId,

                        // Neighbors (needed for borders, beaches, rivers)
                        neighbors: sourceHex.neighbors ? [...sourceHex.neighbors] : [],
                        beachNeighbors: sourceHex.beachNeighbors ? [...sourceHex.beachNeighbors] : [],

                        properties: {}, // Proxy target

                        // Copy base color
                        _displayColor: sourceHex._displayColor || (config.WHITE_MAP_COLORS && config.WHITE_MAP_COLORS.WATER ? config.WHITE_MAP_COLORS.WATER : '#eef6f6')
                    };

                    // [FIX] Compatibility
                    hex.properties = hex;
                    // Ensure _displayColor is set if sourceHex had none (and fallback failed above)
                    if (!hex._displayColor) hex._displayColor = '#eef6f6';

                    // [FEAT] Apply Relief Shading
                    // Use Padding to access neighbors: Top (North) is lr-1, Bottom (South) is lr+1.
                    // Buffer: 0=Pad(N), 1..20=Core, 21=Pad(S).
                    const northIdx = getIndex(lc, lr - 1);
                    const southIdx = getIndex(lc, lr + 1);
                    const northHex = this.hexes[northIdx];
                    const southHex = this.hexes[southIdx];

                    if (northHex && southHex) {
                        this.applyRelief(hex, northHex, southHex);
                    }

                } else {
                    // Dummy Hex (inside generateBlockHexes logic)
                    hex = {
                        col: c,
                        row: r,
                        isWater: true,
                        terrainType: '海洋',
                        elevation: 0,
                        vegetation: '海洋',
                        properties: {}, // Will be set to self below
                        _displayColor: config.TERRAIN_COLORS['海洋'] || '#48d'
                    };
                    hex.properties = hex;
                    hex.shadingValue = 0;
                }

                // Assign Coords for Display (Fixes coordinate display issue)
                hex.ee = absEe;
                hex.nn = absNn;
                hex.localCol = localCol;
                hex.localRow = localRow;

                // Geometry Calculation in PIXEL space (relative to Map Viewport 0,0)
                // Global Row 0 is Bottom. Pixel Y increases Downwards.
                const WORLD_ROWS = 2002;
                const cx = c * (hexWidth * 0.75) + config.r;
                const cy = ((WORLD_ROWS - 1) - r) * hexHeight + (c % 2 === 0 ? 0 : hexHeight / 2) + config.r;

                hex.cx = cx;
                hex.cy = cy;

                // Points used for polygon rendering
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle_deg = 60 * i;
                    const angle_rad = Math.PI / 180 * angle_deg;
                    points.push([
                        cx + config.r * Math.cos(angle_rad),
                        cy + config.r * Math.sin(angle_rad)
                    ]);
                }
                hex.points = points;

                // Ensure properties circular ref (Safe way)
                Object.defineProperty(hex, 'properties', {
                    get: function () { return this; },
                    enumerable: false,
                    configurable: true
                });

                // Calculate Color immediately (using cloned props)
                hex._displayColor = this.calculateCompositeColor(hex);

                block.hexes.push(hex);
            }
        }

        console.log(`[Buffer Operation] Screen Buffer Population Complete for ${block.id}. (Hex Count: ${block.hexes.length})`);


    }

    renderBlock(block) {
        // console.log(`[MapView] Rendering ${ block.id } `);
        // this.generateBlockHexes(block); // [FIX] MOVED to load handler. DO NOT regenerate here.

        if (!block.hexes || block.hexes.length === 0) {
            console.error(`[MapView] Block ${block.id} has 0 hexes. Data missing.`);
            return;
        }

        console.log(`[Buffer Operation] Rendering Block ${block.id} from Screen Buffer...`);

        this.drawBlockTerrain(block);
        // this.drawBlockRivers(block); // User requested to skip rivers for now
        this.drawBlockBeaches(block);
        this.drawBlockBorders(block);
        this.drawBlockRidgeLines(block);
        this.drawBlockContours(block);
        this.drawBlockSettlements(block);
        this.drawBlockRoads(block);
        this.drawBlockLabels(block);
        this.drawBlockHexBorders(block);
        this.drawBlockInteraction(block);

        block.rendered = true;
    }

    // ================================================================
    // Drawing Functions
    // ================================================================

    drawBlockTerrain(block) {
        const g = this.layers.terrain.group.select(`#terrain-${block.id}`);
        if (g.empty()) return;
        g.selectAll('.hex').data(block.hexes, d => d.index).join('polygon')
            .attr('class', 'hex')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx}, ${d.cy}) scale(1.01)`)
            .attr('stroke', 'none')
            .attr('fill', d => d._displayColor || '#000');
    }

    drawBlockRivers(block) {
        const g = this.layers.river.group.select(`#river-${block.id}`);
        if (g.empty()) return;

        const pathData = [];
        block.hexes.forEach(d => {
            if (d.properties.flow > 0 && !d.properties.isWater) {
                const downstream = d.downstreamIndex !== -1 ? this.hexes[d.downstreamIndex] : null;
                if (!downstream) return;

                const end = getSharedEdgeMidpoint(d, downstream);
                if (!end) return;

                const cp = [d.cx, d.cy];
                const upstreams = (this.hexes || []).filter(h => h && h.downstreamIndex === d.index);

                if (upstreams.length === 0) {
                    const start = [d.cx, d.cy];
                    pathData.push({ path: `M ${start[0]},${start[1]} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, width: d.properties.riverWidth });
                } else {
                    upstreams.forEach(u => {
                        const start = getSharedEdgeMidpoint(d, u);
                        if (start) {
                            pathData.push({ path: `M ${start[0]},${start[1]} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, width: u.properties.riverWidth });
                        }
                    });
                }
            }
        });

        const isRidge = this.layers['ridge-water-system']?.visible;
        const isWhite = document.querySelector('input[name="map-type"][value="white"]')?.checked;
        const color = isRidge ? config.RIDGE_WATER_SYSTEM_COLORS.RIVER : (isWhite ? config.WHITE_MAP_COLORS.WATER : config.TERRAIN_COLORS.河川);

        g.selectAll('path').data(pathData).join('path')
            .attr('d', d => d.path)
            .attr('stroke', color)
            .attr('stroke-width', d => Math.min(0.5 + (d.width || 1) * 0.1, config.r))
            .attr('stroke-linecap', 'round')
            .style('fill', 'none')
            .style('pointer-events', 'none');
    }

    drawBlockBeaches(block) {
        const g = this.layers.beach.group.select(`#beach-${block.id}`);
        if (g.empty()) return;
        const paths = [];
        block.hexes.forEach(d => {
            if (d.properties.beachNeighbors?.length > 0) {
                d.properties.beachNeighbors.forEach(ni => {
                    const n = this.hexes[ni];
                    if (n) {
                        const edge = getSharedEdgePoints(d, n);
                        if (edge) paths.push(`M ${edge[0][0]},${edge[0][1]} L ${edge[1][0]},${edge[1][1]}`);
                    }
                });
            }
        });
        g.selectAll('path').data(paths).join('path')
            .attr('d', d => d)
            .attr('stroke', config.TERRAIN_COLORS.砂浜)
            .attr('stroke-width', 6)
            .attr('stroke-linecap', 'round')
            .style('fill', 'none')
            .style('pointer-events', 'none');
    }

    drawBlockBorders(block) {
        const g = this.layers.border.group.select(`#border-${block.id}`);
        if (g.empty()) return;
        const lines = [];
        block.hexes.forEach(h => {
            const hId = h.properties.nationId || 0;
            if (hId === 0) return;
            (h.neighbors || []).map(i => this.hexes[i]).filter(Boolean).forEach(n => {
                if (h.index < n.index) {
                    const nId = n.properties.nationId || 0;
                    if (nId > 0 && hId !== nId) {
                        const edge = getSharedEdgePoints(h, n);
                        if (edge) lines.push({ x1: edge[0][0], y1: edge[0][1], x2: edge[1][0], y2: edge[1][1] });
                    }
                }
            });
        });
        g.selectAll('line').data(lines).join('line')
            .attr('x1', d => d.x1).attr('y1', d => d.y1)
            .attr('x2', d => d.x2).attr('y2', d => d.y2)
            .attr('stroke', '#f00').attr('stroke-width', 4).attr('stroke-linecap', 'round');
    }

    drawBlockRidgeLines(block) {
        const g = this.layers['ridge-water-system'].group.select(`#ridge-water-system-${block.id}`);
        if (g.empty()) return;

        g.selectAll('.rws-water-hex')
            .data(block.hexes.filter(d => d.properties.isWater), d => d.index).join('polygon')
            .attr('class', 'rws-water-hex')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx}, ${d.cy}) scale(1.01)`)
            .attr('fill', config.RIDGE_WATER_SYSTEM_COLORS.RIVER);

        const paths = [];
        block.hexes.forEach(s => {
            if (s.properties.ridgeFlow > 0 && !s.properties.isWater) {
                const up = s.ridgeUpstreamIndex !== -1 ? this.hexes[s.ridgeUpstreamIndex] : null;
                const end = up ? getSharedEdgeMidpoint(s, up) : [s.cx, s.cy];
                if (!end) return;
                const downs = (this.hexes || []).filter(h => h.ridgeUpstreamIndex === s.index);
                const cp = [s.cx, s.cy];

                if (downs.length === 0) {
                    paths.push({ path: `M ${s.cx},${s.cy} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, flow: s.properties.ridgeFlow });
                } else {
                    downs.forEach(d => {
                        const start = getSharedEdgeMidpoint(s, d);
                        if (start) paths.push({ path: `M ${start[0]},${start[1]} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, flow: d.properties.ridgeFlow });
                    });
                }
            }
        });

        g.selectAll('.rws-ridge-segment').data(paths).join('path')
            .attr('d', d => d.path)
            .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIDGE)
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
            .style('fill', 'none').style('pointer-events', 'none');
    }

    drawBlockContours(block) {
        // Placeholder implementation
        // Re-implement if logic is found or needed
    }

    drawBlockSettlements(block) {
        const g = this.layers.settlement.group.select(`#settlement-${block.id}`);
        if (g.empty()) return;
        const data = block.hexes.filter(d => d.properties.settlement);
        g.selectAll('.settlement-hex').data(data, d => d.index).join('polygon')
            .attr('class', 'settlement-hex')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx}, ${d.cy}) scale(0.5)`)
            .attr('fill', d => ({
                '首都': '#f0f',
                '都市': '#f00',
                '領都': '#f00',
                '街': '#f80',
                '町': '#ff0',
                '村': '#0f0'
            }[d.properties.settlement] || '#fff'))
            .style('fill-opacity', 0.8)
            .style('pointer-events', 'none');
    }

    drawBlockRoads(block) {
        const g = this.layers.road.group.select(`#road-${block.id}`);
        const seaG = this.layers['sea-route'].group.select(`#sea-route-${block.id}`);
        if (g.empty() && seaG.empty()) return;
        if (this.roadPathsData.length === 0) return;

        const blockHexSet = new Set(block.hexes.map(h => h.index));
        const roads = [];
        const seaRoutes = [];

        this.roadPathsData.forEach(road => {
            if (road.path.length < 2) return;
            // Iterate segments
            for (let i = 0; i < road.path.length; i++) {
                const curP = road.path[i];
                const curIdx = getIndex(curP.x, curP.y);
                const curHex = this.hexes[curIdx];
                if (!curHex) continue;

                if (!blockHexSet.has(curIdx)) continue;

                const prevHex = i > 0 ? this.hexes[getIndex(road.path[i - 1].x, road.path[i - 1].y)] : null;
                const nextHex = i < road.path.length - 1 ? this.hexes[getIndex(road.path[i + 1].x, road.path[i + 1].y)] : null;

                const start = prevHex ? getSharedEdgeMidpoint(curHex, prevHex) : [curHex.cx, curHex.cy];
                const end = nextHex ? getSharedEdgeMidpoint(curHex, nextHex) : [curHex.cx, curHex.cy];

                const cp = [curHex.cx, curHex.cy];
                const path = `M ${start ? start[0] : cp[0]},${start ? start[1] : cp[1]} Q ${cp[0]},${cp[1]} ${end ? end[0] : cp[0]},${end ? end[1] : cp[1]}`;

                if (road.level === 10) {
                    seaRoutes.push({ path, shipKey: road.shipKey });
                } else {
                    roads.push({ path, level: road.level });
                }
            }
        });

        if (!g.empty()) {
            g.selectAll('path').data(roads).join('path').attr('d', d => d.path)
                .attr('stroke', d => ({
                    6: '#f0f',
                    5: '#f00',
                    4: '#f80',
                    3: '#ff0',
                    2: '#0f0',
                    1: '#600'
                }[d.level] || '#fff'))
                .attr('stroke-width', d => d.level)
                .style('fill', 'none')
                .style('pointer-events', 'none');
        }
        if (!seaG.empty()) {
            seaG.selectAll('path').data(seaRoutes).join('path').attr('d', d => d.path)
                .attr('stroke', d => ({
                    'dinghy': '#0f0',
                    'small_trader': '#ff0',
                    'coastal_trader': '#f00',
                    'medium_merchant': '#a0f',
                    'large_sailing_ship': '#00f'
                }[d.shipKey] || '#fff'))
                .attr('stroke-width', 2).attr('stroke-dasharray', '2,4')
                .style('fill', 'none').style('pointer-events', 'none');
        }
    }

    drawBlockLabels(block) {
        const g = this.layers.labels.group.select(`#labels-${block.id}`);
        if (g.empty()) return;

        const grps = g.selectAll('.hex-label-group').data(block.hexes, d => d.index).join('g').attr('class', 'hex-label-group');
        grps.selectAll('*').remove();

        grps.append('text')
            .attr('x', d => d.cx)
            .attr('y', d => d.cy + config.r * 0.5)
            // .attr('text-anchor', 'middle')
            .attr('class', 'hex-label')
            .text(d => formatLocation(d, 'coords'))
        // .style('font-size', '5px')
        // .style('fill', '#000');

        grps.filter(d => d.properties.settlement)
            .append('text').attr('x', d => d.cx).attr('y', d => d.cy)
            .attr('class', 'settlement-label')
            .text(d => d.properties.settlement)
            // .attr('text-anchor', 'middle')
            // .attr('dominant-baseline', 'middle')
            // .style('font-size', '10px')
            // .style('fill', '#000')
            .style('display', this.layers.settlement.visible ? 'inline' : 'none');
    }

    drawBlockHexBorders(block) {
        const g = this.layers['hex-border'].group.select(`#hex-border-${block.id}`);
        if (g.empty()) return;
        g.selectAll('polygon').data(block.hexes, d => d.index).join('polygon')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx}, ${d.cy})`)
            .attr('fill', 'none')
            .attr('stroke', '#fff8')
            .attr('stroke-width', 0.5);
    }

    drawBlockInteraction(block) {
        const g = this.layers.interaction.group.select(`#interaction-${block.id}`);
        if (g.empty()) return;

        g.selectAll('.interactive-hex').data(block.hexes, d => d.index).join('polygon')
            .attr('class', 'interactive-hex')
            .attr('points', d => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', d => `translate(${d.cx}, ${d.cy}) scale(1.01)`)
            .style('fill', 'transparent').style('cursor', 'pointer').style('pointer-events', 'all')
            .on('mousemove', (event) => {
                this.tooltipContainer.style('visibility', 'visible')
                    .style('top', (event.pageY - 10) + 'px').style('left', (event.pageX + 40) + 'px');
            })
            .on('mouseover', (event, d) => {
                const text = this.getTooltipText(d);
                this.tooltipContainer.text(text);
            })
            .on('mouseout', () => this.tooltipContainer.style('visibility', 'hidden'))
            .on('click', (event, d) => {
                event.stopPropagation();
                this.currentSelectedHex = d;

                const hl = this.layers['highlight-overlay'].group;
                hl.selectAll('*').remove();
                hl.append('polygon')
                    .attr('points', d.points.map(p => p.join(',')).join(' '))
                    .attr('fill', 'none').attr('stroke', 'cyan').attr('stroke-width', 4);

                const infoWindow = document.getElementById('info-window');
                const infoContent = document.getElementById('info-content');
                if (infoWindow && infoContent) {
                    infoContent.innerHTML = getInfoText(d);
                    infoWindow.classList.remove('hidden');
                }
            });
    }

    // ================================================================
    // Updates
    // ================================================================

    redrawClimate(allHexes) {
        this.hexes = allHexes;
        this.updateAllHexColors();
        this.resetBlockRenderStatus();
        this.updateVisibleBlocks(this.currentTransform);
        this.updateMinimap();
    }

    resetBlockRenderStatus() {
        this.blocks.forEach(b => b.rendered = false);
    }

    updateMinimap() {
        if (!this.minimapSvg) return;
        const width = 200, height = 200;
        const mapCols = config.COLS;
        const mapRows = config.ROWS;
        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;
        const mapTotalWidth = (mapCols * hexWidth * 3 / 4);
        const mapTotalHeight = (mapRows * hexHeight);
        const scale = Math.min(width / mapTotalWidth, height / mapTotalHeight);

        // Use simplified data for minimap (e.g. 1/10th or just colors)
        // With large map, rendering all hexes in minimap is heavy.
        // For now, implementing basic logic assuming hexes are available.
        // If hexes are global, great.

        const g = this.minimapSvg.select('#minimap-terrain');
        g.selectAll('.minimap-hex').data(this.hexes.filter((d, i) => i % 10 === 0)) // Sample
            .join('rect').attr('class', 'minimap-hex')
            .attr('x', d => d.cx * scale).attr('y', d => d.cy * scale)
            .attr('width', hexWidth * scale).attr('height', hexHeight * scale)
            .attr('fill', d => d._displayColor || '#000');
    }

    updateMinimapViewport() {
        if (!this.minimapViewport) return;
        // Logic to update viewport rect based on transform
    }
}
