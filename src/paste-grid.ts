/**
 * paste-grid.ts — markdown 表格 ⇄ 网格 的纯文本协议
 *
 * 复制端（render.ts buildSelMarkdown）把选区渲染为标准 markdown 表格：
 *   | a | b |
 *   | --- | --- |
 *   | c | d |
 * 粘贴端 parseMarkdownTable 把剪贴板文本还原为 string[][] 网格。
 *
 * 协议约定：
 *   - 单元格内换行以 <br> 字面表示（与格源码 t 的换行存法一致，直通往返）
 *   - 单元格内的 | 转义为 \|，\| 字面再转义为 \\|（拆列占位法往返无损）
 *   - 第二行必须是分隔行（| --- | :---: |），列数以分隔行为准，缺列补空、多列截断
 *   - 非表格文本返回 null，由调用方回落到原有单格文本粘贴
 */

const CELL_NUL = '\u0000';
const CELL_BS = '\u0001';

/** 行 → 单元格数组：\\ 与 \| 双占位防破列，去首尾空段（管道开合产生），还原转义并 trim */
function splitRow(line: string): string[] {
        const safe = line.replace(/\\\\/g, CELL_BS).replace(/\\\|/g, CELL_NUL);
        let parts = safe.split('|');
        if (parts.length > 1 && parts[0]!.trim() === '') parts = parts.slice(1);
        if (parts.length > 1 && parts[parts.length - 1]!.trim() === '') parts = parts.slice(0, -1);
        return parts.map(p => p.replace(new RegExp(CELL_BS, 'g'), '\\').replace(new RegExp(CELL_NUL, 'g'), '|').trim());
}

/** 分隔行判定：| --- | :---: | —— 每格 2+ 连字符、可带对齐冒号 */
function isSepRow(cells: string[]): boolean {
        return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c));
}

/** 剪贴板文本 → 网格（首行=数据行，第二行=分隔行被吞掉，其余为数据行）；非表格返回 null */
export function parseMarkdownTable(text: string): string[][] | null {
        const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) return null;
        const head = splitRow(lines[0]!);
        const sep = splitRow(lines[1]!);
        if (head.length < 1 || !isSepRow(sep)) return null;
        const nCols = sep.length;
        if (nCols < 1) return null;
        const pad = (cells: string[]): string[] => {
                const out = cells.slice(0, nCols);
                while (out.length < nCols) out.push('');
                return out;
        };
        const rows: string[][] = [pad(head)];
        for (let i = 2; i < lines.length; i++) {
                const cells = splitRow(lines[i]!);
                if (!cells.length) continue;
                rows.push(pad(cells));
        }
        return rows;
}

/** 网格 → markdown 表格文本（复制端）：首行作表头，中间插分隔行 */
export function buildMarkdownTable(rows: string[][]): string {
        if (!rows.length || !rows[0]!.length) return '';
        const esc = (s: string) => s.replace(/<br\s*\/?>/gi, '<br>').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
        const line = (cells: string[]) => '| ' + cells.map(esc).join(' | ') + ' |';
        const nCols = rows[0]!.length;
        const out: string[] = [line(rows[0]!), '| ' + Array(nCols).fill('---').join(' | ') + ' |'];
        for (let i = 1; i < rows.length; i++) out.push(line(rows[i]!));
        return out.join('\n');
}
