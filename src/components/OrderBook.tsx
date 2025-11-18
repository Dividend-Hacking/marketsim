/**
 * Order Book Component
 *
 * Displays the current state of the order book with bid and ask levels.
 * Shows price, size, and cumulative totals for each level.
 *
 * Features:
 * - Color-coded bids (green) and asks (red)
 * - Spread indicator between best bid and best ask
 * - Visual depth bars showing relative size
 * - Real-time updates as orders are added/removed
 */

'use client';

import { OrderBookSnapshot } from '@/types/market';

interface OrderBookProps {
  orderBook: OrderBookSnapshot;
}

export function OrderBook({ orderBook }: OrderBookProps) {
  const { bids, asks, spread, midPrice } = orderBook;

  /**
   * Format number to 2 decimal places
   */
  const formatPrice = (price: number): string => {
    return price.toFixed(2);
  };

  /**
   * Format size with commas for readability
   */
  const formatSize = (size: number): string => {
    return Math.round(size).toLocaleString();
  };

  /**
   * Calculate percentage for depth bar
   */
  const getDepthPercentage = (size: number, maxSize: number): number => {
    return (size / maxSize) * 100;
  };

  // Find max size for depth bar scaling
  const maxBidSize = Math.max(...bids.map((b) => b.size), 1);
  const maxAskSize = Math.max(...asks.map((a) => a.size), 1);

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-2">Order Book</h3>
        <div className="flex justify-between text-sm text-gray-400">
          <span>Price</span>
          <span>Size</span>
          <span>Total</span>
        </div>
      </div>

      {/* Asks (sells) - shown in reverse order (lowest first) */}
      <div className="flex-1 overflow-auto mb-2">
        {asks.slice().reverse().map((level, index) => (
          <div
            key={`ask-${index}`}
            className="relative flex justify-between text-sm py-1 px-2 rounded"
          >
            {/* Background depth bar */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-red-900/20"
              style={{ width: `${getDepthPercentage(level.size, maxAskSize)}%` }}
            />

            {/* Content */}
            <span className="relative z-10 text-red-400 font-mono">
              {formatPrice(level.price)}
            </span>
            <span className="relative z-10 text-gray-300 font-mono">
              {formatSize(level.size)}
            </span>
            <span className="relative z-10 text-gray-400 font-mono">
              {formatSize(level.total)}
            </span>
          </div>
        ))}
      </div>

      {/* Spread indicator */}
      <div className="border-t border-b border-[#2a2a2a] py-3 my-2">
        <div className="flex justify-between items-center">
          <div className="text-sm">
            <span className="text-gray-400">Spread: </span>
            <span className="text-yellow-400 font-mono">
              {formatPrice(spread)}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Mid: </span>
            <span className="text-white font-mono">
              {formatPrice(midPrice)}
            </span>
          </div>
        </div>
      </div>

      {/* Bids (buys) */}
      <div className="flex-1 overflow-auto mt-2">
        {bids.map((level, index) => (
          <div
            key={`bid-${index}`}
            className="relative flex justify-between text-sm py-1 px-2 rounded"
          >
            {/* Background depth bar */}
            <div
              className="absolute right-0 top-0 bottom-0 bg-green-900/20"
              style={{ width: `${getDepthPercentage(level.size, maxBidSize)}%` }}
            />

            {/* Content */}
            <span className="relative z-10 text-green-400 font-mono">
              {formatPrice(level.price)}
            </span>
            <span className="relative z-10 text-gray-300 font-mono">
              {formatSize(level.size)}
            </span>
            <span className="relative z-10 text-gray-400 font-mono">
              {formatSize(level.total)}
            </span>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {bids.length === 0 && asks.length === 0 && (
        <div className="flex items-center justify-center h-full text-gray-500">
          <p>No orders in book</p>
        </div>
      )}
    </div>
  );
}
