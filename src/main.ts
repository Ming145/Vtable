import { Plugin, Editor, EditorPosition, Menu, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, PluginSettingTab, Setting, setIcon, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import {
        blankSource, mdTableToSource, htmlTableToSource,
        parseSource, gridToMdTable, gridToHtmlTable, Grid,
} from './builder';
import { renderBlock, getActiveTableController, requestInitialFocus, noteScrollAnchor, refreshAllTableAppearance, DEFAULT_CONTEXT_MENU } from './render';
import { setUiLang, t, REPO_URL, barLegend } from './i18n';
import type { UiLang } from './i18n';
import { VT_MENU_ACTIONS } from './render';
import { Toolbar } from './bar';
import { gridToChart, detectChartType } from './charts';

const LANG = 'vtable';

export interface VtSettings {
        enableDesktopToolbar: boolean;
        enableMobileToolbar: boolean;
        enableModeSwitcher: boolean;
        /** 任务5：表格外框圆角（px，0 = 直角） */
        tableRadius: number;
        /** 任务7：表头底色模式 */
        headerStyle: 'none' | 'theme' | 'custom';
        /** 任务7：自定义表头底色（hex） */
        headerColor: string;
        /** 导出 Markdown 时嵌套 HTML 标签以保留对齐/底色 */
        mdHtmlTags: boolean;
        /** 设置/浮窗/菜单界面语言（默认中文） */
        uiLang: 'zh' | 'en';
        /** 右键菜单结构配置：一行一项，"---"=分隔线，"cmd:id"=Obsidian 命令，"id|icon"=自定义图标，
         *  全角"｜"分隔一行内多个纯图标小项（对齐组） */
        contextMenu: string;
        /** 全局表格线风格（三线表/无格线/全横线）；单表可用命令覆盖或显式取消 */
        tblStyle: 'none' | 'three' | 'noline' | 'hline';
        /** 全局表格线风格开关（默认关：单表用「表格样式调用」命令驱动） */
        tblStyleEnabled: boolean;
        /** 隔行变色颜色来源：无（=从未设置，命令取主题色兜底）/主题色/自定义 */
        zebraStyle: 'none' | 'theme' | 'custom';
        /** 隔行变色自定义色（hex） */
        zebraColor: string;
        /** 全局隔行变色开关（默认关：单表用「隔行变色样式」命令驱动） */
        zebraEnabled: boolean;
}

const DEFAULT_SETTINGS: VtSettings = {
        enableDesktopToolbar: true,
        enableMobileToolbar: true,
        enableModeSwitcher: true,
        tableRadius: 0,
        headerStyle: 'none',
        headerColor: '#4a90d9',
        mdHtmlTags: true,
        uiLang: 'zh',
        contextMenu: DEFAULT_CONTEXT_MENU,
        tblStyle: 'none',
        tblStyleEnabled: false,
        zebraStyle: 'none',
        zebraColor: '#e8f0fe',
        zebraEnabled: false,
};

/** 旧版默认菜单配置（历史存档对照用；现行升级策略=按"缺对齐组"插入，见 onload） */
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
                //    启动早期 vault 文件索引可能尚未就绪：getAbstractFileByPath 对磁盘上已存在的文件夹
                //    误判 null，createFolder 随即报 already exists 并炸掉整个 onload（首次启动必现、
                //    重开因索引已建而正常）。createFolder 幂等化：already exists 视为目标状态达成
                if (vault.getAbstractFileByPath(normalizePath(templateFolder)) == null) {
                        try {
                                await vault.createFolder(templateFolder);
                        } catch (err) {
                                if (!String((err as { message?: string }).message ?? err).includes('already exists')) throw err;
                        }
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

                // 4. 逐个检查并创建缺失的文件（不覆盖已有文件；create 的 already exists 同上幂等处理）
                for (const tpl of templates) {
                        const filePath = `${templateFolder}/${tpl.name}`;
                        if (vault.getAbstractFileByPath(normalizePath(filePath)) == null) {
                                try {
                                        await vault.create(filePath, tpl.content);
                                } catch (err) {
                                        if (!String((err as { message?: string }).message ?? err).includes('already exists')) throw err;
                                }
                        }
                }
        }

        /** 官方"加载失败"提示不带技术细节：onload 全量捕获，错误消息直达 Notice 供真机定位 */
        async onload() {
                try {
                        await this.onloadInner();
                } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        const first = e instanceof Error && e.stack ? (e.stack.split('\n')[1] || '').trim() : '';
                        console.error('[Vtable] onload 失败：', e);
                        new Notice(`Vtable 加载失败：${msg}\n${first}`, 0);
                        throw e;
                }
        }

        private async onloadInner() {

                // 语言必须先于任何 addCommand 初始化：命令名在注册时求值（t() 即时返回），
                // 晚于注册再切语言只会改到设置面板文本，命令名仍是注册时的旧语言
                this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
                // 旧菜单配置升级（多种历史默认形态/自定义串都可能没有对齐组）：
                // 不含 vt.alignL → 在合并组前插入两个对齐图标组（自定义用户可在文本框删掉）
                if (!this.settings.contextMenu.includes('vt.alignL')) {
                        const lines = this.settings.contextMenu.split('\n');
                        const mi = lines.findIndex(l => l.trim() === 'vt.mergeRight');
                        const ins = ['vt.alignL｜vt.alignC｜vt.alignR', 'vt.alignT｜vt.alignM｜vt.alignB'];
                        if (mi >= 0) lines.splice(mi, 0, ...ins);
                        else lines.push('---', ...ins);
                        this.settings.contextMenu = lines.join('\n');
                        await this.saveSettings();
                }
                // 旧菜单配置升级：粘贴（vt.paste，2026-10-07 加入）——默认串/自定义串补插到剪切前；
                // 无剪切行 → 复制行后；两者都无 → 串首（自定义用户可在文本框删掉）
                if (!this.settings.contextMenu.includes('vt.paste')) {
                        const lines = this.settings.contextMenu.split('\n');
                        const ci = lines.findIndex(l => l.trim() === 'vt.cut');
                        if (ci >= 0) lines.splice(ci, 0, 'vt.paste');
                        else {
                                const ci2 = lines.findIndex(l => l.trim() === 'vt.copy');
                                if (ci2 >= 0) lines.splice(ci2 + 1, 0, 'vt.paste');
                                else lines.unshift('vt.paste');
                        }
                        this.settings.contextMenu = lines.join('\n');
                        await this.saveSettings();
                }
                setUiLang(this.settings.uiLang);
                await this.ensureTemplates();


                this.addCommand({
                        id: 'delete-current-table',
                        name: t('删除当前 Vtable 表格', 'Delete current vtable'),
                        callback: () => {
                                const ed = this.activeEditor();
                                if (!ed) {
                                        new Notice(t('当前没有可用的编辑器', 'No active editor'));
                                        return;
                                }
                                this.deleteCurrentVtable(ed);
                        },
                });
                
                this.toolbar = new Toolbar();
                this.addSettingTab(new VtSettingTab(this.app, this));

                // 未离焦就切阅读视图/布局变化：Obsidian 可能只隐藏编辑容器而不摘 DOM →
                // td 不触发 blur，未失焦的编辑停留在内存 grid。layout-change 是唯一可靠的提交钩子
                this.registerEvent(this.app.workspace.on('layout-change', () => {
                        getActiveTableController()?.flushCommit();
                }));



                // bug1：浮窗幽灵防护——焦点元素被摘除时 blur 不触发，靠全局事件兜底隐藏
                this.registerDomEvent(window, 'blur', () => this.toolbar.hide());
                this.registerDomEvent(document, 'visibilitychange', () => {
                        if (document.visibilityState === 'hidden') this.toolbar.hide();
                });
                this.registerDomEvent(document, 'focusin', (e: FocusEvent) => {
                        const t = e.target;
                        if (this.toolbar.el.style.display !== 'none'
                                && t instanceof Element
                                && !t.closest('table.vt, .vt-bar, .vt-mode-bar')) {
                                this.toolbar.hide();
                        }
                });

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
                                (direction) => this.exitTableToEditor(el, ctx, direction),
                                (initial, cb) => new VtColorModal(this.app, initial, cb).open(),
                                (linkText) => { void this.app.workspace.openLinkText(linkText, ctx.sourcePath, false); },
                                (cmdId) => {
                                        const c = (this.app.commands as unknown as {
                                                commands: Record<string, { name: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean }>;
                                        }).commands[cmdId];
                                        if (!c) return null;
                                        return {
                                                name: c.name,
                                                run: () => (this.app.commands as unknown as { executeCommandById: (id: string) => void }).executeCommandById(cmdId),
                                        };
                                },
                        );
                        // 阅读模式：渲染完成后缓存 section 行号（勾选等写回用；阅读模式下 CM 定位不可用）
                        window.requestAnimationFrame(() => {
                                const info = ctx.getSectionInfo(el);
                                if (info) this.sectionInfoCache.set(el, { lineStart: info.lineStart, lineEnd: info.lineEnd });
                        });
                });

                this.addCommand({
                        id: 'vt-create',
                        name: t('创建 vtable', 'Create vtable'),
                        callback: () => this.runWithEditor(ed => this.insertTable(ed)),
                });

                this.addCommand({
                        id: 'vt-convert',
                        name: t('转换为 vtable', 'Convert to vtable'),
                        callback: () => this.runWithEditor(ed => this.convertAtCursor(ed)),
                });

                this.addCommand({
                        id: 'vt-to-markdown',
                        name: t('转换为 markdown 表格', 'Convert to Markdown table'),
                        callback: () => this.runWithEditor(ed => this.vtableToMarkdown(ed)),
                });

                this.addCommand({
                        id: 'vt-to-html',
                        name: t('转换为 HTML 表格', 'Convert to HTML table'),
                        callback: () => this.runWithEditor(ed => this.vtableToHtml(ed)),
                });

                this.addCommand({
                        id: 'vt-to-chart',
                        name: t('转换为图表', 'Convert to chart'),
                        callback: () => this.runWithEditor(ed => this.vtableToChart(ed)),
                });

                this.addCommand({
                        id: 'vt-select-above',
                        name: t('选中上方 vtable 表格', 'Select vtable above'),
                        callback: () => this.runWithEditor(ed => this.selectVtableAbove(ed)),
                });

                this.registerCellNavCommands();
                this.registerModeCommands();
                this.registerHeaderBgCommand();
                        this.registerSelectionFormatCommands();
                this.registerArrowIntoTable();

                this.addRibbonIcon('table-2', '转换为 vtable', () => {
                        this.runWithEditor(ed => this.convertAtCursor(ed));
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
                        ['vt-cell-up', t('上移单元格', 'Move cell up'), -1, 0],
                        ['vt-cell-down', t('下移单元格', 'Move cell down'), 1, 0],
                        ['vt-cell-left', t('左移单元格', 'Move cell left'), 0, -1],
                        ['vt-cell-right', t('右移单元格', 'Move cell right'), 0, 1],
                ];
                for (const [id, name, dr, dc] of dirs) {
                        this.addCommand({
                                id,
                                name,
                                callback: () => {
                                        const ctrl = getActiveTableController();
                                        if (!ctrl) {
                                                new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                                return;
                                        }
                                        ctrl.moveCell(dr, dc);
                                },
                        });
                }
        }

        private registerModeCommands() {
                const modes: Array<[string, string, 'OL' | 'HS' | 'RC']> = [
                        ['vt-mode-ol', t('OL 换行模式', 'OL wrap mode'), 'OL'],
                        ['vt-mode-hs', t('HS 横向拉长模式', 'HS stretch mode'), 'HS'],
                        ['vt-mode-rc', t('RC 自由拖拽模式', 'RC free drag mode'), 'RC'],
                ];
                for (const [id, name, mode] of modes) {
                        this.addCommand({
                                id,
                                name,
                                callback: () => {
                                        const ctrl = getActiveTableController();
                                        if (!ctrl) {
                                                new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                                return;
                                        }
                                        ctrl.setMode(mode);
                                },
                        });
                }
        }

        /** 命令：删除表格样式（只删不加：线风格+隔行+表头底色一次全取消）+
         *  命令：添加/删除表头底色（单表格级开关，覆盖全局 headerStyle；全局未启用时报错） */
        private registerHeaderBgCommand() {
                this.addCommand({
                        id: 'vt-remove-style',
                        name: t('删除表格样式', 'Remove table styles'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first'));
                                        return;
                                }
                                const removed = ctrl.toggleStyleAll();
                                new Notice(removed ? t('已取消本表全部样式', 'All styles removed for this table') : t('本表没有可删除的样式', 'No styles to remove on this table'));
                        },
                });

                this.addCommand({
                        id: 'vt-toggle-header-bg',
                        name: t('添加表头底色', 'Add header background'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first'));
                                        return;
                                }
                                if (this.settings.headerStyle === 'none') {
                                        new Notice(t('未启用表头底色：请先在设置中将「表头底色」设为主题色或自定义色', 'Header background is off: set it to Theme color or Custom color in settings first'));
                                        return;
                                }
                                const added = ctrl.addHeaderBg();
                                new Notice(added ? t('已添加表头底色', 'Header background added') : t('本表已有表头底色', 'Header background already on'));
                        },
                });

                // 命令：表格样式调用——选择框三选一（三线表/无格线/全横线），写单表覆盖；
                // 再点当前生效项 = 取消本表样式（回跟随全局）
                this.addCommand({
                        id: 'vt-style-call',
                        name: t('表格样式调用', 'Table style call'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                        return;
                                }
                                void ctrl.styleCall((options) => new Promise((resolve) => {
                                        const menu = new Menu();
                                        for (const o of options) {
                                                menu.addItem((i) => {
                                                        i.setTitle(o.checked ? `✓ ${o.name}` : o.name);
                                                        i.onClick(() => resolve(o.value));
                                                });
                                        }
                                        menu.onHide(() => resolve(null));
                                        const td = document.activeElement as HTMLElement | null;
                                        const rect = td?.matches?.('td') ? td.getBoundingClientRect() : null;
                                        menu.showAtPosition(rect
                                                ? { x: rect.left + rect.width / 2, y: rect.bottom + 4 }
                                                : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
                                }));
                        },
                });

                // 命令：隔行变色样式（单表开关，色取设置里最后一次配置；从未设置→主题色）
                this.addCommand({
                        id: 'vt-toggle-zebra',
                        name: t('隔行变色样式', 'Zebra stripe style'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                        return;
                                }
                                const on = ctrl.toggleZebra();
                                new Notice(on ? t('已应用隔行变色', 'Zebra stripes applied') : t('已取消隔行变色', 'Zebra stripes removed'));
                        },
                });

                this.addCommand({
                        id: 'vt-diag-toggle',
                        name: t('斜分单元格（对角线，分两个输入区）', 'Diagonal split cell (two input areas)'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                        return;
                                }
                                ctrl.toggleDiag();
                        },
                });
        }

        private registerSelectionFormatCommands() {
                const aligns: Array<[string, string, 'l' | 'c' | 'r']> = [
                        ['vt-align-left', t('选中单元格居左', 'Align cells left'), 'l'],
                        ['vt-align-center', t('选中单元格居中', 'Align cells center'), 'c'],
                        ['vt-align-right', t('选中单元格居右', 'Align cells right'), 'r'],
                ];
                // 垂直对齐（上/中/下）——与水平对齐同语义：选区生效，无选区对光标所在格生效
                const vAligns: Array<[string, string, 't' | 'm' | 'b']> = [
                        ['vt-align-top', t('选中单元格顶对齐', 'Align cells top'), 't'],
                        ['vt-align-middle', t('选中单元格垂直居中', 'Align cells middle'), 'm'],
                        ['vt-align-bottom', t('选中单元格底对齐', 'Align cells bottom'), 'b'],
                ];
                for (const [id, name, mode] of [...aligns, ...vAligns] as Array<[string, string, 'l' | 'c' | 'r' | 't' | 'm' | 'b']>) {
                        this.addCommand({
                                id,
                                name,
                                callback: () => {
                                        const ctrl = getActiveTableController();
                                        if (!ctrl) {
                                                new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                                return;
                                        }
                                        if (mode === 't' || mode === 'm' || mode === 'b') ctrl.alignVSel(mode);
                                        else ctrl.alignSel(mode);
                                },
                        });
                }

                this.addCommand({
                        id: 'vt-cell-color',
                        name: t('选中单元格设置底色', 'Set cell background'),
                        callback: () => {
                                const ctrl = getActiveTableController();
                                if (!ctrl) {
                                        new Notice(t('请先点击 vtable 表格中的任意单元格进入编辑状态', 'Click any cell in a vtable table first to enter edit mode'));
                                        return;
                                }
                                ctrl.pickColor();
                        },
                });
        }

        private insertTable(ed: Editor) {
                const source = blankSource(2, 2);
                const block = '```' + LANG + '\n' + source + '\n```';
                const cur = ed.getCursor();
                const end: EditorPosition = { line: cur.line, ch: ed.getLine(cur.line).length };
                ed.replaceRange('\n' + block + '\n', end);

                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                const currentMode = (view as unknown as { currentMode?: { sourceMode?: boolean } } | null)?.currentMode;
                if (currentMode?.sourceMode) {
                        // 源码模式：没有渲染态表格可聚焦，光标落到 JSON 首行
                        ed.setCursor({ line: cur.line + 2, ch: 0 });
                } else {
                        // 实时预览：表格渲染完成后自动聚焦 A1 单元格（带目标源文本，多表文档不被偷走）
                        requestInitialFocus(0, 0, source);
                }
        }

        /** 获取当前活动编辑器（常驻命令用：拿不到时提示而非隐藏命令） */
        private activeEditor(): Editor | null {
                return this.app.workspace.activeEditor?.editor
                        ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
                        ?? null;
        }

        /** 常驻命令统一入口：确保有活动编辑器再执行 */
        private runWithEditor(fn: (ed: Editor) => void) {
                const ed = this.activeEditor();
                if (!ed) {
                        new Notice(t('当前没有可用的编辑器', 'No active editor'));
                        return;
                }
                fn(ed);
        }

        /** 从表格跳出：把编辑器光标放到代码块上方/下方的文本行（供方向键跳出表格使用） */
        private exitTableToEditor(el: HTMLElement, ctx: MarkdownPostProcessorContext, direction: -1 | 1) {
                const info = ctx.getSectionInfo(el);
                if (!info) return;
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const editor = view.editor;

                if (direction < 0) {
                        // 表格已在文档顶部：上方无文本行，保持焦点在表格内
                        if (info.lineStart <= 0) return;
                        const line = info.lineStart - 1;
                        editor.focus();
                        editor.setCursor({ line, ch: editor.getLine(line).length });
                } else {
                        // 表格已在文档末尾：下方无文本行，保持焦点在表格内
                        if (info.lineEnd >= editor.lineCount() - 1) return;
                        editor.focus();
                        editor.setCursor({ line: info.lineEnd + 1, ch: 0 });
                }
        }

        /** 方向键入表（跳出表格的逆操作）：光标在 vtable 代码块上一行按 ↓ 进首格、下一行按 ↑ 进末格，
         *  不再进入源码视图。关键点：Obsidian 内置 keymap（cursorDown 等）注册在前会先吞键，
         *  必须用 Prec.highest(keymap.of(...)) 把绑定排到全部 keymap 之前；require 失败时降级
         *  document 捕获（原生 addEventListener 显式 capture，registerDomEvent 的 options 转发不可靠） */
        private registerArrowIntoTable() {
                const tryEnter = (key: 'ArrowDown' | 'ArrowUp', view: EditorView): boolean => {
                        try {
                                // 焦点必须真正在编辑内容上（搜索框/弹层输入框按方向键不劫持）
                                const contentDOM = view?.contentDOM;
                                const ae = document.activeElement;
                                if (contentDOM && ae !== contentDOM && !contentDOM.contains(ae)) return false;
                                // 焦点已在表格内（td 编辑/导航中）→ 交给表格内部的方向键处理
                                if (ae && (ae as HTMLElement).closest?.('.vtable-container')) return false;
                                const doc = view.state.doc;
                                const sel = view.state.selection.main;
                                if (!sel.empty) return false; // 拖选文本时不劫持
                                const line = doc.lineAt(sel.head);
                                let target: 'first' | 'last' | null = null;
                                let fenceLine = -1; // vtable 首围栏行（1-based）
                                if (key === 'ArrowDown') {
                                        // 光标行下一行是 vtable 首围栏 → 进首格
                                        if (line.number >= doc.lines) return false;
                                        const next = doc.line(line.number + 1);
                                        if (next.text.startsWith('```vtable')) {
                                                target = 'first';
                                                fenceLine = next.number;
                                        }
                                } else {
                                        // 光标行上一行是结束围栏 → 回溯首围栏确认是 vtable 块 → 进末格
                                        if (line.number <= 1) return false;
                                        const prev = doc.line(line.number - 1);
                                        if (prev.text.startsWith('```')) {
                                                for (let n = prev.number - 1; n >= Math.max(1, prev.number - 200); n--) {
                                                        const t = doc.line(n).text;
                                                        if (t.startsWith('```')) {
                                                                if (t.startsWith('```vtable')) {
                                                                        target = 'last';
                                                                        fenceLine = n;
                                                                }
                                                                break;
                                                        }
                                                }
                                        }
                                }
                                if (!target) return false;
                                const el = this.locateTableEl(key, view, doc, fenceLine);
                                if (!el) {
                                        // 判定命中但没找到渲染容器：异常路径，弹提示收集线索
                                        new Notice(t('Vtable：方向键已命中表格，但未定位到渲染容器（请把此提示反馈给开发者）', 'Vtable: arrow key matched a table but its container was not found (please report this to the developer)'));
                                        return false;
                                }
                                if (target === 'first') {
                                        // ↓ → A1（首行第一列）
                                        const first = el.querySelector<HTMLElement>('table.vt td');
                                        if (!first) return false;
                                        first.focus();
                                } else {
                                        // ↑ → 末行第一列（A 末行，与 A1 对称；纵向合并的末行可能无格，取有格的最末行首格）
                                        let lastRowTds: HTMLElement[] = [];
                                        let lastR = -1;
                                        el.querySelectorAll<HTMLElement>('table.vt td[data-vt-r]').forEach(td => {
                                                const r = parseInt(td.dataset.vtR ?? '-1', 10);
                                                if (r > lastR) {
                                                        lastR = r;
                                                        lastRowTds = [td];
                                                } else if (r === lastR) {
                                                        lastRowTds.push(td);
                                                }
                                        });
                                        const cell = lastRowTds[0] ?? el.querySelector<HTMLElement>('table.vt td');
                                        if (!cell) return false;
                                        cell.focus();
                                }
                                return true;
                        } catch {
                                return false; // 任何异常静默放行默认行为
                        }
                };

                let registered = false;
                try {
                        // @ts-ignore —— @codemirror/* 运行时由 Obsidian 提供，devDependencies 未装类型包；
                        // 保留 require 动态获取：失败时走下方 document 捕获降级路径，静态导入会砍掉兜底
                        // eslint-disable-next-line @typescript-eslint/no-require-imports -- 动态获取保留失败降级设计
                        const cmView = require('@codemirror/view');
                        // @ts-ignore
                        // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
                        const cmState = require('@codemirror/state');
                        const keymap = cmView?.keymap;
                        const Prec = cmState?.Prec;
                        if (keymap?.of && Prec?.highest) {
                                this.registerEditorExtension(Prec.highest(keymap.of([
                                        { key: 'ArrowDown', run: (view: EditorView) => tryEnter('ArrowDown', view) },
                                        { key: 'ArrowUp', run: (view: EditorView) => tryEnter('ArrowUp', view) },
                                ])));
                                registered = true;
                        }
                } catch { /* CM6 模块不可用则走降级 */ }
                if (!registered) {
                        // 降级：document 捕获阶段（原生 addEventListener，显式 capture）
                        const onKey = (e: KeyboardEvent) => {
                                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
                                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                                if (!view) return;
                                // Obsidian 的 Editor 持有 CM6 EditorView（非公开 API，社区插件通行用法），最小化声明取用
                                const cm = (view.editor as unknown as { cm: EditorView }).cm;
                                if (!cm?.state || typeof cm.hasFocus !== 'function' || !cm.hasFocus) return;
                                if (tryEnter(e.key, cm)) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                }
                        };
                        document.addEventListener('keydown', onKey, { capture: true });
                        this.register(() => document.removeEventListener('keydown', onKey));
                }
        }

        /** 定位光标行紧邻的 vtable 渲染容器：路径1 光标行 cm-line 兄弟扫描 → 路径2 domAtPos 近邻 → 路径3 posAtDOM 反查 */
        private locateTableEl(key: 'ArrowDown' | 'ArrowUp', view: EditorView, doc: Text, fenceLine: number): HTMLElement | null {
                // 路径1：光标所在 cm-line 的相邻兄弟（live preview 中 embed-block 紧邻围栏行）
                try {
                        const at = view.domAtPos(view.state.selection.main.head);
                        let node: Node | null = at.node;
                        if (node && node.nodeType !== 1) node = node.parentElement;
                        const lineEl = (node as HTMLElement)?.closest?.('.cm-line') as HTMLElement | null;
                        if (lineEl) {
                                let sib: Element | null = lineEl;
                                for (let i = 0; i < 3 && sib; i++) {
                                        sib = key === 'ArrowDown' ? sib.nextElementSibling : sib.previousElementSibling;
                                        if (!sib) break;
                                        const embed = sib.classList.contains('cm-embed-block')
                                                ? sib
                                                : sib.querySelector('.cm-embed-block');
                                        const vt = embed?.querySelector<HTMLElement>('.vtable-container');
                                        if (vt) return vt;
                                }
                        }
                } catch { /* 走下一路径 */ }
                // 路径2：首围栏行位置处 DOM 近邻找 embed-block
                try {
                        const at = view.domAtPos(doc.line(fenceLine).from);
                        const host = at.node as HTMLElement;
                        if (host && host.nodeType === 1) {
                                const kids = Array.from(host.children);
                                for (let i = Math.max(0, at.offset - 2); i <= Math.min(kids.length - 1, at.offset + 2); i++) {
                                        const embed = kids[i]?.closest?.('.cm-embed-block') as HTMLElement | null;
                                        const vt = embed?.querySelector<HTMLElement>('.vtable-container');
                                        if (vt) return vt;
                                }
                        }
                } catch { /* 走下一路径 */ }
                // 路径3：渲染容器反查文档位置匹配围栏行（posAtDOM 可能落在围栏行或内容首行，都接受）
                try {
                        const fenceFrom = doc.line(fenceLine).from;
                        const containers = document.querySelectorAll<HTMLElement>('.vtable-container');
                        let fallback: HTMLElement | null = null;
                        for (const c of Array.from(containers)) {
                                if (!c.isConnected) continue;
                                try {
                                        const p = view.posAtDOM(c, 0);
                                        if (doc.lineAt(p).from === fenceFrom) return c;
                                        if (doc.lineAt(p).number === fenceLine + 1) fallback = c;
                                } catch { /* 单个容器失败继续 */ }
                        }
                        if (fallback) return fallback;
                } catch { /* 定位彻底失败 */ }
                return null;
        }

        /** 删除光标上方紧邻的 vtable 代码块（光标需位于表格下方第一个空行） */
        private deleteCurrentVtable(ed: Editor) {
                const hint = () => new Notice(t('请将光标放在要删除的 vtable 表格下方紧邻的空行上再执行删除', 'Put the cursor on the empty line right below the vtable block to delete it'));

                const cursor = ed.getCursor();
                const currentLine = cursor.line;

                // 1. 当前必须是空行
                if (ed.getLine(currentLine).trim() !== '') {
                        hint();
                        return;
                }

                // 2. 上一行必须是 ```（vtable 结束围栏）
                if (currentLine === 0) {
                        hint();
                        return;
                }
                const prevLine = currentLine - 1;
                if (ed.getLine(prevLine).trim() !== '```') {
                        hint();
                        return;
                }

                // 3. 向上查找 ```vtable 开始围栏
                let startLine = -1;
                const endLine = prevLine;
                for (let i = prevLine - 1; i >= 0; i--) {
                        const lineText = ed.getLine(i);
                        if (lineText.trim() === '```vtable') {
                                startLine = i;
                                break;
                        }
                        if (lineText.trim() === '```' && i !== prevLine) break;
                }
                if (startLine === -1) {
                        new Notice(t('上方未找到 vtable 代码块', 'No vtable code block found above'));
                        return;
                }

                // 4. 执行删除
                ed.replaceRange('', { line: startLine, ch: 0 }, { line: endLine, ch: ed.getLine(endLine).length });

                // 5. 清理残留空行
                if (ed.getLine(startLine) === '') {
                        ed.replaceRange('', { line: startLine, ch: 0 }, { line: startLine + 1, ch: 0 });
                }
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
                const md = gridToMdTable(grid, { htmlTags: this.settings.mdHtmlTags });
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
                        new Notice(t('未找到可转换的图表 vtable 模板', 'No chart template found'));
                        return;
                }

                const source = ed.getRange(range.contentFrom, range.contentTo);
                const grid = parseSource(source).rows;

                if (!detectChartType(grid)) {
                        new Notice(t('不是有效的图表模板（表头应为 vbarchart / vpie / vline）', 'Not a valid chart template (header must be vbarchart / vpie / vline)'));
                        return;
                }

                const output = gridToChart(grid);
                if (!output) {
                        new Notice(t('表格形式不规范：数据行缺失或格式有误', 'Malformed table: data rows missing or invalid'));
                        return;
                }

                const insertLine = range.blockTo.line;
                ed.replaceRange('\n' + output + '\n', { line: insertLine + 1, ch: 0 });
        }

        /** 选中光标上方最近的 vtable 代码块 */
        private selectVtableAbove(ed: Editor) {
                const block = findVtableBlockAbove(ed);
                if (!block) {
                        new Notice(t('上方未找到 vtable 表格', 'No vtable table found above'));
                        return;
                }
                ed.setSelection(block.blockFrom, block.blockTo);
                ed.scrollIntoView(block.blockFrom, true);
        }

        /** 阅读模式写回定位缓存：渲染完成后 getSectionInfo 可用性最高，缓存行号供后续写回兜底
         *  （阅读模式下 CM posAtDOM 不可用——el 不在编辑器 DOM 里，两条旧路径全失败 = 勾选不保存的根因） */
        private sectionInfoCache = new WeakMap<HTMLElement, { lineStart: number; lineEnd: number }>();

        /** 将新的表格源文本写回代码块内部（围栏之间的行） */
        private writeBack(el: HTMLElement, ctx: MarkdownPostProcessorContext, newSource: string) {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const editor = view.editor;

                // 任务7：live preview 下 getSectionInfo 偶发/恒为 null → 静默丢改动（待办勾选无反应）。
                // 兜底：用 CM6 posAtDOM 从渲染容器反查文档行号，向上找 ``` 开始围栏、向下找结束围栏；
                // 阅读模式第三条路：用渲染完成时缓存的 section 行号（CM 路径在阅读模式必然失败）
                let info = ctx.getSectionInfo(el);
                if (info) this.sectionInfoCache.set(el, { lineStart: info.lineStart, lineEnd: info.lineEnd });
                else info = this.sectionInfoCache.get(el) ?? null;
                if (!info) info = this.locateBlockByDom(el, view);
                if (!info) {
                        // 定位失败 = 本次改动无法落盘（内存数据仍保留，下次成功写回会带上）。
                        // 静默丢弃会让"打勾/编辑没存"无从排查，明确告知
                        new Notice(t('无法定位表格在文档中的位置，本次更改暂未写入文件', 'Vtable: table position in the document not found; this change was not written to file'));
                        return;
                }

                // bug4：多表重渲染期间滚动高度塌陷会把视图钳到文档顶部——记录重写前的滚动状态
                const scroller = el.closest('.cm-scroller') as HTMLElement | null;
                const before = scroller
                        ? { top: scroller.scrollTop, height: scroller.scrollHeight }
                        : null;

                const from: EditorPosition = { line: info.lineStart + 1, ch: 0 };
                const to: EditorPosition = { line: info.lineEnd, ch: 0 };
                // bug4：写回前记录滚动锚点，renderBlock 重渲染稳定后按锚点还原（延迟多点校验）
                noteScrollAnchor(el);
                editor.replaceRange(newSource + '\n', from, to);

                if (scroller && before) {
                        const check = () => {
                                if (!scroller.isConnected) return;
                                // 大幅滚动跳变 + 总高度基本未变（合并等操作）→ 视为误钳，拉回原位
                                if (Math.abs(scroller.scrollTop - before.top) > 120
                                        && Math.abs(scroller.scrollHeight - before.height) < 120) {
                                        scroller.scrollTop = before.top;
                                }
                        };
                        window.requestAnimationFrame(() => window.requestAnimationFrame(check));
                        window.setTimeout(check, 300);
                }
        }

        /** 任务7：live preview 下 getSectionInfo 为 null 时，用 CM6 从渲染容器反查代码块行号范围 */
        private locateBlockByDom(el: HTMLElement, view: MarkdownView): { lineStart: number; lineEnd: number } | null {
                // Obsidian 的 Editor 持有 CM6 EditorView（非公开 API，社区插件通行用法），最小化声明取用
                const cm = (view.editor as unknown as { cm: EditorView }).cm;
                if (!cm || typeof cm.posAtDOM !== 'function') return null;
                try {
                        const doc = cm.state.doc;
                        const pos = cm.posAtDOM(el, 0);
                        const cur = doc.lineAt(pos).number;
                        const isFence = (n: number) => doc.line(n).text.startsWith('```');
                        // 向上找开始围栏（```lang），向下找结束围栏（```）
                        let start = -1;
                        for (let n = cur; n >= Math.max(1, cur - 200); n--) {
                                if (isFence(n)) { start = n; break; }
                        }
                        if (start < 0) return null;
                        let end = -1;
                        for (let n = cur + 1; n <= Math.min(doc.lines, cur + 5000); n++) {
                                if (isFence(n)) { end = n; break; }
                        }
                        if (end < 0) return null;
                        // 0-based，语义与 getSectionInfo 对齐：lineStart=开始围栏行，lineEnd=结束围栏行
                        return { lineStart: start - 1, lineEnd: end - 1 };
                } catch {
                        return null;
                }
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
                editor.replaceRange(gridToMdTable(grid, { htmlTags: this.settings.mdHtmlTags }), from, to);
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

        constructor(app: App, plugin: VtPlugin) {
                super(app, plugin);
                this.plugin = plugin;
        }

        display(): void {
                const { containerEl } = this;
                containerEl.empty();
                new Setting(containerEl).setName(t('vtable 设置', 'vtable Settings')).setHeading();

                // ===== 界面语言（默认中文）：设置面板/浮窗按钮/右键菜单文本整体切换 =====
                new Setting(containerEl)
                        .setName(t('界面语言', 'UI language'))
                        .setDesc(t('设置面板、浮窗按钮与右键菜单文本的语言。', 'Language of the settings panel, toolbar buttons and context menus.'))
                        .addDropdown(d => d
                                .addOptions({ zh: '中文', en: 'English' })
                                .setValue(this.plugin.settings.uiLang)
                                .onChange(async (value) => {
                                        this.plugin.settings.uiLang = value as UiLang;
                                        setUiLang(value as UiLang);
                                        await this.plugin.saveSettings();
                                        this.plugin.toolbar.rebuild();
                                        this.display();
                                }));

                // 英文模式：浮窗按钮为 ≤2 字符缩写，给出对照说明行
                if (this.plugin.settings.uiLang === 'en') {
                        const legend = containerEl.createDiv({ cls: 'vt-setting-hint' });
                        legend.textContent = `${t('浮窗按钮说明：', 'Floating toolbar legend:')}\n${barLegend()}`;
                }

                new Setting(containerEl)
                        .setName(t('电脑端浮窗工具栏', 'Desktop floating toolbar'))
                        .setDesc(t('在电脑端编辑单元格时显示悬浮格式化工具栏', 'Show the floating formatting toolbar while editing cells on desktop'))
                        .addToggle(t => t
                                .setValue(this.plugin.settings.enableDesktopToolbar)
                                .onChange(async (value) => {
                                        this.plugin.settings.enableDesktopToolbar = value;
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName(t('移动端浮窗工具栏', 'Mobile / tablet floating toolbar'))
                        .setDesc(t('在手机/平板设备上编辑单元格时显示悬浮格式化工具栏', 'Show the floating toolbar while editing cells on phones and tablets'))
                        .addToggle(t => t
                                .setValue(this.plugin.settings.enableMobileToolbar)
                                .onChange(async (value) => {
                                        this.plugin.settings.enableMobileToolbar = value;
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName(t('模式切换按钮', 'Mode switcher'))
                        .setDesc(t('编辑表格时显示 OL / HS / RC 三种模式的切换按钮', 'Show the OL / HS / RC mode switcher while editing'))
                        .addToggle(t => t
                                .setValue(this.plugin.settings.enableModeSwitcher)
                                .onChange(async (value) => {
                                        this.plugin.settings.enableModeSwitcher = value;
                                        await this.plugin.saveSettings();
                                }));

                // ===== 表格样式板块（可折叠：圆角/表头底色/线风格/隔行变色）。默认展开，可点击收起 =====
                const styleSection = containerEl.createEl('details', { cls: 'vt-style-section' });
                styleSection.setAttribute('open', '');
                styleSection.createEl('summary', { text: t('表格样式', 'Table style') });

                // 任务5：表格外框圆角（拖条，即时生效）。特殊规则：设置启用后所有表统一生效，不能对单表取消
                new Setting(styleSection)
                        .setName(t('表格外框圆角', 'Table corner radius'))
                        .setDesc(t('拖动调整表格四个外角的圆角大小，0 为直角。修改后对所有已打开的表格即时生效（全局设置，不能对单个表格取消）。', 'Rounded corners of the table outline, 0 = square. Applies to all open tables immediately (global only, cannot be disabled per table).'))
                        .addSlider(s => s
                                .setLimits(0, 20, 1)
                                .setValue(this.plugin.settings.tableRadius)
                                .setDynamicTooltip()
                                .onChange(async (value) => {
                                        this.plugin.settings.tableRadius = value;
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                }));

                // 任务7：表头底色
                new Setting(styleSection)
                        .setName(t('表头底色', 'Header background'))
                        .setDesc(t('主题色会自动适配文字颜色（底色深则白字，浅则黑字）；第一行参与上下合并时底色自动停用。', 'Theme color adapts text color automatically; disabled while the first row participates in vertical merges.'))
                        .addDropdown(d => d
                                .addOptions({
                                        'none': t('无表头底色（默认）', 'None (default)'),
                                        'theme': t('主题色', 'Theme color'),
                                        'custom': t('自定义颜色', 'Custom color'),
                                })
                                .setValue(this.plugin.settings.headerStyle)
                                .onChange(async (value) => {
                                        this.plugin.settings.headerStyle = value as VtSettings['headerStyle'];
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                        this.display(); // 刷新面板以显示/隐藏自定义颜色输入
                                }));

                if (this.plugin.settings.headerStyle === 'custom') {
                        const colorSetting = new Setting(styleSection)
                                .setName(t('自定义表头颜色', 'Custom header color'))
                                .setDesc(t('填写十六进制颜色编码，如 #4a90d9', 'Hex color, e.g. #4a90d9'));
                        const preview = document.createElement('span');
                        preview.className = 'vt-color-preview';
                        preview.style.background = this.plugin.settings.headerColor;
                        colorSetting.nameEl.appendChild(preview);
                        colorSetting.addText(t => t
                                .setValue(this.plugin.settings.headerColor)
                                .setPlaceholder(t('颜色值（颜色名或十六进制）', 'Color name or hex value'))
                                .onChange(async (value) => {
                                        this.plugin.settings.headerColor = value.trim();
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                        if (CSS.supports('background-color', value.trim())) {
                                                preview.style.background = value.trim();
                                        }
                                }));
                }

                // 表格线风格（三线表/无格线/全横线）：全局启用后对所有表生效（离开编辑态时应用），
                // 单表可用「表格样式调用」命令覆盖或用「添加/删除表格样式」命令取消
                new Setting(styleSection)
                        .setName(t('表格线风格', 'Table line style'))
                        .setDesc(t('三线表=顶线/表头下线/底线；无格线=没有任何格线；全横线=只保留横线。仅显示态应用，编辑单元格时保持原状。', 'Three-line / no grid / horizontal-only. Applied when not editing cells.'))
                        .addDropdown(d => d
                                .addOptions({
                                        'none': t('无（默认）', 'None (default)'),
                                        'three': t('三线表', 'Three-line table'),
                                        'noline': t('无格线', 'No grid lines'),
                                        'hline': t('全横线', 'Horizontal lines only'),
                                })
                                .setValue(this.plugin.settings.tblStyle)
                                .onChange(async (value) => {
                                        this.plugin.settings.tblStyle = value as VtSettings['tblStyle'];
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                }))
                        .addToggle(tg => tg
                                .setTooltip(t('启用表格线风格', 'Enable table line style'))
                                .setValue(this.plugin.settings.tblStyleEnabled)
                                .onChange(async (value) => {
                                        this.plugin.settings.tblStyleEnabled = value;
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                }));

                // 隔行变色：全局启用后对所有表生效（离开编辑态时应用）；单表可用「隔行变色样式」命令开关
                new Setting(styleSection)
                        .setName(t('隔行变色', 'Zebra stripes'))
                        .setDesc(t('每隔一行自动填色（可被单格底色覆盖）。启用表头底色时从第 3 行开始。命令「隔行变色样式」使用这里最后一次设置的颜色。', 'Fills every other row (single-cell colors still win). Starts at row 3 when the header background is on. The "Zebra stripe style" command uses the last color configured here.'))
                        .addDropdown(d => d
                                .addOptions({
                                        'none': t('无（命令时用主题色）', 'None (command falls back to theme)'),
                                        'theme': t('主题色', 'Theme color'),
                                        'custom': t('自定义颜色', 'Custom color'),
                                })
                                .setValue(this.plugin.settings.zebraStyle)
                                .onChange(async (value) => {
                                        this.plugin.settings.zebraStyle = value as VtSettings['zebraStyle'];
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                        this.display();
                                }))
                        .addToggle(tg => tg
                                .setTooltip(t('启用隔行变色', 'Enable zebra stripes'))
                                .setValue(this.plugin.settings.zebraEnabled)
                                .onChange(async (value) => {
                                        this.plugin.settings.zebraEnabled = value;
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                }));

                if (this.plugin.settings.zebraStyle === 'custom') {
                        const zcSetting = new Setting(styleSection)
                                .setName(t('隔行变色自定义颜色', 'Custom zebra color'))
                                .setDesc(t('填写十六进制颜色编码，如 #e8f0fe。颜色过深时文字自动反白。', 'Hex color, e.g. #e8f0fe. Dark colors get white text automatically.'));
                        const zcPreview = document.createElement('span');
                        zcPreview.className = 'vt-color-preview';
                        zcPreview.style.background = this.plugin.settings.zebraColor;
                        zcSetting.nameEl.appendChild(zcPreview);
                        zcSetting.addText(t => t
                                .setValue(this.plugin.settings.zebraColor)
                                .setPlaceholder(t('颜色值（颜色名或十六进制）', 'Color name or hex value'))
                                .onChange(async (value) => {
                                        this.plugin.settings.zebraColor = value.trim();
                                        await this.plugin.saveSettings();
                                        refreshAllTableAppearance();
                                        if (CSS.supports('background-color', value.trim())) {
                                                zcPreview.style.background = value.trim();
                                        }
                                }));
                }

                // 导出 Markdown 时嵌套 HTML 标签保留对齐/底色（属样式类，纳入「表格样式」折叠）
                new Setting(styleSection)
                        .setName(t('导出 Markdown 保留对齐与底色', 'Keep alignment & colors in Markdown export'))
                        .setDesc(t('转为 Markdown 表格时，用嵌套 HTML 标签（<center>、<span style="background-color:..."> 等）保留单元格的对齐与底色。', 'When converting to Markdown, wrap cells in nested HTML tags (<center>, <span style="background-color:...">, etc.) to preserve alignment and colors.'))
                        .addToggle(t => t
                                .setValue(this.plugin.settings.mdHtmlTags)
                                .onChange(async (value) => {
                                        this.plugin.settings.mdHtmlTags = value;
                                        await this.plugin.saveSettings();
                                }));

                // ===== 右键菜单自定义（③）：属样式类，纳入「表格样式」折叠 =====
                this.displayContextMenuSection(styleSection);
        }

        /** 右键菜单自定义板块：文本框（一行一项，"---"=分隔线）+ 保存按钮 + 对照表 */
        private displayContextMenuSection(containerEl: HTMLElement) {
                new Setting(containerEl).setName(t('右键菜单自定义', 'Context menu customization')).setHeading();

                // 文本框：编辑不即时保存，点保存才生效。
                // 布局：说明行只占一行，textarea 独占全宽（放 Setting control 里会被左侧说明挤成半栏）
                const taRef: { el: HTMLTextAreaElement | null } = { el: null };
                const taSetting = new Setting(containerEl)
                        .setName(t('菜单结构（文本方式）', 'Menu layout (text)'))
                        .setDesc(t(
                                '一行代表菜单里的一行；"---" 代表分隔线；"cmd:命令id" 代表任意 Obsidian 命令；"动作id|图标名" 可自定义图标（图标部分可省略）。修改后请点击下方保存按钮。',
                                'One menu row per line; "---" = separator; "cmd:commandId" = any Obsidian command; "actionId|iconName" overrides the icon. Press Save below to apply.',
                        ))
                        .then((s) => {
                                s.settingEl.classList.add('vt-menu-ta-setting');
                        });
                const ta = taSetting.settingEl.createEl('textarea');
                ta.className = 'text-input vt-menu-ta';
                ta.value = this.plugin.settings.contextMenu;
                taSetting.settingEl.insertAdjacentElement('afterend', ta);
                taRef.el = ta;
                new Setting(containerEl)
                        .setName(t('保存菜单配置', 'Save menu layout'))
                        .setDesc(t('点击保存后立即对所有表格生效；未保存的修改在关闭设置后丢弃。', 'Applies to all tables immediately; unsaved edits are discarded when settings close.'))
                        .addButton(b => b
                                .setButtonText(t('保存', 'Save'))
                                .setCta()
                                .onClick(async () => {
                                        if (!taRef.el) return;
                                        this.plugin.settings.contextMenu = taRef.el.value;
                                        await this.plugin.saveSettings();
                                        new Notice(t('右键菜单配置已保存', 'Context menu saved'));
                                }));

                // 对照表（方式二）：搜索命令 → 点选 → 显示生成行 → 一键复制 → 粘贴到上面文本框
                const wrap = containerEl.createDiv({ cls: 'vt-menu-lookup' });
                wrap.createDiv({
                        cls: 'vt-menu-lookup-title',
                        text: t('对照表（辅助输入）：输入关键词筛选命令，点选后在下方复制生成的行，粘贴到上面的文本框', 'Lookup helper: filter commands, click one, copy the generated line and paste it above'),
                });
                const search = wrap.createEl('input', { type: 'text' });
                search.placeholder = t('输入关键词筛选（vtable 动作 + Obsidian 命令）…', 'Filter (vtable actions + Obsidian commands)…');
                search.style.width = `100%`;
                const listBox = wrap.createDiv({ cls: 'vt-menu-lookup-list' });
                const genIcon = wrap.createEl('input', { type: 'text' });
                genIcon.placeholder = t('图标名（可选，lucide 名称，如 bold）', 'Icon (optional lucide name, e.g. bold)');
                genIcon.style.width = `100%`;
                const genLine = wrap.createDiv({ cls: 'vt-menu-lookup-line', text: t('（尚未选择命令）', '(no command selected)') });
                let selectedLine = '';
                const copyBtn = wrap.createEl('button', { text: t('复制生成的行', 'Copy generated line') });
                copyBtn.addEventListener('click', () => {
                        if (!selectedLine) return;
                        const icon = genIcon.value.trim();
                        const line = icon ? `${selectedLine}|${icon}` : selectedLine;
                        void navigator.clipboard?.writeText(line);
                        new Notice(t('已复制，请粘贴到上方文本框', 'Copied — paste it into the box above'));
                });

                // 数据源：vtable 内置动作 + Obsidian 全部命令
                const sources: Array<{ line: string; name: string }> = [];
                for (const [id, act] of Object.entries(VT_MENU_ACTIONS)) {
                        sources.push({ line: id, name: `${act.zh} / ${act.en}` });
                }
                const cmds = (this.app.commands as unknown as { commands: Record<string, { name: string }> }).commands;
                for (const [id, c] of Object.entries(cmds ?? {})) {
                        sources.push({ line: `cmd:${id}`, name: `${c.name} (Obsidian)` });
                }

                const renderList = () => {
                        const q = search.value.trim().toLowerCase();
                        listBox.empty();
                        const hits = sources.filter(s => !q || s.name.toLowerCase().includes(q) || s.line.toLowerCase().includes(q)).slice(0, 15);
                        for (const s of hits) {
                                const item = listBox.createDiv({ cls: 'vt-menu-lookup-item' });
                                item.createSpan({ cls: 'vt-menu-lookup-name', text: s.name });
                                item.createEl('code', { cls: 'vt-menu-lookup-code', text: s.line });
                                item.addEventListener('click', () => {
                                        selectedLine = s.line;
                                        genLine.setText(t('生成的行：', 'Generated line: ') + (genIcon.value.trim() ? `${s.line}|${genIcon.value.trim()}` : s.line));
                                });
                        }
                        if (!hits.length) listBox.createDiv({ text: t('无匹配命令', 'No matching commands') });
                };
                genIcon.addEventListener('input', () => {
                        if (selectedLine) genLine.setText(t('生成的行：', 'Generated line: ') + `${selectedLine}|${genIcon.value.trim()}`);
                });
                search.addEventListener('input', renderList);
                renderList();

                // 灰色小字使用方法 + README 链接
                const help = containerEl.createDiv({ cls: 'vt-setting-hint' });
                help.createSpan({
                        text: t(
                                '用法：菜单结构里一行一项，"---" 是分割线；对照表点选命令后复制生成的行粘贴进来即可；图标可留空使用默认。详细文档见 ',
                                'Usage: one item per line, "---" inserts a separator; pick a command in the lookup, copy the generated line and paste it above; leave the icon blank for the default. Full docs: ',
                        ),
                });
                help.createEl('a', { text: 'README', href: `${REPO_URL}#right-click-menu` }).setAttribute('target', '_blank');
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
                if (lines[i].trim() === '```vtable') {
                        const start = i;
                        let end = i + 1;
                        while (end < n && lines[end].trim() !== '```') end++;
                        if (end < n) {
                                blocks.push({
                                        blockFrom: { line: start, ch: 0 },
                                        blockTo: { line: end, ch: lines[end].length },
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

/** 任务2：选区底色取色弹窗——预设色板 + 十六进制输入 + 确定/取消 */
class VtColorModal extends Modal {
        private readonly onOk: (color: string | null) => void;
        private selected: string | null = null; // null = 无填充
        private inputEl!: HTMLInputElement;

        constructor(app: App, initial: string, onOk: (color: string | null) => void) {
                super(app);
                this.onOk = onOk;
                this.selected = initial || null;
        }

        onOpen() {
                const { contentEl, modalEl } = this;
                modalEl.addClass('vt-color-modal');
                contentEl.createEl('h3', { text: '设置选中单元格底色' });

                // 预设色板（常用色 + 无填充）
                const presets: Array<[string, string]> = [
                        ['#e74c3c', '红'],
                        ['#e67e22', '橙'],
                        ['#f1c40f', '黄'],
                        ['#2ecc71', '绿'],
                        ['#1abc9c', '青'],
                        ['#3498db', '蓝'],
                        ['#9b59b6', '紫'],
                        ['#95a5a6', '灰'],
                        ['#ffffff', '白'],
                        ['#000000', '黑'],
                ];
                const grid = contentEl.createDiv({ cls: 'vt-color-grid' });
                const swatches: HTMLElement[] = [];
                const select = (el: HTMLElement, color: string | null) => {
                        this.selected = color;
                        this.inputEl.value = color ?? '';
                        preview.style.background = color || 'transparent';
                        swatches.forEach(s => s.removeClass('is-selected'));
                        el.addClass('is-selected');
                };
                for (const [hex] of presets) {
                        const sw = grid.createEl('button', { cls: 'vt-color-swatch' });
                        sw.style.background = hex;
                        sw.title = hex;
                        sw.addEventListener('click', () => select(sw, hex));
                        swatches.push(sw);
                        if (this.selected?.toLowerCase() === hex) sw.addClass('is-selected');
                }
                const clear = grid.createEl('button', { cls: 'vt-color-swatch vt-color-clear' });
                clear.title = '无填充';
                setIcon(clear, 'paintbrush');
                clear.addEventListener('click', () => select(clear, null));
                swatches.push(clear);
                if (!this.selected) clear.addClass('is-selected');

                // 颜色编码输入 + 预览
                const row = contentEl.createDiv({ cls: 'vt-color-input-row' });
                const preview = row.createSpan({ cls: 'vt-color-preview' });
                preview.style.background = this.selected || 'transparent';
                this.inputEl = row.createEl('input', { type: 'text', value: this.selected ?? '' });
                this.inputEl.placeholder = t('颜色值（颜色名或十六进制）', 'Color name or hex value');
                
                this.inputEl.addEventListener('input', () => {
                        const v = this.inputEl.value.trim();
                        if (v && CSS.supports('background-color', v)) {
                                this.selected = v;
                                preview.style.background = v;
                                swatches.forEach(s => s.removeClass('is-selected'));
                        }
                });
                this.inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); this.confirm(); }
                });

                // 确定 / 取消
                const actions = contentEl.createDiv({ cls: 'vt-color-actions' });
                actions.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
                actions.createEl('button', { text: '确定', cls: 'mod-cta' }).addEventListener('click', () => this.confirm());

                window.setTimeout(() => this.inputEl.focus(), 50);
        }

        private confirm() {
                const v = this.inputEl.value.trim();
                if (v && !CSS.supports('background-color', v)) {
                        new Notice(t('无效的颜色编码', 'Invalid color code'));
                        return;
                }
                this.close();
                this.onOk(v || null); // 空输入 = 无填充
        }
}
