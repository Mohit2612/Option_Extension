/**
 * Test Suite: Discipline and Loss-Protection Layer
 * Tests Module 1 (Session Manager: IST time windows, chop avoidance, expiry overrides)
 * and Module 2 (Daily Goal & Stop Rules: State machine, +2R target lock, -2R loss limit lock,
 * 2 consecutive loss lockout, max 3 trades lockout, profit protection 0.5x sizing, anti-bypass friction).
 */

import { SessionManager } from '../services/sessionManager.js';
import { DisciplineStateMachine } from '../services/disciplineStateMachine.js';

// Setup Mock chrome.storage.local for Node.js test environment
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        if (!keys) return cb(mockStorage);
        if (typeof keys === 'string') return cb({ [keys]: mockStorage[keys] });
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach(k => { res[k] = mockStorage[k]; });
          return cb(res);
        }
        cb(mockStorage);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
      }
    }
  }
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}: Passed`);
    passed++;
  } else {
    console.error(`✗ ${message}: FAILED`);
    failed++;
  }
}

console.log('\n--- STARTING DISCIPLINE & LOSS-PROTECTION LAYER TESTS ---');

// ================= MODULE 1: SESSION MANAGER TESTS =================
console.log('\n[Module 1: Session Manager (Time-Window Trading)]');

// Helper to construct IST dates
// IST = UTC + 5:30. To test 09:30 IST, UTC is 04:00.
function createIstDate(hours, minutes, seconds = 0, isThursday = false) {
  // 2026-10-01 is Thursday, 2026-10-02 is Friday
  const day = isThursday ? '2026-10-01' : '2026-10-02';
  // Adjust for UTC by subtracting 5 hours and 30 minutes
  let utcHour = hours - 5;
  let utcMin = minutes - 30;
  if (utcMin < 0) {
    utcMin += 60;
    utcHour -= 1;
  }
  const iso = `${day}T${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}:${String(seconds).padStart(2, '0')}Z`;
  return new Date(iso);
}

// 1. Pre-Market Check (08:30 IST)
{
  const d = createIstDate(8, 30);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === false, 'Pre-market 08:30 IST must not allow trading');
  assert(evalRes.status === 'PRE_MARKET', 'Status should be PRE_MARKET');
}

// 2. Opening Noise Buffer (09:16 IST)
{
  const d = createIstDate(9, 16);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === false, 'Opening noise buffer 09:16 IST must be blocked');
  assert(evalRes.status === 'OPEN_NOISE_BUFFER', 'Status should be OPEN_NOISE_BUFFER');
}

// 3. Session 1 (Prime Morning Window: 09:20 - 11:30 IST)
{
  const d = createIstDate(9, 35);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === true, 'Prime morning 09:35 IST must be allowed');
  assert(evalRes.status === 'ACTIVE_SESSION', 'Status should be ACTIVE_SESSION');
  assert(evalRes.sessionName.includes('Prime'), 'Session name must indicate Prime Window');
}

// 4. Session 2 (Midday Chop Zone: 11:30 - 13:30 IST) - Default OFF
{
  const d = createIstDate(12, 15);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === false, 'Midday 12:15 IST must be blocked by default (Chop Zone)');
  assert(evalRes.status === 'CHOP_ZONE_BLOCKED', 'Status should be CHOP_ZONE_BLOCKED');
}

// 5. Session 3 (Afternoon Window: 13:40 - 14:45 IST)
{
  const d = createIstDate(14, 0);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === true, 'Afternoon 14:00 IST must be allowed in default Morning+Afternoon profile');
  assert(evalRes.sessionName.includes('Afternoon'), 'Session name must indicate Afternoon window');
}

// 6. Post-Market Check (15:35 IST)
{
  const d = createIstDate(15, 35);
  const evalRes = SessionManager.evaluateSession(d);
  assert(evalRes.isAllowed === false, 'Post-market 15:35 IST must be blocked');
  assert(evalRes.status === 'POST_MARKET', 'Status should be POST_MARKET');
}

// 7. Profile: "Morning Only" (Stop by 11:30 IST)
{
  const d = createIstDate(14, 0);
  const evalRes = SessionManager.evaluateSession(d, { activeProfile: 'MORNING_ONLY' });
  assert(evalRes.isAllowed === false, 'Morning Only profile must block afternoon trades at 14:00 IST');
  assert(evalRes.status === 'TIME_UP_FOR_PROFILE', 'Status should indicate TIME_UP_FOR_PROFILE');
}

// 8. Expiry-Day Override (Thursday 13:45 - 14:45 IST)
{
  const dThu = createIstDate(14, 15, 0, true); // Thursday 14:15 IST
  const evalRes = SessionManager.evaluateSession(dThu, {
    activeProfile: 'MORNING_AFTERNOON',
    expiryOverrideEnabled: true
  }, true);
  assert(evalRes.isAllowed === true, 'Thursday expiry 14:15 IST must be allowed for Hero-Zero');
  assert(evalRes.status === 'EXPIRY_HERO_ZERO_WINDOW', 'Status should be EXPIRY_HERO_ZERO_WINDOW');
}

// 9. Live Countdown Formatter
{
  const formatted = SessionManager.formatCountdown(125);
  assert(formatted === '02m 05s', `formatCountdown(125) should return "02m 05s", got ${formatted}`);
  const hourFormatted = SessionManager.formatCountdown(3665);
  assert(hourFormatted === '01h 01m 05s', `formatCountdown(3665) should return "01h 01m 05s", got ${hourFormatted}`);
}


// ================= MODULE 2: DAILY GOAL & STOP RULES (STATE MACHINE) =================
console.log('\n[Module 2: Daily Goal and Stop Rules (State Machine)]');

// Reset state
await DisciplineStateMachine.resetDailyState({
  capital: 200000,
  dailyProfitTargetR: 2.0,
  dailyMaxLossR: 2.0,
  maxDailyTrades: 3,
  maxConsecutiveLosses: 2,
  profitProtectionMode: true
});

// 1. Initial State Check
{
  const state = await DisciplineStateMachine.getState();
  assert(state.state === 'READY', `Initial state must be READY, got ${state.state}`);
  assert(state.realizedR === 0, 'Initial realized R must be 0');
  assert(state.isLocked === false, 'Initial state must not be locked');
}

// 2. Active Transition & Profit Protection Mode (+1.0R Trigger)
{
  // Record +1.0R trade
  const state = await DisciplineStateMachine.recordTradeOutcome({
    pnlR: 1.0,
    pnlAmount: 2000,
    result: 'WIN'
  });

  assert(state.state === 'ACTIVE', `State after 1 trade must be ACTIVE, got ${state.state}`);
  assert(state.realizedR === 1.0, `Realized R should be 1.0, got ${state.realizedR}`);
  assert(state.isLocked === false, 'Should not be locked after +1R');

  // Guard test: With realizedR >= 1.0, position sizing multiplier must be 0.5 (50% reduction)
  const guarded = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal: { signal: 'BUY', confidence: 85, levels: { entryPrice: 24100 } },
    sessionInfo: { isAllowed: true, sessionName: 'Prime Morning Window' },
    dailyState: state
  });

  assert(guarded.isActionable === true, 'Signal must be actionable');
  assert(guarded.positionSizeMultiplier === 0.5, `Profit protection must cut size to 0.5x, got ${guarded.positionSizeMultiplier}`);
  assert(guarded.profitProtectionNote !== null, 'Profit protection note must be present');
}

// 3. Daily Profit Target Reached (+2.0R Total -> LOCKED)
{
  // Record another +1.0R trade (Total +2.0R)
  const state = await DisciplineStateMachine.recordTradeOutcome({
    pnlR: 1.0,
    pnlAmount: 2000,
    result: 'WIN'
  });

  assert(state.state === 'LOCKED', `State must transition to LOCKED upon +2.0R target, got ${state.state}`);
  assert(state.lockType === 'TARGET_REACHED', `lockType should be TARGET_REACHED, got ${state.lockType}`);
  assert(state.isLocked === true, 'isLocked must be true');

  // Guard test: While LOCKED, all signals must be suppressed
  const guarded = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal: { signal: 'BUY', confidence: 90, levels: { entryPrice: 24150 } },
    sessionInfo: { isAllowed: true, sessionName: 'Prime Morning Window' },
    dailyState: state
  });

  assert(guarded.isActionable === false, 'Signal must NOT be actionable when LOCKED');
  assert(guarded.signal === 'WAIT', 'Signal direction must be forced to WAIT');
  assert(guarded.levels === null, 'Trade levels must be wiped out to prevent execution');
  assert(guarded.title.includes('LOCKED'), 'Signal title must announce LOCKED state');
}

// 4. Daily Max Loss Limit Hit (-2.0R -> LOCKED)
{
  await DisciplineStateMachine.resetDailyState();
  // Record 2 losses of -1.0R
  await DisciplineStateMachine.recordTradeOutcome({ pnlR: -1.0, pnlAmount: -2000, result: 'LOSS' });
  const state = await DisciplineStateMachine.recordTradeOutcome({ pnlR: -1.0, pnlAmount: -2000, result: 'LOSS' });

  assert(state.state === 'LOCKED', `State must transition to LOCKED upon -2.0R loss limit, got ${state.state}`);
  assert(state.isLocked === true, 'isLocked must be true');
  assert(state.realizedR === -2.0, `Realized R should be -2.0, got ${state.realizedR}`);
}

// 5. Max Consecutive Losses Hit (2 Consecutive Losses -> LOCKED)
{
  await DisciplineStateMachine.resetDailyState();
  // 1 loss
  await DisciplineStateMachine.recordTradeOutcome({ pnlR: -0.5, pnlAmount: -1000, result: 'LOSS' });
  // 2nd consecutive loss
  const state = await DisciplineStateMachine.recordTradeOutcome({ pnlR: -0.5, pnlAmount: -1000, result: 'LOSS' });

  assert(state.state === 'LOCKED', '2 consecutive losses must trigger LOCKED state');
  assert(state.consecutiveLosses === 2, `consecutiveLosses must be 2, got ${state.consecutiveLosses}`);
  assert(state.isLocked === true, 'isLocked must be true');
}

// 6. Max Daily Trades Hit (3 Trades -> LOCKED)
{
  await DisciplineStateMachine.resetDailyState();
  await DisciplineStateMachine.recordTradeOutcome({ pnlR: 0.2, pnlAmount: 400, result: 'WIN' });
  await DisciplineStateMachine.recordTradeOutcome({ pnlR: -0.2, pnlAmount: -400, result: 'LOSS' });
  const state = await DisciplineStateMachine.recordTradeOutcome({ pnlR: 0.1, pnlAmount: 200, result: 'WIN' });

  assert(state.tradesCount === 3, 'tradesCount must be 3');
  assert(state.state === 'LOCKED', 'Reaching max 3 trades must trigger LOCKED state');
  assert(state.lockType === 'MAX_TRADES_HIT', `lockType should be MAX_TRADES_HIT, got ${state.lockType}`);
}

// 7. Non-Session Guard: Outside Allowed Session -> Marked "INFO ONLY"
{
  await DisciplineStateMachine.resetDailyState();
  const state = await DisciplineStateMachine.getState();

  const guarded = DisciplineStateMachine.evaluateDisciplineGuard({
    rawSignal: { signal: 'BUY', confidence: 80, levels: { entryPrice: 24100 } },
    sessionInfo: { isAllowed: false, sessionName: 'Midday Chop Restriction', reason: 'Chop zone avoidance.' },
    dailyState: state
  });

  assert(guarded.isActionable === false, 'Signal outside session must NOT be actionable');
  assert(guarded.action === 'INFO ONLY (NO-TRADE WINDOW)', 'Action must be INFO ONLY (NO-TRADE WINDOW)');
  assert(guarded.isInfoOnly === true, 'isInfoOnly flag must be set to true');
}

// 8. Anti-Bypass Lock Override Protocol
{
  // Engage emergency lock
  await DisciplineStateMachine.engageEmergencyLock('Behavioral safety lockout test');
  let state = await DisciplineStateMachine.getState();
  assert(state.isLocked === true, 'Emergency lock must engage');

  // Attempt invalid bypass phrase
  const invalidAttempt = await DisciplineStateMachine.overrideLock('please unlock me');
  assert(invalidAttempt.success === false, 'Invalid override phrase must be rejected');
  assert(invalidAttempt.error.includes('Confirmation phrase does not match'), 'Error must specify phrase mismatch');

  // Submit EXACT institutional confirmation phrase
  const validAttempt = await DisciplineStateMachine.overrideLock('I ACCEPT THE RISK AND LOG THIS OVERRIDE', 'Testing audit trail');
  assert(validAttempt.success === true, 'Exact phrase must successfully unlock');
  assert(validAttempt.state.isLocked === false, 'State should no longer be locked');
  assert(validAttempt.state.overrideHistory.length === 1, 'Override event must be recorded in overrideHistory audit trail');
}

console.log(`\n========================================`);
console.log(`DISCIPLINE LAYER TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
