/**
 * Market Maker Agent
 *
 * Provides liquidity by continuously posting limit orders on both sides
 * of the market. Market makers profit from the bid-ask spread while
 * providing a service to other traders (liquidity).
 *
 * ROLE IN SIMULATION:
 * ===================
 * - Creates bid-ask spread (realistic microstructure)
 * - Provides passive liquidity for other traders to hit
 * - Stabilizes price (prevents excessive volatility from thin markets)
 * - NO directional bias (symmetric on both sides)
 *
 * BEHAVIOR:
 * =========
 * - Posts multiple levels (3-4 deep)
 * - Spread scales with volatility (wider in volatile periods)
 * - Size increases deeper in book (resting orders accumulate)
 * - Cancels and reposts as price moves (stays near market)
 *
 * This is a SIMPLIFIED market maker - real ones are more sophisticated:
 * - Adjust spread based on inventory
 * - Skew quotes based on expected price movement
 * - Cancel quickly when informed traders arrive
 *
 * But for simulation purposes, this symmetric approach works well.
 */

import { Order } from '@/types/market';

interface MarketMakerConfig {
  spread: number; // Half-spread as % of price (e.g., 0.002 = 0.2%)
  levels: number; // Number of price levels to quote (e.g., 4)
  baseSize: number; // Base order size (increases with depth)
}

export class MarketMaker {
  private config: MarketMakerConfig;
  private orderIdCounter: number = 0;

  constructor(config: MarketMakerConfig) {
    this.config = config;
  }

  /**
   * Generate orders on both sides of the market
   *
   * Creates a ladder of limit orders:
   * - Bid side: Below current price, size increases with depth
   * - Ask side: Above current price, size increases with depth
   *
   * @param currentPrice - Current mid price from order book
   * @param volatilityMultiplier - Widens spread in volatile periods
   * @returns Array of limit orders (both bids and asks)
   */
  generateOrders(currentPrice: number, volatilityMultiplier: number = 1.0): Order[] {
    const orders: Order[] = [];

    // Spread widens with volatility (more risk in volatile markets)
    const halfSpread = currentPrice * this.config.spread * volatilityMultiplier;

    // Generate bid levels (below current price)
    for (let i = 0; i < this.config.levels; i++) {
      // Price decreases as we go deeper (level 0 is best bid, level N is deepest)
      const offset = halfSpread * (i + 1) * this.randomBetween(0.9, 1.1);
      const price = this.roundPrice(currentPrice - offset);

      // Size increases with depth (deeper orders are larger)
      // Simulates resting orders accumulating away from market
      const sizeMultiplier = 1 + i * 0.3;
      const size = Math.round(this.config.baseSize * sizeMultiplier * this.randomBetween(0.8, 1.2));

      orders.push({
        id: `mm_${this.orderIdCounter++}`,
        side: 'buy',
        price,
        size,
        timestamp: Date.now(),
      });
    }

    // Generate ask levels (above current price)
    for (let i = 0; i < this.config.levels; i++) {
      // Price increases as we go deeper
      const offset = halfSpread * (i + 1) * this.randomBetween(0.9, 1.1);
      const price = this.roundPrice(currentPrice + offset);

      // Size increases with depth (symmetric with bid side)
      const sizeMultiplier = 1 + i * 0.3;
      const size = Math.round(this.config.baseSize * sizeMultiplier * this.randomBetween(0.8, 1.2));

      orders.push({
        id: `mm_${this.orderIdCounter++}`,
        side: 'sell',
        price,
        size,
        timestamp: Date.now(),
      });
    }

    return orders;
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
