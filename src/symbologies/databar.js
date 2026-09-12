import {toBars, toPattern, isDigits} from './pattern.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    The GS1 DataBar family of ISO/IEC 24724: Omnidirectional, Truncated,
    Limited and Expanded. The stacked and composite forms are out of scope,
    neither language has a command for them.

    Every symbol of the family is built the same way. A number is split over a
    few data characters, each of which is a fixed number of modules in a fixed
    number of elements, and the value of a character says how its modules are
    divided over its elements. The specification describes that division as two
    subsets, the odd numbered elements and the even numbered ones, each of
    which is a combination of n modules over k elements with a widest element;
    a table per symbology says, per range of values, how many modules and
    elements each subset has and how the value splits over the two. The widths
    themselves are not a table, they are the combination the value selects,
    which getWidths() computes.

    The check character is the weighted sum of the element widths of the data
    characters, modulo 79 for Omnidirectional, 89 for Limited and 211 for
    Expanded. In Omnidirectional it picks the two finder patterns, in Limited a
    check character pattern of its own, and in Expanded it is a data character
    like the others.

    The tables, the weights and the finder patterns are the ones of the
    specification, taken from BWIPP, which is MIT licensed, the same source the
    PDF417 symbol characters came from. Every variant is checked against
    bwip-js module for module in test/databar.js, and the two variants a reader
    of ZXing exists for are read back from the paper as well.
*/

/* The data characters of Omnidirectional and Truncated: four of them, the
   outside ones sixteen modules and the inside ones fifteen, in four elements
   each. A row is the highest value of the group, the value the group starts
   at, the modules of the odd and the even subset, the widest element of each,
   and the number of combinations of each */

const OUTSIDE = [
  [160, 0, 12, 4, 8, 1, 161, 1],
  [960, 161, 10, 6, 6, 3, 80, 10],
  [2014, 961, 8, 8, 4, 5, 31, 34],
  [2714, 2015, 6, 10, 3, 6, 10, 70],
  [2840, 2715, 4, 12, 1, 8, 1, 126],
];

const INSIDE = [
  [335, 0, 5, 10, 2, 7, 4, 84],
  [1035, 336, 7, 8, 4, 5, 20, 35],
  [1515, 1036, 9, 6, 6, 3, 48, 10],
  [1596, 1516, 11, 4, 8, 1, 81, 1],
];

/* The weights of the checksum of Omnidirectional, one per element of the four
   data characters, and the nine finder patterns the checksum picks two of */

const OMNI_WEIGHTS = [
  1, 3, 9, 27, 2, 6, 18, 54,
  58, 72, 24, 8, 29, 36, 12, 4,
  74, 51, 17, 32, 37, 65, 48, 16,
  64, 34, 23, 69, 49, 68, 46, 59,
];

const OMNI_FINDERS = [
  [3, 8, 2, 1, 1],
  [3, 5, 5, 1, 1],
  [3, 3, 7, 1, 1],
  [3, 1, 9, 1, 1],
  [2, 7, 4, 1, 1],
  [2, 5, 6, 1, 1],
  [2, 3, 8, 1, 1],
  [1, 5, 7, 1, 1],
  [1, 3, 9, 1, 1],
];

/* The data characters of Limited: two of them, twenty six modules in seven
   elements per subset, and the weights of its checksum */

const LIMITED = [
  [183063, 0, 17, 9, 6, 3, 6538, 28],
  [820063, 183064, 13, 13, 5, 4, 875, 728],
  [1000775, 820064, 9, 17, 3, 6, 28, 6454],
  [1491020, 1000776, 15, 11, 5, 4, 2415, 203],
  [1979844, 1491021, 11, 15, 4, 5, 203, 2408],
  [1996938, 1979845, 19, 7, 8, 1, 17094, 1],
  [2013570, 1996939, 7, 19, 1, 8, 1, 16632],
];

const LIMITED_WEIGHTS = [
  1, 3, 9, 27, 81, 65, 17, 51, 64, 14, 42, 37, 22, 66,
  20, 60, 2, 6, 18, 54, 73, 41, 34, 13, 39, 28, 84, 74,
];

/* The check character of Limited is not a data character: the checksum, 0 to
   88, selects one of these values, whose quotient and remainder over 21 are
   the values of its six spaces and six bars, eight modules each */

const LIMITED_CHECKS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 45, 52, 57, 63, 64, 65, 66, 73, 74, 75, 76, 77, 78, 79, 82,
  126, 127, 128, 129, 130, 132, 141, 142, 143, 144, 145, 146,
  210, 211, 212, 213, 214, 215, 216, 217, 220,
  316, 317, 318, 319, 320, 322, 323, 326, 337,
];

