# SVG output: analysis and plan

Date: 2026-09-13
Companion to [design.md](design.md) and [implementation-plan.md](implementation-plan.md). This document replaces Sections 17, 18 and 19 of the implementation plan: the display list stays, the SVG writer becomes an output of this package instead of a package of its own, and the PDF writer is dropped from the plan. Section 20, receipt markup, is not touched by it. The working method, the code style and the rules at the top of the implementation plan apply to every section below.

The first part is the analysis: what the painter does today, where it can be cut, what has changed since Section 17 was written, and what it means to keep the SVG writer inside the package. The second part is the plan, in four sections that run through the usual orchestration.

<br>

## Part 1: Analysis

### What the painter does today

`src/painter.js` is 2098 lines and does three jobs at once, in one class, on one state:

1. **Layout.** The state of the printer and the geometry of the paper: the style, the font, the alignment, the character spacing, the tab stops, the margins, the line that is being composed with its cursor and its cells, wrapping, the commit of a line at the larger of its tallest cell and the line spacing, the position on the paper and the reverse feed that moves it back, the print areas, the directions and the positions of page mode, the kept images and the downloaded glyphs, which are the memory of the printer, and the cut and pulse items that wait for a page. Nothing here needs a dot: a cell is as wide as the profile says times the width multiplier, a barcode is as wide as its bars times the module width, a QR code is its module count times the module size, a line is as tall as its tallest cell. The only thing the layout knows about a glyph is its cell.
2. **Rasterization.** The dots: `#cell()` and `#glyphCell()` draw cells from the packed font through `Font.renderGlyph()` with the cache, `#textBitmap()` draws the human readable text of a barcode, `barcode()`, `qrcode()` and `pdf417()` fill their bars and modules into bitmaps, `#commit()` blits the cells of a line into a line bitmap, `#turn()` rotates that bitmap for upside down printing, `block()` blits a block into a line, and page mode composes a canvas per print area, rotates it by the direction and blits it into the page bitmap in `#compose()`.
3. **Output.** The row buffer that grows as lines are committed, the blank runs, the overprint flag and the rescan, `maxHeight`, `feedThreshold`, the `commands` filter, the flush on a supported command and the image items that come out of `#emit()`.

The parsers see one interface of about forty methods, listed in the contracts of the implementation plan and extended by Sections 12 to 16e. They never see a bitmap the painter made; they hand it bitmaps, strings, requests and items.

### Where the seam is

The seam between job 1 and jobs 2 and 3 is clean everywhere but in one place. Every decision the layout takes is taken on sizes, and every size comes from the profile, the style, the request or the symbol, so a layout engine can be written that has no font at all and emits *what* goes *where*: a code point in a font at a scale and a style at a position, a rectangle, a bitmap. Job 2 then becomes one function, "draw this operation into this bitmap", and job 3 stays what it is.

The one place the seam leaks is `printPage()`: a page that was given no print area is as tall as its dots, which `#inked()` measures on the composed page bitmap. That is a layout decision taken on ink, and a font free engine cannot take it. Section 1 of the plan resolves it before the split, so that the split itself changes no output.

Two things look like they need the font and do not. The stretch of the box drawing characters to the edges of their cell is decided by the code point, `Font.isBoxDrawing()`, so the back-end decides it from the operation. The downloaded glyphs of `ESC &` and `FS 2` are bitmaps the stream defined; they are data that passes through the engine into the operation, and the back-end draws them the way `#glyphCell()` does today.

### What changed since Section 17 was written

Section 17 was written at commit `20c40dd`, before Sections 16c, 16d and 16e. Its display list describes the painter of Section 16 and misses five things that the painter does now:

| Change | Section | Consequence for the display list |
|---|---|---|
| Reverse feed and overprinting | 16c | The `y` of a later line can be smaller than the `y` of an earlier one, and a later line adds its dots to the rows of an earlier one. The ordering rule of Section 17, "`y` never decreases", is wrong; the list is in stream order, which is draw order, and `y` is where the paper was. |
| Page mode with print areas and four print directions | 16d | A page is composed in a coordinate system per area and direction, turned when it goes into the page, clipped by the area, and reaches the paper as one block. The flat list of Section 17 has no way to say that. |
| Downloaded glyphs, single byte and multibyte | 16e | A text cell can be a bitmap the stream defined, in a cell of one or two characters, styled, scaled and rotated like a built in one. Section 17's text operation carries a code point only. |
| The rotation of `ESC V` | 16e | Every cell of a line is turned a quarter turn clockwise and the turned cells run left to right, with no underline and no upperline. Section 17 has only the upside down rotation of a whole line. |
| The `star-graphics` language and Star raster mode as a block on the paper | 16e, 12 | Blocks placed with `margins: false` carry their own position on the paper. Section 17's `image` operation covers this without a change; it is listed so the tests cover it. |

Two colour printing changes nothing: the renderer draws one bit and so does the display list.

### Two ways to split, and which one to take

**Per operation.** The engine emits atomic operations with absolute coordinates on the paper, and the bitmap back-end draws each one into the row buffer as it arrives. This is what Section 17 describes. It is the smaller interface, and it is the riskier refactor: the blank row tracking, which today happens per appended line, would have to be redone per row after a line is complete; the clipping of a cell at the edge of the print area, which today the line bitmap does, would have to be reproduced per operation; and page mode would have to be rebuilt from scratch on the paper buffer. Every one of those is a place where a dot can move, and the acceptance of the section is that no dot moves in 31 plus 31 plus the raw and 123 external fixtures.

**Per line.** The engine emits *line boxes*: a line with its `y`, its height, its rotation and the operations inside it in the coordinates of the line. The bitmap back-end composes a line bitmap per line box exactly as `#commit()` and `block()` compose one today, one blit per cell, one fill per rectangle, one blit per image, turns it by the line's rotation exactly as `#turn()` does, and hands it to the unchanged `#append()`, `#appendBlank()`, `#flush()` and `#emit()`. A page is one entry with its areas, and the back-end composes the areas on canvases and rotates them exactly as `#compose()` does. The new code in the back-end is the one function that draws an operation into a bitmap; everything else moves. Byte identity then follows from what the blit is: it combines with OR, so drawing a cell into a line bitmap and blitting the line onto the paper gives the same dots as blitting the cell at the sum of the offsets, and the clipping is the same because the line bitmap has the width of the surface as it has today.

The plan takes the per line split. The display list is hierarchical because of it: a list of entries, of which a line holds operations and a page holds areas that hold entries. That is also what the SVG writer wants, one `<g>` per line and one clipped and rotated `<g>` per print area, and what a PDF writer would want if one is ever written, a line box to break a page between.

### One rotation model

Rotation enters the painter from four commands: `ESC V` turns every cell a quarter turn clockwise and lays the turned cells out left to right; `ESC {` turns every committed line box by 180 degrees; the print direction of page mode turns a whole print area by 0, 90, 180 or 270 degrees; and `ESC V` and `ESC {` are ignored in page mode. In the display list these become two things, and only two. A line entry carries `rotation`, 0 or 180, and its operations are in the unturned frame of the line, so a consumer turns the whole line. A text operation carries `rotation`, 0 or 90, for `ESC V`: the cell is drawn in its own unturned frame of `cell.width * scale.x` by `cell.height * scale.y` and turned a quarter turn clockwise about its top left corner, so that its turned box is the box the operation carries. The area of a page carries its `direction`, and the consumer turns the area. Nothing composes angles, and every turn is about a corner, so no coordinate is ever a half dot: the turned frame of an operation is placed with a translation and a rotation, written out for every case in Section 4.

The bitmap back-end does today's `Bitmap.rotate270()` on the turned cell, today's `Bitmap.rotate180()` on the line bitmap and today's `PAGE_ROTATIONS` on the area canvas, which is why this model costs it nothing.

### SVG inside the package

Keeping the writer in this repository instead of a package of its own settles the two open decisions of Sections 17 and 18 at once and changes the shape of the work:

- **The outlines are bundled with the writer and never published on their own.** `generated/outlines.js` is imported by the SVG entry alone. There is no peer dependency, no second copy in a second repository, and no `@point-of-sale/receipt-printer-renderer/outlines` entry.
- **The writer is a sub-entry, not part of the main entry.** A driver that renders images for a TSP100 must not carry 40 kB gzipped of glyph outlines, so the package gets a second entry, `@point-of-sale/receipt-printer-renderer/svg`, with builds of its own: `dist/receipt-printer-renderer-svg.mjs`, `.cjs`, `.esm.js`, `.umd.js` and `.d.ts`, an `exports` map with `./svg` next to `.`, and a second input in `tsconfig.json`. The UMD build of the sub-entry exposes `ReceiptPrinterRendererSvg`, an object with `toSvg`, for a page that loads the renderer and the writer from two script tags.
- **The display list is a public output of the renderer, still.** The writer takes a layout and nothing else, so `renderer.layout(bytes)` is the API between the two, and it stays public and documented because a consumer outside the package, a PDF writer some day, a debugging view, is the reason to have a display list at all. The main entry gains `layout()` on the three renderer classes and `rasterize()` as a named export and a static, and no data.
- **The proof is inside one test suite.** The rasterized check of Section 18, which was optional because it would have lived in another repository against a copy of the fixtures, becomes ordinary: the SVG of every fixture is rasterized with resvg in the test suite and compared with the golden PBM of the same fixture with the agreement measure the contact sheet already has. The contact sheet gains a column for it.
- **What goes away.** The scaffolding of a new package, the peer dependency decision, the outlines packaging decision, the display list version check across packages, the PDF writer, and the `page`, `margin` and `align` options that only a PDF needs. The version field of the display list stays, because it is a documented format.

Three alternatives were considered for the text of the SVG and rejected. Text as `<text>` elements with the subset TTF embedded as a font: the 212 kB subset is larger than the outlines, viewers hint and antialias a font each in their own way, and the vertical squeeze the rasterizer applies to a glyph that is taller than its cell cannot be expressed in a font. Text as `<image>` of the bitmap cells: exact and useless, an SVG that is a PNG in disguise. Text as rectangles per dot: the same, and larger. Outlines from the same subset font and the same fitting rule as the bitmaps are the only form that scales and sits on the bitmap it was rasterized from.

### Risks

- **Byte identity over every fixture.** Mitigated by the per line split, by moving the output half of the painter unchanged, and by `test/rasterize.js`, which proves `rasterize(layout(bytes))` equals `render(bytes)` on every fixture under every option combination.
- **The page height rule.** Section 1 changes one rule of Section 16d and some fixtures move by a few rows. Doing it before the split keeps the proof of the split clean; the fixture changes are reviewed on their own.
- **Outlines that do not sit on their bitmaps.** Mitigated by generating both from the same placed contours in one pass of the generator, and by a test that fills the outlines again and compares them with the packed glyphs.
- **The size of the SVG entry.** About 150 kB of outline source and 40 kB gzipped; not in the main bundle, which `test:umd` asserts.
- **The tree.** Section 16f, receiptio, was uncommitted in the working tree at the time of writing; it and 16g are committed since. The sections below start on a clean tree, after 0.3.0 is published.

<br>

## Part 2: The plan

Four sections, in order: the page height rule, the split, the outlines, the writer. Each runs through the working method of the implementation plan: an implementer, a bug-check with fresh eyes, an orchestrator review with fix rounds, then a commit. Nothing is pushed. Version stays 0.3.0 until the last section, which makes it 0.4.0.

Rules for all four:

- The item stream, the renderer options and the image format helpers stay exactly as they are. Section 2 is a refactor with a proof: every `.pbm` and `.items.json` of the repository is byte for byte unchanged by it.
- No new runtime dependency. The SVG entry depends on nothing at run time either.
- Every contract below is written as typedefs in `src/types.js` before the code that uses it, so the bundled declarations are complete.
- Anything checked against another implementation, resvg in Section 4, is a dev dependency of the test suite alone.

### The display list

The contract of Sections 2 and 4, replacing the one of Section 17.

```js
{
  version: 1,
  language: 'esc-pos',
  width: 576,           // the paper in dots
  height: 1412,         // the paper from its first row to its last, the feeds included
  dpi: 203,             // the resolution of the profile, 203 when the profile does not say
  entries: [ ... ],
}
```

Everything is in dots, as integers. The origin of the paper is its top left corner, `x` runs right and `y` runs down. `height` is the height the paper has when `stitch()` joins the items of the same render with feeds expanded; a reverse feed can leave the position above it, the height is the extent.

**Entries**, the top level, in stream order, which is the order a printer prints them and the order a consumer draws them:

| Type | Fields | Meaning |
|---|---|---|
| `line` | `y`, `height`, `rotation`, `operations` | A line box: a text line, or a block on a line of its own. It spans the width of the surface. `rotation` is 0 or 180, the upside down printing of `ESC {` at the moment the line was committed. |
| `page` | `y`, `height`, `areas` | A page of page mode as it reaches the paper, one block of the paper width. |
| `feed` | `y`, `height` | Rows the paper advanced without printing: an empty line, the feed of `ESC J` and `ESC d` beyond the height of the line, a Star raster move. |
| `cut` | `y`, `value` | The paper is cut between row `y - 1` and row `y`. `full` or `partial`. |
| `pulse` | `y`, `device`, `on`, `off` | The drawer opens when the paper is at row `y`. |
| `unknown` | `y`, `data` | A command that was not understood, with a copy of its bytes. |

The `y` of a line or a page is the position of the paper when it was committed. After a reverse feed a later entry has a smaller `y` than an earlier one, and its dots are added to the rows that are already there: a consumer that paints in order paints black over black and is right. A marker stands at the position the paper has when its command arrives, so a cut after the last line stands at the bottom of that line. A cut or a pulse that arrived while a page was being composed stands behind the page, at its bottom, which is where the items of the item stream put it. The gap the line spacing leaves below the cells of a line is part of the line, not a feed.

The list is not filtered by the `commands` option: every cut, pulse, feed and unknown command is in it. `commands` decides what reaches the item stream and nothing else.

**Operations**, inside a line. `x` is from the left edge of the paper, `y` from the top of the line box, both in the unturned frame of the line; margins, alignment, the print area and the character spacing are already applied, `x` is where the ink lands.

| Type | Fields | Meaning |
|---|---|---|
| `text` | `x`, `y`, `width`, `height`, `codepoint` or `bitmap`, `font`, `cell`, `glyph`, `scale`, `style`, `rotation` | One cell of text. |
| `rect` | `x`, `y`, `width`, `height` | A filled black rectangle: a bar of a barcode, a run of adjacent black modules of a QR code, a PDF417 symbol or a DataBar. |
| `image` | `x`, `y`, `width`, `height`, `data` | A 1-bit bitmap in the format of the output contract, one dot on one dot: a strip of a column mode image inside a text line, a raster image, a downloaded or NV image with the scaling of its print command applied, a Star raster mode buffer. `data` is a copy the layout owns, never a view on the stream. |

Text. `codepoint` is the Unicode code point the parser decoded, U+FFFD for a byte the codepage does not map and for the placeholder cells of multibyte text; `bitmap` stands in its place for a glyph the stream downloaded, the dots as `ESC &` or `FS 2` defined them, placed at the top left of an unscaled cell of the size of `cell` and clipped by it, exactly as `#glyphCell()` places them. `font` is `A` or `B`. `cell` is the unscaled cell of this operation, `{width: 12, height: 24}` for font A, `{width: 9, height: 17}` or `{width: 9, height: 24}` for font B, and twice as wide for a downloaded multibyte glyph. `glyph` is the unscaled glyph box of the font, `{width: 12, height: 24}` or `{width: 8, height: 16}`, which sits in the cell at `floor((cell.width - glyph.width) / 2)` horizontally and on the baseline vertically, `baseline` of the operation minus the baseline of the font, which is 6 in the 9 by 24 font B cell of a Star and 0 in the 9 by 17 one of an Epson: the placing of `renderGlyph()`. `scale` is `{x, y}`, 1 to 8. `width` and `height` are the box of the operation on the line: the scaled cell, or the scaled cell with its sides swapped when `rotation` is 90. `style` is `{bold, underline, upperline, invert}`: `bold` is the glyph a second time one glyph dot to the right, which is `scale.x` paper dots, before the underline and the inversion; `underline` and `upperline` are 0, 1 or 2, the thickness in paper dots of a line along the bottom or the top of the scaled cell over its whole width, never scaled; `invert` is the cell black and the glyph white; a cell that is inverted or turned is not underlined and not upperlined, the rule of `renderGlyph()`. The code points U+2500 to U+259F are stretched to the edges of the cell, as the bitmap font stretches them. `rotation` is 0 or 90: the rotation of `ESC V`, a quarter turn clockwise of the unturned scaled cell about its top left corner, then placed so that the turned box is `x`, `y`, `width`, `height`. Every text operation carries its whole style; there are no state changes in the list.

