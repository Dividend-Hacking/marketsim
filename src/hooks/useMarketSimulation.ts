/**
 * Market Simulation Hook - ENHANCED with Web Worker Performance
 *
 * React hook that manages the market simulation state and provides controls.
 * Uses OrderFlowSimulator running in a Web Worker for improved performance.
 *
 * PERFORMANCE ENHANCEMENTS:
 * =========================
 * ✅ Web Worker - Simulation runs on background thread (30-60% faster)
 * ✅ Transaction Costs - Commission + exchange fees + SEC fees
 * ✅ Market Maker Inventory Management (Phase 1)
 *
 * ARCHITECTURE:
 * =============
 * Web Worker Thread:
 * - OrderFlowSimulator: Generates prices through agent-based order flow
 * - Multiple informed traders with correlated GBM beliefs
 * - Market makers providing liquidity with inventory management
 * - Noise traders creating volume
 * - Jump generator for news shocks
 * - Order flow generator for volatility clustering
 * - True price discovery through order book matching
 *
 * Main Thread:
 * - React state management and UI rendering
 * - Portfolio management and user order execution
 * - Chart rendering and interactions
 *
 * Message Protocol:
 * - Worker → Main: State updates (bars, trades, orderBook) every 250ms / speed
 * - Main → Worker: Commands (pause, speed, regime, events)
 *
 * Usage:
 * const simulation = useMarketSimulation();
 * // Access: simulation.bars, simulation.orderBook, simulation.trades, etc.
 * // Control: simulation.pause(), simulation.resume(), simulation.setSpeed(), etc.
 */

'use client';

/**
 * Calculate realistic transaction costs for a trade
 *
 * Components:
 * - Commission: $0.0005 per share (retail rate)
 * - Exchange fee: $0.0003 per share
 * - SEC fee: 0.00145% of trade value (Section 31 fee)
 *
 * Total: ~$0.0008/share + 0.00145% of value
 *
 * Example: 100 shares @ $100 = $10,000 trade
 * - Commission: 100 * $0.0005 = $0.05
 * - Exchange: 100 * $0.0003 = $0.03
 * - SEC: $10,000 * 0.0000145 = $0.145
 * - Total: $0.225 (0.00225% of trade value)
 */
function calculateTransactionCosts(size: number, price: number): number {
  const commission = size * 0.0005; // $0.0005 per share
  const exchangeFee = size * 0.0003; // $0.0003 per share
  const tradeValue = size * price;
  const secFee = tradeValue * 0.0000145; // 0.00145% SEC Section 31 fee

  return commission + exchangeFee + secFee;
}

import { useState, useEffect, useRef, useCallback } from 'react';
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

