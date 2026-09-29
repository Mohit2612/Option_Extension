/**
 * Unit Test Suite for Time-Aware Nifty Strategies (Hero-Zero, 09:15 ORB, 1:40 PM)
 * Tests SessionClock, ExpiryCalendar, RiskManager, and the three strategy modules.
 */

import { SessionClock } from '../services/sessionClock.js';
import { ExpiryCalendar } from '../services/expiryCalendar.js';
import { RiskManager } from '../services/riskManager.js';
import { OptionChainService } from '../services/optionChain.js';
import { OpeningRangeStrategy } from '../strategies/openingRange.js';
import { Afternoon140Strategy } from '../strategies/afternoon140.js';
import { HeroZeroStrategy } from '../strategies/heroZero.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('--- STARTING TIME-AWARE STRATEGY SUITE TESTS ---');

// 1. SessionClock Test (IST Conversion)
{
  // 04:00 UTC = 09:30 IST
  const d = new Date('2026-10-01T04:00:00Z');
  const ist = SessionClock.getIstParts(d);
  assert(ist.hour === 9 && ist.minute === 30, `Expected 09:30 IST, got ${ist.hour}:${ist.minute}`);
  assert(SessionClock.isWithinWindow(d, 9, 20, 11, 30), '09:30 must be within 09:20 - 11:30 window');
  console.log('✓ 1. SessionClock IST conversion & window verification: Passed');
}

// 2. ExpiryCalendar Test (Thursday Expiry Detection)
{
  // 2026-10-01 is a Thursday
  const dThu = new Date('2026-10-01T09:00:00Z');
  const check = ExpiryCalendar.checkExpiry(dThu);
  assert(check.isExpiry === true, 'Thursday must be identified as an Expiry Day');
  assert(check.expiryType === 'WEEKLY' || check.expiryType === 'MONTHLY', 'Expiry type must be valid');

  // 2026-10-02 is a Friday (Non-expiry)
  const dFri = new Date('2026-10-02T09:00:00Z');
  const checkFri = ExpiryCalendar.checkExpiry(dFri);
  assert(checkFri.isExpiry === false, 'Friday must be identified as non-expiry');
  console.log('✓ 2. ExpiryCalendar Thursday expiry detection: Passed');
}

// 3. RiskManager Test (Hero-Zero 2-Loss Lockout & Sizing)
{
  // Test lockout after 2 failed Hero-Zero trades
  const blocked = RiskManager.evaluateTradePermission('HERO_ZERO', {
    totalTradesCount: 2,
    netRealizedPnl: -1500,
    heroZeroFailures: 2 // 2 losses
  });
  assert(blocked.allowed === false, 'Hero-Zero must be locked after 2 failed trades');
  assert(blocked.lockType === 'HERO_ZERO_FAIL_LOCK', 'Lock type must be HERO_ZERO_FAIL_LOCK');

  // Test sizing: ₹2,00,000 capital, 0.75% risk = ₹1,500 max loss
  // ₹20 option with lot size 25 = ₹500 per lot -> 3 lots (₹1,500 risk)
  const sizing = RiskManager.calculateLotSizing({
    capital: 200000,
    riskPct: 0.75,
    premiumPerShare: 20,
    lotSize: 25,
    isHeroZero: true
  });
  assert(sizing.allowed === true, 'Sizing must be allowed for ₹20 option');
  assert(sizing.lots === 3, `Expected 3 lots, got ${sizing.lots}`);
  assert(sizing.maxLossAmount === 1500, `Expected ₹1500 risk, got ₹${sizing.maxLossAmount}`);
  console.log('✓ 3. RiskManager Hero-Zero 2-loss lockout & lot calculation: Passed');
}

// 4. OptionChainService Test (Hero-Zero Strike & Required Pts to Double)
{
  const strikeChoice = OptionChainService.selectHeroZeroStrike({
    spotPrice: 24120,
    direction: 'BUY_CE',
    premiumMin: 5,
    premiumMax: 40,
    currentAtmIv: 13.5
  });

  assert(strikeChoice !== null, 'Strike choice must not be null');
  assert(strikeChoice.optionType === 'CE', 'Option type must be CE');
  assert(strikeChoice.estimatedPremium >= 5 && strikeChoice.estimatedPremium <= 40, 'Premium within configured band');
  assert(strikeChoice.delta > 0.10 && strikeChoice.delta < 0.40, 'Delta must be between 0.10 and 0.40');
  assert(strikeChoice.requiredPointsToDouble > 20, 'Required points to double must be positive and realistic');
  console.log(`✓ 4. OptionChainService strike selection (${strikeChoice.symbolFormatted} @ ₹${strikeChoice.estimatedPremium}, Delta ${strikeChoice.delta}, Needs ${strikeChoice.requiredPointsToDouble} pts to 2x): Passed`);
}

