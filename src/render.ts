/**
 * render.ts
 * vtable 代码块处理器：可编辑表格、模式切换、富文本渲染
 */

import { Menu, loadMathJax, renderMath, finishRenderMath, Platform } from 'obsidian';
import {
	parseSource, serialize, visible, Grid, VtData, VtMode,
	insertRow, deleteRow, insertCol, deleteCol,
	mergeRight, mergeDown, splitCell,
	mdInlineToHtml, stripRcHandles,
} from './builder';
import { Toolbar } from './bar';
import { evalFormula } from './formula';
import {
	ModeSwitcher, applyModeStyles, bindRcResizeHandles, autoExpandRowHeight,
	setupHsScrollBar,
} from './modes';
import type { VtSettings } from './main';

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
}

let activeController: TableController | null = null;

/** 提交后恢复聚焦的单元格（re-render 时使用） */
export let pendingFocusRestore: { r: number; c: number; caretAtEnd: boolean } | null = null;

export function getActiveTableController(): TableController | null {
	return activeController;
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
) {
	el.empty();
	el.classList.add('vtable-container');

	const data = parseSource(source);
	const grid = data.rows;
	const modeBar = new ModeSwitcher(el);
	const wrap = el.createDiv({ cls: 'vt-table-wrap' });
	const table = wrap.createEl('table', { cls: 'vt' });
	const tbody = table.createEl('tbody');
	const hsBar = el.createDiv({ cls: 'vt-hs-bar' });
	hsBar.style.display = 'none';
	const hsTrack = hsBar.createDiv({ cls: 'vt-hs-track' });
	hsTrack.createDiv({ cls: 'vt-hs-thumb' });
	setupHsScrollBar(wrap, hsBar);

	const cellMap: HTMLTableCellElement[][] = [];
	let focusedR = 0;
	let focusedC = 0;
	let editing = false;

	const flushActiveCell = () => {
		const active = document.activeElement as HTMLElement | null;
		if (!active?.matches('td') || !table.contains(active)) return;
		const rr = parseInt(active.dataset.vtR ?? '-1', 10);
		const cc = parseInt(active.dataset.vtC ?? '-1', 10);
		if (rr < 0 || cc < 0) return;
		const html = normalizeCellHtml(stripRcHandles(active.innerHTML));
		grid[rr]![cc]!.t = html;
	};

	const commit = (keepFocus = false, caretAtEnd = false) => {
		if (keepFocus) pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd };
		onCommit(serialize(data));
	};

	const rerenderMode = () => {
		applyModeStyles(wrap, table, data, hsBar);
		bindRcResizeHandles(table, data, editing, () => {
			pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
			onCommit(serialize(data));
		});
	};

	const placeCaret = (td: HTMLElement, atEnd: boolean) => {
		const range = document.createRange();
		range.selectNodeContents(td);
		range.collapse(!atEnd);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	};

	const focusCell = (r: number, c: number, caretAtEnd = false): boolean => {
		if (r < 0 || r >= grid.length || c < 0 || c >= (grid[0]?.length ?? 0)) return false;
		if (!visible(grid[r]![c]!)) return false;
		const td = cellMap[r]?.[c];
		if (!td) return false;
		td.focus();
		focusedR = r;
		focusedC = c;
		placeCaret(td, caretAtEnd);
		return true;
	};

	const moveFocus = (dr: number, dc: number): boolean => {
		let r = focusedR + dr;
		let c = focusedC + dc;
		const maxR = grid.length;
		const maxC = grid[0]?.length ?? 0;
		while (r >= 0 && r < maxR && c >= 0 && c < maxC) {
			if (visible(grid[r]![c]!) && cellMap[r]?.[c]) {
				return focusCell(r, c, dc < 0);
			}
			r += dr;
			c += dc;
		}
		return false;
	};

	const setMode = (mode: VtMode) => {
		if (data.mode === mode) return;
		flushActiveCell();

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
		editing = true;
		el.addClass('vt-editing');
		if (settings.enableModeSwitcher) {
			modeBar.show(data.mode);
		}
		rerenderMode();
	};

	const hideEditingUi = () => {
		editing = false;
		el.removeClass('vt-editing');
		modeBar.hide();
		rerenderMode();
		if (activeController?.moveCell === controller.moveCell) activeController = null;
	};

	modeBar.setHandler(setMode);

	const controller: TableController = {
		moveCell(dr: number, dc: number) {
			return moveFocus(dr, dc);
		},
		setMode,
		getMode: () => data.mode,
	};

	grid.forEach((row, r) => {
		cellMap[r] = [];
		const tr = tbody.createEl('tr');
		row.forEach((cellData, c) => {
			if (!visible(cellData)) return;

			const td = tr.createEl('td');
			td.contentEditable = 'true';
			td.dataset.vtR = String(r);
			td.dataset.vtC = String(c);
			cellMap[r]![c] = td;
			if (cellData.rs > 1) td.rowSpan = cellData.rs;
			if (cellData.cs > 1) td.colSpan = cellData.cs;

			populateCell(td, cellData.t, grid, sourcePath, resolveImage);

			td.addEventListener('focus', () => {
				if (!td.closest('.cm-editor')) {
					td.blur();
					return;
				}
				focusedR = r;
				focusedC = c;
				activeController = controller;
				td.innerHTML = grid[r]![c]!.t;
				showEditingUi();
				if (Platform.isDesktop && !settings.enableDesktopToolbar) return;
				if ((Platform.isMobile || Platform.isTablet) && !settings.enableMobileToolbar) return;
				toolbar.show(td, data, r, c,
					(s: string) => {
						pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
						onCommit(s);
					},
					flushActiveCell, () => onConvertToMd(grid), () => onConvertToHtml(grid));
			});

			td.addEventListener('blur', (e) => {
				const html = normalizeCellHtml(stripRcHandles(td.innerHTML));
				const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
				const inSameTable = related?.closest('.vt') === td.closest('.vt');
				const contentChanged = grid[r]![c]!.t !== html;

				if (contentChanged) {
					grid[r]![c]!.t = html;
				}
				autoExpandRowHeight(td, data, r, contentChanged);
				if (!inSameTable) commit();

				populateCell(td, html, grid, sourcePath, resolveImage);
				scheduleMathRender(td);

				const uiClick = document.body.dataset.vtBarClick === '1'
					|| document.body.dataset.vtModeClick === '1';
				if (!inSameTable && !uiClick) {
					toolbar.hide();
					if (!table.contains(document.activeElement)) hideEditingUi();
				}
			});

			td.addEventListener('keydown', (e) => {
				if (!td.closest('.cm-editor')) return;
				let dr = 0;
				let dc = 0;
				if (e.key === 'ArrowUp') dr = -1;
				else if (e.key === 'ArrowDown') dr = 1;
				else if (e.key === 'ArrowLeft') dc = -1;
				else if (e.key === 'ArrowRight') dc = 1;
				else if (e.key === 'Tab') {
					dc = e.shiftKey ? -1 : 1;
					e.preventDefault();
				} else return;

				e.preventDefault();
				if (moveFocus(dr, dc)) return;

				if (e.key === 'Tab' && dc > 0) {
					moveFocus(1, -focusedC);
				}
			});

			td.addEventListener('paste', (e) => {
				e.preventDefault();
				const text = e.clipboardData?.getData('text/plain') ?? '';
				document.execCommand('insertText', false, text);
			});

			td.addEventListener('contextmenu', (e) => {
				if (!td.closest('.cm-editor')) return;
				e.preventDefault();
				e.stopPropagation();
				showCellMenu(e, data, r, c, toolbar, flushActiveCell, () => {
					pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
					onCommit(serialize(data));
				});
			});
		});
	});

	applyModeStyles(wrap, table, data, hsBar);
	bindRcResizeHandles(table, data, false, () => {});
	scheduleMathRender(table);

	if (pendingFocusRestore) {
		const { r: fr, c: fc, caretAtEnd } = pendingFocusRestore;
		pendingFocusRestore = null;
		requestAnimationFrame(() => {
			if (focusCell(fr, fc, caretAtEnd)) {
				showEditingUi();
				const td = cellMap[fr]?.[fc];
				if (td && ((Platform.isDesktop && settings.enableDesktopToolbar)
					|| ((Platform.isMobile || Platform.isTablet) && settings.enableMobileToolbar))) {
					toolbar.show(td, data, fr, fc,
						(s: string) => {
							pendingFocusRestore = { r: fr, c: fc, caretAtEnd };
							onCommit(s);
						},
						flushActiveCell, () => onConvertToMd(grid), () => onConvertToHtml(grid));
				}
			}
		});
	}
}

