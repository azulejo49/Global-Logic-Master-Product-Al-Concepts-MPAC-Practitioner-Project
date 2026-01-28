// SentiTraderAIBeta0.3/services/marketDataService.ts
// Revision: 28.01.2026 - Feature: "Time-Traveler" Candidate Selection for Extended Hours//Small stagger delay added

import { Asset, AssetType, CandleData, Timeframe } from '../types';

const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_WS = 'wss://stream.binance.com:9443';

// ---------------------------------------------------------------------------
// BLOCK 1: ROBUST FETCH (Cache Busting)
// ---------------------------------------------------------------------------
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
    } catch (err) { clearTimeout(id); return null; }
}

async function basicFetchJson(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { return null; }
}

// ---------------------------------------------------------------------------
// BLOCK 2: ASSET QUOTE FETCHER (Enhanced for Real OHLC & Extended Hours)
// ---------------------------------------------------------------------------
const prevCloseCache: Record<string, number> = {};
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
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const json = await robustFetchJson(proxyUrl);
    if (!json?.chart?.result?.[0]) return null;
    
    const result = json.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0] || {};

    // --- STRATEGY: CANDIDATE SELECTION ---
    // We collect all possible "Live" data points and pick the one with the LATEST timestamp.
    
    const candidates = [];

    // 1. Regular Market Meta
    if (meta.regularMarketTime && meta.regularMarketPrice) {
        candidates.push({ source: 'REG', time: meta.regularMarketTime, price: meta.regularMarketPrice });
    }
    // 2. Pre-Market Meta
    if (meta.preMarketTime && meta.preMarketPrice) {
        candidates.push({ source: 'PRE', time: meta.preMarketTime, price: meta.preMarketPrice });
    }
    // 3. Post-Market Meta
    if (meta.postMarketTime && meta.postMarketPrice) {
        candidates.push({ source: 'POST', time: meta.postMarketTime, price: meta.postMarketPrice });
    }
    // 4. Last Candle (Often the freshest source in early Pre-Market)
    if (timestamps.length > 0) {
        const lastIdx = timestamps.length - 1;
        const lastTime = timestamps[lastIdx];
        const lastClose = quote.close[lastIdx];
        if (lastTime && lastClose) {
            candidates.push({ source: 'CANDLE', time: lastTime, price: lastClose });
        }
    }

    // ELECT WINNER: Sort by Time Descending
    candidates.sort((a, b) => b.time - a.time);
    const winner = candidates[0];

    // Fallback defaults
    let livePrice = winner ? winner.price : (meta.regularMarketPrice || 0);
    let liveTime = winner ? winner.time : (meta.regularMarketTime || 0);

    // --- ANCHORING LOGIC ---
    // Last RTH Price is ALWAYS the Regular Market Price (Yesterday's Close if we are in Pre-Market)
    const lastRthPrice = meta.regularMarketPrice || 0;
    
    // Reference Close for % Change (Yesterday's Settlement)
    let refClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose || 0;
    
    // FIX: EXTENDED HOURS OVERRIDE
    // If the "Winner" is Extended Hours (Pre/Post/Newer Candle), strictly use Last RTH Price as reference.
    // This fixes the "poor calculation" where it compares Live Pre-Market vs T-2 Close.
    if (lastRthPrice > 0) {
        const isExtendedSource = winner && (winner.source === 'PRE' || winner.source === 'POST');
        const isNewerCandle = winner && winner.source === 'CANDLE' && winner.time > (meta.regularMarketTime || 0);
        
        if (isExtendedSource || isNewerCandle) {
            refClose = lastRthPrice;
        }
    }
    
    // Persist cache to prevent N/A flickering
    if (refClose) prevCloseCache[symbol] = refClose;
    else if (prevCloseCache[symbol]) refClose = prevCloseCache[symbol];

    // Calculate Change relative to the Reference Close
    const changePct = refClose ? ((livePrice - refClose) / refClose) * 100 : 0;

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
      previousClose: refClose,
      lastRthPrice: lastRthPrice, // Passed to Watchlist Row 2
      timestamp: liveTime * 1000, // Convert to ms for App.tsx
      realCandle
    };
  }
};

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
        const j = await robustFetchJson(`https://corsproxy.io/?${encodeURIComponent(u)}`);
        if(!j?.chart?.result?.[0]) return [];
        const r = j.chart.result[0];
        const q = r.indicators.quote[0];
        return r.timestamp.map((t:number, i:number) => ({
            time: new Date(t*1000).toISOString(),
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

  // B. Stock Watchlist (Polling)
 const pollStocks = async () => {
     if (!active) return;
     if (stocks.length > 0) {
        const updates = [];
        // Process in small batches or sequentially to avoid rate limits
        for (const s of stocks) {
            if (!active) break;
            const q = await fetchAssetQuote(s as Asset); 
            if (q) {
                updates.push({ symbol: s.symbol, price: q.price, change: q.change, timestamp: q.timestamp, previousClose: q.previousClose });
            }
            // Small stagger delay
            await new Promise(r => setTimeout(r, 500)); 
        }
        if (updates.length > 0 && active) onUpdate(updates);
     }
     if (active) setTimeout(pollStocks, 10000); // 10s loop for background watchlist
  };
  
  if (stocks.length > 0) pollStocks();
  return () => { active = false; if (ws) ws.close(); };
  };
