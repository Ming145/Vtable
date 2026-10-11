/**
 * diag.ts — 斜分单元格（对角线表头）
 *
 * 数据模型（builder.ts Cell）：
 *   dg?: string — 存在即斜分格；值为右上区（区域1）纯文本，'' = 右上区空。
 *   t           — 左下区（区域2）纯文本（斜分格内 t 不再是 HTML 语义）。
 *
 * 显示态 DOM（td.vt-diag，td position:relative）：
 *   svg.vt-diag-line     — 对角线（0,0 → 100%,100%，stroke 跟随表格边框色）
 *   div.vt-diag-zone.vt-diag-a — 区域1（右上，text-align:right）
 *   div.vt-diag-zone.vt-diag-b — 区域2（左下）
 *   div.vt-diag-probe    — 不可见占位（两行文本参与表格布局）：
 *                           宽 = max(区1宽, 区2宽) 撑列宽、高 = 两行撑行高，
 *                           内容过长时由表格自动布局加宽/加高（OL/HS 免费，
 *                           RC 行高走 autoExpandRowHeight）。
 *
 * 编辑态：目标 zone contentEditable='true'（单行：Enter 拦截/切区/出格，
 * 粘贴纯文本化），td 保持焦点锚角色。事件全部委托在 td 上（一次绑定，
 * populate 重建子 DOM 不丢监听）。
 *
 * 零 obsidian 依赖：仅标准 DOM API，可裸页面 Playwright 直测。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function isDiag(cd: { dg?: string } | undefined | null): boolean {
        return !!cd && cd.dg !== undefined;
}

/** HTML/源文本 → 纯文本（<br> → 换行，其余标签剥除）——开斜分时把存量 t 降为纯文本 */
export function diagPlainText(html: string): string {
        // DOMParser 独立文档解析（不执行脚本/不加载资源），替代 innerHTML 剥标签取纯文本
        const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
        return (doc.body.textContent ?? '').replace(/\n+/g, ' ').trim();
}

/** 斜分格显示用的纯文本（防御：万一 t 里混入了标签/换行，剥掉保证单行） */
export function diagDisplayText(v: string): string {
        if (!v.includes('<') && !v.includes('\n')) return v;
        return diagPlainText(v);
}

export interface DiagDom {
        zoneA: HTMLDivElement;
        zoneB: HTMLDivElement;
        probeA: HTMLSpanElement;
        probeB: HTMLSpanElement;
}

/** 构建斜分格显示态 DOM（populate 时调用；事件由 bindDiagTd 一次性委托）
 *
 * 焦点模型（headless 实测定案）：
 *   td 改 contentEditable='false' + tabIndex=0 —— td 若保持可编辑，
 *   zone.focus() 不生效且 placeCaret 的 selection 会把焦点规范化回 td；
 *   tabIndex 保证 td 仍是键盘导航/程序聚焦的锚点。
 *   两个 zone 常驻 contentEditable='true'（点击即编辑，免动态切换）。
 */
export function buildDiagDom(td: HTMLTableCellElement, dg: string, t: string): DiagDom {
        td.classList.add('vt-diag');
        td.contentEditable = 'false';
        td.tabIndex = 0;

        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
        svg.setAttribute('class', 'vt-diag-line');
        svg.setAttribute('aria-hidden', 'true');
        const line = document.createElementNS(SVG_NS, 'line') as unknown as SVGLineElement;
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '0');
        line.setAttribute('x2', '100%');
        line.setAttribute('y2', '100%');
        svg.appendChild(line);
        td.appendChild(svg);

        const zoneA = createEl('div');
        zoneA.className = 'vt-diag-zone vt-diag-a';
        zoneA.contentEditable = 'true';
        const zoneB = createEl('div');
        zoneB.className = 'vt-diag-zone vt-diag-b';
        zoneB.contentEditable = 'true';
        td.appendChild(zoneA);
        td.appendChild(zoneB);

        // 占位：两行（区1、区2）普通流元素，visibility:hidden——
        // 参与表格布局：撑列宽（单行 nowrap 最宽者）与行高（两行）
        const probe = createEl('div');
        probe.className = 'vt-diag-probe';
        const probeA = createEl('span');
        const probeB = createEl('span');
        probe.appendChild(probeA);
        probe.appendChild(probeB);
        td.appendChild(probe);

        syncDiagText({ zoneA, zoneB, probeA, probeB }, dg, t);
        return { zoneA, zoneB, probeA, probeB };
}

/** 用 grid 数据刷新显示文本（populate/重渲染） */
export function syncDiagText(dom: DiagDom, dg: string, t: string): void {
        const a = diagDisplayText(dg);
        const b = diagDisplayText(t);
        dom.zoneA.textContent = a;
        dom.zoneB.textContent = b;
        dom.probeA.textContent = a;
        dom.probeB.textContent = b;
}

