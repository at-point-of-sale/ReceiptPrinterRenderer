import clusters from '../../generated/pdf417.js';

/*
    PDF417, ISO/IEC 15438.

    A PDF417 symbol is a stack of rows. Every row holds the same number of
    codewords: a row indicator, then the data columns, then a second row
    indicator, between a start and a stop pattern. A codeword is seventeen
    modules wide, four bars and four spaces, drawn from the table in
    generated/pdf417.js, which holds the symbol characters of the specification.

    The data of a symbol is a list of codewords of 0 to 928, produced by the
    high level encoder below: a length descriptor, the data in one of the three
    compaction modes, padding, and the Reed-Solomon check codewords of the error
    correction level over all of that.

    Everything here is the specification, with two choices of our own, the
    automatic size and the compaction the encoder picks, which are documented
    where they are made.
*/

/**
 * A PDF417 symbol, as the encoder returns it
 *
 * @typedef {object} Pdf417Symbol
 * @property {number[][]} modules   One array per row, one module per entry, 1 is a bar
 * @property {number} columns       Number of data columns of the symbol
 * @property {number} rows          Number of rows of the symbol
 * @property {number} errorLevel    The error correction level the symbol was built with, 0 to 8
 */

/**
 * How a symbol is built, as the parsers and the painter pass it on
 *
 * @typedef {object} Pdf417Options
 * @property {number} [columns]             Data columns, 1 to 30, 0 or left out for automatic
 * @property {number} [rows]                Rows, 3 to 90, 0 or left out for automatic
 * @property {number|string} [errorLevel]   Error correction level, 0 to 8, or 'auto'
 * @property {number} [errorRatio]          Error correction codewords per ten data codewords, for 'auto'
 * @property {boolean} [truncated]          Leave out the right row indicator and the stop pattern
 * @property {number} [rowHeight]           Height of a row in modules, which only the automatic size uses
 */

/* The arithmetic of the error correction is modulo 929, and a codeword is a
   value below it. The values from 900 up are the mode latches, so the data of a
   symbol only ever uses 0 to 899 */

const MODULUS = 929;

/* The mode latches of the high level encoder */

const LATCH_TEXT = 900;
const LATCH_BYTE = 901;
const LATCH_NUMERIC = 902;
const LATCH_BYTE_SIX = 924;

/* The codeword a symbol is padded with, which is the latch to text compaction:
   padding is read as a mode change that is never used */

const PAD = 900;

/* The largest symbol holds 928 codewords. Two of those are the check codewords
   of error correction level 0 and one is the length descriptor, so the high
   level encoder may produce 925 codewords, not one more, whatever the size and
   the level of the symbol are */

const MAX_CODEWORDS = 928;
const MAX_DATA = 925;

/*
    The smallest data area of a symbol, the length descriptor included.

    A data area of two is a length descriptor and one codeword, with no room for
    the padding codeword the specification's own examples always leave, and
    readers refuse it: neither ZXing nor bwip-js produces or accepts a symbol
    like that. One codeword of data is one or two characters, which a receipt
    does print, so the sizing asks for three data codewords and the padding
    fills the third.
*/

const MIN_DATA = 3;

const MAX_COLUMNS = 30;
const MIN_ROWS = 3;
const MAX_ROWS = 90;

/* The start and the stop pattern, as the widths of their elements, starting
   with a bar. The start pattern is seventeen modules, the stop pattern eighteen,
   the last of which is the bar that closes the symbol. A truncated symbol keeps
   that one bar and nothing else of the stop pattern. */

const START_PATTERN = [8, 1, 1, 1, 1, 1, 1, 3];
const STOP_PATTERN = [7, 1, 1, 3, 1, 1, 1, 2, 1];

/* The number of modules of a symbol character, and of the elements a codeword
   is drawn from */

const SYMBOL_MODULES = 17;

/*
    Text compaction, ISO/IEC 15438 table 3.

    Two characters go in one codeword, each as a value of 0 to 29, in one of
    four sub modes. The strings below are the characters of the four sub modes
    in the order of their values; a \u0001 stands for a value that is not a character
    but one of the latches and shifts, which are in LATCHES and SHIFTS.
*/

const TEXT_ALPHA = 0;

