import {createRequire} from 'node:module';

import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {qrcode} from '../src/symbologies/qrcode.js';
import {fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/*
    QR codes, read back with a QR code reader.

    jsQR is a dev dependency for this file alone. It takes the pixels of an
    image and returns what the symbol says, so the test reads the rendered
    receipt the way a phone reads the paper. The renderer draws the symbol
    without a quiet zone, as a printer does, so the test adds the white margin
    the reader needs around it.
*/

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');

const WIDTH = 576;
const MARGIN = 16;

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
 * Read a bitmap with the QR code reader, with a white margin around it
 *
 * @param  {object}        bitmap   The paper
 * @return {object|null}            What the reader made of it
 */
function read(bitmap) {
  const width = bitmap.width + MARGIN * 2;
  const height = bitmap.height + MARGIN * 2;

  const pixels = new Uint8ClampedArray(width * height * 4).fill(0xff);

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const offset = ((y + MARGIN) * width + x + MARGIN) * 4;
      const value = Bitmap.getPixel(bitmap, x, y) ? 0x00 : 0xff;

      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 0xff;
    }
  }

  return jsQR(pixels, width, height);
}

/**
 * The ESC/POS commands that print a QR code
 *
 * @param  {string}   value        The text to encode
 * @param  {number}   size         Size of a module in dots
 * @param  {number}   errorLevel   Error correction level, 48 to 51
 * @return {Uint8Array}            The stream
 */
function escpos(value, size, errorLevel) {
  const length = value.length + 3;

  return stream(
      0x1b, '@',
      0x1d, '(', 'k', [4, 0], [49, 65, 50, 0],
      0x1d, '(', 'k', [3, 0], [49, 67, size],
      0x1d, '(', 'k', [3, 0], [49, 69, errorLevel],
      0x1d, '(', 'k', [length & 0xff, (length >> 8) & 0xff], [49, 80, 48], value,
      0x1d, '(', 'k', [3, 0], [49, 81, 48],
  );
}

/**
 * The StarPRNT commands that print a QR code
 *
 * @param  {string}   value        The text to encode
 * @param  {number}   size         Size of a module in dots
 * @param  {number}   errorLevel   Error correction level, 0 to 3
 * @return {Uint8Array}            The stream
 */
function star(value, size, errorLevel) {
  return stream(
      0x1b, '@',
      0x1b, 0x1d, 'yS', [0x30, 0x02],
      0x1b, 0x1d, 'yS', [0x32, size],
      0x1b, 0x1d, 'yS', [0x31, errorLevel],
      0x1b, 0x1d, 'yD', [0x31, 0x00, value.length & 0xff, (value.length >> 8) & 0xff], value,
      0x1b, 0x1d, 'yP',
  );
}

describe('QR codes', function() {
  const values = ['RENDER', 'https://example.com/order/9912', '1234567890'];

  describe('the symbol', function() {
    it('should be the smallest version the data fits in', function() {
      assert.equal(qrcode(new TextEncoder().encode('test'), 'M').width, 21);
      assert.equal(qrcode(new TextEncoder().encode('x'.repeat(40)), 'M').width, 29);
    });

    it('should grow with the error correction level', function() {
      const data = new TextEncoder().encode('https://example.com/order/9912');

      assert.isAtMost(qrcode(data, 'L').width, qrcode(data, 'H').width);
    });

    it('should be square and have the three finder patterns', function() {
      const symbol = qrcode(new TextEncoder().encode('test'), 'M');

      assert.equal(symbol.width, symbol.height);

      for (const [x, y] of [[0, 0], [symbol.width - 7, 0], [0, symbol.height - 7]]) {
        assert.equal(Bitmap.getPixel(symbol, x, y), 1);
        assert.equal(Bitmap.getPixel(symbol, x + 1, y + 1), 0);
        assert.equal(Bitmap.getPixel(symbol, x + 3, y + 3), 1);
      }
    });

    it('should return null for data that does not fit in any symbol', function() {
      assert.isNull(qrcode(new Uint8Array(4000).fill(0x41), 'H'));
    });

    it('should encode the bytes it is given, whatever they mean', function() {
      const bytes = Uint8Array.from([0x43, 0x61, 0x66, 0xe9]);
      const result = read(Bitmap.scale(qrcode(bytes, 'M'), 4, 4));

      /* Reading the symbol gives the bytes back. The reader turns them into
         text as UTF-8, which these are not, so only the bytes are checked */

      assert.deepEqual(Array.from(result.chunks[0].bytes), Array.from(bytes));
    });
  });

  for (const [language, Renderer, build] of [
    ['esc-pos', EscPosRenderer, (value, size, level) => escpos(value, size, [48, 49, 50, 51][level])],
    ['star-prnt', StarPrntRenderer, (value, size, level) => star(value, size, level)],
  ]) {
    describe(language, function() {
      for (const value of values) {
        for (const size of [3, 5, 8]) {
          for (const level of [0, 2, 3]) {
            it(`should print ${JSON.stringify(value)} at size ${size} and level ${level}`, function() {
              const items = new Renderer({width: WIDTH, profile: 'epson'}).render(build(value, size, level));
              const result = read(stitch(items, {width: WIDTH}));

              assert.isNotNull(result, 'the reader did not find a symbol');
              assert.equal(result.data, value);
            });
          }
        }
      }

      it('should print a symbol of the size the commands ask for', function() {
        const items = new Renderer({width: WIDTH, profile: 'epson'}).render(build('RENDER', 6, 1));

        assert.equal(items[0].height % 6, 0);
        assert.equal(items[0].height / 6, 21);
      });
    });
  }

  describe('the fixtures', function() {
    /**
     * The bands of rows with ink on them, so that a receipt can be read block
     * by block
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

    for (const language of ['esc-pos', 'star-prnt']) {
      it(`should read both symbols of the ${language} qrcode fixture`, function() {
        const blocks = bands(fixture(language, 'qrcode').paper);

        assert.equal(blocks.length, 2);

        for (const block of blocks) {
          const result = read(block);

          assert.isNotNull(result, 'the reader did not find a symbol');
          assert.equal(result.data, 'https://example.com/order/9912');
        }
      });
    }

    for (const language of ['esc-pos', 'star-prnt']) {
      it(`should read the symbol of the ${language} receipt fixture`, function() {
        const found = bands(fixture(language, 'receipt').paper)
            .map((block) => read(block))
            .filter((result) => result !== null)
            .map((result) => result.data);

        assert.deepEqual(found, ['https://example.com/order/9912']);
      });
    }
  });
});
