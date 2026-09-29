/**
 * TradeSight AI - Schema Validator & Sanitizer
 * Ensures AI responses match the required contract before rendering to UI or canvas.
 */

export function cleanAndParseJsonResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('AI response is empty or invalid');
  }

  let sanitized = rawText.trim();

  // Strip markdown code block fences if present
  if (sanitized.startsWith('```')) {
    sanitized = sanitized.replace(/^```(?:json)?\s*/i, '');
    sanitized = sanitized.replace(/\s*```$/, '');
    sanitized = sanitized.trim();
  }

  // Find first { and last } in case of extraneous chatter
  const firstBrace = sanitized.indexOf('{');
  const lastBrace = sanitized.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    sanitized = sanitized.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(sanitized);
  } catch (err) {
    throw new Error(`JSON parsing failed: ${err.message}. Raw preview: ${sanitized.slice(0, 150)}...`);
  }

  return validateTradeSightOutput(parsed);
}

export function validateTradeSightOutput(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Parsed data is not an object');
  }

  // Validate Bias
  const validBiases = ['BUY', 'SELL', 'NO TRADE'];
  const rawBias = (data.bias || 'NO TRADE').toUpperCase();
  const bias = validBiases.includes(rawBias) ? rawBias : 'NO TRADE';

  // Sanitize confidence
  let confidence = parseInt(data.confidence_score, 10);
  if (isNaN(confidence) || confidence < 0) confidence = 50;
  if (confidence > 100) confidence = 100;

  // Validate Trade Levels
  const levels = data.trade_levels || {};
  const currentPrice = parseFloat(levels.current_price) || 0;
  const entryZone = levels.entry_zone || {};
  const optimalEntry = parseFloat(entryZone.optimal_entry) || currentPrice;
  const stopLoss = levels.stop_loss || {};
  const slPrice = parseFloat(stopLoss.price) || 0;

  const rawTargets = Array.isArray(levels.take_profit_targets) ? levels.take_profit_targets : [];
  const targets = rawTargets.map((tp, idx) => ({
    target: tp.target || `TP${idx + 1}`,
    price: parseFloat(tp.price) || 0,
    rr: tp.rr || '1:2',
    description: tp.description || ''
  }));

  const invalidation = levels.invalidation_level || {
    price: slPrice,
    condition: 'Break of structure level'
  };

  const multiTimeframe = data.multi_timeframe_view || {
    htf_trend: 'Consolidating / Range',
    mtf_structure: 'Indecisive',
    ltf_trigger: 'Awaiting clean trigger'
  };

  const confluences = Array.isArray(data.confluence_factors) ? data.confluence_factors : [];
  const warnings = Array.isArray(data.warnings_and_risks) ? data.warnings_and_risks : [];
  const overlayElements = Array.isArray(data.overlay_elements) ? data.overlay_elements : [];

  return {
    bias,
    confidence_score: confidence,
    market_regime: data.market_regime || 'Uncertain / Evaluation Required',
    summary_rationale: data.summary_rationale || 'Analysis complete based on visible price action.',
    confluence_factors: confluences,
    trade_levels: {
      symbol: levels.symbol || 'ASSET',
      timeframe: levels.timeframe || 'DEFAULT',
      current_price: currentPrice,
      entry_zone: {
        min: parseFloat(entryZone.min) || optimalEntry,
        max: parseFloat(entryZone.max) || optimalEntry,
        optimal_entry: optimalEntry
      },
      stop_loss: {
        price: slPrice,
        pips_or_points: parseFloat(stopLoss.pips_or_points) || Math.abs(optimalEntry - slPrice),
        rationale: stopLoss.rationale || 'Calculated structural stop'
      },
      take_profit_targets: targets,
      risk_reward_ratio: levels.risk_reward_ratio || (bias === 'NO TRADE' ? 'N/A' : '1:2.0'),
      invalidation_level: {
        price: parseFloat(invalidation.price) || slPrice,
        condition: invalidation.condition || 'Structural invalidation'
      }
    },
    multi_timeframe_view: multiTimeframe,
    candlestick_and_pattern: data.candlestick_and_pattern || {
      identified_pattern: 'Discretionary structure',
      significance: 'Moderate'
    },
    warnings_and_risks: warnings,
    overlay_elements: overlayElements
  };
}
