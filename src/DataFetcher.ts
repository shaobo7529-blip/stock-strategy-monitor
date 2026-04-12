// ============================================================
// DataFetcher — 从 Yahoo Finance API 获取行情数据，含重试逻辑
// 直接使用 node-fetch + proxy，绕过 yahoo-finance2 库的兼容性问题
// ============================================================

import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { DailyPrice, DailyChange, FetchError, Result } from './types.js';

// 代理配置：有环境变量时走代理，没有时直连（AWS 服务器不需要代理）
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const fetchOptions: any = PROXY_URL ? { agent: new HttpsProxyAgent(PROXY_URL) } : {};

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_INTERVAL_MS = 5000;

function classifyError(err: unknown, symbol: string): FetchError {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not found') || msg.includes('no data') || msg.includes('no results')) {
      return { type: 'not_found', message: err.message, symbol };
    }
    if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) {
      return { type: 'rate_limit', message: err.message, symbol };
    }
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) {
      return { type: 'network', message: err.message, symbol };
    }
    return { type: 'unknown', message: err.message, symbol };
  }
  return { type: 'unknown', message: String(err), symbol };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  symbol: string,
  retryCount: number = DEFAULT_RETRY_COUNT,
  retryIntervalMs: number = DEFAULT_RETRY_INTERVAL_MS,
): Promise<Result<T, FetchError>> {
  let lastError: FetchError | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const result = await fn();
      return { ok: true, value: result };
    } catch (err) {
      lastError = classifyError(err, symbol);
      if (lastError.type === 'not_found') return { ok: false, error: lastError };
      if (attempt < retryCount) await delay(retryIntervalMs);
    }
  }
  return { ok: false, error: lastError! };
}

/** 直接调用 Yahoo Finance chart API */
async function fetchHistory(symbol: string, startDate: Date, endDate: Date, interval: string = '1d'): Promise<DailyPrice[]> {
  const p1 = Math.floor(startDate.getTime() / 1000);
  const p2 = Math.floor(endDate.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=${interval}&includePrePost=false`;

  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    const text = await res.text();
    if (text.includes('No data found') || res.status === 404) {
      throw new Error(`No data found for symbol ${symbol}`);
    }
    throw new Error(`HTTP ${res.status} for ${symbol}: ${text.substring(0, 200)}`);
  }

  const data: any = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error(`No data found for symbol ${symbol}`);
  }

  const timestamps: number[] = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new Error(`No quote data for ${symbol}`);

  const prices: DailyPrice[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close?.[i];
    if (close == null) continue;
    const d = new Date(timestamps[i] * 1000);
    prices.push({
      date: d.toISOString().split('T')[0],
      open: quote.open?.[i] ?? 0,
      close,
      high: quote.high?.[i] ?? 0,
      low: quote.low?.[i] ?? 0,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  return prices;
}

export async function fetchStockHistory(
  symbol: string, startDate: Date, endDate: Date,
  retryCount: number = DEFAULT_RETRY_COUNT,
  retryIntervalMs: number = DEFAULT_RETRY_INTERVAL_MS,
  interval: string = '1d',
): Promise<Result<DailyPrice[], FetchError>> {
  return withRetry(() => fetchHistory(symbol, startDate, endDate, interval), symbol, retryCount, retryIntervalMs);
}

export async function fetchIndexHistory(
  symbol: string, startDate: Date, endDate: Date,
  retryCount: number = DEFAULT_RETRY_COUNT,
  retryIntervalMs: number = DEFAULT_RETRY_INTERVAL_MS,
  interval: string = '1d',
): Promise<Result<DailyPrice[], FetchError>> {
  return withRetry(() => fetchHistory(symbol, startDate, endDate, interval), symbol, retryCount, retryIntervalMs);
}

export async function validateSymbol(symbol: string): Promise<boolean> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const prices = await fetchHistory(symbol, startDate, endDate);
    return prices.length > 0;
  } catch {
    return false;
  }
}

export function calculateDailyChanges(prices: DailyPrice[], symbol: string): DailyChange[] {
  if (prices.length < 2) return [];
  const changes: DailyChange[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    changes.push({
      date: curr.date,
      symbol,
      closePrice: curr.close,
      changePercent: ((curr.close - prev.close) / prev.close) * 100,
    });
  }
  return changes;
}
