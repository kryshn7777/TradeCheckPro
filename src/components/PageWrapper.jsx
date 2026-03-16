import React from 'react';
import { motion } from 'framer-motion';

const PageWrapper = ({ children }) => {
  return (
    <motion.main
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="max-w-7xl mx-auto px-6 pt-24 pb-12 min-h-screen"
    >
      {children}
    </motion.main>
  );
};

export default PageWrapper;
