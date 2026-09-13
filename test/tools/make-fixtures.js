import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import StarGraphicsPrinterEncoder from '@point-of-sale/star-graphics-printer-encoder';

import {EscPosRenderer, StarPrntRenderer} from '../../src/receipt-printer-renderer.js';
import {toSvg} from '../../src/svg.js';
import {toPbm} from '../../src/formats/pbm.js';
import {stitch} from '../../src/formats/stitch.js';
import {commands} from '../helpers/items.js';
import {toJson} from '../helpers/layout.js';

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

    A few fixtures also get their display list, <name>.layout.json, which freezes
    the format of layout() the way the PBM freezes the dots, see GOLDEN_LAYOUTS
    below and documentation/display-list.md, and a few get their SVG,
    <name>.svg, which freezes what the writer of the sub-entry makes of that
    list, see GOLDEN_SVG.
*/

/* The fixtures whose display list is frozen next to the paper: a receipt of
   text, one with a barcode and its human readable text, one with a raster
   image, a page of the four print directions and a Star raster job */

const GOLDEN_LAYOUTS = [
  'esc-pos/receipt',
  'esc-pos/hri',
  'esc-pos/image-raster',
  'star-prnt/raw/page-mode-directions',
  'star-prnt/raw/star-graphics',
];

/* The fixtures whose SVG is frozen next to the paper: a receipt of text in both
   languages, the styles and the sizes of the cells, both fonts, the box drawing
   characters, a barcode with its human readable text, a QR code, a PDF417
   symbol, a raster image, a cut, the quarter turn of ESC V, the glyphs a stream
   downloads, a page of the four print directions and a Star raster job */

const GOLDEN_SVG = [
  'esc-pos/receipt',
  'esc-pos/styles',
  'esc-pos/sizes',
  'esc-pos/fonts',
  'esc-pos/box',
  'esc-pos/hri',
  'esc-pos/code128',
  'esc-pos/qrcode',
  'esc-pos/pdf417',
  'esc-pos/image-raster',
  'esc-pos/cut',
  'star-prnt/receipt',
  'esc-pos/raw/rotation',
  'esc-pos/raw/user-defined',
  'star-prnt/raw/page-mode-directions',
  'star-prnt/raw/star-graphics',
];

/**
 * Write the SVG of a fixture, when it is one of the frozen ones. The options
 * are the defaults of the writer, so that a golden file is what a caller gets
 * from three lines; the options themselves are covered by test/svg.js.
 *
 * @param  {string}       key         Directory and name of the fixture
 * @param  {string}       directory   Where the fixture goes
 * @param  {string}       name        Name of the fixture
 * @param  {object}       renderer    The renderer of its language
 * @param  {Uint8Array}   bytes       The commands
 */
function writeSvg(key, directory, name, renderer, bytes) {
  if (!GOLDEN_SVG.includes(key)) {
    return;
  }

  fs.writeFileSync(path.join(directory, `${name}.svg`), toSvg(renderer.layout(bytes)));
}

/**
 * Write the display list of a fixture, when it is one of the frozen ones
 *
 * @param  {string}       key         Directory and name of the fixture
 * @param  {string}       directory   Where the fixture goes
 * @param  {string}       name        Name of the fixture
 * @param  {object}       renderer    The renderer of its language
 * @param  {Uint8Array}   bytes       The commands
 */
function writeLayout(key, directory, name, renderer, bytes) {
  if (!GOLDEN_LAYOUTS.includes(key)) {
    return;
  }

  fs.writeFileSync(
      path.join(directory, `${name}.layout.json`),
      JSON.stringify(toJson(renderer.layout(bytes)), null, 2) + '\n',
  );
}

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

  /* PDF417, at a size the printer picks and at a fixed number of columns and
     error correction level. Both languages carry the same parameters, so both
     print the same symbol */

  'pdf417': (encoder) => encoder
      .align('center')
      .pdf417('https://example.com/order/9912', {width: 3, height: 3, columns: 0, rows: 0, errorlevel: 2})
      .pdf417('RENDER 9912', {width: 3, height: 3, columns: 4, rows: 0, errorlevel: 4})
      .align('left'),

  /* The truncated form of a PDF417, which drops the right row indicator and the
     stop pattern. Only ESC/POS can ask for it, the StarPRNT command set has no
     command for the form of the symbol, so the two languages differ here, see
     the exceptions of test/parity.js */

  'pdf417-truncated': (encoder) => encoder
      .align('center')
      .pdf417('RENDER 9912', {width: 3, height: 3, columns: 4, rows: 0, errorlevel: 2, truncated: true})
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

  'code128': (encoder, language) => {
    encoder
        .align('center')
        .barcode('{BABC-123', 'code128', {height: 60, width: 2, text: true});

    /* Code set C carries the value of a digit pair in one byte, 0 to 99, which
       is what the ESC/POS specification says and what receiptline and
       escpos-php send: these four bytes are the pairs 00, 03, 12 and 34. The
       StarPRNT encoding strips the code set selection, so the same value is
       read as four characters there and prints something else; the case is
       therefore in the ESC/POS fixture alone and `code128` is an exception of
       the parity test, see test/parity.js */

    if (language === 'esc-pos') {
      encoder.barcode('{C\x00\x03\x0c\x22', 'code128', {height: 60, width: 2, text: true});
    }

    return encoder.align('left');
  },

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

    writeLayout(`${language.name}/${name}`, directory, name, new Renderer(RENDERER), bytes);
    writeSvg(`${language.name}/${name}`, directory, name, new Renderer(RENDERER), bytes);

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