/* The four sub modes, in the order they are numbered in the tables below: alpha,
   lower, mixed and punctuation */

const SUBMODES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ \u0001\u0001\u0001',
  'abcdefghijklmnopqrstuvwxyz \u0001\u0001\u0001',
  '0123456789&\r\t,:#-.$/+%*=^\u0001 \u0001\u0001\u0001',
  ';<>@[\\]_`~!\r\t,:\n-.$/"|*()?{}\'\u0001',
];

/*
    How the encoder moves from one sub mode to another, by the sub mode it is in
    and the one it needs. A latch is one or two values and stays, a shift is one
    value and holds for one character only.

    Alpha reaches punctuation through mixed, lower reaches alpha through mixed,
    and punctuation reaches everything through alpha, which is what the sub mode
    tables allow.
*/

const LATCHES = [
  [[], [27], [28], [28, 25]],
  [[28, 28], [], [28], [28, 25]],
  [[28], [27], [], [25]],
  [[29], [29, 27], [29, 28], []],
];

const SHIFTS = [
  [-1, -1, -1, 29],
  [27, -1, -1, 29],
  [-1, -1, -1, 29],
  [-1, -1, -1, -1],
];

/* The value a text compaction segment of an odd number of characters is padded
   with. It is a shift to punctuation in three of the sub modes and a latch to
   alpha in the fourth, and in both cases it stands in front of a mode latch or
   the end of the data, so it never encodes anything */

const TEXT_PAD = 29;

/*
    The value of every character in every sub mode, by its byte, -1 where the
    sub mode does not have it. Characters of 128 and up are not text at all,
    they are encoded as bytes.
*/

const TEXT_VALUES = (() => {
  const table = new Array(128);

  for (let code = 0; code < 128; code++) {
    const values = [-1, -1, -1, -1];

    for (let option = 0; option < SUBMODES.length; option++) {
      const index = SUBMODES[option].indexOf(String.fromCharCode(code));

      if (code !== 1 && index >= 0) {
        values[option] = index;
      }
    }

    table[code] = values.some((value) => value >= 0) ? values : null;
  }

  return table;
})();

/*
    The two lengths that decide which compaction the encoder uses.

    Numeric compaction packs a run of digits in a bit under three digits per
    codeword, text compaction in two, so a run of digits is worth the latch from
    thirteen digits on, which is the number the specification names as well. A
    run of characters that text compaction can hold is worth the latch from five
    characters on, shorter runs are cheaper as bytes. Both are the rule of the
    reference encoders of the specification.
*/

const NUMERIC_RUN = 13;
const TEXT_RUN = 5;

/* The number of digits numeric compaction takes in one go */

const NUMERIC_GROUP = 44;

/* The number of bytes byte compaction packs into five codewords */

const BYTE_GROUP = 6;

/*
    The error correction level the automatic mode picks, by the number of data
    codewords, which is the recommendation of the specification: level 2 up to
    40 data codewords, 3 up to 160, 4 up to 320 and 5 up to 863. Above that the
    recommendation stops, and so does what fits: 864 data codewords and the 64
    check codewords of level 5 are the largest symbol there is, so more data
    than that only fits at a level the receipt asks for itself.
*/

const RECOMMENDED = [
  {limit: 40, level: 2},
  {limit: 160, level: 3},
  {limit: 320, level: 4},
  {limit: 863, level: 5},
];

/*
    The shape the automatic size aims at: a symbol three times as wide as it is
    tall. Printers pick a shape rather than the smallest symbol, because a
    symbol of one column and ninety rows is unreadable on paper, and three to
    one is the shape the printers of both languages produce.
*/

const ASPECT = 3;

/* The height of a row in modules the automatic size assumes when the caller
   does not say, which is the default of both printer languages */

const DEFAULT_ROW_HEIGHT = 3;

/* The generator polynomials of the error correction, one per level, computed
   the first time a level is used */

const generators = [];

/**
 * The number of error correction codewords of a level, which is two to the
 * power of the level plus one: 2 codewords at level 0 up to 512 at level 8
 *
 * @param  {number}   level   Error correction level, 0 to 8
 * @return {number}           Number of error correction codewords
 */
function errorCodewords(level) {
  return 2 << level;
}

