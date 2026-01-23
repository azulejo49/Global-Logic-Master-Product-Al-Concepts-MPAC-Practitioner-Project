// SentiTraderAIBeta0.3/services/marketDataService.ts
// Revision 21.01.2026 - dev.team
// Protocol: Full Merge - Includes Robust Fetch, Cache-Busting, Extended Hours Logic, and Correct Anchoring.

import { Asset, AssetType, CandleData, Timeframe } from '../types';
import { getIntervalDuration, getMarketStatusInfo, getIntervalStart } from '../utils/timeUtils';

const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_WS = 'wss://stream.binance.com:9443';

// ---------------------------------------------------------------------------
// BLOCK 1: FETCH HELPERS (ROBUSTNESS LAYER)
// ---------------------------------------------------------------------------

/**
 * ROBUST FETCH JSON
 * - Applies Cache-Busting (cb=timestamp) to force fresh data from Proxy/Yahoo.
 * - Uses AbortController to strictly enforce timeout (10s), preventing request stacking.
 * - Used for Stock Quotes and History.
 */
async function robustFetchJson(url: string, timeout = 10100) {
    const separator = url.includes('?') ? '&' : '?';
    const freshUrl = `${url}${separator}cb=${Date.now()}`;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(freshUrl, { 
            signal: controller.signal,
            headers: { 'Cache-Control': 'no-cache' }
        });
        clearTimeout(id);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        clearTimeout(id);
        return null;
    }
}

/**
 * BASIC FETCH JSON
 * - Standard fetch for Crypto APIs (Binance) which are generally faster and don't need proxies.
 */
async function basicFetchJson(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { return null; }
}

// ---------------------------------------------------------------------------
// BLOCK 2: UTILITY HELPERS
// ---------------------------------------------------------------------------

// Memory cache for Previous Closes to prevent flickering during quick updates
const prevCloseCache: Record<string, number> = {};

const getBinancePair = (symbol: string): string => {
  const clean = symbol.toUpperCase().replace(/\s/g, '').replace('/', '');
  if (clean === 'BTCUSD' || clean === 'BTC') return 'BTCUSDT';
  if (clean === 'ETHUSD' || clean === 'ETH') return 'ETHUSDT';
  return clean.includes('USDT') ? clean : clean + 'USDT';
};

const isValidCandle = (candle: CandleData): boolean => {
    // Filter out garbage data or future timestamps
    const now = Date.now();
    const candleTime = new Date(candle.time).getTime();
    if (candleTime > now + 3600000) return false; 
    return !isNaN(candle.open) && candle.open > 0 && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close);
};

interface TimeframeParams { apiInterval: string; range?: string; limit?: number; }

const getTimeframeParams = (tf: Timeframe, assetType: AssetType): TimeframeParams => {
  if (assetType === AssetType.STOCK) {
    switch (tf) {
      case '1m': return { apiInterval: '1m', range: '1d' };
      case '5m': return { apiInterval: '5m', range: '5d' };
      case '15m': return { apiInterval: '15m', range: '5d' };
      case '30m': return { apiInterval: '30m', range: '5d' };
      case '1h': return { apiInterval: '60m', range: '1mo' };
      case '4h': return { apiInterval: '60m', range: '3mo' };
      case '1d': return { apiInterval: '1d', range: '1y' };
      case '1w': return { apiInterval: '1wk', range: '2y' };
      case '1M': return { apiInterval: '1mo', range: '5y' };
      case '3M': return { apiInterval: '1d', range: '3mo' };
      case '6M': return { apiInterval: '1d', range: '6mo' };
      case 'YTD': return { apiInterval: '1d', range: 'ytd' };
      case '1Y': return { apiInterval: '1d', range: '1y' };
      case '5Y': return { apiInterval: '1wk', range: '5y' };
      case 'All': return { apiInterval: '1mo', range: 'max' };
      default: return { apiInterval: '1d', range: '1y' };
    }
  } else {
    // Crypto Params (Binance)
    switch (tf) {
      case '1m': return { apiInterval: '1m', limit: 1440 };
      case '5m': return { apiInterval: '5m', limit: 288 }; 
      case '15m': return { apiInterval: '15m', limit: 200 };
      case '30m': return { apiInterval: '30m', limit: 100 };
      case '1h': return { apiInterval: '1h', limit: 300 };
      case '4h': return { apiInterval: '4h', limit: 200 };
      case '1d': return { apiInterval: '1d', limit: 365 };
      case '1w': return { apiInterval: '1w', limit: 104 };
      case '1M': return { apiInterval: '1M', limit: 60 };
      case '3M': return { apiInterval: '1d', limit: 90 };
      case '6M': return { apiInterval: '1d', limit: 180 };
      case 'YTD': return { apiInterval: '1d', limit: 365 };
      case '1Y': return { apiInterval: '1d', limit: 365 };
      case '5Y': return { apiInterval: '1w', limit: 260 };
      case 'All': return { apiInterval: '1M', limit: 1000 };
      default: return { apiInterval: '1h', limit: 100 };
    }
  }
};

