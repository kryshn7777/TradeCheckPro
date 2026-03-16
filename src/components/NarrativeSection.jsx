import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const NarrativeSection = ({ children, title, subtitle, bgText }) => {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  const y = useTransform(scrollYProgress, [0, 1], [100, -100]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [0.8, 1]);

  return (
    <section 
      ref={containerRef}
      className="min-h-screen flex flex-col items-center justify-center relative px-6 py-24 overflow-hidden"
    >
      {bgText && (
        <motion.div 
          style={{ y: useTransform(scrollYProgress, [0, 1], [-50, 50]) }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
        >
          <span className="text-[20vw] font-black text-white/[0.02] whitespace-nowrap leading-none uppercase">
            {bgText}
          </span>
        </motion.div>
      )}

      <motion.div 
        style={{ opacity, y }}
        className="max-w-4xl mx-auto glass-holo p-12 md:p-20 border-white/5 relative z-10"
      >
        <div className="scanline-holo opacity-10" />
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          className="text-holo-accent font-mono text-[10px] tracking-[0.4em] mb-6 uppercase"
        >
          {subtitle}
        </motion.div>
        <h2 className="text-4xl md:text-6xl font-black mb-8 tracking-tighter uppercase leading-tight">
          {title}
        </h2>
        <div className="text-lg md:text-2xl text-white/60 leading-relaxed font-medium">
          {children}
        </div>
      </motion.div>
      
      {/* Decorative Registry Lines */}
      <div className="absolute left-1/2 bottom-0 w-px h-24 bg-gradient-to-t from-inst-indigo/20 to-transparent" />
    </section>
  );
};

export default NarrativeSection;
