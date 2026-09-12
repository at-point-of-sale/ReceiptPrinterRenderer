import {toBars} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    Codabar, also known as NW-7.

    Seven elements per character, four bars and three spaces, of which two or
    three are wide. A wide element is two modules. The symbol starts and stops
    with one of the four letters A to D, which printer firmware adds when the
    data does not carry them.
*/

const ENCODINGS = {
  '0': '101010011', '1': '101011001', '2': '101001011', '3': '110010101',
  '4': '101101001', '5': '110101001', '6': '100101011', '7': '100101101',
  '8': '100110101', '9': '110100101',
  '-': '101001101', '$': '101100101', ':': '1101011011', '/': '1101101011',
  '.': '1101101101', '+': '1011011011',
  'A': '1011001001', 'B': '1001001011', 'C': '1010010011', 'D': '1010011001',
};

/**
 * Encode a Codabar barcode. Data without a start and stop character gets an A
 * on both sides, the way printer firmware does.
 *
 * @param  {string}         data   The value of the barcode, with or without start and stop
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function codabar(data) {
  let value = String(data).toUpperCase();

  if (value.length === 0) {
    return null;
  }

  const start = /^[A-D]/.test(value);
  const stop = /[A-D]$/.test(value);

  if (!start && !stop) {
    value = `A${value}A`;
  } else if (!start || !stop || value.length < 3) {
    return null;
  }

  const body = value.slice(1, -1);

  if (body.length === 0 || /[A-D]/.test(body)) {
    return null;
  }

  let pattern = '';

  for (let index = 0; index < value.length; index++) {
    if (typeof ENCODINGS[value[index]] !== 'string') {
      return null;
    }

    pattern += (index ? '0' : '') + ENCODINGS[value[index]];
  }

  return {bars: toBars(pattern), text: value};
}

export default codabar;
