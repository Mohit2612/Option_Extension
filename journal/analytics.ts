/**
 * TradeSight NIFTY 50 - Journal Analytics & Behavioral Review (Module 8)
 * Computes empirical performance metrics, rule adherence comparisons,
 * user-specific edge insights (with 30-trade minimum reliability threshold),
 * auto-generated weekly review reports, and CSV export.
 */

export interface JournalTradeRecord {
  id: string;
  timestamp: string;
  timeOfDay?: string;
  session?: string;
  strategyName: string;
  grade?: string;
  qualityScore?: number;
  checklistPassed?: boolean;
  rulesFollowed: boolean;
  emotionTag?: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  exitPrice?: number | null;
  status: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN' | 'RULE_OVERRIDE';
  realizedR: number;
  pnlAmount?: number;
  notes?: string;
}

export interface JournalAnalyticsResult {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  averageR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  netRealizedR: number;
  netRealizedINR: number;
  ruleComparison: {
    followed: { count: number; winRate: number; netR: number; expectancyR: number };
    broken: { count: number; winRate: number; netR: number; expectancyR: number };
    edgeDeltaR: number;
  };
  bySession: Record<string, { trades: number; wins: number; winRate: number; netR: number }>;
  byGrade: Record<string, { trades: number; wins: number; winRate: number; netR: number }>;
  byStrategy: Record<string, { trades: number; wins: number; winRate: number; netR: number }>;
  byDayOfWeek: Record<string, { trades: number; wins: number; winRate: number; netR: number }>;
  userEdgeInsights: {
    isReliable: boolean;
    sampleSize: number;
    bestSession: string | null;
    bestStrategy: string | null;
    weakestStrategy: string | null;
    recommendation: string;
  };
  weeklyReview: {
    topMistakes: string[];
    topStrengths: string[];
    summaryText: string;
  };
}

