import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
const agent = new HttpsProxyAgent('http://127.0.0.1:7897');
const res = await fetch('http://16.162.118.35/api/monitor', { agent });
const data = await res.json();
const records = data.records || [];
const completed = records.filter(r => r.status === 'completed' && r.nextDayChange != null);

const strategies = {};
completed.forEach(r => {
  if (!strategies[r.strategyType]) strategies[r.strategyType] = { wins: 0, total: 0, sumNext: 0, sum5d: 0, w5d: 0, t5d: 0, byStr: {} };
  const s = strategies[r.strategyType];
  s.total++; s.sumNext += r.nextDayChange;
  if (r.nextDayChange > 0) s.wins++;
  if (r.maxGainIn5Days != null) { s.t5d++; s.sum5d += r.maxGainIn5Days; if (r.maxGainIn5Days > 0) s.w5d++; }
  const str = r.signalStrength || 0;
  if (!s.byStr[str]) s.byStr[str] = { wins: 0, total: 0, sumNext: 0 };
  s.byStr[str].total++; s.byStr[str].sumNext += r.nextDayChange;
  if (r.nextDayChange > 0) s.byStr[str].wins++;
});

const stocks = {};
completed.forEach(r => {
  if (!stocks[r.symbol]) stocks[r.symbol] = { wins: 0, total: 0, sumNext: 0 };
  stocks[r.symbol].total++; stocks[r.symbol].sumNext += r.nextDayChange;
  if (r.nextDayChange > 0) stocks[r.symbol].wins++;
});

console.log(`=== 总览 ===`);
console.log(`总记录: ${records.length} | 已完成: ${completed.length}`);
console.log(`\n=== 按策略(胜率排序) ===`);
Object.entries(strategies).sort((a,b) => (b[1].wins/b[1].total) - (a[1].wins/a[1].total)).forEach(([name, s]) => {
  console.log(`${name}: ${s.total}次 | 次日胜率${(s.wins/s.total*100).toFixed(1)}% | 均值${(s.sumNext/s.total).toFixed(2)}% | 5日胜率${s.t5d>0?(s.w5d/s.t5d*100).toFixed(1):'N/A'}% | 5日均值${s.t5d>0?(s.sum5d/s.t5d).toFixed(2):'N/A'}%`);
  Object.entries(s.byStr).sort((a,b)=>b[0]-a[0]).forEach(([str, d]) => {
    console.log(`  强度${str}: ${d.total}次 | 胜率${(d.wins/d.total*100).toFixed(1)}% | 均值${(d.sumNext/d.total).toFixed(2)}%`);
  });
});

console.log(`\n=== 按股票(胜率排序, >=5次) ===`);
Object.entries(stocks).filter(([,s])=>s.total>=5).sort((a,b) => (b[1].wins/b[1].total) - (a[1].wins/a[1].total)).forEach(([sym, s]) => {
  console.log(`${sym}: ${s.total}次 | 胜率${(s.wins/s.total*100).toFixed(1)}% | 均值${(s.sumNext/s.total).toFixed(2)}%`);
});
