/**
 * TradeSight NIFTY 50 - Behavior Protection, Checklist, Position Sizer & Analytics Test Suite
 * Validates Modules 5, 6, 7, 8:
 * - Position sizing mathematical floor rounding & 1-lot affordability gating
 * - BehaviorGuard cool-down timers, revenge trade detection, overtrading alerts & no-averaging-down
 * - Pre-Trade Checklist 8-point gate enforcement
 * - NoTradeFilters NSE holiday calendar & 30-min event buffer
 * - JournalAnalytics rule comparison, 30-trade minimum threshold, weekly reports & CSV export
 */

import { PositionSizer } from '../risk/positionSizer.js';
import { BehaviorGuard } from '../discipline/behaviorGuard.js';
import { NoTradeFilters } from '../discipline/noTradeFilters.js';
import { PreTradeChecklist } from '../discipline/checklist.js';
import { JournalAnalytics } from '../journal/analytics.js';

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

console.log('\n--- STARTING MODULE 7: POSITION SIZING AND RISK CALCULATOR TESTS ---');

// Test 1: Mathematical floor rounding
const sizerTest1 = PositionSizer.calculateSizing({
  capitalINR: 200000,
  riskPct: 1.0, // Risk budget = ₹2,000
  entryPrice: 24000,
  stopLoss: 23970, // 30 points risk per share
  lotSize: 25,     // 30 * 25 = ₹750 risk per lot
  isOption: false,
  positionSizeMultiplier: 1.0
});

// ₹2000 / ₹750 = 2.666... Must floor strictly to 2 lots (never round up to 3)
assert(sizerTest1.lots === 2, `Position size must strictly floor to 2 lots, got ${sizerTest1.lots}`);
assert(sizerTest1.quantity === 50, `Quantity must be 50, got ${sizerTest1.quantity}`);
assert(sizerTest1.actualRiskINR === 1500, `Actual risk must be ₹1500, got ₹${sizerTest1.actualRiskINR}`);
assert(sizerTest1.actualRiskPct <= 1.0, `Actual risk % (${sizerTest1.actualRiskPct}%) must not exceed 1.0%`);
assert(!sizerTest1.isRiskTooHigh, 'isRiskTooHigh should be false when affordable');

// Test 2: Gating when even 1 minimum lot exceeds risk limit
const sizerTest2 = PositionSizer.calculateSizing({
  capitalINR: 50000,
  riskPct: 1.0, // Risk budget = ₹500
  entryPrice: 24000,
  stopLoss: 23950, // 50 points risk
  lotSize: 25,     // 50 * 25 = ₹1250 loss for 1 lot
  isOption: false,
  positionSizeMultiplier: 1.0
});

assert(sizerTest2.lots === 0, `Lots must be 0 when 1 lot exceeds budget, got ${sizerTest2.lots}`);
assert(sizerTest2.isRiskTooHigh === true, 'isRiskTooHigh must be true');
assert(sizerTest2.recommendation.toLowerCase().includes('skip: risk too high for your capital'), 'Recommendation must state Skip: risk too high for your capital');

// Test 3: Compound Multiplier (Grade B 0.75x & Profit Protection 0.5x = 0.375x)
const sizerTest3 = PositionSizer.calculateSizing({
  capitalINR: 500000,
  riskPct: 1.0, // ₹5000 budget
  entryPrice: 24000,
  stopLoss: 23980, // 20 points
  lotSize: 25,     // ₹500 / lot -> 10 standard lots
  isOption: false,
  positionSizeMultiplier: 0.375 // 10 * 0.375 = 3.75 -> strictly 3 lots
});

assert(sizerTest3.lots === 3, `Compound multiplier must floor to 3 lots, got ${sizerTest3.lots}`);

// Test 4: Presets
const presetBalanced = PositionSizer.getPreset('BALANCED');
assert(presetBalanced.riskPct === 1.0, 'BALANCED preset riskPct must be 1.0%');
assert(presetBalanced.maxDailyTrades === 3, 'BALANCED maxDailyTrades must be 3');

const presetConservative = PositionSizer.getPreset('CONSERVATIVE');
assert(presetConservative.riskPct === 0.5, 'CONSERVATIVE preset riskPct must be 0.5%');
assert(presetConservative.maxDailyTrades === 2, 'CONSERVATIVE maxDailyTrades must be 2');


console.log('\n--- STARTING MODULE 5: BEHAVIOR PROTECTION (ANTI-TILT) TESTS ---');

