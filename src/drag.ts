/**
 * 行列自由拖动（编辑态全模式）：
 * - 行左/列上 3 点拖动符（行竖排/列横排），悬浮在表格边缘外（fixed 挂 body，同加号按钮模式，无裁剪）；
 *   光标（hover 或焦点）所在行/列才显示
 * - 该行/列存在跨向合并（行有 rs>1 覆盖、列有 cs>1 覆盖）→ 拖动符不出现；
 *   本行/列内部的合并（行内 cs、列内 rs）不影响
 * - 按住拖动符沿边缘"隐形滑条"滑动：把手跟手，表格不动，只显示主题色插入指示线
 *   （位置=鼠标所在格的最近边界，随滑动实时变化）；松手才真正插入写回；
 *   落点跨界拆散合并格子 → 指示线虚线，松手不动（等效回弹）
 * - 单击拖动符（未滑动）= 选中整行/整列；Shift+点击追加选；选区存在时同方向把手亮起
 */
import type { Grid } from './builder';
import { colCount, rowDraggable, colDraggable, colMoveBlocked, rowMoveBlocked, moveCol, moveRow } from './builder';
import { Platform } from 'obsidian';
import type { SelRect } from './sel';

export interface DragHooks {
        /** 当前焦点格（无焦点返回 null） */
        getFocused(): { r: number; c: number } | null;
        /** 程序化设置选区（additive = Shift 追加） */
        selectCells(rects: SelRect[], additive: boolean): void;
        /** 当前选区（只读快照） */
        getSelection(): SelRect[];
        /** 拖动开始（DOM 与 grid 尚一致）：宿主此刻 flush 正在编辑格的内容，此后写回才不会丢字 */
        onDragStart?(): void;
        /** 数据变更后写回源码（重渲染）。focus = 焦点格新坐标（拖动跟随修正），缺省沿用当前焦点 */
        onMutate(focus?: { r: number; c: number }): void;
}

const START_THRESHOLD = 4; // 位移超过该像素才算拖动，否则视为单击选中
// 把手热区：触屏加大触摸目标（iPad 上 16px 竖条难点中）；列把手高度增量保守——顶缘外空间与模式栏共用，过大重新出现遮挡
const _isTouch = Platform.isMobile || Platform.isTablet;
const GRIP = _isTouch ? 24 : 16;    // 把手热区边长（视口 fixed）：行把手宽度
const GRIP_COL = _isTouch ? 16 : 12; // 列把手高度：比行把手窄——列把手带（表格顶缘外）与模式栏（文档流悬于表上方）原本重叠 12px，把手 z-index 1000 盖住模式按钮导致点不到；缩小后配合模式栏抬高彻底错开
const GAP = 2;             // 悬浮于表格边缘外的间距
const EDGE_GAP_TOUCH = 26; // 触屏：列把手贴右缘时与加号右条（wrap 右缘外 2px）保持的避让间距

/** 模块级：最近一次鼠标位置（跨渲染实例）——拖动写回重渲染后恢复把手显隐（问题 4） */
let lastMouse: { x: number; y: number } | null = null;
/**
 * 模块级：上次拖动写回后的"把手应显示位置"（被拖格新位置/焦点跟随结果）。
 * 触屏（iPad）上写回重渲染后既无 pointermove（手指不动就没有事件），
 * WKWebView 里 JS 恢复焦点又常不派发 focusin → lastMouse/focusin 两条恢复路全断，把手消失。
 * 以此跨实例兜底：重渲染装配后无条件按它恢复显示，完全不依赖任何事件。
 */
let persistedRC: { r: number; c: number } | null = null;
/** 模块级：当前活跃实例的 tick uid 与清理器（重渲染时清掉旧把手/指示线） */
let activeUid: symbol | null = null;
let activeCleanup: (() => void) | null = null;

