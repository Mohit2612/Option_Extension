/**
 * Unit Test Suite for Nifty Candlestick Pattern Engine
 * Verifies mathematical pattern definitions, wick/body ratios, and location confluence.
 */

import { PatternEngine } from '../patterns/pattern-engine.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('--- STARTING CANDLESTICK PATTERN ENGINE TEST SUITE ---');

// 1. Hammer Test (Downtrend, tiny upper wick, long lower wick >= 2x body)
{
  const hammerCandle = { open: 24050, high: 24052, low: 23980, close: 24060, volume: 50000 };
  const res = PatternEngine.detectHammer(hammerCandle, 'DOWN');
  assert(res !== null, 'Hammer should be detected in DOWN trend');
  assert(res.name === 'Hammer', `Expected Hammer, got ${res?.name}`);
  assert(res.direction === 'BULLISH', 'Hammer must be BULLISH');
  console.log('✓ 1. Hammer Pattern: Passed');
}

// 2. Shooting Star Test (Uptrend, tiny lower wick, long upper wick >= 2x body)
{
  const starCandle = { open: 24200, high: 24280, low: 24195, close: 24208, volume: 60000 };
  const res = PatternEngine.detectShootingStar(starCandle, 'UP');
  assert(res !== null, 'Shooting Star should be detected in UP trend');
  assert(res.name === 'Shooting Star', `Expected Shooting Star, got ${res?.name}`);
  assert(res.direction === 'BEARISH', 'Shooting Star must be BEARISH');
  console.log('✓ 2. Shooting Star Pattern: Passed');
}

// 3. Doji Tests (Standard, Dragonfly, Gravestone)
{
  // Dragonfly Doji (Open/Close near high, long lower wick)
  const dragonfly = { open: 24100, high: 24102, low: 24020, close: 24101, volume: 30000 };
  const resDf = PatternEngine.detectDoji(dragonfly);
  assert(resDf !== null && resDf.name === 'Dragonfly Doji', 'Dragonfly Doji detected');
  assert(resDf.direction === 'BULLISH', 'Dragonfly Doji must be BULLISH');

  // Gravestone Doji (Open/Close near low, long upper wick)
  const gravestone = { open: 24100, high: 24180, low: 24099, close: 24101, volume: 30000 };
  const resGs = PatternEngine.detectDoji(gravestone);
  assert(resGs !== null && resGs.name === 'Gravestone Doji', 'Gravestone Doji detected');
  assert(resGs.direction === 'BEARISH', 'Gravestone Doji must be BEARISH');
  console.log('✓ 3. Doji Variations (Dragonfly, Gravestone): Passed');
}

// 4. Marubozu Test (Solid body >= 85% range)
{
  const bullishMaru = { open: 24100, high: 24182, low: 24098, close: 24180, volume: 90000 };
  const resMaru = PatternEngine.detectMarubozu(bullishMaru);
  assert(resMaru !== null && resMaru.name === 'Bullish Marubozu', 'Bullish Marubozu detected');
  assert(resMaru.reliability === 5, 'Marubozu reliability should be 5');
  console.log('✓ 4. Marubozu Pattern: Passed');
}

// 5. Bullish Engulfing Test
{
  const c1Red = { open: 24120, high: 24125, low: 24080, close: 24085, volume: 40000 };
  const c2Green = { open: 24080, high: 24150, low: 24075, close: 24140, volume: 85000 };
  const resEngulf = PatternEngine.detectEngulfing(c1Red, c2Green);
  assert(resEngulf !== null && resEngulf.name === 'Bullish Engulfing', 'Bullish Engulfing detected');
  assert(resEngulf.direction === 'BULLISH', 'Bullish Engulfing direction');
  console.log('✓ 5. Bullish Engulfing Pattern: Passed');
}

