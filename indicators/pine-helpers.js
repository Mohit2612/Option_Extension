/**
 * TradeSight NIFTY 50 - Pine Script Core Mathematical Helpers (Runtime ESM)
 * Faithfully ports TradingView Pine Script v4/v5 execution semantics:
 *  - ta.pivothigh / ta.pivotlow (with exact TradingView tie handling)
 *  - ta.valuewhen
 *  - ta.rma (Wilder's Moving Average)
 *  - ta.atr (True Range smoothed with RMA)
 *  - ta.highest / ta.lowest
 */

/**
 * Checks if a candidate bar is a Pivot High matching TradingView's exact ta.pivothigh() behavior.
 */
export function isPivotHighTV(series, candidateIdx, leftBars, rightBars) {
  if (candidateIdx < leftBars || candidateIdx + rightBars >= series.length) {
    return false;
  }

  const pivotVal = series[candidateIdx];
  if (pivotVal === null || pivotVal === undefined || isNaN(pivotVal)) {
    return false;
  }

  // Left side: must be strictly greater than left bars
  for (let i = 1; i <= leftBars; i++) {
    const leftVal = series[candidateIdx - i];
    if (leftVal === null || leftVal === undefined || isNaN(leftVal) || leftVal >= pivotVal) {
      return false;
    }
  }

  // Right side: must be greater than or equal to right bars (strictly greater than strictly lower, allows tie with earlier bar winning)
  for (let i = 1; i <= rightBars; i++) {
    const rightVal = series[candidateIdx + i];
    if (rightVal === null || rightVal === undefined || isNaN(rightVal) || rightVal > pivotVal) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a candidate bar is a Pivot Low matching TradingView's exact ta.pivotlow() behavior.
 */
export function isPivotLowTV(series, candidateIdx, leftBars, rightBars) {
  if (candidateIdx < leftBars || candidateIdx + rightBars >= series.length) {
    return false;
  }

  const pivotVal = series[candidateIdx];
  if (pivotVal === null || pivotVal === undefined || isNaN(pivotVal)) {
    return false;
  }

  // Left side: must be strictly lower than left bars
  for (let i = 1; i <= leftBars; i++) {
    const leftVal = series[candidateIdx - i];
    if (leftVal === null || leftVal === undefined || isNaN(leftVal) || leftVal <= pivotVal) {
      return false;
    }
  }

  // Right side: must be lower than or equal to right bars (allows tie with earlier bar winning)
  for (let i = 1; i <= rightBars; i++) {
    const rightVal = series[candidateIdx + i];
    if (rightVal === null || rightVal === undefined || isNaN(rightVal) || rightVal < pivotVal) {
      return false;
    }
  }

  return true;
}

/**
 * Pine Script: ta.pivothigh(source, leftBars, rightBars)
 * Returns a series where value at index `i` is the pivot high price if confirmed at bar `i`
 * (which occurred at bar `i - rightBars`), otherwise null.
 */
export function pivothigh(source, leftBars, rightBars) {
  const result = new Array(source.length).fill(null);

  for (let i = leftBars + rightBars; i < source.length; i++) {
    const candidateIdx = i - rightBars;
    if (isPivotHighTV(source, candidateIdx, leftBars, rightBars)) {
      result[i] = source[candidateIdx];
    }
  }

  return result;
}

/**
 * Pine Script: ta.pivotlow(source, leftBars, rightBars)
 * Returns a series where value at index `i` is the pivot low price if confirmed at bar `i`
 * (which occurred at bar `i - rightBars`), otherwise null.
 */
export function pivotlow(source, leftBars, rightBars) {
  const result = new Array(source.length).fill(null);

  for (let i = leftBars + rightBars; i < source.length; i++) {
    const candidateIdx = i - rightBars;
    if (isPivotLowTV(source, candidateIdx, leftBars, rightBars)) {
      result[i] = source[candidateIdx];
    }
  }

  return result;
}

/**
 * Pine Script: ta.valuewhen(condition, source, occurrence)
 * Returns the value of `source` when `condition` was true on the `occurrence`-th most recent occasion.
 */
export function valuewhen(condition, source, occurrence = 0) {
  const result = new Array(source.length).fill(null);
  const trueIndices = [];

  for (let i = 0; i < source.length; i++) {
    const condVal = condition[i];
    const isTrue = typeof condVal === 'boolean' ? condVal : (condVal !== null && condVal !== undefined && !isNaN(condVal));

    if (isTrue) {
      trueIndices.push(i);
    }

    if (trueIndices.length > occurrence) {
      const targetBar = trueIndices[trueIndices.length - 1 - occurrence];
      result[i] = source[targetBar];
    } else {
      result[i] = null;
    }
  }

  return result;
}

/**
 * Pine Script: ta.rma(source, length)
 * Exponential Moving Average with alpha = 1 / length (Wilder's Smoothing).
 */
export function rma(source, length) {
  const result = new Array(source.length).fill(null);
  if (source.length < length || length <= 0) return result;

  const alpha = 1 / length;

  // Initial SMA
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += source[i];
  }
  let prevRma = sum / length;
  result[length - 1] = prevRma;

  // RMA recursion
  for (let i = length; i < source.length; i++) {
    prevRma = alpha * source[i] + (1 - alpha) * prevRma;
    result[i] = prevRma;
  }

  return result;
}

/**
 * Pine Script: ta.tr(handleNan)
 * True Range = max(high - low, abs(high - close[1]), abs(low - close[1]))
 */
export function tr(candles) {
  const result = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;

  result[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevC = candles[i - 1].close;

    const hl = h - l;
    const hc = Math.abs(h - prevC);
    const lc = Math.abs(l - prevC);

    result[i] = Math.max(hl, hc, lc);
  }

  return result;
}

/**
 * Pine Script: ta.atr(length)
 * Exact TradingView ATR: Wilder's smoothed True Range with RMA(TR, length).
 */
export function atr(candles, length = 14) {
  const trSeries = tr(candles);
  return rma(trSeries, length);
}

/**
 * Pine Script: ta.highest(source, length)
 */
export function highest(source, length) {
  const result = new Array(source.length).fill(null);
  if (source.length < length) return result;

  for (let i = length - 1; i < source.length; i++) {
    let max = -Infinity;
    for (let j = 0; j < length; j++) {
      const val = source[i - j];
      if (val > max) max = val;
    }
    result[i] = max;
  }

  return result;
}

/**
 * Pine Script: ta.lowest(source, length)
 */
export function lowest(source, length) {
  const result = new Array(source.length).fill(null);
  if (source.length < length) return result;

  for (let i = length - 1; i < source.length; i++) {
    let min = Infinity;
    for (let j = 0; j < length; j++) {
      const val = source[i - j];
      if (val < min) min = val;
    }
    result[i] = min;
  }

  return result;
}
