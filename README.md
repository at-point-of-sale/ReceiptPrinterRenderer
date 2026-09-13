# ReceiptPrinterRenderer

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics, such as the Star TSP100 series and Bluetooth "cat" printers.

- [About ReceiptPrinterRenderer](README.md)
- [Usage and installation](documentation/usage.md)
- [ESC/POS commands](documentation/commands-esc-pos.md)
- [StarPRNT commands](documentation/commands-star-prnt.md)
- [Design document](documentation/design.md)

<br>

> This library is part of [@point-of-sale](https://point-of-sale.dev), a collection of libraries for interfacing browsers and Node with Point of Sale devices such as receipt printers, barcode scanners and customer facing displays.

<br>

## About ReceiptPrinterRenderer

Some receipt printers have no fonts and no barcode engine. They only accept images. This library takes the bytes produced by ReceiptPrinterEncoder, interprets them the way a real printer would, and produces a stream of image segments and the few commands the target printer still understands, such as cut and pulse.

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

- `EscPosRenderer` renders the commands the encoder emits for the `esc-pos` language.
- `StarPrntRenderer` renders the commands the encoder emits for the `star-prnt` and `star-line` languages, and the raster jobs of the `star-graphics` protocol.

And there are four helpers to do something with the images:

- `toPbm(bitmap)` returns a PBM file, the binary P4 variant.
- `toPng(bitmap)` returns a PNG file, one bit grayscale.
- `toImageData(bitmap)` returns an `ImageData`, for drawing on a canvas.
- `stitch(items, options)` joins the items of a render into one bitmap, for previews.

The dots are not the only output. `renderer.layout(bytes)` returns the display list of a stream instead: what is printed and where, as line boxes with the cells, the rectangles and the images that are on them, with no dot of it drawn, which is what a preview, a debugging view or a writer of another format consumes. One such writer comes with the package: `toSvg(layout)` of the `@point-of-sale/receipt-printer-renderer/svg` sub-entry turns a list into an SVG document, with the text as the outlines of the same face the bitmap font was rasterized from, so the receipt scales and prints at the resolution of whatever renders it.

```js
import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

const svg = toSvg(renderer.layout(bytes));
```

Text is drawn with a built in bitmap font, [Iosevka](https://github.com/be5invis/Iosevka) Medium rasterized into the 12 by 24 cell of font A and the 8 by 16 cell of font B, with [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) Mono J behind it for the half width katakana and the box drawing characters drawn on the dot grid so that boxes and rules close. Barcodes are drawn by this library as well: the one-dimensional symbologies, the GS1 DataBar family, QR codes and PDF417, including its truncated form.

The renderer is checked against the byte streams of ReceiptPrinterEncoder, golden images that are reviewed by eye before they are frozen, and against streams that other open source projects produce for their own examples or ship as their own samples: receiptline, python-escpos, escpos-php, ESCPOS_NET, ESCPost and escpos-tools. What they send is listed per command on the two command pages, under "Seen in the wild". It is also checked against the sample scripts of the [playground](https://github.com/NielsLeenheer/ReceiptPrinterPlayground), the encoder's own features in both languages at both paper widths. `npm run contact-sheet` renders all of them to a page and, where those tools are installed, shows what thermal and ESCPost make of the same bytes next to our render, and what receiptio makes of the document a receiptline stream came from. That page also prints: connect a printer over USB, serial or Bluetooth in its header and send any fixture whose language the printer speaks straight to it, over `npm run contact-sheet:serve` because Web USB and Web Serial need a secure context.

The renderer is normally not used directly, but constructed by a printer driver such as [WebUSBReceiptPrinter](https://github.com/NielsLeenheer/WebUSBReceiptPrinter), which knows the language, the width and the commands of the printer and passes the images on in the format the printer expects. The application hands the driver the class, or a function that imports it when a graphics printer turns up. Applications keep using ReceiptPrinterEncoder exactly as they do for printers with native ESC/POS support.

See [Usage and installation](documentation/usage.md) for the options, the item stream, the SVG output and a preview example, [The display list](documentation/display-list.md) for the format `layout()` returns, [ESC/POS commands](documentation/commands-esc-pos.md) and [StarPRNT commands](documentation/commands-star-prnt.md) for every command a language supports and how compatible it is, and the [design document](documentation/design.md) for the architecture, the output contract and the plan for driver support.

<br>

-----

<br>

This library has been created by Niels Leenheer under the [MIT license](LICENSE). Feel free to use it in your products. The development of this library is sponsored by Salonhub.

<a href="https://salonhub.nl"><img src="https://salonhub.nl/assets/images/salonhub.svg" width=140></a>
