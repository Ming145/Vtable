/**
 * formula.ts
 * Excel 风格公式支持：=SUM(A1:B3)、=AVERAGE(A1:A5) 等
 * 单元格内容以 =FUNC(RANGE) 开头时，显示时求值，聚焦时显示原公式供编辑
 */

import { mdInlineToHtml, type Grid } from './builder';

/* ===== 地址解析 ===== */

/** 列字母转索引：A=0, B=1, ..., Z=25, AA=26 */
function colIndex(col: string): number {
	let n = 0;
	for (let i = 0; i < col.length; i++) n = n * 26 + col.charCodeAt(i) - 64;
	return n - 1;
}

/** 解析 "A1" → { row, col } */
function parseRef(ref: string): { row: number; col: number } | null {
	const m = ref.match(/^([A-Z]+)(\d+)$/);
	if (!m) return null;
	return { col: colIndex(m[1]), row: parseInt(m[2]) - 1 };
}

/** 解析 "A1:B3" → { r0,c0,r1,c1 } */
function parseRange(range: string): { r0: number; c0: number; r1: number; c1: number } | null {
	const parts = range.split(':');
	if (parts.length !== 2) return null;
	const a = parseRef(parts[0].trim());
	const b = parseRef(parts[1].trim());
	if (!a || !b) return null;
	return {
		r0: Math.min(a.row, b.row),
		c0: Math.min(a.col, b.col),
		r1: Math.max(a.row, b.row),
		c1: Math.max(a.col, b.col),
	};
}

/* ===== 取值 ===== */

/**
 * 提取单元格原始 HTML / markdown 中的数值：
 * 1. 剥离 HTML 标签（浮窗工具栏产生的 <b>123</b> → 123）
 * 2. 转换 markdown 行内语法（**123** → <b>123</b>，再剥离 → 123）
 * 3. 解码 HTML 实体
 */
function cellToNumber(cell: { t: string }): number | null {
	let s = cell.t.replace(/<[^>]*>/g, '');     // 先剥 HTML（工具栏格式）
	s = mdInlineToHtml(s);                        // markdown → HTML
	s = s.replace(/<[^>]*>/g, '');                // 再剥 mdInlineToHtml 产生的标签
	// 解码残留实体
	s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
	const n = parseFloat(s);
	return isNaN(n) ? null : n;
}

/** 从 grid 中收集指定范围内的数值（跳过合并隐藏格、非数值） */
function collectNums(grid: Grid, range: string): number[] {
	const r = parseRange(range);
	if (!r) return [];
	const out: number[] = [];
	for (let row = r.r0; row <= r.r1; row++) {
		for (let col = r.c0; col <= r.c1; col++) {
			const cell = grid[row]?.[col];
			if (!cell || cell.rs === 0 || cell.cs === 0) continue;
			const n = cellToNumber(cell);
			if (n !== null) out.push(n);
		}
	}
	return out;
}

/* ===== 已支持函数 ===== */

type Fn = (grid: Grid, args: string) => string;

const FUNCTIONS: Record<string, Fn> = {
	SUM(grid, args) {
		const vals = collectNums(grid, args);
		return vals.reduce((a, b) => a + b, 0).toString();
	},
	AVERAGE(grid, args) {
		const vals = collectNums(grid, args);
		return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toString() : '0';
	},
	COUNT(grid, args) {
		return collectNums(grid, args).length.toString();
	},
	MIN(grid, args) {
		const vals = collectNums(grid, args);
		return vals.length ? Math.min(...vals).toString() : '0';
	},
	MAX(grid, args) {
		const vals = collectNums(grid, args);
		return vals.length ? Math.max(...vals).toString() : '0';
	},
};

/* ===== 公开 API ===== */

/**
 * 若 text 为公式（以 =FUNC( 开头），在 grid 中求值并返回结果文本；
 * 否则原样返回。
 */
export function evalFormula(grid: Grid, text: string): string {
	const m = text.match(/^=([A-Z]+)\((.+)\)$/i);
	if (!m) return text;

	const fn = FUNCTIONS[m[1].toUpperCase()];
	if (!fn) return text;

	try {
		return fn(grid, m[2]);
	} catch {
		return text;
	}
}
