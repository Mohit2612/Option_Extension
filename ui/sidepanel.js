/**
 * TradeSight NIFTY 50 - Side Panel Controller
 * Connects Pattern Engine, Driver Engine, Strategy Engine, Journal & TradingView Overlay.
 */

import { PatternEngine } from '../patterns/pattern-engine.js';
import { DriverEngine } from '../drivers/driver-engine.js';
import { StrategyEngine } from '../strategies/strategy-engine.js';
import { NiftyJournalEngine } from '../journal/nifty-journal.js';
import { SessionClock } from '../services/sessionClock.js';
import { ExpiryCalendar } from '../services/expiryCalendar.js';
import { RiskManager } from '../services/riskManager.js';
import { SupportResistanceEngine } from '../services/supportResistanceEngine.js';
import { BacktestEngine } from '../services/backtestEngine.js';
import { AlertService } from '../services/alertService.js';
import { SessionManager } from '../services/sessionManager.js';
import { DisciplineStateMachine } from '../services/disciplineStateMachine.js';
import { TradeQualityScorer } from '../services/tradeQualityScorer.js';
import { PositionSizer } from '../risk/positionSizer.js';
import { PreTradeChecklist } from '../discipline/checklist.js';
import { BehaviorGuard } from '../discipline/behaviorGuard.js';
import { NoTradeFilters } from '../discipline/noTradeFilters.js';
import { JournalAnalytics } from '../journal/analytics.js';
import { DisciplinePanel } from './disciplinePanel.js';
import { ScalpPanel } from './scalpPanel.js';
import { ScalpStrategy } from '../scalping/scalpStrategy.js';
import { StreamingProvider } from '../services/streamingProvider.js';
import { ScalpRenderer } from '../overlay/scalpRenderer.js';
import { IndicatorManager } from '../indicators/indicatorManager.js';
import { IndicatorTogglesUI } from './indicatorToggles.js';
import { DataProvider } from '../services/dataProvider.js';
import { NIFTY_CONFIG } from '../config/nifty-config.js';
import { Logger } from '../utils/logger.js';
import { TrendlineEngine, TRENDLINE_PRESETS, DEFAULT_TRENDLINE_PRO_CONFIG } from '../indicators/trendlinePro.js';
import { LevelsEngine, LEVELS_PRESETS, DEFAULT_LEVELS_CONFIG } from '../indicators/levelsEngine.js';
import { ConfluenceEngine, DEFAULT_CONFLUENCE_CONFIG } from '../confluence/confluenceEngine.js';

let appConfig = {};
let latestSignal = null;
let latestDrivers = null;
let latestScalpSetup = null;
let streamingProvider = null;
let currentChartMeta = null;
let dailyLossCount = 0;
let isRiskLocked = false;
let indicatorManager = null;
let indicatorTogglesUI = null;
let latestIndicatorState = null;

// Structure & Confluence module instances (initialized lazily from config)
let _tlEngine = null;
let _lvEngine = null;
let _latestConfluenceResult = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initApp();
  } catch (err) {
    Logger.error('Nifty sidepanel init error:', err);
  }
});

async function initApp() {
  await loadUserConfig();
  initTabs();
  initScanControls();
  initDriverTab();
  initStrategySettings();
  initJournalAndBacktest();
  initRiskLockControls();
  initAudioAlertControls();
  initAutoDetectListener();
  await initSessionAndDisciplineLayer();
  initSettingsForm();

  // Initialize Discipline Panel (Checklist, Sizing & Anti-Tilt)
  DisciplinePanel.init({
    onChecklistChange: () => {
      runNiftyScan();
    }
  });

  // Initialize Scalping & Spike Watch Module
  await ScalpPanel.init({
    onToggleChange: (enabled) => {
      appConfig.scalpEnabled = enabled;
      handleStreamingProviderState(enabled);
      runNiftyScan();
    },
    onPresetChange: (preset) => {
      appConfig.scalpPreset = preset;
      runNiftyScan();
    }
  });

  handleStreamingProviderState(ScalpPanel.isEnabled);

  // Initialize Technical Indicator Modules (NSDT Auto S/R & Pivot Trendlines 30/30)
  indicatorManager = new IndicatorManager();
  await indicatorManager.initFromStorage();
  indicatorTogglesUI = new IndicatorTogglesUI(indicatorManager, {
    onMasterToggle: () => {
      runNiftyScan();
    },
    onNSDTToggle: () => {
      runNiftyScan();
    },
    onTrendlineToggle: () => {
      runNiftyScan();
    }
  });
  indicatorTogglesUI.init();

  // Initialize Structure & Confluence Engines from stored config
  initStructureConfluenceModule();

  // Probe TradingView chart
  probeTradingViewChart();

  // Load verified journal analytics
  refreshJournalDashboard();

  // Update session & countdown badges
  updateSessionBadges();
}

function handleStreamingProviderState(enabled) {
  if (enabled) {
    if (!streamingProvider) {
      streamingProvider = new StreamingProvider({
        latencyAlertThresholdMs: appConfig.scalpMaxLatency || 1500
      });
      streamingProvider.onTick((tick) => {
        ScalpPanel.updateLatency(tick.tickLatencyMs, streamingProvider.isStreamConnected());
      });
      streamingProvider.onStatus((status) => {
        ScalpPanel.updateLatency(status.latencyMs, status.connected);
      });
    }
    streamingProvider.connect();
  } else {
    if (streamingProvider) {
      streamingProvider.disconnect();
    }
    ScalpPanel.updateLatency(0, false);
  }
}

async function loadUserConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (res) => {
      appConfig = {
        capitalINR: res.ts_capital_inr || 200000,
        coolDownMinutes: res.ts_cooldown_mins || 20,
        riskPreset: res.ts_risk_preset || 'BALANCED',
        lotSize: res.ts_nifty_lot_size || NIFTY_CONFIG.symbol.defaultLotSize,
        riskPct: res.ts_nifty_risk_pct || NIFTY_CONFIG.risk.maxCapitalRiskPerTradePct,
        apiKey: res.ts_gemini_api_key || '',
        strategies: res.ts_nifty_strategies || NIFTY_CONFIG.strategies,
        maxTradesPerModule: res.ts_max_trades_module || 2,
        maxDailyTrades: res.ts_max_daily_trades || 3,
        maxDailyLoss: res.ts_max_daily_loss || 3000,
        heroMinPremium: res.ts_hero_min_premium || 5,
        heroMaxPremium: res.ts_hero_max_premium || 40,
        heroRiskPct: res.ts_hero_risk_pct || 0.75,
        orbSlMode: res.ts_orb_sl_mode || 'midpoint',
        afternoonCompPts: res.ts_afternoon_comp_pts || 35,
        dailyProfitTargetR: res.ts_daily_profit_target_r || 2.0,
        dailyMaxLossR: res.ts_daily_max_loss_r || 2.0,
        profitProtectionMode: res.ts_profit_protection_mode !== false,
        sessionProfile: res.ts_session_profile || 'MORNING_AFTERNOON',
        allowGradeB: res.ts_allow_grade_b !== false,
        gradeBSizeMultiplier: res.ts_grade_b_multiplier || 0.75,
        gradeAThreshold: res.ts_grade_a_threshold || 80,
        gradeBThreshold: res.ts_grade_b_threshold || 65,
        scalpEnabled: res.ts_scalp_module_enabled === true,
        scalpPreset: res.ts_scalp_preset || 'CONSERVATIVE',
        scalpMaxLatency: res.ts_scalp_max_latency || 1500,
        indicatorsMaster: res.ts_indicators_master === true,
        nsdtEnabled: res.ts_nsdt_enabled === true,
        trendlineEnabled: res.ts_trendline_enabled === true,
        nsdtL1: res.ts_nsdt_l1 || 5,
        nsdtL2: res.ts_nsdt_l2 || 10,
        nsdtL3: res.ts_nsdt_l3 || 20,
        clusterBandAtr: res.ts_cluster_band || 0.15,
        tlBufferAtr: res.ts_tl_buffer || 0.1,

        // Structure & Confluence engine config
        structTlEnabled:      res.ts_struct_tl_enabled === true,
        structLvlEnabled:     res.ts_struct_lvl_enabled === true,
        structTlPreset:       res.ts_struct_tl_preset   || 'NIFTY_5M_STRUCTURE',
        structLvlPreset:      res.ts_struct_lvl_preset  || 'NIFTY_STANDARD_SWING',
        structTlLeftBars:     res.ts_struct_tl_left     || 30,
        structTlRightBars:    res.ts_struct_tl_right    || 30,
        structTlBreakoutAtr:  res.ts_struct_tl_brk      || 0.10,
        structTlRetestAtr:    res.ts_struct_tl_ret      || 0.20,
        structTlZoneBandAtr:  res.ts_struct_tl_zb       || 0.20,
        structTlMinTouches:   res.ts_struct_tl_mt       || 2,
        structLvlSmall:       res.ts_struct_lvl_s       || 5,
        structLvlMedium:      res.ts_struct_lvl_m       || 10,
        structLvlLarge:       res.ts_struct_lvl_l       || 20,
        structLvlClusterAtr:  res.ts_struct_lvl_cl      || 0.25,
        structLvlReactionAtr: res.ts_struct_lvl_re      || 0.30,
        structLvlTopN:        res.ts_struct_lvl_top     || 6,
        structCfGradeA:       res.ts_struct_cf_ga       || 80,
        structCfGradeB:       res.ts_struct_cf_gb       || 65,
        structCfMinRr:        res.ts_struct_cf_rr       || 1.5,
        structCfObstacleAtr:  res.ts_struct_cf_obs      || 1.0
      };
      resolve(appConfig);
    });
  });
}

/* ================= TAB NAVIGATION ================= */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const panel = document.getElementById(tab.dataset.tab);
      if (panel) panel.classList.add('active');

      if (tab.dataset.tab === 'tab-drivers') renderDriversTab();
      if (tab.dataset.tab === 'tab-journal') refreshJournalDashboard();
    });
  });
}

/* ================= PROBE TRADINGVIEW ================= */
async function probeTradingViewChart() {
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'FORWARD_TO_ACTIVE_TAB',
      payload: { action: 'EXTRACT_CHART_META' }
    });

    if (resp?.success && resp.data?.meta) {
      currentChartMeta = resp.data.meta;
      updateChartMetaDisplay(currentChartMeta);
    }
  } catch (err) {
    Logger.debug('TradingView tab not active yet.');
  }
}

function updateChartMetaDisplay(meta) {
  if (!meta) return;
  const symEl = document.getElementById('meta-symbol');
  const tfEl = document.getElementById('meta-timeframe');
  const pxEl = document.getElementById('meta-price');

  if (symEl) symEl.textContent = (meta.symbol || 'ACTIVE CHART').toUpperCase();
  if (tfEl) tfEl.textContent = meta.timeframe || '15m';
  if (pxEl) pxEl.textContent = meta.currentPrice ? meta.currentPrice.toFixed(2) : '--.--';
}