/* The data characters of Expanded: seventeen modules in four elements per
   subset, a value of twelve bits */

const EXPANDED = [
  [347, 0, 12, 5, 7, 2, 87, 4],
  [1387, 348, 10, 7, 5, 4, 52, 20],
  [2947, 1388, 8, 9, 4, 5, 30, 52],
  [3987, 2948, 6, 11, 3, 6, 10, 104],
  [4191, 3988, 4, 13, 1, 8, 1, 204],
];

/* The twelve finder patterns of Expanded, the sequence of them per number of
   symbol characters, and the weights of the checksum, sixteen per finder */

const EXPANDED_FINDERS = [
  [1, 8, 4, 1, 1],
  [1, 1, 4, 8, 1],
  [3, 6, 4, 1, 1],
  [1, 1, 4, 6, 3],
  [3, 4, 6, 1, 1],
  [1, 1, 6, 4, 3],
  [3, 2, 8, 1, 1],
  [1, 1, 8, 2, 3],
  [2, 6, 5, 1, 1],
  [1, 1, 5, 6, 2],
  [2, 2, 9, 1, 1],
  [1, 1, 9, 2, 2],
];

const EXPANDED_SEQUENCES = [
  [0, 1],
  [0, 3, 2],
  [0, 5, 2, 7],
  [0, 9, 2, 7, 4],
  [0, 9, 2, 7, 6, 11],
  [0, 9, 2, 7, 8, 11, 10],
  [0, 1, 2, 3, 4, 5, 6, 7],
  [0, 1, 2, 3, 4, 5, 6, 9, 8],
  [0, 1, 2, 3, 4, 5, 6, 9, 10, 11],
  [0, 1, 2, 3, 4, 7, 6, 9, 8, 11, 10],
];

const EXPANDED_WEIGHTS = [
  -1, -1, -1, -1, -1, -1, -1, -1,
  77, 96, 32, 81, 27, 9, 3, 1,
  20, 60, 180, 118, 143, 7, 21, 63,
  205, 209, 140, 117, 39, 13, 145, 189,
  193, 157, 49, 147, 19, 57, 171, 91,
  132, 44, 85, 169, 197, 136, 186, 62,
  185, 133, 188, 142, 4, 12, 36, 108,
  50, 87, 29, 80, 97, 173, 128, 113,
  150, 28, 84, 41, 123, 158, 52, 156,
  166, 196, 206, 139, 187, 203, 138, 46,
  76, 17, 51, 153, 37, 111, 122, 155,
  146, 119, 110, 107, 106, 176, 129, 43,
  16, 48, 144, 10, 30, 90, 59, 177,
  164, 125, 112, 178, 200, 137, 116, 109,
  70, 210, 208, 202, 184, 130, 179, 115,
  190, 204, 68, 93, 31, 151, 191, 134,
  148, 22, 66, 198, 172, 94, 71, 2,
  40, 154, 192, 64, 162, 54, 18, 6,
  120, 149, 25, 75, 14, 42, 126, 167,
  175, 199, 207, 69, 23, 78, 26, 79,
  103, 98, 83, 38, 114, 131, 182, 124,
  159, 53, 88, 170, 127, 183, 61, 161,
  55, 165, 73, 8, 24, 72, 5, 15,
  89, 100, 174, 58, 160, 194, 135, 45,
];

/* The number of symbol characters a row of an Expanded symbol holds. A
   symbol of one row, which is the only one both languages can print, holds
   twenty two of them */

const SEGMENTS = 22;

/* The height of a symbol in modules: the specification fixes the height of
   Truncated at thirteen modules and of Limited at ten, and asks for at least
   thirty three for Omnidirectional and thirty four for Expanded */

const HEIGHTS = {
  omni: {minimum: 33},
  truncated: {fixed: 13},
  limited: {fixed: 10},
  expanded: {minimum: 34},
};

/* The application identifiers whose length the specification fixes, by their
   first two digits. Every other one is closed with a separator when data
   follows it */

const PREDEFINED = [
  '00', '01', '02', '03', '04',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '31', '32', '33', '34', '35', '36',
  '41',
];

/* The characters of the general purpose field of Expanded that are not
   characters of the data: the separator and the three latches */

const FNC1 = -1;
const LATCH_NUMERIC = -2;
const LATCH_ALPHANUMERIC = -3;
const LATCH_ISO646 = -4;

