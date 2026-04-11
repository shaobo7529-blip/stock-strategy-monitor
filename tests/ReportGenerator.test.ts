import { describe, it, expect } from 'vitest';
import { generateCSV, generateConsoleSummary, calculateStats } from '../src/ReportGenerator.js';
import { TriggerRecord } from '../src/types.js';

const sampleRecords: TriggerRecord[] = [
  { symbol: 'AAPL', triggerDate: '2024-01-15', strategyType: 'single-day-drop', triggerDayChange: -3.5, nextDayChange: 1.2, maxGainIn5Days: 2.5, day5Change: 1.8, status: 'completed' },
  { symbol: 'MSFT', triggerDate: '2024-01-16', strategyType: 'underperform-benchmark', triggerDayChange: -1.8, nextDayChange: -0.5, maxGainIn5Days: 0.8, day5Change: -0.2, status: 'completed' },
];

describe('ReportGenerator', () => {
  // Validates: Requirements 5.1
  it('generateCSV([]) returns only the header line', () => {
    const csv = generateCSV([]);
    expect(csv).toBe('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change');
  });

  // Validates: Requirements 5.5, 5.6
  it('generateConsoleSummary([]) returns "无触发记录"', () => {
    const summary = generateConsoleSummary([]);
    expect(summary).toBe('无触发记录');
  });

  // Validates: Requirements 5.5, 5.6
  it('generateConsoleSummary with records contains table-like formatting', () => {
    const summary = generateConsoleSummary(sampleRecords);
    expect(summary).toContain('===');
    expect(summary).toContain('策略');
    expect(summary).toContain('触发');
  });

  // Validates: Requirements 5.5, 5.6
  it('generateConsoleSummary with records includes "总记录数:"', () => {
    const summary = generateConsoleSummary(sampleRecords);
    expect(summary).toContain('总记录数:');
  });
});