/**
 * The generator polynomial of an error correction level, as its coefficients
 * from the lowest power up, without the leading one.
 *
 * It is the product of (x - 3^i) for i of 1 to the number of check codewords,
 * over GF(929), where 3 is the primitive element of the field. The
 * specification prints these as tables; they are computed here instead, which
 * is the same thing and a lot less to get wrong.
 *
 * @param  {number}     level   Error correction level, 0 to 8
 * @return {number[]}           The coefficients
 */
function generator(level) {
  if (generators[level]) {
    return generators[level];
  }

  const count = errorCodewords(level);

  let polynomial = [1];
  let root = 1;

  for (let index = 0; index < count; index++) {
    root = (root * 3) % MODULUS;

    const next = new Array(polynomial.length + 1).fill(0);

    for (let power = 0; power < polynomial.length; power++) {
      next[power + 1] = (next[power + 1] + polynomial[power]) % MODULUS;
      next[power] = (next[power] + (MODULUS - root) * polynomial[power]) % MODULUS;
    }

    polynomial = next;
  }

  generators[level] = polynomial.slice(0, count);

  return generators[level];
}

/**
 * The error correction codewords of the data of a symbol: the remainder of the
 * data polynomial divided by the generator polynomial, negated, in the order
 * they are appended to the data.
 *
 * @param  {number[]}   data    The data codewords, the length descriptor first
 * @param  {number}     level   Error correction level, 0 to 8
 * @return {number[]}           The check codewords
 */
function errorCorrection(data, level) {
  const count = errorCodewords(level);
  const coefficients = generator(level);
  const remainder = new Array(count).fill(0);

  for (const codeword of data) {
    const factor = (codeword + remainder[count - 1]) % MODULUS;

    for (let index = count - 1; index >= 1; index--) {
      remainder[index] = (remainder[index - 1] + MODULUS - (factor * coefficients[index]) % MODULUS) % MODULUS;
    }

    remainder[0] = (MODULUS - (factor * coefficients[0]) % MODULUS) % MODULUS;
  }

  for (let index = 0; index < count; index++) {
    if (remainder[index] !== 0) {
      remainder[index] = MODULUS - remainder[index];
    }
  }

  return remainder.reverse();
}

/**
 * The number of digits at a position
 *
 * @param  {Uint8Array}   bytes   The data
 * @param  {number}       start   Where to look
 * @return {number}               Number of bytes that are digits
 */
function digitRun(bytes, start) {
  let index = start;

  while (index < bytes.length && bytes[index] >= 0x30 && bytes[index] <= 0x39) {
    index++;
  }

  return index - start;
}

/**
 * The number of characters at a position that text compaction can hold. A run
 * of digits that is long enough for numeric compaction ends it, so that the
 * cheaper mode wins.
 *
 * @param  {Uint8Array}   bytes   The data
 * @param  {number}       start   Where to look
 * @return {number}               Number of bytes that are text
 */
function textRun(bytes, start) {
  let index = start;

  while (index < bytes.length && bytes[index] < 128 && TEXT_VALUES[bytes[index]] !== null) {
    if (index > start && digitRun(bytes, index) >= NUMERIC_RUN) {
      break;
    }

    index++;
  }

  return index - start;
}

/**
 * The number of bytes at a position that are worth encoding as bytes, which is
 * everything up to the next run that one of the other two modes holds better.
 * It is never zero, so the encoder always moves on.
 *
 * @param  {Uint8Array}   bytes   The data
 * @param  {number}       start   Where to look
 * @return {number}               Number of bytes
 */
function binaryRun(bytes, start) {
  let index = start + 1;

  while (index < bytes.length) {
    if (digitRun(bytes, index) >= NUMERIC_RUN || textRun(bytes, index) >= TEXT_RUN) {
      break;
    }

    index++;
  }

  return index - start;
}

/**
 * Encode a run of text in text compaction, as values of 0 to 29
 *
 * @param  {Uint8Array}   bytes     The data
 * @param  {number}       start     First byte of the run
 * @param  {number}       count     Number of bytes of the run
 * @param  {number}       submode   The sub mode the encoder is in
 * @param  {number[]}     values    The values, appended to
 * @return {number}                 The sub mode the encoder is in afterwards
 */
