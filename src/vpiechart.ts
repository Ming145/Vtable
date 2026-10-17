/**
 * vpiechart.ts
 * 将 vtable 格式的饼图配置数据转换为 Mermaid 饼图代码块
 */

import type { Grid } from './builder';
import { isChartTitle } from './chart-labels';

export function generatePieChart(grid: Grid): string | null {
        if (grid.length < 3) return null;
        // 类型标记已由 detectChartType 判定；标题行按内容识别（Row 1，中英兼容）
        if ((grid[0]?.[0]?.t?.trim() ?? '') !== 'vpie') return null;

        const title = isChartTitle(grid[1]?.[0]?.t?.trim() ?? '') ? (grid[1]?.[1]?.t?.trim() ?? '') : '';

        const data: Array<{ label: string; value: number }> = [];
        for (let i = 1; i < grid.length; i++) {
                const label = grid[i]?.[0]?.t?.trim();
                if (isChartTitle(label ?? '')) continue; // 标题行跳过
                const valStr = grid[i]?.[1]?.t?.trim();
                if (!label || !valStr) continue;
                if (/^…+/.test(label)) continue;
                const value = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
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
