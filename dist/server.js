#!/usr/bin/env node
// ============================================================
// Web Server — 提供 HTTP API + 前端页面访问监控结果
// ============================================================
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { parse } from './ConfigParser.js';
import { fetchStockHistory, fetchIndexHistory, validateSymbol, calculateDailyChanges, } from './DataFetcher.js';
import { StrategyEngine, SingleDayDropStrategy, UnderperformBenchmarkStrategy, RSI2OversoldStrategy, ConsecutiveDownDaysStrategy, MAPullbackStrategy, CumulativeRSI2Strategy, VIXSpikeStrategy, } from './StrategyEngine.js';
import { TriggerTracker } from './TriggerTracker.js';
import { generateCSV, calculateStats } from './ReportGenerator.js';
const PORT = parseInt(process.env.PORT || '3000', 10);
const CONFIG_PATH = process.env.CONFIG_PATH || 'config.json';
const TRIGGERS_PATH = process.env.TRIGGERS_PATH || 'triggers.csv';
// --- 运行监控流程 ---
async function runMonitor(configPath, triggersPath) {
    const warnings = [];
    const configJson = fs.readFileSync(path.resolve(configPath), 'utf-8');
    const configResult = parse(configJson);
    if (!configResult.ok) {
        throw new Error(`配置解析失败: ${configResult.error.message}`);
    }
    const config = configResult.value;
    // 验证股票代码（加延迟避免限流）
    const validSymbols = [];
    for (const symbol of config.stockList) {
        const exists = await validateSymbol(symbol);
        if (exists) {
            validSymbols.push(symbol);
        }
        else {
            warnings.push(`股票代码 ${symbol} 不存在，已跳过`);
        }
        // 间隔 500ms 避免 Yahoo Finance 限流
        await new Promise(r => setTimeout(r, 500));
    }
    if (validSymbols.length === 0) {
        throw new Error('没有有效的股票代码');
    }
    const startDate = new Date(config.dateRange.startDate);
    const endDate = new Date(config.dateRange.endDate);
    const { retryCount, retryIntervalMs, benchmarkSymbol } = config.dataSource;
    // 获取 SPY 数据用于市场环境判断（顺大盘铁律）
    let spyPrices = [];
    const spyResult = await fetchStockHistory('SPY', startDate, endDate, retryCount, retryIntervalMs);
    if (spyResult.ok) {
        spyPrices = spyResult.value;
    }
    else {
        warnings.push('获取 SPY 数据失败，无法判断市场环境');
    }
    // 构建 SPY 200 日均线 map：date -> { aboveMA200: boolean, ma200TrendUp: boolean }
    const spyRegimeByDate = new Map();
    for (let i = 0; i < spyPrices.length; i++) {
        const lookback = Math.min(i + 1, 200);
        const slice = spyPrices.slice(i + 1 - lookback, i + 1);
        const ma200 = slice.reduce((s, p) => s + p.close, 0) / lookback;
        spyRegimeByDate.set(spyPrices[i].date, { bull: lookback >= 50 && spyPrices[i].close > ma200 });
    }
    // 获取基准指数
    const benchmarkResult = await fetchIndexHistory(benchmarkSymbol, startDate, endDate, retryCount, retryIntervalMs);
    let benchmarkChanges = [];
    if (benchmarkResult.ok) {
        benchmarkChanges = calculateDailyChanges(benchmarkResult.value, benchmarkSymbol);
    }
    else {
        warnings.push(`获取基准指数失败: ${benchmarkResult.error.message}`);
    }
    const engine = new StrategyEngine();
    engine.registerStrategy(new SingleDayDropStrategy());
    engine.registerStrategy(new UnderperformBenchmarkStrategy());
    engine.registerStrategy(new RSI2OversoldStrategy());
    engine.registerStrategy(new ConsecutiveDownDaysStrategy());
    engine.registerStrategy(new MAPullbackStrategy());
    engine.registerStrategy(new CumulativeRSI2Strategy());
    engine.registerStrategy(new VIXSpikeStrategy());
    let existingCsv = '';
    try {
        existingCsv = fs.readFileSync(path.resolve(triggersPath), 'utf-8');
    }
    catch { /* empty */ }
    const tracker = new TriggerTracker(existingCsv);
    for (const symbol of validSymbols) {
        const stockResult = await fetchStockHistory(symbol, startDate, endDate, retryCount, retryIntervalMs);
        if (!stockResult.ok) {
            warnings.push(`获取 ${symbol} 失败: ${stockResult.error.message}`);
            continue;
        }
        const stockChanges = calculateDailyChanges(stockResult.value, symbol);
        const events = engine.evaluate(stockChanges, benchmarkChanges, config.strategies, stockResult.value);
        // 顺大盘铁律 + IBS 过滤
        for (const event of events) {
            const regime = spyRegimeByDate.get(event.triggerDate);
            if (regime && !regime.bull && event.strategyType !== 'vix-spike') {
                continue; // 熊市信号，跳过（VIX恐慌除外）
            }
            // IBS 过滤：收盘在当日区间下半部分才触发（卖压释放信号）
            // 均线回踩和VIX恐慌不受此过滤
            const priceIdx = stockResult.value.findIndex(p => p.date === event.triggerDate);
            if (priceIdx >= 0 && event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike') {
                const p = stockResult.value[priceIdx];
                const range = p.high - p.low;
                if (range > 0) {
                    const ibs = (p.close - p.low) / range;
                    if (ibs > 0.5)
                        continue; // 收盘在上半部分，不是超卖
                }
            }
            tracker.recordTrigger(event);
        }
        const pendingForSymbol = tracker.getPendingTriggers().filter((r) => r.symbol === symbol);
        for (const pending of pendingForSymbol) {
            const triggerIdx = stockChanges.findIndex((c) => c.date === pending.triggerDate);
            if (triggerIdx >= 0 && triggerIdx + 1 < stockChanges.length) {
                const triggerDay = stockChanges[triggerIdx];
                const nextDay = stockChanges[triggerIdx + 1];
                const nextDayChange = ((nextDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
                let maxGain = nextDayChange;
                let day5Change = nextDayChange;
                let maxDrawdown = nextDayChange; // 5日内最大回撤
                const lookAhead = Math.min(5, stockChanges.length - triggerIdx - 1);
                let stoppedOut = false;
                for (let d = 1; d <= lookAhead; d++) {
                    const futureDay = stockChanges[triggerIdx + d];
                    const change = ((futureDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
                    if (change > maxGain)
                        maxGain = change;
                    if (change < maxDrawdown)
                        maxDrawdown = change;
                    // 止损铁律：跌破 -5% 视为止损出局
                    if (change <= -5 && !stoppedOut) {
                        stoppedOut = true;
                        day5Change = change; // 止损价作为最终收益
                    }
                    if (d === lookAhead && !stoppedOut)
                        day5Change = change;
                }
                tracker.updatePerformance(symbol, pending.triggerDate, nextDayChange, maxGain, day5Change);
            }
        }
    }
    // 持久化
    fs.writeFileSync(path.resolve(triggersPath), tracker.toCSV(), 'utf-8');
    return { records: tracker.getAllRecords(), warnings };
}
// --- HTML 页面 ---
function getIndexHTML() {
    const htmlPath = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'public', 'index.html');
    try {
        return fs.readFileSync(htmlPath, 'utf-8');
    }
    catch {
        return '<html><body><h1>stock-strategy-monitor</h1><p>public/index.html not found</p></body></html>';
    }
}
// --- 缓存 ---
let cachedResult = null;
let isLoading = false;
// --- HTTP Server ---
function sendJSON(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname;
    // 前端页面
    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getIndexHTML());
        return;
    }
    // API: 获取监控结果（使用缓存，避免重复请求 Yahoo Finance）
    if (pathname === '/api/monitor') {
        try {
            const forceRefresh = parsedUrl.query.refresh === '1';
            // 如果有缓存且不是强制刷新，直接返回
            if (!forceRefresh && cachedResult) {
                sendJSON(res, 200, { records: cachedResult.records, warnings: cachedResult.warnings, cached: true });
                return;
            }
            // 如果正在加载中，返回等待状态或已有缓存
            if (isLoading) {
                if (cachedResult) {
                    sendJSON(res, 200, { records: cachedResult.records, warnings: cachedResult.warnings, cached: true });
                }
                else {
                    sendJSON(res, 200, { records: [], warnings: ['数据正在加载中，请稍后刷新...'], cached: false, loading: true });
                }
                return;
            }
            isLoading = true;
            const result = await runMonitor(CONFIG_PATH, TRIGGERS_PATH);
            cachedResult = { ...result, timestamp: Date.now() };
            isLoading = false;
            sendJSON(res, 200, { ...result, cached: false });
        }
        catch (err) {
            isLoading = false;
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }
    // API: 获取统计摘要
    if (pathname === '/api/stats') {
        try {
            if (!cachedResult) {
                const result = await runMonitor(CONFIG_PATH, TRIGGERS_PATH);
                cachedResult = { ...result, timestamp: Date.now() };
            }
            const stats = [
                calculateStats(cachedResult.records, 'single-day-drop'),
                calculateStats(cachedResult.records, 'underperform-benchmark'),
                calculateStats(cachedResult.records, 'rsi2-oversold'),
                calculateStats(cachedResult.records, 'consecutive-down-days'),
                calculateStats(cachedResult.records, 'ma-pullback'),
                calculateStats(cachedResult.records, 'cumulative-rsi2'),
                calculateStats(cachedResult.records, 'vix-spike'),
            ].filter(s => s.totalTriggers > 0);
            sendJSON(res, 200, { stats });
        }
        catch (err) {
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }
    // API: 下载 CSV
    if (pathname === '/api/csv') {
        try {
            if (!cachedResult) {
                const result = await runMonitor(CONFIG_PATH, TRIGGERS_PATH);
                cachedResult = { ...result, timestamp: Date.now() };
            }
            const csv = generateCSV(cachedResult.records);
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'attachment; filename="report.csv"',
            });
            res.end(csv);
        }
        catch (err) {
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }
    // API: 获取当前股票列表
    if (pathname === '/api/stocks' && req.method === 'GET') {
        try {
            const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
            const config = JSON.parse(configJson);
            sendJSON(res, 200, { stocks: config.stockList || [] });
        }
        catch (err) {
            sendJSON(res, 500, { error: err.message });
        }
        return;
    }
    // API: 更新股票列表
    if (pathname === '/api/stocks' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { stocks } = JSON.parse(body);
                if (!Array.isArray(stocks)) {
                    sendJSON(res, 400, { error: '需要 stocks 数组' });
                    return;
                }
                const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
                const config = JSON.parse(configJson);
                config.stockList = stocks;
                fs.writeFileSync(path.resolve(CONFIG_PATH), JSON.stringify(config, null, 2), 'utf-8');
                cachedResult = null; // 清除缓存，下次请求重新拉数据
                sendJSON(res, 200, { ok: true, stocks: config.stockList });
            }
            catch (err) {
                sendJSON(res, 500, { error: err.message });
            }
        });
        return;
    }
    // 404
    sendJSON(res, 404, { error: 'Not found' });
});
server.listen(PORT, () => {
    console.log(`美股策略监控 Web 服务已启动: http://localhost:${PORT}`);
    console.log(`配置文件: ${CONFIG_PATH}`);
    console.log(`按 Ctrl+C 停止`);
    // 启动后自动拉取一次数据
    console.log('正在预加载数据...');
    isLoading = true;
    runMonitor(CONFIG_PATH, TRIGGERS_PATH)
        .then(result => {
        cachedResult = { ...result, timestamp: Date.now() };
        isLoading = false;
        console.log(`预加载完成: ${result.records.length} 条记录`);
    })
        .catch(err => { isLoading = false; console.error('预加载失败:', err.message); });
    // 每小时自动刷新
    setInterval(() => {
        console.log(`[${new Date().toISOString()}] 定时刷新数据...`);
        runMonitor(CONFIG_PATH, TRIGGERS_PATH)
            .then(result => {
            cachedResult = { ...result, timestamp: Date.now() };
            console.log(`[${new Date().toISOString()}] 刷新完成: ${result.records.length} 条记录`);
        })
            .catch(err => console.error(`[${new Date().toISOString()}] 刷新失败:`, err.message));
    }, 60 * 60 * 1000); // 1 小时
});
//# sourceMappingURL=server.js.map