function encodeText(bytes, start, count, submode, values) {
  let current = submode;

  for (let index = start; index < start + count; index++) {
    const character = TEXT_VALUES[bytes[index]];

    if (character[current] >= 0) {
      values.push(character[current]);
      continue;
    }

    /* A shift encodes one character of another sub mode and stays in this one,
       which is only worth it when the character behind it is in this sub mode
       as well, otherwise the latch that follows anyway can come first */

    const next = index + 1 < start + count ? TEXT_VALUES[bytes[index + 1]] : null;
    const shiftable = next === null || next[current] >= 0;

    let target = -1;

    for (let option = 0; shiftable && option < SHIFTS[current].length; option++) {
      if (character[option] >= 0 && SHIFTS[current][option] >= 0) {
        target = option;
        break;
      }
    }

    if (target >= 0) {
      values.push(SHIFTS[current][target], character[target]);
      continue;
    }

    /* Otherwise latch to the sub mode that has the character and is the
       cheapest to reach */

    for (let option = 0; option < LATCHES[current].length; option++) {
      if (character[option] < 0) {
        continue;
      }

      if (target < 0 || LATCHES[current][option].length < LATCHES[current][target].length) {
        target = option;
      }
    }

    values.push(...LATCHES[current][target], character[target]);

    current = target;
  }

  return current;
}

/**
 * Encode a run of digits in numeric compaction: groups of up to 44 digits, each
 * of them one big number with a 1 in front of it, in base 900
 *
 * @param  {Uint8Array}   bytes       The data
 * @param  {number}       start       First byte of the run
 * @param  {number}       count       Number of digits of the run
 * @param  {number[]}     codewords   The codewords, appended to
 */
function encodeNumeric(bytes, start, count, codewords) {
  for (let offset = 0; offset < count; offset += NUMERIC_GROUP) {
    const length = Math.min(NUMERIC_GROUP, count - offset);
    const digits = [1];

    for (let index = 0; index < length; index++) {
      digits.push(bytes[start + offset + index] - 0x30);
    }

    /* Divide the number by 900 over and over, the remainders are the codewords,
       the last one first */

    const group = [];

    let first = 0;

    while (first < digits.length) {
      let remainder = 0;

      for (let index = first; index < digits.length; index++) {
        const value = remainder * 10 + digits[index];

        digits[index] = Math.floor(value / 900);
        remainder = value % 900;
      }

      group.unshift(remainder);

      while (first < digits.length && digits[first] === 0) {
        first++;
      }
    }

    codewords.push(...group);
  }
}

/**
 * Encode a run of bytes in byte compaction: groups of six bytes as five
 * codewords, and the bytes that are left over one codeword each.
 *
 * The latch says which of the two the decoder has to expect: 924 when the run
 * is a whole number of groups and 901 when it is not.
 *
 * @param  {Uint8Array}   bytes       The data
 * @param  {number}       start       First byte of the run
 * @param  {number}       count       Number of bytes of the run
 * @param  {number[]}     codewords   The codewords, appended to
 */
function encodeBytes(bytes, start, count, codewords) {
  codewords.push(count % BYTE_GROUP === 0 ? LATCH_BYTE_SIX : LATCH_BYTE);

  let index = start;

  while (index + BYTE_GROUP <= start + count) {
    const group = Array.from(bytes.subarray(index, index + BYTE_GROUP));
    const packed = [];

    for (let step = 0; step < 5; step++) {
      let remainder = 0;

      for (let position = 0; position < group.length; position++) {
        const value = remainder * 256 + group[position];

        group[position] = Math.floor(value / 900);
        remainder = value % 900;
      }

      packed.unshift(remainder);
    }

    codewords.push(...packed);

    index += BYTE_GROUP;
  }

  for (; index < start + count; index++) {
    codewords.push(bytes[index]);
  }
}

/**
 * Encode the data of a symbol as codewords, in the three compaction modes.
 *
 * A symbol starts in text compaction, in the alpha sub mode, so text needs no
 * latch in front of it at the start. Every other change of mode does: the
 * encoder takes a run of digits when it is long enough to be worth numeric
 * compaction, a run of characters when it is long enough to be worth text
 * compaction, and everything else as bytes.
 *
 * @param  {Uint8Array}   bytes   The data
 * @return {number[]}             The codewords
 */
