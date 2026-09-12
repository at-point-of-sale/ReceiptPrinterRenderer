import {createRequire} from 'node:module';

import Bitmap from '../src/bitmap.js';
import {barcode, supports} from '../src/symbologies/index.js';
import {toBars, toPattern, fromElements} from '../src/symbologies/pattern.js';
import {checkDigit} from '../src/symbologies/ean.js';
import {select} from '../src/symbologies/code128.js';
import {fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/*
    The symbologies, against a reference.

    JsBarcode is a dev dependency for this file alone. Its encoder classes take
    a value and return the modules of the symbol as a string of ones and zeroes,
    without a canvas and without a DOM, which is exactly what this package
    produces as well. Every symbology both of them implement is checked against
    it, Code 93 by hand against the published pattern of a short value.

    The reference draws a trailing space where the specification of a symbology
    has one, Code 39 and Codabar for instance. A trailing space is not part of
    the symbol, the renderer drops it, so both patterns are trimmed.
*/

const require = createRequire(import.meta.url);
const encoders = require('jsbarcode/bin/barcodes/index.js').default;

/* The CODE128 of the index picks the code sets itself. The class behind it
   takes the start character and the code set switches in the data, which is
   what the ESC/POS escapes select, so the tests that check those use it
   directly. Its special characters are the code of the symbol plus 105 */

const Code128 = require('jsbarcode/bin/barcodes/CODE128/CODE128.js').default;

const START_A = '\u00d0';
const START_B = '\u00d1';
const TO_B = '\u00cd';
const TO_C = '\u00cc';
const FNC1 = '\u00cf';
const SHIFT = '\u00cb';

/**
 * The modules of a barcode, as this package encodes it
 *
 * @param  {string}        symbology   Name of the symbology
 * @param  {string}        data        The value of the barcode
 * @return {string|null}               The modules, or null when the data is not valid
 */
function pattern(symbology, data) {
  const result = barcode(symbology, data);

  return result === null ? null : toPattern(result.bars).replace(/0+$/, '');
}

/**
 * The modules of a barcode that carries its own code set selection, as
 * JsBarcode encodes it
 *
 * @param  {string}   value   The value of the barcode, starting with a start character
 * @return {string}           The modules
 */
function code128(value) {
  return new Code128(value, {flat: true}).encode().data.replace(/0+$/, '');
}

/**
 * The modules of a barcode, as JsBarcode encodes it
 *
 * @param  {string}   name    Name of the encoder class of JsBarcode
 * @param  {string}   value   The value of the barcode
 * @return {string}           The modules
 */
function reference(name, value) {
  const encoder = new encoders[name](value, {flat: true});

  assert.isTrue(encoder.valid(), `the reference does not accept ${value} as a ${name}`);

  const encoded = encoder.encode();
  const data = Array.isArray(encoded.data) ?
    encoded.data.map((part) => part.data).join('') :
    encoded.data;

  return data.replace(/0+$/, '');
}

describe('symbologies', function() {
  describe('the registry', function() {
    it('should have every symbology the parsers ask for', function() {
      for (const name of [
        'upca', 'upce', 'ean13', 'ean8', 'code39', 'itf',
        'codabar', 'code93', 'code128', 'gs1-128', 'code128-auto',
      ]) {
        assert.isTrue(supports(name), name);
      }
    });

    it('should not have a symbology it cannot draw', function() {
      assert.isFalse(supports('gs1-databar-omni'));
      assert.isNull(barcode('gs1-databar-omni', '12345'));
    });
  });

  describe('EAN-13', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('ean13', '4006381333931'), reference('EAN13', '4006381333931'));
      assert.equal(pattern('ean13', '5901234123457'), reference('EAN13', '5901234123457'));
    });

    it('should compute a check digit that is not there', function() {
      assert.equal(pattern('ean13', '400638133393'), reference('EAN13', '4006381333931'));
      assert.equal(barcode('ean13', '400638133393').text, '4006381333931');
    });

    it('should refuse a check digit that is wrong', function() {
      assert.isNull(barcode('ean13', '4006381333930'));
    });

    it('should refuse anything that is not twelve or thirteen digits', function() {
      assert.isNull(barcode('ean13', '40063813339'));
      assert.isNull(barcode('ean13', '40063813339311'));
      assert.isNull(barcode('ean13', '400638133X31'));
      assert.isNull(barcode('ean13', ''));
    });
  });

  describe('EAN-8', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('ean8', '96385074'), reference('EAN8', '96385074'));
    });

    it('should compute a check digit that is not there', function() {
      assert.equal(pattern('ean8', '9638507'), reference('EAN8', '96385074'));
      assert.equal(barcode('ean8', '9638507').text, '96385074');
    });

    it('should refuse a check digit that is wrong', function() {
      assert.isNull(barcode('ean8', '96385075'));
    });
  });

  describe('UPC-A', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('upca', '123456789012'), reference('UPC', '123456789012'));
      assert.equal(pattern('upca', '042100005264'), reference('UPC', '042100005264'));
    });

    it('should compute a check digit that is not there', function() {
      assert.equal(pattern('upca', '12345678901'), reference('UPC', '123456789012'));
      assert.equal(barcode('upca', '12345678901').text, '123456789012');
    });

    it('should print twelve digits, not the thirteen of the EAN-13 it is', function() {
      assert.equal(barcode('upca', '123456789012').text.length, 12);
    });

    it('should refuse a check digit that is wrong', function() {
      assert.isNull(barcode('upca', '123456789013'));
    });
  });

  describe('UPC-E', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('upce', '01234565'), reference('UPCE', '01234565'));
      assert.equal(pattern('upce', '04252614'), reference('UPCE', '04252614'));
    });

    it('should take six digits, seven with the number system, or all eight', function() {
      assert.equal(pattern('upce', '123456'), reference('UPCE', '01234565'));
      assert.equal(pattern('upce', '0123456'), reference('UPCE', '01234565'));

      assert.equal(barcode('upce', '123456').text, '01234565');
      assert.equal(barcode('upce', '0123456').text, '01234565');
    });

    it('should encode the number system in the parity of the digits', function() {
      assert.notEqual(pattern('upce', '1123456'), pattern('upce', '0123456'));
    });

    it('should compress a UPC-A that has a zero suppressed form', function() {
      /* Hand checked pairs: the eleven or twelve digits of the UPC-A, the six
         digits of the symbol, and the eight the printer puts below the bars */

      for (const [upca, upce, text] of [
        ['042100005264', '425261', '04252614'],
        ['04210000526', '425261', '04252614'],
        ['012000003035', '123030', '01230305'],
        ['023456000073', '234567', '02345673'],
      ]) {
        assert.equal(pattern('upce', upca), pattern('upce', upce), upca);
        assert.equal(barcode('upce', upca).text, text, upca);
      }
    });

    it('should refuse a UPC-A that has no zero suppressed form', function() {
      assert.isNull(barcode('upce', '012345678905'));
      assert.isNull(barcode('upce', '123456789012'));
    });

    it('should refuse a check digit that is wrong and a number system that does not exist', function() {
      assert.isNull(barcode('upce', '01234566'));
      assert.isNull(barcode('upce', '2123456'));
      assert.isNull(barcode('upce', '12345'));
    });
  });

  describe('Code 39', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('code39', 'ABC-123'), reference('CODE39', 'ABC-123'));
      assert.equal(pattern('code39', 'HELLO 123'), reference('CODE39', 'HELLO 123'));
      assert.equal(pattern('code39', '$/+%.'), reference('CODE39', '$/+%.'));
    });

    it('should print lower case in upper case, as the symbology has no lower case', function() {
      assert.equal(pattern('code39', 'abc'), reference('CODE39', 'ABC'));
      assert.equal(barcode('code39', 'abc').text, 'ABC');
    });

    it('should refuse a character the symbology does not have', function() {
      assert.isNull(barcode('code39', 'ABC#123'));
      assert.isNull(barcode('code39', 'A*B'));
      assert.isNull(barcode('code39', ''));
    });
  });

  describe('ITF', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('itf', '12345670'), reference('ITF', '12345670'));
      assert.equal(pattern('itf', '00123456789012'), reference('ITF', '00123456789012'));
    });

    it('should refuse an odd number of digits, which the symbology cannot carry', function() {
      assert.isNull(barcode('itf', '1234567'));
      assert.isNull(barcode('itf', '12a4'));
      assert.isNull(barcode('itf', ''));
    });
  });

  describe('Codabar', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('codabar', 'A12345A'), reference('codabar', 'A12345A'));
      assert.equal(pattern('codabar', 'C1234-5678D'), reference('codabar', 'C1234-5678D'));
    });

    it('should add the start and stop character when the data has none', function() {
      assert.equal(pattern('codabar', '12345'), reference('codabar', 'A12345A'));
      assert.equal(barcode('codabar', '12345').text, 'A12345A');
    });

    it('should print the start and stop character, which the reference hides', function() {
      assert.equal(barcode('codabar', 'A12345A').text, 'A12345A');
    });

    it('should refuse a start without a stop and a letter in the middle', function() {
      assert.isNull(barcode('codabar', 'A12345'));
      assert.isNull(barcode('codabar', 'A123B45A'));
      assert.isNull(barcode('codabar', 'AA'));
    });
  });

  describe('Code 93', function() {
    it('should encode the same modules as the reference', function() {
      assert.equal(pattern('code93', 'TEST93'), reference('CODE93', 'TEST93'));
      assert.equal(pattern('code93', 'ABC-123'), reference('CODE93', 'ABC-123'));
    });

    it('should encode TEST93 as the published pattern', function() {
      /* Hand verified against the worked example of the symbology: the start
         character, T E S T 9 3, the two check characters, + and 6, the stop
         character and the termination bar */

      const symbols = [
        '101011110', /* start */
        '110100110', /* T */
        '110010010', /* E */
        '110101100', /* S */
        '110100110', /* T */
        '100001010', /* 9 */
        '101000010', /* 3 */
        '101110110', /* check C, +, the weighted sum 464 modulo 47 is 41 */
        '100100010', /* check K, 6, the weighted sum 617 modulo 47 is 6 */
        '101011110', /* stop */
        '1', /* termination bar */
      ];

      assert.equal(pattern('code93', 'TEST93'), symbols.join(''));
    });

    it('should encode F as the published pattern, whose check character is a shift symbol', function() {
      /* The two check characters of F are F, value 15, and the symbol of value
         45, which is one of the four shift characters of the full ASCII variant:
         they are never data, but a check character does land on them */

      const symbols = [
        '101011110', /* start */
        '110001010', /* F */
        '110001010', /* check C, F, 15 times the weight 1 */
        '111010110', /* check K, the shift character of value 45 */
        '101011110', /* stop */
        '1', /* termination bar */
      ];

      assert.equal(pattern('code93', 'F'), symbols.join(''));
      assert.equal(pattern('code93', 'F'), reference('CODE93', 'F'));
    });

    it('should encode every value as nine modules per symbol and nothing else', function() {
      const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

      let seed = 20260912;

      /* A generator of its own, so that a failure is the same on every run */

      const random = (limit) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;

        return seed % limit;
      };

      for (let count = 0; count < 400; count++) {
        let value = '';

        for (let length = 1 + random(12); length > 0; length--) {
          value += alphabet[random(alphabet.length)];
        }

        const modules = pattern('code93', value);

        /* The start and stop character, the two check characters and the data,
           nine modules each, and the termination bar */

        assert.match(modules, /^[01]+$/, value);
        assert.equal(modules.length, 9 * (value.length + 4) + 1, value);
        assert.equal(modules, reference('CODE93', value), value);
      }
    });

    it('should refuse a character the symbology does not have', function() {
      assert.isNull(barcode('code93', 'test#93'));
      assert.isNull(barcode('code93', ''));
    });
  });

  describe('Code 128', function() {
    it('should encode a code set the same way as the reference', function() {
      assert.equal(pattern('code128', '{BHello'), reference('CODE128B', 'Hello'));
      assert.equal(pattern('code128', '{C12345678'), reference('CODE128C', '12345678'));
      assert.equal(pattern('code128', '{AHELLO'), reference('CODE128A', 'HELLO'));
    });

    it('should print the text without the escapes', function() {
      assert.equal(barcode('code128', '{BHello').text, 'Hello');
      assert.equal(barcode('code128', '{B{{brace').text, '{brace');
    });

    it('should switch code set where the data says', function() {
      assert.equal(pattern('code128', '{BAB{C1234'), code128(`${START_B}AB${TO_C}1234`));
    });

    it('should switch code set when the current one cannot carry a character', function() {
      /* Code set A has no lower case, so the b needs code set B */

      assert.equal(pattern('code128', '{AAb'), code128(`${START_A}A${TO_B}b`));
    });

    it('should encode a function character', function() {
      assert.equal(pattern('code128', '{B{1123'), code128(`${START_B}${FNC1}123`));
    });

    it('should shift one character into the other code set', function() {
      /* BEL is a character of code set A, shifted into a barcode of code set B */

      const bell = String.fromCharCode(7);

      assert.equal(pattern('code128', `{B{S${bell}A`), code128(`${START_B}${SHIFT}${bell}A`));
    });

    it('should refuse data without a code set and an escape it does not know', function() {
      assert.isNull(barcode('code128', 'Hello'));
      assert.isNull(barcode('code128', '{X123'));
      assert.isNull(barcode('code128', ''));
    });
  });

  describe('Code 128 with the code sets picked for the data', function() {
    it('should encode the same modules as the reference', function() {
      for (const value of ['ABC12345678', '12345678', 'Hello World', '1234ABCD', 'A1234567B', '007']) {
        assert.equal(pattern('code128-auto', value), reference('CODE128', value), value);
      }
    });

    it('should start in code set C when the value starts with digits', function() {
      assert.equal(select('12345678')[0].value, 'C');
      assert.equal(select('Hello')[0].value, 'B');
    });

    it('should switch to code set C for a run of four digits or more', function() {
      assert.deepEqual(
          select('AB123456').filter((item) => item.type === 'set').map((item) => item.value),
          ['B', 'C'],
      );

      assert.deepEqual(
          select('AB12').filter((item) => item.type === 'set').map((item) => item.value),
          ['B'],
      );
    });

    it('should print the value as it was given', function() {
      assert.equal(barcode('code128-auto', 'ABC12345678').text, 'ABC12345678');
    });

    it('should refuse a byte that no code set can carry', function() {
      assert.isNull(barcode('code128-auto', `AB${String.fromCharCode(0xe9)}C`));
      assert.isNull(barcode('code128-auto', String.fromCharCode(0x80)));
      assert.isNull(barcode('gs1-128', `01${String.fromCharCode(0xe9)}`));
    });
  });

  describe('GS1-128', function() {
    it('should be a Code 128 with FNC1 behind the start symbol', function() {
      const value = '0103453120000011';
      const encoder = new encoders.CODE128(value, {flat: true, ean128: true});

      assert.equal(pattern('gs1-128', value), encoder.encode().data.replace(/0+$/, ''));
    });

    it('should print the value as it was given', function() {
      assert.equal(barcode('gs1-128', '0103453120000011').text, '0103453120000011');
    });

    it('should refuse an empty value', function() {
      assert.isNull(barcode('gs1-128', ''));
    });
  });

  describe('the fixtures', function() {
    /*
        The bars of the fixtures, read back from the paper.

        Every barcode fixture prints one symbology, of which the first block is
        taken: the modules of the top row of the bars, from the first black dot
        to the last one, divided by the width of a module. That is the pattern
        the reference produces, which makes this the one test that covers the
        whole way from the bytes of the encoder to the dots on the paper.
    */

    const WIDTH = 3;
    const NARROW = 2;

    const cases = [
      {fixture: 'ean13', reference: () => reference('EAN13', '4006381333931'), moduleWidth: WIDTH},
      {fixture: 'ean8', reference: () => reference('EAN8', '96385074'), moduleWidth: WIDTH},
      {fixture: 'upca', reference: () => reference('UPC', '123456789012'), moduleWidth: WIDTH},
      {fixture: 'upce', reference: () => reference('UPCE', '01234565'), moduleWidth: WIDTH},
      {fixture: 'code39', reference: () => reference('CODE39', 'ABC-123'), moduleWidth: WIDTH},
      {fixture: 'itf', reference: () => reference('ITF', '12345670'), moduleWidth: NARROW},
      {fixture: 'codabar', reference: () => reference('codabar', 'A12345A'), moduleWidth: WIDTH},
      {fixture: 'code93', reference: () => reference('CODE93', 'TEST93'), moduleWidth: WIDTH},
      {fixture: 'code128', reference: () => code128(`${START_B}ABC-123`), moduleWidth: WIDTH},
      {fixture: 'code128-auto', reference: () => reference('CODE128', 'ABC12345678'), moduleWidth: WIDTH},
      {
        fixture: 'gs1-128',
        reference: () => new encoders.CODE128('0103453120000011', {flat: true, ean128: true})
            .encode().data.replace(/0+$/, ''),
        moduleWidth: WIDTH,
      },
    ];

    /**
     * The first row of the paper that has ink on it
     *
     * @param  {object}   paper   The paper of a fixture
     * @return {number}           The row, or -1 when the paper is white
     */
    function firstRow(paper) {
      for (let y = 0; y < paper.height; y++) {
        for (let x = 0; x < paper.width; x++) {
          if (Bitmap.getPixel(paper, x, y)) {
            return y;
          }
        }
      }

      return -1;
    }

    /**
     * The modules of the barcode on a row of the paper, from the first black
     * dot to the last one
     *
     * @param  {object}   paper         The paper of a fixture
     * @param  {number}   row           The row to read
     * @param  {number}   moduleWidth   Width of a module in dots
     * @return {string}                 The modules, '1' is a bar and '0' is a space
     */
    function modules(paper, row, moduleWidth) {
      let first = -1;
      let last = -1;

      for (let x = 0; x < paper.width; x++) {
        if (Bitmap.getPixel(paper, x, row)) {
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
              Bitmap.getPixel(paper, x + dot, row),
              Bitmap.getPixel(paper, x, row),
              `the module at ${x} is not ${moduleWidth} dots wide`,
          );
        }

        result += Bitmap.getPixel(paper, x, row) ? '1' : '0';
      }

      return result;
    }

    for (const language of ['esc-pos', 'star-prnt']) {
      for (const item of cases) {
        it(`should draw the ${language} ${item.fixture} fixture as the reference encodes it`, function() {
          const paper = fixture(language, item.fixture).paper;
          const row = firstRow(paper);

          assert.equal(modules(paper, row, item.moduleWidth), item.reference());
        });
      }
    }
  });

  describe('check digits', function() {
    it('should weight the digits three and one from the right', function() {
      assert.equal(checkDigit('400638133393'), 1);
      assert.equal(checkDigit('9638507'), 4);
      assert.equal(checkDigit('12345678901'), 2);
    });
  });

  describe('patterns', function() {
    it('should turn modules into widths and back', function() {
      assert.deepEqual(toBars('1101001'), [2, 1, 1, 2, 1]);
      assert.equal(toPattern([2, 1, 1, 2, 1]), '1101001');
    });

    it('should drop the quiet zone on both sides', function() {
      assert.deepEqual(toBars('0011000'), [2]);
      assert.deepEqual(toBars('0000'), []);
    });

    it('should draw a wide element three modules wide', function() {
      assert.equal(fromElements('nwn'), '1000' + '1');
    });
  });
});
