/**
 * Market Maker Agent - ENHANCED with Inventory Management & Adverse Selection
 *
 * Provides liquidity by continuously posting limit orders on both sides
 * of the market. Market makers profit from the bid-ask spread while
 * providing a service to other traders (liquidity).
 *
 * REALISTIC ENHANCEMENTS:
 * =======================
 * ✅ Inventory Risk Management - Skews quotes based on position
 * ✅ Adverse Selection Detection - Widens spreads after being picked off
 * ✅ Dynamic Spread Adjustment - Adapts to market conditions
 * ✅ Position Limits - Max inventory prevents runaway positions
 * ✅ Fill Tracking - Monitors recent trading activity
 *
 * ROLE IN SIMULATION:
 * ===================
 * - Creates bid-ask spread (realistic microstructure)
 * - Provides passive liquidity for other traders to hit
 * - Stabilizes price (prevents excessive volatility from thin markets)
 * - REALISTIC directional bias based on inventory position
 *
 * BEHAVIOR:
 * =========
 * - Posts multiple levels (3-4 deep)
 * - Spread scales with volatility and adverse selection risk
 * - Size increases deeper in book (resting orders accumulate)
 * - Cancels and reposts as price moves (stays near market)
 * - Skews quotes to manage inventory (wider on heavy side)
 * - Widens spreads temporarily after adverse fills
 *
 * INVENTORY MANAGEMENT:
 * =====================
 * When long (positive inventory):
 * - Widen ask spreads (make selling more profitable)
 * - Tighten bid spreads (discourage more buying)
 * - Reduce bid sizes, increase ask sizes
 *
 * When short (negative inventory):
 * - Widen bid spreads (make buying more profitable)
 * - Tighten ask spreads (discourage more selling)
 * - Reduce ask sizes, increase bid sizes
 *
 * ADVERSE SELECTION:
 * ==================
 * When filled quickly by informed traders:
 * - Widen spreads temporarily (20-50% increase)
 * - Reduce posted sizes
 * - "Cool off" period lasts 5-10 steps
 */

import { Order } from '@/types/market';

interface MarketMakerConfig {
  spread: number; // Half-spread as % of price (e.g., 0.002 = 0.2%)
  levels: number; // Number of price levels to quote (e.g., 4)
  baseSize: number; // Base order size (increases with depth)
}

/**
 * Track fills to detect adverse selection
 */
interface FillRecord {
  timestamp: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  pnl: number; // Realized P&L if closed
}

export class MarketMaker {
  private config: MarketMakerConfig;
  private orderIdCounter: number = 0;

  // INVENTORY TRACKING - Critical for realistic behavior
  private inventory: number = 0; // Net position (positive = long, negative = short)
  private avgEntryPrice: number = 0; // Volume-weighted average entry price
  private readonly maxInventory: number = 5000; // Position limit (±5000 shares)

  // ADVERSE SELECTION TRACKING - Detect when being picked off
  private recentFills: FillRecord[] = []; // Last 20 fills
  private readonly maxFillHistory = 20;
  private adverseSelectionCooldown: number = 0; // Steps remaining in cooldown
  private readonly cooldownDuration = 8; // Steps to widen spreads after adverse fill

  // PERFORMANCE METRICS
  private totalPnL: number = 0;
  private fillCount: number = 0;

  constructor(config: MarketMakerConfig) {
    this.config = config;
  }

