import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import {stitch, commands} from './helpers/stitch.js';
import {names, fixture} from './helpers/fixtures.js';
import {diff} from './helpers/ascii.js';
import {assert} from 'chai';

/*
    Parity.

    Every fixture receipt of test/tools/make-fixtures.js is encoded twice, once
    in ESC/POS and once in StarPRNT. The same receipt must come out of both
    renderers as the same paper and the same commands. This is the test the
    design document asks for, and the reason the two renderers were built
    together: it is the only thing that proves the painter is language neutral
    instead of shaped after one of the two parsers.

    The two languages differ in things that are printer defaults rather than
    content, the line spacing of 30 against 32 dots and the font B cell of
    9 by 17 against 9 by 24, so both renders use the same profile. That is what
    the design's Testing section prescribes.

    There are no exceptions. The differences the encoder does produce between
    the two languages are avoided by the fixture receipts, and each of them is
    listed below with the reason:

    - Italic. The encoder emits ESC 4 n for ESC/POS and nothing for StarPRNT.
      No difference on paper: Epson hardware does not italicize either and the
      ESC/POS renderer parses the command and ignores it, as the design says.

    - The codepage the printer starts in. ESC/POS printers start in cp437,
      Star printers in the Star standard character set, which has no horizontal
      box drawing line. The receipts that draw boxes and rules select cp437,
      which changes nothing in the ESC/POS encoding.

    - autoFlush. For StarPRNT the encoder ends a job that does not end in a cut
      or a pulse with ESC GS P 0 and ESC GS P 1, on a line of their own, which
      adds a blank line the ESC/POS encoding does not have. It is a property of
      the job and not of the receipt, so the fixtures are encoded with
      autoFlush off. The renderer parses both commands and ignores them, see
      test/star-prnt.js.

    - Code 128 code set selection. The encoder strips the {A, {B and {C prefix
      for StarPRNT and passes it through for ESC/POS. No fixture in this
      section prints a barcode, the block fixtures of section 4 have to take
      this up again.

    - Character sizes of seven and eight. The encoder accepts size(1..8) for
      every language, but it only fits on ESC/POS: GS ! carries multipliers of
      1 to 8 and ESC i only defines 1 to 6, so a Star printer leaves the size
      alone for the two it has no value for. This is a divergence by encoder
      design and the renderers are faithful to their own hardware on both
      sides. The sizes fixture goes up to three, as a receipt does.

    - A pulse to the second drawer. ESC p carries the times for either drawer,
      while on StarPRNT only ESC BEL, and with it BEL and FS, carries a width:
      SUB and EM pulse the second drawer for the fixed 200 ms on and 200 ms off
      of the Star specification. A pulse to device 0 therefore survives a round
      trip through both languages and one to device 1 only does when the times
      are 200 and 200. The pulse fixture opens drawer 0, which is what the
      encoder's own default is.
*/

const WIDTH = 576;
const COMMANDS = ['cut', 'pulse', 'feed'];

/* The same printer family defaults for both renderers, so that only the
   languages differ */

const OPTIONS = {width: WIDTH, profile: 'epson', commands: COMMANDS};

/**
 * The dots of a bitmap, as a string, so that two renders can be compared
 *
 * @param  {object}   bitmap   The bitmap
 * @return {string}            The dots
 */
function dots(bitmap) {
  return `${bitmap.width}x${bitmap.height}:${Array.from(bitmap.data).join(',')}`;
}

describe('parity between the renderers', function() {
  it('should have a StarPRNT fixture for every ESC/POS fixture', function() {
    assert.deepEqual(names('star-prnt'), names('esc-pos'));
  });

  for (const name of names('esc-pos')) {
    describe(name, function() {
      it('should render the same paper in both languages', function() {
        const left = new EscPosRenderer(OPTIONS).render(fixture('esc-pos', name).bytes);
        const right = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);

        const paper = {
          'esc-pos': stitch(left, WIDTH),
          'star-prnt': stitch(right, WIDTH),
        };

        if (dots(paper['esc-pos']) !== dots(paper['star-prnt'])) {
          assert.fail(
              `${name} renders differently in the two languages\n` +
            diff(paper['star-prnt'], paper['esc-pos']),
          );
        }
      });

      it('should emit the same commands in both languages', function() {
        const left = new EscPosRenderer(OPTIONS).render(fixture('esc-pos', name).bytes);
        const right = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);

        assert.deepEqual(commands(right), commands(left));
      });
    });
  }
});
