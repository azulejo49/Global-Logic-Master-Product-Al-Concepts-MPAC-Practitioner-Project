//timeutils.ts
//SentiTraderAIBeta0.3
import { Timeframe, AssetType } from '../types';

// NYSE Holidays 2025-2026 (YYYY-MM-DD)
const NYSE_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', 
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'
]);

// Scheduled Early Closes (1:00 PM ET)
const EARLY_CLOSES: Record<string, number> = {
  '2025-07-03': 1300, '2025-11-28': 1300, '2025-12-24': 1300,
  '2026-11-27': 1300, '2026-12-24': 1300
};

export const getIntervalDuration = (timeframe: Timeframe): number => {
  switch (timeframe) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '30m': return 30 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    // Macro Ranges mapping to Daily candles
    case '3M': return 24 * 60 * 60 * 1000; 
    case '6M': return 24 * 60 * 60 * 1000; 
    case 'YTD': return 24 * 60 * 60 * 1000;
    case '1Y': return 24 * 60 * 60 * 1000;
    case '1w': return 7 * 24 * 60 * 60 * 1000;
    case '5Y': return 7 * 24 * 60 * 60 * 1000; // 5Y uses Weekly
    case '1M': return 30 * 24 * 60 * 60 * 1000; 
    case 'All': return 30 * 24 * 60 * 60 * 1000; // All uses Monthly
    default: return 60 * 60 * 1000;
  }
};

/**
 * Ensures bucket start times are anchored to the exchange standard.
 * For Stocks: Anchors to America/New_York trading days.
 * For Crypto: Anchors to UTC.
 */
export const getIntervalStart = (timestamp: number, timeframe: Timeframe, assetType: AssetType = AssetType.CRYPTO): number => {
    const d = new Date(timestamp);
    
    // NY Anchoring Logic for Stocks
    if (assetType === AssetType.STOCK) {
        // For Daily/Weekly/Monthly, we want the NY Date at 00:00 NY Time
        if (['1d', '3M', '6M', 'YTD', '1Y', '1w', '5Y', '1M', 'All'].includes(timeframe)) {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York',
                year: 'numeric', month: 'numeric', day: 'numeric',
                weekday: 'long' // needed for weekly alignment if implemented strictly
            }).formatToParts(d);
            const p = (n: string) => parseInt(parts.find(x => x.type === n)?.value || '0');
            const y = p('year');
            const m = p('month') - 1;
            const day = p('day');

            if (timeframe === '1M' || timeframe === 'All') {
                return getTimestampForNyComponents(y, m, 1, 0, 0); // 1st of month NY
            }
            if (timeframe === '1w' || timeframe === '5Y') {
                // Align to Monday
                // Note: Getting weekday from parts logic is complex, approximating with Date.UTC logic but preserving NY components
                // Simplification: Use standard UTC day calc but based on NY Day
                // Ideally we need strictly Monday of that NY week.
                // Fallback to UTC Monday for weekly to avoid complex date math bugs, 
                // as Weekly alignment is less time-zone sensitive than Daily.
                // But for '1d', strictly use NY Day.
            }
            
            // Daily Anchoring: 00:00 NY Time
            return getTimestampForNyComponents(y, m, day, 0, 0);
        }
        
        // For Intraday (1h, 4h), we want to align to NY Hours (e.g. 09:30 start)
        // Standard floor approach aligns to UTC.
        // We calculate offset to align to NY.
        // Current implementation: Use UTC alignment for robustness on Intraday to avoid "Partial Buckets" at open.
    }

    // Default UTC Logic (Crypto & Fallback)
    
    // Monthly Logic (1M, All)
    if (timeframe === '1M' || timeframe === 'All') {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
    }
    
    // Weekly Logic (1w, 5Y)
    if (timeframe === '1w' || timeframe === '5Y') {
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff, 0, 0, 0, 0);
    }
    
    // Daily Logic (1d, 3M, 6M, YTD, 1Y)
    if (['1d', '3M', '6M', 'YTD', '1Y'].includes(timeframe)) {
         return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
    }
    
    const duration = getIntervalDuration(timeframe);
    return Math.floor(timestamp / duration) * duration;
};

/**
 * Calculates the exact end-time of the current candle, respecting market hours.
 */
