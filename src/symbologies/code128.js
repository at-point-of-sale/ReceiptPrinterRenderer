import {toBars} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    Code 128, GS1-128 and the automatic variant.

    Every symbol is eleven modules, three bars and three spaces, and the stop
    symbol is thirteen. A symbol carries a value of 0 to 102, and what that
    value means depends on the code set: A has the control characters and the
    upper case letters, B has the printable ASCII characters, and C packs two
    digits in one symbol. The check symbol is the weighted sum of the values,
    modulo 103.

    ESC/POS passes the code set selection through in the data, as {A, {B or {C,
    and has escapes for the function characters, which this module parses.
    StarPRNT strips the selection, so a StarPRNT barcode is encoded the way the
    automatic variant is.
*/

const BARS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '1100011101011',
];

const START = {A: 103, B: 104, C: 105};
const SWITCH = {A: 101, B: 100, C: 99};
const SHIFT = 98;
const STOP = 106;

/* The function characters, per code set. FNC1 is the same symbol everywhere,
   FNC4 is the symbol that selects the other set in A and B */

const FUNCTIONS = {
  A: {1: 102, 2: 97, 3: 96, 4: 101},
  B: {1: 102, 2: 97, 3: 96, 4: 100},
  C: {1: 102},
};

/**
 * The value of a character in a code set, or -1 when the set cannot carry it
 *
 * @param  {string}   character   The character
 * @param  {string}   set         'A' or 'B'
 * @return {number}               The symbol value, or -1
 */
function value(character, set) {
  const code = character.charCodeAt(0);

  if (set === 'A') {
    if (code < 32) {
      return code + 64;
    }

    return code < 96 ? code - 32 : -1;
  }

  return code >= 32 && code < 128 ? code - 32 : -1;
}

/**
 * Parse the data of an ESC/POS Code 128 barcode into the symbols it asks for.
 * The escapes are two characters: {A, {B and {C select a code set, {1 to {4 are
 * the function characters, {S is the shift, and {{ is a brace.
 *
 * @param  {string}        data   The data of the barcode
 * @return {object[]|null}        The items, or null when an escape is not valid
 */
export function parse(data) {
  const items = [];

  for (let index = 0; index < data.length; index++) {
    if (data[index] !== '{') {
      items.push({type: 'character', value: data[index]});
      continue;
    }

    const escape = data[index + 1];

    index++;

    if (escape === 'A' || escape === 'B' || escape === 'C') {
      items.push({type: 'set', value: escape});
    } else if (escape >= '1' && escape <= '4') {
      items.push({type: 'function', value: Number(escape)});
    } else if (escape === 'S') {
      items.push({type: 'shift'});
    } else if (escape === '{') {
      items.push({type: 'character', value: '{'});
    } else {
      return null;
    }
  }

  return items;
}

/**
 * The human readable text of a parsed barcode: the characters, without the
 * escapes, which is what printer firmware prints below the bars
 *
 * @param  {object[]}   items   The items of parse()
 * @return {string}             The text
 */
function readable(items) {
  return items
      .filter((item) => item.type === 'character')
      .map((item) => item.value)
      .join('');
}

/**
 * Turn the items of parse() into symbol values, switching code set where the
 * data asks for it and where the current set cannot carry a character
 *
 * @param  {object[]}        items   The items of parse()
 * @return {number[]|null}           The symbol values, start symbol included, or null
 */
function encode(items) {
  if (!items.length || items[0].type !== 'set') {
    return null;
  }

  let set = items[0].value;

  const codes = [START[set]];
  const queue = items.slice(1);

  let shift = false;

  while (queue.length) {
    const item = queue.shift();

    if (item.type === 'set') {
      if (item.value !== set) {
        codes.push(SWITCH[item.value]);
        set = item.value;
      }

      continue;
    }

    if (item.type === 'function') {
      const code = FUNCTIONS[set][item.value];

      if (typeof code !== 'number') {
        return null;
      }

      codes.push(code);
      continue;
    }

    if (item.type === 'shift') {
      if (set === 'C') {
        return null;
      }

      codes.push(SHIFT);
      shift = true;
      continue;
    }

    /* Code set C takes two digits per symbol. A character that is not a digit,
       or a digit without a partner, needs another code set */

    if (set === 'C' && !shift) {
      const next = queue[0];

      if (/^[0-9]$/.test(item.value) && next && next.type === 'character' && /^[0-9]$/.test(next.value)) {
        codes.push(Number(item.value + next.value));
        queue.shift();
        continue;
      }

      codes.push(SWITCH.B);
      set = 'B';
    }

    const current = shift ? (set === 'A' ? 'B' : 'A') : set;
    const symbol = value(item.value, current);

    shift = false;

    if (symbol < 0) {
      /* The other set of A and B can carry everything this one cannot */

      const other = set === 'A' ? 'B' : 'A';
      const alternative = value(item.value, other);

      if (alternative < 0) {
        return null;
      }

      codes.push(SWITCH[other]);
      codes.push(alternative);
      set = other;
      continue;
    }

    codes.push(symbol);
  }

  return codes.length > 1 ? codes : null;
}

/**
 * The bars of a list of symbol values, with the check symbol and the stop
 * symbol behind them
 *
 * @param  {number[]}   codes   The symbol values, start symbol included
 * @return {number[]}           The module widths
 */
function bars(codes) {
  let pattern = '';
  let sum = codes[0];

  for (let index = 0; index < codes.length; index++) {
    pattern += BARS[codes[index]];

    if (index > 0) {
      sum += codes[index] * index;
    }
  }

  pattern += BARS[sum % 103] + BARS[STOP];

  return toBars(pattern);
}

/**
 * Whether every character of a value fits in a code set. Code set A carries the
 * character codes 0 to 95 and code set B 32 to 127, so together they carry the
 * whole of ASCII and nothing above it. A byte no code set can carry makes the
 * barcode invalid, which a printer answers by printing nothing.
 *
 * @param  {string}    value   The value of the barcode
 * @return {boolean}           True when the value can be encoded
 */
function encodable(value) {
  for (const character of value) {
    if (character.charCodeAt(0) > 127) {
      return false;
    }
  }

  return true;
}

/**
 * Pick the code sets for a value, the way a printer does when the data does not
 * say: code set C for a run of four or more digits, and for a value that starts
 * with two, code set A when the value needs the control characters and code set
 * B for everything else.
 *
 * @param  {string}     data   The value of the barcode
 * @return {object[]}          The items, in the format of parse()
 */
export function select(data) {
  const items = [];

  /* eslint-disable require-jsdoc */

  const characters = (value) => Array.from(value).map((character) => ({type: 'character', value: character}));
  /* The code sets are ranges of character codes, control characters included,
     which is what the specification says they are */

  /* eslint-disable no-control-regex */

  const setA = (value) => (value.match(/^[\x00-\x5f]*/) || [''])[0].length;
  const setB = (value) => (value.match(/^[\x20-\x7f]*/) || [''])[0].length;
  const pairs = (value) => (value.match(/^([0-9]{2})*/) || [''])[0];

  /* eslint-enable no-control-regex */
  /* eslint-enable require-jsdoc */

  /**
   * Take the digit pairs of the value in code set C, and continue in A or B
   *
   * @param  {string}   value   What is left of the value
   */
  function fromC(value) {
    const digits = pairs(value);

    items.push({type: 'set', value: 'C'}, ...characters(digits));

    const rest = value.slice(digits.length);

    if (rest.length) {
      fromAB(rest, setA(rest) >= setB(rest));
    }
  }

  /**
   * Take what fits in code set A or B, and switch when the value needs another
   * set
   *
   * @param  {string}    value   What is left of the value
   * @param  {boolean}   isA     Whether this part goes in code set A
   */
  function fromAB(value, isA) {
    /* eslint-disable-next-line no-control-regex */
    const range = isA ? /^([\x00-\x5f]+?)(([0-9]{2}){2,})([^0-9]|$)/ : /^([\x20-\x7f]+?)(([0-9]{2}){2,})([^0-9]|$)/;
    const digits = value.match(range);

    /* A run of four or more digits is worth a switch to code set C */

    if (digits) {
      items.push({type: 'set', value: isA ? 'A' : 'B'}, ...characters(digits[1]));
      fromC(value.slice(digits[1].length));
      return;
    }

    const fits = value.slice(0, isA ? setA(value) : setB(value));

    items.push({type: 'set', value: isA ? 'A' : 'B'}, ...characters(fits));

    if (fits.length < value.length) {
      fromAB(value.slice(fits.length), !isA);
    }
  }

  if (pairs(data).length >= 2) {
    fromC(data);
  } else {
    fromAB(data, setA(data) > setB(data));
  }

  return items;
}

/**
 * Encode a Code 128 barcode from data that carries its code set selection, the
 * way ESC/POS passes it to the printer
 *
 * @param  {string}         data   The value of the barcode, starting with {A, {B or {C
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function code128(data) {
  const items = parse(String(data));

  if (items === null) {
    return null;
  }

  const codes = encode(items);

  return codes === null ? null : {bars: bars(codes), text: readable(items)};
}

/**
 * Encode a Code 128 barcode, picking the code sets for the data
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function code128auto(data) {
  const value = String(data);

  if (value.length === 0 || !encodable(value)) {
    return null;
  }

  const codes = encode(select(value));

  return codes === null ? null : {bars: bars(codes), text: value};
}

/**
 * Encode a GS1-128 barcode, which is a Code 128 with FNC1 behind the start
 * symbol and the code sets picked for the data
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function gs1128(data) {
  const value = String(data);

  if (value.length === 0 || !encodable(value)) {
    return null;
  }

  const items = select(value);
  const codes = encode([items[0], {type: 'function', value: 1}, ...items.slice(1)]);

  return codes === null ? null : {bars: bars(codes), text: value};
}