export function bindRowColDrag(
        table: HTMLTableElement,
        data: { rows: Grid; colWidths?: (number | null)[]; rowHeights?: (number | null)[] },
        wrap: HTMLElement,
        editing: boolean,
        hooks: DragHooks,
) {
        // 重渲染时先清掉上一实例的把手/指示线（模块级单例）
        activeCleanup?.();
        activeCleanup = null;

        const grid = data.rows;
        const rows = Array.from(table.querySelectorAll('tr'));
        const cols = colCount(grid);
        if (!editing || rows.length < 1 || cols < 1) return;

        // 拖动资格（渲染后缓存；写回重渲染后自动刷新）
        const rowOk = rows.map((_, r) => rowDraggable(grid, r));
        const colOk = Array.from({ length: cols }, (_, c) => colDraggable(grid, c));

        const tableRect = () => table.getBoundingClientRect();
        const wrapRect = () => wrap.getBoundingClientRect();

        /** 列 c 左缘的 x（相对表格；被 cs 覆盖时按格内均分近似） */
        function colX(c: number): number {
                const tb = tableRect();
                const td = table.querySelector<HTMLElement>(`td[data-vt-c="${c}"], th[data-vt-c="${c}"]`);
                if (td) return td.getBoundingClientRect().left - tb.left;
                const cov = Array.from(table.querySelectorAll<HTMLElement>('td,th')).find(el => {
                        const c0 = parseInt(el.dataset.vtC ?? '-1', 10);
                        const cs = (el as HTMLTableCellElement).colSpan || 1;
                        return c0 >= 0 && c0 < c && c < c0 + cs;
                });
                if (cov) {
                        const c0 = parseInt(cov.dataset.vtC ?? '0', 10);
                        const b = cov.getBoundingClientRect();
                        return b.left - tb.left + (b.width * (c - c0)) / Math.max(1, (cov as HTMLTableCellElement).colSpan || 1);
                }
                return (tb.width * c) / cols;
        }
        /** 列 c 的宽度（相对表格实测，覆盖列按分摊近似） */
        function colW(c: number): number {
                return (c >= cols ? tableRect().width : colX(c + 1)) - colX(c);
        }

        /* ===== 把手（挂 body，fixed 悬浮表格边缘外——同加号按钮模式） ===== */
        const doc = document.body;
        const rowGrips: HTMLElement[] = rows.map((tr, r) => {
                const g = doc.createDiv({ cls: 'vt-drag-grip vt-drag-row' });
                if (!rowOk[r]) g.addClass('vt-drag-off');
                return g;
        });
        const colGrips: HTMLElement[] = [];
        for (let c = 0; c < cols; c++) {
                const g = doc.createDiv({ cls: 'vt-drag-grip vt-drag-col' });
                if (!colOk[c]) g.addClass('vt-drag-off');
                colGrips.push(g);
        }
        /** 落点指示线（挂 wrap：内容坐标随滚动） */
        const dropLine = wrap.createDiv({ cls: 'vt-drop-line' });
        dropLine.style.display = 'none';

        const hideLine = () => { dropLine.style.display = 'none'; };
        const showLine = (horizontal: boolean, pos: number, cross: number, bad: boolean) => {
                dropLine.style.display = 'block';
                dropLine.classList.toggle('vt-drop-h', horizontal);
                dropLine.classList.toggle('vt-drop-bad', bad);
                if (horizontal) {
                        dropLine.style.left = '0px';
                        dropLine.style.width = `${cross}px`;
                        dropLine.style.top = `${pos}px`;
                        dropLine.style.height = '2px';
                } else {
                        dropLine.style.top = '0px';
                        dropLine.style.height = `${cross}px`;
                        dropLine.style.left = `${pos}px`;
                        dropLine.style.width = '2px';
                }
        };

        /* ===== 显隐状态：hover 优先，焦点兜底（触屏无 hover） ===== */
        let hoverRC: { r: number; c: number } | null = null;
        let focusRC: { r: number; c: number } | null = null;

        /** 把手定位（视口 fixed）：行把手悬浮行左缘外、列把手悬浮表格顶缘外。
         *  表格宽于 wrap 可视区时（第一列特别长/滚动后），把手取**该行/列可见部分的缩影**：
         *  列把手横条 = 列与可视区的交集（部分滚出 → 横条缩到可见段、自动居中于可见部分；完全滚出 → 隐藏），
         *  行把手竖条垂直方向同理；未滚动时与原样一致。tick 每帧重放，滚动自动跟随 */
        const placeGrips = () => {
                const tb = tableRect();
                const wr = wrap.getBoundingClientRect();
                // 触屏：列把手右端避让加号右条（wrap 右缘外），留出触摸空间
                const rightLimit = _isTouch ? wr.right - EDGE_GAP_TOUCH : wr.right;
                // 视口垂直边界：iPad 软键盘顶起时可视区被压缩，把手底部若超出会被键盘/视口
                // 挡住难点到（"最后一行边缘拖不到"）——同 edge-bar"吸视口底"的处理，
                // 把手可见段钳进 [0, vh]，只在真正可触碰的区域内显示
                const vh = window.innerHeight;
                rows.forEach((tr, r) => {
                        const g = rowGrips[r];
                        if (!g.classList.contains('vt-drag-on')) return;
                        const b = tr.getBoundingClientRect();
                        // 垂直可见段：行滚出视口上/下缘或键盘压缩可视区时竖条缩到可见部分，完全滚出则隐藏
                        const visT = Math.max(b.top, wr.top, 0);
                        const visB = Math.min(b.bottom, wr.bottom, vh - 2);
                        const visH = visB - visT;
                        if (visH <= 0) { g.style.display = 'none'; return; }
                        g.style.display = '';
                        // 水平：下界 = wr.left - GRIP - GAP——允许把手悬在可视区左外侧（正常悬浮语义，未滚动时原样）；
                        // 仅当表格左缘滚出视口才把把手拉回贴边（宽/长拖动符跑到编辑区左侧的修复）
                        g.style.left = `${Math.max(wr.left - GRIP - GAP, Math.min(Math.max(GAP, b.left - GRIP - GAP), wr.right - GRIP))}px`;
                        g.style.top = `${visT}px`;
                        g.style.width = `${GRIP}px`;
                        g.style.height = `${visH}px`;
                });
                colGrips.forEach((g, c) => {
                        if (!g.classList.contains('vt-drag-on')) return;
                        // fixed 定位必须用视口坐标：colX 相对表格，+ tb.left 即视口 x（此前误减 wrap.left 变成 wrap 内坐标，编辑区不在视口原点时列把手整体飘走 → 列把手"不显示"的根因）
                        // 水平可见段：列滚出视口左/右缘时横条缩到可见部分（自动居中于可见段），完全滚出则隐藏
                        const cl = colX(c) + tb.left;
                        const visL = Math.max(cl, wr.left);
                        const visR = Math.min(cl + colW(c), rightLimit);
                        const visW = visR - visL;
                        if (visW <= 0) { g.style.display = 'none'; return; }
                        g.style.display = '';
                        g.style.left = `${visL}px`;
                        g.style.top = `${Math.max(GAP, Math.min(tb.top - GRIP_COL - GAP, vh - GRIP_COL - 2))}px`;
                        g.style.width = `${visW}px`;
                        g.style.height = `${GRIP_COL}px`;
                });
        };

        /** 显隐刷新：hoverRC ?? focusRC；选区存在时同方向把手亮起 (6b)；合并覆盖行/列永不显示 (1d) */
        const apply = () => {
                const cur = hoverRC ?? focusRC;
                const showR = cur && rowOk[cur.r] ? cur.r : -1;
                const showC = cur && colOk[cur.c] ? cur.c : -1;
                rowGrips.forEach((g, r) => {
                        g.classList.toggle('vt-drag-on', r === showR);
                });
                colGrips.forEach((g, c) => g.classList.toggle('vt-drag-on', c === showC));
                // 亮灯：纯行选 → 行把手亮；纯列选 → 列把手亮 (6b)
                const sel = hooks.getSelection();
                const litRows = sel.length > 0 && sel.every(rc => rc.c1 === 0 && rc.c2 === cols - 1);
                const litCols = sel.length > 0 && sel.every(rc => rc.r1 === 0 && rc.r2 === grid.length - 1);
                rowGrips.forEach(g => g.classList.toggle('vt-drag-lit', litRows));
                colGrips.forEach(g => g.classList.toggle('vt-drag-lit', litCols));
                placeGrips();
        };

        /** 视口坐标 → 逻辑格（rs/cs 大格内分摊）。
         *  主路径 elementFromPoint 单发命中（浏览器 hit-test）：此前全量遍历所有 td 逐格
         *  getBoundingClientRect（强制 reflow），iPad 快速滑动时事件排队用旧坐标 → 把手判断错行列。
         *  命中异常（浮层遮挡等）回退遍历保底 */
        function locateAt(x: number, y: number): { r: number; c: number } | null {
                const resolve = (hit: HTMLElement | null): { r: number; c: number } | null => {
                        if (!hit) return null;
                        const r0 = parseInt(hit.dataset.vtR ?? '-1', 10);
                        const c0 = parseInt(hit.dataset.vtC ?? '-1', 10);
                        if (r0 < 0 || c0 < 0) return null;
                        const rs = (hit as HTMLTableCellElement).rowSpan > 1 ? (hit as HTMLTableCellElement).rowSpan : 1;
                        const cs = (hit as HTMLTableCellElement).colSpan > 1 ? (hit as HTMLTableCellElement).colSpan : 1;
                        const b = hit.getBoundingClientRect();
                        const r = r0 + Math.min(rs - 1, Math.floor(((y - b.top) / b.height) * rs));
                        const c = c0 + Math.min(cs - 1, Math.floor(((x - b.left) / b.width) * cs));
                        return { r: Math.max(0, r), c: Math.max(0, c) };
                };
                const probe = document.elementFromPoint(x, y);
                const hit = probe instanceof HTMLElement ? (probe.closest('td,th') as HTMLElement | null) : null;
                if (hit && table.contains(hit)) return resolve(hit);
                // 兜底：浮层/把手遮挡等导致 hit-test 落空时回退全量遍历
                let fallback: HTMLElement | null = null;
                for (const td of table.querySelectorAll<HTMLElement>('td,th')) {
                        const b = td.getBoundingClientRect();
                        if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) { fallback = td; break; }
                }
                return resolve(fallback);
        }
        function cellSpan(td: HTMLElement, axis: 'r' | 'c'): number {
                const v = axis === 'r' ? (td as HTMLTableCellElement).rowSpan : (td as HTMLTableCellElement).colSpan;
                return v > 1 ? v : 1;
        }

        // hover 追踪（拖动中跳过）+ 模块级 lastMouse（问题 4：重渲染后恢复显隐）
        // 只认本实例的把手：多表同屏时 relatedTarget 落在别的表把手上仍要正常清理
        const isOurGrip = (el: EventTarget | null): boolean => {
                const g = (el as HTMLElement | null)?.closest?.('.vt-drag-grip') as HTMLElement | null;
                return !!g && (rowGrips.includes(g) || colGrips.includes(g));
        };
        const onMove = (e: PointerEvent) => {
                lastMouse = { x: e.clientX, y: e.clientY };
                if (drag) return;
                const td = (e.target as HTMLElement).closest?.('td,th') as HTMLElement | null;
                if (td && table.contains(td)) hoverRC = locateAt(e.clientX, e.clientY);
                apply();
        };
        // 把手悬浮在表格边缘外：鼠标移入把手会触发 wrap pointerleave——目标是我们自己的把手时不隐藏
        const onLeave = (e: PointerEvent) => {
                if (isOurGrip(e.relatedTarget)) return;
                // 触屏 pointerup/pointercancel 会向 wrap 派发 pointerleave（触摸结束的合成事件）：
                // 若清掉 hoverRC，把手回退到 focusRC——而 WKWebView 焦点恢复常延迟/不派发 focusin，
                // focusRC 还是旧格 → "tap 后闪一下正确行列又跳回旧格"（再点一次才对）。
                // 触屏显隐模型 = 跟随最近一次 tap（hoverRC 长驻），tap 表格外时由 pointerdown 显式清除
                if (e.pointerType === 'touch') return;
                hoverRC = null;
                if (!drag) apply();
        };
        wrap.addEventListener('pointermove', onMove);
        wrap.addEventListener('pointerleave', onLeave);
        // 触屏 tap 即定位：WKWebView 快速切格时 JS 恢复焦点常不派发 focusin → focusRC 沿用旧值，
        // 把手显示在旧行列（"快速切换单元格把手错位"）。pointerdown 触摸必发，target 直接给行列
        wrap.addEventListener('pointerdown', (e) => {
                if (drag) return;
                const td = (e.target as HTMLElement)?.closest?.('td,th') as HTMLElement | null;
                if (!td || !table.contains(td)) {
                        // tap 表格外（段落空白/其他块）：触屏模型里 hoverRC 长驻，显式清掉让把手归位
                        if (e.pointerType === 'touch' && hoverRC) {
                                hoverRC = null;
                                apply();
                        }
                        return;
                }
                const r = parseInt(td.dataset.vtR ?? '-1', 10);
                const c = parseInt(td.dataset.vtC ?? '-1', 10);
                if (r < 0 || c < 0) return;
                hoverRC = { r, c };
                apply();
        });
        // 把手自身 hover：进入=设为对应行/列（保持显示、可点击）；离开=清（移回表格由 onMove 重新设）
        rowGrips.forEach((g, r) => {
                g.addEventListener('pointerenter', () => {
                        if (drag || !rowOk[r]) return;
                        hoverRC = { r, c: -1 }; // c:-1：只点亮本行把手，不连带 0 号列把手
                        apply();
                });
                g.addEventListener('pointerleave', (e) => {
                        if (drag || isOurGrip(e.relatedTarget)) return;
                        hoverRC = null;
                        apply();
                });
        });
        colGrips.forEach((g, c) => {
                g.addEventListener('pointerenter', () => {
                        if (drag || !colOk[c]) return;
                        hoverRC = { r: -1, c }; // r:-1：只点亮本列把手，不连带 0 号行把手
                        apply();
                });
                g.addEventListener('pointerleave', (e) => {
                        if (drag || isOurGrip(e.relatedTarget)) return;
                        hoverRC = null;
                        apply();
                });
        });
        // 焦点变化 → 触屏兜底显隐
        table.addEventListener('focusin', (e) => {
                const td = (e.target as HTMLElement).closest?.('td,th') as HTMLElement | null;
                if (!td) return;
                const r = parseInt(td.dataset.vtR ?? '-1', 10);
                const c = parseInt(td.dataset.vtC ?? '-1', 10);
                if (r >= 0 && c >= 0) { focusRC = { r, c }; if (!hoverRC) apply(); }
            });

        /* ===== 拖动（隐形滑条模型：把手跟手 + 指示线随最近边界变化，表格不动，松手才插入） ===== */
        let drag: {
                dir: 'row' | 'col';
                from: number;
                startX: number;
                startY: number;
                started: boolean;
                gripEl?: HTMLElement;
                curB: number;  // 当前指示边界（移除 from 后坐标 0..n-1）；=from 表示未离位
                shift: boolean;
                badNow: boolean; // 指示线当前停在非法落点（跨界合并）
                // 拖动开始时缓存的边界几何（表格未重排，全程稳定）
                edges: number[]; // 行/列边界数组（视口坐标）：edges[i]=第 i 行顶/列左缘，edges[n]=表格底/右缘
                axisMin: number; // 表格在该轴上的起点（视口）
                axisMax: number;
                /** 抓取点偏移：把手左/顶端相对鼠标的原始距离（placeGrips 重定位后按实际 rect 取）。
                 *  跟手 = clientX/Y - grabD——此前用"把手中心贴鼠标"（clientX-GRIP/2），把手宽度≠GRIP
                 *  （可见段缩影）时按下即跳变：按住横条右端一拖，横条整体右窜（用户报告的"突然到 10+2"） */
                grabD: number;
                /** 把手沿拖动轴的长度（拖动中恒定，可视区钳制用） */
                gripSpan: number;
        } | null = null;

        const startDrag = (e: PointerEvent, dir: 'row' | 'col', from: number, shift: boolean) => {
                // 未离焦就拖动：先把正在编辑格的 DOM 内容 flush 回 grid（此刻 DOM 与 grid 同序，写回不错位）。
                // 注意不能在 onMutate（moveCol/moveRow 之后）flush：td 的 dataset 还是旧坐标，会把内容写错格
                hooks.onDragStart?.();
                const tb = tableRect();
                let edges: number[];
                if (dir === 'col') {
                        edges = [];
                        for (let c = 0; c <= cols; c++) edges.push(colX(c) + tb.left);
                } else {
                        edges = rows.map(tr => tr.getBoundingClientRect().top);
                        edges.push(rows[rows.length - 1]!.getBoundingClientRect().bottom);
                }
                drag = {
                        dir, from, startX: e.clientX, startY: e.clientY,
                        started: false, curB: from, shift, badNow: false,
                        edges, axisMin: tb.top, axisMax: dir === 'row' ? tb.bottom : tb.bottom,
                        grabD: 0, gripSpan: dir === 'col' ? GRIP : GRIP,
                };
                if (dir === 'col') drag.gripEl = colGrips[from];
                else drag.gripEl = rowGrips[from];
                // 拖动中隐藏全部把手（只留被拖的跟手滑动）+ 指示线待命
                rowGrips.forEach(g => { if (g !== drag!.gripEl) g.classList.remove('vt-drag-on'); });
                colGrips.forEach(g => { if (g !== drag!.gripEl) g.classList.remove('vt-drag-on'); });
                // 边界可能因滚动/布局瞬时变化，重新定位一次把手（跟手基准）
                placeGrips();
                // 抓取偏移与把手实际尺寸：placeGrips 后取 rect（可见段缩影宽度≠GRIP），跟手不跳变
                const gr = drag.gripEl!.getBoundingClientRect();
                drag.grabD = dir === 'col' ? e.clientX - gr.left : e.clientY - gr.top;
                drag.gripSpan = dir === 'col' ? Math.max(gr.width, 1) : Math.max(gr.height, 1);
        };

        /** 视口 y/x → 边界 b0（0..n，n=行/列数）：鼠标落在格 i 内，靠近上边界→i、下边界→i+1（用户"隐形滑条"语义） */
        const edgeAt = (v: number): number => {
                const { edges } = drag!;
                for (let i = 0; i < edges.length - 1; i++) {
                        if (v >= edges[i] && v < edges[i + 1]) {
                                return v < (edges[i] + edges[i + 1]) / 2 ? i : i + 1;
                        }
                }
                return v < edges[0] ? 0 : edges.length - 1;
        };

        /** 边界 b（移除 from 后坐标）→ 视口位置（线所在）：b0 原坐标边界 */
        const edgeViewportPos = (b0: number): number => {
                const { edges } = drag!;
                return edges[b0];
        };

        const onGripDown = (dir: 'row' | 'col', from: number) => (e: PointerEvent) => {
                e.preventDefault();
                e.stopPropagation();
                startDrag(e, dir, from, e.shiftKey);
                window.addEventListener('pointermove', onDragMove);
                window.addEventListener('pointerup', onDragUp);
                window.addEventListener('pointercancel', onDragUp);
        };

        const onDragMove = (e: PointerEvent) => {
                if (!drag) return;
                if (!drag.started) {
                        if (Math.abs(e.clientX - drag.startX) < START_THRESHOLD && Math.abs(e.clientY - drag.startY) < START_THRESHOLD) return;
                        drag.started = true;
                }
                const g = drag.gripEl;
                const wr = wrapRect();
                if (drag.dir === 'col') {
                        // 把手跟手 = 鼠标位置 - 抓取偏移（按下瞬间不跳变），钳制在 wrap 可视区水平范围内
                        g!.style.left = `${Math.max(wr.left, Math.min(e.clientX - drag.grabD, wr.right - drag.gripSpan))}px`;
                        const b0 = edgeAt(e.clientX);
                        let b = b0 <= drag.from ? b0 : b0 - 1;
                        b = Math.max(0, Math.min(cols - 1, b));
                        const bad = colMoveBlocked(grid, drag.from, b);
                        drag.badNow = bad;
                        drag.curB = b;
                        // dropLine 挂在滚动容器内（absolute 随内容滚）：视口相对坐标要补 scrollLeft 才能对齐内容
                        const lx = edgeViewportPos(b0) - wr.left + wrap.scrollLeft;
                        showLine(false, lx, table.offsetHeight, bad);
                } else {
                        // 行把手：垂直跟手（同款抓取偏移），水平位置由 placeGrips 保持贴左缘
                        g!.style.top = `${Math.max(wr.top, Math.min(e.clientY - drag.grabD, wr.bottom - drag.gripSpan))}px`;
                        const b0 = edgeAt(e.clientY);
                        let b = b0 <= drag.from ? b0 : b0 - 1;
                        b = Math.max(0, Math.min(rows.length - 1, b));
                        const bad = rowMoveBlocked(grid, drag.from, b);
                        drag.badNow = bad;
                        drag.curB = b;
                        const ly = edgeViewportPos(b0) - wr.top + wrap.scrollTop;
                        showLine(true, ly, table.offsetWidth, bad);
                }
        };

        const onDragUp = (e: PointerEvent) => {
                window.removeEventListener('pointermove', onDragMove);
                window.removeEventListener('pointerup', onDragUp);
                window.removeEventListener('pointercancel', onDragUp);
                const d = drag;
                drag = null;
                hideLine();
                if (!d) return;
                if (!d.started) {
                        // 单击 → 选中整行/整列 (6a/6b)
                        const rect: SelRect = d.dir === 'col'
                                ? { r1: 0, c1: d.from, r2: grid.length - 1, c2: d.from }
                                : { r1: d.from, c1: 0, r2: d.from, c2: cols - 1 };
                        hooks.selectCells([rect], d.shift);
                        apply();
                        return;
                }
                if (d.badNow) {
                        // 松手时停在非法落点（跨界拆散合并格子）→ 不动（表格从未重排，即回弹语义）(4a)
                        apply();
                        return;
                }
                let focusNew: { r: number; c: number } | undefined;
                const focusNow = hooks.getFocused();
                if (focusNow) {
                        const a0 = d.dir === 'col' ? focusNow.c : focusNow.r;
                        let a1: number;
                        if (a0 === d.from) a1 = d.curB;
                        else {
                                a1 = a0 < d.from ? a0 : a0 - 1;
                                if (a1 >= d.curB) a1 += 1;
                        }
                        focusNew = d.dir === 'col' ? { r: focusNow.r, c: a1 } : { r: a1, c: focusNow.c };
                }
                // 触屏兜底：记住写回后把手应显示的位置（有焦点=焦点跟随格；无焦点=被拖行列的表头格）
                persistedRC = focusNow
                        ? focusNew!
                        : d.dir === 'col' ? { r: 0, c: d.curB } : { r: d.curB, c: 0 };
                if (d.dir === 'col') {
                        moveCol(grid, d.from, d.curB);
                        if (data.colWidths) {
                                const w = data.colWidths.splice(d.from, 1)[0];
                                if (w !== undefined) data.colWidths.splice(d.curB, 0, w);
                        }
                } else {
                        moveRow(grid, d.from, d.curB);
                        if (data.rowHeights) {
                                const h = data.rowHeights.splice(d.from, 1)[0];
                                if (h !== undefined) data.rowHeights.splice(d.curB, 0, h);
                        }
                }
                hooks.onMutate(focusNew);
                apply();
        };

        for (let r = 0; r < rows.length; r++) {
                if (rowOk[r]) rowGrips[r].addEventListener('pointerdown', onGripDown('row', r));
        }
        for (let c = 0; c < cols; c++) {
                if (colOk[c]) colGrips[c].addEventListener('pointerdown', onGripDown('col', c));
        }

        /* ===== rAF 同步：显隐时位置每帧校准（滚动/布局变化）；实例被替换或销毁时自清理 ===== */
        const cleanup = () => {
                rowGrips.forEach(g => g.remove());
                colGrips.forEach(g => g.remove());
                dropLine.remove();
        };
        activeCleanup = cleanup;
        const uid = Symbol('vtDrag');
        activeUid = uid;
        const tick = () => {
                requestAnimationFrame(tick);
                if (activeUid !== uid) return; // 已被新实例接管：本实例 tick 停止（把手由 cleanup 移除）
                if (!table.isConnected) { cleanup(); return; }
                if (drag) return; // 拖动中把手位置由 onDragMove 跟手控制，每帧校准会把把手拉回边缘（"把手不跟手"根因）
                if (rowGrips.some(g => g.classList.contains('vt-drag-on')) || colGrips.some(g => g.classList.contains('vt-drag-on'))) {
                        placeGrips();
                }
        };
        requestAnimationFrame(tick);
        const onScroll = () => { if (!drag && rowGrips.some(g => g.classList.contains('vt-drag-on'))) placeGrips(); };
        wrap.addEventListener('scroll', onScroll, { passive: true });

        // 重渲染后恢复把手显隐（三条路按优先级）：
        // 1) persistedRC —— 上次拖动写回的落点（触屏/iPad 兜底：手指不动无事件也能显示）
        // 2) activeElement 焦点格 —— 焦点已恢复成功时的证据（不依赖 focusin 是否派发）
        // 3) lastMouse —— 鼠标悬停位置（桌面问题 4）
        if (persistedRC) {
                focusRC = { ...persistedRC };
        }
        const ae = document.activeElement as HTMLElement | null;
        if (ae && table.contains(ae) && ae.dataset?.vtR != null && ae.dataset?.vtC != null) {
                const fr = parseInt(ae.dataset.vtR ?? '-1', 10);
                const fc = parseInt(ae.dataset.vtC ?? '-1', 10);
                if (fr >= 0 && fc >= 0) focusRC = { r: fr, c: fc };
        }
        if (lastMouse) {
                const wr = wrap.getBoundingClientRect();
                const tb = tableRect();
                if (lastMouse.x >= wr.left && lastMouse.x <= wr.right && lastMouse.y >= Math.min(wr.top, tb.top - GRIP_COL - GAP) && lastMouse.y <= wr.bottom) {
                        hoverRC = locateAt(lastMouse.x, lastMouse.y);
                }
        }
        if (hoverRC || focusRC) apply();
}
