/**
 * wysiwyg.ts — 单元格所见即所得编辑（Typora 式块级源码切换）
 *
 * 模型（经用户确认的需求）：
 *  - 单元格源码解析为有序「段」序列：对称包裹语法 = 块；残缺/跨行 → 普通文本
 *  - 编辑态 DOM：td 下按源码顺序排列 span.vt-seg（块级 fence 用 block）
 *      · 渲染段（md/fence/void）：显示渲染效果，data-src 存源码原文
 *      · 文本段（text）：永远显示源码（textContent，与源码恒等）
 *  - 光标（任何方式移动，含点击/键盘）进入渲染段 → 整段切源码；离开 → 重新渲染
 *  - 残缺块永远按普通文本处理（不强制渲染回去）
 *  - 输入法 composition 期间冻结一切检测与重建
 *  - 渲染段永不直接编辑（光标进入即切源码）→ 源码投影无需从渲染 HTML 反推
 *  - <br> 与 wysiwyg 分立（用户钉死）：所见即所得只管块，<br> 不算块——
 *      它只是两行之间的行分隔线，块配对绝不越过它；本模块不管理换行，
 *      只负责认出 <br> 并放行为真标签（用户永远看不到 <br> 字面，同旧版本）。
 *      换行的一切管理（normalize/序列化/Enter 默认行为）归旧版本管线，原样不动
 *  - mermaid 不归本模块（归旧版本管线）：```mermaid 按普通 fence 代码块显示
 *
 * 关键不变量：
 *  - 源码态段 DOM = 纯 text node（+ 浏览器异常插入的 <br>，投影时还原）
 *  - 渲染态段源码 = data-src（原文，不可能被编辑污染）
 */

import { escapeHtml, normalizeCellNewlines } from './builder';
import { parseMarkdownTable } from './paste-grid';
import { parseTrustedHtml } from './html';

export interface WysiwygCtx {
        sourcePath: string;
        resolveImage: (linkText: string) => string | null;
        onTodoToggle?: (idx: number, checked: boolean) => void;
        onOpenLink?: (linkText: string) => void;
        /** 复用 render.ts 的渲染 pass（renderInlineCode/renderMarkdown/renderImages/renderWikiLinks/renderTodos） */
        renderPasses: (el: HTMLElement, ctx: WysiwygCtx) => void;
        /** markdown 表格网格粘贴（render.ts 闭包提供：以 (r0,c0) 为左上角覆盖写入，越界吞掉）。
         *  点击格激活即 wysiwyg 态，paste 走本模块 capture handler —— md 检测必须在此、
         *  经回调回 render 闭包执行网格写入 */
        onMdGridPaste?: (r0: number, c0: number, rows: string[][]) => void;
}

export type SegKind = 'text' | 'md' | 'fence' | 'br' | 'void-img' | 'void-entity';

export interface Seg {
        kind: SegKind;
        raw: string;
        start: number; // 源码区间 [start, end)
        end: number;
        /** md 段：渲染文本 → 源码偏移补偿（源码偏移 ≈ start + prefix + 渲染字符偏移） */
        prefix: number;
        suffix: number;
        lang?: string;
}

/* ================================================================
 * 一、解析器
 * ================================================================ */

const FENCE_OPEN_RE = /^```([^\n`]*)\n?/;

/** 允许所见即所得渲染的 HTML 对称标签（inline 格式类；<br>/<img> 走 void 规则） */
const HTML_PAIR_TAGS = new Set([
        'b', 'i', 'u', 's', 'em', 'strong', 'mark', 'sub', 'sup',
        'small', 'font', 'span', 'kbd', 'del', 'ins', 'cite', 'q', 'abbr',
]);
/** text 段推进时停下的「潜在块开头」字符 */
const TRIGGER_RE = /[*`~=$[!<&_]/;
/** 输入这些字符后必须重建段结构 */
const SYNTAX_INPUT_RE = /[`*_~=$[\]!<&]/;

