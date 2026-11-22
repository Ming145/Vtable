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
 *  3 数字与文字混排（文字在前 / 数字在前均可）：按序列逐步排——
 *    第 1 数字（↑↓→）→ 第 1 文字（AZ→）→ 第 2 数字 → 第 2 文字…直到两个序列都结束；
 *    两序列长度不同时，多出来的那组各成一步（A2Z7M = 2 数字 + 3 文字 = 5 步）；
 *    每一步只按该步的键独立重排（覆盖上一步结果），→ 跳过该步
 *    （香蕉3个/苹果5个 = 2 步；A2Z7/是3C4 = 4 步）
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
        /** 全部数字段（按出现顺序）：多段排序用；纯文本 = [] */
        nums: number[];
        /** 文字段序列：单数字格把前后文字并成一段（保持 2 步）；
         *  多数字格每段文字独立、末尾段也算一段（A2Z7M → ['A','Z','M']，5 步） */
        texts: string[];
}

const TRAIL_NUM = /[+-]?\d+(?:\.\d+)?$/;
const FIRST_NUM = /[+-]?\d+(?:\.\d+)?/;
const NUM_TOKEN = /[+-]?\d+(?:\.\d+)?/g;

/** 平文本 → 数字段序列 + 文字段序列。
 *  单数字格：前后文字合并为一段（香蕉3个 → nums [3]、texts ['香蕉个']，仍 2 步）；
 *  多数字格：每段文字独立，含末尾段（A2Z7M → nums [2,7]、texts ['A','Z','M']，5 步） */
function sequencesOf(flat: string): { nums: number[]; texts: string[] } {
        const nums: number[] = [];
        const before: string[] = [];
        let last = 0;
        for (const m of flat.matchAll(NUM_TOKEN)) {
                const at = m.index ?? 0;
                before.push(flat.slice(last, at).trim());
                nums.push(parseFloat(m[0]));
                last = at + m[0].length;
        }
        if (!nums.length) return { nums: [], texts: [] };
        const trailing = flat.slice(last).trim();
        if (nums.length === 1) {
                const all = (before[0] + trailing).trim();
                return { nums, texts: all ? [all] : [] };
        }
        return { nums, texts: [...before, trailing].filter(Boolean) };
}

/** 单格 → 比较键。公式（=FUNC(...)）：求值成功按结果参与（数值结果 = 数字型），
 *  算不了按显示文本参与——"无非就是算不了显示一下"（导出供测试） */