/*
    The hand assembled fixtures.

    ReceiptPrinterEncoder does not emit the commands of section 12 of the
    implementation plan, so the streams of these fixtures are written out byte
    by byte here. They are rendered and written the same way the receipts above
    are, into test/fixtures/<language>/raw, so that the fixture helpers find
    them as a group of their own and the encoder fixtures keep their directory
    to themselves.

    The fixtures that exist in both languages are written so that the two
    streams print the same paper, which is what test/parity.js checks for them.
*/

const ESC = 0x1b;
const FS = 0x1c;
const RS = 0x1e;
const LF = 0x0a;
const HT = 0x09;
const NUL = 0x00;
const FF = 0x0c;
const CAN = 0x18;
const EOT = 0x04;
const BEL = 0x07;

/**
 * Build a byte stream from strings, numbers and arrays of numbers, so that a
 * fixture reads like the specification
 *
 * @param  {...(string|number|number[])}   parts   The pieces of the stream
 * @return {Uint8Array}                            The stream
 */
function stream(...parts) {
  const result = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      for (let i = 0; i < part.length; i++) {
        result.push(part.charCodeAt(i) & 0xff);
      }
    } else if (Array.isArray(part)) {
      result.push(...part);
    } else {
      result.push(part);
    }
  }

  return Uint8Array.from(result);
}

/**
 * A raster mode setting command, its value as ASCII digits closed with a NUL
 *
 * @param  {string}   command   The letter of the command, or the two letters of a margin
 * @param  {number}   value     The value of the setting
 * @return {number[]}           The bytes of the command
 */
function raster(command, value) {
  return Array.from(stream(ESC, '*r', command, String(value), NUL));
}

/**
 * A row of raster data, with the trailing white bytes trimmed the way
 * StarGraphicsPrinterEncoder trims them
 *
 * @param  {number[]}   bytes    The bytes of the row, eight dots per byte
 * @param  {boolean}    [feed]   False for the k command, which holds the position
 * @return {number[]}            The bytes of the command
 */
function rasterRow(bytes, feed = true) {
  const row = bytes.slice();

  while (row.length > 1 && row[row.length - 1] === 0x00) {
    row.pop();
  }

  return [feed ? 0x62 : 0x6b, row.length & 0xff, row.length >> 8, ...row];
}

/**
 * The rows of a rectangle of black dots, as raster data commands
 *
 * @param  {number}   left     Left edge in bytes of eight dots
 * @param  {number}   bytes    Width in bytes of eight dots
 * @param  {number}   rows     Number of rows
 * @return {number[]}          The commands
 */
function rasterBlock(left, bytes, rows) {
  const row = new Array(left + bytes).fill(0x00);

  row.fill(0xff, left, left + bytes);

  const result = [];

  for (let y = 0; y < rows; y++) {
    result.push(...rasterRow(row));
  }

  return result;
}

/* The twelve code points an international character set replaces, which is
   what the international fixture prints for every set it selects */

const NATIONAL = '#$@[\\]^`{|}~';

/*
    The image the image commands of section 13 print.

    It is the same picture the image fixtures print, dithered by the encoder
    itself: the fixture takes the raster image out of the GS v 0 command the
    encoder writes for it, so that every image command of section 13 carries
    exactly the dots ESC * and GS v 0 carry, and the renders can be compared
    dot for dot.
*/

/**
 * The test picture, as the encoder dithers it
 *
 * @return {object}   The width in bytes of eight dots, the height in dots and the dots in raster format
 */
function picture() {
  const encoder = new ReceiptPrinterEncoder({columns: COLUMNS, language: 'esc-pos', imageMode: 'raster'});
  const bytes = encoder.initialize().image(IMAGE, IMAGE.width, IMAGE.height, 'atkinson').encode();

  for (let index = 0; index + 8 <= bytes.length; index++) {
    if (bytes[index] !== GS || bytes[index + 1] !== 0x76 || bytes[index + 2] !== 0x30) {
      continue;
    }

    const width = bytes[index + 4] + bytes[index + 5] * 256;
    const height = bytes[index + 6] + bytes[index + 7] * 256;

    if (width * 8 !== IMAGE.width || height !== IMAGE.height) {
      throw new Error(`The encoder wrote a raster image of ${width * 8} by ${height} dots`);
    }

    return {width, height, data: Array.from(bytes.subarray(index + 8, index + 8 + width * height))};
  }

  throw new Error('The encoder wrote no raster image');
}

const PICTURE = picture();

/**
 * The dots of the picture in column format, one column after another, every
 * column a number of bytes of eight dots with the top dot in the most
 * significant bit, which is how ESC *, GS *, FS q and the column graphics of
 * GS ( L carry an image
 *
 * @param  {object}     image   The picture, in raster format
 * @return {number[]}           The dots, in column format
 */
function columnFormat(image) {
  const width = image.width * 8;
  const bytes = (image.height + 7) >> 3;
  const data = new Array(width * bytes).fill(0);

  for (let x = 0; x < width; x++) {
    for (let byte = 0; byte < bytes; byte++) {
      let value = 0;

      for (let bit = 0; bit < 8 && byte * 8 + bit < image.height; bit++) {
        const dot = (image.data[(byte * 8 + bit) * image.width + (x >> 3)] >> (7 - (x & 7))) & 1;

        if (dot) {
          value |= 0x80 >> bit;
        }
      }

      data[x * bytes + byte] = value;
    }
  }

  return data;
}

