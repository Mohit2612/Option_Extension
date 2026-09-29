/**
 * TradeSight NIFTY 50 - Session Manager Service
 * Enforces institutional time-window trading in Indian Standard Time (Asia/Kolkata).
 * Eliminates midday chop, restricts trading to prime liquidity hours,
 * and handles expiry day gamma window overrides.
 */

import { SessionClock } from './sessionClock.js';

export const SessionManager = {
  STORAGE_KEY: 'ts_session_manager_config',

  PROFILES: {
    MORNING_ONLY: {
      id: 'MORNING_ONLY',
      name: '🌅 Morning Only (Stop by 11:30)',
      description: 'Trades only Prime Morning Session. Stops for the day before midday chop.',
      sessions: {
        prime: { enabled: true, start: '09:20', end: '11:30' },
        midday: { enabled: false, start: '11:30', end: '13:30' },
        afternoon: { enabled: false, start: '13:40', end: '14:45' }
      },
      hardStopTime: '11:30'
    },
    MORNING_AFTERNOON: {
      id: 'MORNING_AFTERNOON',
      name: '⚡ Morning + Afternoon (Default)',
      description: 'Trades Prime Morning & Post-Lunch Expansion. Strictly avoids 11:30-13:30 chop zone.',
      sessions: {
        prime: { enabled: true, start: '09:20', end: '11:30' },
        midday: { enabled: false, start: '11:30', end: '13:30' },
        afternoon: { enabled: true, start: '13:40', end: '14:45' }
      },
      hardStopTime: '14:45'
    },
    CUSTOM: {
      id: 'CUSTOM',
      name: '⚙️ Custom Schedule',
      description: 'Trader-configured session timings and midday chop rules.',
      sessions: {
        prime: { enabled: true, start: '09:20', end: '11:30' },
        midday: { enabled: false, start: '11:30', end: '13:30' },
        afternoon: { enabled: true, start: '13:40', end: '14:45' }
      },
      hardStopTime: '15:15'
    }
  },

  DEFAULT_CONFIG: {
    activeProfile: 'MORNING_AFTERNOON',
    allowMiddayHighGradeBreakouts: false,
    expiryOverrideEnabled: true, // Allow Thursday Hero-Zero gamma 13:45-14:45
    customSessions: {
      prime: { enabled: true, start: '09:20', end: '11:30' },
      midday: { enabled: false, start: '11:30', end: '13:30' },
      afternoon: { enabled: true, start: '13:40', end: '14:45' }
    }
  },

  /**
   * Parse "HH:MM" string into minutes from midnight
   */
  _timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':').map((n) => parseInt(n, 10));
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  },

  /**
   * Evaluate whether current time is within an authorized trading window
   * @param {Date|number|null} timestamp - Current timestamp or candle time
   * @param {Object} userConfig - Configuration overrides
   * @param {boolean} isExpiryDay - Whether today is confirmed Thursday expiry
   * @returns {Object} Comprehensive session evaluation
   */
  evaluateSession(timestamp = null, userConfig = {}, isExpiryDay = false) {
    const config = { ...this.DEFAULT_CONFIG, ...userConfig };
    const ist = SessionClock.getIstParts(timestamp);
    const totalMins = ist.totalMinutes;

    const profileKey = config.activeProfile || 'MORNING_AFTERNOON';
    const profile = this.PROFILES[profileKey] || this.PROFILES.MORNING_AFTERNOON;
    const sessions = profileKey === 'CUSTOM' ? (config.customSessions || profile.sessions) : profile.sessions;

    const primeStart = this._timeToMinutes(sessions.prime.start);
    const primeEnd = this._timeToMinutes(sessions.prime.end);
    const middayStart = this._timeToMinutes(sessions.midday.start);
    const middayEnd = this._timeToMinutes(sessions.midday.end);
    const afternoonStart = this._timeToMinutes(sessions.afternoon.start);
    const afternoonEnd = this._timeToMinutes(sessions.afternoon.end);
    const hardStopMins = this._timeToMinutes(profile.hardStopTime || '15:15');

    // 1. Market Hours Boundary Check (09:15 to 15:30 IST)
    const marketOpen = 9 * 60 + 15;
    const marketClose = 15 * 60 + 30;

    if (totalMins < marketOpen) {
      return {
        isAllowed: false,
        status: 'PRE_MARKET',
        sessionName: 'Pre-Market / Closed',
        badgeClass: 'badge-inactive',
        reason: 'Market pre-open. Trading begins at 09:15 IST (Prime window at 09:20).',
        rules: ['Wait for 09:15 opening print', 'Watch GIFT Nifty gap', 'No early trades'],
        timeRemainingSec: (marketOpen - totalMins) * 60 - ist.second,
        nextSessionText: 'Opens at 09:15 IST'
      };
    }

    if (totalMins >= marketClose) {
      return {
        isAllowed: false,
        status: 'POST_MARKET',
        sessionName: 'Market Closed',
        badgeClass: 'badge-inactive',
        reason: 'NSE regular session concluded (15:30 IST). Review journal entries.',
        rules: ['All intraday positions closed', 'Log daily lessons', 'Prepare for next session'],
        timeRemainingSec: 0,
        nextSessionText: 'Closed until next session'
      };
    }

    // 2. First 5-minute opening noise filter (09:15 to 09:20)
    if (totalMins >= marketOpen && totalMins < primeStart) {
      return {
        isAllowed: false,
        status: 'OPEN_NOISE_BUFFER',
        sessionName: 'Opening Volatility Buffer',
        badgeClass: 'badge-warning',
        reason: '09:15 - 09:20 Opening Noise Buffer. Institutional rule: Never trade the opening 5 minutes.',
        rules: ['Institutional order flow settlement', 'Avoid initial whipsaws', 'Wait for 09:20 opening range'],
        timeRemainingSec: (primeStart - totalMins) * 60 - ist.second,
        nextSessionText: 'Prime Morning Session opens at 09:20 IST'
      };
    }

    // 3. Expiry Day Override (13:45 - 14:45 Hero-Zero)
    if (isExpiryDay && config.expiryOverrideEnabled && totalMins >= 13 * 60 + 45 && totalMins <= 14 * 60 + 45) {
      return {
        isAllowed: true,
        status: 'EXPIRY_HERO_ZERO_WINDOW',
        sessionName: 'Expiry Hero-Zero Gamma Window',
        badgeClass: 'badge-expiry',
        reason: 'Active Thursday Expiry gamma surge window (13:45 - 14:45 IST). High-payoff setups enabled.',
        rules: ['OTM strikes ₹15-₹35 only', 'Pre-accept 100% premium loss', '50% stop loss', 'Max 2 attempts', 'Exit by 15:15'],
        timeRemainingSec: ((14 * 60 + 45) - totalMins) * 60 - ist.second,
        nextSessionText: 'Hero-Zero window closes at 14:45 IST'
      };
    }

    // 4. Hard Stop Time for active profile (e.g. Morning Only stops at 11:30)
    if (totalMins >= hardStopMins && !isExpiryDay) {
      return {
        isAllowed: false,
        status: 'TIME_UP_FOR_PROFILE',
        sessionName: `Day Concluded (${profile.name})`,
        badgeClass: 'badge-locked',
        reason: `Target trading hours reached for '${profile.name}' (${profile.hardStopTime} IST). Stop for the day to lock in capital.`,
        rules: ['Trading window closed for today', 'Protect morning gains', 'Do not give profits back'],
        timeRemainingSec: 0,
        nextSessionText: 'Closed for the day'
      };
    }

    // 5. Session 1: Prime Morning Window (09:20 - 11:30)
    if (totalMins >= primeStart && totalMins < primeEnd) {
      if (!sessions.prime.enabled) {
        return {
          isAllowed: false,
          status: 'SESSION_DISABLED',
          sessionName: 'Prime Morning (Disabled in Config)',
          badgeClass: 'badge-inactive',
          reason: 'Prime morning window is toggled off in settings.',
          rules: ['Enable session in settings to view active signals'],
          timeRemainingSec: (primeEnd - totalMins) * 60 - ist.second,
          nextSessionText: `Next window at ${sessions.afternoon.start} IST`
        };
      }

      return {
        isAllowed: true,
        status: 'ACTIVE_SESSION',
        sessionName: 'Session 1: Prime Morning Window',
        badgeClass: 'badge-prime',
        reason: 'Prime institutional trend & ORB window. High liquidity & clean directional moves.',
        rules: [
          '09:30 ORB Breakout setups',
          'VWAP & 1-Month S/R alignment',
          'Risk:Reward ≥ 1:2.0 mandatory',
          'Full position sizing permitted'
        ],
        timeRemainingSec: (primeEnd - totalMins) * 60 - ist.second,
        nextSessionText: `Prime session ends at ${sessions.prime.end} IST`
      };
    }

    // 6. Session 2: Midday Chop Zone (11:30 - 13:30)
    if (totalMins >= middayStart && totalMins < middayEnd) {
      if (!sessions.midday.enabled) {
        return {
          isAllowed: false,
          status: 'CHOP_ZONE_BLOCKED',
          sessionName: 'Midday Chop Zone (11:30 - 13:30)',
          badgeClass: 'badge-chop',
          reason: '30-Year Rule: 11:30 - 13:30 is the low-volume chop zone. Retail traders give back morning gains here. Stand aside.',
          rules: [
            'No mid-range trades',
            'Avoid range-bound false breakouts',
            'European morning volume arrives at 13:40 IST'
          ],
          timeRemainingSec: (middayEnd - totalMins) * 60 - ist.second,
          nextSessionText: `Afternoon session opens at ${sessions.afternoon.start} IST`
        };
      }

      // If user explicitly enabled midday
      return {
        isAllowed: config.allowMiddayHighGradeBreakouts,
        status: config.allowMiddayHighGradeBreakouts ? 'MIDDAY_STRICT' : 'CHOP_ZONE_BLOCKED',
        sessionName: 'Session 2: Midday (Strict Mode)',
        badgeClass: 'badge-warning',
        reason: config.allowMiddayHighGradeBreakouts
          ? 'Midday enabled: ONLY A-grade breakouts from major 1-Month S/R allowed. Reduce position size by 50%.'
          : 'Midday trading blocked to eliminate chop losses.',
        rules: [
          'High-grade setups only',
          '50% reduced position sizing',
          'Tight stop losses'
        ],
        timeRemainingSec: (middayEnd - totalMins) * 60 - ist.second,
        nextSessionText: `Afternoon expansion at ${sessions.afternoon.start} IST`
      };
    }

    // 7. Session 3: Afternoon Expansion Window (13:40 - 14:45)
    if (totalMins >= afternoonStart && totalMins < afternoonEnd) {
      if (!sessions.afternoon.enabled) {
        return {
          isAllowed: false,
          status: 'SESSION_DISABLED',
          sessionName: 'Afternoon Session (Disabled)',
          badgeClass: 'badge-inactive',
          reason: 'Afternoon session is disabled in your profile.',
          rules: ['Profile stops before afternoon'],
          timeRemainingSec: (afternoonEnd - totalMins) * 60 - ist.second,
          nextSessionText: 'Session concluded'
        };
      }

      return {
        isAllowed: true,
        status: 'ACTIVE_SESSION',
        sessionName: 'Session 3: Afternoon Expansion Window',
        badgeClass: 'badge-afternoon',
        reason: 'Post-lunch volume expansion & 1:40 PM compression breakout window.',
        rules: [
          '1:40 PM Compression Breakout (NR7)',
          'European crossover momentum',
          '21 EMA trailing stop',
          'Hard exit by 15:10'
        ],
        timeRemainingSec: (afternoonEnd - totalMins) * 60 - ist.second,
        nextSessionText: `Closes at ${sessions.afternoon.end} IST`
      };
    }

    // 8. Square-off Phase (14:45 - 15:30)
    if (totalMins >= afternoonEnd && totalMins < marketClose) {
      return {
        isAllowed: false,
        status: 'SQUARE_OFF_ONLY',
        sessionName: 'Intraday Square-off Window',
        badgeClass: 'badge-warning',
        reason: 'Late session: Intraday brokers begin automatic square-offs. New entries strictly prohibited.',
        rules: ['Square off existing open trades', 'Do not initiate fresh positions', 'Log journal stats'],
        timeRemainingSec: (marketClose - totalMins) * 60 - ist.second,
        nextSessionText: 'Market closing at 15:30 IST'
      };
    }

    // Fallback No-Trade Window
    return {
      isAllowed: false,
      status: 'NO_TRADE_WINDOW',
      sessionName: 'No-Trade Window',
      badgeClass: 'badge-inactive',
      reason: 'Current time is outside allowed trading sessions.',
      rules: ['Wait for active session window'],
      timeRemainingSec: 0,
      nextSessionText: 'Stand by for next session'
    };
  },

  /**
   * Format countdown seconds into MM:SS or HH:MM:SS
   */
  formatCountdown(seconds) {
    if (isNaN(seconds) || seconds <= 0) return '00m 00s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
    }
    return `${pad(mins)}m ${pad(secs)}s`;
  }
};