**Pages.** `areas` is a list of print areas in the order the stream composed them; an area the stream set twice is in the list twice. An area is `{x, y, width, height, direction, entries}`: `x` and `y` from the top left corner of the page, which is row `y` of the paper; `direction` 0 to 3 as `pageDirection()` defines it; `entries` a list of `line` and `feed` entries in the logical frame of the direction, whose surface is `width` by `height` for directions 0 and 2 and `height` by `width` for 1 and 3. A consumer draws the entries of an area on that logical surface, clips them to it, and turns the surface into the area: for direction 0 a logical point `(u, v)` is the area's `(u, v)`; for 1 it is `(v, height - u)`; for 2 it is `(width - u, height - v)`; for 3 it is `(width - v, u)`. The lines of an area carry `rotation` 0 always, and their text operations carry `rotation` 0, because `ESC {` and `ESC V` are standard mode commands. The height of a page is the rule of Section 1.

**Versioning.** `version` is 1. A field or a type that is added does not change it and a consumer ignores what it does not know; a change in the meaning of an existing field does. `toSvg()` throws on a version it does not know. `documentation/display-list.md` is the reference page.

**Types**, in `src/types.js`: `Layout`, `LayoutEntry`, `LineEntry`, `PageEntry`, `PageArea`, `FeedEntry`, `CutEntry`, `PulseEntry`, `UnknownEntry`, `LineOperation`, `TextOperation`, `RectOperation`, `ImageOperation`, `TextStyle`, `RasterizeOptions`, and in the SVG entry `SvgOptions`.

<br>

### Section 1: the page height rule

A page of page mode that was given no print area is as tall as its dots, Section 16d's rule, measured by `#inked()` on the composed page bitmap. A layout engine without a font cannot measure ink, and a display list whose consumers each measure their own would disagree with the item stream by a few rows. This section replaces the rule in the painter as it is today, so that the fixtures that move do so under a change of their own and the refactor of Section 2 moves none.

The new rule: **a page is as tall as the print areas the stream set on it, and a page that was given none is as tall as the boxes of what was laid out in it**, the line boxes and the feeds of every area mapped into the page by their direction, the bottom of the lowest one. A page with neither an area nor a box prints nothing at all, so the encoder's Star flush, `ESC GS P 0 ESC GS P 1` with nothing between, stays nothing, and every Star fixture that carries it stays byte identical. A trailing blank line in a page now feeds its rows as it does in standard mode, which is the argument for the rule beyond convenience: the printer feeds what it laid out, not where its ink ends.

Deliverables:

- The rule in `printPage()`, in place of `#inked()`, with the page's extent tracked as lines and feeds are appended to an area, in the logical frame, and mapped by the direction when the page is composed.
- The fixtures that change, regenerated, each reviewed by eye against the previous image, with the list and the number of rows of every change in the notes. Expected: the page mode fixtures of the raw directories without a print area; nothing in the external suite, which the implementer confirms by running it.
- The rule in `design.md` under Page mode, in the deviation list of the reference pages where Section 16d put its predecessor, and in the notes of Section 16d as superseded.

Acceptance:

- `npm test` passes. Every fixture that changed is listed with its reason and no fixture outside the list changed.
- The Star flush still prints nothing: every `star-prnt` fixture and every Star fixture of the external suite is byte identical.

Effort: half a day.

<br>

### Section 2: the layout engine and the bitmap back-end

The split. `src/layout.js` is the engine: every public method of the painter's interface, every piece of printer state it keeps today, the kept images and the downloaded glyphs included, and none of the dots. It knows the cell sizes of the profile and the geometry of the symbols and nothing about glyphs; it composes line boxes and emits them to a sink as they are committed, so a line is final when it leaves the engine and `write()` and `end()` stay possible without a redesign. `src/backends/bitmap.js` is the bitmap back-end, the rasterizing and the output half of today's painter: the cells drawn from the packed font with the cache, the row buffer, the blank runs, the overprint rescan, `maxHeight`, `feedThreshold`, the `commands` filter, the flush on a supported command and the items. `src/painter.js` becomes the wiring of the two, so that the parsers and `test/painter.js` keep their imports, and `test/painter.js` gains the tests of the sink and loses nothing.

The sink is internal:

```js
sink.line(entry)       // a committed line box with its operations
sink.page(entry)       // a printed page with its areas
sink.feed(entry)       // rows advanced without printing
sink.command(entry)    // cut, pulse or unknown, with its y
sink.end() → any       // the result of the sink; the items for the bitmap back-end
sink.discard()
```

The engine keeps the memory of the printer across streams, so the sink is attached per stream: `render()` attaches a bitmap back-end constructed from the renderer's options and `layout()` attaches a collector that returns the display list, on the same engine, with the same kept images.

The bitmap back-end composes per line: a line bitmap of the surface width and the line's height, the operations drawn into it in order, text through `Font.renderGlyph()` with the same cache key as today and `Bitmap.rotate270()` for a turned cell, a rectangle filled, an image blitted, the line turned by 180 degrees when the entry says so, then appended to the row buffer with today's code. A page is composed per area: a canvas of the logical size, the area's entries drawn on it, the canvas turned by the direction and blitted into a page bitmap, the page blitted onto the paper, today's `#compose()` and `printPage()` with entries instead of cells. `rasterize(layout, options)` constructs a back-end with `commands`, `maxHeight` and `feedThreshold`, feeds it the entries of a finished list and returns `end()`, which is how the tests prove the two paths equal.

The public API:

```js
renderer.render(bytes) → RenderItem[]              // unchanged, the engine streaming into the bitmap back-end
renderer.layout(bytes) → Layout                    // on ReceiptPrinterRenderer, EscPosRenderer and StarPrntRenderer
rasterize(layout, options) → RenderItem[]          // named export and static; options: commands, maxHeight, feedThreshold
```

The `font` option of the renderer, an application's own packed font, is a back-end option and reaches the bitmap back-end alone; the engine has no use for it.

Deliverables:

- `src/layout.js`, `src/backends/bitmap.js`, `src/backends/collector.js`, `src/painter.js` reduced to the wiring, the typedefs of the display list in `src/types.js`, `layout()` on the three classes, `rasterize()` as a named export and a static.
- `test/layout.js`: for every fixture of both languages, the raw directories and the external suite, the list has the `width`, `language` and `dpi` of its renderer, every entry lies inside the paper horizontally, `height` equals the height of the stitched paper of `render()`, and the markers are the items of `items.json` at the rows the paper has them. For the `text`, `styles`, `sizes`, `fonts`, `alignment`, `wrap`, `hri`, `box` and `table` fixtures of ESC/POS and the `upside-down`, `rotation`, `user-defined`, `margins`, `tabs`, `spacing`, `positions` and the four page mode fixtures of the ESC/POS raw directory, the entries and operations are checked for their `x`, `y`, `font`, `cell`, `scale`, `style` and `rotation` against numbers written out in the test. For the barcode, QR code, PDF417, DataBar and image fixtures the rectangles and images, drawn into a bitmap by the test itself, equal the bitmaps the symbologies and the parsers produce.
- `test/rasterize.js`: for every fixture of every directory, `rasterize(renderer.layout(bytes), options)` deep equals a fresh `renderer.render(bytes)`, items and image bytes, for the default options, for all four commands with `feedThreshold` 8, and for `maxHeight` 100.
- Golden layouts for `receipt`, `hri` and `image-raster` of ESC/POS and `page-mode-directions` and `star-graphics` of the Star raw directory, as `<name>.layout.json` next to the fixture with image data in base64, made by `test/tools/make-fixtures.js`, to freeze the format.
- `documentation/display-list.md`, the reference page, with the tables above and one worked example, a line of the `receipt` fixture with its operations. A section in `usage.md`. The architecture and the file tree of `design.md`: the painter line becomes engine, back-ends and sink, and the display list gets a section next to the output contract. The TypeScript smoke test extended with `layout()`, `Layout` and `rasterize()`.

Acceptance:

- Every `.pbm` and `.items.json` of the repository is byte for byte unchanged, and `npm test`, `npm run build`, `npm run test:types` and `npm run test:umd` pass.
- `render()` and `rasterize(layout())` agree on every fixture under every option combination the test lists.
- The parity test and the external fixtures are untouched.
- The minified UMD bundle grows by no more than a few kilobytes.
- The bug-check reads the display list of the `receipt` fixture by hand against its paper: every line, cell, bar and marker where the paper has it, and the same for one direction of `page-mode-directions`.
- Version stays 0.3.0.

Effort: four to five days.

<br>

### Section 3: the outlines

`tools/generate.js` also writes `generated/outlines.js`: for every code point of `tools/codepoints.js` the outline of its glyph as SVG path data, from the same subset font, the same metrics and the same per glyph vertical squeeze as the bitmaps, so that an outline sits exactly over the bitmap it was rasterized from. The rasterizer is refactored so that `glyph()` returns the placed contours it fills, and the outline and the bitmap of a glyph are made from that one set of contours in one pass; the fill is the only thing the two do differently. The quadratic curves of the face are kept as `Q` commands rather than flattened, which is smaller and smoother. Coordinates are tenths of a dot, integers, in the frame of the cell, `y` down, so a path is placed with a `scale(.1)`.

