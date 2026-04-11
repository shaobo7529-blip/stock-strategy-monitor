// ============================================================
// ReportGenerator — CSV 报告生成、控制台摘要、策略统计
// ============================================================
const CSV_HEADER = 'symbol,triggerDate,strategyType,triggerDayChange,nextDayChange,maxGainIn5Days,day5Change';
function sortRecords(records) {
    return [...records].sort((a, b) => {
        const symbolCmp = a.symbol.localeCompare(b.symbol);
        if (symbolCmp !== 0)
            return symbolCmp;
        return a.triggerDate.localeCompare(b.triggerDate);
    });
}
export function generateCSV(records) {
    const sorted = sortRecords(records);
    const lines = [CSV_HEADER];
    for (const r of sorted) {
        const nextDay = r.nextDayChange === null ? '' : String(r.nextDayChange);
        const maxGain5 = r.maxGainIn5Days === null ? '' : String(r.maxGainIn5Days);
        const day5 = r.day5Change === null ? '' : String(r.day5Change);
        lines.push(`${r.symbol},${r.triggerDate},${r.strategyType},${r.triggerDayChange},${nextDay},${maxGain5},${day5}`);
    }
    return lines.join('\n');
}
export function calculateStats(records, strategyName) {
    const completed = records.filter((r) => r.status === 'completed' && r.strategyType === strategyName && r.nextDayChange !== null);
    if (completed.length === 0) {
        return {
            strategyType: strategyName, totalTriggers: 0,
            averageNextDayChange: 0, winRate: 0, avgMaxGainIn5Days: 0, winRateIn5Days: 0,
            maxGain: 0, maxLoss: 0,
        };
    }
    const nextDayChanges = completed.map((r) => r.nextDayChange);
    const sum = nextDayChanges.reduce((acc, v) => acc + v, 0);
    const wins = nextDayChanges.filter((v) => v > 0).length;
    // 5-day stats
    const with5Day = completed.filter((r) => r.maxGainIn5Days !== null);
    const maxGains5 = with5Day.map((r) => r.maxGainIn5Days);
    const avgMaxGain5 = maxGains5.length > 0 ? maxGains5.reduce((a, b) => a + b, 0) / maxGains5.length : 0;
    const wins5 = maxGains5.filter((v) => v > 0).length;
    const winRate5 = maxGains5.length > 0 ? wins5 / maxGains5.length : 0;
    return {
        strategyType: strategyName,
        totalTriggers: completed.length,
        averageNextDayChange: sum / completed.length,
        winRate: wins / completed.length,
        avgMaxGainIn5Days: avgMaxGain5,
        winRateIn5Days: winRate5,
        maxGain: Math.max(...nextDayChanges),
        maxLoss: Math.min(...nextDayChanges),
    };
}
export function generateConsoleSummary(records) {
    if (records.length === 0)
        return '无触发记录';
    const strategyTypes = [...new Set(records.map((r) => r.strategyType))].sort();
    const lines = ['=== 策略监控摘要 ===', ''];
    const header = padRow(['策略', '触发', '次日均值', '次日胜率', '5日最大均值', '5日胜率']);
    lines.push(header, '-'.repeat(header.length));
    for (const st of strategyTypes) {
        const s = calculateStats(records, st);
        lines.push(padRow([s.strategyType, String(s.totalTriggers),
            fmt(s.averageNextDayChange), fmt(s.winRate * 100),
            fmt(s.avgMaxGainIn5Days), fmt(s.winRateIn5Days * 100)]));
    }
    lines.push(`总记录数: ${records.length}`);
    return lines.join('\n');
}
function fmt(v) { return `${v.toFixed(2)}%`; }
function padRow(cols) {
    const widths = [26, 8, 12, 12, 14, 12];
    return cols.map((col, i) => col.padEnd(widths[i] || 12)).join('| ');
}
//# sourceMappingURL=ReportGenerator.js.map