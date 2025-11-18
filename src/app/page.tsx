/**
 * Market Simulation Dashboard
 *
 * Main page that composes all trading components into a professional trading view.
 * Uses the useMarketSimulation hook to manage simulation state and provides
 * a comprehensive view of the market including chart, order book, trades, and controls.
 *
 * Layout:
 * - Top: Market stats and controls
 * - Center: Large candlestick chart
 * - Right: Order book and recent trades feed
 */

'use client';

import { useState } from 'react';
import { useMarketSimulation } from '@/hooks/useMarketSimulation';
import { TradingChart } from '@/components/TradingChart';
import { OrderBook } from '@/components/OrderBook';
import { TradesFeed } from '@/components/TradesFeed';
import { MarketStats } from '@/components/MarketStats';
import { SimulationControls } from '@/components/SimulationControls';
import { TradingBar } from '@/components/TradingBar';

export default function Home() {
  // Initialize market simulation
  const simulation = useMarketSimulation();

  // Drawing tools visibility state
  const [showDrawingTools, setShowDrawingTools] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Fixed Trading Bar at Top */}
      <TradingBar
        portfolio={simulation.portfolio}
        currentPrice={simulation.stats.lastPrice}
        isSimulationRunning={simulation.isRunning}
        onPlaceOrder={simulation.placeOrder}
        onTogglePause={simulation.togglePause}
        onToggleDrawingTools={() => setShowDrawingTools(!showDrawingTools)}
        showDrawingTools={showDrawingTools}
      />

      {/* Main Content - Add padding-top to account for fixed trading bar */}
      <div className="pt-20 p-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Market Simulator</h1>
        <p className="text-sm text-gray-400">
          Real-time order book-driven price simulation
        </p>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
        {/* Left Column - Chart and Stats */}
        <div className="col-span-9 flex flex-col gap-4">
          {/* Market Stats */}
          <div className="h-32">
            <MarketStats stats={simulation.stats} />
          </div>

          {/* Trading Chart - Takes up remaining space */}
          <div className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <TradingChart
              bars={simulation.bars}
              currentBar={simulation.currentBar}
              showDrawingTools={showDrawingTools}
            />
          </div>
        </div>

        {/* Right Column - Order Book, Trades, Controls */}
        <div className="col-span-3 flex flex-col gap-4 h-full">
          {/* Order Book */}
          <div className="flex-[45] min-h-0">
            <OrderBook orderBook={simulation.orderBook} />
          </div>

          {/* Trades Feed */}
          <div className="flex-[30] min-h-0">
            <TradesFeed trades={simulation.trades} />
          </div>

          {/* Simulation Controls */}
          <div className="flex-[25] min-h-0">
            <SimulationControls
              isRunning={simulation.isRunning}
              speed={simulation.speed}
              regime={simulation.regime}
              onTogglePause={simulation.togglePause}
              onSetSpeed={simulation.setSpeed}
              onInjectEvent={simulation.injectEvent}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
