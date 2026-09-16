# The display list

Reference page of the format `layout()` returns, version 1.

`render(bytes)` gives the dots of a receipt, `layout(bytes)` gives what is printed and where, with no dot of it drawn: a list of line boxes with the cells, the rectangles and the images that are on them. It is the format the SVG writer of this package consumes, and it is public so that a consumer outside the package, a PDF writer, a preview, a debugging view, can consume it too.

```js
import ReceiptPrinterRenderer, { rasterize } from '@point-of-sale/receipt-printer-renderer';

const renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576, codepageMapping: 'epson' });

const layout = renderer.layout(bytes);        // what is printed and where
const items = rasterize(layout, { commands: ['cut'] });   // the same dots render() draws
```

`toSvg(layout, options)` of the `/svg` sub-entry writes an SVG document of a list, see [SVG output](usage.md#svg-output); it accepts version 1 and throws on any other version. The document is the paper of the list, except that a list of no height becomes a document of one blank row, since a document of no height is refused by a rasterizer and drawn as nothing by a browser.

`rasterize(layout, options)` draws a list again and returns the items of the output contract. It takes `commands`, `maxHeight`, `feedThreshold` and `font`, the options of a renderer that decide how the dots come out, and it is a named export as well as a static of `ReceiptPrinterRenderer`.

`pieces(layout)` splits a list at its cuts into the pieces of paper that leave the printer, one list per piece in order, each with the height of the paper between two cuts and the entries that start on it moved up to row 0, and without the cuts, which are the boundaries. The paper is cut between row `y - 1` and row `y` of a cut, so row `y` is the first row of the next piece; a cut at the very top or bottom, or two on one row, leave no piece, and a piece with nothing on it, a feed and then a cut, is a blank one. The list is not changed. It is a named export as well as a static, and a piece is a list like any other: `rasterize(piece)` draws the same dots as the items of a render between the same two cuts, stitched, and `toSvg(piece)` writes a document of the piece.

<br>

## The list

```js
{
  version: 1,
  language: 'esc-pos',
  width: 576,           // the paper in dots
  height: 713,          // the paper from its first row to its last, the feeds included
  dpi: 203,             // the resolution of the profile, 203 when the profile does not say
  entries: [ ... ],
}
```

Everything is in dots, as integers. The origin of the paper is its top left corner, `x` runs right and `y` runs down. `height` is the height the paper has when `stitch()` joins the items of a render with the feeds expanded; a reverse feed can leave the position above it, the height is the extent.

<br>

## Entries

The top level, in stream order, which is the order a printer prints them and the order a consumer draws them.

| Type | Fields | Meaning |
|---|---|---|
| `line` | `y`, `height`, `rotation`, `operations` | A line box: a text line, or a block on a line of its own. It spans the width of the surface, and it is as tall as the tallest operation on it. `rotation` is 0 or 180, the upside down printing of `ESC {` at the moment the line was committed. |
| `page` | `y`, `height`, `areas` | A page of page mode as it reaches the paper, one block of the paper width. |
| `feed` | `y`, `height` | Rows the paper advanced without printing: an empty line, the feed of `ESC J` and `ESC d` beyond the height of the line, a Star raster move. |
| `cut` | `y`, `value` | The paper is cut between row `y - 1` and row `y`. `full` or `partial`. |
| `pulse` | `y`, `device`, `on`, `off` | The drawer opens when the paper is at row `y`. |
| `unknown` | `y`, `data` | A command that was not understood, with a copy of its bytes. |

The `y` of a line or a page is the position of the paper when it was committed. After a reverse feed a later entry has a smaller `y` than an earlier one, and its dots are added to the rows that are already there: a consumer that paints in order paints black over black and is right. A marker stands at the position the paper has when its command arrives, so a cut after the last line stands at the bottom of that line. A cut or a pulse that arrived while a page was being composed stands behind the page, at its bottom, which is where the items of the item stream put it. The gap the line spacing leaves below the cells of a line is part of the line, not a feed.

A command the printer performs takes the paper in front of it away: after a cut or a pulse the driver supports, the print head stands at the bottom of the paper that left, whatever a reverse feed did to the position before it, and no entry behind it has a smaller `y` than that marker. A reverse feed cannot move above the last such marker, the way a printer cannot pull back paper it has cut off.

The list is not filtered by the `commands` option: every cut, pulse, feed and unknown command is in it. What `commands` does decide is which of them the printer performs, and therefore where the paper leaves it: a list of a stream that moves the paper back over a cut the driver performs is not the list of the same stream for a driver that ignores it, and neither is the paper.

<br>

## Operations

Inside a line. `x` is from the left edge of the surface, `y` from the top of the line box, both in the unturned frame of the line; margins, alignment, the print area and the character spacing are already applied, `x` is where the ink lands.

| Type | Fields | Meaning |
|---|---|---|
| `text` | `x`, `y`, `width`, `height`, `codepoint` or `bitmap`, `font`, `cell`, `glyph`, `baseline`, `scale`, `style`, `rotation`, `spacing` | One cell of text. |
| `rect` | `x`, `y`, `width`, `height` | A filled black rectangle: a bar of a barcode, a run of adjacent black modules of a QR code, a PDF417 symbol or a DataBar, or one line of the hollow box a Code 93 prints for its start and stop character, which the font has no glyph for and which is therefore rectangles of the barcode block instead of a text cell: four of them, one per side, or two when the cell is too small for the sides to have any height. |
| `image` | `x`, `y`, `width`, `height`, `data` | A 1-bit bitmap in the format of the output contract, one dot on one dot: a strip of a column mode image inside a text line, a raster image, a downloaded or NV image with the scaling of its print command applied, a Star raster mode buffer. `data` is a copy the layout owns, never a view on the stream. |

### Text

| Field | Meaning |
|---|---|
| `codepoint` | The Unicode code point the renderer decoded, U+FFFD for a byte the codepage does not map and for the placeholder cells of multibyte text. |
| `bitmap` | Stands in the place of `codepoint` for a glyph the stream downloaded, the dots as `ESC &` or `FS 2` defined them, a `{width, height, data}` bitmap placed at the top left of an unscaled cell of the size of `cell` and clipped by it. |
| `font` | `A` or `B`. |
| `cell` | The unscaled cell of this operation, `{width: 12, height: 24}` for font A, `{width: 9, height: 17}` or `{width: 9, height: 24}` for font B, and twice as wide for a downloaded multibyte glyph. |
| `glyph` | The unscaled glyph box of the font, `{width: 12, height: 24}` or `{width: 8, height: 16}`, which sits in the cell at `floor((cell.width - glyph.width) / 2)` horizontally and on the baseline vertically. A downloaded glyph has the cell as its box, because its dots sit in the corner of the cell. |
| `baseline` | The row of the cell the glyph stands on, unscaled: three quarters of the height of the cell, 18 for a 24 row cell and 12 for a 17 or 16 row one. The ascent of the cell on the line is `baseline * scale.y`. |
| `scale` | `{x, y}`, 1 to 8. |
| `style` | `{bold, underline, upperline, invert}`. `bold` is the glyph a second time one glyph dot to the right, which is `scale.x` paper dots, before the underline and the inversion; `underline` and `upperline` are 0, 1 or 2, the thickness in paper dots of a line along the bottom or the top of the scaled cell over its whole width, never scaled; `invert` is the cell black and the glyph white. A cell that is inverted or turned is not underlined and not upperlined. |
| `rotation` | 0 or 90: the rotation of `ESC V`, a quarter turn clockwise of the unturned scaled cell about its top left corner, then placed so that the turned box is `x`, `y`, `width`, `height`. |
| `spacing` | The right side character spacing of `ESC SP` behind the box, in dots, already multiplied by `scale.x` the way a printer scales it, and by the two cells of a downloaded multibyte glyph. It is not part of the box: `x`, `y`, `width` and `height` are the cell, and the next operation starts `width + spacing` further along. The dots are white, except that the reverse of `invert` covers them and, on a cell that is neither inverted nor turned, so do `underline` and `upperline`, each over the same rows of the box it covers there. The gaps `HT`, `ESC $` and `ESC \\` skip are not spacing and carry none: they are the distance between one operation's `x + width + spacing` and the next operation's `x`, and they stay white. A cell that nothing follows carries its spacing all the same, and a printer prints it, up to the right edge of the print area of the line: the layout cuts the field to what fits there, so a right aligned line, which ends on that edge, carries `0` on its last cell. |

No operation is taller than the line box it is on, or reaches below it: the height of a line box is the height of the tallest thing on it. A consumer may rely on that, and the two of this package do, in two different ways: the bitmap back-end composes a line into a bitmap of `height` rows and cuts what does not fit, and the SVG writer clips a line to the width of its surface and to nothing else. A list built by hand that breaks the rule is drawn differently by the two.

An operation can start inside the surface and end past its right edge: the human readable text of a barcode is not shortened when it is wider than the paper, and a cell that a position command put near the edge is not moved back. A consumer clips a line to the width of its surface, the width of the paper for a line of the paper and the logical width of an area for a line of a page, which is what the line bitmap of the renderer does. Nothing is ever clipped at the left, `x` is never negative.

`width` and `height` are the box of the operation on the line: the scaled cell, or the scaled cell with its sides swapped when `rotation` is 90. The code points U+2500 to U+259F are stretched to the edges of the cell, as the bitmap font stretches them. Every text operation carries its whole style; there are no state changes in the list.

The glyph box and the baseline are the ones of the built in bitmap font, whatever font drew the dots: the `font` option of a renderer is an option of the bitmap back-end and the layout has no font at all.

<br>

## Pages

`areas` is a list of print areas in the order the stream composed them; an area the stream set twice is in the list twice, and an area that held nothing is not in it at all, though the page is still as tall as the areas it was given.

An area is `{x, y, width, height, direction, entries}`: `x` and `y` from the top left corner of the page, which is row `y` of the paper; `direction` 0 to 3 as the print direction of page mode defines it; `entries` a list of `line` and `feed` entries in the logical frame of the direction, whose surface is `width` by `height` for the directions 0 and 2 and `height` by `width` for 1 and 3.

An area can be larger than the page it is on. The height of an area is the print area the printer holds, the height of a page is what the stream fed, and a page without a print area of its own is as tall as the boxes that were laid out in it while its area is the whole printable page: `ESC @ ESC L` with one line and `FF` gives a page of 30 rows whose only area is 576 by 1662. A consumer clips every area to the page, the way the page bitmap of the renderer clips it.

A consumer draws the entries of an area on that logical surface, clips them to it, and turns the surface into the area: for direction 0 a logical point `(u, v)` is the area's `(u, v)`; for 1 it is `(v, height - u)`; for 2 it is `(width - u, height - v)`; for 3 it is `(width - v, u)`. The lines of an area carry `rotation` 0 always, and their text operations carry `rotation` 0, because `ESC {` and `ESC V` are standard mode commands.

<br>

## A worked example

The total line of the `receipt` fixture, `test/fixtures/esc-pos/receipt.bin`, is the eighth entry of its list. The line stands 210 dots down the paper, it is 30 dots tall, which is the line spacing of the Epson profile, and it holds 48 cells of font A in bold, the first of them a `T`:

```js
{
  type: 'line',
  y: 210,
  height: 30,
  rotation: 0,
  operations: [
    {
      type: 'text',
      x: 0,
      y: 0,
      width: 12,
      height: 24,
      codepoint: 84,                            // T
      font: 'A',
      cell: {width: 12, height: 24},
      glyph: {width: 12, height: 24},
      baseline: 18,
      scale: {x: 1, y: 1},
      style: {bold: true, underline: 0, upperline: 0, invert: false},
      rotation: 0,
      spacing: 0,
    },
    // 'otal', then the spaces of the table, then '16.75', the last cell at x 564
  ],
}
```

The cells are 24 dots tall in a line box of 30, and they sit at the top of it: the six dots of the line spacing are the gap below the line and belong to it. The encoder aligned the line by padding it with spaces, so every cell is a cell of the line and the last one ends at 576, the right edge of the paper.

The barcode below it, the tenth entry, is one line box of 88 dots: 30 rectangles of the bars, 60 dots tall and as wide as the bar they stand for, 3, 6, 9 or 12 dots for a module width of 3, the first of them at `x` 145, and 13 text cells of the human readable text underneath, four dots below the bars at `y` 64, the first of them at `x` 209.

```js
{type: 'rect', x: 145, y: 0, width: 3, height: 60}
{type: 'text', x: 209, y: 64, width: 12, height: 24, codepoint: 52, font: 'A', ... }
```

<br>

## Versioning

`version` is 1. A field or a type that is added does not change it and a consumer ignores what it does not know; a change in the meaning of an existing field does. `rasterize()` and `toSvg()` accept version 1 and throw on any other.

The golden lists next to the fixtures, `test/fixtures/esc-pos/receipt.layout.json` and four others, freeze the format the way the PBM files freeze the dots.
