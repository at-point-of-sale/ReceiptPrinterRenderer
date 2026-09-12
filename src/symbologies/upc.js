import {toBars, isDigits} from './pattern.js';
import {ean13, checkDigit, LEFT_ODD, LEFT_EVEN, GUARD} from './ean.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    UPC-A and UPC-E.

    A UPC-A is an EAN-13 whose first digit is zero, printed without that zero.
    A UPC-E is the zero suppressed form of a UPC-A: six digits between a normal
    guard and a six module end guard, with the check digit and the number
    system carried in the parity of those six digits.
*/

/* Which of the six digits have even parity, indexed by the check digit, for
   number system 0. Number system 1 uses the opposite parity */

const PARITY = [
  'EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO',
  'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE',
];

const END = '010101';

/**
 * Encode a UPC-A
 *
 * @param  {string}         data   11 or 12 digits, the check digit is computed when it is missing
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function upca(data) {
  if (!isDigits(data, 11) && !isDigits(data, 12)) {
    return null;
  }

  /* A UPC-A is an EAN-13 with a leading zero, and it prints without it */

  const barcode = ean13('0' + data);

  return barcode === null ? null : {bars: barcode.bars, text: barcode.text.slice(1)};
}

/**
 * The UPC-A a UPC-E stands for, without its check digit
 *
 * @param  {string}        system   The number system digit, 0 or 1
 * @param  {string}        body     The six digits of the symbol
 * @return {string|null}            The eleven digits of the UPC-A, or null
 */
function expand(system, body) {
  const last = body[5];

  if (last === '0' || last === '1' || last === '2') {
    return `${system}${body.slice(0, 2)}${last}0000${body.slice(2, 5)}`;
  }

  if (last === '3') {
    return `${system}${body.slice(0, 3)}00000${body.slice(3, 5)}`;
  }

  if (last === '4') {
    return `${system}${body.slice(0, 4)}00000${body[4]}`;
  }

  return `${system}${body.slice(0, 5)}0000${last}`;
}

/**
 * The six digits a UPC-A compresses to, or null when it has no zero suppressed
 * form. The four rules are the ones expand() undoes, tried in the order the
 * specification gives them, and the result is verified by expanding it again.
 *
 * @param  {string}        digits   The eleven digits of the UPC-A, the number system first
 * @return {string|null}            The six digits of the symbol, or null
 */
function compress(digits) {
  const system = digits[0];
  const rest = digits.slice(1);

  const candidates = [
    `${rest.slice(0, 2)}${rest.slice(7, 10)}${rest[2]}`,
    `${rest.slice(0, 3)}${rest.slice(8, 10)}3`,
    `${rest.slice(0, 4)}${rest[9]}4`,
    `${rest.slice(0, 5)}${rest[9]}`,
  ];

  for (const candidate of candidates) {
    if (expand(system, candidate) === digits) {
      return candidate;
    }
  }

  return null;
}

/**
 * Encode a UPC-E.
 *
 * The data is the six digits of the symbol, optionally with the number system
 * in front of them and the check digit behind them. It can also be the eleven
 * or twelve digits of the UPC-A the symbol stands for, which is compressed when
 * it has a zero suppressed form and refused when it has none. What is missing
 * is computed, what is there is validated, the way printer firmware does it.
 *
 * @param  {string}         data   6, 7 or 8 digits, or the 11 or 12 of a UPC-A
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function upce(data) {
  if (!isDigits(data) || data.length < 6 || data.length > 12 || (data.length > 8 && data.length < 11)) {
    return null;
  }

  const long = data.length > 8;
  const system = data.length === 6 ? '0' : data[0];

  /* Only the two number systems that have a zero suppressed form exist */

  if (system !== '0' && system !== '1') {
    return null;
  }

  if (long && data.length === 12 && Number(data[11]) !== checkDigit(data.slice(0, 11))) {
    return null;
  }

  const body = long ? compress(data.slice(0, 11)) : (data.length === 6 ? data : data.slice(1, 7));

  if (body === null) {
    return null;
  }

  const check = checkDigit(expand(system, body));

  if (data.length === 8 && Number(data[7]) !== check) {
    return null;
  }

  const parity = PARITY[check];

  let pattern = GUARD;

  for (let index = 0; index < 6; index++) {
    const value = Number(body[index]);
    const even = system === '0' ? parity[index] === 'E' : parity[index] === 'O';

    pattern += even ? LEFT_EVEN[value] : LEFT_ODD[value];
  }

  pattern += END;

  return {bars: toBars(pattern), text: `${system}${body}${check}`};
}
