/**
 * TradeSight NIFTY 50 - No-Trade Filters & Holiday Calendar
 * Evaluates exchange holidays, scheduled macro event buffers (RBI MPC, Budget, Fed),
 * opening noise, and weekend closures.
 */

import { SessionClock } from '../services/sessionClock.js';

export interface NoTradeFilterResult {
  isBlocked: boolean;
  filterType: string | null;
  reason: string;
  allowedAfter?: string;
  rules: string[];
}

export const NoTradeFilters = {
  // Official NSE Trading Holidays (Configurable / Extensible)
  NSE_HOLIDAYS_2026: [
    '2026-01-26', // Republic Day
    '2026-03-03', // Mahashivratri
    '2026-03-20', // Holi
    '2026-03-31', // Id-Ul-Fitr
    '2026-04-03', // Good Friday
    '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
    '2026-05-01', // Maharashtra Day
    '2026-06-17', // Bakri Id
    '2026-08-15', // Independence Day
    '2026-09-16', // Eid-e-Milad
    '2026-10-02', // Mahatma Gandhi Jayanti
    '2026-10-20', // Dussehra
    '2026-11-08', // Diwali Balipratipada
    '2026-11-24', // Gurunanak Jayanti
    '2026-12-25'  // Christmas
  ],

  NSE_HOLIDAY_NAMES: {
    '2026-01-26': 'Republic Day',
    '2026-03-03': 'Mahashivratri',
    '2026-03-20': 'Holi',
    '2026-03-31': 'Id-Ul-Fitr',
    '2026-04-03': 'Good Friday',
    '2026-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
    '2026-05-01': 'Maharashtra Day',
    '2026-06-17': 'Bakri Id',
    '2026-08-15': 'Independence Day',
    '2026-09-16': 'Eid-e-Milad',
    '2026-10-02': 'Mahatma Gandhi Jayanti',
    '2026-10-20': 'Dussehra',
    '2026-11-08': 'Diwali Balipratipada',
    '2026-11-24': 'Gurunanak Jayanti',
    '2026-12-25': 'Christmas'
  } as Record<string, string>,

  // Major High-Impact Macro Economic Events (IST Timestamps)
  SCHEDULED_EVENTS: [
    { name: 'RBI Monetary Policy Announcement', time: '10:00', dates: ['2026-02-06', '2026-04-09', '2026-06-05', '2026-08-07', '2026-10-08', '2026-12-04'], bufferMins: 30 },
    { name: 'Union Budget Presentation', time: '11:00', dates: ['2026-02-01'], bufferMins: 60 }
  ],

  /**
   * Check if given date is an official NSE trading holiday
   */
  isNseHoliday(date: Date = new Date()): boolean {
    const ist = SessionClock.getIstParts(date);
    return this.NSE_HOLIDAYS_2026.includes(ist.isoDate);
  },

  /**
   * Check if given date is a weekend (Saturday / Sunday)
   */
  isWeekend(date: Date = new Date()): boolean {
    const ist = SessionClock.getIstParts(date);
    return ist.dayOfWeek === 0 || ist.dayOfWeek === 6; // Sunday = 0, Saturday = 6
  },

  /**
   * Check if date is a valid regular NSE trading day
   */
  isNSETradingDay(date: Date = new Date()): boolean {
    return !this.isWeekend(date) && !this.isNseHoliday(date);
  },

  /**
   * Retrieve holiday info including official festival name
   */
  getNSEHolidayInfo(date: Date = new Date()): { isHoliday: boolean; holidayName: string | null } {
    const ist = SessionClock.getIstParts(date);
    const isHoliday = this.isNseHoliday(date);
    const holidayName = this.NSE_HOLIDAY_NAMES[ist.isoDate] || (isHoliday ? 'Trading Holiday' : null);
    return { isHoliday, holidayName };
  },

  /**
   * Check if inside 30-minute high impact event risk buffer
   */
  isInsideEventBuffer(date: Date = new Date()): { isEventBuffer: boolean; hasEventRisk: boolean; eventName: string | null; eventTime: string | null; minsUntilEvent: number | null } {
    const res = this.checkEventRisk(date);
    return {
      isEventBuffer: res.hasEventRisk,
      hasEventRisk: res.hasEventRisk,
      eventName: res.eventName || null,
      eventTime: res.eventTime || null,
      minsUntilEvent: res.minsUntilEvent ?? null
    };
  },

  /**
   * Check if market is currently within 30 minutes of a major macro event
   */
  checkEventRisk(date: Date = new Date()): { hasEventRisk: boolean; eventName?: string; eventTime?: string; minsUntilEvent?: number } {
    const ist = SessionClock.getIstParts(date);
    const currentDate = ist.isoDate;
    const currentMins = ist.totalMinutes;

    for (const evt of this.SCHEDULED_EVENTS) {
      if (evt.dates.includes(currentDate)) {
        const parts = evt.time.split(':').map((n) => parseInt(n, 10));
        const evtMins = parts[0] * 60 + parts[1];
        const diff = evtMins - currentMins;

        // If event is in the next 30 minutes (or occurred within last 15 minutes)
        if (diff >= -15 && diff <= 30) {
          return {
            hasEventRisk: true,
            eventName: evt.name,
            eventTime: evt.time,
            minsUntilEvent: diff
          };
        }
      }
    }

    return { hasEventRisk: false };
  },

  /**
   * Comprehensive No-Trade Filter Evaluation
   */
  evaluateFilters(date: Date = new Date(), customHolidays: string[] = []): NoTradeFilterResult {
    const ist = SessionClock.getIstParts(date);

    // 1. Weekend Filter
    if (this.isWeekend(date)) {
      return {
        isBlocked: true,
        filterType: 'WEEKEND_CLOSED',
        reason: 'NSE regular session is closed on weekends (Saturday & Sunday).',
        rules: ['Market opens Monday at 09:15 IST', 'Rest, review journal, and prepare weekly watchlists']
      };
    }

    // 2. Official Holiday Filter
    const allHolidays = [...this.NSE_HOLIDAYS_2026, ...customHolidays];
    if (allHolidays.includes(ist.isoDate)) {
      return {
        isBlocked: true,
        filterType: 'NSE_HOLIDAY',
        reason: `NSE Exchange is closed today for an official trading holiday (${ist.isoDate}).`,
        rules: ['No cash or derivatives trading today', 'Enjoy the holiday and protect capital']
      };
    }

    // 3. Event Risk Filter (No event in next 30 mins)
    const eventCheck = this.checkEventRisk(date);
    if (eventCheck.hasEventRisk) {
      return {
        isBlocked: true,
        filterType: 'EVENT_RISK_BUFFER',
        reason: `High-impact macro event risk: ${eventCheck.eventName} at ${eventCheck.eventTime} IST. Institutional volatility trap danger.`,
        rules: [
          'Pre-event IV crush and unpredictable whipsaws make directional setups high-risk',
          'Wait for official policy announcement print and post-event reaction to settle'
        ]
      };
    }

    // 4. Opening Noise Filter (09:15 to 09:20 IST)
    const mins = ist.totalMinutes;
    if (mins >= 9 * 60 + 15 && mins < 9 * 60 + 20) {
      return {
        isBlocked: true,
        filterType: 'OPENING_NOISE_BUFFER',
        reason: 'Opening 5-minute volatility buffer (09:15 - 09:20 IST). Institutional orders settling.',
        rules: ['Avoid opening whipsaws', 'Wait for 09:20 opening range boundary establishment']
      };
    }

    return {
      isBlocked: false,
      filterType: null,
      reason: 'All macro, holiday and event filters clear.',
      rules: []
    };
  }
};
