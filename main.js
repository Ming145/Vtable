var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VtPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/builder.ts
var RC_HANDLE_RE = /<div\s+class="vt-rc-handle[^"]*"[^>]*>\s*<\/div>/gi;
function stripRcHandles(html) {
  return RC_HANDLE_RE.test(html) ? html.replace(RC_HANDLE_RE, "") : html;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdInlineToHtml(s) {
  const protectedSpans = [];
  const protect = (html) => {
    const idx = protectedSpans.length;
    protectedSpans.push(html);
    return `\0${idx}`;
  };
  const escapeAttr = (v) => escapeHtml(v).replace(/"/g, "&quot;");
  s = s.replace(/`([^`]+)`/g, (_, content) => protect("<code>" + escapeHtml(content) + "</code>"));
  s = s.replace(/<br\s*\/?>/gi, (m) => protect(m));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const href = /^javascript:/i.test(url) ? "#" : escapeAttr(url);
    return protect(`<a href="${href}">${escapeHtml(text)}</a>`);
  });
  s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_, content) => protect(`<b><i>${escapeHtml(content)}</i></b>`));
  s = s.replace(/(?<!\w)___(?!_)([\s\S]+?)(?<!_)___(?!\w)/g, (_, content) => protect(`<b><i>${escapeHtml(content)}</i></b>`));
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, (_, content) => protect(`<b>${escapeHtml(content)}</b>`));
  s = s.replace(/(?<!\w)__(?!_)([\s\S]+?)(?<!_)__(?!\w)/g, (_, content) => protect(`<b>${escapeHtml(content)}</b>`));
  s = s.replace(/\*([\s\S]+?)\*/g, (_, content) => protect(`<i>${escapeHtml(content)}</i>`));
  s = s.replace(/(?<!\w)_([\s\S]+?)(?<!_)_(?!\w)/g, (_, content) => protect(`<i>${escapeHtml(content)}</i>`));
  s = s.replace(/==([\s\S]+?)==/g, (_, content) => protect(`<mark>${escapeHtml(content)}</mark>`));
  s = s.replace(/~~([\s\S]+?)~~/g, (_, content) => protect(`<s>${escapeHtml(content)}</s>`));
  s = escapeHtml(s);
  return s.replace(/\x00(\d+)\x01/g, (_, idx) => protectedSpans[parseInt(idx)]);
}
function visible(cell2) {
  return cell2.rs > 0 && cell2.cs > 0;
}
function cell(t2 = "") {
  return { t: t2, rs: 1, cs: 1 };
}
function hidden() {
  return { t: "", rs: 0, cs: 0 };
}
function joinText(a, b, sep) {
  if (a === "")
    return b;
  if (b === "")
    return a;
  return a + sep + b;
}
function blankGrid(cols, rows) {
  const g = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++)
      row.push(cell());
    g.push(row);
  }
  return g;
}
function normalizeCellNewlines(t2) {
  if (!t2.includes("\n"))
    return t2;
  const m = /\n+$/.exec(t2);
  const tail = m ? m[0] : "";
  const body = t2.slice(0, t2.length - tail.length);
  const afterBr = body.endsWith("<br>");
  const tailBr = afterBr ? tail.length : Math.max(0, tail.length - 1);
  return body.replace(/\n/g, "<br>") + (tailBr ? "<br>".repeat(tailBr) : "");
}
function healOrphanHidden(rows) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const cd = rows[r][c];
      if (!cd || visible(cd))
        continue;
      let covered = false;
      for (let rr = 0; rr < rows.length && !covered; rr++) {
        for (let cc = 0; cc < (rows[rr]?.length ?? 0) && !covered; cc++) {
          if (rr === r && cc === c)
            continue;
          const up = rows[rr][cc];
          if (!up || !visible(up))
            continue;
          if (rr <= r && r < rr + up.rs && cc <= c && c < cc + up.cs)
            covered = true;
        }
      }
      if (!covered) {
        cd.rs = 1;
        cd.cs = 1;
      }
    }
  }
}
function healCoveredVisible(rows) {
  let hasSpan = false;
  for (const row of rows)
    for (const cd of row) {
      if (visible(cd) && (cd.rs > 1 || cd.cs > 1)) {
        hasSpan = true;
        break;
      }
    }
  if (!hasSpan) {
    for (const row of rows)
      for (const cd of row) {
        if (cd && !visible(cd)) {
          cd.rs = 1;
          cd.cs = 1;
        }
      }
    return;
  }
  healCoveredVisibleSlow(rows);
  healOrphanHidden(rows);
}
function healCoveredVisibleSlow(rows) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const cd = rows[r][c];
      if (!cd || !visible(cd))
        continue;
      for (let rr = 0; rr < rows.length; rr++) {
        let hit = false;
        for (let cc = 0; cc < (rows[rr]?.length ?? 0); cc++) {
          if (rr === r && cc === c)
            continue;
          const up = rows[rr][cc];
          if (!up || !visible(up) || up.rs === 1 && up.cs === 1)
            continue;
          if (rr <= r && r < rr + up.rs && cc <= c && c < cc + up.cs) {
            if (cd.t)
              up.t = joinText(up.t, cd.t, "<br>");
            cd.t = "";
            cd.rs = 0;
            cd.cs = 0;
            hit = true;
            break;
          }
        }
        if (hit)
          break;
      }
    }
  }
}
function serialize(data) {
  healCoveredVisible(data.rows);
  for (const row of data.rows)
    for (const cd of row) {
      if (cd.t)
        cd.t = normalizeCellNewlines(cd.t);
    }
  const obj = { rows: data.rows };
  if (data.mode !== "OL")
    obj.mode = data.mode;
  if (data.colWidths?.length)
    obj.colWidths = data.colWidths;
  if (data.rowHeights?.length)
    obj.rowHeights = data.rowHeights;
  if (data.noHeaderBg)
    obj.noHeaderBg = true;
  if (data.style)
    obj.style = data.style;
  if (data.zebra !== void 0)
    obj.zebra = data.zebra;
  return JSON.stringify(obj);
}
function blankSource(cols, rows) {
  return serialize({ mode: "OL", rows: blankGrid(cols, rows) });
}
function parseSource(src) {
  const trimmed = src.trim();
  if (trimmed === "")
    return { mode: "OL", rows: blankGrid(1, 1) };
  try {
    const obj = JSON.parse(trimmed);
    if (obj && Array.isArray(obj.rows)) {
      const mode = parseMode(obj.mode);
      const rows = normalize(obj.rows);
      const data = { mode, rows };
      if (Array.isArray(obj.colWidths)) {
        data.colWidths = obj.colWidths.filter((n) => typeof n === "number");
      }
      if (Array.isArray(obj.rowHeights)) {
        data.rowHeights = obj.rowHeights.filter((n) => typeof n === "number");
      }
      if (obj.noHeaderBg === true)
        data.noHeaderBg = true;
      if (obj.style === "three" || obj.style === "noline" || obj.style === "hline" || obj.style === "off") {
        data.style = obj.style;
      }
      if (obj.zebra === true || obj.zebra === false)
        data.zebra = obj.zebra;
      return data;
    }
  } catch {
  }
  return { mode: "OL", rows: pipeToGrid(trimmed) };
}
function parseMode(v) {
  if (v === "HS" || v === "RC")
    return v;
  return "OL";
}
function normalize(rows) {
  const g = [];
  for (const rawRow of rows) {
    if (!Array.isArray(rawRow))
      continue;
    const row = rawRow.map((x) => {
      const o = x;
      const cd = {
        t: typeof o.t === "string" ? stripRcHandles(o.t) : "",
        rs: typeof o.rs === "number" ? o.rs : 1,
        cs: typeof o.cs === "number" ? o.cs : 1
      };
      if (o.a === "l" || o.a === "c" || o.a === "r")
        cd.a = o.a;
      if (typeof o.bg === "string" && o.bg)
        cd.bg = o.bg;
      if (o.va === "t" || o.va === "m" || o.va === "b")
        cd.va = o.va;
      if (typeof o.dg === "string")
        cd.dg = o.dg;
      return cd;
    });
    g.push(row);
  }
  return g.length ? g : blankGrid(1, 1);
}
function pipeToGrid(src) {
  const lines = src.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0)
    return blankGrid(1, 1);
  return lines.map((line) => line.split("|").map((s) => cell(escapeHtml(s.trim()))));
}
function isSeparator(line) {
  return /^\s*\|?[\s\-:|]+\|?\s*$/.test(line) && line.includes("-");
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|"))
    s = s.slice(1);
  if (s.endsWith("|"))
    s = s.slice(0, -1);
  return s.replace(/\\\|/g, "\0VTESC\0").split("|").map((c) => c.trim().replace(/\x00VTESC\x00/g, "|"));
}
function mdTableToSource(md) {
  const lines = md.split("\n").filter((l) => l.trim() !== "");
  const rows = lines.filter((l) => !isSeparator(l)).map(splitRow);
  const grid = rows.map((r) => r.map((t2) => cell(mdInlineToHtml(t2))));
  return serialize({ mode: "OL", rows: grid.length ? grid : blankGrid(1, 1) });
}
function htmlTableToSource(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table)
    return blankSource(1, 1);
  const rowEls = Array.from(table.querySelectorAll("tr"));
  if (rowEls.length === 0)
    return blankSource(1, 1);
  const rows = rowEls.length;
  const grid = Array.from({ length: rows }, () => []);
  rowEls.forEach((rowEl, r) => {
    const cellEls = Array.from(rowEl.querySelectorAll("td, th"));
    let c = 0;
    for (const cellEl of cellEls) {
      while (grid[r][c] !== void 0)
        c++;
      const rs = parseInt(cellEl.getAttribute("rowspan") ?? "1", 10) || 1;
      const cs = parseInt(cellEl.getAttribute("colspan") ?? "1", 10) || 1;
      grid[r][c] = { t: cellEl.innerHTML, rs, cs };
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0)
            continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= rows)
            continue;
          grid[rr][cc] = hidden();
        }
      }
      c += cs;
    }
  });
  let cols = 0;
  for (const row of grid)
    cols = Math.max(cols, row.length);
  if (cols === 0)
    return blankSource(1, 1);
  const full = grid.map((row) => {
    const out = [];
    for (let c = 0; c < cols; c++)
      out.push(row[c] ?? cell());
    return out;
  });
  return serialize({ mode: "OL", rows: full });
}
function gridToHtmlTable(grid) {
  const cols = colCount(grid);
  if (grid.length === 0 || cols === 0)
    return "<table>\n</table>";
  const lines = ["<table>"];
  for (const row of grid) {
    const tds = row.filter(visible).map((c) => {
      let attrs = (c.rs > 1 ? ` rowspan="${c.rs}"` : "") + (c.cs > 1 ? ` colspan="${c.cs}"` : "");
      const styles = [];
      if (c.a)
        styles.push(`text-align: ${c.a === "c" ? "center" : c.a === "r" ? "right" : "left"}`);
      if (c.va)
        styles.push(`vertical-align: ${c.va === "m" ? "middle" : c.va === "b" ? "bottom" : "top"}`);
      if (c.bg)
        styles.push(`background: ${c.bg}`);
      if (styles.length)
        attrs += ` style="${escapeHtml(styles.join("; "))}"`;
      return `<td${attrs}>${c.t}</td>`;
    }).join("");
    lines.push(`<tr>${tds}</tr>`);
  }
  lines.push("</table>");
  return lines.join("\n");
}
function escapeMdCell(t2) {
  return t2.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}
function gridToMdTable(grid, opts) {
  const cols = colCount(grid);
  if (grid.length === 0 || cols === 0)
    return "";
  const useTags = opts?.htmlTags !== false;
  const decorate = (t2, c) => {
    let inner = escapeMdCell(t2);
    if (!useTags)
      return inner;
    if (c.bg)
      inner = `<span style="background-color:${c.bg}">${inner}</span>`;
    if (c.a === "c")
      inner = `<center>${inner}</center>`;
    else if (c.a === "r")
      inner = `<span style="display:block;text-align:right">${inner}</span>`;
    return inner;
  };
  const lineOf = (row) => "| " + row.map((c) => decorate(visible(c) ? c.t : "", c)).join(" | ") + " |";
  const lines = [lineOf(grid[0])];
  lines.push("| " + new Array(cols).fill("---").join(" | ") + " |");
  for (let r = 1; r < grid.length; r++)
    lines.push(lineOf(grid[r]));
  return lines.join("\n");
}
function colCount(grid) {
  return grid[0]?.length ?? 0;
}
function insertRow(grid, r) {
  const cols = colCount(grid);
  const row = [];
  for (let i = 0; i < cols; i++)
    row.push(cell());
  grid.splice(r + 1, 0, row);
}
function deleteRow(grid, r) {
  if (grid.length <= 1)
    return;
  grid.splice(r, 1);
}
function insertCol(grid, c) {
  for (const row of grid)
    row.splice(c + 1, 0, cell());
}
function deleteCol(grid, c) {
  if (colCount(grid) <= 1)
    return;
  for (const row of grid)
    row.splice(c, 1);
}
function mergeRight(grid, r, c) {
  const anchor = grid[r]?.[c];
  if (!anchor || !visible(anchor) || anchor.rs !== 1)
    return;
  const nc = c + anchor.cs;
  const target = grid[r]?.[nc];
  if (!target || !visible(target) || target.rs !== 1)
    return;
  anchor.t = joinText(anchor.t, target.t, " ");
  anchor.cs += target.cs;
  for (let i = 0; i < target.cs; i++) {
    const cc = nc + i;
    if (grid[r][cc])
      grid[r][cc] = hidden();
  }
}
function mergeDown(grid, r, c) {
  const anchor = grid[r]?.[c];
  if (!anchor || !visible(anchor) || anchor.cs !== 1)
    return;
  const nr = r + anchor.rs;
  const target = grid[nr]?.[c];
  if (!target || !visible(target) || target.cs !== 1)
    return;
  anchor.t = joinText(anchor.t, target.t, "<br>");
  anchor.rs += target.rs;
  for (let i = 0; i < target.rs; i++) {
    const rr = nr + i;
    if (grid[rr]?.[c])
      grid[rr][c] = hidden();
  }
}
function splitCell(grid, r, c) {
  const anchor = grid[r]?.[c];
  if (!anchor || !visible(anchor))
    return;
  if (anchor.rs === 1 && anchor.cs === 1)
    return;
  const rs = anchor.rs;
  const cs = anchor.cs;
  const text = anchor.t;
  for (let rr = r; rr < r + rs; rr++) {
    for (let cc = c; cc < c + cs; cc++) {
      if (!grid[rr]?.[cc])
        continue;
      grid[rr][cc] = rr === r && cc === c ? cell(text) : cell();
    }
  }
}
function mergeRange(grid, r1, c1, r2, c2) {
  r1 = Math.max(0, r1);
  c1 = Math.max(0, c1);
  r2 = Math.min(grid.length - 1, r2);
  c2 = Math.min(colCount(grid) - 1, c2);
  if (r2 < r1 || c2 < c1)
    return;
  if (r2 === r1 && c2 === c1)
    return;
  const rowTexts = [];
  for (let r = r1; r <= r2; r++) {
    let line = "";
    for (let c = c1; c <= c2; c++) {
      const cd = grid[r]?.[c];
      if (!cd || !visible(cd))
        continue;
      line = joinText(line, cd.t, " ");
    }
    rowTexts.push(line);
  }
  let text = "";
  for (const t2 of rowTexts)
    text = joinText(text, t2, "<br>");
  const anchor = grid[r1][c1];
  anchor.t = text;
  anchor.rs = r2 - r1 + 1;
  anchor.cs = c2 - c1 + 1;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (r === r1 && c === c1)
        continue;
      if (grid[r]?.[c])
        grid[r][c] = hidden();
    }
  }
}
function deleteRows(grid, rows) {
  const desc = Array.from(new Set(rows)).sort((a, b) => b - a);
  for (const r of desc) {
    if (r >= 0 && r < grid.length)
      deleteRow(grid, r);
  }
}
function deleteCols(grid, cols) {
  const desc = Array.from(new Set(cols)).sort((a, b) => b - a);
  for (const c of desc) {
    if (c >= 0 && c < colCount(grid))
      deleteCol(grid, c);
  }
}
function insertRowsAbove(grid, r, count) {
  for (let i = 0; i < count; i++)
    insertRow(grid, r - 1);
}
function insertRowsBelow(grid, r, count) {
  for (let i = 0; i < count; i++)
    insertRow(grid, r);
}
function insertColsLeft(grid, c, count) {
  for (let i = 0; i < count; i++)
    insertCol(grid, c - 1);
}
function insertColsRight(grid, c, count) {
  for (let i = 0; i < count; i++)
    insertCol(grid, c);
}
function rowDraggable(grid, r) {
  for (let rr = 0; rr < grid.length; rr++) {
    for (const cd of grid[rr] ?? []) {
      if (!cd || !visible(cd) || cd.rs <= 1)
        continue;
      if (rr <= r && r < rr + cd.rs)
        return false;
    }
  }
  return true;
}
function colDraggable(grid, c) {
  for (const row of grid) {
    for (let i = 0; i < row.length; i++) {
      const cd = row[i];
      if (!cd || !visible(cd) || cd.cs <= 1)
        continue;
      if (i <= c && c < i + cd.cs)
        return false;
    }
  }
  return true;
}
function colMoveBlocked(grid, from, b) {
  for (const row of grid) {
    for (let i = 0; i < row.length; i++) {
      const cd = row[i];
      if (!cd || !visible(cd) || cd.cs <= 1 || i === from)
        continue;
      const c0 = i < from ? i : i - 1;
      if (c0 < b && b < c0 + cd.cs)
        return true;
    }
  }
  return false;
}
function rowMoveBlocked(grid, from, b) {
  for (let rr = 0; rr < grid.length; rr++) {
    for (const cd of grid[rr] ?? []) {
      if (!cd || !visible(cd) || cd.rs <= 1 || rr === from)
        continue;
      const r0 = rr < from ? rr : rr - 1;
      if (r0 < b && b < r0 + cd.rs)
        return true;
    }
  }
  return false;
}
function moveCol(grid, from, b) {
  for (const row of grid) {
    const slots = row.splice(from, 1);
    const slot = slots[0];
    if (slot)
      row.splice(b, 0, slot);
  }
}
function moveRow(grid, from, b) {
  const rows = grid.splice(from, 1);
  const row = rows[0];
  if (row)
    grid.splice(b, 0, row);
}
function toggleWrapTag(html, tag) {
  const re = new RegExp(`^<${tag}>([\\s\\S]*)</${tag}>$`, "i");
  const m = html.match(re);
  if (m)
    return m[1];
  if (!html.trim())
    return html;
  return `<${tag}>${html}</${tag}>`;
}
function toggleTodoMark(html, idx, checked) {
  let seen = -1;
  let hit = false;
  let inCode = false;
  const out = html.replace(/`|-\s*\[([ xX])\]/g, (m, mark) => {
    if (m === "`") {
      inCode = !inCode;
      return m;
    }
    if (inCode)
      return m;
    seen++;
    if (seen !== idx || hit)
      return m;
    hit = true;
    const next = checked ? "x" : " ";
    return m.replace(/\[[ xX]\]/, `[${next}]`);
  });
  return out;
}

// src/render.ts
var import_obsidian3 = require("obsidian");

// src/i18n.ts
var lang = "zh";
function setUiLang(l) {
  lang = l;
}
function t(zh, en) {
  return lang === "zh" ? zh : en;
}
var REPO_URL = "https://github.com/Ming145/Vtable";
function barLegend() {
  if (lang === "zh") {
    return [
      "B = \u52A0\u7C97\uFF0CI = \u659C\u4F53\uFF0CA- / A+ = \u7F29\u5C0F / \u653E\u5927\u5B57\u53F7\uFF0CSP = \u62C6\u5206\u5355\u5143\u683C",
      "M\u2193 = \u5411\u4E0B\u5408\u5E76\uFF0CM\u2192 = \u5411\u53F3\u5408\u5E76\uFF0C+R / +C = \u52A0\u884C / \u52A0\u5217\uFF0C-R / -C = \u5220\u884C / \u5220\u5217",
      "MD = \u8F6C Markdown \u8868\u683C\uFF0CH5 = \u8F6C HTML \u8868\u683C"
    ].join("\n");
  }
  return [
    "B = Bold, I = Italic, A- / A+ = Smaller / Larger font, SP = Split cell",
    "M\u2193 = Merge down, M\u2192 = Merge right, +R / +C = Add row / column, -R / -C = Delete row / column",
    "MD = Convert to Markdown table, H5 = Convert to HTML table"
  ].join("\n");
}

// src/paste-grid.ts
var CELL_NUL = "\0";
var CELL_BS = "";
function splitRow2(line) {
  const safe = line.replace(/\\\\/g, CELL_BS).replace(/\\\|/g, CELL_NUL);
  let parts = safe.split("|");
  if (parts.length > 1 && parts[0].trim() === "")
    parts = parts.slice(1);
  if (parts.length > 1 && parts[parts.length - 1].trim() === "")
    parts = parts.slice(0, -1);
  return parts.map((p) => p.replace(new RegExp(CELL_BS, "g"), "\\").replace(new RegExp(CELL_NUL, "g"), "|").trim());
}
function isSepRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}
function parseMarkdownTable(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2)
    return null;
  const head = splitRow2(lines[0]);
  const sep = splitRow2(lines[1]);
  if (head.length < 1 || !isSepRow(sep))
    return null;
  const nCols = sep.length;
  if (nCols < 1)
    return null;
  const pad = (cells) => {
    const out = cells.slice(0, nCols);
    while (out.length < nCols)
      out.push("");
    return out;
  };
  const rows = [pad(head)];
  for (let i = 2; i < lines.length; i++) {
    const cells = splitRow2(lines[i]);
    if (!cells.length)
      continue;
    rows.push(pad(cells));
  }
  return rows;
}

// src/sel.ts
function buildAnchorIndex(grid) {
  const idx = /* @__PURE__ */ new Map();
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (!visible(cd))
        continue;
      for (let dr = 0; dr < cd.rs; dr++) {
        for (let dc = 0; dc < cd.cs; dc++) {
          idx.set(`${r + dr},${c + dc}`, { r, c });
        }
      }
    }
  }
  return idx;
}
function normalizeSelRect(rect, grid, idx) {
  const out = { r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 };
  out.rawR1 = rect.r1;
  out.rawC1 = rect.c1;
  out.rawR2 = rect.r2;
  out.rawC2 = rect.c2;
  const maxIter = grid.length + (grid[0]?.length ?? 0) + 4;
  for (let iter = 0; iter < maxIter; iter++) {
    let grew = false;
    for (let r = out.r1; r <= out.r2; r++) {
      for (let c = out.c1; c <= out.c2; c++) {
        const a = idx.get(`${r},${c}`);
        if (!a)
          continue;
        const cd = grid[a.r]?.[a.c];
        if (!cd)
          continue;
        const ar2 = a.r + cd.rs - 1;
        const ac2 = a.c + cd.cs - 1;
        if (a.r < out.r1) {
          out.r1 = a.r;
          grew = true;
        }
        if (a.c < out.c1) {
          out.c1 = a.c;
          grew = true;
        }
        if (ar2 > out.r2) {
          out.r2 = ar2;
          grew = true;
        }
        if (ac2 > out.c2) {
          out.c2 = ac2;
          grew = true;
        }
      }
    }
    if (!grew)
      break;
  }
  return out;
}
function rectContains(rc, r, c) {
  return r >= rc.r1 && r <= rc.r2 && c >= rc.c1 && c <= rc.c2;
}
function runsFromRects(rects, axis) {
  const set = /* @__PURE__ */ new Set();
  for (const rc of rects) {
    const from = axis === "rows" ? rc.r1 : rc.c1;
    const to = axis === "rows" ? rc.r2 : rc.c2;
    for (let v = from; v <= to; v++)
      set.add(v);
  }
  const sorted = Array.from(set).sort((a, b) => a - b);
  const runs = [];
  for (const v of sorted) {
    const last = runs[runs.length - 1];
    if (last && v === last.end + 1)
      last.end = v;
    else
      runs.push({ start: v, end: v });
  }
  return runs;
}
function unionSelBounds(rects) {
  let r1 = Infinity, c1 = Infinity, r2 = -Infinity, c2 = -Infinity;
  for (const rc of rects) {
    if (rc.r1 < r1)
      r1 = rc.r1;
    if (rc.c1 < c1)
      c1 = rc.c1;
    if (rc.r2 > r2)
      r2 = rc.r2;
    if (rc.c2 > c2)
      c2 = rc.c2;
  }
  return { r1, c1, r2, c2 };
}
function isSolidUnion(rects) {
  if (!rects.length)
    return false;
  const b = unionSelBounds(rects);
  for (let r = b.r1; r <= b.r2; r++) {
    for (let c = b.c1; c <= b.c2; c++) {
      if (!rects.some((rc) => rectContains(rc, r, c)))
        return false;
    }
  }
  return true;
}
var n1 = (n) => Math.round(n * 10) / 10;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function buildSnap(values) {
  const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
  const map = /* @__PURE__ */ new Map();
  let i = 0;
  while (i < uniq.length) {
    let j = i;
    while (j + 1 < uniq.length && uniq[j + 1] - uniq[j] <= 1)
      j++;
    const rep = Math.round(uniq.slice(i, j + 1).reduce((s, v) => s + v, 0) / (j - i + 1));
    for (let k = i; k <= j; k++)
      map.set(uniq[k], rep);
    i = j + 1;
  }
  return map;
}
function compressCollinear(pts) {
  const n = pts.length;
  if (n < 3)
    return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0)
      continue;
    out.push(b);
  }
  return out;
}
function roundedLoopPath(pts, radius) {
  const cp = compressCollinear(pts);
  const n = cp.length;
  if (n < 3)
    return "";
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = cp[(i - 1 + n) % n];
    const cur = cp[i];
    const next = cp[(i + 1) % n];
    const d1 = dist(prev, cur);
    const d2 = dist(cur, next);
    if (d1 === 0 || d2 === 0)
      return "";
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = { x: cur.x + (prev.x - cur.x) * (r / d1), y: cur.y + (prev.y - cur.y) * (r / d1) };
    const b = { x: cur.x + (next.x - cur.x) * (r / d2), y: cur.y + (next.y - cur.y) * (r / d2) };
    d += i === 0 ? `M ${n1(a.x)} ${n1(a.y)} ` : `L ${n1(a.x)} ${n1(a.y)} `;
    d += `Q ${n1(cur.x)} ${n1(cur.y)} ${n1(b.x)} ${n1(b.y)} `;
  }
  return d + "Z";
}
function unionOutlinePath(pxRects, radius = 5) {
  const snapped = pxRects.filter((r) => r.w > 0.5 && r.h > 0.5).map((r) => ({ x: r.x, y: r.y, x2: r.x + r.w, y2: r.y + r.h }));
  if (!snapped.length)
    return "";
  const snapX = buildSnap(snapped.flatMap((r) => [r.x, r.x2]));
  const snapY = buildSnap(snapped.flatMap((r) => [r.y, r.y2]));
  const rects = [];
  for (const r of snapped) {
    const x = snapX.get(r.x), x2 = snapX.get(r.x2), y = snapY.get(r.y), y2 = snapY.get(r.y2);
    if (x2 > x && y2 > y)
      rects.push({ x, x2, y, y2 });
  }
  if (!rects.length)
    return "";
  const xsAll = /* @__PURE__ */ new Set();
  const ysAll = /* @__PURE__ */ new Set();
  for (const r of rects) {
    xsAll.add(r.x);
    xsAll.add(r.x2);
    ysAll.add(r.y);
    ysAll.add(r.y2);
  }
  const xs = Array.from(xsAll).sort((a, b) => a - b);
  const ys = Array.from(ysAll).sort((a, b) => a - b);
  const counts = /* @__PURE__ */ new Map();
  const addSeg = (x1, y1, x2, y2) => {
    const forward = x1 < x2 || x1 === x2 && y1 < y2;
    const k = forward ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
    counts.set(k, (counts.get(k) ?? 0) + (forward ? 1 : -1));
  };
  const addH = (xa, xb, y, dir) => {
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    const pts = [lo];
    for (const v of xs)
      if (v > lo && v < hi)
        pts.push(v);
    pts.push(hi);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (dir > 0)
        addSeg(a, y, b, y);
      else
        addSeg(b, y, a, y);
    }
  };
  const addV = (ya, yb, x, dir) => {
    const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
    const pts = [lo];
    for (const v of ys)
      if (v > lo && v < hi)
        pts.push(v);
    pts.push(hi);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (dir > 0)
        addSeg(x, a, x, b);
      else
        addSeg(x, b, x, a);
    }
  };
  for (const r of rects) {
    addH(r.x, r.x2, r.y, 1);
    addV(r.y, r.y2, r.x2, 1);
    addH(r.x2, r.x, r.y2, -1);
    addV(r.y2, r.y, r.x, -1);
  }
  const segs = [];
  for (const [k, n] of counts) {
    if (n === 0)
      continue;
    const parts = k.split(",");
    const p1 = { x: Number(parts[0]), y: Number(parts[1]) };
    const p2 = { x: Number(parts[2]), y: Number(parts[3]) };
    segs.push(n > 0 ? { from: p1, to: p2 } : { from: p2, to: p1 });
  }
  if (!segs.length)
    return "";
  const byStart = /* @__PURE__ */ new Map();
  const pkey = (p) => `${p.x},${p.y}`;
  for (const s of segs) {
    const arr = byStart.get(pkey(s.from));
    if (arr)
      arr.push(s);
    else
      byStart.set(pkey(s.from), [s]);
  }
  const used = /* @__PURE__ */ new Set();
  const loops = [];
  for (const s0 of segs) {
    if (used.has(s0))
      continue;
    const loop = [];
    let seg = s0;
    let guard = 0;
    let open = false;
    while (guard++ < 1e5) {
      used.add(seg);
      loop.push(seg.from);
      if (seg.to.x === s0.from.x && seg.to.y === s0.from.y)
        break;
      const cands = (byStart.get(pkey(seg.to)) ?? []).filter((s) => !used.has(s));
      if (!cands.length) {
        open = true;
        break;
      }
      const inDx = seg.to.x - seg.from.x;
      const inDy = seg.to.y - seg.from.y;
      let best = cands[0];
      let bestScore = -Infinity;
      for (const cand of cands) {
        const dx = cand.to.x - cand.from.x;
        const dy = cand.to.y - cand.from.y;
        const cross = inDx * dy - inDy * dx;
        const score = cross > 0 ? 2 : cross < 0 ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      seg = best;
    }
    if (!open && loop.length >= 4)
      loops.push(loop);
  }
  return loops.map((l) => roundedLoopPath(l, radius)).filter(Boolean).join(" ");
}
var SVG_NS = "http://www.w3.org/2000/svg";
var _SelOverlay = class {
  constructor(wrap, table) {
    this.wrap = wrap;
    this.table = table;
    this.layer = null;
    this.svg = null;
    this.path = null;
    this.rects = [];
    this.cellMap = [];
    this.ro = null;
    /** 巡检定时器（选区可见期间运行） */
    this.rafId = 0;
    /** 最近一次定位时的几何快照（表格相对 wrap，视口坐标） */
    this.geo = null;
    /** 首个选中格相对表格的锚点（巡检漂移检测用） */
    this.cellAnchor = { x: -1, y: -1 };
    this.ro = new ResizeObserver(() => {
      if (!this.table.isConnected) {
        this.ro?.disconnect();
        return;
      }
      if (this.rects.length)
        this.redraw();
    });
    this.ro.observe(table);
    this.ro.observe(wrap);
  }
  update(rects, cellMap) {
    this.rects = rects;
    this.cellMap = cellMap;
    this.redraw();
    this.scheduleLiveSync();
  }
  destroy() {
    this.stopLiveSync();
    this.ro?.disconnect();
    this.ro = null;
    this.layer?.remove();
    this.layer = null;
  }
  stopLiveSync() {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
  /** 选区可见期间每帧巡检：分两条路径
   *  1) 表格视口位移（滚动/缩放/外层布局）→ 只同步层位置（fixed 层不随内容滚动，逐帧贴回）；
   *  2) 首个选中格相对表格漂移（列宽/行高再分配，渲染晚到）→ 全量重绘 */
  scheduleLiveSync() {
    this.stopLiveSync();
    const tick = () => {
      this.rafId = 0;
      if (!this.rects.length || !this.table.isConnected || !this.layer)
        return;
      const tRect = this.table.getBoundingClientRect();
      const g = this.geo;
      const posMoved = !!g && (Math.abs(g.left - tRect.left) > 0.5 || Math.abs(g.top - tRect.top) > 0.5);
      const sizeChanged = !g || Math.abs(g.width - tRect.width) > 0.5 || Math.abs(g.height - tRect.height) > 0.5;
      if (sizeChanged) {
        this.redraw();
      } else if (posMoved) {
        this.placeLayer();
      } else {
        let cellMoved = false;
        outer:
          for (const rect of this.rects) {
            for (let r = rect.r1; r <= rect.r2; r++) {
              for (let c = rect.c1; c <= rect.c2; c++) {
                const td = this.cellMap[r]?.[c];
                if (!td)
                  continue;
                const b = td.getBoundingClientRect();
                if (Math.abs(b.left - tRect.left - this.cellAnchor.x) > 0.5 || Math.abs(b.top - tRect.top - this.cellAnchor.y) > 0.5) {
                  cellMoved = true;
                }
                break outer;
              }
            }
          }
        if (cellMoved) {
          this.redraw();
        }
      }
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }
  redraw() {
    if (!this.rects.length) {
      this.stopLiveSync();
      if (this.layer)
        this.layer.style.display = `none`;
      return;
    }
    this.ensureLayer();
    const d = this.buildPath();
    if (!d) {
      this.layer.style.display = `none`;
      return;
    }
    this.placeLayer();
    this.path.setAttribute("d", d);
  }
  /** 层/svg 定位与尺寸：fixed 视口坐标 + BLEED 出血（描边贴边不被裁） */
  placeLayer() {
    const tRect = this.table.getBoundingClientRect();
    const B = _SelOverlay.BLEED;
    this.geo = {
      left: tRect.left,
      top: tRect.top,
      width: tRect.width,
      height: tRect.height
    };
    const layer = this.layer;
    layer.style.display = `block`;
    layer.style.left = `${tRect.left - B}px`;
    layer.style.top = `${tRect.top - B}px`;
    layer.style.width = `${tRect.width + B * 2}px`;
    layer.style.height = `${tRect.height + B * 2}px`;
    const w = Math.max(1, tRect.width + B * 2);
    const h = Math.max(1, tRect.height + B * 2);
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));
    this.svg.setAttribute("viewBox", `${-B} ${-B} ${w} ${h}`);
  }
  ensureLayer() {
    if (this.layer && this.layer.isConnected)
      return;
    this.layer?.remove();
    this.layer = document.body.createDiv({ cls: "vt-sel-layer" });
    this.layer.style.position = `fixed`;
    this.layer.style.pointerEvents = `none`;
    this.layer.style.overflow = `visible`;
    this.layer.style.zIndex = `1000`;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.style.overflow = `visible`;
    this.path = document.createElementNS(SVG_NS, "path");
    this.path.style.fill = `var(--interactive-accent, #7c3aed)`;
    this.path.style.fillOpacity = `0.10`;
    this.path.style.fillRule = `evenodd`;
    this.path.style.stroke = `var(--interactive-accent, #7c3aed)`;
    this.path.style.strokeWidth = `2`;
    this.svg.appendChild(this.path);
    this.layer.appendChild(this.svg);
  }
  /** 选区矩形 → 覆盖的可见单元格像素盒（相对表格原点，视口坐标差） */
  buildPath() {
    const tableRect = this.table.getBoundingClientRect();
    if (tableRect.width <= 0 || tableRect.height <= 0)
      return "";
    const px = [];
    for (const rect of this.rects) {
      for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
          const td = this.cellMap[r]?.[c];
          if (!td)
            continue;
          const b = td.getBoundingClientRect();
          if (b.width <= 0 || b.height <= 0)
            continue;
          px.push({ x: b.left - tableRect.left, y: b.top - tableRect.top, w: b.width, h: b.height });
        }
      }
    }
    if (px.length)
      this.cellAnchor = { x: px[0].x, y: px[0].y };
    return unionOutlinePath(px);
  }
};
var SelOverlay = _SelOverlay;
/** 描边一半 + 圆角余量的出血边距 */
SelOverlay.BLEED = 8;