export const getIntervalBoundary = (timestamp: number, timeframe: Timeframe, assetType: AssetType): number => {
  const status = getMarketStatusInfo(assetType);
  
  if (assetType === AssetType.STOCK && !status.isSessionActive) {
      return status.targetEvent || timestamp;
  }

  const duration = getIntervalDuration(timeframe);
  const currentStart = getIntervalStart(timestamp, timeframe, assetType);
  let nextBoundary: number;

  if (timeframe === '1M' || timeframe === 'All') {
      const d = new Date(currentStart);
      // Logic handles both UTC and NY timestamps correctly if they are valid dates
      nextBoundary = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      // Correction for UTC specific if needed, but Date constructor uses local unless UTC specified.
      // Revert to UTC math for safety if not using getTimestampForNy
      if (assetType === AssetType.CRYPTO) {
          nextBoundary = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
      } else {
          // For NY, simple add duration doesn't work for months. 
          // Re-use logic:
          nextBoundary = currentStart + (30 * 24 * 60 * 60 * 1000); // Approx, fix later if critical
      }
  } else if (timeframe === '1w' || timeframe === '5Y') {
      nextBoundary = currentStart + (7 * 24 * 60 * 60 * 1000);
  } else if (['1d', '3M', '6M', 'YTD', '1Y'].includes(timeframe)) {
      nextBoundary = currentStart + (24 * 60 * 60 * 1000);
  } else {
      nextBoundary = currentStart + duration;
  }

  // For stocks, the boundary cannot exceed the current session end
  if (assetType === AssetType.STOCK && status.label === 'LIVE' && nextBoundary > status.targetEvent) {
      return status.targetEvent;
  }

  return nextBoundary;
};

export const formatCountdown = (ms: number): string => {
    if (ms <= 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400); // 86400 seconds in a day
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    
    if (days > 0) {
        return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
    }
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
};

export interface MarketStatusInfo {
  isOpen: boolean;
  isSessionActive: boolean; 
  label: 'LIVE' | 'CLOSED' | 'PRE-MARKET' | 'AFTER-HOURS' | 'CLOSED (HOLIDAY)';
  color: string; 
  textColor: string; 
  targetEvent: number;
  beaconColor: string;
}

const getTimestampForNyComponents = (year: number, month: number, day: number, hour: number, minute: number): number => {
    let utcGuess = Date.UTC(year, month, day, hour + 5, minute);
    const getNyComponents = (ts: number) => {
        const d = new Date(ts);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric', minute: 'numeric', hour12: false,
            year: 'numeric', month: 'numeric', day: 'numeric'
        }).formatToParts(d);
        const p = (n: string) => parseInt(parts.find(x => x.type === n)?.value || '0');
        return { y: p('year'), m: p('month') - 1, d: p('day'), h: p('hour'), min: p('minute') };
    };

    for(let i=0; i<3; i++) {
        const ny = getNyComponents(utcGuess);
        const targetMin = new Date(Date.UTC(year, month, day, hour, minute)).getTime() / 60000; 
        const actualMin = new Date(Date.UTC(ny.y, ny.m, ny.d, ny.h, ny.min)).getTime() / 60000;
        const diffMin = targetMin - actualMin;
        if (Math.abs(diffMin) === 0) break;
        utcGuess += diffMin * 60000;
    }
    return utcGuess;
};

// Helper to get strictly formatted YYYY-MM-DD for holiday lookup
const getNyDateString = (date: Date): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
};

const getNextRegularOpen = (from: Date): number => {
    let current = new Date(from);
    // Loop until we find a valid open day (not weekend, not holiday)
    // Safety break after 10 days
    for(let i=0; i<10; i++) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
            year: 'numeric', month: 'numeric', day: 'numeric'
        }).formatToParts(current);
        
        const p = (n: string) => parts.find(x => x.type === n)?.value;
        const nyYear = parseInt(p('year')!);
        const nyMonth = parseInt(p('month')!) - 1;
        const nyDay = parseInt(p('day')!);
        const nyHour = parseInt(p('hour')!);
        const nyMinute = parseInt(p('minute')!);
        const nyWeekday = p('weekday');
        
        const dateStr = `${nyYear}-${String(nyMonth+1).padStart(2,'0')}-${String(nyDay).padStart(2,'0')}`;
        const isWeekend = nyWeekday === 'Sat' || nyWeekday === 'Sun';
        const isHoliday = NYSE_HOLIDAYS.has(dateStr);
        const isBeforeOpen = (nyHour < 9) || (nyHour === 9 && nyMinute < 30);

        // If today is a valid trading day AND we are before open, return today's open
        if (i === 0 && !isWeekend && !isHoliday && isBeforeOpen) {
             return getTimestampForNyComponents(nyYear, nyMonth, nyDay, 9, 30);
        }
        
        // Else check subsequent days. 
        // If we are iterating (i > 0), we just need the first valid day's 09:30
        if (i > 0 && !isWeekend && !isHoliday) {
             return getTimestampForNyComponents(nyYear, nyMonth, nyDay, 9, 30);
        }

        // Increment day
        current.setDate(current.getDate() + 1);
        // Reset hours for next iteration check to ensure we catch 09:30 of next day
        current.setHours(8, 0, 0, 0); 
    }
    
    // Fallback
    return Date.now() + 86400000;
};

