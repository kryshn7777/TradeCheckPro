import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Shield, Download } from 'lucide-react';

const Navbar = () => {
  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 w-full z-50 border-b border-white/5 backdrop-blur-md bg-institutional-navy/80"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="w-8 h-8 md:w-10 md:h-10 bg-institutional-blue flex items-center justify-center rounded-lg shadow-[0_0_15px_rgba(71,94,117,0.3)]">
            <Terminal className="text-white w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-white font-display font-extrabold text-sm md:text-lg leading-tight tracking-tighter uppercase">TradeCheckPro</span>
            <span className="text-[8px] md:text-[10px] font-mono text-institutional-blue uppercase tracking-[0.2em] leading-tight">Android Cockpit</span>
          </div>
        </div>

        {/* Nav Links */}
        <div className="hidden lg:flex items-center gap-8 text-[11px] font-mono uppercase tracking-[0.1em] text-slate-400">
          <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button>
          <button onClick={() => scrollToSection('methodology')} className="hover:text-white transition-colors">Methodology</button>
          <button onClick={() => scrollToSection('privacy')} className="hover:text-white transition-colors">Privacy</button>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3 md:gap-4">
          <button className="hidden sm:flex items-center gap-2 text-[10px] md:text-[11px] font-mono text-slate-500 hover:text-white transition-colors">
            <Shield className="w-3 h-3 md:w-4 md:h-4 text-institutional-blue" /> <span className="hidden md:inline">Institutional Grade</span>
          </button>
          <button className="px-3 py-2 md:px-5 md:py-2.5 bg-white text-institutional-navy rounded-lg font-bold text-[10px] md:text-xs uppercase hover:bg-slate-200 transition-all flex items-center gap-2 touch-manipulation">
            <Download className="w-3 h-3 md:w-4 md:h-4" /> Get App
          </button>
        </div>
      </div>
    </motion.nav>
  );
};

export default Navbar;
