import fs from 'fs';

const cache = JSON.parse(fs.readFileSync('cache.json', 'utf-8'));
const records = cache.records || [];

// 按强度分组统计
const byStrength = { 1: [], 2: [], 3: [] };

records.forEach(r => {
  if (r.signalStrength && r.day5Change !== undefined) {
    byStrength[r.signalStrength]?.push(r);
  }
});

console.log('\n========== 按信号强度统计 ==========\n');

for (let s = 1; s <= 3; s++) {
  const arr = byStrength[s];
  if (arr.length === 0) continue;
  
  let wins = 0;
  let totalProfit = 0;
  arr.forEach(r => {
    if (r.day5Change > 0) wins++;
    totalProfit += 1000 * (r.day5Change / 100);
  });
  
  const winRate = (wins / arr.length * 100).toFixed(1);
  const avgProfit = (totalProfit / arr.length).toFixed(2);
  
  console.log(`强度 ${s}:`);
  console.log(`  信号数: ${arr.length}`);
  console.log(`  胜率: ${winRate}%`);
  console.log(`  总收益: ${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)}`);
  console.log(`  平均每笔: ${avgProfit}元\n`);
}

// 强度>=2 和 强度=3 的对比
const strong2 = [...byStrength[2], ...byStrength[3]];
const strong3 = byStrength[3];

console.log('========== 当前策略（强度>=2）==========');
let w2 = 0, p2 = 0;
strong2.forEach(r => { if (r.day5Change > 0) w2++; p2 += 1000 * (r.day5Change / 100); });
console.log(`信号数: ${strong2.length}, 胜率: ${(w2/strong2.length*100).toFixed(1)}%, 总收益: +¥${p2.toFixed(2)}\n`);

console.log('========== 更严格策略（强度=3）==========');
if (strong3.length > 0) {
  let w3 = 0, p3 = 0;
  strong3.forEach(r => { if (r.day5Change > 0) w3++; p3 += 1000 * (r.day5Change / 100); });
  console.log(`信号数: ${strong3.length}, 胜率: ${(w3/strong3.length*100).toFixed(1)}%, 总收益: +¥${p3.toFixed(2)}\n`);
}
