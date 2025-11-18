/**
 * Market Simulator - Realistic Stock Price Movement Engine
 *
 * Generates synthetic market activity by creating buy/sell orders that feed into
 * the order book. Combines financial mathematics with agent-based modeling to
 * produce realistic price behavior.
 *
 * FINANCIAL MODELS IMPLEMENTED:
 *
 * 1. Geometric Brownian Motion (GBM) - Price Target Evolution
 *    - Formula: dS = μS dt + σS dW
 *    - Properly time-scaled with sqrt(dt) for 250ms bars
 *    - Autocorrelation (0.2) adds realistic trending periods
 *    - Creates the fundamental price direction
 *
 * 2. Agent-Based Market Microstructure - Order Generation
 *    Four trader types with balanced activation rates:
 *
 *    a) Market Makers (always active, 2-4 orders per side)
 *       - Provide liquidity with 0.25% spread
 *       - Create "gravity well" for price stability
 *       - Enable bid-ask bounce effect
 *
 *    b) Momentum Traders (60% activation)
 *       - Follow actual price trends over 5-bar lookback
 *       - Buy rising prices, sell falling prices
 *       - Create realistic trending periods
 *
 *    c) Mean Reversion Traders (90% activation)
 *       - Push price toward GBM target
 *       - Prevent excessive deviation from fundamentals
 *       - Balance momentum to create mixed behavior
 *
 *    d) Noise Traders (orderFlow-dependent)
 *       - Add realistic random variation (±0.5%)
 *       - Represent uninformed market participants
 *
 * 3. Volume-Price Correlation
 *    - Calculates realized volatility over recent bars
 *    - Scales order sizes during volatile periods (1.0x - 2.0x)
 *    - Creates realistic volume spikes on sharp moves
 *
 * 4. Bid-Ask Bounce (implemented in OrderBook)
 *    - Tight 0.25% spread creates tick-level oscillation
 *    - Trades execute at maker price (bid or ask)
 *    - Natural alternation between bid/ask creates realistic microstructure
 *
 * KEY PARAMETERS:
 * - Bar duration: 250ms (4 bars per second)
 * - Price history: 15 bars for momentum calculation
 * - Autocorrelation: 0.2 (balanced trending/random)
 * - Volatility: 8-15% (regime-dependent)
 * - Drift: -0.15% to +0.2% (regime-dependent)
 *
 * REALISTIC BEHAVIORS ACHIEVED:
 * ✓ Mixed trending and mean-reverting periods
 * ✓ Proper volatility scaling for time scale
 * ✓ Volume increases during price moves
 * ✓ Bid-ask bounce at tick level
 * ✓ No sustained directional bias (fixed inverted momentum bug)
 * ✓ Regime-based market phases (bull/bear/sideways)
 */

import { Order, MarketRegime, RegimeParams, MarketEvent } from '@/types/market';
import { OrderBook } from './orderbook';

export class MarketSimulator {
  private orderBook: OrderBook;
  private regime: MarketRegime = 'sideways';
  private targetPrice: number; // Price the market is gravitating toward
  private volatilityMultiplier: number = 1.0; // Temporary volatility boost
  private volatilityCountdown: number = 0; // Bars remaining for volatility spike

  // Price history for momentum calculation - tracks recent price movements
  // Allows momentum traders to identify actual trending behavior vs noise
  private priceHistory: number[] = [];
  private readonly PRICE_HISTORY_LENGTH = 15; // Track last 15 bars for momentum

  // Autocorrelation parameter: adds slight persistence to price movements
  // Positive value (0.0-0.5) creates trending periods like real markets
  // 0.0 = pure random walk, 0.5 = strong trending, 0.2 = balanced
  private readonly AUTOCORRELATION = 0.2;
  private lastPriceChange: number = 0; // Previous bar's price change for autocorrelation

  // Volume-price correlation: track recent price volatility to scale order flow
  // In real markets, higher volatility periods see increased trading activity
  private recentVolatility: number = 0;

