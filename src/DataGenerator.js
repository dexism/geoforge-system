import JSZip from 'jszip';
import * as d3 from 'd3';
import { blockToGlobal } from './BlockUtils.ts';
import { classifyClimate, CLIMATE_RETENTION_PARAMS } from './continentGenerator.js';

// Climate Reference Points (Approximate Annual Averages)
// Lat, Lon, Temp(C), Precip(mm/year), Elevation(m)
const CLIMATE_STATIONS = [
    { name: 'Sapporo', lat: 43.06, lon: 141.35, temp: 8.9, precip: 1100, elev: 17 },
    { name: 'Nemuro', lat: 43.33, lon: 145.58, temp: 6.3, precip: 1050, elev: 25 },
    { name: 'Aomori', lat: 40.82, lon: 140.75, temp: 10.4, precip: 1300, elev: 6 },
    { name: 'Sendai', lat: 38.26, lon: 140.87, temp: 12.4, precip: 1250, elev: 39 },
    { name: 'Niigata', lat: 37.91, lon: 139.02, temp: 13.9, precip: 1800, elev: 2 },
    { name: 'Tokyo', lat: 35.68, lon: 139.76, temp: 15.4, precip: 1500, elev: 6 },
    { name: 'Kanazawa', lat: 36.56, lon: 136.65, temp: 14.6, precip: 2400, elev: 27 },
    { name: 'Nagoya', lat: 35.18, lon: 136.91, temp: 15.8, precip: 1550, elev: 51 },
    { name: 'Osaka', lat: 34.69, lon: 135.50, temp: 16.9, precip: 1300, elev: 12 },
    { name: 'Hiroshima', lat: 34.38, lon: 132.45, temp: 16.1, precip: 1500, elev: 5 },
    { name: 'Kochi', lat: 33.56, lon: 133.53, temp: 17.0, precip: 2500, elev: 1 },
    { name: 'Fukuoka', lat: 33.59, lon: 130.40, temp: 17.0, precip: 1600, elev: 3 },
    { name: 'Kagoshima', lat: 31.59, lon: 130.55, temp: 18.6, precip: 2200, elev: 4 },
    { name: 'Naha', lat: 26.21, lon: 127.68, temp: 23.1, precip: 2000, elev: 8 },
    { name: 'Chichijima', lat: 27.09, lon: 142.19, temp: 23.2, precip: 1200, elev: 7 },
    { name: 'Wakkanai', lat: 45.41, lon: 141.67, temp: 6.5, precip: 1160, elev: 3 }
];

export class DataGenerator {
    constructor() {
        this.progressCallback = null;
        this.elevationCache = new Map();
    }

    /**
     * Start the generation process
     * @param {Function} onProgress - Callback for progress updates (messge, current, total)
     */
    async generateJapanData(onProgress) {
        this.progressCallback = onProgress;
        this.log("Starting Japan Data Generation...");

        // 1. Identify Blocks
        const blocks = this.identifyJapanBlocks();
        this.log(`Identified ${blocks.length} blocks covering Japan.`);

        const zip = new JSZip();

        // 2. Process Each Block
        let completed = 0;
        let skipped = 0;
        for (const block of blocks) {
            const data = await this.generateBlockData(block.ee, block.nn);

            if (!data) {
                // Ocean only block, skip
                skipped++;
                completed++;
                if (this.progressCallback) {
                    this.progressCallback(`Skipped Ocean: map_${block.ee}_${block.nn}`, completed, blocks.length);
                }
                continue;
            }

            const fileName = `map_${String(block.ee).padStart(2, '0')}_${String(block.nn).padStart(2, '0')}.json`;
            const content = JSON.stringify(data, null, 2);
            zip.file(fileName, content);

            completed++;
            if (this.progressCallback) {
                this.progressCallback(`Processed: ${fileName}`, completed, blocks.length);
            }
        }

        // 3. Generate Zip
        this.log(`Generating ZIP file... (Total: ${blocks.length}, Skipped: ${skipped})`);
        const blob = await zip.generateAsync({ type: "blob" });
        this.downloadBlob(blob, "japan_blocks_data.zip");
        this.log("Done!");
    }

