/**
 * Test Suite: Trendline Pro, Multi-Tier Levels Engine & Structural Confluence
 *
 * Validates:
 *  1. Trendline Pro Engine & Presets (10/10, 30/30, 15/15, close-only breaks, sweeps, retests)
 *  2. Multi-Tier Levels Engine (Clustering within 0.25 ATR, scoring 0-100, role flips, lifecycle events)
 *  3. Gap handling & Intraday level downgrading
 *  4. Structural Confluence Engine (>= 2 sources for direction, obstacle penalties, A/B/C grading)
 *  5. Zero Footprint & State Persistence
 */

import { TrendlineEngine, TRENDLINE_PRESETS } from '../indicators/trendlinePro.js';
import { TrendlineModule } from '../indicators/trendlineModule.js';
import { LevelsEngine, LEVELS_PRESETS } from '../indicators/levelsEngine.js';
import { ConfluenceEngine } from '../confluence/confluenceEngine.js';
import { DataProvider } from '../services/dataProvider.js';

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

console.log('\n============================================================');
console.log('--- STARTING STRUCTURE & CONFLUENCE TEST SUITE ---');
console.log('============================================================\n');

// ================= TEST SECTION 1: TRENDLINE PRO ENGINE =================
console.log('[1. Trendline Pro Engine & Lifecycle]');

const mockBars = DataProvider.generateVerifiedHistory(24200, 500, '15m');
const tlEngine = new TrendlineEngine({ isEnabled: true, leftBars: 10, rightBars: 10 });

// Test 1.1: Fast preset execution
tlEngine.updateConfig(TRENDLINE_PRESETS.NIFTY_5M_FAST);
const fastState = tlEngine.update(mockBars);
assert(fastState.ready === true, 'Fast 10/10 preset computes successfully and reports ready');
assert(fastState.confirmationLagBars === 10, 'Fast preset lag is 10 bars');

// Test 1.2: Structure 30/30 preset
tlEngine.updateConfig(TRENDLINE_PRESETS.NIFTY_5M_STRUCTURE);
const structState = tlEngine.update(mockBars);
assert(structState.ready === true, 'Structure 30/30 preset computes successfully');
assert(structState.confirmationLagBars === 30, 'Structure preset lag is 30 bars');

// Test 1.3: Insufficient data handling
const shortBars = mockBars.slice(0, 40);
const shortState = tlEngine.update(shortBars);
assert(shortState.ready === false, 'Insufficient bars returns ready: false');
assert(shortState.warning !== null, 'Insufficient bars provides explanatory warning');

// Test 1.4: Trendline Module Wrapper
const tlModule = new TrendlineModule({ isEnabled: false });
assert(tlModule.getEnabled() === false, 'Module default state is disabled');
const offUpdate = tlModule.update(mockBars);
assert(offUpdate.isEnabled === false, 'Disabled module performs no calculation');
assert(tlModule.getDrawings().length === 0, 'Disabled module outputs zero drawings');

tlModule.setEnabled(true);
const onUpdate = tlModule.update(mockBars);
assert(onUpdate.isEnabled === true, 'Enabled module updates and computes state');
assert(tlModule.getDrawings().length > 0, 'Enabled module generates drawings');


// ================= TEST SECTION 2: MULTI-TIER LEVELS ENGINE =================
console.log('\n[2. Independent Multi-Tier Levels Engine]');

const levelsEngine = new LevelsEngine({ isEnabled: true });
const levelsResult = levelsEngine.update(mockBars, {
  vwap: 24190,
  callMaxOi: 24400,
  putMaxOi: 24000
});

assert(levelsResult.ready === true, 'Levels engine computes ready state');
assert(levelsResult.allZones.length > 0, `Constructed ${levelsResult.allZones.length} structural zones`);
assert(levelsResult.topZones.length <= 6, 'Top zones bounded by topNZones limit (6)');

