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

/**
 * User Trading System Types
 * Types for user portfolio management, order placement, and position tracking
 */

/**
 * Type of user order
 * - market: Execute immediately at current market price
 * - limit: Execute only at specified price or better
 * - stop: Convert to market order when stop price is reached
 */
export type OrderType = 'market' | 'limit' | 'stop';

/**
 * Status of a user order
 * - pending: Order placed but not yet filled
 * - filled: Order completely executed
 * - partial: Order partially executed
 * - cancelled: Order cancelled by user
 */
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled';

/**
 * Represents a user's order (market, limit, or stop)
 * Tracks order details, execution status, and fill information
 */
export interface UserOrder {
  id: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number; // Required for limit orders
  stopPrice?: number; // Required for stop orders
  status: OrderStatus;
  filledSize: number; // How much of the order has been filled
  avgFillPrice: number; // Average price at which order was filled
  timestamp: number; // When order was placed
  filledTimestamp?: number; // When order was fully filled
  closePosition?: boolean; // If true, this order should close an entire position (for TP/SL)
  linkedPositionId?: string; // The position this order is linked to (for TP/SL)
}

/**
 * Represents an open trading position
 * Tracks entry price, current value, and profit/loss
 */
export interface Position {
  id: string;
  symbol: string;
  side: OrderSide; // 'buy' = long position, 'sell' = short position
  size: number; // Number of shares
  entryPrice: number; // Average entry price
  currentPrice: number; // Current market price
  unrealizedPnL: number; // Current profit/loss (not yet closed)
  openTimestamp: number; // When position was opened
  tpPrice?: number; // Take profit price level (if set)
  slPrice?: number; // Stop loss price level (if set)
}

/**
 * User's trading portfolio
 * Tracks cash balance, open positions, active orders, and total equity
 */
export interface Portfolio {
  cash: number; // Available cash for trading
  positions: Position[]; // Currently open positions
  activeOrders: UserOrder[]; // Pending orders (limit/stop not yet filled)
  totalEquity: number; // Cash + value of all positions
  realizedPnL: number; // Total profit/loss from closed positions
  unrealizedPnL: number; // Total profit/loss from open positions
  tradeHistory: CompletedTrade[]; // History of all executed trades
}

/**
 * Record of a completed trade (order fill)
 * Used for trade history and P&L tracking
 */
export interface CompletedTrade {
  id: string;
  orderId: string;
  side: OrderSide;
  size: number;
  price: number;
  timestamp: number;
  pnl?: number; // Profit/loss if closing a position
}

/**
 * Chart Drawing Tools Types
 * Types for user-drawn annotations and technical analysis tools
 */

/**
 * Type of drawing tool
 * - trendline: Straight line between two points
 * - horizontal: Horizontal line at a specific price level
 * - rectangle: Rectangle bounded by two points
 * - freehand: Free-form drawing path
 */
export type DrawingToolType = 'trendline' | 'horizontal' | 'rectangle' | 'freehand';

/**
 * Point on the chart (time and price coordinates)
 */
export interface DrawingPoint {
  time: number; // Unix timestamp
  price: number; // Price level
}

/**
 * Style properties for drawings
 */
export interface DrawingStyle {
  color: string; // Hex color code
  width: number; // Line width in pixels
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

/**
 * Represents a drawing on the chart
 * Stores coordinates, type, and visual styling
 */
export interface Drawing {
  id: string;
  type: DrawingToolType;
  points: DrawingPoint[]; // Array of points defining the drawing
  style: DrawingStyle;
  createdAt: number; // Timestamp when drawing was created
}
