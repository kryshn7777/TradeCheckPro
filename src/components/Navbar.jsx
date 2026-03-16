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
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="w-10 h-10 bg-institutional-blue flex items-center justify-center rounded-lg shadow-[0_0_15px_rgba(71,94,117,0.3)]">
            <Terminal className="text-white w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-white font-display font-extrabold text-lg leading-tight tracking-tighter uppercase">TradeCheckPro</span>
            <span className="text-[10px] font-mono text-institutional-blue uppercase tracking-[0.2em] leading-tight">Android Cockpit</span>
          </div>
        </div>

        {/* Nav Links */}
        <div className="hidden md:flex items-center gap-8 text-[11px] font-mono uppercase tracking-[0.1em] text-slate-400">
          <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button>
          <button onClick={() => scrollToSection('methodology')} className="hover:text-white transition-colors">Methodology</button>
          <button onClick={() => scrollToSection('privacy')} className="hover:text-white transition-colors">Privacy</button>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-4">
          <button className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-white transition-colors">
            <Shield className="w-4 h-4 text-institutional-blue" /> Institutional Grade
          </button>
          <button className="px-5 py-2.5 bg-white text-institutional-navy rounded-lg font-bold text-xs uppercase hover:bg-slate-200 transition-all flex items-center gap-2">
            <Download className="w-4 h-4" /> Get App
          </button>
        </div>
      </div>
    </motion.nav>
  );
};

export default Navbar;
