/**
 * Test Suite: Module 3 - Trade Quality Scorer (A / B / C Grading)
 * Tests all 8 weighted factors, score calculations, Grade A / B / C thresholds,
 * Grade B reduced sizing, Grade B disablement, and Grade C skips.
 */

import { TradeQualityScorer } from '../services/tradeQualityScorer.js';
import { DisciplineStateMachine } from '../services/disciplineStateMachine.js';

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

console.log('\n--- STARTING TRADE QUALITY SCORER (MODULE 3) TESTS ---');

// Helper to generate candles with volume
function mockCandles(count = 20, lastClose = 24100, trend = 'bullish', volMultiplier = 1.0) {
  const candles = [];
  let p = lastClose - (trend === 'bullish' ? count * 3 : -count * 3);
  for (let i = 0; i < count; i++) {
    const o = p;
    const step = trend === 'bullish' ? 3 : trend === 'bearish' ? -3 : 0;
    const c = o + step;
    const h = Math.max(o, c) + 5;
    const l = Math.min(o, c) - 5;
    const volume = Math.round(40000 * (i === count - 1 ? volMultiplier : 1.0));
    candles.push({ open: o, high: h, low: l, close: c, volume });
    p = c;
  }
  return candles;
}

// 1. Grade A Setup Verification (Score 80+)
{
  const candles = mockCandles(20, 24100, 'bullish', 1.6);
  const keyLevels = {
    majorSupport: 24095, // Price is 5 pts away from Major 1M Support
    vwap: 24098,
    pdl: 24080,
    pdh: 24200
  };
  const driverData = {
    pressureScore: 45 // Strong institutional tailwind
  };
  const signalData = {
    signal: 'BUY',
    confidence: 88,
    strategyName: '09:15 Opening Range Breakout (ORB)',
    regime: { label: 'Bullish Trend Expansion' },
    pattern: { name: 'Bullish Hammer', isActionable: true },
    patternName: 'Bullish Hammer',
    levels: {
      entryPrice: 24100,
      stopLoss: 24075, // 25 pts risk
      target1: 24165,  // 65 pts reward -> R:R = 2.6
      riskRewardRatio: 2.6
    }
  };

  // 09:30 IST Prime Window
  const primeTime = new Date('2026-10-01T04:00:00Z'); // 09:30 IST

  const result = TradeQualityScorer.evaluateQuality({
    signalData,
    candles,
    keyLevels,
    driverData,
    chartMeta: { currentPrice: 24100 },
    currentTime: primeTime
  });

  assert(result.totalScore >= 80, `Grade A setup score must be >= 80, got ${result.totalScore}`);
  assert(result.grade === 'A', `Grade must be A, got ${result.grade}`);
  assert(result.isAllowed === true, 'Grade A trade must be allowed');
  assert(result.sizingMultiplier === 1.0, `Grade A sizing must be 1.0x, got ${result.sizingMultiplier}`);
  assert(result.breakdown.length === 8, 'Breakdown must contain all 8 factor components');
}

// 2. Grade B Setup Verification (Score 65 - 79) - Allowed with Reduced Size (0.75x)
{
  const candles = mockCandles(20, 24100, 'neutral', 1.0);
  const keyLevels = {
    majorSupport: 24070, // 30 pts away (mid-range location)
    vwap: 24115,
    pdl: 24050,
    pdh: 24200
  };
  const driverData = {
    pressureScore: 10 // Mild positive pressure
  };
  const signalData = {
    signal: 'BUY',
    confidence: 70,
    strategyName: 'VWAP Trend Pullback',
    regime: { label: 'Neutral / Developing' },
    pattern: { name: 'Bullish Piercing', isActionable: true },
    patternName: 'Bullish Piercing',
    levels: {
      entryPrice: 24100,
      stopLoss: 24080,
      target1: 24140, // 1:2.0 R:R
      riskRewardRatio: 2.0
    }
  };

  const middayTime = new Date('2026-10-01T05:15:00Z'); // 10:45 IST

  const result = TradeQualityScorer.evaluateQuality({
    signalData,
    candles,
    keyLevels,
    driverData,
    chartMeta: { currentPrice: 24100 },
    userConfig: { allowGradeB: true, gradeBSizeMultiplier: 0.75 },
    currentTime: middayTime
  });

  assert(result.totalScore >= 65 && result.totalScore < 80, `Grade B setup score must be 65-79, got ${result.totalScore}`);
  assert(result.grade === 'B', `Grade must be B, got ${result.grade}`);
  assert(result.isAllowed === true, 'Grade B trade must be allowed when allowGradeB is true');
  assert(result.sizingMultiplier === 0.75, `Grade B sizing must be 0.75x, got ${result.sizingMultiplier}`);
  assert(result.statusLabel.includes('Reduced'), 'Status label must mention reduced sizing');
}

// 3. Grade B Setup when User Disabled Grade B -> Skipped / Blocked
{
  const candles = mockCandles(20, 24100, 'neutral', 1.0);
  const signalData = {
    signal: 'BUY',
    confidence: 70,
    strategyName: 'VWAP Trend Pullback',
    regime: { label: 'Neutral' },
    pattern: { name: 'Bullish Piercing', isActionable: true },
    levels: { riskRewardRatio: 2.0 }
  };

  const result = TradeQualityScorer.evaluateQuality({
    signalData,
    candles,
    keyLevels: { vwap: 24100 },
    driverData: { pressureScore: 10 },
    chartMeta: { currentPrice: 24100 },
    userConfig: { allowGradeB: false } // User strictly permits only Grade A
  });

  assert(result.grade === 'B', `Grade should be B, got ${result.grade}`);
  assert(result.isAllowed === false, 'Grade B trade must be blocked when allowGradeB is false');
  assert(result.sizingMultiplier === 0.0, 'Sizing multiplier must be 0 when Grade B is disabled');
  assert(result.skipReason.includes('Grade B trades disabled'), 'Skip reason must mention Grade B settings');
}

