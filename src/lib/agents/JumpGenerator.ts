/**
 * Jump Generator
 *
 * Creates occasional sudden price movements from news events or market shocks.
 * Unlike the DirectPriceSimulator's jump diffusion (which directly modifies price),
 * this creates jumps through ORDER FLOW by temporarily shocking trader beliefs.
 *
 * KEY CONCEPT:
 * ============
 * Jumps emerge from COORDINATED BELIEF SHOCKS, not direct price manipulation.
 *
 * When news hits:
 * - All informed traders' beliefs jump simultaneously
 * - They then trade aggressively based on new beliefs
 * - This creates a surge of one-sided order flow
 * - Price jumps naturally through order book matching
 *
 * This is how real markets work - news doesn't magically change price,
 * it changes traders' valuations, which then drives order flow.
 *
 * BEHAVIOR:
 * =========
 * - Poisson process determines jump timing (random with fixed probability)
 * - Jump magnitude from normal distribution (symmetric up/down)
 * - Temporary volatility spike after jumps (realistic aftermath)
 * - Affects informed trader beliefs, not price directly
 */

export interface JumpEvent {
  magnitude: number; // Percentage belief shift (e.g., 0.02 = 2% jump)
  volatilityMultiplier: number; // Temporary volatility spike (e.g., 2.0 = 2x)
  duration: number; // How many steps the volatility spike lasts
}

interface JumpGeneratorConfig {
  jumpProbability: number; // Probability per step (e.g., 0.0004 = ~40 jumps/hour)
  jumpMean: number; // Average jump size (typically 0 for symmetric)
  jumpStd: number; // Jump size standard deviation (e.g., 0.005 = 0.5%)
  volatilitySpike: number; // Volatility multiplier after jump (e.g., 2.0)
  spikeDuration: number; // Steps for volatility to decay (e.g., 10 steps)
}

export class JumpGenerator {
  private config: JumpGeneratorConfig;

  constructor(config: JumpGeneratorConfig) {
    this.config = config;
  }

  /**
   * Maybe generate a jump event
   *
   * Called each simulation step. Uses Poisson process to determine
   * if a news event occurs this step.
   *
   * If jump occurs:
   * - Magnitude sampled from normal distribution
   * - Positive = good news (beliefs jump up)
   * - Negative = bad news (beliefs jump down)
   * - Volatility spike follows (realistic aftermath)
   *
   * @returns JumpEvent if jump occurs, null otherwise
   */
  maybeGenerateJump(): JumpEvent | null {
    // Poisson process: fixed probability per time step
    if (Math.random() < this.config.jumpProbability) {
      // Jump occurred! Generate magnitude from normal distribution
      const magnitude = this.config.jumpMean + this.config.jumpStd * this.gaussian();

      return {
        magnitude,
        volatilityMultiplier: this.config.volatilitySpike,
        duration: this.config.spikeDuration,
      };
    }

    return null; // No jump this step
  }

  /**
   * Apply jump to a belief value
   *
   * When a jump event occurs, all informed traders' beliefs are shocked
   * by the same magnitude. This creates coordinated order flow.
   *
   * @param currentBelief - Trader's current belief
   * @param magnitude - Jump magnitude (percentage)
   * @returns New belief after jump
   */
  applyJumpToBelief(currentBelief: number, magnitude: number): number {
    // Multiplicative jump (percentage change)
    const newBelief = currentBelief * (1 + magnitude);

    // Ensure belief stays positive
    return Math.max(0.01, newBelief);
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
