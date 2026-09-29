/**
 * TradeSight NIFTY 50 - Unified Indicator Manager (Runtime ESM)
 *
 * Coordinates life-cycle, persistence, computation gating, and confluence aggregation
 * for toggleable indicator modules:
 *  1. NSDT Auto Support / Resistance Levels
 *  2. Pivot Trendlines 30/30
 *
 * CRITICAL ZERO-FOOTPRINT RULE:
 *  - Master & individual toggles default to OFF
 *  - When OFF: Zero CPU cycles, zero memory retention, zero drawing commands, zero alerts
 *  - Persisted in chrome.storage.local with reactive runtime synchronization
 */

import { NSDTAutoSREngine, DEFAULT_NSDT_CONFIG } from './nsdtAutoSR.js';
import { PivotTrendlines3030Engine, DEFAULT_TRENDLINE_3030_CONFIG } from './trendline3030.js';

export const DEFAULT_MANAGER_CONFIG = {
  masterEnabled: false,
  nsdtConfig: { ...DEFAULT_NSDT_CONFIG, isEnabled: false },
  trendlineConfig: { ...DEFAULT_TRENDLINE_3030_CONFIG, isEnabled: false },
  minBarsRequired: 500
};

export class IndicatorManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.nsdtEngine = new NSDTAutoSREngine(this.config.nsdtConfig);
    this.trendlineEngine = new PivotTrendlines3030Engine(this.config.trendlineConfig);
    this.latestCandles = [];
    this.state = null;
  }

  /**
   * Asynchronously load persisted indicator toggles & presets from chrome.storage
   */
  async initFromStorage() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(
          ['ts_indicators_master', 'ts_nsdt_enabled', 'ts_trendline_enabled', 'ts_nsdt_l1', 'ts_nsdt_l2', 'ts_nsdt_l3'],
          (res) => {
            this.config.masterEnabled = res.ts_indicators_master === true;
            this.config.nsdtConfig.isEnabled = this.config.masterEnabled && res.ts_nsdt_enabled === true;
            this.config.trendlineConfig.isEnabled = this.config.masterEnabled && res.ts_trendline_enabled === true;

            if (res.ts_nsdt_l1) this.config.nsdtConfig.l1 = res.ts_nsdt_l1;
            if (res.ts_nsdt_l2) this.config.nsdtConfig.l2 = res.ts_nsdt_l2;
            if (res.ts_nsdt_l3) this.config.nsdtConfig.l3 = res.ts_nsdt_l3;

            this.nsdtEngine.updateConfig(this.config.nsdtConfig);
            this.trendlineEngine.updateConfig(this.config.trendlineConfig);
            resolve();
          }
        );
      } else {
        resolve();
      }
    });
  }

  /**
   * Set Master ON/OFF Switch
   */
  setMasterEnabled(enabled) {
    this.config.masterEnabled = enabled;
    this.config.nsdtConfig.isEnabled = enabled && this.config.nsdtConfig.isEnabled;
    this.config.trendlineConfig.isEnabled = enabled && this.config.trendlineConfig.isEnabled;

    this.nsdtEngine.updateConfig({ isEnabled: this.config.nsdtConfig.isEnabled });
    this.trendlineEngine.updateConfig({ isEnabled: this.config.trendlineConfig.isEnabled });

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_indicators_master: enabled });
    }

    if (!enabled) {
      this.dispose();
    }
  }

  /**
   * Set NSDT Auto S/R Module Toggle
   */
  setNSDTEnabled(enabled) {
    this.config.nsdtConfig.isEnabled = enabled && this.config.masterEnabled;
    this.nsdtEngine.updateConfig({ isEnabled: this.config.nsdtConfig.isEnabled });

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_nsdt_enabled: enabled });
    }

    if (!this.config.nsdtConfig.isEnabled) {
      this.nsdtEngine.dispose();
    }
  }

  /**
   * Set Trendline 30/30 Module Toggle
   */
  setTrendlineEnabled(enabled) {
    this.config.trendlineConfig.isEnabled = enabled && this.config.masterEnabled;
    this.trendlineEngine.updateConfig({ isEnabled: this.config.trendlineConfig.isEnabled });

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_trendline_enabled: enabled });
    }

    if (!this.config.trendlineConfig.isEnabled) {
      this.trendlineEngine.dispose();
    }
  }

  /**
   * Update and compute indicators for visible candles
   */
  update(candles = []) {
    this.latestCandles = candles || [];
    const count = this.latestCandles.length;
    const hasSufficientData = count >= this.config.minBarsRequired;

    // ZERO FOOTPRINT RULE: If master switch is OFF, return completely inert stub
    if (!this.config.masterEnabled) {
      return this.createInactiveState('Master indicators switch is OFF');
    }

    // Data Quality Gate
    if (!hasSufficientData) {
      return {
        masterEnabled: true,
        nsdtStatus: 'DATA_ERROR',
        trendlineStatus: 'DATA_ERROR',
        nsdtState: null,
        trendlineState: null,
        drawings: [],
        events: [],
        confluenceSummary: { totalBonus: 0, totalPenalty: 0, netScore: 0, notes: [] },
        dataQuality: {
          barCount: count,
          hasSufficientData: false,
          warningMessage: `Data unavailable: requires >= ${this.config.minBarsRequired} bars (loaded ${count} bars). Indicator calculation disabled.`
        }
      };
    }

    // Compute NSDT if enabled
    let nsdtRes = null;
    let nsdtStatus = 'OFF';
    if (this.config.nsdtConfig.isEnabled) {
      nsdtRes = this.nsdtEngine.calculate(this.latestCandles);
      nsdtStatus = nsdtRes ? 'ON' : 'COMPUTING';
    }

    // Compute Trendlines if enabled
    let trendlineRes = null;
    let trendlineStatus = 'OFF';
    if (this.config.trendlineConfig.isEnabled) {
      trendlineRes = this.trendlineEngine.calculate(this.latestCandles);
      trendlineStatus = trendlineRes ? 'ON' : 'COMPUTING';
    }

    // Synthesize Drawings
    const drawings = [];

    // NSDT Lines & Clusters
    if (nsdtRes && nsdtRes.levels) {
      const lvls = nsdtRes.levels;
      [lvls.r1, lvls.s1, lvls.r2, lvls.s2, lvls.r3, lvls.s3].forEach((l) => {
        if (l.price !== null) {
          drawings.push({
            type: 'HORIZONTAL_LINE',
            id: `NSDT-${l.id}`,
            y1: l.price,
            color: l.color,
            width: l.width,
            style: l.tier === 1 ? 'dotted' : l.tier === 2 ? 'dashed' : 'solid',
            label: `${l.id}: ${l.price.toFixed(1)} [${l.status}]`,
            tag: l.id
          });
        }
      });

      // Cluster Shading Zones
      if (nsdtRes.clusters) {
        nsdtRes.clusters.forEach((c) => {
          drawings.push({
            type: 'ZONE_BOX',
            id: `CLUSTER-${c.id}`,
            y1: c.topPrice,
            y2: c.bottomPrice,
            color: c.strength === 'EXTREME' ? 'rgba(249, 115, 22, 0.18)' : 'rgba(251, 191, 36, 0.12)',
            width: 1,
            label: c.description
          });
        });
      }
    }

    // Trendline 30/30 Drawings
    if (trendlineRes) {
      if (trendlineRes.downtrendLine) {
        const dtl = trendlineRes.downtrendLine;
        drawings.push({
          type: 'TRENDLINE',
          id: dtl.id,
          y1: dtl.p1.price,
          y2: dtl.currentProjectedPrice,
          x1: dtl.p1.barIndex,
          x2: count - 1,
          color: this.config.trendlineConfig.downColor,
          width: this.config.trendlineConfig.lineWidth,
          style: dtl.isBroken ? 'dashed' : 'solid',
          label: `DTL 30/30 (${dtl.touches}t) -> ${dtl.currentProjectedPrice}`
        });
      }

      if (trendlineRes.uptrendLine) {
        const utl = trendlineRes.uptrendLine;
        drawings.push({
          type: 'TRENDLINE',
          id: utl.id,
          y1: utl.p1.price,
          y2: utl.currentProjectedPrice,
          x1: utl.p1.barIndex,
          x2: count - 1,
          color: this.config.trendlineConfig.upColor,
          width: this.config.trendlineConfig.lineWidth,
          style: utl.isBroken ? 'dashed' : 'solid',
          label: `UTL 30/30 (${utl.touches}t) -> ${utl.currentProjectedPrice}`
        });
      }
    }

    // Synthesize Events
    const events = [];
    if (nsdtRes?.alerts.freshCrossEvents) {
      events.push(...nsdtRes.alerts.freshCrossEvents);
    }
    if (trendlineRes?.events) {
      events.push(...trendlineRes.events);
    }

    // Synthesize Confluence Summary
    const totalBonus = (nsdtRes?.confluenceContribution.locationBonus || 0) + (trendlineRes?.confluenceContribution.bonus || 0);
    const totalPenalty = (nsdtRes?.confluenceContribution.obstaclePenalty || 0) + (trendlineRes?.confluenceContribution.penalty || 0);
    const netScore = totalBonus - totalPenalty;
    const notes = [
      ...(nsdtRes?.confluenceContribution.notes || []),
      ...(trendlineRes?.confluenceContribution.notes || [])
    ];

    this.state = {
      masterEnabled: true,
      nsdtStatus,
      trendlineStatus,
      nsdtState: nsdtRes,
      trendlineState: trendlineRes,
      drawings,
      events,
      confluenceSummary: {
        totalBonus,
        totalPenalty,
        netScore,
        notes
      },
      dataQuality: {
        barCount: count,
        hasSufficientData: true,
        warningMessage: null
      }
    };

    return this.state;
  }

  getState() {
    return this.state;
  }

  getDrawings() {
    return this.state?.drawings || [];
  }

  dispose() {
    this.nsdtEngine.dispose();
    this.trendlineEngine.dispose();
    this.state = null;
  }

  createInactiveState(reason) {
    return {
      masterEnabled: false,
      nsdtStatus: 'OFF',
      trendlineStatus: 'OFF',
      nsdtState: null,
      trendlineState: null,
      drawings: [],
      events: [],
      confluenceSummary: { totalBonus: 0, totalPenalty: 0, netScore: 0, notes: [] },
      dataQuality: {
        barCount: this.latestCandles.length,
        hasSufficientData: false,
        warningMessage: reason
      }
    };
  }
}
