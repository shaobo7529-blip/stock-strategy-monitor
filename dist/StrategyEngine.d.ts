import type { DailyChange, DailyPrice, StrategyConfig, TriggerEvent } from './types.js';
/**
 * 策略接口 — 每种策略实现此接口
 */
export interface Strategy {
    readonly name: string;
    evaluate(stock: DailyChange, benchmark: DailyChange | null, threshold: number, context?: DailyChange[], priceHistory?: DailyPrice[]): boolean;
}
/**
 * 单日跌幅策略 — 判断 changePercent <= -threshold
 */
export declare class SingleDayDropStrategy implements Strategy {
    readonly name = "single-day-drop";
    evaluate(stock: DailyChange, _benchmark: DailyChange | null, threshold: number): boolean;
}
/**
 * 跑输基准指数策略 — 判断 benchmarkChange - stockChange >= threshold
 */
export declare class UnderperformBenchmarkStrategy implements Strategy {
    readonly name = "underperform-benchmark";
    evaluate(stock: DailyChange, benchmark: DailyChange | null, threshold: number): boolean;
}
/**
 * RSI(2) 超卖策略 — Larry Connors 经典版本
 *
 * 触发条件（全部满足）：
 * 1. 2 日 RSI <= threshold（默认 10）
 * 2. 当前价格在 200 日均线之上（确认长期上升趋势，避免在下跌趋势中抄底）
 *
 * RSI(2) 使用 Wilder 平滑法：
 * - 第一个 RSI = 100 - 100 / (1 + sumGain / sumLoss)
 * - 后续 RSI = 100 - 100 / (1 + (prevAvgGain * (n-1) + gain) / (prevAvgLoss * (n-1) + loss))
 *
 * 由于 period=2 且我们只需要当前值，简化为取最近 2 天的涨跌计算。
 */
export declare class RSI2OversoldStrategy implements Strategy {
    readonly name = "rsi2-oversold";
    evaluate(stock: DailyChange, _benchmark: DailyChange | null, threshold: number, context?: DailyChange[]): boolean;
}
/**
 * 连续下跌天数策略
 * 当股票连续下跌天数 >= threshold（默认 3）时触发
 * 需要历史上下文数据
 */
export declare class ConsecutiveDownDaysStrategy implements Strategy {
    readonly name = "consecutive-down-days";
    evaluate(stock: DailyChange, _benchmark: DailyChange | null, threshold: number, context?: DailyChange[]): boolean;
}
/**
 * 均线回踩策略 (MA Pullback)
 *
 * 触发条件（全部满足）：
 * 1. 收盘价在 MA20 和 MA50 之上
 * 2. MA20 > MA50（均线多头排列）
 * 3. MA20 和 MA50 均向上（近 3 日均线值递增）
 * 4. 收盘价回踩到 MA50 附近（距 MA50 不超过 threshold%，默认 5%）
 * 5. 当日成交量 < 5 日均量 * 0.7（缩量 30%）
 * 6. 当日收阳线或十字星（close >= open * 0.998）
 * 7. 最低价不跌破 MA50
 */
export declare class MAPullbackStrategy implements Strategy {
    readonly name = "ma-pullback";
    evaluate(_stock: DailyChange, _benchmark: DailyChange | null, threshold: number, _context?: DailyChange[], priceHistory?: DailyPrice[]): boolean;
    private calcMA;
    private calcAvgVolume;
    private isMATrendingUp;
}
/**
 * 策略引擎 — 注册策略并对日变动数据执行评估，收集触发事件
 */
export declare class StrategyEngine {
    private strategies;
    /** 注册一个策略实例 */
    registerStrategy(strategy: Strategy): void;
    /**
     * 遍历股票日变动数据，对每日执行所有已启用策略，收集 TriggerEvent。
     * 满足任一策略即触发（每个满足的策略产生一条独立的 TriggerEvent）。
     *
     * @param stockChanges     股票日变动序列
     * @param benchmarkChanges 基准指数日变动序列
     * @param configs          策略配置列表
     * @returns 所有触发事件
     */
    evaluate(stockChanges: DailyChange[], benchmarkChanges: DailyChange[], configs: StrategyConfig[], priceHistory?: DailyPrice[]): TriggerEvent[];
}
//# sourceMappingURL=StrategyEngine.d.ts.map