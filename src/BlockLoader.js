// ================================================================
// GeoForge System - Block Loader
// ================================================================

import * as config from './config.js';
import * as blockUtils from './BlockUtils.js';
import * as utils from './utils.js';
import { WorldMap } from './WorldMap.js';

// Cache for loaded blocks
const loadedBlocks = new Map(); // blockId -> { hexes: [], roads: [] }

/**
 * Loads the initial block (and neighbors potentially) to start the application.
 * @param {string} initialBlockId 
 * @param {Function} addLogMessage 
 * @returns {Promise<Object>} Partial WorldMap data structure for initial render
 */
export async function loadInitialBlock(initialBlockId = '50_73', addLogMessage) {
    if (addLogMessage) await addLogMessage(`初期ブロック(${initialBlockId})を読み込んでいます...`);

    // In a real scenario, this fetches from Server/File.
    // For now, if we are in "Monolithic Mode" (Loaded from GAS as whole), we filter.
    // But the architecture goal is to fetch individual files.

    // If we are running locally with generated zip, we can't easily fetch unless unzipped.
    // If we are loading from GAS, we can use the `blockId` param I added to code.gs.

    // Let's assume GAS context for "Real" loading.
    const gasUrl = config.GAS_WEB_APP_URL; // Assuming config has it, or pass it.
    // config.js doesn't have GAS URL usually (it's in main.js).
    // so we might need to pass the URL or fetch method.

    return fetchBlockFromGAS(initialBlockId, addLogMessage);
}

/**
 * Fetches a specific block from GAS.
 * @param {string} blockId 
 * @param {Function} addLogMessage 
 */
export async function fetchBlockFromGAS(blockId, addLogMessage) {
    // We need the Global GAS URL. 
    // Importing from main.js is circular if main imports this.
    // Better to have URL passed or in config. 
    // For now, hardcoded or passed.

    // Quick hack: Use the global variable if available (window) or hardcode.
    // main.js defines it as const.
    // We should allow passing it.

    // Mocking the fetch for now if no URL provided?
    // This function assumes called from main.js which knows the URL.
}

/**
 * Merges a loaded block into the global WorldMap.
 * @param {Object} worldData Global WorldData object
 * @param {Object} blockData Data for the block (hexes, roads)
 */
export function mergeBlockIntoWorld(worldData, blockData) {
    if (!blockData) return;

    // Ensure WorldMap dimensions (should be Global)
    if (!worldData.allHexes) {
        worldData.allHexes = new WorldMap(config.COLS, config.ROWS);
    }

    // Merge Hexes
    if (blockData.hexes) {
        // Block Hexes might be compressed or raw?
        // If coming from GAS `doGet` with `blockId` filter, they are "Compressed Rows" usually.
        // So we need to Decompress them using `main.js` logic? 
        // Or `BlockLoader` should handle decompression?

        // If we use the standard `processLoadedData` in main.js, it handles the whole response.
        // So `fetchBlockFromGAS` should return the JSON, and `main.js` calls `processLoadedData`.

        // `processLoadedData` (V2) iterates `loadedData.hexes`.
        // If `loadedData.hexes` only contains hexes for one block, `processLoadedData` will just populate those.
        // This effectively "Merges" because `worldData.allHexes` is a fixed array (TypedArray backed in WorldMap, 
        // though `main.js` currently initializes it).

        // Crucial: `processLoadedData` does `worldData.allHexes = new WorldMap(...)`.
        // This WIPES existing data.
        // We need `processLoadedData` to be capable of *Incremental Load*.

        // Refactoring `processLoadedData` in main.js to support merging is better than doing it here.
    }
}
