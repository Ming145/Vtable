import { Plugin, Editor, EditorPosition, Menu, MarkdownPostProcessorContext, MarkdownView, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import {
	blankSource, mdTableToSource, htmlTableToSource,
	parseSource, gridToMdTable, gridToHtmlTable, Grid,
} from './builder';
import { renderBlock } from './render';
import { Toolbar } from './bar';
import { generateBarChart } from './vbarchart';
import { generatePieChart } from './vpiechart';
import { generateLineChart } from './vlinechart';

const LANG = 'vtable';

export interface VtSettings {
	enableDesktopToolbar: boolean;
	enableMobileToolbar: boolean;
}

const DEFAULT_SETTINGS: VtSettings = {
	enableDesktopToolbar: true,
	enableMobileToolbar: true,
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
			id: 'vt-to-barchart',
			name: '转换为柱状图',
			editorCallback: (ed: Editor) => this.vtableToBarChart(ed),
		});

		this.addCommand({
			id: 'vt-to-piechart',
			name: '转换为饼状图',
			editorCallback: (ed: Editor) => this.vtableToPieChart(ed),
		});

		this.addCommand({
			id: 'vt-to-linechart',
			name: '转换为折线图',
			editorCallback: (ed: Editor) => this.vtableToLineChart(ed),
		});

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
		const grid = parseSource(source);
		const md = gridToMdTable(grid);
		ed.replaceRange(md, range.blockFrom, range.blockTo);
	}

	/** 把光标所在的 vtable 代码块转换回 HTML 表格 */
	private vtableToHtml(ed: Editor) {
		const range = findVtableBlock(ed);
		if (!range) return;
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const grid = parseSource(source);
		const html = gridToHtmlTable(grid);
		ed.replaceRange(html, range.blockFrom, range.blockTo);
	}

	/** 把光标所在的 vtable 代码块转换为柱状图 HTML，插入在代码块下方 */
	private vtableToBarChart(ed: Editor) {
		let range = findVtableBlock(ed);
		if (!range) range = findVtableBlockAnywhere(ed);
		if (!range) {
			new Notice('未找到 vtable 代码块');
			return;
		}
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const grid = parseSource(source);

		// 详细验证并给出具体错误提示
		const headerLabels = ['vbarchart', '标题', 'v%', 'x范围', 'x', 'y范围', 'y'];
		if (grid.length < 8) {
			new Notice(`表格行数不足（需要至少 8 行，当前 ${grid.length} 行）`);
			return;
		}
		const colCount = grid[0]?.length ?? 0;
		if (colCount < 2) {
			new Notice(`表格至少需要 2 列，当前仅 ${colCount} 列`);
			return;
		}
		for (let i = 0; i < headerLabels.length; i++) {
			const cellText = grid[i]?.[0]?.t?.trim() ?? '';
			if (cellText !== headerLabels[i]) {
				new Notice(`第 ${i + 1} 行第 1 列应为 "${headerLabels[i]}"，当前为 "${cellText}"`);
				return;
			}
		}

		const html = generateBarChart(grid);
		if (!html) {
			new Notice('表格形式不规范：数据行缺失或格式有误');
			return;
		}
		ed.replaceRange('\n' + html + '\n', { line: range.blockTo.line + 1, ch: 0 });
	}

	/** 把光标所在的 vtable 代码块转换为 Mermaid 饼状图代码块，插入在代码块下方 */
	private vtableToPieChart(ed: Editor) {
		let range = findVtableBlock(ed);
		if (!range) range = findVtableBlockAnywhere(ed);
		if (!range) {
			new Notice('未找到 vtable 代码块');
			return;
		}
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const grid = parseSource(source);

		const headerLabels = ['vpie', '标题'];
		if (grid.length < 3) {
			new Notice(`表格行数不足（需要至少 3 行，当前 ${grid.length} 行）`);
			return;
		}
		const colCount = grid[0]?.length ?? 0;
		if (colCount < 2) {
			new Notice(`表格至少需要 2 列，当前仅 ${colCount} 列`);
			return;
		}
		for (let i = 0; i < headerLabels.length; i++) {
			const cellText = grid[i]?.[0]?.t?.trim() ?? '';
			if (cellText !== headerLabels[i]) {
				new Notice(`第 ${i + 1} 行第 1 列应为 "${headerLabels[i]}"，当前为 "${cellText}"`);
				return;
			}
		}

		const mermaid = generatePieChart(grid);
		if (!mermaid) {
			new Notice('表格形式不规范：数据行缺失或格式有误');
			return;
		}
		ed.replaceRange('\n' + mermaid + '\n', { line: range.blockTo.line + 1, ch: 0 });
	}

	/** 把光标所在的 vtable 代码块转换为折线图 HTML，插入在代码块下方 */
	private vtableToLineChart(ed: Editor) {
		let range = findVtableBlock(ed);
		if (!range) range = findVtableBlockAnywhere(ed);
		if (!range) {
			new Notice('未找到 vtable 代码块');
			return;
		}
		const source = ed.getRange(range.contentFrom, range.contentTo);
		const grid = parseSource(source);

		const headerLabels = ['vline', '标题', 'x范围', 'x', 'y范围', 'y'];
		if (grid.length < 7) {
			new Notice(`表格行数不足（需要至少 7 行，当前 ${grid.length} 行）`);
			return;
		}
		const colCount = grid[0]?.length ?? 0;
		if (colCount < 2) {
			new Notice(`表格至少需要 2 列，当前仅 ${colCount} 列`);
			return;
		}
		for (let i = 0; i < headerLabels.length; i++) {
			const cellText = grid[i]?.[0]?.t?.trim() ?? '';
			if (cellText !== headerLabels[i]) {
				new Notice(`第 ${i + 1} 行第 1 列应为 "${headerLabels[i]}"，当前为 "${cellText}"`);
				return;
			}
		}

		const html = generateLineChart(grid);
		if (!html) {
			new Notice('表格形式不规范：数据行缺失或格式有误');
			return;
		}
		ed.replaceRange('\n' + html + '\n', { line: range.blockTo.line + 1, ch: 0 });
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
