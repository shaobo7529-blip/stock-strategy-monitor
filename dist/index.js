#!/usr/bin/env node
// ============================================================
// CLI 入口 — 串联所有组件，实现完整监控流程
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { parse } from './ConfigParser.js';
import { fetchStockHistory, fetchIndexHistory, validateSymbol, calculateDailyChanges, } from './DataFetcher.js';
import { StrategyEngine, SingleDayDropStrategy, UnderperformBenchmarkStrategy, RSI2OversoldStrategy, ConsecutiveDownDaysStrategy, MAPullbackStrategy, CumulativeRSI2Strategy, VIXSpikeStrategy, } from './StrategyEngine.js';
import { TriggerTracker } from './TriggerTracker.js';
import { generateCSV, generateConsoleSummary } from './ReportGenerator.js';
// --- CLI 参数解析 ---
function parseArgs() {
    const args = process.argv.slice(2);
    let configPath = 'config.json';
    let outputPath = 'report.csv';
    let triggersPath = 'triggers.csv';
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--config' || args[i] === '-c') && args[i + 1]) {
            configPath = args[++i];
        }
        else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
            outputPath = args[++i];
        }
        else if ((args[i] === '--triggers' || args[i] === '-t') && args[i + 1]) {
            triggersPath = args[++i];
        }
        else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`用法: stock-strategy-monitor [选项]

选项:
  -c, --config <path>    配置文件路径 (默认: config.json)
  -o, --output <path>    报告输出路径 (默认: report.csv)
  -t, --triggers <path>  触发记录文件路径 (默认: triggers.csv)
  -h, --help             显示帮助信息`);
            process.exit(0);
        }
    }
    return { configPath, outputPath, triggersPath };
}
// --- 主流程 ---
async function main() {
    const { configPath, outputPath, triggersPath } = parseArgs();
    // 1. 读取并解析配置文件
    console.log(`读取配置文件: ${configPath}`);
    let configJson;
    try {
        configJson = fs.readFileSync(path.resolve(configPath), 'utf-8');
    }
    catch {
        console.error(`无法读取配置文件: ${configPath}`);
        process.exit(1);
    }
    const configResult = parse(configJson);
    if (!configResult.ok) {
        console.error(`配置文件解析失败: ${configResult.error.message}`);
        process.exit(1);
    }
    const config = configResult.value;
    console.log(`已加载 ${config.stockList.length} 只股票, ${config.strategies.length} 个策略`);
    // 2. 验证股票代码
    const validSymbols = [];
    for (const symbol of config.stockList) {
        const exists = await validateSymbol(symbol);
        if (exists) {
            validSymbols.push(symbol);
        }
        else {
            console.warn(`警告: 股票代码 ${symbol} 在数据源中不存在，已跳过`);
        }
        // 间隔 500ms 避免 Yahoo Finance 限流
        await new Promise(r => setTimeout(r, 500));
    }
    if (validSymbols.length === 0) {
        console.error('没有有效的股票代码，程序退出');
        process.exit(1);
    }
    console.log(`有效股票代码: ${validSymbols.join(', ')}`);
    // 3. 获取行情数据
    const startDate = new Date(config.dateRange.startDate);
    const endDate = new Date(config.dateRange.endDate);
    const { retryCount, retryIntervalMs, benchmarkSymbol } = config.dataSource;
    // 获取基准指数数据
    console.log(`获取基准指数 ${benchmarkSymbol} 数据...`);
    const benchmarkResult = await fetchIndexHistory(benchmarkSymbol, startDate, endDate, retryCount, retryIntervalMs);
    let benchmarkChanges = [];
    if (benchmarkResult.ok) {
        benchmarkChanges = calculateDailyChanges(benchmarkResult.value, benchmarkSymbol);
    }
    else {
        console.warn(`警告: 获取基准指数数据失败: ${benchmarkResult.error.message}`);
    }
    // 4. 初始化策略引擎
    const engine = new StrategyEngine();
    engine.registerStrategy(new SingleDayDropStrategy());
    engine.registerStrategy(new UnderperformBenchmarkStrategy());
    engine.registerStrategy(new RSI2OversoldStrategy());
    engine.registerStrategy(new ConsecutiveDownDaysStrategy());
    engine.registerStrategy(new MAPullbackStrategy());
    engine.registerStrategy(new CumulativeRSI2Strategy());
    engine.registerStrategy(new VIXSpikeStrategy());
    // 5. 加载已有触发记录
    let existingCsv = '';
    try {
        existingCsv = fs.readFileSync(path.resolve(triggersPath), 'utf-8');
    }
    catch {
        // 文件不存在，从空状态开始
    }
    const tracker = new TriggerTracker(existingCsv);
    // 6. 逐只股票获取数据、执行策略判断
    for (const symbol of validSymbols) {
        console.log(`处理 ${symbol}...`);
        const stockResult = await fetchStockHistory(symbol, startDate, endDate, retryCount, retryIntervalMs);
        if (!stockResult.ok) {
            console.warn(`警告: 获取 ${symbol} 数据失败: ${stockResult.error.message}，已跳过`);
            continue;
        }
        const stockChanges = calculateDailyChanges(stockResult.value, symbol);
        const events = engine.evaluate(stockChanges, benchmarkChanges, config.strategies, stockResult.value);
        for (const event of events) {
            // IBS 过滤：收盘在当日区间下半部分才触发
            if (event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike') {
                const pi = stockResult.value.findIndex(p => p.date === event.triggerDate);
                if (pi >= 0) {
                    const p = stockResult.value[pi];
                    const range = p.high - p.low;
                    if (range > 0 && (p.close - p.low) / range > 0.5)
                        continue;
                }
            }
            tracker.recordTrigger(event);
        }
        // 计算次日表现：对每个 pending 记录，查找次日收盘价
        const pendingForSymbol = tracker.getPendingTriggers().filter((r) => r.symbol === symbol);
        for (const pending of pendingForSymbol) {
            const triggerIdx = stockChanges.findIndex((c) => c.date === pending.triggerDate);
            if (triggerIdx >= 0 && triggerIdx + 1 < stockChanges.length) {
                const nextDay = stockChanges[triggerIdx + 1];
                // 次日表现 = 次日收盘价相对于触发日收盘价的涨跌幅
                const triggerDay = stockChanges[triggerIdx];
                const performance = ((nextDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
                tracker.updateNextDayPerformance(symbol, pending.triggerDate, performance);
            }
        }
    }
    // 7. 持久化触发记录
    const allRecords = tracker.getAllRecords();
    fs.writeFileSync(path.resolve(triggersPath), tracker.toCSV(), 'utf-8');
    console.log(`触发记录已保存到: ${triggersPath} (${allRecords.length} 条)`);
    // 8. 生成报告
    const csvReport = generateCSV(allRecords);
    fs.writeFileSync(path.resolve(outputPath), csvReport, 'utf-8');
    console.log(`CSV 报告已保存到: ${outputPath}`);
    // 控制台摘要
    console.log('');
    console.log(generateConsoleSummary(allRecords));
}
main().catch((err) => {
    console.error('程序运行出错:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map