export function useMarketSimulation() {
  // Web Worker reference (runs simulation in background thread)
  const workerRef = useRef<Worker | null>(null);

  // Simulation state
  const [state, setState] = useState<SimulationState>({
    isRunning: true,
    speed: 2.0, // Start at 2x speed for responsive feel (8 bars/sec, 20 updates/sec)
    regime: 'bull', // DEFAULT BULL: Growth stocks trend upward (like AAPL, TSLA)
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

  /**
   * OPTIMIZATION: Helper function to check if an order is a TP/SL for a position
   * Extracted to avoid duplicate logic (was duplicated in two places in executeOrder)
   */
  const isTPSLOrderForPosition = useCallback((order: UserOrder, position: Position): boolean => {
    // Check if this order is TP for this position (with floating-point tolerance)
    const isTpOrder =
      order.type === 'limit' &&
      order.side !== position.side &&
      order.size === position.size &&
      position.tpPrice !== undefined &&
      Math.abs(order.limitPrice! - position.tpPrice) < 0.01;

    // Check if this order is SL for this position (with floating-point tolerance)
    const isSlOrder =
      order.type === 'stop' &&
      order.side !== position.side &&
      order.size === position.size &&
      position.slPrice !== undefined &&
      Math.abs(order.stopPrice! - position.slPrice) < 0.01;

    return isTpOrder || isSlOrder;
  }, []);

  /**
   * Execute a user order (fill it and update positions/cash) - OPTIMIZED
   * Handles opening new positions and closing/modifying existing ones
   *
   * OPTIMIZATIONS:
   * - Deduplicated TP/SL filter logic using helper function
   * - Single-pass filtering instead of two separate filter operations
   *
   * CRITICAL: Maintains immutability - creates all new objects/arrays
   * This ensures React properly detects state changes
   */
  const executeOrder = useCallback((order: UserOrder, fillPrice: number) => {
    setPortfolio((prev) => {
      // For position-closing orders (TP/SL), use the current position size instead of order size
      // This prevents flipping the position if sizes don't match
      let actualFillSize = order.size - order.filledSize;

      if (order.closePosition && order.linkedPositionId) {
        // Find the linked position
        const linkedPosition = prev.positions.find(p => p.id === order.linkedPositionId);
        if (linkedPosition) {
          // Use the current position size instead of the order's fixed size
          actualFillSize = linkedPosition.size;
        } else {
          // Position no longer exists - cancel this order execution
          return prev;
        }
      }

      const fillSize = actualFillSize;
      const fillCost = fillSize * fillPrice;

      // Initialize values that will be updated
      let positions = [...prev.positions]; // Create new array
      let cash = prev.cash;
      let realizedPnL = prev.realizedPnL;
      let remainingSize = fillSize;
      let tradePnL = 0;

      // PRE-EMPTIVELY cancel TP/SL orders for positions that will be closed
      // This prevents race conditions where both TP and SL execute before state updates
      // OPTIMIZED: Using helper function to check TP/SL orders
      let activeOrders = prev.activeOrders.filter((o) => {
        // Remove the executed order first
        if (o.id === order.id) return false;

        // Check if this order is a TP/SL for a position that will be closed
        for (const position of prev.positions) {
          // Skip if not opposite side (won't be closed by this order)
          if (position.side === order.side) continue;

          // Use helper function for TP/SL checking
          if (isTPSLOrderForPosition(o, position)) {
            return false; // Cancel this order
          }
        }

        return true; // Keep other orders
      });

      // Track positions that will be closed (for additional safety check later)
      const closedPositionIds: string[] = [];

      // Process closing of opposite positions (immutably)
      positions = positions.map((position) => {
        // For closePosition orders, only close the specific linked position
        if (order.closePosition && order.linkedPositionId) {
          if (position.id !== order.linkedPositionId) {
            return position; // Skip positions that aren't the linked one
          }
          // Continue to close this specific position below
        } else {
          // For regular orders, skip if not opposite side or no remaining size to fill
          if (position.side === order.side || remainingSize <= 0) {
            return position; // Return unchanged
          }
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

        // Track if this position will be fully closed
        const newSize = position.size - closeSize;
        if (newSize <= 0) {
          closedPositionIds.push(position.id);
        }

        // Return NEW position object with updated size
        return {
          ...position,
          size: newSize,
        };
      }).filter((p) => p.size > 0); // Remove fully closed positions

      // Open or add to position if remaining size (immutably)
      // IMPORTANT: For closePosition orders (TP/SL), never open a new position
      // This prevents flipping the position when TP/SL triggers
      if (remainingSize > 0 && !order.closePosition) {
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

      // Update cash with REALISTIC TRANSACTION COSTS
      const transactionCosts = calculateTransactionCosts(fillSize, fillPrice);

      if (order.side === 'buy') {
        cash -= fillCost + transactionCosts; // Pay for shares + costs
      } else {
        cash += fillCost - transactionCosts; // Receive proceeds - costs
      }

      // Deduct costs from realized P&L for accurate tracking
      realizedPnL -= transactionCosts;

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

      // Note: activeOrders already filtered pre-emptively above
      // This section kept as additional safety check for any edge cases
      // OPTIMIZED: Using helper function for TP/SL checking
      activeOrders = activeOrders.filter((o) => {
        // If no positions were closed, keep all orders
        if (closedPositionIds.length === 0) return true;

        // For each closed position, double-check no TP/SL orders remain
        for (const closedPosId of closedPositionIds) {
          // Find the closed position in the ORIGINAL prev.positions array
          const closedPosition = prev.positions.find(p => p.id === closedPosId);
          if (!closedPosition) continue;

          // Use helper function for TP/SL checking
          if (isTPSLOrderForPosition(o, closedPosition)) {
            return false; // Cancel this order
          }
        }

        return true;
      });

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
  }, [isTPSLOrderForPosition]);

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

      // Execute only the FIRST triggered order to prevent race conditions
      // If multiple orders trigger simultaneously, they'll be handled in subsequent ticks
      // This ensures state updates complete before the next order executes
      if (ordersToFill.length > 0) {
        // Sort orders: stop orders first (SL protection), then limit orders (TP)
        // This prioritizes risk management over profit taking
        const sortedOrders = [...ordersToFill].sort((a, b) => {
          if (a.type === 'stop' && b.type !== 'stop') return -1;
          if (a.type !== 'stop' && b.type === 'stop') return 1;
          return 0;
        });

        // Execute only the first order
        setTimeout(() => {
          executeOrder(sortedOrders[0], currentPrice);
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
   * For TP/SL orders, set closePosition=true and linkedPositionId to ensure proper closing
   */
  const placeOrder = useCallback(
    (
      side: OrderSide,
      type: OrderType,
      size: number,
      price?: number,
      options?: { closePosition?: boolean; linkedPositionId?: string }
    ) => {
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
        closePosition: options?.closePosition,
        linkedPositionId: options?.linkedPositionId,
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
   * Refs to store latest callback functions
   * This prevents worker from being recreated on every state update
   */
  const calculateStatsRef = useRef(calculateStats);
  const checkAndFillOrdersRef = useRef(checkAndFillOrders);
  const updatePortfolioValueRef = useRef(updatePortfolioValue);

  /**
   * Keep refs synced with latest callback functions
   * Runs on every render to ensure refs always have current functions
   */
  useEffect(() => {
    calculateStatsRef.current = calculateStats;
    checkAndFillOrdersRef.current = checkAndFillOrders;
    updatePortfolioValueRef.current = updatePortfolioValue;
  });

  /**
   * Initialize Web Worker and set up message handler
   * CRITICAL: Empty dependency array ensures worker is only created ONCE on mount
   * Worker persists throughout component lifecycle, accumulating bars correctly
   */
  useEffect(() => {
    // Create worker
    const worker = new Worker(new URL('../workers/simulationWorker.ts', import.meta.url));
    workerRef.current = worker;

    // Handle messages from worker
    worker.onmessage = (event: MessageEvent) => {
      const { type, payload, error } = event.data;

      switch (type) {
        case 'READY':
          // Worker initialized - start simulation
          worker.postMessage({
            type: 'START',
            initialPrice: INITIAL_PRICE,
          });
          break;

        case 'STATE_UPDATE':
          // Received state snapshot from worker
          if (payload) {
            const { bars, trades, orderBook, regime } = payload;

            // ALWAYS update portfolio on every worker message (4x per second)
            // This ensures responsive order fills and live P&L updates
            if (bars.length > 0) {
              const currentPrice = bars[bars.length - 1].close;
              checkAndFillOrdersRef.current(currentPrice);
              updatePortfolioValueRef.current(currentPrice);
            }

            // CONDITIONALLY update UI state based on bar changes
            // This throttles order book/chart updates to prevent visual mismatch
            setState((prev) => {
              const barsChanged = bars.length !== prev.bars.length;

              if (barsChanged) {
                // Bar closed - full state update including order book
                const stats = calculateStatsRef.current(bars);

                return {
                  ...prev,
                  currentBar: null, // OrderFlowSimulator only exposes completed bars
                  bars,
                  trades,
                  orderBook, // ← Only update order book when bar closes
                  stats,
                  regime,
                };
              } else {
                // Sub-step within bar - only update trades (skip order book)
                // This prevents order book from "racing ahead" of chart
                return {
                  ...prev,
                  trades, // Keep trades updated for real-time feed
                };
              }
            });
          }
          break;

        case 'ERROR':
          // Handle worker errors
          console.error('Simulation worker error:', error);
          break;

        default:
          console.warn('Unknown message type from worker:', type);
      }
    };

    // Handle worker errors
    worker.onerror = (event: ErrorEvent) => {
      console.error('Worker error:', event.message);
    };

    // Cleanup on unmount
    return () => {
      worker.terminate();
    };
  }, []); // Empty deps - worker created once on mount, never recreated

  /**
   * Control functions - send commands to worker
   */
  const pause = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'PAUSE' });
    }
    setState((prev) => ({ ...prev, isRunning: false }));
  }, []);

  const resume = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESUME' });
    }
    setState((prev) => ({ ...prev, isRunning: true }));
  }, []);

  const togglePause = useCallback(() => {
    setState((prev) => {
      const newIsRunning = !prev.isRunning;
      if (workerRef.current) {
        workerRef.current.postMessage({ type: newIsRunning ? 'RESUME' : 'PAUSE' });
      }
      return { ...prev, isRunning: newIsRunning };
    });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    const clampedSpeed = Math.max(0.1, Math.min(20, speed)); // Allow up to 20x speed
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'SPEED', speed: clampedSpeed });
    }
    setState((prev) => ({ ...prev, speed: clampedSpeed }));
  }, []);

  const setRegime = useCallback((regime: SimulationState['regime']) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'REGIME', regime });
    }
    setState((prev) => ({ ...prev, regime }));
  }, []);

  const injectEvent = useCallback((event: MarketEvent) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'EVENT', event });
    }
  }, []);

  return {
    // State
    ...state,
    portfolio,

    // Controls
    pause,
    resume,
    togglePause,
    setSpeed,
    setRegime,
    injectEvent,

    // Trading functions
    placeOrder,
    cancelOrder,
    updatePositionTPSL,
  };
}
