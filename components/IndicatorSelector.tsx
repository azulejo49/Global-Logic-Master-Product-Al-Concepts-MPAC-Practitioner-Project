import React, { useState, useRef, useEffect } from 'react';
import { Indicator, AVAILABLE_INDICATORS } from '../types';

interface IndicatorSelectorProps {
  activeIndicators: Set<Indicator>;
  toggleIndicator: (ind: Indicator) => void;
}

const IndicatorSelector: React.FC<IndicatorSelectorProps> = ({ activeIndicators, toggleIndicator }) => {
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

  const activeCount = activeIndicators.size;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all border ${isOpen || activeCount > 0 ? 'bg-blue-900/30 text-blue-400 border-blue-500/50' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'}`}
        title="Technical Indicators"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
        <span>Indicators {activeCount > 0 && `(${activeCount})`}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-slate-950 border border-slate-700 shadow-2xl rounded-sm z-50 p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
          {AVAILABLE_INDICATORS.map((ind) => {
            const isActive = activeIndicators.has(ind);
            return (
              <button
                key={ind}
                onClick={() => toggleIndicator(ind)}
                className={`
                  flex items-center justify-between px-2.5 py-2 text-[10px] font-mono font-medium rounded-sm w-full text-left transition-colors
                  ${isActive 
                    ? 'bg-blue-900/20 text-blue-400' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }
                `}
              >
                <span>{ind}</span>
                {isActive && (
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_5px_rgba(59,130,246,0.8)]"></div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IndicatorSelector;