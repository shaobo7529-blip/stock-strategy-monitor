import { describe, it, expect } from 'vitest';
import { TriggerTracker, serialize, deserialize } from '../src/TriggerTracker.js';
import type { TriggerEvent } from '../src/types.js';

describe('TriggerTracker', () => {
  // Requirements: 4.3 — 触发日为最近交易日时标记 pending
  it('should mark new trigger records as pending with null nextDayChange', () => {
    const tracker = new TriggerTracker();
    const event: TriggerEvent = {
      symbol: 'AAPL',
      triggerDate: '2024-12-20',
      strategyType: 'single-day-drop',
      triggerDayChange: -3.5,
    };

    tracker.recordTrigger(event);

    const pending = tracker.getPendingTriggers();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
    expect(pending[0].nextDayChange).toBeNull();
  });

  it('should update pending record to completed with next day performance', () => {
    const tracker = new TriggerTracker();
    tracker.recordTrigger({
      symbol: 'MSFT',
      triggerDate: '2024-12-19',
      strategyType: 'underperform-benchmark',
      triggerDayChange: -1.2,
    });

    tracker.updateNextDayPerformance('MSFT', '2024-12-19', 2.1);

    const all = tracker.getAllRecords();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('completed');
    expect(all[0].nextDayChange).toBe(2.1);
    expect(tracker.getPendingTriggers()).toHaveLength(0);
  });

  // Requirements: 4.4 — CSV 文件不存在时创建新文件（从空状态开始）
  it('should initialize with empty records when no CSV is provided', () => {
    const tracker = new TriggerTracker();
    expect(tracker.getAllRecords()).toHaveLength(0);
    expect(tracker.toCSV()).toBe('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status');
  });

  it('should initialize with empty records when CSV is empty string', () => {
    const tracker = new TriggerTracker('');
    expect(tracker.getAllRecords()).toHaveLength(0);
  });

  it('should load existing records from CSV', () => {
    const csv = [
      'symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status',
      'AAPL,2024-12-18,single-day-drop,-4.2,1.5,completed',
      'GOOG,2024-12-19,underperform-benchmark,-1.8,,pending',
    ].join('\n');

    const tracker = new TriggerTracker(csv);
    const records = tracker.getAllRecords();

    expect(records).toHaveLength(2);
    expect(records[0].symbol).toBe('AAPL');
    expect(records[0].nextDayChange).toBe(1.5);
    expect(records[0].status).toBe('completed');
    expect(records[1].symbol).toBe('GOOG');
    expect(records[1].nextDayChange).toBeNull();
    expect(records[1].status).toBe('pending');
  });

  it('should serialize records back to CSV after adding new triggers', () => {
    const tracker = new TriggerTracker();
    tracker.recordTrigger({
      symbol: 'TSLA',
      triggerDate: '2024-12-20',
      strategyType: 'single-day-drop',
      triggerDayChange: -5.0,
    });

    const csv = tracker.toCSV();
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status');
    expect(lines[1]).toBe('TSLA,2024-12-20,single-day-drop,-5,,,,pending');
  });
});

describe('serialize / deserialize', () => {
  it('should produce header-only CSV for empty list', () => {
    const csv = serialize([]);
    expect(csv).toBe('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status');
  });

  it('should handle header-only CSV on deserialize', () => {
    const records = deserialize('symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status');
    expect(records).toHaveLength(0);
  });
});
