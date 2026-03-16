import React from 'react';
import { motion } from 'framer-motion';
import Magnetic from './Magnetic';

const V3Hero = () => {
  return (
    <section className="relative min-h-[120vh] flex flex-col items-center justify-center px-6 pt-32 overflow-hidden">
      {/* Registry Backdrop */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-full max-w-[1200px] pointer-events-none opacity-5">
        <div className="font-mono text-[15vw] font-black leading-none uppercase tracking-tighter">
          SYSTEMATIC
        </div>
      </div>

      <div className="z-10 text-center space-y-8 max-w-5xl">
        <motion.div
           initial={{ opacity: 0, y: 30 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ duration: 0.8, ease: "easeOut" }}
           className="flex items-center justify-center gap-4 mb-4"
        >
          <span className="w-12 h-[1px] bg-inst-indigo" />
          <span className="text-registry">ESTABLISHED PROTOCOL V4.2</span>
          <span className="w-12 h-[1px] bg-inst-indigo" />
        </motion.div>

        <h1 className="text-6xl md:text-9xl font-display font-black tracking-tight leading-[0.9]">
          <motion.span 
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="block"
          >
            OWN THE
          </motion.span>
          <motion.span 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="block inst-text-gradient"
          >
            EDGE.
          </motion.span>
        </h1>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="text-inst-text-dim text-lg md:text-xl max-w-2xl mx-auto leading-relaxed"
        >
          TradeCheckPro transforms impulsive execution into an institutional-grade operation. 
          Audit every tick. Quantify every decision. Eliminate the human variable.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="flex flex-col md:flex-row items-center justify-center gap-6 pt-8"
        >
          <Magnetic strength={0.3}>
            <button className="glass-button px-10 py-4 text-lg border-inst-indigo/30 bg-inst-indigo/10 hover:bg-inst-indigo/20 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
              INITIALIZE AUDITOR
            </button>
          </Magnetic>
          <button className="text-registry hover:text-white transition-colors">
            VIEW PROTOCOL DOCS [0XFF]
          </button>
        </motion.div>
      </div>

      {/* Floating Status Indicators */}
      <div className="absolute bottom-20 left-12 hidden xl:block">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-1 bg-inst-green rounded-full" />
            <span className="text-registry">ENGINE_ACTIVE</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-1 h-1 bg-inst-cyan rounded-full" />
            <span className="text-registry">LATENCY_SYNC_OK</span>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div 
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30"
      >
        <span className="text-registry">EXTRACT_DATA</span>
        <div className="w-px h-12 bg-gradient-to-b from-inst-indigo to-transparent" />
      </motion.div>
    </section>
  );
};

export default V3Hero;
