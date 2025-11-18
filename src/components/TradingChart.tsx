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

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';
import { Bar } from '@/types/market';

interface TradingChartProps {
  bars: Bar[];
  currentBar: Bar | null;
}

export function TradingChart({ bars, currentBar }: TradingChartProps) {
  // Refs to persist chart instances across renders
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

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
    const candlestickSeries = chart.addCandlestickSeries({
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

  return (
    <div className="w-full h-full relative">
      {/* Chart title */}
      <div className="absolute top-4 left-4 z-10 text-white">
        <h2 className="text-xl font-semibold">STOCK-SIM</h2>
        <p className="text-sm text-gray-400">1s intervals</p>
      </div>

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
