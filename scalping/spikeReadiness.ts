/**
 * TradeSight NIFTY 50 - Spike Readiness Engine (Stage 1)
 * Computes pre-spike probability (0-100) based on volatility compression,
 * key level coiling, volume absorption, time windows, options OI, and intermarket drivers.
 *
 * CRITICAL RULE: High readiness indicates rising probability of an expansion move,
 * NOT a directional certainty. Direction is always labeled as a tentative 'lean'.
 */

export type SpikeState = 'CALM' | 'BUILDING' | 'SPIKE_RISK_HIGH';
export type DirectionLean = 'UP' | 'DOWN' | 'UNCLEAR';

export interface SpikeFactorScore {
  score: number;       // 0 - factorMax
  maxScore: number;
  label: string;
  detail: string;
  lean: DirectionLean;
}

export interface SpikeReadinessResult {
  score: number;       // 0 - 100
  state: SpikeState;
  stateLabel: string;
  directionLean: DirectionLean;
  leanConfidence: 'LOW' | 'MODERATE' | 'CONFIRMED_ON_BREAKOUT';
  watchedKeyLevel: string;
  distanceToLevel: number;
  topContributingFactors: string[];
  factors: {
    volatilityCompression: SpikeFactorScore;
    locationCoiling: SpikeFactorScore;
    volumeAbsorption: SpikeFactorScore;
    timeProximity: SpikeFactorScore;
    optionsContext: SpikeFactorScore;
    driverAlignment: SpikeFactorScore;
    orderFlowProxies: SpikeFactorScore;
    momentumIgnition: SpikeFactorScore;
  };
  disclaimer: string;
}

export interface SpikeReadinessInput {
  candles: Array<{ open: number; high: number; low: number; close: number; volume: number }>;
  currentPrice: number;
  keyLevels: {
    pdh?: number; pdl?: number; vwap?: number; orh?: number; orl?: number;
    monthHigh?: number; monthLow?: number; monthPivot?: number;
    maxCallOi?: number; maxPutOi?: number; roundLevel?: number;
  };
  driverData?: {
    totalPressure?: number; vix?: number; vixChangePct?: number;
    heavyweightsTrend?: string; bankNiftyTrend?: string;
  };
  optionsData?: {
    pcr?: number; pcrChange?: number; atmIv?: number; ivChangePct?: number;
    writerUnwindingSide?: 'CALLS' | 'PUTS' | 'NONE';
  };
  orderFlowData?: {
    buyDepthTotal?: number; sellDepthTotal?: number;
    ticksPerSecond?: number; avgTicksPerSecond?: number;
  };
  currentTime?: Date;
  isExpiryDay?: boolean;
}

