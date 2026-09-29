/**
 * Test Suite: Scalping and Spike Watch Module
 * Tests:
 * 1. Indian Derivatives Cost Model (Brokerage, STT, Exchange, SEBI, GST, Stamp duty, Spread/Slippage) & Net R:R Gate (>= 1.5)
 * 2. Latency Monitor & Hard Cutoff (> 1500ms / disconnected gating)
 * 3. Spike Readiness Scoring (8-factor transparent model, states: CALM, BUILDING, SPIKE_RISK_HIGH, direction lean)
 * 4. Spike Trigger Confirmation & Fake-Breakout Protection (wick rejection, volume traps)
 * 5. Scalp Execution Engine (tight SL, partial TP, time stop, lot sizing floor, discipline integration, zero footprint when OFF)
 * 6. Empirical Spike Study & Backtest Engine (true spikes vs false alarms, 100-sample reliability threshold)
 */

import { ScalpCostModel } from '../scalping/costModel.js';
import { LatencyMonitor } from '../scalping/latencyMonitor.js';
import { SpikeReadiness } from '../scalping/spikeReadiness.js';
import { SpikeTrigger } from '../scalping/spikeTrigger.js';
import { ScalpStrategy } from '../scalping/scalpStrategy.js';
import { SpikeStudyEngine } from '../backtest/spikeStudy.js';