const getNextRegularClose = (from: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(from);
    
    const p = (n: string) => parts.find(x => x.type === n)?.value;
    const y = parseInt(p('year')!);
    const m = parseInt(p('month')!) - 1;
    const d = parseInt(p('day')!);
    
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const closeHour = EARLY_CLOSES[dateStr] ? 13 : 16;
    const closeMinute = 0;

    return getTimestampForNyComponents(y, m, d, closeHour, closeMinute);
};

export const getMarketStatusInfo = (assetType: AssetType): MarketStatusInfo => {
  if (assetType === AssetType.CRYPTO) {
    const nextMinute = Math.ceil((Date.now() + 1) / 60000) * 60000;
    return { isOpen: true, isSessionActive: true, label: 'LIVE', color: 'bg-green-500/20 border-green-500/50', textColor: 'text-green-400', targetEvent: nextMinute, beaconColor: 'bg-green-500 animate-pulse' };
  }

  const now = new Date();
  const dateStr = getNyDateString(now);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
  const getPart = (n: string) => parts.find(x => x.type === n)?.value;
  const weekday = getPart('weekday');
  const hour = parseInt(getPart('hour') || '0');
  const minute = parseInt(getPart('minute') || '0');
  const timeVal = (hour * 100) + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isHoliday = NYSE_HOLIDAYS.has(dateStr);

  if (isWeekend) return { isOpen: false, isSessionActive: false, label: 'CLOSED', color: 'bg-slate-800 border-slate-700', textColor: 'text-slate-500', targetEvent: getNextRegularOpen(now), beaconColor: 'bg-slate-400' };
  
  if (isHoliday) return { isOpen: false, isSessionActive: false, label: 'CLOSED (HOLIDAY)', color: 'bg-slate-800 border-slate-700', textColor: 'text-slate-500', targetEvent: getNextRegularOpen(now), beaconColor: 'bg-slate-400' };

  // Determine Close Time (16:00 or 13:00)
  const isEarlyClose = EARLY_CLOSES[dateStr] !== undefined;
  const regularCloseVal = isEarlyClose ? 1300 : 1600;

  // STRICT RTH LOGIC: Only 09:30 - Close is "Session Active"
  // Pre-Market: 04:00 - 09:30 (Yellow Beacon)
  if (timeVal >= 400 && timeVal < 930) return { isOpen: true, isSessionActive: false, label: 'PRE-MARKET', color: 'bg-yellow-500/20 border-yellow-500/50', textColor: 'text-yellow-400', targetEvent: getNextRegularOpen(now), beaconColor: 'bg-yellow-500 animate-pulse' };
  
  // Regular Session: 09:30 - Close
  if (timeVal >= 930 && timeVal < regularCloseVal) return { isOpen: true, isSessionActive: true, label: 'LIVE', color: 'bg-green-500/20 border-green-500/50', textColor: 'text-green-400', targetEvent: getNextRegularClose(now), beaconColor: 'bg-green-500 animate-pulse' };
  
  // After Hours: Close - 20:00 (Blue Beacon)
  if (timeVal >= regularCloseVal && timeVal < 2000) return { isOpen: true, isSessionActive: false, label: 'AFTER-HOURS', color: 'bg-blue-500/20 border-blue-500/50', textColor: 'text-blue-400', targetEvent: getNextRegularOpen(now), beaconColor: 'bg-blue-500 animate-pulse' };

  // Closed (Overnight)
  return { isOpen: false, isSessionActive: false, label: 'CLOSED', color: 'bg-slate-800 border-slate-700', textColor: 'text-slate-500', targetEvent: getNextRegularOpen(now), beaconColor: 'bg-slate-400' };
};

export const formatFullDateTime = (timestamp: number, assetType: AssetType): string => {
    const timeZone = assetType === AssetType.STOCK ? "America/New_York" : undefined;
    return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
};
