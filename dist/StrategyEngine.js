// ============================================================
// 美股策略监控程序 — 策略引擎模块
// ============================================================
/**
 * 单日跌幅策略 — 判断 changePercent <= -threshold
 */
export class SingleDayDropStrategy {
    name = 'single-day-drop';
    evaluate(stock, _benchmark, threshold) {
        return stock.changePercent <= -threshold;
    }
}
/**
 * 跑输基准指数策略 — 判断 benchmarkChange - stockChange >= threshold
 */
export class UnderperformBenchmarkStrategy {
    name = 'underperform-benchmark';
    evaluate(stock, benchmark, threshold) {
        if (benchmark === null)
            return false;
        return benchmark.changePercent - stock.changePercent >= threshold;
    }
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
export class RSI2OversoldStrategy {
    name = 'rsi2-oversold';
    evaluate(stock, _benchmark, threshold, context) {
        if (!context || context.length < 1)
            return false;
        // RSI(2) 需要最近 2 天的变动数据
        const period = 2;
        const recentChanges = [...context.slice(-(period - 1)), stock];
        if (recentChanges.length < period)
            return false;
        // 计算 RSI
        let totalGain = 0;
        let totalLoss = 0;
        for (const c of recentChanges) {
            if (c.changePercent > 0)
                totalGain += c.changePercent;
            else
                totalLoss += Math.abs(c.changePercent);
        }
        const avgGain = totalGain / period;
        const avgLoss = totalLoss / period;
        if (avgLoss === 0)
            return false;
        const rsi = 100 - 100 / (1 + avgGain / avgLoss);
        if (rsi > threshold)
            return false;
        // 趋势过滤：当前价格需在近期均线之上
        // 用 context 中可用的数据计算均线（最多 200 天，不够就用全部）
        const allPrices = [...context, stock];
        const lookback = Math.min(allPrices.length, 200);
        const recentPrices = allPrices.slice(-lookback);
        const ma = recentPrices.reduce((sum, c) => sum + c.closePrice, 0) / recentPrices.length;
        // 价格在均线之上才触发（上升趋势中的超卖反弹）
        return stock.closePrice > ma;
    }
}
/**
 * 连续下跌天数策略
 * 当股票连续下跌天数 >= threshold（默认 3）时触发
 * 需要历史上下文数据
 */
export class ConsecutiveDownDaysStrategy {
    name = 'consecutive-down-days';
    evaluate(stock, _benchmark, threshold, context) {
        if (!context)
            return false;
        // 从当天往前数连续下跌天数
        let count = 0;
        if (stock.changePercent < 0) {
            count = 1;
            // 从 context 末尾往前数
            for (let i = context.length - 1; i >= 0; i--) {
                if (context[i].changePercent < 0)
                    count++;
                else
                    break;
            }
        }
        return count >= threshold;
    }
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
export class MAPullbackStrategy {
    name = 'ma-pullback';
    evaluate(_stock, _benchmark, threshold, _context, priceHistory) {
        if (!priceHistory || priceHistory.length < 51)
            return false;
        const today = priceHistory[priceHistory.length - 1];
        const prices = priceHistory;
        const ma20 = this.calcMA(prices, 20);
        const ma50 = this.calcMA(prices, 50);
        if (ma20 === null || ma50 === null)
            return false;
        // 1. 收盘价在 MA20 和 MA50 之上
        if (today.close < ma20 || today.close < ma50)
            return false;
        // 2. MA20 > MA50（多头排列）
        if (ma20 <= ma50)
            return false;
        // 3. 均线向上（近 5 日递增）
        if (!this.isMATrendingUp(prices, 20, 5) || !this.isMATrendingUp(prices, 50, 5))
            return false;
        // 4. 回踩 MA50 附近（距离不超过 threshold%）
        const distToMA50 = ((today.close - ma50) / ma50) * 100;
        if (distToMA50 > threshold)
            return false;
        // 5. 缩量：当日成交量 < 5 日均量 * 0.7（低 30%）
        const avgVol5 = this.calcAvgVolume(prices, 5);
        if (avgVol5 === null || today.volume >= avgVol5 * 0.7)
            return false;
        // 6. 收阳线或十字星（close >= open * 0.998）
        if (today.close < today.open * 0.998)
            return false;
        // 7. 最低价不跌破 MA50
        if (today.low < ma50)
            return false;
        return true;
    }
    calcMA(prices, period) {
        if (prices.length < period)
            return null;
        const slice = prices.slice(-period);
        return slice.reduce((sum, p) => sum + p.close, 0) / period;
    }
    calcAvgVolume(prices, period) {
        if (prices.length < period + 1)
            return null;
        const slice = prices.slice(-(period + 1), -1);
        return slice.reduce((sum, p) => sum + p.volume, 0) / period;
    }
    isMATrendingUp(prices, maPeriod, checkDays) {
        if (prices.length < maPeriod + checkDays)
            return false;
        const maValues = [];
        for (let i = 0; i < checkDays; i++) {
            const endIdx = prices.length - i;
            const slice = prices.slice(endIdx - maPeriod, endIdx);
            maValues.unshift(slice.reduce((s, p) => s + p.close, 0) / maPeriod);
        }
        for (let i = 1; i < maValues.length; i++) {
            if (maValues[i] <= maValues[i - 1])
                return false;
        }
        return true;
    }
}
/**
 * 策略引擎 — 注册策略并对日变动数据执行评估，收集触发事件
 */
export class StrategyEngine {
    strategies = new Map();
    /** 注册一个策略实例 */
    registerStrategy(strategy) {
        this.strategies.set(strategy.name, strategy);
    }
    /**
     * 遍历股票日变动数据，对每日执行所有已启用策略，收集 TriggerEvent。
     * 满足任一策略即触发（每个满足的策略产生一条独立的 TriggerEvent）。
     *
     * @param stockChanges     股票日变动序列
     * @param benchmarkChanges 基准指数日变动序列
     * @param configs          策略配置列表
     * @returns 所有触发事件
     */
    evaluate(stockChanges, benchmarkChanges, configs, priceHistory) {
        if (stockChanges.length === 0)
            return [];
        // 将基准指数数据按日期索引，便于快速查找
        const benchmarkByDate = new Map();
        for (const bc of benchmarkChanges) {
            benchmarkByDate.set(bc.date, bc);
        }
        const enabledConfigs = configs.filter((c) => c.enabled);
        const events = [];
        for (let idx = 0; idx < stockChanges.length; idx++) {
            const stock = stockChanges[idx];
            const benchmark = benchmarkByDate.get(stock.date) ?? null;
            // 历史上下文：当前日之前的所有变动数据
            const context = stockChanges.slice(0, idx);
            // 价格历史上下文（含当天），用于需要 volume/OHLC 的策略
            const priceCtx = priceHistory ? priceHistory.slice(0, idx + 2) : undefined; // +2 因为 priceHistory 比 changes 多 1 条
            for (const cfg of enabledConfigs) {
                const strategy = this.strategies.get(cfg.type);
                if (!strategy)
                    continue;
                // 基准指数数据缺失某日时，跳过跑输基准策略判断
                if (cfg.type === 'underperform-benchmark' && benchmark === null)
                    continue;
                if (strategy.evaluate(stock, benchmark, cfg.threshold, context, priceCtx)) {
                    events.push({
                        symbol: stock.symbol,
                        triggerDate: stock.date,
                        strategyType: cfg.type,
                        triggerDayChange: stock.changePercent,
                    });
                }
            }
        }
        return events;
    }
}
//# sourceMappingURL=StrategyEngine.js.map