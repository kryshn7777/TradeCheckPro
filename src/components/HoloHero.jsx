import React, { memo } from 'react';
import { motion } from 'framer-motion';
import Magnetic from './Magnetic';

const HoloHero = memo(() => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-32 overflow-hidden">
      <div className="absolute inset-0 z-0">
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-holo-accent/[0.02] blur-[100px] rounded-full" />
      </div>

      <div className="z-10 text-center space-y-12 max-w-6xl">
        <motion.div
           initial={{ opacity: 0, y: 30 }}
           animate={{ opacity: 1, y: 0 }}
           className="flex items-center justify-center gap-6 mb-4"
        >
          <div className="h-px w-12 bg-holo-accent/30" />
          <span className="text-[10px] font-mono text-holo-accent tracking-[0.5em] uppercase">Audit Core V4.2_Established</span>
          <div className="h-px w-12 bg-holo-accent/30" />
        </motion.div>

        <h1 className="text-7xl md:text-[10vw] font-display font-black tracking-tighter leading-[0.8] uppercase flex flex-col items-center">
          <motion.span 
            initial={{ opacity: 0, x: -100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="block text-white"
          >
            SYSTEMATIC
          </motion.span>
          <motion.span 
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
            className="block holo-glow-text inst-text-gradient"
          >
            AUDIT.
          </motion.span>
        </h1>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 1, delay: 0.8 }}
          className="text-lg md:text-2xl text-white font-medium max-w-3xl mx-auto leading-relaxed italic"
        >
          Institutional-grade forensic analysis for the discretionary Android trader. 
          Bridge the gap between biological impulsivity and mathematical edge.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="flex flex-col md:flex-row items-center justify-center gap-10 pt-8"
        >
          <Magnetic strength={0.3}>
            <button className="px-16 py-8 bg-holo-accent text-holo-bg font-black text-xl rounded-full shadow-[0_0_60px_rgba(6,249,249,0.4)] hover:scale-105 transition-transform active:scale-95">
              DEPLOY_NODE
            </button>
          </Magnetic>
          <button className="text-[10px] font-mono text-white/40 hover:text-holo-accent transition-colors tracking-[0.3em] uppercase group flex items-center gap-4">
             Verify Capability <div className="w-8 h-px bg-white/20 group-hover:bg-holo-accent group-hover:w-12 transition-all" />
          </button>
        </motion.div>
      </div>

      {/* Decorative Corner Stats */}
      <div className="absolute bottom-12 left-12 hidden xl:block space-y-2">
         <div className="font-mono text-[8px] text-white/20 uppercase tracking-[0.2em]">NODE_HEALTH: 100%</div>
         <div className="w-32 h-[1px] bg-white/10 overflow-hidden">
            <motion.div 
              animate={{ x: [-128, 128] }} 
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-full h-full bg-holo-accent opacity-50" 
            />
         </div>
         <div className="font-mono text-[8px] text-white/20 uppercase tracking-[0.2em]">SYNC_KEY: X9_AUDITOR</div>
      </div>
    </section>
  );
});

export default HoloHero;
