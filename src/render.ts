/**
 * render.ts
 * vtable 代码块处理器：把 grid 渲染为可编辑表格
 * - 单元格存 HTML；聚焦时显示源 HTML 供编辑，失焦时提交并渲染（含 LaTeX、Markdown、图片）
 * - 聚焦时弹出格式化工具栏
 * - 单元格右键弹出行列 / 合并拆分菜单
 */

import { Menu, loadMathJax, renderMath, finishRenderMath, Platform } from 'obsidian';
import {
	parseSource, serialize, visible, Grid,
	insertRow, deleteRow, insertCol, deleteCol,
	mergeRight, mergeDown, splitCell,
	mdInlineToHtml,
} from './builder';
import { Toolbar } from './bar';
import { evalFormula } from './formula';
import type { VtSettings } from './main';

/** MathJax 需要显式加载后才能使用 renderMath，全局只加载一次 */
let mathJaxReady: Promise<void> | null = null;
function ensureMathJax(): Promise<void> {
	if (!mathJaxReady) mathJaxReady = loadMathJax();
	return mathJaxReady;
}

/** 等 MathJax 加载完成后，在 root 内查找并渲染公式 */
function scheduleMathRender(root: HTMLElement) {
	void ensureMathJax().then(() => {
		if (renderMathInNode(root)) void finishRenderMath();
	});
}

/**
 * 把代码块源文本渲染进 el 容器，编辑后经 onCommit 保存；
 * onConvertToMd / onConvertToHtml 分别将整个代码块还原为 markdown / HTML 表格
 */
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
) {
	el.empty();

	const grid = parseSource(source);
	const table = el.createEl('table', { cls: 'vt' });
	const tbody = table.createEl('tbody');

	grid.forEach((row, r) => {
		const tr = tbody.createEl('tr');
		row.forEach((cellData, c) => {
			if (!visible(cellData)) return;

			const td = tr.createEl('td');
			td.contentEditable = 'true';
			if (cellData.rs > 1) td.rowSpan = cellData.rs;
			if (cellData.cs > 1) td.colSpan = cellData.cs;

			// 初始渲染态
			td.innerHTML = cellData.t;
			if (/^=[A-Z]+\(/i.test(cellData.t)) {
				td.textContent = evalFormula(grid, cellData.t);
			}
			renderHtml(td);
			renderMarkdown(td);
			renderImages(td, sourcePath, resolveImage);

			td.addEventListener('focus', () => {
				// 阅读预览模式下没有 CM6 编辑器，点击即失焦，禁用编辑
				if (!td.closest('.cm-editor')) {
					td.blur();
					return;
				}
				// 进入编辑态：显示原始 HTML 源
				td.innerHTML = grid[r]![c]!.t;
				// 根据平台和用户设置决定是否显示浮窗工具栏
				if (Platform.isDesktop && !settings.enableDesktopToolbar) return;
				if ((Platform.isMobile || Platform.isTablet) && !settings.enableMobileToolbar) return;
				toolbar.show(td, grid, r, c, onCommit, () => onConvertToMd(grid), () => onConvertToHtml(grid));
			});

			td.addEventListener('blur', (e) => {
				const html = td.innerHTML;
				const relatedTarget = (e).relatedTarget as HTMLElement | null;
				const inSameTable = relatedTarget?.closest('.vt') === td.closest('.vt');
				if (grid[r]![c]!.t !== html) {
					grid[r]![c]!.t = html;
					if (!inSameTable) onCommit(serialize(grid));
				}
				// 恢复渲染态
				td.innerHTML = html;
				if (/^=[A-Z]+\(/i.test(html)) {
					td.textContent = evalFormula(grid, html);
				}
				renderHtml(td);
				renderMarkdown(td);
				renderImages(td, sourcePath, resolveImage);
				scheduleMathRender(td);
				// 工具栏按钮点击引起的失焦不关闭
				if (!inSameTable && document.body.dataset.vtBarClick !== '1') toolbar.hide();
			});

			td.addEventListener('contextmenu', (e) => {
				if (!td.closest('.cm-editor')) return;
				e.preventDefault();
				e.stopPropagation();
				showCellMenu(e, grid, r, c, toolbar, onCommit);
			});
		});
	});
	// 整表公式渲染，MathJax 加载完成后统一处理
	scheduleMathRender(table);
}

/** 匹配 $$块公式$$ 或 $行内公式$（内容不含 $ / 换行，且首尾非空格，避免与货币符号 $5 混淆） */
const MATH_RE = /\$\$([^$]+?)\$\$|\$(\S(?:[^$\n]*?\S)?)\$/g;

/** 遍历文本节点，将其中的公式片段替换为渲染后的公式元素（跳过 <code> 内部） */
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

/** 把文本中的公式片段替换为渲染元素，若无公式返回 null */
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

/* ===== HTML 标签渲染 ===== */

/** 遍历文本节点，将 HTML 标签文本（如 &lt;span&gt;）转换为实际的 DOM 元素（跳过 &lt;code&gt; 内部） */
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
		// 只转换包含实际 HTML 标签的内容（如 <span> </div>），避免误伤 3 < 5 这类纯文本
		if (!/<[a-z][a-z0-9]*\b[^>]*>/i.test(text) && !/<\/[a-z]+>/i.test(text)) continue;
		const frag = document.createRange().createContextualFragment(text);
		textNode.replaceWith(frag);
	}
}

