# ReceiptPrinterRenderer

<br>

Render images based on raw ESC/POS, StarPRNT, Star Line or Star Graphics printer language payloads. Instead of sending the raw bytes to a receipt printer, you render it as an image and export it as PNG or SVG.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
  - [Installation](#installation)
  - [Creating a renderer](#creating-a-renderer)
  - [The renderer of one language](#the-renderer-of-one-language)
  - [The item stream](#the-item-stream)
  - [Commands the printer supports](#commands-the-printer-supports)
  - [Feed items and maximum height](#feed-items-and-maximum-height)
  - [Image format helpers](#image-format-helpers)
  - [Previewing a receipt](#previewing-a-receipt)
  - [The cutter's distance](#the-cutters-distance)
  - [The display list](#the-display-list)
  - [SVG output](#svg-output)
  - [Drivers and applications](#drivers-and-applications)
  - [What is not rendered](#what-is-not-rendered)
- [Command line interface](cli.md)

<br>

## Usage and installation

This package is compatible with browsers and Node. It provides bundled versions for direct use in the browser and can also be used as an input for your own bundler. And of course there are ES6 modules and CommonJS versions for use in Node and Deno. It also ships with a command line, see [Command line interface](cli.md).

<br>

### Installation

Install the package using npm:

    npm install @point-of-sale/receipt-printer-renderer --save

It depends on [@point-of-sale/codepage-encoder](https://github.com/at-point-of-sale/CodepageEncoder) for the codepages, on [lean-qr](https://github.com/davidje13/lean-qr) for the QR codes, and on the tokenizer entry of [@point-of-sale/receipt-printer-decoder](https://github.com/at-point-of-sale/ReceiptPrinterDecoder), which says where every command of a stream begins and ends. The bundles for the browser carry all three, the builds for Node import them.

The default export is `ReceiptPrinterRenderer`, which renders every language the encoder speaks:

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';
```

The same class, the renderer of one language and the image format helpers are named exports as well:

```js
import { ReceiptPrinterRenderer, EscPosRenderer, StarPrntRenderer, stitch, toImageData, toPbm, toPng } from '@point-of-sale/receipt-printer-renderer';
```

Or the CommonJS way:

```js
const { ReceiptPrinterRenderer } = require('@point-of-sale/receipt-printer-renderer');
```

The `dist` folder contains bundles that can be directly used in the browser. Load the `receipt-printer-renderer.umd.js` file and use the `ReceiptPrinterRenderer` global, which is the class itself.

```html
<script src='dist/receipt-printer-renderer.umd.js'></script>

<script>

    let renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576 });

</script>
```

In the browser bundle the renderer of one language and the four helpers are properties of the global, `ReceiptPrinterRenderer.EscPosRenderer`, `ReceiptPrinterRenderer.stitch` and so on, because a script tag has nowhere else to put them.

There is also a modern ES6 module, `receipt-printer-renderer.esm.js`, in the same folder.

```js
import ReceiptPrinterRenderer from 'receipt-printer-renderer.esm.js';
```

The browser bundles contain everything, the Node and bundler builds keep `@point-of-sale/codepage-encoder` and `lean-qr` external.

<br>

### Creating a renderer

`ReceiptPrinterRenderer` takes the language of the commands as an option, the way ReceiptPrinterEncoder does, so a receipt is rendered with the language it was encoded with:

```js
let renderer = new ReceiptPrinterRenderer({
    language: 'esc-pos',
    width: 576,
    codepageMapping: 'epson',
    commands: [ 'cut', 'pulse' ],
    maxHeight: 1024,
});

let items = renderer.render(bytes);
```

`render()` accepts a `Uint8Array` or an array of numbers and returns the items, see [The item stream](#the-item-stream). Every call starts from a clean printer state, so one renderer can be reused for every receipt.

These are the options:

| Option | Default | Meaning |
|---|---|---|
| `language` | `esc-pos` | The language the commands are in: `esc-pos`, `star-prnt`, `star-line` or `star-graphics`. Anything else throws. |
| `width` | required | Width of the print area in dots. Must be a multiple of 8. |
| `codepageMapping` | `epson` for ESC/POS, `star` for StarPRNT | The mapping the encoder used, so that the codepage selection command can be turned back into a codepage. The same names as the encoder's mappings for that language. |
| `commands` | `[]` | Command types that may appear in the output: `cut`, `pulse`, `feed` and `unknown`. Everything else falls back, see [Commands the printer supports](#commands-the-printer-supports). |
| `maxHeight` | none | Maximum height of an image item in dots. Taller segments are split. |
| `lineSpacing` | from the profile | Default line spacing in dots, 30 for the Epson profile and 32 for the Star profile. |
| `cutterDistance` | `0` | Distance between the cutter and the print head in dots, see [The cutter's distance](#the-cutters-distance). |
| `profile` | `epson` for ESC/POS, `star` for StarPRNT | Printer family defaults: line spacing, font B cell size, vertical motion unit and resolution. A name, or a profile of your own. |
| `feedThreshold` | `24` | Minimum run of blank dot rows that becomes a feed item. |
| `font` | built in | Font data, for applications that want a different look. The same packed format as the generated font. |

Text is drawn with the built in bitmap font, see [Fonts](../README.md#fonts) for the faces and the codepages it covers. A character it has no glyph for is printed as U+FFFD, a combining mark gets a cell of its own beside its letter, and a Unicode format character prints an empty cell.

The width and the number of columns you configure the encoder with must agree. Font A is 12 dots wide, so the columns are `width / 12`. 576 dots gives 48 columns, 384 dots gives 32, both exact. If they disagree, the encoder wraps text in the wrong place and the renderer cannot repair that. The renderer reports what it expects:

```js
console.log(renderer.columns);       //  48
```

It also reports the language it was created for, which is what a driver puts in its connected event, and the class knows which languages there are:

```js
console.log(renderer.language);                  //  esc-pos
console.log(ReceiptPrinterRenderer.languages);   //  [ 'esc-pos', 'star-prnt', 'star-line', 'star-graphics' ]
```

The first three are the languages of the encoder. `star-graphics` is the raster protocol of the Star TSP100 family, which a driver resolves from the profile of the printer it is connected to: a job in it is the StarPRNT command set with the raster mode of `ESC * r A` in it, so it renders with the same renderer, and a renderer created for it reports `star-graphics`.

<br>

### The renderer of one language

StarPRNT, Star Line Mode and the raster protocol of a TSP100 are one set of commands, so there are two renderers underneath: `EscPosRenderer` for ESC/POS and `StarPrntRenderer` for all three Star languages. They are named exports, they take the same options without `language`, and they produce exactly the same items. Use them when the language is fixed anyway, or when you want to bundle one language only.

```js
import { EscPosRenderer, StarPrntRenderer } from '@point-of-sale/receipt-printer-renderer';

let renderer = new EscPosRenderer({ width: 576, codepageMapping: 'epson', commands: [ 'cut', 'pulse' ] });
```

Both classes have a static `language` property, for code that is handed a class instead of a language:

```js
console.log(EscPosRenderer.language);    //  esc-pos
console.log(StarPrntRenderer.language);  //  star-prnt
```

A `ReceiptPrinterRenderer` created for `star-line` or for `star-graphics` renders with `StarPrntRenderer`, but reports the language it was given, because that is the language the encoder that produced the commands was configured with, or the protocol the driver is speaking:

```js
let renderer = new ReceiptPrinterRenderer({ language: 'star-line', width: 576, codepageMapping: 'star' });

console.log(renderer.language);    //  star-line
```

<br>

### The item stream

`render()` returns an array of items, in the order the printer would act on them. Only two things ever appear in it: image items, and the command types you listed in `commands`.

```js
let encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns: 48 });

let bytes = encoder
    .initialize()
    .line('Hello world')
    .newline(4)
    .cut('partial')
    .pulse(0, 100, 500)
    .encode();

let renderer = new ReceiptPrinterRenderer({ width: 576, commands: [ 'cut', 'pulse' ] });

let items = renderer.render(bytes);

/*
    [
        { type: 'image', width: 576, height: 150, data: Uint8Array },
        { type: 'cut', value: 'partial' },
        { type: 'image', width: 576, height: 30, data: Uint8Array },
        { type: 'pulse', device: 0, on: 100, off: 500 },
    ]
*/
```

These are the items:

| Type | Properties | Meaning |
|---|---|---|
| `image` | `width`, `height`, `data` | A rendered segment of the receipt. Any height, no padding except rows to whole bytes. |
| `cut` | `value`: `full` or `partial` | Cut the paper here. |
| `pulse` | `device`, `on`, `off` | Open the cash drawer. Times in milliseconds, as the encoder specified them. |
| `feed` | `height` | Advance the paper by this many blank dot rows. |
| `unknown` | `data` | A command that was not understood, with its bytes. For diagnostics. |

An image item is a bitmap: one bit per pixel, most significant bit first, rows padded to whole bytes, a set bit is a black dot. The row stride is `Math.ceil(width / 8)` bytes. That is byte for byte the row format of the ESC/POS `GS v 0` raster command, the Star raster `b` command and the PBM P4 file format, so an image item usually goes to the printer without touching a single byte.

A supported command flushes the lines above it: the renderer emits everything up to the last finished line as an image item, then the command item. That is why there are two image items in the example above, one for the text and one for the blank line the encoder feeds between the cut and the pulse. The end of the stream flushes every line that was finished, so a receipt without a cut, common for kitchen printers, still produces its last image. Text that never got its line feed is the one thing it does not print: those cells are still in the line buffer of the printer when the job ends, and a printer never puts them on paper either.

<br>

### Commands the printer supports

The driver lists the commands the printer still understands in `commands`. For every command that is not in the list the renderer applies one fixed fallback, so that a driver never has to think about it:

| Command | Fallback |
|---|---|
| `cut` | Nothing. The blank lines the encoder feeds before a cut are already in the image. |
| `pulse` | Dropped. |
| `feed` | White rows inside the surrounding image item. |
| `unknown` | Dropped. |

With the default of `[]` the whole receipt comes out as image items and nothing else, which is what a printer without a cutter and without a drawer needs.

<br>

### Feed items and maximum height

Receipts contain many blank rows, especially the feed before a cut, and in an image a blank row costs as many bytes as a printed one. When `feed` is in `commands`, a run of blank rows at least `feedThreshold` dots tall becomes a feed item instead of white rows, and the image is split around it. Printers with a feed command, such as the Bluetooth cat printers, waste no bandwidth on white paper.

```js
let renderer = new ReceiptPrinterRenderer({
    width: 384,
    commands: [ 'feed' ],
    feedThreshold: 24,
});
```

`maxHeight` splits image items that grow taller than the limit. The split is on a row boundary, the pieces are consecutive image items, and nothing is lost. Use it for printers with a maximum raster height per command, and for flow control over slow links.

```js
let renderer = new ReceiptPrinterRenderer({ width: 576, maxHeight: 256 });
```

<br>

### Image format helpers

The helpers are separate named exports, so that a driver that only needs the items does not pull them in. They all take a bitmap, which is what an image item is.

`toPbm(bitmap)` returns a PBM file, the binary P4 variant, as a `Uint8Array`. The header is two lines and the body is the bitmap data as it is, which makes it the cheapest way to write a render to disk.

```js
import { writeFileSync } from 'node:fs';

writeFileSync('receipt.pbm', toPbm(bitmap));
```

`toPng(bitmap)` returns a PNG file as a `Uint8Array`, one bit grayscale. Compression goes through the platform's `CompressionStream`, so the helper needs no dependency, works in browsers and in Node 18 and up, and is asynchronous.

```js
let png = await toPng(bitmap);
```

`toImageData(bitmap)` returns an `ImageData`, for drawing on a canvas. Browsers have the `ImageData` constructor as a global. Node does not, so you can pass one in, from a canvas library or a small class of your own.

```js
canvas.getContext('2d').putImageData(toImageData(bitmap), 0, 0);
```

```js
import { ImageData } from 'canvas';

let image = toImageData(bitmap, ImageData);
```

`stitch(items, options)` joins the items of a render into one bitmap, the way the paper comes out of the printer: image items below each other, a feed item as white rows, and optionally a dashed line at every cut. A pulse and an unknown command take up no space. This is a preview helper, a driver sends the items to the printer instead.

```js
let paper = stitch(items, { cutMarker: true });
```

| Option | Default | Meaning |
|---|---|---|
| `cutMarker` | `false` | Draw a dashed line of two dot rows where the paper is cut. |
| `feed` | `true` | Expand feed items to white rows. Set to `false` to leave them out. |
| `width` | the first image item | Width of the paper in dots. |

<br>

### Previewing a receipt

Encoding, rendering and drawing the result on a canvas is the whole preview.

```html
<canvas id="canvas"></canvas>
```

```js
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import ReceiptPrinterRenderer, { stitch, toImageData } from '@point-of-sale/receipt-printer-renderer';

let encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns: 48 });

let bytes = encoder
    .initialize()
    .newline()
    .align('center')
    .bold(true).line('THE CORNER STORE').bold(false)
    .align('left')
    .newline()
    .line('The quick brown fox jumps over the lazy dog')
    .newline()
    .align('center')
    .barcode('4006381333931', 'ean13', { height: 60, width: 2, text: true })
    .newline()
    .qrcode('https://example.com/order/9912', { model: 2, size: 5, errorlevel: 'm' })
    .align('left')
    .newline(2)
    .cut('partial')
    .encode();

/* Render the receipt the way a printer would print it */

let renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576, commands: [ 'cut' ] });
let items = renderer.render(bytes);

/* And put the paper on the canvas */

let paper = stitch(items, { width: 576, cutMarker: true });
let image = toImageData(paper);

let canvas = document.getElementById('canvas');

canvas.width = paper.width;
canvas.height = paper.height;
canvas.getContext('2d').putImageData(image, 0, 0);
```

To preview the same receipt for a Star printer, encode it with `language: 'star-prnt'` and render it with the same language and `codepageMapping: 'star'`. Nothing else changes.

<br>

### The cutter's distance

The cutter of a receipt printer sits above the print head. The paper between the two is blank and already past the head when a job starts, so the first line of a job prints that far below the cut edge, and the paper is cut that far above the row the cut command was given at: the blank lines an encoder feeds in front of its cut are still in the printer when the paper is cut, and they are the top of the next receipt, which is the blank margin a real receipt has.

`cutterDistance` is that distance in dots, and it is 0 by default, which is the paper as the commands describe it and what a driver that sends the items to a printer wants: the printer's own cutter applies its own distance. With a distance the paper of a job is the distance of blank rows followed by the rows of the job, and every cut lands at the row its command was given at, counted in the rows of the job.

```js
let renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576, commands: [ 'cut' ], cutterDistance: 120 });

let documents = pieces(renderer.layout(bytes)).map((piece) => toSvg(piece));
```

So a receipt that prints its text, feeds four lines and cuts comes out as a piece with the blank margin at the top and the text below it, and the four blank lines at the top of the piece behind it, the way it comes out of the printer. The distance a printer has is a property of its mechanism, in lines of the standard line spacing on most data sheets: four lines of 30 dots is 120.

Everything follows the shift: `layout()` puts the blank paper at the top as a `feed` entry and the distance in the list, `render()` holds the rows that stay in the printer back at every command it performs, so that the cut item stands between the right images, and `pieces()`, `rasterize()` and `toSvg()` split the paper where the cut falls. The runs of the item stream between its cuts are the pieces `pieces()` gives, row for row, whatever the printer performs. A cut can now fall inside a line or inside an image, which is what a printer does when it cuts through the ink: the entry is on both pieces, the rows above the cut on the one above and the rows below it on the one below, see [The display list](display-list.md#the-cutters-distance).

<br>

### Command line

Everything on this page is also available from the shell, as `receipt-printer-renderer` or through `npx` without installing: a stream in, a PNG, a PBM, an SVG or the display list out, as one image or one per piece of paper. It can also read the language out of the commands themselves, `-l auto`, and write the stream as a list of its commands rather than as an image, `-f commands`. See [Command line interface](cli.md).

<br>

### The display list

`render(bytes)` gives you the dots. `layout(bytes)` gives you what is printed and where, without drawing a dot of it: a list of line boxes with the cells, the rectangles and the images that are on them, in the order the printer prints them. It is on all three renderer classes and it takes the same bytes.

```js
let layout = renderer.layout(bytes);

// {
//   version: 1,
//   language: 'esc-pos',
//   width: 576,
//   height: 713,
//   dpi: 203,
//   entries: [
//     {type: 'line', y: 0, height: 30, rotation: 0, operations: [ ... ]},
//     {type: 'feed', y: 60, height: 30},
//     {type: 'cut', y: 683, value: 'partial'},
//   ],
// }
```

A `line` entry holds `text` operations, one per character cell, with the code point, the font, the cell, the size, the style and the position of the cell, `rect` operations for the bars of a barcode and the modules of a QR code, and `image` operations for the bitmaps a stream sent. A `page` entry holds the print areas of a page of page mode. Every operation carries its whole style, so a consumer needs no state of its own.

Every operation carries a `source` as well, `{offset, length}`, the bytes of the stream it came from: the byte that printed a cell of text, the command that drew a barcode or an image. So do the `feed`, `cut`, `pulse` and `unknown` entries. It is two numbers and never a copy of the bytes, which is what a view that puts a receipt next to its hex dump needs.

The list is a description, not an image: it says that an `A` of font A in bold stands at dot 24 of the line that starts at row 210, and it leaves drawing the `A` to whoever consumes it. That is what an SVG or a PDF writer needs, and what a debugging view of a receipt needs.

`rasterize(layout, options)` draws a list again and returns the items `render()` returns, so the two paths are interchangeable:

```js
import ReceiptPrinterRenderer, { rasterize } from '@point-of-sale/receipt-printer-renderer';

let items = rasterize(renderer.layout(bytes), { commands: ['cut', 'pulse'] });
```

It takes `commands`, `maxHeight`, `feedThreshold` and `font`, the options of a renderer that decide how the dots come out, and it is a static of `ReceiptPrinterRenderer` as well as a named export, so a page that loads the UMD build reaches it too. The list itself is never filtered by `commands`: every cut, pulse, feed and unknown command is in it. What `commands` does decide is which of them the printer performs, so a cut the driver supports takes the paper in front of it away and a reverse feed cannot move above it, in the list exactly as on the paper.

`pieces(layout)` splits a list at its cuts into the pieces of paper that leave the printer, one list per piece, in order: each has the height of the paper between two cuts and the entries that stand on it, moved up so that its first row is row 0, and no cut of its own. A cut at the very top or bottom, or two cuts on one row, leave no piece. It is a static of `ReceiptPrinterRenderer` as well as a named export, and a piece is a list like any other, so `rasterize()` draws it and `toSvg()` writes it:

```js
import ReceiptPrinterRenderer, { pieces } from '@point-of-sale/receipt-printer-renderer';
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

let documents = pieces(renderer.layout(bytes)).map((piece) => toSvg(piece));   // one SVG per piece of paper
```

[The display list](display-list.md) is the reference page of the format, with the entries, the operations and a worked example.

<br>

### SVG output

`toSvg(layout)` turns a display list into an SVG document: the text as the outlines of the same face the bitmap fonts were rasterized from, the bars of a barcode and the modules of a QR code as paths, and every image as an embedded PNG. It is a sub-entry of the package, `@point-of-sale/receipt-printer-renderer/svg`, because it carries those outlines and a driver that renders images for a printer has no use for them.

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

const renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576, codepageMapping: 'epson' });

const svg = toSvg(renderer.layout(bytes), {
    units: 'dots',        // 'dots', 'mm', 'pt' or 'px' for the width and height attributes; the viewBox is always dots
    cutMarker: false,     // a dashed line at every cut
    background: '#fff',   // or null for a transparent paper
    ink: '#000',
});
```

| Option | Default | Meaning |
|---|---|---|
| `units` | `'dots'` | The units of the `width` and `height` attributes of the document. `mm`, `pt` and `px` are worked out from the `dpi` of the list, so a receipt of 576 dots at 203 dpi is 72.07 mm wide. The `viewBox` is always the paper in dots, so everything inside the document is in dots whatever this says. |
| `cutMarker` | `false` | Draw a dashed line across the paper at every cut. Without it a cut is nothing, the way it is in the list. For one document per piece of paper instead, split the list with `pieces()` first, see below. |
| `background` | `'#fff'` | The colour of the paper, as a rectangle behind everything. `null` leaves it out, for a transparent document. |
| `ink` | `'#000'` | The colour everything is drawn in. |

`toSvg()` is synchronous and returns a string. It is the default export of the sub-entry as well as a named one, and the UMD build of the sub-entry exposes a `ReceiptPrinterRendererSvg` global with `toSvg` on it, for a page that loads the renderer and the writer from two script tags.

```html
<script src="receipt-printer-renderer.umd.js"></script>
<script src="receipt-printer-renderer-svg.umd.js"></script>
<script>
    const layout = new ReceiptPrinterRenderer({ width: 576 }).layout(bytes);
    document.body.innerHTML = ReceiptPrinterRendererSvg.toSvg(layout);
</script>
```

The document is one `<g>` per line of the receipt and one per page of page mode, in the order the printer prints them, over a `<defs>` that holds one path per distinct glyph the receipt uses. It scales to any size: the receipt of the fixtures is 37 kB, of which 19 kB is the definitions of the 43 distinct glyphs it uses, 8 kB gzipped, and it prints at the resolution of whatever renders it rather than at the 203 dots per inch of the paper.

Three things about it are worth knowing. The text is the outlines of the face, not the dots of the bitmap font, so a glyph is smooth where the render is blocky and the two differ by a dot at the edges of a stroke; the shapes, the positions and the sizes are the same. The box drawing and block characters come from neither: they are the geometry the editor draws them with, the same description that was filled onto the dot grid for the bitmap font, so a line lands on the dot it lands on in the render and a rounded corner is a real arc instead of a staircase. A glyph of the face is drawn as designed and is not cut at its cell: a brace, a parenthesis or a capital with two accents reaches a dot or two above its cell, where the bitmap font finishes the same glyph by hand inside the cell for the printer. And an image is a PNG of the dots as they land on the paper, black on white, so it does not take the `ink` colour and it paints white paper under itself on a transparent background.

`toSvg()` accepts version 1 of the display list and throws on any other. The document is the paper of the list, `width` by `height` dots, with one exception: a list of no height at all, a stream that printed nothing, becomes a document of one blank row, because a document of no height is refused by a rasterizer and drawn as nothing by a browser.

A receipt with cuts in it can be written two ways. As one document of the whole roll, with `cutMarker` on to draw a dashed line where the paper is cut, or as one document per piece of paper, by splitting the list with `pieces()` of the main entry and writing every piece:

```js
import ReceiptPrinterRenderer, { pieces } from '@point-of-sale/receipt-printer-renderer';
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

const roll = toSvg(layout, { cutMarker: true });           // one document, dashed lines at the cuts
const documents = pieces(layout).map((piece) => toSvg(piece));   // one document per piece of paper
```

A piece is a list of its own, with the rows of the paper between two cuts and nothing else, so its document has the height of that paper and no cut in it, whatever `cutMarker` says.

<br>

### Drivers and applications

Normally you do not construct a renderer yourself. The driver does, because the driver knows the printer: its width, the codepage mapping and the commands it still understands. Your application passes the class:

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';

let printer = new WebUSBReceiptPrinter({ renderer: ReceiptPrinterRenderer });
```

The option also accepts an async function that returns the class, for applications that want to load the renderer only when a graphics printer is connected:

```js
let printer = new WebUSBReceiptPrinter({
    renderer: () => import('@point-of-sale/receipt-printer-renderer').then((m) => m.default),
});
```

The driver knows which language the printer should be fed, so it constructs the renderer with that language, the width of the paper, the codepage mapping that belongs to the language and the commands the printer still understands. It then reports `language`, `codepageMapping` and `columns` in its connected event, and your application keeps using ReceiptPrinterEncoder exactly as it does for printers with native ESC/POS support.

Passing a renderer is optional. Without one a driver for a printer that only prints images reports the name of the raw protocol instead, `star-graphics` for the TSP100 family and `meow` for the cat printers, and passes the bytes you give it through unchanged, for applications that build those packets themselves.

<br>

### What is not rendered

The renderer covers the commands ReceiptPrinterEncoder version 3 emits. A few things are recognised, so that the rest of the stream stays in sync, but do not appear on the paper:

- **Maxicode, the two dimensional GS1 DataBar and the composite symbologies.** The other selectors of the two dimensional group of `GS ( k`, read and reported as an `unknown` item.
- **CJK text, and the logos a printer already holds.** There is no CJK font here, so a multibyte character is drawn as two placeholder cells unless the stream downloaded a glyph for it itself, and an image the stream never defined is reported instead of printed. Glyphs and images a stream does define are drawn, see the `ESC &` and the graphics rows of the ESC/POS reference.
- **Commands the renderer does not draw.** Skipped according to the argument lengths of the specification and reported as an `unknown` item, so that one command the renderer has never seen does not derail the text after it. Where a command ends is not this package's answer: the stream is cut into commands, runs of text and control bytes by the tokenizer of [@point-of-sale/receipt-printer-decoder](https://github.com/at-point-of-sale/ReceiptPrinterDecoder), which owns the syntax of all four languages, and the renderer says what each of them does to the paper.

An `unknown` item only reaches you when `unknown` is in `commands`, otherwise it is dropped. It carries the bytes of the command, which makes it the place to look when something is missing from a render. A command that cannot change the paper at all, a status request or a setting of the printer, does not produce one: it is consumed with its length and nothing else happens, so an `unknown` item always means something that could have been on the paper is not. The two command references say which is which, under "Statuses".

<br>
