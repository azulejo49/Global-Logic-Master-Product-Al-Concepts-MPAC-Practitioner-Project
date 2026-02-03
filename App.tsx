// SentiTraderAIBeta//App.tsx
// Revision 03.02.2026 - dev.team
// Protocol: Extended Hours Candle Freeze + Live Price Line enabled./added const newChange = realtimeData.change////anchored % change calcul.to last rthclose(pre/post) [DIAGNOSTIC FIX] row 256

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Asset, CandleData, Indicator, Timeframe, AIAnalysisReport, AssetType, TradeSetup } from './types';
import { INITIAL_ASSETS, createAssetFromSymbol } from './constants';
import ChartContainer, { ChartHandle } from './components/ChartContainer';
import IndicatorSelector from './components/IndicatorSelector';
import TimeframeSelector from './components/TimeframeSelector';
import AIAnalyst from './components/AIAnalyst';
import Watchlist from './components/Watchlist';
import { generateMarketAnalysis } from './services/geminiService';
import { getMarketData, subscribeToAsset, fetchAssetQuote, subscribeToWatchlist } from './services/marketDataService';
import { enrichDataWithIndicators } from './utils/technicalAnalysis';
import { getIntervalStart, getIntervalBoundary, getMarketStatusInfo } from './utils/timeUtils';

const STORAGE_KEY = 'sentitrader_watchlist';
// --- HELPER FUNCTION (Moved Outside Component Scope) ---
// Checks if a timestamp is strictly within Regular Trading Hours (09:30 - 16:00 ET)
const isRthTime = (timestamp: number): boolean => {
    // Handle both ms and seconds timestamps
    const t = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const date = new Date(t);
    const nyTime = date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
    const [h, m] = nyTime.split(':').map(Number);
    const val = h * 100 + m;
    // 930 = 9:30 AM, 1600 = 4:00 PM
    return val >= 930 && val <= 1600;
};

