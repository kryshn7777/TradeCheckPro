import React from 'react';
import { motion } from 'framer-motion';

const ExecutionSidebars = () => {
  return (
    <>
      {/* Left Structural Pillar */}
      <div className="layout-pillar pillar-left hidden 2xl:flex flex-col items-center py-10 overflow-hidden">
        <div className="vertical-text font-mono text-[10px] tracking-[0.6em] text-white/30 whitespace-nowrap uppercase transform -rotate-180 mb-20">
          INSTITUTIONAL__READY // SYS_V4.2
        </div>
        <div className="flex-1 flex flex-col gap-2 opacity-10 font-mono text-[7px] text-institutional-blue">
           {[...Array(60)].map((_, i) => (
             <div key={i}>{Math.random().toString(16).substr(2, 6).toUpperCase()}</div>
           ))}
        </div>
        <div className="mt-10 font-mono text-[9px] text-white/20">0XFF</div>
      </div>

      {/* Right Structural Pillar */}
      <div className="layout-pillar pillar-right hidden 2xl:flex flex-col items-center py-10">
        <div className="flex flex-col items-center gap-6 mb-20">
           <div className="w-1.5 h-1.5 rounded-full bg-institutional-blue animate-ping" />
           <div className="font-mono text-[9px] tracking-widest text-institutional-blue uppercase transform rotate-90 origin-center whitespace-nowrap">
              LATENCY: 12MS
           </div>
        </div>
        <div className="flex-1 w-[1px] bg-white/5 relative">
          <motion.div 
            className="absolute top-0 left-0 w-full bg-institutional-blue filter blur-[2px]"
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            style={{ height: '40px' }}
          />
        </div>
        <div className="mt-20 font-mono text-[9px] text-white/20 uppercase tracking-[0.3em] transform rotate-90">
           PROTOCOL: V4.2
        </div>
      </div>
    </>
  );
};

export default ExecutionSidebars;
