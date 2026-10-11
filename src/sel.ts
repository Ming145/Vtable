/**
 * sel.ts — 单元格框选
 * 选区数据模型（合并格归一化）+ 视觉覆盖层（主题色圆角整体外框 + 浅半透明底色）
 *
 * 视觉方案：单个 SVG path 同时承担底色与外框——
 *   fill（evenodd）= 半透明底色，stroke = 联合轮廓外框。
 * 联合轮廓由「有向边消抵」算法生成：邻接单元格的公共边互相抵消，
 * 剩余边串联成闭合环，转角处用二次贝塞尔做圆角。
 */

import { visible } from './builder';
import type { Grid } from './builder';

/** 选区矩形（grid 坐标，含端点；已合并格归一化） */
export interface SelRect {
        r1: number; c1: number; r2: number; c2: number;
        /** 用户原始框选范围（normalizeSelRect 沿合并格扩展前）——整行/整列判定用，
         *  避免表头跨全列合并格把单列选区撑成"跨全列"→ 误判整行 → 选列删行 */
        rawR1?: number; rawC1?: number; rawR2?: number; rawC2?: number;
}

/** 把当前选区作为整块操作对象的批量操作入口（render.ts 提供，浮窗/右键菜单消费） */
export interface SelOps {
        readonly rects: SelRect[];
        insRowAbove(): void;
        insRowBelow(): void;
        insColLeft(): void;
        insColRight(): void;
        delRows(): void;
        delCols(): void;
        merge(): void;
        split(): void;
        bold(): void;
        italic(): void;
        fontStep(delta: number): void;
        /** 设置选区水平对齐 */
        align(mode: 'l' | 'c' | 'r'): void;
        /** 设置选区垂直对齐（t=顶/m=中/b=底） */
        alignV(mode: 't' | 'm' | 'b'): void;
        /** 设置选区底色（null = 清除） */
        setColor(color: string | null): void;
        /** 清空选区内容（不动结构） */
        clearContent(): void;
        /** 打开取色弹窗选底色 */
        pickColor(): void;
}

/** 结构操作后的聚焦恢复修正：坐标平移 + 是否重置光标（bug2） */
export interface FocusShift {
        dr?: number;
        dc?: number;
        /** 目标格内容已变（合并/被删顶替）时光标落格首，不保留原偏移 */
        resetCaret?: boolean;
}

export type SelOpKind =
        'insRowAbove' | 'insRowBelow' | 'insColLeft' | 'insColRight'
        | 'delRows' | 'delCols' | 'merge' | 'split' | 'bold' | 'italic';

/** slot (r,c) → 覆盖它的合并块锚点坐标 */
export type AnchorIndex = Map<string, { r: number; c: number }>;

export function buildAnchorIndex(grid: Grid): AnchorIndex {
        const idx: AnchorIndex = new Map();
        for (let r = 0; r < grid.length; r++) {
                for (let c = 0; c < grid[r].length; c++) {
                        const cd = grid[r]![c]!;
                        if (!visible(cd)) continue;
                        for (let dr = 0; dr < cd.rs; dr++) {
                                for (let dc = 0; dc < cd.cs; dc++) {
                                        idx.set(`${r + dr},${c + dc}`, { r, c });
                                }
                        }
                }
        }
        return idx;
}

/**
 * 把矩形扩展到完整覆盖其涉及的所有合并块
 * （选中合并格任意部分 = 选中整个合并格）
 */
