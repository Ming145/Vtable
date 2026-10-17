/**
 * vpiechart.ts
 * 将 vtable 格式的饼图配置数据转换为 Mermaid 饼图代码块
 */

import type { Grid } from './builder';

const HEADER_VARIANTS: string[][] = [['vpie'], ['标题', 'Title']];

export function generatePieChart(grid: Grid): string | null {
        if (grid.length < 3) return null;

        let headerIdx = 0;
        for (let i = 0; i < grid.length && headerIdx < HEADER_VARIANTS.length; i++) {
                const cellText = grid[i]?.[0]?.t?.trim() ?? '';
                if (!HEADER_VARIANTS[headerIdx].includes(cellText)) return null;
                headerIdx++;
        }
        if (headerIdx < HEADER_VARIANTS.length) return null;

        const title = grid[1]?.[1]?.t?.trim() ?? '';

        const data: Array<{ label: string; value: number }> = [];
        for (let i = 2; i < grid.length; i++) {
                const label = grid[i]?.[0]?.t?.trim();
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