/* ===== Markdown 行内格式渲染 ===== */

/** 遍历文本节点，将 Markdown 行内格式（**粗体**、*斜体*、==高亮==、~~删除~~等）渲染为 HTML（跳过 code / 已格式化元素内部） */
function renderMarkdown(root: HTMLElement) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const text = node.textContent;
		if (!text || !/[*_~=]/.test(text)) continue;
		if (node.parentElement?.closest('b, i, mark, s, a, code, img')) continue;
		targets.push(node as Text);
	}

	for (const textNode of targets) {
		const html = mdInlineToHtml(textNode.textContent!);
		if (html === textNode.textContent) continue;
		const frag = document.createDocumentFragment();
		frag.append(document.createRange().createContextualFragment(html));
		textNode.replaceWith(frag);
	}
}

/* ===== 图片渲染（![[filename]]） ===== */

const IMG_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** 遍历文本节点，将 ![[图片文件]] 语法渲染为 <img> 标签 */
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

			const linkText = match[1]!.trim();
			const altText = match[2]?.trim() ?? '';
			const src = resolveImage(linkText);

			if (src) {
				const img = document.createElement('img');
				img.src = src;
				img.alt = altText || linkText;
				img.style.maxWidth = '100%';
				frag.appendChild(img);
			} else {
				// 图片未找到，保留原文以便用户排查
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

/** 单元格右键菜单 */
function showCellMenu(
	e: MouseEvent,
	grid: Grid,
	r: number,
	c: number,
	toolbar: Toolbar,
	onCommit: (s: string) => void,
) {
	const menu = new Menu();
	const apply = (fn: () => void) => {
		toolbar.hide();
		fn();
		onCommit(serialize(grid));
	};

	menu.addItem(i => i.setTitle('上方插入行').setIcon('arrow-up').onClick(() => apply(() => insertRow(grid, r - 1))));
	menu.addItem(i => i.setTitle('下方插入行').setIcon('arrow-down').onClick(() => apply(() => insertRow(grid, r))));
	menu.addItem(i => i.setTitle('删除本行').setIcon('trash').onClick(() => apply(() => deleteRow(grid, r))));
	menu.addSeparator();
	menu.addItem(i => i.setTitle('左侧插入列').setIcon('arrow-left').onClick(() => apply(() => insertCol(grid, c - 1))));
	menu.addItem(i => i.setTitle('右侧插入列').setIcon('arrow-right').onClick(() => apply(() => insertCol(grid, c))));
	menu.addItem(i => i.setTitle('删除本列').setIcon('trash').onClick(() => apply(() => deleteCol(grid, c))));
	menu.addSeparator();
	menu.addItem(i => i.setTitle('向右合并').setIcon('arrow-right-to-line').onClick(() => apply(() => mergeRight(grid, r, c))));
	menu.addItem(i => i.setTitle('向下合并').setIcon('arrow-down-to-line').onClick(() => apply(() => mergeDown(grid, r, c))));
	menu.addItem(i => i.setTitle('拆分单元格').setIcon('split-square-horizontal').onClick(() => apply(() => splitCell(grid, r, c))));

	menu.showAtMouseEvent(e);
}
