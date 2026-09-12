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
painter.end() → RenderItem[]               // flush everything, return the items, reset
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

## Notes per section

Filled in during implementation.

### Section 1

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
- **`end()`** commits a pending line as if a line feed followed it, flushes, returns the items and only then resets the state, so the same renderer can render a second stream.
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
- **Code set C ends where the digits end.** A character that is not a digit, or
  a digit without a partner, switches to code set B, which is the only thing a
  printer can do with data that says `{C` and then does not hold digit pairs.
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
  print in one command. Nothing lands on the paper.
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

Byte sequences, all checked against star-graphics-mode.md:

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
  of its bytes, as is the resume packet. If a printer turns out to send a pause
  without ever sending a resume, a timeout is the place to add.

Wrapper, `src/wrappers/meow.js`:

- **Exports `wrap`, `packet`, `crc8`, `reverseBits`, `Commands` and
  `FlowControl`.** The driver imports `wrap` and `FlowControl`, the rest is for
  the tests and for anyone reading the protocol.
- **Two generated tables at module load**, the 256 entry CRC8 table for
  polynomial 0x07 with initial value 0, and the 256 entry byte reversal table.
  The renderer's rows are most significant bit first, the printer takes the least
  significant bit as the leftmost dot.
- **Rows are padded, never truncated silently.** A row is `width / 8` bytes, 48
  at 384 dots; an image item narrower than the print head is copied into a zeroed
  row, a wider one is clipped to the print head.
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

Tests: `npm test` runs mocha over `test/meow.js` and `test/callback-queue.js`,
37 cases, all passing. The CRC8 is checked against three values computed by hand
in the header of the test file, `00` for `[00]`, `07` for `[01]` and `c0` for
`'A'`, and against the two lattice payloads. The job sequence for a 384 by 2
image with a known row pattern, a feed item, a feed item without a height, the
padding of a narrow row, the option defaults and the clamping, and that cut and
pulse items produce exactly the empty job, are all literal byte arrays. The
wrapper and the queue are modules without a `navigator.bluetooth` reference, so
the tests need no browser. `npm run build` succeeds and the wrapper is in both
bundles.

The driver itself was exercised outside the test suite with a mock of the Web
Bluetooth API: a cat printer without a renderer rejects and leaves GATT
disconnected, a class without a static `language` rejects with the option
message, a loader function resolves, the connected event carries `esc-pos`,
`epson` and 32 columns, `rendererOptions` are merged underneath the driver's
values, the notify characteristic is subscribed once during open and not again
by `listen()`, a print produces eleven packets in the order of the table above,
and the pause packet stops the writes until the resume packet arrives. The same
mock confirms that a generic ESC/POS printer still reports no `columns`, still
chunks a 250 byte job into 100, 100 and 50, and still emits `data` events.

Version: 3.0.0, a major bump, because the passthrough of the `meow` language is
gone. Optional peer dependency on `@point-of-sale/receipt-printer-renderer`
`^0.1.0`.

Not verified on hardware. What has to be confirmed on a GB and a GT model is
everything the protocol section of design.md marks as unconfirmed: that the job
sequence is accepted as it stands, that speed `0x20` and energy `0x2ee0` give
readable output, that the flow control packets are exactly those nine bytes and
that a pause is always followed by a resume, and that 96 rows of final feed is
enough for the paper to clear the print head. The run length encoded row command
is not used, and whether it is worth using is still open.

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
