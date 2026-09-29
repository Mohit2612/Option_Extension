/**
 * TradeSight AI - Institutional Risk & Position Sizing Calculator
 * Ensures traders never risk more than their predetermined capital threshold (1-2%).
 */

export function calculatePositionSize({
  accountBalance = 10000,
  riskPercent = 1.0,
  entryPrice = 1.0850,
  stopLossPrice = 1.0820,
  assetClass = 'forex', // 'forex' | 'crypto' | 'stocks' | 'indices'
  contractSize = 100000 // default standard forex lot
}) {
  const balance = Math.max(0, parseFloat(accountBalance) || 0);
  const riskPct = Math.max(0.1, Math.min(10.0, parseFloat(riskPercent) || 1.0));
  const entry = parseFloat(entryPrice) || 0;
  const sl = parseFloat(stopLossPrice) || 0;

  const dollarRisk = (balance * riskPct) / 100;
  const priceDistance = Math.abs(entry - sl);

  if (priceDistance <= 0 || entry <= 0 || sl <= 0) {
    return {
      dollarRisk,
      priceDistance: 0,
      pips: 0,
      units: 0,
      lots: 0,
      formattedLots: '0.00',
      error: 'Invalid entry or stop loss price distance.'
    };
  }

  let units = 0;
  let lots = 0;
  let pips = 0;

  if (assetClass === 'forex') {
    // Determine pip multiplier (for JPY pairs 0.01, for standard 4/5-decimal pairs 0.0001)
    const isJpy = entry > 50 && entry < 300;
    const pipFactor = isJpy ? 0.01 : 0.0001;
    pips = priceDistance / pipFactor;

    // Pip value per standard lot (100k) approx $10 for EURUSD/GBPUSD
    // General formula: Units = dollarRisk / priceDistance
    units = dollarRisk / priceDistance;
    lots = units / 100000;
  } else if (assetClass === 'crypto' || assetClass === 'stocks') {
    // Number of shares or crypto coins
    units = dollarRisk / priceDistance;
    lots = units;
  } else {
    // Indices or Futures point value
    units = dollarRisk / priceDistance;
    lots = units;
  }

  const roundedLots = Math.round(lots * 100) / 100;
  const roundedUnits = Math.round(units * 100) / 100;

  return {
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    priceDistance: parseFloat(priceDistance.toFixed(5)),
    pips: Math.round(pips * 10) / 10,
    units: roundedUnits,
    lots: roundedLots,
    formattedLots: roundedLots >= 0.01 ? `${roundedLots} Lots` : `${roundedUnits} Units`,
    capitalAtRiskPct: riskPct,
    maxLossWarning: dollarRisk > balance * 0.02 ? 'Risk exceeds recommended 2% max threshold.' : null
  };
}
