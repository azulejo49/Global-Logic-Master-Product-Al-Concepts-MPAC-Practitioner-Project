//watchlist.tsx/dev.team 21.01.2026(SentiTrader AI Beta 0.3
import React, { useState, useRef, useEffect } from 'react';
import { Asset, AssetType } from '../types';
import { getMarketStatusInfo } from '../utils/timeUtils';

interface WatchlistProps {
  assets: Asset[];
  selectedAsset: Asset;
  onSelect: (asset: Asset) => void;
  onRemove: (asset: Asset) => void;
  onAdd: (symbol: string) => void;
  onReorder: (assets: Asset[]) => void;
}

interface AssetRowProps {
  asset: Asset;
  selectedAsset: Asset;
  onSelect: (asset: Asset) => void;
  onRemove: (asset: Asset) => void;
  index: number;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  currentTick: number; // Force update on time change
}

const AssetRow: React.FC<AssetRowProps> = ({ 
  asset, selectedAsset, onSelect, onRemove, 
  index, onDragStart, onDragEnter, onDragEnd, isDragging, currentTick
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = selectedAsset.symbol === asset.symbol;
  const status = getMarketStatusInfo(asset.type);
  const isExtended = (status.label === 'PRE-MARKET' || status.label === 'AFTER-HOURS') && asset.type === AssetType.STOCK;

  // Beacon Logic: open/live-green, close-grey, extended hours(pre-mkt-yellow, post-mkt-blue)
  const renderBeacon = () => {
      if (status.label === 'AFTER-HOURS') {
          return (
              <div className="flex gap-0.5" title="After Hours">
                  <div className={`w-1.5 h-1.5 rounded-full ${status.beaconColor}`}></div>
              </div>
          );
      }
      return <div className={`w-1.5 h-1.5 rounded-full ${status.beaconColor}`} title={status.label}></div>;
  };

  // Calculate Absolute Change
  let absChange = 0;
  if (asset.previousClose && asset.previousClose > 0) {
      absChange = asset.price - asset.previousClose;
  } else if (asset.price > 0) {
      // Reverse engineer if prevClose missing: Price / (1 + change%) = PrevClose
      const prev = asset.price / (1 + (asset.change / 100));
      absChange = asset.price - prev;
  }

  const changeColor = asset.change >= 0 ? 'text-green-400' : 'text-red-400';
  const isPending = asset.price === 0;

  return (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={`group relative flex items-center border-b border-slate-900 transition-colors cursor-pointer select-none
        ${isSelected 
          ? 'bg-slate-800 border-l-[3px] border-l-blue-500' 
          : 'hover:bg-slate-900 border-l-[3px] border-l-transparent'
        }
        ${isExtended ? 'py-2' : 'py-0'} 
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(asset)}
    >
      <div className="flex-1 grid grid-cols-12 gap-1 p-2 items-center">
        {/* Symbol & Name */}
        <div className="col-span-4 flex flex-col justify-center pl-1 overflow-hidden">
          <span className={`font-bold text-xs font-mono truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>{asset.symbol}</span>
          <span className="text-[9px] text-slate-600 truncate">{asset.name}</span>
        </div>

        {/* Beacon - Adjusted to justify-start to move it left */}
        <div className="col-span-1 flex justify-start items-center -ml-3">
            {renderBeacon()}
        </div>
        
        {/* Data Columns (Merged for Layout Control) */}
        <div className="col-span-7 flex flex-col items-end gap-0.5">
            {/* Primary Row: Current / Ext Price */}
            <div className="flex items-center justify-end gap-3 w-full">
               {/* Price - Beta 0.3 BTC Spacing Fix */}
               <span className="font-mono text-[10px] text-slate-200 text-right w-[50px] pr-1">
                {!isPending
                 ? asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                       : <span className="text-slate-200 animate-pulse">----</span>
                           }
                    </span>

                {/* Change Values */}
                <div className="flex items-center justify-end gap-2 min-w-[70px]">
                    <span className={`font-mono text-[7px] w-[35px] text-right ${changeColor}`}>
                        {!isPending ? (absChange > 0 ? '+' : '') + absChange.toFixed(2) : '-'}
                    </span>
                    <span className={`font-mono text-[9px] font-bold w-[40px] text-right ${changeColor}`}>
                        {!isPending ? (asset.change > 0 ? '+' : '') + asset.change.toFixed(2) + '%' : '--%'}
                    </span>
                </div>
            </div>

            {/* Secondary Row: Last RTH (Close) distinguish from prev,close*/}
            {isExtended && !isPending && (
                <div className="flex items-center justify-end gap-3 w-full opacity-60">
                     <span className="text-[7px] text-slate-500 uppercase tracking-wide mr-auto pl-2">Closed</span>
                     
                     <span className="font-mono text-[10px] text-slate-400 text-right w-[60px]">
                        {asset.previousClose?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                     </span>
                     
                     {/* Spacer to align with change columns */}
                     <div className="min-w-[70px]"></div>
                </div>
            )}
        </div>
      </div>
      
      {/* Delete Action - Only visible on hover */}
      {isHovered && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onRemove(asset);
          }}
          className="absolute right-0 h-full w-6 bg-gradient-to-l from-slate-900 to-transparent flex items-center justify-center text-slate-500 hover:text-red-400"
        >
          <span className="font-bold text-xs">×</span>
        </button>
      )}
    </div>
  );
}

