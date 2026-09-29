/**
 * TradeSight NIFTY 50 - Candlestick Pattern Engine
 * Pure mathematical pattern detection rules with body/wick ratios and ATR-relative thresholds.
 * Zero vague AI guesses. Strictly deterministic.
 */

import { NIFTY_CONFIG } from '../config/nifty-config.js';

export class CandleHelper {
  static getMetrics(candle) {
    const open = parseFloat(candle.open);
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const close = parseFloat(candle.close);
    const volume = parseFloat(candle.volume || 0);

    const range = Math.max(0.0001, high - low);
    const body = Math.abs(close - open);
    const bodyTop = Math.max(open, close);
    const bodyBottom = Math.min(open, close);
    const upperWick = Math.max(0, high - bodyTop);
    const lowerWick = Math.max(0, bodyBottom - low);

    const isBullish = close > open;
    const isBearish = open > close;
    const isDoji = (body / range) <= NIFTY_CONFIG.patternThresholds.dojiBodyToRangeMax;

    return {
      open, high, low, close, volume,
      range, body, bodyTop, bodyBottom,
      upperWick, lowerWick,
      isBullish, isBearish, isDoji,
      bodyRatio: body / range,
      upperWickRatio: upperWick / range,
      lowerWickRatio: lowerWick / range
    };
  }
}

