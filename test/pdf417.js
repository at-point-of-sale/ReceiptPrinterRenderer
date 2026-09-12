import {createRequire} from 'node:module';

import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {pdf417} from '../src/symbologies/pdf417.js';
import clusters from '../generated/pdf417.js';
import {fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/*
    PDF417, read back with a barcode reader and compared with a second encoder.

    @zxing/library and bwip-js are dev dependencies for this file alone.

    The reader of ZXing takes the pixels of an image and returns what the symbol
    says, so the test reads the rendered receipt the way a scanner reads the
    paper. The renderer draws the symbol without a quiet zone, as a printer
    does, so the test adds the white margin the reader needs around it.

    bwip-js encodes the same data with an independent implementation, and its
    raw output is the module matrix of the symbol, so the two can be compared
    dot for dot. That covers everything below the data: the compaction, the
    length descriptor, the Reed-Solomon check codewords, the row indicators and
    the symbol characters of the three clusters. It only holds where the two
    encoders make the same choices, and there are two places where they do not:

    - Leftover capacity. Where the data does not fill the symbol this encoder
      pads with 900, as the specification and the reference encoders do, and
      bwip-js spends the room on more check codewords than the error correction
      level asks for. Both are symbols a reader accepts, so the comparison uses
      sizes that the data fills exactly.

    - The order of a latch and a character in text compaction. Where a space is
      followed by a digit, for instance, the two encoders latch to the mixed
      sub mode on either side of the space, which is the same number of
      codewords and different symbol characters.

    Where the two differ the test falls back on reading the symbol, which is the
    property that matters: whatever the encoder chose, a reader gets the data
    back.
*/

const require = createRequire(import.meta.url);

const bwipjs = require('bwip-js');
const {PDF417Reader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType} = require('@zxing/library');

const WIDTH = 576;
const MARGIN = 16;

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Build a byte stream from strings, numbers and arrays of numbers
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
 * Read a bitmap with the PDF417 reader, with a white margin around it
 *
 * @param  {object}        bitmap   The paper
 * @return {string|null}            The data of the symbol, or null when there is none
 */
function read(bitmap) {
  const width = bitmap.width + MARGIN * 2;
  const height = bitmap.height + MARGIN * 2;

  /* The luminance source of ZXing takes one byte per pixel, 0 is black */

  const pixels = new Uint8ClampedArray(width * height).fill(0xff);

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (Bitmap.getPixel(bitmap, x, y)) {
        pixels[(y + MARGIN) * width + x + MARGIN] = 0x00;
      }
    }
  }

  const source = new RGBLuminanceSource(pixels, width, height);
  const hints = new Map();

  hints.set(DecodeHintType.TRY_HARDER, true);

  try {
    return new PDF417Reader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch (error) {
    return null;
  }
}

/**
 * The module matrix bwip-js produces for the same data.
 *
 * Its input is a string, one character per byte, and binarytext keeps it that
 * way: without it a byte over 127 is read as the character of a codepage. For
 * data that is ASCII the option changes nothing, so every comparison uses it.
 *
 * @param  {Uint8Array}      data      The bytes to encode
 * @param  {object}          options   Columns, error correction level and the form of the symbol
 * @return {Array<number[]>}           One array per row, one module per entry
 */
function reference(data, options) {
  const symbol = bwipjs.raw(
      options.truncated ? 'pdf417compact' : 'pdf417',
      Array.from(data, (byte) => String.fromCharCode(byte)).join(''),
      {columns: options.columns, eclevel: options.errorLevel, binarytext: true},
  )[0];

  const rows = [];

  for (let row = 0; row < symbol.pixs.length / symbol.pixx; row++) {
    rows.push(Array.from(symbol.pixs.slice(row * symbol.pixx, (row + 1) * symbol.pixx)));
  }

  return rows;
}

/**
 * The ESC/POS commands that print a PDF417
 *
 * @param  {Uint8Array}   value       The bytes to encode
 * @param  {object}       [options]   Columns, rows, module width, row height, level and form
 * @return {Uint8Array}               The stream
 */
