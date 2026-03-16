import React, { useState, useEffect, useRef } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';

const CustomCursor = () => {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  
  const springConfig = { damping: 25, stiffness: 250 };
  const springX = useSpring(cursorX, springConfig);
  const springY = useSpring(cursorY, springConfig);

  const [coords, setCoords] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const moveCursor = (e) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      setCoords({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, []);

  return (
    <>
      {/* Tactical Crosshair */}
      <motion.div
        className="fixed top-0 left-0 w-8 h-8 pointer-events-none z-[9999] mix-blend-difference"
        style={{
          x: springX,
          y: springY,
          translateX: '-50%',
          translateY: '-50%',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-[1px] bg-institutional-blue opacity-50" />
          <div className="h-full w-[1px] bg-institutional-blue opacity-50" />
        </div>
        <div className="absolute top-10 left-4 font-mono text-[8px] text-institutional-blue whitespace-nowrap opacity-40">
           X: {coords.x.toString().padStart(4, '0')} // Y: {coords.y.toString().padStart(4, '0')}
        </div>
      </motion.div>

      {/* Trailing Glow */}
      <motion.div
        className="fixed top-0 left-0 w-64 h-64 bg-institutional-blue/5 rounded-full blur-[80px] pointer-events-none z-[9998]"
        style={{
          x: springX,
          y: springY,
          translateX: '-50%',
          translateY: '-50%',
        }}
      />
    </>
  );
};

export default CustomCursor;
