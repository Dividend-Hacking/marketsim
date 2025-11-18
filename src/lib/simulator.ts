/**
 * Market Simulator
 *
 * Generates synthetic market activity by creating buy/sell orders that feed into
 * the order book. Combines Geometric Brownian Motion (GBM) for trend/drift with
 * rule-based logic for realistic market patterns.
 *
 * Features:
 * - Regime switching (bull/bear/sideways)
 * - Multiple simulated trader types
 * - News shocks and volatility events
 * - Market maker behavior (provides liquidity)
 * - Momentum and mean-reversion traders
 */

import { Order, MarketRegime, RegimeParams, MarketEvent } from '@/types/market';
import { OrderBook } from './orderbook';

export class MarketSimulator {
  private orderBook: OrderBook;
  private regime: MarketRegime = 'sideways';
  private targetPrice: number; // Price the market is gravitating toward
  private volatilityMultiplier: number = 1.0; // Temporary volatility boost
  private volatilityCountdown: number = 0; // Bars remaining for volatility spike

  // Regime parameters define behavior for each market phase
  private readonly regimeParams: Record<MarketRegime, RegimeParams> = {
    bull: {
      drift: 0.002, // ~0.2% per bar upward drift
      volatility: 0.015,
      orderFlow: 8, // More orders in trending markets
    },
    bear: {
      drift: -0.0015, // ~0.15% per bar downward drift
      volatility: 0.025, // Higher volatility in bear markets
      orderFlow: 10, // Panic creates more activity
    },
    sideways: {
      drift: 0.0,
      volatility: 0.01,
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

    // Generate orders from different trader types
    this.generateMarketMakerOrders(currentPrice, params);
    this.generateMomentumOrders(currentPrice, params);
    this.generateMeanReversionOrders(currentPrice, params);
    this.generateNoiseOrders(currentPrice, params);

    // Close the current bar to ensure consistent 1-second intervals
    this.orderBook.closeCurrentBar();
  }

  /**
   * Update target price using Geometric Brownian Motion
   * Target price guides where traders place orders
   */
  private updateTargetPrice(params: RegimeParams): void {
    // Apply drift component (trend)
    const drift = params.drift;

    // Apply volatility component (random fluctuation)
    const volatility = params.volatility * this.volatilityMultiplier;
    const shock = volatility * this.gaussian();

    // Update target price
    const change = drift + shock;
    this.targetPrice *= 1 + change;

    // Ensure price stays positive
    this.targetPrice = Math.max(1, this.targetPrice);
  }

  /**
   * Market makers provide liquidity by posting orders on both sides
   * They profit from the bid-ask spread and keep the market efficient
   */
  private generateMarketMakerOrders(currentPrice: number, params: RegimeParams): void {
    const spread = currentPrice * 0.001; // 0.1% spread
    const orderSize = this.randomBetween(50, 200);

    // Post buy orders below current price
    const numBids = Math.floor(this.randomBetween(2, 5));
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

    // Post sell orders above current price
    const numAsks = Math.floor(this.randomBetween(2, 5));
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
   * Momentum traders follow the trend
   * Buy when price is rising, sell when falling
   */
  private generateMomentumOrders(currentPrice: number, params: RegimeParams): void {
    // Skip some steps randomly (not every trader acts every second)
    if (Math.random() > 0.4) return;

    const priceDiff = currentPrice - this.targetPrice;
    const trend = priceDiff / currentPrice;

    // Strong momentum above 0.5% difference
    if (Math.abs(trend) < 0.005) return;

    const side = trend > 0 ? 'buy' : 'sell';
    const aggressiveness = Math.abs(trend) * 100; // How far inside the spread to bid

    // Place aggressive orders that cross the spread
    const numOrders = Math.floor(this.randomBetween(1, 3));
    for (let i = 0; i < numOrders; i++) {
      const size = this.randomBetween(100, 500);
      let price: number;

      if (side === 'buy') {
        // Buy aggressively (hit asks)
        price = this.roundPrice(currentPrice * (1 + 0.001 * aggressiveness));
      } else {
        // Sell aggressively (hit bids)
        price = this.roundPrice(currentPrice * (1 - 0.001 * aggressiveness));
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
   */
  private generateMeanReversionOrders(currentPrice: number, params: RegimeParams): void {
    // Skip some steps randomly
    if (Math.random() > 0.3) return;

    const priceDiff = this.targetPrice - currentPrice;
    const deviation = Math.abs(priceDiff / currentPrice);

    // Only trade if price has deviated significantly (>0.3%)
    if (deviation < 0.003) return;

    const side = priceDiff > 0 ? 'buy' : 'sell';
    const size = this.randomBetween(100, 400) * (1 + deviation * 10); // Larger size on bigger deviation

    // Place limit orders near current price
    let price: number;
    if (side === 'buy') {
      price = this.roundPrice(currentPrice * 0.999); // Buy slightly below
    } else {
      price = this.roundPrice(currentPrice * 1.001); // Sell slightly above
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
   * Place random orders at various price levels
   */
  private generateNoiseOrders(currentPrice: number, params: RegimeParams): void {
    const numOrders = Math.floor(params.orderFlow * this.randomBetween(0.5, 1.5));

    for (let i = 0; i < numOrders; i++) {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const priceOffset = this.randomBetween(-0.01, 0.01); // ±1%
      const price = this.roundPrice(currentPrice * (1 + priceOffset));
      const size = this.randomBetween(50, 300);

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
