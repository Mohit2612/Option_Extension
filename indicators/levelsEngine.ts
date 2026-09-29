/**
 * TradeSight NIFTY 50 - Independent Multi-Tier Support/Resistance ZONE Engine (TypeScript)
 *
 * Original, independent algorithm that clusters multiple structural price candidates
 * (confirmed swing pivots on 3 scales, daily/weekly key levels, round numbers, VWAP, Max OI)
 * into high-probability zones with transparent strength scoring (0-100), role flipping,
 * touch reaction tracking, and immutable lifecycle events.
 */

import { Candle, pivothigh, pivotlow, atr } from './pine-helpers.js';

export type LevelSourceType =
  | 'SWING_PIVOT_L1'
  | 'SWING_PIVOT_L2'
  | 'SWING_PIVOT_L3'
  | 'PREV_DAY_HIGH'
  | 'PREV_DAY_LOW'
  | 'PREV_DAY_CLOSE'
  | 'CURR_DAY_HIGH'
  | 'CURR_DAY_LOW'
  | 'OPENING_RANGE_HIGH'
  | 'OPENING_RANGE_LOW'
  | 'WEEKLY_HIGH'
  | 'WEEKLY_LOW'
  | 'PREV_WEEK_CLOSE'
  | 'ROUND_NUMBER_100'
  | 'ROUND_NUMBER_50'
  | 'CALL_MAX_OI'
  | 'PUT_MAX_OI'
  | 'SESSION_VWAP'
  | 'ANCHORED_VWAP';

export interface CandidateLevel {
  price: number;
  type: LevelSourceType;
  sourceCategory: 'SWING_PIVOT' | 'SESSION_LEVEL' | 'WEEKLY_LEVEL' | 'ROUND_NUMBER' | 'ORDER_FLOW';
  baseWeight: number;
  barIndex?: number;
  timestamp?: number;
  isDowngraded?: boolean;
}

export interface ZoneScoreBreakdown {
  sourceDiversity: number;   // 0 - 30 pts: confluence of independent categories
  reactionScore: number;     // 0 - 25 pts: touch count with bounce/rejection >= 0.3 ATR
  pivotScaleScore: number;   // 0 - 20 pts: presence of large (20) & medium (10) pivots
  recencyScore: number;      // 0 - 15 pts: recent validation with decay on stale zones
  volumeConfirmation: number;// 0 - 10 pts: reaction volume vs 20-period average
  brokenPenalty: number;     // negative penalty if broken and flipped
}

export interface LevelZone {
  id: string;
  type: 'RESISTANCE' | 'SUPPORT' | 'FLIPPED_SUPPORT' | 'FLIPPED_RESISTANCE';
  centerPrice: number;
  topPrice: number;
  bottomPrice: number;
  widthPts: number;
  strengthScore: number;     // 0 - 100 transparent score
  scoreBreakdown: ZoneScoreBreakdown;
  sources: CandidateLevel[];
  sourceTypes: LevelSourceType[];
  sourceCount: number;
  touchCount: number;
  lastReactionBarIndex: number | null;
  isBroken: boolean;
  brokenBarIndex: number | null;
  flipped: boolean;
  ageBars: number;
  decayFactor: number;
}

export interface StructureEvent {
  id: string;
  type: 'TOUCH' | 'REJECTION' | 'BREAK' | 'RETEST_HOLD' | 'FAILED_BREAK' | 'SWEEP';
  sourceType: 'ZONE';
  sourceId: string;
  direction: 'BULLISH' | 'BEARISH';
  price: number;
  barIndex: number;
  timestamp: number;
  quality: number;
  note: string;
}

export interface ExternalLevelsInput {
  vwap?: number;
  anchoredVwap?: number;
  callMaxOi?: number;
  putMaxOi?: number;
  weeklyHigh?: number;
  weeklyLow?: number;
  prevWeekClose?: number;
}

export interface LevelsConfig {
  isEnabled: boolean;
  lookbackSmall: number;      // default 5
  lookbackMedium: number;     // default 10
  lookbackLarge: number;      // default 20
  clusterAtr: number;         // default 0.25 x ATR
  minZoneAtr: number;         // default 0.10 x ATR
  reactionAtr: number;        // default 0.30 x ATR
  minTouchGapBars: number;    // default 5 bars
  breakBufferAtr: number;     // default 0.10 x ATR
  decayHalfLifeBars: number;  // default 250 bars
  maxLookbackBars: number;    // default 1500 bars
  topNZones: number;          // default 6 zones
  largeGapPctThreshold: number;// default 0.5%
}

