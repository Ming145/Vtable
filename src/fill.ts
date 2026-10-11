/**
 * fill.ts — 自动填充（桌面端专属）
 *
 * 交互（用户定稿 2026-10-05）：
 * - 选中单元格时，右下角出现贴边小三角（填充柄，类似拖动符的观感）；
 * - 按住沿行/列方向拖动，每经过一个单元格，该单元格右下角同时出现一个小三角
 *   （起点柄 + 经过格三角，A1 拖到 A7 共七个三角）；
 * - 松手即填充：纯文本=复制；纯数字=递增/递减逐个填充（松手后在填充末端格旁
 *   弹出小选择框，浮窗式跳出动画，可切换递增/递减）；文本+数字=文本复制、数字递增/递减；
 * - 特殊序列（星期一~星期日、一月~十二月、中英文星期/月份）按一轮大小循环填充；
 * - 移动端不创建（render.ts 按平台判定）。
 *
 * 实现要点：
 * - 柄/三角/选择框全部 fixed 挂 body（同加号按钮模式，无容器裁剪）；
 * - 拖动用 pointer capture，elementFromPoint 命中 td 后按主方向投影到行/列轴；
 * - 序列生成为纯函数（parseStart/genSeries），可独立单测。
 */

import { t } from './i18n';

export interface FillDeps {
        /** grid 坐标 → 单元格 DOM（含 th；不存在返回 null） */
        cellTd(r: number, c: number): HTMLElement | null;
        /** grid 坐标 → 单元格源文本 */
        cellValue(r: number, c: number): string;
        /** grid 坐标是否为可见锚点格（合并占位格为 false） */
        cellVisible(r: number, c: number): boolean;
        /** 把正在编辑的格内容落盘（保证起点值新鲜） */
        flushActive(): void;
        /** 批量写入并提交重渲染（含清空选区）；anchor=填充起点格，重渲染后光标回到它（表格不失焦） */
        applyFill(writes: { r: number; c: number; v: string }[], anchor: { r: number; c: number }): void;
}

/* ==================== 序列识别与生成（纯函数） ==================== */

/** 循环序列表：星期（中文两种写法）、月份（中文/数字）、英文星期、英文月份（含缩写） */
const CYCLES: { words: string[]; aliases?: Record<string, number> }[] = [
        {
                words: ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
                aliases: { 星期天: 6 },
        },
        {
                words: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
                aliases: { 周天: 6 },
        },
        { words: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'] },
        { words: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] },
        {
                words: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
                aliases: { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 },
        },
        {
                words: ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'],
                aliases: {
                        Jan: 0, Feb: 1, Mar: 2, Apr: 3, Jun: 5, Jul: 6,
                        Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11,
                },
        },
];

export type Series =
        | { kind: 'cycle'; list: string[]; idx: number }
        | { kind: 'date'; idx: number; year: number; yearLen: number }
        | { kind: 'num'; v: number; dec: number; pad: number }
        | { kind: 'mix'; pre: string; v: number; pad: number; suf: string }
        | { kind: 'copy' };

/** 数字格式化：保留原小数位与前导零位宽 */
const fmtNum = (v: number, dec: number, pad: number): string => {
        let s = dec > 0 ? v.toFixed(dec) : String(v);
        if (pad > 0) {
                const dot = s.indexOf('.');
                const ip = dot === -1 ? s : s.slice(0, dot);
                const fp = dot === -1 ? '' : s.slice(dot);
                s = ip.padStart(pad, '0') + fp;
        }
        return s;
};

/** 闰年判断 */
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 指定年某月的天数（m: 1~12）——闰年由年份决定（2 月 29 天） */
const monthDays = (m: number, y: number): number => new Date(y, m, 0).getDate();

/** 识别起始值类型（优先级：循环序列 > 日期 > 纯数字 > 文本+数字 > 纯文本复制）。
 *  year：日期序列按此年判闰与取模（默认当前年，测试可注入固定年） */
