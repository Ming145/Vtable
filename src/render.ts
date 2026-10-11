/**
 * render.ts
 * vtable 代码块处理器：可编辑表格、模式切换、富文本渲染
 */

import { Menu, Notice, loadMathJax, renderMath, finishRenderMath, Platform, setIcon , createEl } from 'obsidian';
import { t } from './i18n';
import {
        parseSource, serialize, visible, Grid, VtData, VtMode, normalizeCellNewlines,
        insertRow, deleteRow, insertCol, deleteCol,
        mergeRight, mergeDown, splitCell,
        mergeRange, deleteRows, deleteCols,
        insertRowsAbove, insertRowsBelow, insertColsLeft, insertColsRight,
        toggleWrapTag, toggleTodoMark,
        mdInlineToHtml, stripRcHandles, colCount, escapeHtml,
} from './builder';
import { parseMarkdownTable } from './paste-grid';
import {
        buildAnchorIndex, normalizeSelRect, rectContains, runsFromRects,
        unionSelBounds, isSolidUnion,
        SelOverlay, SelRect, SelOps, FocusShift,
} from './sel';
import { Toolbar } from './bar';
import { bindRowColDrag } from './drag';
import { FillHandle } from './fill';
import {
        isDiag, buildDiagDom, bindDiagTd,
        prepareDiagEdit, enterDiagZone, exitDiagEdit,
        pointInZoneA, diagPlainText, writeDiagZoneText,
} from './diag';
import { evalFormula } from './formula';
import {
        attachWysiwyg,
        enterWysiwyg,
        exitWysiwyg,
        projectSource,
        caretSourceOffset,
        placeCaretAtSourceOffset,
        isWysiwyg,
        type WysiwygCtx,
} from './wysiwyg';
import {
        ModeSwitcher, applyModeStyles, bindRcResizeHandles, autoExpandRowHeight,
        setupHsScrollBar,
} from './modes';
import type { VtSettings } from './main';
import { parseTrustedHtml } from './html';

let mathJaxReady: Promise<void> | null = null;
function ensureMathJax(): Promise<void> {
        if (!mathJaxReady) mathJaxReady = loadMathJax();
        return mathJaxReady;
}

function scheduleMathRender(root: HTMLElement) {
        void ensureMathJax().then(() => {
                if (renderMathInNode(root)) void finishRenderMath();
        });
}

/** 当前聚焦的可编辑表格控制器（供命令/快捷键使用） */
export interface TableController {
        moveCell: (dr: number, dc: number) => boolean;
        setMode: (mode: VtMode) => void;
        getMode: () => VtMode;
        /** 当前是否存在选框模式选区 */
        hasSelection: () => boolean;
        /** 选区设置水平对齐（命令/快捷键入口） */
        alignSel: (mode: 'l' | 'c' | 'r') => void;
        /** 选区设置垂直对齐（t/m/b；命令入口） */
        alignVSel: (mode: 't' | 'm' | 'b') => void;
        /** 选区设置底色；null = 清除（命令/快捷键入口） */
        colorSel: (color: string | null) => void;
        /** 清空选区内容（不动结构） */
        clearSelContent: () => void;
        /** 打开选区底色取色弹窗 */
        pickColor: () => void;
        /** 提交未落盘的编辑（切视图/布局变化时宿主调用）：
         *  Obsidian 切阅读视图可能只隐藏编辑容器而不摘 DOM → td 不触发 blur，
         *  未失焦的编辑内容停留在此表格实例的内存 grid 里，需要外部钩子提交 */
        flushCommit: () => void;
        /** 命令「添加/删除表头底色」：切换单表格底色开关（写 data.noHeaderBg），
         *  立即重应用外观并写回源码。返回切换后是否显示底色 */
        toggleHeaderBg: () => boolean;
        /** 命令「添加表头底色」：只加不删（幂等）——单表强制开启表头底色（清 noHeaderBg）。
         *  返回是否实际执行了添加（本来就有时为 false） */
        addHeaderBg: () => boolean;
        /** 命令「斜分单元格」：对光标所在格/选区格切换对角线斜分（开=两区单行输入）。
         *  开区文本进 dg（右上）、原文本转纯文本留 t（左下）；关时两区文本拼回 t。
         *  返回是否执行了切换 */
        toggleDiag: () => boolean;
        /** 命令「表格样式调用」：弹出选择框（三线表/无格线/全横线），写 data.style 单表覆盖；
         *  点当前生效项 = 显式取消（'off'）。由 main.ts 提供选择框 UI */
        styleCall: (pick: (opts: Array<{ value: TblStyle; name: string; checked: boolean }>) => Promise<TblStyle | null>) => Promise<void>;
        /** 命令「删除表格样式」：只删不加——表格有任何样式（线风格/隔行/表头底色）→ 全部取消。
         *  返回是否实际取消了样式（本来无样式时返回 false） */
        toggleStyleAll: () => boolean;
        /** 命令「隔行变色样式」：切换单表隔行变色（颜色取设置里最后一次配置的色；
         *  从未配置 → 主题色）。返回切换后是否开启 */
        toggleZebra: () => boolean;
}

let activeController: TableController | null = null;

/** 外观刷新注册表：设置变更（圆角/表头底色）时对所有在文档中的表格即时生效 */
const appearanceRegistry = new Map<HTMLElement, () => void>();

/** 设置变更后调用：刷新所有已渲染表格的圆角与表头底色 */

/** 受控 HTML → DocumentFragment：统一走 parseTrustedHtml（html.ts，官方 eslint 合规路径） */

export function refreshAllTableAppearance() {
        for (const [host, refresh] of appearanceRegistry) {
                if (!host.isConnected) { appearanceRegistry.delete(host); continue; }
                refresh();
        }
}


/** 解析 CSS 颜色为 RGB；不认识的格式返回 null */
function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
        const s = color.trim();
        let m = s.match(/^#([0-9a-f]{3})$/i);
        if (m) {
                const [r, g, b] = m[1]!.split('').map(ch => parseInt(ch + ch, 16));
                return { r: r!, g: g!, b: b! };
        }
        m = s.match(/^#([0-9a-f]{6})$/i);
        if (m) {
                const n = parseInt(m[1]!, 16);
                return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        }
        m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
        // hsl() / hsla()（默认主题的强调色分量按 HSL 组合，需支持）
        m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
        if (m) {
                const h = +m[1]! / 360, sa = +m[2]! / 100, li = +m[3]! / 100;
                const q = li < 0.5 ? li * (1 + sa) : li + sa - li * sa;
                const p = 2 * li - q;
                const hue2rgb = (t: number): number => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1 / 6) return p + (q - p) * 6 * t;
                        if (t < 1 / 2) return q;
                        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                        return p;
                };
                return {
                        r: Math.round(hue2rgb(h + 1 / 3) * 255),
                        g: Math.round(hue2rgb(h) * 255),
                        b: Math.round(hue2rgb(h - 1 / 3) * 255),
                };
        }
        return null;
}

/**
 * 解析 Obsidian 主题强调色（表头底色「主题色」用）。
 * 逐级尝试：变量声明直接读（社区主题）→ 默认主题 HSL 分量组合 → 探针 computed
 * （解析嵌套 var() 链后的最终色）。全部失败才返回 null（调用方兜底）。
 * 兼容默认主题与社区主题两套变量体系：
 *   社区主题常定义 --interactive-accent；
 *   默认主题用 --accent-color（自定义主色）/ --accent-h|s|l（HSL 分量）。
 */
function resolveThemeAccent(el: HTMLElement): string | null {
        const vars = ['--interactive-accent', '--accent-color'];
        for (const host of [document.body, el]) {
                const cs = getComputedStyle(host);
                for (const name of vars) {
                        const raw = cs.getPropertyValue(name).trim();
                        if (raw && parseColorToRgb(raw)) return raw;
                }
                // 默认主题：HSL 分量（大小写两套历史变量名都试）
                const h = cs.getPropertyValue('--accent-h').trim() || cs.getPropertyValue('--accent-H').trim();
                const sa = cs.getPropertyValue('--accent-s').trim() || cs.getPropertyValue('--accent-S').trim();
                const li = cs.getPropertyValue('--accent-l').trim() || cs.getPropertyValue('--accent-L').trim();
                if (h && sa && li) {
                        const s2 = sa.endsWith('%') ? sa : `${sa}%`;
                        const l2 = li.endsWith('%') ? li : `${li}%`;
                        return `hsl(${parseFloat(h)}, ${s2}, ${l2})`;
                }
        }
        // 探针：浏览器解析嵌套 var() 后的最终色（恒为 rgb()/rgba()，能识别全部主题写法）
        const probe = createEl('span');
        probe.setCssProps({ color: 'var(--interactive-accent, var(--accent-color, transparent))' });
        el.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();
        if (computed && !/transparent/i.test(computed) && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(computed)) {
                return computed;
        }
        return null;
}

/** 底色足够深 → 白字，足够浅 → 黑字（表头/单元格底色的对比文字色） */
export function contrastTextColor(bg: string): string {
        const rgb = parseColorToRgb(bg);
        if (!rgb) return '#000000';
        const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        return lum > 150 ? '#000000' : '#ffffff';
}

/* ===== 表格样式（三线表/无格线/全横线/隔行变色） ===== */

export type TblStyle = 'three' | 'noline' | 'hline';

/** 单表生效的线风格：单表覆盖（data.style）优先于全局设置；'off' = 显式取消 → null */
export function effTblStyle(data: VtData, settings: VtSettings): TblStyle | null {
        if (data.style === 'off') return null;
        if (data.style) return data.style;
        return settings.tblStyleEnabled && settings.tblStyle !== 'none' ? settings.tblStyle : null;
}

/** 单表生效的隔行变色：单表开关（data.zebra）优先于全局设置 */
export function effZebra(data: VtData, settings: VtSettings): boolean {
        if (data.zebra !== undefined) return data.zebra;
        return settings.zebraEnabled && settings.zebraStyle !== 'none';
}

/** 隔行色（命令/应用通用）：设置里最后一次配置的色；自定义色 → 深色反白文字；
 *  主题色（或从未设置）→ 强调色低透明度（色淡不抢文字，无需反色） */
