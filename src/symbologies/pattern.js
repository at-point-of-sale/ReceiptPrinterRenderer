/**
 * The height a symbology asks for, in modules, for the symbologies whose
 * specification says how tall their symbol is. GS1 DataBar Truncated and
 * Limited have a height of their own, which the height of the command does not
 * change, and Omnidirectional and Expanded have a least height a printer never
 * goes below.
 *
 * @typedef {object} BarcodeHeight
 * @property {number} [fixed]     The height of the symbol in modules
 * @property {number} [minimum]   The least height of the symbol in modules
 */

/**
 * One group of the human readable text of a barcode, centred under the modules
 * that encode it. UPC-A and EAN-8 print their digits in two of these, the rest
 * of the symbologies have none.
 *
 * @typedef {object} BarcodeGroup
 * @property {number} start   First module of the range, counted from the first module of the symbol
 * @property {number} end     One past the last module of the range
 * @property {string} text    The characters of the group
 */

/**
 * A barcode, as the symbology generators return it
 *
 * @typedef {object} Barcode
 * @property {number[]} bars           Module widths, alternating bar and space, starting with a bar
 * @property {string} text             The human readable text of this barcode, as it is printed
 * @property {BarcodeGroup[]} [groups] The groups the text is printed in, when it is not one centred run
 * @property {boolean} [spread]        True when the characters are spread over equal slots across the bars
 * @property {boolean} [boxed]         True when the text is wrapped in the start and stop boxes of Code 93
 * @property {BarcodeHeight} [height]  The height the specification of the symbology gives the symbol
 */

/**
 * Turn a pattern of ones and zeroes, one character per module, into the module
 * widths the painter draws: alternating bar and space, starting with a bar.
 * Leading and trailing spaces are dropped, a barcode carries no quiet zone.
 *
 * @param  {string}     pattern   The modules, '1' is a bar and '0' is a space
 * @return {number[]}             The widths, starting with a bar
 */
export function toBars(pattern) {
  const bars = [];

  let index = pattern.indexOf('1');

  if (index < 0) {
    return bars;
  }

  let current = '1';
  let width = 0;

  for (; index < pattern.length; index++) {
    if (pattern[index] === current) {
      width++;
      continue;
    }

    bars.push(width);

    current = pattern[index];
    width = 1;
  }

  /* A run of spaces at the end is not part of the symbol */

  if (current === '1') {
    bars.push(width);
  }

  return bars;
}

/**
 * Turn module widths back into a pattern of ones and zeroes, the format the
 * reference encoders of the test suite produce
 *
 * @param  {number[]}   bars   Module widths, starting with a bar
 * @return {string}            The modules, '1' is a bar and '0' is a space
 */
export function toPattern(bars) {
  return bars.map((width, index) => (index % 2 ? '0' : '1').repeat(width)).join('');
}

/**
 * Turn element widths, in narrow and wide elements, into a pattern. Code 39 and
 * ITF are described this way: 'n' is one module and 'w' is three.
 *
 * @param  {string}   elements   One character per element, 'n' or 'w'
 * @param  {number}   [wide]     Width of a wide element in modules
 * @return {string}              The modules, '1' is a bar and '0' is a space
 */
export function fromElements(elements, wide = 3) {
  let pattern = '';

  for (let index = 0; index < elements.length; index++) {
    pattern += (index % 2 ? '0' : '1').repeat(elements[index] === 'w' ? wide : 1);
  }

  return pattern;
}

/**
 * Whether a string is a run of digits of a given length
 *
 * @param  {string}   value      The string to check
 * @param  {number}   [length]   The number of digits it must have, any length when left out
 * @return {boolean}             True when it is
 */
export function isDigits(value, length) {
  if (typeof length === 'number' && value.length !== length) {
    return false;
  }

  return value.length > 0 && /^[0-9]+$/.test(value);
}
