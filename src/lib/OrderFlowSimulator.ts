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

/**
 * Deque (double-ended queue) for efficient O(1) order removal
 * Uses head/tail indices to avoid expensive array shifts
 */
class OrderDeque {
  private orders: OrderWithAge[] = [];
  private head: number = 0;

  /**
   * Add order to end of queue - O(1)
   */
  push(order: OrderWithAge): void {
    this.orders.push(order);
  }

  /**
   * Get first order without removing - O(1)
   */
  peek(): OrderWithAge | undefined {
    if (this.head >= this.orders.length) return undefined;
    return this.orders[this.head];
  }

  /**
   * Remove and return first order - O(1) amortized
   */
  shift(): OrderWithAge | undefined {
    if (this.head >= this.orders.length) return undefined;
    const order = this.orders[this.head++];

    // Compact array when head pointer gets too far (amortized O(1))
    if (this.head > 100 && this.head > this.orders.length / 2) {
      this.orders = this.orders.slice(this.head);
      this.head = 0;
    }

    return order;
  }

  /**
   * Get all remaining orders - O(n)
   */
  getAll(): OrderWithAge[] {
    return this.orders.slice(this.head);
  }

  /**
   * Get number of orders - O(1)
   */
  get length(): number {
    return this.orders.length - this.head;
  }

  /**
   * Clear all orders - O(1)
   */
  clear(): void {
    this.orders = [];
    this.head = 0;
  }

  /**
   * Filter orders and create new deque - O(n)
   */
  filter(predicate: (order: OrderWithAge) => boolean): OrderDeque {
    const newDeque = new OrderDeque();
    newDeque.orders = this.orders.slice(this.head).filter(predicate);
    return newDeque;
  }

  /**
   * Iterate over all orders - O(n)
   */
  forEach(callback: (order: OrderWithAge) => void): void {
    for (let i = this.head; i < this.orders.length; i++) {
      callback(this.orders[i]);
    }
  }
}

/**
 * Price-level order book using Map for O(1) price level access
 * Maintains separate sorted price arrays for fast best bid/ask lookup
 */
interface PriceLevelOrderBook {
  bidLevels: Map<number, OrderDeque>; // price -> orders at that price
  askLevels: Map<number, OrderDeque>; // price -> orders at that price
  bidPrices: number[]; // Sorted descending (best bid first)
  askPrices: number[]; // Sorted ascending (best ask first)
}

/**
 * Random number pool for pre-computed Gaussian values
 * Amortizes expensive Math.sqrt/log/cos calls
 */
class RandomPool {
  private pool: number[] = [];
  private index: number = 0;
  private readonly poolSize = 1000;

  constructor() {
    this.refill();
  }

  /**
   * Get next Gaussian random number - O(1) amortized
   */
  gaussian(): number {
    if (this.index >= this.pool.length) {
      this.refill();
      this.index = 0;
    }
    return this.pool[this.index++];
  }

  /**
   * Refill pool with Box-Muller transform - O(n)
   * Called once per 1000 random numbers
   */
  private refill(): void {
    this.pool = [];
    for (let i = 0; i < this.poolSize; i += 2) {
      const u = Math.random();
      const v = Math.random();
      const r = Math.sqrt(-2 * Math.log(u));
      this.pool.push(r * Math.cos(2 * Math.PI * v));
      this.pool.push(r * Math.sin(2 * Math.PI * v));
    }
  }
}

/**
 * Incremental OHLCV tracker
 * Updates in O(1) as trades execute instead of O(n) at bar close
 */
interface OHLCVTracker {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class OrderFlowSimulator {
  // Agents
  private informedTraders: InformedTrader[] = [];
  private marketMakers: MarketMaker[] = [];
  private noiseTraders: NoiseTrader[] = [];
  private jumpGenerator: JumpGenerator;
  private orderFlowGenerator: OrderFlowGenerator;

  // Order book (the heart of the simulation) - now using price-level map for O(1) operations
  private orderBook: PriceLevelOrderBook = {
    bidLevels: new Map<number, OrderDeque>(),
    askLevels: new Map<number, OrderDeque>(),
    bidPrices: [],
    askPrices: [],
  };

  // Track last price for market maker updates
  private lastMarketMakerPrice: number = 100;
  private readonly MARKET_MAKER_REFRESH_THRESHOLD = 0.001; // Refresh if price moves 0.1%