export function zebraTintOf(settings: VtSettings, el: HTMLElement): { bg: string; fg: string } {
        if (settings.zebraStyle === 'custom' && (settings.zebraColor ?? '').trim()) {
                const bg = settings.zebraColor.trim();
                return { bg, fg: contrastTextColor(bg) };
        }
        const accent = resolveThemeAccent(el) ?? '#7c3aed';
        const rgb = parseColorToRgb(accent);
        const bg = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)` : accent;
        return { bg, fg: '' };
}

/** 提交后恢复聚焦的单元格（re-render 时使用） */
let pendingFocusRestore: {
        r: number;
        c: number;
        caretAtEnd: boolean;
        /** 恢复时把光标放到此字符偏移处（bug2：插入行列后光标留在原位置）；null = 走 caretAtEnd 逻辑 */
        textOffset?: number | null;
        /** 创建表格的自动聚焦：请求有效期（防重复消费与过期重挂） */
        expires?: number;
        /** 创建表格的自动聚焦：目标代码块源文本（多表文档里只有匹配的块可消费此请求） */
        expectSource?: string;
} | null = null;

/** 提交后恢复选区（批量操作后 re-render 时使用）；host 保证只作用于原表格 */
let pendingSelectionRestore: { rects: SelRect[]; host: HTMLElement } | null = null;

/** 最近一次触摸滚动的时刻：iOS WKWebView 已知死锁——程序性写 scrollTop 撞上触摸
 *  惯性滚动会令触摸滚动永久失效（"页面划不动、重启才恢复"）。restore 写入前必须确认
 *  触摸已静默足够久，绝不与惯性滚动竞争 */
let lastTouchScrollAt = 0;
if (typeof document !== 'undefined') {
        const markTouch = () => { lastTouchScrollAt = Date.now(); };
        document.addEventListener('touchstart', markTouch, { passive: true, capture: true });
        document.addEventListener('touchmove', markTouch, { passive: true, capture: true });
        document.addEventListener('touchend', markTouch, { passive: true, capture: true });
        document.addEventListener('touchcancel', markTouch, { passive: true, capture: true });
}

/** bug4：写回前记录表格在滚动容器内的视口偏移，重渲染稳定后按锚点还原滚动位置 */
let pendingScrollAnchor: {
        host: HTMLElement;
        scroller: HTMLElement;
        scrollTop: number;
        offsetTop: number;
        expires: number;
} | null = null;

/** writeBack 前调用：记录当前滚动锚点 */
export function noteScrollAnchor(el: HTMLElement) {
        // 实时预览滚在 .cm-scroller；阅读模式滚在预览视图
        const scroller = (el.closest('.cm-scroller')
                ?? el.closest('.markdown-preview-view, .markdown-reading-view')) as HTMLElement | null;
        if (!scroller) return;
        pendingScrollAnchor = {
                host: el,
                scroller,
                scrollTop: scroller.scrollTop,
                offsetTop: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
                // 重渲染管线（含大文档/多表）可能持续数秒，放宽到 6s
                expires: Date.now() + 6000,
        };
}

/** 预约下一次渲染的 vtable 自动聚焦到指定单元格（用于「创建 vtable」后直接进入 A1 编辑）。
 *  expectSource：创建命令传入新代码块源文本——多表文档里其它 vtable 重渲染时不得偷走此请求 */
export function requestInitialFocus(r: number, c: number, expectSource?: string) {
        pendingFocusRestore = { r, c, caretAtEnd: false, expires: Date.now() + 2500, expectSource };
        startFocusPoll();
}

/* ===== 创建后聚焦：轮询兜底 =====
 *  renderBlock 内的消费路径有时序盲区：CM 渲染 code block 时可能重建 widget（连渲两轮），
 *  第一轮消费请求后其 DOM 被丢弃——"挂回"依赖下一次 renderBlock，但 widget 重建不重跑
 *  markdown processor，请求会挂到过期（症状：创建后光标一直停在表格上方）。
 *  轮询器不依赖 renderBlock 再次执行：每 100ms 检查"最新完成构建的表格"（含 widget 重建
 *  后的最终 DOM），就绪即聚焦。不变量：pendingFocusRestore 挂着 = 聚焦任务未完成。 */
let latestRenderSource = '';
let latestFocusRunner: ((r: number, c: number, caretAtEnd: boolean, textOffset: number | null) => boolean) | null = null;
let focusPollTimer: number | null = null;

function startFocusPoll() {
        if (focusPollTimer !== null) return;
        focusPollTimer = window.setInterval(() => {
                const req = pendingFocusRestore;
                if (!req || req.expires === undefined || Date.now() > req.expires) {
                        if (focusPollTimer !== null) { window.clearInterval(focusPollTimer); focusPollTimer = null; }
                        return;
                }
                if (req.expectSource === undefined
                        || latestRenderSource !== req.expectSource
                        || !latestFocusRunner) return;
                if (latestFocusRunner(req.r, req.c, req.caretAtEnd, req.textOffset ?? null)) {
                        pendingFocusRestore = null;
                        if (focusPollTimer !== null) { window.clearInterval(focusPollTimer); focusPollTimer = null; }
                }
        }, 100);
}

export function getActiveTableController(): TableController | null {
        // 优先聚焦控制器；无焦点但存在选框选区时回退到选区所属表格（侧栏命令按钮场景）
        return activeController ?? selectionOwner;
}

/** 当前持有选框选区的表格控制器（选区在、焦点不在时供命令使用） */
let selectionOwner: TableController | null = null;

/* ===== 重渲染视觉冻结（防"闪一下"） =====
 * 写回/勾选/拖动落定都走 onCommit → Obsidian replaceRange → processor 重跑：
 * 旧表先被 empty 清掉、新表稍后才插入，中间的空档在 iPad 上肉眼可见（"拖动松手后闪一下"）。
 * 做法：渲染前把旧容器克隆成 fixed 死快照盖在原位，新内容就绪后移除——
 * 过渡期用户看到的是静止的旧画面（位置尺寸一致），切换无空档。 */
const ghostMap = new WeakMap<HTMLElement, HTMLElement>();

function clearVisualSnapshot(el: HTMLElement) {
        const g = ghostMap.get(el);
        if (g) { g.remove(); ghostMap.delete(el); }
}

function preserveVisualSnapshot(el: HTMLElement) {
        clearVisualSnapshot(el); // 上一轮快照仍在（CM 连渲两轮）→ 新一轮已就绪，直接清
        if (!el.isConnected) return;
        const old = el.firstElementChild as HTMLElement | null;
        if (!old || !old.classList.contains('vtable-container')) return;
        const r = old.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const ghost = old.cloneNode(true) as HTMLElement;
        ghost.classList.add('vt-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        // 拖动幽灵快照的定位样式：clone 副本自身无 inline 样式，逐条设置等价原写法
        for (const [p, v] of [
                ['position', 'fixed'], ['left', `${r.left}px`], ['top', `${r.top}px`],
                ['width', `${r.width}px`], ['height', `${r.height}px`], ['margin', '0'],
                ['z-index', '999'], ['pointer-events', 'none'], ['overflow', 'hidden'],
                ['background', 'var(--background-primary, #ffffff)'],
        ] as const) ghost.style.setProperty(p, v);
        document.body.appendChild(ghost);
        ghostMap.set(el, ghost);
        window.setTimeout(() => clearVisualSnapshot(el), 600); // 兜底（正常由渲染完成回调清除）
}

export function renderBlock(
        source: string,
        el: HTMLElement,
        toolbar: Toolbar,
        settings: VtSettings,
        sourcePath: string,
        resolveImage: (linkText: string) => string | null,
        onCommit: (newSource: string) => void,
        onConvertToMd: (grid: Grid) => void,
        onConvertToHtml: (grid: Grid) => void,
        onExitTable: (direction: -1 | 1) => void,
        onPickColor: (initial: string, cb: (color: string | null) => void) => void,
        onOpenLink: (linkText: string) => void,
        obsidianCommand: (cmdId: string) => { name: string; run: () => void } | null,
) {
        preserveVisualSnapshot(el);
        el.empty();
        el.classList.add('vtable-container');

        // bug1：浮窗引用的格已脱离 DOM（重渲染/切标签页/焦点元素被摘除时 blur 不触发）→ 立即隐藏
        if (!pendingFocusRestore && !pendingSelectionRestore) toolbar.hideIfStale();

        const data = parseSource(source);
        const grid = data.rows;
        const modeBar = new ModeSwitcher(el);
        const wrap = el.createDiv({ cls: 'vt-table-wrap' });
        const table = wrap.createEl('table', { cls: 'vt' });
        const tbody = table.createEl('tbody');
        const hsBar = el.createDiv({ cls: 'vt-hs-bar' });
        hsBar.setCssProps({ display: 'none' });
        const hsTrack = hsBar.createDiv({ cls: 'vt-hs-track' });
        hsTrack.createDiv({ cls: 'vt-hs-thumb' });
        setupHsScrollBar(wrap, hsBar);

        const cellMap: HTMLTableCellElement[][] = [];
        let focusedR = 0;
        let focusedC = 0;
        let editing = false;
        // 最近一次 flush 时光标所在的格与字符偏移（bug2：结构操作后光标留在原位置）
        let lastCaretRC: { r: number; c: number } | null = null;
        let lastCaretOffset: number | null = null;

        const flushActiveCell = () => {
                const active = document.activeElement as HTMLElement | null;
                if (!active?.matches('td') || !table.contains(active)) return;
                const rr = parseInt(active.dataset.vtR ?? '-1', 10);
                const cc = parseInt(active.dataset.vtC ?? '-1', 10);
                if (rr < 0 || cc < 0) return;
                // 先捕获光标偏移（此时 DOM 选区尚未被破坏）
                lastCaretRC = { r: rr, c: cc };
                lastCaretOffset = isWysiwyg(active) ? caretSourceOffset(active) : caretTextOffsetInTd(active);
                const html = normalizeCellHtml(stripRcHandles(isWysiwyg(active) ? projectSource(active) : active.innerHTML));
                // grid 域净化：\n 归一 <br>、锚点段零宽字符过滤（与 serialize 同规则，内存态即干净态）
                grid[rr]![cc]!.t = normalizeCellNewlines(html);
        };

        /** 双链跳转入口：焦点还压在格内（未离焦）时，先把当前编辑内容提交再跳，
         *  否则跳转后内容仍停留在未 flush 的格 DOM 里，回来就丢了 */
        const handleOpenLink = (link: string) => {
                flushActiveCell();
                commit();
                onOpenLink(link);
        };

        /** 有编辑写进了内存 grid 但还没落盘（blur 时容器只是被隐藏而非摘除的场景） */
        let pendingDirty = false;
        /** 布局变化钩子（切阅读视图/分栏调整等）：提交未落盘的编辑 */
        const flushCommit = () => {
                if (!table.isConnected) return;
                flushActiveCell(); // 焦点仍在本表（容器隐藏但元素可聚焦）→ 先同步内容
                flushDiagZone();   // 斜分格 zone 编辑中（activeElement 非 td，flushActiveCell 不覆盖）
                if (pendingDirty) {
                        pendingDirty = false;
                        commit();
                }
        };

        /** 斜分格：zone 仍是 activeElement 时（容器被隐藏但未失焦），把编辑内容写回 grid */
        const flushDiagZone = () => {
                const z = document.activeElement as HTMLElement | null;
                if (!z || !(z instanceof Element) || !z.classList.contains('vt-diag-zone') || !table.contains(z)) return;
                const td = z.closest('td') as HTMLTableCellElement | null;
                if (!td) return;
                const p = tdCoords(td);
                const cell = grid[p.r]?.[p.c];
                if (!isDiag(cell)) return;
                writeDiagZoneText(td, z); // focusout 没跑（未失焦）：手动暂存
                const aTxt = td.dataset.vtDiagA ?? cell!.dg!;
                const bTxt = td.dataset.vtDiagB ?? cell!.t;
                delete td.dataset.vtDiagA;
                delete td.dataset.vtDiagB;
                cell!.dg = aTxt;
                cell!.t = bTxt;
        };

        const commit = (keepFocus = false, caretAtEnd = false) => {
                if (keepFocus) {
                        const sameCell = lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC && lastCaretOffset != null;
                        pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd, textOffset: sameCell ? lastCaretOffset : null };
                }
                onCommit(serialize(data));
        };

        /** 结构操作后设置聚焦恢复目标：坐标平移 (dr,dc)；resetCaret 时光标落格首（内容已变的格） */
        const applyFocusRestore = (dr: number, dc: number, resetCaret: boolean) => {
                if (!table.contains(document.activeElement)) {
                        pendingFocusRestore = null;
                        return;
                }
                const sameCell = !resetCaret
                        && dr === 0 && dc === 0
                        && lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC
                        && lastCaretOffset != null;
                pendingFocusRestore = {
                        r: focusedR + dr,
                        c: focusedC + dc,
                        caretAtEnd: false,
                        textOffset: sameCell ? lastCaretOffset : null,
                };
        };

        /** 批量行列增删后的聚焦坐标平移（delta 以原始坐标描述，删除所在行/列返回 -1 → 落到顶替行、重置光标） */
        const shiftRestore = (
                deltasR: Array<{ at: number; d: number }> | undefined,
                deltasC: Array<{ at: number; d: number }> | undefined,
                resetCaret = false,
        ) => {
                if (!table.contains(document.activeElement)) {
                        pendingFocusRestore = null;
                        return;
                }
                let r = focusedR;
                let c = focusedC;
                let removed = resetCaret;
                if (deltasR) {
                        const s = shiftIndex(focusedR, deltasR);
                        if (s < 0) { removed = true; r = Math.min(focusedR, grid.length - 1); }
                        else r = s;
                }
                if (deltasC) {
                        const s = shiftIndex(focusedC, deltasC);
                        if (s < 0) { removed = true; c = Math.min(focusedC, (grid[0]?.length ?? 1) - 1); }
                        else c = s;
                }
                const sameCell = !removed
                        && r === focusedR && c === focusedC
                        && lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC
                        && lastCaretOffset != null;
                pendingFocusRestore = { r, c, caretAtEnd: false, textOffset: sameCell ? lastCaretOffset : null };
        };

        const rerenderMode = () => {
                applyModeStyles(wrap, table, data, hsBar);
                bindRcResizeHandles(table, data, editing, () => {
                        pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
                        // 未离焦就拖把手：正在编辑格的内容还在 DOM 没回 grid，不 flush 会被 serialize 回滚成旧值（内容"消失"）
                        flushActiveCell();
                        onCommit(serialize(data));
                });
                // 行列自由拖动把手（编辑态全模式；把手悬浮挂 body，不依赖 rc-overlay）
                bindRowColDrag(table, data, wrap, editing, {
                        getFocused: () => ({ r: focusedR, c: focusedC }),
                        selectCells: (rects, additive) => {
                                if (!additive) clearSelection();
                                for (const rc of rects) selRects.push(normalizeSelRect(rc, grid, anchorIndex));
                                renderSel();
                        },
                        getSelection: () => selRects,
                        onDragStart: () => flushActiveCell(),
                        onMutate: (focus) => {
                                pendingFocusRestore = focus
                                        ? { r: focus.r, c: focus.c, caretAtEnd: false }
                                        : { r: focusedR, c: focusedC, caretAtEnd: false };
                                // flush 已在 onDragStart（拖动开始、DOM/grid 同序时）完成；
                                // 此处不可再 flush——moveCol/moveRow 已执行，td dataset 还是旧坐标，会把内容写错格
                                onCommit(serialize(data));
                        },
                });
        };

        const placeCaret = (td: HTMLElement, atEnd: boolean) => {
                const sel = window.getSelection();
                if (!sel) return;
                const range = document.createRange();
                range.selectNodeContents(td);
                range.collapse(!atEnd);
                sel.removeAllRanges();
                sel.addRange(range);
        };

        const focusCell = (r: number, c: number, caretAtEnd = false, textOffset: number | null = null): boolean => {
                if (r < 0 || r >= grid.length || c < 0 || c >= (grid[0]?.length ?? 0)) return false;
                if (!visible(grid[r]![c]!)) return false;
                const td = cellMap[r]?.[c];
                if (!td) return false;
                td.focus();
                focusedR = r;
                focusedC = c;
                // 斜分格：td.focus() 的 focus 事件里已路由到区子元素（zone），此处不再放 td 选区
                if (isDiag(grid[r]![c]!)) return true;
                const place = () => {
                        if (textOffset != null) placeCaretAtTextOffset(td, textOffset);
                        else placeCaret(td, caretAtEnd);
                };
                place();
                // iPadOS：focus 切换异步生效，focus() 返回时文档 selection 还没切到 td，
                // 同步 placeCaret 的选区会被焦点完成时的 selection 复位覆盖 → caret 不绘制
                //（症状：能打字但光标不显现，敲一个字后才出现；桌面/Android 无此行为）。
                // 焦点稳定后（下一帧）重设选区，caret 才真正落位；桌面主路径不变
                if (Platform.isIosApp) {
                        window.requestAnimationFrame(() => {
                                if (td.isConnected && document.activeElement === td) place();
                        });
                }
                return true;
        };

        const moveFocus = (dr: number, dc: number): boolean => {
                let r = focusedR + dr;
                let c = focusedC + dc;
                const maxR = grid.length;
                const maxC = grid[0]?.length ?? 0;
                while (r >= 0 && r < maxR && c >= 0 && c < maxC) {
                        if (visible(grid[r]![c]!) && cellMap[r]?.[c]) {
                                // 对称落点语义：←/↑ 落目标格末尾，→/↓ 落目标格开头
                                return focusCell(r, c, dc < 0 || dr < 0);
                        }
                        r += dr;
                        c += dc;
                }
                return false;
        };

        const setMode = (mode: VtMode) => {
                if (data.mode === mode) return;
                flushActiveCell();
                // 选区随模式切换清空：选框 overlay 的几何按旧模式布局计算，切模式后
                // 行列几何全部重建，残留选框既错位又无法消除（用户实测：不取消选择就切模式，选框不消失）
                clearSelection();

                // 切换到 RC 模式时，仅在首次（colWidths 为 undefined）时捕获当前列宽作为初始值
                if (mode === 'RC' && data.colWidths === undefined) {
                        const cols = grid[0]?.length ?? 0;
                        data.colWidths = [];
                        const firstRow = tbody.querySelector('tr');
                        if (firstRow) {
                                for (let c = 0; c < cols; c++) {
                                        const td = Array.from(firstRow.querySelectorAll<HTMLTableCellElement>('td'))
                                                .find(cell => parseInt(cell.dataset.vtC ?? '-1', 10) === c);
                                        data.colWidths[c] = td ? Math.max(120, td.offsetWidth) : 120;
                                }
                        }
                }

                data.mode = mode;
                modeBar.setActive(mode);
                pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
                onCommit(serialize(data));
        };

        const showEditingUi = () => {
                if (!table.closest('.cm-editor')) return;
                const wasEditing = editing;
                editing = true;
                el.addClass('vt-editing');
                // 表格样式（三线表/无格线/全横线/隔行）：编辑态不应用、保持原状
                applyTableStyle();
                if (settings.enableModeSwitcher) {
                        modeBar.show(data.mode);
                }
                // 已在编辑态时跳过重建：rerenderMode 在 RC 下会整层清空重建行列把手
                //（O(rows+cols) 的 DOM 创建 + 布局读取 + 监听器重挂）——逐格跳转
                // 每次 focusin 都触发 → RC 跳格卡顿（OL/HS 无把手层不受影响）
                if (!wasEditing) rerenderMode();
                // 统一刷新边缘条：覆盖所有进入编辑态的路径（focus 事件 / 焦点恢复等），防止漏更新
                updateEdgeBars();
                // iPad 编辑态横滑钳制（见下方 startScrollClamp 注释）：进入编辑态启动、离开即停
                startScrollClamp();
        };

        const hideEditingUi = () => {
                editing = false;
                el.removeClass('vt-editing');
                stopScrollClamp();
                modeBar.hide();
                rerenderMode();
                // 焦点离开 vtable：应用表格样式（所见即所存）
                applyTableStyle();
                if (activeController?.moveCell === controller.moveCell) activeController = null;
        };

        /** ===== iPad 编辑态横滑"划过头无回弹"钳制 =====
         *  用户实锤：编辑模式下一次性横滑到右侧最底，没有边缘限制、视图也不回弹，停在
         *  表格内容右侧的空白里；阅读模式/离开 vtable 正常。机理未拿到诊断数据（用户暂
         *  无法跑命令），按"编辑态限定钳制"防御性修复：
         *  - rAF 轮询（节流 ~120ms）仅在编辑态运行，离开编辑态即停；
         *  - 硬边界 = min(容器物理边界, 表格宽 - 视口 + 16)：后项把 scrollWidth 里的任何
         *    虚增（把手外伸/内容溢出）一并钳掉，滑动到表格右缘即有"边缘限制"；
         *  - 写入前必须距最近触摸 ≥800ms（惯性静默）——绝不与惯性滚动竞争（Bug3 死锁防御），
         *    惯性停在超界位后的第一个静默帧即钳回，等效"回弹"。 */
        let clampRaf: number | null = null;
        let clampLast = 0;
        const stopScrollClamp = () => {
                if (clampRaf !== null) { window.cancelAnimationFrame(clampRaf); clampRaf = null; }
        };
        const startScrollClamp = () => {
                if (clampRaf !== null) return;
                const tick = (t: number) => {
                        if (!el.isConnected) { clampRaf = null; return; } // 表格被移除：自清理防泄漏
                        clampRaf = window.requestAnimationFrame(tick);
                        if (t - clampLast < 120) return; // 节流
                        clampLast = t;
                        if (Date.now() - lastTouchScrollAt < 800) return; // 惯性静默期绝不写
                        const vw = wrap.clientWidth;
                        const cap = Math.max(0, Math.min(
                                wrap.scrollWidth - vw,
                                Math.round(table.getBoundingClientRect().width) - vw + 16,
                        ));
                        if (wrap.scrollLeft > cap) wrap.scrollLeft = cap;
                };
                clampRaf = window.requestAnimationFrame(tick);
        };

        /** 表格样式应用（三线表/无格线/全横线 + 隔行变色）。
         *  编辑态一律旁路（类与 tint 全清、保持原状）；离开编辑态按 单表覆盖>全局 生效。
         *  风格类挂 wrap（外框边线也归风格管：三线/无格/全横线要去掉 wrap 外框）。
         *  隔行：只给无自身底色的 td 上色（用户单格底色优先），标记 vt-zebra-tint 便于整体撤销。 */
        const applyTableStyle = () => {
                const style = editing ? null : effTblStyle(data, settings);
                // 风格类必须挂 wrap：CSS 规则全部以 .vt-table-wrap.vt-tbl-* 为前提（格线+wrap 外框一起管）。
                // 曾错挂 el（vtable-container）导致选择器永不匹配、三种预设样式自上线起从未生效（10-07 真机诊断实锤）
                el.removeClass('vt-tbl-three', 'vt-tbl-noline', 'vt-tbl-hline');
                wrap.classList.remove('vt-tbl-three', 'vt-tbl-noline', 'vt-tbl-hline');
                if (style) wrap.classList.add(`vt-tbl-${style}`);

                table.querySelectorAll<HTMLElement>('td.vt-zebra-tint').forEach((td) => {
                        td.classList.remove('vt-zebra-tint');
                        td.setCssProps({ background: '' });
                        td.setCssProps({ color: '' });
                });
                if (editing) return;

                if (effZebra(data, settings)) {
                        const tint = zebraTintOf(settings, el);
                        // 隔行起点：表头底色生效时从第 3 行（r=2）起第一次出现
                        const hdrSuppressed = (grid[0] ?? []).some(cd => cd && visible(cd) && cd.rs > 1);
                        const hdrActive = (settings.headerStyle ?? 'none') !== 'none' && !data.noHeaderBg && !hdrSuppressed;
                        const base = hdrActive ? 2 : 0;
                        const rows = table.querySelectorAll('tbody tr');
                        rows.forEach((tr, i) => {
                                if ((i - base) % 2 !== 0) return;
                                tr.querySelectorAll<HTMLElement>('td').forEach((td) => {
                                        if (td.style.background) return; // 单格底色/表头色优先
                                        td.classList.add('vt-zebra-tint');
                                        td.setCssProps({ background: tint.bg });
                                        if (tint.fg) td.setCssProps({ color: tint.fg });
                                });
                        });
                }
        };

        modeBar.setHandler(setMode);

        /* ===== 单元格框选（选中功能） ===== */
        const anchorIndex = buildAnchorIndex(grid);
        const selOverlay = new SelOverlay(wrap, table);
        let selRects: SelRect[] = [];
        let selGesture: { originR: number; originC: number; liveR: number; liveC: number } | null = null;
        let mouseDown = false;
        let lastTap: { t: number; x: number; y: number; r: number; c: number } | null = null;
        let gestureMove: ((e: PointerEvent) => void) | null = null;
        let gestureUp: (() => void) | null = null;

        const tdCoords = (td: Element): { r: number; c: number } => ({
                r: parseInt((td as HTMLElement).dataset.vtR ?? '-1', 10),
                c: parseInt((td as HTMLElement).dataset.vtC ?? '-1', 10),
        });

        const normCell = (r: number, c: number) =>
                normalizeSelRect({ r1: r, c1: c, r2: r, c2: c }, grid, anchorIndex);
        const normRange = (r1: number, c1: number, r2: number, c2: number) =>
                normalizeSelRect({
                        r1: Math.min(r1, r2), c1: Math.min(c1, c2),
                        r2: Math.max(r1, r2), c2: Math.max(c1, c2),
                }, grid, anchorIndex);

        const renderSel = (extra?: SelRect) => {
                // 选区归属跟踪：有选区时记为命令兜底控制器，清空时交还
                if (selRects.length) selectionOwner = controller;
                else if (!extra && selectionOwner === controller) selectionOwner = null;
                selOverlay.update(extra ? [...selRects, extra] : selRects, cellMap);
                syncFillHandle();
        };

        const clearSelection = () => {
                selRects = [];
                selGesture = null;
                renderSel();
        };

        // 自动填充（桌面端专属；移动端不创建）
        let fillHandle: FillHandle | null = (Platform.isMobile || Platform.isTablet)
                ? null
                : new FillHandle({
                        cellTd: (r, c) => cellMap[r]?.[c] ?? null,
                        cellValue: (r, c) => grid[r]?.[c]?.t ?? '',
                        cellVisible: (r, c) => visible(grid[r]?.[c] ?? null),
                        flushActive: () => flushActiveCell(),
                        applyFill: (writes, anchor) => {
                                for (const w of writes) {
                                        const cd = grid[w.r]?.[w.c];
                                        if (cd) cd.t = w.v;
                                }
                                // 重渲染后光标回到填充起点格：拖到表格边缘时表格不失焦，
                                // 递增/递减选择框的交互前提是表格仍处于活跃状态
                                if (anchor) pendingFocusRestore = { r: anchor.r, c: anchor.c, caretAtEnd: false };
                                onCommit(serialize(data));
                                clearSelection(); // 用户约定：批量操作完成后选框不残留
                        },
                });
        // 填充柄同步：单格选区（含退化聚焦格）显示柄，其余隐藏；斜分格不参与填充
        const syncFillHandle = () => {
                if (!fillHandle) return;
                let a: { r: number; c: number } | null = null;
                if (selRects.length === 1 && selRects[0]!.r1 === selRects[0]!.r2
                        && selRects[0]!.c1 === selRects[0]!.c2) {
                        a = { r: selRects[0]!.r1, c: selRects[0]!.c1 };
                } else if (!selRects.length) {
                        const active = document.activeElement as HTMLElement | null;
                        if (active?.matches('td') && table.contains(active)) {
                                const p = tdCoords(active);
                                if (p.r >= 0 && p.c >= 0) a = p;
                        }
                }
                if (a && isDiag(grid[a.r]?.[a.c])) a = null;
                if (a) fillHandle.showAt(a.r, a.c);
                else fillHandle.hide();
        };

        // 点击表格之外（编辑器正文/侧栏/标签页/任何位置）→ 强制清光所有浮在页面上的东西：
        // 选框 + 浮动工具条。仅表格自身与它挂的 UI（工具条/菜单/弹窗/拖动把手/拖影）除外。
        // （旧版"点编辑器之外不打断选区"→ 选框经常残留不消失，用户要求强制清理）
        const onOutsidePointer = (e: PointerEvent) => {
                if (!el.isConnected) { // 表格已销毁：自摘防监听器泄漏
                        document.removeEventListener('pointerdown', onOutsidePointer, true);
                        return;
                }
                const t = e.target as Element | null;
                if (!t || el.contains(t)
                        || t.closest?.('.vt-bar, .vt-drag-grip, .vt-ghost, .menu, .modal, .modal-container, .suggestion-container')) return;
                clearSelection();
                toolbar.hide();
        };
        document.addEventListener('pointerdown', onOutsidePointer, true);

        // 任务3：选区模式按 Delete/Backspace → 清空所选内容（capture 抢在编辑器/浏览器之前）。
        // IME（中文输入法）激活时 keydown 常为 key='Process'/keyCode=229（真实键名缺失），
        // 无法在 keydown 识别——补 keyup 兜底通道（keyup 一般带真实键值）；
        // keydown 正常执行过一次的按键，250ms 内的 keyup 跳过，防双触发
        let lastSelDeleteAt = 0;
        // Ctrl/Cmd+Delete：删除纯行/纯列选区的整行/整列（结构删除，6c）。
        // 行列混合（不成整行也不成整列）不生效；无显式选区（焦点单格退化）也不生效
        const onStructDeleteKey = (e: KeyboardEvent) => {
                if (!el.isConnected) {
                        document.removeEventListener('keydown', onStructDeleteKey, true);
                        return;
                }
                if (e.isComposing) return;
                // Mac 系键盘（iPad 妙控键盘同理）没有独立 Delete 键：删除键发的是 Backspace。
                // 有选区时 Cmd+Backspace = 结构删除选区（与 Ctrl+Delete 同语义）；
                // Windows 的 Ctrl+Backspace（删词习惯）不在此接管，保留浏览器默认
                const isDel = e.key === 'Delete' || e.keyCode === 46;
                const isMacDel = e.key === 'Backspace' && e.metaKey;
                if (!isDel && !isMacDel) return;
                if (!(e.ctrlKey || e.metaKey)) return;
                if (!selRects.length) return;
                // 整行/整列判定用【用户原始框选范围】：合并格扩展会把"框选一列"撑成跨全列
                //（表头常有 colSpan 合并格）→ 误判整行 → 选列删行。无 raw（旧数据/程序化选区）回退主字段
                const rawOf = (rc: SelRect) => ({
                        c1: rc.rawC1 ?? rc.c1, c2: rc.rawC2 ?? rc.c2,
                        r1: rc.rawR1 ?? rc.r1, r2: rc.rawR2 ?? rc.r2,
                });
                const isFullRow = selRects.every(rc => { const w = rawOf(rc); return w.c1 === 0 && w.c2 === colCount(grid) - 1; });
                const isFullCol = selRects.every(rc => { const w = rawOf(rc); return w.r1 === 0 && w.r2 === grid.length - 1; });
                e.preventDefault();
                e.stopPropagation();
                lastSelDeleteAt = Date.now();
                // Ctrl+Delete 是明确的删除意图：无论删除是否执行，选框必须消失
                if (!isFullRow && !isFullCol) {
                        new Notice('仅支持整行或整列选区的删除（Ctrl+Delete）');
                        clearSelection();
                        return;
                }
                if (isFullRow) selOps.delRows();
                else selOps.delCols();
        };
        document.addEventListener('keydown', onStructDeleteKey, true);
        // —— 网格复制粘贴（2026-10-10）：选区 ⇄ markdown 表格（跨表/跨文档互通）——
        // 复制：选区外包矩形 → markdown 表格文本（t 源码直通，| 转义、<br> 归一）。
        // 多矩形（ctrl 点选等）取 unionSelBounds 外包：纵向/横向连续点选由此完整导出，
        // 跳格点选的间隙按原内容写入
        const buildSelMarkdown = (rects: SelRect[]): string => {
                if (!rects.length) return '';
                const b = unionSelBounds(rects);
                const esc = (s: string) => s.replace(/<br\s*\/?>/gi, '<br>').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
                const lines: string[] = [];
                for (let r = b.r1; r <= b.r2; r++) {
                        const cells: string[] = [];
                        for (let c = b.c1; c <= b.c2; c++) {
                                const cd = grid[r]?.[c];
                                cells.push(esc((cd ? cd.t : '').trim()));
                        }
                        lines.push('| ' + cells.join(' | ') + ' |');
                }
                const nCols = b.c2 - b.c1 + 1;
                lines.splice(1, 0, '| ' + Array(nCols).fill('---').join(' | ') + ' |');
                return lines.join('\n');
        };
        // 粘贴：rows 网格从 (r0,c0) 左上角覆盖写入；越界部分吞掉（extend=false），
        // extend=true 时按需补整行整列。合并格占位（非锚点）跳过不写
        const pasteGridRows = (r0: number, c0: number, rows: string[][], extend: boolean): boolean => {
                if (!rows.length) return false;
                flushActiveCell();
                let maxCols = 0;
                for (const row of rows) maxCols = Math.max(maxCols, row.length);
                if (extend) {
                        const needR = r0 + rows.length - grid.length;
                        const needC = c0 + maxCols - colCount(grid);
                        if (needR > 0) insertRowsBelow(grid, grid.length - 1, needR);
                        if (needC > 0) insertColsRight(grid, colCount(grid) - 1, needC);
                }
                for (let dr = 0; dr < rows.length; dr++) {
                        for (let dc = 0; dc < rows[dr]!.length; dc++) {
                                const rr = r0 + dr, cc = c0 + dc;
                                if (rr >= grid.length || cc >= colCount(grid)) continue; // 越界吞掉
                                const cd = grid[rr]![cc]!;
                                if (!visible(cd)) continue;
                                cd.t = rows[dr]![dc]!;
                        }
                }
                onCommit(serialize(data));
                return true;
        };
        // Ctrl/Cmd+Alt+V：剪贴板 markdown 表格 → 以最近聚焦格为左上角粘贴，行列不足自动补整行整列。
        // 仅当焦点在本表内时响应（document 级监听，多表共存时避免多表同时粘贴）
        const onGridPasteKey = (e: KeyboardEvent) => {
                if (!el.isConnected) {
                        document.removeEventListener('keydown', onGridPasteKey, true);
                        return;
                }
                if (e.isComposing) return;
                const ae = document.activeElement as HTMLElement | null;
                if (!ae || !el.contains(ae)) return;
                if (!(e.key === 'v' || e.key === 'V' || e.keyCode === 86)) return;
                if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
                e.preventDefault();
                e.stopPropagation();
                const tr = focusedR, tc = focusedC;
                navigator.clipboard?.readText?.().then((text) => {
                        if (!table.isConnected) return;
                        const md = parseMarkdownTable(text ?? '');
                        if (!md) return;
                        pasteGridRows(tr, tc, md, true);
                        clearSelection();
                }).catch(() => { });
        };
        document.addEventListener('keydown', onGridPasteKey, true);
        const trySelDelete = () => {
                if (!selRects.length) return;
                lastSelDeleteAt = Date.now();
                selOps.clearContent();
        };
        const isSelDeleteKey = (e: KeyboardEvent) =>
                e.key === 'Delete' || e.key === 'Backspace' || e.keyCode === 46 || e.keyCode === 8;
        const onSelKeyDown = (e: KeyboardEvent) => {
                if (!el.isConnected) {
                        document.removeEventListener('keydown', onSelKeyDown, true);
                        document.removeEventListener('keyup', onSelKeyUp, true);
                        return;
                }
                if (e.isComposing) return; // IME 组合中的 keydown 交给 keyup 兜底
                if (!selRects.length) return;
                // 选框态 Cmd/Ctrl+C：复制选区为 markdown 表格（跨表/跨文档可粘回）
                if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
                        && (e.key === 'c' || e.key === 'C' || e.keyCode === 67)) {
                        e.preventDefault();
                        e.stopPropagation();
                        navigator.clipboard?.writeText(buildSelMarkdown(selRects));
                        return;
                }
                if (!isSelDeleteKey(e)) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                e.preventDefault();
                e.stopPropagation();
                trySelDelete();
        };
        const onSelKeyUp = (e: KeyboardEvent) => {
                if (!el.isConnected) return;
                if (e.isComposing) return;
                if (!selRects.length) return;
                if (!isSelDeleteKey(e)) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (Date.now() - lastSelDeleteAt < 250) return; // keydown 已处理过本次按键
                trySelDelete();
        };
        document.addEventListener('keydown', onSelKeyDown, true);
        document.addEventListener('keyup', onSelKeyUp, true);

        // 焦点离开本表格（去向任何地方）→ 立即清选框；仅焦点留在表格自身/其浮层时保留
        table.addEventListener('focusout', (e: FocusEvent) => {
                if (!selRects.length) return;
                // 结构操作重渲染期间的 focusout（元素被摘除）交给恢复逻辑
                if (pendingSelectionRestore || pendingFocusRestore) return;
                const related = e.relatedTarget as HTMLElement | null;
                // 强制清理：只有焦点明确落在表格内/表格自身浮层（工具条、菜单、弹窗）时才保留选区；
                // 其余一律视为离开表格立即清选框——包括 relatedTarget 为 null（iPad blur 常态，
                // 旧版判为"不知道去哪"而不清 → 选框残留）和焦点去了侧栏/其它应用 UI 的情况
                if (related && (el.contains(related)
                        || related.closest('.vt-bar, .vt-drag-grip, .vt-ghost, .menu, .modal, .modal-container, .suggestion-container'))) return;
                clearSelection();
        });

        const tdFromPoint = (x: number, y: number): HTMLElement | null => {
                const hit = document.elementFromPoint(x, y);
                const td = hit?.closest?.('td');
                return td && table.contains(td) ? (td as HTMLElement) : null;
        };

        const detachGesture = () => {
                if (gestureMove) window.removeEventListener('pointermove', gestureMove);
                if (gestureUp) {
                        window.removeEventListener('pointerup', gestureUp);
                        window.removeEventListener('pointercancel', gestureUp);
                }
                gestureMove = null;
                gestureUp = null;
        };

        /** 橡皮筋框选：从 origin 拖到当前格，松手后累积进选区 */
        const startGesture = (originR: number, originC: number) => {
                detachGesture(); // 防御：清掉上一次未正常收尾的残留监听
                selGesture = { originR, originC, liveR: originR, liveC: originC };
                gestureMove = (e: PointerEvent) => {
                        if (!selGesture) return;
                        const td = tdFromPoint(e.clientX, e.clientY);
                        if (td) {
                                const { r, c } = tdCoords(td);
                                if (r !== selGesture.liveR || c !== selGesture.liveC) {
                                        selGesture.liveR = r;
                                        selGesture.liveC = c;
                                        renderSel(normRange(selGesture.originR, selGesture.originC, r, c));
                                }
                        }
                        // 框选期间清掉原生文本选区，避免拖拽中两者互相打架
                        const dom = window.getSelection();
                        if (dom && !dom.isCollapsed) dom.removeAllRanges();
                        e.preventDefault();
                };
                gestureUp = () => {
                        if (selGesture) {
                                const { originR, originC, liveR, liveC } = selGesture;
                                selGesture = null;
                                selRects.push(normRange(originR, originC, liveR, liveC));
                                renderSel();
                        }
                        detachGesture();
                };
                window.addEventListener('pointermove', gestureMove);
                window.addEventListener('pointerup', gestureUp);
                window.addEventListener('pointercancel', gestureUp);
        };

        // 1d：快速双击/双触同一格 → 选中该格（桌面与移动端一致）
        wrap.addEventListener('pointerup', (e) => {
                if (e.button !== 0) return;
                if (selGesture) return; // 手势收尾的 up 由 window 监听处理
                const target = e.target instanceof Element ? e.target : null;
                const td = target?.closest('td');
                if (!td || !table.contains(td)) return;
                const { r, c } = tdCoords(td);
                if (r < 0 || c < 0) return;
                const now = performance.now();
                if (lastTap
                        && now - lastTap.t < 350
                        && Math.abs(e.clientX - lastTap.x) < 30
                        && Math.abs(e.clientY - lastTap.y) < 30
                        && lastTap.r === r && lastTap.c === c) {
                        lastTap = null;
                        const dom = window.getSelection();
                        if (dom && !dom.isCollapsed) dom.removeAllRanges();
                        selRects.push(normCell(r, c));
                        renderSel();
                        return;
                }
                lastTap = { t: now, x: e.clientX, y: e.clientY, r, c };
        });

        /* ---- 批量操作（浮窗 / 右键菜单共用） ---- */
        const rangeNums = (a: number, b: number): number[] => {
                const out: number[] = [];
                for (let v = a; v <= b; v++) out.push(v);
                return out;
        };
        const selRowCount = (rects: SelRect[]): number => {
                const s = new Set<number>();
                for (const rc of rects) for (let r = rc.r1; r <= rc.r2; r++) s.add(r);
                return s.size;
        };
        const selColCount = (rects: SelRect[]): number => {
                const s = new Set<number>();
                for (const rc of rects) for (let c = rc.c1; c <= rc.c2; c++) s.add(c);
                return s.size;
        };
        const forEachSelectedAnchor = (rects: SelRect[], fn: (r: number, c: number) => void) => {
                for (let r = 0; r < grid.length; r++) {
                        for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
                                if (!visible(grid[r]![c]!)) continue;
                                if (!rects.some(rc => rectContains(rc, r, c))) continue;
                                fn(r, c);
                        }
                }
        };

        /** 任务10：无选区时退化为聚焦单格（命令/快捷键对光标所在格直接生效，不再报错）。
         *  焦点格从 DOM 实时读取（activeElement 的 data 坐标），失效时返回 null */
        const effectiveRects = (): SelRect[] | null => {
                if (selRects.length) return selRects;
                const active = document.activeElement as HTMLElement | null;
                if (!active?.matches('td') || !table.contains(active)) return null;
                const r = parseInt(active.dataset.vtR ?? '-1', 10);
                const c = parseInt(active.dataset.vtC ?? '-1', 10);
                if (r < 0 || c < 0) return null;
                return [{ r1: r, c1: c, r2: r, c2: c }];
        };

        const commitSel = (
                mutate: (rects: SelRect[]) => void,
                restore: boolean,
                restoreFocus?: (rects: SelRect[]) => void,
        ) => {
                const rects = effectiveRects();
                if (!rects) return;
                const isFallback = rects !== selRects; // 单格退化：不为原本无选区的用户凭空画选框
                flushActiveCell();
                const before = serialize(data);
                const snapshot = rects.slice();
                mutate(snapshot);
                const after = serialize(data);
                if (after === before) return; // 无实际变化：保持当前 DOM 与选区，不触发重渲染
                // 选区批量操作（浮窗按钮/右键菜单触发）完成后选框即消失——
                // 不恢复选区（用户要求：一切浮窗按钮操作后选框不残留），光标修正仍执行
                pendingSelectionRestore = null;
                if (restoreFocus && !isFallback) restoreFocus(snapshot);
                else applyFocusRestore(0, 0, false);
                onCommit(after);
                clearSelection();
        };

        const selOps: SelOps = {
                get rects() { return selRects; },
                insRowAbove: () => commitSel(rects => {
                        let offset = 0;
                        for (const run of runsFromRects(rects, 'rows')) {
                                const n = run.end - run.start + 1;
                                insertRowsAbove(grid, run.start + offset, n);
                                offset += n;
                        }
                }, false, rects => shiftRestore(
                        runsFromRects(rects, 'rows').map(run => ({ at: run.start, d: run.end - run.start + 1 })),
                        undefined,
                )),
                insRowBelow: () => commitSel(rects => {
                        const runs = runsFromRects(rects, 'rows');
                        for (let i = runs.length - 1; i >= 0; i--) {
                                const run = runs[i]!;
                                insertRowsBelow(grid, run.end, run.end - run.start + 1);
                        }
                }, false, rects => shiftRestore(
                        runsFromRects(rects, 'rows').map(run => ({ at: run.end + 1, d: run.end - run.start + 1 })),
                        undefined,
                )),
                delRows: () => {
                        if (selRowCount(selRects) >= grid.length) {
                                new Notice('至少需要保留一行');
                                clearSelection(); // 保护拒绝：操作未执行，但选框按删除意图清除
                                return;
                        }
                        commitSel(rects => {
                                deleteRows(grid, runsFromRects(rects, 'rows').flatMap(run => rangeNums(run.start, run.end)));
                        }, false, rects => shiftRestore(
                                runsFromRects(rects, 'rows').map(run => ({ at: run.start, d: -(run.end - run.start + 1) })),
                                undefined,
                                true,
                        ));
                },
                insColLeft: () => commitSel(rects => {
                        let offset = 0;
                        for (const run of runsFromRects(rects, 'cols')) {
                                const n = run.end - run.start + 1;
                                insertColsLeft(grid, run.start + offset, n);
                                offset += n;
                        }
                }, false, rects => shiftRestore(
                        undefined,
                        runsFromRects(rects, 'cols').map(run => ({ at: run.start, d: run.end - run.start + 1 })),
                )),
                insColRight: () => commitSel(rects => {
                        const runs = runsFromRects(rects, 'cols');
                        for (let i = runs.length - 1; i >= 0; i--) {
                                const run = runs[i]!;
                                insertColsRight(grid, run.end, run.end - run.start + 1);
                        }
                }, false, rects => shiftRestore(
                        undefined,
                        runsFromRects(rects, 'cols').map(run => ({ at: run.end + 1, d: run.end - run.start + 1 })),
                )),
                delCols: () => {
                        if (selColCount(selRects) >= (grid[0]?.length ?? 0)) {
                                new Notice('至少需要保留一列');
                                clearSelection(); // 保护拒绝：操作未执行，但选框按删除意图清除
                                return;
                        }
                        commitSel(rects => {
                                deleteCols(grid, runsFromRects(rects, 'cols').flatMap(run => rangeNums(run.start, run.end)));
                        }, false, rects => shiftRestore(
                                undefined,
                                runsFromRects(rects, 'cols').map(run => ({ at: run.start, d: -(run.end - run.start + 1) })),
                                true,
                        ));
                },
                merge: () => {
                        if (!selRects.length) return;
                        // 6b：多次点选/框选累积的选区先做整体性检查——
                        // 外包框内无空洞（实心矩形）才允许整块合并，否则按用户规则报错
                        if (!isSolidUnion(selRects)) {
                                new Notice('所选区域不是完整矩形，无法合并');
                                return;
                        }
                        const bounds = unionSelBounds(selRects);
                        // 合并后选区结构已变（原格被吞进合并块），恢复选框只会让框贴在
                        // 合并块上"持续不消失"→ 不恢复，合并完成即清空选区
                        commitSel(() => {
                                mergeRange(grid, bounds.r1, bounds.c1, bounds.r2, bounds.c2);
                        }, false, () => applyFocusRestore(bounds.r1 - focusedR, bounds.c1 - focusedC, true));
                        clearSelection();
                },
                split: () => {
                        const targets: Array<[number, number]> = [];
                        forEachSelectedAnchor(selRects, (r, c) => {
                                const cd = grid[r]![c]!;
                                if (cd.rs > 1 || cd.cs > 1) targets.push([r, c]);
                        });
                        if (!targets.length) {
                                new Notice('所选区域没有合并单元格');
                                return;
                        }
                        const wasFocusedAnchor = targets.some(([r, c]) => r === focusedR && c === focusedC);
                        const focusedInside = selRects.some(rc => rectContains(rc, focusedR, focusedC));
                        commitSel(() => {
                                for (const [r, c] of targets) splitCell(grid, r, c);
                        }, true, () => applyFocusRestore(0, 0, focusedInside && !wasFocusedAnchor));
                },
                bold: () => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                grid[r]![c]!.t = toggleWrapTag(grid[r]![c]!.t, 'b');
                        });
                }, true, rects => applyFocusRestore(0, 0, rects.some(rc => rectContains(rc, focusedR, focusedC)))),
                italic: () => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                grid[r]![c]!.t = toggleWrapTag(grid[r]![c]!.t, 'i');
                        });
                }, true, rects => applyFocusRestore(0, 0, rects.some(rc => rectContains(rc, focusedR, focusedC)))),
                fontStep: (delta: number) => {
                        // 字号只改 td 内联样式、不提交（与单格行为一致）；完成后选框消失（浮窗按钮统一行为）
                        for (let r = 0; r < grid.length; r++) {
                                for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
                                        if (!selRects.some(rc => rectContains(rc, r, c))) continue;
                                        const td = cellMap[r]?.[c];
                                        if (!td) continue;
                                        const cur = parseFloat(getComputedStyle(td).fontSize) || 16;
                                        td.setCssProps({ fontSize: `${Math.max(8, Math.min(72, cur + delta))}px` });
                                }
                        }
                        clearSelection();
                },
                // 任务1：选区对齐（l/c/r；存进 Cell.a，重渲染后由内联样式生效）
                align: (mode) => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                const cd = grid[r]![c]!;
                                if (mode === 'l') delete cd.a; // 左对齐是默认，字段瘦身
                                else cd.a = mode;
                        });
                }, true),
                // 垂直对齐（t/m/b；存进 Cell.va，重渲染后由内联样式生效；顶对齐=默认，字段瘦身）
                alignV: (mode) => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                const cd = grid[r]![c]!;
                                if (mode === 't') delete cd.va;
                                else cd.va = mode;
                        });
                }, true),
                // 任务2：选区底色（null = 清除）
                setColor: (color) => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                const cd = grid[r]![c]!;
                                if (color) cd.bg = color;
                                else delete cd.bg;
                        });
                }, true),
                // 任务3：清空选区内容（不动行列结构，选区保持）
                clearContent: () => commitSel(rects => {
                        forEachSelectedAnchor(rects, (r, c) => {
                                grid[r]![c]!.t = '';
                        });
                }, true),
                // 任务2：取色弹窗（main.ts 提供弹窗实现）；无选区时对聚焦格取色（任务10）
                pickColor: () => {
                        const rects = effectiveRects();
                        if (!rects) return;
                        const first = rects[0]!;
                        const cd = grid[first.r1]?.[first.c1];
                        onPickColor(cd?.bg ?? '', (color) => selOps.setColor(color));
                },
        };

        const controller: TableController = {
                moveCell(dr: number, dc: number) {
                        return moveFocus(dr, dc);
                },
                setMode,
                getMode: () => data.mode,
                hasSelection: () => selRects.length > 0,
                alignSel: (mode) => selOps.align(mode),
                alignVSel: (mode) => selOps.alignV(mode),
                colorSel: (color) => selOps.setColor(color),
                clearSelContent: () => selOps.clearContent(),
                pickColor: () => selOps.pickColor(),
                flushCommit,
                toggleHeaderBg() {
                        data.noHeaderBg = !data.noHeaderBg;
                        refreshHeader(); // 立即重应用（同设置面板改 headerStyle 的即时刷新路径）
                        onCommit(serialize(data));
                        return !data.noHeaderBg;
                },
                addHeaderBg() {
                        if (!data.noHeaderBg) return false; // 本来就有：幂等，不重复添加
                        delete data.noHeaderBg;
                        refreshHeader();
                        onCommit(serialize(data));
                        return true;
                },
                toggleDiag() {
                        // 目标格：选区展开（可见格），无选区=聚焦格
                        const targets: Array<{ r: number; c: number }> = [];
                        if (selRects.length) {
                                for (const rc of selRects) {
                                        for (let r = rc.r1; r <= rc.r2; r++) {
                                                for (let c = rc.c1; c <= rc.c2; c++) {
                                                        if (visible(grid[r]![c]!)) targets.push({ r, c });
                                                }
                                        }
                                }
                        } else if (focusedR >= 0 && focusedC >= 0 && grid[focusedR]?.[focusedC]) {
                                targets.push({ r: focusedR, c: focusedC });
                        }
                        if (!targets.length) return false;
                        const first = grid[targets[0]!.r]![targets[0]!.c]!;
                        const turnOn = first.dg === undefined;
                        flushActiveCell();
                        let hit = false;
                        for (const { r, c } of targets) {
                                const cd = grid[r]![c]!;
                                if (turnOn) {
                                        if (isDiag(cd)) continue;
                                        cd.dg = ''; // 光标随后进区1（右上）输入
                                        cd.t = diagPlainText(cd.t); // 存量 HTML → 纯文本（斜分格 t=纯文本语义）
                                        hit = true;
                                } else {
                                        if (!isDiag(cd)) continue;
                                        // 关：两区文本拼回 t（区2 在上、区1 在下，随视觉上下序），不丢内容
                                        const parts = [cd.t, cd.dg!].filter(s => s !== '');
                                        cd.t = parts.length ? parts.map(escapeHtml).join('<br>') : '';
                                        delete cd.dg;
                                        hit = true;
                                }
                        }
                        if (!hit) return false;
                        const f = targets[0]!;
                        pendingFocusRestore = { r: f.r, c: f.c, caretAtEnd: true };
                        commit();
                        return true;
                },
                async styleCall(pick) {
                        const cur = effTblStyle(data, settings);
                        const opts: Array<{ value: TblStyle; name: string; checked: boolean }> = [
                                { value: 'three', name: t('三线表', 'Three-line table'), checked: cur === 'three' },
                                { value: 'noline', name: t('无格线', 'No grid lines'), checked: cur === 'noline' },
                                { value: 'hline', name: t('全横线', 'Horizontal lines only'), checked: cur === 'hline' },
                        ];
                        const picked = await pick(opts);
                        if (!picked) return;
                        // 点当前生效项 = 显式取消本表样式（'off'：全局即使启用本表也不应用）
                        data.style = cur === picked ? 'off' : picked;
                        applyTableStyle();
                        commit();
                },
                /** 命令「删除表格样式」：只删不加——表格有样式（线风格/隔行/表头底色）→ 全部取消；
                 *  本来就没有 → 原样返回 false（调用方提示"无样式可删"） */
                toggleStyleAll() {
                        const hasAny = !!effTblStyle(data, settings) || effZebra(data, settings)
                                || ((settings.headerStyle ?? 'none') !== 'none' && !data.noHeaderBg);
                        if (!hasAny) return false;
                        // 全部取消：线风格显式关（防全局仍启用）、隔行关、表头底色关
                        if (settings.tblStyleEnabled && settings.tblStyle !== 'none') data.style = 'off';
                        else delete data.style;
                        data.zebra = false;
                        data.noHeaderBg = true;
                        refreshHeader();
                        applyTableStyle();
                        commit();
                        return true;
                },
                toggleZebra() {
                        const on = effZebra(data, settings);
                        data.zebra = !on;
                        applyTableStyle();
                        commit();
                        return !on;
                },
        };

        /* ===== 边缘快捷加行/加列（改版 3：body 级浮层） =====
         *  焦点驱动：光标所在格在最后一行 → 底部加行条；在最后一列 → 右侧加列条。
         *  条挂 document.body（fixed 视口坐标）：Obsidian 代码块容器（.cm-embed-block 等）
         *  自带 overflow 裁剪 / contain 裁剪——el 内 fixed 被桌面容器裁剪（条"从未出现"），
         *  el 内 absolute 被全端裁剪（iPad 也看不见）。body 直挂免疫一切宿主容器样式。
         *  可见期间 rAF 轮询同步位置（wrap 滚动/页面滚动/缩放/布局变化全覆盖）；
         *  宿主 el 被移除或被新渲染替换（uid 变化）时自动清理。 */
        const edgeUid = `u${Math.random().toString(36).slice(2, 10)}`;
        el.dataset.vtEdgeUid = edgeUid;
        const addRowBar = document.body.createDiv({ cls: 'vt-edge-bar vt-edge-row', text: '+' });
        const addColBar = document.body.createDiv({ cls: 'vt-edge-bar vt-edge-col', text: '+' });
        addRowBar.dataset.vtUid = edgeUid;
        addColBar.dataset.vtUid = edgeUid;

        const hideEdgeBars = () => {
                addRowBar.classList.remove('vt-edge-on');
                addColBar.classList.remove('vt-edge-on');
        };

        const placeEdgeBars = () => {
                // 视口坐标（fixed 直挂 body，无裁剪）；用户环境无主题/插件 → 无 transform，rect 直读精确
                const wr = wrap.getBoundingClientRect();
                const tr = table.getBoundingClientRect();
                const vh = window.innerHeight;
                // 底条：按钮与表格间距=5px（用户定值，电脑/移动端一致）；
                // HS/RC 托条显示时下移让开（托条高+间隙），平时精确 5px；
                // 视口下方空间不足（软键盘顶起等）时吸视口底，保证可点
                const hsH = hsBar.offsetHeight > 0 ? hsBar.offsetHeight + 6 : 0;
                addRowBar.setCssProps({ left: `${Math.round(wr.left)}px` });
                addRowBar.setCssProps({ top: `${Math.round(Math.min(wr.bottom + 5 + hsH, vh - 18))}px` });
                addRowBar.setCssProps({ width: `${Math.round(wr.width)}px` });
                // 右条：贴 min(内容右缘, wrap 可视右缘)——普通窄表/滚到最右时贴内容右缘；
                // 末列超宽且未滚到时钉在 wrap 可视右缘（贴着可见边缘"等待"），不随不可见内容浮空
                const wrapRightVis = wr.left + wrap.clientWidth;
                addColBar.setCssProps({ top: `${Math.round(wr.top)}px` });
                addColBar.setCssProps({ left: `${Math.round(Math.min(tr.right + 2, wrapRightVis + 2))}px` });
                addColBar.setCssProps({ height: `${Math.round(wr.height)}px` });
        };

        // rAF 轮询：位置每帧同步（条隐藏时仅轻检查，无 rect 读取）；宿主销毁/被新渲染替换时自清理
        const edgeTick = () => {
                window.requestAnimationFrame(edgeTick);
                if (addRowBar.dataset.vtUid !== (el.dataset.vtEdgeUid ?? '')) {
                        addRowBar.remove();
                        addColBar.remove();
                        return;
                }
                if (!el.isConnected) {
                        addRowBar.remove();
                        addColBar.remove();
                        return;
                }
                if (addRowBar.classList.contains('vt-edge-on') || addColBar.classList.contains('vt-edge-on')) placeEdgeBars();
        };
        window.requestAnimationFrame(edgeTick);

        /** 焦点变化后刷新两条的显隐与位置（无表内焦点 = 全隐藏） */
        const updateEdgeBars = () => {
                if (!table.contains(document.activeElement)) {
                        hideEdgeBars();
                        return;
                }
                const onLastRow = focusedR === grid.length - 1;
                const onLastCol = focusedC === (grid[0]?.length ?? 1) - 1;
                if (onLastRow || onLastCol) placeEdgeBars();
                addRowBar.classList.toggle('vt-edge-on', onLastRow);
                addColBar.classList.toggle('vt-edge-on', onLastCol);
        };

        const addRowAtEnd = () => {
                flushActiveCell();
                insertRowsBelow(grid, grid.length - 1, 1);
                applyFocusRestore(0, 0, false);
                onCommit(serialize(data));
        };
        const addColAtEnd = () => {
                flushActiveCell();
                insertColsRight(grid, (grid[0]?.length ?? 1) - 1, 1);
                applyFocusRestore(0, 0, false);
                onCommit(serialize(data));
        };
        // 按下即执行（pointerdown 统一鼠标/触摸）：iPad 上 touchstart 的默认行为会把焦点从 td 拉走
        // （条非可聚焦 → 离焦 → 条消失 → 点击落空），preventDefault pointerdown 拦不住它，
        // 必须 touchstart 也 preventDefault 才能保住焦点链路。
        for (const bar of [addRowBar, addColBar]) {
                bar.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
                bar.addEventListener('pointerdown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.button !== 0 && e.pointerType === 'mouse') return;
                        hideEdgeBars();
                        if (bar === addRowBar) addRowAtEnd();
                        else addColAtEnd();
                });
        }

        /** 跳出表格：先清选区失焦（同步触发内容提交与编辑 UI 收起），再延迟把编辑器光标移到代码块上方/下方文本行 */
        const exitTable = (td: HTMLElement, direction: -1 | 1) => {
                if (selRects.length) clearSelection();
                td.blur();
                window.setTimeout(() => onExitTable(direction), 0);
        };

        /** 任务6：待办勾选点击写回——切换源文本中的第 idx 个待办标记并提交重渲染 */
        const onTodoToggle = (r: number, c: number) => (idx: number, checked: boolean) => {
                flushActiveCell();
                // 勾选触发整表重建：先让聚焦格干净失焦，否则重建摘除 DOM 后
                // iOS 会把插入符绘制成异常的缩小版（贴在 checkbox 附近）
                const active = document.activeElement;
                if (active instanceof HTMLElement && table.contains(active)) active.blur();
                const cd = grid[r]![c]!;
                const next = toggleTodoMark(cd.t, idx, checked);
                if (next === cd.t) return;
                cd.t = next;
                onCommit(serialize(data));
        };

        // iPad bug3：点表内新格时旧格 blur 的延迟判定先于新格 focus 执行（WebKit 触摸聚焦慢一拍），
        // 会被误判为"离表"→ commit 重建销毁用户正点击的格 → 要点两次才进编辑。
        // 表内 pointerdown 时打时间戳，blur 判定在窗口期内直接豁免，等新格 focus 自然接管
        let lastTablePointerDown = 0;
        table.addEventListener('pointerdown', () => {
                lastTablePointerDown = Date.now();
        }, true);

        grid.forEach((row, r) => {
                cellMap[r] = [];
                const tr = tbody.createEl('tr');
                // 行内可见格的 DOM 首末位置：合并占位会让某行只剩一个可见格（它同时是 DOM
                // first 与 last），主题的 td:first-child/:last-child 清边框规则会误杀它的内部边框
                const visCols: number[] = [];
                row.forEach((cd, i) => { if (visible(cd)) visCols.push(i); });
                const domFirstCol = visCols.length ? visCols[0]! : 0;
                const domLastCol = visCols.length ? visCols[visCols.length - 1]! : 0;
                row.forEach((cellData, c) => {
                        if (!visible(cellData)) return;

                        const td = tr.createEl('td');
                        td.contentEditable = 'true';
                        td.dataset.vtR = String(r);
                        td.dataset.vtC = String(c);
                        cellMap[r]![c] = td;
                        if (cellData.rs > 1) {
                                td.rowSpan = cellData.rs;
                                // 贴底合并格：DOM 在起始行，CSS 的 tr:last-child 让位规则判不到它，
                                // 其 border-bottom 会与 wrap 外框叠成 2px（"合并到边缘后那部分边缘变厚"）
                                if (r + cellData.rs >= grid.length) td.addClass('vt-edge-bottom');
                        }
                        if (cellData.cs > 1) td.colSpan = cellData.cs;
                        // 贴边格打标：rowspan 占位会让某些行的可见格数量变少，CSS 的
                        // :first-child/:last-child 按 DOM 位置判定会误伤"不贴缘的格"
                        //（其内部竖线被错误让位 → 合并旁出现一段缺失的边框）——按逻辑列跨度判定才准
                        if (c === 0) td.addClass('vt-edge-left');
                        if (c + cellData.cs >= colCount(grid)) td.addClass('vt-edge-right');
                        // DOM 首末但逻辑不贴缘的格：主题的 :first-child/:last-child 规则会清到它的
                        // 内部边框（合并格旁竖线缺失）——prot 类强制内边框，与 edge 让位类互斥
                        if (c === domFirstCol && c > 0) td.addClass('vt-prot-left');
                        if (c === domLastCol && c + cellData.cs < colCount(grid)) td.addClass('vt-prot-right');
                        // 单元格级对齐/底色（任务1/2）
                        if (cellData.a) td.setCssProps({ textAlign: cellData.a === 'c' ? 'center' : cellData.a === 'r' ? 'right' : 'left' });
                        // 垂直对齐（t=顶/m=中/b=底；缺省=顶=CSS 默认不写）。斜分格两区贴角，不适用
                        if (cellData.va && !isDiag(cellData)) {
                                td.setCssProps({ verticalAlign: cellData.va === 'm' ? 'middle' : cellData.va === 'b' ? 'bottom' : 'top' });
                        }
                        if (cellData.bg) {
                                td.setCssProps({ background: cellData.bg });
                                td.setCssProps({ color: contrastTextColor(cellData.bg) });
                        }

                        if (isDiag(cellData)) {
                                // 斜分格：独立显示结构（对角线+两区+占位），不进 wysiwyg 段系统；
                                // 编辑事件委托绑一次（populate 重建子 DOM 不丢）
                                buildDiagDom(td, cellData.dg!, cellData.t);

                                // 区编辑收尾：dataset 暂存写回 grid → 重建显示态 → commit 判定
                                //（与普通格 blur 同语义；zone focusout 出格时延迟一拍调用，
                                //  用焦点实际落点判定，规避 iPad relatedTarget=null 误判）
                                const finishDiagEdit = () => {
                                        const cell2 = grid[r]?.[c];
                                        if (!cell2 || !isDiag(cell2)) return;
                                        const aTxt = td.dataset.vtDiagA ?? cell2.dg!;
                                        const bTxt = td.dataset.vtDiagB ?? cell2.t;
                                        delete td.dataset.vtDiagA;
                                        delete td.dataset.vtDiagB;
                                        delete td.dataset.vtDiagZone;
                                        const contentChanged = aTxt !== cell2.dg || bTxt !== cell2.t;
                                        if (contentChanged) {
                                                cell2.dg = aTxt;
                                                cell2.t = bTxt;
                                                pendingDirty = true;
                                        }
                                        if (!table.isConnected) {
                                                if (contentChanged) { commit(); pendingDirty = false; }
                                                return;
                                        }
                                        autoExpandRowHeight(td, data, r, contentChanged);
                                        exitDiagEdit(td, cell2.dg!, cell2.t);
                                        td.dataset.vtView = 'view';
                                        if (table.contains(document.activeElement)) return; // 切格：焦点仍在表内
                                        if (Date.now() - lastTablePointerDown < 400) return; // iPad bug3 同款保护
                                        commit();
                                        const uiClick = document.body.dataset.vtBarClick === '1'
                                                || document.body.dataset.vtModeClick === '1';
                                        if (!uiClick) {
                                                toolbar.hide();
                                                hideEditingUi();
                                        }
                                        updateEdgeBars();
                                };

                                bindDiagTd(td, {
                                        move: (dr, dc) => moveFocus(dr, dc),
                                        onZoneFocus: (zone) => {
                                                // zone 获焦（点击 zone 直接编辑 / enterDiagZone 程序转移）：
                                                // 登记聚焦状态与编辑 UI（与普通格 td focus 分支同语义）
                                                focusedR = r;
                                                focusedC = c;
                                                activeController = controller;
                                                prepareDiagEdit(td);
                                                td.dataset.vtDiagZone = zone.classList.contains('vt-diag-a') ? 'a' : 'b';
                                                showEditingUi();
                                                updateEdgeBars();
                                                syncFillHandle();
                                                // 不弹工具条：加粗等源码域操作对两区纯文本不适用
                                        },
                                        onExitCell: () => {
                                                // 区2 Enter 出格：写回区内容（focusout 自动）后跳下一行格
                                                moveFocus(1, 0);
                                        },
                                        onZoneLeave: () => {
                                                // 区失焦且目标可能在格外：延迟一拍按焦点实际落点收尾
                                                window.setTimeout(() => {
                                                        if (td.contains(document.activeElement)) return;
                                                        finishDiagEdit();
                                                }, 0);
                                        },
                                });
                        } else {
                                populateCell(td, cellData.t, grid, sourcePath, resolveImage, onTodoToggle(r, c), handleOpenLink);
                        }

                        // 所见即所得：编辑态混合 DOM（默认渲染、光标进块切源码）；斜分格不进段系统
                        const wysiwygCtx: WysiwygCtx = {
                                sourcePath,
                                resolveImage,
                                onTodoToggle: onTodoToggle(r, c),
                                onOpenLink: handleOpenLink,
                                onMdGridPaste: (r0, c0, rows) => { pasteGridRows(r0, c0, rows, false); clearSelection(); },
                                renderPasses: (el) => {
                                        renderInlineCode(el);
                                        renderMarkdown(el);
                                        renderTodos(el, onTodoToggle(r, c));
                                        renderImages(el, sourcePath, resolveImage);
                                        renderWikiLinks(el, handleOpenLink);
                                },
                        };
                        if (!isDiag(cellData)) attachWysiwyg(td, wysiwygCtx);

                        // 1a/1b：Ctrl(Cmd)+Shift+点选/框选；普通单击解除全部选中
                        td.addEventListener('pointerdown', (e) => {
                                // 斜分格：按点击点相对对角线的位置预选区（上=区1右上 / 下=区2左下），
                                // 后续 td focus 事件按此路由 zone
                                if (isDiag(cellData)) {
                                        td.dataset.vtDiagZone = pointInZoneA(td, e.clientX, e.clientY) ? 'a' : 'b';
                                }
                                if (!td.closest('.cm-editor') || e.button !== 0) return;
                                mouseDown = true;
                                const resetDown = () => {
                                        mouseDown = false;
                                        window.removeEventListener('pointerup', resetDown);
                                        window.removeEventListener('pointercancel', resetDown);
                                };
                                window.addEventListener('pointerup', resetDown);
                                window.addEventListener('pointercancel', resetDown);
                                if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                                        e.preventDefault(); // 不进入编辑、不产生文本选区
                                        const { r, c } = tdCoords(td);
                                        startGesture(r, c);
                                        renderSel(normCell(r, c));
                                        return;
                                }
                                const { r, c } = tdCoords(td);
                                if ((Platform.isMobile || Platform.isTablet) && selRects.length) {
                                        // 移动端连续多选：点选区内格子 → 清除全部选中（回到编辑）；
                                        // 点选区外 → 无反应（不清空、不聚焦、不弹键盘），把添加留给双击
                                        if (selRects.some(rc => rectContains(rc, r, c))) clearSelection();
                                        else e.preventDefault();
                                        return;
                                }
                                if (selRects.length) clearSelection();
                        });

                        td.addEventListener('focus', () => {
                                if (!td.closest('.cm-editor')) {
                                        td.blur();
                                        return;
                                }
                                focusedR = r;
                                focusedC = c;
                                activeController = controller;
                                // 斜分格：不进 wysiwyg 段系统。状态登记在 zone 的 onZoneFocus 里，
                                // 此处只负责把焦点路由到目标 zone（点空白处/键盘导航进入）
                                if (isDiag(cellData)) {
                                        prepareDiagEdit(td);
                                        enterDiagZone(td);
                                        return;
                                }
                                // iPad bug2：无条件重写 innerHTML 会破坏 WebKit 已放置的 caret（光标缩成小点）。
                                // 仅在渲染态（populateCell 输出）进入编辑时才换回源 html，并主动把光标放到格尾。
                                if (td.dataset.vtView !== 'edit') {
                                        td.dataset.vtView = 'edit';
                                        const src = grid[r]![c]!.t;
                                        enterWysiwyg(td, src, wysiwygCtx);
                                        placeCaretAtSourceOffset(td, src.length);
                                }
                                showEditingUi();
                                updateEdgeBars();
                                syncFillHandle();
                                if (Platform.isDesktop && !settings.enableDesktopToolbar) return;
                                if ((Platform.isMobile || Platform.isTablet) && !settings.enableMobileToolbar) return;
                                toolbar.show(td, data, r, c,
                                        (s: string) => {
                                                const shift = toolbar.consumeFocusShift();
                                                applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
                                                onCommit(s);
                                        },
                                        flushActiveCell, () => onConvertToMd(grid), () => onConvertToHtml(grid), selOps);
                        });

                        td.addEventListener('blur', (e) => {
                                const cell = grid[r]?.[c];
                                if (!cell) return; // 结构操作（删行/列等）重渲染 detach 本格时触发 blur：数据已不在
                                fillHandle?.hide(); // 焦点离开格子：填充柄随选区/焦点状态由 sync 重新校正
                                if (isDiag(cell)) {
                                        // 斜分格收尾只走 zone 的 onZoneLeave（td 在进入 zone 编辑时已 blur 过一次）；
                                        // 这里仅防程序性 blur td 时误走普通格投影
                                        if (!td.contains(document.activeElement)) finishDiagEdit();
                                        return;
                                }
                                const html = normalizeCellHtml(stripRcHandles(isWysiwyg(td) ? projectSource(td) : td.innerHTML));
                                if (isWysiwyg(td)) exitWysiwyg(td);
                                const contentChanged = cell.t !== html;

                                if (contentChanged) {
                                        cell.t = html;
                                        pendingDirty = true; // 有未提交编辑：等 layout-change 兜底提交（容器可能只是被隐藏）
                                }
                                // 表格已脱离 DOM（未离焦就切预览/视图切换，宿主摘除时触发 blur）：
                                // 数据已更新进内存 grid，但延迟 commit 会因 isConnected 检查直接放弃，
                                // 本次编辑只存在于即将销毁的实例里 → "切预览刚编辑的内容被删"。
                                // 这里立即提交一次写回文件（contentChanged 才提交，避免重渲染摘格时双写）
                                if (!table.isConnected) {
                                        if (contentChanged) {
                                                commit();
                                                pendingDirty = false;
                                        }
                                        return;
                                }
                                autoExpandRowHeight(td, data, r, contentChanged);
                                populateCell(td, html, grid, sourcePath, resolveImage, onTodoToggle(r, c), handleOpenLink);
                                td.dataset.vtView = 'view';
                                scheduleMathRender(td);

                                // iPad bug1：WebKit 派发 blur 时 relatedTarget 常为 null（切格被误判成离表），
                                // commit → 整表重渲染会把用户正点击的目标 td 销毁，导致切格要点两次。
                                // 改为延迟一拍，用焦点实际落点判定：仍在表内 = 切格，不 commit 不收 UI。
                                if ((e as FocusEvent).relatedTarget) {
                                        // 支持相关目标的浏览器：沿用同步判定，行为不变
                                        const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
                                        if (related?.closest('.vt') !== td.closest('.vt')) {
                                                commit();
                                                const uiClick = document.body.dataset.vtBarClick === '1'
                                                        || document.body.dataset.vtModeClick === '1';
                                                if (!uiClick) {
                                                        toolbar.hide();
                                                        if (!table.contains(document.activeElement)) hideEditingUi();
                                                }
                                                updateEdgeBars();
                                        }
                                } else {
                                        window.setTimeout(() => {
                                                if (!table.isConnected) return; // 表格已被销毁/替换（重渲染）：旧实例不再写回，防覆盖新内容
                                                if (table.contains(document.activeElement)) return; // 切格：焦点仍在表内
                                                // iPad bug3：刚点过表内格子（触摸聚焦慢一拍，新格 focus 还在路上）
                                                // → 不 commit 不收 UI，避免重建销毁用户正点击的格（点两次才进编辑）
                                                if (Date.now() - lastTablePointerDown < 400) return;
                                                commit();
                                                const uiClick = document.body.dataset.vtBarClick === '1'
                                                        || document.body.dataset.vtModeClick === '1';
                                                if (!uiClick) {
                                                        toolbar.hide();
                                                        hideEditingUi();
                                                }
                                                updateEdgeBars();
                                        }, 0);
                                }
                        });

                        td.addEventListener('keydown', (e) => {
                                if (!td.closest('.cm-editor')) return;
                                // 斜分格 zone 内的 Ctrl/Cmd+A 放行：全选区文本（非整格/选框语义）
                                if (isDiag(cellData) && (e.target as HTMLElement)?.matches?.('.vt-diag-zone')) {
                                        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) return;
                                }
                                // 5a：格内 Ctrl/Cmd+A 全选文本 → 立即转选框模式
                                // （不拦截会被 CM keymap 抢走变成全文档全选）
                                if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
                                        && (e.key === 'a' || e.key === 'A')) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const sel = window.getSelection();
                                        sel?.removeAllRanges();
                                        const range = document.createRange();
                                        range.selectNodeContents(td);
                                        sel?.addRange(range);
                                        return;
                                }
                                // macOS Cmd+Delete：删除光标所在行（复用菜单「－行」同款 deleteRow，至少保留一行）。
                                // 必须在下方 meta/ctrl 通行放行之前拦截；删行后焦点钳到同列、就近存活行。
                                // 仅【无选区】时生效：有选区时 Cmd+Backspace 已被 onStructDeleteKey
                                //（document capture，先于此处）按"结构删除选区"处理——Mac 系键盘的
                                // Delete 键就是 Backspace，不区分会"选列删行"
                                if (e.metaKey && !e.altKey && e.key === 'Backspace' && !selRects.length) {
                                        e.preventDefault();
                                        if (grid.length > 1) {
                                                flushActiveCell();
                                                deleteRow(grid, focusedR);
                                                pendingFocusRestore = { r: Math.min(focusedR, grid.length - 1), c: focusedC, caretAtEnd: false };
                                                onCommit(serialize(data));
                                        }
                                        return;
                                }
                                // 选区非折叠时的 Delete/Backspace：在格内本地完成删除并拦截事件。
                                // 稳定 bug：Shift+← 选中文本后按 Delete，事件冒泡进宿主编辑器会引发
                                // 焦点/重渲染错乱，光标跳到隔壁格（如 A2 → C2）；本地 execCommand 切断该路径
                                if ((e.key === 'Delete' || e.key === 'Backspace')
                                        && !e.ctrlKey && !e.metaKey && !e.altKey) {
                                        const delSel = window.getSelection();
                                        if (delSel && delSel.rangeCount > 0 && !delSel.isCollapsed) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                document.execCommand('delete');
                                                return;
                                        }
                                }
                                if (e.ctrlKey || e.metaKey || e.altKey) return;

                                if (e.key === 'Tab') {
                                        e.preventDefault();
                                        const dc = e.shiftKey ? -1 : 1;
                                        if (moveFocus(0, dc)) return;
                                        if (dc > 0) moveFocus(1, -focusedC);
                                        return;
                                }

                                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown'
                                        && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                                if (e.shiftKey) return; // shift+方向为选区操作，交给浏览器

                                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                        const left = e.key === 'ArrowLeft';
                                        const sel = window.getSelection();
                                        const caretInTd = !!sel && sel.rangeCount > 0 && sel.isCollapsed
                                                && !!sel.focusNode && td.contains(sel.focusNode);
                                        // 仅当光标贴着内容首/尾时才跳格；中间位置交给浏览器正常移动文本光标
                                        if (caretInTd) {
                                                const atEdge = left ? caretAtStart(td) : caretAtEnd(td);
                                                if (!atEdge) return;
                                        }
                                        e.preventDefault();
                                        moveFocus(0, left ? -1 : 1);
                                        return;
                                }

                                // 上下键：光标在内容第一/最后一行时跳格；已处于表格首/末行则跳出表格
                                const up = e.key === 'ArrowUp';
                                const onEdge = up ? caretOnFirstLine(td) : caretOnLastLine(td);
                                if (!onEdge) return; // 中间行：交给浏览器在格内上下移动光标
                                e.preventDefault();
                                // 跳格前捕获当前光标的视口 x：落到目标格后按 x 重定位，
                                // 保持水平位置（12|3 ↑ 456 → 45|6 而非 |456；下跳同理）。
                                // 光标在文本末尾等位置时部分内核返回全零矩形：视为取不到，
                                // 走 moveFocus 的对称默认落点（↑→末尾），不再误判为 x=0 落行首
                                const selB = window.getSelection();
                                let oldX: number | null = null;
                                if (selB && selB.rangeCount > 0 && selB.isCollapsed) {
                                        const cr = selB.getRangeAt(0).getBoundingClientRect();
                                        if (!(cr.left === 0 && cr.top === 0 && cr.width === 0 && cr.height === 0)) {
                                                oldX = cr.left;
                                        }
                                }
                                const moved = up ? moveFocus(-1, 0) : moveFocus(1, 0);
                                if (!moved) exitTable(td, up ? -1 : 1);
                                else if (oldX != null) {
                                        const ntd = cellMap[focusedR]?.[focusedC];
                                        if (ntd) keepCaretXInTd(ntd, oldX);
                                }
                        });

                        td.addEventListener('paste', (e) => {
                                if (isWysiwyg(td)) return; // wysiwyg 自管（源码文本插入）
                                e.preventDefault();
                                const text = e.clipboardData?.getData('text/plain') ?? '';
                                // markdown 表格 → 以本格为左上角网格覆盖粘贴（越界吞掉，不扩表）；
                                // 其余文本走原单格插入
                                const md = parseMarkdownTable(text);
                                if (md) {
                                        const { r, c } = tdCoords(td);
                                        pasteGridRows(r, c, md, false);
                                        clearSelection();
                                        return;
                                }
                                document.execCommand('insertText', false, text);
                        });

                        td.addEventListener('contextmenu', (e) => {
                                if (!td.closest('.cm-editor')) return;
                                e.preventDefault();
                                e.stopPropagation();
                                const { r, c } = tdCoords(td);
                                const inSelection = selRects.some(rc => rectContains(rc, r, c));
                                // 6b：右键点在选区内 → 菜单按选区批量执行；点在选区外 → 清空选区走单格菜单
                                if (selRects.length && !inSelection) clearSelection();
                                showCellMenu(e, data, r, c, toolbar, flushActiveCell, (shift?: FocusShift) => {
                                        applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
                                        onCommit(serialize(data));
                                }, setMode, inSelection ? selOps : null, settings, obsidianCommand);
                        });
                });
        });

        applyModeStyles(wrap, table, data, hsBar);
        bindRcResizeHandles(table, data, false, () => {});
        scheduleMathRender(table);

        // 任务7：表头底色。第一行存在纵向合并（rs>1）→ 底色停用并提示；拆分后恢复再提示
        const refreshHeader = () => {
                const style = settings.headerStyle ?? 'none';
                const suppressed = (grid[0] ?? []).some(cd => cd && visible(cd) && cd.rs > 1);
                if (style !== 'none') {
                        const cur = suppressed ? '1' : '0';
                        if (el.dataset.vtHdrSupp !== undefined && el.dataset.vtHdrSupp !== cur) {
                                new Notice(suppressed
                                        ? '表头行参与了纵向合并，表头底色已暂时停用'
                                        : '纵向合并已拆分，表头底色已恢复');
                        }
                        el.dataset.vtHdrSupp = cur;
                } else {
                        delete el.dataset.vtHdrSupp;
                }
                let bg: string | null = null;
                // noHeaderBg：本表格被命令「添加/删除表头底色」关闭（用户主动，区别于合并的自动抑制）
                if (!suppressed && !data.noHeaderBg) {
                        if (style === 'theme') {
                                // 多级解析：社区主题 --interactive-accent / 默认主题 --accent-color、
                                // --accent-h|s|l HSL 分量 / 探针 computed，全失败才紫色兜底
                                bg = resolveThemeAccent(el) ?? '#7c3aed';
                        } else if (style === 'custom') {
                                bg = (settings.headerColor ?? '').trim() || null;
                        }
                }
                const rowCells = cellMap[0] ?? [];
                for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
                        const td = rowCells[c];
                        if (!td) continue;
                        const cd = grid[0]![c]!;
                        if (bg) {
                                td.setCssProps({ background: bg });
                                td.setCssProps({ color: contrastTextColor(bg) });
                        } else if (cd.bg) { // 还原单元格自身底色（避免误清）
                                td.setCssProps({ background: cd.bg });
                                td.setCssProps({ color: contrastTextColor(cd.bg) });
                        } else {
                                td.setCssProps({ background: '' });
                                td.setCssProps({ color: '' });
                        }
                }
        };

        // 任务5：外框圆角（设置项拖条，0 = 直角）
        const refreshAppearance = () => {
                const radius = Math.max(0, Math.min(24, Math.round(settings.tableRadius ?? 0)));
                if (radius > 0) {
                        wrap.setCssProps({ borderRadius: `${radius}px` });
                        wrap.addClass('vt-radius');
                } else {
                        wrap.setCssProps({ borderRadius: '' });
                        wrap.removeClass('vt-radius');
                }
                refreshHeader();
                applyTableStyle(); // 线风格/隔行随设置变更即时刷新（编辑态自动旁路）
        };
        appearanceRegistry.set(el, refreshAppearance);
        refreshAppearance();

        // 批量操作后的选区恢复（仅作用于发起操作的那张表）
        if (pendingSelectionRestore && pendingSelectionRestore.host === el) {
                const restore = pendingSelectionRestore.rects;
                pendingSelectionRestore = null;
                const maxR = grid.length - 1;
                const maxC = (grid[0]?.length ?? 1) - 1;
                selRects = restore
                        .map(rc => normalizeSelRect({
                                r1: Math.max(0, Math.min(rc.r1, maxR)),
                                c1: Math.max(0, Math.min(rc.c1, maxC)),
                                r2: Math.max(0, Math.min(rc.r2, maxR)),
                                c2: Math.max(0, Math.min(rc.c2, maxC)),
                        }, grid, anchorIndex))
                        .filter(rc => rc.r1 <= rc.r2 && rc.c1 <= rc.c2);
                renderSel();
        }

        // ===== 创建后聚焦：向轮询器注册本块执行器 =====
        // 本轮构建的最终 DOM（可能被 CM widget 重建替换）；runner 每次现查 cellMap 的
        // 连接状态与焦点归属，被替换后返回 false 由轮询器继续等待/重试
        const finishInitialFocus = (fr: number, fc: number) => {
                showEditingUi();
                const td = cellMap[fr]?.[fc];
                if (td && ((Platform.isDesktop && settings.enableDesktopToolbar)
                        || ((Platform.isMobile || Platform.isTablet) && settings.enableMobileToolbar))) {
                        toolbar.show(td, data, fr, fc,
                                (s: string) => {
                                        const shift = toolbar.consumeFocusShift();
                                        applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
                                        onCommit(s);
                                },
                                flushActiveCell, () => onConvertToMd(grid), () => onConvertToHtml(grid), selOps);
                }
                // bug4：多表重渲染期间滚动高度塌陷会把视图钳到文档顶部，
                // 重渲染稳定后把视图拉回聚焦格（两帧后 + 250ms 兜底）
                const bringBack = () => {
                        if (td && td.isConnected && table.contains(document.activeElement)) {
                                td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                        }
                };
                window.requestAnimationFrame(bringBack);
                window.setTimeout(bringBack, 250);
        };
        latestRenderSource = source;
        latestFocusRunner = (r, c, caretAtEnd, textOffset) => {
                const td = cellMap[r]?.[c];
                if (!td || !td.isConnected) return false;
                if (document.activeElement !== td) {
                        if (!focusCell(r, c, caretAtEnd, textOffset)) return false;
                        if (document.activeElement !== td) return false;
                }
                finishInitialFocus(r, c);
                return true;
        };

        if (pendingFocusRestore) {
                const req = pendingFocusRestore;
                // 创建请求带目标源文本：多表文档里其它块重渲染不得偷走（源不匹配 → 留给目标块）
                if (req.expectSource !== undefined && source !== req.expectSource) {
                        // 不消费；但过期后清理，防泄漏
                        if (req.expires !== undefined && Date.now() > req.expires) pendingFocusRestore = null;
                } else {
                        pendingFocusRestore = null;
                        const fr = req.r, fc = req.c, caretAtEnd = req.caretAtEnd, textOffset = req.textOffset ?? null;
                        const isCreation = req.expires !== undefined;
                        const tryInitialFocus = () => {
                                const td = cellMap[fr]?.[fc];
                                if (!td || !td.isConnected) {
                                        // 本轮渲染的表格已被替换（创建时 CM 常连渲两轮）：
                                        // 未过期则把请求挂回——renderBlock 不再跑时由轮询器兜底（widget 重建不重跑 processor）
                                        if (isCreation && req.expires !== undefined && Date.now() < req.expires) {
                                                pendingFocusRestore = req;
                                        }
                                        return;
                                }
                                if (document.activeElement === td || focusCell(fr, fc, caretAtEnd, textOffset)) {
                                        if (document.activeElement === td) {
                                                finishInitialFocus(fr, fc);
                                                return;
                                        }
                                }
                                if (!isCreation) return; // 编辑恢复请求：一次不成功即放弃（原行为）
                                // 创建请求：宿主编辑器会反复夺焦（CM 渲染完成后回焦正文），
                                // 有效期内每 150ms 重夺一次；用户主动聚焦别处（非编辑器/非 body）则让位
                                if (req.expires !== undefined && Date.now() < req.expires) {
                                        const holder = document.activeElement;
                                        const yieldsToUser = holder instanceof HTMLElement
                                                && holder !== document.body
                                                && !holder.closest('.cm-editor');
                                        if (!yieldsToUser) window.setTimeout(tryInitialFocus, 150);
                                }
                        };
                        window.requestAnimationFrame(tryInitialFocus);
                }
        }

        // bug4：按锚点还原滚动位置——保持该表格在视口中的相对位置不变。
        // Obsidian 重渲染管线是异步的，塌陷/回弹可能发生在数秒内，所以用长队列多点校验，
        // 每个检查点都从锚点重算目标位置（自适应高度变化），稳定后自然不再触发。
        if (pendingScrollAnchor && pendingScrollAnchor.host === el) {
                const anchor = pendingScrollAnchor;
                pendingScrollAnchor = null;
                const restore = () => {
                        if (!anchor.scroller.isConnected || !el.isConnected || Date.now() > anchor.expires) return;
                        // 触摸滚动静默期（800ms）内绝不写 scrollTop：iOS 上程序写入与惯性滚动
                        // 竞争会永久锁死触摸滚动（本 bug 的头号根因）。该拍放弃，后续检查点接管
                        if (Date.now() - lastTouchScrollAt < 800) return;
                        const nowOffset = el.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top;
                        const target = Math.max(0, anchor.scrollTop + (anchor.offsetTop - nowOffset));
                        if (Math.abs(anchor.scroller.scrollTop - target) > 4) {
                                anchor.scroller.scrollTop = target;
                        }
                };
                window.requestAnimationFrame(() => window.requestAnimationFrame(restore));
                for (const t of [100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000]) {
                        window.setTimeout(restore, t);
                }
        }

        // 渲染就绪：两帧后撤掉视觉冻结快照（新内容已上屏，600ms 兜底见 preserveVisualSnapshot）
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => clearVisualSnapshot(el)));
}

/* ===== 光标位置探测（方向键智能跳格用） ===== */

/** 光标（collapsed selection）是否位于 td 内容最开头 */
function caretAtStart(td: HTMLElement): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const cr = sel.getRangeAt(0);
        if (!td.contains(cr.startContainer)) return false;
        const probe = document.createRange();
        probe.selectNodeContents(td);
        probe.setEnd(cr.startContainer, cr.startOffset);
        return probe.toString().length === 0;
}

/** 光标是否位于 td 内容最末尾 */
function caretAtEnd(td: HTMLElement): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const cr = sel.getRangeAt(0);
        if (!td.contains(cr.endContainer)) return false;
        const probe = document.createRange();
        probe.selectNodeContents(td);
        probe.setStart(cr.endContainer, cr.endOffset);
        return probe.toString().length === 0;
}

/** 取光标所在视觉行的 top；无法判定时返回 null */
function caretLineTop(td: HTMLElement): number | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.focusNode) return null;
        const node = sel.focusNode;
        const off = sel.focusOffset;

        // 新版 Chromium：collapsed range 自带 caret rect
        const direct = Array.from(sel.getRangeAt(0).getClientRects());
        if (direct.length > 0) return direct[0]!.top;

        // 兜底：向右/向左临时扩展一个字符，借字符行框定位光标所在行
        const probe = document.createRange();
        try {
                const len = node.nodeType === Node.TEXT_NODE
                        ? (node as Text).length
                        : node.childNodes.length;
                probe.setStart(node, off);
                probe.setEnd(node, Math.min(off + 1, len));
                if (!probe.collapsed) {
                        const rects = Array.from(probe.getClientRects());
                        if (rects.length > 0) return rects[0]!.top;
                }
                probe.setEnd(node, off);
                probe.setStart(node, Math.max(0, off - 1));
                if (!probe.collapsed) {
                        const rects = Array.from(probe.getClientRects());
                        if (rects.length > 0) return rects[rects.length - 1]!.top;
                }
        } catch {
                /* 边界越界等异常：视为无法判定 */
        }
        return null;
}

/** td 内容首个（first=true）或最后（first=false）一个视觉行的 top */
function contentLineTop(td: HTMLElement, first: boolean): number | null {
        const range = document.createRange();
        range.selectNodeContents(td);
        const rects = Array.from(range.getClientRects());
        if (rects.length === 0) return null;
        return first
                ? Math.min(...rects.map(r => r.top))
                : Math.max(...rects.map(r => r.top));
}

/** 光标是否在 td 内容的第一视觉行（无法判定时按是处理，保证可跳格） */
function caretOnFirstLine(td: HTMLElement): boolean {
        const top = caretLineTop(td);
        if (top === null) return true;
        const first = contentLineTop(td, true);
        if (first === null) return true;
        return top - first <= 6;
}

/** 光标是否在 td 内容的最后一视觉行 */
function caretOnLastLine(td: HTMLElement): boolean {
        const top = caretLineTop(td);
        if (top === null) return true;
        const last = contentLineTop(td, false);
        if (last === null) return true;
        return last - top <= 6;
}

/** 跨格上下跳转后保持水平光标位置：按视口 x 在目标格内重定位（caretRangeFromPoint，WKWebView/桌面均可）。
 *  x 命中格内容之外的空白时按 x 与格中线的相对位置回退行首/行尾；API 缺失或异常时不动（保留默认落点） */
function keepCaretXInTd(td: HTMLElement, x: number): void {
        const rect = td.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const doc = document as Document & {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
                caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        let node: Node | null = null;
        let off = 0;
        try {
                const hit = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
                if (hit) {
                        node = hit.startContainer;
                        off = hit.startOffset;
                } else {
                        const p = doc.caretPositionFromPoint ? doc.caretPositionFromPoint(x, y) : null;
                        if (p) {
                                node = p.offsetNode;
                                off = p.offset;
                        }
                }
        } catch {
                return;
        }
        if (!node) return;
        if (!td.contains(node)) {
                // 命中格内容外（x 超出文本范围/落进邻格）：x 在右半 → 行尾，左半 → 行首
                placeCaretAtTextOffset(td, x > rect.left + rect.width / 2 ? td.textContent?.length ?? 0 : 0);
                return;
        }
        const rng = document.createRange();
        rng.setStart(node, off);
        rng.collapse(true);
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(rng);
}

function normalizeCellHtml(html: string): string {
        const trimmed = html.trim();
        if (!trimmed) return '';
        // 全选删除后的残骸（<br>、<div><br></div>、空白/nbsp 任意组合）= 空内容：
        // 保留会让"删除内容"看起来无效（源码留 <br> 垃圾，下次渲染多出空行）
        if (/^(?:(?:<div[^>]*>)?\s*<br\s*\/?>\s*(?:<\/div>)?|(?:&nbsp;|\u00a0|\s))+$/.test(trimmed)) return '';
        return trimmed
                .replace(/^<(div|p)>\s*(<br\s*\/?>)?\s*<\/\1>/i, '')
                .replace(/^(&nbsp;|\u00a0|\s)+/, '')
                // 用户输入的字面 <br>（contenteditable 转义为实体）→ 还原为真换行标签：
                // 渲染换行、导出 markdown 表格均为可渲染的 <br>，而非 &lt;br&gt; 字符
                .replace(/&lt;(br\s*\/?)&gt;/gi, '<$1>');
}

/** 光标在 td 内容中的字符偏移（非折叠选区/不在格内返回 null）—— bug2：结构操作后光标留在原位 */
function caretTextOffsetInTd(td: HTMLElement): number | null {
        if (isWysiwyg(td)) return caretSourceOffset(td);
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        if (!range.collapsed || !td.contains(range.startContainer)) return null;
        const probe = range.cloneRange();
        probe.selectNodeContents(td);
        try {
                probe.setEnd(range.startContainer, range.startOffset);
        } catch {
                return null;
        }
        const len = probe.toString().length;
        return Number.isFinite(len) ? len : null;
}

/** 把光标放到 td 内指定字符偏移处（超出则落到末尾） */
function placeCaretAtTextOffset(td: HTMLElement, offset: number) {
        if (isWysiwyg(td)) return placeCaretAtSourceOffset(td, offset);
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const len = node.textContent?.length ?? 0;
                if (remaining <= len) {
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        const range = document.createRange();
                        try {
                                range.setStart(node, remaining);
                                range.collapse(true);
                                sel?.addRange(range);
                        } catch { /* 文本节点异常时退回末尾 */ break; }
                        return;
                }
                remaining -= len;
        }
        placeCaretFallbackAtEnd(td);
}

function placeCaretFallbackAtEnd(td: HTMLElement) {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(td);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
}

/**
 * 按「插入/删除」增量序列平移下标（bug2/批量操作的聚焦坐标修正）。
 * 插入 {at, +n}：下标 >= at 的整体 +n；删除 {at, -n}：下标 == at..at+n-1 的视为被删（返回 -1），> at+n-1 的 -n。
 * deltas 用原始坐标给出，函数内部按文档顺序累积换算。
 */
function shiftIndex(v: number, deltas: Array<{ at: number; d: number }>): number {
        const sorted = deltas.slice().sort((a, b) => a.at - b.at);
        let out = v;
        let cursor = 0;
        for (const { at, d } of sorted) {
                const atNow = at + cursor;
                if (d > 0) {
                        if (out >= atNow) out += d;
                        cursor += d;
                } else {
                        const n = -d;
                        if (out >= atNow && out <= atNow + n - 1) return -1; // 被删除
                        if (out > atNow + n - 1) out -= n;
                        cursor -= n;
                }
        }
        return out;
}

function populateCell(
        td: HTMLTableCellElement,
        raw: string,
        grid: Grid,
        sourcePath: string,
        resolveImage: (linkText: string) => string | null,
        onTodoToggle?: (idx: number, checked: boolean) => void,
        onOpenLink?: (linkText: string) => void,
) {
        td.replaceChildren(...parseTrustedHtml(raw).childNodes);
        if (/^=[A-Z]+\(/i.test(raw)) {
                td.textContent = evalFormula(grid, raw);
        }
        renderHtml(td);
        renderInlineCode(td);
        renderMarkdown(td);
        renderTodos(td, onTodoToggle);
        renderImages(td, sourcePath, resolveImage);
        renderWikiLinks(td, onOpenLink);
}

const MATH_RE = /\$\$([^$]+?)\$\$|\$(\S(?:[^$\n]*?\S)?)\$/g;

function renderMathInNode(root: HTMLElement): boolean {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !text.includes('$')) continue;
                if (node.parentElement?.closest('code')) continue;
                targets.push(node as Text);
        }

        let found = false;
        for (const textNode of targets) {
                const frag = splitMath(textNode.textContent!);
                if (!frag) continue;
                textNode.replaceWith(frag);
                found = true;
        }
        return found;
}

function splitMath(text: string): DocumentFragment | null {
        MATH_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        let last = 0;
        let matched = false;
        const frag = document.createDocumentFragment();

        while ((match = MATH_RE.exec(text))) {
                if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
                const display = match[1] !== undefined;
                const source = (match[1] ?? match[2] ?? '').trim();
                try {
                        frag.appendChild(renderMath(source, display));
                } catch {
                        frag.appendChild(document.createTextNode(match[0]));
                }
                matched = true;
                last = MATH_RE.lastIndex;
        }
        if (!matched) return null;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        return frag;
}

function renderHtml(root: HTMLElement) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !text.includes('<')) continue;
                if (node.parentElement?.closest('code')) continue;
                targets.push(node as Text);
        }

        for (const textNode of targets) {
                const text = textNode.textContent!;
                if (!/<[a-z][a-z0-9]*\b[^>]*>/i.test(text) && !/<\/[a-z]+>/i.test(text)) continue;
                textNode.replaceWith(...parseTrustedHtml(text).childNodes);
        }
}

function renderMarkdown(root: HTMLElement) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !/[*_~=`]/.test(text)) continue;
                if (node.parentElement?.closest('b, i, mark, s, a, code, img, label')) continue;
                targets.push(node as Text);
        }

        for (const textNode of targets) {
                const html = mdInlineToHtml(textNode.textContent!);
                if (html === textNode.textContent) continue;
                textNode.replaceWith(...parseTrustedHtml(html).childNodes);
        }
}