// 4. Grade C Setup Verification (Score < 65) - Blocked / Skipped
{
  // Anemic volume, counter-trend, mid-range, poor R:R
  const candles = mockCandles(20, 24100, 'bearish', 0.6); // Falling candles + low volume
  const keyLevels = {
    majorSupport: 24020, // 80 pts away (no man's land)
    majorResistance: 24200,
    vwap: 24150
  };
  const driverData = {
    pressureScore: -40 // Heavily bearish driver pressure against a BUY!
  };
  const signalData = {
    signal: 'BUY',
    confidence: 50,
    strategyName: 'Breakout Attempt',
    regime: { label: 'Choppy Range' },
    pattern: null, // No candlestick confirmation
    patternName: null,
    levels: {
      entryPrice: 24100,
      stopLoss: 24080,
      target1: 24125, // 1:1.25 R:R (Violates institutional 1:2.0 min)
      riskRewardRatio: 1.25
    }
  };

  // 12:15 IST Midday Chop
  const chopTime = new Date('2026-10-01T06:45:00Z');

  const result = TradeQualityScorer.evaluateQuality({
    signalData,
    candles,
    keyLevels,
    driverData,
    chartMeta: { currentPrice: 24100 },
    currentTime: chopTime
  });

  assert(result.totalScore < 65, `Grade C setup score must be < 65, got ${result.totalScore}`);
  assert(result.grade === 'C', `Grade must be C, got ${result.grade}`);
  assert(result.isAllowed === false, 'Grade C setup must be blocked');
  assert(result.sizingMultiplier === 0.0, 'Grade C sizing multiplier must be 0.0');
  assert(result.statusLabel.includes('SKIP'), 'Status label must indicate SKIP');
  assert(result.skipReason.includes('below the minimum Grade B threshold'), 'Skip reason must state score failure');
}

// 5. Integration with DisciplineStateMachine
{
  const rawSignal = {
    signal: 'BUY',
    confidence: 85,
    strategyName: 'ORB Breakout',
    confirmed: true,
    levels: { entryPrice: 24100, stopLoss: 24070, target1: 24160 }
  };
  const sessionInfo = { isAllowed: true, sessionName: 'Prime Morning Window' };

  // Case 5a: High Grade A quality score passes guard cleanly
  const qualityScoreA = {
    totalScore: 88,
    grade: 'A',
    isAllowed: true,
    sizingMultiplier: 1.0,
    gradeTitle: 'GRADE A (88/100)',
    statusLabel: 'ALLOWED (Full 1.0x Size)',
    verdictText: 'Prime Setup'
  };

  const guardedA = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal,
    sessionInfo,
    qualityScore: qualityScoreA
  });

  assert(guardedA.isActionable === true, 'Grade A signal must pass discipline guard as actionable');
  assert(guardedA.positionSizeMultiplier === 1.0, 'Grade A position size multiplier must be 1.0x');

  // Case 5b: Grade C quality score is blocked by discipline guard
  const qualityScoreC = {
    totalScore: 54,
    grade: 'C',
    isAllowed: false,
    sizingMultiplier: 0.0,
    gradeTitle: 'GRADE C (54/100)',
    statusLabel: 'SKIP (Low Quality <65)',
    verdictText: 'Sub-optimal Setup',
    skipReason: 'Score below 65 threshold.'
  };

  const guardedC = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal,
    sessionInfo,
    qualityScore: qualityScoreC
  });

  assert(guardedC.isActionable === false, 'Grade C signal must be blocked by discipline guard');
  assert(guardedC.action.includes('SKIP'), 'Action must indicate SKIP');
  assert(guardedC.disciplineStatus.gradeBlocked === true, 'disciplineStatus.gradeBlocked must be true');

  // Case 5c: Grade B with 0.75x multiplier + Profit Protection (0.5x) compounds to 0.375x
  const qualityScoreB = {
    totalScore: 72,
    grade: 'B',
    isAllowed: true,
    sizingMultiplier: 0.75,
    gradeTitle: 'GRADE B (72/100)',
    statusLabel: 'ALLOWED (Reduced 0.75x Size)',
    verdictText: 'Moderate Quality'
  };

  const dailyStateProfit = {
    realizedR: 1.5, // Profit protection is active (0.5x)
    isLocked: false,
    limits: { profitProtectionMode: true, maxDailyTrades: 3 }
  };

  const guardedB = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal,
    sessionInfo,
    dailyState: dailyStateProfit,
    qualityScore: qualityScoreB
  });

  assert(guardedB.isActionable === true, 'Grade B signal is actionable');
  // 0.5 (profit protection) * 0.75 (Grade B) = 0.375
  assert(Math.abs(guardedB.positionSizeMultiplier - 0.375) < 0.001, `Sizing must compound to 0.375x, got ${guardedB.positionSizeMultiplier}`);
  assert(/grade b/i.test(guardedB.profitProtectionNote), 'Note must mention Grade B scaling');
}

console.log(`\n========================================`);
console.log(`TRADE QUALITY SCORER TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
