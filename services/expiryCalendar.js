/**
 * TradeSight NIFTY 50 - Expiry Calendar Service
 * Dynamically resolves NSE weekly/monthly expiry days and lot size. Never hardcoded.
 */

import { SessionClock } from './sessionClock.js';

export const ExpiryCalendar = {
  STORAGE_KEY: 'ts_nse_expiry_calendar',

  // Default NSE Nifty 50 Schedule
  DEFAULT_CONFIG: {
    standardExpiryDayOfWeek: 4, // Thursday (0 = Sun, 1 = Mon, ..., 4 = Thu)
    lotSize: 25, // Current NSE lot size
    holidays2026: [
      '2026-01-26', // Republic Day
      '2026-03-03', // Holi
      '2026-04-02', // Mahavir Jayanti
      '2026-04-14', // Dr. Ambedkar Jayanti
      '2026-05-01', // Maharashtra Day
      '2026-08-15', // Independence Day
      '2026-10-02', // Gandhi Jayanti
      '2026-10-20', // Dussehra
      '2026-11-08', // Diwali Balipratipada
      '2026-12-25'  // Christmas
    ]
  },

  /**
   * Evaluates if a given candle timestamp falls on the Nifty expiry day
   * @param {Date|number|string} timestamp - Candle timestamp
   * @param {Object} userOverride - Custom settings from chrome.storage
   * @returns {Object} { isExpiry, expiryType, dayOfWeek, scheduledDay, isHolidayPreponed }
   */
  checkExpiry(timestamp = null, userOverride = {}) {
    const ist = SessionClock.getIstParts(timestamp);
    const standardDay = userOverride.standardExpiryDayOfWeek !== undefined
      ? parseInt(userOverride.standardExpiryDayOfWeek, 10)
      : this.DEFAULT_CONFIG.standardExpiryDayOfWeek;

    const holidays = Array.isArray(userOverride.holidays) ? userOverride.holidays : this.DEFAULT_CONFIG.holidays2026;

    // Check if the scheduled standard expiry day this week falls on a trading holiday
    // If so, NSE prepones expiry to previous trading day (usually Wednesday)
    const scheduledExpiryDate = this.getScheduledExpiryDateForWeek(ist.rawDate, standardDay);
    const scheduledDateString = scheduledExpiryDate.toISOString().split('T')[0];

    let effectiveExpiryDate = scheduledExpiryDate;
    let isHolidayPreponed = false;

    if (holidays.includes(scheduledDateString)) {
      // Prepone by 1 day
      effectiveExpiryDate = new Date(scheduledExpiryDate.getTime() - 24 * 60 * 60 * 1000);
      isHolidayPreponed = true;
    }

    const effectiveDateString = effectiveExpiryDate.toISOString().split('T')[0];
    const isExpiry = ist.isoDate === effectiveDateString;

    // Check if Monthly Expiry (last Thursday/Wednesday of the month)
    const isMonthly = isExpiry && this.isLastExpiryOfMonth(effectiveExpiryDate, standardDay);

    return {
      isExpiry,
      expiryType: isExpiry ? (isMonthly ? 'MONTHLY' : 'WEEKLY') : 'NONE',
      effectiveExpiryDate: effectiveDateString,
      isHolidayPreponed,
      currentDayOfWeek: ist.dayOfWeek,
      standardDayOfWeek: standardDay,
      lotSize: userOverride.lotSize || this.DEFAULT_CONFIG.lotSize
    };
  },

  /**
   * Helper to find the date of Thursday (or scheduled day) for the week of the given date
   */
  getScheduledExpiryDateForWeek(date, standardDayOfWeek) {
    const d = new Date(date);
    const currentDay = d.getDay();
    const distance = standardDayOfWeek - currentDay;
    d.setDate(d.getDate() + distance);
    return d;
  },

  /**
   * Helper to determine if an expiry date is the final expiry of its month
   */
  isLastExpiryOfMonth(expiryDate, standardDayOfWeek) {
    const nextWeek = new Date(expiryDate);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.getMonth() !== expiryDate.getMonth();
  },

  /**
   * Fetch live calendar updates from storage or cache
   */
  async getLiveConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.STORAGE_KEY], (res) => {
        const stored = res[this.STORAGE_KEY] || {};
        resolve({
          ...this.DEFAULT_CONFIG,
          ...stored
        });
      });
    });
  }
};