const App: React.FC = () => {
  // ---------------------------------------------------------------------------
  // BLOCK 1: STATE MANAGEMENT & PERSISTENCE
  // ---------------------------------------------------------------------------
  // Initialize assets from local storage to persist user watchlist between reloads.
  const [assets, setAssets] = useState<Asset[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved watchlist", e);
        return INITIAL_ASSETS;
      }
    }
    return INITIAL_ASSETS;
  });

  // Core Application State
  const [selectedAsset, setSelectedAsset] = useState<Asset>(assets[0] || INITIAL_ASSETS[0]);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('1h');
  const [rawMarketData, setRawMarketData] = useState<CandleData[]>([]); // Holds the Chart Candles
  const [activeIndicators, setActiveIndicators] = useState<Set<Indicator>>(new Set([]));
  
  // AI & Analytics State
  const [aiReport, setAiReport] = useState<AIAnalysisReport | null>(null);
  const [tradeSetup, setTradeSetup] = useState<TradeSetup | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); 
  const [userApiKey, setUserApiKey] = useState(''); // Gemini API Key handling

  // UI / UX State
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false); // Prevents "No Data" flash
  
  // Debug / Integrity State
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number>(0);
  const [ticksInBucket, setTicksInBucket] = useState(0);
  const [candleBuildStats, setCandleBuildStats] = useState({ success: 0, fail: 0 });
  
  // Refs for performance-critical data accessing inside closures/intervals
  const previousClosesRef = useRef<Record<string, number>>({});
  const chartRef = useRef<ChartHandle>(null);
  const nextCandleExpectedTime = useRef<number>(0); // Helps determine if a new candle is needed
  const selectedAssetRef = useRef(selectedAsset); // Keeps track of current asset inside async callbacks
  const isHistoryLoadingRef = useRef<boolean>(false); // Mutex to prevent data race conditions

  // Memoized Technical Analysis (Recalculates only when data changes)
  const processedData = useMemo(() => enrichDataWithIndicators(rawMarketData, activeIndicators, activeTimeframe), [rawMarketData, activeIndicators, activeTimeframe]);
  
  // --- FIX: RESTORED ACTIVE ASSET DEFINITION ---
  // This grabs the latest version of the selected asset from the live watchlist array
  const activeAsset = assets.find(a => a.symbol === selectedAsset.symbol) || selectedAsset;

  useEffect(() => { selectedAssetRef.current = selectedAsset; }, [selectedAsset]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
  }, [assets]);

  useEffect(() => {
    if (rawMarketData.length > 0 && isChartLoading) {
        setIsChartLoading(false);
    }
  }, [rawMarketData, isChartLoading]);

  // ---------------------------------------------------------------------------
  // BLOCK 2: ASSET MANAGEMENT HANDLERS
  // ---------------------------------------------------------------------------
  
  const handleAssetChange = (newAsset: Asset) => {
      if (newAsset.symbol === selectedAsset.symbol) return;
      
      // Reset Chart State immediately to show "Loading"
      setIsChartLoading(true);
      setRawMarketData([]); 
      setAiReport(null);
      setTicksInBucket(0);
      setCandleBuildStats({ success: 0, fail: 0 });
      
      setSelectedAsset(newAsset);
      // Auto-close watchlist on mobile for better view
      if (window.innerWidth < 768) setWatchlistOpen(false);
  };

  const handleAddAsset = (symbol: string) => {
    const upperSymbol = symbol.toUpperCase();
    if (assets.some(a => a.symbol === upperSymbol)) return;
    
    const newAsset = createAssetFromSymbol(upperSymbol);
    setAssets(prev => [...prev, newAsset]);
    
    // Fetch initial quote immediately to populate price
    fetchAssetQuote(newAsset).then(quote => {
        if(quote) {
            setAssets(prev => prev.map(a => a.symbol === newAsset.symbol ? { 
              ...a, 
              price: quote.price, 
              change: quote.change, 
              previousClose: quote.previousClose 
            } : a));
            previousClosesRef.current[newAsset.symbol] = quote.previousClose;
        }
    });
    handleAssetChange(newAsset);
  };

  const handleRemoveAsset = (assetToRemove: Asset) => {
    const newAssets = assets.filter(a => a.symbol !== assetToRemove.symbol);
    setAssets(newAssets);
    if (selectedAsset.symbol === assetToRemove.symbol && newAssets.length > 0) {
      handleAssetChange(newAssets[0]);
    }
  };

  // Initial Price Fetch for entire watchlist on load
  useEffect(() => {
     const initPrices = async () => {
         const updated = await Promise.all(assets.map(async (a) => {
             const quote = await fetchAssetQuote(a);
             if (quote) {
                 previousClosesRef.current[a.symbol] = quote.previousClose;
                 return { ...a, price: quote.price, change: quote.change, previousClose: quote.previousClose };
             }
             return a;
         }));
         setAssets(updated);
     };
     initPrices();
  }, []);

  // ---------------------------------------------------------------------------
  // BLOCK 3: WATCHLIST LIVE UPDATES
  // ---------------------------------------------------------------------------
  const assetSymbolsHash = assets.map(a => a.symbol).join(',');
  const assetConfigs = useMemo(() => assets.map(a => ({ symbol: a.symbol, type: a.type })), [assetSymbolsHash]);

  useEffect(() => {
      // Subscribes to the global poller/socket for the background watchlist
      const unsubscribe = subscribeToWatchlist(assetConfigs, (updates) => {
          setAssets(prev => {
              const updateMap = new Map(updates.map(u => [u.symbol, u]));
              return prev.map(a => {
                  // Skip the selected asset (handled by the chart subscriber for lower latency)
                  if (a.symbol.toUpperCase() === selectedAssetRef.current.symbol.toUpperCase()) return a; 
                  const u = updateMap.get(a.symbol);
                  
                  if (u) {
                      const pc = (u as any).previousClose || previousClosesRef.current[a.symbol] || a.previousClose;
                      if ((u as any).previousClose) previousClosesRef.current[a.symbol] = (u as any).previousClose;
                      return { 
                          ...a, 
                          price: u.price, 
                          change: u.change, 
                          previousClose: pc,
                          // IMPORTANT: Store the RTH Price for the Watchlist 2nd Row
                          lastRthPrice: (u as any).lastRthPrice || a.lastRthPrice 
                      };
                  }
                  return a;
              });
          });
      });
      return () => unsubscribe();
  }, [assetConfigs]);

  // ---------------------------------------------------------------------------
  // BLOCK 4: CHART HISTORY & LOADING
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const loadHistory = async () => {
      // Trigger loading state if we switched assets
      if (!isChartLoading && rawMarketData.length > 0 && selectedAsset.symbol !== selectedAssetRef.current.symbol) {
          setIsChartLoading(true);
      }
      
      isHistoryLoadingRef.current = true;
      
      const data = await getMarketData(selectedAsset, activeTimeframe);
      if (mounted) {
        setRawMarketData(data);
        if (data.length > 0) {
          // Calculate when the next candle should theoretically start
          nextCandleExpectedTime.current = getIntervalBoundary(new Date(data[data.length-1].time).getTime(), activeTimeframe, selectedAsset.type);
          setLastDataTimestamp(Date.now()); 
          setCandleBuildStats({ success: data.length, fail: 0 });
          setIsChartLoading(false);
        } else {
          // Fallback timeout to remove spinner if API returns empty
          setTimeout(() => {
              if (mounted) setIsChartLoading(false);
          }, 3500);
        }
        isHistoryLoadingRef.current = false;
      }
    };
    loadHistory();
    return () => { mounted = false; };
  }, [selectedAsset.symbol, activeTimeframe]);

  // ---------------------------------------------------------------------------
  // BLOCK 5: REAL-TIME TICK PROCESSING (THE CRITICAL UPDATE)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = subscribeToAsset(selectedAsset, activeTimeframe, (realtimeData, eventTime) => {
      if (isHistoryLoadingRef.current || !realtimeData) return;
      
      setLastDataTimestamp(eventTime);
      const status = getMarketStatusInfo(selectedAsset.type);
      
      if (realtimeData.previousClose) {
          previousClosesRef.current[selectedAsset.symbol] = realtimeData.previousClose;
      }

     // App.tsx - Inside the subscribeToAsset useEffect

