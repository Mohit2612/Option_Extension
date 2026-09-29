/**
 * TradeSight NIFTY 50 - High-Fidelity Transaction Cost & Friction Engine (Stage 3 ESM)
 * Calculates comprehensive Indian equity derivatives taxes, exchange charges,
 * brokerage, bid-ask spread, and slippage to ensure minimum 1:1.5 NET R:R.
 */

export const ScalpCostModel = {
  DEFAULT_LOT_SIZE: 25,
  DEFAULT_MIN_NET_RR: 1.5,

  /**
   * Pure function to calculate Indian derivatives friction & post-cost net R:R
   */
  calculateNetViability(params = {}) {
    const lotSize = params.lotSize || this.DEFAULT_LOT_SIZE;
    const totalQty = Math.max(1, params.lots || 1) * lotSize;
    const minNetRR = params.minNetRRThreshold ?? this.DEFAULT_MIN_NET_RR;

    const entry = params.entryPrice || 100;
    const target = params.targetPrice || 120;
    const stopLoss = params.stopLossPrice || 90;

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
      sttINR = Math.round(avgSellTurnover * 0.000625);
      exchangeTurnoverChargesINR = Math.round((buyTurnover + avgSellTurnover) * 0.0005);
      stampDutyINR = Math.max(1, Math.round(buyTurnover * 0.00003));
    } else {
      // Futures rules:
      sttINR = Math.round(avgSellTurnover * 0.0002);
      exchangeTurnoverChargesINR = Math.round((buyTurnover + avgSellTurnover) * 0.000019);
      stampDutyINR = Math.max(1, Math.round(buyTurnover * 0.00002));
    }

    // 4. SEBI Turnover Fee (₹10 / crore)
    const sebiTurnoverFeeINR = Math.max(0.1, parseFloat(((buyTurnover + avgSellTurnover) * 0.000001).toFixed(2)));

    // 5. GST (18% on Brokerage + Exchange + SEBI)
    const gstTaxable = brokerageRoundTripINR + exchangeTurnoverChargesINR + sebiTurnoverFeeINR;
    const gstINR = Math.round(gstTaxable * 0.18);

    // 6. Bid-Ask Spread & Slippage
    const spreadPts = params.estimatedSpreadPoints ?? 0.35;
    const slippagePts = params.estimatedSlippagePoints ?? 0.15;
    const frictionPtsPerShare = spreadPts + slippagePts;
    const spreadAndSlippageINR = Math.round(frictionPtsPerShare * totalQty);

    const totalFrictionINR = brokerageRoundTripINR + sttINR + exchangeTurnoverChargesINR + sebiTurnoverFeeINR + gstINR + stampDutyINR + spreadAndSlippageINR;
    const frictionPerLotINR = Math.round(totalFrictionINR / Math.max(1, params.lots || 1));
    const frictionInPoints = parseFloat((totalFrictionINR / totalQty).toFixed(2));

    // Post-friction Net Calculations
    const netProfitINR = Math.max(0, grossProfitINR - totalFrictionINR);
    const netLossINR = grossLossINR + totalFrictionINR;
    const netRR = parseFloat((netProfitINR / Math.max(1, netLossINR)).toFixed(2));

    const isViable = netRR >= minNetRR && netProfitINR > 0;

    const friction = {
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