export function parseStart(v0: string, year: number = new Date().getFullYear()): Series {
        // 1. 循环序列：中文精确匹配；英文大小写不敏感
        for (const cyc of CYCLES) {
                let i = cyc.words.indexOf(v0);
                if (i >= 0) return { kind: 'cycle', list: cyc.words, idx: i };
                if (cyc.aliases && v0 in cyc.aliases) {
                        return { kind: 'cycle', list: cyc.words, idx: cyc.aliases[v0]! };
                }
                if (/[a-zA-Z]/.test(v0)) {
                        const lower = v0.toLowerCase();
                        i = cyc.words.findIndex(w => w.toLowerCase() === lower);
                        if (i >= 0) return { kind: 'cycle', list: cyc.words, idx: i };
                        if (cyc.aliases) {
                                for (const [alias, idx] of Object.entries(cyc.aliases)) {
                                        if (alias.toLowerCase() === lower) {
                                                return { kind: 'cycle', list: cyc.words, idx: idx! };
                                        }
                                }
                        }
                }
        }
        // 2. 日期序列：M月D日（1月1日~12月31日按当年日历循环，闰年含 2月29日）
        const md = v0.match(/^(\d{1,2})月(\d{1,2})日$/);
        if (md) {
                const mo = parseInt(md[1]!, 10);
                const day = parseInt(md[2]!, 10);
                if (mo >= 1 && mo <= 12 && day >= 1 && day <= monthDays(mo, year)) {
                        let idx = 0;
                        for (let m = 1; m < mo; m++) idx += monthDays(m, year);
                        idx += day - 1;
                        return { kind: 'date', idx, year, yearLen: isLeap(year) ? 366 : 365 };
                }
        }
        // 3. 纯数字（可带正负号与小数）
        const m = v0.match(/^[+-]?\d+(\.\d+)?$/);
        if (m) {
                const dec = m[1] ? m[1].length - 1 : 0;
                const ip = v0.split('.')[0]!.replace(/^[+-]/, '');
                const pad = ip.length > 1 && ip[0] === '0' ? ip.length : 0;
                return { kind: 'num', v: parseFloat(v0), dec, pad };
        }
        // 4. 文本+数字（尾部连续数字递增递减，其余原样复制；"3天"/"文本1"/"item12" 都算）
        const mm = v0.match(/^(.*?)(\d+)(\D*)$/);
        if (mm) {
                const digits = mm[2]!;
                const pad = digits.length > 1 && digits[0] === '0' ? digits.length : 0;
                return { kind: 'mix', pre: mm[1]!, v: parseInt(digits, 10), pad, suf: mm[3]! };
        }
        return { kind: 'copy' };
}

/** 天数索引（0 起始的当年第几天）→ M月D日 */
const fmtDate = (doy: number, year: number): string => {
        let m = 1;
        while (doy >= monthDays(m, year)) {
                doy -= monthDays(m, year);
                m++;
        }
        return `${m}月${doy + 1}日`;
};

/** 生成填充序列：n 格，sign=1 递增 / -1 递减；循环/日期序列按一轮大小取模循环 */
export function genSeries(v0: string, n: number, sign: 1 | -1, year: number = new Date().getFullYear()): string[] {
        const s = parseStart(v0, year);
        const out: string[] = [];
        for (let k = 1; k <= n; k++) {
                if (s.kind === 'cycle') {
                        const len = s.list.length;
                        out.push(s.list[((s.idx + sign * k) % len + len) % len]!);
                } else if (s.kind === 'date') {
                        const doy = ((s.idx + sign * k) % s.yearLen + s.yearLen) % s.yearLen;
                        out.push(fmtDate(doy, s.year));
                } else if (s.kind === 'num') {
                        out.push(fmtNum(s.v + sign * k, s.dec, s.pad));
                } else if (s.kind === 'mix') {
                        out.push(s.pre + fmtNum(s.v + sign * k, 0, s.pad) + s.suf);
                } else {
                        out.push(v0);
                }
        }
        return out;
}

