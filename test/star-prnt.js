import StarPrntRenderer from '../src/renderers/star-prnt.js';
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
  return new StarPrntRenderer(Object.assign({width: WIDTH}, options || {})).render(bytes);
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

const BEL = 0x07;
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

const LF = 0x0a;
const CR = 0x0d;
const EM = 0x19;
const SUB = 0x1a;
const CAN = 0x18;
const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const RS = 0x1e;

describe('StarPrntRenderer', function() {
  describe('options', function() {
    it('should be the star-prnt language', function() {
      assert.equal(StarPrntRenderer.language, 'star-prnt');
    });

    it('should require a width', function() {
      assert.throws(() => new StarPrntRenderer({}), /Width/);
    });

    it('should require a width that is a multiple of eight', function() {
      assert.throws(() => new StarPrntRenderer({width: 100}), /multiple of 8/);
    });

    it('should report the columns of the print width', function() {
      assert.equal(new StarPrntRenderer({width: 576}).columns, 48);
      assert.equal(new StarPrntRenderer({width: 384}).columns, 32);
    });

    it('should not accept a codepage mapping it does not have', function() {
      assert.throws(() => new StarPrntRenderer({width: 576, codepageMapping: 'epson'}), /codepage mapping/);
    });

    it('should not accept a profile it does not have', function() {
      assert.throws(() => new StarPrntRenderer({width: 576, profile: 'nope'}), /profile/);
    });

    it('should use the Star profile, which spaces its lines 32 dots apart', function() {
      assert.equal(render(stream(ESC, '@', CAN, 'Hi', LF))[0].height, 32);
    });

    it('should accept a profile of another printer family', function() {
      assert.equal(
          render(stream(ESC, '@', CAN, 'Hi', LF), {profile: 'epson'})[0].height,
          30,
      );
    });

    it('should accept an array of bytes as well as a Uint8Array', function() {
      const items = render([...stream(ESC, '@', CAN, 'Hi', LF)]);

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should leave nothing behind when a stream fails halfway', function() {
      const renderer = new StarPrntRenderer({width: WIDTH, commands: COMMANDS});
      const bytes = fixture('star-prnt', 'text').bytes;
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
          new StarPrntRenderer({width: WIDTH, commands: COMMANDS}).render(bytes),
      );
    });

    it('should render the same stream twice to the same items', function() {
      const renderer = new StarPrntRenderer({width: WIDTH, commands: COMMANDS});
      const bytes = fixture('star-prnt', 'text').bytes;

      assert.deepEqual(renderer.render(bytes), renderer.render(bytes));
    });
  });

  describe('fixtures', function() {
    for (const name of names('star-prnt')) {
      describe(name, function() {
        /* Loading and rendering happens inside the tests, so that a fixture
           that fails does not take the rest of the file down with it */

        it('should render the paper of the fixture', function() {
          const expected = fixture('star-prnt', name);
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), {width: WIDTH});

          if (dots(paper) !== dots(expected.paper)) {
            assert.fail(`${name} does not match its fixture\n${diff(paper, expected.paper)}`);
          }
        });

        it('should emit the commands of the fixture', function() {
          const expected = fixture('star-prnt', name);

          assert.deepEqual(commands(render(expected.bytes, {commands: COMMANDS})), expected.commands);
        });

        it('should not emit an image without height', function() {
          const items = render(fixture('star-prnt', name).bytes, {commands: COMMANDS});

          assert.isTrue(items.every((item) => item.type !== 'image' || item.height > 0));
        });
      });
    }
  });

  describe('text', function() {
    it('should wrap a line that is longer than the print width', function() {
      const items = render(stream(ESC, '@', CAN, 'A'.repeat(50), LF));

      assert.equal(items[0].height, 64);
    });

    it('should ignore a carriage return', function() {
      assert.deepEqual(
          render(stream(ESC, '@', CAN, 'Hi', 0x0a, 0x0d)),
          render(stream(ESC, '@', CAN, 'Hi', 0x0a)),
      );
    });

    it('should ignore the cancel the encoder sends behind the initialize', function() {
      assert.deepEqual(
          render(stream(ESC, '@', CAN, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });

    it('should throw away the line that is being composed on CAN', function() {
      assert.deepEqual(
          render(stream(ESC, '@', 'Thrown away', CAN, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });

    it('should not advance the paper on CAN', function() {
      const items = render(stream(ESC, '@', 'Thrown away', CAN, LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
      assert.isTrue(items[0].data.every((byte) => byte === 0));
    });

    it('should ignore control characters that are not commands', function() {
      assert.deepEqual(
          render(stream(ESC, '@', 'Hi', 0x00, 0x02, 0x0a)),
          render(stream(ESC, '@', 'Hi', 0x0a)),
      );
    });
  });

  describe('styles', function() {
    it('should reset the styles with ESC @', function() {
      const styled = render(stream(
          ESC, 'E', ESC, '-', 1, ESC, '4', ESC, 'i', 1, 1, ESC, RS, 'F', 1, ESC, GS, 'a', 2,
          ESC, '@', CAN, 'Hi', LF,
      ));

      assert.deepEqual(styled, render(stream(ESC, '@', CAN, 'Hi', LF)));
    });

    it('should switch bold on with ESC E and off with ESC F', function() {
      const bold = stitch(render(stream(ESC, '@', ESC, 'E', 'H', LF)), {width: WIDTH});
      const normal = stitch(render(stream(ESC, '@', ESC, 'E', ESC, 'F', 'H', LF)), {width: WIDTH});

      assert.notEqual(dots(bold), dots(normal));
      assert.equal(dots(normal), dots(stitch(render(stream(ESC, '@', 'H', LF)), {width: WIDTH})));
    });

    it('should switch invert on with ESC 4 and off with ESC 5', function() {
      const inverted = stitch(render(stream(ESC, '@', ESC, '4', 'H', LF)), {width: WIDTH});
      const normal = stitch(render(stream(ESC, '@', ESC, '4', ESC, '5', 'H', LF)), {width: WIDTH});

      /* An inverted cell is black where the glyph is white, so the first dot of
         the line is ink */

      assert.equal(Bitmap.getPixel(inverted, 0, 0), 1);
      assert.equal(Bitmap.getPixel(normal, 0, 0), 0);
    });

    it('should draw an underline one dot thick with ESC - 1', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '-', 1, 'Hi', LF)), {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 0, 23), 1);
      assert.equal(Bitmap.getPixel(paper, 0, 22), 0);
    });

    it('should accept the ASCII digits of the underline', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, '-', 49, 'Hi', LF)),
          render(stream(ESC, '@', ESC, '-', 1, 'Hi', LF)),
      );
    });

    it('should ignore an underline value the command does not define', function() {
      /* The Star underline has one thickness, ESC - 2 is not a command */

      assert.deepEqual(
          render(stream(ESC, '@', ESC, '-', 2, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });

    it('should align a short line to the right with ESC GS a', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, GS, 'a', 2, 'Hi', LF)), {width: WIDTH});

      assert.isAtLeast(ink(paper, 0, 32).min, 552);
      assert.isAtLeast(ink(paper, 0, 32).max, 564);
    });

    it('should centre a short line with ESC GS a', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, GS, 'a', 1, 'Hi', LF)), {width: WIDTH});

      assert.isAtLeast(ink(paper, 0, 32).min, 276);
      assert.isBelow(ink(paper, 0, 32).max, 300);
    });

    it('should accept the ASCII digits of the alignment as well', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, GS, 'a', 50, 'Hi', LF)),
          render(stream(ESC, '@', ESC, GS, 'a', 2, 'Hi', LF)),
      );
    });

    it('should switch to font B with ESC RS F', function() {
      const wide = stitch(render(stream(ESC, '@', 'H'.repeat(48), LF)), {width: WIDTH});
      const narrow = stitch(render(stream(ESC, '@', ESC, RS, 'F', 1, 'H'.repeat(48), LF)), {width: WIDTH});

      /* Font B sits in a nine dot cell, so 48 characters end at 432 instead of
         at the edge of the paper */

      assert.isAtLeast(ink(wide, 0, 32).max, 564);
      assert.isBelow(ink(narrow, 0, 32).max, 432);
      assert.isAtLeast(ink(narrow, 0, 32).max, 420);
    });

    it('should leave the font alone for a font it does not have', function() {
      /* Font C of the command has no glyphs in this renderer */

      assert.deepEqual(
          render(stream(ESC, '@', ESC, RS, 'F', 2, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });
  });

  describe('character size', function() {
    it('should take the height multiplier from the first argument of ESC i', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'i', 1, 0, 'Hi', LF))[0].height, 48);
      assert.equal(render(stream(ESC, '@', ESC, 'i', 0, 1, 'Hi', LF))[0].height, 32);
    });

    it('should take the width multiplier from the second argument of ESC i', function() {
      const wide = stitch(render(stream(ESC, '@', ESC, 'i', 0, 1, 'H', LF)), {width: WIDTH});
      const normal = stitch(render(stream(ESC, '@', 'H', LF)), {width: WIDTH});

      assert.equal(Bitmap.getPixel(wide, 6, 10), 1);
      assert.equal(Bitmap.getPixel(wide, 7, 10), 1);
      assert.equal(Bitmap.getPixel(normal, 6, 10), 0);
    });

    it('should go up to six times the size', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'i', 5, 5, 'Hi', LF))[0].height, 144);
    });

    it('should accept the ASCII digits of the multipliers', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'i', 49, 49, 'Hi', LF)),
          render(stream(ESC, '@', ESC, 'i', 1, 1, 'Hi', LF)),
      );
    });

    it('should ignore the multipliers of seven and eight that the encoder allows', function() {
      /* The encoder accepts a size of 1 to 8 for every language, ESC i only
         defines 1 to 6, and a Star printer leaves the size alone for the two
         it has no value for */

      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'i', 6, 6, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );

      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'i', 7, 7, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });

    it('should ignore a multiplier outside the range of the command', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'i', 9, 0, 'Hi', LF)),
          render(stream(ESC, '@', 'Hi', LF)),
      );

      assert.deepEqual(
          render(stream(ESC, '@', ESC, 'i', 1, 1, ESC, 'i', 0, 200, 'Hi', LF)),
          render(stream(ESC, '@', ESC, 'i', 1, 1, 'Hi', LF)),
      );
    });
  });

  describe('line spacing', function() {
    it('should space its lines 32 dots apart by default', function() {
      assert.equal(render(stream(ESC, '@', LF))[0].height, 32);
    });

    it('should set three millimetres of line spacing with ESC 0', function() {
      assert.equal(render(stream(ESC, '@', ESC, '0', LF))[0].height, 24);
    });

    it('should restore the default line spacing with ESC z 1', function() {
      assert.equal(render(stream(ESC, '@', ESC, '0', ESC, 'z', 1, LF))[0].height, 32);
    });

    it('should restore the line spacing a driver gave, not the four millimetres of the command', function() {
      /* The encoder writes ESC 0 before a column mode image and ESC z 1 behind
         it, so the command has to come back to the default of this printer */

      assert.equal(
          render(stream(ESC, '@', ESC, '0', ESC, 'z', 1, LF), {lineSpacing: 40})[0].height,
          40,
      );

      assert.equal(
          render(stream(ESC, '@', ESC, '0', ESC, 'z', 1, LF), {profile: 'epson'})[0].height,
          30,
      );
    });

    it('should set three millimetres of line spacing with ESC z 0 as well', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'z', 0, LF))[0].height, 24);
    });

    it('should read any other ESC z n as that many millimetres', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'z', 3, LF))[0].height, 24);
    });

    it('should return to the default line spacing on ESC @', function() {
      assert.equal(render(stream(ESC, '@', ESC, '0', ESC, '@', LF))[0].height, 32);
    });

    it('should feed lines with ESC a', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'a', 3))[0].height, 96);
    });

    it('should feed quarters of a millimetre with ESC J', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'J', 40))[0].height, 80);
    });

    it('should feed eighths of a millimetre with ESC I', function() {
      assert.equal(render(stream(ESC, '@', ESC, 'I', 40))[0].height, 40);
    });
  });

  describe('codepages', function() {
    it('should start in the Star standard character set', function() {
      assert.deepEqual(
          render(stream(ESC, '@', [0x82], LF)),
          render(stream(ESC, '@', ESC, GS, 't', 0, [0x82], LF)),
      );
    });

    it('should switch codepage with ESC GS t', function() {
      /* Number 1 of the Star mapping is cp437, where 0x82 is an e with an acute
         accent, and so is 0xe9 in windows1252, which is number 32 */

      const left = stitch(render(stream(ESC, '@', ESC, GS, 't', 1, [0x82], LF)), {width: WIDTH});
      const right = stitch(render(stream(ESC, '@', ESC, GS, 't', 32, [0xe9], LF)), {width: WIDTH});

      assert.equal(dots(left), dots(right));
    });

    it('should not decode the Star standard character set as cp437', function() {
      const standard = stitch(render(stream(ESC, '@', [0x82], LF)), {width: WIDTH});
      const cp437 = stitch(render(stream(ESC, '@', ESC, GS, 't', 1, [0x82], LF)), {width: WIDTH});

      assert.notEqual(dots(standard), dots(cp437));
    });

    it('should fall back to the initial codepage for a number the mapping does not have', function() {
      /* Number 3 is a gap in the Star mapping and 250 is past its end */

      assert.deepEqual(
          render(stream(ESC, '@', ESC, GS, 't', 3, [0x82], LF)),
          render(stream(ESC, '@', [0x82], LF)),
      );

      assert.deepEqual(
          render(stream(ESC, '@', ESC, GS, 't', 250, [0x82], LF)),
          render(stream(ESC, '@', [0x82], LF)),
      );
    });

    it('should return to the initial codepage on ESC @', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, GS, 't', 1, ESC, '@', [0x82], LF)),
          render(stream(ESC, '@', [0x82], LF)),
      );
    });

    it('should consume the argument of the codepage command, whatever it is', function() {
      /* The encoder selects cp866 with ESC GS t 10, and 10 is also the line
         feed, which the command must swallow */

      const items = render(stream(ESC, '@', ESC, GS, 't', 10, 'Hi', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });
  });

  describe('print mode', function() {
    it('should ignore the flush the encoder sends around a job', function() {
      assert.deepEqual(
          render(stream(ESC, '@', 'Hi', LF, ESC, GS, 'P', '0', ESC, GS, 'P', '1')),
          render(stream(ESC, '@', 'Hi', LF)),
      );
    });
  });

  describe('unknown commands', function() {
    it('should render the text after a command it does not know', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const unknown = render(stream(ESC, '@', 'A', ESC, 'c', 1, 'B', LF));

      assert.equal(dots(stitch(unknown, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should report the bytes of the command when unknown is supported', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'c', 1, 'B', LF), {commands: ['unknown']});
      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), [ESC, 0x63, 1]);
    });

    it('should drop the command when unknown is not supported', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'c', 1, 'B', LF));

      assert.isTrue(items.every((item) => item.type === 'image'));
    });

    it('should consume only the prefix of a command it has no length for', function() {
      const items = render(stream(ESC, '@', ESC, 0x03, 'Hi', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, 0x03],
      );

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should consume the prefix of an unknown command of the ESC GS group', function() {
      const items = render(stream(ESC, '@', ESC, GS, 0x7f, 'Hi', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, GS, 0x7f],
      );

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should consume the argument of an unknown command of the ESC RS group', function() {
      const items = render(stream(ESC, '@', 'A', ESC, RS, 'r', 2, 'B', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, RS, 0x72, 2],
      );

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), {width: WIDTH})),
      );
    });

    it('should consume the automatic status command of the ESC GS group', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, GS, [0x03], 's', [1, 0], 'B', LF));

      assert.equal(dots(stitch(skipped, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should consume the tab positions of ESC D', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, 'D', [10, 20, 30, 0], 'B', LF));

      assert.equal(dots(stitch(skipped, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should consume the data of a bit image command', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'K', [6, 0], [1, 2, 3, 4, 5, 6], 'B', LF));

      /* The image is drawn, and the text on both sides of it is where it would
         be without it: one line of the default spacing */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should consume the mode byte of ESC FF', function() {
      /* ESC FF EM prints the buffer, and the EM of the mode must not open a
         drawer */

      const items = render(stream(ESC, '@', 'A', ESC, 0x0c, EM, 'B', LF), {commands: ['pulse']});

      assert.isTrue(items.every((item) => item.type !== 'pulse'));
      assert.equal(items.length, 1);
      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), {width: WIDTH})),
      );
    });

    it('should consume an ESC * that is not the raster group', function() {
      const items = render(stream(ESC, '@', 'A', ESC, '*', 'Q'), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, 0x2a, 0x51],
      );

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH})),
      );
    });

    it('should consume the raster mode commands of the TSP100', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const skipped = render(stream(
          ESC, '@', 'A',
          ESC, '*', 'rR',
          ESC, '*', 'rA',
          ESC, '*', 'rF', '13', [0],
          ESC, '*', 'rml', '24', [0],
          ESC, '*', 'rB',
          'B', LF,
      ));

      assert.equal(dots(stitch(skipped, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    it('should stop without an error when a command runs past the end', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, ESC, GS));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should stop without an error on a truncated barcode', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, ESC, 'b', [6, 2, 2, 40], '12345'));

      assert.equal(items.length, 1);
    });

    it('should stop without an error on a truncated column image', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, ESC, 'X', [24, 0], [1, 2, 3]));

      assert.equal(items.length, 1);
    });
  });

  describe('blocks', function() {
    it('should draw a barcode with the module width of n3', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, 'b', [3, 1, 2, 40], '4006381333931', [RS])), {width: WIDTH});

      /* EAN-13 is 95 modules, three dots each at n3 = 2, and the bars are 40
         dots tall, on a line of their own */

      assert.equal(paper.height, 40);
      assert.equal(ink(paper, 0, 40).max - ink(paper, 0, 40).min + 1, 95 * 3);
    });

    it('should take the module width of n3 from a table of its own', function() {
      const width = (n3) => {
        const paper = stitch(render(stream(ESC, '@', ESC, 'b', [3, 1, n3, 40], '4006381333931', [RS])), {width: WIDTH});
        const edges = ink(paper, 0, 40);

        return (edges.max - edges.min + 1) / 95;
      };

      assert.deepEqual([width(1), width(2), width(3)], [2, 3, 4]);
    });

    it('should draw the human readable text below the bars when n2 is 2', function() {
      const without = stitch(render(stream(ESC, '@', ESC, 'b', [3, 1, 2, 40], '4006381333931', [RS])), {width: WIDTH});
      const with_ = stitch(render(stream(ESC, '@', ESC, 'b', [3, 2, 2, 40], '4006381333931', [RS])), {width: WIDTH});

      /* The text is one line of font A cells, which are 24 dots tall in the
         Star profile, with the four dot gap between the bars and the text */

      assert.equal(without.height, 40);
      assert.equal(with_.height, 68);
    });

    it('should print nothing for data that is not valid for the symbology', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'b', [3, 2, 2, 40], '400638133393X', [RS], 'B', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should print nothing for a barcode that is wider than the print area', function() {
      /* Code 93 of six characters is 91 modules, and n3 of 3 is four dots per
         module, 364 dots, which does not fit on a 256 dot printer */

      const items = render(
          stream(ESC, '@', 'A', ESC, 'b', [7, 1, 3, 40], 'TEST93', [RS], 'B', LF),
          {width: 256},
      );

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should print nothing for a byte the code sets of Code 128 cannot carry', function() {
      const code128 = render(stream(ESC, '@', 'A', ESC, 'b', [6, 1, 2, 40], 'AB', [0xe9], [RS], 'B', LF));
      const gs1 = render(stream(ESC, '@', 'A', ESC, 'b', [9, 1, 2, 40], '01', [0xe9], [RS], 'B', LF));
      const known = render(stream(ESC, '@', 'AB', LF));

      assert.equal(dots(stitch(code128, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
      assert.equal(dots(stitch(gs1, {width: WIDTH})), dots(stitch(known, {width: WIDTH})));
    });

    /* The GS1 DataBar family, symbologies 10 to 13. The heights of the
       specification are in modules and follow the width of a module, and
       Truncated and Limited have a height of their own that n4 does not
       change */

    it('should draw a GS1 DataBar Omnidirectional of ninety six modules', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, 'b', [10, 1, 2, 120], '0952123454321', [RS],
      )), {width: WIDTH});

      assert.equal(paper.height, 120);
      assert.equal(ink(paper, 0, 120).max - ink(paper, 0, 120).min + 1, 95 * 3);
    });

    it('should give the four variants the heights of the specification', function() {
      const height = (symbology, dots) => stitch(render(stream(
          ESC, '@', ESC, 'b', [symbology, 1, 2, dots], '0952123454321', [RS],
      )), {width: WIDTH}).height;

      assert.equal(height(10, 20), 33 * 3);
      assert.equal(height(10, 120), 120);
      assert.equal(height(11, 120), 13 * 3);
      assert.equal(height(12, 120), 10 * 3);
    });

    it('should draw a GS1 DataBar Expanded of the element string it is given', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, 'b', [13, 1, 1, 60], '(01)90614141000015(3103)000123', [RS],
      )), {width: WIDTH});

      assert.equal(paper.height, 34 * 2);
      assert.equal(ink(paper, 0, 34 * 2).max - ink(paper, 0, 34 * 2).min + 1, 149 * 2);
    });

    it('should print nothing for a GS1 DataBar the data is not valid for', function() {
      for (const [symbology, data] of [
        [10, '123456789012'],
        [10, '09521234543210'],
        [11, '09521234A4321'],
        [12, '2952123454321'],
        [13, '01)90614141000015'],
      ]) {
        const items = render(stream(
            ESC, '@', 'A', ESC, 'b', [symbology, 1, 2, 60], data, [RS], LF,
        ));

        assert.equal(items.length, 1, `${symbology} ${data}`);
        assert.equal(items[0].height, 32);
      }
    });

    it('should draw a QR code of the size the commands ask for', function() {
      const paper = stitch(render(stream(
          ESC, '@',
          ESC, GS, 'yS', [0x30, 0x02],
          ESC, GS, 'yS', [0x32, 0x04],
          ESC, GS, 'yS', [0x31, 0x01],
          ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test',
          ESC, GS, 'yP',
      )), {width: WIDTH});

      /* The smallest symbol that holds four bytes is version 1, 21 modules, at
         four dots per module */

      assert.equal(paper.height, 21 * 4);
      assert.equal(ink(paper, 0, paper.height).max - ink(paper, 0, paper.height).min + 1, 21 * 4);
    });

    it('should print a smaller symbol at error correction level L than at M', function() {
      const size = (level) => {
        const value = 'https://example.com/order/9912';

        const items = render(stream(
            ESC, '@',
            ESC, GS, 'yS', [0x32, 3],
            ESC, GS, 'yS', [0x31, level],
            ESC, GS, 'yD', [0x31, 0x00, value.length, 0], value,
            ESC, GS, 'yP',
        ));

        return items[0].height / 3;
      };

      assert.deepEqual([size(0), size(1), size(2), size(3)], [25, 29, 29, 33]);
    });

    it('should print nothing when no data was stored', function() {
      const items = render(stream(ESC, '@', ESC, GS, 'yP', 'A', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should print nothing after ESC @ threw the stored data away', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test',
          ESC, '@',
          ESC, GS, 'yP',
          'A', LF,
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should not carry the stored data over to the next stream', function() {
      const renderer = new StarPrntRenderer({width: WIDTH});

      renderer.render(stream(ESC, '@', ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test'));

      const items = renderer.render(stream(ESC, '@', ESC, GS, 'yP', 'A', LF));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should print nothing for a QR code that is wider than the print area', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'yS', [0x32, 8],
          ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test',
          ESC, GS, 'yP',
          'A', LF,
      ), {width: 128});

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32);
    });

    it('should keep the data of a QR code until the next store', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'yS', [0x32, 0x03],
          ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test',
          ESC, GS, 'yP',
          ESC, GS, 'yP',
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 21 * 3 * 2);
    });

    it('should draw a PDF417 as a block', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'xS', [0x30, 0x01, 0x00, 0x03], /* the rows follow, three columns */
          ESC, GS, 'xS', [0x31, 0x02], /* error correction level 2 */
          ESC, GS, 'xS', [0x32, 0x03], /* three dot modules */
          ESC, GS, 'xS', [0x33, 0x03], /* rows of three modules */
          ESC, GS, 'xD', [11, 0], 'HELLO WORLD',
          ESC, GS, 'xP',
      ));

      /* The same symbol the ESC/POS commands print: five rows of three columns,
         120 modules of three dots wide */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 5 * 3 * 3);

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, items[0].height).max - ink(paper, 0, items[0].height).min + 1, 120 * 3);
    });

    it('should leave the size to the printer when the size command says so', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'xS', [0x30, 0x00, 0x0c, 0x06], /* the rows and columns behind it are not used */
          ESC, GS, 'xS', [0x31, 0x02],
          ESC, GS, 'xS', [0x32, 0x03],
          ESC, GS, 'xS', [0x33, 0x03],
          ESC, GS, 'xD', [11, 0], 'HELLO WORLD',
          ESC, GS, 'xP',
      ));

      /* Fifteen codewords in the shape the automatic size picks, which is one
         column of fifteen rows */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 15 * 3 * 3);
    });

    it('should leave the size alone when the size command does not carry one', function() {
      const symbol = (n1) => render(stream(
          ESC, '@',
          ESC, GS, 'xS', [0x30, 0x01, 0x00, 0x03], /* three columns */
          ESC, GS, 'xS', [0x30, n1, 0x00, 0x06], /* six columns, if n1 is a value of the command */
          ESC, GS, 'xS', [0x31, 0x02],
          ESC, GS, 'xS', [0x32, 0x03],
          ESC, GS, 'xS', [0x33, 0x03],
          ESC, GS, 'xD', [11, 0], 'HELLO WORLD',
          ESC, GS, 'xP',
      ));

      /* Fifteen codewords are three rows of six columns and five rows of three,
         so the height says which size the printer used. Only 0 and 1 are values
         of n1, anything else leaves the size as it was. */

      assert.equal(symbol(1)[0].height, 3 * 3 * 3);
      assert.equal(symbol(2)[0].height, 5 * 3 * 3);
      assert.equal(symbol(0xff)[0].height, 5 * 3 * 3);
    });

    it('should print nothing when a PDF417 has no data', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'xS', [0x32, 0x03],
          ESC, GS, 'xP',
      ));

      assert.deepEqual(items, []);
    });

    it('should keep the data of a PDF417 until the next store', function() {
      const items = render(stream(
          ESC, '@',
          ESC, GS, 'xS', [0x30, 0x01, 0x00, 0x03],
          ESC, GS, 'xS', [0x31, 0x02],
          ESC, GS, 'xS', [0x32, 0x03],
          ESC, GS, 'xS', [0x33, 0x03],
          ESC, GS, 'xD', [11, 0], 'HELLO WORLD',
          ESC, GS, 'xP',
          ESC, GS, 'xP',
      ));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 5 * 3 * 3 * 2);
    });

    it('should draw a column image as a strip in the line', function() {
      const data = new Array(24 * 3).fill(0xff);
      const items = render(stream(ESC, '@', ESC, '0', ESC, 'X', [24, 0], data, LF, CR, ESC, 'z', 1));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 24);

      const paper = stitch(items, {width: WIDTH});

      assert.equal(ink(paper, 0, 24).min, 0);
      assert.equal(ink(paper, 0, 24).max, 23);
    });

    it('should put the top dot of a column in the most significant bit', function() {
      const items = render(stream(ESC, '@', ESC, '0', ESC, 'X', [1, 0], [0x80, 0x00, 0x01], LF, CR));
      const paper = stitch(items, {width: WIDTH});

      assert.equal(Bitmap.getPixel(paper, 0, 0), 1);
      assert.equal(Bitmap.getPixel(paper, 0, 1), 0);
      assert.equal(Bitmap.getPixel(paper, 0, 23), 1);
    });

    it('should print the columns of ESC K twice and those of ESC L once', function() {
      const single = stitch(render(stream(ESC, '@', ESC, 'K', [2, 0], [0xff, 0xff], LF)), {width: WIDTH});
      const double = stitch(render(stream(ESC, '@', ESC, 'L', [2, 0], [0xff, 0xff], LF)), {width: WIDTH});

      assert.equal(ink(single, 0, 8).max, 3);
      assert.equal(ink(double, 0, 8).max, 1);
    });
  });

  describe('cut', function() {
    it('should emit the cuts where the encoder put them', function() {
      const items = render(fixture('star-prnt', 'cut').bytes, {commands: ['cut']});

      assert.deepEqual(
          items.map((item) => item.type),
          ['image', 'cut', 'image', 'cut', 'image'],
      );

      assert.deepEqual(
          items.filter((item) => item.type === 'cut'),
          [{type: 'cut', value: 'partial'}, {type: 'cut', value: 'full'}],
      );
    });

    it('should read the four cut types of ESC d', function() {
      const cut = (value) => render(stream(ESC, '@', ESC, 'd', value), {commands: ['cut']})
          .filter((item) => item.type === 'cut')[0].value;

      assert.equal(cut(0), 'full');
      assert.equal(cut(1), 'partial');
      assert.equal(cut(2), 'full');
      assert.equal(cut(3), 'partial');
      assert.equal(cut(48), 'full');
      assert.equal(cut(49), 'partial');
    });

    it('should drop the cuts when cut is not supported', function() {
      const items = render(fixture('star-prnt', 'cut').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));
      assert.equal(items.length, 1);
    });

    it('should leave the paper unchanged when the cuts are dropped', function() {
      const supported = render(fixture('star-prnt', 'cut').bytes, {commands: ['cut']});
      const dropped = render(fixture('star-prnt', 'cut').bytes);

      assert.equal(dots(stitch(dropped, {width: WIDTH})), dots(stitch(supported, {width: WIDTH})));
    });
  });

  describe('pulse', function() {
    it('should emit the pulse of the fixture with the times in milliseconds', function() {
      const items = render(fixture('star-prnt', 'pulse').bytes, {commands: ['pulse']});

      assert.deepEqual(
          items.filter((item) => item.type === 'pulse'),
          [{type: 'pulse', device: 0, on: 100, off: 500}],
      );
    });

    it('should take the width of the first drawer from ESC BEL, in units of ten milliseconds', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, BEL, [10, 50], BEL), {commands: ['pulse']})
              .filter((item) => item.type === 'pulse'),
          [{type: 'pulse', device: 0, on: 100, off: 500}],
      );
    });

    it('should use the default width of the printer without ESC BEL', function() {
      assert.deepEqual(
          render(stream(ESC, '@', BEL), {commands: ['pulse']}),
          [{type: 'pulse', device: 0, on: 200, off: 200}],
      );
    });

    it('should open the second drawer with SUB, at the fixed width of the specification', function() {
      /* ESC BEL sets the width of the first drawer only, so the second one
         keeps the 200 ms of the specification even when the stream asked for
         100 and 500. This is why a pulse to device 1 does not survive a round
         trip through both languages, see test/parity.js */

      assert.deepEqual(
          render(stream(ESC, '@', ESC, BEL, [10, 50], SUB), {commands: ['pulse']}),
          [{type: 'pulse', device: 1, on: 200, off: 200}],
      );
    });

    it('should accept FS for the first drawer and EM for the second', function() {
      assert.deepEqual(
          render(stream(ESC, '@', ESC, BEL, [10, 50], FS), {commands: ['pulse']}),
          render(stream(ESC, '@', ESC, BEL, [10, 50], BEL), {commands: ['pulse']}),
      );

      assert.deepEqual(
          render(stream(ESC, '@', EM), {commands: ['pulse']}),
          render(stream(ESC, '@', SUB), {commands: ['pulse']}),
      );
    });

    it('should keep the pulse width over an initialize', function() {
      assert.deepEqual(
          render(stream(ESC, BEL, [10, 50], ESC, '@', CAN, BEL), {commands: ['pulse']}),
          [{type: 'pulse', device: 0, on: 100, off: 500}],
      );
    });

    it('should start the next stream at the default width again', function() {
      const renderer = new StarPrntRenderer({width: WIDTH, commands: ['pulse']});

      renderer.render(stream(ESC, '@', ESC, BEL, [10, 50]));

      assert.deepEqual(
          renderer.render(stream(ESC, '@', BEL)),
          [{type: 'pulse', device: 0, on: 200, off: 200}],
      );
    });

    it('should drop the pulse when pulse is not supported', function() {
      const items = render(fixture('star-prnt', 'pulse').bytes);

      assert.isTrue(items.every((item) => item.type === 'image'));
    });
  });

  describe('feed', function() {
    it('should turn the runs of blank rows into feed items', function() {
      const items = render(fixture('star-prnt', 'feed').bytes, {commands: ['feed']});

      /* The nine dots below a line of text are blank as well, the eight of the
         line spacing and the bottom row of the cell, so they belong to the run
         that follows them. The cut of this receipt is not supported here, so it
         does not end a segment and the blank rows on both sides of it are one
         run */

      assert.deepEqual(
          items.map((item) => `${item.type}:${item.height}`),
          ['image:23', 'feed:105', 'image:23', 'feed:233'],
      );
    });

    it('should print the same paper either way', function() {
      const bytes = fixture('star-prnt', 'feed').bytes;

      assert.equal(
          dots(stitch(render(bytes, {commands: ['feed']}), {width: WIDTH})),
          dots(stitch(render(bytes), {width: WIDTH})),
      );
    });
  });

  describe('maxHeight', function() {
    for (const name of ['text', 'table', 'feed']) {
      it(`should split the ${name} fixture into pieces that hold the same paper`, function() {
        const bytes = fixture('star-prnt', name).bytes;

        const whole = render(bytes, {commands: COMMANDS});
        const split = render(bytes, {commands: COMMANDS, maxHeight: 41});

        assert.isTrue(split.every((item) => item.type !== 'image' || item.height <= 41));
        assert.isAtLeast(split.length, whole.length);
        assert.equal(dots(stitch(split, {width: WIDTH})), dots(stitch(whole, {width: WIDTH})));
      });
    }
  });

  describe('hand assembled fixtures', function() {
    for (const name of names('star-prnt/raw')) {
      describe(name, function() {
        it('should render the paper of the fixture', function() {
          const expected = fixture('star-prnt/raw', name);
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), {width: WIDTH});

          if (dots(paper) !== dots(expected.paper)) {
            assert.fail(`${name} does not match its fixture\n${diff(paper, expected.paper)}`);
          }
        });

        it('should emit the commands of the fixture', function() {
          const expected = fixture('star-prnt/raw', name);

          assert.deepEqual(commands(render(expected.bytes, {commands: COMMANDS})), expected.commands);
        });
      });
    }
  });

  describe('ESC W n and ESC h n, the size', function() {
    it('should print double width with ESC W 1', function() {
      const expanded = render(stream(ESC, '@', ESC, 'W', 1, 'Wide', LF));
      const size = render(stream(ESC, '@', ESC, 'i', 0, 1, 'Wide', LF));

      assert.equal(dots(stitch(expanded, {width: WIDTH})), dots(stitch(size, {width: WIDTH})));
    });

    it('should print double height with ESC h 1', function() {
      const expanded = render(stream(ESC, '@', ESC, 'h', 1, 'Tall', LF));
      const size = render(stream(ESC, '@', ESC, 'i', 1, 0, 'Tall', LF));

      assert.equal(dots(stitch(expanded, {width: WIDTH})), dots(stitch(size, {width: WIDTH})));
    });

    it('should go back to the normal size with 0', function() {
      const back = render(stream(ESC, '@', ESC, 'W', 1, ESC, 'h', 1, ESC, 'W', 0, ESC, 'h', 0, 'Plain', LF));
      const plain = render(stream(ESC, '@', 'Plain', LF));

      assert.equal(dots(stitch(back, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should leave the size alone for a value it does not define', function() {
      const ignored = render(stream(ESC, '@', ESC, 'W', 9, ESC, 'h', 9, 'Plain', LF));
      const plain = render(stream(ESC, '@', 'Plain', LF));

      assert.equal(dots(stitch(ignored, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC _ n, the upperline', function() {
    it('should draw a line along the top of the cell', function() {
      const upper = stitch(render(stream(ESC, '@', ESC, '_', 1, 'Over', LF)), {width: WIDTH});
      const under = stitch(render(stream(ESC, '@', ESC, '-', 1, 'Over', LF)), {width: WIDTH});

      /* The upperline is the underline of the same cell turned upside down,
         so the two lines are the rows the other one leaves white */

      assert.equal(ink(upper, 0, 1).min, 0);
      assert.equal(ink(upper, 23, 24).min, -1);
      assert.equal(ink(under, 23, 24).min, 0);
    });

    it('should switch off with ESC _ 0', function() {
      const off = render(stream(ESC, '@', ESC, '_', 1, ESC, '_', 0, 'Plain', LF));
      const plain = render(stream(ESC, '@', 'Plain', LF));

      assert.equal(dots(stitch(off, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('ESC R n, international character set', function() {
    it('should replace the code points of the set', function() {
      const german = render(stream(ESC, '@', ESC, GS, 't', 1, ESC, 'R', 2, '[\\]{|}~', LF));
      const cp437 = render(stream(ESC, '@', ESC, GS, 't', 1, [0x8e, 0x99, 0x9a, 0x84, 0x94, 0x81, 0xe1], LF));

      assert.equal(dots(stitch(german, {width: WIDTH})), dots(stitch(cp437, {width: WIDTH})));
    });

    it('should leave the set alone for a number Star does not share with Epson', function() {
      const ignored = render(stream(ESC, '@', ESC, 'R', 3, ESC, 'R', 14, '#', LF));
      const uk = render(stream(ESC, '@', ESC, 'R', 3, '#', LF));

      assert.equal(dots(stitch(ignored, {width: WIDTH})), dots(stitch(uk, {width: WIDTH})));
    });
  });

  describe('ESC l n and ESC Q n, the margins', function() {
    it('should start the line at the left margin, in characters', function() {
      const margin = stitch(render(stream(ESC, '@', ESC, 'l', 2, 'A', LF)), {width: WIDTH});
      const plain = stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH});

      assert.equal(ink(margin, 0, 24).min, ink(plain, 0, 24).min + 24);
    });

    it('should right align inside the area of the two margins', function() {
      const inside = stitch(render(stream(
          ESC, '@', ESC, 'l', 2, ESC, 'Q', 40, ESC, GS, 'a', 2, 'A', LF,
      )), {width: WIDTH});
      const plain = stitch(render(stream(ESC, '@', 'A', LF)), {width: WIDTH});

      assert.equal(ink(inside, 0, 24).max, ink(plain, 0, 24).max + 24 + 456 - 12);
    });

    it('should print over the whole paper when the right margin is not beyond the left one', function() {
      const cleared = render(stream(ESC, '@', ESC, 'Q', 40, ESC, 'Q', 0, ESC, GS, 'a', 2, 'A', LF));
      const plain = render(stream(ESC, '@', ESC, GS, 'a', 2, 'A', LF));

      assert.equal(dots(stitch(cleared, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });

    it('should be reset by ESC @', function() {
      const reset = render(stream(ESC, '@', ESC, 'l', 4, ESC, '@', 'A', LF));
      const plain = render(stream(ESC, '@', 'A', LF));

      assert.equal(dots(stitch(reset, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
    });
  });

  describe('HT and ESC D, tab stops', function() {
    it('should move to the next default stop, every eight characters', function() {
      const paper = stitch(render(stream(ESC, '@', 'A', 0x09, 'A', LF)), {width: WIDTH});
      const starts = columnsOf(paper, 0, 24).map((run) => run.start);

      assert.equal(starts.length, 2);
      assert.equal(starts[1] - starts[0], 96);
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
  });

  describe('the buzzer commands', function() {
    const buzzers = [
      ['ESC GS BEL m n1 n2', [ESC, GS, 0x07, 1, 2, 2]],
      ['ESC GS EM DC1 m n1 n2', [ESC, GS, 0x19, 0x11, 1, 2, 2]],
      ['ESC GS EM DC2 m n1 n2', [ESC, GS, 0x19, 0x12, 1, 2, 2]],
    ];

    for (const [name, bytes] of buzzers) {
      it(`should report ${name} and keep the text behind it`, function() {
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

  describe('raster mode', function() {
    /**
     * A raster setting command, its value as ASCII digits closed with a NUL
     *
     * @param  {string}   command   The letter of the command
     * @param  {number}   value     The value of the setting
     * @return {number[]}           The bytes
     */
    function raster(command, value) {
      return [ESC, 0x2a, 0x72, ...Array.from(command, (c) => c.charCodeAt(0)),
        ...Array.from(String(value), (c) => c.charCodeAt(0)), 0x00];
    }

    /**
     * A row of raster data
     *
     * @param  {number[]}   bytes    The bytes of the row
     * @param  {boolean}    [feed]   False for k, which holds the position
     * @return {number[]}            The bytes
     */
    function row(bytes, feed = true) {
      return [feed ? 0x62 : 0x6b, bytes.length & 0xff, bytes.length >> 8, ...bytes];
    }

    const enter = [ESC, 0x2a, 0x72, 0x52, ESC, 0x2a, 0x72, 0x41];
    const quit = [ESC, 0x2a, 0x72, 0x42];
    const executeFF = [ESC, 0x0c, 0x00];
    const executeEOT = [ESC, 0x0c, 0x04];

    it('should print one row of dots per raster data command', function() {
      const items = render(stream(ESC, '@', enter, row([0xff]), row([0x0f]), executeEOT, quit));
      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 2);
      assert.equal(dots(Bitmap.extractRows(paper, 0, 1)).endsWith(':255' + ',0'.repeat(71)), true);
      assert.equal(ink(paper, 1, 2).min, 4);
    });

    it('should pad a row that is narrower than the paper', function() {
      const paper = stitch(render(stream(ESC, '@', enter, row([0xff]), executeEOT, quit)), {width: WIDTH});

      assert.equal(paper.width, WIDTH);
      assert.deepEqual(ink(paper, 0, 1), {min: 0, max: 7});
    });

    it('should not feed a row for the k command, so that the b behind it joins it', function() {
      const paper = stitch(render(stream(
          ESC, '@', enter, row([0xf0], false), row([0x00, 0x0f]), executeEOT, quit,
      )), {width: WIDTH});

      assert.equal(paper.height, 1);
      assert.deepEqual(ink(paper, 0, 1), {min: 0, max: 15});
    });

    it('should leave blank rows behind for ESC * r Y', function() {
      const paper = stitch(render(stream(
          ESC, '@', enter, row([0xff]), raster('Y', 8), row([0xff]), executeEOT, quit,
      )), {width: WIDTH});

      /* The b command has already moved to the next row, so the eight dots of
         the move are eight blank rows between the two rows of dots */

      assert.equal(paper.height, 10);
      assert.equal(ink(paper, 1, 9).min, -1);
      assert.equal(ink(paper, 9, 10).min, 0);
    });

    it('should place the rows at the left margin', function() {
      const paper = stitch(render(stream(
          ESC, '@', enter, raster('ml', 2), row([0xff]), executeEOT, quit,
      )), {width: WIDTH});

      assert.deepEqual(ink(paper, 0, 1), {min: 16, max: 23});
    });

    it('should read b and k as text outside raster mode', function() {
      const text = render(stream(ESC, '@', 'bk', LF));
      const plain = render(stream(ESC, '@', 'bk', LF));

      assert.equal(dots(stitch(text, {width: WIDTH})), dots(stitch(plain, {width: WIDTH})));
      assert.equal(stitch(text, {width: WIDTH}).height, 32);
    });

    it('should read b as text again after ESC * r B', function() {
      const paper = stitch(render(stream(ESC, '@', enter, quit, 'b', LF)), {width: WIDTH});

      assert.equal(paper.height, 32);
    });

    const cuts = [
      [1, null],
      [3, 'partial'],
      [8, 'full'],
      [9, 'full'],
      [12, 'partial'],
      [13, 'partial'],
      [32, null],
    ];

    for (const [mode, value] of cuts) {
      it(`should ${value ? `cut ${value}` : 'print without cutting'} in FF mode ${mode}`, function() {
        const items = render(stream(
            ESC, '@', enter, raster('F', mode), row([0xff]), executeFF, quit,
        ), {commands: COMMANDS});

        assert.deepEqual(
            commands(items),
            value ? [{type: 'cut', value}] : [],
        );
      });
    }

    it('should cut in the EOT mode for ESC FF EOT', function() {
      const items = render(stream(
          ESC, '@', enter, raster('E', 9), raster('F', 1), row([0xff]), executeEOT, quit,
      ), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'cut', value: 'full'}]);
    });

    it('should cut a model with a cutter by default', function() {
      const items = render(stream(ESC, '@', enter, row([0xff]), executeFF, quit), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'cut', value: 'partial'}]);
    });

    it('should do nothing when the image buffer is empty', function() {
      const items = render(stream(ESC, '@', enter, raster('F', 9), executeFF, quit), {commands: COMMANDS});

      assert.deepEqual(items, []);
    });

    it('should throw the buffer away with ESC * r C', function() {
      const items = render(stream(
          ESC, '@', enter, row([0xff]), [ESC, 0x2a, 0x72, 0x43], executeEOT, quit,
      ), {commands: COMMANDS});

      assert.deepEqual(items, []);
    });

    it('should open a drawer with ESC * r D', function() {
      const items = render(stream(
          ESC, '@', ESC, 0x07, 10, 50, enter, raster('D', 1), quit,
      ), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'pulse', device: 0, on: 100, off: 500}]);
    });

    it('should open the second drawer with ESC * r D 2', function() {
      const items = render(stream(ESC, '@', enter, raster('D', 2), quit), {commands: COMMANDS});

      assert.deepEqual(commands(items), [{type: 'pulse', device: 1, on: 200, off: 200}]);
    });

    it('should open both drawers with ESC * r D 3', function() {
      const items = render(stream(ESC, '@', enter, raster('D', 3), quit), {commands: COMMANDS});

      assert.deepEqual(commands(items).map((item) => item.device), [0, 1]);
    });

    it('should print the rows in front of a drawer command', function() {
      const items = render(stream(
          ESC, '@', enter, row([0xff]), raster('D', 1), executeEOT, quit,
      ), {commands: COMMANDS});

      assert.deepEqual(items.map((item) => item.type), ['image', 'pulse']);
    });

    it('should print what is left in the buffer when the stream ends', function() {
      const paper = stitch(render(stream(ESC, '@', enter, row([0xff]))), {width: WIDTH});

      assert.equal(paper.height, 1);
    });

    it('should print what is left in the buffer when raster mode is left', function() {
      const items = render(stream(
          ESC, '@', enter, raster('E', 9), row([0xff]), quit,
      ), {commands: COMMANDS});

      assert.deepEqual(items.map((item) => item.type), ['image', 'cut']);
    });

    it('should stop cleanly on a truncated row command', function() {
      let items;

      assert.doesNotThrow(() => {
        items = render(stream(ESC, '@', enter, [0x62, 4, 0, 0xff]));
      });

      assert.deepEqual(items, []);
    });

    it('should keep the text in front of a truncated row command', function() {
      const items = render(stream(ESC, '@', 'Hi', LF, 'Ho', enter, [0x62, 4, 0, 0xff]));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF, 'Ho', LF)), {width: WIDTH})),
      );
    });

    it('should clamp a move that is larger than the paper can be', function() {
      let items;

      assert.doesNotThrow(() => {
        items = render(stream(
            ESC, '@', enter, row([0xff]), raster('Y', 900000000), executeEOT, quit,
        ), {commands: COMMANDS});
      });

      /* The row itself, and the move clamped to a sixteen bit dot count. The
         EOT mode of a model with a cutter is the partial cut it starts at */

      assert.deepEqual(commands(items), [
        {type: 'feed', height: 65535},
        {type: 'cut', value: 'partial'},
      ]);

      assert.equal(stitch(items, {width: WIDTH}).height, 65536);
    });

    it('should place the rows on the paper, not inside the margins of the line mode', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, 'l', 4, ESC, 'Q', 20, enter, row(new Array(72).fill(0xff)), executeEOT, quit,
      )), {width: WIDTH});

      assert.deepEqual(ink(paper, 0, 1), {min: 0, max: WIDTH - 1});
    });

    it('should cut in the default EOT mode when raster mode is left', function() {
      const items = render(stream(ESC, '@', enter, row([0xff]), quit), {commands: COMMANDS});

      /* The specification ends raster mode by executing the EOT mode when data
         is left, and a model with a cutter starts at the partial cut */

      assert.deepEqual(commands(items), [{type: 'cut', value: 'partial'}]);
    });

    it('should stop cleanly on a row command without its length', function() {
      assert.doesNotThrow(() => render(stream(ESC, '@', enter, [0x62, 4])));
    });

    const truncated = [
      ['ESC * r', [ESC, 0x2a, 0x72]],
      ['ESC * r F', [ESC, 0x2a, 0x72, 0x46, 0x31]],
      ['ESC * r m l', [ESC, 0x2a, 0x72, 0x6d, 0x6c, 0x31]],
      ['ESC FF', [ESC, 0x0c]],
      ['ESC W', [ESC, 0x57]],
      ['ESC h', [ESC, 0x68]],
      ['ESC _', [ESC, 0x5f]],
      ['ESC l', [ESC, 0x6c]],
      ['ESC Q', [ESC, 0x51]],
      ['ESC R', [ESC, 0x52]],
      ['ESC D', [ESC, 0x44, 10]],
      ['ESC GS BEL', [ESC, GS, 0x07, 1, 2]],
      ['ESC GS EM', [ESC, GS, 0x19, 0x11, 1, 2]],
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

    const lengths = [
      ['ESC W n', [ESC, 0x57, 0]],
      ['ESC h n', [ESC, 0x68, 0]],
      ['ESC _ n', [ESC, 0x5f, 0]],
      ['ESC l n', [ESC, 0x6c, 0]],
      ['ESC Q n', [ESC, 0x51, 0]],
      ['ESC R n', [ESC, 0x52, 0]],
      ['ESC D n1..nk NUL', [ESC, 0x44, 10, 20, 0x00]],
      ['ESC SP n', [ESC, 0x20, 0]],
      ['ESC * r R', [ESC, 0x2a, 0x72, 0x52]],
      ['ESC * r P n NUL', [ESC, 0x2a, 0x72, 0x50, 0x30, 0x00]],
      ['ESC * r m r n NUL', [ESC, 0x2a, 0x72, 0x6d, 0x72, 0x30, 0x00]],
      ['ESC FF NUL', [ESC, 0x0c, 0x00]],
    ];

    for (const [name, bytes] of lengths) {
      it(`should consume the arguments of ${name}`, function() {
        assert.equal(
            dots(stitch(render(stream(ESC, '@', bytes, 'Hi', LF)), {width: WIDTH})),
            dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
        );
      });
    }
  });

  describe('the image commands of section 13', function() {
    /* The same picture the ESC/POS image tests use: 16 by 24 dots, a whole
       number of bytes in both directions and different in every row and
       column, so that a transposed decoding shows up */

    const PICTURE_WIDTH = 16;
    const PICTURE_HEIGHT = 24;

    const raster = [];

    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      raster.push((y * 37 + 11) & 0xff, (y * 151 + 5) & 0xff);
    }

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

    /* ESC GS S m n1 n2 n3 n4 n5 d.., the width in bytes and the height in dots */

    const image = [PICTURE_WIDTH / 8, 0, PICTURE_HEIGHT, 0, 0];

    it('should draw the raster image as a block of its own', function() {
      const items = render(stream(ESC, '@', ESC, GS, 'S', 1, image, raster));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, PICTURE_HEIGHT);
      assert.equal(ink(stitch(items, {width: WIDTH}), 0, PICTURE_HEIGHT).max, PICTURE_WIDTH - 1);
    });

    it('should print the same dots as the column image of ESC X', function() {
      const image24 = render(stream(ESC, '@', ESC, GS, 'S', 1, image, raster));
      const strip = render(stream(ESC, '@', ESC, '0', ESC, 'X', [PICTURE_WIDTH, 0], columns, LF));

      assert.equal(
          dots(stitch(image24, {width: WIDTH})),
          dots(stitch(strip, {width: WIDTH})),
      );
    });

    it('should align the raster image the way ESC GS a says', function() {
      const paper = stitch(render(stream(
          ESC, '@', ESC, GS, 'a', 2, ESC, GS, 'S', 1, image, raster,
      )), {width: WIDTH});

      assert.equal(ink(paper, 0, PICTURE_HEIGHT).max, WIDTH - 1);
      assert.equal(ink(paper, 0, PICTURE_HEIGHT).min, WIDTH - PICTURE_WIDTH);
    });

    it('should commit the pending line before the image', function() {
      const items = render(stream(ESC, '@', 'Hi', ESC, GS, 'S', 1, image, raster));

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 32 + PICTURE_HEIGHT);
    });

    it('should take the ASCII digit of the mode as well', function() {
      assert.equal(
          dots(stitch(render(stream(ESC, '@', ESC, GS, 'S', 0x31, image, raster)), {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', ESC, GS, 'S', 1, image, raster)), {width: WIDTH})),
      );
    });

    it('should report a mode it does not know and consume the data', function() {
      const items = render(stream(
          ESC, '@', ESC, GS, 'S', 2, image, raster, 'Hi', LF,
      ), {commands: ['unknown']});

      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.equal(unknown[0].data.length, 3 + 6 + raster.length);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    /* ESC k carries a band of twenty four dot rows, the bytes of a row first,
       which is how receiptline prints its images in Star Line Mode, see the
       notes of section 16 */

    it('should draw the twenty four dot band of ESC k', function() {
      const band = new Array(PICTURE_WIDTH / 8 * 24).fill(0xff);

      const items = render(stream(ESC, '@', ESC, '0', ESC, 'k', [PICTURE_WIDTH / 8, 0], band, LF));
      const paper = stitch(items, {width: WIDTH});

      assert.equal(paper.height, 24);
      assert.equal(ink(paper, 0, 24).max, PICTURE_WIDTH - 1);
      assert.equal(ink(paper, 0, 24).min, 0);
    });

    it('should draw the rows of an ESC k band in raster order', function() {
      const width = 2;
      const band = new Array(width * 24).fill(0);

      band[0] = 0xff;

      const paper = stitch(render(stream(ESC, '@', ESC, '0', ESC, 'k', [width, 0], band, LF)), {width: WIDTH});

      assert.equal(ink(paper, 0, 1).max, 7);
      assert.equal(ink(paper, 1, 24).max, -1);
    });

    it('should print nothing for an ESC k band without dots', function() {
      const items = render(stream(ESC, '@', ESC, 'k', [0, 0], 'Hi', LF));

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing and report ESC FS p, the NV logo the printer holds', function() {
      const items = render(stream(ESC, '@', ESC, FS, 'p', 1, 0, 'Hi', LF), {commands: ['unknown']});
      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), [ESC, FS, 0x70, 1, 0]);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    it('should print nothing and report ESC FS q, the logo definition', function() {
      const definition = [ESC, FS, 0x71, 1, 1, 0, 1, 0, ...new Array(8).fill(0xff)];
      const items = render(stream(ESC, '@', definition, 'Hi', LF), {commands: ['unknown']});
      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), definition);

      assert.equal(
          dots(stitch(items, {width: WIDTH})),
          dots(stitch(render(stream(ESC, '@', 'Hi', LF)), {width: WIDTH})),
      );
    });

    const truncated = [
      ['ESC GS S without its size', [ESC, GS, 0x53, 1, 2, 0]],
      ['ESC GS S with data missing', [ESC, GS, 0x53, 1, 2, 0, 24, 0, 0, 0xff]],
      ['ESC k without its length', [ESC, 0x6b, 4]],
      ['ESC k with data missing', [ESC, 0x6b, 4, 0, 0xff]],
      ['ESC FS p', [ESC, FS, 0x70, 1]],
      ['ESC FS q without its count', [ESC, FS, 0x71]],
      ['ESC FS q with data missing', [ESC, FS, 0x71, 1, 1, 0, 1, 0, 0xff]],
      ['ESC b 10 without its record separator', [ESC, 0x62, 10, 1, 2, 60, 0x30, 0x39]],
      ['ESC b 11 without its record separator', [ESC, 0x62, 11, 1, 2, 60, 0x30, 0x39]],
      ['ESC b 12 without its record separator', [ESC, 0x62, 12, 1, 2, 60, 0x30, 0x39]],
      ['ESC b 13 without its record separator', [ESC, 0x62, 13, 1, 2, 60, 0x28, 0x30, 0x31, 0x29]],
      ['ESC b 13 without its parameters', [ESC, 0x62, 13, 1]],
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