function compact(bytes) {
  const codewords = [];

  let index = 0;
  let mode = LATCH_TEXT;
  let submode = TEXT_ALPHA;

  while (index < bytes.length) {
    const digits = digitRun(bytes, index);

    if (digits >= NUMERIC_RUN) {
      codewords.push(LATCH_NUMERIC);
      encodeNumeric(bytes, index, digits, codewords);

      index += digits;
      mode = LATCH_NUMERIC;
      continue;
    }

    const text = textRun(bytes, index);

    if (text > 0 && (text >= TEXT_RUN || index + text === bytes.length)) {
      if (mode !== LATCH_TEXT) {
        codewords.push(LATCH_TEXT);

        mode = LATCH_TEXT;
        submode = TEXT_ALPHA;
      }

      const values = [];

      submode = encodeText(bytes, index, text, submode, values);

      if (values.length % 2 === 1) {
        values.push(TEXT_PAD);
      }

      for (let value = 0; value < values.length; value += 2) {
        codewords.push(values[value] * 30 + values[value + 1]);
      }

      index += text;
      continue;
    }

    const binary = binaryRun(bytes, index);

    encodeBytes(bytes, index, binary, codewords);

    index += binary;
    mode = LATCH_BYTE;
  }

  return codewords;
}

/**
 * The error correction level of a number of data codewords when the level is
 * automatic.
 *
 * Without a ratio it is the recommendation of the specification. With one, the
 * ratio mode of the ESC/POS command, it is the level whose number of check
 * codewords comes closest to the ratio the command asks for, which is the
 * number of check codewords per ten data codewords.
 *
 * @param  {number}   count     Number of data codewords, the length descriptor included
 * @param  {number}   [ratio]   Check codewords per ten data codewords, 1 to 40
 * @return {number}             Error correction level, 0 to 8
 */
function automaticLevel(count, ratio) {
  if (!ratio) {
    for (const entry of RECOMMENDED) {
      if (count <= entry.limit) {
        return entry.level;
      }
    }

    return RECOMMENDED[RECOMMENDED.length - 1].level;
  }

  const wanted = (count * ratio) / 10;

  let best = 0;

  for (let level = 1; level <= 8; level++) {
    if (Math.abs(errorCodewords(level) - wanted) < Math.abs(errorCodewords(best) - wanted)) {
      best = level;
    }
  }

  return best;
}

/**
 * The number of columns and rows of a symbol.
 *
 * A count of zero is automatic. With both of them automatic the shape decides:
 * the columns whose symbol comes closest to three times as wide as it is tall
 * wins, and of two equally good shapes the smaller symbol. With one of them
 * given the other follows from the number of codewords that have to fit.
 *
 * @param  {number}   count        Number of codewords the symbol has to hold
 * @param  {Pdf417Options}   options   The requested size
 * @return {{columns: number, rows: number}|null}   The size, or null when it does not fit
 */
function dimensions(count, options) {
  const requested = {
    columns: options.columns || 0,
    rows: options.rows || 0,
  };

  const height = options.rowHeight || DEFAULT_ROW_HEIGHT;

  /* The width of a row in modules, for the shape of the symbol: the start
     pattern, both row indicators and the stop pattern around the data columns,
     or only the start pattern and the left row indicator when the symbol is
     truncated */

  const modules = (columns) =>
    SYMBOL_MODULES * (columns + (options.truncated ? 2 : 4)) + 1;

  const fits = (columns, rows) =>
    columns >= 1 && columns <= MAX_COLUMNS &&
    rows >= MIN_ROWS && rows <= MAX_ROWS &&
    columns * rows >= count && columns * rows <= MAX_CODEWORDS;

  if (requested.columns && requested.rows) {
    return fits(requested.columns, requested.rows) ? requested : null;
  }

  if (requested.columns) {
    const rows = Math.max(MIN_ROWS, Math.ceil(count / requested.columns));

    return fits(requested.columns, rows) ? {columns: requested.columns, rows} : null;
  }

  if (requested.rows) {
    const columns = Math.max(1, Math.ceil(count / requested.rows));

    return fits(columns, requested.rows) ? {columns, rows: requested.rows} : null;
  }

  let best = null;

  for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
    const rows = Math.max(MIN_ROWS, Math.ceil(count / columns));

    if (!fits(columns, rows)) {
      continue;
    }

    const shape = Math.abs(modules(columns) / (rows * height) - ASPECT);

    if (best === null || shape < best.shape - 1e-9 ||
      (shape < best.shape + 1e-9 && columns * rows < best.columns * best.rows)) {
      best = {columns, rows, shape};
    }
  }

  return best === null ? null : {columns: best.columns, rows: best.rows};
}