export const PatternEngine = {
  // ================= 1. SINGLE CANDLE PATTERNS =================
  detectHammer(c, prevTrend = 'DOWN') {
    const m = CandleHelper.getMetrics(c);
    const isHammerShape = m.lowerWick >= m.body * 2.0 && m.upperWickRatio <= 0.15 && m.bodyRatio >= 0.04;
    if (isHammerShape && prevTrend === 'DOWN') {
      return {
        name: 'Hammer',
        direction: 'BULLISH',
        reliability: 4,
        candleCount: 1,
        description: 'Bullish rejection at support; lower wick shows heavy buying absorption.'
      };
    }
    return null;
  },

  detectInvertedHammer(c, prevTrend = 'DOWN') {
    const m = CandleHelper.getMetrics(c);
    const isInverted = m.upperWick >= m.body * 2.0 && m.lowerWickRatio <= 0.15 && m.bodyRatio >= 0.04;
    if (isInverted && prevTrend === 'DOWN') {
      return {
        name: 'Inverted Hammer',
        direction: 'BULLISH',
        reliability: 3,
        candleCount: 1,
        description: 'Early buyer presence in downtrend, requires bullish follow-through candle.'
      };
    }
    return null;
  },

  detectHangingMan(c, prevTrend = 'UP') {
    const m = CandleHelper.getMetrics(c);
    const isHanging = m.lowerWick >= m.body * 2.0 && m.upperWickRatio <= 0.15 && m.bodyRatio >= 0.04;
    if (isHanging && prevTrend === 'UP') {
      return {
        name: 'Hanging Man',
        direction: 'BEARISH',
        reliability: 3,
        candleCount: 1,
        description: 'Vulnerability at highs; heavy intraday selloff despite close near top.'
      };
    }
    return null;
  },

  detectShootingStar(c, prevTrend = 'UP') {
    const m = CandleHelper.getMetrics(c);
    const isStar = m.upperWick >= m.body * 2.0 && m.lowerWickRatio <= 0.15 && m.bodyRatio >= 0.04;
    if (isStar && prevTrend === 'UP') {
      return {
        name: 'Shooting Star',
        direction: 'BEARISH',
        reliability: 4,
        candleCount: 1,
        description: 'Bearish liquidity grab rejection; buyers trapped above resistance.'
      };
    }
    return null;
  },

  detectDoji(c) {
    const m = CandleHelper.getMetrics(c);
    if (!m.isDoji) return null;

    // Dragonfly: Open/Close near High, long lower wick
    if (m.upperWickRatio <= 0.08 && m.lowerWickRatio >= 0.55) {
      return { name: 'Dragonfly Doji', direction: 'BULLISH', reliability: 4, candleCount: 1, description: 'Aggressive lower wick rejection; buyers defended the low.' };
    }
    // Gravestone: Open/Close near Low, long upper wick
    if (m.lowerWickRatio <= 0.08 && m.upperWickRatio >= 0.55) {
      return { name: 'Gravestone Doji', direction: 'BEARISH', reliability: 4, candleCount: 1, description: 'Upper wick supply rejection; bears defended the high.' };
    }
    // Long-Legged: Both wicks long and symmetric
    if (m.upperWickRatio >= 0.35 && m.lowerWickRatio >= 0.35) {
      return { name: 'Long-Legged Doji', direction: 'NEUTRAL', reliability: 3, candleCount: 1, description: 'Extreme volatility and balance of forces; breakout impending.' };
    }

    return { name: 'Standard Doji', direction: 'NEUTRAL', reliability: 2, candleCount: 1, description: 'Equilibrium and pause; awaiting structural trigger.' };
  },

  detectSpinningTop(c) {
    const m = CandleHelper.getMetrics(c);
    const isSpinning = m.bodyRatio >= 0.10 && m.bodyRatio <= 0.30 && m.upperWickRatio >= 0.25 && m.lowerWickRatio >= 0.25;
    if (isSpinning) {
      return { name: 'Spinning Top', direction: 'NEUTRAL', reliability: 2, candleCount: 1, description: 'Indecision and contraction in volatility.' };
    }
    return null;
  },

  detectMarubozu(c) {
    const m = CandleHelper.getMetrics(c);
    if (m.bodyRatio >= NIFTY_CONFIG.patternThresholds.marubozuBodyToRangeMin) {
      if (m.isBullish) {
        return { name: 'Bullish Marubozu', direction: 'BULLISH', reliability: 5, candleCount: 1, description: 'Total institutional buyer dominance from open to close.' };
      } else {
        return { name: 'Bearish Marubozu', direction: 'BEARISH', reliability: 5, candleCount: 1, description: 'Total institutional liquidation from open to close.' };
      }
    }
    return null;
  },

  detectBeltHold(c, prevTrend = 'DOWN') {
    const m = CandleHelper.getMetrics(c);
    // Bullish belt hold: opens at low (lower wick ~0) and rallies with solid body in downtrend
    if (prevTrend === 'DOWN' && m.isBullish && m.lowerWickRatio <= 0.03 && m.bodyRatio >= 0.65) {
      return { name: 'Bullish Belt Hold', direction: 'BULLISH', reliability: 4, candleCount: 1, description: 'Strong open-drive reversal from the exact low of the day.' };
    }
    // Bearish belt hold: opens at high (upper wick ~0) and sells off with solid body in uptrend
    if (prevTrend === 'UP' && m.isBearish && m.upperWickRatio <= 0.03 && m.bodyRatio >= 0.65) {
      return { name: 'Bearish Belt Hold', direction: 'BEARISH', reliability: 4, candleCount: 1, description: 'Immediate institutional short injection at opening high.' };
    }
    return null;
  },

  // ================= 2. TWO CANDLE PATTERNS =================
  detectEngulfing(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);

    // Bullish Engulfing: c1 bearish, c2 bullish, c2 body completely engulfs c1 body
    if (m1.isBearish && m2.isBullish && m2.open <= m1.close && m2.close >= m1.open && m2.body >= m1.body * 1.05) {
      return { name: 'Bullish Engulfing', direction: 'BULLISH', reliability: 5, candleCount: 2, description: 'Buyers overwhelmed previous sellers completely.' };
    }
    // Bearish Engulfing: c1 bullish, c2 bearish, c2 body completely engulfs c1 body
    if (m1.isBullish && m2.isBearish && m2.open >= m1.close && m2.close <= m1.open && m2.body >= m1.body * 1.05) {
      return { name: 'Bearish Engulfing', direction: 'BEARISH', reliability: 5, candleCount: 2, description: 'Sellers crushed previous buyers completely.' };
    }
    return null;
  },

  detectPiercingAndDarkCloud(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const m1Midpoint = (m1.open + m1.close) / 2;

    // Piercing Line (Bullish): Downtrend c1 bear, c2 gaps below c1 low and closes above c1 midpoint
    if (m1.isBearish && m2.isBullish && m2.open < m1.low && m2.close > m1Midpoint && m2.close < m1.open) {
      return { name: 'Piercing Line', direction: 'BULLISH', reliability: 4, candleCount: 2, description: 'Bullish gap-down trap reclaiming >50% of prior red body.' };
    }
    // Dark Cloud Cover (Bearish): Uptrend c1 bull, c2 gaps above c1 high and closes below c1 midpoint
    if (m1.isBullish && m2.isBearish && m2.open > m1.high && m2.close < m1Midpoint && m2.close > m1.open) {
      return { name: 'Dark Cloud Cover', direction: 'BEARISH', reliability: 4, candleCount: 2, description: 'Bearish gap-up trap penetrating >50% of prior green body.' };
    }
    return null;
  },

  detectHarami(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const isInsideBody = m2.bodyTop <= m1.bodyTop && m2.bodyBottom >= m1.bodyBottom;

    if (isInsideBody && m1.body >= m2.body * 1.6) {
      const isCross = m2.isDoji;
      if (m1.isBearish && m2.isBullish) {
        return {
          name: isCross ? 'Bullish Harami Cross' : 'Bullish Harami',
          direction: 'BULLISH',
          reliability: isCross ? 4 : 3,
          candleCount: 2,
          description: 'Selling momentum stalled; inside candle indicates accumulation.'
        };
      }
      if (m1.isBullish && m2.isBearish) {
        return {
          name: isCross ? 'Bearish Harami Cross' : 'Bearish Harami',
          direction: 'BEARISH',
          reliability: isCross ? 4 : 3,
          candleCount: 2,
          description: 'Buying exhaustion; inside candle indicates distribution.'
        };
      }
    }
    return null;
  },

  detectTweezers(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const tolerance = Math.max(0.5, m1.range * 0.04);

    // Tweezer Bottom: Matching lows with rejection wicks
    if (Math.abs(m1.low - m2.low) <= tolerance && m1.lowerWickRatio >= 0.25 && m2.lowerWickRatio >= 0.25) {
      return { name: 'Tweezer Bottom', direction: 'BULLISH', reliability: 4, candleCount: 2, description: 'Double low rejection at exact support level.' };
    }
    // Tweezer Top: Matching highs with rejection wicks
    if (Math.abs(m1.high - m2.high) <= tolerance && m1.upperWickRatio >= 0.25 && m2.upperWickRatio >= 0.25) {
      return { name: 'Tweezer Top', direction: 'BEARISH', reliability: 4, candleCount: 2, description: 'Double high rejection at exact resistance ceiling.' };
    }
    return null;
  },

  detectInsideAndOutsideBar(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);

    // Inside Bar: c2 high <= c1 high AND c2 low >= c1 low
    if (m2.high <= m1.high && m2.low >= m1.low) {
      return { name: 'Inside Bar', direction: 'NEUTRAL', reliability: 3, candleCount: 2, description: 'Range contraction; trade the breakout of Mother Bar.' };
    }
    // Outside Bar: c2 high > c1 high AND c2 low < c1 low
    if (m2.high > m1.high && m2.low < m1.low) {
      const dir = m2.isBullish ? 'BULLISH' : 'BEARISH';
      return { name: 'Outside Bar', direction: dir, reliability: 4, candleCount: 2, description: 'Volatility expansion sweeping both sides.' };
    }
    return null;
  },

  detectKicker(c1, c2) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);

    // Bullish Kicker: c1 bearish, c2 gaps open above c1 open and continues rallying with no lower wick
    if (m1.isBearish && m2.isBullish && m2.open >= m1.open && m2.lowerWickRatio <= 0.05) {
      return { name: 'Bullish Kicker', direction: 'BULLISH', reliability: 5, candleCount: 2, description: 'Sharp unexpected institutional sentiment flip upwards.' };
    }
    // Bearish Kicker: c1 bullish, c2 gaps open below c1 open and continues falling with no upper wick
    if (m1.isBullish && m2.isBearish && m2.open <= m1.open && m2.upperWickRatio <= 0.05) {
      return { name: 'Bearish Kicker', direction: 'BEARISH', reliability: 5, candleCount: 2, description: 'Sharp unexpected institutional sentiment flip downwards.' };
    }
    return null;
  },

  // ================= 3. THREE CANDLE PATTERNS =================
  detectMorningAndEveningStar(c1, c2, c3) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const m3 = CandleHelper.getMetrics(c3);

    // Morning Star: c1 Bear, c2 small body/Doji gapping down, c3 strong Bull penetrating > 50% into c1
    const m1Mid = (m1.open + m1.close) / 2;
    if (m1.isBearish && m2.bodyRatio <= 0.45 && m2.low <= m1.low && m3.isBullish && m3.close >= m1Mid) {
      const isDoji = m2.isDoji;
      return {
        name: isDoji ? 'Morning Doji Star' : 'Morning Star',
        direction: 'BULLISH',
        reliability: 5,
        candleCount: 3,
        description: 'Premier 3-bar reversal; selling exhausted into low, strong buyer reclaim.'
      };
    }

    // Evening Star: c1 Bull, c2 small body/Doji gapping up, c3 strong Bear penetrating > 50% into c1
    if (m1.isBullish && m2.bodyRatio <= 0.45 && m2.high >= m1.high && m3.isBearish && m3.close <= m1Mid) {
      const isDoji = m2.isDoji;
      return {
        name: isDoji ? 'Evening Doji Star' : 'Evening Star',
        direction: 'BEARISH',
        reliability: 5,
        candleCount: 3,
        description: 'Premier 3-bar reversal; buying exhausted at high, strong bear liquidation.'
      };
    }
    return null;
  },

  detectSoldiersAndCrows(c1, c2, c3) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const m3 = CandleHelper.getMetrics(c3);

    // Three White Soldiers: 3 consecutive bullish candles with higher opens inside prior body & higher closes
    if (m1.isBullish && m2.isBullish && m3.isBullish &&
        m2.close > m1.close && m3.close > m2.close &&
        m2.open > m1.open && m2.open < m1.close &&
        m3.open > m2.open && m3.open < m2.close &&
        m1.upperWickRatio <= 0.25 && m2.upperWickRatio <= 0.25 && m3.upperWickRatio <= 0.25) {
      return { name: 'Three White Soldiers', direction: 'BULLISH', reliability: 5, candleCount: 3, description: 'Relentless institutional buying wave.' };
    }

    // Three Black Crows: 3 consecutive bearish candles with lower opens inside prior body & lower closes
    if (m1.isBearish && m2.isBearish && m3.isBearish &&
        m2.close < m1.close && m3.close < m2.close &&
        m2.open < m1.open && m2.open > m1.close &&
        m3.open < m2.open && m3.open > m2.close &&
        m1.lowerWickRatio <= 0.25 && m2.lowerWickRatio <= 0.25 && m3.lowerWickRatio <= 0.25) {
      return { name: 'Three Black Crows', direction: 'BEARISH', reliability: 5, candleCount: 3, description: 'Relentless institutional selling wave.' };
    }
    return null;
  },

  detectThreeInsideAndOutside(c1, c2, c3) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const m3 = CandleHelper.getMetrics(c3);

    // Three Inside Up: Harami (c1 bear, c2 bull inside) followed by c3 close above c1 high
    if (m1.isBearish && m2.isBullish && m2.bodyTop <= m1.bodyTop && m2.bodyBottom >= m1.bodyBottom && m3.isBullish && m3.close > m1.high) {
      return { name: 'Three Inside Up', direction: 'BULLISH', reliability: 5, candleCount: 3, description: 'Confirmed Harami reversal with strong breakout.' };
    }
    // Three Inside Down: Harami (c1 bull, c2 bear inside) followed by c3 close below c1 low
    if (m1.isBullish && m2.isBearish && m2.bodyTop <= m1.bodyTop && m2.bodyBottom >= m1.bodyBottom && m3.isBearish && m3.close < m1.low) {
      return { name: 'Three Inside Down', direction: 'BEARISH', reliability: 5, candleCount: 3, description: 'Confirmed Harami reversal with breakdown.' };
    }
    // Three Outside Up: Outside Bar (c2 engulfs c1) followed by c3 close above c2 high
    if (m2.high > m1.high && m2.low < m1.low && m2.isBullish && m3.isBullish && m3.close > m2.high) {
      return { name: 'Three Outside Up', direction: 'BULLISH', reliability: 5, candleCount: 3, description: 'Confirmed Engulfing continuation breakout.' };
    }
    // Three Outside Down: Outside Bar (c2 engulfs c1) followed by c3 close below c2 low
    if (m2.high > m1.high && m2.low < m1.low && m2.isBearish && m3.isBearish && m3.close < m2.low) {
      return { name: 'Three Outside Down', direction: 'BEARISH', reliability: 5, candleCount: 3, description: 'Confirmed Engulfing continuation breakdown.' };
    }
    return null;
  },

  detectAbandonedBaby(c1, c2, c3) {
    const m1 = CandleHelper.getMetrics(c1);
    const m2 = CandleHelper.getMetrics(c2);
    const m3 = CandleHelper.getMetrics(c3);

    // Bullish Abandoned Baby: c1 bear, c2 Doji completely gapping below c1 low (wicks dont touch), c3 bull gapping above c2 high
    if (m1.isBearish && m2.isDoji && m2.high < m1.low && m3.isBullish && m3.low > m2.high) {
      return { name: 'Bullish Abandoned Baby', direction: 'BULLISH', reliability: 5, candleCount: 3, description: 'Rare island reversal pattern with extreme conviction.' };
    }
    // Bearish Abandoned Baby: c1 bull, c2 Doji completely gapping above c1 high, c3 bear gapping below c2 low
    if (m1.isBullish && m2.isDoji && m2.low > m1.high && m3.isBearish && m3.high < m2.low) {
      return { name: 'Bearish Abandoned Baby', direction: 'BEARISH', reliability: 5, candleCount: 3, description: 'Rare island top pattern with extreme conviction.' };
    }
    return null;
  },

  // ================= 4. COMPOSITE SCANNER & LOCATION CONFLUENCE =================
  /**
   * Evaluates the latest candle(s) against all patterns and filters by location
   * @param {Array} candles - Array of recent OHLC candles in ascending order (candles[length - 1] is latest)
   * @param {Object} keyLevels - { vwap, pdh, pdl, orh, orl, supportZones, resistanceZones, maxCallOi, maxPutOi }
   * @returns {Object|null} Detected pattern details or null if no valid/actionable pattern
   */
  evaluateLatestCandle(candles, keyLevels = {}, prevTrend = 'NEUTRAL') {
    if (!Array.isArray(candles) || candles.length < 1) return null;

    const n = candles.length;
    const c1 = candles[n - 1]; // latest closed bar
    const c0 = n >= 2 ? candles[n - 2] : null;
    const cPrev = n >= 3 ? candles[n - 3] : null;

    const detected = [];

    // 3-Bar checks
    if (cPrev && c0 && c1) {
      const star = this.detectMorningAndEveningStar(cPrev, c0, c1);
      if (star) detected.push(star);
      const soldiers = this.detectSoldiersAndCrows(cPrev, c0, c1);
      if (soldiers) detected.push(soldiers);
      const threeIO = this.detectThreeInsideAndOutside(cPrev, c0, c1);
      if (threeIO) detected.push(threeIO);
      const baby = this.detectAbandonedBaby(cPrev, c0, c1);
      if (baby) detected.push(baby);
    }

    // 2-Bar checks
    if (c0 && c1) {
      const engulf = this.detectEngulfing(c0, c1);
      if (engulf) detected.push(engulf);
      const pierceDark = this.detectPiercingAndDarkCloud(c0, c1);
      if (pierceDark) detected.push(pierceDark);
      const harami = this.detectHarami(c0, c1);
      if (harami) detected.push(harami);
      const tweezer = this.detectTweezers(c0, c1);
      if (tweezer) detected.push(tweezer);
      const inOut = this.detectInsideAndOutsideBar(c0, c1);
      if (inOut) detected.push(inOut);
      const kicker = this.detectKicker(c0, c1);
      if (kicker) detected.push(kicker);
    }

    // 1-Bar checks
    const hammer = this.detectHammer(c1, prevTrend);
    if (hammer) detected.push(hammer);
    const invHammer = this.detectInvertedHammer(c1, prevTrend);
    if (invHammer) detected.push(invHammer);
    const hang = this.detectHangingMan(c1, prevTrend);
    if (hang) detected.push(hang);
    const star = this.detectShootingStar(c1, prevTrend);
    if (star) detected.push(star);
    const doji = this.detectDoji(c1);
    if (doji) detected.push(doji);
    const maru = this.detectMarubozu(c1);
    if (maru) detected.push(maru);
    const belt = this.detectBeltHold(c1, prevTrend);
    if (belt) detected.push(belt);
    const spin = this.detectSpinningTop(c1);
    if (spin) detected.push(spin);

    if (detected.length === 0) return null;

    // Sort by highest reliability
    detected.sort((a, b) => b.reliability - a.reliability);
    const primaryPattern = detected[0];

    // Check Location Confluence
    const locationCheck = this.checkLocationConfluence(c1, keyLevels);
    primaryPattern.isActionable = locationCheck.isAtKeyLevel;
    primaryPattern.locationTag = locationCheck.nearestLevelName || 'Mid-Range (Low Quality)';
    primaryPattern.locationDistance = locationCheck.distancePts;

    return primaryPattern;
  },

  /**
   * Check if candle is within proximity of institutional levels (VWAP, PDH, PDL, ORH, ORL, OI Levels)
   */
  checkLocationConfluence(candle, keyLevels) {
    const price = parseFloat(candle.close);
    const levelsToTest = [];

    if (keyLevels.vwap) levelsToTest.push({ name: 'VWAP', price: keyLevels.vwap });
    if (keyLevels.pdh) levelsToTest.push({ name: 'PDH (Prev Day High)', price: keyLevels.pdh });
    if (keyLevels.pdl) levelsToTest.push({ name: 'PDL (Prev Day Low)', price: keyLevels.pdl });
    if (keyLevels.orh) levelsToTest.push({ name: 'ORH (Opening Range High)', price: keyLevels.orh });
    if (keyLevels.orl) levelsToTest.push({ name: 'ORL (Opening Range Low)', price: keyLevels.orl });
    if (keyLevels.maxCallOi) levelsToTest.push({ name: `Max Call OI (${keyLevels.maxCallOi})`, price: keyLevels.maxCallOi });
    if (keyLevels.maxPutOi) levelsToTest.push({ name: `Max Put OI (${keyLevels.maxPutOi})`, price: keyLevels.maxPutOi });

    let nearest = null;
    let minDistance = Infinity;

    for (const lvl of levelsToTest) {
      const dist = Math.abs(price - lvl.price);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = lvl;
      }
    }

    // Distance threshold: within 0.25% (~60 points on 24,000 Nifty)
    const thresholdPts = price * (NIFTY_CONFIG.patternThresholds.locationProximityPct || 0.0025);
    const isAtKeyLevel = minDistance <= thresholdPts;

    return {
      isAtKeyLevel,
      nearestLevelName: nearest?.name || null,
      distancePts: Math.round(minDistance * 10) / 10
    };
  }
};
