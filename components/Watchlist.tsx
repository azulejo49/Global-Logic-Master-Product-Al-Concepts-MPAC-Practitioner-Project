// components/Watchlist.tsx
// Revision: 03.02.2026 -STAIBeta/ dev.team
// Fix: Aligned "Closed" row to show Last RTH Price instead of % Anchor/ updated last rth close row

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
  currentTick: number; 
}

const AssetRow: React.FC<AssetRowProps> = ({ 
  asset, selectedAsset, onSelect, onRemove, 
  index, onDragStart, onDragEnter, onDragEnd 
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = selectedAsset.symbol === asset.symbol;
  const status = getMarketStatusInfo(asset.type);
  
  // Extended Hours: Show double row if Pre-Market or After-Hours
  const isExtended = (status.label === 'PRE-MARKET' || status.label === 'AFTER-HOURS' || status.label === 'CLOSED') && asset.type === AssetType.STOCK;

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

  // --- LIVE CHANGE (Primary Row) ---
  // asset.change comes pre-calculated from service (Live vs RTH Close)
  const isPending = asset.price === 0;
  // Live Anchor is used just for color logic if needed, but we rely on asset.change for %.
  // Approx Live Change Amount
  const liveAnchor = asset.lastRthPrice || asset.previousClose || 0;
  const liveChangeAmt = !isPending ? (asset.price - liveAnchor) : 0;
  const changeColor = asset.change >= 0 ? 'text-green-400' : 'text-red-400';

  // --- RTH CLOSE CHANGE (Secondary Row) ---03.02.26
  // Logic: RTH Close (343.69) - Prev Close (338.23) = +5.46
  const rthClose = asset.lastRthPrice || 0;
  const prevClose = asset.previousClose || 0;
  
  let rthChangeAmt = 0;
  let rthChangePct = 0;
  
  if (rthClose > 0 && prevClose > 0) {
      rthChangeAmt = rthClose - prevClose;
      rthChangePct = (rthChangeAmt / prevClose) * 100;
  }
  
  const rthColor = rthChangeAmt >= 0 ? 'text-green-400' : 'text-red-400';

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

        {/* Beacon */}
        <div className="col-span-1 flex justify-start items-center -ml-3">
            {renderBeacon()}
        </div>
        
        {/* Data Columns /03.02.26*/}
        <div className="col-span-7 flex flex-col items-end gap-0.5">
            {/* Primary Row: Current Price */}
            <div className="flex items-center justify-end gap-3 w-full">
               <span className="font-mono text-[10px] text-slate-200 text-right w-[50px] pr-1">
                {!isPending
                 ? asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                       : <span className="text-slate-200 animate-pulse">----</span>
                           }
                    </span>

                {/* Live Change (70px wide) */}
                <div className="flex items-center justify-end gap-2 min-w-[70px]">
                    <span className={`font-mono text-[7px] w-[35px] text-right ${changeColor}`}>
                        {!isPending ? (liveChangeAmt > 0 ? '+' : '') + liveChangeAmt.toFixed(2) : '-'}
                    </span>
                    <span className={`font-mono text-[9px] font-bold w-[40px] text-right ${changeColor}`}>
                        {!isPending ? (asset.change > 0 ? '+' : '') + asset.change.toFixed(2) + '%' : '--%'}
                    </span>
                </div>
            </div>

            {/* Secondary Row: RTH CLOSE STATS */}
            {isExtended && !isPending && rthClose > 0 && (
                <div className="flex items-center justify-end gap-3 w-full opacity-60">
                     <span className="text-[7px] text-slate-500 uppercase tracking-wide mr-auto pl-2">Closed</span>
                     
                     <span className="font-mono text-[10px] text-slate-400 text-right w-[50px]">
                        {rthClose.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                     </span>
                     
                     {/* RTH Change Stats (This div IS 70px wide, replacing the spacer) */}
                     <div className="flex items-center justify-end gap-2 min-w-[70px]">
                        <span className={`font-mono text-[7px] w-[35px] text-right ${rthColor}`}>
                            {(rthChangeAmt > 0 ? '+' : '') + rthChangeAmt.toFixed(2)}
                        </span>
                        <span className={`font-mono text-[9px] font-bold w-[40px] text-right ${rthColor}`}>
                            {(rthChangePct > 0 ? '+' : '') + rthChangePct.toFixed(2) + '%'}
                        </span>
                     </div>
                </div>
            )}
        </div>
      </div>
      {/* Delete Action */}
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
  const [nowTick, setNowTick] = useState(Date.now()); 
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setNowTick(now.getTime()); 
      const isCrypto = selectedAsset.type === AssetType.CRYPTO;
      const timeZone = isCrypto ? 'UTC' : 'America/New_York';
      const label = isCrypto ? 'UTC' : 'NY';
      
      try {
        const timeStr = new Intl.DateTimeFormat('en-US', {
          timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).format(now);
        setClock(`${timeStr} ${label}`);
      } catch (e) { setClock('--:--:--'); }
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [selectedAsset.type]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSymbol.trim()) { onAdd(newSymbol.trim()); setNewSymbol(''); }
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

  const handleDragEnd = () => { dragItem.current = null; dragOverItem.current = null; };

  return (
    <div className="h-full flex flex-col bg-slate-950 border-r border-slate-800 w-64 shrink-0 overflow-hidden font-sans">
      <div className="p-3 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Market Watch</h2>
        <span className="text-[10px] font-mono font-bold text-blue-400">{clock}</span>
      </div>
      
      <div className="p-2 border-b border-slate-800 bg-slate-900/50">
        <form onSubmit={handleSubmit} className="relative">
          <input 
            type="text" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)}
            placeholder="Add Symbol + Enter" 
            className="w-full bg-slate-950 border border-slate-800 rounded-sm px-2 py-1.5 text-xs text-slate-200 focus:border-blue-600 outline-none placeholder-slate-700 font-mono"
          />
          <span className="absolute right-2 top-1.5 text-[10px] text-slate-600">⏎</span>
        </form>
      </div>

      <div className="overflow-y-auto flex-1 custom-scrollbar">
          {assets.map((asset, index) => (
            <AssetRow 
                key={asset.symbol} asset={asset} index={index}
                selectedAsset={selectedAsset} onSelect={onSelect} onRemove={onRemove}
                onDragStart={handleDragStart} onDragEnter={handleDragEnter} onDragEnd={handleDragEnd}
                isDragging={false} currentTick={nowTick}
            />
          ))}
        {assets.length === 0 && <div className="p-4 text-center text-xs text-slate-600 font-mono mt-4">// NO ASSETS WATCHED</div>}
      </div>
    </div>
  );
};

export default Watchlist;
