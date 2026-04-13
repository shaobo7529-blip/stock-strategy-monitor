import {
  Configuration,
  StrategyConfig,
  DataSourceConfig,
  DateRange,
  Result,
  ConfigError,
  StrategyType,
} from './types.js';

const VALID_SYMBOL_REGEX = /^[A-Z0-9^.\-]{1,12}$/;
const MAX_STOCK_COUNT = 50;
const VALID_STRATEGY_TYPES: StrategyType[] = ['single-day-drop', 'underperform-benchmark', 'rsi2-oversold', 'consecutive-down-days', 'ma-pullback', 'cumulative-rsi2', 'vix-spike', 'extreme-panic', 'hammer-reversal'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStockList(stockList: unknown): ConfigError | null {
  if (!Array.isArray(stockList)) {
    return { type: 'invalid_format', message: 'stockList must be an array', field: 'stockList' };
  }
  if (stockList.length > MAX_STOCK_COUNT) {
    return {
      type: 'invalid_stock_count',
      message: `stockList exceeds maximum of ${MAX_STOCK_COUNT} stocks (got ${stockList.length})`,
      field: 'stockList',
    };
  }
  for (const symbol of stockList) {
    if (typeof symbol !== 'string' || !VALID_SYMBOL_REGEX.test(symbol)) {
      return {
        type: 'invalid_symbol',
        message: `Invalid stock symbol: "${String(symbol)}". Must match [A-Z]{1,5}`,
        field: 'stockList',
      };
    }
  }
  return null;
}

function validateStrategies(strategies: unknown): ConfigError | null {
  if (!Array.isArray(strategies)) {
    return { type: 'invalid_format', message: 'strategies must be an array', field: 'strategies' };
  }
  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    if (!isObject(s)) {
      return { type: 'invalid_format', message: `strategies[${i}] must be an object`, field: 'strategies' };
    }
    if (!VALID_STRATEGY_TYPES.includes(s.type as StrategyType)) {
      return {
        type: 'invalid_format',
        message: `strategies[${i}].type must be one of: ${VALID_STRATEGY_TYPES.join(', ')}`,
        field: `strategies[${i}].type`,
      };
    }
    if (typeof s.threshold !== 'number' || !isFinite(s.threshold) || s.threshold <= 0) {
      return {
        type: 'invalid_threshold',
        message: `strategies[${i}].threshold must be a positive number`,
        field: `strategies[${i}].threshold`,
      };
    }
    if (typeof s.enabled !== 'boolean') {
      return {
        type: 'invalid_format',
        message: `strategies[${i}].enabled must be a boolean`,
        field: `strategies[${i}].enabled`,
      };
    }
  }
  return null;
}

function validateDataSource(dataSource: unknown): ConfigError | null {
  if (!isObject(dataSource)) {
    return { type: 'invalid_format', message: 'dataSource must be an object', field: 'dataSource' };
  }
  if (typeof dataSource.benchmarkSymbol !== 'string' || dataSource.benchmarkSymbol.length === 0) {
    return {
      type: 'invalid_format',
      message: 'dataSource.benchmarkSymbol must be a non-empty string',
      field: 'dataSource.benchmarkSymbol',
    };
  }
  if (typeof dataSource.retryCount !== 'number' || !isFinite(dataSource.retryCount) || dataSource.retryCount < 0) {
    return {
      type: 'invalid_format',
      message: 'dataSource.retryCount must be a non-negative number',
      field: 'dataSource.retryCount',
    };
  }
  if (typeof dataSource.retryIntervalMs !== 'number' || !isFinite(dataSource.retryIntervalMs) || dataSource.retryIntervalMs < 0) {
    return {
      type: 'invalid_format',
      message: 'dataSource.retryIntervalMs must be a non-negative number',
      field: 'dataSource.retryIntervalMs',
    };
  }
  return null;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateDateRange(dateRange: unknown): ConfigError | null {
  if (!isObject(dateRange)) {
    return { type: 'invalid_format', message: 'dateRange must be an object', field: 'dateRange' };
  }
  if (typeof dateRange.startDate !== 'string' || !DATE_REGEX.test(dateRange.startDate)) {
    return {
      type: 'invalid_format',
      message: 'dateRange.startDate must be a valid date string (YYYY-MM-DD)',
      field: 'dateRange.startDate',
    };
  }
  if (typeof dateRange.endDate !== 'string' || !DATE_REGEX.test(dateRange.endDate)) {
    return {
      type: 'invalid_format',
      message: 'dateRange.endDate must be a valid date string (YYYY-MM-DD)',
      field: 'dateRange.endDate',
    };
  }
  return null;
}

export function parse(jsonString: string): Result<Configuration, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      ok: false,
      error: { type: 'invalid_format', message: 'Invalid JSON format' },
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      error: { type: 'invalid_format', message: 'Configuration must be a JSON object' },
    };
  }

  // Validate required fields exist
  const requiredFields = ['stockList', 'strategies', 'dataSource', 'dateRange'] as const;
  for (const field of requiredFields) {
    if (!(field in parsed)) {
      return {
        ok: false,
        error: { type: 'invalid_format', message: `Missing required field: ${field}`, field },
      };
    }
  }

  const stockListError = validateStockList(parsed.stockList);
  if (stockListError) return { ok: false, error: stockListError };

  const strategiesError = validateStrategies(parsed.strategies);
  if (strategiesError) return { ok: false, error: strategiesError };

  const dataSourceError = validateDataSource(parsed.dataSource);
  if (dataSourceError) return { ok: false, error: dataSourceError };

  const dateRangeError = validateDateRange(parsed.dateRange);
  if (dateRangeError) return { ok: false, error: dateRangeError };

  const config: Configuration = {
    stockList: parsed.stockList as string[],
    strategies: parsed.strategies as StrategyConfig[],
    dataSource: parsed.dataSource as DataSourceConfig,
    dateRange: parsed.dateRange as DateRange,
  };

  return { ok: true, value: config };
}

export function print(config: Configuration): string {
  return JSON.stringify(config, null, 2);
}
