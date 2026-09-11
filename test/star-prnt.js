import StarPrntRenderer from '../src/renderers/star-prnt.js';
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
const LF = 0x0a;
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
          const paper = stitch(render(expected.bytes, {commands: COMMANDS}), WIDTH);

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
      const bold = stitch(render(stream(ESC, '@', ESC, 'E', 'H', LF)), WIDTH);
      const normal = stitch(render(stream(ESC, '@', ESC, 'E', ESC, 'F', 'H', LF)), WIDTH);

      assert.notEqual(dots(bold), dots(normal));
      assert.equal(dots(normal), dots(stitch(render(stream(ESC, '@', 'H', LF)), WIDTH)));
    });

    it('should switch invert on with ESC 4 and off with ESC 5', function() {
      const inverted = stitch(render(stream(ESC, '@', ESC, '4', 'H', LF)), WIDTH);
      const normal = stitch(render(stream(ESC, '@', ESC, '4', ESC, '5', 'H', LF)), WIDTH);

      /* An inverted cell is black where the glyph is white, so the first dot of
         the line is ink */

      assert.equal(Bitmap.getPixel(inverted, 0, 0), 1);
      assert.equal(Bitmap.getPixel(normal, 0, 0), 0);
    });

    it('should draw an underline one dot thick with ESC - 1', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, '-', 1, 'Hi', LF)), WIDTH);

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
      const paper = stitch(render(stream(ESC, '@', ESC, GS, 'a', 2, 'Hi', LF)), WIDTH);

      assert.isAtLeast(ink(paper, 0, 32).min, 552);
      assert.isAtLeast(ink(paper, 0, 32).max, 564);
    });

    it('should centre a short line with ESC GS a', function() {
      const paper = stitch(render(stream(ESC, '@', ESC, GS, 'a', 1, 'Hi', LF)), WIDTH);

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
      const wide = stitch(render(stream(ESC, '@', 'H'.repeat(48), LF)), WIDTH);
      const narrow = stitch(render(stream(ESC, '@', ESC, RS, 'F', 1, 'H'.repeat(48), LF)), WIDTH);

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
      const wide = stitch(render(stream(ESC, '@', ESC, 'i', 0, 1, 'H', LF)), WIDTH);
      const normal = stitch(render(stream(ESC, '@', 'H', LF)), WIDTH);

      assert.equal(Bitmap.getPixel(wide, 2, 10), 1);
      assert.equal(Bitmap.getPixel(wide, 3, 10), 1);
      assert.equal(Bitmap.getPixel(normal, 3, 10), 0);
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

      const left = stitch(render(stream(ESC, '@', ESC, GS, 't', 1, [0x82], LF)), WIDTH);
      const right = stitch(render(stream(ESC, '@', ESC, GS, 't', 32, [0xe9], LF)), WIDTH);

      assert.equal(dots(left), dots(right));
    });

    it('should not decode the Star standard character set as cp437', function() {
      const standard = stitch(render(stream(ESC, '@', [0x82], LF)), WIDTH);
      const cp437 = stitch(render(stream(ESC, '@', ESC, GS, 't', 1, [0x82], LF)), WIDTH);

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
      const unknown = render(stream(ESC, '@', 'A', ESC, 'W', 1, 'B', LF));

      assert.equal(dots(stitch(unknown, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should report the bytes of the command when unknown is supported', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'W', 1, 'B', LF), {commands: ['unknown']});
      const unknown = items.filter((item) => item.type === 'unknown');

      assert.equal(unknown.length, 1);
      assert.deepEqual(Array.from(unknown[0].data), [ESC, 0x57, 1]);
    });

    it('should drop the command when unknown is not supported', function() {
      const items = render(stream(ESC, '@', 'A', ESC, 'W', 1, 'B', LF));

      assert.isTrue(items.every((item) => item.type === 'image'));
    });

    it('should consume only the prefix of a command it has no length for', function() {
      const items = render(stream(ESC, '@', ESC, 0x03, 'Hi', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, 0x03],
      );

      assert.equal(dots(stitch(items, WIDTH)), dots(stitch(render(stream(ESC, '@', 'Hi', LF)), WIDTH)));
    });

    it('should consume the prefix of an unknown command of the ESC GS group', function() {
      const items = render(stream(ESC, '@', ESC, GS, 0x7f, 'Hi', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, GS, 0x7f],
      );

      assert.equal(dots(stitch(items, WIDTH)), dots(stitch(render(stream(ESC, '@', 'Hi', LF)), WIDTH)));
    });

    it('should consume the argument of an unknown command of the ESC RS group', function() {
      const items = render(stream(ESC, '@', 'A', ESC, RS, 'r', 2, 'B', LF), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, RS, 0x72, 2],
      );

      assert.equal(
          dots(stitch(items, WIDTH)),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), WIDTH)),
      );
    });

    it('should consume the automatic status command of the ESC GS group', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, GS, [0x03], 's', [1, 0], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should consume the tab positions of ESC D', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, 'D', [10, 20, 30, 0], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should consume the data of a bit image command', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, 'K', [6, 0], [1, 2, 3, 4, 5, 6], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should consume the mode byte of ESC FF', function() {
      /* ESC FF EM prints the buffer, and the EM of the mode must not open a
         drawer */

      const items = render(stream(ESC, '@', 'A', ESC, 0x0c, EM, 'B', LF), {commands: ['pulse']});

      assert.isTrue(items.every((item) => item.type !== 'pulse'));
      assert.equal(items.length, 1);
      assert.equal(
          dots(stitch(items, WIDTH)),
          dots(stitch(render(stream(ESC, '@', 'AB', LF)), WIDTH)),
      );
    });

    it('should consume an ESC * that is not the raster group', function() {
      const items = render(stream(ESC, '@', 'A', ESC, '*', 'Q'), {commands: ['unknown']});

      assert.deepEqual(
          Array.from(items.find((item) => item.type === 'unknown').data),
          [ESC, 0x2a, 0x51],
      );

      assert.equal(
          dots(stitch(items, WIDTH)),
          dots(stitch(render(stream(ESC, '@', 'A', LF)), WIDTH)),
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

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
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

  describe('blocks that are skipped in this section', function() {
    it('should stay in sync over a barcode', function() {
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, 'b', [6, 2, 2, 40], '12345', [RS], 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a QR code', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const skipped = render(stream(
          ESC, '@', 'A',
          ESC, GS, 'yS', [0x30, 0x02],
          ESC, GS, 'yS', [0x32, 0x04],
          ESC, GS, 'yS', [0x31, 0x01],
          ESC, GS, 'yD', [0x31, 0x00, 4, 0], 'test',
          ESC, GS, 'yP',
          'B', LF,
      ));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a PDF417', function() {
      const known = render(stream(ESC, '@', 'AB', LF));

      const skipped = render(stream(
          ESC, '@', 'A',
          ESC, GS, 'xS', [0x30, 0x01, 0, 0],
          ESC, GS, 'xS', [0x32, 0x03],
          ESC, GS, 'xS', [0x33, 0x03],
          ESC, GS, 'xS', [0x31, 0x01],
          ESC, GS, 'xD', [4, 0], 'test',
          ESC, GS, 'xP',
          'B', LF,
      ));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
    });

    it('should stay in sync over a column image', function() {
      const data = new Array(24 * 3).fill(0xff);
      const known = render(stream(ESC, '@', 'AB', LF));
      const skipped = render(stream(ESC, '@', 'A', ESC, 'X', [24, 0], data, 'B', LF));

      assert.equal(dots(stitch(skipped, WIDTH)), dots(stitch(known, WIDTH)));
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

      assert.equal(dots(stitch(dropped, WIDTH)), dots(stitch(supported, WIDTH)));
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

      /* The eight dots below a line of text are blank as well, so they belong
         to the run that follows them. The cut of this receipt is not supported
         here, so it does not end a segment and the blank rows on both sides of
         it are one run */

      assert.deepEqual(
          items.map((item) => `${item.type}:${item.height}`),
          ['image:24', 'feed:108', 'image:20', 'feed:232'],
      );
    });

    it('should print the same paper either way', function() {
      const bytes = fixture('star-prnt', 'feed').bytes;

      assert.equal(
          dots(stitch(render(bytes, {commands: ['feed']}), WIDTH)),
          dots(stitch(render(bytes), WIDTH)),
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
        assert.equal(dots(stitch(split, WIDTH)), dots(stitch(whole, WIDTH)));
      });
    }
  });
});