const COLUMNS_OF_PICTURE = columnFormat(PICTURE);

/* The size of the picture as the graphics functions of GS ( L count it, in
   dots, and as GS * and FS q count it, in bytes of eight dots */

const PICTURE_DOTS = [
  PICTURE.width * 8 & 0xff, (PICTURE.width * 8) >> 8,
  PICTURE.height & 0xff, PICTURE.height >> 8,
];

/**
 * A function of the graphics group, under the two byte length of GS ( L
 *
 * @param  {number}     fn           The function code
 * @param  {number[]}   parameters   The parameters of the function
 * @return {number[]}                The bytes of the command
 */
function graphics(fn, parameters) {
  const payload = [48, fn, ...parameters];

  return [GS, 0x28, 0x4c, payload.length & 0xff, payload.length >> 8, ...payload];
}

/**
 * The same function under the four byte length of GS 8 L, which is the form a
 * definition of more than 65535 bytes has to use
 *
 * @param  {number}     fn           The function code
 * @param  {number[]}   parameters   The parameters of the function
 * @return {number[]}                The bytes of the command
 */
function largeGraphics(fn, parameters) {
  const payload = [48, fn, ...parameters];
  const length = payload.length;

  return [
    GS, 0x38, 0x4c,
    length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff,
    ...payload,
  ];
}

/**
 * The dots of a shape of the size of a cell, as lines of ASCII art, so that the
 * glyphs the user defined fixture downloads are described instead of typed
 *
 * @param  {Function}   test     Whether the dot at x, y is black
 * @param  {number}     width    Width of the glyph in dots
 * @param  {number}     height   Height of the glyph in dots
 * @return {string[]}            One string per row
 */
function shape(test, width = 12, height = 24) {
  const rows = [];

  for (let y = 0; y < height; y++) {
    let row = '';

    for (let x = 0; x < width; x++) {
      row += test(x, y, width, height) ? '#' : '.';
    }

    rows.push(row);
  }

  return rows;
}

/**
 * A glyph in the column format of ESC & and FS 2: one column after another,
 * every column a number of bytes of eight dots with the top dot in the most
 * significant bit
 *
 * @param  {string[]}   rows   The dots, one string per row
 * @return {number[]}          The columns
 */
function columns(rows) {
  const height = rows.length;
  const bytes = height / 8;
  const data = [];

  for (let x = 0; x < rows[0].length; x++) {
    for (let byte = 0; byte < bytes; byte++) {
      let value = 0;

      for (let bit = 0; bit < 8; bit++) {
        if (rows[byte * 8 + bit].charAt(x) !== '.') {
          value |= 0x80 >> bit;
        }
      }

      data.push(value);
    }
  }

  return data;
}

/**
 * One character of ESC &: the number of columns it is wide and its columns
 *
 * @param  {string[]}   rows   The dots, one string per row
 * @return {number[]}          The bytes of the definition
 */
function definition(rows) {
  return [rows[0].length, ...columns(rows)];
}

/* The three glyphs the user defined fixture downloads, each of them the 12 by
   24 dots of a font A cell: a triangle standing on its point, a diamond and a
   frame with a diagonal through it */

const GLYPHS = {
  triangle: shape((x, y, w, h) => Math.abs(x - (w - 1) / 2) <= (y * (w - 1)) / (2 * (h - 1))),
  diamond: shape((x, y, w, h) =>
    Math.abs(x - (w - 1) / 2) / ((w - 1) / 2) + Math.abs(y - (h - 1) / 2) / ((h - 1) / 2) <= 1),
  frame: shape((x, y, w, h) =>
    x === 0 || y === 0 || x === w - 1 || y === h - 1 || Math.round((x * (h - 1)) / (w - 1)) === y),
};

/**
 * The picture of the image fixtures with half of its rows blanked, which is
 * what the two colour blocks of the colour fixture carry: the two together are
 * the whole picture, so the OR of the blocks is what the other image fixtures
 * print
 *
 * @param  {boolean}    top   True for the top half, false for the bottom one
 * @return {number[]}         The dots in raster format
 */
function half(top) {
  const data = PICTURE.data.slice();

  for (let y = 0; y < PICTURE.height; y++) {
    if (top === (y >= PICTURE.height / 2)) {
      data.fill(0, y * PICTURE.width, (y + 1) * PICTURE.width);
    }
  }

  return data;
}

/**
 * A two byte number, low byte first, the way every size and position of both
 * languages carries one
 *
 * @param  {number}     value   The number
 * @return {number[]}           The two bytes
 */