export const JournalAnalytics = {
  MINIMUM_RELIABLE_TRADES: 30,

  /**
   * Compute comprehensive empirical dashboard analytics from trades
   */
  computeAnalytics(trades: JournalTradeRecord[] = [], capital: number = 200000, riskPerTradePct: number = 1.0): JournalAnalyticsResult {
    const closed = trades.filter((t) => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'BREAKEVEN');
    const totalTrades = trades.length;
    const closedTrades = closed.length;

    const wins = closed.filter((t) => t.status === 'WIN').length;
    const losses = closed.filter((t) => t.status === 'LOSS').length;
    const winRatePct = closedTrades > 0 ? parseFloat(((wins / closedTrades) * 100).toFixed(1)) : 0;

    let cumulativeR = 0;
    let peakR = 0;
    let maxDrawdownR = 0;
    let grossWinsR = 0;
    let grossLossesR = 0;

    closed.forEach((t) => {
      const r = t.realizedR || 0;
      cumulativeR += r;
      if (cumulativeR > peakR) peakR = cumulativeR;
      const dd = peakR - cumulativeR;
      if (dd > maxDrawdownR) maxDrawdownR = dd;

      if (r > 0) grossWinsR += r;
      else if (r < 0) grossLossesR += Math.abs(r);
    });

    const averageR = closedTrades > 0 ? parseFloat((cumulativeR / closedTrades).toFixed(2)) : 0;
    const avgWinR = wins > 0 ? grossWinsR / wins : 0;
    const avgLossR = losses > 0 ? grossLossesR / losses : 0;
    const winRateDec = winRatePct / 100;
    const lossRateDec = closedTrades > 0 ? (losses / closedTrades) : 0;
    const expectancyR = parseFloat(((winRateDec * avgWinR) - (lossRateDec * avgLossR)).toFixed(2));
    const profitFactor = grossLossesR > 0 ? parseFloat((grossWinsR / grossLossesR).toFixed(2)) : grossWinsR > 0 ? 99.0 : 0.0;

    const riskPerTradeINR = capital * (riskPerTradePct / 100);
    const netRealizedINR = Math.round(cumulativeR * riskPerTradeINR);

    // 1. Rule-Followed vs Rule-Broken Comparison
    const followedTrades = closed.filter((t) => t.rulesFollowed !== false);
    const brokenTrades = closed.filter((t) => t.rulesFollowed === false);

    const fWins = followedTrades.filter((t) => t.status === 'WIN').length;
    const fNetR = followedTrades.reduce((sum, t) => sum + (t.realizedR || 0), 0);
    const fWinRate = followedTrades.length > 0 ? Math.round((fWins / followedTrades.length) * 100) : 0;

    const bWins = brokenTrades.filter((t) => t.status === 'WIN').length;
    const bNetR = brokenTrades.reduce((sum, t) => sum + (t.realizedR || 0), 0);
    const bWinRate = brokenTrades.length > 0 ? Math.round((bWins / brokenTrades.length) * 100) : 0;

    const ruleComparison = {
      followed: {
        count: followedTrades.length,
        winRate: fWinRate,
        netR: parseFloat(fNetR.toFixed(2)),
        expectancyR: followedTrades.length > 0 ? parseFloat((fNetR / followedTrades.length).toFixed(2)) : 0
      },
      broken: {
        count: brokenTrades.length,
        winRate: bWinRate,
        netR: parseFloat(bNetR.toFixed(2)),
        expectancyR: brokenTrades.length > 0 ? parseFloat((bNetR / brokenTrades.length).toFixed(2)) : 0
      },
      edgeDeltaR: parseFloat((fNetR - bNetR).toFixed(2))
    };

    // 2. Breakdown by Session
    const bySession: Record<string, { trades: number; wins: number; winRate: number; netR: number }> = {};
    // 3. Breakdown by Grade
    const byGrade: Record<string, { trades: number; wins: number; winRate: number; netR: number }> = {};
    // 4. Breakdown by Strategy
    const byStrategy: Record<string, { trades: number; wins: number; winRate: number; netR: number }> = {};
    // 5. Breakdown by Day of Week
    const byDayOfWeek: Record<string, { trades: number; wins: number; winRate: number; netR: number }> = {
      Monday: { trades: 0, wins: 0, winRate: 0, netR: 0 },
      Tuesday: { trades: 0, wins: 0, winRate: 0, netR: 0 },
      Wednesday: { trades: 0, wins: 0, winRate: 0, netR: 0 },
      Thursday: { trades: 0, wins: 0, winRate: 0, netR: 0 },
      Friday: { trades: 0, wins: 0, winRate: 0, netR: 0 }
    };

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    closed.forEach((t) => {
      // Session
      const sess = t.session || t.timeOfDay || 'Prime Morning';
      if (!bySession[sess]) bySession[sess] = { trades: 0, wins: 0, winRate: 0, netR: 0 };
      bySession[sess].trades++;
      if (t.status === 'WIN') bySession[sess].wins++;
      bySession[sess].netR += (t.realizedR || 0);

      // Grade
      const grd = t.grade || 'A';
      if (!byGrade[grd]) byGrade[grd] = { trades: 0, wins: 0, winRate: 0, netR: 0 };
      byGrade[grd].trades++;
      if (t.status === 'WIN') byGrade[grd].wins++;
      byGrade[grd].netR += (t.realizedR || 0);

      // Strategy
      const strat = t.strategyName || 'Generic';
      if (!byStrategy[strat]) byStrategy[strat] = { trades: 0, wins: 0, winRate: 0, netR: 0 };
      byStrategy[strat].trades++;
      if (t.status === 'WIN') byStrategy[strat].wins++;
      byStrategy[strat].netR += (t.realizedR || 0);

      // Day
      const dayName = days[new Date(t.timestamp).getDay()];
      if (byDayOfWeek[dayName]) {
        byDayOfWeek[dayName].trades++;
        if (t.status === 'WIN') byDayOfWeek[dayName].wins++;
        byDayOfWeek[dayName].netR += (t.realizedR || 0);
      }
    });

    // Compute winrates
    Object.keys(bySession).forEach((k) => {
      bySession[k].winRate = Math.round((bySession[k].wins / bySession[k].trades) * 100);
      bySession[k].netR = parseFloat(bySession[k].netR.toFixed(2));
    });
    Object.keys(byGrade).forEach((k) => {
      byGrade[k].winRate = Math.round((byGrade[k].wins / byGrade[k].trades) * 100);
      byGrade[k].netR = parseFloat(byGrade[k].netR.toFixed(2));
    });
    Object.keys(byStrategy).forEach((k) => {
      byStrategy[k].winRate = Math.round((byStrategy[k].wins / byStrategy[k].trades) * 100);
      byStrategy[k].netR = parseFloat(byStrategy[k].netR.toFixed(2));
    });
    Object.keys(byDayOfWeek).forEach((k) => {
      if (byDayOfWeek[k].trades > 0) {
        byDayOfWeek[k].winRate = Math.round((byDayOfWeek[k].wins / byDayOfWeek[k].trades) * 100);
        byDayOfWeek[k].netR = parseFloat(byDayOfWeek[k].netR.toFixed(2));
      }
    });

    // 6. User-Specific Edge Insights
    const isReliable = closedTrades >= this.MINIMUM_RELIABLE_TRADES;
    let bestSession: string | null = null;
    let maxSessR = -999;
    Object.keys(bySession).forEach((s) => {
      if (bySession[s].netR > maxSessR && bySession[s].trades >= 3) {
        maxSessR = bySession[s].netR;
        bestSession = s;
      }
    });

    let bestStrategy: string | null = null;
    let weakestStrategy: string | null = null;
    let maxStratR = -999;
    let minStratR = 999;

    Object.keys(byStrategy).forEach((st) => {
      if (byStrategy[st].netR > maxStratR && byStrategy[st].trades >= 3) {
        maxStratR = byStrategy[st].netR;
        bestStrategy = st;
      }
      if (byStrategy[st].netR < minStratR && byStrategy[st].trades >= 3) {
        minStratR = byStrategy[st].netR;
        weakestStrategy = st;
      }
    });

    let recommendation = '';
    if (!isReliable) {
      recommendation = `Initial sample size (${closedTrades}/${this.MINIMUM_RELIABLE_TRADES} trades): Data is preliminary and not statistically reliable yet. Continue logging disciplined trades.`;
    } else {
      recommendation = `Validated Edge: Your strongest performance is in '${bestSession || 'Prime Window'}' utilizing '${bestStrategy || 'ORB'}'. Consider disabling '${weakestStrategy || 'weak setups'}' to optimize expectancy.`;
    }

    // 7. Auto-Generated Weekly Review Report
    const topMistakes: string[] = [];
    const topStrengths: string[] = [];

    if (brokenTrades.length > 0) {
      topMistakes.push(`Rule violations occurred in ${brokenTrades.length} trades, resulting in a net cost of ${Math.abs(bNetR)} R.`);
    }
    if (byGrade['C'] && byGrade['C'].trades > 0) {
      topMistakes.push(`Attempted ${byGrade['C'].trades} Grade C setup(s) instead of skipping.`);
    }
    if (bySession['Midday Chop'] && bySession['Midday Chop'].netR < 0) {
      topMistakes.push(`Midday chop zone trading caused negative performance (${bySession['Midday Chop'].netR} R).`);
    }
    if (topMistakes.length === 0) {
      topMistakes.push('No critical rule violations detected in this review cycle.');
    }

    if (followedTrades.length > 0 && fNetR > 0) {
      topStrengths.push(`Strict rule adherence produced +${fNetR} R net profit with ${fWinRate}% win rate.`);
    }
    if (bestStrategy && maxStratR > 0) {
      topStrengths.push(`Excellent execution on '${bestStrategy}' (+${maxStratR} R realized).`);
    }
    if (maxDrawdownR < 2.5) {
      topStrengths.push(`Drawdown was kept under tight control (${maxDrawdownR.toFixed(1)} R max drawdown).`);
    }
    if (topStrengths.length === 0) {
      topStrengths.push('Protected capital through basic position sizing.');
    }

    const summaryText = `Performance Summary: ${closedTrades} closed trades with ${winRatePct}% win rate and ${expectancyR > 0 ? '+' : ''}${expectancyR}R expectancy. Rule-adherent trades yielded +${fNetR}R vs ${bNetR}R from rule breaches.`;

    return {
      totalTrades,
      closedTrades,
      wins,
      losses,
      winRatePct,
      averageR,
      expectancyR,
      profitFactor,
      maxDrawdownR: parseFloat(maxDrawdownR.toFixed(2)),
      netRealizedR: parseFloat(cumulativeR.toFixed(2)),
      netRealizedINR,
      ruleComparison,
      bySession,
      byGrade,
      byStrategy,
      byDayOfWeek,
      userEdgeInsights: {
        isReliable,
        sampleSize: closedTrades,
        bestSession,
        bestStrategy,
        weakestStrategy,
        recommendation
      },
      weeklyReview: {
        topMistakes: topMistakes.slice(0, 3),
        topStrengths: topStrengths.slice(0, 3),
        summaryText
      }
    };
  },

  /**
   * Export trades ledger to CSV format
   */
  exportToCsv(trades: JournalTradeRecord[] = []): string {
    const headers = [
      'Trade ID',
      'Timestamp (IST)',
      'Session',
      'Strategy',
      'Grade',
      'Signal',
      'Entry Price',
      'Stop Loss',
      'Target 1',
      'Exit Price',
      'Status',
      'Realized R',
      'PnL Amount (INR)',
      'Rules Followed',
      'Checklist Passed',
      'Emotion Tag',
      'Notes'
    ];

    const rows = trades.map((t) => [
      `"${t.id}"`,
      `"${t.timestamp}"`,
      `"${t.session || t.timeOfDay || 'Prime'}"`,
      `"${t.strategyName || ''}"`,
      `"${t.grade || 'A'}"`,
      `"${t.status || 'OPEN'}"`,
      t.entryPrice || 0,
      t.stopLoss || 0,
      t.target1 || 0,
      t.exitPrice || '',
      `"${t.status}"`,
      t.realizedR || 0,
      t.pnlAmount || 0,
      t.rulesFollowed ? 'YES' : 'NO',
      t.checklistPassed ? 'YES' : 'NO',
      `"${t.emotionTag || 'Calm'}"`,
      `"${(t.notes || '').replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  },

  /**
   * Render Rule Comparison, Insights, and Weekly Review cards to DOM
   */
  renderDashboardCards(analytics: any): void {
    if (!analytics || typeof document === 'undefined') return;

    // 1. Rule Comparison
    const fR = document.getElementById('cmp-followed-r');
    const fWr = document.getElementById('cmp-followed-wr');
    const bR = document.getElementById('cmp-broken-r');
    const bWr = document.getElementById('cmp-broken-wr');
    const edgeDelta = document.getElementById('cmp-edge-delta');

    if (fR && analytics.ruleComparison?.followed) {
      fR.textContent = `${analytics.ruleComparison.followed.netR >= 0 ? '+' : ''}${analytics.ruleComparison.followed.netR} R`;
    }
    if (fWr && analytics.ruleComparison?.followed) {
      fWr.textContent = `${analytics.ruleComparison.followed.winRate}% Win Rate (${analytics.ruleComparison.followed.count} Trades)`;
    }
    if (bR && analytics.ruleComparison?.broken) {
      bR.textContent = `${analytics.ruleComparison.broken.netR >= 0 ? '+' : ''}${analytics.ruleComparison.broken.netR} R`;
    }
    if (bWr && analytics.ruleComparison?.broken) {
      bWr.textContent = `${analytics.ruleComparison.broken.winRate}% Win Rate (${analytics.ruleComparison.broken.count} Trades)`;
    }
    if (edgeDelta && analytics.ruleComparison) {
      edgeDelta.innerHTML = `Discipline Edge: Following rules generated an empirical advantage of <strong style="color:#00E676;">${analytics.ruleComparison.edgeDeltaR >= 0 ? '+' : ''}${analytics.ruleComparison.edgeDeltaR} R</strong> over emotional/impulsive trades.`;
    }

    // 2. User Edge Insights
    const sampleBadge = document.getElementById('insights-sample-badge');
    const recText = document.getElementById('insights-recommendation-text');
    if (sampleBadge && analytics.userEdgeInsights) {
      if (analytics.userEdgeInsights.isReliable) {
        sampleBadge.textContent = `✓ Reliable (${analytics.userEdgeInsights.sampleSize} Trades)`;
        sampleBadge.style.background = 'rgba(0,230,118,0.2)';
        sampleBadge.style.color = '#00E676';
      } else {
        sampleBadge.textContent = `⚠️ Small Sample (${analytics.userEdgeInsights.sampleSize}/30 Trades)`;
        sampleBadge.style.background = 'rgba(251,191,36,0.2)';
        sampleBadge.style.color = '#FBBF24';
      }
    }
    if (recText && analytics.userEdgeInsights) {
      recText.textContent = analytics.userEdgeInsights.recommendation;
    }

    // 3. Weekly Behavioral Review Report
    const strengthsList = document.getElementById('weekly-review-strengths');
    const mistakesList = document.getElementById('weekly-review-mistakes');
    if (strengthsList && analytics.weeklyReview?.topStrengths) {
      strengthsList.innerHTML = analytics.weeklyReview.topStrengths.map((s: string) => `<li>${s}</li>`).join('');
    }
    if (mistakesList && analytics.weeklyReview?.topMistakes) {
      mistakesList.innerHTML = analytics.weeklyReview.topMistakes.map((m: string) => `<li>${m}</li>`).join('');
    }
  }
};