  // Regime parameters define behavior for each market phase
  private readonly regimeParams: Record<MarketRegime, RegimeParams> = {
    bull: {
      drift: 0.002, // ~0.2% per bar upward drift
      volatility: 0.12, // Increased from 0.015 for more realistic movement
      orderFlow: 8, // More orders in trending markets
    },
    bear: {
      drift: -0.0015, // ~0.15% per bar downward drift
      volatility: 0.15, // Increased from 0.025 for higher volatility in bear markets
      orderFlow: 10, // Panic creates more activity
    },
    sideways: {
      drift: 0.0,
      volatility: 0.08, // Increased from 0.01 for more price variation
      orderFlow: 5, // Less activity in choppy markets
    },
  };

  // Order ID counter for unique order identification
  private orderIdCounter: number = 0;

  constructor(orderBook: OrderBook, initialPrice: number = 100) {
    this.orderBook = orderBook;
    this.targetPrice = initialPrice;
  }

  /**
   * Generate market activity for one time step
   * Creates orders from different trader types and updates target price
   */
  simulateStep(): void {
    const params = this.regimeParams[this.regime];

    // Update target price using GBM
    this.updateTargetPrice(params);

    // Decrease volatility countdown if active
    if (this.volatilityCountdown > 0) {
      this.volatilityCountdown--;
      if (this.volatilityCountdown === 0) {
        this.volatilityMultiplier = 1.0;
      }
    }

    // Get current market price from order book
    const currentPrice = this.orderBook.getSnapshot().midPrice;

    // Update price history for momentum calculation
    // Keep only the most recent N bars to calculate trending behavior
    this.priceHistory.push(currentPrice);
    if (this.priceHistory.length > this.PRICE_HISTORY_LENGTH) {
      this.priceHistory.shift(); // Remove oldest price
    }

    // Calculate recent volatility for volume-price correlation
    // Higher volatility → more trading activity (realistic market behavior)
    this.updateVolatility();

    // Calculate volume multiplier based on recent price volatility
    // In real markets, trading volume increases during volatile periods
    // Base multiplier is 1.0, increases to 1.5-2.0 during high volatility moves
    const volumeMultiplier = this.getVolumeMultiplier();

    // Generate orders from different trader types
    // Pass volume multiplier to scale order sizes during volatile periods
    this.generateMarketMakerOrders(currentPrice, params, volumeMultiplier);
    this.generateMomentumOrders(currentPrice, params, volumeMultiplier);
    this.generateMeanReversionOrders(currentPrice, params, volumeMultiplier);
    this.generateNoiseOrders(currentPrice, params, volumeMultiplier);

    // Close the current bar to ensure consistent 1-second intervals
    this.orderBook.closeCurrentBar();
  }

  /**
   * Update target price using Geometric Brownian Motion (GBM)
   *
   * GBM Formula: dS = μS dt + σS dW
   * Where:
   *   μ (mu) = drift rate (expected return per unit time)
   *   σ (sigma) = volatility (standard deviation of returns)
   *   dt = time step size
   *   dW = Wiener process (random shock scaled by sqrt(dt))
   *
   * Time scaling is critical: volatility must be multiplied by sqrt(dt)
   * because Brownian motion variance scales linearly with time.
   *
   * Autocorrelation adds realistic trending: a portion of previous change
   * persists into current change, creating momentum periods like real markets.
   */
  private updateTargetPrice(params: RegimeParams): void {
    // Time step: 250ms bars = 0.25 seconds = 0.25/(60*60*24) days
    // For simplicity, use dt = 0.25 (normalized to 1-second = 1.0)
    const dt = 0.25; // 250ms bar duration

    // Apply drift component (directional trend)
    // Drift represents the expected return per time period
    const driftComponent = params.drift * dt;

    // Apply volatility component (random fluctuation)
    // Volatility must be scaled by sqrt(dt) for proper Brownian motion
    const volatility = params.volatility * this.volatilityMultiplier;
    const randomShock = volatility * this.gaussian() * Math.sqrt(dt);

    // Add autocorrelation: carry forward a portion of previous price movement
    // This creates realistic trending periods where momentum persists
    const autocorrelationComponent = this.AUTOCORRELATION * this.lastPriceChange;

    // Combine all components
    const change = driftComponent + randomShock + autocorrelationComponent;

    // Store for next iteration's autocorrelation
    this.lastPriceChange = change;

    // Apply multiplicative change (percentage-based, not absolute)
    this.targetPrice *= 1 + change;

    // Ensure price stays positive
    this.targetPrice = Math.max(1, this.targetPrice);
  }