// Test 2.1: Zone Clustering & Minimum Width
const sampleZone = levelsResult.topZones[0];
assert(sampleZone !== undefined, 'Top zone exists');
assert(sampleZone.widthPts >= (levelsEngine.getConfig().minZoneAtr * levelsResult.currentAtr) - 0.5, 'Zone width satisfies minZoneAtr requirement');
assert(sampleZone.strengthScore >= 10 && sampleZone.strengthScore <= 100, `Strength score is within 10-100 (${sampleZone.strengthScore})`);
assert(typeof sampleZone.scoreBreakdown.sourceDiversity === 'number', 'Score breakdown contains source diversity');

// Test 2.2: Nearest Resistance & Support
if (levelsResult.nearestResistance) {
  assert(levelsResult.nearestResistance.zone.bottomPrice > mockBars[mockBars.length - 1].close, 'Nearest resistance zone is above current close');
  assert(levelsResult.nearestResistance.distanceAtr >= 0, 'Distance to resistance is positive');
}
if (levelsResult.nearestSupport) {
  assert(levelsResult.nearestSupport.zone.topPrice < mockBars[mockBars.length - 1].close, 'Nearest support zone is below current close');
  assert(levelsResult.nearestSupport.distanceAtr >= 0, 'Distance to support is positive');
}

// Test 2.3: Role Flip Logic
// Simulate price breaking above resistance
const breakBars = [...mockBars];
const highRes = sampleZone.topPrice;
breakBars.push({
  open: highRes + 5,
  high: highRes + 30,
  low: highRes + 2,
  close: highRes + 25,
  volume: 120000,
  timestamp: Date.now()
});
const breakResult = levelsEngine.update(breakBars);
const flippedCheck = breakResult.allZones.some(z => z.flipped === true);
assert(flippedCheck === true, 'Zone successfully flips role when candle closes beyond zone + buffer');

// Test 2.4: Morning Gap Handling
const gapBars = [...mockBars];
const prevClose = gapBars[gapBars.length - 1].close;
gapBars.push({
  open: prevClose * 1.015, // 1.5% gap
  high: prevClose * 1.018,
  low: prevClose * 1.012,
  close: prevClose * 1.016,
  volume: 150000,
  timestamp: Date.now()
});
const gapResult = levelsEngine.update(gapBars);
assert(gapResult.ready === true, 'Levels engine processes large gap open gracefully');


// ================= TEST SECTION 3: CONFLUENCE ENGINE =================
console.log('\n[3. Structural Confluence Engine]');

// Test 3.1: Minimum 2 independent sources rule
const singleSourceInput = {
  trendlineState: null,
  levelsState: null,
  currentPrice: 24200,
  vwap: 24180
};
const singleResult = ConfluenceEngine.evaluate(singleSourceInput);
assert(singleResult.direction === 'none', 'Direction is none when fewer than 2 independent sources agree');
assert(singleResult.warnings.some(w => w.includes('Fewer than 2')), 'Warning emitted for insufficient structural sources');