  /**
   * Generate orders on both sides of the market - ENHANCED with inventory skewing
   *
   * Creates a ladder of limit orders with realistic adjustments:
   * - Bid side: Below current price, skewed by inventory position
   * - Ask side: Above current price, skewed by inventory position
   *
   * Inventory skewing (0-30% spread adjustment):
   * - Long position → widen asks, tighten bids (want to sell)
   * - Short position → widen bids, tighten asks (want to buy)
   *
   * @param currentPrice - Current mid price from order book
   * @param volatilityMultiplier - Widens spread in volatile periods
   * @returns Array of limit orders (both bids and asks)
   */
  generateOrders(currentPrice: number, volatilityMultiplier: number = 1.0): Order[] {
    const orders: Order[] = [];

    // Base spread widens with volatility
    let halfSpread = currentPrice * this.config.spread * volatilityMultiplier;

    // ADVERSE SELECTION PROTECTION - Widen spreads after being picked off
    if (this.adverseSelectionCooldown > 0) {
      const cooldownMultiplier = 1 + (this.adverseSelectionCooldown / this.cooldownDuration) * 0.5;
      halfSpread *= cooldownMultiplier; // Up to 50% wider during cooldown
      this.adverseSelectionCooldown--;
    }

    // INVENTORY SKEW - Calculate position-based adjustments (0-30% of spread)
    const inventoryRatio = Math.max(-1, Math.min(1, this.inventory / this.maxInventory));
    const maxSkew = 0.30; // Maximum 30% skew
    const inventorySkew = inventoryRatio * maxSkew;

    // When long (positive inventory), we want to sell:
    // - Widen asks (bid_skew < 0, ask_skew > 0)
    // When short (negative inventory), we want to buy:
    // - Widen bids (bid_skew > 0, ask_skew < 0)
    const bidSkew = -inventorySkew; // Negative when long (tighter), positive when short (wider)
    const askSkew = inventorySkew; // Positive when long (wider), negative when short (tighter)

    // SIZE ADJUSTMENT - Reduce size on heavy side to limit further exposure
    const bidSizeMultiplier = inventoryRatio > 0 ? (1 - Math.abs(inventoryRatio) * 0.4) : 1.0;
    const askSizeMultiplier = inventoryRatio < 0 ? (1 - Math.abs(inventoryRatio) * 0.4) : 1.0;

    // POSITION LIMIT CHECK - Don't post orders if at max inventory
    const canBuy = this.inventory < this.maxInventory * 0.9; // Stop buying at 90% of limit
    const canSell = this.inventory > -this.maxInventory * 0.9; // Stop selling at 90% of limit

    // Generate bid levels (below current price) - if we can buy
    if (canBuy) {
      for (let i = 0; i < this.config.levels; i++) {
        // Apply inventory skew to spread offset
        const skewedSpread = halfSpread * (1 + bidSkew);
        const offset = skewedSpread * (i + 1) * this.randomBetween(0.9, 1.1);
        const price = this.roundPrice(currentPrice - offset);

        // Size increases with depth and adjusts for inventory
        const sizeMultiplier = (1 + i * 0.3) * bidSizeMultiplier;
        const size = Math.round(this.config.baseSize * sizeMultiplier * this.randomBetween(0.8, 1.2));

        orders.push({
          id: `mm_${this.orderIdCounter++}`,
          side: 'buy',
          price,
          size: Math.max(10, size), // Minimum 10 shares
          timestamp: Date.now(),
        });
      }
    }

    // Generate ask levels (above current price) - if we can sell
    if (canSell) {
      for (let i = 0; i < this.config.levels; i++) {
        // Apply inventory skew to spread offset
        const skewedSpread = halfSpread * (1 + askSkew);
        const offset = skewedSpread * (i + 1) * this.randomBetween(0.9, 1.1);
        const price = this.roundPrice(currentPrice + offset);

        // Size increases with depth and adjusts for inventory
        const sizeMultiplier = (1 + i * 0.3) * askSizeMultiplier;
        const size = Math.round(this.config.baseSize * sizeMultiplier * this.randomBetween(0.8, 1.2));

        orders.push({
          id: `mm_${this.orderIdCounter++}`,
          side: 'sell',
          price,
          size: Math.max(10, size), // Minimum 10 shares
          timestamp: Date.now(),
        });
      }
    }

    return orders;
  }

