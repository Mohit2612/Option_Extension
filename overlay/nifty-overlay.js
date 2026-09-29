/**
 * TradeSight NIFTY 50 - Dedicated TradingView Chart Overlay Module
 * Renders on-chart Institutional HUD, Live NEXT MOVE, Key Levels, and Pattern Labels.
 * Strictly non-repainting; marks invalidated signals clearly.
 */

import { NIFTY_CONFIG } from '../config/nifty-config.js';

export const NiftyOverlayRenderer = {
  activeSignal: null,
  isAudioAlertEnabled: true,

  /**
   * Render complete Nifty analysis package onto TradingView overlay root
   */
  render({
    signalData = {},
    driverData = {},
    keyLevels = {},
    symbol = 'NIFTY',
    containerElement
  }) {
    if (!containerElement) return;

    // Remove existing Nifty elements
    const existingHud = document.getElementById('tradesight-nifty-live-hud');
    if (existingHud) existingHud.remove();

    const existingWarning = document.getElementById('tradesight-symbol-warning');
    if (existingWarning) existingWarning.remove();

    // 1. Symbol Extraction
    const activeSymbol = (symbol || 'CHART').toUpperCase();
    const isNifty = this.isNiftySymbol(activeSymbol);

    // 2. Render On-Chart Live Institutional HUD
    this.renderLiveHud(containerElement, signalData, driverData, activeSymbol, isNifty);

    // 3. Audio Chime if fresh valid signal
    if (signalData.signal && signalData.signal !== 'WAIT') {
      if (!this.activeSignal || this.activeSignal.timestamp !== signalData.timestamp) {
        this.triggerAlertChime(signalData.signal);
      }
    }
    this.activeSignal = signalData;
  },

  isNiftySymbol(sym) {
    if (!sym) return false;
    const clean = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.includes('NIFTY') || clean.includes('CNXNIFTY') || clean.includes('INDIA50');
  },

  renderLiveHud(container, signalData, driverData, activeSymbol, isNifty) {
    const hud = document.createElement('div');
    hud.id = 'tradesight-nifty-live-hud';
    hud.className = 'tradesight-nifty-hud';

    const signal = signalData.signal || 'WAIT';
    const confidence = signalData.confidence || 0;
    const score = driverData.pressureScore !== undefined ? driverData.pressureScore : 0;
    const regimeLabel = signalData.regime?.label || '1-Month S/R Verified Scan';
    const patternName = signalData.pattern?.name || signalData.patternName || 'Candle Scan';
    const srLocation = signalData.srLocation || (signalData.srLevels ? `Sup: ${signalData.srLevels.majorSupport?.price} | Res: ${signalData.srLevels.majorResistance?.price}` : '1-Month S/R Active');

    let signalColorClass = 'hud-signal-wait';
    if (signal === 'BUY') signalColorClass = 'hud-signal-buy';
    if (signal === 'SELL') signalColorClass = 'hud-signal-sell';

    const heroStatus = signalData.heroZeroStatus || { armed: false, locked: false, text: 'Standby' };
    const countdown = signalData.countdown || { label: 'Active Pattern Scanner' };

    hud.innerHTML = `
      <div class="nifty-hud-header">
        <div class="hud-brand">
          <span class="hud-badge">${activeSymbol}</span>
          <span class="hud-regime">${regimeLabel}</span>
        </div>
        <div class="hud-pressure ${score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral'}">
          ${isNifty ? `Pressure: <strong>${score > 0 ? '+' : ''}${score}</strong>` : `S/R Verified`}
        </div>
      </div>

      <div class="nifty-hud-body">
        <div class="hud-next-move ${signalColorClass}">
          <div class="move-label">ACTION</div>
          <div class="move-action">${signal}</div>
          <div class="move-conf">${confidence > 0 ? confidence + '% Conviction' : 'Wait for S/R'}</div>
        </div>

        <div class="hud-meta-col">
          <div class="hud-metric">
            <span class="lbl">PATTERN</span>
            <span class="val" style="color:#00D4FF; font-weight:700;">${patternName}</span>
          </div>
          <div class="hud-metric">
            <span class="lbl">1M S/R CONFLUENCE</span>
            <span class="val" style="color:#FBBF24;">${srLocation}</span>
          </div>
          ${signalData.levels ? `
          <div class="hud-metric levels-metric">
            <span class="lbl">EXECUTION</span>
            <span class="val">ENTRY: <strong>${signalData.levels.entryPrice}</strong> | SL: <strong class="text-crimson">${signalData.levels.stopLoss}</strong> | TP: <strong class="text-emerald">${signalData.levels.target1}</strong></span>
          </div>` : ''}
          ${signalData.invalidation ? `
          <div class="hud-invalidation">
            <strong>Invalidation:</strong> ${signalData.invalidation}
          </div>` : ''}
        </div>
      </div>

      <div class="hud-extra-row">
        <span class="hero-zero-badge ${heroStatus.locked ? 'locked' : heroStatus.armed ? 'armed' : 'standby'}">
          ${heroStatus.locked ? '🔒 HZ Locked (2-Loss)' : heroStatus.armed ? '⚡ Hero-Zero Armed' : '⏳ HZ Standby'}
        </span>
        <span class="window-countdown-pill">
          ⏱️ ${countdown.label || '09:30 ORB / 13:40 Afternoon'}
        </span>
      </div>
    `;

    container.appendChild(hud);
  },

  triggerAlertChime(signalType) {
    if (!this.isAudioAlertEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = signalType === 'BUY' ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(signalType === 'BUY' ? 587.33 : 329.63, ctx.currentTime); // D5 or E4
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }
};
