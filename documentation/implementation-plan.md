# Implementation plan

Date: 2026-09-11
Companion to [design.md](design.md). The design document says what is built and why, this document says in which order, by whom, and how each step is accepted.

## Working method

Each section below is implemented by one agent, checked for bugs by a second agent with fresh eyes, then reviewed by the orchestrator, who either accepts the section or returns it with concrete fix instructions. A section is committed only after acceptance. Nothing is pushed.

Rules that apply to every section:

- Follow [design.md](design.md). When the design is silent, choose the simplest option that keeps the design's contracts, and write the choice down in the section's notes below.
- Code style is the encoder's: ES modules, Google eslint config, 2 space indent, JSDoc on every public method, private fields with `#`. `npm test` runs lint and mocha and must pass.
- No new runtime dependencies beyond `@point-of-sale/codepage-encoder` and `lean-qr`. Dev dependencies as needed.
- Tests do not need canvas or any native module.
- Every public type is documented with JSDoc typedefs so the bundled declarations are complete.

## Contracts that every section relies on

Bitmap:

```js
{ width: number, height: number, data: Uint8Array }   // 1 bit per pixel, MSB first, rows padded to bytes, 1 = black
```

Render items, see design.md, Output contract:

```js
{ type: 'image', width, height, data }
{ type: 'cut', value: 'full' | 'partial' }
{ type: 'pulse', device: 0 | 1, on: ms, off: ms }
{ type: 'feed', height }
{ type: 'unknown', data: Uint8Array }
```

Renderer classes:

```js
class EscPosRenderer {
  static language = 'esc-pos';
  constructor(options)          // see design.md, Renderer options
  render(bytes) → RenderItem[]  // bytes: Uint8Array or number[]
}
class StarPrntRenderer   // same, language 'star-prnt'
```

Painter interface, internal, used by both parsers:

```js
painter.text(string)                       // append cells in the current style, wraps at the print width
painter.style({ bold, underline, invert, width, height })   // partial updates, underline is 0, 1 or 2
painter.font('A' | 'B')
painter.align('left' | 'center' | 'right')
painter.lineFeed()                         // commit the line, advance by max(line spacing, tallest cell)
painter.lineSpacing(dots)                  // null restores the profile default
painter.strip(bitmap)                      // an inline block in the current line, for column images
painter.block(bitmap)                      // commit the pending line, then a block aligned on its own line
painter.barcode({ symbology, data, moduleWidth, height, hri })
painter.qrcode({ data, moduleSize, errorLevel })
painter.command(item)                      // cut, pulse, unknown: flush per the design, then emit or fall back
painter.reset()                            // initialize
painter.end() → RenderItem[]               // discard the unfinished line, flush, return the items, reset
```

## Section 1: bootstrap, font and bitmap

Deliverables:

- `npm install` with the dev dependencies of the encoder minus canvas, plus `@point-of-sale/receipt-printer-encoder` as a dev dependency for fixtures. A `.mocharc` if needed.
- Spleen 12x24 and 8x16 BDF sources in `data/fonts` with the Spleen licence file. Fetch the release tarball from the Spleen GitHub releases.
- `tools/generate.js` packs the fonts into `generated/fonts.js`. Only glyphs for code points that occur in any codepage table of the codepage encoder are included, plus U+FFFD as the fallback glyph if Spleen has it, otherwise a generated hollow box. Store each font as a base64 string of glyph rows plus an index from code point to glyph number, so the generated file stays small. Document the packed format in the tool.
- `src/bitmap.js`: create, get and set pixel, blit a bitmap into another at an offset with OR, extract rows, pack from an array of row bitmasks, split into chunks of a maximum height, trim trailing white bytes of a row.
- `src/font.js`: load a packed font, look up a glyph by code point with the fallback, render a glyph into a cell of a given width and height with integer scaling, bold overstrike, underline thickness and invert.
- `src/formats/pbm.js` and `src/formats/image-data.js`.
- Tests: bitmap operations, font lookup and fallback, one glyph rendered and compared with ASCII art, PBM header and body.

Acceptance:

- `npm test` passes, `npm run generate` regenerates the fonts deterministically.
- `generated/fonts.js` is under 200 kB.
- A test prints the letter A from the 12x24 font as ASCII art and it looks like an A.

## Section 2: painter and ESC/POS text

Deliverables:

- `src/painter.js` per the interface above and the design's Painter section: cells, line height, alignment at commit, wrapping, blank row tracking, feed items, `maxHeight` splitting, the fallback table for unsupported commands, and `end()`.
- `src/renderers/esc-pos.js`: table driven parser for the text, control and style commands in the design's ESC/POS table. Blocks are parsed and skipped in this section with a TODO, so that the stream stays in sync. Unknown commands are skipped by the argument lengths of the ESC/POS specification and produce `unknown` items when supported.
- Codepage decoding through the generated mapping and `CodepageEncoder.getCodepoints`.
- `src/receipt-printer-renderer.js` exports `EscPosRenderer`, `toPbm`, `toImageData`.
- Fixtures: `test/fixtures/esc-pos/<name>.bin` and `<name>.pbm`, produced by a script `test/tools/make-fixtures.js` that runs the encoder. Fixture names: text, styles, sizes, fonts, alignment, table, box, rule, wrap, codepages, cut, pulse, feed. The expected PBM files are generated once by the renderer and then reviewed by eye as ASCII art, after which they are golden.
- A test helper that renders a bitmap as ASCII art and shows a diff on failure.

Acceptance:

- All fixtures render and match.
- The ASCII art of the table and box fixtures shows straight column edges and closed boxes.
- A stream with an unknown command still renders the text after it.
- Cut and pulse items appear where the encoder put them, and disappear when not in `commands`.

## Section 3: StarPRNT and parity

Deliverables:

- `src/renderers/star-prnt.js` per the design's StarPRNT table, text and styles, blocks skipped as in section 2.
- The `star` profile in use, 32 dot line spacing and 9x24 font B.
- Export `StarPrntRenderer`.
- Fixtures for `star-prnt` as in section 2, produced from the same receipts.
- Parity test: for every fixture receipt, render the ESC/POS and the StarPRNT bytes with the same profile and compare the bitmaps.

Acceptance:

- Parity holds for every fixture. Where it cannot, the notes explain the reason and the test lists the exception explicitly.

## Section 4: blocks

Deliverables:

- ESC/POS column images `ESC *` with `ESC 3` line spacing, raster images `GS v 0`, Star column images `ESC X`.
- QR codes through lean-qr in both parsers, with model, module size and error level.
- One-dimensional barcodes in `src/symbologies`: UPC-A, UPC-E, EAN-13, EAN-8, Code 39, ITF, Codabar, Code 93, Code 128 with the encoder's set selection, GS1-128 and Code 128 auto. Check digit handling as the design describes. HRI text under the bars in font B.
- PDF417 and GS1 DataBar parsed and reported as `unknown`.
- `src/formats/png.js` with CompressionStream and `stitch(items, options)`.
- Fixtures: image-column, image-raster, qrcode, each barcode symbology, hri, and a full receipt combining everything.

Acceptance:

- A QR fixture decodes with a QR reader library in the test, or the matrix matches lean-qr's own output exactly.
- Barcode fixtures are checked against a reference encoder in the test where one exists in the dev dependencies, otherwise against hand-verified patterns for a short value.
- The full receipt renders in both languages with parity.

## Section 5: build, types and documentation

Deliverables:

- `npm run build` produces the four bundles and the declaration file, the declarations name every export and typedef.
- `documentation/usage.md` in the style of the encoder's documentation: installation, constructing a renderer, the item stream, the helpers, and a preview example.
- README updated to link the documentation.
- `examples/preview.html` that loads the UMD build, encodes a receipt with the encoder from a CDN, renders it and shows it on a canvas.

Acceptance:

- The build runs clean, the example works in a browser according to the implementer's own check, and the declaration file compiles in a TypeScript smoke test.

## Section 6: WebUSBReceiptPrinter, branch tsp100

The repository is cloned into `/Users/salonhub/Projects/Dependencies/WebUSBReceiptPrinter` from GitHub, and the work happens on a branch `tsp100`.

Deliverables, per design.md:

- Constructor options `renderer` and `rendererOptions`.
- `graphics` section on the Star profile for the `star-graphics` language: width 576, commands cut, pulse and feed, wrapper `star-raster`.
- `src/wrappers/star-raster.js` implementing the wrapper exactly as the design's Star raster wrapper section specifies, with the segment lookahead.
- Connected event with the renderer's language, its mapping and columns. Throw without a renderer on a graphics printer.
- `print` renders and wraps for graphics printers, unchanged for others.
- Optional peer dependency on the renderer package.
- Tests for the wrapper: given an item list, the exact byte sequence. The driver repository has no test setup, add mocha.
- README section on the TSP100 and the renderer option.

Acceptance:

- Wrapper tests cover: one image then a partial cut, image then pulse then image then full cut, feed items, an all white row, an image ending without a cut. Byte sequences are checked by the orchestrator against the specification.

## Section 7: WebBluetoothReceiptPrinter, branch meow

Work on a branch `meow` in the existing checkout.

Deliverables, per design.md:

- Same option contract as section 6.
- `graphics` section on the cat printer profile, wrapper `meow`, `maxHeight` 256.
- `src/wrappers/meow.js`: packet builder with CRC8, the job sequence, row bit reversal, feed for feed items and at the end, and pause and resume handling from the notify characteristic.
- Passthrough for the `meow` language removed, connect throws without a renderer. Major version bump.
- Tests for the packet builder and the job sequence.
- README section.

Acceptance:

- Packet tests match the byte layouts in the design, including CRC values checked by hand for one packet.

## Section 8: NetworkReceiptPrinter

- Same option contract, plus a `model` or `language` option since the socket has no identity. The Star raster wrapper copied from section 6.
- README section noting that this is untested on hardware.

## Section 9: the built in font

The font of sections 1 to 8 is Spleen, a bitmap family with a Latin coverage. This section replaces it with Iosevka Medium, rasterized from its outline font when the package is built, so that the renderer covers Greek and Cyrillic as well and font A fills its cell.

Deliverables:

- `tools/subset-font.js` cuts the `Iosevka-Medium.ttf` of the Iosevka release down to the code points the renderer can print and writes `data/fonts/iosevka-medium-subset.ttf`, with the licence next to it and the release version in `data/fonts/README.md`. The Spleen sources and their licence go away.
- `tools/generate.js` rasterizes that subset into the two packed fonts instead of packing BDF glyphs, by the advance width of the face, with the box drawing characters drawn on the dot grid. The packed format does not change, so `src/font.js` does not change either.
- `opentype.js` is a dev dependency: it is used at generate time only and the published package does not depend on it.
- All golden PBM fixtures are regenerated in both languages and reviewed as ASCII art. The `.bin` files do not change.
- The tests that hold the shape of a glyph are updated, and `documentation/design.md`, the README and `documentation/usage.md` say what the font is.

Acceptance:

- `npm test` passes, `npm run build` is clean, `npm run test:types` passes.
- `npm run generate` is deterministic and `generated/fonts.js` stays under 200 kB.
- Only `.pbm` fixtures change, apart from the feed heights that move with the depth of the ink.
- The letter A, a box corner and the full receipt are reviewed by eye.

## Section 10: the unified renderer

The package exported a renderer class per language and nothing else, so an application that encodes with `language: 'star-prnt'` had to know which class belongs to that string, and the UMD global was an object of names instead of a class. This section adds `ReceiptPrinterRenderer`, which takes the language as an option and delegates, mirroring ReceiptPrinterEncoder.

Deliverables:

- `ReceiptPrinterRenderer` in `src/receipt-printer-renderer.js`: the options of a renderer plus `language`, one of `esc-pos`, `star-prnt` and `star-line`, defaulting to `esc-pos`, an unknown one throwing. `static get languages()`, a `language` getter that reports the language it was asked for, a `columns` getter and `render(bytes)`, which delegates. Both Star languages are rendered by `StarPrntRenderer`.
- The export shape: the class as the default and as a named export, the two renderers and the four helpers as named exports, and the same six as static properties of the class. A UMD entry, `src/umd.js`, exporting the class alone, so that the UMD global is the class.
- Tests for the unified class, the TypeScript smoke test extended, and `npm run test:umd`, which loads the UMD bundle the way a script tag does.
- `documentation/usage.md`, the README and the design document follow: the unified class is the primary way, the renderers of one language are secondary, and the Driver integration section describes the new contract, including passthrough for a driver without a renderer.

Acceptance:

- `npm test` passes, `npm run build` is clean, `npm run test:types` and `npm run test:umd` pass.
- The existing renderers, their options and their static `language` property are unchanged.
- Version 0.2.0.

## Section 11: PDF417

The renderers parsed the PDF417 commands of both languages and reported the
print command as an `unknown` item. This section renders the symbology.

Deliverables:

- `src/symbologies/pdf417.js`: the complete symbology of ISO/IEC 15438. The
  three compaction modes with automatic mode selection, Reed-Solomon check
  codewords for levels 0 to 8 over GF(929), the length descriptor and the
  padding, the columns and rows, the row indicators, and the symbol characters
  of the three clusters. `encode(data, options)` returns the modules of the
  symbol, or null when the data does not fit.
- The symbol characters in `data/pdf417/clusters.txt`, packed into
  `generated/pdf417.js` by `tools/generate.js`.
- The parameters, the data and the print command in both parsers, and
  `painter.pdf417()`, which draws the symbol as a block, aligned.
- `test/pdf417.js`: the symbols are read back with the PDF417 reader of ZXing
  and compared module for module with bwip-js, both new dev dependencies.
- Fixtures `pdf417` and `pdf417-truncated` in both languages, the parity test
  extended, and the design document, the usage document and the README follow.

Acceptance:

- `npm test` passes, `npm run build` is clean, `npm run test:types` passes.
- Every data set decodes back to what was encoded, at several error correction
  levels, fixed and automatic sizes, and in the truncated form.
- Version 0.3.0.

## Sections 12 to 14: beyond the encoder's subset

The renderers cover exactly the commands ReceiptPrinterEncoder emits. Other producers, the Epson and Star SDKs, the Python and Node ESC/POS libraries and hand written POS software, use a wider set. These three sections add the most common of those commands, in the order of how often they occur on real receipts. Each section runs through the working method above: implementation, bug-check, orchestrator review, commit.

Rules that apply to all three:

- The encoder cannot produce these commands, so the fixtures are hand assembled byte streams in `test/tools/make-fixtures.js`, one per command group, in both languages where the command exists in both. Expected images are reviewed as ASCII art before they are frozen, as always.
- Every new command gets a row in the tables of design.md, with the same "Rendering" column. Commands that stay unrendered keep their `unknown` behaviour and are listed as such.
- Parsing must stay in sync for every command, rendered or not. A command added here must have its argument length verified against the Epson ESC/POS or Star specification, and a test for the truncated stream.
- No new runtime dependencies.

### Painter additions

The painter interface gains, in Section 12:

```js
painter.position(dots)                     // absolute position from the left margin, for HT, ESC $ and ESC \
painter.margins({ left, width })           // left margin and print area width in dots, applied at the next line start
painter.spacing(dots)                      // extra dots after every cell, scaled with the width multiplier
painter.tabs([columns])                    // tab stops in character widths of the current font, [] cancels them, null restores every 8
painter.style({ upperline, upsideDown })   // upperline is 0, 1 or 2 like underline; upsideDown rotates committed lines by 180 degrees
painter.placeholder(cells)                 // a fallback glyph cell repeated, for multibyte text without a font
```

In Section 13:

```js
painter.define(key, bitmap)                // keep an image for later, keys are strings such as 'nv-bit-image:3' or 'nv:65:66', null deletes one
painter.forget(prefix)                     // delete every image whose key starts with the prefix, for the delete all functions
painter.print(key, { scale }) → boolean    // draw a kept image as a block, nothing at all when the key is absent, which the parser reports
```

<br>

## Section 12: text layout commands

Deliverables, ESC/POS:

- `ESC ! n` print mode: bit 0 font B, bit 3 bold, bit 4 double height, bit 5 double width, bit 7 underline. Sets the same painter state as the individual commands; a later `GS !` overrides the size.
- `ESC G n` double strike, rendered as bold. `ESC i` and `ESC m`, the legacy full and partial cuts.
- `ESC R n` international character set: the twelve code points 0x23, 0x24, 0x40, 0x5B, 0x5C, 0x5D, 0x5E, 0x60, 0x7B, 0x7C, 0x7D, 0x7E are replaced per set, table from the Epson specification for sets 0 to 17. Applied after codepage decoding, only for those twelve bytes.
- `ESC { n` upside-down printing: every committed line box, blocks included, is rotated by 180 degrees. Feed order is unchanged.
- `ESC SP n` right side character spacing, in horizontal motion units, multiplied by the width multiplier. Lines wrap by dots, which they already do.
- `HT` and `ESC D n1..nk NUL` tab stops: positions in character widths of the current font, default every eight characters, at most 32 stops, `ESC D NUL` clears them. A tab past the last stop is ignored, as on the printer.
- `ESC $ nL nH` absolute and `ESC \ nL nH` relative print position, in horizontal motion units. The horizontal unit follows `GS P x`, one dot by default, `dpi / x` dots when set. A position beyond the print width is ignored.
- `GS L nL nH` left margin and `GS W nL nH` print area width, in horizontal motion units, applied at the start of the next line. Alignment and centring work inside the print area. A width that exceeds the paper is clamped.
- Multibyte text: `FS &` and `FS .` switch Kanji mode, `FS C n` selects the code system (Shift JIS or JIS, and UTF-8 on the models that have it), `FS !`, `FS -`, `FS S` and `FS W` are parsed. In Kanji mode a lead byte and its trail byte are consumed as one character and drawn as a double width placeholder cell, so the layout stays right without a CJK font. UTF-8 with `FS C` is decoded properly and drawn from the built in font, with the placeholder for characters the font lacks.
- `DLE EOT n`, `DLE ENQ n` and `DLE DC4 fn ...` real time commands with their exact lengths, skipped.

Deliverables, StarPRNT and Star Line:

- `ESC W n` double width and `ESC h n` double height, `ESC i` unchanged. `ESC _ n` upperline, drawn along the top rows of the cell like underline along the bottom.
- `ESC l n` left margin and `ESC Q n` right margin, in characters of the current font.
- `ESC R n` international character set, Star's table, and `ESC SP n`... only if Star defines character spacing, check the Star Line specification and document the result.
- The Star raster mode as a renderable input: `ESC * r A` and `ESC * r R` reset a raster state, `b n1 n2 data` is one row with a feed, `k n1 n2 data` a row without, `ESC * r Y n NUL` feeds n rows, `ESC * r E n NUL` and `ESC * r F n NUL` store the modes, `ESC FF NUL` and `ESC FF EOT` flush and, when the stored mode cuts, emit a cut item, `ESC * r D n NUL` emits a pulse item, `ESC * r P`, `Q`, `T`, `m l`, `m r`, `K` are parsed and stored, `ESC * r B` leaves raster mode. With this the renderer reproduces what a TSP100 prints from the USB driver's wrapper.
- Buzzer commands `ESC GS BEL`, `ESC GS EM DC1` and `DC2` parsed and reported as `unknown`.

Fixtures: print-mode, international, upside-down, spacing, tabs, positions, margins, multibyte, star-raster, in the languages that have them. Parity for the commands that exist in both languages: double width and height, margins, international sets where the tables agree.

Acceptance:

- A receipt laid out with tabs and absolute positions, as the Python ESC/POS library writes it, renders with straight columns.
- `ESC ! n` and the individual commands render identically for the same state.
- The upside-down fixture is the normal fixture rotated by 180 degrees line by line, checked in the test by rotating the bitmap.
- A hand assembled Star raster job with a cut and a drawer pulse renders to the same paper and items as the receipt it was made from.
- The bug-check verifies every argument length against the specifications and the truncated stream behaviour of every new command.

<br>

## Section 13: image commands

Deliverables, ESC/POS:

- `GS ( L` and `GS 8 L` graphics: function 112 stores raster graphics in the print buffer with the `bx` and `by` scaling and the colour parameter, function 113 stores column format graphics, function 50 prints the buffer as a block aligned per the current alignment. Functions 67 and 69 define and print NV graphics by key code, 83 and 85 define and print download graphics by key code; a definition in the stream is kept by `painter.define` for the rest of the renderer instance, a print of an undefined key produces an `unknown` item and nothing on paper. The transmit and capacity functions 48, 49, 51, 52, 64, 65, 66, 68, 80, 81, 82, 84 are parsed and skipped with their lengths. Function 52 sets the reference dot density and is honoured for scaling when the printer dpi differs.
- `GS * x y data` defines the downloaded bit image, `GS / m` prints it in modes 0 to 3, the same doubling as `GS v 0`.
- `FS q n [xL xH yL yH data]...` defines NV bit images in the stream, `FS p n m` prints one; the same keep and print rules as the graphics functions.
- The `ESC *` and `GS v 0` handling is unchanged.

Deliverables, StarPRNT and Star Line:

- `ESC GS S 1 n1 n2 n3 n4 NUL data`, the StarPRNT raster image command the Star SDKs use, rendered as a block.
- `ESC k n1 n2 data` quadruple density bit image, and any other bit image density Star Line defines, checked against the specification.
- `ESC FS p n m` prints an NV logo, which the printer holds and the renderer cannot draw: an `unknown` item and nothing on paper, like the ESC/POS NV images without a definition.

Fixtures: graphics-raster, graphics-column, graphics-download, graphics-nv, download-bit-image, nv-bit-image, star-raster-image, in the languages that have them. Parity between `GS ( L` function 112 and `GS v 0` for the same pixels, and between the Star raster image and `ESC X`.

Acceptance:

- The same picture sent through `ESC *`, `GS v 0`, `GS ( L` 112 and 113, `GS *` with `GS /`, and `FS q` with `FS p` renders to identical dots.
- Scaling modes and `bx`/`by` match the doubling of `GS v 0`.
- A print of an undefined key or logo leaves the paper untouched and the stream in sync.

<br>

## Section 14: GS1 DataBar

Deliverables:

- `src/symbologies/databar.js`: GS1 DataBar Omnidirectional and Truncated (the 14 digit RSS-14 encoding with its check digit, 96 modules, truncated at 13 rows), Limited (79 modules, 14 digits with a leading 0 or 1), and Expanded (the general encoding of a GS1 element string with the numeric, alphanumeric and ISO 646 compaction methods and the special methods for the common weight and date element strings, variable width in symbol character pairs). Encoder, ESC/POS symbologies 75 to 78 and the Star equivalents, module width from the existing barcode parameters, height from the barcode height for Omnidirectional and Expanded and fixed for Truncated and Limited as the printers do. Data validation as the printers do it: wrong length or characters print nothing.
- Human readable text below the symbol as for the other barcodes, when the HRI position asks for it.
- Verification: decode rendered symbols with the ZXing readers for RSS-14 and RSS Expanded, and compare module patterns with bwip-js for all four variants, including Expanded with weight and date element strings.

Fixtures: databar-omni, databar-truncated, databar-limited, databar-expanded, in both languages, plus a coupon style receipt combining a DataBar with text. Parity between the languages.

Acceptance:

- Every fixture decodes with ZXing to the original element string, and matches bwip-js module for module.
- The Section 4 barcode tests and the parity test are unchanged.
- The `unknown` items for these symbologies are gone from the design tables.

<br>

## Section 15: the wire formats become packages

