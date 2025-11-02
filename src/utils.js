// ================================================================
// GeoForge System - ユーティリティモジュール
// ================================================================

import * as config from './config.js';

/**
 * 座標からallHexes配列のインデックスを計算する
 * @param {number} col - ヘックスの列
 * @param {number} row - ヘックスの行
 * @returns {number} 配列のインデックス
 */
export function getIndex(col, row) {
    return row * config.COLS + col;
}

/**
 * 2つのヘックス間の簡易的な距離を計算する (マンハッタン距離のヘックス版)
 * @param {object} h1 - 1つ目のヘックスオブジェクト ({ col, row })
 * @param {object} h2 - 2つ目のヘックスオブジェクト ({ col, row })
 * @returns {number} ヘックス単位での距離
 */
export function getDistance(h1, h2) {
    // 軸座標系への変換は不要な、簡略化された距離計算
    const dx = Math.abs(h1.col - h2.col);
    const dy = Math.abs(h1.row - h2.row);
    
    // ヘックスグリッドの距離計算は、dx, dy, dzの差の最大値に等しい
    // このグリッド系ではこれで十分な近似となる
    return Math.max(dx, dy);
}