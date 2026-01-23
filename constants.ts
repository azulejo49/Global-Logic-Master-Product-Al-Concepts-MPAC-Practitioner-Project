import { Asset, AssetType } from './types';

export const INITIAL_ASSETS: Asset[] = [
  // Default Crypto
  { symbol: 'BTC/USD', name: 'Bitcoin', type: AssetType.CRYPTO, price: 0, change: 0 },
  { symbol: 'ETH/USD', name: 'Ethereum', type: AssetType.CRYPTO, price: 0, change: 0 },
  
  // Default Stocks/ETFs
  { symbol: 'SPY', name: 'S&P 500 ETF', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'QQQ', name: 'Nasdaq 100', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'IWM', name: 'Russell 2000', type: AssetType.STOCK, price: 0, change: 0 },

  // Magnificent 7
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'AMZN', name: 'Amazon.com', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'AAPL', name: 'Apple Inc.', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'META', name: 'Meta Platforms', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: AssetType.STOCK, price: 0, change: 0 },

  // Mag 9 Additions
  { symbol: 'ORCL', name: 'Oracle Corp.', type: AssetType.STOCK, price: 0, change: 0 },
  { symbol: 'AVGO', name: 'Broadcom Inc.', type: AssetType.STOCK, price: 0, change: 0 },
];

// Helper to create a new asset object from a symbol string
export const createAssetFromSymbol = (symbol: string): Asset => {
  const upper = symbol.toUpperCase();
  const isCrypto = upper.includes('/') || upper.includes('USD');
  
  return {
    symbol: upper,
    name: upper, // simplified
    type: isCrypto ? AssetType.CRYPTO : AssetType.STOCK,
    price: 0, // Will be updated by data fetch
    change: 0
  };
};