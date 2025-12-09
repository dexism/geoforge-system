// ================================================================
// GeoForge System - Block Utilities
// ================================================================

export const BLOCK_CORE_COLS = 23;
export const BLOCK_CORE_ROWS = 20;
export const BLOCK_PADDING = 1;

export const BLOCK_TOTAL_COLS = BLOCK_CORE_COLS + (BLOCK_PADDING * 2); // 25
export const BLOCK_TOTAL_ROWS = BLOCK_CORE_ROWS + (BLOCK_PADDING * 2); // 22

export const BLOCK_START_EE = 48;
export const BLOCK_START_NN = 71;
export const BLOCK_END_EE = 52;
export const BLOCK_END_NN = 75;

// Global map constraints
// With 5x5 blocks (23x20 core), total core size is 115x100.
// With 1-hex padding on global edges, total size is 117x102.
export const GLOBAL_OFFSET_X = 1; // Global (0,0) is padding. (1,1) is start of core data.
export const GLOBAL_OFFSET_Y = 1;

/**
 * Returns the block ID (filename compatible) for a given block coordinate.
 * @param {number} ee Longitude index (48-52)
 * @param {number} nn Latitude index (71-75)
 * @returns {string} e.g., "map_50_73"
 */
export function getBlockId(ee, nn) {
    return `map_${ee}_${nn}`;
}

/**
 * Returns the block ID from global coordinates.
 * @param {number} col Global column
 * @param {number} row Global row
 * @returns {string|null} e.g., "map_50_73" or null if out of bounds
 */
export function getBlockIdFromGlobal(col, row) {
    const coords = globalToBlock(col, row);
    if (!coords) return null;
    return getBlockId(coords.ee, coords.nn);
}

/**
 * Converts a global hex coordinate to Block coordinate system.
 * Global (0,0) is the bottom-left corner of the ENTIRE map (including global padding).
 * 
 * @param {number} globalCol Global column index (0 to 116)
 * @param {number} globalRow Global row index (0 to 101)
 * @returns {Object|null} { ee, nn, localCol, localRow } or null if out of bounds
 */
export function globalToBlock(globalCol, globalRow) {
    // 1. Adjust for global padding to get "Core" coordinates
    const coreX = globalCol - GLOBAL_OFFSET_X;
    const coreY = globalRow - GLOBAL_OFFSET_Y;

    // 2. Determine Block Index (relative to 0,0 of the block grid)
    // Note: If coreX is -1 (left padding), it belongs to the "left ghost block" or just treated as local coord -1 in the first block?
    // The spec says: "Share surrounding 2 hexes" - wait, "Block's surrounding 1 hex" (from my understanding of 25x22 vs 23x20).
    // Actually the spec says "Block has 23x20 core".
    // "Block holds 25x22 data".
    // This means a Block includes the core AND the neighbors.

    // Let's implement finding the "Primary Block" for a coordinate.
    // A coordinate might exist in multiple blocks (as padding).
    // This function returns the "Owner" block (where this hex is part of the Core).

    // Check bounds
    // Core area: 0 to 114 (115 columns), 0 to 99 (100 rows)
    // Allowed global range: 0 to 116, 0 to 101.

    const blockX = Math.floor(coreX / BLOCK_CORE_COLS);
    const blockY = Math.floor(coreY / BLOCK_CORE_ROWS);

    // Calculate EE and NN
    const ee = BLOCK_START_EE + blockX;
    const nn = BLOCK_START_NN + blockY;

    // Calculate Local Coordinates within that block
    // Local (0,0) is bottom-left of the 25x22 grid.
    // Core starts at (1,1).
    // coreX % BLOCK_CORE_COLS gives index within the core (0..22).
    // So localCol = (coreX % BLOCK_CORE_COLS) + BLOCK_PADDING.

    // Handle negative core coords (padding area)
    // If coreX = -1, math.floor(-1/23) = -1. 
    // This logic holds if we assume infinite pattern.
    // But we want to map strictly to valid blocks.

    let localCol = (coreX % BLOCK_CORE_COLS);
    if (localCol < 0) localCol += BLOCK_CORE_COLS;
    localCol += BLOCK_PADDING; // Shift to skip the left padding

    let localRow = (coreY % BLOCK_CORE_ROWS);
    if (localRow < 0) localRow += BLOCK_CORE_ROWS;
    localRow += BLOCK_PADDING;

    // Boundary Protection
    if (ee < BLOCK_START_EE || ee > BLOCK_END_EE || nn < BLOCK_START_NN || nn > BLOCK_END_NN) {
        return null; // Outside the world
    }

    return { ee, nn, localCol, localRow };
}


/**
 * Converts a Block coordinate to Global hex coordinate.
 * 
 * @param {number} ee 
 * @param {number} nn 
 * @param {number} localCol (0 to 24)
 * @param {number} localRow (0 to 21)
 * @returns {Object} { col, row }
 */
export function blockToGlobal(ee, nn, localCol, localRow) {
    const blockIndexX = ee - BLOCK_START_EE;
    const blockIndexY = nn - BLOCK_START_NN;

    const coreStartX = blockIndexX * BLOCK_CORE_COLS;
    const coreStartY = blockIndexY * BLOCK_CORE_ROWS;

    // localCol includes padding.
    // localCol 1 is the start of the core.
    const relativeCoreX = localCol - BLOCK_PADDING;
    const relativeCoreY = localRow - BLOCK_PADDING;

    const globalCoreX = coreStartX + relativeCoreX;
    const globalCoreY = coreStartY + relativeCoreY;

    // Shift by Global Offset
    const col = globalCoreX + GLOBAL_OFFSET_X;
    const row = globalCoreY + GLOBAL_OFFSET_Y;

    return { col, row };
}

