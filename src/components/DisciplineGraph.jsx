import React from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const chaoticData = [
  { day: 'D-01', value: 100 },
  { day: 'D-05', value: 92 },
  { day: 'D-10', value: 108 },
  { day: 'D-15', value: 85 },
  { day: 'D-20', value: 98 },
  { day: 'D-25', value: 72 },
  { day: 'D-30', value: 105 },
  { day: 'D-40', value: 65 },
  { day: 'D-50', value: 42 },
];

const systematicData = [
  { day: 'D-01', value: 100 },
  { day: 'D-10', value: 115 },
  { day: 'D-20', value: 132 },
  { day: 'D-30', value: 148 },
  { day: 'D-40', value: 172 },
  { day: 'D-50', value: 205 },
  { day: 'D-60', value: 248 },
];

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-v3 p-4 border border-white/10 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] font-mono text-inst-text-dim mb-2 uppercase tracking-widest">{payload[0].payload.day}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <p className="text-sm font-bold text-white">
              {entry.name}: <span style={{ color: entry.color }}>${entry.value}</span>
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const DisciplineGraph = () => {
  return (
    <div className="glass-v3 p-8 registry-border relative overflow-hidden group">
      {/* Background Glow */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-inst-indigo/5 blur-[100px] pointer-events-none" />
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 relative z-10">
        <div>
          <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 mb-2">
            DISCIPLINE ROI PROJECTION
          </h3>
          <p className="text-inst-text-dim text-sm font-mono uppercase tracking-widest">
            SIMULATION: 100 TRADES // PARAMETER: CONSISTENCY
          </p>
        </div>
        
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-inst-indigo/10 border border-inst-indigo/20">
            <div className="w-2 h-2 rounded-full bg-inst-indigo shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
            <span className="text-[10px] font-mono font-bold text-inst-indigo uppercase tracking-wider">Systematic (TCP)</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-inst-red/10 border border-inst-red/20 opacity-60">
            <div className="w-2 h-2 rounded-full bg-inst-red shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <span className="text-[10px] font-mono font-bold text-inst-red uppercase tracking-wider">Impulsive Execution</span>
          </div>
        </div>
      </div>

      <div className="h-[350px] w-full relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="rgba(255,255,255,0.03)" 
              vertical={false} 
            />
            
            <XAxis 
              dataKey="day" 
              stroke="rgba(255,255,255,0.15)" 
              fontSize={10}
              tickLine={false}
              axisLine={false}
              padding={{ left: 20, right: 20 }}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace' }}
            />
            
            <YAxis 
              stroke="rgba(255,255,255,0.15)" 
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value}`}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace' }}
            />
            
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
            
            <Line
              type="monotone"
              data={systematicData}
              dataKey="value"
              name="Systematic"
              stroke="#6366F1"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, strokeWidth: 0, fill: '#6366F1', filter: 'url(#glow)' }}
              animationDuration={2500}
              filter="url(#glow)"
            />
            
            <Line
              type="monotone"
              data={chaoticData}
              dataKey="value"
              name="Chaotic"
              stroke="#F43F5E"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#F43F5E' }}
              animationDuration={2500}
              opacity={0.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/5 relative z-10">
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-inst-text-dim uppercase tracking-widest">Equity Delta</p>
          <p className="text-xl font-bold text-inst-green">+148%</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-inst-text-dim uppercase tracking-widest">Drawdown Max</p>
          <p className="text-xl font-bold text-inst-red">-12.4%</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-inst-text-dim uppercase tracking-widest">Success Factor</p>
          <p className="text-xl font-bold text-white">2.44</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-inst-text-dim uppercase tracking-widest">Confidence Index</p>
          <p className="text-xl font-bold text-inst-cyan uppercase">Master</p>
        </div>
      </div>
    </div>
  );
};

export default DisciplineGraph;