// Test 5: Cool-down timer active
const nowTime = Date.now();
const coolDownExpiry = nowTime + (15 * 60 * 1000); // 15 mins remaining
const cdActive = BehaviorGuard.evaluateCoolDown(coolDownExpiry, nowTime);
assert(cdActive.isActive === true, 'Cool-down must be active when expiry is in future');
assert(cdActive.remainingSeconds > 0, 'Remaining seconds must be > 0');
assert(cdActive.formattedRemaining.includes('15m'), `Formatted remaining must show 15m, got ${cdActive.formattedRemaining}`);

// Test 6: Cool-down timer expired
const cdExpired = BehaviorGuard.evaluateCoolDown(nowTime - 5000, nowTime);
assert(cdExpired.isActive === false, 'Cool-down must be inactive when time has passed');
assert(cdExpired.formattedRemaining === '00m 00s', 'Expired formatted time must be 00m 00s');

// Test 7: Revenge trade detection (sizing hike right after a loss)
const mockDailyLossState = {
  isLocked: false,
  realizedR: -1.0,
  tradesCount: 1,
  consecutiveLosses: 1,
  recentTrades: [{ result: 'LOSS', r: -1.0 }]
};

const revengeSizing = BehaviorGuard.evaluateRevengeRisk({
  dailyState: mockDailyLossState,
  requestedLots: 4,
  standardLots: 2, // Size hiked 2x after loss!
  grade: 'A',
  isAgainstPlan: false
});

assert(revengeSizing.isRevengeRisk === true, 'Size hike after loss must trigger revenge risk');
assert(revengeSizing.reasons.some(r => r.toLowerCase().includes('size increased')), 'Reason must cite size increase');
assert(revengeSizing.warningMessage.includes('Stand aside'), 'Warning must use calm protective phrasing');

// Test 8: Revenge trade detection (taking lower Grade B/C right after a loss)
const revengeGrade = BehaviorGuard.evaluateRevengeRisk({
  dailyState: mockDailyLossState,
  requestedLots: 2,
  standardLots: 2,
  grade: 'C', // Lower grade taken after loss!
  isAgainstPlan: false
});

assert(revengeGrade.isRevengeRisk === true, 'Lower grade trade right after loss must trigger revenge alert');

// Test 9: Overtrading alert approaching limit
const overtradeCheck = BehaviorGuard.evaluateOvertradingRisk({
  tradesCount: 2,
  maxDailyTrades: 3
});
assert(overtradeCheck.isApproachingLimit === true, '2/3 trades must flag approaching trade limit');
assert(overtradeCheck.remainingTrades === 1, 'Remaining trades must be 1');

// Test 10: Size discipline validator
const sizeDiscipline = BehaviorGuard.validateSizeDiscipline({
  requestedLots: 5,
  calculatedLots: 3
});
assert(sizeDiscipline.isExceeded === true, 'Requested lots 5 > calculated 3 must fail size discipline');
assert(sizeDiscipline.message.includes('exceeds calculated'), 'Message must warn size exceeds calculated risk limit');

// Test 11: Prohibition of averaging down
const avgDownProhibition = BehaviorGuard.checkAveragingDownProhibition({
  currentPositionPnlINR: -2500,
  isAddingToPosition: true
});
assert(avgDownProhibition.isBlocked === true, 'Averaging down on losing position must be strictly blocked');
assert(avgDownProhibition.message.includes('Never average down on a losing position'), 'Message must prohibit averaging down');


console.log('\n--- STARTING MODULE 6: PRE-TRADE CHECKLIST (8-POINT MANDATORY GATE) TESTS ---');

// Test 12: Checklist all 8 passing
const passChecklist = PreTradeChecklist.evaluateChecklist({
  sessionInfo: { isAllowed: true, sessionName: 'Prime Morning' },
  regime: { label: 'Trending Range Alignment' },
  qualityScore: { grade: 'A', score: 88 },
  entryPrice: 24000,
  stopLoss: 23980,
  riskRewardRatio: 2.2, // >= 1:2
  sizingResult: { isRiskTooHigh: false, lots: 2 },
  eventRisk: { isEventBuffer: false },
  dailyDisciplineState: { isLocked: false, tradesCount: 1, limits: { maxDailyTrades: 3 } },
  isCalmConfirmed: true
});

assert(passChecklist.allPassed === true, 'All 8 criteria passing must yield allPassed: true');
assert(passChecklist.passedCount === 8, 'Passed count must be 8');
assert(passChecklist.totalCount === 8, 'Total count must be 8');
assert(passChecklist.summaryMessage.includes('All pre-trade checklist criteria verified'), 'Summary must confirm ready status');