/// --- PHASE 1: UI UPDATES (ALWAYS LIVE) ---
      setAssets(prev => prev.map(a => {
        if (a.symbol === selectedAssetRef.current.symbol) {
          
          const newPrice = realtimeData.close; 
          
          // [DIAGNOSTIC FIX] -----------------------------------------------------
          // 1. Identify the Math Anchor:
          // The Service uses 'lastRthPrice' as the strict reference for Pre/Post market.
          // We must use the same value for local calculations to prevent drift.
          const mathAnchor = realtimeData.lastRthPrice || a.lastRthPrice || realtimeData.previousClose || a.previousClose;

          // 2. Identify the Visual Anchor (for chart line):
          const visualAnchor = realtimeData.previousClose || previousClosesRef.current[a.symbol] || a.previousClose;

          // 3. Calculate Change:
          // Priority A: Trust the Service provided change (if available).
          // Priority B: Local Recalculation using 'mathAnchor' (Last RTH Price).
          const newChange = (realtimeData.change !== undefined && realtimeData.change !== null)
              ? realtimeData.change 
              : (mathAnchor ? ((newPrice - mathAnchor) / mathAnchor) * 100 : a.change);
          // ----------------------------------------------------------------------

          return { 
            ...a, 
            price: newPrice, 
            change: newChange, 
            previousClose: visualAnchor,
            // Strictly persist lastRthPrice to ensure the next tick has the correct mathAnchor
            lastRthPrice: realtimeData.lastRthPrice || a.lastRthPrice 
          };
        }
  return a;
}));

     // 2. CHART CANDLE LOGIC (STRICT FREEZE)
      if (selectedAsset.type === AssetType.STOCK) {
          const tickTime = typeof realtimeData.time === 'number' ? realtimeData.time : new Date(realtimeData.time).getTime();
          
          // Strict Guard: If Market is Closed OR Timestamp is outside RTH -> RETURN IMMEDIATELY.
          // This prevents "Initial Seed" from running in Pre-Market.
          if (!status.isOpen || !isRthTime(tickTime)) {
              return; 
          }
      }

      setRawMarketData(prev => {
        if (prev.length === 0) {
            setCandleBuildStats(s => ({ ...s, success: s.success + 1 }));
            return [realtimeData];
        }

        const last = prev[prev.length - 1];
        const lastBucketTime = new Date(last.time).getTime();
        
        // Ensure we handle timestamp formats correctly (ms vs seconds)
        const incomingTime = typeof realtimeData.time === 'number' 
            ? realtimeData.time 
            : new Date(realtimeData.time).getTime();
        
        // Calculate which "Bucket" this tick belongs to (e.g. 10:00, 10:05)
        const tickBucketTime = getIntervalStart(incomingTime, activeTimeframe, selectedAsset.type);
        
        // Protect against bad data rewinding the chart
        if (tickBucketTime < lastBucketTime && selectedAsset.type === AssetType.STOCK) {
             return prev; 
        }

        // SCENARIO A: MERGE (Tick belongs to the current candle)
        if (tickBucketTime === lastBucketTime) {
          setTicksInBucket(t => t + 1); 
          setCandleBuildStats(s => ({ ...s, success: s.success + 1 }));
          
          const updated = [...prev];
          
          if (selectedAsset.type === AssetType.CRYPTO) {
              // Crypto streams usually send full OHLC
              updated[updated.length-1] = { 
                  ...last, 
                  close: realtimeData.close, 
                  high: realtimeData.high, 
                  low: realtimeData.low, 
                  volume: realtimeData.volume 
              };
          } else {
              // Stocks send Price Ticks -> We must calculate High/Low manually
              updated[updated.length-1] = { 
                  ...last, 
                  close: realtimeData.close, 
                  high: Math.max(last.high, realtimeData.close), 
                  low: Math.min(last.low, realtimeData.close), 
                  volume: last.volume // Accumulate volume if available
              };
          }
          return updated;
        } 
        
        // SCENARIO B: NEW CANDLE (Tick belongs to a new time bucket)
        if (tickBucketTime > lastBucketTime) { 
            setTicksInBucket(1); 
            setCandleBuildStats(s => ({ ...s, success: s.success + 1 })); 
            nextCandleExpectedTime.current = getIntervalBoundary(incomingTime, activeTimeframe, selectedAsset.type);
            
            const newCandle = {
                ...realtimeData,
                time: new Date(tickBucketTime).toISOString()
            };
            return [...prev, newCandle]; 
        }
        
        return prev;
      });
    });
    return () => unsubscribe();
  }, [selectedAsset.symbol, activeTimeframe]);

  // ---------------------------------------------------------------------------
  // BLOCK 6: UI HELPERS & RENDERING
  // ---------------------------------------------------------------------------
  
  const toggleIndicator = (ind: Indicator) => {
    setActiveIndicators(prev => {
      const n = new Set(prev);
      if (n.has(ind)) n.delete(ind); else n.add(ind);
      return n;
    });
  };

  const performAnalysis = useCallback(async () => {
    if (processedData.length === 0) return;
    setIsAnalyzing(true); if (!sidebarOpen) setSidebarOpen(true);
    // Passing userApiKey allows the service to use user's key if provided
    const analysis = await generateMarketAnalysis(selectedAsset, processedData.slice(-50), Array.from(activeIndicators), chartRef.current?.getSnapshot(), userApiKey);
    if (analysis) { setAiReport(analysis); if (analysis.setup) setTradeSetup(analysis.setup); }
    setIsAnalyzing(false);
  }, [selectedAsset, processedData, activeIndicators, sidebarOpen, userApiKey]);

  return (
    <div className="fixed inset-0 w-full h-full flex flex-col bg-slate-950 text-slate-300 font-sans overflow-hidden">
      {/* HEADER BAR */}
      <header className="h-10 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-3 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => setWatchlistOpen(!watchlistOpen)} className={`text-slate-500 hover:text-white transition-colors ${!watchlistOpen && 'opacity-50'}`}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg></button>
          <div className="flex items-center gap-2 select-none"><div className="w-4 h-4 bg-blue-600 rounded-sm"></div><span className="font-bold text-sm tracking-wide text-slate-200">SentiTraderAI</span></div>
          <button onClick={() => setDebugMode(!debugMode)} className={`p-1.5 ml-3 rounded transition-all ${debugMode ? 'bg-blue-900/30 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.34c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg></button>
        </div>
        
        {/* API Key & Analysis Button */}
        <div className="flex items-center gap-2">
            <div className="relative group">
                 <input 
                    type="password" 
                    placeholder="API KEY" 
                    value={userApiKey}
                    onChange={(e) => setUserApiKey(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-xs px-2 py-1 text-[10px] w-16 focus:w-32 transition-all outline-none text-slate-300 placeholder-slate-600 focus:border-blue-600 font-mono tracking-wide text-center"
                />
            </div>
            <button onClick={() => sidebarOpen ? setSidebarOpen(false) : performAnalysis()} className={`flex items-center gap-2 px-3 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all ${sidebarOpen ? 'bg-slate-800 text-slate-400' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}`}><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>{sidebarOpen ? 'Close Analyst' : 'AI ANALYTICS'}</button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className={`absolute md:static z-20 h-full transition-all duration-300 ease-in-out border-r border-slate-800 bg-slate-950 ${watchlistOpen ? 'translate-x-0 w-64' : '-translate-x-full w-0 md:translate-x-0 md:w-0 overflow-hidden'}`}><Watchlist assets={assets} selectedAsset={selectedAsset} onSelect={handleAssetChange} onRemove={handleRemoveAsset} onAdd={handleAddAsset} onReorder={setAssets} /></div>
        
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">
            <div className="border-b border-slate-800 bg-slate-900/50 shrink-0"><div className="flex flex-wrap items-center gap-y-2 gap-x-4 px-3 py-2 w-full"><TimeframeSelector activeTimeframe={activeTimeframe} onSelect={setActiveTimeframe} /><div className="h-4 w-px bg-slate-800 shrink-0 hidden sm:block"></div><IndicatorSelector activeIndicators={activeIndicators} toggleIndicator={toggleIndicator} /></div></div>
            <div className="flex-1 min-w-0 relative"><ChartContainer key={selectedAsset.symbol} ref={chartRef} data={processedData} indicators={activeIndicators} symbol={selectedAsset.symbol} activeTimeframe={activeTimeframe} percentageChange={activeAsset.change} currentPrice={activeAsset.price} previousClose={activeAsset.previousClose} debugMode={debugMode} setDebugMode={setDebugMode} lastUpdateTimestamp={lastDataTimestamp} assetType={selectedAsset.type} ticksInBucket={ticksInBucket} tradeSetup={tradeSetup} candleBuildStats={candleBuildStats} isLoading={isChartLoading} /></div>
        </div>
        
        <div className={`fixed inset-y-0 right-0 w-80 md:w-96 bg-slate-900 border-l border-slate-800 shadow-2xl z-30 md:relative md:flex md:flex-col transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:hidden'}`}><AIAnalyst initialAnalysis={aiReport} isGeneratingAnalysis={isAnalyzing} asset={selectedAsset} onGenerateAnalysis={performAnalysis} onClose={() => setSidebarOpen(false)} /></div>
      </div>
    </div>
  );
};

export default App;
