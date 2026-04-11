#!/usr/bin/env node
// ============================================================
// Web Server — 提供 HTTP API + 前端页面访问监控结果
// ============================================================

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import { parse } from './ConfigParser.js';
import {
  fetchStockHistory,
  fetchIndexHistory,
  validateSymbol,
  calculateDailyChanges,
} from './DataFetcher.js';
import {
  StrategyEngine,
  SingleDayDropStrategy,
  UnderperformBenchmarkStrategy,
  RSI2OversoldStrategy,
  ConsecutiveDownDaysStrategy,
  MAPullbackStrategy,
  CumulativeRSI2Strategy,
  VIXSpikeStrategy,
} from './StrategyEngine.js';
import { TriggerTracker } from './TriggerTracker.js';
import { generateCSV, generateConsoleSummary, calculateStats } from './ReportGenerator.js';
import type { Configuration, DailyChange, TriggerRecord } from './types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const CONFIG_PATH = process.env.CONFIG_PATH || 'config.json';
const TRIGGERS_PATH = process.env.TRIGGERS_PATH || 'triggers.csv';

// --- 运行监控流程 ---

async function runMonitor(configPath: string, triggersPath: string): Promise<{
  records: TriggerRecord[];
  warnings: string[];
}> {
  const warnings: string[] = [];

  const configJson = fs.readFileSync(path.resolve(configPath), 'utf-8');
  const configResult = parse(configJson);
  if (!configResult.ok) {
    throw new Error(`配置解析失败: ${configResult.error.message}`);
  }
  const config = configResult.value as Configuration;

  // 验证股票代码（加延迟避免限流）
  const validSymbols: string[] = [];
  for (const symbol of config.stockList) {
    const exists = await validateSymbol(symbol);
    if (exists) {
      validSymbols.push(symbol);
    } else {
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

  // 获取基准指数
  const benchmarkResult = await fetchIndexHistory(benchmarkSymbol, startDate, endDate, retryCount, retryIntervalMs);
  let benchmarkChanges: DailyChange[] = [];
  if (benchmarkResult.ok) {
    benchmarkChanges = calculateDailyChanges(benchmarkResult.value, benchmarkSymbol);
  } else {
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
  try { existingCsv = fs.readFileSync(path.resolve(triggersPath), 'utf-8'); } catch { /* empty */ }
  const tracker = new TriggerTracker(existingCsv);

  for (const symbol of validSymbols) {
    const stockResult = await fetchStockHistory(symbol, startDate, endDate, retryCount, retryIntervalMs);
    if (!stockResult.ok) {
      warnings.push(`获取 ${symbol} 失败: ${stockResult.error.message}`);
      continue;
    }
    const stockChanges = calculateDailyChanges(stockResult.value, symbol);
    const events = engine.evaluate(stockChanges, benchmarkChanges, config.strategies, stockResult.value);
    for (const event of events) tracker.recordTrigger(event);

    const pendingForSymbol = tracker.getPendingTriggers().filter((r) => r.symbol === symbol);
    for (const pending of pendingForSymbol) {
      const triggerIdx = stockChanges.findIndex((c) => c.date === pending.triggerDate);
      if (triggerIdx >= 0 && triggerIdx + 1 < stockChanges.length) {
        const triggerDay = stockChanges[triggerIdx];
        const nextDay = stockChanges[triggerIdx + 1];
        const nextDayChange = ((nextDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;

        let maxGain = nextDayChange;
        let day5Change = nextDayChange;
        const lookAhead = Math.min(5, stockChanges.length - triggerIdx - 1);
        for (let d = 1; d <= lookAhead; d++) {
          const futureDay = stockChanges[triggerIdx + d];
          const change = ((futureDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
          if (change > maxGain) maxGain = change;
          if (d === lookAhead) day5Change = change;
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

function getIndexHTML(): string {
  const htmlPath = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'public', 'index.html');
  try {
    return fs.readFileSync(htmlPath, 'utf-8');
  } catch {
    return '<html><body><h1>stock-strategy-monitor</h1><p>public/index.html not found</p></body></html>';
  }
}

// --- 缓存 ---
let cachedResult: { records: TriggerRecord[]; warnings: string[]; timestamp: number } | null = null;

// --- HTTP Server ---

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
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
      const cacheAge = cachedResult ? Date.now() - cachedResult.timestamp : Infinity;

      if (!forceRefresh && cachedResult && cacheAge < 5 * 60 * 1000) {
        sendJSON(res, 200, { records: cachedResult.records, warnings: cachedResult.warnings, cached: true });
        return;
      }

      const result = await runMonitor(CONFIG_PATH, TRIGGERS_PATH);
      cachedResult = { ...result, timestamp: Date.now() };
      sendJSON(res, 200, { ...result, cached: false });
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
      sendJSON(res, 500, { error: err.message });
    }
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
  runMonitor(CONFIG_PATH, TRIGGERS_PATH)
    .then(result => {
      cachedResult = { ...result, timestamp: Date.now() };
      console.log(`预加载完成: ${result.records.length} 条记录`);
    })
    .catch(err => console.error('预加载失败:', err.message));

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