export function normalizeSelRect(rect: SelRect, grid: Grid, idx: AnchorIndex): SelRect {
        const out: SelRect = { r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 };
        // 保留原始框选范围（扩展前）：整行/整列判定以此为准
        out.rawR1 = rect.r1; out.rawC1 = rect.c1; out.rawR2 = rect.r2; out.rawC2 = rect.c2;
        const maxIter = grid.length + (grid[0]?.length ?? 0) + 4;
        for (let iter = 0; iter < maxIter; iter++) {
                let grew = false;
                for (let r = out.r1; r <= out.r2; r++) {
                        for (let c = out.c1; c <= out.c2; c++) {
                                const a = idx.get(`${r},${c}`);
                                if (!a) continue;
                                const cd = grid[a.r]?.[a.c];
                                if (!cd) continue;
                                const ar2 = a.r + cd.rs - 1;
                                const ac2 = a.c + cd.cs - 1;
                                if (a.r < out.r1) { out.r1 = a.r; grew = true; }
                                if (a.c < out.c1) { out.c1 = a.c; grew = true; }
                                if (ar2 > out.r2) { out.r2 = ar2; grew = true; }
                                if (ac2 > out.c2) { out.c2 = ac2; grew = true; }
                        }
                }
                if (!grew) break;
        }
        return out;
}

export function rectContains(rc: SelRect, r: number, c: number): boolean {
        return r >= rc.r1 && r <= rc.r2 && c >= rc.c1 && c <= rc.c2;
}

/** 选区覆盖的行/列 → 连续区段列表（升序） */
export function runsFromRects(rects: SelRect[], axis: 'rows' | 'cols'): Array<{ start: number; end: number }> {
        const set = new Set<number>();
        for (const rc of rects) {
                const from = axis === 'rows' ? rc.r1 : rc.c1;
                const to = axis === 'rows' ? rc.r2 : rc.c2;
                for (let v = from; v <= to; v++) set.add(v);
        }
        const sorted = Array.from(set).sort((a, b) => a - b);
        const runs: Array<{ start: number; end: number }> = [];
        for (const v of sorted) {
                const last = runs[runs.length - 1];
                if (last && v === last.end + 1) last.end = v;
                else runs.push({ start: v, end: v });
        }
        return runs;
}

/** 多个选区的外包矩形 */
export function unionSelBounds(rects: SelRect[]): SelRect {
        let r1 = Infinity, c1 = Infinity, r2 = -Infinity, c2 = -Infinity;
        for (const rc of rects) {
                if (rc.r1 < r1) r1 = rc.r1;
                if (rc.c1 < c1) c1 = rc.c1;
                if (rc.r2 > r2) r2 = rc.r2;
                if (rc.c2 > c2) c2 = rc.c2;
        }
        return { r1, c1, r2, c2 };
}

/** 选区并集是否为实心矩形（外包框内没有空洞）——非实心时不允许整块合并 */
export function isSolidUnion(rects: SelRect[]): boolean {
        if (!rects.length) return false;
        const b = unionSelBounds(rects);
        for (let r = b.r1; r <= b.r2; r++) {
                for (let c = b.c1; c <= b.c2; c++) {
                        if (!rects.some(rc => rectContains(rc, r, c))) return false;
                }
        }
        return true;
}

/* ===== 像素级联合轮廓 ===== */

interface Pt { x: number; y: number; }
interface PxRect { x: number; y: number; x2: number; y2: number; }

const n1 = (n: number): number => Math.round(n * 10) / 10;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 把 1px 内的邻近坐标吸附为同一值，保证邻接单元格公共边可精确抵消 */
function buildSnap(values: number[]): Map<number, number> {
        const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
        const map = new Map<number, number>();
        let i = 0;
        while (i < uniq.length) {
                let j = i;
                while (j + 1 < uniq.length && uniq[j + 1]! - uniq[j]! <= 1) j++;
                const rep = Math.round(uniq.slice(i, j + 1).reduce((s, v) => s + v, 0) / (j - i + 1));
                for (let k = i; k <= j; k++) map.set(uniq[k]!, rep);
                i = j + 1;
        }
        return map;
}

/** 去除闭合环上的共线冗余顶点 */
function compressCollinear(pts: Pt[]): Pt[] {
        const n = pts.length;
        if (n < 3) return pts;
        const out: Pt[] = [];
        for (let i = 0; i < n; i++) {
                const a = pts[(i - 1 + n) % n]!;
                const b = pts[i]!;
                const c = pts[(i + 1) % n]!;
                const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
                if (cross === 0) continue; // 共线：跳过 b
                out.push(b);
        }
        return out;
}

