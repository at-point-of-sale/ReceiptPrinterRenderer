import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

import {write, report, today} from '../shared.js';

/*
    receiptline, Apache 2.0, https://github.com/receiptline/receiptline

    One ReceiptLine document is turned into ESC/POS, StarPRNT, Star Line mode
    and the Star raster mode of a TSP100 by its command sets, so the same
    receipt gives a fixture per language and the parity test of test/external.js
    can compare them. It also renders the document to SVG, which is the preview
    the first golden image of every document was reviewed against.

    The documents are the English examples the npm package ships in
    example/data/en, which are the ones of the repository at the tag of this
    version. They are not copied into this repository: the provenance names the
    repository, the file and the commit of the tag, and this script reads them
    out of node_modules.

    Regenerate everything, or one fixture:

        node tools/external/receiptline/capture.js
        node tools/external/receiptline/capture.js receipt-escpos-48

    Nothing here runs during npm test.
*/

const require = createRequire(import.meta.url);

const receiptline = require('receiptline');
const version = require('receiptline/package.json').version;

const LIBRARY = 'receiptline';

const SOURCE = 'https://github.com/receiptline/receiptline';

/* The commit of the v4.0.4 tag, which is the version on npm that ships the
   documents this script reads */

const COMMIT = 'f93b6747d031e03f75ed49d8079d24edbabf63f6';

/* Where the documents are, inside the package and inside the repository */

const EXAMPLES = path.dirname(require.resolve('receiptline/package.json'));
const DOCUMENTS = 'example/data/en';

/*
    The command sets that matter here, with the renderer that reads what they
    emit.

    `escpos` and `generic` both select a codepage with ESC t n out of the Epson
    table, including the ESC t 1 they print their ruled lines with, where the
    box drawing characters of the Epson katakana page are: the `epson` mapping
    decodes both. `generic` differs from `escpos` in its images, GS v 0 instead
    of the graphics group, and in the binary rather than ASCII arguments of its
    style commands.

    `starsbcs` and `starlinesbcs` select with ESC GS t n out of the Star table,
    which is the `star` mapping, the only one the StarPRNT renderer has.
    `stargraphic` is the raster mode of a TSP100, which carries no text at all
    and is read by the StarPRNT renderer as well, see section 12.
*/

const COMMAND_SETS = {
  escpos: {language: 'esc-pos', codepageMapping: 'epson'},
  generic: {language: 'esc-pos', codepageMapping: 'epson'},
  starsbcs: {language: 'star-prnt', codepageMapping: 'star'},
  starlinesbcs: {language: 'star-line', codepageMapping: 'star'},
  stargraphic: {language: 'star-prnt', codepageMapping: 'star'},
};

/* A character cell of every command set is twelve dots wide, so the print width
   is the columns times twelve: 576 dots for the 80 mm paper and 384 for 58 mm */

const CHARACTER_WIDTH = 12;

/* The twenty one English examples, in the order the plan names them, with the
   name of the fixture they produce */

const DOCUMENTS_EN = [
  'receipt', 'receipt2',
  'credit1', 'credit2',
  'guest', 'kitchen',
  'column_width1', 'column_width2', 'column_width3',
  'column_width4', 'column_width5', 'column_width6',
  'column_border1', 'column_border2',
  'text_wrap1', 'text_wrap2', 'text_wrap3', 'text_wrap4',
  'text_decoration', 'line_align', 'line_width',
];

/*
    The subset that is captured through every command set and at both widths.
    Every document goes through `escpos` and `starsbcs` at 48 columns, which is
    what the parity test compares; these five also go through `generic`,
    `starlinesbcs` and `stargraphic`, and through all five sets at 32 columns.
    Every document through every set at both widths is more than an eye review
    can carry, see the open decisions of section 16.
*/

const SUBSET = ['receipt', 'receipt2', 'guest', 'column_border1', 'text_decoration'];

