import { describe, it, expect } from 'vitest';
import { parse, print } from '../src/ConfigParser.js';
import { Configuration } from '../src/types.js';

function makeValidConfig(overrides: Partial<Configuration> = {}): Configuration {
  return {
    stockList: ['AAPL', 'MSFT', 'GOOGL'],
    strategies: [
      { type: 'single-day-drop', threshold: 3, enabled: true },
      { type: 'underperform-benchmark', threshold: 1, enabled: true },
    ],
    dataSource: {
      benchmarkSymbol: '^IXIC',
      retryCount: 3,
      retryIntervalMs: 5000,
    },
    dateRange: {
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    },
    ...overrides,
  };
}

describe('ConfigParser', () => {
  describe('parse', () => {
    it('should parse a valid configuration', () => {
      const config = makeValidConfig();
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(config);
      }
    });

    it('should reject invalid JSON', () => {
      const result = parse('not valid json{');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
        expect(result.error.message).toContain('Invalid JSON');
      }
    });

    it('should reject non-object JSON', () => {
      const result = parse('"just a string"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
      }
    });

    it('should reject missing required fields', () => {
      const result = parse(JSON.stringify({ stockList: ['AAPL'] }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_format');
        expect(result.error.message).toContain('Missing required field');
      }
    });

    it('should accept exactly 10 stocks', () => {
      const config = makeValidConfig({
        stockList: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT'],
      });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(true);
    });

    it('should reject 11 stocks', () => {
      const config = makeValidConfig({
        stockList: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT', 'DIS'],
      });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_stock_count');
      }
    });

    it('should reject invalid stock symbol format', () => {
      const config = makeValidConfig({ stockList: ['aapl'] });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_symbol');
        expect(result.error.message).toContain('aapl');
      }
    });

    it('should reject stock symbol longer than 5 characters', () => {
      const config = makeValidConfig({ stockList: ['ABCDEF'] });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_symbol');
      }
    });

    it('should reject non-positive strategy threshold', () => {
      const config = makeValidConfig({
        strategies: [{ type: 'single-day-drop', threshold: 0, enabled: true }],
      });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_threshold');
      }
    });

    it('should reject negative strategy threshold', () => {
      const config = makeValidConfig({
        strategies: [{ type: 'single-day-drop', threshold: -1, enabled: true }],
      });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_threshold');
      }
    });

    it('should load custom strategy thresholds correctly', () => {
      const config = makeValidConfig({
        strategies: [
          { type: 'single-day-drop', threshold: 5.5, enabled: true },
          { type: 'underperform-benchmark', threshold: 2.3, enabled: false },
        ],
      });
      const result = parse(JSON.stringify(config));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.strategies[0].threshold).toBe(5.5);
        expect(result.value.strategies[1].threshold).toBe(2.3);
        expect(result.value.strategies[1].enabled).toBe(false);
      }
    });
  });

  describe('print', () => {
    it('should serialize a Configuration to formatted JSON', () => {
      const config = makeValidConfig();
      const json = print(config);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual(config);
    });

    it('should produce formatted (indented) output', () => {
      const config = makeValidConfig();
      const json = print(config);
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });
  });
});
