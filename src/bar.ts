/**
 * bar.ts
 * 悬浮格式化工具栏
 * 单元格获得焦点时显示，失焦时隐藏
 * 按钮用 mousedown+preventDefault 保持单元格选区不丢
 */

import {
	Grid, serialize, gridToMdTable,
	mergeRight, mergeDown, splitCell,
	insertRow, insertCol, deleteRow, deleteCol,
} from './builder';

export class Toolbar {
	readonly el: HTMLElement;
	private cell: HTMLElement | null = null;
	private grid: Grid | null = null;
	private cellR = 0;
	private cellC = 0;
	private onCommit: ((s: string) => void) | null = null;
	private onConvertToMd: (() => void) | null = null;
	private onConvertToHtml: (() => void) | null = null;
	private animated = false;
	private animatedTimer: number | null = null;

	constructor() {
		this.el = document.body.createEl('div', { cls: 'vt-bar' });
		this.el.style.display = 'none';
		this.buildRows();
	}

	/* ===== 构建两行 ===== */

	private buildRows() {
		// 第一行：B I A- A+ | 拆 合↓ 合→
		const row1 = this.el.createEl('div', { cls: 'vt-bar-row' });
		const fmtDefs: Array<[string, string, () => void]> = [
			['B',  '加粗',     () => this.exec('bold')],
			['I',  '斜体',     () => this.exec('italic')],
			['A-', '缩小字号', () => this.stepFont(-2)],
			['A+', '放大字号', () => this.stepFont(2)],
		];
		for (const [label, hint, fn] of fmtDefs) {
			const btn = row1.createEl('button', { cls: 'vt-bar-btn', text: label });
			btn.title = hint;
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				document.body.dataset.vtBarClick = '1';
				fn();
				setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
			});
		}
		row1.createEl('span', { cls: 'vt-bar-sep' });

		// 拆分按钮
		const splitBtn = row1.createEl('button', { cls: 'vt-bar-btn', text: '拆' });
		splitBtn.title = '拆分单元格';
		splitBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			this.structExec(splitCell);
		});

		const mergeDefs: Array<[string, string, (g: Grid, r: number, c: number) => void]> = [
			['合↓', '向下合并单元格', mergeDown],
			['合→', '向右合并单元格', mergeRight],
		];
		for (const [label, hint, fn] of mergeDefs) {
			const btn = row1.createEl('button', { cls: 'vt-bar-btn', text: label });
			btn.title = hint;
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.structExec(fn);
			});
		}

		// 第二行：＋行 ＋列 －行 －列 MD H5
		const row2 = this.el.createEl('div', { cls: 'vt-bar-row' });
		const opDefs: Array<[string, string, (g: Grid, r: number, c: number) => void]> = [
			['＋行',   '下方插入行',     (g, r) => insertRow(g, r)],
			['＋列',   '右侧插入列',     (g, _r, c) => insertCol(g, c)],
			['－行',   '删除本行',       (g, r) => deleteRow(g, r)],
			['－列',   '删除本列',       (g, _r, c) => deleteCol(g, c)],
		];
		for (const [label, hint, fn] of opDefs) {
			const btn = row2.createEl('button', { cls: 'vt-bar-btn', text: label });
			btn.title = hint;
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.structExec(fn);
			});
		}
		row2.createEl('span', { cls: 'vt-bar-sep' });

		const mdBtn = row2.createEl('button', { cls: 'vt-bar-btn', text: 'MD' });
		mdBtn.title = '转换为 markdown 表格';
		mdBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const convert = this.onConvertToMd;
			document.body.dataset.vtBarClick = '1';
			this.hide();
			if (convert) convert();
			setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
		});

		const htmlBtn = row2.createEl('button', { cls: 'vt-bar-btn', text: 'H5' });
		htmlBtn.title = '转换为 HTML 表格';
		htmlBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const convert = this.onConvertToHtml;
			document.body.dataset.vtBarClick = '1';
			this.hide();
			if (convert) convert();
			setTimeout(() => { delete document.body.dataset.vtBarClick; }, 200);
		});
	}

	/** 执行结构操作 → 提交 → 隐藏工具栏（Obsidian 重新渲染） */
	private structExec(fn: (g: Grid, r: number, c: number) => void) {
		if (!this.grid || !this.onCommit) return;
		const g = this.grid;
		const commit = this.onCommit;
		const r = this.cellR;
		const c = this.cellC;
		this.hide();
		fn(g, r, c);
		commit(serialize(g));
	}

	/* ===== 显示/隐藏/定位 ===== */

	show(
		cell: HTMLElement,
		grid: Grid,
		r: number,
		c: number,
		onCommit: (s: string) => void,
		onConvertToMd: () => void,
		onConvertToHtml: () => void,
	) {
		this.cell = cell;
		this.grid = grid;
		this.cellR = r;
		this.cellC = c;
		this.onCommit = onCommit;
		this.onConvertToMd = onConvertToMd;
		this.onConvertToHtml = onConvertToHtml;

		// 如果 hide() 的延时重置尚未触发，取消它（说明仍在表格内切换）
		if (this.animatedTimer !== null) {
			clearTimeout(this.animatedTimer);
			this.animatedTimer = null;
		}

		if (!this.animated) {
			// 首次显示：入场动画
			this.el.style.transition = 'none';
			this.el.style.display = 'flex';
			this.el.style.transform = 'scale(0.8) translateY(6px)';
			this.el.style.opacity = '0.7';

			if (!this.reposition()) {
				this.el.style.display = 'none';
				return;
			}

			void this.el.offsetWidth;
			this.el.style.transition = '';

			this.animated = true;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					this.el.style.transform = 'scale(1) translateY(0)';
					this.el.style.opacity = '1';
				});
			});
		} else {
			// 后续显示：直接出现，无动画
			this.el.style.transition = 'none';
			this.el.style.display = 'flex';
			this.el.style.transform = 'scale(1) translateY(0)';
			this.el.style.opacity = '1';
			if (!this.reposition()) {
				this.el.style.display = 'none';
				return;
			}
			void this.el.offsetWidth;
			this.el.style.transition = '';
		}
	}

	hide() {
		this.el.style.transform = '';
		this.el.style.opacity = '';
		this.el.style.display = 'none';
		this.cell = null;
		this.grid = null;
		this.onCommit = null;
		this.onConvertToMd = null;
		this.onConvertToHtml = null;

		// 延时重置动画标记：若短时间内再次 show（表格内切单元格），取消此计时器
		if (this.animatedTimer !== null) clearTimeout(this.animatedTimer);
		this.animatedTimer = window.setTimeout(() => {
			this.animated = false;
			this.animatedTimer = null;
		}, 400);
	}

	private reposition(): boolean {
		const scroller = document.querySelector('.workspace-leaf.mod-active .cm-scroller') as HTMLElement | null;
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
		this.el.style.position = 'fixed';
		this.el.style.left = `${left}px`;
		this.el.style.top = `${sRect.top + sRect.height * 0.8}px`;
		this.el.style.zIndex = '9999';
		return true;
	}

	/* ===== 文本格式化 ===== */

	private exec(cmd: string, value?: string) {
		document.execCommand(cmd, false, value);
	}

	private stepFont(delta: number) {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const anchor = range.startContainer.parentElement;
		if (!anchor) return;
		const cur = parseFloat(getComputedStyle(anchor).fontSize) || 16;
		const next = Math.max(8, Math.min(72, cur + delta));
		if (!sel.isCollapsed) {
			const span = document.createElement('span');
			span.style.fontSize = `${next}px`;
			try { range.surroundContents(span); } catch { /* 跨节点选区忽略 */ }
		} else if (this.cell) {
			this.cell.style.fontSize = `${next}px`;
		}
	}

	destroy() {
		if (this.animatedTimer !== null) clearTimeout(this.animatedTimer);
		this.el.remove();
	}
}
