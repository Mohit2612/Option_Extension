/**
 * TradeSight NIFTY 50 - Pivot Trendlines 30/30 (TypeScript Definition)
 *
 * Implements institutional 30/30 pivot trendline geometry:
 *  - Left 30, Right 30 pivots (30-bar confirmation lag by design)
 *  - Downtrend Line: connects last two confirmed Pivot Highs where PH2 < PH1 (Lower Highs)
 *  - Uptrend Line: connects last two confirmed Pivot Lows where PL2 > PL1 (Higher Lows)
 *  - Ray projection to current bar
 *  - Breakout & Invalidation on candle CLOSE + ATR buffer (never on wick)
 *  - Touch count, slope (pts/bar), age in bars, and retest event tracking
 */

import { Candle, pivothigh, pivotlow, atr } from './pine-helpers';

export interface Trendline3030Config {
  isEnabled: boolean;
  leftBars: number;
  rightBars: number;
  atrPeriod: number;
  breakoutAtrBuffer: number; // e.g. 0.15 x ATR
  retestAtrBuffer: number;   // e.g. 0.20 x ATR
  upColor: string;
  downColor: string;
  lineWidth: number;
}

export interface PivotPointData {
  barIndex: number;
  confirmedBarIndex: number;
  price: number;
  timestamp?: number;
}

export interface TrendlineSegment {
  id: string;
  type: 'UPTREND' | 'DOWNTREND';
  p1: PivotPointData;
  p2: PivotPointData;
  slope: number; // pts per bar
  currentProjectedPrice: number;
  ageBars: number;
  touches: number;
  isBroken: boolean;
  brokenBarIndex: number | null;
  status: 'ACTIVE' | 'BREAKOUT' | 'RETESTING' | 'INVALIDATED';
  statusDescription: string;
}

export interface Trendline3030State {
  isEnabled: boolean;
  uptrendLine: TrendlineSegment | null;
  downtrendLine: TrendlineSegment | null;
  confirmationLagBars: number;
  events: string[];
  currentAtr: number;
  confluenceContribution: {
    bonus: number;
    penalty: number;
    notes: string[];
  };
  lastBarIndex: number;
}

export const DEFAULT_TRENDLINE_3030_CONFIG: Trendline3030Config = {
  isEnabled: false,
  leftBars: 30,
  rightBars: 30,
  atrPeriod: 14,
  breakoutAtrBuffer: 0.15,
  retestAtrBuffer: 0.20,
  upColor: '#00E676', // Emerald
  downColor: '#FF3B69', // Crimson
  lineWidth: 2
};

export class PivotTrendlines3030Engine {
  private config: Trendline3030Config;
  private state: Trendline3030State | null = null;

  constructor(config: Partial<Trendline3030Config> = {}) {
    this.config = { ...DEFAULT_TRENDLINE_3030_CONFIG, ...config };
  }

  public updateConfig(newConfig: Partial<Trendline3030Config>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): Trendline3030Config {
    return { ...this.config };
  }

