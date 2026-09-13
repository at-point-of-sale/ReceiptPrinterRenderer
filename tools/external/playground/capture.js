import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

import {decodePng} from '../../contact-sheet/references/shared.js';
import {write, report, today} from '../shared.js';

/*
    ReceiptPrinterPlayground, https://github.com/NielsLeenheer/ReceiptPrinterPlayground

    The sample scripts behind the playground's "New..." menu are what a person
    prints when they try a printer for the first time, so they are the streams
    to hold a printer against: they are the encoder's own features, written by
    the author of the encoder, and not another library's idea of a receipt.
    Section 16g captures them as fixtures like any other stream of the wild, so
    that the contact sheet can print them and a change in the renderer shows up
    as a changed picture first.

    A sample is a piece of JavaScript, not a document: the playground evaluates
    it against an `encoder` it constructed and a `model` string, see
    src/utils/encoder.js of the playground. This script does the same, in an
    async function with those two names in scope, and encodes what the script
    left in the encoder. The scripts are read out of a checkout of the
    playground next to this repository, they are not copied in here.

        node tools/external/playground/capture.js
        node tools/external/playground/capture.js text-esc-pos-48

    RENDERER_PLAYGROUND points at the checkout when it is somewhere else.

    Every sample is captured in both languages, ESC/POS with the epson mapping
    and StarPRNT with the star mapping, at 48 and at 32 columns, which is the
    80 mm and the 58 mm paper. The two languages of one sample and one width are
    the parity pair of test/external.js.

    Nothing here runs during npm test.
*/

const LIBRARY = 'playground';

const SOURCE = 'https://github.com/NielsLeenheer/ReceiptPrinterPlayground';

/* Where the sample scripts live inside the checkout */

const TEMPLATES = 'src/assets/templates';

/* The samples of the "New..." menu, in the order the menu lists them. `new` is
   the empty starting point of the menu and prints one line, so it is not a
   fixture. */

const SAMPLES = ['text', 'tables', 'images', 'barcodes', 'qrcode', 'pdf417'];

/* The two languages a printer of this ecosystem speaks, each with the codepage
   mapping that belongs to it */

const LANGUAGES = [
  {language: 'esc-pos', codepageMapping: 'epson'},
  {language: 'star-prnt', codepageMapping: 'star'},
];

/* The 80 mm and the 58 mm paper, in columns of font A */

const COLUMNS = [48, 32];

/* A character cell of font A is twelve dots wide, which is what turns the
   columns into the print width the renderer is constructed with */

const CHARACTER_WIDTH = 12;

/* The `model` the sample scripts print at the top. The playground puts the name
   of the selected printer model there and 'Generic' when none is selected,
   which is what a capture without a printer model is. */

const MODEL = 'Generic';

/* The licence of the playground, see licence() */

const LICENCE = 'MIT';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The checkout of the playground the samples are read from: a sibling of this
 * repository, or wherever RENDERER_PLAYGROUND says.
 *
 * @return {string}   The directory
 */
export function checkout() {
  const directory = process.env.RENDERER_PLAYGROUND ||
    path.join(root, '..', 'ReceiptPrinterPlayground');

  if (!fs.existsSync(path.join(directory, TEMPLATES))) {
    throw new Error(
        `No checkout of the playground at ${directory}, set RENDERER_PLAYGROUND, ` +
        'see tools/external/playground/capture.js',
    );
  }

  return directory;
}

/**
 * The commit of the checkout, which is what the provenance records: the samples
 * are read from the working tree, so a dirty tree is worth saying out loud.
 *
 * @return {object}   The commit and whether the tree is clean
 */
export function commit() {
  const directory = checkout();
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8'}).trim();

  return {
    commit: git('rev-parse', 'HEAD'),
    clean: git('status', '--porcelain', '--', TEMPLATES).length === 0,
  };
}

/**
 * The licence of the playground.
 *
 * The checkout carries no licence file and its package.json is private without
 * a licence field, so there is nothing to read and nothing to copy. It is the
 * same author's repository as this one and the samples are the encoder's own
 * features, so they are recorded under the MIT licence of this ecosystem, which
 * is what the LICENSE file of the fixture directory says. A licence file that
 * does appear in the checkout wins over that and is copied as it is.
 *
 * @return {object}   The SPDX identifier and the text for the fixture directory
 */
