// ============================================================
// TriggerTracker — 触发记录管理、CSV 序列化/反序列化
// ============================================================

import { TriggerEvent, TriggerRecord } from './types';

const CSV_HEADER = 'symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change,status';

export function serialize(records: TriggerRecord[]): string {
  const lines = [CSV_HEADER];
  for (const r of records) {
    const nextDay = r.nextDayChange === null ? '' : String(r.nextDayChange);
    const maxGain5 = r.maxGainIn5Days === null ? '' : String(r.maxGainIn5Days);
    const day5 = r.day5Change === null ? '' : String(r.day5Change);
    lines.push(`${r.symbol},${r.triggerDate},${r.strategyType},${r.triggerDayChange},${nextDay},${maxGain5},${day5},${r.status}`);
  }
  return lines.join('\n');
}

export function deserialize(csv: string): TriggerRecord[] {
  const lines = csv.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const firstLine = lines[0];
  const dataLines = firstLine.startsWith('symbol,') ? lines.slice(1) : lines;
  return dataLines.map(parseLine);
}

function parseLine(line: string): TriggerRecord {
  const parts = line.split(',');
  if (parts.length < 6) throw new Error(`Invalid CSV line: ${line}`);
  const [symbol, triggerDate, strategyType, triggerDayChangeStr, nextDayChangeStr] = parts;
  const maxGainStr = parts[5] || '';
  const day5Str = parts[6] || '';
  const status = (parts[7] || parts[5] || 'pending') as 'completed' | 'pending';
  return {
    symbol, triggerDate, strategyType,
    triggerDayChange: Number(triggerDayChangeStr),
    nextDayChange: nextDayChangeStr === '' ? null : Number(nextDayChangeStr),
    maxGainIn5Days: maxGainStr === '' || isNaN(Number(maxGainStr)) ? null : Number(maxGainStr),
    day5Change: day5Str === '' || isNaN(Number(day5Str)) ? null : Number(day5Str),
    status: (status === 'completed' || status === 'pending') ? status : 'pending',
  };
}

export class TriggerTracker {
  private records: TriggerRecord[] = [];

  constructor(existingCsv?: string) {
    if (existingCsv !== undefined && existingCsv.trim() !== '') {
      try { this.records = deserialize(existingCsv); } catch { this.records = []; }
    }
  }

  recordTrigger(event: TriggerEvent): void {
    this.records.push({
      ...event,
      nextDayChange: null,
      maxGainIn5Days: null,
      day5Change: null,
      status: 'pending',
    });
  }

  updatePerformance(symbol: string, triggerDate: string, nextDayChange: number, maxGainIn5Days: number, day5Change: number): void {
    for (const r of this.records) {
      if (r.symbol === symbol && r.triggerDate === triggerDate && r.status === 'pending') {
        r.nextDayChange = nextDayChange;
        r.maxGainIn5Days = maxGainIn5Days;
        r.day5Change = day5Change;
        r.status = 'completed';
        break;
      }
    }
  }

  /** 兼容旧接口 */
  updateNextDayPerformance(symbol: string, triggerDate: string, performance: number): void {
    this.updatePerformance(symbol, triggerDate, performance, performance, performance);
  }

  getPendingTriggers(): TriggerRecord[] { return this.records.filter((r) => r.status === 'pending'); }
  getAllRecords(): TriggerRecord[] { return [...this.records]; }
  toCSV(): string { return serialize(this.records); }
}
