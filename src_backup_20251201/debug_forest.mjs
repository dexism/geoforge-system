
import * as config from '../src/config.js';
import { WorldMap } from '../src/WorldMap.js';
import { generatePhysicalMap, generateClimateAndVegetation } from '../src/continentGenerator.js';

async function debugForest() {
    console.log("Starting Forest Debug...");

    // Mock log function
    const log = (msg) => { }; // Silence logs

    let allHexes = await generatePhysicalMap(log);
    allHexes = await generateClimateAndVegetation(allHexes, log);

    let forestCount = 0;
    let lowPotentialForestCount = 0;
    let zeroPotentialForestCount = 0;

    console.log("\n--- Inspecting Forest Hexes ---");

    for (let i = 0; i < allHexes.length; i++) {
        const h = allHexes[i];
        const p = h.properties;

        if (p.vegetation === '森林') {
            forestCount++;

            if (p.landUse.forest < 0.10) {
                lowPotentialForestCount++;
                if (p.landUse.forest < 0.001) {
                    zeroPotentialForestCount++;

                    if (zeroPotentialForestCount <= 5) {
                        console.log(`\n[Hex ${i}] Label: ${p.vegetation}, LandUse.Forest: ${p.landUse.forest.toFixed(6)}`);
                        console.log(`  Precip: ${p.precipitation_mm.toFixed(1)}mm (Norm: ${p.precipitation.toFixed(4)})`);
                        console.log(`  Temp: ${p.temperature.toFixed(1)}C`);
                        console.log(`  Potentials: Forest=${(p.landUse.forest * 100).toFixed(2)}%, Grass=${(p.landUse.grassland * 100).toFixed(2)}%`);

                        // Manual check of factors
                        const forestPrecipFactor = Math.max(0, p.precipitation - 0.05);
                        const forestTempFactor = Math.max(0, 1 - Math.abs(p.temperature - 15) / 20);
                        console.log(`  Calc Factors: PrecipFactor=${forestPrecipFactor.toFixed(4)}, TempFactor=${forestTempFactor.toFixed(4)}`);
                    }
                }
            }
        }
    }

    console.log("\n--- Summary ---");
    console.log(`Total '森林' Hexes: ${forestCount}`);
    console.log(`Forests with landUse < 0.10: ${lowPotentialForestCount} (${(lowPotentialForestCount / forestCount * 100).toFixed(1)}%)`);
    console.log(`Forests with landUse < 0.001: ${zeroPotentialForestCount} (${(zeroPotentialForestCount / forestCount * 100).toFixed(1)}%)`);
}

debugForest();
