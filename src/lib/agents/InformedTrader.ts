/**
 * Informed Trader Agent
 *
 * Represents a trader with a private valuation (belief) about the stock's fair value.
 * The belief evolves via Geometric Brownian Motion with regime-dependent drift.
 *
 * KEY CONCEPT:
 * ============
 * This is NOT a "target price" that the market is forced toward!
 *
 * Each informed trader has their OWN belief (correlated but not identical).
 * They trade BASED ON their belief vs current price, but the market price
 * is free to diverge. There's no rubber-banding or forced convergence.
 *
 * Multiple traders with similar (90% correlated) beliefs create a consensus
 * that emerges through order flow, not through artificial mean reversion.
 *
 * TRADING LOGIC:
 * ==============
 * - If belief > price: Think stock is undervalued → place buy order
 * - If belief < price: Think stock is overvalued → place sell order
 * - Order aggressiveness scales with conviction (|belief - price|)
 * - But orders are LIMITED in size and aggression (can't force price)
 *
 * This avoids the dual-price problem while creating realistic drift.
 */

import { Order, MarketRegime } from '@/types/market';

interface InformedTraderConfig {
  initialBelief: number;
  threshold: number; // Min deviation to trade (e.g., 0.002 = 0.2%)
  aggression: number; // How far through spread (e.g., 0.001 = 0.1%)
  baseSize: number; // Base order size
}

export class InformedTrader {
  private belief: number; // Private valuation (evolves via GBM)
  private config: InformedTraderConfig;

  // Regime-specific GBM parameters
  private readonly REGIME_PARAMS = {
    bull: {
      drift: 0.0005, // +0.05% per step (subtle upward bias)
      volatility: 0.12,
    },
    bear: {
      drift: -0.0004, // -0.04% per step (subtle downward bias)
      volatility: 0.15,
    },
    sideways: {
      drift: 0.0, // Pure random walk
      volatility: 0.10,
    },
  };

  constructor(config: InformedTraderConfig) {
    this.belief = config.initialBelief;
    this.config = config;
  }

  /**
   * Update belief using GBM with correlated shock
   *
   * @param regime - Current market regime (affects drift)
   * @param dt - Time step in days
   * @param sharedShock - Shared random shock for correlation across traders
   * @param idioWeight - Weight of idiosyncratic shock (0.1 = 10% independent)
   *
   * Formula: dB = μB dt + σB (√(1-w²) * shared + w * idio) √dt
   * This creates correlated beliefs while allowing some independence
   */
  updateBelief(
    regime: MarketRegime,
    dt: number,
    sharedShock: number,
    idioShock: number,
    idioWeight: number = 0.1
  ): void {
    const params = this.REGIME_PARAMS[regime];

    // Drift component (directional bias from regime)
    const driftComponent = params.drift * dt;

    // Volatility component (correlated random walk)
    // Mix shared shock (consensus) with idiosyncratic shock (private info)
    const sharedWeight = Math.sqrt(1 - idioWeight * idioWeight);
    const totalShock = sharedWeight * sharedShock + idioWeight * idioShock;
    const volatilityComponent = params.volatility * totalShock * Math.sqrt(dt);

    // Update belief (multiplicative for percentage changes)
    this.belief *= 1 + driftComponent + volatilityComponent;

    // Ensure belief stays positive
    this.belief = Math.max(0.01, this.belief);
  }

  /**
   * Generate order based on belief-price deviation
   *
   * Trading logic:
   * - Only trade if deviation exceeds threshold (filter noise)
   * - Order size scales with conviction
   * - Price is slightly aggressive to get filled (but not market order)
   * - Can't force price to belief - just expressing opinion through order
   *
   * @param currentPrice - Current market price from order book
   * @returns Order if trader wants to trade, null otherwise
   */
  generateOrder(currentPrice: number): Order | null {
    // Calculate deviation between belief and market price
    const deviation = (this.belief - currentPrice) / currentPrice;

    // Only trade if deviation exceeds threshold
    // This filters out noise and reduces excessive trading
    if (Math.abs(deviation) < this.config.threshold) {
      return null; // Price is close enough to belief - no trade
    }

    // Determine direction
    const side = deviation > 0 ? 'buy' : 'sell'; // Buy if undervalued, sell if overvalued

    // Size scales with conviction (larger deviation → larger order)
    // But capped to prevent individual trader from dominating
    const convictionMultiplier = 1 + Math.abs(deviation) * 10; // Max ~2x for 10% deviation
    const size = this.config.baseSize * Math.min(convictionMultiplier, 2.0);

    // Price: slightly aggressive to get filled, but not too aggressive
    // We cross the spread slightly, but don't sweep multiple levels
    const price =
      side === 'buy'
        ? currentPrice * (1 + this.config.aggression) // Buy slightly above mid
        : currentPrice * (1 - this.config.aggression); // Sell slightly below mid

    return {
      id: `informed_${Date.now()}_${Math.random()}`,
      side,
      price: this.roundPrice(price),
      size: Math.round(size),
      timestamp: Date.now(),
    };
  }

  /**
   * Get current belief (for debugging/monitoring)
   */
  getBelief(): number {
    return this.belief;
  }

  /**
   * Round price to 2 decimal places
   */
  private roundPrice(price: number): number {
    return Math.round(price * 100) / 100;
  }
}
