/**
 * Deprecated API 合规调用层（官方审核 no-deprecated 合规解：自有接口重声明）。
 * 这些 API 被 MDN/TS 标记 deprecated，但在 Obsidian 运行时仍是唯一可用通路
 * （或部分安卓输入法不派发标准事件），语义上必需——不能删除，只能经重声明调用。
 */

/** document.execCommand：剪贴板写入的旧路径兜底（navigator.clipboard 在部分
 *  真机/Electron 环境不可用，降级链的最后一环）。浏览器全线支持，无替代 API。 */
export function compatExecCommand(doc: Document, cmd: string, value?: string): boolean {
        return (doc as { execCommand(commandId: string, ui?: boolean, value?: string): boolean }).execCommand(cmd, false, value);
}

/** document.caretRangeFromPoint：坐标→光标 Range 的命中点（caretPositionFromPoint
 *  尚未全平台铺开，Chromium 系仍以此为主通路）。 */
export function compatCaretRangeFromPoint(doc: Document, x: number, y: number): Range | null {
        return (doc as { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y) ?? null;
}

/** KeyboardEvent.keyCode：部分安卓输入法不派发标准 e.key（仅 keyCode 到达），
 *  键位判定需keyCode 兜底。 */
export function compatKeyCode(e: KeyboardEvent): number {
        return (e as { keyCode: number }).keyCode;
}