/* ==================== 填充柄交互 ==================== */

/** 标准 DOM 助手（本文件不依赖 Obsidian 扩展，可在裸页面测试） */
const mkDiv = (cls: string, parent: HTMLElement): HTMLElement => {
        const d = document.createElement('div');
        d.className = cls;
        parent.appendChild(d);
        return d;
};
const emptyEl = (el: HTMLElement) => {
        while (el.firstChild) el.removeChild(el.firstChild);
};

/** 三角尺寸（柄 9 / 反馈三角 7，用户要求略微缩小） */
const HANDLE_SIZE = 9;
const DOT_SIZE = 7;

/** 三角 path（直角右下、斜边右上→左下、三顶点贝塞尔倒圆）——绘制与命中裁切共用同一条 */
const triPathD = (size: number): string => {
        const r = size * 0.28; // 圆角半径（沿边距离）
        const k = r * 0.7071; // 斜边方向分量（45°）
        // 顶点：A(size,0) 右上；B(size,size) 右下（直角）；C(0,size) 左下
        return `M${size - k},${k} Q${size},0 ${size},${r} L${size},${size - r} ` +
                `Q${size},${size} ${size - r},${size} L${r},${size} Q0,${size} ${k},${size - k} Z`;
};

/** 命中圈外扩量（px）：可见三角四周的隐形可点带 */
const HIT_PAD = 4;

const mkTri = (size: number): [HTMLElement, HTMLElement] => {
        // 兄弟双层（绝不能嵌套：hit 的 clip 会把 draw 一起裁掉——实机只剩月牙点的根因）：
        // - hit：透明命中层，polygon=可见三角外扩一圈（右边/底边外扩 e、斜边沿法向外扩）；
        // - draw：可见小三角，同一条 path 做 clip 与背景；pointer-events:none，命中由 hit 承担
        // 两者都由调用方定位（柄场景相对壳、dots 场景 fixed）
        const e = HIT_PAD;
        const hit = document.createElement('div');
        hit.className = 'vt-fill-tri-hit';
        hit.style.position = 'absolute';
        hit.style.left = '0';
        hit.style.top = '0';
        hit.style.width = `${size + 2 * e}px`;
        hit.style.height = `${size + 2 * e}px`;
        // pointer-events 是继承属性：壳为 none 时必须显式 auto，否则 hit 继承 none 永不命中
        hit.style.pointerEvents = 'auto';
        // 命中区=可见三角向外膨胀 e：右边/底边外移到 size+e，斜边向左上平移（远离直角顶点）
        // 至 x+y=size-e·√2；polygon 五点（斜边与盒相交处截断），draw 三角完整包含+外圈
        const s2 = size + e;
        const t = Math.max(0, size - e * 1.414);
        hit.style.clipPath = `polygon(${s2}px 0, ${s2}px ${s2}px, 0 ${s2}px, 0 ${t}px, ${t}px 0)`;
        const draw = document.createElement('div');
        draw.className = 'vt-fill-tri-draw';
        draw.style.position = 'absolute';
        draw.style.left = '0';
        draw.style.top = '0';
        draw.style.width = `${size}px`;
        draw.style.height = `${size}px`;
        draw.style.pointerEvents = 'none';
        const d = triPathD(size);
        draw.style.clipPath = `path('${d}')`;
        draw.style.background = 'var(--interactive-accent, #7c3aed)';
        draw.style.opacity = '0.55';
        return [hit, draw];
};

interface DragState {
        r0: number; c0: number;
        curR: number; curC: number;
        cells: { r: number; c: number }[]; // 起点 → 当前格（主方向轴上全部格，含两端）
}

