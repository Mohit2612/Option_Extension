/**
 * TradeSight AI - Options Strategy & Payoff Engine
 * Institutional options structuring based on directional bias, IV percentile, PCR, and days to expiration.
 */

export const OptionsEngine = {
  /**
   * Recommend and calculate options structure
   */
  evaluateStrategy({
    symbol = 'SPY',
    spotPrice = 500,
    directionalBias = 'BUY', // 'BUY' | 'SELL' | 'NO TRADE'
    ivPercentile = 45, // 0 - 100
    daysToExpiry = 14,
    pcr = 1.0, // Put-Call Ratio
    maxPain = 500,
    lotSize = 100
  }) {
    const spot = parseFloat(spotPrice) || 100;
    const iv = parseFloat(ivPercentile) || 35;
    const dte = parseInt(daysToExpiry, 10) || 14;
    const isHighIV = iv >= 55;
    const isLowIV = iv <= 30;

    let strategyKey = 'BULL_CALL_SPREAD';
    let rationale = '';

    // Strategy Selection Logic
    if (directionalBias === 'BUY') {
      if (isHighIV) {
        strategyKey = 'BULL_PUT_SPREAD';
        rationale = `Implied Volatility is elevated (${iv}th percentile). Selling put credit spreads harnesses elevated extrinsic premium and provides positive Theta (time decay) while capturing upside bias.`;
      } else {
        strategyKey = 'BULL_CALL_SPREAD';
        rationale = `IV is low-to-moderate (${iv}th percentile). Buying a vertical debit call spread caps downside risk, reduces Vega drag, and offers an asymmetric 1:2.5+ risk-reward.`;
      }
    } else if (directionalBias === 'SELL') {
      if (isHighIV) {
        strategyKey = 'BEAR_CALL_SPREAD';
        rationale = `Elevated IV (${iv}th percentile) favors call credit spreads. Collect rich premium above structural resistance, allowing time decay and volatility contraction to work in your favor.`;
      } else {
        strategyKey = 'BEAR_PUT_SPREAD';
        rationale = `Low IV (${iv}th percentile) keeps option premiums affordable. A vertical bear put spread limits capital outlay while maximizing payoff on structural breakdown.`;
      }
    } else {
      // Neutral / Consolidation / Range
      if (isHighIV) {
        strategyKey = 'IRON_CONDOR';
        rationale = `High IV (${iv}th percentile) combined with range-bound structure makes an Iron Condor optimal. Profit from premium decay as long as price remains within the consolidation band.`;
      } else {
        strategyKey = 'LONG_STRANGLE';
        rationale = `Volatility is compressed (${iv}th percentile). Low IV precedes explosive expansion; a long strangle positions for an impending volatility breakout in either direction.`;
      }
    }

    return this.buildStrategyDetails(strategyKey, spot, dte, lotSize, rationale, iv);
  },

  /**
   * Compute strike prices, maximum profit/loss, breakeven, and payoff points
   */
  buildStrategyDetails(strategyKey, spot, dte, lotSize = 100, rationale = '', iv = 35) {
    const step = Math.round(spot * 0.02) || 1; // 2% strike interval
    let name = '';
    let type = 'DEBIT'; // 'DEBIT' | 'CREDIT'
    let legs = [];
    let maxProfit = 0;
    let maxLoss = 0;
    let breakevens = [];
    let marginEst = 0;

    if (strategyKey === 'BULL_CALL_SPREAD') {
      name = 'Bull Call Spread (Debit Spread)';
      type = 'DEBIT';
      const buyStrike = Math.round(spot);
      const sellStrike = buyStrike + step;
      const buyPrem = (step * 0.45);
      const sellPrem = (step * 0.15);
      const netDebit = buyPrem - sellPrem;

      legs = [
        { action: 'BUY', type: 'CALL', strike: buyStrike, premium: buyPrem.toFixed(2) },
        { action: 'SELL', type: 'CALL', strike: sellStrike, premium: sellPrem.toFixed(2) }
      ];

      maxLoss = netDebit * lotSize;
      maxProfit = (step - netDebit) * lotSize;
      breakevens = [buyStrike + netDebit];
      marginEst = maxLoss;

    } else if (strategyKey === 'BULL_PUT_SPREAD') {
      name = 'Bull Put Spread (Credit Spread)';
      type = 'CREDIT';
      const sellStrike = Math.round(spot - step);
      const buyStrike = sellStrike - step;
      const sellPrem = (step * 0.35);
      const buyPrem = (step * 0.10);
      const netCredit = sellPrem - buyPrem;

      legs = [
        { action: 'SELL', type: 'PUT', strike: sellStrike, premium: sellPrem.toFixed(2) },
        { action: 'BUY', type: 'PUT', strike: buyStrike, premium: buyPrem.toFixed(2) }
      ];

      maxProfit = netCredit * lotSize;
      maxLoss = (step - netCredit) * lotSize;
      breakevens = [sellStrike - netCredit];
      marginEst = step * lotSize;

    } else if (strategyKey === 'BEAR_CALL_SPREAD') {
      name = 'Bear Call Spread (Credit Spread)';
      type = 'CREDIT';
      const sellStrike = Math.round(spot + step);
      const buyStrike = sellStrike + step;
      const sellPrem = (step * 0.35);
      const buyPrem = (step * 0.10);
      const netCredit = sellPrem - buyPrem;

      legs = [
        { action: 'SELL', type: 'CALL', strike: sellStrike, premium: sellPrem.toFixed(2) },
        { action: 'BUY', type: 'CALL', strike: buyStrike, premium: buyPrem.toFixed(2) }
      ];

      maxProfit = netCredit * lotSize;
      maxLoss = (step - netCredit) * lotSize;
      breakevens = [sellStrike + netCredit];
      marginEst = step * lotSize;

    } else if (strategyKey === 'BEAR_PUT_SPREAD') {
      name = 'Bear Put Spread (Debit Spread)';
      type = 'DEBIT';
      const buyStrike = Math.round(spot);
      const sellStrike = buyStrike - step;
      const buyPrem = (step * 0.45);
      const sellPrem = (step * 0.15);
      const netDebit = buyPrem - sellPrem;

      legs = [
        { action: 'BUY', type: 'PUT', strike: buyStrike, premium: buyPrem.toFixed(2) },
        { action: 'SELL', type: 'PUT', strike: sellStrike, premium: sellPrem.toFixed(2) }
      ];

      maxLoss = netDebit * lotSize;
      maxProfit = (step - netDebit) * lotSize;
      breakevens = [buyStrike - netDebit];
      marginEst = maxLoss;

    } else if (strategyKey === 'IRON_CONDOR') {
      name = 'Iron Condor (Delta Neutral)';
      type = 'CREDIT';
      const putBuy = Math.round(spot - step * 2);
      const putSell = Math.round(spot - step);
      const callSell = Math.round(spot + step);
      const callBuy = Math.round(spot + step * 2);

      const netCredit = step * 0.35;
      legs = [
        { action: 'BUY', type: 'PUT', strike: putBuy, premium: (step * 0.08).toFixed(2) },
        { action: 'SELL', type: 'PUT', strike: putSell, premium: (step * 0.25).toFixed(2) },
        { action: 'SELL', type: 'CALL', strike: callSell, premium: (step * 0.25).toFixed(2) },
        { action: 'BUY', type: 'CALL', strike: callBuy, premium: (step * 0.08).toFixed(2) }
      ];

      maxProfit = netCredit * lotSize;
      maxLoss = (step - netCredit) * lotSize;
      breakevens = [putSell - netCredit, callSell + netCredit];
      marginEst = step * lotSize;

    } else {
      // LONG STRANGLE
      name = 'Long Strangle (Volatility Breakout)';
      type = 'DEBIT';
      const putStrike = Math.round(spot - step);
      const callStrike = Math.round(spot + step);
      const debit = step * 0.4;

      legs = [
        { action: 'BUY', type: 'PUT', strike: putStrike, premium: (debit / 2).toFixed(2) },
        { action: 'BUY', type: 'CALL', strike: callStrike, premium: (debit / 2).toFixed(2) }
      ];

      maxLoss = debit * lotSize;
      maxProfit = 999999; // theoretically unlimited
      breakevens = [putStrike - debit, callStrike + debit];
      marginEst = maxLoss;
    }

    // Generate Payoff curve series across price range [spot - 3*step, spot + 3*step]
    const payoffCurve = this.generatePayoffCurve(legs, spot, step, lotSize);

    return {
      strategyKey,
      name,
      type,
      rationale,
      legs,
      maxProfit: Math.round(maxProfit),
      maxLoss: Math.round(maxLoss),
      breakevens: breakevens.map((b) => parseFloat(b.toFixed(2))),
      riskRewardRatio: maxLoss > 0 && maxProfit > 0 && maxProfit < 900000 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : 'N/A',
      marginEstimate: Math.round(marginEst),
      daysToExpiry: dte,
      payoffCurve
    };
  },

  /**
   * Calculate payoff points for SVG graph rendering
   */
  generatePayoffCurve(legs, spot, step, lotSize) {
    const points = [];
    const minPrice = spot - step * 3.5;
    const maxPrice = spot + step * 3.5;
    const numPoints = 25;
    const priceDelta = (maxPrice - minPrice) / (numPoints - 1);

    for (let i = 0; i < numPoints; i++) {
      const price = minPrice + i * priceDelta;
      let pnl = 0;

      for (const leg of legs) {
        const strike = leg.strike;
        const premium = parseFloat(leg.premium);
        const isCall = leg.type === 'CALL';
        const isBuy = leg.action === 'BUY';

        let intrinsic = 0;
        if (isCall) {
          intrinsic = Math.max(0, price - strike);
        } else {
          intrinsic = Math.max(0, strike - price);
        }

        if (isBuy) {
          pnl += (intrinsic - premium) * lotSize;
        } else {
          pnl += (premium - intrinsic) * lotSize;
        }
      }

      points.push({ price: parseFloat(price.toFixed(2)), pnl: Math.round(pnl) });
    }

    return points;
  }
};
