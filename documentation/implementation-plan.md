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
