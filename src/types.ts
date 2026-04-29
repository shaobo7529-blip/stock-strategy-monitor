// ============================================================
// 美股策略监控程序 — 核心数据类型和接口定义
// ============================================================

// --- 配置相关 ---

/** 策略类型 */
export type StrategyType = 'single-day-drop' | 'underperform-benchmark' | 'rsi2-oversold' | 'consecutive-down-days' | 'ma-pullback' | 'cumulative-rsi2' | 'vix-spike' | 'extreme-panic' | 'hammer-reversal';

/** 策略配置 */
export interface StrategyConfig {
  type: StrategyType;
  /** 阈值百分比，如 3 表示 3% */
  threshold: number;
  enabled: boolean;
}

/** 数据源配置 */
export interface DataSourceConfig {
  /** 基准指数代码，默认 ^IXIC */
  benchmarkSymbol: string;
  /** 重试次数，默认 3 */
  retryCount: number;
  /** 重试间隔毫秒，默认 5000 */
  retryIntervalMs: number;
}

/** 查询时间范围 */
export interface DateRange {
  /** ISO 日期字符串 YYYY-MM-DD */
  startDate: string;
  /** ISO 日期字符串 YYYY-MM-DD */
  endDate: string;
}

/** 全局配置对象 */
export interface Configuration {
  /** 股票代码列表，最多10只 */
  stockList: string[];
  /** 启用的策略配置 */
  strategies: StrategyConfig[];
  /** 数据源配置 */
  dataSource: DataSourceConfig;
  /** 查询时间范围 */
  dateRange: DateRange;
}


// --- 行情数据 ---

/** 每日价格数据 */
export interface DailyPrice {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** 每日涨跌幅数据 */
export interface DailyChange {
  /** YYYY-MM-DD */
  date: string;
  symbol: string;
  closePrice: number;
  /** 涨跌幅百分比 */
  changePercent: number;
}

// --- 触发记录 ---

/** 触发事件（策略条件满足时产生） */
export interface TriggerEvent {
  symbol: string;
  triggerDate: string;
  strategyType: string;
  /** 触发日涨跌幅 */
  triggerDayChange: number;
  /** 时间周期：'1d' 日线 | '1wk' 周线 */
  timeframe: string;
}

/** 触发记录（含后续表现） */
export interface TriggerRecord extends TriggerEvent {
  /** 时间周期继承自 TriggerEvent */
  /** 次日涨跌幅，null 表示待更新 */
  nextDayChange: number | null;
  /** 后续 5 天内最大收益（相对触发日收盘价），null 表示待更新 */
  maxGainIn5Days: number | null;
  /** 后续 5 天末的涨跌幅，null 表示待更新 */
  day5Change: number | null;
  /** 信号强度 1-3，null 表示未计算 */
  signalStrength: number | null;
  status: 'completed' | 'pending';
}

// --- 统计摘要 ---

/** 策略统计摘要 */
export interface StrategyStats {
  strategyType: string;
  totalTriggers: number;
  averageNextDayChange: number;
  /** 次日上涨比例 */
  winRate: number;
  /** 5 天内最大收益的平均值 */
  avgMaxGainIn5Days: number;
  /** 5 天内出现正收益的比例 */
  winRateIn5Days: number;
  maxGain: number;
  maxLoss: number;
}

// --- 错误处理 ---

/** 通用结果类型 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** 配置错误 */
export interface ConfigError {
  type: 'invalid_format' | 'invalid_stock_count' | 'invalid_symbol' | 'invalid_threshold';
  message: string;
  field?: string;
}

/** 数据获取错误 */
export interface FetchError {
  type: 'network' | 'not_found' | 'rate_limit' | 'unknown';
  message: string;
  symbol?: string;
}


// --- 技术分析相关 ---

/** MACD 信号类型 */
export type MACDSignal = 'golden_cross' | 'death_cross' | 'histogram_expanding' | 'histogram_shrinking';

/** RSI 信号类型 */
export type RSISignal = 'overbought' | 'oversold' | 'neutral';

/** 量比信号类型 */
export type VolumeRatioSignal = 'high_volume' | 'low_volume' | 'normal_volume';

/** 均线排列信号类型 */
export type MAAlignmentSignal = 'bullish' | 'bearish' | 'tangled';

/** KDJ 信号类型 */
export type KDJSignal = 'golden_cross' | 'death_cross' | 'neutral';

/** KDJ 区域类型 */
export type KDJZone = 'overbought' | 'oversold' | null;

/** 布林带信号类型 */
export type BollingerSignal = 'above_upper' | 'below_lower' | 'within_band';

/** 综合建议类型 */
export type Recommendation = 'bullish' | 'bearish' | 'neutral';

/** 置信度等级 */
export type Confidence = 'strong' | 'medium' | 'weak';

/** MACD 计算结果 */
export interface MACDResult {
  dif: number;
  dea: number;
  macd: number;
  signal: MACDSignal;
}

/** RSI 计算结果 */
export interface RSIResult {
  value: number;
  signal: RSISignal;
}

/** 量比计算结果 */
export interface VolumeRatioResult {
  value: number;
  signal: VolumeRatioSignal;
}

/** 均线排列计算结果 */
export interface MAAlignmentResult {
  ma5: number;
  ma20: number;
  ma50: number;
  signal: MAAlignmentSignal;
  deviations: {
    ma5: number;
    ma20: number;
    ma50: number;
  };
}

/** KDJ 计算结果 */
export interface KDJResult {
  k: number;
  d: number;
  j: number;
  signal: KDJSignal;
  zone: KDJZone;
}

/** 布林带计算结果 */
export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  signal: BollingerSignal;
  percentB: number;
}

/** 综合评分各指标贡献 */
export interface ScoreBreakdown {
  macd: number;
  rsi: number;
  volumeRatio: number;
  maAlignment: number;
  kdj: number;
  bollinger: number;
}

/** 综合评分结果 */
export interface CompositeScoreResult {
  score: number;
  recommendation: Recommendation;
  confidence: Confidence;
  breakdown: ScoreBreakdown;
}

/** 技术分析 API 响应 */
export interface TechnicalAnalysisResponse {
  symbol: string;
  date: string;
  price: number;
  change: number;
  changePercent: number;
  macd: MACDResult | null;
  rsi: RSIResult | null;
  volumeRatio: VolumeRatioResult | null;
  maAlignment: MAAlignmentResult | null;
  kdj: KDJResult | null;
  bollinger: BollingerResult | null;
  composite: CompositeScoreResult;
}
