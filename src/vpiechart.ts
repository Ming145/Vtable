/**
 * vpiechart.ts
 * 将 vtable 格式的饼图配置数据转换为 Mermaid 饼图代码块
 */

import type { Grid } from './builder';

const HEADER_LABELS = ['vpie', '标题'];

export function generatePieChart(grid: Grid): string | null {
	if (grid.length < 3) return null;

	for (let i = 0; i < HEADER_LABELS.length; i++) {
		if ((grid[i]?.[0]?.t?.trim() ?? '') !== HEADER_LABELS[i]) return null;
	}

	const title = grid[1]?.[1]?.t?.trim() ?? '';

	const data: Array<{ label: string; value: number }> = [];
	for (let i = 2; i < grid.length; i++) {
		const label = grid[i]?.[0]?.t?.trim();
		const valStr = grid[i]?.[1]?.t?.trim();
		if (!label || !valStr) continue;
		if (/^…+/.test(label)) continue;
		const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ''));
		if (isNaN(value) || value <= 0) continue;
		data.push({ label, value });
	}
	if (data.length === 0) return null;

	const lines: string[] = [];
	lines.push('```mermaid');
	lines.push('pie showData');
	if (title) lines.push(`    title ${title}`);
	for (const d of data) {
		lines.push(`    "${d.label}" : ${d.value}`);
	}
	lines.push('```');

	return lines.join('\n');
}
