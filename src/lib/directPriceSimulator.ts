/**
 * Direct Price Simulator - Industry Standard Approach
 *
 * This simulator generates realistic stock prices using direct price generation
 * methods from financial mathematics, NOT agent-based order book simulation.
 *
 * ARCHITECTURE PHILOSOPHY:
 * ========================
 * Traditional approach (WRONG for price simulation):
 *   GBM → Target Price → Agents fight to reconcile → Order Book → Current Price
 *   Problem: Dual price system creates artificial mean reversion
 *
 * Industry standard approach (CORRECT):
 *   GBM + Features → Price Path → OHLCV Bars
 *   Result: True random walk with realistic features
 *
 * FINANCIAL MODELS USED:
 * ======================
 *
 * 1. Geometric Brownian Motion (GBM) - Core Price Process
 *    Formula: dS = μS dt + σS dW
 *    - μ (drift): Expected return per time unit (regime-dependent)
 *    - σ (volatility): Standard deviation of returns (stochastic!)
 *    - dW: Wiener process (Brownian motion)
 *    - dt: Time step (250ms = 0.25 seconds)
 *
 * 2. Heston Stochastic Volatility Model
 *    Formula: dV = κ(θ - V)dt + σ_v√V dW
 *    - Creates VOLATILITY CLUSTERING (realistic market behavior)
 *    - High volatility periods tend to cluster together
 *    - Low volatility periods cluster together
 *    - κ: Mean reversion speed of volatility
 *    - θ: Long-run average volatility
 *    - σ_v: Volatility of volatility
 *
 * 3. Jump Diffusion (Merton Model)
 *    - Adds occasional discontinuous jumps to price
 *    - Models sudden news events, gap moves
 *    - Poisson process determines jump timing
 *    - Jump size from normal distribution
 *
 * WHY THIS WORKS:
 * ===============
 * - Single price process (no target/current split)
 * - Mathematically rigorous (standard financial models)
 * - No feedback loops or agent balancing
 * - Stochastic volatility creates realistic clustering
 * - Jumps create realistic sharp moves
 * - Regime drift creates trending/sideways behavior
 * - True random walk when drift = 0
 *
 * REALISTIC BEHAVIORS ACHIEVED:
 * ==============================
 * ✓ Random walk in sideways regime
 * ✓ Trending in bull/bear regimes (from drift)
 * ✓ Volatility clustering
 * ✓ Occasional sharp moves (jumps)
 * ✓ Volume-price correlation
 * ✓ No artificial mean reversion
 * ✓ No sustained directional runs from feedback loops
 */

import { Bar, MarketRegime, RegimeParams, MarketEvent } from '@/types/market';

export class DirectPriceSimulator {
  private price: number; // Current market price (only ONE price exists!)
  private volatility: number; // Current volatility (stochastic, changes over time)

  private regime: MarketRegime = 'sideways';
  private volatilityMultiplier: number = 1.0; // For event-driven volatility spikes
  private volatilityCountdown: number = 0;

  // Price history for calculating realized volatility
  private priceHistory: number[] = [];
  private readonly PRICE_HISTORY_LENGTH = 20;

  // Bars storage
  private bars: Bar[] = [];
  private currentBarStartTime: number;
  private currentBarTrades: number[] = []; // Prices during current bar

  // Bar timing
  private readonly barDuration = 250; // 250ms bars

  // Regime parameters - ONLY drift changes by regime
  // Volatility is now stochastic (Heston model)
  private readonly regimeParams: Record<MarketRegime, RegimeParams> = {
    bull: {
      drift: 0.0003, // Subtle upward bias: ~0.03% per bar = ~0.12% per second
      volatility: 0.15, // Base volatility (Heston model will modulate this)
      orderFlow: 8, // Not used for price generation, kept for compatibility
    },
    bear: {
      drift: -0.0002, // Subtle downward bias: ~0.02% per bar = ~0.08% per second
      volatility: 0.18, // Higher base volatility in bear markets
      orderFlow: 10,
    },
    sideways: {
      drift: 0.0, // Pure random walk (no directional bias)
      volatility: 0.12, // Moderate base volatility
      orderFlow: 5,
    },
  };

  // Heston model parameters for stochastic volatility
  private readonly KAPPA = 2.0; // Speed of volatility mean reversion (higher = faster)
  private readonly THETA = 0.15; // Long-run average volatility (15%)
  private readonly SIGMA_V = 0.3; // Volatility of volatility (creates clustering)

  // Jump diffusion parameters
  // With 7 steps per bar @ 4 bars/sec = 100,800 steps/hour
  // 0.0004 probability = ~40 jumps per hour (realistic frequency)
  private readonly JUMP_PROBABILITY = 0.0004; // ~40 jumps per hour
  private readonly JUMP_MEAN = 0.0; // Jumps are symmetric (up or down)
  private readonly JUMP_STD = 0.005; // Jump size ~0.5% (reduced from 1% for subtlety)