// src/drag.ts
var import_obsidian = require("obsidian");
var START_THRESHOLD = 4;
var _isTouch = import_obsidian.Platform.isMobile || import_obsidian.Platform.isTablet;
var GRIP = _isTouch ? 24 : 16;
var GRIP_COL = _isTouch ? 16 : 12;
var GAP = 2;
var EDGE_GAP_TOUCH = 26;
var lastMouse = null;
var persistedRC = null;
var activeUid = null;
var activeCleanup = null;
function bindRowColDrag(table, data, wrap, editing, hooks) {
  activeCleanup?.();
  activeCleanup = null;
  const grid = data.rows;
  const rows = Array.from(table.querySelectorAll("tr"));
  const cols = colCount(grid);
  if (!editing || rows.length < 1 || cols < 1)
    return;
  const rowOk = rows.map((_, r) => rowDraggable(grid, r));
  const colOk = Array.from({ length: cols }, (_, c) => colDraggable(grid, c));
  const tableRect = () => table.getBoundingClientRect();
  const wrapRect = () => wrap.getBoundingClientRect();
  function colX(c) {
    const tb = tableRect();
    const td = table.querySelector(`td[data-vt-c="${c}"], th[data-vt-c="${c}"]`);
    if (td)
      return td.getBoundingClientRect().left - tb.left;
    const cov = Array.from(table.querySelectorAll("td,th")).find((el) => {
      const c0 = parseInt(el.dataset.vtC ?? "-1", 10);
      const cs = el.colSpan || 1;
      return c0 >= 0 && c0 < c && c < c0 + cs;
    });
    if (cov) {
      const c0 = parseInt(cov.dataset.vtC ?? "0", 10);
      const b = cov.getBoundingClientRect();
      return b.left - tb.left + b.width * (c - c0) / Math.max(1, cov.colSpan || 1);
    }
    return tb.width * c / cols;
  }
  function colW(c) {
    return (c >= cols ? tableRect().width : colX(c + 1)) - colX(c);
  }
  const doc = document.body;
  const rowGrips = rows.map((tr, r) => {
    const g = doc.createDiv({ cls: "vt-drag-grip vt-drag-row" });
    if (!rowOk[r])
      g.addClass("vt-drag-off");
    return g;
  });
  const colGrips = [];
  for (let c = 0; c < cols; c++) {
    const g = doc.createDiv({ cls: "vt-drag-grip vt-drag-col" });
    if (!colOk[c])
      g.addClass("vt-drag-off");
    colGrips.push(g);
  }
  const dropLine = wrap.createDiv({ cls: "vt-drop-line" });
  dropLine.style.display = `none`;
  const hideLine = () => {
    dropLine.style.display = `none`;
  };
  const showLine = (horizontal, pos, cross, bad) => {
    dropLine.style.display = `block`;
    dropLine.classList.toggle("vt-drop-h", horizontal);
    dropLine.classList.toggle("vt-drop-bad", bad);
    if (horizontal) {
      dropLine.style.left = `0px`;
      dropLine.style.width = `${cross}px`;
      dropLine.style.top = `${pos}px`;
      dropLine.style.height = `2px`;
    } else {
      dropLine.style.top = `0px`;
      dropLine.style.height = `${cross}px`;
      dropLine.style.left = `${pos}px`;
      dropLine.style.width = `2px`;
    }
  };
  let hoverRC = null;
  let focusRC = null;
  const placeGrips = () => {
    const tb = tableRect();
    const wr = wrap.getBoundingClientRect();
    const rightLimit = _isTouch ? wr.right - EDGE_GAP_TOUCH : wr.right;
    const vh = window.innerHeight;
    rows.forEach((tr, r) => {
      const g = rowGrips[r];
      if (!g.classList.contains("vt-drag-on"))
        return;
      const b = tr.getBoundingClientRect();
      const visT = Math.max(b.top, wr.top, 0);
      const visB = Math.min(b.bottom, wr.bottom, vh - 2);
      const visH = visB - visT;
      if (visH <= 0) {
        g.style.display = `none`;
        return;
      }
      g.style.display = ``;
      g.style.left = `${Math.max(wr.left - GRIP - GAP, Math.min(Math.max(GAP, b.left - GRIP - GAP), wr.right - GRIP))}px`;
      g.style.top = `${visT}px`;
      g.style.width = `${GRIP}px`;
      g.style.height = `${visH}px`;
    });
    colGrips.forEach((g, c) => {
      if (!g.classList.contains("vt-drag-on"))
        return;
      const cl = colX(c) + tb.left;
      const visL = Math.max(cl, wr.left);
      const visR = Math.min(cl + colW(c), rightLimit);
      const visW = visR - visL;
      if (visW <= 0) {
        g.style.display = `none`;
        return;
      }
      g.style.display = ``;
      g.style.left = `${visL}px`;
      g.style.top = `${Math.max(GAP, Math.min(tb.top - GRIP_COL - GAP, vh - GRIP_COL - 2))}px`;
      g.style.width = `${visW}px`;
      g.style.height = `${GRIP_COL}px`;
    });
  };
  const apply = () => {
    const cur = hoverRC ?? focusRC;
    const showR = cur && rowOk[cur.r] ? cur.r : -1;
    const showC = cur && colOk[cur.c] ? cur.c : -1;
    rowGrips.forEach((g, r) => {
      g.classList.toggle("vt-drag-on", r === showR);
    });
    colGrips.forEach((g, c) => g.classList.toggle("vt-drag-on", c === showC));
    const sel = hooks.getSelection();
    const litRows = sel.length > 0 && sel.every((rc) => rc.c1 === 0 && rc.c2 === cols - 1);
    const litCols = sel.length > 0 && sel.every((rc) => rc.r1 === 0 && rc.r2 === grid.length - 1);
    rowGrips.forEach((g) => g.classList.toggle("vt-drag-lit", litRows));
    colGrips.forEach((g) => g.classList.toggle("vt-drag-lit", litCols));
    placeGrips();
  };
  function locateAt(x, y) {
    const resolve = (hit2) => {
      if (!hit2)
        return null;
      const r0 = parseInt(hit2.dataset.vtR ?? "-1", 10);
      const c0 = parseInt(hit2.dataset.vtC ?? "-1", 10);
      if (r0 < 0 || c0 < 0)
        return null;
      const rs = hit2.rowSpan > 1 ? hit2.rowSpan : 1;
      const cs = hit2.colSpan > 1 ? hit2.colSpan : 1;
      const b = hit2.getBoundingClientRect();
      const r = r0 + Math.min(rs - 1, Math.floor((y - b.top) / b.height * rs));
      const c = c0 + Math.min(cs - 1, Math.floor((x - b.left) / b.width * cs));
      return { r: Math.max(0, r), c: Math.max(0, c) };
    };
    const probe = document.elementFromPoint(x, y);
    const hit = probe != null && probe.instanceOf(HTMLElement) ? probe.closest("td,th") : null;
    if (hit && table.contains(hit))
      return resolve(hit);
    let fallback = null;
    for (const td of table.querySelectorAll("td,th")) {
      const b = td.getBoundingClientRect();
      if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) {
        fallback = td;
        break;
      }
    }
    return resolve(fallback);
  }
  const isOurGrip = (el) => {
    const g = el?.closest?.(".vt-drag-grip");
    return !!g && (rowGrips.includes(g) || colGrips.includes(g));
  };
  const onMove = (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    if (drag)
      return;
    const td = e.target.closest?.("td,th");
    if (td && table.contains(td))
      hoverRC = locateAt(e.clientX, e.clientY);
    apply();
  };
  const onLeave = (e) => {
    if (isOurGrip(e.relatedTarget))
      return;
    if (e.pointerType === "touch")
      return;
    hoverRC = null;
    if (!drag)
      apply();
  };
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerleave", onLeave);
  wrap.addEventListener("pointerdown", (e) => {
    if (drag)
      return;
    const td = e.target?.closest?.("td,th");
    if (!td || !table.contains(td)) {
      if (e.pointerType === "touch" && hoverRC) {
        hoverRC = null;
        apply();
      }
      return;
    }
    const r = parseInt(td.dataset.vtR ?? "-1", 10);
    const c = parseInt(td.dataset.vtC ?? "-1", 10);
    if (r < 0 || c < 0)
      return;
    hoverRC = { r, c };
    apply();
  });
  rowGrips.forEach((g, r) => {
    g.addEventListener("pointerenter", () => {
      if (drag || !rowOk[r])
        return;
      hoverRC = { r, c: -1 };
      apply();
    });
    g.addEventListener("pointerleave", (e) => {
      if (drag || isOurGrip(e.relatedTarget))
        return;
      hoverRC = null;
      apply();
    });
  });
  colGrips.forEach((g, c) => {
    g.addEventListener("pointerenter", () => {
      if (drag || !colOk[c])
        return;
      hoverRC = { r: -1, c };
      apply();
    });
    g.addEventListener("pointerleave", (e) => {
      if (drag || isOurGrip(e.relatedTarget))
        return;
      hoverRC = null;
      apply();
    });
  });
  table.addEventListener("focusin", (e) => {
    const td = e.target.closest?.("td,th");
    if (!td)
      return;
    const r = parseInt(td.dataset.vtR ?? "-1", 10);
    const c = parseInt(td.dataset.vtC ?? "-1", 10);
    if (r >= 0 && c >= 0) {
      focusRC = { r, c };
      if (!hoverRC)
        apply();
    }
  });
  let drag = null;
  const startDrag = (e, dir, from, shift) => {
    hooks.onDragStart?.();
    const tb = tableRect();
    let edges;
    if (dir === "col") {
      edges = [];
      for (let c = 0; c <= cols; c++)
        edges.push(colX(c) + tb.left);
    } else {
      edges = rows.map((tr) => tr.getBoundingClientRect().top);
      edges.push(rows[rows.length - 1].getBoundingClientRect().bottom);
    }
    drag = {
      dir,
      from,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      curB: from,
      shift,
      badNow: false,
      edges,
      axisMin: tb.top,
      axisMax: dir === "row" ? tb.bottom : tb.bottom,
      grabD: 0,
      gripSpan: dir === "col" ? GRIP : GRIP
    };
    if (dir === "col")
      drag.gripEl = colGrips[from];
    else
      drag.gripEl = rowGrips[from];
    rowGrips.forEach((g) => {
      if (g !== drag.gripEl)
        g.classList.remove("vt-drag-on");
    });
    colGrips.forEach((g) => {
      if (g !== drag.gripEl)
        g.classList.remove("vt-drag-on");
    });
    placeGrips();
    const gr = drag.gripEl.getBoundingClientRect();
    drag.grabD = dir === "col" ? e.clientX - gr.left : e.clientY - gr.top;
    drag.gripSpan = dir === "col" ? Math.max(gr.width, 1) : Math.max(gr.height, 1);
  };
  const edgeAt = (v) => {
    const { edges } = drag;
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) {
        return v < (edges[i] + edges[i + 1]) / 2 ? i : i + 1;
      }
    }
    return v < edges[0] ? 0 : edges.length - 1;
  };
  const edgeViewportPos = (b0) => {
    const { edges } = drag;
    return edges[b0];
  };
  const onGripDown = (dir, from) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, dir, from, e.shiftKey);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
    window.addEventListener("pointercancel", onDragUp);
  };
  const onDragMove = (e) => {
    if (!drag)
      return;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.startX) < START_THRESHOLD && Math.abs(e.clientY - drag.startY) < START_THRESHOLD)
        return;
      drag.started = true;
    }
    const g = drag.gripEl;
    const wr = wrapRect();
    if (drag.dir === "col") {
      g.style.left = `${Math.max(wr.left, Math.min(e.clientX - drag.grabD, wr.right - drag.gripSpan))}px`;
      const b0 = edgeAt(e.clientX);
      let b = b0 <= drag.from ? b0 : b0 - 1;
      b = Math.max(0, Math.min(cols - 1, b));
      const bad = colMoveBlocked(grid, drag.from, b);
      drag.badNow = bad;
      drag.curB = b;
      const lx = edgeViewportPos(b0) - wr.left + wrap.scrollLeft;
      showLine(false, lx, table.offsetHeight, bad);
    } else {
      g.style.top = `${Math.max(wr.top, Math.min(e.clientY - drag.grabD, wr.bottom - drag.gripSpan))}px`;
      const b0 = edgeAt(e.clientY);
      let b = b0 <= drag.from ? b0 : b0 - 1;
      b = Math.max(0, Math.min(rows.length - 1, b));
      const bad = rowMoveBlocked(grid, drag.from, b);
      drag.badNow = bad;
      drag.curB = b;
      const ly = edgeViewportPos(b0) - wr.top + wrap.scrollTop;
      showLine(true, ly, table.offsetWidth, bad);
    }
  };
  const onDragUp = (e) => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    window.removeEventListener("pointercancel", onDragUp);
    const d = drag;
    drag = null;
    hideLine();
    if (!d)
      return;
    if (!d.started) {
      const rect = d.dir === "col" ? { r1: 0, c1: d.from, r2: grid.length - 1, c2: d.from } : { r1: d.from, c1: 0, r2: d.from, c2: cols - 1 };
      hooks.selectCells([rect], d.shift);
      apply();
      return;
    }
    if (d.badNow) {
      apply();
      return;
    }
    let focusNew;
    const focusNow = hooks.getFocused();
    if (focusNow) {
      const a0 = d.dir === "col" ? focusNow.c : focusNow.r;
      let a1;
      if (a0 === d.from)
        a1 = d.curB;
      else {
        a1 = a0 < d.from ? a0 : a0 - 1;
        if (a1 >= d.curB)
          a1 += 1;
      }
      focusNew = d.dir === "col" ? { r: focusNow.r, c: a1 } : { r: a1, c: focusNow.c };
    }
    persistedRC = focusNow ? focusNew : d.dir === "col" ? { r: 0, c: d.curB } : { r: d.curB, c: 0 };
    if (d.dir === "col") {
      moveCol(grid, d.from, d.curB);
      if (data.colWidths) {
        const w = data.colWidths.splice(d.from, 1)[0];
        if (w !== void 0)
          data.colWidths.splice(d.curB, 0, w);
      }
    } else {
      moveRow(grid, d.from, d.curB);
      if (data.rowHeights) {
        const h = data.rowHeights.splice(d.from, 1)[0];
        if (h !== void 0)
          data.rowHeights.splice(d.curB, 0, h);
      }
    }
    hooks.onMutate(focusNew);
    apply();
  };
  for (let r = 0; r < rows.length; r++) {
    if (rowOk[r])
      rowGrips[r].addEventListener("pointerdown", onGripDown("row", r));
  }
  for (let c = 0; c < cols; c++) {
    if (colOk[c])
      colGrips[c].addEventListener("pointerdown", onGripDown("col", c));
  }
  const cleanup = () => {
    rowGrips.forEach((g) => g.remove());
    colGrips.forEach((g) => g.remove());
    dropLine.remove();
  };
  activeCleanup = cleanup;
  const uid = Symbol("vtDrag");
  activeUid = uid;
  const tick = () => {
    window.requestAnimationFrame(tick);
    if (activeUid !== uid)
      return;
    if (!table.isConnected) {
      cleanup();
      return;
    }
    if (drag)
      return;
    if (rowGrips.some((g) => g.classList.contains("vt-drag-on")) || colGrips.some((g) => g.classList.contains("vt-drag-on"))) {
      placeGrips();
    }
  };
  window.requestAnimationFrame(tick);
  const onScroll = () => {
    if (!drag && rowGrips.some((g) => g.classList.contains("vt-drag-on")))
      placeGrips();
  };
  wrap.addEventListener("scroll", onScroll, { passive: true });
  if (persistedRC) {
    focusRC = { ...persistedRC };
  }
  const ae = document.activeElement;
  if (ae && table.contains(ae) && ae.dataset?.vtR != null && ae.dataset?.vtC != null) {
    const fr = parseInt(ae.dataset.vtR ?? "-1", 10);
    const fc = parseInt(ae.dataset.vtC ?? "-1", 10);
    if (fr >= 0 && fc >= 0)
      focusRC = { r: fr, c: fc };
  }
  if (lastMouse) {
    const wr = wrap.getBoundingClientRect();
    const tb = tableRect();
    if (lastMouse.x >= wr.left && lastMouse.x <= wr.right && lastMouse.y >= Math.min(wr.top, tb.top - GRIP_COL - GAP) && lastMouse.y <= wr.bottom) {
      hoverRC = locateAt(lastMouse.x, lastMouse.y);
    }
  }
  if (hoverRC || focusRC)
    apply();
}

// src/fill.ts
var CYCLES = [
  {
    words: ["\u661F\u671F\u4E00", "\u661F\u671F\u4E8C", "\u661F\u671F\u4E09", "\u661F\u671F\u56DB", "\u661F\u671F\u4E94", "\u661F\u671F\u516D", "\u661F\u671F\u65E5"],
    aliases: { \u661F\u671F\u5929: 6 }
  },
  {
    words: ["\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D", "\u5468\u65E5"],
    aliases: { \u5468\u5929: 6 }
  },
  { words: ["\u4E00\u6708", "\u4E8C\u6708", "\u4E09\u6708", "\u56DB\u6708", "\u4E94\u6708", "\u516D\u6708", "\u4E03\u6708", "\u516B\u6708", "\u4E5D\u6708", "\u5341\u6708", "\u5341\u4E00\u6708", "\u5341\u4E8C\u6708"] },
  { words: ["1\u6708", "2\u6708", "3\u6708", "4\u6708", "5\u6708", "6\u6708", "7\u6708", "8\u6708", "9\u6708", "10\u6708", "11\u6708", "12\u6708"] },
  {
    words: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    aliases: { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  },
  {
    words: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ],
    aliases: {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Sept: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11
    }
  }
];
var fmtNum = (v, dec, pad) => {
  let s = dec > 0 ? v.toFixed(dec) : String(v);
  if (pad > 0) {
    const dot = s.indexOf(".");
    const ip = dot === -1 ? s : s.slice(0, dot);
    const fp = dot === -1 ? "" : s.slice(dot);
    s = ip.padStart(pad, "0") + fp;
  }
  return s;
};
var isLeap = (y) => y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
var monthDays = (m, y) => new Date(y, m, 0).getDate();
function parseStart(v0, year = new Date().getFullYear()) {
  for (const cyc of CYCLES) {
    let i = cyc.words.indexOf(v0);
    if (i >= 0)
      return { kind: "cycle", list: cyc.words, idx: i };
    if (cyc.aliases && v0 in cyc.aliases) {
      return { kind: "cycle", list: cyc.words, idx: cyc.aliases[v0] };
    }
    if (/[a-zA-Z]/.test(v0)) {
      const lower = v0.toLowerCase();
      i = cyc.words.findIndex((w) => w.toLowerCase() === lower);
      if (i >= 0)
        return { kind: "cycle", list: cyc.words, idx: i };
      if (cyc.aliases) {
        for (const [alias, idx] of Object.entries(cyc.aliases)) {
          if (alias.toLowerCase() === lower) {
            return { kind: "cycle", list: cyc.words, idx };
          }
        }
      }
    }
  }
  const md = v0.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (md) {
    const mo = parseInt(md[1], 10);
    const day = parseInt(md[2], 10);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= monthDays(mo, year)) {
      let idx = 0;
      for (let m2 = 1; m2 < mo; m2++)
        idx += monthDays(m2, year);
      idx += day - 1;
      return { kind: "date", idx, year, yearLen: isLeap(year) ? 366 : 365 };
    }
  }
  const m = v0.match(/^[+-]?\d+(\.\d+)?$/);
  if (m) {
    const dec = m[1] ? m[1].length - 1 : 0;
    const ip = v0.split(".")[0].replace(/^[+-]/, "");
    const pad = ip.length > 1 && ip[0] === "0" ? ip.length : 0;
    return { kind: "num", v: parseFloat(v0), dec, pad };
  }
  const mm = v0.match(/^(.*?)(\d+)(\D*)$/);
  if (mm) {
    const digits = mm[2];
    const pad = digits.length > 1 && digits[0] === "0" ? digits.length : 0;
    return { kind: "mix", pre: mm[1], v: parseInt(digits, 10), pad, suf: mm[3] };
  }
  return { kind: "copy" };
}
var fmtDate = (doy, year) => {
  let m = 1;
  while (doy >= monthDays(m, year)) {
    doy -= monthDays(m, year);
    m++;
  }
  return `${m}\u6708${doy + 1}\u65E5`;
};
function genSeries(v0, n, sign, year = new Date().getFullYear()) {
  const s = parseStart(v0, year);
  const out = [];
  for (let k = 1; k <= n; k++) {
    if (s.kind === "cycle") {
      const len = s.list.length;
      out.push(s.list[((s.idx + sign * k) % len + len) % len]);
    } else if (s.kind === "date") {
      const doy = ((s.idx + sign * k) % s.yearLen + s.yearLen) % s.yearLen;
      out.push(fmtDate(doy, s.year));
    } else if (s.kind === "num") {
      out.push(fmtNum(s.v + sign * k, s.dec, s.pad));
    } else if (s.kind === "mix") {
      out.push(s.pre + fmtNum(s.v + sign * k, 0, s.pad) + s.suf);
    } else {
      out.push(v0);
    }
  }
  return out;
}
var mkDiv = (cls, parent) => {
  const d = createDiv();
  d.className = cls;
  parent.appendChild(d);
  return d;
};
var emptyEl = (el) => {
  while (el.firstChild)
    el.removeChild(el.firstChild);
};
var HANDLE_SIZE = 9;
var DOT_SIZE = 7;
var triPathD = (size) => {
  const r = size * 0.28;
  const k = r * 0.7071;
  return `M${size - k},${k} Q${size},0 ${size},${r} L${size},${size - r} Q${size},${size} ${size - r},${size} L${r},${size} Q0,${size} ${k},${size - k} Z`;
};
var HIT_PAD = 4;
var mkTri = (size) => {
  const e = HIT_PAD;
  const hit = createDiv();
  hit.className = "vt-fill-tri-hit";
  hit.style.position = `absolute`;
  hit.style.left = `0`;
  hit.style.top = `0`;
  hit.style.width = `${size + 2 * e}px`;
  hit.style.height = `${size + 2 * e}px`;
  hit.style.pointerEvents = `auto`;
  const s2 = size + e;
  const t2 = Math.max(0, size - e * 1.414);
  hit.style.clipPath = `polygon(${s2}px 0, ${s2}px ${s2}px, 0 ${s2}px, 0 ${t2}px, ${t2}px 0)`;
  const draw = createDiv();
  draw.className = "vt-fill-tri-draw";
  draw.style.position = `absolute`;
  draw.style.left = `0`;
  draw.style.top = `0`;
  draw.style.width = `${size}px`;
  draw.style.height = `${size}px`;
  draw.style.pointerEvents = `none`;
  const d = triPathD(size);
  draw.style.clipPath = `path('${d}')`;
  draw.style.background = `var(--interactive-accent, #7c3aed)`;
  draw.style.opacity = `0.55`;
  return [hit, draw];
};
var FillHandle = class {
  constructor(deps) {
    this.deps = deps;
    // 递增/递减选择框
    this.anchor = null;
    this.drag = null;
    this.menuState = null;
    this.rafId = 0;
    this.disposed = false;
    /** 锚格尺寸监听：编辑中格变长/变高 → 柄实时跟到新的右下角 */
    this.ro = new ResizeObserver(() => {
      if (!this.disposed && this.anchor)
        this.placeHandle();
    });
    this.onScroll = () => {
      if (this.disposed)
        return;
      window.cancelAnimationFrame(this.rafId);
      this.rafId = window.requestAnimationFrame(() => this.reposition());
    };
    this.onDocPointerDown = (e) => {
      if (!this.menuState)
        return;
      if (this.menu.contains(e.target))
        return;
      this.closeMenu();
    };
    this.onKeyDown = (e) => {
      if (this.menuState && e.key === "Escape") {
        e.stopPropagation();
        this.closeMenu();
      }
    };
    for (const cls of ["vt-fill-handle", "vt-fill-dots"]) {
      document.body.querySelectorAll("." + cls).forEach((n) => n.remove());
    }
    this.el = mkDiv("vt-fill-handle", document.body);
    const [hHit, hDraw] = mkTri(HANDLE_SIZE);
    this.el.appendChild(hHit);
    this.el.appendChild(hDraw);
    this.el.style.display = `none`;
    this.dots = mkDiv("vt-fill-dots", document.body);
    this.dots.style.display = `none`;
    this.menu = mkDiv("vt-fill-menu", document.body);
    this.menu.style.display = `none`;
    this.el.addEventListener("pointerdown", (e) => this.onHandleDown(e));
    this.el.addEventListener("pointermove", (e) => this.onHandleMove(e));
    this.el.addEventListener("pointerup", (e) => this.onHandleUp(e));
    this.el.addEventListener("pointercancel", () => this.cancelDrag());
    document.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onScroll);
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }
  /** 表格销毁后惰性清理（body 浮层不随容器移除，需自检） */
  checkDisposed() {
    if (this.disposed)
      return true;
    if (this.anchor && !this.deps.cellTd(this.anchor.r, this.anchor.c)?.isConnected) {
      this.destroy();
      return true;
    }
    return false;
  }
  destroy() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.ro.disconnect();
    window.cancelAnimationFrame(this.rafId);
    this.anchor = null;
    this.drag = null;
    this.menuState = null;
    this.el.remove();
    this.dots.remove();
    this.menu.remove();
    document.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onScroll);
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
  }
  /* ---------- 显示/隐藏 ---------- */
  showAt(r, c) {
    if (this.checkDisposed())
      return;
    if (this.drag)
      return;
    this.anchor = { r, c };
    this.placeHandle();
    this.ro.disconnect();
    const td = this.deps.cellTd(r, c);
    if (td)
      this.ro.observe(td);
  }
  hide() {
    if (this.drag)
      return;
    this.anchor = null;
    this.ro.disconnect();
    this.el.style.display = `none`;
    this.clearDots();
  }
  reposition() {
    if (this.checkDisposed())
      return;
    if (this.anchor)
      this.placeHandle();
    if (this.drag)
      this.refreshDots();
    if (this.menuState)
      this.placeMenu();
  }
  placeHandle() {
    const a = this.anchor;
    const td = this.deps.cellTd(a.r, a.c);
    if (!td || !td.isConnected) {
      this.el.style.display = `none`;
      return;
    }
    const rect = td.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.el.style.display = `none`;
      return;
    }
    const S = HANDLE_SIZE;
    this.el.style.display = `block`;
    const cs = getComputedStyle(td);
    const vgap = (parseFloat(cs.borderBottomWidth) || 0) + 4;
    const hgap = (parseFloat(cs.borderRightWidth) || 0) + 2;
    this.el.style.left = `${Math.round(rect.right - hgap - S)}px`;
    this.el.style.top = `${Math.round(rect.bottom - vgap - S)}px`;
  }
  /* ---------- 拖动 ---------- */
  onHandleDown(e) {
    if (e.button !== 0 || !this.anchor || this.disposed)
      return;
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu();
    this.deps.flushActive();
    const { r, c } = this.anchor;
    this.drag = {
      r0: r,
      c0: c,
      curR: r,
      curC: c,
      cells: [{ r, c }]
    };
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
    }
    this.refreshDots();
  }
  onHandleMove(e) {
    const d = this.drag;
    if (!d || this.disposed)
      return;
    const hit = this.tdAt(e.clientX, e.clientY);
    if (!hit)
      return;
    let r = hit.r;
    let c = hit.c;
    if (Math.abs(r - d.r0) >= Math.abs(c - d.c0))
      c = d.c0;
    else
      r = d.r0;
    if (r === d.curR && c === d.curC)
      return;
    d.curR = r;
    d.curC = c;
    this.rebuildCells(d);
    this.refreshDots();
  }
  onHandleUp(e) {
    const d = this.drag;
    if (!d || this.disposed)
      return;
    this.drag = null;
    this.clearDots();
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
    }
    const cells = d.cells;
    if (cells.length <= 1) {
      this.anchor = { r: d.r0, c: d.c0 };
      this.placeHandle();
      return;
    }
    const sign = d.curR > d.r0 || d.curC > d.c0 ? 1 : -1;
    const v0 = this.deps.cellValue(d.r0, d.c0);
    const vals = genSeries(v0, cells.length - 1, sign);
    const writes = [];
    for (let i = 1; i < cells.length; i++) {
      const cell2 = cells[i];
      if (!this.deps.cellVisible(cell2.r, cell2.c))
        continue;
      writes.push({ r: cell2.r, c: cell2.c, v: vals[i - 1] });
    }
    if (!writes.length)
      return;
    const last = cells[cells.length - 1];
    const lastTd = this.deps.cellTd(last.r, last.c);
    const lastRect = lastTd?.isConnected ? lastTd.getBoundingClientRect() : null;
    this.deps.applyFill(writes, { r: d.r0, c: d.c0 });
    const kind = parseStart(v0).kind;
    if (kind !== "copy" && lastRect) {
      this.menuState = { cells, v0, sign, anchorRect: lastRect };
      this.openMenu();
    }
    this.anchor = { r: d.r0, c: d.c0 };
  }
  cancelDrag() {
    if (!this.drag)
      return;
    this.drag = null;
    this.clearDots();
  }
  tdAt(x, y) {
    const elm = document.elementFromPoint(x, y);
    const td = elm?.closest("td, th");
    if (!td)
      return null;
    const r = parseInt(td.dataset.vtR ?? "-1", 10);
    const c = parseInt(td.dataset.vtC ?? "-1", 10);
    if (r < 0 || c < 0)
      return null;
    return { r, c };
  }
  rebuildCells(d) {
    const cells = [{ r: d.r0, c: d.c0 }];
    if (d.curR !== d.r0) {
      const step = d.curR > d.r0 ? 1 : -1;
      for (let r = d.r0 + step; ; r += step) {
        cells.push({ r, c: d.c0 });
        if (r === d.curR)
          break;
      }
    } else if (d.curC !== d.c0) {
      const step = d.curC > d.c0 ? 1 : -1;
      for (let c = d.c0 + step; ; c += step) {
        cells.push({ r: d.r0, c });
        if (c === d.curC)
          break;
      }
    }
    d.cells = cells;
  }
  refreshDots() {
    const d = this.drag;
    if (!d)
      return;
    this.clearDots();
    if (d.cells.length <= 1)
      return;
    this.dots.style.display = `block`;
    for (let i = 1; i < d.cells.length; i++) {
      const cell2 = d.cells[i];
      const td = this.deps.cellTd(cell2.r, cell2.c);
      if (!td || !td.isConnected)
        continue;
      const rect = td.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        continue;
      const [hit, draw] = mkTri(DOT_SIZE);
      const cs = getComputedStyle(td);
      const vgap = (parseFloat(cs.borderBottomWidth) || 0) + 4;
      const hgap = (parseFloat(cs.borderRightWidth) || 0) + 2;
      const left = Math.round(rect.right - hgap - DOT_SIZE);
      const top = Math.round(rect.bottom - vgap - DOT_SIZE);
      hit.style.left = `${left}px`;
      hit.style.top = `${top}px`;
      draw.style.left = `${left}px`;
      draw.style.top = `${top}px`;
      this.dots.appendChild(hit);
      this.dots.appendChild(draw);
    }
  }
  clearDots() {
    this.dots.style.display = `none`;
    emptyEl(this.dots);
  }
  /* ---------- 递增/递减选择框 ---------- */
  openMenu() {
    const m = this.menuState;
    if (!m)
      return;
    emptyEl(this.menu);
    const btnAsc = createEl("button");
    btnAsc.className = "vt-fill-menu-btn";
    btnAsc.textContent = t("\u9012\u589E", "Inc");
    btnAsc.addEventListener("click", () => this.applyMenu(1));
    const btnDesc = createEl("button");
    btnDesc.className = "vt-fill-menu-btn";
    btnDesc.textContent = t("\u9012\u51CF", "Dec");
    btnDesc.addEventListener("click", () => this.applyMenu(-1));
    this.menu.appendChild(btnAsc);
    this.menu.appendChild(btnDesc);
    this.placeMenu();
    this.menu.style.transition = `none`;
    this.menu.style.visibility = `hidden`;
    this.menu.style.display = `flex`;
    this.menu.style.transform = `scale(0.8) translateY(6px)`;
    this.menu.style.opacity = `0.7`;
    void this.menu.offsetWidth;
    this.menu.style.visibility = `visible`;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!this.menuState)
          return;
        this.menu.style.transition = ``;
        this.menu.style.transform = `scale(1) translateY(0)`;
        this.menu.style.opacity = `1`;
      });
    });
    this.refreshMenuHighlight();
  }
  placeMenu() {
    const m = this.menuState;
    if (!m)
      return;
    const rect = m.anchorRect;
    const wasDisplay = this.menu.style.display;
    if (wasDisplay === "none") {
      this.menu.style.display = `flex`;
      this.menu.style.visibility = `hidden`;
    }
    const mw = this.menu.offsetWidth;
    const mh = this.menu.offsetHeight;
    if (wasDisplay === "none") {
      this.menu.style.display = `none`;
      this.menu.style.visibility = ``;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right - mw;
    left = Math.max(8, Math.min(left, vw - mw - 8));
    let top = rect.bottom + 6;
    if (top + mh > vh - 8)
      top = rect.top - mh - 6;
    top = Math.max(8, top);
    this.menu.style.left = `${Math.round(left)}px`;
    this.menu.style.top = `${Math.round(top)}px`;
  }
  refreshMenuHighlight() {
    const m = this.menuState;
    if (!m)
      return;
    const btns = this.menu.querySelectorAll(".vt-fill-menu-btn");
    btns[0]?.classList.toggle("vt-fill-on", m.sign === 1);
    btns[1]?.classList.toggle("vt-fill-on", m.sign === -1);
  }
  applyMenu(sign) {
    const m = this.menuState;
    if (!m)
      return;
    m.sign = sign;
    const vals = genSeries(m.v0, m.cells.length - 1, sign);
    const writes = [];
    for (let i = 1; i < m.cells.length; i++) {
      const cell2 = m.cells[i];
      if (!this.deps.cellVisible(cell2.r, cell2.c))
        continue;
      writes.push({ r: cell2.r, c: cell2.c, v: vals[i - 1] });
    }
    if (writes.length)
      this.deps.applyFill(writes, { r: m.cells[0].r, c: m.cells[0].c });
    this.refreshMenuHighlight();
  }
  closeMenu() {
    if (!this.menuState)
      return;
    this.menuState = null;
    this.menu.style.display = `none`;
    emptyEl(this.menu);
  }
};

