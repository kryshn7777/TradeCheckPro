import React from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const HolographicBackground = () => {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const rotate = useTransform(scrollYProgress, [0, 1], [0, 15]);

  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden bg-[#05080F]">
      {/* Deep Space Grid */}
      <motion.div 
        style={{ y: y1, rotate }}
        className="absolute inset-[-20%] opacity-20"
      >
        <div className="w-full h-full" 
             style={{ 
               backgroundImage: `radial-gradient(circle at 2px 2px, rgba(30, 41, 59, 0.4) 1px, transparent 0)`,
               backgroundSize: '40px 40px'
             }} 
        />
      </motion.div>

      {/* Cyber Glows */}
      <div className="absolute top-[-10%] left-[-5%] w-[50%] h-[70%] bg-holo-accent/5 blur-[200px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[70%] bg-inst-indigo/5 blur-[200px] pointer-events-none" />

      {/* Floating Data Nodes (Decorative) */}
      {[...Array(12)].map((_, i) => (
        <motion.div
           key={i}
           initial={{ 
             x: Math.random() * 100 + "%", 
             y: Math.random() * 100 + "%",
             opacity: 0.1
           }}
           animate={{ 
             y: [Math.random() * 100 + "%", Math.random() * 100 + "%"],
             opacity: [0.1, 0.3, 0.1]
           }}
           transition={{ 
             duration: 10 + Math.random() * 10, 
             repeat: Infinity,
             ease: "linear"
           }}
           className="absolute w-[1px] h-[1px] bg-holo-accent shadow-[0_0_10px_#06F9F9]"
        />
      ))}

      {/* Parallax Marginal Text */}
      <motion.div 
        style={{ y: y2 }}
        className="absolute top-20 right-10 text-[8px] font-mono text-white/5 uppercase leading-loose text-right hidden xl:block"
      >
        {`HOLOGRAPHIC_CORE_V4\nSYNC_PROTOCOL_992\nESTABLISHED_AUTH_L3\nLATENCY_BUFFER_ENABLED\nFORENSIC_AUDIT_ACTIVE\nMEM_USAGE: 0.02%\nTHREAD_01: RUNNING\nTHREAD_02: IDLE\nTHREAD_03: RUNNING`.repeat(20)}
      </motion.div>

      <div className="absolute inset-0 bg-gradient-to-b from-[#05080F]/50 via-transparent to-[#05080F]" />
    </div>
  );
};

export default HolographicBackground;
