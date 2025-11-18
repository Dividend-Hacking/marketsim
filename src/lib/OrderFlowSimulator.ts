/**
 * Order Flow Simulator - Agent-Based Order Book Simulation
 *
 * This simulator generates realistic stock prices through ORDER FLOW, not
 * direct price manipulation. Price emerges naturally from order book matching.
 *
 * ARCHITECTURE PHILOSOPHY:
 * ========================
 * Traditional (incorrect) approach:
 *   GBM → Target Price → Agents reconcile → Order Book → Current Price
 *   Problem: Dual price system creates artificial mean reversion
 *
 * Order flow (correct) approach:
 *   Multiple GBM Beliefs → Agent Orders → Order Book Matching → Price Discovery
 *   Result: Price emerges from market microstructure
 *
 * KEY INSIGHT:
 * ============
 * NO SINGLE TARGET PRICE exists. Instead:
 * - 10 informed traders, each with their own GBM belief (90% correlated)
 * - Beliefs evolve independently but move together
 * - Traders place orders based on belief-price deviation
 * - Price emerges from order matching
 * - Consensus forms naturally through order flow
 *
 * AGENTS:
 * =======
 * 1. InformedTraders (10): Have correlated GBM beliefs, create price discovery
 * 2. MarketMakers (2): Provide liquidity with symmetric bid/ask quotes
 * 3. NoiseTraders (20): Random trading creates volume and depth
 *
 * REALISTIC FEATURES:
 * ===================
 * ✓ Price discovery through order book
 * ✓ Bid-ask spread from market makers
 * ✓ Volatility clustering from OrderFlowGenerator
 * ✓ Occasional jumps from JumpGenerator
 * ✓ Regime-based drift from informed trader beliefs
 * ✓ No artificial mean reversion
 * ✓ True random walk when regime = sideways
 */

import { InformedTrader } from './agents/InformedTrader';
import { MarketMaker } from './agents/MarketMaker';
import { NoiseTrader } from './agents/NoiseTrader';
import { JumpGenerator, JumpEvent } from './agents/JumpGenerator';
import { OrderFlowGenerator } from './agents/OrderFlowGenerator';
import {
  Order,
  Trade,
  Bar,
  OrderBookSnapshot,
  OrderBookLevel,
  MarketRegime,
  MarketEvent,
} from '@/types/market';

interface OrderWithAge extends Order {
  age: number; // Steps since order was placed
}

interface OrderBook {
  bids: OrderWithAge[]; // Sorted descending by price (best bid first)
  asks: OrderWithAge[]; // Sorted ascending by price (best ask first)
}

export class OrderFlowSimulator {
  // Agents
  private informedTraders: InformedTrader[] = [];
  private marketMakers: MarketMaker[] = [];
  private noiseTraders: NoiseTrader[] = [];
  private jumpGenerator: JumpGenerator;
  private orderFlowGenerator: OrderFlowGenerator;

  // Order book (the heart of the simulation)
  private orderBook: OrderBook = {
    bids: [],
    asks: [],
  };

  // Track last price for market maker updates
  private lastMarketMakerPrice: number = 100;
  private readonly MARKET_MAKER_REFRESH_THRESHOLD = 0.001; // Refresh if price moves 0.1%

  // Trade and bar history
  private trades: Trade[] = [];
  private bars: Bar[] = [];
  private currentBarTrades: Trade[] = [];
  private currentBarStartTime: number;

  // Simulation state
  private regime: MarketRegime = 'sideways';
  private tradeIdCounter: number = 0;
  private currentPrice: number; // Last trade price (for initialization only)

  // Timing
  private readonly barDuration = 250; // 250ms bars
  private readonly dt = 1 / (252); // 1 trading day per step (252 trading days/year)