// src/diag.ts
var SVG_NS2 = "http://www.w3.org/2000/svg";
function isDiag(cd) {
  return !!cd && cd.dg !== void 0;
}
function diagPlainText(html) {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n+/g, " ").trim();
}
function diagDisplayText(v) {
  if (!v.includes("<") && !v.includes("\n"))
    return v;
  return diagPlainText(v);
}
function buildDiagDom(td, dg, t2) {
  td.classList.add("vt-diag");
  td.contentEditable = "false";
  td.tabIndex = 0;
  const svg = document.createElementNS(SVG_NS2, "svg");
  svg.setAttribute("class", "vt-diag-line");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(SVG_NS2, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "100%");
  line.setAttribute("y2", "100%");
  svg.appendChild(line);
  td.appendChild(svg);
  const zoneA = createDiv();
  zoneA.className = "vt-diag-zone vt-diag-a";
  zoneA.contentEditable = "true";
  const zoneB = createDiv();
  zoneB.className = "vt-diag-zone vt-diag-b";
  zoneB.contentEditable = "true";
  td.appendChild(zoneA);
  td.appendChild(zoneB);
  const probe = createDiv();
  probe.className = "vt-diag-probe";
  const probeA = createSpan();
  const probeB = createSpan();
  probe.appendChild(probeA);
  probe.appendChild(probeB);
  td.appendChild(probe);
  syncDiagText({ zoneA, zoneB, probeA, probeB }, dg, t2);
  return { zoneA, zoneB, probeA, probeB };
}
function syncDiagText(dom, dg, t2) {
  const a = diagDisplayText(dg);
  const b = diagDisplayText(t2);
  dom.zoneA.textContent = a;
  dom.zoneB.textContent = b;
  dom.probeA.textContent = a;
  dom.probeB.textContent = b;
}
function pointInZoneA(td, clientX, clientY) {
  const rect = td.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (rect.width <= 0 || rect.height <= 0)
    return false;
  return y * rect.width < x * rect.height;
}
var ZONE_SEL = ".vt-diag-zone";
function bindDiagTd(td, handlers) {
  td.addEventListener("focusin", (e) => {
    const zone = e.target;
    if (!zone.matches?.(ZONE_SEL))
      return;
    handlers.onZoneFocus(zone);
  });
  td.addEventListener("input", (e) => {
    const zone = e.target;
    if (!zone.matches?.(ZONE_SEL))
      return;
    syncProbeFromZone(td, zone);
  });
  td.addEventListener("paste", (e) => {
    const zone = e.target;
    if (!zone.matches?.(ZONE_SEL))
      return;
    const clip = e.clipboardData;
    if (!clip)
      return;
    e.preventDefault();
    const text = (clip.getData("text/plain") ?? "").replace(/[\r\n]+/g, " ");
    insertPlainTextAtCaret(zone, text);
    syncProbeFromZone(td, zone);
  });
  td.addEventListener("drop", (e) => {
    const zone = e.target?.closest?.(ZONE_SEL);
    if (!zone) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const text = (e.dataTransfer?.getData("text/plain") ?? "").replace(/[\r\n]+/g, " ");
    insertPlainTextAtCaret(zone, text);
    syncProbeFromZone(td, zone);
  });
  td.addEventListener("focusout", (e) => {
    const zone = e.target;
    if (!zone.matches?.(ZONE_SEL))
      return;
    writeDiagZoneText(td, zone);
    const to = e.relatedTarget;
    if (to && td.contains(to))
      return;
    handlers.onZoneLeave();
  });
  td.addEventListener("keydown", (e) => {
    const zone = e.target;
    if (!zone.matches?.(ZONE_SEL))
      return;
    const isA = zone.classList.contains("vt-diag-a");
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (isA)
        switchZone(td, "b");
      else
        handlers.onExitCell();
      return;
    }
    if (e.isComposing)
      return;
    if (e.key === "ArrowUp" && isA) {
      e.preventDefault();
      handlers.move(-1, 0);
      return;
    }
    if (e.key === "ArrowDown" && !isA) {
      e.preventDefault();
      handlers.move(1, 0);
      return;
    }
    if (e.key === "ArrowLeft" && isA && caretAtStart(zone)) {
      e.preventDefault();
      handlers.move(0, -1);
      return;
    }
    if (e.key === "ArrowRight" && !isA && caretAtEnd(zone)) {
      e.preventDefault();
      handlers.move(0, 1);
      return;
    }
  });
}
function enterDiagZone(td, target) {
  const wantB = target ? target.classList.contains("vt-diag-b") : (td.dataset.vtDiagZone ?? "b") === "b";
  const zone = wantB ? td.querySelector(".vt-diag-b") : td.querySelector(".vt-diag-a");
  if (!zone)
    return;
  td.dataset.vtDiagZone = wantB ? "b" : "a";
  if (document.activeElement !== zone) {
    zone.focus();
  }
  placeCaretAtEnd(zone);
}
function prepareDiagEdit(td) {
  td.dataset.vtView = "edit";
  td.querySelectorAll(".vt-diag-zone").forEach((z) => {
    z.spellcheck = false;
  });
}
function exitDiagEdit(td, dg, t2) {
  td.dataset.vtView = "view";
  const dom = {
    zoneA: td.querySelector(".vt-diag-a"),
    zoneB: td.querySelector(".vt-diag-b"),
    probeA: td.querySelector(".vt-diag-probe span:nth-child(1)"),
    probeB: td.querySelector(".vt-diag-probe span:nth-child(2)")
  };
  syncDiagText(dom, dg, t2);
}
function readZoneText(zone) {
  return (zone.textContent ?? "").replace(/[\r\n]+/g, " ");
}
function syncProbeFromZone(td, zone) {
  const probe = td.querySelector(".vt-diag-probe");
  if (!probe)
    return;
  const idx = zone.classList.contains("vt-diag-a") ? 1 : 2;
  const span = probe.querySelector(`span:nth-child(${idx})`);
  if (span)
    span.textContent = readZoneText(zone);
}
function writeDiagZoneText(td, zone) {
  const text = (zone.textContent ?? "").replace(/[\r\n]+/g, " ");
  td.dataset[zone.classList.contains("vt-diag-a") ? "vtDiagA" : "vtDiagB"] = text;
}
function switchZone(td, to) {
  const from = td.querySelector(to === "b" ? ".vt-diag-a" : ".vt-diag-b");
  if (from)
    from.blur();
  const zone = td.querySelector(to === "b" ? ".vt-diag-b" : ".vt-diag-a");
  if (!zone)
    return;
  td.dataset.vtDiagZone = to;
  zone.focus();
  placeCaretAtEnd(zone);
}
function caretAtStart(zone) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed)
    return false;
  const node = sel.focusNode;
  if (node === zone)
    return (sel.focusOffset ?? 0) === 0;
  if (node?.parentElement === zone && node.nodeType === Node.TEXT_NODE)
    return (sel.focusOffset ?? 0) === 0;
  return false;
}
function caretAtEnd(zone) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed)
    return false;
  const node = sel.focusNode;
  const len = zone.textContent?.length ?? 0;
  if (node === zone)
    return (sel.focusOffset ?? 0) === len;
  if (node?.parentElement === zone && node.nodeType === Node.TEXT_NODE) {
    return (sel.focusOffset ?? 0) === (node.textContent?.length ?? 0);
  }
  return false;
}
function placeCaretAtEnd(zone) {
  const sel = window.getSelection();
  if (!sel)
    return;
  const range = document.createRange();
  range.selectNodeContents(zone);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
function insertPlainTextAtCaret(zone, text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !zone.contains(sel.focusNode)) {
    zone.appendChild(document.createTextNode(text));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// src/formula.ts
function colIndex(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++)
    n = n * 26 + col.charCodeAt(i) - 64;
  return n - 1;
}
function parseRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m)
    return null;
  return { col: colIndex(m[1]), row: parseInt(m[2]) - 1 };
}
function parseRange(range) {
  const parts = range.split(":");
  if (parts.length !== 2)
    return null;
  const a = parseRef(parts[0].trim());
  const b = parseRef(parts[1].trim());
  if (!a || !b)
    return null;
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col)
  };
}
function cellToNumber(cell2) {
  let s = cell2.t.replace(/<[^>]*>/g, "");
  s = mdInlineToHtml(s);
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function collectNums(grid, range) {
  const r = parseRange(range);
  if (!r)
    return [];
  const out = [];
  for (let row = r.r0; row <= r.r1; row++) {
    for (let col = r.c0; col <= r.c1; col++) {
      const cell2 = grid[row]?.[col];
      if (!cell2 || cell2.rs === 0 || cell2.cs === 0)
        continue;
      const n = cellToNumber(cell2);
      if (n !== null)
        out.push(n);
    }
  }
  return out;
}
var FUNCTIONS = {
  SUM(grid, args) {
    const vals = collectNums(grid, args);
    return vals.reduce((a, b) => a + b, 0).toString();
  },
  AVERAGE(grid, args) {
    const vals = collectNums(grid, args);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toString() : "0";
  },
  COUNT(grid, args) {
    return collectNums(grid, args).length.toString();
  },
  MIN(grid, args) {
    const vals = collectNums(grid, args);
    return vals.length ? Math.min(...vals).toString() : "0";
  },
  MAX(grid, args) {
    const vals = collectNums(grid, args);
    return vals.length ? Math.max(...vals).toString() : "0";
  }
};
function evalFormula(grid, text) {
  const m = text.match(/^=([A-Z]+)\((.+)\)$/i);
  if (!m)
    return text;
  const fn = FUNCTIONS[m[1].toUpperCase()];
  if (!fn)
    return text;
  try {
    return fn(grid, m[2]);
  } catch {
    return text;
  }
}

// src/html.ts
var VT_HTML_PARSER = new DOMParser();
function parseTrustedHtml(html) {
  const frag = VT_HTML_PARSER.parseFromString(html, "text/html");
  frag.body.querySelectorAll("script, iframe, object, embed").forEach((n) => n.remove());
  return frag.body;
}

// src/wysiwyg.ts
var FENCE_OPEN_RE = /^```([^\n`]*)\n?/;
var HTML_PAIR_TAGS = /* @__PURE__ */ new Set([
  "b",
  "i",
  "u",
  "s",
  "em",
  "strong",
  "mark",
  "sub",
  "sup",
  "small",
  "font",
  "span",
  "kbd",
  "del",
  "ins",
  "cite",
  "q",
  "abbr"
]);
var TRIGGER_RE = /[*`~=$[!<&_]/;
var SYNTAX_INPUT_RE = /[`*_~=$[\]!<&]/;
function parseSegments(src) {
  const segs = [];
  let pos = 0;
  let textStart = -1;
  const flushText = (upto) => {
    if (textStart >= 0 && upto > textStart) {
      segs.push({ kind: "text", raw: src.slice(textStart, upto), start: textStart, end: upto, prefix: 0, suffix: 0 });
    }
    textStart = -1;
  };
  while (pos < src.length) {
    const rest = src.slice(pos);
    const brM = /<br\s*\/?>/i.exec(rest);
    const lineRest = brM ? rest.slice(0, brM.index) : rest;
    let m;
    if (m = FENCE_OPEN_RE.exec(rest)) {
      const lang2 = (m[1] || "").trim();
      const bodyStart = pos + m[0].length;
      const closeIdx = src.indexOf("```", bodyStart);
      if (closeIdx >= 0) {
        flushText(pos);
        const end = closeIdx + 3;
        const raw = src.slice(pos, end);
        segs.push({ kind: "fence", raw, start: pos, end, prefix: m[0].length, suffix: 3, lang: lang2 });
        pos = end;
        continue;
      }
    }
    if (m = /^<br\s*\/?>/i.exec(rest)) {
      pushVoid("br", m[0]);
      continue;
    }
    if (m = /^<img\b[^>]*\/?>/i.exec(lineRest)) {
      pushVoid("void-img", m[0]);
      continue;
    }
    if (m = /^&nbsp;/i.exec(lineRest)) {
      pushVoid("void-entity", m[0]);
      continue;
    }
    if (m = /^!\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(lineRest)) {
      pushVoid("void-img", m[0]);
      continue;
    }
    if (m = /^!\[\[([^\]\n]+)\]\]/.exec(lineRest)) {
      pushVoid("void-img", m[0]);
      continue;
    }
    if (m = /^\$\$([^$\n]+?)\$\$/.exec(lineRest)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if (m = /^\$(?!\s)([^$\n]*?\S)\$/.exec(lineRest)) {
      pushMd(m[0], 1, 1);
      continue;
    }
    if (m = /^\*\*\*(?=\S)([^\n]*?\S)\*\*\*/.exec(lineRest)) {
      pushMd(m[0], 3, 3);
      continue;
    }
    if ((m = /^___(?=\S)([^\n]*?\S)___/.exec(lineRest)) && wordOk(pos, m[0].length)) {
      pushMd(m[0], 3, 3);
      continue;
    }
    if (m = /^\*\*(?=\S)([^\n]*?\S)\*\*/.exec(lineRest)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if ((m = /^__(?!_)(?=\S)([^\n]*?\S)__(?!\w)/.exec(lineRest)) && wordOk(pos, m[0].length)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if (m = /^\*(?=\S)([^\n]*?\S)\*/.exec(lineRest)) {
      pushMd(m[0], 1, 1);
      continue;
    }
    if ((m = /^_(?=\S)([^\n]*?\S)_(?!\w)/.exec(lineRest)) && wordOk(pos, m[0].length)) {
      pushMd(m[0], 1, 1);
      continue;
    }
    if (m = /^==(?=\S)([^\n]*?\S)==/.exec(lineRest)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if (m = /^~~(?=\S)([^\n]*?\S)~~/.exec(lineRest)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if (m = /^`([^`\n]+)`/.exec(lineRest)) {
      pushMd(m[0], 1, 1);
      continue;
    }
    if (m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(lineRest)) {
      pushMd(m[0], 1, 1);
      continue;
    }
    if (m = /^\[\[([^\]\n]+)\]\]/.exec(lineRest)) {
      pushMd(m[0], 2, 2);
      continue;
    }
    if ((m = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/.exec(lineRest)) && HTML_PAIR_TAGS.has(m[1].toLowerCase())) {
      const tag = m[1];
      const closeIdx = lineRest.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, m[0].length);
      if (closeIdx > m[0].length) {
        const closeLen = tag.length + 3;
        pushMd(lineRest.slice(0, closeIdx + closeLen), m[0].length, closeLen);
        continue;
      }
    }
    if (textStart < 0)
      textStart = pos;
    const restStr = src.slice(pos + 1);
    const nextIdx = restStr.search(TRIGGER_RE);
    pos = nextIdx >= 0 ? pos + 1 + nextIdx : src.length;
  }
  flushText(src.length);
  return segs;
  function wordOk(start, len) {
    const before = start > 0 ? src[start - 1] : "";
    const after = src[start + len] ?? "";
    const isW = (ch) => /\w/.test(ch);
    return !isW(before) && !isW(after);
  }
  function pushVoid(kind, raw) {
    flushText(pos);
    segs.push({ kind, raw, start: pos, end: pos + raw.length, prefix: 0, suffix: 0 });
    pos += raw.length;
  }
  function pushMd(raw, prefix, suffix) {
    flushText(pos);
    segs.push({ kind: "md", raw, start: pos, end: pos + raw.length, prefix, suffix });
    pos += raw.length;
  }
}
var SEG_CLS = "vt-seg";
function isWysiwyg(td) {
  return td.dataset.vtWysiwyg === "1";
}
function enterWysiwyg(td, src, ctx) {
  td.dataset.vtWysiwyg = "1";
  td.textContent = "";
  for (const seg of parseSegments(src)) {
    td.appendChild(buildSegEl(seg, ctx));
  }
  if (td.lastChild != null && td.lastChild.instanceOf(HTMLBRElement)) {
    const tail = createSpan();
    tail.className = SEG_CLS;
    tail.dataset.kind = "text";
    tail.dataset.view = "src";
    tail.dataset.src = "";
    tail.dataset.s = String(src.length);
    tail.dataset.e = String(src.length);
    tail.dataset.prefix = "0";
    tail.dataset.suffix = "0";
    tail.textContent = "\xA0";
    td.appendChild(tail);
  }
}
function exitWysiwyg(td) {
  delete td.dataset.vtWysiwyg;
}
function buildSegEl(seg, ctx) {
  if (seg.kind === "br") {
    const br = createEl("br");
    br.dataset.vtBr = "1";
    return br;
  }
  const el = createSpan();
  el.className = SEG_CLS;
  if (seg.kind === "fence")
    el.style.display = `block`;
  el.dataset.kind = seg.kind;
  el.dataset.src = seg.raw;
  el.dataset.s = String(seg.start);
  el.dataset.e = String(seg.end);
  el.dataset.prefix = String(seg.prefix);
  el.dataset.suffix = String(seg.suffix);
  if (seg.kind === "text") {
    el.dataset.view = "src";
    el.textContent = seg.raw;
  } else {
    renderSegContent(el, seg, ctx);
  }
  return el;
}
function attachImgResize(seg) {
  const raw = seg.dataset.src ?? "";
  if (!/^!\[\[[^\]\n]+\]\]$/.test(raw))
    return;
  const img = seg.querySelector("img");
  if (!img)
    return;
  seg.classList.add("vt-img-seg");
  const grip = createDiv();
  grip.className = "vt-img-resize";
  grip.setAttribute("aria-hidden", "true");
  const svg = createSvg("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = createSvg("path");
  path.setAttribute("d", "M17 5 L17 17 L5 17");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.75");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  grip.appendChild(svg);
  seg.appendChild(grip);
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const onMove = (ev) => {
      const w = Math.max(24, Math.round(startW + (ev.clientX - startX)));
      img.style.width = `${w}px`;
      syncImgSrcWidth(seg, w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}
function syncImgSrcWidth(seg, w) {
  const raw = seg.dataset.src ?? "";
  let next;
  if (/\|\s*\d+\s*\]\]$/.test(raw))
    next = raw.replace(/\|(\s*)\d+(\s*\]\])$/, `|$1${w}$2`);
  else if (/\|[^\]]*\]\]$/.test(raw))
    next = raw.replace(/\]\]$/, `|${w}]]`);
  else
    next = raw.replace(/\]\]$/, ` | ${w}]]`);
  seg.dataset.src = next;
}
function renderSegContent(el, seg, ctx) {
  el.dataset.view = "render";
  el.dataset.src = seg.raw;
  switch (seg.kind) {
    case "void-entity":
      el.textContent = "\xA0";
      break;
    case "void-img":
      el.replaceChildren(...parseTrustedHtml(seg.raw).childNodes);
      ctx.renderPasses(el, ctx);
      attachImgResize(el);
      break;
    case "fence": {
      const body = seg.raw.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "");
      const pre = el.createEl("pre", { cls: "vt-code" });
      pre.createEl("code", { text: body });
      break;
    }
    default: {
      el.replaceChildren(...parseTrustedHtml(seg.raw).childNodes);
      ctx.renderPasses(el, ctx);
    }
  }
}
function setSegSource(el, raw) {
  el.dataset.view = "src";
  el.dataset.src = raw;
  el.textContent = raw;
}
function projectSource(td) {
  let out = "";
  for (const child of Array.from(td.childNodes)) {
    if (!(child != null && child.instanceOf(HTMLElement)) || !child.classList.contains(SEG_CLS)) {
      out += looseNodeSource(child);
      continue;
    }
    if (child.dataset.view === "src")
      out += srcTextOf(child);
    else
      out += child.dataset.src ?? child.textContent ?? "";
  }
  return out;
}
function atTailAnchor(td, off) {
  const last = td.lastChild;
  if (!(last != null && last.instanceOf(HTMLElement)) || last.dataset.src !== "" || !last.classList.contains(SEG_CLS))
    return false;
  return parseInt(last.dataset.s ?? "-1", 10) === off;
}
function looseNodeSource(n) {
  if (n.nodeType === Node.TEXT_NODE)
    return n.textContent ?? "";
  if (n != null && n.instanceOf(HTMLBRElement))
    return "<br>";
  if (n != null && n.instanceOf(HTMLElement)) {
    const isBlock = /^(DIV|P|LI|UL|OL|H[1-6])$/i.test(n.tagName);
    const inner = Array.from(n.childNodes).map(looseNodeSource).join("");
    return isBlock ? "<br>" + inner : inner;
  }
  return n.textContent ?? "";
}
function srcTextOf(el) {
  const isAnchor = el.dataset.src === "";
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE)
      out += n.textContent ?? "";
    else if (n != null && n.instanceOf(HTMLBRElement))
      out += "<br>";
    else if (n != null && n.instanceOf(HTMLElement) && /^(DIV|P|LI|UL|OL|H[1-6])$/i.test(n.tagName)) {
      out += "<br>" + Array.from(n.childNodes).map(looseNodeSource).join("");
    } else
      out += n.textContent ?? "";
  }
  return isAnchor ? out.replace(/[\u200B\u00A0]/g, "") : out;
}
function segEls(td) {
  return Array.from(td.children).filter(
    (c) => c != null && c.instanceOf(HTMLElement) && c.classList.contains(SEG_CLS)
  );
}
function locateStart(td, range) {
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    const host2 = node.parentElement?.closest(`.${SEG_CLS}`);
    if (host2 != null && host2.instanceOf(HTMLElement) && td.contains(host2)) {
      const f = textOffsetWithin(host2, node, offset);
      return { el: host2, kind: host2.dataset.kind ?? "text", where: "inner", innerF: f };
    }
    return { el: null, kind: null, where: "inner", innerF: 0 };
  }
  if (node === td) {
    const childNodes = Array.from(td.childNodes);
    const next = childNodes[offset] != null && childNodes[offset].instanceOf(HTMLElement) && childNodes[offset].classList.contains(SEG_CLS) ? childNodes[offset] : null;
    const prev = offset > 0 && (childNodes[offset - 1] != null && childNodes[offset - 1].instanceOf(HTMLElement)) && childNodes[offset - 1].classList.contains(SEG_CLS) ? childNodes[offset - 1] : null;
    const isRenderable = (el) => el.dataset.view !== "src" && el.dataset.kind !== "text";
    if (next && isRenderable(next))
      return { el: next, kind: next.dataset.kind, where: "front", innerF: 0 };
    if (prev && isRenderable(prev))
      return { el: prev, kind: prev.dataset.kind, where: "back", innerF: 0 };
    if (next)
      return { el: next, kind: next.dataset.kind, where: "front", innerF: 0 };
    if (prev)
      return { el: prev, kind: prev.dataset.kind, where: "back", innerF: 0 };
    return { el: null, kind: null, where: "inner", innerF: 0 };
  }
  const host = (node != null && node.instanceOf(HTMLElement) ? node : node.parentElement)?.closest(`.${SEG_CLS}`);
  if (host != null && host.instanceOf(HTMLElement) && td.contains(host)) {
    const elChildren = Array.from(host.childNodes);
    const nextInSeg = elChildren[offset];
    const prevInSeg = offset > 0 ? elChildren[offset - 1] : null;
    if (isVoidRenderEl(nextInSeg))
      return { el: host, kind: host.dataset.kind, where: "front", innerF: 0 };
    if (isVoidRenderEl(prevInSeg))
      return { el: host, kind: host.dataset.kind, where: "back", innerF: 0 };
    if (host.dataset.view === "src") {
      const f2 = srcOffsetWithin(host, node, offset);
      return { el: host, kind: host.dataset.kind, where: "inner", innerF: f2 };
    }
    const f = textOffsetWithin(host, node, offset);
    return { el: host, kind: host.dataset.kind, where: "inner", innerF: f };
  }
  return { el: null, kind: null, where: "inner", innerF: 0 };
}
function isVoidRenderEl(n) {
  if (!(n != null && n.instanceOf(HTMLElement)))
    return false;
  if (n != null && n.instanceOf(HTMLBRElement))
    return true;
  if (n != null && n.instanceOf(HTMLImageElement))
    return true;
  return n.classList.contains(SEG_CLS) && n.dataset.view === "render" && (n.dataset.kind ?? "").startsWith("void");
}
function textOffsetWithin(el, target, offset) {
  let acc = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while (n = walker.nextNode()) {
    if (n === target)
      return acc + offset;
    acc += n.textContent?.length ?? 0;
  }
  return acc;
}
function srcOffsetWithin(el, target, offset) {
  let acc = 0;
  for (const n of Array.from(el.childNodes)) {
    if (n === target) {
      if (n.nodeType === Node.TEXT_NODE)
        return acc + offset;
      if (n != null && n.instanceOf(HTMLBRElement))
        return acc + (offset > 0 ? 4 : 0);
      return acc + Math.min(offset, n.textContent?.length ?? 0);
    }
    if (n.nodeType === Node.TEXT_NODE)
      acc += n.textContent?.length ?? 0;
    else if (n != null && n.instanceOf(HTMLBRElement))
      acc += 4;
    else
      acc += n.textContent?.length ?? 0;
  }
  return acc;
}
function looseOffsetAt(td, idx) {
  let acc = 0;
  const childNodes = Array.from(td.childNodes);
  for (let i = 0; i < childNodes.length; i++) {
    if (i === idx)
      break;
    const n = childNodes[i];
    if (n != null && n.instanceOf(HTMLElement) && n.classList.contains(SEG_CLS))
      acc = parseInt(n.dataset.e ?? "0", 10);
    else if (n != null && n.instanceOf(HTMLBRElement))
      acc += 4;
    else
      acc += n.textContent?.length ?? 0;
  }
  return acc;
}
function caretSourceOffset(td) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !td.contains(range.startContainer))
    return null;
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentElement === td) {
    const tn = range.startContainer;
    let acc0 = 0;
    for (const n of Array.from(td.childNodes)) {
      if (n === tn) {
        acc0 += range.startOffset;
        break;
      }
      if (n != null && n.instanceOf(HTMLElement) && n.classList.contains(SEG_CLS))
        acc0 = parseInt(n.dataset.e ?? "0", 10);
      else if (n != null && n.instanceOf(HTMLBRElement))
        acc0 += 4;
      else
        acc0 += n.textContent?.length ?? 0;
    }
    return acc0;
  }
  const loc = locateStart(td, range);
  if (!loc.el) {
    const childNodes = Array.from(td.childNodes);
    const idx = range.startOffset;
    let acc = 0;
    for (let i = 0; i < childNodes.length; i++) {
      const n = childNodes[i];
      if (i === idx)
        break;
      if (n != null && n.instanceOf(HTMLElement) && n.classList.contains(SEG_CLS))
        acc = parseInt(n.dataset.e ?? "0", 10);
      else if (n != null && n.instanceOf(HTMLBRElement))
        acc += 4;
      else
        acc += n.textContent?.length ?? 0;
    }
    return acc;
  }
  const s = parseInt(loc.el.dataset.s ?? "0", 10);
  if (loc.el.dataset.view === "src") {
    if (loc.el.dataset.src === "" && loc.el.classList.contains(SEG_CLS))
      return s;
    if (loc.where === "front")
      return s;
    if (loc.where === "back")
      return s + loc.innerF;
    return s + loc.innerF;
  }
  const raw = loc.el.dataset.src ?? "";
  if (loc.where === "back") {
    const idx = Array.from(td.childNodes).indexOf(loc.el) + 1;
    return looseOffsetAt(td, idx);
  }
  if (loc.where === "front")
    return s + segPrefix(loc.el);
  const prefix = segPrefix(loc.el);
  const contentLen = Math.max(0, raw.length - prefix - segSuffix(loc.el));
  return s + prefix + Math.min(loc.innerF, contentLen);
}
function segPrefix(el) {
  return parseInt(el.dataset.prefix ?? "0", 10) || 0;
}
function segSuffix(el) {
  return parseInt(el.dataset.suffix ?? "0", 10) || 0;
}
function totalLen(td) {
  const segs = segEls(td);
  return segs.length ? parseInt(segs[segs.length - 1].dataset.e ?? "0", 10) : 0;
}
function selectionSourceRange(td) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !td.contains(range.startContainer) || !td.contains(range.endContainer))
    return null;
  const a = rangeOffset(td, range.startContainer, range.startOffset);
  const b = rangeOffset(td, range.endContainer, range.endOffset);
  if (a == null || b == null)
    return null;
  return { a: Math.min(a, b), b: Math.max(a, b) };
}
function rangeOffset(td, node, offset) {
  const tmp = document.createRange();
  try {
    tmp.selectNodeContents(td);
  } catch {
    return null;
  }
  try {
    tmp.setEnd(node, offset);
    tmp.collapse(false);
  } catch {
    return null;
  }
  const host = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node != null && node.instanceOf(HTMLElement) ? node : node.parentElement)?.closest(`.${SEG_CLS}`);
  if (host != null && host.instanceOf(HTMLElement) && td.contains(host)) {
    const s = parseInt(host.dataset.s ?? "0", 10);
    if (host.dataset.view === "src")
      return s + srcOffsetWithin(host, node, offset);
    const f = textOffsetWithin(host, node, offset);
    const raw = host.dataset.src ?? "";
    const prefix = segPrefix(host);
    const contentLen = Math.max(0, raw.length - prefix - segSuffix(host));
    return s + prefix + Math.min(f, contentLen);
  }
  if (node === td) {
    const childNodes = Array.from(td.childNodes);
    const next = childNodes[offset];
    if (next != null && next.instanceOf(HTMLElement) && next.classList.contains(SEG_CLS))
      return parseInt(next.dataset.s ?? "0", 10);
    const prev = offset > 0 ? childNodes[offset - 1] : null;
    if (prev != null && prev.instanceOf(HTMLElement) && prev.classList.contains(SEG_CLS))
      return parseInt(prev.dataset.e ?? "0", 10);
    return offset <= 0 ? 0 : totalLen(td);
  }
  return null;
}
function placeCaretAtSourceOffset(td, off) {
  const segs = segEls(td);
  const sel = window.getSelection();
  if (!sel)
    return;
  const range = document.createRange();
  if (!segs.length) {
    range.selectNodeContents(td);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  {
    const nodes = Array.from(td.childNodes);
    let acc = 0;
    for (const n of nodes) {
      if (n != null && n.instanceOf(HTMLBRElement)) {
        const brS = acc;
        const brE = acc + 4;
        if (off <= brE) {
          try {
            if (off <= brS) {
              range.setStartBefore(n);
            } else {
              range.setStartAfter(n);
            }
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          } catch {
          }
        }
        acc = brE;
        continue;
      }
      if (n != null && n.instanceOf(HTMLElement) && n.classList.contains(SEG_CLS)) {
        const e2 = parseInt(n.dataset.e ?? "0", 10);
        const s2 = parseInt(n.dataset.s ?? "0", 10);
        if (off < s2 && off <= acc) {
          try {
            range.setStart(n);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          } catch {
          }
        }
        if (off > acc && off < e2)
          break;
        acc = Math.max(acc, e2);
        continue;
      }
      const len = n.textContent?.length ?? 0;
      if (off < acc + len) {
        try {
          range.setStart(n.firstChild ?? n, off - acc);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        } catch {
        }
      }
      acc += len;
    }
  }
  for (const el of segs) {
    const s = parseInt(el.dataset.s ?? "0", 10);
    const e = parseInt(el.dataset.e ?? "0", 10);
    if (off < s || off === s && false)
      continue;
    if (off <= e || el === segs[segs.length - 1]) {
      const local = Math.max(0, Math.min(off - s, e - s));
      if (el.dataset.view === "src") {
        const pos = srcDomPos(el, local);
        if (pos) {
          try {
            range.setStart(pos.node, pos.offset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          } catch {
          }
        }
      }
      try {
        if (local <= 0) {
          range.setStartBefore(el);
        } else {
          range.setStartAfter(el);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      } catch {
      }
    }
  }
  range.selectNodeContents(td);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
function srcDomPos(el, local) {
  let acc = 0;
  for (const n of Array.from(el.childNodes)) {
    const len = n.nodeType === Node.TEXT_NODE ? n.textContent?.length ?? 0 : n != null && n.instanceOf(HTMLBRElement) ? 4 : n.textContent?.length ?? 0;
    if (acc + len >= local) {
      if (n.nodeType === Node.TEXT_NODE)
        return { node: n, offset: local - acc };
      return { node: n, offset: 0 };
    }
    acc += len;
  }
  const last = el.lastChild;
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : null;
}
function setRangeAtSourceOffsets(td, a, b) {
  placeCaretAtSourceOffset(td, a);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return;
  const anchor = sel.getRangeAt(0).cloneRange();
  const segs = segEls(td);
  const focusRange = document.createRange();
  placeCaretInto(focusRange, td, b);
  try {
    const r = document.createRange();
    r.setStart(anchor.startContainer, anchor.startOffset);
    const fr = document.createRange();
    placeCaretInto(fr, td, b);
    r.setEnd(fr.startContainer, fr.startOffset);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {
  }
}
function placeCaretInto(range, td, off) {
  const segs = segEls(td);
  if (!segs.length) {
    range.selectNodeContents(td);
    range.collapse(false);
    return;
  }
  for (const el of segs) {
    const s = parseInt(el.dataset.s ?? "0", 10);
    const e = parseInt(el.dataset.e ?? "0", 10);
    if (off <= e || el === segs[segs.length - 1]) {
      const local = Math.max(0, Math.min(off - s, e - s));
      if (el.dataset.view === "src") {
        const pos = srcDomPos(el, local);
        if (pos) {
          range.setStart(pos.node, pos.offset);
          range.collapse(true);
          return;
        }
      }
      if (local <= 0)
        range.setStartBefore(el);
      else
        range.setStartAfter(el);
      range.collapse(true);
      return;
    }
  }
  range.selectNodeContents(td);
  range.collapse(false);
}
var tdStates = /* @__PURE__ */ new WeakMap();
var selectionHookInstalled = false;
function attachWysiwyg(td, ctx) {
  if (tdStates.has(td))
    return;
  const st = { ctx, composing: false, suppress: false, editing: false, lastSrcSeg: null, lastCaret: 0, lastLoc: null };
  tdStates.set(td, st);
  td.addEventListener("compositionstart", () => {
    st.composing = true;
    if (st.compTimer)
      window.clearTimeout(st.compTimer);
    st.compTimer = window.setTimeout(() => {
      st.composing = false;
      st.compTimer = null;
    }, 3e3);
  });
  td.addEventListener("compositionupdate", () => {
    if (st.compTimer)
      window.clearTimeout(st.compTimer);
    st.compTimer = window.setTimeout(() => {
      st.composing = false;
      st.compTimer = null;
    }, 3e3);
  });
  td.addEventListener("compositionend", (e) => {
    st.composing = false;
    if (st.compTimer) {
      window.clearTimeout(st.compTimer);
      st.compTimer = null;
    }
    if (e.data === "\uFF1A") {
      const fixColonCaret = () => {
        if (!isWysiwyg(td) || st.composing)
          return;
        if (document.activeElement !== td)
          return;
        const off = caretSourceOffset(td);
        if (off == null)
          return;
        const src = projectSource(td);
        if (src[off] === ":")
          placeSuppressed(td, st, off + 1);
      };
      window.setTimeout(fixColonCaret, 60);
      window.setTimeout(fixColonCaret, 300);
      window.setTimeout(fixColonCaret, 800);
    }
    scheduleRebuild(td, st, false);
  });
  const healStuckComposing = (ie) => {
    if (!st.composing)
      return false;
    if (ie.inputType === "insertCompositionText" || ie.inputType === "deleteCompositionText" || ie.inputType === "insertFromComposition")
      return false;
    st.composing = false;
    scheduleRebuild(td, st);
    return true;
  };
  td.addEventListener("keydown", (e) => {
    if (!isWysiwyg(td) || st.editing)
      return;
    if (e.key === "Backspace" || e.key === "Delete") {
      const off = caretSourceOffset(td) ?? st.lastCaret;
      st.delHasText = segHasText(projectSource(td), off);
    }
  });
  td.addEventListener("beforeinput", (e) => {
    if (!isWysiwyg(td))
      return;
    const ie = e;
    if (st.composing) {
      healStuckComposing(ie);
      if (st.composing)
        return;
    }
    if (ie.inputType === "insertText" && ie.data) {
      const offTail = caretSourceOffset(td);
      if (offTail != null && atTailAnchor(td, offTail)) {
        e.preventDefault();
        programEdit(td, st, offTail, offTail, ie.data.replace(/\r?\n/g, "<br>"));
        return;
      }
      if (ie.data.includes("\n")) {
        e.preventDefault();
        const offNL = caretSourceOffset(td) ?? st.lastCaret;
        if (offNL >= 0)
          programEdit(td, st, offNL, offNL, ie.data.replace(/\r?\n/g, "<br>"));
        return;
      }
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range0 = sel.getRangeAt(0);
        const loc = locateStart(td, range0);
        if (loc.el && loc.el.dataset.view === "render" && loc.kind !== "text") {
          e.preventDefault();
          const s = parseInt(loc.el.dataset.s ?? "0", 10);
          let off;
          if (loc.where === "front" || loc.where === "back") {
            const idx = range0.startContainer === td ? range0.startOffset : Array.from(td.childNodes).indexOf(loc.el) + 1;
            off = looseOffsetAt(td, idx);
          } else {
            const ee = parseInt(loc.el.dataset.e ?? "0", 10);
            const pl = segPrefix(loc.el);
            off = s + pl + Math.min(loc.innerF, Math.max(0, ee - s - pl - segSuffix(loc.el)));
          }
          programEdit(td, st, off, off, ie.data);
        }
      }
    } else if (ie.inputType === "insertFromDrop") {
      e.preventDefault();
      const text = ie.dataTransfer?.getData("text/plain") ?? "";
      if (text)
        programEdit(td, st, null, null, text);
    } else if (ie.inputType === "deleteContentBackward" || ie.inputType === "deleteContentForward") {
      if (window.getSelection()?.rangeCount) {
        const locD = locateStart(td, window.getSelection().getRangeAt(0));
        if (locD.el && locD.el.dataset.view === "render" && locD.kind !== "text") {
          const sD = parseInt(locD.el.dataset.s ?? "0", 10);
          const eD = parseInt(locD.el.dataset.e ?? "0", 10);
          if (ie.inputType === "deleteContentBackward" && locD.where === "back" && eD > sD) {
            e.preventDefault();
            programEdit(td, st, eD - 1, eD, "");
            return;
          }
          if (ie.inputType === "deleteContentForward" && locD.where === "front" && eD > sD) {
            e.preventDefault();
            programEdit(td, st, sD, sD + 1, "");
            return;
          }
        }
      }
    }
  });
  td.addEventListener("input", (e) => {
    if (!isWysiwyg(td))
      return;
    const ie = e;
    if (st.composing) {
      healStuckComposing(ie);
      if (st.composing) {
        if ((ie.inputType ?? "").startsWith("delete"))
          pendingCollapse = "del";
        const offNow = caretSourceOffset(td);
        if (offNow != null)
          st.lastCaret = offNow;
        return;
      }
    }
    if (ie.inputType === "insertText" && ie.data) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const hostEl = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer;
        const hostSeg = hostEl?.closest?.(`.${SEG_CLS}`);
        if (hostSeg && hostSeg.dataset.view === "render" && hostSeg.dataset.kind !== "text" && td.contains(hostSeg)) {
          const len = ie.data.length;
          if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset >= len) {
            const del = document.createRange();
            del.setStart(r.startContainer, r.startOffset - len);
            del.setEnd(r.startContainer, r.startOffset);
            del.deleteContents();
          } else if (r.startContainer.nodeType === Node.TEXT_NODE) {
            const t2 = r.startContainer;
            t2.textContent = (t2.textContent?.slice(0, r.startOffset) ?? "") + (t2.textContent?.slice(r.startOffset + len) ?? "");
          } else {
            renderSegContent(hostSeg, {
              kind: hostSeg.dataset.kind,
              raw: hostSeg.dataset.src ?? "",
              start: parseInt(hostSeg.dataset.s ?? "0", 10),
              end: parseInt(hostSeg.dataset.e ?? "0", 10),
              prefix: segPrefix(hostSeg),
              suffix: segSuffix(hostSeg)
            }, st.ctx);
          }
          const s2 = parseInt(hostSeg.dataset.s ?? "0", 10);
          const ee = parseInt(hostSeg.dataset.e ?? "0", 10);
          const pre = st.lastLoc && st.lastLoc.el === hostSeg ? st.lastLoc.where : "inner";
          let off2;
          if (pre === "front" || pre === "back") {
            const idx = r.startContainer === td ? r.startOffset : Array.from(td.childNodes).indexOf(hostSeg) + 1;
            off2 = looseOffsetAt(td, idx);
          } else {
            const pl = segPrefix(hostSeg);
            const innerF = st.lastLoc && st.lastLoc.el === hostSeg ? st.lastLoc.innerF : 0;
            off2 = s2 + pl + Math.min(innerF, Math.max(0, ee - s2 - pl - segSuffix(hostSeg)));
          }
          programEdit(td, st, off2, off2, ie.data);
          return;
        }
      }
      if (ie.data.includes("\n")) {
        scheduleRebuild(td, st);
        return;
      }
      if (SYNTAX_INPUT_RE.test(ie.data)) {
        scheduleRebuild(td, st);
        return;
      }
      const off = caretSourceOffset(td);
      if (off == null) {
        scheduleRebuild(td, st);
        return;
      }
      const seg = segAtOffset(td, off);
      if (!seg) {
        scheduleRebuild(td, st);
        return;
      }
      const s = parseInt(seg.dataset.s ?? "0", 10);
      const e2 = parseInt(seg.dataset.e ?? "0", 10);
      if (off <= s || off >= e2)
        scheduleRebuild(td, st);
      return;
    }
    if (ie.inputType === "historyUndo" || ie.inputType === "historyRedo") {
      scheduleRebuild(td, st);
      return;
    }
    if (ie.inputType === "deleteContentBackward" || ie.inputType === "deleteContentForward" || ie.inputType === "deleteByCut") {
      if (ie.inputType === "deleteContentBackward") {
        const offBk = caretSourceOffset(td);
        if (offBk != null && offBk >= 4 && atTailAnchor(td, offBk)) {
          e.preventDefault();
          programEdit(td, st, offBk - 4, offBk, "");
          return;
        }
      }
      if (st.delHasText || ie.inputType === "deleteByCut" || ie.inputType === "deleteByDrag") {
        pendingCollapse = "del";
        st.delHasText = false;
      }
      if (ie.inputType === "deleteContentBackward") {
        const selBk = window.getSelection();
        if (selBk && selBk.rangeCount) {
          const locBk = locateStart(td, selBk.getRangeAt(0));
          if (locBk.el && locBk.el.dataset.view === "render" && locBk.where === "inner" && locBk.innerF > 0 && locBk.innerF >= (locBk.el.textContent ?? "").replace(/\n/g, "").length) {
            scheduleRebuild(td, st, false, parseInt(locBk.el.dataset.e ?? "0", 10));
            return;
          }
        }
      }
      scheduleRebuild(td, st);
      return;
    }
    if (ie.inputType === "insertParagraph" || ie.inputType === "insertLineBreak") {
      const off = st.lastCaret;
      {
        const sel0 = window.getSelection();
        if (sel0 && sel0.rangeCount) {
          const loc0 = locateStart(td, sel0.getRangeAt(0));
          if (loc0.el && loc0.el.dataset.view === "render") {
            const len = (loc0.el.textContent ?? "").replace(/\n/g, "").length;
            const edgeEnd = loc0.where === "back" || loc0.where === "inner" && loc0.innerF > 0 && loc0.innerF >= len;
            const edgeStart = loc0.where === "front" || loc0.where === "inner" && loc0.innerF <= 0;
            if (edgeEnd || edgeStart) {
              const sAt = parseInt(loc0.el.dataset.s ?? "0", 10);
              const eAt = parseInt(loc0.el.dataset.e ?? "0", 10);
              const at = edgeEnd ? eAt : sAt;
              e.preventDefault();
              programEdit(td, st, at, at, "<br>");
              return;
            }
          }
        }
      }
      const tbl = td.closest("table");
      const isHS = !!(tbl && tbl.classList.contains("vt-mode-hs"));
      if (isHS && !(off >= 0 && atTailAnchor(td, off)))
        pendingCollapse = "enter";
      scheduleRebuild(td, st, false, off >= 0 ? off + 4 : void 0);
      return;
    }
  });
  td.addEventListener("copy", (e) => handleCopyCut(td, st, e, "copy"));
  td.addEventListener("cut", (e) => handleCopyCut(td, st, e, "cut"));
  td.addEventListener("paste", (e) => {
    if (!isWysiwyg(td) || st.composing)
      return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const mdRows = ctx.onMdGridPaste ? parseMarkdownTable(text) : null;
    if (mdRows) {
      const r0 = parseInt(td.dataset.vtR ?? "-1", 10);
      const c0 = parseInt(td.dataset.vtC ?? "-1", 10);
      if (r0 >= 0 && c0 >= 0) {
        ctx.onMdGridPaste(r0, c0, mdRows);
        return;
      }
    }
    if (text)
      programEdit(td, st, null, null, text);
  }, true);
  if (!selectionHookInstalled) {
    selectionHookInstalled = true;
    document.addEventListener("selectionchange", () => {
      const active = document.activeElement;
      if (!active || !active.matches?.("td"))
        return;
      const s = tdStates.get(active);
      if (s)
        onSelectionChange(active, s);
    });
  }
}
function segAtOffset(td, off) {
  const segs = segEls(td);
  for (const el of segs) {
    const s = parseInt(el.dataset.s ?? "0", 10);
    const e = parseInt(el.dataset.e ?? "0", 10);
    if (off >= s && off <= e)
      return el;
  }
  return null;
}
function onSelectionChange(td, st) {
  if (!isWysiwyg(td) || st.composing || st.suppress)
    return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return;
  const range = sel.getRangeAt(0);
  if (!td.contains(range.startContainer) || !td.contains(range.endContainer))
    return;
  const off = caretSourceOffset(td);
  if (off != null)
    st.lastCaret = off;
  if (st.editing)
    return;
  if (!range.collapsed) {
    st.lastLoc = { el: (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)?.closest(`.${SEG_CLS}`) ?? null, where: "inner", innerF: 0 };
    revealSegmentsInRange(td, st, range);
    return;
  }
  const loc = locateStart(td, range);
  const cur = loc.el;
  if (st.lastSrcSeg && st.lastSrcSeg.isConnected && st.lastSrcSeg.dataset.view === "src") {
    if (st.lastSrcSeg !== cur) {
      st.lastSrcSeg = null;
      rebuild(td, st, off ?? st.lastCaret);
      return;
    }
    return;
  }
  if (!cur)
    return;
  st.lastSrcSeg = cur.dataset.view === "src" ? cur : null;
  if (shouldReveal(loc)) {
    revealSeg(td, st, cur, loc);
  }
  st.lastLoc = cur ? { el: cur, where: loc.where, innerF: loc.innerF } : null;
}
function shouldReveal(loc) {
  if (!loc.el || loc.kind === "text")
    return false;
  if (loc.el.dataset.view === "src")
    return false;
  if (loc.kind === "void-img" || loc.kind === "void-entity")
    return true;
  return loc.where === "inner";
}
function revealSeg(td, st, el, loc) {
  const raw = el.dataset.src ?? "";
  const s = parseInt(el.dataset.s ?? "0", 10);
  const e = parseInt(el.dataset.e ?? "0", 10);
  let target;
  if (loc.where === "front")
    target = s + segPrefix(el);
  else if (loc.where === "back")
    target = e - segSuffix(el);
  else {
    const prefix = segPrefix(el);
    const contentLen = Math.max(0, raw.length - prefix - segSuffix(el));
    if (loc.innerF <= 0)
      target = s;
    else if (loc.innerF >= contentLen)
      target = e;
    else
      target = s + prefix + loc.innerF;
  }
  setSegSource(el, raw);
  st.lastSrcSeg = el;
  placeSuppressed(td, st, target);
}
function revealSegmentsInRange(td, st, range) {
  const a = rangeOffset(td, range.startContainer, range.startOffset);
  const b = rangeOffset(td, range.endContainer, range.endOffset);
  if (a == null || b == null)
    return;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let touched = false;
  for (const el of segEls(td)) {
    const s = parseInt(el.dataset.s ?? "0", 10);
    const e = parseInt(el.dataset.e ?? "0", 10);
    if (e <= lo || s >= hi)
      continue;
    const kind = el.dataset.kind;
    if (el.dataset.view !== "src" && kind !== "text") {
      setSegSource(el, el.dataset.src ?? "");
      touched = true;
    }
  }
  if (touched) {
    st.suppress = true;
    setRangeAtSourceOffsets(td, lo, hi);
    window.setTimeout(() => {
      st.suppress = false;
    }, 0);
  }
}
function placeSuppressed(td, st, off) {
  st.suppress = true;
  placeCaretAtSourceOffset(td, off);
  st.lastCaret = off;
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const loc = locateStart(td, sel.getRangeAt(0));
    st.lastLoc = loc.el ? { el: loc.el, where: loc.where, innerF: loc.innerF } : null;
  }
  window.setTimeout(() => {
    st.suppress = false;
  }, 0);
}
var rebuildQueued = false;
var pendingCollapse = null;
function segHasText(t2, off) {
  const parts = t2.split(/<br>/i);
  let acc = 0;
  for (let i = 0; i < parts.length; i++) {
    const segEnd = acc + parts[i].length;
    if (off <= segEnd)
      return /[^\s\u00A0]/i.test(parts[i]);
    acc = segEnd + 4;
  }
  return /[^\s\u00A0]/i.test(parts[parts.length - 1]);
}
function collapseDelLight(t2, caretOff) {
  if (segHasText(t2, caretOff))
    return t2;
  if (!/[^\s\u00A0]/i.test(t2.replace(/<br>/gi, "")))
    return "";
  if (!/(<br>[\s\u00A0]*){2,}$/i.test(t2))
    return t2;
  return t2.replace(/[\s\u00A0]*<br>$/i, "");
}
function collapseEnterTail(t2) {
  if (!/(<br>[\s\u00A0]*){2,}$/i.test(t2))
    return t2;
  const rest = t2.replace(/[\s\u00A0]*<br>$/i, "");
  if (!rest || !/[^\s\u00A0]/i.test(rest.replace(/<br>/gi, "")))
    return t2;
  return rest;
}
function settleCaretAfterEdit(td, st, caretAt) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount)
    return;
  const loc = locateStart(td, sel.getRangeAt(0));
  if (loc.el && loc.el.dataset.view === "render" && loc.kind !== "text" && caretAt != null) {
    const s2 = parseInt(loc.el.dataset.s ?? "0", 10);
    const e2 = parseInt(loc.el.dataset.e ?? "0", 10);
    if (caretAt > s2 && caretAt < e2) {
      setSegSource(loc.el, loc.el.dataset.src ?? "");
      st.lastSrcSeg = loc.el;
      placeSuppressed(td, st, caretAt);
      return;
    }
  }
  if (shouldReveal(loc)) {
    revealSeg(td, st, loc.el, loc);
  } else {
    st.lastSrcSeg = loc.el && loc.el.dataset.view === "src" ? loc.el : null;
  }
}
function scheduleRebuild(td, st, trustSnapshot = true, caretOverride) {
  const snap = caretOverride ?? (trustSnapshot ? caretSourceOffset(td) ?? st.lastCaret : st.lastCaret);
  if (rebuildQueued) {
    st.queuedCaret = snap;
    return;
  }
  rebuildQueued = true;
  st.queuedCaret = snap;
  window.setTimeout(() => {
    rebuildQueued = false;
    if (!isWysiwyg(td))
      return;
    if (st.composing)
      return;
    rebuild(td, st, st.queuedCaret);
  }, 0);
}
function promoteTailNewlines(td, src) {
  if (!/\n$/.test(src))
    return src;
  const kids = Array.from(td.childNodes);
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim())
      continue;
    return n != null && n.instanceOf(HTMLElement) && n.classList.contains(SEG_CLS) && n.dataset.view === "render" ? src.replace(/\n+$/, (m) => "<br>".repeat(m.length)) : src;
  }
  return src;
}
function rebuild(td, st, caretOff) {
  if (st.editing)
    return;
  st.editing = true;
  try {
    let src = normalizeCellNewlines(promoteTailNewlines(td, projectSource(td)));
    if (pendingCollapse) {
      const mode = pendingCollapse;
      pendingCollapse = null;
      if (mode === "del")
        src = collapseDelLight(src, caretOff);
      else
        src = collapseEnterTail(src);
    }
    enterWysiwyg(td, src, st.ctx);
    placeSuppressed(td, st, Math.max(0, Math.min(caretOff, src.length)));
    settleCaretAfterEdit(td, st, st.queuedCaret);
  } finally {
    st.editing = false;
  }
}
function programEdit(td, st, delFrom, delTo, insert) {
  if (st.editing)
    return;
  st.editing = true;
  try {
    const src = projectSource(td);
    let a = delFrom ?? null;
    let b = delTo ?? null;
    if (a == null || b == null) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
        const rng = selectionSourceRange(td);
        if (rng) {
          a = rng.a;
          b = rng.b;
        }
      }
    }
    let next;
    let caret;
    if (a != null && b != null) {
      next = src.slice(0, a) + insert + src.slice(b);
      caret = a + insert.length;
    } else {
      const off = caretSourceOffset(td) ?? st.lastCaret ?? src.length;
      next = src.slice(0, off) + insert + src.slice(off);
      caret = off + insert.length;
    }
    enterWysiwyg(td, next, st.ctx);
    placeSuppressed(td, st, caret);
    settleCaretAfterEdit(td, st, caret);
  } finally {
    st.editing = false;
  }
}
function handleCopyCut(td, st, e, type) {
  if (!isWysiwyg(td) || st.composing)
    return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !td.contains(range.startContainer))
    return;
  const rng = selectionSourceRange(td);
  if (!rng)
    return;
  const src = projectSource(td);
  const text = src.slice(rng.a, rng.b);
  e.clipboardData?.setData("text/plain", text);
  e.preventDefault();
  e.stopPropagation();
  if (type === "cut")
    programEdit(td, st, rng.a, rng.b, "");
}

// src/modes.ts
var import_obsidian2 = require("obsidian");
var cornerBinds = (wrap) => wrap;
var MODE_HINTS = {
  OL: "\u539F\u59CB\u6362\u884C\u6A21\u5F0F",
  HS: "\u6A2A\u5411\u62C9\u957F\u6A21\u5F0F",
  RC: "\u81EA\u7531\u62D6\u62FD\u884C\u9AD8\u5217\u5BBD"
};
var MODE_ICONS = {
  OL: "wrap-text",
  HS: "move-horizontal",
  RC: "move"
};
var ModeSwitcher = class {
  constructor(parent) {
    this.onChange = null;
    this.el = parent.createDiv({ cls: "vt-mode-bar" });
    this.el.style.display = `none`;
    for (const mode of ["OL", "HS", "RC"]) {
      const btn = this.el.createDiv({ cls: "vt-mode-btn" });
      btn.dataset.mode = mode;
      btn.title = MODE_HINTS[mode];
      btn.setAttribute("aria-label", MODE_HINTS[mode]);
      (0, import_obsidian2.setIcon)(btn, MODE_ICONS[mode]);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        document.body.dataset.vtModeClick = "1";
        this.onChange?.(mode);
        window.setTimeout(() => {
          delete document.body.dataset.vtModeClick;
        }, 300);
      });
    }
  }
  setHandler(fn) {
    this.onChange = fn;
  }
  show(active) {
    this.el.style.display = `flex`;
    this.setActive(active);
  }
  hide() {
    this.el.style.display = `none`;
  }
  setActive(mode) {
    this.el.querySelectorAll(".vt-mode-btn").forEach((el) => {
      el.toggleClass("is-active", el.dataset.mode === mode);
    });
  }
};
function applyModeStyles(wrap, table, data, hsBar) {
  table.removeClass("vt-mode-ol", "vt-mode-hs", "vt-mode-rc");
  table.addClass(`vt-mode-${data.mode.toLowerCase()}`);
  const isHs = data.mode === "HS";
  const isRc = data.mode === "RC";
  wrap.toggleClass("vt-hs-scroll", isHs);
  wrap.toggleClass("vt-rc-scroll", isRc);
  if (hsBar) {
    if (isRc)
      hsBar.style.display = wrap.scrollWidth > wrap.clientWidth + 1 ? "block" : "none";
    else
      hsBar.style.display = isHs ? "block" : "none";
  }
  if (data.mode !== "RC") {
    table.querySelectorAll("tr, td, col").forEach((el) => {
      el.style.removeProperty("height");
      el.style.removeProperty("width");
      el.style.removeProperty("min-height");
    });
    table.querySelector("colgroup")?.remove();
    wrap.querySelector(".vt-rc-overlay")?.remove();
    return;
  }
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = table.createEl("colgroup");
    table.prepend(colgroup);
  }
  colgroup.empty();
  const cols = data.rows[0]?.length ?? 0;
  for (let c = 0; c < cols; c++) {
    const col = colgroup.createEl("col");
    const w = data.colWidths?.[c];
    if (w && w > 0)
      col.style.width = `${w}px`;
    else
      col.style.width = `120px`;
  }
  table.querySelectorAll("tr").forEach((tr, r) => {
    const h = data.rowHeights?.[r];
    if (h && h > 0)
      tr.style.height = `${h}px`;
    else
      tr.style.removeProperty("height");
  });
  table.querySelectorAll("td").forEach((td) => {
    const rh = data.rowHeights?.[parseInt(td.dataset.vtR ?? "-1", 10)];
    if (rh && rh > 0 && (td.rowSpan ?? 1) <= 1)
      td.style.minHeight = `${rh}px`;
    else
      td.style.removeProperty("min-height");
  });
}
function setupHsScrollBar(wrap, barEl) {
  const track = barEl.querySelector(".vt-hs-track");
  const thumb = barEl.querySelector(".vt-hs-thumb");
  if (!track || !thumb)
    return;
  const syncThumb = () => {
    if (!wrap.hasClass("vt-hs-scroll") && !wrap.hasClass("vt-rc-scroll")) {
      barEl.style.display = `none`;
      return;
    }
    const maxScroll = wrap.scrollWidth - wrap.clientWidth;
    if (maxScroll <= 0) {
      barEl.style.display = `none`;
      return;
    }
    barEl.style.display = `block`;
    const ratio = wrap.clientWidth / wrap.scrollWidth;
    const thumbW = Math.max(24, track.clientWidth * ratio);
    thumb.style.width = `${thumbW}px`;
    const maxThumbLeft = track.clientWidth - thumbW;
    thumb.style.left = `${maxScroll > 0 ? wrap.scrollLeft / maxScroll * maxThumbLeft : 0}px`;
  };
  wrap.addEventListener("scroll", syncThumb);
  new ResizeObserver(syncThumb).observe(wrap);
  const tbl = wrap.querySelector("table");
  if (tbl)
    new ResizeObserver(syncThumb).observe(tbl);
  syncThumb();
  let dragging = false;
  let startX = 0;
  let startLeft = 0;
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startLeft = thumb.offsetLeft;
    thumb.setPointerCapture(e.pointerId);
  });
  thumb.addEventListener("pointermove", (e) => {
    if (!dragging)
      return;
    const trackW = track.clientWidth;
    const thumbW = thumb.offsetWidth;
    const maxThumbLeft = trackW - thumbW;
    const newLeft = Math.max(0, Math.min(maxThumbLeft, startLeft + (e.clientX - startX)));
    const maxScroll = wrap.scrollWidth - wrap.clientWidth;
    wrap.scrollLeft = maxScroll > 0 ? newLeft / maxThumbLeft * maxScroll : 0;
  });
  const stopDrag = (e) => {
    dragging = false;
    try {
      thumb.releasePointerCapture(e.pointerId);
    } catch {
    }
  };
  thumb.addEventListener("pointerup", stopDrag);
  thumb.addEventListener("pointercancel", stopDrag);
  track.addEventListener("pointerdown", (e) => {
    if (e.target === thumb)
      return;
    const rect = track.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const maxScroll = wrap.scrollWidth - wrap.clientWidth;
    wrap.scrollLeft = ratio * maxScroll;
  });
}
function bindRcResizeHandles(table, data, editing, onUpdate) {
  const wrap = table.closest(".vt-table-wrap");
  if (!wrap)
    return;
  let overlay = wrap.querySelector(".vt-rc-overlay");
  if (data.mode !== "RC" || !editing) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = wrap.createDiv({ cls: "vt-rc-overlay" });
  }
  overlay.empty();
  const rows = Array.from(table.querySelectorAll("tr"));
  const cols = data.rows[0]?.length ?? 0;
  const hit = import_obsidian2.Platform.isMobile || import_obsidian2.Platform.isTablet ? 12 : 6;
  const placeHandles = () => {
    const tableRect0 = table.getBoundingClientRect();
    const visL = wrap.scrollLeft;
    const visR = wrap.scrollLeft + wrap.clientWidth - hit;
    const wrapW = wrap.clientWidth;
    const tableW = table.offsetWidth;
    const tableH = table.offsetHeight;
    const firstRowCells = Array.from(rows[0]?.querySelectorAll("td") ?? []);
    const colPos = [];
    wrap.querySelectorAll(".vt-rc-handle-col").forEach((g) => {
      const c = parseInt(g.dataset.vtC ?? "-1", 10);
      const targetCell = firstRowCells.find((td) => parseInt(td.dataset.vtC ?? "-1", 10) === c);
      if (!targetCell)
        return;
      const rect = targetCell.getBoundingClientRect();
      const base = Math.min(rect.right - tableRect0.left - hit / 2, tableW - hit);
      colPos.push({ g, left: Math.max(visL, Math.min(base, visR)) });
    });
    const rowPos = [];
    wrap.querySelectorAll(".vt-rc-handle-row").forEach((g) => {
      const rr = parseInt(g.dataset.vtR ?? "-1", 10);
      const tr = rows[rr];
      if (!tr)
        return;
      const rect = tr.getBoundingClientRect();
      rowPos.push({ g, top: Math.min(rect.bottom - tableRect0.top - hit / 2, tableH - hit) });
    });
    for (const { g, left } of colPos)
      g.style.left = `${left}px`;
    for (const { g, top } of rowPos) {
      g.style.top = `${top}px`;
      g.style.left = `${visL}px`;
      g.style.width = `${wrapW}px`;
    }
  };
  for (let c = 0; c < cols; c++) {
    const firstRow = rows[0];
    if (!firstRow)
      continue;
    const cells = Array.from(firstRow.querySelectorAll("td"));
    const targetCell = cells.find((td) => parseInt(td.dataset.vtC ?? "-1", 10) === c);
    if (!targetCell)
      continue;
    const rect = targetCell.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const colHandle = overlay.createDiv({ cls: "vt-rc-handle vt-rc-handle-col" });
    colHandle.dataset.vtC = String(c);
    colHandle.style.left = `${Math.max(wrap.scrollLeft, Math.min(rect.right - tableRect.left - hit / 2, table.offsetWidth - hit, wrap.scrollLeft + wrap.clientWidth - hit))}px`;
    colHandle.style.top = `0`;
    colHandle.style.height = `${table.offsetHeight}px`;
    colHandle.style.width = `${hit}px`;
    colHandle.addEventListener("touchstart", (te) => te.preventDefault(), { passive: false });
    colHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!data.colWidths)
        data.colWidths = [];
      const startX = e.clientX;
      const startW = data.colWidths[c] ?? targetCell.offsetWidth;
      try {
        colHandle.setPointerCapture(e.pointerId);
      } catch {
      }
      const onMove = (ev) => {
        const newW = Math.max(40, Math.round(startW + (ev.clientX - startX)));
        data.colWidths[c] = newW;
        const colgroup = table.querySelector("colgroup");
        const col = colgroup?.children[c];
        if (col)
          col.style.width = `${newW}px`;
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          colHandle.releasePointerCapture(ev.pointerId);
        } catch {
        }
        onUpdate();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }
  rows.forEach((tr, r) => {
    const rect = tr.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const rowHandle = overlay.createDiv({ cls: "vt-rc-handle vt-rc-handle-row" });
    rowHandle.style.top = `${Math.min(rect.bottom - tableRect.top - hit / 2, table.offsetHeight - hit)}px`;
    rowHandle.style.left = `${wrap.scrollLeft}px`;
    rowHandle.style.width = `${wrap.clientWidth}px`;
    rowHandle.style.height = `${hit}px`;
    rowHandle.dataset.vtR = String(r);
    rowHandle.addEventListener("touchstart", (te) => te.preventDefault(), { passive: false });
    rowHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!data.rowHeights)
        data.rowHeights = [];
      const startY = e.clientY;
      const startH = data.rowHeights[r] ?? tr.offsetHeight;
      table.querySelectorAll("tr").forEach((t2, i) => {
        if (data.rowHeights[i] == null)
          data.rowHeights[i] = t2.offsetHeight;
      });
      table.querySelectorAll("td").forEach((t2) => {
        if ((t2.rowSpan ?? 1) > 1)
          return;
        const tR = parseInt(t2.dataset.vtR ?? "-1", 10);
        if (tR === r)
          return;
        t2.style.minHeight = `${t2.offsetHeight}px`;
      });
      try {
        rowHandle.setPointerCapture(e.pointerId);
      } catch {
      }
      const onMove = (ev) => {
        const newH = Math.max(24, Math.round(startH + (ev.clientY - startY)));
        data.rowHeights[r] = newH;
        tr.style.height = `${newH}px`;
        tr.querySelectorAll("td").forEach((td) => {
          if ((td.rowSpan ?? 1) > 1)
            return;
          td.style.minHeight = `${newH}px`;
        });
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          rowHandle.releasePointerCapture(ev.pointerId);
        } catch {
        }
        placeHandles();
        onUpdate();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  });
  const cornerSize = Math.max(hit, 14);
  const corner = overlay.createDiv({ cls: "vt-rc-handle vt-rc-corner" });
  const placeCorner = () => {
    corner.style.left = `${Math.min(table.offsetWidth, wrap.scrollLeft + wrap.clientWidth) - cornerSize}px`;
    corner.style.top = `${wrap.scrollTop + table.offsetHeight - cornerSize}px`;
    corner.style.width = `${cornerSize}px`;
    corner.style.height = `${cornerSize}px`;
  };
  placeCorner();
  if (!cornerBinds(wrap).__vtCornerROBound) {
    cornerBinds(wrap).__vtCornerROBound = true;
    new ResizeObserver(() => {
      placeCorner();
      placeHandles();
    }).observe(table);
  }
  if (!cornerBinds(wrap).__vtCornerScrollBound) {
    cornerBinds(wrap).__vtCornerScrollBound = true;
    wrap.addEventListener("scroll", () => {
      const c = wrap.querySelector(".vt-rc-corner");
      if (!c)
        return;
      const cs = Math.max(hit, 14);
      c.style.left = `${Math.min(table.offsetWidth, wrap.scrollLeft + wrap.clientWidth) - cs}px`;
      c.style.top = `${wrap.scrollTop + table.offsetHeight - cs}px`;
    }, { passive: true });
  }
  placeHandles();
  if (!cornerBinds(wrap).__vtHandleScrollBound) {
    cornerBinds(wrap).__vtHandleScrollBound = true;
    wrap.addEventListener("scroll", placeHandles, { passive: true });
  }
  corner.addEventListener("touchstart", (te) => te.preventDefault(), { passive: false });
  corner.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const colgroup = table.querySelector("colgroup");
    if (cols < 1 || rows.length < 1)
      return;
    if (!data.colWidths)
      data.colWidths = [];
    if (!data.rowHeights)
      data.rowHeights = [];
    for (let c = 0; c < cols; c++) {
      if (data.colWidths[c] == null) {
        const col = colgroup?.children[c];
        const w = col ? parseFloat(col.style.width) : NaN;
        const cells = Array.from(rows[0]?.querySelectorAll("td") ?? []);
        const td = cells.find((x) => parseInt(x.dataset.vtC ?? "-1", 10) === c);
        data.colWidths[c] = Number.isFinite(w) ? w : td?.offsetWidth ?? 120;
      }
    }
    rows.forEach((tr, r) => {
      if (data.rowHeights[r] == null)
        data.rowHeights[r] = tr.offsetHeight;
    });
    const startWs = [];
    for (let c = 0; c < cols; c++)
      startWs[c] = data.colWidths[c] ?? 120;
    const startHs = rows.map((_, r) => data.rowHeights[r] ?? 24);
    const startX = e.clientX;
    const startY = e.clientY;
    const applyPreview = (dx, dy) => {
      for (let c = 0; c < cols; c++) {
        const w = Math.max(40, Math.round(startWs[c] + dx / cols));
        data.colWidths[c] = w;
        const col = colgroup?.children[c];
        if (col)
          col.style.width = `${w}px`;
      }
      rows.forEach((tr, r) => {
        const h = Math.max(24, Math.round(startHs[r] + dy / rows.length));
        data.rowHeights[r] = h;
        tr.style.height = `${h}px`;
        tr.querySelectorAll("td").forEach((td) => {
          if ((td.rowSpan ?? 1) > 1)
            return;
          td.style.minHeight = `${h}px`;
        });
      });
      placeCorner();
    };
    const onMove = (ev) => {
      applyPreview(Math.round(ev.clientX - startX), Math.round(ev.clientY - startY));
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        corner.releasePointerCapture(ev.pointerId);
      } catch {
      }
      onUpdate();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}
function autoExpandRowHeight(td, data, r, contentChanged) {
  if (data.mode !== "RC" || !contentChanged)
    return;
  if (td.scrollHeight <= td.clientHeight)
    return;
  const needed = td.scrollHeight + 4;
  if (!data.rowHeights)
    data.rowHeights = [];
  const cur = data.rowHeights[r] ?? 0;
  if (needed > cur) {
    data.rowHeights[r] = needed;
    const tr = td.closest("tr");
    if (tr)
      tr.style.height = `${needed}px`;
    if ((td.rowSpan ?? 1) <= 1)
      td.style.minHeight = `${needed}px`;
  }
}

// src/render.ts
var mathJaxReady = null;
function ensureMathJax() {
  if (!mathJaxReady)
    mathJaxReady = (0, import_obsidian3.loadMathJax)();
  return mathJaxReady;
}
function scheduleMathRender(root) {
  void ensureMathJax().then(() => {
    if (renderMathInNode(root))
      void (0, import_obsidian3.finishRenderMath)();
  });
}
var activeController = null;
var appearanceRegistry = /* @__PURE__ */ new Map();
function refreshAllTableAppearance() {
  for (const [host, refresh] of appearanceRegistry) {
    if (!host.isConnected) {
      appearanceRegistry.delete(host);
      continue;
    }
    refresh();
  }
}
function parseColorToRgb(color) {
  const s = color.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split("").map((ch) => parseInt(ch + ch, 16));
    return { r, g, b };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m)
    return { r: +m[1], g: +m[2], b: +m[3] };
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (m) {
    const h = +m[1] / 360, sa = +m[2] / 100, li = +m[3] / 100;
    const q = li < 0.5 ? li * (1 + sa) : li + sa - li * sa;
    const p = 2 * li - q;
    const hue2rgb = (t2) => {
      if (t2 < 0)
        t2 += 1;
      if (t2 > 1)
        t2 -= 1;
      if (t2 < 1 / 6)
        return p + (q - p) * 6 * t2;
      if (t2 < 1 / 2)
        return q;
      if (t2 < 2 / 3)
        return p + (q - p) * (2 / 3 - t2) * 6;
      return p;
    };
    return {
      r: Math.round(hue2rgb(h + 1 / 3) * 255),
      g: Math.round(hue2rgb(h) * 255),
      b: Math.round(hue2rgb(h - 1 / 3) * 255)
    };
  }
  return null;
}
function resolveThemeAccent(el) {
  const vars = ["--interactive-accent", "--accent-color"];
  for (const host of [document.body, el]) {
    const cs = getComputedStyle(host);
    for (const name of vars) {
      const raw = cs.getPropertyValue(name).trim();
      if (raw && parseColorToRgb(raw))
        return raw;
    }
    const h = cs.getPropertyValue("--accent-h").trim() || cs.getPropertyValue("--accent-H").trim();
    const sa = cs.getPropertyValue("--accent-s").trim() || cs.getPropertyValue("--accent-S").trim();
    const li = cs.getPropertyValue("--accent-l").trim() || cs.getPropertyValue("--accent-L").trim();
    if (h && sa && li) {
      const s2 = sa.endsWith("%") ? sa : `${sa}%`;
      const l2 = li.endsWith("%") ? li : `${li}%`;
      return `hsl(${parseFloat(h)}, ${s2}, ${l2})`;
    }
  }
  const probe = createSpan();
  probe.style.color = `var(--interactive-accent, var(--accent-color, transparent))`;
  el.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  if (computed && !/transparent/i.test(computed) && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(computed)) {
    return computed;
  }
  return null;
}
function contrastTextColor(bg) {
  const rgb = parseColorToRgb(bg);
  if (!rgb)
    return "#000000";
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return lum > 150 ? "#000000" : "#ffffff";
}
function effTblStyle(data, settings) {
  if (data.style === "off")
    return null;
  if (data.style)
    return data.style;
  return settings.tblStyleEnabled && settings.tblStyle !== "none" ? settings.tblStyle : null;
}
function effZebra(data, settings) {
  if (data.zebra !== void 0)
    return data.zebra;
  return settings.zebraEnabled && settings.zebraStyle !== "none";
}
function zebraTintOf(settings, el) {
  if (settings.zebraStyle === "custom" && (settings.zebraColor ?? "").trim()) {
    const bg2 = settings.zebraColor.trim();
    return { bg: bg2, fg: contrastTextColor(bg2) };
  }
  const accent = resolveThemeAccent(el) ?? "#7c3aed";
  const rgb = parseColorToRgb(accent);
  const bg = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)` : accent;
  return { bg, fg: "" };
}
var pendingFocusRestore = null;
var pendingSelectionRestore = null;
var lastTouchScrollAt = 0;
if (typeof document !== "undefined") {
  const markTouch = () => {
    lastTouchScrollAt = Date.now();
  };
  document.addEventListener("touchstart", markTouch, { passive: true, capture: true });
  document.addEventListener("touchmove", markTouch, { passive: true, capture: true });
  document.addEventListener("touchend", markTouch, { passive: true, capture: true });
  document.addEventListener("touchcancel", markTouch, { passive: true, capture: true });
}
var pendingScrollAnchor = null;
function noteScrollAnchor(el) {
  const scroller = el.closest(".cm-scroller") ?? el.closest(".markdown-preview-view, .markdown-reading-view");
  if (!scroller)
    return;
  pendingScrollAnchor = {
    host: el,
    scroller,
    scrollTop: scroller.scrollTop,
    offsetTop: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    // 重渲染管线（含大文档/多表）可能持续数秒，放宽到 6s
    expires: Date.now() + 6e3
  };
}
function requestInitialFocus(r, c, expectSource) {
  pendingFocusRestore = { r, c, caretAtEnd: false, expires: Date.now() + 2500, expectSource };
  startFocusPoll();
}
var latestRenderSource = "";
var latestFocusRunner = null;
var focusPollTimer = null;
function startFocusPoll() {
  if (focusPollTimer !== null)
    return;
  focusPollTimer = window.setInterval(() => {
    const req = pendingFocusRestore;
    if (!req || req.expires === void 0 || Date.now() > req.expires) {
      if (focusPollTimer !== null) {
        window.clearInterval(focusPollTimer);
        focusPollTimer = null;
      }
      return;
    }
    if (req.expectSource === void 0 || latestRenderSource !== req.expectSource || !latestFocusRunner)
      return;
    if (latestFocusRunner(req.r, req.c, req.caretAtEnd, req.textOffset ?? null)) {
      pendingFocusRestore = null;
      if (focusPollTimer !== null) {
        window.clearInterval(focusPollTimer);
        focusPollTimer = null;
      }
    }
  }, 100);
}
function getActiveTableController() {
  return activeController ?? selectionOwner;
}
var selectionOwner = null;
var ghostMap = /* @__PURE__ */ new WeakMap();
function clearVisualSnapshot(el) {
  const g = ghostMap.get(el);
  if (g) {
    g.remove();
    ghostMap.delete(el);
  }
}
function preserveVisualSnapshot(el) {
  clearVisualSnapshot(el);
  if (!el.isConnected)
    return;
  const old = el.firstElementChild;
  if (!old || !old.classList.contains("vtable-container"))
    return;
  const r = old.getBoundingClientRect();
  if (r.width < 2 || r.height < 2)
    return;
  const ghost = old.cloneNode(true);
  ghost.classList.add("vt-ghost");
  ghost.setAttribute("aria-hidden", "true");
  for (const [p, v] of [
    ["position", "fixed"],
    ["left", `${r.left}px`],
    ["top", `${r.top}px`],
    ["width", `${r.width}px`],
    ["height", `${r.height}px`],
    ["margin", "0"],
    ["z-index", "999"],
    ["pointer-events", "none"],
    ["overflow", "hidden"],
    ["background", "var(--background-primary, #ffffff)"]
  ])
    ghost.style.setProperty(p, v);
  document.body.appendChild(ghost);
  ghostMap.set(el, ghost);
  window.setTimeout(() => clearVisualSnapshot(el), 600);
}
function renderBlock(source, el, toolbar, settings, sourcePath, resolveImage, onCommit, onConvertToMd, onConvertToHtml, onExitTable, onPickColor, onOpenLink, obsidianCommand) {
  preserveVisualSnapshot(el);
  el.empty();
  el.classList.add("vtable-container");
  if (!pendingFocusRestore && !pendingSelectionRestore)
    toolbar.hideIfStale();
  const data = parseSource(source);
  const grid = data.rows;
  const modeBar = new ModeSwitcher(el);
  const wrap = el.createDiv({ cls: "vt-table-wrap" });
  const table = wrap.createEl("table", { cls: "vt" });
  const tbody = table.createEl("tbody");
  const hsBar = el.createDiv({ cls: "vt-hs-bar" });
  hsBar.style.display = `none`;
  const hsTrack = hsBar.createDiv({ cls: "vt-hs-track" });
  hsTrack.createDiv({ cls: "vt-hs-thumb" });
  setupHsScrollBar(wrap, hsBar);
  const cellMap = [];
  let focusedR = 0;
  let focusedC = 0;
  let editing = false;
  let lastCaretRC = null;
  let lastCaretOffset = null;
  const flushActiveCell = () => {
    const active = document.activeElement;
    if (!active?.matches("td") || !table.contains(active))
      return;
    const rr = parseInt(active.dataset.vtR ?? "-1", 10);
    const cc = parseInt(active.dataset.vtC ?? "-1", 10);
    if (rr < 0 || cc < 0)
      return;
    lastCaretRC = { r: rr, c: cc };
    lastCaretOffset = isWysiwyg(active) ? caretSourceOffset(active) : caretTextOffsetInTd(active);
    const html = normalizeCellHtml(stripRcHandles(isWysiwyg(active) ? projectSource(active) : active.innerHTML));
    grid[rr][cc].t = normalizeCellNewlines(html);
  };
  const handleOpenLink = (link) => {
    flushActiveCell();
    commit();
    onOpenLink(link);
  };
  let pendingDirty = false;
  const flushCommit = () => {
    if (!table.isConnected)
      return;
    flushActiveCell();
    flushDiagZone();
    if (pendingDirty) {
      pendingDirty = false;
      commit();
    }
  };
  const flushDiagZone = () => {
    const z = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!z || !(z != null && z.instanceOf(Element)) || !z.classList.contains("vt-diag-zone") || !table.contains(z))
      return;
    const td = z.closest("td");
    if (!td)
      return;
    const p = tdCoords(td);
    const cell2 = grid[p.r]?.[p.c];
    if (!isDiag(cell2))
      return;
    writeDiagZoneText(td, z);
    const aTxt = td.dataset.vtDiagA ?? cell2.dg;
    const bTxt = td.dataset.vtDiagB ?? cell2.t;
    delete td.dataset.vtDiagA;
    delete td.dataset.vtDiagB;
    cell2.dg = aTxt;
    cell2.t = bTxt;
  };
  const commit = (keepFocus = false, caretAtEnd3 = false) => {
    if (keepFocus) {
      const sameCell = lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC && lastCaretOffset != null;
      pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: caretAtEnd3, textOffset: sameCell ? lastCaretOffset : null };
    }
    onCommit(serialize(data));
  };
  const applyFocusRestore = (dr, dc, resetCaret) => {
    if (!table.contains(document.activeElement)) {
      pendingFocusRestore = null;
      return;
    }
    const sameCell = !resetCaret && dr === 0 && dc === 0 && lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC && lastCaretOffset != null;
    pendingFocusRestore = {
      r: focusedR + dr,
      c: focusedC + dc,
      caretAtEnd: false,
      textOffset: sameCell ? lastCaretOffset : null
    };
  };
  const shiftRestore = (deltasR, deltasC, resetCaret = false) => {
    if (!table.contains(document.activeElement)) {
      pendingFocusRestore = null;
      return;
    }
    let r = focusedR;
    let c = focusedC;
    let removed = resetCaret;
    if (deltasR) {
      const s = shiftIndex(focusedR, deltasR);
      if (s < 0) {
        removed = true;
        r = Math.min(focusedR, grid.length - 1);
      } else
        r = s;
    }
    if (deltasC) {
      const s = shiftIndex(focusedC, deltasC);
      if (s < 0) {
        removed = true;
        c = Math.min(focusedC, (grid[0]?.length ?? 1) - 1);
      } else
        c = s;
    }
    const sameCell = !removed && r === focusedR && c === focusedC && lastCaretRC?.r === focusedR && lastCaretRC?.c === focusedC && lastCaretOffset != null;
    pendingFocusRestore = { r, c, caretAtEnd: false, textOffset: sameCell ? lastCaretOffset : null };
  };
  const rerenderMode = () => {
    applyModeStyles(wrap, table, data, hsBar);
    bindRcResizeHandles(table, data, editing, () => {
      pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
      flushActiveCell();
      onCommit(serialize(data));
    });
    bindRowColDrag(table, data, wrap, editing, {
      getFocused: () => ({ r: focusedR, c: focusedC }),
      selectCells: (rects, additive) => {
        if (!additive)
          clearSelection();
        for (const rc of rects)
          selRects.push(normalizeSelRect(rc, grid, anchorIndex));
        renderSel();
      },
      getSelection: () => selRects,
      onDragStart: () => flushActiveCell(),
      onMutate: (focus) => {
        pendingFocusRestore = focus ? { r: focus.r, c: focus.c, caretAtEnd: false } : { r: focusedR, c: focusedC, caretAtEnd: false };
        onCommit(serialize(data));
      }
    });
  };
  const placeCaret = (td, atEnd) => {
    const sel = window.getSelection();
    if (!sel)
      return;
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const focusCell = (r, c, caretAtEnd3 = false, textOffset = null) => {
    if (r < 0 || r >= grid.length || c < 0 || c >= (grid[0]?.length ?? 0))
      return false;
    if (!visible(grid[r][c]))
      return false;
    const td = cellMap[r]?.[c];
    if (!td)
      return false;
    td.focus();
    focusedR = r;
    focusedC = c;
    if (isDiag(grid[r][c]))
      return true;
    const place = () => {
      if (textOffset != null)
        placeCaretAtTextOffset(td, textOffset);
      else
        placeCaret(td, caretAtEnd3);
    };
    place();
    if (import_obsidian3.Platform.isIosApp) {
      window.requestAnimationFrame(() => {
        if (td.isConnected && document.activeElement === td)
          place();
      });
    }
    return true;
  };
  const moveFocus = (dr, dc) => {
    let r = focusedR + dr;
    let c = focusedC + dc;
    const maxR = grid.length;
    const maxC = grid[0]?.length ?? 0;
    while (r >= 0 && r < maxR && c >= 0 && c < maxC) {
      if (visible(grid[r][c]) && cellMap[r]?.[c]) {
        return focusCell(r, c, dc < 0 || dr < 0);
      }
      r += dr;
      c += dc;
    }
    return false;
  };
  const setMode = (mode) => {
    if (data.mode === mode)
      return;
    flushActiveCell();
    clearSelection();
    if (mode === "RC" && data.colWidths === void 0) {
      const cols = grid[0]?.length ?? 0;
      data.colWidths = [];
      const firstRow = tbody.querySelector("tr");
      if (firstRow) {
        for (let c = 0; c < cols; c++) {
          const td = Array.from(firstRow.querySelectorAll("td")).find((cell2) => parseInt(cell2.dataset.vtC ?? "-1", 10) === c);
          data.colWidths[c] = td ? Math.max(120, td.offsetWidth) : 120;
        }
      }
    }
    data.mode = mode;
    modeBar.setActive(mode);
    pendingFocusRestore = { r: focusedR, c: focusedC, caretAtEnd: false };
    onCommit(serialize(data));
  };
  const showEditingUi = () => {
    if (!table.closest(".cm-editor"))
      return;
    const wasEditing = editing;
    editing = true;
    el.addClass("vt-editing");
    applyTableStyle();
    if (settings.enableModeSwitcher) {
      modeBar.show(data.mode);
    }
    if (!wasEditing)
      rerenderMode();
    updateEdgeBars();
    startScrollClamp();
  };
  const hideEditingUi = () => {
    editing = false;
    el.removeClass("vt-editing");
    stopScrollClamp();
    modeBar.hide();
    rerenderMode();
    applyTableStyle();
    if (activeController?.moveCell === controller.moveCell)
      activeController = null;
  };
  let clampRaf = null;
  let clampLast = 0;
  const stopScrollClamp = () => {
    if (clampRaf !== null) {
      window.cancelAnimationFrame(clampRaf);
      clampRaf = null;
    }
  };
  const startScrollClamp = () => {
    if (clampRaf !== null)
      return;
    const tick = (t2) => {
      if (!el.isConnected) {
        clampRaf = null;
        return;
      }
      clampRaf = window.requestAnimationFrame(tick);
      if (t2 - clampLast < 120)
        return;
      clampLast = t2;
      if (Date.now() - lastTouchScrollAt < 800)
        return;
      const vw = wrap.clientWidth;
      const cap = Math.max(0, Math.min(
        wrap.scrollWidth - vw,
        Math.round(table.getBoundingClientRect().width) - vw + 16
      ));
      if (wrap.scrollLeft > cap)
        wrap.scrollLeft = cap;
    };
    clampRaf = window.requestAnimationFrame(tick);
  };
  const applyTableStyle = () => {
    const style = editing ? null : effTblStyle(data, settings);
    el.removeClass("vt-tbl-three", "vt-tbl-noline", "vt-tbl-hline");
    wrap.classList.remove("vt-tbl-three", "vt-tbl-noline", "vt-tbl-hline");
    if (style)
      wrap.classList.add(`vt-tbl-${style}`);
    table.querySelectorAll("td.vt-zebra-tint").forEach((td) => {
      td.classList.remove("vt-zebra-tint");
      td.style.background = ``;
      td.style.color = ``;
    });
    if (editing)
      return;
    if (effZebra(data, settings)) {
      const tint = zebraTintOf(settings, el);
      const hdrSuppressed = (grid[0] ?? []).some((cd) => cd && visible(cd) && cd.rs > 1);
      const hdrActive = (settings.headerStyle ?? "none") !== "none" && !data.noHeaderBg && !hdrSuppressed;
      const base = hdrActive ? 2 : 0;
      const rows = table.querySelectorAll("tbody tr");
      rows.forEach((tr, i) => {
        if ((i - base) % 2 !== 0)
          return;
        tr.querySelectorAll("td").forEach((td) => {
          if (td.style.background)
            return;
          td.classList.add("vt-zebra-tint");
          td.style.background = tint.bg;
          if (tint.fg)
            td.style.color = tint.fg;
        });
      });
    }
  };
  modeBar.setHandler(setMode);
  const anchorIndex = buildAnchorIndex(grid);
  const selOverlay = new SelOverlay(wrap, table);
  let selRects = [];
  let selGesture = null;
  let lastTap = null;
  let gestureMove = null;
  let gestureUp = null;
  const tdCoords = (td) => ({
    r: parseInt(td.dataset.vtR ?? "-1", 10),
    c: parseInt(td.dataset.vtC ?? "-1", 10)
  });
  const normCell = (r, c) => normalizeSelRect({ r1: r, c1: c, r2: r, c2: c }, grid, anchorIndex);
  const normRange = (r1, c1, r2, c2) => normalizeSelRect({
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2)
  }, grid, anchorIndex);
  const renderSel = (extra) => {
    if (selRects.length)
      selectionOwner = controller;
    else if (!extra && selectionOwner === controller)
      selectionOwner = null;
    selOverlay.update(extra ? [...selRects, extra] : selRects, cellMap);
    syncFillHandle();
  };
  const clearSelection = () => {
    selRects = [];
    selGesture = null;
    renderSel();
  };
  let fillHandle = import_obsidian3.Platform.isMobile || import_obsidian3.Platform.isTablet ? null : new FillHandle({
    cellTd: (r, c) => cellMap[r]?.[c] ?? null,
    cellValue: (r, c) => grid[r]?.[c]?.t ?? "",
    cellVisible: (r, c) => visible(grid[r]?.[c] ?? null),
    flushActive: () => flushActiveCell(),
    applyFill: (writes, anchor) => {
      for (const w of writes) {
        const cd = grid[w.r]?.[w.c];
        if (cd)
          cd.t = w.v;
      }
      if (anchor)
        pendingFocusRestore = { r: anchor.r, c: anchor.c, caretAtEnd: false };
      onCommit(serialize(data));
      clearSelection();
    }
  });
  const syncFillHandle = () => {
    if (!fillHandle)
      return;
    let a = null;
    if (selRects.length === 1 && selRects[0].r1 === selRects[0].r2 && selRects[0].c1 === selRects[0].c2) {
      a = { r: selRects[0].r1, c: selRects[0].c1 };
    } else if (!selRects.length) {
      const active = document.activeElement;
      if (active?.matches("td") && table.contains(active)) {
        const p = tdCoords(active);
        if (p.r >= 0 && p.c >= 0)
          a = p;
      }
    }
    if (a && isDiag(grid[a.r]?.[a.c]))
      a = null;
    if (a)
      fillHandle.showAt(a.r, a.c);
    else
      fillHandle.hide();
  };
  const onOutsidePointer = (e) => {
    if (!el.isConnected) {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      return;
    }
    const t2 = e.target;
    if (!t2 || el.contains(t2) || t2.closest?.(".vt-bar, .vt-drag-grip, .vt-ghost, .menu, .modal, .modal-container, .suggestion-container"))
      return;
    clearSelection();
    toolbar.hide();
  };
  document.addEventListener("pointerdown", onOutsidePointer, true);
  let lastSelDeleteAt = 0;
  const onStructDeleteKey = (e) => {
    if (!el.isConnected) {
      document.removeEventListener("keydown", onStructDeleteKey, true);
      return;
    }
    if (e.isComposing)
      return;
    const isDel = e.key === "Delete" || e.keyCode === 46;
    const isMacDel = e.key === "Backspace" && e.metaKey;
    if (!isDel && !isMacDel)
      return;
    if (!(e.ctrlKey || e.metaKey))
      return;
    if (!selRects.length)
      return;
    const rawOf = (rc) => ({
      c1: rc.rawC1 ?? rc.c1,
      c2: rc.rawC2 ?? rc.c2,
      r1: rc.rawR1 ?? rc.r1,
      r2: rc.rawR2 ?? rc.r2
    });
    const isFullRow = selRects.every((rc) => {
      const w = rawOf(rc);
      return w.c1 === 0 && w.c2 === colCount(grid) - 1;
    });
    const isFullCol = selRects.every((rc) => {
      const w = rawOf(rc);
      return w.r1 === 0 && w.r2 === grid.length - 1;
    });
    e.preventDefault();
    e.stopPropagation();
    lastSelDeleteAt = Date.now();
    if (!isFullRow && !isFullCol) {
      new import_obsidian3.Notice("\u4EC5\u652F\u6301\u6574\u884C\u6216\u6574\u5217\u9009\u533A\u7684\u5220\u9664\uFF08Ctrl+Delete\uFF09");
      clearSelection();
      return;
    }
    if (isFullRow)
      selOps.delRows();
    else
      selOps.delCols();
  };
  document.addEventListener("keydown", onStructDeleteKey, true);
  const buildSelMarkdown = (rects) => {
    if (!rects.length)
      return "";
    const b = unionSelBounds(rects);
    const esc = (s) => s.replace(/<br\s*\/?>/gi, "<br>").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    const lines = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const cells = [];
      for (let c = b.c1; c <= b.c2; c++) {
        const cd = grid[r]?.[c];
        cells.push(esc((cd ? cd.t : "").trim()));
      }
      lines.push("| " + cells.join(" | ") + " |");
    }
    const nCols = b.c2 - b.c1 + 1;
    lines.splice(1, 0, "| " + Array(nCols).fill("---").join(" | ") + " |");
    return lines.join("\n");
  };
  const pasteGridRows = (r0, c0, rows, extend) => {
    if (!rows.length)
      return false;
    flushActiveCell();
    let maxCols = 0;
    for (const row of rows)
      maxCols = Math.max(maxCols, row.length);
    if (extend) {
      const needR = r0 + rows.length - grid.length;
      const needC = c0 + maxCols - colCount(grid);
      if (needR > 0)
        insertRowsBelow(grid, grid.length - 1, needR);
      if (needC > 0)
        insertColsRight(grid, colCount(grid) - 1, needC);
    }
    for (let dr = 0; dr < rows.length; dr++) {
      for (let dc = 0; dc < rows[dr].length; dc++) {
        const rr = r0 + dr, cc = c0 + dc;
        if (rr >= grid.length || cc >= colCount(grid))
          continue;
        const cd = grid[rr][cc];
        if (!visible(cd))
          continue;
        cd.t = rows[dr][dc];
      }
    }
    onCommit(serialize(data));
    return true;
  };
  const onGridPasteKey = (e) => {
    if (!el.isConnected) {
      document.removeEventListener("keydown", onGridPasteKey, true);
      return;
    }
    if (e.isComposing)
      return;
    const ae = document.activeElement;
    if (!ae || !el.contains(ae))
      return;
    if (!(e.key === "v" || e.key === "V" || e.keyCode === 86))
      return;
    if (!(e.ctrlKey || e.metaKey) || !e.altKey)
      return;
    e.preventDefault();
    e.stopPropagation();
    const tr = focusedR, tc = focusedC;
    navigator.clipboard?.readText?.().then((text) => {
      if (!table.isConnected)
        return;
      const md = parseMarkdownTable(text ?? "");
      if (!md)
        return;
      pasteGridRows(tr, tc, md, true);
      clearSelection();
    }).catch(() => {
    });
  };
  document.addEventListener("keydown", onGridPasteKey, true);
  const trySelDelete = () => {
    if (!selRects.length)
      return;
    lastSelDeleteAt = Date.now();
    selOps.clearContent();
  };
  const isSelDeleteKey = (e) => e.key === "Delete" || e.key === "Backspace" || e.keyCode === 46 || e.keyCode === 8;
  const onSelKeyDown = (e) => {
    if (!el.isConnected) {
      document.removeEventListener("keydown", onSelKeyDown, true);
      document.removeEventListener("keyup", onSelKeyUp, true);
      return;
    }
    if (e.isComposing)
      return;
    if (!selRects.length)
      return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C" || e.keyCode === 67)) {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard?.writeText(buildSelMarkdown(selRects));
      return;
    }
    if (!isSelDeleteKey(e))
      return;
    if (e.ctrlKey || e.metaKey || e.altKey)
      return;
    e.preventDefault();
    e.stopPropagation();
    trySelDelete();
  };
  const onSelKeyUp = (e) => {
    if (!el.isConnected)
      return;
    if (e.isComposing)
      return;
    if (!selRects.length)
      return;
    if (!isSelDeleteKey(e))
      return;
    if (e.ctrlKey || e.metaKey || e.altKey)
      return;
    if (Date.now() - lastSelDeleteAt < 250)
      return;
    trySelDelete();
  };
  document.addEventListener("keydown", onSelKeyDown, true);
  document.addEventListener("keyup", onSelKeyUp, true);
  table.addEventListener("focusout", (e) => {
    if (!selRects.length)
      return;
    if (pendingSelectionRestore || pendingFocusRestore)
      return;
    const related = e.relatedTarget;
    if (related && (el.contains(related) || related.closest(".vt-bar, .vt-drag-grip, .vt-ghost, .menu, .modal, .modal-container, .suggestion-container")))
      return;
    clearSelection();
  });
  const tdFromPoint = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    const td = hit?.closest?.("td");
    return td && table.contains(td) ? td : null;
  };
  const detachGesture = () => {
    if (gestureMove)
      window.removeEventListener("pointermove", gestureMove);
    if (gestureUp) {
      window.removeEventListener("pointerup", gestureUp);
      window.removeEventListener("pointercancel", gestureUp);
    }
    gestureMove = null;
    gestureUp = null;
  };
  const startGesture = (originR, originC) => {
    detachGesture();
    selGesture = { originR, originC, liveR: originR, liveC: originC };
    gestureMove = (e) => {
      if (!selGesture)
        return;
      const td = tdFromPoint(e.clientX, e.clientY);
      if (td) {
        const { r, c } = tdCoords(td);
        if (r !== selGesture.liveR || c !== selGesture.liveC) {
          selGesture.liveR = r;
          selGesture.liveC = c;
          renderSel(normRange(selGesture.originR, selGesture.originC, r, c));
        }
      }
      const dom = window.getSelection();
      if (dom && !dom.isCollapsed)
        dom.removeAllRanges();
      e.preventDefault();
    };
    gestureUp = () => {
      if (selGesture) {
        const { originR: originR2, originC: originC2, liveR, liveC } = selGesture;
        selGesture = null;
        selRects.push(normRange(originR2, originC2, liveR, liveC));
        renderSel();
      }
      detachGesture();
    };
    window.addEventListener("pointermove", gestureMove);
    window.addEventListener("pointerup", gestureUp);
    window.addEventListener("pointercancel", gestureUp);
  };
  wrap.addEventListener("pointerup", (e) => {
    if (e.button !== 0)
      return;
    if (selGesture)
      return;
    const target = e.target instanceof Element ? e.target : null;
    const td = target?.closest("td");
    if (!td || !table.contains(td))
      return;
    const { r, c } = tdCoords(td);
    if (r < 0 || c < 0)
      return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < 350 && Math.abs(e.clientX - lastTap.x) < 30 && Math.abs(e.clientY - lastTap.y) < 30 && lastTap.r === r && lastTap.c === c) {
      lastTap = null;
      const dom = window.getSelection();
      if (dom && !dom.isCollapsed)
        dom.removeAllRanges();
      selRects.push(normCell(r, c));
      renderSel();
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY, r, c };
  });
  const rangeNums = (a, b) => {
    const out = [];
    for (let v = a; v <= b; v++)
      out.push(v);
    return out;
  };
  const selRowCount = (rects) => {
    const s = /* @__PURE__ */ new Set();
    for (const rc of rects)
      for (let r = rc.r1; r <= rc.r2; r++)
        s.add(r);
    return s.size;
  };
  const selColCount = (rects) => {
    const s = /* @__PURE__ */ new Set();
    for (const rc of rects)
      for (let c = rc.c1; c <= rc.c2; c++)
        s.add(c);
    return s.size;
  };
  const forEachSelectedAnchor = (rects, fn) => {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
        if (!visible(grid[r][c]))
          continue;
        if (!rects.some((rc) => rectContains(rc, r, c)))
          continue;
        fn(r, c);
      }
    }
  };
  const effectiveRects = () => {
    if (selRects.length)
      return selRects;
    const active = document.activeElement;
    if (!active?.matches("td") || !table.contains(active))
      return null;
    const r = parseInt(active.dataset.vtR ?? "-1", 10);
    const c = parseInt(active.dataset.vtC ?? "-1", 10);
    if (r < 0 || c < 0)
      return null;
    return [{ r1: r, c1: c, r2: r, c2: c }];
  };
  const commitSel = (mutate, restore, restoreFocus) => {
    const rects = effectiveRects();
    if (!rects)
      return;
    const isFallback = rects !== selRects;
    flushActiveCell();
    const before = serialize(data);
    const snapshot = rects.slice();
    mutate(snapshot);
    const after = serialize(data);
    if (after === before)
      return;
    pendingSelectionRestore = null;
    if (restoreFocus && !isFallback)
      restoreFocus(snapshot);
    else
      applyFocusRestore(0, 0, false);
    onCommit(after);
    clearSelection();
  };
  const selOps = {
    get rects() {
      return selRects;
    },
    insRowAbove: () => commitSel((rects) => {
      let offset = 0;
      for (const run of runsFromRects(rects, "rows")) {
        const n = run.end - run.start + 1;
        insertRowsAbove(grid, run.start + offset, n);
        offset += n;
      }
    }, false, (rects) => shiftRestore(
      runsFromRects(rects, "rows").map((run) => ({ at: run.start, d: run.end - run.start + 1 })),
      void 0
    )),
    insRowBelow: () => commitSel((rects) => {
      const runs = runsFromRects(rects, "rows");
      for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i];
        insertRowsBelow(grid, run.end, run.end - run.start + 1);
      }
    }, false, (rects) => shiftRestore(
      runsFromRects(rects, "rows").map((run) => ({ at: run.end + 1, d: run.end - run.start + 1 })),
      void 0
    )),
    delRows: () => {
      if (selRowCount(selRects) >= grid.length) {
        new import_obsidian3.Notice("\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u884C");
        clearSelection();
        return;
      }
      commitSel((rects) => {
        deleteRows(grid, runsFromRects(rects, "rows").flatMap((run) => rangeNums(run.start, run.end)));
      }, false, (rects) => shiftRestore(
        runsFromRects(rects, "rows").map((run) => ({ at: run.start, d: -(run.end - run.start + 1) })),
        void 0,
        true
      ));
    },
    insColLeft: () => commitSel((rects) => {
      let offset = 0;
      for (const run of runsFromRects(rects, "cols")) {
        const n = run.end - run.start + 1;
        insertColsLeft(grid, run.start + offset, n);
        offset += n;
      }
    }, false, (rects) => shiftRestore(
      void 0,
      runsFromRects(rects, "cols").map((run) => ({ at: run.start, d: run.end - run.start + 1 }))
    )),
    insColRight: () => commitSel((rects) => {
      const runs = runsFromRects(rects, "cols");
      for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i];
        insertColsRight(grid, run.end, run.end - run.start + 1);
      }
    }, false, (rects) => shiftRestore(
      void 0,
      runsFromRects(rects, "cols").map((run) => ({ at: run.end + 1, d: run.end - run.start + 1 }))
    )),
    delCols: () => {
      if (selColCount(selRects) >= (grid[0]?.length ?? 0)) {
        new import_obsidian3.Notice("\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u5217");
        clearSelection();
        return;
      }
      commitSel((rects) => {
        deleteCols(grid, runsFromRects(rects, "cols").flatMap((run) => rangeNums(run.start, run.end)));
      }, false, (rects) => shiftRestore(
        void 0,
        runsFromRects(rects, "cols").map((run) => ({ at: run.start, d: -(run.end - run.start + 1) })),
        true
      ));
    },
    merge: () => {
      if (!selRects.length)
        return;
      if (!isSolidUnion(selRects)) {
        new import_obsidian3.Notice("\u6240\u9009\u533A\u57DF\u4E0D\u662F\u5B8C\u6574\u77E9\u5F62\uFF0C\u65E0\u6CD5\u5408\u5E76");
        return;
      }
      const bounds = unionSelBounds(selRects);
      commitSel(() => {
        mergeRange(grid, bounds.r1, bounds.c1, bounds.r2, bounds.c2);
      }, false, () => applyFocusRestore(bounds.r1 - focusedR, bounds.c1 - focusedC, true));
      clearSelection();
    },
    split: () => {
      const targets = [];
      forEachSelectedAnchor(selRects, (r, c) => {
        const cd = grid[r][c];
        if (cd.rs > 1 || cd.cs > 1)
          targets.push([r, c]);
      });
      if (!targets.length) {
        new import_obsidian3.Notice("\u6240\u9009\u533A\u57DF\u6CA1\u6709\u5408\u5E76\u5355\u5143\u683C");
        return;
      }
      const wasFocusedAnchor = targets.some(([r, c]) => r === focusedR && c === focusedC);
      const focusedInside = selRects.some((rc) => rectContains(rc, focusedR, focusedC));
      commitSel(() => {
        for (const [r, c] of targets)
          splitCell(grid, r, c);
      }, true, () => applyFocusRestore(0, 0, focusedInside && !wasFocusedAnchor));
    },
    bold: () => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        grid[r][c].t = toggleWrapTag(grid[r][c].t, "b");
      });
    }, true, (rects) => applyFocusRestore(0, 0, rects.some((rc) => rectContains(rc, focusedR, focusedC)))),
    italic: () => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        grid[r][c].t = toggleWrapTag(grid[r][c].t, "i");
      });
    }, true, (rects) => applyFocusRestore(0, 0, rects.some((rc) => rectContains(rc, focusedR, focusedC)))),
    fontStep: (delta) => {
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
          if (!selRects.some((rc) => rectContains(rc, r, c)))
            continue;
          const td = cellMap[r]?.[c];
          if (!td)
            continue;
          const cur = parseFloat(getComputedStyle(td).fontSize) || 16;
          td.style.fontSize = `${Math.max(8, Math.min(72, cur + delta))}px`;
        }
      }
      clearSelection();
    },
    // 任务1：选区对齐（l/c/r；存进 Cell.a，重渲染后由内联样式生效）
    align: (mode) => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        const cd = grid[r][c];
        if (mode === "l")
          delete cd.a;
        else
          cd.a = mode;
      });
    }, true),
    // 垂直对齐（t/m/b；存进 Cell.va，重渲染后由内联样式生效；顶对齐=默认，字段瘦身）
    alignV: (mode) => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        const cd = grid[r][c];
        if (mode === "t")
          delete cd.va;
        else
          cd.va = mode;
      });
    }, true),
    // 任务2：选区底色（null = 清除）
    setColor: (color) => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        const cd = grid[r][c];
        if (color)
          cd.bg = color;
        else
          delete cd.bg;
      });
    }, true),
    // 任务3：清空选区内容（不动行列结构，选区保持）
    clearContent: () => commitSel((rects) => {
      forEachSelectedAnchor(rects, (r, c) => {
        grid[r][c].t = "";
      });
    }, true),
    // 任务2：取色弹窗（main.ts 提供弹窗实现）；无选区时对聚焦格取色（任务10）
    pickColor: () => {
      const rects = effectiveRects();
      if (!rects)
        return;
      const first = rects[0];
      const cd = grid[first.r1]?.[first.c1];
      onPickColor(cd?.bg ?? "", (color) => selOps.setColor(color));
    }
  };
  const controller = {
    moveCell(dr, dc) {
      return moveFocus(dr, dc);
    },
    setMode,
    getMode: () => data.mode,
    hasSelection: () => selRects.length > 0,
    alignSel: (mode) => selOps.align(mode),
    alignVSel: (mode) => selOps.alignV(mode),
    colorSel: (color) => selOps.setColor(color),
    clearSelContent: () => selOps.clearContent(),
    pickColor: () => selOps.pickColor(),
    flushCommit,
    toggleHeaderBg() {
      data.noHeaderBg = !data.noHeaderBg;
      refreshHeader();
      onCommit(serialize(data));
      return !data.noHeaderBg;
    },
    addHeaderBg() {
      if (!data.noHeaderBg)
        return false;
      delete data.noHeaderBg;
      refreshHeader();
      onCommit(serialize(data));
      return true;
    },
    toggleDiag() {
      const targets = [];
      if (selRects.length) {
        for (const rc of selRects) {
          for (let r = rc.r1; r <= rc.r2; r++) {
            for (let c = rc.c1; c <= rc.c2; c++) {
              if (visible(grid[r][c]))
                targets.push({ r, c });
            }
          }
        }
      } else if (focusedR >= 0 && focusedC >= 0 && grid[focusedR]?.[focusedC]) {
        targets.push({ r: focusedR, c: focusedC });
      }
      if (!targets.length)
        return false;
      const first = grid[targets[0].r][targets[0].c];
      const turnOn = first.dg === void 0;
      flushActiveCell();
      let hit = false;
      for (const { r, c } of targets) {
        const cd = grid[r][c];
        if (turnOn) {
          if (isDiag(cd))
            continue;
          cd.dg = "";
          cd.t = diagPlainText(cd.t);
          hit = true;
        } else {
          if (!isDiag(cd))
            continue;
          const parts = [cd.t, cd.dg].filter((s) => s !== "");
          cd.t = parts.length ? parts.map(escapeHtml).join("<br>") : "";
          delete cd.dg;
          hit = true;
        }
      }
      if (!hit)
        return false;
      const f = targets[0];
      pendingFocusRestore = { r: f.r, c: f.c, caretAtEnd: true };
      commit();
      return true;
    },
    async styleCall(pick) {
      const cur = effTblStyle(data, settings);
      const opts = [
        { value: "three", name: t("\u4E09\u7EBF\u8868", "Three-line table"), checked: cur === "three" },
        { value: "noline", name: t("\u65E0\u683C\u7EBF", "No grid lines"), checked: cur === "noline" },
        { value: "hline", name: t("\u5168\u6A2A\u7EBF", "Horizontal lines only"), checked: cur === "hline" }
      ];
      const picked = await pick(opts);
      if (!picked)
        return;
      data.style = cur === picked ? "off" : picked;
      applyTableStyle();
      commit();
    },
    /** 命令「删除表格样式」：只删不加——表格有样式（线风格/隔行/表头底色）→ 全部取消；
     *  本来就没有 → 原样返回 false（调用方提示"无样式可删"） */
    toggleStyleAll() {
      const hasAny = !!effTblStyle(data, settings) || effZebra(data, settings) || (settings.headerStyle ?? "none") !== "none" && !data.noHeaderBg;
      if (!hasAny)
        return false;
      if (settings.tblStyleEnabled && settings.tblStyle !== "none")
        data.style = "off";
      else
        delete data.style;
      data.zebra = false;
      data.noHeaderBg = true;
      refreshHeader();
      applyTableStyle();
      commit();
      return true;
    },
    toggleZebra() {
      const on = effZebra(data, settings);
      data.zebra = !on;
      applyTableStyle();
      commit();
      return !on;
    }
  };
  const edgeUid = `u${Math.random().toString(36).slice(2, 10)}`;
  el.dataset.vtEdgeUid = edgeUid;
  const addRowBar = document.body.createDiv({ cls: "vt-edge-bar vt-edge-row", text: "+" });
  const addColBar = document.body.createDiv({ cls: "vt-edge-bar vt-edge-col", text: "+" });
  addRowBar.dataset.vtUid = edgeUid;
  addColBar.dataset.vtUid = edgeUid;
  const hideEdgeBars = () => {
    addRowBar.classList.remove("vt-edge-on");
    addColBar.classList.remove("vt-edge-on");
  };
  const placeEdgeBars = () => {
    const wr = wrap.getBoundingClientRect();
    const tr = table.getBoundingClientRect();
    const vh = window.innerHeight;
    const hsH = hsBar.offsetHeight > 0 ? hsBar.offsetHeight + 6 : 0;
    addRowBar.style.left = `${Math.round(wr.left)}px`;
    addRowBar.style.top = `${Math.round(Math.min(wr.bottom + 5 + hsH, vh - 18))}px`;
    addRowBar.style.width = `${Math.round(wr.width)}px`;
    const wrapRightVis = wr.left + wrap.clientWidth;
    addColBar.style.top = `${Math.round(wr.top)}px`;
    addColBar.style.left = `${Math.round(Math.min(tr.right + 2, wrapRightVis + 2))}px`;
    addColBar.style.height = `${Math.round(wr.height)}px`;
  };
  const edgeTick = () => {
    window.requestAnimationFrame(edgeTick);
    if (addRowBar.dataset.vtUid !== (el.dataset.vtEdgeUid ?? "")) {
      addRowBar.remove();
      addColBar.remove();
      return;
    }
    if (!el.isConnected) {
      addRowBar.remove();
      addColBar.remove();
      return;
    }
    if (addRowBar.classList.contains("vt-edge-on") || addColBar.classList.contains("vt-edge-on"))
      placeEdgeBars();
  };
  window.requestAnimationFrame(edgeTick);
  const updateEdgeBars = () => {
    if (!table.contains(document.activeElement)) {
      hideEdgeBars();
      return;
    }
    const onLastRow = focusedR === grid.length - 1;
    const onLastCol = focusedC === (grid[0]?.length ?? 1) - 1;
    if (onLastRow || onLastCol)
      placeEdgeBars();
    addRowBar.classList.toggle("vt-edge-on", onLastRow);
    addColBar.classList.toggle("vt-edge-on", onLastCol);
  };
  const addRowAtEnd = () => {
    flushActiveCell();
    insertRowsBelow(grid, grid.length - 1, 1);
    applyFocusRestore(0, 0, false);
    onCommit(serialize(data));
  };
  const addColAtEnd = () => {
    flushActiveCell();
    insertColsRight(grid, (grid[0]?.length ?? 1) - 1, 1);
    applyFocusRestore(0, 0, false);
    onCommit(serialize(data));
  };
  for (const bar of [addRowBar, addColBar]) {
    bar.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    bar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0 && e.pointerType === "mouse")
        return;
      hideEdgeBars();
      if (bar === addRowBar)
        addRowAtEnd();
      else
        addColAtEnd();
    });
  }
  const exitTable = (td, direction) => {
    if (selRects.length)
      clearSelection();
    td.blur();
    window.setTimeout(() => onExitTable(direction), 0);
  };
  const onTodoToggle = (r, c) => (idx, checked) => {
    flushActiveCell();
    const active = document.activeElement;
    if (active != null && active.instanceOf(HTMLElement) && table.contains(active))
      active.blur();
    const cd = grid[r][c];
    const next = toggleTodoMark(cd.t, idx, checked);
    if (next === cd.t)
      return;
    cd.t = next;
    onCommit(serialize(data));
  };
  let lastTablePointerDown = 0;
  table.addEventListener("pointerdown", () => {
    lastTablePointerDown = Date.now();
  }, true);
  grid.forEach((row, r) => {
    cellMap[r] = [];
    const tr = tbody.createEl("tr");
    const visCols = [];
    row.forEach((cd, i) => {
      if (visible(cd))
        visCols.push(i);
    });
    const domFirstCol = visCols.length ? visCols[0] : 0;
    const domLastCol = visCols.length ? visCols[visCols.length - 1] : 0;
    row.forEach((cellData, c) => {
      if (!visible(cellData))
        return;
      const td = tr.createEl("td");
      td.contentEditable = "true";
      td.dataset.vtR = String(r);
      td.dataset.vtC = String(c);
      cellMap[r][c] = td;
      if (cellData.rs > 1) {
        td.rowSpan = cellData.rs;
        if (r + cellData.rs >= grid.length)
          td.addClass("vt-edge-bottom");
      }
      if (cellData.cs > 1)
        td.colSpan = cellData.cs;
      if (c === 0)
        td.addClass("vt-edge-left");
      if (c + cellData.cs >= colCount(grid))
        td.addClass("vt-edge-right");
      if (c === domFirstCol && c > 0)
        td.addClass("vt-prot-left");
      if (c === domLastCol && c + cellData.cs < colCount(grid))
        td.addClass("vt-prot-right");
      if (cellData.a)
        td.style.textAlign = cellData.a === "c" ? "center" : cellData.a === "r" ? "right" : "left";
      if (cellData.va && !isDiag(cellData)) {
        td.style.verticalAlign = cellData.va === "m" ? "middle" : cellData.va === "b" ? "bottom" : "top";
      }
      if (cellData.bg) {
        td.style.background = cellData.bg;
        td.style.color = contrastTextColor(cellData.bg);
      }
      if (isDiag(cellData)) {
        buildDiagDom(td, cellData.dg, cellData.t);
        bindDiagTd(td, {
          move: (dr, dc) => moveFocus(dr, dc),
          onZoneFocus: (zone) => {
            focusedR = r;
            focusedC = c;
            activeController = controller;
            prepareDiagEdit(td);
            td.dataset.vtDiagZone = zone.classList.contains("vt-diag-a") ? "a" : "b";
            showEditingUi();
            updateEdgeBars();
            syncFillHandle();
          },
          onExitCell: () => {
            moveFocus(1, 0);
          },
          onZoneLeave: () => {
            window.setTimeout(() => {
              if (td.contains(document.activeElement))
                return;
              finishDiagEdit();
            }, 0);
          }
        });
      } else {
        populateCell(td, cellData.t, grid, sourcePath, resolveImage, onTodoToggle(r, c), handleOpenLink);
      }
      const wysiwygCtx = {
        sourcePath,
        resolveImage,
        onTodoToggle: onTodoToggle(r, c),
        onOpenLink: handleOpenLink,
        onMdGridPaste: (r0, c0, rows) => {
          pasteGridRows(r0, c0, rows, false);
          clearSelection();
        },
        renderPasses: (el2) => {
          renderInlineCode(el2);
          renderMarkdown(el2);
          renderTodos(el2, onTodoToggle(r, c));
          renderImages(el2, sourcePath, resolveImage);
          renderWikiLinks(el2, handleOpenLink);
        }
      };
      if (!isDiag(cellData))
        attachWysiwyg(td, wysiwygCtx);
      td.addEventListener("pointerdown", (e) => {
        if (isDiag(cellData)) {
          td.dataset.vtDiagZone = pointInZoneA(td, e.clientX, e.clientY) ? "a" : "b";
        }
        if (!td.closest(".cm-editor") || e.button !== 0)
          return;
        const resetDown = () => {
          window.removeEventListener("pointerup", resetDown);
          window.removeEventListener("pointercancel", resetDown);
        };
        window.addEventListener("pointerup", resetDown);
        window.addEventListener("pointercancel", resetDown);
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
          e.preventDefault();
          const { r: r3, c: c3 } = tdCoords(td);
          startGesture(r3, c3);
          renderSel(normCell(r3, c3));
          return;
        }
        const { r: r2, c: c2 } = tdCoords(td);
        if ((import_obsidian3.Platform.isMobile || import_obsidian3.Platform.isTablet) && selRects.length) {
          if (selRects.some((rc) => rectContains(rc, r2, c2)))
            clearSelection();
          else
            e.preventDefault();
          return;
        }
        if (selRects.length)
          clearSelection();
      });
      td.addEventListener("focus", () => {
        if (!td.closest(".cm-editor")) {
          td.blur();
          return;
        }
        focusedR = r;
        focusedC = c;
        activeController = controller;
        if (isDiag(cellData)) {
          prepareDiagEdit(td);
          enterDiagZone(td);
          return;
        }
        if (td.dataset.vtView !== "edit") {
          td.dataset.vtView = "edit";
          const src = grid[r][c].t;
          enterWysiwyg(td, src, wysiwygCtx);
          placeCaretAtSourceOffset(td, src.length);
        }
        showEditingUi();
        updateEdgeBars();
        syncFillHandle();
        if (import_obsidian3.Platform.isDesktop && !settings.enableDesktopToolbar)
          return;
        if ((import_obsidian3.Platform.isMobile || import_obsidian3.Platform.isTablet) && !settings.enableMobileToolbar)
          return;
        toolbar.show(
          td,
          data,
          r,
          c,
          (s) => {
            const shift = toolbar.consumeFocusShift();
            applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
            onCommit(s);
          },
          flushActiveCell,
          () => onConvertToMd(grid),
          () => onConvertToHtml(grid),
          selOps
        );
      });
      const finishDiagEdit = () => {
        const cell2 = grid[r]?.[c];
        if (!cell2 || !isDiag(cell2))
          return;
        const aTxt = td.dataset.vtDiagA ?? cell2.dg;
        const bTxt = td.dataset.vtDiagB ?? cell2.t;
        delete td.dataset.vtDiagA;
        delete td.dataset.vtDiagB;
        delete td.dataset.vtDiagZone;
        const contentChanged = aTxt !== cell2.dg || bTxt !== cell2.t;
        if (contentChanged) {
          cell2.dg = aTxt;
          cell2.t = bTxt;
          pendingDirty = true;
        }
        if (!table.isConnected) {
          if (contentChanged) {
            commit();
            pendingDirty = false;
          }
          return;
        }
        autoExpandRowHeight(td, data, r, contentChanged);
        exitDiagEdit(td, cell2.dg, cell2.t);
        td.dataset.vtView = "view";
        if (table.contains(document.activeElement))
          return;
        if (Date.now() - lastTablePointerDown < 400)
          return;
        commit();
        const uiClick = document.body.dataset.vtBarClick === "1" || document.body.dataset.vtModeClick === "1";
        if (!uiClick) {
          toolbar.hide();
          hideEditingUi();
        }
        updateEdgeBars();
      };
      td.addEventListener("blur", (e) => {
        const cell2 = grid[r]?.[c];
        if (!cell2)
          return;
        fillHandle?.hide();
        if (isDiag(cell2)) {
          if (!td.contains(document.activeElement))
            finishDiagEdit();
          return;
        }
        const html = normalizeCellHtml(stripRcHandles(isWysiwyg(td) ? projectSource(td) : td.innerHTML));
        if (isWysiwyg(td))
          exitWysiwyg(td);
        const contentChanged = cell2.t !== html;
        if (contentChanged) {
          cell2.t = html;
          pendingDirty = true;
        }
        if (!table.isConnected) {
          if (contentChanged) {
            commit();
            pendingDirty = false;
          }
          return;
        }
        autoExpandRowHeight(td, data, r, contentChanged);
        populateCell(td, html, grid, sourcePath, resolveImage, onTodoToggle(r, c), handleOpenLink);
        td.dataset.vtView = "view";
        scheduleMathRender(td);
        if (e.relatedTarget) {
          const related = e.relatedTarget;
          if (related?.closest(".vt") !== td.closest(".vt")) {
            commit();
            const uiClick = document.body.dataset.vtBarClick === "1" || document.body.dataset.vtModeClick === "1";
            if (!uiClick) {
              toolbar.hide();
              if (!table.contains(document.activeElement))
                hideEditingUi();
            }
            updateEdgeBars();
          }
        } else {
          window.setTimeout(() => {
            if (!table.isConnected)
              return;
            if (table.contains(document.activeElement))
              return;
            if (Date.now() - lastTablePointerDown < 400)
              return;
            commit();
            const uiClick = document.body.dataset.vtBarClick === "1" || document.body.dataset.vtModeClick === "1";
            if (!uiClick) {
              toolbar.hide();
              hideEditingUi();
            }
            updateEdgeBars();
          }, 0);
        }
      });
      td.addEventListener("keydown", (e) => {
        if (!td.closest(".cm-editor"))
          return;
        if (isDiag(cellData) && e.target?.matches?.(".vt-diag-zone")) {
          if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A"))
            return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "a" || e.key === "A")) {
          e.preventDefault();
          e.stopPropagation();
          const sel = window.getSelection();
          sel?.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(td);
          sel?.addRange(range);
          return;
        }
        if (e.metaKey && !e.altKey && e.key === "Backspace" && !selRects.length) {
          e.preventDefault();
          if (grid.length > 1) {
            flushActiveCell();
            deleteRow(grid, focusedR);
            pendingFocusRestore = { r: Math.min(focusedR, grid.length - 1), c: focusedC, caretAtEnd: false };
            onCommit(serialize(data));
          }
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const delSel = window.getSelection();
          if (delSel && delSel.rangeCount > 0 && !delSel.isCollapsed) {
            e.preventDefault();
            e.stopPropagation();
            document.execCommand("delete");
            return;
          }
        }
        if (e.ctrlKey || e.metaKey || e.altKey)
          return;
        if (e.key === "Tab") {
          e.preventDefault();
          const dc = e.shiftKey ? -1 : 1;
          if (moveFocus(0, dc))
            return;
          if (dc > 0)
            moveFocus(1, -focusedC);
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight")
          return;
        if (e.shiftKey)
          return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const left = e.key === "ArrowLeft";
          const sel = window.getSelection();
          const caretInTd = !!sel && sel.rangeCount > 0 && sel.isCollapsed && !!sel.focusNode && td.contains(sel.focusNode);
          if (caretInTd) {
            const atEdge = left ? caretAtStart2(td) : caretAtEnd2(td);
            if (!atEdge)
              return;
          }
          e.preventDefault();
          moveFocus(0, left ? -1 : 1);
          return;
        }
        const up = e.key === "ArrowUp";
        const onEdge = up ? caretOnFirstLine(td) : caretOnLastLine(td);
        if (!onEdge)
          return;
        e.preventDefault();
        const selB = window.getSelection();
        let oldX = null;
        if (selB && selB.rangeCount > 0 && selB.isCollapsed) {
          const cr = selB.getRangeAt(0).getBoundingClientRect();
          if (!(cr.left === 0 && cr.top === 0 && cr.width === 0 && cr.height === 0)) {
            oldX = cr.left;
          }
        }
        const moved = up ? moveFocus(-1, 0) : moveFocus(1, 0);
        if (!moved)
          exitTable(td, up ? -1 : 1);
        else if (oldX != null) {
          const ntd = cellMap[focusedR]?.[focusedC];
          if (ntd)
            keepCaretXInTd(ntd, oldX);
        }
      });
      td.addEventListener("paste", (e) => {
        if (isWysiwyg(td))
          return;
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const md = parseMarkdownTable(text);
        if (md) {
          const { r: r2, c: c2 } = tdCoords(td);
          pasteGridRows(r2, c2, md, false);
          clearSelection();
          return;
        }
        document.execCommand("insertText", false, text);
      });
      td.addEventListener("contextmenu", (e) => {
        if (!td.closest(".cm-editor"))
          return;
        e.preventDefault();
        e.stopPropagation();
        const { r: r2, c: c2 } = tdCoords(td);
        const inSelection = selRects.some((rc) => rectContains(rc, r2, c2));
        if (selRects.length && !inSelection)
          clearSelection();
        showCellMenu(e, data, r2, c2, toolbar, flushActiveCell, (shift) => {
          applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
          onCommit(serialize(data));
        }, setMode, inSelection ? selOps : null, settings, obsidianCommand);
      });
    });
  });
  applyModeStyles(wrap, table, data, hsBar);
  bindRcResizeHandles(table, data, false, () => {
  });
  scheduleMathRender(table);
  const refreshHeader = () => {
    const style = settings.headerStyle ?? "none";
    const suppressed = (grid[0] ?? []).some((cd) => cd && visible(cd) && cd.rs > 1);
    if (style !== "none") {
      const cur = suppressed ? "1" : "0";
      if (el.dataset.vtHdrSupp !== void 0 && el.dataset.vtHdrSupp !== cur) {
        new import_obsidian3.Notice(suppressed ? "\u8868\u5934\u884C\u53C2\u4E0E\u4E86\u7EB5\u5411\u5408\u5E76\uFF0C\u8868\u5934\u5E95\u8272\u5DF2\u6682\u65F6\u505C\u7528" : "\u7EB5\u5411\u5408\u5E76\u5DF2\u62C6\u5206\uFF0C\u8868\u5934\u5E95\u8272\u5DF2\u6062\u590D");
      }
      el.dataset.vtHdrSupp = cur;
    } else {
      delete el.dataset.vtHdrSupp;
    }
    let bg = null;
    if (!suppressed && !data.noHeaderBg) {
      if (style === "theme") {
        bg = resolveThemeAccent(el) ?? "#7c3aed";
      } else if (style === "custom") {
        bg = (settings.headerColor ?? "").trim() || null;
      }
    }
    const rowCells = cellMap[0] ?? [];
    for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
      const td = rowCells[c];
      if (!td)
        continue;
      const cd = grid[0][c];
      if (bg) {
        td.style.background = bg;
        td.style.color = contrastTextColor(bg);
      } else if (cd.bg) {
        td.style.background = cd.bg;
        td.style.color = contrastTextColor(cd.bg);
      } else {
        td.style.background = ``;
        td.style.color = ``;
      }
    }
  };
  const refreshAppearance = () => {
    const radius = Math.max(0, Math.min(24, Math.round(settings.tableRadius ?? 0)));
    if (radius > 0) {
      wrap.style.borderRadius = `${radius}px`;
      wrap.addClass("vt-radius");
    } else {
      wrap.style.borderRadius = ``;
      wrap.removeClass("vt-radius");
    }
    refreshHeader();
    applyTableStyle();
  };
  appearanceRegistry.set(el, refreshAppearance);
  refreshAppearance();
  if (pendingSelectionRestore && pendingSelectionRestore.host === el) {
    const restore = pendingSelectionRestore.rects;
    pendingSelectionRestore = null;
    const maxR = grid.length - 1;
    const maxC = (grid[0]?.length ?? 1) - 1;
    selRects = restore.map((rc) => normalizeSelRect({
      r1: Math.max(0, Math.min(rc.r1, maxR)),
      c1: Math.max(0, Math.min(rc.c1, maxC)),
      r2: Math.max(0, Math.min(rc.r2, maxR)),
      c2: Math.max(0, Math.min(rc.c2, maxC))
    }, grid, anchorIndex)).filter((rc) => rc.r1 <= rc.r2 && rc.c1 <= rc.c2);
    renderSel();
  }
  const finishInitialFocus = (fr, fc) => {
    showEditingUi();
    const td = cellMap[fr]?.[fc];
    if (td && (import_obsidian3.Platform.isDesktop && settings.enableDesktopToolbar || (import_obsidian3.Platform.isMobile || import_obsidian3.Platform.isTablet) && settings.enableMobileToolbar)) {
      toolbar.show(
        td,
        data,
        fr,
        fc,
        (s) => {
          const shift = toolbar.consumeFocusShift();
          applyFocusRestore(shift?.dr ?? 0, shift?.dc ?? 0, shift?.resetCaret ?? false);
          onCommit(s);
        },
        flushActiveCell,
        () => onConvertToMd(grid),
        () => onConvertToHtml(grid),
        selOps
      );
    }
    const bringBack = () => {
      if (td && td.isConnected && table.contains(document.activeElement)) {
        td.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    window.requestAnimationFrame(bringBack);
    window.setTimeout(bringBack, 250);
  };
  latestRenderSource = source;
  latestFocusRunner = (r, c, caretAtEnd3, textOffset) => {
    const td = cellMap[r]?.[c];
    if (!td || !td.isConnected)
      return false;
    if (document.activeElement !== td) {
      if (!focusCell(r, c, caretAtEnd3, textOffset))
        return false;
      if (document.activeElement !== td)
        return false;
    }
    finishInitialFocus(r, c);
    return true;
  };
  if (pendingFocusRestore) {
    const req = pendingFocusRestore;
    if (req.expectSource !== void 0 && source !== req.expectSource) {
      if (req.expires !== void 0 && Date.now() > req.expires)
        pendingFocusRestore = null;
    } else {
      pendingFocusRestore = null;
      const fr = req.r, fc = req.c, caretAtEnd3 = req.caretAtEnd, textOffset = req.textOffset ?? null;
      const isCreation = req.expires !== void 0;
      const tryInitialFocus = () => {
        const td = cellMap[fr]?.[fc];
        if (!td || !td.isConnected) {
          if (isCreation && req.expires !== void 0 && Date.now() < req.expires) {
            pendingFocusRestore = req;
          }
          return;
        }
        if (document.activeElement === td || focusCell(fr, fc, caretAtEnd3, textOffset)) {
          if (document.activeElement === td) {
            finishInitialFocus(fr, fc);
            return;
          }
        }
        if (!isCreation)
          return;
        if (req.expires !== void 0 && Date.now() < req.expires) {
          const holder = document.activeElement;
          const yieldsToUser = holder != null && holder.instanceOf(HTMLElement) && holder !== document.body && !holder.closest(".cm-editor");
          if (!yieldsToUser)
            window.setTimeout(tryInitialFocus, 150);
        }
      };
      window.requestAnimationFrame(tryInitialFocus);
    }
  }
  if (pendingScrollAnchor && pendingScrollAnchor.host === el) {
    const anchor = pendingScrollAnchor;
    pendingScrollAnchor = null;
    const restore = () => {
      if (!anchor.scroller.isConnected || !el.isConnected || Date.now() > anchor.expires)
        return;
      if (Date.now() - lastTouchScrollAt < 800)
        return;
      const nowOffset = el.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top;
      const target = Math.max(0, anchor.scrollTop + (anchor.offsetTop - nowOffset));
      if (Math.abs(anchor.scroller.scrollTop - target) > 4) {
        anchor.scroller.scrollTop = target;
      }
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(restore));
    for (const t2 of [100, 250, 450, 700, 1e3, 1400, 1900, 2500, 3200, 4e3]) {
      window.setTimeout(restore, t2);
    }
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => clearVisualSnapshot(el)));
}
function caretAtStart2(td) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed)
    return false;
  const cr = sel.getRangeAt(0);
  if (!td.contains(cr.startContainer))
    return false;
  const probe = document.createRange();
  probe.selectNodeContents(td);
  probe.setEnd(cr.startContainer, cr.startOffset);
  return probe.toString().length === 0;
}
function caretAtEnd2(td) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed)
    return false;
  const cr = sel.getRangeAt(0);
  if (!td.contains(cr.endContainer))
    return false;
  const probe = document.createRange();
  probe.selectNodeContents(td);
  probe.setStart(cr.endContainer, cr.endOffset);
  return probe.toString().length === 0;
}
function caretLineTop(td) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.focusNode)
    return null;
  const node = sel.focusNode;
  const off = sel.focusOffset;
  const direct = Array.from(sel.getRangeAt(0).getClientRects());
  if (direct.length > 0)
    return direct[0].top;
  const probe = document.createRange();
  try {
    const len = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length;
    probe.setStart(node, off);
    probe.setEnd(node, Math.min(off + 1, len));
    if (!probe.collapsed) {
      const rects = Array.from(probe.getClientRects());
      if (rects.length > 0)
        return rects[0].top;
    }
    probe.setEnd(node, off);
    probe.setStart(node, Math.max(0, off - 1));
    if (!probe.collapsed) {
      const rects = Array.from(probe.getClientRects());
      if (rects.length > 0)
        return rects[rects.length - 1].top;
    }
  } catch {
  }
  return null;
}
function contentLineTop(td, first) {
  const range = document.createRange();
  range.selectNodeContents(td);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0)
    return null;
  return first ? Math.min(...rects.map((r) => r.top)) : Math.max(...rects.map((r) => r.top));
}
function caretOnFirstLine(td) {
  const top = caretLineTop(td);
  if (top === null)
    return true;
  const first = contentLineTop(td, true);
  if (first === null)
    return true;
  return top - first <= 6;
}
function caretOnLastLine(td) {
  const top = caretLineTop(td);
  if (top === null)
    return true;
  const last = contentLineTop(td, false);
  if (last === null)
    return true;
  return last - top <= 6;
}
function keepCaretXInTd(td, x) {
  const rect = td.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const doc = document;
  let node = null;
  let off = 0;
  try {
    const hit = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
    if (hit) {
      node = hit.startContainer;
      off = hit.startOffset;
    } else {
      const p = doc.caretPositionFromPoint ? doc.caretPositionFromPoint(x, y) : null;
      if (p) {
        node = p.offsetNode;
        off = p.offset;
      }
    }
  } catch {
    return;
  }
  if (!node)
    return;
  if (!td.contains(node)) {
    placeCaretAtTextOffset(td, x > rect.left + rect.width / 2 ? td.textContent?.length ?? 0 : 0);
    return;
  }
  const rng = document.createRange();
  rng.setStart(node, off);
  rng.collapse(true);
  const sel = window.getSelection();
  if (!sel)
    return;
  sel.removeAllRanges();
  sel.addRange(rng);
}
function normalizeCellHtml(html) {
  const trimmed = html.trim();
  if (!trimmed)
    return "";
  if (/^(?:(?:<div[^>]*>)?\s*<br\s*\/?>\s*(?:<\/div>)?|(?:&nbsp;|\u00a0|\s))+$/.test(trimmed))
    return "";
  return trimmed.replace(/^<(div|p)>\s*(<br\s*\/?>)?\s*<\/\1>/i, "").replace(/^(&nbsp;|\u00a0|\s)+/, "").replace(/&lt;(br\s*\/?)&gt;/gi, "<$1>");
}
function caretTextOffsetInTd(td) {
  if (isWysiwyg(td))
    return caretSourceOffset(td);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0)
    return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !td.contains(range.startContainer))
    return null;
  const probe = range.cloneRange();
  probe.selectNodeContents(td);
  try {
    probe.setEnd(range.startContainer, range.startOffset);
  } catch {
    return null;
  }
  const len = probe.toString().length;
  return Number.isFinite(len) ? len : null;
}
function placeCaretAtTextOffset(td, offset) {
  if (isWysiwyg(td))
    return placeCaretAtSourceOffset(td, offset);
  const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node;
  while (node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      const range = document.createRange();
      try {
        range.setStart(node, remaining);
        range.collapse(true);
        sel?.addRange(range);
      } catch {
        break;
      }
      return;
    }
    remaining -= len;
  }
  placeCaretFallbackAtEnd(td);
}
function placeCaretFallbackAtEnd(td) {
  const sel = window.getSelection();
  if (!sel)
    return;
  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
function shiftIndex(v, deltas) {
  const sorted = deltas.slice().sort((a, b) => a.at - b.at);
  let out = v;
  let cursor = 0;
  for (const { at, d } of sorted) {
    const atNow = at + cursor;
    if (d > 0) {
      if (out >= atNow)
        out += d;
      cursor += d;
    } else {
      const n = -d;
      if (out >= atNow && out <= atNow + n - 1)
        return -1;
      if (out > atNow + n - 1)
        out -= n;
      cursor -= n;
    }
  }
  return out;
}
function populateCell(td, raw, grid, sourcePath, resolveImage, onTodoToggle, onOpenLink) {
  td.replaceChildren(...parseTrustedHtml(raw).childNodes);
  if (/^=[A-Z]+\(/i.test(raw)) {
    td.textContent = evalFormula(grid, raw);
  }
  renderHtml(td);
  renderInlineCode(td);
  renderMarkdown(td);
  renderTodos(td, onTodoToggle);
  renderImages(td, sourcePath, resolveImage);
  renderWikiLinks(td, onOpenLink);
}
var MATH_RE = /\$\$([^$]+?)\$\$|\$(\S(?:[^$\n]*?\S)?)\$/g;
function renderMathInNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !text.includes("$"))
      continue;
    if (node.parentElement?.closest("code"))
      continue;
    targets.push(node);
  }
  let found = false;
  for (const textNode of targets) {
    const frag = splitMath(textNode.textContent);
    if (!frag)
      continue;
    textNode.replaceWith(frag);
    found = true;
  }
  return found;
}
function splitMath(text) {
  MATH_RE.lastIndex = 0;
  let match;
  let last = 0;
  let matched = false;
  const frag = createFragment();
  while (match = MATH_RE.exec(text)) {
    if (match.index > last)
      frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    const display = match[1] !== void 0;
    const source = (match[1] ?? match[2] ?? "").trim();
    try {
      frag.appendChild((0, import_obsidian3.renderMath)(source, display));
    } catch {
      frag.appendChild(document.createTextNode(match[0]));
    }
    matched = true;
    last = MATH_RE.lastIndex;
  }
  if (!matched)
    return null;
  if (last < text.length)
    frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}
