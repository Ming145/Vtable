import { Plugin, Editor, EditorPosition, Menu, MarkdownPostProcessorContext, MarkdownView, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import {
	blankSource, mdTableToSource, htmlTableToSource,
	parseSource, gridToMdTable, gridToHtmlTable, Grid,
} from './builder';
import { renderBlock, getActiveTableController } from './render';
import { Toolbar } from './bar';
import { gridToChart, gridsToComboChart, detectChartType } from './charts';

const LANG = 'vtable';

export interface VtSettings {
	enableDesktopToolbar: boolean;
	enableMobileToolbar: boolean;
	enableModeSwitcher: boolean;
}

const DEFAULT_SETTINGS: VtSettings = {
	enableDesktopToolbar: true,
	enableMobileToolbar: true,
	enableModeSwitcher: true,
};

export default class VtPlugin extends Plugin {
	private toolbar!: Toolbar;
	private settings!: VtSettings;

	// 模板自动生成函数
	async ensureTemplates() {
		const vault = this.app.vault;

		// 1. 检测模板文件夹路径（优先读取官方 Templates 核心插件设置）
		let templateFolder = 'TEMPLATE';
		const templatesPlugin = this.app.internalPlugins.getPluginById('templates');
		if (templatesPlugin?.enabled) {
			const folder = templatesPlugin.instance?.options?.folder;
			if (folder) templateFolder = folder;
		}

		// 2. 确保文件夹存在
		const folderExists = await vault.adapter.exists(templateFolder);
		if (!folderExists) {
			await vault.createFolder(templateFolder);
		}

		// 3. 三个模板的内容（第二列全部留空，让用户自己填）
		const templates = [
			{
				name: '柱状图模板.md',
				content: '```vtable\n{"rows":[\n  [{"t":"vbarchart"},{"t":""}],\n  [{"t":"标题"},{"t":""}],\n  [{"t":"v%"},{"t":""}],\n  [{"t":"x范围"},{"t":""}],\n  [{"t":"x"},{"t":""}],\n  [{"t":"y范围"},{"t":""}],\n  [{"t":"y"},{"t":""}],\n  [{"t":"一月"},{"t":""}],\n  [{"t":"二月"},{"t":""}],\n  [{"t":"三月"},{"t":""}],\n  [{"t":"四月"},{"t":""}]\n]}\n```'
			},
			{
				name: '饼图模板.md',
				content: '```vtable\n{"rows":[\n  [{"t":"vpie"},{"t":""}],\n  [{"t":"标题"},{"t":""}],\n  [{"t":"产品A"},{"t":""}],\n  [{"t":"产品B"},{"t":""}],\n  [{"t":"产品C"},{"t":""}],\n  [{"t":"产品D"},{"t":""}],\n  [{"t":"其他"},{"t":""}]\n]}\n```'
			},
			{
				name: '折线图模板.md',
				content: '```vtable\n{"rows":[\n  [{"t":"vline"},{"t":""}],\n  [{"t":"标题"},{"t":""}],\n  [{"t":"x范围"},{"t":""}],\n  [{"t":"x"},{"t":""}],\n  [{"t":"y范围"},{"t":""}],\n  [{"t":"y"},{"t":""}],\n  [{"t":"一月"},{"t":""}],\n  [{"t":"二月"},{"t":""}],\n  [{"t":"三月"},{"t":""}],\n  [{"t":"四月"},{"t":""}],\n  [{"t":"五月"},{"t":""}],\n  [{"t":"六月"},{"t":""}]\n]}\n```'
			}
		];

		// 4. 逐个检查并创建缺失的文件（不覆盖已有文件）
		for (const tpl of templates) {
			const filePath = `${templateFolder}/${tpl.name}`;
			const fileExists = await vault.adapter.exists(filePath);
			if (!fileExists) {
				await vault.create(filePath, tpl.content);
			}
		}
	}

	async onload() {


		await this.ensureTemplates();

		this.addCommand({
			id: 'delete-current-vtable',
			name: '删除当前 Vtable 表格',
			checkCallback: (checking: boolean) => {
				const editor = this.app.workspace.activeEditor?.editor;
				if (!editor) return false;

				const cursor = editor.getCursor();
				const currentLine = cursor.line;

				// 1. 检查当前行是否是空行
				const currentLineText = editor.getLine(currentLine);
				if (currentLineText.trim() !== '') return false;

				// 2. 检查上一行是否是 ``` (vtable 的结束标记)
				if (currentLine === 0) return false;
				const prevLine = currentLine - 1;
				const prevLineText = editor.getLine(prevLine);
				if (prevLineText.trim() !== '```') return false;

				// 3. 向上查找 ```vtable 开始标记
				let startLine = -1;
				let endLine = prevLine;
				for (let i = prevLine - 1; i >= 0; i--) {
					const lineText = editor.getLine(i);
					if (lineText.trim() === '```vtable') {
						startLine = i;
						break;
					}
					if (lineText.trim() === '```' && i !== prevLine) break;
				}
				if (startLine === -1) return false;

				if (checking) return true;

				// 4. 执行删除
				const from = { line: startLine, ch: 0 };
				const to = { line: endLine, ch: editor.getLine(endLine).length };
				editor.replaceRange('', from, to);

				// 5. 清理可能留下的空行
				const afterLine = editor.getLine(startLine);
				if (afterLine === '') {
					editor.replaceRange('', { line: startLine, ch: 0 }, { line: startLine + 1, ch: 0 });
				}

				return true;
			}
		});
		
		this.toolbar = new Toolbar();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new VtSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor(LANG, (source, el, ctx) => {
			renderBlock(
				source,
				el,
				this.toolbar,
				this.settings,
				ctx.sourcePath,
				(linkText) => this.resolveImage(linkText, ctx.sourcePath),
				(newSource) => this.writeBack(el, ctx, newSource),
				(grid) => this.convertBlockToMarkdown(el, ctx, grid),
				(grid) => this.convertBlockToHtml(el, ctx, grid),
			);
		});

		this.addCommand({
			id: 'vt-create',
			name: '创建 vtable',
			editorCallback: (ed: Editor) => this.insertTable(ed),
		});

		this.addCommand({
			id: 'vt-convert',
			name: '转换为 vtable',
			editorCallback: (ed: Editor) => this.convertAtCursor(ed),
		});

		this.addCommand({
			id: 'vt-to-markdown',
			name: '转换为 markdown 表格',
			editorCallback: (ed: Editor) => this.vtableToMarkdown(ed),
		});

		this.addCommand({
			id: 'vt-to-html',
			name: '转换为 HTML 表格',
			editorCallback: (ed: Editor) => this.vtableToHtml(ed),
		});

		this.addCommand({
			id: 'vt-to-chart',
			name: '转换为图表',
			editorCallback: (ed: Editor) => this.vtableToChart(ed),
		});

		this.addCommand({
			id: 'vt-select-above',
			name: '选中上方 vtable 表格',
			editorCallback: (ed: Editor) => this.selectVtableAbove(ed),
		});

		this.registerCellNavCommands();
		this.registerModeCommands();

		this.addRibbonIcon('table-2', '转换为 vtable', () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) this.convertAtCursor(view.editor);
		});

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, ed: Editor) => {
				menu.addItem(item =>
					item
						.setTitle('创建 vtable')
						.setIcon('table')
						.onClick(() => this.insertTable(ed)),
				);
			}),
		);
	}

	onunload() {
		this.toolbar?.destroy();
	}

	private registerCellNavCommands() {
		const dirs: Array<[string, string, number, number]> = [
			['vt-cell-up', 'vtable：上移单元格', -1, 0],
			['vt-cell-down', 'vtable：下移单元格', 1, 0],
			['vt-cell-left', 'vtable：左移单元格', 0, -1],
			['vt-cell-right', 'vtable：右移单元格', 0, 1],
		];
		for (const [id, name, dr, dc] of dirs) {
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const ctrl = getActiveTableController();
					if (!ctrl) return false;
					if (checking) return true;
					ctrl.moveCell(dr, dc);
					return true;
				},
			});
		}
	}

	private registerModeCommands() {
		const modes: Array<[string, string, 'OL' | 'HS' | 'RC']> = [
			['vt-mode-ol', 'vtable：OL 换行模式', 'OL'],
			['vt-mode-hs', 'vtable：HS 横向拉长模式', 'HS'],
			['vt-mode-rc', 'vtable：RC 自由拖拽模式', 'RC'],
		];
		for (const [id, name, mode] of modes) {
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const ctrl = getActiveTableController();
					if (!ctrl) return false;
					if (checking) return true;
					ctrl.setMode(mode);
					return true;
				},
			});
		}
	}

	private insertTable(ed: Editor) {
		const block = '```' + LANG + '\n' + blankSource(2, 2) + '\n```';
		const cur = ed.getCursor();
		const end: EditorPosition = { line: cur.line, ch: ed.getLine(cur.line).length };
		ed.replaceRange('\n' + block + '\n', end);
		ed.setCursor({ line: cur.line + 2, ch: 0 });
	}

	/** 把光标所在的 markdown 表格或 HTML 表格转换为 vtable 代码块（二者共用同一入口） */
	private convertAtCursor(ed: Editor) {
		const mdRange = findMdTable(ed);
		if (mdRange) {
			const md = ed.getRange(mdRange.from, mdRange.to);
			const block = '```' + LANG + '\n' + mdTableToSource(md) + '\n```';
			ed.replaceRange(block, mdRange.from, mdRange.to);
			return;
		}

		const htmlRange = findHtmlTable(ed);
		if (htmlRange) {
			const html = ed.getRange(htmlRange.from, htmlRange.to);
			const block = '```' + LANG + '\n' + htmlTableToSource(html) + '\n```';
			ed.replaceRange(block, htmlRange.from, htmlRange.to);
		}
	}

	/** 把光标所在的 vtable 代码块转换回 markdown 表格 */
	private vtableToMarkdown(ed: Editor) {
		const range = findVtableBlock(ed);
		if (!range) return;
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const data = parseSource(source);
		const grid = data.rows;
		const md = gridToMdTable(grid);
		ed.replaceRange(md, range.blockFrom, range.blockTo);
	}

	/** 把光标所在的 vtable 代码块转换回 HTML 表格 */
	private vtableToHtml(ed: Editor) {
		const range = findVtableBlock(ed);
		if (!range) return;
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const data = parseSource(source);
		const grid = data.rows;
		const html = gridToHtmlTable(grid);
		ed.replaceRange(html, range.blockFrom, range.blockTo);
	}

	/** 转换为图表：自动检测类型 */
	private vtableToChart(ed: Editor) {
		const range = findVtableBlock(ed);
		if (!range) {
			new Notice('未找到可转换的图表 vtable 模板');
			return;
		}

		const source = ed.getRange(range.contentFrom, range.contentTo);
		const grid = parseSource(source).rows;

		if (!detectChartType(grid)) {
			new Notice('不是有效的图表模板（表头应为 vbarchart / vpie / vline）');
			return;
		}

		const output = gridToChart(grid);
		if (!output) {
			new Notice('表格形式不规范：数据行缺失或格式有误');
			return;
		}

		const insertLine = range.blockTo.line;
		ed.replaceRange('\n' + output + '\n', { line: insertLine + 1, ch: 0 });
	}

	/** 选中光标上方最近的 vtable 代码块 */
	private selectVtableAbove(ed: Editor) {
		const block = findVtableBlockAbove(ed);
		if (!block) {
			new Notice('上方未找到 vtable 表格');
			return;
		}
		ed.setSelection(block.blockFrom, block.blockTo);
		ed.scrollIntoView(block.blockFrom, true);
	}

	/** 将新的表格源文本写回代码块内部（围栏之间的行） */
	private writeBack(el: HTMLElement, ctx: MarkdownPostProcessorContext, newSource: string) {
		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		const from: EditorPosition = { line: info.lineStart + 1, ch: 0 };
		const to: EditorPosition = { line: info.lineEnd, ch: 0 };
		editor.replaceRange(newSource + '\n', from, to);
	}

	/** 把整个 vtable 代码块（含围栏）替换为 markdown 表格 */
	private convertBlockToMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext, grid: Grid) {
		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		const from: EditorPosition = { line: info.lineStart, ch: 0 };
		const to: EditorPosition = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
		editor.replaceRange(gridToMdTable(grid), from, to);
	}

	/** 把整个 vtable 代码块（含围栏）替换为 HTML 表格 */
	private convertBlockToHtml(el: HTMLElement, ctx: MarkdownPostProcessorContext, grid: Grid) {
		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		const from: EditorPosition = { line: info.lineStart, ch: 0 };
		const to: EditorPosition = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
		editor.replaceRange(gridToHtmlTable(grid), from, to);
	}

	/** 通过 Obsidian API 解析 ![[linkText]] 为可用的图片 URL */
	private resolveImage(linkText: string, sourcePath: string): string | null {
		const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		if (!file) return null;
		return this.app.vault.getResourcePath(file);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VtSettingTab extends PluginSettingTab {
	private plugin: VtPlugin;

	constructor(app: any, plugin: VtPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'vtable 设置' });

		new Setting(containerEl)
			.setName('电脑端浮窗工具栏')
			.setDesc('在电脑端编辑单元格时显示悬浮格式化工具栏')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableDesktopToolbar)
				.onChange(async (value) => {
					this.plugin.settings.enableDesktopToolbar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('移动端浮窗工具栏')
			.setDesc('在手机/平板设备上编辑单元格时显示悬浮格式化工具栏')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableMobileToolbar)
				.onChange(async (value) => {
					this.plugin.settings.enableMobileToolbar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('模式切换按钮')
			.setDesc('编辑表格时显示 OL / HS / RC 三种模式的切换按钮')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableModeSwitcher)
				.onChange(async (value) => {
					this.plugin.settings.enableModeSwitcher = value;
					await this.plugin.saveSettings();
				}));
	}
}

