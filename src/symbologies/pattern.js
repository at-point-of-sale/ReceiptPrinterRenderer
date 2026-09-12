/**
 * A barcode, as the symbology generators return it
 *
 * @typedef {object} Barcode
 * @property {number[]} bars   Module widths, alternating bar and space, starting with a bar
 * @property {string} text     The human readable text of this barcode, as it is printed
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