There is one set, in the 12 by 24 cell of font A. Font B is fitted by its own metrics in its 8 by 16 cell, with a scale of exactly two thirds horizontally and a vertical scale that is two thirds too unless the vertical cap or the per glyph squeeze of the two cells differ, which the 0.2 dot allowance of `metrics()` can make them do. The generator checks it per glyph: a glyph whose font B contours are the font A contours scaled by two thirds, to within a hundredth of a dot, has no entry of its own; a glyph that differs gets one in `glyphsB`, and the notes of the section say how many there are. The writer then draws font B as the font A path under `scale(2/3)` and takes the `glyphsB` entry where there is one.

The box drawing and block characters, U+2500 to U+259F, are not in the face; `tools/box-drawing.js` draws them on the dot grid. The generator turns their bitmaps into rectangles with one helper, `src/svg/trace.js`, that merges the runs of black dots of a bitmap into as few rectangles as a row by row merge gives, and emits them per cell size, 12 by 24, 9 by 17 and 9 by 24, as path data in whole dots. The same helper draws the downloaded glyphs of a text operation with a `bitmap` in Section 4, so it lives in the SVG entry and the generator imports it from there.

The format:

```js
{
  version: 1,
  cell: {width: 12, height: 24},
  baseline: 18,
  units: 10,                                     // path units per dot
  glyphs: {65: 'M32 180L10 180 48 4...Z', ...}, // font A, by code point
  glyphsB: {...},                                // font B, only the glyphs whose fit is not two thirds of font A
  box: {'12x24': {9472: 'M0 11h12v2h-12Z', ...}, '9x17': {...}, '9x24': {...}},   // in whole dots
  fallback: 65533,
}
```

Deliverables:

- The refactor of `tools/rasterize.js`, the outline writer in `tools/generate.js`, `src/svg/trace.js` and `generated/outlines.js`.
- `test/outlines.js`: every code point of the codepoints list has an outline, the box set covers all 75 code points of the range that the codepoints list holds, for the three cells, every path parses with a small parser in the test, and for every glyph of both fonts the outline filled again by the test, with the `flatten()` of the rasterizer and its 8 by 8 samples and 0.45 rule, gives the packed glyph to within sixteen dots, with the exact count per glyph checked and the totals printed by the test and recorded in the notes. The rectangles of every box glyph filled give its bitmap exactly, and the number of glyphs whose outline paints outside its cell is reported and pinned. *Amended 2026-09-13: the bound was two dots, which tenths of a dot cannot carry and which the Decisions list gives up for the hand tweaked bitmap font; the refill is a report of the drift and the bound catches a glyph that moved.*
- The packed font format note in `tools/generate.js` extended with the outline format, and the Bitmap font section of `design.md` with a paragraph on the outlines.

Acceptance:

- `npm run generate` writes `generated/fonts.js` byte for byte as before and `generated/outlines.js` next to it; `npm test` passes; `generated/outlines.js` is not imported by anything in `src/` yet, and `npm run build` shows the main bundles unchanged in size.
- Every glyph is inside the sixteen dot bound, the box rectangles are exact, and the notes carry the totals, the tail of the drift and the glyphs that paint outside their cell. *Amended 2026-09-13, as the deliverable above.*
- Version stays 0.3.0.

Effort: one to two days.

<br>

### Section 4: the SVG writer

The sub-entry. `src/svg.js` is its entry and exports `toSvg()` as a named export and as the default; `src/svg/writer.js` writes the document, `src/svg/png.js` writes the PNG of an image operation with stored deflate blocks, so that the writer needs no `CompressionStream` and stays synchronous, and `src/svg/trace.js` is the tracer of Section 3. The chunk assembly and the CRC of `src/formats/png.js` are shared with it, so `toPng()` and the writer produce the same file up to the deflate stream.

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

const renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576, codepageMapping: 'epson' });
const svg = toSvg(renderer.layout(bytes), {
  units: 'dots',        // 'dots', 'mm', 'pt' or 'px' for the width and height attributes; the viewBox is always dots
  cutMarker: false,     // a dashed line at every cut
  background: '#fff',   // or null for transparent paper
  ink: '#000',
});
```

`toSvg()` returns a string. The document is `<svg xmlns="http://www.w3.org/2000/svg" width height viewBox="0 0 W H">` with `W` and `H` from the layout, a background rectangle unless `background` is null, a `<defs>` with one `<path id>` per distinct glyph the receipt uses, `a41` for font A U+0041, `b41` for a font B glyph with an entry of its own, `x2500-9x17` for a box glyph per cell, each with `transform="scale(.1)"` where its units are tenths, and then one `<g>` per line entry and one per page entry, in order:

- A line is `<g transform="translate(0 y)">`, or `translate(W y+h) rotate(180)` for a rotation of 180, holding its operations in order, clipped to the width of the paper: an operation may run past the right edge of its surface, a barcode whose human readable text is wider than the paper for instance, and the line bitmap of the renderer clips it, so the document clips it too. One `clipPath` of `0 0 W H` in the `<defs>` serves every line of the document. The rectangles of a line are one `<path d="M x y h w v h h -w z ...">` with `shape-rendering="crispEdges"`, so that a bar on integer coordinates stays a bar at every zoom and a QR code costs a few kilobytes.
- A text cell is `<use href="#a41" transform="translate(gx gy) scale(sx sy)">`, with `gx` and `gy` the position of the scaled glyph box in the scaled cell; font B without an entry of its own is the same reference under `scale(2sx/3 2sy/3)`; a box glyph references its cell's path under `scale(sx sy)` at the cell's corner, and a cell of a profile the outlines have no box set for, an application's own cell size, is traced at write time with `trace()` on the cell the bitmap font renders with `stretch: true`, cached per cell and code point. Every `<use>` of a glyph is clipped to its scaled cell, the bold one included, because a path is not clipped and the bitmap of a cell is: 93 glyphs of the face paint outside the 12 by 24 cell and five lie wholly outside it, see the notes of Section 3, so an unclipped `<use>` puts ink where the printer has none. Bold is a second `<use>` `sx` dots to the right, inside the same clip, so a glyph whose ink reaches the right edge of its cell is cut there in bold as it is on the paper. An underline or upperline is a `<rect>` of its thickness across the scaled cell, and neither is drawn when the cell is inverted or turned by 90 degrees: the operation still carries the thickness the style had, the rule that a printer draws no line under a reverse or a rotated character is the writer's to apply, as it is the bitmap back-end's. An inverted cell is a `<rect>` of the cell in the ink colour and the glyph in the background colour, white when `background` is null; the notes say that white paint over earlier ink, an inverted cell a reverse feed put on top of a printed line, differs from the paper, where ink only ever adds. A cell with `rotation` 90 wraps its elements in `<g transform="translate(x+h0 y) rotate(90)">` with `h0` the height of the unturned scaled cell, so the unturned cell's `(u, v)` lands on `(x + h0 - v, y + u)`. A downloaded glyph is the path `trace()` makes of its bitmap, inline, under the same scale, bold, lines and inversion.
- An image is `<image x y width height href="data:image/png;base64,..." image-rendering="pixelated">`.
- A page is `<g transform="translate(0 y)">` holding one `<g>` per area with `clip-path` of the intersection of the area and the page, since an area can be taller than the page it is on, and the transform of its direction: direction 0 `translate(ax ay)`, 1 `translate(ax ay+ah) rotate(-90)`, 2 `translate(ax+aw ay+ah) rotate(180)`, 3 `translate(ax+aw ay) rotate(90)`, and inside it the lines of the area as above.
- A cut is a dashed `<line>` across the paper when `cutMarker` is on, nothing otherwise. `pulse`, `feed` and `unknown` produce nothing.

The build: a second input for rollup with the four outputs named above and a second declaration bundle, `src/svg.js` added to the `include` of `tsconfig.json`, `./svg` in the `exports` map with the same `browser`, `import`, `require` and `types` conditions as the main entry, and `test:umd` extended to load both bundles in one context and assert that the SVG global is an object with `toSvg`, that `toSvg` renders the layout the main global made, and that the main bundle does not contain the outlines.

Deliverables:

- The entry, the writer, the stored deflate PNG writer with a test that `node:zlib` inflates its output to the rows of the bitmap, the shared chunk assembly, the build, the `exports` map, the typedefs.
- Golden SVG files for the `receipt`, `styles`, `sizes`, `fonts`, `box`, `hri`, `code128`, `qrcode`, `pdf417`, `image-raster` and `cut` fixtures of ESC/POS, `receipt` of StarPRNT, and `rotation`, `user-defined`, `page-mode-directions` and `star-graphics` of the raw directories, as `<name>.svg` next to the fixture, made by `test/tools/make-fixtures.js` and reviewed by eye in a browser next to the bitmap preview before they are frozen.
- `test/svg.js`: every golden file equals the writer's output; every document is well formed, checked with a small XML parser in the test; a layout with an unknown version throws; the counts of `<use>`, `<path>` and `<image>` elements of a hand built layout match its operations; the bold, underline, upperline, invert, rotation 90, line rotation 180, font B and downloaded glyph cases are checked element by element; the four direction transforms of a hand built page are checked against the mapping of the display list contract.
- The rasterized check in `test/svg.js`: every fixture of the golden directories and the raw directories rendered by `@resvg/resvg-wasm`, a dev dependency, at one dot per unit, thresholded at half, and compared with the golden PBM of the fixture. The regions the layout's rectangles and images cover agree dot for dot; the whole paper agrees to at least 0.98 by the measure of `tools/contact-sheet/references/shared.js`, with the number per fixture in the notes, since an outline filled by resvg and a bitmap made with the 0.45 rule differ at the edges of a stroke.
- `tools/contact-sheet/references/svg.js`: a reference column that renders the SVG of every external fixture through resvg, so the contact sheet shows the vector output next to the bitmap with the agreement number, and the eye review of Section 16 extends to it.
- Documentation: `usage.md` gets an "SVG output" section with the example above and the options; `design.md` gets the sub-entry in the architecture, the file tree and the image format helpers table, and the SVG section of this document condensed into it; `README.md` names the SVG output in its list of what comes out of the renderer; `documentation/display-list.md` says which version the writer accepts.
- The notes: the size of the SVG of the `receipt` fixture with its glyph definitions and of a text only fixture, the size of every build of the sub-entry, the agreement numbers, and what the eye review found.

Acceptance:

- Every golden SVG opens in a browser and reads as the receipt the bitmap preview shows, checked by the implementer with a headless browser screenshot and by the reviewer.
- The SVG of the `receipt` fixture is under 60 kB and a text only fixture is under 20 kB.
- The rasterized check passes for every fixture with the numbers recorded.
- `npm test`, `npm run build`, `npm run test:types` and `npm run test:umd` pass; the main UMD bundle is within a few kilobytes of Section 2's and holds no outlines.
- The playground's `renderer` branch can show the SVG in a tab with the three lines of the example, tried by hand and noted; the tab itself is playground work and not part of this section.
- Version 0.4.0.

Effort: three to four days.

<br>

### Decisions

Taken in this document, in place of the open decisions of Sections 17 and 18:

- The SVG writer is a sub-entry of this package, `@point-of-sale/receipt-printer-renderer/svg`, and the outlines are bundled into it and not published on their own.
- The display list is hierarchical, entries with lines that hold operations and pages that hold areas, and the split is per line.
- The `line` entry stays; it is the unit of both back-ends.
- The method is `layout()` and the type `Layout`; the documentation calls the format the display list.
- Path precision is tenths of a dot for the outlines and whole dots for the box glyphs and the traced bitmaps.
- No `character` field; `String.fromCodePoint()` is one call away.
- Every line is a group in the SVG.
- `units` defaults to `dots`, like every other output of this package; `mm` is one option away.
- The PDF writer is not planned. The display list carries what it would need, a line box to break between and a page block to keep whole.
- The page height rule: a page without a print area is as tall as its boxes, Section 1 as written, with the fixtures that move reviewed under their own commit. Decided 2026-09-13.
- The vector text is Iosevka, always. The SVG writer draws the outlines of the subset face for every text operation, whatever font rasterized the bitmap: the `font` option of the renderer is a bitmap back-end option and the layout does not carry a font. The bitmap font is going to be based on Iosevka but tweaked by hand for consistent stroke widths on the dot grid, so the outlines and the bitmaps will drift apart on purpose. Section 3's check that an outline filled again gives its packed glyph within two dots holds while the bitmaps are still rasterized from the face; once a tweaked bitmap font lands it becomes a report of the drift, not a gate. Decided 2026-09-13.
- The text operation carries `baseline`, the row of the cell baseline in unscaled dots, since the baseline correction of 2026-09-13 (commit 8e9f438): a glyph sits on the cell's baseline at three quarters of the cell height, not centred, and the sentence about `floor((cell - glyph) / 2)` on both axes applies to the horizontal axis only. Decided 2026-09-13.

<br>

## Notes per section

Filled in during implementation.

### Section 1: the page height rule

- **The rule as implemented.** `printPage()` is `Math.max(page.bottom, page.extent)`, where `page.bottom` is the bottom of the lowest print area the stream set, 0 for a page that was given none, and `page.extent` is the bottom of the lowest box of what was laid out, in the rows of the page. `#inked()` is gone. The extent of the area that is open is tracked in its logical frame as `page.reach`, the bottom of the lowest line box or feed, updated in the two places the position of a page moves over a box, the page branch of `#append()` and the page branch of `#appendBlank()`. It is a maximum ever reached and not the position, because the position moves back: a reverse feed inside a page moves it back, `GS $` and `GS \` set it, and `#settle()` restores it after drawing the characters of a line. `#compose()`, which is where an area goes into the page, maps it: direction 0 gives `area.y + min(reach, area.height)`, the directions 1 and 3 give `area.y + area.height` for any box at all, since they swap the axes and a line box spans the whole width of the logical surface, and direction 2 mirrors rather than swaps, so it gives `area.y + area.height - min(top, area.height)` with `top` the smallest top of any box of the area, tracked next to `reach` in the same two places. `cancelPage()` and a `printPage()` without `keep` reset the two of them, and a `printPage()` without `keep` also puts `page.bottom` back the way `page(true)` sets it, from the print area the printer holds or 0 when it holds none, so that a second print of a page the first one took with it does not feed the areas of the first again. `keep` keeps the mapped extent, so a page printed twice is twice the same height.
- **No fixture moved.** Not one `.pbm` or `.items.json` of the repository changed, neither in the golden directories, which `node test/tools/make-fixtures.js` rewrote, nor in the external suite, which `node tools/external/rerender.js` rewrote: 147 fixtures, 0 changed. Every page mode fixture of the raw directories sets a print area, `page-mode-directions`, `page-mode-coupon`, `page-mode-esc-ff` and `page-mode-cancel` of ESC/POS and `page-mode-directions` of StarPRNT, and a page with an area is as tall as its areas under both rules: the old measure could never exceed the areas, because the page bitmap is built out of the areas. The 24 Star fixtures of the playground carry the encoder's flush, `ESC GS P 0 ESC GS P 1` adjacent with nothing between them, which is a page with neither an area nor a box and still prints nothing. The expectation of the section, that the page mode fixtures without a print area move by a few rows, met no such fixture: there is none.
- **What the rule does change**, checked by rendering the cases by hand before and after the change and looking at the two images: a page without an area holding `In the page`, `Second line` and a trailing blank line is 108 rows under the old rule and 150 under the new one, the page itself 48 against 90: the ink measure cut away the 30 dot blank line and the twelve rows below the ink of the last line, the six dots of its cell below the baseline and the six dot gap of the line spacing; the same page with a trailing `ESC J 40`, twenty dots on the Epson profile, is 48 rows against 80; and one line laid out in direction 3 without an area is 125 rows against 1692, the full default page, which is the consequence of a line box spanning the logical width. A mirrored page is the one case where a box does not reach the bottom: a line that `GS $` put 150 dots down a page of direction 2 without an area lands on the rows 1482 to 1512 and the page is 1512 rows. The dots stand in the same place in every one of them, only the paper below them changed. `page-mode-directions` is identical before and after, 300 rows.
- **Tests.** `test/painter.js` loses the test that measured the ink and gains twelve: the page is as tall as the line box the same line feeds in standard mode, a trailing blank line is fed, a trailing feed makes the page taller, the directions 1, 2 and 3 without an area are the whole page, a mirrored page whose box starts 150 dots down ends 150 dots above the bottom, an area that holds nothing is as tall as itself, two areas that start at the same row are as tall as the lower one, a position alone is not a box, `keep` prints the same height twice without an area, a second `printPage()` without new content prints nothing, a reverse feed adds no extent, and `cancelPage()` throws the boxes away with the dots. `test/esc-pos.js` gains the mirrored page of direction 2, the trailing blank line and the trailing `ESC J` through the parser and now asserts the height of the page without an area rather than cropping to it. `test/star-prnt.js` gains a page without an area of two Star line boxes, 64 dots, next to the flush test that was already there.
- **A position is not a box**, which the plan did not say in so many words and the code now pins with a test: a page that a `GS $` alone moved down, with nothing laid out, prints nothing, because only the two append paths record an extent. The same goes for a reverse feed, which lowers the position and leaves the extent where it was.
- **The `keep` case and the reverse feed** were both checked against the plan's question: positions do move up inside a page, so the extent is the maximum the position ever reached, which is what the two append paths record.