    log(msg) {
        console.log(`[DataGenerator] ${msg}`);
        if (this.progressCallback) {
            this.progressCallback(msg);
        }
    }

    // --- Core Logic ---

    identifyJapanBlocks() {
        // Japan Bounding Box (Approximate for testing)
        // Lat: 24 (Okinawa) to 46 (Hokkaido) -> NN
        // Lon: 122 (Yonaguni) to 154 (Minamitori) -> EE

        // GeoForge NN:
        // Equator is N50 (Lat 0)
        // Lat 24 -> N50 + (24 / 1.8) = N50 + 13.3 = N63
        // Lat 46 -> N50 + (46 / 1.8) = N50 + 25.5 = N75

        // Let's generate a slightly wider range to be safe
        const blocks = [];
        for (let nn = 60; nn <= 78; nn++) {
            for (let ee = 65; ee <= 85; ee++) {
                blocks.push({ ee, nn });
            }
        }
        return blocks;
    }

    async generateBlockData(ee, nn) {
        const hexes = [];
        const COLS = 25;
        const ROWS = 22;

        let hasLand = false;

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const coords = this.getHexCenterLatLon(ee, nn, c, r);
                const elev = await this.getElevation(coords.lat, coords.lon);

                // Determine if water based on elevation (GSI 'e' or <= 0)
                const isWater = elev <= 0;
                if (!isWater) hasLand = true;

                const climate = this.getClimate(coords.lat, coords.lon, elev);
                const climateZone = classifyClimate(climate.temp, climate.precip, elev);
                const terrainType = this.determineTerrainType(elev, isWater);
                const vegetation = this.determineVegetation(climateZone, terrainType, climate.temp, climate.precip, elev, isWater);

                // Construct Hex Data
                // w: false is REQUIRED because WorldMap defaults to Water (1).
                const hexData = {
                    c: c,
                    r: r,
                    el: Math.round(elev),
                    w: isWater,
                    t: Math.round(climate.temp * 10) / 10,
                    pm: Math.round(climate.precip),
                    cz: climateZone,
                    tt: terrainType,
                    v: vegetation
                };

                if (hexData.w === true) {
                    // If water, we can omit w if default is water?
                    // No, let's be explicit if possible, or follow standard.
                    // Actually, if default is Water, 'w:true' is redundant.
                    delete hexData.w;
                } else {
                    // If Land (w=false), we MUST keep it to override default.
                    // So: Keep w:false. Delete w:true.
                }

                hexes.push(hexData);
            }
        }

        // If the entire block is ocean, return null to skip
        if (!hasLand) return null;

        return this.compressBlockData(ee, nn, hexes);
    }

    addDerivedVisualProps(hex, veg) {
        // Mock Vegetation Areas (va) and LandUse (lu_*) based on dominant vegetation
        // This ensures the frontend has necessary data for rendering
        const totalHa = 8660; // Approx hex area
        const va = {
            des: 0, was: 0, gra: 0, wet: 0, t_for: 0, s_for: 0, tr_for: 0,
            alp: 0, tun: 0, sav: 0, ste: 0, coa: 0, iceSnow: 0, wat: 0
        };

        // Land Use keys
        hex.lu_d = 0; hex.lu_b = 0; hex.lu_g = 0; hex.lu_f = 0; hex.lu_r = 0;

        switch (veg) {
            case '砂漠': va.des = totalHa; hex.lu_d = 1.0; break;
            case '荒れ地': va.was = totalHa; hex.lu_b = 1.0; break;
            case '草原': va.gra = totalHa; hex.lu_g = 1.0; break;
            case 'ステップ': va.ste = totalHa; hex.lu_g = 1.0; break;
            case 'サバンナ': va.sav = totalHa; hex.lu_g = 1.0; break;
            case '温帯林': va.t_for = totalHa; hex.lu_f = 1.0; break;
            case '亜寒帯林': va.s_for = totalHa; hex.lu_f = 1.0; break;
            case '熱帯雨林': va.tr_for = totalHa; hex.lu_f = 1.0; break;
            case '湿地': va.wet = totalHa; hex.lu_g = 0.5; hex.lu_r = 0.5; break;
            case 'アルパイン': va.alp = totalHa; hex.lu_b = 1.0; break;
            case 'ツンドラ': va.tun = totalHa; hex.lu_b = 1.0; break;
            case '氷雪帯': va.iceSnow = totalHa; hex.lu_b = 1.0; break;
            case '湖沼': va.wat = totalHa; hex.lu_r = 1.0; break;
            case '海洋': va.wat = totalHa; hex.lu_r = 1.0; break;
            case '深海': va.wat = totalHa; hex.lu_r = 1.0; break;
            default: va.gra = totalHa; hex.lu_g = 1.0;
        }

        hex.va = va;
    }

    compressBlockData(ee, nn, hexArray) {
        const dictionaries = {
            cz: [], v: [], tt: [] // keys only if used
        };
        const getDictId = (dictName, val) => {
            if (val === undefined || val === null) return null;
            let idx = dictionaries[dictName].indexOf(val);
            if (idx === -1) {
                idx = dictionaries[dictName].length;
                dictionaries[dictName].push(val);
            }
            return idx;
        };

        const compressedHexes = hexArray.map(h => {
            const c = { ...h };
            if (c.cz) c.cz = getDictId('cz', c.cz);
            if (c.v) c.v = getDictId('v', c.v);
            if (c.tt) c.tt = getDictId('tt', c.tt);

            // Ensure w:false is preserved
            // Logic above: w is boolean.
            // If w is true (Water), I deleted it. Output: w undefined. Loader: isWater unchanged (1). Correct.
            // If w is false (Land), I kept it. Output: w:false. Loader: isWater = false. Correct.

            return c;
        });

        return {
            id: `map_${ee}_${nn}`,
            version: "2.2", // Match user version
            timestamp: Date.now(),
            dictionaries: dictionaries,
            hexes: compressedHexes
        };
    }

    // --- Derived Logic ---

    determineTerrainType(elev, isWater) {
        if (isWater) {
            if (elev < -500) return '深海'; // Deep Ocean
            if (elev <= 0) return '海洋'; // Ocean
            return '湖沼'; // Lake (if marked isWater but > 0, though GSI data elev<=0 is sea)
        }
        if (elev < 100) return '平地';
        if (elev < 500) return '丘陵';
        if (elev < 1500) return '山地';
        return '山岳';
    }

    /**
     * Determines dominant vegetation based on climate and terrain.
     * Uses mappings consistent with GeoForge logic.
     */
    determineVegetation(cz, tt, temp, precip, elev, isWater) {
        if (isWater) {
            if (elev < -200) return '深海'; // Deep Sea
            return '海洋';
        }
        if (tt === '山岳' || elev > 2500) return 'アルパイン'; // Alpine
        if (tt === '山地' && elev > 2000) return '亜寒帯林'; // Boreal logic

        // Using same switch as previous version
        switch (cz) {
            case '氷雪気候': return '氷雪帯';
            case 'ツンドラ気候': return 'ツンドラ';
            case '砂漠気候(熱)': return '砂漠';
            case '砂漠気候(寒)': return '荒れ地'; // Cold desert -> wasteland/barren
            case 'ステップ気候': return 'ステップ';
            case '熱帯雨林気候': return '熱帯雨林';
            case '熱帯草原気候': return 'サバンナ';
            case '亜寒帯湿潤気候': return '亜寒帯林';
            case '亜寒帯乾燥気候': return '亜寒帯林'; // Conifers
            case '温暖湿潤気候':
            case '地中海性気候':
            case '亜熱帯湿潤気候':
                // Temperate/Subtropical
                if (precip > 1000) return '温帯林';
                if (precip > 500) return '草原';
                return '荒れ地'; // Dry temperate
            default: return '草原'; // Fallback
        }
    }

    // --- Coordinate Calculation ---

    getHexCenterLatLon(ee, nn, q, r) {
        // Reverting to the logic that the User said was CORRECT.
        // N60-78.

        const lonStart = ee * 1.8;
        const latStart = (nn - 50) * 1.8;

        const COLS = 25;
        const ROWS = 22;

        const lon = lonStart + (q / COLS) * 1.8;
        // latStart is Bottom (South). r=0 is Top (North).
        // so r=0 -> latStart + 1.8
        const lat = (latStart + 1.8) - (r / ROWS) * 1.8;

        return { lat, lon };
    }

    // --- Elevation (GSI Tiles) ---
    // URL: https://cyberjapandata.gsi.go.jp/xyz/demgm/{z}/{x}/{y}.txt
    // demgm max zoom = 8.

    async getElevation(lat, lon) {
        const z = 8;
        const tile = this.lonLatToTile(lon, lat, z);
        const tx = Math.floor(tile.x);
        const ty = Math.floor(tile.y);

        const key = `${z}/${tx}/${ty}`;

        let grid = this.elevationCache.get(key);
        if (!grid) {
            grid = await this.fetchTile(z, tx, ty);
            this.elevationCache.set(key, grid);
        }

        if (!grid) return -1000; // Error or sea

        // Pixel within tile
        const px = Math.floor((tile.x - tx) * 256);
        const py = Math.floor((tile.y - ty) * 256);

        const val = grid[py * 256 + px];
        return val === undefined || val === 'e' ? -100 : parseFloat(val); // 'e' is usually no-data (water) in GSI
    }

    async fetchTile(z, x, y) {
        const url = `https://cyberjapandata.gsi.go.jp/xyz/demgm/${z}/${x}/${y}.txt`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const text = await resp.text();
            // content is "val,val,val..." (256*256 items)? Or CSV lines?
            // GSI txt tile often: each value separated by comma, line break?
            // Actually it is often just pure CSV-like text, line breaks might distinguish rows.
            // Let's check GSI specs. Usually it's ONE line or 256 lines.
            // Safe parse: split by any whitespace or comma.

            // Note: Standard GSI txt is often 256 rows, each has 256 cols comma separated.
            // Let's replace newlines with commas and split.
            const clean = text.replace(/\r?\n/g, ',');
            const values = clean.split(',').map(s => s.trim()).filter(s => s !== '');
            return values; // Array of 65536 items
        } catch (e) {
            console.warn(`Failed to fetch tile ${url}`, e);
            return null;
        }
    }

    lonLatToTile(lon, lat, z) {
        const rad = lat * Math.PI / 180;
        const n = Math.pow(2, z);
        const xtile = n * ((lon + 180) / 360);
        const ytile = n * (1 - (Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI)) / 2;
        return { x: xtile, y: ytile };
    }

    // --- Climate Interpolation ---
    // IDW (Inverse Distance Weighting)

    getClimate(lat, lon, elev) {
        let nomTemp = 0, denTemp = 0;
        let nomPre = 0, denPre = 0;

        const p = 2; // Power parameter

        for (const st of CLIMATE_STATIONS) {
            const d = this.dist(lat, lon, st.lat, st.lon);
            if (d < 0.001) return { temp: st.temp, precip: st.precip }; // Exact match

            const w = 1 / Math.pow(d, p);

            // Adjust Temp by Elevation lapse rate (0.6C / 100m)
            const elevDiff = elev - st.elev;
            const adjustedTemp = st.temp - (elevDiff / 100) * 0.65;

            nomTemp += w * adjustedTemp;
            denTemp += w;

            nomPre += w * st.precip;
            denPre += w;
        }

        const temp = nomTemp / denTemp;
        const precip = nomPre / denPre;

        return { temp, precip };
    }

    dist(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // --- Download Helper ---

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