export function licence() {
  const directory = checkout();
  const found = ['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md']
      .map((name) => path.join(directory, name))
      .filter((file) => fs.existsSync(file))[0];

  if (found) {
    return {licence: LICENCE, text: fs.readFileSync(found, 'utf8'), file: path.basename(found)};
  }

  return {
    licence: LICENCE,
    file: '',
    text: `ReceiptPrinterPlayground\n${SOURCE}\n\n` +
      'The checkout of the playground carries no licence file and its package.json is\n' +
      'private without a licence field, so there was nothing to copy here. It is the\n' +
      'repository of the author of this package, and the sample scripts of\n' +
      `${TEMPLATES} are the features of ReceiptPrinterEncoder written down, so the\n` +
      'streams in this directory are recorded under the MIT licence this ecosystem is\n' +
      'published under. When the playground gets a licence file of its own, the capture\n' +
      'script copies it over this file.\n\n' +
      'MIT License\n\n' +
      'Copyright (c) Niels Leenheer\n\n' +
      'Permission is hereby granted, free of charge, to any person obtaining a copy\n' +
      'of this software and associated documentation files (the "Software"), to deal\n' +
      'in the Software without restriction, including without limitation the rights\n' +
      'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n' +
      'copies of the Software, and to permit persons to whom the Software is\n' +
      'furnished to do so, subject to the following conditions:\n\n' +
      'The above copyright notice and this permission notice shall be included in all\n' +
      'copies or substantial portions of the Software.\n\n' +
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n' +
      'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n' +
      'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n' +
      'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n' +
      'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n' +
      'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n' +
      'SOFTWARE.\n',
  };
}

/**
 * The version of ReceiptPrinterEncoder that produced the bytes. The playground
 * itself is not versioned, it is a private package of the commit above, and the
 * bytes of a sample are the encoder's.
 *
 * The package.json is read out of node_modules by path: the package exports its
 * browser and node builds and nothing else, so there is no subpath to require,
 * and a linked checkout has to report the version it really is.
 *
 * @return {string}   The version
 */
