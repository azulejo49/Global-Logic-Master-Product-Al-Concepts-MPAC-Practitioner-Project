// SentiTraderAIBeta0.3/technical Analysis.ts
import { CandleData, Indicator, Timeframe } from '../types';
import type { SeriesMarker, Time, UTCTimestamp, SeriesMarkerPosition, SeriesMarkerShape } from 'lightweight-charts';

// --- HELPER: Safe Time Conversion for Sorting Only ---
// We use this to compare times (sort), but we NEVER change the actual marker time format.
const toTimeValue = (time: Time): number => {
    if (typeof time === 'number') return time;
    if (typeof time === 'string') return new Date(time).getTime();
    if (typeof time === 'object' && time !== null) {
        if ('year' in time && 'month' in time && 'day' in time) {
             return new Date(time.year, time.month - 1, time.day).getTime();
        }
    }
    return 0;
};

// --- Dynamic Settings based on Timeframe ---
export const getMASettings = (timeframe: Timeframe) => {
  if (timeframe === '5m' || timeframe === '15m') {
    return { smaPeriod: 20, emaPeriod: 50, label: 'Intraday' };
  }
  if (timeframe === '1h' || timeframe === '4h') {
    return { smaPeriod: 50, emaPeriod: 21, label: 'Swing' };
  }
  if (timeframe === '1d') {
    return { smaPeriod: 200, emaPeriod: 50, label: 'Daily Trend' };
  }
  if (timeframe === '1w') {
    return { smaPeriod: 40, emaPeriod: 10, label: 'Weekly' };
  }
  return { smaPeriod: 10, emaPeriod: 3, label: 'Custom' };
};

// --- Basic Indicators ---
export const calculateSMA = (data: CandleData[], period: number): number[] => {
  if (data.length === 0) return [];
  return data.map((_, index) => {
    if (index < period - 1) return NaN;
    const slice = data.slice(index - period + 1, index + 1);
    const sum = slice.reduce((acc, curr) => acc + (curr.close || 0), 0);
    return sum / period;
  });
};

export const calculateEMA = (data: CandleData[], period: number): number[] => {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  let prevEma = data[0].close || 0;

  return data.map((candle, index) => {
    if (index === 0) return candle.close || 0;
    const close = candle.close || 0;
    const ema = close * k + prevEma * (1 - k);
    prevEma = ema;
    return ema;
  });
};

export const calculateRSI = (data: CandleData[], period: number = 14): number[] => {
  if (data.length < period + 1) return Array(data.length).fill(NaN);
  
  let gains: number[] = [];
  let losses: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const prevClose = data[i - 1].close || 0;
    const currClose = data[i].close || 0;
    const diff = currClose - prevClose;
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const rsiArray: number[] = Array(period).fill(NaN); 
  let rs = avgLoss === 0 ? 0 : avgGain / avgLoss; 
  let firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
  rsiArray.push(firstRsi);

  for (let i = period; i < gains.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    if (avgLoss === 0) {
        rsiArray.push(100);
    } else {
        rs = avgGain / avgLoss;
        rsiArray.push(100 - (100 / (1 + rs)));
    }
  }
  return rsiArray;
};

export const calculateVWAP = (data: CandleData[]): number[] => {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let previousDateStr = '';

  return data.map((candle) => {
    const currentDateStr = new Date(candle.time).toISOString().split('T')[0];
    if (currentDateStr !== previousDateStr) {
        cumulativeTPV = 0;
        cumulativeVolume = 0;
        previousDateStr = currentDateStr;
    }
    const typicalPrice = ((candle.high || 0) + (candle.low || 0) + (candle.close || 0)) / 3;
    cumulativeTPV += typicalPrice * (candle.volume || 0);
    cumulativeVolume += (candle.volume || 0);
    return cumulativeVolume === 0 ? 0 : cumulativeTPV / cumulativeVolume;
  });
};

export const enrichDataWithIndicators = (data: CandleData[], indicators: Set<Indicator>, timeframe: Timeframe): CandleData[] => {
  if (data.length === 0) return [];
  const settings = getMASettings(timeframe);
  const smas = indicators.has('SMA') ? calculateSMA(data, settings.smaPeriod) : [];
  const emas = indicators.has('EMA') ? calculateEMA(data, settings.emaPeriod) : [];
  const rsis = calculateRSI(data, 14); 
  const vwaps = indicators.has('VWAP') ? calculateVWAP(data) : [];

  return data.map((candle, i) => ({
    ...candle,
    sma20: smas[i], 
    ema50: emas[i],
    rsi: rsis[i],
    vwap: vwaps[i],
  }));
};

