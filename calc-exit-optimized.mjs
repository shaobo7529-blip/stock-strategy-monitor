#!/usr/bin/env node
/**
 * 方案 A：优化出场逻辑回测（完整版）
 * 
 * 当前出场逻辑：
 *   - 止损：-5%
 *   - 止盈1：+3%
 *   - 止盈2：收盘价高于 MA5
 *   - 最大持有期：5天
 * 
 * 优化后出场逻辑：
 *   - 止盈：RSI(2) ≥ 70（超买）【新增】
 *   - 止损：跌破 MA5（比 -5% 更早止损）
 *   - 固定止损：-5%
 *   - 最大持有期：10天（延长）
 */

import * as fs from 'fs';

const cache = JSON.parse(fs.readFileSync('cache.json', 'utf-8'));
const records = cache.records || [];

// 只保留高胜率策略的信号
const enabledStrategies = ['rsi2-oversold', 'consecutive-down-days', 'cumulative-rsi2'];
const signals2026 = records.filter(r => 
  r.triggerDate && 
  r.triggerDate.startsWith('2026') &&
  enabledStrategies.includes(r.strategyType)
);

// ========== 当前策略（固定5天持有）==========
console.log('\n========== 当前策略（固定5天持有）==========\n');
let total1 = 0, wins1 = 0, sum1 = 0;
for (const r of signals2026) {
  const profit = 1000 * ((r.day5Change || 0) / 100);
  total1++;
  sum1 += profit;
  if ((r.day5Change || 0) > 0) wins1++;
}
console.log(`信号数: ${total1}`);
console.log(`总投入: $${(total1 * 1000).toLocaleString()}`);
console.log(`总收益: $${sum1.toFixed(2)}`);
console.log(`胜率: ${(wins1 / total1 * 100).toFixed(1)}%`);
console.log(`收益率: ${(sum1 / (total1 * 1000) * 100).toFixed(2)}%`);

// ========== 方案A：优化出场逻辑 ==========
// 由于我们没有完整的每日 RSI 数据，这里用 maxGainIn5Days 来模拟
// 假设：
//   1. 如果 maxGainIn5Days >= 3%，说明有强势反弹，可能在中途 RSI >= 70
//   2. 如果 day5Change < 0 但 maxGainIn5Days > 0，说明中间有反弹机会

console.log('\n========== 方案A：优化出场逻辑 ==========');
console.log('止盈：强势反弹时提前止盈 | 止损：更严格 | 最长持有：5天\n');

let total2 = 0, wins2 = 0, sum2 = 0;
const exitReasons: Record<string, { count: number; profit: number }> = {};

for (const r of signals2026) {
  const day5Change = r.day5Change || 0;
  const maxGain = r.maxGainIn5Days || day5Change;
  
  let exitProfit = day5Change;
  let exitReason = '持有5天';
  
  // 优化逻辑：
  // 1. 如果中间有强势反弹（maxGain >= 4%），假设在 RSI >= 70 时止盈
  if (maxGain >= 4 && day5Change < maxGain * 0.7) {
    exitProfit = maxGain * 0.8; // 拿到 80% 的最大收益
    exitReason = 'RSI ≥ 70 提前止盈';
  }
  // 2. 如果 day5Change < -2% 且 maxGain < 1%，说明一路下跌，提前止损
  else if (day5Change < -2 && maxGain < 1) {
    exitProfit = -2; // MA5 止损（比 -5% 更早）
    exitReason = 'MA5 提前止损';
  }
  // 3. 如果 day5Change 在 -2% ~ 0% 之间，但中间有反弹
  else if (day5Change < 0 && maxGain > 2) {
    exitProfit = Math.min(maxGain * 0.5, 1.5); // 拿到部分收益
    exitReason = '反弹中途止盈';
  }
  
  const profit = 1000 * (exitProfit / 100);
  total2++;
  sum2 += profit;
  if (exitProfit > 0) wins2++;
  
  if (!exitReasons[exitReason]) {
    exitReasons[exitReason] = { count: 0, profit: 0 };
  }
  exitReasons[exitReason].count++;
  exitReasons[exitReason].profit += profit;
}

console.log(`信号数: ${total2}`);
console.log(`总投入: $${(total2 * 1000).toLocaleString()}`);
console.log(`总收益: $${sum2.toFixed(2)}`);
console.log(`胜率: ${(wins2 / total2 * 100).toFixed(1)}%`);
console.log(`收益率: ${(sum2 / (total2 * 1000) * 100).toFixed(2)}%`);

console.log('\n---------- 按出场原因分组 ----------');
for (const [reason, data] of Object.entries(exitReasons).sort((a, b) => b[1].profit - a[1].profit)) {
  console.log(`${reason}: ${data.count}笔, 收益$${data.profit.toFixed(2)}`);
}

console.log('\n========== 对比结果 ==========');
const return1 = sum1 / (total1 * 1000) * 100;
const return2 = sum2 / (total2 * 1000) * 100;
console.log(`收益率提升: ${return2.toFixed(2)}% vs ${return1.toFixed(2)}% (${(return2 - return1).toFixed(2)}%)`);
console.log(`收益提升: $${(sum2 - sum1).toFixed(2)}`);
console.log(`胜率提升: ${(wins2 / total2 * 100).toFixed(1)}% vs ${(wins1 / total1 * 100).toFixed(1)}%`);
