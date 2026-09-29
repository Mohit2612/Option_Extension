/**
 * TradeSight NIFTY 50 - Indicator Toggles & UI Controller (ESM)
 *
 * Coordinates UI states, switches, status badges, and user inputs for:
 *  - Master Indicator Switch
 *  - NSDT Auto S/R Levels (Tiers 1, 2, 3)
 *  - Pivot Trendlines 30/30 (30-bar confirmation lag reminder)
 */

export class IndicatorTogglesUI {
  constructor(manager, callbacks = {}) {
    this.manager = manager;
    this.callbacks = callbacks;
  }

  init() {
    this.bindDomListeners();
    this.renderState(this.manager.getState());
  }

  bindDomListeners() {
    const masterChk = document.getElementById('chk-indicators-master');
    const nsdtChk = document.getElementById('chk-nsdt-enabled');
    const trendlineChk = document.getElementById('chk-trendline-enabled');

    masterChk?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.manager.setMasterEnabled(enabled);
      this.callbacks.onMasterToggle?.(enabled);
      this.renderState(this.manager.getState());
    });

    nsdtChk?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.manager.setNSDTEnabled(enabled);
      this.callbacks.onNSDTToggle?.(enabled);
      this.renderState(this.manager.getState());
    });

    trendlineChk?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.manager.setTrendlineEnabled(enabled);
      this.callbacks.onTrendlineToggle?.(enabled);
      this.renderState(this.manager.getState());
    });
  }

  renderState(state) {
    const masterChk = document.getElementById('chk-indicators-master');
    const nsdtChk = document.getElementById('chk-nsdt-enabled');
    const trendlineChk = document.getElementById('chk-trendline-enabled');

    const nsdtBadge = document.getElementById('nsdt-status-badge');
    const trendlineBadge = document.getElementById('trendline-status-badge');
    const nsdtCard = document.getElementById('nsdt-details-card');
    const trendlineCard = document.getElementById('trendline-details-card');

    const cfg = this.manager.getConfig ? this.manager.config : null;
    const isMaster = state?.masterEnabled ?? cfg?.masterEnabled ?? false;
    const isNSDT = isMaster && (state?.nsdtStatus === 'ON' || cfg?.nsdtConfig?.isEnabled);
    const isTL = isMaster && (state?.trendlineStatus === 'ON' || cfg?.trendlineConfig?.isEnabled);

    if (masterChk) masterChk.checked = isMaster;
    if (nsdtChk) nsdtChk.checked = isNSDT;
    if (trendlineChk) trendlineChk.checked = isTL;

    // Status Badges
    this.updateBadge(nsdtBadge, state?.nsdtStatus || (isNSDT ? 'ON' : 'OFF'));
    this.updateBadge(trendlineBadge, state?.trendlineStatus || (isTL ? 'ON' : 'OFF'));

    // Render NSDT Details
    if (nsdtCard) {
      if (isNSDT && state?.nsdtState) {
        nsdtCard.style.display = 'block';
        const lvls = state.nsdtState.levels;
        const sup = state.nsdtState.nearestSupport;
        const res = state.nsdtState.nearestResistance;
        const clusters = state.nsdtState.clusters;

        nsdtCard.innerHTML = `
          <div style="font-size:10px; color:#CBD5E1; display:flex; flex-direction:column; gap:3px;">
            <div style="display:flex; justify-content:space-between;">
              <span>R3: <strong>${lvls?.r3?.price ?? '--'}</strong> | R2: <strong>${lvls?.r2?.price ?? '--'}</strong> | R1: <strong>${lvls?.r1?.price ?? '--'}</strong></span>
              <span style="color:#00D4FF; font-weight:700;">ATR: ${state.nsdtState.currentAtr}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>S1: <strong>${lvls?.s1?.price ?? '--'}</strong> | S2: <strong>${lvls?.s2?.price ?? '--'}</strong> | S3: <strong>${lvls?.s3?.price ?? '--'}</strong></span>
              <span style="color:#FBBF24;">Clusters: ${clusters ? clusters.length : 0}</span>
            </div>
            ${res ? `<div style="color:#FF3B69; font-size:9.5px;">Overhead Res: ${res.level?.id} (${res.distancePts} pts / ${res.distanceAtr} ATR)</div>` : ''}
            ${sup ? `<div style="color:#00E676; font-size:9.5px;">Support Below: ${sup.level?.id} (${sup.distancePts} pts / ${sup.distanceAtr} ATR)</div>` : ''}
          </div>
        `;
      } else {
        nsdtCard.style.display = 'none';
      }
    }

    // Render Trendline 30/30 Details
    if (trendlineCard) {
      if (isTL && state?.trendlineState) {
        trendlineCard.style.display = 'block';
        const tl = state.trendlineState;
        const dtl = tl.downtrendLine;
        const utl = tl.uptrendLine;

        trendlineCard.innerHTML = `
          <div style="font-size:10px; color:#CBD5E1; display:flex; flex-direction:column; gap:3px;">
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#FBBF24; font-weight:700;">Lag: 30 bars (By Design)</span>
              <span style="color:#94A3B8;">Events: ${tl.events ? tl.events.length : 0}</span>
            </div>
            ${dtl ? `<div style="color:#FF3B69; font-size:9.5px;">DTL: ${dtl.statusDescription} -> ${dtl.currentProjectedPrice}</div>` : '<div style="font-size:9px; color:#64748B;">No qualifying 30/30 Downtrend pair</div>'}
            ${utl ? `<div style="color:#00E676; font-size:9.5px;">UTL: ${utl.statusDescription} -> ${utl.currentProjectedPrice}</div>` : '<div style="font-size:9px; color:#64748B;">No qualifying 30/30 Uptrend pair</div>'}
          </div>
        `;
      } else {
        trendlineCard.style.display = 'none';
      }
    }
  }

  updateBadge(el, status) {
    if (!el) return;
    el.textContent = status;
    el.className = 'status-tag';

    if (status === 'ON') {
      el.style.background = 'rgba(0, 230, 118, 0.15)';
      el.style.color = '#00E676';
      el.style.borderColor = '#00E676';
    } else if (status === 'COMPUTING') {
      el.style.background = 'rgba(0, 212, 255, 0.15)';
      el.style.color = '#00D4FF';
      el.style.borderColor = '#00D4FF';
    } else if (status === 'DATA_ERROR') {
      el.style.background = 'rgba(255, 59, 105, 0.15)';
      el.style.color = '#FF3B69';
      el.style.borderColor = '#FF3B69';
    } else {
      el.style.background = 'rgba(148, 163, 184, 0.12)';
      el.style.color = '#94A3B8';
      el.style.borderColor = '#64748B';
    }
  }
}