// Test 13: Checklist failing manual composure check (#8)
const failManualComposure = PreTradeChecklist.evaluateChecklist({
  sessionInfo: { isAllowed: true, sessionName: 'Prime Morning' },
  regime: { label: 'Trending Range Alignment' },
  qualityScore: { grade: 'A', score: 88 },
  entryPrice: 24000,
  stopLoss: 23980,
  riskRewardRatio: 2.2,
  sizingResult: { isRiskTooHigh: false, lots: 2 },
  eventRisk: { isEventBuffer: false },
  dailyDisciplineState: { isLocked: false, tradesCount: 1, limits: { maxDailyTrades: 3 } },
  isCalmConfirmed: false // Manual tick unchecked!
});

assert(failManualComposure.allPassed === false, 'Checklist must NOT pass if trader is not calm & checked');
assert(failManualComposure.passedCount === 7, 'Passed count should be 7/8');
assert(failManualComposure.items.find(i => i.id === 'calm_and_plan').isPassed === false, 'Composure item must be marked failed');

// Test 14: Checklist failing Risk:Reward (< 1:2)
const failRR = PreTradeChecklist.evaluateChecklist({
  sessionInfo: { isAllowed: true, sessionName: 'Prime Morning' },
  regime: { label: 'Trending Range Alignment' },
  qualityScore: { grade: 'A', score: 88 },
  entryPrice: 24000,
  stopLoss: 23980,
  riskRewardRatio: 1.5, // Less than minimum 1:2
  sizingResult: { isRiskTooHigh: false, lots: 2 },
  eventRisk: { isEventBuffer: false },
  dailyDisciplineState: { isLocked: false, tradesCount: 1, limits: { maxDailyTrades: 3 } },
  isCalmConfirmed: true
});

assert(failRR.allPassed === false, 'R:R < 1:2 must fail checklist');
assert(failRR.items.find(i => i.id === 'sl_and_rr').isPassed === false, 'R:R item must fail');


console.log('\n--- STARTING NO-TRADE FILTERS & NSE HOLIDAY CALENDAR TESTS ---');

// Test 15: NSE Holiday Calendar (e.g. 2026-01-26 Republic Day)
const republicDay2026 = new Date('2026-01-26T10:00:00+05:30');
const isRepDayTrading = NoTradeFilters.isNSETradingDay(republicDay2026);
assert(isRepDayTrading === false, 'Republic Day 2026 must be recognized as non-trading holiday');

const holInfo = NoTradeFilters.getNSEHolidayInfo(republicDay2026);
assert(holInfo.isHoliday === true, 'getNSEHolidayInfo must flag holiday');
assert(holInfo.holidayName === 'Republic Day', `Holiday name must be Republic Day, got ${holInfo.holidayName}`);

// Test 16: Weekend Filter (Sunday)
const sundayDate = new Date('2026-02-01T10:00:00+05:30'); // 2026-02-01 is Sunday
assert(NoTradeFilters.isNSETradingDay(sundayDate) === false, 'Sunday must be blocked as weekend');

// Test 17: Event Proximity Buffer (30 mins before/after macro event)
const budgetTime = new Date('2026-02-01T11:15:00+05:30'); // During Union Budget
const eventCheck = NoTradeFilters.isInsideEventBuffer(budgetTime);
assert(eventCheck.isEventBuffer === true, '11:15 on Budget Day must trigger 30-min event risk buffer');
assert(eventCheck.eventName === 'Union Budget Presentation', 'Event name must match Union Budget');


console.log('\n--- STARTING MODULE 8: JOURNAL, REVIEW AND ANALYTICS TESTS ---');

// Mock trade log with rule-followed vs broken trades
const mockTrades = [
  { id: 'T1', timestamp: '2026-02-02T09:35:00', session: 'Prime Morning', strategyName: 'Opening Range Breakout', grade: 'A', status: 'WIN', realizedR: 2.1, pnlAmount: 4200, rulesFollowed: true, checklistPassed: true },
  { id: 'T2', timestamp: '2026-02-02T10:15:00', session: 'Prime Morning', strategyName: 'Opening Range Breakout', grade: 'A', status: 'WIN', realizedR: 1.8, pnlAmount: 3600, rulesFollowed: true, checklistPassed: true },
  { id: 'T3', timestamp: '2026-02-03T14:05:00', session: 'Afternoon Expansion', strategyName: '1:40 PM Afternoon Compression', grade: 'A', status: 'WIN', realizedR: 2.0, pnlAmount: 4000, rulesFollowed: true, checklistPassed: true },
  { id: 'T4', timestamp: '2026-02-04T12:10:00', session: 'Midday Chop', strategyName: 'Generic Impulse', grade: 'C', status: 'LOSS', realizedR: -1.0, pnlAmount: -2000, rulesFollowed: false, checklistPassed: false },
  { id: 'T5', timestamp: '2026-02-04T12:25:00', session: 'Midday Chop', strategyName: 'Revenge Trade', grade: 'C', status: 'LOSS', realizedR: -1.2, pnlAmount: -2400, rulesFollowed: false, checklistPassed: false }
];