// ---------------------------------------------------------------------------
// BLOCK 3: MAIN DATA FETCHER (SINGLE ASSET)
// ---------------------------------------------------------------------------

export const fetchAssetQuote = async (asset: Asset): Promise<{ price: number, change: number, previousClose: number, lastRthPrice?: number, timestamp: number } | null> => {
  // --- CRYPTO BRANCH ---
  if (asset.type === AssetType.CRYPTO) {
    const pair = getBinancePair(asset.symbol);
    const data = await basicFetchJson(`${BINANCE_API}/ticker/24hr?symbol=${pair}`);
    if (!data || data.lastPrice === undefined) return null;
    return {
      price: parseFloat(data.lastPrice),
      change: parseFloat(data.priceChangePercent),
      previousClose: parseFloat(data.prevClosePrice),
      lastRthPrice: parseFloat(data.prevClosePrice), // For crypto, RTH is effectively PrevClose
      timestamp: data.closeTime || Date.now()
    };
  } 
  
  // --- STOCK BRANCH ---
  else {
    const symbol = asset.symbol.replace('/', '-');
    // We use a small range (1d) + includePrePost=true to get the latest live metadata quickly
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const json = await robustFetchJson(proxyUrl);
    
    if (!json?.chart?.result?.[0]) return null;
    const result = json.chart.result[0];
    const meta = result.meta;

    // A. DETERMINE LIVE PRICE & TIME
    // Strategy: Priority logic (Post > Pre > Regular) based on timestamps.
    const regTime = meta.regularMarketTime || 0;
    const preTime = meta.preMarketTime || 0;
    const postTime = meta.postMarketTime || 0;

    let livePrice = meta.regularMarketPrice;
    let liveTime = regTime;
    let isExtendedHours = false;

    // Check Pre-Market (Priority 2)
    if (meta.preMarketPrice && preTime >= regTime) {
        livePrice = meta.preMarketPrice;
        liveTime = preTime;
        isExtendedHours = true;
    }
    // Check Post-Market (Priority 1)
    if (meta.postMarketPrice && postTime > regTime && postTime >= preTime) {
        livePrice = meta.postMarketPrice;
        liveTime = postTime;
        isExtendedHours = true;
    }

    // B. DETERMINE STATIC ANCHOR (For Change %)
    // If Live Session: Anchor = Yesterday's Close (previousClose).
    // If Extended Hours: Anchor = Last RTH Close (regularMarketPrice).
    
    let rthClose = meta.previousClose; // Default

    if (isExtendedHours) {
        // Market is Closed/Pre/Post. The "Reference" is the Close of the session that just finished.
        // E.g., at 6:00 PM, we compare 6:00 PM price vs 4:00 PM Close.
        if (meta.regularMarketPrice) {
            rthClose = meta.regularMarketPrice;
        }
    } else {
        // Market is Open. The "Reference" is Yesterday's Close.
        // We stick with meta.previousClose.
        // Fallback search order if meta.previousClose is missing:
        if (!rthClose) rthClose = meta.chartPreviousClose || meta.regularMarketPreviousClose;
        if (!rthClose && meta.currentTradingPeriod?.regular?.open) {
             rthClose = meta.currentTradingPeriod.regular.open; // Last ditch fallback
        }
    }

    // Update Cache
    if (rthClose) prevCloseCache[symbol] = rthClose;
    else if (prevCloseCache[symbol]) rthClose = prevCloseCache[symbol];

    // C. CALCULATE CHANGE
    const anchor = rthClose || 1;
    const changePct = ((livePrice - anchor) / anchor) * 100;

    if (!liveTime) liveTime = Date.now() / 1000;

    return {
      price: livePrice || 0,
      change: changePct,
      previousClose: rthClose || 0, // This passed to Watchlist Row 2
      lastRthPrice: rthClose || 0,
      timestamp: liveTime * 1000 // Convert to ms
    };
  }
};

