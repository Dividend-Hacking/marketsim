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
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, CandlestickData, LineSeries, ISeriesApi as LineSeriesApi, IPriceLine } from 'lightweight-charts';
import { Bar, Drawing, DrawingToolType, DrawingPoint, UserOrder, CompletedTrade, Position } from '@/types/market';

interface TradingChartProps {
  bars: Bar[];
  currentBar: Bar | null;
  showDrawingTools: boolean;
  activeOrders: UserOrder[];
  tradeHistory: CompletedTrade[];
  positions: Position[];
}

export function TradingChart({ bars, currentBar, showDrawingTools, activeOrders, tradeHistory, positions }: TradingChartProps) {
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
  const filledOrderLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const positionLinesRef = useRef<Map<string, IPriceLine>>(new Map());

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
   * Render filled orders as historical markers on the chart
   * Shows last 10 filled orders with semi-transparent styling
   */
  useEffect(() => {
    if (!seriesRef.current) return;

    // Clear all existing filled order lines
    filledOrderLinesRef.current.forEach((priceLine) => {
      seriesRef.current?.removePriceLine(priceLine);
    });
    filledOrderLinesRef.current.clear();

    // Show last 10 filled orders
    const recentTrades = tradeHistory.slice(0, 10);

    recentTrades.forEach((trade) => {
      // Determine color based on trade side (lighter/more transparent)
      const color = trade.side === 'buy' ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)';

      // Create label with trade details
      const label = `FILLED ${trade.size} @ $${trade.price.toFixed(2)}`;

      // Create price line for filled order
      const priceLine = seriesRef.current!.createPriceLine({
        price: trade.price,
        color: color,
        lineWidth: 1,
        lineStyle: 3, // Dotted line for filled orders
        axisLabelVisible: true,
        title: label,
      });

      filledOrderLinesRef.current.set(trade.id, priceLine);
    });
  }, [tradeHistory]);

  /**
   * Render open positions as solid lines on the chart
   * Shows entry price with real-time P&L updates
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
