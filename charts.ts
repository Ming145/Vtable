/**
 * charts.ts — 图表类型检测、单表转换
 */

import type { Grid } from './builder';
import { generateBarChart } from './vbarchart';
import { generatePieChart } from './vpiechart';
import { generateLineChart } from './vlinechart';

export type ChartType = 'bar' | 'pie' | 'line';

const CHART_HEADERS: Record<ChartType, string> = {
	bar: 'vbarchart',
	pie: 'vpie',
	line: 'vline',
};

/** 根据首行表头检测图表类型 */
export function detectChartType(grid: Grid): ChartType | null {
	const h = grid[0]?.[0]?.t?.trim() ?? '';
	if (h === CHART_HEADERS.bar) return 'bar';
	if (h === CHART_HEADERS.pie) return 'pie';
	if (h === CHART_HEADERS.line) return 'line';
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
	}
}
