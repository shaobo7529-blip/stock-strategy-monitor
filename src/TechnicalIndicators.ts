// ============================================================
// 美股策略监控程序 — 技术指标计算模块
// 纯函数接口，每个指标计算函数接收 DailyPrice[] 返回计算结果或 null
// ============================================================

import type { DailyPrice, MACDResult, MACDSignal, RSIResult, RSISignal, VolumeRatioResult, VolumeRatioSignal, MAAlignmentResult, MAAlignmentSignal, KDJResult, KDJSignal, KDJZone, BollingerResult, BollingerSignal, CompositeScoreResult, ScoreBreakdown, Recommendation, Confidence } from './types.js';

// --- 辅助函数 ---

/** 将数值四舍五入到两位小数 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 计算指数移动平均线（EMA）序列
 * @param values - 输入数值数组
 * @param period - EMA 周期
 * @returns EMA 值数组，长度与输入相同
 */
function calculateEMASeries(values: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // 第一个 EMA 值使用前 period 个值的简单平均
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  emaValues[period - 1] = sum / period;

  // 后续使用 EMA 公式: EMA_today = price * multiplier + EMA_yesterday * (1 - multiplier)
  for (let i = period; i < values.length; i++) {
    emaValues[i] = values[i] * multiplier + emaValues[i - 1] * (1 - multiplier);
  }

  return emaValues;
}

// --- MACD 计算 ---

/**
 * 计算 MACD 指标
 * 参数: EMA(12), EMA(26), 信号线 EMA(9)
 * DIF = EMA(12) - EMA(26)
 * DEA = EMA(9) of DIF
 * MACD 柱状图 = (DIF - DEA) * 2
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns MACD 计算结果，数据不足 35 条时返回 null
 */
export function calculateMACD(prices: DailyPrice[]): MACDResult | null {
  // 需要至少 35 条数据：26 日 EMA 需要 26 条，之后 DIF 序列需要 9 条计算 DEA
  if (prices.length < 35) {
    return null;
  }

  const closePrices = prices.map(p => p.close);

  // 计算 EMA(12) 和 EMA(26)
  const ema12Series = calculateEMASeries(closePrices, 12);
  const ema26Series = calculateEMASeries(closePrices, 26);

  // 计算 DIF 序列（从第 26 个数据点开始，即 index 25）
  const difValues: number[] = [];
  const difStartIndex = 25; // EMA(26) 从 index 25 开始有值
  for (let i = difStartIndex; i < closePrices.length; i++) {
    difValues.push(ema12Series[i] - ema26Series[i]);
  }

  // 计算 DEA = EMA(9) of DIF
  if (difValues.length < 9) {
    return null;
  }
  const deaSeries = calculateEMASeries(difValues, 9);

  // 取最后一个和倒数第二个值用于信号判断
  const lastIdx = difValues.length - 1;
  const prevIdx = lastIdx - 1;

  if (prevIdx < 8) {
    // 需要至少两个有效的 DEA 值来判断信号
    return null;
  }

  const currentDIF = difValues[lastIdx];
  const currentDEA = deaSeries[lastIdx];
  const currentMACD = (currentDIF - currentDEA) * 2;

  const prevDIF = difValues[prevIdx];
  const prevDEA = deaSeries[prevIdx];

  // 信号判断
  let signal: MACDSignal;
  if (currentDIF >= currentDEA && prevDIF < prevDEA) {
    signal = 'golden_cross';
  } else if (currentDIF <= currentDEA && prevDIF > prevDEA) {
    signal = 'death_cross';
  } else {
    const currentMACDValue = (currentDIF - currentDEA) * 2;
    const prevMACDValue = (prevDIF - prevDEA) * 2;
    if (Math.abs(currentMACDValue) > Math.abs(prevMACDValue)) {
      signal = 'histogram_expanding';
    } else {
      signal = 'histogram_shrinking';
    }
  }

  return {
    dif: round2(currentDIF),
    dea: round2(currentDEA),
    macd: round2(currentMACD),
    signal,
  };
}

// --- RSI 计算 ---

/**
 * 计算 RSI（相对强弱指标）
 * 使用 14 日周期，Wilder 平滑法
 * - 初始平均值为前 14 个变化的简单平均
 * - 后续使用 prev_avg * 13/14 + current / 14
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns RSI 计算结果，数据不足 15 条时返回 null
 */