/**
 * A value as a string of bits
 *
 * @param  {number}   value    The value
 * @param  {number}   length   The number of bits to write it in
 * @return {string}            The bits
 */
function bits(value, length) {
  return value.toString(2).padStart(length, '0');
}

/*
    The three compaction methods of the general purpose field of Expanded.

    Numeric compaction packs two characters, a digit or the separator, in
    seven bits; the pair of two separators does not exist. Alphanumeric
    compaction holds the digits in five bits and the upper case letters and
    six punctuation characters in six, and ISO 646 compaction holds the digits
    in five bits, the letters of both cases in seven and the rest of the
    printable ASCII characters in eight. The tables are the ones of the
    specification, which are runs rather than lists, so they are computed.
*/

const NUMERIC = (() => {
  const table = new Map();

  for (let value = 0; value < 120; value++) {
    const first = Math.floor(value / 11);
    const second = value % 11;

    table.set(
        (first === 10 ? '^' : String(first)) + (second === 10 ? '^' : String(second)),
        bits(value + 8, 7),
    );
  }

  return table;
})();

const NUMERIC_LATCH = '0000';

const ALPHANUMERIC = (() => {
  const table = new Map();

  for (let code = 48; code <= 57; code++) {
    table.set(code, bits(code - 43, 5));
  }

  for (let code = 65; code <= 90; code++) {
    table.set(code, bits(code - 33, 6));
  }

  for (let code = 44; code <= 47; code++) {
    table.set(code, bits(code + 15, 6));
  }

  table.set(42, '111010');
  table.set(FNC1, '01111');
  table.set(LATCH_NUMERIC, '000');
  table.set(LATCH_ISO646, '00100');

  return table;
})();

const ISO646 = (() => {
  const table = new Map();

  for (let code = 48; code <= 57; code++) {
    table.set(code, bits(code - 43, 5));
  }

  for (let code = 65; code <= 90; code++) {
    table.set(code, bits(code - 1, 7));
  }

  for (let code = 97; code <= 122; code++) {
    table.set(code, bits(code - 7, 7));
  }

  for (let code = 37; code <= 47; code++) {
    table.set(code, bits(code + 197, 8));
  }

  for (let code = 58; code <= 63; code++) {
    table.set(code, bits(code + 187, 8));
  }

  table.set(33, '11101000');
  table.set(34, '11101001');
  table.set(95, '11111011');
  table.set(32, '11111100');
  table.set(FNC1, '01111');
  table.set(LATCH_NUMERIC, '000');
  table.set(LATCH_ALPHANUMERIC, '00100');

  return table;
})();

/**
 * The number of combinations of r elements out of n, computed the way the
 * specification describes it, without ever leaving the range of an integer
 *
 * @param  {number}   n   The number to choose from
 * @param  {number}   r   The number to choose
 * @return {number}       The number of combinations
 */
function combinations(n, r) {
  const maximum = Math.max(n - r, r);
  const minimum = Math.min(n - r, r);

  let value = 1;
  let divisor = 1;

  for (let i = n; i > maximum; i--) {
    value *= i;

    if (divisor <= minimum) {
      value /= divisor;
      divisor++;
    }
  }

  for (; divisor <= minimum; divisor++) {
    value /= divisor;
  }

  return value;
}

/**
 * The widths of one subset of a data character: the combination of modules
 * over elements that the value of the subset selects, in the order the
 * specification numbers them.
 *
 * @param  {number}    value        The value of the subset
 * @param  {number}    modules      The modules the subset holds
 * @param  {number}    elements     The elements to divide them over
 * @param  {number}    widest       The widest element the subset allows
 * @param  {boolean}   restricted   True when the subset must hold a narrow element
 * @return {number[]}               The widths, one per element
 */
function getWidths(value, modules, elements, widest, restricted) {
  const widths = new Array(elements);

  let remaining = modules;
  let left = value;
  let mask = 0;
  let combination = 0;

  for (let element = 0; element < elements - 1; element++) {
    let width = 1;

    mask |= 1 << element;

    for (;;) {
      combination = combinations(remaining - width - 1, elements - element - 2);

      if (restricted && mask === 0 && remaining - width - elements * 2 + element * 2 >= -2) {
        combination -= combinations(remaining - width - elements + element, elements - element - 2);
      }

      if (elements - element > 2) {
        let wider = 0;

        for (let module = remaining - width - elements + element + 2; module > widest; module--) {
          wider += combinations(remaining - width - module - 1, elements - element - 3);
        }

        combination -= wider * (elements - element - 1);
      } else if (remaining - width > widest) {
        combination -= 1;
      }

      left -= combination;

      if (left < 0) {
        break;
      }

      width++;
      mask &= ~(1 << element);
    }

    left += combination;
    remaining -= width;
    widths[element] = width;
  }

  widths[elements - 1] = remaining;

  return widths;
}

