/**
 * Simulation Controls Component
 *
 * Provides user controls for the market simulation including:
 * - Play/pause toggle
 * - Speed adjustment (0.5x to 5x)
 * - Event injection (news shocks, volatility spikes, regime changes)
 * - Current regime display
 *
 * Features:
 * - Intuitive button layout
 * - Visual feedback for current state
 * - Quick event injection buttons
 */

'use client';

import { MarketRegime, MarketEvent } from '@/types/market';

interface SimulationControlsProps {
  isRunning: boolean;
  speed: number;
  regime: MarketRegime;
  onTogglePause: () => void;
  onSetSpeed: (speed: number) => void;
  onInjectEvent: (event: MarketEvent) => void;
}

export function SimulationControls({
  isRunning,
  speed,
  regime,
  onTogglePause,
  onSetSpeed,
  onInjectEvent,
}: SimulationControlsProps) {
  /**
   * Speed presets for quick selection
   */
  const speedPresets = [0.5, 1, 2, 5];

  /**
   * Handle speed slider change
   */
  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSetSpeed(parseFloat(e.target.value));
  };

  /**
   * Inject a positive news shock
   */
  const injectPositiveNews = () => {
    onInjectEvent({
      type: 'news_shock',
      magnitude: Math.random() * 0.1 + 0.05, // +5% to +15%
    });
  };

  /**
   * Inject a negative news shock
   */
  const injectNegativeNews = () => {
    onInjectEvent({
      type: 'news_shock',
      magnitude: -(Math.random() * 0.1 + 0.05), // -5% to -15%
    });
  };

  /**
   * Inject a volatility spike
   */
  const injectVolatilitySpike = () => {
    onInjectEvent({
      type: 'volatility_spike',
      duration: 10, // 10 bars of high volatility
    });
  };

  /**
   * Change regime
   */
  const changeRegime = (newRegime: MarketRegime) => {
    onInjectEvent({
      type: 'regime_change',
      newRegime,
    });
  };

  /**
   * Get regime badge color
   */
  const getRegimeBadgeColor = (r: MarketRegime): string => {
    switch (r) {
      case 'bull':
        return 'bg-green-900/30 text-green-400 border-green-700';
      case 'bear':
        return 'bg-red-900/30 text-red-400 border-red-700';
      case 'sideways':
        return 'bg-yellow-900/30 text-yellow-400 border-yellow-700';
    }
  };

  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Simulation Controls</h3>

      {/* Current Regime Badge */}
      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-2">Current Regime</div>
        <div
          className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-semibold uppercase ${getRegimeBadgeColor(
            regime
          )}`}
        >
          {regime}
        </div>
      </div>

      {/* Play/Pause Control */}
      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-2">Playback</div>
        <button
          onClick={onTogglePause}
          className={`w-full px-4 py-2 rounded font-semibold transition-colors ${
            isRunning
              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {isRunning ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      {/* Speed Control */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-400">Speed</span>
          <span className="text-sm text-white font-mono">{speed.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.1"
          value={speed}
          onChange={handleSpeedChange}
          className="w-full"
        />
        <div className="flex justify-between mt-2 gap-2">
          {speedPresets.map((preset) => (
            <button
              key={preset}
              onClick={() => onSetSpeed(preset)}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                speed === preset
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#2a2a2a]'
              }`}
            >
              {preset}x
            </button>
          ))}
        </div>
      </div>

      {/* Event Injection */}
      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-2">Inject Events</div>
        <div className="space-y-2">
          <button
            onClick={injectPositiveNews}
            className="w-full px-3 py-2 bg-green-900/30 hover:bg-green-900/50 text-green-400 rounded text-sm font-medium transition-colors"
          >
            📈 Good News (+5-15%)
          </button>
          <button
            onClick={injectNegativeNews}
            className="w-full px-3 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-sm font-medium transition-colors"
          >
            📉 Bad News (-5-15%)
          </button>
          <button
            onClick={injectVolatilitySpike}
            className="w-full px-3 py-2 bg-orange-900/30 hover:bg-orange-900/50 text-orange-400 rounded text-sm font-medium transition-colors"
          >
            ⚡ Volatility Spike
          </button>
        </div>
      </div>

      {/* Regime Change */}
      <div>
        <div className="text-xs text-gray-400 mb-2">Change Regime</div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => changeRegime('bull')}
            disabled={regime === 'bull'}
            className="px-2 py-1 bg-green-900/30 hover:bg-green-900/50 text-green-400 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Bull
          </button>
          <button
            onClick={() => changeRegime('bear')}
            disabled={regime === 'bear'}
            className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Bear
          </button>
          <button
            onClick={() => changeRegime('sideways')}
            disabled={regime === 'sideways'}
            className="px-2 py-1 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Chop
          </button>
        </div>
      </div>
    </div>
  );
}
