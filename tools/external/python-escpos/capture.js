import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {write, report, today, directory, render} from '../shared.js';

/*
    python-escpos, MIT, https://github.com/python-escpos/python-escpos

    The widest command usage of the libraries of section 16: print modes, tabs
    and absolute positions, its three image implementations, codepage switching
    through its magic encode, barcodes and QR codes.

    The byte streams are captured by the Python script next to this one, which
    runs the examples of the repository against python-escpos' Dummy printer in
    a throwaway virtual environment and writes the .bin files and an index of
    what every example assumed:

        python3 -m venv build/external/python-escpos/venv
        build/external/python-escpos/venv/bin/pip install \
            "git+https://github.com/python-escpos/python-escpos@<commit>"
        build/external/python-escpos/venv/bin/python tools/external/python-escpos/capture.py

    This script renders what it wrote and freezes the fixtures:

        node tools/external/python-escpos/capture.js

    It reads the index the Python script left in build/external/python-escpos,
    so the two run in that order. Nothing here runs during npm test.
*/

const LIBRARY = 'python-escpos';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Where the Python script left its index of the capture */

const INDEX = path.join(root, 'build', 'external', LIBRARY, 'index.json');

/*
    python-escpos writes its codepage commands as ESC t n out of the codePages
    table of the profile, which is the Epson table: 0 is cp437, 2 cp850,
    16 windows1252, 19 cp858, and so on. That is the `epson` mapping.
*/

const MAPPING = 'epson';

/* The width of a character cell of font A, which is what turns the columns of
   a profile into a print width when the profile does not give one */

const CHARACTER_WIDTH = 12;

/* What the unknown items of these fixtures are. python-escpos sends one command
   this renderer does not implement, and every fixture that has unknown items has
   only that one */

const UNKNOWN = 'The unknown items are GS b, the smoothing mode, which set_with_default() sends with every ' +
  'style change and which changes nothing on paper.';

/**
 * The print width a capture is rendered at, in dots.
 *
 * The profiles of python-escpos carry the width of the paper in dots and the
 * number of columns of font A separately, and the two do not always agree at
 * the twelve dot cell this renderer draws font A in: a TM-U220 is 400 dots wide
 * and 42 columns, because its font is narrower than a thermal one. The paper is
 * what the printer has, so the paper wins, rounded down to whole bytes.
 *
 * @param  {object}   entry   One entry of the index the Python script wrote
 * @return {number}           The width in dots
 */
function widthOf(entry) {
  const dots = entry.media || entry.columns * CHARACTER_WIDTH;

  return dots - (dots % 8);
}

/**
 * What the notes of a fixture say: the profile the example assumed, the
 * features it exercises and how it was run
 *
 * @param  {string}   name      Name of the fixture
 * @param  {object}   entry     One entry of the index
 * @param  {number}   unknown   Number of unknown items the render produced
 * @return {string}             The notes
 */
function notes(name, entry, unknown) {
  const width = widthOf(entry);
  const columns = Math.floor(width / CHARACTER_WIDTH);

  return [
    `Profile ${entry.profile}, ${entry.columns} columns of font A and ${entry.media || 'no'} dots of paper.`,
    entry.media && columns !== entry.columns ?
      `The renderer draws font A in twelve dots, so the paper holds ${columns} columns instead of ` +
      `the ${entry.columns} the profile reports; python-escpos lays its software columns out for ${entry.columns}.` :
      null,
    `Exercises ${entry.features.join(', ')}.`,
    entry.usb ?
      'The example constructs a Usb printer, which the capture replaced with a Dummy of the same profile.' :
      null,
    'Reviewed as a PNG against what the example prints.',
    unknown ? UNKNOWN : null,
  ].filter((note) => note).join(' ');
}

/**
 * Freeze the fixtures the Python script captured
 *
 * @param  {string[]}   only   Names of the fixtures, empty for all of them
 */
function main(only) {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`No capture to render, run tools/external/${LIBRARY}/capture.py first`);
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

    const argv = entry.argv.length ? ` ${entry.argv.map((value) => JSON.stringify(value)).join(' ')}` : '';

    /* The notes say what the unknown items are, so the fixtures without any do
       not claim to have them: rendering once up front answers that */

    const provenance = {
      language: 'esc-pos',
      width: widthOf(entry),
      codepageMapping: MAPPING,
    };

    const unknown = render(bytes, provenance).filter((item) => item.type === 'unknown').length;

    const result = write(LIBRARY, name, bytes, {
      source: entry.source,
      file: entry.file,
      commit: entry.commit,
      licence: 'MIT',
      setup: entry.setup,
      command: `${entry.python} tools/external/${LIBRARY}/capture.py ${name}${argv} && ` +
        `node tools/external/${LIBRARY}/capture.js ${name}`,
      version: entry.version,
      language: 'esc-pos',
      columns: Math.floor(widthOf(entry) / CHARACTER_WIDTH),
      width: widthOf(entry),
      codepageMapping: MAPPING,
      captured: today(),
      notes: notes(name, entry, unknown),
    });

    console.log(report(name, result));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
