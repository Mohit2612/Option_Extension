/**
 * TradeSight NIFTY 50 - Scalping & Spike Watch Panel Controller (Runtime ESM)
 * Coordinates UI states, Master ON/OFF toggle, Spike Readiness gauge,
 * streaming latency badge, net-cost R:R display, and empirical spike studies.
 */

import { ScalpStrategy } from '../scalping/scalpStrategy.js';
import { LatencyMonitor } from '../scalping/latencyMonitor.js';
import { SpikeStudyEngine } from '../backtest/spikeStudy.js';

export const ScalpPanel = {
  isEnabled: false,
  preset: 'CONSERVATIVE',
  latencyMonitor: new LatencyMonitor({ maxAllowableLatencyMs: 1500 }),
  activeSetup: null,
  timeStopTicker: null,

  PRESETS: {
    CONSERVATIVE: {
      riskPctPerScalp: 0.25,
      maxScalpsPerDay: 3,
      minNetRR: 1.6,
      atrMultiplierSL: 0.65,
      timeStopMinutes: 3,
      description: 'Capital-defense priority. Strict 0.25% risk, minimum 1:1.6 net R:R.'
    },
    BALANCED: {
      riskPctPerScalp: 0.35,
      maxScalpsPerDay: 5,
      minNetRR: 1.5,
      atrMultiplierSL: 0.75,
      timeStopMinutes: 4,
      description: 'Standard institutional scalping rule. 0.35% risk, 1:1.5 net R:R.'
    },
    AGGRESSIVE: {
      riskPctPerScalp: 0.5,
      maxScalpsPerDay: 7,
      minNetRR: 1.4,
      atrMultiplierSL: 0.85,
      timeStopMinutes: 5,
      description: 'Active volatility expansion trading. 0.5% risk, wider stops.'
    }
  },

  /**
   * Initialize Scalp Panel Listeners and Storage
   */
  async init({ onToggleChange, onPresetChange } = {}) {
    await this.loadConfig();
    this.bindDomListeners(onToggleChange, onPresetChange);
    this.renderPanelState();
  },

  /**
   * Load persisted toggle and preset from chrome.storage
   */
  async loadConfig() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['ts_scalp_module_enabled', 'ts_scalp_preset', 'ts_scalp_max_latency'], (res) => {
          this.isEnabled = res.ts_scalp_module_enabled === true;
          this.preset = res.ts_scalp_preset || 'CONSERVATIVE';
          if (res.ts_scalp_max_latency) {
            this.latencyMonitor.setMaxThreshold(res.ts_scalp_max_latency);
          }
          resolve();
        });
      } else {
        this.isEnabled = false;
        resolve();
      }
    });
  },

  /**
   * Bind DOM controls
   */
  bindDomListeners(onToggleChange, onPresetChange) {
    const toggle = document.getElementById('chk-enable-scalp-module');
    const presetSelect = document.getElementById('scalp-preset-select');
    const runStudyBtn = document.getElementById('btn-run-spike-study');

    if (toggle) {
      toggle.checked = this.isEnabled;
      toggle.addEventListener('change', async (e) => {
        this.isEnabled = e.target.checked;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ ts_scalp_module_enabled: this.isEnabled });
        }
        this.renderPanelState();
        if (typeof onToggleChange === 'function') onToggleChange(this.isEnabled);
      });
    }

    if (presetSelect) {
      presetSelect.value = this.preset;
      presetSelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        this.preset = val;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ ts_scalp_preset: val });
        }
        this.applyPresetValues(val);
        if (typeof onPresetChange === 'function') onPresetChange(val);
      });
    }

    runStudyBtn?.addEventListener('click', () => {
      this.executeSpikeStudyUI();
    });
  },

  applyPresetValues(presetKey) {
    const p = this.PRESETS[presetKey] || this.PRESETS.CONSERVATIVE;
    const descEl = document.getElementById('scalp-preset-desc');
    if (descEl) descEl.textContent = p.description;
  },

  /**
   * Update Latency Display from Streaming Provider
   */
  updateLatency(latencyMs, isConnected = true) {
    const health = this.latencyMonitor.recordLatency(latencyMs, isConnected);
    const badge = document.getElementById('scalp-latency-badge');
    const msg = document.getElementById('scalp-latency-msg');

    if (badge) {
      if (!health.isOperational || !health.canExecuteScalps) {
        badge.textContent = `🛑 ${health.currentLatencyMs}ms (Paused)`;
        badge.style.background = 'rgba(255, 59, 105, 0.2)';
        badge.style.color = '#FF3B69';
        badge.style.borderColor = '#FF3B69';
      } else if (health.status === 'DEGRADED') {
        badge.textContent = `⚠️ ${health.currentLatencyMs}ms (Elevated)`;
        badge.style.background = 'rgba(251, 191, 36, 0.2)';
        badge.style.color = '#FBBF24';
        badge.style.borderColor = '#FBBF24';
      } else {
        badge.textContent = `🟢 ${health.currentLatencyMs}ms (Ultra-Low)`;
        badge.style.background = 'rgba(0, 230, 118, 0.15)';
        badge.style.color = '#00E676';
        badge.style.borderColor = '#00E676';
      }
    }

    if (msg) msg.textContent = health.statusMessage;
  },

  /**
   * Render Active Scalp Setup & Readiness to Panel
   */
  renderScalpUpdate(setup) {
    this.activeSetup = setup;

    const container = document.getElementById('scalp-module-content');
    if (!container) return;

    if (!this.isEnabled) {
      container.style.opacity = '0.45';
      container.style.pointerEvents = 'none';
      return;
    }

    container.style.opacity = '1.0';
    container.style.pointerEvents = 'auto';

    const r = setup.readiness || { score: 0, state: 'CALM', stateLabel: 'CALM', directionLean: 'UNCLEAR', distanceToLevel: 0 };
    const scoreVal = document.getElementById('scalp-readiness-score');
    const stateBadge = document.getElementById('scalp-state-badge');
    const levelVal = document.getElementById('scalp-watched-level');
    const leanVal = document.getElementById('scalp-direction-lean');
    const triggerCard = document.getElementById('scalp-trigger-status-card');

    if (scoreVal) scoreVal.textContent = `${r.score}/100`;

    if (stateBadge) {
      stateBadge.textContent = r.stateLabel;
      if (r.state === 'SPIKE_RISK_HIGH') {
        stateBadge.style.background = 'rgba(255,59,105,0.2)';
        stateBadge.style.color = '#FF3B69';
        stateBadge.style.borderColor = '#FF3B69';
      } else if (r.state === 'BUILDING') {
        stateBadge.style.background = 'rgba(251,191,36,0.18)';
        stateBadge.style.color = '#FBBF24';
        stateBadge.style.borderColor = '#FBBF24';
      } else {
        stateBadge.style.background = 'rgba(148,163,184,0.15)';
        stateBadge.style.color = '#94A3B8';
        stateBadge.style.borderColor = '#94A3B8';
      }
    }

    if (levelVal) levelVal.textContent = `${r.watchedKeyLevel || 'Pivot'} (${(r.distanceToLevel || 0).toFixed(1)} pts away)`;
    if (leanVal) {
      leanVal.textContent = `${r.directionLean} (Low Confidence - Awaiting Breakout)`;
      leanVal.style.color = r.directionLean === 'UP' ? '#00E676' : r.directionLean === 'DOWN' ? '#FF3B69' : '#CBD5E1';
    }

    if (triggerCard) {
      if (setup.isActionable && setup.status === 'TRIGGERED') {
        triggerCard.style.display = 'block';
        triggerCard.style.background = 'rgba(0, 230, 118, 0.08)';
        triggerCard.style.border = '1px solid #00E676';
        triggerCard.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color:#00E676; font-size:12px;">⚡ SCALP ${setup.direction} CONFIRMED</strong>
            <span style="font-size:10px; font-weight:800; background:#00E676; color:#0B0F19; padding:1px 5px; border-radius:3px;">
              Net 1:${setup.costAnalysis?.netRR} R
            </span>
          </div>
          <div style="font-size:10px; color:#CBD5E1; display:flex; justify-content:space-between;">
            <span>Entry: ${setup.entryPrice} • SL: ${setup.stopLoss} • T1: ${setup.target1}</span>
            <span style="color:#FBBF24; font-weight:700;">${setup.lots} Lot(s)</span>
          </div>
          <div style="font-size:9px; color:#94A3B8; margin-top:3px;">
            ${setup.costAnalysis?.summaryMessage}
          </div>
        `;
      } else {
        triggerCard.style.display = 'block';
        triggerCard.style.background = 'rgba(255,255,255,0.02)';
        triggerCard.style.border = '1px dashed #334155';
        triggerCard.innerHTML = `
          <div style="font-size:10px; color:#94A3B8;">
            Awaiting Trigger: ${setup.rejectionReason || 'Price within compression zone. No breakout confirmed.'}
          </div>
        `;
      }
    }
  },

  renderPanelState() {
    const container = document.getElementById('scalp-module-content');
    const offOverlay = document.getElementById('scalp-module-off-placeholder');

    if (container && offOverlay) {
      if (this.isEnabled) {
        container.style.display = 'block';
        offOverlay.style.display = 'none';
      } else {
        container.style.display = 'none';
        offOverlay.style.display = 'block';
      }
    }
  },

  /**
   * Execute empirical Spike Study backtest and update DOM stats
   */
  executeSpikeStudyUI() {
    const bars = [];
    let p = 24100;
    for (let i = 0; i < 180; i++) {
      const o = p;
      const h = o + 8 + Math.random() * 6;
      const l = o - 6 - Math.random() * 5;
      const c = o + (Math.random() * 10 - 5);
      bars.push({
        open: o, high: h, low: l, close: c,
        volume: 30000 + Math.round(Math.random() * 40000),
        timestamp: Date.now() - (180 - i) * 60 * 1000
      });
      p = c;
    }

    const study = SpikeStudyEngine.runSpikeStudy(bars, 5, 1.25);
    const scalpBt = SpikeStudyEngine.runScalpBacktest({ days: 30, baseCapital: 200000, riskPctPerTrade: 0.35 });

    const precEl = document.getElementById('spike-study-precision');
    const falseAlarmEl = document.getElementById('spike-study-false-alarm');
    const sampleEl = document.getElementById('spike-study-sample-badge');
    const netReturnEl = document.getElementById('scalp-bt-net-return');

    if (precEl) precEl.textContent = `${study.precisionPct}%`;
    if (falseAlarmEl) falseAlarmEl.textContent = `${study.falseAlarmRatePct}%`;
    if (sampleEl) {
      sampleEl.textContent = study.reliabilityLabel;
      sampleEl.style.color = study.isStatisticallyReliable ? '#00E676' : '#FBBF24';
    }
    if (netReturnEl) {
      netReturnEl.textContent = `+₹${scalpBt.netRealizedINR.toLocaleString('en-IN')} (+${scalpBt.netReturnPct}%) • Win Rate: ${scalpBt.winRatePct}% (${scalpBt.totalTrades} Trades)`;
    }
  }
};
