import {createRequire} from 'node:module';

import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {
  databarOmni, databarTruncated, databarLimited, databarExpanded,
} from '../src/symbologies/databar.js';
import {toPattern} from '../src/symbologies/pattern.js';
import {fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/*
    GS1 DataBar, against a second encoder and a reader.

    bwip-js and @zxing/library are dev dependencies of this file and of
    test/pdf417.js.

    bwip-js is the reference encoder. Its raw output for a linear symbology is
    the widths of the elements, space and bar by turns, which is the same shape
    this package produces, so the comparison covers everything below the data:
    the character set tables, the combination the value of a character selects,
    the checksum, the finder patterns it picks, the compaction of an element
    string and the layout of the symbol. It runs over a batch of values per
    variant, and over the symbols that come off the paper of the fixtures.

    Its GS1 linter is turned off. It refuses element strings that no shop would
    print, a coupon without a GTIN in front of it for instance, but a printer
    encodes whatever the stream asks for, so the test compares the symbols of
    the element strings this package accepts.

    The reader of ZXing reads the rendered receipt the way a scanner reads the
    paper, with the white margin around it that the printer does not print.
    RSS14Reader reads Omnidirectional and Truncated, which are the same bars.

    Two variants have no reader here:

    - Limited. ZXing has no reader for it at all, so it is checked against
      bwip-js only.

    - Expanded. ZXing has RSSExpandedReader, but the port of it in
      @zxing/library 0.21.3 cannot read a symbol at all: its checkChecksum()
      calls the methods of a Java List on a plain array, its
      decodeDataCharacter() indexes the group tables with a number that is
      never a whole one, and the decoders behind them append the digits of a
      value with the string builder that turns a number into the character of
      that code point. It reads none of the symbols bwip-js produces either,
      which is how the fault was placed with the reader and not with this
      encoder. Expanded is therefore checked against bwip-js only, over every
      encodation method of the specification.

    The finder pattern search of RSS14Reader is a heuristic that a data
    character now and then satisfies before the finder does, and the reader
    gives up instead of looking further; the values below are ones it reads,
    and the symbols bwip-js produces for the values it does not read are
    equally unreadable to it.
*/

const require = createRequire(import.meta.url);

const bwipjs = require('bwip-js');
const {
  RSS14Reader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType,
} = require('@zxing/library');

const WIDTH = 576;
const MARGIN = 16;

const ESC = 0x1b;
const GS = 0x1d;
const RS = 0x1e;

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
 * The modules of a symbol, as this package encodes it, without the quiet zones
 *
 * @param  {object|null}   code   The barcode of a generator
 * @return {string|null}          The modules, '1' is a bar and '0' is a space
 */
function modules(code) {
  return code === null ? null : toPattern(code.bars).replace(/^0+/, '').replace(/0+$/, '');
}

/**
 * The modules of a symbol, as bwip-js encodes it
 *
 * @param  {string}   symbology   The name bwip-js knows the variant by
 * @param  {string}   data        The element string, with its identifiers in parentheses
 * @return {string}               The modules, '1' is a bar and '0' is a space
 */
function reference(symbology, data) {
  const elements = bwipjs.raw(symbology, data, {dontlint: true, lintreqs: false})[0].sbs;

  let pattern = '';

  for (let index = 0; index < elements.length; index++) {
    pattern += (index % 2 ? '0' : '1').repeat(elements[index]);
  }

  return pattern.replace(/^0+/, '').replace(/0+$/, '');
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
 * The modules of the bars on the first row of a bitmap, from the first black
 * dot to the last one
 *
 * @param  {object}   bitmap        The paper
 * @param  {number}   moduleWidth   Width of a module in dots
 * @return {string}                 The modules, '1' is a bar and '0' is a space
 */
function read(bitmap, moduleWidth) {
  let first = -1;
  let last = -1;

  for (let x = 0; x < bitmap.width; x++) {
    if (Bitmap.getPixel(bitmap, x, 0)) {
      first = first < 0 ? x : first;
      last = x;
    }
  }

  assert.isAtLeast(first, 0, 'the row has no bars on it');
  assert.equal((last - first + 1) % moduleWidth, 0, 'the bars are not a whole number of modules wide');

  let result = '';

  for (let x = first; x <= last; x += moduleWidth) {
    for (let dot = 0; dot < moduleWidth; dot++) {
      assert.equal(
          Bitmap.getPixel(bitmap, x + dot, 0),
          Bitmap.getPixel(bitmap, x, 0),
          `the module at ${x} is not ${moduleWidth} dots wide`,
      );
    }

    result += Bitmap.getPixel(bitmap, x, 0) ? '1' : '0';
  }

  return result;
}

/**
 * Read a bitmap with the RSS-14 reader, with a white margin around it
 *
 * @param  {object}        bitmap   The paper
 * @return {string|null}            The value of the symbol, or null when there is none
 */
function scan(bitmap) {
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
    return new RSS14Reader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch (error) {
    return null;
  }
}

/* The GTINs the RSS-14 tests encode, of which the first is the example of the
   specification. The value is thirteen digits, the printer adds the check
   digit, and the fourteenth digit of each is the one it computes */

const GTINS = [
  ['0952123454321', '09521234543213'],
  ['0000000000000', '00000000000000'],
  ['0000000000001', '00000000000017'],
  ['1234567890128', '12345678901286'],
  ['9501101530003', '95011015300038'],
  ['7350053850019', '73500538500196'],
  ['4012345678901', '40123456789010'],
  ['9999999999999', '99999999999997'],
];

/* The GTINs of Limited, which only carries the ones that start with a zero or
   a one */

const LIMITED = [
  '0123456789012',
  '0000000000000',
  '0952123454321',
  '1999999999999',
  '1000000000000',
  '0614141999996',
];

/* The element strings of Expanded, one for every encodation method of the
   specification: the general purpose method, the (01) method with the field
   behind it, the compressed weight of AI (3103) and of AI (3202), the seven
   bit methods of a weight of AI (310x) or (320x) with and without a date, the
   price and the rate of AI (392x) and AI (393x), and the identifiers of the
   31xx and 32xx blocks that no compressed method holds */

const ELEMENTS = [
  '(01)90614141000015(3103)000123',
  '(01)09501101530003(17)140917',
  '(01)90012345678908(3103)001750',
  '(01)90614141000015(3202)000100',
  '(01)90614141000015(3203)000100',
  '(01)90614141000015(3105)012345',
  '(01)90614141000015(3204)000100',
  '(01)90614141000015(3109)000001',
  '(01)90614141000015(3103)001234(11)990201',
  '(01)90614141000015(3202)001234(13)991231',
  '(01)90614141000015(3103)099999(15)000101',
  '(01)90614141000015(3203)001234(17)251231',
  '(01)90614141000015(3106)000500(11)251001',
  '(01)90614141000015(3208)001000(17)991231',
  '(01)90614141000015(3100)123456',
  '(01)90614141000015(3123)012345',
  '(01)90614141000015(3160)012345',
  '(01)90614141000015(3210)000100',
  '(01)90614141000015(3199)000100(11)990201',
  '(01)90614141000015(3922)795',
  '(01)90614141000015(3932)0401234',
  '(01)00012345678905',
  '(01)90614141000015(10)ABC123',
  '(01)90614141000015(21)SN12345678(10)LOT99',
  '(00)123456789012345675',
  '(10)LOT-99',
  '(240)ABC-123',
  '(8110)106141410123456101100',
  '(10)abc/def',
  '(15)991231(10)AB-12',
];

describe('GS1 DataBar', function() {
  describe('Omnidirectional and Truncated', function() {
    for (const [data] of GTINS) {
      it(`should encode ${data} as the reference does`, function() {
        assert.equal(modules(databarOmni(data)), reference('databaromni', `(01)${data}`));
      });
    }

    it('should draw the same bars for Truncated', function() {
      for (const [data] of GTINS) {
        assert.equal(modules(databarTruncated(data)), modules(databarOmni(data)));
        assert.equal(modules(databarTruncated(data)), reference('databartruncated', `(01)${data}`));
      }
    });

    it('should be ninety six modules, of which ninety five are printed', function() {
      for (const [data] of GTINS) {
        assert.equal(modules(databarOmni(data)).length, 95);
      }
    });

    it('should take the check digit when the data carries it', function() {
      for (const [data, printed] of GTINS) {
        assert.isNotNull(databarOmni(printed));
        assert.equal(modules(databarOmni(printed)), modules(databarOmni(data)));
      }
    });

    it('should print the element string below the bars', function() {
      for (const [data, printed] of GTINS) {
        assert.equal(databarOmni(data).text, `(01)${printed}`);
        assert.equal(databarTruncated(data).text, `(01)${printed}`);
      }
    });

    it('should ask for the heights of the specification', function() {
      assert.deepEqual(databarOmni('0952123454321').height, {minimum: 33});
      assert.deepEqual(databarTruncated('0952123454321').height, {fixed: 13});
    });

    it('should refuse data that is not thirteen or fourteen digits', function() {
      for (const data of ['', '123', '095212345432', '095212345432100', '09521234A4321']) {
        assert.isNull(databarOmni(data), data);
        assert.isNull(databarTruncated(data), data);
      }
    });

    it('should refuse a check digit that is not the right one', function() {
      assert.isNull(databarOmni('09521234543210'));
      assert.isNull(databarTruncated('09521234543210'));
    });
  });

  describe('Limited', function() {
    for (const data of LIMITED) {
      it(`should encode ${data} as the reference does`, function() {
        assert.equal(modules(databarLimited(data)), reference('databarlimited', `(01)${data}`));
      });
    }

    it('should be seventy nine modules, of which seventy three are printed', function() {
      for (const data of LIMITED) {
        assert.equal(modules(databarLimited(data)).length, 73);
      }
    });

    it('should ask for the height of the specification', function() {
      assert.deepEqual(databarLimited('0123456789012').height, {fixed: 10});
    });

    it('should refuse a GTIN that does not start with a zero or a one', function() {
      for (const data of ['2000000000000', '9501101530003', '4012345678901']) {
        assert.isNull(databarLimited(data), data);
      }
    });

    it('should refuse data that is not a GTIN', function() {
      for (const data of ['', '012345678901', '012345678901234', '01234567A9012', '01234567890123']) {
        assert.isNull(databarLimited(data), data);
      }
    });
  });

  describe('Expanded', function() {
    for (const data of ELEMENTS) {
      it(`should encode ${data} as the reference does`, function() {
        assert.equal(modules(databarExpanded(data)), reference('databarexpanded', data));
      });
    }

    it('should encode the element strings of a batch of values as the reference does', function() {
      /* A run of values per encodation method, so that the comparison covers
         more than the characters of the examples: the weight and the date of
         the compressed methods, and the numeric, alphanumeric and ISO 646
         compaction of the general purpose field with every run length that
         decides a latch */

      const values = [];

      for (let index = 0; index < 20; index++) {
        const gtin = `9${String(index * 4937).padStart(13, '0')}`;

        values.push(`(01)${gtin}(3103)${String(index * 1723).padStart(6, '0')}`);
        values.push(`(01)${gtin}(3202)${String(index * 431).padStart(6, '0')}`);
        values.push(`(10)${'1'.repeat(index + 1)}`);
        values.push(`(10)${'AB12-C'.repeat(index % 4 + 1)}`);
        values.push(`(240)${'abc'.repeat(index % 4 + 1)}${index}`);
        values.push(`(01)${gtin}(10)${'X'.repeat(index % 6 + 1)}`);
      }

      /* The whole 31xx and 32xx space, with and without a date: only (310x)
         and (320x) have a seven bit method, every other identifier of the two
         blocks goes through the general purpose field, and the reference is
         the encoder that decides which */

      for (let block = 31; block <= 32; block++) {
        for (let third = 0; third <= 9; third++) {
          for (let fourth = 0; fourth <= 9; fourth++) {
            const identifier = `${block}${third}${fourth}`;
            const gtin = `9061414100001${(third + fourth) % 10}`;

            values.push(`(01)${gtin}(${identifier})012345`);
            values.push(`(01)${gtin}(${identifier})000100(11)990201`);
            values.push(`(01)${gtin}(${identifier})099999(17)251231`);
            values.push(`(01)${gtin}(${identifier})123456`);
          }
        }
      }

      let compared = 0;

      for (const value of values) {
        const code = databarExpanded(value);

        if (code === null) {
          continue;
        }

        assert.equal(modules(code), reference('databarexpanded', value), value);
        compared++;
      }

      assert.isAtLeast(compared, 900);
    });

    it('should use a compressed method for the weight of (310x) and (320x) only', function() {
      /* The seven bit methods carry the weight of AI (3100) to (3109) and of
         AI (3200) to (3209). An identifier of the 31xx or 32xx block that is
         not one of those twenty carries its weight through the general purpose
         field instead, and the reference encoder is the one that decides which
         of the two a value takes: a symbol encoded the other way is a
         different symbol, so these comparisons are what pins the range */

      const pairs = [
        ['(01)90614141000015(3105)012345', '(01)90614141000015(3123)012345'],
        ['(01)90614141000015(3204)000100', '(01)90614141000015(3210)000100'],
        ['(01)90614141000015(3109)099999', '(01)90614141000015(3160)099999'],
        ['(01)90614141000015(3103)001234(11)990201', '(01)90614141000015(3133)001234(11)990201'],
        ['(01)90614141000015(3203)001234(17)251231', '(01)90614141000015(3253)001234(17)251231'],
      ];

      for (const [compressed, general] of pairs) {
        assert.equal(modules(databarExpanded(compressed)), reference('databarexpanded', compressed), compressed);
        assert.equal(modules(databarExpanded(general)), reference('databarexpanded', general), general);

        assert.isAtMost(
            modules(databarExpanded(compressed)).length,
            modules(databarExpanded(general)).length,
            `${compressed} should not be a wider symbol than ${general}`,
        );
      }

      /* An identifier with a date behind it shows the difference on the paper:
         the compressed method holds the weight and the date in the method
         itself, the general one spells both of them out */

      for (const [compressed, general] of pairs.slice(3)) {
        assert.isBelow(
            modules(databarExpanded(compressed)).length,
            modules(databarExpanded(general)).length,
            `${compressed} should be a smaller symbol than ${general}`,
        );
      }
    });

    it('should print the element string below the bars', function() {
      assert.equal(databarExpanded(ELEMENTS[0]).text, ELEMENTS[0]);
    });

    it('should ask for the height of the specification', function() {
      assert.deepEqual(databarExpanded(ELEMENTS[0]).height, {minimum: 34});
    });

    it('should refuse an element string it cannot read', function() {
      for (const data of [
        '',
        '0190614141000015',
        '(01',
        '(01)',
        '(1)90614141000015',
        '(012345)90614141000015',
        '(0A)90614141000015',
        '(01)90614141000015(10)',
      ]) {
        assert.isNull(databarExpanded(data), JSON.stringify(data));
      }
    });

    it('should refuse a character no compaction method holds', function() {
      assert.isNull(databarExpanded('(10)AB@CD'));
      assert.isNull(databarExpanded('(10)ABéCD'));
    });

    it('should refuse data that does not fit in twenty two symbol characters', function() {
      assert.isNull(databarExpanded(`(10)${'A'.repeat(60)}`));
      assert.isNotNull(databarExpanded(`(10)${'1'.repeat(40)}`));
    });
  });

  describe('the paper', function() {
    /* The same symbol through both parsers: GS w 3 and an n3 of 2 are both
       three dots per module, and GS h and n4 are the height in dots */

    const escpos = (symbology, data, width = 3) => stream(
        ESC, '@',
        GS, 'h', 100, GS, 'w', width, GS, 'H', 0,
        GS, 'k', symbology, data.length, data,
    );

    const star = (symbology, data, width = 2) => stream(
        ESC, '@',
        ESC, 'b', [symbology, 1, width, 100], data, RS,
    );

    const paper = (bytes, Renderer) => stitch(
        new Renderer({width: WIDTH}).render(bytes),
        {width: WIDTH},
    );

    const variants = [
      {name: 'Omnidirectional', escpos: 75, star: 10, symbology: 'databaromni'},
      {name: 'Truncated', escpos: 76, star: 11, symbology: 'databartruncated'},
      {name: 'Limited', escpos: 77, star: 12, symbology: 'databarlimited'},
    ];

    for (const variant of variants) {
      it(`should print ${variant.name} as the reference encodes it, in both languages`, function() {
        for (const data of variant.name === 'Limited' ? LIMITED : GTINS.map(([value]) => value)) {
          const expected = reference(variant.symbology, `(01)${data}`);

          assert.equal(read(paper(escpos(variant.escpos, data), EscPosRenderer), 3), expected, data);
          assert.equal(read(paper(star(variant.star, data), StarPrntRenderer), 3), expected, data);
        }
      });
    }

    it('should print Expanded as the reference encodes it, in both languages', function() {
      for (const data of ELEMENTS) {
        const expected = reference('databarexpanded', data);

        if (expected.length * 2 > WIDTH) {
          continue;
        }

        assert.equal(read(paper(escpos(78, data, 2), EscPosRenderer), 2), expected, data);
        assert.equal(read(paper(star(13, data, 1), StarPrntRenderer), 2), expected, data);
      }
    });

    it('should print a symbol a reader reads back, in both languages', function() {
      for (const [data, printed] of GTINS) {
        for (const symbology of [75, 76]) {
          assert.equal(scan(paper(escpos(symbology, data), EscPosRenderer)), printed, data);
        }

        for (const symbology of [10, 11]) {
          assert.equal(scan(paper(star(symbology, data), StarPrntRenderer)), printed, data);
        }
      }
    });
  });

  describe('the fixtures', function() {
    /* The bars of the fixtures, read back from the paper: the band of the
       symbol is the tallest one of the receipt, the lines of text around it
       are a cell high */

    const cases = [
      {fixture: 'databar-omni', symbology: 'databaromni', data: '(01)0952123454321', moduleWidth: 3},
      {fixture: 'databar-truncated', symbology: 'databartruncated', data: '(01)0952123454321', moduleWidth: 3},
      {fixture: 'databar-limited', symbology: 'databarlimited', data: '(01)0123456789012', moduleWidth: 3},
      {
        fixture: 'databar-expanded',
        symbology: 'databarexpanded',
        data: '(01)90614141000015(3103)000123',
        moduleWidth: 3,
      },
      {
        fixture: 'databar-coupon',
        symbology: 'databarexpanded',
        data: '(8110)106141410123456101100',
        moduleWidth: 2,
      },
    ];

    for (const language of ['esc-pos', 'star-prnt']) {
      for (const item of cases) {
        it(`should draw the ${language} ${item.fixture} fixture as the reference encodes it`, function() {
          const paper = fixture(`${language}/raw`, item.fixture).paper;
          const band = bands(paper).reduce((tallest, next) => next.height > tallest.height ? next : tallest);

          assert.equal(read(band, item.moduleWidth), reference(item.symbology, item.data));
        });
      }
    }

    for (const language of ['esc-pos', 'star-prnt']) {
      it(`should have a ${language} Omnidirectional fixture a reader reads back`, function() {
        for (const name of ['databar-omni', 'databar-truncated']) {
          const paper = fixture(`${language}/raw`, name).paper;

          assert.equal(scan(paper), '09521234543213', name);
        }
      });
    }
  });
});