### Section 3: the outlines

Date: 2026-09-13. `tools/rasterize.js` refactored, `generated/outlines.js` written by `tools/generate.js`, `src/svg/trace.js` added, `test/outlines.js` added.

**One set of contours.** `contoursOf()` splits the path of a glyph into contours of `M`, `L`, `Q`, `C` and `Z` commands instead of flattening it on the spot, `place()` moves those commands into the cell with the fitting rule, the advance scaling, the per glyph vertical squeeze and the baseline of the cell, and `contours()` returns them. `glyph()` is now `fill(flatten(contours))` and `pathData()` writes the same contours out; the fill is the only thing the two do differently, as the section asked. A contour that flattens to fewer than three points is dropped where the contours are split, which is where the old `flatten()` dropped it, so both consumers see the same set. `flatten()`, `fill()`, `pathData()`, `SEGMENTS` and the fill constants `INK_THRESHOLD` and `SAMPLES` are exported, and the generator and the test take the fill and its settings from there, so the report cannot drift from what rasterized the bitmaps.

Placing the control points and flattening afterwards is not the same arithmetic as flattening the points and placing them afterwards, which is what the old code did, so byte identity was not a given; it holds. `npm run generate` leaves `generated/fonts.js` byte for byte as it was.

**Tenths of a dot, and the refill is a report.** The precision and the two dot check of the section pull against each other. The bitmaps are filled with a coverage threshold, 0.45 of a dot over 64 samples, so a dot at the edge of a stroke sits on a knife edge and a stem that moves by half a unit takes a handful of dots with it. Measured over the 704 glyphs, filling the path again and counting the dots that differ from the packed glyph:

| units | font A total | font A worst | over two dots | font B total | font B worst | over two dots | path bytes |
|---|---|---|---|---|---|---|---|
| 10 | 553 | 14 | 56 | 221 | 5 | 13 | 319 kB |
| 20 | 193 | 9 | 5 | 122 | 8 | 6 | 357 kB |
| 50 | 121 | 9 | 2 | 43 | 2 | 0 | 382 kB |
| 100 | 19 | 2 | 0 | 9 | 1 | 0 | 416 kB |

The relation is not monotonic, because it is a threshold: only hundredths of a dot clear two dots for both fonts, at 30 per cent more file. The section takes the tenths of the Decisions list and gives up the equality instead, on the decision of the same list that the vector text is Iosevka always: the bitmap font is going to be tweaked by hand on the dot grid and drift from the face on purpose, so an outline that reproduces today's bitmap dot for dot buys an agreement that is going to be given up, and the vector output is judged on the agreement of a whole receipt, which Section 4 measures with resvg. The two dot check of this section therefore becomes what that decision says it becomes, a report of the drift: `test/outlines.js` fills every path again, prints the totals, and asserts a loose bound of sixteen dots, the round number above the worst glyph, which catches a glyph that moved and not a dot that changed its mind at the threshold.

The numbers at tenths, as the file is generated, the quadratic conversion below included: font A 599 dots over 704 glyphs, worst 13, 58 glyphs over two dots; font B 209 dots, worst 4, 10 glyphs over two dots. The worst glyph is 13 dots of the 288 of a 12 by 24 cell.

**Curves.** The face is quadratic, but `tools/subset-font.js` writes the subset through opentype.js, which writes CFF, and CFF has no quadratic curves: every curve of the subset is a cubic whose control points are the two thirds points of the quadratic one, rounded to whole font units. `pathData()` turns those back into `Q`, which is what the section asked for and two numbers shorter each; a curve whose two ends disagree about the control point by more than a tenth of a dot is written out as a `C`, of which this face has none. It is kept: it takes 27 per cent off the file, and it costs 46 dots of font A's 599, the rest being the rounding to tenths.

**Font B: no entries.** `glyphsB` is empty. Font B is fitted into its 8 by 16 cell by its own metrics, and every number of that fit is exactly two thirds of the font A fit: the advance scale is 8/500 against 12/500, the vertical cap is 1 in both cells, the per glyph squeeze is `baseline / -y1` or `(height - baseline) / y2` with 12 and 16 against 18 and 24, and the minimum squeeze is a fraction of a proportional number. The generator compares the placed contours of the two cells coordinate by coordinate, with the font A set scaled by two thirds, and allows a hundredth of a dot, which is a tenth of a path unit; nothing comes near it. The set stays in the format because a cell of another shape, or a face whose metrics round differently, would fill it, and the writer has to look in it either way.

