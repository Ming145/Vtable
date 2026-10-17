/**
 * modes.ts — OL / HS / RC 模式
 */

import { Platform, setIcon } from 'obsidian';
import type { VtData, VtMode } from './builder';

/** RC 角标/把手防重绑标记：用交叉类型挂自定义标记，替代无类型断言（官方 eslint 禁 any） */
type VtRcBindFlags = HTMLElement & {
        __vtCornerROBound?: boolean;
        __vtCornerScrollBound?: boolean;
        __vtHandleScrollBound?: boolean;
};
const cornerBinds = (wrap: HTMLElement): VtRcBindFlags => wrap;


const MODE_HINTS: Record<VtMode, string> = {
        OL: '原始换行模式',
        HS: '横向拉长模式',
        RC: '自由拖拽行高列宽',
};

const MODE_ICONS: Record<VtMode, string> = {
        OL: 'wrap-text',
        HS: 'move-horizontal',
        RC: 'move',
};

export class ModeSwitcher {
        readonly el: HTMLElement;
        private onChange: ((mode: VtMode) => void) | null = null;

        constructor(parent: HTMLElement) {
                this.el = parent.createDiv({ cls: 'vt-mode-bar' });
                this.el.style.display = `none`;
                for (const mode of ['OL', 'HS', 'RC'] as VtMode[]) {
                        // 任务4 v2：彻底弃用 button 元素——主题对 button 的样式污染（焦点圈/边框/背景）
                        // 用 CSS 对抗不可靠，直接换成无默认样式的 div，cursor 由 CSS 提供。
                        // 不设 role="button"：主题对 [role="button"] 也有圆底/hover 底纹样式
                        const btn = this.el.createDiv({ cls: 'vt-mode-btn' });
                        btn.dataset.mode = mode;
                        btn.title = MODE_HINTS[mode];
                        btn.setAttribute('aria-label', MODE_HINTS[mode]);
                        setIcon(btn, MODE_ICONS[mode]);
                        btn.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                document.body.dataset.vtModeClick = '1';
                                this.onChange?.(mode);
                                window.setTimeout(() => { delete document.body.dataset.vtModeClick; }, 300);
                        });
                }
        }

        setHandler(fn: (mode: VtMode) => void) {
                this.onChange = fn;
        }

        show(active: VtMode) {
                this.el.style.display = `flex`;
                this.setActive(active);
        }

        hide() {
                this.el.style.display = `none`;
        }

        setActive(mode: VtMode) {
                this.el.querySelectorAll('.vt-mode-btn').forEach(el => {
                        el.toggleClass('is-active', (el as HTMLElement).dataset.mode === mode);
                });
        }
}

export function applyModeStyles(
        wrap: HTMLElement,
        table: HTMLTableElement,
        data: VtData,
        hsBar: HTMLElement | null,
) {
        table.removeClass('vt-mode-ol', 'vt-mode-hs', 'vt-mode-rc');
        table.addClass(`vt-mode-${data.mode.toLowerCase()}`);
        const isHs = data.mode === 'HS';
        const isRc = data.mode === 'RC';
        wrap.toggleClass('vt-hs-scroll', isHs);
        wrap.toggleClass('vt-rc-scroll', isRc);
        // RC 表格可窄于/等于容器：此时无溢出，不显示自定义滚动条（与界面同宽或更小 → 隐藏拖条）
        if (hsBar) {
                if (isRc) hsBar.style.display = wrap.scrollWidth > wrap.clientWidth + 1 ? 'block' : 'none';
                else hsBar.style.display = isHs ? 'block' : 'none';
        }

        if (data.mode !== 'RC') {
                table.querySelectorAll<HTMLElement>('tr, td, col').forEach(el => {
                        el.style.removeProperty('height');
                        el.style.removeProperty('width');
                        el.style.removeProperty('min-height');
                });
                table.querySelector('colgroup')?.remove();
                wrap.querySelector('.vt-rc-overlay')?.remove();
                return;
        }

        // RC 模式：通过 colgroup 设置列宽，确保 table-layout: fixed 生效
        let colgroup = table.querySelector('colgroup');
        if (!colgroup) {
                colgroup = table.createEl('colgroup');
                table.prepend(colgroup);
        }
        colgroup.empty();

        const cols = data.rows[0]?.length ?? 0;
        for (let c = 0; c < cols; c++) {
                const col = colgroup.createEl('col');
                const w = data.colWidths?.[c];
                if (w && w > 0) col.style.width = `${w}px`;
                else col.style.width = `120px`; // 默认列宽，避免挤压
        }

        table.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr, r) => {
                const h = data.rowHeights?.[r];
                if (h && h > 0) tr.style.height = `${h}px`;
                else tr.style.removeProperty('height');
        });

        table.querySelectorAll<HTMLTableCellElement>('td').forEach(td => {
                const rh = data.rowHeights?.[parseInt(td.dataset.vtR ?? '-1', 10)];
                // rowSpan>1 的格子高度由跨行布局自然决定，锁 minHeight 会被浏览器分摊误撑其它行
                if (rh && rh > 0 && (td.rowSpan ?? 1) <= 1) td.style.minHeight = `${rh}px`;
                else td.style.removeProperty('min-height');
        });
}

