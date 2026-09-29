/**
 * TradeSight NIFTY 50 - Module B: 09:15 AM / First 15-Minute Strategy
 * Analyzes opening gap, builds the 15-min opening bar, outputs 09:30 IST Day Plan,
 * and evaluates ORB, Failed-Breakout Reversal, and Gap-Fill setups.
 */

import { SessionClock } from '../services/sessionClock.js';

export const OpeningRangeStrategy = {
  MODULE_KEY: 'OPENING_RANGE',

  DEFAULT_CONFIG: {
    enabled: true,
    slMode: 'MIDPOINT', // 'MIDPOINT' (range/2) or 'OPPOSITE_RANGE' (full range)
    allowOrbBreakout: true,
    allowFailedBreakoutReversal: true,
    allowGapFill: true,
    minRangePts: 25,    // Below 25 pts = extreme compression
    maxRangePts: 120,   // Above 120 pts = opening exhaustion risk
    timeStopMinutes: 45 // Exit if no follow-through in 45 mins
  },

  /**
   * Main evaluation pipeline for 09:15-09:30 Module
   * @param {Object} input - { candles, keyLevels, drivers, dailyState, userConfig, currentTime }
   */
  evaluate({
    candles = [],
    keyLevels = {},
    driverData = {},
    userConfig = {},
    currentTime = new Date()
  }) {
    const config = { ...this.DEFAULT_CONFIG, ...(userConfig?.strategies?.openingRange || {}) };
    if (!config.enabled) return null;

    const ist = SessionClock.getIstParts(currentTime);
    const mins = ist.totalMinutes;

    // Only active during market hours after 09:15
    if (mins < 9 * 60 + 15) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'PRE_MARKET',
        reason: 'Market pre-open. Awaiting 09:15 IST opening bell.'
      };
    }

    if (candles.length < 3) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'COLLECTING_BARS',
        reason: 'Building opening candle structure.'
      };
    }

    // Step 1: Synthesize First 15-Minute Candle (09:15 to 09:30 IST)
    const first15mCandle = this.extractFirst15mCandle(candles);
    const pdc = keyLevels.pdc || (candles[0].open - 15);
    const pdh = keyLevels.pdh || (pdc + 80);
    const pdl = keyLevels.pdl || (pdc - 80);

    // Step 2: Gap Classification
    const gapAnalysis = this.classifyOpeningGap(candles[0], pdc, keyLevels);

    // Step 3: First 15-min Candle Structure Analysis
    const candleStats = this.analyzeFirst15mStructure(first15mCandle, config);

    // Step 4: Generate 09:30 IST Day Plan
    const dayPlan = this.generateDayPlan(first15mCandle, gapAnalysis, keyLevels, driverData);

    // If currently between 09:15 and 09:30, output Day Plan forming
    if (mins < 9 * 60 + 30) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'DAY_PLAN_FORMING',
        dayPlan,
        gapAnalysis,
        first15mCandle,
        reason: 'First 15-min opening range building (09:15-09:30 IST). Stand aside.'
      };
    }

    // Step 5: Evaluate Active Trading Setups after 09:30 IST
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Filter A: Range Exhaustion or Squeeze Filter
    if (candleStats.isExhausted) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        dayPlan,
        reason: `Opening 15m range is oversized (${candleStats.range} pts > ${config.maxRangePts} max). High risk of intraday exhaustion; wait for pullback.`
      };
    }

    // Filter B: Inside Day Doji Filter
    if (candleStats.isInsideDoji && Math.abs(driverData.pressureScore || 0) < 15) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        dayPlan,
        reason: 'Opening 15m candle is a narrow Doji inside previous day range with neutral pressure. High probability chop day.'
      };
    }

    // Setup 1: Opening Range Breakout (ORB)
    if (config.allowOrbBreakout) {
      const orb = this.evaluateOrbBreakout(latest, prev, first15mCandle, config, driverData);
      if (orb) return { ...orb, module: this.MODULE_KEY, dayPlan, gapAnalysis };
    }

    // Setup 2: Failed-Breakout Reversal (Trap)
    if (config.allowFailedBreakoutReversal) {
      const reversal = this.evaluateFailedBreakout(candles, first15mCandle, config);
      if (reversal) return { ...reversal, module: this.MODULE_KEY, dayPlan, gapAnalysis };
    }

    // Setup 3: Gap-Fill Reversal
    if (config.allowGapFill && gapAnalysis.isGapFillCandidate) {
      const gapFill = this.evaluateGapFillTrade(latest, first15mCandle, pdc, gapAnalysis);
      if (gapFill) return { ...gapFill, module: this.MODULE_KEY, dayPlan, gapAnalysis };
    }

    return {
      module: this.MODULE_KEY,
      signal: 'WAIT',
      dayPlan,
      first15mCandle,
      reason: `Price (${latest.close}) oscillating inside 15m Opening Range [${first15mCandle.low} - ${first15mCandle.high}]. Awaiting confirmed 5m close outside range.`
    };
  },

  /**
   * Synthesize the 09:15 - 09:30 candle from historical bars
   */
  extractFirst15mCandle(candles) {
    // If candles are 5-minute bars, first 3 bars form the 15-min bar
    const openingBars = candles.slice(0, Math.min(3, candles.length));
    const open = openingBars[0].open;
    const high = Math.max(...openingBars.map((b) => b.high));
    const low = Math.min(...openingBars.map((b) => b.low));
    const close = openingBars[openingBars.length - 1].close;
    const volume = openingBars.reduce((sum, b) => sum + (b.volume || 0), 0);

    return { open, high, low, close, volume, range: Math.round((high - low) * 10) / 10 };
  },

  /**
   * Classify Gap: Gap and Go, Gap Fill, or Gap Trap
   */
  classifyOpeningGap(firstBar, pdc, keyLevels) {
    const gapPts = firstBar.open - pdc;
    const gapPct = parseFloat(((gapPts / pdc) * 100).toFixed(2));
    const absGap = Math.abs(gapPts);

    let type = 'FLAT';
    let candidate = 'RANGE_DAY';

    if (gapPts >= 35) {
      type = 'GAP_UP';
      candidate = gapPts > 90 ? 'GAP_TRAP' : 'GAP_AND_GO';
    } else if (gapPts <= -35) {
      type = 'GAP_DOWN';
      candidate = gapPts < -90 ? 'GAP_TRAP' : 'GAP_AND_GO';
    } else {
      type = 'FLAT_OPEN';
      candidate = 'INTRADAY_MEAN_REVERSION';
    }

    return {
      type,
      gapPts: Math.round(gapPts * 10) / 10,
      gapPct,
      candidate,
      isGapFillCandidate: absGap >= 35 && absGap <= 85
    };
  },

  analyzeFirst15mStructure(bar, config) {
    const range = bar.range;
    const body = Math.abs(bar.close - bar.open);
    const bodyPct = Math.round((body / range) * 100);
    const isExhausted = range > config.maxRangePts;
    const isCompressed = range < config.minRangePts;
    const isInsideDoji = (body / range) <= 0.15;

    return { range, bodyPct, isExhausted, isCompressed, isInsideDoji };
  },

  generateDayPlan(bar, gap, keyLevels, drivers) {
    let bias = 'NEUTRAL';
    const score = drivers.pressureScore || 0;

    if (gap.type === 'GAP_UP' && bar.close > bar.open && score > 15) {
      bias = 'BULLISH';
    } else if (gap.type === 'GAP_DOWN' && bar.close < bar.open && score < -15) {
      bias = 'BEARISH';
    }

    return {
      bias,
      orh: bar.high,
      orl: bar.low,
      rangePts: bar.range,
      levelsToWatch: {
        orh: bar.high,
        orl: bar.low,
        midpoint: Math.round(((bar.high + bar.low) / 2) * 10) / 10,
        pdh: keyLevels.pdh,
        pdl: keyLevels.pdl,
        vwap: keyLevels.vwap
      },
      actionTriggers: {
        bullishTrigger: `5m candle close above ORH (${bar.high}) with VIX stable/falling`,
        bearishTrigger: `5m candle close below ORL (${bar.low}) with VIX rising`
      }
    };
  },

  evaluateOrbBreakout(latest, prev, orBar, config, drivers) {
    const range = orBar.range;
    const midpoint = (orBar.high + orBar.low) / 2;

    // Bullish Breakout
    if (latest.close > orBar.high && prev.close <= orBar.high && drivers.pressureScore > 0) {
      const sl = config.slMode === 'MIDPOINT' ? midpoint : orBar.low;
      const risk = Math.max(15, latest.close - sl);
      const tp1 = latest.close + Math.max(range, risk * 1.0);
      const tp2 = latest.close + Math.max(range * 2.0, risk * 2.0);
      const rr = parseFloat(((tp2 - latest.close) / risk).toFixed(2));

      return {
        strategyName: 'Opening Range Breakout (Bullish 15m ORB)',
        signal: 'BUY',
        confidence: 84,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: Math.max(2.0, rr),
        invalidation: `Candle close back below 15m ORH (${orBar.high}).`,
        setupRationale: `Clean 5m close above 15m Opening Range High (${orBar.high}) with supporting Market Pressure Score (${drivers.pressureScore}).`,
        tradeManagement: 'Move Stop Loss to cost after reaching Target 1 (1x range).'
      };
    }

    // Bearish Breakout
    if (latest.close < orBar.low && prev.close >= orBar.low && drivers.pressureScore < 0) {
      const sl = config.slMode === 'MIDPOINT' ? midpoint : orBar.high;
      const risk = Math.max(15, sl - latest.close);
      const tp1 = latest.close - Math.max(range, risk * 1.0);
      const tp2 = latest.close - Math.max(range * 2.0, risk * 2.0);
      const rr = parseFloat(((latest.close - tp2) / risk).toFixed(2));

      return {
        strategyName: 'Opening Range Breakdown (Bearish 15m ORB)',
        signal: 'SELL',
        confidence: 84,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: Math.max(2.0, rr),
        invalidation: `Candle close back above 15m ORL (${orBar.low}).`,
        setupRationale: `Clean 5m close below 15m Opening Range Low (${orBar.low}) with bearish Market Pressure Score (${drivers.pressureScore}).`,
        tradeManagement: 'Move Stop Loss to cost after reaching Target 1 (1x range).'
      };
    }

    return null;
  },

  evaluateFailedBreakout(candles, orBar, config) {
    if (candles.length < 3) return null;
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Bullish Trap (Failed High Breakout) -> Short Reversal
    if (prev.high > orBar.high && prev.close > orBar.high && latest.close < orBar.high) {
      const sl = prev.high + 5;
      const risk = sl - latest.close;
      const tp1 = (orBar.high + orBar.low) / 2; // target midpoint
      const tp2 = orBar.low; // target opposite end

      return {
        strategyName: '15m ORB Failed Breakout Reversal (Bull Trap)',
        signal: 'SELL',
        confidence: 86,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((latest.close - tp1) / risk).toFixed(2)),
        invalidation: `New high above trap candle (${prev.high}).`,
        setupRationale: `Breakout buyers trapped above 15m ORH (${orBar.high}); price snapped back inside range with bearish engulfing.`
      };
    }

    // Bearish Trap (Failed Low Breakout) -> Long Reversal
    if (prev.low < orBar.low && prev.close < orBar.low && latest.close > orBar.low) {
      const sl = prev.low - 5;
      const risk = latest.close - sl;
      const tp1 = (orBar.high + orBar.low) / 2;
      const tp2 = orBar.high;

      return {
        strategyName: '15m ORB Failed Breakdown Reversal (Bear Trap)',
        signal: 'BUY',
        confidence: 86,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((tp1 - latest.close) / risk).toFixed(2)),
        invalidation: `New low below trap candle (${prev.low}).`,
        setupRationale: `Breakdown sellers trapped below 15m ORL (${orBar.low}); price snapped back inside range with strong rejection.`
      };
    }

    return null;
  },

  evaluateGapFillTrade(latest, orBar, pdc, gap) {
    if (gap.type === 'GAP_UP' && latest.close < orBar.low) {
      const sl = orBar.high;
      const risk = sl - latest.close;
      const tp1 = pdc;

      return {
        strategyName: 'Opening Gap-Fill Reversal (Fade Gap Up)',
        signal: 'SELL',
        confidence: 80,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: pdc,
        target2: pdc - 20,
        riskRewardRatio: parseFloat(((latest.close - pdc) / risk).toFixed(2)),
        invalidation: `Break of day high (${orBar.high}).`,
        setupRationale: `Gap-up failed to sustain; breakdown of 15m low targets Previous Day Close (PDC: ${pdc}).`
      };
    }

    return null;
  }
};
