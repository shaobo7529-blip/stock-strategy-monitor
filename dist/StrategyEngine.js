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
 * 累积 RSI(2) 策略 — Connors 经典高胜率策略
 *
 * 触发条件（全部满足）：
 * 1. 价格在 200 日均线之上（上升趋势）
 * 2. 最近 2 天的 RSI(2) 累积值 < threshold（默认 35）
 *
 * 原始回测：SPY 上 88% 胜率，平均持有 3.7 天
 */
export class CumulativeRSI2Strategy {
    name = 'cumulative-rsi2';
    evaluate(stock, _benchmark, threshold, context) {
        if (!context || context.length < 3)
            return false;
        // 计算当天和前一天的 RSI(2)
        const rsiToday = this.calcRSI2(context.slice(-1)[0], stock);
        const rsiYesterday = context.length >= 2 ? this.calcRSI2(context.slice(-2)[0], context.slice(-1)[0]) : null;
        if (rsiToday === null || rsiYesterday === null)
            return false;
        // 累积 RSI = 最近 2 天的 RSI(2) 之和
        const cumulativeRSI = rsiToday + rsiYesterday;
        if (cumulativeRSI >= threshold)
            return false;
        // 趋势过滤：价格在 200 日均线之上
        const allPrices = [...context, stock];
        const lookback = Math.min(allPrices.length, 200);
        const ma = allPrices.slice(-lookback).reduce((sum, c) => sum + c.closePrice, 0) / lookback;
        return stock.closePrice > ma;
    }
    calcRSI2(prev, curr) {
        const changes = [prev, curr];
        let totalGain = 0, totalLoss = 0;
        for (const c of changes) {
            if (c.changePercent > 0)
                totalGain += c.changePercent;
            else
                totalLoss += Math.abs(c.changePercent);
        }
        const avgGain = totalGain / 2;
        const avgLoss = totalLoss / 2;
        if (avgLoss === 0)
            return 100;
        return 100 - 100 / (1 + avgGain / avgLoss);
    }
}
/**
 * VIX 恐慌买入策略
 *
 * 触发条件：
 * 基准指数（NASDAQ）当日跌幅 >= threshold%（默认 3%）
 * 这是 VIX 飙升的代理指标（我们没有直接的 VIX 数据，用大盘急跌代替）
 * 大盘恐慌性下跌后，个股反弹概率高
 */
export class VIXSpikeStrategy {
    name = 'vix-spike';
    evaluate(_stock, benchmark, threshold) {
        if (benchmark === null)
            return false;
        // 基准指数当日跌幅 >= threshold%（恐慌性下跌）
        return benchmark.changePercent <= -threshold;
    }
}
/**
 * 极度恐慌抄底策略 (Extreme Panic Dip Buy)
 *
 * 触发条件（全部满足）：
 * 1. RSI(2) ≤ threshold（默认 3，极度超卖）
 * 2. 价格低于布林带下轨（20日MA - 2倍标准差）
 * 3. 成交量 ≥ 2.0x 5日均量（恐慌放量）
 * 4. 价格在 200 日均线之上（牛市过滤）
 */
export class ExtremePanicStrategy {
    name = 'extreme-panic';
    evaluate(_stock, _benchmark, threshold, context, priceHistory) {
        if (!context || context.length < 2 || !priceHistory || priceHistory.length < 21)
            return false;
        const today = priceHistory[priceHistory.length - 1];
        // 1. RSI(2) ≤ threshold (default 3)
        const changes = [...context.slice(-1), _stock];
        let totalGain = 0, totalLoss = 0;
        for (const c of changes) {
            if (c.changePercent > 0)
                totalGain += c.changePercent;
            else
                totalLoss += Math.abs(c.changePercent);
        }
        const avgGain = totalGain / 2, avgLoss = totalLoss / 2;
        if (avgLoss === 0)
            return false;
        const rsi = 100 - 100 / (1 + avgGain / avgLoss);
        if (rsi > threshold)
            return false;
        // 2. Price below Bollinger Band lower (20, 2)
        if (priceHistory.length < 20)
            return false;
        const last20 = priceHistory.slice(-20);
        const ma20 = last20.reduce((s, p) => s + p.close, 0) / 20;
        const stdDev = Math.sqrt(last20.reduce((s, p) => s + (p.close - ma20) ** 2, 0) / 20);
        const lowerBand = ma20 - 2 * stdDev;
        if (today.close >= lowerBand)
            return false;
        // 3. Volume ≥ 2.0x 5-day average
        if (priceHistory.length < 6)
            return false;
        const vol5 = priceHistory.slice(-6, -1).reduce((s, p) => s + p.volume, 0) / 5;
        if (vol5 <= 0 || today.volume < vol5 * 2.0)
            return false;
        // 4. Price above 200-day MA
        const allPrices = [...context, _stock];
        const lookback = Math.min(allPrices.length, 200);
        const ma200 = allPrices.slice(-lookback).reduce((s, c) => s + c.closePrice, 0) / lookback;
        if (_stock.closePrice <= ma200)
            return false;
        return true;
    }
}
/**
 * 锤子线反转策略 (Hammer Reversal)
 *
 * 两日模式：
 * Day 1（昨日）：恐慌下跌（RSI(2)≤10 + IBS<0.5）
 * Day 2（今日）：锤子线确认（IBS>0.7 + 长下影线 + 放量）
 */
export class HammerReversalStrategy {
    name = 'hammer-reversal';
    evaluate(_stock, _benchmark, threshold, context, priceHistory) {
        if (!context || context.length < 2 || !priceHistory || priceHistory.length < 3)
            return false;
        const today = priceHistory[priceHistory.length - 1];
        const yesterday = priceHistory[priceHistory.length - 2];
        // Day 1 (yesterday): panic drop
        const yRange = yesterday.high - yesterday.low;
        if (yRange <= 0)
            return false;
        const yIBS = (yesterday.close - yesterday.low) / yRange;
        if (yIBS >= 0.5)
            return false; // yesterday must close in lower half (panic)
        // Yesterday must have been a down day
        const yChange = context[context.length - 1];
        if (!yChange || yChange.changePercent >= 0)
            return false; // must be a down day
        // Day 2 (today): hammer candlestick
        const tRange = today.high - today.low;
        if (tRange <= 0)
            return false;
        const tIBS = (today.close - today.low) / tRange;
        if (tIBS < 0.7)
            return false; // close in upper 30% of range (hammer body)
        // Hammer: lower shadow must be at least 2x the body
        const body = Math.abs(today.close - today.open);
        const lowerShadow = Math.min(today.open, today.close) - today.low;
        if (body > 0 && lowerShadow < body * 2)
            return false;
        // Volume confirmation: today's volume ≥ 1.2x 5-day average
        if (priceHistory.length < 6)
            return false;
        const vol5 = priceHistory.slice(-6, -1).reduce((s, p) => s + p.volume, 0) / 5;
        if (vol5 <= 0 || today.volume < vol5 * 1.2)
            return false;
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
                        timeframe: '1d',
                    });
                }
            }
        }
        return events;
    }
}
//# sourceMappingURL=StrategyEngine.js.map