// --- TRENDLINES LOGIC ---
interface TrendLineData {
    time: Time; 
    value: number;
}

export const calculateTrendLines = (data: CandleData[]): { upper: TrendLineData[], lower: TrendLineData[] } => {
    if (data.length < 20) return { upper: [], lower: [] };
    const pivotLookback = 5;
    const highs: { index: number, val: number }[] = [];
    const lows: { index: number, val: number }[] = [];
    
    for (let i = pivotLookback; i < data.length - pivotLookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= pivotLookback; j++) {
            if (data[i - j].high > data[i].high || data[i + j].high > data[i].high) isHigh = false;
            if (data[i - j].low < data[i].low || data[i + j].low < data[i].low) isLow = false;
        }
        if (isHigh) highs.push({ index: i, val: data[i].high });
        if (isLow) lows.push({ index: i, val: data[i].low });
    }

    const getRegressionLine = (points: { index: number, val: number }[]) => {
        if (points.length < 2) return null;
        const recentPoints = points.slice(-8);
        const n = recentPoints.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (const p of recentPoints) {
            sumX += p.index; sumY += p.val; sumXY += p.index * p.val; sumXX += p.index * p.index;
        }
        if (n * sumXX - sumX * sumX === 0) return null; 
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
        return { slope, intercept, startIndex: recentPoints[0].index };
    };

    const upperReg = getRegressionLine(highs);
    const lowerReg = getRegressionLine(lows);
    const upperSeries: TrendLineData[] = [];
    const lowerSeries: TrendLineData[] = [];

    if (upperReg) {
        for (let i = upperReg.startIndex; i < data.length; i++) {
            const val = upperReg.slope * i + upperReg.intercept;
            if (Number.isFinite(val)) {
                upperSeries.push({ time: data[i].time, value: val });
            }
        }
    }
    if (lowerReg) {
        for (let i = lowerReg.startIndex; i < data.length; i++) {
            const val = lowerReg.slope * i + lowerReg.intercept;
             if (Number.isFinite(val)) {
                lowerSeries.push({ time: data[i].time, value: val });
             }
        }
    }
    return { upper: upperSeries, lower: lowerSeries };
};

// --- MARKER LOGIC ---

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  time: Time;
}

export interface TechnicalAnalysisResult {
    priceMarkers: SeriesMarker<Time>[];
    rsiMarkers: SeriesMarker<Time>[];
}

/**
 * Solves the 'vertical stacking' issue by grouping markers by timestamp
 * and resolving them based on institutional significance hierarchy.
 */
const resolveMarkerConflicts = (raw: SeriesMarker<Time>[]): SeriesMarker<Time>[] => {
  if (raw.length === 0) return [];

  // 1. Sort by Time Ascending (Using helper to handle string/number)
  const sortedRaw = [...raw].sort((a, b) => toTimeValue(a.time) - toTimeValue(b.time));

  // 2. Group by exact time match
  const map = new Map<string | number, SeriesMarker<Time>[]>();
  
  for (const m of sortedRaw) {
    const key = m.time as string | number;
    if (typeof key === 'object') continue; 
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }

  const result: SeriesMarker<Time>[] = [];
  
  map.forEach((ms) => {
    if (ms.length === 1) {
      result.push(ms[0]);
      return;
    }

    // Priority Weighting
    const getWeight = (text: string = '') => {
      if (text.includes('CHoCH')) return 1000;
      if (text.includes('H&S') || text.includes('Inv H&S')) return 950;
      if (text.includes('BOS')) return 900;
      if (text.includes('OB')) return 850; 
      if (text.includes('D-Top') || text.includes('D-Bot')) return 800;
      if (text.includes('Div')) return 700;
      if (text.includes('Engulf')) return 600;
      if (text.includes('Hammer') || text.includes('Star') || text.includes('Maru')) return 550;
      if (text.includes('FVG')) return 500;
      if (text.includes('Doji')) return 400;
      return 100;
    };

    const sorted = ms.sort((a, b) => getWeight(b.text) - getWeight(a.text));
    
    // Combine names for highest tier conflicts
    const highTier = sorted.filter(m => getWeight(m.text) >= 600);
    if (highTier.length > 1) {
        const uniqueTexts = Array.from(new Set(highTier.map(m => m.text)));
        const combinedText = uniqueTexts.slice(0, 2).join('/');
        result.push({ ...highTier[0], text: combinedText, size: 1.2 });
    } else {
        result.push(sorted[0]);
    }
  });
  
  // 3. Final Sort (Required by v5)
  return result.sort((a, b) => toTimeValue(a.time) - toTimeValue(b.time));
};

