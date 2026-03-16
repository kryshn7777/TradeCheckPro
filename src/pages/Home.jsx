import React, { Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { 
  CheckCircle2, 
  ArrowRight,
  Shield,
  Zap,
  BarChart3,
  Search, 
  Terminal, 
  Cpu, 
  Activity, 
  Lock 
} from 'lucide-react';
import Magnetic from '../components/Magnetic';

// Lazy load components for performance
const HoloHero = lazy(() => import('../components/HoloHero'));
const HoloAudit = lazy(() => import('../components/HoloAudit'));
const MonolithPricing = lazy(() => import('../components/MonolithPricing'));
const NarrativeSection = lazy(() => import('../components/NarrativeSection'));
const HolographicBackground = lazy(() => import('../components/HolographicBackground'));

const LoadingFallback = () => (
  <div className="h-[400px] w-full flex items-center justify-center font-mono text-[10px] text-holo-accent uppercase tracking-[0.5em] animate-pulse">
    SYST_DECODER: LOADING_MODULE...
  </div>
);

const Home = () => {
  return (
    <main className="relative min-h-screen bg-holo-bg text-white selection:bg-holo-accent selection:text-holo-bg overflow-x-hidden">
      {/* Heavy background deferred */}
      <Suspense fallback={null}>
        <HolographicBackground />
      </Suspense>

      <div className="relative z-10">
        <Suspense fallback={<LoadingFallback />}>
          <HoloHero />
        </Suspense>

        {/* Narrative Reveal: The Forensic Layer */}
        <Suspense fallback={<LoadingFallback />}>
          <NarrativeSection
            subtitle="PROTOCOL_01 // THE FORENSIC LAYER"
            title={<>BEYOND <span className="inst-text-gradient">JOURNALING.</span></>}
            bgText="FORENSIC"
          >
            Generic journals record history. TradeCheckPro audits biology. 
            Our proprietary Reconciliation Engine isolates the exact timestamp where emotion override began, 
            allowing you to correct behavior with surgical precision.
          </NarrativeSection>
        </Suspense>

        {/* Holographic Audit Visualization */}
        <Suspense fallback={<LoadingFallback />}>
          <HoloAudit />
        </Suspense>

        {/* Narrative Reveal: Transparency */}
        <Suspense fallback={<LoadingFallback />}>
          <NarrativeSection
            subtitle="PROTOCOL_02 // SYSTEMATIC FIDELITY"
            title={<>ELIMINATE <span className="inst-text-gradient">DRIFT.</span></>}
            bgText="FIDELITY"
            reversed
          >
            Identify leaked alpha in real-time. We scan for deviations from your prescribed trade plan 
            and alert you before minor slips become catastrophic drawdowns.
          </NarrativeSection>
        </Suspense>

        {/* Module Showcase */}
        <section className="py-24 px-6 max-w-7xl mx-auto relative">
           <div className="text-center mb-24">
              <h2 className="text-4xl md:text-6xl font-black uppercase mb-4 tracking-tighter">PROTOCOL_MODULES.</h2>
              <p className="text-white/40 font-mono text-[10px] tracking-[0.5em]">SYSTEM_VERSION_4.2.0</p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              {[
                {
                  icon: Zap,
                  title: "ZEN BUFFER",
                  desc: "Suppresses emotional feedback during active execution. Focus on the setup, not the P&L.",
                  status: "ACTIVE"
                },
                {
                  icon: Shield,
                  title: "RISK HARD-STOP",
                  desc: "Account-level hardware enforcement of drawdown limits. Impossible to override.",
                  status: "SECURED"
                },
                {
                  icon: BarChart3,
                  title: "AUDIT FORENSICS",
                  desc: "Deep-dive analysis of execution quality linked to ATR and technical volatility.",
                  status: "READY"
                }
              ].map((module, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  viewport={{ once: true }}
                  className="glass-holo p-10 relative overflow-hidden group border-white/5 hover:border-holo-accent/30 transition-colors"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-30 transition-opacity">
                     <module.icon className="w-16 h-16 text-holo-accent" />
                  </div>
                  <div className="flex items-center gap-3 mb-8">
                     <div className="w-1.5 h-1.5 bg-holo-accent rounded-full shadow-[0_0_10px_#06F9F9] animate-pulse" />
                     <span className="font-mono text-[8px] text-holo-accent tracking-widest">{module.status}</span>
                  </div>
                  <h3 className="text-2xl font-black mb-6 uppercase tracking-tight">{module.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-10 h-20">
                    {module.desc}
                  </p>
                  <div className="flex items-center gap-2 text-white/30 text-[9px] font-mono group-hover:text-white transition-colors cursor-pointer">
                     INITIALIZE_MODULE <ArrowRight className="w-3 h-3" />
                  </div>
                  <div className="scanline-holo opacity-0 group-hover:opacity-10" />
                </motion.div>
              ))}
           </div>
        </section>

        {/* Monolith Pricing */}
        <Suspense fallback={<LoadingFallback />}>
          <MonolithPricing />
        </Suspense>

        {/* Final Deployment Footer-CTA */}
        <section className="py-60 px-6 text-center relative overflow-hidden">
           <motion.div
             initial={{ opacity: 0, scale: 0.9 }}
             whileInView={{ opacity: 1, scale: 1 }}
             transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
             viewport={{ once: true }}
             className="relative z-10 space-y-12"
           >
              <h2 className="text-7xl md:text-[12vw] font-black font-display tracking-tighter uppercase leading-none italic">
                 ESTABLISH <br />
                 <span className="inst-text-gradient holo-glow-text">DOMINANCE.</span>
              </h2>
              <Magnetic strength={0.4}>
                 <button className="px-20 py-10 bg-white text-holo-bg font-black text-2xl rounded-sm hover:bg-holo-accent hover:text-holo-bg transition-all active:scale-95 shadow-[0_40px_100px_rgba(255,255,255,0.15)] uppercase tracking-[0.2em]">
                    DOWNLOAD_TCP_PRO
                 </button>
              </Magnetic>
           </motion.div>
           
           {/* Distant Grid Line */}
           <div className="absolute bottom-40 left-0 w-full h-px bg-gradient-to-r from-transparent via-holo-accent/30 to-transparent shadow-[0_0_20px_#06F9F9/20]" />
        </section>
      </div>
    </main>
  );
};

export default Home;