export const DEFAULT_LEVELS_CONFIG: LevelsConfig = {
  isEnabled: false,
  lookbackSmall: 5,
  lookbackMedium: 10,
  lookbackLarge: 20,
  clusterAtr: 0.25,
  minZoneAtr: 0.10,
  reactionAtr: 0.30,
  minTouchGapBars: 5,
  breakBufferAtr: 0.10,
  decayHalfLifeBars: 250,
  maxLookbackBars: 1500,
  topNZones: 6,
  largeGapPctThreshold: 0.5
};

export const LEVELS_PRESETS = {
  NIFTY_TIGHT_INTRADAY: {
    lookbackSmall: 3,
    lookbackMedium: 6,
    lookbackLarge: 12,
    clusterAtr: 0.20,
    minZoneAtr: 0.08,
    reactionAtr: 0.25
  },
  NIFTY_STANDARD_SWING: {
    lookbackSmall: 5,
    lookbackMedium: 10,
    lookbackLarge: 20,
    clusterAtr: 0.25,
    minZoneAtr: 0.10,
    reactionAtr: 0.30
  },
  NIFTY_HIGH_CONFLUENCE: {
    lookbackSmall: 5,
    lookbackMedium: 15,
    lookbackLarge: 30,
    clusterAtr: 0.30,
    minZoneAtr: 0.12,
    reactionAtr: 0.35
  }
};

export interface LevelsState {
  isEnabled: boolean;
  ready: boolean;
  nearestResistance: { zone: LevelZone; distancePts: number; distanceAtr: number } | null;
  nearestSupport: { zone: LevelZone; distancePts: number; distanceAtr: number } | null;
  topZones: LevelZone[];
  allZones: LevelZone[];
  events: StructureEvent[];
  lastEvent: StructureEvent | null;
  roomToRun: {
    upwardPts: number;
    upwardAtr: number;
    downwardPts: number;
    downwardAtr: number;
  };
  currentAtr: number;
  lastBarIndex: number;
  warning?: string | null;
}

export class LevelsEngine {
  private config: LevelsConfig;
  private state: LevelsState | null = null;
  private eventHistory: StructureEvent[] = [];

  constructor(cfg: Partial<LevelsConfig> = {}) {
    this.config = { ...DEFAULT_LEVELS_CONFIG, ...cfg };
  }

  public setEnabled(enabled: boolean): void {
    this.config.isEnabled = enabled;
    if (!enabled) {
      this.dispose();
    }
  }

  public updateConfig(cfg: Partial<LevelsConfig>): void {
    this.config = { ...this.config, ...cfg };
  }

  public getConfig(): LevelsConfig {
    return { ...this.config };
  }

