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
var import_obsidian2 = require("obsidian");

// src/builder.ts
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
  s = s.replace(/`([^`]+)`/g, (_, content) => protect("`" + escapeHtml(content) + "`"));
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
function cell(t = "") {
  return { t, rs: 1, cs: 1 };
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
function serialize(grid) {
  return JSON.stringify({ rows: grid });
}
function blankSource(cols, rows) {
  return serialize(blankGrid(cols, rows));
}
function parseSource(src) {
  const trimmed = src.trim();
  if (trimmed === "")
    return blankGrid(1, 1);
  try {
    const obj = JSON.parse(trimmed);
    if (obj && Array.isArray(obj.rows)) {
      return normalize(obj.rows);
    }
  } catch {
  }
  return pipeToGrid(trimmed);
}
function normalize(rows) {
  const g = [];
  for (const rawRow of rows) {
    if (!Array.isArray(rawRow))
      continue;
    const row = rawRow.map((x) => {
      const o = x;
      return {
        t: typeof o.t === "string" ? o.t : "",
        rs: typeof o.rs === "number" ? o.rs : 1,
        cs: typeof o.cs === "number" ? o.cs : 1
      };
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
  return s.split("|").map((c) => c.trim());
}
function mdTableToSource(md) {
  const lines = md.split("\n").filter((l) => l.trim() !== "");
  const rows = lines.filter((l) => !isSeparator(l)).map(splitRow);
  const grid = rows.map((r) => r.map((t) => cell(mdInlineToHtml(t))));
  return serialize(grid.length ? grid : blankGrid(1, 1));
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
  return serialize(full);
}
function gridToHtmlTable(grid) {
  const cols = colCount(grid);
  if (grid.length === 0 || cols === 0)
    return "<table>\n</table>";
  const lines = ["<table>"];
  for (const row of grid) {
    const tds = row.filter(visible).map((c) => {
      const attrs = (c.rs > 1 ? ` rowspan="${c.rs}"` : "") + (c.cs > 1 ? ` colspan="${c.cs}"` : "");
      return `<td${attrs}>${c.t}</td>`;
    }).join("");
    lines.push(`<tr>${tds}</tr>`);
  }
  lines.push("</table>");
  return lines.join("\n");
}
function escapeMdCell(t) {
  return t.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}
function gridToMdTable(grid) {
  const cols = colCount(grid);
  if (grid.length === 0 || cols === 0)
    return "";
  const flat = grid.map((row) => row.map((c) => visible(c) ? c.t : ""));
  const toLine = (row) => "| " + row.map(escapeMdCell).join(" | ") + " |";
  const lines = [toLine(flat[0]), toLine(new Array(cols).fill("---"))];
  for (let r = 1; r < flat.length; r++)
    lines.push(toLine(flat[r]));
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

// src/render.ts
var import_obsidian = require("obsidian");

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

// src/render.ts
var mathJaxReady = null;
function ensureMathJax() {
  if (!mathJaxReady)
    mathJaxReady = (0, import_obsidian.loadMathJax)();
  return mathJaxReady;
}
function scheduleMathRender(root) {
  void ensureMathJax().then(() => {
    if (renderMathInNode(root))
      void (0, import_obsidian.finishRenderMath)();
  });
}
function renderBlock(source, el, toolbar, settings, sourcePath, resolveImage, onCommit, onConvertToMd, onConvertToHtml) {
  el.empty();
  el.classList.add("vtable-container");
  const grid = parseSource(source);
  const table = el.createEl("table", { cls: "vt" });
  const tbody = table.createEl("tbody");
  grid.forEach((row, r) => {
    const tr = tbody.createEl("tr");
    row.forEach((cellData, c) => {
      if (!visible(cellData))
        return;
      const td = tr.createEl("td");
      td.contentEditable = "true";
      if (cellData.rs > 1)
        td.rowSpan = cellData.rs;
      if (cellData.cs > 1)
        td.colSpan = cellData.cs;
      td.innerHTML = cellData.t;
      if (/^=[A-Z]+\(/i.test(cellData.t)) {
        td.textContent = evalFormula(grid, cellData.t);
      }
      renderHtml(td);
      renderMarkdown(td);
      renderImages(td, sourcePath, resolveImage);
      td.addEventListener("focus", () => {
        if (!td.closest(".cm-editor")) {
          td.blur();
          return;
        }
        td.innerHTML = grid[r][c].t;
        if (import_obsidian.Platform.isDesktop && !settings.enableDesktopToolbar)
          return;
        if ((import_obsidian.Platform.isMobile || import_obsidian.Platform.isTablet) && !settings.enableMobileToolbar)
          return;
        toolbar.show(td, grid, r, c, onCommit, () => onConvertToMd(grid), () => onConvertToHtml(grid));
      });
      td.addEventListener("blur", (e) => {
        const html = td.innerHTML;
        const relatedTarget = e.relatedTarget;
        const inSameTable = relatedTarget?.closest(".vt") === td.closest(".vt");
        if (grid[r][c].t !== html) {
          grid[r][c].t = html;
          if (!inSameTable)
            onCommit(serialize(grid));
        }
        td.innerHTML = html;
        if (/^=[A-Z]+\(/i.test(html)) {
          td.textContent = evalFormula(grid, html);
        }
        renderHtml(td);
        renderMarkdown(td);
        renderImages(td, sourcePath, resolveImage);
        scheduleMathRender(td);
        if (!inSameTable && document.body.dataset.vtBarClick !== "1")
          toolbar.hide();
      });
      td.addEventListener("contextmenu", (e) => {
        if (!td.closest(".cm-editor"))
          return;
        e.preventDefault();
        e.stopPropagation();
        showCellMenu(e, grid, r, c, toolbar, onCommit);
      });
    });
  });
  scheduleMathRender(table);
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
  const frag = document.createDocumentFragment();
  while (match = MATH_RE.exec(text)) {
    if (match.index > last)
      frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    const display = match[1] !== void 0;
    const source = (match[1] ?? match[2] ?? "").trim();
    try {
      frag.appendChild((0, import_obsidian.renderMath)(source, display));
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
    const frag = document.createRange().createContextualFragment(text);
    textNode.replaceWith(frag);
  }
}
function renderMarkdown(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !/[*_~=]/.test(text))
      continue;
    if (node.parentElement?.closest("b, i, mark, s, a, code, img"))
      continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    const html = mdInlineToHtml(textNode.textContent);
    if (html === textNode.textContent)
      continue;
    const frag = document.createDocumentFragment();
    frag.append(document.createRange().createContextualFragment(html));
    textNode.replaceWith(frag);
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
    const frag = document.createDocumentFragment();
    while (match = IMG_RE.exec(text)) {
      if (match.index > last)
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      const linkText = match[1].trim();
      const altText = match[2]?.trim() ?? "";
      const src = resolveImage(linkText);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = altText || linkText;
        img.style.maxWidth = "100%";
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
function showCellMenu(e, grid, r, c, toolbar, onCommit) {
  const menu = new import_obsidian.Menu();
  const apply = (fn) => {
    toolbar.hide();
    fn();
    onCommit(serialize(grid));
  };
  menu.addItem((i) => i.setTitle("\u4E0A\u65B9\u63D2\u5165\u884C").setIcon("arrow-up").onClick(() => apply(() => insertRow(grid, r - 1))));
  menu.addItem((i) => i.setTitle("\u4E0B\u65B9\u63D2\u5165\u884C").setIcon("arrow-down").onClick(() => apply(() => insertRow(grid, r))));
  menu.addItem((i) => i.setTitle("\u5220\u9664\u672C\u884C").setIcon("trash").onClick(() => apply(() => deleteRow(grid, r))));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("\u5DE6\u4FA7\u63D2\u5165\u5217").setIcon("arrow-left").onClick(() => apply(() => insertCol(grid, c - 1))));
  menu.addItem((i) => i.setTitle("\u53F3\u4FA7\u63D2\u5165\u5217").setIcon("arrow-right").onClick(() => apply(() => insertCol(grid, c))));
  menu.addItem((i) => i.setTitle("\u5220\u9664\u672C\u5217").setIcon("trash").onClick(() => apply(() => deleteCol(grid, c))));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("\u5411\u53F3\u5408\u5E76").setIcon("arrow-right-to-line").onClick(() => apply(() => mergeRight(grid, r, c))));
  menu.addItem((i) => i.setTitle("\u5411\u4E0B\u5408\u5E76").setIcon("arrow-down-to-line").onClick(() => apply(() => mergeDown(grid, r, c))));
  menu.addItem((i) => i.setTitle("\u62C6\u5206\u5355\u5143\u683C").setIcon("split-square-horizontal").onClick(() => apply(() => splitCell(grid, r, c))));
  menu.showAtMouseEvent(e);
}

// src/bar.ts
var Toolbar = class {
  constructor() {
    this.cell = null;
    this.grid = null;
    this.cellR = 0;
    this.cellC = 0;
    this.onCommit = null;
    this.onConvertToMd = null;
    this.onConvertToHtml = null;
    this.animated = false;
    this.animatedTimer = null;
    this.el = document.body.createEl("div", { cls: "vt-bar" });
    this.el.style.display = "none";
    this.buildRows();
  }
  /* ===== 构建两行 ===== */
  buildRows() {
    const row1 = this.el.createEl("div", { cls: "vt-bar-row" });
    const fmtDefs = [
      ["B", "\u52A0\u7C97", () => this.exec("bold")],
      ["I", "\u659C\u4F53", () => this.exec("italic")],
      ["A-", "\u7F29\u5C0F\u5B57\u53F7", () => this.stepFont(-2)],
      ["A+", "\u653E\u5927\u5B57\u53F7", () => this.stepFont(2)]
    ];
    for (const [label, hint, fn] of fmtDefs) {
      const btn = row1.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        document.body.dataset.vtBarClick = "1";
        fn();
        setTimeout(() => {
          delete document.body.dataset.vtBarClick;
        }, 200);
      });
    }
    row1.createEl("span", { cls: "vt-bar-sep" });
    const splitBtn = row1.createEl("button", { cls: "vt-bar-btn", text: "\u62C6" });
    splitBtn.title = "\u62C6\u5206\u5355\u5143\u683C";
    splitBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.structExec(splitCell);
    });
    const mergeDefs = [
      ["\u5408\u2193", "\u5411\u4E0B\u5408\u5E76\u5355\u5143\u683C", mergeDown],
      ["\u5408\u2192", "\u5411\u53F3\u5408\u5E76\u5355\u5143\u683C", mergeRight]
    ];
    for (const [label, hint, fn] of mergeDefs) {
      const btn = row1.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.structExec(fn);
      });
    }
    const row2 = this.el.createEl("div", { cls: "vt-bar-row" });
    const opDefs = [
      ["\uFF0B\u884C", "\u4E0B\u65B9\u63D2\u5165\u884C", (g, r) => insertRow(g, r)],
      ["\uFF0B\u5217", "\u53F3\u4FA7\u63D2\u5165\u5217", (g, _r, c) => insertCol(g, c)],
      ["\uFF0D\u884C", "\u5220\u9664\u672C\u884C", (g, r) => deleteRow(g, r)],
      ["\uFF0D\u5217", "\u5220\u9664\u672C\u5217", (g, _r, c) => deleteCol(g, c)]
    ];
    for (const [label, hint, fn] of opDefs) {
      const btn = row2.createEl("button", { cls: "vt-bar-btn", text: label });
      btn.title = hint;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.structExec(fn);
      });
    }
    row2.createEl("span", { cls: "vt-bar-sep" });
    const mdBtn = row2.createEl("button", { cls: "vt-bar-btn", text: "MD" });
    mdBtn.title = "\u8F6C\u6362\u4E3A markdown \u8868\u683C";
    mdBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const convert = this.onConvertToMd;
      document.body.dataset.vtBarClick = "1";
      this.hide();
      if (convert)
        convert();
      setTimeout(() => {
        delete document.body.dataset.vtBarClick;
      }, 200);
    });
    const htmlBtn = row2.createEl("button", { cls: "vt-bar-btn", text: "H5" });
    htmlBtn.title = "\u8F6C\u6362\u4E3A HTML \u8868\u683C";
    htmlBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const convert = this.onConvertToHtml;
      document.body.dataset.vtBarClick = "1";
      this.hide();
      if (convert)
        convert();
      setTimeout(() => {
        delete document.body.dataset.vtBarClick;
      }, 200);
    });
  }
  /** 执行结构操作 → 提交 → 隐藏工具栏（Obsidian 重新渲染） */
  structExec(fn) {
    if (!this.grid || !this.onCommit)
      return;
    const g = this.grid;
    const commit = this.onCommit;
    const r = this.cellR;
    const c = this.cellC;
    this.hide();
    fn(g, r, c);
    commit(serialize(g));
  }
  /* ===== 显示/隐藏/定位 ===== */
  show(cell2, grid, r, c, onCommit, onConvertToMd, onConvertToHtml) {
    this.cell = cell2;
    this.grid = grid;
    this.cellR = r;
    this.cellC = c;
    this.onCommit = onCommit;
    this.onConvertToMd = onConvertToMd;
    this.onConvertToHtml = onConvertToHtml;
    if (this.animatedTimer !== null) {
      clearTimeout(this.animatedTimer);
      this.animatedTimer = null;
    }
    if (!this.animated) {
      this.el.style.transition = "none";
      this.el.style.display = "flex";
      this.el.style.transform = "scale(0.8) translateY(6px)";
      this.el.style.opacity = "0.7";
      if (!this.reposition()) {
        this.el.style.display = "none";
        return;
      }
      void this.el.offsetWidth;
      this.el.style.transition = "";
      this.animated = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.el.style.transform = "scale(1) translateY(0)";
          this.el.style.opacity = "1";
        });
      });
    } else {
      this.el.style.transition = "none";
      this.el.style.display = "flex";
      this.el.style.transform = "scale(1) translateY(0)";
      this.el.style.opacity = "1";
      if (!this.reposition()) {
        this.el.style.display = "none";
        return;
      }
      void this.el.offsetWidth;
      this.el.style.transition = "";
    }
  }
  hide() {
    this.el.style.transform = "";
    this.el.style.opacity = "";
    this.el.style.display = "none";
    this.cell = null;
    this.grid = null;
    this.onCommit = null;
    this.onConvertToMd = null;
    this.onConvertToHtml = null;
    if (this.animatedTimer !== null)
      clearTimeout(this.animatedTimer);
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
    this.el.style.position = "fixed";
    this.el.style.left = `${left}px`;
    this.el.style.top = `${sRect.top + sRect.height * 0.8}px`;
    this.el.style.zIndex = "9999";
    return true;
  }
  /* ===== 文本格式化 ===== */
  exec(cmd, value) {
    document.execCommand(cmd, false, value);
  }
  stepFont(delta) {
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
      const span = document.createElement("span");
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
      clearTimeout(this.animatedTimer);
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
    const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ""));
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
  const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}${mc}{text-align:center;font-size:28px;font-weight:700;margin:0 0 20px;color:#111}${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${bv}{fill:#111}${xl}{fill:#333}`;
  let sBars = "";
  for (let i = 0; i < n; i++)
    sBars += `.bar-${i}{fill:${lightColors[i % lightColors.length]}}`;
  const sDark = `@media(prefers-color-scheme:dark){${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}${mc}{color:#F9FAFB}${gl}{stroke:rgba(255,255,255,.08)}${al}{stroke:#6B7280}${at}{fill:#9CA3AF}${bv}{fill:#F9FAFB}${xl}{fill:#D1D5DB}`;
  let sBarsDark = "";
  for (let i = 0; i < n; i++)
    sBarsDark += `.bar-${i}{fill:${darkColor}}`;
  const sDarkClose = "}";
  const style = sLight + sBars + sDark + sBarsDark + sDarkClose;
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
    const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ""));
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
    const value = parseFloat(valStr.replace(/[^0-9.\-]/g, ""));
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
  const sLight = `${cls}{width:650px;padding:30px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}${mc}{text-align:center;font-size:28px;font-weight:700;margin:0 0 20px;color:#111}${gl}{stroke:#eee}${al}{stroke:#333}${at}{fill:#666}${dv}{fill:#111}${xl}{fill:#333}${ln}{fill:none;stroke:#111;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}${dot}{fill:#111}`;
  const sDark = `@media(prefers-color-scheme:dark){${cls}{background:#111827;box-shadow:0 12px 40px rgba(0,0,0,.45)}${mc}{color:#F9FAFB}${gl}{stroke:rgba(255,255,255,.08)}${al}{stroke:#6B7280}${at}{fill:#9CA3AF}${dv}{fill:#F9FAFB}${xl}{fill:#D1D5DB}${ln}{stroke:#60A5FA}${dot}{fill:#60A5FA}`;
  const style = sLight + sDark + "}";
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

