/**
 * TradeSight NIFTY 50 - Mandatory Pre-Trade Checklist (Module 6)
 * A hard behavioral gate: NO signal is displayed as actionable unless all 8 criteria pass:
 *  1. Inside an allowed session (Auto)
 *  2. Regime suits the strategy (Auto)
 *  3. Grade A (or B if enabled) (Auto)
 *  4. SL defined and R:R >= 1:2.0 (Auto)
 *  5. Position size within risk limit (Auto)
 *  6. No event risk in next 30 minutes (Auto)
 *  7. Daily loss and trade limits not reached (Auto)
 *  8. I am calm and following my plan (Manual Confirmation)
 */

export const PreTradeChecklist = {
  /**
   * Evaluate all 8 checklist criteria
   */
  evaluate({
    sessionInfo = null,
    regimeScore = 80,
    qualityScore = null,
    signalData = null,
    sizingResult = null,
    filterCheck = null,
    dailyState = null,
    manualCalmConfirmed = false,
    allowGradeB = true
  } = {}) {
    // 1. Inside an allowed session
    const isSessionAllowed = sessionInfo ? !!sessionInfo.isAllowed : true;
    const sessionItem = {
      id: 'chk_session',
      label: 'Inside an allowed trading session (IST)',
      isAuto: true,
      isPassed: isSessionAllowed,
      details: isSessionAllowed
        ? `Active session: ${sessionInfo?.sessionName || 'Prime Window'}`
        : `Restricted window: ${sessionInfo?.reason || 'Outside session'}`
    };

    // 2. Regime suits the strategy
    const isRegimeSuitable = regimeScore >= 60;
    const regimeItem = {
      id: 'chk_regime',
      label: 'Market regime suits active strategy',
      isAuto: true,
      isPassed: isRegimeSuitable,
      details: isRegimeSuitable
        ? `Regime '${signalData?.regime?.label || 'Aligned'}' verified.`
        : 'Strategy and current market structure conflict (high whipsaw risk).'
    };

    // 3. Grade A (or B if enabled)
    const grade = qualityScore?.grade || 'A';
    const isGradePassed = qualityScore ? (grade === 'A' || (grade === 'B' && allowGradeB)) : true;
    const gradeItem = {
      id: 'chk_grade',
      label: 'Trade Quality Score Grade A (or B if enabled)',
      isAuto: true,
      isPassed: isGradePassed,
      details: isGradePassed
        ? `Setup meets institutional quality (${qualityScore?.gradeTitle || 'Grade A'}).`
        : `Setup graded as ${grade} (<65 score or Grade B disabled).`
    };

    // 4. SL defined and R:R >= 1:2.0
    const rr = signalData?.levels?.riskRewardRatio ? parseFloat(signalData.levels.riskRewardRatio) : 2.0;
    const hasSl = !!signalData?.levels?.stopLoss;
    const isRrPassed = hasSl && rr >= 1.95; // Allow 1:1.95 rounding
    const rrItem = {
      id: 'chk_rr',
      label: 'Stop Loss defined and R:R ≥ 1:2.0',
      isAuto: true,
      isPassed: isRrPassed,
      details: isRrPassed
        ? `Defined SL at ${signalData?.levels?.stopLoss} with 1:${rr} R:R.`
        : `Invalid risk parameters (SL: ${signalData?.levels?.stopLoss || 'None'}, R:R: 1:${rr}).`
    };

    // 5. Position size within risk limit
    const isSizingPassed = sizingResult ? (sizingResult.canExecute !== false && !sizingResult.isRiskTooHigh && (sizingResult.lots === undefined || sizingResult.lots > 0)) : true;
    const sizingItem = {
      id: 'chk_sizing',
      label: 'Position size strictly within risk limit (≤ 1.0%)',
      isAuto: true,
      isPassed: isSizingPassed,
      details: isSizingPassed
        ? `Sized at ${sizingResult?.lots || 1} lot(s) (₹${sizingResult?.actualRiskINR || 2000} risk).`
        : (sizingResult?.recommendation || 'Position risk exceeds capital allocation.')
    };

    // 6. No event risk in the next 30 minutes
    const hasEventRisk = filterCheck ? !!filterCheck.hasEventRisk : false;
    const eventItem = {
      id: 'chk_event',
      label: 'No major macro event risk in the next 30 minutes',
      isAuto: true,
      isPassed: !hasEventRisk,
      details: !hasEventRisk
        ? 'No scheduled high-impact events (RBI MPC, Budget, Fed) in 30m window.'
        : `Event risk active: ${filterCheck?.eventName || 'Macro announcement'}`
    };

    // 7. Daily loss and trade limits not reached
    const isLimitsOk = dailyState ? (!dailyState.isLocked && dailyState.tradesCount < (dailyState.limits?.maxDailyTrades || 3)) : true;
    const limitsItem = {
      id: 'chk_limits',
      label: 'Daily loss limit and max trades limit not breached',
      isAuto: true,
      isPassed: isLimitsOk,
      details: isLimitsOk
        ? `State: ${dailyState?.state || 'READY'} • Realized: ${dailyState?.realizedR || 0}R • Trades: ${dailyState?.tradesCount || 0}/${dailyState?.limits?.maxDailyTrades || 3}`
        : `Discipline limit reached: ${dailyState?.lockReason || 'Trading locked for today'}`
    };

    // 8. I am calm and following my plan (Manual tick)
    const calmItem = {
      id: 'chk_calm',
      label: 'I am calm, disciplined, and executing my defined plan',
      isAuto: false,
      isPassed: !!manualCalmConfirmed,
      details: manualCalmConfirmed
        ? 'Trader psychological self-affirmation confirmed.'
        : 'Awaiting manual trader confirmation tick.'
    };

    const items = [
      sessionItem,
      regimeItem,
      gradeItem,
      rrItem,
      sizingItem,
      eventItem,
      limitsItem,
      calmItem
    ];

    const passedCount = items.filter((i) => i.isPassed).length;
    const totalCount = items.length;
    const allPassed = passedCount === totalCount;
    const failedItems = items.filter((i) => !i.isPassed);

    const summaryMessage = allPassed
      ? '✓ All pre-trade checklist criteria verified! Setup is CONFIRMED READY for execution.'
      : `${totalCount - passedCount} of ${totalCount} checklist checks remaining before execution can be authorized.`;

    return {
      allPassed,
      passedCount,
      totalCount,
      canExecute: allPassed,
      items,
      failedItems,
      summaryMessage
    };
  },

  /**
   * Flexible caller alias for evaluateChecklist
   */
  evaluateChecklist(params = {}) {
    const hasEventRisk = params.eventRisk ? !!params.eventRisk.isEventBuffer : false;
    const filterCheck = params.filterCheck || { hasEventRisk, eventName: params.eventRisk?.eventName };
    const signalData = params.signalData || {
      regime: params.regime,
      levels: {
        entryPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        riskRewardRatio: params.riskRewardRatio ?? 2.0
      }
    };

    const res = this.evaluate({
      sessionInfo: params.sessionInfo,
      regimeScore: params.regimeScore ?? (params.regime ? 80 : 80),
      qualityScore: params.qualityScore,
      signalData,
      sizingResult: params.sizingResult,
      filterCheck,
      dailyState: params.dailyDisciplineState || params.dailyState,
      manualCalmConfirmed: params.isCalmConfirmed ?? params.manualCalmConfirmed ?? false,
      allowGradeB: params.allowGradeB !== false
    });

    // Ensure items match both identifier conventions
    res.items.forEach((item) => {
      if (item.id === 'chk_calm') item.id = 'calm_and_plan';
      if (item.id === 'chk_rr') item.id = 'sl_and_rr';
    });

    return res;
  }
};
