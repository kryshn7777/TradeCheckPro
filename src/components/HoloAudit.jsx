import React, { useMemo, useState, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const systematicData = [
  { day: '01', val: 1000 },
  { day: '05', val: 1120 },
  { day: '10', val: 1080 },
  { day: '15', val: 1250 },
  { day: '20', val: 1380 },
  { day: '25', val: 1320 },
  { day: '30', val: 1550 },
];

const chaoticData = [
  { day: '01', val: 1000 },
  { day: '05', val: 950 },
  { day: '10', val: 1050 },
  { day: '15', val: 820 },
  { day: '20', val: 910 },
  { day: '25', val: 680 },
  { day: '30', val: 740 },
];

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-holo p-4 border-holo-accent/30 scale-110">
        <p className="text-[9px] font-mono text-holo-accent mb-2">T_INDEX: {payload[0].payload.time}</p>
        <p className="text-sm font-black text-white">$ {payload[0].value}</p>
      </div>
    );
  }
  return null;
};

const HoloAudit = memo(() => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const data = useMemo(() => {
    return systematicData.map((sysItem, index) => ({
      time: sysItem.day,
      value: sysItem.val,
      baseline: chaoticData[index].val,
    }));
  }, []);

  return (
    <div className="perspective-center py-20 relative px-6 overflow-hidden">
      {/* Background Data Streaks */}
      <div className="absolute top-0 left-10 h-full overflow-hidden pointer-events-none opacity-20 hidden lg:block">
        <div className="data-stream font-mono text-[8px] whitespace-pre text-holo-accent leading-relaxed">
          {`AUDIT_LOG_0XFF12A\nPROC_SYNC: SUCCESS\nLATENCY: 0.002MS\nTHREAT_LEVEL: ZERO\nNET_GAINS: 142%\nDRAWDN: 1.2%\nAUDIT_LOG_0XFF12A\nPROC_SYNC: SUCCESS\nLATENCY: 0.002MS\nTHREAT_LEVEL: ZERO\nNET_GAINS: 142%\nDRAWDN: 1.2%\n`.repeat(10)}
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, rotateY: 20, rotateX: 10 }}
        whileInView={{ opacity: 1, rotateY: -15, rotateX: 5 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
        viewport={{ once: true }}
        className="glass-holo p-8 md:p-12 holo-card-3d max-w-5xl mx-auto border-holo-accent/30 relative"
      >
        <div className="scanline-holo rounded-xl overflow-hidden" />
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 relative z-20">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-holo-accent animate-pulse shadow-[0_0_10px_#06F9F9]" />
              <h3 className="text-2xl font-black tracking-tighter holo-glow-text uppercase">Holographic Audit V4</h3>
            </div>
            <p className="text-[10px] font-mono text-white/40 uppercase tracking-[0.3em]">RECONCILIATION_ENGINE // SIM_ID: 992288</p>
          </div>
          
          <div className="flex gap-4">
             <div className="px-4 py-2 border border-holo-accent/20 bg-holo-accent/5 rounded-sm">
                <p className="text-[8px] font-mono text-holo-accent opacity-50 mb-1 font-bold">PROT_ADHERENCE</p>
                <p className="text-lg font-bold font-mono text-holo-accent">99.8%</p>
             </div>
             <div className="px-4 py-2 border border-white/10 bg-white/5 rounded-sm">
                <p className="text-[8px] font-mono text-white/40 mb-1 font-bold">LEAKAGE_DETECTED</p>
                <p className="text-lg font-bold font-mono text-red-500">0.02%</p>
             </div>
          </div>
        </div>

        <div className="h-[400px] w-full relative z-10">
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <defs>
                  <filter id="holoGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  hide 
                />
                <YAxis 
                  hide 
                  domain={['dataMin - 100', 'dataMax + 100']} 
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#06F9F9', strokeWidth: 1, strokeDasharray: '5 5' }} />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#06F9F9" 
                  strokeWidth={3} 
                  dot={{ r: 0 }}
                  activeDot={{ 
                    r: 6, 
                    stroke: '#06F9F9', 
                    strokeWidth: 2, 
                    fill: '#05080F',
                    filter: 'url(#holoGlow)'
                  }}
                  animationDuration={2500}
                />
                <Line 
                  type="monotone" 
                  dataKey="baseline" 
                  stroke="#ffffff10" 
                  strokeWidth={1} 
                  strokeDasharray="5 5"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-8 relative z-20">
           {[
             { label: "ENGINE_LATENCY", val: "0.002ms" },
             { label: "SYNC_STATUS", val: "ESTABLISHED" },
             { label: "CORE_TEMPERATURE", val: "32°C" },
             { label: "VERSION_NODE", val: "V4.PRO" }
           ].map((stat, i) => (
             <div key={i} className="space-y-2">
                <p className="text-[8px] font-mono text-white/30 tracking-widest uppercase">{stat.label}</p>
                <p className="text-sm font-black font-mono text-white/80">{stat.val}</p>
                <div className="w-full h-[1px] bg-white/5" />
             </div>
           ))}
        </div>
      </motion.div>
    </div>
  );
});

export default HoloAudit;
