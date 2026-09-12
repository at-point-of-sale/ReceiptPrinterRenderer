# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

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
  - [Drivers and applications](#drivers-and-applications)
  - [What is not rendered](#what-is-not-rendered)
- [ESC/POS commands](commands-esc-pos.md)
- [StarPRNT commands](commands-star-prnt.md)
- [Design document](design.md)

<br>

## Usage and installation

This package is compatible with browsers and Node. It provides bundled versions for direct use in the browser and can also be used as an input for your own bundler. And of course there are ES6 modules and CommonJS versions for use in Node and Deno.

<br>

### Installation

Install the package using npm:

    npm install @point-of-sale/receipt-printer-renderer --save

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
| `language` | `esc-pos` | The language the commands are in: `esc-pos`, `star-prnt` or `star-line`. Anything else throws. |
| `width` | required | Width of the print area in dots. Must be a multiple of 8. |
| `codepageMapping` | `epson` for ESC/POS, `star` for StarPRNT | The mapping the encoder used, so that the codepage selection command can be turned back into a codepage. The same names as the encoder's mappings for that language. |
| `commands` | `[]` | Command types that may appear in the output: `cut`, `pulse`, `feed` and `unknown`. Everything else falls back, see [Commands the printer supports](#commands-the-printer-supports). |
| `maxHeight` | none | Maximum height of an image item in dots. Taller segments are split. |
| `lineSpacing` | from the profile | Default line spacing in dots, 30 for the Epson profile and 32 for the Star profile. |
| `profile` | `epson` for ESC/POS, `star` for StarPRNT | Printer family defaults: line spacing, font B cell size, vertical motion unit and resolution. A name, or a profile of your own. |
| `feedThreshold` | `24` | Minimum run of blank dot rows that becomes a feed item. |
| `font` | built in | Font data, for applications that want a different look. The same packed format as the generated font. |

The built in font is [Iosevka](https://github.com/be5invis/Iosevka) Medium, under the SIL Open Font License 1.1, rasterized into a 12 by 24 cell for font A and an 8 by 16 cell for font B when the package is built. The box drawing and block characters are drawn on the dot grid, so that the lines of a box or a rule join across the cells. Every code point of cp437, of the ISO 8859 and Windows Latin codepages, and of the Greek and Cyrillic ones has a glyph; a character without one is printed as U+FFFD.

The width and the number of columns you configure the encoder with must agree. Font A is 12 dots wide, so the columns are `width / 12`. 576 dots gives 48 columns, 384 dots gives 32, both exact. If they disagree, the encoder wraps text in the wrong place and the renderer cannot repair that. The renderer reports what it expects:

```js
console.log(renderer.columns);       //  48
```

It also reports the language it was created for, which is what a driver puts in its connected event, and the class knows which languages there are:

```js
console.log(renderer.language);                  //  esc-pos
console.log(ReceiptPrinterRenderer.languages);   //  [ 'esc-pos', 'star-prnt', 'star-line' ]
```

<br>

### The renderer of one language

StarPRNT and Star Line Mode are the same set of commands, so there are two renderers underneath: `EscPosRenderer` for ESC/POS and `StarPrntRenderer` for both Star languages. They are named exports, they take the same options without `language`, and they produce exactly the same items. Use them when the language is fixed anyway, or when you want to bundle one language only.

```js
import { EscPosRenderer, StarPrntRenderer } from '@point-of-sale/receipt-printer-renderer';

let renderer = new EscPosRenderer({ width: 576, codepageMapping: 'epson', commands: [ 'cut', 'pulse' ] });
```

Both classes have a static `language` property, for code that is handed a class instead of a language:

```js
console.log(EscPosRenderer.language);    //  esc-pos
console.log(StarPrntRenderer.language);  //  star-prnt
```

A `ReceiptPrinterRenderer` created for `star-line` renders with `StarPrntRenderer`, but reports `star-line`, because that is the language the encoder that produced the commands was configured with:

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

A supported command flushes the lines above it: the renderer emits everything up to the last finished line as an image item, then the command item. That is why there are two image items in the example above, one for the text and one for the blank line the encoder feeds between the cut and the pulse. The end of the stream flushes everything, so a receipt without a cut, common for kitchen printers, still produces its last image.

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

Encoding, rendering and drawing the result on a canvas is the whole preview. There is a complete page in [examples/preview.html](../examples/preview.html).

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

Passing a renderer is optional. Without one a driver for a printer that only prints images reports the name of the raw protocol instead, `star-graphics` for the TSP100 family and `meow` for the cat printers, and passes the bytes you give it through unchanged, for applications that build those packets themselves. See [Driver integration](design.md#driver-integration) in the design document for the full contract.

<br>

### What is not rendered

The renderer covers the commands ReceiptPrinterEncoder version 3 emits. A few things are recognised, so that the rest of the stream stays in sync, but do not appear on the paper:

- **Maxicode, the two dimensional GS1 DataBar and the composite symbologies.** The other selectors of the two dimensional group of `GS ( k`, parsed and reported as an `unknown` item.
- **Commands the parser does not know.** Skipped according to the argument lengths of the specification and reported as an `unknown` item, so that one command the renderer has never seen does not derail the text after it.

An `unknown` item only reaches you when `unknown` is in `commands`, otherwise it is dropped. It carries the bytes of the command, which makes it the place to look when something is missing from a render.

<br>

### Checking a render against other renderers

The repository keeps byte streams other open source projects produced or ship as their own samples, in `test/fixtures/external`, each with its provenance and a golden image; the two command references say per command which of them sends it, under "Seen in the wild".

`npm run contact-sheet` renders all of them to `build/contact-sheet/` and writes a page that puts every render next to its provenance. Where the tools are installed on the machine that builds the page it also shows what other renderers make of the same bytes: [thermal](https://github.com/zachzurn/thermal) and [ESCPost](https://github.com/receiptful/escpost) as images, `esc2html` of [escpos-tools](https://github.com/receipt-print-hq/escpos-tools) and [escpos-emulator](https://github.com/lezram/escpos-emulator) as HTML, with a coarse agreement metric per fixture. None of them is needed: a tool that is not there is a "not available" cell, and the page builds without any of them. What each one needs is written in its module under `tools/contact-sheet/references`.

<br>

The two command references list every command of a language, what it does to the paper and the values it accepts: [ESC/POS commands](commands-esc-pos.md) and [StarPRNT commands](commands-star-prnt.md).
