
// ================================================================
// GeoForge System - Shared Type Definitions
// ================================================================

/**
 * ブロック(23x20ヘックス + パディング = 25x22)のデータ構造
 * JSON保存時の形式
 */
export interface BlockData {
    id: string; // "map_X_Y"
    bX: number; // Block X Index
    bY: number; // Block Y Index
    h: CompressedHexData[]; // Hexagon Data List
}

/**
 * 圧縮されたヘックスデータ構造 (JSON用)
 * キーはKEY_MAPにより短縮される
 */
export interface CompressedHexData {
    // 基本プロパティ
    w?: number; // isWater (0/1)
    el?: number; // elevation
    t?: number; // temperature
    pm?: number; // precipitation_mm
    p?: number; // precipitation (deprecated/legacy?)
    c?: number; // climate
    cz?: number; // climateZone
    v?: number; // vegetation
    tt?: number; // terrainType
    fl?: number; // flow
    ia?: number; // isAlluvial
    hs?: number; // hasSnow
    il?: number; // isLakeside
    bn?: number; // beachNeighbors

    // マナ・資源・魔物
    mv?: number; // manaValue
    mr?: number; // manaRank
    rr?: number; // resourceRank
    mor?: number; // monsterRank

    // ポテンシャル
    ap?: number;
    fp?: number;
    mp?: number;
    fip?: number;
    hp?: number;
    pp?: number;
    lp?: number;
    ca?: number; // cultivatedArea
    hab?: number; // habitability

    // 社会
    pop?: number; // population
    s?: number; // settlement
    ind?: number; // industry (compressed)
    sur?: number; // surplus (compressed)
    sho?: number; // shortage (compressed)
    tdat?: any; // territoryData
    n?: number; // nationId
    ph?: number; // parentHexId
    ti?: number; // territoryId
    dp?: number; // distanceToParent
    td?: number; // travelDaysToParent

    // 道路
    rl?: number; // roadLevel
    ru?: number; // roadUsage
    rlo?: number; // roadLoss
    lu?: number; // landUsage
    wu?: number; // waterUsage

    // フラット化されたLandUse
    lu_r?: number;
    lu_d?: number;
    lu_b?: number;
    lu_g?: number;
    lu_f?: number;

    // その他
    dem?: any;
    fac?: any;
    lc?: number;
    log?: any;
    va?: any;
    ds?: number;
    rus?: number;
}
