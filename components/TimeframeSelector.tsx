import React, { useState, useRef, useEffect } from 'react';
import { Timeframe } from '../types';

interface TimeframeSelectorProps {
  activeTimeframe: Timeframe;
  onSelect: (tf: Timeframe) => void;
}

const TIMEFRAMES: Timeframe[] = [
  '1m', '5m', '15m', '30m', '1h', '4h', 
  '1d', '1w', '1M', '3M', '6M', 'YTD', 
  '1Y', '5Y', 'All'
];

const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({ activeTimeframe, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-sm transition-all"
        title="Select Timeframe"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 text-slate-400">
           <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[10px] font-bold font-mono min-w-[20px]">{activeTimeframe}</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
           <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-slate-950 border border-slate-700 shadow-2xl rounded-sm z-50 p-1 grid grid-cols-3 gap-0.5 animate-in fade-in zoom-in-95 duration-100">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => {
                onSelect(tf);
                setIsOpen(false);
              }}
              className={`
                px-2 py-1.5 text-[10px] font-bold text-center rounded-sm transition-colors font-mono
                ${activeTimeframe === tf 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }
              `}
            >
              {tf}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TimeframeSelector;