function renderHtml(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !text.includes("<"))
      continue;
    if (node.parentElement?.closest("code"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    const text = textNode.textContent;
    if (!/<[a-z][a-z0-9]*\b[^>]*>/i.test(text) && !/<\/[a-z]+>/i.test(text))
      continue;
    textNode.replaceWith(...parseTrustedHtml(text).childNodes);
  }
}
function renderMarkdown(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !/[*_~=`]/.test(text))
      continue;
    if (node.parentElement?.closest("b, i, mark, s, a, code, img, label"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    const html = mdInlineToHtml(textNode.textContent);
    if (html === textNode.textContent)
      continue;
    textNode.replaceWith(...parseTrustedHtml(html).childNodes);
  }
}
function renderInlineCode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !text.includes("`"))
      continue;
    if (node.parentElement?.closest("code"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    if (!/`[^`]+`/.test(textNode.textContent))
      continue;
    const html = mdInlineToHtml(textNode.textContent);
    if (html === textNode.textContent)
      continue;
    textNode.replaceWith(...parseTrustedHtml(html).childNodes);
  }
}
var TODO_LINE_RE = /^-\s*\[([ xX])\]\s*(.*)$/;
function renderTodos(root, onTodoToggle) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !/-\s*\[[ xX]\]/.test(text))
      continue;
    if (node.parentElement?.closest("code, label"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    const text = textNode.textContent;
    const lines = text.split("\n");
    let hasTodo = false;
    const frag = createFragment();
    const buildTaskItem = (m) => {
      hasTodo = true;
      const item = createDiv();
      item.className = "vt-task-item";
      const cb = createEl("input");
      cb.type = "checkbox";
      cb.checked = m[1] !== " ";
      cb.dataset.vtOn = cb.checked ? "1" : "0";
      cb.tabIndex = -1;
      cb.style.margin = `0.225em 0 0`;
      cb.style.fontSize = `inherit`;
      cb.style.width = `1em`;
      cb.style.height = `1em`;
      cb.style.boxSizing = `border-box`;
      const hit = createSpan();
      hit.className = "vt-cb-hit";
      hit.style.display = `inline-flex`;
      hit.style.padding = `5px`;
      hit.style.margin = `-5px`;
      hit.style.marginTop = `calc(-5px + 0.1em)`;
      hit.style.cursor = `pointer`;
      hit.style.borderRadius = `4px`;
      hit.addEventListener("mousedown", (e) => e.preventDefault());
      if (onTodoToggle) {
        hit.addEventListener("pointerdown", (e) => e.stopPropagation());
        hit.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!root.closest(".cm-editor"))
            return;
          const boxes = Array.from(root.querySelectorAll('.vt-task-item input[type="checkbox"]'));
          const idx = boxes.indexOf(cb);
          if (idx < 0)
            return;
          const next = cb.dataset.vtOn !== "1";
          cb.checked = next;
          cb.dataset.vtOn = next ? "1" : "0";
          onTodoToggle(idx, next);
        });
      }
      hit.appendChild(cb);
      item.appendChild(hit);
      const span = createSpan();
      span.textContent = m[2] ?? "";
      item.appendChild(span);
      return item;
    };
    const outs = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(TODO_LINE_RE);
      if (m) {
        outs.push({ kind: "task", s: line, m });
        continue;
      }
      if (!line.trim()) {
        let nx = -1;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim()) {
            nx = j;
            break;
          }
        }
        if (nx >= 0 && TODO_LINE_RE.test(lines[nx]))
          continue;
      }
      outs.push({ kind: "text", s: line + (i < lines.length - 1 ? "\n" : "") });
    }
    for (let i = 0; i < outs.length; i++) {
      if (outs[i].kind !== "task")
        continue;
      const prev = outs[i - 1];
      if (prev && prev.kind === "text")
        prev.s = prev.s.replace(/\n+$/, "");
      const next = outs[i + 1];
      if (next && next.kind === "text")
        next.s = next.s.replace(/^\n+/, "");
    }
    for (const out of outs) {
      if (out.kind === "task") {
        frag.appendChild(buildTaskItem(out.m));
      } else if (out.s) {
        frag.appendChild(document.createTextNode(out.s));
      }
    }
    if (!hasTodo)
      continue;
    const head = frag.firstChild;
    const tail = frag.lastChild;
    textNode.replaceWith(frag);
    const isItem = (n) => !!n && n.nodeName === "DIV" && n.classList.contains("vt-task-item");
    if (isItem(tail)) {
      let s = tail.nextSibling;
      while (s && s.nodeName === "BR") {
        const nx = s.nextSibling;
        s.remove();
        s = nx;
      }
    }
    if (isItem(head)) {
      let s = head.previousSibling;
      while (s && s.nodeName === "BR") {
        const pv = s.previousSibling;
        s.remove();
        s = pv;
      }
    }
  }
}
var IMG_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
function renderImages(root, sourcePath, resolveImage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !text.includes("!"))
      continue;
    if (node.parentElement?.closest("code, img"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    IMG_RE.lastIndex = 0;
    const text = textNode.textContent;
    let match;
    let last = 0;
    let found = false;
    const frag = createFragment();
    while (match = IMG_RE.exec(text)) {
      if (match.index > last)
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      if (isWikiLinkInsideBackticks(text, match.index)) {
        frag.appendChild(document.createTextNode(match[0]));
        found = true;
        last = IMG_RE.lastIndex;
        continue;
      }
      const linkText = match[1].trim();
      const sizeText = (match[2] ?? "").trim();
      const sizeNum = /^\d+$/.test(sizeText) ? parseInt(sizeText, 10) : null;
      const altText = sizeNum === null ? sizeText : "";
      const src = resolveImage(linkText);
      if (src) {
        const img = createEl("img");
        img.src = src;
        img.alt = altText || linkText;
        img.style.maxWidth = `100%`;
        if (sizeNum !== null)
          img.style.width = `${sizeNum}px`;
        frag.appendChild(img);
      } else {
        frag.appendChild(document.createTextNode(match[0]));
      }
      found = true;
      last = IMG_RE.lastIndex;
    }
    if (!found)
      continue;
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  }
}
var WIKILINK_RE = /\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
function renderWikiLinks(root, onOpenLink) {
  if (!onOpenLink)
    return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (text && text.includes("[["))
      targets.push(node);
  }
  for (const textNode of targets) {
    const text = textNode.textContent;
    WIKILINK_RE.lastIndex = 0;
    if (!WIKILINK_RE.test(text))
      continue;
    const frag = createFragment();
    let last = 0;
    WIKILINK_RE.lastIndex = 0;
    let m;
    while (m = WIKILINK_RE.exec(text)) {
      if (m.index > 0 && text[m.index - 1] === "!")
        continue;
      if (isWikiLinkInsideBackticks(text, m.index))
        continue;
      if (m.index > last)
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const linkText = m[1].trim();
      const display = m[2]?.trim() || linkText;
      const a = createEl("a");
      a.className = "internal-link";
      a.href = linkText;
      a.textContent = display;
      let jumped = false;
      const jump = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (jumped)
          return;
        jumped = true;
        window.setTimeout(() => {
          jumped = false;
        }, 500);
        onOpenLink(linkText);
      };
      a.addEventListener("pointerdown", jump);
      a.addEventListener("click", jump);
      frag.appendChild(a);
      last = WIKILINK_RE.lastIndex;
    }
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  }
}
function cellPlainText(html) {
  return parseTrustedHtml(html.replace(/<br\s*\/?>/gi, "\n")).textContent ?? "";
}
function copyCtxToClipboard(ctx) {
  let text = "";
  if (ctx.sel && ctx.sel.rects.length) {
    const lines = [];
    for (const rc of ctx.sel.rects) {
      for (let r = rc.r1; r <= rc.r2; r++) {
        const cells = [];
        for (let c = rc.c1; c <= rc.c2; c++) {
          const cd = ctx.grid[r]?.[c];
          cells.push(cd ? cellPlainText(cd.t) : "");
        }
        lines.push(cells.join("	"));
      }
    }
    text = lines.join("\n");
  } else {
    const cd = ctx.grid[ctx.r]?.[ctx.c];
    text = cd ? cellPlainText(cd.t) : "";
  }
  try {
    void navigator.clipboard?.writeText(text)?.catch?.(() => {
    });
  } catch {
  }
}
function clearCtxContent(ctx) {
  if (ctx.sel && ctx.sel.rects.length) {
    ctx.sel.clearContent();
    return;
  }
  ctx.apply(() => {
    ctx.grid[ctx.r][ctx.c].t = "";
  });
}
function plainToCellHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}
function pasteCtxFromClipboard(ctx) {
  void navigator.clipboard?.readText?.()?.then((text) => {
    if (!text)
      return;
    const rows = text.replace(/\r/g, "").split("\n").map((l) => l.split("	"));
    if (ctx.sel && ctx.sel.rects.length) {
      const rc = ctx.sel.rects[0];
      ctx.apply(() => {
        for (let dr = 0; dr < rows.length; dr++) {
          for (let dc = 0; dc < rows[dr].length; dc++) {
            const cd = ctx.grid[rc.r1 + dr]?.[rc.c1 + dc];
            if (!cd || !visible(cd))
              continue;
            cd.t = plainToCellHtml(rows[dr][dc]);
          }
        }
      });
      return;
    }
    ctx.apply(() => {
      const cd = ctx.grid[ctx.r]?.[ctx.c];
      if (!cd)
        return;
      cd.t = plainToCellHtml(text);
    });
  }).catch(() => {
    new import_obsidian3.Notice(t("\u65E0\u6CD5\u8BFB\u53D6\u526A\u8D34\u677F\uFF08\u53EF\u80FD\u672A\u6388\u6743\uFF09", "Cannot read clipboard (permission denied)"));
  });
}
function alignCtx(ctx, mode) {
  if (ctx.sel) {
    ctx.sel.align(mode);
    return;
  }
  ctx.apply(() => {
    const cd = ctx.grid[ctx.r]?.[ctx.c];
    if (!cd)
      return;
    if (mode === "l")
      delete cd.a;
    else
      cd.a = mode;
  });
}
function alignVCtx(ctx, mode) {
  if (ctx.sel) {
    ctx.sel.alignV(mode);
    return;
  }
  ctx.apply(() => {
    const cd = ctx.grid[ctx.r]?.[ctx.c];
    if (!cd)
      return;
    if (mode === "t")
      delete cd.va;
    else
      cd.va = mode;
  });
}
var VT_MENU_ACTIONS = {
  "vt.copy": { zh: "\u590D\u5236", en: "Copy", icon: "copy", exec: (ctx) => copyCtxToClipboard(ctx) },
  "vt.paste": { zh: "\u7C98\u8D34", en: "Paste", icon: "clipboard-paste", exec: (ctx) => pasteCtxFromClipboard(ctx) },
  "vt.cut": {
    zh: "\u526A\u5207",
    en: "Cut",
    icon: "scissors",
    exec: (ctx) => {
      copyCtxToClipboard(ctx);
      clearCtxContent(ctx);
    }
  },
  "vt.delete": { zh: "\u5220\u9664\u5185\u5BB9", en: "Delete content", icon: "eraser", exec: (ctx) => clearCtxContent(ctx) },
  "vt.clearContent": { zh: "\u6E05\u7A7A\u6240\u9009\u5185\u5BB9", en: "Clear selection", icon: "eraser", needsSel: true, exec: (ctx) => ctx.sel.clearContent() },
  "vt.bold": { zh: "\u52A0\u7C97", en: "Bold", icon: "bold", needsSel: true, exec: (ctx) => ctx.sel.bold() },
  "vt.italic": { zh: "\u659C\u4F53", en: "Italic", icon: "italic", needsSel: true, exec: (ctx) => ctx.sel.italic() },
  // 对齐六项不设 needsSel：有选区走选区批量；无选区（右键单格，ctx.sel=null）对右键格直接生效
  "vt.alignL": { zh: "\u5C45\u5DE6", en: "Align left", icon: "align-left", exec: (ctx) => alignCtx(ctx, "l") },
  "vt.alignC": { zh: "\u5C45\u4E2D", en: "Align center", icon: "align-center", exec: (ctx) => alignCtx(ctx, "c") },
  "vt.alignR": { zh: "\u5C45\u53F3", en: "Align right", icon: "align-right", exec: (ctx) => alignCtx(ctx, "r") },
  "vt.alignT": { zh: "\u9876\u5BF9\u9F50", en: "Align top", icon: "arrow-up-to-line", exec: (ctx) => alignVCtx(ctx, "t") },
  "vt.alignM": { zh: "\u5782\u76F4\u5C45\u4E2D", en: "Align middle", icon: "align-vertical-justify-center", exec: (ctx) => alignVCtx(ctx, "m") },
  "vt.alignB": { zh: "\u5E95\u5BF9\u9F50", en: "Align bottom", icon: "arrow-down-to-line", exec: (ctx) => alignVCtx(ctx, "b") },
  "vt.pickColor": { zh: "\u8BBE\u7F6E\u5E95\u8272\u2026", en: "Set color\u2026", icon: "paintbrush", needsSel: true, exec: (ctx) => ctx.sel.pickColor() },
  "vt.insRowAbove": {
    zh: "\u4E0A\u65B9\u63D2\u5165\u884C",
    en: "Insert row above",
    icon: "arrow-up",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.insRowAbove();
        return;
      }
      const fr = ctx.focusR();
      ctx.apply(() => insertRow(ctx.grid, ctx.r - 1), { dr: fr >= 0 && fr >= ctx.r ? 1 : 0 });
    }
  },
  "vt.insRowBelow": {
    zh: "\u4E0B\u65B9\u63D2\u5165\u884C",
    en: "Insert row below",
    icon: "arrow-down",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.insRowBelow();
        return;
      }
      const fr = ctx.focusR();
      ctx.apply(() => insertRow(ctx.grid, ctx.r), { dr: fr >= 0 && fr > ctx.r ? 1 : 0 });
    }
  },
  "vt.delRow": {
    zh: "\u5220\u9664\u672C\u884C",
    en: "Delete row",
    icon: "trash",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.delRows();
        return;
      }
      ctx.apply(() => deleteRow(ctx.grid, ctx.r), { dr: -1, resetCaret: true });
    }
  },
  "vt.insColLeft": {
    zh: "\u5DE6\u4FA7\u63D2\u5165\u5217",
    en: "Insert column left",
    icon: "arrow-left",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.insColLeft();
        return;
      }
      const fc = ctx.focusC();
      ctx.apply(() => insertCol(ctx.grid, ctx.c - 1), { dc: fc >= 0 && fc >= ctx.c ? 1 : 0 });
    }
  },
  "vt.insColRight": {
    zh: "\u53F3\u4FA7\u63D2\u5165\u5217",
    en: "Insert column right",
    icon: "arrow-right",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.insColRight();
        return;
      }
      const fc = ctx.focusC();
      ctx.apply(() => insertCol(ctx.grid, ctx.c), { dc: fc >= 0 && fc > ctx.c ? 1 : 0 });
    }
  },
  "vt.delCol": {
    zh: "\u5220\u9664\u672C\u5217",
    en: "Delete column",
    icon: "trash",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.delCols();
        return;
      }
      ctx.apply(() => deleteCol(ctx.grid, ctx.c), { dc: -1, resetCaret: true });
    }
  },
  "vt.mergeRight": {
    zh: "\u5411\u53F3\u5408\u5E76",
    en: "Merge right",
    icon: "arrow-right-to-line",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.merge();
        return;
      }
      ctx.apply(
        () => mergeRight(ctx.grid, ctx.r, ctx.c),
        { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true }
      );
    }
  },
  "vt.mergeDown": {
    zh: "\u5411\u4E0B\u5408\u5E76",
    en: "Merge down",
    icon: "arrow-down-to-line",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.merge();
        return;
      }
      ctx.apply(
        () => mergeDown(ctx.grid, ctx.r, ctx.c),
        { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true }
      );
    }
  },
  "vt.split": {
    zh: "\u62C6\u5206\u5355\u5143\u683C",
    en: "Split cell",
    icon: "split-square-horizontal",
    exec: (ctx) => {
      if (ctx.sel?.rects.length) {
        ctx.sel.split();
        return;
      }
      ctx.apply(
        () => splitCell(ctx.grid, ctx.r, ctx.c),
        { dr: ctx.r - ctx.focusR(), dc: ctx.c - ctx.focusC(), resetCaret: true }
      );
    }
  },
  "vt.modeOL": { zh: "\u5207\u6362\u5230 OL \u6A21\u5F0F", en: "OL mode", icon: "list", checked: (ctx) => ctx.data.mode === "OL", exec: (ctx) => ctx.setMode("OL") },
  "vt.modeHS": { zh: "\u5207\u6362\u5230 HS \u6A21\u5F0F", en: "HS mode", icon: "move-horizontal", checked: (ctx) => ctx.data.mode === "HS", exec: (ctx) => ctx.setMode("HS") },
  "vt.modeRC": { zh: "\u5207\u6362\u5230 RC \u6A21\u5F0F", en: "RC mode", icon: "table", checked: (ctx) => ctx.data.mode === "RC", exec: (ctx) => ctx.setMode("RC") }
};
var DEFAULT_CONTEXT_MENU = [
  "vt.copy",
  "vt.paste",
  "vt.cut",
  "vt.delete",
  "---",
  "vt.insRowAbove",
  "vt.insRowBelow",
  "vt.delRow",
  "---",
  "vt.insColLeft",
  "vt.insColRight",
  "vt.delCol",
  "---",
  "vt.alignL\uFF5Cvt.alignC\uFF5Cvt.alignR",
  "vt.alignT\uFF5Cvt.alignM\uFF5Cvt.alignB",
  "vt.pickColor",
  "---",
  "vt.mergeRight",
  "vt.mergeDown",
  "vt.split",
  "---",
  "vt.modeOL",
  "vt.modeHS",
  "vt.modeRC"
].join("\n");
function parseMenuConfig(src) {
  const out = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line)
      continue;
    if (line === "---") {
      if (out.length && out[out.length - 1].kind !== "sep")
        out.push({ kind: "sep" });
      continue;
    }
    if (line.includes("\uFF5C")) {
      const ids = line.split("\uFF5C").map((s) => s.trim()).filter(Boolean);
      if (ids.length)
        out.push({ kind: "group", ids });
      continue;
    }
    const bar = line.indexOf("|");
    out.push(bar >= 0 ? { kind: "act", id: line.slice(0, bar).trim(), icon: line.slice(bar + 1).trim() || void 0 } : { kind: "act", id: line });
  }
  while (out.length && out[out.length - 1].kind === "sep")
    out.pop();
  return out;
}
function buildCellMenu(settings, ctx, obsidianCommand) {
  const menu = new import_obsidian3.Menu();
  for (const spec of parseMenuConfig(settings.contextMenu || DEFAULT_CONTEXT_MENU)) {
    if (spec.kind === "sep") {
      menu.addSeparator();
      continue;
    }
    if (spec.kind === "group") {
      const acts = spec.ids.map((id) => VT_MENU_ACTIONS[id]).filter((a) => !!a);
      if (!acts.length)
        continue;
      if (acts.some((a) => a.needsSel) && !(ctx.sel && ctx.sel.rects.length))
        continue;
      menu.addItem((i) => {
        i.setTitle("");
        const wrap = i.titleEl.createSpan({ cls: "vt-menu-icons" });
        acts.forEach((act2, idx) => {
          if (idx > 0)
            wrap.createSpan({ cls: "vt-menu-icon-sep" });
          const btn = wrap.createSpan({
            cls: "vt-menu-icon" + (act2.checked?.(ctx) ? " is-checked" : ""),
            attr: { "aria-label": t(act2.zh, act2.en) }
          });
          (0, import_obsidian3.setIcon)(btn, act2.icon || "circle");
          btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            menu.close();
            act2.exec(ctx);
          });
        });
      });
      continue;
    }
    if (spec.id.startsWith("cmd:")) {
      const cmd = obsidianCommand(spec.id.slice(4));
      if (!cmd)
        continue;
      menu.addItem((i) => i.setTitle(cmd.name).setIcon(spec.icon || "lucide-terminal").onClick(() => cmd.run()));
      continue;
    }
    const act = VT_MENU_ACTIONS[spec.id];
    if (!act)
      continue;
    if (act.needsSel && !(ctx.sel && ctx.sel.rects.length))
      continue;
    menu.addItem((i) => {
      i.setTitle(t(act.zh, act.en)).setIcon(spec.icon || act.icon);
      if (act.checked?.(ctx))
        i.setChecked(true);
      i.onClick(() => act.exec(ctx));
    });
  }
  return menu;
}
function showCellMenu(e, data, r, c, toolbar, flushCell, onCommit, setMode, sel, settings, obsidianCommand) {
  const grid = data.rows;
  const apply = (fn, shift) => {
    flushCell();
    fn();
    onCommit(shift);
  };
  const focusR = () => document.activeElement != null && document.activeElement.instanceOf(HTMLElement) ? parseInt(document.activeElement.dataset.vtR ?? "-1", 10) : -1;
  const focusC = () => document.activeElement != null && document.activeElement.instanceOf(HTMLElement) ? parseInt(document.activeElement.dataset.vtC ?? "-1", 10) : -1;
  const ctx = { r, c, grid, data, apply, sel, setMode, focusR, focusC };
  buildCellMenu(settings, ctx, obsidianCommand).showAtMouseEvent(e);
}
function isWikiLinkInsideBackticks(text, matchIndex) {
  const before = text.slice(0, matchIndex);
  const tickCount = (before.match(/`/g) ?? []).length;
  return tickCount % 2 === 1;
}

// src/bar.ts
var Toolbar = class {
  constructor() {
    this.cell = null;
    this.data = null;
    this.cellR = 0;
    this.cellC = 0;
    this.onCommit = null;
    this.flushCell = null;
    this.onConvertToMd = null;
    this.onConvertToHtml = null;
    this.selOps = null;
    /** 单格结构操作待消费的聚焦修正（bug2：光标跟随原格） */
    this.focusShift = null;
    this.animated = false;
    this.animatedTimer = null;
    this.el = document.body.createDiv({ cls: "vt-bar" });
    this.el.style.display = `none`;
    this.buildRows();
  }
  /* ===== 构建两行 ===== */
  /** 语言切换后重建按钮（label/title 跟随当前 UI 语言） */
  rebuild() {
    this.el.empty();
    this.buildRows();
  }
  buildRows() {
    const row1 = this.el.createDiv({ cls: "vt-bar-row" });
    const fmtDefs = [
      ["B", t("\u52A0\u7C97", "Bold"), () => this.fmt("bold")],
      ["I", t("\u659C\u4F53", "Italic"), () => this.fmt("italic")],
      ["A-", t("\u7F29\u5C0F\u5B57\u53F7", "Smaller"), () => this.stepFont(-2)],
      ["A+", t("\u653E\u5927\u5B57\u53F7", "Larger"), () => this.stepFont(2)]
    ];
    for (const [label, hint, fn] of fmtDefs) {
      const btn = row1.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        document.body.dataset.vtBarClick = "1";
        fn();
        window.setTimeout(() => {
          delete document.body.dataset.vtBarClick;
        }, 200);
      });
    }
    row1.createSpan({ cls: "vt-bar-sep" });
    const splitBtn = row1.createEl("button", { cls: "vt-bar-btn", text: t("\u62C6", "SP") });
    splitBtn.title = t("\u62C6\u5206\u5355\u5143\u683C", "Split cell");
    splitBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.structOp("split", splitCell);
    });
    const mergeDefs = [
      [t("\u5408\u2193", "M\u2193"), t("\u5411\u4E0B\u5408\u5E76\u5355\u5143\u683C", "Merge down"), mergeDown],
      [t("\u5408\u2192", "M\u2192"), t("\u5411\u53F3\u5408\u5E76\u5355\u5143\u683C", "Merge right"), mergeRight]
    ];
    for (const [label, hint, fn] of mergeDefs) {
      const btn = row1.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.structOp("merge", fn);
      });
    }
    const row2 = this.el.createDiv({ cls: "vt-bar-row" });
    const opDefs = [
      [t("\uFF0B\u884C", "+R"), "insRowBelow", t("\u4E0B\u65B9\u63D2\u5165\u884C", "Insert row below"), (g, r) => insertRow(g, r)],
      [t("\uFF0B\u5217", "+C"), "insColRight", t("\u53F3\u4FA7\u63D2\u5165\u5217", "Insert column right"), (g, _r, c) => insertCol(g, c)],
      [t("\uFF0D\u884C", "-R"), "delRows", t("\u5220\u9664\u672C\u884C", "Delete row"), (g, r) => deleteRow(g, r)],
      [t("\uFF0D\u5217", "-C"), "delCols", t("\u5220\u9664\u672C\u5217", "Delete column"), (g, _r, c) => deleteCol(g, c)]
    ];
    for (const [label, kind, hint, fn] of opDefs) {
      const btn = row2.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.structOp(kind, fn);
      });
    }
    row2.createSpan({ cls: "vt-bar-sep" });
    const mdBtn = row2.createEl("button", { cls: "vt-bar-btn", text: "MD" });
    mdBtn.title = t("\u8F6C\u6362\u4E3A markdown \u8868\u683C", "Convert to Markdown table");
    mdBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const convert = this.onConvertToMd;
      document.body.dataset.vtBarClick = "1";
      this.hide();
      if (convert)
        convert();
      window.setTimeout(() => {
        delete document.body.dataset.vtBarClick;
      }, 200);
    });
    const htmlBtn = row2.createEl("button", { cls: "vt-bar-btn", text: "H5" });
    htmlBtn.title = t("\u8F6C\u6362\u4E3A HTML \u8868\u683C", "Convert to HTML table");
    htmlBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const convert = this.onConvertToHtml;
      document.body.dataset.vtBarClick = "1";
      this.hide();
      if (convert)
        convert();
      window.setTimeout(() => {
        delete document.body.dataset.vtBarClick;
      }, 200);
    });
  }
  /** 执行结构操作：有选区 → 按选区批量执行；无选区 → 单格（原有行为 + 光标位置保持） */
  structOp(kind, fn) {
    if (this.selActive()) {
      this.selOps[kind]();
      return;
    }
    if (!this.data || !this.onCommit)
      return;
    this.flushCell?.();
    const g = this.data.rows;
    const commit = this.onCommit;
    const r = this.cellR;
    const c = this.cellC;
    const shifts = {
      insRowBelow: { dr: 0 },
      // 行插在聚焦行下方 → 聚焦行不动
      insColRight: { dc: 0 },
      // 列插在聚焦列右侧 → 聚焦列不动
      delRows: { dr: -1, resetCaret: true },
      // 聚焦行被删 → 落到上一行
      delCols: { dc: -1, resetCaret: true },
      // 聚焦列被删 → 落到左一列
      merge: { resetCaret: true }
      // 合并后内容变化 → 光标落格首
    };
    this.focusShift = shifts[kind] ?? null;
    fn(g, r, c);
    commit(serialize(this.data));
    this.focusShift = null;
  }
  /** 提交闭包消费聚焦修正（一次性） */
  consumeFocusShift() {
    const s = this.focusShift;
    this.focusShift = null;
    return s;
  }
  /** bug1：浮窗引用的单元格已脱离 DOM（重渲染/切标签页）时立即隐藏，防止幽灵浮窗 */
  hideIfStale() {
    if (this.cell && !this.cell.isConnected)
      this.hide();
  }
  /** 富文本格式：有选区 → 逐格整块包裹；无选区 → 聚焦格整格包裹（源码域）。
   *  单格不再走 execCommand：其 DOM 修改会被 wysiwyg 源码投影丢弃（加粗/斜体不保存），
   *  改与选区批量同语义直接包 grid 源码，经 commit 重渲染后持久化 */
  fmt(cmd) {
    if (this.selActive()) {
      this.selOps[cmd]();
      return;
    }
    const tag = cmd === "bold" ? "b" : "i";
    this.structOp(cmd, (g, r, c) => {
      const cd = g[r]?.[c];
      if (cd)
        cd.t = toggleWrapTag(cd.t, tag);
    });
  }
  selActive() {
    return !!this.selOps && this.selOps.rects.length > 0;
  }
  /* ===== 显示/隐藏/定位 ===== */
  show(cell2, data, r, c, onCommit, flushCell, onConvertToMd, onConvertToHtml, selOps = null) {
    this.cell = cell2;
    this.data = data;
    this.cellR = r;
    this.cellC = c;
    this.onCommit = onCommit;
    this.flushCell = flushCell;
    this.onConvertToMd = onConvertToMd;
    this.onConvertToHtml = onConvertToHtml;
    this.selOps = selOps;
    if (this.animatedTimer !== null) {
      window.clearTimeout(this.animatedTimer);
      this.animatedTimer = null;
    }
    const animate = !this.animated;
    if (!this.prepareVisible(animate))
      return;
    if (animate) {
      this.animated = true;
      this.el.style.transition = ``;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          this.el.style.transform = `scale(1) translateY(0)`;
          this.el.style.opacity = `1`;
          this.reposition();
        });
      });
    }
    this.scheduleRepositionRetries();
  }
  /** 先隐藏布局再测量尺寸，避免首次显示时 offsetWidth 为 0 导致定位偏移 */
  prepareVisible(animate) {
    this.el.style.transition = `none`;
    this.el.style.visibility = `hidden`;
    this.el.style.display = `flex`;
    this.el.style.transform = animate ? "scale(0.8) translateY(6px)" : "scale(1) translateY(0)";
    this.el.style.opacity = animate ? "0.7" : "1";
    void this.el.offsetWidth;
    if (!this.reposition()) {
      this.el.style.display = `none`;
      this.el.style.visibility = ``;
      return false;
    }
    this.el.style.visibility = `visible`;
    void this.el.offsetWidth;
    return true;
  }
  /** Obsidian 刚启动时编辑器布局可能尚未稳定，短延迟内重算位置 */
  scheduleRepositionRetries() {
    window.requestAnimationFrame(() => this.reposition());
    window.setTimeout(() => this.reposition(), 0);
    window.setTimeout(() => this.reposition(), 120);
  }
  hide() {
    this.el.style.transform = ``;
    this.el.style.opacity = ``;
    this.el.style.display = `none`;
    this.cell = null;
    this.data = null;
    this.onCommit = null;
    this.flushCell = null;
    this.onConvertToMd = null;
    this.onConvertToHtml = null;
    this.selOps = null;
    if (this.animatedTimer !== null)
      window.clearTimeout(this.animatedTimer);
    this.animatedTimer = window.setTimeout(() => {
      this.animated = false;
      this.animatedTimer = null;
    }, 400);
  }
  reposition() {
    const scroller = document.querySelector(".workspace-leaf.mod-active .cm-scroller");
    if (!scroller)
      return false;
    const sRect = scroller.getBoundingClientRect();
    if (sRect.width <= 0 || sRect.height <= 0)
      return false;
    const w = this.el.offsetWidth || 280;
    const isMobile = document.body.classList.contains("is-mobile") || document.body.classList.contains("is-tablet");
    const hRef = isMobile ? scroller : scroller.querySelector(".cm-content") ?? scroller;
    const hRect = hRef.getBoundingClientRect();
    const refRect = hRect.width > 50 ? hRect : sRect;
    const left = Math.max(8, Math.min(
      refRect.left + (refRect.width - w) / 2,
      window.innerWidth - w - 8
    ));
    this.el.style.position = `fixed`;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${sRect.top + sRect.height * 0.8}px`;
    this.el.style.zIndex = `9999`;
    return true;
  }
  /* ===== 文本格式化 ===== */
  exec(cmd, value) {
    document.execCommand(cmd, false, value);
  }
  stepFont(delta) {
    if (this.selActive()) {
      this.selOps.fontStep(delta);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0)
      return;
    const range = sel.getRangeAt(0);
    const anchor = range.startContainer.parentElement;
    if (!anchor)
      return;
    const cur = parseFloat(getComputedStyle(anchor).fontSize) || 16;
    const next = Math.max(8, Math.min(72, cur + delta));
    if (!sel.isCollapsed) {
      const span = createSpan();
      span.style.fontSize = `${next}px`;
      try {
        range.surroundContents(span);
      } catch {
      }
    } else if (this.cell) {
      this.cell.style.fontSize = `${next}px`;
    }
  }
  destroy() {
    if (this.animatedTimer !== null)
      window.clearTimeout(this.animatedTimer);
    this.el.remove();
  }
};

// src/vbarchart.ts
var HEADER_LABELS = ["vbarchart", "\u6807\u9898", "v%", "x\u8303\u56F4", "x", "y\u8303\u56F4", "y"];
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function generateBarChart(grid) {
  if (grid.length < 8)
    return null;
  for (let i = 0; i < HEADER_LABELS.length; i++) {
    const cellText = grid[i]?.[0]?.t?.trim() ?? "";
    if (cellText !== HEADER_LABELS[i])
      return null;
  }
  const get = (idx) => grid[idx]?.[1]?.t?.trim() ?? "";
  const title = get(1);
  const vPercent = get(2);
  const xLabel = get(4);
  const yLabel = get(6);
  const showPercent = vPercent === "\u662F" || vPercent === "yes" || vPercent === "1";
  let yMax = 100;
  const yRangeRaw = get(5);
  const yMatch = yRangeRaw.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (yMatch)
    yMax = parseFloat(yMatch[2]);
  const data = [];
  for (let i = 7; i < grid.length; i++) {
    const label = grid[i]?.[0]?.t?.trim();
    const valStr = grid[i]?.[1]?.t?.trim();
    if (!label || !valStr)
      continue;
    if (/^…+/.test(label))
      continue;
    const value = parseFloat(valStr.replace(/[^0-9.-]/g, ""));
    if (isNaN(value))
      continue;
    data.push({ label, value });
  }
  if (data.length === 0)
    return null;
  const n = data.length;
  const chartTop = 80;
  const chartBottom = 330;
  const chartHeight = chartBottom - chartTop;
  const chartLeft = 80;
  const chartRight = 540;
  const chartWidth = chartRight - chartLeft;
  const barWidth = 55;
  const pixelPerUnit = yMax > 0 ? chartHeight / yMax : 1;
  const spacing = (chartWidth - n * barWidth) / (n + 1);
  const lightColors = ["#111", "#333", "#555", "#777", "#999", "#aaa"];
  const darkColor = "#60A5FA";
  const cls = ".chart-container";
  const mc = ".main-title";
  const gl = ".grid-line";
  const al = ".axis-line";
  const at = ".axis-label";
  const bv = ".bar-value";
  const xl = ".x-label";
  const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}${mc}{text-align:center;font-size:28px;font-weight:700;margin:10px 0 24px;color:#111}${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${bv}{fill:#111}${xl}{fill:#333}`;
  let sBars = "";
  for (let i = 0; i < n; i++)
    sBars += `.bar-${i}{fill:${lightColors[i % lightColors.length]}}`;
  const sDark = `.theme-dark ${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}.theme-dark ${mc}{color:#F9FAFB}.theme-dark ${gl}{stroke:rgba(255,255,255,.08)}.theme-dark ${al}{stroke:#6B7280}.theme-dark ${at}{fill:#9CA3AF}.theme-dark ${bv}{fill:#F9FAFB}.theme-dark ${xl}{fill:#D1D5DB}`;
  let sBarsDark = "";
  for (let i = 0; i < n; i++)
    sBarsDark += `.theme-dark .bar-${i}{fill:${darkColor}}`;
  const style = sLight + sBars + sDark + sBarsDark;
  const parts = [];
  const ySteps = 4;
  for (let i = 1; i <= ySteps; i++) {
    const y = chartTop + chartHeight / ySteps * i;
    parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="grid-line"/>`);
  }
  for (let i = 0; i <= ySteps; i++) {
    const y = chartBottom - chartHeight / ySteps * i;
    const val = Math.round(yMax * i / ySteps);
    const label = showPercent ? val + "%" : String(val);
    parts.push(`<text x="${chartLeft - 25}" y="${y + 4}" text-anchor="end" font-size="12" class="axis-label">${label}</text>`);
  }
  parts.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
  parts.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
  for (let i = 0; i < n; i++) {
    const x = Math.round(chartLeft + spacing + i * (barWidth + spacing));
    const barHeight = Math.min(data[i].value * pixelPerUnit, chartHeight);
    const barY = chartBottom - barHeight;
    parts.push(`<rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="8" class="bar-${i}"/>`);
    const displayVal = showPercent ? Math.round(data[i].value) + "%" : String(Math.round(data[i].value * 10) / 10);
    parts.push(`<text x="${x + barWidth / 2}" y="${barY - 15}" text-anchor="middle" font-size="14" font-weight="600" class="bar-value">${escapeXml(displayVal)}</text>`);
    parts.push(`<text x="${x + barWidth / 2}" y="${chartBottom + 30}" text-anchor="middle" font-size="14" class="x-label">${escapeXml(data[i].label)}</text>`);
  }
  if (xLabel) {
    parts.push(`<text x="310" y="${chartBottom + 70}" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(xLabel)}</text>`);
  }
  if (yLabel) {
    parts.push(`<text x="20" y="210" transform="rotate(-90 20 210)" text-anchor="middle" font-size="14" class="axis-label">${escapeXml(yLabel)}</text>`);
  }
  const svgContent = parts.join("");
  const svg = `<svg width="600" height="${chartBottom + 90}" viewBox="0 0 600 ${chartBottom + 90}">${svgContent}</svg>`;
  const titleHtml = title ? `<h1 class="main-title">${escapeXml(title)}</h1>` : "";
  return `<div class="chart-container"><style>${style}</style>${titleHtml}${svg}</div>`;
}

// src/vpiechart.ts
var HEADER_LABELS2 = ["vpie", "\u6807\u9898"];
function generatePieChart(grid) {
  if (grid.length < 3)
    return null;
  for (let i = 0; i < HEADER_LABELS2.length; i++) {
    if ((grid[i]?.[0]?.t?.trim() ?? "") !== HEADER_LABELS2[i])
      return null;
  }
  const title = grid[1]?.[1]?.t?.trim() ?? "";
  const data = [];
  for (let i = 2; i < grid.length; i++) {
    const label = grid[i]?.[0]?.t?.trim();
    const valStr = grid[i]?.[1]?.t?.trim();
    if (!label || !valStr)
      continue;
    if (/^…+/.test(label))
      continue;
    const value = parseFloat(valStr.replace(/[^0-9.-]/g, ""));
    if (isNaN(value) || value <= 0)
      continue;
    data.push({ label, value });
  }
  if (data.length === 0)
    return null;
  const lines = [];
  lines.push("```mermaid");
  lines.push("pie showData");
  if (title)
    lines.push(`    title ${title}`);
  for (const d of data) {
    lines.push(`    "${d.label}" : ${d.value}`);
  }
  lines.push("```");
  return lines.join("\n");
}