export const getTechnicalMarkers = (data: CandleData[], indicators: Set<Indicator>): TechnicalAnalysisResult => {
  let priceMarkers: SeriesMarker<Time>[] = [];
  let rsiMarkers: SeriesMarker<Time>[] = [];
  
  if (data.length < 15) return { priceMarkers, rsiMarkers };

  // --- 1. PATTERNS (SPLIT LOGIC) ---
  if (indicators.has('Patterns')) {
     
     // A. Geometric Patterns (Requires looking forward, stops early)
     const pivot = 5;
     const swings: SwingPoint[] = [];
     
     // Loop stops BEFORE the end to confirm pivot
     for(let i = pivot; i < data.length - pivot; i++) {
         let isH = true, isL = true;
         for(let j=1; j<=pivot; j++) {
            if(data[i-j].high > data[i].high || data[i+j].high > data[i].high) isH = false;
            if(data[i-j].low < data[i].low || data[i+j].low < data[i].low) isL = false;
         }
         const t = data[i].time;
         if(isH) swings.push({ index: i, price: data[i].high, type: 'high', time: t });
         if(isL) swings.push({ index: i, price: data[i].low, type: 'low', time: t });
     }
     const highs = swings.filter(s => s.type === 'high');
     const lows = swings.filter(s => s.type === 'low');

     // Double Top
     for(let i=1; i<highs.length; i++) {
        if (Math.abs(highs[i].price - highs[i-1].price) / highs[i].price < 0.002) {
            priceMarkers.push({ time: highs[i].time, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'D-Top' });
        }
     }
     // Double Bottom
     for(let i=1; i<lows.length; i++) {
        if (Math.abs(lows[i].price - lows[i-1].price) / lows[i].price < 0.002) {
            priceMarkers.push({ time: lows[i].time, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'D-Bot' });
        }
     }

     // Head & Shoulders
     if (highs.length >= 3) {
        for (let i = 2; i < highs.length; i++) {
            const ls = highs[i-2]; 
            const h = highs[i-1];  
            const rs = highs[i];   
            if (h.price > ls.price && h.price > rs.price) {
                if (Math.abs(ls.price - rs.price) / ls.price < 0.015) {
                    priceMarkers.push({ time: h.time, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'H&S', size: 1.5 });
                }
            }
        }
     }
     if (lows.length >= 3) {
        for (let i = 2; i < lows.length; i++) {
            const ls = lows[i-2];
            const h = lows[i-1];
            const rs = lows[i];
            if (h.price < ls.price && h.price < rs.price) {
                if (Math.abs(ls.price - rs.price) / ls.price < 0.015) {
                    priceMarkers.push({ time: h.time, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Inv H&S', size: 1.5 });
                }
            }
        }
     }

     // B. Candlestick Patterns (Live Edge)
     // FIX: This loop now runs independently to the VERY END of data
     // This ensures live candles get markers (Hammers, Engulfing, etc.)
     for (let i = 5; i < data.length; i++) {
         const curr = data[i];
         const prev = data[i-1];
         const prev2 = data[i-2];
         
         const range = curr.high - curr.low;
         const body = Math.abs(curr.close - curr.open);
         const isGreen = curr.close > curr.open;
         const isRed = curr.close < curr.open;
         const t = curr.time; // Direct time
         
         if (range === 0) continue;

         // Marubozu
         if (body > range * 0.9) {
             const color = isGreen ? '#00dc82' : '#ff4d4d';
             const text = isGreen ? 'Bull Maru' : 'Bear Maru';
             priceMarkers.push({ time: t, position: isGreen ? 'belowBar' : 'aboveBar', color, shape: 'circle', text, size: 0.5 });
         }

         // Doji
         const isDoji = Math.abs(curr.open - curr.close) <= range * 0.1;
         if (isDoji) {
             const upperWick = curr.high - Math.max(curr.open, curr.close);
             const lowerWick = Math.min(curr.open, curr.close) - curr.low;
             if (upperWick < range * 0.1) {
                 priceMarkers.push({ time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'D-Fly Doji', size: 0.8 });
             } else if (lowerWick < range * 0.1) {
                 priceMarkers.push({ time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'G-Stone Doji', size: 0.8 });
             }
         }

         // Hammer & Hanging Man
         const lowerWick = Math.min(curr.open, curr.close) - curr.low;
         const upperWick = curr.high - Math.max(curr.open, curr.close);
         
         if (lowerWick > body * 2 && upperWick < body * 0.5) {
             const trendLookback = Math.max(0, i - 5);
             if (curr.close < data[trendLookback].close) {
                 priceMarkers.push({ time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Hammer' });
             } else {
                 priceMarkers.push({ time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'Hang Man' });
             }
         }

         // Shooting Star & Inverted Hammer
         if (upperWick > body * 2 && lowerWick < body * 0.5) {
            const trendLookback = Math.max(0, i - 5);
            if (curr.close > data[trendLookback].close) {
                 priceMarkers.push({ time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'Shoot Star' });
            } else {
                 priceMarkers.push({ time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Inv Hammer' });
            }
         }

         // Engulfing
         const prevBody = Math.abs(prev.close - prev.open);
         if (prevBody > (prev.high - prev.low) * 0.3) { 
             if (prev.close < prev.open && isGreen && curr.close > prev.open && curr.open < prev.close) {
                 priceMarkers.push({ time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Bull Engulf', size: 1 });
             }
             if (prev.close > prev.open && isRed && curr.close < prev.open && curr.open > prev.close) {
                 priceMarkers.push({ time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'Bear Engulf', size: 1 });
             }
         }

         // Morning Star
         if (i > 3) {
             const c1 = prev2;
             const c2 = prev;
             const c3 = curr;
             const c1Body = Math.abs(c1.close - c1.open);
             const c2Body = Math.abs(c2.close - c2.open);
             const isC1Red = c1.close < c1.open;
             const isC3Green = c3.close > c3.open;

             if (isC1Red && isC3Green && c1Body > (c1.high - c1.low) * 0.6) {
                 if (c2Body < c1Body * 0.4) { 
                     const midpoint = (c1.open + c1.close) / 2;
                     if (c3.close > midpoint) {
                         priceMarkers.push({ time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Morn Star', size: 1.2 });
                     }
                 }
             }
         }
     }
  }

  // --- SMC LOGIC ---
  if (indicators.has('SMC')) {
      const pivot = 3; 
      const swings: {index: number, price: number, type: 'high'|'low', time: Time}[] = [];
      
      // Identify Swings
      for (let i = pivot; i < data.length - pivot; i++) {
        let isH = true, isL = true;
        for(let j=1; j<=pivot; j++) {
            if(data[i-j].high > data[i].high || data[i+j].high > data[i].high) isH = false;
            if(data[i-j].low < data[i].low || data[i+j].low < data[i].low) isL = false;
         }
         const t = data[i].time;
         if (isH) swings.push({index: i, price: data[i].high, type: 'high', time: t});
         if (isL) swings.push({index: i, price: data[i].low, type: 'low', time: t});
      }

      // Structure Breaks (BOS) & Order Blocks
      for (let i = 0; i < swings.length; i++) {
          const s = swings[i];
          for (let k = s.index + 1; k < data.length; k++) {
              const candle = data[k];
              const t = candle.time;
              
              if (s.type === 'high') {
                  if (candle.close > s.price) {
                      if (k - s.index < 300) { 
                          priceMarkers.push({
                              time: t, position: 'aboveBar', color: '#00dc82', shape: 'arrowUp', text: 'BOS', size: 1
                          });
                          // OB Logic
                          let minPrice = Infinity;
                          let minIdx = -1;
                          for(let m = s.index; m < k; m++) {
                              if (data[m].low < minPrice) {
                                  minPrice = data[m].low;
                                  minIdx = m;
                              }
                          }
                          if (minIdx !== -1) {
                              priceMarkers.push({
                                  time: data[minIdx].time, position: 'belowBar', color: '#3b82f6', shape: 'square', text: 'Bull OB', size: 1
                              });
                          }
                      }
                      break; 
                  }
              } else {
                  if (candle.close < s.price) {
                      if (k - s.index < 300) { 
                          priceMarkers.push({
                              time: t, position: 'belowBar', color: '#ff4d4d', shape: 'arrowDown', text: 'BOS', size: 1
                          });
                          // OB Logic
                          let maxPrice = -Infinity;
                          let maxIdx = -1;
                          for(let m = s.index; m < k; m++) {
                              if (data[m].high > maxPrice) {
                                  maxPrice = data[m].high;
                                  maxIdx = m;
                              }
                          }
                          if (maxIdx !== -1) {
                              priceMarkers.push({
                                  time: data[maxIdx].time, position: 'aboveBar', color: '#f472b6', shape: 'square', text: 'Bear OB', size: 1
                              });
                          }
                      }
                      break;
                  }
              }
          }
      }

      // FVG
      for(let i = 0; i < data.length - 2; i++) {
          const c1 = data[i];
          const c2 = data[i+1];
          const c3 = data[i+2];
          const range = c2.high - c2.low;
          if (range === 0) continue;

          if (c3.low > c1.high) {
             const gap = c3.low - c1.high;
             if (gap > range * 0.1 && c2.close > c2.open) {
                 priceMarkers.push({
                     time: c2.time, position: 'belowBar', color: '#fbbf24', shape: 'circle', text: 'FVG', size: 0.6
                 });
             }
          }
          if (c3.high < c1.low) {
             const gap = c1.low - c3.high;
             if (gap > range * 0.1 && c2.close < c2.open) {
                 priceMarkers.push({
                     time: c2.time, position: 'aboveBar', color: '#fbbf24', shape: 'circle', text: 'FVG', size: 0.6
                 });
             }
          }
      }
  }

  // --- RSI DIVERGENCE ---
  if (indicators.has('RSI')) {
      const pivot = 5;
      const lookback = 30; 

      const highs: {index: number, price: number, rsi: number, time: Time}[] = [];
      const lows: {index: number, price: number, rsi: number, time: Time}[] = [];

      for(let i = pivot; i < data.length - pivot; i++) {
          const currentRsi = data[i].rsi;
          if (currentRsi === undefined || isNaN(currentRsi)) continue; 

          let isHigh = true;
          let isLow = true;
          for(let k = 1; k <= pivot; k++) {
              if (data[i-k].high > data[i].high || data[i+k].high > data[i].high) isHigh = false;
              if (data[i-k].low < data[i].low || data[i+k].low < data[i].low) isLow = false;
          }
          
          const t = data[i].time;
          
          if (isHigh) {
              highs.push({ index: i, price: data[i].high, rsi: currentRsi, time: t });
              if (highs.length >= 2) {
                  const curr = highs[highs.length-1];
                  const prev = highs[highs.length-2];
                  // Bearish Divergence
                  if (curr.index - prev.index < lookback) {
                       if (curr.price > prev.price && curr.rsi < prev.rsi) {
                           priceMarkers.push({
                               time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'Bear Div', size: 1
                           });
                           rsiMarkers.push({
                               time: t, position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown', text: 'Bear Div', size: 1
                           });
                       }
                  }
              }
          }
          
          if (isLow) {
              lows.push({ index: i, price: data[i].low, rsi: currentRsi, time: t });
              if (lows.length >= 2) {
                  const curr = lows[lows.length-1];
                  const prev = lows[lows.length-2];
                  // Bullish Divergence
                  if (curr.index - prev.index < lookback) {
                       if (curr.price < prev.price && curr.rsi > prev.rsi) {
                           priceMarkers.push({
                               time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Bull Div', size: 1
                           });
                           rsiMarkers.push({
                               time: t, position: 'belowBar', color: '#00dc82', shape: 'arrowUp', text: 'Bull Div', size: 1
                           });
                       }
                  }
              }
          }
      }
  }

  // Final Sort using the helper
  return {
      priceMarkers: resolveMarkerConflicts(priceMarkers),
      rsiMarkers: resolveMarkerConflicts(rsiMarkers)
  };
};