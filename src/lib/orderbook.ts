/**
 * Order Book Engine
 *
 * This class implements a limit order book with price-time priority matching.
 * It maintains bid and ask orders sorted by price, executes matches when prices
 * cross, and generates OHLCV bars from executed trades.
 *
 * Order Matching Rules:
 * - Buy orders matched when bid price >= ask price
 * - Orders matched at the resting order's price (limit order price)
 * - Price-time priority: better prices execute first, then earlier timestamps
 */

import { Order, Trade, Bar, OrderBookSnapshot, OrderBookLevel } from '@/types/market';

export class OrderBook {
  // Bids sorted by price descending (highest price first), then by time
  private bids: Map<number, Order[]> = new Map();

  // Asks sorted by price ascending (lowest price first), then by time
  private asks: Map<number, Order[]> = new Map();

  // All executed trades (used for generating bars and trade history)
  private trades: Trade[] = [];

  // Current bar being built from trades
  private currentBar: Bar | null = null;

  // All completed bars
  private bars: Bar[] = [];

  // Bar duration in milliseconds (0.25 seconds = 250ms)
  private readonly barDuration = 250;

  // Next bar start time
  private nextBarTime: number;

  // Last trade price (used for bar generation when no trades occur)
  private lastPrice: number;

  constructor(initialPrice: number = 100) {
    this.lastPrice = initialPrice;
    this.nextBarTime = Date.now() + this.barDuration;
  }

  /**
   * Add a new order to the book and attempt to match it
   * Returns array of trades generated from matching
   */
  addOrder(order: Order): Trade[] {
    const newTrades: Trade[] = [];

    // Try to match the order against opposite side
    if (order.side === 'buy') {
      newTrades.push(...this.matchBuyOrder(order));
    } else {
      newTrades.push(...this.matchSellOrder(order));
    }

    // If order has remaining size, add it to the book
    if (order.size > 0) {
      const priceLevel = order.side === 'buy' ? this.bids : this.asks;
      if (!priceLevel.has(order.price)) {
        priceLevel.set(order.price, []);
      }
      priceLevel.get(order.price)!.push(order);
    }

    // Record trades and update bars
    newTrades.forEach((trade) => {
      this.trades.push(trade);
      this.updateBar(trade);
    });

    return newTrades;
  }

  /**
   * Match a buy order against asks (sells)
   * Executes at the ask price (maker gets their price)
   */
  private matchBuyOrder(buyOrder: Order): Trade[] {
    const trades: Trade[] = [];
    const askPrices = Array.from(this.asks.keys()).sort((a, b) => a - b);

    for (const askPrice of askPrices) {
      // Stop if buy price is below ask price (no more matches possible)
      if (buyOrder.price < askPrice) break;

      const askOrders = this.asks.get(askPrice)!;

      while (askOrders.length > 0 && buyOrder.size > 0) {
        const askOrder = askOrders[0];
        const tradeSize = Math.min(buyOrder.size, askOrder.size);

        // Create trade at the ask price (resting order price)
        trades.push({
          id: `trade_${Date.now()}_${Math.random()}`,
          price: askPrice,
          size: tradeSize,
          timestamp: Date.now(),
          side: 'buy', // Aggressor side
        });

        // Reduce order sizes
        buyOrder.size -= tradeSize;
        askOrder.size -= tradeSize;

        // Remove fully filled ask order
        if (askOrder.size === 0) {
          askOrders.shift();
        }
      }

      // Clean up empty price level
      if (askOrders.length === 0) {
        this.asks.delete(askPrice);
      }

      // Stop if buy order is fully filled
      if (buyOrder.size === 0) break;
    }

    return trades;
  }

