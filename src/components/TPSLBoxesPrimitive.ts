/**
 * TP/SL Boxes Primitive for TradingView Lightweight Charts
 *
 * This primitive renders draggable Take Profit (TP) and Stop Loss (SL) boxes
 * on position lines. Users can drag these boxes to visually set order levels.
 *
 * Features:
 * - Green TP box and red SL box that start at entry price
 * - Hit testing for mouse hover/click detection
 * - Boxes stay visible after creating orders (can be re-dragged)
 * - Cursor changes to indicate draggability
 */

import {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  ISeriesPrimitivePaneView,
  SeriesPrimitivePaneViewZOrder,
  PrimitiveHoveredItem,
} from 'lightweight-charts';

import { CanvasRenderingTarget2D } from 'fancy-canvas';

import { Position } from '@/types/market';

/**
 * Renderer that draws the TP/SL boxes on the canvas
 */
class TPSLBoxesRenderer {
  private _position: Position | null;
  private _tpPrice: number;
  private _slPrice: number;
  private _tpY: number | null;
  private _slY: number | null;
  private _chartWidth: number;
  private _hoveredBox: 'tp' | 'sl' | null;
  private _draggingBox: 'tp' | 'sl' | null;

  constructor(
    position: Position | null,
    tpPrice: number,
    slPrice: number,
    tpY: number | null,
    slY: number | null,
    chartWidth: number,
    hoveredBox: 'tp' | 'sl' | null,
    draggingBox: 'tp' | 'sl' | null
  ) {
    this._position = position;
    this._tpPrice = tpPrice;
    this._slPrice = slPrice;
    this._tpY = tpY;
    this._slY = slY;
    this._chartWidth = chartWidth;
    this._hoveredBox = hoveredBox;
    this._draggingBox = draggingBox;
  }

  /**
   * Draw the TP/SL boxes on the canvas
   */
  draw(target: CanvasRenderingTarget2D) {
    if (!this._position) return;

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      // Draw TP box (green)
      if (this._tpY !== null) {
        this._drawBox(
          ctx,
          this._tpY,
          'TP',
          '#16a34a', // green-600
          '#22c55e', // green-500 for hover
          this._hoveredBox === 'tp' || this._draggingBox === 'tp',
          this._tpPrice
        );
      }

      // Draw SL box (red)
      if (this._slY !== null) {
        this._drawBox(
          ctx,
          this._slY,
          'SL',
          '#dc2626', // red-600
          '#ef4444', // red-500 for hover
          this._hoveredBox === 'sl' || this._draggingBox === 'sl',
          this._slPrice
        );
      }
    });
  }

  /**
   * Draw a single box (TP or SL)
   */
  private _drawBox(
    ctx: CanvasRenderingContext2D,
    y: number,
    label: string,
    color: string,
    hoverColor: string,
    isHighlighted: boolean,
    price: number
  ) {
    const BOX_WIDTH = 70;
    const BOX_HEIGHT = 24;
    const PADDING = 8;

    // Position box on the right side of the chart
    const x = this._chartWidth - BOX_WIDTH - PADDING;

    // Use hover color if highlighted
    const fillColor = isHighlighted ? hoverColor : color;

    // Draw rounded rectangle
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    this._roundRect(ctx, x, y - BOX_HEIGHT / 2, BOX_WIDTH, BOX_HEIGHT, 4);
    ctx.fill();

    // Draw border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isHighlighted ? 2 : 1;
    ctx.beginPath();
    this._roundRect(ctx, x, y - BOX_HEIGHT / 2, BOX_WIDTH, BOX_HEIGHT, 4);
    ctx.stroke();

    // Draw label text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 6, y);

    // Draw price text
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`$${price.toFixed(2)}`, x + BOX_WIDTH - 6, y);
  }

  /**
   * Helper to draw rounded rectangles
   */
  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

/**
 * Pane view that provides the renderer for the main chart pane
 */
class TPSLBoxesPaneView implements ISeriesPrimitivePaneView {
  private _primitive: TPSLBoxesPrimitive;

  constructor(primitive: TPSLBoxesPrimitive) {
    this._primitive = primitive;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'top'; // Draw on top of everything
  }

  renderer() {
    return this._primitive.renderer();
  }
}

/**
 * Main primitive class for TP/SL boxes
 * Manages state, hit testing, and provides the renderer
 */
export class TPSLBoxesPrimitive implements ISeriesPrimitive<Time> {
  private _position: Position | null = null;
  private _tpPrice: number;
  private _slPrice: number;
  private _series: any = null;
  private _chart: any = null;
  private _requestUpdate?: () => void;
  private _paneView: TPSLBoxesPaneView;
  private _hoveredBox: 'tp' | 'sl' | null = null;
  private _draggingBox: 'tp' | 'sl' | null = null;