function renderInlineCode(root: HTMLElement) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !text.includes('`')) continue;
                if (node.parentElement?.closest('code')) continue;
                targets.push(node as Text);
        }

        for (const textNode of targets) {
                if (!/`[^`]+`/.test(textNode.textContent!)) continue;
                const html = mdInlineToHtml(textNode.textContent!);
                if (html === textNode.textContent) continue;
                textNode.replaceWith(...parseTrustedHtml(html).childNodes);
        }
}

const TODO_LINE_RE = /^-\s*\[([ xX])\]\s*(.*)$/;

function renderTodos(root: HTMLElement, onTodoToggle?: (idx: number, checked: boolean) => void) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !/-\s*\[[ xX]\]/.test(text)) continue;
                if (node.parentElement?.closest('code, label')) continue;
                targets.push(node as Text);
        }

        for (const textNode of targets) {
                const text = textNode.textContent!;
                const lines = text.split('\n');
                let hasTodo = false;
                const frag = document.createDocumentFragment();

                const buildTaskItem = (m: RegExpMatchArray) => {
                        hasTodo = true;
                        const item = createEl('div');
                        item.className = 'vt-task-item';
                        const cb = createEl('input');
                        cb.type = 'checkbox';
                        cb.checked = m[1] !== ' ';
                        // 任务7：状态自跟踪——不依赖浏览器对 input 的自动翻转行为
                        //（live preview 下该行为会被编辑器事件处理干扰，导致勾选失效）
                        cb.dataset.vtOn = cb.checked ? '1' : '0';
                        cb.tabIndex = -1;
                        // 对齐用内联样式：input 的 margin 会被 Obsidian 全局规则吃掉（CSS 对抗不稳）；
                        // box-sizing + 显式尺寸锁定绘制盒（防主题框溢出导致偏上），
                        // border/padding 不动——主题自绘 checkbox 靠它们画框，清掉会让未勾选框消失
                        cb.setCssProps({ margin: '0.225em 0 0' });
                        // font-size 显式继承：<input> 的 UA 默认样式不继承 font-size，1em 会参照浏览器
                        // 默认字号——iPad（新默认大字号）下复选框不随系统字号放大（桌面被 Obsidian
                        // 全局规则归一所以正常）。钉死继承后 1em/0.225em 全部跟随文字字号
                        cb.setCssProps({ fontSize: 'inherit' });
                        cb.setCssProps({ width: '1em' });
                        cb.setCssProps({ height: '1em' });
                        cb.setCssProps({ boxSizing: 'border-box' });
                        // iPad 触控：1em 视觉盒太小难点中——外包均匀 5px 热区（负 margin 抵消，视觉位置不变）
                        const hit = createEl('span');
                        hit.className = 'vt-cb-hit';
                        hit.setCssProps({ display: 'inline-flex' });
                        hit.setCssProps({ padding: '5px' });
                        hit.setCssProps({ margin: '-5px' });
                        hit.setCssProps({ marginTop: 'calc(-5px + 0.1em)' });
                        hit.setCssProps({ cursor: 'pointer' });
                        hit.setCssProps({ borderRadius: '4px' });
                        hit.addEventListener('mousedown', (e) => e.preventDefault());
                        // 任务6：点框打勾——不聚焦 td（保持渲染态）、不触发选区/清选区手势
                        if (onTodoToggle) {
                                hit.addEventListener('pointerdown', (e) => e.stopPropagation());
                                hit.addEventListener('click', (e) => {
                                        e.preventDefault(); // 完全接管切换：屏蔽浏览器自动翻转（各模式行为不一）
                                        e.stopPropagation();
                                        // 阅读模式（非编辑器上下文）：checkbox 仅做显示，禁止勾选——
                                        // 阅读模式的写回链路不可靠，此前"点了能翻但存不上"的假翻转
                                        // 正是"勾选状态渲染不对"的根源；显示状态一律以源文本为准
                                        if (!root.closest('.cm-editor')) return;
                                        const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('.vt-task-item input[type="checkbox"]'));
                                        const idx = boxes.indexOf(cb);
                                        if (idx < 0) return;
                                        const next = cb.dataset.vtOn !== '1'; // 以自跟踪状态为准
                                        cb.checked = next; // 立即反馈，提交后整体重渲染
                                        cb.dataset.vtOn = next ? '1' : '0';
                                        onTodoToggle(idx, next);
                                });
                        }
                        hit.appendChild(cb);
                        item.appendChild(hit);
                        const span = createEl('span');
                        span.textContent = m[2] ?? '';
                        item.appendChild(span);
                        return item;
                };

                // 任务7：两阶段渲染。先规划输出序列再统一构建，解决：
                // (1) 任务块之间的空行 → pre-wrap 下渲染成整行空白，撑大待办间距 → 丢弃；
                // (2) 块级 item 与相邻文本节点的换行叠加（div 自带换行，紧邻 \n 会多出空行）→ 修剪
                type Out = { kind: 'task' | 'text'; s: string; m?: RegExpMatchArray };
                const outs: Out[] = [];
                for (let i = 0; i < lines.length; i++) {
                        const line = lines[i]!;
                        const m = line.match(TODO_LINE_RE);
                        if (m) {
                                outs.push({ kind: 'task', s: line, m });
                                continue;
                        }
                        if (!line.trim()) {
                                // 空行：下一个非空行是任务行 → 属于任务块分隔空行，丢弃
                                let nx = -1;
                                for (let j = i + 1; j < lines.length; j++) {
                                        if (lines[j]!.trim()) { nx = j; break; }
                                }
                                if (nx >= 0 && TODO_LINE_RE.test(lines[nx]!)) continue;
                        }
                        outs.push({ kind: 'text', s: line + (i < lines.length - 1 ? '\n' : '') });
                }
                for (let i = 0; i < outs.length; i++) {
                        if (outs[i]!.kind !== 'task') continue;
                        const prev = outs[i - 1];
                        if (prev && prev.kind === 'text') prev.s = prev.s.replace(/\n+$/, '');
                        const next = outs[i + 1];
                        if (next && next.kind === 'text') next.s = next.s.replace(/^\n+/, '');
                }
                for (const out of outs) {
                        if (out.kind === 'task') {
                                frag.appendChild(buildTaskItem(out.m!));
                        } else if (out.s) {
                                frag.appendChild(document.createTextNode(out.s));
                        }
                }
                if (!hasTodo) continue;
                // 任务7 v2：serialize 把格内换行存为 <br>（builder escapeCell），渲染结构变成
                // [item, <br>, item]——div 块级自带换行，<br> 再叠一行 = 待办之间多出一整行空白。
                // 删除与待办 item 直接相邻的 <br> 链；普通文本侧的 <br> 是换行语义，保留
                const head = frag.firstChild;
                const tail = frag.lastChild;
                textNode.replaceWith(frag);
                const isItem = (n: Node | null): n is HTMLElement =>
                        !!n && n.nodeName === 'DIV' && (n as HTMLElement).classList.contains('vt-task-item');
                if (isItem(tail)) {
                        let s: Node | null = tail.nextSibling;
                        while (s && s.nodeName === 'BR') { const nx = s.nextSibling; s.remove(); s = nx; }
                }
                if (isItem(head)) {
                        let s: Node | null = head.previousSibling;
                        while (s && s.nodeName === 'BR') { const pv = s.previousSibling; s.remove(); s = pv; }
                }
        }
}

const IMG_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

function renderImages(root: HTMLElement, sourcePath: string, resolveImage: (linkText: string) => string | null) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text || !text.includes('!')) continue;
                if (node.parentElement?.closest('code, img')) continue;
                targets.push(node as Text);
        }

        for (const textNode of targets) {
                IMG_RE.lastIndex = 0;
                const text = textNode.textContent!;
                let match: RegExpExecArray | null;
                let last = 0;
                let found = false;
                const frag = document.createDocumentFragment();

                while ((match = IMG_RE.exec(text))) {
                        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));

                        if (isWikiLinkInsideBackticks(text, match.index)) {
                                frag.appendChild(document.createTextNode(match[0]));
                                found = true;
                                last = IMG_RE.lastIndex;
                                continue;
                        }

                        const linkText = match[1]!.trim();
                        const sizeText = (match[2] ?? '').trim();
                        // ![[x | 50]]：| 后纯数字 = 恒定像素宽（| 前后空格容忍，等比缩放）；
                        // 非数字保持原有 alt 语义；无 | 保持原状。HTML 语法不在此管线，无需支持
                        const sizeNum = /^\d+$/.test(sizeText) ? parseInt(sizeText, 10) : null;
                        const altText = sizeNum === null ? sizeText : '';
                        const src = resolveImage(linkText);

                        if (src) {
                                const img = createEl('img');
                                img.src = src;
                                img.alt = altText || linkText;
                                img.setCssProps({ maxWidth: '100%' });
                                if (sizeNum !== null) img.setCssProps({ width: `${sizeNum}px` });
                                frag.appendChild(img);
                        } else {
                                frag.appendChild(document.createTextNode(match[0]));
                        }
                        found = true;
                        last = IMG_RE.lastIndex;
                }
                if (!found) continue;
                if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
                textNode.replaceWith(frag);
        }
}

/** 双链渲染：[[链接]]、[[链接|别名]]、[[链接#标题|别名]] → 可点击跳转的 internal-link。
 *  在 renderImages 之后跑（![[...]] 嵌入已被处理，文本节点里剩下的才是纯双链）；
 *  反引号内的双链跳过（与图片同规则）。数据层不改动，仅渲染层替换——roundtrip 原样保留 */
const WIKILINK_RE = /\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

function renderWikiLinks(root: HTMLElement, onOpenLink?: (linkText: string) => void) {
        if (!onOpenLink) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const targets: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (text && text.includes('[[')) targets.push(node as Text);
        }
        for (const textNode of targets) {
                const text = textNode.textContent!;
                WIKILINK_RE.lastIndex = 0;
                if (!WIKILINK_RE.test(text)) continue;
                const frag = document.createDocumentFragment();
                let last = 0;
                WIKILINK_RE.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = WIKILINK_RE.exec(text))) {
                        // "![[...]]" 图片嵌入（图片解析失败保留原文时不转链接）
                        if (m.index > 0 && text[m.index - 1] === '!') continue;
                        if (isWikiLinkInsideBackticks(text, m.index)) continue;
                        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
                        const linkText = m[1]!.trim();
                        const display = (m[2]?.trim() || linkText);
                        const a = createEl('a');
                        a.className = 'internal-link';
                        a.href = linkText;
                        a.textContent = display;
                        // 点击即跳转（编辑/阅读模式一致）：
                        // 编辑模式必须抢在 td focus 之前——渲染态 td focus 会把内容重写回源码，
                        // 链接元素被销毁，click 事件派发落空（"一点就显示源码"的根因）；
                        // pointerdown preventDefault 阻止 focus 与文本选择，click 作阅读模式兜底。
                        // 500ms 去重防 pointerdown+click 双触发导致连开两次
                        let jumped = false;
                        const jump = (e: Event) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (jumped) return;
                                jumped = true;
                                window.setTimeout(() => { jumped = false; }, 500);
                                onOpenLink(linkText);
                        };
                        a.addEventListener('pointerdown', jump);
                        a.addEventListener('click', jump);
                        frag.appendChild(a);
                        last = WIKILINK_RE.lastIndex;
                }
                if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
                textNode.replaceWith(frag);
        }
}

/** ===== 右键菜单：动作注册表 + 用户配置驱动 =====
 * 每个动作在"有选区/无选区"两态间自动分流（选区=批量、无选区=作用于菜单位格）；
 * 菜单结构由设置里的 contextMenu 文本决定：一行一项，"---" = 分隔线，
 * "cmd:命令id" = 任意 Obsidian 命令，"id|图标名" 可自定义图标。 */
type MenuCtx = {
        r: number;
        c: number;
        grid: Grid;
        data: VtData;
        apply: (fn: () => void, shift?: FocusShift) => void;
        sel: SelOps | null;
        setMode: (mode: VtMode) => void;
        focusR: () => number;
        focusC: () => number;
};

type MenuAction = {
        zh: string;
        en: string;
        icon: string;
        /** 仅在有选区时渲染（无单格语义的动作） */
        needsSel?: boolean;
        checked?: (ctx: MenuCtx) => boolean;
        exec: (ctx: MenuCtx) => void;
};

/** 单元格 html → 纯文本（<br> → 换行，其余标签剥除） */
function cellPlainText(html: string): string {
        return parseTrustedHtml(html.replace(/<br\s*\/?>/gi, '\n')).textContent ?? '';
}

/** 复制菜单位置（选区 → 逐矩形 TSV；单格 → 格内容）到剪贴板 */
function copyCtxToClipboard(ctx: MenuCtx): void {
        // 普通文本复制（与剪切同逻辑，只是不删原文）：选区 = 行按 \n、格按 \t 顺次拼接；单格 = 格文本
        let text = '';
        if (ctx.sel && ctx.sel.rects.length) {
                const lines: string[] = [];
                for (const rc of ctx.sel.rects) {
                        for (let r = rc.r1; r <= rc.r2; r++) {
                                const cells: string[] = [];
                                for (let c = rc.c1; c <= rc.c2; c++) {
                                        const cd = ctx.grid[r]?.[c];
                                        cells.push(cd ? cellPlainText(cd.t) : '');
                                }
                                lines.push(cells.join('\t'));
                        }
                }
                text = lines.join('\n');
        } else {
                const cd = ctx.grid[ctx.r]?.[ctx.c];
                text = cd ? cellPlainText(cd.t) : '';
        }
        try {
                void navigator.clipboard?.writeText(text)?.catch?.(() => { /* 剪贴板失败静默 */ });
        } catch { /* 环境无 clipboard API */ }
}

/** 清空内容：选区 → 清空所选；单格 → 清空本格（光标保持） */
function clearCtxContent(ctx: MenuCtx): void {
        if (ctx.sel && ctx.sel.rects.length) { ctx.sel.clearContent(); return; }
        ctx.apply(() => { ctx.grid[ctx.r]![ctx.c]!.t = ''; });
}

/** 纯文本 → 单元格 html：转义后换行转 <br>（t 的换行存法=br 标签，与复制端 cellPlainText 对称） */
function plainToCellHtml(text: string): string {
        return escapeHtml(text).replace(/\n/g, '<br>');
}

/** 粘贴：读剪贴板纯文本写入。选区 = TSV 网格（行 \n、格 \t）从选区第一矩形左上角开始铺（与复制对称，
 *  跳过合并占位格/越界）；单格 = 整段写本格。读不到（未授权/空）提示后静默返回。
 *  异步窗口风险：grid 判空防越界；ctx.apply 内部自带提交重渲染 */
function pasteCtxFromClipboard(ctx: MenuCtx): void {
        void navigator.clipboard?.readText?.()?.then((text) => {
                if (!text) return;
                const rows = text.replace(/\r/g, '').split('\n').map(l => l.split('\t'));
                if (ctx.sel && ctx.sel.rects.length) {
                        const rc = ctx.sel.rects[0]!;
                        ctx.apply(() => {
                                for (let dr = 0; dr < rows.length; dr++) {
                                        for (let dc = 0; dc < rows[dr]!.length; dc++) {
                                                const cd = ctx.grid[rc.r1 + dr]?.[rc.c1 + dc];
                                                if (!cd || !visible(cd)) continue;
                                                cd.t = plainToCellHtml(rows[dr]![dc]!);
                                        }
                                }
                        });
                        return;
                }
                ctx.apply(() => {
                        const cd = ctx.grid[ctx.r]?.[ctx.c];
                        if (!cd) return;
                        cd.t = plainToCellHtml(text);
                });
        }).catch(() => {
                new Notice(t('无法读取剪贴板（可能未授权）', 'Cannot read clipboard (permission denied)'));
        });
}

/** 对齐的单格/选区双路：有选区批量（selOps.align→commitSel）；无选区（右键单格，sel=null）
 *  用 ctx.r/c 直接改格并 apply 提交（右键格必为可见格锚点） */
function alignCtx(ctx: MenuCtx, mode: 'l' | 'c' | 'r'): void {
        if (ctx.sel) { ctx.sel.align(mode); return; }
        ctx.apply(() => {
                const cd = ctx.grid[ctx.r]?.[ctx.c];
                if (!cd) return;
                if (mode === 'l') delete cd.a;
                else cd.a = mode;
        });
}

function alignVCtx(ctx: MenuCtx, mode: 't' | 'm' | 'b'): void {
        if (ctx.sel) { ctx.sel.alignV(mode); return; }
        ctx.apply(() => {
                const cd = ctx.grid[ctx.r]?.[ctx.c];
                if (!cd) return;
                if (mode === 't') delete cd.va;
                else cd.va = mode;
        });
}

/** 删除内容/结构：选区 → 批量；单格 → 本格/本行/本列。光标平移语义与原菜单一致 */
export const VT_MENU_ACTIONS: Record<string, MenuAction> = {
        'vt.copy': { zh: '复制', en: 'Copy', icon: 'copy', exec: (ctx) => copyCtxToClipboard(ctx) },
        'vt.paste': { zh: '粘贴', en: 'Paste', icon: 'clipboard-paste', exec: (ctx) => pasteCtxFromClipboard(ctx) },
        'vt.cut': {
                zh: '剪切', en: 'Cut', icon: 'scissors',
                exec: (ctx) => { copyCtxToClipboard(ctx); clearCtxContent(ctx); },
        },
        'vt.delete': { zh: '删除内容', en: 'Delete content', icon: 'eraser', exec: (ctx) => clearCtxContent(ctx) },
        'vt.clearContent': { zh: '清空所选内容', en: 'Clear selection', icon: 'eraser', needsSel: true, exec: (ctx) => ctx.sel!.clearContent() },
        'vt.bold': { zh: '加粗', en: 'Bold', icon: 'bold', needsSel: true, exec: (ctx) => ctx.sel!.bold() },
        'vt.italic': { zh: '斜体', en: 'Italic', icon: 'italic', needsSel: true, exec: (ctx) => ctx.sel!.italic() },
        // 对齐六项不设 needsSel：有选区走选区批量；无选区（右键单格，ctx.sel=null）对右键格直接生效
        'vt.alignL': { zh: '居左', en: 'Align left', icon: 'align-left', exec: (ctx) => alignCtx(ctx, 'l') },
        'vt.alignC': { zh: '居中', en: 'Align center', icon: 'align-center', exec: (ctx) => alignCtx(ctx, 'c') },
        'vt.alignR': { zh: '居右', en: 'Align right', icon: 'align-right', exec: (ctx) => alignCtx(ctx, 'r') },
        'vt.alignT': { zh: '顶对齐', en: 'Align top', icon: 'arrow-up-to-line', exec: (ctx) => alignVCtx(ctx, 't') },
        'vt.alignM': { zh: '垂直居中', en: 'Align middle', icon: 'align-vertical-justify-center', exec: (ctx) => alignVCtx(ctx, 'm') },
        'vt.alignB': { zh: '底对齐', en: 'Align bottom', icon: 'arrow-down-to-line', exec: (ctx) => alignVCtx(ctx, 'b') },
        'vt.pickColor': { zh: '设置底色…', en: 'Set color…', icon: 'paintbrush', needsSel: true, exec: (ctx) => ctx.sel!.pickColor() },
        'vt.insRowAbove': {
                zh: '上方插入行', en: 'Insert row above', icon: 'arrow-up',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.insRowAbove(); return; }
                        const fr = ctx.focusR();
                        ctx.apply(() => insertRow(ctx.grid, ctx.r - 1), { dr: fr >= 0 && fr >= ctx.r ? 1 : 0 });
                },
        },
        'vt.insRowBelow': {
                zh: '下方插入行', en: 'Insert row below', icon: 'arrow-down',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.insRowBelow(); return; }
                        const fr = ctx.focusR();
                        ctx.apply(() => insertRow(ctx.grid, ctx.r), { dr: fr >= 0 && fr > ctx.r ? 1 : 0 });
                },
        },
        'vt.delRow': {
                zh: '删除本行', en: 'Delete row', icon: 'trash',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.delRows(); return; }
                        ctx.apply(() => deleteRow(ctx.grid, ctx.r), { dr: -1, resetCaret: true });
                },
        },
        'vt.insColLeft': {
                zh: '左侧插入列', en: 'Insert column left', icon: 'arrow-left',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.insColLeft(); return; }
                        const fc = ctx.focusC();
                        ctx.apply(() => insertCol(ctx.grid, ctx.c - 1), { dc: fc >= 0 && fc >= ctx.c ? 1 : 0 });
                },
        },
        'vt.insColRight': {
                zh: '右侧插入列', en: 'Insert column right', icon: 'arrow-right',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.insColRight(); return; }
                        const fc = ctx.focusC();
                        ctx.apply(() => insertCol(ctx.grid, ctx.c), { dc: fc >= 0 && fc > ctx.c ? 1 : 0 });
                },
        },
        'vt.delCol': {
                zh: '删除本列', en: 'Delete column', icon: 'trash',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.delCols(); return; }
                        ctx.apply(() => deleteCol(ctx.grid, ctx.c), { dc: -1, resetCaret: true });
                },
        },
        'vt.mergeRight': {
                zh: '向右合并', en: 'Merge right', icon: 'arrow-right-to-line',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.merge(); return; }
                        ctx.apply(() => mergeRight(ctx.grid, ctx.r, ctx.c),
                                { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true });
                },
        },
        'vt.mergeDown': {
                zh: '向下合并', en: 'Merge down', icon: 'arrow-down-to-line',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.merge(); return; }
                        ctx.apply(() => mergeDown(ctx.grid, ctx.r, ctx.c),
                                { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true });
                },
        },
        'vt.split': {
                zh: '拆分单元格', en: 'Split cell', icon: 'split-square-horizontal',
                exec: (ctx) => {
                        if (ctx.sel?.rects.length) { ctx.sel.split(); return; }
                        ctx.apply(() => splitCell(ctx.grid, ctx.r, ctx.c),
                                { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true });
                },
        },
        'vt.modeOL': { zh: '切换到 OL 模式', en: 'OL mode', icon: 'list', checked: (ctx) => ctx.data.mode === 'OL', exec: (ctx) => ctx.setMode('OL') },
        'vt.modeHS': { zh: '切换到 HS 模式', en: 'HS mode', icon: 'move-horizontal', checked: (ctx) => ctx.data.mode === 'HS', exec: (ctx) => ctx.setMode('HS') },
        'vt.modeRC': { zh: '切换到 RC 模式', en: 'RC mode', icon: 'table', checked: (ctx) => ctx.data.mode === 'RC', exec: (ctx) => ctx.setMode('RC') },
};

/** 右键菜单默认配置（与历史菜单等价 + 新增复制/剪切/删除 + 对齐图标组）。
 *  语法：一行一项；'---'=分隔线；'id'|'id|icon'=普通项；全角'｜'分隔一行内多个纯图标小项（对齐组） */
export const DEFAULT_CONTEXT_MENU = [
        'vt.copy', 'vt.paste', 'vt.cut', 'vt.delete', '---',
        'vt.insRowAbove', 'vt.insRowBelow', 'vt.delRow', '---',
        'vt.insColLeft', 'vt.insColRight', 'vt.delCol', '---',
        'vt.alignL｜vt.alignC｜vt.alignR',
        'vt.alignT｜vt.alignM｜vt.alignB',
        'vt.pickColor', '---',
        'vt.mergeRight', 'vt.mergeDown', 'vt.split', '---',
        'vt.modeOL', 'vt.modeHS', 'vt.modeRC',
].join('\n');

type MenuItemSpec =
        | { kind: 'sep' }
        | { kind: 'act'; id: string; icon?: string }
        | { kind: 'group'; ids: string[] };

/** 配置文本 → 渲染序列：去空行、合并连续分隔线、去首尾多余分隔线。
 *  含全角'｜'的行 = 纯图标组（一行多个小图标，组内成员用动作自带 icon） */
function parseMenuConfig(src: string): MenuItemSpec[] {
        const out: MenuItemSpec[] = [];
        for (const raw of src.split('\n')) {
                const line = raw.trim();
                if (!line) continue;
                if (line === '---') {
                        if (out.length && out[out.length - 1]!.kind !== 'sep') out.push({ kind: 'sep' });
                        continue;
                }
                if (line.includes('｜')) {
                        const ids = line.split('｜').map(s => s.trim()).filter(Boolean);
                        if (ids.length) out.push({ kind: 'group', ids });
                        continue;
                }
                const bar = line.indexOf('|');
                out.push(bar >= 0
                        ? { kind: 'act', id: line.slice(0, bar).trim(), icon: line.slice(bar + 1).trim() || undefined }
                        : { kind: 'act', id: line });
        }
        while (out.length && out[out.length - 1]!.kind === 'sep') out.pop();
        return out;
}

function buildCellMenu(settings: VtSettings, ctx: MenuCtx, obsidianCommand: (cmdId: string) => { name: string; run: () => void } | null): Menu {
        const menu = new Menu();
        for (const spec of parseMenuConfig(settings.contextMenu || DEFAULT_CONTEXT_MENU)) {
                if (spec.kind === 'sep') { menu.addSeparator(); continue; }
                if (spec.kind === 'group') {
                        // 纯图标组（一行多个小图标）：组内任一成员需要选区而无选区 → 整组隐藏
                        const acts = spec.ids.map(id => VT_MENU_ACTIONS[id]).filter(a => !!a);
                        if (!acts.length) continue;
                        if (acts.some(a => a.needsSel) && !(ctx.sel && ctx.sel.rects.length)) continue;
                        menu.addItem((i) => {
                                i.setTitle('');
                                const wrap = i.titleEl.createSpan({ cls: 'vt-menu-icons' });
                                acts.forEach((act, idx) => {
                                        if (idx > 0) wrap.createSpan({ cls: 'vt-menu-icon-sep' });
                                        const btn = wrap.createSpan({
                                                cls: 'vt-menu-icon' + (act.checked?.(ctx) ? ' is-checked' : ''),
                                                attr: { 'aria-label': t(act.zh, act.en) },
                                        });
                                        setIcon(btn, act.icon || 'circle');
                                        btn.addEventListener('click', (ev) => {
                                                ev.stopPropagation();
                                                menu.close();
                                                act.exec(ctx);
                                        });
                                });
                        });
                        continue;
                }
                if (spec.id.startsWith('cmd:')) {
                        const cmd = obsidianCommand(spec.id.slice(4));
                        if (!cmd) continue; // 命令不存在（被禁用/卸载）：跳过
                        menu.addItem(i => i.setTitle(cmd.name).setIcon(spec.icon || 'lucide-terminal').onClick(() => cmd.run()));
                        continue;
                }
                const act = VT_MENU_ACTIONS[spec.id];
                if (!act) continue; // 未知 id：跳过
                if (act.needsSel && !(ctx.sel && ctx.sel.rects.length)) continue;
                menu.addItem(i => {
                        i.setTitle(t(act.zh, act.en)).setIcon(spec.icon || act.icon);
                        if (act.checked?.(ctx)) i.setChecked(true);
                        i.onClick(() => act.exec(ctx));
                });
        }
        return menu;
}

function showCellMenu(
        e: MouseEvent,
        data: VtData,
        r: number,
        c: number,
        toolbar: Toolbar,
        flushCell: () => void,
        onCommit: (shift?: FocusShift) => void,
        setMode: (mode: VtMode) => void,
        sel: SelOps | null,
        settings: VtSettings,
        obsidianCommand: (cmdId: string) => { name: string; run: () => void } | null,
) {
        const grid = data.rows;
        const apply = (fn: () => void, shift?: FocusShift) => {
                flushCell();
                fn();
                onCommit(shift);
        };
        const focusR = () => (document.activeElement instanceof HTMLElement
                ? parseInt(document.activeElement.dataset.vtR ?? '-1', 10) : -1);
        const focusC = () => (document.activeElement instanceof HTMLElement
                ? parseInt(document.activeElement.dataset.vtC ?? '-1', 10) : -1);
        const ctx: MenuCtx = { r, c, grid, data, apply, sel, setMode, focusR, focusC };
        buildCellMenu(settings, ctx, obsidianCommand).showAtMouseEvent(e);
}

function isWikiLinkInsideBackticks(text: string, matchIndex: number): boolean {
        const before = text.slice(0, matchIndex);
        const tickCount = (before.match(/`/g) ?? []).length;
        return tickCount % 2 === 1;
}