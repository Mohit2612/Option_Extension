/**
 * TradeSight AI - Quantitative Backtest Engine & Institutional Risk Lock Test Suite
 * Tests all 6 strategies, equity curve data generation, drawdown bounds,
 * and institutional risk lockout mechanisms.
 */

import { BacktestEngine } from '../services/backtestEngine.js';
import { RiskManager } from '../services/riskManager.js';
import { SupportResistanceEngine } from '../services/supportResistanceEngine.js';

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

console.log('\n--- STARTING BACKTEST & RISK LOCK TEST SUITE ---');

// 1. Backtest Engine - All 6 Strategies Verification
const strategiesToTest = [
  'ALL_COMBINED',
  'OPENING_RANGE',
  'AFTERNOON_140',
  'HERO_ZERO',
  'SUPPORT_RESISTANCE',
  'CANDLESTICK_PATTERNS'
];

strategiesToTest.forEach((stratId) => {
  const result = BacktestEngine.runBacktest({
    strategyId: stratId,
    days: 30,
    capital: 100000,
    riskPct: 1.0,
    symbol: 'NIFTY'
  });

  assert(result.totalTrades > 0, `Backtest (${stratId}) generated trades (${result.totalTrades} trades)`);
  assert(result.winRate >= 35 && result.winRate <= 85, `Backtest (${stratId}) win rate within realistic bounds (${result.winRate}%)`);
  assert(typeof result.expectancyR === 'number', `Backtest (${stratId}) expectancy computed (${result.expectancyR} R)`);
  assert(result.profitFactor > 1.0, `Backtest (${stratId}) positive profit factor (${result.profitFactor})`);
  assert(result.maxDrawdownPct >= 0 && result.maxDrawdownPct <= 25, `Backtest (${stratId}) drawdown bounded (${result.maxDrawdownPct}%)`);
  assert(result.equityCurve.length === result.totalTrades + 1, `Backtest (${stratId}) equity curve complete (${result.equityCurve.length} points)`);
  assert(result.equityCurve[0].balance === 100000, `Backtest (${stratId}) starts from exact base capital (₹1,00,000)`);
});

// 2. Risk Lockout Tests
const unlockedState = RiskManager.getLockoutStatus({});
assert(!unlockedState.isLocked, 'Initial RiskManager state is UNLOCKED');

const engagedLock = RiskManager.engageLock('Manual discipline lock engaged.', 'MANUAL_DISCIPLINE_LOCK');
const lockedStatus = RiskManager.getLockoutStatus(engagedLock);
assert(lockedStatus.isLocked && lockedStatus.lockType === 'MANUAL_DISCIPLINE_LOCK', 'Manual Emergency Risk Lock successfully engages hard lockout');

// 3. Daily Loss Circuit Breaker Lockout Test
const maxDailyLossHit = RiskManager.evaluateTradePermission('GENERAL', {
  netRealizedPnl: -6500, // Breached 3% of 200,000 = 6,000
  totalTradesCount: 2
}, { maxCapital: 200000, maxDailyLossPct: 3.0 });

assert(!maxDailyLossHit.allowed && maxDailyLossHit.lockType === 'GLOBAL_DAILY_LOSS_LOCK', 'Global daily loss circuit breaker triggered (-3% capital)');

// 4. Hero-Zero 2 Consecutive Failures Lockout Test
const heroZero2Fails = RiskManager.evaluateTradePermission('HERO_ZERO', {
  heroZeroFailures: 2,
  totalTradesCount: 2
});
assert(!heroZero2Fails.allowed && heroZero2Fails.lockType === 'HERO_ZERO_FAIL_LOCK', 'Hero-Zero hard lockout after 2 consecutive failures');

// 5. Auto-Detect S/R Calculation Consistency
const autoSr = SupportResistanceEngine.calculateOneMonthSR('BANKNIFTY', 52350);
assert(autoSr.majorSupport && autoSr.majorResistance && autoSr.pivot, 'Auto-detect S/R levels generated for BANKNIFTY');
assert(autoSr.distToResistance > 0 && autoSr.distToSupport > 0, 'Auto-detect distances to 1M Support and Resistance calculated');

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
