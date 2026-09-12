import {toBars} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    Code 93.

    Nine modules per character, three bars and three spaces. The symbol carries
    two check characters, computed modulo 47 over the character values with
    weights that run up to 20 for the first one and up to 15 for the second, and
    it ends with a single termination bar behind the stop character.
*/

/* The characters the symbology carries, whose position is their value. The four
   shift characters of the full ASCII variant follow them, at 43 to 46: they are
   not in this string, so they can never be data, but a check character can land
   on one of them and then needs its pattern */

const SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

const ENCODINGS = [
  '100010100', '101001000', '101000100', '101000010', '100101000',
  '100100100', '100100010', '101010000', '100010010', '100001010',
  '110101000', '110100100', '110100010', '110010100', '110010010',
  '110001010', '101101000', '101100100', '101100010', '100110100',
  '100011010', '101011000', '101001100', '101000110', '100101100',
  '100010110', '110110100', '110110010', '110101100', '110100110',
  '110010110', '110011010', '101101100', '101100110', '100110110',
  '100111010', '100101110', '111010100', '111010010', '111001010',
  '101101110', '101110110', '110101110',

  /* 43 to 46, the shift characters ($), (%), (/) and (+) */

  '100100110', '111011010', '111010110', '100110010',
];

/* The start and stop character, which is the same one */

const GUARD = '101011110';

/**
 * One check character, over the values of the characters, weighted from the
 * right up to a maximum weight
 *
 * @param  {number[]}   values      The character values
 * @param  {number}     maxWeight   Highest weight, 20 for C and 15 for K
 * @return {number}                 The value of the check character
 */
function checksum(values, maxWeight) {
  let sum = 0;

  for (let index = 0; index < values.length; index++) {
    const weight = ((values.length - 1 - index) % maxWeight) + 1;

    sum += values[index] * weight;
  }

  return sum % 47;
}

/**
 * Encode a Code 93 barcode, with its two check characters. The extended, full
 * ASCII variant is not implemented: printer firmware encodes the 43 characters
 * of the basic set and refuses the rest.
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function code93(data) {
  const value = String(data).toUpperCase();

  if (value.length === 0) {
    return null;
  }

  const values = [];

  for (const character of value) {
    const index = SYMBOLS.indexOf(character);

    if (index < 0) {
      return null;
    }

    values.push(index);
  }

  const first = checksum(values, 20);
  const second = checksum(values.concat(first), 15);

  let pattern = GUARD;

  for (const index of values.concat(first, second)) {
    pattern += ENCODINGS[index];
  }

  pattern += GUARD + '1';

  return {bars: toBars(pattern), text: value};
}

export default code93;
