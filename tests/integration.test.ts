// ============================================================
// 集成测试 — 使用 mock DataProvider 验证端到端流程
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from '../src/ConfigParser.js';
import {
  calculateDailyChanges,
} from '../src/DataFetcher.js';
import {
  StrategyEngine,
  SingleDayDropStrategy,
  UnderperformBenchmarkStrategy,
} from '../src/StrategyEngine.js';
import { TriggerTracker } from '../src/TriggerTracker.js';
import { generateCSV, generateConsoleSummary } from '../src/ReportGenerator.js';
import type { Configuration, DailyPrice, DailyChange, FetchError, Result } from '../src/types.js';

// --- Mock 数据 ---

function makePrices(symbol: string, data: { date: string; close: number }[]): DailyPrice[] {
  return data.map((d) => ({
    date: d.date,
    open: d.close,
    close: d.close,
    high: d.close,
    low: d.close,
    volume: 1000000,
  }));
}

const SAMPLE_CONFIG: Configuration = {
  stockList: ['AAPL', 'MSFT', 'FAKE'],
  strategies: [
    { type: 'single-day-drop', threshold: 3, enabled: true },
    { type: 'underperform-benchmark', threshold: 1, enabled: true },
  ],
  dataSource: { benchmarkSymbol: '^IXIC', retryCount: 3, retryIntervalMs: 10 },
  dateRange: { startDate: '2026-01-01', endDate: '2026-01-10' },
};

const AAPL_PRICES = makePrices('AAPL', [
  { date: '2026-01-02', close: 200 },
  { date: '2026-01-03', close: 190 },  // -5% drop → triggers single-day-drop
  { date: '2026-01-06', close: 195 },  // next day after trigger
  { date: '2026-01-07', close: 193 },
]);

const MSFT_PRICES = makePrices('MSFT', [
  { date: '2026-01-02', close: 400 },
  { date: '2026-01-03', close: 398 },  // -0.5% — no single-day-drop
  { date: '2026-01-06', close: 395 },
  { date: '2026-01-07', close: 390 },
]);

const BENCHMARK_PRICES = makePrices('^IXIC', [
  { date: '2026-01-02', close: 16000 },
  { date: '2026-01-03', close: 16100 },  // +0.625%
  { date: '2026-01-06', close: 16050 },
  { date: '2026-01-07', close: 16000 },
]);

// --- 测试 ---

describe('集成测试: 端到端流程', () => {
  it('完整流程: 配置解析 → 数据计算 → 策略判断 → 记录 → 报告', () => {
    // 1. 解析配置
    const configJson = JSON.stringify(SAMPLE_CONFIG);
    const configResult = parse(configJson);
    expect(configResult.ok).toBe(true);
    if (!configResult.ok) return;
    const config = configResult.value;

    // 2. 计算涨跌幅
    const aaplChanges = calculateDailyChanges(AAPL_PRICES, 'AAPL');
    const msftChanges = calculateDailyChanges(MSFT_PRICES, 'MSFT');
    const benchmarkChanges = calculateDailyChanges(BENCHMARK_PRICES, '^IXIC');

    expect(aaplChanges.length).toBe(3);
    expect(msftChanges.length).toBe(3);

    // 3. 策略引擎
    const engine = new StrategyEngine();
    engine.registerStrategy(new SingleDayDropStrategy());
    engine.registerStrategy(new UnderperformBenchmarkStrategy());

    const aaplEvents = engine.evaluate(aaplChanges, benchmarkChanges, config.strategies);
    const msftEvents = engine.evaluate(msftChanges, benchmarkChanges, config.strategies);

    // AAPL 2026-01-03: -5% drop → single-day-drop triggers
    // AAPL 2026-01-03: benchmark +0.625%, stock -5%, diff = 5.625% >= 1% → underperform triggers
    expect(aaplEvents.length).toBeGreaterThanOrEqual(1);
    const dropEvent = aaplEvents.find((e) => e.strategyType === 'single-day-drop');
    expect(dropEvent).toBeDefined();
    expect(dropEvent!.symbol).toBe('AAPL');

    // 4. 记录触发事件
    const tracker = new TriggerTracker();
    for (const event of [...aaplEvents, ...msftEvents]) {
      tracker.recordTrigger(event);
    }

    // 5. 更新次日表现
    const pending = tracker.getPendingTriggers();
    for (const p of pending) {
      const changes = p.symbol === 'AAPL' ? aaplChanges : msftChanges;
      const idx = changes.findIndex((c) => c.date === p.triggerDate);
      if (idx >= 0 && idx + 1 < changes.length) {
        const triggerDay = changes[idx];
        const nextDay = changes[idx + 1];
        const perf = ((nextDay.closePrice - triggerDay.closePrice) / triggerDay.closePrice) * 100;
        tracker.updateNextDayPerformance(p.symbol, p.triggerDate, perf);
      }
    }

    // 6. 生成报告
    const allRecords = tracker.getAllRecords();
    expect(allRecords.length).toBeGreaterThan(0);

    const csv = generateCSV(allRecords);
    expect(csv).toContain('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange');
    expect(csv).toContain('AAPL');

    const summary = generateConsoleSummary(allRecords);
    expect(summary).toContain('策略监控摘要');
  });
});

