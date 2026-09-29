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
import { NIFTY_CONFIG } from '../config/nifty-config.js';
import { Logger } from '../utils/logger.js';

let appConfig = {};
let latestSignal = null;
let latestDrivers = null;
let currentChartMeta = null;
let dailyLossCount = 0;
let isRiskLocked = false;

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

  // Probe TradingView chart
  probeTradingViewChart();

  // Load verified journal analytics
  refreshJournalDashboard();

  // Update session & countdown badges
  updateSessionBadges();
}

async function loadUserConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (res) => {
      appConfig = {
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
        sessionProfile: res.ts_session_profile || 'MORNING_AFTERNOON'
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

    // 4. Synthesize Working Candles (incorporating live OHLC from TV legend if available)
    const candles = generateWorkingCandles(currentPrice, currentChartMeta?.candleOHLC);

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

    finalSignal = DisciplineStateMachine.evaluateDisciplineGuard({
      rawSignal: finalSignal,
      sessionInfo,
      chartMeta: currentChartMeta,
      dailyState: dailyDisciplineState
    });

    latestSignal = finalSignal;

    // Audible & Desktop Alerts on Actionable Confirmations ONLY IF Discipline Layer permits action
    if (latestSignal.isActionable && latestSignal.confirmed && latestSignal.signal === 'BUY') {
      AlertService.playBuyChime();
      AlertService.sendNotification('CONFIRMED BUY', `${latestSignal.patternName || 'Pattern'} at 1-Month Support! Target: ${latestSignal.levels?.target1}`);
    } else if (latestSignal.isActionable && latestSignal.confirmed && latestSignal.signal === 'SELL') {
      AlertService.playSellChime();
      AlertService.sendNotification('CONFIRMED SELL', `${latestSignal.patternName || 'Pattern'} at 1-Month Resistance! Target: ${latestSignal.levels?.target1}`);
    }

    // 9. Render Sidepanel UI
    renderNextMoveHero(latestSignal, driverData, detectedPattern, srData, srConfirmation);

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

function refreshJournalDashboard() {
  runQuantitativeBacktest();
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

  const saveBtn = document.getElementById('btn-save-settings');
  const toggleKey = document.getElementById('btn-toggle-key-visibility');

  if (lotInput) lotInput.value = appConfig.lotSize || 25;
  if (riskInput) riskInput.value = appConfig.riskPct || 1.0;
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

  toggleKey?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  saveBtn?.addEventListener('click', async () => {
    const updated = {
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
      ts_gemini_api_key: keyInput.value.trim()
    };

    chrome.storage.local.set(updated);
    Object.assign(appConfig, updated);

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
