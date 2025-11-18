/**
 * Market Stats Component
 *
 * Displays key market statistics including current price, 24h change,
 * volume, high/low, and last trade direction.
 *
 * Features:
 * - Large price display with change indicator
 * - Color-coded change percentage (green up, red down)
 * - Grid layout for easy scanning
 * - Real-time updates
 */

'use client';

import { MarketStats as MarketStatsType } from '@/types/market';

interface MarketStatsProps {
  stats: MarketStatsType;
}

export function MarketStats({ stats }: MarketStatsProps) {
  /**
   * Format price to 2 decimal places
   */
  const formatPrice = (price: number): string => {
    return price.toFixed(2);
  };

  /**
   * Format percentage with sign
   */
  const formatPercent = (percent: number): string => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  };

  /**
   * Format large numbers with K/M suffix
   */
  const formatVolume = (volume: number): string => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(2)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(2)}K`;
    }
    return Math.round(volume).toString();
  };

  /**
   * Get color class based on direction
   */
  const getDirectionColor = (direction: 'up' | 'down' | 'neutral'): string => {
    switch (direction) {
      case 'up':
        return 'text-green-400';
      case 'down':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  /**
   * Get direction arrow
   */
  const getDirectionArrow = (direction: 'up' | 'down' | 'neutral'): string => {
    switch (direction) {
      case 'up':
        return '▲';
      case 'down':
        return '▼';
      default:
        return '●';
    }
  };

  const changeColor = stats.change24h >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4">
      {/* Main price display */}
      <div className="mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-3xl font-bold text-white font-mono">
            ${formatPrice(stats.lastPrice)}
          </h2>
          <span
            className={`text-lg font-semibold ${getDirectionColor(
              stats.lastTradeDirection
            )}`}
          >
            {getDirectionArrow(stats.lastTradeDirection)}
          </span>
        </div>
        <div className={`text-lg font-semibold ${changeColor} mt-1`}>
          {formatPercent(stats.change24h)}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Volume */}
        <div>
          <div className="text-xs text-gray-400 mb-1">Volume</div>
          <div className="text-sm font-semibold text-white font-mono">
            {formatVolume(stats.volume24h)}
          </div>
        </div>

        {/* 24h High */}
        <div>
          <div className="text-xs text-gray-400 mb-1">24h High</div>
          <div className="text-sm font-semibold text-green-400 font-mono">
            ${formatPrice(stats.high24h)}
          </div>
        </div>

        {/* 24h Low */}
        <div>
          <div className="text-xs text-gray-400 mb-1">24h Low</div>
          <div className="text-sm font-semibold text-red-400 font-mono">
            ${formatPrice(stats.low24h)}
          </div>
        </div>

        {/* Last Trade */}
        <div>
          <div className="text-xs text-gray-400 mb-1">Last Trade</div>
          <div
            className={`text-sm font-semibold font-mono ${getDirectionColor(
              stats.lastTradeDirection
            )}`}
          >
            {stats.lastTradeDirection === 'up' ? 'BUY' : stats.lastTradeDirection === 'down' ? 'SELL' : 'NONE'}
          </div>
        </div>
      </div>
    </div>
  );
}
