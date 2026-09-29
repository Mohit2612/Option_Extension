/**
 * TradeSight NIFTY 50 - High-Fidelity Transaction Cost & Friction Engine (Stage 3)
 * Calculates comprehensive Indian equity derivatives taxes, exchange charges,
 * brokerage, bid-ask spread, and slippage to ensure minimum 1:1.5 NET R:R.
 */

export interface CostCalculationParams {
  instrumentType: 'OPTION' | 'FUTURES';
  lots: number;
  lotSize?: number;
  entryPrice: number;     // Spot or Option premium
  targetPrice: number;
  stopLossPrice: number;
  brokeragePerOrder?: number; // Flat ₹20 discount broker default
  estimatedSpreadPoints?: number; // 0.3-0.8 pts in Nifty ATM
  estimatedSlippagePoints?: number;
  minNetRRThreshold?: number; // Default 1.5
}

export interface FrictionBreakdown {
  brokerageRoundTripINR: number;
  sttINR: number;
  exchangeTurnoverChargesINR: number;
  sebiTurnoverFeeINR: number;
  gstINR: number;
  stampDutyINR: number;
  spreadAndSlippageINR: number;
  totalFrictionINR: number;
  frictionPerLotINR: number;
  frictionInPoints: number;
}

export interface CostEvaluatedTrade {
  grossRewardPoints: number;
  grossRiskPoints: number;
  grossRR: number;
  grossProfitINR: number;
  grossLossINR: number;
  netProfitINR: number;
  netLossINR: number;
  netRR: number;
  isViable: boolean;
  minNetRRThreshold: number;
  friction: FrictionBreakdown;
  summaryMessage: string;
}

export const ScalpCostModel = {
  DEFAULT_LOT_SIZE: 25,
  DEFAULT_MIN_NET_RR: 1.5,

  /**
   * Pure function to calculate Indian derivatives friction & post-cost net R:R
   */
  calculateNetViability(params: CostCalculationParams): CostEvaluatedTrade {
    const lotSize = params.lotSize || this.DEFAULT_LOT_SIZE;
    const totalQty = Math.max(1, params.lots) * lotSize;
    const minNetRR = params.minNetRRThreshold ?? this.DEFAULT_MIN_NET_RR;

    const entry = params.entryPrice;
    const target = params.targetPrice;
    const stopLoss = params.stopLossPrice;

    const grossRewardPoints = Math.abs(target - entry);
    const grossRiskPoints = Math.max(0.5, Math.abs(entry - stopLoss));
    const grossRR = parseFloat((grossRewardPoints / grossRiskPoints).toFixed(2));

    const grossProfitINR = Math.round(grossRewardPoints * totalQty);
    const grossLossINR = Math.round(grossRiskPoints * totalQty);

    // Turnovers
    const buyTurnover = entry * totalQty;
    const sellTurnoverWin = target * totalQty;
    const sellTurnoverLoss = stopLoss * totalQty;
    const avgSellTurnover = (sellTurnoverWin + sellTurnoverLoss) / 2;

    // 1. Brokerage (Flat ₹20 per leg = ₹40 roundtrip)
    const brokeragePerOrder = params.brokeragePerOrder ?? 20;
    const brokerageRoundTripINR = brokeragePerOrder * 2;

    let sttINR = 0;
    let exchangeTurnoverChargesINR = 0;
    let stampDutyINR = 0;

    if (params.instrumentType === 'OPTION') {
      // NSE Option rules:
      // STT on sell side: 0.10% (0.0625% on option premium sell)
      sttINR = Math.round(avgSellTurnover * 0.000625);
      // Exchange Turnover Charges: 0.05% on premium turnover (both sides)
      exchangeTurnoverChargesINR = Math.round((buyTurnover + avgSellTurnover) * 0.0005);
      // Stamp Duty: 0.003% on buy side premium
      stampDutyINR = Math.max(1, Math.round(buyTurnover * 0.00003));
    } else {
      // Futures rules:
      // STT: 0.02% on sell side
      sttINR = Math.round(avgSellTurnover * 0.0002);
      // Exchange Turnover: 0.0019%
      exchangeTurnoverChargesINR = Math.round((buyTurnover + avgSellTurnover) * 0.000019);
      // Stamp Duty: 0.002% on buy side
      stampDutyINR = Math.max(1, Math.round(buyTurnover * 0.00002));
    }

    // 4. SEBI Turnover Fee (₹10 / crore)
    const sebiTurnoverFeeINR = Math.max(0.1, parseFloat(((buyTurnover + avgSellTurnover) * 0.000001).toFixed(2)));

    // 5. GST (18% on Brokerage + Exchange + SEBI)
    const gstTaxable = brokerageRoundTripINR + exchangeTurnoverChargesINR + sebiTurnoverFeeINR;
    const gstINR = Math.round(gstTaxable * 0.18);

    // 6. Bid-Ask Spread & Slippage (0.4-0.8 pts in ATM options)
    const spreadPts = params.estimatedSpreadPoints ?? 0.35;
    const slippagePts = params.estimatedSlippagePoints ?? 0.15;
    const frictionPtsPerShare = spreadPts + slippagePts;
    const spreadAndSlippageINR = Math.round(frictionPtsPerShare * totalQty);

    const totalFrictionINR = brokerageRoundTripINR + sttINR + exchangeTurnoverChargesINR + sebiTurnoverFeeINR + gstINR + stampDutyINR + spreadAndSlippageINR;
    const frictionPerLotINR = Math.round(totalFrictionINR / Math.max(1, params.lots));
    const frictionInPoints = parseFloat((totalFrictionINR / totalQty).toFixed(2));

    // Post-friction Net Calculations
    const netProfitINR = Math.max(0, grossProfitINR - totalFrictionINR);
    const netLossINR = grossLossINR + totalFrictionINR;
    const netRR = parseFloat((netProfitINR / Math.max(1, netLossINR)).toFixed(2));

    const isViable = netRR >= minNetRR && netProfitINR > 0;

    const friction: FrictionBreakdown = {
      brokerageRoundTripINR,
      sttINR,
      exchangeTurnoverChargesINR,
      sebiTurnoverFeeINR,
      gstINR,
      stampDutyINR,
      spreadAndSlippageINR,
      totalFrictionINR,
      frictionPerLotINR,
      frictionInPoints
    };

    const summaryMessage = isViable
      ? `✓ Scalp Viable: Net R:R 1:${netRR} (after ₹${totalFrictionINR} total friction & slippage).`
      : `✗ Rejected: Net R:R 1:${netRR} < 1:${minNetRR} after ₹${totalFrictionINR} transaction costs. Target too small for friction.`;

    return {
      grossRewardPoints,
      grossRiskPoints,
      grossRR,
      grossProfitINR,
      grossLossINR,
      netProfitINR,
      netLossINR,
      netRR,
      isViable,
      minNetRRThreshold: minNetRR,
      friction,
      summaryMessage
    };
  }
};
