
console.log("Verifying Soft Cap Logic (Isolated)...");

function waterAreasRiverMouth({
    hexHa = 8660,
    L_km = 8.66,
    Q,
    flatness,
    oceanicity,
    R,
    tidalRange = 2.0,
    isRiverMouth = false,
    downstreamTerrain = null
}) {
    const clip01 = x => Math.max(0, Math.min(1, x));
    const L_m = L_km * 1000;

    // 幅・深さの経験式（物理ベース）
    const a = 2.0, b = 0.5;     // w = a * Q^b
    const c = 0.2, f = 0.4;    // d = c * Q^f
    const w_m = Math.max(2.0, a * Math.pow(Q, b));
    const d_m = Math.max(0.5, c * Math.pow(Q, f));

    // 河道面積
    const channelHa_raw = (L_m * w_m) / 1e4;

    // 河口・デルタ拡張係数
    const tideFactor = clip01(tidalRange / 3.0);               // 0〜1
    const flatWet = clip01(0.6 * flatness + 0.4 * R);          // 0〜1
    const coastFactor = clip01(oceanicity);                     // 0〜1

    // デルタ・干潟面積（河道の数倍に拡張）
    // 河口なら強化、内陸なら抑制
    const deltaMultiplier = isRiverMouth
        ? 1.0 + 4.0 * (0.5 * tideFactor + 0.3 * flatWet + 0.2 * coastFactor)
        : 0.5 + 1.0 * flatWet;

    const deltaHa_raw = channelHa_raw * deltaMultiplier;

    // 湿地（塩湿地・感潮湿地）
    const marshHa_raw = channelHa_raw * (0.8 + 2.5 * flatWet) * (0.5 + 0.5 * coastFactor);

    // 潟湖（lagoon）：潮汐＋海洋性が高く、平坦で保水力が高いほど成立
    // 修正: ヘックス面積依存ではなく、河川規模(channelHa)に依存させる
    // 修正2: 湖への流入時はラグーンを小さくする
    let baseLagoonMult = 2.0 + 6.0 * (0.4 * tideFactor + 0.4 * coastFactor + 0.2 * flatWet); // Max 8.0
    if (downstreamTerrain === '湖沼') {
        baseLagoonMult *= 0.3; // 湖の場合は30%に抑制
    }

    const lagoonMultiplier = isRiverMouth ? baseLagoonMult : 0;

    // channelHaが小さい(小河川)ならラグーンも小さい。大河川なら大きくなる。
    const lagoonHa_raw = channelHa_raw * lagoonMultiplier;

    // 上限（cap）
    const channelCapFrac = isRiverMouth ? 0.20 : 0.10;  // 河道の面積上限
    const deltaCapFrac = isRiverMouth ? 0.60 : 0.20;  // デルタ・干潟の上限
    const marshCapFrac = isRiverMouth ? 0.50 : 0.30;  // 湿地の上限
    const lagoonCapFrac = isRiverMouth ? 0.50 : 0.10;  // 潟湖の上限
    const totalCapFrac = isRiverMouth ? 0.95 : 0.50;  // 総水域の上限

    let channelHa = Math.min(channelHa_raw, hexHa * channelCapFrac);
    let deltaHa = Math.min(deltaHa_raw, hexHa * deltaCapFrac);
    let marshHa = Math.min(marshHa_raw, hexHa * marshCapFrac);
    let lagoonHa = Math.min(lagoonHa_raw, hexHa * lagoonCapFrac);

    // 総面積の上限調整（超過時は比率で縮小）
    let waterTotalHa = channelHa + deltaHa + marshHa + lagoonHa;

    if (waterTotalHa > 500) {
        console.log(`[DEBUG] SoftCap Triggered: Before=${waterTotalHa}`);
    }

    // ユーザー要望: 500haまではそのまま、それ以上は伸びにくくし、1000haには到達しにくくする (Soft Cap)
    // f(x) = 500 + (x - 500) / (1 + (x - 500) / 500)  for x > 500
    // x -> infinity, f(x) -> 1000
    if (waterTotalHa > 500) {
        const excess = waterTotalHa - 500;
        const compressedExcess = excess / (1 + excess / 500);
        const newTotal = 500 + compressedExcess;

        // 比率で各要素を縮小
        const scale = newTotal / waterTotalHa;
        channelHa *= scale; deltaHa *= scale; marshHa *= scale; lagoonHa *= scale;
        waterTotalHa = newTotal;
        console.log(`[DEBUG] SoftCap Applied: After=${waterTotalHa}`);
    }

    // ハードキャップ (念のため)
    const maxTotal = hexHa * totalCapFrac;
    if (waterTotalHa > maxTotal) {
        const scale = maxTotal / waterTotalHa;
        channelHa *= scale; deltaHa *= scale; marshHa *= scale; lagoonHa *= scale;
        waterTotalHa = maxTotal;
    }

    return {
        channelHa: Math.round(channelHa),
        deltaHa: Math.round(deltaHa),
        marshHa: Math.round(marshHa),
        lagoonHa: Math.round(lagoonHa),
        waterTotalHa: Math.round(waterTotalHa)
    };
}

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