// 6. Bearish Engulfing Test
{
  const c1Green = { open: 24100, high: 24140, low: 24095, close: 24135, volume: 35000 };
  const c2Red = { open: 24140, high: 24145, low: 24070, close: 24080, volume: 95000 };
  const resBearEngulf = PatternEngine.detectEngulfing(c1Green, c2Red);
  assert(resBearEngulf !== null && resBearEngulf.name === 'Bearish Engulfing', 'Bearish Engulfing detected');
  assert(resBearEngulf.direction === 'BEARISH', 'Bearish Engulfing direction');
  console.log('✓ 6. Bearish Engulfing Pattern: Passed');
}

// 7. Piercing Line Test
{
  const c1Bear = { open: 24200, high: 24205, low: 24100, close: 24110, volume: 50000 }; // midpoint is 24155
  const c2Bull = { open: 24080, high: 24175, low: 24075, close: 24170, volume: 70000 }; // open below c1 low, close > 24155
  const resPiercing = PatternEngine.detectPiercingAndDarkCloud(c1Bear, c2Bull);
  assert(resPiercing !== null && resPiercing.name === 'Piercing Line', 'Piercing Line detected');
  console.log('✓ 7. Piercing Line Pattern: Passed');
}

// 8. Tweezer Bottom Test
{
  const c1 = { open: 24120, high: 24125, low: 24050, close: 24080, volume: 40000 }; // low = 24050, lower wick 30
  const c2 = { open: 24075, high: 24115, low: 24050, close: 24110, volume: 45000 }; // low = 24050, lower wick 25
  const resTweezer = PatternEngine.detectTweezers(c1, c2);
  assert(resTweezer !== null && resTweezer.name === 'Tweezer Bottom', 'Tweezer Bottom detected');
  console.log('✓ 8. Tweezer Bottom Pattern: Passed');
}

// 9. Morning Star Test
{
  const c1 = { open: 24250, high: 24255, low: 24150, close: 24160, volume: 60000 }; // midpoint = 24205
  const c2 = { open: 24135, high: 24140, low: 24110, close: 24130, volume: 30000 }; // small star below c1
  const c3 = { open: 24135, high: 24230, low: 24130, close: 24220, volume: 90000 }; // strong green > 24205
  const resStar = PatternEngine.detectMorningAndEveningStar(c1, c2, c3);
  assert(resStar !== null && resStar.name === 'Morning Star', 'Morning Star detected');
  assert(resStar.direction === 'BULLISH', 'Morning star direction is BULLISH');
  console.log('✓ 9. Morning Star 3-Candle Pattern: Passed');
}

// 10. Three White Soldiers Test
{
  const c1 = { open: 24000, high: 24050, low: 23995, close: 24045, volume: 50000 };
  const c2 = { open: 24030, high: 24095, low: 24025, close: 24090, volume: 60000 };
  const c3 = { open: 24075, high: 24145, low: 24070, close: 24140, volume: 75000 };
  const resSoldiers = PatternEngine.detectSoldiersAndCrows(c1, c2, c3);
  assert(resSoldiers !== null && resSoldiers.name === 'Three White Soldiers', 'Three White Soldiers detected');
  console.log('✓ 10. Three White Soldiers Pattern: Passed');
}

// 11. Location Confluence Filter Test
{
  const cAtVwap = { open: 24080, high: 24150, low: 24075, close: 24140, volume: 85000 };
  const keyLevels = { vwap: 24135, pdh: 24350, pdl: 23900 };
  const locResult = PatternEngine.checkLocationConfluence(cAtVwap, keyLevels);
  assert(locResult.isAtKeyLevel === true, 'Candle near VWAP must be marked as at key level');
  assert(locResult.nearestLevelName === 'VWAP', 'Nearest level must be VWAP');

  // In the middle of nowhere
  const cInMiddle = { open: 24250, high: 24260, low: 24240, close: 24255, volume: 20000 };
  const locMiddle = PatternEngine.checkLocationConfluence(cInMiddle, keyLevels);
  assert(locMiddle.isAtKeyLevel === false, 'Candle in middle of nowhere must NOT be actionable');
  console.log('✓ 11. Location Confluence & Mid-Range Filtering: Passed');
}

console.log('\n ALL 11 CANDLESTICK PATTERN UNIT TESTS PASSED WITH 100% SUCCESS!\n');