const analyticsSmall = JournalAnalytics.computeAnalytics(mockTrades, 200000, 1.0);

// Test 18: Rule-Followed vs Rule-Broken metrics
assert(analyticsSmall.ruleComparison.followed.count === 3, 'Followed trades count must be 3');
assert(analyticsSmall.ruleComparison.followed.winRate === 100, 'Followed win rate must be 100%');
assert(analyticsSmall.ruleComparison.followed.netR === 5.9, `Followed net R must be +5.9, got ${analyticsSmall.ruleComparison.followed.netR}`);

assert(analyticsSmall.ruleComparison.broken.count === 2, 'Broken trades count must be 2');
assert(analyticsSmall.ruleComparison.broken.winRate === 0, 'Broken win rate must be 0%');
assert(analyticsSmall.ruleComparison.broken.netR === -2.2, `Broken net R must be -2.2, got ${analyticsSmall.ruleComparison.broken.netR}`);

// Test 19: Edge Delta
assert(analyticsSmall.ruleComparison.edgeDeltaR === 8.1, `Edge delta must be 5.9 - (-2.2) = 8.1 R, got ${analyticsSmall.ruleComparison.edgeDeltaR}`);

// Test 20: 30-Trade Minimum Reliability Threshold (< 30 trades must be marked unreliable)
assert(analyticsSmall.userEdgeInsights.isReliable === false, 'Small sample (5 trades) must be flagged isReliable: false');
assert(analyticsSmall.userEdgeInsights.recommendation.includes('Initial sample'), 'Recommendation must state small sample status');

// Test 21: 30+ Trades Reliability Threshold
const mock35Trades = [];
for (let i = 0; i < 35; i++) {
  const isFollowed = i % 5 !== 0;
  const isWin = i % 3 !== 0;
  mock35Trades.push({
    id: `T${i + 1}`,
    timestamp: `2026-02-${String((i % 25) + 1).padStart(2, '0')}T10:00:00`,
    session: i % 2 === 0 ? 'Prime Morning' : 'Afternoon Expansion',
    strategyName: i % 2 === 0 ? 'Opening Range Breakout' : '1:40 PM Afternoon Compression',
    grade: 'A',
    status: isWin ? 'WIN' : 'LOSS',
    realizedR: isWin ? 2.0 : -1.0,
    pnlAmount: isWin ? 4000 : -2000,
    rulesFollowed: isFollowed,
    checklistPassed: isFollowed
  });
}

const analyticsLarge = JournalAnalytics.computeAnalytics(mock35Trades, 200000, 1.0);
assert(analyticsLarge.userEdgeInsights.isReliable === true, '35 trades must meet minimum reliable sample threshold');
assert(analyticsLarge.userEdgeInsights.sampleSize === 35, 'Sample size must be 35');
assert(analyticsLarge.userEdgeInsights.recommendation.includes('Validated Edge'), 'Reliable sample must display Validated Edge recommendations');

// Test 22: Weekly Behavioral Review Report (Top 3 mistakes & Top 3 strengths)
assert(Array.isArray(analyticsLarge.weeklyReview.topStrengths), 'topStrengths must be an array');
assert(analyticsLarge.weeklyReview.topStrengths.length > 0 && analyticsLarge.weeklyReview.topStrengths.length <= 3, 'Top strengths must have 1-3 items');
assert(Array.isArray(analyticsLarge.weeklyReview.topMistakes), 'topMistakes must be an array');
assert(analyticsLarge.weeklyReview.topMistakes.length > 0 && analyticsLarge.weeklyReview.topMistakes.length <= 3, 'Top mistakes must have 1-3 items');

// Test 23: CSV Export
const csvOutput = JournalAnalytics.exportToCsv(mockTrades);
assert(csvOutput.includes('Trade ID,Timestamp (IST),Session,Strategy'), 'CSV must contain standard headers');
assert(csvOutput.includes('"Opening Range Breakout"'), 'CSV must contain strategy row');
assert(csvOutput.includes('2.1'), 'CSV must contain realized R values');

console.log(`\n========================================`);
console.log(`MODULES 5-9 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
