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

/**
 * プログレスバーの表示用文字列を生成する汎用関数
 * @param {object} params - パラメータオブジェクト
 * @param {number} params.current - 現在の処理数
 * @param {number} params.total - 全体の処理数
 * @param {string} [params.prefix=""] - バーの前に表示する接頭辞
 * @param {number} [params.barWidth=20] - バーの文字数
 * @returns {string} フォーマットされたプログレスバー文字列
 */
export function formatProgressBar({ current, total, prefix = "", barWidth = 40 }) {
    if (total === 0) return `${prefix} [${'-'.repeat(barWidth)}] 0% (0/0)`;

    const percent = Math.floor((current / total) * 100);
    const filledLength = Math.round((barWidth * percent) / 100);
    const emptyLength = barWidth - filledLength;

    const bar = '|'.repeat(filledLength) + '.'.repeat(emptyLength);

    return `${prefix} [${bar}] ${percent}% (${current}/${total})`;
}