function normalizeCellHtml(html: string): string {
	const trimmed = html.trim();
	if (!trimmed) return '';
	return trimmed
		.replace(/^<(div|p)>\s*(<br\s*\/?>)?\s*<\/\1>/i, '')
		.replace(/^(&nbsp;|\u00a0|\s)+/, '');
}

function populateCell(
	td: HTMLTableCellElement,
	raw: string,
	grid: Grid,
	sourcePath: string,
	resolveImage: (linkText: string) => string | null,
) {
	td.innerHTML = raw;
	if (/^=[A-Z]+\(/i.test(raw)) {
		td.textContent = evalFormula(grid, raw);
	}
	renderHtml(td);
	renderInlineCode(td);
	renderMarkdown(td);
	renderTodos(td);
	renderImages(td, sourcePath, resolveImage);
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
		const frag = document.createRange().createContextualFragment(text);
		textNode.replaceWith(frag);
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
		const frag = document.createDocumentFragment();
		frag.append(document.createRange().createContextualFragment(html));
		textNode.replaceWith(frag);
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
		const frag = document.createDocumentFragment();
		frag.append(document.createRange().createContextualFragment(html));
		textNode.replaceWith(frag);
	}
}

const TODO_LINE_RE = /^-\s*\[([ xX])\]\s*(.*)$/;

