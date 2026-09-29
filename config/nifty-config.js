/**
 * TradeSight NIFTY 50 Engine - Master Configuration & Thresholds
 * 30-Year Veteran Nifty Institutional Trader Settings
 */

export const NIFTY_CONFIG = {
  symbol: {
    identifiers: ['NIFTY', 'NIFTY50', 'NIFTY 50', 'NIFTY1!', 'NIFTY_F1', 'CNX_NIFTY'],
    defaultLotSize: 25, // Current NSE Nifty Index lot size
    tickSize: 0.05,
    pointValuePerLot: 25
  },

  // Market Timing (Indian Standard Time - IST)
  tradingHours: {
    marketOpen: { hour: 9, minute: 15 },
    openBufferEnd: { hour: 9, minute: 20 }, // 09:15-09:20: First 5 mins - Extreme noise, no-trade filter
    orbWindow15: { hour: 9, minute: 30 },
    orbWindow30: { hour: 9, minute: 45 },
    lunchChopStart: { hour: 11, minute: 30 }, // European pre-open chop & low volume
    lunchChopEnd: { hour: 13, minute: 30 },   // Avoid initiating fresh breakouts unless volume > 2x
    europeanOpen: { hour: 13, minute: 30 },   // Major liquidity injection
    expiryMoveWindow: { hour: 14, minute: 0 }, // 14:00-15:15: Expiry gamma burst / short-covering
    intradaySquareOff: { hour: 15, minute: 15 },
    marketClose: { hour: 15, minute: 30 }
  },

  // India VIX Thresholds
  vix: {
    complacencyLow: 11.5,   // Complacency level: Reversals sharp, option sellers dominant
    normalLower: 12.0,
    normalUpper: 17.0,      // Ideal directional trend trading regime
    elevated: 18.0,         // Volatility expansion: Widen SL, reduce lot size by 30%
    extremeRisk: 22.0,      // High fear: Spreads widen, wild whipsaws, avoid overnight CE/PE
    spikeThresholdPct: 6.0  // Daily VIX jump > 6% indicates institutional hedge buying
  },

  // Candlestick Pattern Detection Thresholds (Strict Pure Math)
  patternThresholds: {
    dojiBodyToRangeMax: 0.10,          // Body <= 10% of total candle range (High - Low)
    dragonflyUpperWickMax: 0.08,       // Upper wick <= 8% of total range
    gravestoneLowerWickMax: 0.08,      // Lower wick <= 8% of total range
    hammerLowerWickToBodyMin: 2.0,     // Lower wick >= 2.0x body
    hammerUpperWickMax: 0.15,          // Upper wick <= 15% of total range
    shootingStarUpperWickToBodyMin: 2.0,
    shootingStarLowerWickMax: 0.15,
    marubozuBodyToRangeMin: 0.85,      // Body >= 85% of total range (near zero wicks)
    spinningTopBodyMax: 0.30,          // Body <= 30% with symmetric upper and lower wicks
    engulfingMinBodyRatio: 1.10,       // Current body >= 110% of previous body
    atrMultiplierSignificant: 1.2,     // Candle range must be >= 1.2x 14-period ATR to be high-conviction
    locationProximityPct: 0.0025       // Within 0.25% distance from key level (~60 pts on 24,000 Nifty)
  },

  // Nifty Heavyweight Ticker Weights & Correlation (Approx 60% of Nifty)
  heavyweights: [
    { symbol: 'HDFCBANK', name: 'HDFC Bank', weight: 11.5, sector: 'BANK' },
    { symbol: 'RELIANCE', name: 'Reliance Industries', weight: 9.8, sector: 'ENERGY' },
    { symbol: 'ICICIBANK', name: 'ICICI Bank', weight: 7.9, sector: 'BANK' },
    { symbol: 'INFY', name: 'Infosys', weight: 5.6, sector: 'IT' },
    { symbol: 'ITC', name: 'ITC Ltd', weight: 4.1, sector: 'FMCG' },
    { symbol: 'TCS', name: 'TCS', weight: 3.9, sector: 'IT' },
    { symbol: 'LT', name: 'Larsen & Toubro', weight: 3.8, sector: 'INFRA' },
    { symbol: 'BHARTIARTL', name: 'Bharti Airtel', weight: 3.6, sector: 'TELECOM' }
  ],

  // Expiry Rules (Thursdays for NIFTY 50)
  expiry: {
    dayOfWeek: 4, // Thursday (0 = Sun, 4 = Thu)
    gammaBurstWindowStart: 13.5, // 13:30 onwards
    lateEntryCutoffHour: 14.5,   // 14:30 - Avoid buying OTM options; theta goes to 0
    reducedSizeMultiplier: 0.60  // 40% size reduction on expiry afternoon
  },

  // Strategy Switches & Parameters
  strategies: {
    orb: { enabled: true, windowMinutes: 15, minBreakoutCandleAtrRatio: 1.0 },
    vwapReversion: { enabled: true, bandStdDev: 2.0, minPullbackBars: 2 },
    trendEmaPullback: { enabled: true, fastEma: 9, slowEma: 21, trendEma: 50 },
    srLiquiditySweep: { enabled: true, sweepTicksMin: 4, rejectionWickRatio: 0.45 },
    breakoutRetest: { enabled: true, retestTolerancePts: 12, volumeSurgeMin: 1.5 },
    gapStrategy: { enabled: true, minGapPts: 35, gapFillTargetCutoff: 11.5 },
    expirySpecial: { enabled: true, maxStrikeDistanceAtm: 100 }
  },

  // Non-Negotiable Risk Rules
  risk: {
    maxCapitalRiskPerTradePct: 1.5, // 1.5% max
    minRiskRewardRatio: 2.0,        // 1:2.0 minimum
    maxConsecutiveLossesPerDay: 2,  // Hard daily stop at 2 losses
    defaultCapital: 200000          // 2 Lakhs INR benchmark
  }
};
