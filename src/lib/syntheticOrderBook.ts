/**
 * Synthetic Order Book Generator
 *
 * Generates a realistic-looking order book for DISPLAY PURPOSES ONLY.
 * This order book is NOT used for price discovery - prices come from DirectPriceSimulator.
 *
 * PURPOSE:
 * ========
 * - Visualize bid/ask spread
 * - Show order book depth
 * - Educational/aesthetic purposes
 *
 * NOT FOR:
 * ========
 * - Price generation (DirectPriceSimulator handles that)
 * - Order matching (no real orders exist)
 * - Determining market price (price comes from GBM)
 *
 * IMPLEMENTATION:
 * ===============
 * Given a current price from DirectPriceSimulator, generates:
 * - Bid levels below current price
 * - Ask levels above current price
 * - Realistic size distribution (larger at better prices)
 * - Spread based on volatility (higher vol = wider spread)
 */

import { OrderBookSnapshot, OrderBookLevel, Trade } from '@/types/market';

export class SyntheticOrderBook {
  private lastPrice: number;
  private trades: Trade[] = [];

  constructor(initialPrice: number = 100) {
    this.lastPrice = initialPrice;
  }

  /**
   * Generate synthetic order book snapshot
   *
   * Creates realistic bid/ask levels around current price:
   * - Spread scales with volatility (more volatile = wider spread)
   * - Size distribution: larger orders closer to mid
   * - Depth: 10 levels on each side
   *
   * @param currentPrice - Current market price from DirectPriceSimulator
   * @param volatility - Current volatility from DirectPriceSimulator
   */
  getSnapshot(currentPrice: number, volatility: number): OrderBookSnapshot {
    this.lastPrice = currentPrice;

    // Calculate spread based on volatility
    // Low volatility: ~0.1% spread
    // High volatility: ~0.5% spread
    const baseSpread = 0.001; // 0.1%
    const spreadMultiplier = 1 + volatility * 2;
    const halfSpread = currentPrice * baseSpread * spreadMultiplier;

    // Best bid/ask (tightest spread)
    const bestBid = currentPrice - halfSpread;
    const bestAsk = currentPrice + halfSpread;

    // Generate bid levels (below current price)
    const bidLevels: OrderBookLevel[] = [];
    let bidTotal = 0;

    for (let i = 0; i < 10; i++) {
      // Price decreases as we go deeper
      const priceOffset = halfSpread * (i * 0.5 + 1);
      const price = this.roundPrice(currentPrice - priceOffset);

      // Size distribution: more size at better prices (closer to mid)
      // Then increases again deeper (resting orders accumulate)
      const baseSize = 100;
      const sizeVariation = 1 - i * 0.08 + (i > 5 ? (i - 5) * 0.1 : 0);
      const size = Math.round(baseSize * sizeVariation * (0.8 + Math.random() * 0.4));

      bidTotal += size;

      bidLevels.push({
        price,
        size,
        total: bidTotal,
      });
    }

    // Generate ask levels (above current price)
    const askLevels: OrderBookLevel[] = [];
    let askTotal = 0;

    for (let i = 0; i < 10; i++) {
      // Price increases as we go deeper
      const priceOffset = halfSpread * (i * 0.5 + 1);
      const price = this.roundPrice(currentPrice + priceOffset);

      // Same size distribution as bids
      const baseSize = 100;
      const sizeVariation = 1 - i * 0.08 + (i > 5 ? (i - 5) * 0.1 : 0);
      const size = Math.round(baseSize * sizeVariation * (0.8 + Math.random() * 0.4));

      askTotal += size;

      askLevels.push({
        price,
        size,
        total: askTotal,
      });
    }

    const spread = bestAsk - bestBid;

    return {
      bids: bidLevels,
      asks: askLevels,
      spread,
      midPrice: currentPrice,
    };
  }

  /**
   * Record a synthetic trade for display
   *
   * Creates a trade record at current price with synthetic volume.
   * Used for trade history visualization.
   */
  recordTrade(price: number, volume: number): void {
    // Determine trade side based on price movement
    const side = price >= this.lastPrice ? 'buy' : 'sell';

    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random()}`,
      price,
      size: volume,
      timestamp: Date.now(),
      side,
    };

    this.trades.push(trade);

    // Keep only last 100 trades
    if (this.trades.length > 100) {
      this.trades.shift();
    }

    this.lastPrice = price;
  }

  /**
   * Get recent trades
   */
  getTrades(limit: number = 50): Trade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get last price
   */
  getLastPrice(): number {
    return this.lastPrice;
  }

  /**
   * Round price to 2 decimal places
   */
  private roundPrice(price: number): number {
    return Math.round(price * 100) / 100;
  }
}