export function calculateRSI(prices: DailyPrice[]): RSIResult | null {
  const period = 14;

  // 需要至少 15 条数据：14 个价格变化需要 15 个价格点
  if (prices.length < period + 1) {
    return null;
  }

  const closePrices = prices.map(p => p.close);

  // 步骤 1: 计算每日价格变化
  const changes: number[] = [];
  for (let i = 1; i < closePrices.length; i++) {
    changes.push(closePrices[i] - closePrices[i - 1]);
  }

  // 步骤 2: 分离涨幅和跌幅
  const gains: number[] = changes.map(c => (c > 0 ? c : 0));
  const losses: number[] = changes.map(c => (c < 0 ? Math.abs(c) : 0));

  // 步骤 3: 计算初始平均涨幅和平均跌幅（前 14 个变化的简单平均）
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // 步骤 4: 使用 Wilder 平滑法计算后续平均值
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1)) / period + gains[i] / period;
    avgLoss = (avgLoss * (period - 1)) / period + losses[i] / period;
  }

  // 步骤 5: 计算 RSI
  let rsi: number;
  if (avgLoss === 0) {
    // 没有任何下跌，RSI = 100（如果 avgGain 也为 0，则 RSI = 0 表示无变化）
    rsi = avgGain === 0 ? 0 : 100;
  } else if (avgGain === 0) {
    rsi = 0;
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  // 步骤 6: 确定信号
  let signal: RSISignal;
  const roundedRSI = round2(rsi);
  if (roundedRSI > 70) {
    signal = 'overbought';
  } else if (roundedRSI < 30) {
    signal = 'oversold';
  } else {
    signal = 'neutral';
  }

  return {
    value: roundedRSI,
    signal,
  };
}


// --- 量比计算 ---

/**
 * 计算量比（Volume Ratio）
 * 量比 = 当日成交量 / 最近 5 个交易日的平均成交量
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns 量比计算结果，数据不足 6 条时返回 null，5 日平均成交量为 0 时返回 null
 */
export function calculateVolumeRatio(prices: DailyPrice[]): VolumeRatioResult | null {
  // 需要至少 6 条数据：当日 + 前 5 个交易日
  if (prices.length < 6) {
    return null;
  }

  const length = prices.length;

  // 计算前 5 个交易日的平均成交量（prices[length-6] 到 prices[length-2]）
  let volumeSum = 0;
  for (let i = length - 6; i <= length - 2; i++) {
    volumeSum += prices[i].volume;
  }
  const avgVolume5 = volumeSum / 5;

  // 除零保护：5 日平均成交量为 0 时返回 null
  if (avgVolume5 === 0) {
    return null;
  }

  // 量比 = 当日成交量 / 5 日平均成交量
  const currentVolume = prices[length - 1].volume;
  const ratio = round2(currentVolume / avgVolume5);

  // 信号判断
  let signal: VolumeRatioSignal;
  if (ratio > 1.5) {
    signal = 'high_volume';
  } else if (ratio < 0.7) {
    signal = 'low_volume';
  } else {
    signal = 'normal_volume';
  }

  return {
    value: ratio,
    signal,
  };
}


// --- 均线排列计算 ---

/**
 * 计算均线排列（MA Alignment）
 * 计算 MA5、MA20、MA50 简单移动平均线，判断排列状态，
 * 并计算当前价格相对各均线的偏离百分比。
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns 均线排列计算结果，数据不足 50 条时返回 null
 */