/** 点击点是否落在区域1（斜线上方/右上）：对角线 y = x * h/w */
export function pointInZoneA(td: HTMLTableCellElement, clientX: number, clientY: number): boolean {
        const rect = td.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (rect.width <= 0 || rect.height <= 0) return false;
        return y * rect.width < x * rect.height;
}

export interface DiagHandlers {
        /** 方向键出格导航（复用现有 moveFocus） */
        move: (dr: number, dc: number) => void;
        /** 区域2 按 Enter：出格（focusout 写回后跳下一行） */
        onExitCell: () => void;
        /** zone 获焦（点击/程序 focus 转移）：render 登记聚焦状态+编辑 UI（不 placeCaret，
         *  点击定位的 caret 由浏览器原生给出，程序路径的 caret 在 enterDiagZone 里落位） */
        onZoneFocus: (zone: HTMLElement) => void;
        /** 区域失焦且目标可能在格外：延迟一拍由 render 按焦点实际落点收尾 */
        onZoneLeave: () => void;
}

const ZONE_SEL = '.vt-diag-zone';

/** 一次性事件委托（td 创建时绑定；populate 重建子 DOM 不受影响） */
export function bindDiagTd(td: HTMLTableCellElement, handlers: DiagHandlers): void {
        // focusin：zone 获焦（点击 zone 直接编辑，或 enterDiagZone 的程序 focus）
        // → render 登记聚焦状态/编辑 UI。不 placeCaret（点击定位由浏览器原生给出）
        td.addEventListener('focusin', (e) => {
                const zone = (e.target as HTMLElement);
                if (!zone.matches?.(ZONE_SEL)) return;
                handlers.onZoneFocus(zone);
        });

        // 输入：实时同步占位（撑列宽/行高）
        td.addEventListener('input', (e) => {
                const zone = (e.target as HTMLElement);
                if (!zone.matches?.(ZONE_SEL)) return;
                syncProbeFromZone(td, zone);
        });

        // 粘贴纯文本化 + 去换行（单行约束）
        td.addEventListener('paste', (e) => {
                const zone = (e.target as HTMLElement);
                if (!zone.matches?.(ZONE_SEL)) return;
                const clip = e.clipboardData;
                if (!clip) return;
                e.preventDefault();
                const text = (clip.getData('text/plain') ?? '').replace(/[\r\n]+/g, ' ');
                insertPlainTextAtCaret(zone, text);
                syncProbeFromZone(td, zone);
        });

        // 拖放文本进来同纯文本化（拖 word/选区常见换行）
        td.addEventListener('drop', (e) => {
                const zone = (e.target as HTMLElement)?.closest?.(ZONE_SEL);
                if (!zone) { e.preventDefault(); return; }
                e.preventDefault();
                const text = (e.dataTransfer?.getData('text/plain') ?? '').replace(/[\r\n]+/g, ' ');
                insertPlainTextAtCaret(zone, text);
                syncProbeFromZone(td, zone);
        });

        // zone 失焦：写回暂存；焦点去向决定是否触发离格收尾
        td.addEventListener('focusout', (e) => {
                const zone = e.target as HTMLElement;
                if (!zone.matches?.(ZONE_SEL)) return;
                writeDiagZoneText(td, zone);
                const to = e.relatedTarget as Node | null;
                if (to && td.contains(to)) return; // 格内转移（切区）：只写回
                handlers.onZoneLeave(); // 出格：延迟一拍由 render 判定（iPad relatedTarget=null 兜底）
        });

        // 键盘：Enter 切区/出格；方向键边界出格
        td.addEventListener('keydown', (e) => {
                const zone = (e.target as HTMLElement);
                if (!zone.matches?.(ZONE_SEL)) return;
                const isA = zone.classList.contains('vt-diag-a');
                if (e.key === 'Enter' && !e.isComposing) {
                        e.preventDefault();
                        if (isA) switchZone(td, 'b');
                        else handlers.onExitCell();
                        return;
                }
                if (e.isComposing) return;
                if (e.key === 'ArrowUp' && isA) { e.preventDefault(); handlers.move(-1, 0); return; }
                if (e.key === 'ArrowDown' && !isA) { e.preventDefault(); handlers.move(1, 0); return; }
                if (e.key === 'ArrowLeft' && isA && caretAtStart(zone)) { e.preventDefault(); handlers.move(0, -1); return; }
                if (e.key === 'ArrowRight' && !isA && caretAtEnd(zone)) { e.preventDefault(); handlers.move(0, 1); return; }
        });
}