/**
 * The elements of one data character, the odd and the even subset interleaved,
 * starting with an element of the odd subset
 *
 * @param  {number}       value      The value of the character
 * @param  {Array<number[]>}   table  The table of the character set
 * @param  {number}       elements   The elements of a subset
 * @param  {string}       split      The subset that carries the high part of the value, even or odd
 * @param  {string}       narrow     The subset that must hold a narrow element, even or odd
 * @return {number[]}                The widths, twice the elements of a subset
 */
function character(value, table, elements, split, narrow) {
  const group = table.find((row) => value <= row[0]);
  const [, start, oddModules, evenModules, oddWidest, evenWidest, oddValues, evenValues] = group;

  const remainder = value - start;
  const divisor = split === 'even' ? evenValues : oddValues;

  const odd = getWidths(
      split === 'even' ? Math.floor(remainder / divisor) : remainder % divisor,
      oddModules, elements, oddWidest, narrow === 'odd',
  );

  const even = getWidths(
      split === 'even' ? remainder % divisor : Math.floor(remainder / divisor),
      evenModules, elements, evenWidest, narrow === 'even',
  );

  const widths = [];

  for (let index = 0; index < elements; index++) {
    widths.push(odd[index], even[index]);
  }

  return widths;
}

/**
 * The check digit of a GTIN, the digits weighted three and one from the left
 *
 * @param  {string}   digits   The thirteen digits in front of it
 * @return {number}            The check digit
 */
