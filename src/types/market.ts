/**
 * Market Simulation Type Definitions
 *
 * This file contains all type definitions for the stock market simulation system.
 * Types cover orders, trades, market data, order book structure, and simulation state.
 */

/**
 * Represents the current market regime/phase
 * - bull: Upward trending market with positive drift
 * - bear: Downward trending market with negative drift
 * - sideways: Choppy/range-bound market with minimal drift
 */
export type MarketRegime = 'bull' | 'bear' | 'sideways';

/**
 * Order side - buy or sell
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Represents a limit order in the order book
 * Orders are matched when buy price >= sell price
 */
export interface Order {
  id: string;
  side: OrderSide;
  price: number;
  size: number;
  timestamp: number;
}

/**
 * Represents an executed trade (when orders match)
 * Used for trade history and generating OHLCV bars
 */
export interface Trade {
  id: string;
  price: number;
  size: number;
  timestamp: number;
  side: OrderSide; // Whether the aggressor was a buyer or seller
}

/**
 * OHLCV (Open, High, Low, Close, Volume) candlestick bar
 * Represents price action over a time period (0.25 seconds in our simulation)
 */
export interface Bar {
  time: number; // Unix timestamp in seconds (can be fractional for sub-second precision)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Represents a single price level in the order book
 * Contains aggregated order information at a specific price
 */
export interface OrderBookLevel {
  price: number;
  size: number; // Total size at this price level
  total: number; // Cumulative size from best price to this level
}

/**
 * Complete order book state with bids and asks
 * Bids are sorted descending (highest first)
 * Asks are sorted ascending (lowest first)
 */
export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number; // Difference between best ask and best bid
  midPrice: number; // Average of best bid and best ask
}

/**
 * Current market statistics
 * Provides summary information about the market state
 */
export interface MarketStats {
  lastPrice: number;
  change24h: number; // Percentage change over last 24 hours (or session)
  volume24h: number; // Total volume traded
  high24h: number;
  low24h: number;
  lastTradeDirection: 'up' | 'down' | 'neutral';
}

/**
 * Simulation control state
 * Manages the running state and speed of the simulation
 */
export interface SimulationState {
  isRunning: boolean;
  speed: number; // Multiplier: 1.0 = real-time, 2.0 = 2x speed, etc.
  regime: MarketRegime;
  currentBar: Bar | null;
  bars: Bar[];
  trades: Trade[];
  orderBook: OrderBookSnapshot;
  stats: MarketStats;
}

/**
 * Event types that can be injected into the simulation
 * These create sudden market movements or changes
 */
export type MarketEvent =
  | { type: 'news_shock'; magnitude: number } // magnitude: -1.0 to 1.0 (percentage impact)
  | { type: 'volatility_spike'; duration: number } // duration in bars
  | { type: 'regime_change'; newRegime: MarketRegime };

/**
 * Parameters for regime-based price generation
 * Each regime has different drift and volatility characteristics
 */
export interface RegimeParams {
  drift: number; // Expected daily return (as decimal, e.g., 0.001 = 0.1%)
  volatility: number; // Daily volatility (standard deviation of returns)
  orderFlow: number; // Intensity of order generation (orders per second)
}
