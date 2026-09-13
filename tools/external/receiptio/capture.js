import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {write, report, today} from '../shared.js';

/*
    receiptio, Apache 2.0, https://github.com/receiptline/receiptio

    receiptline's library emits the images and the paper feeds of a document in
    its `stargraphic` command set and nothing else: the text, the alignment and
    the ruled lines of that set are empty, so a document without an image comes
    out as blank paper of the right height, see the notes of section 16.
    receiptio, the console application of the same authors, rasterizes the whole
    receipt into one image first and hands that image to the same command set,
    so its job is the receipt with its dots on it, which is what a TSP100
    receives from this ecosystem.

    This script captures that job for the five documents the `stargraphic`
    fixtures of section 16 used, at 48 and at 32 columns, and writes them over
    those ten fixtures, names and all, so that the grouping of the parity test
    and of the contact sheet does not move. The documents are receiptline's
    English examples, read out of node_modules and not copied into this
    repository; the provenance names receiptio as the source and keeps the
    document and the commit of the receiptline fixtures next to it.

    receiptio rasterizes with a browser: `-i`, print as image, renders
    receiptline's SVG of the document and screenshots it. It looks for
    `puppeteer` or `sharp` by name and this repository has neither, so the shim
    below hands it a `puppeteer` that is `puppeteer-core` with the
    `executablePath` of a Chromium that is already on the machine, see
    chromium(). puppeteer-core downloads no browser of its own, which is why it
    is the dev dependency and puppeteer is not.

    Regenerate everything, or one fixture:

        node tools/external/receiptio/capture.js
        node tools/external/receiptio/capture.js receipt-stargraphic-48

    Add --png to write receiptio's own PNG of every document it captures under
    build/receiptio/, which is what the golden images were reviewed against:

        node tools/external/receiptio/capture.js --png

    Nothing here runs during npm test.
*/

const require = createRequire(import.meta.url);

const LIBRARY = 'receiptline';

const SOURCE = 'https://github.com/receiptline/receiptio';

/* The receiptline document the capture reads, with the commit of the v4.0.4 tag
   the other receiptline fixtures name. receiptio 5.0.1 depends on receiptline
   ^4.0.0 and gets that same package. */

const COMMIT = 'f93b6747d031e03f75ed49d8079d24edbabf63f6';

const DOCUMENTS = 'example/data/en';

/* The five documents the stargraphic fixtures of section 16 used, at the two
   widths they used, which is what this script replaces */

const SUBSET = ['column_border1', 'guest', 'receipt', 'receipt2', 'text_decoration'];

const WIDTHS = [48, 32];

/* The language of the source, which is the encoding receiptio picks for the
   text. It changes nothing in a rasterized job, where there is no text on the
   wire at all, and it keeps the capture off the locale of the machine. */

const LANGUAGE = 'en';

/* A character cell is twelve dots wide, so the columns say how wide the paper
   is meant to be: 576 dots for the 80 mm paper and 384 for 58 mm. The width the
   provenance records is receiptio's own, measured off the job, see measure();
   this is what the report compares it with. */

const CHARACTER_WIDTH = 12;

/* The raster mode commands the width is measured through: ESC * r A enters the
   mode and `b` and `k` carry a row of dots, `nL nH` bytes of eight dots each */

const RASTER_ENTER = [0x1b, 0x2a, 0x72, 0x41];

const RASTER_ROWS = [0x62, 0x6b];

/* Where the PNGs of the review go. They are not committed, build/ is in
   .gitignore. */

const PNGS = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'receiptio',
);

/**
 * The first path of a list that exists
 *
 * @param  {string[]}   candidates   The paths to try
 * @return {string}                  The path, or an empty string
 */
function locate(candidates) {
  return candidates.filter((candidate) => candidate && fs.existsSync(candidate))[0] || '';
}

/**
 * The newest browser of a cache directory that holds one directory per version,
 * `chromium_headless_shell-1228` of Playwright and `chrome-headless-shell` of
 * puppeteer both being that shape
 *
 * @param  {string}   directory   The cache directory
 * @param  {string}   prefix      The directory name a browser starts with
 * @param  {string}   binary      The path of the executable inside it
 * @return {string}               The path, or an empty string
 */
function newest(directory, prefix, binary) {
  if (!fs.existsSync(directory)) {
    return '';
  }

  const versions = fs.readdirSync(directory)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();

  return locate(versions.map((name) => path.join(directory, name, binary)));
}

/**
 * The Chromium receiptio rasterizes with, which is one that is already on the
 * machine: this repository downloads no browser. `RENDERER_CHROMIUM` is the
 * answer where there is one, and the browser caches of Playwright and of
 * puppeteer are looked in after it, the same order a reference module of
 * section 16b looks for its tool in.
 *
 * @return {string}   The path of the executable, or an empty string
 */