export function keyOfCell(cell: Cell | undefined, grid: Grid): Key {
        const blank = (): Key => ({ kind: 'blank', value: null, flat: '', prefix: '', firstNum: null, rank: 0, nums: [], texts: [] });
        if (!cell || (cell.rs === 0 && cell.cs === 0)) return blank();
        let flat = sortFlatText(cell.t);
        if (/^=[A-Za-z]+\(/.test(cell.t)) flat = sortFlatText(evalFormula(grid, cell.t));
        if (!flat) return blank();
        const { nums, texts } = sequencesOf(flat);
        const fm0 = flat.match(FIRST_NUM);
        const prefix0 = fm0 ? flat.slice(0, fm0.index) : flat;
        const firstNum0 = fm0 ? parseFloat(fm0[0]) : null;
        const tm = flat.match(TRAIL_NUM);
        if (tm) {
                // 末尾数字（含纯数字）：value = 尾数字；prefix/firstNum 留作流程判定
                return {
                        kind: 'num',
                        value: tm[0].length === flat.length ? parseFloat(flat) : parseFloat(tm[0]),
                        flat, prefix: prefix0, firstNum: firstNum0,
                        rank: tm[0].length === flat.length ? 3 : 2, // 纯数字 3 / 文末数字 2
                        nums, texts,
                };
        }
        return { kind: 'text', value: null, flat, prefix: prefix0, firstNum: firstNum0, rank: fm0 ? 1 : 0, nums, texts }; // 文中数字 1 / 纯文字 0
}

export type Flow = 'num' | 'text' | 'dual' | 'mix' | 'numonly';

/** 列流程判定（只看非空格）：
 *  大类（纯文字 / 数文结合 / 纯数字）两档以上共存 → mix（A1 流程）；
 *  纯数字（无文字）→ num 单步；
 *  数字+文字混排（文字在前 / 数字在前均可）：
 *    文字段序列全同 → numonly 单步（其它文字都一样就不需要文字步）；
 *    文字组不同 → dual（按序列逐步：第 1 数字 → 第 1 文字 → 第 2 数字 → 第 2 文字…，
 *    两个序列长度不同时，多出来的那组各成一步）；
 *  纯文字 → text（导出供测试） */
export function detectFlow(keys: Key[]): Flow {
        const nb = keys.filter(k => k.kind !== 'blank');
        if (!nb.length) return 'text';
        // 大类：rank 0=纯文字、3=纯数字、1/2=数字与文字结合（文中/文末）
        const cats = new Set(nb.map(k => (k.rank === 0 || k.rank === 3) ? k.rank : 2));
        if (cats.size >= 2) return 'mix';
        if (nb.every(k => k.nums.length > 0 && k.texts.length > 0)) {
                // 文字段序列全同（只有数字不同）→ 单步只排数字
                const sig = (k: Key) => k.texts.join('\u0001');
                if (nb.every(k => sig(k) === sig(nb[0]))) return 'numonly';
                return 'dual';
        }
        if (nb.every(k => k.kind === 'num' && k.prefix === '')) return 'num';
        return 'text';
}

/** 文本比较：中文按拼音（zh 整理默认拼音序）、英文不分大小写。
 *  中英分层（2026-11-18 题2）：ICU zh 整理把拉丁字母排在汉字之后（'B'.localeCompare('是')>0），
 *  与直觉相反——先按首字符是否汉字分层：英文/数字组在前、中文组按拼音在后；同组内原规则比较 */
function coll(a: string, b: string): number {
        const ga = isHanLead(a), gb = isHanLead(b);
        if (ga !== gb) return ga ? 1 : -1;
        return a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' });
}
const isHanLead = (s: string): boolean => /^[\u3400-\u4dbf\u4e00-\u9fff]/.test(s);

interface Entry { r: number; key: Key }
export type SortEntry = Entry;

/** 一列键序列 → 新顺序（调用方按序回填格子负载）。导出供测试。
 *  mix（A1 流程，2026-11-08 用户钉死）：只排大类（纯文字→文中有数字→文末有数字→纯数字，
 *  按 1 反向），档内保持原顺序不排序；空白最后。
 *  分区（11-07 原规则）：数字型组在前、文本型组在后、空白最后；组内按所选方向有序，稳定保序。
 *  dual 不走这里：SortBar 按"第 1 组数字 → 第 1 组文字 → 第 2 组数字…"逐步排序（execStep）。
 *  numonly：同文字列只比数字组序列；→ 跳过 = 原样 */

/** 数字段序列比较（依次比较；一方缺该段则不判负，保稳定） */
function cmpNums(a: number[], b: number[], dir: Dir): number {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
                const d = a[i] - b[i];
                if (d !== 0) return dir === 'asc' ? d : -d;
        }
        return 0;
}

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
                const all = entries.filter(e => e.key.kind !== 'blank');
                const sorted = all.slice().sort((x, y) => cmpNums(x.key.nums, y.key.nums, numDir));
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
        /** 本次 renderBlock 的唯一 id：代码块 widget 每次重渲染都换新 el（noReuse），
         *  会话归属改按渲染 id + 选区判定，不能再拿 el 当身份 */
        renderId(): number;
        /** render 侧是否还有"排序后回灌"请求未落定。重渲染撕 DOM 期间出现的瞬时空选区
         *  不能当成"用户放弃流程"清掉会话/快照（2026-11-22 修复：正常点方向只能走 2 步的根因） */
        pendingRestore(): boolean;
        /** 整行排序开关（2026-11-18 题4）：true = 一格被挪整行挪 */
        fullRow(): boolean;
}

interface ColState {
        processed: boolean;
        /** dual 当前步骤下标；具体类型/序号由 stepPlan 决定
         *  （第 1 数字 → 第 1 文字 → 第 2 数字 → 第 2 文字…，多出的组各成一步）。
         *  每一步独立排序（不看上一步结果）；走完计划后置 processed */
        step: number;
}

interface Session {
        /** 归属的渲染 id：跨渲染/跨表续接校验（el 每次重渲染都是新的，不能用作身份） */
        renderId: number;
        rects: SelRect[];
        cols: Map<number, ColState>;
}

/** 模块级会话：跨重渲染存续（新 SortBar 按 renderId + 选区续接状态） */
let session: Session | null = null;

