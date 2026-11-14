/**
 * sort.ts — 列内排序（2026-11-07 用户设计，严格按交互规格实现）
 *
 * 入口：选框存在 → 拖动把手全部隐藏，取而代之：选区覆盖的每一列上方出现小排序符号。
 * 非矩形选区按列拆分（各列独立流程、独立范围，行跨度可不齐）；只交换该列被覆盖的
 * 独立单元格数据（t/底色/对齐随格走），同排其它列不动。
 *
 * 三流程（按列内容自动判定，比较用文本一律剥格式 + 换行拉直）：
 *  1 纯数字列：1↑↓（↑=从大到小，↓=从小到大）
 *  2 纯文本列：AZ（A=从A到Z，Z=从Z到A；英文不分大小写，中文按拼音）
 *  3 带文字的数字格（末尾数字或数字夹中间，不限前缀）：先 1↑↓→（→=不排数字），
 *    点完无缝切 AZ→（→=不排字母），两步都点完该列才真正执行
 *
 * 混合列（数字型+文本型同列）：数字组在前、文本组在后、空白永远最后，组内各自按所选方向有序；
 * 内容相同保持原序（稳定排序）。
 *
 * Shift：按住期间完成的列只入队不执行，松开 shift 统一执行（一次提交）。
 * 每列流程完成其符号即消失；选区覆盖的列全部处理完 → 选区消失。
 * 选区中途被取消 → 已执行的保留、未执行的不回退，静默结束。
 * 范围含合并单元格 → 点击符号时直接弹提示，流程不推进。
 */
import { Notice } from 'obsidian';
import type { Cell, Grid, VtData } from './builder';
import { mdInlineToHtml } from './builder';
import { evalFormula } from './formula';
import { t } from './i18n';
import type { AnchorIndex, SelRect } from './sel';

type Dir = 'asc' | 'desc';

/* ===== 比较键 ===== */

/** 比较用平文本：剥 HTML/markdown 格式，<br> 拉直为空格（"带换行拉直为一整行"；运输保持原文） */
export function sortFlatText(src: string): string {
        let s = src.replace(/<br\s*\/?>/gi, ' ');
        s = s.replace(/<[^>]*>/g, '');          // 剥既有 HTML 标签（浮窗加粗 <b> 等）
        s = mdInlineToHtml(s);                   // markdown 行内语法 → HTML
        s = s.replace(/<[^>]*>/g, '');            // 再剥一层
        s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
        s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接取文字部分
        return s.replace(/\s+/g, ' ').trim();
}

export interface Key {
        kind: 'blank' | 'num' | 'text';
        /** num：末尾数字的值 */
        value: number | null;
        /** text：拉直平文本 */
        flat: string;
        /** text：首组数字前的文本（无数字 = 全文） */
        prefix: string;
        /** text：首组数字的值（无数字 = null） */
        firstNum: number | null;
        /** A1 流程四档（2026-11-08 用户补充）：0=纯文字 1=文中有数字 2=文末有数字 3=纯数字 */
        rank: 0 | 1 | 2 | 3;
}

const TRAIL_NUM = /[+-]?\d+(?:\.\d+)?$/;
const FIRST_NUM = /[+-]?\d+(?:\.\d+)?/;

/** 单格 → 比较键。公式（=FUNC(...)）：求值成功按结果参与（数值结果 = 数字型），
 *  算不了按显示文本参与——"无非就是算不了显示一下"（导出供测试） */
