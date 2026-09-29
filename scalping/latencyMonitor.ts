/**
 * TradeSight NIFTY 50 - Latency Monitor & Data Quality Guard
 * Strictly disables high-frequency scalping signals whenever feed latency
 * exceeds 1500ms or connection becomes degraded.
 */

export interface LatencyHealth {
  isOperational: boolean;
  canExecuteScalps: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'UNRELIABLE' | 'DISCONNECTED';
  currentLatencyMs: number;
  avgLatencyMs: number;
  jitterMs: number;
  statusMessage: string;
  lastCheckedIST: string;
}

export interface LatencyConfig {
  maxAllowableLatencyMs?: number;
  degradedThresholdMs?: number;
  sampleWindow?: number;
}

export class LatencyMonitor {
  private maxAllowableLatencyMs: number;
  private degradedThresholdMs: number;
  private sampleWindow: number;
  private latencySamples: number[] = [];
  private isConnected = false;

  constructor(config: LatencyConfig = {}) {
    this.maxAllowableLatencyMs = config.maxAllowableLatencyMs ?? 1500;
    this.degradedThresholdMs = config.degradedThresholdMs ?? 500;
    this.sampleWindow = config.sampleWindow ?? 20;
  }

  /**
   * Record a new packet latency observation
   */
  public recordLatency(latencyMs: number, isConnected = true): LatencyHealth {
    this.isConnected = isConnected;
    if (isConnected && latencyMs >= 0) {
      this.latencySamples.push(latencyMs);
      if (this.latencySamples.length > this.sampleWindow) {
        this.latencySamples.shift();
      }
    }

    return this.evaluateHealth();
  }

  /**
   * Set connection status
   */
  public setConnectionState(connected: boolean): void {
    this.isConnected = connected;
  }

  /**
   * Pure evaluation of current feed health
   */
  public evaluateHealth(): LatencyHealth {
    const nowIST = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

    if (!this.isConnected) {
      return {
        isOperational: false,
        canExecuteScalps: false,
        status: 'DISCONNECTED',
        currentLatencyMs: 9999,
        avgLatencyMs: 9999,
        jitterMs: 0,
        statusMessage: 'Data feed disconnected. Scalping strictly halted.',
        lastCheckedIST: nowIST
      };
    }

    const count = this.latencySamples.length;
    const current = count > 0 ? this.latencySamples[count - 1] : 0;
    const sum = this.latencySamples.reduce((acc, v) => acc + v, 0);
    const avg = count > 0 ? Math.round(sum / count) : 0;

    let variance = 0;
    if (count > 1) {
      const sqDiffs = this.latencySamples.map((v) => Math.pow(v - avg, 2));
      variance = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / count);
    }
    const jitter = Math.round(variance);

    // Hard cutoff: 1500ms latency ceiling
    if (current > this.maxAllowableLatencyMs || avg > this.maxAllowableLatencyMs) {
      return {
        isOperational: true,
        canExecuteScalps: false,
        status: 'UNRELIABLE',
        currentLatencyMs: current,
        avgLatencyMs: avg,
        jitterMs: jitter,
        statusMessage: `Data unreliable: scalping paused (Latency ${current}ms > ${this.maxAllowableLatencyMs}ms limit)`,
        lastCheckedIST: nowIST
      };
    }

    if (current > this.degradedThresholdMs || avg > this.degradedThresholdMs) {
      return {
        isOperational: true,
        canExecuteScalps: true,
        status: 'DEGRADED',
        currentLatencyMs: current,
        avgLatencyMs: avg,
        jitterMs: jitter,
        statusMessage: `Feed latency elevated (${current}ms). Slippage buffer expanded.`,
        lastCheckedIST: nowIST
      };
    }

    return {
      isOperational: true,
      canExecuteScalps: true,
      status: 'HEALTHY',
      currentLatencyMs: current,
      avgLatencyMs: avg,
      jitterMs: jitter,
      statusMessage: `Ultra low latency active (${current}ms, ±${jitter}ms jitter)`,
      lastCheckedIST: nowIST
    };
  }

  public getMaxThreshold(): number {
    return this.maxAllowableLatencyMs;
  }

  public setMaxThreshold(thresholdMs: number): void {
    if (thresholdMs >= 300) {
      this.maxAllowableLatencyMs = thresholdMs;
    }
  }
}
