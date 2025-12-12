
import { recalculateGeographicFlags, initializeWaterVegetation } from './src/continentGenerator.js';
import { strict as assert } from 'assert';

// Mock Hex Class
class MockHex {
    constructor(index, col, row, elevation, isWater = false) {
        this.index = index;
        this.col = col;
        this.row = row;
        this.properties = {
            elevation: elevation,
            isWater: isWater,
            vegetation: null
        };
        this.neighbors = [];
    }
}

console.log("Starting Flag Verification...");

// Scenario: 3 Hexes. 
// 0: Land (Center)
// 1: Ocean (West)
// 2: Lake (East)

const hexes = [
    new MockHex(0, 1, 1, 100, false), // Land
    new MockHex(1, 0, 1, -10, true),  // Ocean
    new MockHex(2, 2, 1, 50, true)    // Lake (Elevation > 0)
];

// Set Neighbors
hexes[0].neighbors = [1, 2];
hexes[1].neighbors = [0];
hexes[2].neighbors = [0];

console.log("Step 1a: Initialize Global Coords (Simulation)");
// Simulate Map Size 25x22
const MAP_COLS = 25;
const MAP_ROWS = 22;

const hexes2 = [
    new MockHex(0, 5012, 7309, 100, false), // Land (Local: 0,0?)
    new MockHex(1, 5011, 7309, -10, true),  // Ocean (Local: -1,0 -> Invalid if 0,0 is origin?)
    new MockHex(2, 5013, 7309, 50, true)    // Lake (Local: 1,0)
];

// Let's assume indices 0, 1, 2 coincide with Local Coords for sake of test.
// 0: Local 12, 11 (Center of 25x25)
const CENTER_IDX = 12 * 25 + 12; // 312
const WEST_IDX = 311;
const EAST_IDX = 313;

const mockMap = [];
// Fill map with nulls
for (let i = 0; i < 25 * 22; i++) mockMap[i] = null;

const centerHex = new MockHex(CENTER_IDX, 5012, 7309, 100, false);
const westHex = new MockHex(WEST_IDX, 5011, 7309, -10, true);
const eastHex = new MockHex(EAST_IDX, 5013, 7309, 50, true);

mockMap[CENTER_IDX] = centerHex;
mockMap[WEST_IDX] = westHex;
mockMap[EAST_IDX] = eastHex;

// Mock getNeighborIndices logic from utils.js
function getNeighborIndices(col, row, maxCols, maxRows) {
    const addresses = [
        [col + 1, row], [col + 1, row - 1], [col, row - 1],
        [col - 1, row], [col - 1, row + 1], [col, row + 1]
    ];
    // Odd-Q neighbor logic differs slightly but for WEST/EAST (col+/-1) it's simple
    // Actually vertical offset logic applies.
    // West: col-1. East: col+1.

    // BUT checking bounds against maxCols (25)
    const neighbors = [];
    addresses.forEach(([c, r]) => {
        if (c >= 0 && c < maxCols && r >= 0 && r < maxRows) {
            neighbors.push(r * maxCols + c);
        }
    });
    return neighbors;
}

console.log("Step 2a: Generate Neighbors using GLOBAL COORDS (Current Bug)");
// Current main.js logic:
// h.neighbors = getNeighborIndices(h.col, h.row, mapCols, mapRows);
// h.col = 5012, mapCols = 25.
const currentNeighbors = getNeighborIndices(centerHex.col, centerHex.row, MAP_COLS, MAP_ROWS);
console.log(`Global Calc Neighbors: ${currentNeighbors.length} (Should be 0 if bounds check works)`);

centerHex.neighbors = currentNeighbors;

// Verify Flags with Current Bug
recalculateGeographicFlags(mockMap);
console.log(`With Bug: isCoastal=${centerHex.properties.isCoastal}`);

if (centerHex.properties.isCoastal === true) {
    console.error("UNEXPECTED: Should fail because 5012 is out of bounds for 25 cols");
} else {
    console.log("CONFIRMED: Bug reproduced. Global coords cause out-of-bounds neighbors.");
}


console.log("Step 3: Generate Neighbors using LOCAL COORDS (Proposed Fix)");
// Fix: Use index to derive local col/row
// Note: In verify_dummy_logic.js mock setup, indices might not meaningful?
// Wait, we manually assigned indices 311, 312, 313.
// 312 % 25 = 12. Math.floor(312 / 25) = 12. Correct.

const localCol = centerHex.index % MAP_COLS;
const localRow = Math.floor(centerHex.index / MAP_COLS);
console.log(`Derived Local: ${localCol}, ${localRow}`); // Should be 12, 12

const fixedNeighbors = getNeighborIndices(localCol, localRow, MAP_COLS, MAP_ROWS);
console.log(`Local Calc Neighbors: ${fixedNeighbors}`); // Should include 311, 313

centerHex.neighbors = fixedNeighbors;

// Re-run flag calc on the specific hexes (need to clean flags first if re-using)
centerHex.properties.isCoastal = false;
centerHex.properties.isLakeside = false;

// recalculateGeographicFlags iterates ALL hexes in array.
// Our Mock Map is sparse array with nulls. This caused crash.
// We should filter or mock the array to be dense-ish or handle iterator properly.
// The function uses: allHexes.forEach.
// Sparse array forEach only visits existing elements.
// So map[312] exists. map[311] exists. map[313] exists.
// BUT getNeighborIndices returns indices like 311, 313, 287...
// If 287 is empty in mockMap, map[287] is undefined.
// `const nHex = allHexes[nIndex];` -> undefined.
// `if (nHex && ...)` -> Check handles it.

// So why did it crash?
// `const p = h.properties;` at line 1422.
// Ah, `allHexes.forEach(h => ...)`
// If mockMap has holes, forEach skips them.
// Wait, if I did `for(let i=0; i<25*22; i++) mockMap[i] = null;`
// Then it is NOT sparse. It is full of `null`s.
// forEach visits `null`. `null.properties` -> CRASH.

// Fix: Use a dense array of ONLY valids for the test function input?
// No, the function expects `allHexes` to be index-addressable by neighbor index.
// So it must be the full map array.
// FIX: Fill mockMap with Dummy Objects instead of null.

const dummyHex = new MockHex(-1, 0, 0, 0, false);
for (let i = 0; i < mockMap.length; i++) {
    if (!mockMap[i]) mockMap[i] = dummyHex;
}

recalculateGeographicFlags(mockMap);
console.log(`With Fix: isCoastal=${centerHex.properties.isCoastal}`);

if (centerHex.properties.isCoastal === true) {
    console.log("SUCCESS: Fix verified. Local coordinate derivation works.");
} else {
    console.error("FAILURE: Fix did not work.");
    process.exit(1);
}