export function calculateMAAlignment(prices: DailyPrice[]): MAAlignmentResult | null {
  // 需要至少 50 条数据来计算 MA50
  if (prices.length < 50) {
    return null;
  }

  const closePrices = prices.map(p => p.close);
  const length = closePrices.length;

  // 计算 MA5：最近 5 个收盘价的算术平均值
  let sum5 = 0;
  for (let i = length - 5; i < length; i++) {
    sum5 += closePrices[i];
  }
  const ma5 = sum5 / 5;

  // 计算 MA20：最近 20 个收盘价的算术平均值
  let sum20 = 0;
  for (let i = length - 20; i < length; i++) {
    sum20 += closePrices[i];
  }
  const ma20 = sum20 / 20;

  // 计算 MA50：最近 50 个收盘价的算术平均值
  let sum50 = 0;
  for (let i = length - 50; i < length; i++) {
    sum50 += closePrices[i];
  }
  const ma50 = sum50 / 50;

  // 当前价格 = 最后一个收盘价
  const currentPrice = closePrices[length - 1];

  // 信号判断
  let signal: MAAlignmentSignal;
  if (ma5 > ma20 && ma20 > ma50) {
    signal = 'bullish';
  } else if (ma5 < ma20 && ma20 < ma50) {
    signal = 'bearish';
  } else {
    signal = 'tangled';
  }

  // 计算偏离百分比：(currentPrice - MA) / MA * 100，保留两位小数
  const deviations = {
    ma5: round2((currentPrice - ma5) / ma5 * 100),
    ma20: round2((currentPrice - ma20) / ma20 * 100),
    ma50: round2((currentPrice - ma50) / ma50 * 100),
  };

  return {
    ma5: round2(ma5),
    ma20: round2(ma20),
    ma50: round2(ma50),
    signal,
    deviations,
  };
}


// --- KDJ 计算 ---

/**
 * 计算 KDJ 随机指标
 * 参数: (9,3,3) — 9 日 RSV 窗口，K 和 D 使用 3 日平滑
 * RSV = (Close - Low9) / (High9 - Low9) × 100
 * K = K_prev * 2/3 + RSV * 1/3（初始 K = 50）
 * D = D_prev * 2/3 + K * 1/3（初始 D = 50）
 * J = 3K - 2D
 * K 和 D 限制在 [0, 100] 范围内
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns KDJ 计算结果，数据不足 12 条时返回 null
 */
export function calculateKDJ(prices: DailyPrice[]): KDJResult | null {
  // 需要至少 12 条数据：9 日 RSV 窗口 + 3 日 K/D 平滑
  if (prices.length < 12) {
    return null;
  }

  const period = 9;

  // 步骤 1: 从 index 8（第 9 个数据点）开始计算 RSV 序列
  const rsvValues: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    // 计算 9 日内最高价和最低价
    let high9 = -Infinity;
    let low9 = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (prices[j].high > high9) high9 = prices[j].high;
      if (prices[j].low < low9) low9 = prices[j].low;
    }

    // RSV 计算，除零保护：High9 = Low9 时 RSV = 50
    let rsv: number;
    if (high9 === low9) {
      rsv = 50;
    } else {
      rsv = ((prices[i].close - low9) / (high9 - low9)) * 100;
    }
    rsvValues.push(rsv);
  }

  // 步骤 2: 使用 3 日平滑计算 K 和 D 序列
  // 初始值 K[0] = 50, D[0] = 50
  const kValues: number[] = [];
  const dValues: number[] = [];

  let k = 50; // 初始 K 值
  let d = 50; // 初始 D 值

  for (let i = 0; i < rsvValues.length; i++) {
    // K = K_prev * 2/3 + RSV * 1/3
    k = k * 2 / 3 + rsvValues[i] * 1 / 3;
    // 限制 K 在 [0, 100]
    k = Math.max(0, Math.min(100, k));

    // D = D_prev * 2/3 + K * 1/3
    d = d * 2 / 3 + k * 1 / 3;
    // 限制 D 在 [0, 100]
    d = Math.max(0, Math.min(100, d));

    kValues.push(k);
    dValues.push(d);
  }

  // 步骤 3: 取最后一个和倒数第二个值用于信号判断
  const lastIdx = kValues.length - 1;
  const prevIdx = lastIdx - 1;

  if (prevIdx < 0) {
    // 需要至少两个 K/D 值来判断信号
    return null;
  }

  const currentK = kValues[lastIdx];
  const currentD = dValues[lastIdx];
  const prevK = kValues[prevIdx];
  const prevD = dValues[prevIdx];

  // J = 3K - 2D（可超出 0-100 范围）
  const j = 3 * currentK - 2 * currentD;

  // 步骤 4: 信号判断
  let signal: KDJSignal;
  if (currentK >= currentD && prevK < prevD) {
    signal = 'golden_cross';
  } else if (currentK <= currentD && prevK > prevD) {
    signal = 'death_cross';
  } else {
    signal = 'neutral';
  }

  // 步骤 5: 区域标记
  let zone: KDJZone;
  if (currentK > 80 && currentD > 80) {
    zone = 'overbought';
  } else if (currentK < 20 && currentD < 20) {
    zone = 'oversold';
  } else {
    zone = null;
  }

  return {
    k: round2(currentK),
    d: round2(currentD),
    j: round2(j),
    signal,
    zone,
  };
}