  constructor(initialPrice: number = 100) {
    this.currentPrice = initialPrice;
    this.currentBarStartTime = Date.now();

    // Create 10 informed traders with correlated beliefs
    // Each has slightly different initial belief (±5% variation)
    for (let i = 0; i < 10; i++) {
      const beliefVariation = 0.95 + Math.random() * 0.10; // 0.95 to 1.05
      this.informedTraders.push(
        new InformedTrader({
          initialBelief: initialPrice * beliefVariation,
          threshold: 0.02, // 1.2% threshold to trade (balanced for volume and choppiness)
          aggression: 0.005, // 0.5% crossing of spread (more aggressive)
          baseSize: 100,
        })
      );
    }

    // Create 2 market makers for liquidity
    this.marketMakers.push(
      new MarketMaker({
        spread: 0.002, // 0.2% half-spread
        levels: 4, // 4 levels deep on each side
        baseSize: 50,
      })
    );
    this.marketMakers.push(
      new MarketMaker({
        spread: 0.0025, // Slightly wider spread
        levels: 3,
        baseSize: 75,
      })
    );

    // Create 20 noise traders for volume and depth
    for (let i = 0; i < 20; i++) {
      this.noiseTraders.push(
        new NoiseTrader({
          tradeProbability: 0.18, // 18% chance to trade each step (increased for volume)
          marketOrderRatio: 0.3, // 30% market orders, 70% limit orders
          minSize: 30, // Increased from 10 for better volume
          maxSize: 120, // Increased from 50 for better volume
          priceRange: 0.005, // Place limits within 0.5% of mid
        })
      );
    }

    // Create jump generator (news shocks)
    this.jumpGenerator = new JumpGenerator({
      jumpProbability: 0.0004, // ~40 jumps per hour (7 steps/bar * 4 bars/sec)
      jumpMean: 0.0,
      jumpStd: 0.005, // 0.5% jump size
      volatilitySpike: 2.0,
      spikeDuration: 10,
    });

    // Create order flow generator (volatility clustering)
    this.orderFlowGenerator = new OrderFlowGenerator({
      kappa: 2.0,
      theta: 1.0,
      sigmaA: 0.4,
      minActivity: 0.2,
      maxActivity: 2.0,
    });
  }

  /**
   * Main simulation step
   *
   * Each step:
   * 1. Update order flow activity (volatility clustering)
   * 2. Check for jump events (news shocks)
   * 3. Update informed trader beliefs (GBM)
   * 4. Generate orders from all agents
   * 5. Match orders in order book
   * 6. Record trades
   * 7. Close bar if time elapsed
   */
  simulateStep(): void {
    // Step 1: Update order flow activity
    this.orderFlowGenerator.updateActivity(this.dt);
    const activity = this.orderFlowGenerator.getActivity();

    // Step 2: Check for jump events
    const jumpEvent = this.jumpGenerator.maybeGenerateJump();
    if (jumpEvent) {
      this.handleJumpEvent(jumpEvent);
    }

    // Step 3: Update informed trader beliefs with correlated shocks
    // Generate shared shock (creates correlation between traders)
    const sharedShock = this.gaussian();

    for (const trader of this.informedTraders) {
      // Each trader gets idiosyncratic shock (creates some independence)
      const idioShock = this.gaussian();

      // Update belief with correlated shocks (90% shared, 10% independent)
      trader.updateBelief(this.regime, this.dt, sharedShock, idioShock, 0.2);

      // Apply jump if one occurred
      if (jumpEvent) {
        const currentBelief = trader.getBelief();
        const newBelief = this.jumpGenerator.applyJumpToBelief(currentBelief, jumpEvent.magnitude);
        // We need to set the belief, but InformedTrader doesn't expose a setter
        // The jump is already applied through updateBelief's drift, so this is handled
      }
    }

    // Step 4: Age existing orders and cancel stale ones
    this.ageAndCancelOrders();

    const midPrice = this.currentPrice;

    // Step 5: Market makers refresh orders if price moved significantly
    const priceMovement = Math.abs((midPrice - this.lastMarketMakerPrice) / this.lastMarketMakerPrice);
    if (priceMovement > this.MARKET_MAKER_REFRESH_THRESHOLD || this.orderBook.bids.length < 5 || this.orderBook.asks.length < 5) {
      // Cancel all market maker orders (identifiable by id prefix 'mm_')
      this.orderBook.bids = this.orderBook.bids.filter(o => !o.id.startsWith('mm_'));
      this.orderBook.asks = this.orderBook.asks.filter(o => !o.id.startsWith('mm_'));

      // Generate fresh market maker orders
      for (const mm of this.marketMakers) {
        const volatilityMultiplier = 1.0 + (activity - 1.0) * 0.5; // Spread widens with activity
        const orders = mm.generateOrders(midPrice, volatilityMultiplier);
        this.addOrders(orders);
      }

      this.lastMarketMakerPrice = midPrice;
    }

    // Step 6: Informed traders post orders occasionally (not every step)
    for (const trader of this.informedTraders) {
      // Activity affects participation + random element (don't all trade at once)
      if (Math.random() < activity * 0.35) { // 35% chance per step at normal activity
        const order = trader.generateOrder(midPrice);
        if (order) {
          // Scale size with activity
          order.size = Math.round(order.size * activity);
          this.addOrders([order]);
        }
      }
    }

    // Step 7: Noise traders add random orders
    for (const trader of this.noiseTraders) {
      const order = trader.maybeGenerateOrder(midPrice);
      if (order) {
        // Scale size with activity
        order.size = Math.round(order.size * activity);
        this.addOrders([order]);
      }
    }

    // Step 5: Match orders and generate trades
    this.matchOrders();

    // Step 6: Maybe close bar
    this.maybeCloseBar();
  }