export const SpikeReadiness = {
  /**
   * Pure evaluation of Spike Readiness Score (0-100)
   */
  evaluate(input: SpikeReadinessInput): SpikeReadinessResult {
    const candles = input.candles || [];
    const currentPrice = input.currentPrice || 24100;
    const now = input.currentTime || new Date();
    const keyLevels = input.keyLevels || {};
    const driverData = input.driverData || {};
    const optionsData = input.optionsData || {};
    const orderFlowData = input.orderFlowData || {};

    // 1. VOLATILITY COMPRESSION (Max 20 pts)
    const compFactor = this.evaluateCompression(candles);

    // 2. LOCATION COILING NEAR KEY LEVEL (Max 20 pts)
    const locFactor = this.evaluateLocationCoiling(currentPrice, keyLevels);

    // 3. VOLUME ABSORPTION / DRY-UP (Max 15 pts)
    const volFactor = this.evaluateVolumeAbsorption(candles);

    // 4. TIME PROXIMITY & MACRO COUNTDOWN (Max 10 pts)
    const timeFactor = this.evaluateTimeProximity(now, input.isExpiryDay);

    // 5. OPTIONS CONTEXT (Max 15 pts)
    const optFactor = this.evaluateOptionsContext(optionsData);

    // 6. DRIVER & INTERMARKET ALIGNMENT (Max 10 pts)
    const driverFactor = this.evaluateDriverAlignment(driverData);

    // 7. ORDER-FLOW PROXIES (Max 5 pts)
    const flowFactor = this.evaluateOrderFlow(orderFlowData);

    // 8. MOMENTUM IGNITION (Max 5 pts)
    const ignFactor = this.evaluateMomentumIgnition(candles, orderFlowData);

    // Total Score
    const totalScore = Math.min(100, Math.round(
      compFactor.score +
      locFactor.score +
      volFactor.score +
      timeFactor.score +
      optFactor.score +
      driverFactor.score +
      flowFactor.score +
      ignFactor.score
    ));

    // Determine State
    let state: SpikeState = 'CALM';
    let stateLabel = 'CALM (Normal Range)';
    if (totalScore >= 70) {
      state = 'SPIKE_RISK_HIGH';
      stateLabel = '⚡ SPIKE RISK HIGH (Imminent Expansion)';
    } else if (totalScore >= 40) {
      state = 'BUILDING';
      stateLabel = '⏳ BUILDING (Coiling Phase)';
    }

    // Determine Directional Lean
    const upVotes = [compFactor, locFactor, volFactor, optFactor, driverFactor, flowFactor, ignFactor]
      .filter((f) => f.lean === 'UP').length;
    const downVotes = [compFactor, locFactor, volFactor, optFactor, driverFactor, flowFactor, ignFactor]
      .filter((f) => f.lean === 'DOWN').length;

    let directionLean: DirectionLean = 'UNCLEAR';
    if (upVotes >= downVotes + 2) directionLean = 'UP';
    else if (downVotes >= upVotes + 2) directionLean = 'DOWN';

    // Top Contributing Factors
    const factorList = [
      { name: compFactor.label, score: compFactor.score, max: compFactor.maxScore, detail: compFactor.detail },
      { name: locFactor.label, score: locFactor.score, max: locFactor.maxScore, detail: locFactor.detail },
      { name: volFactor.label, score: volFactor.score, max: volFactor.maxScore, detail: volFactor.detail },
      { name: timeFactor.label, score: timeFactor.score, max: timeFactor.maxScore, detail: timeFactor.detail },
      { name: optFactor.label, score: optFactor.score, max: optFactor.maxScore, detail: optFactor.detail },
      { name: driverFactor.label, score: driverFactor.score, max: driverFactor.maxScore, detail: driverFactor.detail },
      { name: flowFactor.label, score: flowFactor.score, max: flowFactor.maxScore, detail: flowFactor.detail },
      { name: ignFactor.label, score: ignFactor.score, max: ignFactor.maxScore, detail: ignFactor.detail }
    ];

    factorList.sort((a, b) => (b.score / b.max) - (a.score / a.max));
    const topContributingFactors = factorList
      .filter((f) => f.score > 0)
      .slice(0, 3)
      .map((f) => `${f.name}: ${f.detail}`);

    return {
      score: totalScore,
      state,
      stateLabel,
      directionLean,
      leanConfidence: 'LOW', // Never claim certainty prior to confirmed breakout
      watchedKeyLevel: locFactor.detail.split('(')[0].trim(),
      distanceToLevel: parseFloat(locFactor.detail.match(/(\d+\.?\d*)\s*pts/)?.[1] || '0'),
      topContributingFactors,
      factors: {
        volatilityCompression: compFactor,
        locationCoiling: locFactor,
        volumeAbsorption: volFactor,
        timeProximity: timeFactor,
        optionsContext: optFactor,
        driverAlignment: driverFactor,
        orderFlowProxies: flowFactor,
        momentumIgnition: ignFactor
      },
      disclaimer: 'Spike Readiness is a probabilistic gauge of impending volatility, not a directional prediction. Wait for confirmed trigger breakout.'
    };
  },

  /**
   * 1. Volatility Compression
   */
  evaluateCompression(candles: Array<any>): SpikeFactorScore {
    if (candles.length < 7) {
      return { score: 5, maxScore: 20, label: 'Compression', detail: 'Insufficient candle history for squeeze detection', lean: 'UNCLEAR' };
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const last7 = candles.slice(-7);
    const ranges = last7.map((c) => c.high - c.low);
    const minRange7 = Math.min(...ranges);
    const currentRange = last.high - last.low;

    // Check NR7 (Narrowest Range in 7 candles) or NR4
    const isNR7 = currentRange <= minRange7 + 0.5;
    const isInsideBar = last.high <= prev.high && last.low >= prev.low;

    // ATR comparison
    const avgRange20 = candles.slice(-20).reduce((acc, c) => acc + (c.high - c.low), 0) / Math.min(20, candles.length);
    const isAtrContracted = currentRange < avgRange20 * 0.65;

    let score = 4;
    const details: string[] = [];

    if (isNR7) {
      score += 8;
      details.push('NR7 Narrowest Range');
    }
    if (isInsideBar) {
      score += 4;
      details.push('Inside-bar coiling');
    }
    if (isAtrContracted) {
      score += 4;
      details.push(`ATR contraction (${currentRange.toFixed(1)} vs ${avgRange20.toFixed(1)} avg)`);
    }

    return {
      score: Math.min(20, score),
      maxScore: 20,
      label: 'Volatility Compression',
      detail: details.join(' • ') || 'Normal range expansion',
      lean: 'UNCLEAR'
    };
  },

  /**
   * 2. Location Coiling Near Key Level
   */
  evaluateLocationCoiling(price: number, keyLevels: Record<string, any>): SpikeFactorScore {
    const candidates: Array<{ name: string; price: number; type: string }> = [];

    if (keyLevels.pdh) candidates.push({ name: 'Previous Day High (PDH)', price: keyLevels.pdh, type: 'RESISTANCE' });
    if (keyLevels.pdl) candidates.push({ name: 'Previous Day Low (PDL)', price: keyLevels.pdl, type: 'SUPPORT' });
    if (keyLevels.vwap) candidates.push({ name: 'Session VWAP', price: keyLevels.vwap, type: 'PIVOT' });
    if (keyLevels.orh) candidates.push({ name: 'Opening Range High (ORH)', price: keyLevels.orh, type: 'RESISTANCE' });
    if (keyLevels.orl) candidates.push({ name: 'Opening Range Low (ORL)', price: keyLevels.orl, type: 'SUPPORT' });
    if (keyLevels.maxCallOi) candidates.push({ name: `Call OI Wall (${keyLevels.maxCallOi})`, price: keyLevels.maxCallOi, type: 'RESISTANCE' });
    if (keyLevels.maxPutOi) candidates.push({ name: `Put OI Wall (${keyLevels.maxPutOi})`, price: keyLevels.maxPutOi, type: 'SUPPORT' });

    // Round number xx000 or xx500
    const roundNumber = Math.round(price / 500) * 500;
    candidates.push({ name: `Round Strike (${roundNumber})`, price: roundNumber, type: 'PIVOT' });

    let closest = candidates[0] || { name: 'VWAP', price, type: 'PIVOT' };
    let minDistance = 9999;

    for (const c of candidates) {
      const dist = Math.abs(price - c.price);
      if (dist < minDistance) {
        minDistance = dist;
        closest = c;
      }
    }

    let score = 0;
    let lean: DirectionLean = 'UNCLEAR';

    if (minDistance <= 8) {
      score = 20;
    } else if (minDistance <= 18) {
      score = 14;
    } else if (minDistance <= 30) {
      score = 8;
    } else {
      score = 3;
    }

    if (closest.type === 'SUPPORT' && price >= closest.price) lean = 'UP';
    else if (closest.type === 'RESISTANCE' && price <= closest.price) lean = 'DOWN';

    return {
      score,
      maxScore: 20,
      label: 'Key Level Proximity',
      detail: `${closest.name} (${minDistance.toFixed(1)} pts away)`,
      lean
    };
  },

  /**
   * 3. Volume Absorption / Dry-Up
   */
  evaluateVolumeAbsorption(candles: Array<any>): SpikeFactorScore {
    if (candles.length < 5) return { score: 3, maxScore: 15, label: 'Volume Participation', detail: 'Normal volume baseline', lean: 'UNCLEAR' };

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const avgVol = candles.slice(-15).reduce((acc, c) => acc + (c.volume || 0), 0) / 15;

    // Absorption: Higher volume with smaller price range
    const isAbsorption = last.volume > avgVol * 1.3 && (last.high - last.low) < (prev.high - prev.low);
    // Dry-up: Volume collapsing right before breakout
    const isDryUp = last.volume < avgVol * 0.45;

    let score = 3;
    let detail = 'Average participation';
    let lean: DirectionLean = 'UNCLEAR';

    if (isAbsorption) {
      score = 15;
      detail = `Volume absorption detected (${Math.round(last.volume / 1000)}k vs ${Math.round(avgVol / 1000)}k avg)`;
      lean = last.close >= (last.high + last.low) / 2 ? 'UP' : 'DOWN';
    } else if (isDryUp) {
      score = 12;
      detail = 'Volume dry-up (pre-expansion calm)';
    } else if (last.volume > avgVol * 1.5) {
      score = 10;
      detail = 'Rising participation volume';
    }

    return { score, maxScore: 15, label: 'Volume Dynamics', detail, lean };
  },

  /**
   * 4. Time Proximity & Volatility Windows
   */
  evaluateTimeProximity(now: Date, isExpiry = false): SpikeFactorScore {
    const hours = now.getHours();
    const mins = now.getMinutes();
    const totalMinutes = hours * 60 + mins;

    let score = 2;
    let detail = 'Standard intraday window';

    // 09:15 - 09:30 (Opening Bell Volatility)
    if (totalMinutes >= 9 * 60 + 15 && totalMinutes <= 9 * 60 + 30) {
      score = 10;
      detail = 'Opening Range establishment window (09:15-09:30)';
    }
    // 09:55 - 10:10 (Institutional Trend Anchor)
    else if (totalMinutes >= 9 * 60 + 55 && totalMinutes <= 10 * 60 + 10) {
      score = 8;
      detail = '10:00 AM Institutional Positioning window';
    }
    // 13:40 - 14:30 (European Open Crossover & Hero-Zero)
    else if (totalMinutes >= 13 * 60 + 40 && totalMinutes <= 14 * 60 + 30) {
      score = isExpiry ? 10 : 9;
      detail = isExpiry ? '⚡ Expiry Hero-Zero Gamma Window (13:40-14:30)' : 'European opening expansion window (13:40-14:30)';
    }
    // 15:00 - 15:25 (Market Close Delta/Gamma Unwinding)
    else if (totalMinutes >= 15 * 60 && totalMinutes <= 15 * 60 + 25) {
      score = 8;
      detail = 'Closing MOC squaring & gamma unwinding (15:00-15:25)';
    }

    return { score, maxScore: 10, label: 'Time-Window Factor', detail, lean: 'UNCLEAR' };
  },

  /**
   * 5. Options Context
   */
  evaluateOptionsContext(opts: Record<string, any>): SpikeFactorScore {
    let score = 2;
    const details: string[] = [];
    let lean: DirectionLean = 'UNCLEAR';

    if (opts.writerUnwindingSide === 'CALLS') {
      score += 7;
      details.push('Call writers unwinding (short squeeze trigger)');
      lean = 'UP';
    } else if (opts.writerUnwindingSide === 'PUTS') {
      score += 7;
      details.push('Put writers fleeing (long liquidation risk)');
      lean = 'DOWN';
    }

    if (opts.ivChangePct && opts.ivChangePct > 3.0) {
      score += 4;
      details.push(`IV spiking (+${opts.ivChangePct.toFixed(1)}%)`);
    }

    if (opts.pcrChange && Math.abs(opts.pcrChange) > 0.15) {
      score += 4;
      details.push(`Sharp PCR shift (${opts.pcrChange > 0 ? '+' : ''}${opts.pcrChange.toFixed(2)})`);
      if (lean === 'UNCLEAR') lean = opts.pcrChange > 0 ? 'UP' : 'DOWN';
    }

    return {
      score: Math.min(15, Math.max(2, score)),
      maxScore: 15,
      label: 'Options Market Context',
      detail: details.join(' • ') || 'Options open interest stable',
      lean
    };
  },

  /**
   * 6. Driver & Intermarket Alignment
   */
  evaluateDriverAlignment(drivers: Record<string, any>): SpikeFactorScore {
    let score = 2;
    let detail = 'Intermarket drivers quiet';
    let lean: DirectionLean = 'UNCLEAR';

    const vixDelta = drivers.vixChangePct || 0;
    const pressure = drivers.totalPressure || 0;

    if (Math.abs(vixDelta) >= 3.0) {
      score += 5;
      detail = `India VIX active (${vixDelta > 0 ? '+' : ''}${vixDelta.toFixed(1)}%)`;
    }

    if (Math.abs(pressure) >= 40) {
      score += 4;
      lean = pressure > 0 ? 'UP' : 'DOWN';
      detail += ` • Driver pressure ${pressure > 0 ? '+' : ''}${pressure}`;
    }

    return {
      score: Math.min(10, score),
      maxScore: 10,
      label: 'Intermarket Drivers',
      detail,
      lean
    };
  },

  /**
   * 7. Order-Flow Proxies
   */
  evaluateOrderFlow(flow: Record<string, any>): SpikeFactorScore {
    let score = 1;
    let detail = 'Balanced depth';
    let lean: DirectionLean = 'UNCLEAR';

    const buyDepth = flow.buyDepthTotal || 1;
    const sellDepth = flow.sellDepthTotal || 1;
    const ratio = buyDepth / Math.max(1, sellDepth);

    if (ratio > 1.5) {
      score = 5;
      lean = 'UP';
      detail = `Heavy bid imbalance (${ratio.toFixed(2)}x buyers)`;
    } else if (ratio < 0.65) {
      score = 5;
      lean = 'DOWN';
      detail = `Heavy ask imbalance (${(1 / ratio).toFixed(2)}x sellers)`;
    } else if (flow.ticksPerSecond && flow.avgTicksPerSecond && flow.ticksPerSecond > flow.avgTicksPerSecond * 2) {
      score = 4;
      detail = 'Tick-rate velocity surge';
    }

    return { score, maxScore: 5, label: 'Order-Flow Proxies', detail, lean };
  },

  /**
   * 8. Momentum Ignition Sign
   */
  evaluateMomentumIgnition(candles: Array<any>, flow: Record<string, any>): SpikeFactorScore {
    if (candles.length < 2) return { score: 1, maxScore: 5, label: 'Momentum Ignition', detail: 'No ignition', lean: 'UNCLEAR' };

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const isExpanding = (last.high - last.low) > (prev.high - prev.low) * 1.8;

    if (isExpanding) {
      const isBull = last.close > last.open;
      return {
        score: 5,
        maxScore: 5,
        label: 'Momentum Ignition',
        detail: `Expansion bar ignited (${(last.high - last.low).toFixed(1)} pts)`,
        lean: isBull ? 'UP' : 'DOWN'
      };
    }

    return { score: 1, maxScore: 5, label: 'Momentum Ignition', detail: 'Awaiting impulse', lean: 'UNCLEAR' };
  }
};