The two wrappers of sections 6, 7 and 8 moved out of the drivers into two
standalone libraries, so that the drivers depend on them instead of carrying a
copy each. Nothing in this package changes; the design document records the
reversal in [Decisions](design.md#decisions).

Why: the Star raster wrapper already lived in two repositories at once, as a
file with a notice saying that the two copies must be kept identical, and
CapacitorBluetoothReceiptPrinter carries the cat printer profile and would have
become a third copy of the Meow wrapper. A wire format is not driver specific
either. The naming follows the ecosystem: ReceiptPrinterEncoder encodes for
generic thermal printers, these encode for one specific printer.

Deliverables:

- **MeowPrinterEncoder**, `@point-of-sale/meow-printer-encoder` 1.0.0, scaffolded
  like this package: rollup with UMD, ESM, CJS and MJS builds plus bundled
  declarations from JSDoc through tsc, eslint with the Google config, mocha and
  chai, MIT. Source style of this package, 2 spaces and `#private`, because it
  is a library and not a driver. API: `new MeowPrinterEncoder({width, energy,
  speed, feed, compress})`, `encode(items)` returning one packet per element and
  `encodeImage(bitmap)`, with the protocol itself as statics, `packet()`,
  `crc8()`, `reverseBits()`, `runLengthEncode()`, `encodeRow()`, and the flow
  control packets `PAUSE` and `RESUME` with `isPause()` and `isResume()`, which
  accept the `DataView` the web Bluetooth API delivers. The README documents the
  packet framing, the commands, the run length encoding, the flow control and
  the models, citing Cat-Printer and catprinter as the design document does.
- **StarGraphicsPrinterEncoder**, `@point-of-sale/star-graphics-printer-encoder`
  1.0.0, the same scaffolding. API: `new StarGraphicsPrinterEncoder({tearBar,
  quality, pageLength})`, `encode(items)` returning the whole job as one
  `Uint8Array` and `encodeImage(bitmap)`. The README documents the raster mode
  commands with the mode table, citing Star's specification.
- **The drivers.** WebUSBReceiptPrinter and NetworkReceiptPrinter depend on the
  Star encoder, WebBluetoothReceiptPrinter on the Meow one, all three as regular
  dependencies rather than peer dependencies: they are a few kilobytes with no
  dependencies of their own, and a driver that renders always needs the wire
  format. `src/wrappers/` and its tests are gone from all three; the `Wrappers`
  table now maps the name in the profile to the one line that constructs the
  encoder from the graphics section and calls `encode()`. The Bluetooth driver
  matches its notifications with `MeowPrinterEncoder.isPause()` and
  `isResume()` and dropped its own `#matches()`; the batching and the pacing
  stay in the driver. Each README points at the encoder package where it
  describes the wire format.

Testing:

- The tests moved with the code, byte for byte: the 14 Star raster tests and the
  Meow tests keep their expected bytes exactly as they were, adapted only where
  `wrap(items, options)` became `new Encoder(options).encode(items)`. The width
  check of the Meow wrapper moved from `encode()` to the constructor, so that
  assertion moved with it.
- The driver tests that compared against `wrap()` output import the encoder
  package instead, so they still check the driver against an independent
  implementation of the wire format rather than against a constant.

Acceptance:

- MeowPrinterEncoder `npm test` 55 passing, StarGraphicsPrinterEncoder 16
  passing, `npm run build` clean with a `.d.ts` in both.
- WebUSBReceiptPrinter 8, NetworkReceiptPrinter 14 and
  WebBluetoothReceiptPrinter 34 passing, `npm run build` clean in all three, and
  the encoder code is in the driver bundles: rollup resolves and bundles it the
  way it does the rest of their imports, so nothing external appears in the
  output.
- The playground still builds. Its import map points at the driver bundles, so
  it needs nothing of its own.

<br>

## Sections 16 to 20: fixtures from the wild, a display list and the vector formats

The renderer covers what the encoder emits and the common commands of other producers, and it produces one thing: 1-bit images. These five sections widen both ends. Section 16 checks the renderer against byte streams that other libraries produce, so that the reference pages say which commands are seen in the wild and a regression shows up as a changed picture. Section 17 splits the painter into a layout engine that produces a display list and a bitmap back-end that consumes it, and makes the display list a public output next to the item stream. Sections 18 and 19 add two packages that consume the display list, an SVG writer and a PDF writer. Section 20 adds a package that turns receipt markup, the receiptline language and a Markdown subset, into calls on the encoder, and uses the renderer to check its output against receiptline itself.

The order is 16, then 17, 18, 19, then 20. Each section runs through the working method at the top of this document: an implementer, a bug-check, an orchestrator review with fix rounds, then a commit. The effort estimates are for one implementer with the reviews included.

Rules that apply to all five:

- The item stream, the renderer options and every golden fixture of sections 2 to 14 stay exactly as they are. Section 17 in particular is a refactor with a proof, not a change of output.
- No new runtime dependencies in this package. The three new packages have no runtime dependencies at all, with one exception this block names: the format packages of sections 18 and 19 need the glyph outlines, and where those live is an open decision of section 17. The markup package drives an encoder instance the application constructs, so it does not depend on the encoder either.
- The new packages are scaffolded like MeowPrinterEncoder and StarGraphicsPrinterEncoder: rollup with UMD, ESM, CJS and MJS builds, bundled declarations from JSDoc through tsc, eslint with the Google config, mocha and chai, MIT, 2 space indent and `#private`, a README that opens with the @point-of-sale line and documents the whole public API, and a `test:types` smoke test. Their fixtures follow this repository: golden files reviewed by eye before they are frozen, and a diff on failure.
- Everything that is checked against another implementation, receiptline in 16 and 20, a rasterizer in 18 and a PDF reader in 19, is a dev dependency of the test suite alone.
- Every contract in this block is written down as typedefs in `src/types.js` of the package that owns it before the code that uses it, so that the declarations are complete and the other packages can be written against them.
- The design document follows: an architecture line for the display list, a section for it, and a "Related packages" list that names the three new packages the way it names the two wire format packages today.

<br>

## Section 16: external fixtures, a visual regression suite

The fixtures so far come from ReceiptPrinterEncoder and from hand assembled streams. This section adds byte streams produced by other open source ESC/POS and StarPRNT libraries, kept in the repository with their provenance and rendered to golden images, so that the renderer is checked against what real producers send, the reference pages can say which commands are seen in the wild, and a regression shows up as a changed picture. The first library is receiptline, because one document gives ESC/POS, StarPRNT and Star Line for the same input plus an SVG preview to review against. The second is python-escpos, because it uses the widest set of commands.

Rules:

- Fixtures live in `test/fixtures/external/<library>/<example>.bin` with `<example>.pbm`, `<example>.items.json` and `<example>.json`. The `.pbm` is the paper and the `.items.json` holds the items that are not images, exactly as the other fixtures do. The last file is the provenance, with these fields and no others:

  ```json
  {
    "source": "https://github.com/receiptline/receiptline",
    "file": "example/data/en/receipt.receipt",
    "commit": "0123abcd",
    "licence": "Apache-2.0",
    "command": "node tools/external/receiptline.js receipt escpos 48",
    "version": "4.0.4",
    "language": "esc-pos",
    "columns": 48,
    "width": 576,
    "codepageMapping": "epson",
    "captured": "2026-09-14",
    "unknown": 0,
    "notes": "The example receipt of the README. Reviewed against the SVG preview."
  }
  ```

  `command` is the exact invocation that produced the bytes, so a stream can be captured again when the library changes. `unknown` is the number of `unknown` items the renderer produced for the stream when the fixture was frozen. `language`, `columns`, `width` and `codepageMapping` are what the library assumed, and they are what the renderer is constructed with.
- Only libraries under a permissive licence are captured: MIT, BSD and Apache 2.0. The licence text of a library is kept once, in `test/fixtures/external/<library>/LICENSE`, together with the copyright line of that library. A library under a copyleft licence is not captured at all, not even from its tests.
- The example scripts and documents themselves are not copied. What is stored is the byte stream the library produced and our rendering of it; the provenance links to the input by repository, file and commit.
- A capture script per Node library lives in `tools/external/<library>.js`, with the library as a dev dependency, so the streams can be regenerated. For libraries that need Python, PHP or .NET the capture is documented in `command` and the stream is stored as captured; nothing in `npm test` runs them.
- Every fixture is rendered with the unified renderer using the language, width and mapping of its provenance and `commands: ['cut', 'pulse', 'feed', 'unknown']`. Three checks per fixture: the paper equals the golden PBM, the items equal `items.json`, and the `unknown` count of the provenance equals the number of unknown items in `items.json`, so the two files cannot drift apart. A newly supported command therefore changes the recorded count and is reviewed like a fixture change, and a command that is not supported is visible from the first capture.
- The first golden image of every fixture is reviewed by eye before it is frozen, with the renderer's output next to whatever preview the library offers where it has one. What the review found goes into `notes`.
- `npm run contact-sheet` renders every external fixture to PNG under `build/contact-sheet/` and writes an `index.html` next to them that lists every fixture with its provenance, and for receiptline the SVG preview of the same document next to the render. The page, the PNGs and the SVGs are generated on demand and not committed; `build/` goes into `.gitignore`.
- A stream that prints an NV logo the printer holds, or asks for a status, produces an `unknown` item and nothing on paper, which is the renderer's rule. The fixture keeps it and `notes` says so.

Libraries, in order:

1. **receiptline** (Apache 2.0, Node, 4.0.4 at the time of writing). Its markup language generates ESC/POS, StarPRNT and Star Line for the same document across its command sets, and an SVG preview. The command sets that matter here are `escpos` and `epson`, rendered as `esc-pos` with the `epson` mapping, `generic`, which prints its images with `GS v 0` instead of the graphics group, `starsbcs`, rendered as `star-prnt` with the `star` mapping, `starlinesbcs`, rendered as `star-line`, and `stargraphic`, which is the TSP100 raster mode of section 12 and renders as `star-prnt`. The printer object gives the width: `cpl` 48 is 576 dots and `cpl` 32 is 384, the 80 and 58 mm papers. The documents are the English examples in `example/data/en`, twenty one of them: the receipt of the README, a second receipt, the credit card slips, the guest check, the kitchen ticket, the column width, column border, text wrap, text decoration, line align and line width examples. The Japanese examples are out of scope, the renderer draws CJK as placeholders. The capture script writes the bytes per document, command set and width, and writes the SVG of the same document for the contact sheet. The parity test extends to these: the same document in every language must render the same paper, with the profile normalised as `test/parity.js` does it, and with an exception list where receiptline itself emits different content per language, each entry with its reason.
2. **python-escpos** (MIT, Python). The widest command usage: `ESC !` print modes, tabs and absolute positions, its three image implementations `bitImageRaster`, `bitImageColumn` and `graphics`, codepage switching through its magic encode, barcodes and QR codes. Its `Dummy` printer collects the bytes of a script without a device, so the capture is a throwaway virtual environment, one script per example, the exact commands in the provenance. The examples are the scripts of its `examples` directory that run without hardware or network.
3. **escpos-php** (MIT, PHP). Its example receipts: the demo, the receipt with a logo, the character encodings, the bit image and graphics examples, the barcode and QR code examples. Captured through its `FilePrintConnector` where PHP is available, otherwise from the streams its tests carry.
4. **ESCPOS_NET** (MIT, .NET). Its tests hold literal byte arrays; those are taken as they are, without running anything, and the provenance names the test file and the test.
5. **react-thermal-printer** and **node-escpos** (MIT, Node), for their examples. `render()` of the first returns the bytes; the second needs an adapter that collects them.

Deliverables:

- The directory layout, the provenance format, the capture scripts for the Node libraries and the fixture test in `test/external.js`.
- The receiptline and python-escpos sets captured, reviewed and frozen. The other three libraries follow in the same section when they cost less than a day together, and in a follow-up section otherwise; nothing above changes for that.
- `npm run contact-sheet`.
- A "Seen in the wild" note in `commands-esc-pos.md` and `commands-star-prnt.md` on every command an external fixture exercises, naming the library, so that the pages say which commands are covered by real producers.
- A summary in the notes of this section: per library how many fixtures, how many unknown items in total and which commands they are, as the input for deciding what to support next.

Acceptance:

- At least the receiptline and python-escpos sets are captured, reviewed and frozen, and every fixture passes all three checks.
- The parity test holds over the receiptline fixtures, with its exceptions listed with reasons.
- `npm test` passes without the contact sheet, and the contact sheet builds and shows every external fixture with its provenance.
- No `unknown` count in the provenance disagrees with `items.json`, and the notes say what every unknown item is.
- Version stays 0.3.0.

Effort: 3 to 4 days.

Open decisions:

- **Which receiptline command sets and widths.** The recommendation: all twenty one documents through `escpos` and `starsbcs` at 48 columns, which gives the parity pairs, and a subset of five documents, the two receipts, the guest check, the column border and the text decoration example, through `generic`, `starlinesbcs` and `stargraphic` and at 32 columns. That is 42 plus 40 fixtures. Every document through every set at both widths would be 252, more than an eye review can carry.
- **Which encoding for the receiptline capture.** `cp437` for the English documents, plus one document with `multilingual`, so that the codepage switching is exercised.
- **How many python-escpos examples.** The recommendation: every script of its `examples` directory that runs against the `Dummy` printer without hardware or network, which is about eight, and none of the byte strings of its unit tests, which are single commands rather than receipts.
- **Whether receiptline's SVG previews are committed.** The recommendation: no, they are what the contact sheet regenerates, and `notes` records that the review used them.

<br>

## Section 17: the display list

The painter does two things at once: it lays out cells, lines, blocks and margins, and it rasterizes them into a row buffer, tracks blank rows and cuts image items from it. This section splits the two. A layout engine produces a display list of positioned operations, and back-ends consume it. The bitmap painter becomes the first back-end and must produce byte-identical output: every fixture unchanged. The display list is exposed as a public output next to the item stream, `renderer.layout(bytes)`, and it is what the SVG and PDF packages of sections 18 and 19 consume. The generate step additionally emits the glyph outlines those packages draw text with, kept out of the main bundle.

The parsers do not change. They call the painter interface of this document, and the layout engine implements it.

### The display list

```js
{
  version: 1,
  language: 'esc-pos',
  width: 576,           // the paper in dots
  height: 1412,         // total height in dots, from the first row to the last
  dpi: 203,
  operations: [ ... ]
}
```

Coordinates and units. Everything is in dots, as integers. The origin is the top left corner of the paper, `x` runs to the right from the left edge of the paper and `y` runs down from the first row. Margins, alignment, the print area and the character spacing are already applied: the `x` of an operation is where its ink lands. `dpi` is the resolution of the profile, 203 for both built in profiles, so that a back-end can convert to physical units: one dot is `25.4 / dpi` millimetres and `72 / dpi` points. `height` is the height of the paper as `stitch()` would produce it, the feeds included.

Operations:

| Type | Fields | Meaning |
|---|---|---|
| `line` | `y`, `height` | The start of a line box: a text line, or a block on a line of its own. Everything that follows up to the next `line` belongs to it. |
| `text` | `x`, `y`, `width`, `height`, `codepoint`, `font`, `cell`, `glyph`, `scale`, `style`, `rotated` | One cell of text. |
| `rect` | `x`, `y`, `width`, `height` | A filled black rectangle. The bars of a barcode, the modules of a QR code, a PDF417 symbol and a DataBar. |
| `image` | `x`, `y`, `width`, `height`, `data` | A 1-bit bitmap in the format of the output contract, at paper resolution. |
| `feed` | `y`, `height` | Rows the stream advanced without printing on them. |
| `cut` | `y`, `value` | The paper is cut between row `y - 1` and row `y`. `full` or `partial`. |
| `pulse` | `y`, `device`, `on`, `off` | The drawer opens when the paper is at row `y`. |
| `unknown` | `y`, `data` | A command that was not understood, with its bytes. |

Text. `codepoint` is the Unicode code point the parser decoded, U+FFFD for a byte the codepage does not map and for the placeholder cells of multibyte text. `font` is `A` or `B`. `cell` is the unscaled cell of the profile, `{width: 12, height: 24}` for font A, `{width: 9, height: 17}` or `{width: 9, height: 24}` for font B, and `glyph` is the unscaled glyph box centred in it, `{width: 12, height: 24}` or `{width: 8, height: 16}`. `scale` is `{x, y}`, 1 to 8, and `width` and `height` are the cell times the scale, so a back-end that only wants boxes needs nothing else. `style` is `{bold, underline, upperline, invert}`: `bold` a boolean, drawn as the glyph twice with a horizontal offset of one glyph dot, which is `scale.x` paper dots; `underline` and `upperline` 0, 1 or 2, the thickness in dots of a line along the bottom or the top of the scaled cell, across the whole cell width; `invert` a boolean, the cell black and the glyph white, and an inverted cell is not underlined, which is the rule of section 1. The code points U+2500 to U+259F are drawn to the edges of the cell instead of inside the glyph box, as the bitmap font stretches them. Every text operation carries its whole style; there are no state changes in the list, so a consumer never has to track anything, and a consumer that wants runs merges neighbouring cells itself.

Rotation. `rotated` is true on the cells of a line that was committed upside down. The box of such a cell is already where the rotation puts it, mirrored over the width of the paper, and the cell is drawn turned by 180 degrees about the centre of its own box; the two together are exactly the rotation of the line. A rectangle rotated by 180 degrees is the same rectangle, and the data of an image operation is rotated by the engine, so only text carries the flag.

Blocks. A barcode is the `rect` of every bar, over the full height of the bars, and the `text` cells of its human readable text. A QR code, a PDF417 symbol and a DataBar are `rect` operations with adjacent black modules of a row merged into one rectangle. Raster and column images, the graphics of section 13 and the kept images are `image` operations with the scaling of their command already applied, one dot on one dot; a strip of a column mode image is an `image` inside the text line it sits in. The Star raster mode produces one `image` per flushed buffer. The data of an image operation is a copy the layout owns, never a view on the bytes of the stream.

Feeds. A `feed` marks rows the stream advanced without printing: an empty line, the feed of `ESC J` and `ESC d` beyond the height of the line, a raster move. The gap the line spacing leaves below a line is not a feed, it belongs to the line. The marker draws nothing; the `y` of everything behind it already accounts for the rows. The bitmap back-end does not read it: its feed items come from the blank rows it rasterizes, under the `feedThreshold` rule, exactly as today.

Ordering. The operations are in paper order, the order a printer prints them: the `y` of the line boxes and of the markers never decreases, the operations of a line come after its `line` operation and before the next one, and within a line they are in the order the cells were placed, which is the order a later cell overprints an earlier one when the cursor moved back. A marker stands at the `y` the paper has when its command arrives, so a cut after the last line stands at `height`. An operation never refers to a later one, so a consumer can stream.

Filtering. The display list is not filtered by the `commands` option: every cut, pulse, feed and unknown command is in it. `commands` decides what reaches the item stream, and nothing else.

Versioning. `version` is an integer, 1 for this section. A field or an operation type that is added does not change it, and a consumer ignores fields and types it does not know. A change in the meaning of an existing field changes it. The format packages check the version and throw on one they do not know, and `documentation/display-list.md` is the reference page, with the same status column the command references have.

### The engine and the back-ends

```js
renderer.layout(bytes) → Layout                  // on ReceiptPrinterRenderer and on both renderers
renderer.render(bytes) → RenderItem[]            // unchanged, the engine streaming into the bitmap back-end
rasterize(layout, options) → RenderItem[]        // named export and static; options: commands, maxHeight, feedThreshold
```

`src/layout.js` is the engine. It implements every method of the painter interface and keeps every piece of printer state the painter keeps today, the kept images included, since those are the memory of the printer. It knows the cell sizes of the profile and nothing about glyphs: wrapping, tabs, margins and alignment need widths, not dots, so the engine has no font at all. It emits operations to a sink as lines are committed, so a line is final when it is emitted and `write()` and `end()` stay possible without a redesign.

`src/backends/bitmap.js` is the bitmap back-end, the rasterizing half of today's painter: the row buffer, the cells drawn from the packed font with the cache, the blank runs, the `maxHeight` splitting, the fallback table and the flush on a supported command. `render()` feeds the engine into it directly, so the memory profile of a render is what it is today, rows packed as they are committed and never the whole list in memory. `rasterize()` feeds a finished list through the same back-end, which is how the tests prove the two paths equal. `src/painter.js` goes away, and `test/painter.js` splits along the same line.

### Outlines

`tools/generate.js` also writes `generated/outlines.js`: for every code point of `tools/codepoints.js` the outline of its glyph as compact path data, from the same subset font and the same fitting rule as the bitmaps, the advance scaled to the 12 dot cell and the baseline on row 18, so that an outline sits exactly over its bitmap. There is one set, in the 12 by 24 cell in dot units; font B is the same outline scaled by two thirds into its 8 by 16 glyph box, which is how its bitmap is made. The box drawing and block characters are not in the face, they are drawn on the dot grid by `tools/box-drawing.js`, so the tool emits them as the rectangles it draws, for each of the three cells, 12 by 24, 9 by 17 and 9 by 24. The format:

```js
{
  version: 1,
  cell: {width: 12, height: 24},
  baseline: 18,
  glyphs: {65: 'M1.2 18L5.4 3.1 ...Z', ...},    // SVG path syntax, absolute commands, tenths of a dot
  box: {'12x24': {9472: 'M0 11h12v2H0Z', ...}, '9x17': {...}, '9x24': {...}},
  fallback: 65533,
}
```

Only the outlines reach the format packages; the main bundle of the renderer does not contain them. Where they are published is an open decision below.

Deliverables:

- `src/layout.js`, `src/backends/bitmap.js`, the typedefs of the display list in `src/types.js`, `layout()` on the three classes, `rasterize()` as a named export and a static, and the removal of `src/painter.js`.
- `generated/outlines.js` from `tools/generate.js`, and the packaging of it that the open decision picks.
- `test/layout.js`: for every fixture of both languages and of the raw and external directories, the list is in paper order, every operation lies inside the paper, `height` equals the height of the stitched paper, and the markers are the items of `items.json` at the right rows. For the `text`, `styles`, `sizes`, `fonts`, `alignment`, `upside-down`, `margins` and `tabs` fixtures the cells are checked for their `x`, `y`, `font`, `scale` and `style` against numbers written out in the test. For the barcode, QR code, PDF417, DataBar and image fixtures the rectangles and images are checked against the bitmaps the symbologies produce.
- `test/rasterize.js`: for every fixture, `rasterize(layout(bytes), options)` deep equals `render(bytes)`, items and image bytes, for the default options, with `feed` and a low threshold, and with `maxHeight`.
- `test/outlines.js`: every code point of the codepoints list has an outline, the box drawing set covers all 75 code points for the three cells, every path parses, and for a sample of glyphs the outline filled at one dot per unit with the 0.45 coverage rule of the generator gives the bitmap glyph.
- Golden layouts for three fixtures, `receipt`, `upside-down` and `graphics-raster` in ESC/POS, as `<name>.layout.json` next to the fixture with image data in base64, to freeze the format.
- `documentation/display-list.md`, a section in `usage.md`, the architecture and the file tree of `design.md`, and the TypeScript smoke test extended with `layout()`, the `Layout` type and `rasterize()`.

Acceptance:

- Every `.pbm` and `.items.json` of the repository is unchanged, byte for byte, and `npm test`, `npm run build`, `npm run test:types` and `npm run test:umd` pass.
- `render()` and `rasterize(layout())` agree on every fixture under every option combination the test lists.
- The parity test and the external fixtures of section 16 are untouched.
- The minified UMD bundle grows by no more than a few kilobytes, and `test:umd` asserts the outlines are not in it.
- The bug-check reads the display list of the `receipt` fixture by hand against its paper: every line, cell, bar and marker where the paper has it.
- Version 0.4.0.

Effort: 4 to 5 days.

Open decisions:

- **Where the outlines are published.** Either a sub-entry of this package, `@point-of-sale/receipt-printer-renderer/outlines`, built by rollup as its own ESM and CJS output with the `exports` map pointing at it, which the format packages take as a peer dependency, or a copy inside each format package, generated by this repository and committed there. The recommendation is the sub-entry: the subset font and the fitting rule live here, both packages need identical data, and a font change is then one regenerate instead of three commits. The size is about 150 kB of source and 40 kB gzipped, none of it in the main bundle either way.
- **The `line` operation.** It is what lets the PDF writer break pages between lines and lets a consumer group a line, at the cost of one operation per line. Keep it, or drop it and let consumers group by `y`.
- **Path precision.** Tenths of a dot, as above, or whole dots, which is smaller and coarser than the bitmaps were rasterized from.
- **The name.** `layout()` for the method and `Layout` for the type, or `display()` and `DisplayList`, which is what this document calls the concept.
- **A `character` field.** Whether a text operation carries the character as a string next to `codepoint`, for consumers that build text runs.

<br>

## Section 18: SVG

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

<br>

## Section 19: PDF

A separate package with a minimal PDF writer: objects, a cross reference table, one content stream per page with path operators, image XObjects for bitmaps, deflate through `CompressionStream`, and a page the size of the receipt by default with an option for a standard page. Text is drawn as paths from the outlines in this version; embedding the subset font as TrueType, so that the text of a receipt can be selected and searched, is a later refinement and not part of this section. It consumes the display list and nothing else of the renderer.

Contract:

```js
import { toPdf } from '@point-of-sale/receipt-printer-pdf';

const pdf = await toPdf(layout, {
  page: 'receipt',      // 'receipt', 'a4', 'letter' or {width, height} in points
  margin: 36,           // points around the receipt on a standard page
  align: 'center',      // where the receipt sits on a standard page, 'left', 'center' or 'right'
  cutMarker: false,
  title: undefined,     // the /Title of the document information dictionary
});
```

`toPdf()` is asynchronous, because the content streams and the images are deflated with `CompressionStream`, the way `toPng()` of the renderer is, and it returns a `Uint8Array`. The file is `%PDF-1.4`, the binary comment line, the catalog, the page tree, one page object per page with its content stream and resources, one form XObject per distinct glyph, one image XObject per image, the document information dictionary, the cross reference table with its ten digit offsets, the trailer, `startxref` and `%%EOF`. Nothing else: no fonts, no encryption, no incremental updates, no object streams.

Coordinates. PDF user space is points with the origin at the bottom left. Every page starts with a `cm` that scales dots to points, `72 / dpi`, and flips the vertical axis, so that the operations are written in the dot coordinates of the display list and the numbers stay integers. Text cells are the glyph form XObjects invoked with `Do` under a `cm` of the scale and the position, bold a second `Do` one glyph dot to the right, underline, upperline and the box of an inverted cell `re f`, an inverted glyph filled with `1 g`, a rotated cell a `cm` that turns it about the centre of its box. A `rect` is `re f`. An `image` is an image XObject with `/ImageMask true`, `/BitsPerComponent 1` and `/Decode [1 0]`, so that a set bit paints with the fill colour, placed with a `cm` of its size and position. A `cut` is a dashed line when `cutMarker` is on. `pulse`, `feed` and `unknown` produce nothing.

Pages. With `page: 'receipt'` the MediaBox is the width and the height of the layout in points and the document has one page. With a standard page the receipt sits `margin` points from the top, aligned as `align` says, and a receipt that is longer than the page continues on the next one: the break falls between two `line` operations, and a single line box taller than a page, which only an image can be, is drawn on both pages under a clip rectangle. Nothing is scaled.

Deliverables:

- The package, `ReceiptPrinterPdf` on GitHub, `@point-of-sale/receipt-printer-pdf`, version 1.0.0, per the rules of this block, `toPdf()` as the default and a named export, the options typedef in `src/types.js`.
- The writer as a module of its own inside the package, `src/writer.js`, with objects, streams, the cross reference table and the trailer, so that the document assembly reads as what it is; it is not exported.
- The fixture script as in section 18, freezing `test/fixtures/<name>.pdf` for the same receipts, plus a long receipt on A4 with a page break and the same receipt with a tall image across the break.
- A README that documents the options, the page rules, the structure of the file, the display list version it accepts, and that text is not selectable in this version.

Fixtures and tests:

- The golden PDF files, reviewed by eye in Preview and in a browser before they are frozen: the receipt, the page break and the clipped image.
- `test/pdf.js`: every fixture equals its golden file byte for byte, which needs the output to be deterministic, so the writer uses no dates and no random ids; every offset of the cross reference table points at `n 0 obj` and `/Size` is right; every stream inflates with `node:zlib` and the content stream holds the operators the test expects for a hand built layout; the data of an image XObject inflates to the rows of the bitmap; the page count and the MediaBox for every `page` option; a layout with an unknown version throws.
- `pdfjs-dist`, a dev dependency, loads every fixture and walks the operator list of every page, which works in Node without a canvas: the number of path fills and image draws matches the operations of the layout.
- `npm run check:qpdf` runs `qpdf --check` over the fixtures when the tool is installed, outside `npm test`.

Acceptance:

- Every fixture opens without a warning in Preview, in Chrome and in pdf.js, and the receipt reads as the bitmap preview shows it.
- The PDF of the full receipt is under 50 kB.
- A receipt of two thousand rows on A4 breaks between lines and loses nothing, checked by the reviewer against the SVG of the same layout.
- `npm test`, `npm run build` and `npm run test:types` pass.

Effort: 3 to 4 days.

Open decisions:

- **The package name**, as in section 18.
- **Where the outlines come from**, the decision of section 17.
- **Long receipts on a standard page.** Break between lines and continue on the next page, as above, or scale the receipt down to fit one page. The recommendation is to break; a receipt is read at its size.
- **The default margin and placement** on a standard page: 36 points and centred, or at the left.
- **The PDF version.** 1.4 uses nothing the file does not need; 1.7 is what tools expect to see today. The content is the same.

<br>

## Section 20: receipt markup

A separate package with two parsers, one for the receiptline language and one for a subset of GitHub Flavored Markdown, both producing the same intermediate block structure, and one translator that maps that structure onto calls on ReceiptPrinterEncoder. The package drives an encoder instance the application constructs, so the language, the printer model, the columns and the codepage mapping stay the application's choice, and it returns the bytes the encoder produces. The renderer is what tests it: the same document through this package and through receiptline itself, both rendered, and the images compared. The package is named for the format, not for the receiptline project, and its README says that it implements the receiptline language and credits the project.

Contract, the API:

```js
import ReceiptMarkupEncoder from '@point-of-sale/receipt-markup-encoder';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', printerModel: 'epson-tm-t88vi' });
const markup = new ReceiptMarkupEncoder({ language: 'receiptline', encoder });

const bytes = await markup.encode(document);
```

| Option | Default | Meaning |
|---|---|---|
| `language` | required | `receiptline` or `markdown`. `ReceiptMarkupEncoder.languages` lists both. |
| `encoder` | required for `encode()` | The ReceiptPrinterEncoder instance the calls go to. Its `columns` decide the widths. |
| `cut` | `partial` | What a cut in the document becomes, `full`, `partial` or `false` to leave cuts out, which is receiptline's `cutting: false`. |
| `codepage` | `auto` | The codepage the translator selects at the start of a document, or `false` to leave the codepage to the application. |
| `images` | none | An async function from an image source to something `encoder.image()` accepts, for Markdown images whose source is not a data URL. |
| `dithering` | `threshold` | The algorithm for images, one of the encoder's. |

`encode(document)` returns a promise of the bytes, because images have to be decoded first. `parse(document)` returns the block structure synchronously and is what the playground will use for a preview, and `ReceiptMarkupEncoder.translate(blocks, encoder)` is the translator on its own, so an application can build blocks itself. A base64 PNG, the form receiptline carries images in, is decoded by the package's own decoder: non interlaced, 1 and 8 bit greyscale, RGB, RGBA and palette, inflated with `DecompressionStream`; anything else throws with a message that says so, and receiptline recommends monochrome images with critical chunks only for the same reason. Each call to `encode()` starts with `encoder.initialize()`, so a document is a receipt.

Contract, the block structure. Both parsers produce it, the translator does not know which language a block came from, and it is the typedef set of `src/types.js`:

```js
Document = Block[]

Block =
  { type: 'paragraph', align, lines: Inline[][] }              // one entry per line, a hard break starts a new one
  { type: 'heading', level, inlines: Inline[] }                 // 1 to 6
  { type: 'table', columns: Column[], rows: Inline[][][], border }   // border 'none', 'space' or 'line'
  { type: 'list', ordered, start, items: Inline[][] }
  { type: 'rule', style }                                       // 'single' or 'double'
  { type: 'cut', value }                                        // 'full' or 'partial'
  { type: 'pulse', device, on, off }
  { type: 'barcode', data, symbology, width, height, text, align }
  { type: 'qrcode', data, size, errorlevel, model, align }
  { type: 'pdf417', data, columns, rows, errorlevel, width, height, truncated, align }
  { type: 'image', png, src, align, width }                      // png a Uint8Array, or src a string for the images option
  { type: 'blank', count }
  { type: 'raw', data }                                         // a Uint8Array, language specific, the author's responsibility

Column = { width, align, wrap }              // width a number of characters or 'auto', align 'left', 'center' or 'right'
Inline = { type: 'text', value, style } | { type: 'break' }
Style  = { bold, italic, underline, invert, font, width, height }   // resolved per run, no nesting; font 'A' or 'B', sizes 1 to 8
```

The translator maps blocks onto the encoder in one pass: a paragraph is `text()` per run with the style set around it through `bold()`, `italic()`, `underline()`, `invert()`, `font()` and `size()`, `align()` around the block and `newline()` per line; a heading of level one is the paragraph at `size(2, 2)` in bold, of level two in bold, and of level three and below plain; a table is `table()` with the column widths and alignments, `overflow: 'clip'` for a column that does not wrap, and a bordered table gets a one character column holding U+2502 between its columns and the same at both edges; a list is a paragraph per item with the marker in front, `-` for an unordered item and the number for an ordered one; a rule is `rule()`; cut, pulse, barcode, qrcode, pdf417, image and raw are the encoder commands of the same name; a blank is `newline(count)`. Every encoder call the translator makes is one the encoder documents, so the mapping table in the README is also the list of what the package needs from the encoder.

The receiptline language, and what it maps to:

| receiptline | Block | Notes |
|---|---|---|
| a line of text | `paragraph` | Alignment from the spaces around the pipes: `\| text \|` centred, `\| text` left, `text \|` right, a bare line left. |
| `a \| b \| c` | `table`, one row | Consecutive column lines with the same number of columns and the same properties form one table. Widths from `width`, `auto` and `*` are fill columns, a number is characters; a set of widths that does not fit is reduced the way receiptline reduces it, the widest first, so that `table()` never throws. |
| `{width: ...; align: ...; border: ...; text: ...}` | properties of the table or the block | `border: line` or `2` is a bordered table, `space` or `1` one space between columns, `none` or `0` no gap. `text: nowrap` is a column that does not wrap. A property block is valid on a single column line only, as in receiptline. |
| `-` | `rule`, single | Only the last character of a run counts, as receiptline reads it. |
| `=` | `cut` | The `cut` option decides the type and whether it is emitted. |
| `_`, `"`, `` ` `` | underline, bold, invert toggled in the style | Toggles that hold until the same marker or the end of the line, which is how receiptline reads them. |
| `^` to `^^^^^^^` | width and height of the style | The mapping of receiptline: one is double width, two double height, three is 2 by 2, and each further caret one more, up to 6 by 6; the same count again returns to normal. Above the size a language allows, StarPRNT stops at 6, the encoder clips. |
| `~`, `\`, `\n`, `\xnn` | text | A space, the escapes, a hard break, and a character by its code. |
| `{image: base64}` | `image` | Decoded from the PNG, printed at its own size, aligned as `align` says, centred by default. |
| `{code: data; option: ...}` | `barcode` or `qrcode` | `upc` is UPC-A or UPC-E by length, `ean` and `jan` EAN-13 or EAN-8 by length, `code39`, `itf`, `codabar` and `nw7`, `code93`, `code128`; the module width 2 to 4 becomes the encoder's width 1 to 3, the height in dots is the height, `hri` and `nohri` are `text`. `qrcode` with a cell size of 3 to 8 is `size` and `l`, `m`, `q`, `h` the error level. The defaults are receiptline's, `code128 2 72 nohri 3 l`. |
| `{command: ...}` | `raw` | The text with its escapes decoded, passed to `raw()`. It is language specific in receiptline as well. |
| `{comment: ...}` | nothing | |
| `cpl` of the printer object | the columns of the encoder | The application's, through the encoder it constructs. |
| `encoding` | `codepage` | `multilingual` is `auto`, a named codepage is that codepage. |
| `gradient`, `threshold` | `dithering` and the threshold of `image()` | `gradient: true` is `floydsteinberg`, `false` is `threshold` with the value. |
| `cutting: false` | `cut: false` | |

What cannot be mapped, and is listed as such in the README: the vertical rule junctions of a bordered table, `vrhr` in receiptline, where a rule inside a bordered table meets the borders, which the encoder's `rule()` cannot draw, so the rule is a plain one; `upsideDown`, `spacing`, `margin` and `marginRight`, which are printer settings the encoder has no command for; `gamma`, which the encoder's dithering has no parameter for; the `width` property on an image or a code line, which reserves space in receiptline and does nothing here, an image prints at its own size and is scaled down by the encoder when it is wider than the paper; and the `command` property of a document written for another command set than the encoder's language, which is passed through as it is.

The Markdown subset, GFM, and what it maps to:

| Markdown | Block | Notes |
|---|---|---|
| `#`, `##`, `###` and deeper | `heading` | Level one prints at double size in bold, level two in bold, three and deeper plain. |
| a paragraph | `paragraph` | Lines joined and wrapped by the encoder; a blank line between paragraphs is a `blank`. |
| a hard break, two spaces or a backslash | `break` | |
| `*text*`, `_text_` | italic | Which most printers do not print, as the encoder's documentation says. |
| `**text**` | bold | |
| `__text__` | underline | A deviation from GFM, where it is strong; a receipt needs an underline more than a second way to write bold. |
| `` `code` `` | font B | |
| a pipe table | `table` | Alignment from the colons of the delimiter row, widths from the content and the paper, see the open decision. |
| `---`, `***`, `___` | `rule` | Single. |
| `![alt](src)` | `image` | A `data:image/png;base64,` source is decoded by the package, any other source goes through the `images` option and throws without it. |
| `-`, `*`, `+` items and `1.` items | `list` | Nested lists are flattened with two spaces of indent per level. |
| ```` ```qrcode ````, ```` ```barcode ````, ```` ```pdf417 ````, ```` ```cut ````, ```` ```pulse ````, ```` ```raw ```` | the block of the same name | The extension for receipt only features. The tag is the first word of the info string, the options follow as `key=value` pairs, and the body is the data; for `raw` the body is hexadecimal. A fence with any other tag, or none, prints as font B text. |
| block quotes, HTML, links, autolinks, strikethrough, task lists, footnotes | not supported | A link prints its text, a block quote its content, HTML is dropped. The README lists these. |

Compatibility tests, through the renderer:

- `test/documents/<name>.receipt`, documents written for this package, one per row of the receiptline table above and a few whole receipts, and `test/documents/<name>.md` for the Markdown rows. The receiptline examples are not copied, for the reasons of section 16; if the open decision takes them, they are read from the receiptline dev dependency at test time.
- For every `.receipt` document, two paths: through this package into an encoder for `esc-pos` at 48 columns, and through `receiptline.transform(document, {command: 'escpos', cpl: 48, encoding: 'cp437'})`, both rendered by ReceiptPrinterRenderer with the `epson` mapping. The comparison is on ink bands: each paper is cut into bands of consecutive rows with ink, separated by blank rows, both must have the same number of bands, and each pair of bands must be identical dot for dot. The blank rows between bands are not compared, because the two producers do not use the same line spacing, and the cuts are compared as items. A document that cannot match, because the mapping table says the feature differs, is in an exception list at the top of the test with its reason, the way `test/parity.js` does it.
- The encoder and the renderer are dev dependencies; every document is also encoded for `star-prnt` and `star-line` and rendered, without a comparison, so that a document never throws in a language.

Fixtures and tests:

- `test/fixtures/<name>.blocks.json`, the block structure of every document, golden, reviewed by reading it; the parser tests compare against it.
- `test/fixtures/<name>.pbm`, the paper of every document through this package, the encoder and the renderer, golden and reviewed as ASCII art, for the Markdown documents and for the receiptline documents alike.
- `test/receiptline.js` for the parser, the escapes, the toggles, the caret sizes, the property blocks and the width reduction; `test/markdown.js` for the subset and for what is not supported; `test/translate.js` with a fake encoder that records its calls, so that the mapping is checked call by call; `test/compat.js` for the bands; `test/png.js` for the decoder against `node:zlib` and a set of small PNGs of every colour type it accepts.

Deliverables:

- The package, version 1.0.0, per the rules of this block, with `ReceiptMarkupEncoder` as the default export and the UMD global, `parse()`, `encode()`, the static `translate()` and `languages`, the typedefs of the block structure and the options in `src/types.js`.
- The two parsers, the translator and the PNG decoder as modules of their own.
- A README that documents the API, both languages with the two mapping tables above, the list of what cannot be mapped, the fence extension, and that the receiptline language is the work of the receiptline project, with a link.
- A mention in the README of the playground that a markup input mode is planned; the playground itself is not part of this section.

Acceptance:

- Every row of both mapping tables has a document, and the compatibility test passes for every receiptline document, the exceptions listed with reasons and none of them a text feature.
- The receipt of receiptline's README, written into `test/documents`, renders through both paths to the same bands.
- Every document encodes in all three languages without throwing.
- The Markdown fixtures are reviewed as ASCII art: the heading sizes, the styles, the table columns aligned as the colons say, the list markers, the rule, the image, the QR code and the barcode of the fence extension.
- `npm test`, `npm run build` and `npm run test:types` pass in the package.

Effort: 6 to 8 days. If that is too long for one round of the working method, the section splits in two: 20a is the block structure, the Markdown parser, the translator and the PNG decoder, with the Markdown fixtures; 20b is the receiptline parser and the compatibility tests. Nothing above changes for the split.

Open decisions:

- **The table width heuristic** for a pipe table, which carries no widths. The recommendation: every column gets the width of its longest cell in characters, with one space between columns; when that does not fit in the columns of the encoder, the column with the longest cells becomes a fill column and wraps; when even that does not fit, because the other columns alone are too wide, the widths are scaled down proportionally with at least one character each. A column whose cells are all numbers is right aligned when the delimiter row does not say.
- **The fence tags and their syntax.** The recommendation above: `qrcode`, `barcode`, `pdf417`, `cut`, `pulse` and `raw`, options as `key=value` on the info string, the data in the body. The alternative is options as `key: value` lines in the body, which is what receiptline does with its property block.
- **The package name.** `ReceiptMarkupEncoder`, `@point-of-sale/receipt-markup-encoder`, follows the `*Encoder` names of the ecosystem, since it produces bytes; `ReceiptMarkup`, `@point-of-sale/receipt-markup`, is shorter and does not claim to be an encoder itself.
- **What `=` becomes.** A partial cut, which is what receiptline's ESC/POS command set sends, or a full one; the `cut` option lets an application choose either way, this is about the default.
- **Whether `encode()` is always asynchronous**, which is simpler, or synchronous for a document without images, which is friendlier but gives the method two return types.
- **Whether the receiptline example documents are run through the compatibility test** from the dev dependency, in addition to the documents of this package.
- **Whether the translator selects the codepage** with `codepage('auto')` by default, or leaves it to the application.

<br>

## Section 16b: reference renderers

Section 16 captures what four libraries produce. This addendum widens the suite at both ends. Part A adds the sample ESC/POS files that other open source renderers and emulators ship, so that the fixtures also carry streams that were written to exercise a renderer rather than to demonstrate an encoder. Part B puts those renderers next to this one on the contact sheet: where a tool runs on the machine that builds the sheet, its own rendering of the same stream is shown beside ours with a coarse agreement metric, so that a disagreement is something to look at rather than to argue about.

Everything section 16 rules stays in force: the four files per fixture, the provenance with the fields of that section, the licence text of a source kept once in its directory, the three checks of `test/external.js`, the eye review of every golden image before it is frozen, no runtime dependencies, and nothing generated committed.

**Part A: sample inputs from other renderers**

A renderer's sample file is not the output of an encoder, it is a stream written by hand to exercise commands, so it reaches parts of the command set the four libraries of section 16 never send. The sources, in order:

1. **zachzurn/thermal** (Rust, MIT and Apache 2.0). Its `sample_files` directory holds ESC/POS inputs, binary ones and ones in the project's own human readable format. Only real ESC/POS byte streams are captured; a sample in the human readable format is captured only when the project's own tool converts it here, see part B, and is skipped with a reason otherwise. The commit is pinned.
2. **ESCPost** (Rust, Apache 2.0, `receiptful/escpost`), its example receipts and the inputs of its render cases, which are `.hex` files: whitespace separated hexadecimal bytes with blank lines between the blocks.
3. **receipt-print-hq/escpos-tools** (MIT), the ESC/POS sample files of its repository and its tests.
4. **escpos-emulator** (npm, MIT), its samples if it ships any.

Rules on top of section 16:

- **A sample is captured only when its licence is clear.** The licence of a source is the licence of the repository unless the sample directory says otherwise; a directory that disclaims the repository's licence, or a sample whose origin is another project, is not captured under that source. Where the same bytes are also carried by a source whose licence does cover them, they are captured there, once, and the notes say where else they turn up.
- **The width is recorded.** Where a sample names a printer profile, the profile gives the print width and the provenance records both. Where a sample gives no width, the fixture is 576 dots, the 80 mm paper, and `notes` says the width was not given.
- **One capture script per source** in `tools/external/<source>/capture.js`, the same shape as the scripts of section 16: `setup` clones the repository at the pinned commit under `build/`, `command` is the invocation that writes the fixture, and nothing of it runs during `npm test`.
- **The eye review uses the source's own renderings where it ships them.** thermal carries its rendered PNG of every sample and ESCPost an expected PNG per render case; the review reads ours next to theirs and `notes` records what differs.

**Part B: the reference renderings on the contact sheet**

`npm run contact-sheet` grows a column per reference renderer. For every external fixture it runs the tools that are installed on the machine, shows what they made of the same stream next to our render, and writes an agreement metric into the page. A tool that is not installed is a "not available" cell, never a failure: the sheet is a review aid and has to build on a machine with none of them.

Rules:

- **One module per tool** in `tools/contact-sheet/references/<tool>.js`, with the pinned version, the exact commands and where the module looks for the tool written in its header, so that a maintainer can reproduce a rendering by hand. A module reports whether it is available, what it produced for a fixture and why it could not, and it never throws into the sheet.
- **The tools are the ones that render to dots**: thermal (PNG) and ESCPost (PNG). A renderer that produces markup rather than an image, such as `esc2html` of escpos-tools or escpos-emulator, cannot answer the question this page asks, so it is not a reference here, see the notes. A tool that needs a toolchain this machine does not have is built once into `build/references/` and found there; `build/` stays gitignored and out of the repository.
- **One coarse agreement metric per fixture per reference** where both renderings are images: the reference is scaled to our width, and the page records the ink rows of both, the rows that carry any dark pixel, and the relative height difference. It is information, not a check: no test fails on it, and the numbers go into a small table in the contact sheet index and as a summary into the notes of this section, with the fixtures that disagree most and what the eye review says the reason is.
- **No new runtime dependency**, and no reference tool is needed by `npm test`.

Deliverables:

- The new fixtures with their provenance and licences, and the capture scripts under `tools/external/<source>/`.
- The reference modules under `tools/contact-sheet/references/` and the contact sheet extension that uses them, including the agreement table.
- "Seen in the wild" updated on the two command pages with the commands the new fixtures exercise, naming the source.
- A mention of the reference renderers in the README and in `documentation/usage.md`, so that a reader knows the sheet can be built with them.
- Notes: per source the fixture count and the unknown items, which reference tools ran, and the agreement summary.

Acceptance:

- `npm test` passes and every new fixture passes the three checks of section 16.
- `npm run contact-sheet` builds with the reference tools present and without them, and the page says "not available" instead of failing when one is missing.
- No sample is committed whose licence is unclear, and the notes say which were skipped and why.
- Version stays 0.3.0, nothing committed.

Effort: 1 to 2 days.

Open decisions:

- **How many of ESCPost's render cases are captured.** The recommendation: its two example jobs, its calibration job and the inputs of its render cases, which are a handful each of text, graphics, motion, symbols and mechanism, rather than a selection, since they are small and each names the command group it exercises.
- **Whether a reference rendering is cached.** The recommendation: no, the tools are fast enough and a stale cache is worse than a rebuild.
- **Whether the agreement metric compares ink columns as well.** The recommendation: no, the row count and the height difference are enough to find the fixtures worth looking at, and a column count says little about a receipt.

<br>

## Section 16c: the unknown items of the wild

Sections 16 and 16b froze 123 streams from other libraries and counted 296
`unknown` items in them. The tables of "unknown items in the wild" of those two
sections are the list of everything this renderer does not show of a real
stream, and this addendum empties it: one command is rendered that was not, one
is read that was only reported, and the rest of the list is commands that cannot
touch the paper at all and should never have been an item. A fourth change came
out of the same review, of the end of a stream rather than of a command. The
suite is unchanged otherwise: the same fixtures, the same bytes, the same three
checks.

**1. The reverse feed.** `ESC K n` prints the pending line and moves the paper
back `n` vertical motion units, `ESC e n` does it in lines of the current line
spacing. Both are print commands: the line is committed first and the paper then
moves back over rows that are already on it, so everything behind them is drawn
over those rows with OR, the way a second pass of a print head adds dots to the
ones that are there. The painter gets a paper position of its own, next to the
height of the rows it holds: a line committed past that height extends the
paper, a line committed inside it draws over it, and a row that was blank and is
drawn over is no longer blank, so the blank runs that become `feed` items are
counted again at the flush. The move is clamped to the rows the painter still
holds, which is all a renderer can offer: rows that went into an image item are
gone. `ESC K` takes 0 to 48 units, 24 dots at the default unit of an Epson and
as far as that mechanism reverses, and a larger value is out of range and
ignored. The Star languages get no reverse feed, no command of the
specifications available here feeds a Star printer backwards.

**2. `ESC SP n` of the Star languages.** It is the right side character spacing,
the counterpart of the ESC/POS command of the same name, and it is handed to the
same `painter.spacing()`. The reading is receiptline's, which is the only
producer the fixtures have, and the reference page records that and stays marked
as a reading.

**3. Reported becomes Parsed where the command cannot touch the paper.** The
rule goes into the Statuses section of both reference pages: **Reported** means
the command may have changed the paper of a real printer and the renderer did
not reproduce it, so the item is a warning that this receipt could come out
differently; a command that provably cannot touch the paper is **Parsed**,
consumed with its length and with no item at all. Status transmissions and the
enables of them, settings the paper cannot show and the buzzer move to Parsed;
everything that might move a dot, fire the drawer or clear the buffer stays
Reported.

**4. The end of a stream is not a line feed.** The painter committed the line
that was still being composed when the stream ended, and a printer does not: the
cells sit in its line buffer until a line feed or a print command puts them on
the paper, and the end of a job is neither. `end()` discards that line now, the
way `CAN` and `ESC @` discard it, and flushes the committed rows as before. A
receipt still prints in full, because the line feed of its last line committed
it. `cafe-order-voucher` of ESCPost ends with `GS V 0` and the words "Buffered,
not printed" on purpose, which is where this was found, and ESCPost renders it
the same way. The design's Output contract, both reference pages and the note of
section 2 say the new rule.

Deliverables:

- The paper position and the reverse feed in the painter, `ESC K` and `ESC e` in
  the ESC/POS renderer, `ESC SP` in the Star renderer, and the reclassified
  commands in both.
- The Statuses rule and the moved rows on both reference pages, with "Seen in
  the wild" and the counts brought up to date.
- A way to render the external fixtures again without capturing them, since the
  bytes did not change and only the render of them did.
- The end of stream rule in the painter, in the design's Output contract, on
  both reference pages and in the note of section 2.
- Tests for the overprint, the clamp, the blank runs, the ranges, the character
  spacing, the commands that no longer report and the line that is left in the
  buffer.
- Notes with the unknown totals per library before and after, and the reverse
  feed semantics.

Acceptance:

- `npm test` passes and every external fixture passes its three checks after it
  is rendered again.
- `npm run contact-sheet` still builds.
- Version stays 0.3.0, nothing committed.

Effort: half a day.

<br>

## Section 16d: page mode

Page mode is the one command group both reference pages listed under "Not
planned": the printer composes a page in memory, in a print area of its own and
in one of four print directions, and prints the whole area in one go. It is a
second layout engine next to the line one, which is why it was left out, and it
is the last group of the ESC/POS reference that a producer can reasonably send
and this renderer answers with an `unknown` item. This section adds it, in both
languages, and reverses the "not planned" entry of the design and of both
reference pages.

The painter gets a page mode next to its standard mode. The standard mode path
does not change: every fixture of sections 2 to 16c must stay byte identical,
and the page mode code is only reachable once a stream enters page mode.

**The model.** A page is a bitmap of the paper width and the page height of the
profile, and a print area is a rectangle on it. Text and blocks are laid out in
the coordinate system of the print direction, in a canvas of their own, and the
canvas is composited into the page rotated by the direction when the area, the
direction or the page changes. Printing the page draws it on the paper as a
block, at the position the paper is at, and the paper goes on below it.

Painter additions:

```js
painter.page(true | false)                  // enter page mode, or leave it and discard the page
painter.pageArea({x, y, width, height})     // the print area on the page, in dots
painter.pageDirection(0 | 1 | 2 | 3)        // the print direction, which starts the layout over
painter.pageVertical(dots, {relative})      // the position along the direction's vertical axis
painter.printPage({keep})                   // draw the page on the paper, keeping or clearing it
painter.cancelPage()                        // throw the dots of the page away, keep the area
get painter.pageMode                        // whether the painter is in page mode
```

Deliverables, ESC/POS:

- `ESC L` enters page mode, and only at the beginning of a line in standard
  mode, as the reference says. `ESC S` returns to standard mode and the page
  data is deleted, never printed. `ESC @` returns to standard mode as well.
- `ESC W xL xH yL yH dxL dxH dyL dyH` sets the print area: the origin in
  horizontal and vertical motion units and the size in the same units. A size of
  zero is the maximum in that direction, an origin outside the printable area
  makes the command do nothing. The area a page starts with is the whole
  printable area, whose height is the `pageHeight` of the profile.
- `ESC T n` sets the print direction and the starting position: 0 left to right
  from the top left, 1 bottom to top from the bottom left, 2 right to left from
  the bottom right, 3 top to bottom from the top right, the values 48 to 51 for
  the same. A fixture per direction, and the rotation of each of them written
  down.
- `GS $ nL nH` and `GS \ nL nH` set the absolute and the relative position along
  the vertical axis of the direction, `ESC $` and `ESC \` along the horizontal
  one, all four in the coordinate system of the direction.
- `LF`, `ESC J`, `ESC d`, `ESC K` and `ESC e` move the position inside the area
  instead of the paper, with the line spacing and the styles of standard mode.
  Text wraps inside the area and dots outside it are discarded.
- Barcodes, QR codes, PDF417, DataBar and every image command draw into the page
  at the position, aligned by `ESC a` inside the area.
- `FF` prints the page and returns to standard mode, `ESC FF` prints it and
  keeps both the page and page mode, so the same page can be printed again, and
  `CAN` throws the dots of the page away and keeps the area. In standard mode
  `CAN` and `FF` do what they do now.
- A `cut` or a `pulse` that arrives in page mode waits for the page, so that the
  items reach the driver in the order the paper does.

Deliverables, StarPRNT:

- `ESC GS P 0` and `ESC GS P 1`, which the encoder's flush emits around every
  job and which this renderer has parsed as a print mode so far, are page mode
  start and page mode end. Leaving page mode prints the page. The encoder sends
  the pair with nothing in between, so its page is empty and nothing may change
  for any existing fixture: every Star fixture of sections 3 to 16c stays byte
  identical.
- The area, the direction and the two vertical positions of the group, as far as
  the Star specification the implementer knows defines them, with the reading
  written down on the reference page the way `ESC SP` and `ESC GS S` are.

Fixtures, hand assembled in `test/tools/make-fixtures.js`, ESC/POS and Star
where the commands exist in both: `page-mode-directions`, four areas on one page
with a label and a rule in each of the four directions, `page-mode-coupon`, a
coupon laid out with absolute positions, a barcode and a QR code,
`page-mode-esc-ff`, one page printed twice, and `page-mode-cancel`, where `CAN`
throws a page away.

Tests: the four rotations, wrapping inside the area, dots beyond the bottom of
the area, the default area, `ESC S` discarding, the truncation sweep of every
new command, standard mode unchanged, and the acceptance below.

Acceptance:

- A receipt laid out in page mode with direction 0 over the full width renders
  the same paper as the same content in standard mode.
- Every fixture of sections 2 to 16c is unchanged, the Star ones included.
- The page mode rows of both reference pages are Rendered with their semantics,
  and page mode is gone from "Not supported yet" and from the design.
- `npm test` passes. Version stays 0.3.0, nothing committed.

Effort: one day.

<br>

## Notes per section

Filled in during implementation.

### Section 1

The font of this section, Spleen, was replaced by Iosevka in [section 9](#section-9); the notes below are what section 1 decided at the time, and the packed format, the fallback rule and the `stretch` option are still in force.

Choices made where the design was silent:

- **Spleen 2.2.0** is the font release in `data/fonts`, with its BSD licence. Neither size has U+FFFD, so the fallback glyph is the hollow box that `tools/generate.js` draws, inset one dot horizontally and `round(height / 6)` from the top and `round(height / 4)` from the bottom, which puts it in the ink area of the other glyphs.
- The packed format is `{width, height, fallback, index, data}` per font, keyed by cell size, `12x24` and `8x16`. `index` maps a code point to a glyph number, `data` is base64 of all glyphs, a glyph being `height` rows of `Math.ceil(width / 8)` bytes, so a glyph is a Bitmap without copying. Glyph 0 is the fallback. The union of the codepage tables plus ASCII 0x20 to 0x7E gives 527 glyphs per font, together 55 kB.
- Spleen 12x24 has no glyph for 46 of the code points of cp437, the Greek and mathematical tail, the house, the peseta sign and the florin among them. Font A borrows those from Spleen 8x16, centred in the 12x24 cell, instead of printing fallback boxes. The `borrow` field of the font list in the tool says which font borrows from which.
- `Bitmap` is a class of static methods on plain `{width, height, data}` objects, so that a bitmap stays exactly the data the output contract describes.
- `Bitmap.packRows` takes numbers for widths up to 32 dots and bigints for any width, and throws when a number is given for a wider row.
- `Bitmap.trimRow` returns a view on the bitmap, not a copy, except for a bitmap without width, which has no row to view and gets one white byte. `Bitmap.split` returns the bitmap itself when it already fits.
- `Font.renderGlyph` centres the glyph in the cell, horizontally and vertically, so that an 8x16 glyph sits in the middle of a 9x24 cell. Bold overstrikes before scaling, as a printer does, the underline is drawn after scaling and stays one or two dots thick, and inverting is last. An inverted cell is not underlined, which is what the ESC/POS reference of `ESC - n` says.
- Box drawing characters have to connect across cells, which the gap between a glyph and a larger cell breaks. `renderGlyph` takes a `stretch` option that pulls the ink at the edges of the glyph out to the edges of the cell before scaling, and `Font.isBoxDrawing(codepoint)` says for which code points the painter passes it, U+2500 to U+259F.
- The glyph index gets a null prototype, so that a code point never finds a property of `Object`, and `Font.get` decodes each built in font once per process.
- `toImageData` takes the ImageData constructor as a second argument when the platform has no global one.

### Section 2

Choices made where the design and this plan were silent:

- **Painter options.** The painter takes the resolved profile object, the renderer resolves the name, so that a driver can pass a profile of its own. `commands` becomes a set, `feedThreshold` defaults to 24 and `maxHeight` is null when it is not given. The `font` option replaces both built in fonts at once and has the shape of `generated/fonts.js`, keyed `12x24` and `8x16`. Font A always draws from the 12x24 glyphs and font B from the 8x16 ones, in whatever cell the profile gives them, so a profile changes the cell and not the glyphs.
- **`lineFeed(count)` and `feed(dots)`.** The interface has `lineFeed()`, `ESC d n` and `ESC J n` need more. Both go through one internal commit that takes the smallest height of the line: `lineFeed(n)` asks for `n` times the line spacing, `feed(dots)` for a number of dot rows. A committed line is never shorter than its tallest cell, so `ESC d 1` is exactly `LF` and `ESC J` never lets two lines overlap.
- **Cells sit at the top of the line box**, the gap of the line spacing falls below them. A consequence is that the vertical bars of the box drawing characters span their cell only, so a box has a six dot gap at every line boundary with the Epson line spacing of 30 dots and a 24 dot cell, exactly as the design's Painter section describes and as an Epson prints. Horizontal joins are seamless, because `stretch` pulls the ink out to the edges of the cell.
- **Wrapping** happens when the cursor is not at the left edge and the cell does not fit. A cell wider than the whole line is drawn anyway and clipped, so content is never dropped silently.
- **`strip()`** places its bitmap like a cell: it wraps the same way and makes the line as tall as itself. **`block()`** commits the pending line only when that line has content, so a block never inserts an empty line before itself.
- **`end()`** commits a pending line as if a line feed followed it, flushes, returns the items and only then resets the state, so the same renderer can render a second stream. **Section 16c changed the first half of that rule**: a line without its line feed is discarded at the end of the stream instead of committed, because a printer leaves it in its line buffer and never prints it. The flush, the return and the reset are unchanged.
- **`command()` flushes only for a command the driver supports**, as the design's Flushing section says. A command that is dropped changes nothing at all: it does not end an image segment and it does not break a run of blank rows, so a receipt with a cut that the printer cannot perform is one image and the blank rows on both sides of the cut are one feed item.
- **Blank runs** are tracked while rows are appended, and the row buffer grows by doubling. A run becomes a feed item when it is at least `feedThreshold` rows and `feed` is supported. The six blank dots below a line of text belong to the run that follows them, so a feed item usually starts a few rows above the empty line that caused it.
- **Vertical motion units.** The renderer tracks units per dot: the profile default, two for Epson, where one unit is half a dot, until `GS P x y` sets a vertical unit, after which one unit is one dot, and back to the profile default on `GS P 0 0`. `ESC 3 n` is therefore `round(n / units)` dots. The renderer does not know the resolution of the printer it emulates, so any non zero `y` is read as "the encoder set the unit to the resolution of the printer", which is the only thing the encoder ever does with this command. The stream that matters is `GS P dpi dpi`, `ESC 3 24`, which is 24 dots, `ESC 2`, `GS P 0 0`.
- **Argument values.** Underline, alignment and font accept both the binary values and the ASCII digits, `0` to `2` and `48` to `50`. A value outside the range leaves the state alone instead of throwing.
- **`ESC @` discards a half composed line**, because `Painter.reset()` drops the pending cells, which is what the hardware does: the command initializes the printer and the line buffer with it.
- **`ESC d n` and `ESC J n` are an approximation.** Both print the pending line and then feed, and the renderer gives the committed line a minimum height of `n` line spacings or `n` dot rows, so a line taller than the feed still advances by its own height. The encoder never emits either command, so no fixture exercises them and no hardware check settled the exact behaviour.
- **Unknown commands.** `ESC`, `GS` and `FS` commands that are not in the command table are consumed with the argument lengths of a table of common ESC/POS commands and reported as an `unknown` item with all of their bytes, prefix included. A command in neither table consumes its two prefix bytes alone, which is the best guess there is. A command that runs past the end of the stream ends parsing without an error, which is also what an incremental `write()` will need. Control bytes below `0x20` that are not `LF`, `CR`, `ESC`, `GS` or `FS` are ignored.
- **Blocks** (`GS h`, `GS w`, `GS H`, `GS k`, `GS ( k`, `ESC *`, `GS v 0`) are in the command table with the right argument lengths and a TODO for section 4, so they are skipped silently instead of turning into unknown items. The graphics group is not rendered in version 1 and reports an unknown command, under both of its prefixes, `GS ( L` and `GS 8 L`, and so do the other selectors of `GS (`.
- **Argument lengths that the specification leaves open.** `FS 2 c1 c2 d1..dk` defines a Kanji glyph and the number of data bytes depends on the Kanji font of the printer, which the stream does not say; the table assumes the 32 bytes of the 16 by 16 font. The encoder never sends it.
- **Option validation.** The painter requires a width that is a positive multiple of eight, a profile, and a line spacing, feed threshold and maximum height that are positive integers when they are given.
- **Decoding.** A byte the codepage table does not map becomes U+FFFD, which the font draws as its fallback box. The initial codepage is cp437 and `ESC @` returns to it. A mapping can name a codepage the codepage encoder does not implement, `cp885` of the Bixolon mapping for one, so the table of a codepage is resolved through a check and a try, and falls back to cp437 when it is not there. Selecting a codepage never throws, a receipt is never lost over one character.
- **A stream that fails leaves nothing behind.** `render()` parses inside a try and always ends with `painter.discard()`, which throws away the rows, the blank runs, the items and the state, so the renderer is reusable after an error as well as after a normal stream.
- **Fixtures.** `<name>.pbm` is the paper, not the item stream: the image items are stitched below each other and a feed item becomes white rows. That keeps the golden files stable when the renderer changes where it splits its images, and the item stream is checked separately against `<name>.items.json`, which holds the items that are not images. The stitch helper lives in `test/helpers/stitch.js`, because the fixture script and the test both need it; the real `stitch()` of the package follows in section 4.
- **Lint covers `test/` and `tools/` as well as `src/`.** The test files get the mocha environment through an `overrides` entry in `.eslintrc.json`; the helpers of the section 1 tests and two functions of `tools/generate.js` gained the JSDoc that the Google config asks for.
- **Fixtures reviewed by eye** as ASCII art: straight left and right column edges in the table, horizontally closed boxes and rules, wrapping at 48 columns, the alignment offsets of 0, 240 and 420 dots on the alignment fixture, and the codepage fixture decoding to `Café über Straße`, `Prijs: € 12,50` and `Привет мир` over cp437, cp858 and cp866, all with real glyphs and no fallback boxes.

### Section 3

Choices made where the design and this plan were silent:

- **One renderer for both Star languages.** `StarPrntRenderer` handles `star-line` streams as well, and reports `star-prnt` as its language either way. The two languages share their command set, they differ only in the encoder's line buffering, and the language of the renderer is what a driver puts in its connected event, so a second class with a second name would give drivers a choice that changes nothing.
- **Command groups.** A StarPRNT command is `ESC` and a command byte, or `ESC GS` or `ESC RS` and a command byte, so the parser has three tables instead of the one per prefix byte that ESC/POS needs. Everything else is the ESC/POS parser: an argument length per command, a best effort length table for the commands that are not implemented, `unknown` items with all of the bytes of the command, a truncated command that ends the parse without an error, and `render()` in a try with `painter.discard()` in the finally.
- **The drawers are control characters.** `BEL` and `FS` open the first drawer, `SUB` and `EM` the second, as the Star Line Mode specification lists them. The encoder emits `ESC BEL n1 n2` and then `BEL` or `SUB` in one payload, so `ESC BEL` is a command with two arguments and the byte behind it is a separate command. `ESC BEL` sets the width of the first drawer only, in units of ten milliseconds; the second drawer pulses 200 ms on and 200 ms off, which the specification fixes. Without an `ESC BEL` both drawers use those 200 ms. `BEL` becomes device 0 and `SUB` device 1, which is how the encoder maps its own `device` argument, so a pulse to device 0 survives the round trip through either language. A pulse to device 1 does not, because the width is not on the wire: it comes out as 200 ms on and 200 ms off whatever the receipt asked for. That is the printer, not the renderer, and it is in the exception list of `test/parity.js`.
- **The pulse width survives `ESC @`**, as it does on a Star printer, see the drawer section of the Star Graphic Mode specification. It is reset at the start of a stream, so a renderer that is used twice does not carry it over.
- **Line spacing.** `ESC 0` is three millimetres, 24 dots at the eight dots per millimetre of a 203 dpi printer, and `ESC z 1` is the four millimetre default of a Star printer, so it restores the default line spacing through `painter.lineSpacing(null)`, exactly the way `ESC 2` does in the ESC/POS parser. The renderer does not pin it to the 32 dots of the Star profile: the default belongs to the profile, or to the `lineSpacing` option when a driver gave one, and the encoder writes `ESC 0` before a column mode image and `ESC z 1` behind it, so a printer with another line spacing has to come back to its own or every line after the first image would be wrong. `ESC z 0` is the three millimetres of `ESC 0`. Those are the only values the encoder emits. Any other `ESC z n` is read as `n` millimetres, `n * 8` dots, which is an approximation that no hardware check settled.
- **Feeds are an approximation too.** `ESC a n` feeds `n` lines, `ESC J n` feeds `n` quarters of a millimetre, two dots each, and `ESC I n` feeds `n` eighths of a millimetre, one dot each. Both go through the painter's `feed()`, so a line that is taller than the distance still advances by its own height. The encoder emits none of the three.
- **`ESC i h w` takes the height first**, which is the order the encoder writes it in. Both the binary values 0 to 5 and the ASCII digits `0` to `5` are accepted, a multiplier is the value plus one, and a value outside that range leaves the size alone instead of clipping it, the same rule the other argument values follow. A multiplier of seven or eight, which the encoder accepts for every language and which `GS ! n` does carry on ESC/POS, has no value in `ESC i`, so a Star printer prints it at the size that was already set. The renderer does the same instead of clipping to six, and the divergence is in the exception list of `test/parity.js`. `ESC - n` accepts 0 and 1 and their ASCII digits, the Star underline has one thickness. `ESC RS F 2` selects the font C this renderer has no glyphs for and leaves the font as it was.
- **Codepages.** The initial codepage is entry 0 of the mapping, `star/standard`, and that is also where an unknown codepage number lands, instead of the cp437 of the ESC/POS parser. A codepage name the codepage encoder does not implement falls back the same way; the `star` mapping has no such name today, so only the number path is reachable and tested.
- **`CAN` cancels the line buffer.** The Star specification has it throw away the print data of the line that is being composed, without advancing the paper, so it calls the painter's new `cancel()`, which drops the pending cells and nothing else. The `ESC @ CAN` pair the encoder opens a job with is unaffected, the line buffer is already empty there. `cancel()` is the one addition the painter needed for this section.
- **`ESC FF n`** is in the unknown argument table with one argument, so that the mode byte behind it, which is `NUL`, `EOT`, `EM` or `LF`, is never executed as a command of its own. `EM` would otherwise open a drawer and `LF` would feed a line.
- **`ESC GS P 0` and `ESC GS P 1`** are parsed and ignored. They switch the printer between page and line units, which changes when the printer prints, not what it prints.
- **Blocks** (`ESC b`, `ESC GS y`, `ESC GS x`, `ESC X`) are in the command table with the right argument lengths and a TODO for section 4. The lengths follow the bytes the encoder writes: the QR data command is `ESC GS y D 1 m nL nH d..` and the PDF417 data command is `ESC GS x D nL nH d..`, without the function byte the QR one has. `ESC X nL nH d..` carries three bytes per column and the `LF CR` behind it is not part of the command, it is the line feed that commits the strip.
- **The unknown argument table** holds the common Star Line Mode commands and the `ESC * r` raster group of the TSP100, whose commands are either bare or carry ASCII digits up to a `NUL`, with `ESC * r m l` and `ESC * r m r` as the two that have a second letter. The lengths are best effort, they only keep the stream in sync, and the encoder emits none of these commands.

Parity:

- **Parity holds for all thirteen fixtures, with no exceptions.** `test/parity.js` renders the ESC/POS bytes and the StarPRNT bytes of every fixture with the same profile, `epson`, and the same supported commands, and compares the stitched paper bit for bit and the items that are not images. The comment at the top of that file lists the differences the encoder does make between the two languages and how each one is dealt with.
- **Italic** is emitted for ESC/POS and not for StarPRNT, and makes no difference: Epson hardware does not italicize and the ESC/POS parser ignores the command, as the design says.
- **The codepage a printer starts in** differs, cp437 against the Star standard character set, and the Star one has no horizontal box drawing line, so the same box would come out with gaps. The `box`, `rule` and `fonts` receipts select cp437 first, which changes nothing in the ESC/POS encoding: the encoder was already selecting cp437 there. The `esc-pos` fixtures are byte for byte the ones section 2 froze.
- **autoFlush** is off for the StarPRNT fixtures. With it on the encoder ends a job that does not end in a cut or a pulse with `ESC GS P 0` and `ESC GS P 1` on a line of their own, so the receipt gains a blank line that the ESC/POS encoding does not have. That is a property of the job and not of the receipt. The renderer parses both commands and `test/star-prnt.js` checks that they change nothing, so the coverage is not lost.
- **Code 128 code set selection** is stripped for StarPRNT and passed through for ESC/POS, and the feed behind a cut is the same in both languages. Neither matters in this section, no fixture prints a barcode; the block fixtures of section 4 have to take the first one up again.
- **Character sizes of seven and eight** fit in `GS ! n` and not in `ESC i h w`, so the same `size(7, 7)` would print at seven times the size on ESC/POS and at the size that was already set on StarPRNT. Both renderers are faithful to their own hardware. The `sizes` fixture goes up to three, as a receipt does.
- **A pulse to the second drawer** carries its times on ESC/POS and not on StarPRNT, where `SUB` and `EM` are fixed at 200 ms on and 200 ms off. The `pulse` fixture opens drawer 0, the encoder's own default, which does round trip.

Fixtures:

- `test/tools/make-fixtures.js` runs the same thirteen receipts through both languages and writes `test/fixtures/<language>/<name>.{bin,pbm,items.json}`. The StarPRNT renders use the defaults of the renderer, the `star` profile with 32 dot line spacing and a 9 by 24 font B, so the golden images are what a Star printer would produce, while the parity test is the one that normalises the profile.
- The `codepages` receipt keeps its candidates, `cp437`, `cp858`, `windows1252` and `cp866`, because all four are in the `star` mapping as well, so both languages switch at the same place to the same codepage with a different number.
- Every StarPRNT image was reviewed by eye as ASCII art: both boxes closed with the eight dot gap of the 32 dot line spacing at every line boundary, the rules straight over the full width and over twenty columns, the table columns aligned left, centre and right, font B in its 24 dot Star cell with connected box drawing characters, the size multipliers up to three, the alignment offsets, the wrap at 48 columns, and the codepage lines decoding to `Café über Straße`, `Prijs: € 12,50` and `Привет мир` with real glyphs.

### Section 4

Choices made where the design and this plan were silent, and the corrections the
section made to [design.md](design.md).

Symbologies:

- **One module per file in `src/symbologies`**, with `pattern.js` for the three
  shapes a symbology is described in, a pattern of modules, the module widths
  the painter draws, and the narrow and wide elements of Code 39 and ITF, and
  `index.js` as the registry that turns a symbology name into a generator. A
  generator returns `{bars, text}`, the module widths starting with a bar and
  the text a printer prints below them, or `null` when the data is not valid for
  the symbology, which the painter answers by printing nothing at all.
- **Wide elements are three modules** in Code 39 and ITF and two in Codabar,
  which is the ratio the reference encoder of the tests uses and the one the
  specifications call the common case. The ratio is not on the wire, so no
  fixture could settle it.
- **A trailing space is not part of a symbol.** Code 39 and Codabar end with a
  space between the last character and the quiet zone; `toBars()` drops it, so a
  centred barcode is centred on its bars.
- **The human readable text** is the data of the barcode, as it is printed: the
  check digit that was computed is in it, UPC-A prints twelve digits and not the
  thirteen of the EAN-13 it is, Codabar prints its start and stop character, and
  Code 128 prints the characters without the escapes of the code set selection.
- **UPC-E** takes six digits, seven with the number system in front of them or
  eight with the check digit behind them as well. The check digit is the one of
  the UPC-A the symbol expands to, and the number system, 0 or 1, decides which
  parity pattern the six digits are drawn in.
- **Code 128 auto** follows the rule the design describes, code set C for a run
  of four digits or more and for a value that starts with two, and code set A
  only when the value needs the control characters. It is the rule the reference
  encoder implements, so every value can be checked against it. The selection
  never uses SHIFT, which only saves a symbol when one character of the other
  code set stands between two characters of this one.
- **Code set C ends where the pairs end.** A byte of code set C is the value of
  a digit pair, 0 to 99; a byte above that is no pair and switches to code set
  B, which is the only thing a printer can do with it. **This note read
  differently until section 16: the data behind `{C` was taken for digit
  characters until the captures of receiptline and escpos-php showed the
  specification form, see the notes of that section.**
- **GS1-128** is a Code 128 with the code sets picked for the data and FNC1
  behind the start symbol.

Blocks:

- **`painter.barcode()` and `painter.qrcode()`** take the request the parsers
  build, draw the block and commit it through `block()`, so barcodes, QR codes
  and raster images all go through one path and are aligned the same way. A
  request the generators refuse draws nothing and does not advance the paper.
- **The human readable text** is one line of cells of the HRI font, drawn
  without any style, centred over the bars, and the block is as wide as the
  wider of the two. `Painter` grew a `#textBitmap()` for it and `#cell()` took a
  font and a style argument, so that the text of a barcode is not drawn in the
  style of the text around it.
- **The HRI font is A by default**, not B. The design's table said font B; the
  ESC/POS reference of `GS f` gives font A as the default of the printer, and
  the encoder never sends `GS f`, so every barcode of a receipt from the encoder
  has its text in font A. The design's ESC/POS table is corrected and `GS f` is
  in it.
- **Star module widths.** `ESC b` carries `n3` of 1 to 3, which the Star
  documentation describes in narrow and wide element widths per symbology rather
  than in dots. The renderer reads 1, 2 and 3 as 2, 3 and 4 dots. That is the
  reading that makes a Star barcode the same size as the ESC/POS barcode the
  encoder produces from the same receipt, where `GS w n` is the width option
  plus one, and it is written down as an assumption in design.md. No hardware
  check settled it.
- **Star Code 128 is the automatic variant.** The encoder strips the `{A`, `{B`
  and `{C` selection for StarPRNT, so the data that arrives has no code sets in
  it and the printer picks them, which is exactly what ESC/POS symbology 79 is.
- **`GS w n` accepts 1 to 6.** The specification defines 2 to 6, the encoder
  sends the width option itself for GS1-128 and the GS1 DataBar family, which is
  1 to 3, so a printer that refused 1 could not print those at all.
- **Images.** `ESC *` renders all four modes, the eight dot modes as strips of
  eight rows and the 24 dot ones as strips of 24, with the single density modes
  printing every column twice. `GS v 0` renders the four `m` values by repeating
  dots. `ESC K` and `ESC L` of Star Line Mode render as eight dot strips, `ESC k`
  is left unknown: its quadruple density has no obvious horizontal scale and the
  encoder emits none of the three. `Bitmap.scale()` is the one addition the
  bitmap module needed, and the QR codes use it as well.
- **PDF417 and GS1 DataBar.** The parameters and the data are parsed and
  dropped, and the command that prints the symbol reports an `unknown` item with
  its bytes: `GS ( k 48 81 48` and `ESC GS x P` for PDF417, and the whole
  `GS k m` or `ESC b n1 ..` command for the DataBar symbologies, since those
  print in one command. Nothing lands on the paper. PDF417 is rendered from
  [section 11](#section-11-pdf417) on, the DataBar family still is not.
- **QR codes through lean-qr**, in the byte mode of the specification, with the
  version left to the library, which picks the smallest one the data fits in.
  The error correction level is pinned with both `minCorrectionLevel` and
  `maxCorrectionLevel`, so that the symbol is the one the receipt asked for and
  not a higher one that happened to fit. Data that does not fit in the largest
  symbol prints nothing. The stored data survives until the next store, so two
  print commands print the same symbol twice, as the specification says.
- **QR code defaults**, for a stream that prints a symbol without setting
  everything first: model 2, three dot modules and error correction level L,
  which are the defaults of the ESC/POS specification. The barcode defaults are
  162 dots of height, three dot modules, no human readable text and font A.

Helpers:

- **`toPng()`** writes one IDAT chunk with every scanline unfiltered, compressed
  with `CompressionStream('deflate')`, which produces the zlib framing PNG asks
  for. The image is one bit greyscale, where a set bit is white, so the rows are
  inverted, which also makes the bits that pad a row to a whole byte white. The
  CRC32 is exported next to it, because the test needs it to check the chunks.
- **`stitch(items, options)`** replaces the helper of section 2, which is gone;
  `test/helpers/items.js` keeps the command extraction the fixtures need. The
  options are `cutMarker`, off by default, `feed`, on by default, and `width`,
  for a stream that has no image item to take it from. A cut is two rows of
  eight dot dashes. The fixtures pass `{width}` and nothing else, so the golden
  images of sections 2 and 3 did not change.

Fixtures:

- **The image** is a 200 by 96 checkerboard in two greys with a filled black
  circle over it, dithered by the encoder with the Atkinson algorithm, so that
  the fixture holds a real dither pattern and not a flat area. Both dimensions
  are a multiple of eight, which the encoder requires, and the height is a
  multiple of 24, so that the column mode encoding fills its strips exactly.
- **`image-raster` is a StarPRNT column image.** The encoder has a raster mode
  only for ESC/POS, `imageMode` is ignored for StarPRNT, so the StarPRNT half of
  that fixture is the same `ESC X` strips as `image-column`. Both print the same
  dots on the same rows, so parity holds and no exception was needed. It is
  written down in the comment at the top of `test/parity.js`.
- **Barcode widths.** Every barcode fixture uses width 2, which is three dots in
  both languages, except ITF, which uses width 1: the encoder doubles the width
  option for ITF on ESC/POS, and one is the only value where twice the option
  and the option plus one are the same.
- **`gs1-128` and `code128-auto` are addressed by the number of the symbology**,
  74 and 79 on ESC/POS and 9 and 6 on StarPRNT, because the encoder does not
  list either name in the capabilities of a printer it knows nothing about. The
  number also takes the same width path as the other symbologies, so the module
  width of GS1-128 is the same in both languages; with the name, ESC/POS would
  draw it one dot narrower than StarPRNT, which is a difference of the encoder.
- **The `code128` fixture prints `{BABC-123` and `{C1234`**, two values the
  automatic selection encodes exactly the way the code set selection asks for,
  so the fixture covers the escapes on ESC/POS and still has parity with the
  StarPRNT encoding, where the encoder strips them.
- **The `hri` fixture** prints the same barcode without text, with the text in
  font A and with the text in font B. The encoder never emits `GS f`, so the
  font is selected with `raw()` on the caption line in front of the barcode,
  where it costs no extra line, and only for ESC/POS. It is the one fixture in
  the exception list of the parity test.
- **The `receipt` fixture** is a shop receipt: a header, a table of items, a
  rule, a total in bold, an EAN-13 with its text, a QR code, a line of thanks, a
  partial cut and a drawer pulse.
- **Every fixture was reviewed by eye as ASCII art**: the bars of every
  symbology with the human readable text under them readable as the value that
  was encoded, the finder patterns and the module size of the QR codes, the
  dither of the image with the circle in the middle, the font B text of the
  `hri` fixture against the font A text above it, and the whole receipt.

Tests:

- **`test/symbologies.js`** checks every symbology against JsBarcode, which is a
  dev dependency for that file alone: its encoder classes return the modules as
  a string without a canvas or a DOM. Code 93 is checked against JsBarcode as
  well and against the published pattern of `TEST93`, written out symbol by
  symbol with the two check characters computed by hand. The same file reads the
  bars back from the paper of every barcode fixture, in both languages, and
  compares them with the reference, which covers the whole way from the bytes of
  the encoder to the dots on the paper.
- **`test/qrcode.js`** reads the rendered symbols back with jsQR, in both
  languages, for three values at three sizes and three error correction levels,
  and for the `qrcode` and `receipt` fixtures. The reader needs a quiet zone,
  which the printer does not print, so the test adds a white margin. jsQR
  decodes the bytes of a symbol as UTF-8, so a value that is not valid UTF-8 is
  checked as bytes instead of as text.
- **`test/formats.js`** inflates the IDAT chunk with `node:zlib` and compares
  the scanlines, checks the CRC of every chunk against the exported `crc32()`,
  and checks that `stitch()` joins, expands feeds, draws cut markers and ignores
  the commands that do not move the paper.

Parity:

- **Parity holds for all twenty nine fixtures but one.** `hri` prints its third
  barcode with the human readable text in font B, which only ESC/POS can select,
  and it is in the exception list at the top of `test/parity.js` with that
  reason. The commands of the two renders are the same for every fixture,
  including `hri`.

#### Review follow-up

The review of the section asked for ten changes, which are in the code and in
the tests:

- **Code 93 carries 47 symbol patterns**, not 43. The four shift characters of
  the full ASCII variant are never data, the symbol table stops at 43, but a
  check character does land on one of them, which drew nonsense for about one
  value in seven. A property test encodes four hundred generated values and
  checks that every one of them is `9 * (n + 4) + 1` modules of ones and zeroes
  and equal to the reference, and `F`, whose second check character is one of
  the four, is written out by hand.
- **Code 128 refuses a byte no code set can carry.** A byte above 127 made the
  automatic selection recurse forever, so a receipt with one in a Code 128 or a
  GS1-128 threw instead of printing. The symbologies now return null for it and
  the block is skipped, in both languages.
- **The QR error correction level of lean-qr is a number and L is zero**, so the
  lookup fell through to M for every symbol that asked for L. The level is
  looked up by name now. The `qrcode` fixtures of both languages were
  regenerated, they are the only fixtures this changed.
- **An empty QR storage prints nothing**, before any store command, after
  `ESC @` and in a second `render()` on the same renderer, which is what a
  printer does with a print command that has nothing to print.
- **`GS v 0 m` accepts the ASCII digits** of the mode as well, and a `GS v` that
  is not `GS v 0` reports an unknown command instead of drawing whatever
  follows it.
- **`GS ( k` with a selector that is not the QR code or PDF417 one** reports an
  unknown command, so Maxicode, the two dimensional GS1 DataBar and the
  composite symbologies are visible to a driver instead of disappearing.
- **A block that is wider than the print area is skipped**, for barcodes and for
  QR codes, which is what an Epson does: it prints nothing rather than a symbol
  no reader can read. The rule is on the bars and on the symbol; the human
  readable text is centred under the bars and clipped, as it is not part of the
  symbol.
- **UPC-E also takes a UPC-A**, eleven or twelve digits, and compresses it with
  the four rules of the specification when it has a zero suppressed form. The
  candidate is expanded again and compared with the number it came from, so a
  number without such a form is refused instead of drawing a different article.
  The reference encoder does not accept a UPC-A for a UPC-E, so the test uses
  hand checked pairs, `042100005264` to `425261` among them.
- **`stitch()` draws image items instead of copying their rows**, so that an
  item narrower than the paper, which a driver that renders in pieces can
  produce, lands on the left of the paper instead of being read with the wrong
  number of bytes per row. **`toPng()`** refuses an image without dots with an
  error that says so.
- **Comments.** `ESC K` and `ESC L` say what the Star Line Mode specification
  calls them, the normal density image whose dots are twice as wide as the dots
  of the print head and the fine density image of one dot per column; the QR
  code defaults say three dot modules, which is what they are; and the header of
  the parity test names the one exception instead of claiming there is none.

### Section 5

Choices made where the design and this plan were silent.

Build and declarations:

- **The declaration file was broken before this section.** `src/bitmap.js` held
  both a `Bitmap` typedef and a `Bitmap` class, and rollup-plugin-dts renamed
  both to the same name, so the bundled `dist/receipt-printer-renderer.d.ts`
  declared `Bitmap$5` twice and did not compile. `tsc` never noticed because
  `checkJs` is off and the duplicate only meets itself after bundling.
- **`src/types.js` is the one place the public types are written down.** It has
  no runtime code, only the typedefs of the output contract: `Bitmap`, the five
  item types, `RenderItem`, `RenderCommand` and `RendererOptions`. Every other
  module refers to it with `@typedef {import('./types.js').X} X`, so the
  bundled declarations contain each type once and the entry point re-exports
  them by naming them.
- **`src/bitmap.js` calls the type `Image` internally**, because the class of
  the operations is called `Bitmap` and a JSDoc typedef cannot share that name
  with it. It is the same type, imported from `src/types.js`.
- **The renderers no longer have their own options typedef.** Both constructors
  take `RendererOptions`, which is what the design describes, with the per
  language defaults in the JSDoc line and in the documentation instead of in two
  near identical copies of the same type.
- Other JSDoc corrections: `render()` returns `RenderItem[]` and not `object[]`,
  `stitch()` takes `RenderItem[]` and its options argument is optional,
  `toImageData()` returns an `ImageData` and not an `object`, `commands` is
  `RenderCommand[]`, `profile` is `string|Profile` and `font` is
  `Object<string, PackedFont>`.
- **`typeof ImageData` is not written in JSDoc**, because eslint's `valid-jsdoc`
  cannot parse it. The second argument of `toImageData()` stays a `Function`,
  the return type is what matters for an application.
- The entry point also exports `CellSize`, `Profile`, `PackedFont` and
  `StitchOptions`, because the option types name them and a TypeScript
  application that builds an options object needs to be able to name them too.
- The browser bundles contain no `require(` and no `node:` import: the only
  Node-only path is the `Buffer` fallback of the base64 decoder in
  `src/font.js`, which is behind a `typeof Buffer === 'function'` guard and
  reaches no module system. `@point-of-sale/codepage-encoder` and `lean-qr` stay
  external in the cjs and mjs builds and are bundled in the browser builds, as
  the rollup configuration already had it.
- Sizes, after terser: the UMD bundle is 133 kB, 39.8 kB gzipped, the ESM bundle
  the same, and the declaration file is 3.3 kB. The cjs and mjs builds are not
  minified, 215 kB each. Most of the weight is the packed font.

Types test:

- **`npm run test:types`** compiles `test/types/smoke.ts` against
  `dist/receipt-printer-renderer.d.ts` with `tsc -p test/types/tsconfig.json`.
  The tsconfig maps the package name to the declaration file, so the smoke test
  imports `@point-of-sale/receipt-printer-renderer` the way an application does.
  It is a separate script because it needs a build, and `npm test` must keep
  running on a fresh checkout without one. The full check before a release is
  `npm run build && npm test && npm run test:types`.
- The smoke test constructs both renderers, renders from a `Uint8Array` and from
  an array of numbers, narrows the items in a switch on `type`, and calls
  `toPbm`, `toPng`, `toImageData` and `stitch`. It has `lib: ES2020, DOM`,
  because `toImageData()` returns an `ImageData`.
- eslint does not see the file: it lints `test/**/*.js`, and mocha runs
  `test/` without recursion, so neither picks up `test/types`.

Documentation and example:

- `documentation/usage.md` follows the encoder's documentation: the same header,
  the same navigation list, short sections and tables for the options. It covers
  installation, creating a renderer, the item stream, the fallback table, feed
  items and `maxHeight`, the four helpers, a preview example, the note that
  drivers construct the renderer, and what is not rendered.
- `examples/preview.html` loads the encoder's UMD build from jsDelivr and the
  renderer's UMD build from `../dist`. A textarea feeds a small receipt with a
  header, a table, a rule, an EAN-13 barcode, a QR code and a cut, a select
  switches between ESC/POS and StarPRNT, and the render is stitched with cut
  markers and drawn on a canvas through `toImageData()`. A `?language=` query
  parameter preselects the language, which is what made the headless check able
  to test both.
- **The example calls `newline()` right after `initialize()`.** The encoder puts
  the padding of a centred line in front of the commands that open the receipt,
  and `ESC @` clears the print buffer, so without the extra line the first
  centred line of a receipt comes out left aligned. The renderer is faithful to
  the printer here, the fixtures of section 2 show the same bytes; the example
  simply does not want to demonstrate that quirk.
- **Verified in a headless browser.** Playwright's `chrome-headless-shell`
  (chromium 1228) is installed on this machine and was used with `--dump-dom`
  and `--screenshot` on `file://.../examples/preview.html`. Both languages
  render: ESC/POS gives 3 items, 2 of them images, 576 by 891 dots of paper, and
  StarPRNT gives 3 items, 2 images, 576 by 935 dots. The screenshot shows the
  bold centred header, the table with its aligned columns, the rule, the bold
  total, the barcode with its human readable text, the QR code and the dashed
  cut marker.

Packaging:

- `files` is `dist`, `README.md` and `LICENSE`. `npm pack --dry-run` lists ten
  files, the four bundles with their two source maps, the declaration file, the
  readme, the licence and `package.json`, and nothing from `test`, `data`,
  `generated`, `documentation` or `examples`.
- `exports` already had the `types` condition first, which is the order
  TypeScript needs, so it was left as it is. The keyword list grew with the
  spellings people search for.
- The version stays 0.1.0, nothing is published.

### Section 6

Implemented on branch `tsp100` of `/Users/salonhub/Projects/Dependencies/WebUSBReceiptPrinter`,
not committed. Files: `src/wrappers/star-raster.js`, `src/main.js`,
`test/star-raster.js`, `package.json`, `README.md`.

Choices made where the design was silent:

- **The `graphics` section of a profile is keyed by language**, so the Star
  profile carries `graphics: { 'star-graphics': { width, commands, wrapper,
  tearBar } }` and the driver looks up `profile.graphics[language]` after
  resolving the language. The Star profile resolves five different languages from
  one entry, so a flat section would have had to be guarded by a language test in
  the driver. Keyed by language, a profile with a plain string language, such as
  the cat printer profile of section 7, writes its own language as the single key
  and needs no special case in `#open()`.
- **The values of a graphics section may be functions of the device**, the same
  as `language` and `codepageMapping` already are. `#settings()` evaluates them
  through the existing `#evaluate()` before the section is used. The TSP103 and
  TSP113 have a tear bar instead of a cutter, and the only thing that tells them
  apart from the TSP143 is the product name, so `tearBar` is
  `device => /TSP1[01]3/.test(device.productName)`.
- **A tear bar model cuts with FF mode 3.** The mode tables of `ESC * r F n NUL`
  mark the cutter modes 9 and 13 invalid on a tear bar model and mode 3 invalid
  on a cutter model, so both cut types become mode 3, which feeds the paper to
  the tear bar. EOT mode 1 is valid on both and stays as it is.
- **The wrapper returns one `Uint8Array`** holding the whole job, not a list of
  chunks. The existing `print()` sends the command it is given in a single
  `transferOut()`, and nothing in it chunks or paces, so the graphics path does
  the same: render, wrap, one `transferOut()`. A bulk USB transfer of a few
  hundred kilobytes is what the browser already handles for a large ESC/POS
  receipt. Chunking belongs to the Bluetooth driver, where the link needs
  pacing, and there the wrapper returns packets instead.
- **A renderer class is a function with a static `language` string**, anything
  else that is a function is a loader and is called and awaited. A class without
  the property is therefore called as a loader, which throws a `TypeError` about
  invoking a class constructor, so the whole resolution sits in a `try` and every
  failure is rethrown as one `RendererError` that explains the option.
- **Renderer and wrapper are resolved before the device is opened.** The profile
  and the product name are all that the language, the graphics section and the
  renderer depend on, and those are available on a `USBDevice` without opening
  it. A missing renderer, a bad renderer option or a wrapper name that is not in
  the table therefore leaves the device untouched instead of half open. An
  unknown wrapper name throws a `RendererError` that names it.
- **`connect()` keeps its old behaviour for everything but the renderer.**
  Cancelling the dialog, a printer another application already claimed, a failing
  `claimInterface()`, all of those are still logged and swallowed, as in 2.0.
  Only a `RendererError` is rethrown, because that one is a mistake in the
  application and the exact thing the design wants to be easy to diagnose. This
  is one sentence in the README, in the connect section, and the version stays
  2.1.0.
- **`print()` takes the graphics path whenever `#graphics` is set**, so a
  graphics printer can never silently fall back to sending raw bytes, which is
  what prints garbage on a TSP100.
- **`columns` is only reported for graphics printers.** For every other printer
  the driver does not know the print width, and inventing 42 or 48 would be a
  guess the application cannot tell apart from knowledge. The README says so.
- **The codepage mapping of the renderer wins over the mapping of the profile**,
  through a small `CodepageMappings` table, `epson` for `esc-pos` and `star` for
  `star-prnt`. The profile mapping stays as the fallback for a renderer language
  that is not in the table.
- **`width` and `commands` always come from the profile**, `rendererOptions` is
  merged underneath, so an application can pass `maxHeight` or a `font` but
  cannot break the agreement between the print width and the reported columns.
- **A cut is never executed on an empty buffer.** `ESC FF NUL` is ignored when
  there is no raster data, so a segment that has to cut but sent no rows gets one
  blank row, `62 01 00 00`, after its FF mode and before the execute. That covers
  a job that starts with a cut, two cuts in a row, and the common case of a feed
  item followed by a cut, which is what the renderer produces for a receipt whose
  blank rows before the cut became a feed item. The same applies at the end of
  the job: a last segment with feeds but no rows gets a blank row before
  `ESC FF EOT`, so a trailing feed still advances the paper.
- **The wrapper tracks `rows` and `open` separately.** `open` says the FF mode of
  the segment was written, `rows` says raster data was sent. A pulse executes the
  FF mode only when rows were sent, because there is nothing to print otherwise,
  while a cut executes it always, with the blank row above if needed.
- **The wrapper takes an options object** which is the graphics section of the
  profile. It reads `quality`, `pageLength` and `tearBar` from it, defaulting to
  `0`, `0` and `false`, the high speed and continuous settings of the design.
  Only `tearBar` is set by the profile today, but a model that needs a page
  length has a place to say so.
- **`setting()` never writes a value that is not a number.** Anything
  non-finite or negative becomes `0`, so a feed item without a height sends
  `ESC * r Y 0 NUL` instead of the three letters of `NaN`.
- **The pulse width comes from the first pulse item on device 0 only.**
  `ESC BEL n1 n2` sets the timing of external device 1; the timing of device 2 is
  fixed in the printer, so a job that only pulses device 2 sends no width at all.
  Times that are absent or out of range fall back to 20, the printer default of
  200 ms, and are clamped to the defined area of 1 to 127 units of 10 ms.
- **`ESC * r D n NUL` takes `1` for device 0 and `2` for device 1**, any other
  device value falls back to drawer 1.

Byte sequences, all checked against Star's STAR Graphic Mode Command Specifications Rev. 2.32:

| Command | Bytes | Spec |
|---|---|---|
| initialize raster mode | `1b 2a 72 52` | `ESC * r R` |
| enter raster mode | `1b 2a 72 41` | `ESC * r A` |
| quit raster mode | `1b 2a 72 42` | `ESC * r B` |
| print quality | `1b 2a 72 51 n.. 00` | `ESC * r Q n NUL` |
| page length | `1b 2a 72 50 n.. 00` | `ESC * r P n NUL` |
| EOT mode | `1b 2a 72 45 n.. 00` | `ESC * r E n NUL` |
| FF mode | `1b 2a 72 46 n.. 00` | `ESC * r F n NUL` |
| drive drawer | `1b 2a 72 44 n.. 00` | `ESC * r D n NUL` |
| vertical position | `1b 2a 72 59 n.. 00` | `ESC * r Y n NUL` |
| raster data | `62 n1 n2 d..` | `b n1 n2 data` |
| execute FF mode | `1b 0c 00` | `ESC FF NUL` |
| execute EOT mode | `1b 0c 04` | `ESC FF EOT` |
| pulse width | `1b 07 n1 n2` | `ESC BEL n1 n2` |

The `n..` of the setting commands is ASCII decimal digits, so FF mode 13 is
`31 33 00` and FF mode 3 is `33 00`. The pulse width is the only one with binary
arguments.

Tests: `npm test` runs mocha over `test/star-raster.js`, fourteen cases, all
passing. Image then partial cut, image then pulse then image then full cut, feed
items between images, an image with an all white row and a row with a white tail,
an image ending without a cut, a pulse with no rows before it, pulse width
clamping, a pulse on device 1 without a width, the pipeline a real receipt
produces of image then pulse then feed then cut, a job starting with a cut, two
cuts in a row, a job of nothing but a feed, a feed item without a height, and a
tear bar cut. Every expectation is a literal byte array. The wrapper is its own
module without a `navigator.usb` reference, so the tests need no browser.
`npm run build` succeeds and the wrapper is in both bundles.

Not verified on hardware yet. The two things to confirm on a TSP100 are that
`ESC FF NUL` before `ESC * r D` really empties the buffer in time for the drawer
command, and that `ESC * r Y` moves the paper the way the CUPS driver expects.

### Section 7

Implemented on branch `meow` of
`/Users/salonhub/Projects/Dependencies/WebBluetoothReceiptPrinter`, not committed.
Files: `src/wrappers/meow.js`, `src/main.js`, `src/callback-queue.js`,
`test/meow.js`, `test/callback-queue.js`, `package.json`, `README.md`.

The option contract, the `#resolve()` rule, the `graphics` section keyed by
language, the `Wrappers` and `CodepageMappings` tables, the driver values
winning over `rendererOptions`, the connected event and the error for a
graphics printer without a renderer are the ones of section 6, byte for byte
the same shape. The notes below are only what this driver does differently.

Driver:

- **The profile keeps the language `meow`**, and that string is the key of its
  graphics section, exactly as section 6 designed it for a profile with a plain
  string language. Nothing in `#open()` special cases it.
- **The wrapper returns a list of packets**, not one buffer. The Bluetooth link
  needs pacing, the driver already sends one write per queue entry with
  `sleepAfterCommand` between them, so each packet is its own entry and the
  existing `messageSize` chunking is never reached: a packet is at most 56 bytes,
  well under the 200 of the profile. The chunking path is untouched for every
  other printer.
- **`print()` takes the graphics path whenever the graphics section is set.**
  There is no fallthrough to raw bytes for such a printer, raw ESC/POS would
  print garbage. Everything the application passed in one `print()` call is
  joined into one buffer first, because a renderer takes a job as one buffer and
  a job is one job however the application chopped it up.
- **The renderer is constructed with `maxHeight` from the profile** as well as
  `width` and `commands`, because the cat printer profile is the first one that
  sets it. The three are the driver's, `rendererOptions` is merged underneath.
- **The notify characteristic is a third entry in `#characteristics`**, next to
  `print` and `status`. The cat printer profile already had a `notify` function
  which nothing read; `#open()` now resolves it for every profile that has one.
  Subscribing goes through `#subscribe(name)`, which is guarded by a
  `#subscribed` flag per characteristic, so the subscription that `#open()` makes
  for a graphics printer is not repeated when the application calls `listen()`.
  `listen()` now subscribes to both and returns whether there is any
  subscription, so it keeps working for the printers that have a status
  characteristic.
- **Notifications go through one `#handle()`**, which answers the flow control
  packets and then emits the `data` event as before, so an application that
  listens to the notify characteristic still sees every packet.
- **A dedicated `RendererError`.** `connect()` keeps swallowing an ordinary
  failure with a `console.log`, which is the behaviour applications rely on when
  the user closes the device dialog, and rethrows only a missing renderer, a bad
  renderer option or an unknown wrapper name. Those are programming errors that
  would otherwise leave a printer connected that prints nothing. The README
  documents that `connect()` rejects in that case.
- **A failed graphics setup takes the connection down.** The profile is only
  known after the GATT connection is up, so the graphics block is a try/catch
  that calls `#reset()`, which disconnects GATT and clears the device, the
  profile, the characteristics, the subscriptions, the graphics fields and any
  pause on the queue, and then rethrows. `disconnect()` uses the same `#reset()`.
- **An unknown wrapper name throws an error that names it**, rather than leaving
  `#wrapper` undefined until the first print.
- **`#resolve()` wraps the loader call in a try/catch** and rethrows the clear
  error, so a class without a static `language`, which is called as a function by
  the loader rule, surfaces as the message about the option instead of a raw
  `TypeError: Class constructor cannot be invoked without 'new'`.

Flow control:

- **The queue grew a gate**, `pause()`, `resume()` and a `paused` getter. The
  runner awaits the gate before it shifts the next callback, so a pause stops the
  job before the next write and loses nothing. It is four lines in
  `src/callback-queue.js` and it is plain promises, so `test/callback-queue.js`
  tests it without a browser: pause before anything is added, pause from inside a
  callback, a double pause, a resume that is not paused, and the ordering and
  `sleep()` behaviour that was already there.
- **No polling.** The design describes the reference implementation polling every
  200 ms while paused. The driver does not poll: the printer sends the resume
  packet on the same characteristic, and the pause packet is matched on all nine
  of its bytes, as is the resume packet.
- **A resume that never arrives opens the gate anyway.** A pause starts a timer of
  `resumeTimeout` ms, a setting of the graphics section that the cat profile sets
  to the default of 3000, after which the driver logs that no resume was received
  and continues. A lost notification would otherwise stall a job forever. The
  timer is cleared by the resume and by `#reset()`.
- **Flow control is only read for a graphics printer.** The same `#handle()` serves
  the status characteristic of an ordinary printer, whose status bytes must never
  be mistaken for a pause, so the match is behind a test on `#graphics`.
- **A failing notify subscription fails the connection** of a graphics printer,
  as a `RendererError`, because flow control is not optional on this link.

Failure and teardown:

- **A rejecting callback does not wedge the queue.** `await callback()` is in a
  try/catch that logs, so a failing Bluetooth write does not leave `_working`
  true with the rest of the job stuck behind it.
- **`clear()` empties the queue, resets the working flag and opens the gate**, and
  a generation counter stops the run that is in flight, so a job that was waiting
  on the gate does not carry on writing once the gate opens for the next
  connection. `#reset()` calls it instead of a bare `resume()`.
- **A pending `print()` always settles.** Each job registers a resolver, which the
  queue calls at the end of the job and `#reset()` calls for whatever is left.
  They **resolve** rather than reject: the paper is the only place to see what did
  and did not print, and an application that never expected a rejection would get
  an unhandled one on every disconnect. This is in the README.
- **Writes are guarded**, `#write()` is a no-op once the print characteristic is
  gone, so a callback that was already queued cannot throw on a null.
- **The `disconnect` event of `navigator.bluetooth` calls `#reset()`** before it
  emits `disconnected`, so an unexpected link drop leaves the driver in the same
  state as a `disconnect()` the application asked for, rather than with a closed
  gate and a queue full of writes to a printer that is gone.
- **`#subscribe()` sets its flag last**, after `startNotifications()` resolved and
  the listener is attached, so a subscription that failed can be tried again
  instead of being remembered as one that succeeded.
- **`#settings()`** evaluates every value of a graphics section against the device
  before it is used, the same contract as the USB driver, so one profile can serve
  models that differ in print width. The cat profile stays literal.

Wrapper, `src/wrappers/meow.js`:

- **Exports `wrap`, `packet`, `crc8`, `reverseBits`, `Commands` and
  `FlowControl`.** The driver imports `wrap` and `FlowControl`, the rest is for
  the tests and for anyone reading the protocol.
- **Two generated tables at module load**, the 256 entry CRC8 table for
  polynomial 0x07 with initial value 0, and the 256 entry byte reversal table.
  The renderer's rows are most significant bit first, the printer takes the least
  significant bit as the leftmost dot.
- **Rows are padded, never truncated silently.** A row is `width / 8` bytes, 48
  at 384 dots, and a width that is not a multiple of eight throws. An image item
  narrower than the print head is copied into a zeroed row; one that is wider
  throws, rather than dropping the dots that fall off the paper. The renderer is
  constructed with the width of the print head so the driver never produces one,
  but the wrapper is exported.
- **Every value that goes on the wire is clamped.** `clamp()` falls back to the
  default when the value is not a finite number and clamps a finite one into the
  field: speed to one byte, energy and the feeds to two bytes, and a feed item
  without a height becomes a feed of zero rows rather than a packet with a
  garbage length. A zero feed packet is emitted rather than skipped, so that the
  packet count of a job is a function of the items alone.
- **Speed, energy and the final feed are options** of the graphics section, with
  the defaults of the design: speed `0x20`, energy `0x2ee0`, final feed 96 rows.
  Nothing in the profile sets them today, which is deliberate, they are the two
  values that still have to be settled on hardware.
- **`cut` and `pulse` are ignored defensively.** They are not in the `commands`
  of the profile, so the renderer never emits them, but a caller that builds its
  own item list does not get a broken job. `unknown` items are ignored the same
  way.

Packet table, all checked against the protocol section of design.md:

| Command | Bytes | Meaning |
|---|---|---|
| framing | `51 78 cmd 00 lenL lenH payload crc8 ff` | one command per packet, CRC8 over the payload only |
| get device state | `51 78 a3 00 01 00 00 00 ff` | opens a job |
| set dpi | `51 78 a4 00 01 00 32 9e ff` | 200 dpi |
| set speed | `51 78 bd 00 01 00 20 e0 ff` | one byte, default `0x20` |
| set energy | `51 78 af 00 02 00 e0 2e 89 ff` | two bytes little endian, default `0x2ee0` |
| apply energy | `51 78 be 00 01 00 01 07 ff` | |
| update device | `51 78 a9 00 01 00 00 00 ff` | |
| lattice start | `51 78 a6 00 0b 00 aa 55 17 38 44 5f 5f 5f 44 38 2c a1 ff` | begins a print |
| bitmap row | `51 78 a2 00 30 00 <48 bytes> crc ff` | one packet per row, bits reversed |
| feed | `51 78 a1 00 02 00 lo hi crc ff` | dot rows, little endian |
| lattice end | `51 78 a6 00 0b 00 aa 55 17 00 00 00 00 00 00 00 17 11 ff` | finishes a print |
| final feed | `51 78 a1 00 02 00 60 00 f5 ff` | 96 rows, so the paper leaves the head |
| pause | `51 78 ae 01 01 00 10 70 ff` | from the printer, stop writing |
| resume | `51 78 ae 01 01 00 00 00 ff` | from the printer, continue |

A pause that is not followed by a resume within `resumeTimeout` ms, 3000 by
default, opens the gate anyway and logs that it did.

Tests: `npm test` runs mocha over `test/meow.js`, `test/callback-queue.js` and
`test/driver.js`, 63 cases, all passing. The CRC8 is checked against three values computed by hand
in the header of the test file, `00` for `[00]`, `07` for `[01]` and `c0` for
`'A'`, and against the two lattice payloads. The job sequence for a 384 by 2
image with a known row pattern, a feed item, a feed item without a height, the
padding of a narrow row, the option defaults and the clamping, and that cut and
pulse items produce exactly the empty job, are all literal byte arrays. The
wrapper and the queue are modules without a `navigator.bluetooth` reference, so
the tests need no browser. `npm run build` succeeds and the wrapper is in both
bundles.

`test/driver.js` mocks the Web Bluetooth API, which no test runner has, and
drives the driver itself. A cat printer without a renderer rejects and leaves
GATT disconnected, a class without a static `language` rejects with the option
message, a notify characteristic that refuses to subscribe rejects and
disconnects, a loader function resolves, the connected event carries `esc-pos`,
`epson` and 32 columns, `rendererOptions` are merged underneath the driver's
values, the notify characteristic is subscribed once during open and not again
by `listen()`, a print produces the eleven packets of the table above, a job
given as several buffers and as a `DataView` on a slice arrives at the renderer
as one buffer, the pause packet stops the writes until the resume arrives, a
pause with no resume continues after the timeout, and a `disconnect()` or a
dropped link during a pause settles the pending job and writes nothing more,
before or after. The same file confirms that an ordinary printer still reports
no `columns`, still chunks a 250 byte job into 100, 100 and 50, subscribes to
its status characteristic on `listen()` only, and does not read the cat printer
pause bytes as flow control. The suite runs clean under
`--unhandled-rejections=strict`.

Version: 3.0.0, a major bump, because the passthrough of the `meow` language is
gone. Optional peer dependency on `@point-of-sale/receipt-printer-renderer`
`^0.1.0`.

Not verified on hardware. What has to be confirmed on a GB and a GT model is
everything the protocol section of design.md marks as unconfirmed: that the job
sequence is accepted as it stands, that speed `0x20` and energy `0x2ee0` give
readable output, that the flow control packets are exactly those nine bytes and
that a pause is always followed by a resume, and that 96 rows of final feed is
enough for the paper to clear the print head.

#### Speed, added 2026-09-12

The cat printer path prints correctly on an MX10 but took about 18 seconds for
the receipt fixture: 603 packets, each its own Bluetooth write with a sleep of
30 ms after it. Three changes, all in the driver, bring that down to under two
seconds without giving up flow control.

- **Run length encoded rows, command `BF`.** Confirmed from rbaron's catprinter,
  `catprinter/cmds.py`, in `cmd_print_row()`, `run_length_encode()` and
  `encode_run_length_repetition()`. NaitLee's `commander.py`, the reference for
  the rest of the protocol, only has `draw_compressed_bitmap()` as a TODO that
  calls the raw `draw_bitmap()`, so it says nothing about the format. One byte is
  one run: bit 7 is the value of the dots, 1 is black, bits 0 to 6 are the length
  of the run, 1 to 127, and a longer run is split into several bytes of the same
  value. The runs are in the order the dots are printed, leftmost first, and they
  have to add up to the full width of the print head, 384 dots. That order is the
  difference with the raw `A2` row: the `A2` payload is a bitmap whose leftmost
  dot is the least significant bit of its byte, which is why the renderer's rows,
  most significant bit first, are reversed byte by byte, while a run byte carries
  no bitmap and needs no reversal.
- **The choice is per row**, as in `cmd_print_row()`: the row is encoded, and when
  the result is longer than the 48 bytes of the bitmap it is sent raw instead. The
  comparison is the reference's, `> PRINT_WIDTH // 8`, so runs that are exactly as
  long as the bitmap are kept. A line of text is a handful of bytes, a row of
  alternating single dots needs one byte per dot and always falls back. The
  wrapper exports `encodeRow()` and `runLengthEncode()`, and the tests decode the
  runs again and round trip random rows, an all white row, an all black row, a
  text shaped row and the alternating dots that must fall back.
- **Writes carry whole packets.** `print()` no longer queues one write per packet.
  `#batch()` concatenates consecutive packets into writes of at most `messageSize`
  bytes, 200 in the profile, never splitting a packet, and each write is one queue
  entry with `sleepAfterCommand` after it. The queue checks its gate before every
  callback, so a pause that arrives between two batches still stops the next
  write, which is a test of its own. The chunking path of the other printers is
  untouched.
- **Profile values.** `sleepAfterCommand` is 20, the value of the reference
  implementation with 200 byte writes, and the graphics section sets
  `feedThreshold: 4`, so the short white gaps between lines of a receipt become
  feed packets of two bytes instead of dozens of white rows. Both are documented
  as tunable in the profile. `#open()` now passes the graphics values `maxHeight`
  and `feedThreshold` to the renderer through a `RendererSettings` list, and only
  when the profile actually has them, so a profile without one leaves it to
  `rendererOptions` and to the renderer's default rather than overruling it with
  an `undefined`. The driver's values still win over `rendererOptions`.

The receipt fixture, `test/fixtures/esc-pos/receipt.bin`, rendered at width 384
with `commands: ['feed']` and `maxHeight: 256`:

| | packets | writes | bytes | time |
|---|---|---|---|---|
| before, raw rows, one packet per write | 603 | 603 | 33091 | 18.1 s at 30 ms |
| after, compressed rows, `feedThreshold` 4, batched | 484 | 82 | 14619 | 1.6 s at 20 ms |

Each change on its own, for the record: batching alone takes the 603 raw packets
to 197 writes, compression alone halves the bytes to 16069 but not the 603
writes, and the two together without the feed threshold give 89 writes. The feed
threshold is what removes rows altogether, 588 rows and 6 feeds become 458 rows
and 17 feeds.

Tests: 81 cases, all passing, `npm run build` clean and the dist rebuilt. The
byte level tests cover a job with one compressible row, `BF` with the six run
bytes `81 7f 7f 7f 01 81`, and one incompressible row, `A2` with 48 reversed
bytes, and the driver tests cover the batch boundaries, twenty packets of a ten
row job becoming writes of 186, 168, 168 and 151 bytes, three rows of 56 bytes
per write in the middle, and a pause that arrives after the first write stopping
the second until the resume.

Still open on hardware: whether the MX10 and the GB and GT models accept the
`BF` rows, and whether 20 ms is enough with 200 byte writes on those models.

### Section 8

Implemented on branch `tsp100` of `/Users/salonhub/Projects/Dependencies/NetworkReceiptPrinter`,
not committed. Files: `src/wrappers/star-raster.js`, `test/star-raster.js`,
`src/main.js`, `test/network.js`, `package.json`, `README.md`.

Choices made where the design and section 6 were silent:

- **`src/wrappers/star-raster.js` and `test/star-raster.js` are copies of the
  section 6 files**, byte for byte, with one comment block added at the top of
  each saying that the file is shared with WebUSBReceiptPrinter and that the two
  copies must be kept identical. The alternative, a package that both drivers
  depend on, would put a runtime dependency on a driver that has none today and
  would have to be published and versioned for two hundred lines of byte
  building. The comment is the cheapest thing that keeps the copies honest, and
  the tests are copied along with the wrapper, so a divergence fails a build.
- **The application states the language, there is no device database.** A socket
  carries no vendor id, no product id and no product name, so the constructor
  takes a `language` option, and the `Graphics` table in `src/main.js` is keyed
  by language exactly as the `graphics` section of a profile is in the USB
  driver. `star-graphics` is its one entry today: width 576, commands cut, pulse
  and feed, wrapper `star-raster`. Any other language, including none at all, is
  the passthrough the driver has always been.
- **`tearBar` is a constructor option, not a function of the device.** The USB
  driver derives it from the product name; over a socket there is no name to
  test, so the application says so. It defaults to `false`, which is the cutter
  models, and it is merged into the graphics section before the section is given
  to the wrapper, so the wrapper sees the same object shape in both drivers.
- **`#resolve()` and `RendererError` are the section 6 code**, including both
  error messages, so an application that moves from USB to network gets the same
  diagnostics. Only the message about a wrapper that does not exist can no longer
  be triggered from outside, the wrapper name is not an option here, but it is
  kept so that the two drivers stay comparable.
- **Renderer and wrapper are resolved before the socket is opened**, the same
  rule as the USB driver's "before the device is opened". `connect()` is `async`
  and returns before the socket is actually connected, so the resolution is
  simply the first thing it awaits: a missing or invalid renderer rejects the
  promise and no connection attempt is made at all.
- **`connect()` keeps its old behaviour for everything else.** A host that is not
  there or a printer that does not answer still emits `error` and `timeout`
  events and does not reject, exactly as in 2.0. Only a `RendererError` rejects,
  because that is a mistake in the application.
- **The connected event only grows for a graphics printer.** For every other
  printer it stays `{ type: 'network' }`, because the driver knows nothing about
  what is on the other end of the socket, and a guessed language or column count
  would be indistinguishable from knowledge. A test asserts the object is deep
  equal to `{ type: 'network' }` so that this cannot regress.
- **`codepageMapping` falls back to `null`**, not to a profile mapping as in the
  USB driver, because there is no profile to fall back to. A renderer whose
  language is not in the `CodepageMappings` table therefore reports a language
  and no mapping, rather than a mapping that belongs to another language.
- **`print()` renders and wraps and then goes through the existing 1024-byte
  chunk loop**, unchanged. The USB driver sends its job in one `transferOut()`;
  a socket needs the pacing the loop already provides, and a raster job of a few
  hundred kilobytes is exactly what that loop was written for.
- **The version goes to 2.1.0**, the same minor bump as the USB driver, since the
  change is additive: a driver without the `language` option behaves as before.

Tests: `npm test` runs mocha over both files, 27 cases, all passing. The fourteen
wrapper cases are the ones section 6 froze, unchanged. `test/network.js` adds
thirteen cases that drive the driver against a `net.Server` started by the test,
on an ephemeral port on 127.0.0.1, with a fake renderer class whose static
language is `esc-pos` and whose `render()` returns a fixed image, feed and cut:
the four fields of the connected event, the options the renderer is constructed
with, the bytes on the wire being byte for byte `wrap()` of those items, the same
through an async renderer loader and with `tearBar` set, the rejection without a
renderer and with a renderer that is not one, a plain connect reporting nothing
but the type and sending its bytes unchanged, and a job of 2600 bytes arriving
unchanged through the chunk loop. `npm run build` succeeds and the wrapper is in
both the cjs and the mjs bundle.

Not verified on hardware. No TSP100LAN, TSP143IIILAN or TSP143IIIW was available,
and the README says so in the limitations of the new section. What is verified is
that the driver puts the same bytes on the socket that section 6 puts on the USB
endpoint, so the open questions are the ones section 6 already listed, plus
whether the printer's socket tolerates the 1024-byte chunking of a raster job.

### Section 9

Choices made where the design and this plan were silent.

The font:

- **Iosevka Medium 34.8.1** is the face, under the SIL Open Font License 1.1, from the release package `PkgTTF-Iosevka-34.8.1.zip` of [be5invis/Iosevka](https://github.com/be5invis/Iosevka/releases/tag/v34.8.1). It was the winner of a comparison of eleven monospaced and twelve proportional open faces rasterized into this cell: its advance is exactly half an em, so the em lands on 24 dots with no rounding and no vertical squeeze, its cap height is 17.6 of the 18 rows above the baseline against the 15 of Spleen, and it covers more of the codepage tables than anything else that was tried. Iosevka declares no Reserved Font Name, so the subset keeps the family and style names of the source.
- **The subset is committed, not the family.** `Iosevka-Medium.ttf` is 10.8 MB; `tools/subset-font.js` keeps the 779 code points of `tools/codepoints.js` plus `.notdef` and writes 207 kB, 780 glyphs, with opentype.js. Everything but the outlines, the advance widths and a cmap is dropped. The output is not byte for byte reproducible, opentype.js stamps the head table with the time of the run, which is why it is a committed artefact and not a build step; the generate step that reads it is deterministic, three runs in a row give the same `generated/fonts.js`.
- **`tools/codepoints.js`** is the one list of code points, shared by the subset tool and the generator, so that the font cannot hold glyphs the generator does not ask for or miss ones it does.
- **The subset rasterizes to almost the same dots as the full family**, 42 of 779 glyphs in the 12x24 font and 24 in the 8x16 one differ, by a single dot on a curve each. opentype.js writes the implied on-curve points of a TrueType quadratic as half units and rounds them to integers, half a font unit at 1000 units per em, which flips a dot whose coverage sits exactly on the threshold. Verified by generating both ways and comparing glyph by glyph.

The fitting rule, in `tools/rasterize.js`:

- **The advance is the cell.** The advance width of `M` is scaled to exactly 12 dots for font A and 8 for font B, nothing is scaled horizontally, and a glyph keeps the side bearings the designer gave it inside its advance instead of being centred on its ink. That is what keeps the rhythm of a line even and holds `i`, `l`, `(` and `.` where the design puts them.
- **The baseline is row 18 of the 24 row cell and row 12 of the 16 row one.** With Iosevka's half em advance that gives an em of 24 and 16 dots, a cap height of 17.64 and 11.76 dots, a descender of 5.35 and 3.57, and no vertical squeeze at all: `verticalCap` is 1 for both fonts. The squeeze is in the tool for a face that needs it, it caps the font so that the advance stays one cell wide, and a single glyph that is still too tall, an accented capital, is squeezed vertically by itself with its baseline where it is, to at most 70 percent of the size of the font.
- **The ink threshold is 0.45**, a constant at the top of `tools/generate.js`, with an 8 by 8 grid of samples per dot and a nonzero winding fill. Under a half on purpose: that is dot gain, a stem that covers 45 percent of a dot still burns it, the way the heat of a thermal head bleeds into the dots around it. It is the value the prototype settled on for this weight; 0.55 thins Iosevka Medium until the light strokes break and 0.35 closes the counters of `a` and `e` at 12 dots.

Box drawing, U+2500 to U+259F:

- **Iosevka's own box drawing glyphs were tried first and are not used.** They do connect once they are drawn at the size of the face and clipped by the cell instead of squeezed per glyph, but they are drawn for a cell of 1.25 em, so at 24 dots per em the light line lands on rows 9 and 10 of the 24 row cell instead of the middle, the double line comes out as one line of two dots and one of one, and in the 8 by 16 cell of font B the two lines of a double merge into a solid bar of four dots. A `╔═╗` then reads as a heavy box with an uneven top. The box fixture, the rule fixture and the font B line of the fonts fixture were rendered both ways and compared as ASCII art before the switch.
- **The synthetic set of `tools/box-drawing.js` is used instead**, ported from the prototype: a light line is two dots, a heavy line four, a double line two single dot lines three dots apart, centred in whatever cell it is drawn for, junctions drawn from their four arms, with the rule that a double line is interrupted where the perpendicular double line passes through it. Arcs, diagonals, the blocks and eighths and the three shades are drawn as well, so all 75 code points of the range are covered whatever the face has. A code point in the range the module does not draw would fall back to the glyph of the face, unsqueezed; there is none today.
- The single rules land on the same rows as they did with Spleen, so a receipt that was set up around the old rule does not move.

The human readable text of a barcode:

- **Four white dot rows sit between the bars and the text**, `HRI_GAP` in `src/painter.js`, above the bars as well when the text is printed above them. Spleen left four blank rows above a capital inside its cell, Iosevka does not, its capitals start on the top row, so without a gap the text touched the bars. Four dots is a legibility choice, it is not in any specification, and it is still to be compared with what an Epson puts on paper. The block of a barcode with its text is that much taller, which is what the fixtures and the four tests that pin the height of such a block now expect.

Fallback and coverage:

- **The fallback glyph is U+FFFD of Iosevka**, a question mark in a diamond, since the face has it. The hollow box that the tool drew for Spleen is still there for a face without one.
- **Coverage is 779 of the 1326 code points** of the codepage tables, against 527 with Spleen. Complete: cp437 with its Greek and symbol tail, the ISO 8859 and Windows Latin pages, Greek, Cyrillic, and the box drawing and block characters. Missing, and drawn as U+FFFD: Thai, Hebrew, Arabic and its presentation forms, Khmer, the Japanese half width katakana and a handful of CJK characters of the Japanese pages. Iosevka has no glyph for U+007F either, which is DEL and is never printed. A test asserts that every code point of cp437 from 0x20 to 0xFF has a glyph of its own, not the fallback, in both fonts.

Sizes:

- `generated/fonts.js` is 81 kB, against 54 kB with Spleen, for 779 glyphs of 48 and 16 bytes instead of 527 of 48 and 16. Well under the 200 kB the plan allows. The bundles grow with it: the UMD build is 159 kB, 47 kB gzipped, against 133 kB and 40 kB, and the unminified cjs and mjs builds are 242 kB. `data/fonts` is 207 kB of font and 4 kB of licence, against the 354 kB of the two BDF files it replaces.

Fixtures and tests:

- **All 52 golden PBM files changed and no `.bin` file did**, which is the point: the same bytes now draw other dots. Every fixture keeps its paper size to the row, so nothing moved on the page.
- **36 `items.json` files changed, in the height of a feed item only.** The blank run below a line of text starts a row earlier than it did, because the deepest ink of Iosevka is on row 22 of the cell where Spleen's was on row 23, so a feed is a dot or two longer or shorter. The rows of paper add up to the same total.
- **The fixtures were reviewed as ASCII art**: the single and double boxes closed on all four sides with the six dot gap of the 30 dot line spacing at each line boundary, the four rules straight over the full width and over twenty columns, the table columns aligned left, centre and right, the font B line with its box drawing characters connected in the 9 by 17 cell, the sizes up to three, the codepage lines decoding to `Café über Straße`, `Prijs: € 12,50` and `Привет мир` with real glyphs, the human readable text under every barcode readable as the value that was encoded, and the whole receipt fixture rendered to PNG.
- **The parity exception grew by one line.** The `hri` fixture prints its last line of text in font B on ESC/POS and in font A on StarPRNT, and the two fonts do not put their deepest ink on the same row, so the blank run behind it differs by a dot and with it the height of the last feed item. The commands are otherwise identical, and the test compares them with the feed heights taken out for that one fixture. Every other fixture still has parity in paper and commands.
- **The four tests that pin the height of a barcode block** were updated for the four dot gap, in the painter, both parsers and the font A against font B case of `GS f`.
- **Tests that held the shape of a Spleen glyph were updated**: the ASCII art of the letter A, the ink columns of the A and the H in the alignment, size and style tests of the painter and the two parsers, the two feed tests that count the rows of an image, and the row of the 8x16 A in a 9x17 cell. The borrowed glyph test of section 1 is gone, there is nothing to borrow any more. The synthetic 4 by 4 font tests and the box drawing join tests are unchanged, and the join tests pass with the new glyphs without a single expectation being touched.
- **The centring test of the human readable text compares centres** instead of the two margins around the ink. The text is centred cell by cell and the ink of a cell is not centred in it, so the side bearings of the first and the last character put the ink a dot or two off the middle of the bars.

Documentation:

- `documentation/design.md` names the font, the fitting rule, the threshold, the box drawing decision, the licence and the coverage in its Resources section, lists the new tools in the file tree, answers the open question with Iosevka, and credits Iosevka and opentype.js in its sources. The README and `documentation/usage.md` say what the built in font is. The keywords of `package.json` are about what the library does, not about which face it draws with, so they are unchanged.

### Section 10

Implemented on 2026-09-12. Files: `src/receipt-printer-renderer.js`, `src/umd.js`,
`src/types.js`, `rollup.config.js`, `package.json`,
`test/receipt-printer-renderer.js`, `test/umd/check.js`, `test/types/smoke.ts`,
`examples/preview.html`, `documentation/usage.md`, `documentation/design.md`,
`README.md`.

The class:

- **`ReceiptPrinterRenderer` is a delegate, not a base class.** It resolves the
  language to one of the two renderers, constructs it with the options it was
  given, and forwards `render()` and `columns`. The renderers know nothing about
  it, their constructors, their options and their static `language` property are
  untouched, so a driver or an application that was written against
  `EscPosRenderer` keeps working.
- **The `language` getter reports the language that was asked for, not the
  renderer that serves it.** A renderer created for `star-line` renders with
  `StarPrntRenderer` and reports `star-line`, because that is the language the
  encoder that produced the commands was configured with, and it is what the
  driver puts in its connected event. The static `language` of `StarPrntRenderer`
  stays `star-prnt`: it names the class, not the receipt.
- **`languages` is a static getter over the keys of the table**, so it is one
  list, it cannot fall out of step with what the constructor accepts, and a
  caller that changes the array it gets back changes nothing.
- The unknown language error names the three that work,
  `Unknown language meow, must be one of esc-pos, star-prnt, star-line`, because
  the mistake is almost always a language of the encoder that the renderer does
  not have.
- `language` is the only option the class reads, everything else is handed to
  the renderer untouched, so the width, mapping and profile checks, and their
  error messages, are the ones that were already there.
- `src/types.js` gained `RenderLanguage` and
  `ReceiptPrinterRendererOptions`, which is `RendererOptions` intersected with an
  optional `language`, so that the two option types cannot drift apart.

The UMD decision:

- **A UMD bundle cannot carry a default and named exports at the same time.**
  With both, rollup falls back to `exports: 'named'` and the global becomes an
  object with a `default` property, so `new ReceiptPrinterRenderer(...)` from a
  script tag would break, and the alternative, documenting the global as an
  object, is exactly what this section set out to remove.
- **So the UMD build has its own entry, `src/umd.js`**, which imports the class
  from the package entry and exports it alone, with `exports: 'default'` on the
  output. The global is the class itself, the same as the encoder's. The other
  three builds keep the package entry and are explicit about `exports: 'named'`,
  which also silences rollup's mixed exports warning.
- **The renderers and the four helpers are static properties of the class**, set
  as static fields in the class body so that tsc puts them in the declarations,
  and they are named exports as well. That is what makes the single-export UMD
  entry possible without losing anything: from a script tag the helpers are
  `ReceiptPrinterRenderer.stitch`, `ReceiptPrinterRenderer.toImageData` and so
  on, which is what the browser bundle already looked like, and
  `ReceiptPrinterRenderer.EscPosRenderer` still resolves for pages written
  against the old global.
- The `require` of the cjs build now returns the namespace, `{default,
  ReceiptPrinterRenderer, EscPosRenderer, ...}`, so CommonJS destructures, which
  is what the documentation shows.

Tests:

- `test/receipt-printer-renderer.js` has 21 tests: the export shape and the
  statics, the language list and that it cannot be changed from outside, the
  default language, the three languages reported back, the unknown language
  error, the options and the per language defaults and checks, and delegation.
  Delegation is checked against the renderers themselves over every fixture of
  both languages, image bytes and all, and `star-line` against the StarPRNT
  renderer over the StarPRNT fixtures, which is the whole point of that language
  being in the list.
- **`npm run test:umd`** evaluates `dist/receipt-printer-renderer.umd.js` in a
  `node:vm` context that has no `exports`, no `module` and no `define`, which is
  what a script tag gives it, and asserts that the global is a function, that the
  statics are there and that it renders in all three languages. It needs a build,
  so it is a script of its own next to `test:types`, and mocha does not see it
  because it runs `test/` without recursion. It lives in `test/umd/` and is
  linted like everything else.
- The arrays that come out of the bundle have the `Array` prototype of its own
  context, so the check compares the language list as text instead of with
  `deepEqual`.
- The smoke test constructs the unified renderer from a
  `ReceiptPrinterRendererOptions` object, reads `languages`, `language` and
  `columns`, renders, and names the class as a type, which is what proves the
  default export is declared as a class and not as a value.

Documentation and example:

- `documentation/usage.md` leads with the unified class everywhere, from the
  installation snippets to the preview, and the renderers of one language moved
  into a section of their own, `The renderer of one language`, with their static
  property and the `star-line` note.
- **The Driver integration section of the design document was rewritten** around
  the new contract: the application passes the class or a loader returning it,
  the driver constructs it with the language, width, commands and codepage
  mapping of the profile, and reports the renderer's language and mapping in the
  connected event.
- **The decision that a driver without a renderer throws is reversed**, recorded
  as such in the Decisions section and applied to the two branch sections.
  Without a renderer a driver reports the raw protocol name, `star-graphics` or
  `meow`, and passes the bytes through unchanged. Throwing would break every
  application that already speaks those protocols, which is what the cat printer
  driver required until now, and it would make the renderer a condition for
  connecting to a printer an application may only want to talk to directly. The
  meow branch is a minor version of that driver again, not a major one, because
  nothing is taken away.
- The profile's `graphics` section now names the language as well, which is what
  lets a driver construct the renderer without a table of classes and makes
  moving the TSP100 to StarPRNT a one line change.
- `examples/preview.html` uses the unified class, offers Star Line Mode as a
  third option, and takes the languages of the select from
  `ReceiptPrinterRenderer.languages`. Verified in `chrome-headless-shell`: all
  three languages render, 576 by 895 dots of paper for ESC/POS and 576 by 939 for
  both Star languages, and the page needed the class check to change from
  `typeof !== 'object'` to `typeof !== 'function'`, which is the whole UMD change
  in one line.

Acceptance:

- `npm test` 750 passing, `npm run build` clean, `npm run test:types` and
  `npm run test:umd` pass. Version 0.2.0, nothing published, nothing committed.


### Section 11

Implemented on 2026-09-12. Files: `src/symbologies/pdf417.js`,
`data/pdf417/clusters.txt`, `generated/pdf417.js`, `tools/generate.js`,
`src/painter.js`, `src/renderers/esc-pos.js`, `src/renderers/star-prnt.js`,
`test/pdf417.js`, `test/painter.js`, `test/esc-pos.js`, `test/star-prnt.js`,
`test/parity.js`, `test/tools/make-fixtures.js`, the `pdf417` and
`pdf417-truncated` fixtures in both languages, `documentation/design.md`,
`documentation/usage.md`, `README.md`, `package.json`.

The symbology:

- **The symbol characters are data, everything else is computed.** The 2787
  patterns of the three clusters are a table of the specification that no
  formula produces, so they live in `data/pdf417/clusters.txt` and
  `tools/generate.js` packs them into `generated/pdf417.js`, the way the
  codepage mappings and the profiles are packed. The copy came from BWIPP, which
  is MIT licensed, and `test/pdf417.js` checks every entry against the
  structural rules of the specification, that they are unique, and that each
  sits in the cluster its position in the table claims. The generator
  polynomials of the error correction are not pasted: they are the product of
  `(x - 3^i)` over GF(929) and are computed the first time a level is used,
  which is a dozen lines instead of nine tables.
- **Compaction.** A run of thirteen digits or more is numeric compaction, a run
  of five characters or more that the text tables hold is text compaction, and
  everything else is byte compaction, which is the rule of the reference
  encoders. A symbol starts in text compaction in the alpha sub mode, so text
  needs no latch in front of it. Byte compaction uses the two latches the
  specification defines, 924 for a run that is a whole number of six byte
  groups and 901 for one that is not, and no byte shift, 913: a single byte run
  therefore costs one codeword more than it could, and every decoder reads it
  the same.
- **Sub modes.** The latch and shift tables are the ones of the specification.
  A character that the current sub mode does not have is shifted in when the
  character behind it is back in the current sub mode, and latched to otherwise,
  picking the cheapest latch of the sub modes that hold the character. That is a
  heuristic, not an optimum: for text that is heavy with punctuation bwip-js
  finds a sequence one codeword shorter now and then. The symbols are the same
  size in every other case that was compared.
- **Leftover capacity is padding.** Where the data does not fill the symbol the
  encoder pads with 900, as the specification and the reference encoders do.
  bwip-js spends the room on check codewords beyond the level instead, which is
  why the module for module comparison in the test uses sizes that the data
  fills exactly; the readers accept both.
- **A symbol never has fewer than three data codewords.** One codeword of data
  and the length descriptor fill the data area exactly, with no room for the
  padding codeword the examples of the specification always leave, and readers
  refuse the result: ZXing finds no symbol at all in one, at any size and any
  error correction level, and bwip-js never produces one. One codeword is one or
  two characters, which a receipt does print, so the sizing asks for three data
  codewords and the padding fills the third. The review of this section found
  this, it is not in the specification as a rule.
- **The capacity is 925 codewords of data.** The largest symbol holds 928
  codewords, of which one is the length descriptor and two are the check
  codewords of level 0, so the cap is on what the high level encoder produces
  and not on the data area that holds it. 1850 characters of text therefore
  still encode, in 16 columns of 58 rows with a length descriptor of 926, which
  the first version of this section refused. The recommendation table of the
  automatic level stops at 863 data codewords, as the specification says, so
  more data than that only fits at a level the receipt names itself.
- **The automatic size** is the number of columns whose symbol comes closest to
  three times as wide as it is tall, and of two equally good shapes the smaller
  symbol. The width is the whole row in modules, the start pattern, the row
  indicators and the stop pattern included, and the height is the rows times the
  row height, which the painter passes on, so the shape is the shape on paper
  and not of the data area. Small data therefore lands on one column of many
  rows, which is what makes a receipt symbol scannable; the smallest symbol
  would be a wide flat block of three rows. With only the columns or only the
  rows given the other follows from the number of codewords that has to fit.
- **The automatic error correction level** is the recommendation of the
  specification, level 2 up to 40 data codewords, 3 up to 160, 4 up to 320 and 5
  above that. The ratio mode of `GS ( k 48 69 49 n`, which asks for `n` tenths
  of the data as check codewords, cannot be resolved in the parser, because the
  number of codewords is only known once the data is compacted; the parser
  passes the ratio on and the symbology picks the level whose number of check
  codewords comes closest to it.

The parsers and the painter:

- **`painter.pdf417()`** takes the request the parsers build and draws it
  through `block()`, so PDF417, QR codes, barcodes and raster images are all
  aligned by the same code. A module is `moduleWidth` dots wide and a row is
  `rowHeight` modules tall, which is `rowHeight * moduleWidth` dots, the reading
  both languages describe. Nothing is printed when there is no data, when the
  data does not fit the requested size, or when the symbol is wider than the
  print area, the three rules the QR code already followed.
- **ESC/POS defaults** are the ones of the reference: an automatic size, three
  dot modules, rows of three modules, the ratio mode at one tenth, and the
  standard form. **Star defaults** are an automatic size, two dot modules, rows
  of two modules and level 0. Both are only reachable from hand written streams,
  the encoder sets every parameter before it prints.
- **`ESC GS x S 0 n1 n2 n3`** is read as: `n1` of 0 leaves the size to the
  printer and 1 takes the rows of `n2` and the columns of `n3`, where a zero is
  automatic for that one alone. The encoder always sends 1. No hardware check
  settled this, it is the reading that makes the Star receipt print the symbol
  the ESC/POS receipt prints. Those two are the only values of `n1`: any other
  one leaves the size as it was, the way every other out of range parameter of
  both parsers does.
- A parameter outside the range of its command is ignored and leaves the value
  as it was, which is what the other parameter commands of both parsers do.

Testing:

- **ZXing reads the paper.** `@zxing/library` has a PDF417 reader but no
  encoder, so it is an independent check of the whole symbol. Its luminance
  source takes one byte per pixel, not the four of an `ImageData`, which is the
  one thing that has to be right; a symbol of one dot per module with a two dot
  margin already decodes, and the test uses sixteen. Five data sets, a short
  text, mixed case with punctuation, a long run of digits, bytes that are not
  text and two hundred characters of a boarding pass, at levels 0, 2 and 4, at
  an automatic size, at six columns and at thirty rows, in both languages, and
  the truncated form, all decode to what was encoded.
- **The bytes of the binary data set are valid UTF-8.** The reader turns the
  bytes of byte compaction into text as UTF-8 and throws on a sequence that is
  not, which is a property of the reader and not of the symbol, so the data set
  is the UTF-8 of a string with control characters and non-ASCII in it and the
  test compares the strings.
- **bwip-js checks the codewords.** Its raw output is the module matrix, so the
  comparison covers the compaction, the length descriptor, the check codewords,
  the row indicators and the symbol character table in one assertion, at every
  error correction level and in the truncated form. Two of the comparisons are
  bytes over 127, with `binarytext` so that bwip-js reads its input as bytes and
  not through a codepage: no reader turns those back into a string, so a second
  encoder is the only check there is on byte compaction of real binary data.
- **The truncated fixture is a parity exception.** The encoder has no way to ask
  a Star printer for a truncated symbol, so the StarPRNT half of that receipt is
  the standard symbol. The `pdf417` fixture, which does not use the option, has
  parity in both paper and commands.

Acceptance:

- `npm test` 1047 passing, `npm run build` clean, `npm run test:types` and
  `npm run test:umd` pass. Version 0.3.0, nothing published, nothing committed.

### Section 12

Implemented on 2026-09-12. Files: `src/charsets.js` (new), `src/painter.js`,
`src/bitmap.js`, `src/font.js`, `src/renderers/esc-pos.js`,
`src/renderers/star-prnt.js`, `data/profiles/*.json`, `generated/profiles.js`,
`test/painter.js`, `test/bitmap.js`, `test/esc-pos.js`, `test/star-prnt.js`,
`test/parity.js`, `test/star-raster.js` (new), `test/tools/make-fixtures.js`,
the nine hand assembled fixtures in `test/fixtures/<language>/raw`,
`documentation/design.md`, `documentation/commands-esc-pos.md`,
`documentation/commands-star-prnt.md`, `package.json`.

The painter:

- **The additions are the ones of the plan**, plus two the plan's block needed
  to work: `tab()`, because the tab stops live in the painter and the parser
  cannot compute the next one without the font, and the `cursor` getter, which
  is what `ESC \` counts its relative distance from. `characterWidth` is a third
  one, for the Star margins, which are counted in characters by the command and
  in dots by the painter.
- **A line has a cursor and an extent.** The cursor is where the next cell
  goes, the extent is the right edge of the rightmost cell, and the alignment
  centres the extent. They only differ once a line moves its cursor: the space
  of `ESC SP` behind the last character does not shift a centred line, and a
  position that moves back does not shrink it.
- **Margins are only effective at the beginning of a line**, which is what the
  ESC/POS reference of `GS L` and `GS W` says and what Star says of `ESC l` and
  `ESC Q`. A command that arrives while a line holds characters, or while its
  cursor has been moved, is dropped whole, the way the printer drops it; it is
  not deferred to the next line. Blocks are laid out inside the print area, and
  `block(bitmap, {margins: false})` puts a block on the paper instead, which is
  what the rows of the Star raster mode need.
- **Tab stops are dots, not columns.** `tabs()` multiplies by the character
  width of the font that is current when the command arrives, which is what the
  Epson reference describes, so a font change afterwards does not move the
  stops. A character is the cell plus the right side spacing of `ESC SP`, which
  is the unit the reference defines, so a stream that sets a spacing moves its
  stops with it. The default stops, every eight characters of font A, are
  computed at the tab itself.
- **`ESC D NUL` cancels every stop**, as the reference says, and `HT` does
  nothing at all afterwards; `ESC @` puts the default back. The painter says
  the same: `tabs([])` cancels, `tabs(null)` and `reset()` restore the default
  every eight characters. The plan's painter block was corrected to match.
- **A tab to a stop outside the print area moves the cursor one dot beyond the
  area**, so the character behind the tab wraps to a new line, which is what the
  reference of `HT` describes. A tab past the last stop still does nothing.
- **Upside down rotates the line box over the width of the paper**, so a left
  aligned line comes out at the right edge, mirrored. The feed order is
  unchanged, as the plan asks: a printer holds the whole page and prints it
  bottom up, which would need the page mode this renderer does not have. The
  line by line rotation is what a test can check against the upright receipt,
  and that test is in `test/esc-pos.js`.
- **The placeholder is two cells of the fallback glyph** per multibyte
  character, which is exactly the 24 dots a printer gives a Kanji character in
  font A. A hollow box of 24 dots would have been the other option; two cells
  keep the cell cache, the styles and the wrapping working without a second
  kind of cell.
- **`Bitmap.rotate180`** is dot by dot, which is fast enough: it runs once per
  committed line and only while upside down printing is on.

ESC/POS:

- **The horizontal motion unit is tracked as dots per unit**, the other way
  round from the vertical one, which is units per dot. `GS P x y` sets it to
  `dpi / x` with the `dpi` the profiles gained in this section, 203 for both,
  and it is one dot per unit until the command sets it. An Epson starts at
  1/180 inch, which is 1.13 dots, so the default is a simplification in favour
  of the streams that never send `GS P`; it is in the deviation list of the
  reference page.
- **`ESC !` sets and clears.** Bits it does not carry are cleared, so `ESC ! 0`
  is plain font A text, and a `GS !` behind it still decides the size. That is
  the reference, and the test that renders `ESC ! 0x39` against `ESC M 1`,
  `ESC E 1` and `GS ! 0x11` holds it.
- **`ESC G` renders as bold, next to `ESC E`.** A double strike is a second
  pass of the print head, which a thermal printer cannot do at all; the
  overstrike of bold is what its firmware prints. Emphasis and double strike
  are two settings on the printer, so the parser keeps two flags, bit 3 of
  `ESC !` sets the emphasis one, and the painter's bold is their OR: an
  `ESC G 0` behind an `ESC E 1` leaves the text bold.
- **The international character sets are a table of twelve characters per set**
  in `src/charsets.js`, shared by both parsers, and only the positions that
  differ from ASCII end up in the lookup, so set 0 replaces nothing and costs
  nothing in the decode loop. Sets 0 to 15 are the Epson table. **Sets 16 and
  17, Vietnam and Arabia, are listed in the reference but their replacements
  were not in any specification text available here, so both hold the
  characters of set 0 and replace nothing.** The won sign of the Korean set is
  not in any codepage of the codepage encoder, so the font has no glyph for it
  and it prints as the fallback box.
- **Kanji mode reads the lead byte from the code system.** Shift JIS is
  `0x81`..`0x9F` and `0xE0`..`0xFC`, JIS is every pair of bytes from `0x21` to
  `0x7E`, which means that ASCII text in JIS Kanji mode becomes placeholders,
  as it does on a printer. `FS C` accepts 0 and 1 and their ASCII digits. **The
  initial code system is Shift JIS; the reference gives a different initial
  value per model.** A lead byte at the end of the stream has no trail byte and
  prints as a character of its own.
- **`FS !`, `FS -`, `FS S` and `FS W` are parsed and do nothing**, which is what
  the plan asks for. The renderer has one style for single and multibyte text
  and draws the multibyte characters as placeholder boxes, so applying the size
  or the underline of these commands would change the ASCII text around them
  and show nothing of its own.
- **`FS ( C` is reported.** It is the group that selects UTF-8 on the models
  that have it, but its layout was not settled by anything available here, so
  it is consumed with the length it carries and nothing is rendered. UTF-8 text
  therefore prints through the current codepage, which is what a printer
  without the option does.
- **The real time commands are reported, not skipped.** The plan says skipped;
  reporting them costs nothing, a driver that does not ask for `unknown` items
  sees exactly the same paper, and a driver that does can see that a stream
  asked for a real time pulse. `DLE EOT 7 n` and `DLE EOT 8 n` carry two bytes
  and every other `DLE EOT` one; `DLE DC4` is `fn 1 m t`, `fn 2 a b`, `fn 8`
  with its seven fixed bytes, and one parameter byte for `fn 3` and `fn 7`.
  **The lengths of `fn 3` and `fn 7` are the common ones and are not settled by
  a specification text available here.**

StarPRNT:

- **`ESC W n` is a switch and `ESC h n` a multiplier.** `ESC W 1` is double
  width and `ESC W 0` normal, which is how the Star Line Mode documentation
  describes it; `ESC h n` takes the value plus one, the way `ESC i` counts, so
  `ESC h 1` is double height and `ESC h 0` normal. The two readings agree on
  the only values a receipt uses.
- **`ESC Q n` is a column, not a width.** The print area runs from `ESC l n`
  characters to `ESC Q n` characters, so it is `Q - l` characters wide and a
  right margin that is not beyond the left one leaves the paper at its full
  width. That is the reading that makes `ESC l 2` and `ESC Q 40` print exactly
  what `GS L 24` and `GS W 456` print on ESC/POS, which is what the parity
  fixture needs; no hardware check settled it.
- **`ESC SP n` is reported with one argument byte.** The Star Line Mode
  specification text available here does not define a character spacing command
  at all, so nothing is rendered for it and the length is a best effort that
  only keeps the stream in sync. The plan asked for exactly this answer to be
  written down.
- **`ESC R n` uses the Epson table for sets 0 to 13**, which Star numbers the
  same way. Star defines sets above that, Irish and Legal among them, and their
  tables were not available here, so a higher number leaves the set as it was,
  the way every other out of range parameter of these parsers does.
- **The buzzer commands are reported**: `ESC GS BEL m n1 n2` with three
  argument bytes and `ESC GS EM DC1 m n1 n2` and `ESC GS EM DC2 m n1 n2` with
  four, the `DC1` or `DC2` counted. The item stream carries paper, cuts and
  drawers, and no sound.

Star raster mode:

- **`b` and `k` are commands only in raster mode.** They are the letters b and
  k everywhere else, so the parser reads them as a row of dots only while
  `ESC * r A` has been seen and `ESC * r B` has not. Both carry the number of
  data bytes in two bytes, and a row that runs past the end of the stream stops
  the parse without an error, like every other command.
- **A row is the width of the print head.** The data is placed at the left
  margin of the raster, `ESC * r m l n NUL` in bytes of eight dots, and the
  rest of the row is white, so the 72 byte rows of a TSP100 and the trimmed
  rows StarGraphicsPrinterEncoder writes both land in the right place. Data is
  written with an OR, so a `k` row and the `b` row behind it build one row of
  dots together. A row that is wider than the paper is cut off.
- **The buffer is flushed as one block on the paper.** The rows are collected
  until an execute command, a drawer command, `ESC * r B` or the end of the
  stream, and then drawn as one block of the full paper width with
  `{margins: false}`: the rows carry their own position, `ESC * r m l`, so an
  `ESC l` or an `ESC Q` of the line mode must neither shift nor clip them.
- **A move is a blank run, not a list of rows.** `ESC * r Y n NUL` closes the
  row that is being built, which is the first of the `n` dots, and adds the
  rest as one run with a count, so a move of tens of thousands of dots costs
  nothing until the buffer is drawn. `n` is clamped to 65535, a dot count no
  paper reaches, because the parameter is decimal ASCII of any length and a
  job asking for nine digits would otherwise ask for gigabytes of rows.
- **A truncated row keeps the text in front of it.** The text that was gathered
  is handed to the painter before the length of a `b` or `k` row is checked, so
  a stream that ends inside a row behaves like every other truncated command.
- **The mode table decides the cut.** 8 and 9 are a full cut, 12 and 13 a
  partial one, and 3, the tear bar mode of a model without a cutter, is read as
  a partial cut as well, because the item stream has nothing closer to "feed to
  the bar and tear". 0, 1 and 2 print without cutting, and so does every mode
  the table does not define. A job that sets no mode is read at 13, the initial
  value of a model with a cutter.
- **An execute command on an empty buffer does nothing**, which is the
  specification, and the reason StarGraphicsPrinterEncoder sends a blank row
  before a cut that has no rows of its own.
- **A drawer command flushes first.** The specification has the printer ignore
  `ESC * r D` while data is in the buffer; the renderer prints that data and
  then opens the drawer, so the paper is right whatever a stream does. The
  encoder empties the buffer itself, so the difference is not reachable from a
  job it builds.
- **`ESC FF n` is a command with its mode byte**, as it already was, and now
  `NUL`, `EOT` and `EM` execute the stored FF, EOT and EM mode. Any other mode
  byte is reported with the command, so `LF` still does not feed a line.

Fixtures and tests:

- **The hand assembled fixtures live in `test/fixtures/<language>/raw`**, a
  directory next to the encoder fixtures. The fixture helpers take the
  directory as the language, so `names('esc-pos/raw')` is the group, and the
  existing loops over `names('esc-pos')` do not see them: they filter on `.bin`
  files and a directory is not one. That keeps the encoder fixtures and the
  hand written ones apart without a second helper.
- **The tabs fixture shows all three rules**: the first line tabs over the
  default stops every eight characters, the middle lines over the stops of
  `ESC D 10 20 30`, and the last line has no stops at all, because `ESC D NUL`
  cancelled them.
- **Nine fixtures**, in the languages that have the commands: `print-mode`,
  `international`, `tabs` and `margins` in both, `upside-down`, `spacing`,
  `positions` and `multibyte` in ESC/POS only, and `star-raster` in StarPRNT
  only. The four that exist in both print the same paper, and `test/parity.js`
  checks that, with the same profile for both languages as it does for the
  encoder fixtures.
- **Reviewed as ASCII art before they were frozen**: the tab columns land on
  the stops of `ESC D`, on the default stop every eight characters and, behind
  `ESC D NUL`, nowhere at all, the
  upside down lines are the upright ones turned around at the right edge of the
  paper, the print mode lines are double height, double width, both and
  underlined in the right order, the international sets print the twelve
  characters of the German, French, Swedish and Spanish tables, the margins put
  the text between 24 and 480 dots and centre and right align it there, the
  multibyte lines show two fallback boxes per Kanji character, and the raster
  job is a block of dots at the left margin, 24 blank rows, the merged `k` and
  `b` row, and a second block.
- **The round trip of the raster mode** is `test/star-raster.js`: every fixture
  receipt is rendered, encoded to a raster job with StarGraphicsPrinterEncoder
  and rendered again, and both the paper and the items have to come back the
  same. They do for `receipt`, `pulse`, `text`, `table` and `image-column`. A
  job that ends with a feed and nothing behind it, `cut` and `feed`, comes back
  one blank row longer, because the printer ignores an execute command on an
  empty buffer and the encoder gives that last segment one blank row to print;
  the test holds exactly that difference.
- **StarGraphicsPrinterEncoder is a devDependency at `^1.0.0`** and is not
  published yet, so it resolves through `npm link
  @point-of-sale/star-graphics-printer-encoder` from the local checkout until
  it is. A fresh `npm install` without that link fails on it, the way the
  encoder devDependency did before version 4 was published.
- **Argument lengths and truncated streams** are table tests in both language
  test files: every new command is rendered with arguments that change nothing
  and the text behind it has to land where it lands without the command, and
  every new command is then cut off halfway and the stream has to stop cleanly
  with the paper of everything in front of it.

Review:

The first round of this section was returned with nine points, all of them
applied here: the truncated raster row now flushes its text first, `ESC * r Y`
is clamped and holds its blank rows as a count, the raster block is drawn on
the paper instead of inside the line mode margins, `ESC E` and `ESC G` became
two flags whose OR is the bold, `ESC D NUL` cancels instead of restoring and
the character spacing counts in the stop unit, a tab to a stop outside the
print area wraps instead of doing nothing, `GS L` and `GS W` are dropped
instead of deferred while a line is being composed, `ESC * r B` keeps executing
the EOT mode and says in the reference page that this is the specification, and
the deviation lists of both reference pages were made exhaustive. Only the
`tabs` fixture changed with it, in both languages, and it was reviewed again.

Acceptance:

- `npm test` 1302 passing, `npm run build` clean, `npm run test:types` and
  `npm run test:umd` pass. Version stays 0.3.0, nothing committed.

### Section 13

Implemented on 2026-09-12. Files: `src/bitmap.js`, `src/painter.js`,
`src/renderers/esc-pos.js`, `src/renderers/star-prnt.js`, `test/bitmap.js`,
`test/painter.js`, `test/esc-pos.js`, `test/star-prnt.js`,
`test/tools/make-fixtures.js`, the seven hand assembled fixtures in
`test/fixtures/<language>/raw`, `documentation/design.md`,
`documentation/commands-esc-pos.md`, `documentation/commands-star-prnt.md`.

The bitmap and the painter:

- **Two decoders, one for each format.** `Bitmap.fromRaster` clears the padding
  dots past the width of every row it copies, so the invariant the rest of the
  module relies on, that the bytes of a row hold nothing beyond the image,
  holds for every constructor. `Bitmap.fromRaster` reads rows of
  `int((width + 7) / 8)` bytes and `Bitmap.fromColumns` reads columns of
  `int((height + 7) / 8)` bytes, both with the most significant bit first, and
  both leave the rest of the image white when the data is short. Every image
  command of both languages goes through one of the two, `ESC *`, `ESC X`,
  `ESC K` and `ESC L` included, which is what makes the acceptance of this
  section hold by construction: the same picture through ten commands is the
  same picture through two decoders.
- **The painter gained `define(key, bitmap)` and `print(key, {scale})`**, as
  the plan asks, plus `forget(prefix)`, which the delete functions of the
  graphics group need: `GS ( L` function 65 deletes every NV image at once and
  a parser cannot enumerate the keys the painter holds. `define(key, null)`
  deletes one key, so there is no fourth method.
- **`print()` returns a boolean instead of emitting the `unknown` item.** The
  painter has no bytes of the command, so the parser is the only one that can
  report it. A key without an image draws nothing at all and does not commit
  the line that is being composed either, so `AB` `print` `CD` is one line of
  four characters, the way a printer that ignores the command prints it.
- **The definitions live in the painter and survive `reset()` and
  `discard()`**, so they survive `ESC @` and the end of a stream. A second
  renderer starts with nothing, which is a second printer.

ESC/POS, the graphics group:

- **The function codes are the symmetric table of the Epson reference**: 48,
  49, 51 and 52 the capacities, 64 and 80 the key code lists, 65 and 81 delete
  all, 66 and 82 delete one key, 67 and 83 define in raster format, 68 and 84
  define in column format, 69 and 85 print by key code, 112 and 113 store
  raster and column graphics in the print buffer, 50 prints the buffer. The NV
  functions are 64 to 69 and the download ones 80 to 85, the same six commands
  over two memories. **That mapping is the one this implementation used; the
  plan's deliverables were unsure of 66, 68 and 84.**
- **68 and 84 are rendered, where the plan has them parsed and skipped.** They
  are the column format of the define functions, which is the data format of
  function 113 that this section implements anyway, so defining them costs
  three lines and removes a hole: a stream that defines in column format and
  prints by key code would otherwise print nothing.
- **Function 49 sets the reference dot density**, `x y` of 50 for 180 dpi and
  51 for 360 dpi, and it is consumed and not honoured: this renderer draws one
  dot of an image on one dot of the paper, at the 203 dpi of both profiles, so
  a stream that asks for another density prints its image at the size its dots
  have. It is in the deviation list of the reference page.
- **The host answering functions are reported, not skipped.** 48, 51 and 52
  transmit a capacity and 64 and 80 a key code list; there is no channel back
  to the host, so they produce an `unknown` item the way every other request
  for a status does. Only 49 is silent, because it is a setting and not a
  question.
- **`GS 8 L` is accepted for every function of the group**, where the reference
  reserves the long form for the functions that carry data, 67, 68, 83, 84, 112
  and 113. Accepting all of them costs nothing and keeps a stream that uses the
  long form for a delete in sync.
- **The stores stack, they do not overwrite.** Two store functions before one
  print draw their images under each other, the widest one deciding the width.
  The reference says an image is stored in the print buffer and function 50
  prints the buffer, and says nothing about where a second image lands;
  stacking is the reading that loses no dots. `ESC @` throws the buffer away,
  because it is the print buffer of the printer.
- **`bx`, `by`, `x` and `y` of 2 double, everything else is 1.** That is the
  same doubling `GS v 0` does with its mode, and the test compares the four
  combinations against the four modes of `GS v 0` dot for dot.
- **Colour 1 is drawn and the other colours are consumed.** A multiple tone
  image, `a` of 52, is drawn as its colour 1, which is what a single colour
  printer puts on paper. An `a` that is neither 48 nor 52 is not a graphics
  command this renderer knows and is reported with all of its bytes.
- **Out of range is ignored, and the dots that are there bound the rest.** The
  size of a graphics image is not the length of its command, the group length
  is, so a stream can ask for an image of 65535 by 65535 dots behind four bytes
  of data. Two rules answer that. The ranges of the reference are checked
  first, 1 to 8192 dots in the direction the data of the format runs in and 1
  to 2047 across it, `bx`, `by`, `x` and `y` of 1 or 2, `GS *` of 1 to 255 by 1
  to 48 bytes and at most 1536 of them, and the modes 0 to 3 or 48 to 51 of
  `GS /` and `FS p`; a command with a parameter outside its range is consumed
  and ignored whole, which is what the printer does with it, so nothing is
  stored, defined, deleted or printed. And what is left is cut down to the
  rows, or the columns, the data actually holds, data shorter than one row or
  one column being no image at all, so an allocation is never larger than the
  command that asked for it. **`GS v 0` keeps its old reading of an unknown
  mode, an image printed unscaled, because its image is in the same command;
  `GS /` and `FS p` print an image the stream sent earlier, and a mode they do
  not define is a parameter out of range.**
- **A definition never deletes by accident.** A define whose dots are missing
  or whose size is out of range leaves the image that is under its key code
  where it is, functions 65 and 81 delete a whole memory only with their fixed
  `CLR` parameters, and an `FS q 0` is out of range and deletes nothing. The
  bit image commands need no size rule of their own, their length carries the
  whole image.
- **An image that is wider than the paper is clipped, not dropped.** Barcodes
  and symbols print nothing at all when they do not fit, because an unreadable
  symbol is worse than none; an image that is a few dots too wide still carries
  its message, so `block()` draws it at the left of the print area and the
  right edge of the paper cuts it off, which is what a printer does.

ESC/POS, the bit images:

- **`GS *` is column format of `x * 8` columns and `y` bytes**, `x * y * 8`
  data bytes, and there is one downloaded bit image, so a definition replaces
  the one before it. `GS / m` prints it in the four modes of `GS v 0`.
- **`FS q` replaces every NV bit image**, as the reference says, so the images
  of an earlier definition are forgotten before the new ones are stored, and
  the images are numbered 1 to `n` for `FS p`. The length function of `FS q`
  was already in the parser from the fix of section 12 and did not change.
- **The column data of `GS *` and `FS q` is read as the bytes of a column under
  each other, then the next column**, `y` bytes per column and `x * 8` columns,
  the most significant bit of a byte at the top, which is the same order
  `ESC *` and `ESC X` use. **That is the reading of this implementation, and
  the fixtures were generated with the same convention, so the fixtures cannot
  disprove it: only a printer can.**
- **A print of an image or a key code the stream never defined prints nothing
  and reports the command.** That is the whole of the NV logo story: a printer
  holds images a utility put there, the renderer has never seen them, and the
  driver is told that the stream asked for one.
- **The download memory and the downloaded bit image survive `ESC @`**, where a
  printer clears both, because they live in the painter next to the NV ones.
  The task asked for exactly this, and the reference page lists it as a
  deviation: a stream that relies on the clear prints an image where a printer
  prints nothing.

StarPRNT:

- **`ESC FS` became a fourth command group**, next to `ESC`, `ESC GS` and
  `ESC RS`. Without it `ESC FS p 1 0` consumed two bytes and printed `p` as
  text, which was a parser bug of its own.
- **`ESC GS S m n1 n2 n3 n4 n5 d..`** is the raster image: `m` of 1 or the
  ASCII digit 49, the width in bytes of eight dots, the height in dots, a fixed
  byte, and the dots in raster format, exactly the format of `GS v 0`. **That
  layout is the one of the plan and of the reference page and no Star
  specification text was available here to confirm it**; the brief mentioned a
  variant with two bytes in front of the size, which this renderer does not
  read, because two documents of this repository and the reading this
  implementation knows agree on one. An `m` it does not know is reported and
  its data consumed, since the length bytes sit in the same place either way.
- **The raster image is aligned like every other block**, so `ESC GS a 2` puts
  it against the right edge and `ESC l` and `ESC Q` keep it inside the print
  area. Star documents its alignment as applying to bit images as well as to
  characters, and the rows of the raster *mode* of the TSP100 are the exception
  that carries its own position, not the rule. No hardware check settled it.
- **`ESC k` draws one dot per column, the same dots as `ESC L`.** `ESC K` is
  the normal density, which prints every column twice, `ESC L` the fine density
  at one dot per column, and a 203 dpi head cannot print more dots per inch
  than that. **No Star Line Mode specification text was available here.** The
  other reading, merging pairs of columns into one dot, would halve the image
  and lose dots, which this renderer does not do anywhere else.
- **`ESC FS p` is reported**, which is what the plan asks: the logo is in the
  printer. **`ESC FS q` is consumed with the layout of the ESC/POS command of
  the same name, which is an assumption**, and reported: a definition this
  renderer is not sure it parses right must not be drawn, and a length that is
  probably right keeps the stream in sync where consuming three bytes would
  certainly lose it.

Fixtures and tests:

- **Seven hand assembled fixtures**, `graphics-raster`, `graphics-column`,
  `graphics-nv`, `graphics-download`, `download-bit-image` and `nv-bit-image`
  in ESC/POS, and `star-raster-image` in StarPRNT. They all print the same
  picture as the image fixtures of section 4: `make-fixtures.js` runs the
  encoder over the test image, takes the dots out of the `GS v 0` command it
  writes, and transposes them for the commands that carry columns, so the
  comparison with `ESC *` and `GS v 0` is direct.
- **Reviewed as ASCII art before they were frozen**: the circle over the
  checkerboard is centred in every fixture, the raster and the column fixture
  print the same picture, the `bx` of 2 and the `GS / 3` versions are twice as
  wide and twice as tall in the right direction, and the lines behind a print
  of a key code that was deleted or never defined stand on the paper with no
  image above them.
- **No fixture exists in both languages**, so the shared list of
  `test/parity.js` is unchanged. The parity the plan asks for is inside the
  languages: `test/esc-pos.js` renders the same picture through `ESC *`,
  `GS v 0`, `GS ( L` 112 and 113, `GS 8 L` 112, the four define and print
  functions, `GS *` with `GS /` and `FS q` with `FS p`, ten streams in all, and
  compares every one of them with the dots of `GS v 0`; `test/star-prnt.js`
  compares `ESC GS S` with `ESC X`.
- **Argument lengths and truncated streams** are table tests, as in section 12:
  every new command with arguments that change nothing, and every new command
  cut off halfway, in both languages. The ranges have tests of their own: a
  store of 65535 by 65535 dots behind four bytes of data, ten times over,
  leaves the page as empty as the receipt without it, and every out of range
  scale, mode, size and delete parameter is checked for leaving the images and
  the paper alone.

Review:

The first round of this section was returned with eight points, all of them
applied here: the ranges of the reference are enforced before an image is
allocated and both axes are bounded by the dots the command carries, `FS q 0`
deletes nothing, functions 65 and 81 delete only with their `CLR` parameters, a
define whose data is missing or whose size is out of range leaves the image
under that key code alone, functions 69 and 85 need all four parameters,
functions 84 and 82 gained tests and 84 joined the identical dots table and the
truncation sweep, function 49 turned out to be the reference dot density and
says so in the reference page, the host answering functions are reported
instead of skipped, and `Bitmap.fromRaster` clears the padding dots past the
width of a row. No fixture changed a dot.

Acceptance:

- `npm test` 1432 passing, `npm run build` clean, `npm run test:types` and
  `npm run test:umd` pass. The fixtures of the encoder and of section 12 did
  not change a dot. Version stays 0.3.0, nothing committed.

### Section 14

Implemented on 2026-09-12. Files: `src/symbologies/databar.js` (new),
`src/symbologies/index.js`, `src/symbologies/pattern.js`, `src/painter.js`,
`src/renderers/esc-pos.js`, `src/renderers/star-prnt.js`, `test/databar.js`
(new), `test/symbologies.js`, `test/esc-pos.js`, `test/star-prnt.js`,
`test/parity.js`, `test/tools/make-fixtures.js`, the five hand assembled
fixtures in `test/fixtures/<language>/raw`, `documentation/design.md`,
`documentation/commands-esc-pos.md`, `documentation/commands-star-prnt.md`,
`documentation/usage.md`, `README.md`.

The symbology:

- **One module for the four variants**, because they are one construction. A
  number is split over data characters, a character is a number of modules over
  a number of elements, and the value of a character says which combination of
  widths those modules take. `getWidths()` computes that combination, the way
  the specification describes it and the way every implementation of it does,
  and the tables per variant say how many modules and elements each subset of a
  character has, how a value splits over the two subsets and which subset must
  hold a narrow element. Nothing but those tables, the weights of the checksums
  and the finder patterns is data; the widths themselves are computed.
- **The tables came from BWIPP**, which is MIT licensed and is the source the
  PDF417 symbol characters came from as well. They are the tables of ISO/IEC
  24724: `databaromni.tab164` and `tab154` for Omnidirectional, `tab267` for
  Limited, `tab174` for Expanded, with the checksum weights and the finder
  patterns of each. The Expanded table was confirmed a second time against the
  reader of ZXing, whose `SYMBOL_WIDEST`, `EVEN_TOTAL_SUBSET` and `GSUM` hold
  the same numbers in the decode direction.
- **Omnidirectional** takes thirteen digits, or fourteen with the check digit,
  which is validated: a wrong one prints nothing. The thirteen digit value is
  split into a left and a right half over 4537077, each half into an outside
  character of sixteen modules and an inside one of fifteen over 1597, and the
  checksum is the element widths of the four characters weighted with the table
  of the specification, modulo 79. Two of the eighty one pairs of finder
  patterns do not exist, so the checksum is bumped past 8 and past 72, and the
  quotient and the remainder over nine pick the left and the right finder. The
  symbol is 96 modules: a guard of a space and a bar, the outside character,
  the left finder, the inside character reversed, the right inside character,
  the right finder reversed, the right outside character reversed, and a guard.
  The space of the left guard is a quiet zone module that `toBars()` drops, so
  95 modules land on the paper.
- **Truncated is the same symbol**, thirteen modules tall instead of at least
  thirty three. There is no second encoder for it: the bars are the bars of
  Omnidirectional, and the test asserts exactly that.
- **Limited** takes a GTIN that starts with a zero or a one, splits it over
  2013571 into two data characters of 26 modules in seven elements per subset,
  and weights their 28 element widths modulo 89. The check character is not a
  data character: the 89 values of the checksum select a value from a table of
  the specification, whose quotient and remainder over 21 are the values of the
  six spaces and the six bars of eight modules each, with a space and a bar of
  one module behind them, 18 modules in all. The symbol is 79 modules, of which
  73 are printed: the module in front of the left guard bar and the five module
  space of the right guard are quiet zone and are not drawn.
- **Expanded** takes a GS1 element string with its application identifiers in
  parentheses, which is the form both specifications give for the data of this
  symbology and the form the encoder passes through untouched. The element
  string is split into identifiers and values, and an identifier whose first
  two digits are not one of the 22 predefined length prefixes is closed with a
  separator when data follows it, which is the rule of the GS1 General
  Specifications and the table BWIPP uses.
- **Every encodation method of the specification is implemented**, not only the
  general one: `1` for AI (01) with a field behind it, `00` for anything else,
  `0100` for a weight in AI (3103), `0101` for AI (3202) and (3203), the eight
  seven bit methods of a weight in AI (3100) to (3109) or AI (3200) to (3209)
  with an optional date in AI (11), (13), (15) or (17), and `01100` and `01101`
  for the price of AI (392x) and the rate of AI (393x). **The seven bit methods
  hold those twenty identifiers and nothing else of the 31xx and 32xx blocks**;
  the review of this section found the first version testing the whole two
  blocks, which encoded 540 of the 800 element strings of that space the wrong
  way. The test now sweeps all of 31xx and 32xx, with and without a date. The selection rules, the limits on each
  weight and the layout of each compressed field are the ones of the reference
  encoder, and every one of them is compared with it in the test. The general
  purpose field behind them is the numeric, alphanumeric and ISO 646 compaction
  of the specification with its latches, its run length rules for latching back
  to numeric compaction, and the four to six bit form of a last digit that fits
  in what is left of the symbol.
- **The check character of Expanded is a data character**, the first one of the
  symbol: the element widths of the data characters are weighted with the
  weights of the finder sequence, skipping the eight that belong to the check
  character itself, modulo 211, plus 211 for every character above three. The
  finder sequence is the table of the specification, indexed by the number of
  symbol characters, and the characters are drawn forwards and backwards by
  turns with a finder pattern in front of every pair.
- **Stacked and composite are out of scope**, as the plan says. The two
  dimensional GS1 DataBar of `GS ( k` keeps its `unknown` item.
- **Data that is not valid prints nothing**, which is the rule the other
  symbologies already follow: a length that is not thirteen or fourteen digits,
  a character that is not a digit, a check digit that does not match, a Limited
  GTIN that starts with something else, an element string that is not in the
  parentheses form, a character that no compaction method of Expanded holds,
  such as `@`, and data that does not fit in the 22 symbol characters of a one
  row symbol.

The painter and the parsers:

- **The height of a symbol can come from the symbology.** `Barcode` gained an
  optional `height` of `{fixed}` or `{minimum}` modules, which only this family
  sets, and `painter.barcode()` turns it into dots with the module width: the
  height of Truncated is 13 modules and of Limited 10, whatever `GS h` or `n4`
  says, and Omnidirectional is at least 33 modules and Expanded at least 34.
  The alternative was to put the rule in both parsers, which would have meant
  the parsers knowing what a symbology number means. **ISO/IEC 24724 words all
  four of those numbers as minimums, and the printer notes of both languages
  are remembered as the height command having no effect on this family at all.
  No hardware check settled either reading here. The split above is the one
  this implementation chose: Truncated and Limited fixed, so that a tall
  `GS h` does not turn a Truncated symbol back into the Omnidirectional one it
  has the bars of and the two stay visibly different, and Omnidirectional and
  Expanded as minimums, so that a receipt can still ask for taller bars.** It
  is in the deviation lists of both reference pages.
- **The symbology numbers are the ones of the two references**, 75 to 78 of
  `GS k` and 10 to 13 of `ESC b`, taken from the encoder's own tables. They go
  through the same path as every other symbology, so the module width of `GS w`
  and of `n3`, the human readable text of `GS H` and the alignment work the way
  they already did. The `unknown` item these numbers used to produce is gone.
- **The human readable text is the element string in parentheses**, `(01)` and
  the fourteen digits of the GTIN for the first three variants, and the element
  string as it was given for Expanded, which is what a printer prints under
  these symbols.

Testing:

- **bwip-js is the reference encoder.** Its raw output for these symbologies is
  the element widths of the symbol, which is the shape this package produces,
  so a comparison covers the tables, the checksum, the finder patterns, the
  compaction and the layout in one assertion. Its GS1 linter is turned off with
  `dontlint` and `lintreqs`: it refuses element strings that no shop would
  print, and a printer encodes whatever the stream asks for.
- **The counts.** 982 symbols of the generator are compared with bwip-js: 8
  GTINs for Omnidirectional and the same 8 for Truncated, 6 for Limited, 30
  element strings for Expanded, at least one per encodation method and one per
  compaction method with the identifiers of the 31xx and 32xx blocks that have
  no compressed method among them, a generated batch of 920, which is 120
  element strings over the general purpose methods with every run length that
  decides a latch and 800 over the whole 31xx and 32xx space with and without a
  date, and the ten of the five pairs that pin the weight range. The same
  values are then rendered through both parsers and read off the paper, 102
  symbols, and the ten symbols of the five fixtures in the two languages are
  read off the paper as well. Every one of the 1094 matches module for module.
  A sweep of 600 random GTINs and 500 generated element strings was run against
  bwip-js while the symbology was written, with the same result; it is not in
  the test suite, where the fixed batches cover the same ground in a second.
- **ZXing reads RSS-14.** `RSS14Reader` decodes all 36 Omnidirectional and
  Truncated symbols of the test back to their fourteen digit GTIN, from the
  paper of both languages and from the fixtures, with the white margin a
  printer does not print. Its finder pattern search is a heuristic that a data character
  sometimes satisfies before the finder does, and the reader gives up instead
  of looking further; of the values that were tried, `0361234567890` and
  `0614141999996` are two it cannot read, and it cannot read the symbols
  bwip-js produces for them either, so the test uses values it reads.
- **ZXing cannot read the other two.** There is no reader for Limited at all.
  There is an `RSSExpandedReader`, but the port of it in `@zxing/library`
  0.21.3 reads nothing: it finds no pair in a symbol at all, so its finder
  pattern search is what fails first. Behind that failure sit two faults that
  are just as fatal but never reached: `checkChecksum()` calls `get()` and
  `size()`, the methods of a Java `List`, on a plain array, and
  `decodeDataCharacter()` computes its group as `(13 - oddSum) / 2`, which is
  never a whole number for a seventeen module character and indexes the group
  tables with a fraction. Its decoders, which can be driven by hand, do read
  the structure of a symbol but append the digits of a value with a string
  builder that turns a number into the character of that code point, so
  `(01)9` comes out followed by the characters 61, 414, 100 and 1. The reader
  reads no symbol bwip-js produces either, which is how the fault was placed
  with the reader and not with this encoder. Both variants are therefore
  checked against bwip-js only, which the plan allows for Limited and which is
  the same evidence the other three have: the modules of a second, independent
  encoder.
- **The fixtures** are five hand assembled receipts in both languages,
  `databar-omni`, which prints the symbol with and without its text,
  `databar-truncated`, `databar-limited`, `databar-expanded` and
  `databar-coupon`, a coupon receipt of a header, an offer, a DataBar Expanded
  of AI (8110) and a line of small print. The encoder can write these commands,
  but only for a printer profile that lists the symbology, so the streams are
  written out by hand like the ones of sections 12 and 13. All five have parity
  between the languages, with a module width the encoder itself would not
  pair: it passes its width option through unchanged, as `GS w n` on ESC/POS,
  where this family is the exception that does not add one, and as `n3` on
  StarPRNT, which this renderer reads as 2, 3 or 4 dots, so the same option
  draws a Star symbol one dot wider per module. The fixtures pair the values
  that land on the same dots instead, `GS w 3` with an `n3` of 2 and `GS w 2`
  with an `n3` of 1, which a hand assembled stream is free to do.
- **Reviewed as ASCII art before they were frozen**: the bars of every variant
  with the element string readable under them, `(01)09521234543213` under the
  first three and `(8110)106141410123456101100` under the coupon, the Truncated
  symbol thirteen modules tall next to the Omnidirectional one at a hundred
  dots, the Limited symbol ten modules tall, and the coupon receipt with its
  bold header above the symbol and its small print below it.
- **The parsers** gained the argument length and truncated stream tests of the
  four new symbology values in both languages, next to the ones of sections 12
  and 13, and the rendering tests of the heights, the module widths and the
  data that prints nothing.

Acceptance:

- `npm test` 1554 passing, `npm run build` clean, `npm run test:types` and
  `npm run test:umd` pass. The fixtures of the encoder and of sections 12 and
  13 did not change a dot, and the Section 4 barcode tests and the parity test
  are unchanged. Version stays 0.3.0, nothing committed.

### Fixtures regenerated with encoder 4.0.0, 2026-09-12

The golden fixtures were regenerated with ReceiptPrinterEncoder 4.0.0, linked from the local checkout before it was published. 38 byte streams changed, because version 4 emits fewer style commands, orders a pending font change before the alignment padding and no longer feeds after lines that only change printer state. On paper 36 fixtures changed: every block fixture lost the blank line that used to precede the block, 30 dots on ESC/POS and 32 on StarPRNT, and the `receipt` and `hri` fixtures kept their height but gained a centred first line, which the encoder's initialize fix made possible. The text fixtures are byte for byte the same paper as before, which is the end-to-end check of both libraries the design asked for.

The devDependency range stays at `^3.0.0` until 4.0.0 is published, so a fresh `npm install` resolves; regenerating with 3.0.3 would revert these fixtures, so bump the range and regenerate together once the encoder is on npm.

### Section 16

The fixture layout, the provenance format and the generic test:

- **`test/fixtures/external/<library>/`** holds the four files per fixture the
  plan asks for, `<example>.bin`, `.pbm`, `.items.json` and `.json`, plus the
  `LICENSE` of the library once. The provenance has the thirteen fields of the
  plan and one more, in the order the plan writes them; the typedef and the
  field list live in `test/helpers/external.js`, which is also what the test
  reads them with, and `tools/external/shared.js` writes them through that list,
  so a capture script cannot invent a field or leave one out.
- **The one added field is `setup`**, which the plan allows when the typedef and
  the test's field list are updated with it, and both are. A capture that needs
  a virtual environment or a composer install is only reproducible when the
  install is written down next to the invocation, and folding both into
  `command` makes that field unreadable. `setup` prepares the machine and
  `command` produces the bytes:

  | Library | `setup` | `command` |
  |---|---|---|
  | receiptline | `npm install` | `node tools/external/receiptline/capture.js <name>` |
  | python-escpos | `python3 -m venv build/external/python-escpos/venv && …/bin/pip install "git+…@<commit>"` | `build/external/python-escpos/venv/bin/python tools/external/python-escpos/capture.py <name> && node …/capture.js <name>` |
  | escpos-php | `composer require mike42/escpos-php:v2.2 -d build/external/escpos-php` | `php tools/external/escpos-php/capture.php <name> && node …/capture.js <name>` |
  | ESCPOS_NET | `npm install` | `node tools/external/escpos-net/capture.js <name>` |

  The virtual environment and the composer install live under `build/`, which is
  gitignored, so the paths in the two fields are the ones that work from a fresh
  checkout.
- **A capture of one fixture leaves the others alone.** The Python and the PHP
  script hand what they captured to their Node side through an `index.json`
  under `build/`, and they merge their entries into that file instead of
  replacing it, so running the `command` of one provenance does not throw the
  index of the other fixtures of the library away.
- **`test/external.js`** walks every library and every fixture and makes the
  three checks: the paper equals the golden PBM, the items equal `items.json`,
  and the `unknown` count of the provenance equals the number of unknown items
  in `items.json`. It also checks that the provenance has the documented fields
  and nothing else, that the licence is one of the permissive three, and that
  the library has a `LICENSE` file. Every fixture is rendered with the unified
  renderer, with `commands: ['cut', 'pulse', 'feed', 'unknown']` and the
  language, width and mapping of its own provenance.
- **`npm run contact-sheet`** renders every fixture to PNG under
  `build/contact-sheet/`, writes the SVG preview of receiptline's documents next
  to them and an `index.html` that lists every fixture with its provenance.
  `build/` is in `.gitignore` and nothing it writes is committed.

Libraries, 104 fixtures with 296 unknown items in total:

| Library | Fixtures | Unknown items | Which commands |
|---|---|---|---|
| receiptline 4.0.4 | 84 | 269 | `GS a` 37, `GS r` 37, `FS ( A` 27, `ESC RS a` 47, `ESC SP` 37, `ESC s` 37, `ESC GS ETX` 37, `ESC ACK SOH` 10 |
| python-escpos 3.2.dev81 | 7 | 26 | `GS b`, the smoothing mode, 26 |
| escpos-php v2.2 | 8 | 1 | `ESC e`, the reverse line feed, 1 |
| ESCPOS_NET ac185fc | 5 | 0 | none |

Every unknown item is a status, a setup or a smoothing command that changes
nothing on the paper, with one exception: `ESC e`, the reverse line feed of the
escpos-php demo, which a printer performs and this renderer does not, so that
fixture is three lines taller than the paper would be.

**Section 16c emptied this table.** `ESC e` is rendered, `ESC SP` is read as the
character spacing it is and the rest are parsed with no item, so the 296 unknown
items of the two sections are 0; the counts above are what the capture found at
the time, and the before and after are in the notes of that section.



What the captures found in the renderer, all three fixed here:

- **`ESC GS A` and `ESC GS R`, the Star print positions, were missing.**
  receiptline lays every column of every table out with them, and without them
  the two argument bytes of each command printed as text and the columns
  collapsed: the first capture of `receipt-starsbcs-48` was visibly corrupt.
  They are now rendered as the dot positions they are, absolute and relative
  from the left margin, the counterparts of `ESC $` and `ESC \`. The proof is
  the parity test: the same document through `escpos` and through `starsbcs` is
  now the same paper, dot for dot, apart from the three differences receiptline
  itself makes.
- **`ESC k` is a band of twenty four dot rows, not an eight dot strip.** Section
  13 had to guess this command without a specification text and read it as an
  `ESC L` at quadruple density: two length bytes and one byte per column.
  receiptline prints every image of Star Line Mode with it, as `ESC 0` followed
  by bands of `nL + nH * 256` bytes per row and twenty four rows each, and under
  the old reading the remaining twenty three rows of every band printed as text.
  Under the new one the logo of `receipt-starlinesbcs-48` is dot for dot the
  ESC/POS logo of the same document, which is what settles it. The reference
  page says where the reading comes from.
- **`ESC b` takes its symbology and its module width as ASCII digits too.**
  receiptline writes `ESC b '6' '1' '1' 48` for a Code 128, the way a Star
  printer takes most of its arguments, and the renderer only had the binary
  numbers, so the barcode of `line-width-starsbcs-48` was reported and not
  drawn. Both tables carry the digit forms now, which cannot collide: the
  numbers stop at thirteen and the digits start at forty eight. Only the
  symbologies numbered 0 to 9 get one, so the four bytes behind the nine, `:`
  to `=`, stay undefined and are reported rather than drawn. The module width
  table gained the values receiptline writes for the symbologies Star gives
  their own element widths, 4, 5 and 6 for Code 39 and Codabar and 8 for ITF;
  it stays flat, so the one value that means two things, the widest ITF, keeps
  the width of the general case. No golden changed with it: the only external
  fixture with one of those values is the Code 39 of `guest`, at the width where
  the flat table already gave the right answer.
- Two lengths were wrong as well and made the stream drift: `ESC s n1 n2`, which
  receiptline sends in its printer setup, consumed two bytes instead of four,
  and `ESC ACK SOH` two instead of three. Both are in the argument length table
  now and are reported.

**The data of code set C is a sequence of pair values, not digit characters.**
receiptline writes an ESC/POS Code 128 as `{C` `0x00` `0x03` for `0003` and
escpos-php as `{C` `0x15` `0x20` `0x2b` for `213243`: one byte per digit pair,
carrying the value of that pair, 0 to 99. That is what the Epson specification
says the data of `{C` is, and two independent libraries send it that way, so the
renderer follows the specification now and the reading of section 4 changed:

- Inside `{C` a byte is a pair value. A byte of 100 or more is no pair and
  switches to code set B, which is the only thing a printer can do with it, and
  the human readable text of a code set C run is the two digits of every pair.
- **The `code128` fixture of section 4 was regenerated in both languages.** It
  drops the `{C1234` case, which was the digit form, keeps `{BABC-123`, and
  prints a specification form `{C` `0x00` `0x03` `0x0c` `0x22`, the pairs 00,
  03, 12 and 34, on ESC/POS alone: the StarPRNT encoding strips the code set
  selection, so the same value is read as four characters there. `code128` is
  therefore an exception of `test/parity.js`, with its reason and with the rule
  for its items in the new `ITEMS` table next to `EXCEPTIONS`.
- StarPRNT does not change at all. It never sees a `{C`, the encoder strips it,
  and the printer picks the code sets from the digits.
- **An encoder pitfall to document in ReceiptPrinterEncoder**: it passes a
  user-supplied `{C` through unchanged, digit characters included, so
  `barcode('{C1234', 'code128')` prints `49505152` on a real printer and here.
  The encoder never emits `{C` itself, it prepends `{B` to a value without a
  brace and its version 3 documentation dropped code set selection altogether,
  so only a legacy caller writes one, and that caller's receipt is wrong on
  paper too. Worth a line in the encoder's barcode documentation.
- The goldens that changed with it: `esc-pos/code128`, `star-prnt/code128` and
  the two external fixtures that carry a code set C barcode,
  `receiptline/line-width-escpos-48` and `escpos-php/barcode`.

receiptline, the decisions of the open items and what the review found:

- **84 fixtures**: the twenty one English documents through `escpos` and
  `starsbcs` at 48 columns, 42 of them; the five documents of the subset,
  `receipt`, `receipt2`, `guest`, `column_border1` and `text_decoration`,
  through `generic`, `starlinesbcs` and `stargraphic` at 48 columns and through
  all five sets at 32 columns, 40 of them; and `receipt` through `escpos` and
  `starsbcs` once more in the `multilingual` encoding, 2 of them. Everything
  else is `cp437`.
- **The documents are not copied.** They ship with the npm package, in
  `example/data/en`, and the capture script reads them out of `node_modules`;
  the provenance names the repository, the file and the commit of the v4.0.4
  tag, `f93b674`.
- **The mapping of the ESC/POS sets is `epson`.** `escpos` and `generic` share
  the codepage table of receiptline's `_escpos`, which is the Epson one:
  `ESC t 0` cp437, `ESC t 16` windows1252, `ESC t 19` cp858. They also draw
  every ruled line with `ESC t 1` and the bytes `0x90` to `0x9f`, which are the
  box drawing characters of the Epson katakana page, and no other mapping
  decodes those to lines. `generic` differs from `escpos` in its images, `GS v 0`
  instead of `GS 8 L`, and in writing its arguments as binary numbers rather
  than ASCII digits; both render the same paper, which the parity test checks.
- **The `multilingual` encoding changes nothing visible here**, because the
  English documents are ASCII: receiptline's `multiconv` only emits an `ESC t`
  for a byte above 127, so the two multilingual fixtures carry no codepage
  command for their text at all and exercise the initial codepage instead. The
  codepage switching the plan wanted from this encoding is in the Japanese
  documents, which are out of scope.
- **`stargraphic` prints images and paper feeds and nothing else.** Its command
  set inherits the empty `text`, `align`, `hr` and `vr` of receiptline's base
  set, so a document without an image comes out as blank paper of the right
  height, and one with an image comes out as the image alone. receiptio, the
  console application, rasterizes the whole receipt itself before it hands it to
  this command set; `receiptline.transform()` alone does not. The ten
  `stargraphic` fixtures are therefore a test of the raster mode wire format,
  `ESC * r A`, `ESC * r P`, `ESC * r Y`, the `b` rows and `ESC * r B` with the
  cut of its default mode, and not of the layout. They are kept for that, and
  they are the only fixtures whose golden image is nearly empty.
- **The review** compared every golden image with receiptline's own SVG preview
  of the same document. 74 of the 84 renders are exactly the size of the
  preview, width and height; the previews are not committed, as the plan
  decided, and the contact sheet regenerates them. The ten that differ are the
  eight `stargraphic` ones above, and the two `kitchen` fixtures, where the
  lines of equals signs of the document are paper cuts: the preview draws a cut
  as a line of its own and this renderer reports it as an item and draws
  nothing, so the paper is two lines shorter. Every fixture was also read as a
  PNG next to receiptline's plain text rendering of the same document.
- **The parity test** groups the fixtures by document, width and encoding, and
  checks that the two ESC/POS sets render the same paper, that the two Star text
  sets do, and that the two groups agree with each other. `stargraphic` is
  outside the comparison for the reason above. Three differences receiptline
  itself makes are in the exception list, each with its reason:
  - **The corners of a box.** receiptline draws the ruled lines of ESC/POS out
    of the Epson katakana page, where the corners are the rounded `╭ ╮ ╰ ╯`, and
    the ones of StarPRNT out of cp437, where they are the square `┌ ┐ └ ┘`. Two
    dots per corner, and it is why almost every document with a border is an
    exception.
  - **The underline.** receiptline asks ESC/POS for the two dot underline with
    `ESC - 2` and StarPRNT for the one dot it has with `ESC - 1`.

  Code 128 was a third difference until the capture settled it, see the decision
  below; the two languages now draw the same symbol for the same document.

python-escpos:

- **7 fixtures** from the examples of the repository at commit `f5ed42f`, run
  against its `Dummy` printer in a throwaway virtual environment under `build/`
  with the library installed from that same commit, so that the examples and the
  library match. The printer classes the capture replaces with its own `Dummy`
  are snapshotted before an example runs and put back in a `finally` behind it,
  so that the next example subclasses the library's own class again and no
  profile leaks from one capture to the next. The examples: `barcodes`, `block_text`, `font_variations`, `qr_code`, `receipt`,
  `software_barcode` and `software_columns`. The capture replaces the `Usb`
  printer of two of them with a `Dummy` of the same profile and changes nothing
  else.
- **Three examples of the directory are skipped** and the capture script says
  why: `weather` fetches a forecast over the network, `docker-flask` is a web
  service, and `codepage_tables` passes strings to `_raw()`, which `Dummy.output`
  cannot join in this version, so it raises before it prints anything. The
  codepage switching the plan wanted from python-escpos is therefore not in the
  set; `ESC t` is still exercised, by the magic encode of the other examples.
- **The profile decides the width.** The provenance records the profile and the
  print width comes from the paper of that profile, rounded down to whole bytes:
  `TM-T88II` 512 dots, `TM-P80` 576, `POS5890 Series` 384, `TM-U220` 400. Where
  the profile's own column count disagrees with that paper at the twelve dot
  cell of font A, the notes of the fixture say so. It is visible in
  `software_columns`: the `TM-U220` profile reports 42 columns because the font
  of a dot impact printer is narrower than a thermal one, its paper is 400 dots,
  and the third column of every row therefore wraps here.
- **Its QR code is an image.** `qr()` defaults to the software implementation,
  so `qr_code` is a `GS ( L` graphic and not the native `GS ( k` symbol. The
  render decodes to the URL the example encodes, checked with jsQR.
- **The software barcode of `barcodes` is cropped in the source image**: the
  human readable text runs into the last row of the image python-escpos sent,
  so it prints clipped. That is in the bytes, not in the render.
- The one unknown command is `GS b`, the smoothing mode, which
  `set_with_default()` sends with every style change.

escpos-php:

- **8 fixtures** from the examples the composer package ships, v2.2, commit
  `e5496cf`, captured by running each example against its `FilePrintConnector`
  on `php://stdout`: `demo`, `barcode`, `character-encodings`,
  `character-tables`, `margins-and-spacing`, `pdf417-code`, `qr-code` and
  `text-size`. PHP 8.4 is on this machine, so the capture runs rather than
  taking streams from the tests.
- **The subprocess is told `display_errors=stderr`.** escpos-php 2.2 has
  deprecations on PHP 8.4 and PHP CLI writes its notices to stdout, which is the
  same stream the receipt goes to; without the flag the notices land in the
  middle of the byte stream, which the first capture showed.
- **Four examples are skipped for the image loader.** `EscposImage::load()`
  returns a zero by zero image on PHP 8.4 with the gd of this machine, so
  `graphics`, `bit-image`, `print-from-html` and
  `character-encodings-with-images` print an error message and no image. Those
  are the examples that would have exercised `ESC *`, `GS v 0` and `GS ( L`;
  the python-escpos fixtures cover all three instead. `customer-display` opens a
  serial device, `print-from-pdf` needs imagick, `rawbt-receipt` stops on an
  undefined variable and `receipt-with-logo` needs a class the example directory
  does not carry.
- The one unknown command is `ESC e`, the reverse line feed of the demo.

ESCPOS_NET:

- **5 fixtures** and nothing run: the byte arrays of `PrintQRCode_Success` in
  `ESCPOS_NET.UnitTest/EmittersBased/EPSONTests/BarCode.cs`, commit `ac185fc`,
  assembled the way the test assembles them. The theory has sixty rows over
  three QR models, five module sizes and four correction levels; five rows are
  captured, spread over the models and the sizes, so that the eye review stays
  possible. All five decode to the URL the test encodes, checked with jsQR; the
  micro model is drawn as a model 2 symbol, which is the documented divergence
  of the QR commands.

react-thermal-printer and node-escpos are **not captured**, and the reason is
the same for both: neither library's own examples run under Node. The example of
react-thermal-printer is a Vite application in TSX that drives a Web Serial
port, and the demo of node-escpos is TypeScript built with unbuild that prints
through the USB adapter, which needs the native `usb` module. Driving either
library from a receipt written here instead would be capturing our own example
rather than theirs, which is what this section is not for. They are the
follow-up the plan allows for the last three libraries.

Acceptance:

- `npm test` 2029 passing, lint clean over the new tools and tests. The
  fixtures of sections 2 to 14 did not change a dot; the three renderer fixes
  above are additions and one corrected reading, and the only test that changed
  is the `ESC k` test of `test/star-prnt.js`, which now checks the band.
- The contact sheet builds and shows all 104 fixtures with their provenance and,
  for receiptline, the SVG preview next to the render.
- Version stays 0.3.0, nothing committed.

### Section 16b

Part A, the sample streams. **19 fixtures over two new sources, 0 unknown items in all
of them**, which brings the external suite to 123 fixtures:

| Source | Fixtures | Unknown items | What they carry |
|---|---|---|---|
| ESCPost 0.2.1, `c4a7665`, Apache 2.0 | 18 | 0 | the two example jobs, the calibration job of the profiles crate and the fifteen inputs of its eleven render cases |
| escpos-tools `4311694`, MIT | 1 | 0 | the one ESC/POS sample of the repository, `receipt-with-logo.bin` |

- **Nothing of zachzurn/thermal is captured, and the reason is its licence.**
  `sample_files/in/README.md` of that repository is one line: "None of the files
  in this directory are covered by this repositories license." The repository is
  MIT or Apache 2.0, its sample directory is neither, and section 16 captures
  only what a permissive licence covers, so the six binary samples are out. The
  hunt for their origin found one of them: `test_receipt_2.bin` is byte for byte
  `receipt-with-logo.bin` of escpos-tools, MD5 `72769732558bb9dc9ff97a49fcbe96b8`
  for both, and that repository's MIT licence does cover it, so the stream is in
  the suite once, under escpos-tools, and the capture script of that source says
  where else it turns up. The other five are Epson demo receipts and one stream
  that carries `https://nielsleenheer.com`, none of them with a licence to point
  at. thermal is a reference renderer in part B instead, which needs no licence
  for anything that is committed: its render of a fixture is generated into
  `build/` and thrown away.
- **The `.thermal` samples were not converted either.** The human readable
  format has a converter in the project itself, `thermal_parser::thermal_file::parse_str`,
  and the shim of part B could call it, so the "convert it if you can run it"
  case is decided by the same licence line rather than by the toolchain: the
  bytes it would produce are the bytes of a file that disclaims the licence.
- **ESCPost ships more than example receipts.** `example-jobs` holds two `.hex`
  jobs, and the eleven render cases of `escpost-render` hold fifteen more, four
  of them the DataBar probes of one case, each with a
  `case.toml` that names its printer profile, a `notes.md` that says which
  commands it exercises and an expected PNG of ESCPost's own render. They are
  written to walk a command group rather than to print a receipt, which is why
  they reach commands no library of section 16 sends: every density of `ESC *`,
  every scaling mode of `GS v 0`, `ESC 2`, `ESC J`, `GS P` and the GS1 DataBar
  selectors of `GS k`. All fifteen inputs are captured, plus the two example jobs and
  the calibration job of `escpost-profiles`, which is the sheet a new profile is
  measured with. The two files that are duplicates of another case,
  `crates/escpost/tests/fixtures/cases/{single,multi}-sheet/input.hex`, are not
  captured twice, and neither is `render-workload.hex`, which is the calibration
  job again.
- **The width comes from the profile.** `printable_width_dots` of
  `profiles/REFERENCE/profile.toml` is 576 and of `profiles/NT-5890K` 384, and
  both give font A a twelve dot cell, so the fixtures are 48 and 32 columns. The
  three samples that name no profile, the two example jobs and the calibration
  job, are 576 dots and their notes say the sample gave no width, which is the
  rule of this section.
- **The escpos-tools sample names no width either** and is 576 dots for the same
  reason; it is the output of the receipt-with-logo example of escpos-php, an
  80 mm receipt, and its logo is a `GS ( L` graphic.
- **escpos-emulator ships no samples.** The npm package is `dist` and nothing
  else, and its repository has a `test-print.ts` that generates a receipt rather
  than a sample file. It is a reference renderer in part B and contributes no
  fixture.
- **Not one of the nineteen produces an unknown item.** These streams are
  written against renderers, so they stay inside the commands a renderer is
  expected to have, and this one has all of them. Since section 16c none of the
  other 104 fixtures produces one either.

The eye review of all nineteen, against ESCPost's expected PNGs, against thermal's
own renders and as ASCII art, is in the `notes` of every provenance. Five of them
found a real difference, and all five are properties of the other renderer's
printer profile rather than of this renderer:

- **`graphics-gs-v0-all-scaling-modes`**, 138 dots here against 48 there, with
  the same 48 ink rows. The case runs on the NT-5890K profile, whose firmware
  swallows the LF that follows a raster image; this renderer follows the Epson
  baseline, where that LF feeds a line, so the four images are a line apart here
  and adjacent there. ESCPost's own notes for the case describe both behaviours.
- **`motion-line-spacing-and-feed`**, markers at 0, 30, 38 and 48 here against
  0, 30, 40 and 60 there. Two causes: the Epson profile of this renderer counts
  two vertical motion units per dot, so `ESC 3 10` is five dots and not ten, and
  a line is never shorter than the eight dot band the `ESC *` of that line puts
  on it.
- **`motion-positioning-and-print-area`**, the same 120 dots and the same 96 ink
  rows, with the last two markers in different columns: the calibrated NT-5890K
  ignores an `ESC $` after printable data and a negative `ESC \`, which the case
  calls a firmware quirk and which this renderer does not imitate.
- **`mechanism-full-and-partial-cuts`**, 120 dots here against 280 there, same
  ink rows. A cut is an item here and the paper stops; ESCPost makes a sheet per
  cut and pads every sheet to the distance between the print head and the
  cutter.
- **`symbols-native`**, 600 against 592 dots with the same 374 ink rows and the
  barcodes on the same dots. The QR symbol is the same version and size with a
  different mask, which two encoders may choose differently.

Part B, the reference renderers. **Two tools, both of which render to dots**, and
the page degrades to "not available" when a binary is not there:

| Tool | Ran | What it needed | Fixtures rendered |
|---|---|---|---|
| thermal `9456874` | yes | a Rust toolchain and the shim crate of this repository | 76 of 76 ESC/POS fixtures |
| ESCPost 0.2.1 | yes | a Rust toolchain, the workspace at `c4a7665` | 24 of 76, it refuses the rest |

- **The two HTML renderers were built and then dropped, by decision of the
  maintainer.** `esc2html` of escpos-tools and escpos-emulator both read a stream
  and write markup, and markup is not what this page compares: a div with a class
  on it says nothing about whether the paper agrees, it has no dots to count ink
  rows in and no height to measure, so neither could carry the agreement metric
  and neither could answer the one question the sheet exists to ask. They are
  gone, with the escpos-emulator dev dependency and its lock entries. For the
  history: `esc2html` never ran here anyway, because every image command of its
  parser builds its picture with `new Imagick()` and `php -m` on this machine has
  gd and no imagick. escpos-tools stays a sample source, its `receipt-with-logo`
  fixture and all, and escpos-emulator contributes nothing at all.

- **There is no prebuilt binary for either Rust tool.** thermal has no releases
  at all, and the three releases of ESCPost carry no assets, so the toolchain was
  the only way. rustup was installed into the scratchpad alone, with `CARGO_HOME`
  and `RUSTUP_HOME` pointed at it and `--no-modify-path`, never system wide and
  with no shell profile touched; rustc 1.98.1. Both builds were minutes, not the
  thirty that would have stopped this.
- **ESCPost is built as a debug binary.** Its release profile has a `build.rs`
  that refuses to build without `frontend/dist`, which only a Docker or `just`
  build produces, and there is no Docker here. `cargo build --bin escpost`
  skips that check, because only a release build embeds the web app, and renders
  the same pixels. The module says so.
- **thermal has no binary of its own**, it renders its samples from a test, so
  `tools/contact-sheet/references/thermal-cli` is a ten line crate that calls
  `ImageRenderer` and `HtmlRenderer` on a file. It pins the library by commit in
  its `Cargo.toml`, so it builds without a checkout, and it is the only Rust in
  this repository. Nothing in `npm test` or `npm run build` touches it.
- **Every module reports, none of them throws.** A missing tool, a tool that
  fails on a stream and a stream in a language the tool does not read are all a
  cell that says "not available" with the reason. The last case is the largest
  group on this page: the 47 StarPRNT, Star Line and Star raster fixtures of
  receiptline are skipped by both tools, which are ESC/POS only, 94 cells of the
  page.

Rebuilding the reference tools on another machine, in one place. Everything
lands under `build/`, which is gitignored, and every module also takes an
absolute path from an environment variable instead:

```sh
# a throwaway Rust toolchain, in a scratch directory and nowhere else
export CARGO_HOME=/tmp/rpr-rust/cargo RUSTUP_HOME=/tmp/rpr-rust/rustup
curl -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal
export PATH="$CARGO_HOME/bin:$PATH"          # rustc 1.98.1 here

# thermal, through the shim crate of this repository, which pins the library
# by commit 9456874a850b8604d95eca428cca027750cd6188 in its Cargo.toml
cd tools/contact-sheet/references/thermal-cli
CARGO_TARGET_DIR=../../../../build/references/thermal-cli cargo build --release
cp ../../../../build/references/thermal-cli/release/thermal-cli \
   ../../../../build/references/thermal-bin

# ESCPost, the debug binary: the release profile wants a frontend bundle that
# only a Docker or just build produces, and only a release build embeds it
git clone https://github.com/receiptful/escpost build/references/escpost
git -C build/references/escpost checkout c4a7665
cd build/references/escpost && cargo build --bin escpost
cp target/debug/escpost ../escpost-bin
```

Where each module looks, in order, the first that exists winning:

| Tool | Environment variable | Path under `build/references/` |
|---|---|---|
| thermal | `RENDERER_THERMAL` | `thermal-bin`, then `thermal-cli/release/thermal-cli` |
| ESCPost | `RENDERER_ESCPOST` | `escpost-bin`, then `escpost/target/{debug,release}/escpost` |

The agreement metric, over the 100 fixture and reference pairs that are two
images:

| Reference | Pairs | Median height difference | Ink rows exactly equal |
|---|---|---|---|
| ESCPost | 24 | 1.9% | 15 of 24 |
| thermal | 76 | 36.2% | 1 of 76 |

- **ESCPost is the close one**, and where it disagrees the reason is one of the
  five above, plus two of its own: it pads every sheet to the cutter, which is
  every fixture with a cut, and it refuses a stream rather than skipping a
  command it does not know. That refusal is why it rendered 24 of 76. All 37
  ESC/POS fixtures of receiptline stop at `GS a`, the automatic status back
  receiptline sends in its second byte. Six of the eight escpos-php fixtures stop
  as well, each on something else: `ESC e`, a module width of one, a codepage of
  255, a glyph its bundled font has not got, a QR model and a PDF417 parameter it
  reads as a QR one. Three python-escpos fixtures stop at `ESC {`, the upside
  down mode, two ESCPOS_NET fixtures at QR models 49 and 51, and its own four
  DataBar probes at the selectors they were written to probe. The
  biggest disagreements it does render are `mechanism-full-and-partial-cuts`,
  +133%, three padded sheets against three cut items, and
  `graphics-gs-v0-all-scaling-modes`, -65%, the swallowed LF, then
  `python-escpos/software_columns` at -65%, where it prints three of the eight
  rows of the example and gives up on the rest of the line.
- **thermal disagrees everywhere, and the metric says less about it than about
  the measurement.** It renders a wider paper than the print head, 649 dots for
  an 80 mm receipt, with its own font and its own line height, so scaling it to
  our width moves every row; the median of 36% is mostly that. Where it is
  really different it is because it drops content: on
  `receiptline/guest-escpos-32` it prints three lines and 156 dots against 528
  here, after reporting `GS a`, `FS ( A`, `ESC SP`, `FS S` and `FS .` as unknown
  commands, and the same happens to every receiptline fixture with a table. Its
  own samples are the streams it renders whole, which is what its sample renders
  are for and why the eye review of `escpos-tools/receipt-with-logo` used one.
- **The metric never fails a test.** It is written into
  `build/contact-sheet/index.html` as a table and into
  `build/contact-sheet/agreement.json` next to it, both generated, and
  `npm test` does not read either.

Acceptance:

- `npm test` 2113 passing, and the lint step now walks `src`, `test` and `tools`
  whole rather than one directory deep. The fixtures of sections 2 to 16 did not
  change a dot; the 19 new ones are additions, and the only changes to committed
  files are the two lint fixes in the capture scripts of section 16.
- **The lint script now reaches every directory.** Its globs used to stop at
  `tools/**/*.js`, which the shell expands as one level, so nothing at
  `tools/<directory>/<directory>/*.js` was linted: the capture scripts of
  section 16 were already in that position and the reference modules of this
  section are too. The script is `eslint --fix src test tools` now, directories
  rather than globs, with `build/`, `dist/`, `generated/`, `node_modules/` and
  `test/fixtures/` in the `ignorePatterns` of `.eslintrc.json` so that nothing
  generated is linted. It turned up two findings in the capture scripts of
  section 16, both fixed here: a 124 character line in python-escpos and a JSDoc
  parameter named `capture` for an argument named `item` in receiptline.
- `npm run contact-sheet` builds with both tools present and with neither of
  them: hiding `build/references` leaves a page with the same 123 fixtures,
  every reference cell reading "not available" with its reason, and the
  agreement table replaced by the line that says there is nothing to compare.
- Version stays 0.3.0, nothing committed.

### Section 16c

The reverse feed, the semantics in full:

- **The painter has a paper position next to the rows it holds.** `#rows` is how
  far the paper ever advanced in the buffer that is being built, `#position` is
  where the print head is. Everything is committed at the position: past the
  rows, it extends the paper; inside them, it draws over them with OR, because a
  dot that is on the paper does not come off, and a second pass adds its own
  dots to it. Appending white over rows that are already there changes nothing
  and steps over them, which is what an empty line or the gap below a line does.
- **`reverseFeed(dots)` and `reverseLineFeed(count)`** are the two new methods,
  the mirror of `feed(dots)` and `lineFeed(count)`. Both commit the pending line
  first, with a minimum height of zero: a reverse feed is a print command, and
  the print of it advances the paper by the height of the line itself and not by
  a line spacing. Then the position moves back, clamped at row 0 of the buffer.
- **Row 0 of the buffer is the clamp, and it is also the flushed boundary.** A
  flush hands the rows to an image item and empties the buffer, so the rows of
  every line that was already flushed are out of reach and the two clamps the
  plan asks for are the same one. It is the honest limit of a renderer that
  streams items: a printer clamps in the same place for a different reason, its
  mechanism.
- **Blank runs are counted again when the paper was drawn over.** The painter
  records a blank row as it appends it, which is one pass and no second scan,
  and a row that is drawn over can stop being blank long after it was recorded.
  The flush rescans the whole buffer, but only when something was overprinted,
  so nothing changes for a stream without a reverse feed. Without the rescan a
  drawn over line disappears into a `feed` item, which is what the painter test
  of the blank runs checks.
- **The ranges.** `ESC K n` takes 0 to 48 vertical motion units, which is 24 dots
  at the two units per dot of the Epson profile and is the reverse feed of that
  mechanism; a larger value is out of range and the whole command is ignored,
  the pending line included, the way a printer ignores an argument it has no
  range for. `ESC e n` takes every value: the Epson reference gives the command
  no range that the wild respects, the mechanical maximum is a couple of lines
  and differs per model, and the demo of escpos-php reverses three lines with
  it, so the renderer does not impose a model's maximum and relies on the clamp.
  That is a deliberate divergence and it is in the list of them on the reference
  page.
- **No Star reverse feed.** No command of the Star Line Mode or StarPRNT
  specifications that were available here feeds the paper backwards, and no Star
  stream of the fixtures asks for one, so this is ESC/POS only and the Star page
  says so under its feeds.

`ESC SP n` of the Star languages, the reading and where it comes from:

- receiptline's `_star` command set, the one behind `starsbcs`, `starlinesbcs`
  and `starmbcs`, opens every job with
  `ESC @ ESC RS a n ESC RS F n ESC SP '0' ESC s '0' '0' ..`, and its `_dot` set,
  the impact printers, with `ESC @ ESC RS a n ESC M ESC SP 0x00 ESC s 0x00 0x00 ..`
  (`node_modules/receiptline/lib/receiptline.js`, the `open()` of `_star` and of
  the impact set). Both write one argument byte and both mean no spacing at all,
  one as the ASCII digit and one as the binary number, next to an `ESC s` and an
  `ESC z` that they write in the same two forms.
- So the command is the right side character spacing of ESC/POS under the same
  name, it takes one argument byte, and the digits `'0'` to `'9'` are read as 0
  to 9 the way the arguments of `ESC b` are, everything else as the number of
  dots it is. The two forms cannot collide in practice: a spacing of 48 dots is
  six millimetres between two characters. It is handed to the same
  `painter.spacing()` the ESC/POS renderer uses, so it scales with the width
  multiplier and counts towards the character width of `ESC D`.
- **No StarPRNT specification text was available here**, so the reference page
  keeps it marked as a reading and names receiptline as the source of it. Every
  Star stream in the fixtures sets it to zero, so no golden image moved by it:
  the command is the reading, not the pixels.

Reported against Parsed, the rule and what moved:

- **The rule, now in the Statuses section of both reference pages.** Reported
  means the command may have changed the paper of a real printer and the
  renderer did not reproduce it, so the `unknown` item is a warning that this
  receipt could come out differently. A command that cannot touch the paper is
  Parsed, consumed with its length and with no item, however much it changes
  about the printer. The unknown count of a stream is then a measure of what the
  renderer is not showing, which is what it was counted for.
- **ESC/POS, moved to Parsed:** `ESC u`, `ESC v`, `GS I`, `GS a`, `GS j`, `GS r`,
  `GS ( H`, `DLE EOT`, `DLE ENQ`, `GS b` and `FS ( A`. The status
  transmissions and the enables of them have no channel back to the host to
  answer over; `DLE ENQ` recovers a printer from an error state this renderer is
  never in; `GS b`, the smoothing, interpolates dots of a scaled glyph and has
  no dot of a one bit image to add; `FS ( A` picks a Kanji font, and every
  multibyte character is the same placeholder cell here whichever font it picks.
  `GS j` is the one addition to the list the section was given: it is a status
  transmission of exactly the kind of `GS r`, and leaving it Reported next to a
  Parsed `GS r` would have contradicted the rule in the same table.
- **ESC/POS, left Reported on purpose:** `ESC =`, which can take the printer off
  the line; `GS ( E`, the user settings, which reach the paper indirectly;
  `ESC c`, the sensor and panel settings, which stop the printing on a paper
  end; `GS z`, whose "other settings" are not settled here; `GS c`, `GS g`,
  `GS E`, `GS :` and `FS g`; and `DLE DC4`, which is the one real time command
  that is not a status request: `fn 1` fires the drawer, which is a `pulse` a
  driver should see, and `fn 8` clears the buffer, which is the paper. That is
  the one place where the list the section was given was not followed whole, and
  the reference page says why.
- **Star, moved to Parsed:** `ESC ACK SOH`, `ESC s`, `ESC GS ETX`, `ESC GS #`,
  `ESC RS a`, `ESC RS d`, `ESC RS r` and the three buzzer commands, `ESC GS BEL`
  and the two forms of `ESC GS EM`. The densities and the speed are the darkness
  and the pace of the dots, neither of which a one bit image has room for, and
  the item stream has no sound. `ESC s` stays a command whose effect is not
  settled by any specification text available here, and it is parsed with the
  rest of receiptline's setup because every other command of that setup is a
  setting the paper cannot show and because the Star fixtures render the same
  paper as the ESC/POS fixtures of the same document, which the parity test
  checks dot for dot.
- **Star, left Reported:** `ESC GS b`, the blackmark and sensor settings, which
  decide where the paper stops, and `ESC GS c`, the colour, which is a second
  ribbon this renderer does not draw.

The end of a stream, the rule and what it moved:

- **`end()` cancels the pending line and then flushes**, which is two lines of
  the painter and a rule of the printer: cells reach the paper when a line feed
  or a print command commits the line they are on, and the end of a job is
  neither of those. It is the same discard that `CAN` and `ESC @` do, and the
  same one that `print()` of an image the printer never got does.
- **No encoder fixture moved**, which is the check that this is safe: the
  encoder ends every line with `LF CR`, so the fixtures of sections 2 to 14 have
  nothing pending at the end of a stream and not a dot of them changed.
- **One external fixture moved, `escpost/cafe-order-voucher`**, 1240 rows to
  1210. The sample ends with `GS V 0` and the text "Buffered, not printed" with
  no line feed behind it, which is what the case is written to demonstrate; the
  eye review of the ASCII art shows the last printed line is "Scan to redeem
  online." now, with the thirty dot line of buffered text gone from the bottom
  of the paper. ESCPost renders the same sample the same way, and the two now
  agree to the dot: the notes of that fixture recorded 1240 dots here against
  1210 there as a padding difference of ESCPost's sheets, and the real reason
  was this line: its height difference against ESCPost is 0.0% now and it is one
  of the 15 pairs whose ink rows were already within a rounding of each other.
  The agreement table of section 16b moves with it, ESCPost from a median height
  difference of 1.9% to 1.3% over the same 24 pairs, and thermal from 36.2% to
  37.5% over its 76, which is the two fixtures of this section changing height
  against a reference that scales everything anyway.
- **Four tests changed with it**: the painter test that checked the old rule is
  now the pair that checks the new one, the painter test of an image that was
  never defined asserts no items at all, and two Star tests that ended their
  stream on an unfinished line, the `ESC *` that is not the raster group and the
  truncated raster row, write the line feed they meant.

Rendering the fixtures again without capturing them:

- **`node tools/external/rerender.js [library] [fixture..]`** is the new tool,
  and it is what this section needed: the bytes of a fixture did not change, only
  the render of them did, so running a capture script would have meant a PHP
  install, a virtual environment and a new capture date in every provenance for
  nothing. It reads every `.bin` with the provenance next to it, writes the
  `.pbm`, the `.items.json` and the `unknown` count of that provenance again,
  keeps every other field including `captured`, and prints the fixtures that
  changed with what changed in them. Nothing of it runs during `npm test`.

The unknown items, before and after, over all 123 fixtures:

| Library | Fixtures | Unknown before | Unknown after | Which commands were counted |
|---|---|---|---|---|
| receiptline 4.0.4 | 84 | 269 | 0 | `GS a` 37, `GS r` 37, `FS ( A` 27, `ESC RS a` 47, `ESC SP` 37, `ESC s` 37, `ESC GS ETX` 37, `ESC ACK SOH` 10 |
| python-escpos 3.2.dev81 | 7 | 26 | 0 | `GS b`, the smoothing mode, 26 |
| escpos-php v2.2 | 8 | 1 | 0 | `ESC e`, the reverse line feed of the demo, 1 |
| ESCPOS_NET ac185fc | 5 | 0 | 0 | none |
| ESCPost 0.2.1 | 18 | 0 | 0 | none |
| escpos-tools `4311694` | 1 | 0 | 0 | none |
| **Total** | **123** | **296** | **0** | |

- **Two golden images moved**, `escpos-php/demo` for the reverse feed and
  `escpost/cafe-order-voucher` for the end of stream rule; in the other 121 only
  the `.items.json` and the `unknown` of the provenance changed. `ESC SP` is zero
  in every Star stream, so rendering it moves nothing, and a command that stops
  reporting takes an item out of the stream and leaves the paper alone.
- **`escpos-php/demo`, the eye review.** The example prints `ABC`, feeds seven
  lines with `ESC d 7`, prints `DEF`, reverses three lines with `ESC e 3` and
  prints `GHI`. As ASCII art the paper now reads `ABC` at the top of the
  section, `GHI` 90 dots further down and `DEF` 90 dots below that: the `GHI`
  landed three lines above the `DEF` it was printed after, which is what the
  example demonstrates and what a printer does with those bytes. That part of
  the receipt is 234 rows instead of the 240 it was when the reverse feed was
  reported and `DEF` and `GHI` shared a line, so the whole fixture is 2477 rows
  instead of 2483. Nothing is lost: the paper is everything the print head
  passed over, and the rows below the head at the end of the job are on it too.

Acceptance:

- `npm test` 2156 passing, lint clean: the 2113 of section 16b plus 43 tests,
  six for the reverse feed of the painter, seven for `ESC K` and `ESC e` of the
  ESC/POS renderer, ten for the ESC/POS status commands that no longer report,
  three for `ESC SP`, seven for the Star status commands and ten for the end of
  a stream, two in the painter, where the test of the old rule became three, and
  four in each renderer. Tests that changed
  rather than moved: the `DLE EOT` and `DLE ENQ` rows of the real time commands
  and the three buzzer commands now check that nothing is reported, the unknown
  command of the `ESC RS` group is `ESC RS C` now, since `ESC RS r` is parsed,
  and the four listed above under the end of a stream.
- Every external fixture passes its three checks after `tools/external/rerender.js`,
  and the parity test of the receiptline fixtures is unchanged.
- `npm run contact-sheet` builds, with the two reference tools and without them.
- Version stays 0.3.0, nothing committed.

**thermal and double strike.** On the contact sheet thermal draws every line after an `ESC G 1` with a strike-through, and keeps doing so after `ESC G 0`, through the alignment samples, the barcode text and the QR labels of the escpos-php demo. Epson defines double strike as a second pass of the head, visually emphasis, which is what this renderer draws. A divergence of the reference, not of the renderer; recorded so the next reader of the sheet does not chase it.

### Section 16d

Implemented on 2026-09-13. Files: `src/bitmap.js`, `src/painter.js`,
`src/renderers/esc-pos.js`, `src/renderers/star-prnt.js`,
`data/profiles/epson.json`, `data/profiles/star.json`, `generated/profiles.js`,
`test/bitmap.js`, `test/painter.js`, `test/esc-pos.js`, `test/star-prnt.js`,
`test/parity.js`, `test/tools/make-fixtures.js`, the four hand assembled
fixtures in `test/fixtures/esc-pos/raw` and the one in
`test/fixtures/star-prnt/raw`, `documentation/design.md`,
`documentation/commands-esc-pos.md`, `documentation/commands-star-prnt.md`.

The painter:

- **A page is a surface next to the paper, and only the surface changes.** In
  page mode `#append()` writes into the page instead of into the rows of the
  paper, and `#area()`, the left margin and the width a block is centred over
  come from the print area instead of from the paper. Everything above that,
  the cells, the wrapping, the line height, the alignment, the tab stops, the
  blocks, the styles and the upside down mode, is the code of standard mode
  unchanged. That is why no fixture of sections 2 to 16c moved a dot: the
  standard mode path is the same path it was, with `#surface()` returning the
  width of the paper.
- **Three layers: the canvas, the page and the paper.** The canvas is the
  current print area in the coordinate system of the current print direction,
  the page is the printer's page buffer, the paper is what the items carry. The
  canvas goes into the page, turned by the direction, whenever the area, the
  direction or the page changes, and the page goes on the paper as one block
  when the stream prints it. A page is composed out of as many areas as the
  stream sets; the blit into the page combines dots with OR, so a second area
  over the same dots adds to them.
- **The direction is a rotation, and this is the mapping.** The area is laid out
  as if the text ran to the right and the lines went down, and the layout is
  turned when it goes into the page: direction 0 no turn, direction 1 a quarter
  turn counter-clockwise, direction 2 half a turn, direction 3 a quarter turn
  clockwise, which is three quarter turns counter-clockwise. That follows from
  the start positions of the reference: the top left of the area for 0, the
  bottom left for 1, the bottom right for 2 and the top right for 3. In the two
  sideways directions the canvas is as wide as the area is high, so a line of
  direction 1 is as long as the area is tall and wraps over that length.
  `Bitmap.rotate90()` and `Bitmap.rotate270()` are the two new operations,
  counter-clockwise both, dot by dot like `rotate180()`.
- **A vertical move draws the characters that are on the line first.** A printer
  puts a character in the page as it reads it and this painter keeps it on a
  line until something commits it, so `pageVertical()` commits what is there,
  at the position it was placed, and then moves. The cursor survives that, the
  alignment of the piece does not: a centred line that is cut in two by a
  vertical move is centred per piece. Only a stream that mixes centring with
  positions inside one line can see it.
- **A page that was never printed does not reach the paper**, the same rule as
  the line that is being composed: leaving page mode, `reset()` and `end()` all
  throw it away.
- **The print area and the print direction are settings of the printer, not of
  one page.** They live next to the margins and the line spacing, a stream can
  set them in standard mode, a page starts in whatever the printer holds, they
  survive the page they were used on, and only an initialize puts them back.
  Without an area at all the page is laid out over the whole printable area.
- **Upside down printing does not reach a page.** `ESC {` is a standard mode
  command in the reference, and the print direction is what turns a layout in
  page mode, so neither a line of a print area nor the page block itself is
  rotated by it.

ESC/POS, the rules of the reference and where this renderer reads them:

- **`FF` prints the page and returns to standard mode; `ESC FF` prints it and
  stays.** The brief of this section said `FF` keeps page mode. The Epson
  reference has the two as a pair, "print and return to standard mode" against
  "print data in page mode", where only the second keeps the buffered data, the
  print area, the direction and the position. thermal renders both that way,
  which is the check that was available here: its render of `ESC L .. FF` puts
  the text behind the `FF` on the paper, and its render of `ESC L .. ESC FF`
  leaves the text behind the `ESC FF` in a page that is never printed again.
  The reference is what is implemented, and the brief is noted here as the one
  place this section did not follow it.
- **`ESC FF` keeps the position, the cursor included.** The reference says the
  command leaves the buffered data, the settings of `ESC T` and `ESC W` and the
  position of the character data alone, so a page that is printed halfway
  through a line goes on where it was: the vertical position inside the area and
  the horizontal cursor on the line both come back after the print.
- **`ESC S` deletes the page.** Only `FF` and `ESC FF` print one, which is what
  the brief asked to check and what the reference says: switching to standard
  mode clears the page buffer. `ESC @` does the same, and so does the end of a
  stream.
- **`ESC L` is only effective at the beginning of a line**, as the reference
  says of it, so a command that arrives while a line holds characters or while
  its cursor has been moved is dropped whole. The Star page mode start follows
  the same rule, for want of a specification text that says otherwise.
- **`CAN` deletes the dots of the page and keeps the print area.** That is the
  ESC/POS definition of the command, which exists for page mode alone; in
  standard mode a printer ignores it and so does this renderer, where it was
  ignored before this section as well. The Star `CAN` still cancels the line
  buffer, which is its Star Line Mode definition.
- **A width or a height of zero makes `ESC W` do nothing**, which is what the
  reference states, and so does an origin outside the printable area. The brief
  of this section read a zero as the maximum in that direction; the first round
  of the review corrected it. Without any `ESC W` since the last `ESC @` the
  page is laid out over the whole printable area, which is the default area and
  not a zero size.
- **The unit follows the axis, for every command that moves along one.**
  `ESC $`, `ESC \` and `ESC SP` move along the axis the characters run in and
  `GS $`, `GS \`, `ESC 3`, `ESC J` and `ESC K` along the axis the lines go down
  in; `ESC d` and `ESC e` count in lines of the spacing `ESC 3` set, so they
  follow it. Those two axes are the horizontal and the vertical axis of the
  paper in the directions 0 and 2 and the other way round in 1 and 3, so the
  motion units swap with them, which is the page mode rule the Epson notes give
  these commands. `ESC W` is not part of it: the area is a rectangle on the
  page, so its origin and its width count in horizontal motion units and its
  origin and its height in vertical ones whatever the direction is.
- **A page starts in the settings the printer holds.** `ESC W` and `ESC T` are
  accepted in standard mode as well, `ESC L` does not reset either of them, and
  a stream that sets an area once prints every page of the job in it. `ESC @`
  is what puts the whole printable area and direction 0 back.

How tall the printed page is, which is the one rule of this section that is
this renderer's own:

- **The page is as tall as the print areas the stream set on it**, the origin of
  an area included, so an `ESC W` of 400 dots leaves 400 dots of paper whatever
  it holds. That is what a printer feeds and what thermal renders. The page is
  drawn into a bitmap of that height rather than cut down to the rows that carry
  a dot, so an area that was set and stayed empty still feeds the paper: a
  96 by 100 area with text in it, followed by an empty 96 by 100 area, prints
  200 rows.
- **A page that was given no area is as tall as its dots**, and a page with
  neither an area nor a dot prints nothing at all. The default area is the whole
  page, 1662 dots, and feeding that for a page of two lines would put twenty
  centimetres of white on a receipt. This is also what keeps the Star flush
  free: the encoder writes `ESC GS P 0 ESC GS P 1` around every job, which is a
  page without an area and without a dot.
- **`pageHeight` is a profile value**, 1662 dots in both profiles, the page mode
  maximum of an Epson TM-T88 at 576 dots wide that the brief names. **No Star
  specification text available here gives a page height, so the Star profile
  takes the same number**; the only page length a Star document in this
  repository gives is the 64000 dots of the raster page length of Star Graphic
  Mode, which is another buffer entirely.
- **A cut or a pulse in page mode waits for the page.** The page is not on the
  paper when the command arrives, so an item in front of it would tell a driver
  to cut paper that is still to be printed. The painter holds `cut` and `pulse`
  items and emits them right behind the page, or when page mode is left without
  printing one, so the item stream keeps the order of the paper. `unknown` items
  are diagnostics and are reported where they stand. **A reading**: no
  specification text available here says what a printer does with `GS V` or
  `ESC p` in page mode; the other reading is a printer that ignores a `GS V`
  there altogether. The deviation list of the reference page names it, together
  with the height of the printed page and with the third reading of this
  section: **a line that half fits at the bottom of a print area is clipped
  where the area ends, mid-glyph**, rather than dropped whole.

StarPRNT, the finding about `ESC GS P`:

- **The encoder's flush really is page mode, and this section made it one
  without moving a dot.** `LanguageStarPrnt.flush()` of ReceiptPrinterEncoder
  writes `ESC GS P '0'` as a print mode called `page` and `ESC GS P '1'` as one
  called `line`; the renderer parsed both as a print mode with one argument
  byte and no effect. In StarPRNT they are page mode start and page mode end,
  and the end prints the page, which is exactly the flush the encoder wants: on
  a printer, entering page mode finishes what is in the line buffer and leaving
  it prints what the page holds. Since the encoder sends the two with nothing in
  between, the page has no area and no dot and the page height rule above makes
  it nothing at all. **Every Star fixture of sections 3 to 16c is byte identical
  and so is every Star fixture of the external suite**, which is what the flush
  appearing in all of them made the risk of this change.
- **receiptline never writes the command.** Its `_star` command set opens a job
  with `ESC @ ESC RS a ESC RS F ESC SP '0' ESC s '0' '0' ..` and closes it with
  a cut and `ESC GS ETX`, so the 47 Star fixtures of the external suite say
  nothing about `ESC GS P` at all. ReceiptPrinterEncoder is the only producer
  the fixtures have for it.
- **Functions 2 to 5 are a reading.** They are the print area, the print
  direction and the two vertical positions of the ESC/POS group under Star's
  numbering, with the argument lengths that implies, 8, 1, 2 and 2 bytes, and
  the dot unit of `ESC GS A` and `ESC GS R` rather than motion units. **No
  StarPRNT specification text was available here**, no stream of the fixtures
  sends one of them, and the cost of the reading being wrong is a stream that
  desynchronises where it would have consumed one byte before. It is in the
  deviation list of the Star reference page, next to `ESC GS S` and `ESC FS q`.
  The `page-mode-directions` fixture describes the same page in both languages
  and `test/parity.js` compares the two dot for dot, which is the check the
  reading can have without hardware.

Fixtures and tests:

- **Five fixtures**, four in ESC/POS and one of them in StarPRNT as well:
  `page-mode-directions`, four print areas of 288 by 120 dots on one page of
  576 by 240, one per direction, each with a label and a rule;
  `page-mode-coupon`, a coupon of a page 400 dots tall laid out with `GS $` and
  `ESC $`, with a Code 39 barcode and a QR code as blocks inside the page;
  `page-mode-esc-ff`, one page printed twice, with a line added in between and a
  third line that `ESC S` throws away; and `page-mode-cancel`, where `CAN`
  discards a line and the page that is printed is what came after it.
- **Reviewed as ASCII art and as a rendering before they were frozen**: the four
  directions read left to right, bottom to top, right to left and top to bottom,
  each starting in its own corner of its area, with the rule on the side the
  lines advance to; the coupon has its heading centred, its two positioned lines
  at 70 and 110 dots, the barcode at 150 and the QR code at 260, and the page
  feeds its whole 400 dots before "Thank you, see you soon" on the paper below
  it; the `ESC FF` fixture prints the heading alone and then the heading with
  the second line under it, 100 dots apart; the cancel fixture prints one line
  and feeds the 100 dots of the area.
- **The acceptance is a test, not a fixture**: a receipt of three lines, centred
  and bold among them, laid out in page mode with direction 0 over the full
  width renders dot for dot the same paper as the same content in standard mode.
- **thermal is the only reference renderer here that has page mode.** ESCPost
  refuses a stream at the first `ESC L`, "unsupported ESC/POS command ESC 0x4c",
  so the 24 pairs of the agreement table are unchanged. thermal's renders of the
  four directions, of `FF`, of `ESC FF` and of `ESC S` are what the semantics
  above were checked against; its heights are not, it counts `ESC W` in dots
  where the reference counts the vertical ones in vertical motion units, and it
  renders nothing at all for a page without an area.
- **Not one external fixture uses page mode.** None of the 123 streams contains
  `ESC L`, `ESC S`, `ESC T`, `ESC W`, `ESC FF`, `GS $`, `GS \` or `ESC GS P`
  with a function other than the encoder's flush, which the zero unknown items
  of section 16c already implied for the reported ones. So no provenance count
  changed, nothing was rendered again, and "Seen in the wild" gains no row.
- **One existing test changed rather than moved.** Three tests of the unknown
  commands used `ESC W` as their example of a command the renderer does not
  know, which it is not any more; they use `GS g`, the maintenance counter, now.
- **Argument lengths and truncated streams** joined the sweeps of both
  languages: `ESC L`, `ESC S`, `ESC T`, `ESC W`, `ESC FF`, `GS $` and `GS \` in
  ESC/POS and the six functions of `ESC GS P` in StarPRNT.

Review:

The first round of this section was returned with seven points, all of them
applied here: the printed page is drawn into a bitmap of its height instead of
being cut down to the rows that carry a dot, so a print area that stayed empty
still feeds the paper; the motion unit follows the axis for `ESC 3`, `ESC J`,
`ESC K` and `ESC SP` as well as for the four position commands; a zero width or
height in `ESC W` makes the command do nothing instead of asking for the
maximum; `ESC W` and `ESC T` became settings of the printer that a stream may
set in standard mode and that survive the page they were used on; `ESC {` turns
nothing in page mode; `ESC FF` brings the cursor back along with the vertical
position; and the deviation list of the ESC/POS reference page was made
complete for page mode, the `ESC W` zero reading, which is no longer a
deviation, taken out of it. No fixture changed a dot, in either round.

Acceptance:

- `npm test` 2268 passing, lint clean: the 2156 of section 16c plus 112 tests,
  8 for the two rotations of the bitmap, 34 for page mode in the painter, 32 for
  page mode in the ESC/POS renderer, 7 for page mode in StarPRNT, 15 in the two
  length sweeps, 15 for the new fixtures over the fixture, item and parity loops
  and 1 for the fixture list of the parity test.
- `npm run build`, `npm run test:types` and `npm run test:umd` pass. Every
  fixture of sections 2 to 16c, the 123 external ones included, is byte
  identical. Version stays 0.3.0, nothing committed.
