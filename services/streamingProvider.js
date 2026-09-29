/**
 * TradeSight NIFTY 50 - Low-Latency Streaming Market Data Provider (Runtime ESM)
 * Provides unified abstraction for real-time WebSocket tick feeds,
 * connection lifecycle management, exponential backoff, and latency tracking.
 */

export class StreamingProvider {
  constructor(config = {}) {
    this.config = {
      wsUrl: config.wsUrl || '',
      broker: config.broker || 'MOCK',
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 3000,
      latencyAlertThresholdMs: config.latencyAlertThresholdMs ?? 1500,
      bufferSize: config.bufferSize ?? 120
    };

    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastPingTime = 0;
    this.tickListeners = new Set();
    this.statusListeners = new Set();
    this.tickBuffer = [];
    this.currentLatencyMs = 0;
    this.mockTickInterval = null;
  }

  /**
   * Connect to WebSocket or Start Low-Latency Mock Stream
   */
  connect() {
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
  disconnect() {
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
  initWebSocket() {
    try {
      this.socket = new WebSocket(this.config.wsUrl);

      this.socket.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.notifyStatus(true, this.currentLatencyMs, false, 'WebSocket feed connected (low-latency)');
      };

      this.socket.onmessage = (event) => {
        const receiveTime = Date.now();
        try {
          const raw = JSON.parse(event.data);
          const serverTime = raw.timestamp || raw.t || receiveTime;
          this.currentLatencyMs = Math.max(0, receiveTime - serverTime);

          const tick = {
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
        } catch (err) {}
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
  handleConnectionFailure(reason) {
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

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === 1) { // WebSocket.OPEN = 1
        this.lastPingTime = Date.now();
        try {
          this.socket.send(JSON.stringify({ type: 'PING', timestamp: this.lastPingTime }));
        } catch (e) {}
      }
    }, this.config.heartbeatIntervalMs);
  }

  initSimulatedStream() {
    if (this.mockTickInterval) clearInterval(this.mockTickInterval);

    this.isConnected = true;
    this.currentLatencyMs = 45 + Math.round(Math.random() * 40);
    this.notifyStatus(true, this.currentLatencyMs, false, 'Streaming engine active (High-frequency sub-second)');

    let basePrice = 24120.0;
    let baseVol = 50000;

    this.mockTickInterval = setInterval(() => {
      const now = Date.now();
      const delta = (Math.random() - 0.495) * 4.5;
      basePrice = Math.round((basePrice + delta) * 20) / 20;
      baseVol += Math.round(Math.random() * 250);

      const tick = {
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
    }, 1000);
  }

  processIncomingTick(tick) {
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

  onTick(callback) {
    this.tickListeners.add(callback);
    return () => this.tickListeners.delete(callback);
  }

  onStatus(callback) {
    this.statusListeners.add(callback);
    callback({
      connected: this.isConnected,
      latencyMs: this.currentLatencyMs,
      reconnecting: this.reconnectAttempts > 0,
      message: this.isConnected ? 'Connected' : 'Disconnected'
    });
    return () => this.statusListeners.delete(callback);
  }

  notifyStatus(connected, latencyMs, reconnecting, message) {
    this.statusListeners.forEach((l) => {
      try {
        l({ connected, latencyMs, reconnecting, message });
      } catch (e) {}
    });
  }

  getRecentTicks(count = 30) {
    return this.tickBuffer.slice(-count);
  }

  getLatency() {
    return this.currentLatencyMs;
  }

  isStreamConnected() {
    return this.isConnected;
  }
}
