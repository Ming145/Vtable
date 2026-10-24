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
        /** 单元格水平对齐（可选，默认左） */
        a?: 'l' | 'c' | 'r';
        /** 单元格底色（CSS 颜色值；undefined = 无） */
        bg?: string;
        /** 斜分格（对角线从左上到右下）：dg = 右上区（区域1）纯文本，t = 左下区（区域2）纯文本。
         *  dg === undefined 表示普通格；'' 表示有斜线但右上区为空。
         *  斜分格两区均为单行纯文本（编辑交互限制），t 不再是 HTML 语义。 */
        dg?: string;
        /** 单元格垂直对齐（可选，默认顶对齐）。斜分格两区贴角，垂直对齐不适用。 */
        va?: 't' | 'm' | 'b';
}

/** RC 拖拽手柄曾被写入单元格内容，读取时一并剔除，兼容旧数据 */
const RC_HANDLE_RE = /<div\s+class="vt-rc-handle[^"]*"[^>]*>\s*<\/div>/gi;

export function stripRcHandles(html: string): string {
        return RC_HANDLE_RE.test(html) ? html.replace(RC_HANDLE_RE, '') : html;
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

        // 1) 保护反引号代码段：渲染为 <code>，避免内部 ![[图片]] 等被后续管线解析
        s = s.replace(/`([^`]+)`/g, (_m: string, content: string) => protect('<code>' + escapeHtml(content) + '</code>'));

        // 1.5) 换行标签 <br> 直通：md 表格导入路径的换行语义（导出时 \n → <br>，
        // 再导入若被 HTML 转义会变成字面文本，往返丢数据）；用户手输 <br> 亦按换行渲染
        s = s.replace(/<br\s*\/?>/gi, (m) => protect(m));

        // 2) 链接：[text](url)（须在粗斜体之前，避免 url 中的 _ / * 被误判为格式符）
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m: string, text: string, url: string) => {
                const href = /^javascript:/i.test(url) ? '#' : escapeAttr(url);
                return protect(`<a href="${href}">${escapeHtml(text)}</a>`);
        });

        // 3) 粗斜体：***x***（无边界限制） / ___x___（要求前后为单词边界，避免误伤 snake_case）
        s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_m: string, content: string) => protect(`<b><i>${escapeHtml(content)}</i></b>`));
        s = s.replace(/(?<!\w)___(?!_)([\s\S]+?)(?<!_)___(?!\w)/g, (_m: string, content: string) => protect(`<b><i>${escapeHtml(content)}</i></b>`));

        // 4) 粗体：**x** / __x__（同上，下划线版本要求单词边界）
        s = s.replace(/\*\*([\s\S]+?)\*\*/g, (_m: string, content: string) => protect(`<b>${escapeHtml(content)}</b>`));
        s = s.replace(/(?<!\w)__(?!_)([\s\S]+?)(?<!_)__(?!\w)/g, (_m: string, content: string) => protect(`<b>${escapeHtml(content)}</b>`));

        // 5) 斜体：*x* / _x_（下划线版本要求单词边界，避免匹配 snake_case 标识符）
        s = s.replace(/\*([\s\S]+?)\*/g, (_m: string, content: string) => protect(`<i>${escapeHtml(content)}</i>`));
        s = s.replace(/(?<!\w)_([\s\S]+?)(?<!_)_(?!\w)/g, (_m: string, content: string) => protect(`<i>${escapeHtml(content)}</i>`));

        // 6) 高亮：==x==
        s = s.replace(/==([\s\S]+?)==/g, (_m: string, content: string) => protect(`<mark>${escapeHtml(content)}</mark>`));

        // 7) 删除线：~~x~~
        s = s.replace(/~~([\s\S]+?)~~/g, (_m: string, content: string) => protect(`<s>${escapeHtml(content)}</s>`));

        // 8) 转义剩余纯文本
        s = escapeHtml(s);

        // 9) 恢复保护的内容
        // \x00/\x01 是 mdInlineToHtml 保护段的哨兵字节，正文不可能出现，必须原样匹配
        // eslint-disable-next-line no-control-regex -- 哨兵字节匹配为序列化保护机制所必需
        return s.replace(/\x00(\d+)\x01/g, (_m: string, idx: string) => protectedSpans[parseInt(idx)]);
}

export type Grid = Cell[][];

export type VtMode = 'OL' | 'HS' | 'RC';

export interface VtData {
        mode: VtMode;
        rows: Grid;
        /** RC 模式列宽（px），仅 RC 生效 */
        colWidths?: number[];
        /** RC 模式行高（px），仅 RC 生效 */
        rowHeights?: number[];
        /** 单表格关闭表头底色（覆盖全局 headerStyle 设置；命令「添加/删除表头底色」写入） */
        noHeaderBg?: boolean;
        /** 单表线风格覆盖（'three'=三线表 'noline'=无格线 'hline'=全横线）；
         *  undefined = 跟随全局设置；'off' = 显式取消（全局启用了但本表不要） */
        style?: 'three' | 'noline' | 'hline' | 'off';
        /** 单表隔行变色开关：true=开 false=关；undefined = 跟随全局设置 */
        zebra?: boolean;
}

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

/** VtData → 代码块源文本（JSON） */
/** 单元格内容里的换行归一为 <br>（与 MD 导出同语义）：
 *  编辑态 Chromium 会在段边界敲出字面 
（Enter 一次=两个 
，第二个是新行占位），
 *  持久化域里换行只有 <br> 一种真身——尾随 n 个 
 是 n-1 次换行，其余位置 1:1 */
export function normalizeCellNewlines(t: string): string {
        if (!t.includes('\n')) return t;
        const m = /\n+$/.exec(t);
        const tail = m ? m[0] : '';
        const body = t.slice(0, t.length - tail.length);
        // 尾随换行符的两种身份：
        // - 紧跟 <br> 之后（光标在末尾锚点段上按 Enter）：用户真按的换行，1:1 保留
        //   （不折叠的话，连续 Enter 只能维持一个空行——"无法连续添加空行"）
        // - 紧跟正文（段尾 Enter）：Chromium 的"新行占位"表示，n 个 = n-1 次换行
        const afterBr = body.endsWith('<br>');
        const tailBr = afterBr ? tail.length : Math.max(0, tail.length - 1);
        return body.replace(/\n/g, '<br>') + (tailBr ? '<br>'.repeat(tailBr) : '');
}

/** 孤立隐藏格自愈：rs=0 但没有任何可见格（含跨行列跨度）覆盖到它 → 恢复为独立格。
 *  加行/合并等结构操作的历史脏数据会让隐藏格失去覆盖者，该列从此渲染缺失（塌陷/空白） */
function healOrphanHidden(rows: Grid): void {
        for (let r = 0; r < rows.length; r++) {
                for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
                        const cd = rows[r][c];
                        if (!cd || visible(cd)) continue;
                        let covered = false;
                        for (let rr = 0; rr < rows.length && !covered; rr++) {
                                for (let cc = 0; cc < (rows[rr]?.length ?? 0) && !covered; cc++) {
                                        if (rr === r && cc === c) continue;
                                        const up = rows[rr][cc];
                                        if (!up || !visible(up)) continue;
                                        if (rr <= r && r < rr + up.rs && cc <= c && c < cc + up.cs) covered = true;
                                }
                        }
                        if (!covered) { cd.rs = 1; cd.cs = 1; }
                }
        }
}

/** 冲突可见格自愈：可见格落在另一可见格的 rs×cs 覆盖声明内 → 内容拼入覆盖者（mergeRange
 *  同语义，行间 <br>）、自身转隐藏。渲染器信任格子自治，这种冲突数据会让浏览器把多出的
 *  td 挤成幻影列（空白区可点/错列怪的根源）。合并声明都源自用户明确的合并操作，优先级最高 */
function healCoveredVisible(rows: Grid): void {
        // 快路径：没有跨格合并（全部 rs/cs ≤1）时不可能存在覆盖声明
        let hasSpan = false;
        for (const row of rows) for (const cd of row) {
                if (visible(cd) && (cd.rs > 1 || cd.cs > 1)) { hasSpan = true; break; }
        }
        if (!hasSpan) {
                // 无大格的表里任何隐藏格都必然孤立，直接 O(n) 恢复
                for (const row of rows) for (const cd of row) {
                        if (cd && !visible(cd)) { cd.rs = 1; cd.cs = 1; }
                }
                return;
        }
        healCoveredVisibleSlow(rows);
        healOrphanHidden(rows);
}

function healCoveredVisibleSlow(rows: Grid): void {
        for (let r = 0; r < rows.length; r++) {
                for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
                        const cd = rows[r][c];
                        if (!cd || !visible(cd)) continue;
                        for (let rr = 0; rr < rows.length; rr++) {
                                let hit = false;
                                for (let cc = 0; cc < (rows[rr]?.length ?? 0); cc++) {
                                        if (rr === r && cc === c) continue;
                                        const up = rows[rr][cc];
                                        if (!up || !visible(up) || (up.rs === 1 && up.cs === 1)) continue;
                                        if (rr <= r && r < rr + up.rs && cc <= c && c < cc + up.cs) {
                                                if (cd.t) up.t = joinText(up.t, cd.t, '<br>');
                                                cd.t = ''; cd.rs = 0; cd.cs = 0;
                                                hit = true; break;
                                        }
                                }
                                if (hit) break;
                        }
                }
        }
}

export function serialize(data: VtData): string {
        healCoveredVisible(data.rows);
        for (const row of data.rows) for (const cd of row) {
                if (cd.t) cd.t = normalizeCellNewlines(cd.t);
        }
        const obj: Record<string, unknown> = { rows: data.rows };
        if (data.mode !== 'OL') obj.mode = data.mode;
        // 保留 RC 模式的列宽和行高数据，即使切换到其他模式也不丢失
        if (data.colWidths?.length) obj.colWidths = data.colWidths;
        if (data.rowHeights?.length) obj.rowHeights = data.rowHeights;
        if (data.noHeaderBg) obj.noHeaderBg = true;
        if (data.style) obj.style = data.style;
        if (data.zebra !== undefined) obj.zebra = data.zebra;
        return JSON.stringify(obj);
}

/** 空白表格源文本 */
export function blankSource(cols: number, rows: number): string {
        return serialize({ mode: 'OL', rows: blankGrid(cols, rows) });
}

/** 代码块源文本 → VtData，解析失败时回退到管道分隔文本 */
export function parseSource(src: string): VtData {
        const trimmed = src.trim();
        if (trimmed === '') return { mode: 'OL', rows: blankGrid(1, 1) };

        try {
                // JSON.parse 返回 any：按源格式声明最小形状，字段逐一收窄后使用
                const obj = JSON.parse(trimmed) as {
                        rows?: unknown; mode?: unknown; colWidths?: unknown;
                        rowHeights?: unknown; noHeaderBg?: unknown; style?: unknown; zebra?: unknown;
                };
                if (obj && Array.isArray(obj.rows)) {
                        const mode = parseMode(obj.mode);
                        const rows = normalize(obj.rows as Grid);
                        const data: VtData = { mode, rows };
                        // 保留 RC 模式的列宽和行高数据，不管当前模式是什么
                        if (Array.isArray(obj.colWidths)) {
                                data.colWidths = obj.colWidths.filter((n: unknown) => typeof n === 'number');
                        }
                        if (Array.isArray(obj.rowHeights)) {
                                data.rowHeights = obj.rowHeights.filter((n: unknown) => typeof n === 'number');
                        }
                        if (obj.noHeaderBg === true) data.noHeaderBg = true;
                        // 单表样式覆盖（合法值才收；脏数据当跟随全局）
                        if (obj.style === 'three' || obj.style === 'noline' || obj.style === 'hline' || obj.style === 'off') {
                                data.style = obj.style;
                        }
                        if (obj.zebra === true || obj.zebra === false) data.zebra = obj.zebra;
                        return data;
                }
        } catch {
                // 非 JSON，按管道分隔文本解析
        }
        return { mode: 'OL', rows: pipeToGrid(trimmed) };
}

function parseMode(v: unknown): VtMode {
        if (v === 'HS' || v === 'RC') return v;
        return 'OL';
}

/** 补全每个 cell 缺省字段，保证是合法满矩阵 */
function normalize(rows: unknown[]): Grid {
        const g: Grid = [];
        for (const rawRow of rows) {
                if (!Array.isArray(rawRow)) continue;
                const row: Cell[] = rawRow.map((x) => {
                        const o = x as Partial<Cell>;
                        const cd: Cell = {
                                t: typeof o.t === 'string' ? stripRcHandles(o.t) : '',
                                rs: typeof o.rs === 'number' ? o.rs : 1,
                                cs: typeof o.cs === 'number' ? o.cs : 1,
                        };
                        // 对齐/底色（可选字段，合法值才保留）
                        if (o.a === 'l' || o.a === 'c' || o.a === 'r') cd.a = o.a;
                        if (typeof o.bg === 'string' && o.bg) cd.bg = o.bg;
                        // 垂直对齐（t=顶/m=中/b=底；缺省=顶）
                        if (o.va === 't' || o.va === 'm' || o.va === 'b') cd.va = o.va;
                        // 斜分格标记（右上区文本；存在即为斜分格，'' = 右上区为空）
                        if (typeof o.dg === 'string') cd.dg = o.dg;
                        return cd;
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
        // 转义竖线 \| = 字面竖线（与导出端 escapeMdCell 成对）：不占位分列，防列数错拆
        return s.replace(/\\\|/g, '\x00VTESC\x00')
                .split('|')
                // \x00VTESC\x00 是 splitRow 的转义占位哨兵，同样为机制必需
                // eslint-disable-next-line no-control-regex -- 哨兵字节匹配为管道转义机制所必需
                .map(c => c.trim().replace(/\x00VTESC\x00/g, '|'));
}

/** markdown 表格文本 → vtable 源文本（JSON） */
export function mdTableToSource(md: string): string {
        const lines = md.split('\n').filter(l => l.trim() !== '');
        const rows = lines.filter(l => !isSeparator(l)).map(splitRow);
        const grid: Grid = rows.map(r => r.map(t => cell(mdInlineToHtml(t))));
        return serialize({ mode: 'OL', rows: grid.length ? grid : blankGrid(1, 1) });
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
                        while (grid[r][c] !== undefined) c++;

                        const rs = parseInt(cellEl.getAttribute('rowspan') ?? '1', 10) || 1;
                        const cs = parseInt(cellEl.getAttribute('colspan') ?? '1', 10) || 1;
                        grid[r][c] = { t: cellEl.innerHTML, rs, cs };

                        for (let dr = 0; dr < rs; dr++) {
                                for (let dc = 0; dc < cs; dc++) {
                                        if (dr === 0 && dc === 0) continue;
                                        const rr = r + dr;
                                        const cc = c + dc;
                                        if (rr >= rows) continue;
                                        grid[rr][cc] = hidden();
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
        return serialize({ mode: 'OL', rows: full });
}

/* ===== vtable → HTML 表格转换 ===== */

/** grid → HTML 表格文本。合并单元格用 rowspan/colspan 原样保留，内容不做改动。 */
export function gridToHtmlTable(grid: Grid): string {
        const cols = colCount(grid);
        if (grid.length === 0 || cols === 0) return '<table>\n</table>';

        const lines: string[] = ['<table>'];
        for (const row of grid) {
                const tds = row.filter(visible).map(c => {
                        let attrs = (c.rs > 1 ? ` rowspan="${c.rs}"` : '') + (c.cs > 1 ? ` colspan="${c.cs}"` : '');
                        // 对齐/底色随 HTML 导出保留
                        const styles: string[] = [];
                        if (c.a) styles.push(`text-align: ${c.a === 'c' ? 'center' : c.a === 'r' ? 'right' : 'left'}`);
                        if (c.va) styles.push(`vertical-align: ${c.va === 'm' ? 'middle' : c.va === 'b' ? 'bottom' : 'top'}`);
                        if (c.bg) styles.push(`background: ${c.bg}`);
                        if (styles.length) attrs += ` style="${escapeHtml(styles.join('; '))}"`;
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
export function gridToMdTable(grid: Grid, opts?: { htmlTags?: boolean }): string {
        const cols = colCount(grid);
        if (grid.length === 0 || cols === 0) return '';
        const useTags = opts?.htmlTags !== false;

        // 对齐/底色经嵌套 HTML 标签保留（Obsidian 原生表格支持行内 HTML）
        const decorate = (t: string, c: Cell): string => {
                let inner = escapeMdCell(t);
                if (!useTags) return inner;
                if (c.bg) inner = `<span style="background-color:${c.bg}">${inner}</span>`;
                if (c.a === 'c') inner = `<center>${inner}</center>`;
                else if (c.a === 'r') inner = `<span style="display:block;text-align:right">${inner}</span>`;
                return inner;
        };

        const lineOf = (row: Cell[]): string =>
                '| ' + row.map(c => decorate(visible(c) ? c.t : '', c)).join(' | ') + ' |';

        const lines: string[] = [lineOf(grid[0])];
        lines.push('| ' + new Array(cols).fill('---').join(' | ') + ' |');
        for (let r = 1; r < grid.length; r++) lines.push(lineOf(grid[r]));
        return lines.join('\n');
}

/* ===== 行列结构操作（原地修改 grid） ===== */

export function colCount(grid: Grid): number {
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
                if (grid[r][cc]) grid[r][cc] = hidden();
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
                if (grid[rr]?.[c]) grid[rr][c] = hidden();
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
                        grid[rr][cc] = (rr === r && cc === c) ? cell(text) : cell();
                }
        }
}

/* ===== 框选批量结构操作（原地修改 grid） ===== */

/**
 * 整块合并：把矩形范围内全部格子合并为一个大格。
 * 内容拼接与 mergeRight/mergeDown 同语义：行内空格、行间 <br>。
 * 选区已做过合并格归一化，范围内部不会出现跨界合并块。
 */
export function mergeRange(grid: Grid, r1: number, c1: number, r2: number, c2: number) {
        r1 = Math.max(0, r1);
        c1 = Math.max(0, c1);
        r2 = Math.min(grid.length - 1, r2);
        c2 = Math.min(colCount(grid) - 1, c2);
        if (r2 < r1 || c2 < c1) return;
        if (r2 === r1 && c2 === c1) return; // 单格无需合并

        const rowTexts: string[] = [];
        for (let r = r1; r <= r2; r++) {
                let line = '';
                for (let c = c1; c <= c2; c++) {
                        const cd = grid[r]?.[c];
                        if (!cd || !visible(cd)) continue;
                        line = joinText(line, cd.t, ' ');
                }
                rowTexts.push(line);
        }
        let text = '';
        for (const t of rowTexts) text = joinText(text, t, '<br>');

        const anchor = grid[r1][c1];
        anchor.t = text;
        anchor.rs = r2 - r1 + 1;
        anchor.cs = c2 - c1 + 1;
        for (let r = r1; r <= r2; r++) {
                for (let c = c1; c <= c2; c++) {
                        if (r === r1 && c === c1) continue;
                        if (grid[r]?.[c]) grid[r][c] = hidden();
                }
        }
}

/** 删除一组行（降序删除，至少保留一行） */
export function deleteRows(grid: Grid, rows: number[]) {
        const desc = Array.from(new Set(rows)).sort((a, b) => b - a);
        for (const r of desc) {
                if (r >= 0 && r < grid.length) deleteRow(grid, r);
        }
}

/** 删除一组列（降序删除，至少保留一列） */
export function deleteCols(grid: Grid, cols: number[]) {
        const desc = Array.from(new Set(cols)).sort((a, b) => b - a);
        for (const c of desc) {
                if (c >= 0 && c < colCount(grid)) deleteCol(grid, c);
        }
}

/** 在第 r 行上方插入 count 个空行（r 可为 0） */
export function insertRowsAbove(grid: Grid, r: number, count: number) {
        for (let i = 0; i < count; i++) insertRow(grid, r - 1);
}

/** 在第 r 行下方插入 count 个空行 */
export function insertRowsBelow(grid: Grid, r: number, count: number) {
        for (let i = 0; i < count; i++) insertRow(grid, r);
}

/** 在第 c 列左侧插入 count 个空列（c 可为 0） */
export function insertColsLeft(grid: Grid, c: number, count: number) {
        for (let i = 0; i < count; i++) insertCol(grid, c - 1);
}

/** 在第 c 列右侧插入 count 个空列 */
export function insertColsRight(grid: Grid, c: number, count: number) {
        for (let i = 0; i < count; i++) insertCol(grid, c);
}

/* ===== 行列自由拖动（RC 模式把手拖拽换位） ===== */

/** 行 r 是否可整体拖动：任何跨行合并（rs>1，含上方伸入的覆盖）行区间覆盖 r → 不可拖；
 * 行内横向合并（cs>1）不碍事（整行一起搬走） */
export function rowDraggable(grid: Grid, r: number): boolean {
        for (let rr = 0; rr < grid.length; rr++) {
                for (const cd of grid[rr] ?? []) {
                        if (!cd || !visible(cd) || cd.rs <= 1) continue;
                        if (rr <= r && r < rr + cd.rs) return false;
                }
        }
        return true;
}

/** 列 c 是否可整体拖动：任何跨列合并（cs>1，含左侧伸入的覆盖）列区间覆盖 c → 不可拖；
 * 列内纵向合并（rs>1）不碍事（整列一起搬走） */
export function colDraggable(grid: Grid, c: number): boolean {
        for (const row of grid) {
                for (let i = 0; i < row.length; i++) {
                        const cd = row[i];
                        if (!cd || !visible(cd) || cd.cs <= 1) continue;
                        if (i <= c && c < i + cd.cs) return false;
                }
        }
        return true;
}

/** 列移动落点判定：把 from 列移除后插到边界 b（移除后坐标 0..cols-1），
 * 是否会被某个跨列格子（cs>1）的区间跨越 → 跨越则拆散合并 → 非法 */
export function colMoveBlocked(grid: Grid, from: number, b: number): boolean {
        for (const row of grid) {
                for (let i = 0; i < row.length; i++) {
                        const cd = row[i];
                        if (!cd || !visible(cd) || cd.cs <= 1 || i === from) continue;
                        const c0 = i < from ? i : i - 1; // 移除 from 后锚点平移（区间不含 from，资格已保证）
                        if (c0 < b && b < c0 + cd.cs) return true;
                }
        }
        return false;
}

/** 行移动落点判定：把 from 行移除后插到边界 b（移除后坐标），是否被跨行格子（rs>1）跨越 */
export function rowMoveBlocked(grid: Grid, from: number, b: number): boolean {
        for (let rr = 0; rr < grid.length; rr++) {
                for (const cd of grid[rr] ?? []) {
                        if (!cd || !visible(cd) || cd.rs <= 1 || rr === from) continue;
                        const r0 = rr < from ? rr : rr - 1;
                        if (r0 < b && b < r0 + cd.rs) return true;
                }
        }
        return false;
}

/** 移动列：抽出 from 列插到边界 b（移除后坐标）。调用方保证拖动资格与落点合法 */
export function moveCol(grid: Grid, from: number, b: number) {
        for (const row of grid) {
                const slots = row.splice(from, 1);
                const slot = slots[0];
                if (slot) row.splice(b, 0, slot);
        }
}

/** 移动行：抽出 from 行插到边界 b（移除后坐标）。调用方保证拖动资格与落点合法 */
export function moveRow(grid: Grid, from: number, b: number) {
        const rows = grid.splice(from, 1);
        const row = rows[0];
        if (row) grid.splice(b, 0, row);
}

/** 整格内容加/解 <b>/<i> 包裹（整体已包裹则解开，否则整体包裹） */
export function toggleWrapTag(html: string, tag: string): string {
        const re = new RegExp(`^<${tag}>([\\s\\S]*)</${tag}>$`, 'i');
        const m = html.match(re);
        if (m) return m[1];
        if (!html.trim()) return html;
        return `<${tag}>${html}</${tag}>`;
}

/** 待办行 `- [ ]`/`- [x]` 标记正则 */

/** 切换第 idx 个（从 0 计）待办标记的勾选状态（点击复选框写回用）。
 *  行内代码 `...` 内的标记不参与计数（与渲染端 renderTodos 跳过 code 节点保持一致，防勾选错位） */
export function toggleTodoMark(html: string, idx: number, checked: boolean): string {
        let seen = -1;
        let hit = false;
        let inCode = false;
        const out = html.replace(/`|-\s*\[([ xX])\]/g, (m, mark: string | undefined) => {
                if (m === '`') {
                        inCode = !inCode;
                        return m;
                }
                if (inCode) return m;
                seen++;
                if (seen !== idx || hit) return m;
                hit = true;
                const next = checked ? 'x' : ' ';
                return m.replace(/\[[ xX]\]/, `[${next}]`);
        });
        return out;
}
