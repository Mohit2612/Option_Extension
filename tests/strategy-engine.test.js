/**
 * Unit Test Suite for Nifty Strategy Engine
 */

import { StrategyEngine } from '../strategies/strategy-engine.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('--- STARTING STRATEGY ENGINE TEST SUITE ---');

// 1. First 5-Minutes No-Trade Filter Test (09:16 AM)
{
  const time916 = new Date();
  time916.setHours(9, 16, 0, 0);

  const mockCandles = [
    { open: 24100, high: 24150, low: 24090, close: 24140, volume: 50000 },
    { open: 24140, high: 24160, low: 24130, close: 24155, volume: 60000 },
    { open: 24155, high: 24180, low: 24150, close: 24175, volume: 70000 },
    { open: 24175, high: 24190, low: 24165, close: 24185, volume: 55000 },
    { open: 24185, high: 24200, low: 24180, close: 24195, volume: 80000 }
  ];

  const res = StrategyEngine.evaluateSetup({
    candles: mockCandles,
    currentTime: time916,
    dailyLossCount: 0
  });

  assert(res.signal === 'WAIT', 'Signal must be WAIT during opening 5 minutes');
  assert(res.filterReason && res.filterReason.includes('09:15-09:20'), 'Filter reason must cite 09:15-09:20 buffer');
  console.log('✓ 1. Opening 5-Min Volatility Filter (09:16 AM): Passed');
}

// 2. Max 2 Daily Losses Hard Filter Test
{
  const time1030 = new Date();
  time1030.setHours(10, 30, 0, 0);

  const mockCandles = [
    { open: 24100, high: 24150, low: 24090, close: 24140, volume: 50000 },
    { open: 24140, high: 24160, low: 24130, close: 24155, volume: 60000 },
    { open: 24155, high: 24180, low: 24150, close: 24175, volume: 70000 },
    { open: 24175, high: 24190, low: 24165, close: 24185, volume: 55000 },
    { open: 24185, high: 24200, low: 24180, close: 24195, volume: 80000 }
  ];

  const res = StrategyEngine.evaluateSetup({
    candles: mockCandles,
    currentTime: time1030,
    dailyLossCount: 2 // Max loss hit
  });

  assert(res.signal === 'WAIT', 'Signal must be WAIT when 2 consecutive losses hit');
  assert(res.filterReason && res.filterReason.includes('2 consecutive losses'), 'Filter reason must cite daily loss limit');
  console.log('✓ 2. Max 2 Consecutive Daily Losses Filter: Passed');
}

// 3. Opening Range Breakout (ORB) Bullish Trigger Test
{
  const time1000 = new Date();
  time1000.setHours(10, 0, 0, 0);

  const mockCandles = [
    { open: 24100, high: 24140, low: 24090, close: 24130, volume: 50000 },
    { open: 24130, high: 24150, low: 24120, close: 24145, volume: 45000 },
    { open: 24145, high: 24160, low: 24140, close: 24150, volume: 40000 },
    { open: 24150, high: 24165, low: 24145, close: 24155, volume: 42000 },
    { open: 24155, high: 24220, low: 24150, close: 24215, volume: 95000 } // Clean breakout above ORH 24160
  ];

  const keyLevels = { orh: 24160, orl: 24080, vwap: 24145 };
  const driverData = { pressureScore: 45, vixAnalysis: { details: 'Level: 13.5' } };

  const res = StrategyEngine.evaluateSetup({
    candles: mockCandles,
    keyLevels,
    driverData,
    currentTime: time1000,
    dailyLossCount: 0,
    userConfig: {
      strategies: { vwapReversion: { enabled: false } } // isolate ORB
    }
  });

  assert(res.signal === 'BUY', 'Signal must be BUY for bullish ORB breakout');
  assert(res.strategyName.includes('Opening Range Breakout'), 'Strategy name should be ORB');
  assert(res.riskRewardRatio >= 2.0, 'R:R must be >= 2.0');
  assert(res.optionsSuggestion !== null, 'Options suggestion must be provided for BUY');
  console.log('✓ 3. Opening Range Breakout (ORB) Bullish Setup: Passed');
}

// 4. S/R Liquidity Sweep Reversal Test (Sell-Side Trap below PDL)
{
  const time1100 = new Date();
  time1100.setHours(11, 0, 0, 0);

  // PDL is 24000. Price sweeps to 23970, then closes back at 24025 with strong rejection hammer
  const mockCandles = [
    { open: 24080, high: 24090, low: 24040, close: 24045, volume: 40000 },
    { open: 24045, high: 24050, low: 24010, close: 24015, volume: 45000 },
    { open: 24015, high: 24020, low: 23990, close: 23995, volume: 50000 },
    { open: 23995, high: 24005, low: 23980, close: 23985, volume: 48000 },
    { open: 23985, high: 24030, low: 23970, close: 24025, volume: 98000 } // Hammer sweeping PDL (24000)
  ];

  const keyLevels = { pdh: 24250, pdl: 24000, vwap: 24030 };
  const driverData = { pressureScore: 15, vixAnalysis: { details: 'Level: 14.1' } };

  const res = StrategyEngine.evaluateSetup({
    candles: mockCandles,
    keyLevels,
    driverData,
    currentTime: time1100,
    dailyLossCount: 0
  });

  assert(res.signal === 'BUY', 'Signal must be BUY for liquidity sweep reversal');
  assert(res.strategyName.includes('Liquidity Sweep'), 'Strategy name should be Liquidity Sweep');
  assert(res.riskRewardRatio >= 2.0, 'R:R must be >= 2.0');
  console.log('✓ 4. S/R Liquidity Sweep Reversal Setup: Passed');
}

console.log('\n ALL STRATEGY ENGINE UNIT TESTS PASSED WITH 100% SUCCESS!\n');
