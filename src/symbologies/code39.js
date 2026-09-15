import {toBars, fromElements} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    Code 39.

    Every character is nine elements, five bars and four spaces, of which three
    are wide. A wide element is three modules, as printer firmware draws it, and
    the characters are separated by one narrow space.
*/

const ENCODINGS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
  'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
  'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
  'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
  'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
  'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

/**
 * Encode a Code 39 barcode. The symbology has no check digit, and printer
 * firmware adds the start and stop character itself, so the data is the text
 * between them. Data that already carries them, `*TEXT*`, is encoded once and
 * not wrapped twice: an Epson TM-T70 draws bars for such a row. Lower case is
 * printed in upper case, characters outside the set are refused.
 *
 * The human readable text carries the asterisks the bars do, the way the
 * TM-T70 prints it: `*ABC 012*` for the data `ABC 012`.
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function code39(data) {
  const value = String(data).toUpperCase();

  if (value.length === 0) {
    return null;
  }

  const wrapped = value.length >= 2 && value.startsWith('*') && value.endsWith('*');
  const body = wrapped ? value.slice(1, -1) : value;

  if (body.length === 0) {
    return null;
  }

  let pattern = fromElements(ENCODINGS['*']);

  for (const character of body) {
    if (character === '*' || typeof ENCODINGS[character] !== 'string') {
      return null;
    }

    pattern += '0' + fromElements(ENCODINGS[character]);
  }

  pattern += '0' + fromElements(ENCODINGS['*']);

  return {bars: toBars(pattern), text: `*${body}*`, spread: true};
}

export default code39;
