/**
 * TradeSight NIFTY 50 - Independent Multi-Tier Support/Resistance ZONE Engine (Runtime ESM)
 *
 * Original, independent algorithm that clusters multiple structural price candidates
 * (confirmed swing pivots on 3 scales, daily/weekly key levels, round numbers, VWAP, Max OI)
 * into high-probability zones with transparent strength scoring (0-100), role flipping,
 * touch reaction tracking, and immutable lifecycle events.
 */

import { pivothigh, pivotlow, atr } from './pine-helpers.js';

export const DEFAULT_LEVELS_CONFIG = {
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

export class LevelsEngine {
  constructor(cfg = {}) {
    this.config = { ...DEFAULT_LEVELS_CONFIG, ...cfg };
    this.state = null;
    this.eventHistory = [];
  }

  setEnabled(enabled) {
    this.config.isEnabled = enabled;
    if (!enabled) {
      this.dispose();
    }
  }

  updateConfig(cfg) {
    this.config = { ...this.config, ...cfg };
  }

  getConfig() {
    return { ...this.config };
  }

  update(closedCandles, externalLevels = {}) {
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

    const startIdx = Math.max(0, closedCandles.length - this.config.maxLookbackBars);
    const candles = closedCandles.slice(startIdx);
    const n = candles.length;
    const lastBar = candles[n - 1];
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

    let isLargeGap = false;
    if (n >= 2) {
      const gapPct = Math.abs(candles[n - 1].open - candles[n - 2].close) / candles[n - 2].close * 100;
      isLargeGap = gapPct >= this.config.largeGapPctThreshold;
    }

    const candidates = [];

    // A. Multi-Scale Swing Pivots
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

    // B. Session Levels
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

      const orbSlice = currDaySlice.slice(0, 2);
      if (orbSlice.length > 0) {
        const orh = Math.max(...orbSlice.map(c => c.high));
        const orl = Math.min(...orbSlice.map(c => c.low));
        candidates.push({ price: orh, type: 'OPENING_RANGE_HIGH', sourceCategory: 'SESSION_LEVEL', baseWeight: 18 });
        candidates.push({ price: orl, type: 'OPENING_RANGE_LOW', sourceCategory: 'SESSION_LEVEL', baseWeight: 18 });
      }
    }

    // C. Round Numbers
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

    candidates.sort((a, b) => a.price - b.price);

    const rawClusters = [];
    let currentCluster = [];

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

    const avgVolume20 = candles.slice(-20).reduce((sum, c) => sum + (c.volume || 50000), 0) / 20;

    const zones = rawClusters.map((cluster, idx) => {
      const prices = cluster.map(c => c.price);
      let top = Math.max(...prices);
      let bottom = Math.min(...prices);
      let center = parseFloat(((top + bottom) / 2).toFixed(1));

      if (top - bottom < minZoneHeight) {
        const pad = (minZoneHeight - (top - bottom)) / 2;
        top = parseFloat((top + pad).toFixed(1));
        bottom = parseFloat((bottom - pad).toFixed(1));
        center = parseFloat(((top + bottom) / 2).toFixed(1));
      }

      let isResistance = center >= currentClose;
      let isBroken = false;
      let brokenBarIndex = null;
      let flipped = false;

      let touchCount = 0;
      let lastReactionBar = -1;
      let totalReactionVol = 0;
      let reactionVolCount = 0;

      for (let b = 0; b < n; b++) {
        const c = candles[b];
        const touchesZone = c.high >= bottom && c.low <= top;

        if (touchesZone && (lastReactionBar === -1 || b - lastReactionBar >= this.config.minTouchGapBars)) {
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

      const uniqueCats = new Set(cluster.map(c => c.sourceCategory));
      const catCount = uniqueCats.size;
      const sourceDiversity = Math.min(30, catCount * 10 + (cluster.length >= 3 ? 5 : 0));

      const reactionScore = Math.min(25, touchCount * 6);

      let pivotScaleScore = 0;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L3')) pivotScaleScore += 12;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L2')) pivotScaleScore += 8;
      if (cluster.some(c => c.type === 'SWING_PIVOT_L1') && pivotScaleScore < 15) pivotScaleScore += 4;
      pivotScaleScore = Math.min(20, pivotScaleScore);

      const ageBars = lastReactionBar >= 0 ? n - 1 - lastReactionBar : 100;
      const decayFactor = Math.exp(-ageBars / this.config.decayHalfLifeBars);
      const recencyScore = parseFloat((15 * decayFactor).toFixed(1));

      let volumeConfirmation = 5;
      if (reactionVolCount > 0) {
        const avgVolAtLevel = totalReactionVol / reactionVolCount;
        const volRatio = avgVolAtLevel / Math.max(1, avgVolume20);
        volumeConfirmation = volRatio >= 1.25 ? 10 : volRatio >= 0.9 ? 7 : 3;
      }

      const brokenPenalty = isBroken ? -15 : 0;
      const rawScore = sourceDiversity + reactionScore + pivotScaleScore + recencyScore + volumeConfirmation + brokenPenalty;
      const strengthScore = Math.max(10, Math.min(100, Math.round(rawScore)));

      let zoneType = isResistance ? 'RESISTANCE' : 'SUPPORT';
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

    const newEvents = [];

    zones.forEach((z) => {
      const touchesNow = currentHigh >= z.bottomPrice && currentLow <= z.topPrice;

      if (touchesNow) {
        const isUp = z.type.includes('SUPPORT');

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
        } else if (z.flipped && Math.abs(currentClose - z.centerPrice) <= clusterDist) {
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
        } else if (currentHigh > z.topPrice + breakBuffer * 0.5 && currentClose <= z.topPrice) {
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
        } else if (Math.abs(currentClose - (isUp ? z.bottomPrice : z.topPrice)) >= reactionThreshold) {
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

    newEvents.forEach((ev) => {
      if (!this.eventHistory.some((e) => e.id === ev.id)) {
        this.eventHistory.push(ev);
      }
    });

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

    const upwardPts = nearestResistance ? nearestResistance.distancePts : 200;
    const downwardPts = nearestSupport ? nearestSupport.distancePts : 200;

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

  getState() {
    return this.state || this.createInactiveState('No state computed');
  }

  getEvents() {
    return [...this.eventHistory];
  }

  getDrawings() {
    if (!this.state || !this.state.isEnabled || !this.state.ready) return [];

    const drawings = [];
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

  dispose() {
    this.state = null;
    this.eventHistory = [];
  }

  createInactiveState(warning) {
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