function escpos(value, options) {
  const settings = Object.assign(
      {columns: 0, rows: 0, moduleWidth: 3, rowHeight: 3, errorLevel: 2, truncated: false},
      options || {},
  );

  const length = value.length + 3;

  return stream(
      ESC, '@',
      GS, '(', 'k', [3, 0], [48, 65, settings.columns],
      GS, '(', 'k', [3, 0], [48, 66, settings.rows],
      GS, '(', 'k', [3, 0], [48, 67, settings.moduleWidth],
      GS, '(', 'k', [3, 0], [48, 68, settings.rowHeight],
      GS, '(', 'k', [4, 0], [48, 69, 48, 48 + settings.errorLevel],
      GS, '(', 'k', [3, 0], [48, 70, settings.truncated ? 1 : 0],
      GS, '(', 'k', [length & 0xff, (length >> 8) & 0xff], [48, 80, 48], Array.from(value),
      GS, '(', 'k', [3, 0], [48, 81, 48],
  );
}

/**
 * The StarPRNT commands that print a PDF417. There is no command for the form
 * of the symbol, a Star printer always prints the standard one.
 *
 * @param  {Uint8Array}   value       The bytes to encode
 * @param  {object}       [options]   Columns, rows, module width, row height and level
 * @return {Uint8Array}               The stream
 */
function star(value, options) {
  const settings = Object.assign(
      {columns: 0, rows: 0, moduleWidth: 3, rowHeight: 3, errorLevel: 2},
      options || {},
  );

  return stream(
      ESC, '@',
      ESC, GS, 'xS', [0x30, 0x01, settings.rows, settings.columns],
      ESC, GS, 'xS', [0x31, settings.errorLevel],
      ESC, GS, 'xS', [0x32, settings.moduleWidth],
      ESC, GS, 'xS', [0x33, settings.rowHeight],
      ESC, GS, 'xD', [value.length & 0xff, (value.length >> 8) & 0xff], Array.from(value),
      ESC, GS, 'xP',
  );
}

/**
 * The bands of rows with ink on them, so that a receipt can be read block by
 * block
 *
 * @param  {object}     paper   The paper of a fixture
 * @return {object[]}           The bands, as bitmaps
 */
function bands(paper) {
  const blank = (row) => {
    for (let x = 0; x < paper.width; x++) {
      if (Bitmap.getPixel(paper, x, row)) {
        return false;
      }
    }

    return true;
  };

  const result = [];

  let start = -1;

  for (let row = 0; row <= paper.height; row++) {
    if (row < paper.height && !blank(row)) {
      start = start < 0 ? row : start;
      continue;
    }

    if (start >= 0) {
      result.push(Bitmap.extractRows(paper, start, row - start));
      start = -1;
    }
  }

  return result;
}

/**
 * The width of the ink of a bitmap in dots, the left edge of the symbol to its
 * right edge
 *
 * @param  {object}   bitmap   The paper
 * @return {number}            Width in dots
 */
