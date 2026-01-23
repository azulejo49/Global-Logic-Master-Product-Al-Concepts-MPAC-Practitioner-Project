import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Asset, AIAnalysisReport, SentimentData, TradeSetup } from '../types';
import { chatWithAnalyst } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

interface AIAnalystProps {
  initialAnalysis: AIAnalysisReport | null;
  isGeneratingAnalysis: boolean;
  asset: Asset;
  onGenerateAnalysis: () => void;
  onClose: () => void;
  apiKey?: string;
}

const SentimentDashboard: React.FC<{ data: SentimentData, setup?: TradeSetup }> = ({ data, setup }) => {
    // Gradient logic for the score bar
    const getScoreColor = (score: number) => {
        if (score < 25) return 'text-red-500';
        if (score < 45) return 'text-orange-400';
        if (score < 55) return 'text-yellow-400';
        if (score < 75) return 'text-lime-400';
        return 'text-green-500';
    };

    const getBarColor = (score: number) => {
        if (score < 25) return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
        if (score < 45) return 'bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.5)]';
        if (score < 55) return 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]';
        if (score < 75) return 'bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.5)]';
        return 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]';
    };

    return (
        <div className="bg-slate-900/50 rounded-sm border border-slate-700 p-4 mb-4 font-mono">
            <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                     <div className="w-1.5 h-1.5 bg-blue-500 animate-pulse rounded-full"></div>
                     <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Sentiment Engine</h3>
                </div>
                <span className="text-[10px] text-slate-600">ID: {Math.random().toString(36).substr(2, 6).toUpperCase()}</span>
            </div>

            {/* Score Display */}
            <div className="flex flex-col mb-4">
                <div className="flex justify-between items-end mb-1">
                    <span className={`text-2xl font-black ${getScoreColor(data.score)}`}>{data.score}</span>
                    <span className={`text-xs font-bold uppercase tracking-wider ${getScoreColor(data.score)}`}>{data.condition}</span>
                </div>
                {/* Progress Bar Container */}
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                     {/* Background Grid Lines */}
                     <div className="absolute inset-0 flex justify-between px-1">
                         {[...Array(10)].map((_, i) => <div key={i} className="w-px h-full bg-slate-900/50"></div>)}
                     </div>
                     {/* Active Bar */}
                     <div 
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${getBarColor(data.score)}`} 
                        style={{ width: `${data.score}%` }}
                     ></div>
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 mt-1 font-sans">
                    <span>EXTREME FEAR</span>
                    <span>NEUTRAL</span>
                    <span>EXTREME GREED</span>
                </div>
            </div>

            {/* Data Grid */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                 <div className="bg-slate-950 border border-slate-800 p-2 rounded flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase mb-0.5">Global Sources</span>
                    <span className="text-xs text-blue-300">{data.sourcesScanned.toLocaleString()}</span>
                 </div>
                 <div className="bg-slate-950 border border-slate-800 p-2 rounded flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase mb-0.5">Social Vol</span>
                    <span className={`text-xs font-bold ${data.socialVolume === 'Viral' ? 'text-purple-400' : 'text-slate-300'}`}>
                        {data.socialVolume}
                    </span>
                 </div>
            </div>

            {setup && setup.riskReward && (
                 <div className="bg-blue-900/20 border border-blue-800/50 p-2 rounded mb-3 flex items-center justify-between">
                    <span className="text-[9px] text-blue-400 uppercase font-bold">Trade Risk:Reward</span>
                    <span className="text-xs text-white font-bold">1 : {setup.riskReward.toFixed(2)}</span>
                 </div>
            )}
            
            {/* Keywords */}
            <div>
                <span className="text-[9px] text-slate-500 uppercase block mb-1">Dominant Topics</span>
                <div className="flex flex-wrap gap-1">
                    {data.keywords.map(k => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 border border-slate-700">
                            #{k}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};

const AIAnalyst: React.FC<AIAnalystProps> = ({ initialAnalysis, isGeneratingAnalysis, asset, onGenerateAnalysis, onClose, apiKey }) => {
  const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    const history = messages.map(m => ({ role: m.role, text: m.text }));
    const response = await chatWithAnalyst(history, userMsg.text, asset, apiKey);
    
    const modelMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'model',
      text: response,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, modelMsg]);
    setIsTyping(false);
  };

  const MarkdownComponents = {
    p: ({node, ...props}: any) => <p className="mb-3 text-slate-300 text-xs leading-5 font-sans" {...props} />,
    strong: ({node, ...props}: any) => <strong className="text-blue-100 font-bold" {...props} />,
    h1: ({node, ...props}: any) => <h1 className="text-sm font-bold text-white mb-2 mt-4 border-b border-slate-700 pb-1 uppercase tracking-tight font-mono" {...props} />,
    h2: ({node, ...props}: any) => <h2 className="text-xs font-bold text-blue-400 mb-2 mt-3 uppercase tracking-wide flex items-center gap-2 font-mono" {...props} >
        <span className="w-1 h-3 bg-blue-500 inline-block"></span>
        {props.children}
    </h2>,
    h3: ({node, ...props}: any) => <h3 className="text-xs font-bold text-slate-200 mb-1 mt-2 font-mono" {...props} />,
    ul: ({node, ...props}: any) => <ul className="list-none space-y-1 mb-3 text-slate-300 text-xs bg-slate-800/20 p-2 border border-slate-800/50" {...props} />,
    li: ({node, ...props}: any) => <li className="flex gap-2" {...props} ><span className="text-blue-500 select-none">›</span><span>{props.children}</span></li>,
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 shadow-xl overflow-hidden">
      {/* Header Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950 shrink-0">
        <button
          onClick={() => setActiveTab('report')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
            activeTab === 'report' ? 'text-blue-400 border-blue-500 bg-slate-900' : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-900/50'
          }`}
        >
          Analysis
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
            activeTab === 'chat' ? 'text-blue-400 border-blue-500 bg-slate-900' : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-900/50'
          }`}
        >
          Strategist
        </button>
        {/* Mobile Close Button */}
        <button 
           onClick={onClose}
           className="md:hidden px-3 bg-slate-950 border-l border-slate-800 text-slate-500 hover:text-red-400 transition-colors"
           title="Close Panel"
        >
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'report' ? (
          <div className="space-y-4">
            {isGeneratingAnalysis ? (
              <div className="flex flex-col items-center justify-center h-full pt-20 space-y-6 opacity-80">
                <div className="relative w-12 h-12">
                     <div className="absolute inset-0 border-2 border-slate-700 rounded-full"></div>
                     <div className="absolute inset-0 border-2 border-t-blue-500 rounded-full animate-spin"></div>
                </div>
                <div className="text-center font-mono">
                    <p className="text-blue-400 text-xs font-bold animate-pulse uppercase tracking-widest">Processing Data</p>
                    <div className="mt-2 space-y-1">
                        <p className="text-[10px] text-slate-500 flex items-center justify-center gap-2">
                            <span className="w-1 h-1 bg-green-500 rounded-full animate-ping"></span>
                            Fetching Market Depth
                        </p>
                        <p className="text-[10px] text-slate-500 flex items-center justify-center gap-2">
                             <span className="w-1 h-1 bg-green-500 rounded-full animate-ping" style={{animationDelay: '0.2s'}}></span>
                            Identifying Liquidity
                        </p>
                    </div>
                </div>
              </div>
            ) : initialAnalysis ? (
              <div className="animate-in fade-in duration-500">
                <SentimentDashboard data={initialAnalysis.sentiment} setup={initialAnalysis.setup} />
                
                {initialAnalysis.chartImage && (
                    <div className="mb-4 relative group border border-slate-700 bg-slate-950 p-1">
                        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 backdrop-blur text-[9px] text-white font-mono uppercase border border-white/10">
                            Sentitrader Analysis
                        </div>
                        <img 
                            src={initialAnalysis.chartImage} 
                            alt="Analyzed Chart" 
                            className="w-full opacity-90 hover:opacity-100 transition-opacity"
                        />
                    </div>
                )}

                <div className="prose prose-invert max-w-none">
                   {/* @ts-ignore */}
                  <ReactMarkdown components={MarkdownComponents}>{initialAnalysis.content}</ReactMarkdown>
                </div>
                
                <div className="mt-6 pt-4 border-t border-slate-800/50">
                    <p className="text-[9px] text-slate-600 text-justify font-mono">
                        <span className="font-bold text-slate-500">DISCLAIMER:</span> Institutional-grade analysis simulation. AI-generated insights for educational purposes only. Not financial advice.
                    </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full pt-20 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4 text-slate-600 ring-1 ring-slate-700 shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-8 h-8 opacity-50">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
                  </svg>
                </div>
                <h3 className="text-slate-300 font-bold text-sm mb-1">Awaiting Command</h3>
                <p className="text-slate-500 mb-6 text-xs max-w-[200px]">
                  Initialize Sentitrader Vision engine to scan <span className="font-mono text-blue-400">{asset.symbol}</span>
                </p>
                <button 
                  onClick={onGenerateAnalysis}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-sm shadow-[0_0_15px_rgba(37,99,235,0.2)] transition-all active:translate-y-0.5 flex items-center gap-2 group"
                >
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 group-hover:animate-spin">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
                   </svg>
                  GENERATE ANALYTICS
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1 space-y-3 mb-4 font-sans">
              {messages.length === 0 && (
                <div className="text-center mt-10 p-4 border border-dashed border-slate-800 rounded bg-slate-900/50">
                    <p className="text-slate-500 text-xs italic">
                    "Analyst connected. Ready for queries regarding {asset.symbol} market structure, key levels, or macro factors."
                    </p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] rounded-sm p-3 text-xs leading-relaxed border ${
                    msg.role === 'user' 
                      ? 'bg-blue-900/20 text-blue-100 border-blue-800' 
                      : 'bg-slate-800 text-slate-200 border-slate-700'
                  }`}>
                    {msg.role === 'model' ? (
                        /* @ts-ignore */
                       <ReactMarkdown components={MarkdownComponents}>{msg.text}</ReactMarkdown>
                    ) : msg.text}
                  </div>
                  <span className="text-[9px] text-slate-600 mt-1 uppercase font-mono">{msg.role === 'user' ? 'You' : 'Analyst'} • {msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              ))}
              {isTyping && (
                 <div className="flex justify-start">
                    <div className="bg-slate-800 rounded-sm p-2 flex space-x-1 border border-slate-700">
                      <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                 </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div className="mt-auto bg-slate-950 p-2 border border-slate-800 rounded-sm">
              <div className="relative flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Query Analyst..."
                  className="flex-1 bg-transparent text-xs text-slate-200 focus:outline-none font-mono placeholder-slate-700"
                />
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="text-blue-500 hover:text-blue-400 disabled:opacity-30 uppercase text-[10px] font-bold tracking-wider"
                >
                  SEND
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIAnalyst;