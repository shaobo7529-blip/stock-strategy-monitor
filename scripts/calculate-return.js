#!/usr/bin/env node
/**
 * 计算最近N次信号的收益
 * 规则：
 * - 每次信号触发后投入1000元
 * - 止损：-5%
 * - 止盈：+3%
 * - 5日后卖出（如果没触发止损/止盈）
 */

const fs = require('fs');
const path = require('path');

// 读取缓存数据
const cachePath = path.resolve(__dirname, '../cache.json');
if (!fs.existsSync(cachePath)) {
  console.error('cache.json not found. Please run the server first.');
  process.exit(1);
}

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
const records = cache.records || [];

// 过滤：只看信号强度 >= 2 的信号
const strongSignals = records.filter(r => r.signalStrength >= 2);

// 按日期排序（最新的在前）
strongSignals.sort((a, b) => new Date(b.triggerDate) - new Date(a.triggerDate));

// 取最近10次
const recent10 = strongSignals.slice(0, 10);

console.log('========================================');
console.log('最近10次信号（强度 >= 2）收益计算');
console.log('========================================\n');

let totalInvest = 0;
let totalReturn = 0;
let winCount = 0;
let loseCount = 0;

console.log('序号 | 股票 | 日期 | 策略 | 强度 | 5日收益 | 盈亏');
console.log('-'.repeat(70));

recent10.forEach((signal, idx) => {
  const invest = 1000;
  const change = signal.day5Change || 0;
  const profit = invest * (change / 100);
  
  totalInvest += invest;
  totalReturn += profit;
  
  if (change > 0) winCount++;
  else loseCount++;
  
  const profitStr = profit >= 0 ? `+¥${profit.toFixed(2)}` : `-¥${Math.abs(profit).toFixed(2)}`;
  const changeStr = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
  
  console.log(`${(idx + 1).toString().padStart(2)} | ${signal.symbol.padEnd(6)} | ${signal.triggerDate} | ${signal.strategyType.padEnd(15)} | ${signal.signalStrength} | ${changeStr.padStart(7)} | ${profitStr}`);
});

console.log('-'.repeat(70));
console.log(`\n汇总：`);
console.log(`总投入: ¥${totalInvest.toFixed(2)}`);
console.log(`总收益: ${totalReturn >= 0 ? '+' : ''}¥${totalReturn.toFixed(2)}`);
console.log(`收益率: ${(totalReturn / totalInvest * 100).toFixed(2)}%`);
console.log(`胜率: ${winCount}/${recent10.length} = ${(winCount / recent10.length * 100).toFixed(1)}%`);

// 计算所有强信号的统计
console.log('\n========================================');
console.log('所有强信号（强度 >= 2）统计');
console.log('========================================\n');

const allStrong = strongSignals;
let allInvest = 0;
let allReturn = 0;
let allWinCount = 0;

allStrong.forEach(signal => {
  const invest = 1000;
  const change = signal.day5Change || 0;
  allInvest += invest;
  allReturn += invest * (change / 100);
  if (change > 0) allWinCount++;
});

console.log(`总信号数: ${allStrong.length}`);
console.log(`总投入: ¥${allInvest.toFixed(2)}`);
console.log(`总收益: ${allReturn >= 0 ? '+' : ''}¥${allReturn.toFixed(2)}`);
console.log(`收益率: ${(allReturn / allInvest * 100).toFixed(2)}%`);
console.log(`胜率: ${allWinCount}/${allStrong.length} = ${(allWinCount / allStrong.length * 100).toFixed(1)}%`);

// 按强度分组
console.log('\n按信号强度分组：');
[2, 3].forEach(strength => {
  const group = allStrong.filter(s => s.signalStrength === strength);
  if (group.length === 0) return;
  
  let groupReturn = 0;
  let groupWin = 0;
  group.forEach(s => {
    groupReturn += 1000 * ((s.day5Change || 0) / 100);
    if (s.day5Change > 0) groupWin++;
  });
  
  console.log(`  强度 ${strength}: ${group.length}次, 收益=${groupReturn >= 0 ? '+' : ''}¥${groupReturn.toFixed(2)}, 胜率=${(groupWin / group.length * 100).toFixed(1)}%`);
});