// --- 布林带计算 ---

/**
 * 计算布林带（Bollinger Bands）
 * 参数: (20, 2) — 20 日移动平均线，2 倍标准差
 * 中轨 = MA20（最近 20 个收盘价的算术平均值）
 * 上轨 = 中轨 + 2 × 标准差
 * 下轨 = 中轨 - 2 × 标准差
 * percentB = (price - lower) / (upper - lower) × 100
 * bandwidth = (upper - lower) / middle × 100
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns 布林带计算结果，数据不足 20 条时返回 null
 */
export function calculateBollinger(prices: DailyPrice[]): BollingerResult | null {
  const period = 20;
  const multiplier = 2;

  // 需要至少 20 条数据
  if (prices.length < period) {
    return null;
  }

  const closePrices = prices.map(p => p.close);
  const length = closePrices.length;

  // 步骤 1: 计算中轨 = MA20（最近 20 个收盘价的算术平均值）
  let sum = 0;
  for (let i = length - period; i < length; i++) {
    sum += closePrices[i];
  }
  const middle = sum / period;

  // 步骤 2: 计算标准差 = sqrt(sum((close[i] - middle)^2) / 20)
  let squaredDiffSum = 0;
  for (let i = length - period; i < length; i++) {
    const diff = closePrices[i] - middle;
    squaredDiffSum += diff * diff;
  }
  const stddev = Math.sqrt(squaredDiffSum / period);

  // 步骤 3: 计算上轨和下轨
  let upper: number;
  let lower: number;
  let percentB: number;
  let bandwidth: number;

  if (stddev === 0) {
    // 标准差为 0 时：上轨 = 中轨 = 下轨，percentB = 50，bandwidth = 0
    upper = middle;
    lower = middle;
    percentB = 50;
    bandwidth = 0;
  } else {
    upper = middle + multiplier * stddev;
    lower = middle - multiplier * stddev;
    // percentB = (price - lower) / (upper - lower) × 100
    const currentPrice = closePrices[length - 1];
    percentB = ((currentPrice - lower) / (upper - lower)) * 100;
    // bandwidth = (upper - lower) / middle × 100
    bandwidth = ((upper - lower) / middle) * 100;
  }

  // 步骤 4: 信号判断（使用当前收盘价与上下轨比较）
  const currentPrice = closePrices[length - 1];
  let signal: BollingerSignal;
  if (currentPrice > upper) {
    signal = 'above_upper';
  } else if (currentPrice < lower) {
    signal = 'below_lower';
  } else {
    signal = 'within_band';
  }

  return {
    upper: round2(upper),
    middle: round2(middle),
    lower: round2(lower),
    bandwidth: round2(bandwidth),
    signal,
    percentB: round2(percentB),
  };
}


// --- 综合评分计算 ---

/**
 * 计算单个 MACD 指标的评分贡献
 * - golden_cross → +17
 * - death_cross → -17
 * - histogram_expanding: DIF > 0 → +17, DIF < 0 → -17, DIF = 0 → 0
 * - histogram_shrinking: DIF > 0 → -17, DIF < 0 → +17, DIF = 0 → 0
 */
function scoreMacd(result: MACDResult): number {
  switch (result.signal) {
    case 'golden_cross':
      return 17;
    case 'death_cross':
      return -17;
    case 'histogram_expanding':
      if (result.dif > 0) return 17;
      if (result.dif < 0) return -17;
      return 0;
    case 'histogram_shrinking':
      if (result.dif > 0) return -17;
      if (result.dif < 0) return 17;
      return 0;
  }
}

/**
 * 计算单个 RSI 指标的评分贡献
 * - oversold (<30) → +17 (均值回归看多)
 * - overbought (>70) → -17
 * - neutral → 0
 */
