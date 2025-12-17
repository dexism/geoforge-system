// ================================================================
// GeoForge System - Map Splitter
// ================================================================

import * as config from './config.ts';
import * as utils from './utils.ts';
import * as blockUtils from './BlockUtils.ts';

/**
 * Assigns road patterns to hex properties based on global road paths.
 * @param {Array} allHexes 
 * @param {Array} roadPaths 
 */
export function assignRoadPatterns(allHexes, roadPaths) {
    // Clear existing patterns
    allHexes.forEach(h => {
        h.properties.roadPatterns = [];
    });

    if (!roadPaths) return;

    roadPaths.forEach(road => {
        const path = road.path;
        if (!path || path.length < 2) return;

        for (let i = 0; i < path.length; i++) {
            const curr = path[i];
            const hex = allHexes[utils.getIndex(curr.x, curr.y)];
            if (!hex) continue;

            const prev = (i > 0) ? path[i - 1] : null;
            const next = (i < path.length - 1) ? path[i + 1] : null;

            let inDir = -1;
            let outDir = -1;

            if (prev) {
                // Direction *from* Prev *to* Curr
                // But getPatternIds expects "Direction FROM neighbor TO Center" ??
                // No, BlockUtils.js says: "inDir: Direction from previous hex".
                // Wait, "Direction from previous hex" usually means "Which neighbor is Prev?".
                // If Prev is North of Curr, Prev->Curr is South. But Neighbor Index is North (0).

                // Let's re-read BlockUtils.js logic assumption.
                // "If inDir=0, outDir=3 (Diff=3) -> Straight".
                // If Prev is North(0), and Next is South(3). Path is N->S.
                // InDir "from neighbor 0". OutDir "to neighbor 3".
                // Yes, so InDir should be the DIRECTION OF PREV FROM CURR.

                const dirToPrev = blockUtils.getDirection(curr, { col: prev.x, row: prev.y });
                inDir = dirToPrev;
            }

            if (next) {
                const dirToNext = blockUtils.getDirection(curr, { col: next.x, row: next.y });
                outDir = dirToNext;
            }

            const patterns = blockUtils.getPatternIds(inDir, outDir);

            // Initialize if needed
            if (!hex.properties.roadPatternLevels) {
                hex.properties.roadPatternLevels = {};
            }

            // Patterns for this road segment
            patterns.forEach(pid => {
                const currentLevel = hex.properties.roadPatternLevels[pid] || 0;
                // Only update if the new road level is strictly higher
                if (road.level > currentLevel) {
                    hex.properties.roadPatternLevels[pid] = road.level;
                }
            });
        }
    });

    // Convert map to array for serialization
    allHexes.forEach(h => {
        if (h.properties.roadPatternLevels) {
            h.properties.roadPatterns = Object.entries(h.properties.roadPatternLevels).map(([pid, level]) => ({
                pattern: parseInt(pid),
                level: level
            }));
            delete h.properties.roadPatternLevels; // cleanup temp
        }
    });
}

/**
 * Assigns river patterns to hex properties based on flow data.
 * @param {Array} allHexes 
 */
export function assignRiverPatterns(allHexes) {
    // Clear existing patterns
    allHexes.forEach(h => {
        h.properties.riverPatterns = [];
    });

    // 1. Map all inflows
    // Map<hexIndex, Array<upstreamIndex>>
    const inflows = new Map();
    allHexes.forEach(h => {
        const ds = h.downstreamIndex;
        if (ds !== -1 && ds !== undefined && ds !== null) {
            // Hex h flows to Hex ds
            if (!inflows.has(ds)) {
                inflows.set(ds, []);
            }
            inflows.get(ds).push(h.index);
        }
    });

    // 2. Determine patterns for each hex
    allHexes.forEach(h => {
        const currIndex = h.index;
        const ups = inflows.get(currIndex) || [];
        const down = h.downstreamIndex;

        const patternsMap = new Map(); // pid -> width

        const currCol = h.col;
        const currRow = h.row;

        // Define OutDir
        let outDir = -1;
        if (down !== -1 && down !== undefined) {
            const dsHex = allHexes[down];
            if (dsHex) {
                outDir = blockUtils.getDirection({ col: currCol, row: currRow }, { col: dsHex.col, row: dsHex.row });
            }
        }

        // Process Inflows
        // Strategy: Each Inflow connects to Outflow.
        // If no Outflow (Sink), Inflow connects to Center?

        // Also: Source (No Inflow, Has Outflow) -> Center -> Out.
        if (ups.length === 0 && outDir !== -1) {
            const pids = blockUtils.getPatternIds(-1, outDir);
            pids.forEach(pid => patternsMap.set(pid, h.properties.riverWidth || 0.5));
        }

        ups.forEach(upIndex => {
            const upHex = allHexes[upIndex];
            const inDir = blockUtils.getDirection({ col: currCol, row: currRow }, { col: upHex.col, row: upHex.row });

            const pids = blockUtils.getPatternIds(inDir, outDir);

            // Use width from CURRENT hex for the pattern? Or average?
            // River width grows downstream.
            // Let's use current hex width.
            const width = h.properties.riverWidth || 0.5;

            pids.forEach(pid => {
                // If pattern exists, take MAX width?
                const existing = patternsMap.get(pid) || 0;
                if (width > existing) {
                    patternsMap.set(pid, width);
                }
            });
        });

        // Convert map to array
        if (patternsMap.size > 0) {
            h.properties.riverPatterns = Array.from(patternsMap.entries()).map(([pid, w]) => ({
                pattern: pid,
                width: w
            }));
        }
    });
}


