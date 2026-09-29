/**
 * TradeSight NIFTY 50 - Module A: Hero-Zero Expiry Day Engine
 * Strictly active on verified NSE Nifty Expiry Days during the 13:45 - 14:45 IST gamma window.
 * Treats every trade as a 100% pre-accepted loss with strict strike selection (₹5 - ₹40) and 2-loss lockout.
 */

import { SessionClock } from '../services/sessionClock.js';
import { ExpiryCalendar } from '../services/expiryCalendar.js';
import { OptionChainService } from '../services/optionChain.js';
import { RiskManager } from '../services/riskManager.js';

export const HeroZeroStrategy = {
  MODULE_KEY: 'HERO_ZERO',

  DEFAULT_CONFIG: {
    enabled: true,
    startHour: 13,
    startMinute: 45,
    endHour: 14,
    endMinute: 45,
    exitTimeHour: 15,
    exitTimeMinute: 15, // Mandatory 15:15 hard close to prevent zero expiration
    premiumMin: 5,      // ₹5 floor
    premiumMax: 40,     // ₹40 ceiling
    maxCapitalRiskPct: 0.75, // 0.75% max of account capital
    allowMorningTrendHeroZero: false
  },

  /**
   * Main Hero-Zero evaluation pipeline
   */
  evaluate({
    candles = [],
    keyLevels = {},
    driverData = {},
    pattern = null,
    regime = {},
    dailyState = {},
    userConfig = {},
    currentTime = new Date()
  }) {
    const config = { ...this.DEFAULT_CONFIG, ...(userConfig?.strategies?.heroZero || {}) };
    if (!config.enabled) return null;

    const ist = SessionClock.getIstParts(currentTime);
    const mins = ist.totalMinutes;

    // Condition 1: Must be verified Nifty Expiry Day
    const expiryStatus = ExpiryCalendar.checkExpiry(currentTime, userConfig);
    if (!expiryStatus.isExpiry) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'NON_EXPIRY_DAY',
        reason: `Hero-Zero engine is inactive today (${ist.isoDate}). Next scheduled Nifty expiry is on Thursday (${expiryStatus.effectiveExpiryDate}).`
      };
    }

    // Condition 2: Time Window (Default 13:45 - 14:45 IST)
    const startMins = config.startHour * 60 + config.startMinute; // 13:45 = 825 mins
    const endMins = config.endHour * 60 + config.endMinute;       // 14:45 = 885 mins

    if (mins < startMins || mins > endMins) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: mins < startMins ? 'HERO_ZERO_ARMING' : 'WINDOW_EXPIRED',
        reason: mins < startMins
          ? `Hero-Zero gamma window arms at 13:45 IST (Current: ${ist.formattedTime}). Stand by for peak gamma momentum.`
          : 'Hero-Zero entry window closed (> 14:45 IST). Late entries face rapid theta decay.'
      };
    }

    // Condition 3: Risk Manager Lockout Check (Max 2 failures lockout)
    const permission = RiskManager.evaluateTradePermission(this.MODULE_KEY, dailyState, userConfig?.risk);
    if (!permission.allowed) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'LOCKED_OUT',
        reason: permission.reason
      };
    }

    // Condition 4: Regime Filter (Cannot be Range/Chop)
    if (regime.type === 'RANGE') {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'REGIME_CHOP_BLOCKED',
        reason: 'Market is in Range-Bound chop. Hero-Zero requires clean directional breakout to overcome extreme expiry theta.'
      };
    }

    if (candles.length < 10) return null;

    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const spotPrice = latest.close;
    const vwap = keyLevels.vwap || spotPrice;
    const dayHigh = Math.max(...candles.map((c) => c.high));
    const dayLow = Math.min(...candles.map((c) => c.low));

    // Condition 5: Confluence Triggers (At least 3 must align)
    const bullishConfluences = [];
    const bearishConfluences = [];

    // Trigger A: Day High/Low Breakout
    if (latest.close >= dayHigh - 5) bullishConfluences.push('Price pressing/breaking Day High with expansion');
    if (latest.close <= dayLow + 5) bearishConfluences.push('Price pressing/breaking Day Low with expansion');

    // Trigger B: VWAP & Momentum Pattern
    if (latest.close > vwap && pattern && pattern.direction === 'BULLISH') {
      bullishConfluences.push(`Bullish ${pattern.name} holding above VWAP (${vwap})`);
    }
    if (latest.close < vwap && pattern && pattern.direction === 'BEARISH') {
      bearishConfluences.push(`Bearish ${pattern.name} rejecting below VWAP (${vwap})`);
    }

    // Trigger C: India VIX Behavior
    const vixChange = driverData.vixAnalysis?.details ? parseFloat(driverData.vixAnalysis.details.match(/Change:\s*([0-9.-]+)%/)?.[1] || 0) : 0;
    if (vixChange < 0 && spotPrice > vwap) bullishConfluences.push('VIX contracting while Nifty rallies (healthy bull run)');
    if (vixChange > 2.0 && spotPrice < vwap) bearishConfluences.push('VIX spiking while Nifty breaks down (fear confirmation)');

    // Trigger D: Market Pressure Score
    if (driverData.pressureScore >= 20) bullishConfluences.push(`Strong bullish Pressure Score (+${driverData.pressureScore})`);
    if (driverData.pressureScore <= -20) bearishConfluences.push(`Strong bearish Pressure Score (${driverData.pressureScore})`);

    // Trigger E: Options OI Unwinding
    if (driverData.drivers?.some((d) => d.id === 'options_chain' && d.score > 20)) {
      bullishConfluences.push('Call writers covering short positions');
    }
    if (driverData.drivers?.some((d) => d.id === 'options_chain' && d.score < -20)) {
      bearishConfluences.push('Put writers trapped and liquidating');
    }

    // Decision: Check if >= 3 confluences align
    let direction = null;
    let activeConfluences = [];

    if (bullishConfluences.length >= 3) {
      direction = 'BUY_CE';
      activeConfluences = bullishConfluences;
    } else if (bearishConfluences.length >= 3) {
      direction = 'BUY_PE';
      activeConfluences = bearishConfluences;
    } else {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        status: 'AWAITING_CONFLUENCE',
        reason: `Hero-Zero requires at least 3 confluence factors (Currently: ${Math.max(bullishConfluences.length, bearishConfluences.length)}/3). Stand aside.`
      };
    }

    // Step 6: Strike Selection (Rs 5 to Rs 40 band)
    const strikeInfo = OptionChainService.selectHeroZeroStrike({
      spotPrice,
      direction,
      premiumMin: config.premiumMin,
      premiumMax: config.premiumMax,
      currentAtmIv: driverData.optionsData?.atmIv || 13.5
    });

    // Step 7: Lot Sizing & Pre-Accepted Risk
    const capital = userConfig?.risk?.capital || 200000;
    const lotSize = expiryStatus.lotSize || 25;
    const sizing = RiskManager.calculateLotSizing({
      capital,
      riskPct: config.maxCapitalRiskPct,
      premiumPerShare: strikeInfo.estimatedPremium,
      lotSize,
      isHeroZero: true
    });

    if (!sizing.allowed) {
      return {
        module: this.MODULE_KEY,
        signal: 'WAIT',
        reason: sizing.error
      };
    }

    // Targets & Stops
    const entryPrem = strikeInfo.estimatedPremium;
    const premiumSl = Math.max(1.0, parseFloat((entryPrem * 0.50).toFixed(1))); // 50% premium stop
    const target1Prem = parseFloat((entryPrem * 2.0).toFixed(1));              // 2x partial book (100% gain)
    const target2Prem = parseFloat((entryPrem * 3.5).toFixed(1));              // 3.5x runner

    return {
      module: this.MODULE_KEY,
      strategyName: `Hero-Zero Expiry Gamma (${direction === 'BUY_CE' ? 'CALL' : 'PUT'})`,
      signal: direction === 'BUY_CE' ? 'BUY' : 'SELL',
      confidence: 76,
      strikeInfo,
      sizing,
      entryTrigger: `Buy ${strikeInfo.symbolFormatted} @ ₹${entryPrem}`,
      levels: {
        entryPrice: spotPrice,
        stopLoss: direction === 'BUY_CE' ? latest.low - 8 : latest.high + 8,
        target1: direction === 'BUY_CE' ? spotPrice + strikeInfo.requiredPointsToDouble : spotPrice - strikeInfo.requiredPointsToDouble,
        target2: direction === 'BUY_CE' ? spotPrice + strikeInfo.requiredPointsToDouble * 2 : spotPrice - strikeInfo.requiredPointsToDouble * 2
      },
      premiumPlan: {
        entryPremium: entryPrem,
        stopLossPremium: premiumSl,
        target1Premium: target1Prem,
        target2Premium: target2Prem,
        requiredNiftyPointsFor2x: strikeInfo.requiredPointsToDouble
      },
      riskRewardRatio: 3.0,
      invalidation: `Candle close below trigger low (${latest.low}) or 50% premium decay to ₹${premiumSl}.`,
      setupRationale: `Expiry 14:00 gamma surge with ${activeConfluences.length} confluence factors.`,
      confluences: activeConfluences,
      mandatoryDisclaimer: '⚠️ MANDATORY DISCLAIMER: Most Hero-Zero trades expire worthless (-100% loss). Treat ₹' + sizing.maxLossAmount + ' as a fully pre-accepted loss.',
      timeStop: 'Hard exit everything by 15:15 IST regardless of P&L.'
    };
  }
};