  // Trade and bar history
  private trades: Trade[] = [];
  private bars: Bar[] = [];
  private currentBarTrades: Trade[] = [];
  private currentBarStartTime: number;

  // Incremental OHLCV tracking for O(1) bar creation
  private currentBarOHLCV: OHLCVTracker = {
    open: 0,
    high: -Infinity,
    low: Infinity,
    close: 0,
    volume: 0,
  };

  // Snapshot caching to avoid re-aggregation
  private cachedSnapshot: OrderBookSnapshot | null = null;
  private snapshotDirty: boolean = true;

  // Random number pool for efficient Gaussian generation
  private randomPool: RandomPool = new RandomPool();

  // Simulation state
  private regime: MarketRegime = 'sideways';
  private tradeIdCounter: number = 0;
  private currentPrice: number; // Last trade price (for initialization only)

  // Timing - OPTIMIZED for realistic liquid stock appearance
  private readonly barDuration = 1000; // 1000ms (1 second) bars - smooth, realistic bars
  private readonly dt = 1 / (252); // 1 trading day per step (252 trading days/year)

  constructor(initialPrice: number = 100) {
    this.currentPrice = initialPrice;
    this.currentBarStartTime = Date.now();

    // Create 20 informed traders with correlated beliefs
    // Each has slightly different initial belief (±5% variation)
    // OPTIMIZED for liquid stock appearance: lower threshold, larger sizes
    for (let i = 0; i < 20; i++) {
      const beliefVariation = 0.90 + Math.random() * 0.10; // 0.90 to 1.00
      this.informedTraders.push(
        new InformedTrader({
          initialBelief: initialPrice * beliefVariation,
          threshold: 0.003, // 0.3% threshold - more responsive, fills gaps
          aggression: 0.01, // 0.5% crossing of spread (more aggressive)
          baseSize: 800, // 4x larger for realistic volume
        })
      );
    }

    // Create 2 market makers for liquidity
    // OPTIMIZED: Larger sizes for realistic depth
    this.marketMakers.push(
      new MarketMaker({
        spread: 0.002, // 0.2% half-spread
        levels: 4, // 4 levels deep on each side
        baseSize: 150, // 3x larger for thicker book
      })
    );
    this.marketMakers.push(
      new MarketMaker({
        spread: 0.0025, // Slightly wider spread
        levels: 3,
        baseSize: 200, // ~2.7x larger for thicker book
      })
    );

    // Create 40 noise traders for volume and depth
    // OPTIMIZED: Larger sizes for realistic volume
    for (let i = 0; i < 40; i++) {
      this.noiseTraders.push(
        new NoiseTrader({
          tradeProbability: 0.20, // 20% chance to trade each step
          marketOrderRatio: 0.5, // 50% market orders, 50% limit orders
          minSize: 150, // 3x larger for realistic volume
          maxSize: 400, // 4x larger for realistic volume
          priceRange: 0.01, // Place limits within 1% of mid
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
      minActivity: 1.0,
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
    // OPTIMIZED: Higher activation rate (80%) for continuous price discovery and smooth bars
    // This creates more consistent trading activity to fill gaps
    const sharedShock = this.randomPool.gaussian();
    const activeTraders: { trader: InformedTrader; idioShock: number }[] = [];

    for (const trader of this.informedTraders) {
      // Check if trader will be active this step - 80% activation for liquid appearance
      if (Math.random() < activity * 0.80) {
        const idioShock = this.randomPool.gaussian();
        activeTraders.push({ trader, idioShock });
      }
    }

    // Only update beliefs for active traders
    for (const { trader, idioShock } of activeTraders) {
      // Update belief with correlated shocks (90% shared, 10% independent)
      trader.updateBelief(this.regime, this.dt, sharedShock, idioShock, 0.2);

      // Apply jump if one occurred
      // Note: Jump is already applied through updateBelief's drift parameter
      // No need to explicitly set belief here as InformedTrader doesn't expose a setter
      // The jumpEvent.magnitude is incorporated into the regime drift
    }

    // Step 4: Age existing orders and cancel stale ones
    this.ageAndCancelOrders();

    const midPrice = this.currentPrice;

    // Get total order count for market maker refresh check
    const totalBids = this.getTotalOrderCount(this.orderBook.bidLevels);
    const totalAsks = this.getTotalOrderCount(this.orderBook.askLevels);

    // Step 5: Market makers refresh orders if price moved significantly
    const priceMovement = Math.abs((midPrice - this.lastMarketMakerPrice) / this.lastMarketMakerPrice);
    if (priceMovement > this.MARKET_MAKER_REFRESH_THRESHOLD || totalBids < 5 || totalAsks < 5) {
      // Cancel all market maker orders (identifiable by id prefix 'mm_')
      this.removeMarketMakerOrders();

      // Generate fresh market maker orders
      for (const mm of this.marketMakers) {
        const volatilityMultiplier = 1.0 + (activity - 1.0) * 0.5; // Spread widens with activity
        const orders = mm.generateOrders(midPrice, volatilityMultiplier);
        this.addOrders(orders);
      }

      this.lastMarketMakerPrice = midPrice;
    }

    // Step 6: Informed traders post orders (only for active traders - already filtered above)
    // Note: Active traders are filtered at activation (line 353 - now 80% activation rate)
    for (const { trader } of activeTraders) {
      const order = trader.generateOrder(midPrice);
      if (order) {
        // Scale size with activity
        order.size = Math.round(order.size * activity);
        this.addOrders([order]);
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
   * Age existing orders and cancel stale ones - OPTIMIZED for price-level map
   *
   * Orders are canceled if:
   * - Older than 10 steps (prevents stale orders accumulating)
   * - Price is >2% away from current market (too far out of the money)
   */
  private ageAndCancelOrders(): void {
    const MAX_AGE = 10; // Cancel orders older than 10 steps
    const MAX_PRICE_DISTANCE = 0.02; // Cancel orders >2% from mid

    const pricesToRemove: number[] = [];

    // Age and filter bids
    for (const [price, deque] of this.orderBook.bidLevels) {
      // Age all orders at this price level
      deque.forEach(order => order.age++);

      // Filter out stale orders
      const filtered = deque.filter(order => {
        if (order.age > MAX_AGE) return false;
        const distance = Math.abs((order.price - this.currentPrice) / this.currentPrice);
        if (distance > MAX_PRICE_DISTANCE) return false;
        return true;
      });

      // If no orders remain at this price, mark for removal
      if (filtered.length === 0) {
        pricesToRemove.push(price);
      } else {
        this.orderBook.bidLevels.set(price, filtered);
      }
    }

    // Remove empty price levels from bids
    for (const price of pricesToRemove) {
      this.orderBook.bidLevels.delete(price);
    }

    // Update sorted bid prices array
    this.orderBook.bidPrices = Array.from(this.orderBook.bidLevels.keys()).sort((a, b) => b - a);

    pricesToRemove.length = 0; // Reuse array

    // Age and filter asks
    for (const [price, deque] of this.orderBook.askLevels) {
      // Age all orders at this price level
      deque.forEach(order => order.age++);

      // Filter out stale orders
      const filtered = deque.filter(order => {
        if (order.age > MAX_AGE) return false;
        const distance = Math.abs((order.price - this.currentPrice) / this.currentPrice);
        if (distance > MAX_PRICE_DISTANCE) return false;
        return true;
      });

      // If no orders remain at this price, mark for removal
      if (filtered.length === 0) {
        pricesToRemove.push(price);
      } else {
        this.orderBook.askLevels.set(price, filtered);
      }
    }

    // Remove empty price levels from asks
    for (const price of pricesToRemove) {
      this.orderBook.askLevels.delete(price);
    }

    // Update sorted ask prices array
    this.orderBook.askPrices = Array.from(this.orderBook.askLevels.keys()).sort((a, b) => a - b);

    // Mark snapshot as dirty since order book changed
    this.snapshotDirty = true;
  }

  /**
   * Add orders to order book - OPTIMIZED for price-level map
   * O(1) per order instead of O(n log n) sort
   */
  private addOrders(orders: Order[]): void {
    for (const order of orders) {
      // Add age tracking
      const orderWithAge: OrderWithAge = {
        ...order,
        age: 0, // New order
      };

      if (orderWithAge.side === 'buy') {
        // Get or create deque for this price level
        let deque = this.orderBook.bidLevels.get(orderWithAge.price);
        if (!deque) {
          deque = new OrderDeque();
          this.orderBook.bidLevels.set(orderWithAge.price, deque);

          // Insert price into sorted array (binary search for insertion point)
          const insertIdx = this.binarySearchInsert(this.orderBook.bidPrices, orderWithAge.price, true);
          this.orderBook.bidPrices.splice(insertIdx, 0, orderWithAge.price);
        }
        deque.push(orderWithAge);
      } else {
        // Get or create deque for this price level
        let deque = this.orderBook.askLevels.get(orderWithAge.price);
        if (!deque) {
          deque = new OrderDeque();
          this.orderBook.askLevels.set(orderWithAge.price, deque);

          // Insert price into sorted array (binary search for insertion point)
          const insertIdx = this.binarySearchInsert(this.orderBook.askPrices, orderWithAge.price, false);
          this.orderBook.askPrices.splice(insertIdx, 0, orderWithAge.price);
        }
        deque.push(orderWithAge);
      }
    }

    // Mark snapshot as dirty since order book changed
    this.snapshotDirty = true;
  }

  /**
   * Binary search to find insertion index for maintaining sorted price array
   * O(log n) instead of O(n log n) full sort
   */
  private binarySearchInsert(arr: number[], value: number, descending: boolean): number {
    let left = 0;
    let right = arr.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const comparison = descending ? arr[mid] > value : arr[mid] < value;

      if (comparison) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Match orders in order book - OPTIMIZED with price-level map and deques
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
   * Now uses O(1) deque operations instead of O(n) array shifts
   */
  private matchOrders(): void {
    while (this.orderBook.bidPrices.length > 0 && this.orderBook.askPrices.length > 0) {
      // O(1) access to best prices
      const bestBidPrice = this.orderBook.bidPrices[0];
      const bestAskPrice = this.orderBook.askPrices[0];

      // Check if orders can match
      if (bestBidPrice < bestAskPrice) {
        break; // No match possible
      }

      // Get order deques for best prices - O(1)
      const bidDeque = this.orderBook.bidLevels.get(bestBidPrice)!;
      const askDeque = this.orderBook.askLevels.get(bestAskPrice)!;

      // Get first orders from each deque - O(1)
      const bestBid = bidDeque.peek()!;
      const bestAsk = askDeque.peek()!;

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

      // OPTIMIZATION: Update OHLCV incrementally - O(1)
      this.updateOHLCV(trade);

      // REALISM: Track market maker fills for inventory management
      // Check if bid order belongs to a market maker
      if (bestBid.id.startsWith('mm_')) {
        // Notify all market makers (they'll check if it's their order)
        for (const mm of this.marketMakers) {
          mm.recordFill('buy', tradePrice, tradeSize);
        }
      }

      // Check if ask order belongs to a market maker
      if (bestAsk.id.startsWith('mm_')) {
        // Notify all market makers (they'll check if it's their order)
        for (const mm of this.marketMakers) {
          mm.recordFill('sell', tradePrice, tradeSize);
        }
      }

      // Update order sizes
      bestBid.size -= tradeSize;
      bestAsk.size -= tradeSize;

      // Remove fully filled orders - O(1) with deque
      if (bestBid.size === 0) {
        bidDeque.shift();
        // If price level is now empty, remove it
        if (bidDeque.length === 0) {
          this.orderBook.bidLevels.delete(bestBidPrice);
          this.orderBook.bidPrices.shift(); // Remove price from sorted array
        }
      }
      if (bestAsk.size === 0) {
        askDeque.shift();
        // If price level is now empty, remove it
        if (askDeque.length === 0) {
          this.orderBook.askLevels.delete(bestAskPrice);
          this.orderBook.askPrices.shift(); // Remove price from sorted array
        }
      }
    }

    // Mark snapshot as dirty if any trades occurred
    if (this.currentBarTrades.length > 0) {
      this.snapshotDirty = true;
    }
  }

  /**
   * Update OHLCV tracker incrementally - O(1) per trade
   * Eliminates need for O(n) array operations at bar close
   */
  private updateOHLCV(trade: Trade): void {
    if (this.currentBarOHLCV.open === 0) {
      this.currentBarOHLCV.open = trade.price;
      this.currentBarOHLCV.high = trade.price;
      this.currentBarOHLCV.low = trade.price;
    } else {
      this.currentBarOHLCV.high = Math.max(this.currentBarOHLCV.high, trade.price);
      this.currentBarOHLCV.low = Math.min(this.currentBarOHLCV.low, trade.price);
    }
    this.currentBarOHLCV.close = trade.price;
    this.currentBarOHLCV.volume += trade.size;
  }

  /**
   * Close current bar and create OHLCV bar - OPTIMIZED with incremental tracking
   * O(1) instead of O(n) array iterations
   */
  private maybeCloseBar(): void {
    const now = Date.now();

    if (now >= this.currentBarStartTime + this.barDuration) {
      if (this.currentBarTrades.length > 0) {
        // Use incrementally tracked OHLCV - no array operations needed!
        this.bars.push({
          time: this.currentBarStartTime / 1000, // Unix timestamp in seconds
          open: this.currentBarOHLCV.open,
          high: this.currentBarOHLCV.high,
          low: this.currentBarOHLCV.low,
          close: this.currentBarOHLCV.close,
          volume: this.currentBarOHLCV.volume,
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

      // Reset OHLCV tracker for new bar
      this.currentBarOHLCV = {
        open: 0,
        high: -Infinity,
        low: Infinity,
        close: 0,
        volume: 0,
      };

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
   * Get order book snapshot for display - OPTIMIZED with caching
   * Returns cached snapshot if order book hasn't changed
   */
  getOrderBookSnapshot(): OrderBookSnapshot {
    // Return cached snapshot if available and order book hasn't changed
    if (!this.snapshotDirty && this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    // Aggregate orders by price level (already pre-aggregated in Map structure!)
    const bidLevels = this.aggregateLevelsFromMap(this.orderBook.bidLevels, this.orderBook.bidPrices);
    const askLevels = this.aggregateLevelsFromMap(this.orderBook.askLevels, this.orderBook.askPrices);

    // Calculate spread and mid price
    const bestBid = bidLevels.length > 0 ? bidLevels[0].price : this.currentPrice * 0.99;
    const bestAsk = askLevels.length > 0 ? askLevels[0].price : this.currentPrice * 1.01;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    // Cache the snapshot
    this.cachedSnapshot = {
      bids: bidLevels.slice(0, 10), // Top 10 levels
      asks: askLevels.slice(0, 10), // Top 10 levels
      spread,
      midPrice,
    };

    this.snapshotDirty = false;
    return this.cachedSnapshot;
  }

  /**
   * Aggregate orders from price-level map into display format
   * More efficient than old approach since orders are already grouped by price
   */
  private aggregateLevelsFromMap(
    levels: Map<number, OrderDeque>,
    sortedPrices: number[]
  ): OrderBookLevel[] {
    const aggregated: OrderBookLevel[] = [];
    let cumulative = 0;

    for (const price of sortedPrices) {
      const deque = levels.get(price)!;
      // Sum all order sizes at this price level
      let levelSize = 0;
      deque.forEach(order => {
        levelSize += order.size;
      });

      cumulative += levelSize;
      aggregated.push({ price, size: levelSize, total: cumulative });
    }

    return aggregated;
  }

  /**
   * Get total order count across all price levels
   */
  private getTotalOrderCount(levels: Map<number, OrderDeque>): number {
    let count = 0;
    for (const deque of levels.values()) {
      count += deque.length;
    }
    return count;
  }

  /**
   * Remove all market maker orders from the order book
   */
  private removeMarketMakerOrders(): void {
    // Filter bids
    const bidPricesToRemove: number[] = [];
    for (const [price, deque] of this.orderBook.bidLevels) {
      const filtered = deque.filter(o => !o.id.startsWith('mm_'));
      if (filtered.length === 0) {
        bidPricesToRemove.push(price);
      } else {
        this.orderBook.bidLevels.set(price, filtered);
      }
    }

    // Remove empty price levels
    for (const price of bidPricesToRemove) {
      this.orderBook.bidLevels.delete(price);
    }
    this.orderBook.bidPrices = this.orderBook.bidPrices.filter(p => !bidPricesToRemove.includes(p));

    // Filter asks
    const askPricesToRemove: number[] = [];
    for (const [price, deque] of this.orderBook.askLevels) {
      const filtered = deque.filter(o => !o.id.startsWith('mm_'));
      if (filtered.length === 0) {
        askPricesToRemove.push(price);
      } else {
        this.orderBook.askLevels.set(price, filtered);
      }
    }

    // Remove empty price levels
    for (const price of askPricesToRemove) {
      this.orderBook.askLevels.delete(price);
    }
    this.orderBook.askPrices = this.orderBook.askPrices.filter(p => !askPricesToRemove.includes(p));

    // Mark snapshot as dirty
    this.snapshotDirty = true;
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
}
