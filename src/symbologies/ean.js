import {toBars, isDigits} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    EAN-13 and EAN-8.

    Both are built from seven module digits between guard patterns. EAN-13
    carries its first digit in the parity of the six digits on the left, EAN-8
    uses the left parity for all four of its left digits.
*/

/* The three digit encodings: odd parity on the left, even parity on the left,
   and the right hand side, which is the complement of the odd one */

const LEFT_ODD = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

const LEFT_EVEN = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

const RIGHT = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/* Which of the six digits on the left of an EAN-13 have even parity, one
   character per digit, indexed by the first digit of the number */

const PARITY = [
  'OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE',
  'OEEOOE', 'OEEEOO', 'OEOEOE', 'OEOEEO', 'OEEOEO',
];

const GUARD = '101';
const CENTRE = '01010';

/**
 * The check digit of a number, the way EAN and UPC compute it: the digits are
 * weighted three and one from the right, and the check digit makes the total a
 * multiple of ten
 *
 * @param  {string}   digits   The digits without the check digit
 * @return {number}            The check digit
 */
export function checkDigit(digits) {
  let sum = 0;

  for (let index = 0; index < digits.length; index++) {
    const weight = (digits.length - index) % 2 === 0 ? 1 : 3;

    sum += Number(digits[index]) * weight;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Complete a number with its check digit, or keep the one it has. Printer
 * firmware computes a missing check digit; a check digit that is sent is
 * never verified, it is encoded and printed as it came, which is what an Epson
 * TM-T70 does with a wrong one on paper.
 *
 * @param  {string}        digits   The digits of the barcode
 * @param  {number}        length   Length of the number including the check digit
 * @return {string|null}            The complete number, or null when it is not valid
 */
export function withCheckDigit(digits, length) {
  if (isDigits(digits, length - 1)) {
    return digits + checkDigit(digits);
  }

  if (isDigits(digits, length)) {
    return digits;
  }

  return null;
}

/**
 * Encode an EAN-13, which is also the body of a UPC-A
 *
 * @param  {string}         data   12 or 13 digits, the check digit is computed when it is missing
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function ean13(data) {
  const digits = withCheckDigit(data, 13);

  if (digits === null) {
    return null;
  }

  const parity = PARITY[Number(digits[0])];

  let pattern = GUARD;

  for (let index = 1; index <= 6; index++) {
    const value = Number(digits[index]);

    pattern += parity[index - 1] === 'E' ? LEFT_EVEN[value] : LEFT_ODD[value];
  }

  pattern += CENTRE;

  for (let index = 7; index <= 12; index++) {
    pattern += RIGHT[Number(digits[index])];
  }

  pattern += GUARD;

  return {bars: toBars(pattern), text: digits};
}

/**
 * Encode an EAN-8
 *
 * @param  {string}         data   7 or 8 digits, the check digit is computed when it is missing
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function ean8(data) {
  const digits = withCheckDigit(data, 8);

  if (digits === null) {
    return null;
  }

  let pattern = GUARD;

  for (let index = 0; index < 4; index++) {
    pattern += LEFT_ODD[Number(digits[index])];
  }

  pattern += CENTRE;

  for (let index = 4; index < 8; index++) {
    pattern += RIGHT[Number(digits[index])];
  }

  pattern += GUARD;

  /* The four digits on each side are printed under the modules that encode
     them, not as one run: the left guard is three modules and a digit is
     seven, so the left four sit on modules 3 to 31 and the right four, behind
     the five module centre guard, on 36 to 64 */

  return {
    bars: toBars(pattern),
    text: digits,
    groups: [
      {start: 3, end: 31, text: digits.slice(0, 4)},
      {start: 36, end: 64, text: digits.slice(4)},
    ],
  };
}

export {LEFT_ODD, LEFT_EVEN, GUARD};
