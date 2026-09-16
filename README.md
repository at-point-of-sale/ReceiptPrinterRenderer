# ReceiptPrinterRenderer

Render the raw data sent to a receipt printer, ESC/POS, StarPRNT, Star Line or Star Graphics, to an image of the paper, and export it as PNG or SVG.

- [About ReceiptPrinterRenderer](README.md)
- [Usage and installation](documentation/usage.md)

<br>

> This library is part of [@point-of-sale](https://point-of-sale.dev), a collection of libraries for interfacing browsers and Node with Point of Sale devices such as receipt printers, barcode scanners and customer facing displays.

<br>

## About ReceiptPrinterRenderer

This library is a receipt printer without the printer. Give it the bytes an application sends to one, whatever produced them, and it interprets them the way the printer would: the text in the printer's fonts and codepages, the styles, the images, the page mode of ESC/POS, the cuts, and the barcodes, which it draws itself: the one-dimensional symbologies, the GS1 DataBar family, QR codes and PDF417. What comes out is the paper, as a stream of image segments and the few commands a printer that only prints graphics still understands, such as cut and pulse, and from there a PNG, an SVG or a preview on a canvas.

That makes it a viewer of receipts, a way to test what an application prints without a printer on the desk, and a renderer for printers that have no fonts and no barcode engine of their own. Internally it is used by the [@point-of-sale](https://point-of-sale.dev) printer drivers to support receipt printers that only support printing graphics, such as the Star TSP100 series up to the TSP100III and the Bluetooth "cat" printers. There the renderer is not used by the application but constructed by the driver, such as [WebUSBReceiptPrinter](https://github.com/at-point-of-sale/WebUSBReceiptPrinter), which knows the language, the width and the commands of the printer and passes the images on in the format the printer expects. The application hands the driver the class, or a function that imports it when a graphics printer turns up, and keeps using [ReceiptPrinterEncoder](https://github.com/at-point-of-sale/ReceiptPrinterEncoder) exactly as it does for printers with native ESC/POS support.

<br>

## Using the library

```js
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';

const renderer = new ReceiptPrinterRenderer({
    language: 'esc-pos',
    width: 576,
    codepageMapping: 'epson',
    commands: ['cut', 'pulse', 'feed'],
});

const items = renderer.render(bytes);

/* items is an array of image segments and commands, for example:

   [
       { type: 'image', width: 576, height: 412, data: Uint8Array },
       { type: 'cut', value: 'partial' },
   ]
*/
```

`ReceiptPrinterRenderer` takes the language as an option, the way ReceiptPrinterEncoder does: `esc-pos`, `star-prnt`, `star-line`, or `star-graphics` for the raster protocol of a Star TSP100. Underneath are two renderers, sharing the same painter and output format, which are named exports for code that only ever needs one language:

- `EscPosRenderer` renders ESC/POS, the `esc-pos` language.
- `StarPrntRenderer` renders the `star-prnt` and `star-line` languages, and the raster jobs of the `star-graphics` protocol.

And there are four helpers to do something with the images:

- `toPbm(bitmap)` returns a PBM file, the binary P4 variant.
- `toPng(bitmap)` returns a PNG file, one bit grayscale.
- `toImageData(bitmap)` returns an `ImageData`, for drawing on a canvas.
- `stitch(items, options)` joins the items of a render into one bitmap, for previews.

The dots are not the only output. `toSvg(layout)` of the `@point-of-sale/receipt-printer-renderer/svg` sub-entry writes the receipt as an SVG document, with the text as the outlines of the same face the bitmap font was made from, so the receipt scales and prints at the resolution of whatever renders it. It takes `renderer.layout(bytes)`, the description of what is printed and where that the renderer produces before it draws a dot.

```js
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

const svg = toSvg(renderer.layout(bytes));
```

See [Usage and installation](documentation/usage.md) for the options, the item stream, the SVG output, a preview example and the contract with the drivers.

<br>

## Command line interface

The package ships with a command line as well, for rendering a stream of printer commands to an image from the shell without writing a script: the same renderer and the same helpers with arguments in front of them, writing PNG, PBM, SVG or the display list as JSON, as one image of the whole roll or one per piece of paper. It runs without installing anything through `npx`.

```
npx @point-of-sale/receipt-printer-renderer receipt.bin -o receipt.png
npx @point-of-sale/receipt-printer-renderer -l star-prnt -c 32 receipt.bin -o receipt.svg
npx @point-of-sale/receipt-printer-renderer --pieces receipt.bin -o receipt.png
```

See [Command line](documentation/usage.md#command-line) for the options.

<br>

## Fonts

Text is drawn with a built in bitmap font, [Iosevka](https://github.com/be5invis/Iosevka) Medium in the 12 by 24 cell of font A and the 8 by 16 cell of font B, with [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) Mono J behind it for the half width katakana and [Noto Sans](https://github.com/notofonts) Hebrew and Thai for those two scripts, all three fitted to Iosevka, and the box drawing characters drawn on the dot grid so that boxes and rules close. The fonts are made from those faces in [ReceiptPrinterFontEditor](https://github.com/at-point-of-sale/ReceiptPrinterFontEditor) and this package carries what it exports.

<br>

## Testing

The renderer is checked against the byte streams of ReceiptPrinterEncoder, golden images that are reviewed by eye before they are frozen, and against streams that other open source projects produce for their own examples or ship as their own samples: receiptline, python-escpos, escpos-php, ESCPOS_NET, ESCPost and escpos-tools, so that what it renders is what those libraries send and not only what the encoder sends. It is also checked against the sample scripts of the [playground](https://github.com/at-point-of-sale/ReceiptPrinterPlayground), the encoder's own features in both languages at both paper widths. `npm run contact-sheet` renders all of them to a page and, where those tools are installed, shows what thermal and ESCPost make of the same bytes next to our render, and what receiptio makes of the document a receiptline stream came from. That page also prints: connect a printer over USB, serial or Bluetooth in its header and send any fixture whose language the printer speaks straight to it, over `npm run contact-sheet:serve` because Web USB and Web Serial need a secure context.

<br>

-----

<br>

This library has been created by Niels Leenheer under the [MIT license](LICENSE). Feel free to use it in your products. The development of this library is sponsored by Salonhub.

<a href="https://salonhub.nl"><img src="https://point-of-sale.dev/logo.svg" width=100></a>
