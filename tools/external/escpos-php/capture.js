import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {write, report, today, directory} from '../shared.js';

/*
    escpos-php, MIT, https://github.com/mike42/escpos-php

    A PHP library, so the streams are captured by the PHP script next to this
    one: it runs the examples of the package against a FilePrintConnector on
    php://stdout and writes the .bin files and an index of what it captured.

        composer require mike42/escpos-php:v2.2 -d build/external/escpos-php
        php tools/external/escpos-php/capture.php

    This script renders what it wrote and freezes the fixtures:

        node tools/external/escpos-php/capture.js

    It reads the index the PHP script left in build/external/escpos-php, so the
    two run in that order. Nothing here runs during npm test.
*/

const LIBRARY = 'escpos-php';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Where the PHP script left its index of the capture */

const INDEX = path.join(root, 'build', 'external', LIBRARY, 'index.json');

/*
    escpos-php writes its codepage commands as ESC t n out of the code page list
    of the capability profile, and the default profile carries the Epson list:
    0 is cp437, 1 the Kanji page, 2 cp850, 3 cp860. That is the `epson` mapping.
*/

const MAPPING = 'epson';

/*
    The default capability profile of escpos-php names no paper width and the
    examples assume a printer of their reader, so the fixtures are rendered on
    the 80 mm paper the rest of this repository uses: 576 dots, 48 columns.
*/

const WIDTH = 576;
const COLUMNS = 48;

/**
 * Freeze the fixtures the PHP script captured
 *
 * @param  {string[]}   only   Names of the fixtures, empty for all of them
 */
function main(only) {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`No capture to render, run tools/external/${LIBRARY}/capture.php first`);
  }

  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const names = Object.keys(index).filter((name) => only.length === 0 || only.includes(name));

  if (!names.length) {
    throw new Error(`No such fixture, one of ${Object.keys(index).join(', ')}`);
  }

  console.log(`${LIBRARY} ${index[names[0]].version}`);

  for (const name of names) {
    const entry = index[name];
    const bytes = new Uint8Array(fs.readFileSync(path.join(directory, LIBRARY, `${name}.bin`)));

    const result = write(LIBRARY, name, bytes, {
      source: entry.source,
      file: entry.file,
      commit: entry.commit,
      licence: 'MIT',
      setup: entry.setup,
      command: `php tools/external/${LIBRARY}/capture.php ${name} && ` +
        `node tools/external/${LIBRARY}/capture.js ${name}`,
      version: entry.version,
      language: 'esc-pos',
      columns: COLUMNS,
      width: WIDTH,
      codepageMapping: MAPPING,
      captured: today(),
      notes: [
        `Exercises ${entry.features.join(', ')}.`,
        'The example prints to a FilePrintConnector on php://stdout; the default capability profile names no ' +
          'paper, so the fixture is rendered on the 80 mm paper of the other fixtures.',
        'Reviewed as a PNG against what the example prints.',
        entry.review,
      ].filter((note) => note).join(' '),
    });

    console.log(report(name, result));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
