# ReceiptPrinterRenderer design

Date: 2026-09-11
Status: agreed design, nothing implemented yet. Open items settled on 2026-09-11, see [Open questions](#open-questions).

This document describes a new library, ReceiptPrinterRenderer, and the changes to the printer drivers that use it. It records the decisions made while evaluating how to support receipt printers that can only print images.

Contents

- [Goal](#goal)
- [Decisions](#decisions)
- [Scope of version 1](#scope-of-version-1)
- [Architecture](#architecture)
- [Output contract](#output-contract)
- [The display list](#the-display-list)
- [Renderer options](#renderer-options)
- [Supported ESC/POS commands](#supported-escpos-commands)
- [Supported StarPRNT commands](#supported-starprnt-commands)
- [Painter](#painter)
- [Resources](#resources)
- [Image format helpers](#image-format-helpers)
- [Testing](#testing)
- [Driver integration](#driver-integration)
- [WebUSBReceiptPrinter, branch tsp100](#webusbreceiptprinter-branch-tsp100)
- [WebBluetoothReceiptPrinter, branch meow](#webbluetoothreceiptprinter-branch-meow)
- [NetworkReceiptPrinter](#networkreceiptprinter)
- [Roadmap](#roadmap)
- [Open questions](#open-questions)
- [Sources](#sources)

<br>

## Goal

Some receipt printers have no fonts and no barcode engine, they only print images:

- The Star TSP100, TSP100ECO, TSP100GT, TSP100II and TSP100III. Star's SDKs call this Star Graphic mode. The Windows driver, futurePRNT, renders receipts to raster images before sending them, and the futurePRNT virtual serial port emulates ESC/POS and Star Line on top of that. Without the Windows driver, on macOS, ChromeOS and Linux, the printer only accepts raster commands. The TSP100IV is not part of this group, it supports StarPRNT natively.
- The cheap Bluetooth Low Energy "cat" printers sold as Meow printers, model names such as GB01, GB02, GB03, GT01, MX05, MX06 and MX10. They print 384 dots wide and only accept bitmap rows.

Applications use ReceiptPrinterEncoder to create receipts. They should not need to know that a printer cannot print text. ReceiptPrinterRenderer takes the ESC/POS bytes the encoder produces, interprets them the way a printer would, and produces images. The printer drivers wrap the images in whatever the printer understands.

<br>

## Decisions

These alternatives were considered and rejected, so that the reasoning is not lost.

**A raster back-end inside ReceiptPrinterEncoder**, working on the encoder's line format instead of on bytes. Rejected because it needs a refactor of the encoder to defer the encoding of images, barcodes and QR codes, because it only works for receipts created with the encoder, and because it cannot serve as an emulator or preview for arbitrary ESC/POS output. The byte renderer has none of these limitations and costs about the same. The one advantage of the line format, Unicode text without codepages, can be regained later by adding a UTF-8 character mode to the encoder.

**Rendering with Canvas.** Rejected. The whole layout model of the encoder is column based, tables and boxes rely on fixed cells and box drawing characters, and canvas text rendering differs per platform. A fixed-cell bitmap font gives deterministic output in browsers and Node, without a native dependency.

**Pages instead of a stream.** The first idea was to return pages split at cuts. Rejected because the TSP100 supports cut and pulse commands in raster mode, so the output must interleave images of any height with commands, in order.

**A neutral renderer with conversion helpers for drivers.** Rejected in favour of the driver telling the renderer which commands the printer supports. The renderer then applies fixed fallbacks and the driver's output loop only handles the types it asked for.

**The drivers depending on the renderer.** Rejected. The renderer, its font and its symbology code would end up in every bundle that uses the drivers. Instead the application imports both packages and passes the renderer class to the driver. The application can load the renderer lazily, and the drivers declare the renderer as an optional peer dependency.

**Building EscPosRenderer first and StarPrntRenderer later.** Rejected. Both renderers share the painter, and building the two parsers together is the only way to be sure the painter's interface is language neutral instead of shaped after ESC/POS. It also enables the parity test, the same receipt encoded in both languages must render identically. The extra cost is one parser table and one set of fixtures, since the encoder's StarPRNT output is as bounded as its ESC/POS output.

**Which language the TSP100 uses.** The proof of concept renders ESC/POS on the TSP100 and on the cat printers. Later the TSP100 is expected to move to StarPRNT, so that Star printers get the Star codepage mapping and Star behaviour, while the cat printers stay on ESC/POS. Nothing in the drivers depends on this choice: the driver reports the language of whatever renderer it was given.

**One renderer class per language as the only public API.** Reversed on 2026-09-12. There is now a unified `ReceiptPrinterRenderer` that takes the language as an option and delegates, the way `ReceiptPrinterEncoder` takes the language and picks its implementation. An application that encodes with `language: 'star-prnt'` renders with the same string instead of having to know which class belongs to it, a driver constructs the renderer from the language its profile resolved without a table of classes, and the package gets the default export and the UMD global the encoder has. The two renderers stay named exports, because a driver that only ever sees one language can still be handed the class.

**A driver without a renderer throwing on a graphics printer.** Reversed on 2026-09-12. A driver that is given no renderer reports the raw protocol name, `star-graphics` or `meow`, and passes the bytes of `print()` through unchanged, exactly as it did before it could render. Throwing would break every application that already speaks those protocols itself, which is what the cat printer driver required until now, and it makes the renderer a hard requirement for connecting to a printer that an application may only want to talk to directly. An application that wants rendering passes a renderer and gets the language of its printer in the connected event; one that does not gets the protocol name and knows it is on its own. Since [section 16e](implementation-plan.md#section-16e-user-defined-characters-rotation-colour-and-the-star-graphics-language) the renderer speaks `star-graphics` as well, so for the TSP100 family the name in that event is the same either way and only the bytes the application hands the driver differ.

**A separate WebBluetoothMeowPrinter driver for the cat printers.** Rejected. WebBluetoothReceiptPrinter already has the cat printer profile with its service and characteristics, a write queue and chunk pacing. A separate project would duplicate all of that. The existing driver gets the same renderer option as the USB driver, and the cat printer becomes one more profile that renders.

**The driver keeping one small wrapper module per wire format.** Reversed on 2026-09-12. The two wrappers moved out of the drivers into packages of their own, [MeowPrinterEncoder](https://github.com/NielsLeenheer/MeowPrinterEncoder) and [StarGraphicsPrinterEncoder](https://github.com/NielsLeenheer/StarGraphicsPrinterEncoder), and the drivers depend on them. The Star raster wrapper was already living in two repositories at once, WebUSBReceiptPrinter and NetworkReceiptPrinter, as a file with a notice at the top saying that the two copies must be kept identical, and CapacitorBluetoothReceiptPrinter would have become a third copy of the Meow wrapper. A wire format is also not driver specific in the first place: it is the counterpart of ReceiptPrinterEncoder, which encodes for generic thermal printers, where these encode for one specific printer, so they belong next to it in the @point-of-sale ecosystem under the same naming. They are regular dependencies rather than peer dependencies, unlike the renderer: each is a few kilobytes with no dependencies of its own, an application that connects to such a printer always needs the wire format, and a driver without a renderer still lets an application build the packets itself with the same package. The `graphics` section of a profile keeps naming its wrapper, and a wrapper is now the one line that constructs the encoder from that section and calls `encode()`.

<br>

## Scope of version 1

In scope:

- An `EscPosRenderer` that renders the commands ReceiptPrinterEncoder version 3 emits for the `esc-pos` language, with the `column` and `raster` image modes. This is the language of the proof of concept.
- A `StarPrntRenderer` that renders the commands the encoder emits for the `star-prnt` and `star-line` languages. Built alongside the ESC/POS renderer, for parity.
- A `ReceiptPrinterRenderer` that takes the language as an option and delegates to one of the two, the default export of the package and the global of the UMD build.
- The shared painter, bitmap font, symbology generators and 1-bit image type.
- Helpers to convert the output to ImageData, PBM and PNG.
- The `tsp100` branch of WebUSBReceiptPrinter and the `meow` branch of WebBluetoothReceiptPrinter.

Out of scope for now:

- Changes to ReceiptPrinterEncoder. In particular no UTF-8 mode, text is decoded with the same codepage mapping the encoder used.
- ESC/POS and StarPRNT commands the encoder does not emit. The parsers are written so that more commands can be added, and they must skip unknown commands safely, but rendering them is not a goal.
- The two dimensional GS1 DataBar and the composite symbologies of `GS ( k`. They are parsed so that the stream stays in sync, but not rendered, see below.
- Dithering, resizing and other image processing. Images arrive in the byte stream already dithered by the encoder.

Dependencies are kept to a minimum. Runtime dependencies are `@point-of-sale/codepage-encoder` for the codepage tables and `lean-qr` for QR codes, which is MIT licensed, has no dependencies and is under 4 kB compressed. No canvas, no image libraries, no barcode library. The one-dimensional barcodes and PDF417 are implemented in this package.

<br>

## Architecture

Three layers, each unaware of the next, and the middle one split in two since the display list:

```
bytes ──▶ parser ──▶ layout engine ──▶ sink ──▶ items
          (per language)   (shared)      │
                                         └──▶ display list
```

- **Parser.** Turns bytes into calls on the painter: text with a decoded string, style changes, size, font, alignment, line feed, image rows, barcode and QR code requests, cut, pulse. There is one parser per language. Each renderer class is a parser bound to the shared painter.
- **Layout engine.** `src/layout.js` keeps the printer state, composes the current line from cells, applies alignment when a line is committed, lays blocks and pages out, and emits the boxes of the paper: a line box with the operations that are on it, a page with its print areas, a feed, a command. It draws no dots at all: a cell is as wide as the profile says times the width multiplier, a barcode is as wide as its bars, and what the glyph of a code point looks like is the business of whoever draws it. It holds the memory of the printer, the kept images and the downloaded glyphs, so it lives as long as the renderer does.
- **Sink.** Where the boxes go, attached per stream. `src/backends/bitmap.js` draws them: the cells from the packed font with a cache, the rectangles filled, the images blitted, the line turned when it is upside down, the rows accumulated and cut into image items on the rules below. `src/backends/collector.js` keeps them instead and returns the display list of `layout()`. The sink interface is internal: `line(entry)`, `page(entry)`, `feed(entry)`, `command(entry)`, `end()` and `discard()`.
- **Painter.** `src/painter.js` is the wiring of the two: it owns an engine with a bitmap back-end and is the interface both parsers talk to, so the split changed nothing they see.
- **Items.** The output stream, see [Output contract](#output-contract). The other output is the [display list](#the-display-list).
- **SVG.** `src/svg.js` is a sub-entry of the package, `@point-of-sale/receipt-printer-renderer/svg`, and a third consumer of the display list next to the two back-ends: `toSvg(layout, options)` writes one SVG document of a list, see [SVG output](#svg-output). It is an entry of its own because it carries the glyph outlines of `generated/outlines.js`, which nothing else imports.

Repository layout, mirroring ReceiptPrinterEncoder:

```
src/
  receipt-printer-renderer.js   entry, the unified ReceiptPrinterRenderer, the renderers and the helpers
  umd.js                        entry of the UMD build, the class as the only export
  renderers/
    esc-pos.js                  ESC/POS parser and state machine
    star-prnt.js                StarPRNT parser and state machine
  painter.js                    the wiring of the layout engine and its sink
  layout.js                     the layout engine: printer state, line composition, the boxes of the paper
  backends/
    bitmap.js                   the bitmap back-end: glyphs, blocks, the row buffer, flushing, rasterize()
    collector.js                the sink that returns the display list of layout()
  bitmap.js                     the 1-bit image type: create, blit, pack rows, split
  font.js                       glyph lookup, fallback glyph, scaling
  symbologies/
    index.js                    the registry, symbology name to generator
    pattern.js                  modules, module widths and narrow and wide elements
    qrcode.js                   wrapper around lean-qr
    code128.js ean.js upc.js code39.js itf.js codabar.js code93.js
  formats/
    image-data.js pbm.js png.js stitch.js
  svg.js                        entry of the SVG sub-entry, toSvg()
  svg-umd.js                    entry of its UMD build, the named exports as one object
  svg/
    writer.js                   the display list as an SVG document: the defs, the lines, the cells, the pages
    png.js                      a PNG of stored deflate blocks, so that the writer stays synchronous
    trace.js                    a 1-bit bitmap as the rectangles of a path, for the outlines and the SVG output
data/
  fonts/                        the outline font the bitmap fonts are rasterized from, and its licence
  mappings/                     codepage mappings per language, copied from ReceiptPrinterEncoder
  profiles/                     defaults per printer family
generated/                      packed fonts, glyph outlines, mappings and profiles, built by tools/generate.js
tools/generate.js               writes generated/, rasterizes the bitmap fonts and writes their outlines
tools/rasterize.js              outline font to the cells of a bitmap font, and to path data
tools/box-drawing.js            the synthetic box drawing and block glyphs
tools/subset-font.js            cuts the outline font down to the code points that can be printed
test/
  fixtures/                     byte streams from the encoder with expected PBM images
    external/<library>/         byte streams other libraries produced, with their provenance
tools/external/<library>/       the capture scripts of those, one directory per library
tools/contact-sheet.js          every external fixture as a PNG page under build/
documentation/
```

Build and tooling are the same as the encoder: rollup with UMD, ESM, CJS and MJS builds, bundled type declarations from JSDoc through tsc, eslint with the Google config, mocha and chai.

The entry point has a default export, `ReceiptPrinterRenderer`, the unified renderer that takes the language as an option the way the encoder does, and named exports for the same class, the two renderers of one language and the four helpers:

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';
import { EscPosRenderer, StarPrntRenderer, toImageData, toPbm, toPng } from '@point-of-sale/receipt-printer-renderer';
```

The UMD build exposes a `ReceiptPrinterRenderer` global that is the class itself, so `new ReceiptPrinterRenderer({ ... })` works from a script tag, exactly as it does for the encoder. A UMD bundle cannot have a default and named exports at the same time, its global would be an object with a `default` property, so the UMD build has its own entry, `src/umd.js`, which exports the class alone, and the two renderers and the four helpers are static properties of the class as well as named exports.

The SVG writer is a second entry with four builds of its own, `dist/receipt-printer-renderer-svg.{mjs,cjs,esm.js,umd.js}` and a declaration bundle next to them, and `./svg` in the `exports` map with the same conditions as `.`. Its UMD global is `ReceiptPrinterRendererSvg`, an object with `toSvg` on it rather than the function itself, so that the entry has room for whatever it gains later; its entry is `src/svg-umd.js` for the same reason the main one has `src/umd.js`. `test/umd/check.js` loads both bundles in one context and asserts that the outlines are in the second one and in neither build of the first.

<br>

## Output contract

`render(bytes)` returns an array of items, in order. Only two things ever appear in it: image items, and the command types the driver listed in the `commands` option.

```js
[
  { type: 'image', width: 576, height: 412, data: Uint8Array },
  { type: 'cut', value: 'partial' },
  { type: 'pulse', device: 0, on: 100, off: 500 },
  { type: 'image', width: 576, height: 96, data: Uint8Array },
]
```

### Items

| Type | Properties | Meaning |
|---|---|---|
| `image` | `width`, `height`, `data` | A rendered segment. Any height, no padding except rows to whole bytes. |
| `cut` | `value`: `full` or `partial` | Cut the paper here. |
| `pulse` | `device`, `on`, `off` | Open the cash drawer. Times in milliseconds, as the encoder specified them. |
| `feed` | `height` | Advance the paper by this many blank dot rows. |
| `unknown` | `data` | A command that was not understood, with its bytes. For diagnostics. |

### Image data format

One bit per pixel, most significant bit first, rows padded to whole bytes, a set bit is a black dot. Row stride is `Math.ceil(width / 8)` bytes. This is byte for byte the row format of the ESC/POS `GS v 0` raster command, the Star raster `b` command and the PBM P4 file format. The cat printers use the opposite bit order within a byte, which is a per-byte lookup in that driver.

### Flushing

- A supported command flushes completed lines. The painter emits everything up to the last finished line as an image item, then the command item. A half composed line stays in the painter and continues afterwards. The encoder always finishes the line before a cut or pulse, so in practice the line is empty, but the rule is also correct for a real printer, which fires the drawer before the pending line prints.
- The end of the stream flushes every row that was committed, and discards the line that is still being composed, because that is what the printer does with it: cells sit in the line buffer until a line feed or a print command puts them on the paper, and the end of a job is neither. A receipt without a cut, common for kitchen printers and the cat printers, still produces its last image in full, because the line feed of its last line committed that line; text without its line feed stays in the buffer and never prints, here as on paper. See section 16c of the [implementation plan](implementation-plan.md), which found it on a sample stream that ends with unbuffered text on purpose.
- `maxHeight` splits image items that grow taller than the limit. The split is on a row boundary, the pieces are consecutive image items, and nothing is lost. Drivers use it for printers with a maximum raster height per command and for flow control over slow links.

### Fallbacks for unsupported commands

The driver lists the commands it supports. For every command not listed the renderer applies one fixed fallback, so that drivers never have to think about it:

| Command | Fallback |
|---|---|
| `cut` | Nothing. The blank lines the encoder feeds before a cut are already in the image. |
| `pulse` | Dropped. |
| `feed` | White rows inside the surrounding image item. |
| `unknown` | Dropped. |

### Feed items

Receipts contain many blank rows, especially the feed before a cut, and in an image a blank row costs as many bytes as a printed one. When `feed` is supported, a run of blank rows at least `feedThreshold` dots tall is emitted as a feed item instead of white rows, and the image is split around it. Printers with a feed command, such as the cat printers, waste no bandwidth on white. When `feed` is not supported the rows stay in the image.

### Incremental use

Emission points are supported commands and the end of the stream, so the renderer can also be fed in chunks: `write(bytes)` returns the items completed so far, `end()` returns the remainder and resets. `render(bytes)` is `write` followed by `end`. Drivers receive a job as one buffer and use `render`. An emulator receiving a socket stream uses `write` and `end`. Version 1 implements `render`, and keeps the parser state in a form that allows `write` to be added without a redesign.

<br>

## The display list

`layout(bytes)` is the other output of a renderer: what is printed and where, with no dot of it drawn. It is a list of entries in stream order, which is draw order: a `line` box with `text`, `rect` and `image` operations in the coordinates of the line, a `page` with the print areas of page mode, a `feed`, and the `cut`, `pulse` and `unknown` markers at the row the paper has when their command arrives. Everything is in dots, as integers, and every operation carries its whole style, so a consumer keeps no state.

```js
const layout = renderer.layout(bytes);
const items = rasterize(layout, {commands: ['cut']});   // the same items render() returns
```

The list is the engine with a collector attached instead of the bitmap back-end, so it is the same layout the render takes, and `rasterize()` is the same back-end fed from a finished list: `rasterize(layout(bytes))` equals `render(bytes)` on every fixture, which `test/rasterize.js` proves under every option combination. It is not filtered by the `commands` option: every command is in it. The commands do reach the engine, because a cut or a pulse the printer performs takes the paper in front of it away, so the print head stands at the bottom of that paper afterwards and a reverse feed cannot move above it. The height of a list is therefore the height of the paper of a render with the same options, for every fixture.

The list is public because a consumer outside this package is the reason to have one: the SVG writer of the package, a PDF writer some day, a preview or a debugging view. [display-list.md](display-list.md) is the reference page, with the entries, the operations, the page areas and a worked example, and `test/fixtures/**/*.layout.json` freezes the format the way the PBM files freeze the dots. `version` is 1; a field that is added does not change it, a change in the meaning of an existing field does.

<br>

## SVG output

`toSvg(layout, options)` of the `/svg` sub-entry writes one SVG document of a display list, synchronously, as a string. It reads version 1 of the list and throws on any other. The options are `units`, `'dots'` by default and `'mm'`, `'pt'` or `'px'` worked out from the `dpi` of the list for the width and the height of the document, the `viewBox` staying dots; `cutMarker`, off; `background`, `'#fff'` or `null` for a transparent paper; and `ink`, `'#000'`. The document is the paper of the list, with one exception: a list of no height, a stream that printed nothing, becomes a document of one blank row, because a document of no height is refused by a rasterizer and drawn as nothing by a browser.

The document is a `<defs>` that holds one `<path>` per distinct glyph of the receipt and every `clipPath` the document refers to, the paper, the cells and the print areas, then one `<g>` per line entry and one per page entry, in the order the list has them:

- **A line** is `translate(0 y)`, or `translate(W y+h) rotate(180)` when it was printed upside down, clipped to the paper by one `clipPath` that every line shares, because an operation may run past the right edge of its surface and the line bitmap of the renderer clips it.
- **A text cell** is a `<use>` of the glyph at the position of the scaled glyph box in the cell, with a second one a glyph dot to the right for bold, a `<rect>` of the cell before it when it is inverted and the glyph in the colour of the paper, and a `<rect>` for an underline or an upperline, which neither an inverted nor a turned cell gets. Every glyph is clipped to its scaled cell, the overstrike included: a path is not clipped by anything and 43 of the 919 glyphs of the fonts paint outside the 12 by 24 cell, so an unclipped glyph puts ink where the printer has none. The clip is written in the coordinate system of the element, where it is the same rectangle whatever size the cell is drawn at, so a handful of clip paths serve a whole document. A cell turned by `ESC V` is a group of `translate(x+h0 y) rotate(90)` around the same pieces.
- **The glyphs** are the outlines of `generated/outlines.js`, in tenths of a dot, placed with a `scale(.1)` on the definition: font A directly, font B as the same path at two thirds unless the generator gave the glyph an entry of its own, a box drawing character from the box set of its cell in whole dots, a glyph the stream downloaded as the rectangles its bitmap traces into, written where it is used, and a box drawing character in a cell the outlines have no set for traced at write time from the bitmap font, which is the only thing the writer needs a font for.
- **The rectangles** of a line, the bars of a barcode and the modules of a symbol, are one `<path>` with `shape-rendering="crispEdges"` per run of them.
- **An image** is an `<image>` of a PNG with `image-rendering="pixelated"`, one dot on one dot. The PNG is written by `src/svg/png.js` with stored deflate blocks, which shares its scanlines, its chunks and its CRC with `src/formats/png.js` and needs no `CompressionStream`, so the writer is synchronous. It is black on white and takes neither the ink colour nor a transparent background.
- **A page** is a group per print area, clipped to the intersection of the area and the page, since an area can be larger than the page it stands on, and turned by the print direction of the area: `translate(ax ay)`, `translate(ax ay+ah) rotate(-90)`, `translate(ax+aw ay+ah) rotate(180)` and `translate(ax+aw ay) rotate(90)` for the directions 0 to 3, which is the mapping of the display list.
- **A cut** is a dashed `<line>` when `cutMarker` is on, and `feed`, `pulse` and `unknown` produce nothing at all.

Two things in the document paint white where a printer only ever adds ink, and both of them need a reverse feed to reach: an inverted cell writes its glyph in the colour of the paper, and an image writes its white dots as white, so an inverted cell or a raster image that a later entry puts over a printed line erases what is under it in the document and overprints it on the paper. Nothing a stream does short of that reaches it, and a list a renderer produced has it nowhere.

The text is the outlines of the same face the bitmap fonts were rasterized from, so the vector output and the paper differ at the edges of a stroke and nowhere else: `test/svg.js` renders every fixture with resvg, a dev dependency, and asserts that the rectangles and the images agree dot for dot and that the whole paper agrees to at least 0.98. The contact sheet shows the vector output of every external fixture next to the render with the same number.

<br>

## Renderer options

The driver constructs the renderer, because the driver knows the printer:

```js
const renderer = new ReceiptPrinterRenderer({
  language: 'esc-pos',
  width: 576,
  codepageMapping: 'epson',
  commands: ['cut', 'pulse'],
  maxHeight: 1024,
});
```

`ReceiptPrinterRenderer` is the unified renderer. It takes the language as an option, mirroring the encoder, and delegates to the renderer of that language. The two renderers of one language take the same options without `language` and can be constructed directly:

```js
const renderer = new EscPosRenderer({width: 576, codepageMapping: 'epson', commands: ['cut', 'pulse']});
```

| Option | Default | Meaning |
|---|---|---|
| `language` | `esc-pos` | The language the commands are in, one of `esc-pos`, `star-prnt`, `star-line` and `star-graphics`. Unified renderer only. An unknown language throws. |
| `width` | required | Width of the print area in dots. Must be a multiple of 8. |
| `codepageMapping` | `epson` for ESC/POS, `star` for StarPRNT | The mapping the encoder used, so that the codepage selection command can be turned back into a codepage. Same names as the encoder's mappings for that language. |
| `commands` | `[]` | Command types that may appear in the output. |
| `maxHeight` | none | Maximum height of an image item. |
| `lineSpacing` | from the profile | Default line spacing in dots, 30 for the Epson profile and 32 for the Star profile. |
| `profile` | `epson` for ESC/POS, `star` for StarPRNT | Printer family defaults: line spacing, font B cell, motion unit. |
| `feedThreshold` | `24` | Minimum run of blank rows that becomes a feed item. |
| `font` | built in | Font data, for applications that want a different look. Same packed format as the generated font. |

`width` and the columns the driver reports must agree. Font A is 12 dots wide, so the columns in the driver's connected event are `width / 12`. 576 dots gives 48 columns, 384 dots gives 32, both exact. If they disagree, the encoder wraps text in the wrong place and the renderer cannot repair that.

`ReceiptPrinterRenderer.languages` is the list of languages, `['esc-pos', 'star-prnt', 'star-line', 'star-graphics']`, and an instance reports the language it was created for in its `language` getter. The three Star languages are the same command set, so `StarPrntRenderer` renders all of them, but a renderer created for `star-line` reports `star-line`: that is the language the encoder that produced the commands was configured with, and it is what the driver reports in its connected event.

`star-graphics` is the fourth, added in [section 16e](implementation-plan.md#section-16e-user-defined-characters-rotation-colour-and-the-star-graphics-language). It is not a language of the encoder but the raster protocol of the TSP100 family, which is the name the Star profile resolves for those models and therefore the name a driver constructs its renderer with. A job in it is the StarPRNT command set with the raster mode of `ESC * r A` in it, which the parser has read since section 12, so the language needs no parser state of its own: it is a fourth key in the table, backed by `StarPrntRenderer` with the `star` profile and the `star` codepage mapping, and a renderer created for it reports `star-graphics`.

The two renderers of one language keep their static `language` property, `esc-pos` for `EscPosRenderer` and `star-prnt` for `StarPrntRenderer`, for a driver or an application that was given a class instead of a language.

<br>

## Supported ESC/POS commands

This is the complete set of commands ReceiptPrinterEncoder version 3 emits for the `esc-pos` language, plus the text layout commands of [section 12 of the implementation plan](implementation-plan.md#section-12-text-layout-commands), the image commands of [section 13](implementation-plan.md#section-13-image-commands), the page mode of [section 16d](implementation-plan.md#section-16d-page-mode) and the user defined characters, the rotation and the colour commands of [section 16e](implementation-plan.md#section-16e-user-defined-characters-rotation-colour-and-the-star-graphics-language), which other producers use. The parser is a table driven state machine, so that more commands can be added later, and unknown commands are skipped according to the argument lengths in the ESC/POS specification, so that one unknown command does not derail the rest of the stream. [commands-esc-pos.md](commands-esc-pos.md) is the reference page with every command, its status and its exact values.

### Text and control

| Bytes | Command | Rendering |
|---|---|---|
| `0x20`..`0xFF` | printable byte | Decoded through the current codepage, one cell in the current style. |
| `LF` | line feed | Commit the current line, advance by the line height. |
| `CR` | carriage return | Ignored. The encoder's default newline is `LF CR`. |
| `ESC @` | initialize | Reset all state to the defaults, including codepage, font, alignment and line spacing. Does not flush. |
| `FS .` | cancel Kanji mode | No effect on rendering. |
| `ESC t n` | select codepage | Look up `n` in the codepage mapping, decode following bytes with that codepage. Unknown `n` falls back to cp437. |
| `FF` | print the page | Print the page of page mode and return to standard mode, see Page mode below. Nothing in standard mode. |
| `CAN` | cancel the page data | Delete the dots of the page of page mode. Nothing in standard mode. |

### Styles

| Bytes | Command | Rendering |
|---|---|---|
| `ESC E n` | bold | Overstrike, the glyph drawn twice with a one dot horizontal offset. |
| `ESC - n` | underline | `n` = 1 one dot thick, `n` = 2 two dots thick, along the bottom of the cell, across spaces too. |
| `ESC 4 n` | italic | Parsed and ignored, as Epson hardware does. The renderer emulates the printer, it does not improve on it. |
| `GS B n` | invert | Cell drawn white on black. |
| `GS ! n` | character size | Width multiplier in the high nibble plus one, height in the low nibble plus one, 1 to 8. Glyphs are scaled by repeating dots, as printers do. |
| `ESC M n` | font | 0 font A, 1 font B. See [Painter](#painter) for cell sizes. |
| `ESC V n` | rotate 90 degrees | The values are exactly 0, 1, 2, 48, 49 and 50, the 0 and the 48 switching the rotation off and the other four switching it on; any other value leaves it unchanged. Every character cell is turned a quarter turn clockwise and the cells still go left to right, so a rotated line is as tall as a character is wide and reads from the bottom of the paper to the top. A rotated character gets no underline and no upperline, which the reference exempts the way it exempts a reverse one. A standard mode command: the command is dropped in page mode and a rotation that is on turns nothing there. |
| `ESC r n`, `GS ( N pL pH fn m` | print colour | Parsed. The renderer draws one bit, black on white, so a character of the second colour is black and the background of a character is the white of the paper. |
| `ESC a n` | alignment | 0 left, 1 center, 2 right. Applies to the line at commit time, like a printer. Text lines from the encoder are already padded with spaces, block content relies on this. |
| `ESC 3 n` | line spacing | Line spacing in vertical motion units. |
| `ESC 2` | default line spacing | Back to `lineSpacing`. |
| `GS P x y` | motion units | The encoder sets both to the dpi around column mode images, so that one unit is one dot, and resets them with `0 0`. The renderer tracks the vertical unit only, to compute `ESC 3`. |

### Text layout

The commands of section 12, which the encoder does not emit.

| Bytes | Command | Rendering |
|---|---|---|
| `ESC ! n` | print mode | Bit 0 font B, bit 3 emphasis, bit 4 double height, bit 5 double width, bit 7 underline, and the bits it does not set are cleared. The same state as the individual commands, `ESC G` excepted, which has a setting of its own; a later `GS !` decides the size. |
| `ESC G n` | double strike | Bit 0, rendered as bold. Emphasis and double strike are two settings, so a cell is bold while either of them is on. |
| `ESC R n` | international character set | Sets 0 to 17 of the Epson table, which replace twelve code points after the codepage decoding. Sets 16 and 17 are not settled and replace nothing. |
| `ESC { n` | upside down | Bit 0. Every committed line box, blocks included, is rotated by 180 degrees over the width of the paper. The feed order of the lines does not change. A standard mode command: it turns nothing in page mode, where the print direction does that. |
| `ESC SP n` | character spacing | `n` horizontal motion units behind every cell, scaled with the width multiplier, and not counted in the alignment. It is part of the width of a character, so it moves the tab stops. |
| `HT` | horizontal tab | To the first tab stop beyond the cursor. Nothing happens past the last stop; a stop outside the print area puts the cursor one dot beyond the area, so the next character wraps to a new line. |
| `ESC D n1..nk NUL` | tab stops | Up to 32 stops, `n` characters of the current font each, the character spacing included, ascending. `ESC D NUL` cancels every stop, after which a tab does nothing, and `ESC @` returns to a stop every eight characters of font A. |
| `ESC $ nL nH` | absolute position | From the left margin, in horizontal motion units. A position beyond the print area is ignored. |
| `ESC \ nL nH` | relative position | The same, signed, from the cursor. |
| `GS L nL nH`, `GS W nL nH` | left margin, print area | In horizontal motion units, and only effective at the beginning of a line: a command that arrives while a line is being composed does nothing. Wrapping and alignment work inside the area, and a width that does not fit is clamped to the paper. |
| `GS P x y` | motion units | The vertical unit as before, the horizontal one `dpi / x` dots per unit, and one dot per unit until the command sets it. |
| `ESC i`, `ESC m` | legacy cuts | A full and a partial `cut` item. |
| `FS &`, `FS .` | Kanji mode | A lead byte and its trail byte are one character, drawn as two cells of the fallback glyph, so the layout is right without a CJK font, unless the stream downloaded a glyph for that code with `FS 2`. |
| `ESC & y c1 c2 [x d..]..` | user defined characters | Section 16e. The glyphs of the character codes `c1` to `c2` in the font that is current, three bytes of eight dots tall, which is the only `y` the fonts of these printers have, and `x` columns per character, in the column format of `ESC *`. Font A and font B hold a set of their own, and `ESC @` throws both away. An `x` or a code out of range makes the command do nothing, its data consumed; a `y` that is not 3 leaves the data to the stream, because the parser has no layout for it. |
| `ESC % n` | select the user defined set | Bit 0. A code with a definition prints the downloaded glyph in the cell of the current font, in the style and the size of the print mode; a code without one prints its built in glyph. The dots go in the top left corner of the cell. |
| `ESC ? n` | cancel a user defined character | The glyph of one character code in the current font. |
| `FS 2 c1 c2 d1..d72` | user defined Kanji | The glyph of a multibyte code, 24 by 24 dots in the column format of `ESC &`, drawn in the two cells the placeholder of that character takes. `FS ?` cancels one. |
| `FS C n` | Kanji code system | 0 JIS, 1 Shift JIS, which decides what a lead byte is. |
| `FS ! n`, `FS - n`, `FS S n1 n2`, `FS W n` | multibyte styles | Parsed, and nothing on paper: the multibyte characters are placeholder cells. |
| `FS ( C pL pH ..` | character encode system | Reported, its layout is not settled here. |
| `DLE EOT n`, `DLE ENQ n`, `DLE DC4 fn ..` | real time commands | Consumed with their lengths and reported. |

### Page mode

The commands of [section 16d](implementation-plan.md#section-16d-page-mode). The printer composes a page in memory and prints the whole print area in one go.

| Bytes | Command | Rendering |
|---|---|---|
| `ESC L` | select page mode | Compose a page instead of lines. Only at the beginning of a line, as the reference says. A page starts in the print area and the print direction the printer holds. |
| `ESC S` | select standard mode | Leave page mode and delete the page, which is never printed. `ESC @` and the end of the stream do the same. |
| `ESC W xL xH yL yH dxL dxH dyL dyH` | print area | The origin and the width in horizontal motion units, the origin and the height in vertical ones. A width or a height of 0, and an origin outside the printable area, make the command do nothing. The area is a setting of the printer: it may be set in standard mode and it survives the page it is used on, until `ESC @`. Several areas compose into one page. |
| `ESC T n` | print direction | 0 left to right from the top left, 1 bottom to top from the bottom left, 2 right to left from the bottom right, 3 top to bottom from the top right, and 48 to 51 for the same. The layout of the area is turned by a quarter, half or three quarter turn when it goes into the page. A setting of the printer like the print area. |
| `GS $ nL nH`, `GS \ nL nH` | vertical position | The absolute and the relative position along the axis the lines of the direction go down. `ESC $` and `ESC \` move along the axis the characters run in. The unit follows the axis, so the two swap in the directions 1 and 3, and so do the units of `ESC 3`, `ESC J`, `ESC K`, `ESC d`, `ESC e` and `ESC SP`. |
| `FF` | print and return to standard mode | Draw the page on the paper as one block, as tall as the print areas it was given, an area that stayed empty included, and leave page mode. A page without an area is as tall as the boxes of what was laid out in it, see Page mode of the painter below. |
| `ESC FF` | print the page | The same, with the dots, the area, the direction and the position kept, so the page can be printed again. |
| `CAN` | cancel the page data | Delete the dots and keep the print area. |

### Blocks

| Bytes | Command | Rendering |
|---|---|---|
| `GS h n` | barcode height | Stored for the next barcode, the height of the bars in dots. |
| `GS w n` | barcode module width | Stored, one module is `n` dots. The specification defines 2 to 6, the encoder sends 1 for the GS1 symbologies, so 1 to 6 is accepted. |
| `GS H n` | HRI position | 0 none, 1 above, 2 below, 3 both. The encoder sends 0 or 2. |
| `GS f n` | HRI font | 0 font A, 1 font B. The default is font A, which is what the ESC/POS reference says and what a printer does; the encoder never sends this command. |
| `GS k m n d1..dn` | barcode, function B | Symbology `m`, `n` data bytes. See the symbology table below. Bars that are wider than the print area are not printed at all, as Epson firmware does. |
| `GS k m d1..dk NUL` | barcode, function A | Same, NUL terminated. The encoder uses function A for `m` < 65. |
| `GS ( k pL pH 49 65 n1 n2` | QR model | 49 model 1, 50 model 2. Model 1 is rendered as model 2. |
| `GS ( k pL pH 49 67 n` | QR module size | `n` dots per module. |
| `GS ( k pL pH 49 69 n` | QR error correction | 48 L, 49 M, 50 Q, 51 H. |
| `GS ( k pL pH 49 80 48 d..` | QR store data | Data for the next print. |
| `GS ( k pL pH 49 81 48` | QR print | Draw the symbol as a block, centred according to the alignment. Nothing is printed when no data was stored or when the symbol is wider than the print area. |
| `GS ( k pL pH 48 65 n` | PDF417 columns | Number of data columns, 1 to 30, and 0 for a number the printer picks. |
| `GS ( k pL pH 48 66 n` | PDF417 rows | Number of rows, 3 to 90, and 0 for a number the printer picks. |
| `GS ( k pL pH 48 67 n` | PDF417 module width | `n` dots per module, 2 to 8. |
| `GS ( k pL pH 48 68 n` | PDF417 row height | The height of a row as a multiple of the module width, 2 to 8. |
| `GS ( k pL pH 48 69 m n` | PDF417 error correction | `m` of 48 gives the level as a digit, 48 to 56 for level 0 to 8. `m` of 49 asks for a ratio instead, `n` tenths of the data codewords as check codewords, 1 to 40, and the renderer picks the level whose number of check codewords comes closest to it. |
| `GS ( k pL pH 48 70 n` | PDF417 options | 0 the standard symbol, 1 the truncated one, which drops the right row indicator and the stop pattern. |
| `GS ( k pL pH 48 80 48 d..` | PDF417 store data | Data for the next print. |
| `GS ( k pL pH 48 81 48` | PDF417 print | Draw the symbol as a block, centred according to the alignment. Nothing is printed when no data was stored, when the data does not fit in the number of columns and rows the commands ask for, or when the symbol is wider than the print area. The other selectors of the group, Maxicode, the two dimensional GS1 DataBar and the composite symbologies, are not rendered and produce an `unknown` item. |
| `ESC * m nL nH d..` | column image | `m` is 0 and 1 for the eight dot modes, one byte per column, and 32 and 33 for the 24 dot modes, three bytes per column, the most significant bit of the first byte at the top. The single density modes, 0 and 32, print every column twice. `nL + nH * 256` columns, followed by `LF` in the stream. Blitted at the current position, with line spacing at 24 dots the strips join seamlessly. The encoder only emits `ESC * 33`. |
| `GS v 0 m xL xH yL yH d..` | raster image | `xL + xH * 256` bytes per row, `yL + yH * 256` rows. `m` is 0 normal, 1 double width, 2 double height and 3 both, by repeating dots. Blitted as a block, aligned according to the alignment. |
| `GS ( L pL pH 48 112 a bx by c xL xH yL yH d..` | store raster graphics | Section 13. The image goes into the graphics print buffer. `a` is 48 monochrome and 52 multiple tone, whose tones are drawn as black, `bx` and `by` of 2 double the width and the height, `c` is the colour of the data, which is drawn whatever colour it names, `x` and `y` are the size in dots, 1 to 8192 in the direction the data runs in and 1 to 2047 across it. A parameter outside its range makes the command do nothing, and a command that carries fewer dots than its size asks for stores only the rows, or the columns, that are there. |
| `GS ( L pL pH 48 113 ..` | store column graphics | The same header, the dots one column after another, `int((y + 7) / 8)` bytes per column. The same picture through 112 and 113 prints the same dots. |
| `GS ( L pL pH 48 50` | print the graphics buffer | Drawn as a block, aligned according to the alignment, and the buffer is emptied. Images that were stored one after another are drawn under each other. `ESC @` throws the buffer away. |
| `GS ( L pL pH 48 67 ..`, `48 68 ..` | define NV graphics | `a kc1 kc2 b xL xH yL yH [c d..]1..b`, in raster and in column format. Every colour block is drawn into one image with OR, which is the one image buffer of this renderer against one per colour on a two colour printer, so nothing of the definition is lost. The image is kept under its key code for the life of the renderer, an initialize and the end of a stream included. |
| `GS ( L pL pH 48 83 ..`, `48 84 ..` | define download graphics | The same, in the download memory, which has key codes of its own. |
| `GS ( L pL pH 48 69 kc1 kc2 x y`, `48 85 ..` | print NV, download graphics | Drawn as a block, aligned, with `x` and `y` of 1 or 2, the 2 doubling the width and the height. A key code without a definition prints nothing, does not commit the pending line, and produces an `unknown` item. A parameter that is missing or outside its range makes the command do nothing, the way the printer ignores it. |
| `GS ( L pL pH 48 65 ..`, `48 66 ..`, `48 81 ..`, `48 82 ..` | delete graphics | Delete every image of a memory, which takes the fixed bytes `CLR` and does nothing without them, or the one image of a key code. |
| `GS ( L pL pH 48 48`, `51`, `52`, `64`, `80` | capacities and key code lists | Consumed and reported: they answer the host, which the renderer has no channel to. |
| `GS ( L pL pH 48 49 x y` | reference dot density | Parsed. `x` and `y` of 50 for 180 dpi and 51 for 360 dpi; images are drawn at one dot per dot either way. |
| `GS 8 L p1 p2 p3 p4 48 fn ..` | graphics, long form | The same functions under a four byte length, which a definition of more than 65535 bytes needs. |
| `GS * x y d..` | define the downloaded bit image | `x` bytes of eight dots wide, 1 to 255, `y` bytes of eight dots tall, 1 to 48, at most 1536 bytes in all, `x * y * 8` bytes in column format: the bytes of a column under each other, then the next column. One image, a definition replaces the one before it, and a size outside its range is ignored. |
| `GS / m` | print the downloaded bit image | Drawn as a block, aligned, in the four modes of `GS v 0`. Nothing, and an `unknown` item, when no image was downloaded. |
| `FS q n [xL xH yL yH d..]..` | define NV bit images | `n` images in the column format of `GS *`, numbered 1 to `n`. The command replaces every NV bit image the printer held, and an `n` of 0 is ignored and deletes nothing. |
| `FS p n m` | print an NV bit image | Image `n` in the four modes of `GS /`. An image the stream never defined prints nothing and produces an `unknown` item. |
| `GS V n` | cut | 0 full, 1 partial. Also accepts 65 and 66 with a feed argument, as a common variant. |
| `ESC p m t1 t2` | pulse | Drawer `m`, on `t1 * 2` ms, off `t2 * 2` ms. |

### Barcode symbologies

The values the encoder can emit and what the renderer does with them.

| Value | Symbology | Version 1 |
|---|---|---|
| 0 | UPC-A | rendered |
| 1 | UPC-E | rendered, from six digits, from the number system and the check digit around them, or from the eleven or twelve digits of a UPC-A that has a zero suppressed form |
| 2 | EAN-13 | rendered |
| 3 | EAN-8 | rendered |
| 4 | Code 39 | rendered |
| 5 | ITF | rendered |
| 6 | Codabar | rendered |
| 72 | Code 93 | rendered |
| 73 | Code 128 | rendered, including the `{A` `{B` `{C` set selection the encoder passes through |
| 74 | GS1-128 | rendered, as Code 128 with FNC1 |
| 75 | GS1 DataBar Omnidirectional | rendered, from thirteen digits or from fourteen with the check digit, ISO/IEC 24724 |
| 76 | GS1 DataBar Truncated | rendered, the same bars, thirteen modules tall |
| 77 | GS1 DataBar Limited | rendered, from a GTIN that starts with a zero or a one, ten modules tall |
| 78 | GS1 DataBar Expanded | rendered, from a GS1 element string with its application identifiers in parentheses |
| 79 | Code 128 auto | rendered, the renderer picks the code sets |

Function A, `m` below 65, and function B, `m` of 65 to 71, select the same symbology and render the same.

Check digits are computed when the data lacks them, and validated when present, the way Epson firmware does. Invalid data prints nothing, which also matches the firmware.

The GS1 DataBar family takes its height from the specification and not only from the command: the height of Truncated is thirteen modules and of Limited ten, whatever `GS h` asks for, and Omnidirectional is at least thirty three modules and Expanded at least thirty four. The heights are in modules, so they follow the width of a module of `GS w`. ISO/IEC 24724 words all four as minimums and the printer notes are remembered as `GS h` having no effect on this family at all; the split above is a reading pending a hardware check, chosen so that symbology 75 and symbology 76 stay visibly different, and it is in the deviation lists of both reference pages.

Omnidirectional is ninety six modules wide, of which ninety five are printed, and Limited seventy nine, of which seventy three are printed: the module in front of the left guard bar, and the five module space behind the right guard of Limited, are quiet zone. The human readable text is the element string with the application identifiers in parentheses, which is what a printer prints under these symbols, and that notation has no escape for a parenthesis inside a value, so an `(` in the data of an Expanded symbol always starts the next application identifier.

The human readable text is one line of cells of the HRI font, centred over the bars, and the block is the bars plus that line, or two of them when the text is printed above and below. Barcodes carry no quiet zone, a printer does not add one either.

<br>

## Supported StarPRNT commands

The complete set of commands ReceiptPrinterEncoder version 3 emits for the `star-prnt` and `star-line` languages, plus the text layout commands and the raster mode of section 12, the image commands of section 13 and the page mode of section 16d. The languages share this set: `star-line` differs only in the encoder's line buffering, and `star-graphics`, the raster protocol of a TSP100, is the raster mode of this set and nothing else. The user defined characters, the rotation and the two colour commands of section 16e are ESC/POS only, because no Star specification text available here defines the Star ones. The parser has the same structure as the ESC/POS one and feeds the same painter. [commands-star-prnt.md](commands-star-prnt.md) is the reference page with every command, its status and its exact values.

### Text and control

| Bytes | Command | Rendering |
|---|---|---|
| `0x20`..`0xFF` | printable byte | Decoded through the current codepage, one cell in the current style. |
| `LF` | line feed | Commit the current line. |
| `CR` | carriage return | Ignored. |
| `ESC @` | initialize | Reset all state to the defaults. |
| `CAN` | cancel | Throw away the line that is being composed, without advancing the paper. The encoder sends it right behind `ESC @`, where the line buffer is already empty. |
| `ESC GS t n` | select codepage | Look up `n` in the Star codepage mapping. |
| `ESC GS P n ..` | page mode | `ESC GS P 0` enters page mode and `ESC GS P 1` leaves it and prints the page; the encoder's flush is the two of them around a job, which composes an empty page and prints nothing. Functions 2 to 5 are the print area, the print direction and the two vertical positions, in dots, and they are a reading of the ESC/POS group under Star's numbering, see [commands-star-prnt.md](commands-star-prnt.md#page-mode). |

### Styles

| Bytes | Command | Rendering |
|---|---|---|
| `ESC E`, `ESC F` | bold on, off | Overstrike. |
| `ESC - n` | underline | 0 off, 1 on, one dot thick. |
| `ESC 4`, `ESC 5` | invert on, off | Cell drawn white on black. |
| `ESC i h w` | character size | Height and width multipliers, value plus one, 1 to 6. |
| `ESC RS F n` | font | 0 font A, 1 font B, 9x24 in the Star profile. |
| `ESC GS a n` | alignment | 0 left, 1 center, 2 right. |
| `ESC 0` | line spacing 3 mm | 24 dots, used around column images. |
| `ESC z 1` | line spacing 4 mm | Back to the default line spacing, 32 dots in the Star profile. |

The encoder emits nothing for italic on StarPRNT, so there is nothing to ignore.

### Text layout and raster mode

The commands of section 12, which the encoder does not emit.

| Bytes | Command | Rendering |
|---|---|---|
| `ESC W n` | double width | 1 on, 0 off, the width multiplier of `ESC i`. |
| `ESC h n` | character height | The multiplier is the value plus one, so 1 is double height. |
| `ESC _ n` | upperline | Along the top of the cell, the way the underline runs along the bottom. |
| `ESC R n` | international character set | Sets 0 to 13, the ones Star numbers the way Epson does. A higher number is left alone. |
| `ESC l n`, `ESC Q n` | left and right margin | In characters of the current font, the right one the column the print area ends at. Only effective at the beginning of a line, like `GS L` and `GS W`. |
| `HT`, `ESC D n1..nk NUL` | tab stops | The same as ESC/POS. |
| `ESC SP n` | character spacing | Consumed with one argument byte and reported: the command is not in the specification text that was available. |
| `ESC GS A n1 n2`, `ESC GS R n1 n2` | absolute and relative print position | Section 16. In dots from the left margin and from the cursor, the counterparts of `ESC $` and `ESC \`. receiptline lays every column of a table out with them. |
| `ESC GS BEL`, `ESC GS EM DC1`, `ESC GS EM DC2` | buzzer | Consumed with their lengths and reported. |
| `ESC * r R`, `ESC * r A`, `ESC * r B`, `ESC * r C` | raster mode | Initialize, enter, quit and clear. In raster mode `b` and `k` are the row commands instead of letters. |
| `b n1 n2 d..`, `k n1 n2 d..` | raster data | One row of dots at the left margin of the raster, padded to the paper, written with an OR. `b` moves to the next row, `k` does not. The rows are drawn on the paper itself, the margins of the line mode do not move or clip them. |
| `ESC * r Y n NUL` | move down | `n` dots down, clamped to 65535. The row that was being built is the first of them, the rest are blank rows, which become a `feed` item. |
| `ESC * r E n NUL`, `ESC * r F n NUL`, `ESC * r e n NUL` | EOT, FF and EM mode | Stored for the execute commands. |
| `ESC FF NUL`, `ESC FF EOT`, `ESC FF EM` | execute | Print the image buffer and, when the stored mode cuts, emit a `cut` item: 8 and 9 full, 12, 13 and the tear bar mode 3 partial. Nothing happens with an empty buffer. |
| `ESC * r D n NUL` | drive drawer | A `pulse` item for drawer 1, 2 or both, with the times of the line mode commands. |
| `ESC * r m l n NUL` | left margin of the raster | `n` bytes of eight dots, where the rows are placed. |
| `ESC * r m r`, `P`, `Q`, `t`, `K`, `a`, `b` | raster settings | Parsed, they do not change the dots. |

### Blocks

| Bytes | Command | Rendering |
|---|---|---|
| `ESC b n1 n2 n3 n4 d.. RS` | barcode | Symbology `n1`, HRI `n2`, 1 without text and 2 with the text below the bars in font A, module width `n3` 1 to 3, which is 2, 3 and 4 dots, height `n4` in dots. Star symbology numbers differ from ESC/POS and map onto the same generators, and Star Code 128 has no code set selection, so it is drawn the way ESC/POS symbology 79 is. |
| `ESC GS y S 0 n` | QR model | 1 or 2, rendered as model 2. |
| `ESC GS y S 2 n` | QR module size | `n` dots per module. |
| `ESC GS y S 1 n` | QR error correction | 0 L, 1 M, 2 Q, 3 H. |
| `ESC GS y D 1 NUL nL nH d..` | QR store data | Data for the next print. |
| `ESC GS y P` | QR print | Draw the symbol as a block, under the same rules as the ESC/POS one. |
| `ESC GS x S 0 n1 n2 n3` | PDF417 size | `n1` of 0 leaves the size to the printer, 1 takes the `n2` rows and the `n3` columns that follow, where a zero is automatic for that one alone. The encoder always sends 1. |
| `ESC GS x S 1 n` | PDF417 error correction | Level 0 to 8. |
| `ESC GS x S 2 n` | PDF417 module width | `n` dots per module, 2 to 8. |
| `ESC GS x S 3 n` | PDF417 row height | The height of a row as a multiple of the module width, 2 to 8. |
| `ESC GS x D nL nH d..` | PDF417 store data | Data for the next print. No function byte, unlike the QR command. |
| `ESC GS x P` | PDF417 print | Draw the symbol as a block, under the same rules as the ESC/POS one. The StarPRNT command set has no command for the form of the symbol, so a Star printer always prints the standard one, never the truncated one. |
| `ESC X nL nH d.. LF CR` | column image, 24 dots | One strip of 24 rows, three bytes per column, with the line spacing at 24 dots the strips join. |
| `ESC K nL nH d..`, `ESC L nL nH d..` | bit image, eight dots | One strip of eight rows, one byte per column. The single density image of `ESC K` prints every column twice. The encoder emits neither, it uses `ESC X` for every image. |
| `ESC k nL nH d..` | bit image, twenty four dot band | Section 13, corrected in section 16. A band of twenty four dot rows, `nL + nH * 256` bytes of eight dots per row, in raster format. It is what receiptline sends for every image in Star Line Mode, and it makes the render of a document dot for dot the ESC/POS one; no specification text settled it. |
| `ESC GS S m n1 n2 n3 n4 n5 d..` | raster image | `m` of 1 is the raster bit image, `n1 + n2 * 256` bytes per row, `n3 + n4 * 256` rows, `n5` a fixed byte, and the dots in raster format like `GS v 0`. Drawn as a block, aligned according to the alignment and inside the print area. Another `m` is reported, its data consumed. |
| `ESC FS p n m` | print an NV logo | The logo is in the printer, so nothing is drawn and the command produces an `unknown` item. |
| `ESC FS q n [..]..` | define logos | Consumed with the layout of the ESC/POS `FS q`, which is an assumption, and reported: nothing is kept and nothing is drawn. |
| `ESC d n` | cut | 0 full, 1 partial, 2 full with feed, 3 partial with feed. |
| `ESC BEL n1 n2` then `BEL` or `SUB` | pulse | `n1` on time and `n2` off time in units of 10 ms, for the first drawer only. `BEL` and `FS` pulse drawer 1 with that width, `SUB` and `EM` pulse drawer 2 for the fixed 200 ms on and 200 ms off of the specification. |

The Star barcode symbology numbers map onto the same generators as the ESC/POS ones: 0 to 9 are UPC-E, UPC-A, EAN-8, EAN-13, Code 39, ITF, Code 128, Code 93, Codabar and GS1-128, and 10 to 13 are GS1 DataBar Omnidirectional, Truncated, Limited and Expanded, with the same data rules and the same heights as the ESC/POS table describes.

<br>

## Painter

The rules below are the printer's, and they live in two files since the display list: `src/layout.js` decides them and emits the boxes of the paper, `src/backends/bitmap.js` draws the boxes and cuts the image items from the rows, and `src/painter.js` wires the two together for the parsers. Everything about a cell, a line, a block and a page is a decision of the engine; everything about a dot, a glyph, a row buffer and an item is the back-end's.

- **Cells.** The line is a row of cells. A cell is a glyph in the current style with a width and height multiplier. Font A cells are 12 by 24 dots. Font B cells come from the profile: 9 by 17 dots in the Epson profile, 9 by 24 in the Star profile. Both are drawn from the same 8x16 glyphs, centred horizontally in the cell and standing on the baseline of the cell, which is three quarters of its height: row 12 of the 17 row Epson cell, where the 8x16 glyphs already have their baseline, and row 18 of the 24 row Star cell, where font A has its baseline as well. `width / 12` cells fit on a line for font A.
- **Line height.** The height of a committed text line is the larger of the tallest cell on the line and the current line spacing. With the Epson default of 30 dots and a 24 dot font there is a six dot gap, with the Star default of 32 dots an eight dot gap. Lines with only double height text are 48 dots tall, not 60, which is also how the firmware behaves.
- **Baseline.** Cells of different sizes share the baseline of the font, which is what the firmware does. A font carries the row its glyphs stand on, row 18 of the 24 row font A cell and row 12 of the 16 row font B one, and the cell a printer draws that font in has its baseline at the same fraction of its height, `floor(cellHeight * baseline / height)`: 18 for the 24 dot font A cell, 12 for the 9x17 font B cell of an Epson and 18 for the 9x24 one of a Star. The ascent of a cell is that row times the height multiplier and its descent is the rest of the cell, the line is as tall as the largest ascent plus the largest descent, and every text cell is drawn with its baseline on the baseline of the line, `ascentMax - ascent` dots from the top. So the small text next to a double height word stands on the same line as that word and the descender space of the tall cell hangs below it. Text cells of every font and size, downloaded glyphs and placeholders follow the rule, on the paper and in a page alike, and the underline and the upperline are part of the cell and move with it. Cells with no baseline of their own, the strips of a column image and the cells turned by `ESC V`, sit on the bottom of the line box instead, and a strip that is taller than the text pushes the text down to it. The gap of the line spacing stays below the line. A line whose cells all have one font and one size is unchanged by the rule, to the dot. Corrected on 2026-09-13, confirmed on an Epson printout; the cells stood on the bottom edge of the tallest cell of the line before, and on the top of the line box before that.
- **Alignment.** Applied at commit, over the free width of the line.
- **Overflow.** Cells beyond the width wrap to the next line, as a printer wraps. The encoder never produces this, but the painter must not lose content.
- **Blocks.** Barcodes, QR codes and raster images are committed as their own lines: the pending text line is committed first, the block is drawn aligned, and the paper advances by the block height. Column mode images are different, they are 24 row strips inside normal lines with the line spacing set to 24, so they go through the regular line mechanism.
- **Kept images.** The definition commands of the graphics group hand the painter an image under a key, `nv:65:66` or `nv-bit-image:1`, and a print command draws it as a block, scaled by repeating its dots. The images live as long as the painter does: an initialize does not empty them and neither does the end of a stream, which is the memory of a printer. A key without an image prints nothing at all, the pending line included, and the parser reports the command.
- **Flushing.** The painter accumulates committed rows in a growing bitmap and cuts image items from it on the rules in [Output contract](#output-contract). Blank row runs are tracked while committing, so that feed items and the `feedThreshold` need no second pass. A command the printer performs takes the paper in front of it away: the position moves down to the bottom of everything printed so far and a reverse feed cannot move above that row again, so a stream that moved the paper back before a cut prints what follows behind the cut and not over it.
- **Print area.** `margins({left, width})` moves the left edge of the line and narrows the area the line is composed in. The commands that set it are only effective at the beginning of a line, so a call while a line is being composed does nothing, the way a printer drops the command. Wrapping, the alignment and the tab stops all work inside the area. `block(bitmap, {margins: false})` puts a block on the paper instead, for content that carries its own position, such as the rows of the Star raster mode.
- **Cursor.** `position(dots)` moves the cursor inside the line, `cursor` reads it, and `tab()` moves to the next stop of `tabs([columns])`, which counts in characters of the current font, the character spacing included. An empty list cancels every stop, `null` and a reset go back to a stop every eight characters of font A, and a stop outside the print area sends the cursor past it so that the next character wraps. Cells that were already placed stay where they are, so moving back and printing again overprints.
- **Character spacing.** `spacing(dots)` leaves white behind every cell, scaled with the width multiplier and not counted in the width the alignment centres.
- **Page mode.** `page(true)` composes a page instead of the paper: `pageArea({x, y, width, height})` puts a print area on the page and `pageDirection(0..3)` says which way the text runs in it, both of them settings of the printer that a page takes over and that survive it, and the lines and blocks of the area are laid out in a coordinate system of their own and turned by the direction when they go into the page. `pageVertical(dots, {relative})` moves the position down the area, `printPage({keep})` draws the page on the paper as one block, as tall as the areas it was given and as tall as the boxes of what was laid out in it when it was given none, and `cancelPage()` throws the dots away. A `cut` or a `pulse` that arrives while a page is being composed waits until the page is on the paper. Leaving page mode, an initialize and the end of the stream all delete a page that was never printed.
- **Page height.** A page is as tall as the print areas the stream set on it, the origin of an area included, so an area of 400 dots leaves 400 dots of paper whatever it holds and an area that stayed empty still feeds. A page that was given no area at all is as tall as the boxes of what was laid out in it: the line boxes and the feeds of every area, a line box being the full height of the line with the gap of the line spacing below it, mapped into the page by the print direction of their area and clipped where the area ends, the bottom of the lowest one. A line box spans the whole width of the layout of its area, and what that reaches depends on the direction: the directions 1 and 3 swap the axes, so the width of the layout is the height of the area and one line spans the whole of it; direction 2 mirrors, so the bottom of the area is the height of the area minus the top of the highest box; direction 0 leaves both axes alone. One line laid out in direction 1 or 3 without an area is a page of the whole 1662 dots, and so is one in direction 2 that starts at the top of its layout. A page with neither an area nor a box prints nothing at all, which is what keeps the encoder's Star flush, page mode entered and left with nothing in between, free. The rule is the printer feeding what it laid out rather than the rows its ink reaches, so a trailing blank line of a page feeds its rows the way it does in standard mode. Replaces the rule of section 16d, which measured the dots of the page instead.
- **Upside down.** `style({upsideDown})` rotates every line box that is committed from then on by 180 degrees, blocks included. The order of the lines does not change.
- **Placeholders.** `placeholder(count)` draws cells of the fallback glyph, which is what a multibyte character becomes without a CJK font.
- **Memory.** Rows are packed as they are committed. A receipt of a few thousand rows at 576 dots is a few hundred kilobytes.

<br>

## Resources

### Bitmap font

A fixed-cell bitmap font, stored as packed glyph arrays by `tools/generate.js`, which rasterizes them from outline fonts at build time. There is an ordered list of four sources and a glyph comes from the first one that has the code point. The face is [Iosevka](https://github.com/be5invis/Iosevka) Medium 34.8.1, under the SIL Open Font License 1.1, a monospaced face drawn for a narrow fixed cell, subset by `tools/subset-font.js` to `data/fonts/iosevka-medium-subset.ttf`. Behind it stand three subsets of the scripts it has no glyph for, each under the same licence: [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) Mono J SemiBold 1.0.41 for the half width katakana, which is Iosevka's Latin joined with Source Han Sans and puts its kana on the metrics of the face to the second decimal; [Noto Sans Hebrew](https://github.com/notofonts/hebrew) Medium 3.001 for the Hebrew of cp862, of Windows-1255 and of the Hebrew pages of Bixolon, Xprinter and the POS-8360; and [Noto Sans Thai](https://github.com/notofonts/thai) Medium 2.002 for the Thai of cp874, of Star's own cp874 and of the three Thai pages of Epson's table, thai42, thai11 and thai13, of the six the ESC/POS mappings carry between them. Every one of those pages printed nothing but the fallback box before its source was added. Nothing of this reaches the published package: opentype.js is a dev dependency and only `generated/fonts.js` is bundled. The provenance of all four is in `data/fonts/README.md`.

**The first source is the face and every source behind it is fitted to it.** The face is measured, on the advance width of its `M` and on the ascender and the descender of thirteen Latin characters, see `tools/rasterize.js`; a source behind it is never measured, it is drawn at the scale of the face times the ratio of the two ems, and its reference advance is the face's written in its own units. That is what lets a source hold a script and no Latin, which is what Noto publishes: the only builds of these two that carry a Latin carry Noto's proportional one, whose `M` is 902 and 918 units at 1000 per em where Iosevka's is 500, and measured on that the Hebrew and the Thai would come out at a cap height of 9.5 dots beside a Latin of 17.6. Fitted to the face they are 14.3 and 13.4 dots tall, between the x height of the Latin and its cap height. Sarasa, whose em and whose reference advance are Iosevka's, inherits the numbers it used to measure for itself, bit for bit.

The fit itself is the advance width: the advance of one character is exactly one cell, 12 dots for font A and 8 for font B; the advance of the face is half an em, so the em lands on 24 and 16 dots with no rounding and no vertical squeeze, and every source inherits that. The baseline is row 18 of the 24 row cell and row 12 of the 16 row one, the cap height of the Latin comes out at 17.6 and 11.8 dots, and nothing is scaled horizontally, so every glyph keeps the side bearings the designer gave it and the rhythm of a line is even. A dot becomes ink when the outline covers 0.45 of it, measured on an 8 by 8 grid of samples with a nonzero winding fill: below a half on purpose, which is the dot gain of a thermal head.

There is one exception to "nothing is scaled horizontally", and it is for glyphs that are wider than the face: a glyph whose own advance is wider than the advance the face is fitted by is fitted by its own advance instead, so that it fills the cell instead of hanging out of it to the right. It was made for the twelve kanji and the postal mark of the katakana codepage, `円 年 月 日 時 分 秒 〒 市 区 町 村 人`, which a Japanese face draws on a full em while the face is fitted by the half em of its Latin, and which an Epson draws in the same 12 by 24 cell as the rest of the page. It catches 34 glyphs of Iosevka as well, the ones it draws on a full em: the em dash, the ellipsis, the arrows, the geometric shapes and the smileys of the tail of cp437, which were drawn at the scale of the face before, and since the advance of the face is exactly the cell they started at its left edge and were clipped at its right, so the cell held the left half of the glyph: `→` printed as its stem with no head and `…` as a dot and a half. The comparison is on the advance widths in whole font units, so a glyph of exactly the advance of the face is never touched. It catches most of the Hebrew and the Thai too, which Noto draws on anything from a fifth of an em to nine tenths of one.

Three more rules belong to the cell rather than to any one source, and they hold for all four. **A glyph whose advance is zero, a combining mark, is centred in the cell by its ink**, on a dot centre, `floor(width / 2) + 0.5`: there is no advance to centre it in, and its ink is drawn where it sits over the letter it belongs to, which for a Thai tone mark is a third of an em to the left of the origin and for Iosevka's five combining accents is wholly to the left of it. Placed by the advance, those five printed an empty cell, and eight of the sixteen niqqud would have printed one in the 8 by 16 cell if the phase had been the middle of the cell rather than a dot centre: seven of them are under a dot wide, and the middle of an even cell is a boundary between two dots, which is the worst place to put a mark that small. All 37 marks of the set now print in both fonts. **A glyph whose ink lies outside its own advance, on either side, is fitted by its ink**: the cell is divided by the widest of the advance of the face, the advance of the glyph and the width of the ink, and the ink is pushed right by whatever of it lies left of the origin. The wide glyph rule measures advances and this one measures ink, so it catches what that one cannot: `U+0E33`, the Thai sara am, is a spacing character of an advance of 415 units whose ink runs from −279 to 337, because the nikhahit half of it is drawn over the consonant in front of it, and the cell showed the right half alone. It catches eleven glyphs of Iosevka as well, whose accents and stems are drawn a little outside their advance and were clipped by a column at the edge of the cell: `ĥ ŉ Έ Ή Ί Ό Ύ Ώ √ ♫` and `ไ`. **A Unicode format character, U+200B to U+200F, U+2028 to U+202E, U+2060 to U+2064 and U+FEFF, is an empty cell**, whatever outline a source draws for it and even when no source has one: it is a zero width instruction to whatever lays out the text, and a printer that gives one cell to every code point has nothing to print for it. `tools/subset-font.js` leaves them out of every subset it writes, and `tools/generate.js` gives every one of them in the set a cell of its own, so that none of them is the fallback box either. Iosevka's `U+200C` and `U+200D`, which the committed subset predates the rule and still carries, printed a sliver of their right edge against the left wall of the cell; the two bidi marks of Windows-1255, `U+200E` and `U+200F`, which no subset carries, printed the fallback box. All four print nothing now.

The box drawing and block characters, U+2500 to U+259F, are drawn on the dot grid by `tools/box-drawing.js` instead of taken from the face, because they have to leave a cell at exactly the dot the next cell expects. A light line is two dots, a heavy line four, a double line two single dot lines three dots apart, and junctions are drawn from their four arms.

The same pass writes the outlines of the glyphs to `generated/outlines.js`, for the SVG output. A glyph is placed in its cell once, by `contours()` of `tools/rasterize.js`, and both the bitmap and the outline come out of that one set of placed contours, so an outline sits on the bitmap it was rasterized from. A glyph path is absolute M, L, Q, C and Z, in tenths of a dot in the frame of the 12 by 24 cell with y down, the curves of the face kept as curves; a C stands only where a curve is not a quadratic one within a tenth of a dot, of which the face has none, and a box path is M, Z and the relative h and v of its rectangles in whole dots. A path is not clipped by its cell while the bitmap of a glyph is, so a consumer clips every glyph to its cell: 43 glyphs paint outside it, none of them by more than two dots and none wholly, and what is left leaves the cell at the top and not at the side, the Vietnamese precomposed letters and the horn letters of a face drawn for a taller cell. It was 93, 41 and 5 before the glyphs that are wider than the face were fitted into the cell instead of clipped by it, 59, 7 and 5 before the combining marks were centred by their ink, which brought in the five that were wholly outside, and 54, 1 and 0 before a glyph whose ink lies outside its own advance was fitted by its ink, which brought in the last one that was more than two dots out. A tenth of a dot is finer than a printer can show but not fine enough to reproduce a coverage threshold, so filling a path again with the same 8 by 8 samples and the same 0.45 rule gives the packed glyph back to within a few dots rather than exactly: 906 dots over the 919 glyphs of font A and 279 over font B, the worst glyph 34 of the 288 dots of its cell, which is one of the four vertical arrows whose stem is nine tenths of a dot wide on a dot boundary and is ink in the bitmap and white in the refill; the rest are mostly diagonals whose edge dots sit on the threshold, and `test/outlines.js` names the four and counts them apart. `test/outlines.js` measures it per glyph and reports the totals. Equality is not the goal: the bitmap font is going to be tweaked by hand on the dot grid and drift from the face on purpose, and the vector output is judged on the agreement of a whole receipt. Font B is the same path at two thirds, because its own fit in the 8 by 16 cell comes out as exactly that; the format carries a `glyphsB` set for the glyphs where it would not, and that set holds exactly the 37 combining marks, because the dot centre the centring puts their ink on is 6.5 dots in the 12 dot cell and 4.5 in the 8 dot one, and 4.5 is not two thirds of 6.5. A format character has an entry in `glyphs` and an empty path, and none in `glyphsB`. The box drawing characters are not outlines at all: they are traced out of the cell the painter renders, with the stretch to the edges applied, by `src/svg/trace.js`, which merges the runs of black dots of a bitmap into rectangles, and they are stored per cell size, 12x24, 9x17 and 9x24, in whole dots. Nothing in `src/` imports the file yet; the SVG entry will. The format is documented in the generate tool next to the packed font format.

Coverage is 994 code points of the 1326 the tables hold: 701 drawn from Iosevka, 76 from Sarasa, 51 from Noto Sans Hebrew, 86 from Noto Sans Thai, 75 on the dot grid, 4 empty cells for the format characters of the set, and the fallback glyph. Iosevka covers 779 of the set on its own, which is more than it contributes, because the 75 box drawing characters it has are drawn on the dot grid, the two joiners are drawn as an empty cell and U+FFFD is glyph 0, the fallback; the Thai source covers 87 and contributes 86, because the baht sign is one Iosevka has. Latin, Greek, Cyrillic, the symbol tail of cp437, both katakana codepages, the twelve kanji and the postal mark of Epson's table, and every Hebrew and Thai codepage of either printer family are complete in both sizes. The 332 that are left are Arabic 163 and Khmer 103, and 66 that no printer prints: 63 control codes and three private use code points. They are drawn as the fallback glyph, U+FFFD of the first source that has it, a question mark in a diamond. A glyph in the 12x24 font is 48 bytes, so the two fonts together are 106 kB of source. The packed format is documented in the generate tool so that other fonts can be converted.

### Codepage mappings

The encoder translates a codepage name to a codepage number through a vendor specific mapping. The renderer needs the same tables in the other direction. The encoder does not export them, and the encoder is not changed for this project, so the mapping sources in `data/mappings/esc-pos` and `data/mappings/star-prnt` are copied from the encoder repository and generated the same way. When the encoder exports its mappings some day, the copy goes away.

Decoding a byte is a lookup in the 256 entry codepoint table that `CodepageEncoder.getCodepoints` returns for the codepage.

### Profiles

Small JSON files in `data/profiles` with the defaults per printer family: line spacing, font B cell size, the vertical motion unit, the resolution and the height of the page of page mode. There are two, `epson` with 30 dot line spacing and a 9x17 font B, and `star` with 32 dot line spacing and a 9x24 font B. Each renderer picks its own by default. Drivers do not usually need to touch this.

### PDF417 symbol characters

The 2787 symbol characters of ISO/IEC 15438, three clusters of 929, in `data/pdf417/clusters.txt` as one seventeen bit number per character. They are a table of the specification and cannot be computed, the rest of PDF417 can: the compaction, the length descriptor, the Reed-Solomon check codewords over GF(929), whose generator polynomials are the product of `(x - 3^i)` and are computed the first time a level is used, the row indicators and the start and stop patterns are all in `src/symbologies/pdf417.js`.

The copy of the table was taken from [Barcode Writer in Pure PostScript](https://github.com/bwipp/postscriptbarcode), MIT licensed, and `test/pdf417.js` checks every entry against the structural rules of the specification: seventeen modules, four bars and four spaces of one to six modules, and the cluster of the position it has in the table.

<br>

## Image format helpers

Separate named exports, so that a driver that only needs the items does not pull them in.

| Helper | Output |
|---|---|
| `toImageData(bitmap)` | An `ImageData`, for drawing on a canvas or for further processing. Uses the global constructor in browsers, accepts a constructor option in Node. |
| `toPbm(bitmap)` | A PBM P4 file as a `Uint8Array`. The header is two lines, the body is the bitmap data as is. |
| `toPng(bitmap)` | A PNG file as a `Uint8Array`, 1 bit grayscale. Compression through the platform's `CompressionStream`, so the helper is async and works in browsers and Node 18 and up without a zlib dependency. |
| `stitch(items, options)` | Joins the image items of a stream into one bitmap for previews, expanding feed items to white rows and drawing a dashed line at each cut. |
| `toSvg(layout, options)` | An SVG document of a display list, as a string, from the `/svg` sub-entry. See [SVG output](#svg-output). It is the one helper that takes a list rather than a bitmap, and the one that is not in the main entry. |

<br>

## Testing

- **Fixtures.** Byte streams produced by the encoder's own commands, stored next to the expected PBM image. PBM is plain enough to diff, and a test that fails prints the actual and expected rows as ASCII art in the report.
- **Coverage.** One fixture per encoder feature: every style, sizes, fonts, alignment, tables, boxes, rules, both image modes, every rendered barcode symbology, QR codes at every size and error level, cut and pulse, and the fallbacks.
- **Hardware truth.** A handful of fixtures are checked against real printouts once, on an Epson printer that is available for this, so that the renderer and the encoder cannot share a wrong reading of the specification. Those are marked in the fixture directory.
- **Parity.** Every fixture receipt is encoded in both languages. The two renderings must be identical, except for the known differences in line spacing and font B cell height, which the test normalises by using the same profile for both. This is the main reason to build both renderers together. Where a receipt cannot be identical, because the encoder or the printer makes a difference the renderer has to be faithful to, the fixture is in the exception list at the top of the parity test with its reason.
- **Fixtures from the wild.** Byte streams other open source libraries produced for their own examples and tests, in `test/fixtures/external/<library>/`, kept with a provenance file that names the repository, the file, the commit, the licence, what has to be installed and the exact command that captured them, and with the number of `unknown` items the render had when the fixture was frozen. Every one of them is rendered with the language, the width and the codepage mapping of its provenance and checked three ways: the paper against the golden PBM, the items against `items.json`, and the unknown count against the provenance, so the two files cannot drift apart. The set covers receiptline, python-escpos, escpos-php and ESCPOS_NET; only permissive licences are captured, and the licence text of a library is kept once in its directory. The capture scripts live in `tools/external/<library>/` and none of them runs during `npm test`. `npm run contact-sheet` renders every one of them to a PNG page under `build/`, with the provenance and, for receiptline, its own SVG preview of the same document next to the render, which is what the first golden image of every fixture was reviewed against.
- **Parity in the wild.** receiptline turns one document into ESC/POS, StarPRNT and Star Line Mode, so the parity check above extends to streams this project did not produce: the same document must render the same paper in every language, with the differences receiptline itself makes between the languages in an exception list with their reasons.
- **References.** The one dimensional symbologies are checked against JsBarcode, which encodes the same symbologies to the same modules without a canvas, the QR codes are read back with jsQR, which decodes the rendered paper the way a phone reads it, and the PDF417 symbols are read back with the PDF417 reader of ZXing and compared module for module with the ones bwip-js encodes. All four are dev dependencies of the test suite alone.
- **No canvas.** Nothing in the test suite needs the native canvas module.
- **The builds.** Two checks need a build and are therefore scripts of their own, run before a release: `npm run test:types` compiles the TypeScript smoke test against the bundled declarations, and `npm run test:umd` evaluates the UMD bundle in a context without a module system, the way a script tag loads it, and asserts that the global is the class, that the renderers and the helpers are attached to it and that it renders in all three languages.

<br>

## Driver integration

The contract between a driver and a renderer is deliberately small:

- a constructor taking the options above, including `language`,
- a `render(bytes)` method returning items,
- a `language` getter reporting the language the renderer was constructed for.

Drivers accept the renderer through an option and never import the package. The application passes the class:

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';

const printer = new WebUSBReceiptPrinter({ renderer: ReceiptPrinterRenderer });
```

The option also accepts an async function that returns the class, for applications that want to load the renderer only when a graphics printer is connected. With WebUSB the application cannot know beforehand which printer the user will pick:

```js
const printer = new WebUSBReceiptPrinter({
  renderer: () => import('@point-of-sale/receipt-printer-renderer').then((m) => m.default),
});
```

Rules for drivers:

- The driver constructs the renderer with `language`, `width`, `codepageMapping` and `commands`, all four from the profile of the printer it is connected to. The language is the one the profile's graphics section names, and the codepage mapping is the one that belongs to that language: `epson` for `esc-pos`, `star` for `star-prnt`, `star-line` and `star-graphics`. An optional `rendererOptions` object from the application is merged in, and the driver's own values win on conflict.
- The connected event reports `language` from the renderer instance and `codepageMapping` with the value given to the renderer, so that the application configures the encoder for exactly what the renderer will parse. Moving a printer family from one language to another is a change of one line in its profile, and the connected event follows.
- The connected event also reports `columns`, so applications can configure the encoder without a printer model.
- **Without a renderer nothing fails.** When the device is a graphics printer and no renderer was passed, the driver reports the raw protocol name of the printer, `star-graphics` for the TSP100 family and `meow` for the cat printers, and `print(bytes)` passes the bytes through unchanged. Applications that speak those protocols themselves keep working exactly as they did, and an application that wants text simply passes a renderer. The renderer is an option, never a requirement for connecting.
- The renderer package is declared as an optional peer dependency, so the version range is on record without forcing an install.
- With a renderer, `print(bytes)` becomes: render to items, wrap each item in the printer's format, send.
- The wrapper belongs to the profile, not to the driver. A profile that can render carries a `graphics` section with the language, the width, the supported commands and the name of the wrapper. The wire formats themselves are packages, `@point-of-sale/star-graphics-printer-encoder` for the TSP100 family and `@point-of-sale/meow-printer-encoder` for the cat printers, and a wrapper is the one line that constructs the encoder of a format from the graphics section and calls `encode()`. The driver picks that line from the profile, so it can serve several graphics formats without special cases in its connect and print code. Unlike the renderer, these packages are regular dependencies: they are tiny, they have no dependencies of their own and the driver always needs the wire format of a printer it renders for.

<br>

## WebUSBReceiptPrinter, branch tsp100

A branch of WebUSBReceiptPrinter to experiment with the TSP100 family. Scope is USB, 80 mm paper, and the ESC/POS renderer for the proof of concept. On Windows, futurePRNT claims the USB interface, and users print through the virtual serial port instead. Android apps use the Star SDK. This branch serves macOS, ChromeOS and Linux. A TSP100 over USB is available for testing.

The device database already identifies the graphics models: the Star profile resolves the language to `star-graphics` for the TSP100, TSP100II and TSP100III by product name, and to `star-prnt` for the TSP100IV. That resolution is the trigger.

### Changes on the branch

1. **Constructor option** `renderer`, class or loader, and `rendererOptions`.
2. **Profile.** The Star profile gains a `graphics` section that applies when the language resolves to `star-graphics`: language `esc-pos` for the proof of concept, width 576, commands `['cut', 'pulse', 'feed']`, wrapper `star-raster`.
3. **Open.** When the resolved language is `star-graphics`, load the renderer, construct it from the graphics section with the language it names and the mapping that belongs to that language, and report the renderer's language, that mapping and 48 columns in the connected event. Without a renderer, report the language `star-graphics` and pass the bytes of `print()` through unchanged, which is what an application that builds Star raster itself already expects.
4. **Print.** Render the job, then wrap it with StarGraphicsPrinterEncoder, see the Star raster wrapper below.
5. **Status.** The status bytes the TSP100 sends back are not part of this branch.

### Star raster wrapper

The wrapper is the package [StarGraphicsPrinterEncoder](https://github.com/NielsLeenheer/StarGraphicsPrinterEncoder), `@point-of-sale/star-graphics-printer-encoder`, a regular dependency of the driver. `new StarGraphicsPrinterEncoder({tearBar, quality, pageLength}).encode(items)` returns the whole job as one `Uint8Array`, and the driver takes the options from the graphics section of the profile. What it does is described below, and in more detail in the README of that package.

The commands below come from Star's STAR Graphic Mode Command Specifications, Rev. 2.32, see [Sources](#sources), cross-checked with what Star's CUPS driver `rastertostar` sends. The specification covers every TSP100 model: U, PU, IIU, GT, LAN, IIIW, IIILAN, IIIBI and IIIU. Digits are ASCII characters, `NUL` is `0x00`.

One rule of raster mode shapes the whole wrapper: the mode setting commands, EOT mode, FF mode, page length, quality and the drawer command, are ignored while raster data is in the image buffer. So a cut type cannot be chosen at the moment of the cut. The wrapper looks ahead instead: every command item ends a segment, and the FF mode for that segment is set before the first row of the segment is sent, while the buffer is still empty.

Job start, buffer empty:

| Bytes | Meaning |
|---|---|
| `ESC * r R` `ESC * r A` | Initialize raster mode, enter raster mode. Entering also clears the buffer and resets the modes. |
| `ESC * r Q 0 NUL` | Print quality, `0` is high speed, the default. |
| `ESC * r P 0 NUL` | Page length `0`, continuous. The maximum is 64000 dots, 32000 on the TSP100IIU, longer output flows over into a next page. |
| `ESC * r E 1 NUL` | EOT mode `1`: print, no feed, no cut. The end of the job never cuts by itself. |
| `ESC BEL n1 n2` | Drawer pulse width, `n1` on time and `n2` off time in units of 10 ms, 1 to 127. Set once from the first pulse item, or left at the printer default of 200 ms. This setting survives a reset. |

Modes for the FF mode and EOT mode commands, from the specification:

| n | Print | Feed to the cutter | Cut |
|---|---|---|---|
| `1` | yes | no | no |
| `2` | yes | yes | no |
| `3` | yes | tear bar position | no, tear bar models |
| `9` | yes | yes | full |
| `13` | yes | yes | partial |

Segments and items:

| Item | Bytes |
|---|---|
| start of a segment | `ESC * r F n NUL` with `n` from the command that ends the segment: `13` for a partial cut, `9` for a full cut, `1` for a pulse or the end of the job. |
| image | One `b n1 n2 d..` command per row, `n1 + n2 * 256` bytes of row data, at most 72 on 576 dots. The printer feeds one dot row after each command. Trailing white bytes are trimmed, an all white row is sent as one zero byte. Row bits are most significant bit first, 1 is black, the same as the renderer's format. |
| feed | `ESC * r Y n NUL`, with `n` the number of dot rows as ASCII decimal digits. Moves the position without sending rows, so the profile supports `feed` and the renderer's feed threshold can be low. |
| cut | `ESC FF NUL`. Executes the FF mode set at the start of the segment, which prints the buffer, feeds and cuts. The buffer is empty afterwards. |
| pulse | `ESC FF NUL` if the segment has rows, which prints them without a cut because its FF mode is `1`, then `ESC * r D n NUL` with `n` `1` for drawer 1, `2` for drawer 2. This is the raster mode drawer command and it is ignored while data is in the buffer, hence the print first. |

Job end: `ESC FF EOT`, which executes the EOT mode and prints whatever is left without cutting, then `ESC * r B` to quit raster mode.

The line mode drawer commands `BEL` and `SUB` are also listed as valid in raster mode, but `ESC * r D` is the command the specification provides for exactly this case, so the wrapper uses that. The only thing left to confirm on the printer is that the print before a drawer pulse behaves as described, since the CUPS driver never sends a pulse inside raster mode.

Once the branch is verified, the same change moves to NetworkReceiptPrinter for the LAN and WLAN models.

<br>

## WebBluetoothReceiptPrinter, branch meow

A branch of WebBluetoothReceiptPrinter to add rendering for the cat printers. The driver already has a cat printer profile that reports the language `meow` and passes bytes through unchanged, which requires the application to build the packets itself. On this branch the profile can render as well: applications encode ESC/POS as usual, the driver renders and packs, and an application that passes no renderer keeps the passthrough it has today. CapacitorBluetoothReceiptPrinter carries the same profile and can follow later with the same wrapper.

### Devices

Models GB01, GB02, GB03, GT01, MX05, MX06 and similar. Print head 384 dots wide. Bluetooth Low Energy with one service and two characteristics, as in the existing profile:

| Function | UUID |
|---|---|
| service | `0000ae30-0000-1000-8000-00805f9b34fb` |
| write | `0000ae01-0000-1000-8000-00805f9b34fb` |
| notify | `0000ae02-0000-1000-8000-00805f9b34fb` |

The MXW01 and newer models use a different protocol and are out of scope.

### Changes on the branch

1. **Constructor option** `renderer`, class or loader, and `rendererOptions`, the same contract as the USB driver.
2. **Profile.** The cat printer profile gains a `graphics` section: language `esc-pos`, width 384, commands `['feed']`, wrapper `meow`, and a `maxHeight` that keeps a single render call from allocating large images, 256 rows is a reasonable start. The existing `messageSize` and `sleepAfterCommand` stay, they pace the packets.
3. **Open.** When the profile has a `graphics` section and a renderer was passed, construct the renderer from it with the language it names and the mapping that belongs to that language, `epson` for the ESC/POS renderer planned for these printers, and report the renderer's language, that mapping and 32 columns in the connected event. Without a renderer, the profile keeps the behaviour it has today: it reports the language `meow` and passes the bytes of `print()` through unchanged, so applications that build the packets themselves keep working and the branch stays a minor version of the driver.
4. **Print.** Render the job, then wrap it with MeowPrinterEncoder, one packet per queue entry.
5. **Notifications.** The notify characteristic is subscribed during open, so the wrapper can use status notifications for flow control.

### Protocol

The wrapper is the package [MeowPrinterEncoder](https://github.com/NielsLeenheer/MeowPrinterEncoder), `@point-of-sale/meow-printer-encoder`, a regular dependency of the driver. `new MeowPrinterEncoder({width, energy, speed, feed, compress}).encode(items)` returns the job as a list of packets, one per element, and the driver takes the options from the graphics section of the profile. The package also exports the flow control packets and the matchers `isPause()` and `isResume()` the driver uses on its notifications, and the pieces of the protocol on their own, `packet()`, `crc8()`, `reverseBits()` and `encodeRow()`. Batching the packets into writes and honouring the pause stays in the driver.

The protocol is not published by the manufacturers. The details below are taken from NaitLee's Cat-Printer project, whose `printer_lib/commander.py` is the reference implementation, and from rbaron's catprinter for the run length encoded rows, and are to be confirmed on a GB and a GT model, which are available.

Packet framing, one command per packet:

```
51 78  cmd  00  lenL lenH  payload...  crc8  FF
```

The CRC8 is computed over the payload only, with the standard 256 entry table for polynomial 0x07 and initial value 0.

Commands and payloads:

| Command | Payload | Use |
|---|---|---|
| `A3` | `00` | get device state, also used as the start of a print |
| `A8` | `00` | get device info |
| `A9` | `00` | update device |
| `A4` | `32` | set dpi to 200 |
| `BD` | one byte | speed |
| `AF` | two bytes, little endian | energy, the darkness, up to `0xFFFF` |
| `BE` | `01` | apply energy |
| `A6` | `AA 55 17 38 44 5F 5F 5F 44 38 2C` | lattice start, begin a print |
| `A2` | 48 bytes | one bitmap row of 384 dots |
| `A1` | two bytes, little endian | feed by that many dot rows |
| `A0` | two bytes, little endian | retract by that many dot rows |
| `A6` | `AA 55 17 00 00 00 00 00 00 00 17` | lattice end, finish a print |

Row bytes are bit reversed before sending: the reference implementation swaps bit pairs and then nibbles, which is a full reversal, so the printer takes the least significant bit as the leftmost dot. The renderer's rows are most significant bit first, the wrapper reverses each byte with a 256 entry table.

A print job is: get device state, set dpi, set speed, set energy, apply energy, update device, lattice start, then rows and feeds, then lattice end and a final feed so the paper leaves the head.

### Flow control

Bluetooth Low Energy writes are small and the printer buffer is small. The reference implementation writes at most 200 bytes per write and sleeps 20 ms between writes, the existing profile uses 200 bytes and 30 ms, which is a starting point. The printer sends flow control packets on the notify characteristic: `51 78 AE 01 01 00 10 70 FF` means pause and `51 78 AE 01 01 00 00 00 FF` means resume, which are `MeowPrinterEncoder.PAUSE` and `MeowPrinterEncoder.RESUME` with `isPause()` and `isResume()` to recognise them. The wrapper stops sending on pause and continues on resume, polling every 200 ms as the reference does. The driver's existing queue sends one packet per write. `feed` items are essential here, because sending white rows over this link is slow.

### Fallbacks

The printer has no cutter and no drawer. `cut` is not in the supported commands, so the renderer drops it, and the wrapper adds a feed at the end of the job instead. `pulse` is dropped by the renderer.

<br>

## NetworkReceiptPrinter

The TSP100LAN, TSP143IIILAN and TSP143IIIW speak the same raster protocol over a socket, with no driver in between. After the USB branch is verified, NetworkReceiptPrinter gets the same `renderer` option and the same wrapper, which since the extraction is literally the same code: both drivers depend on `@point-of-sale/star-graphics-printer-encoder` instead of keeping a copy of the wrapper each. The socket carries no device identity, so the application passes the model, and the driver uses that to decide whether to render. No LAN or WLAN model is available for testing, so this follow-up waits until one is, or ships untested with a note.

<br>

## Roadmap

1. **Renderer, text.** Both parsers for the text and style commands, painter, packed font, PBM helper, golden-image tests on encoder output in both languages and the parity test. Result: receipts with text, tables, boxes and rules render correctly.
2. **Renderer, blocks.** All image modes, QR codes through lean-qr, the one-dimensional barcodes, cut and pulse, the fallback table, `maxHeight` and feed items. ImageData and PNG helpers. First release of the package.
3. **WebUSBReceiptPrinter, branch tsp100.** Option contract, raster wrapper, verified on a TSP100.
4. **WebBluetoothReceiptPrinter, branch meow.** Option contract, profile graphics section, cat printer wrapper, verified on a GB and a GT model.
5. **NetworkReceiptPrinter.** Same option and wrapper as the USB branch.
6. **PDF417.** The complete symbology in this package, in both languages, read back with a barcode reader in the tests.
7. **GS1 DataBar.** Omnidirectional, Truncated, Limited and Expanded in this package, in both languages, compared with a second encoder and read back with a barcode reader in the tests.
8. **Later.** The TSP100 profile moves to the StarPRNT renderer, a UTF-8 mode in the encoder for Unicode text on graphics printers, the stacked and composite forms of GS1 DataBar if there is demand, fonts for non-Latin codepages, incremental `write` and `end`.

<br>

## Open questions

Settled on 2026-09-11:

- Font B uses Epson's 9x17 cell for ESC/POS and Star's 9x24 cell for StarPRNT, through the profiles.
- Italic is ignored, as hardware does.
- The built-in font is Iosevka Medium with a subset of Sarasa Mono J SemiBold behind it for the half width katakana, rasterized from their outline fonts at build time.
- A cat printer without a renderer throws, like the TSP100.
- The 58 mm paper guide of the TSP100 is not supported.
- Codepage mapping follows the renderer language, `epson` or `star`.
- Both renderers are built together.
- The TSP100 raster wrapper is taken from Star's CUPS driver, including a vertical feed command, so `feed` is supported there.
- Hardware for verification: a TSP100 over USB, cat printers of the GB and GT series, and an Epson printer for the golden images. No LAN or WLAN TSP100.

- Verified on paper on 2026-09-12 with a TSP143IIIU over USB through the local playground: text, table, rule, barcode, QR code, cut and drawer all print as intended with the ESC/POS renderer and the Star raster wrapper.
- The TSP100 drawer is driven inside raster mode with `ESC * r D n NUL`, after printing the pending rows. The specification also revealed that mode commands are ignored while data is buffered, which the wrapper handles by setting the FF mode per segment.

Still open:

- Verified on paper on 2026-09-13 with an Epson printer through the contact sheet's Print buttons: the receiptline text-decoration document, mixed sizes, underline, invert and a bordered table, matches the render after the baseline correction of the same day. The maintainer's verdict: the renderer is close to the paper, the reference renderers are not.
- Cat printer, partly settled on 2026-09-12 with an MX10 (firmware 1.0.11): it exposes the AE30 service with AE01 as write-without-response only, so the driver writes without response when the characteristic demands it; it does not advertise AE30, so the profile also accepts the known model names in the picker; it answers the state and info requests and sends the resume packet after every job, no pause was seen on a 64-row job. Verified on paper on 2026-09-12 with the MX10 through the playground: text, tables, images and barcodes print as intended, with run length encoded rows, 200 byte writes at 20 ms and a 30 second resume timeout; a shorter timeout corrupted dense barcode areas because the printer stays paused while it prints its backlog. Still open: the energy and speed values that give the best output.

<br>

## Sources

- Star Micronics, [STAR Graphic Mode Command Specifications Rev. 2.32](https://starmicronics.com/support/Mannualfolder/star_graphic_cm_en.pdf), the raster mode command reference for the TSP100 family. The specification is Star's document and is not part of this repository.
- Star Micronics CUPS driver source, [rastertostar.c](https://github.com/drobban/starcupsdrv/blob/master/src/rastertostar.c), the byte sequences in the Star raster wrapper.
- NaitLee, [Cat-Printer](https://github.com/NaitLee/Cat-Printer), `printer_lib/commander.py` and `printer.py`, the cat printer protocol, CRC, bit order and flow control.
- rbaron, [catprinter](https://github.com/rbaron/catprinter), `catprinter/cmds.py`, the run length encoded rows of the cat printers.
- Star Micronics, [How to change the emulation on Star TSP100 series printers](https://starmicronics.com/help-center/knowledge-base/how-to-change-the-emulation-on-star-tsp100-series-printers/), the virtual serial port emulation on Windows.
- Renzhi Li, [Iosevka](https://github.com/be5invis/Iosevka) and [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic), the outline fonts the bitmap fonts are rasterized from.
- Frederik De Bleser and others, [opentype.js](https://github.com/opentypejs/opentype.js), which parses and writes the outline font at build time.
- David Evans, [lean-qr](https://github.com/davidje13/lean-qr), the QR code generator.
