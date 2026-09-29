/**
 * TradeSight NIFTY 50 - Institutional Strategy Engine
 * Evaluates market regime, enforces strict no-trade filters, runs 7 defined Nifty setups,
 * and generates precise Entry, SL, Target 1/2, and Invalidation triggers.
 */

import { NIFTY_CONFIG } from '../config/nifty-config.js';
import { PatternEngine } from '../patterns/pattern-engine.js';
import { OpeningRangeStrategy } from './openingRange.js';
import { Afternoon140Strategy } from './afternoon140.js';
import { HeroZeroStrategy } from './heroZero.js';

export const StrategyEngine = {
  // Strategy Registry
  modules: {
    heroZero: HeroZeroStrategy,
    openingRange: OpeningRangeStrategy,
    afternoon140: Afternoon140Strategy
  },

  /**
   * Main strategy evaluation pipeline
   * @param {Object} input - { candles, keyLevels, drivers, dailyLossCount, userConfig, currentTime, dailyState }
   */
  evaluateSetup({
    candles = [],
    keyLevels = {},
    driverData = {},
    dailyLossCount = 0,
    dailyState = {},
    userConfig = {},
    currentTime = new Date()
  }) {
    if (!candles || candles.length < 5) {
      return this.buildWaitResponse('Insufficient historical candle data for reliable Nifty analysis.');
    }

    const latest = candles[candles.length - 1];
    const currentPrice = parseFloat(latest.close);

    // 1. Market Regime Classification
    const regime = this.classifyMarketRegime(candles, keyLevels, driverData);

    // 2. Strict No-Trade Filters (Honesty & Capital Preservation)
    const filterCheck = this.evaluateNoTradeFilters(currentTime, dailyLossCount, driverData, regime);
    if (filterCheck.isBlocked) {
      return {
        signal: 'WAIT',
        regime,
        confidence: 0,
        filterReason: filterCheck.reason,
        invalidation: 'Wait for no-trade conditions to clear.',
        strategyName: 'None (Filtered)',
        levels: null,
        optionsSuggestion: null,
        timestamp: currentTime.toISOString()
      };
    }

    // 3. Detect Candlestick Pattern at Key Level
    const detectedPattern = PatternEngine.evaluateLatestCandle(candles, keyLevels, regime.trend);

    // 4. Evaluate Strategies in priority order based on current regime & time windows
    const strategySignals = [];

    // Module A: Hero-Zero Expiry Gamma Engine (Expiry day 13:45-14:45 peak priority)
    if (userConfig.strategies?.heroZero?.enabled !== false) {
      const hzSig = HeroZeroStrategy.evaluate({
        candles, keyLevels, driverData, pattern: detectedPattern, regime, dailyState, userConfig, currentTime
      });
      if (hzSig && hzSig.signal !== 'WAIT') strategySignals.push(hzSig);
    }

    // Module B: 09:15 / First 15-Minute Candle Strategy
    if (userConfig.strategies?.openingRange?.enabled !== false) {
      const orbSig = OpeningRangeStrategy.evaluate({
        candles, keyLevels, driverData, userConfig, currentTime
      });
      if (orbSig && orbSig.signal !== 'WAIT') strategySignals.push(orbSig);
    }

    // Module C: 1:40 PM Afternoon Strategy (13:40-14:30 window)
    if (userConfig.strategies?.afternoon140?.enabled !== false) {
      const pmSig = Afternoon140Strategy.evaluate({
        candles, keyLevels, driverData, pattern: detectedPattern, regime, userConfig, currentTime
      });
      if (pmSig && pmSig.signal !== 'WAIT') strategySignals.push(pmSig);
    }

    // Strategy 1: Opening Range Breakout (Active 09:20 - 10:30)
    if (userConfig.strategies?.orb?.enabled !== false) {
      const orbSig = this.evaluateORB(candles, keyLevels, driverData, currentTime);
      if (orbSig) strategySignals.push(orbSig);
    }

    // Strategy 2: VWAP Trend / Reversion
    if (userConfig.strategies?.vwapReversion?.enabled !== false) {
      const vwapSig = this.evaluateVwapStrategy(candles, keyLevels, detectedPattern, regime);
      if (vwapSig) strategySignals.push(vwapSig);
    }

    // Strategy 3: 9/21 EMA Trend Pullback
    if (userConfig.strategies?.trendEmaPullback?.enabled !== false) {
      const emaSig = this.evaluateTrendEmaPullback(candles, detectedPattern, regime);
      if (emaSig) strategySignals.push(emaSig);
    }

    // Strategy 4: Liquidity Sweep & S/R Reversal
    if (userConfig.strategies?.srLiquiditySweep?.enabled !== false) {
      const sweepSig = this.evaluateLiquiditySweep(candles, keyLevels, detectedPattern);
      if (sweepSig) strategySignals.push(sweepSig);
    }

    // Strategy 5: Breakout-Retest
    if (userConfig.strategies?.breakoutRetest?.enabled !== false) {
      const boSig = this.evaluateBreakoutRetest(candles, keyLevels, detectedPattern);
      if (boSig) strategySignals.push(boSig);
    }

    // Strategy 6: Gap Strategy (Gap Fill / Gap-and-Go)
    if (userConfig.strategies?.gapStrategy?.enabled !== false) {
      const gapSig = this.evaluateGapStrategy(candles, keyLevels, driverData, currentTime);
      if (gapSig) strategySignals.push(gapSig);
    }

    // Strategy 7: Expiry Day Special (Thursdays)
    const isExpiry = currentTime.getDay() === NIFTY_CONFIG.expiry.dayOfWeek;
    if (isExpiry && userConfig.strategies?.expirySpecial?.enabled !== false) {
      const expSig = this.evaluateExpiryStrategy(candles, keyLevels, driverData, currentTime);
      if (expSig) strategySignals.push(expSig);
    }

    // 5. Select Best Matching Strategy or default to WAIT
    if (strategySignals.length === 0) {
      return this.buildWaitResponse('No high-probability institutional setup currently active. Market in consolidation/chop.', regime);
    }

    // Sort by highest confidence
    strategySignals.sort((a, b) => b.confidence - a.confidence);
    const chosen = strategySignals[0];

    // Enforce strict 1:2 Minimum Risk-Reward
    if (chosen.riskRewardRatio < NIFTY_CONFIG.risk.minRiskRewardRatio) {
      return this.buildWaitResponse(`Setup rejected: Risk-to-Reward (${chosen.riskRewardRatio.toFixed(2)}) is below mandatory 1:2.0 threshold.`, regime);
    }

    // Add Options Suggestion based on directional signal and IV environment
    chosen.optionsSuggestion = this.generateOptionsSuggestion(chosen.signal, currentPrice, driverData);
    chosen.regime = regime;

    return chosen;
  },

  /**
   * Classify Market Regime: Trending Up, Trending Down, Range-Bound, or High-Volatility Chop
   */
  classifyMarketRegime(candles, keyLevels, drivers) {
    const n = candles.length;
    const recent = candles.slice(-20);
    const closes = recent.map((c) => c.close);
    const firstClose = closes[0];
    const lastClose = closes[closes.length - 1];
    const change = lastClose - firstClose;

    const vixLevel = drivers.vixAnalysis?.details ? parseFloat(drivers.vixAnalysis.details.match(/Level:\s*([0-9.]+)/)?.[1] || 14) : 14;

    if (vixLevel >= NIFTY_CONFIG.vix.extremeRisk) {
      return { type: 'HIGH_VOLATILITY_CHOP', trend: 'NEUTRAL', label: 'High-Volatility Chop (Widen Stops / Reduce Size)' };
    }

    if (change > 80 && keyLevels.vwap && lastClose > keyLevels.vwap) {
      return { type: 'TRENDING_UP', trend: 'UP', label: 'Trending Bullish (Above VWAP)' };
    }

    if (change < -80 && keyLevels.vwap && lastClose < keyLevels.vwap) {
      return { type: 'TRENDING_DOWN', trend: 'DOWN', label: 'Trending Bearish (Below VWAP)' };
    }

    return { type: 'RANGE', trend: 'NEUTRAL', label: 'Range-Bound / Consolidation' };
  },

  /**
   * Evaluate Non-Negotiable No-Trade Filters
   */
  evaluateNoTradeFilters(time, dailyLossCount, drivers, regime) {
    const hours = time.getHours();
    const minutes = time.getMinutes();
    const currentMins = hours * 60 + minutes;

    // Filter 1: First 5 minutes after 09:15 open (09:15-09:20)
    if (currentMins >= 9 * 60 + 15 && currentMins < 9 * 60 + 20) {
      return { isBlocked: true, reason: 'First 5-minute opening volatility buffer (09:15-09:20). Avoid entering opening tick noise.' };
    }

    // Filter 2: Lunch-hour chop (11:30 - 13:30)
    if (currentMins >= 11 * 60 + 30 && currentMins < 13 * 60 + 30 && regime.type === 'RANGE') {
      return { isBlocked: true, reason: 'Mid-session lunch lull (11:30 - 13:30 IST). Low institutional volume and high premium erosion.' };
    }

    // Filter 3: Maximum 2 Consecutive Losses Per Day Rule
    if (dailyLossCount >= NIFTY_CONFIG.risk.maxConsecutiveLossesPerDay) {
      return { isBlocked: true, reason: 'Daily loss limit reached (2 consecutive losses). Capital protection protocol engaged.' };
    }

    // Filter 4: Intraday square-off buffer (after 15:15)
    if (currentMins >= 15 * 60 + 15) {
      return { isBlocked: true, reason: 'Market closing auction window (> 15:15 IST). Fresh intraday entries prohibited.' };
    }

    return { isBlocked: false, reason: null };
  },

  // ================= STRATEGY 1: OPENING RANGE BREAKOUT (ORB) =================
  evaluateORB(candles, keyLevels, drivers, time) {
    if (!keyLevels.orh || !keyLevels.orl) return null;

    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const orh = keyLevels.orh;
    const orl = keyLevels.orl;
    const orRange = orh - orl;

    // Only valid within morning window (09:30 - 11:15)
    const mins = time.getHours() * 60 + time.getMinutes();
    if (mins < 9 * 60 + 30 || mins > 11 * 60 + 15) return null;

    // Bullish ORB: Candle closes above ORH with positive pressure score
    if (latest.close > orh && prev.close <= orh && drivers.pressureScore > 10) {
      const sl = Math.max(orh - 30, orh - (orRange * 0.4));
      const risk = latest.close - sl;
      const tp1 = latest.close + risk * 2.0;
      const tp2 = latest.close + risk * 3.2;

      return {
        strategyName: 'Opening Range Breakout (Bullish ORB)',
        signal: 'BUY',
        confidence: 82,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((tp1 - latest.close) / risk).toFixed(2)),
        invalidation: `Candle close back below Opening Range High (${orh}).`,
        setupRationale: `15m Opening Range High (${orh}) decisively broken with bullish Market Pressure Score (${drivers.pressureScore}).`
      };
    }

    // Bearish ORB: Candle closes below ORL with negative pressure score
    if (latest.close < orl && prev.close >= orl && drivers.pressureScore < -10) {
      const sl = Math.min(orl + 30, orl + (orRange * 0.4));
      const risk = sl - latest.close;
      const tp1 = latest.close - risk * 2.0;
      const tp2 = latest.close - risk * 3.2;

      return {
        strategyName: 'Opening Range Breakdown (Bearish ORB)',
        signal: 'SELL',
        confidence: 82,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((latest.close - tp1) / risk).toFixed(2)),
        invalidation: `Candle close back above Opening Range Low (${orl}).`,
        setupRationale: `15m Opening Range Low (${orl}) broken with bearish Market Pressure Score (${drivers.pressureScore}).`
      };
    }

    return null;
  },

  // ================= STRATEGY 2: VWAP TREND / REVERSION =================
  evaluateVwapStrategy(candles, keyLevels, pattern, regime) {
    if (!keyLevels.vwap) return null;
    const vwap = keyLevels.vwap;
    const latest = candles[candles.length - 1];

    // Bullish Trend Day Pullback to VWAP with bullish rejection candle
    if (regime.type === 'TRENDING_UP' && pattern && pattern.direction === 'BULLISH' && pattern.isActionable) {
      const distToVwap = Math.abs(latest.low - vwap);
      if (distToVwap <= 25) {
        const sl = Math.min(latest.low - 8, vwap - 15);
        const risk = latest.close - sl;
        const tp1 = latest.close + risk * 2.2;
        const tp2 = latest.close + risk * 3.5;

        return {
          strategyName: 'VWAP Trend Pullback Rejection',
          signal: 'BUY',
          confidence: 85,
          entryPrice: latest.close,
          stopLoss: Math.round(sl * 10) / 10,
          target1: Math.round(tp1 * 10) / 10,
          target2: Math.round(tp2 * 10) / 10,
          riskRewardRatio: 2.2,
          invalidation: `Decisive 5m candle close below VWAP (${vwap}).`,
          setupRationale: `Uptrend pullback defended at VWAP with ${pattern.name} confirmation.`
        };
      }
    }

    // Bearish Trend Day Pullback to VWAP with bearish rejection candle
    if (regime.type === 'TRENDING_DOWN' && pattern && pattern.direction === 'BEARISH' && pattern.isActionable) {
      const distToVwap = Math.abs(latest.high - vwap);
      if (distToVwap <= 25) {
        const sl = Math.max(latest.high + 8, vwap + 15);
        const risk = sl - latest.close;
        const tp1 = latest.close - risk * 2.2;
        const tp2 = latest.close - risk * 3.5;

        return {
          strategyName: 'VWAP Bearish Trend Resistance Rejection',
          signal: 'SELL',
          confidence: 85,
          entryPrice: latest.close,
          stopLoss: Math.round(sl * 10) / 10,
          target1: Math.round(tp1 * 10) / 10,
          target2: Math.round(tp2 * 10) / 10,
          riskRewardRatio: 2.2,
          invalidation: `Decisive 5m candle close above VWAP (${vwap}).`,
          setupRationale: `Downtrend rally rejected at VWAP with ${pattern.name} confirmation.`
        };
      }
    }

    return null;
  },

  // ================= STRATEGY 3: 9/21 EMA TREND PULLBACK =================
  evaluateTrendEmaPullback(candles, pattern, regime) {
    if (candles.length < 25) return null;
    const latest = candles[candles.length - 1];

    // Compute simple moving averages for EMA 9 and 21 approximation
    const closes = candles.map((c) => c.close);
    const ema9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const ema21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;

    // Bullish: 9 EMA > 21 EMA and price tests 9/21 zone with bullish candle
    if (ema9 > ema21 && latest.low <= ema9 && latest.close >= ema9 && pattern && pattern.direction === 'BULLISH') {
      const sl = ema21 - 12;
      const risk = latest.close - sl;
      if (risk <= 0) return null;

      return {
        strategyName: '9/21 EMA Trend Momentum Bounce',
        signal: 'BUY',
        confidence: 80,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close + risk * 2.0) * 10) / 10,
        target2: Math.round((latest.close + risk * 3.0) * 10) / 10,
        riskRewardRatio: 2.0,
        invalidation: `Candle close below 21 EMA (${Math.round(ema21)}).`,
        setupRationale: `Healthy pullback into 9/21 EMA band in uptrend with ${pattern.name}.`
      };
    }

    // Bearish: 9 EMA < 21 EMA and price retests 9/21 zone from below
    if (ema9 < ema21 && latest.high >= ema9 && latest.close <= ema9 && pattern && pattern.direction === 'BEARISH') {
      const sl = ema21 + 12;
      const risk = sl - latest.close;
      if (risk <= 0) return null;

      return {
        strategyName: '9/21 EMA Trend Pullback Rejection',
        signal: 'SELL',
        confidence: 80,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close - risk * 2.0) * 10) / 10,
        target2: Math.round((latest.close - risk * 3.0) * 10) / 10,
        riskRewardRatio: 2.0,
        invalidation: `Candle close above 21 EMA (${Math.round(ema21)}).`,
        setupRationale: `Bearish pullback to 9/21 EMA in downtrend with ${pattern.name}.`
      };
    }

    return null;
  },

  // ================= STRATEGY 4: S/R & LIQUIDITY SWEEP REVERSAL =================
  evaluateLiquiditySweep(candles, keyLevels, pattern) {
    if (!keyLevels.pdh && !keyLevels.pdl) return null;
    const latest = candles[candles.length - 1];

    // Bullish Stop Hunt below Previous Day Low (PDL) or Max Put OI
    const supportLevel = keyLevels.pdl || keyLevels.maxPutOi;
    if (supportLevel && latest.low < supportLevel && latest.close > supportLevel && pattern && pattern.direction === 'BULLISH') {
      const sl = latest.low - 8;
      const risk = latest.close - sl;

      return {
        strategyName: 'Liquidity Sweep Reversal (Sell-Side Trap)',
        signal: 'BUY',
        confidence: 88,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close + risk * 2.5) * 10) / 10,
        target2: Math.round((latest.close + risk * 4.0) * 10) / 10,
        riskRewardRatio: 2.5,
        invalidation: `Break of the liquidity grab swing low (${latest.low}).`,
        setupRationale: `Trapped sellers below ${supportLevel}; quick reclamation with ${pattern.name}.`
      };
    }

    // Bearish Stop Hunt above Previous Day High (PDH) or Max Call OI
    const resistLevel = keyLevels.pdh || keyLevels.maxCallOi;
    if (resistLevel && latest.high > resistLevel && latest.close < resistLevel && pattern && pattern.direction === 'BEARISH') {
      const sl = latest.high + 8;
      const risk = sl - latest.close;

      return {
        strategyName: 'Liquidity Sweep Reversal (Buy-Side Trap)',
        signal: 'SELL',
        confidence: 88,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close - risk * 2.5) * 10) / 10,
        target2: Math.round((latest.close - risk * 4.0) * 10) / 10,
        riskRewardRatio: 2.5,
        invalidation: `Break of the liquidity sweep high (${latest.high}).`,
        setupRationale: `Trapped breakout buyers above ${resistLevel}; sharp rejection with ${pattern.name}.`
      };
    }

    return null;
  },

  // ================= STRATEGY 5: BREAKOUT-RETEST =================
  evaluateBreakoutRetest(candles, keyLevels, pattern) {
    if (candles.length < 4 || !keyLevels.pdh) return null;
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const pdh = keyLevels.pdh;

    // Retest of broken PDH resistance turned into support
    if (prev.close > pdh && latest.low <= pdh + 8 && latest.close > pdh && pattern && pattern.direction === 'BULLISH') {
      const sl = pdh - 15;
      const risk = latest.close - sl;

      return {
        strategyName: 'Breakout & Retest Confirmation',
        signal: 'BUY',
        confidence: 84,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close + risk * 2.2) * 10) / 10,
        target2: Math.round((latest.close + risk * 3.5) * 10) / 10,
        riskRewardRatio: 2.2,
        invalidation: `Failure to hold retest level (${pdh}).`,
        setupRationale: `Previous resistance at PDH (${pdh}) retested and confirmed as fresh support.`
      };
    }

    return null;
  },

  // ================= STRATEGY 6: GAP STRATEGY =================
  evaluateGapStrategy(candles, keyLevels, drivers, time) {
    if (!keyLevels.pdc) return null;
    const pdc = keyLevels.pdc;
    const firstCandle = candles[0];
    const latest = candles[candles.length - 1];
    const gapPts = firstCandle.open - pdc;

    // Gap and Go Bullish: Gap > 40 pts, holding above first 15m candle
    if (gapPts >= 40 && latest.close > firstCandle.high && drivers.pressureScore > 20) {
      const sl = firstCandle.low;
      const risk = latest.close - sl;

      return {
        strategyName: 'Gap-and-Go Momentum Continuation',
        signal: 'BUY',
        confidence: 78,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close + risk * 2.0) * 10) / 10,
        target2: Math.round((latest.close + risk * 3.0) * 10) / 10,
        riskRewardRatio: 2.0,
        invalidation: `Candle close below opening candle low (${firstCandle.low}).`,
        setupRationale: `GIFT Nifty gap sustained above first 15-minute high with institutional momentum.`
      };
    }

    return null;
  },

  // ================= STRATEGY 7: EXPIRY DAY SPECIAL =================
  evaluateExpiryStrategy(candles, keyLevels, drivers, time) {
    const hours = time.getHours();
    const minutes = time.getMinutes();
    const currentMins = hours * 60 + minutes;

    // Expiry gamma window (13:30 - 15:00)
    if (currentMins < 13 * 60 + 30 || currentMins > 15 * 60 + 0) return null;

    const latest = candles[candles.length - 1];
    const maxPain = keyLevels.maxPain || Math.round(latest.close / 50) * 50;
    const distToMaxPain = latest.close - maxPain;

    // Reversion towards Max Pain on Expiry Afternoon if extended > 60 pts
    if (distToMaxPain > 65 && drivers.pressureScore <= 0) {
      const sl = latest.high + 15;
      const risk = sl - latest.close;

      return {
        strategyName: 'Expiry Day Max Pain Magnetic Pull',
        signal: 'SELL',
        confidence: 82,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: maxPain + 15,
        target2: maxPain,
        riskRewardRatio: 2.5,
        invalidation: `Break of afternoon high (${latest.high}).`,
        setupRationale: `Overextended on Expiry; institutional option sellers dragging price towards Max Pain (${maxPain}).`
      };
    }

    return null;
  },

  /**
   * Helper to construct a standardized WAIT response
   */
  buildWaitResponse(reason, regime = { label: 'Neutral' }) {
    return {
      signal: 'WAIT',
      regime,
      confidence: 0,
      filterReason: reason,
      invalidation: 'Wait for a valid structural setup to form.',
      strategyName: 'None (Stand Aside)',
      levels: null,
      optionsSuggestion: null,
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Generate institutional options strike suggestion (ATM / 1-ITM Call/Put or Credit Spread)
   */
  generateOptionsSuggestion(signal, spotPrice, drivers) {
    const roundedAtm = Math.round(spotPrice / 50) * 50;
    const isHighIv = drivers.vixAnalysis?.details ? parseFloat(drivers.vixAnalysis.details.match(/Level:\s*([0-9.]+)/)?.[1] || 14) > 17 : false;

    if (signal === 'BUY') {
      const strike = roundedAtm; // ATM Call
      const itmStrike = roundedAtm - 50; // 1-ITM Call for delta efficiency

      if (isHighIv) {
        return {
          structure: 'Bull Put Spread (Credit Spread)',
          rationale: 'IV elevated. Sell ATM Put and buy OTM Put protection to benefit from theta decay.',
          sellLeg: `${roundedAtm} PE`,
          buyLeg: `${roundedAtm - 100} PE`,
          riskNote: 'Defined risk spread. Positive Theta.'
        };
      }

      return {
        structure: `NIFTY ${itmStrike} CE (1-ITM)`,
        strike: itmStrike,
        type: 'CALL (CE)',
        rationale: '1-ITM Call offers ~0.60 Delta with lower extrinsic decay than OTM calls.',
        approxPremiumRisk: '₹120 - ₹160 (Approx ₹3,000 - ₹4,000 per lot of 25)'
      };
    }

    if (signal === 'SELL') {
      const strike = roundedAtm;
      const itmStrike = roundedAtm + 50; // 1-ITM Put

      if (isHighIv) {
        return {
          structure: 'Bear Call Spread (Credit Spread)',
          rationale: 'IV elevated. Sell ATM Call and buy OTM Call protection.',
          sellLeg: `${roundedAtm} CE`,
          buyLeg: `${roundedAtm + 100} CE`,
          riskNote: 'Defined risk spread. Positive Theta.'
        };
      }

      return {
        structure: `NIFTY ${itmStrike} PE (1-ITM)`,
        strike: itmStrike,
        type: 'PUT (PE)',
        rationale: '1-ITM Put captures high Delta on breakdown with controlled gamma risk.',
        approxPremiumRisk: '₹120 - ₹160 (Approx ₹3,000 - ₹4,000 per lot of 25)'
      };
    }

    return null;
  }
};