// ---------------------------------------------------------------------------
// BLOCK 4: HISTORY FETCHERS (FOR CHART)
// ---------------------------------------------------------------------------

export const fetchCryptoHistory = async (symbol: string, timeframe: Timeframe): Promise<CandleData[]> => {
  const pair = getBinancePair(symbol);
  const params = getTimeframeParams(timeframe, AssetType.CRYPTO);
  const data = await basicFetchJson(`${BINANCE_API}/klines?symbol=${pair}&interval=${params.apiInterval}&limit=${params.limit}`);
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => ({
    time: new Date(d[0]).toISOString(),
    open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]),
  })).filter(isValidCandle);
};

export const fetchStockHistory = async (symbol: string, timeframe: Timeframe): Promise<CandleData[]> => {
  const yahooSymbol = symbol.replace('/', '-'); 
  const params = getTimeframeParams(timeframe, AssetType.STOCK);
  
  // NOTE: includePrePost=false for the main chart history (Standard View)
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${params.apiInterval}&range=${params.range}&includePrePost=false`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  
  // Use robustFetchJson here to allow potential caching logic in future, currently acts as standard
  const json = await robustFetchJson(proxyUrl);
  
  if (!json?.chart?.result?.[0]) return [];
  const res = json.chart.result[0];
  const q = res.indicators.quote[0];
  const ts = res.timestamp;
  if (!ts || !q.open) return [];
  
  return ts.map((t: number, i: number) => ({
    time: new Date(getIntervalStart(t * 1000, timeframe, AssetType.STOCK)).toISOString(),
    open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i]
  })).filter(isValidCandle);
};

export const getMarketData = async (asset: Asset, timeframe: Timeframe): Promise<CandleData[]> => {
  if (asset.type === AssetType.CRYPTO) {
      return fetchCryptoHistory(asset.symbol, timeframe);
  } else {
      return fetchStockHistory(asset.symbol, timeframe);
  }
};

// ---------------------------------------------------------------------------
// BLOCK 5: SUBSCRIBERS (POLLING & SOCKETS)
// ---------------------------------------------------------------------------

/**
 * SINGLE ASSET SUBSCRIBER (Used by Chart)
 * - Crypto: WebSocket
 * - Stock: Sequential Polling (10s interval)
 */
export const subscribeToAsset = (asset: Asset, timeframe: Timeframe, onUpdate: (tick: any, time: number) => void) => {
  // A. Crypto WebSocket
  if (asset.type === AssetType.CRYPTO) {
      const params = getTimeframeParams(timeframe, AssetType.CRYPTO);
      const pair = getBinancePair(asset.symbol).toLowerCase();
      const ws = new WebSocket(`${BINANCE_WS}/ws/${pair}@kline_${params.apiInterval}`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (!msg.k) return;
          const k = msg.k;
          onUpdate({ 
            time: new Date(k.t).toISOString(), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) 
          }, msg.E || Date.now());
        } catch(e) {}
      };
      return () => ws.close();
  }

  // B. Stock Sequential Polling
  let active = true;
  const executeSequentialPoll = async () => {
    if (!active) return;
    const pollStart = Date.now();
    
    // Uses the unified fetchAssetQuote logic (Pre/Post aware)
    const quote = await fetchAssetQuote(asset);

    if (quote) {
        // Pass the tick to App.tsx
        onUpdate({
            time: quote.timestamp, 
            open: quote.price,
            high: quote.price,
            low: quote.price,
            close: quote.price,
            volume: 0,
            previousClose: quote.previousClose,
            lastRthPrice: quote.lastRthPrice // Ensure this flows through
        }, quote.timestamp); 
    }

    // Dynamic delay: Target 10s cycle, subtract elapsed fetch time
    const elapsed = Date.now() - pollStart;
    const nextDelay = Math.max(100, 10100 - elapsed);
    
    if (active) setTimeout(executeSequentialPoll, nextDelay);
  };

  executeSequentialPoll();
  return () => { active = false; };
};

/**
 * WATCHLIST SUBSCRIBER (Used by Sidebar)
 * - Crypto: Multi-stream WebSocket
 * - Stock: Batch Polling Loop
 */
export const subscribeToWatchlist = (
  assets: { symbol: string, type: AssetType }[],
  onUpdate: (updates: { symbol: string, price: number, change: number, timestamp?: number, lastRthPrice?: number }[]) => void
): (() => void) => {
  const cryptos = assets.filter(a => a.type === AssetType.CRYPTO);
  const stocks = assets.filter(a => a.type === AssetType.STOCK);
  let ws: WebSocket | null = null;
  let active = true;

  // A. Crypto Watchlist (WebSocket)
  if (cryptos.length > 0) {
    const streams = cryptos.map(c => `${getBinancePair(c.symbol).toLowerCase()}@miniTicker`).join('/');
    ws = new WebSocket(`${BINANCE_WS}/stream?streams=${streams}`);
    const symbolMap: Record<string, string> = {};
    cryptos.forEach(c => symbolMap[getBinancePair(c.symbol).toUpperCase()] = c.symbol);
    ws.onmessage = (e) => {
      try {
          const msg = JSON.parse(e.data).data;
          if (msg && msg.e === '24hrMiniTicker') {
              const sym = symbolMap[msg.s.toUpperCase()];
              if (sym) {
                  const p = parseFloat(msg.c), o = parseFloat(msg.o);
                  onUpdate([{ symbol: sym, price: p, change: o === 0 ? 0 : ((p - o) / o) * 100, timestamp: msg.E }]);
              }
          }
      } catch(e) {}
    };
  }

  // B. Stock Watchlist (Polling)
  const pollStocks = async () => {
     if (!active) return;
     const pollStart = Date.now();

     if (stocks.length > 0) {
        const results = await Promise.all(stocks.map(async (s) => {
             // Reuses fetchAssetQuote to ensure consistency with Chart logic
             const q = await fetchAssetQuote(s as Asset); 
             if (q) return { 
                 symbol: s.symbol, 
                 price: q.price, 
                 change: q.change, 
                 timestamp: q.timestamp, 
                 previousClose: q.previousClose,
                 lastRthPrice: q.lastRthPrice
             }; 
             return null;
        }));
        
        const validUpdates = results.filter(u => u !== null);
        if (validUpdates.length > 0) onUpdate(validUpdates as any);
     }
     
     
     // 10s interval for background updates
     const elapsed = Date.now() - pollStart;
     const nextDelay = Math.max(100, 10100 - elapsed);
     
     if (active) setTimeout(pollStocks, nextDelay);
  };
  
  if (stocks.length > 0) pollStocks();

  return () => { active = false; if (ws) ws.close(); };
};