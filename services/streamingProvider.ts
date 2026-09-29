/**
 * TradeSight NIFTY 50 - Low-Latency Streaming Market Data Provider
 * Provides unified abstraction for real-time WebSocket tick feeds,
 * connection lifecycle management, exponential backoff, and latency tracking.
 */

export interface MarketTick {
  symbol: string;
  price: number;
  timestamp: number; // IST Epoch milliseconds
  volume: number;
  openInterest?: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
  buyDepthTotal?: number;
  sellDepthTotal?: number;
  tickLatencyMs: number;
  source: 'WEBSOCKET' | 'SIMULATED' | 'CHART_FALLBACK';
}

export interface StreamingConfig {
  wsUrl?: string;
  broker?: 'KITE' | 'UPSTOX' | 'DHAN' | 'GENERIC_WS' | 'MOCK';
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  latencyAlertThresholdMs?: number;
  bufferSize?: number;
}

export type TickCallback = (tick: MarketTick) => void;
export type StatusCallback = (status: { connected: boolean; latencyMs: number; reconnecting: boolean; message: string }) => void;

export class StreamingProvider {
  private config: Required<StreamingConfig>;
  private socket: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private lastPingTime = 0;
  private tickListeners: Set<TickCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private tickBuffer: MarketTick[] = [];
  private currentLatencyMs = 0;
  private mockTickInterval: any = null;

  constructor(config: StreamingConfig = {}) {
    this.config = {
      wsUrl: config.wsUrl || '',
      broker: config.broker || 'MOCK',
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 3000,
      latencyAlertThresholdMs: config.latencyAlertThresholdMs ?? 1500,
      bufferSize: config.bufferSize ?? 120
    };
  }

  /**
   * Connect to WebSocket or Start Low-Latency Mock Stream
   */
  public connect(): void {
    if (this.isConnected) return;

    if (this.config.wsUrl && typeof WebSocket !== 'undefined') {
      this.initWebSocket();
    } else {
      this.initSimulatedStream();
    }
  }

  /**
   * Disconnect and clean up resources
   */
  public disconnect(): void {
    this.isConnected = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.mockTickInterval) clearInterval(this.mockTickInterval);

    this.notifyStatus(false, 0, false, 'Streaming disconnected');
  }

  /**
   * Initialize native WebSocket connection with error handling
   */
  private initWebSocket(): void {
    try {
      this.socket = new WebSocket(this.config.wsUrl);

      this.socket.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.notifyStatus(true, this.currentLatencyMs, false, 'WebSocket feed connected (low-latency)');
      };

      this.socket.onmessage = (event: MessageEvent) => {
        const receiveTime = Date.now();
        try {
          const raw = JSON.parse(event.data);
          const serverTime = raw.timestamp || raw.t || receiveTime;
          this.currentLatencyMs = Math.max(0, receiveTime - serverTime);

          const tick: MarketTick = {
            symbol: raw.symbol || 'NIFTY',
            price: parseFloat(raw.price || raw.ltp),
            timestamp: serverTime,
            volume: parseInt(raw.volume || raw.v || 0, 10),
            openInterest: raw.oi ? parseInt(raw.oi, 10) : undefined,
            bidPrice: raw.bid ? parseFloat(raw.bid) : undefined,
            askPrice: raw.ask ? parseFloat(raw.ask) : undefined,
            buyDepthTotal: raw.totalBuyQty,
            sellDepthTotal: raw.totalSellQty,
            tickLatencyMs: this.currentLatencyMs,
            source: 'WEBSOCKET'
          };

          this.processIncomingTick(tick);
        } catch (err) {
          // Packet parse error
        }
      };

      this.socket.onerror = () => {
        this.handleConnectionFailure('WebSocket stream error encountered');
      };

      this.socket.onclose = () => {
        this.handleConnectionFailure('WebSocket connection closed by host');
      };
    } catch (e) {
      this.handleConnectionFailure('Failed to instantiate WebSocket');
    }
  }

  /**
   * Reconnection with exponential backoff and jitter
   */
  private handleConnectionFailure(reason: string): void {
    this.isConnected = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const backoffMs = Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 500);
      this.notifyStatus(false, 9999, true, `${reason}. Reconnecting attempt ${this.reconnectAttempts} in ${Math.round(backoffMs)}ms...`);

      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, backoffMs);
    } else {
      this.notifyStatus(false, 9999, false, 'Max reconnect attempts exceeded. Falling back to local data loop.');
      this.initSimulatedStream();
    }
  }

  /**
   * Ping/Pong Heartbeat to measure socket latency
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        try {
          this.socket.send(JSON.stringify({ type: 'PING', timestamp: this.lastPingTime }));
        } catch (e) {}
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Simulated low-latency tick feed (for offline/paper trading / TradingView fallback)
   */
  private initSimulatedStream(): void {
    if (this.mockTickInterval) clearInterval(this.mockTickInterval);

    this.isConnected = true;
    this.currentLatencyMs = 45 + Math.round(Math.random() * 40); // 45-85ms realistic domestic latency
    this.notifyStatus(true, this.currentLatencyMs, false, 'Streaming engine active (High-frequency sub-second)');

    let basePrice = 24120.0;
    let baseVol = 50000;

    this.mockTickInterval = setInterval(() => {
      const now = Date.now();
      const delta = (Math.random() - 0.495) * 4.5;
      basePrice = Math.round((basePrice + delta) * 20) / 20; // 0.05 tick size
      baseVol += Math.round(Math.random() * 250);

      const tick: MarketTick = {
        symbol: 'NIFTY 50',
        price: basePrice,
        timestamp: now - 35,
        volume: baseVol,
        bidPrice: basePrice - 0.05,
        askPrice: basePrice + 0.05,
        buyDepthTotal: 15000 + Math.round(Math.random() * 5000),
        sellDepthTotal: 14800 + Math.round(Math.random() * 5000),
        tickLatencyMs: 35 + Math.round(Math.random() * 25),
        source: 'SIMULATED'
      };

      this.processIncomingTick(tick);
    }, 1000); // 1-second ticks
  }

  /**
   * Process tick into buffer and emit to listeners
   */
  public processIncomingTick(tick: MarketTick): void {
    this.currentLatencyMs = tick.tickLatencyMs;
    this.tickBuffer.push(tick);
    if (this.tickBuffer.length > this.config.bufferSize) {
      this.tickBuffer.shift();
    }

    this.tickListeners.forEach((listener) => {
      try {
        listener(tick);
      } catch (err) {}
    });
  }

  public onTick(callback: TickCallback): () => void {
    this.tickListeners.add(callback);
    return () => this.tickListeners.delete(callback);
  }

  public onStatus(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    callback({
      connected: this.isConnected,
      latencyMs: this.currentLatencyMs,
      reconnecting: this.reconnectAttempts > 0,
      message: this.isConnected ? 'Connected' : 'Disconnected'
    });
    return () => this.statusListeners.delete(callback);
  }

  private notifyStatus(connected: boolean, latencyMs: number, reconnecting: boolean, message: string): void {
    this.statusListeners.forEach((l) => {
      try {
        l({ connected, latencyMs, reconnecting, message });
      } catch (e) {}
    });
  }

  public getRecentTicks(count = 30): MarketTick[] {
    return this.tickBuffer.slice(-count);
  }

  public getLatency(): number {
    return this.currentLatencyMs;
  }

  public isStreamConnected(): boolean {
    return this.isConnected;
  }
}
