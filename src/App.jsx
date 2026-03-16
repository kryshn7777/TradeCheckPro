import React, { useState } from 'react';
import Home from './pages/Home';
import Navbar from './components/Navbar';
import CustomCursor from './components/CustomCursor';
import Preloader from './components/Preloader';
import ExecutionSidebars from './components/ExecutionSidebars';
import SmoothScroll from './components/SmoothScroll';
import InstitutionalCore from './components/InstitutionalCore';
import { AnimatePresence } from 'framer-motion';

function App() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="min-h-screen bg-institutional-navy text-slate-200 cursor-none selection:bg-institutional-blue selection:text-white">
      <AnimatePresence>
        {loading && <Preloader onComplete={() => setLoading(false)} />}
      </AnimatePresence>
      
      <SmoothScroll />
      <CustomCursor />
      <ExecutionSidebars />
      
      <div className="grid-pattern fixed inset-0 pointer-events-none" />
      <div className="scanline-overlay" />
      
      {!loading && (
        <>
          <Navbar />
          <main>
            <Home />
          </main>
        </>
      )}
      
      <InstitutionalCore />
    </div>
  );
}

export default App;
