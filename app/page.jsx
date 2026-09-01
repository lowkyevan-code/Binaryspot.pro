'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Spotpro App ID registered on Deriv Developer Portal
const OAUTH_APP_ID = '34hh45FQkPfMgbgj20uoR';
const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

export default function BinarySpotPro() {
  const [activeTab, setActiveTab] = useState('welcome');
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState(null);
  const [currency, setCurrency] = useState('USD');
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState('');

  // Market & Digit stats
  const [symbol, setSymbol] = useState('R_100');
  const [lastTick, setLastTick] = useState(null);
  const [prevTick, setPrevTick] = useState(null);
  const [lastDigit, setLastDigit] = useState(null);
  const [digitHistory, setDigitHistory] = useState([]);
  const [digitStats, setDigitStats] = useState(Array(10).fill(10));
  const [evenOddRatio, setEvenOddRatio] = useState({ even: 50, odd: 50 });

  // Bot strategy settings
  const [strategy, setStrategy] = useState('DIGITDIFF');
  const [baseStake, setBaseStake] = useState('1.00');
  const [currentStake, setCurrentStake] = useState('1.00');
  const [martingale, setMartingale] = useState('11.0');
  const [takeProfit, setTakeProfit] = useState('10.00');
  const [stopLoss, setStopLoss] = useState('30.00');
  const [duration, setDuration] = useState('1');
  const [predictionDigit, setPredictionDigit] = useState('0');
  const [presetName, setPresetName] = useState('Differs Safe');

  // Performance metrics
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [totalProfit, setTotalProfit] = useState(0);
  const [winCount, setWinCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [logs, setLogs] = useState([]);

  // Refs
  const wsRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const botRunningRef = useRef(false);
  const totalProfitRef = useRef(0);
  const currentStakeRef = useRef(1.0);
  const tokenRef = useRef('');

  useEffect(() => { botRunningRef.current = isBotRunning; }, [isBotRunning]);
  useEffect(() => { totalProfitRef.current = totalProfit; }, [totalProfit]);
  useEffect(() => { currentStakeRef.current = parseFloat(currentStake) || 1.0; }, [currentStake]);
  useEffect(() => { tokenRef.current = token.trim(); }, [token]);

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, msg, type }, ...prev.slice(0, 75)]);
  };

  // 1. Capture OAuth Token & Account ID upon return to Chrome
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token1 = params.get('token1');
      const acct1 = params.get('acct1');

      if (token1 && acct1) {
        setToken(token1);
        setAccountId(acct1);
        tokenRef.current = token1;
        try {
          localStorage.setItem('deriv_token', token1);
          localStorage.setItem('deriv_acct', acct1);
        } catch (e) {
          console.error(e);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const savedToken = localStorage.getItem('deriv_token');
        const savedAcct = localStorage.getItem('deriv_acct');
        if (savedToken && savedAcct) {
          setToken(savedToken);
          setAccountId(savedAcct);
          tokenRef.current = savedToken;
        }
      }
    }
  }, []);

  // 2. Persistent WebSocket Connection
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        addLog('Deriv Gateway Active.', 'system');

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ping: 1 }));
          }
        }, 25000);

        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));

        const activeToken = tokenRef.current || (typeof window !== 'undefined' ? localStorage.getItem('deriv_token') : '');
        if (activeToken) {
          ws.send(JSON.stringify({ authorize: activeToken }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.msg_type === 'authorize') {
            setIsAuthorizing(false);
            if (data.error) {
              setAuthError(data.error.message);
              addLog(`Auth Error: ${data.error.message}`, 'error');
              setIsAuthorized(false);
              localStorage.removeItem('deriv_token');
            } else {
              setAuthError('');
              setIsAuthorized(true);
              setAccountId(data.authorize.loginid);
              setIsAuthModalOpen(false);
              addLog(`Authenticated: ${data.authorize.loginid} (${data.authorize.currency || 'USD'})`, 'success');
              ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            }
          }

          if (data.msg_type === 'balance' && data.balance) {
            setBalance(data.balance.balance);
            setCurrency(data.balance.currency || 'USD');
          }

          if (data.msg_type === 'tick' && data.tick) {
            const quote = data.tick.quote;
            setLastTick((prev) => {
              setPrevTick(prev);
              return quote;
            });

            const strQuote = quote.toString();
            const digit = parseInt(strQuote.charAt(strQuote.length - 1), 10);
            if (!isNaN(digit)) {
              setLastDigit(digit);
              setDigitHistory((prev) => {
                const updated = [digit, ...prev.slice(0, 99)];
                const counts = Array(10).fill(0);
                let evenCount = 0;
                updated.forEach((d) => {
                  counts[d]++;
                  if (d % 2 === 0) evenCount++;
                });
                const total = updated.length || 1;
                setDigitStats(counts.map((c) => Math.round((c / total) * 100)));
                setEvenOddRatio({
                  even: Math.round((evenCount / total) * 100),
                  odd: Math.round(((total - evenCount) / total) * 100)
                });
                return updated;
              });
            }
          }

          if (data.msg_type === 'proposal') {
            if (data.error) {
              addLog(`Proposal Error: ${data.error.message}`, 'error');
              if (botRunningRef.current) stopBot('Broker proposal rejected');
            } else if (data.proposal) {
              ws.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price }));
            }
          }

          if (data.msg_type === 'buy') {
            if (data.error) {
              addLog(`Purchase Error: ${data.error.message}`, 'error');
              if (botRunningRef.current) stopBot('Purchase failed');
            } else {
              addLog(`Active Contract #${data.buy.contract_id} [Stake: $${currentStakeRef.current}]`, 'trade');
              ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: data.buy.contract_id, subscribe: 1 }));
            }
          }

          if (data.msg_type === 'proposal_open_contract') {
            const contract = data.proposal_open_contract;
            if (contract && contract.is_sold) {
              const profit = parseFloat(contract.profit);
              handleTradeResult(profit > 0, profit);
            }
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
        setIsAuthorizing(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsAuthorized(false);
        setIsAuthorizing(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        setTimeout(() => connectWebSocket(), 2000);
      };
    } catch (err) {
      console.error(err);
    }
  }, [symbol]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ forget_all: 'ticks' }));
      wsRef.current.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
  }, [symbol]);

  // Open the Deriv OAuth consent screen matching Tradekit's flow
  const handleOAuthLogin = () => {
    if (typeof window !== 'undefined') {
      const redirectUrl = 'https://binaryspot-pro.vercel.app/';
      window.location.href = `https://oauth.deriv.com/oauth2/authorize?app_id=${OAUTH_APP_ID}&l=EN&brand=deriv&redirect_url=${encodeURIComponent(redirectUrl)}&scope=read,trade,payments,admin`;
    }
  };

  const handleManualAuth = () => {
    const cleanToken = token.trim();
    if (!cleanToken) {
      setAuthError('Please paste your token.');
      return;
    }
    setAuthError('');
    setIsAuthorizing(true);
    localStorage.setItem('deriv_token', cleanToken);

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket();
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ authorize: cleanToken }));
        } else {
          setIsAuthorizing(false);
          setAuthError('Connecting gateway. Please tap authorize again in 2 seconds.');
        }
      }, 1000);
      return;
    }

    wsRef.current.send(JSON.stringify({ authorize: cleanToken }));
  };

  const applyPreset = (name, strat, stake, mlt, dur, pred, tp, sl) => {
    setPresetName(name);
    setStrategy(strat);
    setBaseStake(stake);
    setCurrentStake(stake);
    setMartingale(mlt);
    setDuration(dur);
    setPredictionDigit(pred);
    setTakeProfit(tp);
    setStopLoss(sl);
    setActiveTab('bots');
  };

  const handleTradeResult = (isWin, profit) => {
    const newNet = Number((totalProfitRef.current + profit).toFixed(2));
    setTotalProfit(newNet);

    if (isWin) {
      setWinCount((w) => w + 1);
      addLog(`WIN: +$${profit.toFixed(2)} | Net: ${newNet >= 0 ? '+' : ''}$${newNet.toFixed(2)}`, 'success');
      const base = parseFloat(baseStake) || 1.0;
      setCurrentStake(base.toFixed(2));
    } else {
      setLossCount((l) => l + 1);
      addLog(`LOSS: -$${Math.abs(profit).toFixed(2)} | Net: ${newNet >= 0 ? '+' : ''}$${newNet.toFixed(2)}`, 'error');
      const m = parseFloat(martingale) || 1.0;
      const nextStake = (currentStakeRef.current * m).toFixed(2);
      setCurrentStake(nextStake);
    }

    const tp = parseFloat(takeProfit);
    const sl = parseFloat(stopLoss);

    if (newNet >= tp) { stopBot(`Target Take-Profit (+$${newNet.toFixed(2)}) reached!`); return; }
    if (newNet <= -sl) { stopBot(`Stop-Loss (-$${Math.abs(newNet).toFixed(2)}) reached!`); return; }

    if (botRunningRef.current) {
      setTimeout(() => { if (botRunningRef.current) executeContract(strategy); }, 750);
    }
  };

  const executeContract = (chosenStrategy = strategy, customDuration = duration) => {
    if (!wsRef.current || !isAuthorized) { setIsAuthModalOpen(true); return; }
    const payload = {
      proposal: 1,
      amount: parseFloat(currentStakeRef.current),
      basis: 'stake',
      currency: currency,
      symbol: symbol,
      contract_type: chosenStrategy,
      duration: parseInt(customDuration, 10),
      duration_unit: 't'
    };
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(chosenStrategy)) {
      payload.barrier = predictionDigit.toString();
    }
    addLog(`Sending ${chosenStrategy} order ($${currentStakeRef.current})...`, 'trade');
    wsRef.current.send(JSON.stringify(payload));
  };

  const startBot = () => {
    if (!isAuthorized) { setIsAuthModalOpen(true); return; }
    setIsBotRunning(true);
    setCurrentStake(baseStake);
    addLog(`Bot started with strategy: ${strategy}`, 'system');
    setTimeout(() => { executeContract(strategy); }, 300);
  };

  const stopBot = (reason = 'Manual stop') => {
    setIsBotRunning(false);
    addLog(`Bot halted: ${reason}`, 'system');
  };

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Live Status Bar */}
      <div className="bg-[#0e131d] border-b border-slate-800/80 px-4 py-2.5 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="font-semibold text-slate-300">{isConnected ? 'Deriv Financial Gateway Active' : 'Connecting Gateway...'}</span>
          </div>
          <span className="hidden md:inline text-slate-700">|</span>
          <div className="hidden md:flex items-center gap-2">
            <span>Asset:</span>
            <span className="font-mono font-bold text-amber-400">{symbol}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Live Quote:</span>
            <span className={`font-bold ${lastTick && prevTick && lastTick >= prevTick ? 'text-emerald-400' : 'text-rose-400'}`}>
              {lastTick !== null ? lastTick : 'Streaming...'}
            </span>
          </div>
          <span className="text-slate-700">|</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Last Digit:</span>
            <span className="bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-cyan-400 font-bold">
              {lastDigit !== null ? lastDigit : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="border-b border-slate-800 bg-[#0d121c]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('welcome')}>
              <div className="h-10 w-10 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-xl flex items-center justify-center font-black text-black text-xl shadow-lg">
                BS
              </div>
              <div>
                <span className="text-lg font-black tracking-tight text-white">
                  BINARY<span className="text-emerald-400">SPOT</span> PRO
                </span>
                <span className="hidden sm:block text-[9px] uppercase font-bold tracking-widest text-emerald-500 -mt-1">
                  Algorithmic Hub
                </span>
              </div>
            </div>

            <nav className="hidden lg:flex items-center gap-1 bg-[#121824] p-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('welcome')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'welcome' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
              >
                🏠 Overview
              </button>
              <button
                onClick={() => setActiveTab('bots')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'bots' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
              >
                🤖 Bot Studio
              </button>
              <button
                onClick={() => setActiveTab('analyzer')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'analyzer' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
              >
                📊 Digit Analyzer
              </button>
              <button
                onClick={() => setActiveTab('manual')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'manual' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
              >
                ⚡ Manual Terminal
              </button>
              <button
                onClick={() => setActiveTab('community')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'community' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
              >
                💎 VIP Club
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {isAuthorized ? (
              <div className="flex items-center gap-3 bg-[#131926] border border-slate-700/80 px-3.5 py-1.5 rounded-xl shadow-inner">
                <div className="text-right">
                  <p className="text-[10px] font-mono text-slate-400 uppercase">{accountId}</p>
                  <p className="text-sm font-black text-emerald-400 font-mono">
                    {balance !== null ? `$${parseFloat(balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '...'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsAuthorized(false);
                    setToken('');
                    setAccountId('');
                    setBalance(null);
                    localStorage.removeItem('deriv_token');
                    localStorage.removeItem('deriv_acct');
                  }}
                  className="text-xs text-slate-500 hover:text-rose-400 ml-1"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAuthError(''); setIsAuthModalOpen(true); }}
                className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition transform active:scale-95"
              >
                Connect Deriv
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Sticky Tab Bar */}
      <div className="lg:hidden flex border-b border-slate-800 bg-[#0d121c] px-2 py-2 gap-1 overflow-x-auto">
        {[
          { id: 'welcome', label: '🏠 Overview' },
          { id: 'bots', label: '🤖 Bots' },
          { id: 'analyzer', label: '📊 Analyzer' },
          { id: 'manual', label: '⚡ Manual' },
          { id: 'community', label: '💎 VIP' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 text-[11px] font-bold rounded-lg whitespace-nowrap transition ${
              activeTab === tab.id ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 bg-slate-900/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main App Canvas */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {activeTab === 'welcome' && (
          <div className="space-y-8">
            <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-[#121824] via-[#0d121c] to-[#080b11] p-8 md:p-12 shadow-2xl">
              <div className="relative z-10 max-w-2xl space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Deriv High-Frequency Bot Network
                </div>
                <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
                  Automate Your Edge on Volatility Indices.
                </h1>
                <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                  Engineered for algorithmic digit diffing, parity runs, and trend scalping with real-time risk mitigation and zero latency execution.
                </p>
                <div className="pt-2 flex flex-wrap gap-4">
                  <button
                    onClick={() => setActiveTab('bots')}
                    className="px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-xl transition transform active:scale-95"
                  >
                    Open Bot Studio ▶
                  </button>
                  <button
                    onClick={() => setActiveTab('analyzer')}
                    className="px-6 py-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-slate-700 transition"
                  >
                    Live Digit Analyzer 📊
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl bg-[#0f1522] border border-slate-800 space-y-3">
                <div className="h-10 w-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400 text-xl font-bold">🤖</div>
                <h3 className="text-base font-bold text-white">Algorithmic Bot Studio</h3>
                <p className="text-xs text-slate-400 leading-relaxed">Pre-configured strategies including Differs Sentinel, Even/Odd Hunter, and Trend Momentum with auto-Martingale recovery.</p>
              </div>
              <div className="p-6 rounded-2xl bg-[#0f1522] border border-slate-800 space-y-3">
                <div className="h-10 w-10 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400 text-xl font-bold">📊</div>
                <h3 className="text-base font-bold text-white">100-Tick Mathematical Analyzer</h3>
                <p className="text-xs text-slate-400 leading-relaxed">Live statistical frequency maps calculating hot/cold digits, parity streaks, and barrier probability distributions.</p>
              </div>
              <div className="p-6 rounded-2xl bg-[#0f1522] border border-slate-800 space-y-3">
                <div className="h-10 w-10 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-400 text-xl font-bold">⚡</div>
                <h3 className="text-base font-bold text-white">Fast Manual Terminal</h3>
                <p className="text-xs text-slate-400 leading-relaxed">Instant one-click manual order execution directly hooked into the broker tick feed for precision scalping.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bots' && (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Verified Algorithmic Presets</h3>
                <span className="text-xs font-mono text-emerald-400">Active: {presetName}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  onClick={() => applyPreset('Differs Safe', 'DIGITDIFF', '1.00', '11.0', '1', '0', '10.00', '35.00')}
                  className={`cursor-pointer p-4 rounded-2xl border transition ${presetName === 'Differs Safe' ? 'bg-emerald-950/20 border-emerald-500 shadow-lg' : 'bg-[#0f1522] border-slate-800'}`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-black uppercase text-emerald-400">Differs Sentinel</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded">~90% Win</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">Trades on last digit differing from target 0. Micro-compounding model.</p>
                </div>

                <div
                  onClick={() => applyPreset('Even/Odd Parity', 'DIGITEVEN', '1.00', '2.1', '1', '0', '15.00', '25.00')}
                  className={`cursor-pointer p-4 rounded-2xl border transition ${presetName === 'Even/Odd Parity' ? 'bg-cyan-950/20 border-cyan-500 shadow-lg' : 'bg-[#0f1522] border-slate-800'}`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-black uppercase text-cyan-400">Parity Runner</span>
                    <span className="text-[10px] bg-cyan-500/20 text-cyan-300 font-mono px-2 py-0.5 rounded">1:1 Return</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">Even/odd sequence algorithm targeting alternating digit volatility cycles.</p>
                </div>

                <div
                  onClick={() => applyPreset('Rise/Fall Scalp', 'CALL', '2.00', '2.0', '5', '0', '20.00', '40.00')}
                  className={`cursor-pointer p-4 rounded-2xl border transition ${presetName === 'Rise/Fall Scalp' ? 'bg-amber-950/20 border-amber-500 shadow-lg' : 'bg-[#0f1522] border-slate-800'}`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-black uppercase text-amber-400">Trend Momentum</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-2 py-0.5 rounded">5-Tick Scalp</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">Directional 5-tick momentum contracts executed on high volatility shifts.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-[#0f1522] border border-slate-800 p-6 rounded-2xl space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-white">Bot Strategy Configurator</h3>
                    <p className="text-xs text-slate-400">Set strategy type, stake compounding, and automated circuit breakers.</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase font-mono ${
                    isBotRunning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isBotRunning ? 'Bot Active' : 'Standby'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Synthetic Asset</label>
                    <select
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm"
                    >
                      <option value="R_100">Volatility 100 Index</option>
                      <option value="R_50">Volatility 50 Index</option>
                      <option value="R_25">Volatility 25 Index</option>
                      <option value="1HZ100V">Volatility 100 (1s) Index</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Strategy Contract</label>
                    <select
                      value={strategy}
                      onChange={(e) => { setStrategy(e.target.value); setPresetName('Custom'); }}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm"
                    >
                      <option value="DIGITDIFF">Digit Differs</option>
                      <option value="DIGITMATCH">Digit Matches</option>
                      <option value="DIGITEVEN">Digit Even</option>
                      <option value="DIGITODD">Digit Odd</option>
                      <option value="CALL">Rise / Higher ▲</option>
                      <option value="PUT">Fall / Lower ▼</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Base Initial Stake ($)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={baseStake}
                      onChange={(e) => setBaseStake(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Martingale Multiplier</label>
                    <input
                      type="number"
                      step="0.1"
                      value={martingale}
                      onChange={(e) => setMartingale(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-emerald-400">Take Profit ($)</label>
                    <input
                      type="number"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-emerald-900/60 p-3 rounded-xl text-sm font-mono text-emerald-300"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-rose-400">Stop Loss ($)</label>
                    <input
                      type="number"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-rose-900/60 p-3 rounded-xl text-sm font-mono text-rose-300"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Duration (Ticks: 1 - 10)</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      disabled={isBotRunning}
                      className="w-full mt-1.5 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm font-mono"
                    />
                  </div>

                  {['DIGITMATCH', 'DIGITDIFF'].includes(strategy) && (
                    <div>
                      <label className="text-xs font-semibold text-cyan-400">Prediction Digit Barrier (0 - 9)</label>
                      <input
                        type="number"
                        min="0"
                        max="9"
                        value={predictionDigit}
                        onChange={(e) => setPredictionDigit(e.target.value)}
                        disabled={isBotRunning}
                        className="w-full mt-1.5 bg-[#151d2d] border border-cyan-800/60 p-3 rounded-xl text-sm font-mono text-cyan-300"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  {!isBotRunning ? (
                    <button
                      onClick={startBot}
                      className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm uppercase tracking-wider rounded-xl transition shadow-xl"
                    >
                      ▶ Launch Automated Bot Engine
                    </button>
                  ) : (
                    <button
                      onClick={() => stopBot('User clicked stop')}
                      className="w-full py-4 bg-rose-600 hover:bg-rose-500 text-white font-black text-sm uppercase tracking-wider rounded-xl transition shadow-xl"
                    >
                      ⏹ Halt Bot Execution
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-[#0f1522] border border-slate-800 p-5 rounded-2xl flex flex-col h-[520px] shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Live Trade Stream</h3>
                  <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-slate-300">Clear</button>
                </div>
                <div className="flex-1 bg-[#080b11] p-3 rounded-xl border border-slate-800/80 font-mono text-xs overflow-y-auto space-y-2">
                  {logs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center">
                      Engine idle.<br />Authorize and tap Launch to trade.
                    </div>
                  ) : (
                    logs.map((log, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded border ${
                          log.type === 'success'
                            ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300'
                            : log.type === 'error'
                            ? 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                            : log.type === 'trade'
                            ? 'bg-cyan-950/30 border-cyan-900/50 text-cyan-200'
                            : 'bg-slate-900/50 border-slate-800 text-slate-400'
                        }`}
                      >
                        <span className="text-[10px] opacity-60 mr-1.5">[{log.time}]</span>
                        <span>{log.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analyzer' && (
          <div className="bg-[#0f1522] border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Last 100 Ticks Digit Frequency Breakdown</h3>
                <p className="text-xs text-slate-400">Statistical distribution on {symbol}.</p>
              </div>
              <div className="flex gap-4 font-mono text-xs">
                <span className="bg-slate-800 px-3 py-1 rounded text-cyan-400 font-bold">Even: {evenOddRatio.even}%</span>
                <span className="bg-slate-800 px-3 py-1 rounded text-amber-400 font-bold">Odd: {evenOddRatio.odd}%</span>
              </div>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
              {digitStats.map((pct, digit) => (
                <div key={digit} className="flex flex-col items-center bg-[#080b11] border border-slate-800 p-3 rounded-xl">
                  <span className="text-sm font-bold text-slate-200 mb-1">{digit}</span>
                  <div className="h-36 w-full bg-slate-800/40 rounded-lg flex items-end justify-center p-1">
                    <div
                      style={{ height: `${Math.min(pct * 3, 100)}%` }}
                      className={`w-full rounded transition-all duration-300 ${
                        pct >= 15 ? 'bg-emerald-400 shadow-lg' : pct <= 6 ? 'bg-rose-500' : 'bg-cyan-500'
                      }`}
                    />
                  </div>
                  <span className="mt-2 font-mono text-xs font-bold text-slate-300">{pct}%</span>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-800">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">
                Last 25 Sequence Ticks
              </span>
              <div className="flex flex-wrap gap-2">
                {digitHistory.slice(0, 25).map((d, i) => (
                  <span
                    key={i}
                    className={`h-9 w-9 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${
                      i === 0
                        ? 'bg-emerald-500 text-black shadow-lg scale-105'
                        : d % 2 === 0
                        ? 'bg-slate-800 border border-slate-700 text-cyan-400'
                        : 'bg-slate-800 border border-slate-700 text-amber-400'
                    }`}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="max-w-xl mx-auto bg-[#0f1522] border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <h3 className="text-lg font-bold text-white">Manual Quick Trade Terminal</h3>
            <div className="bg-[#080b11] p-6 rounded-xl border border-slate-800 text-center space-y-2">
              <span className="text-xs text-slate-400 uppercase">Live Index Quote ({symbol})</span>
              <p className="text-4xl font-mono font-black text-amber-400">{lastTick ?? '0.00'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400">Order Stake ($)</label>
                <input
                  type="number"
                  value={baseStake}
                  onChange={(e) => setBaseStake(e.target.value)}
                  className="w-full mt-1 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Duration (Ticks)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full mt-1 bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <button
                onClick={() => executeContract('CALL', duration)}
                className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm uppercase shadow-lg shadow-emerald-950 transition transform active:scale-95"
              >
                ▲ Higher / Rise
              </button>
              <button
                onClick={() => executeContract('PUT', duration)}
                className="py-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm uppercase shadow-lg shadow-rose-950 transition transform active:scale-95"
              >
                ▼ Lower / Fall
              </button>
            </div>
          </div>
        )}

        {activeTab === 'community' && (
          <div className="max-w-3xl mx-auto bg-gradient-to-r from-emerald-950/40 via-slate-900 to-cyan-950/40 border border-emerald-500/30 p-8 rounded-3xl text-center space-y-4 shadow-2xl">
            <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-3 py-1 rounded-full uppercase border border-emerald-500/20">
              VIP Traders Community
            </span>
            <h3 className="text-2xl sm:text-3xl font-black text-white">Join the Automated Trading Club</h3>
            <p className="text-sm text-slate-400 max-w-lg mx-auto">
              Get access to verified bot presets, risk calculators, and daily VIP strategy updates.
            </p>
            <div className="pt-2">
              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="inline-block px-6 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-cyan-950"
              >
                Join Official Telegram Channel ↗
              </a>
            </div>
          </div>
        )}
      </main>

      {/* Auth Modal with Chrome OAuth & Token Support */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1522] border border-slate-700 max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-6">
            <div className="flex justify-between items-center text-left">
              <div>
                <h3 className="text-lg font-bold text-white">Connect Deriv Account</h3>
                <p className="text-xs text-slate-400">Authenticate via Spotpro App</p>
              </div>
              <button onClick={() => setIsAuthModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {authError && (
              <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-xs p-3 rounded-xl font-medium">
                ⚠️ {authError}
              </div>
            )}

            <div className="space-y-4">
              <button
                onClick={handleOAuthLogin}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl transition transform active:scale-95 flex items-center justify-center gap-2"
              >
                <span>🔑</span> Authorize with Deriv Account
              </button>

              <div className="flex items-center gap-3">
                <hr className="flex-1 border-slate-800" />
                <span className="text-[10px] uppercase font-bold text-slate-500">Or Paste API Token</span>
                <hr className="flex-1 border-slate-800" />
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Paste Token (e.g. pat_0fb05588...)"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full bg-[#151d2d] border border-slate-700 p-3 rounded-xl text-sm text-slate-200 focus:border-emerald-500 font-mono"
                />
                <button
                  onClick={handleManualAuth}
                  disabled={isAuthorizing}
                  className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-black text-xs uppercase tracking-wider rounded-xl transition"
                >
                  {isAuthorizing ? 'Authorizing Token...' : 'Authorize Token'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