  /**
   * Record a fill - CRITICAL for inventory and adverse selection tracking
   *
   * Called by simulator when this MM's order is filled
   * Updates inventory, detects adverse selection, calculates P&L
   *
   * @param side - 'buy' or 'sell'
   * @param price - Execution price
   * @param size - Filled quantity
   */
  recordFill(side: 'buy' | 'sell', price: number, size: number): void {
    this.fillCount++;

    // UPDATE INVENTORY - Core of realistic MM behavior
    const oldInventory = this.inventory;
    if (side === 'buy') {
      // Bought shares - increase position
      const newInventory = this.inventory + size;
      this.avgEntryPrice = (this.avgEntryPrice * Math.abs(this.inventory) + price * size) / Math.abs(newInventory);
      this.inventory = newInventory;
    } else {
      // Sold shares - decrease position
      const newInventory = this.inventory - size;

      // Calculate realized P&L if reducing/closing position
      let realizedPnL = 0;
      if (Math.sign(oldInventory) === Math.sign(newInventory) || oldInventory === 0) {
        // Increasing short or opening new position - update avg entry
        this.avgEntryPrice = (this.avgEntryPrice * Math.abs(this.inventory) + price * size) / Math.abs(newInventory);
      } else {
        // Reducing or flipping position - realize P&L
        const closedSize = Math.min(Math.abs(oldInventory), size);
        if (oldInventory > 0) {
          // Closing long position
          realizedPnL = (price - this.avgEntryPrice) * closedSize;
        } else {
          // Closing short position
          realizedPnL = (this.avgEntryPrice - price) * closedSize;
        }
        this.totalPnL += realizedPnL;

        // If there's remaining size, it opens a new position
        if (size > Math.abs(oldInventory)) {
          const remainingSize = size - Math.abs(oldInventory);
          this.avgEntryPrice = price; // New position at this price
        }
      }

      this.inventory = newInventory;

      // Record fill for adverse selection detection
      const fill: FillRecord = {
        timestamp: Date.now(),
        side,
        price,
        size,
        pnl: realizedPnL,
      };

      this.recentFills.push(fill);
      if (this.recentFills.length > this.maxFillHistory) {
        this.recentFills.shift(); // Keep only recent fills
      }
    }

    // ADVERSE SELECTION DETECTION
    // If we're getting filled too quickly (>5 fills in last 3 steps), widen spreads
    const recentFillCount = this.recentFills.filter(f => Date.now() - f.timestamp < 750).length; // 3 steps @ 250ms
    if (recentFillCount >= 5) {
      // Being picked off by informed traders - enter cooldown
      this.adverseSelectionCooldown = Math.max(this.adverseSelectionCooldown, this.cooldownDuration);
    }
  }

  /**
   * Get current inventory position
   * Used by simulator to track MM behavior
   */
  getInventory(): number {
    return this.inventory;
  }

  /**
   * Get inventory ratio (-1 to 1)
   * Useful for visualization
   */
  getInventoryRatio(): number {
    return Math.max(-1, Math.min(1, this.inventory / this.maxInventory));
  }

  /**
   * Get total P&L
   */
  getTotalPnL(): number {
    return this.totalPnL;
  }

  /**
   * Get unrealized P&L based on current price
   */
  getUnrealizedPnL(currentPrice: number): number {
    if (this.inventory === 0) return 0;
    if (this.inventory > 0) {
      // Long position
      return (currentPrice - this.avgEntryPrice) * this.inventory;
    } else {
      // Short position
      return (this.avgEntryPrice - currentPrice) * Math.abs(this.inventory);
    }
  }

  /**
   * Check if in adverse selection cooldown
   */
  isInCooldown(): boolean {
    return this.adverseSelectionCooldown > 0;
  }

  /**
   * Get number of recent fills (for monitoring)
   */
  getRecentFillCount(): number {
    return this.recentFills.filter(f => Date.now() - f.timestamp < 1000).length;
  }

  /**
   * Generate random number between min and max
   */
  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  /**
   * Round price to 2 decimal places (tick size)
   */
  private roundPrice(price: number): number {
    return Math.round(price * 100) / 100;
  }

  /**
   * Reset inventory and metrics (for testing)
   */
  reset(): void {
    this.inventory = 0;
    this.avgEntryPrice = 0;
    this.recentFills = [];
    this.adverseSelectionCooldown = 0;
    this.totalPnL = 0;
    this.fillCount = 0;
  }
}
