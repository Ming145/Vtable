# Vtable

English | [中文](README_CN.md)

Enhanced editable tables for [Obsidian](https://obsidian.md). Create tables inside a ```vtable code block, edit cells directly in Live Preview, and go far beyond what native Markdown tables can do: in-cell line breaks, merged cells, Excel-style formulas, checkable task lists, images, math, charts, and one-click export.

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
- Calendar-aware cycles: weekdays (`星期一…` / `Monday…`), months (`一月…` / `January…`) repeat in loops; dates like `1月1日` advance by the real calendar (leap years respected)

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
- A **Convert to chart** command auto-detects the header type
- Template files are generated automatically so you can start from a ready-made structure

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

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Next / previous cell |
| `↑ ↓ ← →` | Move between cells (symmetric landing points) |
| `Cmd+Delete` | Delete the current row (macOS) |
| `Ctrl/Cmd+Delete` | Delete rows/columns of a full selection |
| `Ctrl/Cmd+C` | Copy the active selection as a Markdown table |
| `Ctrl/Cmd+V` | Paste a Markdown table into the grid (top-left = focused cell) |
| `Ctrl/Cmd+Alt+V` | Paste a Markdown table and extend rows/columns as needed |

All commands can be bound to custom hotkeys in Obsidian settings, including create, conversions, chart generation, styling, diagonal split, and mode switching.

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
- **Table style** (collapsible section): table corner radius; header row background color (theme accent or custom); line-style presets (three-line / no grid / horizontal-only) with a global enable toggle; zebra stripes (theme or custom color, with the color picker shown when custom is selected) — plus per-table commands for header background and zebra stripes
- Export: keep alignment & colors in Markdown export via nested HTML tags
- Customizable context menu (see above)

## How to use

1. Run **Create vtable** from the command palette (`Ctrl/Cmd+P`), or convert an existing Markdown/HTML table with **Convert to vtable**
2. Click any cell to edit; press Enter for a new line inside the cell
3. Everything is stored in the ```vtable code block as JSON — your notes stay portable

## Installation

### From BRAT (recommended while in beta)

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
