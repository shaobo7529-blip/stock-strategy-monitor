// Feature: stock-strategy-monitor, Property 1: 配置对象往返一致性

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parse, print } from '../src/ConfigParser.js';
import type { Configuration, StrategyConfig, DataSourceConfig, DateRange } from '../src/types.js';

/**
 * Validates: Requirements 6.1, 6.3, 6.4
 *
 * For any valid Configuration object, serializing it via print() and then
 * parsing it back via parse() should yield an equivalent object.
 * i.e. parse(print(config)) === config
 */

// --- Generators ---

const stockSymbolArb = fc.stringMatching(/^[A-Z]{1,5}$/);

const stockListArb = fc.array(stockSymbolArb, { minLength: 1, maxLength: 10 });

const strategyTypeArb = fc.constantFrom(
  'single-day-drop' as const,
  'underperform-benchmark' as const,
);

const strategyConfigArb: fc.Arbitrary<StrategyConfig> = fc.record({
  type: strategyTypeArb,
  threshold: fc.double({ min: 0.01, max: 100, noNaN: true }),
  enabled: fc.boolean(),
});

const dataSourceConfigArb: fc.Arbitrary<DataSourceConfig> = fc.record({
  benchmarkSymbol: fc.stringMatching(/^[A-Z^]{1,10}$/).filter(s => s.length > 0),
  retryCount: fc.nat({ max: 10 }),
  retryIntervalMs: fc.nat({ max: 60000 }),
});

// Generate valid YYYY-MM-DD date strings
const dateStringArb = fc
  .record({
    year: fc.integer({ min: 2000, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

const dateRangeArb: fc.Arbitrary<DateRange> = fc.record({
  startDate: dateStringArb,
  endDate: dateStringArb,
});

const configurationArb: fc.Arbitrary<Configuration> = fc.record({
  stockList: stockListArb,
  strategies: fc.array(strategyConfigArb, { minLength: 1, maxLength: 5 }),
  dataSource: dataSourceConfigArb,
  dateRange: dateRangeArb,
});

// --- Property Test ---

describe('ConfigParser Property Tests', () => {
  it('Property 1: parse(print(config)) should equal config (round-trip consistency)', () => {
    fc.assert(
      fc.property(configurationArb, (config) => {
        const json = print(config);
        const result = parse(json);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual(config);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: stock-strategy-monitor, Property 3: 无效股票代码拒绝

/**
 * Validates: Requirements 1.3
 *
 * For any string that does NOT match [A-Z]{1,5}, ConfigParser.parse()
 * should return an error with type 'invalid_symbol' and the error message
 * should contain the invalid symbol string.
 */

// Generator: strings that do NOT match /^[A-Z]{1,5}$/
const invalidSymbolArb = fc.oneof(
  // empty string
  fc.constant(''),
  // lowercase letters
  fc.stringMatching(/^[a-z]{1,5}$/),
  // digits only
  fc.stringMatching(/^[0-9]{1,5}$/),
  // too long (6+ uppercase letters)
  fc.stringMatching(/^[A-Z]{6,10}$/),
  // mixed case
  fc.stringMatching(/^[A-Za-z]{2,5}$/).filter(s => !/^[A-Z]{1,5}$/.test(s)),
  // contains special characters
  fc.stringMatching(/^[A-Z!@#$%]{1,5}$/).filter(s => !/^[A-Z]{1,5}$/.test(s)),
);

// Helper: build a valid config JSON string but inject an invalid symbol into stockList
function buildConfigWithSymbol(symbol: string): string {
  return JSON.stringify({
    stockList: [symbol],
    strategies: [{ type: 'single-day-drop', threshold: 3, enabled: true }],
    dataSource: { benchmarkSymbol: '^IXIC', retryCount: 3, retryIntervalMs: 5000 },
    dateRange: { startDate: '2024-01-01', endDate: '2024-12-31' },
  });
}

describe('ConfigParser Property Tests — Invalid Symbol Rejection', () => {
  it('Property 3: parse should reject configs with invalid stock symbols and include the symbol in the error', () => {
    fc.assert(
      fc.property(invalidSymbolArb, (invalidSymbol) => {
        const json = buildConfigWithSymbol(invalidSymbol);
        const result = parse(json);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.type).toBe('invalid_symbol');
          expect(result.error.message).toContain(invalidSymbol);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: stock-strategy-monitor, Property 4: 无效配置格式拒绝

/**
 * Validates: Requirements 6.2
 *
 * For any invalid JSON string or JSON object missing required fields,
 * ConfigParser.parse() should return { ok: false } with a descriptive
 * error message (non-empty string).
 */

// Required fields for a valid Configuration
const REQUIRED_FIELDS = ['stockList', 'strategies', 'dataSource', 'dateRange'] as const;

// A valid base config object to selectively remove fields from
const validConfigObj = {
  stockList: ['AAPL'],
  strategies: [{ type: 'single-day-drop', threshold: 3, enabled: true }],
  dataSource: { benchmarkSymbol: '^IXIC', retryCount: 3, retryIntervalMs: 5000 },
  dateRange: { startDate: '2024-01-01', endDate: '2024-12-31' },
};

// Generator: non-empty subsets of required fields to omit
const fieldsToOmitArb = fc
  .subarray([...REQUIRED_FIELDS], { minLength: 1, maxLength: REQUIRED_FIELDS.length })
  .filter(arr => arr.length > 0);

describe('ConfigParser Property Tests — Invalid Config Format Rejection', () => {
  it('Property 4a: parse should reject random strings that are not valid JSON', () => {
    fc.assert(
      fc.property(fc.string(), (randomStr) => {
        // Skip strings that happen to be valid JSON objects with all required fields
        try {
          const parsed = JSON.parse(randomStr);
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            REQUIRED_FIELDS.every(f => f in parsed)
          ) {
            return; // skip — this might be a valid config
          }
        } catch {
          // Not valid JSON — good, this is what we want to test
        }

        const result = parse(randomStr);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(typeof result.error.message).toBe('string');
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4b: parse should reject JSON objects missing one or more required fields', () => {
    fc.assert(
      fc.property(fieldsToOmitArb, (fieldsToOmit) => {
        const partial: Record<string, unknown> = { ...validConfigObj };
        for (const field of fieldsToOmit) {
          delete partial[field];
        }
        const json = JSON.stringify(partial);
        const result = parse(json);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(typeof result.error.message).toBe('string');
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
