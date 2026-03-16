import React from 'react';
import PageWrapper from '../components/PageWrapper';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { TrendingUp, BarChart3, Activity, PieChart } from 'lucide-react';

const data = [
  { name: 'Jan', equity: 4000, dd: 0 },
  { name: 'Feb', equity: 4200, dd: -100 },
  { name: 'Mar', equity: 3800, dd: -400 },
  { name: 'Apr', equity: 4500, dd: -100 },
  { name: 'May', equity: 5100, dd: 0 },
  { name: 'Jun', equity: 4900, dd: -200 },
  { name: 'Jul', equity: 5800, dd: 0 },
];

const Dashboard = () => {
  return (
    <PageWrapper>
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-mono text-institutional-blue mb-1 uppercase tracking-widest">Analytics Terminal</h2>
            <h1 className="text-4xl font-display font-extrabold uppercase">Session Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-mono text-slate-500 uppercase">Total P/L</div>
              <div className="text-xl font-bold text-institutional-green">+$1,800.00</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-right">
              <div className="text-xs font-mono text-slate-500 uppercase">Win Rate</div>
              <div className="text-xl font-bold text-white">68.4%</div>
            </div>
          </div>
        </div>

        {/* Chart Section */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 terminal-card p-6 h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-mono text-sm uppercase text-slate-400">Equity Growth (R-Multiple)</h3>
              <div className="flex gap-2">
                <span className="w-2 h-2 rounded-full bg-institutional-blue shadow-[0_0_8px_#475e75]" />
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#475E75" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#475E75" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="#475569" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  fontFamily="IBM Plex Mono"
                />
                <YAxis 
                  stroke="#475569" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  fontFamily="IBM Plex Mono"
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px', fontFamily: 'IBM Plex Mono' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="equity" 
                  stroke="#475E75" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#equityGradient)" 
                  animationDuration={2000}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col gap-6">
            <StatCard 
              icon={<TrendingUp className="w-4 h-4" />}
              label="Profit Factor"
              value="2.14"
              trend="+0.12"
              isPositive={true}
            />
            <StatCard 
              icon={<BarChart3 className="w-4 h-4" />}
              label="Avg R:R"
              value="1:3.2"
              trend="-0.2"
              isPositive={false}
            />
            <StatCard 
              icon={<Activity className="w-4 h-4" />}
              label="Max Drawdown"
              value="4.8%"
              trend="Stable"
              isNeutral={true}
            />
          </div>
        </div>

        {/* Recent Trades Table Concept */}
        <div className="terminal-card">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-mono text-sm uppercase text-slate-400">Execution Audit Log</h3>
            <button className="text-xs text-institutional-blue hover:underline uppercase font-mono">View Full Journal</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm font-mono">
              <thead>
                <tr className="text-slate-500 border-b border-white/5">
                  <th className="px-6 py-3 font-medium uppercase tracking-tighter">Instrument</th>
                  <th className="px-6 py-3 font-medium uppercase tracking-tighter">Setup</th>
                  <th className="px-6 py-3 font-medium uppercase tracking-tighter">Result</th>
                  <th className="px-6 py-3 font-medium uppercase tracking-tighter">R-Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <TradeRow symbol="XAUUSD" setup="Liq Sweep" result="W" r="+3.2" />
                <TradeRow symbol="EURUSD" setup="FVG Entry" result="L" r="-1.0" />
                <TradeRow symbol="BTCUSD" setup="Orderblock" result="W" r="+2.5" />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
};

const StatCard = ({ icon, label, value, trend, isPositive, isNeutral }) => (
  <div className="terminal-card p-5 flex flex-col justify-between group">
    <div className="flex items-center justify-between mb-4">
      <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-institutional-blue transition-colors">
        {icon}
      </div>
      <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
        isNeutral ? 'text-slate-500 border-slate-800' :
        isPositive ? 'text-institutional-green border-institutional-green/20 bg-institutional-green/5' : 
        'text-institutional-red border-institutional-red/20 bg-institutional-red/5'
      }`}>
        {trend}
      </div>
    </div>
    <div>
      <div className="text-xs font-mono text-slate-500 uppercase mb-1">{label}</div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
    </div>
  </div>
);

const TradeRow = ({ symbol, setup, result, r }) => (
  <tr className="hover:bg-white/5 transition-colors group">
    <td className="px-6 py-4 text-white font-bold">{symbol}</td>
    <td className="px-6 py-4 text-slate-400">{setup}</td>
    <td className="px-6 py-4">
      <span className={`px-2 py-0.5 rounded text-[10px] border ${
        result === 'W' ? 'text-institutional-green border-institutional-green/30 bg-institutional-green/5' : 'text-institutional-red border-institutional-red/30 bg-institutional-red/5'
      }`}>
        {result === 'W' ? 'SUCCESS' : 'FAILED'}
      </span>
    </td>
    <td className={`px-6 py-4 font-bold ${r.startsWith('+') ? 'text-institutional-green' : 'text-institutional-red'}`}>
      {r}R
    </td>
  </tr>
);

export default Dashboard;
