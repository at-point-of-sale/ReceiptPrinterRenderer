import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {write, report, today} from '../shared.js';

/*
    ESCPost, Apache 2.0, https://github.com/receiptful/escpost

    A Rust emulator and renderer. Nothing of it is run here: what is captured
    are the ESC/POS streams it ships as its own sample jobs and as the inputs of
    its render cases. They are `.hex` files, whitespace separated hexadecimal
    bytes with blank lines between the blocks, so this script reads them and
    freezes the bytes they spell.

    They are written to exercise a renderer rather than to demonstrate an
    encoder, which is why they are here: a render case names the command group
    it covers and walks it, all density modes of ESC *, all scaling modes of
    GS v 0, the print positions, the cuts.

        git clone https://github.com/receiptful/escpost build/external/escpost
        git -C build/external/escpost checkout c4a7665
        node tools/external/escpost/capture.js
        node tools/external/escpost/capture.js text-character-sizes

    The checkout lives under build/, which is gitignored, so the paths of the
    provenance are the ones that work from a fresh checkout of this repository.
    Nothing here runs during npm test. The render cases carry an expected PNG of
    ESCPost's own renderer next to their input, which is what the golden images
    were reviewed against, see tools/contact-sheet/references/escpost.js.
*/

const LIBRARY = 'escpost';

const SOURCE = 'https://github.com/receiptful/escpost';

/* The commit of the v0.2.1 tag, which is the version of the workspace */

const COMMIT = 'c4a766513c58cebf84bc4ec6c5da8514ae2e0d88';

const VERSION = '0.2.1';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Where the repository is cloned to, see the setup above */

const CHECKOUT = path.join(root, 'build', 'external', LIBRARY);

/*
    The printer profiles of the render cases, with the print width their
    profile.toml gives, `printable_width_dots`, and the columns that width holds
    at the twelve dot cell of font A both profiles define.

    A sample that names no profile is rendered on the 80 mm paper of the other
    fixtures, 576 dots, and its notes say the sample gave no width.
*/

const PROFILES = {
  'REFERENCE': {width: 576, columns: 48},
  'NT-5890K': {width: 384, columns: 32},
};

/* ESCPost reads its codepages out of the Epson table, ESC t 0 is cp437, so the
   fixtures are rendered with the `epson` mapping like the other ESC/POS ones */

const MAPPING = 'epson';

/*
    The streams that are captured, with the file inside the repository, the
    profile the sample assumes and what it exercises.

    `profile` is null where the sample names none: the two example jobs and the
    calibration job of the profiles crate are printed on whatever printer the
    reader has.
*/