function inkWidth(bitmap) {
  let left = bitmap.width;
  let right = 0;

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (Bitmap.getPixel(bitmap, x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }

  return right - left + 1;
}

/* The data the tests encode: a short text, mixed case with punctuation, a long
   run of digits, bytes that are not text at all, and a string of two hundred
   characters, the kind of thing a boarding pass carries.

   The bytes are the UTF-8 of a string that is not ASCII, which byte compaction
   holds as it is; the reader turns the bytes it decodes back into text as
   UTF-8, so the test compares the two strings and not the bytes. */

const VALUES = {
  'short text': 'RENDER',
  'mixed case and punctuation': 'Order #9912: Café? "Mixed", 42%',
  'a long run of digits': '9912384756019283746501928374650192837465019',
  'bytes that are not text': ' Café ☕',
  'two hundred characters': (
    'M1LEENHEER/NIELS      EABCDEF AMSLHRKL 1234 250Y028C0012 34C>' +
    '5180 M6250BKL 0000000000000/00000000KL 1234567890 1'
  ).padEnd(200, ' '),
};

describe('PDF417', function() {
  describe('the symbol characters', function() {
    /**
     * The widths of the elements of a symbol character, starting with a bar
     *
     * @param  {number}     pattern   The seventeen modules as a number
     * @return {number[]}             The widths, or null when the pattern is not seventeen modules
     */
    function elements(pattern) {
      const bits = pattern.toString(2);

      if (bits.length !== 17) {
        return null;
      }

      const widths = [];

      let current = bits.charAt(0);
      let width = 0;

      for (const bit of bits) {
        if (bit === current) {
          width++;
          continue;
        }

        widths.push(width);

        current = bit;
        width = 1;
      }

      widths.push(width);

      return widths;
    }

    it('should hold 929 symbol characters for each of the three clusters', function() {
      assert.equal(clusters.length, 3);

      for (const cluster of clusters) {
        assert.equal(cluster.length, 929);
        assert.equal(new Set(cluster).size, 929);
      }
    });

    it('should be four bars and four spaces of one to six modules, seventeen in all', function() {
      for (const cluster of clusters) {
        for (const pattern of cluster) {
          const widths = elements(pattern);

          assert.isNotNull(widths, `${pattern.toString(2)} is not seventeen modules`);
          assert.equal(widths.length, 8);
          assert.equal(widths.reduce((total, width) => total + width, 0), 17);

          for (const width of widths) {
            assert.isAtLeast(width, 1);
            assert.isAtMost(width, 6);
          }
        }
      }
    });

    it('should be in the cluster of its position in the table', function() {
      for (let cluster = 0; cluster < clusters.length; cluster++) {
        for (const pattern of clusters[cluster]) {
          const [bar1, , bar2, , bar3, , bar4] = elements(pattern);

          assert.equal(((bar1 - bar2 + bar3 - bar4) % 9 + 9) % 9, cluster * 3);
        }
      }
    });
  });

  describe('the symbol', function() {
    const value = (text) => new TextEncoder().encode(text);

    it('should start every row with the start pattern', function() {
      const symbol = pdf417(value('RENDER'), {columns: 2, errorLevel: 2});

      for (const row of symbol.modules) {
        assert.deepEqual(row.slice(0, 17), [1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0]);
      }
    });

    it('should end every row with the stop pattern', function() {
      const symbol = pdf417(value('RENDER'), {columns: 2, errorLevel: 2});

      for (const row of symbol.modules) {
        assert.deepEqual(row.slice(-18), [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
      }
    });

    it('should be seventeen modules per column plus the patterns around them', function() {
      for (const columns of [1, 4, 12]) {
        const symbol = pdf417(value('RENDER'), {columns, errorLevel: 2});

        assert.equal(symbol.columns, columns);
        assert.equal(symbol.modules[0].length, 17 * (columns + 4) + 1);
      }
    });

    it('should drop the right row indicator and the stop pattern when truncated', function() {
      const symbol = pdf417(value('RENDER'), {columns: 4, errorLevel: 2, truncated: true});

      assert.equal(symbol.modules[0].length, 17 * (4 + 2) + 1);

      for (const row of symbol.modules) {
        assert.equal(row[row.length - 1], 1);
      }
    });

    it('should pick the shape that comes closest to three times as wide as tall', function() {
      const symbol = pdf417(value('https://example.com/order/9912'), {errorLevel: 2});

      assert.equal(symbol.columns, 2);
      assert.equal(symbol.rows, 14);
    });

    it('should derive the rows from the columns and the columns from the rows', function() {
      assert.equal(pdf417(value('RENDER'), {columns: 3, errorLevel: 2}).rows, 4);
      assert.equal(pdf417(value('RENDER'), {rows: 4, errorLevel: 2}).columns, 3);
    });

    it('should pick the recommended error correction level when it is automatic', function() {
      assert.equal(pdf417(value('RENDER'), {errorLevel: 'auto'}).errorLevel, 2);
      assert.equal(pdf417(value('x'.repeat(100)), {errorLevel: 'auto'}).errorLevel, 3);
      assert.equal(pdf417(value('x'.repeat(400)), {errorLevel: 'auto'}).errorLevel, 4);
    });

    it('should pick the level closest to the ratio the ratio mode asks for', function() {
      const data = value('https://example.com/order/9912');

      /* Sixteen data codewords, so ten tenths of them is sixteen check
         codewords, which is level 3, and four tenths is level 2 */

      assert.equal(pdf417(data, {errorLevel: 'auto', errorRatio: 10}).errorLevel, 3);
      assert.equal(pdf417(data, {errorLevel: 'auto', errorRatio: 4}).errorLevel, 2);
    });

    it('should never leave a symbol with fewer than three data codewords', function() {
      /* One codeword of data and the length descriptor fill the data area with
         no padding, which readers refuse, so the smallest symbol has three */

      for (const text of ['A', '7', '!', 'AB', 'OK']) {
        for (const errorLevel of [0, 1, 2, 3]) {
          const symbol = pdf417(value(text), {errorLevel});
          const data = symbol.columns * symbol.rows - (2 << errorLevel);

          assert.isAtLeast(data, 3, `${text} at level ${errorLevel}`);
        }
      }
    });

    it('should encode as much data as the largest symbol holds', function() {
      /* 925 codewords of data, the length descriptor and the two check
         codewords of level 0 are the 928 of the largest symbol there is */

      assert.isNotNull(pdf417(value('A'.repeat(1848)), {errorLevel: 0}));

      const symbol = pdf417(value('A'.repeat(1850)), {errorLevel: 0});

      assert.equal(symbol.columns, 16);
      assert.equal(symbol.rows, 58);

      assert.isNull(pdf417(value('A'.repeat(1851)), {errorLevel: 0}));
    });

    it('should return null when there is nothing to encode', function() {
      assert.isNull(pdf417(new Uint8Array(0), {}));
    });

    it('should return null when the data does not fit in the largest symbol', function() {
      assert.isNull(pdf417(value('x'.repeat(3000)), {}));
    });

    it('should return null when the data does not fit in the requested size', function() {
      assert.isNull(pdf417(value('x'.repeat(100)), {columns: 1, rows: 3}));
    });
  });

  describe('against bwip-js', function() {
    /* Data and sizes that fill their symbol exactly and that both encoders
       compact the same way, see the note at the top of this file.

       The last two are bytes that are not text at all, which byte compaction
       carries and no reader can turn back into a string, so the comparison with
       a second encoder is the only check there is on them. */

    const bytes = (value) => new TextEncoder().encode(value);

    const cases = [
      {name: '"HELLO WORLD"', data: bytes('HELLO WORLD'), columns: 3, levels: [0, 1, 2, 3, 4, 5, 6]},
      {name: '"RENDER"', data: bytes('RENDER'), columns: 2, levels: [0, 1, 2, 3, 4, 5, 6]},
      {name: 'a URL', data: bytes('https://example.com/order/9912'), columns: 5, levels: [1, 2, 3, 4, 5]},
      {name: 'a run of digits', data: bytes('1234567890123456789012345'), columns: 4, levels: [1, 2, 3, 4, 5]},
      {
        name: 'six bytes over 127',
        data: Uint8Array.from([0x80, 0x9f, 0xc0, 0xfe, 0xff, 0xa5]),
        columns: 3,
        levels: [0, 2],
      },
      {
        name: 'bytes over 127 between text',
        data: Uint8Array.from([0x44, 0x41, 0x54, 0x41, 0x80, 0x81, 0xfe, 0xff, 0x44, 0x41, 0x54, 0x41]),
        columns: 3,
        levels: [0, 2],
      },
    ];

    for (const entry of cases) {
      for (const errorLevel of entry.levels) {
        it(`should draw ${entry.name} at level ${errorLevel} module for module`, function() {
          const symbol = pdf417(entry.data, {columns: entry.columns, errorLevel});

          assert.deepEqual(symbol.modules, reference(entry.data, {columns: entry.columns, errorLevel}));
        });
      }

      it(`should draw ${entry.name} truncated module for module`, function() {
        const options = {columns: entry.columns, errorLevel: 2, truncated: true};
        const symbol = pdf417(entry.data, options);

        assert.deepEqual(symbol.modules, reference(entry.data, options));
      });
    }
  });

  for (const [language, Renderer, build] of [
    ['esc-pos', EscPosRenderer, escpos],
    ['star-prnt', StarPrntRenderer, star],
  ]) {
    describe(language, function() {
      for (const [name, value] of Object.entries(VALUES)) {
        for (const errorLevel of [0, 2, 4]) {
          for (const size of [{}, {columns: 6}, {rows: 30}]) {
            const shape = Object.keys(size).length === 0 ? 'an automatic size' : JSON.stringify(size);

            it(`should print ${name} at level ${errorLevel} and ${shape}`, function() {
              const options = Object.assign({errorLevel, moduleWidth: 2}, size);
              const bytes = new TextEncoder().encode(value);
              const items = new Renderer({width: WIDTH, profile: 'epson'}).render(build(bytes, options));

              assert.equal(items.length, 1, 'nothing was printed');

              assert.equal(read(stitch(items, {width: WIDTH})), value);
            });
          }
        }
      }

      for (const text of ['A', '7', '!', 'AB', 'OK']) {
        for (const errorLevel of [0, 1, 2, 3]) {
          for (const size of [{}, {columns: 3}, {columns: 2, rows: 14}]) {
            const shape = Object.keys(size).length === 0 ? 'an automatic size' : JSON.stringify(size);

            it(`should print ${JSON.stringify(text)} at level ${errorLevel} and ${shape}`, function() {
              const options = Object.assign({errorLevel, moduleWidth: 3}, size);
              const bytes = new TextEncoder().encode(text);
              const items = new Renderer({width: WIDTH, profile: 'epson'}).render(build(bytes, options));

              assert.equal(items.length, 1, 'nothing was printed');

              assert.equal(read(stitch(items, {width: WIDTH})), text);
            });
          }
        }
      }

      it('should print a symbol that is as tall as the rows and the row height say', function() {
        const items = new Renderer({width: WIDTH, profile: 'epson'}).render(
            build(new TextEncoder().encode('RENDER'), {columns: 4, rows: 6, moduleWidth: 3, rowHeight: 4}),
        );

        assert.equal(items[0].height, 6 * 4 * 3);
      });

      it('should print nothing when the symbol is wider than the paper', function() {
        const items = new Renderer({width: 384, profile: 'epson'}).render(
            build(new TextEncoder().encode('RENDER'), {columns: 8, moduleWidth: 8}),
        );

        assert.deepEqual(items, []);
      });
    });
  }

  describe('the truncated form', function() {
    it('should be narrower than the standard one and read the same', function() {
      const render = (truncated) => {
        const items = new EscPosRenderer({width: WIDTH, profile: 'epson'}).render(
            escpos(new TextEncoder().encode('TRUNCATED 9912'), {columns: 4, errorLevel: 2, truncated}),
        );

        return stitch(items, {width: WIDTH});
      };

      const standard = render(false);
      const truncated = render(true);

      assert.equal(read(standard), 'TRUNCATED 9912');
      assert.equal(read(truncated), 'TRUNCATED 9912');

      /* The truncated symbol is a row indicator and a stop pattern narrower,
         which is 17 plus 17 modules of three dots each */

      assert.equal(inkWidth(standard) - inkWidth(truncated), 34 * 3);
    });
  });

  describe('the fixtures', function() {
    for (const language of ['esc-pos', 'star-prnt']) {
      it(`should read both symbols of the ${language} pdf417 fixture`, function() {
        const blocks = bands(fixture(language, 'pdf417').paper);

        assert.equal(blocks.length, 2);

        assert.equal(read(blocks[0]), 'https://example.com/order/9912');
        assert.equal(read(blocks[1]), 'RENDER 9912');
      });
    }

    it('should read the truncated symbol of the esc-pos pdf417-truncated fixture', function() {
      const blocks = bands(fixture('esc-pos', 'pdf417-truncated').paper);

      assert.equal(blocks.length, 1);
      assert.equal(read(blocks[0]), 'RENDER 9912');

      /* Four data columns, so a truncated symbol is 17 * (4 + 2) + 1 modules of
         three dots wide */

      assert.equal(inkWidth(blocks[0]), (17 * 6 + 1) * 3);
    });
  });
});