const Watchlist: React.FC<WatchlistProps> = ({ assets, selectedAsset, onSelect, onRemove, onAdd, onReorder }) => {
  const [newSymbol, setNewSymbol] = useState('');
  const [clock, setClock] = useState('');
  const [nowTick, setNowTick] = useState(Date.now()); // Master tick for children
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setNowTick(now.getTime()); // Update tick to force re-render of asset rows
      const isCrypto = selectedAsset.type === AssetType.CRYPTO;
      const timeZone = isCrypto ? 'UTC' : 'America/New_York';
      const label = isCrypto ? 'UTC' : 'NY';
      
      try {
        const timeStr = new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(now);
        setClock(`${timeStr} ${label}`);
      } catch (e) {
        setClock('--:--:--');
      }
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [selectedAsset.type]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSymbol.trim()) {
      onAdd(newSymbol.trim());
      setNewSymbol('');
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
      dragItem.current = index;
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (index: number) => {
      if (dragItem.current === null) return;
      dragOverItem.current = index;
      if (dragItem.current !== index) {
          const newAssets = [...assets];
          const draggedContent = newAssets[dragItem.current];
          newAssets.splice(dragItem.current, 1);
          newAssets.splice(index, 0, draggedContent);
          onReorder(newAssets);
          dragItem.current = index; 
      }
  };

  const handleDragEnd = () => {
      dragItem.current = null;
      dragOverItem.current = null;
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 border-r border-slate-800 w-64 shrink-0 overflow-hidden font-sans">
      <div className="p-3 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Market Watch</h2>
        <span className="text-[10px] font-mono font-bold text-blue-400">{clock}</span>
      </div>
      
      {/* Search/Add */}
      <div className="p-2 border-b border-slate-800 bg-slate-900/50">
        <form onSubmit={handleSubmit} className="relative">
          <input 
            type="text" 
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            placeholder="Add Symbol + Enter" 
            className="w-full bg-slate-950 border border-slate-800 rounded-sm px-2 py-1.5 text-xs text-slate-200 focus:border-blue-600 outline-none placeholder-slate-700 font-mono"
          />
          <span className="absolute right-2 top-1.5 text-[10px] text-slate-600">⏎</span>
        </form>
      </div>

      <div className="overflow-y-auto flex-1 custom-scrollbar">
          {assets.map((asset, index) => (
            <AssetRow 
                key={asset.symbol} 
                asset={asset} 
                index={index}
                selectedAsset={selectedAsset} 
                onSelect={onSelect} 
                onRemove={onRemove}
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragEnd={handleDragEnd}
                isDragging={false}
                currentTick={nowTick}
            />
          ))}

        {assets.length === 0 && (
           <div className="p-4 text-center text-xs text-slate-600 font-mono mt-4">
              // NO ASSETS WATCHED
           </div>
        )}
      </div>
    </div>
  );
};

export default Watchlist;