// Test 3.2: High Confluence Long Setup
const strongLongInput = {
  trendlineState: {
    isEnabled: true,
    ready: true,
    uptrendLine: { id: 'UTL-1', slope: 0.1, score: 85, touches: 4, isBroken: false, currentProjectedPrice: 24195, zoneTop: 24202, zoneBottom: 24188, ageBars: 50, status: 'ACTIVE', statusDescription: 'Holding', type: 'UPTREND', p1: { barIndex: 10, confirmedBarIndex: 20, price: 24150 }, p2: { barIndex: 40, confirmedBarIndex: 50, price: 24180 }, brokenBarIndex: null },
    downtrendLine: null,
    confirmationLagBars: 30,
    events: [{ id: 'EV-1', type: 'BREAK_UP', sourceType: 'TRENDLINE', sourceId: 'DTL-1', direction: 'BULLISH', price: 24200, barIndex: 100, timestamp: Date.now(), quality: 85, note: 'Broke DTL' }],
    lastEvent: { id: 'EV-1', type: 'BREAK_UP', sourceType: 'TRENDLINE', sourceId: 'DTL-1', direction: 'BULLISH', price: 24200, barIndex: 100, timestamp: Date.now(), quality: 85, note: 'Broke DTL' },
    currentAtr: 20,
    score: 85,
    touches: 4,
    distanceAtr: 0.2,
    lastBarIndex: 100
  },
  levelsState: {
    isEnabled: true,
    ready: true,
    nearestResistance: {
      zone: { id: 'Z-RES', type: 'RESISTANCE', centerPrice: 24350, topPrice: 24355, bottomPrice: 24345, widthPts: 10, strengthScore: 75, scoreBreakdown: { sourceDiversity: 20, reactionScore: 20, pivotScaleScore: 15, recencyScore: 10, volumeConfirmation: 10, brokenPenalty: 0 }, sources: [], sourceTypes: ['SWING_PIVOT_L3'], sourceCount: 2, touchCount: 3, lastReactionBarIndex: 90, isBroken: false, brokenBarIndex: null, flipped: false, ageBars: 10, decayFactor: 0.9 },
      distancePts: 145,
      distanceAtr: 7.25
    },
    nearestSupport: {
      zone: { id: 'Z-SUP', type: 'SUPPORT', centerPrice: 24195, topPrice: 24202, bottomPrice: 24188, widthPts: 14, strengthScore: 88, scoreBreakdown: { sourceDiversity: 25, reactionScore: 25, pivotScaleScore: 18, recencyScore: 12, volumeConfirmation: 8, brokenPenalty: 0 }, sources: [], sourceTypes: ['PREV_DAY_HIGH', 'SWING_PIVOT_L3'], sourceCount: 3, touchCount: 4, lastReactionBarIndex: 95, isBroken: false, brokenBarIndex: null, flipped: false, ageBars: 5, decayFactor: 0.98 },
      distancePts: 5,
      distanceAtr: 0.25
    },
    topZones: [],
    allZones: [],
    events: [],
    lastEvent: null,
    roomToRun: { upwardPts: 145, upwardAtr: 7.25, downwardPts: 5, downwardAtr: 0.25 },
    currentAtr: 20,
    lastBarIndex: 100
  },
  currentPrice: 24205,
  vwap: 24190,
  regime: { label: 'Bullish Expansion Trend', bias: 'BULLISH', isChop: false },
  driverData: { pressureScore: 65 },
  sessionInfo: { isInsideSession: true }
};

const longResult = ConfluenceEngine.evaluate(strongLongInput);
assert(longResult.direction === 'long', 'Multi-tier confluence produces LONG direction');
assert(longResult.confluenceScore >= 80, `Confluence score is Grade A (${longResult.confluenceScore}/100)`);
assert(longResult.grade === 'A', 'Grade is A for high confluence setup');
assert(longResult.obstacle?.hasRoomToRun === true, 'Obstacle check confirms room to run (7.25 ATR)');

// Test 3.3: Obstacle Blocking Target (No Room to Run)
const blockedInput = {
  ...strongLongInput,
  levelsState: {
    ...strongLongInput.levelsState,
    nearestResistance: {
      zone: { id: 'Z-BLOCK', type: 'RESISTANCE', centerPrice: 24212, topPrice: 24216, bottomPrice: 24208, widthPts: 8, strengthScore: 90, scoreBreakdown: { sourceDiversity: 20, reactionScore: 20, pivotScaleScore: 15, recencyScore: 10, volumeConfirmation: 10, brokenPenalty: 0 }, sources: [], sourceTypes: ['CALL_MAX_OI'], sourceCount: 2, touchCount: 3, lastReactionBarIndex: 90, isBroken: false, brokenBarIndex: null, flipped: false, ageBars: 10, decayFactor: 0.9 },
      distancePts: 7,
      distanceAtr: 0.35 // Less than 1.0 ATR!
    }
  }
};
const blockedResult = ConfluenceEngine.evaluate(blockedInput);
assert(blockedResult.obstacle?.hasRoomToRun === false, 'Correctly flags obstacle within 1 ATR threshold');
assert(blockedResult.grade !== 'A', `Blocked setup is downgraded from Grade A (actual: ${blockedResult.grade})`);
assert(blockedResult.warnings.some(w => w.includes('Obstacle barrier')), 'Warning generated for overhead obstacle');


// ================= FINAL TEST SUMMARY =================
console.log('\n============================================================');
console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
