// SentiTraderAIBeta//ChartContainer.tsx//HEAVY INDICATORS & ANALYSIS-row 430
// default- title: `${timerText} // //Revision 04.02.2026 - dev.team-SentiTraderAIBeta//fixed mid bucket stocks snap-candle fulfillment
import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, IChartApi, ISeriesApi, UTCTimestamp, IPriceLine, LineWidth, CandlestickSeries, HistogramSeries, LineSeries, BaselineSeries, SeriesMarker } from 'lightweight-charts';
import { CandleData, Indicator, Timeframe, AssetType, TradeSetup } from '../types';
import { getTechnicalMarkers, calculateTrendLines } from '../utils/technicalAnalysis';
import { getIntervalBoundary, getMarketStatusInfo, formatCountdown } from '../utils/timeUtils';

 //HELPER: Convert Timeframe string to seconds for strict bucketing //Revision 24.01.2026 
   const getSecondsInTimeframe = (tf: Timeframe): number => {
    const mapping: Record<string, number> = {
        '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800
    };
    return mapping[tf] || 3600;
   };  

    // Strict Timestamp Normalizer (Fixes Yahoo/Binance differences)
const normalizeTime = (time: string | number): UTCTimestamp => {
    let t = typeof time === 'string' ? new Date(time).getTime() : time;
    // Threshold: 2 Billion (Year 2033). If > 2B, it's milliseconds -> Convert to Seconds.
    if (t > 2000000000) t = Math.floor(t / 1000);
    return t as UTCTimestamp;
};

export interface ChartHandle {
    getSnapshot: () => string | null;
}      

