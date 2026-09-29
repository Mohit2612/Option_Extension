/**
 * TradeSight NIFTY 50 - Structural Confluence Engine (Runtime ESM)
 *
 * Synthesizes institutional structure across:
 *  1. Trendline Pro Engine
 *  2. Multi-Tier Support/Resistance ZONE Engine
 *  3. VWAP side & distance
 *  4. Market Regime & Trend Alignment
 *  5. Volume & Candle Momentum
 *  6. Candlestick Pattern at Location
 *  7. India VIX & Driver Engine Pressure Score
 *  8. Session Time Window Quality
 */

export const DEFAULT_CONFLUENCE_CONFIG = {
  gradeAThreshold: 80,
  gradeBThreshold: 65,
  minRrRatio: 1.5,
  obstacleAtrThreshold: 1.0
};

export class ConfluenceEngine {
  static evaluate(input, config = DEFAULT_CONFLUENCE_CONFIG) {
    const {
      trendlineState,
      levelsState,
      currentPrice,
      vwap,
      regime,
      triggerCandle,
      pattern,
      driverData,
      sessionInfo,
      eventRisk = false
    } = input;

    const factors = [];
    const warnings = [];
    const missingModules = [];

    const hasTrendline = trendlineState && trendlineState.isEnabled && trendlineState.ready;
    const hasLevels = levelsState && levelsState.isEnabled && levelsState.ready;

    if (!hasTrendline) missingModules.push('Trendlines (OFF or Insufficient Bars)');
    if (!hasLevels) missingModules.push('S/R Zones (OFF or Insufficient Bars)');

    const currentAtr = Math.max(1.0, levelsState?.currentAtr || trendlineState?.currentAtr || 15.0);

    let bullishSources = 0;
    let bearishSources = 0;
    let rawScore = 50;

    let activeZoneId;
    let activeTlId;
    let locationPrice;
    let locationDesc = 'Open Chart (No Structural Confluence)';

    // 1. EVALUATE S/R ZONE ENGINE INPUTS
    if (hasLevels && levelsState) {
      const sup = levelsState.nearestSupport;
      const res = levelsState.nearestResistance;
      const lastZoneEv = levelsState.lastEvent;

      if (sup && sup.distanceAtr <= 0.35) {
        bullishSources++;
        activeZoneId = sup.zone.id;
        locationPrice = sup.zone.centerPrice;
        locationDesc = `At Support Zone ${sup.zone.centerPrice} (${sup.zone.strengthScore}/100)`;

        const bonus = sup.zone.strengthScore >= 80 ? 20 : 12;
        rawScore += bonus;
        factors.push({
          name: 'Support Zone Confluence',
          points: bonus,
          category: 'STRUCTURE',
          note: `Price at high-strength support zone ${sup.zone.centerPrice} (+${bonus} pts)`
        });

        if (sup.zone.flipped) {
          rawScore += 10;
          factors.push({
            name: 'Flipped Zone Support Bonus',
            points: 10,
            category: 'STRUCTURE',
            note: 'Old resistance flipped to valid structural support (+10 pts)'
          });
        }
      } else if (res && res.distanceAtr <= 0.35) {
        bearishSources++;
        activeZoneId = res.zone.id;
        locationPrice = res.zone.centerPrice;
        locationDesc = `At Resistance Zone ${res.zone.centerPrice} (${res.zone.strengthScore}/100)`;

        const bonus = res.zone.strengthScore >= 80 ? 20 : 12;
        rawScore += bonus;
        factors.push({
          name: 'Resistance Zone Confluence',
          points: bonus,
          category: 'STRUCTURE',
          note: `Price at high-strength resistance zone ${res.zone.centerPrice} (+${bonus} pts)`
        });

        if (res.zone.flipped) {
          rawScore += 10;
          factors.push({
            name: 'Flipped Zone Resistance Bonus',
            points: 10,
            category: 'STRUCTURE',
            note: 'Old support flipped to valid structural resistance (+10 pts)'
          });
        }
      }

      if (lastZoneEv) {
        if (lastZoneEv.type === 'BREAK' && lastZoneEv.direction === 'BULLISH') {
          bullishSources++;
          rawScore += 15;
          factors.push({ name: 'Zone Breakout Up', points: 15, category: 'STRUCTURE', note: lastZoneEv.note });
        } else if (lastZoneEv.type === 'BREAK' && lastZoneEv.direction === 'BEARISH') {
          bearishSources++;
          rawScore += 15;
          factors.push({ name: 'Zone Breakdown Down', points: 15, category: 'STRUCTURE', note: lastZoneEv.note });
        } else if (lastZoneEv.type === 'SWEEP') {
          rawScore += 12;
          if (lastZoneEv.direction === 'BULLISH') bullishSources++;
          else bearishSources++;
          factors.push({ name: 'Liquidity Sweep Rejection', points: 12, category: 'STRUCTURE', note: lastZoneEv.note });
        }
      }
    }

    // 2. EVALUATE TRENDLINE PRO INPUTS
    if (hasTrendline && trendlineState) {
      const utl = trendlineState.uptrendLine;
      const dtl = trendlineState.downtrendLine;
      const lastTlEv = trendlineState.lastEvent;

      if (trendlineState.distanceAtr <= 0.35) {
        if (utl && !utl.isBroken) {
          bullishSources++;
          activeTlId = utl.id;
          rawScore += 15;
          factors.push({
            name: 'UTL Trendline Confluence',
            points: 15,
            category: 'STRUCTURE',
            note: `Respecting Uptrend line (${utl.touches} touches, score ${utl.score}) (+15 pts)`
          });
        }
        if (dtl && !dtl.isBroken) {
          bearishSources++;
          activeTlId = dtl.id;
          rawScore += 15;
          factors.push({
            name: 'DTL Trendline Confluence',
            points: 15,
            category: 'STRUCTURE',
            note: `Testing Downtrend line (${dtl.touches} touches, score ${dtl.score}) (+15 pts)`
          });
        }
      }

      if (lastTlEv) {
        if (lastTlEv.type === 'BREAK_UP') {
          bullishSources += 2;
          rawScore += 18;
          factors.push({ name: 'DTL Breakout Confirmed', points: 18, category: 'STRUCTURE', note: lastTlEv.note });
        } else if (lastTlEv.type === 'BREAK_DOWN') {
          bearishSources += 2;
          rawScore += 18;
          factors.push({ name: 'UTL Breakdown Confirmed', points: 18, category: 'STRUCTURE', note: lastTlEv.note });
        } else if (lastTlEv.type === 'RETEST') {
          rawScore += 14;
          if (lastTlEv.direction === 'BULLISH') bullishSources++;
          else bearishSources++;
          factors.push({ name: 'Trendline Retest Hold', points: 14, category: 'STRUCTURE', note: lastTlEv.note });
        }
      }
    }

    // 3. VWAP CONFLUENCE
    if (vwap && vwap > 0) {
      const isAboveVwap = currentPrice >= vwap;
      if (isAboveVwap) {
        bullishSources++;
        rawScore += 8;
        factors.push({
          name: 'Session VWAP Alignment',
          points: 8,
          category: 'ORDER_FLOW',
          note: `Trading above VWAP (${vwap}) - institutional buyers in control (+8 pts)`
        });
      } else {
        bearishSources++;
        rawScore += 8;
        factors.push({
          name: 'Session VWAP Alignment',
          points: 8,
          category: 'ORDER_FLOW',
          note: `Trading below VWAP (${vwap}) - institutional sellers in control (+8 pts)`
        });
      }
    }

    // 4. REGIME & TREND CONFLUENCE
    if (regime) {
      if (regime.isChop || regime.label?.toLowerCase().includes('chop') || regime.label?.toLowerCase().includes('range')) {
        rawScore -= 15;
        warnings.push('Market regime is choppy/range-bound: breakout follow-through degraded.');
        factors.push({
          name: 'Chop Regime Penalty',
          points: -15,
          category: 'TREND_REGIME',
          note: 'Chop / sideways regime penalty (-15 pts)'
        });
      } else if (regime.bias === 'BULLISH' || regime.label?.toLowerCase().includes('bull')) {
        bullishSources++;
        rawScore += 10;
        factors.push({ name: 'Macro Regime Alignment', points: 10, category: 'TREND_REGIME', note: 'Trend regime bullish (+10 pts)' });
      } else if (regime.bias === 'BEARISH' || regime.label?.toLowerCase().includes('bear')) {
        bearishSources++;
        rawScore += 10;
        factors.push({ name: 'Macro Regime Alignment', points: 10, category: 'TREND_REGIME', note: 'Trend regime bearish (+10 pts)' });
      }
    }

    // 5. CANDLESTICK PATTERN & MOMENTUM CONFLUENCE
    if (pattern && pattern.isActionable) {
      rawScore += 12;
      if (pattern.type === 'BULLISH') bullishSources++;
      else if (pattern.type === 'BEARISH') bearishSources++;
      factors.push({
        name: 'Candlestick Pattern Confluence',
        points: 12,
        category: 'STRUCTURE',
        note: `${pattern.name} formed at structural location (+12 pts)`
      });
    }

    // 6. DRIVER ENGINE & INDIA VIX
    if (driverData) {
      const score = driverData.pressureScore || 0;
      if (Math.abs(score) >= 40) {
        rawScore += 8;
        factors.push({
          name: 'Driver Engine Alignment',
          points: 8,
          category: 'ORDER_FLOW',
          note: `Market pressure score aligned (${score > 0 ? '+' : ''}${score}) (+8 pts)`
        });
      }
    }

    // 7. TIME-OF-DAY & SESSION QUALITY
    if (sessionInfo) {
      if (sessionInfo.isInsideSession) {
        rawScore += 5;
        factors.push({ name: 'Active Prime Session Window', points: 5, category: 'SAFETY', note: 'Within authorized institutional window (+5 pts)' });
      } else {
        rawScore -= 20;
        warnings.push('Outside permitted institutional trading session window.');
        factors.push({ name: 'Session Timing Penalty', points: -20, category: 'SAFETY', note: 'Outside session hours (-20 pts)' });
      }
    }

    if (eventRisk) {
      rawScore -= 20;
      warnings.push('High-impact macro event risk in progress: elevated slip & spread hazard.');
      factors.push({ name: 'Event Risk Penalty', points: -20, category: 'SAFETY', note: 'High volatility event buffer active (-20 pts)' });
    }

    // 8. DIRECTION DETERMINATION RULE: At least 2 independent structure sources
    let direction = 'none';

    if (bullishSources >= 2 && bullishSources > bearishSources) {
      direction = 'long';
    } else if (bearishSources >= 2 && bearishSources > bullishSources) {
      direction = 'short';
    } else {
      direction = 'none';
      warnings.push('Fewer than 2 independent structural sources agree: direction filtered to NONE.');
    }

    // 9. OBSTACLE CHECK & ROOM TO RUN
    let obstacle = null;
    let suggestedTargetBasis = '2.0x ATR Expansion';
    let suggestedStopBasis = '1.0x ATR Beyond Structure';

    if (hasLevels && levelsState) {
      if (direction === 'long') {
        const nextRes = levelsState.nearestResistance;
        const distAtr = nextRes ? nextRes.distanceAtr : 4.0;
        const distPts = nextRes ? nextRes.distancePts : 4.0 * currentAtr;
        const hasRoom = distAtr >= config.obstacleAtrThreshold;

        obstacle = { nextZone: nextRes?.zone, distanceAtr: distAtr, distancePts: distPts, hasRoomToRun: hasRoom };
        suggestedTargetBasis = nextRes ? `Resistance Zone @ ${nextRes.zone.bottomPrice} (${distPts} pts away)` : 'Open Ceiling (+50 pts)';
        suggestedStopBasis = levelsState.nearestSupport ? `Below Support Zone @ ${levelsState.nearestSupport.zone.bottomPrice - 5}` : `Below Entry - ${(currentAtr * 0.8).toFixed(0)} pts`;

        if (!hasRoom) {
          rawScore -= 18;
          warnings.push(`Obstacle barrier directly overhead at ${nextRes?.zone.bottomPrice} (${distAtr} ATR away: no room to run).`);
          factors.push({ name: 'Nearby Overhead Obstacle', points: -18, category: 'STRUCTURE', note: 'Resistance blocks target within 1 ATR (-18 pts)' });
        }
      } else if (direction === 'short') {
        const nextSup = levelsState.nearestSupport;
        const distAtr = nextSup ? nextSup.distanceAtr : 4.0;
        const distPts = nextSup ? nextSup.distancePts : 4.0 * currentAtr;
        const hasRoom = distAtr >= config.obstacleAtrThreshold;

        obstacle = { nextZone: nextSup?.zone, distanceAtr: distAtr, distancePts: distPts, hasRoomToRun: hasRoom };
        suggestedTargetBasis = nextSup ? `Support Zone @ ${nextSup.zone.topPrice} (${distPts} pts away)` : 'Open Floor (-50 pts)';
        suggestedStopBasis = levelsState.nearestResistance ? `Above Resistance Zone @ ${levelsState.nearestResistance.zone.topPrice + 5}` : `Above Entry + ${(currentAtr * 0.8).toFixed(0)} pts`;

        if (!hasRoom) {
          rawScore -= 18;
          warnings.push(`Obstacle barrier directly below at ${nextSup?.zone.topPrice} (${distAtr} ATR away: no room to run).`);
          factors.push({ name: 'Nearby Downward Obstacle', points: -18, category: 'STRUCTURE', note: 'Support blocks target within 1 ATR (-18 pts)' });
        }
      }
    }

    const confluenceScore = Math.max(10, Math.min(100, Math.round(rawScore)));
    let grade = 'C';

    if (confluenceScore >= config.gradeAThreshold && direction !== 'none' && (!obstacle || obstacle.hasRoomToRun)) {
      grade = 'A';
    } else if (confluenceScore >= config.gradeBThreshold && direction !== 'none') {
      grade = 'B';
    } else {
      grade = 'C';
    }

    let suggestedInvalidation = null;
    if (direction === 'long' && levelsState?.nearestSupport) {
      suggestedInvalidation = levelsState.nearestSupport.zone.bottomPrice;
    } else if (direction === 'short' && levelsState?.nearestResistance) {
      suggestedInvalidation = levelsState.nearestResistance.zone.topPrice;
    }

    const posFactors = factors.filter(f => f.points > 0).map(f => f.name).join(', ');
    const negFactors = factors.filter(f => f.points < 0).map(f => f.name).join(', ');
    const explanation = `Score ${confluenceScore}/100 (${grade}) based on ${posFactors || 'neutral conditions'}${negFactors ? ` with penalties from ${negFactors}` : ''}. Direction is ${direction.toUpperCase()}.`;

    return {
      direction,
      confluenceScore,
      grade,
      factors,
      location: {
        trendlineId: activeTlId,
        zoneId: activeZoneId,
        levelPrice: locationPrice,
        description: locationDesc
      },
      obstacle,
      suggestedInvalidation,
      suggestedStopBasis,
      suggestedTargetBasis,
      warnings,
      missingModules,
      explanation,
      timestamp: Date.now()
    };
  }
}
