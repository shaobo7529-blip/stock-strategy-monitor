// Feature: stock-strategy-monitor, Property 5: 涨跌幅计算正确性

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateDailyChanges } from '../src/DataFetcher.js';
import type { DailyPrice } from '../src/types.js';

/**
 * Validates: Requirements 2.3, 4.2
 *
 * For any two positive numbers previousClose and currentClose, the calculated
 * changePercent should equal (currentClose - previousClose) / previousClose * 100,
 * and the sign should correctly reflect the price movement direction.
 */

// Generator: positive finite doubles suitable for stock prices
const positivePriceArb = fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true });

// Helper: build a two-element DailyPrice array from a pair of close prices
function makePricePair(prevClose: number, currClose: number): DailyPrice[] {
  return [
    { date: '2024-01-01', open: prevClose, close: prevClose, high: prevClose, low: prevClose, volume: 1000 },
    { date: '2024-01-02', open: currClose, close: currClose, high: currClose, low: currClose, volume: 1000 },
  ];
}

describe('DataFetcher Property Tests', () => {
  it('Property 5: changePercent equals (curr - prev) / prev * 100 with correct sign', () => {
    fc.assert(
      fc.property(positivePriceArb, positivePriceArb, (prevClose, currClose) => {
        const prices = makePricePair(prevClose, currClose);
        const changes = calculateDailyChanges(prices, 'TEST');

        expect(changes).toHaveLength(1);

        const expected = ((currClose - prevClose) / prevClose) * 100;
        expect(changes[0].changePercent).toBeCloseTo(expected, 10);

        // Sign correctness
        if (currClose > prevClose) {
          expect(changes[0].changePercent).toBeGreaterThan(0);
        } else if (currClose < prevClose) {
          expect(changes[0].changePercent).toBeLessThan(0);
        } else {
          expect(changes[0].changePercent).toBe(0);
        }

        // Metadata correctness
        expect(changes[0].symbol).toBe('TEST');
        expect(changes[0].date).toBe('2024-01-02');
        expect(changes[0].closePrice).toBe(currClose);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 5b: multi-day sequence produces correct changes for each consecutive pair', () => {
    const priceSequenceArb = fc.array(positivePriceArb, { minLength: 2, maxLength: 20 });

    fc.assert(
      fc.property(priceSequenceArb, (closePrices) => {
        const prices: DailyPrice[] = closePrices.map((close, i) => ({
          date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          open: close,
          close,
          high: close,
          low: close,
          volume: 1000,
        }));

        const changes = calculateDailyChanges(prices, 'MULTI');

        expect(changes).toHaveLength(closePrices.length - 1);

        for (let i = 0; i < changes.length; i++) {
          const expected = ((closePrices[i + 1] - closePrices[i]) / closePrices[i]) * 100;
          expect(changes[i].changePercent).toBeCloseTo(expected, 10);
        }
      }),
      { numRuns: 100 },
    );
  });
});
