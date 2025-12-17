// ================================================================
// GeoForge System - MapView Module
// ================================================================
import * as d3 from 'd3';
import * as config from './config.ts';
import { getIndex, formatLocation, getSharedEdgePoints, getSharedEdgeMidpoint } from './utils.ts';
import { BLOCK_START_EE, BLOCK_START_NN, BLOCK_END_NN } from './BlockUtils.ts';
import { getInfoText, updateOverallInfo, generateHexJson, childrenMap } from './infoWindow.ts';
import { CoordinateSystem } from './CoordinateSystem.ts'; // [NEW]
import { JapanOverlay } from './JapanOverlay.js';
import { WorldMap, Hex } from './WorldMap.ts';

/**
 * 変更履歴:
 * - 2025-12-12: コード内のコメントを日本語化し、可読性を向上。
 */

export class MapView {
    containerSelector: string;
    svg: d3.Selection<Element, unknown, HTMLElement, any>;
    g: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
    layers: { [key: string]: d3.Selection<SVGGElement, unknown, HTMLElement, any> };
    hexes: WorldMap | any[]; // 全ヘックスデータへの参照 (Flyweightパターン)
    roadPathsData: any[];
    currentTransform: d3.ZoomTransform;
    blocks: any[]; // 読み込まれたブロックオブジェクトの配列
    blockLoaderRef: any;
    minimapContainer: d3.Selection<d3.BaseType, unknown, HTMLElement, any> | null;
    minimapSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any> | null;
    minimapViewport: d3.Selection<SVGRectElement, unknown, HTMLElement, any> | null;
    currentSelectedHex: Hex | null;
    tooltipContainer: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
    nationColor: d3.ScaleOrdinal<string, string>;
    BLOCK_COLS: number;
    BLOCK_ROWS: number;
    coordSys: CoordinateSystem;
    japanOverlay: JapanOverlay;

    // Zoom related
    zoom: d3.ZoomBehavior<Element, unknown>;
    isZooming: boolean = false;
    isProgrammaticZoom: boolean = false;

    /**
     * コンストラクタ
     * @param {string} containerSelector - SVGを描画するコンテナのセレクタ
     */
    constructor(containerSelector: string) {
        this.containerSelector = containerSelector;
        this.svg = d3.select(containerSelector) as d3.Selection<Element, unknown, HTMLElement, any>;
        this.g = this.svg.append('g');
        this.layers = {};
        this.hexes = []; // 全ヘックスデータへの参照 (Flyweightパターン)
        this.roadPathsData = [];
        this.currentTransform = d3.zoomIdentity;
        this.blocks = []; // 読み込まれたブロックオブジェクトの配列
        this.blockLoaderRef = null;
        this.minimapContainer = null;
        this.minimapSvg = null;
        this.minimapViewport = null;
        this.currentSelectedHex = null;
        this.tooltipContainer = this.createTooltip();
        this.zoom = d3.zoom(); // Initialize
        this.isZooming = false;
        this.isProgrammaticZoom = false;

        // 定数
        this.nationColor = d3.scaleOrdinal(d3.schemeTableau10);
        this.BLOCK_COLS = 23;
        this.BLOCK_ROWS = 20;

        // [NEW] 座標系システムの初期化
        this.coordSys = new CoordinateSystem();
        this.japanOverlay = new JapanOverlay();
    }

    /**
     * ツールチップ要素を作成します。
     * 既存のものを削除して再作成することで、重複を防ぎます。
     */
    createTooltip() {
        d3.select('#tooltip').remove();
        return d3.select('body').append('div')
            .attr('id', 'tooltip')
            .attr('class', 'tooltip');
    }

    /**
     * ヘックスのプロパティからツールチップに表示するテキストを生成します。
     * @param {Object} d - ヘックスデータ
     * @returns {string} ツールチップのテキスト
     */
    getTooltipText(d) {
        const p = d.properties;

        let headerText = '';
        const locationText = formatLocation(d, 'short');
        const settlementType = (p.settlement || '散居').padEnd(2, '　');
        const populationText = `人口：${(p.population || 0).toLocaleString()} 人`;
        headerText += `${settlementType}：${locationText}\n${populationText}\n`;

        let bodyText = '---\n';
        const terrain = p.isWater ? '水域' : (p.terrainType || '不明');
        const vegetation = p.vegetation || 'なし';
        bodyText += `地形：${terrain}\n植生：${vegetation}\n`;

        const features = [];
        if (p.isAlluvial) features.push('河川');
        if (p.hasSnow) features.push('積雪');
        if (p.beachNeighbors && p.beachNeighbors.length > 0) features.push('砂浜');
        if (features.length > 0) bodyText += `特性：${features.join(', ')}`;


        if (p.parentHexId !== null) {
            bodyText += `\n---`;
            let currentHex = d;
            let safety = 0;
            // 親ヘックスを辿って上位の所属を表示
            while (currentHex && currentHex.properties.parentHexId !== null && safety < 10) {
                const parentHex = this.hexes[currentHex.properties.parentHexId];
                if (!parentHex) break;
                const parentType = (parentHex.properties.settlement || '').padEnd(2, '　');
                const parentCoords = formatLocation(parentHex, 'short');
                bodyText += `\n${parentType}：${parentCoords}`;
                currentHex = parentHex;
                safety++;
            }
        }

        const nationName = p.nationId > 0 && config.NATION_NAMES[p.nationId - 1] ? config.NATION_NAMES[p.nationId - 1] : '辺境';
        bodyText += `\n${nationName}`;

        return headerText + bodyText;
    }

    /**
     * MapViewを初期化します。
     * データを受け取り、レイヤー、ミニマップ、ズーム機能を初期化し、初期ビューを設定します。
     * @param {Object} allHexes - 全ヘックスデータ
     * @param {Array} roadPaths - 道路パスデータ
     * @param {Object} blockLoader - ブロックローダーの参照
     */
    async initialize(allHexes, roadPaths, blockLoader) {
        this.blockLoaderRef = blockLoader;

        // allHexesがProxyや特殊オブジェクトの場合の対応
        // allHexesがProxyや特殊オブジェクトの場合の対応
        // [FIX] WorldMapインスタンスをそのまま保持し、動的なバッファ更新に対応する
        // 以前は配列にコピーしていたため、後続のロードデータが反映されなかった
        /*
        if (typeof allHexes.getHex === 'function') {
            const tempHexes = [];
            const count = allHexes.size || (allHexes.cols * allHexes.rows);
            for (let i = 0; i < count; i++) {
                tempHexes.push(allHexes.getHex(i));
            }
            tempHexes.cols = allHexes.cols;
            tempHexes.rows = allHexes.rows;
            allHexes = tempHexes;
        }
        */

        this.hexes = allHexes;
        this.roadPathsData = roadPaths || []; // 配列であることを保証

        this.initLayers();
        this.initMinimap();
        this.initZoom();
        this.setInitialView();

        this.updateAllHexColors();
        updateOverallInfo(this.hexes as any[]);
    }

    /**
     * 描画レイヤーを初期化します。
     * 描画順序を制御するため、適切な順番でグループを作成します。
     */
    initLayers() {
        this.g.selectAll('*').remove();
        this.layers = {};

        const createLayer = (name, visibleByDefault = true) => {
            const layerGroup = this.g.append('g').attr('class', `${name} -layer`);
            (layerGroup as any).visible = visibleByDefault;
            this.layers[name] = layerGroup;
            if (!visibleByDefault) {
                layerGroup.style('display', 'none');
            }
            return layerGroup;
        };

        // レイヤー作成 (描画順)
        createLayer('terrain'); // 地形 (最下層)
        createLayer('white-map-overlay', false); // 白地図
        createLayer('vegetation-overlay', true); // 植生
        createLayer('beach', true); // 砂浜
        createLayer('snow', true); // 積雪
        createLayer('river'); // 河川
        createLayer('shading'); // 陰影
        createLayer('contour', true); // 等高線
        createLayer('ridge-water-system', false); // 稜線・水系デバッグ
        createLayer('territory-overlay', false); // 領土
        createLayer('japan-overlay', false); // 日本地図
        createLayer('hex-border', false); // ヘックス境界
        createLayer('road'); // 道路
        createLayer('sea-route'); // 海路
        createLayer('border'); // 国境
        createLayer('highlight-overlay'); // ハイライト
        createLayer('settlement'); // 集落

        // データオーバーレイ群
        const overlays = [
            'monster-overlay',
            'population-overlay',
            'climate-zone-overlay',
            'temp-overlay',
            'precip-overlay',
            'mana-overlay',
            'agri-overlay',
            'forest-overlay',
            'mining-overlay',
            'fishing-overlay',
            'hunting-overlay',
            'pastoral-overlay',
            'livestock-overlay'
        ];
        overlays.forEach(name => createLayer(name, false));

        createLayer('labels'); // ラベル
        createLayer('block-id-labels', false); // ブロックID (ズームアウト時)
        createLayer('interaction'); // インタラクション (最前面)
    }

    /**
     * ミニマップを初期化します。
     */
    initMinimap() {
        d3.select('#minimap-container').remove();
        this.minimapContainer = d3.select('body').append('div').attr('id', 'minimap-container');
        this.minimapSvg = this.minimapContainer.append('svg').attr('id', 'minimap-svg');
        this.minimapSvg.append('g').attr('id', 'minimap-terrain');
        this.minimapViewport = this.minimapSvg.append('rect')
            .attr('id', 'minimap-viewport')
            .attr('fill', 'none')
            .attr('stroke', 'red')
            .attr('stroke-width', 2);
    }

