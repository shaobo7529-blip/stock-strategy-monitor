// Feature: stock-strategy-monitor, Property 2: 触发记录序列化往返一致性

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { serialize, deserialize } from '../src/TriggerTracker.js';
import type { TriggerRecord } from '../src/types.js';

/**
 * Validates: Requirements 6.5, 6.6, 6.7
 *
 * For any valid TriggerRecord list, serializing it via serialize() and then
 * deserializing it back via deserialize() should yield an equivalent list.
 * i.e. deserialize(serialize(records)) === records
 */

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
  triggerDayChange: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  nextDayChange: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  status: fc.constant('completed' as const),
});

const pendingRecordArb: fc.Arbitrary<TriggerRecord> = fc.record({
  symbol: stockSymbolArb,
  triggerDate: dateStringArb,
  strategyType: strategyTypeArb,
  triggerDayChange: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  nextDayChange: fc.constant(null),
  status: fc.constant('pending' as const),
});

const triggerRecordArb = fc.oneof(completedRecordArb, pendingRecordArb);

const triggerRecordListArb = fc.array(triggerRecordArb, { minLength: 0, maxLength: 20 });

// --- Property Test ---

describe('TriggerTracker Property Tests', () => {
  it('Property 2: deserialize(serialize(records)) should equal records (round-trip consistency)', () => {
    fc.assert(
      fc.property(triggerRecordListArb, (records) => {
        const csv = serialize(records);
        const result = deserialize(csv);

        expect(result).toHaveLength(records.length);
        for (let i = 0; i < records.length; i++) {
          expect(result[i].symbol).toBe(records[i].symbol);
          expect(result[i].triggerDate).toBe(records[i].triggerDate);
          expect(result[i].strategyType).toBe(records[i].strategyType);
          expect(result[i].triggerDayChange).toBeCloseTo(records[i].triggerDayChange, 10);
          expect(result[i].status).toBe(records[i].status);
          if (records[i].nextDayChange === null) {
            expect(result[i].nextDayChange).toBeNull();
          } else {
            expect(result[i].nextDayChange).toBeCloseTo(records[i].nextDayChange!, 10);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