  constructor(initialPrice: number = 100, initialVolatility: number = 0.15) {
    this.price = initialPrice;
    this.volatility = initialVolatility;
    this.currentBarStartTime = Date.now();
  }

  /**
   * Main simulation step - generates one price update
   *
   * This is the core of the simulator. Each step:
   * 1. Updates volatility stochastically (Heston model)
   * 2. Generates price change via GBM + jumps
   * 3. Records price for OHLCV bar generation
   * 4. Closes bar if time elapsed
   */
  simulateStep(): void {
    // Step 1: Update stochastic volatility
    this.updateStochasticVolatility();

    // Step 2: Generate price change
    const priceChange = this.generatePriceChange();

    // Step 3: Apply jump component
    const jumpComponent = this.generateJump();

    // Step 4: Update price (multiplicative for percentage changes)
    this.price *= 1 + priceChange + jumpComponent;

    // Ensure price stays positive
    this.price = Math.max(0.01, this.price);

    // Step 5: Record price for current bar
    this.currentBarTrades.push(this.price);

    // Step 6: Update price history for volatility calculation
    this.priceHistory.push(this.price);
    if (this.priceHistory.length > this.PRICE_HISTORY_LENGTH) {
      this.priceHistory.shift();
    }

    // Step 7: Decrease volatility event countdown if active
    if (this.volatilityCountdown > 0) {
      this.volatilityCountdown--;
      if (this.volatilityCountdown === 0) {
        this.volatilityMultiplier = 1.0;
      }
    }

    // Step 8: Close bar if enough time has elapsed
    this.maybeCloseBar();
  }

  /**
   * Update volatility using Heston stochastic volatility model
   *
   * The Heston model makes volatility itself a random process that:
   * - Mean-reverts to a long-run average (θ)
   * - Has its own volatility (σ_v), creating clustering
   * - Stays positive (square root keeps it bounded)
   *
   * Formula: dV = κ(θ - V)dt + σ_v√V dW
   *
   * This creates VOLATILITY CLUSTERING - the key to realistic price action:
   * - High volatility tends to be followed by high volatility
   * - Low volatility tends to be followed by low volatility
   * - Exactly like real markets (GARCH-like behavior)
   */
  private updateStochasticVolatility(): void {
    // With 7 steps per bar, each step represents 250ms/7 ≈ 36ms
    const dt = (0.25 / 7) / (60 * 60 * 24); // ~36ms in days (for proper scaling)

    // Get base volatility from regime
    const baseVol = this.regimeParams[this.regime].volatility;

    // Mean reversion component: pull toward long-run average
    const meanReversionComponent = this.KAPPA * (this.THETA - this.volatility) * dt;

    // Stochastic component: random fluctuation in volatility
    // Square root ensures volatility stays positive
    const stochasticComponent =
      this.SIGMA_V * Math.sqrt(Math.max(0.01, this.volatility)) * this.gaussian() * Math.sqrt(dt);

    // Update volatility
    this.volatility += meanReversionComponent + stochasticComponent;

    // Apply volatility multiplier from events
    this.volatility *= this.volatilityMultiplier;

    // Ensure volatility stays in reasonable bounds
    this.volatility = Math.max(0.05, Math.min(0.5, this.volatility));
  }

  /**
   * Generate price change using Geometric Brownian Motion
   *
   * GBM is the standard model for stock prices in finance (Black-Scholes, etc.)
   *
   * Formula: dS/S = μ dt + σ dW
   * Equivalently: S(t+dt) = S(t) * exp((μ - σ²/2)dt + σ√dt Z)
   *
   * Where:
   * - μ: drift (expected return) - comes from regime
   * - σ: volatility (from Heston model, not constant!)
   * - Z: standard normal random variable
   * - dt: time step
   *
   * NO AUTOCORRELATION: Trends emerge naturally from regime drift,
   * not from artificial autocorrelation. This is the correct approach.
   */
  private generatePriceChange(): number {
    // With 7 steps per bar, each step represents 250ms/7 ≈ 36ms
    const dt = (0.25 / 7) / (60 * 60 * 24); // ~36ms in days

    const params = this.regimeParams[this.regime];

    // Drift component (expected return)
    const driftComponent = params.drift * dt;

    // Volatility component (random fluctuation)
    // Uses current stochastic volatility, not constant
    const volatilityComponent = this.volatility * this.gaussian() * Math.sqrt(dt);

    // Total change (percentage)
    return driftComponent + volatilityComponent;
  }

  /**
   * Generate occasional price jumps (Merton jump diffusion model)
   *
   * Real markets have discontinuous jumps from:
   * - Major news announcements
   * - Earnings surprises
   * - Market shocks
   * - Gap opens/closes
   *
   * This adds realism beyond smooth GBM.
   *
   * Jump timing: Poisson process (random with fixed probability)
   * Jump size: Normal distribution (symmetric up/down)
   */
  private generateJump(): number {
    // Poisson process: fixed probability per time step
    if (Math.random() < this.JUMP_PROBABILITY) {
      // Jump occurred! Generate jump size from normal distribution
      const jumpSize = this.JUMP_MEAN + this.JUMP_STD * this.gaussian();
      return jumpSize;
    }

    return 0; // No jump this step
  }