interface ChartContainerProps {
    data: CandleData[];
    indicators: Set<Indicator>;
    symbol: string;
    activeTimeframe?: Timeframe;
    percentageChange?: number;
    currentPrice?: number;
    previousClose?: number;
    debugMode?: boolean;
    setDebugMode?: (val: boolean) => void;
    lastUpdateTimestamp?: number;
    assetType?: AssetType;
    ticksInBucket?: number;
    tradeSetup?: TradeSetup | null;
    candleBuildStats?: { success: number; fail: number };
    isLoading?: boolean;
}

    const ChartContainer = forwardRef<ChartHandle, ChartContainerProps>(({
    data, indicators, symbol, activeTimeframe = '1h' as Timeframe, percentageChange = 0, currentPrice, previousClose, debugMode = false, setDebugMode, lastUpdateTimestamp, assetType = AssetType.STOCK, ticksInBucket = 0, tradeSetup, candleBuildStats = { success: 0, fail: 0 }, isLoading = false
}, ref) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
    const upperTrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const lowerTrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

    const countdownPriceLineRef = useRef<IPriceLine | null>(null);
    const prevCloseLineRef = useRef<IPriceLine | null>(null);

    const prevDataLength = useRef<number>(0);
    const lastTickPriceRef = useRef<number>(0);

    const [legendCandle, setLegendCandle] = useState<CandleData | null>(null);
    const [timeLeftStr, setTimeLeftStr] = useState<string>('--:--');
    const [sessionEventCountdown, setSessionEventCountdown] = useState<string>('--:--');
    const [currentClock, setCurrentClock] = useState<string>('');
    const [currentDate, setCurrentDate] = useState<string>('');
    const [marketStatus, setMarketStatus] = useState(getMarketStatusInfo(assetType));

    // Debug Panel Drag State
    const [debugPos, setDebugPos] = useState({ x: 12, y: 56 });
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    const [debugStats, setDebugStats] = useState({
        updateMode: 'Init',
        count: 0,
        latencyMs: 0,
        lastTime: '--:--:--',
        date: '--/--/--',
        integrity: '100%',
        errors: [] as string[],
        bucketStart: '',
        isFlat: false,
        ticksThisBucket: 0,
        drift: 0,
        dataAge: 0,
        heartbeatColor: 'bg-green-500',
        integrityDisplay: 'STABLE'
    });

    // Drag Handlers
    useEffect(() => {
        const handleMove = (e: MouseEvent | TouchEvent) => {
            if (!isDraggingRef.current) return;
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
            setDebugPos({
                x: clientX - dragOffsetRef.current.x,
                y: clientY - dragOffsetRef.current.y
            });
        };
        const handleUp = () => { isDraggingRef.current = false; };

        if (debugMode) {
            window.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);
            window.addEventListener('touchmove', handleMove, { passive: false });
            window.addEventListener('touchend', handleUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleUp);
        };
    }, [debugMode]);

    const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
        isDraggingRef.current = true;
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        dragOffsetRef.current = {
            x: clientX - debugPos.x,
            y: clientY - debugPos.y
        };
    };

    const initChart = () => {
        if (!chartContainerRef.current) return;
        const chart = createChart(chartContainerRef.current, {
            layout: { 
                background: { type: ColorType.Solid, color: '#0b0e14' }, 
                textColor: '#64748b', 
                fontFamily: 'JetBrains Mono' 
            },
            grid: { 
                vertLines: { color: '#161d27' }, 
                horzLines: { color: '#161d27' } 
            },
            crosshair: { mode: CrosshairMode.Normal },
            timeScale: {
                borderColor: '#1e293b',
                timeVisible: true,
                rightOffset: 5,
                barSpacing: 10,
                minBarSpacing: 0.5,
                shiftVisibleRangeOnNewBar: true,
            },
            handleScroll: { vertTouchDrag: true, horzTouchDrag: true, pressedMouseMove: true, mouseWheel: true },
            handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
            width: chartContainerRef.current.getBoundingClientRect().width,
            height: chartContainerRef.current.getBoundingClientRect().height,
        });

        candlestickSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: '#00dc82', 
            downColor: '#ff4d4d', 
            borderVisible: false, 
            wickUpColor: '#00dc82', 
            wickDownColor: '#ff4d4d', 
            lastValueVisible: false
        });

        chart.priceScale('right').applyOptions({
            scaleMargins: { top: 0.15, bottom: 0.2 },
            autoScale: true
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, { 
            color: '#1e293b', 
            priceFormat: { type: 'volume' }, 
            priceScaleId: '' 
        });
        chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        // --- INDICATORS: Line Visible, Markers (Dots) Invisible, Dash Lines Invisible ---
const commonLineOptions = {
    lineWidth: 1 as LineWidth, // Explicitly cast to the LineWidth type
    priceLineVisible: false,
    crosshairMarkerVisible: false
};

// SMA
smaSeriesRef.current = chart.addSeries(LineSeries, { 
    ...commonLineOptions, 
    color: '#fbbf24', 
    title: 'SMA' 
});

// EMA
emaSeriesRef.current = chart.addSeries(LineSeries, { 
    ...commonLineOptions, 
    color: '#ea7220', 
    title: 'EMA' 
});

// VWAP
vwapSeriesRef.current = chart.addSeries(LineSeries, { 
    ...commonLineOptions, 
    color: '#3b82f6', 
    lineStyle: LineStyle.Dashed, 
    title: 'VWAP' 
});

// Trendlines (RES/SUP)
upperTrendSeriesRef.current = chart.addSeries(LineSeries, { 
    ...commonLineOptions, 
    lineWidth: 2 as LineWidth, // Explicitly cast here as well
    color: '#ff4d4d', 
    title: 'RES', 
    lastValueVisible: true 
});

lowerTrendSeriesRef.current = chart.addSeries(LineSeries, { 
    ...commonLineOptions, 
    lineWidth: 2 as LineWidth, 
    color: '#00dc82', 
    title: 'SUP', 
    lastValueVisible: true 
});
        rsiSeriesRef.current = chart.addSeries(BaselineSeries, { 
            priceScaleId: 'rsi', 
            baseValue: { type: 'price', price: 50 }, 
            lineWidth: 1, 
            title: 'RSI',
            crosshairMarkerVisible: false,
            priceLineVisible: false
        });

        chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.8, bottom: 0.05 }, visible: false });

        [80, 50, 20].forEach(level => {
            rsiSeriesRef.current?.createPriceLine({
                price: level, color: '#d1d4dc', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: ''
            });
        });

        chartRef.current = chart;
        chart.subscribeCrosshairMove(p => {
            if (p.time && candlestickSeriesRef.current) {
                const cd = p.seriesData.get(candlestickSeriesRef.current) as any;
                let vol = 0;
                if (volumeSeriesRef.current) {
                    const vd = p.seriesData.get(volumeSeriesRef.current) as any;
                    if (vd && vd.value) vol = vd.value;
                }
                if (cd && p.time) {
                    const timeStr = typeof p.time === 'number'
                        ? new Date(p.time * 1000).toISOString()
                        : String(p.time);
                    setLegendCandle({
                        time: timeStr, open: cd.open, high: cd.high, low: cd.low, close: cd.close, volume: vol
                    });
                }
            } else { setLegendCandle(null); }
        });
    };

    useEffect(() => {
        if (!candlestickSeriesRef.current) return;
        if (assetType === AssetType.CRYPTO) {
            if (prevCloseLineRef.current) { candlestickSeriesRef.current.removePriceLine(prevCloseLineRef.current); prevCloseLineRef.current = null; }
            return;
        }
        if (previousClose && previousClose > 0) {
            if (prevCloseLineRef.current) {
                prevCloseLineRef.current.applyOptions({ price: previousClose });
            }
            else {
                prevCloseLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: previousClose, color: '#94a3b8', lineWidth: 1 as LineWidth, lineStyle: LineStyle.SparseDotted,
                    axisLabelVisible: true, axisLabelColor: '#94a3b8', axisLabelTextColor: '#1e293b', title: ''
                });
            }
        } else if (prevCloseLineRef.current) {
            candlestickSeriesRef.current.removePriceLine(prevCloseLineRef.current); prevCloseLineRef.current = null;
        }
    }, [previousClose, assetType]);

    // =========================================================
    // TIMER EFFECT + REAL-TIME DRIFT WATCH
    // =========================================================
    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            const nowMs = now.getTime();
            const status = getMarketStatusInfo(assetType);
            setMarketStatus(status);
            
            // Bucket/Session Countdown
            let remaining = 0;
            if (assetType === AssetType.STOCK && !status.isSessionActive) { remaining = status.targetEvent - nowMs; }
            else { const boundary = getIntervalBoundary(nowMs, activeTimeframe, assetType); remaining = boundary - nowMs; }

            const timerText = formatCountdown(remaining);
            setTimeLeftStr(timerText);
            setSessionEventCountdown(formatCountdown(status.targetEvent - nowMs));
            setCurrentClock(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`);
            setCurrentDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

            // [FIX] REAL-TIME DRIFT ANIMATION
            // This ensures the ms/s counter increments even if price is static
            if (debugMode && lastUpdateTimestamp) {
                const driftMs = Math.max(0, nowMs - lastUpdateTimestamp);
                
                let hbColor = 'bg-green-500';
                if (driftMs > 2000) hbColor = 'bg-yellow-500';
                if (driftMs > 10000) hbColor = 'bg-red-500';

                setDebugStats(prev => ({
                    ...prev,
                    drift: driftMs,
                    latencyMs: driftMs, 
                    heartbeatColor: hbColor,
                    integrityDisplay: (driftMs > 5000 && assetType === AssetType.STOCK && status.isSessionActive)
                        ? 'GAP DETECTED (>5s)' 
                        : prev.integrityDisplay
                }));
            }

            // Price Line Logic
            if (candlestickSeriesRef.current && (data.length > 0 || currentPrice)) {
                const lastCandle = data[data.length - 1];
                const price = currentPrice || (lastCandle ? lastCandle.close : 0);
                const refPrice = lastCandle ? lastCandle.open : price;
                const isUp = price >= refPrice;
                const lineColor = isUp ? '#00dc82' : '#ff4d4d';
                const lineOptions = { price: price, color: lineColor, lineWidth: 1 as LineWidth, lineStyle: LineStyle.Solid, axisLabelVisible: true, axisLabelColor: lineColor, axisLabelTextColor: '#141111', title: timerText };

                if (countdownPriceLineRef.current) { countdownPriceLineRef.current.applyOptions(lineOptions); }
                else { countdownPriceLineRef.current = candlestickSeriesRef.current.createPriceLine(lineOptions); }
            }
        }, 1000); // 1-Second Loop
        return () => clearInterval(timer);
    }, [activeTimeframe, symbol, currentPrice, previousClose, data, assetType, timeLeftStr, debugMode, lastUpdateTimestamp]);

    useEffect(() => {
        initChart();
        const resizeObserver = new ResizeObserver((entries) => {
            window.requestAnimationFrame(() => {
                if (chartContainerRef.current && chartRef.current) {
                    const rect = chartContainerRef.current.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) chartRef.current.applyOptions({ width: rect.width, height: rect.height });
                }
            });
        });
        if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
        return () => { resizeObserver.disconnect(); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
    }, []);

    const handleUpdate = (tick: CandleData, sourceTimestamp: number) => {
        if (!candlestickSeriesRef.current) return;
        // Keep this for immediate updates on tick arrival
        const tickTimeMs = typeof tick.time === 'string' ? new Date(tick.time).getTime() : (tick.time > 2000000000 ? tick.time : tick.time * 1000);
        const now = Date.now();
        const drift = Math.max(0, now - sourceTimestamp);
        
        // ... (Px Gap Logic preserved)
        const lastPrice = lastTickPriceRef.current || tick.close;
        let pxGap = 0;
        if (candlestickSeriesRef.current) {
             const currentCoord = candlestickSeriesRef.current.priceToCoordinate(tick.close);
             const lastCoord = candlestickSeriesRef.current.priceToCoordinate(lastPrice);
             if (currentCoord !== null && lastCoord !== null) pxGap = Math.abs(currentCoord - lastCoord);
        }

        let integrityDisplay = `STABLE`;
        if (assetType === AssetType.STOCK && getMarketStatusInfo(AssetType.STOCK).isSessionActive) {
             if (drift > 5000) integrityDisplay = `GAP DETECTED (>5s)`;
             else if (pxGap > 0.2) integrityDisplay = `STABLE (${pxGap.toFixed(2)}px)`;
        }
        lastTickPriceRef.current = tick.close;
        if (assetType === AssetType.STOCK && !getMarketStatusInfo(AssetType.STOCK).isOpen) integrityDisplay = "STATIC (CLOSED)";

        let displayIngestMode = 'Live Stream';
        if (assetType === AssetType.STOCK) {
            const status = getMarketStatusInfo(AssetType.STOCK);
            if (!status.isOpen) displayIngestMode = 'MARKET CLOSED';
            else if (status.label === 'PRE-MARKET') displayIngestMode = 'PRE-MARKET';
            else if (status.label === 'AFTER-HOURS') displayIngestMode = 'POST-MARKET';
        }
        
        const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: assetType === AssetType.STOCK ? 'America/New_York' : undefined });
        
        // Only update static fields here, let timer handle drift animation
        setDebugStats(prev => ({
            ...prev,
            updateMode: displayIngestMode,
            lastTime: timeFormatter.format(new Date(sourceTimestamp)),
            bucketStart: timeFormatter.format(new Date(tickTimeMs)),
            isFlat: tick.high === tick.low,
            ticksThisBucket: ticksInBucket,
            integrityDisplay: integrityDisplay
        }));
    };
   // ====================================================================
    // EFFECT 1: HEAVY INDICATORS & ANALYSIS (Runs ONLY on Candle Close/Data Length Change)
    // ====================================================================
    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || data.length === 0) return;

        // 1. RE-AGGREGATE FOR INDICATORS (Matches strict bucketing)
        const bucketSize = getSecondsInTimeframe(activeTimeframe);
        const bucketMap = new Map<number, CandleData>();
        
        data.forEach(d => {
            const rawTime = typeof d.time === 'number' ? (d.time > 10000000000 ? d.time/1000 : d.time) : new Date(d.time).getTime()/1000;
            const bucketTime = Math.floor(rawTime / bucketSize) * bucketSize;

            if (bucketMap.has(bucketTime)) {
                const existing = bucketMap.get(bucketTime)!;
                bucketMap.set(bucketTime, {
                    ...existing, ...d,
                    open: existing.open, high: Math.max(existing.high, d.high), low: Math.min(existing.low, d.low),
                    close: d.close, volume: existing.volume + d.volume, time: bucketTime as any 
                });
            } else { bucketMap.set(bucketTime, { ...d, time: bucketTime as any }); }
        });

        const aggregatedData = Array.from(bucketMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
        const chartData = aggregatedData.map(d => ({ ...d, time: d.time as UTCTimestamp }));

        // 2. RENDER LINE INDICATORS
        const setLine = (ref: React.RefObject<ISeriesApi<any> | null>, key: string, enabled: boolean) => {
            if (!ref.current) return;
            const lineData = enabled ? chartData.filter(d => (d as any)[key] !== undefined && (d as any)[key] !== null).map(d => ({ time: d.time, value: (d as any)[key] })) : [];
            ref.current.setData(lineData);
        };

        setLine(smaSeriesRef as any, 'sma20', indicators.has('SMA'));
        setLine(emaSeriesRef as any, 'ema50', indicators.has('EMA'));
        setLine(vwapSeriesRef as any, 'vwap', indicators.has('VWAP'));
        setLine(rsiSeriesRef as any, 'rsi', indicators.has('RSI'));

        // 3. RENDER TRENDLINES
        if (indicators.has('Trendlines')) {
            const { upper, lower } = calculateTrendLines(aggregatedData as any);
            upperTrendSeriesRef.current?.setData(upper.map(u => ({ ...u, time: u.time as UTCTimestamp })));
            lowerTrendSeriesRef.current?.setData(lower.map(l => ({ ...l, time: l.time as UTCTimestamp })));
        } else {
            upperTrendSeriesRef.current?.setData([]);
            lowerTrendSeriesRef.current?.setData([]);
        }

        // 4. RENDER MARKERS (FIXED CRASH)
        try {
            const { priceMarkers, rsiMarkers } = getTechnicalMarkers(aggregatedData as any, indicators);
            const sanitizeMarkers = (raw: any[]) => raw.map(m => ({
                time: normalizeTime(m.time), position: m.position, shape: m.shape, color: m.color, text: m.text, size: m.size || 1
            })).sort((a, b) => (a.time as number) - (b.time as number)) as SeriesMarker<UTCTimestamp>[];

            // [FIX] Explicit check for function existence before calling
            // This prevents the "not a function" error if the ref is stale or type is mismatched
            const mainSeries = candlestickSeriesRef.current as any;
            if (mainSeries && typeof mainSeries.setMarkers === 'function') {
                 mainSeries.setMarkers(sanitizeMarkers(priceMarkers));
            }

            const rsiSeries = rsiSeriesRef.current as any;
            if (indicators.has('RSI') && rsiSeries && typeof rsiSeries.setMarkers === 'function') { 
                rsiSeries.setMarkers(sanitizeMarkers(rsiMarkers)); 
            }
        } catch (e) { console.error("Marker Error:", e); }

        // Cleanup lines if length shrunk
        if (data.length !== prevDataLength.current) {
            if (countdownPriceLineRef.current) { candlestickSeriesRef.current.removePriceLine(countdownPriceLineRef.current); countdownPriceLineRef.current = null; }
            if (prevCloseLineRef.current) { candlestickSeriesRef.current.removePriceLine(prevCloseLineRef.current); prevCloseLineRef.current = null; }
        }
        prevDataLength.current = data.length;

    }, [data.length, indicators, activeTimeframe, symbol, assetType]); // <--- CRITICAL: Depends on LENGTH, not TICK

    // ====================================================================
    // EFFECT 2: LIVE CANDLES (Runs Every Tick - High Performance)
    // ====================================================================
    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || data.length === 0) return;

        // 1. FAST AGGREGATION (Duplicate logic needed for Live Context)
        const bucketSize = getSecondsInTimeframe(activeTimeframe);
        const bucketMap = new Map<number, CandleData>();
        data.forEach(d => {
            const rawTime = typeof d.time === 'number' ? (d.time > 10000000000 ? d.time/1000 : d.time) : new Date(d.time).getTime()/1000;
            const bucketTime = Math.floor(rawTime / bucketSize) * bucketSize;
            if (bucketMap.has(bucketTime)) {
                const existing = bucketMap.get(bucketTime)!;
                bucketMap.set(bucketTime, { ...existing, ...d, open: existing.open, high: Math.max(existing.high, d.high), low: Math.min(existing.low, d.low), close: d.close, volume: existing.volume + d.volume, time: bucketTime as any });
            } else { bucketMap.set(bucketTime, { ...d, time: bucketTime as any }); }
        });
        const aggregatedData = Array.from(bucketMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

        // 2. SNAP FULFILLMENT (LIVE PRICE UPDATE)
        if (currentPrice && currentPrice > 0) {
            const lastIdx = aggregatedData.length - 1;
            const lastCandle = aggregatedData[lastIdx];
            let modifiedCandle = lastCandle;
            
            if (assetType === AssetType.CRYPTO || marketStatus.isSessionActive) {
                modifiedCandle = { ...lastCandle, close: currentPrice, high: Math.max(lastCandle.high, currentPrice), low: Math.min(lastCandle.low, currentPrice) };
                aggregatedData[lastIdx] = modifiedCandle;
            } else {
                modifiedCandle = { ...lastCandle, close: currentPrice };
            }
            if (typeof handleUpdate === 'function') { handleUpdate(modifiedCandle, lastUpdateTimestamp || Date.now()); }
        }

        // 3. RENDER CHART (Candles + Volume Only)
        const chartData = aggregatedData.map(d => ({ ...d, time: d.time as UTCTimestamp }));
        candlestickSeriesRef.current.setData(chartData);
        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.setData(chartData.map(d => ({ time: d.time, value: d.volume || 0, color: d.close >= d.open ? 'rgba(0,220,130,0.1)' : 'rgba(255,77,77,0.1)' })));
        }

    }, [data, currentPrice, activeTimeframe, symbol, assetType]); // <--- Runs on TICK

    useImperativeHandle(ref, () => ({ getSnapshot: () => chartRef.current?.takeScreenshot().toDataURL('image/png') || null }));

    // --- SYNCED LEGEND LOGIC (BETA) ---
    const hCandle = legendCandle || data[data.length - 1];
    const isLiveView = marketStatus.isSessionActive || (currentPrice !== undefined && (marketStatus.label === 'AFTER-HOURS' || marketStatus.label === 'PRE-MARKET'));
    const isCurrentBar = !legendCandle || (data.length > 0 && new Date(legendCandle.time).getTime() === new Date(data[data.length - 1].time).getTime());

    const displayClose = (isLiveView && isCurrentBar && currentPrice) ? currentPrice : (hCandle?.close || 0);
    const displayHigh = (isLiveView && isCurrentBar && currentPrice) ? Math.max(hCandle?.high || 0, currentPrice) : (hCandle?.high || 0);
    const displayLow = (isLiveView && isCurrentBar && currentPrice) ? Math.min(hCandle?.low || 0, currentPrice) : (hCandle?.low || 0);

    // Sync Legend Color with Price Line (Anchor: Candle Open)
    const referenceForColor = hCandle?.open || 0;
    const pColor = displayClose >= referenceForColor ? 'text-green-400' : 'text-red-400';

    return (
        <div className="w-full h-full flex flex-col relative bg-slate-950 border border-slate-800 min-h-0 overflow-hidden pb-2">
            {isLoading && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
                    <div className="relative w-12 h-12 mb-4">
                        <div className="absolute inset-0 border-t border-b border-blue-500/20 rounded-full animate-spin"></div>
                        <div className="absolute inset-2 border-t border-b border-blue-400/50 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                        </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-slate-200 tracking-widest uppercase">Initializing Chart</span>
                        <span className="text-[9px] text-slate-500 font-mono">Syncing Data Feeds...</span>
                    </div>
                </div>
            )}

            {hCandle && (
                <div className="absolute top-1 left-2 z-10 pointer-events-none font-mono text-[10px]">
                    <div className="flex items-center gap-2 text-slate-400 bg-slate-900/60 backdrop-blur-[1px] p-1 px-1.5 rounded border border-white/5 shadow-lg select-none">
                        <div className="flex flex-col gap-0">
                            <span className="text-[8px] text-white-300 uppercase tracking-tighter">{symbol}</span>
                            <span className="text-[10px] font-bold text-slate-200 leading-none">{activeTimeframe}</span>
                        </div>
                        <div className="w-px h-4 bg-white/10 mx-0.5"></div>
                        
                        <span className="text-[8px] text-slate-500">O</span><span className="text-slate-200">{hCandle.open.toFixed(2)}</span>
                        <span className="text-[8px] text-green-500">H</span><span className="text-slate-200">{displayHigh.toFixed(2)}</span>
                        <span className="text-[8px] text-red-500">L</span><span className="text-slate-200">{displayLow.toFixed(2)}</span>
                        
                        <span className="flex items-baseline text-[9px]">
                            <span className="text-blue-400">C</span>
                            <span className={`font-bold ml-0.5 ${pColor}`}>{displayClose.toFixed(2)}</span>
                            {previousClose && (
                                <span className={`text-[7px] ml-1 font-medium ${percentageChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ({percentageChange >= 0 ? '+' : ''}{percentageChange.toFixed(2)}%)
                                </span>
                            )}
                        </span>
                        {/* keep vol hide -more space in mobile view*/}
                       {/*  <span className="flex items-baseline gap-1 ml-1 pl-1 border-l border-white/10">
                             <span className="text-[8px] text-slate-500 lowercase">vol</span>
                             <span className="text-slate-300">{Math.round(hCandle.volume).toLocaleString()}</span>
                        </span>*/}

                        {isLiveView && isCurrentBar && <span className="text-[6px] text-blue-400 ml-1.6 uppercase font-bold tracking-wider animate-pulse">LIVE</span>}
                    </div>
                </div>
            )}

            <div className="flex-1 relative w-full min-h-0">
                <div ref={chartContainerRef} className="absolute inset-0 bottom-1" />
                {debugMode && (
                    <div
                        className="absolute top-14 left-3 bg-black/90 backdrop-blur-md border border-slate-700 p-1.5 rounded-sm shadow-2xl z-20 font-mono text-[9px] w-fit min-w-[150px] whitespace-nowrap select-none"
                        style={{ left: debugPos.x, top: debugPos.y }}
                    >
                        <div
                            className="flex justify-between items-center border-b border-slate-700 pb-1 mb-1 cursor-move"
                            onMouseDown={startDrag}
                            onTouchStart={startDrag}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 ${debugStats.heartbeatColor} animate-pulse`}></div>
                                <h4 className="text-blue-400 font-bold uppercase tracking-tighter">DEBUG ENGINE</h4>
                            </div>
                            <button onClick={() => setDebugMode?.(false)} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 border border-slate-600 rounded text-[8px] cursor-pointer hover:bg-slate-700 transition-colors pointer-events-auto" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>Close</button>
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0 text-slate-400 leading-tight">
                            <span>Session:</span> <span className={`text-right font-bold ${marketStatus.isOpen ? 'text-green-400' : 'text-orange-400'}`}>{marketStatus.label} {!marketStatus.isOpen && <span className="text-[8px] font-normal ml-1 text-slate-500">({sessionEventCountdown})</span>}</span>
                            <span>Data Source:</span> <span className="text-right text-blue-400 font-bold uppercase">{assetType === AssetType.CRYPTO ? 'Binance WS' : 'Yahoo HTTP'}</span>
                            <span>Ingest Mode:</span> <span className="text-right text-white uppercase">{debugStats.updateMode}</span>
                            <span>Pipeline Sync:</span> <span className="text-right text-green-400">{debugStats.lastTime}</span>
                            <span>Bucket Anchor:</span> <span className="text-right text-blue-300">{debugStats.bucketStart}</span>
                            <span>Current Bucket:</span> <span className="text-right text-blue-300">{timeLeftStr} (Rem)</span>
                            <span>Ticks Merged:</span> <span className="text-right text-white font-bold">{ticksInBucket}</span>
                            <span>Build Status:</span> <span className="text-right text-slate-100">S: {candleBuildStats.success} / F: {candleBuildStats.fail}</span>
                            <span>Candle Health:</span> <span className={`text-right font-bold ${debugStats.isFlat ? 'text-slate-500' : 'text-green-400'}`}>{debugStats.isFlat ? 'LOW VOLATILITY' : 'OPTIMAL'}</span>
                            <span>Market Watch Health:</span> <span className={`text-right font-bold ${debugStats.latencyMs < 1500 ? 'text-green-400' : 'text-yellow-400'}`}>{debugStats.latencyMs}ms</span> 
                            <span>Chart Health:</span> <span className="text-right text-slate-300">{marketStatus.isSessionActive ? 'Active Session' : 'Holding at Regular Close'}</span>
                            <span>Transport Latency:</span> <span className={`text-right ${assetType === AssetType.CRYPTO || marketStatus.isOpen ? 'text-green-400' : 'text-slate-500'}`}>{assetType === AssetType.CRYPTO || marketStatus.isOpen ? `${(debugStats.latencyMs / 1000).toFixed(2)}s` : 'STATIC (CLOSED)'}</span>
                            <span>Pipeline Drift:</span> <span className={`text-right ${debugStats.drift < 2000 ? 'text-green-400' : 'text-red-400'}`}>{assetType === AssetType.CRYPTO || marketStatus.isOpen ? `${(debugStats.drift / 1000).toFixed(3)}s` : 'STATIC (CLOSED)'}</span>
                            <span>Canvas Integrity:</span>
                            <span className={`text-right font-mono ${debugStats.integrityDisplay.includes('GAP') ? 'text-red-500 animate-pulse font-bold' : 'text-green-400'}`}>
                                {debugStats.integrityDisplay}
                            </span>
                            <span>Prev Close (ref):</span><span className="text-right font-bold text-slate-200">{previousClose ? previousClose.toFixed(2) : 'MISSING'}</span>
                        </div>
                        {data.length > 0 && (
                            <div className="border-t border-slate-800 pt-1 mt-1">
                                <div className="flex justify-between items-center mb-0.5"><span className="font-bold text-slate-500 uppercase tracking-wider text-[6px]">Live Candle Forensics</span><span className="text-[7px] text-blue-400">{assetType === AssetType.STOCK && ticksInBucket > 0 ? 'SOURCE: MERGED TICK' : 'SOURCE: RAW CANDLE'}</span></div>
                                <div className="grid grid-cols-5 gap-0.5 text-[8px] text-center bg-slate-900/50 p-0.5 rounded border border-white/5">
                                    <div className="flex flex-col"><span className="text-slate-600 text-[7px] uppercase">Open</span><span className="text-slate-300">{data[data.length - 1].open.toFixed(2)}</span></div>
                                    <div className="flex flex-col"><span className="text-slate-600 text-[7px] uppercase">High</span><span className="text-green-400 font-bold">{displayHigh.toFixed(2)}</span></div>
                                    <div className="flex flex-col"><span className="text-slate-600 text-[7px] uppercase">Low</span><span className="text-red-400 font-bold">{displayLow.toFixed(2)}</span></div>
                                    <div className="flex flex-col"><span className="text-slate-600 text-[7px] uppercase">Close</span><span className="text-blue-300 font-bold">{displayClose.toFixed(2)}</span></div>
                                    <div className="flex flex-col"><span className="text-slate-600 text-[7px] uppercase">Vol</span><span className="text-slate-400">{Math.round(data[data.length - 1].volume).toLocaleString()}</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

export default ChartContainer;
