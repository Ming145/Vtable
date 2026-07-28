/**
 * vlinechart.ts
 * 将 vtable 格式的折线图配置数据转换为 HTML/SVG（单行输出，支持深色/浅色模式）
 */

import type { Grid } from './builder';

const HEADER_LABELS = ['vline', '标题', 'x范围', 'x', 'y范围', 'y'];

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateLineChart(grid: Grid): string | null {
	if (grid.length < 7) return null;

	for (let i = 0; i < HEADER_LABELS.length; i++) {
		if ((grid[i]?.[0]?.t?.trim() ?? '') !== HEADER_LABELS[i]) return null;
	}

	const get = (idx: number) => grid[idx]?.[1]?.t?.trim() ?? '';
	const title = get(1);
	const xLabel = get(3);
	const yLabel = get(5);

	let yMax = 100;
	const yRangeRaw = get(4);
	const yMatch = yRangeRaw.match(/([\d.]+)\s*-\s*([\d.]+)/);
	if (yMatch) yMax = parseFloat(yMatch[2]);

	// 收集数据行
	const data: Array<{ label: string; value: number }> = [];
	for (let i = 6; i < grid.length; i++) {
		const label = grid[i]?.[0]?.t?.trim();
		const valStr = grid[i]?.[1]?.t?.trim();
		if (!label || !valStr) continue;
		if (/^…+/.test(label)) continue;
		const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ''));
		if (isNaN(value)) continue;
		data.push({ label, value });
	}
	if (data.length < 2) return null;

	const n = data.length;
	const chartTop = 80;
	const chartBottom = 330;
	const chartHeight = chartBottom - chartTop;
	const chartLeft = 80;
	const chartRight = 540;
	const chartWidth = chartRight - chartLeft;
	const pixelPerUnit = yMax > 0 ? chartHeight / yMax : 1;

	const stepX = chartWidth / (n - 1);
	const points: Array<{ x: number; y: number }> = [];
	for (let i = 0; i < n; i++) {
		const x = Math.round(chartLeft + i * stepX);
		const y = Math.round(chartBottom - data[i].value * pixelPerUnit);
		points.push({ x, y });
	}

	const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

	// 样式类
	const cls = '.chart-container';
	const mc = '.main-title';
	const gl = '.grid-line';
	const al = '.axis-line';
	const at = '.axis-label';
	const dv = '.data-value';
	const xl = '.x-label';
	const ln = '.line-path';
	const dot = '.data-dot';

	const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`
		+ `${mc}{text-align:center;font-size:28px;font-weight:700;margin:0 0 20px;color:#111}`
		+ `${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${dv}{fill:#111}${xl}{fill:#333}`
		+ `${ln}{fill:none;stroke:#111;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}`
		+ `${dot}{fill:#111}`;

	const sDark = `@media(prefers-color-scheme:dark){${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}`
		+ `${mc}{color:#F9FAFB}${gl}{stroke:rgba(255,255,255,.08)}${al}{stroke:#6B7280}${at}{fill:#9CA3AF}${dv}{fill:#F9FAFB}${xl}{fill:#D1D5DB}`
		+ `${ln}{stroke:#60A5FA}${dot}{fill:#60A5FA}`;

	const style = sLight + sDark + '}';

	const parts: string[] = [];

	// 水平网格线 & Y 轴标签
	const ySteps = 4;
	for (let i = 1; i <= ySteps; i++) {
		const y = chartTop + (chartHeight / ySteps) * i;
		parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="grid-line"/>`);
	}
	for (let i = 0; i <= ySteps; i++) {
		const y = chartBottom - (chartHeight / ySteps) * i;
		const val = Math.round(yMax * i / ySteps);
		parts.push(`<text x="${chartLeft - 10}" y="${y + 4}" text-anchor="end" font-size="12" class="axis-label">${val}</text>`);
	}

	// 坐标轴
	parts.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
	parts.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);

	// 数据折线
	parts.push(`<polyline points="${polylinePoints}" class="line-path" fill="none" stroke="#111" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`);

	// 数据点、值标签、X 轴标签
	for (let i = 0; i < n; i++) {
		const { x, y } = points[i];
		parts.push(`<circle cx="${x}" cy="${y}" r="5" class="data-dot"/>`);
		const displayVal = String(Math.round(data[i].value * 10) / 10);
		parts.push(`<text x="${x}" y="${y - 15}" text-anchor="middle" font-size="14" font-weight="600" class="data-value">${escapeXml(displayVal)}</text>`);
		parts.push(`<text x="${x}" y="${chartBottom + 30}" text-anchor="middle" font-size="14" class="x-label">${escapeXml(data[i].label)}</text>`);
	}

	// 坐标轴标题
	if (xLabel) {
		parts.push(`<text x="310" y="${chartBottom + 70}" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(xLabel)}</text>`);
	}
	if (yLabel) {
		parts.push(`<text x="20" y="210" transform="rotate(-90 20 210)" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(yLabel)}</text>`);
	}

	const svgContent = parts.join('');
	const svg = `<svg width="600" height="${chartBottom + 90}" viewBox="0 0 600 ${chartBottom + 90}">${svgContent}</svg>`;
	const titleHtml = title ? `<h1 class="main-title">${escapeXml(title)}</h1>` : '';

	return `<div class="chart-container"><style>${style}</style>${titleHtml}${svg}</div>`;
}