function word(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

/*
    The page mode fixtures below say where things go in dots, and the commands
    of the two languages count that in units of their own: ESC/POS counts the
    horizontal distances in horizontal motion units, one dot each until GS P
    says otherwise, and the vertical ones in vertical motion units, two per dot
    on an Epson, while the StarPRNT group counts every distance in dots, the way
    ESC GS A does. The helpers below hide that, so that the two streams of a
    fixture describe the same page.
*/

/**
 * ESC W, the print area of page mode, in dots on the page
 *
 * @param  {number}     x        Horizontal origin in dots
 * @param  {number}     y        Vertical origin in dots
 * @param  {number}     width    Width of the area in dots
 * @param  {number}     height   Height of the area in dots
 * @return {number[]}            The bytes of the command
 */
function pageArea(x, y, width, height) {
  return [ESC, 0x57, ...word(x), ...word(y * 2), ...word(width), ...word(height * 2)];
}

/**
 * ESC GS P 2, the same area in StarPRNT
 *
 * @param  {number}     x        Horizontal origin in dots
 * @param  {number}     y        Vertical origin in dots
 * @param  {number}     width    Width of the area in dots
 * @param  {number}     height   Height of the area in dots
 * @return {number[]}            The bytes of the command
 */
function starPageArea(x, y, width, height) {
  return [ESC, GS, 0x50, 0x32, ...word(x), ...word(y), ...word(width), ...word(height)];
}

/**
 * GS $, the absolute position along the vertical axis of the print direction
 *
 * @param  {number}     dots   The position in dots
 * @return {number[]}          The bytes of the command
 */
function pageVertical(dots) {
  return [GS, 0x24, ...word(dots * 2)];
}

/**
 * ESC $, the absolute position along the horizontal axis of the direction
 *
 * @param  {number}     dots   The position in dots
 * @return {number[]}          The bytes of the command
 */
function pageHorizontal(dots) {
  return [ESC, 0x24, ...word(dots)];
}

const raw = {
  /*
      ESC ! n against the individual commands. The two streams set the same
      state in the two languages: ESC ! carries the font, the bold, the two
      size bits and the underline in one byte, StarPRNT has a command for each
      of them.
  */

  'print-mode': {
    'esc-pos': stream(
        ESC, '@',
        'Plain text', LF,
        ESC, '!', 0x08, 'Bold text', LF,
        ESC, '!', 0x10, 'Double height', LF,
        ESC, '!', 0x20, 'Double width', LF,
        ESC, '!', 0x30, 'Double both', LF,
        ESC, '!', 0x80, 'Underline', LF,
        ESC, '!', 0x01, 'Font B', LF,
        ESC, '!', 0x00, 'Plain again', LF,
        ESC, 'G', 1, 'Double strike', LF,
        ESC, 'G', 0, 'Plain to the end', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        'Plain text', LF,
        ESC, 'E', 'Bold text', ESC, 'F', LF,
        ESC, 'h', 1, 'Double height', ESC, 'h', 0, LF,
        ESC, 'W', 1, 'Double width', ESC, 'W', 0, LF,
        ESC, 'h', 1, ESC, 'W', 1, 'Double both', ESC, 'h', 0, ESC, 'W', 0, LF,
        ESC, '-', 1, 'Underline', ESC, '-', 0, LF,
        ESC, RS, 'F', 1, 'Font B', ESC, RS, 'F', 0, LF,
        'Plain again', LF,
        ESC, 'E', 'Double strike', ESC, 'F', LF,
        'Plain to the end', LF,
    ),
  },

  /*
      ESC R n, the international character sets. The same twelve bytes are
      printed in every set, so the fixture is the table itself. Both languages
      number these sets the same way, so the streams are identical.
  */

  'international': (() => {
    const bytes = [ESC, 0x40];

    for (const set of [0, 1, 2, 3, 5, 6, 7, 8, 11, 13]) {
      bytes.push(ESC, 0x52, set, ...stream(NATIONAL), LF);
    }

    bytes.push(ESC, 0x52, 0, ...stream('Back to the USA set'), LF);

    return {'esc-pos': Uint8Array.from(bytes), 'star-prnt': Uint8Array.from(bytes)};
  })(),

  /*
      ESC { n, upside down printing. Every line that is committed while it is
      on is rotated by 180 degrees, the feed order of the lines is not.
  */

  'upside-down': {
    'esc-pos': stream(
        ESC, '@',
        'Right side up', LF,
        ESC, '{', 1,
        'Upside down one', LF,
        'Upside down two', LF,
        ESC, 'a', 1, 'Centred upside down', LF, ESC, 'a', 0,
        ESC, '{', 0,
        'Right side up again', LF,
    ),
  },

  /*
      ESC SP n, the right side character spacing, which grows with the width
      multiplier.
  */

  'spacing': {
    'esc-pos': stream(
        ESC, '@',
        'Tight', LF,
        ESC, ' ', 4, 'Spaced by four dots', LF,
        0x1d, '!', 0x11, 'Spaced and double', LF, 0x1d, '!', 0x00,
        ESC, ' ', 0, 'Tight again', LF,
    ),
  },

  /*
      HT and ESC D, the tab stops. The first line uses the default stop every
      eight characters, the three columns land on the stops of ESC D, and the
      last line has no stops at all: ESC D NUL cancels every one of them, after
      which a tab does nothing. The same commands exist in both languages.
  */

  'tabs': (() => {
    const bytes = Array.from(stream(
        ESC, '@',
        'A', HT, 'B', HT, 'C', HT, 'D', LF,
        ESC, 'D', 10, 20, 30, NUL,
        'Item', HT, 'Qty', HT, 'Price', LF,
        'Coffee', HT, '2', HT, '5.00', LF,
        'Tea', HT, '1', HT, '2.25', LF,
        'Cake', HT, '3', HT, '7.50', LF,
        ESC, 'D', NUL,
        'A', HT, 'B', HT, 'C', HT, 'D', LF,
    ));

    return {'esc-pos': Uint8Array.from(bytes), 'star-prnt': Uint8Array.from(bytes)};
  })(),

  /*
      ESC $ and ESC \, the absolute and the relative print position, with the
      horizontal motion unit of GS P in between. The last line moves back over
      the text that was just printed, which is what a negative distance does.
  */

  'positions': {
    'esc-pos': stream(
        ESC, '@',
        'Left', ESC, '$', 240, 0, 'Middle', ESC, '$', 0xa4, 1, 'Right', LF,
        'A', ESC, '\\', 60, 0, 'B', ESC, '\\', 60, 0, 'C', LF,
        0x1d, 'P', 180, 180,
        'Unit', ESC, '$', 200, 0, 'at 200 units of 1/180 inch', LF,
        0x1d, 'P', 0, 0,
        'ABC', ESC, '\\', 0xe8, 0xff, '___', LF,
        ESC, '$', 0, 0, 'Back at the left margin', LF,
    ),
  },

  /*
      The left margin and the print area, in dots on ESC/POS and in characters
      on StarPRNT. Two characters of font A are 24 dots and the area of 38
      characters is 456, so both streams print in the same place.
  */

  'margins': {
    'esc-pos': stream(
        ESC, '@',
        'Over the full width of the paper', LF,
        0x1d, 'L', 24, 0,
        0x1d, 'W', 0xc8, 1,
        'Inside the margins', LF,
        ESC, 'a', 1, 'Centred inside', LF,
        ESC, 'a', 2, 'Right inside', LF,
        ESC, 'a', 0,
        0x1d, 'L', 0, 0,
        0x1d, 'W', 0x40, 2,
        'Over the full width again', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        'Over the full width of the paper', LF,
        ESC, 'l', 2,
        ESC, 'Q', 40,
        'Inside the margins', LF,
        ESC, 0x1d, 'a', 1, 'Centred inside', LF,
        ESC, 0x1d, 'a', 2, 'Right inside', LF,
        ESC, 0x1d, 'a', 0,
        ESC, 'l', 0,
        ESC, 'Q', 48,
        'Over the full width again', LF,
    ),
  },

  /*
      The Kanji group. There is no CJK font here, so a lead byte and its trail
      byte become two cells of the fallback glyph, which is the width a printer
      gives the character. The first block is Shift JIS, the second one JIS,
      where every pair of printable bytes is one character.
  */

  'multibyte': {
    'esc-pos': stream(
        ESC, '@',
        'Kanji mode off', LF,
        FS, '&', FS, 'C', 1,
        'ABC', [0x93, 0xfa, 0x96, 0x7b], 'DEF', LF,
        FS, '.',
        'Kanji mode off again', LF,
        FS, 'C', 0, FS, '&',
        [0x30, 0x21, 0x30, 0x22, 0x30, 0x23], LF,
        FS, '.',
        FS, '!', 0x0c, FS, '-', 1, FS, 'S', 2, 2, FS, 'W', 1,
        'The parsed commands change nothing', LF,
    ),
  },

  /*
      A raster mode job, the way the TSP100 driver builds one: enter raster
      mode, store the modes while the buffer is empty, send the rows, and let
      ESC FF NUL print them and cut. The k row is deployed without a line feed,
      so the b row behind it ORs into the same row of dots.
  */

  'star-raster': {
    'star-prnt': stream(
        ESC, '*rR',
        ESC, '*rA',
        raster('Q', 0),
        raster('P', 0),
        raster('E', 1),
        ESC, BEL, 10, 50,
        raster('ml', 1),
        raster('F', 13),
        rasterBlock(5, 12, 16),
        raster('Y', 24),
        rasterRow([0xff, 0x00, 0x00, 0xff], false),
        rasterBlock(0, 2, 1),
        rasterBlock(5, 12, 8),
        ESC, 0x0c, NUL,
        raster('D', 1),
        ESC, 0x0c, EOT,
        ESC, '*rB',
    ),
  },

  /*
      GS ( L function 112, raster graphics into the print buffer, and function
      50, which prints the buffer. The first image is stored under the two byte
      length of GS ( L and the second one under the four byte length of GS 8 L,
      with the horizontal scale bx of 2, which doubles every dot.
  */

  'graphics-raster': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        graphics(112, [48, 1, 1, 49, ...PICTURE_DOTS, ...PICTURE.data]),
        graphics(50, []),
        ESC, 'a', 0,
        'Raster graphics, printed from the buffer', LF,
        ESC, 'a', 1,
        largeGraphics(112, [48, 2, 1, 49, ...PICTURE_DOTS, ...PICTURE.data]),
        largeGraphics(50, []),
        ESC, 'a', 0,
        'The same image under GS 8 L, bx of two', LF,
    ),
  },

  /*
      GS ( L function 113, the same picture in column format, which is the
      transpose of the raster data of the fixture above and has to render to
      the same dots.
  */

  'graphics-column': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        graphics(113, [48, 1, 1, 49, ...PICTURE_DOTS, ...COLUMNS_OF_PICTURE]),
        graphics(50, []),
        ESC, 'a', 0,
        'Column graphics, printed from the buffer', LF,
    ),
  },

  /*
      The NV graphics: function 67 defines the picture under the key code AB,
      69 prints it, and a print of a key the printer never got a definition for
      leaves the paper untouched. Function 66 deletes the key, after which the
      print does nothing either.
  */

  'graphics-nv': {
    'esc-pos': stream(
        ESC, '@',
        largeGraphics(67, [48, 0x41, 0x42, 1, ...PICTURE_DOTS, 49, ...PICTURE.data]),
        ESC, 'a', 1,
        graphics(69, [0x41, 0x42, 1, 1]),
        ESC, 'a', 0,
        'Printed from the NV memory', LF,
        graphics(69, [0x5a, 0x5a, 1, 1]),
        'A key the printer does not hold prints nothing', LF,
        graphics(66, [0x41, 0x42]),
        graphics(69, [0x41, 0x42, 1, 1]),
        'And nothing again once the key is deleted', LF,
    ),
  },

  /*
      The download graphics: function 83 defines the picture under the key code
      CD, 85 prints it at its own size and at double height, and function 81
      deletes every download definition.
  */

  'graphics-download': {
    'esc-pos': stream(
        ESC, '@',
        largeGraphics(83, [48, 0x43, 0x44, 1, ...PICTURE_DOTS, 49, ...PICTURE.data]),
        ESC, 'a', 1,
        graphics(85, [0x43, 0x44, 1, 1]),
        ESC, 'a', 0,
        'Printed from the download memory', LF,
        ESC, 'a', 1,
        graphics(85, [0x43, 0x44, 1, 2]),
        ESC, 'a', 0,
        'The same image at double height', LF,
        graphics(81, [0x43, 0x4c, 0x52]),
        graphics(85, [0x43, 0x44, 1, 1]),
        'Nothing is left after the delete', LF,
    ),
  },

  /*
      GS * and GS /, the downloaded bit image: the picture in column format, 25
      bytes of eight dots wide and 12 bytes of eight dots tall, printed at its
      own size and in the quadruple mode of GS / 3.
  */

  'download-bit-image': {
    'esc-pos': stream(
        ESC, '@',
        GS, '*', PICTURE.width, PICTURE.height / 8, COLUMNS_OF_PICTURE,
        ESC, 'a', 1,
        GS, '/', 0,
        ESC, 'a', 0,
        'The downloaded bit image', LF,
        ESC, 'a', 1,
        GS, '/', 3,
        ESC, 'a', 0,
        'The same image at quadruple size', LF,
    ),
  },

  /*
      FS q and FS p, the NV bit images: one image defined in the stream and
      printed by its number, and a print of an image the stream never defined,
      which leaves the paper untouched.
  */

  'nv-bit-image': {
    'esc-pos': stream(
        ESC, '@',
        FS, 'q', 1, [PICTURE.width, 0, PICTURE.height / 8, 0], COLUMNS_OF_PICTURE,
        ESC, 'a', 1,
        FS, 'p', 1, 0,
        ESC, 'a', 0,
        'NV bit image number one', LF,
        FS, 'p', 2, 0,
        'Image two was never defined', LF,
    ),
  },

  /*
      The GS1 DataBar family, symbologies 75 to 78 of GS k and 10 to 13 of
      ESC b. The encoder can write these commands, but only for a printer whose
      profile lists the symbology, so the streams are written by hand here, the
      way the two reference pages describe them.

      The module width is chosen so that both languages draw the same symbol.
      The encoder passes its width option, 1 to 3, straight through: as GS w n
      on ESC/POS, where this family is the exception that does not add one, and
      as n3 on StarPRNT, which this renderer reads as 2, 3 or 4 dots. The same
      option therefore draws a barcode one dot wider per module on StarPRNT
      than on ESC/POS, which no fixture can repair. These fixtures pair the
      values that land on the same dots instead, GS w 3 with an n3 of 2 for
      three dot modules and GS w 2 with an n3 of 1 for two dot ones, which is a
      pairing the encoder does not emit but which is what parity needs, and
      they are hand assembled anyway.

      The heights are the ones of the specification: Omnidirectional is at
      least 33 modules and Expanded at least 34, and Truncated and Limited have
      a height of their own, 13 and 10 modules, whatever the command asks for.
  */

  'databar-omni': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        GS, 'h', 100, GS, 'w', 3, GS, 'H', 2,
        GS, 'k', 75, 13, '0952123454321',
        GS, 'H', 0,
        GS, 'k', 75, 13, '0952123454321',
        ESC, 'a', 0,
        'GS1 DataBar Omnidirectional', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 'b', [10, 2, 2, 100], '0952123454321', RS,
        ESC, 'b', [10, 1, 2, 100], '0952123454321', RS,
        ESC, 0x1d, 'a', 0,
        'GS1 DataBar Omnidirectional', LF,
    ),
  },

  'databar-truncated': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        GS, 'h', 100, GS, 'w', 3, GS, 'H', 2,
        GS, 'k', 76, 13, '0952123454321',
        ESC, 'a', 0,
        'GS1 DataBar Truncated', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 'b', [11, 2, 2, 100], '0952123454321', RS,
        ESC, 0x1d, 'a', 0,
        'GS1 DataBar Truncated', LF,
    ),
  },

  'databar-limited': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        GS, 'h', 100, GS, 'w', 3, GS, 'H', 2,
        GS, 'k', 77, 13, '0123456789012',
        ESC, 'a', 0,
        'GS1 DataBar Limited', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 'b', [12, 2, 2, 100], '0123456789012', RS,
        ESC, 0x1d, 'a', 0,
        'GS1 DataBar Limited', LF,
    ),
  },

  /* Expanded with the two element strings the specification gives as examples:
     a weight in kilograms, which the compressed method of AI (3103) carries,
     and a production date, which the seven bit method carries */

  'databar-expanded': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        GS, 'h', 100, GS, 'w', 3, GS, 'H', 2,
        GS, 'k', 78, 30, '(01)90614141000015(3103)000123',
        ESC, 'a', 0,
        'GS1 DataBar Expanded', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 'b', [13, 2, 2, 100], '(01)90614141000015(3103)000123', RS,
        ESC, 0x1d, 'a', 0,
        'GS1 DataBar Expanded', LF,
    ),
  },

  /* A coupon, which is what a shop prints a DataBar Expanded for: the offer in
     AI (8110), a variable length identifier, so the general purpose field
     carries the whole element string. The symbol is nine characters wide,
     which only fits on the paper at two dots per module */

  'databar-coupon': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'a', 1,
        ESC, 'E', 1, 'THE CORNER STORE', ESC, 'E', 0, LF,
        'Save 1.00 on your next coffee', LF,
        GS, 'h', 80, GS, 'w', 2, GS, 'H', 2,
        GS, 'k', 78, 27, '(8110)106141410123456101100',
        'Valid until 31 December', LF,
        ESC, 'a', 0,
    ),

    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 'E', 'THE CORNER STORE', ESC, 'F', LF,
        'Save 1.00 on your next coffee', LF,
        ESC, 'b', [13, 2, 1, 80], '(8110)106141410123456101100', RS,
        'Valid until 31 December', LF,
        ESC, 0x1d, 'a', 0,
    ),
  },

  /*
      Page mode, the four print directions. One page of 576 by 240 dots holds
      four print areas of 288 by 120, each of them with a label and a rule in
      one of the directions: 0 left to right from the top left, 1 bottom to top
      from the bottom left, 2 right to left from the bottom right and 3 top to
      bottom from the top right. FF prints the page and returns to standard
      mode, and the line behind it is standard mode again.

      The two streams describe the same page, so the parity test compares them.
  */

  'page-mode-directions': {
    'esc-pos': stream(
        ESC, '@',
        'Four directions on one page', LF,
        ESC, 'L',
        pageArea(0, 0, 288, 120), ESC, 'T', 0, 'Dir 0', LF, '----------', LF,
        pageArea(288, 0, 288, 120), ESC, 'T', 1, 'Dir 1', LF, '----------', LF,
        pageArea(0, 120, 288, 120), ESC, 'T', 2, 'Dir 2', LF, '----------', LF,
        pageArea(288, 120, 288, 120), ESC, 'T', 3, 'Dir 3', LF, '----------', LF,
        FF,
        'Standard mode again', LF,
    ),

    'star-prnt': stream(
        ESC, '@',
        'Four directions on one page', LF,
        ESC, GS, 'P', '0',
        starPageArea(0, 0, 288, 120), ESC, GS, 'P', '3', 0, 'Dir 0', LF, '----------', LF,
        starPageArea(288, 0, 288, 120), ESC, GS, 'P', '3', 1, 'Dir 1', LF, '----------', LF,
        starPageArea(0, 120, 288, 120), ESC, GS, 'P', '3', 2, 'Dir 2', LF, '----------', LF,
        starPageArea(288, 120, 288, 120), ESC, GS, 'P', '3', 3, 'Dir 3', LF, '----------', LF,
        ESC, GS, 'P', '1',
        'Standard mode again', LF,
    ),
  },

  /*
      A coupon laid out in page mode with absolute positions: every line and
      every block stands where GS $ and ESC $ put it, in a print area of the
      full width, and the page reaches the paper as one block of its height.
  */

  'page-mode-coupon': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'L',
        pageArea(0, 0, 576, 400),
        ESC, 'a', 1, ESC, '!', 0x38, 'THE CORNER STORE', LF, ESC, '!', 0x00,
        ESC, 'a', 0,
        pageVertical(70), pageHorizontal(24), 'Coupon',
        pageHorizontal(300), '20% off one coffee',
        pageVertical(110), pageHorizontal(24), 'Valid until 31 December',
        pageVertical(150), GS, 'h', 60, GS, 'w', 2, GS, 'H', 2, GS, 'f', 0,
        GS, 'k', 69, [8], 'CORNER20',
        pageVertical(260), ESC, 'a', 1,
        GS, '(', 'k', [4, 0, 49, 65, 50, 0],
        GS, '(', 'k', [3, 0, 49, 67, 4],
        GS, '(', 'k', [3, 0, 49, 69, 49],
        GS, '(', 'k', [25, 0, 49, 80, 48], 'https://corner.example',
        GS, '(', 'k', [3, 0, 49, 81, 48],
        FF,
        'Thank you, see you soon', LF,
    ),
  },

  /*
      ESC FF prints the page and keeps it, so the same page can be printed
      again. The first print is the heading alone, the second one the heading
      with the line that was added behind it, and ESC S then throws the page
      away without printing it a third time.
  */

  'page-mode-esc-ff': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'L',
        pageArea(0, 0, 576, 100),
        'Printed twice', LF,
        ESC, FF,
        'Only in the second print', LF,
        ESC, FF,
        'Not printed at all', LF,
        ESC, 'S',
        'Standard mode again', LF,
    ),
  },

  /*
      CAN throws the dots of the page away and keeps the print area, so the
      page that FF prints is the text behind the CAN, in an area that still
      feeds its full height.
  */

  'page-mode-cancel': {
    'esc-pos': stream(
        ESC, '@',
        ESC, 'L',
        pageArea(0, 0, 576, 100),
        'Discarded by CAN', LF,
        CAN,
        'Printed after CAN', LF,
        FF,
        'Standard mode again', LF,
    ),
  },

  /*
      ESC &, the glyphs a stream downloads into the printer. The same three
      characters, A, B and C, are printed five times: before the definition,
      after it but before ESC % selects the downloaded set, with the set
      selected, in a double size, with the glyph of B cancelled by ESC ?, and
      after an ESC @, which throws every definition away.
  */

  'user-defined': {
    'esc-pos': stream(
        ESC, '@',
        'Before the definition ABC', LF,
        ESC, '&', 3, 'A', 'C',
        definition(GLYPHS.triangle), definition(GLYPHS.diamond), definition(GLYPHS.frame),
        'Defined, not selected ABC', LF,
        ESC, '%', 1,
        'Selected with ESC %   ABC', LF,
        ESC, '!', 0x38, 'ABC', LF, ESC, '!', 0x00,
        ESC, '?', 'B',
        'B cancelled by ESC ?  ABC', LF,
        ESC, '@',
        'After ESC @           ABC', LF,
    ),
  },

  /*
      ESC V, the rotation of the characters by 90 degrees clockwise. The cells
      of a rotated line stand sideways and still go left to right, so the line
      is as tall as a character is wide and reads from the bottom of the paper
      to the top.
  */

  'rotation': {
    'esc-pos': stream(
        ESC, '@',
        'Upright line', LF,
        ESC, 'V', 1,
        'Rotated line', LF,
        ESC, '!', 0x30, 'Rotated, double size', LF, ESC, '!', 0x00,
        ESC, 'a', 2, 'Rotated, right aligned', LF, ESC, 'a', 0,
        ESC, 'V', 0,
        'Upright again', LF,
    ),
  },

  /*
      The two colour commands, and the two colour blocks of a graphics
      definition. ESC r selects the colour of the characters, which this
      renderer draws in the black of its one bit paper whatever the colour is,
      and the definition carries the top half of the picture as colour 1 and the
      bottom half as colour 2, so the image it prints is the whole picture of
      the other image fixtures.
  */

  'colour': {
    'esc-pos': stream(
        ESC, '@',
        'Colour one text', LF,
        ESC, 'r', 1,
        'Colour two text', LF,
        ESC, 'r', 0,
        GS, '(', 'N', [2, 0, 48, 49],
        'Colour two by GS ( N', LF,
        GS, '(', 'N', [2, 0, 48, 48],
        ESC, 'a', 1,
        graphics(67, [48, 'C'.charCodeAt(0), 'C'.charCodeAt(0), 2, ...PICTURE_DOTS,
          49, ...half(true), 50, ...half(false)]),
        graphics(69, ['C'.charCodeAt(0), 'C'.charCodeAt(0), 1, 1]),
        ESC, 'a', 0,
        'Both colour blocks above', LF,
    ),
  },

  /*
      ESC GS S, the StarPRNT raster image: the same picture, 25 bytes of eight
      dots wide and 96 dots tall, drawn as a block and centred the way ESC GS a
      says.
  */

  'star-raster-image': {
    'star-prnt': stream(
        ESC, '@',
        ESC, 0x1d, 'a', 1,
        ESC, 0x1d, 'S', 1, [PICTURE.width, 0, PICTURE.height, 0, 0], PICTURE.data,
        ESC, 0x1d, 'a', 0,
        'The Star raster image', LF,
    ),
  },
};