  /**
   * Pure calculation of 30/30 Pivot Trendlines
   */
  public calculate(candles: Candle[]): Trendline3030State | null {
    const minBars = (this.config.leftBars + this.config.rightBars) * 2 + 10;
    if (!this.config.isEnabled || !candles || candles.length < minBars) {
      return null;
    }

    const n = candles.length;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const currentPrice = closes[n - 1];

    const atrSeries = atr(candles, this.config.atrPeriod);
    const currentAtr = atrSeries[n - 1] || 15;
    const breakoutBufferPts = this.config.breakoutAtrBuffer * currentAtr;
    const retestBufferPts = this.config.retestAtrBuffer * currentAtr;

    // 1. Detect 30/30 Pivots
    const phSeries = pivothigh(highs, this.config.leftBars, this.config.rightBars);
    const plSeries = pivotlow(lows, this.config.leftBars, this.config.rightBars);

    // Collect all confirmed pivot highs & lows
    const pivotHighs: PivotPointData[] = [];
    const pivotLows: PivotPointData[] = [];

    for (let i = 0; i < n; i++) {
      if (phSeries[i] !== null) {
        const pivotBar = i - this.config.rightBars;
        pivotHighs.push({
          barIndex: pivotBar,
          confirmedBarIndex: i,
          price: highs[pivotBar],
          timestamp: candles[pivotBar]?.timestamp
        });
      }
      if (plSeries[i] !== null) {
        const pivotBar = i - this.config.rightBars;
        pivotLows.push({
          barIndex: pivotBar,
          confirmedBarIndex: i,
          price: lows[pivotBar],
          timestamp: candles[pivotBar]?.timestamp
        });
      }
    }

    const events: string[] = [];

    // 2. Construct Downtrend Line (last two confirmed pivot highs where PH2 < PH1)
    let downtrendLine: TrendlineSegment | null = null;
    for (let i = pivotHighs.length - 1; i >= 1; i--) {
      const ph2 = pivotHighs[i];
      const ph1 = pivotHighs[i - 1];
      if (ph2.price < ph1.price && ph2.barIndex > ph1.barIndex) {
        const dx = ph2.barIndex - ph1.barIndex;
        const dy = ph2.price - ph1.price;
        const slope = dy / dx; // Negative for downtrend

        // Project line to current bar (index n - 1)
        const currentProjected = ph2.price + slope * (n - 1 - ph2.barIndex);
        const ageBars = (n - 1) - ph1.barIndex;

        // Count touches & check breakout
        let touches = 2; // Starts with p1 and p2
        let isBroken = false;
        let brokenBar = null;

        for (let b = ph2.barIndex + 1; b < n; b++) {
          const lineVal = ph2.price + slope * (b - ph2.barIndex);
          const barHigh = highs[b];
          const barClose = closes[b];

          // Touch test: wick approaches within 0.15 ATR without closing above
          if (Math.abs(barHigh - lineVal) <= retestBufferPts && barClose <= lineVal + breakoutBufferPts) {
            touches++;
          }

          // Breakout test: close > lineVal + buffer
          if (barClose > lineVal + breakoutBufferPts) {
            isBroken = true;
            brokenBar = b;
          }
        }

        let status: 'ACTIVE' | 'BREAKOUT' | 'RETESTING' | 'INVALIDATED' = 'ACTIVE';
        let statusDescription = `Active 30/30 Downtrend (Slope: ${slope.toFixed(2)} pts/bar, ${touches} touches)`;

        if (isBroken) {
          if (currentPrice >= currentProjected - retestBufferPts && currentPrice <= currentProjected + retestBufferPts) {
            status = 'RETESTING';
            statusDescription = `Broken 30/30 Downtrend Line, currently retesting as support`;
            events.push(`⚡ Trendline Retest: Retesting broken 30/30 downtrend line at ${currentProjected.toFixed(1)}`);
          } else if (currentPrice > currentProjected + breakoutBufferPts) {
            status = 'BREAKOUT';
            statusDescription = `Bullish Breakout: Candle closed above 30/30 downtrend line`;
            if (brokenBar === n - 1) {
              events.push(`🚀 30/30 Breakout: Close (${currentPrice}) surged above downtrend line (${currentProjected.toFixed(1)})`);
            }
          } else {
            status = 'INVALIDATED';
            statusDescription = `Invalidated / Fell back below line`;
          }
        }

        downtrendLine = {
          id: `DTL-${ph1.barIndex}-${ph2.barIndex}`,
          type: 'DOWNTREND',
          p1: ph1,
          p2: ph2,
          slope: parseFloat(slope.toFixed(3)),
          currentProjectedPrice: parseFloat(currentProjected.toFixed(1)),
          ageBars,
          touches,
          isBroken,
          brokenBarIndex: brokenBar,
          status,
          statusDescription
        };
        break;
      }
    }

    // 3. Construct Uptrend Line (last two confirmed pivot lows where PL2 > PL1)
    let uptrendLine: TrendlineSegment | null = null;
    for (let i = pivotLows.length - 1; i >= 1; i--) {
      const pl2 = pivotLows[i];
      const pl1 = pivotLows[i - 1];
      if (pl2.price > pl1.price && pl2.barIndex > pl1.barIndex) {
        const dx = pl2.barIndex - pl1.barIndex;
        const dy = pl2.price - pl1.price;
        const slope = dy / dx; // Positive for uptrend

        const currentProjected = pl2.price + slope * (n - 1 - pl2.barIndex);
        const ageBars = (n - 1) - pl1.barIndex;

        let touches = 2;
        let isBroken = false;
        let brokenBar = null;

        for (let b = pl2.barIndex + 1; b < n; b++) {
          const lineVal = pl2.price + slope * (b - pl2.barIndex);
          const barLow = lows[b];
          const barClose = closes[b];

          if (Math.abs(barLow - lineVal) <= retestBufferPts && barClose >= lineVal - breakoutBufferPts) {
            touches++;
          }

          if (barClose < lineVal - breakoutBufferPts) {
            isBroken = true;
            brokenBar = b;
          }
        }

        let status: 'ACTIVE' | 'BREAKOUT' | 'RETESTING' | 'INVALIDATED' = 'ACTIVE';
        let statusDescription = `Active 30/30 Uptrend (Slope: +${slope.toFixed(2)} pts/bar, ${touches} touches)`;

        if (isBroken) {
          if (currentPrice >= currentProjected - retestBufferPts && currentPrice <= currentProjected + retestBufferPts) {
            status = 'RETESTING';
            statusDescription = `Broken 30/30 Uptrend Line, currently retesting as resistance`;
            events.push(`⚡ Trendline Retest: Retesting broken 30/30 uptrend line at ${currentProjected.toFixed(1)}`);
          } else if (currentPrice < currentProjected - breakoutBufferPts) {
            status = 'BREAKOUT';
            statusDescription = `Bearish Breakdown: Candle closed below 30/30 uptrend line`;
            if (brokenBar === n - 1) {
              events.push(`🔻 30/30 Breakdown: Close (${currentPrice}) pierced below uptrend line (${currentProjected.toFixed(1)})`);
            }
          } else {
            status = 'INVALIDATED';
            statusDescription = `Invalidated / Closed back inside`;
          }
        }

        uptrendLine = {
          id: `UTL-${pl1.barIndex}-${pl2.barIndex}`,
          type: 'UPTREND',
          p1: pl1,
          p2: pl2,
          slope: parseFloat(slope.toFixed(3)),
          currentProjectedPrice: parseFloat(currentProjected.toFixed(1)),
          ageBars,
          touches,
          isBroken,
          brokenBarIndex: brokenBar,
          status,
          statusDescription
        };
        break;
      }
    }

    // 4. Confluence Contribution
    let bonus = 0;
    let penalty = 0;
    const notes: string[] = [];

    if (downtrendLine && downtrendLine.status === 'BREAKOUT') {
      bonus += 12;
      notes.push(`Confirmed 30/30 Downtrend Breakout (+12 pts confluence)`);
    } else if (downtrendLine && !downtrendLine.isBroken) {
      const dist = downtrendLine.currentProjectedPrice - currentPrice;
      if (dist > 0 && dist < 0.6 * currentAtr) {
        penalty += 8;
        notes.push(`Downtrend Line overhead at ${downtrendLine.currentProjectedPrice} (-8 pts obstacle)`);
      }
    }

    if (uptrendLine && uptrendLine.status === 'BREAKOUT') {
      bonus += 12;
      notes.push(`Confirmed 30/30 Uptrend Breakdown (+12 pts confluence)`);
    } else if (uptrendLine && !uptrendLine.isBroken) {
      const dist = currentPrice - uptrendLine.currentProjectedPrice;
      if (dist > 0 && dist < 0.6 * currentAtr) {
        penalty += 8;
        notes.push(`Uptrend Line support below at ${uptrendLine.currentProjectedPrice} (-8 pts obstacle)`);
      }
    }

    this.state = {
      isEnabled: true,
      uptrendLine,
      downtrendLine,
      confirmationLagBars: this.config.rightBars,
      events,
      currentAtr: parseFloat(currentAtr.toFixed(1)),
      confluenceContribution: { bonus, penalty, notes },
      lastBarIndex: n - 1
    };

    return this.state;
  }

  public getState(): Trendline3030State | null {
    return this.state;
  }

  public dispose(): void {
    this.state = null;
  }
}