/** 从光标所在行出发，判断是否处于原始 HTML 表格内，若是则返回 <table>...</table> 的完整行范围 */
function findHtmlTable(ed: Editor): { from: EditorPosition; to: EditorPosition } | null {
	const cur = ed.getCursor().line;
	const n = ed.lineCount();

	let start = -1;
	for (let l = cur; l >= 0; l--) {
		if (/<table[\s>]/i.test(ed.getLine(l))) { start = l; break; }
		if (l !== cur && /<\/table\s*>/i.test(ed.getLine(l))) break;
	}
	if (start === -1) return null;

	let end = -1;
	for (let l = start; l < n; l++) {
		if (/<\/table\s*>/i.test(ed.getLine(l))) { end = l; break; }
	}
	if (end === -1 || cur > end) return null;

	return { from: { line: start, ch: 0 }, to: { line: end, ch: ed.getLine(end).length } };
}

/** 从光标所在行出发，判断是否处于 markdown 表格内，若是则返回表格的完整行范围 */
function findMdTable(ed: Editor): { from: EditorPosition; to: EditorPosition } | null {
	const line = ed.getCursor().line;
	if (!ed.getLine(line).includes('|')) return null;

	let start = line;
	while (start > 0 && ed.getLine(start - 1).includes('|')) start--;

	let end = line;
	const n = ed.lineCount();
	while (end < n - 1 && ed.getLine(end + 1).includes('|')) end++;

	if (end - start < 1) return null;

	// 必须包含分隔行才算表格
	for (let l = start; l <= end; l++) {
		if (/^\s*\|?[\s\-:|]+\|?\s*$/.test(ed.getLine(l)) && ed.getLine(l).includes('-')) {
			return { from: { line: start, ch: 0 }, to: { line: end, ch: ed.getLine(end).length } };
		}
	}
	return null;
}