**The dot report.** Every glyph is inside the bound of sixteen dots and the drift is a long tail of single dots. Font A: 424 of the 704 glyphs come back exactly, 119 differ by one dot and 103 by two, which is the rounding of a stem to a tenth of a dot; 58 are over two, and the worst are `℉` 13, `%` and `ⁿ` 12, `¹` 11, `/`, `\` and `₫` 8, `γ` 7. Font B: 563 exact, 85 by one and 46 by two, 10 over two, the worst `Θ` and `‰` at 4. The tail is diagonals and the thin joins of a `%` or a `₫`, where a stem runs at an angle across the dot grid and a whole row of edge dots sits within a sample of the 0.45 threshold; a shift of a twentieth of a dot moves the lot. Nothing moves by enough to be a different glyph, which is what the bound is for. The box drawing characters are exact in all three cells, being rectangles on whole dots.

**A path is not clipped and a bitmap is.** 93 of the 704 glyph outlines paint outside the 12 by 24 cell, 41 of them by more than two dots and 5 of them wholly, which the packed font hides because a cell clips and the refill test cannot see because `fill()` clamps to the cell. It is the face, not the fitting: Iosevka draws its symbols on a full em and the cell is half an em, the advance the font is fitted by, and it gives a combining accent no advance at all and hangs it to the left of the origin.

- **Wholly outside**, at negative x, the combining accents U+0300, U+0301, U+0303, U+0309 and U+0323. Their packed cells are blank, which is why they are the glyphs whose path is not empty while their bitmap is.
- **A full em wide**, 0 to 24 dots in a cell of 12: U+2014 and U+2015, the em dashes, and U+23C9, U+23CA, U+25D8 and U+25D9. Eleven dots over: the arrows U+2190, U+2192 and U+2194. Ten: U+2026, the ellipsis, 1.9 to 22.1 dots.
- **Between six and ten dots over**: U+25B2, U+25BC, U+221E, U+22C2, U+2030, U+2385, U+23F8, U+25A0, U+25AC, U+25BA, U+25C4, U+25CB, U+25CF, U+25E2 to U+25E5, U+263A, U+263B, U+263C, the vertical arrows U+2191, U+2193, U+2195, U+21A8, and the two zero width joiners U+200C and U+200D.
- **Within two dots**, 52 glyphs: the Vietnamese and Greek stacked accent capitals, `Ấ Ầ Ắ Ằ Ế Ề Ố Ồ` at 1.9 dots above the cell and the rest below that, the horned `Ơ ơ Ư ư` a dot to the right, `ŉ`, `ď`, `ĥ`, `√`, `♫`, `♂`.

What follows from it is a rule for Section 4 and a number to watch here. Section 4: every glyph `<use>` is clipped to its scaled cell, the bold overstrike included, or the SVG puts ink where the paper has none; the text of that section says so now. Here: `test/outlines.js` measures the three counts, prints them with the other totals and pins them, so that a regeneration that moves a glyph out of its cell, or a face that does not, shows up as a failing assertion with the new numbers in it.

**The box set.** The 75 code points of U+2500 to U+259F the codepoints list holds, per cell, traced out of `new Font(packed).renderGlyph(font.lookup(cp), {cellWidth, cellHeight, stretch: true})`, the call `src/painter.js` makes, with the 12x24 font for the 12x24 cell and the 8x16 font for the 9x17 and the 9x24 cell. Tracing the rendered cell rather than the glyph inherits both the stretch to the edges and the baseline placement of commit `8e9f438`: an 8 by 16 glyph sits at row 6 of a 9 by 24 cell, not centred, and the rectangles say so. The set is keyed over the whole range the codepoints list holds, whether `tools/box-drawing.js` drew the glyph or the face did, so a consumer needs no second rule. The box drawing code points are therefore not in `glyphs`; a consumer takes `box` for them and `glyphs` for everything else.

**The command set, exactly.** A glyph path is absolute `M`, `L`, `Q`, `C` and `Z`; a `C` stands only where a curve of the face is not a quadratic one to within a tenth of a dot, which this face never is, so what is in the file today is `M`, `L`, `Q` and `Z`. A box path is `M`, `Z` and the relative `h` and `v` of the tracer's rectangles, in whole dots, and nothing else. The format note of the generator, the paragraph of `design.md` and the format block of this section say it that way, and the block's box example is a path out of the file. A glyph may also be the empty string, which the carriage return, the space and the no break space are, so a consumer asks `codepoint in glyphs` and does not test the string.

**Decisions the plan did not take.** Every contour of a path ends in `Z`, and the closing line the face draws back to the first point is left out, since the `Z` draws it; a command that lands where it started once the coordinates are rounded is left out as well. The fallback glyph is U+FFFD of the face and gets its entry under 65533 like any other glyph; the branch that traces the hollow box of a face without U+FFFD is written and unused. A `glyphsB` entry, when there is one, is in the frame of the 8 by 16 cell and in the same units as `glyphs`, so a writer draws it without the two thirds scale. `trace()` takes the units of the path as its second argument, one for the box set, the units of the glyphs for that traced fallback. `pathData()` lives in `tools/rasterize.js`, next to the representation of a contour; the generator only assembles the file.

**Sizes.** `generated/outlines.js` is 344 kB of source, 78 kB gzipped: 319 kB of glyph paths, 453 bytes each over 704 glyphs, and 16 kB of box rectangles over three cells. That is more than the 150 kB and 40 kB of the risk list of this document, which was an estimate made before the face was counted: 704 glyphs of a Medium weight with curves on both sides of every stroke. A receipt does not carry the file, only the glyphs it uses, so Section 4's 60 kB is 80 distinct glyphs at 453 bytes, 36 kB of definitions. If the sub-entry has to be smaller, the encoding has room this section did not take: relative commands, or the `T` of a smooth quadratic, which the face is full of, would take a third off without moving a coordinate. Nothing in `src/` imports the file, so none of it is in the main bundle, whose four builds are byte for byte the ones of the commit before.

**The bitmaps and the outlines could agree exactly.** Not done here, because `generated/fonts.js` has to stay byte for byte as it is, and not wanted any more either: if the rasterizer rounded its placed contours to the units of the path before filling them, the outline would be the thing that was filled and the difference would be zero dots for every glyph at any precision. It is worth a line here because it is one line of code, and because it is the cheap way back to equality if a later section ever wants it; the hand tweaked bitmap font of the Decisions list is going to drift from the face anyway, so this section does not.

<br>

### Section 2: the layout engine and the bitmap back-end

- **The split as implemented.** `src/layout.js` is the engine, 2165 lines: every public method of the painter's interface, the whole state of the printer, the line composition with the ascent and descent layout of commit 8e9f438, the wrapping, the margins, the tabs, the spacing, the positions, the reverse feed, page mode with its areas and directions, the kept images, the downloaded glyphs and the held cut and pulse items. It emits a line box, a page, a feed or a command to a sink as each is committed. `src/backends/bitmap.js` is the rasterizing and output half: `#compose()` draws the operations of a line into a bitmap of the surface width, the text cells through `Font.renderGlyph()` with a cache, the rectangles filled and the images blitted, and `#append()`, `#appendBlank()`, `#markBlank()`, `#rescan()`, `#emit()` and `#flush()` moved unchanged, `maxHeight`, `feedThreshold`, the `commands` filter and the items with them. `src/backends/collector.js` is 202 lines and keeps what it is given. `src/painter.js` is the wiring, one delegating method per method of the interface plus `collect()`, so the two parsers and `test/painter.js` kept their imports and every one of their tests.
- **The sink signature.** `line`, `page`, `feed`, `command`, `end` and `discard`, as the plan wrote them and nothing more. The engine never asks a sink anything: it clamps a reverse feed on a floor of its own, see the next note, so a list is the same whichever sink is attached and `rasterize()` needs nothing but the list.
- **A cut takes the paper away, and the engine says so.** The painter reset its position to 0 at every flush, which did two things at once: a reverse feed could not move back over rows that had left as an image item, and a stream that had moved the paper back before the command printed what followed *below* those rows rather than on them. Both are the printer, not the back-end: paper that has been cut off cannot come back and the head stands at the cut. So the `commands` option reaches the engine as well as the back-end, and `#leave()` does the whole of it: at a command of that set, cut, pulse or unknown, the position moves down to the extent of the paper, the bottom of everything printed so far, and that row becomes the floor a reverse feed clamps at. The marker stands at that row too, which is where the item stream has it. The positions of a list are continuous absolute rows of the paper and no sink decides anything: the bitmap back-end still empties its row buffer at a flush and translates an entry by its own origin, but it exposes nothing to the engine and `rasterize()` works from the list alone. One fixture exercises it, `external/escpos-php/demo`, whose stream reverse feeds 90 dots and then cuts: the list and the paper are 2477 rows, the same 2477 rows the painter printed before the split, and `test/layout.js` needs no exception for it. The list of a stream like that does depend on `commands`, as the paper does: a driver that performs the cut gets one paper, a driver that ignores it gets another, and the test asserts both.
- **Symbols are rectangles.** The plan preferred it and the proof allows it: the bars of a barcode are one rectangle per black bar, `bars[i] * moduleWidth` wide and as tall as the symbol, and the modules of a QR code, a PDF417 symbol and a DataBar are the runs of adjacent black modules of a row, merged into one rectangle each and grown downwards when the same run repeats in the row below. The `receipt` fixture's QR code is 166 rectangles instead of 841 modules. `test/layout.js` draws them into a bitmap and compares that with what `src/symbologies` encodes, for nine one dimensional symbologies, the four DataBars, two QR codes and a PDF417 symbol, and the rasterize proof shows they fill to the same dots as the bitmaps the painter made.
- **The human readable text of a barcode is text operations**, one per character, in the font and the plain style the painter drew `#textBitmap()` with, centred under or above the bars exactly where the bitmap sat. That is what keeps the SVG vector for a barcode with its text.
- **The glyph box and the baseline are the format's, not a font's.** A text operation carries `glyph`, 12 by 24 for font A and 8 by 16 for font B, and `baseline`, three quarters of the height of the cell, which is where both built in fonts stand. The engine has no font and needs none: the baseline of a cell is a function of its height alone. An application that supplies its own packed font with another baseline gets its own glyphs drawn, the bitmap back-end holds the `font` option, but the line is laid out on the baseline of the format. No test and no fixture uses the option.
- **The cells of an area that stayed empty.** An area is in `areas` when something was laid out in it, a line box or a feed, and not otherwise, which is what `#compose()` did with its canvas. A page is still as tall as every area the stream set, that is the rule of Section 1 and it is the engine's.
- **Three smaller decisions where the plan was silent.** The cache key of a cell gains the size of its cell, because a list from another profile can reach the same back-end; a downloaded glyph is cached under a serial number the back-end hands out per bitmap object, since the operation carries dots and not a name; and the scaling of a kept image stays in the engine, `Bitmap.scale()` of the print command, so that the `data` of an image operation is the dots as they land on the paper. The collector copies every bitmap it is given, the images, the downloaded glyphs and the bytes of an unknown command, so the list owns what it holds.
- **The language of a list** is the one the renderer was created for: `EscPosRenderer` says `esc-pos`, `StarPrntRenderer` says the Star language of its options, so a renderer a driver made for a TSP100 reports `star-graphics`. `dpi` is the resolution of the profile, 203 when it does not say.
- **Nothing moved.** Not one `.pbm` or `.items.json` of the repository changed: `node test/tools/make-fixtures.js` rewrote the 101 golden fixtures and `node tools/external/rerender.js` the external suite, 147 fixtures, 0 changed, and `git diff --stat -- test/fixtures` is empty. The five golden display lists are the only new files there.
- **The proof.** `test/rasterize.js` runs `rasterize(renderer.layout(bytes), options)` against a fresh `render(bytes)` for all 248 fixtures of the five directories under three option sets, the defaults, the four commands with `feedThreshold` 8 and `maxHeight` 100: 744 comparisons, items and image bytes, all equal.
- **The size.** The minified UMD bundle is 225,040 bytes against 217,463 before the split, 7,577 bytes more, 71,788 against 69,550 gzipped, 2,238 more. The ESM bundle grows by the same 7.4 kB. The growth is the delegating painter, the collector and the rectangle merging; nothing of the display list is data.
- **What the contract did not say, written down rather than changed.** Three things a consumer has to know and the tables did not say: an area can be larger than the page it is on, since its height is the print area the printer holds and the height of the page is what the stream fed, so a consumer clips every area to its page; an operation can end past the right edge of its surface, the human readable text of a 49 character Code 128 in font A ends at 588 dots on a 576 dot paper, so a consumer clips a line to the width of its surface the way the line bitmap does; and an inverted or turned cell still carries the `underline` and `upperline` of the style while no line is drawn on it, which the tables state as a rule and every consumer has to apply. All three are in `display-list.md` and in the Section 4 text of this document, and none of them changes a field of the list.
- **Two things the tests do not cover**, both unchanged by the split and listed here so that the next section knows: the `font` option of `rasterize()`, which reaches `Font` the same way the renderer option does and has no fixture of its own, and the lifetime of a downloaded glyph, which `reset()` clears, so a glyph a stream defines is gone for the next `render()` while a kept image survives it. The second is the printer, an initialize empties the RAM of a printer and not its NV memory, and `test/painter.js` pins it for the painter; neither has a test through a renderer.
- **Tests.** `test/layout.js` is 1027 tests over every fixture of every directory, the width, the language, the resolution, every operation inside the paper, the height against the stitched paper of a render and the markers against the rows of the item stream, plus the entries and operations of the `text`, `styles`, `sizes`, `fonts`, `alignment`, `wrap`, `box`, `table` and `hri` fixtures and the `upside-down`, `rotation`, `user-defined`, `margins`, `tabs`, `spacing`, `positions` and two page mode fixtures of the raw directory against numbers written out in the test, the symbol checks above, and the five golden lists. `test/rasterize.js` is the proof plus the contract of `rasterize()`. `test/painter.js` gained seven tests of the sink and the cut, and lost none. The TypeScript smoke test walks a list entry by entry and draws it again; `test:umd` lays a stream out through the global and rasterizes it.
- **The UMD check never rendered text, and does now.** `test/umd/check.js` evaluates the bundle in a bare `vm` context with the globals a browser has, and `structuredClone` was not one of them. The codepage encoder calls it in `getEncoding()`, which `getCodepoints()` reaches for every codepage that extends another, cp437 among them, so the call threw a `ReferenceError` that `codepointsOf()` in both parsers swallowed along with the case it is there for, and every byte decoded to U+FFFD: the check compared the shape of the items and the size of the images, never a dot, so a bundle that printed nothing but fallback glyphs passed it. Three things are fixed: `structuredClone` is in the context, the check renders a short receipt through the global and compares it dot for dot with the module build of the same sources, and the catch in `codepointsOf()` is narrowed to the `TypeError` of a codepage the encoder knows as an alias only and rethrows anything else, so a missing global is an error instead of a page of boxes. Without `structuredClone` the check now fails twice over, on the code point of the first cell and on the `ReferenceError` the narrowed catch lets through. It was the same at `d2420c1`, the bug predates the split; nothing of the package changed, only what the check is allowed to miss.

