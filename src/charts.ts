/**
 * charts.ts — 图表类型检测、单表转换
 */

import type { Grid } from './builder';
import { generateBarChart } from './vbarchart';
import { generatePieChart } from './vpiechart';
import { generateLineChart } from './vlinechart';
import { generateComboChart } from './vcombochart';

export type ChartType = 'bar' | 'pie' | 'line' | 'combo';

const CHART_HEADERS: Record<ChartType, string> = {
        bar: 'vbarchart',
        pie: 'vpie',
        line: 'vline',
        combo: 'vbarchart+vline',
};

/** 根据首行表头检测图表类型 */
export function detectChartType(grid: Grid): ChartType | null {
        // 首行全行扫描：任一列出现 vbarchart / vline 标记即图表表（数量不限 → 组合）
        const row0 = grid[0] ?? [];
        const marks: Array<{ t: 'bar' | 'line'; col: number }> = [];
        for (let c = 0; c < row0.length; c++) {
                const h = row0[c]?.t?.trim() ?? '';
                if (h === CHART_HEADERS.bar) marks.push({ t: 'bar', col: c });
                else if (h === CHART_HEADERS.line) marks.push({ t: 'line', col: c });
        }
        // 两个及以上标记，或标记不在 A 列 → 组合渲染器（单段组合退化为单图样式）
        if (marks.length >= 2 || (marks.length === 1 && marks[0].col !== 0)) return 'combo';
        // A 列单标记 → 走各自单图路径
        if (marks.length === 1) return marks[0].t;
        if ((row0[0]?.t?.trim() ?? '') === CHART_HEADERS.pie) return 'pie';
        return null;
}

/** 单表 → 图表 HTML */
export function gridToChart(grid: Grid): string | null {
        const type = detectChartType(grid);
        if (!type) return null;
        switch (type) {
                case 'bar': return generateBarChart(grid);
                case 'pie': return generatePieChart(grid);
                case 'line': return generateLineChart(grid);
                case 'combo': return generateComboChart(grid);
        }
}