const CAPTURES = [
  {
    name: 'cafe-order-voucher',
    file: 'example-jobs/cafe-order-voucher.hex',
    profile: null,
    features: 'a raster logo, double size text, bold, alignment and a full cut',
    review: 'Reviewed as a PNG next to ESCPost\'s own render of the same job: the same blocks in the same order and ' +
      '664 ink rows here against 651 there, with the paper 1240 dots against 1210 because ESCPost pads a sheet to ' +
      'its cutter.',
  },
  {
    name: 'rust-print-smoke',
    file: 'example-jobs/rust-print-smoke.hex',
    profile: null,
    features: 'the smallest job of the repository, an initialize, two lines and a cut',
    review: 'Reviewed against ESCPost\'s own render, which is the same paper: 120 dots and 36 ink rows in both.',
  },
  {
    name: 'calibration-job',
    file: 'crates/escpost-profiles/calibration-job.hex',
    profile: null,
    features: 'the job a new profile is measured with: rulers, the fonts, the character sizes and the cuts',
    review: 'Reviewed as a PNG next to ESCPost\'s own render: 849 ink rows here against 846 there. Its two sheets ' +
      'together are 1968 dots against 1743 here, the padding to the cutter of each cut.',
  },
  {
    name: 'text-ascii-fonts-and-styles',
    file: 'crates/escpost-render/tests/cases/text/ascii-fonts-and-styles/input.hex',
    profile: 'NT-5890K',
    features: 'font A and font B with bold, underline, inverse and the style resets',
    review: 'Reviewed against the expected PNG of the case: the same 384 by 198 paper with the same 132 ink rows, ' +
      'line for line.',
  },
  {
    name: 'text-character-sizes',
    file: 'crates/escpost-render/tests/cases/text/character-sizes/input.hex',
    profile: 'REFERENCE',
    features: 'GS ! over the width and height multipliers',
    review: 'Reviewed against the two expected PNGs of the case, which are the two sheets of its cut: stacked they ' +
      'are the same 1410 dots as this render, with 1327 ink rows against 1278 because their glyphs are heavier.',
  },
  {
    name: 'graphics-esc-star-8dot-double-density',
    file: 'crates/escpost-render/tests/cases/graphics/esc-star-8dot-double-density/input.hex',
    profile: 'NT-5890K',
    features: 'ESC * with m of 1, the eight dot double density bit image',
    review: 'Reviewed against the expected PNG of the case: the same 30 dots and the same 8 ink rows.',
  },
  {
    name: 'graphics-esc-star-all-density-modes',
    file: 'crates/escpost-render/tests/cases/graphics/esc-star-all-density-modes/input.hex',
    profile: 'NT-5890K',
    features: 'ESC * with every m the command has, 0, 1, 32 and 33',
    review: 'Reviewed against the expected PNG of the case: the same 120 dots and the same 64 ink rows, so all four ' +
      'densities land where the case wants them.',
  },
  {
    name: 'graphics-gs-v0-all-scaling-modes',
    file: 'crates/escpost-render/tests/cases/graphics/gs-v0-all-scaling-modes/input.hex',
    profile: 'NT-5890K',
    features: 'GS v 0 with every m, the raster image at single and double scale',
    review: 'Reviewed against the expected PNG of the case: the same four images with the same 48 ink rows, but 138 ' +
      'dots here against 48 there. The case is rendered with the NT-5890K profile, whose firmware swallows the LF ' +
      'that follows a raster image; this renderer follows the Epson baseline, where that LF feeds a line, so the ' +
      'four images are 30 dots apart here and adjacent there.',
  },
  {
    name: 'motion-line-spacing-and-feed',
    file: 'crates/escpost-render/tests/cases/motion/line-spacing-and-feed/input.hex',
    profile: 'NT-5890K',
    features: 'ESC 2, ESC 3 and ESC d, the line spacing and the paper feeds',
    review: 'Reviewed against the expected PNG of the case. The four markers are at 0, 30, 38 and 48 here and at 0, ' +
      '30, 40 and 60 there: the Epson profile of this renderer counts two vertical motion units per dot, so ESC 3 10 ' +
      'is five dots and not ten, and a line is never shorter than the eight dot band of ESC *. The NT-5890K profile ' +
      'of the case maps one unit to one dot.',
  },
  {
    name: 'motion-positioning-and-print-area',
    file: 'crates/escpost-render/tests/cases/motion/positioning-and-print-area/input.hex',
    profile: 'NT-5890K',
    features: 'ESC $, ESC \\, GS L and GS W, the print positions and the print area',
    review: 'Reviewed against the expected PNG of the case: the same 120 dots and the same 96 ink rows, and the ' +
      'first three markers on the same dots. The last two differ: the calibrated NT-5890K of the case ignores an ESC ' +
      '$ after printable data and a negative ESC \\, which its notes call a firmware quirk, so its markers form one ' +
      'block; this renderer follows the Epson baseline and draws them at x 40 and x 20.',
  },
  {
    name: 'motion-gs-v-function-b-feed',
    file: 'crates/escpost-render/tests/cases/motion/gs-v-function-b-feed/input.hex',
    profile: 'NT-5890K',
    features: 'GS V 66, the cut with a feed, on a profile without an autocutter',
    review: 'Reviewed against ESCPost\'s own render: the same 24 ink rows. It cuts the stream into two sheets of 134 ' +
      'dots together against 147 here, because a cut is an item here and a sheet boundary there.',
  },
  {
    name: 'mechanism-full-and-partial-cuts',
    file: 'crates/escpost-render/tests/cases/mechanism/reference-full-and-partial-cuts/input.hex',
    profile: 'REFERENCE',
    features: 'GS V with the full and the partial cut, three sheets in one stream',
    review: 'Reviewed against the three expected PNGs of the case, one per cut: the same 72 ink rows in the same ' +
      'order. Their 280 dots against 120 here are the padding of every sheet to the cutter, which this renderer does ' +
      'not draw, see the rule on cut items.',
  },
  {
    name: 'symbols-native',
    file: 'crates/escpost-render/tests/cases/symbols/native-symbols-nt-5890k/input.hex',
    profile: 'NT-5890K',
    features: 'GS k function B and the QR group of GS ( k, with GS h, GS w and GS H around them',
    review: 'Reviewed against the expected PNG of the case: the same 374 ink rows and 600 dots against 592, with the ' +
      'barcodes on the same dots. The QR symbol is the same version and size with a different mask, which two ' +
      'encoders are free to choose differently.',
  },
  {
    name: 'symbols-databar-m75',
    file: 'crates/escpost-render/tests/cases/symbols/native-symbols-nt-5890k/databar-m75-unsupported-probe.hex',
    profile: 'NT-5890K',
    features: 'GS k with m of 75, GS1 DataBar Omnidirectional',
    review: 'Reviewed as a PNG. ESCPost refuses the stream, "GS k GS1 DataBar Omnidirectional is not supported by ' +
      'printer profile NT-5890K", which is what the sample is a probe for; this renderer draws the symbol of section ' +
      '14.',
  },
  {
    name: 'symbols-databar-m76',
    file: 'crates/escpost-render/tests/cases/symbols/native-symbols-nt-5890k/databar-m76-unsupported-probe.hex',
    profile: 'NT-5890K',
    features: 'GS k with m of 76, GS1 DataBar Truncated',
    review: 'Reviewed as a PNG. ESCPost refuses the stream, "GS1 DataBar Truncated is not supported by printer ' +
      'profile NT-5890K"; this renderer draws the thirteen module tall symbol of section 14.',
  },
  {
    name: 'symbols-databar-m77',
    file: 'crates/escpost-render/tests/cases/symbols/native-symbols-nt-5890k/databar-m77-unsupported-probe.hex',
    profile: 'NT-5890K',
    features: 'GS k with m of 77, GS1 DataBar Limited',
    review: 'Reviewed as a PNG. ESCPost refuses the stream, "GS1 DataBar Limited is not supported by printer profile ' +
      'NT-5890K"; this renderer draws the symbol of section 14.',
  },
  {
    name: 'symbols-databar-m78',
    file: 'crates/escpost-render/tests/cases/symbols/native-symbols-nt-5890k/databar-m78-unsupported-probe.hex',
    profile: 'NT-5890K',
    features: 'GS k with m of 78, GS1 DataBar Expanded',
    review: 'Reviewed as a PNG. ESCPost refuses the stream, "GS1 DataBar Expanded is not supported by printer ' +
      'profile NT-5890K"; this renderer draws the symbol of section 14.',
  },
  {
    name: 'compatibility-html2escpos',
    file: 'crates/escpost-render/tests/cases/compatibility/receiptful-html2escpos/input.hex',
    profile: 'NT-5890K',
    features: 'the stream another producer, html2escpos, makes of a receipt',
    review: 'Reviewed against the expected PNG of the case: the same 384 by 178 paper, 108 ink rows here against 110 ' +
      'there, and every line on the same dots.',
  },
];

