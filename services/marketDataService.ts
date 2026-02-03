// SentiTraderAIBeta/services/marketDataService.ts//Optimized Polling(batch-4)+ getIntervalStart } from '../utils/timeUtils';
// Revision: 03.02.2026 -dev/team/ Feature:rth last close-price-rows 69-71+anchored to watchlist-2ndrow-[batch polling 4-assets per batch]| "Time-Traveler" Candidate Selection for Extended Hours//Small stagger delay added

import { Asset, AssetType, CandleData, Timeframe } from '../types';
import { getIntervalStart } from '../utils/timeUtils';
const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_WS = 'wss://stream.binance.com:9443';

// ---------------------------------------------------------------------------
// BLOCK 1: ROBUST FETCH (Cache Busting)
// ---------------------------------------------------------------------------
const PROXIES = [
    // Primary: High speed, but strict CORS
    'https://corsproxy.io/?',
    // Fallback 1: Reliable
   // 'https://api.allorigins.win/raw?url=',
    // Fallback 2: Good for heavy payloads
  // 'https://api.codetabs.com/v1/proxy?quest=',
    // Fallback 3: Last resort
    'https://thingproxy.freeboard.io/fetch/', 
];

/**
 * Fetches JSON by rotating through proxies.
 * Fix: Now accepts a CLEAN URL and appends proxies internally.
 */
async function robustFetchJson(cleanUrl: string, timeout = 12200) {
    const separator = cleanUrl.includes('?') ? '&' : '?';
    const freshSuffix = `${separator}cb=${Date.now()}`;

    for (const proxyBase of PROXIES) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        
        try {
            // Encode strictly to ensure complex query params survive the proxy transit
            const target = `${proxyBase}${encodeURIComponent(cleanUrl + freshSuffix)}`;
            
            const response = await fetch(target, { 
                signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache' }
            });
            
            clearTimeout(id);
            
            if (response.ok) {
                return await response.json();
            }
        } catch (err) { 
            clearTimeout(id);
            // Silently fail and rotate to the next proxy
        }
    }
    return null; // All proxies failed
}

async function basicFetchJson(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { return null; }
}

// ---------------------------------------------------------------------------
// BLOCK 2: ASSET QUOTE FETCHER (Enhanced for Real OHLC & Extended Hours)/added lastRthCache/03.02.26
// ---------------------------------------------------------------------------
// [FIX] Caches for both Price and Time to bridge API gaps
const prevCloseCache: Record<string, number> = {};
const lastRthPriceCache: Record<string, number> = {};
const lastRthTimeCache: Record<string, number> = {};


const getBinancePair = (s: string) => {
    const c = s.toUpperCase().replace(/\s/g,'').replace('/','');
    return (c==='BTCUSD'||c==='BTC'?'BTCUSDT':(c==='ETHUSD'||c==='ETH'?'ETHUSDT':(c.includes('USDT')?c:c+'USDT')));
};
const getTimeframeParams = (tf: Timeframe, type: AssetType) => {
    if (type === AssetType.STOCK) {
        const map: Record<string,string> = {'1m':'1d','5m':'5d','15m':'5d','1h':'1mo','4h':'3mo','1d':'1y'};
        return { apiInterval: tf === '1h' || tf === '4h' ? '60m' : tf, range: map[tf] || '1y' };
    }
    const map: Record<string,string> = {'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1d':'1d'};
    return { apiInterval: map[tf]||'1h', limit: 300 };
};

/**
 * Enhanced Fetch: "Time-Traveler" Strategy.
 * Aggressively finds the latest timestamp from Metadata OR Candle History to ensure
 * Extended Hours (Pre/Post) are never static.
 */
