import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

import {EscPosRenderer, StarPrntRenderer} from '../../src/receipt-printer-renderer.js';
import {toPbm} from '../../src/formats/pbm.js';
import {stitch} from '../../src/formats/stitch.js';
import {commands} from '../helpers/items.js';

/*
    Fixtures for the renderers.

    Every fixture is one receipt, encoded by ReceiptPrinterEncoder, which is the
    only producer of these byte streams the renderer has to handle. The same
    receipts are encoded in both languages, so that the parity test can compare
    the two renders. The bytes go to <name>.bin, the render to <name>.pbm and
    the items that are not images to <name>.items.json.

    The PBM files are generated once, reviewed by eye as ASCII art, and are
    golden from then on. Regenerating them changes what the tests expect, so
    only run this script when the output was checked again:

        node test/tools/make-fixtures.js

    The PBM is the paper, not the stream: the image items are stitched below
    each other and a feed item becomes white rows, so that a change in where the
    renderer splits its images does not change the fixture.
*/

/* The printer the fixtures are made for: 80 mm paper, 576 dots, 48 columns of
   font A */

const WIDTH = 576;
const COLUMNS = 48;

/* ESC/POS command bytes that the encoder does not emit, for the fixtures that
   need them */

const GS = 0x1d;

/*
    The image the image fixtures print: a checkerboard with a filled circle over
    it, in three greys, so that the dithering of the encoder has something to
    do. The size is a multiple of eight in both directions, which the encoder
    requires, and of twenty four in height, so that the column mode encoding
    fills its strips exactly.
*/

/**
 * A test image, as the pixel object the encoder accepts
 *
 * @param  {number}   width    Width in pixels
 * @param  {number}   height   Height in pixels
 * @return {object}            An image of {width, height, data}
 */
function pattern(width, height) {
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - width / 2) / (width / 4);
      const dy = (y - height / 2) / (height / 4);

      const circle = dx * dx + dy * dy < 1;
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;

      const value = circle ? 0x00 : (checker ? 0xff : 0x60);
      const offset = (y * width + x) * 4;

      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 0xff;
    }
  }

  return {width, height, data};
}

const IMAGE = pattern(200, 96);

const RENDERER = {width: WIDTH, commands: ['cut', 'pulse', 'feed']};

/*
    The two languages, with the mapping that belongs to each of them.

    autoFlush is off for StarPRNT. The encoder switches the printer to line
    units and back at the end of a job that does not end in a cut or a pulse,
    with ESC GS P 0 and ESC GS P 1, and it puts those commands on a line of
    their own, so the receipt gains a blank line that the ESC/POS encoding does
    not have. That is a property of the job, not of the receipt, so the
    fixtures leave it out and parity holds for every one of them. The renderer
    does parse the two commands, and test/star-prnt.js checks that they change
    nothing.
*/

const languages = [
  {
    name: 'esc-pos',
    renderer: EscPosRenderer,
    options: {language: 'esc-pos', codepageMapping: 'epson'},
  },
  {
    name: 'star-prnt',
    renderer: StarPrntRenderer,
    options: {language: 'star-prnt', codepageMapping: 'star', autoFlush: false},
  },
];

/*
    The receipts.

    A receipt that prints box drawing characters selects cp437 first. Without
    it the encoder uses the codepage the printer starts in, which is cp437 on
    ESC/POS but the Star specific character set on StarPRNT, and that one has
    no horizontal line, so the same receipt would come out differently in the
    two languages. Selecting cp437 costs nothing on ESC/POS, the encoder
    selects the same codepage either way.
*/

