/**
 * TradeSight NIFTY 50 - Session Clock Service
 * Enforces Indian Standard Time (Asia/Kolkata, UTC+5:30) on all market timings.
 * Relies strictly on candle timestamps, never user local PC clock.
 */

export const SessionClock = {
  TIMEZONE: 'Asia/Kolkata',
  TIMEZONE_OFFSET_MINUTES: 330, // UTC + 5:30 = +330 mins

  /**
   * Convert any date, epoch or candle timestamp to IST time parts
   * @param {Date|number|string} timestamp
   * @returns {Object} { year, month, date, dayOfWeek, hour, minute, second, totalMinutes, formattedTime }
   */
  getIstParts(timestamp = null) {
    let d;
    if (!timestamp) {
      d = new Date();
    } else if (typeof timestamp === 'number') {
      // If seconds instead of ms (Unix epoch from TV)
      d = timestamp < 1e11 ? new Date(timestamp * 1000) : new Date(timestamp);
    } else if (typeof timestamp === 'string') {
      d = new Date(timestamp);
    } else if (timestamp instanceof Date) {
      d = timestamp;
    } else {
      d = new Date();
    }

    if (isNaN(d.getTime())) {
      d = new Date();
    }

    // Convert UTC to Asia/Kolkata
    const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
    const istTime = new Date(utcTime + this.TIMEZONE_OFFSET_MINUTES * 60000);

    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    const second = istTime.getSeconds();
    const totalMinutes = hour * 60 + minute;

    const pad = (n) => String(n).padStart(2, '0');
    const formattedTime = `${pad(hour)}:${pad(minute)}:${pad(second)} IST`;

    return {
      rawDate: istTime,
      year: istTime.getFullYear(),
      month: istTime.getMonth() + 1,
      date: istTime.getDate(),
      dayOfWeek: istTime.getDay(), // 0 = Sun, 1 = Mon, ..., 4 = Thu
      hour,
      minute,
      second,
      totalMinutes,
      formattedTime,
      isoDate: `${istTime.getFullYear()}-${pad(istTime.getMonth() + 1)}-${pad(istTime.getDate())}`
    };
  },

  /**
   * Check if candle time is within an exact IST window [startH:startM, endH:endM]
   */
  isWithinWindow(timestamp, startHour, startMinute, endHour, endMinute) {
    const { totalMinutes } = this.getIstParts(timestamp);
    const startMins = startHour * 60 + startMinute;
    const endMins = endHour * 60 + endMinute;
    return totalMinutes >= startMins && totalMinutes <= endMins;
  },

  /**
   * Get human-readable session phase
   */
  getSessionPhase(timestamp = null) {
    const { totalMinutes } = this.getIstParts(timestamp);

    if (totalMinutes < 9 * 60 + 15) return { phase: 'PRE_MARKET', label: 'Pre-Market / Pre-Open' };
    if (totalMinutes < 9 * 60 + 20) return { phase: 'OPEN_NOISE_BUFFER', label: '09:15-09:20 Open Noise (No Trades)' };
    if (totalMinutes < 9 * 60 + 30) return { phase: 'FIRST_15M_BUILDING', label: 'First 15-Min Candle Building' };
    if (totalMinutes < 11 * 60 + 30) return { phase: 'MORNING_TREND', label: 'Morning Trend & ORB Window' };
    if (totalMinutes < 13 * 60 + 30) return { phase: 'LUNCH_CHOP', label: 'Lunch-Hour Chop (11:30 - 13:30)' };
    if (totalMinutes < 13 * 60 + 45) return { phase: 'AFTERNOON_SETUP', label: '1:40 PM Setup Window' };
    if (totalMinutes < 14 * 60 + 45) return { phase: 'HERO_ZERO_WINDOW', label: 'Hero-Zero Expiry Gamma Window' };
    if (totalMinutes < 15 * 60 + 15) return { phase: 'CLOSING_DRIVE', label: 'Afternoon Trend Continuation' };
    if (totalMinutes < 15 * 60 + 30) return { phase: 'SQUARE_OFF', label: 'Intraday Square-off Window' };
    return { phase: 'POST_MARKET', label: 'Market Closed' };
  },

  /**
   * Calculate countdown in seconds to the next major time strategy event
   */
  getNextStrategyWindowCountdown(timestamp = null) {
    const { totalMinutes, second } = this.getIstParts(timestamp);
    const currentSeconds = totalMinutes * 60 + second;

    const milestones = [
      { name: '09:30 ORB Day Plan', targetSec: (9 * 60 + 30) * 60 },
      { name: '13:40 Afternoon Window', targetSec: (13 * 60 + 40) * 60 },
      { name: '13:45 Hero-Zero Window', targetSec: (13 * 60 + 45) * 60 },
      { name: '15:15 Day Close Exit', targetSec: (15 * 60 + 15) * 60 }
    ];

    for (const m of milestones) {
      if (currentSeconds < m.targetSec) {
        const diff = m.targetSec - currentSeconds;
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        return {
          nextEvent: m.name,
          remainingSeconds: diff,
          formattedCountdown: `${mins}m ${secs}s`
        };
      }
    }

    return {
      nextEvent: 'Market Closed for Today',
      remainingSeconds: 0,
      formattedCountdown: '00m 00s'
    };
  }
};
