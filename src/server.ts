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
  ExtremePanicStrategy,
  HammerReversalStrategy,
} from './StrategyEngine.js';
import { TriggerTracker } from './TriggerTracker.js';
import { generateCSV, generateConsoleSummary, calculateStats } from './ReportGenerator.js';
import type { Configuration, DailyChange, DailyPrice, TriggerRecord } from './types.js';

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

  // 获取 SPY 数据用于市场环境判断（顺大盘铁律）
  let spyPrices: DailyPrice[] = [];
  const spyResult = await fetchStockHistory('SPY', startDate, endDate, retryCount, retryIntervalMs);
  if (spyResult.ok) {
    spyPrices = spyResult.value;
  } else {
    warnings.push('获取 SPY 数据失败，无法判断市场环境');
  }

  // 构建 SPY 200 日均线 map：date -> { aboveMA200: boolean, ma200TrendUp: boolean }
  const spyRegimeByDate = new Map<string, { bull: boolean }>();
  for (let i = 0; i < spyPrices.length; i++) {
    const lookback = Math.min(i + 1, 200);
    const slice = spyPrices.slice(i + 1 - lookback, i + 1);
    const ma200 = slice.reduce((s, p) => s + p.close, 0) / lookback;
    spyRegimeByDate.set(spyPrices[i].date, { bull: lookback >= 50 && spyPrices[i].close > ma200 });
  }

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
  engine.registerStrategy(new ExtremePanicStrategy());
  engine.registerStrategy(new HammerReversalStrategy());

  // 不加载旧记录，每次全量重新计算避免重复
  const tracker = new TriggerTracker();

  for (const symbol of validSymbols) {
    const stockResult = await fetchStockHistory(symbol, startDate, endDate, retryCount, retryIntervalMs);
    if (!stockResult.ok) {
      warnings.push(`获取 ${symbol} 失败: ${stockResult.error.message}`);
      continue;
    }
    const stockChanges = calculateDailyChanges(stockResult.value, symbol);
    const events = engine.evaluate(stockChanges, benchmarkChanges, config.strategies, stockResult.value);
    
    const currentTimeframe = '1d';
    // 顺大盘铁律 + IBS 过滤 + 成交量确认 + 信号强度
    for (const event of events) {
      const eventWithTf = { ...event, timeframe: currentTimeframe };
      const regime = spyRegimeByDate.get(event.triggerDate);
      if (regime && !regime.bull && event.strategyType !== 'vix-spike') {
        continue; // 熊市信号，跳过（VIX恐慌除外）
      }

      // IBS 过滤：收盘在当日区间下半部分才触发（卖压释放信号）
      // 均线回踩和VIX恐慌不受此过滤
      const priceIdx = stockResult.value.findIndex(p => p.date === event.triggerDate);
      let ibsValue = 1; // 默认值（不过滤）
      if (priceIdx >= 0 && event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike' && event.strategyType !== 'hammer-reversal') {
        const p = stockResult.value[priceIdx];
        const range = p.high - p.low;
        if (range > 0) {
          ibsValue = (p.close - p.low) / range;
          if (ibsValue > 0.5) continue; // 收盘在上半部分，不是超卖
        }
      }

      // 成交量确认过滤：均值回归策略要求放量（恐慌抛售 = 放量 = 更好的反弹）
      // ma-pullback 已有自己的成交量过滤，vix-spike 是市场级信号，均跳过
      let volumeRatio = 0;
      if (priceIdx >= 0 && event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike') {
        const triggerVolume = stockResult.value[priceIdx].volume;
        // 计算 5 日平均成交量
        const volLookback = Math.min(priceIdx, 5);
        if (volLookback > 0) {
          let volSum = 0;
          for (let vi = priceIdx - volLookback; vi < priceIdx; vi++) {
            volSum += stockResult.value[vi].volume;
          }
          const avgVol5 = volSum / volLookback;
          volumeRatio = avgVol5 > 0 ? triggerVolume / avgVol5 : 0;
          // RSI/连续下跌等均值回归策略要求 >= 1.2x
          if (event.strategyType === 'rsi2-oversold' || event.strategyType === 'consecutive-down-days'
              || event.strategyType === 'cumulative-rsi2' || event.strategyType === 'single-day-drop'
              || event.strategyType === 'underperform-benchmark') {
            if (volumeRatio < 1.2) continue;
          }
        }
      }

      // 信号强度计算 (1-3)
      let signalStrength = 0;
      // +1 SPY 牛市（200MA 之上）
      if (regime && regime.bull) signalStrength++;
      // +1 IBS < 0.3（强超卖收盘）
      if (priceIdx >= 0 && ibsValue < 0.3) signalStrength++;
      // +1 成交量 >= 1.5x 5日均量（强放量确认）
      if (volumeRatio >= 1.5) signalStrength++;
      // 至少为 1
      if (signalStrength === 0) signalStrength = 1;

      tracker.recordTrigger(eventWithTf, signalStrength);
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
          if (change > maxGain) maxGain = change;
          if (change < maxDrawdown) maxDrawdown = change;
          // 止损铁律：跌破 -5% 视为止损出局
          if (change <= -5 && !stoppedOut) {
            stoppedOut = true;
            day5Change = change; // 止损价作为最终收益
          }
          if (d === lookAhead && !stoppedOut) day5Change = change;
        }
        tracker.updatePerformance(symbol, pending.triggerDate, nextDayChange, maxGain, day5Change);
      }
    }
  }

  // ========== 周线 (1wk) 第二轮 ==========
  for (const symbol of validSymbols) {
    const weeklyResult = await fetchStockHistory(symbol, startDate, endDate, retryCount, retryIntervalMs, '1wk');
    if (!weeklyResult.ok) {
      warnings.push(`获取 ${symbol} 周线失败: ${weeklyResult.error.message}`);
      continue;
    }
    const weeklyChanges = calculateDailyChanges(weeklyResult.value, symbol);
    const weeklyEvents = engine.evaluate(weeklyChanges, benchmarkChanges, config.strategies, weeklyResult.value);

    const wkTimeframe = '1wk';
    for (const event of weeklyEvents) {
      const eventWithTf = { ...event, timeframe: wkTimeframe };
      const regime = spyRegimeByDate.get(event.triggerDate);
      if (regime && !regime.bull && event.strategyType !== 'vix-spike') {
        continue;
      }

      const priceIdx = weeklyResult.value.findIndex(p => p.date === event.triggerDate);
      let ibsValue = 1;
      if (priceIdx >= 0 && event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike' && event.strategyType !== 'hammer-reversal') {
        const p = weeklyResult.value[priceIdx];
        const range = p.high - p.low;
        if (range > 0) {
          ibsValue = (p.close - p.low) / range;
          if (ibsValue > 0.5) continue;
        }
      }

      let volumeRatio = 0;
      if (priceIdx >= 0 && event.strategyType !== 'ma-pullback' && event.strategyType !== 'vix-spike') {
        const triggerVolume = weeklyResult.value[priceIdx].volume;
        const volLookback = Math.min(priceIdx, 5);
        if (volLookback > 0) {
          let volSum = 0;
          for (let vi = priceIdx - volLookback; vi < priceIdx; vi++) {
            volSum += weeklyResult.value[vi].volume;
          }
          const avgVol5 = volSum / volLookback;
          volumeRatio = avgVol5 > 0 ? triggerVolume / avgVol5 : 0;
          if (event.strategyType === 'rsi2-oversold' || event.strategyType === 'consecutive-down-days'
              || event.strategyType === 'cumulative-rsi2' || event.strategyType === 'single-day-drop'
              || event.strategyType === 'underperform-benchmark') {
            if (volumeRatio < 1.2) continue;
          }
        }
      }

      let signalStrength = 0;
      if (regime && regime.bull) signalStrength++;
      if (priceIdx >= 0 && ibsValue < 0.3) signalStrength++;
      if (volumeRatio >= 1.5) signalStrength++;
      if (signalStrength === 0) signalStrength = 1;

      tracker.recordTrigger(eventWithTf, signalStrength);
    }

    const pendingForSymbol = tracker.getPendingTriggers().filter((r) => r.symbol === symbol && r.timeframe === '1wk');
    for (const pending of pendingForSymbol) {
      const triggerIdx = weeklyChanges.findIndex((c) => c.date === pending.triggerDate);
      if (triggerIdx >= 0 && triggerIdx + 1 < weeklyChanges.length) {
        const triggerDay = weeklyChanges[triggerIdx];
        const nextDay = weeklyChanges[triggerIdx + 1];
        const nextDayChange = ((nextDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;

        let maxGain = nextDayChange;
        let day5Change = nextDayChange;
        let maxDrawdown = nextDayChange;
        const lookAhead = Math.min(5, weeklyChanges.length - triggerIdx - 1);
        let stoppedOut = false;
        for (let d = 1; d <= lookAhead; d++) {
          const futureDay = weeklyChanges[triggerIdx + d];
          const change = ((futureDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
          if (change > maxGain) maxGain = change;
          if (change < maxDrawdown) maxDrawdown = change;
          if (change <= -5 && !stoppedOut) {
            stoppedOut = true;
            day5Change = change;
          }
          if (d === lookAhead && !stoppedOut) day5Change = change;
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
let isLoading = false;

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

      // 强制刷新：触发后台刷新，但立即返回当前缓存
      if (forceRefresh && !isLoading) {
        isLoading = true;
        runMonitor(CONFIG_PATH, TRIGGERS_PATH)
          .then(result => {
            cachedResult = { ...result, timestamp: Date.now() };
            isLoading = false;
            fs.writeFileSync(path.resolve('cache.json'), JSON.stringify(cachedResult), 'utf-8');
            console.log(`手动刷新完成: ${result.records.length} 条记录`);
          })
          .catch(err => { isLoading = false; console.error('刷新失败:', err.message); });
      }

      // 有缓存就返回缓存
      if (cachedResult) {
        sendJSON(res, 200, { records: cachedResult.records, warnings: cachedResult.warnings, cached: !forceRefresh, loading: isLoading });
        return;
      }

      // 没缓存，返回空 + loading
      sendJSON(res, 200, { records: [], warnings: ['数据正在加载中，请稍后刷新...'], cached: false, loading: true });
    } catch (err: any) {
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // API: 获取统计摘要
  if (pathname === '/api/stats') {
    try {
      if (!cachedResult) {
        sendJSON(res, 200, { stats: [] });
        return;
      }
      const stats = [
        calculateStats(cachedResult.records, 'single-day-drop'),
        calculateStats(cachedResult.records, 'underperform-benchmark'),
        calculateStats(cachedResult.records, 'rsi2-oversold'),
        calculateStats(cachedResult.records, 'consecutive-down-days'),
        calculateStats(cachedResult.records, 'ma-pullback'),
        calculateStats(cachedResult.records, 'cumulative-rsi2'),
        calculateStats(cachedResult.records, 'vix-spike'),
        calculateStats(cachedResult.records, 'extreme-panic'),
        calculateStats(cachedResult.records, 'hammer-reversal'),
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

  // API: 获取当前股票列表
  if (pathname === '/api/stocks' && req.method === 'GET') {
    try {
      const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
      const config = JSON.parse(configJson);
      sendJSON(res, 200, { stocks: config.stockList || [] });
    } catch (err: any) {
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
        const parsed = JSON.parse(body);
        // 密码验证
        if (parsed.password !== 'shaobo2026') {
          sendJSON(res, 403, { error: '密码错误' });
          return;
        }
        const { stocks } = parsed;
        if (!Array.isArray(stocks)) { sendJSON(res, 400, { error: '需要 stocks 数组' }); return; }
        const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
        const config = JSON.parse(configJson);
        config.stockList = stocks;
        fs.writeFileSync(path.resolve(CONFIG_PATH), JSON.stringify(config, null, 2), 'utf-8');
        cachedResult = null;
        sendJSON(res, 200, { ok: true, stocks: config.stockList });
      } catch (err: any) {
        sendJSON(res, 500, { error: err.message });
      }
    });
    return;
  }

  // API: 获取股票分组
  if (pathname === '/api/groups' && req.method === 'GET') {
    try {
      const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
      const config = JSON.parse(configJson);
      sendJSON(res, 200, { groups: config.groups || [] });
    } catch (err: any) {
      sendJSON(res, 200, { groups: [] });
    }
    return;
  }

  // API: 更新股票分组
  if (pathname === '/api/groups' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.password !== 'shaobo2026') { sendJSON(res, 403, { error: '密码错误' }); return; }
        const configJson = fs.readFileSync(path.resolve(CONFIG_PATH), 'utf-8');
        const config = JSON.parse(configJson);
        config.groups = parsed.groups;
        fs.writeFileSync(path.resolve(CONFIG_PATH), JSON.stringify(config, null, 2), 'utf-8');
        sendJSON(res, 200, { ok: true });
      } catch (err: any) { sendJSON(res, 500, { error: err.message }); }
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

  // 启动时先从磁盘缓存加载（秒返回）
  const CACHE_FILE = path.resolve('cache.json');
  try {
    const diskCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (diskCache.records && diskCache.timestamp) {
      cachedResult = diskCache;
      console.log(`从磁盘缓存加载: ${diskCache.records.length} 条记录 (${new Date(diskCache.timestamp).toLocaleString()})`);
    }
  } catch { /* 没有缓存文件，正常 */ }

  // 后台异步刷新
  console.log('后台刷新数据...');
  isLoading = true;
  runMonitor(CONFIG_PATH, TRIGGERS_PATH)
    .then(result => {
      cachedResult = { ...result, timestamp: Date.now() };
      isLoading = false;
      // 持久化到磁盘
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedResult), 'utf-8');
      console.log(`刷新完成: ${result.records.length} 条记录，已写入缓存`);
    })
    .catch(err => { isLoading = false; console.error('刷新失败:', err.message); });

  // 每小时自动刷新
  setInterval(() => {
    console.log(`[${new Date().toISOString()}] 定时刷新数据...`);
    runMonitor(CONFIG_PATH, TRIGGERS_PATH)
      .then(result => {
        cachedResult = { ...result, timestamp: Date.now() };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedResult), 'utf-8');
        console.log(`[${new Date().toISOString()}] 刷新完成: ${result.records.length} 条记录`);
      })
      .catch(err => console.error(`[${new Date().toISOString()}] 刷新失败:`, err.message));
  }, 60 * 60 * 1000);
});
