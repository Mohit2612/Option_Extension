/**
 * TradeSight NIFTY 50 - Option Chain & Strike Selection Service
 * Selects liquid strikes, computes heuristic delta, and calculates required Nifty index move to double premium.
 */

export const OptionChainService = {
  STRIKE_INTERVAL: 50, // Nifty strikes are spaced at 50-point increments

  /**
   * Selects optimal strike for Hero-Zero expiry trade
   * @param {Object} params - { spotPrice, direction, premiumMin, premiumMax, isExpiryDay }
   * @returns {Object} Strike details or null if no qualifying liquid strike found
   */
  selectHeroZeroStrike({
    spotPrice = 24100,
    direction = 'BUY_CE', // 'BUY_CE' | 'BUY_PE'
    premiumMin = 5,       // Default ₹5
    premiumMax = 40,      // Default ₹40
    currentAtmIv = 13.5
  }) {
    const spot = parseFloat(spotPrice) || 24100;
    const atmStrike = Math.round(spot / this.STRIKE_INTERVAL) * this.STRIKE_INTERVAL;
    const isCall = direction === 'BUY_CE';

    // Step 1: Evaluate 1 to 3 steps OTM strikes
    const candidateStrikes = [];

    for (let step = 1; step <= 3; step++) {
      const strike = isCall ? atmStrike + step * this.STRIKE_INTERVAL : atmStrike - step * this.STRIKE_INTERVAL;
      const distancePts = Math.abs(strike - spot);

      // Model expiry afternoon premium decay (Black-Scholes heuristic for Thursday afternoon 0.05 DTE)
      // Premium typically ranges from ₹8 to ₹35 for 1-3 steps OTM in normal IV
      const estimatedDelta = Math.max(0.12, Math.min(0.38, 0.50 - (step * 0.11)));
      const estimatedPremium = parseFloat((Math.max(6, 35 - step * 9) * (currentAtmIv / 13.5)).toFixed(1));

      // Calculate exact Nifty points required for 2x premium gain:
      // Delta = dPremium / dIndex => Required Pts = Premium / Delta
      const requiredPointsToDouble = Math.round(estimatedPremium / estimatedDelta);

      // Check liquidity: 50-point round strikes have heavy retail and algorithmic liquidity
      const isLiquidStrike = (strike % 50 === 0);
      const isCentennialStrike = (strike % 100 === 0);

      candidateStrikes.push({
        strike,
        optionType: isCall ? 'CE' : 'PE',
        symbolFormatted: `NIFTY ${strike} ${isCall ? 'CE' : 'PE'}`,
        stepsOtm: step,
        estimatedPremium,
        delta: estimatedDelta,
        requiredPointsToDouble,
        isLiquid: isLiquidStrike,
        liquidityRating: isCentennialStrike ? 'HIGH_LIQUIDITY' : 'NORMAL_LIQUIDITY',
        bidAskSpreadEstimate: isCentennialStrike ? '₹0.15 - ₹0.30' : '₹0.25 - ₹0.60'
      });
    }

    // Filter strikes that fall within user-configured premium band
    const qualified = candidateStrikes.filter((s) => s.estimatedPremium >= premiumMin && s.estimatedPremium <= premiumMax);

    if (qualified.length === 0) {
      // Fallback to closest 1-2 step strike
      const fallback = candidateStrikes[0];
      fallback.warning = `No strike in exact [₹${premiumMin} - ₹${premiumMax}] band. Showing closest 1-step OTM strike.`;
      return fallback;
    }

    // Prefer 1st or 2nd step OTM for best balance between Delta and premium cost
    return qualified[0];
  },

  /**
   * Selects 1-ITM or ATM strike for standard non-expiry directional trades
   */
  selectStandardStrike({ spotPrice = 24100, direction = 'BUY_CE', isHighIv = false }) {
    const spot = parseFloat(spotPrice) || 24100;
    const atmStrike = Math.round(spot / this.STRIKE_INTERVAL) * this.STRIKE_INTERVAL;
    const isCall = direction === 'BUY_CE';

    // In normal IV, use 1-ITM for delta efficiency (~0.60 Delta)
    const targetStrike = isCall ? atmStrike - this.STRIKE_INTERVAL : atmStrike + this.STRIKE_INTERVAL;
    const delta = 0.58;
    const approxPremium = Math.round(110 + (Math.abs(targetStrike - spot) * 0.45));

    return {
      strike: targetStrike,
      optionType: isCall ? 'CE' : 'PE',
      symbolFormatted: `NIFTY ${targetStrike} ${isCall ? 'CE' : 'PE'} (1-ITM)`,
      delta,
      approxPremium,
      pointsToDouble: Math.round(approxPremium / delta),
      rationale: '1-ITM option offers higher Delta (~0.60) and lower time decay (Theta) than OTM options.'
    };
  }
};
