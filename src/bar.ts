
/**
 * bar.ts
 * 悬浮格式化工具栏
 * 单元格获得焦点时显示，失焦时隐藏
 * 按钮用 mousedown+preventDefault 保持单元格选区不丢
 */

import {
        VtData, serialize, mergeRight, mergeDown, splitCell,
        insertRow, insertCol, deleteRow, deleteCol,
        toggleWrapTag,
} from './builder';
import type { SelOps, SelOpKind, FocusShift } from './sel';
import { compatExecCommand } from './compat';
import { t } from './i18n';

/** 整格字号包裹（已包则改值——A± 连点递变；与选区字号的 span 存储形态一致） */
function wrapFontSize(src: string, px: number): string {
        const m = src.match(/^<span style="font-size:\s*[\d.]+px"([^>]*)>([\s\S]*)<\/span>$/);
        if (m) return `<span style="font-size:${px}px"${m[1]}>${m[2]}</span>`;
        return `<span style="font-size:${px}px">${src}</span>`;
}

export class Toolbar {
        readonly el: HTMLElement;
        private cell: HTMLElement | null = null;
        private data: VtData | null = null;
        private cellR = 0;
        private cellC = 0;
        private onCommit: ((s: string) => void) | null = null;
        /** 按新 grid 源码重投聚焦格段 DOM（render.ts 提供；浮窗文本类操作后 DOM 与数据闭环用） */
        private syncCell: ((r: number, c: number) => void) | null = null;
        private flushCell: (() => void) | null = null;
        private onConvertToMd: (() => void) | null = null;
        private onConvertToHtml: (() => void) | null = null;
        private selOps: SelOps | null = null;
        /** 单格结构操作待消费的聚焦修正（bug2：光标跟随原格） */
        private focusShift: FocusShift | null = null;
        private animated = false;
        private animatedTimer: number | null = null;
        /** 窗口缩放跟随（2026-10-18：窗口大小/位置改变后浮窗留在旧视口坐标偏离正中间） */
        private onWinResize = () => {
                if (this.el.style.display !== 'none') this.reposition();
        };

        constructor() {
                this.el = document.body.createDiv({ cls: 'vt-bar' });
                this.el.style.display = `none`;
                this.buildRows();
                window.addEventListener('resize', this.onWinResize);
        }

        /* ===== 构建两行 ===== */

        /** 语言切换后重建按钮（label/title 跟随当前 UI 语言） */
        rebuild() {
                this.el.empty();
                this.buildRows();
        }

