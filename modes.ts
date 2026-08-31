/**
 * modes.ts — OL / HS / RC 模式
 */

import type { VtData, VtMode } from './builder';

const MODE_HINTS: Record<VtMode, string> = {
	OL: '原始换行模式',
	HS: '横向拉长模式',
	RC: '自由拖拽行高列宽',
};

export class ModeSwitcher {
	readonly el: HTMLElement;
	private onChange: ((mode: VtMode) => void) | null = null;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: 'vt-mode-bar' });
		this.el.style.display = 'none';
		for (const mode of ['OL', 'HS', 'RC'] as VtMode[]) {
			const btn = this.el.createEl('button', { cls: 'vt-mode-btn', text: mode });
			btn.dataset.mode = mode;
			btn.title = MODE_HINTS[mode];
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				document.body.dataset.vtModeClick = '1';
				this.onChange?.(mode);
				setTimeout(() => { delete document.body.dataset.vtModeClick; }, 300);
			});
		}
	}

	setHandler(fn: (mode: VtMode) => void) {
		this.onChange = fn;
	}

	show(active: VtMode) {
		this.el.style.display = 'flex';
		this.setActive(active);
	}

	hide() {
		this.el.style.display = 'none';
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
	// HS 和 RC 模式都显示自定义滚动条
	if (hsBar) hsBar.style.display = (isHs || isRc) ? 'block' : 'none';

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
		else col.style.width = '120px'; // 默认列宽，避免挤压
	}

	table.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr, r) => {
		const h = data.rowHeights?.[r];
		if (h && h > 0) tr.style.height = `${h}px`;
		else tr.style.removeProperty('height');
	});

	table.querySelectorAll<HTMLTableCellElement>('td').forEach(td => {
		const rh = data.rowHeights?.[parseInt(td.dataset.vtR ?? '-1', 10)];
		if (rh && rh > 0) td.style.minHeight = `${rh}px`;
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
			barEl.style.display = 'none';
			return;
		}
		const maxScroll = wrap.scrollWidth - wrap.clientWidth;
		if (maxScroll <= 0) {
			barEl.style.display = 'none';
			return;
		}
		barEl.style.display = 'block';
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
		(thumb as HTMLElement).setPointerCapture(e.pointerId);
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
) {
	const wrap = table.closest('.vt-table-wrap') as HTMLElement | null;
	if (!wrap) return;

	let overlay = wrap.querySelector('.vt-rc-overlay') as HTMLElement | null;
	if (data.mode !== 'RC' || !editing) {
		overlay?.remove();
		return;
	}

	if (!overlay) {
		overlay = wrap.createDiv({ cls: 'vt-rc-overlay' });
	}
	overlay.empty();

	const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
	const cols = data.rows[0]?.length ?? 0;

	// 列拖拽手柄：每列右边缘
	for (let c = 0; c < cols; c++) {
		const firstRow = rows[0];
		if (!firstRow) continue;
		const cells = Array.from(firstRow.querySelectorAll<HTMLTableCellElement>('td'));
		const targetCell = cells.find(td => parseInt(td.dataset.vtC ?? '-1', 10) === c);
		if (!targetCell) continue;

		const rect = targetCell.getBoundingClientRect();
		const tableRect = table.getBoundingClientRect();
		const colHandle = overlay.createDiv({ cls: 'vt-rc-handle vt-rc-handle-col' });
		colHandle.style.left = `${rect.right - tableRect.left - 3}px`;
		colHandle.style.top = '0';
		colHandle.style.height = `${table.offsetHeight}px`;

		colHandle.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!data.colWidths) data.colWidths = [];
			const startX = e.clientX;
			const startW = data.colWidths[c] ?? targetCell.offsetWidth;

			const onMove = (ev: PointerEvent) => {
				const newW = Math.max(40, Math.round(startW + (ev.clientX - startX)));
				data.colWidths![c] = newW;
				const colgroup = table.querySelector('colgroup');
				const col = colgroup?.children[c] as HTMLElement | undefined;
				if (col) col.style.width = `${newW}px`;
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				onUpdate();
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});
	}

	// 行拖拽手柄：每行底边缘
	rows.forEach((tr, r) => {
		const rect = tr.getBoundingClientRect();
		const tableRect = table.getBoundingClientRect();
		const rowHandle = overlay!.createDiv({ cls: 'vt-rc-handle vt-rc-handle-row' });
		rowHandle.style.top = `${rect.bottom - tableRect.top - 3}px`;
		rowHandle.style.left = '0';
		rowHandle.style.width = `${table.offsetWidth}px`;

		rowHandle.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!data.rowHeights) data.rowHeights = [];
			const startY = e.clientY;
			const startH = data.rowHeights[r] ?? tr.offsetHeight;

			const onMove = (ev: PointerEvent) => {
				const newH = Math.max(24, Math.round(startH + (ev.clientY - startY)));
				data.rowHeights![r] = newH;
				tr.style.height = `${newH}px`;
				tr.querySelectorAll<HTMLTableCellElement>('td').forEach(td => {
					td.style.minHeight = `${newH}px`;
				});
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				onUpdate();
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});
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
		const tr = td.closest('tr') as HTMLTableRowElement | null;
		if (tr) tr.style.height = `${needed}px`;
		td.style.minHeight = `${needed}px`;
	}
}
