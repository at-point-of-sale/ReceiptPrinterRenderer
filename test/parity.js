import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import {stitch} from '../src/formats/stitch.js';
import {commands} from './helpers/items.js';
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

    There are two exceptions, the hri and the pdf417-truncated fixture, which
    the EXCEPTIONS table below names with their reason. Every other difference
    the encoder produces between the two languages is avoided by the fixture
    receipts, and each of those is listed here with the reason:

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
      for StarPRNT and passes it through for ESC/POS, where the printer picks
      the code sets itself. The code128 fixture uses two values that both
      encodings agree on, {BABC-123 and {C1234, so the bars are the same.

    - The module width of a barcode. The encoder writes its width option, 1 to
      3, as n3 on StarPRNT and as GS w n on ESC/POS, where n is the option plus
      one for most symbologies, twice the option for ITF and the option itself
      for GS1-128 and the GS1 DataBar family. The renderer reads a Star n3 of
      1, 2 or 3 as 2, 3 or 4 dots, so the two languages draw the same barcode
      for every symbology but those, and the ITF fixture uses width 1, where
      twice the option and the option plus one are both two dots. GS1-128 is
      addressed by its number instead of by its name, which is what the encoder
      needs anyway for a printer it knows nothing about, and the number takes
      the same path as the other symbologies.

    - The truncated form of a PDF417. ESC/POS asks for it with GS ( k 48 70 1,
      and the StarPRNT command set has no command for the form of the symbol at
      all, so the encoder drops the option there and a Star printer prints the
      standard symbol. The pdf417 fixture, which does not use the option, has
      parity; the pdf417-truncated one is in the exceptions below.

    - The human readable text of a barcode. ESC/POS has GS f to choose the font
      of it and StarPRNT does not, a Star printer always draws it in font A.
      The hri fixture prints the same barcode with the text in font A and in
      font B, so it is the one fixture where the two languages differ, see the
      exceptions below.

    - Images. The encoder has a raster mode and a column mode for ESC/POS and
      only a column mode for StarPRNT, where the imageMode option is ignored.
      The image-raster fixture is therefore a GS v 0 raster image on ESC/POS and
      the same ESC X strips as the image-column fixture on StarPRNT. Both print
      the same dots on the same rows, so parity holds without an exception.

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

/*
    The fixtures whose two renders are not the same, with the reason. Every one
    of them is a difference the encoder or the printer makes, not the renderer.
*/

const EXCEPTIONS = {
  'hri': 'the third barcode prints its human readable text in font B, which only ESC/POS can select',
  'pdf417-truncated': 'the truncated form of a PDF417 is an ESC/POS option, StarPRNT has no command for it',
};

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
      it(EXCEPTIONS[name] ?
        `should differ in the two languages, because ${EXCEPTIONS[name]}` :
        'should render the same paper in both languages', function() {
        const left = new EscPosRenderer(OPTIONS).render(fixture('esc-pos', name).bytes);
        const right = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);

        const paper = {
          'esc-pos': stitch(left, {width: WIDTH}),
          'star-prnt': stitch(right, {width: WIDTH}),
        };

        if (EXCEPTIONS[name]) {
          assert.notEqual(dots(paper['esc-pos']), dots(paper['star-prnt']));
          return;
        }

        if (dots(paper['esc-pos']) !== dots(paper['star-prnt'])) {
          assert.fail(
              `${name} renders differently in the two languages\n` +
            diff(paper['star-prnt'], paper['esc-pos']),
          );
        }
      });

      it(EXCEPTIONS[name] ?
        'should emit the same commands in both languages, apart from the height of a feed' :
        'should emit the same commands in both languages', function() {
        const left = new EscPosRenderer(OPTIONS).render(fixture('esc-pos', name).bytes);
        const right = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);

        /* The exception prints its last line of text in another font, and the
           two fonts do not put their deepest ink on the same row, so the blank
           run that follows it, and with it the feed item, is a dot longer in
           one language than in the other. The commands themselves are the same */

        if (EXCEPTIONS[name]) {
          const shape = (item) => item.type === 'feed' ? {type: item.type} : item;

          assert.deepEqual(commands(right).map(shape), commands(left).map(shape));
          return;
        }

        assert.deepEqual(commands(right), commands(left));
      });
    });
  }
});

describe('parity of the hand assembled fixtures', function() {
  /*
      The fixtures of test/tools/make-fixtures.js that are written by hand
      exist in the language that has the command, so only the ones that exist
      in both are compared here: the print mode against the individual Star
      commands, the international character sets both languages number the same
      way, the tab stops, which are the same command in both, and the margins,
      which ESC/POS counts in dots and StarPRNT in characters.
  */

  const shared = names('esc-pos/raw').filter((name) => names('star-prnt/raw').includes(name));

  it('should have fixtures in both languages to compare', function() {
    assert.deepEqual(shared, ['international', 'margins', 'print-mode', 'tabs']);
  });

  for (const name of shared) {
    it(`should render ${name} the same in both languages`, function() {
      const left = new EscPosRenderer(OPTIONS).render(fixture('esc-pos/raw', name).bytes);
      const right = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt/raw', name).bytes);

      const paper = {
        'esc-pos': stitch(left, {width: WIDTH}),
        'star-prnt': stitch(right, {width: WIDTH}),
      };

      if (dots(paper['esc-pos']) !== dots(paper['star-prnt'])) {
        assert.fail(
            `${name} renders differently in the two languages\n` +
          diff(paper['star-prnt'], paper['esc-pos']),
        );
      }

      assert.deepEqual(commands(right), commands(left));
    });
  }
});
