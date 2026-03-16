import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { Shield, Zap, Target, Lock, Check } from 'lucide-react';
import Magnetic from './Magnetic';

const MonolithPricing = memo(() => {
  return (
    <section className="py-40 px-6 relative overflow-hidden bg-holo-bg">
      {/* Distant Light Leaks */}
      <div className="absolute top-0 right-[-10%] w-[40%] h-[100%] bg-holo-accent/5 blur-[150px] rotate-12 pointer-events-none" />
      <div className="absolute bottom-0 left-[-10%] w-[40%] h-[100%] bg-inst-indigo/5 blur-[150px] -rotate-12 pointer-events-none" />

      <div className="container mx-auto">
        <div className="text-center mb-32">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            className="text-registry mb-4"
          >
            ESTABLISHMENT_PROTOCOL // LICENSE_SELECTION
          </motion.div>
          <h2 className="text-5xl md:text-8xl font-black font-display tracking-tighter uppercase mb-6">
            ACCESS <span className="inst-text-gradient">TIERS.</span>
          </h2>
          <div className="h-px w-24 bg-holo-accent mx-auto" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-6xl mx-auto items-end">
          {/* Standard Monolith */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 40 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            className="glass-holo p-12 border-white/5 relative group will-change-transform"
          >
            <div className="scanline-holo opacity-0 group-hover:opacity-20" />
            
            <div className="absolute top-0 right-0 p-8 font-mono text-[8px] text-white/10 text-right uppercase">
              NODE_ID: 0X992A<br/>CLASS: DISCRETIONARY
            </div>

            <div className="space-y-8 mb-16">
              <div className="w-12 h-12 rounded-sm border border-white/10 flex items-center justify-center">
                 <Shield className="w-6 h-6 text-white/40" />
              </div>
              <div>
                <h3 className="text-3xl font-black uppercase tracking-tight mb-2">Basic Entry</h3>
                <p className="text-white/40 text-sm leading-relaxed">Fundamental discipline metrics for developing traders.</p>
              </div>
              <div className="text-6xl font-black font-display">$9.99<span className="text-xs font-mono text-white/30 ml-2">/MONTH</span></div>
            </div>

            <ul className="space-y-6 mb-16 border-t border-white/5 pt-8">
              {["Basic Execution Audit", "1 Account Sync", "CSV Data Export", "Weekly Sentiment Review"].map((f, i) => (
                <li key={i} className="flex items-center gap-4 text-xs font-medium text-white/60">
                   <div className="w-1 h-1 rounded-full bg-holo-accent/30" /> {f}
                </li>
              ))}
            </ul>

            <button className="w-full py-6 border border-white/10 hover:bg-white/5 transition-colors uppercase font-black text-xs tracking-[0.3em]">
              INITIALIZE_MODULE
            </button>
          </motion.div>

          {/* MASTERY MONOLITH */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 40 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-holo p-12 md:p-16 border-holo-accent/30 relative group bg-holo-accent/[0.02] shadow-[0_0_100px_rgba(6,249,249,0.05)] will-change-transform"
          >
            <div className="scanline-holo opacity-40" />
            
            <div className="absolute top-0 right-0 p-8 font-mono text-[8px] text-holo-accent opacity-30 text-right uppercase">
               NODE_ID: 0XAA00<br/>CLASS: INSTITUTIONAL
            </div>

            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-6 py-1.5 bg-holo-accent text-holo-bg text-[10px] font-black uppercase tracking-[0.4em] shadow-[0_0_30px_#06F9F9]">
               RECOMMENDED
            </div>

            <div className="space-y-8 mb-16">
              <div className="w-16 h-16 rounded-sm border border-holo-accent/40 flex items-center justify-center bg-holo-accent/5">
                 <Lock className="w-8 h-8 text-holo-accent" />
              </div>
              <div>
                <h3 className="text-4xl font-black uppercase tracking-tight mb-2 holo-glow-text">Mastery Tier</h3>
                <p className="text-holo-accent/60 text-sm leading-relaxed">The full systematic suite. Eliminate the human variable entirely.</p>
              </div>
              <div className="text-8xl font-black font-display inst-text-gradient">$199<span className="text-xs font-mono text-holo-accent ml-2 opacity-50">/LIFETIME</span></div>
            </div>

            <ul className="space-y-6 mb-16 border-t border-holo-accent/10 pt-8">
              {["Full Forensic Audit Suite", "Unlimited Account Sync", "Proprietary Alpha Discovery", "24/7 Priority Quant Support", "Holographic Dashboard Access"].map((f, i) => (
                <li key={i} className="flex items-center gap-4 text-sm font-bold text-white/80">
                   <Check className="w-4 h-4 text-holo-accent" /> {f}
                </li>
              ))}
            </ul>

            <Magnetic strength={0.3}>
              <button className="w-full py-8 bg-holo-accent text-holo-bg font-black text-sm tracking-[0.4em] uppercase shadow-[0_0_50px_rgba(6,249,249,0.3)] hover:scale-[1.02] transition-transform active:scale-95">
                ESTABLISH_AUTH
              </button>
            </Magnetic>
          </motion.div>
        </div>
      </div>
    </section>
  );
});

export default MonolithPricing;
