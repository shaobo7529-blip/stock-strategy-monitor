// Feature: stock-strategy-monitor, Property 6: 单日跌幅策略判断正确性
// Feature: stock-strategy-monitor, Property 7: 跑输基准指数策略判断正确性
// Feature: stock-strategy-monitor, Property 8: 策略引擎触发完整性

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  SingleDayDropStrategy,
  UnderperformBenchmarkStrategy,
  StrategyEngine,
} from '../src/StrategyEngine.js';
import type { DailyChange, StrategyConfig } from '../src/types.js';

// --- Shared generators ---

const finiteDouble = fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });
const positiveThreshold = fc.double({ min: 0.01, max: 50, noNaN: true, noDefaultInfinity: true });

// --- Property 6: 单日跌幅策略判断正确性 ---

describe('Property 6: SingleDayDropStrategy correctness', () => {
  const strategy = new SingleDayDropStrategy();

  /**
   * Validates: Requirements 3.2
   *
   * For any (changePercent, threshold) pair, SingleDayDropStrategy returns true
   * iff changePercent <= -threshold.
   */
  it('returns true iff changePercent <= -threshold', () => {
    fc.assert(
      fc.property(finiteDouble, positiveThreshold, (changePercent, threshold) => {
        const stock: DailyChange = {
          date: '2024-01-01',
          symbol: 'TEST',
          closePrice: 100,
          changePercent,
        };

        const result = strategy.evaluate(stock, null, threshold);
        const expected = changePercent <= -threshold;

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 7: 跑输基准指数策略判断正确性 ---

describe('Property 7: UnderperformBenchmarkStrategy correctness', () => {
  const strategy = new UnderperformBenchmarkStrategy();

  /**
   * Validates: Requirements 3.3
   *
   * For any (stockChange, benchmarkChange, threshold) triple,
   * UnderperformBenchmarkStrategy returns true iff
   * benchmarkChange - stockChange >= threshold.
   */
  it('returns true iff benchmarkChange - stockChange >= threshold', () => {
    fc.assert(
      fc.property(
        finiteDouble,
        finiteDouble,
        positiveThreshold,
        (stockChange, benchmarkChange, threshold) => {
          const stock: DailyChange = {
            date: '2024-01-01',
            symbol: 'TEST',
            closePrice: 100,
            changePercent: stockChange,
          };
          const benchmark: DailyChange = {
            date: '2024-01-01',
            symbol: '^IXIC',
            closePrice: 15000,
            changePercent: benchmarkChange,
          };

          const result = strategy.evaluate(stock, benchmark, threshold);
          const expected = benchmarkChange - stockChange >= threshold;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false when benchmark is null', () => {
    fc.assert(
      fc.property(finiteDouble, positiveThreshold, (stockChange, threshold) => {
        const stock: DailyChange = {
          date: '2024-01-01',
          symbol: 'TEST',
          closePrice: 100,
          changePercent: stockChange,
        };

        expect(strategy.evaluate(stock, null, threshold)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 8: 策略引擎触发完整性 ---

describe('Property 8: StrategyEngine trigger completeness', () => {
  /**
   * Validates: Requirements 3.5, 3.6
   *
   * For any stock daily change sequence and strategy configs:
   * 1. Every returned TriggerEvent satisfies at least one enabled strategy condition
   * 2. Every trading day that satisfies any strategy condition appears in the results (no omissions)
   */

  // Generator: a DailyChange for a given date index
  const dailyChangeArb = (dateIndex: number, symbol: string) =>
    finiteDouble.map((changePercent) => ({
      date: `2024-01-${String(dateIndex + 1).padStart(2, '0')}`,
      symbol,
      closePrice: 100,
      changePercent,
    }));

  // Generator: a sequence of DailyChange entries
  const dailyChangeSeqArb = (symbol: string) =>
    fc.integer({ min: 1, max: 10 }).chain((len) =>
      fc.tuple(...Array.from({ length: len }, (_, i) => dailyChangeArb(i, symbol))),
    );

  // Generator: strategy configs (both types, random thresholds, random enabled)
  const strategyConfigsArb = fc.tuple(
    positiveThreshold,
    fc.boolean(),
    positiveThreshold,
    fc.boolean(),
  ).map(([dropThreshold, dropEnabled, underThreshold, underEnabled]): StrategyConfig[] => [
    { type: 'single-day-drop', threshold: dropThreshold, enabled: dropEnabled },
    { type: 'underperform-benchmark', threshold: underThreshold, enabled: underEnabled },
  ]);

  it('every TriggerEvent satisfies its strategy condition, and no qualifying day is omitted', () => {
    fc.assert(
      fc.property(
        dailyChangeSeqArb('AAPL'),
        dailyChangeSeqArb('^IXIC'),
        strategyConfigsArb,
        (stockChanges, benchmarkChanges, configs) => {
          const engine = new StrategyEngine();
          engine.registerStrategy(new SingleDayDropStrategy());
          engine.registerStrategy(new UnderperformBenchmarkStrategy());

          const events = engine.evaluate(stockChanges, benchmarkChanges, configs);

          const benchmarkByDate = new Map<string, DailyChange>();
          for (const bc of benchmarkChanges) {
            benchmarkByDate.set(bc.date, bc);
          }

          const enabledConfigs = configs.filter((c) => c.enabled);

          // 1. Soundness: every returned event satisfies its strategy condition
          for (const event of events) {
            const stock = stockChanges.find(
              (s) => s.date === event.triggerDate && s.symbol === event.symbol,
            );
            expect(stock).toBeDefined();

            const cfg = enabledConfigs.find((c) => c.type === event.strategyType);
            expect(cfg).toBeDefined();

            const benchmark = benchmarkByDate.get(event.triggerDate) ?? null;

            if (event.strategyType === 'single-day-drop') {
              expect(stock!.changePercent <= -cfg!.threshold).toBe(true);
            } else if (event.strategyType === 'underperform-benchmark') {
              expect(benchmark).not.toBeNull();
              expect(benchmark!.changePercent - stock!.changePercent >= cfg!.threshold).toBe(true);
            }
          }

          // 2. Completeness: every qualifying (day, strategy) pair appears in results
          for (const stock of stockChanges) {
            const benchmark = benchmarkByDate.get(stock.date) ?? null;

            for (const cfg of enabledConfigs) {
              let shouldTrigger = false;

              if (cfg.type === 'single-day-drop') {
                shouldTrigger = stock.changePercent <= -cfg.threshold;
              } else if (cfg.type === 'underperform-benchmark') {
                if (benchmark !== null) {
                  shouldTrigger = benchmark.changePercent - stock.changePercent >= cfg.threshold;
                }
              }

              if (shouldTrigger) {
                const found = events.some(
                  (e) =>
                    e.symbol === stock.symbol &&
                    e.triggerDate === stock.date &&
                    e.strategyType === cfg.type,
                );
                expect(found).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