/**
 * Append the modules of a run of elements, starting with a bar
 *
 * @param  {number[]}   row        The row, appended to
 * @param  {number[]}   elements   Widths of the elements in modules
 */
function appendElements(row, elements) {
  for (let index = 0; index < elements.length; index++) {
    const module = index % 2 === 0 ? 1 : 0;

    for (let width = 0; width < elements[index]; width++) {
      row.push(module);
    }
  }
}

/**
 * Append the modules of a symbol character
 *
 * @param  {number[]}   row        The row, appended to
 * @param  {number}     cluster    The cluster of the row, 0, 1 or 2 for cluster 0, 3 and 6
 * @param  {number}     codeword   The value of the codeword, 0 to 928
 */
function appendCodeword(row, cluster, codeword) {
  const pattern = clusters[cluster][codeword];

  for (let bit = SYMBOL_MODULES - 1; bit >= 0; bit--) {
    row.push((pattern >> bit) & 1);
  }
}

/**
 * Encode data as a PDF417 symbol.
 *
 * Nothing is drawn when the data does not fit: more codewords than the largest
 * symbol holds, or a number of columns and rows that is too small for them,
 * which is what a printer answers with an empty print.
 *
 * @param  {Uint8Array|number[]}   data        The bytes to encode
 * @param  {Pdf417Options}         [options]   How the symbol is built
 * @return {Pdf417Symbol|null}                 The symbol, or null when the data does not fit
 */
export function pdf417(data, options) {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data || []);
  const settings = options || {};

  if (bytes.length === 0) {
    return null;
  }

  const codewords = compact(bytes);

  if (codewords.length > MAX_DATA) {
    return null;
  }

  /* The length descriptor is a codeword of its own and counts itself, and a
     symbol never holds fewer than MIN_DATA data codewords */

  const count = Math.max(MIN_DATA, codewords.length + 1);

  const level = typeof settings.errorLevel === 'number' ?
    Math.min(8, Math.max(0, Math.round(settings.errorLevel))) :
    automaticLevel(count, settings.errorRatio);

  const size = dimensions(count + errorCodewords(level), settings);

  if (size === null) {
    return null;
  }

  /* The data of the symbol is the length descriptor, the codewords and as much
     padding as it takes to fill every row, and the length descriptor counts the
     padding as well */

  const total = size.columns * size.rows - errorCodewords(level);
  const words = [total, ...codewords];

  while (words.length < total) {
    words.push(PAD);
  }

  words.push(...errorCorrection(words, level));

  /* Every row is the start pattern, the left row indicator, the codewords of
     the row, the right row indicator and the stop pattern. The three row
     indicators of every three rows carry the rows, the columns and the error
     correction level between them, in the order the cluster of the row says. */

  const modules = [];

  for (let row = 0; row < size.rows; row++) {
    const cluster = row % 3;
    const group = 30 * Math.floor(row / 3);

    const values = [
      Math.floor((size.rows - 1) / 3),
      level * 3 + (size.rows - 1) % 3,
      size.columns - 1,
    ];

    const line = [];

    appendElements(line, START_PATTERN);
    appendCodeword(line, cluster, group + values[cluster]);

    for (let column = 0; column < size.columns; column++) {
      appendCodeword(line, cluster, words[row * size.columns + column]);
    }

    if (settings.truncated) {
      /* A truncated symbol drops the right row indicator and the stop pattern,
         and keeps the single bar that closes the last row indicator */

      line.push(1);
    } else {
      appendCodeword(line, cluster, group + values[(cluster + 2) % 3]);
      appendElements(line, STOP_PATTERN);
    }

    modules.push(line);
  }

  return {modules, columns: size.columns, rows: size.rows, errorLevel: level};
}

export default pdf417;
