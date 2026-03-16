import React, { useState } from 'react';
import PageWrapper from '../components/PageWrapper';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, GripVertical, Plus, Save, Target } from 'lucide-react';

const initialSteps = [
  { id: 1, text: 'Confirm Market Structure (HTF)', completed: false },
  { id: 2, text: 'Identify Liquidity Sweep / Grab', completed: false },
  { id: 3, text: 'Wait for Displacement (mBOS)', completed: false },
  { id: 4, text: 'FVG / Orderblock Validation', completed: false },
  { id: 5, text: 'Set Risk/Reward Ratio (Min 1:3)', completed: false },
  { id: 6, text: 'Verify News Catalyst (ForexFactory)', completed: false },
];

const StrategyHub = () => {
  const [steps, setSteps] = useState(initialSteps);
  const [activeStrategy, setActiveStrategy] = useState('Institutional Divergence V4');

  const toggleStep = (id) => {
    setSteps(steps.map(step => 
      step.id === id ? { ...step, completed: !step.completed } : step
    ));
  };

  const completedCount = steps.filter(s => s.completed).length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <PageWrapper>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h2 className="text-sm font-mono text-institutional-blue mb-1 uppercase tracking-widest flex items-center gap-2">
              <Target className="w-4 h-4" /> Strategy Builder
            </h2>
            <h1 className="text-4xl font-display font-extrabold uppercase">{activeStrategy}</h1>
          </div>
          <div className="flex gap-3">
            <button className="glass-button flex items-center gap-2">
              <Save className="w-4 h-4" /> Save Template
            </button>
            <button className="px-6 py-3 bg-institutional-blue text-white rounded-lg font-bold hover:bg-institutional-blue/80 transition-all flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Step
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="terminal-card p-6 mb-8 border-institutional-blue/20 bg-institutional-blue/5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-tighter">Assurance Level</span>
            <span className="text-xs font-mono text-white tracking-widest">{Math.round(progress)}% VALIDATED</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className={`h-full transition-colors duration-500 shadow-[0_0_10px_rgba(46,125,50,0.4)] ${
                progress === 100 ? 'bg-institutional-green' : 'bg-institutional-blue'
              }`}
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="flex flex-col gap-4">
          <AnimatePresence>
            {steps.map((step, index) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`terminal-card p-5 flex items-center gap-4 transition-all group ${
                  step.completed ? 'border-institutional-green/30 bg-institutional-green/5' : 'hover:border-white/10'
                }`}
              >
                <div className="text-slate-600 cursor-grab active:cursor-grabbing hover:text-slate-400 transition-colors">
                  <GripVertical className="w-5 h-5" />
                </div>
                
                <button 
                  onClick={() => toggleStep(step.id)}
                  className={`transition-colors ${step.completed ? 'text-institutional-green' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {step.completed ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                </button>

                <span className={`text-lg font-medium transition-all ${
                  step.completed ? 'text-slate-200 line-through opacity-50' : 'text-white'
                }`}>
                  {step.text}
                </span>

                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-mono text-slate-500 uppercase">MANDATORY</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Footer Note */}
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-12 text-center text-slate-500 text-xs font-mono italic"
        >
          // Systematic adherence to strategy is the only statistically significant edge. //
        </motion.p>
      </div>
    </PageWrapper>
  );
};

export default StrategyHub;