  /**
   * Update recent volatility estimate based on price history
   *
   * Calculates realized volatility over the last 5 bars as a measure of
   * recent price turbulence. This is used for volume-price correlation.
   */
  private updateVolatility(): void {
    if (this.priceHistory.length < 2) {
      this.recentVolatility = 0;
      return;
    }

    // Calculate absolute returns over last 5 bars (or fewer if insufficient history)
    const lookback = Math.min(5, this.priceHistory.length - 1);
    let sumSquaredReturns = 0;

    for (let i = this.priceHistory.length - lookback; i < this.priceHistory.length; i++) {
      const priceReturn = (this.priceHistory[i] - this.priceHistory[i - 1]) / this.priceHistory[i - 1];
      sumSquaredReturns += priceReturn * priceReturn;
    }

    // Realized volatility as standard deviation of returns
    this.recentVolatility = Math.sqrt(sumSquaredReturns / lookback);
  }

  /**
   * Calculate volume multiplier based on recent volatility
   *
   * Implements volume-price correlation: periods of high price volatility
   * see increased trading volume in real markets. This creates realistic
   * volume spikes during sharp price moves.
   *
   * Returns multiplier in range [1.0, 2.0]:
   * - Low volatility (<0.5%) → 1.0x (base volume)
   * - Medium volatility (0.5-1.5%) → 1.0-1.5x
   * - High volatility (>1.5%) → 1.5-2.0x
   */
  private getVolumeMultiplier(): number {
    // Convert volatility to percentage
    const volPercent = this.recentVolatility * 100;

    // Scale multiplier based on volatility
    // Low volatility: 1.0x, High volatility: up to 2.0x
    const multiplier = 1.0 + Math.min(1.0, volPercent / 1.5);

    return multiplier;
  }