// src/vlinechart.ts
var HEADER_LABELS3 = ["vline", "\u6807\u9898", "x\u8303\u56F4", "x", "y\u8303\u56F4", "y"];
function escapeXml2(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function generateLineChart(grid) {
  if (grid.length < 7)
    return null;
  for (let i = 0; i < HEADER_LABELS3.length; i++) {
    if ((grid[i]?.[0]?.t?.trim() ?? "") !== HEADER_LABELS3[i])
      return null;
  }
  const get = (idx) => grid[idx]?.[1]?.t?.trim() ?? "";
  const title = get(1);
  const xLabel = get(3);
  const yLabel = get(5);
  let yMax = 100;
  const yRangeRaw = get(4);
  const yMatch = yRangeRaw.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (yMatch)
    yMax = parseFloat(yMatch[2]);
  const data = [];
  for (let i = 6; i < grid.length; i++) {
    const label = grid[i]?.[0]?.t?.trim();
    const valStr = grid[i]?.[1]?.t?.trim();
    if (!label || !valStr)
      continue;
    if (/^…+/.test(label))
      continue;
    const value = parseFloat(valStr.replace(/[^0-9.-]/g, ""));
    if (isNaN(value))
      continue;
    data.push({ label, value });
  }
  if (data.length < 2)
    return null;
  const n = data.length;
  const chartTop = 80;
  const chartBottom = 330;
  const chartHeight = chartBottom - chartTop;
  const chartLeft = 80;
  const chartRight = 540;
  const chartWidth = chartRight - chartLeft;
  const pixelPerUnit = yMax > 0 ? chartHeight / yMax : 1;
  const stepX = chartWidth / (n - 1);
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round(chartLeft + i * stepX);
    const y = Math.round(chartBottom - data[i].value * pixelPerUnit);
    points.push({ x, y });
  }
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const cls = ".chart-container";
  const mc = ".main-title";
  const gl = ".grid-line";
  const al = ".axis-line";
  const at = ".axis-label";
  const dv = ".data-value";
  const xl = ".x-label";
  const ln = ".line-path";
  const dot = ".data-dot";
  const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}${mc}{text-align:center;font-size:28px;font-weight:700;margin:10px 0 24px;color:#111}${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${dv}{fill:#111}${xl}{fill:#333}${ln}{fill:none;stroke:#111;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}${dot}{fill:#111}`;
  const sDark = `.theme-dark ${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}.theme-dark ${mc}{color:#F9FAFB}.theme-dark ${gl}{stroke:rgba(255,255,255,.08)}.theme-dark ${al}{stroke:#6B7280}.theme-dark ${at}{fill:#9CA3AF}.theme-dark ${dv}{fill:#F9FAFB}.theme-dark ${xl}{fill:#D1D5DB}.theme-dark ${ln}{stroke:#60A5FA}.theme-dark ${dot}{fill:#60A5FA}`;
  const style = sLight + sDark;
  const parts = [];
  const ySteps = 4;
  for (let i = 1; i <= ySteps; i++) {
    const y = chartTop + chartHeight / ySteps * i;
    parts.push(`<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="grid-line"/>`);
  }
  for (let i = 0; i <= ySteps; i++) {
    const y = chartBottom - chartHeight / ySteps * i;
    const val = Math.round(yMax * i / ySteps);
    parts.push(`<text x="${chartLeft - 10}" y="${y + 4}" text-anchor="end" font-size="12" class="axis-label">${val}</text>`);
  }
  parts.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
  parts.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis-line" stroke-width="2"/>`);
  parts.push(`<polyline points="${polylinePoints}" class="line-path" fill="none" stroke="#111" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`);
  for (let i = 0; i < n; i++) {
    const { x, y } = points[i];
    parts.push(`<circle cx="${x}" cy="${y}" r="5" class="data-dot"/>`);
    const displayVal = String(Math.round(data[i].value * 10) / 10);
    parts.push(`<text x="${x}" y="${y - 15}" text-anchor="middle" font-size="14" font-weight="600" class="data-value">${escapeXml2(displayVal)}</text>`);
    parts.push(`<text x="${x}" y="${chartBottom + 30}" text-anchor="middle" font-size="14" class="x-label">${escapeXml2(data[i].label)}</text>`);
  }
  if (xLabel) {
    parts.push(`<text x="310" y="${chartBottom + 70}" text-anchor="middle" font-size="14" class="axis-label">${escapeXml2(xLabel)}</text>`);
  }
  if (yLabel) {
    parts.push(`<text x="20" y="210" transform="rotate(-90 20 210)" text-anchor="middle" font-size="14" class="axis-label">${escapeXml2(yLabel)}</text>`);
  }
  const svgContent = parts.join("");
  const svg = `<svg width="600" height="${chartBottom + 90}" viewBox="0 0 600 ${chartBottom + 90}">${svgContent}</svg>`;
  const titleHtml = title ? `<h1 class="main-title">${escapeXml2(title)}</h1>` : "";
  return `<div class="chart-container"><style>${style}</style>${titleHtml}${svg}</div>`;
}