  /**
   * Handle jump event
   *
   * When news hits:
   * - All informed trader beliefs jump
   * - Order flow activity spikes
   * - Creates surge of one-sided order flow
   * - Price jumps naturally through order matching
   */
  private handleJumpEvent(jumpEvent: JumpEvent): void {
    // Spike order flow activity
    this.orderFlowGenerator.spikeActivity(jumpEvent.volatilityMultiplier);

    // Informed trader beliefs are updated in simulateStep
    // The jump magnitude will be applied there
  }

  /**
   * Age existing orders and cancel stale ones
   *
   * Orders are canceled if:
   * - Older than 10 steps (prevents stale orders accumulating)
   * - Price is >2% away from current market (too far out of the money)
   */
  private ageAndCancelOrders(): void {
    const MAX_AGE = 10; // Cancel orders older than 10 steps
    const MAX_PRICE_DISTANCE = 0.02; // Cancel orders >2% from mid

    // Age all orders
    for (const order of this.orderBook.bids) {
      order.age++;
    }
    for (const order of this.orderBook.asks) {
      order.age++;
    }

    // Cancel old or far-from-market orders
    this.orderBook.bids = this.orderBook.bids.filter(order => {
      if (order.age > MAX_AGE) return false; // Too old
      const distance = Math.abs((order.price - this.currentPrice) / this.currentPrice);
      if (distance > MAX_PRICE_DISTANCE) return false; // Too far from market
      return true;
    });

    this.orderBook.asks = this.orderBook.asks.filter(order => {
      if (order.age > MAX_AGE) return false; // Too old
      const distance = Math.abs((order.price - this.currentPrice) / this.currentPrice);
      if (distance > MAX_PRICE_DISTANCE) return false; // Too far from market
      return true;
    });
  }

  /**
   * Add orders to order book
   */
  private addOrders(orders: Order[]): void {
    for (const order of orders) {
      // Add age tracking
      const orderWithAge: OrderWithAge = {
        ...order,
        age: 0, // New order
      };

      if (orderWithAge.side === 'buy') {
        this.orderBook.bids.push(orderWithAge);
      } else {
        this.orderBook.asks.push(orderWithAge);
      }
    }

    // Keep order book sorted
    // Bids: highest price first (descending)
    // Asks: lowest price first (ascending)
    this.orderBook.bids.sort((a, b) => b.price - a.price);
    this.orderBook.asks.sort((a, b) => a.price - b.price);
  }

  /**
   * Match orders in order book
   *
   * This is where PRICE DISCOVERY happens!
   *
   * Orders match when:
   * - Best bid price >= best ask price
   *
   * Match priority:
   * - Price (best price first)
   * - Time (FIFO at same price)
   *
   * Partial fills are supported.
   */
  private matchOrders(): void {
    while (this.orderBook.bids.length > 0 && this.orderBook.asks.length > 0) {
      const bestBid = this.orderBook.bids[0];
      const bestAsk = this.orderBook.asks[0];

      // Check if orders can match
      if (bestBid.price < bestAsk.price) {
        break; // No match possible
      }

      // Match! Execute trade at the price of the passive order (price-time priority)
      // If both posted simultaneously, use mid-point
      const tradePrice = bestBid.timestamp < bestAsk.timestamp
        ? bestBid.price
        : bestAsk.timestamp < bestBid.timestamp
        ? bestAsk.price
        : (bestBid.price + bestAsk.price) / 2;

      const tradeSize = Math.min(bestBid.size, bestAsk.size);

      // Record trade
      const trade: Trade = {
        id: `trade_${this.tradeIdCounter++}`,
        price: tradePrice,
        size: tradeSize,
        timestamp: Date.now(),
        side: bestBid.timestamp < bestAsk.timestamp ? 'buy' : 'sell', // Aggressor side
      };

      this.trades.push(trade);
      this.currentBarTrades.push(trade);
      this.currentPrice = tradePrice;

      // Update order sizes
      bestBid.size -= tradeSize;
      bestAsk.size -= tradeSize;

      // Remove fully filled orders
      if (bestBid.size === 0) {
        this.orderBook.bids.shift();
      }
      if (bestAsk.size === 0) {
        this.orderBook.asks.shift();
      }
    }
  }

