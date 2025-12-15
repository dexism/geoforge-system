import * as config from './config.js';
import * as d3 from 'd3';

export class JapanOverlay {
    constructor() {
        // Simplified Japan Coordinates (Lat, Lon) for reference borders
        this.polygons = [
            // Kyushu
            [[31.2, 130.3], [32.5, 129.8], [33.8, 129.5], [34.0, 131.0], [33.5, 131.8], [31.4, 131.4]],
            // Shikoku
            [[32.9, 132.5], [33.5, 132.0], [34.3, 133.0], [34.5, 134.5], [33.8, 134.7], [33.3, 134.2]],
            // Honshu
            [[34.0, 130.9], [34.5, 131.5], [35.5, 133.0], [35.6, 135.0], [34.6, 135.5], [34.5, 137.0], 
             [35.0, 138.5], [35.1, 139.6], [35.6, 140.8], [36.5, 140.8], [38.0, 141.0], [40.0, 142.0], 
             [41.5, 141.5], [41.2, 140.2], [40.0, 139.8], [39.0, 139.5], [38.0, 138.5], [37.0, 137.0], 
             [36.5, 136.0], [35.5, 135.5]],
            // Hokkaido
            [[41.4, 140.0], [41.8, 139.8], [43.0, 140.5], [45.5, 142.0], [44.0, 145.0], [43.0, 145.5], 
             [42.0, 143.0], [42.0, 141.0]]
        ];
        
        // GSI Tiles (Standard)
        // https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png
        this.tileUrlTemplate = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
        
        // Attribution
        this.attribution = "出典：国土地理院 (Geospatial Information Authority of Japan)";
    }

    /**
     * @param {Object} g - D3 selection to draw into
     * @param {CoordinateSystem} coordSys
     * @param {number} width - Viewport width
     * @param {number} height - Viewport height
     */
    draw(g, coordSys, width, height) {
        g.selectAll('*').remove(); 
        
        // 1. Determine Visible bounds in World Coordinates + Buffer
        // We buffer significantly (1.0x width/height) to support panning without immediate blanks
        const bufferFactor = 0.5;
        const origin = coordSys.getOrigin();
        
        const vLeft = 0 - width * bufferFactor;
        const vRight = width + width * bufferFactor;
        const vTop = 0 - height * bufferFactor;
        const vBottom = height + height * bufferFactor;

        const pTopLeft = coordSys.fromView(vLeft, vTop);
        const pBottomRight = coordSys.fromView(vRight, vBottom);
        
        // 2. Convert to Lat/Lon
        // Note: Y is inverted relative to Lat. Smaller Y = North (Higher Lat).
        const minLon = this.getLon(pTopLeft.x);
        const maxLat = this.getLat(pTopLeft.y);
        const maxLon = this.getLon(pBottomRight.x);
        const minLat = this.getLat(pBottomRight.y);

        // 3. Determine Zoom Level
        // Ideal: 1 tile pixel approx 1 screen pixel?
        // At Scale 1.0:
        // World 1.8 deg = BlockPX (~700 px).
        // deg/px = 1.8 / 700 = 0.0025.
        // GSI Tile Z=0 covers 360 deg in 256 px -> 1.4 deg/px.
        // Z=n covers 360 / 2^n deg in 256 px.
        // Res = 360 / (256 * 2^n) deg/px.
        // Target 0.0025.
        // 2^n = 360 / (256 * 0.0025) = 360 / 0.64 = 562.
        // n = log2(562) ~ 9.1.
        // So Zoom Level ~9 is basic suitable level.
        // Adjust by current transform scale?
        // Passed 'width/height' are viewport size. Scale is handled by D3 zoom transform on the group <g>.
        // Wait, 'coordSys.fromView' accounts for ORIGIN shift, but does NOT account for Scale if we are talking about MapView logic.
        // BUT, MapView applies transform to the group 'g' where this layer lives.
        // So we draw "World Pixels". The user zooms in on these pixels.
        // If user zooms to 2.0x, the pixels get 2x bigger.
        // If we draw fixed-resolution images, they will get blurry.
        // Ideally we should know the current scale to pick the right tile Zoom.
        // BUT 'draw' is called on *recenter* or *manual update*.
        // If we want high-res tiles at high zoom, we need `k`.
        // 'coordSys' doesn't know 'k'.
        // Assuming we draw at "Native World Resolution" (Zoom=1).
        
        const zoomLevel = 9; // Fix to 9 for now (approx correct for Block scale).
        
        // 4. Generate Tile List
        const tiles = this.getTiles(zoomLevel, minLon, minLat, maxLon, maxLat);
        
        // 5. Draw Tiles
        // We draw images mapped to World Coordinates.
        const tileGroup = g.append('g').attr('class', 'gsi-tiles');
        
        tileGroup.selectAll('image')
            .data(tiles)
            .enter()
            .append('image')
            .attr('x', d => d.wx - origin.x)
            .attr('y', d => d.wy - origin.y)
            .attr('width', d => d.ww)
            .attr('height', d => d.wh)
            .attr('href', d => d.url)
            .attr('preserveAspectRatio', 'none') // Stretch to fit the rect
            .attr('opacity', 1.0);

        // 6. Draw Polygons (Red Lines) on top
        const line = d3.line()
            .x(d => this.getGlobalX(d[1]) - origin.x)
            .y(d => this.getGlobalY(d[0]) - origin.y)
            .curve(d3.curveLinearClosed);

        g.append('g').attr('class', 'japan-borders')
            .selectAll('path')
            .data(this.polygons)
            .enter()
            .append('path')
            .attr('d', line)
            .attr('fill', 'none')
            .attr('stroke', 'red')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
            .style('pointer-events', 'none');
            
        // 7. Attribution
        g.append('text')
            .attr('x', width - 10)
            .attr('y', height - 10)
            .attr('text-anchor', 'end')
            .attr('fill', 'black')
            .attr('font-size', '10px')
            .style('text-shadow', '1px 1px 0 #fff')
            .text(this.attribution);
    }

