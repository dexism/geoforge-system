
// Mock config
const config = {
    COLS: 10,
    ROWS: 10,
    HEX_AREA_HA: 86.6,
};

// Mock Maps (Simplified from main.js)
const KEY_MAP = {
    isWater: 'w',
    elevation: 'el',
    vegetation: 'v',
    vegetationAreas: 'va',
    ships: 'shp_o',
    ridgeFlow: 'rf',
    ridgeUpstreamIndex: 'rui',
    landUse: 'lu',
    'landUse.river': 'lu_r',
    'landUse.desert': 'lu_d',
    'landUse.barren': 'lu_b',
    'landUse.grassland': 'lu_g',
    'landUse.forest': 'lu_f',
    'landUse.beach': 'lu_be',
};

const REVERSE_KEY_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));
const DICTIONARY_KEYS = ['v'];
const INDUSTRY_LEVEL_MAP = { 'primary': 'p' };
const REVERSE_INDUSTRY_LEVEL_MAP = { 'p': 'primary' };
const INDUSTRY_ITEM_MAP = { 'wheat': 'wh' };
const REVERSE_INDUSTRY_ITEM_MAP = { 'wh': 'wheat' };

// Mock compress/decompress functions based on main.js changes
function compressWorldData(worldData) {
    if (!worldData || !worldData.allHexes) return null;

    const dictionaries = {};
    DICTIONARY_KEYS.forEach(k => dictionaries[k] = []);

    const getDictIndex = (key, value) => {
        if (value === null || value === undefined) return null;
        let idx = dictionaries[key].indexOf(value);
        if (idx === -1) {
            idx = dictionaries[key].length;
            dictionaries[key].push(value);
        }
        return idx;
    };

    const compressNestedObject = (obj) => {
        if (!obj) return null;
        const compressed = {};
        Object.entries(obj).forEach(([k, v]) => {
            const shortKey = INDUSTRY_ITEM_MAP[k] || k;
            if (typeof v === 'number') {
                compressed[shortKey] = Math.round(v * 1000);
            } else if (typeof v === 'object' && v !== null) {
                compressed[shortKey] = compressNestedObject(v);
            } else {
                compressed[shortKey] = v;
            }
        });
        if (Object.keys(compressed).length === 0) return null;
        return compressed;
    };

    const compressedHexes = worldData.allHexes.map(h => {
        const cHex = {};
        const keysToProcess = Object.keys(KEY_MAP).filter(k => !k.includes('.'));
        keysToProcess.push('landUse');

        keysToProcess.forEach(key => {
            const value = h.properties[key];

            if (key === 'landUse' && value) {
                if (value.river > 0) cHex[KEY_MAP['landUse.river']] = parseFloat(value.river.toFixed(2));
                if (value.beach > 0) cHex[KEY_MAP['landUse.beach']] = parseFloat(value.beach.toFixed(2));
                return;
            }

            // KEY CHANGE: ships
            if (key === 'ships' && value) {
                // Simple copy for ships as per main.js logic (it's not nested compressed in main.js snippet? wait, let me check main.js snippet)
                // In main.js step 53: 
                // if (originalKey === 'ships') { props.ships = v; return; } in restore
                // So in compress, we just assign it?
                // In main.js compress loop:
                // if (typeof value === 'object' && Object.keys(value).length === 0) return;
                // cHex[shortKey] = value;  -> This handles it if not special cased.
                // ship numbers are integers, so they pass through.
            }

            if (key === 'vegetationAreas' && value) {
                const cVa = compressNestedObject(value);
                if (cVa) cHex[KEY_MAP['vegetationAreas']] = cVa;
                return;
            }

            const shortKey = KEY_MAP[key];
            if (!shortKey) return;
            if (value === null || value === undefined) return;
            // logic to skip default values...

            // Logic to skip recalculatable data EXCEPT what we now want
            // if (key === 'livingConditions' ...) return; 
            // We REMOVED vegetationAreas from exclusion.

            if (typeof value === 'object' && Object.keys(value).length === 0) return;

            if (DICTIONARY_KEYS.includes(shortKey)) {
                cHex[shortKey] = getDictIndex(shortKey, value);
            } else if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    cHex[shortKey] = value;
                } else {
                    cHex[shortKey] = parseFloat(value.toFixed(2));
                }
            } else {
                cHex[shortKey] = value;
            }
        });
        return cHex;
    });

    return {
        version: 2,
        cols: config.COLS,
        rows: config.ROWS,
        dicts: dictionaries,
        hexes: compressedHexes,
        roads: []
    };
}

function processLoadedData(loadedData) {
    const dicts = loadedData.dicts;
    const getDictValue = (key, idx) => dicts[key][idx];

    const decompressNestedObject = (obj) => {
        if (!obj) return null;
        const decompressed = {};
        Object.entries(obj).forEach(([k, v]) => {
            const originalKey = REVERSE_INDUSTRY_ITEM_MAP[k] || k;
            if (typeof v === 'number') {
                decompressed[originalKey] = v / 1000;
            } else if (typeof v === 'object' && v !== null) {
                decompressed[originalKey] = decompressNestedObject(v);
            } else {
                decompressed[originalKey] = v;
            }
        });
        return decompressed;
    };

    return loadedData.hexes.map((h, index) => {
        const props = {};
        Object.entries(h).forEach(([k, v]) => {
            const originalKey = REVERSE_KEY_MAP[k];
            if (!originalKey) return;

            if (originalKey === 'ships') {
                props.ships = v;
                return;
            }

            if (originalKey === 'vegetationAreas') {
                props.vegetationAreas = decompressNestedObject(v);
                return;
            }

            if (DICTIONARY_KEYS.includes(k)) {
                props[originalKey] = getDictValue(k, v);
            } else {
                props[originalKey] = v;
            }
        });
        return { properties: props };
    });
}

// TEST
const testHex = {
    properties: {
        isWater: false,
        elevation: 100,
        vegetation: 'Forest',
        vegetationAreas: { forest: 50.5, beach: 10.2 },
        ships: { 'Small Boat': 5, 'Large Ship': 1 },
        ridgeFlow: 15,
        ridgeUpstreamIndex: 2,
        landUse: { beach: 0.1 }
    }
};

const worldData = { allHexes: [testHex] };

console.log("Original:", JSON.stringify(testHex.properties, null, 2));

const compressed = compressWorldData(worldData);
console.log("Compressed:", JSON.stringify(compressed, null, 2));

const restoredHexes = processLoadedData(compressed);
const restored = restoredHexes[0].properties;
console.log("Restored:", JSON.stringify(restored, null, 2));

// Checks
let pass = true;
if (restored.ships['Small Boat'] !== 5) { console.error("FAIL: ships not restored"); pass = false; }
if (restored.ships['Large Ship'] !== 1) { console.error("FAIL: ships not restored"); pass = false; }
if (Math.abs(restored.vegetationAreas.beach - 10.2) > 0.01) { console.error("FAIL: vegetationAreas beach not restored"); pass = false; }
if (restored.ridgeFlow !== 15) { console.error("FAIL: ridgeFlow not restored"); pass = false; }
if (restored.ridgeUpstreamIndex !== 2) { console.error("FAIL: ridgeUpstreamIndex not restored"); pass = false; }

if (pass) console.log("SUCCESS: All persistence checks passed.");
