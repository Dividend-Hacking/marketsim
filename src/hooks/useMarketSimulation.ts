/**
 * Market Simulation Hook
 *
 * React hook that manages the market simulation state and provides controls.
 * Uses OrderFlowSimulator for realistic price generation through order book matching.
 *
 * ARCHITECTURE:
 * =============
 * OrderFlowSimulator: Generates prices through agent-based order flow
 * - Multiple informed traders with correlated GBM beliefs
 * - Market makers providing liquidity
 * - Noise traders creating volume
 * - Jump generator for news shocks
 * - Order flow generator for volatility clustering
 * - True price discovery through order book matching
 *
 * Usage:
 * const simulation = useMarketSimulation();
 * // Access: simulation.bars, simulation.orderBook, simulation.trades, etc.
 * // Control: simulation.pause(), simulation.resume(), simulation.setSpeed(), etc.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { OrderFlowSimulator } from '@/lib/OrderFlowSimulator';
import {
  SimulationState,
  MarketEvent,
  MarketStats,
  Bar,
} from '@/types/market';

const INITIAL_PRICE = 100;
const INITIAL_VOLATILITY = 0.15;
const BASE_INTERVAL_MS = 250; // 4 bars per second at 1x speed (0.25s per bar)

export function useMarketSimulation() {
  // Initialize OrderFlowSimulator (generates prices through order book matching)
  const simulatorRef = useRef<OrderFlowSimulator>(
    new OrderFlowSimulator(INITIAL_PRICE)
  );

  // Simulation state
  const [state, setState] = useState<SimulationState>({
    isRunning: true,
    speed: 1.0,
    regime: 'sideways',
    currentBar: null,
    bars: [],
    trades: [],
    orderBook: {
      bids: [],
      asks: [],
      spread: 0,
      midPrice: INITIAL_PRICE,
    },
    stats: {
      lastPrice: INITIAL_PRICE,
      change24h: 0,
      volume24h: 0,
      high24h: INITIAL_PRICE,
      low24h: INITIAL_PRICE,
      lastTradeDirection: 'neutral',
    },
  });

  // Interval reference for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Calculate market statistics from bars and trades
   */
  const calculateStats = useCallback((bars: Bar[]): MarketStats => {
    if (bars.length === 0) {
      return state.stats;
    }

    const lastBar = bars[bars.length - 1];
    const lastPrice = lastBar.close;

    // Calculate 24h stats (or session start if less than 24h)
    const startBar = bars.length > 86400 ? bars[bars.length - 86400] : bars[0];
    const startPrice = startBar.open;

    const change24h = ((lastPrice - startPrice) / startPrice) * 100;

    // Calculate volume, high, low over period
    let volume24h = 0;
    let high24h = lastPrice;
    let low24h = lastPrice;

    const relevantBars = bars.length > 86400 ? bars.slice(-86400) : bars;
    for (const bar of relevantBars) {
      volume24h += bar.volume;
      high24h = Math.max(high24h, bar.high);
      low24h = Math.min(low24h, bar.low);
    }

    // Determine last trade direction
    let lastTradeDirection: 'up' | 'down' | 'neutral' = 'neutral';
    if (bars.length >= 2) {
      const prevBar = bars[bars.length - 2];
      if (lastBar.close > prevBar.close) {
        lastTradeDirection = 'up';
      } else if (lastBar.close < prevBar.close) {
        lastTradeDirection = 'down';
      }
    }

    return {
      lastPrice,
      change24h,
      volume24h,
      high24h,
      low24h,
      lastTradeDirection,
    };
  }, [state.stats]);

  /**
   * Update simulation state from OrderFlowSimulator
   */
  const updateState = useCallback(() => {
    const simulator = simulatorRef.current;

    // Get data from OrderFlowSimulator
    const bars = simulator.getBars();
    const trades = simulator.getTrades(50);
    const orderBookSnapshot = simulator.getOrderBookSnapshot();

    // OrderFlowSimulator only exposes completed bars (no incomplete "current" bar)
    // Setting to null prevents duplicate bar being added to chart
    const currentBar = null;

    const stats = calculateStats(bars);

    setState((prev) => ({
      ...prev,
      currentBar,
      bars,
      trades,
      orderBook: orderBookSnapshot,
      stats,
      regime: simulator.getRegime(),
    }));
  }, [calculateStats]);

  /**
   * Simulation step - called every interval
   *
   * Each step:
   * - Updates order flow activity (volatility clustering)
   * - Checks for jump events (news shocks)
   * - Updates informed trader beliefs (correlated GBM)
   * - Generates orders from all agents
   * - Matches orders in order book (price discovery)
   * - Records trades and creates OHLC bars
   */
  const simulationStep = useCallback(() => {
    const simulator = simulatorRef.current;

    // Generate 7 price updates per bar for realistic OHLC variation
    // This creates candlesticks with visible bodies and wicks
    // Each step processes order flow and matches orders
    const STEPS_PER_BAR = 7;

    for (let i = 0; i < STEPS_PER_BAR; i++) {
      simulator.simulateStep();
    }

    // Close bar after all steps (creates OHLC from actual trades)
    simulator.closeCurrentBar();

    // Maybe change regime randomly (affects informed trader beliefs)
    simulator.maybeChangeRegime();

    // Update React state with new data
    updateState();
  }, [updateState]);

  /**
   * Start the simulation loop
   */
  useEffect(() => {
    if (state.isRunning) {
      const interval = BASE_INTERVAL_MS / state.speed;

      intervalRef.current = setInterval(simulationStep, interval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [state.isRunning, state.speed, simulationStep]);

  /**
   * Control functions
   */
  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isRunning: false }));
  }, []);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, isRunning: true }));
  }, []);

  const togglePause = useCallback(() => {
    setState((prev) => ({ ...prev, isRunning: !prev.isRunning }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed: Math.max(0.1, Math.min(5, speed)) }));
  }, []);

  const injectEvent = useCallback((event: MarketEvent) => {
    const simulator = simulatorRef.current;
    simulator.injectEvent(event);
    updateState();
  }, [updateState]);

  return {
    // State
    ...state,

    // Controls
    pause,
    resume,
    togglePause,
    setSpeed,
    injectEvent,
  };
}
