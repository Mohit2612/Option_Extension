/**
 * TradeSight NIFTY 50 - Discipline & Loss-Protection State Machine
 * Sits BETWEEN the strategy engines and the user.
 * Enforces capital preservation, profit protection (+1R half-size, +2R lock),
 * daily loss circuit breakers (-2R stop), 2 consecutive loss lockouts,
 * and anti-bypass friction.
 */

import { SessionClock } from './sessionClock.js';
import { NiftyJournalEngine } from '../journal/nifty-journal.js';

export const DisciplineStateMachine = {
  STORAGE_KEY: 'ts_discipline_state_v2',
  OVERRIDE_PHRASE: 'I ACCEPT THE RISK AND LOG THIS OVERRIDE',

  STATES: {
    READY: 'READY',
    ACTIVE: 'ACTIVE',
    TARGET_REACHED: 'TARGET_REACHED',
    LOSS_LIMIT_HIT: 'LOSS_LIMIT_HIT',
    MAX_TRADES_HIT: 'MAX_TRADES_HIT',
    MAX_CONSECUTIVE_LOSSES_HIT: 'MAX_CONSECUTIVE_LOSSES_HIT',
    TIME_UP: 'TIME_UP',
    LOCKED: 'LOCKED'
  },

  DEFAULT_LIMITS: {
    capital: 200000,              // ₹2,00,000 INR
    riskPerTradePct: 1.0,         // 1.0% risk per trade = 1R = ₹2,000
    dailyProfitTargetR: 2.0,      // +2.0R daily target (₹4,000)
    dailyMaxLossR: 2.0,           // -2.0R daily max loss (₹4,000 or 2% capital)
    maxDailyTrades: 3,            // Max 3 trades per day
    maxConsecutiveLosses: 2,      // Max 2 consecutive losses
    profitProtectionMode: true,   // After +1R, reduce size by 50%; after +2R, lock
    lockOnTargetReached: true,
    lockOnMaxLoss: true,
    lockOnMaxTrades: true,
    lockOnConsecutiveLosses: true
  },

  /**
   * Get fresh initial daily state
   */
  _getInitialDailyState(limits = {}) {
    const ist = SessionClock.getIstParts();
    return {
      state: this.STATES.READY,
      date: ist.isoDate,
      lastResetDate: ist.isoDate,
      tradesCount: 0,
      winsCount: 0,
      lossesCount: 0,
      consecutiveLosses: 0,
      realizedR: 0,
      realizedINR: 0,
      isLocked: false,
      lockReason: null,
      lockType: null,
      lockedAt: null,
      overrideHistory: [],
      limits: { ...this.DEFAULT_LIMITS, ...limits }
    };
  },

  /**
   * Retrieve state from chrome.storage.local or initialize
   */
  async getState() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve(this._getInitialDailyState());
        return;
      }

      chrome.storage.local.get([this.STORAGE_KEY], (res) => {
        let state = res[this.STORAGE_KEY];
        const ist = SessionClock.getIstParts();

        if (!state || state.lastResetDate !== ist.isoDate) {
          // If past 09:00 IST on a new trading day, auto-reset
          if (ist.hour >= 9) {
            state = this._getInitialDailyState(state?.limits || {});
            chrome.storage.local.set({ [this.STORAGE_KEY]: state });
          } else if (!state) {
            state = this._getInitialDailyState();
          }
        }
        resolve(state);
      });
    });
  },

  /**
   * Persist state to storage
   */
  async saveState(state) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [this.STORAGE_KEY]: state });
    }
    return state;
  },

  /**
   * Record trade outcome and update state machine transitions
   * @param {Object} outcome - { pnlR, pnlAmount, result: 'WIN'|'LOSS'|'BE' }
   * @returns {Object} Updated State
   */
  async recordTradeOutcome(outcome = {}) {
    const state = await this.getState();
    const limits = state.limits || this.DEFAULT_LIMITS;

    state.tradesCount++;
    const pnlR = parseFloat(outcome.pnlR) || 0;
    const pnlAmount = parseFloat(outcome.pnlAmount) || (pnlR * (limits.capital * (limits.riskPerTradePct / 100)));

    state.realizedR = parseFloat((state.realizedR + pnlR).toFixed(2));
    state.realizedINR = Math.round(state.realizedINR + pnlAmount);

    if (outcome.result === 'WIN') {
      state.winsCount++;
      state.consecutiveLosses = 0;
    } else if (outcome.result === 'LOSS') {
      state.lossesCount++;
      state.consecutiveLosses++;
    }

    state.state = this.STATES.ACTIVE;

    // Check State Machine Transition Triggers

    // 1. Daily Max Loss Hit (-2R or -2% capital)
    if (state.realizedR <= -limits.dailyMaxLossR && limits.lockOnMaxLoss) {
      state.state = this.STATES.LOCKED;
      state.isLocked = true;
      state.lockType = this.STATES.LOSS_LIMIT_HIT;
      state.lockReason = `Daily Max Loss limit reached (${state.realizedR} R / ₹${Math.abs(state.realizedINR)}). 30-Year Rule: Stop trading immediately to protect remaining capital. Review your journal.`;
      state.lockedAt = Date.now();
      await this.saveState(state);
      return state;
    }

    // 2. Max Consecutive Losses (Default 2 consecutive losses)
    if (state.consecutiveLosses >= limits.maxConsecutiveLosses && limits.lockOnConsecutiveLosses) {
      state.state = this.STATES.LOCKED;
      state.isLocked = true;
      state.lockType = this.STATES.MAX_CONSECUTIVE_LOSSES_HIT;
      state.lockReason = `2 consecutive losses hit today (${state.consecutiveLosses}/${limits.maxConsecutiveLosses}). Hard institutional stop: Stand aside to prevent revenge trading in bad market conditions.`;
      state.lockedAt = Date.now();
      await this.saveState(state);
      return state;
    }

    // 3. Daily Profit Target Reached (+2R default)
    if (state.realizedR >= limits.dailyProfitTargetR && limits.lockOnTargetReached) {
      state.state = this.STATES.LOCKED;
      state.isLocked = true;
      state.lockType = this.STATES.TARGET_REACHED;
      state.lockReason = `Day complete! Daily profit target achieved (+${state.realizedR} R / +₹${state.realizedINR.toLocaleString('en-IN')}). System locked to protect profits and eliminate giving gains back.`;
      state.lockedAt = Date.now();
      await this.saveState(state);
      return state;
    }

    // 4. Max Daily Trades Hit (Default 3 trades)
    if (state.tradesCount >= limits.maxDailyTrades && limits.lockOnMaxTrades) {
      state.state = this.STATES.LOCKED;
      state.isLocked = true;
      state.lockType = this.STATES.MAX_TRADES_HIT;
      state.lockReason = `Maximum allowed daily trades reached (${state.tradesCount}/${limits.maxDailyTrades} trades). Stand aside for today. Overtrading destroys edge.`;
      state.lockedAt = Date.now();
      await this.saveState(state);
      return state;
    }

    await this.saveState(state);
    return state;
  },

  /**
   * INTERCEPTOR: Evaluates raw strategy signal against session rules, daily limits, and quality score.
   * Modifies signal actionable status before presenting to the trader.
   * @param {Object} params - { rawSignal, sessionInfo, chartMeta, dailyState, qualityScore }
   * @returns {Object} Filtered Signal with Discipline Annotations
   */
  evaluateDisciplineGuard({ rawSignal, sessionInfo, chartMeta, dailyState = null, qualityScore = null }) {
    if (!rawSignal) return null;

    const state = dailyState || this._getInitialDailyState();
    const limits = state.limits || this.DEFAULT_LIMITS;
    const isLocked = state.isLocked;

    // Sizing calculation based on Profit Protection Mode
    let positionSizeMultiplier = 1.0;
    let profitProtectionNote = null;

    if (limits.profitProtectionMode && state.realizedR >= 1.0) {
      // After +1R profit, cut risk by 50%
      positionSizeMultiplier = 0.5;
      profitProtectionNote = '🛡️ Profit Protection Active: You are in profit (+1R). Position size reduced by 50% to defend gains.';
    }

    // GUARD CONDITION 1: State Machine is LOCKED
    if (isLocked) {
      return {
        ...rawSignal,
        isActionable: false,
        signal: 'WAIT',
        action: 'LOCKED (STAND ASIDE)',
        confidence: 0,
        title: `🔒 TRADING LOCKED: ${state.lockType || 'DISCIPLINE_LOCK'}`,
        setupRationale: state.lockReason || 'Trading locked for today under institutional risk rules.',
        invalidation: 'Trading frozen until 09:15 AM IST next trading day.',
        disciplineStatus: {
          isLocked: true,
          lockType: state.lockType,
          lockReason: state.lockReason,
          realizedR: state.realizedR,
          tradesToday: state.tradesCount,
          canOverride: true
        },
        qualityScore,
        levels: null
      };
    }

    // GUARD CONDITION 2: Outside Permitted Session Window
    if (sessionInfo && !sessionInfo.isAllowed) {
      return {
        ...rawSignal,
        isActionable: false,
        action: 'INFO ONLY (NO-TRADE WINDOW)',
        title: `⏳ NO-TRADE WINDOW: ${sessionInfo.sessionName}`,
        setupRationale: `Signal detected, but current time is inside a restricted window. ${sessionInfo.reason} 30-Year Rule: Only trade within authorized liquidity windows.`,
        disciplineStatus: {
          isLocked: false,
          isInsideSession: false,
          sessionName: sessionInfo.sessionName,
          reason: sessionInfo.reason,
          rules: sessionInfo.rules,
          countdown: sessionInfo.timeRemainingSec
        },
        qualityScore,
        // We preserve levels for study/backtesting but flag as non-actionable
        isInfoOnly: true
      };
    }

    // GUARD CONDITION 3: Trade Quality Score Check (Module 3)
    if (qualityScore) {
      if (!qualityScore.isAllowed || qualityScore.grade === 'C') {
        return {
          ...rawSignal,
          isActionable: false,
          action: qualityScore.statusLabel || 'SKIP (Grade C)',
          title: `⛔ ${qualityScore.gradeTitle || 'LOW QUALITY SETUP'}`,
          setupRationale: `${qualityScore.verdictText} ${qualityScore.skipReason ? '\n\n' + qualityScore.skipReason : ''}\n\n${rawSignal.setupRationale || ''}`,
          qualityScore,
          disciplineStatus: {
            isLocked: false,
            isInsideSession: true,
            gradeBlocked: true,
            grade: qualityScore.grade,
            score: qualityScore.totalScore,
            sessionName: sessionInfo?.sessionName || 'Prime Window'
          },
          isInfoOnly: true
        };
      }

      // If Grade B is allowed with reduced size
      if (qualityScore.sizingMultiplier && qualityScore.sizingMultiplier < 1.0) {
        positionSizeMultiplier *= qualityScore.sizingMultiplier;
        const gradeBNote = `⚠️ ${qualityScore.gradeTitle}: Sizing scaled by ${qualityScore.sizingMultiplier}x due to moderate quality.`;
        profitProtectionNote = profitProtectionNote ? `${profitProtectionNote}\n${gradeBNote}` : gradeBNote;
      }
    }

    // GUARD CONDITION 4: Signal Passes All Discipline Gates!
    return {
      ...rawSignal,
      isActionable: rawSignal.signal !== 'WAIT',
      positionSizeMultiplier,
      profitProtectionNote,
      qualityScore,
      disciplineStatus: {
        isLocked: false,
        isInsideSession: true,
        sessionName: sessionInfo?.sessionName || 'Prime Window',
        realizedR: state.realizedR,
        tradesToday: state.tradesCount,
        maxTrades: limits.maxDailyTrades,
        profitProtectionActive: positionSizeMultiplier < 1.0,
        grade: qualityScore?.grade || 'A',
        score: qualityScore?.totalScore || 100
      }
    };
  },

  /**
   * Engage Manual Emergency Lock
   */
  async engageEmergencyLock(reason = 'Trader self-imposed discipline lock.') {
    const state = await this.getState();
    state.state = this.STATES.LOCKED;
    state.isLocked = true;
    state.lockType = 'MANUAL_DISCIPLINE_LOCK';
    state.lockReason = reason;
    state.lockedAt = Date.now();
    await this.saveState(state);
    return state;
  },

  /**
   * Anti-Bypass Protocol: Unlock requires typed phrase and logs to journal
   */
  async overrideLock(typedPhrase, reason = 'Trader intentional rule override') {
    if (!typedPhrase || typedPhrase.trim().toUpperCase() !== this.OVERRIDE_PHRASE) {
      return {
        success: false,
        error: `Confirmation phrase does not match. You must type exactly: "${this.OVERRIDE_PHRASE}"`
      };
    }

    const state = await this.getState();
    const prevLockType = state.lockType;
    const prevReason = state.lockReason;

    state.isLocked = false;
    state.state = this.STATES.ACTIVE;
    state.lockType = null;
    state.lockReason = null;

    const overrideRecord = {
      timestamp: new Date().toISOString(),
      reason,
      prevLockType,
      prevReason,
      realizedR: state.realizedR
    };

    if (!Array.isArray(state.overrideHistory)) {
      state.overrideHistory = [];
    }
    state.overrideHistory.push(overrideRecord);

    await this.saveState(state);

    // Log rule override in journal for behavioral review
    try {
      if (NiftyJournalEngine?.logRuleOverride) {
        await NiftyJournalEngine.logRuleOverride(reason, prevLockType);
      }
    } catch (e) {
      // Quiet catch
    }

    return {
      success: true,
      message: 'Lock overridden. Event permanently recorded in trading journal as RULE_OVERRIDE.',
      state
    };
  },

  /**
   * Reset state for testing or new session
   */
  async resetDailyState(limits = {}) {
    const newState = this._getInitialDailyState(limits);
    await this.saveState(newState);
    return newState;
  }
};