/**
 * Splits the global world data into 25 block objects.
 * @param {Object} worldData 
 * @returns {Array} Array of block objects { id, data }
 */
export function splitWorldIntoBlocks(worldData) {
    const { allHexes } = worldData;
    const blocks = [];

    // Assign Patterns first
    assignRoadPatterns(allHexes, worldData.roadPaths);
    assignRiverPatterns(allHexes);

    // Iterate Blocks
    for (let ee = blockUtils.BLOCK_START_EE; ee <= blockUtils.BLOCK_END_EE; ee++) {
        for (let nn = blockUtils.BLOCK_START_NN; nn <= blockUtils.BLOCK_END_NN; nn++) {

            // Create Block Data
            const blockHexes = [];

            // Block Size: 25x22 (Core 23x20 + Padding 1)
            // Local Coords: 0..24, 0..21
            for (let ly = 0; ly < blockUtils.BLOCK_TOTAL_ROWS; ly++) {
                for (let lx = 0; lx < blockUtils.BLOCK_TOTAL_COLS; lx++) {

                    // Convert to Global
                    const globalCoord = blockUtils.blockToGlobal(ee, nn, lx, ly);

                    // Boundary check
                    if (globalCoord.col < 0 || globalCoord.col >= config.COLS ||
                        globalCoord.row < 0 || globalCoord.row >= config.ROWS) {
                        // Pad with null or dummy?
                        // If it's outside the world, maybe just skip or add dummy water?
                        // Spec says "block holds 25x22 data".
                        // Let's put a dummy water hex if out of bounds.
                        blockHexes.push({
                            // Minimal dummy
                            col: lx, row: ly,
                            properties: { isWater: 1, elevation: -100 }
                        });
                        continue;
                    }

                    // Get Global Hex
                    const index = utils.getIndex(globalCoord.col, globalCoord.row);
                    const hex = allHexes[index];

                    if (!hex) {
                        blockHexes.push({
                            col: lx, row: ly,
                            properties: { isWater: 1, elevation: -100 }
                        });
                        continue;
                    }

                    // Clone & Extract Properties
                    // We can reuse compress logic?
                    // But we need to keep "roadPatterns" and "riverPatterns" which are NOT in the standard compressor yet.

                    // For now, let's create a "BlockHex" object.
                    // We should use the same compression logic as main.js if possible, but modified.
                    // Or since we are changing the format, we define the NEW format here.

                    // Using toObject() from WorldMap.js?
                    const p = hex.properties;

                    const blockHex = {
                        x: lx, // Local X
                        y: ly, // Local Y
                        // ... Copy properties ...
                        h: p.elevation,
                        t: p.temperature,
                        r: p.precipitation, // Rain
                        // etc... 
                        // To allow main.js's compressor to work, maybe we just pass the RAW PROPERTIES for now,
                        // and let the serializer handle it?
                        // Usage: `blocks` will be serialized.

                        // Let's copy essential props.
                        w: p.isWater ? 1 : 0,
                        tt: p.terrainTypeId,
                        v: p.vegetationId,
                        // ...

                        // NEW PROPS
                        rp: p.roadPatterns, // [{pattern:0, level:2}, ...]
                        rv: p.riverPatterns // [{pattern:0, width:0.5}, ...]
                    };

                    // We need a robust copier.
                    // Let's assume we use a specialized compressor for blocks later.
                    // For this step, I will return the "Rich Object" and let main.js compress it?
                    // Or implement compression here?
                    // Plan says: "Update compressWorldData to support Block format".

                    // Ideally, we return a list of "Hex Objects" that look like the old `allHexes` but with local coords,
                    // PLUS the new pattern properties.
                    // Then `compressWorldData` can be updated to handle them.

                    // But `compressWorldData` expects `WorldMap` structure (Arrays).
                    // Here we have individual objects.

                    // I'll stick to a simple object structure for the block hexes.

                    // FULL COPY of properties for safety during dev
                    Object.assign(blockHex, p);
                    // Override coords
                    blockHex.col = lx;
                    blockHex.row = ly;

                    blockHexes.push(blockHex);
                }
            }

            blocks.push({
                id: blockUtils.getBlockId(ee, nn),
                hexes: blockHexes
            });
        }
    }

    return blocks;
}
