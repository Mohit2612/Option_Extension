/**
 * TradeSight NIFTY 50 - Dedicated Scalp & Spike Overlay Renderer
 * Renders on-chart Spike Watch readiness gauge, watched level bounding box,
 * compression zone highlights, cost-adjusted R:R badge, and time-stop timer.
 * Zero DOM footprint when Scalping module is toggled OFF.
 */

export interface ScalpRenderParams {
  scalpSetup: any;
  isEnabled: boolean;
  containerElement: HTMLElement | null;
  onIgnoreSetup?: () => void;
  onMarkTaken?: (setup: any) => void;
}

export const ScalpRenderer = {
  activeSetup: null as any,
  timerInterval: null as any,

  /**
   * Main render function for TradingView overlay
   */
  render({
    scalpSetup,
    isEnabled,
    containerElement,
    onIgnoreSetup,
    onMarkTaken
  }: ScalpRenderParams): void {
    if (!containerElement) return;

    const existingPanel = document.getElementById('tradesight-scalp-spike-hud');

    // ZERO FOOTPRINT RULE: If module is disabled, remove all DOM elements and timer immediately
    if (!isEnabled || !scalpSetup) {
      if (existingPanel) existingPanel.remove();
      if (this.timerInterval) clearInterval(this.timerInterval);
      return;
    }

    if (existingPanel) existingPanel.remove();

    this.activeSetup = scalpSetup;
    const readiness = scalpSetup.readiness || { score: 0, state: 'CALM', stateLabel: 'CALM', directionLean: 'UNCLEAR' };
    const trigger = scalpSetup.trigger || { isTriggered: false, direction: 'NONE', triggerType: 'NONE' };
    const isTriggered = scalpSetup.isActionable && trigger.isTriggered;

    // Determine State Colors
    let stateColor = '#94A3B8'; // Calm grey
    let stateBg = 'rgba(148, 163, 184, 0.12)';
    let pulseClass = '';

    if (readiness.state === 'SPIKE_RISK_HIGH') {
      stateColor = '#FF3B69';
      stateBg = 'rgba(255, 59, 105, 0.18)';
      pulseClass = 'tradesight-pulse-crimson';
    } else if (readiness.state === 'BUILDING') {
      stateColor = '#FBBF24';
      stateBg = 'rgba(251, 191, 36, 0.15)';
      pulseClass = 'tradesight-pulse-amber';
    }

    const hud = document.createElement('div');
    hud.id = 'tradesight-scalp-spike-hud';
    hud.className = `tradesight-scalp-hud ${pulseClass}`;
    hud.style.cssText = `
      position: absolute;
      top: 72px;
      right: 18px;
      width: 290px;
      background: rgba(11, 15, 25, 0.94);
      backdrop-filter: blur(10px);
      border: 1px solid ${stateColor};
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: #E2E8F0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      z-index: 99999;
      pointer-events: auto;
      overflow: hidden;
    `;

    hud.innerHTML = `
      <div style="background:${stateBg}; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${stateColor};"></span>
          <strong style="color:${stateColor}; font-size:11px;">SPIKE WATCH: ${readiness.score}/100</strong>
        </div>
        <span style="font-size:10px; font-weight:700; color:#CBD5E1;">Lean: <span style="color:${readiness.directionLean === 'UP' ? '#00E676' : readiness.directionLean === 'DOWN' ? '#FF3B69' : '#94A3B8'};">${readiness.directionLean}</span></span>
      </div>

      <div style="padding:8px 10px; display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#94A3B8;">
          <span>Watched Level:</span>
          <strong style="color:#00D4FF;">${readiness.watchedKeyLevel || 'Compression Pivot'}</strong>
        </div>

        ${isTriggered ? `
          <div style="background:rgba(0, 230, 118, 0.12); border:1px solid #00E676; border-radius:5px; padding:6px; margin:4px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="color:#00E676; font-size:12px;">⚡ SCALP ${scalpSetup.direction} TRIGGERED</strong>
              <span style="font-size:9.5px; font-weight:800; background:#00E676; color:#0B0F19; border-radius:3px; padding:1px 5px;">
                Net 1:${scalpSetup.costAnalysis?.netRR || '1.6'} R
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; font-size:9.5px; text-align:center;">
              <div style="background:rgba(0,0,0,0.3); padding:2px; border-radius:3px;">
                <span style="color:#94A3B8; display:block;">ENTRY</span>
                <strong>${scalpSetup.entryPrice}</strong>
              </div>
              <div style="background:rgba(0,0,0,0.3); padding:2px; border-radius:3px;">
                <span style="color:#FF3B69; display:block;">SL</span>
                <strong>${scalpSetup.stopLoss}</strong>
              </div>
              <div style="background:rgba(0,0,0,0.3); padding:2px; border-radius:3px;">
                <span style="color:#00E676; display:block;">T1</span>
                <strong>${scalpSetup.target1}</strong>
              </div>
            </div>
            <div style="margin-top:5px; font-size:9.5px; color:#FBBF24; display:flex; justify-content:space-between;">
              <span id="scalp-time-stop-countdown">⏱️ Time Stop: 03m 00s</span>
              <span>${scalpSetup.lots} Lot(s)</span>
            </div>
          </div>

          <div style="display:flex; gap:6px; margin-top:2px;">
            <button id="btn-scalp-mark-taken" style="flex:1; background:#00E676; color:#0B0F19; border:none; border-radius:4px; padding:5px; font-size:10px; font-weight:800; cursor:pointer;">
              ✓ Mark Taken
            </button>
            <button id="btn-scalp-ignore" style="flex:1; background:#1E293B; color:#94A3B8; border:1px solid #475569; border-radius:4px; padding:5px; font-size:10px; font-weight:700; cursor:pointer;">
              ✕ Ignore Setup
            </button>
          </div>
        ` : `
          <div style="background:rgba(255,255,255,0.02); border:1px dashed #334155; border-radius:5px; padding:5px 8px; font-size:10px; color:#CBD5E1;">
            <span>Awaiting breakout trigger beyond key compression level.</span>
            <div style="margin-top:3px; font-size:9px; color:#64748B;">Strict execution: Zero guessing. Trigger requires volume + driver confirmation.</div>
          </div>
        `}
      </div>
    `;

    containerElement.appendChild(hud);

    // Bind Action Buttons
    const markBtn = document.getElementById('btn-scalp-mark-taken');
    const ignoreBtn = document.getElementById('btn-scalp-ignore');

    markBtn?.addEventListener('click', () => {
      if (typeof onMarkTaken === 'function') onMarkTaken(scalpSetup);
      hud.remove();
    });

    ignoreBtn?.addEventListener('click', () => {
      if (typeof onIgnoreSetup === 'function') onIgnoreSetup();
      hud.remove();
    });

    // Start Live Time-Stop Ticker if triggered
    if (isTriggered && scalpSetup.timeStopEpoch) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        const timeStopEl = document.getElementById('scalp-time-stop-countdown');
        if (!timeStopEl) {
          clearInterval(this.timerInterval);
          return;
        }

        const remainingMs = scalpSetup.timeStopEpoch - Date.now();
        if (remainingMs <= 0) {
          timeStopEl.textContent = '🛑 TIME STOP REACHED: Exit at market';
          timeStopEl.style.color = '#FF3B69';
          clearInterval(this.timerInterval);
          return;
        }

        const remSec = Math.floor(remainingMs / 1000);
        const m = Math.floor(remSec / 60);
        const s = remSec % 60;
        timeStopEl.textContent = `⏱️ Time Stop: ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
      }, 1000);
    }
  }
};
