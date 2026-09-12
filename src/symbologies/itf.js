import {toBars, isDigits} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    Interleaved 2 of 5.

    Digits are encoded in pairs: the first digit of the pair as five bars, the
    second as the five spaces between them. Two of the five elements are wide,
    three modules against one for a narrow element.
*/

const ENCODINGS = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

const START = '1010';
const STOP = '11101';

/**
 * Encode an interleaved 2 of 5 barcode. The symbology can only carry an even
 * number of digits, and printer firmware refuses an odd one rather than pad it,
 * because padding would change the number.
 *
 * @param  {string}         data   An even number of digits
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function itf(data) {
  if (!isDigits(data) || data.length % 2 !== 0) {
    return null;
  }

  let pattern = START;

  for (let index = 0; index < data.length; index += 2) {
    const bars = ENCODINGS[Number(data[index])];
    const spaces = ENCODINGS[Number(data[index + 1])];

    for (let element = 0; element < 5; element++) {
      pattern += (bars[element] === '1' ? '111' : '1') + (spaces[element] === '1' ? '000' : '0');
    }
  }

  pattern += STOP;

  return {bars: toBars(pattern), text: data};
}

export default itf;