interface MenuState {
        cells: { r: number; c: number }[];
        v0: string;
        sign: 1 | -1;
        /** 末端格视口 rect（applyFill 前缓存——重渲染会摘除旧 td，实时取会得 0） */
        anchorRect: DOMRect;
}

export class FillHandle {
        private el: HTMLElement;   // 填充柄（起点右下角）
        private dots: HTMLElement; // 拖动反馈三角容器
        private menu: HTMLElement; // 递增/递减选择框
        private anchor: { r: number; c: number } | null = null;
        private drag: DragState | null = null;
        private menuState: MenuState | null = null;
        private rafId = 0;
        private disposed = false;
        /** 锚格尺寸监听：编辑中格变长/变高 → 柄实时跟到新的右下角 */
        private ro = new ResizeObserver(() => {
                if (!this.disposed && this.anchor) this.placeHandle();
        });

        private onScroll = () => {
                if (this.disposed) return;
                cancelAnimationFrame(this.rafId);
                this.rafId = requestAnimationFrame(() => this.reposition());
        };
        private onDocPointerDown = (e: PointerEvent) => {
                if (!this.menuState) return;
                if (this.menu.contains(e.target as Node)) return;
                this.closeMenu();
        };
        private onKeyDown = (e: KeyboardEvent) => {
                if (this.menuState && e.key === 'Escape') {
                        e.stopPropagation();
                        this.closeMenu();
                }
        };

        constructor(private deps: FillDeps) {
                // 单例化：清掉旧实例残留的柄与反馈三角。
                // 注意保留 .vt-fill-menu：applyFill→onCommit→重渲染会新建实例，
                // 刚弹出的选择框若被清理，"拖到边缘重渲染快"时菜单直接消失（递增递减出不来）；
                // 旧菜单的 deps 闭包数据同源仍有效，点外部/Esc 自然关闭
                for (const cls of ['vt-fill-handle', 'vt-fill-dots']) {
                        document.body.querySelectorAll('.' + cls).forEach(n => n.remove());
                }
                this.el = mkDiv('vt-fill-handle', document.body);
                const [hHit, hDraw] = mkTri(HANDLE_SIZE);
                this.el.appendChild(hHit);
                this.el.appendChild(hDraw);
                this.el.style.display = 'none';
                this.dots = mkDiv('vt-fill-dots', document.body);
                this.dots.style.display = 'none';
                this.menu = mkDiv('vt-fill-menu', document.body);
                this.menu.style.display = 'none';

                this.el.addEventListener('pointerdown', (e) => this.onHandleDown(e));
                this.el.addEventListener('pointermove', (e) => this.onHandleMove(e));
                this.el.addEventListener('pointerup', (e) => this.onHandleUp(e));
                this.el.addEventListener('pointercancel', () => this.cancelDrag());

                document.addEventListener('scroll', this.onScroll, true);
                window.addEventListener('resize', this.onScroll);
                document.addEventListener('pointerdown', this.onDocPointerDown, true);
                document.addEventListener('keydown', this.onKeyDown, true);
        }

        /** 表格销毁后惰性清理（body 浮层不随容器移除，需自检） */
        private checkDisposed(): boolean {
                if (this.disposed) return true;
                // 宿主表格已脱离文档（deps.cellTd 长期为 null 也无害，这里只在锚定状态下自检）
                if (this.anchor && !this.deps.cellTd(this.anchor.r, this.anchor.c)?.isConnected) {
                        this.destroy();
                        return true;
                }
                return false;
        }

        destroy() {
                if (this.disposed) return;
                this.disposed = true;
                this.ro.disconnect();
                cancelAnimationFrame(this.rafId);
                this.anchor = null;
                this.drag = null;
                this.menuState = null;
                this.el.remove();
                this.dots.remove();
                this.menu.remove();
                document.removeEventListener('scroll', this.onScroll, true);
                window.removeEventListener('resize', this.onScroll);
                document.removeEventListener('pointerdown', this.onDocPointerDown, true);
                document.removeEventListener('keydown', this.onKeyDown, true);
        }

