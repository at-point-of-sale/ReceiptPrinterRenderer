import EscPosRenderer from '../src/renderers/esc-pos.js';
import Painter from '../src/painter.js';
import Bitmap from '../src/bitmap.js';
import {stitch, commands} from './helpers/stitch.js';
import {names, fixture} from './helpers/fixtures.js';
import {diff} from './helpers/ascii.js';
import {assert} from 'chai';

/* The printer the fixtures were made for, see test/tools/make-fixtures.js */

const WIDTH = 576;
const COMMANDS = ['cut', 'pulse', 'feed'];

/**
 * Build a byte stream from strings, numbers and arrays of numbers, so that a
 * test reads like the specification
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
 * Render a stream
 *
 * @param  {Uint8Array}   bytes       The commands
 * @param  {object}       [options]   Options on top of the width
 * @return {object[]}                 The items
 */
function render(bytes, options) {
  return new EscPosRenderer(Object.assign({width: WIDTH}, options || {})).render(bytes);
}

/**
 * The dots of a bitmap, as a string, so that two renders can be compared
 *
 * @param  {object}   bitmap   The bitmap
 * @return {string}            The dots
 */
function dots(bitmap) {
  return `${bitmap.width}x${bitmap.height}:${Array.from(bitmap.data).join(',')}`;
}

/**
 * The leftmost and the rightmost dot of a range of rows
 *
 * @param  {object}   bitmap   The bitmap
 * @param  {number}   top      First row
 * @param  {number}   bottom   Row after the last one
 * @return {object}            The positions, both -1 when the rows are white
 */
function ink(bitmap, top, bottom) {
  const result = {min: -1, max: -1};

  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (Bitmap.getPixel(bitmap, x, y)) {
        result.min = result.min < 0 ? x : Math.min(result.min, x);
        result.max = Math.max(result.max, x);
      }
    }
  }

  return result;
}

const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const LF = 0x0a;

