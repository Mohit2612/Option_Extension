/**
 * TradeSight NIFTY 50 - Trendline Pro Engine (Runtime ESM)
 *
 * Professional pivot-based trendline engine with:
 *  - Configurable pivot left/right lookbacks (Fast 10/10, Structure 30/30, 15m 15/15)
 *  - Ray projection to current closed candle
 *  - Breakout, Failed Break, Retest, and Sweep lifecycle events on candle CLOSE only
 *  - Touch count, slope (pts/bar), age in bars, and quality scoring (0-100)
 *  - Strict exchange time (IST) and closed candles only
 */

import { pivothigh, pivotlow, atr } from './pine-helpers.js';

export const DEFAULT_TRENDLINE_PRO_CONFIG = {
  isEnabled: false,
  leftBars: 30,
  rightBars: 30,
  atrPeriod: 14,
  breakoutAtrBuffer: 0.10,
  retestAtrBuffer: 0.20,
  sweepWickThresholdAtr: 0.15,
  minTouches: 2,
  upColor: '#00E676',
  downColor: '#FF3B69',
  zoneBandAtr: 0.20
};

export const TRENDLINE_PRESETS = {
  NIFTY_5M_FAST: {
    leftBars: 10,
    rightBars: 10,
    breakoutAtrBuffer: 0.08,
    retestAtrBuffer: 0.15,
    zoneBandAtr: 0.15
  },
  NIFTY_5M_STRUCTURE: {
    leftBars: 30,
    rightBars: 30,
    breakoutAtrBuffer: 0.10,
    retestAtrBuffer: 0.20,
    zoneBandAtr: 0.20
  },
  NIFTY_15M: {
    leftBars: 15,
    rightBars: 15,
    breakoutAtrBuffer: 0.12,
    retestAtrBuffer: 0.25,
    zoneBandAtr: 0.25
  }
};

