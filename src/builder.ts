/**
 * builder.ts
 * 表格数据模型与结构操作
 *
 * 存储格式（代码块内）：JSON
 *   {"rows":[[{"t":"a","rs":1,"cs":1}, ...], ...]}
 *
 * 采用「满矩阵」模型：grid[r][c] 每个位置都有一个 Cell。
 * 合并块的左上角为「锚点」，其 rs/cs 记录跨度；
 * 被合并覆盖的格子用 rs=0/cs=0 标记为隐藏。
 */

export interface Cell {
	t: string;   // 单元格 HTML 内容
	rs: number;  // rowspan（隐藏格为 0）
	cs: number;  // colspan（隐藏格为 0）
}

/** 转义纯文本为 HTML，供 markdown/管道来源使用 */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * 将文本中的 Markdown 行内格式转为 HTML，并转义特殊字符。
 * - `` `code` `` 内的符号不做转换，保留原样
 * - `[text](url)` → &lt;a&gt;
 * - `***x***` / `___x___` → &lt;b&gt;&lt;i&gt;
 * - `**x**` / `__x__` → &lt;b&gt;
 * - `*x*` / `_x_` → &lt;i&gt;
 * - `==x==` → &lt;mark&gt;
 * - `~~x~~` → &lt;s&gt;
 */