export const fetchAssetQuote = async (asset: Asset): Promise<{ 
    price: number, change: number, previousClose: number, lastRthPrice?: number, timestamp: number,
    realCandle?: { open: number, high: number, low: number, close: number, volume: number }
} | null> => {
  
  // A. Crypto
  if (asset.type === AssetType.CRYPTO) {
    const pair = getBinancePair(asset.symbol);
    const data = await basicFetchJson(`${BINANCE_API}/ticker/24hr?symbol=${pair}`);
    if (!data?.lastPrice) return null;
    return {
      price: parseFloat(data.lastPrice),
      change: parseFloat(data.priceChangePercent),
      previousClose: parseFloat(data.prevClosePrice),
      lastRthPrice: parseFloat(data.prevClosePrice),
      timestamp: data.closeTime || Date.now()
    };
  } 
  
  // B. Stock (Yahoo)
  else {
    const symbol = asset.symbol.replace('/', '-');
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;
    
    // FIX: Pass the raw URL. robustFetchJson handles the proxies now.
    const json = await robustFetchJson(targetUrl);
    
    if (!json?.chart?.result?.[0]) return null;
    
    const result = json.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0] || {};

    // --- STRATEGY: CANDIDATE SELECTION ---
    // We collect all possible "Live" data points and pick the one with the LATEST timestamp.
    
   const candidates = [];
    if (meta.regularMarketTime && meta.regularMarketPrice) candidates.push({ source: 'REG', time: meta.regularMarketTime, price: meta.regularMarketPrice });
    if (meta.preMarketTime && meta.preMarketPrice) candidates.push({ source: 'PRE', time: meta.preMarketTime, price: meta.preMarketPrice });
    if (meta.postMarketTime && meta.postMarketPrice) candidates.push({ source: 'POST', time: meta.postMarketTime, price: meta.postMarketPrice });
    if (timestamps.length > 0) {
        const lastIdx = timestamps.length - 1;
        if (timestamps[lastIdx] && quote.close[lastIdx]) {
            candidates.push({ source: 'CANDLE', time: timestamps[lastIdx], price: quote.close[lastIdx] });
        }
    }
    candidates.sort((a, b) => b.time - a.time);
    const winner = candidates[0];

    const livePrice = winner ? winner.price : (meta.regularMarketPrice || 0);
    const liveTime = winner ? winner.time : (meta.regularMarketTime || 0);

    // 2. DEFINE ANCHORS
    // -----------------------------------------------------------
    // [FIX] PERSISTENT CACHING FOR STABLE PERCENTAGES
    // -----------------------------------------------------------
    // 2. RESOLVE & CACHE RTH DATA (Price & Time)
    let rthPrice = meta.regularMarketPrice;
    let rthTime = meta.regularMarketTime;

    // Cache Logic: If data exists, save it. If not, load from cache.
    if (rthPrice) lastRthPriceCache[symbol] = rthPrice;
    else rthPrice = lastRthPriceCache[symbol] || 0;

    if (rthTime) lastRthTimeCache[symbol] = rthTime;
    else rthTime = lastRthTimeCache[symbol] || 0;

    // Fallbacks if cache is empty
    if (!rthPrice) rthPrice = meta.chartPreviousClose || meta.previousClose || 0;

    const prevClose = meta.regularMarketPreviousClose || meta.previousClose || meta.chartPreviousClose || 0;

    // 3. CALCULATE LIVE CHANGE (TIME GAP LOGIC)
    let anchorForLiveChange = prevClose; // Default to Regular Hours Anchor (T-2/T-1 Previous)

    // Calculate gap in seconds between Live Data and Regular Market Data
    // In Pre-Market (Monday), liveTime is Today, rthTime is Friday. Gap is huge.
    // In RTH (Monday), liveTime is Today, rthTime is Today. Gap is small (~0).
    const timeGapSeconds = liveTime - rthTime;

    // [CRITICAL FIX] If gap > 20 mins (1200s), we are definitely in Extended Hours (Pre/Post/Weekend).
    // In this case, we MUST anchor to the RTH Close (T-1) to show correct drift.
    if (rthPrice > 0 && timeGapSeconds > 3000) {
        anchorForLiveChange = rthPrice;
    }

    // Persist Anchor Cache
    if (anchorForLiveChange) prevCloseCache[symbol] = anchorForLiveChange;
    else if (prevCloseCache[symbol]) anchorForLiveChange = prevCloseCache[symbol];

    const changePct = anchorForLiveChange ? ((livePrice - anchorForLiveChange) / anchorForLiveChange) * 100 : 0;

    // --- REAL CANDLE EXTRACTION (Mid-Bucket Fix) ---
    let realCandle = undefined;
    if (timestamps.length > 0 && quote.open) {
        const lastIdx = timestamps.length - 1;
        // Only use if recent (< 300s) to avoid ghost candles
        if (Date.now()/1000 - timestamps[lastIdx] < 300) {
            realCandle = {
                open: quote.open[lastIdx],
                high: quote.high[lastIdx],
                low: quote.low[lastIdx],
                close: quote.close[lastIdx],
                volume: quote.volume[lastIdx]
            };
        }
    }

    return {
      price: livePrice,
      change: changePct,
      previousClose: prevClose,
      lastRthPrice: rthPrice, // Passed to Watchlist Row 2/03.02/26
      timestamp: liveTime * 1000, // Convert to ms for App.tsx
      realCandle
    };
  }
};

     // BLOCK 3: HISTORICAL DATA FETCH (The Chart Source)
