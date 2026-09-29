/**
 * TradeSight NIFTY 50 - Discipline Panel Controller (Module 9)
 * Coordinates UI states, Pre-Trade Checklist, Position Sizer,
 * Cool-Down Timers, Behavioral Protection, and CSV Journal Export.
 */

import { PreTradeChecklist } from '../discipline/checklist.js';
import { PositionSizer } from '../risk/positionSizer.js';
import { BehaviorGuard } from '../discipline/behaviorGuard.js';
import { NoTradeFilters } from '../discipline/noTradeFilters.js';
import { JournalAnalytics } from '../journal/analytics.js';
import { AlertService } from '../services/alertService.js';
import { NiftyJournalEngine } from '../journal/nifty-journal.js';

export const DisciplinePanel = {
  coolDownUntil: null,
  isCalmConfirmed: false,
  coolDownTicker: null,

  /**
   * Initialize Discipline Panel Components & Listeners
   */
  init({ onChecklistChange, onTradeActionableStateChange } = {}) {
    this.initChecklistListeners(onChecklistChange, onTradeActionableStateChange);
    this.initCsvExportListener();
    this.initPresetProfileListener();
    this.startCoolDownMonitor();
  },

  /**
   * Pre-Trade Checklist Listeners
   */
  initChecklistListeners(onChecklistChange, onTradeActionableStateChange) {
    const calmCheckbox = document.getElementById('chk-manual-calm');
    calmCheckbox?.addEventListener('change', (e) => {
      this.isCalmConfirmed = (e.target as HTMLInputElement).checked;
      if (typeof onChecklistChange === 'function') {
        onChecklistChange(this.isCalmConfirmed);
      }
    });
  },

  /**
   * Monitor Post-Loss Cool-Down
   */
  startCoolDownMonitor() {
    if (this.coolDownTicker) clearInterval(this.coolDownTicker);

    this.coolDownTicker = setInterval(() => {
      const banner = document.getElementById('cooldown-timer-banner');
      const textEl = document.getElementById('cooldown-timer-text');

      if (!this.coolDownUntil) {
        if (banner) banner.style.display = 'none';
        return;
      }

      const cd = BehaviorGuard.evaluateCoolDown(this.coolDownUntil);

      if (cd.isActive) {
        if (banner) banner.style.display = 'block';
        if (textEl) textEl.textContent = `🛑 COOL-DOWN ACTIVE: Paused for ${cd.formattedRemaining} after a loss to restore emotional composure.`;
      } else {
        if (banner && banner.style.display !== 'none') {
          banner.style.display = 'none';
          AlertService.sendNotification('COOL-DOWN FINISHED', 'Emotional composure restored. You may now evaluate next market setups.');
          AlertService.playBuyChime();
        }
        this.coolDownUntil = null;
      }
    }, 1000);
  },

  /**
   * Trigger cool-down timer after a losing trade
   */
  triggerCoolDown(durationMins = 20) {
    this.coolDownUntil = Date.now() + durationMins * 60 * 1000;
  },

  /**
   * Render Pre-Trade Checklist to DOM
   */
  renderChecklist(checklistResult: any) {
    const container = document.getElementById('checklist-items-container');
    const summaryMsg = document.getElementById('checklist-summary-msg');
    const badge = document.getElementById('checklist-status-badge');

    if (badge) {
      badge.textContent = checklistResult.allPassed
        ? '✓ ALL CHECKS PASSED'
        : `${checklistResult.passedCount}/${checklistResult.totalCount} PASSED`;
      badge.style.background = checklistResult.allPassed ? 'rgba(0, 230, 118, 0.15)' : 'rgba(251, 191, 36, 0.15)';
      badge.style.color = checklistResult.allPassed ? '#00E676' : '#FBBF24';
      badge.style.borderColor = checklistResult.allPassed ? '#00E676' : '#FBBF24';
    }

    if (summaryMsg) {
      summaryMsg.textContent = checklistResult.summaryMessage;
      summaryMsg.style.color = checklistResult.allPassed ? '#00E676' : '#CBD5E1';
    }

    if (container && Array.isArray(checklistResult.items)) {
      container.innerHTML = '';
      checklistResult.items.forEach((item: any) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'flex-start';
        row.style.justifyContent = 'space-between';
        row.style.padding = '4px 6px';
        row.style.background = item.isPassed ? 'rgba(0, 230, 118, 0.04)' : 'rgba(255, 59, 105, 0.04)';
        row.style.border = item.isPassed ? '1px solid rgba(0, 230, 118, 0.2)' : '1px solid rgba(255, 59, 105, 0.2)';
        row.style.borderRadius = '4px';

        const isManual = !item.isAuto;

        row.innerHTML = `
          <div style="flex:1; padding-right:8px;">
            <div style="font-size:10px; font-weight:700; color:${item.isPassed ? '#E2E8F0' : '#FF8BA7'};">
              ${isManual ? '👉 ' : ''}${item.label}
            </div>
            <div style="font-size:9px; color:#94A3B8; margin-top:1px;">${item.details}</div>
          </div>
          <div style="text-align:right;">
            ${isManual
              ? `<input type="checkbox" id="chk-manual-calm" ${item.isPassed ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px;">`
              : `<span style="font-size:10px; font-weight:800; color:${item.isPassed ? '#00E676' : '#FF3B69'};">${item.isPassed ? '✓ PASS' : '✗ PENDING'}</span>`
            }
          </div>
        `;
        container.appendChild(row);
      });

      // Re-bind listener for manual checkbox
      const calmCheckbox = document.getElementById('chk-manual-calm');
      calmCheckbox?.addEventListener('change', (e) => {
        this.isCalmConfirmed = (e.target as HTMLInputElement).checked;
        const event = new CustomEvent('checklist-manual-toggle', { detail: { isCalm: this.isCalmConfirmed } });
        document.dispatchEvent(event);
      });
    }
  },

  /**
   * Render Position Sizing Preview
   */
  renderPositionSizer(sizingResult: any) {
    const lotsEl = document.getElementById('ps-recommended-lots');
    const riskInrEl = document.getElementById('ps-planned-risk-inr');
    const riskPctEl = document.getElementById('ps-planned-risk-pct');
    const recTextEl = document.getElementById('ps-recommendation-text');

    if (!sizingResult) return;

    if (lotsEl) lotsEl.textContent = `${sizingResult.lots} Lot(s) (${sizingResult.quantity} Qty)`;
    if (riskInrEl) riskInrEl.textContent = `₹${sizingResult.actualRiskINR.toLocaleString('en-IN')}`;
    if (riskPctEl) riskPctEl.textContent = `${sizingResult.actualRiskPct}%`;
    if (recTextEl) {
      recTextEl.textContent = sizingResult.recommendation;
      recTextEl.style.color = sizingResult.isRiskTooHigh ? '#FF3B69' : '#00E676';
    }
  },

  /**
   * CSV Export of Trading Journal
   */
  initCsvExportListener() {
    const exportBtn = document.getElementById('btn-export-journal-csv');
    exportBtn?.addEventListener('click', async () => {
      try {
        const trades = await NiftyJournalEngine.getTrades();
        if (!trades || trades.length === 0) {
          alert('No trades in journal to export.');
          return;
        }

        const csvContent = JournalAnalytics.exportToCsv(trades);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tradesight_nifty_journal_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err: any) {
        alert('Failed to export CSV: ' + err.message);
      }
    });
  },

  /**
   * Preset Profiles in Settings (Conservative / Balanced / Custom)
   */
  initPresetProfileListener() {
    const presetSelect = document.getElementById('cfg-risk-preset-select');
    presetSelect?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      const riskInput = document.getElementById('cfg-risk-pct') as HTMLInputElement;
      const profitTarget = document.getElementById('cfg-daily-profit-target-r') as HTMLInputElement;
      const maxLoss = document.getElementById('cfg-daily-max-loss-r') as HTMLInputElement;
      const maxTrades = document.getElementById('cfg-max-daily-trades') as HTMLInputElement;

      if (val === 'CONSERVATIVE') {
        if (riskInput) riskInput.value = '0.5';
        if (profitTarget) profitTarget.value = '1.5';
        if (maxLoss) maxLoss.value = '1.5';
        if (maxTrades) maxTrades.value = '2';
      } else if (val === 'BALANCED') {
        if (riskInput) riskInput.value = '1.0';
        if (profitTarget) profitTarget.value = '2.0';
        if (maxLoss) maxLoss.value = '2.0';
        if (maxTrades) maxTrades.value = '3';
      }
    });
  }
};
