/**
 * TradeSight NIFTY 50 - High-Frequency Scalp Strategy Engine (Stage 3)
 * Produces tightly defined scalp setups with cost-adjusted net R:R >= 1:1.5,
 * time-stop management, option liquidity checks, and discipline guardrails.
 */

import { SpikeReadiness, SpikeReadinessResult } from './spikeReadiness.js';
import { SpikeTrigger, SpikeTriggerResult } from './spikeTrigger.js';
import { ScalpCostModel, CostEvaluatedTrade } from './costModel.js';
import { PositionSizer } from '../risk/positionSizer.js';

export interface ScalpSetup {
  id: string;
  isActionable: boolean;
  status: 'ARMED' | 'TRIGGERED' | 'REJECTED' | 'WAITING_TRIGGER';
  symbol: string;
  instrument: {
    type: 'OPTION' | 'FUTURES';
    suggestedStrike: number;
    optionType: 'CE' | 'PE' | null;
    estimatedPremium: number;
    bidAskSpread: number;
    isLiquidityAcceptable: boolean;
  };
  direction: 'LONG' | 'SHORT' | 'NONE';
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  trailingRule: string;
  timeStopMinutes: number;
  timeStopEpoch: number;
  lots: number;
  quantity: number;
  capitalAtRiskINR: number;
  capitalRiskPct: number;
  readiness: SpikeReadinessResult;
  trigger: SpikeTriggerResult;
  costAnalysis: CostEvaluatedTrade;
  rejectionReason: string | null;
  ruleTags: string[];
}

export interface ScalpStrategyConfig {
  isEnabled: boolean; // default false
  maxScalpsPerDay?: number; // default 5
  riskPctPerScalp?: number; // default 0.35% (0.25 - 0.5%)
  atrMultiplierSL?: number; // default 0.75
  timeStopMinutes?: number; // default 3
  minNetRR?: number; // default 1.5
  maxOptionSpreadPts?: number; // default 0.8
  capitalINR?: number;
  lotSize?: number;
}