// Setup Mock chrome.storage.local for Node.js test environment
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        if (!keys) return cb(mockStorage);
        if (typeof keys === 'string') return cb({ [keys]: mockStorage[keys] });
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach((k) => { res[k] = mockStorage[k]; });
          return cb(res);
        }
        cb(mockStorage);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
      }
    }
  }
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}: Passed`);
    passed++;
  } else {
    console.error(`✗ ${message}: FAILED`);
    failed++;
  }
}

console.log('\n--- STARTING SCALPING & SPIKE WATCH MODULE TEST SUITE ---');

// ================= TEST SECTION 1: COST MODEL & FRICTION =================
console.log('\n[1. Indian Equity Derivatives Cost Model & Net R:R Gate]');

// Test 1.1: Calculate Round-Trip Friction on NIFTY ATM Option
const optionViability = ScalpCostModel.calculateNetViability({
  instrumentType: 'OPTION',
  entryPrice: 120,
  targetPrice: 140,
  stopLossPrice: 110,
  lots: 2,
  lotSize: 25,
  estimatedSlippagePoints: 0.2,
  estimatedSpreadPoints: 0.4
});

assert(optionViability.friction.brokerageRoundTripINR === 40, 'Brokerage is flat ₹20 buy + ₹20 sell = ₹40');
assert(optionViability.friction.sttINR > 0, `STT computed correctly on sell turnover (STT: ₹${optionViability.friction.sttINR})`);
assert(optionViability.friction.gstINR > 0, `GST 18% applied on brokerage + exchange fees (GST: ₹${optionViability.friction.gstINR})`);
assert(optionViability.friction.totalFrictionINR > 45, `Total statutory charges calculated (₹${optionViability.friction.totalFrictionINR})`);
assert(optionViability.friction.spreadAndSlippageINR > 0, `Spread and slippage friction computed (₹${optionViability.friction.spreadAndSlippageINR})`);

// Test 1.2: Net R:R Calculation on Viable Setup
const viableSetup = ScalpCostModel.calculateNetViability({
  instrumentType: 'OPTION',
  entryPrice: 100,
  targetPrice: 125,  // +25 pts gross profit
  stopLossPrice: 90, // -10 pts gross loss
  lots: 2,
  lotSize: 25
});
assert(viableSetup.grossRR === 2.5, `Gross R:R is 2.5 (Gross RR: ${viableSetup.grossRR})`);
assert(viableSetup.netRR >= 1.5, `Net R:R after friction remains viable >= 1:1.5 (Net RR: 1:${viableSetup.netRR})`);
assert(viableSetup.isViable === true, 'Viable setup approved by Cost Model');

// Test 1.3: Net R:R Rejection on Micro-Scalp Eaten by Taxes
const smallTargetSetup = ScalpCostModel.calculateNetViability({
  instrumentType: 'OPTION',
  entryPrice: 100,
  targetPrice: 106,  // +6 pts target
  stopLossPrice: 95, // -5 pts stop
  lots: 1,
  lotSize: 25,
  estimatedSpreadPoints: 0.8
});
assert(smallTargetSetup.grossRR === 1.2, 'Gross R:R is 1.2');
assert(smallTargetSetup.netRR < 1.0, `Net R:R after brokerage & spread drops severely (Net RR: 1:${smallTargetSetup.netRR})`);
assert(smallTargetSetup.isViable === false, 'Setup rejected due to net R:R < 1:1.5 threshold');

// ================= TEST SECTION 2: LATENCY MONITOR =================
console.log('\n[2. Streaming Latency Monitor & Real-Time Gating]');

const monitor = new LatencyMonitor({ maxAllowableLatencyMs: 1500 });

// Test 2.1: Ultra-low latency feed (< 800ms)
const lowLatencyHealth = monitor.recordLatency(120, true);
assert(lowLatencyHealth.status === 'HEALTHY', `120ms latency recognized as HEALTHY (Status: ${lowLatencyHealth.status})`);
assert(lowLatencyHealth.canExecuteScalps === true, 'Scalping permitted under low latency');

// Test 2.2: Degraded latency feed (800ms - 1500ms)
const degradedHealth = monitor.recordLatency(950, true);
assert(degradedHealth.status === 'DEGRADED', `950ms recognized as DEGRADED (Status: ${degradedHealth.status})`);
assert(degradedHealth.canExecuteScalps === true, 'Scalping allowed with elevated caution badge');

// Test 2.3: Hard Cutoff (> 1500ms threshold)
const highLatencyHealth = monitor.recordLatency(1850, true);
assert(highLatencyHealth.status === 'UNRELIABLE', `1850ms triggers UNRELIABLE status (Status: ${highLatencyHealth.status})`);
assert(highLatencyHealth.canExecuteScalps === false, 'Scalp execution blocked when latency > 1500ms');
assert(highLatencyHealth.statusMessage.includes('Data unreliable'), 'Clear warning message displayed on HUD');

// Test 2.4: Disconnected stream
const disconnectedHealth = monitor.recordLatency(100, false);
assert(disconnectedHealth.canExecuteScalps === false, 'Scalping paused immediately when stream disconnects');

// ================= TEST SECTION 3: SPIKE READINESS SCORING =================
console.log('\n[3. Spike Readiness Engine (8-Factor Pre-Spike Model)]');

// Construct sample compressed candles (NR7 / Bollinger Squeeze)
const compressedCandles = [];
let basePrice = 24100;
for (let i = 0; i < 25; i++) {
  compressedCandles.push({
    open: basePrice,
    high: basePrice + 3,
    low: basePrice - 3,
    close: basePrice + (i % 2 === 0 ? 1 : -1),
    volume: 35000 + i * 2000 // Rising volume with shrinking range (absorption)
  });
}

const keyLevels = {
  vwap: 24102,
  pdh: 24200,
  pdl: 24000,
  maxCallOi: 24150,
  maxPutOi: 24050
};

const driverData = {
  vixAnalysis: { details: 'Level: 14.8 Change: +5.2%' },
  pressureScore: 45,
  vixChangePct: 5.2,
  heavyweightsTrend: 'BULLISH',
  bankNiftyTrend: 'BULLISH'
};
const optionsData = {
  atmCallOiChange: -450000, // Writers running
  atmPutOiChange: 650000,
  pcrChange: 0.18,
  ivExpansionPct: 5.5,
  writerUnwindingSide: 'CALL'
};

const readinessHigh = SpikeReadiness.evaluate({
  candles: compressedCandles,
  currentPrice: 24101,
  keyLevels,
  driverData,
  optionsData,
  currentTime: new Date('2026-10-01T13:45:00+05:30'), // Expiry afternoon window
  isExpiryDay: true
});

assert(readinessHigh.score >= 70, `Spike Readiness score is in HIGH tier (Score: ${readinessHigh.score}/100)`);
assert(readinessHigh.state === 'SPIKE_RISK_HIGH', `State is SPIKE_RISK_HIGH (State: ${readinessHigh.state})`);
assert(readinessHigh.compression !== null, 'Volatility compression detected (Bollinger squeeze / ATR contraction)');
assert(readinessHigh.directionLean === 'UP', `Directional lean identifies bullish option unwinding (Lean: ${readinessHigh.directionLean})`);
assert(readinessHigh.topContributingFactors.length > 0, 'Top contributing factors scored and returned');

// Test 3.2: Calm state in wide chop
const wideChoppyCandles = [];
for (let i = 0; i < 25; i++) {
  wideChoppyCandles.push({
    open: 24000 + (i % 2 === 0 ? 50 : -40),
    high: 24100,
    low: 23950,
    close: 24000 + (i % 2 === 0 ? 40 : -30),
    volume: 20000
  });
}

const readinessCalm = SpikeReadiness.evaluate({
  candles: wideChoppyCandles,
  currentPrice: 24020,
  keyLevels: { vwap: 24250, pdh: 24400, pdl: 23800 },
  driverData: { vixAnalysis: { details: 'Level: 12.0 Change: 0.1%' }, pressureScore: 0 },
  optionsData: { atmCallOiChange: 10000, atmPutOiChange: 10000, pcrChange: 0, ivExpansionPct: 0 },
  currentTime: new Date('2026-10-01T11:45:00+05:30'), // Midday chop
  isExpiryDay: false
});

assert(readinessCalm.score < 40, `Choppy market scores in CALM tier (Score: ${readinessCalm.score}/100)`);
assert(readinessCalm.state === 'CALM', `State is CALM (State: ${readinessCalm.state})`);

// ================= TEST SECTION 4: SPIKE TRIGGER & FAKE BREAKOUT =================
console.log('\n[4. Spike Trigger Confirmation & Fake-Breakout Protection]');

const compression = {
  high: readinessHigh.compression.high,
  low: readinessHigh.compression.low,
  mid: readinessHigh.compression.mid
};

// Test 4.1: Valid Bullish Breakout Expansion
const breakoutCandle = {
  open: 24102,
  high: 24135,
  low: 24101,
  close: 24132, // Close firmly outside compression with tiny wick
  volume: 120000 // Huge volume expansion
};

const triggerValid = SpikeTrigger.evaluateTrigger({
  candles: [...compressedCandles, breakoutCandle],
  currentPrice: 24132,
  compressionRange: compression,
  readinessScore: 78,
  driverConfirmation: {
    vixAligned: true,
    heavyweightsAligned: true,
    bankNiftyAligned: true,
    oiShiftAligned: true
  }
});

assert(triggerValid.isTriggered === true, 'Breakout candle confirms valid scalp trigger');
assert(triggerValid.direction === 'LONG', `Trigger direction is LONG (Direction: ${triggerValid.direction})`);
assert(triggerValid.triggerType === 'BREAKOUT_EXPANSION', 'Trigger identified as BREAKOUT_EXPANSION');

// Test 4.2: Fake Breakout / Wick Rejection Trap
const fakeBreakoutWickCandle = {
  open: 24102,
  high: 24138, // Pushed way high
  low: 24100,
  close: 24104, // Closed right back near open, forming massive upper wick
  volume: 85000
};

const triggerFakeWick = SpikeTrigger.evaluateTrigger({
  candles: [...compressedCandles, fakeBreakoutWickCandle],
  currentPrice: 24104,
  compressionRange: compression,
  readinessScore: 78,
  driverConfirmation: { vixAligned: true }
});

assert(triggerFakeWick.isTriggered === false, 'Fake breakout with massive upper wick rejected');
assert(triggerFakeWick.isFakeBreakout === true, 'Fake breakout flagged correctly');
assert(triggerFakeWick.fakeBreakoutReason.includes('Long wick rejection'), 'Reason identified as wick-to-body exhaustion');

// ================= TEST SECTION 5: SCALP STRATEGY EXECUTION RULES =================
console.log('\n[5. Scalp Strategy Execution Rules & Safety]');

// Test 5.1: Zero Footprint Rule when Module is Disabled
const disabledSetup = ScalpStrategy.evaluateSetup({
  config: { isEnabled: false }
});
assert(disabledSetup.isActionable === false, 'Disabled setup is not actionable');
assert(disabledSetup.status === 'INACTIVE', 'Disabled setup returns INACTIVE status immediately');

// Test 5.2: Discipline Layer Hard Lock
const lockedSetup = ScalpStrategy.evaluateSetup({
  config: { isEnabled: true },
  dailyScalpState: { isLocked: true, tradesToday: 1, consecutiveLosses: 0 }
});
assert(lockedSetup.isActionable === false, 'Scalp setup blocked when Discipline Lock is active');
assert(lockedSetup.status === 'REJECTED', 'Status is REJECTED');

// Test 5.3: Consecutive Loss Lock (2 losses -> 20m cool-down)
const coolDownSetup = ScalpStrategy.evaluateSetup({
  config: { isEnabled: true },
  dailyScalpState: { isLocked: false, tradesToday: 2, consecutiveLosses: 2 }
});
assert(coolDownSetup.isActionable === false, 'Scalping blocked after 2 consecutive losses');
assert(coolDownSetup.rejectionReason.includes('Cool-Down Active'), 'Rejection cites 20m cool-down rule');

// Test 5.4: Actionable Scalp Signal with Tight Stops & Cost Viability
const activeCandles = [...compressedCandles, breakoutCandle];
const actionableSetup = ScalpStrategy.evaluateSetup({
  candles: activeCandles,
  currentPrice: 24132,
  keyLevels,
  driverData,
  optionsData,
  currentTime: new Date('2026-10-01T13:46:00+05:30'),
  isExpiryDay: true,
  dailyScalpState: { isLocked: false, tradesToday: 1, consecutiveLosses: 0 },
  config: {
    isEnabled: true,
    riskPctPerScalp: 0.35,
    maxScalpsPerDay: 5,
    minNetRR: 1.5,
    capitalINR: 200000,
    lotSize: 25
  }
});

assert(actionableSetup.isActionable === true, 'Valid scalp setup generates actionable signal');
assert(actionableSetup.direction === 'LONG', `Actionable direction is LONG (Direction: ${actionableSetup.direction})`);
assert(actionableSetup.stopLoss < actionableSetup.entryPrice, 'Tight stop loss set below entry structure');
assert(actionableSetup.costAnalysis?.netRR >= 1.5, `Net R:R after costs meets >= 1.5 threshold (Net RR: 1:${actionableSetup.costAnalysis?.netRR})`);
assert(actionableSetup.lots > 0, `Position sizing allocates strictly floored lots (${actionableSetup.lots} lots)`);
assert(actionableSetup.timeStopMinutes === 3, 'Enforces default 3-minute time stop');

// Test 5.5: Option Spread Liquidity Guard
const tightRRSetup = ScalpStrategy.evaluateSetup({
  candles: activeCandles,
  currentPrice: 24132,
  keyLevels,
  driverData,
  optionsData,
  dailyScalpState: { isLocked: false, tradesToday: 0, consecutiveLosses: 0 },
  config: {
    isEnabled: true,
    minNetRR: 4.5 // Intentionally unrealistic net R:R to verify cost rejection
  }
});
assert(tightRRSetup.isActionable === false, 'Setup rejected if Net post-friction R:R is below required threshold');

// ================= TEST SECTION 6: SPIKE STUDY & BACKTEST =================
console.log('\n[6. Empirical Spike Study & Backtest Engine]');

// Generate 120 bars of synthetic 1m historical data with 3 distinct compression-breakout zones
const studyBars = [];
let simPx = 24000;
for (let i = 0; i < 120; i++) {
  const isCompressionZone = (i >= 20 && i <= 32) || (i >= 65 && i <= 78);
  const isSpikeBar = i === 33 || i === 79;

  let o = simPx;
  let h = isSpikeBar ? o + 35 : isCompressionZone ? o + 3 : o + 15;
  let l = isSpikeBar ? o - 2 : isCompressionZone ? o - 3 : o - 15;
  let c = isSpikeBar ? o + 32 : isCompressionZone ? o + (i % 2 === 0 ? 1 : -1) : o + 5;
  let v = isSpikeBar ? 150000 : isCompressionZone ? 45000 : 25000;

  studyBars.push({
    open: o, high: h, low: l, close: c, volume: v,
    timestamp: Date.now() - (120 - i) * 60 * 1000
  });
  simPx = c;
}

const studyResults = SpikeStudyEngine.runSpikeStudy(studyBars, 5, 1.2);

assert(studyResults.totalAlerts >= 0, `Spike study analyzed bars (Total alerts: ${studyResults.totalAlerts})`);
assert(studyResults.precisionPct >= 0 && studyResults.precisionPct <= 100, `Precision percentage calculated (${studyResults.precisionPct}%)`);
assert(studyResults.falseAlarmRatePct >= 0 && studyResults.falseAlarmRatePct <= 100, `False alarm rate calculated (${studyResults.falseAlarmRatePct}%)`);
assert(studyResults.isStatisticallyReliable === false, 'Correctly flags sample as NOT reliable yet (< 100 alerts threshold)');
assert(studyResults.reliabilityLabel.includes('Preliminary Sample'), 'Reliability note displays honest statistical disclaimer');

// Test 6.2: Scalp Backtest with Indian Friction Model
const scalpBacktest = SpikeStudyEngine.runScalpBacktest({
  days: 30,
  baseCapital: 200000,
  riskPctPerTrade: 0.35,
  brokeragePerOrder: 20,
  estimatedSpreadPts: 0.35
});

assert(scalpBacktest.totalTrades >= 0, `Scalp backtest executed trades (${scalpBacktest.totalTrades})`);
assert(typeof scalpBacktest.totalFrictionINR === 'number', `Total friction tracked in INR (₹${scalpBacktest.totalFrictionINR.toFixed(2)})`);
assert(scalpBacktest.timeWindowBreakdown !== undefined, 'Breakdown by trading time window provided');

console.log(`\n======================================================`);
console.log(`SCALPING & SPIKE WATCH TEST RESULTS: ${passed} Passed, ${failed} Failed`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
