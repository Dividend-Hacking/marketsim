/**
 * Trading Chart Component
 *
 * Displays a professional candlestick chart using TradingView's Lightweight Charts library.
 * Updates in real-time as new bars are generated from the market simulation.
 *
 * Features:
 * - Candlestick visualization (OHLC data)
 * - Auto-scaling and responsive design
 * - Dark theme matching trading platforms
 * - Volume overlay (optional, can be added)
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, CandlestickData, LineSeries, ISeriesApi as LineSeriesApi, IPriceLine, MouseEventParams } from 'lightweight-charts';
import { Bar, Drawing, DrawingToolType, DrawingPoint, UserOrder, Position, OrderSide, OrderType } from '@/types/market';
import { TPSLBoxesPrimitive } from './TPSLBoxesPrimitive';

interface TradingChartProps {
  bars: Bar[];
  currentBar: Bar | null;
  showDrawingTools: boolean;
  activeOrders: UserOrder[];
  positions: Position[];
  onPlaceOrder?: (side: OrderSide, type: OrderType, size: number, price?: number) => void;
  onUpdatePositionTPSL?: (positionId: string, tpPrice?: number, slPrice?: number) => void;
  onCancelOrder?: (orderId: string) => void;
}

// Drag threshold - minimum pixels of movement to distinguish drag from click
const DRAG_THRESHOLD = 5;

export function TradingChart({
  bars,
  currentBar,
  showDrawingTools,
  activeOrders,
  positions,
  onPlaceOrder,
  onUpdatePositionTPSL,
  onCancelOrder,
}: TradingChartProps) {
  // Refs to persist chart instances across renders
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<DrawingPoint[]>([]);

  // Store drawing series (line series used to render drawings)
  const drawingSeriesRef = useRef<Map<string, LineSeriesApi<'Line'>>>(new Map());

  // Store order price lines (for managing order visualization)
  const orderLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const positionLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  // Store TP/SL primitives for each position
  const tpslPrimitivesRef = useRef<Map<string, TPSLBoxesPrimitive>>(new Map());

  // Drag state for TP/SL boxes - use refs to prevent effect re-runs
  const isDraggingRef = useRef(false);
  const draggedBoxRef = useRef<{ positionId: string; type: 'tp' | 'sl' } | null>(null);
  const dragStartYRef = useRef<number | null>(null); // Track starting Y position for drag threshold
  const dragStartPriceRef = useRef<number | null>(null); // Track starting price to reset on failed drag

  // Keep state for UI reactivity (visual feedback)
  const [isDraggingTPSL, setIsDraggingTPSL] = useState(false);

  /**
   * Initialize the chart on mount
   */
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart with dark theme
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: '#2a2a2a',
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
      },
      crosshair: {
        mode: 1, // Normal crosshair
        vertLine: {
          color: '#505050',
          labelBackgroundColor: '#3f51b5',
        },
        horzLine: {
          color: '#505050',
          labelBackgroundColor: '#3f51b5',
        },
      },
    });

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Handle window resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, []);

  /**
   * Update chart data when bars change
   */
  useEffect(() => {
    if (!seriesRef.current) return;

    // Convert bars to lightweight-charts format
    const candlestickData: CandlestickData[] = bars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    // Add current bar if it exists (incomplete bar being built)
    if (currentBar) {
      candlestickData.push({
        time: currentBar.time,
        open: currentBar.open,
        high: currentBar.high,
        low: currentBar.low,
        close: currentBar.close,
      });
    }

    // Update series data
    seriesRef.current.setData(candlestickData);

    // Auto-scroll to latest bar
    if (chartRef.current && candlestickData.length > 0) {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [bars, currentBar]);

  /**
   * Render active orders as price lines on the chart
   * Shows pending limit and stop orders
   */
  useEffect(() => {
    if (!seriesRef.current) return;

    // Get current order IDs
    const currentOrderIds = new Set(activeOrders.map((o) => o.id));

    // Remove price lines for orders that no longer exist
    orderLinesRef.current.forEach((priceLine, orderId) => {
      if (!currentOrderIds.has(orderId)) {
        seriesRef.current?.removePriceLine(priceLine);
        orderLinesRef.current.delete(orderId);
      }
    });

    // Add/update price lines for active orders
    activeOrders.forEach((order) => {
      // Only show pending orders (not filled ones)
      if (order.status !== 'pending') return;

      // Get price for the order line
      const price = order.type === 'limit' ? order.limitPrice : order.stopPrice;
      if (!price) return;

      // Determine color based on order side
      const color = order.side === 'buy' ? '#26a69a' : '#ef5350';

      // Create label with order details
      const label = `${order.type.toUpperCase()} ${order.size} @ $${price.toFixed(2)}`;

      // Check if price line already exists for this order
      const existingLine = orderLinesRef.current.get(order.id);
      if (existingLine) {
        // Update existing price line
        seriesRef.current?.removePriceLine(existingLine);
      }

      // Create new price line
      const priceLine = seriesRef.current!.createPriceLine({
        price: price,
        color: color,
        lineWidth: 2,
        lineStyle: 2, // Dashed line for pending orders
        axisLabelVisible: true,
        title: label,
      });

      orderLinesRef.current.set(order.id, priceLine);
    });
  }, [activeOrders]);

  /**
   * Render open positions as solid lines on the chart
   * Shows entry price with real-time P&L updates
   * Lines are automatically removed when positions are closed
   */
  useEffect(() => {
    if (!seriesRef.current) return;

    // Get current position IDs
    const currentPositionIds = new Set(positions.map((p) => p.id));

    // Remove price lines for positions that no longer exist (closed positions)
    positionLinesRef.current.forEach((priceLine, positionId) => {
      if (!currentPositionIds.has(positionId)) {
        seriesRef.current?.removePriceLine(priceLine);
        positionLinesRef.current.delete(positionId);
      }
    });

    // Add/update price lines for open positions
    positions.forEach((position) => {
      // Calculate P&L percentage
      const pnl = position.unrealizedPnL;
      const pnlPercent = (pnl / (position.entryPrice * position.size)) * 100;
      const pnlSign = pnl >= 0 ? '+' : '';

      // Determine color based on position side (long = green, short = red)
      const color = position.side === 'buy' ? '#26a69a' : '#ef5350';

      // Create comprehensive label with all position details
      const label = `POSITION: ${position.size} @ $${position.entryPrice.toFixed(2)} | P&L: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)`;

      // Check if price line already exists for this position
      const existingLine = positionLinesRef.current.get(position.id);
      if (existingLine) {
        // Remove existing line to update it with new P&L
        seriesRef.current?.removePriceLine(existingLine);
      }

      // Create new price line with updated P&L
      const priceLine = seriesRef.current!.createPriceLine({
        price: position.entryPrice,
        color: color,
        lineWidth: 2,
        lineStyle: 0, // Solid line for open positions (most prominent)
        axisLabelVisible: true,
        title: label,
      });

      positionLinesRef.current.set(position.id, priceLine);
    });
  }, [positions]);

  /**
   * Manage TP/SL box primitives for each position
   * Creates draggable boxes for setting take profit and stop loss orders
   */
  useEffect(() => {
    if (!seriesRef.current) return;

    // Get current position IDs
    const currentPositionIds = new Set(positions.map((p) => p.id));

    // Remove primitives for positions that no longer exist
    tpslPrimitivesRef.current.forEach((primitive, positionId) => {
      if (!currentPositionIds.has(positionId)) {
        seriesRef.current?.detachPrimitive(primitive);
        tpslPrimitivesRef.current.delete(positionId);
      }
    });

    // Create/update primitives for each position
    positions.forEach((position) => {
      let primitive = tpslPrimitivesRef.current.get(position.id);

      if (!primitive) {
        // Create new primitive for this position
        primitive = new TPSLBoxesPrimitive();
        seriesRef.current?.attachPrimitive(primitive);
        tpslPrimitivesRef.current.set(position.id, primitive);
      }

      // Update primitive with position data
      primitive.setPosition(position);

      // Initialize TP/SL prices from position if set, otherwise use entry price
      if (position.tpPrice !== undefined) {
        primitive.setTPPrice(position.tpPrice);
      }
      if (position.slPrice !== undefined) {
        primitive.setSLPrice(position.slPrice);
      }
    });
  }, [positions]);

  /**
   * Validate TP/SL price levels based on position side
   * Returns null if valid, error message if invalid
   */
  const validateTPSLPrice = useCallback((
    position: Position,
    type: 'tp' | 'sl',
    price: number
  ): string | null => {
    if (position.side === 'buy') {
      // Long position: TP should be above entry, SL should be below
      if (type === 'tp' && price <= position.entryPrice) {
        return `Take Profit must be above entry price ($${position.entryPrice.toFixed(2)}) for long positions`;
      }
      if (type === 'sl' && price >= position.entryPrice) {
        return `Stop Loss must be below entry price ($${position.entryPrice.toFixed(2)}) for long positions`;
      }
    } else {
      // Short position: TP should be below entry, SL should be above
      if (type === 'tp' && price >= position.entryPrice) {
        return `Take Profit must be below entry price ($${position.entryPrice.toFixed(2)}) for short positions`;
      }
      if (type === 'sl' && price <= position.entryPrice) {
        return `Stop Loss must be above entry price ($${position.entryPrice.toFixed(2)}) for short positions`;
      }
    }
    return null;
  }, []);

  /**
   * Handle TP/SL box drag completion
   * Creates or updates orders when boxes are dropped
   */
  const handleTPSLDrop = useCallback((
    positionId: string,
    type: 'tp' | 'sl',
    price: number
  ) => {
    const position = positions.find((p) => p.id === positionId);
    if (!position || !onPlaceOrder || !onUpdatePositionTPSL) return;

    // Validate price
    const validationError = validateTPSLPrice(position, type, price);
    if (validationError) {
      alert(validationError);
      // Reset box to entry price
      const primitive = tpslPrimitivesRef.current.get(positionId);
      if (primitive) {
        if (type === 'tp') {
          primitive.setTPPrice(position.entryPrice);
        } else {
          primitive.setSLPrice(position.entryPrice);
        }
      }
      return;
    }

    // Find any existing TP/SL order for this position
    const existingOrder = activeOrders.find((order) => {
      // Check if this is a TP/SL order for the current position
      const isOppositeOrder = order.side !== position.side;
      const isTP = type === 'tp' && order.type === 'limit';
      const isSL = type === 'sl' && order.type === 'stop';
      const isSameSize = order.size === position.size;

      return isOppositeOrder && (isTP || isSL) && isSameSize;
    });

    // If existing order exists at a different price, we'll create a new one
    // (The old one will remain unless manually cancelled)

    // Create the order
    const orderSide: OrderSide = position.side === 'buy' ? 'sell' : 'buy'; // Opposite side to close
    const orderType: OrderType = type === 'tp' ? 'limit' : 'stop';

    onPlaceOrder(orderSide, orderType, position.size, price);

    // Update position TP/SL price
    if (type === 'tp') {
      onUpdatePositionTPSL(positionId, price, position.slPrice);
    } else {
      onUpdatePositionTPSL(positionId, position.tpPrice, price);
    }
  }, [positions, activeOrders, onPlaceOrder, onUpdatePositionTPSL, validateTPSLPrice]);

  /**
   * Handle mouse events for TP/SL box dragging
   */
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !chartContainerRef.current) return;

    const chartContainer = chartContainerRef.current;
    let currentHoveredBox: { positionId: string; type: 'tp' | 'sl' } | null = null;

    // Handle mouse down (start drag) - Use DOM event to catch it early
    const handleMouseDown = (event: MouseEvent) => {
      if (!chartRef.current || !seriesRef.current) return;

      const rect = chartContainer.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Check if any TP/SL box was clicked
      for (const [positionId, primitive] of tpslPrimitivesRef.current.entries()) {
        const hitResult = primitive.hitTest(x, y);
        if (hitResult && (hitResult.externalId === 'tp-box' || hitResult.externalId === 'sl-box')) {
          const type = hitResult.externalId === 'tp-box' ? 'tp' : 'sl';

          // Start drag operation
          isDraggingRef.current = true;
          draggedBoxRef.current = { positionId, type };
          dragStartYRef.current = y; // Store starting Y position for threshold check

          // Store starting price to reset if drag is too small
          dragStartPriceRef.current = type === 'tp' ? primitive.getTPPrice() : primitive.getSLPrice();

          setIsDraggingTPSL(true); // Update state for UI feedback
          primitive.setDraggingBox(type);

          event.preventDefault(); // Prevent text selection during drag
          break;
        }
      }
    };

    // Handle mouse move (update hover and drag)
    const handleMouseMove = (param: MouseEventParams) => {
      if (!param.point || !seriesRef.current) return;

      // Update hover state (only when not dragging)
      if (!isDraggingRef.current && param.hoveredObjectId) {
        const hoveredId = param.hoveredObjectId as string;
        if (hoveredId === 'tp-box' || hoveredId === 'sl-box') {
          const type = hoveredId === 'tp-box' ? 'tp' : 'sl';

          // Find which primitive is hovered
          for (const [positionId, primitive] of tpslPrimitivesRef.current.entries()) {
            const hitResult = primitive.hitTest(param.point.x, param.point.y);
            if (hitResult) {
              if (!currentHoveredBox || currentHoveredBox.positionId !== positionId || currentHoveredBox.type !== type) {
                primitive.setHoveredBox(type);
                currentHoveredBox = { positionId, type };
              }
            } else {
              primitive.setHoveredBox(null);
            }
          }
        }
      } else if (!isDraggingRef.current) {
        // Clear all hover states
        tpslPrimitivesRef.current.forEach((primitive) => {
          primitive.setHoveredBox(null);
        });
        currentHoveredBox = null;
      }

      // Update position while dragging
      if (isDraggingRef.current && draggedBoxRef.current) {
        const price = seriesRef.current.coordinateToPrice(param.point.y);
        if (price === null) return;

        const primitive = tpslPrimitivesRef.current.get(draggedBoxRef.current.positionId);
        if (primitive) {
          if (draggedBoxRef.current.type === 'tp') {
            primitive.setTPPrice(price);
          } else {
            primitive.setSLPrice(price);
          }
        }
      }
    };

    // Subscribe to chart move events and DOM mousedown
    chartContainer.addEventListener('mousedown', handleMouseDown);
    chartRef.current.subscribeCrosshairMove(handleMouseMove);

    // Cleanup
    return () => {
      chartContainer.removeEventListener('mousedown', handleMouseDown);
      chartRef.current?.unsubscribeCrosshairMove(handleMouseMove);
    };
  }, []); // Only run once on mount

  /**
   * Handle mouse up (end drag) using DOM event
   * Chart API doesn't provide mouseup event, so we use DOM
   * Includes drag threshold check to distinguish between clicks and drags
   */
  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      if (!isDraggingRef.current || !draggedBoxRef.current || !seriesRef.current || !chartContainerRef.current) return;

      const primitive = tpslPrimitivesRef.current.get(draggedBoxRef.current.positionId);
      if (!primitive) {
        // Reset state and return
        isDraggingRef.current = false;
        draggedBoxRef.current = null;
        dragStartYRef.current = null;
        dragStartPriceRef.current = null;
        setIsDraggingTPSL(false);
        return;
      }

      // Calculate movement distance from start position
      const rect = chartContainerRef.current.getBoundingClientRect();
      const currentY = event.clientY - rect.top;
      const startY = dragStartYRef.current ?? currentY;
      const dragDistance = Math.abs(currentY - startY);

      // Clear dragging visual state
      primitive.setDraggingBox(null);

      // Check if drag distance exceeds threshold
      if (dragDistance >= DRAG_THRESHOLD) {
        // Actual drag - place order at final price
        const finalPrice = draggedBoxRef.current.type === 'tp'
          ? primitive.getTPPrice()
          : primitive.getSLPrice();

        handleTPSLDrop(draggedBoxRef.current.positionId, draggedBoxRef.current.type, finalPrice);
      } else {
        // Click or tiny movement - reset box to starting position
        if (dragStartPriceRef.current !== null) {
          if (draggedBoxRef.current.type === 'tp') {
            primitive.setTPPrice(dragStartPriceRef.current);
          } else {
            primitive.setSLPrice(dragStartPriceRef.current);
          }
        }
      }

      // Reset all drag state
      isDraggingRef.current = false;
      draggedBoxRef.current = null;
      dragStartYRef.current = null;
      dragStartPriceRef.current = null;
      setIsDraggingTPSL(false);
    };

    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleTPSLDrop]); // Only handleTPSLDrop needed in dependencies

  /**
   * Handle mouse click on chart for drawing
   * Captures time and price coordinates for drawing tools
   */
  const handleChartClick = useCallback(
    (event: MouseEvent) => {
      if (!activeTool || !chartRef.current) return;

      const chart = chartRef.current;
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Get time and price at click position
      const timeScale = chart.timeScale();
      const priceScale = chart.priceScale('right');

      const time = timeScale.coordinateToTime(event.clientX - rect.left);
      const price = priceScale.coordinateToPrice(event.clientY - rect.top);

      if (time === null || price === null) return;

      const point: DrawingPoint = { time: time as number, price };

      if (activeTool === 'trendline' || activeTool === 'horizontal') {
        // Two-point tools: trendline and horizontal line
        if (currentDrawing.length === 0) {
          setCurrentDrawing([point]);
          setIsDrawing(true);
        } else {
          // Complete the drawing
          const newDrawing: Drawing = {
            id: `drawing-${Date.now()}`,
            type: activeTool,
            points: [...currentDrawing, point],
            style: {
              color: '#3f51b5',
              width: 2,
              lineStyle: 'solid',
            },
            createdAt: Date.now(),
          };
          setDrawings((prev) => [...prev, newDrawing]);
          setCurrentDrawing([]);
          setIsDrawing(false);
          setActiveTool(null);
        }
      } else if (activeTool === 'rectangle') {
        // Rectangle needs two corner points
        if (currentDrawing.length === 0) {
          setCurrentDrawing([point]);
          setIsDrawing(true);
        } else {
          const newDrawing: Drawing = {
            id: `drawing-${Date.now()}`,
            type: 'rectangle',
            points: [...currentDrawing, point],
            style: {
              color: '#3f51b5',
              width: 2,
              lineStyle: 'solid',
            },
            createdAt: Date.now(),
          };
          setDrawings((prev) => [...prev, newDrawing]);
          setCurrentDrawing([]);
          setIsDrawing(false);
          setActiveTool(null);
        }
      }
    },
    [activeTool, currentDrawing]
  );

  /**
   * Attach click handler to chart
   */
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    container.addEventListener('click', handleChartClick as any);

    return () => {
      container.removeEventListener('click', handleChartClick as any);
    };
  }, [handleChartClick]);

  /**
   * Render drawings on chart using line series
   */
  useEffect(() => {
    if (!chartRef.current) return;

    // Clear existing drawing series
    drawingSeriesRef.current.forEach((series) => {
      chartRef.current?.removeSeries(series);
    });
    drawingSeriesRef.current.clear();

    // Render each drawing
    drawings.forEach((drawing) => {
      if (drawing.type === 'trendline' && drawing.points.length === 2) {
        // Create line series for trendline
        const lineSeries = chartRef.current!.addSeries(LineSeries, {
          color: drawing.style.color,
          lineWidth: drawing.style.width,
          lineStyle: drawing.style.lineStyle === 'solid' ? 0 : drawing.style.lineStyle === 'dashed' ? 1 : 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        lineSeries.setData([
          { time: drawing.points[0].time, value: drawing.points[0].price },
          { time: drawing.points[1].time, value: drawing.points[1].price },
        ]);

        drawingSeriesRef.current.set(drawing.id, lineSeries);
      } else if (drawing.type === 'horizontal' && drawing.points.length >= 1) {
        // Create horizontal price line
        chartRef.current!.addPriceLine({
          price: drawing.points[0].price,
          color: drawing.style.color,
          lineWidth: drawing.style.width,
          lineStyle: drawing.style.lineStyle === 'solid' ? 0 : drawing.style.lineStyle === 'dashed' ? 1 : 2,
          axisLabelVisible: true,
          title: '',
        });
      } else if (drawing.type === 'rectangle' && drawing.points.length === 2) {
        // Draw rectangle using 4 line series (top, bottom, left, right)
        const [point1, point2] = drawing.points;
        const minTime = Math.min(point1.time, point2.time);
        const maxTime = Math.max(point1.time, point2.time);
        const minPrice = Math.min(point1.price, point2.price);
        const maxPrice = Math.max(point1.price, point2.price);

        // Top line
        const topLine = chartRef.current!.addSeries(LineSeries, {
          color: drawing.style.color,
          lineWidth: drawing.style.width,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        topLine.setData([
          { time: minTime, value: maxPrice },
          { time: maxTime, value: maxPrice },
        ]);

        // Bottom line
        const bottomLine = chartRef.current!.addSeries(LineSeries, {
          color: drawing.style.color,
          lineWidth: drawing.style.width,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bottomLine.setData([
          { time: minTime, value: minPrice },
          { time: maxTime, value: minPrice },
        ]);

        drawingSeriesRef.current.set(drawing.id + '-top', topLine);
        drawingSeriesRef.current.set(drawing.id + '-bottom', bottomLine);
      }
    });
  }, [drawings]);

  /**
   * Clear all drawings
   */
  const clearDrawings = useCallback(() => {
    setDrawings([]);
    setCurrentDrawing([]);
    setIsDrawing(false);
    setActiveTool(null);
  }, []);

  return (
    <div className="w-full h-full relative">
      {/* Chart title */}
      <div className="absolute top-4 left-4 z-10 text-white">
        <h2 className="text-xl font-semibold">STOCK-SIM</h2>
        <p className="text-sm text-gray-400">1s intervals</p>
      </div>

      {/* Drawing Toolbar - appears when drawing tools are enabled */}
      {showDrawingTools && (
        <div className="absolute top-4 right-4 z-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2 shadow-lg">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-gray-400 font-semibold mb-1 px-2">Drawing Tools</div>

            {/* Trendline Tool */}
            <button
              onClick={() => setActiveTool(activeTool === 'trendline' ? null : 'trendline')}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                activeTool === 'trendline'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#0a0a0a] text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              📈 Trendline
            </button>

            {/* Horizontal Line Tool */}
            <button
              onClick={() => setActiveTool(activeTool === 'horizontal' ? null : 'horizontal')}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                activeTool === 'horizontal'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#0a0a0a] text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              ➖ Horizontal
            </button>

            {/* Rectangle Tool */}
            <button
              onClick={() => setActiveTool(activeTool === 'rectangle' ? null : 'rectangle')}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                activeTool === 'rectangle'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#0a0a0a] text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              ▭ Rectangle
            </button>

            {/* Clear All Drawings */}
            {drawings.length > 0 && (
              <>
                <div className="border-t border-[#2a2a2a] my-1"></div>
                <button
                  onClick={clearDrawings}
                  className="px-3 py-2 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  🗑️ Clear All
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Drawing status indicator */}
      {isDrawing && activeTool && (
        <div className="absolute top-20 right-4 z-20 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
          Click to complete {activeTool}
        </div>
      )}

      {/* Chart container */}
      <div ref={chartContainerRef} className="w-full h-full" />

      {/* Show message if no data yet */}
      {bars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          <p>Waiting for market data...</p>
        </div>
      )}
    </div>
  );
}