export function keyOfCell(cell: Cell | undefined, grid: Grid): Key {
        if (!cell || (cell.rs === 0 && cell.cs === 0)) return { kind: 'blank', value: null, flat: '', prefix: '', firstNum: null, rank: 0 };
        let flat = sortFlatText(cell.t);
        if (/^=[A-Za-z]+\(/.test(cell.t)) flat = sortFlatText(evalFormula(grid, cell.t));
        if (!flat) return { kind: 'blank', value: null, flat: '', prefix: '', firstNum: null, rank: 0 };
        const fm0 = flat.match(FIRST_NUM);
        const prefix0 = fm0 ? flat.slice(0, fm0.index) : flat;
        const firstNum0 = fm0 ? parseFloat(fm0[0]) : null;
        const tm = flat.match(TRAIL_NUM);
        if (tm) {
                // 末尾数字（含纯数字）：value = 尾数字；prefix/firstNum 留作 dual 判定（首组数字前文本）
                return {
                        kind: 'num',
                        value: tm[0].length === flat.length ? parseFloat(flat) : parseFloat(tm[0]),
                        flat, prefix: prefix0, firstNum: firstNum0,
                        rank: tm[0].length === flat.length ? 3 : 2, // 纯数字 3 / 文末数字 2
                };
        }
        return { kind: 'text', value: null, flat, prefix: prefix0, firstNum: firstNum0, rank: fm0 ? 1 : 0 }; // 文中数字 1 / 纯文字 0
}

export type Flow = 'num' | 'text' | 'dual' | 'mix' | 'numonly';

/** 列流程判定（只看非空格）：
 *  大类（纯文字 / 数文结合 / 纯数字）两档以上共存 → mix（A1 流程）；
 *  纯数字（无文字）→ num 单步；
 *  带文字的数字格（夹中间/文末不限前缀）：
 *    非数字文本全同 → numonly 单步（2026-11-10 点1：其它文字都一样就不需要文字步）；
 *    文本不同 → dual 两步（1↑↓→ 然后 AZ→）；
 *  纯文字 → text（导出供测试） */
export function detectFlow(keys: Key[]): Flow {
        const nb = keys.filter(k => k.kind !== 'blank');
        if (!nb.length) return 'text';
        // 大类：rank 0=纯文字、3=纯数字、1/2=数字与文字结合（文中/文末）
        const cats = new Set(nb.map(k => (k.rank === 0 || k.rank === 3) ? k.rank : 2));
        if (cats.size >= 2) return 'mix';
        if (nb.every(k => k.kind === 'num') && nb.every(k => k.prefix === '')) return 'num';
        if (nb.every(k => k.firstNum !== null && k.prefix !== '')) {
                // 非数字文本全同（只有数字不同）→ 单步只排数字
                const nd = nb.map(k => k.flat.replace(/\d+/g, ''));
                if (nd.every(s => s === nd[0])) return 'numonly';
                return 'dual';
        }
        return 'text';
}

/** 文本比较：中文按拼音（zh 整理默认拼音序）、英文不分大小写 */
function coll(a: string, b: string): number {
        return a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' });
}

interface Entry { r: number; key: Key }
export type SortEntry = Entry;

/** 一列键序列 → 新顺序（调用方按序回填格子负载）。导出供测试。
 *  mix（A1 流程，2026-11-08 用户钉死）：只排大类（纯文字→文中有数字→文末有数字→纯数字，
 *  按 1 反向），档内保持原顺序不排序；空白最后。
 *  分区（11-07 原规则）：数字型组在前、文本型组在后、空白最后；组内按所选方向有序，稳定保序。
 *  dual 列全为同前缀文本型：主键 = 首组数字（可跳），次键 = 平文本（可跳）；都跳 = 原样 */
export function orderKeys(entries: Entry[], flow: Flow, numDir: Dir | 'skip', textDir: Dir | 'skip'): Entry[] {
        const nums: Entry[] = [], txts: Entry[] = [], blanks: Entry[] = [];
        for (const e of entries) {
                if (e.key.kind === 'blank') blanks.push(e);
                else if (e.key.kind === 'num') nums.push(e);
                else txts.push(e);
        }
        if (flow === 'mix') {
                const ladder: Entry[][] = [[], [], [], []];
                for (const e of entries) {
                        if (e.key.kind === 'blank') continue;
                        ladder[e.key.rank].push(e); // 档内保持全局原序（用户钉死：只排大类不排内部）
                }
                const order = textDir === 'asc' ? [0, 1, 2, 3] : [3, 2, 1, 0]; // A=纯文字在前 / 1=纯数字在前
                return [...order.flatMap(rk => ladder[rk]), ...blanks];
        }
        if (flow === 'numonly') {
                // 单步数字（2026-11-10 点1：同文本列）：→ 跳过 = 保持原样完成该列（2026-11-11 TA 令：→ 要保留）
                if (numDir === 'skip') return [...entries.filter(e => e.key.kind !== 'blank'), ...blanks];
                const sgn = numDir === 'asc' ? 1 : -1;
                const all = entries.filter(e => e.key.kind !== 'blank');
                const sorted = all.slice().sort((x, y) => sgn * ((x.key.firstNum ?? 0) - (y.key.firstNum ?? 0)));
                return [...sorted, ...blanks];
        }
        if (flow === 'dual') {
                // 两步流程的格子【全参与】（2026-11-09 修复：原只排 txts，末尾数字 num 键全被丢弃
                // → 数字步无效实锤——苹果5/苹果12 点↑+→ 结果不变）。主键 = 首组数字（可跳），
                // 次键 = 平文本（可跳）；数字不同时文字步不参与（不干涉），数字相同时文本决定先后
                const useNum = numDir !== 'skip', useTxt = textDir !== 'skip';
                const all = entries.filter(e => e.key.kind !== 'blank');
                const sorted = all.slice().sort((x, y) => {
                        if (useNum) {
                                const d = (x.key.firstNum ?? 0) - (y.key.firstNum ?? 0);
                                if (d !== 0) return numDir === 'asc' ? d : -d;
                        }
                        if (useTxt) {
                                const c = coll(x.key.flat, y.key.flat);
                                return textDir === 'asc' ? c : -c;
                        }
                        return 0;
                });
                return [...sorted, ...blanks];
        }
        const pick: Dir | 'skip' = flow === 'num' ? numDir : textDir; // num/text 流程点击必给方向，skip 不会到这
        const sgn = pick === 'desc' ? -1 : 1;
        nums.sort((x, y) => sgn * ((x.key.value ?? 0) - (y.key.value ?? 0)));
        txts.sort((x, y) => sgn * coll(x.key.flat, y.key.flat));
        return [...nums, ...txts, ...blanks];
}

/* ===== 选区 → 列拆分 ===== */

/** 选区 → 列映射（c → 覆盖行升序去重）。非矩形选区按列拆开，各行跨度可不齐 */
function columnsFromRects(rects: SelRect[]): Map<number, number[]> {
        const cols = new Map<number, number[]>();
        for (const rc of rects) {
                for (let c = rc.c1; c <= rc.c2; c++) {
                        for (let r = rc.r1; r <= rc.r2; r++) {
                                const arr = cols.get(c);
                                if (arr) { if (!arr.includes(r)) arr.push(r); }
                                else cols.set(c, [r]);
                        }
                }
        }
        for (const arr of cols.values()) arr.sort((a, b) => a - b);
        return cols;
}

/* ===== 排序符号层（body 挂载 fixed，同把手/edge-bar 模式免疫容器裁剪） ===== */

export interface SortCtx {
        hostEl(): HTMLElement;                 // 宿主容器（跨重渲染会话匹配：renderBlock 复用同一 el）
        tableEl(): HTMLTableElement;
        getRects(): SelRect[];                 // 当前选区（活引用）
        cellTd(r: number, c: number): HTMLTableCellElement | null;
        grid(): Grid;
        data(): VtData;
        anchorIndex(): AnchorIndex;
        flushActive(): void;                    // 冲刷焦点格 DOM → grid（读键前）
        /** 功能开关（2026-11-09）：false = 符号层完全不工作（sync 直接清场静默退出） */
        enabled(): boolean;
        /** 落定：内部负责 before/after 对比、焦点恢复、选区恢复（allDone=false 时）、提交 */
        applySort(apply: () => void, allDone: boolean): void;
}

interface ColState {
        processed: boolean;
        /** dual 流程阶段：0=数字步 1=字母步 */
        stage: 0 | 1;
        numChoice: Dir | 'skip' | null;
}

interface Session {
        host: HTMLElement;
        rects: SelRect[];
        cols: Map<number, ColState>;
}

/** 模块级会话：跨重渲染存续（重渲染后新 SortBar 按宿主+选区续接状态） */
let session: Session | null = null;

const sameRects = (a: SelRect[], b: SelRect[]): boolean =>
        a.length === b.length && a.every((rc, i) => rc.r1 === b[i].r1 && rc.c1 === b[i].c1 && rc.r2 === b[i].r2 && rc.c2 === b[i].c2);

interface Deferred { c: number; rows: number[]; order: Cell[] }

export class SortBar {
        private layer: HTMLDivElement | null = null;
        private raf = 0;
        private deferred: Deferred[] = [];
        private lastSig = '';

        constructor(private ctx: SortCtx) {}

        /** 选区变化同步点（renderSel 调）：空选区/开关关闭 = 流程静默结束（已执行的保留） */
        sync() {
                // 设置开关（2026-11-09）：关 = 符号层清场静默退出（选框时拖动把手照常显示）
                if (!this.ctx.enabled()) {
                        if (this.layer) this.destroy(false);
                        return;
                }
                const rects = this.ctx.getRects();
                if (!rects.length) {
                        if (this.layer) this.destroy(false);
                        session = null;
                        return;
                }
                if (session && (session.host !== this.ctx.hostEl() || !sameRects(session.rects, rects))) session = null;
                if (!session) session = { host: this.ctx.hostEl(), rects: rects.map(rc => ({ ...rc })), cols: new Map() };
                if (!this.layer) {
                        this.layer = document.body.createDiv({ cls: 'vt-sort-layer' });
                        document.addEventListener('keyup', this.onShiftUp);
                        window.addEventListener('blur', this.onWinBlur);
                        this.raf = window.requestAnimationFrame(this.tick);
                }
                this.buildPills();
        }

        /** 层销毁（表格销毁/选区清空）。keepSession：宿主重渲染销毁时保留会话供新层续接 */
        destroy(keepSession: boolean) {
                if (this.raf) window.cancelAnimationFrame(this.raf);
                this.raf = 0;
                document.removeEventListener('keyup', this.onShiftUp);
                window.removeEventListener('blur', this.onWinBlur);
                this.layer?.remove();
                this.layer = null;
                this.deferred = [];
                this.lastSig = '';
                if (!keepSession) session = null;
        }

        private onShiftUp = (e: KeyboardEvent) => {
                if (e.key !== 'Shift') return;
                this.flushDeferred();
        };

        private onWinBlur = () => {
                this.flushDeferred(); // 松键事件丢失兜底：shift 已不在，队内排序统一执行
        };

        /** 符号构建：未处理的列各一粒（processed 的不建），dual 两阶段按 stage 切换形态 */
        private buildPills() {
                if (!this.layer || !session) return;
                const rects = this.ctx.getRects();
                const sig = JSON.stringify([rects, [...session.cols.entries()]]);
                if (sig === this.lastSig) return; // 无变化不重建（手势拖拽期高频同步）
                this.lastSig = sig;
                this.layer.empty();
                const cols = columnsFromRects(rects);
                const grid = this.ctx.grid();
                for (const [c, rows] of cols) {
                        const st = session.cols.get(c) ?? { processed: false, stage: 0, numChoice: null };
                        session.cols.set(c, st);
                        if (st.processed) continue;
                        // 单格列 / 全同列：不显示排序符号（2026-11-10 点2），直接视为已完成
                        if (rows.length < 2) { st.processed = true; continue; }
                        const keys = rows.map(r => keyOfCell(grid[r]?.[c], grid));
                        const nbk = keys.filter(k => k.kind !== 'blank');
                        if (!nbk.length || nbk.every(k => k.flat === nbk[0].flat)) { st.processed = true; continue; }
                        const flow = detectFlow(keys);
                        this.layer.appendChild(this.buildPill(c, flow, st, rows.length));
                }
                this.layer.style.display = this.layer.childElementCount ? '' : 'none';
                this.positionPills();
        }

        private buildPill(c: number, flow: Flow, st: ColState, rowCount: number): HTMLDivElement {
                const pill = createDiv({ cls: 'vt-sort-pill' });
                pill.dataset.c = String(c);
                pill.addEventListener('pointerdown', (e) => {
                        e.preventDefault(); // 不抢表格焦点（焦点留在格内，选区不受 focusout 清理）
                        e.stopPropagation();
                });
                // 纯文字符号（2026-11-08 用户令）：不画 CSS/SVG、无按钮无边框，孤零零的文字；
                // 每个可点字符一个 span，其矩形盒即触碰热区（flex 相邻盒子天然不重叠）
                const mkCh = (act: Dir | 'skip' | null, ch: string, label: string) => {
                        // 2026-11-10 点5：去掉 title（浏览器原生深灰提示框）只留 aria-label（Obsidian 白色提示）
                        const s = createSpan({
                                cls: 'vt-sort-ch' + (act == null ? ' vt-sort-lab' : ''),
                                text: ch,
                                attr: { 'aria-label': label },
                        });
                        if (act != null) s.addEventListener('click', (e) => this.onChoice(c, flow, st, act, e));
                        pill.appendChild(s);
                };
                if (flow === 'mix') {
                        // A1 流程（2026-11-08 用户补充）：大类混合列，点 A=纯文字在前，点 1=纯数字在前
                        mkCh('asc', 'A', t('纯文字在前（文字→文中数字→文末数字→数字）', 'Text first (text → mid-number → trailing-number → number)'));
                        mkCh('desc', '1', t('数字在前（数字→文末数字→文中数字→纯文字）', 'Numbers first (number → trailing-number → mid-number → text)'));
                } else if (flow === 'num' || flow === 'numonly') {
                        // numonly（2026-11-10 点1）：同文本列单步直排——形态与纯数字列一致；
                        // 2026-11-11 TA 令：→ 保留（跳过 = 该列保持原样完成）
                        mkCh(null, '1', t('数字列', 'Number column'));
                        mkCh('desc', '↑', t('从大到小', 'Descending'));
                        mkCh('asc', '↓', t('从小到大', 'Ascending'));
                        if (flow === 'numonly') mkCh('skip', '→', t('不排数字（保持原样）', 'Skip sorting (keep as is)'));
                } else if (flow === 'text') {
                        mkCh('asc', 'A', t('从A到Z', 'A to Z'));
                        mkCh('desc', 'Z', t('从Z到A', 'Z to A'));
                } else {
                        if (st.stage === 0) {
                                mkCh(null, '1', t('数字步', 'Number step'));
                                mkCh('desc', '↑', t('从大到小', 'Descending'));
                                mkCh('asc', '↓', t('从小到大', 'Ascending'));
                                mkCh('skip', '→', t('不排数字', 'Skip numbers'));
                        } else {
                                mkCh('asc', 'A', t('从A到Z', 'A to Z'));
                                mkCh('desc', 'Z', t('从Z到A', 'Z to A'));
                                mkCh('skip', '→', t('不排字母', 'Skip letters'));
                        }
                }
                if (rowCount < 2) pill.addClass('vt-sort-idle'); // 单格列：点了即完成（无操作）
                return pill;
        }

        private onChoice(c: number, flow: Flow, st: ColState, act: Dir | 'skip', ev: MouseEvent) {
                if (!session) return;
                const rects = this.ctx.getRects();
                const rows = columnsFromRects(rects).get(c) ?? [];
                if (!rows.length) return;
                // 合并单元格守卫（用户钉死：范围内含合并 → 直接报提示，流程不推进）
                const ai = this.ctx.anchorIndex();
                const grid = this.ctx.grid();
                for (const r of rows) {
                        const a = ai.get(`${r},${c}`) ?? { r, c };
                        const cell = grid[a.r]?.[a.c];
                        if (cell && (cell.rs > 1 || cell.cs > 1)) {
                                new Notice(t('所选列范围包含合并单元格，无法排序', 'The selected column range contains merged cells; sorting is not available'));
                                return;
                        }
                }
                if (flow === 'dual') {
                        if (st.stage === 0) {
                                st.numChoice = act;          // 记录数字步选择（或跳过）——字母步主键复用
                                st.stage = 1;                // 原地无缝切字母步
                                this.lastSig = '';           // 强制重建符号形态
                                if (act !== 'skip') {
                                        // 2026-11-13 TA：移除"两步都点完才生效"缓冲——数字步点击即排序、
                                        // 即写回（每次写回独立 CM 事务 = 撤销栈独立记录，Ctrl+Z 逐步回退）
                                        this.execColumn(c, rows, act, 'skip', ev.shiftKey);
                                        return;
                                }
                                this.buildPills();
                                return;
                        }
                        // 字母步：立即执行收尾（主键=数字步选择保数字序，次键=字母；稳定排序）
                        this.completeColumn(c, rows, st.numChoice ?? 'skip', act, ev.shiftKey);
                        return;
                }
                if (flow === 'num' || flow === 'numonly') this.completeColumn(c, rows, act, 'skip', ev.shiftKey);
                else this.completeColumn(c, rows, 'skip', act, ev.shiftKey);
        }

        /** 一列流程走完（立即执行或入队）：标记 processed（流程收尾）后交 execColumn */
        private completeColumn(c: number, rows: number[], numDir: Dir | 'skip', textDir: Dir | 'skip', withShift: boolean) {
                if (!session) return;
                const st = session.cols.get(c);
                if (!st) return;
                st.processed = true;
                this.execColumn(c, rows, numDir, textDir, withShift);
        }

        /** 排序执行（不动流程状态）：2026-11-13 TA——数据物理顺序一变立即写回
         *  （数字步/字母步/单步共用；写回即独立 CM 事务 = 撤销栈逐步记录）。
         *  dual 数字步走此路径不设 processed → 流程续接字母步（选区恢复链自动挂） */
        private execColumn(c: number, rows: number[], numDir: Dir | 'skip', textDir: Dir | 'skip', withShift: boolean) {
                if (!session) return;
                this.ctx.flushActive(); // 键必须基于已冲刷的 grid
                const grid = this.ctx.grid();
                const entries: Entry[] = rows.map(r => ({ r, key: keyOfCell(grid[r]?.[c], grid) }));
                const flow = detectFlow(entries.map(e => e.key));
                const order = orderKeys(entries, flow, numDir, textDir).map(e => grid[e.r][c]);
                this.lastSig = '';
                if (withShift) {
                        this.deferred.push({ c, rows, order });
                        this.buildPills();
                        return;
                }
                const allDone = this.isAllDone();
                this.ctx.applySort(() => this.applyColumn(c, rows, order), allDone);
                this.buildPills();
        }

        /** 松开 shift：队列统一执行（一次提交） */
        private flushDeferred() {
                if (!this.deferred.length || !this.layer) return;
                const items = this.deferred;
                this.deferred = [];
                const allDone = this.isAllDone();
                this.ctx.applySort(() => {
                        for (const it of items) this.applyColumn(it.c, it.rows, it.order);
                }, allDone);
                this.lastSig = '';
                this.buildPills();
        }

        private applyColumn(c: number, rows: number[], order: Cell[]) {
                const grid = this.ctx.grid();
                rows.forEach((r, i) => {
                        const cell = order[i];
                        if (cell) grid[r][c] = { ...cell, rs: 1, cs: 1 };
                });
                // RC 行高适应（用户令：列宽不动，行高适应量）：受影响行的持久化行高归零 = 自然高
                const data = this.ctx.data();
                if (data.mode === 'RC' && data.rowHeights) {
                        for (const r of rows) data.rowHeights[r] = 0;
                }
        }

        private isAllDone(): boolean {
                if (!session) return true;
                const cols = columnsFromRects(session.rects);
                for (const c of cols.keys()) {
                        const st = session.cols.get(c);
                        if (!st || !st.processed) return false;
                }
                return true;
        }

        /* ===== 定位：每帧校准（滚动/布局变化自动跟随，同把手模式） ===== */

        private tick = () => {
                this.raf = window.requestAnimationFrame(this.tick);
                if (!this.layer) return;
                if (!this.ctx.tableEl().isConnected) {
                        this.destroy(true); // 宿主重渲染：会话留给新层续接
                        return;
                }
                if (!this.ctx.getRects().length) {
                        this.destroy(false);
                        return;
                }
                this.positionPills();
        };

        private positionPills() {
                if (!this.layer || !session) return;
                const cols = columnsFromRects(this.ctx.getRects());
                const placed: Array<{ el: HTMLDivElement; left: number; top: number; w: number }> = [];
                for (const pill of Array.from(this.layer.children)) {
                        if (!((pill != null && pill.instanceOf(HTMLDivElement)))) continue;
                        const c = parseInt(pill.dataset.c ?? '-1', 10);
                        const rows = cols.get(c);
                        if (!rows) continue;
                        let td: HTMLTableCellElement | null = null;
                        for (const r of rows) {
                                td = this.ctx.cellTd(r, c);
                                if (td) break;
                        }
                        if (!td) continue;
                        const rect = td.getBoundingClientRect();
                        const w = pill.offsetWidth, h = pill.offsetHeight;
                        placed.push({
                                el: pill,
                                left: rect.left + rect.width / 2 - w / 2,
                                top: rect.top - h - 3,
                                w,
                        });
                }
                // 相邻窄列符号防叠：从左到右让位（列过窄时近似对位，保全部可点）
                placed.sort((a, b) => a.left - b.left);
                let prevRight = -Infinity;
                for (const p of placed) {
                        const left = Math.max(p.left, prevRight + 2);
                        p.el.style.left = `${Math.round(left)}px`;
                        p.el.style.top = `${Math.round(p.top)}px`;
                        prevRight = left + p.w;
                }
        }
}