/** 流程快照：每次未完成排序落定时记录 rects+各列状态深拷贝。
 *  代码块 widget 每次重渲染都换新 el（Obsidian noReuse），快照因此不绑宿主；
 *  render 侧按"排序后写回的源码 + 路径"匹配，再调 restoreFlow 回灌。
 *  作废点：选区清空（sync([])）/ 流程全部完成（allDone） */
let flowSnapshot: { rects: SelRect[]; cols: Map<number, ColState> } | null = null;
const captureFlowSnapshot = () => {
        if (!session) return;
        flowSnapshot = {
                rects: session.rects.map(rc => ({ ...rc })),
                cols: new Map([...session.cols].map(([k, v]) => [k, { ...v }])),
        };
};

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
                const rid = this.ctx.renderId();
                if (!rects.length) {
                        // 回灌请求还挂着 = 这是重渲染撕 DOM 的瞬时空选区，不是用户放弃流程：
                        // 只拆层、保留 session/flowSnapshot，等 render 尾部按源码回灌
                        const pending = this.ctx.pendingRestore();
                        if (this.layer) this.destroy(pending);
                        if (pending) return;
                        if (session && session.renderId === rid) session = null;
                        // 空选区 = 流程结束/被放弃：快照作废，后续重渲染不再回灌
                        flowSnapshot = null;
                        return;
                }
                // 同一渲染内选区变了 / 会话属于别的渲染（切表）→ 旧会话作废
                if (session && (session.renderId !== rid || !sameRects(session.rects, rects))) session = null;
                if (!session) session = { renderId: rid, rects: rects.map(rc => ({ ...rc })), cols: new Map() };
                if (!this.layer) {
                        this.layer = document.body.createDiv({ cls: 'vt-sort-layer' });
                        document.addEventListener('keyup', this.onShiftUp);
                        window.addEventListener('blur', this.onWinBlur);
                        this.raf = window.requestAnimationFrame(this.tick);
                }
                this.buildPills();
        }

        /** 排序后重渲染回灌（render 侧在源码匹配时调用，先于 renderSel）：
         *  按快照恢复整列流程状态（当前 step），选区由 render 侧设好。
         *  快照丢失时退回沿用旧会话（同选区），保证 step 不丢 */
        restoreFlow(rects: SelRect[]): void {
                if (!rects.length) return;
                const rid = this.ctx.renderId();
                const snap = flowSnapshot;
                if (snap && sameRects(snap.rects, rects)) {
                        session = {
                                renderId: rid,
                                rects: rects.map(rc => ({ ...rc })),
                                cols: new Map([...snap.cols].map(([k, v]) => [k, { ...v }])),
                        };
                } else if (session && sameRects(session.rects, rects)) {
                        session = {
                                renderId: rid,
                                rects: rects.map(rc => ({ ...rc })),
                                cols: new Map([...session.cols].map(([k, v]) => [k, { ...v }])),
                        };
                }
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
                // 只清属于本次渲染的会话：旧 SortBar 的延迟销毁不得清掉新渲染刚回灌的会话
                if (!keepSession && session && session.renderId === this.ctx.renderId()) session = null;
        }

        private onShiftUp = (e: KeyboardEvent) => {
                if (e.key !== 'Shift') return;
                this.flushDeferred();
        };

        private onWinBlur = () => {
                this.flushDeferred(); // 松键事件丢失兜底：shift 已不在，队内排序统一执行
        };

        /** 符号构建：未处理的列各一粒（processed 的不建）；dual 按当前 step 显示数字/文字组符号 */
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
                        const st = session.cols.get(c) ?? { processed: false, step: 0 };
                        session.cols.set(c, st);
                        if (st.processed) continue;
                        // 单格列 / 全同列：不显示排序符号（2026-11-10 点2），直接视为已完成
                        if (rows.length < 2) { st.processed = true; continue; }
                        const keys = rows.map(r => keyOfCell(grid[r]?.[c], grid));
                        const nbk = keys.filter(k => k.kind !== 'blank');
                        if (!nbk.length || nbk.every(k => k.flat === nbk[0].flat)) { st.processed = true; continue; }
                        const flow = detectFlow(keys);
                        if (flow === 'dual') {
                                // 序列逐步：第 1 数字 → 第 1 文字 → 第 2 数字 → 第 2 文字…
                                // 两个序列长度不同时，多出来的那组各成一步（A2Z7M = 5 步）
                                const maxNums = Math.max(...nbk.map(k => k.nums.length));
                                const maxTexts = Math.max(...nbk.map(k => k.texts.length));
                                const plan = this.stepPlan(maxNums, maxTexts);
                                if (st.step >= plan.length) { st.processed = true; continue; }
                                const step = plan[st.step];
                                this.layer.appendChild(this.buildStepPill(c, step.type === 'num', step.index, st, rows.length, plan.length));
                                continue;
                        }
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
                }
                if (rowCount < 2) pill.addClass('vt-sort-idle'); // 单格列：点了即完成（无操作）
                return pill;
        }

        /** dual 的单个步骤符号：第 index 个数字 / 第 index 段文字（每一步独立排序）。
         *  开头的 `n/total` 是步骤进度（一眼看出这列到底有几步，排到第几步） */
        private buildStepPill(c: number, isNum: boolean, index: number, st: ColState, rowCount: number, total: number): HTMLDivElement {
                const pill = createDiv({ cls: 'vt-sort-pill' });
                pill.dataset.c = String(c);
                pill.addEventListener('pointerdown', (e) => {
                        e.preventDefault(); // 不抢表格焦点（焦点留在格内，选区不受 focusout 清理）
                        e.stopPropagation();
                });
                const stepNo = createSpan({
                        cls: 'vt-sort-stepno',
                        text: `${st.step + 1}/${total}`,
                        attr: { 'aria-label': t(`第 ${st.step + 1} 步，共 ${total} 步`, `Step ${st.step + 1} of ${total}`) },
                });
                pill.appendChild(stepNo);
                const mkCh = (act: Dir | 'skip' | null, ch: string, label: string) => {
                        const s = createSpan({
                                cls: 'vt-sort-ch' + (act == null ? ' vt-sort-lab' : ''),
                                text: ch,
                                attr: { 'aria-label': label },
                        });
                        if (act != null) s.addEventListener('click', (e) => this.onChoice(c, 'dual', st, act, e));
                        pill.appendChild(s);
                };
                const n = index + 1;
                if (isNum) {
                        // 前面的 n/m 已表明当前步骤，不再放静态 "1" 标签（2026-11-22 用户令）
                        mkCh('desc', '↑', t(`数字步（第 ${n} 组）从大到小`, `Number step ${n}, descending`));
                        mkCh('asc', '↓', t(`数字步（第 ${n} 组）从小到大`, `Number step ${n}, ascending`));
                        mkCh('skip', '→', t('跳过这组数字', 'Skip this group’s numbers'));
                } else {
                        mkCh('asc', 'A', t(`文字步（第 ${n} 组）`, `Text step (group ${n})`));
                        mkCh('desc', 'Z', t('从Z到A', 'Z to A'));
                        mkCh('skip', '→', t('跳过这组文字', 'Skip this group’s text'));
                }
                if (rowCount < 2) pill.addClass('vt-sort-idle');
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
                        const keys = rows.map(r => keyOfCell(grid[r]?.[c], grid));
                        const maxNums = Math.max(...keys.map(k => k.nums.length));
                        const maxTexts = Math.max(...keys.map(k => k.texts.length));
                        const plan = this.stepPlan(maxNums, maxTexts);
                        const step = plan[st.step];
                        if (!step) { st.processed = true; this.buildPills(); return; }
                        st.step += 1;
                        if (st.step >= plan.length) st.processed = true;
                        this.lastSig = '';
                        if (act === 'skip') {
                                // 跳过本步：不改数据；若正好走完最后一步，按空变更收尾（清选区）。
                                // 未完成则补记快照（无写回也会推进 step，防重渲染退回旧步）
                                if (this.isAllDone()) this.ctx.applySort(() => {}, true);
                                else { captureFlowSnapshot(); this.buildPills(); }
                                return;
                        }
                        this.execStep(c, rows, step.index, step.type === 'num', act, ev.shiftKey);
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

        /** 非 dual 单步：算好顺序后统一落定 */
        private execColumn(c: number, rows: number[], numDir: Dir | 'skip', textDir: Dir | 'skip', withShift: boolean) {
                if (!session) return;
                this.ctx.flushActive(); // 键必须基于已冲刷的 grid
                const grid = this.ctx.grid();
                const entries: Entry[] = rows.map(r => ({ r, key: keyOfCell(grid[r]?.[c], grid) }));
                const flow = detectFlow(entries.map(e => e.key));
                const sortedEntries = orderKeys(entries, flow, numDir, textDir);
                const order = sortedEntries.map(e => grid[e.r][c]);
                this.commitOrder(c, rows, order, sortedEntries.map(e => e.r), withShift);
        }

        /** dual 的单步：只按第 index 个数字 / 第 index 段文字排（每一步独立，不看上一步结果） */
        private execStep(c: number, rows: number[], index: number, isNum: boolean, dir: Dir, withShift: boolean) {
                if (!session) return;
                this.ctx.flushActive();
                const grid = this.ctx.grid();
                const entries: Entry[] = rows.map(r => ({ r, key: keyOfCell(grid[r]?.[c], grid) }));
                const sortedEntries = entries.slice().sort((x, y) => {
                        if (isNum) {
                                const a = x.key.nums[index], b = y.key.nums[index];
                                if (a == null || b == null) return 0;
                                const d = a - b;
                                return dir === 'asc' ? d : -d;
                        }
                        const a = x.key.texts[index], b = y.key.texts[index];
                        if (a == null || b == null) return 0;
                        const cc = coll(a, b);
                        return dir === 'asc' ? cc : -cc;
                });
                const order = sortedEntries.map(e => grid[e.r][c]);
                this.commitOrder(c, rows, order, sortedEntries.map(e => e.r), withShift);
        }

        /** 一列的步骤计划：第 1 数字 → 第 1 文字 → 第 2 数字 → 第 2 文字…
         *  两个序列长度不同时，多出来的那组各成一步。
         *  例：A2Z7M（2 数字 + 3 文字）= 5 步；A2Z7 = 4 步；香蕉3个 = 2 步 */
        private stepPlan(maxNums: number, maxTexts: number): Array<{ type: 'num' | 'text'; index: number }> {
                const plan: Array<{ type: 'num' | 'text'; index: number }> = [];
                const n = Math.max(maxNums, maxTexts);
                for (let i = 0; i < n; i++) {
                        if (i < maxNums) plan.push({ type: 'num', index: i });
                        if (i < maxTexts) plan.push({ type: 'text', index: i });
                }
                return plan;
        }

        /** 落定：入队/提交、整行模式、快照、写回。
         *  dual 每一步独立覆盖（不走 deferred，保证跨重渲染续接） */
        private commitOrder(c: number, rows: number[], order: Cell[], sortedRs: number[], withShift: boolean) {
                this.lastSig = '';
                if (withShift) {
                        this.deferred.push({ c, rows, order });
                        this.buildPills();
                        return;
                }
                const allDone = this.isAllDone();
                const grid = this.ctx.grid();
                // 整行模式（2026-11-18 题4）：行范围含跨行合并格时整行挪会撕烂合并 → 提示不执行
                if (this.ctx.fullRow()) {
                        for (const r of rows) {
                                for (const cd of grid[r]) {
                                        if ((cd?.rs ?? 1) > 1) {
                                                new Notice(t('行内有跨行合并单元格，无法整行排序', 'Rows contain vertically merged cells; full-row sorting is not available'));
                                                return;
                                        }
                                }
                        }
                }
                const applyMutate = this.ctx.fullRow()
                        ? () => {
                                // 整行挪：rows 的各位置放排序后的整行（行引用整体对调）
                                const moved = sortedRs.map(r => grid[r]);
                                rows.forEach((r, i) => { grid[r] = moved[i]; });
                                // RC 行高随行走：目标位置行高归零 = 自然高（同列内排序语义）
                                const data = this.ctx.data();
                                if (data.mode === 'RC' && data.rowHeights) {
                                        for (const r of rows) data.rowHeights[r] = 0;
                                }
                        }
                        : () => this.applyColumn(c, rows, order);
                // 快照必须先于 applySort：applySort→onCommit 可能同步触发重渲染，重渲染尾部
                // 会立刻按快照回灌（晚一拍会错过）；allDone 则先作废（防已完成流程复活）
                if (allDone) flowSnapshot = null;
                else captureFlowSnapshot();
                this.ctx.applySort(applyMutate, allDone);
                this.buildPills();
        }

        /** 松开 shift：队列统一执行（一次提交） */
        private flushDeferred() {
                if (!this.deferred.length || !this.layer) return;
                const items = this.deferred;
                this.deferred = [];
                const allDone = this.isAllDone();
                // 队列跨多步/多列时，同一快照要带上当前 step，否则重渲染后回灌会退回旧步
                if (allDone) flowSnapshot = null;
                else captureFlowSnapshot();
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