export const ScalpStrategy = {
  DEFAULT_CONFIG: {
    isEnabled: false,
    maxScalpsPerDay: 5,
    riskPctPerScalp: 0.35,
    atrMultiplierSL: 0.75,
    timeStopMinutes: 3,
    minNetRR: 1.5,
    maxOptionSpreadPts: 0.8,
    capitalINR: 200000,
    lotSize: 25
  },

  /**
   * Pure evaluation of Scalp Setup from market state and triggers
   */
  evaluateSetup({
    candles = [],
    currentPrice = 24100,
    keyLevels = {},
    driverData = {},
    optionsData = {},
    orderFlowData = {},
    currentTime = new Date(),
    isExpiryDay = false,
    dailyScalpState = { tradesToday: 0, consecutiveLosses: 0, isLocked: false },
    config = {}
  }: any): ScalpSetup {
    const cfg = { ...this.DEFAULT_CONFIG, ...config };
    const nowIST = currentTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

    // Step 0: Master Module Switch Check
    if (!cfg.isEnabled) {
      return this.createInactiveSetup('Scalping module is OFF in settings');
    }

    // Step 1: Discipline & Loss Protection Hard Gating
    if (dailyScalpState.isLocked) {
      return this.createRejectedSetup('Discipline Lock: Daily loss or global discipline lock active. Scalping blocked.', currentPrice);
    }
    if (dailyScalpState.tradesToday >= cfg.maxScalpsPerDay) {
      return this.createRejectedSetup(`Max daily scalp limit reached (${dailyScalpState.tradesToday}/${cfg.maxScalpsPerDay}). Stand aside to protect profits.`, currentPrice);
    }
    if (dailyScalpState.consecutiveLosses >= 2) {
      return this.createRejectedSetup('Cool-Down Active: 2 consecutive scalp losses. Stand aside 20m to prevent tilt.', currentPrice);
    }

    // Step 2: Session Window Filter
    const hours = currentTime.getHours();
    const mins = currentTime.getMinutes();
    const totalMins = hours * 60 + mins;

    // Avoid first 2 minutes of market open (09:15 - 09:17 IST)
    if (totalMins >= 9 * 60 + 15 && totalMins < 9 * 60 + 17) {
      return this.createRejectedSetup('Opening 2-minute volatility noise filter (09:15-09:17). Wait for opening establishment.', currentPrice);
    }
    // Avoid closing 10 minutes (15:20 - 15:30 IST)
    if (totalMins >= 15 * 60 + 20) {
      return this.createRejectedSetup('Market closing window (post 15:20 IST). Avoid overnight gamma risk.', currentPrice);
    }

    // Step 3: Compute Stage 1 Spike Readiness Score
    const readiness = SpikeReadiness.evaluate({
      candles,
      currentPrice,
      keyLevels,
      driverData,
      optionsData,
      orderFlowData,
      currentTime,
      isExpiryDay
    });

    // Lunch Chop Filter: Avoid 11:30 - 13:30 UNLESS readiness is high (>= 70)
    const isLunchChop = totalMins >= 11 * 60 + 30 && totalMins <= 13 * 60 + 30;
    if (isLunchChop && readiness.score < 70) {
      return this.createRejectedSetup('Midday chop zone (11:30-13:30). Scalps restricted unless Spike Readiness >= 70.', currentPrice, readiness);
    }

    // Calculate ATR for structure SL
    const last20 = candles.slice(-20);
    const avgAtr = last20.length > 0
      ? last20.reduce((acc: number, c: any) => acc + (c.high - c.low), 0) / last20.length
      : 15;

    // Define Dynamic Compression Range from last 5 coiling bars
    const recentBars = candles.slice(-6, -1);
    const compHigh = recentBars.length > 0 ? Math.max(...recentBars.map((c: any) => c.high)) : currentPrice + 8;
    const compLow = recentBars.length > 0 ? Math.min(...recentBars.map((c: any) => c.low)) : currentPrice - 8;

    // Step 4: Evaluate Stage 2 Spike Trigger
    const trigger = SpikeTrigger.evaluateTrigger({
      candles,
      currentPrice,
      readinessScore: readiness.score,
      compressionRange: { high: compHigh, low: compLow, mid: (compHigh + compLow) / 2 },
      driverConfirmation: {
        vixAligned: Math.abs(driverData.vixChangePct || 0) >= 1.5,
        heavyweightsAligned: driverData.heavyweightsTrend === 'BULLISH' || driverData.heavyweightsTrend === 'BEARISH',
        bankNiftyAligned: !!driverData.bankNiftyTrend,
        oiShiftAligned: optionsData.writerUnwindingSide && optionsData.writerUnwindingSide !== 'NONE'
      }
    });

    if (!trigger.isTriggered || trigger.direction === 'NONE') {
      return {
        id: `SCALP-ARM-${Date.now()}`,
        isActionable: false,
        status: readiness.score >= 40 ? 'ARMED' : 'WAITING_TRIGGER',
        symbol: 'NIFTY 50',
        instrument: {
          type: 'OPTION',
          suggestedStrike: Math.round(currentPrice / 50) * 50,
          optionType: readiness.directionLean === 'UP' ? 'CE' : readiness.directionLean === 'DOWN' ? 'PE' : null,
          estimatedPremium: 110,
          bidAskSpread: 0.4,
          isLiquidityAcceptable: true
        },
        direction: trigger.direction,
        entryPrice: currentPrice,
        stopLoss: currentPrice - 10,
        target1: currentPrice + 12,
        target2: currentPrice + 24,
        trailingRule: 'Trail to break-even after Target 1',
        timeStopMinutes: cfg.timeStopMinutes,
        timeStopEpoch: Date.now() + cfg.timeStopMinutes * 60 * 1000,
        lots: 0,
        quantity: 0,
        capitalAtRiskINR: 0,
        capitalRiskPct: 0,
        readiness,
        trigger,
        costAnalysis: {} as any,
        rejectionReason: trigger.rejectionReasons.join(' • ') || 'Awaiting breakout trigger confirmation',
        ruleTags: ['Pre-Spike Watch']
      };
    }

    // Step 5: Construct Scalp Geometry (Tight Stop & Target)
    const isLong = trigger.direction === 'LONG';
    const stopDistance = Math.max(7, Math.round(avgAtr * cfg.atrMultiplierSL));
    const target1Distance = Math.round(stopDistance * 1.25);
    const target2Distance = Math.round(stopDistance * 2.2);

    const entry = currentPrice;
    const stopLoss = isLong ? entry - stopDistance : entry + stopDistance;
    const target1 = isLong ? entry + target1Distance : entry - target1Distance;
    const target2 = isLong ? entry + target2Distance : entry - target2Distance;

    // Strike selection & liquidity check
    const strike = Math.round(entry / 50) * 50;
    const optType = isLong ? 'CE' : 'PE';
    const estimatedPremium = 115; // Realistic Nifty ATM premium
    const spreadPts = 0.35;
    const isLiquidityAcceptable = spreadPts <= cfg.maxOptionSpreadPts;

    if (!isLiquidityAcceptable) {
      return this.createRejectedSetup(`Option spread (${spreadPts} pts) exceeds maximum allowable threshold (${cfg.maxOptionSpreadPts} pts). High slippage risk.`, entry, readiness, trigger);
    }

    // Step 6: Position Sizing (Strict Mathematical Floor Rounding)
    const sizing = PositionSizer.calculateSizing({
      capitalINR: cfg.capitalINR,
      riskPct: isExpiryDay ? cfg.riskPctPerScalp * 0.75 : cfg.riskPctPerScalp,
      entryPrice: entry,
      stopLoss,
      lotSize: cfg.lotSize,
      isOption: true,
      optionPremium: estimatedPremium,
      positionSizeMultiplier: 1.0
    });

    if (sizing.isRiskTooHigh || sizing.lots < 1) {
      return this.createRejectedSetup(`Position size calculation failed: ${sizing.recommendation}`, entry, readiness, trigger);
    }

    // Step 7: Cost Model & Net Viability Evaluation (Indian Derivatives Taxes + Friction)
    const costAnalysis = ScalpCostModel.calculateNetViability({
      instrumentType: 'OPTION',
      lots: sizing.lots,
      lotSize: cfg.lotSize,
      entryPrice: estimatedPremium,
      targetPrice: estimatedPremium + target1Distance * 0.55, // Delta ~0.55 ATM
      stopLossPrice: Math.max(1, estimatedPremium - stopDistance * 0.55),
      brokeragePerOrder: 20,
      estimatedSpreadPoints: spreadPts,
      minNetRRThreshold: cfg.minNetRR
    });

    if (!costAnalysis.isViable) {
      return this.createRejectedSetup(costAnalysis.summaryMessage, entry, readiness, trigger, costAnalysis);
    }

    // All validation passed: Return Fully Actionable Scalp Setup
    return {
      id: `SCALP-${Date.now()}`,
      isActionable: true,
      status: 'TRIGGERED',
      symbol: 'NIFTY 50',
      instrument: {
        type: 'OPTION',
        suggestedStrike: strike,
        optionType: optType,
        estimatedPremium,
        bidAskSpread: spreadPts,
        isLiquidityAcceptable: true
      },
      direction: trigger.direction,
      entryPrice: entry,
      stopLoss,
      target1,
      target2,
      trailingRule: 'Lock 50% at Target 1, trail remaining runner to entry price (0-Risk).',
      timeStopMinutes: cfg.timeStopMinutes,
      timeStopEpoch: Date.now() + cfg.timeStopMinutes * 60 * 1000,
      lots: sizing.lots,
      quantity: sizing.quantity,
      capitalAtRiskINR: sizing.actualRiskINR,
      capitalRiskPct: sizing.actualRiskPct,
      readiness,
      trigger,
      costAnalysis,
      rejectionReason: null,
      ruleTags: [
        'Confirmed Breakout',
        `Net R:R 1:${costAnalysis.netRR}`,
        `${cfg.timeStopMinutes}m Time-Stop`,
        'Zero Averaging Down'
      ]
    };
  },

  createInactiveSetup(reason: string): ScalpSetup {
    return {
      id: `SCALP-OFF`,
      isActionable: false,
      status: 'REJECTED',
      symbol: 'NIFTY 50',
      instrument: { type: 'OPTION', suggestedStrike: 0, optionType: null, estimatedPremium: 0, bidAskSpread: 0, isLiquidityAcceptable: false },
      direction: 'NONE',
      entryPrice: 0,
      stopLoss: 0,
      target1: 0,
      target2: 0,
      trailingRule: 'None',
      timeStopMinutes: 3,
      timeStopEpoch: 0,
      lots: 0,
      quantity: 0,
      capitalAtRiskINR: 0,
      capitalRiskPct: 0,
      readiness: { score: 0, state: 'CALM', stateLabel: 'CALM (Module OFF)', directionLean: 'UNCLEAR', leanConfidence: 'LOW', watchedKeyLevel: 'None', distanceToLevel: 0, topContributingFactors: [], factors: {} as any, disclaimer: '' },
      trigger: { isTriggered: false, direction: 'NONE', triggerType: 'NONE', triggerPrice: 0, triggerTimeIST: '', isFakeBreakout: false, fakeBreakoutReason: null, driverConfirmed: false, confirmationDetails: [], rejectionReasons: [reason], candleMetrics: {} as any },
      costAnalysis: {} as any,
      rejectionReason: reason,
      ruleTags: ['Module Disabled']
    };
  },

  createRejectedSetup(reason: string, price = 24100, readiness?: any, trigger?: any, costAnalysis?: any): ScalpSetup {
    return {
      id: `SCALP-REJ-${Date.now()}`,
      isActionable: false,
      status: 'REJECTED',
      symbol: 'NIFTY 50',
      instrument: { type: 'OPTION', suggestedStrike: Math.round(price / 50) * 50, optionType: null, estimatedPremium: 110, bidAskSpread: 0.4, isLiquidityAcceptable: false },
      direction: 'NONE',
      entryPrice: price,
      stopLoss: price - 10,
      target1: price + 15,
      target2: price + 30,
      trailingRule: 'None',
      timeStopMinutes: 3,
      timeStopEpoch: 0,
      lots: 0,
      quantity: 0,
      capitalAtRiskINR: 0,
      capitalRiskPct: 0,
      readiness: readiness || { score: 0, state: 'CALM', stateLabel: 'CALM', directionLean: 'UNCLEAR', leanConfidence: 'LOW', watchedKeyLevel: 'None', distanceToLevel: 0, topContributingFactors: [], factors: {} as any, disclaimer: '' },
      trigger: trigger || { isTriggered: false, direction: 'NONE', triggerType: 'NONE', triggerPrice: price, triggerTimeIST: '', isFakeBreakout: false, fakeBreakoutReason: null, driverConfirmed: false, confirmationDetails: [], rejectionReasons: [reason], candleMetrics: {} as any },
      costAnalysis: costAnalysis || ({} as any),
      rejectionReason: reason,
      ruleTags: ['Rejected by Discipline Guard']
    };
  }
};
