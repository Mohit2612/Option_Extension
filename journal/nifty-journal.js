/**
 * TradeSight NIFTY 50 - Journal & Backtesting Engine
 * Logs verified signals, computes empirical performance by strategy and time of day,
 * and runs historical candle simulation. Paper trading mode by default.
 */

import { StrategyEngine } from '../strategies/strategy-engine.js';
import { NIFTY_CONFIG } from '../config/nifty-config.js';

export const NiftyJournalEngine = {
  STORAGE_KEY: 'ts_nifty_journal_v2',

  /**
   * Retrieve all journaled trades
   */
  async getTrades() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.STORAGE_KEY], (res) => {
        resolve(Array.isArray(res[this.STORAGE_KEY]) ? res[this.STORAGE_KEY] : []);
      });
    });
  },

  /**
   * Log a new Nifty signal to the journal
   */
  async logSignal(signalData, driverData, chartMeta) {
    if (!signalData || signalData.signal === 'WAIT') return null;

    const trades = await this.getTrades();
    const entryPrice = signalData.levels?.entryPrice || chartMeta?.currentPrice || 24100;
    const stopLoss = signalData.levels?.stopLoss || entryPrice - 30;
    const target1 = signalData.levels?.target1 || entryPrice + 60;
    const risk = Math.abs(entryPrice - stopLoss);

    const newTrade = {
      id: 'nifty_' + Date.now(),
      timestamp: new Date().toISOString(),
      timeOfDay: this.getTimeOfDayBucket(new Date()),
      symbol: chartMeta?.symbol || 'NIFTY 50',
      timeframe: chartMeta?.timeframe || '5m',
      strategyName: signalData.strategyName,
      signal: signalData.signal,
      pattern: signalData.pattern?.name || 'Structural Price Action',
      pressureScore: driverData?.pressureScore || 0,
      vixLevel: driverData?.vixAnalysis?.details || 'N/A',
      entryPrice,
      stopLoss,
      target1,
      target2: signalData.levels?.target2 || entryPrice + 90,
      riskPoints: Math.round(risk * 10) / 10,
      riskReward: signalData.riskRewardRatio || 2.0,
      status: 'OPEN', // OPEN | WIN | LOSS | BREAKEVEN | INVALIDATED
      exitPrice: null,
      realizedR: 0,
      notes: ''
    };

    trades.unshift(newTrade);
    await chrome.storage.local.set({ [this.STORAGE_KEY]: trades });
    return newTrade;
  },

  /**
   * Update trade status
   */
  async updateTrade(id, status, exitPrice = null) {
    const trades = await this.getTrades();
    const index = trades.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const t = trades[index];
    t.status = status;
    t.exitPrice = exitPrice;

    if (status === 'WIN') {
      t.realizedR = t.riskReward || 2.0;
    } else if (status === 'LOSS') {
      t.realizedR = -1.0;
    } else if (status === 'BREAKEVEN') {
      t.realizedR = 0;
    } else if (status === 'INVALIDATED') {
      t.realizedR = 0;
    }

    trades[index] = t;
    await chrome.storage.local.set({ [this.STORAGE_KEY]: trades });
    return t;
  },

  /**
   * Compute comprehensive empirical dashboard analytics
   */
  async getDashboardAnalytics() {
    const trades = await this.getTrades();
    const closed = trades.filter((t) => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'BREAKEVEN');

    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.status === 'WIN').length;
    const losses = trades.filter((t) => t.status === 'LOSS').length;
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;

    let cumulativeR = 0;
    let peakR = 0;
    let maxDrawdownR = 0;

    closed.forEach((t) => {
      cumulativeR += (t.realizedR || 0);
      if (cumulativeR > peakR) peakR = cumulativeR;
      const dd = peakR - cumulativeR;
      if (dd > maxDrawdownR) maxDrawdownR = dd;
    });

    const avgR = closed.length > 0 ? (cumulativeR / closed.length).toFixed(2) : '0.00';

    // Performance Breakdown by Strategy
    const strategyStats = {};
    trades.forEach((t) => {
      const name = t.strategyName || 'Other';
      if (!strategyStats[name]) {
        strategyStats[name] = { total: 0, wins: 0, losses: 0, netR: 0 };
      }
      strategyStats[name].total++;
      if (t.status === 'WIN') {
        strategyStats[name].wins++;
        strategyStats[name].netR += (t.realizedR || 2.0);
      } else if (t.status === 'LOSS') {
        strategyStats[name].losses++;
        strategyStats[name].netR -= 1.0;
      }
    });

    // Performance Breakdown by Time of Day
    const timeStats = {
      'Morning (09:20 - 11:30)': { total: 0, wins: 0, losses: 0 },
      'Lunch Chop (11:30 - 13:30)': { total: 0, wins: 0, losses: 0 },
      'Afternoon / Expiry (13:30 - 15:15)': { total: 0, wins: 0, losses: 0 }
    };

    trades.forEach((t) => {
      const bucket = t.timeOfDay || 'Morning (09:20 - 11:30)';
      if (timeStats[bucket]) {
        timeStats[bucket].total++;
        if (t.status === 'WIN') timeStats[bucket].wins++;
        if (t.status === 'LOSS') timeStats[bucket].losses++;
      }
    });

    return {
      totalTrades,
      closedTradesCount: closed.length,
      winRate,
      cumulativeNetR: parseFloat(cumulativeR.toFixed(2)),
      avgR,
      maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
      strategyStats,
      timeStats,
      recentTrades: trades.slice(0, 15)
    };
  },

  getTimeOfDayBucket(date) {
    const mins = date.getHours() * 60 + date.getMinutes();
    if (mins >= 9 * 60 + 20 && mins < 11 * 60 + 30) return 'Morning (09:20 - 11:30)';
    if (mins >= 11 * 60 + 30 && mins < 13 * 60 + 30) return 'Lunch Chop (11:30 - 13:30)';
    return 'Afternoon / Expiry (13:30 - 15:15)';
  },

  /**
   * Historical Backtesting Simulator
   * Replays historical candles through StrategyEngine and calculates empirical edge.
   */
  runHistoricalBacktest(historicalCandles = [], userConfig = {}) {
    if (historicalCandles.length < 30) {
      return { error: 'Backtesting requires at least 30 historical candles.' };
    }

    const simulatedTrades = [];
    const windowSize = 20;

    for (let i = windowSize; i < historicalCandles.length - 5; i++) {
      const windowCandles = historicalCandles.slice(i - windowSize, i);
      const currentCandle = historicalCandles[i];
      const nextCandles = historicalCandles.slice(i + 1, Math.min(historicalCandles.length, i + 12));

      // Calculate pseudo key levels
      const closes = windowCandles.map((c) => c.close);
      const vwap = closes.reduce((a, b) => a + b, 0) / closes.length;
      const pdh = Math.max(...windowCandles.map((c) => c.high));
      const pdl = Math.min(...windowCandles.map((c) => c.low));

      const setup = StrategyEngine.evaluateSetup({
        candles: windowCandles,
        keyLevels: { vwap, pdh, pdl, orh: pdh, orl: pdl },
        driverData: { pressureScore: 25, vixAnalysis: { details: 'Level: 13.5' } },
        currentTime: new Date(currentCandle.timestamp || Date.now()),
        userConfig
      });

      if (setup && setup.signal !== 'WAIT' && setup.levels) {
        // Simulate execution across next candles
        const { entryPrice, stopLoss, target1 } = setup.levels;
        let outcome = 'OPEN';
        let exitPrice = entryPrice;

        for (const nextBar of nextCandles) {
          if (setup.signal === 'BUY') {
            if (nextBar.low <= stopLoss) {
              outcome = 'LOSS';
              exitPrice = stopLoss;
              break;
            }
            if (nextBar.high >= target1) {
              outcome = 'WIN';
              exitPrice = target1;
              break;
            }
          } else if (setup.signal === 'SELL') {
            if (nextBar.high >= stopLoss) {
              outcome = 'LOSS';
              exitPrice = stopLoss;
              break;
            }
            if (nextBar.low <= target1) {
              outcome = 'WIN';
              exitPrice = target1;
              break;
            }
          }
        }

        simulatedTrades.push({
          barIndex: i,
          strategy: setup.strategyName,
          signal: setup.signal,
          entryPrice,
          stopLoss,
          target1,
          outcome,
          exitPrice,
          rr: setup.riskRewardRatio
        });

        // Fast forward 5 bars to avoid overlapping signals
        i += 4;
      }
    }

    const wins = simulatedTrades.filter((t) => t.outcome === 'WIN').length;
    const losses = simulatedTrades.filter((t) => t.outcome === 'LOSS').length;
    const completed = wins + losses;
    const winRate = completed > 0 ? Math.round((wins / completed) * 100) : 0;
    const profitFactor = losses > 0 ? ((wins * 2.0) / losses).toFixed(2) : (wins > 0 ? '99.0' : '0.0');

    return {
      totalSignals: simulatedTrades.length,
      completed,
      wins,
      losses,
      winRate,
      profitFactor,
      netR: (wins * 2.0 - losses * 1.0).toFixed(1),
      simulatedTrades
    };
  }
};
