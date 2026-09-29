/**
 * TradeSight NIFTY 50 - Spike Trigger & Fake-Breakout Engine (Stage 2)
 * Pure, rule-based execution trigger. Demands multi-layered confirmation:
 *  1. Breakout beyond compression range with volume expansion (> k x ATR)
 *  2. Driver confirmation (VIX, Bank Nifty, Heavyweights, or OI shift)
 *  3. Fake-breakout rejection (wick > body, volume trap, immediate return inside range)
 */

export interface SpikeTriggerInput {
  candles: Array<{ open: number; high: number; low: number; close: number; volume: number }>;
  currentPrice: number;
  readinessScore: number; // Must be >= 40 (Building or High)
  compressionRange: { high: number; low: number; mid: number };
  keyLevel?: { name: string; price: number; type: 'SUPPORT' | 'RESISTANCE' | 'PIVOT' };
  driverConfirmation?: {
    vixAligned: boolean;
    heavyweightsAligned: boolean;
    bankNiftyAligned: boolean;
    oiShiftAligned: boolean;
  };
  streamingTick?: {
    momentum1s: number; // Price velocity in last 1-3 seconds
    tickVelocity: 'FAST' | 'NORMAL' | 'SLOW';
  };
  config?: {
    rangeMultiplierAtr?: number; // default 1.2
    maxWickToBodyRatio?: number; // default 1.5 (fake breakout threshold)
    minVolumeMultiplier?: number; // default 1.15
  };
}

export interface SpikeTriggerResult {
  isTriggered: boolean;
  direction: 'LONG' | 'SHORT' | 'NONE';
  triggerType: 'BREAKOUT_EXPANSION' | 'FAILED_BREAKOUT_REVERSAL' | 'NONE';
  triggerPrice: number;
  triggerTimeIST: string;
  isFakeBreakout: boolean;
  fakeBreakoutReason: string | null;
  driverConfirmed: boolean;
  confirmationDetails: string[];
  rejectionReasons: string[];
  candleMetrics: {
    range: number;
    bodySize: number;
    upperWick: number;
    lowerWick: number;
    volumeRatio: number;
    atrRatio: number;
  };
}

