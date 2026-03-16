import React, { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';

const InstitutionalCore = () => {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll();

  const rotate = useTransform(scrollYProgress, [0, 1], [0, 45]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 1.2]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.4, 0.8, 0.8, 0.4]);

  const smoothRotate = useSpring(rotate, { stiffness: 100, damping: 30 });
  const smoothScale = useSpring(scale, { stiffness: 100, damping: 30 });

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 pointer-events-none overflow-hidden z-background"
    >
      {/* Central Core Geometry */}
      <motion.div 
        style={{ 
          rotate: smoothRotate, 
          scale: smoothScale,
          opacity 
        }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px]"
      >
        {/* Large Gradient Orb */}
        <div className="absolute inset-0 bg-gradient-to-br from-inst-indigo/20 via-inst-blue/10 to-transparent blur-[120px] rounded-full animate-pulse-slow" />
        
        {/* Abstract Lines & Shapes */}
        <svg viewBox="0 0 800 800" className="w-full h-full opacity-20">
          <defs>
            <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-inst-indigo)" stopOpacity="0.2" />
              <stop offset="50%" stopColor="var(--color-inst-cyan)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--color-inst-indigo)" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          
          <motion.circle 
            cx="400" cy="400" r="300" 
            stroke="url(#line-grad)" strokeWidth="0.5" fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 3, ease: "easeInOut" }}
          />
          <motion.rect 
            x="200" y="200" width="400" height="400" 
            stroke="url(#line-grad)" strokeWidth="0.5" fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          />
          <motion.path 
            d="M100 400 L700 400 M400 100 L400 700" 
            stroke="url(#line-grad)" strokeWidth="0.2"
          />
          
          {/* Technical Dots */}
          {[...Array(8)].map((_, i) => (
            <circle 
              key={i}
              cx={400 + 300 * Math.cos((i * Math.PI) / 4)}
              cy={400 + 300 * Math.sin((i * Math.PI) / 4)}
              r="2"
              fill="var(--color-inst-cyan)"
              className="animate-pulse"
            />
          ))}
        </svg>
      </motion.div>

      {/* Noise Texture Overlay */}
      <div className="absolute inset-0 opacity-[0.02] mix-blend-overlay pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      
      {/* Vignette */}
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none" />
    </div>
  );
};

export default InstitutionalCore;