export function mdInlineToHtml(s: string): string {
	const protectedSpans: string[] = [];
	const protect = (html: string): string => {
		const idx = protectedSpans.length;
		protectedSpans.push(html);
		return `\x00${idx}\x01`;
	};
	const escapeAttr = (v: string): string => escapeHtml(v).replace(/"/g, '&quot;');

	// 1) 保护反引号代码段：`` code ``（须最先处理，避免内部符号被后续规则转换）
	s = s.replace(/`([^`]+)`/g, (_, content) => protect('`' + escapeHtml(content) + '`'));

	// 2) 链接：[text](url)（须在粗斜体之前，避免 url 中的 _ / * 被误判为格式符）
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
		const href = /^javascript:/i.test(url) ? '#' : escapeAttr(url);
		return protect(`<a href="${href}">${escapeHtml(text)}</a>`);
	});

	// 3) 粗斜体：***x***（无边界限制） / ___x___（要求前后为单词边界，避免误伤 snake_case）
	s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_, content) => protect(`<b><i>${escapeHtml(content)}</i></b>`));
	s = s.replace(/(?<!\w)___(?!_)([\s\S]+?)(?<!_)___(?!\w)/g, (_, content) => protect(`<b><i>${escapeHtml(content)}</i></b>`));

	// 4) 粗体：**x** / __x__（同上，下划线版本要求单词边界）
	s = s.replace(/\*\*([\s\S]+?)\*\*/g, (_, content) => protect(`<b>${escapeHtml(content)}</b>`));
	s = s.replace(/(?<!\w)__(?!_)([\s\S]+?)(?<!_)__(?!\w)/g, (_, content) => protect(`<b>${escapeHtml(content)}</b>`));

	// 5) 斜体：*x* / _x_（下划线版本要求单词边界，避免匹配 snake_case 标识符）
	s = s.replace(/\*([\s\S]+?)\*/g, (_, content) => protect(`<i>${escapeHtml(content)}</i>`));
	s = s.replace(/(?<!\w)_([\s\S]+?)(?<!_)_(?!\w)/g, (_, content) => protect(`<i>${escapeHtml(content)}</i>`));

	// 6) 高亮：==x==
	s = s.replace(/==([\s\S]+?)==/g, (_, content) => protect(`<mark>${escapeHtml(content)}</mark>`));

	// 7) 删除线：~~x~~
	s = s.replace(/~~([\s\S]+?)~~/g, (_, content) => protect(`<s>${escapeHtml(content)}</s>`));

	// 8) 转义剩余纯文本
	s = escapeHtml(s);

	// 9) 恢复保护的内容
	return s.replace(/\x00(\d+)\x01/g, (_, idx) => protectedSpans[parseInt(idx)]!);
}

export type Grid = Cell[][];

/** 该格是否可见（非被合并覆盖） */
export function visible(cell: Cell): boolean {
	return cell.rs > 0 && cell.cs > 0;
}

function cell(t = ''): Cell {
	return { t, rs: 1, cs: 1 };
}

function hidden(): Cell {
	return { t: '', rs: 0, cs: 0 };
}

/** 拼接两格文字，空的一边不加分隔符 */
function joinText(a: string, b: string, sep: string): string {
	if (a === '') return b;
	if (b === '') return a;
	return a + sep + b;
}

/* ===== 序列化 ===== */

/** 生成空白表格 grid */
export function blankGrid(cols: number, rows: number): Grid {
	const g: Grid = [];
	for (let r = 0; r < rows; r++) {
		const row: Cell[] = [];
		for (let c = 0; c < cols; c++) row.push(cell());
		g.push(row);
	}
	return g;
}

/** grid → 代码块源文本（JSON） */
export function serialize(grid: Grid): string {
	return JSON.stringify({ rows: grid });
}

/** 空白表格源文本 */
export function blankSource(cols: number, rows: number): string {
	return serialize(blankGrid(cols, rows));
}

/** 代码块源文本 → grid，解析失败时回退到管道分隔文本 */
export function parseSource(src: string): Grid {
	const trimmed = src.trim();
	if (trimmed === '') return blankGrid(1, 1);

	try {
		const obj = JSON.parse(trimmed);
		if (obj && Array.isArray(obj.rows)) {
			return normalize(obj.rows as Grid);
		}
	} catch {
		// 非 JSON，按管道分隔文本解析
	}
	return pipeToGrid(trimmed);
}

/** 补全每个 cell 缺省字段，保证是合法满矩阵 */
function normalize(rows: unknown[]): Grid {
	const g: Grid = [];
	for (const rawRow of rows) {
		if (!Array.isArray(rawRow)) continue;
		const row: Cell[] = rawRow.map((x) => {
			const o = x as Partial<Cell>;
			return {
				t: typeof o.t === 'string' ? o.t : '',
				rs: typeof o.rs === 'number' ? o.rs : 1,
				cs: typeof o.cs === 'number' ? o.cs : 1,
			};
		});
		g.push(row);
	}
	return g.length ? g : blankGrid(1, 1);
}

/** 管道分隔文本 → 满矩阵（全 1x1），文本转义为 HTML */
function pipeToGrid(src: string): Grid {
	const lines = src.split('\n').filter(l => l.trim() !== '');
	if (lines.length === 0) return blankGrid(1, 1);
	return lines.map(line => line.split('|').map(s => cell(escapeHtml(s.trim()))));
}

/* ===== markdown 表格转换 ===== */

function isSeparator(line: string): boolean {
	return /^\s*\|?[\s\-:|]+\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	return s.split('|').map(c => c.trim());
}

/** markdown 表格文本 → vtable 源文本（JSON） */
export function mdTableToSource(md: string): string {
	const lines = md.split('\n').filter(l => l.trim() !== '');
	const rows = lines.filter(l => !isSeparator(l)).map(splitRow);
	const grid: Grid = rows.map(r => r.map(t => cell(mdInlineToHtml(t))));
	return serialize(grid.length ? grid : blankGrid(1, 1));
}

/* ===== HTML 表格 → vtable 转换 ===== */

/**
 * HTML 表格文本 → vtable 源文本（JSON）。
 * 按行扫描 <tr>，用「被 rowspan/colspan 占用的格子提前标记为隐藏」的方式重建满矩阵，
 * 单元格内容（可能含标签）原样保留，不做转义或格式转换。
 */
export function htmlTableToSource(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const table = doc.querySelector('table');
	if (!table) return blankSource(1, 1);

	const rowEls = Array.from(table.querySelectorAll('tr'));
	if (rowEls.length === 0) return blankSource(1, 1);

	const rows = rowEls.length;
	const grid: (Cell | undefined)[][] = Array.from({ length: rows }, () => []);

	rowEls.forEach((rowEl, r) => {
		const cellEls = Array.from(rowEl.querySelectorAll('td, th'));
		let c = 0;
		for (const cellEl of cellEls) {
			while (grid[r]![c] !== undefined) c++;

			const rs = parseInt(cellEl.getAttribute('rowspan') ?? '1', 10) || 1;
			const cs = parseInt(cellEl.getAttribute('colspan') ?? '1', 10) || 1;
			grid[r]![c] = { t: cellEl.innerHTML, rs, cs };

			for (let dr = 0; dr < rs; dr++) {
				for (let dc = 0; dc < cs; dc++) {
					if (dr === 0 && dc === 0) continue;
					const rr = r + dr;
					const cc = c + dc;
					if (rr >= rows) continue;
					grid[rr]![cc] = hidden();
				}
			}
			c += cs;
		}
	});

	let cols = 0;
	for (const row of grid) cols = Math.max(cols, row.length);
	if (cols === 0) return blankSource(1, 1);

	const full: Grid = grid.map(row => {
		const out: Cell[] = [];
		for (let c = 0; c < cols; c++) out.push(row[c] ?? cell());
		return out;
	});
	return serialize(full);
}

/* ===== vtable → HTML 表格转换 ===== */

/** grid → HTML 表格文本。合并单元格用 rowspan/colspan 原样保留，内容不做改动。 */
export function gridToHtmlTable(grid: Grid): string {
	const cols = colCount(grid);
	if (grid.length === 0 || cols === 0) return '<table>\n</table>';

	const lines: string[] = ['<table>'];
	for (const row of grid) {
		const tds = row.filter(visible).map(c => {
			const attrs = (c.rs > 1 ? ` rowspan="${c.rs}"` : '') + (c.cs > 1 ? ` colspan="${c.cs}"` : '');
			return `<td${attrs}>${c.t}</td>`;
		}).join('');
		lines.push(`<tr>${tds}</tr>`);
	}
	lines.push('</table>');
	return lines.join('\n');
}

/* ===== vtable → markdown 表格转换 ===== */

/** 转义单元格文本中的竖线，避免破坏 markdown 表格语法；已有的换行换为 <br> 以保持单行 */
function escapeMdCell(t: string): string {
	return t.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

/**
 * grid → markdown 表格文本。不改变内容与格式：合并单元格的内容已存储在锚点
 * （向右合并存于最左格，向下合并存于最上格），直接展平为无合并的普通矩阵即可；
 * 被合并覆盖的隐藏格还原为空单元格。
 */
export function gridToMdTable(grid: Grid): string {
	const cols = colCount(grid);
	if (grid.length === 0 || cols === 0) return '';

	const flat = grid.map(row => row.map(c => (visible(c) ? c.t : '')));
	const toLine = (row: string[]) => '| ' + row.map(escapeMdCell).join(' | ') + ' |';

	const lines = [toLine(flat[0]!), toLine(new Array(cols).fill('---'))];
	for (let r = 1; r < flat.length; r++) lines.push(toLine(flat[r]!));
	return lines.join('\n');
}

/* ===== 行列结构操作（原地修改 grid） ===== */

function colCount(grid: Grid): number {
	return grid[0]?.length ?? 0;
}

/** 在第 r 行下方插入空行 */
export function insertRow(grid: Grid, r: number) {
	const cols = colCount(grid);
	const row: Cell[] = [];
	for (let i = 0; i < cols; i++) row.push(cell());
	grid.splice(r + 1, 0, row);
}

/** 删除第 r 行（至少保留一行） */
export function deleteRow(grid: Grid, r: number) {
	if (grid.length <= 1) return;
	grid.splice(r, 1);
}

/** 在第 c 列右侧插入空列 */
export function insertCol(grid: Grid, c: number) {
	for (const row of grid) row.splice(c + 1, 0, cell());
}

/** 删除第 c 列（至少保留一列） */
export function deleteCol(grid: Grid, c: number) {
	if (colCount(grid) <= 1) return;
	for (const row of grid) row.splice(c, 1);
}

/* ===== 合并 / 拆分 ===== */

/**
 * 向右合并：把锚点 (r,c) 右侧紧邻的可见格并入。
 * 要求锚点为单行高度（rs===1）且右侧格同为单行，避免矩形不齐。
 */
export function mergeRight(grid: Grid, r: number, c: number) {
	const anchor = grid[r]?.[c];
	if (!anchor || !visible(anchor) || anchor.rs !== 1) return;

	const nc = c + anchor.cs;
	const target = grid[r]?.[nc];
	if (!target || !visible(target) || target.rs !== 1) return;

	anchor.t = joinText(anchor.t, target.t, ' ');
	anchor.cs += target.cs;
	// 隐藏被吞并块占用的列
	for (let i = 0; i < target.cs; i++) {
		const cc = nc + i;
		if (grid[r]![cc]) grid[r]![cc] = hidden();
	}
}

/**
 * 向下合并：把锚点 (r,c) 下方紧邻的可见格并入。
 * 要求锚点为单列宽度（cs===1）且下方格同为单列。
 */
export function mergeDown(grid: Grid, r: number, c: number) {
	const anchor = grid[r]?.[c];
	if (!anchor || !visible(anchor) || anchor.cs !== 1) return;

	const nr = r + anchor.rs;
	const target = grid[nr]?.[c];
	if (!target || !visible(target) || target.cs !== 1) return;

	anchor.t = joinText(anchor.t, target.t, '<br>');
	anchor.rs += target.rs;
	for (let i = 0; i < target.rs; i++) {
		const rr = nr + i;
		if (grid[rr]?.[c]) grid[rr]![c] = hidden();
	}
}

/** 拆分：把锚点覆盖的矩形范围全部还原为 1x1 空格 */
export function splitCell(grid: Grid, r: number, c: number) {
	const anchor = grid[r]?.[c];
	if (!anchor || !visible(anchor)) return;
	if (anchor.rs === 1 && anchor.cs === 1) return;

	const rs = anchor.rs;
	const cs = anchor.cs;
	const text = anchor.t;

	for (let rr = r; rr < r + rs; rr++) {
		for (let cc = c; cc < c + cs; cc++) {
			if (!grid[rr]?.[cc]) continue;
			grid[rr]![cc] = (rr === r && cc === c) ? cell(text) : cell();
		}
	}
}