for (const language of languages) {
  const directory = path.join(fixtures, language.name, 'raw');
  const Renderer = language.renderer;

  fs.mkdirSync(directory, {recursive: true});

  console.log(`${language.name}, hand assembled`);

  for (const [name, streams] of Object.entries(raw)) {
    const bytes = streams[language.name];

    if (!bytes) {
      continue;
    }

    const items = new Renderer(RENDERER).render(bytes);
    const bitmap = stitch(items, {width: WIDTH});

    writeLayout(`${language.name}/raw/${name}`, directory, name, new Renderer(RENDERER), bytes);
    writeSvg(`${language.name}/raw/${name}`, directory, name, new Renderer(RENDERER), bytes);

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

/*
    The star-graphics fixture.

    It is not written by hand and it is not encoded by ReceiptPrinterEncoder
    either: it is the receipt fixture rendered to items and handed to
    StarGraphicsPrinterEncoder, which is the job a driver sends a TSP100. The
    renderer reads that job back, in the star-prnt language, which is what the
    star-graphics language of the unified renderer is an alias of, so the
    fixture is the round trip of test/star-raster.js frozen as bytes.
*/

{
  const directory = path.join(fixtures, 'star-prnt', 'raw');
  const receipt = new Uint8Array(fs.readFileSync(path.join(fixtures, 'star-prnt', 'receipt.bin')));

  const bytes = new StarGraphicsPrinterEncoder().encode(new StarPrntRenderer(RENDERER).render(receipt));
  const items = new StarPrntRenderer(RENDERER).render(bytes);
  const bitmap = stitch(items, {width: WIDTH});

  writeLayout(
      'star-prnt/raw/star-graphics', directory, 'star-graphics', new StarPrntRenderer(RENDERER), bytes,
  );

  writeSvg(
      'star-prnt/raw/star-graphics', directory, 'star-graphics', new StarPrntRenderer(RENDERER), bytes,
  );

  fs.writeFileSync(path.join(directory, 'star-graphics.bin'), bytes);
  fs.writeFileSync(path.join(directory, 'star-graphics.pbm'), toPbm(bitmap));
  fs.writeFileSync(
      path.join(directory, 'star-graphics.items.json'),
      JSON.stringify(commands(items), null, 2) + '\n',
  );

  console.log(
      `  ${'star-graphics'.padEnd(12)} ${String(bytes.length).padStart(6)} bytes  ` +
    `${String(bitmap.height).padStart(5)} rows  ${items.length} items`,
  );
}
