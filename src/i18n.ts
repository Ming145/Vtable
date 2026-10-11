/**
 * i18n.ts — 设置界面与浮窗/菜单文本的中英文切换。
 * 默认中文；英文模式下浮窗按钮文本用 ≤2 字符缩写（含义在设置面板有对照说明行）。
 * 用法：t('中文', 'English')，各调用点直接成对给出，不走 key 表。
 */
export type UiLang = 'zh' | 'en';

let lang: UiLang = 'zh';

export function getUiLang(): UiLang {
        return lang;
}

export function setUiLang(l: UiLang): void {
        lang = l;
}

/** 取当前语言的文本：zh/en 成对传入 */
export function t(zh: string, en: string): string {
        return lang === 'zh' ? zh : en;
}

/** 插件仓库地址（设置面板说明链接用） */
export const REPO_URL = 'https://github.com/Ming145/Vtable';

/** 浮窗按钮缩写 ↔ 含义对照（英文模式下显示在设置面板，帮助用户识别按钮缩写） */
export function barLegend(): string {
        if (lang === 'zh') {
                return [
                        'B = 加粗，I = 斜体，A- / A+ = 缩小 / 放大字号，SP = 拆分单元格',
                        'M↓ = 向下合并，M→ = 向右合并，+R / +C = 加行 / 加列，-R / -C = 删行 / 删列',
                        'MD = 转 Markdown 表格，H5 = 转 HTML 表格',
                ].join('\n');
        }
        return [
                'B = Bold, I = Italic, A- / A+ = Smaller / Larger font, SP = Split cell',
                'M↓ = Merge down, M→ = Merge right, +R / +C = Add row / column, -R / -C = Delete row / column',
                'MD = Convert to Markdown table, H5 = Convert to HTML table',
        ].join('\n');
}