function renderTodos(root: HTMLElement) {
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

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			const m = line.match(TODO_LINE_RE);
			if (m) {
				hasTodo = true;
				const item = document.createElement('div');
				item.className = 'vt-task-item';
				const cb = document.createElement('input');
				cb.type = 'checkbox';
				cb.checked = m[1] !== ' ';
				cb.tabIndex = -1;
				cb.addEventListener('mousedown', (e) => e.preventDefault());
				item.appendChild(cb);
				const span = document.createElement('span');
				span.textContent = m[2] ?? '';
				item.appendChild(span);
				frag.appendChild(item);
			} else if (line || i < lines.length - 1) {
				frag.appendChild(document.createTextNode(line + (i < lines.length - 1 ? '\n' : '')));
			}
		}
		if (!hasTodo) continue;
		textNode.replaceWith(frag);
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
			const altText = match[2]?.trim() ?? '';
			const src = resolveImage(linkText);

			if (src) {
				const img = document.createElement('img');
				img.src = src;
				img.alt = altText || linkText;
				img.style.maxWidth = '100%';
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

function showCellMenu(
	e: MouseEvent,
	data: VtData,
	r: number,
	c: number,
	toolbar: Toolbar,
	flushCell: () => void,
	onCommit: () => void,
) {
	const grid = data.rows;
	const menu = new Menu();
	const apply = (fn: () => void) => {
		flushCell();
		fn();
		onCommit();
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

function isWikiLinkInsideBackticks(text: string, matchIndex: number): boolean {
	const before = text.slice(0, matchIndex);
	const tickCount = (before.match(/`/g) ?? []).length;
	return tickCount % 2 === 1;
}
