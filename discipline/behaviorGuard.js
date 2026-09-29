/**
 * TradeSight NIFTY 50 - Behavior Protection & Anti-Tilt Guard (Module 5)
 * Protects trader psychology and capital from destructive tilt habits:
 *  1. Post-Loss Cool-Down: Blocks new trades for N minutes (default 20 mins).
 *  2. Revenge-Trade Detection: Catches sizing increases or lower-grade chasing after a loss.
 *  3. Overtrading Warning: Alerts when approaching daily trade limit.
 *  4. Size Discipline: Validates attempted size against risk-calculated ceiling.
 *  5. Absolute prohibition of averaging down.
 *
 * All messages are short, calm, and factual — never shaming.
 */

export const BehaviorGuard = {
  STORAGE_KEY: 'ts_behavior_guard_state',
  DEFAULT_COOLDOWN_MINUTES: 20,

  /**
   * Evaluate if Cool-Down is currently active
   */
  evaluateCoolDown(coolDownUntil, now = Date.now()) {
    if (!coolDownUntil || now >= coolDownUntil) {
      return {
        isActive: false,
        remainingSeconds: 0,
        formattedRemaining: '00m 00s',
        triggeredAt: null,
        coolDownUntil: null,
        reason: null
      };
    }

    const remainingSec = Math.max(0, Math.ceil((coolDownUntil - now) / 1000));
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const formatted = `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;

    return {
      isActive: true,
      remainingSeconds: remainingSec,
      formattedRemaining: formatted,
      triggeredAt: null,
      coolDownUntil,
      reason: `Cool-down active after a loss. Signals paused for ${formatted} to restore objective mindset.`
    };
  },

  /**
   * Detect potential revenge-trading behavior after a loss
   * Supports both dailyState / standalone trade attempt signatures
   */
  evaluateRevengeRisk(params = {}) {
    const breaches = [];

    // Support both parameter formats:
    // Format A: { dailyState, requestedLots, standardLots, grade, isAgainstPlan }
    // Format B: { lastTradeOutcome, currentTradeAttempt, coolDownMinutes }
    const dailyState = params.dailyState;
    const lastTradeOutcome = params.lastTradeOutcome ||
      (dailyState?.recentTrades && dailyState.recentTrades[dailyState.recentTrades.length - 1]) ||
      (dailyState?.consecutiveLosses > 0 ? { result: 'LOSS', sizeLots: params.standardLots, timestamp: Date.now() - 60000 } : null);

    const requestedLots = params.requestedLots ?? params.currentTradeAttempt?.lots ?? 1;
    const standardLots = params.standardLots ?? params.lastTradeOutcome?.sizeLots ?? 1;
    const grade = (params.grade ?? params.currentTradeAttempt?.grade ?? 'A').toUpperCase();
    const isAgainstPlan = params.isAgainstPlan ?? false;
    const coolDownMinutes = params.coolDownMinutes || this.DEFAULT_COOLDOWN_MINUTES;

    const isAfterLoss = (lastTradeOutcome && lastTradeOutcome.result === 'LOSS') || (dailyState && dailyState.consecutiveLosses > 0);

    if (!isAfterLoss) {
      return {
        isRevengeRisk: false,
        isRevengeSuspected: false,
        warningTitle: null,
        warningMessage: null,
        requiresChecklistReconfirmation: false,
        ruleBreaches: [],
        reasons: []
      };
    }

    // 1. Oversizing right after a loss (classic tilt pattern)
    if (requestedLots > standardLots) {
      breaches.push(`Position size increased from ${standardLots} lots to ${requestedLots} lots directly following a loss.`);
    }

    // 2. Chasing a lower grade setup shortly after a loss
    if (grade === 'B' || grade === 'C') {
      breaches.push(`Attempting a lower-grade (${grade}) trade directly after a losing trade.`);
    }

    // 3. Trading against plan / failing checklist directly after a loss
    if (isAgainstPlan) {
      breaches.push('Attempting an unverified setup with incomplete pre-trade checklist after a loss.');
    }

    if (breaches.length > 0) {
      return {
        isRevengeRisk: true,
        isRevengeSuspected: true,
        warningTitle: '⚠️ Revenge-Trade Pattern Detected',
        warningMessage: 'Stand aside and take a breath. Data shows higher risk of unforced errors immediately following a loss. Re-verify your plan and checklist.',
        requiresChecklistReconfirmation: true,
        ruleBreaches: breaches,
        reasons: breaches
      };
    }

    return {
      isRevengeRisk: false,
      isRevengeSuspected: false,
      warningTitle: null,
      warningMessage: null,
      requiresChecklistReconfirmation: false,
      ruleBreaches: [],
      reasons: []
    };
  },

  /**
   * Check trade count against daily limit for overtrading alerts
   */
  evaluateOvertradingRisk(params = {}, maxArg = 3) {
    const tradesToday = typeof params === 'object' ? (params.tradesCount ?? params.tradesToday ?? 0) : params;
    const maxTrades = typeof params === 'object' ? (params.maxDailyTrades ?? params.maxTrades ?? 3) : maxArg;

    const remaining = Math.max(0, maxTrades - tradesToday);

    if (tradesToday >= maxTrades) {
      return {
        isWarning: true,
        isApproachingLimit: false,
        isLimitReached: true,
        remainingTrades: 0,
        message: `Maximum daily trade limit reached (${tradesToday}/${maxTrades}). Day complete. Stop trading to preserve gains.`
      };
    }

    if (tradesToday === maxTrades - 1) {
      return {
        isWarning: true,
        isApproachingLimit: true,
        isLimitReached: false,
        remainingTrades: 1,
        message: `1 trade remaining today (${tradesToday}/${maxTrades} taken). Take only A-Grade setups with strict 1:2 R:R.`
      };
    }

    return {
      isWarning: false,
      isApproachingLimit: false,
      isLimitReached: false,
      remainingTrades: remaining,
      message: `${tradesToday}/${maxTrades} trades taken today.`
    };
  },

  checkOvertradingRisk(tradesToday = 0, maxTrades = 3) {
    return this.evaluateOvertradingRisk(tradesToday, maxTrades);
  },

  /**
   * Validate that entered size does not breach calculated risk limit
   */
  validateSizeDiscipline(enteredLots = 1, calculatedMaxLots = 1) {
    const req = typeof enteredLots === 'object' ? (enteredLots.requestedLots ?? enteredLots.enteredLots ?? 1) : enteredLots;
    const calc = typeof enteredLots === 'object' ? (enteredLots.calculatedLots ?? enteredLots.calculatedMaxLots ?? 1) : calculatedMaxLots;

    const isExceeded = req > calc;

    if (isExceeded) {
      return {
        isExceeded: true,
        isOversized: true,
        message: `Size discipline breach: Entered ${req} lot(s) exceeds calculated risk limit of ${calc} lot(s). Reduce size to protect capital.`
      };
    }

    return {
      isExceeded: false,
      isOversized: false,
      message: `Position size (${req} lots) is compliant with your risk budget.`
    };
  },

  /**
   * Institutional prohibition of averaging down
   */
  checkAveragingDownProhibition(params = {}) {
    let isBlocked = false;

    if (typeof params === 'object') {
      if (params.currentPositionPnlINR < 0 && params.isAddingToPosition) {
        isBlocked = true;
      }
      if (params.hasOpenPosition && params.proposedSignal && params.proposedSignal === params.currentPositionDirection) {
        isBlocked = true;
      }
    }

    return {
      isBlocked,
      isAveragingDown: isBlocked,
      message: isBlocked
        ? '30-Year Rule: Never average down on a losing position. Exit strictly at your initial planned stop loss.'
        : null
    };
  },

  evaluateAveragingDownRule(hasOpenPosition = false, proposedSignal = '', currentPositionDirection = '') {
    return this.checkAveragingDownProhibition({ hasOpenPosition, proposedSignal, currentPositionDirection });
  }
};
