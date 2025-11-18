/**
 * Order Line Primitive for TradingView Lightweight Charts
 *
 * Renders draggable order lines that can be moved to modify order prices.
 * Users can drag the order handle to cancel the old order and create a new one.
 *
 * Features:
 * - Horizontal line showing order price
 * - Draggable handle/box for price modification
 * - Color-coded: green for buy orders, red for sell orders
 * - Hit testing for mouse interaction
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

import { UserOrder } from '@/types/market';

/**
 * Renderer that draws the order line and draggable handle
 */
class OrderLineRenderer {
  private _order: UserOrder;
  private _orderY: number | null;
  private _chartWidth: number;
  private _isHovered: boolean;
  private _isDragging: boolean;

  constructor(
    order: UserOrder,
    orderY: number | null,
    chartWidth: number,
    isHovered: boolean,
    isDragging: boolean
  ) {
    this._order = order;
    this._orderY = orderY;
    this._chartWidth = chartWidth;
    this._isHovered = isHovered;
    this._isDragging = isDragging;
  }

  /**
   * Draw the order line and handle
   */
  draw(target: CanvasRenderingTarget2D) {
    if (this._orderY === null) return;

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const price = this._order.type === 'limit' ? this._order.limitPrice : this._order.stopPrice;
      if (!price) return;

      // Determine color based on order side
      const color = this._order.side === 'buy' ? '#26a69a' : '#ef5350';
      const hoverColor = this._order.side === 'buy' ? '#2dd4bf' : '#f87171';

      // Draw horizontal line across chart
      ctx.strokeStyle = this._isHovered || this._isDragging ? hoverColor : color;
      ctx.lineWidth = this._isHovered || this._isDragging ? 2 : 1;
      ctx.setLineDash([5, 3]); // Dashed line
      ctx.beginPath();
      ctx.moveTo(0, this._orderY);
      ctx.lineTo(this._chartWidth, this._orderY);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Draw draggable handle on the right
      this._drawHandle(ctx, this._orderY, price, color, hoverColor);
    });
  }

  /**
   * Draw the draggable handle/box
   */
  private _drawHandle(
    ctx: CanvasRenderingContext2D,
    y: number,
    price: number,
    color: string,
    hoverColor: string
  ) {
    const BOX_WIDTH = 80;
    const BOX_HEIGHT = 22;
    const PADDING = 8;

    // Position handle on the right side
    const x = this._chartWidth - BOX_WIDTH - PADDING;

    // Use hover/drag color if active
    const fillColor = this._isHovered || this._isDragging ? hoverColor : color;

    // Draw rounded rectangle
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    this._roundRect(ctx, x, y - BOX_HEIGHT / 2, BOX_WIDTH, BOX_HEIGHT, 4);
    ctx.fill();

    // Draw border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = this._isHovered || this._isDragging ? 2 : 1;
    ctx.beginPath();
    this._roundRect(ctx, x, y - BOX_HEIGHT / 2, BOX_WIDTH, BOX_HEIGHT, 4);
    ctx.stroke();

    // Draw order type label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const typeLabel = this._order.type.toUpperCase();
    ctx.fillText(typeLabel, x + 5, y);

    // Draw price
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`$${price.toFixed(2)}`, x + BOX_WIDTH - 5, y);
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
 * Pane view that provides the renderer
 */
class OrderLinePaneView implements ISeriesPrimitivePaneView {
  private _primitive: OrderLinePrimitive;

  constructor(primitive: OrderLinePrimitive) {
    this._primitive = primitive;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'top';
  }

  renderer() {
    return this._primitive.renderer();
  }
}

/**
 * Main primitive class for order lines
 */
export class OrderLinePrimitive implements ISeriesPrimitive<Time> {
  private _order: UserOrder;
  private _orderPrice: number;
  private _series: any = null;
  private _chart: any = null;
  private _requestUpdate?: () => void;
  private _paneView: OrderLinePaneView;
  private _isHovered: boolean = false;
  private _isDragging: boolean = false;

  // Handle dimensions (must match renderer)
  private readonly BOX_WIDTH = 80;
  private readonly BOX_HEIGHT = 22;
  private readonly PADDING = 8;

  constructor(order: UserOrder) {
    this._order = order;
    this._orderPrice = order.type === 'limit' ? (order.limitPrice || 0) : (order.stopPrice || 0);
    this._paneView = new OrderLinePaneView(this);
  }

  /**
   * Update order data
   */
  setOrder(order: UserOrder) {
    this._order = order;
    this._orderPrice = order.type === 'limit' ? (order.limitPrice || 0) : (order.stopPrice || 0);
    this._requestUpdate?.();
  }

  /**
   * Update order price (during dragging)
   */
  setOrderPrice(price: number) {
    this._orderPrice = price;
    this._requestUpdate?.();
  }

  /**
   * Get current order price
   */
  getOrderPrice(): number {
    return this._orderPrice;
  }

  /**
   * Get order data
   */
  getOrder(): UserOrder {
    return this._order;
  }

  /**
   * Set hover state
   */
  setHovered(hovered: boolean) {
    if (this._isHovered !== hovered) {
      this._isHovered = hovered;
      this._requestUpdate?.();
    }
  }

  /**
   * Set dragging state
   */
  setDragging(dragging: boolean) {
    if (this._isDragging !== dragging) {
      this._isDragging = dragging;
      this._requestUpdate?.();
    }
  }

  /**
   * Lifecycle: Called when primitive is attached
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
    const orderY = this._series?.priceToCoordinate(this._orderPrice) ?? null;
    const chartWidth = this._chart?.timeScale().width() ?? 0;

    return new OrderLineRenderer(
      this._order,
      orderY,
      chartWidth,
      this._isHovered,
      this._isDragging
    );
  }

  /**
   * Hit testing - detect if mouse is over the handle
   */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._series) return null;

    const chartWidth = this._chart?.timeScale().width() ?? 0;
    const orderY = this._series.priceToCoordinate(this._orderPrice);

    if (orderY === null) return null;

    // Calculate handle position
    const boxX = chartWidth - this.BOX_WIDTH - this.PADDING;

    // Check if mouse is within handle bounds
    if (
      x >= boxX &&
      x <= boxX + this.BOX_WIDTH &&
      y >= orderY - this.BOX_HEIGHT / 2 &&
      y <= orderY + this.BOX_HEIGHT / 2
    ) {
      return {
        externalId: `order-handle-${this._order.id}`,
        cursorStyle: this._isDragging ? 'grabbing' : 'ns-resize',
        zOrder: 'top',
      };
    }

    return null;
  }
}