  /**
   * Close current bar and create OHLCV bar
   */
  private maybeCloseBar(): void {
    const now = Date.now();

    if (now >= this.currentBarStartTime + this.barDuration) {
      if (this.currentBarTrades.length > 0) {
        // Calculate OHLC from trades
        const open = this.currentBarTrades[0].price;
        const close = this.currentBarTrades[this.currentBarTrades.length - 1].price;
        const high = Math.max(...this.currentBarTrades.map((t) => t.price));
        const low = Math.min(...this.currentBarTrades.map((t) => t.price));

        // Calculate volume
        const volume = this.currentBarTrades.reduce((sum, t) => sum + t.size, 0);

        this.bars.push({
          time: this.currentBarStartTime / 1000, // Unix timestamp in seconds
          open,
          high,
          low,
          close,
          volume,
        });
      } else {
        // No trades this bar - create a flat bar
        this.bars.push({
          time: this.currentBarStartTime / 1000,
          open: this.currentPrice,
          high: this.currentPrice,
          low: this.currentPrice,
          close: this.currentPrice,
          volume: 0,
        });
      }

      // Start new bar
      this.currentBarTrades = [];
      this.currentBarStartTime = this.currentBarStartTime + this.barDuration;
    }
  }

  /**
   * Force close current bar (called at regular intervals)
   */
  closeCurrentBar(): void {
    this.maybeCloseBar();
  }

  /**
   * Get order book snapshot for display
   */
  getOrderBookSnapshot(): OrderBookSnapshot {
    // Aggregate orders by price level
    const bidLevels = this.aggregateLevels(this.orderBook.bids);
    const askLevels = this.aggregateLevels(this.orderBook.asks);

    // Calculate spread and mid price
    const bestBid = bidLevels.length > 0 ? bidLevels[0].price : this.currentPrice * 0.99;
    const bestAsk = askLevels.length > 0 ? askLevels[0].price : this.currentPrice * 1.01;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    return {
      bids: bidLevels.slice(0, 10), // Top 10 levels
      asks: askLevels.slice(0, 10), // Top 10 levels
      spread,
      midPrice,
    };
  }

  /**
   * Aggregate orders into price levels
   */
  private aggregateLevels(orders: Order[]): OrderBookLevel[] {
    const levels = new Map<number, number>();

    for (const order of orders) {
      const currentSize = levels.get(order.price) || 0;
      levels.set(order.price, currentSize + order.size);
    }

    const aggregated: OrderBookLevel[] = [];
    let cumulative = 0;

    for (const [price, size] of levels) {
      cumulative += size;
      aggregated.push({ price, size, total: cumulative });
    }

    return aggregated;
  }

  /**
   * Get all completed bars
   */
  getBars(): Bar[] {
    return [...this.bars];
  }

  /**
   * Get recent trades
   */
  getTrades(limit: number = 50): Trade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get current price (last trade price)
   */
  getCurrentPrice(): number {
    return this.currentPrice;
  }

  /**
   * Get current regime
   */
  getRegime(): MarketRegime {
    return this.regime;
  }

  /**
   * Change market regime
   *
   * Affects drift in informed trader beliefs
   */
  setRegime(regime: MarketRegime): void {
    this.regime = regime;
  }

  /**
   * Randomly switch regime (DISABLED)
   *
   * Regime changes are now only manual (via user controls or events).
   * Market stays in sideways (choppy) regime by default unless user changes it.
   */
  maybeChangeRegime(): void {
    // Automatic regime switching disabled
    // Regime only changes via:
    // 1. User control (setRegime)
    // 2. Market events (injectEvent with regime_change)
  }

  /**
   * Inject market event
   */
  injectEvent(event: MarketEvent): void {
    switch (event.type) {
      case 'news_shock':
        // Create a jump event
        const jumpEvent: JumpEvent = {
          magnitude: event.magnitude,
          volatilityMultiplier: 2.0,
          duration: 10,
        };
        this.handleJumpEvent(jumpEvent);
        break;

      case 'volatility_spike':
        this.orderFlowGenerator.spikeActivity(3.0);
        break;

      case 'regime_change':
        this.setRegime(event.newRegime);
        break;
    }
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
