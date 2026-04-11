// Feature: stock-strategy-monitor, Property 9: 报告完整性
// **Validates: Requirements 5.1, 5.2**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateCSV, calculateStats } from '../src/ReportGenerator.js';
import type { TriggerRecord } from '../src/types.js';

// --- Generators ---

const stockSymbolArb = fc.stringMatching(/^[A-Z]{1,5}$/);

const dateStringArb = fc
  .record({
    year: fc.integer({ min: 2000, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

const strategyTypeArb = fc.constantFrom('single-day-drop', 'underperform-benchmark');

const completedRecordArb: fc.Arbitrary<TriggerRecord> = fc.record({
  symbol: stockSymbolArb,
  triggerDate: dateStringArb,
  strategyType: strategyTypeArb,
  triggerDayChange: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
  nextDayChange: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
  maxGainIn5Days: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
  day5Change: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
  status: fc.constant('completed' as const),
});

const pendingRecordArb: fc.Arbitrary<TriggerRecord> = fc.record({
  symbol: stockSymbolArb,
  triggerDate: dateStringArb,
  strategyType: strategyTypeArb,
  triggerDayChange: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
  nextDayChange: fc.constant(null),
  maxGainIn5Days: fc.constant(null),
  day5Change: fc.constant(null),
  status: fc.constant('pending' as const),
});

const triggerRecordArb = fc.oneof(completedRecordArb, pendingRecordArb);

// --- Property Test ---

describe('ReportGenerator Property Tests', () => {
  it('Property 9: CSV 数据行数等于输入记录数，每行包含五个必要字段', () => {
    fc.assert(
      fc.property(fc.array(triggerRecordArb, { minLength: 0, maxLength: 50 }), (records: TriggerRecord[]) => {
        const csv = generateCSV(records);
        const lines = csv.split('\n');

        // First line is always the header
        expect(lines[0]).toBe('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change');

        // Data lines = total lines - 1 (header)
        const dataLines = lines.slice(1);
        expect(dataLines.length).toBe(records.length);

        // Each data line must have exactly 7 comma-separated fields
        for (const line of dataLines) {
          const fields = line.split(',');
          expect(fields.length).toBe(7);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: stock-strategy-monitor, Property 10: 报告排序正确性
  // **Validates: Requirements 5.3**
  it('Property 10: 报告按股票代码升序、同代码内按日期升序排列', () => {
    fc.assert(
      fc.property(fc.array(triggerRecordArb, { minLength: 0, maxLength: 50 }), (records: TriggerRecord[]) => {
        const csv = generateCSV(records);
        const lines = csv.split('\n');
        const dataLines = lines.slice(1); // skip header

        // Extract symbol and triggerDate from each CSV data line
        const parsed = dataLines.map((line) => {
          const fields = line.split(',');
          return { symbol: fields[0], triggerDate: fields[1] };
        });

        // Verify sorting: symbol ascending (localeCompare), within same symbol by triggerDate ascending
        for (let i = 1; i < parsed.length; i++) {
          const prev = parsed[i - 1];
          const curr = parsed[i];
          const symbolCmp = prev.symbol.localeCompare(curr.symbol);
          if (symbolCmp > 0) {
            return false; // symbol not in ascending order
          }
          if (symbolCmp === 0 && prev.triggerDate.localeCompare(curr.triggerDate) > 0) {
            return false; // same symbol but date not in ascending order
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  // Feature: stock-strategy-monitor, Property 11: 统计摘要数学一致性
  // **Validates: Requirements 5.4**
  it('Property 11: 统计摘要数学一致性 — averageNextDayChange/winRate/maxGain/maxLoss/totalTriggers 一致', () => {
    const fixedStrategyType = 'single-day-drop';

    const completedRecordWithFixedStrategyArb: fc.Arbitrary<TriggerRecord> = fc.record({
      symbol: stockSymbolArb,
      triggerDate: dateStringArb,
      strategyType: fc.constant(fixedStrategyType),
      triggerDayChange: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
      nextDayChange: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
      maxGainIn5Days: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
      day5Change: fc.double({ min: -99, max: 99, noNaN: true, noDefaultInfinity: true }),
      status: fc.constant('completed' as const),
    });

    fc.assert(
      fc.property(
        fc.array(completedRecordWithFixedStrategyArb, { minLength: 1, maxLength: 50 }),
        (records: TriggerRecord[]) => {
          const stats = calculateStats(records, fixedStrategyType);

          // (1) averageNextDayChange is between maxLoss and maxGain
          expect(stats.averageNextDayChange).toBeGreaterThanOrEqual(stats.maxLoss);
          expect(stats.averageNextDayChange).toBeLessThanOrEqual(stats.maxGain);

          // (2) winRate is between 0 and 1
          expect(stats.winRate).toBeGreaterThanOrEqual(0);
          expect(stats.winRate).toBeLessThanOrEqual(1);

          // (3) maxGain >= maxLoss
          expect(stats.maxGain).toBeGreaterThanOrEqual(stats.maxLoss);

          // (4) totalTriggers equals the number of completed records with matching strategyType
          const expectedCount = records.filter(
            (r) => r.status === 'completed' && r.strategyType === fixedStrategyType && r.nextDayChange !== null,
          ).length;
          expect(stats.totalTriggers).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