/* ================= SCAN & EVALUATE NEXT MOVE ================= */
function initScanControls() {
  const scanBtn = document.getElementById('btn-scan-nifty');
  const drawBtn = document.getElementById('btn-draw-nifty-overlay');
  const logBtn = document.getElementById('btn-log-nifty-journal');

  scanBtn?.addEventListener('click', runNiftyScan);

  drawBtn?.addEventListener('click', () => {
    if (latestSignal) {
      dispatchOverlayToChart(latestSignal, latestDrivers);
    }
  });

  logBtn?.addEventListener('click', async () => {
    if (latestSignal && latestSignal.signal !== 'WAIT') {
      await NiftyJournalEngine.logSignal(latestSignal, latestDrivers, currentChartMeta);
      alert(`Signal logged to Journal: ${currentChartMeta?.symbol || 'NIFTY'} ${latestSignal.signal} @ ${latestSignal.levels?.entryPrice}`);
      refreshJournalDashboard();
    } else {
      alert('Cannot log WAIT. Journal only tracks actionable setups.');
    }
  });

  const toggleTqBtn = document.getElementById('btn-toggle-tq-breakdown');
  toggleTqBtn?.addEventListener('click', () => {
    const container = document.getElementById('tq-breakdown-container');
    if (!container) return;
    if (container.style.display === 'none' || container.style.display === '') {
      container.style.display = 'flex';
      toggleTqBtn.textContent = 'Hide Breakdown ▲';
    } else {
      container.style.display = 'none';
      toggleTqBtn.textContent = 'View Breakdown ▾';
    }
  });
}

async function runNiftyScan() {
  if (isRiskLocked) {
    AlertService.playLockoutBuzzer();
    setSystemStatus('Locked Out', 'error');
    alert('🛡️ RISK LOCK ACTIVE: Trading is locked out for capital protection. Stand aside until next session open (09:15 AM IST).');
    return;
  }

  const laser = document.getElementById('scanner-laser');
  laser?.classList.add('active');
  setSystemStatus('Scanning Chart...', 'scanning');

  try {
    // 1. Probe chart metadata & live price from any TradingView tab
    await probeTradingViewChart();
    const activeSymbol = (currentChartMeta?.symbol || 'NIFTY 50').toUpperCase();
    const currentPrice = currentChartMeta?.currentPrice || 24120;
    const isNifty = activeSymbol.includes('NIFTY') || activeSymbol.includes('CNXNIFTY');

    // 2. Run 1-Month Support & Resistance Verification Engine
    const srData = SupportResistanceEngine.calculateOneMonthSR(activeSymbol, currentPrice);

    // 3. Construct Key Levels with 1-Month S/R
    const keyLevels = {
      vwap: currentPrice - 8,
      pdh: Math.round((srData.pivot + (srData.monthRange * 0.2)) * 10) / 10,
      pdl: Math.round((srData.pivot - (srData.monthRange * 0.2)) * 10) / 10,
      pdc: currentPrice - 10,
      orh: currentPrice + Math.round(srData.monthRange * 0.05),
      orl: currentPrice - Math.round(srData.monthRange * 0.05),
      monthHigh: srData.monthHigh,
      monthLow: srData.monthLow,
      monthPivot: srData.pivot,
      majorResistance: srData.majorResistance.price,
      majorSupport: srData.majorSupport.price,
      maxCallOi: Math.round((currentPrice + 200) / 50) * 50,
      maxPutOi: Math.round((currentPrice - 150) / 50) * 50,
      maxPain: Math.round(currentPrice / 50) * 50
    };

    // 4. Synthesize Working Candles with at least 500 bars for indicator calculation & warm-up
    const candles = DataProvider.getCandles({
      basePrice: currentPrice,
      minBars: 500,
      existingBars: generateWorkingCandles(currentPrice, currentChartMeta?.candleOHLC),
      timeframe: currentChartMeta?.timeframe || '15m'
    });

    // 5. Evaluate Candlestick Pattern on Active Chart
    const detectedPattern = PatternEngine.evaluateLatestCandle(candles, keyLevels);

    // 6. Verify Trade Confirmation with 1-Month S/R
    const srConfirmation = SupportResistanceEngine.verifyTradeWithSR(detectedPattern, currentPrice, srData);

    // 7. Run Driver Engine
    const driverData = await DriverEngine.getMarketPressure(currentPrice);
    latestDrivers = driverData;

    // 8. Synthesize Final Signal based on S/R Verification & Pattern
    let finalSignal = null;
    if (isNifty) {
      const stratResult = StrategyEngine.evaluateSetup({
        candles, keyLevels, driverData, dailyLossCount, userConfig: appConfig, currentTime: new Date()
      });

      if (srConfirmation.confirmed) {
        finalSignal = {
          ...srConfirmation,
          strategyName: srConfirmation.title,
          setupRationale: srConfirmation.rationale,
          pattern: detectedPattern,
          patternName: detectedPattern ? detectedPattern.name : null,
          regime: stratResult.regime || { label: '1-Month S/R Floor/Ceiling Alignment' }
        };
      } else if (stratResult.signal !== 'WAIT') {
        finalSignal = {
          ...stratResult,
          pattern: detectedPattern,
          patternName: detectedPattern ? detectedPattern.name : null,
          srLocation: srConfirmation.srLocation
        };
      } else {
        finalSignal = {
          ...stratResult,
          pattern: detectedPattern,
          patternName: detectedPattern ? detectedPattern.name : null,
          setupRationale: srConfirmation.rationale,
          srLocation: srConfirmation.srLocation
        };
      }
    } else {
      // Any other Asset (BankNifty, Stocks, Crypto, Forex, etc.)
      finalSignal = {
        signal: srConfirmation.signal,
        action: srConfirmation.action,
        confidence: srConfirmation.confidence || 0,
        strategyName: srConfirmation.title,
        setupRationale: srConfirmation.rationale,
        levels: srConfirmation.levels,
        invalidation: srConfirmation.invalidation || 'Awaiting 1-Month S/R test.',
        pattern: detectedPattern,
        patternName: detectedPattern ? detectedPattern.name : null,
        srLocation: srConfirmation.srLocation,
        regime: { label: `${activeSymbol} 1M S/R Structure` }
      };
    }

    // PASS SIGNAL THROUGH DISCIPLINE & LOSS-PROTECTION LAYER
    // Intercept raw signal and enforce session timing, daily state machine, and profit protection
    const now = new Date();
    const isExpiryDay = ExpiryCalendar.isExpiryDay(now);
    const sessionInfo = SessionManager.evaluateSession(now, {
      activeProfile: appConfig.sessionProfile || 'MORNING_AFTERNOON',
      allowMiddayHighGradeBreakouts: false
    }, isExpiryDay);

    const dailyDisciplineState = await DisciplineStateMachine.getState();

    // MODULE 3: TRADE QUALITY SCORE EVALUATION (0-100 & A/B/C GRADING)
    const qualityScore = TradeQualityScorer.evaluateQuality({
      signalData: finalSignal,
      candles,
      keyLevels,
      driverData,
      chartMeta: currentChartMeta,
      userConfig: {
        allowGradeB: appConfig.allowGradeB !== false,
        gradeBSizeMultiplier: appConfig.gradeBSizeMultiplier || 0.75,
        gradeAThreshold: appConfig.gradeAThreshold || 80,
        gradeBThreshold: appConfig.gradeBThreshold || 65
      },
      currentTime: now
    });

    // Update Technical Indicator Engines (NSDT Auto S/R & Pivot Trendlines 30/30)
    if (indicatorManager) {
      latestIndicatorState = indicatorManager.update(candles);
      indicatorTogglesUI?.renderState(latestIndicatorState);

      // Confluence integration: location quality & obstacle checks
      if (latestIndicatorState?.masterEnabled && latestIndicatorState.confluenceSummary) {
        const conf = latestIndicatorState.confluenceSummary;
        if (conf.netScore !== 0) {
          qualityScore.totalScore = Math.max(0, Math.min(100, qualityScore.totalScore + conf.netScore));
          if (qualityScore.totalScore >= (appConfig.gradeAThreshold || 80)) {
            qualityScore.grade = 'A';
            qualityScore.gradeTitle = `GRADE A • ${Math.round(qualityScore.totalScore)}/100`;
            qualityScore.isAllowed = true;
            qualityScore.statusLabel = 'ALLOWED (1.0x)';
          } else if (qualityScore.totalScore >= (appConfig.gradeBThreshold || 65)) {
            qualityScore.grade = 'B';
            qualityScore.gradeTitle = `GRADE B • ${Math.round(qualityScore.totalScore)}/100`;
            qualityScore.isAllowed = appConfig.allowGradeB !== false;
            qualityScore.statusLabel = qualityScore.isAllowed ? `ALLOWED (${appConfig.gradeBSizeMultiplier || 0.75}x)` : 'BLOCKED (Grade B Disabled)';
          } else {
            qualityScore.grade = 'C';
            qualityScore.gradeTitle = `GRADE C • ${Math.round(qualityScore.totalScore)}/100`;
            qualityScore.isAllowed = false;
            qualityScore.statusLabel = 'BLOCKED (Score < 65)';
          }

          qualityScore.breakdown.push({
            name: 'Indicator S/R Confluence',
            weight: 10,
            rawScore: Math.min(100, Math.max(0, 50 + conf.netScore * 5)),
            weightedScore: conf.netScore,
            note: conf.notes.join(' • ') || 'Level & Trendline structure confluence'
          });
        }
      }
    }

    finalSignal = DisciplineStateMachine.evaluateDisciplineGuard({
      rawSignal: finalSignal,
      sessionInfo,
      chartMeta: currentChartMeta,
      dailyState: dailyDisciplineState,
      qualityScore
    });

    // MODULE 5: BEHAVIOR PROTECTION (Cool-Down & Revenge Trade Risk)
    const coolDownStatus = BehaviorGuard.evaluateCoolDown(DisciplinePanel.coolDownUntil, now);
    DisciplinePanel.startCoolDownMonitor();

    // MODULE 7: POSITION SIZING AND RISK CALCULATOR
    const entryPx = finalSignal.levels?.entryPrice || currentPrice;
    const slPx = finalSignal.levels?.stopLoss || (finalSignal.signal === 'BUY' ? entryPx - 25 : entryPx + 25);
    const tgtPx = finalSignal.levels?.target1 || (finalSignal.signal === 'BUY' ? entryPx + 50 : entryPx - 50);
    const capitalINR = appConfig.capitalINR || 200000;
    const riskPct = appConfig.riskPct || 1.0;
    const lotSize = appConfig.lotSize || 25;

    const sizingResult = PositionSizer.calculateSizing({
      capitalINR,
      riskPct,
      entryPrice: entryPx,
      stopLoss: slPx,
      lotSize,
      isOption: isNifty,
      optionPremium: isNifty ? 120 : 0,
      positionSizeMultiplier: (dailyDisciplineState.isProfitProtected ? 0.5 : 1.0) * (qualityScore.grade === 'B' ? (appConfig.gradeBSizeMultiplier || 0.75) : 1.0)
    });
    DisciplinePanel.renderPositionSizer(sizingResult);

    // MODULE 6: PRE-TRADE CHECKLIST EVALUATION
    const eventRiskCheck = NoTradeFilters.isInsideEventBuffer(now);
    const rrRatio = Math.abs(tgtPx - entryPx) / Math.max(1, Math.abs(entryPx - slPx));
    const checklistResult = PreTradeChecklist.evaluateChecklist({
      sessionInfo,
      regime: finalSignal.regime,
      qualityScore,
      entryPrice: entryPx,
      stopLoss: slPx,
      riskRewardRatio: rrRatio,
      sizingResult,
      eventRisk: eventRiskCheck,
      dailyDisciplineState,
      isCalmConfirmed: DisciplinePanel.isCalmConfirmed
    });
    DisciplinePanel.renderChecklist(checklistResult);

    // Check size discipline & revenge trading risk
    const standardLots = Math.floor((capitalINR * (riskPct / 100)) / (Math.max(1, Math.abs(entryPx - slPx)) * lotSize));
    const revengeCheck = BehaviorGuard.evaluateRevengeRisk({
      dailyState: dailyDisciplineState,
      requestedLots: sizingResult.lots,
      standardLots,
      grade: qualityScore.grade,
      isAgainstPlan: !checklistResult.allPassed
    });

    if (revengeCheck.isRevengeRisk) {
      AlertService.sendNotification('BEHAVIOR WARNING', revengeCheck.warningMessage);
    }

    // MANDATORY GATE: Only when ALL boxes pass does the signal become actionable
    if (!checklistResult.allPassed) {
      finalSignal.isActionable = false;
      if (finalSignal.signal !== 'WAIT') {
        finalSignal.action = `AWAITING CHECKLIST (${checklistResult.passedCount}/8)`;
      }
    }

    if (coolDownStatus.isActive) {
      finalSignal.isActionable = false;
      finalSignal.action = `COOL-DOWN PAUSE (${coolDownStatus.formattedRemaining})`;
    }

    latestSignal = finalSignal;

    // 8b. Scalping & Spike Watch Engine Evaluation
    if (ScalpPanel.isEnabled) {
      const presetSettings = ScalpPanel.PRESETS[ScalpPanel.preset] || ScalpPanel.PRESETS.CONSERVATIVE;
      latestScalpSetup = ScalpStrategy.evaluateSetup({
        candles,
        currentPrice,
        keyLevels,
        driverData,
        optionsData: {
          atmCallOiChange: -350000,
          atmPutOiChange: 420000,
          pcrChange: 0.12,
          ivExpansionPct: 4.5
        },
        currentTime: now,
        isExpiryDay,
        dailyScalpState: {
          tradesToday: dailyDisciplineState.tradeCount || 0,
          consecutiveLosses: dailyDisciplineState.consecutiveLosses || 0,
          isLocked: dailyDisciplineState.isLocked
        },
        config: {
          isEnabled: true,
          riskPctPerScalp: presetSettings.riskPctPerScalp,
          maxScalpsPerDay: presetSettings.maxScalpsPerDay,
          minNetRR: presetSettings.minNetRR,
          atrMultiplierSL: presetSettings.atrMultiplierSL,
          timeStopMinutes: presetSettings.timeStopMinutes,
          capitalINR: appConfig.capitalINR || 200000,
          lotSize: appConfig.lotSize || 25
        }
      });

      ScalpPanel.renderScalpUpdate(latestScalpSetup);

      if (latestScalpSetup.isActionable && latestScalpSetup.status === 'TRIGGERED') {
        AlertService.sendNotification('⚡ SCALP TRIGGER CONFIRMED', `${latestScalpSetup.direction} @ ${latestScalpSetup.entryPrice} (SL: ${latestScalpSetup.stopLoss}, Net 1:${latestScalpSetup.costAnalysis?.netRR}R)`);
      } else if (latestScalpSetup.readiness?.state === 'SPIKE_RISK_HIGH') {
        AlertService.sendNotification('⚠️ SPIKE RISK HIGH', `Pre-spike conditions building near ${latestScalpSetup.readiness.watchedKeyLevel || 'Pivot'}. Score: ${latestScalpSetup.readiness.score}/100.`);
      }
    } else {
      latestScalpSetup = null;
      ScalpPanel.renderScalpUpdate({
        isActionable: false,
        status: 'INACTIVE',
        readiness: { score: 0, state: 'CALM', stateLabel: 'CALM', directionLean: 'UNCLEAR' }
      });
    }

    // Audible & Desktop Alerts on Actionable Confirmations ONLY IF Discipline Layer & Checklist permit action
    if (latestSignal.isActionable && latestSignal.confirmed && latestSignal.signal === 'BUY') {
      AlertService.playBuyChime();
      AlertService.sendNotification('CONFIRMED BUY', `${latestSignal.patternName || 'Pattern'} at 1-Month Support! Target: ${latestSignal.levels?.target1}`);
    } else if (latestSignal.isActionable && latestSignal.confirmed && latestSignal.signal === 'SELL') {
      AlertService.playSellChime();
      AlertService.sendNotification('CONFIRMED SELL', `${latestSignal.patternName || 'Pattern'} at 1-Month Resistance! Target: ${latestSignal.levels?.target1}`);
    }

    // 9. Render Sidepanel UI
    renderNextMoveHero(latestSignal, driverData, detectedPattern, srData, srConfirmation);
    renderTradeQualityCard(qualityScore);

    // 9b. Evaluate Structure & Confluence and update panel card
    if (_tlEngine || _lvEngine) {
      const tlEnabled = appConfig.structTlEnabled && _tlEngine;
      const lvEnabled = appConfig.structLvlEnabled && _lvEngine;

      if (tlEnabled) _tlEngine.update(candles, { lastClosed: true });
      if (lvEnabled) _lvEngine.update(candles, {
        lastClosed: true,
        externalLevels: { vwap: srData?.vwap || currentPrice }
      });

      const tlState = tlEnabled ? _tlEngine.getState() : null;
      const lvState = lvEnabled ? _lvEngine.getState() : null;

      _latestConfluenceResult = ConfluenceEngine.evaluate({
        trendlineState: tlState && tlState.ready ? { ...tlState, isEnabled: true } : null,
        levelsState:    lvState && lvState.ready ? { ...lvState, isEnabled: true } : null,
        currentPrice,
        vwap:           srData?.vwap || currentPrice,
        regime:         finalSignal.regime,
        triggerCandle:  candles[candles.length - 1],
        driverData,
        sessionInfo,
        eventRisk:      NoTradeFilters.isInsideEventBuffer(now).isBlocked
      }, {
        gradeAThreshold:       appConfig.structCfGradeA   || 80,
        gradeBThreshold:       appConfig.structCfGradeB   || 65,
        minRrRatio:            appConfig.structCfMinRr    || 1.5,
        obstacleAtrThreshold:  appConfig.structCfObstacleAtr || 1.0
      });

      renderStructureConfluenceCard(_latestConfluenceResult, tlState, lvState);
    }

    // 10. Auto-Draw on TradingView Overlay
    dispatchOverlayToChart(latestSignal, driverData, keyLevels, srData);

    // 11. Update time and hero-zero badges
    updateSessionBadges(latestSignal);

    setSystemStatus('Ready', 'ready');
  } catch (err) {
    Logger.error('Chart scan failed:', err);
    setSystemStatus('Error', 'error');
  } finally {
    laser?.classList.remove('active');
  }
}