        private buildRows() {
                // 第一行：B I A- A+ | 拆 合↓ 合→
                const row1 = this.el.createDiv({ cls: 'vt-bar-row' });
                const fmtDefs: Array<[string, string, () => void]> = [
                        ['B',  t('加粗', 'Bold'),          () => this.fmt('bold')],
                        ['I',  t('斜体', 'Italic'),        () => this.fmt('italic')],
                        ['A-', t('缩小字号', 'Smaller'),   () => this.stepFont(-2)],
                        ['A+', t('放大字号', 'Larger'),    () => this.stepFont(2)],
                ];
                for (const [label, hint, fn] of fmtDefs) {
                        const btn = row1.createEl('button', { cls: 'vt-bar-btn', text: label });
                        btn.title = hint;
                        btn.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                document.body.dataset.vtBarClick = '1';
                                fn();
                                window.setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
                        });
                }
                row1.createSpan({ cls: 'vt-bar-sep' });

                // 拆分按钮
                const splitBtn = row1.createEl('button', { cls: 'vt-bar-btn', text: t('拆', 'SP') });
                splitBtn.title = t('拆分单元格', 'Split cell');
                splitBtn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        this.structOp('split', splitCell);
                });

                // 有选区时「合↓/合→」都按 6b 整块合并（不分方向）
                const mergeDefs: Array<[string, string, (g: VtData['rows'], r: number, c: number) => void]> = [
                        [t('合↓', 'M↓'), t('向下合并单元格', 'Merge down'), mergeDown],
                        [t('合→', 'M→'), t('向右合并单元格', 'Merge right'), mergeRight],
                ];
                for (const [label, hint, fn] of mergeDefs) {
                        const btn = row1.createEl('button', { cls: 'vt-bar-btn', text: label });
                        btn.title = hint;
                        btn.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                this.structOp('merge', fn);
                        });
                }

                // 第二行：＋行 ＋列 －行 －列 MD H5
                const row2 = this.el.createDiv({ cls: 'vt-bar-row' });
                const opDefs: Array<[string, SelOpKind, string, (g: VtData['rows'], r: number, c: number) => void]> = [
                        [t('＋行', '+R'), 'insRowBelow', t('下方插入行', 'Insert row below'), (g, r) => insertRow(g, r)],
                        [t('＋列', '+C'), 'insColRight', t('右侧插入列', 'Insert column right'), (g, _r, c) => insertCol(g, c)],
                        [t('－行', '-R'), 'delRows',     t('删除本行', 'Delete row'),           (g, r) => deleteRow(g, r)],
                        [t('－列', '-C'), 'delCols',     t('删除本列', 'Delete column'),        (g, _r, c) => deleteCol(g, c)],
                ];
                for (const [label, kind, hint, fn] of opDefs) {
                        const btn = row2.createEl('button', { cls: 'vt-bar-btn', text: label });
                        btn.title = hint;
                        btn.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                this.structOp(kind, fn);
                        });
                }
                row2.createSpan({ cls: 'vt-bar-sep' });

                const mdBtn = row2.createEl('button', { cls: 'vt-bar-btn', text: 'MD' });
                mdBtn.title = t('转换为 markdown 表格', 'Convert to Markdown table');
                mdBtn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const convert = this.onConvertToMd;
                        document.body.dataset.vtBarClick = '1';
                        this.hide();
                        if (convert) convert();
                        window.setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
                });

                const htmlBtn = row2.createEl('button', { cls: 'vt-bar-btn', text: 'H5' });
                htmlBtn.title = t('转换为 HTML 表格', 'Convert to HTML table');
                htmlBtn.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const convert = this.onConvertToHtml;
                        document.body.dataset.vtBarClick = '1';
                        this.hide();
                        if (convert) convert();
                        window.setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
                });
        }

        /** 执行结构操作：有选区 → 按选区批量执行；无选区 → 单格（原有行为 + 光标位置保持） */
        private structOp(kind: SelOpKind, fn: (g: VtData['rows'], r: number, c: number) => void) {
                if (this.selActive()) {
                        this.selOps![kind]();
                        return;
                }
                if (!this.data || !this.onCommit) return;
                this.flushCell?.();
                const g = this.data.rows;
                const commit = this.onCommit;
                const r = this.cellR;
                const c = this.cellC;
                // 各操作的聚焦格位移（表格按钮都相对聚焦格操作）
                const shifts: Partial<Record<SelOpKind, FocusShift>> = {
                        insRowBelow: { dr: 0 },                       // 行插在聚焦行下方 → 聚焦行不动
                        insColRight: { dc: 0 },                       // 列插在聚焦列右侧 → 聚焦列不动
                        delRows: { dr: -1, resetCaret: true },        // 聚焦行被删 → 落到上一行
                        delCols: { dc: -1, resetCaret: true },        // 聚焦列被删 → 落到左一列
                        merge: { resetCaret: true },                  // 合并后内容变化 → 光标落格首
                };
                this.focusShift = shifts[kind] ?? null;
                fn(g, r, c);
                // 文本类操作只改 grid 不动 td——离焦投影把旧 DOM 写回会覆盖 grid 新值
                // （加粗/斜体不保存的根因），立即按新源码重投聚焦格，DOM 与数据闭环
                this.syncCell?.(r, c);
                commit(serialize(this.data));
                this.focusShift = null; // commit 闭包已消费；异常路径兜底清空
        }

        /** 提交闭包消费聚焦修正（一次性） */
        consumeFocusShift(): FocusShift | null {
                const s = this.focusShift;
                this.focusShift = null;
                return s;
        }

        /** bug1：浮窗引用的单元格已脱离 DOM（重渲染/切标签页）时立即隐藏，防止幽灵浮窗 */
        hideIfStale() {
                if (this.cell && !this.cell.isConnected) this.hide();
        }

        /** 富文本格式：有选区 → 逐格整块包裹；无选区 → 聚焦格整格包裹（源码域）。
         *  单格不再走 execCommand：其 DOM 修改会被 wysiwyg 源码投影丢弃（加粗/斜体不保存），
         *  改与选区批量同语义直接包 grid 源码，经 commit 重渲染后持久化 */
        private fmt(cmd: 'bold' | 'italic') {
                if (this.selActive()) {
                        this.selOps![cmd]();
                        return;
                }
                const tag = cmd === 'bold' ? 'b' : 'i';
                this.structOp(cmd, (g, r, c) => {
                        const cd = g[r]?.[c];
                        if (cd) cd.t = toggleWrapTag(cd.t, tag);
                });
        }

        private selActive(): boolean {
                return !!this.selOps && this.selOps.rects.length > 0;
        }

        /* ===== 显示/隐藏/定位 ===== */

        show(
                cell: HTMLElement,
                data: VtData,
                r: number,
                c: number,
                onCommit: (s: string) => void,
                flushCell: () => void,
                onConvertToMd: () => void,
                onConvertToHtml: () => void,
                selOps: SelOps | null = null,
                syncCell: (r: number, c: number) => void = () => {},
        ) {
                this.cell = cell;
                this.data = data;
                this.cellR = r;
                this.cellC = c;
                this.onCommit = onCommit;
                this.flushCell = flushCell;
                this.onConvertToMd = onConvertToMd;
                this.onConvertToHtml = onConvertToHtml;
                this.selOps = selOps;
                this.syncCell = syncCell;

                // 如果 hide() 的延时重置尚未触发，取消它（说明仍在表格内切换）
                if (this.animatedTimer !== null) {
                        window.clearTimeout(this.animatedTimer);
                        this.animatedTimer = null;
                }

                const animate = !this.animated;
                if (!this.prepareVisible(animate)) return;

                if (animate) {
                        this.animated = true;
                        this.el.style.transition = ``;
                        window.requestAnimationFrame(() => {
                                window.requestAnimationFrame(() => {
                                        this.el.style.transform = `scale(1) translateY(0)`;
                                        this.el.style.opacity = `1`;
                                        this.reposition();
                                });
                        });
                }
                this.scheduleRepositionRetries();
        }

        /** 先隐藏布局再测量尺寸，避免首次显示时 offsetWidth 为 0 导致定位偏移 */
        private prepareVisible(animate: boolean): boolean {
                this.el.style.transition = `none`;
                this.el.style.visibility = `hidden`;
                this.el.style.display = `flex`;
                this.el.style.transform = animate ? 'scale(0.8) translateY(6px)' : 'scale(1) translateY(0)';
                this.el.style.opacity = animate ? '0.7' : '1';

                void this.el.offsetWidth;
                if (!this.reposition()) {
                        this.el.style.display = `none`;
                        this.el.style.visibility = ``;
                        return false;
                }

                this.el.style.visibility = `visible`;
                void this.el.offsetWidth;
                return true;
        }

        /** Obsidian 刚启动时编辑器布局可能尚未稳定，短延迟内重算位置 */
        private scheduleRepositionRetries() {
                window.requestAnimationFrame(() => this.reposition());
                window.setTimeout(() => this.reposition(), 0);
                window.setTimeout(() => this.reposition(), 120);
        }

        hide() {
                this.el.style.transform = ``;
                this.el.style.opacity = ``;
                this.el.style.display = `none`;
                this.cell = null;
                this.data = null;
                this.onCommit = null;
                this.flushCell = null;
                this.onConvertToMd = null;
                this.onConvertToHtml = null;
                this.selOps = null;

                // 延时重置动画标记：若短时间内再次 show（表格内切单元格），取消此计时器
                if (this.animatedTimer !== null) window.clearTimeout(this.animatedTimer);
                this.animatedTimer = window.setTimeout(() => {
                        this.animated = false;
                        this.animatedTimer = null;
                }, 400);
        }

        private reposition(): boolean {
                const scroller = document.querySelector<HTMLElement>('.workspace-leaf.mod-active .cm-scroller');
                if (!scroller) return false;
                const sRect = scroller.getBoundingClientRect();
                if (sRect.width <= 0 || sRect.height <= 0) return false;

                const w = this.el.offsetWidth || 280;

                // 移动端直接用 scroller 居中（无 gutter，更稳定）
                // 桌面端用 cm-content 排除行号区域
                const isMobile = document.body.classList.contains('is-mobile') || document.body.classList.contains('is-tablet');
                const hRef = isMobile
                        ? scroller
                        : (scroller.querySelector('.cm-content') as HTMLElement) ?? scroller;
                const hRect = hRef.getBoundingClientRect();
                const refRect = hRect.width > 50 ? hRect : sRect;

                const left = Math.max(8, Math.min(
                        refRect.left + (refRect.width - w) / 2,
                        window.innerWidth - w - 8,
                ));
                this.el.style.position = `fixed`;
                this.el.style.left = `${left}px`;
                this.el.style.top = `${sRect.top + sRect.height * 0.8}px`;
                this.el.style.zIndex = `9999`;
                return true;
        }

        /* ===== 文本格式化 ===== */

        private exec(cmd: string, value?: string) {
                compatExecCommand(document, cmd, value);
        }

        private stepFont(delta: number) {
                if (this.selActive()) {
                        this.selOps!.fontStep(delta);
                        return;
                }
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;
                const range = sel.getRangeAt(0);
                const anchor = range.startContainer.parentElement;
                if (!anchor) return;
                const cur = parseFloat(getComputedStyle(anchor).fontSize) || 16;
                const next = Math.max(8, Math.min(72, cur + delta));
                if (!sel.isCollapsed) {
                        const span = createSpan();
                        span.style.fontSize = `${next}px`;
                        try { range.surroundContents(span); } catch { /* 跨节点选区忽略 */ }
                } else if (this.cell) {
                        // 有内容：进 grid 持久化（整格 span 包裹，与选区字号同存储形态）。
                        // 原 td.style 直改无持久化载体——projectSource 只投影段，td 内联样式必丢（字号不保存的根因）
                        const cd = this.data?.rows[this.cellR]?.[this.cellC];
                        if (cd && (cd.t ?? '').trim() !== '' && this.onCommit) {
                                this.flushCell?.();
                                cd.t = wrapFontSize(cd.t, next);
                                this.syncCell?.(this.cellR, this.cellC);
                                const commit = this.onCommit;
                                commit(serialize(this.data));
                                return;
                        }
                        this.cell.style.fontSize = `${next}px`; // 空格无内容载体，维持 DOM 行为
                }
        }

        destroy() {
                if (this.animatedTimer !== null) window.clearTimeout(this.animatedTimer);
                window.removeEventListener('resize', this.onWinResize);
                this.el.remove();
        }

        /** 临时诊断（vt-diag-bar，定版时随 diagSnapshot 一并删）：浮窗内部状态实锤——
         *  用户报「A 用后 B 无反应」，mock 全链复现正常 → 真机差异聚焦浮窗存活/事件可达（CM 干预层）。
         *  cell=null = hide 链竞争（修 hide 时序）；cell=DETACHED = show 未刷新；conn = 链路深处再挖。 */
        diagState(): Record<string, unknown> {
                const cs = getComputedStyle(this.el);
                const rect = this.el.getBoundingClientRect();
                return {
                        cell: this.cell ? (this.cell.isConnected ? 'conn' : 'DETACHED') : 'null',
                        cellRC: `${this.cellR},${this.cellC}`,
                        selActive: this.selActive(),
                        rects: this.selOps ? this.selOps.rects.length : -1,
                        data: this.data ? `${this.data.rows.length}x${this.data.rows[0]?.length ?? 0}` : 'null',
                        onCommit: this.onCommit ? 'yes' : 'no',
                        syncCell: this.syncCell ? 'yes' : 'no',
                        visible: cs.display !== 'none' && cs.opacity !== '0',
                        display: cs.display,
                        pointerEvents: cs.pointerEvents,
                        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
                        hitTest: (() => { const r = rect; const el2 = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el2 ? (el2.closest('.vt-bar') ? 'bar' : el2.tagName + '.' + String(el2.className).slice(0, 20)) : 'none'; })(),
                };
        }
}