  // Box dimensions (must match renderer)
  private readonly BOX_WIDTH = 70;
  private readonly BOX_HEIGHT = 24;
  private readonly PADDING = 8;

  constructor() {
    this._tpPrice = 0;
    this._slPrice = 0;
    this._paneView = new TPSLBoxesPaneView(this);
  }

  /**
   * Set the position data (updates entry price and initializes box positions)
   */
  setPosition(position: Position | null) {
    this._position = position;

    // Initialize TP/SL prices at different default levels if not already set
    if (position && this._tpPrice === 0) {
      const offset = position.entryPrice * 0.02; // 2% offset from entry price

      if (position.side === 'buy') {
        // Long position: TP above entry, SL below entry
        this._tpPrice = position.tpPrice || (position.entryPrice + offset);
        this._slPrice = position.slPrice || (position.entryPrice - offset);
      } else {
        // Short position: TP below entry, SL above entry
        this._tpPrice = position.tpPrice || (position.entryPrice - offset);
        this._slPrice = position.slPrice || (position.entryPrice + offset);
      }
    }

    this._requestUpdate?.();
  }

  /**
   * Update TP price (called during dragging)
   */
  setTPPrice(price: number) {
    this._tpPrice = price;
    this._requestUpdate?.();
  }

  /**
   * Update SL price (called during dragging)
   */
  setSLPrice(price: number) {
    this._slPrice = price;
    this._requestUpdate?.();
  }

  /**
   * Get current TP price
   */
  getTPPrice(): number {
    return this._tpPrice;
  }

  /**
   * Get current SL price
   */
  getSLPrice(): number {
    return this._slPrice;
  }

  /**
   * Set hovered box (for visual feedback)
   */
  setHoveredBox(box: 'tp' | 'sl' | null) {
    if (this._hoveredBox !== box) {
      this._hoveredBox = box;
      this._requestUpdate?.();
    }
  }

  /**
   * Set dragging box (for visual feedback)
   */
  setDraggingBox(box: 'tp' | 'sl' | null) {
    if (this._draggingBox !== box) {
      this._draggingBox = box;
      this._requestUpdate?.();
    }
  }

  /**
   * Get current position
   */
  getPosition(): Position | null {
    return this._position;
  }

  /**
   * Lifecycle: Called when primitive is attached to series
   */
  attached(param: SeriesAttachedParameter<Time>) {
    this._series = param.series;
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  /**
   * Lifecycle: Called when primitive is detached
   */
  detached() {
    this._series = null;
    this._chart = null;
    this._requestUpdate = undefined;
  }

  /**
   * Return pane views for rendering
   */
  paneViews() {
    return [this._paneView];
  }

  /**
   * Create renderer with current state
   */
  renderer() {
    const tpY = this._series?.priceToCoordinate(this._tpPrice) ?? null;
    const slY = this._series?.priceToCoordinate(this._slPrice) ?? null;
    const chartWidth = this._chart?.timeScale().width() ?? 0;

    return new TPSLBoxesRenderer(
      this._position,
      this._tpPrice,
      this._slPrice,
      tpY,
      slY,
      chartWidth,
      this._hoveredBox,
      this._draggingBox
    );
  }

  /**
   * Hit testing - detect if mouse is over a box
   * Returns item info if hit, null otherwise
   */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._series || !this._position) return null;

    const chartWidth = this._chart?.timeScale().width() ?? 0;

    // Calculate box X position (right side of chart)
    const boxX = chartWidth - this.BOX_WIDTH - this.PADDING;

    // Check if X is within box bounds
    if (x < boxX || x > boxX + this.BOX_WIDTH) {
      return null;
    }

    // Check TP box
    const tpY = this._series.priceToCoordinate(this._tpPrice);
    if (tpY !== null && this._isPointInBox(y, tpY)) {
      return {
        externalId: 'tp-box',
        cursorStyle: this._draggingBox === 'tp' ? 'grabbing' : 'ns-resize',
        zOrder: 'top',
      };
    }

    // Check SL box
    const slY = this._series.priceToCoordinate(this._slPrice);
    if (slY !== null && this._isPointInBox(y, slY)) {
      return {
        externalId: 'sl-box',
        cursorStyle: this._draggingBox === 'sl' ? 'grabbing' : 'ns-resize',
        zOrder: 'top',
      };
    }

    return null;
  }

  /**
   * Check if Y coordinate is within box vertical bounds
   */
  private _isPointInBox(y: number, boxY: number): boolean {
    return Math.abs(y - boxY) <= this.BOX_HEIGHT / 2;
  }
}