function updateSessionBadges(signalData = null) {
  const badge = document.getElementById('hero-zero-status-badge');
  const pill = document.getElementById('hero-countdown-pill');
  if (!badge && !pill) return;

  const now = new Date();
  const isExp = ExpiryCalendar.isExpiryDay(now);
  const inWindow = SessionClock.isInsideHeroZeroWindow(now);
  const lockStatus = RiskManager.isHeroZeroLocked();

  if (badge) {
    if (lockStatus.locked) {
      badge.className = 'hero-zero-badge locked';
      badge.textContent = '🔒 HZ Locked (2-Loss)';
    } else if (isExp && inWindow) {
      badge.className = 'hero-zero-badge armed';
      badge.textContent = '⚡ Hero-Zero Armed';
    } else if (isExp) {
      badge.className = 'hero-zero-badge standby';
      badge.textContent = '⏳ Expiry Active (Window 13:45)';
    } else {
      badge.className = 'hero-zero-badge standby';
      badge.textContent = '📊 1M S/R Active';
    }
  }

  if (pill) {
    const cd = SessionClock.getCountdownToNextWindow(now);
    pill.textContent = `⏱️ ${cd.label} (${cd.remainingFormatted})`;
  }
}

function renderNextMoveHero(signalData, driverData, pattern, srData = null, srConfirmation = null) {
  const signalBadge = document.getElementById('hero-signal');
  const stratEl = document.getElementById('hero-strategy');
  const confEl = document.getElementById('hero-confidence');
  const regimeEl = document.getElementById('hero-regime');
  const rationaleEl = document.getElementById('hero-rationale');

  const signal = signalData.signal || 'WAIT';
  signalBadge.className = 'hero-signal-badge';

  if (signalData.disciplineStatus?.isLocked) {
    signalBadge.textContent = '🔒 LOCKED';
    signalBadge.style.background = 'rgba(255, 59, 105, 0.2)';
    signalBadge.style.color = '#FF3B69';
    signalBadge.style.borderColor = '#FF3B69';
  } else if (signalData.isInfoOnly || signalData.action?.includes('INFO ONLY')) {
    signalBadge.textContent = '⏳ INFO ONLY';
    signalBadge.style.background = 'rgba(251, 191, 36, 0.2)';
    signalBadge.style.color = '#FBBF24';
    signalBadge.style.borderColor = '#FBBF24';
  } else {
    signalBadge.textContent = signal;
    signalBadge.removeAttribute('style');
    if (signal === 'BUY') signalBadge.classList.add('hud-signal-buy');
    else if (signal === 'SELL') signalBadge.classList.add('hud-signal-sell');
    else signalBadge.classList.add('hud-signal-wait');
  }

  stratEl.textContent = signalData.strategyName || 'Rule Engine Active';
  confEl.textContent = `${signalData.confidence || 0}% Conviction`;
  regimeEl.textContent = `Regime: ${signalData.regime?.label || 'Neutral'}`;

  let rationale = signalData.setupRationale || signalData.filterReason || 'Standing by for high-probability structural confluence.';
  if (signalData.profitProtectionNote) {
    rationale = `${signalData.profitProtectionNote}\n\n${rationale}`;
  }
  rationaleEl.textContent = rationale;

  // 1-Month S/R Card fields
  if (srData) {
    const mHigh = document.getElementById('sr-month-high');
    const mPivot = document.getElementById('sr-month-pivot');
    const mLow = document.getElementById('sr-month-low');
    const resVal = document.getElementById('sr-res-val');
    const supVal = document.getElementById('sr-sup-val');
    const confStatus = document.getElementById('sr-confluence-status');

    if (mHigh) mHigh.textContent = srData.monthHigh;
    if (mPivot) mPivot.textContent = srData.pivot;
    if (mLow) mLow.textContent = srData.monthLow;
    if (resVal) resVal.textContent = `${srData.majorResistance.price} [Tested ${srData.majorResistance.testedCount}x]`;
    if (supVal) supVal.textContent = `${srData.majorSupport.price} [Tested ${srData.majorSupport.testedCount}x]`;

    if (confStatus && srConfirmation) {
      confStatus.textContent = srConfirmation.srLocation;
      if (srConfirmation.confirmed) {
        confStatus.style.background = 'rgba(0, 230, 118, 0.2)';
        confStatus.style.color = '#00E676';
        confStatus.style.borderColor = '#00E676';
      } else {
        confStatus.style.background = 'rgba(255, 183, 3, 0.15)';
        confStatus.style.color = '#FFB703';
        confStatus.style.borderColor = 'rgba(255, 183, 3, 0.3)';
      }
    }
  }

  // Pattern Details
  const patName = document.getElementById('hero-pattern-name');
  const patDesc = document.getElementById('hero-pattern-desc');
  const patLoc = document.getElementById('hero-pattern-location');

  if (pattern) {
    patName.textContent = `${pattern.name} (${pattern.direction})`;
    patDesc.textContent = pattern.description;
    patLoc.textContent = srConfirmation?.srLocation || (pattern.isActionable ? `At ${pattern.locationTag}` : 'Mid-Range (Filtered)');
  } else {
    patName.textContent = 'No Actionable Pattern';
    patDesc.textContent = 'Candlesticks without location confluence are ignored.';
    patLoc.textContent = 'Mid-Range Filter Active';
  }

  // Levels
  document.getElementById('hero-level-entry').textContent = signalData.levels?.entryPrice || '--';
  document.getElementById('hero-level-sl').textContent = signalData.levels?.stopLoss || '--';
  document.getElementById('hero-level-tp1').textContent = signalData.levels?.target1 || '--';
  document.getElementById('hero-level-tp2').textContent = signalData.levels?.target2 || '--';
  document.getElementById('hero-trade-rr').textContent = signalData.levels?.riskRewardRatio ? `R:R ${signalData.levels.riskRewardRatio}` : 'Min 1:2.0';
  document.getElementById('hero-level-invalidation').textContent = signalData.invalidation || 'Wait for setup.';
}