export const getMarketData = async (asset: Asset, timeframe: Timeframe): Promise<CandleData[]> => {
    if (asset.type === AssetType.CRYPTO) {
        const pair = getBinancePair(asset.symbol);
        const p = getTimeframeParams(timeframe, AssetType.CRYPTO);
        const d = await basicFetchJson(`${BINANCE_API}/klines?symbol=${pair}&interval=${p.apiInterval}&limit=${p.limit}`);
        if (!Array.isArray(d)) return [];
        return d.map((x:any) => ({time: new Date(x[0]).toISOString(), open: parseFloat(x[1]), high: parseFloat(x[2]), low: parseFloat(x[3]), close: parseFloat(x[4]), volume: parseFloat(x[5])}));
    } else {
        const s = asset.symbol.replace('/', '-');
        const p = getTimeframeParams(timeframe, AssetType.STOCK);
        const u = `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=${p.apiInterval}&range=${p.range}&includePrePost=false`;
        
        // FIX: Removed manual 'corsproxy.io' prefix. 02.02.26
        // We pass the RAW 'u' so robustFetchJson can apply rotation correctly.
        const j = await robustFetchJson(u);
        
        if(!j?.chart?.result?.[0]) return [];
        const r = j.chart.result[0];
        const q = r.indicators.quote[0];
        
        return r.timestamp.map((t:number, i:number) => ({
            // FIX: Restored getIntervalStart to ensure alignment (prevents unused var error)
            time: new Date(getIntervalStart(t*1000, timeframe, AssetType.STOCK)).toISOString(),
            open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i]
        })).filter((c:any) => c.open && c.close);
    }
};

// ---------------------------------------------------------------------------
// BLOCK 4: SINGLE ASSET SUBSCRIBER
// ---------------------------------------------------------------------------
export const subscribeToAsset = (asset: Asset, timeframe: Timeframe, onUpdate: (tick: any, time: number) => void) => {
  if (asset.type === AssetType.CRYPTO) {
      const pair = getBinancePair(asset.symbol).toLowerCase();
      const interval = getTimeframeParams(timeframe, AssetType.CRYPTO).apiInterval;
      const ws = new WebSocket(`${BINANCE_WS}/ws/${pair}@kline_${interval}`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.k) onUpdate({ 
            time: new Date(msg.k.t).toISOString(), 
            open: parseFloat(msg.k.o), high: parseFloat(msg.k.h), low: parseFloat(msg.k.l), close: parseFloat(msg.k.c), volume: parseFloat(msg.k.v) 
          }, msg.E);
        } catch(e) {}
      };
      return () => ws.close();
  }

  // STOCK POLLER
  let active = true;
  const executeSequentialPoll = async () => {
    if (!active) return;
    const start = Date.now();
    const quote = await fetchAssetQuote(asset);
    
    if (quote) {
        // --- USE REAL CANDLE IF AVAILABLE ---
        let tickData;
        if (quote.realCandle) {
            tickData = {
                time: quote.timestamp,
                open: quote.realCandle.open, 
                high: Math.max(quote.realCandle.high, quote.price),
                low: Math.min(quote.realCandle.low, quote.price),
                close: quote.price,
                volume: quote.realCandle.volume,
                previousClose: quote.previousClose
            };
        } else {
            tickData = {
                time: quote.timestamp,
                open: quote.price,
                high: quote.price,
                low: quote.price,
                close: quote.price,
                volume: 0,
                previousClose: quote.previousClose
            };
        }
        onUpdate(tickData, quote.timestamp);
    }

    const elapsed = Date.now() - start;
    if (active) setTimeout(executeSequentialPoll, Math.max(2000, 10000 - elapsed));
  };

  executeSequentialPoll();
  return () => { active = false; };
};

// ---------------------------------------------------------------------------
// BLOCK 5: WATCHLIST SUBSCRIBER (Fixed Scope)
// ---------------------------------------------------------------------------
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

 // B. Stock (Optimized Batch Polling)
  const pollStocks = async () => {
     if (!active) return;
     if (stocks.length > 0) {
        // IMPROVEMENT: Process in chunks of 4 to prevent total blocking
        const CHUNK_SIZE = 4;
        for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
            if (!active) break;
            const chunk = stocks.slice(i, i + CHUNK_SIZE);
            //added lastRthPrice: q.lastRthPrice to -fetchAssetQuote(s as Asset);/rev.03.02.26
            const updates = await Promise.all(chunk.map(async (s) => {
                const q = await fetchAssetQuote(s as Asset);
                if (q) return { symbol: s.symbol, price: q.price, change: q.change, timestamp: q.timestamp, lastRthPrice: q.lastRthPrice, previousClose: q.previousClose };
                return null;
            }));
            
            const valid = updates.filter(u => u !== null);
            if (valid.length > 0 && active) onUpdate(valid as any);
            
            // Short rest between chunks to be kind to the API
            await new Promise(r => setTimeout(r, 800));
        }
     }
     if (active) setTimeout(pollStocks, 11000); // 11s Loop
  };
  
  if (stocks.length > 0) pollStocks();
  return () => { active = false; if (ws) ws.close(); };
};
