/**
 * vcombochart.ts — 组合图表：任意数量的柱状图/折线图纵向拼合在一张大表格里，渲染为一张 SVG
 *
 * 表格结构（每段占 2 列，段数不限，纵向拼合）：
 *   Row 0: 类型声明并排——每个段的左列填 vbarchart / vline（如 vbarchart｜｜vline｜）
 *   Row 1: ["标题", "文本", ...] ← 全表共用标题（填在最左段）
 *   各段在自己的两列里填配置行（x范围 / x / y范围 / y / v%）与数据行（类目｜数值），
 *   不同段的行可同行并排（y范围、y 等）也可错行——逐格扫描，行序宽容
 *
 * 解析规则：
 *   - 标题 / x 轴名 / y 轴名取【最左侧段】的值（用户指定：轴名称选最左侧的表）
 *   - 量程：所有段 y范围 的下界取最小、上界取最大（如 0-3 与 1-5 → 0-5）
 *   - 类目轴 = 最左柱状段的类目；无柱段时取最左段类目
 *   - 其他段数据行类目与轴相同标签对齐；不同则忽略
 *   - v% 是柱状图专属开关（任一柱段 v%=是 → 柱值显示百分比）
 */

import type { Grid } from './builder';
import { isChartTitle, isChartYRange, isChartPercentOn } from './chart-labels';

function escapeXml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 解析 y 范围文本："20-80" → {min:20,max:80}；"100" → {min:0,max:100}；解析失败 → {min:0,max:100} */
function parseRange(raw: string): { min: number; max: number } {
        const m = raw.match(/(-?[\d.]+)\s*-\s*(-?[\d.]+)/);
        if (m) {
                const min = parseFloat(m[1]);
                const max = parseFloat(m[2]);
                if (!isNaN(min) && !isNaN(max) && max > min) return { min, max };
        }
        const v = parseFloat(raw.replace(/[^0-9.-]/g, ''));
        if (!isNaN(v) && v > 0) return { min: 0, max: v };
        return { min: 0, max: 100 };
}

/** 首行扫描：返回所有段（类型 + 左列号），按列序排列 */
function scanSegments(grid: Grid): Array<{ type: 'bar' | 'line'; col: number }> {
        const segs: Array<{ type: 'bar' | 'line'; col: number }> = [];
        const row0 = grid[0] ?? [];
        for (let c = 0; c < row0.length; c++) {
                const t = row0[c]?.t?.trim() ?? '';
                if (t === 'vbarchart') segs.push({ type: 'bar', col: c });
                else if (t === 'vline') segs.push({ type: 'line', col: c });
        }
        return segs;
}

