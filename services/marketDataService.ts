
// SentiTraderAIBeta0.3/services/marketDataService.ts
// Revision: 22.01.2026 - Feature: Real OHLC Extraction + Strict Polling

import { Asset, AssetType, CandleData, Timeframe } from '../types';
import { getIntervalStart } from '../utils/timeUtils';

const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_WS = 'wss://stream.binance.com:9443';

// ---------------------------------------------------------------------------
// BLOCK 1: ROBUST FETCH (Cache Busting)
// ---------------------------------------------------------------------------
/**
 * REVISED ROBUST FETCH (STOCKS):
 * Eliminates "Zombie Data" using Cache-Busting and prevents
 * request stacking with a strict AbortController.
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
// BLOCK 2: ASSET QUOTE FETCHER (Enhanced for Real OHLC)
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
 * Enhanced Fetch: Returns 'realCandle' to ensure O/H/L are correct mid-bucket.
 * IMPLEMENTS: Max-Timestamp Strategy to capture Pre-Market/Extended Hours correctly.
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
    // We include Pre/Post to get the extended hours data points
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const json = await robustFetchJson(proxyUrl);
    if (!json?.chart?.result?.[0]) return null;
    
    const result = json.chart.result[0];
    const meta = result.meta;

    // --- STRATEGY: MAX TIMESTAMP SELECTION ---
    // We gather all possible price points and select the one with the LATEST timestamp.
    // This solves the issue where 'meta.regularMarketPrice' is stale during Pre-Market.
    
    interface PriceCandidate { price: number; time: number; label: string; }
    const candidates: PriceCandidate[] = [];

    // 1. Regular Market
    if (meta.regularMarketPrice && meta.regularMarketTime) {
        candidates.push({ price: meta.regularMarketPrice, time: meta.regularMarketTime, label: 'REG' });
    }
    // 2. Pre Market
    if (meta.preMarketPrice && meta.preMarketTime) {
        candidates.push({ price: meta.preMarketPrice, time: meta.preMarketTime, label: 'PRE' });
    }
    // 3. Post Market
    if (meta.postMarketPrice && meta.postMarketTime) {
        candidates.push({ price: meta.postMarketPrice, time: meta.postMarketTime, label: 'POST' });
    }

    // 4. Last Candle in Array (Often fresher than Meta during transitions)
    let realCandle = undefined;
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    if (timestamps && quote && timestamps.length > 0) {
        const lastIdx = timestamps.length - 1;
        const lastTime = timestamps[lastIdx];
        const lastClose = quote.close[lastIdx];
        
        // Push candidate if valid
        if (lastTime && lastClose) {
            candidates.push({ price: lastClose, time: lastTime, label: 'CANDLE' });
        }

        // Prepare Real Candle object if recent (< 5 mins old)
        if (Date.now()/1000 - lastTime < 300) {
            realCandle = {
                open: quote.open[lastIdx],
                high: quote.high[lastIdx],
                low: quote.low[lastIdx],
                close: lastClose,
                volume: quote.volume[lastIdx] || 0
            };
        }
    }

    // --- SELECTION ---
    // Sort descending by time
    candidates.sort((a, b) => b.time - a.time);
    const winner = candidates[0]; // The most recent data point available

    // Fallback if no candidates (rare)
    const livePrice = winner ? winner.price : (meta.regularMarketPrice || 0);
    const liveTime = winner ? winner.time : (meta.regularMarketTime || 0);

    // --- REFERENCE PRICES ---
    // RTH Close is strictly the Regular Market Price (for 2nd row in Watchlist)
    const lastRthPrice = meta.regularMarketPrice || livePrice;
    
    // Previous Close logic for Change % calculation
    let rthClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPreviousClose;
    if (rthClose) prevCloseCache[symbol] = rthClose;
    else if (prevCloseCache[symbol]) rthClose = prevCloseCache[symbol];
    
    // Calculate change based on the selected Live Price vs Reference
    const changePct = rthClose ? ((livePrice - rthClose) / rthClose) * 100 : 0;

    return {
      price: livePrice,
      change: changePct,
      previousClose: rthClose || 0,
      lastRthPrice: lastRthPrice, // IMPORTANT: Used for Watchlist Secondary Row
      timestamp: liveTime * 1000,
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

  // STOCK POLLER (Sequential)
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
                open: quote.realCandle.open, // Real Open from API
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
     const pollStart = Date.now();

     if (stocks.length > 0) {
        const results = await Promise.all(stocks.map(async (s) => {
             const q = await fetchAssetQuote(s as Asset); 
             if (q) return { symbol: s.symbol, price: q.price, change: q.change, timestamp: q.timestamp, previousClose: q.previousClose, lastRthPrice: q.lastRthPrice }; 
             return null;
        }));
        const validUpdates = results.filter(u => u !== null);
        if (validUpdates.length > 0) onUpdate(validUpdates as any);
     }
     
     const elapsed = Date.now() - pollStart;
     const nextDelay = Math.max(100, 10000 - elapsed);
     
     if (active) setTimeout(pollStocks, nextDelay);
  };
  
  if (stocks.length > 0) pollStocks();

  return () => { active = false; if (ws) ws.close(); };
};