/** 单个闭合环 → 圆角路径（转角用 Q 贝塞尔） */
function roundedLoopPath(pts: Pt[], radius: number): string {
        const cp = compressCollinear(pts);
        const n = cp.length;
        if (n < 3) return '';
        let d = '';
        for (let i = 0; i < n; i++) {
                const prev = cp[(i - 1 + n) % n]!;
                const cur = cp[i]!;
                const next = cp[(i + 1) % n]!;
                const d1 = dist(prev, cur);
                const d2 = dist(cur, next);
                if (d1 === 0 || d2 === 0) return '';
                const r = Math.min(radius, d1 / 2, d2 / 2);
                const a = { x: cur.x + (prev.x - cur.x) * (r / d1), y: cur.y + (prev.y - cur.y) * (r / d1) };
                const b = { x: cur.x + (next.x - cur.x) * (r / d2), y: cur.y + (next.y - cur.y) * (r / d2) };
                d += (i === 0 ? `M ${n1(a.x)} ${n1(a.y)} ` : `L ${n1(a.x)} ${n1(a.y)} `);
                d += `Q ${n1(cur.x)} ${n1(cur.y)} ${n1(b.x)} ${n1(b.y)} `;
        }
        return d + 'Z';
}

interface Seg { from: Pt; to: Pt; }

/**
 * 矩形并集 → 轮廓路径。
 * 有向边消抵：外边按顺时针取正向，相邻矩形的公共边互为反向、成对抵消；
 * 断点碎片化保证部分重叠的边也能正确抵消。
 */