const receipts = {
  /* A few lines of plain text, with an empty line between them */

  'text': (encoder) => encoder
      .line('ReceiptPrinterRenderer')
      .line('The quick brown fox jumps over the lazy dog')
      .newline()
      .line('0123456789 !@#$%^&*()'),

  /* Every style the encoder can produce, switched on and off halfway a line */

  'styles': (encoder) => encoder
      .bold(true).text('Bold').bold(false).text(' and normal')
      .newline()
      .underline(true).text('Underline').underline(false).text(' and normal')
      .newline()
      .invert(true).text('Invert').invert(false).text(' and normal')
      .newline()
      .italic(true).text('Italic').italic(false).text(' and normal')
      .newline()
      .bold(true).underline(true).text('Both').underline(false).bold(false)
      .newline(),

  /* Size multipliers, on their own lines and mixed on one line */

  'sizes': (encoder) => encoder
      .size(1, 1).line('Size 1x1')
      .size(2, 1).line('2x1')
      .size(1, 2).line('1x2')
      .size(2, 2).line('2x2')
      .size(3, 3).line('3x3')
      .size(1, 1).text('a')
      .size(2, 2).text('B')
      .size(1, 3).text('c')
      .size(1, 1).text('d')
      .newline(),

  /* Both fonts, including the box drawing characters in the small cell */

  'fonts': (encoder) => encoder
      .codepage('cp437')
      .font('A').line('Font A, the 12 by 24 cell')
      .font('B').line('Font B, the 8 by 16 glyphs in a 9 by 17 cell')
      .font('B').line('┌─┬─┐ │ ║ ╔═╗')
      .font('A').line('Font A again'),

  /* The three alignments */

  'alignment': (encoder) => encoder
      .align('left').line('Left aligned')
      .align('center').line('Centered')
      .align('right').line('Right aligned')
      .align('left').line('Left again'),

  /* A table with a column per alignment */

  'table': (encoder) => encoder
      .table(
          [
            {width: 22, align: 'left'},
            {width: 10, align: 'center'},
            {width: 16, align: 'right'},
          ],
          [
            ['Item', 'Qty', 'Price'],
            ['Coffee', '2', '5.00'],
            ['Cheesecake', '1', '4.25'],
            ['Sparkling water', '3', '7.50'],
          ],
      ),

  /* Boxes in both styles, with and without padding */

  'box': (encoder) => encoder
      .codepage('cp437')
      .box({style: 'single', align: 'left'}, 'A single box')
      .newline()
      .box({style: 'double', align: 'center', paddingLeft: 2, paddingRight: 2}, 'A double box'),

  /* Rules in both styles, over the full width and over a part of it */

  'rule': (encoder) => encoder
      .codepage('cp437')
      .rule()
      .rule({style: 'double'})
      .rule({width: 20})
      .rule({style: 'double', width: 20}),

  /* Text that does not fit on a line, which the encoder wraps */

  'wrap': (encoder) => encoder
      .line(
          'This line is much longer than the forty eight columns of this receipt, ' +
        'so the encoder wraps it over several lines of text.',
      ),

  /* Characters from several codepages, which the encoder switches between.
     Every candidate is in both mappings, so both languages switch at the same
     place, to the same codepage, with a different number */

  'codepages': {
    options: {codepageCandidates: ['cp437', 'cp858', 'windows1252', 'cp866']},
    build: (encoder) => encoder
        .codepage('auto')
        .line('Café über Straße')
        .line('Prijs: € 12,50')
        .line('Привет мир'),
  },

  /* Both cut types, with text on either side */

  'cut': (encoder) => encoder
      .line('Before the partial cut')
      .cut('partial')
      .line('Between the cuts')
      .cut('full'),

  /* A cut and a drawer pulse */

  'pulse': (encoder) => encoder
      .line('Open the drawer')
      .cut('partial')
      .pulse(0, 100, 500),

  /* Runs of blank lines, which become feed items */

  'feed': (encoder) => encoder
      .line('Above the gap')
      .newline(3)
      .line('Below the gap')
      .newline(6)
      .cut('full'),

  /* A dithered image in column mode, the mode the encoder uses by default.
     StarPRNT has no other mode, so both languages encode this one the same way */

  'image-column': {
    options: {imageMode: 'column'},
    build: (encoder) => encoder
        .align('center')
        .image(IMAGE, IMAGE.width, IMAGE.height, 'atkinson')
        .align('left'),
  },

  /* The same image in raster mode, GS v 0. The encoder only has raster mode for
     ESC/POS, the StarPRNT encoding of this receipt is the column mode one of
     the fixture above, which renders to the same paper */

  'image-raster': {
    options: {imageMode: 'raster'},
    build: (encoder) => encoder
        .align('center')
        .image(IMAGE, IMAGE.width, IMAGE.height, 'atkinson')
        .align('left'),
  },

  /* QR codes in two sizes and at two error correction levels */

  'qrcode': (encoder) => encoder
      .align('center')
      .qrcode('https://example.com/order/9912', {model: 2, size: 4, errorlevel: 'l'})
      .qrcode('https://example.com/order/9912', {model: 2, size: 6, errorlevel: 'h'})
      .align('left'),

  /* One receipt per symbology. The width of a module is two on both languages
     for every symbology but ITF, where the ESC/POS encoding doubles it, so that
     one uses width one and comes out at the same size */

  'ean13': (encoder) => encoder
      .align('center')
      .barcode('4006381333931', 'ean13', {height: 60, width: 2, text: true})
      .barcode('400638133393', 'ean13', {height: 60, width: 2, text: true})
      .align('left'),

  'ean8': (encoder) => encoder
      .align('center')
      .barcode('96385074', 'ean8', {height: 60, width: 2, text: true})
      .align('left'),

  'upca': (encoder) => encoder
      .align('center')
      .barcode('123456789012', 'upca', {height: 60, width: 2, text: true})
      .align('left'),

  'upce': (encoder) => encoder
      .align('center')
      .barcode('01234565', 'upce', {height: 60, width: 2, text: true})
      .align('left'),

  'code39': (encoder) => encoder
      .align('center')
      .barcode('ABC-123', 'code39', {height: 60, width: 2, text: true})
      .align('left'),

  'itf': (encoder) => encoder
      .align('center')
      .barcode('12345670', 'itf', {height: 60, width: 1, text: true})
      .align('left'),

  'codabar': (encoder) => encoder
      .align('center')
      .barcode('A12345A', 'codabar', {height: 60, width: 2, text: true})
      .align('left'),

  'code93': (encoder) => encoder
      .align('center')
      .barcode('TEST93', 'code93', {height: 60, width: 2, text: true})
      .align('left'),

  /* Code 128 with the code set selection ESC/POS carries and StarPRNT strips.
     Both values are ones the automatic selection encodes the same way, so that
     the two languages still print the same bars */

  'code128': (encoder) => encoder
      .align('center')
      .barcode('{BABC-123', 'code128', {height: 60, width: 2, text: true})
      .barcode('{C1234', 'code128', {height: 60, width: 2, text: true})
      .align('left'),

  /* Code 128 with the code sets picked by the printer, and GS1-128, which is a
     Code 128 with FNC1 in front of the data. Both are addressed by the number
     of the symbology instead of by its name, because the encoder does not list
     them in the capabilities of a printer it knows nothing about: 79 and 74 on
     ESC/POS, 6 and 9 on StarPRNT */

  'code128-auto': (encoder, language) => encoder
      .align('center')
      .barcode('ABC12345678', language === 'esc-pos' ? 0x4f : 0x06, {height: 60, width: 2, text: true})
      .align('left'),

  'gs1-128': (encoder, language) => encoder
      .align('center')
      .barcode('0103453120000011', language === 'esc-pos' ? 0x4a : 0x09, {height: 60, width: 2, text: true})
      .align('left'),

  /* The human readable text: not at all, below the bars in font A, and below
     the bars in font B. The encoder never emits GS f, the command that selects
     the font of the text, so that one is written by hand, on the caption line
     in front of the barcode, and only for ESC/POS: a Star printer draws the
     text in font A and has no command to change it */

  'hri': (encoder, language) => {
    const raw = (bytes) => language === 'esc-pos' ? encoder.raw(bytes) : encoder;

    encoder.align('center').line('No text');
    encoder.barcode('4006381333931', 'ean13', {height: 50, width: 2, text: false});

    raw([GS, 0x66, 0x00]).line('Text below, font A');
    encoder.barcode('4006381333931', 'ean13', {height: 50, width: 2, text: true});

    raw([GS, 0x66, 0x01]).line('Text below, font B');
    encoder.barcode('4006381333931', 'ean13', {height: 50, width: 2, text: true});

    /* The font of the text is not reset behind the last barcode: GS f on a line
       of its own would print an empty line that the StarPRNT encoding does not
       have, and the receipt ends here */

    return encoder.align('left');
  },

  /* Everything on one receipt, the way a shop prints it */

  'receipt': (encoder) => encoder
      .codepage('cp437')
      .align('center')
      .bold(true).line('THE CORNER STORE').bold(false)
      .line('Kerkstraat 1, Amsterdam')
      .align('left')
      .newline()
      .table(
          [
            {width: 28, align: 'left'},
            {width: 6, align: 'center'},
            {width: 14, align: 'right'},
          ],
          [
            ['Coffee', '2', '5.00'],
            ['Cheesecake', '1', '4.25'],
            ['Sparkling water', '3', '7.50'],
          ],
      )
      .rule()
      .table(
          [
            {width: 34, align: 'left'},
            {width: 14, align: 'right'},
          ],
          [
            [(e) => e.bold(true).text('Total'), (e) => e.bold(true).text('16.75')],
          ],
      )
      .newline()
      .align('center')
      .barcode('4006381333931', 'ean13', {height: 60, width: 2, text: true})
      .newline()
      .qrcode('https://example.com/order/9912', {model: 2, size: 5, errorlevel: 'm'})
      .line('Thank you')
      .align('left')
      .newline(2)
      .cut('partial')
      .pulse(0, 100, 500),
};

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

for (const language of languages) {
  const directory = path.join(fixtures, language.name);
  const Renderer = language.renderer;

  fs.mkdirSync(directory, {recursive: true});

  console.log(language.name);

  for (const [name, receipt] of Object.entries(receipts)) {
    const options = typeof receipt === 'function' ? {} : receipt.options;
    const build = typeof receipt === 'function' ? receipt : receipt.build;

    const encoder = new ReceiptPrinterEncoder(
        Object.assign({columns: COLUMNS}, language.options, options),
    );

    const bytes = build(encoder.initialize(), language.name).encode();

    const items = new Renderer(RENDERER).render(bytes);
    const bitmap = stitch(items, {width: WIDTH});

    fs.writeFileSync(path.join(directory, `${name}.bin`), bytes);
    fs.writeFileSync(path.join(directory, `${name}.pbm`), toPbm(bitmap));
    fs.writeFileSync(
        path.join(directory, `${name}.items.json`),
        JSON.stringify(commands(items), null, 2) + '\n',
    );

    console.log(
        `  ${name.padEnd(12)} ${String(bytes.length).padStart(6)} bytes  ` +
      `${String(bitmap.height).padStart(5)} rows  ${items.length} items`,
    );
  }
}
