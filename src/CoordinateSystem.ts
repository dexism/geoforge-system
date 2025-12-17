
interface Point {
    x: number;
    y: number;
}

/**
 * 座標変換システム (Floating Origin)
 * 
 * 地球規模の巨大な座標空間を扱うために、レンダリング原点を動的に移動させる「浮動原点」方式を管理します。
 * ワールド座標 (World Space) と ビューポート相対座標 (View Space) の相互変換を提供します。
 */
export class CoordinateSystem {
    private _origin: Point;
    public readonly RECENTER_THRESHOLD: number;

    constructor() {
        // 現在のレンダリング原点 (ワールド座標)
        // 初期値は (0,0) だが、初期ロード時に設定される
        this._origin = { x: 0, y: 0 };

        // リセンターを実行する閾値 (px)
        // 3D変換環境下ではGPUテクスチャサイズ制限(8k-16k)の影響を受けやすいため、
        // 閾値を小さくして頻繁に原点を更新し、座標を小さく保つ。
        this.RECENTER_THRESHOLD = 4000;
    }

    /**
     * 原点を設定します。
     * @param {number} wx - ワールドX
     * @param {number} wy - ワールドY
     */
    setOrigin(wx: number, wy: number): void {
        this._origin.x = wx;
        this._origin.y = wy;
        console.log(`[CoordinateSystem] Origin updated to (${Math.round(wx)}, ${Math.round(wy)})`);
    }

    /**
     * 現在の原点を取得します。
     * @returns {Point} {x, y}
     */
    getOrigin(): Point {
        return { ...this._origin };
    }

    /**
     * ワールド座標をビューポート相対座標に変換します。
     * (レンダリング用)
     * @param {number} wx 
     * @param {number} wy 
     * @returns {Point} {x, y}
     */
    toView(wx: number, wy: number): Point {
        return {
            x: wx - this._origin.x,
            y: wy - this._origin.y
        };
    }

    /**
     * ビューポート相対座標をワールド座標に変換します。
     * (マウスイベント等)
     * @param {number} vx 
     * @param {number} vy 
     * @returns {Point} {x, y}
     */
    fromView(vx: number, vy: number): Point {
        return {
            x: vx + this._origin.x,
            y: vy + this._origin.y
        };
    }

    /**
     * リセンターが必要かどうかを判定します。
     * 現在のビューポート中心（相対座標）が閾値を超えているかチェックします。
     * @param {number} currentTransformX - D3 Zoomのtranslate X
     * @param {number} currentTransformY - D3 Zoomのtranslate Y
     * @param {number} scale - ズーム倍率
     * @param {number} viewportWidth 
     * @param {number} viewportHeight 
     * @returns {Point|null} リセンターが必要な場合は新しい原点のワールド座標 {x, y}、不要なら null
     */
    checkReCenter(currentTransformX: number, currentTransformY: number, scale: number, viewportWidth: number, viewportHeight: number): Point | null {
        // 画面中心の「現在の相対座標」を計算
        // D3のtransformは (vx * k + tx, vy * k + ty) = screenXY
        // 画面中心 (viewportWidth/2, viewportHeight/2) に対応する相対座標 vx, vy を逆算

        const centerX = (viewportWidth / 2 - currentTransformX) / scale;
        const centerY = (viewportHeight / 2 - currentTransformY) / scale;

        // 原点(0,0)からの距離
        const distSq = centerX * centerX + centerY * centerY;

        if (distSq > this.RECENTER_THRESHOLD * this.RECENTER_THRESHOLD) {
            // 現在の画面中心を新しい原点とする (ワールド座標に変換)
            return this.fromView(centerX, centerY);
        }

        return null;
    }
}