export function unionOutlinePath(
        pxRects: Array<{ x: number; y: number; w: number; h: number }>,
        radius = 5,
): string {
        const snapped = pxRects
                .filter(r => r.w > 0.5 && r.h > 0.5)
                .map(r => ({ x: r.x, y: r.y, x2: r.x + r.w, y2: r.y + r.h }));
        if (!snapped.length) return '';

        const snapX = buildSnap(snapped.flatMap(r => [r.x, r.x2]));
        const snapY = buildSnap(snapped.flatMap(r => [r.y, r.y2]));
        const rects: PxRect[] = [];
        for (const r of snapped) {
                const x = snapX.get(r.x)!, x2 = snapX.get(r.x2)!, y = snapY.get(r.y)!, y2 = snapY.get(r.y2)!;
                if (x2 > x && y2 > y) rects.push({ x, x2, y, y2 });
        }
        if (!rects.length) return '';

        // 所有断点坐标
        const xsAll = new Set<number>();
        const ysAll = new Set<number>();
        for (const r of rects) { xsAll.add(r.x); xsAll.add(r.x2); ysAll.add(r.y); ysAll.add(r.y2); }
        const xs = Array.from(xsAll).sort((a, b) => a - b);
        const ys = Array.from(ysAll).sort((a, b) => a - b);

        // 有向边计数：同键正向 +1 / 反向 -1；和为 0 的即被抵消的内部边
        const counts = new Map<string, number>();
        const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
                const forward = x1 < x2 || (x1 === x2 && y1 < y2);
                const k = forward ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
                counts.set(k, (counts.get(k) ?? 0) + (forward ? 1 : -1));
        };
        const addH = (xa: number, xb: number, y: number, dir: 1 | -1) => {
                const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
                const pts = [lo];
                for (const v of xs) if (v > lo && v < hi) pts.push(v);
        (pts as number[]).push(hi);
                for (let i = 0; i + 1 < pts.length; i++) {
                        const a = pts[i]!, b = pts[i + 1]!;
                        if (dir > 0) addSeg(a, y, b, y); else addSeg(b, y, a, y);
                }
        };
        const addV = (ya: number, yb: number, x: number, dir: 1 | -1) => {
                const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
                const pts = [lo];
                for (const v of ys) if (v > lo && v < hi) pts.push(v);
        (pts as number[]).push(hi);
                for (let i = 0; i + 1 < pts.length; i++) {
                        const a = pts[i]!, b = pts[i + 1]!;
                        if (dir > 0) addSeg(x, a, x, b); else addSeg(x, b, x, a);
                }
        };
        for (const r of rects) {
                addH(r.x, r.x2, r.y, 1);    // 上边 →
                addV(r.y, r.y2, r.x2, 1);   // 右边 ↓
                addH(r.x2, r.x, r.y2, -1);  // 下边 ←
                addV(r.y2, r.y, r.x, -1);   // 左边 ↑
        }

        // 剩余边 = 联合轮廓
        const segs: Seg[] = [];
        for (const [k, n] of counts) {
                if (n === 0) continue;
                const parts = k.split(',');
                const p1 = { x: Number(parts[0]), y: Number(parts[1]) };
                const p2 = { x: Number(parts[2]), y: Number(parts[3]) };
                segs.push(n > 0 ? { from: p1, to: p2 } : { from: p2, to: p1 });
        }
        if (!segs.length) return '';

        // 串联成闭合环
        const byStart = new Map<string, Seg[]>();
        const pkey = (p: Pt) => `${p.x},${p.y}`;
        for (const s of segs) {
                const arr = byStart.get(pkey(s.from));
                if (arr) arr.push(s);
                else byStart.set(pkey(s.from), [s]);
        }
        const used = new Set<Seg>();
        const loops: Pt[][] = [];
        for (const s0 of segs) {
                if (used.has(s0)) continue;
                const loop: Pt[] = [];
                let seg: Seg = s0;
                let guard = 0;
                let open = false;
                while (guard++ < 100000) {
                        used.add(seg);
                        loop.push(seg.from);
                        if (seg.to.x === s0.from.x && seg.to.y === s0.from.y) break; // 闭环
                        const cands = (byStart.get(pkey(seg.to)) ?? []).filter(s => !used.has(s));
                        if (!cands.length) { open = true; break; }
                        // 优先转弯（右转 > 左转 > 直行），保持外轮廓
                        const inDx = seg.to.x - seg.from.x;
                        const inDy = seg.to.y - seg.from.y;
                        let best = cands[0]!;
                        let bestScore = -Infinity;
                        for (const cand of cands) {
                                const dx = cand.to.x - cand.from.x;
                                const dy = cand.to.y - cand.from.y;
                                const cross = inDx * dy - inDy * dx;
                                const score = cross > 0 ? 2 : cross < 0 ? 1 : 0;
                                if (score > bestScore) { bestScore = score; best = cand; }
                        }
                        seg = best;
                }
                if (!open && loop.length >= 4) loops.push(loop);
        }

        return loops.map(l => roundedLoopPath(l, radius)).filter(Boolean).join(' ');
}

/* ===== 视觉覆盖层 ===== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 选区覆盖层：挂在 .vt-table-wrap 内的绝对定位层（随内容滚动），
 * 一个 SVG path 同时画底色（fill）与整体外框（stroke）。
 *
 * 几何三原则（修"选框缩进/边缘裁切"）：
 * 1. 全部用视口坐标（getBoundingClientRect 分数值）计算层位置与路径——
 *    不再混用 offsetWidth/offsetLeft（整数布局值）：页面缩放/分数 DPR 下两套
 *    坐标系有比例差，混用会让选框偏离单元格（离原点越远偏得越多）；
 * 2. viewBox 四周留 BLEED 出血：贴边选区的描边一半在表格范围外，
 *    紧贴 viewBox 边界的描边会被 SVG 视口本身裁掉（overflow:visible 也救不全）；
 * 3. 选区可见期间 rAF 轻量巡检：表格几何（相对 wrap）或首个选中格漂移
 *    → 全量重绘。渲染晚到（图片/待办/字体加载改变行列尺寸）不再留下过期选框。
 */