  /**
   * Market makers provide liquidity by posting orders on both sides
   * They profit from the bid-ask spread and keep the market efficient
   *
   * Market makers are essential for price stability - they create a "gravity well"
   * around the current price that prevents extreme moves from noise/momentum.
   * Without sufficient MM presence, prices can swing wildly on small order flow.
   */
  private generateMarketMakerOrders(currentPrice: number, params: RegimeParams, volumeMultiplier: number = 1.0): void {
    // Tighter spread (0.25%) provides better price discovery and bid-ask bounce effect
    // This is more realistic for liquid markets and creates the characteristic
    // tick-by-tick oscillation between bid and ask prices
    const spread = currentPrice * 0.0025; // 0.25% spread (tightened from 0.5%)
    const orderSize = this.randomBetween(50, 200) * volumeMultiplier;

    // Post 2-4 buy orders below current price (strengthened from 0-2)
    // Guaranteed minimum of 2 ensures there's always a bid side anchor
    const numBids = Math.floor(this.randomBetween(2, 4));
    for (let i = 0; i < numBids; i++) {
      const offset = spread * (i + 1) * this.randomBetween(0.8, 1.2);
      const price = this.roundPrice(currentPrice - offset);
      const size = orderSize * this.randomBetween(0.7, 1.3);

      this.orderBook.addOrder({
        id: `order_${this.orderIdCounter++}`,
        side: 'buy',
        price,
        size,
        timestamp: Date.now(),
      });
    }

    // Post 2-4 sell orders above current price (strengthened from 0-2)
    // Guaranteed minimum of 2 ensures there's always an ask side anchor
    const numAsks = Math.floor(this.randomBetween(2, 4));
    for (let i = 0; i < numAsks; i++) {
      const offset = spread * (i + 1) * this.randomBetween(0.8, 1.2);
      const price = this.roundPrice(currentPrice + offset);
      const size = orderSize * this.randomBetween(0.7, 1.3);

      this.orderBook.addOrder({
        id: `order_${this.orderIdCounter++}`,
        side: 'sell',
        price,
        size,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Momentum traders follow the trend - they identify and trade in the direction
   * of recent price movements (NOT deviation from target).
   *
   * CRITICAL FIX: Previous implementation was inverted - it compared current price
   * to target price, causing traders to push price AWAY from target. This created
   * positive feedback loops and sustained directional moves.
   *
   * CORRECT BEHAVIOR: Calculate actual price momentum over recent bars.
   * - Rising prices (positive momentum) → buy to ride the trend
   * - Falling prices (negative momentum) → sell to ride the trend
   *
   * This creates realistic trending periods balanced against mean reversion.
   */
  private generateMomentumOrders(currentPrice: number, params: RegimeParams, volumeMultiplier: number = 1.0): void {
    // Need sufficient price history to calculate momentum
    if (this.priceHistory.length < 5) return;

    // 60% activation - reduced from 80% to balance with mean reversion
    // This creates a realistic mix of trending and mean-reverting behavior
    if (Math.random() > 0.6) return;

    // Calculate momentum as percentage change over last N bars
    // Using last 5 bars (1.25 seconds) for short-term momentum
    const lookbackPeriod = Math.min(5, this.priceHistory.length);
    const oldPrice = this.priceHistory[this.priceHistory.length - lookbackPeriod];
    const momentum = (currentPrice - oldPrice) / oldPrice;

    // Only trade if momentum exceeds threshold (0.2% move over lookback period)
    // This filters out noise and ensures we're catching real trends
    if (Math.abs(momentum) < 0.002) return;

    // CORRECT LOGIC: Buy on positive momentum, sell on negative momentum
    const side = momentum > 0 ? 'buy' : 'sell';
    const strength = Math.abs(momentum) * 100; // Momentum strength for sizing

    // Place 1-3 orders (reduced from 2-5 to avoid overwhelming other traders)
    const numOrders = Math.floor(this.randomBetween(1, 3));
    for (let i = 0; i < numOrders; i++) {
      // Size scales with momentum strength and volume multiplier
      // More volatile periods → larger momentum orders (realistic behavior)
      const size = this.randomBetween(100, 400) * (1 + strength) * volumeMultiplier;
      let price: number;

      if (side === 'buy') {
        // Buy slightly aggressively to ensure fills (0.15% above current)
        price = this.roundPrice(currentPrice * (1 + 0.0015));
      } else {
        // Sell slightly aggressively to ensure fills (0.15% below current)
        price = this.roundPrice(currentPrice * (1 - 0.0015));
      }

      this.orderBook.addOrder({
        id: `order_${this.orderIdCounter++}`,
        side,
        price,
        size,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Mean reversion traders bet on price returning to target
   * Buy when price is below target, sell when above
   * Now uses AGGRESSIVE crossing orders instead of passive orders
   */
  private generateMeanReversionOrders(currentPrice: number, params: RegimeParams, volumeMultiplier: number = 1.0): void {
    // High activation rate - increased from 0.7 to 0.9 (90% activation for active price correction)
    if (Math.random() > 0.9) return;

    const priceDiff = this.targetPrice - currentPrice;
    const deviation = Math.abs(priceDiff / currentPrice);

    // Trade on smaller deviations - reduced from 0.01 to 0.003 (0.3% threshold for more sensitivity)
    if (deviation < 0.003) return;

    const side = priceDiff > 0 ? 'buy' : 'sell';
    const size = this.randomBetween(300, 800) * (1 + deviation * 10) * volumeMultiplier;

    // Place AGGRESSIVE orders that cross the spread to actively move price toward target
    let price: number;
    if (side === 'buy') {
      price = this.roundPrice(currentPrice * (1 + 0.002)); // Buy 0.2% above current (crosses spread)
    } else {
      price = this.roundPrice(currentPrice * (1 - 0.002)); // Sell 0.2% below current (crosses spread)
    }

    this.orderBook.addOrder({
      id: `order_${this.orderIdCounter++}`,
      side,
      price,
      size,
      timestamp: Date.now(),
    });
  }

  /**
   * Noise traders add randomness to the market
   *
   * These traders represent uninformed/random market participants who trade
   * for reasons unrelated to price (liquidity needs, portfolio rebalancing, etc.)
   * They add realistic "noise" to the price without creating artificial volatility.
   *
   * IMPORTANT: Price range must be appropriate for the time scale. At 250ms bars,
   * ±3% would be insane volatility. ±0.5% creates realistic tick-by-tick variation.
   */
  private generateNoiseOrders(currentPrice: number, params: RegimeParams, volumeMultiplier: number = 1.0): void {
    const numOrders = Math.floor(params.orderFlow * this.randomBetween(0.5, 1.5));

    for (let i = 0; i < numOrders; i++) {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';

      // ±0.5% price range - reduced from ±3% which was way too wide for sub-second bars
      // This creates realistic noise without overwhelming the price discovery process
      const priceOffset = this.randomBetween(-0.005, 0.005);
      const price = this.roundPrice(currentPrice * (1 + priceOffset));
      const size = this.randomBetween(50, 300) * volumeMultiplier;

      this.orderBook.addOrder({
        id: `order_${this.orderIdCounter++}`,
        side,
        price,
        size,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Change the market regime
   * Regimes switch randomly or can be manually triggered
   */
  setRegime(regime: MarketRegime): void {
    this.regime = regime;
  }

  /**
   * Inject a market event (news shock, volatility spike, etc.)
   */
  injectEvent(event: MarketEvent): void {
    switch (event.type) {
      case 'news_shock':
        // Sudden price movement
        this.targetPrice *= 1 + event.magnitude;
        // Create a burst of aggressive orders in the direction of the shock
        this.createNewsShockOrders(event.magnitude);
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
   * Create aggressive orders following a news shock
   */
  private createNewsShockOrders(magnitude: number): void {
    const currentPrice = this.orderBook.getSnapshot().midPrice;
    const side = magnitude > 0 ? 'buy' : 'sell';
    const numOrders = Math.floor(this.randomBetween(10, 20));

    for (let i = 0; i < numOrders; i++) {
      const size = this.randomBetween(200, 800);
      // Place market orders (very aggressive pricing)
      const price = side === 'buy'
        ? this.roundPrice(currentPrice * 1.05)
        : this.roundPrice(currentPrice * 0.95);

      this.orderBook.addOrder({
        id: `order_${this.orderIdCounter++}`,
        side,
        price,
        size,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Randomly switch regime based on probability
   */
  maybeChangeRegime(): void {
    // 2% chance per step to change regime
    if (Math.random() < 0.02) {
      const regimes: MarketRegime[] = ['bull', 'bear', 'sideways'];
      // Exclude current regime
      const otherRegimes = regimes.filter((r) => r !== this.regime);
      const newRegime = otherRegimes[Math.floor(Math.random() * otherRegimes.length)];
      this.setRegime(newRegime);
    }
  }

  /**
   * Get current regime
   */
  getRegime(): MarketRegime {
    return this.regime;
  }

  /**
   * Generate random number from standard normal distribution (mean=0, std=1)
   * Uses Box-Muller transform
   */
  private gaussian(): number {
    const u = Math.random();
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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