/*
    The command sets this script no longer captures.

    `stargraphic` prints the images and the paper feeds of a document and
    nothing else, so the ten fixtures it wrote were blank paper of the right
    height. Section 16f replaced them with the job receiptio, the console
    application of the same authors, sends a TSP100: the same wire format
    carrying the rasterized receipt. tools/external/receiptio/capture.js writes
    those ten files now, under their old names, and this script refuses to write
    over them. The set stays in the table above because the contact sheet asks
    this script for the SVG preview of every fixture, those ten included.
*/

const CAPTURED_ELSEWHERE = ['stargraphic'];

/* The encoding the documents are captured in. The English documents are ASCII,
   so cp437 is what a printer prints them with; the one capture in
   `multilingual` exercises the other path through receiptline's text(), which
   switches codepages per character instead of selecting one up front */

const ENCODING = 'cp437';
const MULTILINGUAL = 'multilingual';

/* The document that is captured in `multilingual` as well */

const MULTILINGUAL_DOCUMENT = 'receipt';

/*
    What the notes of a fixture say, per command set: what the stream is and
    what its unknown items are, which is what the review of the first golden
    image found and what the plan asks the notes to record.
*/

const NOTES = {
  escpos: 'ESC/POS of receiptline\'s escpos command set. Unknown: GS a and GS r, the status commands, ' +
    'and FS ( A, the Kanji font, none of which print.',
  generic: 'ESC/POS of receiptline\'s generic command set, which prints its images with GS v 0 instead of the ' +
    'graphics group and writes its arguments as binary numbers. Unknown: GS a and GS r, the status commands.',
  starsbcs: 'StarPRNT of receiptline\'s starsbcs command set. Unknown: ESC RS a and ESC GS ETX, the status ' +
    'commands, ESC SP, the right side character spacing, and ESC s, a printer setting.',
  starlinesbcs: 'Star Line mode of receiptline\'s starlinesbcs command set, which prints its images with the ' +
    'twenty four dot bands of ESC k. Unknown: ESC RS a and ESC GS ETX, the status commands, ESC SP, the right ' +
    'side character spacing, and ESC s, a printer setting.',
  stargraphic: 'Not captured here since section 16f, see CAPTURED_ELSEWHERE. The TSP100 raster mode of ' +
    'receiptline\'s stargraphic command set. That set prints images and ' +
    'paper feeds and nothing else: its text, rules and alignment are empty, so the paper holds only the images ' +
    'of the document and the fixture exercises the raster mode wire format, not the layout. Unknown: ESC RS a ' +
    'and ESC ACK SOH, the status commands.',
};

/* What the review found in a document, on top of the note of its command set */

const DOCUMENT_NOTES = {
  kitchen: 'The lines of equals signs are paper cuts, which become cut items and draw nothing, so the paper is ' +
    'two lines shorter than receiptline\'s preview.',
  line_width: 'receiptline writes the Code 128 of ESC/POS as the code set selection {C and the value of every ' +
    'digit pair, one byte each, and the one of StarPRNT as the digits themselves; the renderer reads {C the way ' +
    'the specification describes, so both draw the same symbol, see the notes of section 16.',
};

/**
 * The name of a fixture
 *
 * @param  {string}   document   Name of the document, 'column_width1'
 * @param  {string}   set        Name of the command set, 'escpos'
 * @param  {number}   columns    Number of columns
 * @param  {string}   encoding   Name of the encoding
 * @return {string}              The name of the fixture
 */
function named(document, set, columns, encoding) {
  return `${document.replace(/_/g, '-')}-${set}-${columns}` +
    (encoding === ENCODING ? '' : `-${encoding}`);
}

/**
 * Every capture this script makes
 *
 * @return {object[]}   The captures, each with its document, command set, columns and encoding
 */