describe('EscPosRenderer', function() {
  describe('options', function() {
    it('should be the esc-pos language', function() {
      assert.equal(EscPosRenderer.language, 'esc-pos');
    });

    it('should require a width', function() {
      assert.throws(() => new EscPosRenderer({}), /Width/);
    });

    it('should require a width that is a multiple of eight', function() {
      assert.throws(() => new EscPosRenderer({width: 100}), /multiple of 8/);
    });

    it('should report the columns of the print width', function() {
      assert.equal(new EscPosRenderer({width: 576}).columns, 48);
      assert.equal(new EscPosRenderer({width: 384}).columns, 32);
    });

    it('should not accept a codepage mapping it does not have', function() {
      assert.throws(() => new EscPosRenderer({width: 576, codepageMapping: 'nope'}), /codepage mapping/);
    });

    it('should not accept a profile it does not have', function() {
      assert.throws(() => new EscPosRenderer({width: 576, profile: 'nope'}), /profile/);
    });

    it('should accept an array of bytes as well as a Uint8Array', function() {
      const items = render([...stream(ESC, '@', 'Hi', LF)]);

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should leave nothing behind when a stream fails halfway', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: COMMANDS});
      const bytes = fixture('esc-pos', 'text').bytes;
      const original = Painter.prototype.text;

      Painter.prototype.text = function() {
        throw new Error('boom');
      };

      try {
        assert.throws(() => renderer.render(bytes), /boom/);
      } finally {
        Painter.prototype.text = original;
      }

      assert.deepEqual(
          renderer.render(bytes),
          new EscPosRenderer({width: WIDTH, commands: COMMANDS}).render(bytes),
      );
    });

    it('should render the same stream twice to the same items', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: COMMANDS});
      const bytes = fixture('esc-pos', 'text').bytes;

      assert.deepEqual(renderer.render(bytes), renderer.render(bytes));
    });
  });

  describe('fixtures', function() {
    for (const name of names('esc-pos')) {
      describe(name, function() {
        /* Loading and rendering happens inside the tests, so that a fixture
           that fails does not take the rest of the file down with it */

        it('should render the paper of the fixture', function() {
          const expected = fixture('esc-pos', name);
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), WIDTH);

          if (dots(paper) !== dots(expected.paper)) {
            assert.fail(`${name} does not match its fixture\n${diff(paper, expected.paper)}`);
          }
        });

        it('should emit the commands of the fixture', function() {
          const expected = fixture('esc-pos', name);

          assert.deepEqual(commands(render(expected.bytes, {commands: COMMANDS})), expected.commands);
        });

        it('should not emit an image without height', function() {
          const items = render(fixture('esc-pos', name).bytes, {commands: COMMANDS});

          assert.isTrue(items.every((item) => item.type !== 'image' || item.height > 0));
        });
      });
    }
  });

  describe('text', function() {
    it('should wrap a line that is longer than the print width', function() {
      const items = render(stream(ESC, '@', 'A'.repeat(50), LF));

      assert.equal(items[0].height, 60);
    });

    it('should ignore a carriage return', function() {
      assert.deepEqual(
          render(stream(ESC, '@', 'Hi', 0x0a, 0x0d)),
          render(stream(ESC, '@', 'Hi', 0x0a)),
      );
    });

    it('should ignore control characters that are not commands', function() {
      assert.deepEqual(
          render(stream(ESC, '@', 'Hi', 0x00, 0x07, 0x0a)),
          render(stream(ESC, '@', 'Hi', 0x0a)),
      );
    });
  });

  describe('styles', function() {
    it('should reset the styles with ESC @', function() {
      const styled = render(stream(
          ESC, 'E', 1, ESC, '-', 1, GS, 'B', 1, GS, '!', 0x11, ESC, 'M', 1, ESC, 'a', 2,
          ESC, '@', 'Hi', LF,
      ));

      assert.deepEqual(styled, render(stream(ESC, '@', 'Hi', LF)));
    });

    it('should align a short line to the right', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'a', 2, 'Hi', LF)), WIDTH);

      /* Two characters of font A, so the last cell is 564 to 575 */

      assert.isAtLeast(ink(paper, 0, 30).min, 552);
      assert.isAtLeast(ink(paper, 0, 30).max, 564);
    });

    it('should centre a short line', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'a', 1, 'Hi', LF)), WIDTH);

      /* The free width is 552 dots, so the two cells start at 276 */

      assert.isAtLeast(ink(paper, 0, 30).min, 276);
      assert.isBelow(ink(paper, 0, 30).max, 300);
    });

    it('should accept the ASCII digits of the alignment as well', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'a', 50, 'Hi', LF)),
          render(stream(ESC, '@', ESC, 'a', 2, 'Hi', LF)),
      );
    });

    it('should make a line of double height text 48 dots tall', function() {
      assert.equal(render(stream(ESC, '@', GS, '!', 0x01, 'Hi', LF))[0].height, 48);
    });

    it('should take the width multiplier from the high nibble', function() {
      const wide = stitch(render(stream(ESC, '@', GS, '!', 0x10, 'H', LF)), WIDTH);
      const normal = stitch(render(stream(ESC, '@', 'H', LF)), WIDTH);

      assert.equal(wide.height, normal.height);
      assert.equal(Bitmap.getPixel(wide, 2, 10), 1);
      assert.equal(Bitmap.getPixel(wide, 3, 10), 1);
      assert.equal(Bitmap.getPixel(normal, 3, 10), 0);
    });

    it('should draw an underline two dots thick with ESC - 2', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '-', 2, 'Hi', LF)), WIDTH);

      assert.equal(Bitmap.getPixel(paper, 0, 22), 1);
      assert.equal(Bitmap.getPixel(paper, 0, 23), 1);
      assert.equal(Bitmap.getPixel(paper, 0, 21), 0);
    });

    it('should ignore an underline value the command does not define', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, '-', 3, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );

      assert.deepEqual(
          render(stream(ESC, '@', ESC, '-', 1, ESC, '-', 51, 'Hi', LF)),
          render(stream(ESC, '@', ESC, '-', 1, 'Hi', LF)),
      );
    });

    it('should ignore italic, the way the hardware does', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, '4', 1, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });

    it('should switch to font B', function() {
      const wide = stitch(render(stream(ESC, '@', 'H'.repeat(48), LF)), WIDTH);
      const narrow = stitch(render(stream(ESC, '@', ESC, 'M', 1, 'H'.repeat(48), LF)), WIDTH);

      /* Font B sits in a nine dot cell, so 48 characters end at 432 instead of
         at the edge of the paper, and the cell is 17 dots tall instead of 24 */

      assert.isAtLeast(ink(wide, 0, 30).max, 564);
      assert.isBelow(ink(narrow, 0, 30).max, 432);
      assert.isAtLeast(ink(narrow, 0, 30).max, 420);
    });
  });

  describe('line spacing', function() {
    it('should take ESC 3 in vertical motion units, half a dot by default', function() {
      assert.equal(render(stream(ESC, '@', ESC, '3', 80, LF))[0].height, 40);
    });

    it('should take one unit as one dot after the encoder sets the motion unit', function() {
      assert.equal(render(stream(ESC, '@', GS, 'P', 203, 203, ESC, '3', 24, LF))[0].height, 24);
    });

    it('should restore the default motion unit with GS P 0 0', function() {
      assert.equal(
          render(stream(ESC, '@', GS, 'P', 203, 203, GS, 'P', 0, 0, ESC, '3', 80, LF))[0].height,
          40,
      );
    });

    it('should restore the default line spacing with ESC 2', function() {
      assert.equal(render(stream(ESC, '@', ESC, '3', 100, ESC, '2', LF))[0].height, 30);
    });

    it('should feed lines with ESC d', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'd', 3))[0].height, 90);
    });

    it('should feed dots with ESC J', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'J', 40))[0].height, 20);
    });
  });

  describe('codepages', function() {
    it('should start in cp437', function() {
      const paper = stitch(render(stream(ESC, '@', [0x82], LF)), WIDTH);

      assert.equal(dots(paper), dots(stitch(render(stream(ESC, '@', ESC, 't', 0, [0x82], LF)), WIDTH)));
    });

    it('should switch codepage with ESC t', function() {
      /* 0x82 is an e with an acute accent in cp437, and so is 0xe9 in
         windows1252, which is number 16 in the Epson mapping */

      const left = stitch(render(stream(ESC, '@', [0x82], LF)), WIDTH);
      const right = stitch(render(stream(ESC, '@', ESC, 't', 16, [0xe9], LF)), WIDTH);

      assert.equal(dots(left), dots(right));
    });

    it('should decode with a codepage of another mapping', function() {
      /* Number 6 is windows1251 in the mpt mapping and nothing in the Epson
         mapping, so the same byte gives a different character */

      const cyrillic = new EscPosRenderer({width: WIDTH, codepageMapping: 'mpt'})
          .render(stream(ESC, '@', ESC, 't', 6, [0xcf], LF));

      const fallback = render(stream(ESC, '@', ESC, 't', 6, [0xcf], LF));

      assert.notEqual(dots(stitch(cyrillic, WIDTH)), dots(stitch(fallback, WIDTH)));
    });

    it('should fall back to cp437 for a codepage the encoder does not implement', function() {
      /* Number 36 of the Bixolon mapping is cp885, which the codepage encoder
         does not have */

      const renderer = new EscPosRenderer({width: WIDTH, codepageMapping: 'bixolon'});
      const items = renderer.render(stream(ESC, '@', ESC, 't', 36, [0x82], LF));

      assert.equal(
          dots(stitch(items, WIDTH)),
          dots(stitch(render(stream(ESC, '@', [0x82], LF)), WIDTH)),
      );
    });

    it('should fall back to cp437 for a codepage the mapping does not have', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, 't', 250, [0x82], LF)),
          render(stream(ESC, '@', [0x82], LF)),
      );
    });

    it('should return to cp437 on ESC @', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, 't', 16, ESC, '@', [0x82], LF)),
          render(stream(ESC, '@', [0x82], LF)),
      );
    });
  });

  describe('unknown commands', function() {
    it('should render the text after a command it does not know', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const unknown = render(stream(ESC, '@', 'A', ESC, 'W', [1, 2, 3, 4, 5, 6, 7, 8], 'B', LF));

      assert.equal(dots(stitch(unknown, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should skip a command whose length is in its arguments', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const unknown = render(stream(ESC, '@', 'A', GS, '(', 'E', [4, 0, 1, 2, 3, 4], 'B', LF));

      assert.equal(dots(stitch(unknown, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should report the bytes of the command when unknown is supported', function() {
      const items = render(
          stream(ESC, '@', 'A', ESC, 'W', [1, 2, 3, 4, 5, 6, 7, 8], 'B', LF),
          {commands: ['unknown']},
      );

      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), [ESC, 0x57, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('should drop the command when unknown is not supported', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'W', [1, 2, 3, 4, 5, 6, 7, 8], 'B', LF));

      assert.isTrue(items.every((item) => item.type === 'image'));
    });

    it('should consume only the prefix of a command it has no length for', function() {
      const items = render(stream(ESC, '@', ESC, 0x01, 'Hi', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, 0x01],
      );

      assert.equal(dots(stitch(items, WIDTH)), dots(stitch(render(stream(ESC, '@', 'Hi', LF)), WIDTH)));
    });

    it('should consume the argument of ESC K', function() {
      const items = render(stream(ESC, '@', ESC, 'K', 65, LF));

      assert.equal(items.length, 1);
      assert.isTrue(items[0].data.every((byte) => byte === 0));
    });

    it('should consume the argument of ESC e', function() {
      const items = render(stream(ESC, '@', ESC, 'e', 65, LF));

      assert.isTrue(items[0].data.every((byte) => byte === 0));
    });

    it('should consume the arguments of the maintenance counter', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', GS, 'g', [2, 0, 65, 0], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should consume the arguments of the user memory commands', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const write = render(stream(
          ESC, '@', 'A', FS, 'g', [1, 0, 0, 0, 0, 0, 3, 0], 'xyz', 'B', LF,
      ));

      const read = render(stream(ESC, '@', 'A', FS, 'g', [2, 0, 0, 0, 0, 0, 3, 0], 'B', LF));

      assert.equal(dots(stitch(write, WIDTH)), dots(stitch(known, WIDTH)));
      assert.equal(dots(stitch(read, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should consume the arguments of the user defined Kanji commands', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const define = render(stream(
          ESC, '@', 'A', FS, '2', [0x77, 0x21], new Array(32).fill(0xff), 'B', LF,
      ));

      const cancel = render(stream(ESC, '@', 'A', FS, '?', [0x77, 0x21], 'B', LF));

      assert.equal(dots(stitch(define, WIDTH)), dots(stitch(known, WIDTH)));
      assert.equal(dots(stitch(cancel, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should report both graphics groups as unknown', function() {
      const parenthesis = render(
          stream(ESC, '@', GS, '(', 'L', [3, 0], [48, 69, 48], LF),
          {commands: ['unknown']},
      );

      const large = render(
          stream(ESC, '@', GS, '8', 'L', [4, 0, 0, 0], [48, 69, 48, 0], LF),
          {commands: ['unknown']},
      );

      assert.deepEqual(
          Array.from(parenthesis.find((item) => item.type === 'unknown').data),
          [GS, 0x28, 0x4c, 3, 0, 48, 69, 48],
      );

      assert.deepEqual(
          Array.from(large.find((item) => item.type === 'unknown').data),
          [GS, 0x38, 0x4c, 4, 0, 0, 0, 48, 69, 48, 0],
      );
    });

    it('should stop without an error when a command runs past the end', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, GS, '('));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should stop without an error on a truncated barcode', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, GS, 'k', 73, 5, [1, 2]));

      assert.equal(items.length, 1);
    });
  });

  describe('blocks that are skipped in this section', function() {
    it('should stay in sync over a column image', function() {
      const data = new Array(3 * 24).fill(0xff);
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, '*', 33, [24, 0], data, 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a raster image', function() {
      const data = new Array(8 * 16).fill(0xff);
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', GS, 'v', '0', [0, 8, 0, 16, 0], data, 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a barcode of function A', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', GS, 'k', 4, '12345', [0], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a barcode of function B', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', GS, 'k', 73, 5, '{B123', 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a QR code', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(
          ESC, '@', 'A',
          GS, '(', 'k', [4, 0], [49, 65, 50, 0],
          GS, '(', 'k', [3, 0], [49, 67, 4],
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          GS, '(', 'k', [3, 0], [49, 81, 48],
          'B', LF,
      ));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });
  });

  describe('cut and pulse', function() {
    it('should emit the cuts where the encoder put them', function() {
      const items = render(fixture('esc-pos', 'cut').bytes, {commands: ['cut']});

      /* The encoder ends the line after a cut, so the blank line that follows
         the last cut is an image of its own */

      assert.deepEqual(
          items.map((item) => item.type),
          ['image', 'cut', 'image', 'cut', 'image'],
      );

      assert.deepEqual(
          items.filter((item) => item.type === 'cut'),
          [{type: 'cut', value: 'partial'}, {type: 'cut', value: 'full'}],
      );
    });

    it('should drop the cuts when cut is not supported', function() {
      const items = render(fixture('esc-pos', 'cut').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));
    });

    it('should not split the image on a cut that is dropped', function() {
      const items = render(fixture('esc-pos', 'cut').bytes);

      assert.equal(items.length, 1);
    });

    it('should leave the paper unchanged when the cuts are dropped', function() {
      const supported = render(fixture('esc-pos', 'cut').bytes, {commands: ['cut']});
      const dropped = render(fixture('esc-pos', 'cut').bytes);

      assert.equal(dots(stitch(dropped, WIDTH)), dots(stitch(supported, WIDTH)));
    });

    it('should emit the pulse with the times in milliseconds', function() {
      const items = render(fixture('esc-pos', 'pulse').bytes, {commands: ['pulse']});

      assert.deepEqual(
          items.filter((item) => item.type === 'pulse'),
          [{type: 'pulse', device: 0, on: 100, off: 500}],
      );
    });

    it('should drop the pulse when pulse is not supported', function() {
      const items = render(fixture('esc-pos', 'pulse').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));
    });

    it('should read the cut type of the variants with a feed', function() {
      assert.deepEqual(
          render(stream(ESC, '@', GS, 'V', 66, 100), {commands: ['cut']})
              .filter((item) => item.type === 'cut'),
          [{type: 'cut', value: 'partial'}],
      );
    });
  });

  describe('feed', function() {
    it('should turn the runs of blank rows into feed items', function() {
      const items = render(fixture('esc-pos', 'feed').bytes, {commands: ['feed']});

      /* The six dots below a line of text are blank as well, so they belong to
         the run that follows them. The cut of this receipt is not supported
         here, so it does not end a segment and the blank rows on both sides of
         it are one run */

      assert.deepEqual(
          items.map((item) => `${item.type}:${item.height}`),
          ['image:24', 'feed:100', 'image:20', 'feed:216'],
      );
    });

    it('should keep the rows white in the image when feed is not supported', function() {
      const items = render(fixture('esc-pos', 'feed').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));

      const paper = stitch(items, WIDTH);

      for (let y = 30; y < 120; y++) {
        for (let x = 0; x < WIDTH; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), 0);
        }
      }
    });

    it('should print the same paper either way', function() {
      const bytes = fixture('esc-pos', 'feed').bytes;

      assert.equal(
          dots(stitch(render(bytes, {commands: ['feed']}), WIDTH)),
          dots(stitch(render(bytes), WIDTH)),
      );
    });
  });

  describe('maxHeight', function() {
    for (const name of ['text', 'table', 'feed']) {
      it(`should split the ${name} fixture into pieces that hold the same paper`, function() {
        const bytes = fixture('esc-pos', name).bytes;

        const whole = render(bytes, {commands: COMMANDS});
        const split = render(bytes, {commands: COMMANDS, maxHeight: 41});

        assert.isTrue(split.every((item) => item.type !== 'image' || item.height <= 41));
        assert.isAtLeast(split.length, whole.length);
        assert.equal(dots(stitch(split, WIDTH)), dots(stitch(whole, WIDTH)));
      });
    }
  });
});