function checkDigit(digits) {
  let sum = 0;

  for (let index = 0; index < 13; index++) {
    sum += Number(digits[index]) * (index % 2 === 0 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * The fourteen digits of the GTIN a symbol of the (01) application identifier
 * carries. The data is thirteen digits, which the printer completes with the
 * check digit, or fourteen, which has to hold the right one.
 *
 * @param  {string}         data   The value of the barcode
 * @return {string|null}           The digits, or null when the data is not a GTIN
 */
function gtin(data) {
  const value = String(data);

  if (!isDigits(value) || (value.length !== 13 && value.length !== 14)) {
    return null;
  }

  const digits = value.slice(0, 13);
  const check = checkDigit(digits);

  if (value.length === 14 && Number(value[13]) !== check) {
    return null;
  }

  return digits + check;
}

/**
 * Encode a GS1 DataBar Omnidirectional or Truncated symbol, the RSS-14 of the
 * specification: ninety six modules of four data characters, an outside and an
 * inside one per half, with the two finder patterns of the checksum between
 * them. Truncated is the same symbol, thirteen modules tall instead of the
 * thirty three Omnidirectional asks for.
 *
 * @param  {string}         data         The value of the barcode, thirteen or fourteen digits
 * @param  {boolean}        truncated    True for the truncated form
 * @return {Barcode|null}                The barcode, or null when the data is not valid
 */
function rss14(data, truncated) {
  const digits = gtin(data);

  if (digits === null) {
    return null;
  }

  const value = Number(digits.slice(0, 13));
  const left = Math.floor(value / 4537077);
  const right = value % 4537077;

  /* The two halves each hold an outside character of sixteen modules and an
     inside one of fifteen. The inside characters and the outside character of
     the right half are drawn in reverse */

  const first = character(Math.floor(left / 1597), OUTSIDE, 4, 'even', 'even');
  const second = character(left % 1597, INSIDE, 4, 'odd', 'odd').reverse();
  const third = character(Math.floor(right / 1597), OUTSIDE, 4, 'even', 'even').reverse();
  const fourth = character(right % 1597, INSIDE, 4, 'odd', 'odd');

  const widths = [...first, ...second, ...third, ...fourth];

  let checksum = 0;

  for (let index = 0; index < widths.length; index++) {
    checksum += widths[index] * OMNI_WEIGHTS[index];
  }

  checksum %= 79;

  /* Two of the eighty one combinations of the finder patterns do not exist,
     which is what makes the checksum of seventy nine fit in them */

  checksum += checksum >= 8 ? 1 : 0;
  checksum += checksum >= 72 ? 1 : 0;

  const symbol = [
    0, 1, 1,
    ...first,
    ...OMNI_FINDERS[Math.floor(checksum / 9)],
    ...second,
    ...fourth,
    ...OMNI_FINDERS[checksum % 9].slice().reverse(),
    ...third,
    1, 1,
  ];

  return {
    bars: toBars(toPattern(symbol)),
    text: `(01)${digits}`,
    height: truncated ? HEIGHTS.truncated : HEIGHTS.omni,
  };
}

/**
 * Encode a GS1 DataBar Omnidirectional symbol
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function databarOmni(data) {
  return rss14(data, false);
}

/**
 * Encode a GS1 DataBar Truncated symbol
 *
 * @param  {string}         data   The value of the barcode
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function databarTruncated(data) {
  return rss14(data, true);
}

/**
 * Encode a GS1 DataBar Limited symbol: seventy nine modules of two data
 * characters of twenty six modules with an eighteen module check character
 * between them. The symbol only carries the GTINs that start with a zero or a
 * one, the ones a retail item outside the shop has, and it is ten modules
 * tall.
 *
 * @param  {string}         data   The value of the barcode, thirteen or fourteen digits
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function databarLimited(data) {
  const digits = gtin(data);

  if (digits === null || (digits[0] !== '0' && digits[0] !== '1')) {
    return null;
  }

  const value = Number(digits.slice(0, 13));

  const first = character(Math.floor(value / 2013571), LIMITED, 7, 'even', 'even');
  const second = character(value % 2013571, LIMITED, 7, 'even', 'even');

  const widths = [...first, ...second];

  let checksum = 0;

  for (let index = 0; index < widths.length; index++) {
    checksum += widths[index] * LIMITED_WEIGHTS[index];
  }

  checksum %= 89;

  /* The check character is not a data character: the eighty nine values it
     takes are a table, and the value it selects splits over six spaces and six
     bars of eight modules each, with a space and a bar of one module behind
     them */

  const sequence = LIMITED_CHECKS[checksum];
  const spaces = getWidths(Math.floor(sequence / 21), 8, 6, 3, false);
  const bars = getWidths(sequence % 21, 8, 6, 3, false);

  const check = [];

  for (let index = 0; index < 6; index++) {
    check.push(spaces[index], bars[index]);
  }

  check.push(1, 1);

  const symbol = [
    0, 1, 1,
    ...first,
    ...check,
    ...second,
    1, 1, 5,
  ];

  return {
    bars: toBars(toPattern(symbol)),
    text: `(01)${digits}`,
    height: HEIGHTS.limited,
  };
}

/**
 * Split a GS1 element string in the parentheses form into its application
 * identifiers and their values
 *
 * @param  {string}        data   The element string, '(01)09501101530003(17)140917'
 * @return {object|null}          The identifiers, their values and whether each needs a separator, or null
 */
function elements(data) {
  const identifiers = [];
  const values = [];

  let index = 0;

  while (index < data.length) {
    if (data[index] !== '(') {
      return null;
    }

    const close = data.indexOf(')', index);

    if (close < 0) {
      return null;
    }

    const identifier = data.slice(index + 1, close);

    if (!isDigits(identifier) || identifier.length < 2 || identifier.length > 4) {
      return null;
    }

    const next = data.indexOf('(', close);
    const end = next < 0 ? data.length : next;
    const value = data.slice(close + 1, end);

    if (value.length === 0) {
      return null;
    }

    identifiers.push(identifier);
    values.push(value);

    index = end;
  }

  if (identifiers.length === 0) {
    return null;
  }

  return {
    identifiers,
    values,
    separators: identifiers.map((identifier) => !PREDEFINED.includes(identifier.slice(0, 2))),
  };
}

/**
 * The encodation method of an element string: the compressed methods for the
 * element strings a retail item carries, and the general purpose method for
 * everything else. The reference decoders read every one of them.
 *
 * @param  {string[]}   identifiers   The application identifiers
 * @param  {string[]}   values        Their values
 * @return {object}                   The bits of the method field and whether a general purpose field follows
 */
function method(identifiers, values) {
  const dates = ['11', '13', '15', '17'];

  const gtin14 = identifiers[0] === '01' && isDigits(values[0], 14);
  const item = gtin14 && values[0][0] === '9';

  /* (01) with a weight, which the method carries in fifteen bits */

  if (identifiers.length === 2 && item && isDigits(values[1], 6)) {
    if (identifiers[1] === '3103' && Number(values[1]) <= 32767) {
      return {bits: '0100', general: false};
    }

    if (identifiers[1] === '3202' && Number(values[1]) <= 9999) {
      return {bits: '0101', general: false};
    }

    if (identifiers[1] === '3203' && Number(values[1]) <= 22767) {
      return {bits: '0101', general: false};
    }
  }

  /* (01) with a weight of another unit and, when there is one, a date. The
     seven bit methods carry the weight of AI (3100) to (3109), kilograms, and
     of AI (3200) to (3209), pounds, and nothing else of the 31xx and 32xx
     blocks: the length and the width of AI (311x) and the rest go through the
     general purpose field like any other identifier */

  if ((identifiers.length === 2 || identifiers.length === 3) && item) {
    const kilograms = /^310[0-9]$/.test(identifiers[1]);
    const weight = kilograms || /^320[0-9]$/.test(identifiers[1]);
    const date = identifiers.length === 2 || dates.includes(identifiers[2]);

    if (weight && date && isDigits(values[1], 6) && Number(values[1]) <= 99999) {
      const month = identifiers.length === 3 ? Number(values[2].slice(2, 4)) : 1;
      const day = identifiers.length === 3 ? Number(values[2].slice(4, 6)) : 0;

      if (identifiers.length === 2) {
        return {bits: `0111${bits(kilograms ? 0 : 1, 3)}`, general: false};
      }

      if (isDigits(values[2], 6) && month >= 1 && month <= 12 && day >= 0 && day <= 31) {
        const index = dates.indexOf(identifiers[2]);

        return {bits: `0111${bits(index * 2 + (kilograms ? 0 : 1), 3)}`, general: false};
      }
    }
  }

  /* (01) with a price or a rate, which carry their currency in the method and
     the rest of their data in the general purpose field */

  if (identifiers.length >= 2 && item) {
    if (/^392[0-3]$/.test(identifiers[1])) {
      return {bits: '01100', general: true};
    }

    if (/^393[0-3]$/.test(identifiers[1]) && isDigits(values[1].slice(0, 3), 3)) {
      return {bits: '01101', general: true};
    }
  }

  /* (01) without anything the compressed methods hold, and everything else */

  if (gtin14) {
    return {bits: '1', general: true};
  }

  return {bits: '00', general: true};
}

/**
 * Twelve digits as four groups of three, ten bits each
 *
 * @param  {string}   digits   The digits
 * @return {string}            The bits
 */
function fortyBits(digits) {
  let result = '';

  for (let index = 0; index < 12; index += 3) {
    result += bits(Number(digits.slice(index, index + 3)), 10);
  }

  return result;
}

/**
 * The compressed data field of an encodation method, and the data that is left
 * for the general purpose field behind it
 *
 * @param  {string}     encodation    The bits of the method field
 * @param  {string[]}   identifiers   The application identifiers
 * @param  {string[]}   values        Their values
 * @return {object}                   The bits, the characters in front of the general purpose field, and the rest
 */
function compressed(encodation, identifiers, values) {
  const codes = (value) => Array.from(value, (character) => character.charCodeAt(0));

  if (encodation === '00') {
    return {bits: '', prefix: [], from: 0};
  }

  if (encodation === '1') {
    const digits = values[0].slice(0, 13);

    return {bits: bits(Number(digits[0]), 4) + fortyBits(digits.slice(1)), prefix: [], from: 1};
  }

  const item = fortyBits(values[0].slice(1, 13));

  if (encodation === '0100') {
    return {bits: item + bits(Number(values[1]), 15), prefix: [], from: identifiers.length};
  }

  if (encodation === '0101') {
    const weight = Number(values[1]) + (identifiers[1] === '3202' ? 0 : 10000);

    return {bits: item + bits(weight, 15), prefix: [], from: identifiers.length};
  }

  if (encodation.length === 7) {
    const weight = Number(identifiers[1][3] + values[1].slice(1, 6));
    const date = identifiers.length === 3 ?
      Number(values[2].slice(0, 2)) * 384 + (Number(values[2].slice(2, 4)) - 1) * 32 + Number(values[2].slice(4, 6)) :
      38400;

    return {bits: item + bits(weight, 20) + bits(date, 16), prefix: [], from: identifiers.length};
  }

  if (encodation === '01100') {
    return {
      bits: item + bits(Number(identifiers[1][3]), 2),
      prefix: [...codes(values[1]), ...(identifiers.length > 2 ? [FNC1] : [])],
      from: 2,
    };
  }

  /* 01101, a rate: the first three digits of the value are the exponent and
     the currency, the rest is data of the general purpose field */

  return {
    bits: item + bits(Number(identifiers[1][3]), 2) + bits(Number(values[1].slice(0, 3)), 10),
    prefix: [...codes(values[1].slice(3)), ...(identifiers.length > 2 ? [FNC1] : [])],
    from: 2,
  };
}

/**
 * The bits a symbol has left over when the data it holds is this long: the
 * length is rounded up to a whole number of symbol characters, of which there
 * are at least four, and a symbol never ends with a row of one character
 *
 * @param  {number}   length   The bits the data holds, the check character counted
 * @return {number}            The bits that are left over
 */
function padding(length) {
  let total = Math.max(Math.ceil(length / 12) * 12, 48);

  if ((total / 12) % SEGMENTS === 1) {
    total += 12;
  }

  return total - length;
}

/**
 * Encode the general purpose field of an Expanded symbol: the characters of
 * the element strings that the encodation method did not compress, in the
 * three compaction methods of the specification.
 *
 * The method starts in numeric compaction and latches to another one when the
 * data asks for it. A latch back to numeric compaction is worth its bits at a
 * run of six digits, or four when they are the last characters of the field,
 * which is the rule of the specification.
 *
 * @param  {number[]}   characters   The characters, as character codes, with -1 for a separator
 * @param  {number}     offset       The bits in front of the field, the check character counted
 * @return {object|null}             The bits and the compaction it ends in, or null when a character has no encoding
 */
function general(characters, offset) {
  /* ISO 646 compaction holds every character the other two hold, so a
     character that is not in it has no encoding at all: the separator, the
     digits, the letters of both cases and the punctuation of the GS1 character
     set are in, and the characters around them, '@' and '^' among them, are
     not */

  for (const code of characters) {
    if (!ISO646.has(code)) {
      return null;
    }
  }

  /* How long the run of digits, of characters of alphanumeric compaction and
     of characters only ISO 646 compaction holds is, from every position */

  const numbers = new Array(characters.length + 2).fill(0);
  const letters = new Array(characters.length + 1).fill(0);
  const iso646 = new Array(characters.length + 1).fill(9999);

  numbers[characters.length + 1] = -1;

  const pair = (index) => {
    const first = characters[index] === FNC1 ? '^' : String.fromCharCode(characters[index]);
    const second = index < characters.length - 1 ?
      (characters[index + 1] === FNC1 ? '^' : String.fromCharCode(characters[index + 1])) :
      '0';

    return first + second;
  };

  for (let index = characters.length - 1; index >= 0; index--) {
    numbers[index] = NUMERIC.has(pair(index)) ? numbers[index + 2] + 2 : 0;
    letters[index] = ALPHANUMERIC.has(characters[index]) ? letters[index + 1] + 1 : 0;
    iso646[index] = ISO646.has(characters[index]) && !ALPHANUMERIC.has(characters[index]) ?
      0 :
      iso646[index + 1] + 1;
  }

  let result = '';
  let mode = 'numeric';
  let index = 0;

  while (index < characters.length) {
    if (mode === 'numeric') {
      if (index <= characters.length - 2) {
        const value = NUMERIC.get(pair(index));

        if (value) {
          result += value;
          index += 2;
          continue;
        }

        result += NUMERIC_LATCH;
        mode = 'alphanumeric';
        continue;
      }

      const code = characters[index];

      if (code < 48 || code > 57) {
        result += NUMERIC_LATCH;
        mode = 'alphanumeric';
        continue;
      }

      /* The last digit of the field, where the symbol has four to six bits
         left, is the digit plus one in four bits, and a pair with a separator
         behind it everywhere else */

      const left = padding(offset + result.length);

      if (left >= 4 && left <= 6) {
        result += bits(code - 47, 4) + '0'.repeat(left - 4);
        index += 1;
        continue;
      }

      result += NUMERIC.get(`${String.fromCharCode(code)}^`);
      index += 1;
      continue;
    }

    const table = mode === 'alphanumeric' ? ALPHANUMERIC : ISO646;
    const code = characters[index];

    if (code === FNC1) {
      result += table.get(FNC1);
      mode = 'numeric';
      index += 1;
      continue;
    }

    if (mode === 'alphanumeric') {
      if (ISO646.has(code) && !ALPHANUMERIC.has(code)) {
        result += ALPHANUMERIC.get(LATCH_ISO646);
        mode = 'iso646';
        continue;
      }

      if (numbers[index] >= 6 || (numbers[index] >= 4 && index + numbers[index] === characters.length)) {
        result += ALPHANUMERIC.get(LATCH_NUMERIC);
        mode = 'numeric';
        continue;
      }
    } else {
      if (numbers[index] >= 4 && iso646[index] >= 10) {
        result += ISO646.get(LATCH_NUMERIC);
        mode = 'numeric';
        continue;
      }

      if (letters[index] >= 5 && iso646[index] >= 10) {
        result += ISO646.get(LATCH_ALPHANUMERIC);
        mode = 'alphanumeric';
        continue;
      }
    }

    const value = table.get(code);

    if (!value) {
      return null;
    }

    result += value;
    index += 1;
  }

  /* A symbol holds twenty two characters of twelve bits, the check character
     and the linkage bit counted, so a field that is longer than this is data
     no symbol of this family can carry */

  if (result.length >= 252) {
    return null;
  }

  return {bits: result, mode};
}

/**
 * Encode a GS1 DataBar Expanded symbol: a GS1 element string in four to
 * twenty two symbol characters of seventeen modules, in pairs with a finder
 * pattern in front of each pair. The stacked form is out of scope, this is the
 * symbol of one row that both languages print.
 *
 * @param  {string}         data   The element string, with the identifiers in parentheses
 * @return {Barcode|null}          The barcode, or null when the data is not valid
 */
export function databarExpanded(data) {
  const value = String(data);
  const parsed = elements(value);

  if (parsed === null) {
    return null;
  }

  const {identifiers, values, separators} = parsed;
  const encodation = method(identifiers, values);
  const field = compressed(encodation.bits, identifiers, values);

  /* The data of the identifiers the method did not compress, with a separator
     behind every one whose length the specification does not fix */

  const characters = [...field.prefix];

  for (let index = field.from; index < identifiers.length; index++) {
    for (const character of identifiers[index] + values[index]) {
      characters.push(character.charCodeAt(0));
    }

    if (index < identifiers.length - 1 && separators[index]) {
      characters.push(FNC1);
    }
  }

  /* One bit of linkage, the method, two bits that say how long the symbol is
     when the method allows a general purpose field, the compressed field and
     the general purpose field itself */

  const variable = encodation.general ? 2 : 0;
  const offset = 13 + encodation.bits.length + variable + field.bits.length;

  const encoded = general(characters, offset);

  if (encoded === null) {
    return null;
  }

  const length = offset + encoded.bits.length;
  const left = padding(length);
  const total = (length + left) / 12;

  if (total > SEGMENTS) {
    return null;
  }

  let fill = '';

  while (fill.length < left) {
    fill += '00100';
  }

  fill = fill.slice(0, left);

  /* A field that ends in numeric compaction shifts to alphanumeric first, so
     that a decoder does not read the fill as another pair of digits */

  if (encoded.mode === 'numeric') {
    fill = `0000${fill}`.slice(0, left);
  }

  const binary = '0' +
    encodation.bits +
    (encodation.general ? (total % 2 === 1 ? '1' : '0') + (total <= 14 ? '0' : '1') : '') +
    field.bits +
    encoded.bits +
    fill;

  /* Every twelve bits are one data character, drawn forwards and backwards by
     turns, with the check character in front of them */

  const count = binary.length / 12;
  const sequence = EXPANDED_SEQUENCES[Math.floor((count - 2) / 2)];
  const widths = [];
  const drawn = [];

  for (let index = 0; index < count; index++) {
    const parts = character(parseInt(binary.slice(index * 12, index * 12 + 12), 2), EXPANDED, 4, 'even', 'odd');
    const elements = index % 2 === 0 ? parts.reverse() : parts;

    widths.push(...elements);
    drawn.push(elements);
  }

  const weights = [];

  for (const finder of sequence) {
    weights.push(...EXPANDED_WEIGHTS.slice(finder * 16, finder * 16 + 16));
  }

  let checksum = 0;

  for (let index = 0; index < widths.length; index++) {
    checksum += widths[index] * weights[index + 8];
  }

  checksum = (checksum % 211) + (count - 3) * 211;

  drawn.unshift(character(checksum, EXPANDED, 4, 'even', 'odd'));

  const symbol = [0, 1, 1];

  for (let index = 0; index < drawn.length; index++) {
    symbol.push(...drawn[index]);

    if (index % 2 === 0) {
      symbol.push(...EXPANDED_FINDERS[sequence[index / 2]]);
    }
  }

  symbol.push(1, 1);

  return {bars: toBars(toPattern(symbol)), text: value, height: HEIGHTS.expanded};
}
