/**
 * TradeSight NIFTY 50 - Trendline Module Wrapper (Runtime ESM)
 *
 * Implements Common Indicator Lifecycle Interface:
 *   - init(config)
 *   - update(candles)
 *   - getState()
 *   - getDrawings()
 *   - dispose()
 */

import { TrendlineEngine, DEFAULT_TRENDLINE_PRO_CONFIG } from './trendlinePro.js';

export class TrendlineModule {
  constructor(cfg = {}) {
    this.isEnabled = cfg.isEnabled ?? false;
    this.engine = new TrendlineEngine({ ...DEFAULT_TRENDLINE_PRO_CONFIG, ...cfg, isEnabled: this.isEnabled });
  }

  async init(config = {}) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise((resolve) => {
        chrome.storage.local.get(['ts_trendline_pro_enabled', 'ts_trendline_pro_cfg'], (res) => {
          if (res.ts_trendline_pro_enabled !== undefined) {
            this.isEnabled = res.ts_trendline_pro_enabled === true;
          }
          if (res.ts_trendline_pro_cfg) {
            config = { ...config, ...res.ts_trendline_pro_cfg };
          }
          this.engine.updateConfig({ ...config, isEnabled: this.isEnabled });
          resolve();
        });
      });
    } else {
      this.engine.updateConfig({ ...config, isEnabled: this.isEnabled });
    }
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.engine.setEnabled(enabled);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_trendline_pro_enabled: enabled });
    }
  }

  getEnabled() {
    return this.isEnabled;
  }

  updateConfig(config) {
    this.engine.updateConfig(config);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_trendline_pro_cfg: this.engine.getConfig() });
    }
  }

  getConfig() {
    return this.engine.getConfig();
  }

  update(candles) {
    if (!this.isEnabled) {
      return this.engine.update([], { lastClosed: true });
    }
    return this.engine.update(candles, { lastClosed: true });
  }

  getState() {
    return this.engine.getState();
  }

  getDrawings() {
    if (!this.isEnabled) return [];
    return this.engine.getDrawings();
  }

  getEvents() {
    if (!this.isEnabled) return [];
    return this.engine.getEvents();
  }

  dispose() {
    this.engine.dispose();
  }
}
