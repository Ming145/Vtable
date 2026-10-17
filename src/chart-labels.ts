/**
 * chart-labels.ts — 图表表格行关键词的中英变体匹配
 * 英文模板（Title / x range / y range）与中文模板（标题 / x范围 / y范围）同语法，仅标签不同。
 * 'x' / 'y' / 'v%' 与 v% 值（是/yes/1、否/no）中英一致，无需变体。
 */

const TITLE_VARIANTS = ['标题', 'Title'];
const X_RANGE_VARIANTS = ['x范围', 'x range'];
const Y_RANGE_VARIANTS = ['y范围', 'y range'];

export function isChartTitle(t: string): boolean {
        return TITLE_VARIANTS.includes(t);
}
export function isChartXRange(t: string): boolean {
        return X_RANGE_VARIANTS.includes(t);
}
export function isChartYRange(t: string): boolean {
        return Y_RANGE_VARIANTS.includes(t);
}
/** v% 值判断：任一语言填"是"均显示百分比 */
export function isChartPercentOn(t: string): boolean {
        return t === '是' || t === 'yes' || t === '1';
}
