/**
 * TradeSight NIFTY 50 - Position Sizing & Risk Calculator (Module 7)
 * Strictly enforces capital preservation through mathematical risk limits.
 *
 * CRITICAL INSTITUTIONAL RULES:
 *  1. NEVER round up position size. Always round down (Math.floor) to prevent oversizing.
 *  2. If even 1 minimum lot exceeds max allowable risk: Hard SKIP ("Risk too high for capital").
 *  3. Compounds risk multipliers safely (Profit Protection 0.5x, Grade B 0.75x).
 */

export const PositionSizer = {
  DEFAULT_LOT_SIZE: 25, // Nifty standard lot size

  /**
   * Pure calculation of position sizing
   * @param {Object} params - { capital, riskPct, entryPrice, stopLoss, lotSize, optionPremium, sizingMultiplier }
   * @returns {Object} Sizing calculation result
   */
  calculatePositionSize({
    capital = 200000,
    riskPct = 1.0,
    entryPrice = 24100,
    stopLoss = 24075,
    lotSize = 25,
    optionPremium = null,
    sizingMultiplier = 1.0
  } = {}) {
    const notes = [];

    // 1. Calculate Allowable Risk Capital
    const effectiveRiskPct = Math.max(0.1, riskPct * (sizingMultiplier || 1.0));
    if (sizingMultiplier < 1.0) {
      notes.push(`Discipline scaling active: Base risk ${riskPct}% scaled by ${sizingMultiplier}x -> Effective ${effectiveRiskPct.toFixed(2)}%`);
    }

    const maxAllowedLossINR = Math.floor(capital * (effectiveRiskPct / 100));

    // 2. Calculate Loss per Lot
    let pointsRisk = Math.abs(entryPrice - stopLoss);
    if (pointsRisk === 0) pointsRisk = 25; // Default safety fallback

    let lossPerLot = 0;
    if (optionPremium && optionPremium > 0) {
      // Options trading: Default stop loss is 50% premium or delta-equivalent spot move
      const optStopDistance = Math.min(optionPremium * 0.5, pointsRisk * 0.55);
      lossPerLot = Math.round(optStopDistance * lotSize);
      notes.push(`Option premium ₹${optionPremium} with 50% premium stop (~₹${optStopDistance.toFixed(1)}/share).`);
    } else {
      // Spot / Futures / Index equivalent
      lossPerLot = Math.round(pointsRisk * lotSize);
    }

    if (lossPerLot <= 0) lossPerLot = 1;

    // 3. Size Calculation: STRICT FLOORING (Never Round Up!)
    const rawLots = maxAllowedLossINR / lossPerLot;
    const lots = Math.floor(rawLots); // Always floor to strictly stay below risk cap!
    const quantity = lots * lotSize;
    const actualRiskINR = lots * lossPerLot;
    const actualRiskPct = parseFloat(((actualRiskINR / capital) * 100).toFixed(2));

    // 4. Minimum 1-Lot Affordability Check
    if (lots < 1) {
      return {
        maxAllowedLossINR,
        pointsRisk: parseFloat(pointsRisk.toFixed(1)),
        lossPerLot,
        lots: 0,
        quantity: 0,
        actualRiskINR: 0,
        actualRiskPct: 0,
        isRiskTooHigh: true,
        canExecute: false,
        recommendation: `Skip: Risk too high for your capital (1 minimum lot risk = ₹${lossPerLot.toLocaleString('en-IN')}, max allowed risk = ₹${maxAllowedLossINR.toLocaleString('en-IN')}). Reduce SL distance or stand aside.`,
        notes: [
          ...notes,
          'Institutional Rule: Never take a trade where 1 minimum lot exceeds your risk limit.'
        ]
      };
    }

    return {
      maxAllowedLossINR,
      pointsRisk: parseFloat(pointsRisk.toFixed(1)),
      lossPerLot,
      lots,
      quantity,
      actualRiskINR,
      actualRiskPct,
      isRiskTooHigh: false,
      canExecute: true,
      recommendation: `Take ${lots} lot(s) (${quantity} Qty). Max risk: ₹${actualRiskINR.toLocaleString('en-IN')} (${actualRiskPct}% of capital).`,
      notes
    };
  },

  /**
   * Alias for calculatePositionSize supporting capitalINR and positionSizeMultiplier parameter names
   */
  calculateSizing(params = {}) {
    return this.calculatePositionSize({
      capital: params.capitalINR ?? params.capital ?? 200000,
      riskPct: params.riskPct ?? 1.0,
      entryPrice: params.entryPrice ?? 24100,
      stopLoss: params.stopLoss ?? 24075,
      lotSize: params.lotSize ?? 25,
      optionPremium: (params.isOption && params.optionPremium) ? params.optionPremium : (params.optionPremium ?? null),
      sizingMultiplier: params.positionSizeMultiplier ?? params.sizingMultiplier ?? 1.0
    });
  },

  /**
   * Institutional Risk Presets
   */
  PRESETS: {
    CONSERVATIVE: {
      name: 'Conservative',
      riskPct: 0.5,
      dailyProfitTargetR: 1.5,
      dailyMaxLossR: 1.5,
      maxDailyTrades: 2,
      description: 'Capital-defense first. Suited for beginners and recovering drawdowns.'
    },
    BALANCED: {
      name: 'Balanced',
      riskPct: 1.0,
      dailyProfitTargetR: 2.0,
      dailyMaxLossR: 2.0,
      maxDailyTrades: 3,
      description: 'Standard 30-year veteran rule. Optimal balance of risk and growth.'
    },
    CUSTOM: {
      name: 'Custom',
      riskPct: 1.0,
      dailyProfitTargetR: 2.0,
      dailyMaxLossR: 2.0,
      maxDailyTrades: 3,
      description: 'Custom trader-defined parameters.'
    }
  },

  /**
   * Retrieve risk discipline preset
   */
  getPreset(presetName = 'BALANCED') {
    const key = (presetName || '').toUpperCase();
    return this.PRESETS[key] || this.PRESETS.BALANCED;
  }
};