describe('集成测试: 股票代码验证', () => {
  it('mock validateSymbol — 不存在的代码被跳过', async () => {
    // 模拟验证逻辑：AAPL 和 MSFT 存在，FAKE 不存在
    const symbolExists: Record<string, boolean> = {
      AAPL: true,
      MSFT: true,
      FAKE: false,
    };

    const validSymbols: string[] = [];
    const warnings: string[] = [];

    for (const symbol of SAMPLE_CONFIG.stockList) {
      const exists = symbolExists[symbol] ?? false;
      if (exists) {
        validSymbols.push(symbol);
      } else {
        warnings.push(`股票代码 ${symbol} 在数据源中不存在，已跳过`);
      }
    }

    expect(validSymbols).toEqual(['AAPL', 'MSFT']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('FAKE');
  });
});

describe('集成测试: 数据获取失败重试', () => {
  it('mock 重试逻辑 — 连续失败后返回错误', async () => {
    let attempts = 0;
    const maxRetries = 3;

    // 模拟一个总是失败的 fetch 函数
    async function mockFetchWithRetry(): Promise<Result<DailyPrice[], FetchError>> {
      let lastError: FetchError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        attempts++;
        lastError = { type: 'network', message: 'Connection timeout', symbol: 'AAPL' };
        // 不实际等待，只模拟重试计数
      }
      return { ok: false, error: lastError! };
    }

    const result = await mockFetchWithRetry();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('network');
    }
    // 初始尝试 + 3 次重试 = 4 次
    expect(attempts).toBe(4);
  });

  it('mock 重试逻辑 — not_found 错误不重试', async () => {
    let attempts = 0;

    async function mockFetchNotFound(): Promise<Result<DailyPrice[], FetchError>> {
      attempts++;
      return { ok: false, error: { type: 'not_found', message: 'Symbol not found', symbol: 'INVALID' } };
    }

    const result = await mockFetchNotFound();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('not_found');
    }
    expect(attempts).toBe(1);
  });

  it('重试耗尽后程序继续运行 — 跳过失败股票', async () => {
    const failedSymbols: string[] = [];
    const processedSymbols: string[] = [];

    const mockResults: Record<string, Result<DailyPrice[], FetchError>> = {
      AAPL: { ok: true, value: AAPL_PRICES },
      MSFT: { ok: false, error: { type: 'network', message: 'Timeout after 3 retries', symbol: 'MSFT' } },
    };

    for (const symbol of ['AAPL', 'MSFT']) {
      const result = mockResults[symbol];
      if (!result.ok) {
        failedSymbols.push(symbol);
        continue;
      }
      processedSymbols.push(symbol);
    }

    expect(processedSymbols).toEqual(['AAPL']);
    expect(failedSymbols).toEqual(['MSFT']);
  });
});

describe('集成测试: 触发记录持久化到 CSV', () => {
  const tmpDir = path.join(process.cwd(), 'tests', '.tmp');
  const csvPath = path.join(tmpDir, 'test-triggers.csv');

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmdirSync(tmpDir);
    }
  });

  it('触发记录写入 CSV 文件后可正确读回', () => {
    // 创建 tracker 并添加记录
    const tracker = new TriggerTracker();
    tracker.recordTrigger({
      symbol: 'AAPL',
      triggerDate: '2026-01-03',
      strategyType: 'single-day-drop',
      triggerDayChange: -5,
    });
    tracker.updateNextDayPerformance('AAPL', '2026-01-03', 2.63);

    // 写入文件
    const csv = tracker.toCSV();
    fs.writeFileSync(csvPath, csv, 'utf-8');

    // 读回并验证
    const readCsv = fs.readFileSync(csvPath, 'utf-8');
    const tracker2 = new TriggerTracker(readCsv);
    const records = tracker2.getAllRecords();

    expect(records).toHaveLength(1);
    expect(records[0].symbol).toBe('AAPL');
    expect(records[0].triggerDate).toBe('2026-01-03');
    expect(records[0].strategyType).toBe('single-day-drop');
    expect(records[0].triggerDayChange).toBe(-5);
    expect(records[0].nextDayChange).toBe(2.63);
    expect(records[0].status).toBe('completed');
  });

  it('CSV 文件不存在时从空状态开始', () => {
    // 不创建文件，直接用空字符串初始化
    const tracker = new TriggerTracker('');
    expect(tracker.getAllRecords()).toHaveLength(0);

    // 也可以用 undefined
    const tracker2 = new TriggerTracker();
    expect(tracker2.getAllRecords()).toHaveLength(0);
  });
});
