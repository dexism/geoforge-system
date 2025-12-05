
import { waterAreasRiverMouth } from './src/continentGenerator.js';

console.log("Verifying Soft Cap Logic...");

const testCases = [
    { name: "Small River", Q: 10, isRiverMouth: false },
    { name: "Medium River", Q: 100, isRiverMouth: false },
    { name: "Large River", Q: 1000, isRiverMouth: false },
    { name: "Huge River", Q: 10000, isRiverMouth: false },
    { name: "River Mouth (Small)", Q: 10, isRiverMouth: true },
    { name: "River Mouth (Huge)", Q: 10000, isRiverMouth: true },
];

testCases.forEach(tc => {
    const result = waterAreasRiverMouth({
        hexHa: 8660,
        L_km: 10,
        Q: tc.Q,
        flatness: 0.8,
        oceanicity: 0.5,
        R: 0.5,
        tidalRange: 2.0,
        isRiverMouth: tc.isRiverMouth
    });

    console.log(`[${tc.name}] Q=${tc.Q}, Total=${result.waterTotalHa} ha`);
    if (result.waterTotalHa > 1000) {
        console.error("FAIL: Water area exceeds 1000ha!");
    } else if (result.waterTotalHa > 500) {
        console.log("PASS: Soft cap active (500 < Area < 1000)");
    } else {
        console.log("PASS: Below cap");
    }
});
