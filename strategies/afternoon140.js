/**
 * TradeSight NIFTY 50 - Module C: 1:40 PM Afternoon Strategy (Experimental)
 * Operates in the 13:40 - 14:30 IST window.
 * Evaluates 12:00-13:40 range compression breakouts, trend continuations, and extreme reversals.
 * Hands strong directional setups to Module A (Hero-Zero) on expiry days.
 */

import { SessionClock } from '../services/sessionClock.js';

export const Afternoon140Strategy = {
  MODULE_KEY: 'AFTERNOON_140',

  DEFAULT_CONFIG: {
    enabled: true,
    startHour: 13,
    startMinute: 40,
    endHour: 14,
    endMinute: 30,
    compressionThresholdPts: 35, // 12:00-13:40 range < 35 pts indicates high-energy coiled spring
    allowCompressionBreakout: true,
    allowTrendContinuation: true,
    allowExtremeReversal: true,
    timeStopHour: 15,
    timeStopMinute: 10
  },

  /**
   * Main evaluation pipeline for 1:40 PM Module
   */
  evaluate({
    candles = [],
    keyLevels = {},
    driverData = {},
    pattern = null,
    regime = {},
    userConfig = {},
    currentTime = new Date()
  }) {
    const config = { ...this.DEFAULT_CONFIG, ...(userConfig?.strategies?.afternoon140 || {}) };
    if (!config.enabled) return null;

    const ist = SessionClock.getIstParts(currentTime);
    const mins = ist.totalMinutes;
    const startMins = config.startHour * 60 + config.startMinute; // 13:40 = 820 mins
    const endMins = config.endHour * 60 + config.endMinute;       // 14:30 = 870 mins

    // Time window gate: strictly 13:40 - 14:30 IST
    if (mins < startMins || mins > endMins) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: mins < startMins ? 'WINDOW_ARMING' : 'WINDOW_CLOSED',
        reason: mins < startMins
          ? `1:40 PM module arms at 13:40 IST (Current: ${ist.formattedTime}). Standing by.`
          : '1:40 PM window closed (> 14:30 IST). Afternoon setups concluded.'
      };
    }

    if (candles.length < 15) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        reason: 'Insufficient intraday candles for 12:00-13:40 range snapshot.'
      };
    }

    // Step 1: Snapshot 12:00 - 13:40 Midday Lunch Range
    const lunchSnapshot = this.snapshotLunchRange(candles);
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const vwap = keyLevels.vwap || latest.close;

    // Filter: Day range already exhausted (> 1.5x normal range)
    const dayHigh = Math.max(...candles.map((c) => c.high));
    const dayLow = Math.min(...candles.map((c) => c.low));
    const dayRange = dayHigh - dayLow;
    if (dayRange > 240) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        lunchSnapshot,
        reason: `Day range exhausted (${Math.round(dayRange)} pts > 240 pts limit). Risk of late-day chop or mean reversion.`
      };
    }

    // Scenario 1: Lunch Compression Breakout (High-volatility expansion)
    if (config.allowCompressionBreakout && lunchSnapshot.range <= config.compressionThresholdPts) {
      const compSig = this.evaluateCompressionBreakout(latest, prev, lunchSnapshot, driverData, keyLevels);
      if (compSig) return { ...compSig, module: this.MODULE_KEY, lunchSnapshot };
    }

    // Scenario 2: Trend Continuation Pullback to VWAP / EMA
    if (config.allowTrendContinuation && (regime.type === 'TRENDING_UP' || regime.type === 'TRENDING_DOWN')) {
      const contSig = this.evaluateTrendContinuation(latest, vwap, regime, pattern, driverData);
      if (contSig) return { ...contSig, module: this.MODULE_KEY, lunchSnapshot };
    }

    // Scenario 3: Extreme Reversal at Day High / Low
    if (config.allowExtremeReversal) {
      const revSig = this.evaluateExtremeReversal(latest, dayHigh, dayLow, vwap, pattern, driverData);
      if (revSig) return { ...revSig, module: this.MODULE_KEY, lunchSnapshot };
    }

    return {
      module: this.MODULE_KEY,
      signal: 'WAIT',
      lunchSnapshot,
      reason: `1:40 PM window active. Price (${latest.close}) oscillating inside lunch band [${lunchSnapshot.low} - ${lunchSnapshot.high}]. Awaiting directional expansion trigger.`
    };
  },

  /**
   * Extracts the range between 12:00 and 13:40
   */
  snapshotLunchRange(candles) {
    // Slice approximate 20 bars representing lunch phase
    const lunchBars = candles.slice(-20, -1);
    const high = Math.max(...lunchBars.map((b) => b.high));
    const low = Math.min(...lunchBars.map((b) => b.low));
    const range = Math.round((high - low) * 10) / 10;

    return {
      high,
      low,
      range,
      isCompressed: range <= 35,
      midpoint: Math.round(((high + low) / 2) * 10) / 10
    };
  },

  evaluateCompressionBreakout(latest, prev, lunch, drivers, keyLevels) {
    // Bullish Expansion above 12:00-13:40 high
    if (latest.close > lunch.high && prev.close <= lunch.high && drivers.pressureScore > 10) {
      const sl = lunch.midpoint;
      const risk = latest.close - sl;
      const tp1 = latest.close + lunch.range * 1.5;
      const tp2 = latest.close + lunch.range * 2.5;

      return {
        strategyName: '1:40 PM Compression Breakout (Bullish Expansion)',
        signal: 'BUY',
        confidence: 84,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((tp1 - latest.close) / risk).toFixed(2)),
        invalidation: `Candle close back below lunch midpoint (${lunch.midpoint}).`,
        setupRationale: `Coiled 12:00-13:40 compression band (${lunch.range} pts) broken with institutional afternoon volume.`
      };
    }

    // Bearish Expansion below 12:00-13:40 low
    if (latest.close < lunch.low && prev.close >= lunch.low && drivers.pressureScore < -10) {
      const sl = lunch.midpoint;
      const risk = sl - latest.close;
      const tp1 = latest.close - lunch.range * 1.5;
      const tp2 = latest.close - lunch.range * 2.5;

      return {
        strategyName: '1:40 PM Compression Breakdown (Bearish Expansion)',
        signal: 'SELL',
        confidence: 84,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(tp1 * 10) / 10,
        target2: Math.round(tp2 * 10) / 10,
        riskRewardRatio: parseFloat(((latest.close - tp1) / risk).toFixed(2)),
        invalidation: `Candle close back above lunch midpoint (${lunch.midpoint}).`,
        setupRationale: `Coiled 12:00-13:40 compression band (${lunch.range} pts) broken downward with institutional afternoon selling.`
      };
    }

    return null;
  },

  evaluateTrendContinuation(latest, vwap, regime, pattern, drivers) {
    // Bullish Trend Continuation
    if (regime.type === 'TRENDING_UP' && pattern && pattern.direction === 'BULLISH' && latest.low <= vwap + 15 && latest.close >= vwap) {
      const sl = vwap - 15;
      const risk = latest.close - sl;
      return {
        strategyName: '1:40 PM Trend Continuation (VWAP Bounce)',
        signal: 'BUY',
        confidence: 82,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close + risk * 2.2) * 10) / 10,
        target2: Math.round((latest.close + risk * 3.5) * 10) / 10,
        riskRewardRatio: 2.2,
        invalidation: `Decisive 5m close below VWAP (${vwap}).`,
        setupRationale: `Uptrend defended at VWAP during 1:40 PM institutional liquidity window with ${pattern.name}.`
      };
    }

    // Bearish Trend Continuation
    if (regime.type === 'TRENDING_DOWN' && pattern && pattern.direction === 'BEARISH' && latest.high >= vwap - 15 && latest.close <= vwap) {
      const sl = vwap + 15;
      const risk = sl - latest.close;
      return {
        strategyName: '1:40 PM Trend Continuation (VWAP Rejection)',
        signal: 'SELL',
        confidence: 82,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round((latest.close - risk * 2.2) * 10) / 10,
        target2: Math.round((latest.close - risk * 3.5) * 10) / 10,
        riskRewardRatio: 2.2,
        invalidation: `Decisive 5m close above VWAP (${vwap}).`,
        setupRationale: `Downtrend rejection at VWAP during 1:40 PM institutional liquidity window with ${pattern.name}.`
      };
    }

    return null;
  },

  evaluateExtremeReversal(latest, dayHigh, dayLow, vwap, pattern, drivers) {
    // Reversal off Day High sweep
    if (latest.high >= dayHigh - 5 && pattern && pattern.direction === 'BEARISH') {
      const sl = latest.high + 8;
      const risk = sl - latest.close;
      return {
        strategyName: '1:40 PM Extreme High Reversal (Mean Reversion)',
        signal: 'SELL',
        confidence: 81,
        entryPrice: latest.close,
        stopLoss: Math.round(sl * 10) / 10,
        target1: Math.round(vwap * 10) / 10,
        target2: Math.round(dayLow * 10) / 10,
        riskRewardRatio: 2.3,
        invalidation: `New day high above ${latest.high}.`,
        setupRationale: `Exhaustion at Day High with ${pattern.name}; reverting toward VWAP anchor.`
      };
    }

    return null;
  }
};
