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

  if (barcode === null) {
    return null;
  }

  const text = barcode.text.slice(1);

  /* The twelve digits are printed in two groups of six, each under the modules
     that encode it: the left guard is three modules and a digit is seven, so
     the left six sit on modules 3 to 45 and the right six, behind the five
     module centre guard, on 50 to 92. The number system digit and the check
     digit are inside those groups, not beside the bars */

  return {
    bars: barcode.bars,
    text,
    groups: [
      {start: 3, end: 45, text: text.slice(0, 6)},
      {start: 50, end: 92, text: text.slice(6)},
    ],
  };
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
 * The data is the eleven or twelve digits of the UPC-A the symbol stands for,
 * whose number system digit must be a zero. It is compressed by the zero
 * suppression rules when it has such a form, and when it has none the printer
 * takes the five manufacturer digits and the last product digit instead, so
 * that `01234567890` becomes `123450` rather than nothing. The twelfth digit
 * is the check digit and is not verified, the eleven digit form computes it.
 *
 * The forms of six, seven and eight digits are refused: an Epson TM-T70
 * printed those rows of the escpos-php `barcode` fixture as text and drew no
 * bars, and the reference allows them on newer firmware, which the deviations
 * lists of both command pages say.
 *
 * @param  {string}         data   The 11 or 12 digits of a UPC-A
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function upce(data) {
  if (!isDigits(data) || (data.length !== 11 && data.length !== 12)) {
    return null;
  }

  const system = data[0];

  /* The printout only settled number system 0, and the reference gives the
     zero suppressed form to 0 and 1; this renderer follows the printout */

  if (system !== '0') {
    return null;
  }

  const digits = data.slice(0, 11);

  /* The check digit that is sent is never verified, the shorter form computes
     the one it has not got */

  const check = data.length === 12 ? Number(data[11]) : checkDigit(digits);

  /* A UPC-A without a zero suppressed form is not refused: the printer keeps
     the five manufacturer digits and the last product digit */

  const body = compress(digits) || `${digits.slice(1, 6)}${digits[10]}`;

  const parity = PARITY[check];

  let pattern = GUARD;

  for (let index = 0; index < 6; index++) {
    const value = Number(body[index]);

    pattern += parity[index] === 'E' ? LEFT_EVEN[value] : LEFT_ODD[value];
  }

  pattern += END;

  /* The six digits of the body are the whole of the human readable text: the
     number system and the check digit are not printed */

  return {bars: toBars(pattern), text: body};
}
