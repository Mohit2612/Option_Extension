/**
 * TradeSight NIFTY 50 - Institutional Risk Manager & Daily Loss Circuit Breaker
 * Enforces pre-accepted risk, max trades per module, global daily loss limit,
 * and Hero-Zero 2-loss lockout.
 */

import { NIFTY_CONFIG } from '../config/nifty-config.js';

export const RiskManager = {
  STORAGE_KEY: 'ts_risk_daily_state',

  DEFAULT_LIMITS: {
    maxCapital: 200000,              // ₹2,00,000 INR baseline
    maxTotalDailyTrades: 3,         // Max 3 trades total across all modules
    maxTradesPerModule: 2,          // Max 2 trades per individual strategy
    maxDailyLossPct: 3.0,           // Max 3% total daily loss circuit breaker
    standardRiskPerTradePct: 1.5,   // Standard 1.5% capital risk per trade
    heroZeroMaxRiskPct: 0.75,       // Max 0.75% capital risk for Hero-Zero lottery
    heroZeroMaxFailures: 2          // Hard lockout after 2 consecutive failed Hero-Zero trades
  },

  /**
   * Evaluates whether a module is permitted to generate or execute a signal
   * @param {string} moduleKey - 'HERO_ZERO' | 'OPENING_RANGE' | 'AFTERNOON_140' | 'GENERAL'
   * @param {Object} dailyState - Current day's recorded stats
   * @param {Object} userLimits - Custom user overrides
   * @returns {Object} { allowed: boolean, reason: string|null, lockType: string|null }
   */
  evaluateTradePermission(moduleKey, dailyState = {}, userLimits = {}) {
    const limits = { ...this.DEFAULT_LIMITS, ...userLimits };
    const capital = userLimits.maxCapital || limits.maxCapital;
    const maxDailyLossAmount = (capital * limits.maxDailyLossPct) / 100;

    const totalTradesToday = dailyState.totalTradesCount || 0;
    const dailyNetLoss = Math.max(0, -(dailyState.netRealizedPnl || 0));
    const moduleTrades = dailyState.tradesByModule?.[moduleKey] || 0;
    const heroZeroFailures = dailyState.heroZeroFailures || 0;

    // 1. Check Global Daily Loss Circuit Breaker
    if (dailyNetLoss >= maxDailyLossAmount) {
      return {
        allowed: false,
        reason: `Daily loss circuit breaker hit (-₹${dailyNetLoss.toFixed(0)} >= max ₹${maxDailyLossAmount.toFixed(0)} [${limits.maxDailyLossPct}%]). Trading halted for the day.`,
        lockType: 'GLOBAL_DAILY_LOSS_LOCK'
      };
    }

    // 2. Check Global Total Daily Trades Limit
    if (totalTradesToday >= limits.maxTotalDailyTrades) {
      return {
        allowed: false,
        reason: `Maximum daily trade count reached (${totalTradesToday}/${limits.maxTotalDailyTrades} trades). Stand aside.`,
        lockType: 'GLOBAL_MAX_TRADES_LOCK'
      };
    }

    // 3. Check Module-Specific Trade Count Limit
    if (moduleTrades >= limits.maxTradesPerModule) {
      return {
        allowed: false,
        reason: `Max trades reached for module ${moduleKey} (${moduleTrades}/${limits.maxTradesPerModule}). Module locked for today.`,
        lockType: 'MODULE_MAX_TRADES_LOCK'
      };
    }

    // 4. Hero-Zero 2-Loss Hard Lockout Rule
    if (moduleKey === 'HERO_ZERO' && heroZeroFailures >= limits.heroZeroMaxFailures) {
      return {
        allowed: false,
        reason: `Hero-Zero module locked: ${heroZeroFailures} consecutive failed trades today. No chasing or revenge trading permitted.`,
        lockType: 'HERO_ZERO_FAIL_LOCK'
      };
    }

    return { allowed: true, reason: null, lockType: null };
  },

  /**
   * Check current active lockout status
   * @param {Object} dailyState
   * @returns {Object} { isLocked, lockType, reason, unlockTimeFormatted }
   */
  getLockoutStatus(dailyState = {}) {
    if (dailyState.isLocked) {
      return {
        isLocked: true,
        lockType: dailyState.lockType || 'MANUAL_LOCK',
        reason: dailyState.lockReason || 'Trading locked for discipline.',
        unlockTimeFormatted: '09:15 AM IST (Next Session)'
      };
    }
    return { isLocked: false, lockType: null, reason: null };
  },

  /**
   * Engage manual or automated emergency risk lock
   * @param {string} reason
   * @param {string} lockType
   * @returns {Object} Updated lock state
   */
  engageLock(reason = 'Manual discipline lock engaged by trader.', lockType = 'MANUAL_DISCIPLINE_LOCK') {
    return {
      isLocked: true,
      lockType,
      lockReason: reason,
      lockedAt: Date.now(),
      unlockAtNextSession: true
    };
  },

  /**
   * Calculates lot sizing based on strict pre-accepted premium risk
   * @param {Object} params - { capital, riskPct, premiumPerShare, lotSize, isHeroZero }
   * @returns {Object} { allowed, lots, totalShares, maxLossAmount, warning }
   */
  calculateLotSizing({
    capital = 200000,
    riskPct = 1.0,
    premiumPerShare = 20,
    lotSize = 25,
    isHeroZero = false
  }) {
    const safeCap = Math.max(10000, parseFloat(capital) || 200000);
    const safeRiskPct = Math.max(0.2, Math.min(3.0, parseFloat(riskPct) || 1.0));
    const premium = Math.max(0.5, parseFloat(premiumPerShare) || 20);
    const lot = parseInt(lotSize, 10) || 25;

    // Max cash allowed to be lost on this specific trade
    const maxLossAmount = (safeCap * safeRiskPct) / 100;
    // Cash required for 1 full lot
    const costPerLot = premium * lot;

    if (costPerLot > maxLossAmount) {
      return {
        allowed: false,
        lots: 0,
        totalShares: 0,
        maxLossAmount: Math.round(maxLossAmount),
        costPerLot: Math.round(costPerLot),
        error: `Risk too high for your capital: 1 lot (${lot} shares @ ₹${premium}) requires ₹${costPerLot}, exceeding your max risk limit of ₹${Math.round(maxLossAmount)} (${safeRiskPct}% of ₹${safeCap.toLocaleString()}). Skip trade.`
      };
    }

    const calculatedLots = Math.floor(maxLossAmount / costPerLot);
    const cappedLots = Math.max(1, calculatedLots);
    const totalShares = cappedLots * lot;
    const actualRisk = totalShares * premium;

    return {
      allowed: true,
      lots: cappedLots,
      totalShares,
      maxLossAmount: Math.round(actualRisk),
      costPerLot: Math.round(costPerLot),
      riskPercentageOfCapital: parseFloat(((actualRisk / safeCap) * 100).toFixed(2)),
      warning: isHeroZero
        ? '⚠️ Hero-Zero Alert: Most expiry OTM options expire worthless. Treat ₹' + Math.round(actualRisk) + ' as 100% pre-accepted loss.'
        : null
    };
  }
};