  /**
   * Match a sell order against bids (buys)
   * Executes at the bid price (maker gets their price)
   */
  private matchSellOrder(sellOrder: Order): Trade[] {
    const trades: Trade[] = [];
    const bidPrices = Array.from(this.bids.keys()).sort((a, b) => b - a);

    for (const bidPrice of bidPrices) {
      // Stop if sell price is above bid price (no more matches possible)
      if (sellOrder.price > bidPrice) break;

      const bidOrders = this.bids.get(bidPrice)!;

      while (bidOrders.length > 0 && sellOrder.size > 0) {
        const bidOrder = bidOrders[0];
        const tradeSize = Math.min(sellOrder.size, bidOrder.size);

        // Create trade at the bid price (resting order price)
        trades.push({
          id: `trade_${Date.now()}_${Math.random()}`,
          price: bidPrice,
          size: tradeSize,
          timestamp: Date.now(),
          side: 'sell', // Aggressor side
        });

        // Reduce order sizes
        sellOrder.size -= tradeSize;
        bidOrder.size -= tradeSize;

        // Remove fully filled bid order
        if (bidOrder.size === 0) {
          bidOrders.shift();
        }
      }

      // Clean up empty price level
      if (bidOrders.length === 0) {
        this.bids.delete(bidPrice);
      }

      // Stop if sell order is fully filled
      if (sellOrder.size === 0) break;
    }

    return trades;
  }

  /**
   * Update the current bar with a new trade
   * Creates new bars every second based on barDuration
   */
  private updateBar(trade: Trade): void {
    const now = Date.now();

    // Close current bar and start new one if time has elapsed
    if (now >= this.nextBarTime) {
      if (this.currentBar) {
        this.bars.push(this.currentBar);
      }

      // Create new bar
      this.currentBar = {
        time: now / 1000, // Unix timestamp in seconds (fractional for sub-second bars)
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: 0,
      };

      this.nextBarTime = now + this.barDuration;
    }

    // Update current bar with trade data
    if (this.currentBar) {
      this.currentBar.high = Math.max(this.currentBar.high, trade.price);
      this.currentBar.low = Math.min(this.currentBar.low, trade.price);
      this.currentBar.close = trade.price;
      this.currentBar.volume += trade.size;
    }

    this.lastPrice = trade.price;
  }

  /**
   * Force close the current bar (called at regular intervals)
   * If no trades occurred, creates a bar with lastPrice for all OHLC values
   */
  closeCurrentBar(): void {
    const now = Date.now();

    if (now >= this.nextBarTime) {
      if (this.currentBar) {
        this.bars.push(this.currentBar);
      } else {
        // No trades in this period, create a flat bar
        this.bars.push({
          time: now / 1000,
          open: this.lastPrice,
          high: this.lastPrice,
          low: this.lastPrice,
          close: this.lastPrice,
          volume: 0,
        });
      }

      this.currentBar = null;
      this.nextBarTime = now + this.barDuration;
    }
  }

  /**
   * Get a snapshot of the current order book state
   * Returns top N levels of bids and asks
   */
  getSnapshot(depth: number = 10): OrderBookSnapshot {
    // Get sorted bid prices (highest first)
    const bidPrices = Array.from(this.bids.keys()).sort((a, b) => b - a);
    const askPrices = Array.from(this.asks.keys()).sort((a, b) => a - b);

    // Build bid levels with cumulative totals
    const bidLevels: OrderBookLevel[] = [];
    let bidTotal = 0;
    for (const price of bidPrices.slice(0, depth)) {
      const orders = this.bids.get(price)!;
      const size = orders.reduce((sum, order) => sum + order.size, 0);
      bidTotal += size;
      bidLevels.push({ price, size, total: bidTotal });
    }

    // Build ask levels with cumulative totals
    const askLevels: OrderBookLevel[] = [];
    let askTotal = 0;
    for (const price of askPrices.slice(0, depth)) {
      const orders = this.asks.get(price)!;
      const size = orders.reduce((sum, order) => sum + order.size, 0);
      askTotal += size;
      askLevels.push({ price, size, total: askTotal });
    }

    // Calculate spread and mid price
    const bestBid = bidPrices[0] || 0;
    const bestAsk = askPrices[0] || 0;
    const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
    const midPrice = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : this.lastPrice;

    return {
      bids: bidLevels,
      asks: askLevels,
      spread,
      midPrice,
    };
  }

  /**
   * Get all completed bars
   */
  getBars(): Bar[] {
    return [...this.bars];
  }

  /**
   * Get recent trades
   */
  getTrades(limit: number = 50): Trade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get the last trade price
   */
  getLastPrice(): number {
    return this.lastPrice;
  }

  /**
   * Get the current incomplete bar
   */
  getCurrentBar(): Bar | null {
    return this.currentBar;
  }
}