<br>

## Appendix: the Section 18 entry of the implementation plan

Spun out of the implementation plan; to be planned separately, which is what Part 2 above does. The entry below is what stood as Section 18 there before this document was written, kept for what it settled about the document itself: the structure, the glyph reuse, the elements per operation and the receipts the fixtures cover. Where it differs from Part 2, Part 2 wins: the writer is a sub-entry of this package rather than a package of its own, and the outlines come with it.

### The entry as it stood

A separate package in the ecosystem that turns a display list into an SVG document: paths for text from the generated outlines, rectangles for bars and modules, an embedded PNG for every image, one document per receipt at dot size with a `viewBox`, cut markers optional. It consumes the display list of section 17 and nothing else of the renderer, so it has no runtime dependency apart from the outlines.

Contract:

```js
import { toSvg } from '@point-of-sale/receipt-printer-svg';

const svg = toSvg(layout, {
  units: 'dots',        // 'dots', 'mm', 'pt' or 'px' for the width and height attributes; the viewBox is always dots
  cutMarker: false,     // a dashed line at every cut
  background: '#fff',   // or null for a transparent paper
  ink: '#000',
});
```

`toSvg()` is synchronous and returns a string. The document is `<svg xmlns="http://www.w3.org/2000/svg" width height viewBox="0 0 W H">` with `W` and `H` from the layout, a background rectangle unless `background` is null, a `<defs>` with one `<path id="g-A-41">` per distinct glyph the receipt uses, and one `<g>` per `line` operation holding its operations in order:

- A text cell is a `<use href="#g-A-41" transform="translate(x y) scale(sx sy)">`, with a second `<use>` one glyph dot to the right for bold, a `<rect>` of the underline or upperline thickness across the scaled cell, and for an inverted cell a black `<rect>` of the cell first and the glyph in the background colour. Font B uses the same path under a scale of two thirds, translated to the centre of its cell. A rotated cell gets `rotate(180 cx cy)` about the centre of its box. A box drawing code point uses the path of its cell size from the `box` set.
- A `rect` is a `<rect>` with `shape-rendering="crispEdges"`, so that a bar on integer coordinates stays a bar at every zoom.
- An `image` is an `<image x y width height href="data:image/png;base64,...">` with `image-rendering: pixelated`, the PNG written by the package itself with stored deflate blocks, so that the helper needs no `CompressionStream` and stays synchronous. A logo is a few kilobytes larger than compressed, which does not matter in a document that is text.
- A `cut` is a dashed `<line>` across the paper when `cutMarker` is on, nothing otherwise. `pulse`, `feed` and `unknown` produce nothing.

Deliverables:

- The package, `ReceiptPrinterSvg` on GitHub, `@point-of-sale/receipt-printer-svg` on npm, version 1.0.0, scaffolded per the rules of this block, with `toSvg()` as the default and a named export and the options typedef in `src/types.js`.
- The PNG writer with stored blocks and its CRC, and a check in the tests that `node:zlib` inflates its output to the rows of the bitmap.
- `test/tools/make-fixtures.js` of the package: the receipts of this repository are not published, so the script encodes receipts of its own with ReceiptPrinterEncoder and lays them out with ReceiptPrinterRenderer, both dev dependencies, and freezes `test/fixtures/<name>.svg`. The receipts cover text in both fonts and every style, sizes, alignment, a table, a box, a rule, a barcode with its text, a QR code, a PDF417 symbol, an image, an upside down line, a cut and a pulse.
- A README that documents the options, the structure of the document, the glyph reuse and the version of the display list it accepts, and shows the encoder, renderer and this package together in ten lines.

Fixtures and tests:

- The golden SVG files, reviewed by eye in a browser before they are frozen, with a screenshot next to the bitmap preview of the same receipt, as section 5 checked its example.
- `test/svg.js`: every fixture equals its golden file; the document is well formed, checked with a small XML parser that is a dev dependency; a layout with a version the package does not know throws; the counts of `<use>`, `<rect>` and `<image>` elements of a hand built layout match its operations; the bold, underline, invert and rotation cases are checked element by element.
- The rasterized check, if the open decision takes it: every fixture rendered at one dot per unit with a rasterizer and compared with the bitmap of the renderer, the rectangles and images dot for dot and the text within a tolerance, since an outline filled by a rasterizer and a bitmap made with the 0.45 coverage rule differ at the edges of a stroke.

Acceptance:

- Every fixture opens in a browser and reads as the receipt the bitmap preview shows, checked by the implementer with a headless browser screenshot and by the reviewer.
- The SVG of the full receipt is under 60 kB with its glyph definitions, and a receipt of text only is under 20 kB.
- `npm test`, `npm run build` and `npm run test:types` pass, and the UMD build exposes the function as its global.

Effort: 2 to 3 days.

Open decisions:

- **The package name.** `receipt-printer-svg` keeps the `receipt-printer` prefix of the encoder and the renderer; `receipt-svg-renderer` says what it does. The same choice applies to section 19.
- **Where the outlines come from**, the decision of section 17: a peer dependency on the renderer's sub-entry, or a copy inside this package.
- **The rasterized check.** `@resvg/resvg-wasm` renders SVG in Node without a native module and would compare the vector output with the bitmap fixtures; it is a wasm dev dependency of a few megabytes and its tolerance for text has to be settled by trying. Without it the tests are structural only.
- **Physical units.** Whether `units` defaults to `dots`, which gives a document of `576` by `1412` user units, or to `mm`, which gives a paper of the size it is.
- **Per-line groups.** Whether every line becomes a `<g>`, which doubles as documentation of the layout, or the operations are written flat, which is smaller.
