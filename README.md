# ReceiptPrinterRenderer

Render images based on raw ESC/POS, StarPRNT, Star Line or Star Graphics printer language payloads. Instead of sending the raw bytes to a receipt printer, you render it as an image and export it as PNG or SVG.

- [About ReceiptPrinterRenderer](README.md)
- [Usage and installation](documentation/usage.md)
- [Command line interface](documentation/cli.md)

<br>

> This library is part of [@point-of-sale](https://point-of-sale.dev), a collection of libraries for interfacing browsers and Node with Point of Sale devices such as receipt printers, barcode scanners and customer facing displays.

<br>

## About ReceiptPrinterRenderer

This library is a renderer that supports the same language that receipt printers support. Give it the bytes an application sends to a receipt printer, whatever produced them, and it interprets them the way the printer would: the text in the printer's fonts and codepages, the styles, the images, the page mode of ESC/POS, the cuts, and the barcodes, which it draws itself: the one-dimensional symbologies, the GS1 DataBar family, QR codes and PDF417. What comes out is a stream of image segments and optionally a set of commands a printer does understand, such as cut and pulse, and from there a PNG, an SVG or a preview on a canvas.

The syntax of the four languages is not in this package: the bytes are cut into commands, runs of text and control bytes by the tokenizer of [ReceiptPrinterDecoder](https://github.com/at-point-of-sale/ReceiptPrinterDecoder), and what is here is what each of them does to the paper.

That makes it a viewer of receipts, a way to test what an application prints without a printer on the desk, and a renderer for printers that have no fonts and no barcode engine of their own. Internally it is used by the [@point-of-sale](https://point-of-sale.dev) printer drivers to support receipt printers that only support printing graphics, such as the Star TSP100 series up to the TSP100III.

<br>

## Using the library

The common way to use the renderer is not to use it at all, but to hand it to a printer driver. A driver such as [WebUSBReceiptPrinter](https://github.com/at-point-of-sale/WebUSBReceiptPrinter) knows the printer it is connected to, its language, the width of its paper and the commands it still understands, so it is the driver that constructs the renderer and turns every receipt into images before they go to the printer. Your application passes the class and keeps using [ReceiptPrinterEncoder](https://github.com/at-point-of-sale/ReceiptPrinterEncoder) exactly as it does for a printer with fonts of its own:

```js
import WebUSBReceiptPrinter from '@point-of-sale/webusb-receipt-printer';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';

const receiptPrinter = new WebUSBReceiptPrinter({
    renderer: ReceiptPrinterRenderer,
});

receiptPrinter.addEventListener('connected', (device) => {
    /* The language and the columns of the renderer, which is what to encode for */

    const encoder = new ReceiptPrinterEncoder({
        language: device.language,
        columns: device.columns,
        codepageMapping: device.codepageMapping,
    });

    const data = encoder
        .initialize()
        .line('The quick brown fox jumps over the lazy dog')
        .cut()
        .encode();

    receiptPrinter.print(data);
});

receiptPrinter.connect();
```

With WebUSB you do not know beforehand which printer the user is going to pick, so the `renderer` option also accepts a function that returns the class, which may be asynchronous, so that the package is only loaded when a graphics printer is actually connected:

```js
const receiptPrinter = new WebUSBReceiptPrinter({
    renderer: () => import('@point-of-sale/receipt-printer-renderer').then((m) => m.default),
});
```

The renderer is a package of its own and an optional peer dependency of the drivers, so it is only in your bundle when you use it. The driver's own documentation says which printers need it and what its `connected` event then reports.

The renderer can also be used on its own: `render()` turns a stream into image segments and commands, `toSvg()` writes it as an SVG document, and the helpers write PNG, PBM or a canvas for a preview. See [Usage and installation](documentation/usage.md) for all of it.

<br>

## Command line interface

The package ships with a command line as well, for rendering a stream of printer commands to an image from the shell without writing a script: the same renderer and the same helpers with arguments in front of them, writing PNG, PBM, SVG or the display list as JSON, as one image of the whole roll or one per piece of paper. It reads the language out of the commands themselves with `-l auto`, and writes the stream as a list of its commands with `-f commands`. It runs without installing anything through `npx`.

```
npx @point-of-sale/receipt-printer-renderer receipt.bin -o receipt.png
npx @point-of-sale/receipt-printer-renderer -l star-prnt -c 32 receipt.bin -o receipt.svg
npx @point-of-sale/receipt-printer-renderer --pieces receipt.bin -o receipt.png
npx @point-of-sale/receipt-printer-renderer -l auto -f commands receipt.bin
```

See [Command line interface](documentation/cli.md) for every option, the formats, the pieces and the exit codes.

<br>

## Fonts

Receipts are rendered with a hand crafted bitmap font based on [Iosevka](https://github.com/be5invis/Iosevka): the face rasterized into the 12 by 24 cell of font A and the 8 by 16 cell of font B, and then tuned dot by dot, so that every stem and every counter is right at the size of a receipt printer rather than what a rasterizer makes of it. Three subsets stand behind it for the scripts Iosevka has no glyph for: [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic) Mono J for the half width katakana, [Noto Sans Hebrew](https://github.com/notofonts/hebrew) for the Hebrew and [Noto Sans Thai](https://github.com/notofonts/thai) for the Thai. A glyph comes from the first of the four that has the character, and all four are drawn at the scale of Iosevka, which is the face.

The fonts are made in [ReceiptPrinterFontEditor](https://github.com/at-point-of-sale/ReceiptPrinterFontEditor), which rasterizes the faces and is where the hand work is done, and this package carries what it exports. The box drawing and block characters are not taken from a face at all: they are drawn by a rule on the dot grid, so that the lines of a box or a rule join across the cells, with double lines two dots thick and rounded corners as arcs in the SVG output.

Every code point of cp437, of the ISO 8859 and Windows Latin codepages, of the Greek and Cyrillic ones, of the katakana page of either printer family with the twelve kanji of Epson's table, and of every Hebrew and Thai page either family has, has a glyph. A character without one, which is Arabic and Khmer, is printed as U+FFFD. A combining mark is given a cell of its own beside the letter, the way a single byte codepage on a fixed cell printer puts it there, and a Unicode format character prints an empty cell.

<br>

## Testing

The renderer is checked against the byte streams of ReceiptPrinterEncoder, golden images that are reviewed by eye before they are frozen, and against streams that other open source projects produce for their own examples or ship as their own samples: receiptline, python-escpos, escpos-php, ESCPOS_NET, ESCPost and escpos-tools, so that what it renders is what real life applications send and not only what our own encoder sends. Those streams live in `test/fixtures/external`, each with its provenance and a golden image. It is also checked against the sample scripts of the [playground](https://github.com/at-point-of-sale/ReceiptPrinterPlayground), the encoder's own features in both languages at both paper widths. `npm run contact-sheet` renders all of them to a page and, where those tools are installed, shows what thermal and ESCPost make of the same bytes next to our render, and what receiptio makes of the document a receiptline stream came from. That page also prints: connect a printer over USB, serial or Bluetooth in its header and send any fixture whose language the printer speaks straight to it, over `npm run contact-sheet:serve` because Web USB and Web Serial need a secure context.

<br>

-----

<br>

This library has been created by Niels Leenheer under the [MIT license](LICENSE). Feel free to use it in your products. The development of this library is sponsored by Salonhub.

<a href="https://salonhub.nl"><img src="https://point-of-sale.dev/logo.svg" width=100></a>