export function captures() {
  const result = [];

  for (const document of DOCUMENTS_EN) {
    const sets = SUBSET.includes(document) ? Object.keys(COMMAND_SETS) : ['escpos', 'starsbcs'];
    const widths = SUBSET.includes(document) ? [48, 32] : [48];

    for (const columns of widths) {
      for (const set of Object.keys(COMMAND_SETS)) {
        if (columns === 48 && !sets.includes(set)) {
          continue;
        }

        result.push({document, set, columns, encoding: ENCODING});
      }
    }
  }

  for (const set of ['escpos', 'starsbcs']) {
    result.push({document: MULTILINGUAL_DOCUMENT, set, columns: 48, encoding: MULTILINGUAL});
  }

  return result.map((capture) => Object.assign(capture, {
    name: named(capture.document, capture.set, capture.columns, capture.encoding),
    captured: !CAPTURED_ELSEWHERE.includes(capture.set),
  }));
}

/**
 * Read one of the documents out of the package
 *
 * @param  {string}   document   Name of the document, 'receipt'
 * @return {string}              The ReceiptLine document
 */
function read(document) {
  return fs.readFileSync(path.join(EXAMPLES, DOCUMENTS, `${document}.receipt`), 'utf8');
}

/**
 * The printer receiptline is given, which is what the renderer is constructed
 * with as well. Everything but the columns, the encoding and the command set is
 * left at receiptline's own default, so that the streams are the ones its users
 * get.
 *
 * @param  {object}   capture   One of captures()
 * @return {object}             The printer configuration
 */
function printer(capture) {
  return {cpl: capture.columns, encoding: capture.encoding, command: capture.set};
}

/**
 * The SVG preview of the document of a capture, which is what its golden image
 * was reviewed against. The contact sheet puts it next to the render; it is not
 * committed.
 *
 * @param  {object}   capture   One of captures()
 * @return {string}             The SVG
 */
export function preview(capture) {
  return receiptline.transform(read(capture.document), {
    cpl: capture.columns, encoding: capture.encoding, command: 'svg',
  });
}

/**
 * The plain text rendering of the document of a capture, receiptline's own
 * layout of it, which the review reads next to the ASCII art of the paper
 *
 * @param  {object}   capture   One of captures()
 * @return {string}             The text
 */
export function plain(capture) {
  return receiptline.transform(read(capture.document), {
    cpl: capture.columns, encoding: capture.encoding, command: 'text',
  });
}

/**
 * Capture one fixture
 *
 * @param  {object}   item   One of captures()
 * @return {object}          What write() returned
 */
function capture(item) {
  const set = COMMAND_SETS[item.set];
  const command = receiptline.transform(read(item.document), printer(item));

  /* transform() returns the commands as a binary string, one character per
     byte, which is what receiptline's own server writes to the socket */

  const bytes = Uint8Array.from(Buffer.from(command, 'binary'));

  return write(LIBRARY, item.name, bytes, {
    source: SOURCE,
    file: `${DOCUMENTS}/${item.document}.receipt`,
    commit: COMMIT,
    licence: 'Apache-2.0',
    setup: 'npm install',
    command: `node tools/external/receiptline/capture.js ${item.name}`,
    version,
    language: set.language,
    columns: item.columns,
    width: item.columns * CHARACTER_WIDTH,
    codepageMapping: set.codepageMapping,
    captured: today(),
    notes: [
      NOTES[item.set],
      DOCUMENT_NOTES[item.document],
      item.encoding === ENCODING ? null : `Encoded as ${item.encoding}.`,
      'Reviewed against receiptline\'s SVG preview of the same document.',
    ].filter((note) => note).join(' '),
  });
}

/**
 * Capture the fixtures this script was asked for
 *
 * @param  {string[]}   only   Names of the fixtures, empty for all of them
 */
function main(only) {
  const all = captures().filter((item) => item.captured);
  const elsewhere = captures().filter((item) => !item.captured && only.includes(item.name));

  if (elsewhere.length) {
    throw new Error(
        `${elsewhere.map((item) => item.name).join(', ')} is captured by ` +
        'tools/external/receiptio/capture.js, see section 16f',
    );
  }

  const list = all.filter((item) => only.length === 0 || only.includes(item.name));

  if (!list.length) {
    throw new Error(`No such fixture, one of ${all.map((item) => item.name).join(', ')}`);
  }

  console.log(`${LIBRARY} ${version}`);

  for (const item of list) {
    console.log(report(item.name, capture(item)));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