function scoreRsi(result: RSIResult): number {
  switch (result.signal) {
    case 'oversold':
      return 17;
    case 'overbought':
      return -17;
    case 'neutral':
      return 0;
  }
}

/**
 * 计算量比指标的评分贡献（权重较低 ±8）
 * - high_volume (>1.5) → +8
 * - low_volume (<0.7) → -8
 * - normal_volume → 0
 */
function scoreVolumeRatio(result: VolumeRatioResult): number {
  switch (result.signal) {
    case 'high_volume':
      return 8;
    case 'low_volume':
      return -8;
    case 'normal_volume':
      return 0;
  }
}

/**
 * 计算均线排列指标的评分贡献
 * - bullish → +17
 * - bearish → -17
 * - tangled → 0
 */
function scoreMaAlignment(result: MAAlignmentResult): number {
  switch (result.signal) {
    case 'bullish':
      return 17;
    case 'bearish':
      return -17;
    case 'tangled':
      return 0;
  }
}

/**
 * 计算 KDJ 指标的评分贡献
 * - golden_cross OR oversold zone → +17
 * - death_cross OR overbought zone → -17
 * - neutral with no zone → 0
 */
function scoreKdj(result: KDJResult): number {
  if (result.signal === 'golden_cross' || result.zone === 'oversold') {
    return 17;
  }
  if (result.signal === 'death_cross' || result.zone === 'overbought') {
    return -17;
  }
  return 0;
}

/**
 * 计算布林带指标的评分贡献
 * - below_lower → +17 (均值回归看多)
 * - above_upper → -17
 * - within_band → 按 percentB 线性映射: score = round(17 * (1 - 2 * percentB / 100))
 *   percentB=0 (下轨) → +17, percentB=100 (上轨) → -17
 */
function scoreBollinger(result: BollingerResult): number {
  switch (result.signal) {
    case 'below_lower':
      return 17;
    case 'above_upper':
      return -17;
    case 'within_band':
      return Math.round(17 * (1 - 2 * result.percentB / 100));
  }
}

/**
 * 计算综合评分
 * 基于六项技术指标的信号计算综合评分，评分范围 [-100, +100]。
 * 各指标信号映射为分值（MACD/RSI/均线/KDJ/布林带 ±17，量比 ±8）。
 * null 指标贡献 0 分。
 *
 * @param indicators - 六项指标结果，每项可为结果或 null
 * @returns 综合评分结果，包含评分、建议、置信度和各指标贡献明细
 */
export function calculateCompositeScore(indicators: {
  macd: MACDResult | null;
  rsi: RSIResult | null;
  volumeRatio: VolumeRatioResult | null;
  maAlignment: MAAlignmentResult | null;
  kdj: KDJResult | null;
  bollinger: BollingerResult | null;
}): CompositeScoreResult {
  // 计算各指标贡献分值
  const breakdown: ScoreBreakdown = {
    macd: indicators.macd ? scoreMacd(indicators.macd) : 0,
    rsi: indicators.rsi ? scoreRsi(indicators.rsi) : 0,
    volumeRatio: indicators.volumeRatio ? scoreVolumeRatio(indicators.volumeRatio) : 0,
    maAlignment: indicators.maAlignment ? scoreMaAlignment(indicators.maAlignment) : 0,
    kdj: indicators.kdj ? scoreKdj(indicators.kdj) : 0,
    bollinger: indicators.bollinger ? scoreBollinger(indicators.bollinger) : 0,
  };

  // 总评分 = 各指标贡献之和，限制在 [-100, +100]
  const rawScore = breakdown.macd + breakdown.rsi + breakdown.volumeRatio
    + breakdown.maAlignment + breakdown.kdj + breakdown.bollinger;
  const score = Math.max(-100, Math.min(100, rawScore));

  // 建议判定
  let recommendation: Recommendation;
  if (score > 30) {
    recommendation = 'bullish';
  } else if (score < -30) {
    recommendation = 'bearish';
  } else {
    recommendation = 'neutral';
  }

  // 置信度判定
  const absScore = Math.abs(score);
  let confidence: Confidence;
  if (absScore > 60) {
    confidence = 'strong';
  } else if (absScore >= 30) {
    confidence = 'medium';
  } else {
    confidence = 'weak';
  }

  return {
    score,
    recommendation,
    confidence,
    breakdown,
  };
}