// src/charts.ts
var CHART_HEADERS = {
  bar: "vbarchart",
  pie: "vpie",
  line: "vline"
};
function detectChartType(grid) {
  const h = grid[0]?.[0]?.t?.trim() ?? "";
  if (h === CHART_HEADERS.bar)
    return "bar";
  if (h === CHART_HEADERS.pie)
    return "pie";
  if (h === CHART_HEADERS.line)
    return "line";
  return null;
}
function gridToChart(grid) {
  const type = detectChartType(grid);
  if (!type)
    return null;
  switch (type) {
    case "bar":
      return generateBarChart(grid);
    case "pie":
      return generatePieChart(grid);
    case "line":
      return generateLineChart(grid);
  }
}

// src/main.ts
var LANG = "vtable";
var DEFAULT_SETTINGS = {
  enableDesktopToolbar: true,
  enableMobileToolbar: true,
  enableModeSwitcher: true,
  tableRadius: 0,
  headerStyle: "none",
  headerColor: "#4a90d9",
  mdHtmlTags: true,
  uiLang: "zh",
  contextMenu: DEFAULT_CONTEXT_MENU,
  tblStyle: "none",
  tblStyleEnabled: false,
  zebraStyle: "none",
  zebraColor: "#e8f0fe",
  zebraEnabled: false
};
var VtPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    /** 阅读模式写回定位缓存：渲染完成后 getSectionInfo 可用性最高，缓存行号供后续写回兜底
     *  （阅读模式下 CM posAtDOM 不可用——el 不在编辑器 DOM 里，两条旧路径全失败 = 勾选不保存的根因） */
    this.sectionInfoCache = /* @__PURE__ */ new WeakMap();
  }
  // 模板自动生成函数
  async ensureTemplates() {
    const vault = this.app.vault;
    let templateFolder = "TEMPLATE";
    const templatesPlugin = this.app.internalPlugins.getPluginById("templates");
    if (templatesPlugin?.enabled) {
      const folder = templatesPlugin.instance?.options?.folder;
      if (folder)
        templateFolder = folder;
    }
    const folderExists = vault.getAbstractFileByPath((0, import_obsidian4.normalizePath)(templateFolder)) != null;
    if (!folderExists) {
      await vault.createFolder(templateFolder);
    }
    const templates = [
      {
        name: "\u67F1\u72B6\u56FE\u6A21\u677F.md",
        content: '```vtable\n{"rows":[\n  [{"t":"vbarchart"},{"t":""}],\n  [{"t":"\u6807\u9898"},{"t":""}],\n  [{"t":"v%"},{"t":""}],\n  [{"t":"x\u8303\u56F4"},{"t":""}],\n  [{"t":"x"},{"t":""}],\n  [{"t":"y\u8303\u56F4"},{"t":""}],\n  [{"t":"y"},{"t":""}],\n  [{"t":"\u4E00\u6708"},{"t":""}],\n  [{"t":"\u4E8C\u6708"},{"t":""}],\n  [{"t":"\u4E09\u6708"},{"t":""}],\n  [{"t":"\u56DB\u6708"},{"t":""}]\n]}\n```'
      },
      {
        name: "\u997C\u56FE\u6A21\u677F.md",
        content: '```vtable\n{"rows":[\n  [{"t":"vpie"},{"t":""}],\n  [{"t":"\u6807\u9898"},{"t":""}],\n  [{"t":"\u4EA7\u54C1A"},{"t":""}],\n  [{"t":"\u4EA7\u54C1B"},{"t":""}],\n  [{"t":"\u4EA7\u54C1C"},{"t":""}],\n  [{"t":"\u4EA7\u54C1D"},{"t":""}],\n  [{"t":"\u5176\u4ED6"},{"t":""}]\n]}\n```'
      },
      {
        name: "\u6298\u7EBF\u56FE\u6A21\u677F.md",
        content: '```vtable\n{"rows":[\n  [{"t":"vline"},{"t":""}],\n  [{"t":"\u6807\u9898"},{"t":""}],\n  [{"t":"x\u8303\u56F4"},{"t":""}],\n  [{"t":"x"},{"t":""}],\n  [{"t":"y\u8303\u56F4"},{"t":""}],\n  [{"t":"y"},{"t":""}],\n  [{"t":"\u4E00\u6708"},{"t":""}],\n  [{"t":"\u4E8C\u6708"},{"t":""}],\n  [{"t":"\u4E09\u6708"},{"t":""}],\n  [{"t":"\u56DB\u6708"},{"t":""}],\n  [{"t":"\u4E94\u6708"},{"t":""}],\n  [{"t":"\u516D\u6708"},{"t":""}]\n]}\n```'
      }
    ];
    for (const tpl of templates) {
      const filePath = `${templateFolder}/${tpl.name}`;
      const fileExists = vault.getAbstractFileByPath((0, import_obsidian4.normalizePath)(filePath)) != null;
      if (!fileExists) {
        await vault.create(filePath, tpl.content);
      }
    }
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.contextMenu.includes("vt.alignL")) {
      const lines = this.settings.contextMenu.split("\n");
      const mi = lines.findIndex((l) => l.trim() === "vt.mergeRight");
      const ins = ["vt.alignL\uFF5Cvt.alignC\uFF5Cvt.alignR", "vt.alignT\uFF5Cvt.alignM\uFF5Cvt.alignB"];
      if (mi >= 0)
        lines.splice(mi, 0, ...ins);
      else
        lines.push("---", ...ins);
      this.settings.contextMenu = lines.join("\n");
      await this.saveSettings();
    }
    if (!this.settings.contextMenu.includes("vt.paste")) {
      const lines = this.settings.contextMenu.split("\n");
      const ci = lines.findIndex((l) => l.trim() === "vt.cut");
      if (ci >= 0)
        lines.splice(ci, 0, "vt.paste");
      else {
        const ci2 = lines.findIndex((l) => l.trim() === "vt.copy");
        if (ci2 >= 0)
          lines.splice(ci2 + 1, 0, "vt.paste");
        else
          lines.unshift("vt.paste");
      }
      this.settings.contextMenu = lines.join("\n");
      await this.saveSettings();
    }
    setUiLang(this.settings.uiLang);
    await this.ensureTemplates();
    this.addCommand({
      id: "delete-current-table",
      name: t("\u5220\u9664\u5F53\u524D Vtable \u8868\u683C", "Delete current vtable"),
      callback: () => {
        const ed = this.activeEditor();
        if (!ed) {
          new import_obsidian4.Notice(t("\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u7F16\u8F91\u5668", "No active editor"));
          return;
        }
        this.deleteCurrentVtable(ed);
      }
    });
    this.toolbar = new Toolbar();
    this.addSettingTab(new VtSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      getActiveTableController()?.flushCommit();
    }));
    this.registerDomEvent(window, "blur", () => this.toolbar.hide());
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden")
        this.toolbar.hide();
    });
    this.registerDomEvent(document, "focusin", (e) => {
      const t2 = e.target;
      if (this.toolbar.el.style.display !== "none" && t2 instanceof Element && !t2.closest("table.vt, .vt-bar, .vt-mode-bar")) {
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
        (linkText) => {
          void this.app.workspace.openLinkText(linkText, ctx.sourcePath, false);
        },
        (cmdId) => {
          const c = this.app.commands.commands[cmdId];
          if (!c)
            return null;
          return {
            name: c.name,
            run: () => this.app.commands.executeCommandById(cmdId)
          };
        }
      );
      window.requestAnimationFrame(() => {
        const info = ctx.getSectionInfo(el);
        if (info)
          this.sectionInfoCache.set(el, { lineStart: info.lineStart, lineEnd: info.lineEnd });
      });
    });
    this.addCommand({
      id: "vt-create",
      name: t("\u521B\u5EFA vtable", "Create vtable"),
      callback: () => this.runWithEditor((ed) => this.insertTable(ed))
    });
    this.addCommand({
      id: "vt-convert",
      name: t("\u8F6C\u6362\u4E3A vtable", "Convert to vtable"),
      callback: () => this.runWithEditor((ed) => this.convertAtCursor(ed))
    });
    this.addCommand({
      id: "vt-to-markdown",
      name: t("\u8F6C\u6362\u4E3A markdown \u8868\u683C", "Convert to Markdown table"),
      callback: () => this.runWithEditor((ed) => this.vtableToMarkdown(ed))
    });
    this.addCommand({
      id: "vt-to-html",
      name: t("\u8F6C\u6362\u4E3A HTML \u8868\u683C", "Convert to HTML table"),
      callback: () => this.runWithEditor((ed) => this.vtableToHtml(ed))
    });
    this.addCommand({
      id: "vt-to-chart",
      name: t("\u8F6C\u6362\u4E3A\u56FE\u8868", "Convert to chart"),
      callback: () => this.runWithEditor((ed) => this.vtableToChart(ed))
    });
    this.addCommand({
      id: "vt-select-above",
      name: t("\u9009\u4E2D\u4E0A\u65B9 vtable \u8868\u683C", "Select vtable above"),
      callback: () => this.runWithEditor((ed) => this.selectVtableAbove(ed))
    });
    this.registerCellNavCommands();
    this.registerModeCommands();
    this.registerHeaderBgCommand();
    this.registerSelectionFormatCommands();
    this.registerArrowIntoTable();
    this.addRibbonIcon("table-2", "\u8F6C\u6362\u4E3A vtable", () => {
      this.runWithEditor((ed) => this.convertAtCursor(ed));
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, ed) => {
        menu.addItem(
          (item) => item.setTitle("\u521B\u5EFA vtable").setIcon("table").onClick(() => this.insertTable(ed))
        );
      })
    );
  }
  onunload() {
    this.toolbar?.destroy();
  }
  registerCellNavCommands() {
    const dirs = [
      ["vt-cell-up", t("\u4E0A\u79FB\u5355\u5143\u683C", "Move cell up"), -1, 0],
      ["vt-cell-down", t("\u4E0B\u79FB\u5355\u5143\u683C", "Move cell down"), 1, 0],
      ["vt-cell-left", t("\u5DE6\u79FB\u5355\u5143\u683C", "Move cell left"), 0, -1],
      ["vt-cell-right", t("\u53F3\u79FB\u5355\u5143\u683C", "Move cell right"), 0, 1]
    ];
    for (const [id, name, dr, dc] of dirs) {
      this.addCommand({
        id,
        name,
        callback: () => {
          const ctrl = getActiveTableController();
          if (!ctrl) {
            new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
            return;
          }
          ctrl.moveCell(dr, dc);
        }
      });
    }
  }
  registerModeCommands() {
    const modes = [
      ["vt-mode-ol", t("OL \u6362\u884C\u6A21\u5F0F", "OL wrap mode"), "OL"],
      ["vt-mode-hs", t("HS \u6A2A\u5411\u62C9\u957F\u6A21\u5F0F", "HS stretch mode"), "HS"],
      ["vt-mode-rc", t("RC \u81EA\u7531\u62D6\u62FD\u6A21\u5F0F", "RC free drag mode"), "RC"]
    ];
    for (const [id, name, mode] of modes) {
      this.addCommand({
        id,
        name,
        callback: () => {
          const ctrl = getActiveTableController();
          if (!ctrl) {
            new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
            return;
          }
          ctrl.setMode(mode);
        }
      });
    }
  }
  /** 命令：删除表格样式（只删不加：线风格+隔行+表头底色一次全取消）+
   *  命令：添加/删除表头底色（单表格级开关，覆盖全局 headerStyle；全局未启用时报错） */
  registerHeaderBgCommand() {
    this.addCommand({
      id: "vt-remove-style",
      name: t("\u5220\u9664\u8868\u683C\u6837\u5F0F", "Remove table styles"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first"));
          return;
        }
        const removed = ctrl.toggleStyleAll();
        new import_obsidian4.Notice(removed ? t("\u5DF2\u53D6\u6D88\u672C\u8868\u5168\u90E8\u6837\u5F0F", "All styles removed for this table") : t("\u672C\u8868\u6CA1\u6709\u53EF\u5220\u9664\u7684\u6837\u5F0F", "No styles to remove on this table"));
      }
    });
    this.addCommand({
      id: "vt-toggle-header-bg",
      name: t("\u6DFB\u52A0\u8868\u5934\u5E95\u8272", "Add header background"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first"));
          return;
        }
        if (this.settings.headerStyle === "none") {
          new import_obsidian4.Notice(t("\u672A\u542F\u7528\u8868\u5934\u5E95\u8272\uFF1A\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u5C06\u300C\u8868\u5934\u5E95\u8272\u300D\u8BBE\u4E3A\u4E3B\u9898\u8272\u6216\u81EA\u5B9A\u4E49\u8272", "Header background is off: set it to Theme color or Custom color in settings first"));
          return;
        }
        const added = ctrl.addHeaderBg();
        new import_obsidian4.Notice(added ? t("\u5DF2\u6DFB\u52A0\u8868\u5934\u5E95\u8272", "Header background added") : t("\u672C\u8868\u5DF2\u6709\u8868\u5934\u5E95\u8272", "Header background already on"));
      }
    });
    this.addCommand({
      id: "vt-style-call",
      name: t("\u8868\u683C\u6837\u5F0F\u8C03\u7528", "Table style call"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
          return;
        }
        void ctrl.styleCall((options) => new Promise((resolve) => {
          const menu = new import_obsidian4.Menu();
          for (const o of options) {
            menu.addItem((i) => {
              i.setTitle(o.checked ? `\u2713 ${o.name}` : o.name);
              i.onClick(() => resolve(o.value));
            });
          }
          menu.onHide(() => resolve(null));
          const td = document.activeElement;
          const rect = td?.matches?.("td") ? td.getBoundingClientRect() : null;
          menu.showAtPosition(rect ? { x: rect.left + rect.width / 2, y: rect.bottom + 4 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
        }));
      }
    });
    this.addCommand({
      id: "vt-toggle-zebra",
      name: t("\u9694\u884C\u53D8\u8272\u6837\u5F0F", "Zebra stripe style"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
          return;
        }
        const on = ctrl.toggleZebra();
        new import_obsidian4.Notice(on ? t("\u5DF2\u5E94\u7528\u9694\u884C\u53D8\u8272", "Zebra stripes applied") : t("\u5DF2\u53D6\u6D88\u9694\u884C\u53D8\u8272", "Zebra stripes removed"));
      }
    });
    this.addCommand({
      id: "vt-diag-toggle",
      name: t("\u659C\u5206\u5355\u5143\u683C\uFF08\u5BF9\u89D2\u7EBF\uFF0C\u5206\u4E24\u4E2A\u8F93\u5165\u533A\uFF09", "Diagonal split cell (two input areas)"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
          return;
        }
        ctrl.toggleDiag();
      }
    });
  }
  registerSelectionFormatCommands() {
    const aligns = [
      ["vt-align-left", t("\u9009\u4E2D\u5355\u5143\u683C\u5C45\u5DE6", "Align cells left"), "l"],
      ["vt-align-center", t("\u9009\u4E2D\u5355\u5143\u683C\u5C45\u4E2D", "Align cells center"), "c"],
      ["vt-align-right", t("\u9009\u4E2D\u5355\u5143\u683C\u5C45\u53F3", "Align cells right"), "r"]
    ];
    const vAligns = [
      ["vt-align-top", t("\u9009\u4E2D\u5355\u5143\u683C\u9876\u5BF9\u9F50", "Align cells top"), "t"],
      ["vt-align-middle", t("\u9009\u4E2D\u5355\u5143\u683C\u5782\u76F4\u5C45\u4E2D", "Align cells middle"), "m"],
      ["vt-align-bottom", t("\u9009\u4E2D\u5355\u5143\u683C\u5E95\u5BF9\u9F50", "Align cells bottom"), "b"]
    ];
    for (const [id, name, mode] of [...aligns, ...vAligns]) {
      this.addCommand({
        id,
        name,
        callback: () => {
          const ctrl = getActiveTableController();
          if (!ctrl) {
            new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
            return;
          }
          if (mode === "t" || mode === "m" || mode === "b")
            ctrl.alignVSel(mode);
          else
            ctrl.alignSel(mode);
        }
      });
    }
    this.addCommand({
      id: "vt-cell-color",
      name: t("\u9009\u4E2D\u5355\u5143\u683C\u8BBE\u7F6E\u5E95\u8272", "Set cell background"),
      callback: () => {
        const ctrl = getActiveTableController();
        if (!ctrl) {
          new import_obsidian4.Notice(t("\u8BF7\u5148\u70B9\u51FB vtable \u8868\u683C\u4E2D\u7684\u4EFB\u610F\u5355\u5143\u683C\u8FDB\u5165\u7F16\u8F91\u72B6\u6001", "Click any cell in a vtable table first to enter edit mode"));
          return;
        }
        ctrl.pickColor();
      }
    });
  }
  insertTable(ed) {
    const source = blankSource(2, 2);
    const block = "```" + LANG + "\n" + source + "\n```";
    const cur = ed.getCursor();
    const end = { line: cur.line, ch: ed.getLine(cur.line).length };
    ed.replaceRange("\n" + block + "\n", end);
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    const currentMode = view?.currentMode;
    if (currentMode?.sourceMode) {
      ed.setCursor({ line: cur.line + 2, ch: 0 });
    } else {
      requestInitialFocus(0, 0, source);
    }
  }
  /** 获取当前活动编辑器（常驻命令用：拿不到时提示而非隐藏命令） */
  activeEditor() {
    return this.app.workspace.activeEditor?.editor ?? this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView)?.editor ?? null;
  }
  /** 常驻命令统一入口：确保有活动编辑器再执行 */
  runWithEditor(fn) {
    const ed = this.activeEditor();
    if (!ed) {
      new import_obsidian4.Notice(t("\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684\u7F16\u8F91\u5668", "No active editor"));
      return;
    }
    fn(ed);
  }
  /** 从表格跳出：把编辑器光标放到代码块上方/下方的文本行（供方向键跳出表格使用） */
  exitTableToEditor(el, ctx, direction) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    if (direction < 0) {
      if (info.lineStart <= 0)
        return;
      const line = info.lineStart - 1;
      editor.focus();
      editor.setCursor({ line, ch: editor.getLine(line).length });
    } else {
      if (info.lineEnd >= editor.lineCount() - 1)
        return;
      editor.focus();
      editor.setCursor({ line: info.lineEnd + 1, ch: 0 });
    }
  }
  /** 方向键入表（跳出表格的逆操作）：光标在 vtable 代码块上一行按 ↓ 进首格、下一行按 ↑ 进末格，
   *  不再进入源码视图。关键点：Obsidian 内置 keymap（cursorDown 等）注册在前会先吞键，
   *  必须用 Prec.highest(keymap.of(...)) 把绑定排到全部 keymap 之前；require 失败时降级
   *  document 捕获（原生 addEventListener 显式 capture，registerDomEvent 的 options 转发不可靠） */
  registerArrowIntoTable() {
    const tryEnter = (key, view) => {
      try {
        const contentDOM = view?.contentDOM;
        const ae = document.activeElement;
        if (contentDOM && ae !== contentDOM && !contentDOM.contains(ae))
          return false;
        if (ae && ae.closest?.(".vtable-container"))
          return false;
        const doc = view.state.doc;
        const sel = view.state.selection.main;
        if (!sel.empty)
          return false;
        const line = doc.lineAt(sel.head);
        let target = null;
        let fenceLine = -1;
        if (key === "ArrowDown") {
          if (line.number >= doc.lines)
            return false;
          const next = doc.line(line.number + 1);
          if (next.text.startsWith("```vtable")) {
            target = "first";
            fenceLine = next.number;
          }
        } else {
          if (line.number <= 1)
            return false;
          const prev = doc.line(line.number - 1);
          if (prev.text.startsWith("```")) {
            for (let n = prev.number - 1; n >= Math.max(1, prev.number - 200); n--) {
              const t2 = doc.line(n).text;
              if (t2.startsWith("```")) {
                if (t2.startsWith("```vtable")) {
                  target = "last";
                  fenceLine = n;
                }
                break;
              }
            }
          }
        }
        if (!target)
          return false;
        const el = this.locateTableEl(key, view, doc, fenceLine);
        if (!el) {
          new import_obsidian4.Notice(t("Vtable\uFF1A\u65B9\u5411\u952E\u5DF2\u547D\u4E2D\u8868\u683C\uFF0C\u4F46\u672A\u5B9A\u4F4D\u5230\u6E32\u67D3\u5BB9\u5668\uFF08\u8BF7\u628A\u6B64\u63D0\u793A\u53CD\u9988\u7ED9\u5F00\u53D1\u8005\uFF09", "Vtable: arrow key matched a table but its container was not found (please report this to the developer)"));
          return false;
        }
        if (target === "first") {
          const first = el.querySelector("table.vt td");
          if (!first)
            return false;
          first.focus();
        } else {
          let lastRowTds = [];
          let lastR = -1;
          el.querySelectorAll("table.vt td[data-vt-r]").forEach((td) => {
            const r = parseInt(td.dataset.vtR ?? "-1", 10);
            if (r > lastR) {
              lastR = r;
              lastRowTds = [td];
            } else if (r === lastR) {
              lastRowTds.push(td);
            }
          });
          const cell2 = lastRowTds[0] ?? el.querySelector("table.vt td");
          if (!cell2)
            return false;
          cell2.focus();
        }
        return true;
      } catch {
        return false;
      }
    };
    let registered = false;
    try {
      const cmView = require("@codemirror/view");
      const cmState = require("@codemirror/state");
      const keymap = cmView?.keymap;
      const Prec = cmState?.Prec;
      if (keymap?.of && Prec?.highest) {
        this.registerEditorExtension(Prec.highest(keymap.of([
          { key: "ArrowDown", run: (view) => tryEnter("ArrowDown", view) },
          { key: "ArrowUp", run: (view) => tryEnter("ArrowUp", view) }
        ])));
        registered = true;
      }
    } catch {
    }
    if (!registered) {
      const onKey = (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp")
          return;
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing)
          return;
        const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
        if (!view)
          return;
        const cm = view.editor.cm;
        if (!cm?.state || typeof cm.hasFocus !== "function" || !cm.hasFocus)
          return;
        if (tryEnter(e.key, cm)) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener("keydown", onKey, { capture: true });
      this.register(() => document.removeEventListener("keydown", onKey));
    }
  }
  /** 定位光标行紧邻的 vtable 渲染容器：路径1 光标行 cm-line 兄弟扫描 → 路径2 domAtPos 近邻 → 路径3 posAtDOM 反查 */
  locateTableEl(key, view, doc, fenceLine) {
    try {
      const at = view.domAtPos(view.state.selection.main.head);
      let node = at.node;
      if (node && node.nodeType !== 1)
        node = node.parentElement;
      const lineEl = node?.closest?.(".cm-line");
      if (lineEl) {
        let sib = lineEl;
        for (let i = 0; i < 3 && sib; i++) {
          sib = key === "ArrowDown" ? sib.nextElementSibling : sib.previousElementSibling;
          if (!sib)
            break;
          const embed = sib.classList.contains("cm-embed-block") ? sib : sib.querySelector(".cm-embed-block");
          const vt = embed?.querySelector(".vtable-container");
          if (vt)
            return vt;
        }
      }
    } catch {
    }
    try {
      const at = view.domAtPos(doc.line(fenceLine).from);
      const host = at.node;
      if (host && host.nodeType === 1) {
        const kids = Array.from(host.children);
        for (let i = Math.max(0, at.offset - 2); i <= Math.min(kids.length - 1, at.offset + 2); i++) {
          const embed = kids[i]?.closest?.(".cm-embed-block");
          const vt = embed?.querySelector(".vtable-container");
          if (vt)
            return vt;
        }
      }
    } catch {
    }
    try {
      const fenceFrom = doc.line(fenceLine).from;
      const containers = document.querySelectorAll(".vtable-container");
      let fallback = null;
      for (const c of Array.from(containers)) {
        if (!c.isConnected)
          continue;
        try {
          const p = view.posAtDOM(c, 0);
          if (doc.lineAt(p).from === fenceFrom)
            return c;
          if (doc.lineAt(p).number === fenceLine + 1)
            fallback = c;
        } catch {
        }
      }
      if (fallback)
        return fallback;
    } catch {
    }
    return null;
  }
  /** 删除光标上方紧邻的 vtable 代码块（光标需位于表格下方第一个空行） */
  deleteCurrentVtable(ed) {
    const hint = () => new import_obsidian4.Notice(t("\u8BF7\u5C06\u5149\u6807\u653E\u5728\u8981\u5220\u9664\u7684 vtable \u8868\u683C\u4E0B\u65B9\u7D27\u90BB\u7684\u7A7A\u884C\u4E0A\u518D\u6267\u884C\u5220\u9664", "Put the cursor on the empty line right below the vtable block to delete it"));
    const cursor = ed.getCursor();
    const currentLine = cursor.line;
    if (ed.getLine(currentLine).trim() !== "") {
      hint();
      return;
    }
    if (currentLine === 0) {
      hint();
      return;
    }
    const prevLine = currentLine - 1;
    if (ed.getLine(prevLine).trim() !== "```") {
      hint();
      return;
    }
    let startLine = -1;
    const endLine = prevLine;
    for (let i = prevLine - 1; i >= 0; i--) {
      const lineText = ed.getLine(i);
      if (lineText.trim() === "```vtable") {
        startLine = i;
        break;
      }
      if (lineText.trim() === "```" && i !== prevLine)
        break;
    }
    if (startLine === -1) {
      new import_obsidian4.Notice(t("\u4E0A\u65B9\u672A\u627E\u5230 vtable \u4EE3\u7801\u5757", "No vtable code block found above"));
      return;
    }
    ed.replaceRange("", { line: startLine, ch: 0 }, { line: endLine, ch: ed.getLine(endLine).length });
    if (ed.getLine(startLine) === "") {
      ed.replaceRange("", { line: startLine, ch: 0 }, { line: startLine + 1, ch: 0 });
    }
  }
  /** 把光标所在的 markdown 表格或 HTML 表格转换为 vtable 代码块（二者共用同一入口） */
  convertAtCursor(ed) {
    const mdRange = findMdTable(ed);
    if (mdRange) {
      const md = ed.getRange(mdRange.from, mdRange.to);
      const block = "```" + LANG + "\n" + mdTableToSource(md) + "\n```";
      ed.replaceRange(block, mdRange.from, mdRange.to);
      return;
    }
    const htmlRange = findHtmlTable(ed);
    if (htmlRange) {
      const html = ed.getRange(htmlRange.from, htmlRange.to);
      const block = "```" + LANG + "\n" + htmlTableToSource(html) + "\n```";
      ed.replaceRange(block, htmlRange.from, htmlRange.to);
    }
  }
  /** 把光标所在的 vtable 代码块转换回 markdown 表格 */
  vtableToMarkdown(ed) {
    const range = findVtableBlock(ed);
    if (!range)
      return;
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const data = parseSource(source);
    const grid = data.rows;
    const md = gridToMdTable(grid, { htmlTags: this.settings.mdHtmlTags });
    ed.replaceRange(md, range.blockFrom, range.blockTo);
  }
  /** 把光标所在的 vtable 代码块转换回 HTML 表格 */
  vtableToHtml(ed) {
    const range = findVtableBlock(ed);
    if (!range)
      return;
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const data = parseSource(source);
    const grid = data.rows;
    const html = gridToHtmlTable(grid);
    ed.replaceRange(html, range.blockFrom, range.blockTo);
  }
  /** 转换为图表：自动检测类型 */
  vtableToChart(ed) {
    const range = findVtableBlock(ed);
    if (!range) {
      new import_obsidian4.Notice(t("\u672A\u627E\u5230\u53EF\u8F6C\u6362\u7684\u56FE\u8868 vtable \u6A21\u677F", "No chart template found"));
      return;
    }
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const grid = parseSource(source).rows;
    if (!detectChartType(grid)) {
      new import_obsidian4.Notice(t("\u4E0D\u662F\u6709\u6548\u7684\u56FE\u8868\u6A21\u677F\uFF08\u8868\u5934\u5E94\u4E3A vbarchart / vpie / vline\uFF09", "Not a valid chart template (header must be vbarchart / vpie / vline)"));
      return;
    }
    const output = gridToChart(grid);
    if (!output) {
      new import_obsidian4.Notice(t("\u8868\u683C\u5F62\u5F0F\u4E0D\u89C4\u8303\uFF1A\u6570\u636E\u884C\u7F3A\u5931\u6216\u683C\u5F0F\u6709\u8BEF", "Malformed table: data rows missing or invalid"));
      return;
    }
    const insertLine = range.blockTo.line;
    ed.replaceRange("\n" + output + "\n", { line: insertLine + 1, ch: 0 });
  }
  /** 选中光标上方最近的 vtable 代码块 */
  selectVtableAbove(ed) {
    const block = findVtableBlockAbove(ed);
    if (!block) {
      new import_obsidian4.Notice(t("\u4E0A\u65B9\u672A\u627E\u5230 vtable \u8868\u683C", "No vtable table found above"));
      return;
    }
    ed.setSelection(block.blockFrom, block.blockTo);
    ed.scrollIntoView(block.blockFrom, true);
  }
  /** 将新的表格源文本写回代码块内部（围栏之间的行） */
  writeBack(el, ctx, newSource) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    let info = ctx.getSectionInfo(el);
    if (info)
      this.sectionInfoCache.set(el, { lineStart: info.lineStart, lineEnd: info.lineEnd });
    else
      info = this.sectionInfoCache.get(el) ?? null;
    if (!info)
      info = this.locateBlockByDom(el, view);
    if (!info) {
      new import_obsidian4.Notice(t("\u65E0\u6CD5\u5B9A\u4F4D\u8868\u683C\u5728\u6587\u6863\u4E2D\u7684\u4F4D\u7F6E\uFF0C\u672C\u6B21\u66F4\u6539\u6682\u672A\u5199\u5165\u6587\u4EF6", "Vtable: table position in the document not found; this change was not written to file"));
      return;
    }
    const scroller = el.closest(".cm-scroller");
    const before = scroller ? { top: scroller.scrollTop, height: scroller.scrollHeight } : null;
    const from = { line: info.lineStart + 1, ch: 0 };
    const to = { line: info.lineEnd, ch: 0 };
    noteScrollAnchor(el);
    editor.replaceRange(newSource + "\n", from, to);
    if (scroller && before) {
      const check = () => {
        if (!scroller.isConnected)
          return;
        if (Math.abs(scroller.scrollTop - before.top) > 120 && Math.abs(scroller.scrollHeight - before.height) < 120) {
          scroller.scrollTop = before.top;
        }
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(check));
      window.setTimeout(check, 300);
    }
  }
  /** 任务7：live preview 下 getSectionInfo 为 null 时，用 CM6 从渲染容器反查代码块行号范围 */
  locateBlockByDom(el, view) {
    const cm = view.editor.cm;
    if (!cm || typeof cm.posAtDOM !== "function")
      return null;
    try {
      const doc = cm.state.doc;
      const pos = cm.posAtDOM(el, 0);
      const cur = doc.lineAt(pos).number;
      const isFence = (n) => doc.line(n).text.startsWith("```");
      let start = -1;
      for (let n = cur; n >= Math.max(1, cur - 200); n--) {
        if (isFence(n)) {
          start = n;
          break;
        }
      }
      if (start < 0)
        return null;
      let end = -1;
      for (let n = cur + 1; n <= Math.min(doc.lines, cur + 5e3); n++) {
        if (isFence(n)) {
          end = n;
          break;
        }
      }
      if (end < 0)
        return null;
      return { lineStart: start - 1, lineEnd: end - 1 };
    } catch {
      return null;
    }
  }
  /** 把整个 vtable 代码块（含围栏）替换为 markdown 表格 */
  convertBlockToMarkdown(el, ctx, grid) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const from = { line: info.lineStart, ch: 0 };
    const to = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
    editor.replaceRange(gridToMdTable(grid, { htmlTags: this.settings.mdHtmlTags }), from, to);
  }
  /** 把整个 vtable 代码块（含围栏）替换为 HTML 表格 */
  convertBlockToHtml(el, ctx, grid) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const from = { line: info.lineStart, ch: 0 };
    const to = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
    editor.replaceRange(gridToHtmlTable(grid), from, to);
  }
  /** 通过 Obsidian API 解析 ![[linkText]] 为可用的图片 URL */
  resolveImage(linkText, sourcePath) {
    const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
    if (!file)
      return null;
    return this.app.vault.getResourcePath(file);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var VtSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName(t("vtable \u8BBE\u7F6E", "vtable Settings")).setHeading();
    new import_obsidian4.Setting(containerEl).setName(t("\u754C\u9762\u8BED\u8A00", "UI language")).setDesc(t("\u8BBE\u7F6E\u9762\u677F\u3001\u6D6E\u7A97\u6309\u94AE\u4E0E\u53F3\u952E\u83DC\u5355\u6587\u672C\u7684\u8BED\u8A00\u3002", "Language of the settings panel, toolbar buttons and context menus.")).addDropdown((d) => d.addOptions({ zh: "\u4E2D\u6587", en: "English" }).setValue(this.plugin.settings.uiLang).onChange(async (value) => {
      this.plugin.settings.uiLang = value;
      setUiLang(value);
      await this.plugin.saveSettings();
      this.plugin.toolbar.rebuild();
      this.display();
    }));
    if (this.plugin.settings.uiLang === "en") {
      const legend = containerEl.createDiv({ cls: "vt-setting-hint" });
      legend.textContent = `${t("\u6D6E\u7A97\u6309\u94AE\u8BF4\u660E\uFF1A", "Floating toolbar legend:")}
${barLegend()}`;
    }
    new import_obsidian4.Setting(containerEl).setName(t("\u7535\u8111\u7AEF\u6D6E\u7A97\u5DE5\u5177\u680F", "Desktop floating toolbar")).setDesc(t("\u5728\u7535\u8111\u7AEF\u7F16\u8F91\u5355\u5143\u683C\u65F6\u663E\u793A\u60AC\u6D6E\u683C\u5F0F\u5316\u5DE5\u5177\u680F", "Show the floating formatting toolbar while editing cells on desktop")).addToggle((t2) => t2.setValue(this.plugin.settings.enableDesktopToolbar).onChange(async (value) => {
      this.plugin.settings.enableDesktopToolbar = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName(t("\u79FB\u52A8\u7AEF\u6D6E\u7A97\u5DE5\u5177\u680F", "Mobile / tablet floating toolbar")).setDesc(t("\u5728\u624B\u673A/\u5E73\u677F\u8BBE\u5907\u4E0A\u7F16\u8F91\u5355\u5143\u683C\u65F6\u663E\u793A\u60AC\u6D6E\u683C\u5F0F\u5316\u5DE5\u5177\u680F", "Show the floating toolbar while editing cells on phones and tablets")).addToggle((t2) => t2.setValue(this.plugin.settings.enableMobileToolbar).onChange(async (value) => {
      this.plugin.settings.enableMobileToolbar = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName(t("\u6A21\u5F0F\u5207\u6362\u6309\u94AE", "Mode switcher")).setDesc(t("\u7F16\u8F91\u8868\u683C\u65F6\u663E\u793A OL / HS / RC \u4E09\u79CD\u6A21\u5F0F\u7684\u5207\u6362\u6309\u94AE", "Show the OL / HS / RC mode switcher while editing")).addToggle((t2) => t2.setValue(this.plugin.settings.enableModeSwitcher).onChange(async (value) => {
      this.plugin.settings.enableModeSwitcher = value;
      await this.plugin.saveSettings();
    }));
    const styleSection = containerEl.createEl("details", { cls: "vt-style-section" });
    styleSection.setAttribute("open", "");
    styleSection.createEl("summary", { text: t("\u8868\u683C\u6837\u5F0F", "Table style") });
    new import_obsidian4.Setting(styleSection).setName(t("\u8868\u683C\u5916\u6846\u5706\u89D2", "Table corner radius")).setDesc(t("\u62D6\u52A8\u8C03\u6574\u8868\u683C\u56DB\u4E2A\u5916\u89D2\u7684\u5706\u89D2\u5927\u5C0F\uFF0C0 \u4E3A\u76F4\u89D2\u3002\u4FEE\u6539\u540E\u5BF9\u6240\u6709\u5DF2\u6253\u5F00\u7684\u8868\u683C\u5373\u65F6\u751F\u6548\uFF08\u5168\u5C40\u8BBE\u7F6E\uFF0C\u4E0D\u80FD\u5BF9\u5355\u4E2A\u8868\u683C\u53D6\u6D88\uFF09\u3002", "Rounded corners of the table outline, 0 = square. Applies to all open tables immediately (global only, cannot be disabled per table).")).addSlider((s) => s.setLimits(0, 20, 1).setValue(this.plugin.settings.tableRadius).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.tableRadius = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
    }));
    new import_obsidian4.Setting(styleSection).setName(t("\u8868\u5934\u5E95\u8272", "Header background")).setDesc(t("\u4E3B\u9898\u8272\u4F1A\u81EA\u52A8\u9002\u914D\u6587\u5B57\u989C\u8272\uFF08\u5E95\u8272\u6DF1\u5219\u767D\u5B57\uFF0C\u6D45\u5219\u9ED1\u5B57\uFF09\uFF1B\u7B2C\u4E00\u884C\u53C2\u4E0E\u4E0A\u4E0B\u5408\u5E76\u65F6\u5E95\u8272\u81EA\u52A8\u505C\u7528\u3002", "Theme color adapts text color automatically; disabled while the first row participates in vertical merges.")).addDropdown((d) => d.addOptions({
      "none": t("\u65E0\u8868\u5934\u5E95\u8272\uFF08\u9ED8\u8BA4\uFF09", "None (default)"),
      "theme": t("\u4E3B\u9898\u8272", "Theme color"),
      "custom": t("\u81EA\u5B9A\u4E49\u989C\u8272", "Custom color")
    }).setValue(this.plugin.settings.headerStyle).onChange(async (value) => {
      this.plugin.settings.headerStyle = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
      this.display();
    }));
    if (this.plugin.settings.headerStyle === "custom") {
      const colorSetting = new import_obsidian4.Setting(styleSection).setName(t("\u81EA\u5B9A\u4E49\u8868\u5934\u989C\u8272", "Custom header color")).setDesc(t("\u586B\u5199\u5341\u516D\u8FDB\u5236\u989C\u8272\u7F16\u7801\uFF0C\u5982 #4a90d9", "Hex color, e.g. #4a90d9"));
      const preview = createSpan();
      preview.className = "vt-color-preview";
      preview.style.background = this.plugin.settings.headerColor;
      colorSetting.nameEl.appendChild(preview);
      colorSetting.addText((t2) => t2.setValue(this.plugin.settings.headerColor).setPlaceholder(t2("\u989C\u8272\u503C\uFF08\u989C\u8272\u540D\u6216\u5341\u516D\u8FDB\u5236\uFF09", "Color name or hex value")).onChange(async (value) => {
        this.plugin.settings.headerColor = value.trim();
        await this.plugin.saveSettings();
        refreshAllTableAppearance();
        if (CSS.supports("background-color", value.trim())) {
          preview.style.background = value.trim();
        }
      }));
    }
    new import_obsidian4.Setting(styleSection).setName(t("\u8868\u683C\u7EBF\u98CE\u683C", "Table line style")).setDesc(t("\u4E09\u7EBF\u8868=\u9876\u7EBF/\u8868\u5934\u4E0B\u7EBF/\u5E95\u7EBF\uFF1B\u65E0\u683C\u7EBF=\u6CA1\u6709\u4EFB\u4F55\u683C\u7EBF\uFF1B\u5168\u6A2A\u7EBF=\u53EA\u4FDD\u7559\u6A2A\u7EBF\u3002\u4EC5\u663E\u793A\u6001\u5E94\u7528\uFF0C\u7F16\u8F91\u5355\u5143\u683C\u65F6\u4FDD\u6301\u539F\u72B6\u3002", "Three-line / no grid / horizontal-only. Applied when not editing cells.")).addDropdown((d) => d.addOptions({
      "none": t("\u65E0\uFF08\u9ED8\u8BA4\uFF09", "None (default)"),
      "three": t("\u4E09\u7EBF\u8868", "Three-line table"),
      "noline": t("\u65E0\u683C\u7EBF", "No grid lines"),
      "hline": t("\u5168\u6A2A\u7EBF", "Horizontal lines only")
    }).setValue(this.plugin.settings.tblStyle).onChange(async (value) => {
      this.plugin.settings.tblStyle = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
    })).addToggle((tg) => tg.setTooltip(t("\u542F\u7528\u8868\u683C\u7EBF\u98CE\u683C", "Enable table line style")).setValue(this.plugin.settings.tblStyleEnabled).onChange(async (value) => {
      this.plugin.settings.tblStyleEnabled = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
    }));
    new import_obsidian4.Setting(styleSection).setName(t("\u9694\u884C\u53D8\u8272", "Zebra stripes")).setDesc(t("\u6BCF\u9694\u4E00\u884C\u81EA\u52A8\u586B\u8272\uFF08\u53EF\u88AB\u5355\u683C\u5E95\u8272\u8986\u76D6\uFF09\u3002\u542F\u7528\u8868\u5934\u5E95\u8272\u65F6\u4ECE\u7B2C 3 \u884C\u5F00\u59CB\u3002\u547D\u4EE4\u300C\u9694\u884C\u53D8\u8272\u6837\u5F0F\u300D\u4F7F\u7528\u8FD9\u91CC\u6700\u540E\u4E00\u6B21\u8BBE\u7F6E\u7684\u989C\u8272\u3002", 'Fills every other row (single-cell colors still win). Starts at row 3 when the header background is on. The "Zebra stripe style" command uses the last color configured here.')).addDropdown((d) => d.addOptions({
      "none": t("\u65E0\uFF08\u547D\u4EE4\u65F6\u7528\u4E3B\u9898\u8272\uFF09", "None (command falls back to theme)"),
      "theme": t("\u4E3B\u9898\u8272", "Theme color"),
      "custom": t("\u81EA\u5B9A\u4E49\u989C\u8272", "Custom color")
    }).setValue(this.plugin.settings.zebraStyle).onChange(async (value) => {
      this.plugin.settings.zebraStyle = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
      this.display();
    })).addToggle((tg) => tg.setTooltip(t("\u542F\u7528\u9694\u884C\u53D8\u8272", "Enable zebra stripes")).setValue(this.plugin.settings.zebraEnabled).onChange(async (value) => {
      this.plugin.settings.zebraEnabled = value;
      await this.plugin.saveSettings();
      refreshAllTableAppearance();
    }));
    if (this.plugin.settings.zebraStyle === "custom") {
      const zcSetting = new import_obsidian4.Setting(styleSection).setName(t("\u9694\u884C\u53D8\u8272\u81EA\u5B9A\u4E49\u989C\u8272", "Custom zebra color")).setDesc(t("\u586B\u5199\u5341\u516D\u8FDB\u5236\u989C\u8272\u7F16\u7801\uFF0C\u5982 #e8f0fe\u3002\u989C\u8272\u8FC7\u6DF1\u65F6\u6587\u5B57\u81EA\u52A8\u53CD\u767D\u3002", "Hex color, e.g. #e8f0fe. Dark colors get white text automatically."));
      const zcPreview = createSpan();
      zcPreview.className = "vt-color-preview";
      zcPreview.style.background = this.plugin.settings.zebraColor;
      zcSetting.nameEl.appendChild(zcPreview);
      zcSetting.addText((t2) => t2.setValue(this.plugin.settings.zebraColor).setPlaceholder(t2("\u989C\u8272\u503C\uFF08\u989C\u8272\u540D\u6216\u5341\u516D\u8FDB\u5236\uFF09", "Color name or hex value")).onChange(async (value) => {
        this.plugin.settings.zebraColor = value.trim();
        await this.plugin.saveSettings();
        refreshAllTableAppearance();
        if (CSS.supports("background-color", value.trim())) {
          zcPreview.style.background = value.trim();
        }
      }));
    }
    new import_obsidian4.Setting(styleSection).setName(t("\u5BFC\u51FA Markdown \u4FDD\u7559\u5BF9\u9F50\u4E0E\u5E95\u8272", "Keep alignment & colors in Markdown export")).setDesc(t('\u8F6C\u4E3A Markdown \u8868\u683C\u65F6\uFF0C\u7528\u5D4C\u5957 HTML \u6807\u7B7E\uFF08<center>\u3001<span style="background-color:..."> \u7B49\uFF09\u4FDD\u7559\u5355\u5143\u683C\u7684\u5BF9\u9F50\u4E0E\u5E95\u8272\u3002', 'When converting to Markdown, wrap cells in nested HTML tags (<center>, <span style="background-color:...">, etc.) to preserve alignment and colors.')).addToggle((t2) => t2.setValue(this.plugin.settings.mdHtmlTags).onChange(async (value) => {
      this.plugin.settings.mdHtmlTags = value;
      await this.plugin.saveSettings();
    }));
    this.displayContextMenuSection(styleSection);
  }
  /** 右键菜单自定义板块：文本框（一行一项，"---"=分隔线）+ 保存按钮 + 对照表 */
  displayContextMenuSection(containerEl) {
    new import_obsidian4.Setting(containerEl).setName(t("\u53F3\u952E\u83DC\u5355\u81EA\u5B9A\u4E49", "Context menu customization")).setHeading();
    const taRef = { el: null };
    const taSetting = new import_obsidian4.Setting(containerEl).setName(t("\u83DC\u5355\u7ED3\u6784\uFF08\u6587\u672C\u65B9\u5F0F\uFF09", "Menu layout (text)")).setDesc(t(
      '\u4E00\u884C\u4EE3\u8868\u83DC\u5355\u91CC\u7684\u4E00\u884C\uFF1B"---" \u4EE3\u8868\u5206\u9694\u7EBF\uFF1B"cmd:\u547D\u4EE4id" \u4EE3\u8868\u4EFB\u610F Obsidian \u547D\u4EE4\uFF1B"\u52A8\u4F5Cid|\u56FE\u6807\u540D" \u53EF\u81EA\u5B9A\u4E49\u56FE\u6807\uFF08\u56FE\u6807\u90E8\u5206\u53EF\u7701\u7565\uFF09\u3002\u4FEE\u6539\u540E\u8BF7\u70B9\u51FB\u4E0B\u65B9\u4FDD\u5B58\u6309\u94AE\u3002',
      'One menu row per line; "---" = separator; "cmd:commandId" = any Obsidian command; "actionId|iconName" overrides the icon. Press Save below to apply.'
    )).then((s) => {
      s.settingEl.classList.add("vt-menu-ta-setting");
    });
    const ta = taSetting.settingEl.createEl("textarea");
    ta.className = "text-input vt-menu-ta";
    ta.value = this.plugin.settings.contextMenu;
    taSetting.settingEl.insertAdjacentElement("afterend", ta);
    taRef.el = ta;
    new import_obsidian4.Setting(containerEl).setName(t("\u4FDD\u5B58\u83DC\u5355\u914D\u7F6E", "Save menu layout")).setDesc(t("\u70B9\u51FB\u4FDD\u5B58\u540E\u7ACB\u5373\u5BF9\u6240\u6709\u8868\u683C\u751F\u6548\uFF1B\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u5728\u5173\u95ED\u8BBE\u7F6E\u540E\u4E22\u5F03\u3002", "Applies to all tables immediately; unsaved edits are discarded when settings close.")).addButton((b) => b.setButtonText(t("\u4FDD\u5B58", "Save")).setCta().onClick(async () => {
      if (!taRef.el)
        return;
      this.plugin.settings.contextMenu = taRef.el.value;
      await this.plugin.saveSettings();
      new import_obsidian4.Notice(t("\u53F3\u952E\u83DC\u5355\u914D\u7F6E\u5DF2\u4FDD\u5B58", "Context menu saved"));
    }));
    const wrap = containerEl.createDiv({ cls: "vt-menu-lookup" });
    wrap.createDiv({
      cls: "vt-menu-lookup-title",
      text: t("\u5BF9\u7167\u8868\uFF08\u8F85\u52A9\u8F93\u5165\uFF09\uFF1A\u8F93\u5165\u5173\u952E\u8BCD\u7B5B\u9009\u547D\u4EE4\uFF0C\u70B9\u9009\u540E\u5728\u4E0B\u65B9\u590D\u5236\u751F\u6210\u7684\u884C\uFF0C\u7C98\u8D34\u5230\u4E0A\u9762\u7684\u6587\u672C\u6846", "Lookup helper: filter commands, click one, copy the generated line and paste it above")
    });
    const search = wrap.createEl("input", { type: "text" });
    search.placeholder = t("\u8F93\u5165\u5173\u952E\u8BCD\u7B5B\u9009\uFF08vtable \u52A8\u4F5C + Obsidian \u547D\u4EE4\uFF09\u2026", "Filter (vtable actions + Obsidian commands)\u2026");
    search.style.width = `100%`;
    const listBox = wrap.createDiv({ cls: "vt-menu-lookup-list" });
    const genIcon = wrap.createEl("input", { type: "text" });
    genIcon.placeholder = t("\u56FE\u6807\u540D\uFF08\u53EF\u9009\uFF0Clucide \u540D\u79F0\uFF0C\u5982 bold\uFF09", "Icon (optional lucide name, e.g. bold)");
    genIcon.style.width = `100%`;
    const genLine = wrap.createDiv({ cls: "vt-menu-lookup-line", text: t("\uFF08\u5C1A\u672A\u9009\u62E9\u547D\u4EE4\uFF09", "(no command selected)") });
    let selectedLine = "";
    const copyBtn = wrap.createEl("button", { text: t("\u590D\u5236\u751F\u6210\u7684\u884C", "Copy generated line") });
    copyBtn.addEventListener("click", () => {
      if (!selectedLine)
        return;
      const icon = genIcon.value.trim();
      const line = icon ? `${selectedLine}|${icon}` : selectedLine;
      void navigator.clipboard?.writeText(line);
      new import_obsidian4.Notice(t("\u5DF2\u590D\u5236\uFF0C\u8BF7\u7C98\u8D34\u5230\u4E0A\u65B9\u6587\u672C\u6846", "Copied \u2014 paste it into the box above"));
    });
    const sources = [];
    for (const [id, act] of Object.entries(VT_MENU_ACTIONS)) {
      sources.push({ line: id, name: `${act.zh} / ${act.en}` });
    }
    const cmds = this.app.commands.commands;
    for (const [id, c] of Object.entries(cmds ?? {})) {
      sources.push({ line: `cmd:${id}`, name: `${c.name} (Obsidian)` });
    }
    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      listBox.empty();
      const hits = sources.filter((s) => !q || s.name.toLowerCase().includes(q) || s.line.toLowerCase().includes(q)).slice(0, 15);
      for (const s of hits) {
        const item = listBox.createDiv({ cls: "vt-menu-lookup-item" });
        item.createSpan({ cls: "vt-menu-lookup-name", text: s.name });
        item.createEl("code", { cls: "vt-menu-lookup-code", text: s.line });
        item.addEventListener("click", () => {
          selectedLine = s.line;
          genLine.setText(t("\u751F\u6210\u7684\u884C\uFF1A", "Generated line: ") + (genIcon.value.trim() ? `${s.line}|${genIcon.value.trim()}` : s.line));
        });
      }
      if (!hits.length)
        listBox.createDiv({ text: t("\u65E0\u5339\u914D\u547D\u4EE4", "No matching commands") });
    };
    genIcon.addEventListener("input", () => {
      if (selectedLine)
        genLine.setText(t("\u751F\u6210\u7684\u884C\uFF1A", "Generated line: ") + `${selectedLine}|${genIcon.value.trim()}`);
    });
    search.addEventListener("input", renderList);
    renderList();
    const help = containerEl.createDiv({ cls: "vt-setting-hint" });
    help.createSpan({
      text: t(
        '\u7528\u6CD5\uFF1A\u83DC\u5355\u7ED3\u6784\u91CC\u4E00\u884C\u4E00\u9879\uFF0C"---" \u662F\u5206\u5272\u7EBF\uFF1B\u5BF9\u7167\u8868\u70B9\u9009\u547D\u4EE4\u540E\u590D\u5236\u751F\u6210\u7684\u884C\u7C98\u8D34\u8FDB\u6765\u5373\u53EF\uFF1B\u56FE\u6807\u53EF\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u3002\u8BE6\u7EC6\u6587\u6863\u89C1 ',
        'Usage: one item per line, "---" inserts a separator; pick a command in the lookup, copy the generated line and paste it above; leave the icon blank for the default. Full docs: '
      )
    });
    help.createEl("a", { text: "README", href: `${REPO_URL}#right-click-menu` }).setAttribute("target", "_blank");
  }
};
function findHtmlTable(ed) {
  const cur = ed.getCursor().line;
  const n = ed.lineCount();
  let start = -1;
  for (let l = cur; l >= 0; l--) {
    if (/<table[\s>]/i.test(ed.getLine(l))) {
      start = l;
      break;
    }
    if (l !== cur && /<\/table\s*>/i.test(ed.getLine(l)))
      break;
  }
  if (start === -1)
    return null;
  let end = -1;
  for (let l = start; l < n; l++) {
    if (/<\/table\s*>/i.test(ed.getLine(l))) {
      end = l;
      break;
    }
  }
  if (end === -1 || cur > end)
    return null;
  return { from: { line: start, ch: 0 }, to: { line: end, ch: ed.getLine(end).length } };
}
function findMdTable(ed) {
  const line = ed.getCursor().line;
  if (!ed.getLine(line).includes("|"))
    return null;
  let start = line;
  while (start > 0 && ed.getLine(start - 1).includes("|"))
    start--;
  let end = line;
  const n = ed.lineCount();
  while (end < n - 1 && ed.getLine(end + 1).includes("|"))
    end++;
  if (end - start < 1)
    return null;
  for (let l = start; l <= end; l++) {
    if (/^\s*\|?[\s\-:|]+\|?\s*$/.test(ed.getLine(l)) && ed.getLine(l).includes("-")) {
      return { from: { line: start, ch: 0 }, to: { line: end, ch: ed.getLine(end).length } };
    }
  }
  return null;
}
function findVtableBlock(ed) {
  const cur = ed.getCursor().line;
  let start = cur;
  while (start > 0) {
    const line = ed.getLine(start);
    if (/^```vtable\s*$/.test(line.trim()))
      break;
    start--;
  }
  if (start === 0 && !/^```vtable\s*$/.test(ed.getLine(0).trim()))
    return null;
  let end = start + 1;
  const n = ed.lineCount();
  while (end < n) {
    if (/^```\s*$/.test(ed.getLine(end).trim()))
      break;
    end++;
  }
  if (end >= n || cur > end)
    return null;
  return {
    blockFrom: { line: start, ch: 0 },
    blockTo: { line: end, ch: ed.getLine(end).length },
    contentFrom: { line: start + 1, ch: 0 },
    contentTo: { line: end, ch: 0 }
  };
}
function getAllVtableBlocks(ed) {
  const lines = ed.getValue().split("\n");
  const n = lines.length;
  const blocks = [];
  let i = 0;
  while (i < n) {
    if (lines[i].trim() === "```vtable") {
      const start = i;
      let end = i + 1;
      while (end < n && lines[end].trim() !== "```")
        end++;
      if (end < n) {
        blocks.push({
          blockFrom: { line: start, ch: 0 },
          blockTo: { line: end, ch: lines[end].length },
          contentFrom: { line: start + 1, ch: 0 },
          contentTo: { line: end, ch: 0 }
        });
      }
      i = end + 1;
    } else {
      i++;
    }
  }
  return blocks;
}
function findVtableBlockAbove(ed) {
  const cur = ed.getCursor().line;
  const blocks = getAllVtableBlocks(ed);
  let best = null;
  for (const b of blocks) {
    if (b.blockTo.line < cur)
      best = b;
    else if (b.blockFrom.line > cur)
      break;
  }
  return best;
}
var VtColorModal = class extends import_obsidian4.Modal {
  constructor(app, initial, onOk) {
    super(app);
    this.selected = null;
    this.onOk = onOk;
    this.selected = initial || null;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("vt-color-modal");
    contentEl.createEl("h3", { text: "\u8BBE\u7F6E\u9009\u4E2D\u5355\u5143\u683C\u5E95\u8272" });
    const presets = [
      ["#e74c3c", "\u7EA2"],
      ["#e67e22", "\u6A59"],
      ["#f1c40f", "\u9EC4"],
      ["#2ecc71", "\u7EFF"],
      ["#1abc9c", "\u9752"],
      ["#3498db", "\u84DD"],
      ["#9b59b6", "\u7D2B"],
      ["#95a5a6", "\u7070"],
      ["#ffffff", "\u767D"],
      ["#000000", "\u9ED1"]
    ];
    const grid = contentEl.createDiv({ cls: "vt-color-grid" });
    const swatches = [];
    const select = (el, color) => {
      this.selected = color;
      this.inputEl.value = color ?? "";
      preview.style.background = color || "transparent";
      swatches.forEach((s) => s.removeClass("is-selected"));
      el.addClass("is-selected");
    };
    for (const [hex] of presets) {
      const sw = grid.createEl("button", { cls: "vt-color-swatch" });
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener("click", () => select(sw, hex));
      swatches.push(sw);
      if (this.selected?.toLowerCase() === hex)
        sw.addClass("is-selected");
    }
    const clear = grid.createEl("button", { cls: "vt-color-swatch vt-color-clear" });
    clear.title = "\u65E0\u586B\u5145";
    (0, import_obsidian4.setIcon)(clear, "paintbrush");
    clear.addEventListener("click", () => select(clear, null));
    swatches.push(clear);
    if (!this.selected)
      clear.addClass("is-selected");
    const row = contentEl.createDiv({ cls: "vt-color-input-row" });
    const preview = row.createSpan({ cls: "vt-color-preview" });
    preview.style.background = this.selected || "transparent";
    this.inputEl = row.createEl("input", { type: "text", value: this.selected ?? "" });
    this.inputEl.placeholder = t("\u989C\u8272\u503C\uFF08\u989C\u8272\u540D\u6216\u5341\u516D\u8FDB\u5236\uFF09", "Color name or hex value");
    this.inputEl.addEventListener("input", () => {
      const v = this.inputEl.value.trim();
      if (v && CSS.supports("background-color", v)) {
        this.selected = v;
        preview.style.background = v;
        swatches.forEach((s) => s.removeClass("is-selected"));
      }
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.confirm();
      }
    });
    const actions = contentEl.createDiv({ cls: "vt-color-actions" });
    actions.createEl("button", { text: "\u53D6\u6D88" }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: "\u786E\u5B9A", cls: "mod-cta" }).addEventListener("click", () => this.confirm());
    window.setTimeout(() => this.inputEl.focus(), 50);
  }
  confirm() {
    const v = this.inputEl.value.trim();
    if (v && !CSS.supports("background-color", v)) {
      new import_obsidian4.Notice(t("\u65E0\u6548\u7684\u989C\u8272\u7F16\u7801", "Invalid color code"));
      return;
    }
    this.close();
    this.onOk(v || null);
  }
};
