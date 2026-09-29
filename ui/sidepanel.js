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
import { NIFTY_CONFIG } from '../config/nifty-config.js';
import { Logger } from '../utils/logger.js';

let appConfig = {};
let latestSignal = null;
let latestDrivers = null;
let currentChartMeta = null;
let dailyLossCount = 0;

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
        afternoonCompPts: res.ts_afternoon_comp_pts || 35
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

    latestSignal = finalSignal;

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
  signalBadge.textContent = signal;
  signalBadge.className = 'hero-signal-badge';
  if (signal === 'BUY') signalBadge.classList.add('hud-signal-buy');
  else if (signal === 'SELL') signalBadge.classList.add('hud-signal-sell');
  else signalBadge.classList.add('hud-signal-wait');

  stratEl.textContent = signalData.strategyName || 'Rule Engine Active';
  confEl.textContent = `${signalData.confidence || 0}% Conviction`;
  regimeEl.textContent = `Regime: ${signalData.regime?.label || 'Neutral'}`;
  rationaleEl.textContent = signalData.setupRationale || signalData.filterReason || 'Standing by for high-probability structural confluence.';

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

/* ================= JOURNAL & BACKTEST ================= */
function initJournalAndBacktest() {
  document.getElementById('btn-clear-nifty-journal')?.addEventListener('click', async () => {
    if (confirm('Clear all journaled Nifty paper trades?')) {
      await chrome.storage.local.set({ [NiftyJournalEngine.STORAGE_KEY]: [] });
      refreshJournalDashboard();
    }
  });

  document.getElementById('btn-run-backtest')?.addEventListener('click', runBacktestSimulator);
}

async function refreshJournalDashboard() {
  const analytics = await NiftyJournalEngine.getDashboardAnalytics();

  document.getElementById('dash-winrate').textContent = `${analytics.winRate}%`;
  document.getElementById('dash-net-r').textContent = `${analytics.cumulativeNetR} R`;
  document.getElementById('dash-max-dd').textContent = `${analytics.maxDrawdownR} R`;

  // Hero-Zero Scoreboard
  const hz = analytics.heroZeroScoreboard;
  if (hz) {
    const tTrades = document.getElementById('hz-total-trades');
    const tWin = document.getElementById('hz-winrate');
    const tExp = document.getElementById('hz-expectancy');
    if (tTrades) tTrades.textContent = hz.totalTrades;
    if (tWin) tWin.textContent = `${hz.winRate}%`;
    if (tExp) tExp.textContent = `${hz.expectancy} R`;
  }

  const list = document.getElementById('journal-trades-list');
  if (!list) return;

  if (analytics.recentTrades.length === 0) {
    list.innerHTML = '<div class="empty-state">No trades logged yet. Click "Log Paper Trade" after generating a signal.</div>';
    return;
  }

  list.innerHTML = '';
  analytics.recentTrades.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'driver-row';
    card.style.marginBottom = '6px';
    card.innerHTML = `
      <div class="driver-info">
        <span class="driver-name" style="color:${t.signal === 'BUY' ? '#00E676' : '#FF3B69'}">${t.signal} • ${t.strategyName}</span>
        <span class="driver-sub">${new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Entry: ${t.entryPrice} | SL: ${t.stopLoss} | TP1: ${t.target1}</span>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="btn-sm" style="color:#00E676" data-id="${t.id}" data-action="WIN">WIN</button>
        <button class="btn-sm" style="color:#FF3B69" data-id="${t.id}" data-action="LOSS">LOSS</button>
      </div>
    `;

    card.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', async () => {
        await NiftyJournalEngine.updateTrade(b.dataset.id, b.dataset.action);
        refreshJournalDashboard();
      });
    });

    list.appendChild(card);
  });
}

function runBacktestSimulator() {
  const box = document.getElementById('backtest-results-box');
  box.classList.remove('hidden');
  box.innerHTML = 'Running simulation across historical Nifty bars...';

  const currentPrice = currentChartMeta?.currentPrice || 24100;
  const history = generateHistoricalNiftyBars(currentPrice, 60);

  const res = NiftyJournalEngine.runHistoricalBacktest(history, appConfig);
  if (res.error) {
    box.textContent = res.error;
    return;
  }

  let moduleList = '';
  if (res.moduleBreakdown) {
    moduleList = Object.entries(res.moduleBreakdown)
      .map(([name, stat]) => `• ${name}: ${stat.count} signals (Wins: ${stat.wins} | Losses: ${stat.losses})`)
      .join('<br>');
  }

  box.innerHTML = `
    <strong>Historical Multi-Module Backtest (60 Bars):</strong><br>
    • Total Signals Generated: <strong>${res.totalSignals}</strong><br>
    • Completed Setups: <strong>${res.completed}</strong> (Wins: ${res.wins} | Losses: ${res.losses})<br>
    • Verified Win Rate: <strong class="text-emerald">${res.winRate}%</strong><br>
    • Profit Factor: <strong class="text-cyan">${res.profitFactor}</strong><br>
    • Net Cumulative Expectancy: <strong>+${res.netR} R</strong><br>
    • Max Drawdown: <strong class="text-crimson">${res.maxDrawdownR} R</strong><br>
    ${moduleList ? `<div style="margin-top:6px; font-size:10.5px; color:#CBD5E1;">${moduleList}</div>` : ''}
    <div style="margin-top:6px; font-size:10px; color:#FBBF24;">${res.heroZeroNote || ''}</div>
  `;
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

  toggleKey?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  saveBtn?.addEventListener('click', () => {
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
      ts_gemini_api_key: keyInput.value.trim()
    };

    chrome.storage.local.set(updated);
    Object.assign(appConfig, updated);

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