export function generateComboChart(grid: Grid): string | null {
        if (grid.length < 5) return null;

        const segments = scanSegments(grid);
        if (segments.length === 0) return null;

        const KEYWORDS = new Set(['标题', 'Title', 'x范围', 'x range', 'x', 'y范围', 'y range', 'y', 'v%', 'vbarchart', 'vline', 'vpie']);

        // ===== 逐段逐行扫描解析 =====
        interface Seg {
                type: 'bar' | 'line';
                range: { min: number; max: number };
                data: Array<{ label: string; value: number }>;
        }
        const parsed: Seg[] = segments.map(s => ({ type: s.type, range: { min: 0, max: 100 }, data: [] }));
        let title = '';
        let xAxisName = '';
        let yAxisName = '';
        let vPercent = '';

        for (let i = 1; i < grid.length; i++) {
                for (let k = 0; k < segments.length; k++) {
                        const a = grid[i]?.[segments[k].col]?.t?.trim() ?? '';
                        const b = grid[i]?.[segments[k].col + 1]?.t?.trim() ?? '';
                        const seg = parsed[k];

                        if (isChartYRange(a)) { seg.range = parseRange(b); continue; }
                        if (a === 'v%' && seg.type === 'bar') {
                                // 多柱段多行 v%：任一段填"是"即显示百分比（混合填法不互相覆盖）
                                if (isChartPercentOn(b)) vPercent = b;
                                continue;
                        }
                        if (a && !KEYWORDS.has(a)) {
                                const v = parseFloat(b.replace(/[^0-9.-]/g, ''));
                                if (!isNaN(v)) seg.data.push({ label: a, value: v });
                        }

                        // 标题/轴名只从最左段取（x 轴名=x 行右列，y 轴名=y 行右列）
                        if (k === 0) {
                                if (isChartTitle(a)) title = b;
                                else if (a === 'x') xAxisName = b;
                                else if (a === 'y') yAxisName = b;
                        }
                }
        }

        // 有数据的段才参与渲染（声明了标记但没填数据的段忽略）
        const active = parsed.filter(s => s.data.length > 0);
        if (active.length === 0) return null;

        // ===== 量程：所有段下界取最小、上界取最大 =====
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const s of active) {
                yMin = Math.min(yMin, s.range.min);
                yMax = Math.max(yMax, s.range.max);
        }
        const span = yMax - yMin;
        if (!(span > 0)) return null;

        const showPercent = vPercent === '是' || vPercent === 'yes' || vPercent === '1';

        // ===== 类目轴：最左柱状段的类目，无柱段则最左段类目 =====
        const barSegs = active.filter(s => s.type === 'bar');
        const axisSeg = barSegs[0] ?? active[0];
        const cats = axisSeg.data.map(d => d.label);
        const catIndex = new Map(cats.map((c, i) => [c, i]));
        const n = cats.length;
        if (n === 0) return null;

        // ===== 几何（沿用单柱图尺寸常量） =====
        const chartTop = 80;
        const chartBottom = 330;
        const chartHeight = chartBottom - chartTop; // 250
        const chartLeft = 80;
        const chartRight = 540;
        const chartWidth = chartRight - chartLeft; // 460
        const pixelPerUnit = chartHeight / span;
        const yOf = (v: number) => chartBottom - (v - yMin) * pixelPerUnit;

        // 槽位模型：每个类目一槽；多柱段在槽内并排（折线点恒落槽中心）
        const slotW = chartWidth / n;
        const barCount = barSegs.length;
        const barWidth = Math.min(55, (slotW * 0.7) / Math.max(1, barCount));
        const barGap = 6;
        const cx = (i: number) => chartLeft + slotW * (i + 0.5);
        // 柱段 k 在槽内的左缘偏移（所有段同宽并排，居中分布）
        const barLeft0 = (k: number) =>
                chartLeft + (slotW - barCount * barWidth - (barCount - 1) * barGap) / 2 + k * (barWidth + barGap);

        // ===== 样式（段间色区分：柱=灰黑系/蓝系，线=蓝系/橙系） =====
        const cls = '.chart-container';
        const mc = '.main-title';
        const gl = '.grid-line';
        const al = '.axis-line';
        const at = '.axis-label';
        const bv = '.bar-value';
        const dv = '.data-value';
        const xl = '.x-label';

        const lightBarColors = ['#111', '#333', '#555', '#777', '#999', '#aaa'];
        // 配色定调（用户 2026-10-17）：深色或深色的淡化色，不用鲜艳色
        const darkBarColors = ['#93C5FD', '#7DD3FC', '#A5B4FC', '#6EE7B7', '#67E8F9', '#C4B5FD'];
        const lightLineColors = ['#1E40AF', '#0E7490', '#6D28D9', '#0F766E', '#9A3412', '#B45309'];
        const darkLineColors = ['#FDBA74', '#FDE68A', '#FCA5A5', '#F9A8D4', '#FDBA74', '#FDE68A'];

        const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`
                + `${mc}{text-align:center;font-size:28px;font-weight:700;margin:10px 0 24px;color:#111}`
                + `${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${bv}{fill:#111}${xl}{fill:#333}`;

        let sSegs = '';
        let sSegsDark = '';
        let barK = 0;
        let lineK = 0;
        // 先为每段定色序号（按渲染顺序：柱段灰黑/蓝系序号、折线段蓝/橙系序号）
        const segColorIdx: number[] = active.map(s => (s.type === 'bar' ? barK++ : lineK++));
        active.forEach((s, k) => {
                const ci = segColorIdx[k];
                if (s.type === 'bar') {
                        // 柱色按类目序在色板内轮转（同段类目间仍有明度差）
                        for (let i = 0; i < n; i++) {
                                sSegs += `.cbar-${k}-${i}{fill:${lightBarColors[(ci * 2 + i) % lightBarColors.length]}}`;
                                sSegsDark += `.theme-dark .cbar-${k}-${i}{fill:${darkBarColors[ci % darkBarColors.length]}}`;
                        }
                } else {
                        sSegs += `.cline-${k}{fill:none;stroke:${lightLineColors[ci % lightLineColors.length]};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}`
                                + `.cdot-${k}{fill:${lightLineColors[ci % lightLineColors.length]}}`
                                + `.cval-${k}{fill:${lightLineColors[ci % lightLineColors.length]}}`;
                        sSegsDark += `.theme-dark .cline-${k}{stroke:${darkLineColors[ci % darkLineColors.length]}}`
                                + `.theme-dark .cdot-${k}{fill:${darkLineColors[ci % darkLineColors.length]}}`
                                + `.theme-dark .cval-${k}{fill:${darkLineColors[ci % darkLineColors.length]}}`;
                }
        });
        // 折线值标签兜底类（单段时沿用 .data-value 主样式）
        const sDark = `.theme-dark ${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}`
                + `.theme-dark ${mc}{color:#F9FAFB}.theme-dark ${gl}{stroke:rgba(255,255,255,.08)}`
                + `.theme-dark ${al}{stroke:#6B7280}.theme-dark ${at}{fill:#9CA3AF}.theme-dark ${bv}{fill:#F9FAFB}.theme-dark ${xl}{fill:#D1D5DB}`
                + `.theme-dark ${dv}{fill:#60A5FA}`;

        const style = sLight + sSegs + sDark + sSegsDark;

        // ===== 构建 SVG =====
        const parts: string[] = [];

        // 水平网格线 & y 轴标签（合并量程均分）
        const ySteps = 4;
        for (let i = 1; i <= ySteps; i++) {
                const y = chartTop + (chartHeight / ySteps) * i;
                parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="grid-line"/>`);
        }
        for (let i = 0; i <= ySteps; i++) {
                const y = chartBottom - (chartHeight / ySteps) * i;
                const val = Math.round(yMin + span * i / ySteps);
                const label = showPercent ? val + '%' : String(val);
                parts.push(`<text x="${chartLeft - 25}" y="${y + 4}" text-anchor="end" font-size="12" class="axis-label">${label}</text>`);
        }

        // 坐标轴
        parts.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
        parts.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);

        // 柱状图层（先画柱子，折线叠在上面）——多柱段槽内并排
        // 分段色内联进元素属性（fill/stroke 直接写值）：真机上 <style> 内的分段类可能失效
        // （polyline 露默认 fill:black → 连带实心填充，单图 vlinechart 同 bug 前人以内联属性修复）；
        // 类保留给 dark 模式增强覆盖（CSS 类优先级高于 presentation attribute）
        active.forEach((s, k) => {
                if (s.type !== 'bar') return;
                const ci = segColorIdx[k];
                for (let i = 0; i < n; i++) {
                        const d = s.data.find(x => x.label === cats[i]);
                        if (!d) continue; // 该段无此类目
                        const x = Math.round(barLeft0(k) + slotW * i);
                        const barHeight = Math.max(0, Math.min((d.value - yMin) * pixelPerUnit, chartHeight));
                        const barY = chartBottom - barHeight;
                        const barColor = lightBarColors[(ci * 2 + i) % lightBarColors.length];
                        parts.push(`<rect x="${x}" y="${barY}" width="${Math.round(barWidth)}" height="${barHeight}" rx="8" fill="${barColor}" class="cbar-${k}-${i}"/>`);

                        const displayVal = showPercent ? Math.round(d.value) + '%' : String(Math.round(d.value * 10) / 10);
                        parts.push(`<text x="${x + barWidth / 2}" y="${barY - 15}" text-anchor="middle" font-size="14" font-weight="600" fill="#111" class="bar-value">${escapeXml(displayVal)}</text>`);
                }
        });

        // 类目标签（轴类目，画槽中心）
        for (let i = 0; i < n; i++) {
                parts.push(`<text x="${cx(i)}" y="${chartBottom + 30}" text-anchor="middle" font-size="14" class="x-label">${escapeXml(cats[i])}</text>`);
        }

        // 折线层（每段一条 polyline；匹配点 <2 不画线只画点）
        active.forEach((s, k) => {
                if (s.type !== 'line') return;
                const ci = segColorIdx[k];
                const pts: Array<{ x: number; y: number; value: number }> = [];
                for (const d of s.data) {
                        const i = catIndex.get(d.label);
                        if (i === undefined) continue; // 未匹配类目忽略
                        pts.push({ x: Math.round(cx(i)), y: Math.round(yOf(d.value)), value: d.value });
                }
                if (pts.length >= 2) {
                        const lineColor = lightLineColors[ci % lightLineColors.length];
                        parts.push(`<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" class="cline-${k}"/>`);
                }
                for (const p of pts) {
                        const lineColor = lightLineColors[ci % lightLineColors.length];
                        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="5" fill="${lineColor}" class="cdot-${k}"/>`);
                        const displayVal = String(Math.round(p.value * 10) / 10);
                        parts.push(`<text x="${p.x}" y="${p.y - 15}" text-anchor="middle" font-size="14" font-weight="600" fill="${lineColor}" class="cval-${k}">${escapeXml(displayVal)}</text>`);
                }
        });

        // 坐标轴标题（x/y 轴名取最左段）
        if (xAxisName) {
                parts.push(`<text x="310" y="${chartBottom + 70}" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(xAxisName)}</text>`);
        }
        if (yAxisName) {
                parts.push(`<text x="20" y="210" transform="rotate(-90 20 210)" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(yAxisName)}</text>`);
        }

        const svgContent = parts.join('');
        const svg = `<svg width="600" height="${chartBottom + 90}" viewBox="0 0 600 ${chartBottom + 90}">${svgContent}</svg>`;

        const titleHtml = title ? `<h1 class="main-title">${escapeXml(title)}</h1>` : '';

        return `<div class="chart-container"><style>${style}</style>${titleHtml}${svg}</div>`;
}