export function version() {
  const manifest = path.join(
      root, 'node_modules', '@point-of-sale', 'receipt-printer-encoder', 'package.json',
  );

  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

/**
 * One sample script, read from the checkout
 *
 * @param  {string}   sample   Name of the sample, 'text'
 * @return {string}            The script
 */
function read(sample) {
  return fs.readFileSync(path.join(checkout(), TEMPLATES, `${sample}.js`), 'utf8');
}

/**
 * The image the playground's `Image` gives the encoder.
 *
 * A sample runs in a browser, where `new Image()` is an element that decodes a
 * `src` and that the encoder draws on a canvas. Here it is the plain object of
 * pixels the encoder takes just as well, filled in by the PNG reader of the
 * contact sheet, so that no canvas and no image library is needed. It is a
 * plain object on purpose: the encoder decides what an input is by the name of
 * its constructor, and an `Image` is the element it wants a canvas for.
 *
 * The `src` is either a data URI, which is what the samples carry today, or a
 * path in the checkout, which is what an asset file would be.
 *
 * @return {object}   The image, an empty {width, height, data} until it decodes
 */
function image() {
  const result = {
    width: 0,
    height: 0,
    data: null,
    src: '',

    /**
     * Read the `src` and fill in the pixels, as the element's decode() does
     *
     * @return {Promise<void>}   When the image is there
     */
    async decode() {
      const match = /^data:image\/png;base64,(.*)$/.exec(result.src);

      const bytes = match ?
        Uint8Array.from(Buffer.from(match[1], 'base64')) :
        Uint8Array.from(fs.readFileSync(path.join(checkout(), result.src)));

      const decoded = await decodePng(bytes);

      result.width = decoded.width;
      result.height = decoded.height;
      result.data = decoded.data;
    },
  };

  return result;
}

/* The encoder is driven by the script, so the script is a function body with
   the names the playground puts in scope. `Image` is the shim above; it is a
   function so that `new Image()` reads the way it does in a browser. */

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

/**
 * Evaluate one sample script the way the playground does, in an async function
 * with the `encoder` and the `model` of src/utils/encoder.js in scope, and
 * return what the encoder made of it
 *
 * @param  {string}   sample    Name of the sample, 'text'
 * @param  {object}   options   The language, the codepage mapping and the columns
 * @return {Promise<Uint8Array>} The bytes
 */
export async function stream(sample, options) {
  const encoder = new ReceiptPrinterEncoder({
    language: options.language,
    codepageMapping: options.codepageMapping,
    columns: options.columns,
  });

  const script = new AsyncFunction('encoder', 'model', 'Image', read(sample));

  await script(encoder, MODEL, image);

  return encoder.encode();
}

/**
 * The name of a fixture
 *
 * @param  {string}   sample     Name of the sample, 'text'
 * @param  {string}   language   The language, 'esc-pos'
 * @param  {number}   columns    Number of columns
 * @return {string}              The name of the fixture
 */
function named(sample, language, columns) {
  return `${sample}-${language}-${columns}`;
}

/**
 * Every capture this script makes
 *
 * @return {object[]}   The captures, each with its sample, language and columns
 */
export function captures() {
  const result = [];

  for (const sample of SAMPLES) {
    for (const entry of LANGUAGES) {
      for (const columns of COLUMNS) {
        result.push(Object.assign({sample, columns, name: named(sample, entry.language, columns)}, entry));
      }
    }
  }

  return result;
}

/**
 * What the notes of a fixture say: what the sample prints, and what the capture
 * had to do differently from the browser the playground runs in
 *
 * @param  {object}   item   One of captures()
 * @return {string}          The notes
 */
function notes(item) {
  const what = {
    'text': 'Both fonts at every width, the styles, the sizes, the alignments, boxes and rules, ' +
      'the eight scripts of the codepage test and a cut at the end',
    'tables': 'Two tables, the first in font B below 42 columns, with cells that are callbacks, ' +
      'rules inside cells and a double width cell',
    'images': 'The 128 by 128 logo of the playground, dithered with Atkinson and centred',
    'barcodes': 'Every symbology the encoder can ask a printer for, with the widths, the heights, ' +
      'the HRI text and the alignments',
    'qrcode': 'Both models, the sizes and the four error levels',
    'pdf417': 'The sizes, the error levels and the column counts',
  }[item.sample];

  return `The ${item.sample} sample of the playground's "New..." menu, section 16g. ${what}. ` +
    `Evaluated the way src/utils/encoder.js of the playground does, in an async function with an ` +
    `\`encoder\` of ${item.columns} columns and a \`model\` of '${MODEL}', which is what the playground ` +
    'puts there when no printer model is selected' +
    (item.sample === 'images' ?
      ', and with an `Image` that reads the data URI of the sample with the PNG reader of the contact ' +
      'sheet instead of a canvas, see tools/external/playground/capture.js' :
      '') +
    '. Reviewed as ASCII art against the render of the other language of the same width.';
}

/**
 * Capture one fixture
 *
 * @param  {object}   item   One of captures()
 * @return {Promise<object>} What write() returned
 */
async function capture(item) {
  const bytes = await stream(item.sample, item);

  return write(LIBRARY, item.name, bytes, {
    source: SOURCE,
    file: `${TEMPLATES}/${item.sample}.js`,
    commit: commit().commit,
    licence: licence().licence,
    setup: 'npm install, and a checkout of ReceiptPrinterPlayground next to this repository, ' +
      'RENDERER_PLAYGROUND overrides the path, see tools/external/playground/capture.js',
    command: `node tools/external/playground/capture.js ${item.name}`,
    version: version(),
    language: item.language,
    columns: item.columns,
    width: item.columns * CHARACTER_WIDTH,
    codepageMapping: item.codepageMapping,
    captured: today(),
    notes: notes(item),
  });
}

/**
 * Write the licence of the fixture directory, which is not a fixture itself but
 * has to be there, see test/external.js
 */
function writeLicence() {
  const found = licence();
  const target = path.join(root, 'test', 'fixtures', 'external', LIBRARY);

  fs.mkdirSync(target, {recursive: true});
  fs.writeFileSync(path.join(target, 'LICENSE'), found.text);
}

/**
 * Capture the fixtures this script was asked for
 *
 * @param  {string[]}   argv   Names of the fixtures, empty for all of them
 */
async function main(argv) {
  const list = captures().filter((item) => argv.length === 0 || argv.includes(item.name));

  if (!list.length) {
    throw new Error(`No such fixture, one of ${captures().map((item) => item.name).join(', ')}`);
  }

  const where = commit();

  console.log(
      `playground ${where.commit.slice(0, 7)}${where.clean ? '' : ', with uncommitted changes to the samples'}, ` +
      `encoded with ReceiptPrinterEncoder ${version()}`,
  );

  writeLicence();

  for (const item of list) {
    console.log(report(item.name, await capture(item)));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`The capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