// 5. Module B: Opening Range Strategy Test (09:30 ORB Breakout)
{
  const time935 = new Date('2026-10-01T04:05:00Z'); // 09:35 IST
  const mockCandles = [
    { open: 24100, high: 24150, low: 24080, close: 24140, volume: 50000 },
    { open: 24140, high: 24155, low: 24120, close: 24145, volume: 45000 },
    { open: 24145, high: 24160, low: 24135, close: 24150, volume: 48000 }, // First 15m high is 24160, low is 24080
    { open: 24150, high: 24210, low: 24148, close: 24205, volume: 95000 }  // Breakout candle at 09:35
  ];

  const res = OpeningRangeStrategy.evaluate({
    candles: mockCandles,
    keyLevels: { pdc: 24080, pdh: 24250, pdl: 24000, vwap: 24145 },
    driverData: { pressureScore: 35 },
    currentTime: time935
  });

  assert(res !== null, 'ORB result should not be null');
  assert(res.signal === 'BUY', 'ORB breakout above 24160 must trigger BUY');
  assert(res.strategyName.includes('15m ORB'), 'Strategy name must be 15m ORB');
  assert(res.dayPlan !== undefined, '09:30 Day Plan must be generated');
  console.log('✓ 5. Module B: Opening Range Strategy (ORB Breakout + Day Plan): Passed');
}

// 6. Module C: 1:40 PM Afternoon Strategy Test (Compression Breakout)
{
  const time1345 = new Date('2026-10-01T08:15:00Z'); // 13:45 IST
  // Generate 20 candles with 12:00-13:40 compression [24100 - 24125] (range = 25 pts)
  const mockCandles = [];
  for (let i = 0; i < 20; i++) {
    mockCandles.push({ open: 24110, high: 24125, low: 24100, close: 24115, volume: 30000 });
  }
  // Candle breaking out at 13:45
  mockCandles.push({ open: 24115, high: 24155, low: 24112, close: 24150, volume: 90000 });

  const res = Afternoon140Strategy.evaluate({
    candles: mockCandles,
    keyLevels: { vwap: 24112 },
    driverData: { pressureScore: 40 },
    currentTime: time1345
  });

  assert(res !== null, '1:40 PM result should not be null');
  assert(res.signal === 'BUY', '1:40 PM compression breakout must trigger BUY');
  assert(res.strategyName.includes('1:40 PM Compression Breakout'), 'Strategy name must match');
  console.log('✓ 6. Module C: 1:40 PM Compression Breakout: Passed');
}

// 7. Module A: Hero-Zero Expiry Gamma Engine Test (14:05 IST on Thursday)
{
  const time1405 = new Date('2026-10-01T08:35:00Z'); // 14:05 IST on Thursday Oct 1 (Expiry)
  const mockCandles = [];
  for (let i = 0; i < 20; i++) {
    mockCandles.push({ open: 24120, high: 24160, low: 24110, close: 24140, volume: 40000 });
  }
  // High volume momentum expansion at Day High
  mockCandles.push({ open: 24140, high: 24205, low: 24138, close: 24200, volume: 140000 });

  const res = HeroZeroStrategy.evaluate({
    candles: mockCandles,
    keyLevels: { vwap: 24135 },
    driverData: {
      pressureScore: 45,
      vixAnalysis: { details: 'Level: 13.2 | Change: -2.5%' },
      drivers: [{ id: 'options_chain', score: 35 }]
    },
    pattern: { name: 'Bullish Marubozu', direction: 'BULLISH' },
    regime: { type: 'TRENDING_UP', label: 'Trending Up' },
    dailyState: { heroZeroFailures: 0, totalTradesCount: 1 },
    currentTime: time1405
  });

  assert(res !== null, 'Hero-Zero result should not be null on expiry afternoon');
  assert(res.signal === 'BUY', 'Hero-Zero must trigger BUY on strong confluence');
  assert(res.strikeInfo !== undefined, 'Hero-Zero must provide strike info');
  assert(res.premiumPlan.stopLossPremium > 0, 'Must have defined 50% premium stop loss');
  assert(res.mandatoryDisclaimer.includes('Most Hero-Zero trades expire worthless'), 'Must include non-negotiable warning');
  console.log('✓ 7. Module A: Hero-Zero Expiry Gamma Engine with 50% premium stop & strike selection: Passed');
}

console.log('\n ALL 7 TIME-AWARE STRATEGY SUITE UNIT TESTS PASSED WITH 100% SUCCESS!\n');