export class SelOverlay {
        private layer: HTMLElement | null = null;
        private svg: SVGSVGElement | null = null;
        private path: SVGPathElement | null = null;
        private rects: SelRect[] = [];
        private cellMap: HTMLTableCellElement[][] = [];
        private ro: ResizeObserver | null = null;
        /** 巡检定时器（选区可见期间运行） */
        private rafId = 0;
        /** 最近一次定位时的几何快照（表格相对 wrap，视口坐标） */
        private geo: { left: number; top: number; width: number; height: number } | null = null;
        /** 描边一半 + 圆角余量的出血边距 */
        private static readonly BLEED = 8;

        constructor(private wrap: HTMLElement, private table: HTMLTableElement) {
                this.ro = new ResizeObserver(() => {
                        if (!this.table.isConnected) { this.ro?.disconnect(); return; }
                        if (this.rects.length) this.redraw();
                });
                this.ro.observe(table);
                this.ro.observe(wrap);
        }

        update(rects: SelRect[], cellMap: HTMLTableCellElement[][]) {
                this.rects = rects;
                this.cellMap = cellMap;
                this.redraw();
                this.scheduleLiveSync();
        }

        destroy() {
                this.stopLiveSync();
                this.ro?.disconnect();
                this.ro = null;
                this.layer?.remove();
                this.layer = null;
        }

        private stopLiveSync() {
                if (this.rafId) {
                        window.cancelAnimationFrame(this.rafId);
                        this.rafId = 0;
                }
        }

        /** 选区可见期间每帧巡检：分两条路径
         *  1) 表格视口位移（滚动/缩放/外层布局）→ 只同步层位置（fixed 层不随内容滚动，逐帧贴回）；
         *  2) 首个选中格相对表格漂移（列宽/行高再分配，渲染晚到）→ 全量重绘 */
        private scheduleLiveSync() {
                this.stopLiveSync();
                const tick = () => {
                        this.rafId = 0;
                        if (!this.rects.length || !this.table.isConnected || !this.layer) return;
                        const tRect = this.table.getBoundingClientRect();
                        const g = this.geo;
                        const posMoved = !!g && (Math.abs(g.left - tRect.left) > 0.5 || Math.abs(g.top - tRect.top) > 0.5);
                        const sizeChanged = !g
                                || Math.abs(g.width - tRect.width) > 0.5 || Math.abs(g.height - tRect.height) > 0.5;
                        if (sizeChanged) {
                                this.redraw(); // 尺寸变化必然伴随内部重排 → 全量
                        } else if (posMoved) {
                                this.placeLayer(); // 纯位移：同步层位置即可（path 相对表格仍有效）
                        } else {
                                // 首个选中格相对表格的漂移检测
                                let cellMoved = false;
                                outer: for (const rect of this.rects) {
                                        for (let r = rect.r1; r <= rect.r2; r++) {
                                                for (let c = rect.c1; c <= rect.c2; c++) {
                                                        const td = this.cellMap[r]?.[c];
                                                        if (!td) continue;
                                                        const b = td.getBoundingClientRect();
                                                        if (Math.abs((b.left - tRect.left) - this.cellAnchor.x) > 0.5
                                                                || Math.abs((b.top - tRect.top) - this.cellAnchor.y) > 0.5) {
                                                                cellMoved = true;
                                                        }
                                                        break outer;
                                                }
                                        }
                                }
                                if (cellMoved) {
                                        this.redraw(); // redraw 内含 placeLayer 更新快照；处理完继续巡检
                                }
                        }
                        this.rafId = window.requestAnimationFrame(tick);
                };
                this.rafId = window.requestAnimationFrame(tick);
        }
        /** 首个选中格相对表格的锚点（巡检漂移检测用） */
        private cellAnchor: { x: number; y: number } = { x: -1, y: -1 };

        private redraw() {
                if (!this.rects.length) {
                        this.stopLiveSync();
                        if (this.layer) this.layer.setCssProps({ display: 'none' });
                        return;
                }
                this.ensureLayer();
                const d = this.buildPath();
                if (!d) {
                        this.layer!.setCssProps({ display: 'none' });
                        return;
                }
                this.placeLayer();
                this.path!.setAttribute('d', d);
        }

