
import { calculateDemographics, calculateFacilities } from './test_demographics.js';

// Mock Hex
const mockHex = {
    properties: {
        population: 5000,
        settlement: '都市',
        monsterRank: 'B',
        agriPotential: 0.8,
        forestPotential: 0.2,
        miningPotential: 0.1,
        fishingPotential: 0.5,
        pastoralPotential: 0.3,
        livestockPotential: 0.3,
        industry: {
            primary: { '小麦': 100 },
            secondary: { '武具': 50 },
            tertiary: { '商業': 200 }
        }
    }
};

console.log("--- Testing Demographics Calculation ---");
const demo = calculateDemographics(mockHex);
console.log("Demographics:", JSON.stringify(demo, null, 2));

mockHex.properties.demographics = demo;

console.log("--- Testing Facilities Calculation ---");
const facilities = calculateFacilities(mockHex);
console.log("Facilities:", JSON.stringify(facilities, null, 2));
