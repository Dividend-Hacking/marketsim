/**
 * Noise Trader Agent
 *
 * Represents uninformed traders who trade randomly without information.
 * These traders create volume, depth, and noise in the market but don't
 * contribute to price discovery (zero-intelligence traders).
 *
 * ROLE IN SIMULATION:
 * ===================
 * - Creates trading volume (realistic activity)
 * - Adds depth to order book (random limit orders)
 * - Provides counterparties for informed traders
 * - No directional bias (50/50 buy/sell)
 *
 * BEHAVIOR:
 * =========
 * - Trades randomly with fixed probability
 * - Mix of market orders (immediate execution) and limit orders (passive)
 * - Random sizes within configured range
 * - Random prices near current market (for limit orders)
 *
 * This creates realistic "background noise" in the market without
 * affecting the overall price discovery process.
 */

import { Order } from '@/types/market';

interface NoiseTraderConfig {
  tradeProbability: number; // Probability of trading each step (e.g., 0.1 = 10%)
  marketOrderRatio: number; // Ratio of market vs limit orders (e.g., 0.3 = 30% market)
  minSize: number; // Minimum order size
  maxSize: number; // Maximum order size
  priceRange: number; // How far from mid price to place limits (e.g., 0.005 = 0.5%)
}

export class NoiseTrader {
  private config: NoiseTraderConfig;
  private orderIdCounter: number = 0;

  constructor(config: NoiseTraderConfig) {
    this.config = config;
  }

  /**
   * Maybe generate a random order
   *
   * Called each simulation step. Returns an order with tradeProbability,
   * null otherwise.
   *
   * Order characteristics:
   * - Side: Random (50/50 buy/sell)
   * - Type: Market (immediate) or limit (passive) based on marketOrderRatio
   * - Size: Random within min/max range
   * - Price: For limits, random within priceRange of current price
   *
   * @param currentPrice - Current mid price from order book
   * @returns Order if trader decides to trade, null otherwise
   */
  maybeGenerateOrder(currentPrice: number): Order | null {
    // Randomly decide whether to trade this step
    if (Math.random() > this.config.tradeProbability) {
      return null; // No trade this step
    }

    // Random side (50/50 buy/sell - no directional bias)
    const side = Math.random() < 0.5 ? 'buy' : 'sell';

    // Random size within configured range
    const size = Math.round(
      this.config.minSize + Math.random() * (this.config.maxSize - this.config.minSize)
    );

    // Determine if market order or limit order
    const isMarketOrder = Math.random() < this.config.marketOrderRatio;

    let price: number;

    if (isMarketOrder) {
      // Market order: price crosses spread to ensure immediate execution
      // Buy orders slightly above mid, sell orders slightly below mid
      price = side === 'buy'
        ? currentPrice * 1.01  // Buy 1% above mid (aggressive)
        : currentPrice * 0.99; // Sell 1% below mid (aggressive)
    } else {
      // Limit order: price within range of mid (may or may not execute)
      const offset = this.config.priceRange * this.randomBetween(0.1, 1.0);

      if (side === 'buy') {
        // Buy limit below mid (passive - waits for price to come down)
        price = currentPrice * (1 - offset);
      } else {
        // Sell limit above mid (passive - waits for price to come up)
        price = currentPrice * (1 + offset);
      }
    }

    return {
      id: `noise_${this.orderIdCounter++}`,
      side,
      price: this.roundPrice(price),
      size,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate random number between min and max
   */
  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  /**
   * Round price to 2 decimal places
   */
  private roundPrice(price: number): number {
    return Math.round(price * 100) / 100;
  }
}
