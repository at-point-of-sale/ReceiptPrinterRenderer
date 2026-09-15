# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/at-point-of-sale/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

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
  - [The display list](#the-display-list)
  - [Drivers and applications](#drivers-and-applications)
  - [What is not rendered](#what-is-not-rendered)
- [ESC/POS commands](commands-esc-pos.md)
- [StarPRNT commands](commands-star-prnt.md)
- [The display list](display-list.md)
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
| `language` | `esc-pos` | The language the commands are in: `esc-pos`, `star-prnt`, `star-line` or `star-graphics`. Anything else throws. |
| `width` | required | Width of the print area in dots. Must be a multiple of 8. |
| `codepageMapping` | `epson` for ESC/POS, `star` for StarPRNT | The mapping the encoder used, so that the codepage selection command can be turned back into a codepage. The same names as the encoder's mappings for that language. |
| `commands` | `[]` | Command types that may appear in the output: `cut`, `pulse`, `feed` and `unknown`. Everything else falls back, see [Commands the printer supports](#commands-the-printer-supports). |
| `maxHeight` | none | Maximum height of an image item in dots. Taller segments are split. |
| `lineSpacing` | from the profile | Default line spacing in dots, 30 for the Epson profile and 32 for the Star profile. |
| `profile` | `epson` for ESC/POS, `star` for StarPRNT | Printer family defaults: line spacing, font B cell size, vertical motion unit and resolution. A name, or a profile of your own. |
| `feedThreshold` | `24` | Minimum run of blank dot rows that becomes a feed item. |
| `font` | built in | Font data, for applications that want a different look. The same packed format as the generated font. |

The built in font is [Iosevka](https://github.com/be5invis/Iosevka) Medium, under the SIL Open Font License 1.1, with three subsets behind it for the scripts it has no glyph for, each under the same licence: [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) Mono J SemiBold for the half width katakana, [Noto Sans Hebrew](https://github.com/notofonts/hebrew) Medium for the Hebrew and [Noto Sans Thai](https://github.com/notofonts/thai) Medium for the Thai. A glyph comes from the first of the four that has the character, and all four are drawn at the scale of Iosevka, which is the face; they are rasterized into a 12 by 24 cell for font A and an 8 by 16 cell for font B in [ReceiptPrinterFontEditor](https://github.com/at-point-of-sale/ReceiptPrinterFontEditor), which is where the fonts of this package are made, and the package carries what it exports. The box drawing and block characters are drawn on the dot grid, so that the lines of a box or a rule join across the cells, and the handful of glyphs the rules get wrong at this size are drawn by hand in the editor. Every code point of cp437, of the ISO 8859 and Windows Latin codepages, of the Greek and Cyrillic ones, of the katakana page of either printer family with the twelve kanji of Epson's table, and of every Hebrew and Thai page either family has, has a glyph; a character without one, which is Arabic and Khmer, is printed as U+FFFD. A combining mark is given a cell of its own beside the letter, the way a single byte codepage on a fixed cell printer puts it there, and a Unicode format character prints an empty cell.

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

The list is a description, not an image: it says that an `A` of font A in bold stands at dot 24 of the line that starts at row 210, and it leaves drawing the `A` to whoever consumes it. That is what an SVG or a PDF writer needs, and what a debugging view of a receipt needs.

`rasterize(layout, options)` draws a list again and returns the items `render()` returns, so the two paths are interchangeable:

```js
import ReceiptPrinterRenderer, { rasterize } from '@point-of-sale/receipt-printer-renderer';

let items = rasterize(renderer.layout(bytes), { commands: ['cut', 'pulse'] });
```

It takes `commands`, `maxHeight`, `feedThreshold` and `font`, the options of a renderer that decide how the dots come out, and it is a static of `ReceiptPrinterRenderer` as well as a named export, so a page that loads the UMD build reaches it too. The list itself is never filtered by `commands`: every cut, pulse, feed and unknown command is in it. What `commands` does decide is which of them the printer performs, so a cut the driver supports takes the paper in front of it away and a reverse feed cannot move above it, in the list exactly as on the paper.

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
| `cutMarker` | `false` | Draw a dashed line across the paper at every cut. Without it a cut is nothing, the way it is in the list. |
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

Two things about it are worth knowing. The text is the outlines of the face, not the dots of the bitmap font, so a glyph is smooth where the render is blocky and the two differ by a dot at the edges of a stroke; the shapes, the positions and the sizes are the same. And an image is a PNG of the dots as they land on the paper, black on white, so it does not take the `ink` colour and it paints white paper under itself on a transparent background.

`toSvg()` accepts version 1 of the display list and throws on any other. The document is the paper of the list, `width` by `height` dots, with one exception: a list of no height at all, a stream that printed nothing, becomes a document of one blank row, because a document of no height is refused by a rasterizer and drawn as nothing by a browser.

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
- **CJK text, and the logos a printer already holds.** There is no CJK font here, so a multibyte character is drawn as two placeholder cells unless the stream downloaded a glyph for it itself, and an image the stream never defined is reported instead of printed. Glyphs and images a stream does define are drawn, see the `ESC &` and the graphics rows of the ESC/POS reference.
- **Commands the parser does not know.** Skipped according to the argument lengths of the specification and reported as an `unknown` item, so that one command the renderer has never seen does not derail the text after it.

An `unknown` item only reaches you when `unknown` is in `commands`, otherwise it is dropped. It carries the bytes of the command, which makes it the place to look when something is missing from a render. A command that cannot change the paper at all, a status request or a setting of the printer, does not produce one: it is consumed with its length and nothing else happens, so an `unknown` item always means something that could have been on the paper is not. The two command references say which is which, under "Statuses".

<br>

### Checking a render against other renderers

The repository keeps byte streams other open source projects produced or ship as their own samples, in `test/fixtures/external`, each with its provenance and a golden image; the two command references say per command which of them sends it, under "Seen in the wild".

`npm run contact-sheet` renders all of them to `build/contact-sheet/` and writes a page that puts every render next to its provenance. Where the tools are installed on the machine that builds the page it also shows what two other renderers make of the same bytes, [thermal](https://github.com/zachzurn/thermal) and [ESCPost](https://github.com/receiptful/escpost), with a coarse agreement metric per fixture. Both render to an image, which is what makes them comparable: a renderer that writes markup says nothing about whether the paper agrees. A third column, [receiptio](https://github.com/receiptline/receiptio), renders the ReceiptLine document a receiptline fixture was made from rather than its bytes, which says whether our render of a stream is the receipt the document describes whatever command set it was written in. None of them is needed: a tool that is not there is a "not available" cell, and the page builds without any of them. What each one needs is written in its module under `tools/contact-sheet/references`.

<br>

The two command references list every command of a language, what it does to the paper and the values it accepts: [ESC/POS commands](commands-esc-pos.md) and [StarPRNT commands](commands-star-prnt.md).
