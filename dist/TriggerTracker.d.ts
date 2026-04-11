import { TriggerEvent, TriggerRecord } from './types';
export declare function serialize(records: TriggerRecord[]): string;
export declare function deserialize(csv: string): TriggerRecord[];
export declare class TriggerTracker {
    private records;
    constructor(existingCsv?: string);
    recordTrigger(event: TriggerEvent): void;
    updatePerformance(symbol: string, triggerDate: string, nextDayChange: number, maxGainIn5Days: number, day5Change: number): void;
    /** 兼容旧接口 */
    updateNextDayPerformance(symbol: string, triggerDate: string, performance: number): void;
    getPendingTriggers(): TriggerRecord[];
    getAllRecords(): TriggerRecord[];
    toCSV(): string;
}
//# sourceMappingURL=TriggerTracker.d.ts.map