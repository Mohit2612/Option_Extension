/**
 * TradeSight NIFTY 50 - Trade Quality Scorer (Module 3)
 * Evaluates every setup on a rigorous 0-100 scale using 8 weighted factors:
 *  1. Market regime suitability for the strategy (15%)
 *  2. Location quality (1M S/R, VWAP, OI, PDH/PDL) (15%)
 *  3. Candlestick pattern quality at that location (15%)
 *  4. Multi-timeframe alignment (15m trend vs 5m trigger) (15%)
 *  5. Market Pressure Score alignment (VIX, GIFT, Heavyweights, Breadth) (15%)
 *  6. Volume/momentum confirmation (10%)
 *  7. Risk:Reward ratio (minimum 1:2) (10%)
 *  8. Time-of-day quality and event proximity (5%)
 *
 * Grades:
 *  - Grade A (80+): Allowed (Full / Standard sizing)
 *  - Grade B (65-79): Allowed only if enabled, with reduced position size (default 0.75x)
 *  - Grade C (<65): Blocked ("Skip: Low Quality Setup")
 */

import { SessionClock } from './sessionClock.js';

export const TradeQualityScorer = {
  STORAGE_KEY: 'ts_trade_quality_config',

  DEFAULT_WEIGHTS: {
    regimeSuitability: 15,
    locationQuality: 15,
    patternQuality: 15,
    multiTimeframe: 15,
    marketPressure: 15,
    volumeMomentum: 10,
    riskReward: 10,
    timeOfDayEvent: 5
  },

  DEFAULT_CONFIG: {
    allowGradeB: true,
    gradeBSizeMultiplier: 0.75,
    gradeAThreshold: 80,
    gradeBThreshold: 65,
    weights: {
      regimeSuitability: 15,
      locationQuality: 15,
      patternQuality: 15,
      multiTimeframe: 15,
      marketPressure: 15,
      volumeMomentum: 10,
      riskReward: 10,
      timeOfDayEvent: 5
    }
  },

  /**
   * Main Quality Evaluation
   */
  evaluateQuality({
    signalData = {},
    candles = [],
    keyLevels = {},
    driverData = {},
    chartMeta = {},
    userConfig = {},
    currentTime = new Date()
  }) {
    const config = { ...this.DEFAULT_CONFIG, ...userConfig };
    const weights = { ...this.DEFAULT_WEIGHTS, ...(config.weights || {}) };

    // If signal is explicitly WAIT or missing, baseline evaluation
    const isWait = !signalData || signalData.signal === 'WAIT';
    const direction = signalData.signal || 'WAIT';
    const currentPrice = chartMeta.currentPrice || (candles.length > 0 ? candles[candles.length - 1].close : 24100);

    // 1. Market Regime Suitability (15%)
    const f1 = this._scoreRegimeSuitability(signalData, weights.regimeSuitability);

    // 2. Location Quality (15%)
    const f2 = this._scoreLocationQuality(currentPrice, keyLevels, signalData, weights.locationQuality);

    // 3. Candlestick Pattern Quality (15%)
    const f3 = this._scorePatternQuality(signalData, weights.patternQuality);

    // 4. Multi-Timeframe Alignment (15%)
    const f4 = this._scoreMultiTimeframe(candles, direction, weights.multiTimeframe);

    // 5. Market Pressure Score Alignment (15%)
    const f5 = this._scoreMarketPressure(direction, driverData, weights.marketPressure);

    // 6. Volume & Momentum Confirmation (10%)
    const f6 = this._scoreVolumeMomentum(candles, direction, weights.volumeMomentum);

    // 7. Risk:Reward Ratio (10%)
    const f7 = this._scoreRiskReward(signalData, weights.riskReward);

    // 8. Time-of-Day Quality & Event Proximity (5%)
    const f8 = this._scoreTimeOfDay(currentTime, weights.timeOfDayEvent);

    const breakdown = [f1, f2, f3, f4, f5, f6, f7, f8];

    // Compute Weighted Score (0 - 100)
    let totalScore = 0;
    breakdown.forEach((item) => {
      totalScore += item.weightedScore;
    });
    totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // If raw signal is WAIT, cap score to prevent accidental actionability
    if (isWait) {
      totalScore = Math.min(totalScore, 50);
    }

    // Determine Grade
    let grade = 'C';
    let isAllowed = false;
    let sizingMultiplier = 0.0;
    let gradeTitle = '';
    let statusLabel = '';
    let verdictText = '';
    let skipReason = null;

    const thresholdA = config.gradeAThreshold || 80;
    const thresholdB = config.gradeBThreshold || 65;
    const bMultiplier = config.gradeBSizeMultiplier || 0.75;

    if (totalScore >= thresholdA) {
      grade = 'A';
      isAllowed = !isWait;
      sizingMultiplier = 1.0;
      gradeTitle = `GRADE A (${totalScore}/100)`;
      statusLabel = isWait ? 'WAIT (No Trigger)' : 'ALLOWED (Full 1.0x Size)';
      verdictText = 'Prime Institutional Setup: Superior confluence across regime, location, momentum and risk-reward.';
    } else if (totalScore >= thresholdB) {
      grade = 'B';
      if (config.allowGradeB !== false && !isWait) {
        isAllowed = true;
        sizingMultiplier = bMultiplier;
        gradeTitle = `GRADE B (${totalScore}/100)`;
        statusLabel = `ALLOWED (Reduced ${bMultiplier}x Size)`;
        verdictText = `Moderate Quality Setup: Acceptable edge, but position size is cut by ${Math.round((1 - bMultiplier) * 100)}% due to minor factor divergences.`;
      } else {
        isAllowed = false;
        sizingMultiplier = 0.0;
        gradeTitle = `GRADE B (${totalScore}/100)`;
        statusLabel = 'SKIP (Grade B Disabled)';
        verdictText = 'Grade B setup detected, but trader configuration strictly permits only Grade A setups.';
        skipReason = 'Trader rule: Grade B trades disabled in discipline settings.';
      }
    } else {
      grade = 'C';
      isAllowed = false;
      sizingMultiplier = 0.0;
      gradeTitle = `GRADE C (${totalScore}/100)`;
      statusLabel = 'SKIP (Low Quality <65)';
      verdictText = 'Sub-optimal Setup: Fails institutional quality threshold. High probability of chop or poor risk-reward.';
      skipReason = `Trade quality score (${totalScore}/100) is below the minimum Grade B threshold (${thresholdB}). 30-Year Rule: Skip low-quality setups to preserve capital.`;
    }

    return {
      totalScore,
      grade,
      isAllowed,
      sizingMultiplier,
      gradeTitle,
      statusLabel,
      verdictText,
      skipReason,
      breakdown
    };
  },

  /* ----------------- INDIVIDUAL FACTOR SCORERS ----------------- */

  /**
   * 1. Market Regime Suitability (15%)
   */
  _scoreRegimeSuitability(signalData, weight) {
    const regime = signalData.regime?.label || 'Neutral / Developing';
    const strat = signalData.strategyName || '';
    const signal = signalData.signal;

    let rawScore = 60;
    let note = 'Neutral market regime suitability.';

    if (regime.includes('Trend') || regime.includes('Expansion')) {
      if (strat.includes('ORB') || strat.includes('Breakout') || strat.includes('EMA') || strat.includes('VWAP Trend')) {
        rawScore = 95;
        note = `Trend regime (${regime}) perfectly complements directional strategy '${strat}'.`;
      } else if (strat.includes('Reversal') || strat.includes('Sweep')) {
        rawScore = 65;
        note = 'Reversal strategy running in strong directional trend. Higher caution.';
      } else {
        rawScore = 80;
        note = `Trend regime aligns with ${signal} direction.`;
      }
    } else if (regime.includes('Range') || regime.includes('Consolidation') || regime.includes('Compression')) {
      if (strat.includes('Sweep') || strat.includes('Reversal') || strat.includes('Floor/Ceiling')) {
        rawScore = 90;
        note = `Range-bound regime favors edge-of-range rejection '${strat}'.`;
      } else if (strat.includes('Breakout') || strat.includes('ORB')) {
        rawScore = 40;
        note = 'Breakout strategy in choppy range has high false-breakout risk.';
      } else {
        rawScore = 60;
        note = 'Range regime: Wait for extreme boundary test.';
      }
    } else if (regime.includes('High Volatility') || regime.includes('Event')) {
      if (strat.includes('Hero-Zero')) {
        rawScore = 85;
        note = 'Volatility spike supports gamma expansion strategy.';
      } else {
        rawScore = 45;
        note = 'High volatility widens required stops and increases whipsaw risk.';
      }
    }

    return {
      key: 'regimeSuitability',
      name: 'Market Regime Suitability',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 2. Location Quality (15%)
   */
  _scoreLocationQuality(currentPrice, keyLevels, signalData, weight) {
    let rawScore = 40;
    let note = 'Price is mid-range without immediate structural confluence (Chop danger).';

    if (!keyLevels) {
      return { key: 'locationQuality', name: 'Location Quality', weight, rawScore: 50, weightedScore: (50 * weight) / 100, note: 'Default location baseline.' };
    }

    const distTo1MRes = keyLevels.majorResistance ? Math.abs(currentPrice - keyLevels.majorResistance) : 999;
    const distTo1MSup = keyLevels.majorSupport ? Math.abs(currentPrice - keyLevels.majorSupport) : 999;
    const distToVwap = keyLevels.vwap ? Math.abs(currentPrice - keyLevels.vwap) : 999;
    const distToPdh = keyLevels.pdh ? Math.abs(currentPrice - keyLevels.pdh) : 999;
    const distToPdl = keyLevels.pdl ? Math.abs(currentPrice - keyLevels.pdl) : 999;
    const distToOi = Math.min(
      keyLevels.maxCallOi ? Math.abs(currentPrice - keyLevels.maxCallOi) : 999,
      keyLevels.maxPutOi ? Math.abs(currentPrice - keyLevels.maxPutOi) : 999
    );

    const minDist = Math.min(distTo1MRes, distTo1MSup, distToVwap, distToPdh, distToPdl, distToOi);

    if (distTo1MSup <= 15 && signalData.signal === 'BUY') {
      rawScore = 100;
      note = `At Major 1-Month Support (${keyLevels.majorSupport}). Ideal institutional long entry location.`;
    } else if (distTo1MRes <= 15 && signalData.signal === 'SELL') {
      rawScore = 100;
      note = `At Major 1-Month Resistance (${keyLevels.majorResistance}). Ideal institutional short entry location.`;
    } else if (distToPdl <= 12 && signalData.signal === 'BUY') {
      rawScore = 90;
      note = `Tested Previous Day Low (${keyLevels.pdl}). Favorable liquidity sweep location.`;
    } else if (distToPdh <= 12 && signalData.signal === 'SELL') {
      rawScore = 90;
      note = `Tested Previous Day High (${keyLevels.pdh}). Favorable liquidity sweep location.`;
    } else if (distToVwap <= 10) {
      rawScore = 85;
      note = `In tight confluence with VWAP (${Math.round(keyLevels.vwap)}). High institutional volume anchor.`;
    } else if (distToOi <= 20) {
      rawScore = 80;
      note = 'Near Maximum Open Interest wall (Option seller defense zone).';
    } else if (minDist > 30) {
      rawScore = 35;
      note = 'Mid-range location (>30 pts from key levels). Chasing price without floor/ceiling support.';
    } else {
      rawScore = 65;
      note = 'Moderate proximity to intraday reference levels.';
    }

    return {
      key: 'locationQuality',
      name: 'Location Quality (S/R, VWAP, OI)',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 3. Candlestick Pattern Quality at that location (15%)
   */
  _scorePatternQuality(signalData, weight) {
    const pattern = signalData.pattern;
    const patternName = signalData.patternName || pattern?.name;

    let rawScore = 40;
    let note = 'No decisive candlestick confirmation detected.';

    if (pattern && pattern.isActionable) {
      const pName = (patternName || '').toLowerCase();
      if (pName.includes('hammer') || pName.includes('pinbar') || pName.includes('shooting star') || pName.includes('engulfing')) {
        rawScore = 95;
        note = `High-conviction candlestick formation: ${patternName} with pronounced rejection tail.`;
      } else if (pName.includes('star') || pName.includes('soldiers') || pName.includes('crows') || pName.includes('marubozu')) {
        rawScore = 85;
        note = `Strong momentum / transition candle: ${patternName}.`;
      } else if (pName.includes('harami') || pName.includes('piercing') || pName.includes('tweezer')) {
        rawScore = 75;
        note = `Valid two-candle pattern: ${patternName}.`;
      } else {
        rawScore = 65;
        note = `Detected ${patternName}, but body-to-wick ratio is moderate.`;
      }
    } else if (pattern) {
      rawScore = 50;
      note = `${patternName || 'Pattern'} formed away from primary key level (Filter active).`;
    }

    return {
      key: 'patternQuality',
      name: 'Candlestick Pattern Quality',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 4. Multi-Timeframe Alignment (15m trend vs 5m trigger) (15%)
   */
  _scoreMultiTimeframe(candles, direction, weight) {
    let rawScore = 60;
    let note = 'Multi-timeframe trend alignment is neutral.';

    if (!candles || candles.length < 10) {
      return { key: 'multiTimeframe', name: 'Multi-Timeframe Alignment', weight, rawScore: 60, weightedScore: (60 * weight) / 100, note };
    }

    // Estimate 15m trend using last 15 bars vs 5 bars
    const recent5 = candles.slice(-5);
    const older10 = candles.slice(-15, -5);

    const avgRecent = recent5.reduce((sum, c) => sum + c.close, 0) / recent5.length;
    const avgOlder = older10.length > 0 ? older10.reduce((sum, c) => sum + c.close, 0) / older10.length : avgRecent;

    const isHigherTfBullish = avgRecent > avgOlder + 5;
    const isHigherTfBearish = avgRecent < avgOlder - 5;

    if (direction === 'BUY') {
      if (isHigherTfBullish) {
        rawScore = 95;
        note = '15m higher-timeframe trend aligns bullishly with 5m BUY trigger.';
      } else if (isHigherTfBearish) {
        rawScore = 35;
        note = 'Counter-trend: 5m BUY trigger against a falling 15m trend structure.';
      } else {
        rawScore = 70;
        note = 'Higher timeframe is consolidating; breakout trigger has moderate follow-through.';
      }
    } else if (direction === 'SELL') {
      if (isHigherTfBearish) {
        rawScore = 95;
        note = '15m higher-timeframe trend aligns bearishly with 5m SELL trigger.';
      } else if (isHigherTfBullish) {
        rawScore = 35;
        note = 'Counter-trend: 5m SELL trigger against a rising 15m trend structure.';
      } else {
        rawScore = 70;
        note = 'Higher timeframe is consolidating; breakdown trigger has moderate follow-through.';
      }
    }

    return {
      key: 'multiTimeframe',
      name: 'Multi-Timeframe Alignment (15m vs 5m)',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 5. Market Pressure Score Alignment (15%)
   */
  _scoreMarketPressure(direction, driverData, weight) {
    const score = driverData.pressureScore || 0;
    let rawScore = 55;
    let note = `Market Pressure Score (${score > 0 ? '+' : ''}${score}) is neutral.`;

    if (direction === 'BUY') {
      if (score >= 35) {
        rawScore = 100;
        note = `Heavy institutional tailwind: Pressure score (+${score}) strongly supports Longs.`;
      } else if (score >= 15) {
        rawScore = 80;
        note = `Positive market breadth (+${score}) supports BUY setup.`;
      } else if (score <= -25) {
        rawScore = 20;
        note = `Severe Headwind: Pressure score (${score}) is heavily bearish against BUY setup.`;
      } else if (score < 0) {
        rawScore = 40;
        note = `Mild negative bias (${score}) creates drag on BUY momentum.`;
      }
    } else if (direction === 'SELL') {
      if (score <= -35) {
        rawScore = 100;
        note = `Heavy institutional selling pressure (${score}) strongly confirms Short.`;
      } else if (score <= -15) {
        rawScore = 80;
        note = `Negative market breadth (${score}) supports SELL setup.`;
      } else if (score >= 25) {
        rawScore = 20;
        note = `Severe Headwind: Pressure score (+${score}) is heavily bullish against SELL setup.`;
      } else if (score > 0) {
        rawScore = 40;
        note = `Mild positive bias (+${score}) creates drag on SELL momentum.`;
      }
    }

    return {
      key: 'marketPressure',
      name: 'Market Pressure Alignment (Drivers & VIX)',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 6. Volume & Momentum Confirmation (10%)
   */
  _scoreVolumeMomentum(candles, direction, weight) {
    let rawScore = 60;
    let note = 'Average volume activity without volume expansion.';

    if (!candles || candles.length < 5) {
      return { key: 'volumeMomentum', name: 'Volume & Momentum', weight, rawScore: 60, weightedScore: (60 * weight) / 100, note };
    }

    const latest = candles[candles.length - 1];
    const prevCandles = candles.slice(-21, -1);
    const avgVol = prevCandles.length > 0 ? prevCandles.reduce((sum, c) => sum + (c.volume || 40000), 0) / prevCandles.length : 40000;
    const currentVol = latest.volume || 40000;
    const volRatio = parseFloat((currentVol / avgVol).toFixed(2));

    if (volRatio >= 1.5) {
      rawScore = 95;
      note = `Institutional volume surge (${volRatio}x 20-period avg) confirms active commitment.`;
    } else if (volRatio >= 1.2) {
      rawScore = 80;
      note = `Above-average volume expansion (${volRatio}x avg) confirms breakout.`;
    } else if (volRatio >= 0.9) {
      rawScore = 65;
      note = `Normal liquidity conditions (${volRatio}x avg).`;
    } else {
      rawScore = 35;
      note = `Dry / anemic volume (${volRatio}x avg). High risk of false breakout / low liquidity trap.`;
    }

    return {
      key: 'volumeMomentum',
      name: 'Volume & Momentum Confirmation',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 7. Risk:Reward Ratio (minimum 1:2) (10%)
   */
  _scoreRiskReward(signalData, weight) {
    let rr = 2.0;

    if (signalData.levels?.riskRewardRatio) {
      rr = parseFloat(signalData.levels.riskRewardRatio);
    } else if (signalData.levels?.entryPrice && signalData.levels?.stopLoss && signalData.levels?.target1) {
      const risk = Math.abs(signalData.levels.entryPrice - signalData.levels.stopLoss);
      const reward = Math.abs(signalData.levels.target1 - signalData.levels.entryPrice);
      rr = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 2.0;
    }

    let rawScore = 50;
    let note = `R:R is 1:${rr}.`;

    if (rr >= 3.0) {
      rawScore = 100;
      note = `Exceptional Risk:Reward (1:${rr}). Gives massive statistical expectancy.`;
    } else if (rr >= 2.5) {
      rawScore = 90;
      note = `Strong Risk:Reward (1:${rr}). High profit-to-risk ratio.`;
    } else if (rr >= 2.0) {
      rawScore = 80;
      note = `Meets institutional minimum standard (1:${rr} R:R).`;
    } else if (rr >= 1.7) {
      rawScore = 50;
      note = `Sub-optimal Risk:Reward (1:${rr}). Below 1:2.0 institutional threshold.`;
    } else {
      rawScore = 20;
      note = `Poor Risk:Reward (1:${rr}). Trading inverted or poor asymmetry destroys capital over time.`;
    }

    return {
      key: 'riskReward',
      name: 'Risk:Reward Ratio (Min 1:2.0)',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  },

  /**
   * 8. Time-of-Day Quality & Event Proximity (5%)
   */
  _scoreTimeOfDay(currentTime, weight) {
    const ist = SessionClock.getIstParts(currentTime);
    const mins = ist.totalMinutes;

    let rawScore = 60;
    let note = 'Standard time window.';

    // 09:20 - 10:30 (Prime Opening Momentum)
    if (mins >= 9 * 60 + 20 && mins <= 10 * 60 + 30) {
      rawScore = 100;
      note = 'Prime Morning Momentum (09:20 - 10:30 IST). Highest liquidity and clean follow-through.';
    }
    // 10:30 - 11:30 (Morning Follow-through)
    else if (mins > 10 * 60 + 30 && mins <= 11 * 60 + 30) {
      rawScore = 85;
      note = 'Morning Continuation window (10:30 - 11:30 IST). Good trend durability.';
    }
    // 11:30 - 13:30 (Midday Chop Zone)
    else if (mins > 11 * 60 + 30 && mins < 13 * 60 + 40) {
      rawScore = 25;
      note = 'Midday Chop Zone (11:30 - 13:30 IST). Low institutional participation; high failure rate.';
    }
    // 13:40 - 14:45 (Afternoon Institutional & Expiry Gamma)
    else if (mins >= 13 * 60 + 40 && mins <= 14 * 60 + 45) {
      rawScore = 95;
      note = 'Afternoon Expansion Window (13:40 - 14:45 IST). European overlap and expiry gamma burst.';
    }
    // 14:45 - 15:30 (Late session decay trap)
    else {
      rawScore = 40;
      note = 'Late Session (Post-14:45 IST). Option sellers square off; intraday decay traps.';
    }

    return {
      key: 'timeOfDayEvent',
      name: 'Time-of-Day Quality',
      weight,
      rawScore,
      weightedScore: (rawScore * weight) / 100,
      note
    };
  }
};