/** HS 模式：可拖拽的底部滚动条 */
export function setupHsScrollBar(wrap: HTMLElement, barEl: HTMLElement) {
        const track = barEl.querySelector('.vt-hs-track') as HTMLElement;
        const thumb = barEl.querySelector('.vt-hs-thumb') as HTMLElement;
        if (!track || !thumb) return;

        const syncThumb = () => {
                // 仅在 HS 或 RC 模式下显示自定义滚动条
                if (!wrap.hasClass('vt-hs-scroll') && !wrap.hasClass('vt-rc-scroll')) {
                        barEl.style.display = `none`;
                        return;
                }
                const maxScroll = wrap.scrollWidth - wrap.clientWidth;
                if (maxScroll <= 0) {
                        barEl.style.display = `none`;
                        return;
                }
                barEl.style.display = `block`;
                const ratio = wrap.clientWidth / wrap.scrollWidth;
                const thumbW = Math.max(24, track.clientWidth * ratio);
                thumb.style.width = `${thumbW}px`;
                const maxThumbLeft = track.clientWidth - thumbW;
                thumb.style.left = `${maxScroll > 0 ? (wrap.scrollLeft / maxScroll) * maxThumbLeft : 0}px`;
        };

        wrap.addEventListener('scroll', syncThumb);
        new ResizeObserver(syncThumb).observe(wrap);
        const tbl = wrap.querySelector('table');
        if (tbl) new ResizeObserver(syncThumb).observe(tbl);
        syncThumb();

        let dragging = false;
        let startX = 0;
        let startLeft = 0;

        thumb.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                startX = e.clientX;
                startLeft = thumb.offsetLeft;
                (thumb).setPointerCapture(e.pointerId);
        });

        thumb.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const trackW = track.clientWidth;
                const thumbW = thumb.offsetWidth;
                const maxThumbLeft = trackW - thumbW;
                const newLeft = Math.max(0, Math.min(maxThumbLeft, startLeft + (e.clientX - startX)));
                const maxScroll = wrap.scrollWidth - wrap.clientWidth;
                wrap.scrollLeft = maxScroll > 0 ? (newLeft / maxThumbLeft) * maxScroll : 0;
        });

        const stopDrag = (e: PointerEvent) => {
                dragging = false;
                try { thumb.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        thumb.addEventListener('pointerup', stopDrag);
        thumb.addEventListener('pointercancel', stopDrag);

        track.addEventListener('pointerdown', (e) => {
                if (e.target === thumb) return;
                const rect = track.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const maxScroll = wrap.scrollWidth - wrap.clientWidth;
                wrap.scrollLeft = ratio * maxScroll;
        });
}

/** RC 模式：独立覆盖层的拖拽手柄，不污染单元格内容 */
export function bindRcResizeHandles(
        table: HTMLTableElement,
        data: VtData,
        editing: boolean,
        onUpdate: () => void,
        enabled = true,
) {
        const wrap = table.closest<HTMLElement>('.vt-table-wrap');
        if (!wrap) return;

        let overlay = wrap.querySelector<HTMLElement>('.vt-rc-overlay');
        if (data.mode !== 'RC' || !editing || !enabled) {
                overlay?.remove();
                return;
        }

        if (!overlay) {
                overlay = wrap.createDiv({ cls: 'vt-rc-overlay' });
        }
        overlay.empty();

        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
        const cols = data.rows[0]?.length ?? 0;

        // 触屏把手命中厚度：用户实测 22px 太贪——行高 30px 的表里每条行列边界上下各吃 11px，
        // 一指下去大半概率落在把手上（"一点相当于全点在边框上"，"只有 RC 点不动"的根因：
        // RC 独有拖动把手，桌面无此加大热区所以没事）。缩到 12px（边界上下各 6px），
        // 格身可用区域大幅回来；拖动仍可对准边界完成
        const hit = (Platform.isMobile || Platform.isTablet) ? 12 : 6;

        // 列拖拽手柄：每列右边缘
        // 问题4：第一列特别长（表格宽于 wrap 可视区）时，把手原样放在列右缘 = 落在可视区外拖不到。
        // 与加号按钮（edge bar）同策略：clamp 到 wrap 可视区边缘，wrap 滚动时同步跟随。
        const placeHandles = () => {
                // 读写分离：读阶段集中量取全部几何，写阶段集中落位——
                // 逐元素"读一个写一个"会让每次 gBCR 都强制整表重排，滚动时 O(rows) 次重排 → 卡顿
                const tableRect0 = table.getBoundingClientRect();
                const visL = wrap.scrollLeft;
                const visR = wrap.scrollLeft + wrap.clientWidth - hit;
                const wrapW = wrap.clientWidth;
                const tableW = table.offsetWidth;
                const tableH = table.offsetHeight;
                const firstRowCells = Array.from(rows[0]?.querySelectorAll<HTMLTableCellElement>('td') ?? []);
                const colPos: { g: HTMLElement; left: number }[] = [];
                wrap.querySelectorAll<HTMLElement>('.vt-rc-handle-col').forEach(g => {
                        const c = parseInt(g.dataset.vtC ?? '-1', 10);
                        const targetCell = firstRowCells.find(td => parseInt(td.dataset.vtC ?? '-1', 10) === c);
                        if (!targetCell) return;
                        const rect = targetCell.getBoundingClientRect();
                        const base = Math.min(rect.right - tableRect0.left - hit / 2, tableW - hit);
                        colPos.push({ g, left: Math.max(visL, Math.min(base, visR)) });
                });
                const rowPos: { g: HTMLElement; top: number }[] = [];
                wrap.querySelectorAll<HTMLElement>('.vt-rc-handle-row').forEach(g => {
                        // top 现算：行高变化后旧快照会漂移（把手视觉所在行 ≠ 绑定行 → 拖错行）
                        const rr = parseInt(g.dataset.vtR ?? '-1', 10);
                        const tr = rows[rr];
                        if (!tr) return;
                        const rect = tr.getBoundingClientRect();
                        rowPos.push({ g, top: Math.min(rect.bottom - tableRect0.top - hit / 2, tableH - hit) });
                });
                for (const { g, left } of colPos) g.style.left = `${left}px`;
                for (const { g, top } of rowPos) {
                        // 行把手横贯表格宽度：只铺可视区段（可视左缘起、铺到可视右缘），滚动跟随
                        g.style.top = `${top}px`;
                        g.style.left = `${visL}px`;
                        g.style.width = `${wrapW}px`;
                }
        };
        for (let c = 0; c < cols; c++) {
                const firstRow = rows[0];
                if (!firstRow) continue;
                const cells = Array.from(firstRow.querySelectorAll<HTMLTableCellElement>('td'));
                const targetCell = cells.find(td => parseInt(td.dataset.vtC ?? '-1', 10) === c);
                if (!targetCell) continue;

                const rect = targetCell.getBoundingClientRect();
                const tableRect = table.getBoundingClientRect();
                const colHandle = overlay.createDiv({ cls: 'vt-rc-handle vt-rc-handle-col' });
                colHandle.dataset.vtC = String(c); // placeHandles 重放时按此定位
                // 初始位置：clamp 在表格盒内 + wrap 可视区内（问题4：超宽列把手贴可视边缘）
                colHandle.style.left = `${Math.max(wrap.scrollLeft, Math.min(rect.right - tableRect.left - hit / 2, table.offsetWidth - hit, wrap.scrollLeft + wrap.clientWidth - hit))}px`;
                colHandle.style.top = `0`;
                colHandle.style.height = `${table.offsetHeight}px`;
                colHandle.style.width = `${hit}px`;

                // iPad：touchstart 不拦会触发长按选择/放大镜/滚动接管，吃掉后续 pointer 事件导致拖不动
                colHandle.addEventListener('touchstart', (te) => te.preventDefault(), { passive: false });
                colHandle.addEventListener('pointerdown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!data.colWidths) data.colWidths = [];
                        const startX = e.clientX;
                        const startW = data.colWidths[c] ?? targetCell.offsetWidth;
                        try { colHandle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

                        const onMove = (ev: PointerEvent) => {
                                const newW = Math.max(40, Math.round(startW + (ev.clientX - startX)));
                                data.colWidths![c] = newW;
                                const colgroup = table.querySelector('colgroup');
                                const col = colgroup?.children[c] as HTMLElement | undefined;
                                if (col) col.style.width = `${newW}px`;
                        };
                        // 监听挂 window 而非手柄：不依赖 pointer capture（WKWebView 上 capture 时有失效），
                        // 手指移到任何元素上 move 都能收到；onUp 必摘监听，无泄漏
                        const onUp = (ev: PointerEvent) => {
                                window.removeEventListener('pointermove', onMove);
                                window.removeEventListener('pointerup', onUp);
                                window.removeEventListener('pointercancel', onUp);
                                try { colHandle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                                onUpdate();
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                        window.addEventListener('pointercancel', onUp);
                });
        }

        // 行拖拽手柄：每行底边缘
        rows.forEach((tr, r) => {
                const rect = tr.getBoundingClientRect();
                const tableRect = table.getBoundingClientRect();
                const rowHandle = overlay.createDiv({ cls: 'vt-rc-handle vt-rc-handle-row' });
                // 同上：钳制在表格盒内，最后一条行把手不探出表格底缘
                rowHandle.style.top = `${Math.min(rect.bottom - tableRect.top - hit / 2, table.offsetHeight - hit)}px`;
                // 问题4：left/width 由 placeHandles 统一铺可视区段（超宽表格时只铺 wrap 可视范围，滚动跟随）
                rowHandle.style.left = `${wrap.scrollLeft}px`;
                rowHandle.style.width = `${wrap.clientWidth}px`;
                rowHandle.style.height = `${hit}px`;
                rowHandle.dataset.vtR = String(r); // placeHandles 重放时按此现算 top

                // 同上：touchstart 拦截 + 拖拽监听挂 window（不依赖 pointer capture）
                rowHandle.addEventListener('touchstart', (te) => te.preventDefault(), { passive: false });
                rowHandle.addEventListener('pointerdown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!data.rowHeights) data.rowHeights = [];
                        const startY = e.clientY;
                        const startH = data.rowHeights[r] ?? tr.offsetHeight;
                        // 用户方案：拖拽开始就把【每一行】的当前高度写进 rowHeights（持久化）——
                        // 浏览器分摊行高时只会撑"未锁定"的行，全量锁定后高度需求只能作用于被拖行，
                        // 彻底杜绝"拖 A 行、最上面的未调整行变高"。重渲染后 applyModeStyles 按值恢复
                        table.querySelectorAll<HTMLTableRowElement>('tr').forEach((t, i) => {
                                if (data.rowHeights![i] == null) data.rowHeights![i] = t.offsetHeight;
                        });
                        // 拖拽期间的内联锁（重渲染前立即生效）
                        table.querySelectorAll<HTMLTableCellElement>('td').forEach(t => {
                                if ((t.rowSpan ?? 1) > 1) return;
                                const tR = parseInt(t.dataset.vtR ?? '-1', 10);
                                if (tR === r) return; // 被拖行由 onMove 设新值
                                t.style.minHeight = `${t.offsetHeight}px`;
                        });
                        try { rowHandle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

                        const onMove = (ev: PointerEvent) => {
                                const newH = Math.max(24, Math.round(startH + (ev.clientY - startY)));
                                data.rowHeights![r] = newH;
                                tr.style.height = `${newH}px`;
                                // rowSpan>1 的格子不锁 minHeight：跨行格的高度需求会被浏览器
                                // 分摊到它跨越的各行（优先撑未锁定行、自上而下）→ "误调别的行"的根因
                                tr.querySelectorAll<HTMLTableCellElement>('td').forEach(td => {
                                        if ((td.rowSpan ?? 1) > 1) return;
                                        td.style.minHeight = `${newH}px`;
                                });
                        };
                        const onUp = (ev: PointerEvent) => {
                                window.removeEventListener('pointermove', onMove);
                                window.removeEventListener('pointerup', onUp);
                                window.removeEventListener('pointercancel', onUp);
                                try { rowHandle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                                // 不恢复内联锁：rowHeights 已全量持久化，onUpdate 重渲染后由 applyModeStyles 接管
                                placeHandles(); // 行高变化后所有把手 top 复位（防快照漂移拖错行）
                                onUpdate();
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                        window.addEventListener('pointercancel', onUp);
                });
        });

        // 全表右下角缩放把手：8 方向拖拽（左上角固定原点），宽度增量均分到每列、高度增量均分到每行，
        // 每个单元格同步膨胀/压缩；mouseup 后 onUpdate() 写回源码（colWidths/rowHeights 随 serialize 持久化）
        const cornerSize = Math.max(hit, 14);
        const corner = overlay.createDiv({ cls: 'vt-rc-handle vt-rc-corner' });
        // 位置：贴表格右下角；表格宽于 wrap（横向滚动）时钳制在 wrap 可视右缘，保证始终可点
        const placeCorner = () => {
                corner.style.left = `${Math.min(table.offsetWidth, wrap.scrollLeft + wrap.clientWidth) - cornerSize}px`;
                corner.style.top = `${wrap.scrollTop + table.offsetHeight - cornerSize}px`;
                corner.style.width = `${cornerSize}px`;
                corner.style.height = `${cornerSize}px`;
        };
        placeCorner();
        // 表格尺寸变化（行高自膨胀/单元格文字撑高/增删行列）→ 把手重定位：
        // placeCorner/placeHandles 只在挂载时算一次，内容变多撑大表格后停在旧位（用户实测"不跟着走"）。
        // RO 观察表格尺寸，回调现查当前把手（重渲染后自动作用于新把手）；同一 wrap 只绑一次
        if (!cornerBinds(wrap).__vtCornerROBound) {
                cornerBinds(wrap).__vtCornerROBound = true;
                new ResizeObserver(() => {
                        placeCorner();
                        placeHandles();
                }).observe(table);
        }
        // wrap 滚动时同步跟随（防重：同一 wrap 只绑一次，listener 现查当前 corner，重渲染后自动作用于新把手）
        if (!cornerBinds(wrap).__vtCornerScrollBound) {
                cornerBinds(wrap).__vtCornerScrollBound = true;
                wrap.addEventListener('scroll', () => {
                        const c = wrap.querySelector<HTMLElement>('.vt-rc-corner');
                        if (!c) return;
                        const cs = Math.max(hit, 14);
                        c.style.left = `${Math.min(table.offsetWidth, wrap.scrollLeft + wrap.clientWidth) - cs}px`;
                        c.style.top = `${wrap.scrollTop + table.offsetHeight - cs}px`;
                }, { passive: true });
        }
        // 问题4：列/行把手滚动跟随（与 corner 同款防重；placeHandles 现查当前把手，重渲染后自动作用）
        placeHandles();
        if (!cornerBinds(wrap).__vtHandleScrollBound) {
                cornerBinds(wrap).__vtHandleScrollBound = true;
                wrap.addEventListener('scroll', placeHandles, { passive: true });
        }
        corner.addEventListener('touchstart', (te) => te.preventDefault(), { passive: false });
        corner.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const colgroup = table.querySelector('colgroup');
                if (cols < 1 || rows.length < 1) return;
                if (!data.colWidths) data.colWidths = [];
                if (!data.rowHeights) data.rowHeights = [];
                // 补齐起始列宽/行高（缺省从 DOM 实测），保证松手写回时数组完整
                for (let c = 0; c < cols; c++) {
                        if (data.colWidths[c] == null) {
                                const col = colgroup?.children[c] as HTMLElement | undefined;
                                const w = col ? parseFloat(col.style.width) : NaN;
                                const cells = Array.from(rows[0]?.querySelectorAll<HTMLTableCellElement>('td') ?? []);
                                const td = cells.find(x => parseInt(x.dataset.vtC ?? '-1', 10) === c);
                                data.colWidths[c] = Number.isFinite(w) ? w : (td?.offsetWidth ?? 120);
                        }
                }
                rows.forEach((tr, r) => {
                        if (data.rowHeights![r] == null) data.rowHeights![r] = tr.offsetHeight;
                });
                const startWs: number[] = [];
                for (let c = 0; c < cols; c++) startWs[c] = data.colWidths[c] ?? 120;
                const startHs = rows.map((_, r) => data.rowHeights![r] ?? 24);
                const startX = e.clientX;
                const startY = e.clientY;

                const applyPreview = (dx: number, dy: number) => {
                        // 均分 + 逐项钳制（撞最小值的列/行固定，其余仍按均分增量）
                        for (let c = 0; c < cols; c++) {
                                const w = Math.max(40, Math.round(startWs[c] + dx / cols));
                                data.colWidths![c] = w;
                                const col = colgroup?.children[c] as HTMLElement | undefined;
                                if (col) col.style.width = `${w}px`;
                        }
                        rows.forEach((tr, r) => {
                                const h = Math.max(24, Math.round(startHs[r] + dy / rows.length));
                                data.rowHeights![r] = h;
                                tr.style.height = `${h}px`;
                                // 同行高把手：rowSpan>1 的格子不锁 minHeight（跨行分摊会误撑别的行）
                                tr.querySelectorAll<HTMLTableCellElement>('td').forEach(td => {
                                        if ((td.rowSpan ?? 1) > 1) return;
                                        td.style.minHeight = `${h}px`;
                                });
                        });
                        placeCorner(); // 把手跟随表格新尺寸
                };

                const onMove = (ev: PointerEvent) => {
                        applyPreview(Math.round(ev.clientX - startX), Math.round(ev.clientY - startY));
                };
                const onUp = (ev: PointerEvent) => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                        try { corner.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                        onUpdate();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
        });
}

/** RC：仅当内容实际溢出时才撑高行，避免累积增长 */
export function autoExpandRowHeight(
        td: HTMLTableCellElement,
        data: VtData,
        r: number,
        contentChanged: boolean,
) {
        if (data.mode !== 'RC' || !contentChanged) return;
        // 仅当内容溢出时才扩展
        if (td.scrollHeight <= td.clientHeight) return;
        const needed = td.scrollHeight + 4;
        if (!data.rowHeights) data.rowHeights = [];
        const cur = data.rowHeights[r] ?? 0;
        if (needed > cur) {
                data.rowHeights[r] = needed;
                const tr = td.closest<HTMLTableRowElement>('tr');
                if (tr) tr.style.height = `${needed}px`;
                // rowSpan>1 的格子不锁 minHeight（跨行分摊会误撑别的行），撑 tr 即可
                if ((td.rowSpan ?? 1) <= 1) td.style.minHeight = `${needed}px`;
        }
}