export function parseSegments(src: string): Seg[] {
        const segs: Seg[] = [];
        let pos = 0;
        let textStart = -1;

        const flushText = (upto: number) => {
                if (textStart >= 0 && upto > textStart) {
                        segs.push({ kind: 'text', raw: src.slice(textStart, upto), start: textStart, end: upto, prefix: 0, suffix: 0 });
                }
                textStart = -1;
        };

        while (pos < src.length) {
                const rest = src.slice(pos);
                // 行内语法的作用域边界：下一个 <br> 之前（换行是行分隔——两行的 ` 不配对、
                // ** 不跨行；fence 是唯一跨行块，用全文 rest）
                const brM = /<br\s*\/?>/i.exec(rest);
                const lineRest = brM ? rest.slice(0, brM.index) : rest;
                let m: RegExpExecArray | null;

                // 1) 代码围栏 ```（唯一允许跨行的块）
                if ((m = FENCE_OPEN_RE.exec(rest))) {
                        const lang = (m[1] || '').trim();
                        const bodyStart = pos + m[0].length;
                        const closeIdx = src.indexOf('```', bodyStart);
                        if (closeIdx >= 0) {
                                flushText(pos);
                                const end = closeIdx + 3;
                                const raw = src.slice(pos, end);
                                // prefix = 开围栏整行（```lang\n），suffix = 尾部 ```
                                // ——渲染文本 = 围栏内容，光标映射按此精确补偿（否则点代码块内部会跳进围栏字符里）
                                segs.push({ kind: 'fence', raw, start: pos, end, prefix: m[0].length, suffix: 3, lang });
                                pos = end;
                                continue;
                        }
                }

                // 2) 行分隔线：<br> 不算块、不入段系统（与 wysiwyg 分立，用户钉死）——
                // 认出它、放行为真 br 元素，本模块不管理换行；行内语法（` 配对、** 配对
                // 等）绝不跨行（块不能跨行，跨行就不是块）
                if ((m = /^<br\s*\/?>/i.exec(rest))) { pushVoid('br', m[0]); continue; }
                if ((m = /^<img\b[^>]*\/?>/i.exec(lineRest))) { pushVoid('void-img', m[0]); continue; }
                if ((m = /^&nbsp;/i.exec(lineRest))) { pushVoid('void-entity', m[0]); continue; }
                // markdown 图片 / wiki 嵌入（中间的 alt 不作为文本编辑，整块贴边显示源码）
                if ((m = /^!\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(lineRest))) { pushVoid('void-img', m[0]); continue; }
                if ((m = /^!\[\[([^\]\n]+)\]\]/.exec(lineRest))) { pushVoid('void-img', m[0]); continue; }

                // 3) 数学（$ 与 $$，同行；与现有渲染管线一致不跨行）
                if ((m = /^\$\$([^$\n]+?)\$\$/.exec(lineRest))) { pushMd(m[0], 2, 2); continue; }
                if ((m = /^\$(?!\s)([^$\n]*?\S)\$/.exec(lineRest))) { pushMd(m[0], 1, 1); continue; }

                // 4) 强调类（同行；优先级从长到短）
                if ((m = /^\*\*\*(?=\S)([^\n]*?\S)\*\*\*/.exec(lineRest))) { pushMd(m[0], 3, 3); continue; }
                if ((m = /^___(?=\S)([^\n]*?\S)___/.exec(lineRest)) && wordOk(pos, m[0].length)) { pushMd(m[0], 3, 3); continue; }
                if ((m = /^\*\*(?=\S)([^\n]*?\S)\*\*/.exec(lineRest))) { pushMd(m[0], 2, 2); continue; }
                if ((m = /^__(?!_)(?=\S)([^\n]*?\S)__(?!\w)/.exec(lineRest)) && wordOk(pos, m[0].length)) { pushMd(m[0], 2, 2); continue; }
                if ((m = /^\*(?=\S)([^\n]*?\S)\*/.exec(lineRest))) { pushMd(m[0], 1, 1); continue; }
                if ((m = /^_(?=\S)([^\n]*?\S)_(?!\w)/.exec(lineRest)) && wordOk(pos, m[0].length)) { pushMd(m[0], 1, 1); continue; }

                // 5) 高亮 / 删除线 / 行内代码
                if ((m = /^==(?=\S)([^\n]*?\S)==/.exec(lineRest))) { pushMd(m[0], 2, 2); continue; }
                if ((m = /^~~(?=\S)([^\n]*?\S)~~/.exec(lineRest))) { pushMd(m[0], 2, 2); continue; }
                if ((m = /^`([^`\n]+)`/.exec(lineRest))) { pushMd(m[0], 1, 1); continue; }

                // 6) 链接 / wiki
                if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(lineRest))) { pushMd(m[0], 1, 1); continue; }
                if ((m = /^\[\[([^\]\n]+)\]\]/.exec(lineRest))) { pushMd(m[0], 2, 2); continue; }

                // 7) HTML 对称标签（<b>x</b>、<span style="..">x</span> 等，同行；<br>/<img> 已在上面 void 处理）
                if ((m = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/.exec(lineRest)) && HTML_PAIR_TAGS.has(m[1]!.toLowerCase())) {
                        const tag = m[1]!;
                        const closeIdx = lineRest.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, m[0].length);
                        if (closeIdx > m[0].length) {
                                const closeLen = tag.length + 3;
                                pushMd(lineRest.slice(0, closeIdx + closeLen), m[0].length, closeLen);
                                continue;
                        }
                }

                // 无匹配：当前字符归 text，推进到下一个潜在开头字符
                if (textStart < 0) textStart = pos;
                const restStr = src.slice(pos + 1);
                const nextIdx = restStr.search(TRIGGER_RE);
                pos = nextIdx >= 0 ? pos + 1 + nextIdx : src.length;
        }
        flushText(src.length);
        return segs;

        function wordOk(start: number, len: number): boolean {
                // 下划线系语法的单词边界约束（与 mdInlineToHtml 保持一致，避免误伤 snake_case）
                const before = start > 0 ? src[start - 1]! : '';
                const after = src[start + len] ?? '';
                const isW = (ch: string) => /\w/.test(ch);
                return !isW(before) && !isW(after);
        }

        function pushVoid(kind: SegKind, raw: string) {
                flushText(pos);
                segs.push({ kind, raw, start: pos, end: pos + raw.length, prefix: 0, suffix: 0 });
                pos += raw.length;
        }

        function pushMd(raw: string, prefix: number, suffix: number) {
                flushText(pos);
                segs.push({ kind: 'md', raw, start: pos, end: pos + raw.length, prefix, suffix });
                pos += raw.length;
        }
}

/* ================================================================
 * 二、DOM 构建
 * ================================================================ */

const SEG_CLS = 'vt-seg';

export function isWysiwyg(td: HTMLElement): boolean {
        return td.dataset.vtWysiwyg === '1';
}

/** 进入所见即所得编辑：构建段 DOM（默认全渲染态，text 段恒源码） */
export function enterWysiwyg(td: HTMLElement, src: string, ctx: WysiwygCtx): void {
        td.dataset.vtWysiwyg = '1';
        td.textContent = '';
        for (const seg of parseSegments(src)) {
                td.appendChild(buildSegEl(seg, ctx));
        }
        // 末尾锚点：源码以换行结尾（末尾空行）时，末尾 br 后补一个空文本段——
        // 没有它，末尾 br 是 td 末尾的孤立真元素、后面无可编辑锚点，光标放不进去
        //（实测：Enter 加空行离焦再进格，空的换行点不到）。空段投影输出空串，零污染
        if (td.lastChild instanceof HTMLBRElement) {
                const tail = createEl('span');
                tail.className = SEG_CLS;
                tail.dataset.kind = 'text';
                tail.dataset.view = 'src';
                tail.dataset.src = '';
                tail.dataset.s = String(src.length);
                tail.dataset.e = String(src.length);
                tail.dataset.prefix = '0';
                tail.dataset.suffix = '0';
                // 占位 nbsp：空 span 无法承载 caret（Chromium 规范化回前段——"光标进不去空行"
                // 的真根因），nbsp 给锚点段一个实体文本位；配合 beforeinput 锚点边界拦截
                //（输入/删除走源码域）消除占位符副作用，投影时过滤不进源码域
                tail.textContent = '\u00A0';
                td.appendChild(tail);
        }
}

export function exitWysiwyg(td: HTMLElement): void {
        delete td.dataset.vtWysiwyg;
}

function buildSegEl(seg: Seg, ctx: WysiwygCtx): HTMLElement {
        // 行分隔线：真 <br> 元素，不是段——不带 SEG_CLS/任何 dataset，段系统对它不可见
        //（与 wysiwyg 分立，用户钉死：br 永远显示为真换行，永不出现 <br> 字面）
        // data-vt-br 标记"重放的换行 br"：与浏览器运行时自插的占位 br 区分开
        //（Chromium 删空段后会在空段前插占位 br 保光标，投影时按此标记剔除占位）
        if (seg.kind === 'br') {
                const br = createEl('br') as unknown as HTMLElement;
                br.dataset.vtBr = '1';
                return br;
        }
        // 全部用 span：块级 fence 用 display:block。
        // 不用 div —— Chromium 在"块级元素后缘"打字会把字符插进 div 内部（beforeinput 都不触发），
        // 渲染段投影走 data-src → 字符静默丢失；inline span 后缘输入落在 td 直下，数据安全
        const el = createEl('span');
        el.className = SEG_CLS;
        if (seg.kind === 'fence') el.setCssProps({ display: 'block' });
        el.dataset.kind = seg.kind;
        el.dataset.src = seg.raw;
        el.dataset.s = String(seg.start);
        el.dataset.e = String(seg.end);
        el.dataset.prefix = String(seg.prefix);
        el.dataset.suffix = String(seg.suffix);
        if (seg.kind === 'text') {
                el.dataset.view = 'src'; // 文本段恒源码
                el.textContent = seg.raw;
        } else {
                renderSegContent(el, seg, ctx);
        }
        return el;
}

/** 渲染段内容（复用离焦渲染管线，保证"与离焦后看到的一样"） */

/** wiki 图拖拽调宽（仅 `![[...]]`；HTML/<img> 与 md 图语法不支持尺寸写回，不挂柄）。
 *  柄=右下角主题色半透明磨砂三角；拖动实时改 img 宽度并把数字同步进 data-src
 *  （flush/离焦时随 projectSource 落回源码）；全程 preventDefault——不动光标/选区。
 *  柄挂在渲染段内部：光标贴近块两边切源码态时随段重建自然消失，离开编辑模式重渲染后亦无 */
function attachImgResize(seg: HTMLElement): void {
        const raw = seg.dataset.src ?? '';
        if (!/^!\[\[[^\]\n]+\]\]$/.test(raw)) return; // 仅 wiki 嵌入
        const img = seg.querySelector('img');
        if (!img) return;
        seg.classList.add('vt-img-seg');
        const grip = createEl('div');
        grip.className = 'vt-img-resize';
        grip.setAttribute('aria-hidden', 'true');
        // L 形折角（用户 2026-10-07 定稿形状，21:50 调细）：竖臂在上、横臂在左，圆头细线圆拐角；
        // 浅灰（表格边缘同色）走 CSS currentColor，命中区为更大的圆形（见 styles.css）
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M17 5 L17 17 L5 17');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2.75');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        grip.appendChild(svg);
        seg.appendChild(grip);

        grip.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startW = img.getBoundingClientRect().width;
                const onMove = (ev: PointerEvent) => {
                        const w = Math.max(24, Math.round(startW + (ev.clientX - startX)));
                        img.setCssProps({ width: `${w}px` });
                        syncImgSrcWidth(seg, w);
                };
                const onUp = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
        });
}

/** 把新宽度写回段源码：已有 |数字 → 原格式替换；无 | → 追加 " | w"；| 后是 alt（非数字）→ 追加 |w */
function syncImgSrcWidth(seg: HTMLElement, w: number): void {
        const raw = seg.dataset.src ?? '';
        let next: string;
        if (/\|\s*\d+\s*\]\]$/.test(raw)) next = raw.replace(/\|(\s*)\d+(\s*\]\])$/, `|$1${w}$2`);
        else if (/\|[^\]]*\]\]$/.test(raw)) next = raw.replace(/\]\]$/, `|${w}]]`);
        else next = raw.replace(/\]\]$/, ` | ${w}]]`);
        seg.dataset.src = next;
}

function renderSegContent(el: HTMLElement, seg: Seg, ctx: WysiwygCtx): void {
        el.dataset.view = 'render';
        el.dataset.src = seg.raw;
        switch (seg.kind) {
                case 'void-entity':
                        el.textContent = '\u00A0';
                        break;
                case 'void-img':
                        el.replaceChildren(...parseTrustedHtml(seg.raw).childNodes);
                        ctx.renderPasses(el, ctx);
                        attachImgResize(el);
                        break;
                case 'fence': {
                        const body = seg.raw.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '');
                        const pre = el.createEl('pre', { cls: 'vt-code' });
                        pre.createEl('code', { text: body });
                        break;
                }
                default: {
                        // md / text：HTML 直通 + 行内渲染 pass（与 populateCell 行为一致）。
                        // 行内段不含 <br>（换行在解析阶段已按行分隔放行为真 br 元素）
                        el.replaceChildren(...parseTrustedHtml(seg.raw).childNodes);
                        ctx.renderPasses(el, ctx);
                }
        }
}

/** 段切源码态（textContent 与源码恒等） */
function setSegSource(el: HTMLElement, raw: string): void {
        el.dataset.view = 'src';
        el.dataset.src = raw;
        el.textContent = raw;
}

/* ================================================================
 * 三、投影（DOM → 源码）
 * ================================================================ */

export function projectSource(td: HTMLElement): string {
        let out = '';
        for (const child of Array.from(td.childNodes)) {
                if (!(child instanceof HTMLElement) || !child.classList.contains(SEG_CLS)) {
                        out += looseNodeSource(child); // 防御：浏览器插入的游离节点（含 Enter 产生的 <div>/<br>）
                        continue;
                }
                if (child.dataset.view === 'src') out += srcTextOf(child);
                else out += child.dataset.src ?? child.textContent ?? '';
        }
        return out;
}

/** 光标是否停在末尾锚点边界：最后节点是空锚点段、且光标偏移正好等于它的源码位置 */
function atTailAnchor(td: HTMLElement, off: number): boolean {
        const last = td.lastChild;
        if (!(last instanceof HTMLElement) || last.dataset.src !== '' || !last.classList.contains(SEG_CLS)) return false;
        return parseInt(last.dataset.s ?? '-1', 10) === off;
}

/** 游离节点的源码还原：text → 原文；<br> → '<br>'；
 *  块级元素（Enter 默认行为产生的 <div>/<p>）→ 内容 + 前置 '<br>'（换行语义）；
 *  其它 inline 元素 → textContent */
function looseNodeSource(n: Node): string {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
        if (n instanceof HTMLBRElement) return '<br>';
        if (n instanceof HTMLElement) {
                const isBlock = /^(DIV|P|LI|UL|OL|H[1-6])$/i.test(n.tagName);
                const inner = Array.from(n.childNodes).map(looseNodeSource).join('');
                return isBlock ? '<br>' + inner : inner;
        }
        return n.textContent ?? '';
}

/** 源码态段：text node → 原文；<br> → '<br>'；块级元素（Enter 产生）→ '<br>'+内容；其它 → textContent */
function srcTextOf(el: HTMLElement): string {
        // 锚点段（空 data-src）的占位 nbsp 不进源码域；普通段实况原样保留
        const isAnchor = el.dataset.src === '';
        let out = '';
        for (const n of Array.from(el.childNodes)) {
                if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
                else if (n instanceof HTMLBRElement) out += '<br>';
                else if (n instanceof HTMLElement && /^(DIV|P|LI|UL|OL|H[1-6])$/i.test(n.tagName)) {
                        out += '<br>' + Array.from(n.childNodes).map(looseNodeSource).join('');
                } else out += n.textContent ?? '';
        }
        return isAnchor ? out.replace(/[\u200B\u00A0]/g, '') : out;
}

/* ================================================================
 * 四、光标工具（源码偏移 ↔ DOM 位置）
 * ================================================================ */

function segEls(td: HTMLElement): HTMLElement[] {
        return Array.from(td.children).filter(
                (c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains(SEG_CLS),
        );
}

interface LocateResult {
        el: HTMLElement | null; // 所在段
        kind: SegKind | null;
        /** 光标相对段的位置：inner（渲染段内文本偏移 innerF）/ 段前缘 / 段后缘 */
        where: 'inner' | 'front' | 'back';
        innerF: number;
}

/** 定位 selection 起点落在哪个段（折叠与非折叠均取 startContainer） */
function locateStart(td: HTMLElement, range: Range): LocateResult {
        const node = range.startContainer;
        const offset = range.startOffset;

        if (node.nodeType === Node.TEXT_NODE) {
                const host = node.parentElement?.closest(`.${SEG_CLS}`);
                if (host instanceof HTMLElement && td.contains(host)) {
                        const f = textOffsetWithin(host, node, offset);
                        return { el: host, kind: (host.dataset.kind as SegKind) ?? 'text', where: 'inner', innerF: f };
                }
                return { el: null, kind: null, where: 'inner', innerF: 0 };
        }

        if (node === td) {
                const childNodes = Array.from(td.childNodes);
                // offset 处的段 → 前缘；offset-1 处的段 → 后缘。
                // 边界歧义（一段后缘 = 另一段前缘）：渲染段优先 —— 用户站在渲染块边缘时应看到块源码
                const next = childNodes[offset] instanceof HTMLElement && (childNodes[offset] as HTMLElement).classList.contains(SEG_CLS)
                        ? (childNodes[offset] as HTMLElement) : null;
                const prev = offset > 0 && childNodes[offset - 1] instanceof HTMLElement && (childNodes[offset - 1] as HTMLElement).classList.contains(SEG_CLS)
                        ? (childNodes[offset - 1] as HTMLElement) : null;
                const isRenderable = (el: HTMLElement) => el.dataset.view !== 'src' && el.dataset.kind !== 'text';
                if (next && isRenderable(next)) return { el: next, kind: next.dataset.kind as SegKind, where: 'front', innerF: 0 };
                if (prev && isRenderable(prev)) return { el: prev, kind: prev.dataset.kind as SegKind, where: 'back', innerF: 0 };
                if (next) return { el: next, kind: next.dataset.kind as SegKind, where: 'front', innerF: 0 };
                if (prev) return { el: prev, kind: prev.dataset.kind as SegKind, where: 'back', innerF: 0 };
                return { el: null, kind: null, where: 'inner', innerF: 0 };
        }

        // 元素（段本身或段内元素）
        const host = (node instanceof HTMLElement ? node : node.parentElement)?.closest(`.${SEG_CLS}`);
        if (host instanceof HTMLElement && td.contains(host)) {
                const elChildren = Array.from(host.childNodes);
                const nextInSeg = elChildren[offset];
                const prevInSeg = offset > 0 ? elChildren[offset - 1] : null;
                // 紧贴 void 渲染元素的边缘
                if (isVoidRenderEl(nextInSeg)) return { el: host, kind: host.dataset.kind as SegKind, where: 'front', innerF: 0 };
                if (isVoidRenderEl(prevInSeg)) return { el: host, kind: host.dataset.kind as SegKind, where: 'back', innerF: 0 };
                if (host.dataset.view === 'src') {
                        const f = srcOffsetWithin(host, node, offset);
                        return { el: host, kind: host.dataset.kind as SegKind, where: 'inner', innerF: f };
                }
                const f = textOffsetWithin(host, node, offset);
                return { el: host, kind: host.dataset.kind as SegKind, where: 'inner', innerF: f };
        }
        return { el: null, kind: null, where: 'inner', innerF: 0 };
}

function isVoidRenderEl(n: Node | undefined): boolean {
        if (!(n instanceof HTMLElement)) return false;
        if (n instanceof HTMLBRElement) return true;
        if (n instanceof HTMLImageElement) return true;
        return n.classList.contains(SEG_CLS) && n.dataset.view === 'render' && (n.dataset.kind ?? '').startsWith('void');
}

/** el 内 text node 流偏移（渲染段：渲染文本坐标） */
function textOffsetWithin(el: HTMLElement, target: Node, offset: number): number {
        let acc = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
                if (n === target) return acc + offset;
                acc += n.textContent?.length ?? 0;
        }
        return acc;
}

/** 源码态段内 DOM 位置 → 段内源码偏移（<br> 计 4 字符） */
function srcOffsetWithin(el: HTMLElement, target: Node, offset: number): number {
        let acc = 0;
        for (const n of Array.from(el.childNodes)) {
                if (n === target) {
                        if (n.nodeType === Node.TEXT_NODE) return acc + offset;
                        if (n instanceof HTMLBRElement) return acc + (offset > 0 ? 4 : 0);
                        return acc + Math.min(offset, n.textContent?.length ?? 0);
                }
                if (n.nodeType === Node.TEXT_NODE) acc += n.textContent?.length ?? 0;
                else if (n instanceof HTMLBRElement) acc += 4;
                else acc += n.textContent?.length ?? 0;
        }
        return acc;
}

/** td 直下游离位置（childNodes 第 idx 项之前）的源码偏移：段按 data-e 累进、游离 text 按长度累加。
 *  换行 <br> 计 4 字符（源码 '<br>' 的长度——换行的底层储存，光标映射必须计入）。
 *  接管段边缘输入时用——不能走 caretSourceOffset 的段映射（back 会映射到闭标记前，逆序插入） */
function looseOffsetAt(td: HTMLElement, idx: number): number {
        let acc = 0;
        const childNodes = Array.from(td.childNodes);
        for (let i = 0; i < childNodes.length; i++) {
                if (i === idx) break;
                const n = childNodes[i]!;
                if (n instanceof HTMLElement && n.classList.contains(SEG_CLS)) acc = parseInt(n.dataset.e ?? '0', 10);
                else if (n instanceof HTMLBRElement) acc += 4;
                else acc += n.textContent?.length ?? 0;
        }
        return acc;
}

/** 折叠光标 → 源码偏移（非 wysiwyg / 不在 td 内返回 null） */
export function caretSourceOffset(td: HTMLElement): number | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        if (!range.collapsed || !td.contains(range.startContainer)) return null;
        // td 直属游离 text node 内部（浏览器在行边界临时插入的文本）：前累计 + 文本内偏移。
        // 不能走下面的游离子分支——那里的 startOffset 是 td 子节点索引，text 内偏移会完全错位
        if (range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentElement === td) {
                const tn = range.startContainer;
                let acc0 = 0;
                for (const n of Array.from(td.childNodes)) {
                        if (n === tn) { acc0 += range.startOffset; break; }
                        if (n instanceof HTMLElement && n.classList.contains(SEG_CLS)) acc0 = parseInt(n.dataset.e ?? '0', 10);
                        else if (n instanceof HTMLBRElement) acc0 += 4;
                        else acc0 += n.textContent?.length ?? 0;
                }
                return acc0;
        }
        const loc = locateStart(td, range);
        if (!loc.el) {
                // 光标在 td 直下游离位置：按相邻段精确算源码偏移
                //（不能粗略返回 totalLen——游离点可能在任意两段之间，粗值会把光标"吸"到格尾）
                const childNodes = Array.from(td.childNodes);
                const idx = range.startOffset;
                let acc = 0;
                for (let i = 0; i < childNodes.length; i++) {
                        const n = childNodes[i]!;
                        if (i === idx) break; // 光标在本节点之前 → acc 即偏移
                        if (n instanceof HTMLElement && n.classList.contains(SEG_CLS)) acc = parseInt(n.dataset.e ?? '0', 10);
                        else if (n instanceof HTMLBRElement) acc += 4; // 换行 <br> = 源码 4 字符
                        else acc += n.textContent?.length ?? 0; // 段间游离 text（浏览器临时插入物）
                }
                return acc;
        }
        const s = parseInt(loc.el.dataset.s ?? '0', 10);
        const e = parseInt(loc.el.dataset.e ?? '0', 10);
        if (loc.el.dataset.view === 'src') {
                // src 态段：DOM 即最新源码（用户可能已改动，data-e 是上次重建的旧边界），
                // 偏移按 DOM 现算【不做 e-s clamp】——否则新输入被旧边界截断（光标错一位连环跳）
                // 末尾锚点段（空占位段）读数恒为段起点 s：nbsp 前缘/后缘的 caret 都代表"源码末尾"，
                // 锚点边界拦截（输入/删除走源码域）依赖这个稳定读数
                if (loc.el.dataset.src === '' && loc.el.classList.contains(SEG_CLS)) return s;
                if (loc.where === 'front') return s;
                if (loc.where === 'back') return s + loc.innerF;
                return s + loc.innerF;
        }
        // 渲染段：prefix 补偿映射。
        // back（贴渲染段后缘游离位）：源码偏移 = looseOffsetAt（段后可能有换行 <br>/游离 text，
        // 统一按 td 直属节点累加——与打字接管的插入算法同一定义，杜绝"两套算法两个答案"）
        const raw = loc.el.dataset.src ?? '';
        if (loc.where === 'back') {
                const idx = Array.from(td.childNodes).indexOf(loc.el) + 1;
                return looseOffsetAt(td, idx);
        }
        if (loc.where === 'front') return s + segPrefix(loc.el);
        const prefix = segPrefix(loc.el);
        const contentLen = Math.max(0, raw.length - prefix - segSuffix(loc.el));
        return s + prefix + Math.min(loc.innerF, contentLen);
}

/** 段的标记补偿（渲染文本↔源码偏移）：dataset 存解析器精确值 */
function segPrefix(el: HTMLElement): number { return parseInt(el.dataset.prefix ?? '0', 10) || 0; }
function segSuffix(el: HTMLElement): number { return parseInt(el.dataset.suffix ?? '0', 10) || 0; }

function totalLen(td: HTMLElement): number {
        const segs = segEls(td);
        return segs.length ? parseInt(segs[segs.length - 1]!.dataset.e ?? '0', 10) : 0;
}

/** 非折叠选区 → 源码区间 [a, b)（复制/剪切用） */
export function selectionSourceRange(td: HTMLElement): { a: number; b: number } | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        if (range.collapsed || !td.contains(range.startContainer) || !td.contains(range.endContainer)) return null;
        const a = rangeOffset(td, range.startContainer, range.startOffset);
        const b = rangeOffset(td, range.endContainer, range.endOffset);
        if (a == null || b == null) return null;
        return { a: Math.min(a, b), b: Math.max(a, b) };
}

function rangeOffset(td: HTMLElement, node: Node, offset: number): number | null {
        const tmp = document.createRange();
        try { tmp.selectNodeContents(td); } catch { return null; }
        try {
                tmp.setEnd(node, offset);
                tmp.collapse(false);
        } catch { return null; }
        // 用投影法：把 td 内容按「源码」投影到临时容器再量长度——开销大；
        // 改用段级累加：定位 node 所在段 + 段内偏移 + data-s
        const host = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof HTMLElement ? node : node.parentElement)?.closest(`.${SEG_CLS}`);
        if (host instanceof HTMLElement && td.contains(host)) {
                const s = parseInt(host.dataset.s ?? '0', 10);
                if (host.dataset.view === 'src') return s + srcOffsetWithin(host, node, offset);
                const f = textOffsetWithin(host, node, offset);
                const raw = host.dataset.src ?? '';
                const prefix = segPrefix(host);
                const contentLen = Math.max(0, raw.length - prefix - segSuffix(host));
                return s + prefix + Math.min(f, contentLen);
        }
        if (node === td) {
                const childNodes = Array.from(td.childNodes);
                const next = childNodes[offset];
                if (next instanceof HTMLElement && next.classList.contains(SEG_CLS)) return parseInt(next.dataset.s ?? '0', 10);
                const prev = offset > 0 ? childNodes[offset - 1] : null;
                if (prev instanceof HTMLElement && prev.classList.contains(SEG_CLS)) return parseInt(prev.dataset.e ?? '0', 10);
                return offset <= 0 ? 0 : totalLen(td);
        }
        return null;
}

/** 源码偏移 → 折叠光标 */
export function placeCaretAtSourceOffset(td: HTMLElement, off: number): void {
        const segs = segEls(td);
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();

        if (!segs.length) {
                range.selectNodeContents(td);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
                return;
        }

        // 换行 <br> 边界预扫描：br 不是段（段循环看不到它），off 落在 br 边缘/区间内、
        // 或落在首个段之前的空隙时，直接按 td 直属节点放置——
        // Enter 插入换行后光标落新行首（br 后缘）；行尾光标落 br 前缘（=上一节点后缘）
        {
                const nodes = Array.from(td.childNodes);
                let acc = 0;
                for (const n of nodes) {
                        if (n instanceof HTMLBRElement) {
                                const brS = acc;
                                const brE = acc + 4;
                                if (off <= brE) {
                                        try {
                                                if (off <= brS) { range.setStartBefore(n); }
                                                else { range.setStartAfter(n); } // br 区间内/后缘 → 行首语义
                                                range.collapse(true);
                                                sel.removeAllRanges();
                                                sel.addRange(range);
                                                return;
                                        } catch { /* fallthrough */ }
                                }
                                acc = brE;
                                continue;
                        }
                        if (n instanceof HTMLElement && n.classList.contains(SEG_CLS)) {
                                const e2 = parseInt(n.dataset.e ?? '0', 10);
                                const s2 = parseInt(n.dataset.s ?? '0', 10);
                                if (off < s2 && off <= acc) {
                                        // off 落在段前空隙（前一 br 后缘已由上面处理；此处兜底）
                                        try {
                                                range.setStart(n);
                                                range.collapse(true);
                                                sel.removeAllRanges();
                                                sel.addRange(range);
                                                return;
                                        } catch { /* fallthrough */ }
                                }
                                if (off > acc && off < e2) break; // 段内部 → 交给段循环
                                acc = Math.max(acc, e2);
                                continue;
                        }
                        const len = n.textContent?.length ?? 0;
                        if (off < acc + len) {
                                try {
                                        range.setStart(n.firstChild ?? n, off - acc);
                                        range.collapse(true);
                                        sel.removeAllRanges();
                                        sel.addRange(range);
                                        return;
                                } catch { /* fallthrough */ }
                        }
                        acc += len;
                }
        }

        for (const el of segs) {
                const s = parseInt(el.dataset.s ?? '0', 10);
                const e = parseInt(el.dataset.e ?? '0', 10);
                if (off < s || (off === s && false)) continue;
                if (off <= e || el === segs[segs.length - 1]) {
                        const local = Math.max(0, Math.min(off - s, e - s));
                        if (el.dataset.view === 'src') {
                                const pos = srcDomPos(el, local);
                                if (pos) {
                                        try {
                                                range.setStart(pos.node, pos.offset);
                                                range.collapse(true);
                                                sel.removeAllRanges();
                                                sel.addRange(range);
                                                return;
                                        } catch { /* fallthrough */ }
                                }
                        }
                        // 渲染段 / void：落在段边界（off==s → 段前；否则段后）
                        try {
                                if (local <= 0) { range.setStartBefore(el); }
                                else { range.setStartAfter(el); }
                                range.collapse(true);
                                sel.removeAllRanges();
                                sel.addRange(range);
                                return;
                        } catch { /* fallthrough */ }
                }
        }
        range.selectNodeContents(td);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
}

/** 源码态段内偏移 → (text node, offset) */
function srcDomPos(el: HTMLElement, local: number): { node: Node; offset: number } | null {
        let acc = 0;
        for (const n of Array.from(el.childNodes)) {
                const len = n.nodeType === Node.TEXT_NODE ? (n.textContent?.length ?? 0) : n instanceof HTMLBRElement ? 4 : (n.textContent?.length ?? 0);
                if (acc + len >= local) {
                        if (n.nodeType === Node.TEXT_NODE) return { node: n, offset: local - acc };
                        return { node: n, offset: 0 };
                }
                acc += len;
        }
        const last = el.lastChild;
        return last ? { node: last, offset: last.textContent?.length ?? 0 } : null;
}

/** 源码偏移 → 非折叠选区（选区恢复用） */
export function setRangeAtSourceOffsets(td: HTMLElement, a: number, b: number): void {
        placeCaretAtSourceOffset(td, a);
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const anchor = sel.getRangeAt(0).cloneRange();
        // focus 端：重新定位到 b
        const segs = segEls(td);
        void segs;
        const focusRange = document.createRange();
        // 简化：用 placeCaret 逻辑定位 b —— 复用内部函数
        placeCaretInto(focusRange, td, b);
        try {
                const r = document.createRange();
                r.setStart(anchor.startContainer, anchor.startOffset);
                const fr = document.createRange();
                placeCaretInto(fr, td, b);
                r.setEnd(fr.startContainer, fr.startOffset);
                sel.removeAllRanges();
                sel.addRange(r);
        } catch { /* 保持折叠 */ }
}

function placeCaretInto(range: Range, td: HTMLElement, off: number): void {
        const segs = segEls(td);
        if (!segs.length) { range.selectNodeContents(td); range.collapse(false); return; }
        for (const el of segs) {
                const s = parseInt(el.dataset.s ?? '0', 10);
                const e = parseInt(el.dataset.e ?? '0', 10);
                if (off <= e || el === segs[segs.length - 1]) {
                        const local = Math.max(0, Math.min(off - s, e - s));
                        if (el.dataset.view === 'src') {
                                const pos = srcDomPos(el, local);
                                if (pos) { range.setStart(pos.node, pos.offset); range.collapse(true); return; }
                        }
                        if (local <= 0) range.setStartBefore(el);
                        else range.setStartAfter(el);
                        range.collapse(true);
                        return;
                }
        }
        range.selectNodeContents(td);
        range.collapse(false);
}

/* ================================================================
 * 五、事件与状态机
 * ================================================================ */

interface TdState {
        ctx: WysiwygCtx;
        composing: boolean;
        suppress: boolean; // 程序化放置光标时抑制 selectionchange 自触发
        editing: boolean;  // 重入保护：rebuild/programEdit 同步流程中防连锁事件再入
        lastSrcSeg: HTMLElement | null; // 上次光标所在的源码态段（离开时渲染）
        lastCaret: number; // 最近一次已知光标源码偏移
        /** 上次光标监测结果：抢救误插字符时用它判定"用户本意插入点"
         *  （贴渲染段后缘打字 → 字符应在块外 e；不能按误插位置 innerF 算） */
        lastLoc: { el: HTMLElement; where: 'inner' | 'front' | 'back'; innerF: number } | null;
        /** composing 超时兜底定时器（安卓 IME compositionend 丢失自愈） */
        compTimer?: ReturnType<typeof setTimeout>;
        /** scheduleRebuild 排队时的光标快照：浏览器会在事件与定时器之间重置选区
         *  （实测 compEnd 后选区被重置回上次位置），执行时的"实时光标"不可信 */
        queuedCaret: number;
        /** 删除前快照：keydown Backspace/Delete 时记录"光标所在行是否有字"。
         *  beforeinput 派发时 DOM 已是删后状态（Chromium 实测），“删前行有字”只能在这里拿 */
        delHasText?: boolean;
}

const tdStates = new WeakMap<HTMLElement, TdState>();
let selectionHookInstalled = false;

/** td 创建时绑定（幂等）；事件在 vtWysiwyg=1 时才生效 */
export function attachWysiwyg(td: HTMLElement, ctx: WysiwygCtx): void {
        if (tdStates.has(td)) return;
        const st: TdState = { ctx, composing: false, suppress: false, editing: false, lastSrcSeg: null, lastCaret: 0, lastLoc: null };
        tdStates.set(td, st);

        td.addEventListener('compositionstart', () => {
                st.composing = true;
                // 兜底：部分安卓 IME 中断时不派发 compositionend（拼字会话已死但标志卡 true），
                // 长时间无 composition 更新即静默复位（不重建，等下一次输入自然触发）
                if (st.compTimer) window.clearTimeout(st.compTimer);
                st.compTimer = window.setTimeout(() => { st.composing = false; st.compTimer = null; }, 3000);
        });
        td.addEventListener('compositionupdate', () => {
                if (st.compTimer) window.clearTimeout(st.compTimer);
                st.compTimer = window.setTimeout(() => { st.composing = false; st.compTimer = null; }, 3000);
        });
        td.addEventListener('compositionend', (e) => {
                st.composing = false;
                if (st.compTimer) { window.clearTimeout(st.compTimer); st.compTimer = null; }
                // Win 桌面版 Obsidian 智能标点：中文冒号提交后被宿主擅自替换为英文":"，
                // 光标被弄到冒号【前面】（win 100%，移动端无此转换）。内容是宿主的功能不纠正，
                // 只修光标：提交"："后多拍检查，若光标停在某个':'之前则拨回其后。
                // 触发条件是【提交"："】——宿主的替换发生在 compEnd 之后，此刻 DOM 可能还是"："；
                // 若宿主没转换（移动端）→ 光标前一字符是"："不是':' → 自然不拨。
                // 三拍 60/300/800ms：宿主替换时机不可知，多保险；每次拨正前确认 activeElement
                // 仍是 td（用户已点走则不碰）
                if ((e as CompositionEvent).data === '：') {
                        const fixColonCaret = () => {
                                if (!isWysiwyg(td) || st.composing) return;
                                if (document.activeElement !== td) return;
                                const off = caretSourceOffset(td);
                                if (off == null) return;
                                const src = projectSource(td);
                                // 光标恰好停在某个':'之前（宿主转换把光标丢在冒号前）→ 拨到冒号后
                                if (src[off] === ':') placeSuppressed(td, st, off + 1);
                        };
                        window.setTimeout(fixColonCaret, 60);
                        window.setTimeout(fixColonCaret, 300);
                        window.setTimeout(fixColonCaret, 800);
                }
                scheduleRebuild(td, st, false); // compEnd 派发过程会重置选区，快照不可信
        });

        /** composing 卡死自愈：安卓 IME 中断（切键盘/联想面板点击）时 compositionend 不派发，
         *  composing 标志永远为 true → 所有检测永久冻结 → 输入的 **加粗** 永不渲染。
         *  实锤信号：composing=true 时却收到了【非拼字类】input（insertText/delete 等），
         *  说明 composition 实际已结束 —— 复位标志并补一次重建 */
        const healStuckComposing = (ie: InputEvent): boolean => {
                if (!st.composing) return false;
                if (ie.inputType === 'insertCompositionText' || ie.inputType === 'deleteCompositionText' || ie.inputType === 'insertFromComposition') return false;
                st.composing = false;
                scheduleRebuild(td, st);
                return true;
        };

        // 删除前快照：keydown 是唯一早于 DOM 变更的时序点（beforeinput 派发时 Chromium
        // 已执行删除，读不到"删前"状态）——记录光标所在行是否有字，供假行折叠置位判定
        td.addEventListener('keydown', (e) => {
                if (!isWysiwyg(td) || st.editing) return;
                if (e.key === 'Backspace' || e.key === 'Delete') {
                        const off = caretSourceOffset(td) ?? st.lastCaret;
                        st.delHasText = segHasText(projectSource(td), off);
                }
        });

        td.addEventListener('beforeinput', (e) => {
                if (!isWysiwyg(td)) return;
                const ie = e as InputEvent;
                if (st.composing) {
                        healStuckComposing(ie);
                        if (st.composing) return;
                }
                if (ie.inputType === 'insertText' && ie.data) {
                        // 安卓 IME 变体：软键盘 Enter 可能以 insertText '\n' 走（不经 insertParagraph），
                        // 字面换行符进 DOM 后各端渲染行数不一致（桌面不加行、WebView 加行 → "换行后高出一块"）。
                        // 一律拦截改走源码插入，\n 归一为 <br>（换行唯一真身），光标由 programEdit 按插入长度推进
                        // 末尾锚点边界：锚点段是空 span，Chromium 的 caret 规范化永远跳过空元素
                        //（打字/删除都会落到前段末尾——"空行上输入无效"的根因）。
                        // 光标在源码末尾且最后是锚点段时，输入一律拦截走源码域，DOM 规范化不再碍事
                        const offTail = caretSourceOffset(td);
                        if (offTail != null && atTailAnchor(td, offTail)) {
                                e.preventDefault();
                                programEdit(td, st, offTail, offTail, ie.data.replace(/\r?\n/g, '<br>'));
                                return;
                        }
                        if (ie.data.includes('\n')) {
                                e.preventDefault();
                                const offNL = caretSourceOffset(td) ?? st.lastCaret;
                                if (offNL >= 0) programEdit(td, st, offNL, offNL, ie.data.replace(/\r?\n/g, '<br>'));
                                return;
                        }
                        const sel = window.getSelection();
                        if (sel && sel.rangeCount) {
                                const range0 = sel.getRangeAt(0);
                                // 光标宿主是渲染段（贴块级段后缘打字时 Chromium 会把字符插进渲染 DOM 内部，
                                // 投影走 data-src → 字符丢失）→ 接管：按源码偏移插入
                                const loc = locateStart(td, range0);
                                if (loc.el && loc.el.dataset.view === 'render' && loc.kind !== 'text') {
                                        e.preventDefault();
                                        const s = parseInt(loc.el.dataset.s ?? '0', 10);
                                        let off: number;
                                        if (loc.where === 'front' || loc.where === 'back') {
                                                // 段边缘：插入点=光标所在游离位置的源码偏移（含段旁已追加的游离内容末尾）——
                                                // 固定用段 s/e 会让连续输入的字符全部挤到块边缘（逆序落前头）
                                                const idx = range0.startContainer === td ? range0.startOffset
                                                        : Array.from(td.childNodes).indexOf(loc.el) + 1;
                                                off = looseOffsetAt(td, idx);
                                        } else {
                                                const ee = parseInt(loc.el.dataset.e ?? '0', 10);
                                                const pl = segPrefix(loc.el);
                                                off = s + pl + Math.min(loc.innerF, Math.max(0, ee - s - pl - segSuffix(loc.el)));
                                        }
                                        programEdit(td, st, off, off, ie.data);
                                }
                        }
                } else if (ie.inputType === 'insertFromDrop') {
                        e.preventDefault();
                        const text = ie.dataTransfer?.getData('text/plain') ?? '';
                        if (text) programEdit(td, st, null, null, text);
                } else if (ie.inputType === 'deleteContentBackward' || ie.inputType === 'deleteContentForward') {
                        // 块缘删除接管（2026-10-09 用户报：**123**1 删掉 1 后光标在块后缘，Backspace
                        // 应继续删块源码末字符（**123**→**123*），实测 Chromium 哑火（DOM 零产物）/
                        // 真机删渲染字符被投影恢复（闪回）。语义=把块缘光标视为源码流的延续：
                        // 后缘 Backspace 删段源码最后一字、前缘 Delete 删第一字 → 残缺结构
                        // 重建后自然显示源码态（与"块内末尾删除"表现一致）。
                        // 渲染段限定：text 段（view=src）后缘 Chromium 能正常删文本，不接管
                        if (window.getSelection()?.rangeCount) {
                                const locD = locateStart(td, window.getSelection()!.getRangeAt(0));
                                if (locD.el && locD.el.dataset.view === 'render' && locD.kind !== 'text') {
                                        const sD = parseInt(locD.el.dataset.s ?? '0', 10);
                                        const eD = parseInt(locD.el.dataset.e ?? '0', 10);
                                        if (ie.inputType === 'deleteContentBackward' && locD.where === 'back' && eD > sD) {
                                                e.preventDefault();
                                                programEdit(td, st, eD - 1, eD, '');
                                                return;
                                        }
                                        if (ie.inputType === 'deleteContentForward' && locD.where === 'front' && eD > sD) {
                                                e.preventDefault();
                                                programEdit(td, st, sD, sD + 1, '');
                                                return;
                                        }
                                }
                        }
                }
                // deleteContentBackward/Forward（其余形态）：不拦截，浏览器默认删除（含跨段合并/删换行），
                // input 里统一重建
        });

        td.addEventListener('input', (e) => {
                if (!isWysiwyg(td)) return;
                const ie = e as InputEvent;
                if (st.composing) {
                        healStuckComposing(ie);
                        if (st.composing) {
                                // IME 拼字中的删除（删拼音/删字）也产假行——此路径无 keydown 快照
                                //（e.key='Process'），硬置位，由 compEnd 后 rebuild 的折叠判定兜底
                                if ((ie.inputType ?? '').startsWith('delete')) pendingCollapse = 'del';
                                // 拼字中光标仍持续跟踪（compEnd 后浏览器可能重置选区，
                                // lastCaret 是 rebuild 光标恢复的可靠底稿）
                                const offNow = caretSourceOffset(td);
                                if (offNow != null) st.lastCaret = offNow;
                                return;
                        }
                }
                if (ie.inputType === 'insertText' && ie.data) {
                        // 抢救：光标宿主在渲染段内 → Chromium 把字符直接插进了渲染 DOM
                        //（此路径不触发 beforeinput，无法预防）→ 从 DOM 摘出刚插的字符，改走源码插入。
                        // 渲染段投影走 data-src，不抢救则字符静默丢失
                        const sel = window.getSelection();
                        if (sel && sel.rangeCount) {
                                const r = sel.getRangeAt(0);
                                const hostEl = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer as HTMLElement;
                                const hostSeg = hostEl?.closest?.(`.${SEG_CLS}`) as HTMLElement | null;
                                if (hostSeg && hostSeg.dataset.view === 'render' && hostSeg.dataset.kind !== 'text' && td.contains(hostSeg)) {
                                        const len = ie.data.length;
                                        // 摘出误插字符：优先 Range 删除；offset 不足时用 textContent 手术（通用兜底）；
                                        // 插进元素结构内摘不出 → 用 data-src 重渲染整段清除误插（防"源码+DOM 双份"的疯狂重复）
                                        if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset >= len) {
                                                const del = document.createRange();
                                                del.setStart(r.startContainer, r.startOffset - len);
                                                del.setEnd(r.startContainer, r.startOffset);
                                                del.deleteContents();
                                        } else if (r.startContainer.nodeType === Node.TEXT_NODE) {
                                                const t = r.startContainer as Text;
                                                t.textContent = t.textContent?.slice(0, r.startOffset) + t.textContent?.slice(r.startOffset + len) ?? '';
                                        } else {
                                                renderSegContent(hostSeg, {
                                                        kind: hostSeg.dataset.kind as SegKind,
                                                        raw: hostSeg.dataset.src ?? '',
                                                        start: parseInt(hostSeg.dataset.s ?? '0', 10),
                                                        end: parseInt(hostSeg.dataset.e ?? '0', 10),
                                                        prefix: segPrefix(hostSeg),
                                                        suffix: segSuffix(hostSeg),
                                                }, st.ctx);
                                        }
                                        const s = parseInt(hostSeg.dataset.s ?? '0', 10);
                                        const ee = parseInt(hostSeg.dataset.e ?? '0', 10);
                                        // 插入点用【打字前】的光标语义（lastLoc）：贴段边缘打字 → 字符在光标
                                        // 游离位置（含段旁已追加内容末尾）；误插位置是 Chromium 行为产物
                                        const pre = st.lastLoc && st.lastLoc.el === hostSeg ? st.lastLoc.where : 'inner';
                                        let off: number;
                                        if (pre === 'front' || pre === 'back') {
                                                const idx = r.startContainer === td ? r.startOffset
                                                        : Array.from(td.childNodes).indexOf(hostSeg) + 1;
                                                off = looseOffsetAt(td, idx);
                                        } else {
                                                const pl = segPrefix(hostSeg);
                                                const innerF = st.lastLoc && st.lastLoc.el === hostSeg ? st.lastLoc.innerF : 0;
                                                off = s + pl + Math.min(innerF, Math.max(0, ee - s - pl - segSuffix(hostSeg)));
                                        }
                                        programEdit(td, st, off, off, ie.data);
                                        return;
                                }
                        }
                        // 兜底：漏网的字面换行（beforeinput 拦截前的直插、IME 私有路径）→ 重建归一
                        if (ie.data.includes('\n')) { scheduleRebuild(td, st); return; }
                        if (SYNTAX_INPUT_RE.test(ie.data)) {
                                // 语法字符 → 结构可能变化
                                scheduleRebuild(td, st);
                                return;
                        }
                        // 普通字符：段内容区内打字不动结构；但若落在段外（td 直下裸文本）
                        // 或段边界（块标记之后/之前），块的"完整且光标不在内"状态已变 → 重建
                        //（否则前一个刚输入完的块保持源码不渲染——用户要求瞬时渲染）
                        const off = caretSourceOffset(td);
                        if (off == null) { scheduleRebuild(td, st); return; }
                        const seg = segAtOffset(td, off);
                        if (!seg) { scheduleRebuild(td, st); return; }
                        const s = parseInt(seg.dataset.s ?? '0', 10);
                        const e2 = parseInt(seg.dataset.e ?? '0', 10);
                        if (off <= s || off >= e2) scheduleRebuild(td, st);
                        // 光标在段内容区内（s < off < e）：DOM 即最新源码，投影无损失，无需重建
                        return;
                }
                if (ie.inputType === 'historyUndo' || ie.inputType === 'historyRedo') {
                        scheduleRebuild(td, st);
                        return;
                }
                // deleteContent*：浏览器默认删除可能跨段合并/删掉换行元素（结构变化）→ 统一重建
                if (ie.inputType === 'deleteContentBackward' || ie.inputType === 'deleteContentForward' || ie.inputType === 'deleteByCut') {
                        // 末尾锚点边界：caret 在源码末尾且最后是空锚点段 → Backspace 语义=删掉
                        // 前面的换行 <br>（空行真正消失）。Chromium 的规范化会让默认删除落到
                        // 前段末尾删掉正文，必须拦截走源码域（programEdit 路径，不经 rebuild）
                        if (ie.inputType === 'deleteContentBackward') {
                                const offBk = caretSourceOffset(td);
                                if (offBk != null && offBk >= 4 && atTailAnchor(td, offBk)) {
                                        e.preventDefault();
                                        programEdit(td, st, offBk - 4, offBk, '');
                                        return;
                                }
                        }
                        // 假行折叠置位：正常 Backspace/Delete 走 keydown 快照（删前行有字才置）；
                        // 剪切/拖拽删除无 keydown 快照，硬置位——rebuild 折叠判定兜底
                        //（光标行仍有字→原样，不会误吞）。删空行（删前行无字）不置位，避免误吞合法空行
                        if (st.delHasText || ie.inputType === 'deleteByCut' || ie.inputType === 'deleteByDrag') {
                                pendingCollapse = 'del';
                                st.delHasText = false;
                        }
                        // 跨行删除折回识别（2026-10-09 用户报：块+换行，次行行首 Backspace 删换行，
                        // 光标应落块后缘，实际落块内源码 *123|*）：删 br 后 Chromium 把光标折进前一
                        // 渲染段内贴末，此刻实时快照已是段内源码域 → settle 按 caretAt 段内判定
                        // "块内编辑" → 误切源码留存。识别"渲染段内贴末"的删除后瞬态 → 快照拨回
                        // 段尾 e（=被删 br 的源码位置）→ 重建后光标落段后缘（back），符合删除语义。
                        // "块内删字符"不命中：块内编辑时段早已切源码（view=src）；渲染段内无静止
                        // 贴末态（任何 rebuild 后段内贴末都会被切源码），命中即本次跨行删除折回
                        if (ie.inputType === 'deleteContentBackward') {
                                const selBk = window.getSelection();
                                if (selBk && selBk.rangeCount) {
                                        const locBk = locateStart(td, selBk.getRangeAt(0));
                                        if (locBk.el && locBk.el.dataset.view === 'render'
                                                && locBk.where === 'inner' && locBk.innerF > 0
                                                && locBk.innerF >= (locBk.el.textContent ?? '').replace(/\n/g, '').length) {
                                                scheduleRebuild(td, st, false, parseInt(locBk.el.dataset.e ?? '0', 10));
                                                return;
                                        }
                                }
                        }
                        scheduleRebuild(td, st);
                        return;
                }
                // insertParagraph/insertLineBreak（Enter，浏览器默认）：产生的 <div>/<br> 元素
                // 由投影的块级感知还原为源码 <br>，需要重建。
                // 光标：Enter 在源码光标处插入 '<br>'（4 字符）→ 新光标=off+4（新行首）。
                // 必须此刻立刻读 lastCaret（浏览器在 input 与定时器之间会重置选区，
                // rebuild 时实时快照已被污染 → 光标不跟下去/跳一下弹回来）
                if (ie.inputType === 'insertParagraph' || ie.inputType === 'insertLineBreak') {
                        const off = st.lastCaret;
                        // 贴渲染段边缘接管（2026-10-08 三段攻坚终修，Playwright 实锤）：
                        // 渲染段（元素包裹的 inline）边缘/段内贴边的 Enter，Chromium 默认行为【哑火】
                        // ——事件链完整派发且未阻止，DOM 零新增产物；且 Enter 的字面 \n 在 beforeinput
                        // 派发【前】就被预插进段内（投影按 data-src 还原时会全部丢失）→ 只能接管：
                        // preventDefault + 代插 <br>（语义=浏览器本应产出的换行），光标落新行首。
                        // 段内中间不接管（进格即切源码，走正常分割路径）
                        {
                                const sel0 = window.getSelection();
                                if (sel0 && sel0.rangeCount) {
                                        const loc0 = locateStart(td, sel0.getRangeAt(0));
                                        // 文字段恒 view=src（模型不变量），view==='render' 即渲染块
                                        if (loc0.el && loc0.el.dataset.view === 'render') {
                                                // len 剔除 \n：Chromium 在 beforeinput 派发【前】就往段内预插了字面 \n
                                                //（实测 tc='123\n\n'），不剔除会误判非贴边而漏接管
                                                const len = (loc0.el.textContent ?? '').replace(/\n/g, '').length;
                                                const edgeEnd = loc0.where === 'back' || (loc0.where === 'inner' && loc0.innerF > 0 && loc0.innerF >= len);
                                                const edgeStart = loc0.where === 'front' || (loc0.where === 'inner' && loc0.innerF <= 0);
                                                if (edgeEnd || edgeStart) {
                                                        const sAt = parseInt(loc0.el.dataset.s ?? '0', 10);
                                                        const eAt = parseInt(loc0.el.dataset.e ?? '0', 10);
                                                        const at = edgeEnd ? eAt : sAt;
                                                        e.preventDefault();
                                                        programEdit(td, st, at, at, '<br>');
                                                        return;
                                                }
                                        }
                                }
                        }
                        // Enter 折叠仅 HS（横向拉长）模式：文字段尾 Enter 会连产"换行+占位"双 br（假行）→ 置位；
                        // OL/RC 模式 Enter 正常不折叠（用户实测）。
                        // 锚点段上的 Enter 是空行连加的合法路径（不产生占位）→ 不置位，否则末尾空行无法连续添加
                        const tbl = td.closest('table');
                        const isHS = !!(tbl && tbl.classList.contains('vt-mode-hs'));
                        if (isHS && !(off >= 0 && atTailAnchor(td, off))) pendingCollapse = 'enter';
                        scheduleRebuild(td, st, false, off >= 0 ? off + 4 : undefined);
                        return;
                }
        });

        td.addEventListener('copy', (e) => handleCopyCut(td, st, e as ClipboardEvent, 'copy'));
        td.addEventListener('cut', (e) => handleCopyCut(td, st, e as ClipboardEvent, 'cut'));
        td.addEventListener('paste', (e) => {
                if (!isWysiwyg(td) || st.composing) return;
                e.preventDefault();
                const text = e.clipboardData?.getData('text/plain') ?? '';
                // markdown 表格 → 网格覆盖粘贴（本格=左上角，越界吞掉；网格写入归 render.ts 闭包）
                const mdRows = ctx.onMdGridPaste ? parseMarkdownTable(text) : null;
                if (mdRows) {
                        const r0 = parseInt(td.dataset.vtR ?? '-1', 10);
                        const c0 = parseInt(td.dataset.vtC ?? '-1', 10);
                        if (r0 >= 0 && c0 >= 0) {
                                ctx.onMdGridPaste(r0, c0, mdRows);
                                return;
                        }
                }
                if (text) programEdit(td, st, null, null, text);
        }, true); // capture：先于 render.ts 的既有 paste handler

        if (!selectionHookInstalled) {
                selectionHookInstalled = true;
                document.addEventListener('selectionchange', () => {
                        const active = document.activeElement;
                        if (!active || !active.matches?.('td')) return;
                        const s = tdStates.get(active);
                        if (s) onSelectionChange(active as HTMLElement, s);
                });
        }
}

function segAtOffset(td: HTMLElement, off: number): HTMLElement | null {
        const segs = segEls(td);
        for (const el of segs) {
                const s = parseInt(el.dataset.s ?? '0', 10);
                const e = parseInt(el.dataset.e ?? '0', 10);
                if (off >= s && off <= e) return el;
        }
        return null;
}

/** 检测主流程：光标进入渲染段 → 切源码；离开源码段 → 重新渲染 */
function onSelectionChange(td: HTMLElement, st: TdState): void {
        if (!isWysiwyg(td) || st.composing || st.suppress) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!td.contains(range.startContainer) || !td.contains(range.endContainer)) return;

        const off = caretSourceOffset(td);
        if (off != null) st.lastCaret = off;
        // 重入保护：rebuild/programEdit 重写 DOM 会引发连锁 selectionchange，
        // 同步流程中本函数不得再入（placeSuppressed 的 suppress 只覆盖异步窗口）
        if (st.editing) return;

        if (!range.collapsed) {
                st.lastLoc = { el: (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer as HTMLElement)?.closest(`.${SEG_CLS}`) as HTMLElement ?? null, where: 'inner', innerF: 0 };
                // 选区：覆盖到的渲染段切源码（复制前可见源码），保持选区
                revealSegmentsInRange(td, st, range);
                return;
        }

        const loc = locateStart(td, range);
        const cur = loc.el;

        // 离开上次源码段 → 全格重建（该段渲染，其余跟随最新源码）。
        // 仅【换段】算离开：段边界（s/e）是合法停留位置（rebuild 光标重放的常态），
        // 边界不判定离开——否则 rebuild 重写 DOM 引发的选区重置会触发连环重建（光标乱跳）。
        // 块的瞬时渲染由 input 的语法字符重建达成，不依赖此判定
        if (st.lastSrcSeg && st.lastSrcSeg.isConnected && st.lastSrcSeg.dataset.view === 'src') {
                if (st.lastSrcSeg !== cur) {
                        st.lastSrcSeg = null;
                        rebuild(td, st, off ?? st.lastCaret);
                        return;
                }
                return; // 光标仍在该段（含边界）：保持源码态
        }
        // 游离光标（td 直下/塌缩态）：浏览器临时状态，不做段归属判定
        if (!cur) return;
        st.lastSrcSeg = cur.dataset.view === 'src' ? cur : null;

        // 进入渲染段 → 切源码（判定见 shouldReveal）
        if (shouldReveal(loc)) {
                revealSeg(td, st, cur!, loc);
        }
        // 记录光标监测结果：抢救误插字符时按此判定"用户本意插入点"
        st.lastLoc = cur ? { el: cur, where: loc.where, innerF: loc.innerF } : null;
}

/** 是否把渲染段切为源码：
 *  - 光标在段 DOM 内部（inner，如点在粗体字/公式图上）→ 进块，切源码
 *  - 光标贴段外侧边缘（front/back，即段与段之间的边界）→ 光标在块外，不切——
 *    光标只是监测者，贴着块走不等于要编辑块（用户明确要求光标无感）
 *  - void 图片/实体没有内部，贴边即进（需求三） */
function shouldReveal(loc: LocateResult): boolean {
        if (!loc.el || loc.kind === 'text') return false;
        if (loc.el.dataset.view === 'src') return false;
        if (loc.kind === 'void-img' || loc.kind === 'void-entity') return true;
        return loc.where === 'inner';
}

/** 渲染段 → 源码态，并把光标映射到源码对应位置 */
function revealSeg(td: HTMLElement, st: TdState, el: HTMLElement, loc: LocateResult): void {
        const raw = el.dataset.src ?? '';
        const s = parseInt(el.dataset.s ?? '0', 10);
        const e = parseInt(el.dataset.e ?? '0', 10);
        let target: number;
        if (loc.where === 'front') target = s + segPrefix(el);
        else if (loc.where === 'back') target = e - segSuffix(el);
        else {
                const prefix = segPrefix(el);
                const contentLen = Math.max(0, raw.length - prefix - segSuffix(el));
                // 端点语义：点内容最右端 → 真正的末尾（越过闭标记，如 *这是斜体|* 之外的 *|）；
                // 点内容最左端 → 真正的开头（前标记之前）。中间位置保持 prefix 补偿映射
                if (loc.innerF <= 0) target = s;
                else if (loc.innerF >= contentLen) target = e;
                else target = s + prefix + loc.innerF;
        }
        setSegSource(el, raw);
        st.lastSrcSeg = el;
        placeSuppressed(td, st, target);
}

/** 非折叠选区覆盖的渲染段 → 源码态，恢复选区 */
function revealSegmentsInRange(td: HTMLElement, st: TdState, range: Range): void {
        const a = rangeOffset(td, range.startContainer, range.startOffset);
        const b = rangeOffset(td, range.endContainer, range.endOffset);
        if (a == null || b == null) return;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        let touched = false;
        for (const el of segEls(td)) {
                const s = parseInt(el.dataset.s ?? '0', 10);
                const e = parseInt(el.dataset.e ?? '0', 10);
                if (e <= lo || s >= hi) continue; // 不相交
                const kind = el.dataset.kind as SegKind;
                if (el.dataset.view !== 'src' && kind !== 'text') {
                        setSegSource(el, el.dataset.src ?? '');
                        touched = true;
                }
        }
        if (touched) {
                st.suppress = true;
                setRangeAtSourceOffsets(td, lo, hi);
                window.setTimeout(() => { st.suppress = false; }, 0);
        }
}

function placeSuppressed(td: HTMLElement, st: TdState, off: number): void {
        st.suppress = true;
        placeCaretAtSourceOffset(td, off);
        st.lastCaret = off;
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
                const loc = locateStart(td, sel.getRangeAt(0));
                st.lastLoc = loc.el ? { el: loc.el, where: loc.where, innerF: loc.innerF } : null;
        }
        window.setTimeout(() => { st.suppress = false; }, 0);
}

let rebuildQueued = false;
// 假行折叠（全平台）：内核在"删光一行文字"后会补尾占位 <br>，多出一条假行。
// 'del'：仅"文字删完一整行"（删前光标行有字、现在没字）才清占位（keydown 快照判定）。
// 'enter'：仅 HS（横向拉长）模式——用户实测 HS 下 Enter 出假行，OL/RC 两模式正常不折叠；
//          锚点段 Enter 不置位（空行连加合法，见 beforeinput 的 insertParagraph 分支）
let pendingCollapse: null | 'enter' | 'del' = null;

/** 光标偏移所在段（按 <br> 切分）是否含正文——判定"这一行（之前/现在）有没有字" */
export function segHasText(t: string, off: number): boolean {
        const parts = t.split(/<br>/i);
        let acc = 0;
        for (let i = 0; i < parts.length; i++) {
                const segEnd = acc + parts[i].length;
                if (off <= segEnd) return /[^\s\u00A0]/i.test(parts[i]);
                acc = segEnd + 4;
        }
        return /[^\s\u00A0]/i.test(parts[parts.length - 1]);
}

/** 删光折叠：删除后光标所在行无字（该行刚被删光）→ 清掉内核补的尾占位。
 *  - td 已无正文、只剩换行残留 → 全清（空格子态）
 *  - 末行删光后内核补占位（尾连续 ≥2 个 <br>）→ 删掉最靠后的一个（连同分隔空格）
 *  其余删除（普通删字/删空行/光标行仍有字）一律原样返回。 */
export function collapseDelLight(t: string, caretOff: number): string {
        if (segHasText(t, caretOff)) return t;
        if (!/[^\s\u00A0]/i.test(t.replace(/<br>/gi, ''))) return '';
        if (!/(<br>[\s\u00A0]*){2,}$/i.test(t)) return t;
        return t.replace(/[\s\u00A0]*<br>$/i, '');
}

/** Enter 折叠（仅 HS 模式）：文字段尾 Enter 后内核连产"换行+占位"双 <br>（假行）——
 *  删掉最靠后的一个（连同分隔空格）。需删除后仍有正文（rest 有字）——防吞刻意多空行
 *  （锚点段上的 Enter 不置位，空行连加自由） */
function collapseEnterTail(t: string): string {
        if (!/(<br>[\s\u00A0]*){2,}$/i.test(t)) return t;
        const rest = t.replace(/[\s\u00A0]*<br>$/i, '');
        if (!rest || !/[^\s\u00A0]/i.test(rest.replace(/<br>/gi, ''))) return t;
        return rest;
}

/** 输入/undo 后重建：投影源码 → 重解析 → 重建 → 恢复光标。
 *  光标恢复用【实时光标】（setTimeout 执行时 DOM 已含新字符、光标停在插入文本末尾），
 *  绝不用 lastCaret（输入前旧位置）——否则光标会被"搬回"新字符之前（用户明确禁止光标移动） */
/** rebuild/programEdit 共用：删除/输入后的光标稳定态判定。
 *  块内留存：事件时刻快照偏移（caretAt）落在渲染段范围内（"在块内删/改的"）→ 强制该段
 *  切源码、光标映射进段内——否则 placeCaret 对渲染段只能落段旁（front/back），表现为
 *  "在块内删改任何东西→光标跳出块到块后"。void 段贴边即进的旧规则只救 void，
 *  救不了 fence 等有内部的块 */
function settleCaretAfterEdit(td: HTMLElement, st: TdState, caretAt: number | null): void {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const loc = locateStart(td, sel.getRangeAt(0));
        if (loc.el && loc.el.dataset.view === 'render' && loc.kind !== 'text' && caretAt != null) {
                const s2 = parseInt(loc.el.dataset.s ?? '0', 10);
                const e2 = parseInt(loc.el.dataset.e ?? '0', 10);
                if (caretAt > s2 && caretAt < e2) {
                        // 块内留存：caretAt 本身就是全 td 源码偏移——切源码后直接放回该偏移。
                        // 不能走 revealSeg 的 innerF 映射：它期望"渲染内容偏移"，会把源码偏移
                        // 再补一次 prefix（如 ** 标记），光标每字累积前窜、攒到越段尾即跳出块外
                        setSegSource(loc.el, loc.el.dataset.src ?? '');
                        st.lastSrcSeg = loc.el;
                        placeSuppressed(td, st, caretAt);
                        return;
                }
        }
        if (shouldReveal(loc)) {
                revealSeg(td, st, loc.el!, loc);
        } else {
                st.lastSrcSeg = loc.el && loc.el.dataset.view === 'src' ? loc.el : null;
        }
}

function scheduleRebuild(td: HTMLElement, st: TdState, trustSnapshot = true, caretOverride?: number): void {
        // 光标快照必须在【事件时刻】定格——此刻选区刚被输入更新、尚未被浏览器重置。
        // 实测：compEnd 之后到定时器执行之间，浏览器会把选区重置回上次位置，
        // 执行时读"实时光标"拿到的是污染值 → rebuild 光标错位（乱跳主犯）。
        // compEnd 源更特殊：重置发生在其派发过程中，快照本身就不可信 → 用 lastCaret
        //（input 拼字冻结分支持续跟踪，是 compEnd 前最后的正确值）
        const snap = caretOverride ?? (trustSnapshot ? (caretSourceOffset(td) ?? st.lastCaret) : st.lastCaret);
        if (rebuildQueued) {
                // 已有重建排队时【不能裸丢】后续快照：同时按多键/快速连打时，多个输入事件
                // 挤在同一帧，只有首字符的快照幸存 → rebuild 用旧快照恢复光标（滞后 1~N 位）
                // → 后续字符被浏览器原生插入到滞后点 → 字符乱序（"新打的字跑到光标前"）。
                // 修复：快照仍按事件时刻更新，rebuild 恒用最后一次输入的位置
                st.queuedCaret = snap;
                return;
        }
        rebuildQueued = true;
        st.queuedCaret = snap;
        window.setTimeout(() => {
                rebuildQueued = false;
                if (!isWysiwyg(td)) return;
                // 安卓 IME 连续输入：compositionend 排队的重建执行时下一个 composition 可能已开始，
                // 此时重写 DOM 会摧毁拼字会话（光标乱跳/文本错乱）——放弃本次，compositionend 会再排
                if (st.composing) return;
                rebuild(td, st, st.queuedCaret);
        }, 0);
}

/** 块尾换行兜底（2026-10-08 块尾 Enter 攻坚的首修层，机理后经 Playwright 修正）：
 *  桌面 Chromium 的块尾 Enter 形态（选区折回段内+段内预插字面 \n）已由 insertParagraph
 *  的贴边接管路径处理，本函数在该路径上不再触发。保留作安卓 WebView 等未实测内核的
 *  兜底：若变体内核把字面 \n 落在 td 尾（渲染段之后的游离文本），normalizeCellNewlines
 *  的占位规则会按"尾 \n 紧跟正文 → n 个吃 1 个"误吃换行——此处按 td 实况（尾部跳过
 *  空白游离节点后最后一段是渲染段）把尾 \n 等量升级 <br> 再进归一。文字段尾 div 路径、
 *  锚点段 afterBr 分支的判定与结果均不受影响。
 *  仅编辑态重建（wysiwyg）调用；builder 的存盘归一不动（旧版本换行管线铁律） */
export function promoteTailNewlines(td: HTMLElement, src: string): string {
        if (!/\n$/.test(src)) return src;
        const kids = Array.from(td.childNodes);
        for (let i = kids.length - 1; i >= 0; i--) {
                const n = kids[i]!;
                // 尾部空白游离节点（Chromium 刚插的字面 \n 还在 DOM 里）：跳过往前找
                if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim()) continue;
                // 唯一相关的形态：块（渲染段）是内容末尾；文字段/锚点段（view=src）不在此列
                return n instanceof HTMLElement && n.classList.contains(SEG_CLS) && n.dataset.view === 'render'
                        ? src.replace(/\n+$/, m => '<br>'.repeat(m.length))
                        : src;
        }
        return src;
}



function rebuild(td: HTMLElement, st: TdState, caretOff: number): void {
        if (st.editing) return;
        st.editing = true;
        try {
                // 换行归一：Chromium 在段边界敲 Enter 会产字面换行符（不是 <br>），
                // 各端对尾随换行符的渲染行数不一致（桌面不加行、安卓加一行——“换行后高出一块”）。
                // 持久化语义里换行只有 <br> 一种真身，重建前就地归一，编辑态与存盘永远同域
                let src = normalizeCellNewlines(promoteTailNewlines(td, projectSource(td)));
                // 假行折叠（全平台）：仅"文字删完一整行"（删前光标行有字、现在无字）时清尾占位——
                // 置位见 deleteContentBackward 分支；普通删字/删空行/Enter 一律不动
                if (pendingCollapse) {
                        const mode = pendingCollapse;
                        pendingCollapse = null;
                        if (mode === 'del') src = collapseDelLight(src, caretOff);
                        else src = collapseEnterTail(src);
                }
                enterWysiwyg(td, src, st.ctx);
                placeSuppressed(td, st, Math.max(0, Math.min(caretOff, src.length)));
                // 光标落在渲染段内部 → 立即切源码（稳定态：光标所在段为源码）；
                // 贴段外边缘不切（settleCaretAfterEdit 统一判定，光标无感原则）；
                // 快照落在渲染段内 → 块内留存（切源码映射进段），杜绝"块内删改→光标跳出"
                settleCaretAfterEdit(td, st, st.queuedCaret);
        } finally {
                st.editing = false;
        }
}

/** 程序化编辑：投影 → 改源码 → 重建 → 光标落插入/删除点 */
function programEdit(td: HTMLElement, st: TdState, delFrom: number | null, delTo: number | null, insert: string): void {
        if (st.editing) return;
        st.editing = true;
        try {
                const src = projectSource(td);
                let a = delFrom ?? null;
                let b = delTo ?? null;
                if (a == null || b == null) {
                        const sel = window.getSelection();
                        if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
                                const rng = selectionSourceRange(td);
                                if (rng) { a = rng.a; b = rng.b; }
                        }
                }
                let next: string;
                let caret: number;
                if (a != null && b != null) {
                        next = src.slice(0, a) + insert + src.slice(b);
                        caret = a + insert.length;
                } else {
                        const off = caretSourceOffset(td) ?? st.lastCaret ?? src.length;
                        next = src.slice(0, off) + insert + src.slice(off);
                        caret = off + insert.length;
                }
                enterWysiwyg(td, next, st.ctx);
                placeSuppressed(td, st, caret);
                // 光标所在段稳定态（settleCaretAfterEdit 统一判定：块内留存+贴边不切）
                settleCaretAfterEdit(td, st, caret);
        } finally {
                st.editing = false;
        }
}

/** 复制/剪切：输出选区覆盖的源码文本；剪切再程序化删除 */
function handleCopyCut(td: HTMLElement, st: TdState, e: ClipboardEvent, type: 'copy' | 'cut'): void {
        if (!isWysiwyg(td) || st.composing) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (range.collapsed || !td.contains(range.startContainer)) return;
        const rng = selectionSourceRange(td);
        if (!rng) return;
        const src = projectSource(td);
        const text = src.slice(rng.a, rng.b);
        e.clipboardData?.setData('text/plain', text);
        e.preventDefault();
        e.stopPropagation();
        if (type === 'cut') programEdit(td, st, rng.a, rng.b, '');
}