// src/main.ts
var LANG = "vtable";
var DEFAULT_SETTINGS = {
  enableDesktopToolbar: true,
  enableMobileToolbar: true
};
var VtPlugin = class extends import_obsidian2.Plugin {
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
    const folderExists = await vault.adapter.exists(templateFolder);
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
      const fileExists = await vault.adapter.exists(filePath);
      if (!fileExists) {
        await vault.create(filePath, tpl.content);
      }
    }
  }
  async onload() {
    await this.ensureTemplates();
    this.addCommand({
      id: "delete-current-vtable",
      name: "\u5220\u9664\u5F53\u524D Vtable \u8868\u683C",
      checkCallback: (checking) => {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor)
          return false;
        const cursor = editor.getCursor();
        const currentLine = cursor.line;
        const currentLineText = editor.getLine(currentLine);
        const isBlank = currentLineText.trim() === "";
        if (!isBlank)
          return false;
        if (currentLine === 0)
          return false;
        const prevLine = currentLine - 1;
        const prevLineText = editor.getLine(prevLine);
        if (prevLineText.trim() !== "```")
          return false;
        let startLine = -1;
        let endLine = prevLine;
        for (let i = prevLine - 1; i >= 0; i--) {
          const lineText = editor.getLine(i);
          if (lineText.trim() === "```vtable") {
            startLine = i;
            break;
          }
          if (lineText.trim() === "```" && i !== prevLine)
            break;
        }
        if (startLine === -1)
          return false;
        if (checking)
          return true;
        const from = { line: startLine, ch: 0 };
        const to = { line: endLine, ch: editor.getLine(endLine).length };
        editor.replaceRange("", from, to);
        const afterLine = editor.getLine(startLine);
        if (afterLine === "") {
          editor.replaceRange("", { line: startLine, ch: 0 }, { line: startLine + 1, ch: 0 });
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
        (grid) => this.convertBlockToHtml(el, ctx, grid)
      );
    });
    this.addCommand({
      id: "vt-create",
      name: "\u521B\u5EFA vtable",
      editorCallback: (ed) => this.insertTable(ed)
    });
    this.addCommand({
      id: "vt-convert",
      name: "\u8F6C\u6362\u4E3A vtable",
      editorCallback: (ed) => this.convertAtCursor(ed)
    });
    this.addCommand({
      id: "vt-to-markdown",
      name: "\u8F6C\u6362\u4E3A markdown \u8868\u683C",
      editorCallback: (ed) => this.vtableToMarkdown(ed)
    });
    this.addCommand({
      id: "vt-to-html",
      name: "\u8F6C\u6362\u4E3A HTML \u8868\u683C",
      editorCallback: (ed) => this.vtableToHtml(ed)
    });
    this.addCommand({
      id: "vt-to-barchart",
      name: "\u8F6C\u6362\u4E3A\u67F1\u72B6\u56FE",
      editorCallback: (ed) => this.vtableToBarChart(ed)
    });
    this.addCommand({
      id: "vt-to-piechart",
      name: "\u8F6C\u6362\u4E3A\u997C\u72B6\u56FE",
      editorCallback: (ed) => this.vtableToPieChart(ed)
    });
    this.addCommand({
      id: "vt-to-linechart",
      name: "\u8F6C\u6362\u4E3A\u6298\u7EBF\u56FE",
      editorCallback: (ed) => this.vtableToLineChart(ed)
    });
    this.addRibbonIcon("table-2", "\u8F6C\u6362\u4E3A vtable", () => {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
      if (view)
        this.convertAtCursor(view.editor);
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
  insertTable(ed) {
    const block = "```" + LANG + "\n" + blankSource(2, 2) + "\n```";
    const cur = ed.getCursor();
    const end = { line: cur.line, ch: ed.getLine(cur.line).length };
    ed.replaceRange("\n" + block + "\n", end);
    ed.setCursor({ line: cur.line + 2, ch: 0 });
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
    const grid = parseSource(source);
    const md = gridToMdTable(grid);
    ed.replaceRange(md, range.blockFrom, range.blockTo);
  }
  /** 把光标所在的 vtable 代码块转换回 HTML 表格 */
  vtableToHtml(ed) {
    const range = findVtableBlock(ed);
    if (!range)
      return;
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const grid = parseSource(source);
    const html = gridToHtmlTable(grid);
    ed.replaceRange(html, range.blockFrom, range.blockTo);
  }
  /** 把光标所在的 vtable 代码块转换为柱状图 HTML，插入在代码块下方 */
  vtableToBarChart(ed) {
    let range = findVtableBlock(ed);
    if (!range)
      range = findVtableBlockAnywhere(ed);
    if (!range) {
      new import_obsidian2.Notice("\u672A\u627E\u5230 vtable \u4EE3\u7801\u5757");
      return;
    }
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const grid = parseSource(source);
    const headerLabels = ["vbarchart", "\u6807\u9898", "v%", "x\u8303\u56F4", "x", "y\u8303\u56F4", "y"];
    if (grid.length < 8) {
      new import_obsidian2.Notice(`\u8868\u683C\u884C\u6570\u4E0D\u8DB3\uFF08\u9700\u8981\u81F3\u5C11 8 \u884C\uFF0C\u5F53\u524D ${grid.length} \u884C\uFF09`);
      return;
    }
    const colCount2 = grid[0]?.length ?? 0;
    if (colCount2 < 2) {
      new import_obsidian2.Notice(`\u8868\u683C\u81F3\u5C11\u9700\u8981 2 \u5217\uFF0C\u5F53\u524D\u4EC5 ${colCount2} \u5217`);
      return;
    }
    for (let i = 0; i < headerLabels.length; i++) {
      const cellText = grid[i]?.[0]?.t?.trim() ?? "";
      if (cellText !== headerLabels[i]) {
        new import_obsidian2.Notice(`\u7B2C ${i + 1} \u884C\u7B2C 1 \u5217\u5E94\u4E3A "${headerLabels[i]}"\uFF0C\u5F53\u524D\u4E3A "${cellText}"`);
        return;
      }
    }
    const html = generateBarChart(grid);
    if (!html) {
      new import_obsidian2.Notice("\u8868\u683C\u5F62\u5F0F\u4E0D\u89C4\u8303\uFF1A\u6570\u636E\u884C\u7F3A\u5931\u6216\u683C\u5F0F\u6709\u8BEF");
      return;
    }
    ed.replaceRange("\n" + html + "\n", { line: range.blockTo.line + 1, ch: 0 });
  }
  /** 把光标所在的 vtable 代码块转换为 Mermaid 饼状图代码块，插入在代码块下方 */
  vtableToPieChart(ed) {
    let range = findVtableBlock(ed);
    if (!range)
      range = findVtableBlockAnywhere(ed);
    if (!range) {
      new import_obsidian2.Notice("\u672A\u627E\u5230 vtable \u4EE3\u7801\u5757");
      return;
    }
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const grid = parseSource(source);
    const headerLabels = ["vpie", "\u6807\u9898"];
    if (grid.length < 3) {
      new import_obsidian2.Notice(`\u8868\u683C\u884C\u6570\u4E0D\u8DB3\uFF08\u9700\u8981\u81F3\u5C11 3 \u884C\uFF0C\u5F53\u524D ${grid.length} \u884C\uFF09`);
      return;
    }
    const colCount2 = grid[0]?.length ?? 0;
    if (colCount2 < 2) {
      new import_obsidian2.Notice(`\u8868\u683C\u81F3\u5C11\u9700\u8981 2 \u5217\uFF0C\u5F53\u524D\u4EC5 ${colCount2} \u5217`);
      return;
    }
    for (let i = 0; i < headerLabels.length; i++) {
      const cellText = grid[i]?.[0]?.t?.trim() ?? "";
      if (cellText !== headerLabels[i]) {
        new import_obsidian2.Notice(`\u7B2C ${i + 1} \u884C\u7B2C 1 \u5217\u5E94\u4E3A "${headerLabels[i]}"\uFF0C\u5F53\u524D\u4E3A "${cellText}"`);
        return;
      }
    }
    const mermaid = generatePieChart(grid);
    if (!mermaid) {
      new import_obsidian2.Notice("\u8868\u683C\u5F62\u5F0F\u4E0D\u89C4\u8303\uFF1A\u6570\u636E\u884C\u7F3A\u5931\u6216\u683C\u5F0F\u6709\u8BEF");
      return;
    }
    ed.replaceRange("\n" + mermaid + "\n", { line: range.blockTo.line + 1, ch: 0 });
  }
  /** 把光标所在的 vtable 代码块转换为折线图 HTML，插入在代码块下方 */
  vtableToLineChart(ed) {
    let range = findVtableBlock(ed);
    if (!range)
      range = findVtableBlockAnywhere(ed);
    if (!range) {
      new import_obsidian2.Notice("\u672A\u627E\u5230 vtable \u4EE3\u7801\u5757");
      return;
    }
    const source = ed.getRange(range.contentFrom, range.contentTo);
    const grid = parseSource(source);
    const headerLabels = ["vline", "\u6807\u9898", "x\u8303\u56F4", "x", "y\u8303\u56F4", "y"];
    if (grid.length < 7) {
      new import_obsidian2.Notice(`\u8868\u683C\u884C\u6570\u4E0D\u8DB3\uFF08\u9700\u8981\u81F3\u5C11 7 \u884C\uFF0C\u5F53\u524D ${grid.length} \u884C\uFF09`);
      return;
    }
    const colCount2 = grid[0]?.length ?? 0;
    if (colCount2 < 2) {
      new import_obsidian2.Notice(`\u8868\u683C\u81F3\u5C11\u9700\u8981 2 \u5217\uFF0C\u5F53\u524D\u4EC5 ${colCount2} \u5217`);
      return;
    }
    for (let i = 0; i < headerLabels.length; i++) {
      const cellText = grid[i]?.[0]?.t?.trim() ?? "";
      if (cellText !== headerLabels[i]) {
        new import_obsidian2.Notice(`\u7B2C ${i + 1} \u884C\u7B2C 1 \u5217\u5E94\u4E3A "${headerLabels[i]}"\uFF0C\u5F53\u524D\u4E3A "${cellText}"`);
        return;
      }
    }
    const html = generateLineChart(grid);
    if (!html) {
      new import_obsidian2.Notice("\u8868\u683C\u5F62\u5F0F\u4E0D\u89C4\u8303\uFF1A\u6570\u636E\u884C\u7F3A\u5931\u6216\u683C\u5F0F\u6709\u8BEF");
      return;
    }
    ed.replaceRange("\n" + html + "\n", { line: range.blockTo.line + 1, ch: 0 });
  }
  /** 将新的表格源文本写回代码块内部（围栏之间的行） */
  writeBack(el, ctx, newSource) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const from = { line: info.lineStart + 1, ch: 0 };
    const to = { line: info.lineEnd, ch: 0 };
    editor.replaceRange(newSource + "\n", from, to);
  }
  /** 把整个 vtable 代码块（含围栏）替换为 markdown 表格 */
  convertBlockToMarkdown(el, ctx, grid) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const from = { line: info.lineStart, ch: 0 };
    const to = { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length };
    editor.replaceRange(gridToMdTable(grid), from, to);
  }
  /** 把整个 vtable 代码块（含围栏）替换为 HTML 表格 */
  convertBlockToHtml(el, ctx, grid) {
    const info = ctx.getSectionInfo(el);
    if (!info)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
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
var VtSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "vtable \u8BBE\u7F6E" });
    new import_obsidian2.Setting(containerEl).setName("\u7535\u8111\u7AEF\u6D6E\u7A97\u5DE5\u5177\u680F").setDesc("\u5728\u7535\u8111\u7AEF\u7F16\u8F91\u5355\u5143\u683C\u65F6\u663E\u793A\u60AC\u6D6E\u683C\u5F0F\u5316\u5DE5\u5177\u680F").addToggle((t) => t.setValue(this.plugin.settings.enableDesktopToolbar).onChange(async (value) => {
      this.plugin.settings.enableDesktopToolbar = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u79FB\u52A8\u7AEF\u6D6E\u7A97\u5DE5\u5177\u680F").setDesc("\u5728\u624B\u673A/\u5E73\u677F\u8BBE\u5907\u4E0A\u7F16\u8F91\u5355\u5143\u683C\u65F6\u663E\u793A\u60AC\u6D6E\u683C\u5F0F\u5316\u5DE5\u5177\u680F").addToggle((t) => t.setValue(this.plugin.settings.enableMobileToolbar).onChange(async (value) => {
      this.plugin.settings.enableMobileToolbar = value;
      await this.plugin.saveSettings();
    }));
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
function findVtableBlockAnywhere(ed) {
  const fullText = ed.getValue();
  const lines = fullText.split("\n");
  const cursorLine = ed.getCursor().line;
  const n = lines.length;
  let best = null;
  let bestDist = Infinity;
  let i = 0;
  while (i < n) {
    const line = lines[i].trim();
    if (line === "```vtable") {
      const blockStart = i;
      let blockEnd = i + 1;
      while (blockEnd < n) {
        if (lines[blockEnd].trim() === "```")
          break;
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
            contentTo: { line: blockEnd, ch: 0 }
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