/**
 * The bytes a hexadecimal file spells
 *
 * @param  {string}       file   Path of the file
 * @return {Uint8Array}          The stream
 */
export function bytes(file) {
  const words = fs.readFileSync(file, 'utf8').split(/\s+/).filter((word) => word.length);
  const wrong = words.filter((word) => !/^[0-9a-fA-F]{2}$/.test(word));

  if (wrong.length) {
    throw new Error(`${file} is no hexadecimal file, it holds ${wrong[0]}`);
  }

  return Uint8Array.from(words, (word) => parseInt(word, 16));
}

/**
 * The captures of this library, for the contact sheet and for the capture
 *
 * @return {object[]}   The captures, with the profile resolved
 */
export function captures() {
  return CAPTURES.map((capture) => Object.assign({}, capture, {
    profile: capture.profile,
    source: path.join(CHECKOUT, capture.file),
  }, PROFILES[capture.profile] || PROFILES['REFERENCE']));
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
    const result = write(LIBRARY, capture.name, bytes(capture.source), {
      source: SOURCE,
      file: capture.file,
      commit: COMMIT,
      licence: 'Apache-2.0',
      setup: `git clone ${SOURCE} build/external/${LIBRARY} && ` +
        `git -C build/external/${LIBRARY} checkout ${COMMIT.slice(0, 7)}`,
      command: `node tools/external/${LIBRARY}/capture.js ${capture.name}`,
      version: VERSION,
      language: 'esc-pos',
      columns: capture.columns,
      width: capture.width,
      codepageMapping: MAPPING,
      captured: today(),
      notes: [
        `Exercises ${capture.features}.`,
        capture.profile ?
          `The case names the ${capture.profile} profile, whose printable_width_dots is ${capture.width}.` :
          'The sample names no profile and no width, so it is rendered on the 80 mm paper of the ' +
            'other fixtures, 576 dots.',
        'The stream is the hexadecimal file of the repository, not a run of the library.',
        capture.review,
      ].filter((note) => note).join(' '),
    });

    console.log(report(capture.name, result));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
