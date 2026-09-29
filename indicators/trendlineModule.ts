/**
 * TradeSight NIFTY 50 - Trendline Module Wrapper (TypeScript)
 *
 * Implements Common Indicator Lifecycle Interface:
 *   - init(config)
 *   - update(candles)
 *   - getState()
 *   - getDrawings()
 *   - dispose()
 *
 * Adheres strictly to:
 *   - Zero computation, zero drawing, zero events when OFF
 *   - Closed candles only in exchange (IST) time
 *   - chrome.storage persistence
 */

import { TrendlineEngine, TrendlineConfig, TrendlineState, DEFAULT_TRENDLINE_PRO_CONFIG } from './trendlinePro.js';
import { Candle } from './pine-helpers.js';

export interface Indicator<TConfig, TState, TDrawing> {
  init(config?: Partial<TConfig>): Promise<void> | void;
  update(candles: Candle[]): TState;
  getState(): TState;
  getDrawings(): TDrawing[];
  dispose(): void;
}

export class TrendlineModule implements Indicator<TrendlineConfig, TrendlineState, any> {
  private engine: TrendlineEngine;
  private isEnabled: boolean = false;

  constructor(cfg: Partial<TrendlineConfig> = {}) {
    this.isEnabled = cfg.isEnabled ?? false;
    this.engine = new TrendlineEngine({ ...DEFAULT_TRENDLINE_PRO_CONFIG, ...cfg, isEnabled: this.isEnabled });
  }

  public async init(config: Partial<TrendlineConfig> = {}): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
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

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.engine.setEnabled(enabled);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_trendline_pro_enabled: enabled });
    }
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  public updateConfig(config: Partial<TrendlineConfig>): void {
    this.engine.updateConfig(config);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ ts_trendline_pro_cfg: this.engine.getConfig() });
    }
  }

  public getConfig(): TrendlineConfig {
    return this.engine.getConfig();
  }

  /**
   * Evaluates trendline geometry on CLOSED candles only.
   */
  public update(candles: Candle[]): TrendlineState {
    if (!this.isEnabled) {
      return this.engine.update([], { lastClosed: true });
    }
    // Feed only closed candles
    return this.engine.update(candles, { lastClosed: true });
  }

  public getState(): TrendlineState {
    return this.engine.getState();
  }

  public getDrawings(): any[] {
    if (!this.isEnabled) return [];
    return this.engine.getDrawings();
  }

  public getEvents(): any[] {
    if (!this.isEnabled) return [];
    return this.engine.getEvents();
  }

  public dispose(): void {
    this.engine.dispose();
  }
}
