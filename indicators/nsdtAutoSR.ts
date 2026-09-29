/**
 * TradeSight NIFTY 50 - NSDT Auto Support / Resistance Levels (TypeScript Definition)
 *
 * Original Pine Source Author: NorthStarDayTrading (open source on TradingView).
 * Author credit retained. Personal decision-support use inside this extension only.
 *
 * Faithfully ports 3-tier pivot support/resistance calculation:
 *  - Tier 1: Lookback L1 = 5 (White, width 1, labels R1/S1)
 *  - Tier 2: Lookback L2 = 10 (Yellow, width 2, labels R2/S2)
 *  - Tier 3: Lookback L3 = 20 (Orange, width 3, labels R3/S3)
 *
 * Extensions:
 *  - Nearest S/R distance in points & ATR multiples
 *  - Multi-tier cluster zone detection (<= 0.15 x ATR)
 *  - Break & Retest status per level confirmed strictly on candle close
 *  - Confluence scorer contribution (location bonus & obstacle penalty)
 */

import { Candle, pivothigh, pivotlow, valuewhen, atr } from './pine-helpers';

export interface NSDTConfig {
  isEnabled: boolean;
  l1: number;
  l2: number;
  l3: number;
  r1Color: string;
  s1Color: string;
  r2Color: string;
  s2Color: string;
  r3Color: string;
  s3Color: string;
  r1Width: number;
  r2Width: number;
  r3Width: number;
  // Extension switches
  showNearestLevels: boolean;
  showClusters: boolean;
  clusterThresholdAtrMultiplier: number;
  trackBreakRetest: number; // buffer ATR multiplier (e.g. 0.1)
  alertOnState: boolean;
  alertOnFreshCross: boolean;
}

export interface SRLevel {
  id: 'R1' | 'S1' | 'R2' | 'S2' | 'R3' | 'S3';
  tier: 1 | 2 | 3;
  type: 'RESISTANCE' | 'SUPPORT';
  price: number | null;
  confirmedBarIndex: number | null;
  color: string;
  width: number;
  label: string;
  status: 'RESPECTED' | 'BROKEN_ABOVE' | 'BROKEN_BELOW' | 'RETESTING' | 'PENDING';
  statusDescription: string;
  lastCrossBarIndex?: number;
}

export interface LevelCluster {
  id: string;
  levels: SRLevel[];
  avgPrice: number;
  topPrice: number;
  bottomPrice: number;
  rangePoints: number;
  strength: 'HIGH' | 'EXTREME';
  description: string;
}

export interface NSDTState {
  isEnabled: boolean;
  levels: {
    r1: SRLevel;
    s1: SRLevel;
    r2: SRLevel;
    s2: SRLevel;
    r3: SRLevel;
    s3: SRLevel;
  };
  nearestSupport: { level: SRLevel | null; price?: number; distancePts: number; distanceAtr: number } | null;
  nearestResistance: { level: SRLevel | null; price?: number; distancePts: number; distanceAtr: number } | null;
  clusters: LevelCluster[];
  currentAtr: number;
  alerts: {
    stateAlerts: string[];
    freshCrossEvents: string[];
    closeAboveR1?: boolean;
    closeBelowS1?: boolean;
    closeAboveR2?: boolean;
    closeBelowS2?: boolean;
    closeAboveR3?: boolean;
    closeBelowS3?: boolean;
  };
  confluenceContribution: {
    locationBonus: number;
    obstaclePenalty: number;
    notes: string[];
  };
  lastBarIndex: number;
}

export const DEFAULT_NSDT_CONFIG: NSDTConfig = {
  isEnabled: false,
  l1: 5,
  l2: 10,
  l3: 20,
  r1Color: '#FFFFFF',
  s1Color: '#FFFFFF',
  r2Color: '#FBBF24', // Yellow
  s2Color: '#FBBF24',
  r3Color: '#F97316', // Orange
  s3Color: '#F97316',
  r1Width: 1,
  r2Width: 2,
  r3Width: 3,
  showNearestLevels: true,
  showClusters: true,
  clusterThresholdAtrMultiplier: 0.15,
  trackBreakRetest: 0.1,
  alertOnState: true,
  alertOnFreshCross: true
};

export class NSDTAutoSREngine {
  private config: NSDTConfig;
  private state: NSDTState | null = null;

  constructor(config: Partial<NSDTConfig> = {}) {
    this.config = { ...DEFAULT_NSDT_CONFIG, ...config };
  }

  public updateConfig(newConfig: Partial<NSDTConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): NSDTConfig {
    return { ...this.config };
  }

