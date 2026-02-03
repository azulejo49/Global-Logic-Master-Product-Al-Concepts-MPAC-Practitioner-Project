//types.ts// //Revision 03.02.2026 - dev.team-SentiTraderAIBeta
export enum AssetType {
  CRYPTO = 'CRYPTO',
  STOCK = 'STOCK',
  FOREX = 'FOREX'
}

export interface Asset {
  symbol: string;
  name: string;
  type: AssetType;
  price: number;
  change: number;
  previousClose?: number;
  lastRthPrice?: number; // <--- FIXED: Added missing property
}


export interface CandleData {
  time: string | number; // <--- CHANGE THIS LINE (add " | number")
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20?: number;
  ema50?: number;
  vwap?: number;
  rsi?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isThinking?: boolean;
}

export interface SentimentData {
  score: number; // 0 (Fear) to 100 (Greed)
  condition: 'Fear' | 'Neutral' | 'Greed' | 'Extreme Fear' | 'Extreme Greed';
  sourcesScanned: number; 
  socialVolume: 'Low' | 'Moderate' | 'High' | 'Viral';
  keywords: string[];
}

export interface TradeSetup {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  type: 'LONG' | 'SHORT' | 'NEUTRAL';
  riskReward?: number;
}

export interface AIAnalysisReport {
  sentiment: SentimentData;
  content: string; // Markdown Report
  chartImage?: string; // Base64 Snapshot
  setup?: TradeSetup; // Extracted trade setup
}

// Combined SMC includes FVG
export type Indicator = 'SMA' | 'EMA' | 'RSI' | 'VWAP' | 'SMC' | 'Trendlines' | 'Patterns';

export const AVAILABLE_INDICATORS: Indicator[] = ['SMA', 'EMA', 'RSI', 'VWAP', 'SMC', 'Trendlines', 'Patterns'];

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';
