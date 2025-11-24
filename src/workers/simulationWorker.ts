/**
 * Market Simulation Web Worker
 *
 * Runs the OrderFlowSimulator in a background thread to improve performance.
 * Frees the main thread for UI rendering and user interactions.
 *
 * PERFORMANCE BENEFITS:
 * ====================
 * - Main thread freed for UI responsiveness
 * - Can run at 10x-20x speeds without lag
 * - Simulation runs on separate CPU core (browser optimization)
 * - No interference with chart interactions or React rendering
 *
 * MESSAGE PROTOCOL:
 * =================
 * Main Thread → Worker:
 * - START: { type: 'START', initialPrice: number }
 * - PAUSE: { type: 'PAUSE' }
 * - RESUME: { type: 'RESUME' }
 * - SPEED: { type: 'SPEED', speed: number }
 * - REGIME: { type: 'REGIME', regime: MarketRegime }
 * - EVENT: { type: 'EVENT', event: MarketEvent }
 *
 * Worker → Main Thread:
 * - STATE_UPDATE: { type: 'STATE_UPDATE', payload: SimulationSnapshot }
 * - ERROR: { type: 'ERROR', error: string }
 */

import { OrderFlowSimulator } from '../lib/OrderFlowSimulator';
import { MarketEvent, MarketRegime } from '../types/market';

// Worker state
let simulator: OrderFlowSimulator | null = null;
let intervalId: number | null = null;
let isRunning = false;
let currentSpeed = 1.0;
const BASE_INTERVAL_MS = 250; // 4 bars per second at 1x speed
const STEPS_PER_BAR = 12; // Sub-steps for smooth price generation

/**
 * Simulation snapshot to send to main thread
 * Contains all data needed for UI rendering
 */
interface SimulationSnapshot {
  bars: ReturnType<OrderFlowSimulator['getBars']>;
  trades: ReturnType<OrderFlowSimulator['getTrades']>;
  orderBook: ReturnType<OrderFlowSimulator['getOrderBookSnapshot']>;
  regime: MarketRegime;
  timestamp: number;
}

/**
 * Run one simulation step and send update to main thread
 * This is called every BASE_INTERVAL_MS / speed milliseconds
 */
function runSimulationStep(): void {
  if (!simulator || !isRunning) return;

  try {
    // Generate multiple sub-steps per bar for smooth OHLC variation
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      simulator.simulateStep();
    }

    // Close bar after all steps (creates OHLC from actual trades)
    simulator.closeCurrentBar();

    // Create snapshot of current state
    const snapshot: SimulationSnapshot = {
      bars: simulator.getBars(),
      trades: simulator.getTrades(50), // Last 50 trades
      orderBook: simulator.getOrderBookSnapshot(),
      regime: simulator.getRegime(),
      timestamp: Date.now(),
    };

    // Send state update to main thread
    self.postMessage({
      type: 'STATE_UPDATE',
      payload: snapshot,
    });
  } catch (error) {
    // Send error to main thread
    self.postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the simulation loop
 * Uses setInterval to run at specified speed
 */
function startSimulationLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
  }

  const interval = BASE_INTERVAL_MS / currentSpeed;
  intervalId = setInterval(runSimulationStep, interval) as unknown as number;
  isRunning = true;
}

/**
 * Stop the simulation loop
 */
function stopSimulationLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
}

/**
 * Message handler - processes commands from main thread
 */
self.onmessage = (event: MessageEvent) => {
  const { type, ...data } = event.data;

  switch (type) {
    case 'START':
      // Initialize simulator and start simulation
      if (!simulator) {
        simulator = new OrderFlowSimulator(data.initialPrice || 100);
      }
      startSimulationLoop();
      break;

    case 'PAUSE':
      // Pause simulation (keep simulator state)
      stopSimulationLoop();
      break;

    case 'RESUME':
      // Resume simulation from current state
      if (simulator) {
        startSimulationLoop();
      }
      break;

    case 'SPEED':
      // Change simulation speed
      if (typeof data.speed === 'number') {
        currentSpeed = Math.max(0.1, Math.min(20, data.speed)); // Allow up to 20x speed
        if (isRunning) {
          // Restart loop with new interval
          startSimulationLoop();
        }
      }
      break;

    case 'REGIME':
      // Change market regime
      if (simulator && data.regime) {
        simulator.setRegime(data.regime);
      }
      break;

    case 'EVENT':
      // Inject market event (flash crash, circuit breaker, etc.)
      if (simulator && data.event) {
        simulator.injectEvent(data.event as MarketEvent);
        // Send immediate update after event
        if (isRunning) {
          runSimulationStep();
        }
      }
      break;

    default:
      self.postMessage({
        type: 'ERROR',
        error: `Unknown message type: ${type}`,
      });
  }
};

// Send ready message to main thread
self.postMessage({ type: 'READY' });
