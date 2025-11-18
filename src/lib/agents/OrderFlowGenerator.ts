/**
 * Order Flow Generator
 *
 * Manages volatility clustering by dynamically adjusting order flow intensity.
 * Uses a stochastic process similar to Heston model to create realistic
 * periods of high and low market activity.
 *
 * KEY CONCEPT:
 * ============
 * Volatility clustering emerges from VARYING ORDER FLOW INTENSITY, not
 * from direct volatility manipulation.
 *
 * High activity periods:
 * - More agents active
 * - Larger order sizes
 * - More aggressive pricing
 * - Result: High realized volatility
 *
 * Low activity periods:
 * - Fewer agents active
 * - Smaller order sizes
 * - More passive pricing
 * - Result: Low realized volatility
 *
 * The activity level itself follows a mean-reverting stochastic process,
 * creating natural clustering (like GARCH behavior in real markets).
 *
 * STOCHASTIC ACTIVITY MODEL:
 * ===========================
 * Formula: dA = κ(θ - A)dt + σ_a√A dW
 *
 * Where:
 * - A: Current activity level (0.5 = normal, 1.5 = high, 0.2 = low)
 * - κ: Mean reversion speed (how quickly activity returns to normal)
 * - θ: Long-run average activity (typically 1.0 = normal)
 * - σ_a: Volatility of activity (creates clustering effect)
 * - dW: Brownian motion (random shock)
 *
 * This is analogous to Heston volatility, but for order flow activity.
 */

interface OrderFlowGeneratorConfig {
  kappa: number; // Mean reversion speed (e.g., 2.0)
  theta: number; // Long-run average activity (e.g., 1.0)
  sigmaA: number; // Volatility of activity (e.g., 0.4)
  minActivity: number; // Minimum activity level (e.g., 0.2)
  maxActivity: number; // Maximum activity level (e.g., 2.0)
}

export class OrderFlowGenerator {
  private activity: number; // Current activity level (1.0 = normal)
  private config: OrderFlowGeneratorConfig;

  constructor(config: OrderFlowGeneratorConfig, initialActivity: number = 1.0) {
    this.config = config;
    this.activity = initialActivity;
  }

  /**
   * Update activity level using mean-reverting stochastic process
   *
   * This creates volatility clustering:
   * - High activity tends to persist (clustering)
   * - Low activity tends to persist (clustering)
   * - Eventually reverts to normal (mean reversion)
   * - Random shocks can trigger regime shifts
   *
   * @param dt - Time step in days
   */
  updateActivity(dt: number): void {
    // Mean reversion component: pull toward long-run average
    const meanReversionComponent = this.config.kappa * (this.config.theta - this.activity) * dt;

    // Stochastic component: random fluctuation in activity
    // Square root ensures activity stays positive (Cox-Ingersoll-Ross process)
    const stochasticComponent =
      this.config.sigmaA * Math.sqrt(Math.max(0.01, this.activity)) * this.gaussian() * Math.sqrt(dt);

    // Update activity
    this.activity += meanReversionComponent + stochasticComponent;

    // Ensure activity stays within reasonable bounds
    this.activity = Math.max(
      this.config.minActivity,
      Math.min(this.config.maxActivity, this.activity)
    );
  }

  /**
   * Get current activity level
   *
   * Activity multiplier can be used to scale:
   * - Number of active traders
   * - Order sizes
   * - Trading aggressiveness
   * - Market maker spreads
   *
   * Examples:
   * - activity = 0.5: Low activity period (50% of normal)
   * - activity = 1.0: Normal activity
   * - activity = 1.5: High activity period (150% of normal)
   *
   * @returns Current activity level
   */
  getActivity(): number {
    return this.activity;
  }

  /**
   * Temporarily spike activity (e.g., after news event)
   *
   * Used by JumpGenerator to create realistic aftermath behavior:
   * - News hits → jump occurs
   * - Activity spikes → more trading, wider spreads
   * - Gradually decays back to normal
   *
   * @param multiplier - Activity multiplier (e.g., 2.0 = double activity)
   */
  spikeActivity(multiplier: number): void {
    this.activity *= multiplier;
    this.activity = Math.min(this.config.maxActivity, this.activity);
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
