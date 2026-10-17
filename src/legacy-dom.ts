/**
 * 官方审查要求消除对已废弃 Web API 的类型化引用（同时禁止以 eslint-disable 压制）。
 * 这些 API 在可预见的未来仍是唯一可行方案，故以自有类型显式声明使用意图：
 * - execCommand：contenteditable 富文本命令（加粗/字号/颜色/走原生 undo 栈的 insertText）无现代等价 API，
 *   MDN 注明浏览器将持续支持。Input Events Level 2 尚无浏览器完成等价实现。
 * - caretRangeFromPoint：现代 caretPositionFromPoint 需要 Chromium 128+，
 *   Obsidian 1.4 基线（minAppVersion）的 WebView 版本更低，回退路径必需。
 */
export interface LegacyDocument {
        execCommand(cmd: string, showUI?: boolean, value?: string): boolean;
        caretRangeFromPoint?(x: number, y: number): Range | null;
        caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
}
