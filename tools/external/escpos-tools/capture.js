import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {write, report, today} from '../shared.js';

/*
    escpos-tools, MIT, https://github.com/receipt-print-hq/escpos-tools

    A set of PHP tools that read ESC/POS rather than write it: esc2text,
    esc2html and escimages. The repository carries one ESC/POS sample, the
    receipt with a logo its documentation shows, and that stream is what is
    captured here. Nothing of the library is run, here or anywhere else in this
    repository: its tools write HTML and text rather than dots, which is no
    answer to whether the paper agrees, see the notes of section 16b.

        git clone https://github.com/receipt-print-hq/escpos-tools build/external/escpos-tools
        git -C build/external/escpos-tools checkout 4311694
        node tools/external/escpos-tools/capture.js

    The same bytes are also carried by zachzurn/thermal, as
    sample_files/in/test_receipt_2.bin, which is where the eye review took its
    second rendering from; they are captured here because this is the repository
    whose licence covers them, see the notes of section 16b.

    The checkout lives under build/, which is gitignored. Nothing here runs
    during npm test.
*/

const LIBRARY = 'escpos-tools';

const SOURCE = 'https://github.com/receipt-print-hq/escpos-tools';

const COMMIT = '4311694dd632e0f509eba691d26adf8c2f092daf';

/* The repository is not released and carries no version, so the provenance
   names the commit, as the ESCPOS_NET fixtures do */

const VERSION = COMMIT.slice(0, 7);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Where the repository is cloned to, see the setup above */

const CHECKOUT = path.join(root, 'build', 'external', LIBRARY);

/*
    The sample names no printer and no width. It is the output of the
    receipt-with-logo example of escpos-php, an 80 mm receipt, so it is rendered
    on the 576 dot paper of the other fixtures.
*/

const WIDTH = 576;
const COLUMNS = 48;

/* Its codepage commands are ESC t out of the Epson table, like every other
   ESC/POS fixture here */

const MAPPING = 'epson';

const CAPTURES = [
  {
    name: 'receipt-with-logo',
    file: 'receipt-with-logo.bin',
    features: 'a GS v 0 raster logo, bold, double size text, alignment, a Code 39 barcode and a cut',
    review: 'Reviewed as a PNG next to the render thermal makes of the same bytes, which it ships as ' +
      'sample_files/out/img/test_receipt_2.bin.png, and next to ESCPost: the same blocks in the same order. ' +
      'thermal draws 649 dots of paper around the 576 of the print head, and ESCPost pads its sheet to the ' +
      'cutter, 919 dots against 836 here.',
  },
];

/**
 * The captures of this library, for the contact sheet and for the capture
 *
 * @return {object[]}   The captures, with the file resolved
 */
export function captures() {
  return CAPTURES.map((capture) => Object.assign({}, capture, {
    source: path.join(CHECKOUT, capture.file),
    width: WIDTH,
    columns: COLUMNS,
  }));
}

/**
 * Capture the fixtures this script was asked for
 *
 * @param  {string[]}   only   Names of the fixtures, empty for all of them
 */
function main(only) {
  if (!fs.existsSync(CHECKOUT)) {
    throw new Error(`No checkout at ${path.relative(root, CHECKOUT)}, see the setup in this script`);
  }

  const list = captures().filter((capture) => only.length === 0 || only.includes(capture.name));

  if (!list.length) {
    throw new Error(`No such fixture, one of ${CAPTURES.map((capture) => capture.name).join(', ')}`);
  }

  console.log(`${LIBRARY} ${VERSION}`);

  for (const capture of list) {
    const bytes = new Uint8Array(fs.readFileSync(capture.source));

    const result = write(LIBRARY, capture.name, bytes, {
      source: SOURCE,
      file: capture.file,
      commit: COMMIT,
      licence: 'MIT',
      setup: `git clone ${SOURCE} build/external/${LIBRARY} && ` +
        `git -C build/external/${LIBRARY} checkout ${COMMIT.slice(0, 7)}`,
      command: `node tools/external/${LIBRARY}/capture.js ${capture.name}`,
      version: VERSION,
      language: 'esc-pos',
      columns: COLUMNS,
      width: WIDTH,
      codepageMapping: MAPPING,
      captured: today(),
      notes: [
        `Exercises ${capture.features}.`,
        'The sample names no printer and no width, so it is rendered on the 80 mm paper of the other ' +
          'fixtures, 576 dots.',
        'The stream is the file of the repository, not a run of the library.',
        capture.review,
      ].filter((note) => note).join(' '),
    });

    console.log(report(capture.name, result));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