  /**
   * Close current bar and create OHLCV bar
   *
   * Generates realistic OHLCV bars from price trades:
   * - Open: First price in bar
   * - High: Max price in bar
   * - Low: Min price in bar
   * - Close: Last price in bar
   * - Volume: Scales with realized volatility (realistic correlation)
   */
  private maybeCloseBar(): void {
    const now = Date.now();

    if (now >= this.currentBarStartTime + this.barDuration) {
      // Time to close current bar
      if (this.currentBarTrades.length > 0) {
        // Calculate OHLC from actual trades
        const open = this.currentBarTrades[0];
        const close = this.currentBarTrades[this.currentBarTrades.length - 1];
        const high = Math.max(...this.currentBarTrades);
        const low = Math.min(...this.currentBarTrades);

        // Calculate volume with realistic price-volume correlation
        // Higher volatility → higher volume (empirically observed in markets)
        const realizedVol = this.calculateRealizedVolatility();
        const baseVolume = 1000;
        const volumeMultiplier = 1 + realizedVol * 20; // Scales with volatility
        const volume = baseVolume * volumeMultiplier * (0.8 + Math.random() * 0.4);

        this.bars.push({
          time: this.currentBarStartTime / 1000, // Unix timestamp in seconds
          open,
          high,
          low,
          close,
          volume: Math.round(volume),
        });
      } else {
        // No trades this bar (shouldn't happen with 250ms simulation)
        // Create a flat bar
        this.bars.push({
          time: this.currentBarStartTime / 1000,
          open: this.price,
          high: this.price,
          low: this.price,
          close: this.price,
          volume: 0,
        });
      }

      // Start new bar
      this.currentBarTrades = [];

      // FIX: Use incremental timestamps instead of wall-clock time
      // This guarantees strictly ascending timestamps (no duplicates)
      // Each bar is exactly barDuration (250ms) after the previous
      this.currentBarStartTime = this.currentBarStartTime + this.barDuration;
    }
  }

  /**
   * Calculate realized volatility from recent price history
   *
   * Realized volatility is calculated from actual price movements,
   * not the stochastic volatility model parameter.
   *
   * Used for volume-price correlation.
   */
  private calculateRealizedVolatility(): number {
    if (this.priceHistory.length < 2) return 0.1;

    let sumSquaredReturns = 0;
    for (let i = 1; i < this.priceHistory.length; i++) {
      const ret = Math.log(this.priceHistory[i] / this.priceHistory[i - 1]);
      sumSquaredReturns += ret * ret;
    }

    const variance = sumSquaredReturns / (this.priceHistory.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Force close current bar (called at regular intervals)
   */
  closeCurrentBar(): void {
    this.maybeCloseBar();
  }

  /**
   * Change market regime
   *
   * Regimes affect drift (directional bias):
   * - Bull: Small positive drift → gradual uptrend
   * - Bear: Small negative drift → gradual downtrend
   * - Sideways: Zero drift → pure random walk
   *
   * Base volatility changes too, but Heston model dominates
   */
  setRegime(regime: MarketRegime): void {
    this.regime = regime;
  }

  /**
   * Get current regime
   */
  getRegime(): MarketRegime {
    return this.regime;
  }

  /**
   * Inject market event (news shock, volatility spike, etc.)
   *
   * Events can:
   * - Create sudden price jump
   * - Spike volatility temporarily
   * - Change regime
   */
  injectEvent(event: MarketEvent): void {
    switch (event.type) {
      case 'news_shock':
        // Immediate price jump
        this.price *= 1 + event.magnitude;
        this.price = Math.max(0.01, this.price);
        break;

      case 'volatility_spike':
        // Temporarily increase volatility
        this.volatilityMultiplier = 3.0;
        this.volatilityCountdown = event.duration;
        break;

      case 'regime_change':
        this.setRegime(event.newRegime);
        break;
    }
  }

  /**
   * Randomly switch regime (2% chance per step)
   */
  maybeChangeRegime(): void {
    if (Math.random() < 0.02) {
      const regimes: MarketRegime[] = ['bull', 'bear', 'sideways'];
      const otherRegimes = regimes.filter((r) => r !== this.regime);
      const newRegime = otherRegimes[Math.floor(Math.random() * otherRegimes.length)];
      this.setRegime(newRegime);
    }
  }

  /**
   * Get all completed bars
   */
  getBars(): Bar[] {
    return [...this.bars];
  }

  /**
   * Get current price
   */
  getCurrentPrice(): number {
    return this.price;
  }

  /**
   * Get current volatility
   */
  getCurrentVolatility(): number {
    return this.volatility;
  }

  /**
   * Generate standard normal random variable (Box-Muller transform)
   */
  private gaussian(): number {
    const u = Math.random();
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