export class TrendlineEngine {
  constructor(cfg = {}) {
    this.config = { ...DEFAULT_TRENDLINE_PRO_CONFIG, ...cfg };
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

  /**
   * Update with strictly CLOSED candles in exchange (IST) time.
   */
  update(closedCandles, options = {}) {
    const minBars = (this.config.leftBars + this.config.rightBars) * 2 + 10;

    if (!this.config.isEnabled) {
      return this.createInactiveState('Module is toggled OFF');
    }

    if (!closedCandles || closedCandles.length < minBars) {
      return {
        isEnabled: true,
        ready: false,
        uptrendLine: null,
        downtrendLine: null,
        confirmationLagBars: this.config.rightBars,
        events: [],
        lastEvent: null,
        currentAtr: 0,
        score: 0,
        touches: 0,
        distanceAtr: 0,
        lastBarIndex: closedCandles ? closedCandles.length - 1 : 0,
        warning: `Data unavailable: requires >= ${minBars} closed bars for pivot ${this.config.leftBars}/${this.config.rightBars} detection.`
      };
    }

    const n = closedCandles.length;
    const highs = closedCandles.map((c) => c.high);
    const lows = closedCandles.map((c) => c.low);
    const closes = closedCandles.map((c) => c.close);
    const currentClose = closes[n - 1];
    const prevClose = closes[n - 2];
    const currentHigh = highs[n - 1];
    const currentLow = lows[n - 1];
    const currentTimestamp = closedCandles[n - 1].timestamp || Date.now();

    const atrSeries = atr(closedCandles, this.config.atrPeriod);
    const currentAtr = Math.max(1.0, atrSeries[atrSeries.length - 1] || 15.0);
    const bufferPts = this.config.breakoutAtrBuffer * currentAtr;
    const bandPts = this.config.zoneBandAtr * currentAtr;

    // 1. Confirmed Pivot Detection with exact lag
    const phSeries = pivothigh(highs, this.config.leftBars, this.config.rightBars);
    const plSeries = pivotlow(lows, this.config.leftBars, this.config.rightBars);

    const confirmedHighs = [];
    const confirmedLows = [];

    for (let i = 0; i < n; i++) {
      if (phSeries[i] !== null) {
        const pivotBar = i - this.config.rightBars;
        confirmedHighs.push({
          barIndex: pivotBar,
          confirmedBarIndex: i,
          price: highs[pivotBar],
          timestamp: closedCandles[pivotBar]?.timestamp
        });
      }
      if (plSeries[i] !== null) {
        const pivotBar = i - this.config.rightBars;
        confirmedLows.push({
          barIndex: pivotBar,
          confirmedBarIndex: i,
          price: lows[pivotBar],
          timestamp: closedCandles[pivotBar]?.timestamp
        });
      }
    }

    // 2. Downtrend Line Construction (last 2 confirmed highs with Lower High)
    let dtl = null;
    if (confirmedHighs.length >= 2) {
      for (let j = confirmedHighs.length - 1; j >= 1; j--) {
        const p2 = confirmedHighs[j];
        const p1 = confirmedHighs[j - 1];
        if (p2.price < p1.price && p2.barIndex > p1.barIndex) {
          const run = p2.barIndex - p1.barIndex;
          const drop = p2.price - p1.price;
          const slope = drop / run;
          const projectedPrice = parseFloat((p2.price + slope * (n - 1 - p2.barIndex)).toFixed(2));
          const ageBars = n - 1 - p1.barIndex;

          let touches = 2;
          for (let b = p1.barIndex + 1; b < n - 1; b++) {
            if (b === p2.barIndex) continue;
            const lineAtBar = p1.price + slope * (b - p1.barIndex);
            if (highs[b] >= lineAtBar - bufferPts && highs[b] <= lineAtBar + bufferPts) {
              touches++;
            }
          }

          let isBroken = false;
          let brokenBarIndex = null;
          let status = 'ACTIVE';
          let statusDescription = `Holding Lower-High resistance (${touches} touches)`;

          for (let b = p2.barIndex + 1; b < n; b++) {
            const lineAtBar = p1.price + slope * (b - p1.barIndex);
            if (closes[b] > lineAtBar + bufferPts) {
              isBroken = true;
              brokenBarIndex = b;
              break;
            }
          }

          const touchScore = Math.min(40, touches * 10);
          const slopeScore = Math.abs(slope) > 0.05 && Math.abs(slope) < 2.5 ? 30 : 15;
          const ageScore = ageBars >= 20 && ageBars <= 300 ? 30 : 15;
          const score = Math.min(100, touchScore + slopeScore + ageScore);

          dtl = {
            id: `DTL-${p1.barIndex}-${p2.barIndex}`,
            type: 'DOWNTREND',
            p1,
            p2,
            slope: parseFloat(slope.toFixed(4)),
            currentProjectedPrice: projectedPrice,
            ageBars,
            touches,
            score,
            isBroken,
            brokenBarIndex,
            status,
            statusDescription,
            zoneTop: parseFloat((projectedPrice + bandPts).toFixed(2)),
            zoneBottom: parseFloat((projectedPrice - bandPts).toFixed(2))
          };
          break;
        }
      }
    }

    // 3. Uptrend Line Construction (last 2 confirmed lows with Higher Low)
    let utl = null;
    if (confirmedLows.length >= 2) {
      for (let j = confirmedLows.length - 1; j >= 1; j--) {
        const p2 = confirmedLows[j];
        const p1 = confirmedLows[j - 1];
        if (p2.price > p1.price && p2.barIndex > p1.barIndex) {
          const run = p2.barIndex - p1.barIndex;
          const rise = p2.price - p1.price;
          const slope = rise / run;
          const projectedPrice = parseFloat((p2.price + slope * (n - 1 - p2.barIndex)).toFixed(2));
          const ageBars = n - 1 - p1.barIndex;

          let touches = 2;
          for (let b = p1.barIndex + 1; b < n - 1; b++) {
            if (b === p2.barIndex) continue;
            const lineAtBar = p1.price + slope * (b - p1.barIndex);
            if (lows[b] <= lineAtBar + bufferPts && lows[b] >= lineAtBar - bufferPts) {
              touches++;
            }
          }

          let isBroken = false;
          let brokenBarIndex = null;
          let status = 'ACTIVE';
          let statusDescription = `Holding Higher-Low support (${touches} touches)`;

          for (let b = p2.barIndex + 1; b < n; b++) {
            const lineAtBar = p1.price + slope * (b - p1.barIndex);
            if (closes[b] < lineAtBar - bufferPts) {
              isBroken = true;
              brokenBarIndex = b;
              break;
            }
          }

          const touchScore = Math.min(40, touches * 10);
          const slopeScore = Math.abs(slope) > 0.05 && Math.abs(slope) < 2.5 ? 30 : 15;
          const ageScore = ageBars >= 20 && ageBars <= 300 ? 30 : 15;
          const score = Math.min(100, touchScore + slopeScore + ageScore);

          utl = {
            id: `UTL-${p1.barIndex}-${p2.barIndex}`,
            type: 'UPTREND',
            p1,
            p2,
            slope: parseFloat(slope.toFixed(4)),
            currentProjectedPrice: projectedPrice,
            ageBars,
            touches,
            score,
            isBroken,
            brokenBarIndex,
            status,
            statusDescription,
            zoneTop: parseFloat((projectedPrice + bandPts).toFixed(2)),
            zoneBottom: parseFloat((projectedPrice - bandPts).toFixed(2))
          };
          break;
        }
      }
    }

    // 4. Lifecycle Event Evaluation
    const newEvents = [];

    if (dtl) {
      const linePx = dtl.currentProjectedPrice;
      const prevLinePx = dtl.currentProjectedPrice - dtl.slope;

      if (prevClose <= prevLinePx + bufferPts && currentClose > linePx + bufferPts) {
        newEvents.push({
          id: `EV-DTL-BRK-${n - 1}`,
          type: 'BREAK_UP',
          sourceType: 'TRENDLINE',
          sourceId: dtl.id,
          direction: 'BULLISH',
          price: currentClose,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: dtl.score,
          note: `Broke above DTL (${dtl.touches}t) @ ${currentClose} (+${(currentClose - linePx).toFixed(1)} pts)`
        });
        dtl.status = 'BREAKOUT';
        dtl.statusDescription = `Confirmed Breakout above DTL (${dtl.touches} touches)`;
      } else if (dtl.isBroken && Math.abs(currentClose - linePx) <= this.config.retestAtrBuffer * currentAtr && currentClose >= linePx) {
        newEvents.push({
          id: `EV-DTL-RT-${n - 1}`,
          type: 'RETEST',
          sourceType: 'TRENDLINE',
          sourceId: dtl.id,
          direction: 'BULLISH',
          price: currentClose,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: dtl.score,
          note: `Retesting broken DTL as support @ ${currentClose}`
        });
        dtl.status = 'RETESTING';
      } else if (!dtl.isBroken && currentHigh > linePx + bufferPts && currentClose <= linePx) {
        newEvents.push({
          id: `EV-DTL-SW-${n - 1}`,
          type: 'SWEEP',
          sourceType: 'TRENDLINE',
          sourceId: dtl.id,
          direction: 'BEARISH',
          price: currentHigh,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: Math.min(100, dtl.score + 10),
          note: `Liquidity sweep above DTL rejected; closed back inside @ ${currentClose}`
        });
      }
    }

    if (utl) {
      const linePx = utl.currentProjectedPrice;
      const prevLinePx = utl.currentProjectedPrice - utl.slope;

      if (prevClose >= prevLinePx - bufferPts && currentClose < linePx - bufferPts) {
        newEvents.push({
          id: `EV-UTL-BRK-${n - 1}`,
          type: 'BREAK_DOWN',
          sourceType: 'TRENDLINE',
          sourceId: utl.id,
          direction: 'BEARISH',
          price: currentClose,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: utl.score,
          note: `Broke below UTL (${utl.touches}t) @ ${currentClose} (-${(linePx - currentClose).toFixed(1)} pts)`
        });
        utl.status = 'BREAKOUT';
        utl.statusDescription = `Confirmed Breakdown below UTL (${utl.touches} touches)`;
      } else if (utl.isBroken && Math.abs(currentClose - linePx) <= this.config.retestAtrBuffer * currentAtr && currentClose <= linePx) {
        newEvents.push({
          id: `EV-UTL-RT-${n - 1}`,
          type: 'RETEST',
          sourceType: 'TRENDLINE',
          sourceId: utl.id,
          direction: 'BEARISH',
          price: currentClose,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: utl.score,
          note: `Retesting broken UTL as overhead resistance @ ${currentClose}`
        });
        utl.status = 'RETESTING';
      } else if (!utl.isBroken && currentLow < linePx - bufferPts && currentClose >= linePx) {
        newEvents.push({
          id: `EV-UTL-SW-${n - 1}`,
          type: 'SWEEP',
          sourceType: 'TRENDLINE',
          sourceId: utl.id,
          direction: 'BULLISH',
          price: currentLow,
          barIndex: n - 1,
          timestamp: currentTimestamp,
          quality: Math.min(100, utl.score + 10),
          note: `Liquidity sweep below UTL rejected; closed back above @ ${currentClose}`
        });
      }
    }

    newEvents.forEach((ev) => {
      if (!this.eventHistory.some((e) => e.id === ev.id)) {
        this.eventHistory.push(ev);
      }
    });

    let distanceAtr = 999;
    let dominantScore = 0;
    let dominantTouches = 0;

    if (dtl) {
      const dist = Math.abs(currentClose - dtl.currentProjectedPrice) / currentAtr;
      if (dist < distanceAtr) distanceAtr = parseFloat(dist.toFixed(2));
      dominantScore = Math.max(dominantScore, dtl.score);
      dominantTouches = Math.max(dominantTouches, dtl.touches);
    }
    if (utl) {
      const dist = Math.abs(currentClose - utl.currentProjectedPrice) / currentAtr;
      if (dist < distanceAtr) distanceAtr = parseFloat(dist.toFixed(2));
      dominantScore = Math.max(dominantScore, utl.score);
      dominantTouches = Math.max(dominantTouches, utl.touches);
    }

    this.state = {
      isEnabled: true,
      ready: true,
      uptrendLine: utl,
      downtrendLine: dtl,
      confirmationLagBars: this.config.rightBars,
      events: [...this.eventHistory],
      lastEvent: this.eventHistory[this.eventHistory.length - 1] || null,
      currentAtr: parseFloat(currentAtr.toFixed(1)),
      score: dominantScore,
      touches: dominantTouches,
      distanceAtr: distanceAtr === 999 ? 0 : distanceAtr,
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

    if (this.state.downtrendLine) {
      const d = this.state.downtrendLine;
      drawings.push({
        type: 'ZONE_BOX',
        id: `ZONE-${d.id}`,
        y1: d.zoneTop,
        y2: d.zoneBottom,
        color: 'rgba(255, 59, 105, 0.08)',
        width: 1,
        label: `DTL Zone (${d.score}/100)`
      });
      drawings.push({
        type: 'TRENDLINE',
        id: d.id,
        y1: d.p1.price,
        y2: d.currentProjectedPrice,
        x1: d.p1.barIndex,
        x2: this.state.lastBarIndex,
        color: this.config.downColor,
        width: d.score >= 80 ? 3 : d.score >= 60 ? 2 : 1,
        style: d.isBroken ? 'dashed' : 'solid',
        label: `DTL (${d.touches}t, Score ${d.score}) -> ${d.currentProjectedPrice}`
      });
    }

    if (this.state.uptrendLine) {
      const u = this.state.uptrendLine;
      drawings.push({
        type: 'ZONE_BOX',
        id: `ZONE-${u.id}`,
        y1: u.zoneTop,
        y2: u.zoneBottom,
        color: 'rgba(0, 230, 118, 0.08)',
        width: 1,
        label: `UTL Zone (${u.score}/100)`
      });
      drawings.push({
        type: 'TRENDLINE',
        id: u.id,
        y1: u.p1.price,
        y2: u.currentProjectedPrice,
        x1: u.p1.barIndex,
        x2: this.state.lastBarIndex,
        color: this.config.upColor,
        width: u.score >= 80 ? 3 : u.score >= 60 ? 2 : 1,
        style: u.isBroken ? 'dashed' : 'solid',
        label: `UTL (${u.touches}t, Score ${u.score}) -> ${u.currentProjectedPrice}`
      });
    }

    this.eventHistory.slice(-5).forEach((ev) => {
      drawings.push({
        type: 'MARK',
        id: ev.id,
        price: ev.price,
        barIndex: ev.barIndex,
        color: ev.direction === 'BULLISH' ? '#00E676' : '#FF3B69',
        label: ev.type === 'BREAK_UP' ? 'B▲' : ev.type === 'BREAK_DOWN' ? 'B▼' : ev.type === 'RETEST' ? 'RT' : ev.type === 'SWEEP' ? 'SW' : 'FB',
        tooltip: `${ev.note} (Quality: ${ev.quality}/100)`
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
      uptrendLine: null,
      downtrendLine: null,
      confirmationLagBars: this.config.rightBars,
      events: [],
      lastEvent: null,
      currentAtr: 0,
      score: 0,
      touches: 0,
      distanceAtr: 0,
      lastBarIndex: 0,
      warning
    };
  }
}