    /**
     * Get list of GSI tiles covering the lat/lon bbox
     */
    getTiles(z, minLon, minLat, maxLon, maxLat) {
        // Clamp Lat for Web Mercator
        const MAX_LAT = 85.0511;
        const clampLat = l => Math.max(-MAX_LAT, Math.min(MAX_LAT, l));
        
        const bounds = {
            n: clampLat(maxLat),
            s: clampLat(minLat),
            w: minLon,
            e: maxLon
        };

        const tiles = [];
        
        // Convert bounds to Tile X/Y ranges
        const nw = this.lonLatToTile(bounds.w, bounds.n, z);
        const se = this.lonLatToTile(bounds.e, bounds.s, z);
        
        const minTx = Math.floor(nw.x);
        const maxTx = Math.floor(se.x);
        const minTy = Math.floor(nw.y);
        const maxTy = Math.floor(se.y);

        for (let x = minTx; x <= maxTx; x++) {
            for (let y = minTy; y <= maxTy; y++) {
                // Calculate bounds of this tile in Lat/Lon
                const tileNw = this.tileToLonLat(x, y, z);
                const tileSe = this.tileToLonLat(x + 1, y + 1, z);
                
                // Map to World Coordinates (Pixels)
                // Note: tileNw.lat is North (higher), tileSe.lat is South (lower)
                const wx1 = this.getGlobalX(tileNw.lon);
                const wy1 = this.getGlobalY(tileNw.lat); // GlobalY for North Lat (Standard Y is smaller)
                
                const wx2 = this.getGlobalX(tileSe.lon);
                const wy2 = this.getGlobalY(tileSe.lat); // GlobalY for South Lat (Standard Y is larger)
                
                // Rect Dimensions
                // X increases East (Left to Right)
                // Y increases South (Top to Bottom) in World Pixels
                // So wy1 < wy2 usually.
                
                tiles.push({
                    x: x, y: y, z: z,
                    url: this.tileUrlTemplate
                        .replace('{z}', z)
                        .replace('{x}', x)
                        .replace('{y}', y),
                    wx: wx1,
                    wy: wy1,
                    ww: wx2 - wx1,
                    wh: wy2 - wy1
                });
            }
        }
        return tiles;
    }
    
    // --- Mercator Helpers ---
    
    lonLatToTile(lon, lat, z) {
        const rad = lat * Math.PI / 180;
        const n = Math.pow(2, z);
        const xtile = n * ((lon + 180) / 360);
        const ytile = n * (1 - (Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI)) / 2;
        return { x: xtile, y: ytile };
    }
    
    tileToLonLat(xtile, ytile, z) {
        const n = Math.pow(2, z);
        const lon = xtile / n * 360.0 - 180.0;
        const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * ytile / n)));
        const lat = lat_rad * 180.0 / Math.PI;
        return { lon: lon, lat: lat };
    }

    // --- Coordinate Converters (Copied/Kept from before) ---

    getGlobalX(lon) {
        const blockE = lon / 1.8;
        const hexSize = config.r;
        const CORE_COLS = 23;
        const pixelPerBlockX = CORE_COLS * (2 * hexSize * 0.75); // ~690 px
        return blockE * pixelPerBlockX;
    }

    getLon(worldX) {
        const hexSize = config.r;
        const CORE_COLS = 23;
        const pixelPerBlockX = CORE_COLS * (2 * hexSize * 0.75);
        const blockE = worldX / pixelPerBlockX;
        return blockE * 1.8;
    }

    getGlobalY(lat) {
        const blockN = 50 + (lat / 1.8);
        const hexSize = config.r;
        const hexHeight = Math.sqrt(3) * hexSize;
        const CORE_ROWS = 20;
        const pixelPerBlockY = CORE_ROWS * hexHeight; // ~692 px
        const relativeBy = 99 - blockN;
        return relativeBy * pixelPerBlockY;
    }

    getLat(worldY) {
        const hexSize = config.r;
        const hexHeight = Math.sqrt(3) * hexSize;
        const CORE_ROWS = 20;
        const pixelPerBlockY = CORE_ROWS * hexHeight;
        const relativeBy = worldY / pixelPerBlockY;
        const blockN = 99 - relativeBy;
        const lat = (blockN - 50) * 1.8;
        return lat;
    }
}
