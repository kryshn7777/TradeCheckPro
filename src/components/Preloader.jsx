import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const Preloader = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING_HANDSHAKE...');

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer);
          setTimeout(onComplete, 800);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 150);

    const statusInterval = setInterval(() => {
      const statuses = [
        'ESTABLISHING_ENCRYPTED_TUNNEL...',
        'SYNCING_LOCAL_SQLITE_CORE...',
        'BYPASSING_EMOTIONAL_BIAS...',
        'COCKPIT_READY_FOR_DEPLOYMENT.',
      ];
      setStatus(statuses[Math.floor(Math.random() * statuses.length)]);
    }, 1000);

    return () => {
      clearInterval(timer);
      clearInterval(statusInterval);
    };
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ y: '-100%', transition: { duration: 0.8, ease: [0.76, 0, 0.24, 1] } }}
      className="fixed inset-0 z-[10000] bg-black flex flex-col items-center justify-center p-6"
    >
      <div className="w-full max-w-md">
        <div className="flex justify-between items-end mb-4 font-mono text-[10px] tracking-widest text-institutional-blue">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {status}
          </motion.div>
          <div>{Math.round(progress)}%</div>
        </div>
        <div className="h-[2px] w-full bg-white/5 relative overflow-hidden">
          <motion.div 
            className="h-full bg-institutional-blue shadow-[0_0_15px_#475e75]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-8 grid grid-cols-4 gap-2">
           {[...Array(24)].map((_, i) => (
             <motion.div 
              key={i}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: [0, Math.random(), 0] }}
              transition={{ repeat: Infinity, duration: 1 + Math.random() }}
              className="h-4 bg-institutional-blue/10 origin-bottom"
             />
           ))}
        </div>
      </div>
    </motion.div>
  );
};

export default Preloader;