        /* ---------- 显示/隐藏 ---------- */

        showAt(r: number, c: number) {
                if (this.checkDisposed()) return;
                // 拖动中锚点冻结，不被焦点变化打断
                if (this.drag) return;
                this.anchor = { r, c };
                this.placeHandle();
                // 跟随锚格尺寸变化（编辑中内容变多 → 格变长/变高 → 柄贴住新的右下角）
                this.ro.disconnect();
                const td = this.deps.cellTd(r, c);
                if (td) this.ro.observe(td);
        }

        hide() {
                if (this.drag) return; // 拖动中不隐藏
                this.anchor = null;
                this.ro.disconnect();
                this.el.style.display = 'none';
                this.clearDots();
        }

        reposition() {
                if (this.checkDisposed()) return;
                if (this.anchor) this.placeHandle();
                if (this.drag) this.refreshDots();
                if (this.menuState) this.placeMenu();
        }

        private placeHandle() {
                const a = this.anchor!;
                const td = this.deps.cellTd(a.r, a.c);
                if (!td || !td.isConnected) {
                        this.el.style.display = 'none';
                        return;
                }
                const rect = td.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) {
                        this.el.style.display = 'none';
                        return;
                }
                const S = HANDLE_SIZE;
                this.el.style.display = 'block';
                // 完全在格子内部：垂直间隙 4px（19:51 下移 2px）；水平间隙 2px
                const cs = getComputedStyle(td);
                const vgap = (parseFloat(cs.borderBottomWidth) || 0) + 4;
                const hgap = (parseFloat(cs.borderRightWidth) || 0) + 2;
                this.el.style.left = `${Math.round(rect.right - hgap - S)}px`;
                this.el.style.top = `${Math.round(rect.bottom - vgap - S)}px`;
        }

        /* ---------- 拖动 ---------- */

        private onHandleDown(e: PointerEvent) {
                if (e.button !== 0 || !this.anchor || this.disposed) return;
                e.preventDefault();
                e.stopPropagation();
                this.closeMenu();
                this.deps.flushActive(); // 编辑中的起点格先落盘，保证起始值新鲜
                const { r, c } = this.anchor;
                this.drag = {
                        r0: r, c0: c,
                        curR: r, curC: c,
                        cells: [{ r, c }],
                };
                try {
                        this.el.setPointerCapture(e.pointerId);
                } catch { /* 忽略：capture 失败时 move 事件仍走柄元素（鼠标按下期间） */ }
                this.refreshDots();
        }

        private onHandleMove(e: PointerEvent) {
                const d = this.drag;
                if (!d || this.disposed) return;
                const hit = this.tdAt(e.clientX, e.clientY);
                if (!hit) return;
                // 主方向投影：对角拖动取占优轴，钳到行/列单轴（用户语义：横向/竖直拖动）
                let r = hit.r;
                let c = hit.c;
                if (Math.abs(r - d.r0) >= Math.abs(c - d.c0)) c = d.c0;
                else r = d.r0;
                if (r === d.curR && c === d.curC) return;
                d.curR = r;
                d.curC = c;
                this.rebuildCells(d);
                this.refreshDots();
        }

        private onHandleUp(e: PointerEvent) {
                const d = this.drag;
                if (!d || this.disposed) return;
                this.drag = null;
                this.clearDots();
                try {
                        this.el.releasePointerCapture(e.pointerId);
                } catch { /* 已释放则忽略 */ }

                const cells = d.cells;
                if (cells.length <= 1) {
                        // 未拖过任何格：无填充
                        this.anchor = { r: d.r0, c: d.c0 };
                        this.placeHandle();
                        return;
                }

                const sign: 1 | -1 = (d.curR > d.r0 || d.curC > d.c0) ? 1 : -1;
                const v0 = this.deps.cellValue(d.r0, d.c0);
                const vals = genSeries(v0, cells.length - 1, sign);
                const writes: { r: number; c: number; v: string }[] = [];
                for (let i = 1; i < cells.length; i++) {
                        const cell = cells[i]!;
                        if (!this.deps.cellVisible(cell.r, cell.c)) continue; // 合并占位格跳过
                        writes.push({ r: cell.r, c: cell.c, v: vals[i - 1]! });
                }
                if (!writes.length) return;

                // 末端格 rect 必须在 applyFill 之前取：applyFill→onCommit 可能同步重渲染，
                // 旧 td 被摘除后 getBoundingClientRect 全为 0，menu 会飞到页面左上角
                const last = cells[cells.length - 1]!;
                const lastTd = this.deps.cellTd(last.r, last.c);
                const lastRect = lastTd?.isConnected ? lastTd.getBoundingClientRect() : null;

                this.deps.applyFill(writes, { r: d.r0, c: d.c0 });

                // 纯数字/循环序列（星期、月份、日期等）/文本+数字：弹递增/递减选择框（末端格旁，浮窗式跳出）
                const kind = parseStart(v0).kind;
                if (kind !== 'copy' && lastRect) {
                        this.menuState = { cells, v0, sign, anchorRect: lastRect };
                        this.openMenu();
                }
                // 仅纯文本复制不弹框：无方向语义
                // 填充后选区已由 applyFill 清空，柄随 sync 隐藏；锚点保留到下次 sync 修正
                this.anchor = { r: d.r0, c: d.c0 };
        }

        private cancelDrag() {
                if (!this.drag) return;
                this.drag = null;
                this.clearDots();
        }

        private tdAt(x: number, y: number): { r: number; c: number } | null {
                const elm = document.elementFromPoint(x, y);
                const td = elm?.closest('td, th') as HTMLElement | null;
                if (!td) return null;
                const r = parseInt(td.dataset.vtR ?? '-1', 10);
                const c = parseInt(td.dataset.vtC ?? '-1', 10);
                if (r < 0 || c < 0) return null;
                return { r, c };
        }

        private rebuildCells(d: DragState) {
                const cells = [{ r: d.r0, c: d.c0 }];
                if (d.curR !== d.r0) {
                        const step = d.curR > d.r0 ? 1 : -1;
                        for (let r = d.r0 + step; ; r += step) {
                                cells.push({ r, c: d.c0 });
                                if (r === d.curR) break;
                        }
                } else if (d.curC !== d.c0) {
                        const step = d.curC > d.c0 ? 1 : -1;
                        for (let c = d.c0 + step; ; c += step) {
                                cells.push({ r: d.r0, c });
                                if (c === d.curC) break;
                        }
                }
                d.cells = cells;
        }

        private refreshDots() {
                const d = this.drag;
                if (!d) return;
                this.clearDots();
                if (d.cells.length <= 1) return;
                this.dots.style.display = 'block';
                for (let i = 1; i < d.cells.length; i++) {
                        const cell = d.cells[i]!;
                        const td = this.deps.cellTd(cell.r, cell.c);
                        if (!td || !td.isConnected) continue;
                        const rect = td.getBoundingClientRect();
                        if (rect.width === 0 && rect.height === 0) continue;
                        const [hit, draw] = mkTri(DOT_SIZE);
                        const cs = getComputedStyle(td);
                        const vgap = (parseFloat(cs.borderBottomWidth) || 0) + 4;
                        const hgap = (parseFloat(cs.borderRightWidth) || 0) + 2;
                        // 兄弟双层同位：可见三角右下顶点=(rect.right-hgap, rect.bottom-vgap)
                        const left = Math.round(rect.right - hgap - DOT_SIZE);
                        const top = Math.round(rect.bottom - vgap - DOT_SIZE);
                        hit.style.left = `${left}px`;
                        hit.style.top = `${top}px`;
                        draw.style.left = `${left}px`;
                        draw.style.top = `${top}px`;
                        this.dots.appendChild(hit);
                        this.dots.appendChild(draw);
                }
        }

        private clearDots() {
                this.dots.style.display = 'none';
                emptyEl(this.dots);
        }

        /* ---------- 递增/递减选择框 ---------- */

        private openMenu() {
                const m = this.menuState;
                if (!m) return;
                emptyEl(this.menu);
                const btnAsc = document.createElement('button');
                btnAsc.className = 'vt-fill-menu-btn';
                btnAsc.textContent = t('递增', 'Inc');
                btnAsc.addEventListener('click', () => this.applyMenu(1));
                const btnDesc = document.createElement('button');
                btnDesc.className = 'vt-fill-menu-btn';
                btnDesc.textContent = t('递减', 'Dec');
                btnDesc.addEventListener('click', () => this.applyMenu(-1));
                this.menu.appendChild(btnAsc);
                this.menu.appendChild(btnDesc);

                this.placeMenu();
                this.menu.style.transition = 'none';
                this.menu.style.visibility = 'hidden';
                this.menu.style.display = 'flex';
                this.menu.style.transform = 'scale(0.8) translateY(6px)';
                this.menu.style.opacity = '0.7';
                void this.menu.offsetWidth;
                this.menu.style.visibility = 'visible';
                requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                                if (!this.menuState) return;
                                this.menu.style.transition = '';
                                this.menu.style.transform = 'scale(1) translateY(0)';
                                this.menu.style.opacity = '1';
                        });
                });
                this.refreshMenuHighlight();
        }

        private placeMenu() {
                const m = this.menuState;
                if (!m) return;
                const rect = m.anchorRect;
                // 尺寸：隐藏测量
                const wasDisplay = this.menu.style.display;
                if (wasDisplay === 'none') {
                        this.menu.style.display = 'flex';
                        this.menu.style.visibility = 'hidden';
                }
                const mw = this.menu.offsetWidth;
                const mh = this.menu.offsetHeight;
                if (wasDisplay === 'none') {
                        this.menu.style.display = 'none';
                        this.menu.style.visibility = '';
                }
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                let left = rect.right - mw; // 末端格右对齐
                left = Math.max(8, Math.min(left, vw - mw - 8));
                let top = rect.bottom + 6;
                if (top + mh > vh - 8) top = rect.top - mh - 6; // 下方放不下 → 上方
                top = Math.max(8, top);
                this.menu.style.left = `${Math.round(left)}px`;
                this.menu.style.top = `${Math.round(top)}px`;
        }

        private refreshMenuHighlight() {
                const m = this.menuState;
                if (!m) return;
                const btns = this.menu.querySelectorAll<HTMLButtonElement>('.vt-fill-menu-btn');
                // 顺序：递增、递减
                btns[0]?.classList.toggle('vt-fill-on', m.sign === 1);
                btns[1]?.classList.toggle('vt-fill-on', m.sign === -1);
        }

        private applyMenu(sign: 1 | -1) {
                const m = this.menuState;
                if (!m) return;
                m.sign = sign;
                const vals = genSeries(m.v0, m.cells.length - 1, sign);
                const writes: { r: number; c: number; v: string }[] = [];
                for (let i = 1; i < m.cells.length; i++) {
                        const cell = m.cells[i]!;
                        if (!this.deps.cellVisible(cell.r, cell.c)) continue;
                        writes.push({ r: cell.r, c: cell.c, v: vals[i - 1]! });
                }
                if (writes.length) this.deps.applyFill(writes, { r: m.cells[0]!.r, c: m.cells[0]!.c });
                this.refreshMenuHighlight();
        }

        private closeMenu() {
                if (!this.menuState) return;
                this.menuState = null;
                this.menu.style.display = 'none';
                emptyEl(this.menu);
        }
}
