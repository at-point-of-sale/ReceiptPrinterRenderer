import EscPosRenderer from '../src/renderers/esc-pos.js';
import Painter from '../src/painter.js';
import Bitmap from '../src/bitmap.js';
import Font from '../src/font.js';
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

/**
 * The runs of columns that carry ink in a range of rows, so that a test can
 * check where the characters of a line landed
 *
 * @param  {object}   bitmap   The bitmap
 * @param  {number}   top      First row
 * @param  {number}   bottom   Row after the last one
 * @return {object[]}          The runs, {start, end}
 */
function columnsOf(bitmap, top, bottom) {
  const runs = [];

  let start = -1;

  for (let x = 0; x < bitmap.width; x++) {
    let inked = false;

    for (let y = top; y < bottom && !inked; y++) {
      inked = Bitmap.getPixel(bitmap, x, y) === 1;
    }

    if (inked && start < 0) {
      start = x;
    }

    if (!inked && start >= 0) {
      runs.push({start, end: x - 1});
      start = -1;
    }
  }

  if (start >= 0) {
    runs.push({start, end: bitmap.width - 1});
  }

  return runs;
}

const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const LF = 0x0a;

describe('EscPosRenderer', function() {
  describe('FS q, define NV bit image', function() {
    it('should consume every image of the definition and keep the text after it', function() {
      const renderer = new EscPosRenderer({width: 576, commands: ['unknown']});

      /* Two images: 1 x 1 bytes (8 data bytes) and 2 x 1 bytes (16 data bytes) */
      const definition = [
        0x1c, 0x71, 2, 1, 0, 1, 0, ...new Array(8).fill(0x41), 2, 0, 1, 0, ...new Array(16).fill(0x41),
      ];
      const items = renderer.render([0x1b, 0x40, ...definition, 0x42, 0x0a]);
      const plain = new EscPosRenderer({width: 576}).render([0x1b, 0x40, 0x42, 0x0a]);

      /* A definition prints nothing of its own, so the paper is the B of the
         text behind it, and both images are there to be printed by number */

      assert.deepEqual(items.filter((i) => i.type !== 'image'), []);
      assert.deepEqual(items.filter((i) => i.type === 'image'), plain.filter((i) => i.type === 'image'));

      assert.deepEqual(
          renderer.render([0x1b, 0x40, 0x1c, 0x70, 2, 0]).map((item) => item.type),
          ['image'],
      );
    });

    it('should stop cleanly when the definition is cut off', function() {
      const renderer = new EscPosRenderer({width: 576});
      assert.doesNotThrow(() => renderer.render([0x1b, 0x40, 0x1c, 0x71, 1, 4, 0, 4, 0, 0x41]));
    });
  });

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

    it('should put the single size cells of a mixed line on the baseline', function() {
      const paper = stitch(render(stream(ESC, '@', GS, '!', 0x11, 'H', GS, '!', 0x00, 'i', LF)), {width: WIDTH});
      const small = stitch(render(stream(ESC, '@', 'i', LF)), {width: WIDTH});

      assert.equal(paper.height, 48);

      /* The double size cell is 24 dots wide, so the single size one behind it
         starts at 24. The tall cell has an ascent of 36 and a descent of 12,
         the small one an ascent of 18 and a descent of 6, so the small cell
         stands on the same baseline on rows 18 to 41, with the descender space
         of the tall cell in the six rows below it */

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, 24 + x, 18 + y), Bitmap.getPixel(small, x, y), `dot ${x},${y}`);
        }
      }

      for (const y of [...Array(18).keys()].concat([42, 43, 44, 45, 46, 47])) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, 24 + x, y), 0, `dot ${x},${y} outside the cell`);
        }
      }
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

  describe('the end of the stream', function() {
    /* A printer prints a line when its line feed arrives, not when the job
       ends, so text without one stays in the line buffer, see section 16c */

    it('should print nothing for text that never got its line feed', function() {
      assert.deepEqual(render(stream(ESC, '@', 'Buffered')), []);
    });

    it('should print the same text when the line feed is there', function() {
      const items = render(stream(ESC, '@', 'Buffered', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should keep the lines in front of the unfinished one', function() {
      const buffered = render(stream(ESC, '@', 'Printed', LF, 'Buffered'));
      const alone = render(stream(ESC, '@', 'Printed', LF));

      assert.equal(dots(stitch(buffered, {width: WIDTH})), dots(stitch(alone, {width: WIDTH})));
    });

    it('should leave a receipt that ends with a complete line as it was', function() {
      const items = render(stream(ESC, '@', 'One', LF, 'Two', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 2 * 30);
    });
  });

  describe('the reverse feed', function() {
    it('should print the pending line and move the paper back with ESC e', function() {
      /* The line of the A is printed and the paper then moves back one line,
         which is further than the paper the painter holds, so it lands on the
         top of it and the B is drawn over the same rows */

      const back = render(stream(ESC, '@', 'A', ESC, 'e', 1, ESC, '$', 12, 0, 'B', LF));
      const same = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(same, {width: WIDTH})));
    });

    it('should move back the lines of the current line spacing', function() {
      const items = render(stream(ESC, '@', ESC, '3', 48, 'A', LF, 'B', ESC, 'e', 1, 'C', LF));

      /* Two lines of 24 dots, the second of them printed over the first */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 48);
    });

    it('should move back in vertical motion units with ESC K', function() {
      const back = render(stream(ESC, '@', 'A', ESC, 'K', 48, ESC, '$', 12, 0, 'B', LF));
      const same = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(same, {width: WIDTH})));
    });

    it('should take one unit as one dot after the encoder sets the motion unit', function() {
      /* The A is printed at 30 dots and is 24 dots tall, so the paper is 54
         dots. ESC K 48 is 24 dots by default, which puts the B back at 30 and
         the paper at 60, and 48 dots once a unit is a dot, which puts it at 6
         and leaves the paper the 54 dots of the A */

      const units = render(stream(ESC, '@', ESC, 'J', 60, 'A', ESC, 'K', 48, 'B', LF));
      const dot = render(stream(ESC, '@', GS, 'P', 203, 203, ESC, 'J', 30, 'A', ESC, 'K', 48, 'B', LF));

      assert.equal(units[0].height, 60);
      assert.equal(dot[0].height, 54);
    });

    it('should ignore an ESC K of more than 48 units, the line included', function() {
      const out = render(stream(ESC, '@', 'A', ESC, 'K', 49, 'B', LF));
      const same = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(out, {width: WIDTH})), dots(stitch(same, {width: WIDTH})));
    });

    it('should not move back into the rows of an item that was already emitted', function() {
      const items = render(stream(
          ESC, '@', 'A', LF, GS, 'V', 0, 'B', ESC, 'e', 2, 'C', LF,
      ), {commands: COMMANDS});

      assert.deepEqual(items.map((item) => item.type), ['image', 'cut', 'image']);
      assert.equal(items[0].height, 30);
      assert.equal(items[2].height, 30);
    });

    it('should consume the argument of an ESC K that is out of range', function() {
      const items = render(stream(ESC, '@', ESC, 'K', 65, LF));

      assert.equal(items.length, 1);
      assert.isTrue(items[0].data.every((byte) => byte === 0));
    });

    it('should consume the argument of an ESC e that moves further than the paper', function() {
      const items = render(stream(ESC, '@', ESC, 'e', 65, LF));

      assert.isTrue(items[0].data.every((byte) => byte === 0));
    });

    it('should report neither ESC e nor ESC K', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'e', 1, ESC, 'K', 24, 'B', LF), {
        commands: ['unknown'],
      });

      assert.equal(items.filter((item) => item.type === 'unknown').length, 0);
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
      const unknown = render(stream(ESC, '@', 'A', GS, 'g', [0, 1, 2, 3], 'B', LF));

      assert.equal(dots(stitch(unknown, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should skip a command whose length is in its arguments', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const unknown = render(stream(ESC, '@', 'A', GS, '(', 'E', [4, 0, 1, 2, 3, 4], 'B', LF));

      assert.equal(dots(stitch(unknown, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should report the bytes of the command when unknown is supported', function() {
      const items = render(
          stream(ESC, '@', 'A', GS, 'g', [0, 1, 2, 3], 'B', LF),
          {commands: ['unknown']},
      );

      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), [GS, 0x67, 0, 1, 2, 3]);
    });

    it('should drop the command when unknown is not supported', function() {
      const items = render(stream(ESC, '@', 'A', GS, 'g', [0, 1, 2, 3], 'B', LF));

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

      /* The definition carries the 72 bytes of a 24 by 24 glyph, and neither
         the definition nor the cancel prints anything of its own */

      const define = render(stream(
          ESC, '@', 'A', FS, '2', [0x77, 0x21], new Array(72).fill(0xff), 'B', LF,
      ));

      const cancel = render(stream(ESC, '@', 'A', FS, '?', [0x77, 0x21], 'B', LF));

      assert.equal(dots(stitch(define, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
      assert.equal(dots(stitch(cancel, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should report both graphics groups with their own length', function() {
      /* Function 99 is not a function of the group, in the short and in the
         long form, so both are consumed with the length they carry */

      const parenthesis = render(
          stream(ESC, '@', GS, '(', 'L', [3, 0], [48, 99, 48], LF),
          {commands: ['unknown']},
      );

      const large = render(
          stream(ESC, '@', GS, '8', 'L', [4, 0, 0, 0], [48, 99, 48, 0], LF),
          {commands: ['unknown']},
      );

      assert.deepEqual(
          Array.from(parenthesis.find((item) => item.type === 'unknown').data),
          [GS, 0x28, 0x4c, 3, 0, 48, 99, 48],
      );

      assert.deepEqual(
          Array.from(large.find((item) => item.type === 'unknown').data),
          [GS, 0x38, 0x4c, 4, 0, 0, 0, 48, 99, 48, 0],
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

    /* The GS1 DataBar family, symbologies 75 to 78. The heights of the
       specification are in modules, so they follow the width of a module of
       GS w, and Truncated and Limited have a height of their own that GS h
       does not change */

    it('should draw a GS1 DataBar Omnidirectional of ninety six modules', function() {
      const paper = stitch(render(stream(
          ESC, '@', GS, 'h', 120, GS, 'w', 3, GS, 'k', 75, 13, '0952123454321',
      )), {width: WIDTH});

      /* The symbol is ninety six modules, of which the space in front of the
         left guard bar is not printed */

      assert.equal(paper.height, 120);
      assert.equal(ink(paper, 0, 120).max - ink(paper, 0, 120).min + 1, 95 * 3);
    });

    it('should give Omnidirectional the least height of the specification', function() {
      const tall = stitch(render(stream(
          ESC, '@', GS, 'h', 120, GS, 'w', 3, GS, 'k', 75, 13, '0952123454321',
      )), {width: WIDTH});

      const short = stitch(render(stream(
          ESC, '@', GS, 'h', 20, GS, 'w', 3, GS, 'k', 75, 13, '0952123454321',
      )), {width: WIDTH});

      assert.equal(tall.height, 120);
      assert.equal(short.height, 33 * 3);
    });

    it('should give Truncated and Limited the height of the specification', function() {
      const truncated = stitch(render(barcode(GS, 'k', 76, 13, '0952123454321')), {width: WIDTH});
      const limited = stitch(render(barcode(GS, 'k', 77, 13, '0952123454321')), {width: WIDTH});

      assert.equal(truncated.height, 13 * 3);
      assert.equal(limited.height, 10 * 3);
    });

    it('should draw Truncated with the bars of Omnidirectional', function() {
      const row = (bitmap) => {
        let result = '';

        for (let x = 0; x < bitmap.width; x++) {
          result += Bitmap.getPixel(bitmap, x, 0) ? '1' : '0';
        }

        return result;
      };

      const omni = stitch(render(barcode(GS, 'k', 75, 13, '0952123454321')), {width: WIDTH});
      const truncated = stitch(render(barcode(GS, 'k', 76, 13, '0952123454321')), {width: WIDTH});

      assert.equal(row(truncated), row(omni));
    });

    it('should draw a GS1 DataBar Expanded of the element string it is given', function() {
      const paper = stitch(render(stream(
          ESC, '@', GS, 'h', 60, GS, 'w', 2,
          GS, 'k', 78, 30, '(01)90614141000015(3103)000123',
      )), {width: WIDTH});

      /* Six symbol characters of seventeen modules and three finder patterns
         of fifteen, with the guards, is 149 modules on the paper. The bars are
         the least height of the specification, 34 modules */

      assert.equal(paper.height, 34 * 2);
      assert.equal(ink(paper, 0, 34 * 2).max - ink(paper, 0, 34 * 2).min + 1, 149 * 2);
    });

    it('should print nothing for a GS1 DataBar the data is not valid for', function() {
      for (const [symbology, data] of [
        [75, '123456789012'],
        [75, '09521234543210'],
        [76, '09521234A4321'],
        [77, '2952123454321'],
        [78, '01)90614141000015'],
      ]) {
        const items = render(stream(
            ESC, '@', 'A', GS, 'h', 60, GS, 'w', 3,
            GS, 'k', symbology, data.length, data, LF,
        ));

        assert.equal(items.length, 1, `${symbology} ${data}`);
        assert.equal(items[0].height, 30);
      }
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

  describe('hand assembled fixtures', function() {
    for (const name of names('esc-pos/raw')) {
      describe(name, function() {
        it('should render the paper of the fixture', function() {
          const expected = fixture('esc-pos/raw', name);
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), {width: WIDTH});

          if (dots(paper) !== dots(expected.paper)) {
            assert.fail(`${name} does not match its fixture\n${diff(paper, expected.paper)}`);
          }
        });

        it('should emit the commands of the fixture', function() {
          const expected = fixture('esc-pos/raw', name);

          assert.deepEqual(commands(render(expected.bytes, {commands: COMMANDS})), expected.commands);
        });
      });
    }
  });

  describe('ESC ! n, print mode', function() {
    it('should set the same state as the individual commands', function() {
      const mode = render(stream(ESC, '@', ESC, '!', 0x39, 'Print mode', LF));
      const single = render(stream(
          ESC, '@', ESC, 'M', 1, ESC, 'E', 1, GS, '!', 0x11, 'Print mode', LF,
      ));

      assert.equal(dots(stitch(mode, {width: WIDTH})), dots(stitch(single, {width: WIDTH})));
    });

    it('should underline with bit 7', function() {
      const mode = render(stream(ESC, '@', ESC, '!', 0x80, 'Underlined', LF));
      const single = render(stream(ESC, '@', ESC, '-', 1, 'Underlined', LF));

      assert.equal(dots(stitch(mode, {width: WIDTH})), dots(stitch(single, {width: WIDTH})));
    });

    it('should clear what it does not set', function() {
      const plain = render(stream(ESC, '@', 'Plain', LF));
      const cleared = render(stream(
          ESC, '@', ESC, 'E', 1, ESC, '-', 2, ESC, 'M', 1, ESC, '!', 0x00, 'Plain', LF,
      ));

      assert.equal(dots(stitch(cleared, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should be overridden by a later GS !', function() {
      const plain = render(stream(ESC, '@', 'Size', LF));
      const overridden = render(stream(ESC, '@', ESC, '!', 0x30, GS, '!', 0x00, 'Size', LF));

      assert.equal(dots(stitch(overridden, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC G n, double strike', function() {
    it('should render as bold', function() {
      const strike = render(stream(ESC, '@', ESC, 'G', 1, 'Heavy', LF));
      const bold = render(stream(ESC, '@', ESC, 'E', 1, 'Heavy', LF));

      assert.equal(dots(stitch(strike, {width: WIDTH})), dots(stitch(bold, {width: WIDTH})));
    });

    it('should switch off with bit 0 clear', function() {
      const off = render(stream(ESC, '@', ESC, 'G', 1, ESC, 'G', 0, 'Light', LF));
      const plain = render(stream(ESC, '@', 'Light', LF));

      assert.equal(dots(stitch(off, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should keep the emphasis of ESC E when ESC G is switched off', function() {
      const both = render(stream(ESC, '@', ESC, 'E', 1, ESC, 'G', 0, 'Heavy', LF));
      const bold = render(stream(ESC, '@', ESC, 'E', 1, 'Heavy', LF));

      assert.equal(dots(stitch(both, {width: WIDTH})), dots(stitch(bold, {width: WIDTH})));
    });

    it('should keep the double strike when the emphasis of ESC ! is switched off', function() {
      const both = render(stream(ESC, '@', ESC, 'G', 1, ESC, '!', 0x00, 'Heavy', LF));
      const bold = render(stream(ESC, '@', ESC, 'E', 1, 'Heavy', LF));

      assert.equal(dots(stitch(both, {width: WIDTH})), dots(stitch(bold, {width: WIDTH})));
    });

    it('should print plain text only when both are off', function() {
      const off = render(stream(ESC, '@', ESC, 'E', 1, ESC, 'G', 1, ESC, 'E', 0, ESC, 'G', 0, 'Light', LF));
      const plain = render(stream(ESC, '@', 'Light', LF));

      assert.equal(dots(stitch(off, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC R n, international character set', function() {
    /* cp437 has the characters the sets below replace with, so the same line
       can be printed with the set and with the codepage */

    it('should replace the twelve code points of the German set', function() {
      const german = render(stream(ESC, '@', ESC, 'R', 2, '[\\]{|}~', LF));
      const cp437 = render(stream(ESC, '@', [0x8e, 0x99, 0x9a, 0x84, 0x94, 0x81, 0xe1], LF));

      assert.equal(dots(stitch(german, {width: WIDTH})), dots(stitch(cp437, {width: WIDTH})));
    });

    it('should replace only the code points the set changes', function() {
      const uk = render(stream(ESC, '@', ESC, 'R', 3, 'A#B$C', LF));
      const cp437 = render(stream(ESC, '@', 'A', [0x9c], 'B$C', LF));

      assert.equal(dots(stitch(uk, {width: WIDTH})), dots(stitch(cp437, {width: WIDTH})));
    });

    it('should go back to the USA set with ESC R 0', function() {
      const back = render(stream(ESC, '@', ESC, 'R', 3, ESC, 'R', 0, '#', LF));
      const plain = render(stream(ESC, '@', '#', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should leave the set alone for a number it does not define', function() {
      const ignored = render(stream(ESC, '@', ESC, 'R', 3, ESC, 'R', 99, '#', LF));
      const uk = render(stream(ESC, '@', ESC, 'R', 3, '#', LF));

      assert.equal(dots(stitch(ignored, {width: WIDTH})), dots(stitch(uk, {width: WIDTH})));
    });

    it('should be reset by ESC @', function() {
      const reset = render(stream(ESC, '@', ESC, 'R', 3, ESC, '@', '#', LF));
      const plain = render(stream(ESC, '@', '#', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC { n, upside down printing', function() {
    it('should rotate every line it prints by 180 degrees', function() {
      const lines = ['Upside down one', 'Upside down two'];

      const upright = stitch(render(stream(
          ESC, '@', lines[0], LF, lines[1], LF,
      )), {width: WIDTH});

      const rotated = stitch(render(stream(
          ESC, '@', ESC, '{', 1, lines[0], LF, lines[1], LF,
      )), {width: WIDTH});

      assert.equal(rotated.height, upright.height);

      /* Line by line: the feed order does not change, only the dots of each
         line box are turned around */

      for (let line = 0; line < lines.length; line++) {
        const box = Bitmap.extractRows(upright, line * 30, 30);
        const expected = Bitmap.rotate180(box);

        assert.equal(
            dots(Bitmap.extractRows(rotated, line * 30, 30)),
            dots(expected),
            `line ${line} is not the upright line rotated`,
        );
      }
    });

    it('should rotate a block as well', function() {
      const image = [GS, 0x76, 0x30, 0, 2, 0, 4, 0, 0xf0, 0x00, 0x90, 0x00, 0x90, 0x00, 0xf0, 0x00];

      const upright = stitch(render(stream(ESC, '@', image)), {width: WIDTH});
      const rotated = stitch(render(stream(ESC, '@', ESC, '{', 1, image)), {width: WIDTH});

      assert.equal(dots(rotated), dots(Bitmap.rotate180(upright)));
    });

    it('should stop rotating with ESC { 0', function() {
      const back = render(stream(ESC, '@', ESC, '{', 1, ESC, '{', 0, 'Upright', LF));
      const plain = render(stream(ESC, '@', 'Upright', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC SP n, right side character spacing', function() {
    it('should leave the space behind every character', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, ' ', 4, 'AAA', LF)), {width: WIDTH});
      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 3);
      assert.equal(starts[1] - starts[0], 16);
      assert.equal(starts[2] - starts[1], 16);
    });

    it('should scale the space with the width multiplier', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, ' ', 4, GS, '!', 0x10, 'AAA', LF,
      )), {width: WIDTH});

      /* The cell and the space behind it both grow with the multiplier */

      const starts = columnsOf(paper, 0, 48).map((run) => run.start);

      assert.equal(starts.length, 3);
      assert.equal(starts[1] - starts[0], 32);
      assert.equal(starts[2] - starts[1], 32);
    });

    it('should go back to no spacing with ESC SP 0', function() {
      const back = render(stream(ESC, '@', ESC, ' ', 4, ESC, ' ', 0, 'AAA', LF));
      const plain = render(stream(ESC, '@', 'AAA', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('HT and ESC D, tab stops', function() {
    it('should move to the next default stop, every eight characters', function() {
      const paper = stitch(render(stream(ESC, '@', 'A', 0x09, 'A', 0x09, 'A', LF)), {width: WIDTH});
      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 3);
      assert.equal(starts[1] - starts[0], 96);
      assert.equal(starts[2] - starts[1], 96);
    });

    it('should move to the stops of ESC D', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, 'D', 10, 20, 0x00, 'A', 0x09, 'A', 0x09, 'A', LF,
      )), {width: WIDTH});

      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 3);
      assert.equal(starts[1] - starts[0], 120);
      assert.equal(starts[2] - starts[1], 120);
    });

    it('should do nothing when there is no stop behind the cursor', function() {
      const tabbed = render(stream(ESC, '@', ESC, 'D', 4, 0x00, 'ABCDE', 0x09, 'F', LF));
      const plain = render(stream(ESC, '@', 'ABCDEF', LF));

      assert.equal(dots(stitch(tabbed, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should wrap to a new line when the stop is outside the print area', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'D', 48, 0x00, 'A', 0x09, 'B', LF)), {width: WIDTH});

      /* The cursor lands one dot beyond the print area, so the character
         behind the tab starts a line of its own */

      assert.equal(paper.height, 60);
      assert.equal(ink(paper, 0, 30).min, ink(paper, 30, 60).min);
    });

    it('should stop reading the stops at one that does not ascend', function() {
      const mixed = render(stream(ESC, '@', ESC, 'D', 10, 5, 20, 0x00, 'A', 0x09, 'B', 0x09, 'C', LF));
      const single = render(stream(ESC, '@', ESC, 'D', 10, 0x00, 'A', 0x09, 'B', 0x09, 'C', LF));

      assert.equal(dots(stitch(mixed, {width: WIDTH})), dots(stitch(single, {width: WIDTH})));
    });

    it('should cancel every stop with ESC D NUL', function() {
      const cleared = render(stream(ESC, '@', ESC, 'D', 10, 0x00, ESC, 'D', 0x00, 'A', 0x09, 'B', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(cleared, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should go back to the default stops with ESC @', function() {
      const reset = render(stream(ESC, '@', ESC, 'D', 0x00, ESC, '@', 'A', 0x09, 'A', LF));
      const plain = render(stream(ESC, '@', 'A', 0x09, 'A', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
      assert.equal(columnsOf(stitch(plain, {width: WIDTH}), 0, 24).length, 2);
    });

    it('should count the character spacing in the width of a character', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, ' ', 4, ESC, 'D', 2, 0x00, 'A', 0x09, 'A', LF,
      )), {width: WIDTH});

      /* Two characters of twelve dots plus the four dots of ESC SP behind each
         of them, which is the unit the reference of ESC D counts in */

      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 2);
      assert.equal(starts[1] - starts[0], 32);
    });
  });

  describe('ESC $ and ESC \\, print position', function() {
    it('should put the text at the absolute position', function() {
      const paper = stitch(render(stream(ESC, '@', 'A', ESC, '$', 240, 0, 'A', LF)), {width: WIDTH});
      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 2);
      assert.equal(starts[1] - starts[0], 240);
    });

    it('should move the cursor by the relative distance', function() {
      const paper = stitch(render(stream(ESC, '@', 'A', ESC, '\\', 60, 0, 'A', LF)), {width: WIDTH});
      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 2);
      assert.equal(starts[1] - starts[0], 72);
    });

    it('should move back with a negative distance', function() {
      const paper = stitch(render(stream(
          ESC, '@', 'A', ESC, '\\', 60, 0, 'A', ESC, '\\', 0xd0, 0xff, 'A', LF,
      )), {width: WIDTH});

      /* Three cells at 0, 72 and 36 dots: the last one is 48 dots back from
         the cursor the second one left behind */

      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 3);
      assert.equal(starts[1] - starts[0], 36);
      assert.equal(starts[2] - starts[1], 36);
    });

    it('should ignore a position beyond the print width', function() {
      const beyond = render(stream(ESC, '@', 'A', ESC, '$', 0x40, 0x03, 'B', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(beyond, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should count the position in the horizontal motion unit of GS P', function() {
      const paper = stitch(render(stream(
          ESC, '@', GS, 'P', 180, 180, 'A', ESC, '$', 200, 0, 'A', LF,
      )), {width: WIDTH});

      /* 200 units of 1/180 inch on a 203 dpi printer is 226 dots */

      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 2);
      assert.equal(starts[1] - starts[0], 226);
    });

    it('should go back to one dot per unit with GS P 0 0', function() {
      const back = render(stream(
          ESC, '@', GS, 'P', 180, 180, GS, 'P', 0, 0, 'A', ESC, '$', 240, 0, 'B', LF,
      ));
      const plain = render(stream(ESC, '@', 'A', ESC, '$', 240, 0, 'B', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('GS L and GS W, the print area', function() {
    it('should start the line at the left margin', function() {
      const margin = stitch(render(stream(ESC, '@', GS, 'L', 24, 0, 'A', LF)), {width: WIDTH});
      const plain = stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH});

      assert.equal(ink(margin, 0, 24).min, ink(plain, 0, 24).min + 24);
    });

    it('should centre inside the print area', function() {
      const centred = stitch(render(stream(
          ESC, '@', GS, 'L', 24, 0, GS, 'W', 0xc8, 1, ESC, 'a', 1, 'AB', LF,
      )), {width: WIDTH});
      const plain = stitch(render(stream(ESC, '@', 'AB', LF)), {width: WIDTH});

      assert.equal(ink(centred, 0, 24).min, ink(plain, 0, 24).min + 24 + ((456 - 24) >> 1));
    });

    it('should right align inside the print area', function() {
      const right = stitch(render(stream(
          ESC, '@', GS, 'L', 24, 0, GS, 'W', 0xc8, 1, ESC, 'a', 2, 'A', LF,
      )), {width: WIDTH});
      const plain = stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH});

      assert.equal(ink(right, 0, 24).max, ink(plain, 0, 24).max + 24 + 456 - 12);
    });

    it('should wrap at the print area instead of the paper', function() {
      const items = render(stream(ESC, '@', GS, 'W', 0xc8, 1, 'A'.repeat(39), LF));

      assert.equal(items[0].height, 60);
    });

    it('should clamp a print area that does not fit on the paper', function() {
      const clamped = render(stream(ESC, '@', GS, 'W', 0x00, 0x04, ESC, 'a', 2, 'A', LF));
      const full = render(stream(ESC, '@', ESC, 'a', 2, 'A', LF));

      assert.equal(dots(stitch(clamped, {width: WIDTH})), dots(stitch(full, {width: WIDTH})));
    });

    it('should be ignored while a line is being composed', function() {
      const halfway = render(stream(ESC, '@', 'A', GS, 'L', 24, 0, 'A', LF, 'A', LF));
      const plain = render(stream(ESC, '@', 'AA', LF, 'A', LF));

      assert.equal(dots(stitch(halfway, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should be ignored when the cursor was moved on an empty line', function() {
      const moved = render(stream(ESC, '@', ESC, '$', 24, 0, GS, 'L', 24, 0, 'A', LF));
      const plain = render(stream(ESC, '@', ESC, '$', 24, 0, 'A', LF));

      assert.equal(dots(stitch(moved, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('the Kanji group', function() {
    it('should draw a Shift JIS character as two placeholder cells', function() {
      const paper = stitch(render(stream(
          ESC, '@', FS, '&', FS, 'C', 1, 'A', [0x93, 0xfa], 'A', LF,
      )), {width: WIDTH});

      /* The two bytes are one character of two cells, so the A behind them
         starts three cells from the left */

      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 4);
      assert.equal(starts[3] - starts[0], 36);
    });

    it('should draw the placeholder of the fallback glyph', function() {
      const kanji = stitch(render(stream(ESC, '@', FS, '&', FS, 'C', 1, [0x93, 0xfa], LF)), {width: WIDTH});
      const fallback = Font.get('12x24').renderGlyph(Font.get('12x24').lookup(0xfffd), {
        cellWidth: 12, cellHeight: 24,
      });

      for (let cell = 0; cell < 2; cell++) {
        for (let y = 0; y < 24; y++) {
          for (let x = 0; x < 12; x++) {
            assert.equal(
                Bitmap.getPixel(kanji, cell * 12 + x, y),
                Bitmap.getPixel(fallback, x, y),
                `dot ${x},${y} of cell ${cell}`,
            );
          }
        }
      }
    });

    it('should read a pair of printable bytes as one character in the JIS code system', function() {
      const paper = stitch(render(stream(
          ESC, '@', FS, '&', FS, 'C', 0, [0x30, 0x21, 0x30, 0x22], LF,
      )), {width: WIDTH});

      /* Two characters of two cells each, and nothing of the four bytes is
         printed as a character of its own */

      const runs = columnsOf(paper, 0, 24);

      assert.equal(runs.length, 4);
      assert.equal(runs[3].end - runs[0].start + 1, 48 - 2);
    });

    it('should print single byte characters again after FS .', function() {
      const off = render(stream(ESC, '@', FS, '&', FS, '.', 'AB', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(off, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should leave a byte below the lead byte range alone', function() {
      const kanji = render(stream(ESC, '@', FS, '&', FS, 'C', 1, 'AB', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(kanji, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should print a lead byte at the end of the stream as a character', function() {
      assert.doesNotThrow(() => render(stream(ESC, '@', FS, '&', FS, 'C', 1, [0x93])));
    });

    it('should be switched off by ESC @', function() {
      const reset = render(stream(ESC, '@', FS, '&', FS, 'C', 0, ESC, '@', 'AB', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC &, ESC % and ESC ?, user defined characters', function() {
    /*
        The glyphs are described as ASCII art and turned into the column format
        of the command, so that a test says what it downloads.
    */

    /**
     * A character of ESC &: the number of columns and the columns themselves,
     * every column a number of bytes of eight dots with the top dot in the
     * most significant bit
     *
     * @param  {string[]}   rows   The dots, one string per row
     * @return {number[]}          The bytes of the definition
     */
    function glyph(rows) {
      const data = [rows[0].length];

      for (let x = 0; x < rows[0].length; x++) {
        for (let byte = 0; byte < rows.length / 8; byte++) {
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
     * A glyph of the size of a font A cell, a rectangle of black dots of the
     * given size in the top left corner of it
     *
     * @param  {number}     width    Width of the rectangle in dots
     * @param  {number}     height   Height of the rectangle in dots
     * @param  {number}     cell     Width of the definition in columns
     * @return {number[]}            The bytes of the definition
     */
    function block(width, height, cell = 12) {
      const rows = [];

      for (let y = 0; y < 24; y++) {
        rows.push(new Array(cell).fill('.').map((dot, x) => x < width && y < height ? '#' : '.').join(''));
      }

      return glyph(rows);
    }

    const FULL = block(12, 24);
    const NARROW = block(4, 8);

    /* ESC & 3 A A, one definition of twelve columns of three bytes */

    const define = (character, definition) => [ESC, 0x26, 3, character, character, ...definition];

    it('should print the downloaded glyph while ESC % selected the set', function() {
      const paper = stitch(render(stream(
          ESC, '@', define(0x41, FULL), ESC, '%', 1, 'A', LF,
      )), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), 1, `dot ${x},${y}`);
        }
      }
    });

    it('should print the built in glyph while the set is not selected', function() {
      const defined = render(stream(ESC, '@', define(0x41, FULL), 'A', LF));
      const plain = render(stream(ESC, '@', 'A', LF));

      assert.equal(dots(stitch(defined, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should print the built in glyph of a code without a definition', function() {
      const defined = render(stream(ESC, '@', define(0x41, FULL), ESC, '%', 1, 'B', LF));
      const plain = render(stream(ESC, '@', 'B', LF));

      assert.equal(dots(stitch(defined, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should print the built in glyph again after ESC % 0', function() {
      const off = render(stream(ESC, '@', define(0x41, FULL), ESC, '%', 1, ESC, '%', 0, 'A', LF));
      const plain = render(stream(ESC, '@', 'A', LF));

      assert.equal(dots(stitch(off, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should place the dots of a glyph in the top left corner of the cell', function() {
      const paper = stitch(render(stream(
          ESC, '@', define(0x41, NARROW), ESC, '%', 1, 'A', LF,
      )), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), x < 4 && y < 8 ? 1 : 0, `dot ${x},${y}`);
        }
      }
    });

    it('should keep a set per font', function() {
      /* The definition is made in font A, so font B prints its built in glyph
         and font A prints the downloaded one */

      const paper = stitch(render(stream(
          ESC, '@', define(0x41, FULL), ESC, '%', 1,
          ESC, 'M', 1, 'A', LF,
          ESC, 'M', 0, 'A', LF,
      )), {width: WIDTH});

      const built = stitch(render(stream(ESC, '@', ESC, 'M', 1, 'A', LF)), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), Bitmap.getPixel(built, x, y), `font B dot ${x},${y}`);
        }
      }

      assert.equal(Bitmap.getPixel(paper, 0, 30), 1);
    });

    it('should cancel one definition with ESC ? and keep the others', function() {
      const paper = stitch(render(stream(
          ESC, '@', define(0x41, FULL), define(0x42, FULL), ESC, '%', 1,
          ESC, '?', 0x42, 'AB', LF,
      )), {width: WIDTH});

      const built = stitch(render(stream(ESC, '@', 'B', LF)), {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 0, 0), 1);

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(paper, 12 + x, y), Bitmap.getPixel(built, x, y), `dot ${x},${y}`);
        }
      }
    });

    it('should throw every definition away on ESC @, and the selection with it', function() {
      const reset = render(stream(ESC, '@', define(0x41, FULL), ESC, '%', 1, ESC, '@', 'A', LF));
      const plain = render(stream(ESC, '@', 'A', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should define more than one character in one command', function() {
      const paper = stitch(render(stream(
          ESC, '@',
          [ESC, 0x26, 3, 0x41, 0x43, ...NARROW, ...NARROW, ...NARROW],
          ESC, '%', 1, 'ABC', LF,
      )), {width: WIDTH});

      for (let cell = 0; cell < 3; cell++) {
        assert.equal(Bitmap.getPixel(paper, cell * 12, 0), 1, `cell ${cell}`);
        assert.equal(Bitmap.getPixel(paper, cell * 12 + 4, 0), 0, `cell ${cell}`);
      }
    });

    it('should scale and style a downloaded glyph the way it styles a built in one', function() {
      const paper = stitch(render(stream(
          ESC, '@', define(0x41, NARROW), ESC, '%', 1, GS, '!', 0x11, 'A', LF,
      )), {width: WIDTH});

      /* Double width and double height, so the four by eight dots of the
         definition are eight by sixteen */

      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 24; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), x < 8 && y < 16 ? 1 : 0, `dot ${x},${y}`);
        }
      }
    });

    it('should draw a downloaded glyph white on black while GS B is on', function() {
      const paper = stitch(render(stream(
          ESC, '@', define(0x41, NARROW), ESC, '%', 1, GS, 'B', 1, 'A', LF,
      )), {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 0, 0), 0);
      assert.equal(Bitmap.getPixel(paper, 8, 0), 1);
      assert.equal(Bitmap.getPixel(paper, 8, 20), 1);
    });

    it('should ignore a definition whose width or code is out of range, data and all', function() {
      /* Thirteen columns is wider than a font A cell, and 0x10 is below the
         first character code the command defines. Both are consumed with the
         data they carry, which is the reading of this renderer */

      const wide = [ESC, 0x26, 3, 0x41, 0x41, ...block(12, 24, 13)];
      const code = [ESC, 0x26, 3, 0x10, 0x10, ...FULL];

      const plain = dots(stitch(render(stream(ESC, '@', ESC, '%', 1, 'A', LF)), {width: WIDTH}));

      for (const [name, bytes] of [['wide', wide], ['code', code]]) {
        assert.equal(
            dots(stitch(render(stream(ESC, '@', bytes, ESC, '%', 1, 'A', LF)), {width: WIDTH})),
            plain,
            name,
        );
      }
    });

    it('should leave the data of a height it does not define to the stream', function() {
      /* A y that is not three is a definition this parser has no layout for,
         so it consumes the three parameters and nothing else, the way a c2
         below c1 does, and the bytes behind it are text */

      const bytes = [ESC, 0x26, 4, 0x41, 0x41, ...'xyz'.split('').map((c) => c.charCodeAt(0))];

      assert.equal(
          dots(stitch(render(stream(ESC, '@', bytes, LF)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'xyz', LF)), {width: WIDTH})),
      );

      assert.equal(
          dots(stitch(render(stream(ESC, '@', bytes, LF, ESC, '%', 1, 'A', LF)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'xyz', LF, 'A', LF)), {width: WIDTH})),
      );
    });

    it('should ignore the whole command when one of its definitions is out of range', function() {
      const bytes = [ESC, 0x26, 3, 0x41, 0x42, ...FULL, ...block(12, 24, 13)];

      assert.equal(
          dots(stitch(render(stream(ESC, '@', bytes, ESC, '%', 1, 'AB', LF)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), {width: WIDTH})),
      );
    });

    it('should define a blank character with a width of zero columns', function() {
      const paper = stitch(render(stream(
          ESC, '@', [ESC, 0x26, 3, 0x41, 0x41, 0], ESC, '%', 1, 'A', 'B', LF,
      )), {width: WIDTH});

      assert.deepEqual(columnsOf(paper, 0, 24).map((run) => run.start >= 12), [true]);
    });
  });

  describe('FS 2 and FS ?, user defined Kanji', function() {
    /* A glyph of 24 by 24 dots in column format, three bytes per column: every
       column is black in this one, so the character is a filled block */

    const KANJI = new Array(72).fill(0xff);

    const kanji = (code, data) => [FS, 0x32, code >> 8, code & 0xff, ...data];

    it('should draw the downloaded glyph of a multibyte code in two cells', function() {
      const paper = stitch(render(stream(
          ESC, '@', FS, 'C', 1, kanji(0x93fa, KANJI), FS, '&', [0x93, 0xfa], LF,
      )), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          assert.equal(Bitmap.getPixel(paper, x, y), 1, `dot ${x},${y}`);
        }
      }

      assert.equal(Bitmap.getPixel(paper, 24, 0), 0);
    });

    it('should draw the placeholder cells of a code without a definition', function() {
      const defined = render(stream(
          ESC, '@', FS, 'C', 1, kanji(0x93fa, KANJI), FS, '&', [0x93, 0xfb], LF,
      ));

      const plain = render(stream(ESC, '@', FS, 'C', 1, FS, '&', [0x93, 0xfb], LF));

      assert.equal(dots(stitch(defined, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should leave the character spacing of two cells behind a multibyte glyph', function() {
      /* ESC SP 6 follows every cell, and a multibyte character is two cells
         whether it is a downloaded glyph or two placeholders, so the character
         behind it lands in the same place either way */

      const paper = (trail) => stitch(render(stream(
          ESC, '@', ESC, ' ', 6, FS, 'C', 1, kanji(0x93fa, KANJI),
          FS, '&', [0x93, trail], 'A', LF,
      )), {width: WIDTH});

      const behind = (bitmap) => columnsOf(bitmap, 0, 24).pop().start;

      /* Two cells of twelve dots and two spacings of six, so the A starts at
         36 and its ink a side bearing behind that */

      assert.equal(behind(paper(0xfa)), behind(paper(0xfb)));
      assert.isAtLeast(behind(paper(0xfa)), 36);
    });

    it('should draw nothing of its own outside Kanji mode', function() {
      const defined = render(stream(ESC, '@', kanji(0x4142, KANJI), 'AB', LF));
      const plain = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(defined, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should cancel a definition with FS ?', function() {
      const cancelled = render(stream(
          ESC, '@', FS, 'C', 1, kanji(0x93fa, KANJI),
          FS, 0x3f, [0x93, 0xfa], FS, '&', [0x93, 0xfa], LF,
      ));

      const plain = render(stream(ESC, '@', FS, 'C', 1, FS, '&', [0x93, 0xfa], LF));

      assert.equal(dots(stitch(cancelled, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should throw the definitions away on ESC @', function() {
      const reset = render(stream(
          ESC, '@', FS, 'C', 1, kanji(0x93fa, KANJI), ESC, '@',
          FS, 'C', 1, FS, '&', [0x93, 0xfa], LF,
      ));

      const plain = render(stream(ESC, '@', FS, 'C', 1, FS, '&', [0x93, 0xfa], LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC V n, rotation by 90 degrees', function() {
    /**
     * A rectangle of a bitmap, so that one cell can be compared with another
     *
     * @param  {object}   bitmap   The bitmap to cut from
     * @param  {number}   x        Left edge
     * @param  {number}   y        Top row
     * @param  {number}   width    Width in dots
     * @param  {number}   height   Height in dots
     * @return {object}            The rectangle
     */
    function crop(bitmap, x, y, width, height) {
      const result = Bitmap.create(width, height);

      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          Bitmap.setPixel(result, column, row, Bitmap.getPixel(bitmap, x + column, y + row));
        }
      }

      return result;
    }

    it('should turn every cell a quarter turn clockwise', function() {
      const rotated = stitch(render(stream(ESC, '@', ESC, 'V', 1, 'A', LF)), {width: WIDTH});
      const upright = stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH});

      assert.equal(
          dots(crop(rotated, 0, 0, 24, 12)),
          dots(Bitmap.rotate270(crop(upright, 0, 0, 12, 24))),
      );
    });

    it('should put the cells of a rotated line left to right', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'V', 1, 'AB', LF)), {width: WIDTH});

      const first = crop(paper, 0, 0, 24, 12);
      const second = crop(paper, 24, 0, 24, 12);
      const alone = stitch(render(stream(ESC, '@', ESC, 'V', 1, 'A', LF)), {width: WIDTH});

      assert.equal(dots(first), dots(crop(alone, 0, 0, 24, 12)));
      assert.notEqual(dots(second), dots(first));
    });

    it('should make the ink of a rotated line as tall as a character is wide', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '3', 24, ESC, 'V', 1, 'Hello', LF)), {width: WIDTH});

      let last = -1;

      for (let y = 0; y < paper.height; y++) {
        for (let x = 0; x < paper.width; x++) {
          if (Bitmap.getPixel(paper, x, y)) {
            last = y;
          }
        }
      }

      /* Twelve dots of cell, and the line spacing of ESC 3 24, which is twelve
         dots at the two vertical motion units per dot of an Epson, so the line
         is exactly the rotated cell */

      assert.isAtMost(last, 11);
      assert.equal(paper.height, 12);
    });

    it('should accept the values of the command and leave the rest alone', function() {
      const rotated = dots(stitch(render(stream(ESC, '@', ESC, 'V', 1, 'A', LF)), {width: WIDTH}));
      const upright = dots(stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH}));

      for (const value of [1, 49, 2, 50]) {
        assert.equal(dots(stitch(render(stream(ESC, '@', ESC, 'V', value, 'A', LF)), {width: WIDTH})), rotated);
      }

      for (const value of [0, 48]) {
        assert.equal(
            dots(stitch(render(stream(ESC, '@', ESC, 'V', 1, ESC, 'V', value, 'A', LF)), {width: WIDTH})),
            upright,
        );
      }

      assert.equal(
          dots(stitch(render(stream(ESC, '@', ESC, 'V', 1, ESC, 'V', 9, 'A', LF)), {width: WIDTH})),
          rotated,
      );
    });

    it('should draw no underline on a rotated cell', function() {
      /* The ESC/POS reference exempts the rotated characters from the
         underline the way it exempts the reverse ones */

      const underlined = render(stream(ESC, '@', ESC, 'V', 1, ESC, '-', 1, 'Rotated', LF));
      const plain = render(stream(ESC, '@', ESC, 'V', 1, 'Rotated', LF));

      assert.equal(dots(stitch(underlined, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));

      /* And the underline is back on the line behind ESC V 0, so the setting
         itself is not lost */

      const upright = render(stream(ESC, '@', ESC, 'V', 1, ESC, '-', 1, ESC, 'V', 0, 'Upright', LF));

      assert.notEqual(
          dots(stitch(upright, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Upright', LF)), {width: WIDTH})),
      );
    });

    it('should be switched off by ESC @', function() {
      const reset = render(stream(ESC, '@', ESC, 'V', 1, ESC, '@', 'A', LF));
      const plain = render(stream(ESC, '@', 'A', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should be a standard mode command, which page mode drops', function() {
      const page = (rotate) => stream(
          ESC, '@', ESC, 'L', ESC, 'W', [0, 0, 0, 0, 0x40, 0x02, 60, 0],
          ...(rotate ? [ESC, 'V', 1] : []), 'A', LF, 0x0c,
      );

      assert.equal(
          dots(stitch(render(page(true)), {width: WIDTH})),
          dots(stitch(render(page(false)), {width: WIDTH})),
      );
    });

    it('should lay a page out upright while the rotation is on', function() {
      /* The rotation is set in standard mode, where it is effective, and the
         page that follows is laid out as if it were off */

      const rotated = stream(
          ESC, '@', ESC, 'V', 1, ESC, 'L', ESC, 'W', [0, 0, 0, 0, 0x40, 0x02, 60, 0], 'A', LF, 0x0c,
      );

      const upright = stream(
          ESC, '@', ESC, 'L', ESC, 'W', [0, 0, 0, 0, 0x40, 0x02, 60, 0], 'A', LF, 0x0c,
      );

      assert.equal(
          dots(stitch(render(rotated), {width: WIDTH})),
          dots(stitch(render(upright), {width: WIDTH})),
      );
    });
  });

  describe('the colour commands', function() {
    it('should draw the second colour of ESC r in black, like the first', function() {
      const second = render(stream(ESC, '@', ESC, 'r', 1, 'Colour', LF));
      const first = render(stream(ESC, '@', 'Colour', LF));

      assert.equal(dots(stitch(second, {width: WIDTH})), dots(stitch(first, {width: WIDTH})));
    });

    it('should leave no unknown item for ESC r', function() {
      const items = render(stream(ESC, '@', ESC, 'r', 1, 'Colour', LF), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 0);
    });

    it('should parse the colour functions of GS ( N', function() {
      for (const fn of [48, 49, 50]) {
        const items = render(
            stream(ESC, '@', GS, '(', 'N', [2, 0, fn, 49], 'Colour', LF),
            {commands: ['unknown']},
        );

        assert.equal(items.filter((item) => item.type === 'unknown').length, 0, `function ${fn}`);

        assert.equal(
            dots(stitch(items, {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Colour', LF)), {width: WIDTH})),
        );
      }
    });

    it('should report a function GS ( N does not have', function() {
      const items = render(
          stream(ESC, '@', GS, '(', 'N', [2, 0, 99, 49], 'Colour', LF),
          {commands: ['unknown']},
      );

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [GS, 0x28, 0x4e, 2, 0, 99, 49],
      );
    });
  });

  describe('ESC i and ESC m, the legacy cuts', function() {
    it('should cut fully with ESC i', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, ESC, 'i'), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'cut', value: 'full'}]);
    });

    it('should cut partially with ESC m', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, ESC, 'm'), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'cut', value: 'partial'}]);
    });
  });

  describe('the real time commands', function() {
    /* The status requests are parsed, there is no channel back to the host for
       an answer to travel over; DLE DC4 is reported, it fires the drawer and
       clears the buffer */

    const parsed = [
      ['DLE EOT n', [0x10, 0x04, 1]],
      ['DLE EOT 7 n', [0x10, 0x04, 7, 1]],
      ['DLE EOT 8 n', [0x10, 0x04, 8, 3]],
      ['DLE ENQ n', [0x10, 0x05, 1]],
    ];

    for (const [name, bytes] of parsed) {
      it(`should consume ${name} with its own length and report nothing`, function() {
        const items = render(stream(ESC, '@', bytes, 'Hi', LF), {commands: ['unknown']});

        assert.equal(items.filter((item) => item.type === 'unknown').length, 0);

        assert.equal(
            dots(stitch(items.filter((item) => item.type === 'image'), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }

    const realTime = [
      ['DLE DC4 1 m t', [0x10, 0x14, 1, 0, 1]],
      ['DLE DC4 2 a b', [0x10, 0x14, 2, 1, 8]],
      ['DLE DC4 3 a', [0x10, 0x14, 3, 1]],
      ['DLE DC4 7 n', [0x10, 0x14, 7, 1]],
      ['DLE DC4 8 d1..d7', [0x10, 0x14, 8, 1, 3, 20, 1, 6, 2, 8]],
    ];

    for (const [name, bytes] of realTime) {
      it(`should consume ${name} with its own length`, function() {
        const items = render(stream(ESC, '@', bytes, 'Hi', LF), {commands: ['unknown']});
        const unknown = items.filter((item) => item.type === 'unknown');

        assert.equal(unknown.length, 1);
        assert.deepEqual(Array.from(unknown[0].data), bytes);

        assert.equal(
            dots(stitch(items.filter((item) => item.type === 'image'), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }
  });

  describe('the status and setting commands', function() {
    /* None of them can put a dot on the paper, so they are parsed with their
       own length and report nothing, see documentation/commands-esc-pos.md */

    const parsed = [
      ['ESC u n', [ESC, 0x75, 0]],
      ['ESC v', [ESC, 0x76]],
      ['GS I n', [GS, 0x49, 1]],
      ['GS a n', [GS, 0x61, 0]],
      ['GS b n', [GS, 0x62, 1]],
      ['GS j n', [GS, 0x6a, 1]],
      ['GS r n', [GS, 0x72, 1]],
      ['GS ( H pL pH fn m', [GS, 0x28, 0x48, 3, 0, 48, 49, 0]],
      ['FS ( A pL pH fn m', [FS, 0x28, 0x41, 2, 0, 48, 0]],
    ];

    for (const [name, bytes] of parsed) {
      it(`should consume ${name} and keep the text behind it`, function() {
        const items = render(stream(ESC, '@', bytes, 'Hi', LF), {commands: ['unknown']});

        assert.equal(items.filter((item) => item.type === 'unknown').length, 0);

        assert.equal(
            dots(stitch(items.filter((item) => item.type === 'image'), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }

    it('should still report the other selectors of the FS ( group', function() {
      const items = render(
          stream(ESC, '@', FS, '(', 'C', [2, 0], [48, 1], 'Hi', LF),
          {commands: ['unknown']},
      );

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [FS, 0x28, 0x43, 2, 0, 48, 1],
      );
    });
  });

  describe('page mode', function() {
    /*
        The commands of page mode. The area and the two vertical positions are
        counted in motion units, the horizontal ones one dot each and the
        vertical ones two per dot on the Epson profile, so the helpers take
        dots and write the units.
    */

    const FF = 0x0c;
    const CAN = 0x18;

    const word = (value) => [value & 0xff, (value >> 8) & 0xff];
    const area = (x, y, width, height) =>
      [ESC, 0x57, ...word(x), ...word(y * 2), ...word(width), ...word(height * 2)];
    const vertical = (dots) => [GS, 0x24, ...word(dots * 2)];
    const relative = (dots) => [GS, 0x5c, ...word((dots * 2 + 65536) & 0xffff)];

    /**
     * The paper of a page with two lines on it, in one print direction
     *
     * @param  {number}   direction   The argument of ESC T
     * @return {object}               The paper
     */
    function page(direction) {
      return stitch(render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 288), ESC, 'T', direction,
          'Hi', LF, '.', LF,
          FF,
      )), {width: WIDTH});
    }

    /**
     * A rectangle of a bitmap, the print area out of the paper
     *
     * @param  {object}   bitmap   The bitmap to cut from
     * @param  {number}   size     Width and height of the rectangle
     * @return {object}            The rectangle
     */
    function crop(bitmap, size) {
      const result = Bitmap.create(size, size);

      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          Bitmap.setPixel(result, column, row, Bitmap.getPixel(bitmap, column, row));
        }
      }

      return result;
    }

    it('should render a page of direction 0 as the same content in standard mode', function() {
      const paged = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 90), ESC, 'T', 0,
          'The corner store', LF,
          ESC, 'a', 1, 'Thank you', LF, ESC, 'a', 0,
          ESC, 'E', 1, 'Come again', LF, ESC, 'E', 0,
          FF,
      ));

      const standard = render(stream(
          ESC, '@',
          'The corner store', LF,
          ESC, 'a', 1, 'Thank you', LF, ESC, 'a', 0,
          ESC, 'E', 1, 'Come again', LF, ESC, 'E', 0,
      ));

      assert.equal(
          dots(stitch(paged, {width: WIDTH})),
          dots(stitch(standard, {width: WIDTH})),
      );
    });

    it('should turn the print directions the way the reference describes them', function() {
      assert.deepEqual(crop(page(1), 288), Bitmap.rotate90(crop(page(0), 288)));
      assert.deepEqual(crop(page(2), 288), Bitmap.rotate180(crop(page(0), 288)));
      assert.deepEqual(crop(page(3), 288), Bitmap.rotate270(crop(page(0), 288)));
    });

    it('should accept the print directions as ASCII digits', function() {
      assert.deepEqual(page(49), page(1));
      assert.deepEqual(page(51), page(3));
    });

    it('should leave the direction alone for a value it does not define', function() {
      assert.deepEqual(page(9), page(0));
    });

    it('should feed the paper over the whole print area', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 240),
          'One line', LF,
          FF,
      ));

      assert.equal(stitch(items, {width: WIDTH}).height, 240);
    });

    it('should return to standard mode on FF', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30),
          'In the page', LF,
          FF,
          'On the paper', LF,
      ));

      assert.equal(stitch(items, {width: WIDTH}).height, 60);
    });

    it('should keep the page and page mode on ESC FF', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30),
          'Printed twice', LF,
          ESC, FF,
          ESC, FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 60);
      assert.equal(dots(Bitmap.extractRows(paper, 0, 30)), dots(Bitmap.extractRows(paper, 30, 30)));
    });

    it('should delete the page on ESC S', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 240),
          'Never printed', LF,
          ESC, 'S',
          'On the paper', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'On the paper', LF)), {width: WIDTH})),
      );
    });

    it('should leave page mode on ESC @', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 240),
          'Never printed', LF,
          ESC, '@',
          'On the paper', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'On the paper', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing of a page the stream never printed', function() {
      const items = render(stream(
          ESC, '@',
          'On the paper', LF,
          ESC, 'L', area(0, 0, WIDTH, 240),
          'Never printed', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'On the paper', LF)), {width: WIDTH})),
      );
    });

    it('should delete the dots of the page and keep the area on CAN', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 60),
          'Discarded', LF,
          CAN,
          'Printed', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 60);
      assert.equal(
          dots(Bitmap.extractRows(paper, 0, 30)),
          dots(stitch(render(stream(ESC, '@', 'Printed', LF)), {width: WIDTH})),
      );
    });

    it('should do nothing with CAN and FF in standard mode', function() {
      assert.equal(
          dots(stitch(render(stream(ESC, '@', CAN, 'Hi', FF, LF)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should ignore a print area with a size of zero', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 60), area(0, 0, 0, 60), area(0, 0, WIDTH, 0),
          'Hi', LF,
          FF,
      ));

      assert.equal(stitch(items, {width: WIDTH}).height, 60);
    });

    it('should lay a page out over the printable area when no area was set', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L',
          ESC, 'a', 2, 'Right', LF,
          FF,
      ));

      /* The line is against the right edge of the paper, so the area is the
         whole printable area, and the page is as tall as its dots because the
         stream set no area of its own */

      const paper = stitch(items, {width: WIDTH});

      assert.equal(
          dots(Bitmap.extractRows(paper, 0, paper.height)),
          dots(Bitmap.extractRows(
              stitch(render(stream(ESC, '@', ESC, 'a', 2, 'Right', LF)), {width: WIDTH}),
              0, paper.height,
          )),
      );
    });

    it('should feed the paper for a print area that stayed empty', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L',
          area(0, 0, WIDTH, 100), 'Hi', LF,
          area(0, 100, WIDTH, 100),
          FF,
      ));

      assert.equal(stitch(items, {width: WIDTH}).height, 200);
    });

    it('should keep the print area and the direction across pages', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 60), ESC, 'T', 2,
          'Hi', LF,
          FF,
          ESC, 'L',
          'Hi', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 120);
      assert.equal(dots(Bitmap.extractRows(paper, 0, 60)), dots(Bitmap.extractRows(paper, 60, 60)));

      /* Direction 2 is still on for the second page, so both are upside down
         against the right edge of the area */

      assert.equal(
          dots(Bitmap.extractRows(paper, 0, 60)),
          dots(Bitmap.extractRows(stitch(render(stream(
              ESC, '@',
              ESC, 'L', area(0, 0, WIDTH, 60), ESC, 'T', 2, 'Hi', LF, FF,
          )), {width: WIDTH}), 0, 60)),
      );
    });

    it('should take the area and the direction a stream set in standard mode', function() {
      const before = render(stream(
          ESC, '@',
          area(0, 0, 288, 60), ESC, 'T', 1,
          ESC, 'L', 'Hi', LF,
          FF,
      ));

      const inside = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 60), ESC, 'T', 1, 'Hi', LF,
          FF,
      ));

      assert.equal(dots(stitch(before, {width: WIDTH})), dots(stitch(inside, {width: WIDTH})));
    });

    it('should put the area and the direction back on ESC @', function() {
      const items = render(stream(
          ESC, '@',
          area(0, 0, 288, 60), ESC, 'T', 2,
          ESC, '@',
          ESC, 'L', 'Hi', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(
          dots(Bitmap.extractRows(paper, 0, paper.height)),
          dots(Bitmap.extractRows(
              stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH}), 0, paper.height,
          )),
      );
    });

    it('should count a feed inside a page along the axis of the direction', function() {
      /*
          ESC 3, ESC J and ESC K move the position down the lines of the print
          direction, so in a sideways direction they count in horizontal motion
          units, one dot each, instead of in vertical ones. ESC 3 60 is 60 dots
          along the x axis of the paper in direction 1, where five characters
          of font A are the same distance.
      */

      const fed = (direction, spacing) => stitch(render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 288), ESC, 'T', direction,
          ESC, '3', spacing, LF, 'Hi', LF,
          FF,
      )), {width: WIDTH});

      /* Sixty horizontal motion units in direction 1 and the hundred and
         twenty vertical ones of the upright page are the same sixty dots, and
         the two pages are the same layout a quarter turn apart */

      assert.deepEqual(crop(fed(1, 60), 288), Bitmap.rotate90(crop(fed(0, 120), 288)));

      /* And those sixty dots are along the x axis of the paper here: the line
         stands where GS $ 60, which moves along the same axis, puts it */

      assert.deepEqual(fed(1, 60), stitch(render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 288), ESC, 'T', 1,
          GS, 0x24, ...[word(60)], 'Hi', LF,
          FF,
      )), {width: WIDTH}));
    });

    it('should count the character spacing inside a page along the axis of the text', function() {
      /*
          ESC SP leaves its space behind a character, along the axis the text
          runs in, so a sideways direction counts it in vertical motion units,
          two per dot. Twenty four of those and the twelve horizontal units of
          the upright page are the same twelve dots, and the two pages are the
          same layout a quarter turn apart.
      */

      const spaced = (direction, spacing) => stitch(render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 288), ESC, 'T', direction,
          ESC, ' ', spacing, 'Hi', LF,
          FF,
      )), {width: WIDTH});

      assert.deepEqual(crop(spaced(1, 24), 288), Bitmap.rotate90(crop(spaced(0, 12), 288)));
    });

    it('should not turn a page upside down', function() {
      const items = render(stream(
          ESC, '@',
          ESC, '{', 1,
          ESC, 'L', area(0, 0, WIDTH, 60),
          'Hi', LF,
          FF,
      ));

      const upright = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 60),
          'Hi', LF,
          FF,
      ));

      assert.equal(dots(stitch(items, {width: WIDTH})), dots(stitch(upright, {width: WIDTH})));
    });

    it('should keep the cursor as well as the position on ESC FF', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30),
          'AB',
          ESC, FF,
          'CD', LF,
          ESC, FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      /* The second print is the line as a whole, so the two prints together
         are AB and then ABCD */

      assert.equal(paper.height, 60);
      assert.equal(
          dots(Bitmap.extractRows(paper, 30, 30)),
          dots(stitch(render(stream(ESC, '@', 'ABCD', LF)), {width: WIDTH})),
      );
    });

    it('should ignore a print area whose origin is outside the page', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30), area(WIDTH, 0, WIDTH, 30),
          'Hi', LF,
          FF,
      ));

      assert.equal(stitch(items, {width: WIDTH}).height, 30);
    });

    it('should put a print area at its origin on the page', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(120, 60, 240, 60),
          'Hi', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 120);
      assert.equal(Bitmap.getPixel(paper, 123, 70), 1);
      assert.equal(Bitmap.getPixel(paper, 3, 10), 0);
    });

    it('should compose several print areas into one page', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L',
          area(0, 0, 288, 60), 'Left', LF,
          area(288, 60, 288, 60), 'Right', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 120);
      assert.equal(Bitmap.getPixel(paper, 3, 10), 1);
      assert.equal(Bitmap.getPixel(paper, 291, 70), 1);
    });

    it('should move the position inside the area with GS $ and GS \\', function() {
      const absolute = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 120),
          vertical(60), 'Hi', LF,
          FF,
      ));

      const moved = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 120),
          vertical(30), relative(30), 'Hi', LF,
          FF,
      ));

      assert.equal(dots(stitch(absolute, {width: WIDTH})), dots(stitch(moved, {width: WIDTH})));
      assert.equal(Bitmap.getPixel(stitch(absolute, {width: WIDTH}), 3, 70), 1);
    });

    it('should read a relative move above 32767 as a move back', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 120),
          vertical(60), relative(-60), 'Hi', LF,
          FF,
      ));

      assert.equal(Bitmap.getPixel(stitch(items, {width: WIDTH}), 3, 10), 1);
    });

    it('should ignore GS $ and GS \\ in standard mode', function() {
      assert.equal(
          dots(stitch(render(stream(ESC, '@', vertical(60), 'Hi', LF)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should count a position in the motion unit of the axis it moves along', function() {
      /*
          In a sideways direction the text runs along the vertical axis of the
          paper, so ESC $ counts in vertical motion units, two per dot on this
          profile, and GS $, which goes down the lines, counts in the horizontal
          ones, one dot each. Five characters of font A and two line feeds are
          the sixty dots both of them ask for here.
      */

      const sideways = (position, text) => stitch(render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 288, 288), ESC, 'T', 1,
          position, text, LF,
          FF,
      )), {width: WIDTH});

      assert.equal(
          dots(sideways([ESC, 0x24, ...word(120)], 'Hi')),
          dots(sideways([], '     Hi')),
      );

      assert.equal(
          dots(sideways([GS, 0x24, ...word(60)], 'Hi')),
          dots(sideways([LF, LF], 'Hi')),
      );
    });

    it('should wrap text inside the print area', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, 24, 120),
          'AAAA', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 3, 10), 1);
      assert.equal(Bitmap.getPixel(paper, 3, 40), 1);
      assert.equal(Bitmap.getPixel(paper, 27, 10), 0);
    });

    it('should discard what does not fit in the print area', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30),
          'First', LF, 'Second', LF,
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 30);
      assert.equal(
          dots(paper),
          dots(stitch(render(stream(ESC, '@', ESC, 'L', area(0, 0, WIDTH, 30), 'First', LF, FF)), {width: WIDTH})),
      );
    });

    it('should draw a block into the page at the position', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 240),
          vertical(60),
          GS, 'v', '0', [0, 2, 0, 16, 0], new Array(32).fill(0xff),
          FF,
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 240);
      assert.equal(Bitmap.getPixel(paper, 3, 62), 1);
      assert.equal(Bitmap.getPixel(paper, 3, 10), 0);
    });

    it('should cut the paper behind the page', function() {
      const items = render(stream(
          ESC, '@',
          ESC, 'L', area(0, 0, WIDTH, 30),
          'Coupon', LF,
          GS, 'V', 0,
          FF,
      ), {commands: COMMANDS});

      assert.deepEqual(items.map((item) => item.type), ['image', 'cut']);
    });

    it('should not enter page mode while a line is being composed', function() {
      const items = render(stream(
          ESC, '@',
          'Hi', ESC, 'L', area(0, 0, WIDTH, 240), LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });
  });

  describe('the lengths of the text layout commands', function() {
    /* Every command with arguments that do not change the paper, so that the
       text behind it has to land where it lands without the command */

    const lengths = [
      ['ESC SP n', [ESC, 0x20, 0]],
      ['ESC ! n', [ESC, 0x21, 0]],
      ['ESC $ nL nH', [ESC, 0x24, 0, 0]],
      ['ESC D n1..nk NUL', [ESC, 0x44, 10, 20, 0x00]],
      ['ESC D NUL', [ESC, 0x44, 0x00]],
      ['ESC G n', [ESC, 0x47, 0]],
      ['ESC R n', [ESC, 0x52, 0]],
      ['ESC \\ nL nH', [ESC, 0x5c, 0, 0]],
      ['ESC { n', [ESC, 0x7b, 0]],
      ['GS L nL nH', [GS, 0x4c, 0, 0]],
      ['GS W nL nH', [GS, 0x57, 0x40, 0x02]],
      ['FS & and FS .', [FS, 0x26, FS, 0x2e]],
      ['FS C n', [FS, 0x43, 1]],
      ['FS ! n', [FS, 0x21, 0]],
      ['FS - n', [FS, 0x2d, 0]],
      ['FS S n1 n2', [FS, 0x53, 0, 0]],
      ['FS W n', [FS, 0x57, 0]],
      ['FS ( C pL pH fn m', [FS, 0x28, 0x43, 2, 0, 48, 1]],
      ['ESC L and ESC S', [ESC, 0x4c, ESC, 0x53]],
      ['ESC T n', [ESC, 0x54, 0]],
      ['ESC W n1..n8', [ESC, 0x57, 0, 0, 0, 0, 0, 0, 0, 0]],
      ['ESC FF', [ESC, 0x0c]],
      ['GS $ nL nH', [GS, 0x24, 0, 0]],
      ['GS \\ nL nH', [GS, 0x5c, 0, 0]],
      ['ESC & y c1 c2 x d..', [ESC, 0x26, 3, 0x7e, 0x7e, 12, ...new Array(36).fill(0x00)]],
      /* Three definitions of the codes 0x7b to 0x7d, the first two columns
         wide and the other two blank, which is exactly the twelve argument
         bytes the parser computes for them */

      ['ESC & with three definitions', [ESC, 0x26, 3, 0x7b, 0x7d, 2, 0, 0, 0, 0, 0, 0, 0, 0]],
      ['ESC & with a code out of range', [ESC, 0x26, 3, 0x10, 0x10, 1, 0, 0, 0]],
      ['ESC % n', [ESC, 0x25, 0]],
      ['ESC ? n', [ESC, 0x3f, 0x7e]],
      ['ESC V n', [ESC, 0x56, 0]],
      ['ESC r n', [ESC, 0x72, 0]],
      ['GS ( N pL pH fn m', [GS, 0x28, 0x4e, 2, 0, 48, 48]],
      ['FS 2 c1 c2 d1..d72', [FS, 0x32, 0x77, 0x21, ...new Array(72).fill(0x00)]],
      ['FS ? c1 c2', [FS, 0x3f, 0x77, 0x21]],
    ];

    for (const [name, bytes] of lengths) {
      it(`should consume the arguments of ${name}`, function() {
        assert.equal(
            dots(stitch(render(stream(ESC, '@', bytes, 'Hi', LF)), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }

    const truncated = [
      ['ESC SP', [ESC, 0x20]],
      ['ESC !', [ESC, 0x21]],
      ['ESC $', [ESC, 0x24, 10]],
      ['ESC D without its NUL', [ESC, 0x44, 10, 20]],
      ['ESC G', [ESC, 0x47]],
      ['ESC R', [ESC, 0x52]],
      ['ESC \\', [ESC, 0x5c, 10]],
      ['ESC {', [ESC, 0x7b]],
      ['GS L', [GS, 0x4c, 10]],
      ['GS W', [GS, 0x57, 10]],
      ['FS C', [FS, 0x43]],
      ['FS !', [FS, 0x21]],
      ['FS -', [FS, 0x2d]],
      ['FS S', [FS, 0x53, 1]],
      ['FS W', [FS, 0x57]],
      ['FS ( C', [FS, 0x28, 0x43, 4, 0, 48]],
      ['DLE EOT', [0x10, 0x04]],
      ['DLE EOT 7', [0x10, 0x04, 7]],
      ['DLE ENQ', [0x10, 0x05]],
      ['DLE DC4', [0x10, 0x14]],
      ['DLE DC4 1', [0x10, 0x14, 1, 0]],
      ['DLE DC4 8', [0x10, 0x14, 8, 1, 3]],
      ['ESC T', [ESC, 0x54]],
      ['ESC W', [ESC, 0x57, 0, 0, 0, 0]],
      ['GS $', [GS, 0x24, 10]],
      ['GS \\', [GS, 0x5c, 10]],
      ['ESC & without its codes', [ESC, 0x26, 3, 0x41]],
      ['ESC & without the width of a character', [ESC, 0x26, 3, 0x41, 0x42, 12, ...new Array(36).fill(0x00)]],
      ['ESC & with the dots of a character missing', [ESC, 0x26, 3, 0x41, 0x41, 12, 0x00, 0x00]],
      ['ESC %', [ESC, 0x25]],
      ['ESC ?', [ESC, 0x3f]],
      ['ESC V', [ESC, 0x56]],
      ['ESC r', [ESC, 0x72]],
      ['GS ( N', [GS, 0x28, 0x4e, 2, 0, 48]],
      ['FS 2 with the glyph missing', [FS, 0x32, 0x77, 0x21, ...new Array(40).fill(0x00)]],
      ['FS ?', [FS, 0x3f, 0x77]],
    ];

    for (const [name, bytes] of truncated) {
      it(`should stop cleanly on a truncated ${name}`, function() {
        let items;

        assert.doesNotThrow(() => {
          items = render(stream(ESC, '@', 'Hi', LF, bytes), {commands: COMMANDS});
        });

        assert.equal(
            dots(stitch(items, {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }
  });

  describe('the image commands of the graphics group', function() {
    /*
        The same picture through every image command of section 13.

        It is 16 by 24 dots, which is a whole number of bytes in both
        directions, so that the column commands can carry it as well, and its
        rows and columns are all different, so that a decoding that transposes
        or mirrors the dots shows up at once.
    */

    const PICTURE_WIDTH = 16;
    const PICTURE_HEIGHT = 24;

    /* The dots in raster format, two bytes per row */

    const raster = [];

    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      raster.push((y * 37 + 11) & 0xff, (y * 151 + 5) & 0xff);
    }

    /* And the same dots in column format, three bytes per column */

    const columns = [];

    for (let x = 0; x < PICTURE_WIDTH; x++) {
      for (let byte = 0; byte < PICTURE_HEIGHT / 8; byte++) {
        let value = 0;

        for (let bit = 0; bit < 8; bit++) {
          if ((raster[(byte * 8 + bit) * 2 + (x >> 3)] >> (7 - (x & 7))) & 1) {
            value |= 0x80 >> bit;
          }
        }

        columns.push(value);
      }
    }

    /* The size of the picture as the graphics functions count it, in dots */

    const size = [PICTURE_WIDTH, 0, PICTURE_HEIGHT, 0];

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
     * The same function under the four byte length of GS 8 L
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

    /* Every way of printing the picture. The column mode image needs the line
       spacing of a strip, which is what the encoder sets around one, so that
       its line is as tall as the blocks of the other commands */

    const ways = {
      'ESC *': stream(
          ESC, '@', GS, 'P', 203, 203, ESC, '3', 24,
          ESC, '*', 33, [PICTURE_WIDTH, 0], columns, LF,
      ),

      'GS v 0': stream(ESC, '@', GS, 'v', '0', [0, 2, 0, PICTURE_HEIGHT, 0], raster),

      'GS ( L 112': stream(ESC, '@', graphics(112, [48, 1, 1, 49, ...size, ...raster]), graphics(50, [])),

      'GS 8 L 112': stream(
          ESC, '@', largeGraphics(112, [48, 1, 1, 49, ...size, ...raster]), largeGraphics(50, []),
      ),

      'GS ( L 113': stream(ESC, '@', graphics(113, [48, 1, 1, 49, ...size, ...columns]), graphics(50, [])),

      'GS ( L 67 and 69': stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ),

      'GS ( L 68 and 69': stream(
          ESC, '@',
          graphics(68, [48, 0x41, 0x42, 1, ...size, 49, ...columns]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ),

      'GS ( L 84 and 85': stream(
          ESC, '@',
          graphics(84, [48, 0x43, 0x44, 1, ...size, 49, ...columns]),
          graphics(85, [0x43, 0x44, 1, 1]),
      ),

      'GS ( L 83 and 85': stream(
          ESC, '@',
          graphics(83, [48, 0x43, 0x44, 1, ...size, 49, ...raster]),
          graphics(85, [0x43, 0x44, 1, 1]),
      ),

      'GS * and GS /': stream(
          ESC, '@', GS, '*', PICTURE_WIDTH / 8, PICTURE_HEIGHT / 8, columns, GS, '/', 0,
      ),

      'FS q and FS p': stream(
          ESC, '@', FS, 'q', 1, [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0], columns, FS, 'p', 1, 0,
      ),
    };

    const expected = dots(stitch(render(ways['GS v 0']), {width: WIDTH}));

    for (const [name, bytes] of Object.entries(ways)) {
      it(`should print the same dots for ${name}`, function() {
        const paper = stitch(render(bytes), {width: WIDTH});

        assert.equal(paper.height, PICTURE_HEIGHT);

        if (dots(paper) !== expected) {
          assert.fail(`${name} does not print the picture of GS v 0`);
        }
      });
    }

    /* The scaling of the graphics commands against the doubling of GS v 0 */

    const scales = [
      [1, 1, 0],
      [2, 1, 1],
      [1, 2, 2],
      [2, 2, 3],
    ];

    for (const [x, y, mode] of scales) {
      it(`should scale bx ${x} by ${y} like GS v 0 mode ${mode}`, function() {
        const scaled = render(stream(
            ESC, '@', graphics(112, [48, x, y, 49, ...size, ...raster]), graphics(50, []),
        ));

        const doubled = render(stream(ESC, '@', GS, 'v', '0', [mode, 2, 0, PICTURE_HEIGHT, 0], raster));

        assert.equal(
            dots(stitch(scaled, {width: WIDTH})),
            dots(stitch(doubled, {width: WIDTH})),
        );
      });

      it(`should scale function 69 by x ${x} and y ${y} like GS v 0 mode ${mode}`, function() {
        const scaled = render(stream(
            ESC, '@',
            graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
            graphics(69, [0x41, 0x42, x, y]),
        ));

        const doubled = render(stream(ESC, '@', GS, 'v', '0', [mode, 2, 0, PICTURE_HEIGHT, 0], raster));

        assert.equal(
            dots(stitch(scaled, {width: WIDTH})),
            dots(stitch(doubled, {width: WIDTH})),
        );
      });

      it(`should print GS / mode ${mode} like GS v 0 mode ${mode}`, function() {
        const printed = render(stream(
            ESC, '@', GS, '*', PICTURE_WIDTH / 8, PICTURE_HEIGHT / 8, columns, GS, '/', mode,
        ));

        const doubled = render(stream(ESC, '@', GS, 'v', '0', [mode, 2, 0, PICTURE_HEIGHT, 0], raster));

        assert.equal(
            dots(stitch(printed, {width: WIDTH})),
            dots(stitch(doubled, {width: WIDTH})),
        );
      });

      it(`should print FS p mode ${mode} like GS v 0 mode ${mode}`, function() {
        const printed = render(stream(
            ESC, '@',
            FS, 'q', 1, [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0], columns,
            FS, 'p', 1, mode,
        ));

        const doubled = render(stream(ESC, '@', GS, 'v', '0', [mode, 2, 0, PICTURE_HEIGHT, 0], raster));

        assert.equal(
            dots(stitch(printed, {width: WIDTH})),
            dots(stitch(doubled, {width: WIDTH})),
        );
      });
    }

    it('should align the graphics of the print buffer the way the alignment says', function() {
      const items = render(stream(
          ESC, '@', ESC, 'a', 2,
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          graphics(50, []),
      ));

      const paper = stitch(items, {width: WIDTH});

      assert.deepEqual(ink(paper, 0, PICTURE_HEIGHT).max, WIDTH - 1);
    });

    it('should draw the images of the print buffer under each other', function() {
      const items = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          graphics(50, []),
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, PICTURE_HEIGHT * 2);
    });

    it('should empty the print buffer once it is printed', function() {
      const items = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          graphics(50, []),
          graphics(50, []),
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, PICTURE_HEIGHT);
    });

    it('should throw the print buffer away on ESC @', function() {
      const items = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          ESC, '@',
          graphics(50, []),
          'Nothing was printed', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Nothing was printed', LF)), {width: WIDTH})),
      );
    });

    it('should draw every colour block of a definition into one image', function() {
      /* The picture is split over two colour blocks, the odd rows in colour 1
         and the even ones in colour 2, so only the OR of the two is the
         picture the other image commands print */

      const odd = raster.map((byte, index) => (index >> 1) % 2 === 0 ? byte : 0);
      const even = raster.map((byte, index) => (index >> 1) % 2 === 0 ? 0 : byte);

      const blocks = render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 2, ...size, 49, ...odd, 50, ...even]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ));

      const whole = render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ));

      assert.equal(dots(stitch(blocks, {width: WIDTH})), dots(stitch(whole, {width: WIDTH})));
    });

    it('should keep a short definition as wide as its dots, not as wide as it declared', function() {
      /* A column format definition of 64 by 8 dots that carries sixteen
         columns is sixteen dots wide, the way a block of one colour is, so it
         centres over its dots and not over the size the command asked for */

      const dots16 = new Array(16).fill(0).map((value, index) => (index * 37 + 11) & 0xff);

      const items = render(stream(
          ESC, '@', ESC, 'a', 1,
          graphics(68, [48, 0x41, 0x42, 1, 64, 0, 8, 0, 49, ...dots16]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ));

      const paper = stitch(items, {width: WIDTH});
      const edges = ink(paper, 0, 8);

      assert.equal(paper.height, 8);
      assert.isAtLeast(edges.min, (WIDTH - 16) / 2);
      assert.isBelow(edges.max, (WIDTH + 16) / 2);
    });

    it('should keep a definition of a colour the printer would call the second one', function() {
      const second = render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 50, ...raster]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ));

      const first = render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
          graphics(69, [0x41, 0x42, 1, 1]),
      ));

      assert.equal(dots(stitch(second, {width: WIDTH})), dots(stitch(first, {width: WIDTH})));
    });

    it('should draw the multiple tone images of a as colour one', function() {
      const tone = render(stream(ESC, '@', graphics(112, [52, 1, 1, 49, ...size, ...raster]), graphics(50, [])));
      const plain = render(stream(ESC, '@', graphics(112, [48, 1, 1, 49, ...size, ...raster]), graphics(50, [])));

      assert.equal(dots(stitch(tone, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should draw the data of the second colour as well, in black', function() {
      /* One image buffer here against one per colour on a two colour printer,
         so a store of colour two prints exactly what a store of colour one
         prints and nothing of the image is lost */

      const second = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 50, ...size, ...raster]),
          graphics(50, []),
          'Every colour is drawn', LF,
      ));

      const first = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 49, ...size, ...raster]),
          graphics(50, []),
          'Every colour is drawn', LF,
      ));

      assert.equal(dots(stitch(second, {width: WIDTH})), dots(stitch(first, {width: WIDTH})));
    });

    it('should report a tone parameter the command does not define', function() {
      const items = render(stream(
          ESC, '@', graphics(112, [50, 1, 1, 49, ...size, ...raster]), 'Hi', LF,
      ), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing and report the command for a key it does not hold', function() {
      const items = render(stream(
          ESC, '@', graphics(69, [0x5a, 0x5a, 1, 1]), 'Hi', LF,
      ), {commands: ['unknown']});

      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.equal(unknown[0].data[0], GS);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should not commit the pending line for a key it does not hold', function() {
      const items = render(stream(ESC, '@', 'AB', graphics(69, [0x5a, 0x5a, 1, 1]), 'CD', LF));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'ABCD', LF)), {width: WIDTH})),
      );
    });

    it('should keep a definition through an initialize and the next stream', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      const items = renderer.render(stream(ESC, '@', graphics(69, [0x41, 0x42, 1, 1])));

      assert.deepEqual(items.map((item) => item.type), ['image']);
      assert.equal(items[0].height, PICTURE_HEIGHT);
    });

    it('should keep a downloaded bit image through an initialize and the next stream', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', GS, '*', PICTURE_WIDTH / 8, PICTURE_HEIGHT / 8, columns));

      const items = renderer.render(stream(ESC, '@', GS, '/', 0));

      assert.deepEqual(items.map((item) => item.type), ['image']);
      assert.equal(items[0].height, PICTURE_HEIGHT);
    });

    it('should not carry a definition over to another renderer', function() {
      new EscPosRenderer({width: WIDTH}).render(
          stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])),
      );

      const items = new EscPosRenderer({width: WIDTH, commands: ['unknown']})
          .render(stream(ESC, '@', graphics(69, [0x41, 0x42, 1, 1])));

      assert.deepEqual(items.map((item) => item.type), ['unknown']);
    });

    it('should delete the image of a key with function 66', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      const items = renderer.render(stream(
          ESC, '@', graphics(66, [0x41, 0x42]), graphics(69, [0x41, 0x42, 1, 1]),
      ));

      assert.deepEqual(items.map((item) => item.type), ['unknown']);
    });

    it('should delete every NV image with function 65 and leave the download images alone', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
          graphics(83, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
      ));

      const items = renderer.render(stream(
          ESC, '@',
          graphics(65, [0x43, 0x4c, 0x52]),
          graphics(69, [0x41, 0x42, 1, 1]),
          graphics(85, [0x41, 0x42, 1, 1]),
      ));

      assert.deepEqual(items.map((item) => item.type), ['unknown', 'image']);
    });

    it('should delete every download image with function 81', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(83, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      const items = renderer.render(stream(
          ESC, '@', graphics(81, [0x43, 0x4c, 0x52]), graphics(85, [0x41, 0x42, 1, 1]),
      ));

      assert.deepEqual(items.map((item) => item.type), ['unknown']);
    });

    it('should replace every NV bit image with a new FS q definition', function() {
      const definition = [FS, 0x71, 2,
        PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0, ...columns,
        PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0, ...columns,
      ];

      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', definition));

      /* Two images, and after a definition of one image the second one is gone */

      assert.deepEqual(
          renderer.render(stream(ESC, '@', FS, 'p', 2, 0)).map((item) => item.type),
          ['image'],
      );

      renderer.render(stream(
          ESC, '@', FS, 'q', 1, [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0], columns,
      ));

      assert.deepEqual(
          renderer.render(stream(ESC, '@', FS, 'p', 2, 0)).map((item) => item.type),
          ['unknown'],
      );
    });

    it('should print nothing and report FS p for an image the stream never defined', function() {
      const items = render(stream(ESC, '@', FS, 'p', 1, 0, 'Hi', LF), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing and report GS / when no bit image was downloaded', function() {
      const items = render(stream(ESC, '@', GS, '/', 0, 'Hi', LF), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should draw only the rows a store function carries', function() {
      /* The size of an image is not the length of the command, the group
         length is, so a stream can ask for an image that is far larger than
         the dots behind it. Only the rows that are there are drawn */

      const items = render(stream(
          ESC, '@',
          graphics(112, [48, 1, 1, 49, PICTURE_WIDTH, 0, 0xff, 0x07, ...raster.slice(0, 8)]),
          graphics(50, []),
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 4);
    });

    it('should draw only the columns a column store function carries', function() {
      const items = render(stream(
          ESC, '@',
          graphics(113, [48, 1, 1, 49, 0xff, 0x07, PICTURE_HEIGHT, 0, ...columns.slice(0, 6)]),
          graphics(50, []),
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, PICTURE_HEIGHT);
      assert.equal(ink(stitch(items, {width: WIDTH}), 0, PICTURE_HEIGHT).max, 1);
    });

    it('should ignore a store function whose size is outside the range of the command', function() {
      /* 65535 by 65535 dots behind four bytes of data, ten times over, and the
         vertical scale of two on top of it. The command is out of range in both
         directions, so the printer ignores it and nothing is stored: the page
         stays empty and no bitmap of that size is ever allocated */

      const store = graphics(113, [48, 1, 2, 49, 0xff, 0xff, 0xff, 0xff, ...raster.slice(0, 4)]);

      const items = render(stream(
          ESC, '@', ...new Array(10).fill(store), graphics(50, []), 'Hi', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should ignore a store function with a scale that is not one or two', function() {
      const items = render(stream(
          ESC, '@',
          graphics(112, [48, 3, 1, 49, ...size, ...raster]),
          graphics(112, [48, 1, 0, 49, ...size, ...raster]),
          graphics(50, []),
          'Hi', LF,
      ));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should ignore a define whose size is outside the range of the command', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      /* A definition that is out of range leaves the image that is under the
         key code alone, it does not delete it */

      renderer.render(stream(
          ESC, '@', graphics(67, [48, 0x41, 0x42, 1, 0xff, 0xff, 0xff, 0xff, 49, ...raster]),
      ));

      assert.deepEqual(
          renderer.render(stream(ESC, '@', graphics(69, [0x41, 0x42, 1, 1]))).map((item) => item.type),
          ['image'],
      );
    });

    it('should leave an image alone when a definition carries no dots', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));
      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49])));

      assert.deepEqual(
          renderer.render(stream(ESC, '@', graphics(69, [0x41, 0x42, 1, 1]))).map((item) => item.type),
          ['image'],
      );
    });

    it('should ignore a print function without its four parameters', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      assert.deepEqual(renderer.render(stream(ESC, '@', graphics(69, [0x41, 0x42, 1]))), []);
    });

    it('should ignore a print function with a scale that is not one or two', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster])));

      assert.deepEqual(renderer.render(stream(ESC, '@', graphics(69, [0x41, 0x42, 3, 1]))), []);
    });

    it('should delete every image only with the CLR parameters', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
          graphics(83, [48, 0x41, 0x42, 1, ...size, 49, ...raster]),
      ));

      /* Neither delete carries CLR, so both are ignored and both images are
         still there */

      renderer.render(stream(ESC, '@', graphics(65, [0x43, 0x4c, 0x00]), graphics(81, [])));

      assert.deepEqual(
          renderer.render(stream(
              ESC, '@', graphics(69, [0x41, 0x42, 1, 1]), graphics(85, [0x41, 0x42, 1, 1]),
          )).map((item) => item.type),
          ['image'],
      );
    });

    it('should delete one download image with function 82', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(
          ESC, '@',
          graphics(83, [48, 0x43, 0x44, 1, ...size, 49, ...raster]),
          graphics(84, [48, 0x45, 0x46, 1, ...size, 49, ...columns]),
      ));

      const items = renderer.render(stream(
          ESC, '@',
          graphics(82, [0x43, 0x44]),
          graphics(85, [0x43, 0x44, 1, 1]),
          graphics(85, [0x45, 0x46, 1, 1]),
      ));

      assert.deepEqual(items.map((item) => item.type), ['unknown', 'image']);
    });

    it('should ignore GS * with a size outside the range of the command', function() {
      /* y of 49 bytes is past the 48 the command defines, so the image that
         was downloaded before it is still the one that prints */

      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(ESC, '@', GS, '*', PICTURE_WIDTH / 8, PICTURE_HEIGHT / 8, columns));
      renderer.render(stream(ESC, '@', GS, '*', 2, 49, new Array(2 * 49 * 8).fill(0xff)));

      const items = renderer.render(stream(ESC, '@', GS, '/', 0));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, PICTURE_HEIGHT);
    });

    it('should ignore GS * with more bytes than the memory of the printer holds', function() {
      const items = render(stream(
          ESC, '@', GS, '*', 40, 40, new Array(40 * 40 * 8).fill(0xff), GS, '/', 0, 'Hi', LF,
      ), {commands: ['unknown']});

      /* The definition is ignored, so the print reports a bit image that was
         never downloaded */

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should ignore a GS / and an FS p mode the commands do not define', function() {
      const printed = render(stream(
          ESC, '@',
          GS, '*', PICTURE_WIDTH / 8, PICTURE_HEIGHT / 8, columns,
          GS, '/', 4,
          FS, 'q', 1, [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0], columns,
          FS, 'p', 1, 52,
          'Hi', LF,
      ), {commands: ['unknown']});

      assert.deepEqual(printed.filter((item) => item.type === 'unknown'), []);

      assert.equal(
          dots(stitch(printed, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should keep the NV bit images when FS q defines none', function() {
      const renderer = new EscPosRenderer({width: WIDTH, commands: ['unknown']});

      renderer.render(stream(
          ESC, '@', FS, 'q', 1, [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT / 8, 0], columns,
      ));

      renderer.render(stream(ESC, '@', FS, 'q', 0));

      assert.deepEqual(
          renderer.render(stream(ESC, '@', FS, 'p', 1, 0)).map((item) => item.type),
          ['image'],
      );
    });

    it('should define nothing for an image without dots', function() {
      const items = render(stream(
          ESC, '@',
          graphics(67, [48, 0x41, 0x42, 1, 0, 0, 0, 0, 49]),
          graphics(69, [0x41, 0x42, 1, 1]),
          'Hi', LF,
      ), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should report a function of the group it does not know', function() {
      const items = render(stream(ESC, '@', graphics(99, [1, 2]), 'Hi', LF), {commands: ['unknown']});
      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), graphics(99, [1, 2]));
    });

    it('should report a group that is not the graphics of m 48', function() {
      const items = render(stream(ESC, '@', [GS, 0x28, 0x4c, 2, 0, 49, 50], 'Hi', LF), {commands: ['unknown']});

      assert.equal(items.filter((item) => item.type === 'unknown').length, 1);
    });

    const lengths = [
      ['GS ( L 48, transmit the NV capacity', graphics(48, [])],
      ['GS ( L 49, set the reference dot density', graphics(49, [50, 50])],
      ['GS ( L 51, transmit the remaining NV capacity', graphics(51, [])],
      ['GS ( L 52, transmit the remaining download capacity', graphics(52, [])],
      ['GS ( L 64, transmit the NV key codes', graphics(64, [0x4b, 0x43])],
      ['GS ( L 80, transmit the download key codes', graphics(80, [0x4b, 0x43])],
      ['GS ( L 50, print an empty graphics buffer', graphics(50, [])],
      ['GS ( L 66, delete a key it does not hold', graphics(66, [0x5a, 0x5a])],
      ['GS ( L 65, delete every NV image', graphics(65, [0x43, 0x4c, 0x52])],
      ['GS 8 L 50, print an empty graphics buffer', largeGraphics(50, [])],
      ['GS * x y d..', [GS, 0x2a, 1, 1, ...new Array(8).fill(0xff)]],
      ['FS q n .., a definition', [FS, 0x71, 1, 1, 0, 1, 0, ...new Array(8).fill(0xff)]],
    ];

    for (const [name, bytes] of lengths) {
      it(`should consume the arguments of ${name}`, function() {
        assert.equal(
            dots(stitch(render(stream(ESC, '@', bytes, 'Hi', LF)), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }

    const truncated = [
      ['GS ( L without its length', [GS, 0x28, 0x4c, 10]],
      ['GS ( L with data missing', [GS, 0x28, 0x4c, 20, 0, 48, 112, 48, 1, 1, 49]],
      ['GS 8 L without its length', [GS, 0x38, 0x4c, 10, 0, 0]],
      ['GS 8 L with data missing', [GS, 0x38, 0x4c, 40, 0, 0, 0, 48, 112, 48, 1, 1, 49]],
      ['GS ( L 84 with data missing', [GS, 0x28, 0x4c, 20, 0, 48, 84, 48, 0x43, 0x44, 1, 16, 0]],
      ['GS * without its size', [GS, 0x2a, 2]],
      ['GS * with data missing', [GS, 0x2a, 2, 3, 0xff, 0xff]],
      ['GS /', [GS, 0x2f]],
      ['FS p', [FS, 0x70, 1]],
      ['FS q without its count', [FS, 0x71]],
      ['FS q with data missing', [FS, 0x71, 1, 2, 0, 3, 0, 0xff]],
      ['GS k 75 without its length', [GS, 0x6b, 75]],
      ['GS k 75 with data missing', [GS, 0x6b, 75, 13, 0x30, 0x39]],
      ['GS k 76 with data missing', [GS, 0x6b, 76, 13, 0x30, 0x39]],
      ['GS k 77 with data missing', [GS, 0x6b, 77, 13, 0x30, 0x39]],
      ['GS k 78 with data missing', [GS, 0x6b, 78, 30, 0x28, 0x30, 0x31, 0x29]],
    ];

    for (const [name, bytes] of truncated) {
      it(`should stop cleanly on a truncated ${name}`, function() {
        let items;

        assert.doesNotThrow(() => {
          items = render(stream(ESC, '@', 'Hi', LF, bytes), {commands: COMMANDS});
        });

        assert.equal(
            dots(stitch(items, {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }
  });
});
