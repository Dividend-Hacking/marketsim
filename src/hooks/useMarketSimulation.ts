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
  Portfolio,
  UserOrder,
  OrderType,
  OrderSide,
  Position,
  CompletedTrade,
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

  // Portfolio state - starts with $100,000 cash
  const [portfolio, setPortfolio] = useState<Portfolio>({
    cash: 100000,
    positions: [],
    activeOrders: [],
    totalEquity: 100000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    tradeHistory: [],
  });

  // Interval reference for cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Execute a user order (fill it and update positions/cash)
   * Handles opening new positions and closing/modifying existing ones
   *
   * CRITICAL: Maintains immutability - creates all new objects/arrays
   * This ensures React properly detects state changes
   */
  const executeOrder = useCallback((order: UserOrder, fillPrice: number) => {
    setPortfolio((prev) => {
      // Calculate order details
      const fillSize = order.size - order.filledSize;
      const fillCost = fillSize * fillPrice;

      // Initialize values that will be updated
      let positions = [...prev.positions]; // Create new array
      let cash = prev.cash;
      let realizedPnL = prev.realizedPnL;
      let remainingSize = fillSize;
      let tradePnL = 0;

      // Process closing of opposite positions (immutably)
      positions = positions.map((position) => {
        // Skip if not opposite side or no remaining size to fill
        if (position.side === order.side || remainingSize <= 0) {
          return position; // Return unchanged
        }

        // Calculate how much to close
        const closeSize = Math.min(position.size, remainingSize);

        // Calculate P&L for this close
        const pnl =
          position.side === 'buy'
            ? (fillPrice - position.entryPrice) * closeSize
            : (position.entryPrice - fillPrice) * closeSize;

        realizedPnL += pnl;
        tradePnL += pnl;
        remainingSize -= closeSize;

        // Return NEW position object with updated size
        return {
          ...position,
          size: position.size - closeSize,
        };
      }).filter((p) => p.size > 0); // Remove fully closed positions

      // Open or add to position if remaining size (immutably)
      if (remainingSize > 0) {
        const existingPositionIndex = positions.findIndex(
          (pos) => pos.side === order.side
        );

        if (existingPositionIndex !== -1) {
          // Add to existing position - create new object
          const existingPosition = positions[existingPositionIndex];
          const totalSize = existingPosition.size + remainingSize;
          const newEntryPrice =
            (existingPosition.entryPrice * existingPosition.size +
              fillPrice * remainingSize) /
            totalSize;

          positions = [
            ...positions.slice(0, existingPositionIndex),
            {
              ...existingPosition,
              size: totalSize,
              entryPrice: newEntryPrice,
            },
            ...positions.slice(existingPositionIndex + 1),
          ];
        } else {
          // Create new position
          const newPosition: Position = {
            id: `pos-${Date.now()}-${Math.random()}`,
            symbol: 'STOCK',
            side: order.side,
            size: remainingSize,
            entryPrice: fillPrice,
            currentPrice: fillPrice,
            unrealizedPnL: 0,
            openTimestamp: Date.now(),
          };
          positions = [...positions, newPosition];
        }
      }

      // Update cash (immutably - already creating new value)
      if (order.side === 'buy') {
        cash -= fillCost;
      } else {
        cash += fillCost;
      }

      // Create trade record
      const trade: CompletedTrade = {
        id: `trade-${Date.now()}-${Math.random()}`,
        orderId: order.id,
        side: order.side,
        size: fillSize,
        price: fillPrice,
        timestamp: Date.now(),
        pnl: tradePnL,
      };

      // Add to trade history (immutably)
      const tradeHistory = [trade, ...prev.tradeHistory.slice(0, 99)];

      // Remove from active orders (immutably)
      const activeOrders = prev.activeOrders.filter((o) => o.id !== order.id);

      // Return completely new portfolio object (all fields new)
      return {
        cash,
        positions,
        activeOrders,
        totalEquity: prev.totalEquity, // Will be recalculated by updatePortfolioValue
        realizedPnL,
        unrealizedPnL: prev.unrealizedPnL, // Will be recalculated by updatePortfolioValue
        tradeHistory,
      };
    });
  }, []);

  /**
   * Check and fill limit/stop orders based on current price
   * Called every simulation step to monitor pending orders
   *
   * Note: This function reads from portfolio state and calls executeOrder,
   * which handles all state updates internally. No direct state mutation needed here.
   */
  const checkAndFillOrders = useCallback((currentPrice: number) => {
    // Get current portfolio state to check active orders
    setPortfolio((prev) => {
      const ordersToFill: UserOrder[] = [];

      // Find orders that should be filled based on current price
      for (const order of prev.activeOrders) {
        if (order.type === 'limit') {
          // Limit buy fills when price <= limit price
          // Limit sell fills when price >= limit price
          if (
            (order.side === 'buy' && currentPrice <= (order.limitPrice || 0)) ||
            (order.side === 'sell' && currentPrice >= (order.limitPrice || 0))
          ) {
            ordersToFill.push(order);
          }
        } else if (order.type === 'stop') {
          // Stop buy fills when price >= stop price
          // Stop sell fills when price <= stop price
          if (
            (order.side === 'buy' && currentPrice >= (order.stopPrice || 0)) ||
            (order.side === 'sell' && currentPrice <= (order.stopPrice || 0))
          ) {
            ordersToFill.push(order);
          }
        }
      }

      // Execute all triggered orders outside this callback
      // Each executeOrder call properly updates state independently
      if (ordersToFill.length > 0) {
        // Use setTimeout to execute orders outside of this state update
        setTimeout(() => {
          ordersToFill.forEach((order) => {
            executeOrder(order, currentPrice);
          });
        }, 0);
      }

      // Return unchanged state - executeOrder handles all updates
      return prev;
    });
  }, [executeOrder]);

  /**
   * Update portfolio value based on current market price
   * Recalculates unrealized P&L and total equity
   */
  const updatePortfolioValue = useCallback((currentPrice: number) => {
    setPortfolio((prev) => {
      let unrealizedPnL = 0;

      // Update all position values
      const updatedPositions = prev.positions.map((position) => {
        const updatedPosition = { ...position };
        updatedPosition.currentPrice = currentPrice;

        // Calculate unrealized P&L for this position
        const pnl =
          position.side === 'buy'
            ? (currentPrice - position.entryPrice) * position.size
            : (position.entryPrice - currentPrice) * position.size;

        updatedPosition.unrealizedPnL = pnl;
        unrealizedPnL += pnl;

        return updatedPosition;
      });

      // Calculate total equity (cash + position values)
      // For long positions: add value (you own the shares)
      // For short positions: subtract value (you owe the shares - it's a liability)
      const positionValue = updatedPositions.reduce((sum, pos) => {
        const value = pos.side === 'buy'
          ? pos.size * pos.currentPrice  // Long: you own shares worth this much
          : -pos.size * pos.currentPrice; // Short: you owe shares worth this much (liability)
        return sum + value;
      }, 0);

      const totalEquity = prev.cash + positionValue;

      return {
        ...prev,
        positions: updatedPositions,
        unrealizedPnL,
        totalEquity,
      };
    });
  }, []);

  /**
   * Place a new user order
   * Market orders execute immediately, limit/stop orders are queued
   */
  const placeOrder = useCallback(
    (side: OrderSide, type: OrderType, size: number, price?: number) => {
      // Create new order
      const newOrder: UserOrder = {
        id: `order-${Date.now()}-${Math.random()}`,
        type,
        side,
        size,
        limitPrice: type === 'limit' ? price : undefined,
        stopPrice: type === 'stop' ? price : undefined,
        status: type === 'market' ? 'filled' : 'pending',
        filledSize: 0,
        avgFillPrice: 0,
        timestamp: Date.now(),
      };

      // Market orders execute immediately
      if (type === 'market') {
        const currentPrice = state.stats.lastPrice;
        executeOrder(newOrder, currentPrice);
      } else {
        // Limit/Stop orders are added to active orders
        setPortfolio((prev) => ({
          ...prev,
          activeOrders: [...prev.activeOrders, newOrder],
        }));
      }
    },
    [state.stats.lastPrice, executeOrder]
  );

  /**
   * Cancel a pending order
   */
  const cancelOrder = useCallback((orderId: string) => {
    setPortfolio((prev) => ({
      ...prev,
      activeOrders: prev.activeOrders.filter((o) => o.id !== orderId),
    }));
  }, []);

  /**
   * Update TP/SL prices for a position
   * Called when user drags TP/SL boxes to new price levels
   */
  const updatePositionTPSL = useCallback((
    positionId: string,
    tpPrice?: number,
    slPrice?: number
  ) => {
    setPortfolio((prev) => ({
      ...prev,
      positions: prev.positions.map((pos) =>
        pos.id === positionId
          ? { ...pos, tpPrice, slPrice }
          : pos
      ),
    }));
  }, []);

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
   * - Checks and fills limit/stop orders
   * - Updates portfolio value based on current price
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

    // Automatic regime switching disabled - market stays in sideways unless user changes it
    // simulator.maybeChangeRegime();

    // Update React state with new data
    updateState();

    // Get current price for portfolio updates
    const bars = simulator.getBars();
    if (bars.length > 0) {
      const currentPrice = bars[bars.length - 1].close;

      // Check and fill any triggered limit/stop orders
      checkAndFillOrders(currentPrice);

      // Update portfolio value with current price
      updatePortfolioValue(currentPrice);
    }
  }, [updateState, checkAndFillOrders, updatePortfolioValue]);

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
    portfolio,

    // Controls
    pause,
    resume,
    togglePause,
    setSpeed,
    injectEvent,

    // Trading functions
    placeOrder,
    cancelOrder,
    updatePositionTPSL,
  };
}
