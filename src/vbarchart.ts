/**
 * vbarchart.ts
 * 将 vtable 格式的柱状图配置数据转换为 HTML/SVG（单行输出，支持深色/浅色模式）
 */

import type { Grid } from './builder';

const HEADER_LABELS = ['vbarchart', '标题', 'v%', 'x范围', 'x', 'y范围', 'y'];

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 解析 grid，若符合柱状图表格格式则返回单行 HTML，否则返回 null。
 * 格式要求：
 *   Row 0: ["vbarchart", ""]
 *   Row 1: ["标题", "标题文本"]
 *   Row 2: ["v%", "是/否"]
 *   Row 3: ["x范围", "0-100"]
 *   Row 4: ["x", "x轴标签"]
 *   Row 5: ["y范围", "0-100"]
 *   Row 6: ["y", "y轴标签"]
 *   Row 7+: ["标签", "数值"]
 */
export function generateBarChart(grid: Grid): string | null {
	if (grid.length < 8) return null;

	for (let i = 0; i < HEADER_LABELS.length; i++) {
		const cellText = grid[i]?.[0]?.t?.trim() ?? '';
		if (cellText !== HEADER_LABELS[i]) return null;
	}

	const get = (idx: number) => grid[idx]?.[1]?.t?.trim() ?? '';
	const title = get(1);
	const vPercent = get(2);
	const xLabel = get(4);
	const yLabel = get(6);

	const showPercent = vPercent === '是' || vPercent === 'yes' || vPercent === '1';

	// 解析 y 范围
	let yMax = 100;
	const yRangeRaw = get(5);
	const yMatch = yRangeRaw.match(/([\d.]+)\s*-\s*([\d.]+)/);
	if (yMatch) yMax = parseFloat(yMatch[2]);

	// 收集数据行
	const data: Array<{ label: string; value: number }> = [];
	for (let i = 7; i < grid.length; i++) {
		const label = grid[i]?.[0]?.t?.trim();
		const valStr = grid[i]?.[1]?.t?.trim();
		if (!label || !valStr) continue;
		if (/^…+/.test(label)) continue; // 跳过占位描述行
		const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ''));
		if (isNaN(value)) continue;
		data.push({ label, value });
	}
	if (data.length === 0) return null;

	const n = data.length;
	const chartTop = 80;
	const chartBottom = 330;
	const chartHeight = chartBottom - chartTop; // 250
	const chartLeft = 80;
	const chartRight = 540;
	const chartWidth = chartRight - chartLeft; // 460
	const barWidth = 55;
	const pixelPerUnit = yMax > 0 ? chartHeight / yMax : 1;
	const spacing = (chartWidth - n * barWidth) / (n + 1);

	// 浅色 / 深色柱状颜色
	const lightColors = ['#111', '#333', '#555', '#777', '#999', '#aaa'];
	const darkColor = '#60A5FA';

	// ===== 构建样式 =====
	const cls = '.chart-container';
	const mc = '.main-title';
	const gl = '.grid-line';
	const al = '.axis-line';
	const at = '.axis-label';
	const bv = '.bar-value';
	const xl = '.x-label';

	const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`
		+ `${mc}{text-align:center;font-size:28px;font-weight:700;margin:0 0 20px;color:#111}`
		+ `${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${bv}{fill:#111}${xl}{fill:#333}`;

	let sBars = '';
	for (let i = 0; i < n; i++) sBars += `.bar-${i}{fill:${lightColors[i % lightColors.length]}}`;

	const sDark = `@media(prefers-color-scheme:dark){${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}`
		+ `${mc}{color:#F9FAFB}${gl}{stroke:rgba(255,255,255,.08)}${al}{stroke:#6B7280}${at}{fill:#9CA3AF}${bv}{fill:#F9FAFB}${xl}{fill:#D1D5DB}`;
	let sBarsDark = '';
	for (let i = 0; i < n; i++) sBarsDark += `.bar-${i}{fill:${darkColor}}`;
	const sDarkClose = '}';

	const style = sLight + sBars + sDark + sBarsDark + sDarkClose;

	// ===== 构建 SVG =====
	const parts: string[] = [];

	// 水平网格线 & y 轴标签（5 条线：0%, 25%, 50%, 75%, 100%）
	const ySteps = 4;
	for (let i = 1; i <= ySteps; i++) {
		const y = chartTop + (chartHeight / ySteps) * i;
		parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="grid-line"/>`);
	}
	for (let i = 0; i <= ySteps; i++) {
		const y = chartBottom - (chartHeight / ySteps) * i;
		const val = Math.round(yMax * i / ySteps);
		const label = showPercent ? val + '%' : String(val);
		parts.push(`<text x="${chartLeft - 25}" y="${y + 4}" text-anchor="end" font-size="12" class="axis-label">${label}</text>`);
	}

	// 坐标轴
	parts.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
	parts.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);

	// 柱子 & 标签
	for (let i = 0; i < n; i++) {
		const x = Math.round(chartLeft + spacing + i * (barWidth + spacing));
		const barHeight = Math.min(data[i].value * pixelPerUnit, chartHeight);
		const barY = chartBottom - barHeight;
		parts.push(`<rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="8" class="bar-${i}"/>`);

		const displayVal = showPercent ? Math.round(data[i].value) + '%' : String(Math.round(data[i].value * 10) / 10);
		parts.push(`<text x="${x + barWidth / 2}" y="${barY - 15}" text-anchor="middle" font-size="14" font-weight="600" class="bar-value">${escapeXml(displayVal)}</text>`);

		parts.push(`<text x="${x + barWidth / 2}" y="${chartBottom + 30}" text-anchor="middle" font-size="14" class="x-label">${escapeXml(data[i].label)}</text>`);
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