        /** 层/svg 定位与尺寸：fixed 视口坐标 + BLEED 出血（描边贴边不被裁） */
        private placeLayer() {
                const tRect = this.table.getBoundingClientRect();
                const B = SelOverlay.BLEED;
                this.geo = {
                        left: tRect.left,
                        top: tRect.top,
                        width: tRect.width,
                        height: tRect.height,
                };
                const layer = this.layer!;
                layer.setCssProps({ display: 'block' });
                layer.setCssProps({ left: `${tRect.left - B}px` });
                layer.setCssProps({ top: `${tRect.top - B}px` });
                layer.setCssProps({ width: `${tRect.width + B * 2}px` });
                layer.setCssProps({ height: `${tRect.height + B * 2}px` });
                const w = Math.max(1, tRect.width + B * 2);
                const h = Math.max(1, tRect.height + B * 2);
                this.svg!.setAttribute('width', String(w));
                this.svg!.setAttribute('height', String(h));
                // viewBox 原点 = -BLEED：路径坐标系（相对表格原点）无需平移，贴边描边自然落在出血区
                this.svg!.setAttribute('viewBox', `${-B} ${-B} ${w} ${h}`);
        }

        private ensureLayer() {
                if (this.layer && this.layer.isConnected) return;
                this.layer?.remove();
                // 挂 document.body + fixed（同 vt-edge-bar/vt-drag-grip 先例）：
                // 曾挂 wrap 内 absolute——圆角模式 .vt-radius 的 overflow:hidden、HS/RC 的滚动容器
                // 都会裁掉贴边描边（“开了圆角后选框边缘被裁”的根因）；body 直挂免疫一切容器裁剪，
                // 视口坐标直接定位，滚动/缩放由活巡检逐帧跟随
                this.layer = document.body.createDiv({ cls: 'vt-sel-layer' });
                this.layer.setCssProps({ position: 'fixed' });
                this.layer.setCssProps({ pointerEvents: 'none' });
                this.layer.setCssProps({ overflow: 'visible' });
                this.layer.setCssProps({ zIndex: '1000' });
                this.svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
                this.svg.setCssProps({ overflow: 'visible' });
                this.path = document.createElementNS(SVG_NS, 'path') as unknown as SVGPathElement;
                // 主题色：纯色圆角外框 + 极浅半透明底色
                // 底色与外框用同一个 --interactive-accent 变量（部分主题没有 -rgb 变量，
                // rgba(var(--interactive-accent-rgb)) 会落到默认紫），透明度用 fill-opacity 独立控制
                this.path.setCssProps({ fill: 'var(--interactive-accent, #7c3aed)' });
                this.path.setCssProps({ fillOpacity: '0.10' });
                this.path.setCssProps({ fillRule: 'evenodd' });
                this.path.setCssProps({ stroke: 'var(--interactive-accent, #7c3aed)' });
                this.path.setCssProps({ strokeWidth: '2' });
                this.svg.appendChild(this.path);
                this.layer.appendChild(this.svg);
        }

        /** 选区矩形 → 覆盖的可见单元格像素盒（相对表格原点，视口坐标差） */
        private buildPath(): string {
                const tableRect = this.table.getBoundingClientRect();
                if (tableRect.width <= 0 || tableRect.height <= 0) return '';
                const px: Array<{ x: number; y: number; w: number; h: number }> = [];
                for (const rect of this.rects) {
                        for (let r = rect.r1; r <= rect.r2; r++) {
                                for (let c = rect.c1; c <= rect.c2; c++) {
                                        const td = this.cellMap[r]?.[c];
                                        if (!td) continue;
                                        const b = td.getBoundingClientRect();
                                        if (b.width <= 0 || b.height <= 0) continue;
                                        px.push({ x: b.left - tableRect.left, y: b.top - tableRect.top, w: b.width, h: b.height });
                                }
                        }
                }
                // 记录首个选中格锚点（巡检漂移检测用）
                if (px.length) this.cellAnchor = { x: px[0]!.x, y: px[0]!.y };
                return unionOutlinePath(px);
        }
}