/** 从光标所在行出发，判断是否处于 vtable 代码块内，若是则返回整块和内容范围 */
function findVtableBlock(ed: Editor): {
	blockFrom: EditorPosition;
	blockTo: EditorPosition;
	contentFrom: EditorPosition;
	contentTo: EditorPosition;
} | null {
	const cur = ed.getCursor().line;
	let start = cur;
	while (start > 0) {
		const line = ed.getLine(start);
		if (/^```vtable\s*$/.test(line.trim())) break;
		start--;
	}
	if (start === 0 && !/^```vtable\s*$/.test(ed.getLine(0).trim())) return null;

	let end = start + 1;
	const n = ed.lineCount();
	while (end < n) {
		if (/^```\s*$/.test(ed.getLine(end).trim())) break;
		end++;
	}
	if (end >= n || cur > end) return null;

	return {
		blockFrom: { line: start, ch: 0 },
		blockTo: { line: end, ch: ed.getLine(end).length },
		contentFrom: { line: start + 1, ch: 0 },
		contentTo: { line: end, ch: 0 },
	};
}

/** 在整篇文档中搜索所有 vtable 代码块，返回距离光标最近的块（用于 Live Preview 模式） */
function findVtableBlockAnywhere(ed: Editor): {
	blockFrom: EditorPosition;
	blockTo: EditorPosition;
	contentFrom: EditorPosition;
	contentTo: EditorPosition;
} | null {
	const fullText = ed.getValue();
	const lines = fullText.split('\n');
	const cursorLine = ed.getCursor().line;
	const n = lines.length;

	let best: {
		blockFrom: EditorPosition;
		blockTo: EditorPosition;
		contentFrom: EditorPosition;
		contentTo: EditorPosition;
	} | null = null;
	let bestDist = Infinity;

	let i = 0;
	while (i < n) {
		const line = lines[i].trim();
		if (line === '```vtable') {
			const blockStart = i;
			let blockEnd = i + 1;
			while (blockEnd < n) {
				if (lines[blockEnd].trim() === '```') break;
				blockEnd++;
			}
			if (blockEnd < n) {
				const dist = Math.abs(blockStart - cursorLine);
				if (dist < bestDist) {
					bestDist = dist;
					best = {
						blockFrom: { line: blockStart, ch: 0 },
						blockTo: { line: blockEnd, ch: lines[blockEnd].length },
						contentFrom: { line: blockStart + 1, ch: 0 },
						contentTo: { line: blockEnd, ch: 0 },
					};
				}
			}
			i = blockEnd + 1;
		} else {
			i++;
		}
	}
	return best;
}

type VtBlockRange = {
	blockFrom: EditorPosition;
	blockTo: EditorPosition;
	contentFrom: EditorPosition;
	contentTo: EditorPosition;
};

/** 列出文档中全部 vtable 代码块 */
function getAllVtableBlocks(ed: Editor): VtBlockRange[] {
	const lines = ed.getValue().split('\n');
	const n = lines.length;
	const blocks: VtBlockRange[] = [];
	let i = 0;
	while (i < n) {
		if (lines[i]!.trim() === '```vtable') {
			const start = i;
			let end = i + 1;
			while (end < n && lines[end]!.trim() !== '```') end++;
			if (end < n) {
				blocks.push({
					blockFrom: { line: start, ch: 0 },
					blockTo: { line: end, ch: lines[end]!.length },
					contentFrom: { line: start + 1, ch: 0 },
					contentTo: { line: end, ch: 0 },
				});
			}
			i = end + 1;
		} else {
			i++;
		}
	}
	return blocks;
}

/** 查找光标上方最近的 vtable 块 */
function findVtableBlockAbove(ed: Editor): VtBlockRange | null {
	const cur = ed.getCursor().line;
	const blocks = getAllVtableBlocks(ed);
	let best: VtBlockRange | null = null;
	for (const b of blocks) {
		if (b.blockTo.line < cur) best = b;
		else if (b.blockFrom.line > cur) break;
	}
	return best;
}