export function chromium() {
  const home = os.homedir();

  const caches = [
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
  ];

  const shells = [
    path.join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    path.join('chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
    path.join('chrome-headless-shell-linux', 'chrome-headless-shell'),
  ];

  const playwright = caches.flatMap((cache) => shells.map(
      (shell) => newest(cache, 'chromium_headless_shell-', shell),
  ));

  const puppeteer = shells.map(
      (shell) => newest(path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell'), '', shell),
  );

  return locate([process.env.RENDERER_CHROMIUM, ...playwright, ...puppeteer]);
}

/**
 * A package this script needs, with the reason it is not there in the message
 * when it is not: the contact sheet writes that reason into the page
 *
 * @param  {string}   name   Name of the package
 * @return {object}          The package
 */
function load(name) {
  try {
    return require(name);
  } catch (error) {
    throw new Error(`${name} is not installed, see the dev dependencies: ${error.message}`);
  }
}

/**
 * Hand receiptio a `puppeteer`.
 *
 * receiptio requires `puppeteer` by name, catches the failure and falls back to
 * `sharp`, and without either of them `-i` returns an empty image and the job
 * is the feeds the library alone emits. Neither may be a dependency here:
 * puppeteer downloads a browser on install and sharp is a native module, and
 * this repository has no runtime dependencies and builds on a machine with no
 * toolchain. So the module `puppeteer` resolves to is this object, which is
 * puppeteer-core told where the browser is, and nothing of receiptio changes.
 *
 * @param  {string}   browser   Path of the Chromium executable
 */
function shim(browser) {
  const core = load('puppeteer-core');

  const name = 'receiptio-puppeteer-shim';
  const shimmed = new Module(name, null);

  shimmed.filename = name;
  shimmed.loaded = true;
  shimmed.exports = {
    launch: (options) => core.launch(Object.assign({executablePath: browser}, options)),
  };

  Module._cache[name] = shimmed;

  const resolve = Module._resolveFilename;

  Module._resolveFilename = function(request, ...rest) {
    return request === 'puppeteer' ? name : resolve.call(this, request, ...rest);
  };
}

let application = null;

/**
 * receiptio, with the shim in front of it. It is loaded on the first call and
 * not when this module is imported, so that the contact sheet can ask whether
 * it is there without a missing package taking the sheet down.
 *
 * @return {object}   The library, its version and the browser it rasterizes with
 */
export function receiptio() {
  if (!application) {
    const browser = chromium();

    if (!browser) {
      throw new Error(
          'No Chromium for receiptio to rasterize with, set RENDERER_CHROMIUM, ' +
          'see tools/external/receiptio/capture.js',
      );
    }

    shim(browser);

    application = {
      library: load('receiptio'),
      version: load('receiptio/package.json').version,
      browser,
    };
  }

  return application;
}

/**
 * Where receiptline's documents are. receiptio depends on receiptline, so the
 * examples it ships are the ones receiptio itself transforms.
 *
 * @return {string}   The directory of the receiptline package
 */
function examples() {
  return path.dirname(require.resolve('receiptline/package.json'));
}

/**
 * Read one of the documents out of the package
 *
 * @param  {string}   document   Name of the document, 'receipt'
 * @return {string}              The ReceiptLine document
 */
function read(document) {
  return fs.readFileSync(path.join(examples(), DOCUMENTS, `${document}.receipt`), 'utf8');
}

/**
 * The options receiptio is given, as it parses them itself
 *
 * @param  {string}   command   The command set, 'stargraphic' or 'png'
 * @param  {number}   columns   Number of columns
 * @return {string}             The options
 */
function options(command, columns) {
  return `-p ${command} -c ${columns} -l ${LANGUAGE}${command === 'stargraphic' ? ' -i' : ''}`;
}

/**
 * The name of a fixture, which is the name the stargraphic fixture of section
 * 16 had
 *
 * @param  {string}   document   Name of the document, 'column_border1'
 * @param  {number}   columns    Number of columns
 * @return {string}              The name of the fixture
 */
function named(document, columns) {
  return `${document.replace(/_/g, '-')}-stargraphic-${columns}`;
}

/**
 * Every capture this script makes
 *
 * @return {object[]}   The captures, each with its document and columns
 */
export function captures() {
  const result = [];

  for (const document of SUBSET) {
    for (const columns of WIDTHS) {
      result.push({document, columns, name: named(document, columns)});
    }
  }

  return result;
}

/**
 * The Star Graphic Mode job of a document: the receipt rasterized into one
 * image and sent through receiptline's stargraphic command set, which is what a
 * TSP100 receives
 *
 * @param  {string}   document   Name of the document, 'receipt'
 * @param  {number}   columns    Number of columns
 * @return {Promise<Uint8Array>} The bytes
 */
export async function stream(document, columns) {
  const command = await receiptio().library.print(read(document), options('stargraphic', columns));

  /* print() returns the commands as a binary string, one character per byte,
     the way receiptline's transform() does */

  return Uint8Array.from(Buffer.from(command, 'binary'));
}

/**
 * receiptio's own PNG of a document, which is the image its stargraphic job
 * carries: `-p png` and `-i` rasterize the same SVG in the same browser. It is
 * what the golden images were reviewed against and what the reference module of
 * the contact sheet shows next to our render.
 *
 * @param  {string}   document   Name of the document, 'receipt'
 * @param  {number}   columns    Number of columns
 * @return {Promise<Uint8Array>} The PNG
 */
export async function png(document, columns) {
  const image = await receiptio().library.print(read(document), options('png', columns));

  return Uint8Array.from(Buffer.from(image, 'binary'));
}

/**
 * How wide receiptio's job is, read off its first row of raster data: a row is
 * as wide as the image plus the left margin, rounded up to whole bytes, and the
 * renderer has to be constructed with that width or the rows are clipped. It is
 * the width of the rasterized receipt and not necessarily the columns times the
 * cell, which is why it is measured and not assumed.
 *
 * Inside raster mode receiptline writes the rows and the commands of the raster
 * group only, and every one of those ends with a NUL, so walking to the first
 * row needs no parser.
 *
 * @param  {Uint8Array}   bytes   The job
 * @return {number}               The width in dots, or zero when it carries no row
 */
function measure(bytes) {
  let index = bytes.findIndex((byte, at) => RASTER_ENTER.every((value, o) => bytes[at + o] === value));

  if (index < 0) {
    return 0;
  }

  index += RASTER_ENTER.length;

  while (index < bytes.length) {
    if (bytes[index] === 0x1b) {
      while (index < bytes.length && bytes[index] !== 0x00) {
        index++;
      }

      index++;
    } else if (RASTER_ROWS.includes(bytes[index])) {
      return (bytes[index + 1] + bytes[index + 2] * 256) * 8;
    } else {
      index++;
    }
  }

  return 0;
}

/**
 * Capture one fixture
 *
 * @param  {object}   item   One of captures()
 * @return {Promise<object>} What write() returned
 */
async function capture(item) {
  const bytes = await stream(item.document, item.columns);
  const width = measure(bytes) || item.columns * CHARACTER_WIDTH;

  return write(LIBRARY, item.name, bytes, {
    source: SOURCE,
    file: `${DOCUMENTS}/${item.document}.receipt`,
    commit: COMMIT,
    licence: 'Apache-2.0',
    setup: 'npm install, and a Chromium for receiptio to rasterize with: this capture used the ' +
      'chrome-headless-shell of Playwright\'s browser cache through puppeteer-core, ' +
      'RENDERER_CHROMIUM overrides the path, see tools/external/receiptio/capture.js',
    command: `node tools/external/receiptio/capture.js ${item.name}`,
    version: receiptio().version,
    language: 'star-graphics',
    columns: item.columns,
    width,
    codepageMapping: 'star',
    captured: today(),
    notes: 'The Star Graphic Mode job receiptio sends a TSP100 for this document, section 16f: the ' +
      'receipt rasterized into one image by receiptline\'s SVG in a headless Chromium and sent through ' +
      'the raster mode as ESC * r A, ESC * r P, the b rows of the image and ESC * r B, which prints the ' +
      'buffer and cuts. The paper is the receipt, not the blank paper the library alone emits, and its ' +
      'dots are the browser\'s font and not this renderer\'s, so it is out of the dot for dot parity and ' +
      'in the structural check of test/external.js instead. No unknown items: ESC RS a and ESC ACK SOH, ' +
      'the print start control and the status request, are parsed since section 16c. Reviewed against ' +
      'receiptio\'s own PNG of the same document.',
  });
}

/**
 * Capture the fixtures this script was asked for
 *
 * @param  {string[]}   argv   Names of the fixtures and the flags, empty for all of them
 */
async function main(argv) {
  const images = argv.includes('--png');
  const only = argv.filter((name) => !name.startsWith('--'));
  const list = captures().filter((item) => only.length === 0 || only.includes(item.name));

  if (!list.length) {
    throw new Error(`No such fixture, one of ${captures().map((item) => item.name).join(', ')}`);
  }

  console.log(`receiptio ${receiptio().version}, rasterizing with ${receiptio().browser}`);

  for (const item of list) {
    const result = await capture(item);
    const columns = item.columns * CHARACTER_WIDTH;

    console.log(report(item.name, result));

    /* A width of receiptio's own that is not the columns times the cell is
       worth saying out loud: the fixture keeps receiptio's, see section 16f */

    if (result.provenance.width !== columns) {
      console.log(`    ${result.provenance.width} dots wide, the ${item.columns} columns ask for ${columns}`);
    }

    if (images) {
      fs.mkdirSync(PNGS, {recursive: true});
      fs.writeFileSync(path.join(PNGS, `${item.name}.png`), await png(item.document, item.columns));
    }
  }

  if (images) {
    console.log(`\n${PNGS}`);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`The capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
