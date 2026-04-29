import type { DailyPrice, MACDResult, RSIResult, VolumeRatioResult, MAAlignmentResult, KDJResult, BollingerResult, CompositeScoreResult } from './types.js';
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
export declare function calculateMACD(prices: DailyPrice[]): MACDResult | null;
/**
 * 计算 RSI（相对强弱指标）
 * 使用 14 日周期，Wilder 平滑法
 * - 初始平均值为前 14 个变化的简单平均
 * - 后续使用 prev_avg * 13/14 + current / 14
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns RSI 计算结果，数据不足 15 条时返回 null
 */
export declare function calculateRSI(prices: DailyPrice[]): RSIResult | null;
/**
 * 计算量比（Volume Ratio）
 * 量比 = 当日成交量 / 最近 5 个交易日的平均成交量
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns 量比计算结果，数据不足 6 条时返回 null，5 日平均成交量为 0 时返回 null
 */
export declare function calculateVolumeRatio(prices: DailyPrice[]): VolumeRatioResult | null;
/**
 * 计算均线排列（MA Alignment）
 * 计算 MA5、MA20、MA50 简单移动平均线，判断排列状态，
 * 并计算当前价格相对各均线的偏离百分比。
 *
 * @param prices - 每日价格数据数组（按日期升序排列）
 * @returns 均线排列计算结果，数据不足 50 条时返回 null
 */
export declare function calculateMAAlignment(prices: DailyPrice[]): MAAlignmentResult | null;
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
export declare function calculateKDJ(prices: DailyPrice[]): KDJResult | null;
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
export declare function calculateBollinger(prices: DailyPrice[]): BollingerResult | null;
/**
 * 计算综合评分
 * 基于六项技术指标的信号计算综合评分，评分范围 [-100, +100]。
 * 各指标信号映射为分值（MACD/RSI/均线/KDJ/布林带 ±17，量比 ±8）。
 * null 指标贡献 0 分。
 *
 * @param indicators - 六项指标结果，每项可为结果或 null
 * @returns 综合评分结果，包含评分、建议、置信度和各指标贡献明细
 */
export declare function calculateCompositeScore(indicators: {
    macd: MACDResult | null;
    rsi: RSIResult | null;
    volumeRatio: VolumeRatioResult | null;
    maAlignment: MAAlignmentResult | null;
    kdj: KDJResult | null;
    bollinger: BollingerResult | null;
}): CompositeScoreResult;
//# sourceMappingURL=TechnicalIndicators.d.ts.map