  /**
   * Main calculation on closed candles
   */
  public update(closedCandles: Candle[], externalLevels: ExternalLevelsInput = {}): LevelsState {
    const minBars = this.config.lookbackLarge * 2 + 10;

    if (!this.config.isEnabled) {
      return this.createInactiveState('Levels engine is toggled OFF');
    }

    if (!closedCandles || closedCandles.length < minBars) {
      return {
        isEnabled: true,
        ready: false,
        nearestResistance: null,
        nearestSupport: null,
        topZones: [],
        allZones: [],
        events: [],
        lastEvent: null,
        roomToRun: { upwardPts: 0, upwardAtr: 0, downwardPts: 0, downwardAtr: 0 },
        currentAtr: 0,
        lastBarIndex: closedCandles ? closedCandles.length - 1 : 0,
        warning: `Data unavailable: requires >= ${minBars} bars for multi-tier level detection.`
      };
    }

    // Limit lookback for efficiency
    const startIdx = Math.max(0, closedCandles.length - this.config.maxLookbackBars);
    const candles = closedCandles.slice(startIdx);
    const n = candles.length;
    const lastBar = candles[n - 1];
    const prevBar = candles[n - 2];
    const currentClose = lastBar.close;
    const currentHigh = lastBar.high;
    const currentLow = lastBar.low;
    const currentTimestamp = lastBar.timestamp || Date.now();

    const atrSeries = atr(candles, 14);
    const currentAtr = Math.max(1.0, atrSeries[atrSeries.length - 1] || 15.0);
    const clusterDist = this.config.clusterAtr * currentAtr;
    const minZoneHeight = this.config.minZoneAtr * currentAtr;
    const breakBuffer = this.config.breakBufferAtr * currentAtr;
    const reactionThreshold = this.config.reactionAtr * currentAtr;

    // Check for large morning gap (> 0.5%)
    let isLargeGap = false;
    if (n >= 2) {
      const gapPct = Math.abs(candles[n - 1].open - candles[n - 2].close) / candles[n - 2].close * 100;
      isLargeGap = gapPct >= this.config.largeGapPctThreshold;
    }

    // 1. GATHER ALL CANDIDATE LEVELS
    const candidates: CandidateLevel[] = [];

    // A. Multi-Scale Swing Pivots (Small, Medium, Large)
    const phSmall = pivothigh(candles.map(c => c.high), this.config.lookbackSmall, this.config.lookbackSmall);
    const plSmall = pivotlow(candles.map(c => c.low), this.config.lookbackSmall, this.config.lookbackSmall);
    const phMed = pivothigh(candles.map(c => c.high), this.config.lookbackMedium, this.config.lookbackMedium);
    const plMed = pivotlow(candles.map(c => c.low), this.config.lookbackMedium, this.config.lookbackMedium);
    const phLg = pivothigh(candles.map(c => c.high), this.config.lookbackLarge, this.config.lookbackLarge);
    const plLg = pivotlow(candles.map(c => c.low), this.config.lookbackLarge, this.config.lookbackLarge);

    for (let i = 0; i < n; i++) {
      if (phLg[i] !== null) {
        const pb = i - this.config.lookbackLarge;
        candidates.push({ price: candles[pb].high, type: 'SWING_PIVOT_L3', sourceCategory: 'SWING_PIVOT', baseWeight: 20, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
      if (plLg[i] !== null) {
        const pb = i - this.config.lookbackLarge;
        candidates.push({ price: candles[pb].low, type: 'SWING_PIVOT_L3', sourceCategory: 'SWING_PIVOT', baseWeight: 20, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
      if (phMed[i] !== null) {
        const pb = i - this.config.lookbackMedium;
        candidates.push({ price: candles[pb].high, type: 'SWING_PIVOT_L2', sourceCategory: 'SWING_PIVOT', baseWeight: 14, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
      if (plMed[i] !== null) {
        const pb = i - this.config.lookbackMedium;
        candidates.push({ price: candles[pb].low, type: 'SWING_PIVOT_L2', sourceCategory: 'SWING_PIVOT', baseWeight: 14, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
      if (phSmall[i] !== null) {
        const pb = i - this.config.lookbackSmall;
        candidates.push({ price: candles[pb].high, type: 'SWING_PIVOT_L1', sourceCategory: 'SWING_PIVOT', baseWeight: 8, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
      if (plSmall[i] !== null) {
        const pb = i - this.config.lookbackSmall;
        candidates.push({ price: candles[pb].low, type: 'SWING_PIVOT_L1', sourceCategory: 'SWING_PIVOT', baseWeight: 8, barIndex: pb, isDowngraded: isLargeGap && pb < n - 25 });
      }
    }

    // B. Session Levels (Previous Day H/L/C, Current Day H/L, ORH/ORL)
    // Approximate daily partition assuming 25 bars per day on 15m
    const dayBars = Math.min(25, Math.floor(n / 2));
    if (n >= dayBars * 2) {
      const prevDaySlice = candles.slice(n - dayBars * 2, n - dayBars);
      const pdh = Math.max(...prevDaySlice.map(c => c.high));
      const pdl = Math.min(...prevDaySlice.map(c => c.low));
      const pdc = prevDaySlice[prevDaySlice.length - 1].close;

      candidates.push({ price: pdh, type: 'PREV_DAY_HIGH', sourceCategory: 'SESSION_LEVEL', baseWeight: 22 });
      candidates.push({ price: pdl, type: 'PREV_DAY_LOW', sourceCategory: 'SESSION_LEVEL', baseWeight: 22 });
      candidates.push({ price: pdc, type: 'PREV_DAY_CLOSE', sourceCategory: 'SESSION_LEVEL', baseWeight: 15 });

      const currDaySlice = candles.slice(n - dayBars);
      const cdh = Math.max(...currDaySlice.map(c => c.high));
      const cdl = Math.min(...currDaySlice.map(c => c.low));
      candidates.push({ price: cdh, type: 'CURR_DAY_HIGH', sourceCategory: 'SESSION_LEVEL', baseWeight: 16 });
      candidates.push({ price: cdl, type: 'CURR_DAY_LOW', sourceCategory: 'SESSION_LEVEL', baseWeight: 16 });

      // Opening Range (first 1-2 bars of session)
      const orbSlice = currDaySlice.slice(0, 2);
      if (orbSlice.length > 0) {
        const orh = Math.max(...orbSlice.map(c => c.high));
        const orl = Math.min(...orbSlice.map(c => c.low));
        candidates.push({ price: orh, type: 'OPENING_RANGE_HIGH', sourceCategory: 'SESSION_LEVEL', baseWeight: 18 });
        candidates.push({ price: orl, type: 'OPENING_RANGE_LOW', sourceCategory: 'SESSION_LEVEL', baseWeight: 18 });
      }
    }

    // C. Round Numbers near price (Multiples of 100 & 50)
    const baseRound = Math.floor(currentClose / 100) * 100;
    [-200, -100, 0, 100, 200].forEach((offset) => {
      const r100 = baseRound + offset;
      if (Math.abs(r100 - currentClose) <= 4 * currentAtr) {
        candidates.push({ price: r100, type: 'ROUND_NUMBER_100', sourceCategory: 'ROUND_NUMBER', baseWeight: 10 });
      }
      const r50 = r100 + 50;
      if (Math.abs(r50 - currentClose) <= 4 * currentAtr) {
        candidates.push({ price: r50, type: 'ROUND_NUMBER_50', sourceCategory: 'ROUND_NUMBER', baseWeight: 6 });
      }
    });

    // D. External Order Flow & Structural Levels
    if (externalLevels.vwap) {
      candidates.push({ price: externalLevels.vwap, type: 'SESSION_VWAP', sourceCategory: 'ORDER_FLOW', baseWeight: 18 });
    }
    if (externalLevels.anchoredVwap) {
      candidates.push({ price: externalLevels.anchoredVwap, type: 'ANCHORED_VWAP', sourceCategory: 'ORDER_FLOW', baseWeight: 16 });
    }
    if (externalLevels.callMaxOi) {
      candidates.push({ price: externalLevels.callMaxOi, type: 'CALL_MAX_OI', sourceCategory: 'ORDER_FLOW', baseWeight: 20 });
    }
    if (externalLevels.putMaxOi) {
      candidates.push({ price: externalLevels.putMaxOi, type: 'PUT_MAX_OI', sourceCategory: 'ORDER_FLOW', baseWeight: 20 });
    }
    if (externalLevels.weeklyHigh) {
      candidates.push({ price: externalLevels.weeklyHigh, type: 'WEEKLY_HIGH', sourceCategory: 'WEEKLY_LEVEL', baseWeight: 20 });
    }
    if (externalLevels.weeklyLow) {
      candidates.push({ price: externalLevels.weeklyLow, type: 'WEEKLY_LOW', sourceCategory: 'WEEKLY_LEVEL', baseWeight: 20 });
    }

    // 2. ZONE CLUSTERING
    // Sort candidates by price ascending
    candidates.sort((a, b) => a.price - b.price);

    const rawClusters: CandidateLevel[][] = [];
    let currentCluster: CandidateLevel[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (currentCluster.length === 0) {
        currentCluster.push(cand);
      } else {
        const clusterCenter = currentCluster.reduce((sum, c) => sum + c.price, 0) / currentCluster.length;
        if (Math.abs(cand.price - clusterCenter) <= clusterDist) {
          currentCluster.push(cand);
        } else {
          rawClusters.push(currentCluster);
          currentCluster = [cand];
        }
      }
    }
    if (currentCluster.length > 0) {
      rawClusters.push(currentCluster);
    }

    // 3. CONSTRUCT & SCORE ZONES
    const avgVolume20 = candles.slice(-20).reduce((sum, c) => sum + (c.volume || 50000), 0) / 20;

    const zones: LevelZone[] = rawClusters.map((cluster, idx) => {
      const prices = cluster.map(c => c.price);
      let top = Math.max(...prices);
      let bottom = Math.min(...prices);
      let center = parseFloat(((top + bottom) / 2).toFixed(1));

      // Enforce minimum zone height
      if (top - bottom < minZoneHeight) {
        const pad = (minZoneHeight - (top - bottom)) / 2;
        top = parseFloat((top + pad).toFixed(1));
        bottom = parseFloat((bottom - pad).toFixed(1));
        center = parseFloat(((top + bottom) / 2).toFixed(1));
      }

      // Check role (Resistance above price vs Support below price)
      let isResistance = center >= currentClose;
      let isBroken = false;
      let brokenBarIndex: number | null = null;
      let flipped = false;

      // Track touches & meaningful reactions
      let touchCount = 0;
      let lastReactionBar = -1;
      let totalReactionVol = 0;
      let reactionVolCount = 0;

      for (let b = 0; b < n; b++) {
        const c = candles[b];
        const touchesZone = c.high >= bottom && c.low <= top;

        if (touchesZone && (lastReactionBar === -1 || b - lastReactionBar >= this.config.minTouchGapBars)) {
          // Check for reaction of >= reactionAtr
          const reaction = Math.abs(c.close - center);
          if (reaction >= reactionThreshold || (c.high - c.low >= reactionThreshold)) {
            touchCount++;
            lastReactionBar = b;
            if (c.volume) {
              totalReactionVol += c.volume;
              reactionVolCount++;
            }
          }
        }

        // Track breaks on close beyond zone
        if (isResistance && c.close > top + breakBuffer) {
          isBroken = true;
          brokenBarIndex = b;
          flipped = true;
        } else if (!isResistance && c.close < bottom - breakBuffer) {
          isBroken = true;
          brokenBarIndex = b;
          flipped = true;
        }
      }

      // Compute transparent strength score (0-100)
      // A. Source Diversity (up to 30 pts)
      const uniqueCats = new Set(cluster.map(c => c.sourceCategory));
      const catCount = uniqueCats.size;
      const sourceDiversity = Math.min(30, catCount * 10 + (cluster.length >= 3 ? 5 : 0));

      // B. Reaction Score (up to 25 pts)
      const reactionScore = Math.min(25, touchCount * 6);

      // C. Pivot Scale Score (up to 20 pts)
      let pivotScaleScore = 0;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L3')) pivotScaleScore += 12;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L2')) pivotScaleScore += 8;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L1') && pivotScaleScore < 15) pivotScaleScore += 4;
      pivotScaleScore = Math.min(20, pivotScaleScore);

      // D. Recency & Decay (up to 15 pts)
      const ageBars = lastReactionBar >= 0 ? n - 1 - lastReactionBar : 100;
      const decayFactor = Math.exp(-ageBars / this.config.decayHalfLifeBars);
      const recencyScore = parseFloat((15 * decayFactor).toFixed(1));

      // E. Volume Confirmation (up to 10 pts)
      let volumeConfirmation = 5; // neutral baseline
      if (reactionVolCount > 0) {
        const avgVolAtLevel = totalReactionVol / reactionVolCount;
        const volRatio = avgVolAtLevel / Math.max(1, avgVolume20);
        volumeConfirmation = volRatio >= 1.25 ? 10 : volRatio >= 0.9 ? 7 : 3;
      }

      // F. Broken Penalty (if broken, flips role with -15 pts penalty)
      const brokenPenalty = isBroken ? -15 : 0;

      const rawScore = sourceDiversity + reactionScore + pivotScaleScore + recencyScore + volumeConfirmation + brokenPenalty;
      const strengthScore = Math.max(10, Math.min(100, Math.round(rawScore)));

      // Determine final zone role
      let zoneType: LevelZone['type'] = isResistance ? 'RESISTANCE' : 'SUPPORT';
      if (flipped) {
        zoneType = isResistance ? 'FLIPPED_SUPPORT' : 'FLIPPED_RESISTANCE';
      }

      return {
        id: `ZONE-${idx + 1}-${Math.round(center)}`,
        type: zoneType,
        centerPrice: center,
        topPrice: top,
        bottomPrice: bottom,
        widthPts: parseFloat((top - bottom).toFixed(1)),
        strengthScore,
        scoreBreakdown: {
          sourceDiversity,
          reactionScore,
          pivotScaleScore,
          recencyScore,
          volumeConfirmation,
          brokenPenalty
        },
        sources: cluster,
        sourceTypes: Array.from(new Set(cluster.map(c => c.type))),
        sourceCount: cluster.length,
        touchCount,
        lastReactionBarIndex: lastReactionBar >= 0 ? lastReactionBar : null,
        isBroken,
        brokenBarIndex,
        flipped,
        ageBars,
        decayFactor: parseFloat(decayFactor.toFixed(2))
      };
    });

    // 4. ZONE LIFECYCLE EVENTS ON LATEST CLOSED CANDLE
    const newEvents: StructureEvent[] = [];

    zones.forEach((z) => {
      const touchesNow = currentHigh >= z.bottomPrice && currentLow <= z.topPrice;

      if (touchesNow) {
        const isUp = z.type.includes('SUPPORT');

        // Check Breakout on close beyond zone + buffer
        if (!z.isBroken && currentClose > z.topPrice + breakBuffer) {
          newEvents.push({
            id: `EV-ZONE-BRK-${z.id}-${n - 1}`,
            type: 'BREAK',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: 'BULLISH',
            price: currentClose,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: z.strengthScore,
            note: `Bullish close expansion above ${z.id} (${z.topPrice})`
          });
        } else if (!z.isBroken && currentClose < z.bottomPrice - breakBuffer) {
          newEvents.push({
            id: `EV-ZONE-BRK-${z.id}-${n - 1}`,
            type: 'BREAK',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: 'BEARISH',
            price: currentClose,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: z.strengthScore,
            note: `Bearish close expansion below ${z.id} (${z.bottomPrice})`
          });
        }
        // Retest Hold on a flipped zone
        else if (z.flipped && Math.abs(currentClose - z.centerPrice) <= clusterDist) {
          newEvents.push({
            id: `EV-ZONE-RT-${z.id}-${n - 1}`,
            type: 'RETEST_HOLD',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: isUp ? 'BULLISH' : 'BEARISH',
            price: currentClose,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: z.strengthScore,
            note: `Retest hold confirmed on flipped zone ${z.id} @ ${currentClose}`
          });
        }
        // Liquidity Sweep (wick pierced beyond zone, close back inside)
        else if (currentHigh > z.topPrice + breakBuffer * 0.5 && currentClose <= z.topPrice) {
          newEvents.push({
            id: `EV-ZONE-SW-${z.id}-${n - 1}`,
            type: 'SWEEP',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: 'BEARISH',
            price: currentHigh,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: Math.min(100, z.strengthScore + 10),
            note: `Upper liquidity sweep rejected at ${z.id}; closed inside @ ${currentClose}`
          });
        } else if (currentLow < z.bottomPrice - breakBuffer * 0.5 && currentClose >= z.bottomPrice) {
          newEvents.push({
            id: `EV-ZONE-SW-${z.id}-${n - 1}`,
            type: 'SWEEP',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: 'BULLISH',
            price: currentLow,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: Math.min(100, z.strengthScore + 10),
            note: `Lower liquidity sweep rejected at ${z.id}; closed inside @ ${currentClose}`
          });
        }
        // Clean Rejection
        else if (Math.abs(currentClose - (isUp ? z.bottomPrice : z.topPrice)) >= reactionThreshold) {
          newEvents.push({
            id: `EV-ZONE-REJ-${z.id}-${n - 1}`,
            type: 'REJECTION',
            sourceType: 'ZONE',
            sourceId: z.id,
            direction: isUp ? 'BULLISH' : 'BEARISH',
            price: currentClose,
            barIndex: n - 1,
            timestamp: currentTimestamp,
            quality: z.strengthScore,
            note: `Structural reaction bounce from ${z.id} @ ${currentClose}`
          });
        }
      }
    });

    // Record immutable events
    newEvents.forEach((ev) => {
      if (!this.eventHistory.some((e) => e.id === ev.id)) {
        this.eventHistory.push(ev);
      }
    });

    // 5. OUTPUT SYNTHESIS
    // Filter nearest resistance above and nearest support below
    const activeResistances = zones
      .filter((z) => z.bottomPrice > currentClose)
      .sort((a, b) => a.bottomPrice - b.bottomPrice);

    const activeSupports = zones
      .filter((z) => z.topPrice < currentClose)
      .sort((a, b) => b.topPrice - a.topPrice);

    let nearestResistance = null;
    if (activeResistances.length > 0) {
      const z = activeResistances[0];
      const dist = z.bottomPrice - currentClose;
      nearestResistance = {
        zone: z,
        distancePts: parseFloat(dist.toFixed(1)),
        distanceAtr: parseFloat((dist / currentAtr).toFixed(2))
      };
    }

    let nearestSupport = null;
    if (activeSupports.length > 0) {
      const z = activeSupports[0];
      const dist = currentClose - z.topPrice;
      nearestSupport = {
        zone: z,
        distancePts: parseFloat(dist.toFixed(1)),
        distanceAtr: parseFloat((dist / currentAtr).toFixed(2))
      };
    }

    // Room to run (distance to next opposing barrier)
    const upwardPts = nearestResistance ? nearestResistance.distancePts : 200;
    const downwardPts = nearestSupport ? nearestSupport.distancePts : 200;

    // Top N zones ranked by strength score
    const topZones = [...zones]
      .sort((a, b) => b.strengthScore - a.strengthScore)
      .slice(0, this.config.topNZones);

    this.state = {
      isEnabled: true,
      ready: true,
      nearestResistance,
      nearestSupport,
      topZones,
      allZones: zones,
      events: [...this.eventHistory],
      lastEvent: this.eventHistory[this.eventHistory.length - 1] || null,
      roomToRun: {
        upwardPts: parseFloat(upwardPts.toFixed(1)),
        upwardAtr: parseFloat((upwardPts / currentAtr).toFixed(2)),
        downwardPts: parseFloat(downwardPts.toFixed(1)),
        downwardAtr: parseFloat((downwardPts / currentAtr).toFixed(2))
      },
      currentAtr: parseFloat(currentAtr.toFixed(1)),
      lastBarIndex: n - 1,
      warning: null
    };

    return this.state;
  }

  public getState(): LevelsState {
    return this.state || this.createInactiveState('No state computed');
  }

  public getEvents(): StructureEvent[] {
    return [...this.eventHistory];
  }

  public getDrawings(): any[] {
    if (!this.state || !this.state.isEnabled || !this.state.ready) return [];

    const drawings: any[] = [];
    const zonesToDraw = this.state.topZones.slice(0, 6);

    zonesToDraw.forEach((z) => {
      const isRes = z.type.includes('RESISTANCE');
      const opacity = Math.min(0.25, Math.max(0.08, z.strengthScore / 400));
      const color = isRes
        ? `rgba(255, 59, 105, ${opacity})`
        : `rgba(0, 230, 118, ${opacity})`;

      const sourceLabels = z.sources.map(s => {
        if (s.type.includes('L3')) return 'L3';
        if (s.type.includes('L2')) return 'L2';
        if (s.type === 'PREV_DAY_HIGH') return 'PDH';
        if (s.type === 'PREV_DAY_LOW') return 'PDL';
        if (s.type === 'SESSION_VWAP') return 'VWAP';
        if (s.type.includes('100')) return 'R100';
        return s.type.substring(0, 4);
      });

      const uniqueLabels = Array.from(new Set(sourceLabels)).slice(0, 3).join('+');

      drawings.push({
        type: 'ZONE_BOX',
        id: z.id,
        y1: z.topPrice,
        y2: z.bottomPrice,
        color,
        strokeColor: isRes ? '#FF3B69' : '#00E676',
        width: z.strengthScore >= 80 ? 2 : 1,
        label: `${isRes ? 'R' : 'S'} Zone: ${z.centerPrice} [${z.strengthScore}/100 • ${uniqueLabels}]`
      });
    });

    return drawings;
  }

  public dispose(): void {
    this.state = null;
    this.eventHistory = [];
  }

  private createInactiveState(warning: string): LevelsState {
    return {
      isEnabled: false,
      ready: false,
      nearestResistance: null,
      nearestSupport: null,
      topZones: [],
      allZones: [],
      events: [],
      lastEvent: null,
      roomToRun: { upwardPts: 0, upwardAtr: 0, downwardPts: 0, downwardAtr: 0 },
      currentAtr: 0,
      lastBarIndex: 0,
      warning
    };
  }
}
