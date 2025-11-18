/**
 * Trades Feed Component
 *
 * Displays a scrolling list of recent executed trades.
 * Shows timestamp, price, size, and trade direction (buy/sell).
 *
 * Features:
 * - Auto-scrolls to show latest trades
 * - Color-coded by trade direction (green for buys, red for sells)
 * - Formatted timestamps and prices
 * - Compact display for space efficiency
 */

'use client';

import { Trade } from '@/types/market';
import { useEffect, useRef } from 'react';

interface TradesFeedProps {
  trades: Trade[];
}

export function TradesFeed({ trades }: TradesFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-scroll to bottom when new trades arrive
   */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [trades]);

  /**
   * Format timestamp to show time only (HH:MM:SS)
   */
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  /**
   * Format price to 2 decimal places
   */
  const formatPrice = (price: number): string => {
    return price.toFixed(2);
  };

  /**
   * Format size with commas
   */
  const formatSize = (size: number): string => {
    return Math.round(size).toLocaleString();
  };

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4 h-full flex flex-col">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-white mb-2">Recent Trades</h3>
        <div className="flex justify-between text-xs text-gray-400">
          <span className="w-20">Time</span>
          <span className="w-20 text-right">Price</span>
          <span className="w-20 text-right">Size</span>
        </div>
      </div>

      {/* Trades list - scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="flex justify-between text-xs py-1 px-2 rounded hover:bg-[#1a1a1a] transition-colors"
          >
            <span className="w-20 text-gray-400 font-mono">
              {formatTime(trade.timestamp)}
            </span>
            <span
              className={`w-20 text-right font-mono font-semibold ${
                trade.side === 'buy' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {formatPrice(trade.price)}
            </span>
            <span className="w-20 text-right text-gray-300 font-mono">
              {formatSize(trade.size)}
            </span>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {trades.length === 0 && (
        <div className="flex items-center justify-center h-full text-gray-500">
          <p>No trades yet</p>
        </div>
      )}

      {/* Trade count indicator */}
      {trades.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[#2a2a2a] text-xs text-gray-400 text-center">
          {trades.length} recent trades
        </div>
      )}
    </div>
  );
}