export const SpikeTrigger = {
  /**
   * Pure evaluation of Spike Trigger & Fake Breakout Protection
   */
  evaluateTrigger(input: SpikeTriggerInput): SpikeTriggerResult {
    const candles = input.candles || [];
    const currentPrice = input.currentPrice;
    const compression = input.compressionRange;
    const readinessScore = input.readinessScore || 0;
    const drivers = input.driverConfirmation || { vixAligned: false, heavyweightsAligned: false, bankNiftyAligned: false, oiShiftAligned: false };
    const streaming = input.streamingTick;
    const config = {
      rangeMultiplierAtr: input.config?.rangeMultiplierAtr ?? 1.2,
      maxWickToBodyRatio: input.config?.maxWickToBodyRatio ?? 1.5,
      minVolumeMultiplier: input.config?.minVolumeMultiplier ?? 1.15
    };

    const nowIST = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
    const confirmations: string[] = [];
    const rejections: string[] = [];

    // Pre-condition: Readiness score must be building or high (>= 40)
    if (readinessScore < 40) {
      return {
        isTriggered: false,
        direction: 'NONE',
        triggerType: 'NONE',
        triggerPrice: currentPrice,
        triggerTimeIST: nowIST,
        isFakeBreakout: false,
        fakeBreakoutReason: null,
        driverConfirmed: false,
        confirmationDetails: [],
        rejectionReasons: [`Readiness score (${readinessScore}/100) below minimum building threshold (40)`],
        candleMetrics: { range: 0, bodySize: 0, upperWick: 0, lowerWick: 0, volumeRatio: 0, atrRatio: 0 }
      };
    }

    if (candles.length < 5) {
      return {
        isTriggered: false,
        direction: 'NONE',
        triggerType: 'NONE',
        triggerPrice: currentPrice,
        triggerTimeIST: nowIST,
        isFakeBreakout: false,
        fakeBreakoutReason: null,
        driverConfirmed: false,
        confirmationDetails: [],
        rejectionReasons: ['Insufficient candle bars for trigger confirmation'],
        candleMetrics: { range: 0, bodySize: 0, upperWick: 0, lowerWick: 0, volumeRatio: 0, atrRatio: 0 }
      };
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Candle Anatomy Calculations
    const range = last.high - last.low;
    const bodySize = Math.abs(last.close - last.open);
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;

    // Moving average volume & ATR
    const avgVol = candles.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0) / Math.min(20, candles.length);
    const avgAtr = candles.slice(-20).reduce((acc, c) => acc + (c.high - c.low), 0) / Math.min(20, candles.length);
    const volumeRatio = avgVol > 0 ? parseFloat((last.volume / avgVol).toFixed(2)) : 1.0;
    const atrRatio = avgAtr > 0 ? parseFloat((range / avgAtr).toFixed(2)) : 1.0;

    const candleMetrics = {
      range: parseFloat(range.toFixed(2)),
      bodySize: parseFloat(bodySize.toFixed(2)),
      upperWick: parseFloat(upperWick.toFixed(2)),
      lowerWick: parseFloat(lowerWick.toFixed(2)),
      volumeRatio,
      atrRatio
    };

    // Check Breakout Direction
    let proposedDirection: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
    if (last.close > compression.high || currentPrice > compression.high) {
      proposedDirection = 'LONG';
    } else if (last.close < compression.low || currentPrice < compression.low) {
      proposedDirection = 'SHORT';
    }

    if (proposedDirection === 'NONE') {
      return {
        isTriggered: false,
        direction: 'NONE',
        triggerType: 'NONE',
        triggerPrice: currentPrice,
        triggerTimeIST: nowIST,
        isFakeBreakout: false,
        fakeBreakoutReason: null,
        driverConfirmed: false,
        confirmationDetails: [],
        rejectionReasons: ['Price contained within compression zone (Waiting for trigger breakout)'],
        candleMetrics
      };
    }

    // 1. FAKE BREAKOUT PROTECTION CHECKS (Critical)
    let isFakeBreakout = false;
    let fakeBreakoutReason: string | null = null;

    if (proposedDirection === 'LONG') {
      // Rejection check: Upper wick much larger than body (selling exhaustion trap)
      if (bodySize > 0 && (upperWick / bodySize) > config.maxWickToBodyRatio) {
        isFakeBreakout = true;
        fakeBreakoutReason = `Long wick rejection: Upper wick (${upperWick.toFixed(1)} pts) > ${config.maxWickToBodyRatio}x candle body (${bodySize.toFixed(1)} pts).`;
      }
      // Re-entry check: Price returned back inside compression
      if (last.close < compression.high && currentPrice <= compression.high) {
        isFakeBreakout = true;
        fakeBreakoutReason = 'Bull trap: Price breached compression high but failed to close above it.';
      }
    } else if (proposedDirection === 'SHORT') {
      // Rejection check: Lower wick much larger than body (buying absorption trap)
      if (bodySize > 0 && (lowerWick / bodySize) > config.maxWickToBodyRatio) {
        isFakeBreakout = true;
        fakeBreakoutReason = `Short wick rejection: Lower wick (${lowerWick.toFixed(1)} pts) > ${config.maxWickToBodyRatio}x candle body (${bodySize.toFixed(1)} pts).`;
      }
      // Re-entry check: Price returned back inside compression
      if (last.close > compression.low && currentPrice >= compression.low) {
        isFakeBreakout = true;
        fakeBreakoutReason = 'Bear trap: Price breached compression low but failed to close below it.';
      }
    }

    // Volume trap check
    if (volumeRatio < 0.8) {
      isFakeBreakout = true;
      fakeBreakoutReason = (fakeBreakoutReason ? fakeBreakoutReason + ' • ' : '') + `Missing volume: Breakout volume (${volumeRatio}x avg) is below threshold.`;
    }

    if (isFakeBreakout) {
      // If fake breakout occurred with high volume, consider reverse setup (Liquidity Sweep Fade)
      const isReversalViable = volumeRatio >= 1.2 && bodySize >= 4;
      return {
        isTriggered: isReversalViable,
        direction: isReversalViable ? (proposedDirection === 'LONG' ? 'SHORT' : 'LONG') : 'NONE',
        triggerType: isReversalViable ? 'FAILED_BREAKOUT_REVERSAL' : 'NONE',
        triggerPrice: currentPrice,
        triggerTimeIST: nowIST,
        isFakeBreakout: true,
        fakeBreakoutReason,
        driverConfirmed: false,
        confirmationDetails: isReversalViable ? ['Failed breakout trap established with high absorption volume (Liquidity sweep reversal)'] : [],
        rejectionReasons: [fakeBreakoutReason || 'Failed breakout'],
        candleMetrics
      };
    }

    // 2. RANGE EXPANSION VALIDATION (> k x ATR)
    if (atrRatio >= config.rangeMultiplierAtr) {
      confirmations.push(`Expansion bar confirmed (${range.toFixed(1)} pts = ${atrRatio}x ATR)`);
    } else {
      rejections.push(`Candle range (${range.toFixed(1)} pts) below ${config.rangeMultiplierAtr}x ATR requirement`);
    }

    // 3. VOLUME EXPANSION VALIDATION
    if (volumeRatio >= config.minVolumeMultiplier) {
      confirmations.push(`Volume expansion confirmed (${volumeRatio}x 20-bar avg)`);
    } else {
      rejections.push(`Volume (${volumeRatio}x) did not meet minimum ${config.minVolumeMultiplier}x surge`);
    }

    // 4. DRIVER CONFIRMATION
    const driverActive = drivers.vixAligned || drivers.heavyweightsAligned || drivers.bankNiftyAligned || drivers.oiShiftAligned;
    if (driverActive) {
      const activeDrivers = [
        drivers.vixAligned ? 'India VIX' : null,
        drivers.heavyweightsAligned ? 'Nifty Heavyweights' : null,
        drivers.bankNiftyAligned ? 'Bank Nifty' : null,
        drivers.oiShiftAligned ? 'Options OI shift' : null
      ].filter(Boolean).join(', ');
      confirmations.push(`Driver aligned: ${activeDrivers}`);
    } else {
      rejections.push('No confirming driver (VIX, Heavyweights, Bank Nifty, or OI unwinding)');
    }

    // 5. STREAMING TICK MOMENTUM (If available)
    if (streaming) {
      if (proposedDirection === 'LONG' && streaming.momentum1s > 0) {
        confirmations.push(`1s tick momentum positive (+${streaming.momentum1s.toFixed(2)} pts/s)`);
      } else if (proposedDirection === 'SHORT' && streaming.momentum1s < 0) {
        confirmations.push(`1s tick momentum negative (${streaming.momentum1s.toFixed(2)} pts/s)`);
      }
    }

    // Final Gate: Must have zero rejections
    const isTriggered = rejections.length === 0;

    return {
      isTriggered,
      direction: isTriggered ? proposedDirection : 'NONE',
      triggerType: isTriggered ? 'BREAKOUT_EXPANSION' : 'NONE',
      triggerPrice: currentPrice,
      triggerTimeIST: nowIST,
      isFakeBreakout: false,
      fakeBreakoutReason: null,
      driverConfirmed: driverActive,
      confirmationDetails: confirmations,
      rejectionReasons: rejections,
      candleMetrics
    };
  }
};