    /**
     * ズーム・パン機能を初期化します。
     * D3のzoomを使用し、パフォーマンス向上のためズーム中は一部レイヤーを非表示にします。
     */
    initZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.7, 4.0])
            .on('start', () => {
                this.svg.style('cursor', 'grabbing');
                this.isZooming = true;
                // ズーム中は重いレイヤーを非表示にする最適化
                // updateZoomDependentLayers が isZooming フラグを見て非表示にする
                this.updateZoomDependentLayers(d3.zoomTransform(this.svg.node() as Element).k);
            })
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
                this.currentTransform = event.transform;
                // ブロックIDラベル等の表示制御
                this.updateZoomDependentLayers(event.transform.k);
                // ミニマップの更新は必要に応じてスロットリングする
            })
            .on('end', (event) => {
                this.isZooming = false;

                // [FIX] 1. Recenter Check (Floating Origin)
                // 原点シフトが必要か確認し、実行する。
                // シフトした場合は内部で D3 Transform の調整と this.currentTransform の更新が行われる
                // 戻り値が true の場合、Originが変わっているので再描画必須
                const recentered = this.handleRecenter(event.transform);

                // [FIX] 2. レイヤー状態の更新
                this.updateZoomDependentLayers(event.transform.k);

                // 2. その他のレイヤーの表示復帰 (ズーム中のみ非表示だったもの)
                const zoomDependentLayers = ['contour', 'labels', 'block-id-labels', 'settlement', 'hex-border'];
                Object.entries(this.layers).forEach(([name, layer]) => {
                    if (!zoomDependentLayers.includes(name) && (layer as any).visible) {
                        layer.style('display', 'inline');
                    }
                });

                // 3. 可視ブロックの計算とロード/描画
                // ここで `handleBlockAndRender` -> `renderBlock` が呼ばれる
                // `renderBlock` 内で `drawBlockLabels` が呼ばれ、上記1で設定されたdisplay状態に従ってDOMが生成される
                this.updateVisibleBlocks(event.transform);

                // 4. [Safety] 既存の描画済みブロックに対しても強制的に更新をかける
                // updateVisibleBlocks は「新規」や「範囲外」の処理が主だが、
                // 既存ブロックのラベル表示切り替え(2.0x未満<->以上)を確実に行うため
                if (event.transform.k >= 2.0) {
                    this.blocks.forEach(b => {
                        if (b.rendered && b.visible) {
                            this.drawBlockLabels(b);
                            this.drawBlockSettlements(b);
                        }
                    });
                }

                this.svg.style('cursor', 'grab');
                this.updateMinimapViewport();
                this.updateJapanLayer();
            });

        this.svg.call(this.zoom);
    }

    /**
     * 初期表示位置を設定します。
     * configで指定された初期座標にフォーカスします。
     */
    setInitialView() {
        const svgNode = this.svg.node() as Element; // Cast to Element
        const width = svgNode ? svgNode.clientWidth || window.innerWidth : window.innerWidth;
        const height = svgNode ? svgNode.clientHeight || window.innerHeight : window.innerHeight;

        let initialCx = 0;
        let initialCy = 0;

        if (config.INITIAL_ZOOM_LOC) {
            let nEe, nNn, lx, ly;
            // フォーマット解析: '5012' -> EE=50, ee=12 など
            // あるいは { x: 5012, y: 7308 } オブジェクト

            if (typeof config.INITIAL_ZOOM_LOC === 'object') {
                const xx = config.INITIAL_ZOOM_LOC.x;
                const yy = config.INITIAL_ZOOM_LOC.y;
                nEe = Math.floor(xx / 100);
                nNn = Math.floor(yy / 100);
                lx = xx % 100;
                ly = yy % 100;
            } else {
                nEe = 50; nNn = 73; lx = 11; ly = 9; // デフォルトフォールバック
            }

            const relativeBx = nEe - BLOCK_START_EE;
            // 北がプラス (上)。画面座標では下がプラス。Nが大きいほどYインデックスは小さい。
            const relativeBy = BLOCK_END_NN - nNn;

            const hexWidth = 2 * config.r;
            const hexHeight = Math.sqrt(3) * config.r;
            const blockWidthPx = this.BLOCK_COLS * (hexWidth * 0.75);
            const blockHeightPx = this.BLOCK_ROWS * hexHeight;

            // Block 48 start からの相対ピクセル座標
            initialCx = relativeBx * blockWidthPx + lx * (hexWidth * 0.75);
            initialCy = relativeBy * blockHeightPx + ly * hexHeight;
        }

        // [NEW] 初期位置を「原点」として設定
        this.coordSys.setOrigin(initialCx, initialCy);

        const initialScale = config.INITIAL_SCALE || 3.0;

        // [NEW] 原点=中心なので、画面中央(width/2, height/2)に(0,0)を持ってくる変換
        // つまり translate(width/2, height/2)
        const initialTransform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(initialScale);

        this.svg.call(this.zoom.transform, initialTransform);
        this.currentTransform = initialTransform;
        this.updateVisibleBlocks(initialTransform); // これも修正が必要（後述）
        this.updateMinimap();
    }

    // ================================================================
    // Rendering & Layers (描画とレイヤー管理)
    // ================================================================

    /**
     * 指定されたレイヤーの表示/非表示を切り替えます。
     * @param {string} layerName - レイヤー名
     * @param {boolean|null} forceVisible - 強制的にこの状態にする (nullならトグル)
     * @returns {boolean} 新しい表示状態
     */
    toggleLayer(layerName: string, forceVisible: boolean | null = null): boolean {
        const layer = this.layers[layerName];
        if (!layer) return false;

        const newState = forceVisible !== null ? forceVisible : !((layer as any).visible);
        (layer as any).visible = newState;

        // ズーム依存レイヤーの場合は、updateZoomDependentLayersに描画判定を委譲
        if (['contour', 'labels', 'block-id-labels', 'hex-border'].includes(layerName)) {
            const currentScale = this.currentTransform ? this.currentTransform.k : 1.0;
            this.updateZoomDependentLayers(currentScale);
        } else {
            layer.style('display', newState ? 'inline' : 'none');
        }

        // 集落レイヤーの場合、関連するラベルや国境も連動
        if (layerName === 'settlement') {
            const labelsLayer = this.layers['labels'];
            if (labelsLayer) {
                labelsLayer.selectAll('.settlement-label').style('display', newState ? 'inline' : 'none');
            }
            this.toggleLayer('border', newState);
        }

        // 複合表示に関わるレイヤー群
        const compositeLayers = [
            'terrain',
            'white-map-overlay',
            'vegetation-overlay',
            'snow',
            'shading',
            'territory-overlay',
            'climate-zone-overlay',
            'temp-overlay',
            'precip-overlay',
            'population-overlay',
            'monster-overlay',
            'mana-overlay',
            'agri-overlay',
            'forest-overlay',
            'mining-overlay',
            'fishing-overlay',
            'hunting-overlay',
            'pastoral-overlay',
            'livestock-overlay'
        ];

        // 複合レイヤーの場合はヘックスの色を再計算
        if (compositeLayers.includes(layerName)) {
            this.updateAllHexColors();
        }

        this.updateVisibleBlocks(this.currentTransform);

        if (layerName === 'japan-overlay' && newState) {
            this.updateJapanLayer();
        }

        return newState;
    }

    /**
     * ヘックスの合成色を計算します。
     * 標高、地形、植生、各種オーバーレイをブレンドして最終的な表示色を決定します。
     * @param {Object} d - ヘックスデータ
     * @returns {string} RGBカラー文字列
     */
    calculateCompositeColor(d: any) {
        const p = d.properties;
        const isWhiteMap = (document.querySelector('input[name="map-type"][value="white"]') as HTMLInputElement)?.checked;

        let baseColor: string;
        if (isWhiteMap) {
            baseColor = d.properties.isWater ? config.WHITE_MAP_COLORS.WATER : config.whiteMapElevationColor(p.elevation);
        } else {
            if (p.isWater && p.elevation > 0) baseColor = config.TERRAIN_COLORS['湖沼'];
            else baseColor = config.getElevationColor(p.elevation);
        }

        let c: d3.Color | null = d3.color(baseColor);
        if (!c) c = d3.color('#000');

        if (!c) return '#000'; // Safety check

        // 植生のブレンド
        if (!p.isWater && (this.layers['vegetation-overlay'] as any)?.visible) {
            let displayVeg = p.vegetation;
            // 森林率が低い場合は草原として表示
            if ((displayVeg === '森林' || displayVeg === '針葉樹林') && p.landUse?.forest < 0.10) {
                displayVeg = '草原';
            }
            const vegColor = d3.color(config.TERRAIN_COLORS[displayVeg]);
            if (vegColor) {
                vegColor.opacity = 0.6;
                c = this.interpolateColor(c as d3.RGBColor, vegColor as d3.RGBColor);
            }
        }

        // 積雪のブレンド
        if (!p.isWater && (this.layers.snow as any)?.visible && p.hasSnow) {
            const snowColor = d3.color('#fff');
            if (snowColor) {
                snowColor.opacity = 0.8;
                c = this.interpolateColor(c as d3.RGBColor, snowColor as d3.RGBColor);
            }
        }

        // 各種オーバーレイの定義
        const overlayMap = [
            { name: 'climate-zone-overlay', func: (p: any) => config.CLIMATE_ZONE_COLORS[p.climateZone], opacity: 0.6 },
            { name: 'temp-overlay', func: (p: any) => config.tempColor(p.temperature), opacity: 0.6 },
            { name: 'precip-overlay', func: (p: any) => config.precipColor(p.precipitation_mm), opacity: 0.6 },
            { name: 'population-overlay', func: (p: any) => p.population > 0 ? config.populationColor(p.population) : null, opacity: 0.9 },
            { name: 'monster-overlay', func: (p: any) => p.monsterRank ? config.MONSTER_COLORS[p.monsterRank] : null, opacity: 0.5 },
            { name: 'mana-overlay', func: (p: any) => config.manaColor(p.manaValue), opacity: 0.6 },
            { name: 'agri-overlay', func: (p: any) => config.agriColor(p.agriPotential), opacity: 0.7 },
            { name: 'forest-overlay', func: (p: any) => config.forestColor(p.forestPotential), opacity: 0.7 },
            { name: 'mining-overlay', func: (p: any) => config.miningColor(p.miningPotential), opacity: 0.7 },
            { name: 'fishing-overlay', func: (p: any) => config.fishingColor(p.fishingPotential), opacity: 0.7 },
            { name: 'hunting-overlay', func: (p: any) => config.huntingColor(p.huntingPotential), opacity: 0.7 },
            { name: 'pastoral-overlay', func: (p: any) => config.pastoralColor(p.pastoralPotential), opacity: 0.7 },
            { name: 'livestock-overlay', func: (p: any) => config.livestockColor(p.livestockPotential), opacity: 0.7 }
        ];

        // 資源系オーバーレイが有効な場合、背景を暗くして視認性を上げる
        const isResourceActive = overlayMap.slice(5).some(l => this.layers[l.name] && (this.layers[l.name] as any).visible);
        if (isResourceActive) {
            const cStr = c ? c.formatRgb() : '#000';
            const hsl = d3.hsl(cStr);
            hsl.s *= 0.3;
            hsl.l = Math.min(1, hsl.l * 1.4);
            c = hsl.rgb();
        }

        // オーバーレイ色の適用
        overlayMap.forEach(l => {
            if ((this.layers[l.name] as any)?.visible) {
                let colorVal = null;

                if (l.name === 'climate-zone-overlay') {
                    const cz = p.climateZone;
                    if (cz) {
                        colorVal = config.CLIMATE_ZONE_COLORS[cz];
                    }
                } else {
                    colorVal = l.func(p);
                }

                if (colorVal) {
                    const col = d3.color(colorVal);
                    if (col) {
                        col.opacity = l.opacity;
                        c = this.interpolateColor(c as d3.RGBColor, col as d3.RGBColor);
                    }
                }
            }
        });

        // 領土オーバーレイ
        if ((this.layers['territory-overlay'] as any)?.visible && p.nationId > 0) {
            const tColor = d3.color(this.nationColor(String(p.nationId)));
            if (tColor) {
                tColor.opacity = 0.7;
                c = this.interpolateColor(c as d3.RGBColor, tColor as d3.RGBColor);
            }
        }

        // 陰影処理 (Relief Shading)
        if ((this.layers.shading as any)?.visible) {
            const val = p.shadingValue || 0;
            const opacity = d3.scaleLinear().domain([0, 400]).range([0, 0.2]).clamp(true)(Math.abs(val));
            const shadeColor = d3.color(val > 0 ? '#fff' : '#000');
            if (shadeColor) {
                shadeColor.opacity = opacity;
                c = this.interpolateColor(c as d3.RGBColor, shadeColor as d3.RGBColor);
            }
        }

        return c ? c.formatRgb() : '#000';
    }

    /**
     * 2つの色をアルファブレンディングします。
     * @param {Object} base - ベースカラー (d3.color object)
     * @param {Object} overlay - 重ねる色 (d3.color object)
     * @returns {Object} ブレンド後の色 (d3.rgb)
     */
    interpolateColor(base: d3.RGBColor | d3.HSLColor, overlay: d3.RGBColor | d3.HSLColor): d3.RGBColor {
        if (!base || !overlay) return (base as d3.RGBColor) || (overlay as d3.RGBColor);
        const alpha = overlay.opacity;
        if (Number.isNaN(alpha)) return base as d3.RGBColor;
        const invAlpha = 1 - alpha;

        const bRef = d3.rgb(base);
        const oRef = d3.rgb(overlay);

        return d3.rgb(
            oRef.r * alpha + bRef.r * invAlpha,
            oRef.g * alpha + bRef.g * invAlpha,
            oRef.b * alpha + bRef.b * invAlpha
        );
    }

    /**
     * 全てのヘックスの表示色を更新します。
     * レイヤーの切り替え時などに呼び出されます。
     */
    updateAllHexColors() {
        if (!this.blocks) return;
        this.blocks.forEach(block => {
            if (block.hexes) {
                block.hexes.forEach((d: any) => {
                    d._displayColor = this.calculateCompositeColor(d);
                });
            }
            if (block.rendered) {
                this.layers['terrain'].select(`#terrain-${block.id}`).selectAll('.hex')
                    .attr('fill', (d: any) => d._displayColor || '#000');
            }
        });
    }

    /**
     * 河川の色を更新します。
     * 通常の水色、白地図用、稜線確認用などで切り替えます。
     */
    updateRiverColor() {
        const isRidge = (this.layers['ridge-water-system'] as any)?.visible;
        const isWhite = (document.querySelector('input[name="map-type"][value="white"]') as HTMLInputElement)?.checked;
        const color = isRidge ? config.RIDGE_WATER_SYSTEM_COLORS.RIVER : (isWhite ? config.WHITE_MAP_COLORS.WATER : config.TERRAIN_COLORS.水域);
        this.layers.river.selectAll('path').attr('stroke', color);
        // 稜線水系ヘックス
        this.layers['ridge-water-system'].selectAll('.rws-water-hex').attr('fill', color);
    }

    /**
     * 日本地図オーバーレイを更新します。
     */
    updateJapanLayer() {
        if (this.layers['japan-overlay'] && (this.layers['japan-overlay'] as any).visible) {
            const svgNode = this.svg.node() as Element; // Cast
            const width = svgNode ? svgNode.clientWidth || window.innerWidth : window.innerWidth;
            const height = svgNode ? svgNode.clientHeight || window.innerHeight : window.innerHeight;
            this.japanOverlay.draw(this.layers['japan-overlay'], this.coordSys, width, height);
        }
    }

    // ================================================================
    // Floating Origin Logic
    // ================================================================

    /**
     * [NEW] Floating Origin Recenter Logic
     * 現在のビューポート中心が原点から離れすぎている場合、原点をリセットします。
     * @param {Object} currentTransform - D3 Zoom Transform
     * @returns {boolean} - true if recenter occurred
     */
    handleRecenter(currentTransform) {
        if (!this.coordSys) return false;

        const svgNode = this.svg.node() as Element; // Cast
        const width = svgNode.clientWidth || window.innerWidth;
        const height = svgNode.clientHeight || window.innerHeight;
        const scale = currentTransform.k;

        // Check if recenter is needed
        const newOrigin = this.coordSys.checkReCenter(
            currentTransform.x, currentTransform.y,
            scale, width, height
        );

        if (newOrigin) {
            const oldOrigin = this.coordSys.getOrigin();

            // 1. Update Origin
            this.coordSys.setOrigin(newOrigin.x, newOrigin.y);

            // 2. Calculate Shift (World Space)
            // Shift = New - Old
            const shiftX = newOrigin.x - oldOrigin.x;
            const shiftY = newOrigin.y - oldOrigin.y;

            // 3. Adjust Viewport Transform (Screen Space)
            // tX_new = tX_old + Shift * k
            const newTx = currentTransform.x + shiftX * scale;
            const newTy = currentTransform.y + shiftY * scale;

            console.log(`[MapView] Recenter Triggered! Shift:(${Math.round(shiftX)},${Math.round(shiftY)}) NewT:(${Math.round(newTx)},${Math.round(newTy)})`);

            // 4. Apply new transform silently to D3 state
            const newTransform = d3.zoomIdentity.translate(newTx, newTy).scale(scale);

            // Flag to prevent recursion in zoom events
            this.isProgrammaticZoom = true;
            this.svg.call(this.zoom.transform, newTransform);
            this.isProgrammaticZoom = false;

            this.currentTransform = newTransform;

            // 5. Invalidate all rendered blocks to force coordinate update
            this.blocks.forEach(b => {
                b.rendered = false;
            });

            return true;
        }

        return false;
    }

    // ================================================================
    // Block Management (ブロック管理)
    // ================================================================

    /**
     * 現在のビューに基づいて可視ブロックを判定し、ロード/アンロードを行います。
     * @param {Object} transform - 現在のD3 Zoom Transform
     */
    updateVisibleBlocks(transform) {
        if (!this.svg) return;
        const svgNode = this.svg.node() as Element; // Cast
        const width = svgNode ? svgNode.clientWidth || window.innerWidth : window.innerWidth;
        const height = svgNode ? svgNode.clientHeight || window.innerHeight : window.innerHeight;

        // [FIX] CoordinateSystem 対応
        // 画面の四隅の座標をワールド座標に変換して可視ブロックを判定

        // 1. スクリーン座標 (0,0) -> Transform逆変換(Zoom) -> RelativeView座標 -> World座標
        // d3.zoomTransform.invert は (Screen - Translate) / Scale を返す
        const topLeftView = transform.invert([0, 0]); // Relative View Coords
        const bottomRightView = transform.invert([width, height]);

        const topLeftWorld = this.coordSys.fromView(topLeftView[0], topLeftView[1]);
        const bottomRightWorld = this.coordSys.fromView(bottomRightView[0], bottomRightView[1]);

        // 画面中央 (ワールド座標) - ソート用
        const worldCenter = this.coordSys.fromView(
            (topLeftView[0] + bottomRightView[0]) / 2,
            (topLeftView[1] + bottomRightView[1]) / 2
        );

        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;
        const blockWidthPx = this.BLOCK_COLS * (hexWidth * 0.75);
        const blockHeightPx = this.BLOCK_ROWS * hexHeight;

        // 相対ブロック座標の計算 (0-based from Block BLOCK_START_EE, BLOCK_START_NN)
        // [FIX] 厳密な可視性: 隣接ブロックの予備ロードは行わない (BUFFER = 0)
        // ユーザー要件: 厳密に見えているものだけをロードする
        // [FIX] Expand render range to Top and Left as requested to prevent background gaps
        const BUFFER = 0;
        const relBxMin = Math.floor(topLeftWorld.x / blockWidthPx) - BUFFER - 1; // Add Left
        const relBxMax = Math.floor(bottomRightWorld.x / blockWidthPx) + BUFFER;
        const relByMin = Math.floor(topLeftWorld.y / blockHeightPx) - BUFFER - 1; // Add Top
        const relByMax = Math.floor(bottomRightWorld.y / blockHeightPx) + BUFFER;

        const visibleIds = new Set();
        let activeBlocks = [];

        for (let rby = relByMin; rby <= relByMax; rby++) {
            for (let rbx = relBxMin; rbx <= relBxMax; rbx++) {
                // 絶対IDの決定
                const absEe = rbx + BLOCK_START_EE;
                // N軸の反転: relBy=0 は Top (北, Max N), relBy=MAX は Bottom (南, Min N)
                const absNn = BLOCK_END_NN - rby;

                const id = `map_${absEe}_${absNn}`;
                visibleIds.add(id);

                let block = this.blocks.find(b => b.id === id);
                if (!block) {
                    // IDと相対インデックスを持ったブロックオブジェクトを作成
                    block = this.createBlock(id, rbx, rby, absEe, absNn);
                    this.blocks.push(block);
                }
                block.visible = true;
                activeBlocks.push(block);
            }
        }

        // デバッグログ (必要に応じて有効化)
        // console.log(`[MapView Debug] Visible IDs: ${Array.from(visibleIds).join(', ')}`);

        // ワールド中心からの距離でブロックをソート (中心に近い順に描画するため)
        activeBlocks.sort((a, b) => {
            const acx = (a.relBx + 0.5) * blockWidthPx;
            const acy = (a.relBy + 0.5) * blockHeightPx;
            const bcx = (b.relBx + 0.5) * blockWidthPx;
            const bcy = (b.relBy + 0.5) * blockHeightPx;

            const distA = (acx - worldCenter.x) ** 2 + (acy - worldCenter.y) ** 2;
            const distB = (bcx - worldCenter.x) ** 2 + (bcy - worldCenter.y) ** 2;
            return distA - distB;
        });

        // 可視ブロックのグループ要素を確保
        const allLayerNames = Object.keys(this.layers);
        allLayerNames.forEach(name => {
            if (!this.layers[name]) return;
            this.layers[name].selectAll(`.block-group-${name}`)
                .data(activeBlocks, (d: any) => d.id)
                .join(
                    enter => enter.append('g')
                        .attr('class', `block-group block-group-${name}`)
                        .attr('id', d => `${name}-${d.id}`),
                    update => update,
                    exit => exit.remove()
                );
        });

        // ブロックの処理と描画
        activeBlocks.forEach(block => {
            this.handleBlockAndRender(block);
        });

        // 非表示ブロックのクリーンアップ
        this.blocks.forEach(b => {
            if (!visibleIds.has(b.id)) {
                if (b.rendered) {
                    this.unloadBlockDOM(b);
                }
                b.visible = false;
            }
        });

        // [FIX] Unified Contours Update
        // ビューポートが変わった（パン/ズーム）ので、可視範囲の等高線を再生成するようリクエスト
        // （各ブロックの描画がスキップされた場合でも、等高線だけは更新する必要があるため）
        this.drawVisibleContours();
    }

    createBlock(id, rbx, rby, absEe, absNn) {
        return {
            id: id,
            relBx: rbx, // ピクセル計算用の0始まり相対インデックス
            relBy: rby,
            absEe: absEe,
            absNn: absNn,
            hexes: [],
            rendered: false,
            visible: true,
            loaded: false,
            loading: false
        };
    }

    /**
     * ブロックのロード、データ生成、描画を管理するプロセス。
     * @param {Object} block - 対象ブロック
     */
    handleBlockAndRender(block) {
        // 既に描画済みなら何もしない (表示切替はupdateVisibleBlocksで行われる)
        if (block.rendered) {
            return Promise.resolve();
        }

        if (!block.loaded && !block.loading) {
            if (this.blockLoaderRef) {
                block.loading = true;
                return this.blockLoaderRef.load(block.id, { allHexes: this.hexes }).then(async success => {
                    block.loading = false;
                    block.loaded = true;
                    if (success) {
                        // データはローダーによってグローバルのthis.hexesにセットされていると仮定
                        // バッファが有効なうちにスクリーンバッファ (block.hexes) を作成
                        this.generateBlockHexes(block);
                    } else {
                        // ダミーデータで埋める
                        await this.ensureDummyData(block);
                        this.generateBlockHexes(block);
                    }
                    // [Safety] hexesが何らかの理由で空なら再生成を試みる
                    if (!block.hexes || block.hexes.length === 0) {
                        console.warn(`[MapView] Block ${block.id} loaded but hexes empty. Regenerating...`);
                        this.generateBlockHexes(block);
                    }
                    this.renderBlock(block);
                }).catch(err => {
                    console.error(`[MapView] Load Error for ${block.id}:`, err);
                    block.loading = false;
                    // フォールバック
                    this.ensureDummyData(block).then(() => {
                        this.generateBlockHexes(block);
                        this.renderBlock(block);
                    });
                });
            } else {
                block.loaded = true;
                // ローダーがない場合はダミー生成
                return this.ensureDummyData(block).then(() => {
                    this.generateBlockHexes(block);
                    this.renderBlock(block);
                });
            }
        } else if (block.loaded && !block.rendered) {
            // ロード済みだが未描画の場合
            // [Safety] hexesチェック
            if (!block.hexes || block.hexes.length === 0) {
                this.generateBlockHexes(block);
            }
            this.renderBlock(block);
            return Promise.resolve();
        }
        return Promise.resolve();
    }

    // [FEAT] Relief Shading Logic (陰影処理ロジック)
    /**
     * 南のヘックスと北のヘックスの標高差に基づいて、陰影値を計算します。
     * @param {Object} hex - 対象ヘックス
     * @param {Object} northHex - 北側のヘックス
     * @param {Object} southHex - 南側のヘックス
     */
    applyRelief(hex, northHex, southHex) {
        // [RESTORE] オリジナルのロジック (ui.js参照)
        // 南 > 北 -> 正 (明るい)
        // 北 > 南 -> 負 (暗い)

        const delta = (southHex.elevation - northHex.elevation);
        hex.shadingValue = delta;

        // すぐに反映する場合（この部分は calculateCompositeColor でも使用されるので冗長かもしれないが、
        // データのshadingValueを確定させる意味で保持）
        if (this.layers.shading && (this.layers.shading as any).visible) {
            const val = hex.shadingValue;
            // Opacity計算: 標高差400mで最大0.2
            const opacity = Math.min(0.2, Math.abs(val) / 400 * 0.2);
            const shading = val > 0 ? opacity : -opacity;

            hex._displayColor = this.adjustBrightness(hex._displayColor, shading);
        }
    }

    /**
     * 色の明るさを調整します。
     * @param {string} hexColor - 元の色 (#RRGGBB)
     * @param {number} percent - 調整割合 (-1.0 ～ 1.0)
     * @returns {string} 調整後の色
     */
    adjustBrightness(hexColor, percent) {
        if (!hexColor || typeof hexColor !== 'string') return hexColor;
        // 簡易的なRGB調整
        if (hexColor.length < 7) return hexColor;

        let r = parseInt(hexColor.substr(1, 2), 16);
        let g = parseInt(hexColor.substr(3, 2), 16);
        let b = parseInt(hexColor.substr(5, 2), 16);

        if (percent > 0) {
            // 明るくする: 255に近づける
            r = r + (255 - r) * percent;
            g = g + (255 - g) * percent;
            b = b + (255 - b) * percent;
        } else {
            // 暗くする: 0に近づける
            const p = Math.abs(percent);
            r = r * (1 - p);
            g = g * (1 - p);
            b = b * (1 - p);
        }

        r = Math.min(255, Math.max(0, Math.round(r)));
        g = Math.min(255, Math.max(0, Math.round(g)));
        b = Math.min(255, Math.max(0, Math.round(b)));

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * ブロックに関連付けられたDOM要素を削除します。
     * @param {Object} block 
     */
    unloadBlockDOM(block) {
        Object.keys(this.layers).forEach(name => {
            const sel = this.layers[name].select(`#${name}-${block.id}`);
            if (!sel.empty()) {
                sel.remove();
            }
        });
        block.rendered = false;
    }

    /**
     * ブロックロード失敗時などに呼び出され、ダミーデータで埋めます。
     * シームレスな海域表示や、欠損データの補完に使用されます。
     */
    async ensureDummyData(block) {
        console.log(`[MapView Debug] ensureDummyData called for ${block.id}`);
        block.isDummy = true;

        const CORE_COL = 23;
        const CORE_ROW = 20;
        const GLOBAL_OFFSET_X = 1;
        const GLOBAL_OFFSET_Y = 1;

        // 隣接データ検索ヘルパー
        const getLoadedNeighborHex = (gloCol, gloRow) => {
            for (const b of this.blocks) {
                if (b.id === block.id) continue;
                if (!b.loaded || !b.hexes || b.hexes.length === 0) continue;

                const found = b.hexes.find(h => h.col === gloCol && h.row === gloRow);
                if (found) return found;
            }
            return null;
        };

        // Declare variables first
        let absNn = block.absNn;
        let absEe = block.absEe;

        if (absNn === undefined) { const p = block.id.split('_'); absNn = parseInt(p[2]); absEe = parseInt(p[1]); }
        if (absEe === undefined) { const p = block.id.split('_'); absEe = parseInt(p[1]); }

        // [FIX] 隣接ブロックの事前ロード (シームレスな境界のため)
        const neighborIds: string[] = [
            `map_${String(absEe + 1).padStart(2, '0')}_${String(absNn).padStart(2, '0')}`, // 右
            `map_${String(absEe - 1).padStart(2, '0')}_${String(absNn).padStart(2, '0')}`, // 左
            `map_${String(absEe).padStart(2, '0')}_${String(absNn + 1).padStart(2, '0')}`, // 上
            `map_${String(absEe).padStart(2, '0')}_${String(absNn - 1).padStart(2, '0')}`  // 下
        ];

        // 未ロードの隣接ブロックがあればロードをトリガー
        const loadPromises: Promise<any>[] = [];
        for (const nid of neighborIds) {
            const nb = this.blocks.find(b => b.id === nid);
            if (nb && !nb.loaded && !nb.loading) {
                console.log(`[MapView] ensureDummyData(${block.id}): Triggering dependency load for neighbor ${nid}`);
                loadPromises.push(this.handleBlockAndRender(nb));
            }
        }
        if (loadPromises.length > 0) {
            await Promise.all(loadPromises);
        }

        const coreStartCol = GLOBAL_OFFSET_X + (absEe - BLOCK_START_EE) * CORE_COL;
        const coreStartRow = GLOBAL_OFFSET_Y + (absNn - BLOCK_START_NN) * CORE_ROW;

        const TOTAL_ROW = 22;
        const TOTAL_COL = 25;

        block.hexes = [];

        for (let lr = 0; lr < TOTAL_ROW; lr++) {
            for (let lc = 0; lc < TOTAL_COL; lc++) {
                // グローバル座標
                const c = coreStartCol + (lc - 1);
                const r = coreStartRow + (CORE_ROW - 1) - (lr - 1);

                // ローカルインデックスを使用してバッファにアクセス (ここも修正が必要な可能性あり)
                const hexIndex = getIndex(lc, lr);
                const hex = this.hexes[hexIndex]; // Flyweightへのアクセス

                // 1. データを完全にリセット (古いバッファをクリア)
                hex.col = c;
                hex.row = r;

                // フラグ初期化
                hex.isWater = true;
                hex.isAlluvial = false;
                hex.hasSnow = false;
                hex.isCoastal = false;
                hex.isLakeside = false;

                // 数値データの初期化
                hex.elevation = -1;
                hex.temperature = 0;
                hex.precipitation_mm = 0;
                hex.precipitation = 0;
                hex.climate = 0;
                hex.flow = 0;
                hex.ridgeFlow = 0;
                hex.riverWidth = 0;
                hex.riverDepth = 0;
                hex.riverVelocity = 0;
                hex.waterArea = 0; // 海洋
                hex.beachArea = 0;
                hex.inflowCount = 0;
                hex.Qin = 0;

                // ID/列挙型などの初期化
                hex.climateZone = null;
                hex.vegetation = '海洋';
                hex.terrainType = '海洋';
                hex.settlement = null;
                hex.manaRank = null;
                hex.resourceRank = null;
                hex.monsterRank = null;
                hex.nationId = 0;
                hex.territoryId = -1;
                hex.parentHexId = -1;

                // ポテンシャル初期化
                hex.manaValue = 0;
                hex.agriPotential = 0;
                hex.forestPotential = 0;
                hex.miningPotential = 0;
                hex.fishingPotential = 0;
                hex.huntingPotential = 0;
                hex.pastoralPotential = 0;
                hex.livestockPotential = 0;
                hex.cultivatedArea = 0;
                hex.habitability = 0;

                // 人口・道路など
                hex.population = 0;
                hex.distanceToParent = 0;
                hex.travelDaysToParent = 0;
                hex.roadLevel = 0;
                hex.roadUsage = 0;
                hex.roadLoss = 0;

                // 複雑なオブジェクト (null埋め)
                hex.industry = null;
                hex.demographics = null;
                hex.facilities = null;
                hex.production = null;
                hex.surplus = null;
                hex.shortage = null;
                hex.territoryData = null;
                hex.beachNeighbors = null;
                hex.vegetationAreas = null;
                hex.logistics = null;
                hex.livingConditions = null;
                hex.ships = null;

                hex.downstreamIndex = -1;
                hex.ridgeUpstreamIndex = -1;

                // 2. オーバーラップチェックとコピー (シームレス性の確保)
                // オーバーラップゾーン: 西端(lc=0), 東端(lc=24), 北端(lr=0), 南端(lr=21)
                const isOverlap = (lc === 0 || lc === 24 || lr === 0 || lr === 21);

                if (isOverlap) {
                    const neighbor = getLoadedNeighborHex(c, r);
                    if (neighbor) {
                        // 既知の隣接データがあれば、見た目の整合性のためにコピー
                        hex.terrainType = neighbor.terrainType;
                        hex.elevation = neighbor.elevation;
                        hex.isWater = neighbor.isWater;
                        hex.vegetation = neighbor.vegetation;
                    }
                }
            }
        }
    }



    /**
     * ブロックごとの描画用スクリーンバッファ (block.hexes) を生成します。
     * グローバルな共有バッファ (this.hexes) から、このブロックに必要な部分をクローンして保持します。
     * @param {Object} block - 対象ブロック
     */
    generateBlockHexes(block) {
        block.hexes = [];
        const CORE_COL = 23;
        const CORE_ROW = 20;
        const GLOBAL_OFFSET_X = 1;
        const GLOBAL_OFFSET_Y = 1;
        const BUFFER = 1;

        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;

        // 相対的なコア開始位置の計算
        let absNn = block.absNn;
        if (absNn === undefined) {
            const parts = block.id.split('_');
            absNn = parseInt(parts[2], 10);
        }
        let absEe = block.absEe;
        if (absEe === undefined) {
            const parts = block.id.split('_');
            absEe = parseInt(parts[1], 10);
        }

        const coreStartCol = GLOBAL_OFFSET_X + (absEe - BLOCK_START_EE) * CORE_COL;
        const coreStartRow = GLOBAL_OFFSET_Y + (absNn - BLOCK_START_NN) * CORE_ROW;

        // [FIX] フルバッファ範囲ではなく、コア+αの範囲に絞る
        // 前回の修正で厳密なビューだけを描画することになったため、範囲を調整
        // バッファアクセス: 0=Pad, 1=CoreStart ...
        // コア: lc=1..23, lr=1..20
        const rowStart = 1;
        const rowEnd = 21;
        const colStart = 1;
        const colEnd = 24;

        for (let lr = rowStart; lr < rowEnd; lr++) {
            for (let lc = colStart; lc < colEnd; lc++) {

                const c = coreStartCol + (lc - 1);

                // [FIX] 垂直方向の反転
                // バッファは左上(Row 1)が北。ワールド座標はRow 0が南。
                // lr: 1..20
                // r: (coreStartRow + 19) .. coreStartRow
                const r = coreStartRow + (CORE_ROW - 1) - (lr - 1);

                // [CRITICAL] ローカルインデックスを使用
                const hexIndex = getIndex(lc, lr);
                let sourceHex;
                // [FIX] Use getHex if WorldMap instance, or array access if array
                if ((this.hexes as any).getHex) {
                    sourceHex = (this.hexes as any).getHex(hexIndex);
                } else {
                    sourceHex = this.hexes[hexIndex];
                }

                // 表示用のローカル座標 (01-23)
                const localCol = lc;
                // [FIX] プロパティ用のローカル行番号反転
                // lr=1 (物理的に北) -> Spec North is 20
                const localRow = (CORE_ROW + 1) - lr;

                let hex;
                if (sourceHex) {
                    // [CRITICAL] 共有バッファからのクローン
                    // 後続のブロックロードによる上書きを防ぐため、値をコピーする
                    hex = {
                        index: sourceHex.index,
                        col: c, // Global Col
                        row: r, // Global Row

                        // プロパティの明示的コピー
                        isWater: sourceHex.isWater,
                        terrainType: sourceHex.terrainType,
                        elevation: sourceHex.elevation,
                        vegetation: sourceHex.vegetation,

                        flow: sourceHex.flow,
                        riverWidth: sourceHex.riverWidth,
                        waterArea: sourceHex.waterArea,
                        downstreamIndex: sourceHex.downstreamIndex,

                        isAlluvial: sourceHex.isAlluvial,
                        isCoastal: sourceHex.isCoastal,
                        isLakeside: sourceHex.isLakeside,

                        ridgeFlow: sourceHex.ridgeFlow,
                        ridgeUpstreamIndex: sourceHex.ridgeUpstreamIndex,

                        settlement: sourceHex.settlement,
                        population: sourceHex.population,
                        roadLevel: sourceHex.roadLevel,

                        temperature: sourceHex.temperature,
                        precipitation_mm: sourceHex.precipitation_mm,
                        climateZone: sourceHex.climateZone,

                        monsterElement: sourceHex.monsterElement,
                        monsterDanger: sourceHex.monsterDanger,
                        monsterRank: sourceHex.monsterRank,

                        // ポテンシャル
                        manaValue: sourceHex.manaValue,
                        agriPotential: sourceHex.agriPotential,
                        forestPotential: sourceHex.forestPotential,
                        miningPotential: sourceHex.miningPotential,
                        fishingPotential: sourceHex.fishingPotential,
                        huntingPotential: sourceHex.huntingPotential,
                        pastoralPotential: sourceHex.pastoralPotential,
                        livestockPotential: sourceHex.livestockPotential,

                        // 複合オブジェクト
                        landUse: sourceHex.landUse ? { ...sourceHex.landUse } : {},
                        vegetationAreas: sourceHex.vegetationAreas ? { ...sourceHex.vegetationAreas } : null,
                        industry: sourceHex.industry ? { ...sourceHex.industry } : null,
                        logistics: sourceHex.logistics ? { ...sourceHex.logistics } : null,
                        livingConditions: sourceHex.livingConditions ? { ...sourceHex.livingConditions } : null,
                        ships: sourceHex.ships ? { ...sourceHex.ships } : null,
                        facilities: sourceHex.facilities ? { ...sourceHex.facilities } : null,
                        production: sourceHex.production ? { ...sourceHex.production } : null,
                        surplus: sourceHex.surplus ? { ...sourceHex.surplus } : null,
                        shortage: sourceHex.shortage ? { ...sourceHex.shortage } : null,

                        // IDs
                        nationId: sourceHex.nationId,
                        territoryId: sourceHex.territoryId,
                        blockId: sourceHex.properties ? sourceHex.properties.blockId : (sourceHex.blockId || block.id),

                        // 隣接情報 (配列コピー)
                        neighbors: sourceHex.neighbors ? [...sourceHex.neighbors] : [],
                        beachNeighbors: sourceHex.beachNeighbors ? [...sourceHex.beachNeighbors] : [],

                        resourceRank: sourceHex.resourceRank,
                        manaRank: sourceHex.manaRank,

                        properties: {}, // プロキシ用ターゲット

                        // ベースカラーのコピー
                        _displayColor: sourceHex._displayColor || (config.WHITE_MAP_COLORS && config.WHITE_MAP_COLORS.WATER ? config.WHITE_MAP_COLORS.WATER : '#eef6f6')
                    };

                    // [FIX] 互換性
                    hex.properties = hex;
                    if (!hex._displayColor) hex._displayColor = '#eef6f6';

                } else {
                    // ダミー (generateBlockHexes内でのフォールバック)
                    hex = {
                        col: c,
                        row: r,
                        isWater: true,
                        terrainType: '海洋',
                        elevation: -1,
                        vegetation: '海洋',
                        properties: {},
                        _displayColor: config.TERRAIN_COLORS['海洋'] || '#8cf'
                    };
                    hex.properties = hex;
                    hex.shadingValue = 0;
                }

                // [FEAT] 陰影処理の適用
                // パディング領域(lr-1, lr+1)を使用して計算
                const northIdx = getIndex(lc, lr - 1);
                const southIdx = getIndex(lc, lr + 1);
                const northHex = this.hexes[northIdx];
                const southHex = this.hexes[southIdx];

                if (northHex && southHex) {
                    this.applyRelief(hex, northHex, southHex);
                }

                // 表示用座標の割り当て
                hex.ee = absEe;
                hex.nn = absNn;
                hex.localCol = localCol;
                hex.localRow = localRow;
                // [FIX] バッファ不整合チェック用のブロックID
                hex.blockId = block.id;

                // ジオメトリ計算 (ピクセル空間)
                // グローバルRow 0 は最下部。ピクセルYは下に行くほど増える。
                const WORLD_ROWS = 2002;
                const cx = c * (hexWidth * 0.75) + config.r;
                const cy = ((WORLD_ROWS - 1) - r) * hexHeight + (c % 2 === 0 ? 0 : hexHeight / 2) + config.r;

                hex.cx = cx;
                hex.cy = cy;

                // ポリゴンポイント生成
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle_deg = 60 * i;
                    const angle_rad = Math.PI / 180 * angle_deg;
                    points.push([
                        cx + config.r * Math.cos(angle_rad),
                        cy + config.r * Math.sin(angle_rad)
                    ]);
                }
                hex.points = points;

                // 循環参照回避のためのプロパティ定義
                Object.defineProperty(hex, 'properties', {
                    get: function () { return this; },
                    enumerable: false,
                    configurable: true
                });

                // 色の即時計算
                hex._displayColor = this.calculateCompositeColor(hex);

                block.hexes.push(hex);
            }
        }

        // [FIX] 等高線描画のために allHexes にもセット
        block.allHexes = block.hexes;
    }

    /**
     * ブロックを描画します。
     * @param {Object} block - 描画対象のブロック
     */
    renderBlock(block) {
        if (!block.hexes || block.hexes.length === 0) {
            console.error(`[MapView] Block ${block.id} has 0 hexes. Data missing.`);
            return;
        }

        // 各レイヤーの描画関数を呼び出し
        this.drawBlockTerrain(block);
        this.drawBlockRivers(block); // 河川
        this.drawBlockBeaches(block); // 砂浜
        this.drawBlockBorders(block); // 国境
        this.drawBlockRidgeLines(block); // 稜線
        this.drawBlockContours(block); // 等高線
        this.drawBlockRoads(block); // 道路
        this.drawBlockSettlements(block); // 集落
        this.drawBlockLabels(block); // ラベル
        this.drawBlockHexBorders(block); // ヘックス枠
        this.drawBlockInteraction(block); // インタラクション領域
        this.drawBlockIdLabels(block); // ブロック番号(ズームアウト時)

        block.rendered = true;
    }

    // ================================================================
    // Drawing Functions (各種描画関数)
    // ================================================================

    /**
     * ブロックの地形を描画します。
     * @param {Object} block 
     */
    drawBlockTerrain(block) {
        const g = this.layers.terrain.select(`#terrain-${block.id}`);
        if (g.empty()) return;
        g.selectAll('.hex').data(block.hexes, (d: any) => d.index).join('polygon')
            .attr('class', 'hex')
            .attr('points', (d: any) => d.points.map(p => {
                // Points are absolute world coords in d.points
                // We need to shift them by (d.cx, d.cy) if logic expects local points, BUT
                // The original logic was: p[0] - d.cx. This converts Absolute Point -> Local Point (relative to hex center)
                // Then transform translates to d.cx (Absolute).
                // NEW LOGIC: Translate to toView(d.cx, d.cy). Points remain local relative to center.
                return `${p[0] - d.cx},${p[1] - d.cy}`;
            }).join(' '))
            .attr('transform', (d: any) => {
                const p = this.coordSys.toView(d.cx, d.cy);
                return `translate(${p.x}, ${p.y}) scale(1.01)`;
            })
            .attr('stroke', 'none')
            .attr('fill', (d: any) => d._displayColor || '#000');
    }

    /**
     * ブロックの河川を描画します。
     * @param {Object} block 
     */
    drawBlockRivers(block) {
        const g = this.layers.river.select(`#river-${block.id}`);
        if (g.empty()) return;

        const pathData = [];
        let riverCount = 0;
        let skippedWater = 0;

        // ジオメトリ保証ヘルパー
        const ensureGeometry = (h) => {
            if (h.points && h.cx !== undefined && h.cy !== undefined) return h;

            const hexWidth = 2 * config.r;
            const hexHeight = Math.sqrt(3) * config.r;
            const WORLD_ROWS = 2002;

            const c = h.col;
            const r = h.row;

            const cx = c * (hexWidth * 0.75) + config.r;
            const cy = ((WORLD_ROWS - 1) - r) * hexHeight + (c % 2 === 0 ? 0 : hexHeight / 2) + config.r;

            const points = [];
            for (let i = 0; i < 6; i++) {
                const angle_rad = Math.PI / 180 * (60 * i);
                points.push([
                    cx + config.r * Math.cos(angle_rad),
                    cy + config.r * Math.sin(angle_rad)
                ]);
            }
            return { ...h, cx, cy, points };
        };

        block.hexes.forEach(d => {
            if (d.properties.flow > 0) {
                if (!d.properties.isWater) {
                    riverCount++;
                    let downstream = null;

                    if (d.downstreamIndex !== -1) {
                        // [FIX] downstreamIndex is now a LOCAL BUFFER INDEX (0-550).
                        // Direct lookup in the hex buffer.
                        downstream = this.hexes[d.downstreamIndex];
                    }

                    if (!downstream) {
                        // Only log once
                        if (riverCount === 1) console.log(`[River Debug] Hex(${d.col},${d.row}) Flow=${d.properties.flow}: Downstream NOT FOUND. Index=${d.downstreamIndex}`);
                        return;
                    }

                    // Ensure downstream has geometry needed for edge calculation
                    downstream = ensureGeometry(downstream);

                    // [SIMPLIFIED MODE] User Request: "Draw 10px line towards lowest neighbor"
                    // Direction calculation
                    const dx = downstream.cx - d.cx;
                    const dy = downstream.cy - d.cy;
                    const angle = Math.atan2(dy, dx);

                    // Fixed length 10px (approx to edge)
                    const length = 10;
                    const endX = d.cx + Math.cos(angle) * length;
                    const endY = d.cy + Math.sin(angle) * length;

                    // [FIX] Transform to View Coords
                    const startView = this.coordSys.toView(d.cx, d.cy);
                    const endView = this.coordSys.toView(endX, endY);

                    // Draw Line: Center -> Edge direction
                    // Using predefined width or default
                    pathData.push({
                        path: `M ${startView.x},${startView.y} L ${endView.x},${endView.y}`,
                        width: d.properties.riverWidth || 1.0
                    });

                    // [TODO] Upstream calculation to be implemented in next step as requested.
                    /*
                    let end = getSharedEdgeMidpoint(d, downstream);
                    if (!end) {
                        // [FALLBACK] If shared edge is missing (precision issue?), draw to center.
                        // This ensures the river is visible even if geometry check fails.
                        end = [downstream.cx, downstream.cy];

                        // Log only once
                        if (riverCount === 1) {
                            console.log(`[River Debug] Hex(${d.col},${d.row}) -> Downstream(${downstream.col},${downstream.row}): Shared Edge NOT FOUND. Using Center fallback.`);
                        }
                    }

                    const cp = [d.cx, d.cy];

                    // Upstreams matching (Local Index)
                    const upstreams = (this.hexes || [])
                        .filter(h => h && h.downstreamIndex === d.index)
                        .map(h => ensureGeometry(h));

                    // [Debug Upstream Failure]
                    if (riverCount < 3 && upstreams.length === 0) {
                        console.log(`[River Debug] Hex(${d.col},${d.row}) Index=${d.index}: No upstreams found.`);
                        // Check neighbors manually
                        (d.neighbors || []).forEach(ni => {
                            // ni is Local Index in Buffer
                            const n = this.hexes[ni];
                            if (n) {
                                console.log(`  - Neighbor(${n.col},${n.row}) DS=${n.downstreamIndex} (Match? ${n.downstreamIndex === d.index})`);
                            }
                        });
                    }

                    if (upstreams.length === 0) {
                        const start = [d.cx, d.cy];
                        pathData.push({ path: `M ${start[0]},${start[1]} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, width: d.properties.riverWidth });
                    } else {
                        upstreams.forEach(u => {
                            const start = getSharedEdgeMidpoint(d, u);
                            if (start) {
                                pathData.push({ path: `M ${start[0]},${start[1]} Q ${cp[0]},${cp[1]} ${end[0]},${end[1]}`, width: u.properties.riverWidth });
                            } else {
                                if (riverCount < 3) console.log(`[River Debug] Hex(${d.col},${d.row}) <- Upstream(${u.col},${u.row}): Shared Edge Not Found.`);
                            }
                        });
                    }
                    */
                } else {
                    skippedWater++;
                }
            }
        });

        if (riverCount > 0 || skippedWater > 0) {
            console.log(`[River Debug] Block ${block.id}: Land Rivers=${riverCount}, Skipped Water=${skippedWater}, Generated Paths=${pathData.length}`);
        }

        const isRidge = (this.layers['ridge-water-system'] as any)?.visible;
        const isWhite = (document.querySelector('input[name="map-type"][value="white"]') as HTMLInputElement)?.checked;
        const color = isRidge ? config.RIDGE_WATER_SYSTEM_COLORS.RIVER : (isWhite ? config.WHITE_MAP_COLORS.WATER : config.TERRAIN_COLORS.水域);

        g.selectAll('path').data(pathData).join('path')
            .attr('d', d => d.path)
            .attr('stroke', color)
            .attr('stroke-width', d => Math.min(0.5 + (d.width || 1) * 0.1, config.r))
            .attr('stroke-linecap', 'round')
            .attr('class', 'river-path');
    }

    /**
     * ブロックの砂浜を描画します。
     * @param {Object} block 
     */
    drawBlockBeaches(block) {
        const g = this.layers.beach.select(`#beach-${block.id}`);
        if (g.empty()) return;
        const paths = [];
        block.hexes.forEach(d => {
            if (d.properties.beachNeighbors?.length > 0) {
                d.properties.beachNeighbors.forEach(ni => {
                    const n = this.hexes[ni];
                    if (n) {
                        const edge = getSharedEdgePoints(d, n);
                        // [FIX] Transform beach edge points
                        if (edge) {
                            const p1 = this.coordSys.toView(edge[0][0], edge[0][1]);
                            const p2 = this.coordSys.toView(edge[1][0], edge[1][1]);
                            paths.push(`M ${p1.x},${p1.y} L ${p2.x},${p2.y}`);
                        }
                    }
                });
            }
        });
        g.selectAll('path').data(paths).join('path')
            .attr('d', d => d)
            .attr('class', 'beach-path')
            .attr('stroke', config.TERRAIN_COLORS.水域)
            .attr('stroke-width', 6)
            .attr('stroke-linecap', 'round');
    }

    /**
     * ブロックの国境線を描画します。
     * @param {Object} block 
     */
    drawBlockBorders(block) {
        const g = this.layers.border.select(`#border-${block.id}`);
        if (g.empty()) return;
        const lines = [];
        block.hexes.forEach(h => {
            const hId = h.properties.nationId || 0;
            if (hId === 0) return;
            (h.neighbors || []).map(i => this.hexes[i]).filter(Boolean).forEach(n => {
                if (h.index < n.index) {
                    const nId = n.properties.nationId || 0;
                    if (nId > 0 && hId !== nId) {
                        const edge = getSharedEdgePoints(h, n);
                        // [FIX] Border lines need full point transformation
                        // Since 'line' uses x1,y1,x2,y2, we need to transform world coords to view coords
                        if (edge) {
                            // edge is [[x1,y1], [x2,y2]] in World
                            lines.push({
                                x1: edge[0][0], y1: edge[0][1],
                                x2: edge[1][0], y2: edge[1][1]
                            });
                        }
                    }
                }
            });
        });
        g.selectAll('line').data(lines).join('line')
            .attr('x1', d => this.coordSys.toView(d.x1, 0).x).attr('y1', d => this.coordSys.toView(0, d.y1).y)
            .attr('x2', d => this.coordSys.toView(d.x2, 0).x).attr('y2', d => this.coordSys.toView(0, d.y2).y)
            .attr('stroke', '#f00')
            .attr('stroke-width', 4)
            .attr('stroke-linecap', 'round');
    }

    /**
     * ブロックの稜線と水系を描画します (デバッグ用)。
     * @param {Object} block 
     */
    drawBlockRidgeLines(block) {
        const g = this.layers['ridge-water-system'].select(`#ridge-water-system-${block.id}`);
        if (g.empty()) return;

        g.selectAll('.rws-water-hex')
            .data(block.hexes.filter(d => d.properties.isWater), (d: any) => d.index).join('polygon')
            .attr('class', 'rws-water-hex')
            .attr('class', 'rws-water-hex')
            .attr('points', (d: any) => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', (d: any) => {
                const p = this.coordSys.toView(d.cx, d.cy);
                return `translate(${p.x}, ${p.y}) scale(1.01)`;
            })
            .attr('fill', config.RIDGE_WATER_SYSTEM_COLORS.RIVER);

        const paths = [];
        block.hexes.forEach(s => {
            if (s.properties.ridgeFlow > 0 && !s.properties.isWater) {
                const up = s.ridgeUpstreamIndex !== -1 ? this.hexes[s.ridgeUpstreamIndex] : null;
                const end = up ? getSharedEdgeMidpoint(s, up) : [s.cx, s.cy];
                if (!end) return;
                const downs = (this.hexes || []).filter(h => h.ridgeUpstreamIndex === s.index);
                const cp = [s.cx, s.cy];

                if (downs.length === 0) {
                    const sView = this.coordSys.toView(s.cx, s.cy);
                    const cpView = this.coordSys.toView(cp[0], cp[1]);
                    const endView = this.coordSys.toView(end[0], end[1]);
                    paths.push({ path: `M ${sView.x},${sView.y} Q ${cpView.x},${cpView.y} ${endView.x},${endView.y}`, flow: s.properties.ridgeFlow });
                } else {
                    downs.forEach(d => {
                        const start = getSharedEdgeMidpoint(s, d);
                        if (start) {
                            const startView = this.coordSys.toView(start[0], start[1]);
                            const cpView = this.coordSys.toView(cp[0], cp[1]);
                            const endView = this.coordSys.toView(end[0], end[1]);
                            paths.push({ path: `M ${startView.x},${startView.y} Q ${cpView.x},${cpView.y} ${endView.x},${endView.y}`, flow: d.properties.ridgeFlow });
                        }
                    });
                }
            }
        });

        g.selectAll('.rws-ridge-segment').data(paths).join('path')
            .attr('d', d => d.path)
            .attr('stroke', config.RIDGE_WATER_SYSTEM_COLORS.RIDGE)
            .attr('stroke-width', d => Math.min(Math.sqrt(d.flow) * 1.5, config.r * 0.8))
            .attr('class', 'ridge-segment');
    }

    /**
     * ピクセル座標を計算するヘルパー関数
     */
    getHexCenter(col, row) {
        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;
        const WORLD_ROWS = 2002;
        const cx = col * (hexWidth * 0.75) + config.r;
        const cy = ((WORLD_ROWS - 1) - row) * hexHeight + (col % 2 === 0 ? 0 : hexHeight / 2) + config.r;
        return { cx, cy };
    }

    /**
     * ブロック単位の等高線描画 (非推奨・ビューポート統一描画に移行)
     */
    drawBlockContours(block) {
        // [DEPRECATED] ブロック単位の描画は無効化し、統合描画を使用
        this.drawVisibleContours();
    }

    // [NEW] Unified Viewport Contour Rendering (ビューポート統合等高線描画)
    /**
     * 可視範囲全体の等高線をまとめて生成・描画します。
     * ブロックごとの境界での途切れを防ぐため、可視ヘックスをすべて集めて処理します。
     * 即時実行ではなく、デバウンス処理によりパフォーマンスを確保しています。
     */
    drawVisibleContours = (() => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const layerName = 'contour';
                if (!this.layers[layerName]) return;

                // [FIX] Lazy Rendering: 表示されていない場合は計算しない
                if (this.layers[layerName].style('display') === 'none') return;

                const contourGroup = this.layers[layerName];

                let unifiedGroup = contourGroup.select('#unified-contours');
                if (unifiedGroup.empty()) {
                    unifiedGroup = contourGroup.append('g').attr('id', 'unified-contours');
                }

                // 可視ブロックから全ヘックスを収集
                const visibleHexes = [];
                this.blocks.forEach(b => {
                    if (b.visible && b.loaded && b.allHexes) {
                        visibleHexes.push(...b.allHexes);
                    }
                });

                if (visibleHexes.length === 0) return;

                const resolution = config.CONTOUR_RESOLUTION || 20;

                // 全可視ヘックスからのバウンディングボックス計算
                const allCx = visibleHexes.map(h => h.cx);
                const allCy = visibleHexes.map(h => h.cy);

                const bXMin = Math.min(...allCx);
                const bXMax = Math.max(...allCx);
                const bYMin = Math.min(...allCy);
                const bYMax = Math.max(...allCy);

                // グリッドへのスナップ
                const xMin = Math.floor(bXMin / resolution) * resolution;
                const yMin = Math.floor(bYMin / resolution) * resolution;
                const xMax = Math.ceil(bXMax / resolution) * resolution;
                const yMax = Math.ceil(bYMax / resolution) * resolution;

                const width = xMax - xMin;
                const height = yMax - yMin;

                if (width <= 0 || height <= 0) return;

                const gridWidth = Math.floor(width / resolution);
                const gridHeight = Math.floor(height / resolution);
                const elevationValues = new Array(gridWidth * gridHeight).fill(-10000);

                // ドロネー三角形分割による補間
                const delaunay = d3.Delaunay.from(visibleHexes.map(h => [h.cx, h.cy]));
                const { triangles } = delaunay;
                const numTriangles = triangles.length / 3;

                // 重心座標系補間 (Barycentric Interpolation) ヘルパー
                function getBarycentric(px, py, x0, y0, x1, y1, x2, y2) {
                    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
                    if (denom === 0) return [-1, -1, -1];
                    const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
                    const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
                    const w2 = 1 - w0 - w1;
                    return [w0, w1, w2];
                }

                // ラスタライズ (グリッドデータ生成)
                for (let t = 0; t < numTriangles; t++) {
                    const i0 = triangles[t * 3];
                    const i1 = triangles[t * 3 + 1];
                    const i2 = triangles[t * 3 + 2];

                    const h0 = visibleHexes[i0];
                    const h1 = visibleHexes[i1];
                    const h2 = visibleHexes[i2];

                    const p0x = h0.cx, p0y = h0.cy, z0 = h0.properties.elevation;
                    const p1x = h1.cx, p1y = h1.cy, z1 = h1.properties.elevation;
                    const p2x = h2.cx, p2y = h2.cy, z2 = h2.properties.elevation;

                    const minTx = Math.min(p0x, p1x, p2x);
                    const maxTx = Math.max(p0x, p1x, p2x);
                    const minTy = Math.min(p0y, p1y, p2y);
                    const maxTy = Math.max(p0y, p1y, p2y);

                    const gMinX = Math.max(0, Math.floor((minTx - xMin) / resolution));
                    const gMaxX = Math.min(gridWidth - 1, Math.ceil((maxTx - xMin) / resolution));
                    const gMinY = Math.max(0, Math.floor((minTy - yMin) / resolution));
                    const gMaxY = Math.min(gridHeight - 1, Math.ceil((maxTy - yMin) / resolution));

                    for (let y = gMinY; y <= gMaxY; y++) {
                        const py = yMin + y * resolution;
                        for (let x = gMinX; x <= gMaxX; x++) {
                            const px = xMin + x * resolution;
                            const [w0, w1, w2] = getBarycentric(px, py, p0x, p0y, p1x, p1y, p2x, p2y);
                            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                                const z = w0 * z0 + w1 * z1 + w2 * z2;
                                elevationValues[y * gridWidth + x] = z;
                            }
                        }
                    }
                }

                // 等高線生成 (d3.contours)
                const maxElevation = 7500;
                const thresholds = d3.range(config.CONTOUR_INTERVAL || 200, maxElevation, config.CONTOUR_INTERVAL || 200);

                try {
                    const contours = d3.contours()
                        .size([gridWidth, gridHeight])
                        .thresholds(thresholds)
                        (elevationValues);

                    // 等高線パスの描画
                    unifiedGroup.selectAll("path.contour-path")
                        .data(contours)
                        .join("path")
                        .attr("class", d => `contour-path ${d.value % 1000 === 0 ? 'contour-index' : 'contour-intermediate'}`)
                        .attr("d", d3.geoPath())
                        .attr("transform", () => {
                            // [FIX] Contours are generated in World Coords.
                            // Need to transform the group or path?
                            // Since d3.geoPath works on the projection or raw data...
                            // The generated contours are in the coordinate space of input (World).
                            // The contours internal data is in grid index space (0..gridWidth).
                            // We need to scale by resolution and translate to the View Coordinate of the grid's top-left (xMin, yMin).
                            const viewMin = this.coordSys.toView(xMin, yMin);
                            // -resolution/2 is from original logic, likely for centering correction
                            return `translate(${viewMin.x - resolution / 2}, ${viewMin.y - resolution / 2}) scale(${resolution})`;
                        })
                        .style('fill', 'none')
                        .style('stroke', '#642')
                        .style('stroke-opacity', 0.5)
                        .style('stroke-width', d => d.value % 1000 === 0 ? 0.06 : 0.03) // 主曲線と計曲線で太さを変える
                        .style('pointer-events', 'none');

                    // [DEBUG] Visualize Triangles (Red Wireframe) - REMOVED

                } catch (e) {
                    console.error(`[Contours] Generation failed:`, e);
                }
            }, 200); // 200ms debounce
        };
    })();

    /**
     * ブロックの集落を描画します。
     * @param {Object} block 
     */
    drawBlockSettlements(block) {
        const g = this.layers.settlement.select(`#settlement-${block.id}`);
        if (g.empty()) return;

        // [FIX] Lazy Rendering
        if (this.layers.settlement.style('display') === 'none') return;

        const data = block.hexes.filter(d => d.properties.settlement);

        // 1. Draw Icons (Polygons)
        g.selectAll('.settlement-hex').data(data, (d: any) => d.index).join('polygon')
            .attr('class', 'settlement-hex')
            .attr('points', (d: any) => d.points.map(p => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', (d: any) => {
                const p = this.coordSys.toView(d.cx, d.cy);
                return `translate(${p.x}, ${p.y - 1}) scale(0.5)`;
            })
            .attr('fill', (d: any) => ({
                '首都': '#f0f',
                '領都': '#f00',
                '都市': '#f00',
                '街': '#f80',
                '町': '#ff0',
                '村': '#0f0'
            }[(d.properties as any).settlement] || '#fff'));

        // 2. Draw Labels (Moved from drawBlockLabels)
        // These are controlled separately by .settlement-label class in updateZoomDependentLayers

        // [FIX] Initial Visibility: Check current scale to determine if they should be shown immediately
        const currentScale = d3.zoomTransform(this.svg.node() as Element).k;
        const initialDisplay = (currentScale > 1.0) ? 'inline' : 'none';

        g.selectAll('.settlement-label').data(data, (d: any) => d.index).join('text')
            .attr('class', 'settlement-label')
            .attr('x', (d: any) => this.coordSys.toView(d.cx, d.cy).x)
            .attr('y', (d: any) => this.coordSys.toView(d.cx, d.cy).y)
            .text((d: any) => d.properties.settlement)
            // .attr('text-anchor', 'middle')
            // .attr('dominant-baseline', 'middle')
            // .style('font-size', '10px')
            // .style('fill', '#000')
            .style('display', initialDisplay);
    }

    /**
     * ブロックIDを描画します (ズームアウト時用)。
     * @param {Object} block 
     */
    drawBlockIdLabels(block) {
        // グループ作成
        let g = this.layers['block-id-labels'].select(`#block-id-${block.id}`);
        if (g.empty()) {
            g = this.layers['block-id-labels'].append('g').attr('id', `block-id-${block.id}`);
        }

        // [FIX] Lazy Rendering
        if (this.layers['block-id-labels'].style('display') === 'none') return;

        g.selectAll('*').remove();

        if (!block.hexes || block.hexes.length === 0) return;

        // ブロックの中心を計算
        const cx = d3.mean(block.hexes, (d: any) => d.cx);
        const cy = d3.mean(block.hexes, (d: any) => d.cy);
        const labelText = block.id.replace('map_', '').replace('_', '-');

        g.append('text')
            .attr('x', this.coordSys.toView(cx, cy).x)
            .attr('y', this.coordSys.toView(cx, cy).y)
            .attr('class', 'block-id-label')
            .text(labelText);
    }

    /**
     * ズーム倍率に応じてレイヤーの表示/非表示を切り替えます。
     * @param {number} scale 
     */
    updateZoomDependentLayers(scale) {
        // [FIX] Scroll Optimization: Ensure expensive layers remain hidden during zoom/pan
        // They will be revealed by on('end') -> updateZoomDependentLayers call.
        const isScrolling = this.isZooming;

        // 1. Block ID Labels: Visible if scale <= 1.0 (Zoomed Out)
        // Lightweight, so we can update during scroll
        const blockIdLayer = this.layers['block-id-labels'];
        const showBlockId = (scale <= 1.0);
        const blockIdDisplay = showBlockId ? 'inline' : 'none';

        if (blockIdLayer) {
            if (blockIdLayer.style('display') !== blockIdDisplay) {
                blockIdLayer.style('display', blockIdDisplay);
                if (showBlockId) {
                    this.blocks.forEach(b => { if (b.rendered) this.drawBlockIdLabels(b); });
                }
            }
        }

        // 2. Contour Lines: Visible if scale > 1.0
        const contourLayer = this.layers['contour'];
        const isContourZoomVisible = (scale > 1.0);
        // Toggle Switch check
        const isContourSwitchOn = contourLayer ? (contourLayer as any).visible : true;
        const showContour = isContourSwitchOn && isContourZoomVisible && !isScrolling; // Hide during scroll
        const contourDisplay = showContour ? 'inline' : 'none';

        if (contourLayer) {
            if (contourLayer.style('display') !== contourDisplay) {
                contourLayer.style('display', contourDisplay);
                if (showContour) {
                    this.drawVisibleContours();
                }
            }
        }

        // 3. Hex Labels: Visible if scale >= 2.0
        const labelLayer = this.layers['labels'];
        const showLabels = (scale >= 2.0) && !isScrolling; // Hide during scroll
        const labelDisplay = showLabels ? 'inline' : 'none';

        if (labelLayer) {
            if (labelLayer.style('display') !== labelDisplay) {
                labelLayer.style('display', labelDisplay);
                // Reveal Trigger
                if (showLabels) {
                    this.blocks.forEach(b => { if (b.rendered) this.drawBlockLabels(b); });
                }
            }
        }

        // 4. Settlement Labels: Visible if scale > 1.0 (Distinct from icons?)
        // User requested: "Settlement labels disappear... hide <= 1.0"
        // Note: Settlement labels are child elements of the 'settlement' layer OR 'labels' layer?
        // They are drawn in 'settlement' layer in drawBlockSettlements.
        // We need to toggle individual text elements because the layer itself (icons) remains visible.
        const settlementLabelGroups = this.g.selectAll('.settlement-label');
        if (!settlementLabelGroups.empty()) {
            // Assuming settlement layer visible check is implicit via group visibility? 
            // But we moved them to settlement group. If settlement group is hidden, these are hidden.
            // But we want to hide them SPECIFICALLY if scale <= 1.0, even if group is visible.
            const showSettlementLabels = (scale > 1.0) && !isScrolling;
            const slDisplay = showSettlementLabels ? 'inline' : 'none';
            if (settlementLabelGroups.style('display') !== slDisplay) {
                settlementLabelGroups.style('display', slDisplay);
            }
        }

        // 5. Hex Borders: Visible if scale > 1.0
        // 5. Hex Borders: Visible if scale > 1.0 AND Switch is ON
        const borderLayer = this.layers['hex-border'];
        // toggle switch (visible property) must be true for it to be shown at all
        const isBorderSwitchOn = borderLayer ? (borderLayer as any).visible : true;


        const showBorders = isBorderSwitchOn && (scale > 1.0) && !isScrolling;
        const borderDisplay = showBorders ? 'inline' : 'none';

        if (borderLayer) {
            // Force hide if switch is off
            if (!isBorderSwitchOn) {
                if (borderLayer.style('display') !== 'none') {
                    borderLayer.style('display', 'none').attr('display', 'none');
                }
            } else {
                // Switch is ON, respect Zoom
                // Always set both style and attribute to be safe
                if (borderLayer.style('display') !== borderDisplay) {
                    borderLayer.style('display', borderDisplay).attr('display', borderDisplay);
                    if (showBorders) {
                        this.blocks.forEach(b => { if (b.rendered) this.drawBlockHexBorders(b); });
                    }
                }
            }
        }
    }


    /**
     * ブロックの道路と海路を描画します。
     * @param {Object} block 
     */
    drawBlockRoads(block) {
        const g = this.layers.road.select(`#road-${block.id}`);
        const seaG = this.layers['sea-route'].select(`#sea-route-${block.id}`);
        if (g.empty() && seaG.empty()) return;
        if (this.roadPathsData.length === 0) return;

        const blockHexSet = new Set(block.hexes.map(h => h.index));
        const roads = [];
        const seaRoutes = [];

        this.roadPathsData.forEach(road => {
            if (road.path.length < 2) return;
            // パスのセグメントごとに処理
            for (let i = 0; i < road.path.length; i++) {
                const curP = road.path[i];
                const curIdx = getIndex(curP.x, curP.y);
                let curHex;
                if ((this.hexes as any).getHex) {
                    curHex = (this.hexes as any).getHex(curIdx);
                } else {
                    curHex = this.hexes[curIdx];
                }
                if (!curHex) continue;

                // このブロックに含まれるヘックスのみ処理
                if (!blockHexSet.has(curIdx)) continue;

                const prevHex = i > 0 ? ((this.hexes as any).getHex ? (this.hexes as any).getHex(getIndex(road.path[i - 1].x, road.path[i - 1].y)) : this.hexes[getIndex(road.path[i - 1].x, road.path[i - 1].y)]) : null;
                const nextHex = i < road.path.length - 1 ? ((this.hexes as any).getHex ? (this.hexes as any).getHex(getIndex(road.path[i + 1].x, road.path[i + 1].y)) : this.hexes[getIndex(road.path[i + 1].x, road.path[i + 1].y)]) : null;

                const start = prevHex ? getSharedEdgeMidpoint(curHex, prevHex) : [curHex.cx, curHex.cy];
                const end = nextHex ? getSharedEdgeMidpoint(curHex, nextHex) : [curHex.cx, curHex.cy];

                const cp = [curHex.cx, curHex.cy];

                // [FIX] Transform to View Coords
                const startView = this.coordSys.toView(start ? start[0] : cp[0], start ? start[1] : cp[1]);
                const endView = this.coordSys.toView(end ? end[0] : cp[0], end ? end[1] : cp[1]);
                const cpView = this.coordSys.toView(cp[0], cp[1]);

                const path = `M ${startView.x},${startView.y} Q ${cpView.x},${cpView.y} ${endView.x},${endView.y}`;

                if (road.level === 10) {
                    seaRoutes.push({ path, shipKey: road.shipKey });
                } else {
                    roads.push({ path, level: road.level });
                }
            }
        });

        if (!g.empty()) {
            g.selectAll('path').data(roads).join('path').attr('d', d => d.path)
                .attr('stroke', d => ({
                    6: '#f0f',
                    5: '#f00',
                    4: '#f80',
                    3: '#ff0',
                    2: '#0f0',
                    1: '#600'
                }[d.level] || '#fff'))
                .attr('stroke-width', d => d.level)
                .style('fill', 'none')
                .style('pointer-events', 'none');
        }
        if (!seaG.empty()) {
            seaG.selectAll('path').data(seaRoutes).join('path')
                .attr('d', d => d.path)
                .attr('stroke', d => ({
                    'dinghy': '#0f0',
                    'small_trader': '#ff0',
                    'coastal_trader': '#f00',
                    'medium_merchant': '#a0f',
                    'large_sailing_ship': '#00f'
                }[d.shipKey] || '#fff'))
                .attr('class', 'sea-route-path')
                .attr('stroke-width', 2).attr('stroke-dasharray', '2,4')
        }
    }

    /**
     * ブロックのヘックスラベルを描画します。
     * @param {Object} block 
     */
    drawBlockLabels(block) {
        const g = this.layers.labels.select(`#labels-${block.id}`);
        if (g.empty()) return;

        // [FIX] Lazy Rendering
        if (this.layers.labels.style('display') === 'none') return;


        const grps = g.selectAll('.hex-label-group').data(block.hexes, (d: any) => d.index).join('g').attr('class', 'hex-label-group');
        grps.selectAll('*').remove();

        const text = grps.append('text')
            .attr('x', (d: any) => this.coordSys.toView(d.cx, d.cy).x)
            .attr('y', (d: any) => this.coordSys.toView(d.cx, d.cy).y)
            .attr('class', 'hex-label')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle');

        // Line 1: Coords
        text.append('tspan')
            .attr('x', (d: any) => this.coordSys.toView(d.cx, d.cy).x)
            .attr('y', (d: any) => this.coordSys.toView(d.cx, d.cy).y + config.r * 0.55)
            .text((d: any) => formatLocation(d, 'coords'));

        // Line 2: Elevation (H/D)
        text.append('tspan')
            .attr('x', (d: any) => this.coordSys.toView(d.cx, d.cy).x)
            .attr('dy', '1.0em')
            .text((d: any) => formatLocation(d, 'elevation'));
        // .style('font-size', '5px')
        // .style('fill', '#000');
    }

    /**
     * ヘックスの境界線を描画します。
     * @param {Object} block 
     */
    drawBlockHexBorders(block) {
        // [FIX] Lazy Rendering
        if (this.layers['hex-border'].style('display') === 'none') return;

        const g = this.layers['hex-border'].select(`#hex-border-${block.id}`);
        if (g.empty()) return;
        g.selectAll('polygon').data(block.hexes, (d: any) => d.index).join('polygon')
            .attr('points', (d: any) => d.points.map((p: any) => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', (d: any) => {
                const p = this.coordSys.toView(d.cx, d.cy);
                return `translate(${p.x}, ${p.y})`;
            })
            .attr('class', 'hex-border')
    }

    /**
     * インタラクション用の透明ポリゴンを描画します。
     * マウスホバーやクリックを検知します。
     * @param {Object} block 
     */
    drawBlockInteraction(block) {
        const g = this.layers.interaction.select(`#interaction-${block.id}`);
        if (g.empty()) return;

        g.selectAll('.interactive-hex').data(block.hexes, (d: any) => d.index).join('polygon')
            .attr('class', 'interactive-hex')
            .attr('points', (d: any) => d.points.map((p: any) => `${p[0] - d.cx},${p[1] - d.cy}`).join(' '))
            .attr('transform', (d: any) => {
                const p = this.coordSys.toView(d.cx, d.cy);
                return `translate(${p.x}, ${p.y}) scale(1.01)`;
            })
            .attr('class', 'interactive-hex')
            .on('mousemove', (event) => {
                // [FIX] モバイル環境(幅600px以下またはタッチデバイス)ではツールチップを表示しない
                const isMobile = window.innerWidth <= 600 || window.matchMedia('(hover: none)').matches;
                if (isMobile) {
                    this.tooltipContainer.style('visibility', 'hidden');
                    return;
                }
                this.tooltipContainer.style('visibility', 'visible');

                // [FIX] 画面右端(70%以降)では左側に表示する
                const x = event.pageX;
                const y = event.pageY;
                const isRightSide = x > window.innerWidth * 0.7;

                if (isRightSide) {
                    // 左側に表示 (カーソル位置から少し左へ、かつ自身の幅分ずらす)
                    this.tooltipContainer
                        .style('top', (y - 10) + 'px')
                        .style('left', (x - 40) + 'px')
                        .style('transform', 'translateX(-100%)');
                } else {
                    // 右側に表示 (デフォルト)
                    this.tooltipContainer
                        .style('top', (y - 10) + 'px')
                        .style('left', (x + 40) + 'px')
                        .style('transform', 'none');
                }
            })
            .on('mouseover', (event, d) => {
                // [FIX] モバイル環境では表示しない
                const isMobile = window.innerWidth <= 600 || window.matchMedia('(hover: none)').matches;
                if (isMobile) return;

                const text = this.getTooltipText(d);
                this.tooltipContainer.text(text);
            })
            .on('mouseout', () => this.tooltipContainer.style('visibility', 'hidden'))
            .on('click', (event, d) => {
                event.stopPropagation();
                this.currentSelectedHex = d as Hex;

                // 選択ハイライト
                const hl = this.layers['highlight-overlay'];
                hl.selectAll('*').remove();

                // [FIX] Transform points to view coordinates for highlight
                const viewPoints = (d as any).points.map((p: any) => {
                    const vp = this.coordSys.toView(p[0], p[1]);
                    return [vp.x, vp.y];
                });

                hl.append('polygon')
                    .attr('points', viewPoints.map((p: any) => p.join(',')).join(' '))
                    .attr('fill', 'none').attr('stroke', 'cyan').attr('stroke-width', 4);

                // 詳細情報ウィンドウの更新
                const infoWindow = document.getElementById('info-window');
                const infoContent = document.getElementById('info-window-content');
                if (infoWindow && infoContent) {
                    infoContent.innerHTML = getInfoText(d, this.hexes);
                    infoWindow.classList.remove('hidden');
                }
            });
    }

    // ================================================================
    // Updates (更新処理)
    // ================================================================

    /**
     * ブロックごとのデータロード完了通知を受け取り、表示用データを生成・更新します。
     * 共有バッファ(WorldMap)上のデータをこの時点でブロック固有のストレージにスナップショットします。
     * @param {string} blockId 
     * @param {Object} updatedAllHexes 
     */
    updateUIWithBlockData(blockId, updatedAllHexes) {
        // バッファ参照更新（念のため）
        if (updatedAllHexes) this.hexes = updatedAllHexes;

        const block = this.blocks.find(b => b.id === blockId);
        if (!block) {
            console.warn(`[MapView] updateUIWithBlockData: Block ${blockId} not found in grid.`);
            return;
        }

        // データを生成（バッファからのコピー）
        // generateBlockHexesは内部で this.hexes (Buffer) を使用する。
        // このタイミングなら Buffer は当該ブロックのデータを持っている。
        this.generateBlockHexes(block);

        block.loaded = true;
        block.rendered = false; // 次回ループで描画

        // 表示範囲内なら即座に反映
        this.updateVisibleBlocks(this.currentTransform);
    }


    /**
     * 気候データ更新時などにマップ全体再描画をトリガーします。
     * @param {Object} allHexes 
     */
    redrawClimate(allHexes) {
        this.hexes = allHexes;
        this.updateAllHexColors();
        this.resetBlockRenderStatus();
        this.updateVisibleBlocks(this.currentTransform);
        this.updateMinimap();
    }

    /**
     * 全ブロックの描画ステータスをリセットし、再描画を促します。
     */
    resetBlockRenderStatus() {
        this.blocks.forEach(b => b.rendered = false);
    }

    /**
     * ズームレベルに応じてブロックIDラベルの表示を切り替えます。
     * @param {number} scale 
     */
    updateBlockIdLabels(scale) {
        if (!this.layers['block-id-labels']) return;
        const shouldShow = scale <= 1.0;
        this.layers['block-id-labels'].style('display', shouldShow ? 'inline' : 'none');
    }

    /**
     * ミニマップを更新します。
     * @param {Object} [hexes] - 更新に使用するヘックスデータ (省略時は this.hexes)
     */
    updateMinimap(hexes?: any) {
        if (hexes) this.hexes = hexes;
        if (!this.minimapSvg) return;
        const width = 200, height = 200;
        const mapCols = config.COLS;
        const mapRows = config.ROWS;
        const hexWidth = 2 * config.r;
        const hexHeight = Math.sqrt(3) * config.r;
        const mapTotalWidth = (mapCols * hexWidth * 3 / 4);
        const mapTotalHeight = (mapRows * hexHeight);
        const scale = Math.min(width / mapTotalWidth, height / mapTotalHeight);

        // 簡易表示: サンプリングして描画 (負荷軽減)
        // [FIX] WorldMapインスタンス対応: filterの代わりにループまたはArray.from(iterator)
        const g = this.minimapSvg.select('#minimap-terrain');
        const minimapData: any[] = [];
        // WorldMap implements iterator via [Symbol.iterator], but TS might not infer it from the union type.
        // We cast to any to treat it as an iterable source.
        const iter: Iterable<any> = this.hexes as any;
        let i = 0;
        for (const h of iter) {
            if (i % 10 === 0) minimapData.push(h);
            i++;
        }
        g.selectAll('.minimap-hex').data(minimapData) // 1/10 サンプリング
            .join('rect').attr('class', 'minimap-hex')
            .attr('x', d => d.cx * scale).attr('y', d => d.cy * scale)
            .attr('width', hexWidth * scale).attr('height', hexHeight * scale)
            .attr('fill', d => this.calculateCompositeColor(d));
    }

    /**
     * ミニマップ上のビューポート枠を更新します。
     */
    updateMinimapViewport() {
        if (!this.minimapViewport) return;
        // Logic to update viewport rect based on transform
        // (Current implementation is empty skeleton)
    }
}
