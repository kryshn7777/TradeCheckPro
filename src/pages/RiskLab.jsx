import React, { useState, useEffect } from 'react';
import PageWrapper from '../components/PageWrapper';
import { motion } from 'framer-motion';
import { ShieldAlert, Calculator, Flame, Info } from 'lucide-react';

const RiskLab = () => {
  const [balance, setBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [stopLoss, setStopLoss] = useState(20);
  const [pipValue, setPipValue] = useState(10); // Standard lot

  const riskAmount = (balance * (riskPercent / 100)).toFixed(2);
  const lotSize = (riskAmount / (stopLoss * pipValue)).toFixed(2);

  // Heat Monitor Logic
  const heatLevel = riskPercent > 3 ? 'critical' : riskPercent > 1.5 ? 'warning' : 'safe';
  const heatColor = heatLevel === 'critical' ? '#C62828' : heatLevel === 'warning' ? '#D97706' : '#2E7D32';

  return (
    <PageWrapper>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h2 className="text-sm font-mono text-institutional-blue mb-1 uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Risk Center
          </h2>
          <h1 className="text-4xl font-display font-extrabold uppercase text-white">Risk Intelligence Lab</h1>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-start">
          {/* Controls */}
          <div className="terminal-card p-8 flex flex-col gap-6">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <Calculator className="w-4 h-4" />
              <span className="text-xs font-mono uppercase tracking-tighter">Position Size Calculator</span>
            </div>

            <div className="flex flex-col gap-4">
              <InputGroup 
                label="Account Balance ($)" 
                value={balance} 
                onChange={(e) => setBalance(Number(e.target.value))} 
              />
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-mono text-slate-500 uppercase">
                  <span>Risk Parameter</span>
                  <span className={heatLevel === 'critical' ? 'text-institutional-red' : ''}>{riskPercent}%</span>
                </div>
                <input 
                  type="range" 
                  min="0.25" 
                  max="5" 
                  step="0.25"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-institutional-blue"
                />
              </div>
              <InputGroup 
                label="Stop Loss (Pips/Points)" 
                value={stopLoss} 
                onChange={(e) => setStopLoss(Number(e.target.value))} 
              />
            </div>

            <div className="mt-6 pt-6 border-t border-white/5 flex flex-col gap-4">
              <div className="flex justify-between items-center px-4 py-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs font-mono text-slate-400 uppercase">Risk Amount</span>
                <span className="text-lg font-bold text-white">${riskAmount}</span>
              </div>
              <div className="flex justify-between items-center px-4 py-6 rounded-lg bg-institutional-blue/10 border border-institutional-blue/30 relative overflow-hidden group">
                <div className="absolute inset-0 bg-institutional-blue/5 animate-pulse" />
                <span className="text-xs font-mono text-slate-300 uppercase relative z-10">Suggested Size</span>
                <span className="text-3xl font-display font-extrabold text-white relative z-10">{lotSize} <span className="text-sm font-mono text-institutional-blue">LOTS</span></span>
              </div>
            </div>
          </div>

          {/* Visual Monitor */}
          <div className="flex flex-col gap-6">
            <div className="terminal-card p-8 flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-2 text-slate-400 mb-8 w-full text-left">
                <Flame className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-tighter">Heat Monitor</span>
              </div>
              
              {/* Circular Gauge Placeholder (CSS based) */}
              <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                <svg className="w-full h-full -rotate-90">
                  <circle 
                    cx="96" cy="96" r="80" 
                    fill="transparent" 
                    stroke="#1e293b" 
                    strokeWidth="8" 
                  />
                  <motion.circle 
                    cx="96" cy="96" r="80" 
                    fill="transparent" 
                    stroke={heatColor} 
                    strokeWidth="8" 
                    strokeDasharray="502.4"
                    initial={{ strokeDashoffset: 502.4 }}
                    animate={{ strokeDashoffset: 502.4 - (502.4 * (riskPercent / 5)) }}
                    transition={{ type: 'spring', bounce: 0, duration: 1 }}
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 10px ${heatColor}44)` }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <motion.span 
                    animate={{ color: heatColor }}
                    className="text-4xl font-display font-extrabold"
                  >
                    {riskPercent}%
                  </motion.span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Exposure</span>
                </div>
              </div>

              <div className={`text-xs font-mono px-4 py-2 rounded-full border mb-4 ${
                heatLevel === 'critical' ? 'text-institutional-red border-institutional-red/30 bg-institutional-red/5' :
                heatLevel === 'warning' ? 'text-institutional-amber border-institutional-amber/30 bg-institutional-amber/5' :
                'text-institutional-green border-institutional-green/30 bg-institutional-green/5'
              }`}>
                {heatLevel === 'critical' ? 'ABOVE INSTITUTIONAL LIMITS' : heatLevel === 'warning' ? 'HIGH RISK NOTICE' : 'WITHIN PARAMETERS'}
              </div>

              <p className="text-slate-500 text-[10px] leading-relaxed max-w-xs">
                {heatLevel === 'critical' ? 'Execution is restricted. Ego-driven risk detected. Re-evaluate strategy checklist immediately.' : 
                 'Proceed with extreme caution. Ensure R:R is > 1:4 to compensate for high exposure.'}
              </p>
            </div>

            <div className="terminal-card p-6 flex gap-4 bg-slate-50/5 border-white/10 group cursor-help">
              <Info className="w-5 h-5 text-institutional-blue shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <span className="text-[10px] font-mono text-slate-400 uppercase block mb-1">Risk Tip</span>
                <p className="text-xs text-slate-300">Statistical ruin is often the result of "just this once" logic. Stick to your risk cap regardless of confidence.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
};

const InputGroup = ({ label, value, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[11px] font-mono text-slate-500 uppercase tracking-tighter ml-1">{label}</label>
    <input 
      type="number" 
      value={value}
      onChange={onChange}
      className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-institutional-blue transition-colors"
    />
  </div>
);

export default RiskLab;
