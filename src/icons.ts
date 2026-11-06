/**
 * icons.ts — 右键菜单自定义：图标选择器清单（Lucide 图标名）
 * 全部为长期稳定、未被改名的高置信 Lucide 名称（含插件自身在用的全部图标），
 * 供设置面板点选填入"动作id|图标名"的图标位，省去手敲。
 */

export const LUCIDE_ICONS: readonly string[] = [
        // 文字格式
        'bold', 'italic', 'underline', 'strikethrough', 'highlighter',
        'superscript', 'subscript', 'case-upper', 'case-lower',
        'code', 'remove-formatting', 'type', 'heading', 'pilcrow', 'wrap-text',
        // 颜色
        'paintbrush', 'palette', 'eraser',
        // 编辑
        'copy', 'clipboard', 'clipboard-paste', 'clipboard-copy', 'scissors',
        'trash', 'trash-2', 'undo-2', 'redo-2', 'search', 'replace',
        // 表格与列表
        'table', 'table-2', 'list', 'list-ordered', 'list-todo',
        'merge', 'split', 'combine', 'split-square-horizontal', 'split-square-vertical',
        'move-horizontal', 'move-vertical', 'move-up', 'move-down',
        // 对齐
        'align-left', 'align-center', 'align-right', 'align-justify',
        'align-vertical-justify-start', 'align-vertical-justify-center', 'align-vertical-justify-end',
        // 方向
        'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
        'arrow-up-to-line', 'arrow-down-to-line', 'arrow-left-to-line', 'arrow-right-to-line',
        'corner-down-left', 'corner-down-right',
        'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
        'chevrons-up', 'chevrons-down', 'chevrons-left', 'chevrons-right',
        'rotate-cw', 'rotate-ccw',
        // 内容对象
        'link', 'unlink', 'image', 'paperclip', 'hash', 'quote',
        'star', 'heart', 'bookmark', 'tag', 'clock', 'calendar', 'mail', 'external-link',
        // 状态与杂项
        'check', 'x', 'plus', 'minus', 'circle', 'square', 'info', 'zap', 'sun', 'moon',
        'file-text', 'folder', 'terminal', 'settings', 'eye', 'pin',
];