/**
 * Calculates the pattern IDs for a road/river passing through a hex.
 * 
 * Pattern Definition:
 * 0-5: Center-Edge (Radiant) - Connects Edge N to Center.
 * 6-11: Edge-to-Adj (Sharp) - Connects Edge N to Edge (N+1)%6.
 * 12-17: Edge-to-Skip (Gentle) - Connects Edge N to Edge (N+2)%6.
 * 
 * @param {number} inDir Direction from previous hex (0-5). If -1, it's a start node.
 * @param {number} outDir Direction to next hex (0-5). If -1, it's an end node.
 * @returns {number[]} Array of pattern IDs.
 */
export function getPatternIds(inDir, outDir) {
    // 1. Endpoint case (Start or End of path)
    if (inDir === -1 && outDir !== -1) {
        return [outDir]; // Center -> Out
    }
    if (inDir !== -1 && outDir === -1) {
        return [inDir]; // In -> Center
    }
    if (inDir === -1 && outDir === -1) {
        return []; // Isolated point?
    }

    // 2. Through case
    // inDir is the direction TO the neighbor we came FROM? 
    // Usually path is: Prev -> Curr -> Next.
    // Neighbors input to this function should be "Direction OF the connection relative to center".
    // So if Prev is at Direction 3, inDir=3.

    // Normalize undirected connection (sorting doesn't matter for logic, but diff calc needs care)
    // We strictly use the definition:
    // Sharp Patterns:
    // 6: 0-1
    // 7: 1-2
    // 8: 2-3
    // 9: 3-4
    // 10: 4-5
    // 11: 5-0 (wrap)

    // Gentle Patterns:
    // 12: 0-2
    // 13: 1-3
    // 14: 2-4
    // 15: 3-5
    // 16: 4-0 (wrap)
    // 17: 5-1 (wrap)

    const d1 = inDir;
    const d2 = outDir;

    let diff = Math.abs(d1 - d2);
    if (diff > 3) diff = 6 - diff;

    // A. Center-Edge (Straight)
    if (diff === 0) return [d1]; // Same direction?? Loopback? Treat as center.
    if (diff === 3) return [d1, d2]; // Straight through -> Two Center-Edge lines.

    // B. Sharp Curve (Diff = 1)
    if (diff === 1) {
        // Find the "smaller" index taking wrap into account.
        // Pairs are (0,1), (1,2), (2,3), (3,4), (4,5), (5,0).
        // If (0,5), it's 5-0 -> ID 11.

        let min = Math.min(d1, d2);
        let max = Math.max(d1, d2);

        if (min === 0 && max === 5) return [11]; // Special wrap case

        // Otherwise, Base ID = 6 + min
        return [6 + min];
    }

    // C. Gentle Curve (Diff = 2)
    if (diff === 2) {
        // Pairs are (0,2), (1,3), (2,4), (3,5), (4,0), (5,1).
        // Wait, (4,0) is wrap. (5,1) is wrap.

        let min = Math.min(d1, d2);
        let max = Math.max(d1, d2);

        if (min === 0 && max === 4) return [16]; // 4-0
        if (min === 1 && max === 5) return [17]; // 5-1

        // Otherwise, Base ID = 12 + min
        return [12 + min];
    }

    return [];
}

/**
 * Calculates determine direction from h1 to h2 (0-5 Clockwise starting N).
 * Flat-Top Hexes, Odd-Q (odd columns shifted down).
 * 
 * @param {object} h1 - From Hex ({col, row})
 * @param {object} h2 - To Hex ({col, row})
 * @returns {number} 0:N, 1:NE, 2:SE, 3:S, 4:SW, 5:NW. Returns -1 if not neighbors.
 */
export function getDirection(h1, h2) {
    // Treat inputs as simple objects with col/row if needed
    const c1 = h1.col !== undefined ? h1.col : h1.x;
    const r1 = h1.row !== undefined ? h1.row : h1.y;
    const c2 = h2.col !== undefined ? h2.col : h2.x;
    const r2 = h2.row !== undefined ? h2.row : h2.y;

    const dc = c2 - c1;
    const dr = r2 - r1;
    const isOdd = (c1 % 2 !== 0);

    // Standard Odd-Q Offsets for Neighbors
    // Even Col: N(0,-1), NE(1,-1), SE(1,0), S(0,1), SW(-1,0), NW(-1,-1)
    // Odd Col:  N(0,-1), NE(1,0), SE(1,1), S(0,1), SW(-1,1), NW(-1,0)

    if (dc === 0 && dr === -1) return 0; // N
    if (dc === 0 && dr === 1) return 3; // S

    if (isOdd) {
        if (dc === 1 && dr === 0) return 1; // NE
        if (dc === 1 && dr === 1) return 2; // SE
        if (dc === -1 && dr === 1) return 4; // SW
        if (dc === -1 && dr === 0) return 5; // NW
    } else {
        if (dc === 1 && dr === -1) return 1; // NE
        if (dc === 1 && dr === 0) return 2; // SE
        if (dc === -1 && dr === 0) return 4; // SW
        if (dc === -1 && dr === -1) return 5; // NW
    }

    return -1;
}