/** 进入某 zone 编辑态（zoneA/zoneB 二选一；another 保留静态）。
 *  无 target 时按 td.dataset.vtDiagZone 路由，未设默认 'b'（左下主文本区）。
 *  zone 常驻可编辑：只负责 focus+caret 落位，状态登记在 onZoneFocus 回调里 */
export function enterDiagZone(td: HTMLTableCellElement, target?: HTMLElement): void {
        const wantB = target ? target.classList.contains('vt-diag-b') : (td.dataset.vtDiagZone ?? 'b') === 'b';
        const zone = (wantB ? td.querySelector('.vt-diag-b') : td.querySelector('.vt-diag-a')) as HTMLElement | null;
        if (!zone) return;
        td.dataset.vtDiagZone = wantB ? 'b' : 'a';
        if (document.activeElement !== zone) {
                zone.focus();
        }
        placeCaretAtEnd(zone);
}

/** 显示→编辑前初始化（td focus 分支/zone 获焦时调用）：
 *  zone 常驻可编辑（buildDiagDom 已设），这里只标记编辑态视图 */
export function prepareDiagEdit(td: HTMLTableCellElement): void {
        td.dataset.vtView = 'edit';
        td.querySelectorAll<HTMLElement>('.vt-diag-zone').forEach((z) => { z.spellcheck = false; });
}

/** 编辑收尾（离开斜分格）：重建显示文本（zone 保持常驻可编辑，不动 CE） */
export function exitDiagEdit(td: HTMLTableCellElement, dg: string, t: string): void {
        td.dataset.vtView = 'view';
        const dom: DiagDom = {
                zoneA: td.querySelector('.vt-diag-a')!,
                zoneB: td.querySelector('.vt-diag-b')!,
                probeA: td.querySelector('.vt-diag-probe span:nth-child(1)')!,
                probeB: td.querySelector('.vt-diag-probe span:nth-child(2)')!,
        };
        syncDiagText(dom, dg, t);
}

/** zone 内容 → grid 写回目标字段（纯文本、去换行） */
export function readZoneText(zone: HTMLElement): string {
        return (zone.textContent ?? '').replace(/[\r\n]+/g, ' ');
}

/* ===== 内部 ===== */

function syncProbeFromZone(td: HTMLTableCellElement, zone: HTMLElement): void {
        const probe = td.querySelector('.vt-diag-probe');
        if (!probe) return;
        const idx = zone.classList.contains('vt-diag-a') ? 1 : 2;
        const span = probe.querySelector(`span:nth-child(${idx})`);
        if (span) span.textContent = readZoneText(zone);
}

/** zone 内容 → dataset 暂存写回（grid 落盘由 render.ts 收尾流程统一做）。
 *  纯文本、去换行（单行约束） */
export function writeDiagZoneText(td: HTMLTableCellElement, zone: HTMLElement): void {
        const text = (zone.textContent ?? '').replace(/[\r\n]+/g, ' ');
        td.dataset[zone.classList.contains('vt-diag-a') ? 'vtDiagA' : 'vtDiagB'] = text;
}

function switchZone(td: HTMLTableCellElement, to: 'a' | 'b'): void {
        const from = td.querySelector<HTMLElement>(to === 'b' ? '.vt-diag-a' : '.vt-diag-b');
        if (from) from.blur(); // CE 常驻，只失焦（focusout 自动写回暂存）
        const zone = td.querySelector<HTMLElement>(to === 'b' ? '.vt-diag-b' : '.vt-diag-a');
        if (!zone) return;
        td.dataset.vtDiagZone = to;
        zone.focus();
        placeCaretAtEnd(zone);
}

function caretAtStart(zone: HTMLElement): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const node = sel.focusNode;
        if (node === zone) return (sel.focusOffset ?? 0) === 0;
        if (node?.parentElement === zone && node.nodeType === Node.TEXT_NODE) return (sel.focusOffset ?? 0) === 0;
        return false;
}

function caretAtEnd(zone: HTMLElement): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const node = sel.focusNode;
        const len = zone.textContent?.length ?? 0;
        if (node === zone) return (sel.focusOffset ?? 0) === len;
        if (node?.parentElement === zone && node.nodeType === Node.TEXT_NODE) {
                return (sel.focusOffset ?? 0) === (node.textContent?.length ?? 0);
        }
        return false;
}

function placeCaretAtEnd(zone: HTMLElement): void {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNodeContents(zone);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
}

function insertPlainTextAtCaret(zone: HTMLElement, text: string): void {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !zone.contains(sel.focusNode)) {
                // 无选区：追加到末尾
                zone.appendChild(document.createTextNode(text));
                return;
        }
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
}
