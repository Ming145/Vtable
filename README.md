# Vtable

English | [中文](README_CN.md)

Enhanced editable tables for [Obsidian](https://obsidian.md). Create tables inside a ```vtable code block, edit cells directly in Live Preview, and go far beyond what native Markdown tables can do: in-cell line breaks, merged cells, Excel-style formulas, and even **checkable task lists that native tables can't hold** — plus images, math, charts, and one-click export.

Built to be beautiful out of the box: a clean, minimal design with theme-aware colors, and highly customizable — per-table line styles, zebra striping, header colors, cell alignment and background colors, all adjustable to match your vault.

Works on desktop, iPad, and mobile.

## Features

### Rich cell content

Anything you type in a cell renders on blur, exactly like Obsidian preview:

- Markdown inline styles: `**bold**`, `*italic*`, `==highlight==`, `~~strikethrough~~`, `` `code` ``, `[links](url)`
- Obsidian embeds: `![[image.png]]` and `![[image.png|300]]` — grab an image's corner handle while editing to resize it; the width syntax updates automatically
- Inline math: `$E=mc^2$`
- Checkable task lists: `- [ ]` / `- [x]` — click the checkbox in preview mode and the source updates
- Hand-written HTML where Markdown falls short (e.g. font sizes, colors)

### Structure

- Merge right / merge down / split, on single cells or whole selections
- Insert and delete rows and columns anywhere
- Drag row and column headers to reorder
- Skip-over navigation: Tab, Enter, and arrow keys jump across merged cells correctly
- Quick append: when the cursor is in the last row/column, a `+` bar appears at the table's bottom/right edge — click it to add a row/column

### Selection and batch operations

- `Ctrl/Cmd+Shift` + click to start a selection, drag for a rubber-band range
- Double-click a cell to select it; on mobile, double-tap accumulates a selection
- Batch apply bold, italic, font size, alignment (left/center/right), background color, or clear content
- Click a row/column drag handle without sliding to select the whole row/column; `Shift`+click adds it to the selection
- `Ctrl/Cmd+Delete` deletes the rows/columns of a full-row or full-column selection

### Grid copy & paste

Copy a rectangular region as a Markdown table, and paste any Markdown table back into the grid — across tables, notes, and even other apps:

- With a selection active, `Ctrl/Cmd+C` copies the region as a standard Markdown table (`| a | b |` with a separator row)
- Click a cell, then `Ctrl/Cmd+V` a Markdown table: it is written into the grid with the clicked cell as the top-left corner. Existing content is overwritten; anything beyond the current rows/columns is dropped (no rows or columns are added)
- `Ctrl/Cmd+Alt+V` pastes the same way but extends the table with whole rows/columns to fit the clipboard content
- Works between any two vtables (same note or different notes), and accepts Markdown tables copied from elsewhere. Pasting plain text keeps the original single-cell behavior

### Series fill (desktop)

Select a cell, grab the small triangle that appears at its bottom-right corner, and drag along a row or column:

- Plain text is copied; plain numbers fill incrementally (a small pop-up near the fill end flips the direction between increment and decrement)
- Mixed text + numbers keep the text and increment the number (`Item 1, Item 2, …`)
- Calendar-aware cycles: weekdays (`星期一…` / `Monday…`), months (`一月…` / `January…`) repeat in loops; dates advance by the real calendar with leap years respected
- Date formats (Chinese & English alike): `2027年2月28日`, `2027-02-28`, `2027/2/28`, `2027.2.28`, `2/28`, `02-28` (a first number above 12 is read day-first, e.g. `28/2`), `March 1`, `Mar 1`, `1 March`, `March 1, 2027`, `1 March 2027`; year-carrying dates use the date's own year for leap-year handling and roll over across New Year — no `2月29日` in non-leap years, and the year increments after `12月31日`; yearless ones cycle on the current year's calendar; fills preserve the input's writing style (separator, zero padding, full/abbreviated month names, comma)

### Diagonal split cells

The **Diagonal split cell** command draws a top-left → bottom-right diagonal in the focused (or selected) cell and splits it into two single-line input areas — upper-right and lower-left. If a cell already contains text, it moves to the lower-left area. Press Enter or arrow keys to jump between the two areas and out of the cell.

### Table style presets

Beyond the corner radius and header background, each table can take one of three line-style presets, plus zebra stripes:

- **Three-line table** — top rule, rule under the header, bottom rule; no vertical lines
- **No grid lines** — all cell borders removed
- **Horizontal lines only** — top/bottom edges and row separators kept, vertical lines removed
- **Zebra stripes** — alternate-row tinting from the theme accent or a custom color; single-cell backgrounds always win. Starts at row 3 when the header background is on

Presets apply to the whole vault via Settings, or per table with the **Table style call**, **Remove table styles**, and **Zebra stripe style** commands (per-table overrides are stored with the table). Styles are display-only: cells return to their raw look while you are editing them.

### Three display modes

Switch anytime from the mode buttons above the table; the choice is stored per table.

- **OL** (default) — cells wrap freely, auto height
- **HS** — cells stretch horizontally without wrapping, with a draggable custom scrollbar
- **RC** — fixed column widths and row heights with dedicated drag handles; rows auto-grow when content overflows

### Excel-style formulas

Start a cell with `=FUNC(range)` and it shows the computed result; focus the cell again to edit the original formula. Supported functions:

```
=SUM(A1:A5)   =AVERAGE(B1:B3)   =COUNT(C1:C9)   =MIN(A1:A9)   =MAX(A1:A9)
```

### Charts

Turn table data into SVG charts that follow dark/light themes:

- `vbarchart` bar charts, `vpie` pie charts, `vline` line charts
- A **Convert to chart** command auto-detects the header type; when a chart header is detected, a small **icon button** appears at the table's bottom-right corner — click it to convert without leaving the table
- Chart templates (Chinese/English sets, with sample content) can be added with one click from the settings panel
- **Combo charts**: any number of bar/line charts can live in one big table and render as a single fused chart — lines align to bar categories and overlay the bars, and multiple bar segments sit side by side within each category slot. The y-axis range takes the smallest lower bound and the largest upper bound across all segments' `y范围` entries (e.g. 0-3 and 1-5 → 0-5); the title and x/y axis names come from the leftmost segment. The table is a vertical merge where each segment occupies two columns (left = type/labels, right = values): declare the type (`vbarchart`/`vline`, any count) in each segment's left column on the first row, then fill config rows (`y范围` / `y` can be shared side by side across segments) and data rows (label｜value) in each segment's own two columns, with the `v%` row at the very bottom. There is no ready-made combo template — build one by moving rows from the single-chart tables

### Conversions

- Markdown table or HTML table → Vtable
- Vtable → Markdown table or HTML table
- All edits auto-save back into the code block source

### Data storage

Tables live inside a ` ```vtable ` code block and serialize to JSON, so everything survives round-trips:

- Each cell stores its content plus `rs`/`cs` (row/column span) and optional alignment and background color
- Extra fields keep per-table state: display mode, RC column widths and row heights, single-table line style and zebra stripe overrides
- Cell content is Markdown with inline HTML as needed; line breaks are stored as `<br>`
- Formulas store the original text (`=SUM(A1:B2)`) and evaluate at render time
- Every edit writes back to the code block automatically; plain Markdown pipe tables pasted into the block are parsed and converted too

### Keyboard and commands

The following shortcuts and gestures are built in and work out of the box (no configuration needed).

| Action | Shortcut |
| --- | --- |
| Drag-select a cell range | Ctrl/Cmd+Shift + drag |
| Select (or add to selection) a single cell | Ctrl/Cmd+Shift + click |
| Select the whole row / column | Click the row number / column label (RC mode) |
| Add rows / columns to the selection | Shift + click the row number / column label |
| Clear the selection | Plain click outside it |
| Select all text in a cell, then turn it into a selection | Ctrl/Cmd+A |
| Copy the selection as a Markdown table | Ctrl/Cmd+C |
| Paste a Markdown table (overwrite from the focused cell) | Ctrl/Cmd+V |
| Paste a Markdown table and extend rows/columns as needed | Ctrl/Cmd+Alt+V |
| Clear the content of selected cells | Backspace / Delete |
| Delete the full rows / columns of the selection (non-full selections only get a hint) | Ctrl/Cmd+Delete (Cmd+Backspace on Mac keyboards) |
| Delete the current row (macOS / iPad Magic Keyboard) | Cmd+Backspace |
| Wrap the selected text in bold (`**...**`) — in-cell editing only | Ctrl/Cmd+Alt+B |
| Undo the last in-cell edit | Ctrl/Cmd+Alt+Z |
| Next / previous cell | Tab / Shift+Tab |
| Move between cells (symmetric landing points) | ↑ ↓ ← → |

All commands can be bound to custom hotkeys in Obsidian settings, including create, conversions, chart generation, styling, diagonal split, and mode switching.

### Inline code behavior

- Inline code (backticks) renders its content **literally**: HTML inside backticks (e.g. tags) displays as plain text instead of being rendered, both while editing and after the cursor leaves the cell
- Triple-backtick fenced code blocks inside cells are not supported; fence source is shown and edited as plain text

### Floating toolbar

A two-row toolbar appears next to the focused cell: bold, italic, font size, merge/split, add/delete rows and columns, and one-click export. It can be enabled separately for desktop and mobile.

### Right-click menu

Quick access to insert/delete rows and columns, merge and split cells, copy / paste / cut / delete, and mode switching.

#### Customizing the context menu

The context menu is fully customizable in **Settings → vtable → 右键菜单自定义 (Context menu customization)**:

- **Text mode**: one menu row per line; `---` inserts a separator line; `cmd:commandId` inserts any Obsidian command; append `|iconName` (a Lucide icon name) to override an item's icon.
- **Lookup helper**: type a keyword to filter vtable actions and all Obsidian commands, click one, optionally enter an icon name, then copy the generated line and paste it into the text box.
- Press **Save** to apply the layout to all tables immediately. Built-in action ids: `vt.copy`, `vt.paste`, `vt.cut`, `vt.delete`, `vt.clearContent`, `vt.bold`, `vt.italic`, `vt.alignL`, `vt.alignC`, `vt.alignR`, `vt.alignT`, `vt.alignM`, `vt.alignB`, `vt.pickColor`, `vt.insRowAbove`, `vt.insRowBelow`, `vt.delRow`, `vt.insColLeft`, `vt.insColRight`, `vt.delCol`, `vt.mergeRight`, `vt.mergeDown`, `vt.split`, `vt.modeOL`, `vt.modeHS`, `vt.modeRC`.

### Settings

- UI language (中文 / English; floating toolbar abbreviations get an in-settings legend when English is selected). Command names follow the UI language — reload the plugin after switching
- Show the floating toolbar on desktop / mobile independently
- Show the OL/HS/RC mode switcher
- **Interactive component toggles**: fill handle / row & column drag handles / image resize handles can each be turned off (all on by default)
- **Table style** (collapsible section): table corner radius; header row background color (theme accent or custom); line-style presets (three-line / no grid / horizontal-only) with a global enable toggle; zebra stripes (theme or custom color, with the color picker shown when custom is selected) — plus per-table commands for header background and zebra stripes
- Export: keep alignment & colors in Markdown export via nested HTML tags
- Customizable context menu (see above)

## How to use

1. Run **Create vtable** from the command palette (`Ctrl/Cmd+P`), or convert an existing Markdown/HTML table with **Convert to vtable**
2. Click any cell to edit; press Enter for a new line inside the cell
3. Everything is stored in the ```vtable code block as JSON — your notes stay portable

## Installation

### From the Official Community Plugins (recommended)

Open **Settings → Community plugins → Browse** in Obsidian, search for **Vtable**, and install. Updates are delivered automatically through Obsidian.

### From BRAT

1. Install the **BRAT** community plugin
2. In BRAT settings, choose *Add beta plugin*
3. Enter `https://github.com/Ming145/Vtable`
4. Enable Vtable in community plugins

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest [Release](https://github.com/Ming145/Vtable/releases)
2. Create the folder `.obsidian/plugins/vtable/` in your vault
3. Copy the three files into it
4. Reload Obsidian and enable **Vtable** in community plugins

## Building from source

```bash
git clone https://github.com/Ming145/Vtable
cd Vtable
npm install
npm run build
```

Then copy `main.js`, `styles.css`, and `manifest.json` into `.obsidian/plugins/vtable/`.

## AI skill

Want an AI assistant (Claude, ChatGPT, …) to write Vtable source code for you? A ready-made skill covering the full source syntax — JSON schema, merged cells, line breaks, formulas, styles, charts and more, all with copy-paste examples — is available at [vtable-syntax](https://github.com/Ming145/vtable-syntax).

## License

[MIT](LICENSE)

## Disclaimer

This plugin has no affiliation with, and is not related to ByteDance's VTable (VisActor) in any way. The "V" in "Vtable" is merely a prefix from our own plugin series naming and carries no meaning of its own.
