import EscPosRenderer from '../src/renderers/esc-pos.js';
import Painter from '../src/painter.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {commands} from './helpers/items.js';
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
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), {width: WIDTH});

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
      const paper = stitch(render(stream(ESC, '@', ESC, 'a', 2, 'Hi', LF)), {width: WIDTH});

      /* Two characters of font A, so the last cell is 564 to 575 */

      assert.isAtLeast(ink(paper, 0, 30).min, 552);
      assert.isAtLeast(ink(paper, 0, 30).max, 564);
    });

    it('should centre a short line', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'a', 1, 'Hi', LF)), {width: WIDTH});

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
      const wide = stitch(render(stream(ESC, '@', GS, '!', 0x10, 'H', LF)), {width: WIDTH});
      const normal = stitch(render(stream(ESC, '@', 'H', LF)), {width: WIDTH});

      assert.equal(wide.height, normal.height);
      assert.equal(Bitmap.getPixel(wide, 6, 10), 1);
      assert.equal(Bitmap.getPixel(wide, 7, 10), 1);
      assert.equal(Bitmap.getPixel(normal, 6, 10), 0);
    });

    it('should draw an underline two dots thick with ESC - 2', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '-', 2, 'Hi', LF)), {width: WIDTH});

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
      const wide = stitch(render(stream(ESC, '@', 'H'.repeat(48), LF)), {width: WIDTH});
      const narrow = stitch(render(stream(ESC, '@', ESC, 'M', 1, 'H'.repeat(48), LF)), {width: WIDTH});

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
      const paper = stitch(render(stream(ESC, '@', [0x82], LF)), {width: WIDTH});

      assert.equal(dots(paper), dots(stitch(render(stream(ESC, '@', ESC, 't', 0, [0x82], LF)), {width: WIDTH})));
    });

    it('should switch codepage with ESC t', function() {
      /* 0x82 is an e with an acute accent in cp437, and so is 0xe9 in
         windows1252, which is number 16 in the Epson mapping */

      const left = stitch(render(stream(ESC, '@', [0x82], LF)), {width: WIDTH});
      const right = stitch(render(stream(ESC, '@', ESC, 't', 16, [0xe9], LF)), {width: WIDTH});

      assert.equal(dots(left), dots(right));
    });

    it('should decode with a codepage of another mapping', function() {
      /* Number 6 is windows1251 in the mpt mapping and nothing in the Epson
         mapping, so the same byte gives a different character */

      const cyrillic = new EscPosRenderer({width: WIDTH, codepageMapping: 'mpt'})
          .render(stream(ESC, '@', ESC, 't', 6, [0xcf], LF));

      const fallback = render(stream(ESC, '@', ESC, 't', 6, [0xcf], LF));

      assert.notEqual(dots(stitch(cyrillic, {width: WIDTH})), dots(stitch(fallback, {width: WIDTH})));
    });

    it('should fall back to cp437 for a codepage the encoder does not implement', function() {
      /* Number 36 of the Bixolon mapping is cp885, which the codepage encoder
         does not have */

      const renderer = new EscPosRenderer({width: WIDTH, codepageMapping: 'bixolon'});
      const items = renderer.render(stream(ESC, '@', ESC, 't', 36, [0x82], LF));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', [0x82], LF)), {width: WIDTH})),
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

      assert.equal(dots(stitch(unknown, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should skip a command whose length is in its arguments', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const unknown = render(stream(ESC, '@', 'A', GS, '(', 'E', [4, 0, 1, 2, 3, 4], 'B', LF));

      assert.equal(dots(stitch(unknown, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
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

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
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

      assert.equal(dots(stitch(skipped, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should consume the arguments of the user memory commands', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const write = render(stream(
          ESC, '@', 'A', FS, 'g', [1, 0, 0, 0, 0, 0, 3, 0], 'xyz', 'B', LF,
      ));

      const read = render(stream(ESC, '@', 'A', FS, 'g', [2, 0, 0, 0, 0, 0, 3, 0], 'B', LF));

      assert.equal(dots(stitch(write, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
      assert.equal(dots(stitch(read, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should consume the arguments of the user defined Kanji commands', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const define = render(stream(
          ESC, '@', 'A', FS, '2', [0x77, 0x21], new Array(32).fill(0xff), 'B', LF,
      ));

      const cancel = render(stream(ESC, '@', 'A', FS, '?', [0x77, 0x21], 'B', LF));

      assert.equal(dots(stitch(define, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
      assert.equal(dots(stitch(cancel, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
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

  describe('blocks', function() {
    /* GS h 60 sets the height of the bars, GS w 3 the width of a module and
       GS H 2 puts the text below the bars, which is the order the encoder
       writes them in */

    const barcode = (...parts) => stream(ESC, '@', GS, 'h', 60, GS, 'w', 3, ...parts);

    it('should draw a barcode of function A, with the module width of GS w', function() {
      const paper = stitch(render(barcode(GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});

      /* EAN-13 is 95 modules of three dots, and the bars are 60 dots tall */

      assert.equal(paper.height, 60);
      assert.equal(ink(paper, 0, 60).max - ink(paper, 0, 60).min + 1, 95 * 3);
    });

    it('should draw a barcode of function B, which carries its length', function() {
      const a = stitch(render(barcode(GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});
      const b = stitch(render(barcode(GS, 'k', 67, 13, '4006381333931')), {width: WIDTH});

      assert.equal(dots(b), dots(a));
    });

    it('should compute a check digit that is missing and validate one that is there', function() {
      const complete = stitch(render(barcode(GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});
      const computed = stitch(render(barcode(GS, 'k', 2, '400638133393', [0])), {width: WIDTH});

      assert.equal(dots(computed), dots(complete));
    });

    it('should print nothing for data that is not valid for the symbology', function() {
      const items = render(stream(ESC, '@', 'A', GS, 'h', 60, GS, 'w', 3, GS, 'k', 2, '4006381333930', [0], 'B', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should take the module width from GS w', function() {
      const width = (n) => {
        const paper = stitch(render(stream(
            ESC, '@', GS, 'h', 60, GS, 'w', n, GS, 'k', 2, '4006381333931', [0],
        )), {width: WIDTH});

        const edges = ink(paper, 0, 60);

        return (edges.max - edges.min + 1) / 95;
      };

      assert.deepEqual([width(2), width(3), width(6)], [2, 3, 6]);
    });

    it('should put the human readable text where GS H says', function() {
      const height = (position) => {
        const items = render(barcode(GS, 'H', position, GS, 'k', 2, '4006381333931', [0]));

        return items[0].height;
      };

      /* One line of font A, 24 dots, plus the four dot gap, above the bars,
         below them, or both */

      assert.deepEqual([height(0), height(1), height(2), height(3)], [60, 88, 88, 116]);
    });

    it('should draw the human readable text in font A by default and in font B after GS f 1', function() {
      const fontA = render(barcode(GS, 'H', 2, GS, 'k', 2, '4006381333931', [0]))[0];
      const fontB = render(barcode(GS, 'H', 2, GS, 'f', 1, GS, 'k', 2, '4006381333931', [0]))[0];

      /* Font A is 24 dots tall and font B is 17 in the Epson profile, both
         with the four dot gap between the bars and the text */

      assert.equal(fontA.height, 88);
      assert.equal(fontB.height, 81);
    });

    it('should centre the human readable text under the bars', function() {
      const paper = stitch(render(barcode(GS, 'H', 2, GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});

      const bars = ink(paper, 0, 60);
      const text = ink(paper, 60, 84);

      assert.isAbove(text.min, bars.min);
      assert.isBelow(text.max, bars.max);

      /* The text is centred cell by cell, and the ink of a cell is not centred
         in it: the side bearings of the first and the last character differ, so
         the ink of the text sits a dot or two off the middle of the bars */

      assert.closeTo((text.min + text.max) / 2, (bars.min + bars.max) / 2, 3);
    });

    it('should align a barcode the way the alignment says', function() {
      const left = stitch(render(barcode(GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});
      const centre = stitch(render(barcode(ESC, 'a', 1, GS, 'k', 2, '4006381333931', [0])), {width: WIDTH});

      assert.equal(ink(left, 0, 60).min, 0);
      assert.equal(ink(centre, 0, 60).min, (WIDTH - 95 * 3) >> 1);
    });

    it('should print nothing for a barcode that is wider than the print area', function() {
      /* Code 93 of six characters is 91 modules, 546 dots at six dots per
         module, which does not fit on a 384 dot printer */

      const narrow = {width: 384};

      const wide = render(stream(ESC, '@', 'A', GS, 'h', 60, GS, 'w', 6, GS, 'k', 72, 6, 'TEST93', 'B', LF), narrow);
      const known = render(stream(ESC, '@', 'AB', LF), narrow);

      assert.equal(dots(stitch(wide, {width: 384})), dots(stitch(known, {width: 384})));

      /* Three dots per module is 273 dots, which does fit */

      const fits = render(stream(ESC, '@', GS, 'h', 60, GS, 'w', 3, GS, 'k', 72, 6, 'TEST93'), narrow);

      assert.equal(fits[0].height, 60);
    });

    it('should print nothing for a byte the code sets of Code 128 cannot carry', function() {
      const items = render(stream(
          ESC, '@', 'A', GS, 'h', 60, GS, 'w', 3, GS, 'k', 79, 4, 'AB', [0xe9], 'C', 'B', LF,
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing for a GS1-128 with such a byte either', function() {
      const items = render(stream(
          ESC, '@', 'A', GS, 'h', 60, GS, 'w', 3, GS, 'k', 74, 3, '01', [0xe9], 'B', LF,
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should report the GS1 DataBar symbologies as unknown', function() {
      const items = render(barcode(GS, 'k', 75, 5, '12345'), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'image').length, 0);
      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [GS, 0x6b, 75, 5, 0x31, 0x32, 0x33, 0x34, 0x35],
      );
    });

    it('should draw a QR code of the size the commands ask for', function() {
      const paper = stitch(render(stream(
          ESC, '@',
          GS, '(', 'k', [4, 0], [49, 65, 50, 0],
          GS, '(', 'k', [3, 0], [49, 67, 4],
          GS, '(', 'k', [3, 0], [49, 69, 48],
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          GS, '(', 'k', [3, 0], [49, 81, 48],
      )), {width: WIDTH});

      /* Four bytes fit in version 1, 21 modules, at four dots per module */

      assert.equal(paper.height, 21 * 4);
      assert.equal(ink(paper, 0, paper.height).max - ink(paper, 0, paper.height).min + 1, 21 * 4);
    });

    it('should grow the symbol with the error correction level', function() {
      const size = (level) => {
        const items = render(stream(
            ESC, '@',
            GS, '(', 'k', [3, 0], [49, 67, 3],
            GS, '(', 'k', [3, 0], [49, 69, level],
            GS, '(', 'k', [33, 0], [49, 80, 48], 'https://example.com/order/9912',
            GS, '(', 'k', [3, 0], [49, 81, 48],
        ));

        return items[0].height / 3;
      };

      assert.isBelow(size(48), size(51));
    });

    it('should print a smaller symbol at error correction level L than at M', function() {
      const size = (level) => {
        const items = render(stream(
            ESC, '@',
            GS, '(', 'k', [3, 0], [49, 67, 3],
            GS, '(', 'k', [3, 0], [49, 69, level],
            GS, '(', 'k', [33, 0], [49, 80, 48], 'https://example.com/order/9912',
            GS, '(', 'k', [3, 0], [49, 81, 48],
        ));

        return items[0].height / 3;
      };

      /* Thirty bytes fit in version 2 at level L, in version 3 at M and Q, and
         in version 4 at H */

      assert.deepEqual([size(48), size(49), size(50), size(51)], [25, 29, 29, 33]);
    });

    it('should print nothing when no data was stored', function() {
      const print = stream(ESC, '@', GS, '(', 'k', [3, 0], [49, 81, 48], 'A', LF);

      assert.equal(render(print).length, 1);
      assert.equal(render(print)[0].height, 30);
    });

    it('should print nothing after ESC @ threw the stored data away', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          ESC, '@',
          GS, '(', 'k', [3, 0], [49, 81, 48],
          'A', LF,
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should not carry the stored data over to the next stream', function() {
      const renderer = new EscPosRenderer({width: WIDTH});

      renderer.render(stream(ESC, '@', GS, '(', 'k', [7, 0], [49, 80, 48], 'test'));

      const items = renderer.render(stream(ESC, '@', GS, '(', 'k', [3, 0], [49, 81, 48], 'A', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should print nothing for a QR code that is wider than the print area', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [49, 67, 16],
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          GS, '(', 'k', [3, 0], [49, 81, 48],
          'A', LF,
      ), {width: 256});

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should keep the data of a QR code until the next store', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [49, 67, 3],
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          GS, '(', 'k', [3, 0], [49, 81, 48],
          GS, '(', 'k', [3, 0], [49, 81, 48],
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 21 * 3 * 2);
    });

    it('should align a QR code the way the alignment says', function() {
      const code = (...parts) => stitch(render(stream(
          ESC, '@', ...parts,
          GS, '(', 'k', [3, 0], [49, 67, 4],
          GS, '(', 'k', [7, 0], [49, 80, 48], 'test',
          GS, '(', 'k', [3, 0], [49, 81, 48],
      )), {width: WIDTH});

      assert.equal(ink(code(), 0, 84).min, 0);
      assert.equal(ink(code(ESC, 'a', 2), 0, 84).max, WIDTH - 1);
    });

    it('should report the other symbologies of the group as unknown', function() {
      /* 50 is Maxicode, 51 the two dimensional GS1 DataBar and 52 the composite
         symbologies, none of which is rendered */

      const items = render(
          stream(ESC, '@', GS, '(', 'k', [3, 0], [50, 80, 48]),
          {commands: ['unknown']},
      );

      assert.deepEqual(items.map((item) => item.type), ['unknown']);
      assert.deepEqual(Array.from(items[0].data), [GS, 0x28, 0x6b, 3, 0, 50, 80, 48]);
    });

    it('should draw a PDF417 as a block', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [48, 65, 3], /* three data columns */
          GS, '(', 'k', [3, 0], [48, 66, 0], /* the rows follow from the data */
          GS, '(', 'k', [3, 0], [48, 67, 3], /* three dot modules */
          GS, '(', 'k', [3, 0], [48, 68, 3], /* rows of three modules */
          GS, '(', 'k', [4, 0], [48, 69, 48, 50], /* error correction level 2 */
          GS, '(', 'k', [14, 0], [48, 80, 48], 'HELLO WORLD',
          GS, '(', 'k', [3, 0], [48, 81, 48],
      ));

      /* Twelve codewords at level 2 fill five rows of three columns, and a row
         is the start pattern, both row indicators, the data and the stop
         pattern, 120 modules of three dots */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 5 * 3 * 3);

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, items[0].height).max - ink(paper, 0, items[0].height).min + 1, 120 * 3);
    });

    it('should draw the truncated form without the stop pattern', function() {
      const symbol = (truncated) => render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [48, 65, 3],
          GS, '(', 'k', [3, 0], [48, 67, 3],
          GS, '(', 'k', [3, 0], [48, 70, truncated],
          GS, '(', 'k', [14, 0], [48, 80, 48], 'HELLO WORLD',
          GS, '(', 'k', [3, 0], [48, 81, 48],
      ));

      const width = (items) => {
        const paper = stitch(items, {width: WIDTH});
        const bars = ink(paper, 0, items[0].height);

        return bars.max - bars.min + 1;
      };

      /* The truncated symbol loses the right row indicator and the stop
         pattern, and keeps the single bar that closes the row */

      assert.equal(width(symbol(0)), 120 * 3);
      assert.equal(width(symbol(1)), 86 * 3);
    });

    it('should print nothing when a PDF417 has no data', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [48, 67, 3],
          GS, '(', 'k', [3, 0], [48, 81, 48],
      ));

      assert.deepEqual(items, []);
    });

    it('should keep the data of a PDF417 until the next store', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [48, 65, 3],
          GS, '(', 'k', [3, 0], [48, 67, 3],
          GS, '(', 'k', [4, 0], [48, 69, 48, 50],
          GS, '(', 'k', [14, 0], [48, 80, 48], 'HELLO WORLD',
          GS, '(', 'k', [3, 0], [48, 81, 48],
          GS, '(', 'k', [3, 0], [48, 81, 48],
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 5 * 3 * 3 * 2);
    });

    it('should print nothing when a PDF417 is wider than the paper', function() {
      const items = render(stream(
          ESC, '@',
          GS, '(', 'k', [3, 0], [48, 65, 8],
          GS, '(', 'k', [3, 0], [48, 67, 8],
          GS, '(', 'k', [14, 0], [48, 80, 48], 'HELLO WORLD',
          GS, '(', 'k', [3, 0], [48, 81, 48],
      ), {width: 384});

      assert.deepEqual(items, []);
    });

    it('should draw a column image as a strip in the line', function() {
      const data = new Array(24 * 3).fill(0xff);
      const items = render(stream(ESC, '@', GS, 'P', 203, 203, ESC, '3', 24, ESC, '*', 33, [24, 0], data, LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 24);

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, 24).min, 0);
      assert.equal(ink(paper, 0, 24).max, 23);
    });

    it('should put the top dot of a column in the most significant bit', function() {
      const items = render(stream(
          ESC, '@', GS, 'P', 203, 203, ESC, '3', 24, ESC, '*', 33, [1, 0], [0x80, 0x00, 0x01], LF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 0, 0), 1);
      assert.equal(Bitmap.getPixel(paper, 0, 1), 0);
      assert.equal(Bitmap.getPixel(paper, 0, 23), 1);
    });

    it('should print the columns of the single density modes twice', function() {
      const columns = (mode) => stream(ESC, '@', ESC, '*', mode, [2, 0], new Array(6).fill(0xff), LF);

      const single = stitch(render(columns(32)), {width: WIDTH});
      const double = stitch(render(columns(33)), {width: WIDTH});

      assert.equal(ink(single, 0, 24).max, 3);
      assert.equal(ink(double, 0, 24).max, 1);
    });

    it('should draw the eight dot modes eight rows tall', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '*', 1, [2, 0], [0xff, 0xff], LF)), {width: WIDTH});

      assert.equal(ink(paper, 0, 8).max, 1);
      assert.equal(ink(paper, 8, 30).max, -1);
    });

    it('should draw a raster image as a block', function() {
      const data = new Array(2 * 16).fill(0xff);
      const items = render(stream(ESC, '@', GS, 'v', '0', [0, 2, 0, 16, 0], data));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 16);

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, 16).max, 15);
    });

    it('should double the raster image the way the mode says', function() {
      const image = (mode) => {
        const items = render(stream(ESC, '@', GS, 'v', '0', [mode, 2, 0, 16, 0], new Array(32).fill(0xff)));
        const paper = stitch(items, {width: WIDTH});

        return {width: ink(paper, 0, items[0].height).max + 1, height: items[0].height};
      };

      assert.deepEqual(image(0), {width: 16, height: 16});
      assert.deepEqual(image(1), {width: 32, height: 16});
      assert.deepEqual(image(2), {width: 16, height: 32});
      assert.deepEqual(image(3), {width: 32, height: 32});
    });

    it('should take the ASCII digits of the raster image mode as well', function() {
      const data = new Array(32).fill(0xff);

      assert.deepEqual(
          render(stream(ESC, '@', GS, 'v', '0', [51, 2, 0, 16, 0], data)),
          render(stream(ESC, '@', GS, 'v', '0', [3, 2, 0, 16, 0], data)),
      );
    });

    it('should report a GS v that is not GS v 0 as unknown', function() {
      const items = render(
          stream(ESC, '@', GS, 'v', [1, 0, 1, 0, 1, 0], [0xff]),
          {commands: ['unknown']},
      );

      assert.deepEqual(items.map((item) => item.type), ['unknown']);
      assert.equal(items[0].data[0], GS);
      assert.equal(items[0].data[1], 0x76);
    });

    it('should align a raster image the way the alignment says', function() {
      const items = render(stream(
          ESC, '@', ESC, 'a', 2, GS, 'v', '0', [0, 2, 0, 16, 0], new Array(32).fill(0xff),
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, 16).max, WIDTH - 1);
      assert.equal(ink(paper, 0, 16).min, WIDTH - 16);
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

      assert.equal(dots(stitch(dropped, {width: WIDTH})), dots(stitch(supported, {width: WIDTH})));
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

      /* The seven dots below a line of text are blank as well, the six of the
         line spacing and the bottom row of the cell, so they belong to the run
         that follows them. The cut of this receipt is not supported here, so it
         does not end a segment and the blank rows on both sides of it are one
         run */

      assert.deepEqual(
          items.map((item) => `${item.type}:${item.height}`),
          ['image:23', 'feed:97', 'image:23', 'feed:217'],
      );
    });

    it('should keep the rows white in the image when feed is not supported', function() {
      const items = render(fixture('esc-pos', 'feed').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));

      const paper = stitch(items, {width: WIDTH});

      for (let y = 30; y < 120; y++) {
        for (let x = 0; x < WIDTH; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), 0);
        }
      }
    });

    it('should print the same paper either way', function() {
      const bytes = fixture('esc-pos', 'feed').bytes;

      assert.equal(
          dots(stitch(render(bytes, {commands: ['feed']}), {width: WIDTH})),
          dots(stitch(render(bytes), {width: WIDTH})),
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
        assert.equal(dots(stitch(split, {width: WIDTH})), dots(stitch(whole, {width: WIDTH})));
      });
    }
  });
});
