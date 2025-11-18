'use client';

import { useState } from 'react';
import { Portfolio, OrderType, OrderSide } from '@/types/market';

/**
 * Props for the TradingBar component
 * Receives portfolio state and callbacks for trading actions
 */
interface TradingBarProps {
  portfolio: Portfolio;
  currentPrice: number;
  isSimulationRunning: boolean;
  onPlaceOrder: (side: OrderSide, type: OrderType, size: number, price?: number) => void;
  onTogglePause: () => void;
  onToggleDrawingTools: () => void;
  showDrawingTools: boolean;
}

/**
 * TradingBar - Fixed top bar for trading controls and portfolio display
 *
 * Features:
 * - BUY/SELL buttons for quick order placement
 * - Quantity input for order sizing
 * - Order type selection (Market/Limit/Stop)
 * - Conditional price inputs based on order type
 * - Pause/Resume simulation control
 * - Drawing tools toggle
 * - Real-time portfolio value and P&L display
 */
export function TradingBar({
  portfolio,
  currentPrice,
  isSimulationRunning,
  onPlaceOrder,
  onTogglePause,
  onToggleDrawingTools,
  showDrawingTools,
}: TradingBarProps) {
  // Order entry state
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [quantity, setQuantity] = useState<number>(100);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');

  /**
   * Handle BUY button click
   * Places a buy order with current settings
   */
  const handleBuy = () => {
    const price = orderType === 'limit' ? parseFloat(limitPrice) :
                  orderType === 'stop' ? parseFloat(stopPrice) :
                  undefined;

    // Validate inputs
    if (quantity <= 0) {
      alert('Quantity must be greater than 0');
      return;
    }

    if (orderType === 'limit' && (!price || price <= 0)) {
      alert('Please enter a valid limit price');
      return;
    }

    if (orderType === 'stop' && (!price || price <= 0)) {
      alert('Please enter a valid stop price');
      return;
    }

    // Check if user has enough cash for buy orders (long positions require capital)
    const estimatedCost = quantity * (price || currentPrice);
    if (estimatedCost > portfolio.cash) {
      const shortfall = estimatedCost - portfolio.cash;
      alert(
        `Insufficient funds.\n\n` +
        `Required: $${estimatedCost.toFixed(2)}\n` +
        `Available: $${portfolio.cash.toFixed(2)}\n` +
        `Shortfall: $${shortfall.toFixed(2)}`
      );
      return;
    }

    onPlaceOrder('buy', orderType, quantity, price);
  };

  /**
   * Handle SELL button click
   * Places a sell order with current settings
   *
   * Note: Short sales (opening new short positions) do NOT require cash.
   * You receive cash when shorting, and need cash later when covering.
   */
  const handleSell = () => {
    const price = orderType === 'limit' ? parseFloat(limitPrice) :
                  orderType === 'stop' ? parseFloat(stopPrice) :
                  undefined;

    // Validate inputs
    if (quantity <= 0) {
      alert('Quantity must be greater than 0');
      return;
    }

    if (orderType === 'limit' && (!price || price <= 0)) {
      alert('Please enter a valid limit price');
      return;
    }

    if (orderType === 'stop' && (!price || price <= 0)) {
      alert('Please enter a valid stop price');
      return;
    }

    // No cash requirement for short sales - you receive cash when shorting
    // Cash is only needed later when covering (buying back) the short position

    onPlaceOrder('sell', orderType, quantity, price);
  };

  /**
   * Format currency with proper decimal places
   */
  const formatCurrency = (value: number): string => {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  /**
   * Calculate total P&L (realized + unrealized)
   */
  const totalPnL = portfolio.realizedPnL + portfolio.unrealizedPnL;
  const pnlPercentage = ((totalPnL / 100000) * 100).toFixed(2);
  const isProfitable = totalPnL >= 0;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a] border-b border-[#2a2a2a] shadow-lg">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Left Section: Order Entry Controls */}
          <div className="flex items-center gap-4">
            {/* Order Type Selector */}
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-sm">Type:</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType)}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
              </select>
            </div>

            {/* Quantity Input */}
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-sm">Qty:</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                min="1"
                step="1"
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-white text-sm w-24 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Conditional Price Input for Limit Orders */}
            {orderType === 'limit' && (
              <div className="flex items-center gap-2">
                <label className="text-gray-400 text-sm">Limit Price:</label>
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={currentPrice.toFixed(2)}
                  step="0.01"
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-white text-sm w-28 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {/* Conditional Price Input for Stop Orders */}
            {orderType === 'stop' && (
              <div className="flex items-center gap-2">
                <label className="text-gray-400 text-sm">Stop Price:</label>
                <input
                  type="number"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                  placeholder={currentPrice.toFixed(2)}
                  step="0.01"
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-white text-sm w-28 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            {/* BUY Button */}
            <button
              onClick={handleBuy}
              disabled={!isSimulationRunning}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold px-6 py-1.5 rounded transition-colors"
            >
              BUY
            </button>

            {/* SELL Button */}
            <button
              onClick={handleSell}
              disabled={!isSimulationRunning}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold px-6 py-1.5 rounded transition-colors"
            >
              SELL
            </button>
          </div>

          {/* Center Section: Simulation Controls */}
          <div className="flex items-center gap-4">
            {/* Pause/Resume Button */}
            <button
              onClick={onTogglePause}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-1.5 rounded transition-colors"
            >
              {isSimulationRunning ? '⏸ Pause' : '▶ Resume'}
            </button>

            {/* Drawing Tools Toggle */}
            <button
              onClick={onToggleDrawingTools}
              className={`${
                showDrawingTools ? 'bg-orange-600' : 'bg-gray-700'
              } hover:bg-orange-700 text-white font-semibold px-5 py-1.5 rounded transition-colors`}
            >
              ✏ Drawing Tools
            </button>
          </div>

          {/* Right Section: Portfolio Display */}
          <div className="flex items-center gap-6">
            {/* Total Equity */}
            <div className="text-right">
              <div className="text-gray-400 text-xs">Portfolio Value</div>
              <div className="text-white font-mono text-lg font-semibold">
                {formatCurrency(portfolio.totalEquity)}
              </div>
            </div>

            {/* P&L Display */}
            <div className="text-right">
              <div className="text-gray-400 text-xs">Total P&L</div>
              <div className={`font-mono text-lg font-semibold ${
                isProfitable ? 'text-green-400' : 'text-red-400'
              }`}>
                {isProfitable ? '+' : ''}{formatCurrency(totalPnL)}
                <span className="text-sm ml-2">
                  ({isProfitable ? '+' : ''}{pnlPercentage}%)
                </span>
              </div>
            </div>

            {/* Available Cash */}
            <div className="text-right border-l border-[#2a2a2a] pl-6">
              <div className="text-gray-400 text-xs">Available Cash</div>
              <div className="text-white font-mono text-sm">
                {formatCurrency(portfolio.cash)}
              </div>
            </div>

            {/* Active Positions Count */}
            {portfolio.positions.length > 0 && (
              <div className="text-right">
                <div className="text-gray-400 text-xs">Positions</div>
                <div className="text-white font-mono text-sm">
                  {portfolio.positions.length}
                </div>
              </div>
            )}

            {/* Active Orders Count */}
            {portfolio.activeOrders.length > 0 && (
              <div className="text-right">
                <div className="text-gray-400 text-xs">Active Orders</div>
                <div className="text-blue-400 font-mono text-sm">
                  {portfolio.activeOrders.length}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
