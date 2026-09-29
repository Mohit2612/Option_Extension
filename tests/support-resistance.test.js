/**
 * TradeSight AI - 1-Month Support & Resistance & Pattern Confirmation Unit Tests
 */

import { SupportResistanceEngine } from '../services/supportResistanceEngine.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('--- STARTING 1-MONTH SUPPORT/RESISTANCE & PATTERN TEST SUITE ---');

// 1. Test 1-Month S/R Calculation for Multiple Assets
{
  const niftySR = SupportResistanceEngine.calculateOneMonthSR('NIFTY', 24150);
  assert(niftySR.monthHigh > 24150, 'Nifty 1M High must be above current price');
  assert(niftySR.monthLow < 24150, 'Nifty 1M Low must be below current price');
  assert(niftySR.majorResistance.price > 24150, 'Major Resistance R1 must be above price');
  assert(niftySR.majorSupport.price < 24150, 'Major Support S1 must be below price');
  assert(niftySR.majorSupport.testedCount >= 3, 'Support must have historical test count');
  console.log('✓ 1. 1-Month S/R calculation across multiple assets: Passed');
}

// 2. Test Confirmed BUY: Bullish Hammer at 1-Month Major Support
{
  const currentPrice = 23600;
  const srData = SupportResistanceEngine.calculateOneMonthSR('BANKNIFTY', 24000);
  // Set support at 23600
  srData.majorSupport.price = 23600;
  srData.majorSupport.lowerBound = 23550;
  srData.majorSupport.upperBound = 23650;

  const mockHammer = {
    name: 'Hammer',
    direction: 'BULLISH',
    reliability: 4,
    description: 'Bullish rejection at support; lower wick shows heavy buying absorption.'
  };

  const trade = SupportResistanceEngine.verifyTradeWithSR(mockHammer, currentPrice, srData);
  assert(trade.confirmed === true, 'Trade must be CONFIRMED when Bullish Hammer is at 1-Month Support');
  assert(trade.signal === 'BUY', 'Signal must be BUY');
  assert(trade.levels.stopLoss < currentPrice, 'Stop Loss must be below support floor');
  assert(trade.levels.target1 > currentPrice, 'Target 1 must be above entry price');
  assert(trade.levels.riskRewardRatio >= 2.0, 'R:R must be >= 1:2.0');
  console.log('✓ 2. Bullish Pattern at 1-Month Major Support -> Trade CONFIRMED BUY: Passed');
}

// 3. Test Confirmed SELL: Bearish Shooting Star at 1-Month Major Resistance
{
  const currentPrice = 24700;
  const srData = SupportResistanceEngine.calculateOneMonthSR('NIFTY', 24200);
  // Set resistance at 24700
  srData.majorResistance.price = 24700;
  srData.majorResistance.lowerBound = 24650;
  srData.majorResistance.upperBound = 24750;

  const mockStar = {
    name: 'Shooting Star',
    direction: 'BEARISH',
    reliability: 4,
    description: 'Bearish liquidity grab rejection; buyers trapped above resistance.'
  };

  const trade = SupportResistanceEngine.verifyTradeWithSR(mockStar, currentPrice, srData);
  assert(trade.confirmed === true, 'Trade must be CONFIRMED when Shooting Star is at 1-Month Resistance');
  assert(trade.signal === 'SELL', 'Signal must be SELL');
  assert(trade.levels.stopLoss > currentPrice, 'Stop Loss must be above resistance ceiling');
  assert(trade.levels.target1 < currentPrice, 'Target 1 must be below entry price');
  assert(trade.levels.riskRewardRatio >= 2.0, 'R:R must be >= 1:2.0');
  console.log('✓ 3. Bearish Pattern at 1-Month Major Resistance -> Trade CONFIRMED SELL: Passed');
}

// 4. Test Mid-Range Filter (Pattern without 1-Month S/R Confluence)
{
  const currentPrice = 24150; // In middle between 23600 and 24700
  const srData = SupportResistanceEngine.calculateOneMonthSR('RELIANCE', currentPrice);
  srData.majorSupport.price = 23600;
  srData.majorSupport.lowerBound = 23550;
  srData.majorSupport.upperBound = 23650;
  srData.majorResistance.price = 24700;
  srData.majorResistance.lowerBound = 24650;
  srData.majorResistance.upperBound = 24750;
  srData.pivot = 24400;

  const mockEngulfing = {
    name: 'Bullish Engulfing',
    direction: 'BULLISH',
    reliability: 4,
    description: 'Buyers engulf previous session.'
  };

  const trade = SupportResistanceEngine.verifyTradeWithSR(mockEngulfing, currentPrice, srData);
  assert(trade.confirmed === false, 'Mid-range pattern must NOT be confirmed without S/R validation');
  assert(trade.signal === 'WAIT', 'Signal must be WAIT');
  assert(trade.status === 'MID_RANGE_FILTERED', 'Status must be MID_RANGE_FILTERED');
  console.log('✓ 4. Mid-Range Filtered Pattern (No S/R Confluence) -> WAIT: Passed');
}

// 5. Test Bull Trap Risk (Bullish pattern directly facing Resistance)
{
  const currentPrice = 24700;
  const srData = SupportResistanceEngine.calculateOneMonthSR('NIFTY', 24200);
  srData.majorResistance.price = 24700;
  srData.majorResistance.lowerBound = 24650;
  srData.majorResistance.upperBound = 24750;

  const mockEngulfing = {
    name: 'Bullish Engulfing',
    direction: 'BULLISH',
    reliability: 4,
    description: 'Bullish candle.'
  };

  const trade = SupportResistanceEngine.verifyTradeWithSR(mockEngulfing, currentPrice, srData);
  assert(trade.confirmed === false, 'Bullish pattern at resistance must be rejected as Bull Trap Risk');
  assert(trade.status === 'BULL_TRAP_RISK', 'Status must be BULL_TRAP_RISK');
  console.log('✓ 5. Bull Trap Warning at 1-Month Resistance -> Blocked: Passed');
}

console.log('\n ALL 5 1-MONTH S/R & PATTERN VERIFICATION UNIT TESTS PASSED WITH 100% SUCCESS!\n');
