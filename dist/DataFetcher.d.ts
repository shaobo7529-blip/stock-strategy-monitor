import type { DailyPrice, DailyChange, FetchError, Result } from './types.js';
export declare function fetchStockHistory(symbol: string, startDate: Date, endDate: Date, retryCount?: number, retryIntervalMs?: number, interval?: string): Promise<Result<DailyPrice[], FetchError>>;
export declare function fetchIndexHistory(symbol: string, startDate: Date, endDate: Date, retryCount?: number, retryIntervalMs?: number, interval?: string): Promise<Result<DailyPrice[], FetchError>>;
export declare function validateSymbol(symbol: string): Promise<boolean>;
export declare function calculateDailyChanges(prices: DailyPrice[], symbol: string): DailyChange[];
//# sourceMappingURL=DataFetcher.d.ts.map