  /**
   * Pure calculation of NSDT Auto S/R on candle series
   */
  public calculate(candles: Candle[]): NSDTState | null {
    if (!this.config.isEnabled || !candles || candles.length < Math.max(this.config.l3 * 2 + 1, 30)) {
      return null;
    }

    const n = candles.length;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const currentPrice = closes[n - 1];
    const prevPrice = n >= 2 ? closes[n - 2] : currentPrice;

    // ATR calculation for distances, clusters, and retest buffers
    const atrSeries = atr(candles, 14);
    const currentAtr = atrSeries[n - 1] || 15;

    // 1. TIER 1 (L1, default 5)
    const p1_h = pivothigh(highs, this.config.l1, this.config.l1);
    const p1_l = pivotlow(lows, this.config.l1, this.config.l1);
    const r1Series = valuewhen(p1_h, highs.map((h, i) => (i >= this.config.l1 ? highs[i - this.config.l1] : null)));
    const s1Series = valuewhen(p1_l, lows.map((l, i) => (i >= this.config.l1 ? lows[i - this.config.l1] : null)));

    // 2. TIER 2 (L2, default 10)
    const p2_h = pivothigh(highs, this.config.l2, this.config.l2);
    const p2_l = pivotlow(lows, this.config.l2, this.config.l2);
    const r2Series = valuewhen(p2_h, highs.map((h, i) => (i >= this.config.l2 ? highs[i - this.config.l2] : null)));
    const s2Series = valuewhen(p2_l, lows.map((l, i) => (i >= this.config.l2 ? lows[i - this.config.l2] : null)));

    // 3. TIER 3 (L3, default 20)
    const p3_h = pivothigh(highs, this.config.l3, this.config.l3);
    const p3_l = pivotlow(lows, this.config.l3, this.config.l3);
    const r3Series = valuewhen(p3_h, highs.map((h, i) => (i >= this.config.l3 ? highs[i - this.config.l3] : null)));
    const s3Series = valuewhen(p3_l, lows.map((l, i) => (i >= this.config.l3 ? lows[i - this.config.l3] : null)));

    // Helper to extract confirmed bar index
    const findLastPivotBar = (pivotArr: (number | null)[]): number | null => {
      for (let i = pivotArr.length - 1; i >= 0; i--) {
        if (pivotArr[i] !== null && pivotArr[i] !== undefined) return i;
      }
      return null;
    };

    // Construct level representations
    const r1: SRLevel = {
      id: 'R1', tier: 1, type: 'RESISTANCE',
      price: r1Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p1_h),
      color: this.config.r1Color, width: this.config.r1Width, label: 'R1 (Tier 1)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };
    const s1: SRLevel = {
      id: 'S1', tier: 1, type: 'SUPPORT',
      price: s1Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p1_l),
      color: this.config.s1Color, width: this.config.r1Width, label: 'S1 (Tier 1)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };
    const r2: SRLevel = {
      id: 'R2', tier: 2, type: 'RESISTANCE',
      price: r2Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p2_h),
      color: this.config.r2Color, width: this.config.r2Width, label: 'R2 (Tier 2)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };
    const s2: SRLevel = {
      id: 'S2', tier: 2, type: 'SUPPORT',
      price: s2Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p2_l),
      color: this.config.s2Color, width: this.config.r2Width, label: 'S2 (Tier 2)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };
    const r3: SRLevel = {
      id: 'R3', tier: 3, type: 'RESISTANCE',
      price: r3Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p3_h),
      color: this.config.r3Color, width: this.config.r3Width, label: 'R3 (Tier 3)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };
    const s3: SRLevel = {
      id: 'S3', tier: 3, type: 'SUPPORT',
      price: s3Series[n - 1],
      confirmedBarIndex: findLastPivotBar(p3_l),
      color: this.config.s3Color, width: this.config.r3Width, label: 'S3 (Tier 3)',
      status: 'RESPECTED', statusDescription: 'Active level'
    };

    const allLevels = [r1, s1, r2, s2, r3, s3];

    // Evaluate Break & Retest Status strictly on candle close
    const bufferPts = this.config.trackBreakRetest * currentAtr;
    allLevels.forEach((lvl) => {
      if (lvl.price === null) {
        lvl.status = 'PENDING';
        lvl.statusDescription = 'Awaiting initial pivot confirmation';
        return;
      }

      const p = lvl.price;
      const c = currentPrice;
      const prev = prevPrice;

      if (lvl.type === 'RESISTANCE') {
        if (c > p + bufferPts) {
          lvl.status = 'BROKEN_ABOVE';
          lvl.statusDescription = `Broke above ${lvl.id} (${(c - p).toFixed(1)} pts expansion)`;
        } else if (Math.abs(c - p) <= bufferPts) {
          if (prev > p + bufferPts) {
            lvl.status = 'RETESTING';
            lvl.statusDescription = `Broke above ${lvl.id}, retesting support`;
          } else {
            lvl.status = 'RESPECTED';
            lvl.statusDescription = `Testing ${lvl.id} resistance`;
          }
        } else {
          lvl.status = 'RESPECTED';
          lvl.statusDescription = `Holding below ${lvl.id}`;
        }
      } else {
        if (c < p - bufferPts) {
          lvl.status = 'BROKEN_BELOW';
          lvl.statusDescription = `Broke below ${lvl.id} (${(p - c).toFixed(1)} pts expansion)`;
        } else if (Math.abs(c - p) <= bufferPts) {
          if (prev < p - bufferPts) {
            lvl.status = 'RETESTING';
            lvl.statusDescription = `Broke below ${lvl.id}, retesting resistance`;
          } else {
            lvl.status = 'RESPECTED';
            lvl.statusDescription = `Testing ${lvl.id} support`;
          }
        } else {
          lvl.status = 'RESPECTED';
          lvl.statusDescription = `Holding above ${lvl.id}`;
        }
      }
    });

    // 4. Alerts: Original State Alerts + Extension Fresh Cross Events
    const stateAlerts: string[] = [];
    const freshCrossEvents: string[] = [];

    // State alerts (Pine original alertconditions)
    if (this.config.alertOnState) {
      if (r1.price !== null && currentPrice > r1.price) stateAlerts.push('Close > R1');
      if (s1.price !== null && currentPrice < s1.price) stateAlerts.push('Close < S1');
      if (r2.price !== null && currentPrice > r2.price) stateAlerts.push('Close > R2');
      if (s2.price !== null && currentPrice < s2.price) stateAlerts.push('Close < S2');
      if (r3.price !== null && currentPrice > r3.price) stateAlerts.push('Close > R3');
      if (s3.price !== null && currentPrice < s3.price) stateAlerts.push('Close < S3');
    }

    // Fresh cross events (extension addition on current bar close)
    if (this.config.alertOnFreshCross) {
      [r1, r2, r3].forEach((r) => {
        if (r.price !== null && prevPrice <= r.price && currentPrice > r.price) {
          freshCrossEvents.push(`⚡ Fresh Breakout: Close crossed above ${r.id} (${r.price})`);
        }
      });
      [s1, s2, s3].forEach((s) => {
        if (s.price !== null && prevPrice >= s.price && currentPrice < s.price) {
          freshCrossEvents.push(`⚡ Fresh Breakdown: Close crossed below ${s.id} (${s.price})`);
        }
      });
    }

    // 5. Nearest Support & Resistance Calculation
    let nearestSupport: { level: SRLevel | null; price?: number; distancePts: number; distanceAtr: number } | null = null;
    let nearestResistance: { level: SRLevel | null; price?: number; distancePts: number; distanceAtr: number } | null = null;

    if (this.config.showNearestLevels) {
      const supports = allLevels.filter((l) => l.price !== null && l.price < currentPrice);
      if (supports.length > 0) {
        supports.sort((a, b) => (currentPrice - a.price!) - (currentPrice - b.price!));
        const closestSup = supports[0];
        const dist = currentPrice - closestSup.price!;
        nearestSupport = {
          level: closestSup,
          price: closestSup.price!,
          distancePts: parseFloat(dist.toFixed(1)),
          distanceAtr: parseFloat((dist / currentAtr).toFixed(2))
        };
      }

      const resistances = allLevels.filter((l) => l.price !== null && l.price > currentPrice);
      if (resistances.length > 0) {
        resistances.sort((a, b) => (a.price! - currentPrice) - (b.price! - currentPrice));
        const closestRes = resistances[0];
        const dist = closestRes.price! - currentPrice;
        nearestResistance = {
          level: closestRes,
          price: closestRes.price!,
          distancePts: parseFloat(dist.toFixed(1)),
          distanceAtr: parseFloat((dist / currentAtr).toFixed(2))
        };
      }
    }

    // 6. Cluster Zone Detection (Tiers within 0.15 x ATR)
    const clusters: LevelCluster[] = [];
    if (this.config.showClusters) {
      const clusterThresholdPts = this.config.clusterThresholdAtrMultiplier * currentAtr;
      const validLevels = allLevels.filter((l) => l.price !== null);

      // Group levels close to each other from different tiers
      for (let i = 0; i < validLevels.length; i++) {
        for (let j = i + 1; j < validLevels.length; j++) {
          const lA = validLevels[i];
          const lB = validLevels[j];
          if (lA.tier !== lB.tier) {
            const diff = Math.abs(lA.price! - lB.price!);
            if (diff <= clusterThresholdPts) {
              const clusterLevels = [lA, lB];
              // Check if third tier is also inside
              const third = validLevels.find(
                (l) => l.tier !== lA.tier && l.tier !== lB.tier && Math.abs(l.price! - lA.price!) <= clusterThresholdPts
              );
              if (third && !clusterLevels.includes(third)) clusterLevels.push(third);

              const clusterId = clusterLevels.map((l) => l.id).sort().join('+');
              if (!clusters.some((c) => c.id === clusterId)) {
                const prices = clusterLevels.map((l) => l.price!);
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                clusters.push({
                  id: clusterId,
                  levels: clusterLevels,
                  avgPrice: parseFloat(((min + max) / 2).toFixed(1)),
                  topPrice: max,
                  bottomPrice: min,
                  rangePoints: parseFloat((max - min).toFixed(1)),
                  strength: clusterLevels.length >= 3 ? 'EXTREME' : 'HIGH',
                  description: `${clusterLevels.length}-Tier Strong Zone (${clusterLevels.map((l) => l.id).join(', ')})`
                });
              }
            }
          }
        }
      }
    }

    // 7. Confluence Scorer Contribution
    let locationBonus = 0;
    let obstaclePenalty = 0;
    const notes: string[] = [];

    // Location Quality: If price is currently testing a Tier 2/3 level or cluster
    const isAtCluster = clusters.some((c) => Math.abs(currentPrice - c.avgPrice) <= bufferPts);
    if (isAtCluster) {
      locationBonus += 15;
      notes.push('Confluence Bonus: Price active at multi-tier S/R cluster zone (+15 pts)');
    } else {
      const isAtTier3 = (r3.price && Math.abs(currentPrice - r3.price) <= bufferPts) || (s3.price && Math.abs(currentPrice - s3.price) <= bufferPts);
      const isAtTier2 = (r2.price && Math.abs(currentPrice - r2.price) <= bufferPts) || (s2.price && Math.abs(currentPrice - s2.price) <= bufferPts);
      if (isAtTier3) {
        locationBonus += 12;
        notes.push('Confluence Bonus: Key Tier 3 major structure test (+12 pts)');
      } else if (isAtTier2) {
        locationBonus += 8;
        notes.push('Confluence Bonus: Tier 2 intermediate structure test (+8 pts)');
      }
    }

    // Obstacle Check: If nearest obstacle is too close (< 0.5 x ATR), penalty applies
    if (nearestResistance && nearestResistance.distanceAtr < 0.5) {
      obstaclePenalty += 10;
      notes.push(`Obstacle Warning: ${nearestResistance.level?.id} resistance directly overhead (${nearestResistance.distancePts} pts / ${nearestResistance.distanceAtr} ATR) (-10 pts)`);
    }
    if (nearestSupport && nearestSupport.distanceAtr < 0.5) {
      obstaclePenalty += 10;
      notes.push(`Obstacle Warning: ${nearestSupport.level?.id} support directly below (${nearestSupport.distancePts} pts / ${nearestSupport.distanceAtr} ATR) (-10 pts)`);
    }

    this.state = {
      isEnabled: true,
      levels: { r1, s1, r2, s2, r3, s3 },
      nearestSupport,
      nearestResistance,
      clusters,
      currentAtr: parseFloat(currentAtr.toFixed(1)),
      alerts: {
        stateAlerts,
        freshCrossEvents,
        closeAboveR1: r1.price !== null && currentPrice > r1.price,
        closeBelowS1: s1.price !== null && currentPrice < s1.price,
        closeAboveR2: r2.price !== null && currentPrice > r2.price,
        closeBelowS2: s2.price !== null && currentPrice < s2.price,
        closeAboveR3: r3.price !== null && currentPrice > r3.price,
        closeBelowS3: s3.price !== null && currentPrice < s3.price
      },
      confluenceContribution: { locationBonus, obstaclePenalty, notes },
      lastBarIndex: n - 1
    };

    return this.state;
  }

  public getState(): NSDTState | null {
    return this.state;
  }

  public dispose(): void {
    this.state = null;
  }
}