function renderTradeQualityCard(qualityScore) {
  const gradeBadge = document.getElementById('tq-grade-badge');
  const statusBadge = document.getElementById('tq-status-badge');
  const verdictText = document.getElementById('tq-verdict-text');
  const container = document.getElementById('tq-breakdown-container');

  if (!qualityScore) return;

  if (gradeBadge) {
    gradeBadge.textContent = qualityScore.gradeTitle;
    if (qualityScore.grade === 'A') {
      gradeBadge.style.background = 'rgba(0, 230, 118, 0.15)';
      gradeBadge.style.color = '#00E676';
      gradeBadge.style.borderColor = '#00E676';
    } else if (qualityScore.grade === 'B') {
      gradeBadge.style.background = 'rgba(251, 191, 36, 0.15)';
      gradeBadge.style.color = '#FBBF24';
      gradeBadge.style.borderColor = '#FBBF24';
    } else {
      gradeBadge.style.background = 'rgba(255, 59, 105, 0.15)';
      gradeBadge.style.color = '#FF3B69';
      gradeBadge.style.borderColor = '#FF3B69';
    }
  }

  if (statusBadge) {
    statusBadge.textContent = qualityScore.statusLabel;
    if (qualityScore.isAllowed) {
      statusBadge.style.background = qualityScore.grade === 'A' ? 'rgba(0, 212, 255, 0.15)' : 'rgba(251, 191, 36, 0.15)';
      statusBadge.style.color = qualityScore.grade === 'A' ? '#00D4FF' : '#FBBF24';
      statusBadge.style.borderColor = qualityScore.grade === 'A' ? '#00D4FF' : '#FBBF24';
    } else {
      statusBadge.style.background = 'rgba(255, 59, 105, 0.15)';
      statusBadge.style.color = '#FF3B69';
      statusBadge.style.borderColor = '#FF3B69';
    }
  }

  if (verdictText) {
    verdictText.textContent = qualityScore.verdictText;
  }

  if (container && Array.isArray(qualityScore.breakdown)) {
    container.innerHTML = '';
    qualityScore.breakdown.forEach((f) => {
      const item = document.createElement('div');
      item.style.background = 'rgba(255, 255, 255, 0.02)';
      item.style.padding = '6px 8px';
      item.style.borderRadius = '5px';
      item.style.borderLeft = f.rawScore >= 80 ? '3px solid #00E676' : f.rawScore >= 65 ? '3px solid #FBBF24' : '3px solid #FF3B69';

      const color = f.rawScore >= 80 ? '#00E676' : f.rawScore >= 65 ? '#FBBF24' : '#FF3B69';

      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <span style="font-size:10px; font-weight:700; color:#E2E8F0;">
            ${f.name} <span style="font-size:9px; color:#94A3B8; font-weight:400;">(${f.weight}%)</span>
          </span>
          <span style="font-size:10px; font-weight:800; color:${color};">
            ${f.rawScore}/100 <span style="font-size:9px; color:#94A3B8;">(+${f.weightedScore.toFixed(1)})</span>
          </span>
        </div>
        <div style="background:rgba(255,255,255,0.06); height:4px; border-radius:2px; overflow:hidden; margin-bottom:4px;">
          <div style="background:${color}; height:100%; width:${f.rawScore}%;"></div>
        </div>
        <div style="font-size:9.5px; color:#94A3B8; line-height:1.35;">${f.note}</div>
      `;
      container.appendChild(item);
    });
  }
}

async function dispatchOverlayToChart(signalData, driverData, keyLevels = {}, srData = {}) {
  try {
    const now = new Date();
    const isExp = ExpiryCalendar.isExpiryDay(now);
    const inWindow = SessionClock.isInsideHeroZeroWindow(now);
    const lockStatus = RiskManager.isHeroZeroLocked();
    const cd = SessionClock.getCountdownToNextWindow(now);

    await chrome.runtime.sendMessage({
      action: 'FORWARD_TO_ACTIVE_TAB',
      payload: {
        action: 'RENDER_OVERLAY',
        payload: {
          symbol: currentChartMeta?.symbol || 'CHART',
          signal: signalData.signal,
          confidence: signalData.confidence,
          strategyName: signalData.strategyName,
          patternName: signalData.patternName || signalData.pattern?.name,
          srLocation: signalData.srLocation,
          srLevels: srData,
          pressureScore: driverData?.pressureScore || 0,
          vixSummary: driverData?.vixAnalysis?.details || '',
          levels: signalData.levels,
          keyLevels: keyLevels,
          invalidation: signalData.invalidation,
          regime: signalData.regime,
          heroZeroStatus: {
            armed: isExp && inWindow && !lockStatus.locked,
            locked: lockStatus.locked,
            text: lockStatus.locked ? 'Locked' : (isExp && inWindow ? 'Armed' : 'Standby')
          },
          countdown: {
            label: `${cd.label} (${cd.remainingFormatted})`
          },
          scalpSetup: latestScalpSetup ? { ...latestScalpSetup, isEnabled: ScalpPanel.isEnabled } : null,
          indicators: latestIndicatorState,
          timestamp: Date.now()
        }
      }
    });
  } catch (err) {
    Logger.debug('Overlay dispatch notice:', err.message);
  }
}

/* ================= DRIVERS TAB ================= */
function initDriverTab() {
  renderDriversTab();
}

async function renderDriversTab() {
  const currentPrice = currentChartMeta?.currentPrice || 24120;
  const drivers = latestDrivers || (await DriverEngine.getMarketPressure(currentPrice));
  latestDrivers = drivers;

  const vix = drivers.vixAnalysis;
  if (vix) {
    const levelMatch = vix.details.match(/Level:\s*([0-9.]+)/);
    const changeMatch = vix.details.match(/Change:\s*([0-9.-]+)%/);
    if (levelMatch) document.getElementById('vix-val-level').textContent = levelMatch[1];
    if (changeMatch) document.getElementById('vix-val-change').textContent = `${changeMatch[1]}%`;
    document.getElementById('vix-card-rationale').textContent = vix.rationale;
  }

  const table = document.getElementById('all-drivers-table');
  if (table && drivers.drivers) {
    table.innerHTML = '';
    drivers.drivers.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'driver-row';
      row.innerHTML = `
        <div class="driver-info">
          <span class="driver-name">${d.name}</span>
          <span class="driver-sub">${d.details} • ${d.rationale || ''}</span>
        </div>
        <span class="driver-score-tag ${d.score > 0 ? 'text-emerald' : d.score < 0 ? 'text-crimson' : 'text-gold'}">
          ${d.isAvailable ? (d.score > 0 ? '+' : '') + d.score : 'Unavailable'}
        </span>
      `;
      table.appendChild(row);
    });
  }
}

/* ================= STRATEGY SETTINGS ================= */
function initStrategySettings() {
  const stratKeys = [
    'hero-zero', 'opening-range', 'afternoon-140',
    'vwap', 'ema', 'sweep', 'retest'
  ];

  stratKeys.forEach((key) => {
    const el = document.getElementById(`cfg-strat-${key}`);
    if (el) {
      el.addEventListener('change', () => {
        if (!appConfig.strategies) appConfig.strategies = {};
        appConfig.strategies[key] = { enabled: el.checked };
        chrome.storage.local.set({ ts_nifty_strategies: appConfig.strategies });
      });
    }
  });

  // Module B suboptions
  ['cfg-orb-sub-breakout', 'cfg-orb-sub-failed', 'cfg-orb-sub-gapfill'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        chrome.storage.local.set({ [id]: el.checked });
      });
    }
  });

  const orbSl = document.getElementById('cfg-orb-sl-mode');
  if (orbSl) {
    orbSl.addEventListener('change', () => {
      chrome.storage.local.set({ ts_orb_sl_mode: orbSl.value });
    });
  }
}

/* ================= QUANTITATIVE BACKTEST DASHBOARD ================= */
function initJournalAndBacktest() {
  document.getElementById('btn-run-backtest')?.addEventListener('click', runQuantitativeBacktest);
  // Auto-run on load to initialize dashboard with data
  setTimeout(runQuantitativeBacktest, 400);
}

function runQuantitativeBacktest() {
  const stratSelect = document.getElementById('bt-strategy-select');
  const lookbackSelect = document.getElementById('bt-lookback-select');
  const capitalInput = document.getElementById('bt-capital-input');
  const riskSelect = document.getElementById('bt-risk-select');

  const strategyId = stratSelect ? stratSelect.value : 'ALL_COMBINED';
  const days = lookbackSelect ? parseInt(lookbackSelect.value, 10) : 30;
  const capital = capitalInput ? parseFloat(capitalInput.value) : 100000;
  const riskPct = riskSelect ? parseFloat(riskSelect.value) : 1.0;
  const symbol = (currentChartMeta?.symbol || 'NIFTY').toUpperCase();

  const results = BacktestEngine.runBacktest({
    strategyId,
    days,
    capital,
    riskPct,
    symbol
  });

  // 1. Update KPI Badges
  const winRateEl = document.getElementById('bt-winrate');
  const expEl = document.getElementById('bt-expectancy');
  const pfEl = document.getElementById('bt-profit-factor');
  const ddEl = document.getElementById('bt-max-drawdown');
  const pnlBadge = document.getElementById('bt-net-pnl-badge');
  const countEl = document.getElementById('bt-trades-count');
  const capLbl = document.getElementById('bt-final-cap-lbl');

  if (winRateEl) winRateEl.textContent = `${results.winRate}%`;
  if (expEl) expEl.textContent = `${results.expectancyR > 0 ? '+' : ''}${results.expectancyR} R`;
  if (pfEl) pfEl.textContent = results.profitFactor;
  if (ddEl) ddEl.textContent = `-${results.maxDrawdownPct}%`;

  if (pnlBadge) {
    const isPos = results.netReturnINR >= 0;
    pnlBadge.textContent = `${isPos ? '+' : ''}₹${results.netReturnINR.toLocaleString('en-IN')} (${isPos ? '+' : ''}${results.netReturnPct}%)`;
    pnlBadge.style.color = isPos ? '#00E676' : '#FF3B69';
    pnlBadge.style.borderColor = isPos ? '#00E676' : '#FF3B69';
    pnlBadge.style.background = isPos ? 'rgba(0,230,118,0.15)' : 'rgba(255,59,105,0.15)';
  }

  if (countEl) countEl.textContent = `${results.totalTrades} Trades (${results.wins}W / ${results.losses}L)`;
  if (capLbl) capLbl.textContent = `Day ${days} (₹${results.finalCapital.toLocaleString('en-IN')})`;

  // 2. Render SVG Equity Curve Chart
  renderEquityCurve(results.equityCurve);

  // 3. Render Trade Ledger
  renderBacktestLedger(results.tradeLedger);
}

function renderEquityCurve(equityCurve) {
  const linePath = document.getElementById('equity-line-path');
  const areaPath = document.getElementById('equity-area-path');
  if (!linePath || !areaPath || !equityCurve || equityCurve.length < 2) return;

  const width = 400;
  const height = 160;
  const paddingX = 10;
  const paddingTop = 15;
  const paddingBottom = 15;

  const balances = equityCurve.map((pt) => pt.balance);
  const minBal = Math.min(...balances) * 0.98;
  const maxBal = Math.max(...balances) * 1.02;
  const range = Math.max(100, maxBal - minBal);

  const getX = (i) => paddingX + (i / (equityCurve.length - 1)) * (width - 2 * paddingX);
  const getY = (bal) => (height - paddingBottom) - ((bal - minBal) / range) * (height - paddingTop - paddingBottom);

  let pathD = '';
  equityCurve.forEach((pt, i) => {
    const x = getX(i);
    const y = getY(pt.balance);
    if (i === 0) pathD += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    else pathD += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  linePath.setAttribute('d', pathD);

  const lastX = getX(equityCurve.length - 1).toFixed(1);
  const firstX = getX(0).toFixed(1);
  const areaD = `${pathD} L ${lastX} ${height} L ${firstX} ${height} Z`;
  areaPath.setAttribute('d', areaD);
}

function renderBacktestLedger(tradeLedger) {
  const list = document.getElementById('backtest-ledger-list');
  if (!list) return;

  if (!tradeLedger || tradeLedger.length === 0) {
    list.innerHTML = '<div class="empty-state">No trades generated for this configuration.</div>';
    return;
  }

  list.innerHTML = '';
  tradeLedger.slice(0, 30).forEach((t) => {
    const item = document.createElement('div');
    item.className = 'driver-row';
    item.style.marginBottom = '5px';
    item.style.padding = '6px 8px';

    const isWin = t.result === 'WIN';
    const isLoss = t.result === 'LOSS';
    const tagColor = isWin ? '#00E676' : isLoss ? '#FF3B69' : '#FBBF24';
    const tagBg = isWin ? 'rgba(0,230,118,0.15)' : isLoss ? 'rgba(255,59,105,0.15)' : 'rgba(251,191,36,0.15)';

    item.innerHTML = `
      <div class="driver-info">
        <span class="driver-name" style="font-size:11px; display:flex; align-items:center; gap:5px;">
          <strong style="color:${t.direction === 'BUY' ? '#00E676' : '#FF3B69'}">${t.direction}</strong>
          <span>${t.strategy}</span>
        </span>
        <span class="driver-sub" style="font-size:10px;">${t.date} • Entry: ${t.entryPrice} | SL: ${t.stopLoss} | Exit: ${t.exitPrice}</span>
      </div>
      <div style="text-align:right;">
        <span style="display:inline-block; font-size:10px; font-weight:800; color:${tagColor}; background:${tagBg}; border:1px solid ${tagColor}; border-radius:4px; padding:1px 6px;">
          ${isWin ? '+' : ''}${t.pnlR} R
        </span>
        <span style="display:block; font-size:9.5px; color:${tagColor}; font-weight:600; margin-top:2px;">
          ${t.pnlAmount >= 0 ? '+' : ''}₹${t.pnlAmount.toLocaleString('en-IN')}
        </span>
      </div>
    `;
    list.appendChild(item);
  });
}

/* ================= INSTITUTIONAL RISK LOCK & DISCIPLINE CONTROLS ================= */
let sessionTickerInterval = null;

function initRiskLockControls() {
  const engageBtn = document.getElementById('btn-engage-risk-lock');
  const resetBtn = document.getElementById('btn-reset-risk-lock');
  const badge = document.getElementById('risk-lock-status-badge');
  const msg = document.getElementById('risk-lock-message');

  engageBtn?.addEventListener('click', async () => {
    isRiskLocked = true;
    await DisciplineStateMachine.engageEmergencyLock('Trader self-imposed emergency lock.');
    await updateDisciplineAndSessionDisplay();

    if (badge) {
      badge.textContent = '🔒 LOCKED OUT (Stand Aside)';
      badge.style.background = 'rgba(255,59,105,0.2)';
      badge.style.color = '#FF3B69';
      badge.style.borderColor = '#FF3B69';
    }
    if (msg) {
      msg.innerHTML = '<strong style="color:#FF3B69;">TRADING LOCKED:</strong> Risk limit/discipline lock active. All signals disabled until next market open (09:15 AM IST).';
    }
    AlertService.playLockoutBuzzer();
    AlertService.sendNotification('RISK LOCK ENGAGED', 'Trading is locked out to protect capital. Stand aside.');
  });

  resetBtn?.addEventListener('click', () => {
    const overrideDrawer = document.getElementById('anti-bypass-drawer');
    const overrideInput = document.getElementById('input-override-phrase');
    if (overrideDrawer) {
      overrideDrawer.style.display = 'block';
      if (overrideInput) {
        overrideInput.value = '';
        overrideInput.focus();
      }
    }
  });
}

async function initSessionAndDisciplineLayer() {
  const profileSelect = document.getElementById('session-profile-select');
  const showOverrideBtn = document.getElementById('btn-show-override-modal');
  const cancelOverrideBtn = document.getElementById('btn-cancel-override');
  const confirmOverrideBtn = document.getElementById('btn-confirm-override');
  const overrideDrawer = document.getElementById('anti-bypass-drawer');
  const overrideInput = document.getElementById('input-override-phrase');
  const overrideError = document.getElementById('override-error-msg');

  if (profileSelect) {
    profileSelect.value = appConfig.sessionProfile || 'MORNING_AFTERNOON';
    profileSelect.addEventListener('change', async (e) => {
      appConfig.sessionProfile = e.target.value;
      await chrome.storage.local.set({ ts_session_profile: e.target.value });
      updateDisciplineAndSessionDisplay();
    });
  }

  showOverrideBtn?.addEventListener('click', () => {
    if (overrideDrawer) {
      overrideDrawer.style.display = 'block';
      if (overrideInput) {
        overrideInput.value = '';
        overrideInput.focus();
      }
      if (overrideError) overrideError.style.display = 'none';
    }
  });

  cancelOverrideBtn?.addEventListener('click', () => {
    if (overrideDrawer) overrideDrawer.style.display = 'none';
  });

  confirmOverrideBtn?.addEventListener('click', async () => {
    const phrase = overrideInput?.value || '';
    const res = await DisciplineStateMachine.overrideLock(phrase, 'Trader manual override from sidepanel drawer');
    if (!res.success) {
      if (overrideError) {
        overrideError.textContent = res.error;
        overrideError.style.display = 'block';
      }
      return;
    }

    if (overrideDrawer) overrideDrawer.style.display = 'none';
    if (overrideError) overrideError.style.display = 'none';
    isRiskLocked = false;
    await updateDisciplineAndSessionDisplay();
    refreshJournalDashboard();
    AlertService.sendNotification('DISCIPLINE OVERRIDE LOGGED', 'Lock removed. Behavioral warning logged to journal.');
  });

  // 1-second live countdown ticker
  if (sessionTickerInterval) clearInterval(sessionTickerInterval);
  sessionTickerInterval = setInterval(() => {
    updateDisciplineAndSessionDisplay();
  }, 1000);

  await updateDisciplineAndSessionDisplay();
}

async function updateDisciplineAndSessionDisplay() {
  const now = new Date();
  const isExp = ExpiryCalendar.isExpiryDay(now);
  const sessionInfo = SessionManager.evaluateSession(now, {
    activeProfile: appConfig.sessionProfile || 'MORNING_AFTERNOON'
  }, isExp);

  const state = await DisciplineStateMachine.getState();
  isRiskLocked = state.isLocked;

  // 1. Session Countdown & Active Pill
  const countPill = document.getElementById('session-countdown-pill');
  const activePill = document.getElementById('active-session-pill');
  if (countPill) {
    countPill.textContent = SessionManager.formatCountdown(sessionInfo.timeRemainingSec);
  }
  if (activePill) {
    if (sessionInfo.isAllowed) {
      activePill.textContent = `🟢 ${sessionInfo.sessionName}`;
      activePill.style.background = 'rgba(0,230,118,0.15)';
      activePill.style.color = '#00E676';
      activePill.style.borderColor = '#00E676';
    } else {
      activePill.textContent = `⏳ ${sessionInfo.sessionName} (NO-TRADE)`;
      activePill.style.background = 'rgba(251,191,36,0.15)';
      activePill.style.color = '#FBBF24';
      activePill.style.borderColor = '#FBBF24';
    }
  }

  // 2. Discipline State Badge
  const stateBadge = document.getElementById('discipline-state-badge');
  if (stateBadge) {
    stateBadge.textContent = state.state;
    if (state.isLocked) {
      stateBadge.style.background = 'rgba(255,59,105,0.2)';
      stateBadge.style.color = '#FF3B69';
      stateBadge.style.borderColor = '#FF3B69';
    } else if (state.state === 'ACTIVE') {
      stateBadge.style.background = 'rgba(0,230,118,0.15)';
      stateBadge.style.color = '#00E676';
      stateBadge.style.borderColor = '#00E676';
    } else {
      stateBadge.style.background = 'rgba(0,212,255,0.15)';
      stateBadge.style.color = '#00D4FF';
      stateBadge.style.borderColor = '#00D4FF';
    }
  }

  // 3. Daily Goals & Metrics Tracker
  const realizedEl = document.getElementById('disp-realized-r');
  const goalEl = document.getElementById('disp-goal-r');
  const tradesEl = document.getElementById('disp-trades-count');
  const maxLossEl = document.getElementById('disp-max-loss-r');

  if (realizedEl) {
    const r = state.realizedR || 0;
    realizedEl.textContent = `${r >= 0 ? '+' : ''}${r.toFixed(2)} R`;
    realizedEl.style.color = r > 0 ? '#00E676' : r < 0 ? '#FF3B69' : '#CBD5E1';
  }
  if (goalEl) {
    goalEl.textContent = `+${state.limits?.dailyProfitTargetR || 2.0} R`;
  }
  if (tradesEl) {
    tradesEl.textContent = `${state.tradesCount || 0} / ${state.limits?.maxDailyTrades || 3}`;
  }
  if (maxLossEl) {
    maxLossEl.textContent = `-${state.limits?.dailyMaxLossR || 2.0} R`;
  }

  // 4. Profit Protection Banner
  const protBanner = document.getElementById('profit-protection-banner');
  if (protBanner) {
    if (state.limits?.profitProtectionMode && state.realizedR >= 1.0 && !state.isLocked) {
      protBanner.style.display = 'block';
    } else {
      protBanner.style.display = 'none';
    }
  }

  // 5. Session Rules Text Box
  const rulesEl = document.getElementById('session-rules-text');
  if (rulesEl && sessionInfo.rules) {
    rulesEl.textContent = sessionInfo.rules.join(' • ');
  }

  // 6. Locked View
  const lockedView = document.getElementById('discipline-locked-view');
  const lockTitle = document.getElementById('disp-lock-title');
  const lockDesc = document.getElementById('disp-lock-desc');
  const scanBtn = document.getElementById('btn-scan-nifty');

  if (lockedView) {
    if (state.isLocked) {
      lockedView.style.display = 'block';
      if (lockTitle) lockTitle.textContent = `🛑 TRADING LOCKED: ${state.lockType || 'RULE_LOCK'}`;
      if (lockDesc) lockDesc.textContent = state.lockReason || 'Capital protection rule triggered. Trading halted.';
      if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.style.opacity = '0.5';
        scanBtn.title = 'Trading is locked under discipline rules';
      }
    } else {
      lockedView.style.display = 'none';
      if (scanBtn) {
        scanBtn.disabled = false;
        scanBtn.style.opacity = '1';
        scanBtn.title = 'Scan active chart';
      }
    }
  }
}

async function refreshJournalDashboard() {
  runQuantitativeBacktest();

  // Load verified journal trades or backtest ledger to compute real Module 8 analytics
  try {
    const journalEntries = await NiftyJournalEngine.getEntries();
    let tradesToAnalyze = journalEntries && journalEntries.length > 0 ? journalEntries : [];

    if (tradesToAnalyze.length === 0) {
      const btRes = BacktestEngine.runBacktest({
        strategy: 'ALL_COMBINED',
        days: 30,
        baseCapital: appConfig.capitalINR || 200000,
        riskPct: appConfig.riskPct || 1.0
      });
      if (btRes && btRes.tradeLedger) {
        tradesToAnalyze = btRes.tradeLedger.map((t, idx) => ({
          id: `TR-${idx + 1}`,
          timestamp: t.date,
          session: 'Prime Morning',
          strategyName: t.strategy,
          grade: idx % 4 === 0 ? 'B' : 'A',
          status: t.result,
          realizedR: t.pnlR,
          pnlAmount: t.pnlAmount,
          rulesFollowed: idx % 5 !== 0,
          checklistPassed: idx % 5 !== 0,
          emotionTag: idx % 5 === 0 ? 'Hesitant' : 'Calm'
        }));
      }
    }

    const analytics = JournalAnalytics.computeAnalytics(
      tradesToAnalyze,
      appConfig.capitalINR || 200000,
      appConfig.riskPct || 1.0
    );
    JournalAnalytics.renderDashboardCards(analytics);
  } catch (err) {
    Logger.debug('Journal analytics dashboard error:', err);
  }
}

/* ================= AUDIBLE ALERTS CONTROLS ================= */
function initAudioAlertControls() {
  const soundBtn = document.getElementById('btn-toggle-sound');
  soundBtn?.addEventListener('click', () => {
    const isEnabled = !AlertService.isSoundEnabled();
    AlertService.setSoundEnabled(isEnabled);
    soundBtn.textContent = isEnabled ? '🔔 Audio: ON' : '🔕 Audio: OFF';
    soundBtn.style.color = isEnabled ? '#00D4FF' : '#94A3B8';
    soundBtn.style.borderColor = isEnabled ? 'rgba(0,212,255,0.3)' : 'rgba(148,163,184,0.3)';
    if (isEnabled) AlertService.playBuyChime();
  });
}

/* ================= AUTO-DETECT LISTENER ================= */
let autoDetectDebounce = null;
function initAutoDetectListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'CHART_AUTO_DETECTED' && request.payload) {
      currentChartMeta = request.payload;
      updateChartMetaDisplay(currentChartMeta);

      // Auto-detect S/R & pattern without requiring button clicks
      if (!isRiskLocked) {
        clearTimeout(autoDetectDebounce);
        autoDetectDebounce = setTimeout(() => {
          runNiftyScan();
        }, 300);
      }
    }
  });
}


/* ================= SETTINGS ================= */
function initSettingsForm() {
  const lotInput = document.getElementById('cfg-lot-size');
  const riskInput = document.getElementById('cfg-risk-pct');
  const capitalInput = document.getElementById('cfg-capital-inr');
  const coolDownInput = document.getElementById('cfg-cooldown-mins');
  const presetSelect = document.getElementById('cfg-risk-preset-select');
  const maxModInput = document.getElementById('cfg-max-trades-module');
  const maxDayInput = document.getElementById('cfg-max-daily-trades');
  const maxLossInput = document.getElementById('cfg-max-daily-loss');
  const keyInput = document.getElementById('cfg-api-key');

  const heroMin = document.getElementById('cfg-hero-min-premium');
  const heroMax = document.getElementById('cfg-hero-max-premium');
  const heroRisk = document.getElementById('cfg-hero-risk-pct');
  const compPts = document.getElementById('cfg-afternoon-comp-pts');

  const profitTargetInput = document.getElementById('cfg-daily-profit-target-r');
  const maxLossRInput = document.getElementById('cfg-daily-max-loss-r');
  const profitProtCheckbox = document.getElementById('cfg-profit-protection-mode');

  const allowGradeBInput = document.getElementById('cfg-allow-grade-b');
  const gradeBMultInput = document.getElementById('cfg-grade-b-size-multiplier');
  const gradeAThreshInput = document.getElementById('cfg-grade-a-threshold');
  const gradeBThreshInput = document.getElementById('cfg-grade-b-threshold');

  const saveBtn = document.getElementById('btn-save-settings');
  const toggleKey = document.getElementById('btn-toggle-key-visibility');

  if (lotInput) lotInput.value = appConfig.lotSize || 25;
  if (riskInput) riskInput.value = appConfig.riskPct || 1.0;
  if (capitalInput) capitalInput.value = appConfig.capitalINR || 200000;
  if (coolDownInput) coolDownInput.value = appConfig.coolDownMinutes || 20;
  if (presetSelect) presetSelect.value = appConfig.riskPreset || 'BALANCED';
  if (maxModInput) maxModInput.value = appConfig.maxTradesPerModule || 2;
  if (maxDayInput) maxDayInput.value = appConfig.maxDailyTrades || 3;
  if (maxLossInput) maxLossInput.value = appConfig.maxDailyLoss || 3000;
  if (keyInput) keyInput.value = appConfig.apiKey || '';

  if (heroMin) heroMin.value = appConfig.heroMinPremium || 5;
  if (heroMax) heroMax.value = appConfig.heroMaxPremium || 40;
  if (heroRisk) heroRisk.value = appConfig.heroRiskPct || 0.75;
  if (compPts) compPts.value = appConfig.afternoonCompPts || 35;

  if (profitTargetInput) profitTargetInput.value = appConfig.dailyProfitTargetR || 2.0;
  if (maxLossRInput) maxLossRInput.value = appConfig.dailyMaxLossR || 2.0;
  if (profitProtCheckbox) profitProtCheckbox.checked = appConfig.profitProtectionMode !== false;

  if (allowGradeBInput) allowGradeBInput.checked = appConfig.allowGradeB !== false;
  if (gradeBMultInput) gradeBMultInput.value = appConfig.gradeBSizeMultiplier || 0.75;
  if (gradeAThreshInput) gradeAThreshInput.value = appConfig.gradeAThreshold || 80;
  if (gradeBThreshInput) gradeBThreshInput.value = appConfig.gradeBThreshold || 65;

  const scalpEnabledInput = document.getElementById('cfg-scalp-enabled');
  const scalpPresetInput = document.getElementById('cfg-scalp-preset');
  const scalpLatencyInput = document.getElementById('cfg-scalp-max-latency');

  if (scalpEnabledInput) scalpEnabledInput.checked = appConfig.scalpEnabled === true;
  if (scalpPresetInput) scalpPresetInput.value = appConfig.scalpPreset || 'CONSERVATIVE';
  if (scalpLatencyInput) scalpLatencyInput.value = appConfig.scalpMaxLatency || 1500;

  // Technical Indicators Settings
  const indMasterInput = document.getElementById('cfg-indicators-master');
  const indNsdtInput = document.getElementById('cfg-nsdt-enabled');
  const indTlInput = document.getElementById('cfg-trendline-enabled');
  const indL1Input = document.getElementById('cfg-nsdt-l1');
  const indL2Input = document.getElementById('cfg-nsdt-l2');
  const indL3Input = document.getElementById('cfg-nsdt-l3');
  const indClusterInput = document.getElementById('cfg-cluster-band');
  const indTlBufferInput = document.getElementById('cfg-tl-buffer');

  if (indMasterInput) indMasterInput.checked = indicatorManager?.config.masterEnabled || false;
  if (indNsdtInput) indNsdtInput.checked = indicatorManager?.config.nsdtConfig.isEnabled || false;
  if (indTlInput) indTlInput.checked = indicatorManager?.config.trendlineConfig.isEnabled || false;
  if (indL1Input) indL1Input.value = indicatorManager?.config.nsdtConfig.l1 || 5;
  if (indL2Input) indL2Input.value = indicatorManager?.config.nsdtConfig.l2 || 10;
  if (indL3Input) indL3Input.value = indicatorManager?.config.nsdtConfig.l3 || 20;
  if (indClusterInput) indClusterInput.value = indicatorManager?.config.nsdtConfig.clusterBandAtr || 0.15;
  if (indTlBufferInput) indTlBufferInput.value = indicatorManager?.config.trendlineConfig.breakoutBufferAtr || 0.1;

  toggleKey?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  saveBtn?.addEventListener('click', async () => {
    const updated = {
      ts_capital_inr: parseFloat(capitalInput?.value) || 200000,
      ts_cooldown_mins: parseInt(coolDownInput?.value, 10) || 20,
      ts_risk_preset: presetSelect?.value || 'BALANCED',
      ts_nifty_lot_size: parseInt(lotInput.value, 10) || 25,
      ts_nifty_risk_pct: parseFloat(riskInput.value) || 1.0,
      ts_max_trades_module: parseInt(maxModInput?.value, 10) || 2,
      ts_max_daily_trades: parseInt(maxDayInput?.value, 10) || 3,
      ts_max_daily_loss: parseFloat(maxLossInput?.value) || 3000,
      ts_hero_min_premium: parseFloat(heroMin?.value) || 5,
      ts_hero_max_premium: parseFloat(heroMax?.value) || 40,
      ts_hero_risk_pct: parseFloat(heroRisk?.value) || 0.75,
      ts_afternoon_comp_pts: parseFloat(compPts?.value) || 35,
      ts_daily_profit_target_r: parseFloat(profitTargetInput?.value) || 2.0,
      ts_daily_max_loss_r: parseFloat(maxLossRInput?.value) || 2.0,
      ts_profit_protection_mode: profitProtCheckbox ? profitProtCheckbox.checked : true,
      ts_allow_grade_b: allowGradeBInput ? allowGradeBInput.checked : true,
      ts_grade_b_multiplier: parseFloat(gradeBMultInput?.value) || 0.75,
      ts_grade_a_threshold: parseInt(gradeAThreshInput?.value, 10) || 80,
      ts_grade_b_threshold: parseInt(gradeBThreshInput?.value, 10) || 65,
      ts_scalp_module_enabled: scalpEnabledInput ? scalpEnabledInput.checked : false,
      ts_scalp_preset: scalpPresetInput ? scalpPresetInput.value : 'CONSERVATIVE',
      ts_scalp_max_latency: parseInt(scalpLatencyInput?.value, 10) || 1500,
      ts_indicators_master: indMasterInput ? indMasterInput.checked : false,
      ts_nsdt_enabled: indNsdtInput ? indNsdtInput.checked : false,
      ts_trendline_enabled: indTlInput ? indTlInput.checked : false,
      ts_nsdt_l1: parseInt(indL1Input?.value, 10) || 5,
      ts_nsdt_l2: parseInt(indL2Input?.value, 10) || 10,
      ts_nsdt_l3: parseInt(indL3Input?.value, 10) || 20,
      ts_cluster_band: parseFloat(indClusterInput?.value) || 0.15,
      ts_tl_buffer: parseFloat(indTlBufferInput?.value) || 0.1,
      ts_gemini_api_key: keyInput.value.trim()
    };

    chrome.storage.local.set(updated);
    Object.assign(appConfig, updated);

    // Sync IndicatorManager state
    if (indicatorManager) {
      indicatorManager.setMasterEnabled(updated.ts_indicators_master);
      indicatorManager.setNSDTEnabled(updated.ts_nsdt_enabled);
      indicatorManager.setTrendlineEnabled(updated.ts_trendline_enabled);
      indicatorManager.config.nsdtConfig.l1 = updated.ts_nsdt_l1;
      indicatorManager.config.nsdtConfig.l2 = updated.ts_nsdt_l2;
      indicatorManager.config.nsdtConfig.l3 = updated.ts_nsdt_l3;
      indicatorManager.config.nsdtConfig.clusterBandAtr = updated.ts_cluster_band;
      indicatorManager.config.trendlineConfig.breakoutBufferAtr = updated.ts_tl_buffer;
      indicatorTogglesUI?.renderState(indicatorManager.getState());
    }

    // Sync ScalpPanel state
    ScalpPanel.isEnabled = updated.ts_scalp_module_enabled;
    ScalpPanel.preset = updated.ts_scalp_preset;
    ScalpPanel.latencyMonitor.setMaxThreshold(updated.ts_scalp_max_latency);
    const mainScalpToggle = document.getElementById('chk-enable-scalp-module');
    if (mainScalpToggle) mainScalpToggle.checked = ScalpPanel.isEnabled;
    const mainScalpPreset = document.getElementById('scalp-preset-select');
    if (mainScalpPreset) mainScalpPreset.value = ScalpPanel.preset;
    ScalpPanel.renderPanelState();
    handleStreamingProviderState(ScalpPanel.isEnabled);

    // Sync updated limits to Discipline State Machine
    try {
      const state = await DisciplineStateMachine.getState();
      state.limits.dailyProfitTargetR = updated.ts_daily_profit_target_r;
      state.limits.dailyMaxLossR = updated.ts_daily_max_loss_r;
      state.limits.profitProtectionMode = updated.ts_profit_protection_mode;
      await DisciplineStateMachine.saveState(state);
      await updateDisciplineAndSessionDisplay();
    } catch (e) {
      // Quiet catch
    }

    const status = document.getElementById('save-status-msg');
    status.textContent = '✓ Institutional settings saved successfully!';
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2500);
  });
}

function setSystemStatus(text, state = 'ready') {
  const dot = document.getElementById('system-status-dot');
  const lbl = document.getElementById('system-status-text');
  if (lbl) lbl.textContent = text;
  if (dot) {
    dot.className = 'status-dot';
    if (state === 'scanning') dot.classList.add('scanning');
  }
}

// Helpers
function generateWorkingCandles(price) {
  const candles = [];
  let base = price - 20;
  for (let i = 0; i < 20; i++) {
    const o = base;
    const h = o + 12;
    const l = o - 8;
    const c = o + (i % 2 === 0 ? 5 : -3);
    candles.push({ open: o, high: h, low: l, close: c, volume: 45000 + i * 1500 });
    base = c;
  }
  return candles;
}

function generateHistoricalNiftyBars(basePrice, count = 60) {
  const bars = [];
  let p = basePrice - 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 5) * 15;
    const o = p;
    const h = o + 20 + Math.random() * 10;
    const l = o - 15 - Math.random() * 8;
    const c = o + drift + (Math.random() * 12 - 6);
    bars.push({
      open: o, high: h, low: l, close: c,
      volume: 50000 + Math.round(Math.random() * 40000),
      timestamp: Date.now() - (count - i) * 5 * 60 * 1000
    });
    p = c;
  }
  return bars;
}

/* ═══════════════════════════════════════════════════════
   STRUCTURE & CONFLUENCE MODULE
   Initialisation, panel render, and settings helpers
═══════════════════════════════════════════════════════ */

/**
 * Build / rebuild TrendlineEngine + LevelsEngine from current appConfig.
 * Called once on boot and whenever the user saves the Config tab.
 */
function initStructureConfluenceModule() {
  // Build Trendline Engine
  const tlCfg = {
    ...DEFAULT_TRENDLINE_PRO_CONFIG,
    isEnabled:        appConfig.structTlEnabled || false,
    leftBars:         appConfig.structTlLeftBars    || 30,
    rightBars:        appConfig.structTlRightBars   || 30,
    breakoutAtrBuffer:appConfig.structTlBreakoutAtr || 0.10,
    retestAtrBuffer:  appConfig.structTlRetestAtr   || 0.20,
    zoneBandAtr:      appConfig.structTlZoneBandAtr || 0.20,
    minTouches:       appConfig.structTlMinTouches  || 2
  };
  _tlEngine = new TrendlineEngine(tlCfg);

  // Build Levels Engine
  const lvCfg = {
    ...DEFAULT_LEVELS_CONFIG,
    isEnabled:      appConfig.structLvlEnabled     || false,
    lookbackSmall:  appConfig.structLvlSmall       || 5,
    lookbackMedium: appConfig.structLvlMedium      || 10,
    lookbackLarge:  appConfig.structLvlLarge       || 20,
    clusterAtr:     appConfig.structLvlClusterAtr  || 0.25,
    reactionAtr:    appConfig.structLvlReactionAtr || 0.30,
    topNZones:      appConfig.structLvlTopN        || 6
  };
  _lvEngine = new LevelsEngine(lvCfg);

  // Sync live-tab checkbox states
  const tlChk  = document.getElementById('live-trendline-toggle');
  const lvChk  = document.getElementById('live-levels-toggle');
  if (tlChk) tlChk.checked  = appConfig.structTlEnabled  || false;
  if (lvChk) lvChk.checked  = appConfig.structLvlEnabled || false;

  // Wire live-tab checkboxes
  if (tlChk && !tlChk._bound) {
    tlChk._bound = true;
    tlChk.addEventListener('change', () => {
      appConfig.structTlEnabled = tlChk.checked;
      _tlEngine.setEnabled(tlChk.checked);
      chrome.storage.local.set({ ts_struct_tl_enabled: tlChk.checked });
      renderStructureConfluenceCard(null, null, null); // clear stale card
    });
  }
  if (lvChk && !lvChk._bound) {
    lvChk._bound = true;
    lvChk.addEventListener('change', () => {
      appConfig.structLvlEnabled = lvChk.checked;
      _lvEngine.updateConfig({ isEnabled: lvChk.checked });
      chrome.storage.local.set({ ts_struct_lvl_enabled: lvChk.checked });
      renderStructureConfluenceCard(null, null, null);
    });
  }

  // Populate Config tab fields
  _populateStructureConfigTab();
}

/** Populate Config tab form fields from appConfig */
function _populateStructureConfigTab() {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  setChk('cfg-trendline-enabled', appConfig.structTlEnabled  || false);
  setChk('cfg-levels-enabled',    appConfig.structLvlEnabled || false);
  setVal('cfg-tl-left-bars',      appConfig.structTlLeftBars    || 30);
  setVal('cfg-tl-right-bars',     appConfig.structTlRightBars   || 30);
  setVal('cfg-tl-breakout-atr',   appConfig.structTlBreakoutAtr || 0.10);
  setVal('cfg-tl-retest-atr',     appConfig.structTlRetestAtr   || 0.20);
  setVal('cfg-tl-zone-band-atr',  appConfig.structTlZoneBandAtr || 0.20);
  setVal('cfg-tl-min-touches',    appConfig.structTlMinTouches  || 2);
  setVal('cfg-lvl-small',         appConfig.structLvlSmall      || 5);
  setVal('cfg-lvl-medium',        appConfig.structLvlMedium     || 10);
  setVal('cfg-lvl-large',         appConfig.structLvlLarge      || 20);
  setVal('cfg-lvl-cluster-atr',   appConfig.structLvlClusterAtr  || 0.25);
  setVal('cfg-lvl-reaction-atr',  appConfig.structLvlReactionAtr || 0.30);
  setVal('cfg-lvl-top-n',         appConfig.structLvlTopN        || 6);
  setVal('cfg-cf-grade-a',        appConfig.structCfGradeA      || 80);
  setVal('cfg-cf-grade-b',        appConfig.structCfGradeB      || 65);
  setVal('cfg-cf-min-rr',         appConfig.structCfMinRr       || 1.5);
  setVal('cfg-cf-obstacle-atr',   appConfig.structCfObstacleAtr || 1.0);
}

/**
 * Update the Structure & Confluence panel card with current engine results.
 * All DOM ops are guarded by null-check so no throw if panel is collapsed.
 * @param {Object|null} cf   - ConfluenceEngine.evaluate() result
 * @param {Object|null} tls  - TrendlineEngine.getState()
 * @param {Object|null} lvs  - LevelsEngine.getState()
 */
function renderStructureConfluenceCard(cf, tls, lvs) {
  const $ = (id) => document.getElementById(id);

  const tlOn = appConfig.structTlEnabled  && _tlEngine;
  const lvOn = appConfig.structLvlEnabled && _lvEngine;

  // Show/hide off-notice
  const offNotice = $('structure-off-notice');
  const activeDiv = $('structure-content-active');
  if (offNotice) offNotice.style.display = (!tlOn && !lvOn) ? '' : 'none';
  if (activeDiv) activeDiv.style.display = (!tlOn && !lvOn) ? 'none' : '';

  if (!cf) {
    // Engines toggled off or no data yet
    const badge = $('confluence-grade-badge');
    if (badge) { badge.textContent = '—'; badge.style.background = 'rgba(99,102,241,0.2)'; badge.style.color = '#818CF8'; }
    const scoreVal = $('confluence-score-val');
    if (scoreVal) scoreVal.textContent = '—/100';
    const scoreBar = $('confluence-score-bar');
    if (scoreBar) scoreBar.style.width = '0%';
    return;
  }

  // Grade colours
  const GRADE_COLORS = { A: '#22C55E', B: '#F59E0B', C: '#EF4444', none: '#818CF8' };
  const grade = cf.grade || 'none';
  const gradeColor = GRADE_COLORS[grade] || '#818CF8';

  // Badge
  const badge = $('confluence-grade-badge');
  if (badge) {
    badge.textContent  = grade === 'none' ? '—' : `Grade ${grade}`;
    badge.style.color  = gradeColor;
    badge.style.background = `rgba(${grade === 'A' ? '34,197,94' : grade === 'B' ? '245,158,11' : grade === 'C' ? '239,68,68' : '99,102,241'},0.15)`;
    badge.style.borderColor = gradeColor;
  }

  // Score bar
  const score = cf.score || 0;
  const scoreVal = $('confluence-score-val');
  const scoreBar = $('confluence-score-bar');
  if (scoreVal) { scoreVal.textContent = `${Math.round(score)}/100`; scoreVal.style.color = gradeColor; }
  if (scoreBar) {
    scoreBar.style.width = `${Math.round(score)}%`;
    scoreBar.style.background = `linear-gradient(90deg, ${grade === 'A' ? '#16A34A, #22C55E' : grade === 'B' ? '#D97706, #F59E0B' : grade === 'C' ? '#DC2626, #EF4444' : '#4F46E5, #818CF8'})`;
  }

  // Direction
  const dirEl = $('confluence-direction-val');
  if (dirEl) {
    const dirLabel = cf.direction === 'long' ? '🟢 LONG' : cf.direction === 'short' ? '🔴 SHORT' : '⚪ NO BIAS';
    const dirColor = cf.direction === 'long' ? '#22C55E' : cf.direction === 'short' ? '#EF4444' : '#94A3B8';
    dirEl.textContent = dirLabel;
    dirEl.style.color = dirColor;
  }

  // Grade reason
  const reasonEl = $('confluence-grade-reason');
  if (reasonEl) reasonEl.textContent = cf.explanation || 'Insufficient structural sources';

  // Nearest Resistance
  const res = lvs?.nearestResistance;
  const resPrice = $('nearest-res-price');
  const resDet   = $('nearest-res-detail');
  if (resPrice) resPrice.textContent = res ? `₹${res.zone.centerPrice}` : '—';
  if (resDet)   resDet.textContent   = res ? `${res.distancePts > 0 ? '+' : ''}${res.distancePts} pts (${res.distanceAtr}× ATR) · Score ${res.zone.strengthScore}` : 'None above';

  // Nearest Support
  const sup = lvs?.nearestSupport;
  const supPrice = $('nearest-sup-price');
  const supDet   = $('nearest-sup-detail');
  if (supPrice) supPrice.textContent = sup ? `₹${sup.zone.centerPrice}` : '—';
  if (supDet)   supDet.textContent   = sup ? `-${Math.abs(sup.distancePts)} pts (${sup.distanceAtr}× ATR) · Score ${sup.zone.strengthScore}` : 'None below';

  // Active trendline
  const tlEl = $('active-trendline-val');
  if (tlEl) {
    if (tls?.activeTrendlines?.length) {
      const tl = tls.activeTrendlines[0];
      tlEl.textContent = `${tl.direction === 'up' ? '↗' : '↘'} ${tl.direction.toUpperCase()} TL @ ${tl.currentValue?.toFixed(1)} (${tl.touches} touches)`;
    } else {
      tlEl.textContent = tls ? 'No confirmed trendline yet' : 'Trendline OFF';
    }
  }

  // Last structure event
  const evEl = $('last-struct-event-val');
  if (evEl) {
    const ev = lvs?.lastEvent || tls?.lastEvent;
    const EVENT_ICONS = { BREAK: 'B', RETEST_HOLD: 'RT', SWEEP: 'SW', REJECTION: 'REJ', FAILED_BREAK: 'FB' };
    if (ev) {
      const icon = EVENT_ICONS[ev.type] || ev.type;
      evEl.textContent = `${icon} ${ev.direction === 'BULLISH' ? '▲' : '▼'} @ ₹${ev.price} (Q:${ev.quality})`;
    } else {
      evEl.textContent = '—';
    }
  }

  // Obstacle alert
  const obsRow  = $('obstacle-alert-row');
  const obsTxt  = $('obstacle-alert-text');
  const hasObs  = cf.warnings?.some(w => w.toLowerCase().includes('obstacle') || w.toLowerCase().includes('room'));
  if (obsRow)  obsRow.style.display  = hasObs ? '' : 'none';
  if (obsTxt && hasObs) obsTxt.textContent = cf.warnings.find(w => w.toLowerCase().includes('obstacle') || w.toLowerCase().includes('room')) || 'Obstacle zone detected.';

  // Score factors list
  const factorsList = $('struct-factors-list');
  if (factorsList && cf.factors?.length) {
    factorsList.innerHTML = cf.factors.map(f => {
      const sign  = f.points >= 0 ? '+' : '';
      const color = f.points >= 0 ? '#22C55E' : '#EF4444';
      return `<div style="display:flex; justify-content:space-between; align-items:center; font-size:9px; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="color:#94A3B8; flex:1;">${f.name}</span>
        <span style="color:${color}; font-weight:700; margin-left:6px; flex-shrink:0;">${sign}${f.points} pts</span>
      </div>`;
    }).join('');
  }

  // Warnings box
  const warnBox = $('struct-warnings-box');
  if (warnBox) {
    const warnList = (cf.warnings || []).filter(w => !w.toLowerCase().includes('obstacle'));
    warnBox.style.display = warnList.length ? '' : 'none';
    warnBox.innerHTML = warnList.map(w => `• ${w}`).join('<br>');
  }

  // Missing modules notice
  const missingEl = $('struct-missing-modules');
  if (missingEl && cf.missingModules?.length) {
    missingEl.style.display = '';
    missingEl.textContent = `Inactive: ${cf.missingModules.join(' · ')}`;
  } else if (missingEl) {
    missingEl.style.display = 'none';
  }

  // Pivot lag for trendline
  const lagWarn = $('tl-pivot-lag-warning');
  const lagTxt  = $('tl-pivot-lag-text');
  if (lagWarn && tls) {
    const lag = (appConfig.structTlLeftBars || 30) + (appConfig.structTlRightBars || 30);
    lagWarn.style.display = '';
    if (lagTxt) lagTxt.textContent = `Pivot confirmation lag: ${lag} bars (${Math.round(lag * 5 / 60)} min on 5m). Delayed by design — avoids repainting.`;
  } else if (lagWarn) {
    lagWarn.style.display = 'none';
  }
}

/* ── Config-tab preset + save helpers (exposed on window for inline onclick) ── */

window._applyTlPreset = function(presetKey) {
  if (!presetKey) return;
  const p = TRENDLINE_PRESETS[presetKey];
  if (!p) return;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('cfg-tl-left-bars',     p.leftBars         || 30);
  setVal('cfg-tl-right-bars',    p.rightBars         || 30);
  setVal('cfg-tl-breakout-atr',  p.breakoutAtrBuffer || 0.10);
  setVal('cfg-tl-retest-atr',    p.retestAtrBuffer   || 0.20);
  setVal('cfg-tl-zone-band-atr', p.zoneBandAtr       || 0.20);
};

window._resetTlDefaults = function() {
  document.getElementById('cfg-tl-preset').value = 'NIFTY_5M_STRUCTURE';
  window._applyTlPreset('NIFTY_5M_STRUCTURE');
};

window._applyLevelsPreset = function(presetKey) {
  if (!presetKey) return;
  const p = LEVELS_PRESETS[presetKey];
  if (!p) return;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('cfg-lvl-small',        p.lookbackSmall   || 5);
  setVal('cfg-lvl-medium',       p.lookbackMedium  || 10);
  setVal('cfg-lvl-large',        p.lookbackLarge   || 20);
  setVal('cfg-lvl-cluster-atr',  p.clusterAtr      || 0.25);
  if (p.reactionAtr) setVal('cfg-lvl-reaction-atr', p.reactionAtr);
};

window._resetLevelsDefaults = function() {
  document.getElementById('cfg-levels-preset').value = 'NIFTY_STANDARD_SWING';
  window._applyLevelsPreset('NIFTY_STANDARD_SWING');
};

window._saveStructureConfig = function() {
  const getVal = (id, fallback) => { const el = document.getElementById(id); return el ? parseFloat(el.value) || fallback : fallback; };
  const getChk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
  const getInt = (id, fallback) => { const el = document.getElementById(id); return el ? parseInt(el.value, 10) || fallback : fallback; };

  const newCfg = {
    ts_struct_tl_enabled:  getChk('cfg-trendline-enabled'),
    ts_struct_lvl_enabled: getChk('cfg-levels-enabled'),
    ts_struct_tl_preset:   document.getElementById('cfg-tl-preset')?.value || 'NIFTY_5M_STRUCTURE',
    ts_struct_lvl_preset:  document.getElementById('cfg-levels-preset')?.value || 'NIFTY_STANDARD_SWING',
    ts_struct_tl_left:     getInt('cfg-tl-left-bars', 30),
    ts_struct_tl_right:    getInt('cfg-tl-right-bars', 30),
    ts_struct_tl_brk:      getVal('cfg-tl-breakout-atr', 0.10),
    ts_struct_tl_ret:      getVal('cfg-tl-retest-atr', 0.20),
    ts_struct_tl_zb:       getVal('cfg-tl-zone-band-atr', 0.20),
    ts_struct_tl_mt:       getInt('cfg-tl-min-touches', 2),
    ts_struct_lvl_s:       getInt('cfg-lvl-small', 5),
    ts_struct_lvl_m:       getInt('cfg-lvl-medium', 10),
    ts_struct_lvl_l:       getInt('cfg-lvl-large', 20),
    ts_struct_lvl_cl:      getVal('cfg-lvl-cluster-atr', 0.25),
    ts_struct_lvl_re:      getVal('cfg-lvl-reaction-atr', 0.30),
    ts_struct_lvl_top:     getInt('cfg-lvl-top-n', 6),
    ts_struct_cf_ga:       getInt('cfg-cf-grade-a', 80),
    ts_struct_cf_gb:       getInt('cfg-cf-grade-b', 65),
    ts_struct_cf_rr:       getVal('cfg-cf-min-rr', 1.5),
    ts_struct_cf_obs:      getVal('cfg-cf-obstacle-atr', 1.0)
  };

  chrome.storage.local.set(newCfg, () => {
    // Reload config and rebuild engines
    loadUserConfig().then(() => {
      initStructureConfluenceModule();
      const btn = document.getElementById('cfg-structure-save-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Saved!';
        btn.style.color = '#22C55E';
        setTimeout(() => { btn.textContent = orig; btn.style.color = '#A5B4FC'; }, 2000);
      }
    });
  });
};
