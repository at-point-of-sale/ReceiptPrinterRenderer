import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../../src/receipt-printer-renderer.js';
import {toPbm} from '../../src/formats/pbm.js';
import {stitch} from '../../src/formats/stitch.js';
import {commands} from '../../test/helpers/items.js';
import {PROVENANCE_FIELDS, COMMANDS, options} from '../../test/helpers/external.js';

/*
    What every capture script of section 16 shares: render a byte stream the way
    its provenance says, write the four files of a fixture and report what came
    out, so that the review of a capture reads the same for every library.

    The capture scripts live one directory per library, next to this module, and
    write to test/fixtures/external/<library>/. Nothing here runs during
    npm test, see test/external.js for the test that reads what they wrote.
*/

/**
 * @typedef {import('../../test/helpers/external.js').Provenance} Provenance
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the fixtures go */

export const directory = path.join(root, 'test', 'fixtures', 'external');

/**
 * Today, as the provenance writes a date
 *
 * @return {string}   The date, YYYY-MM-DD
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Render a byte stream the way its provenance says
 *
 * @param  {Uint8Array}   bytes        The commands the library produced
 * @param  {Provenance}   provenance   The provenance of the capture
 * @return {object[]}                  The items
 */
export function render(bytes, provenance) {
  return new ReceiptPrinterRenderer(options(provenance)).render(bytes);
}

/**
 * The unknown items of a render, as the hexadecimal bytes of the command, with
 * how often each of them occurs, which is what the notes of the section list
 *
 * @param  {object[]}   items   The items of a render
 * @return {object}             The count per command
 */
export function unknown(items) {
  const result = {};

  for (const item of items.filter((candidate) => candidate.type === 'unknown')) {
    const key = Array.from(item.data).map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

    result[key] = (result[key] || 0) + 1;
  }

  return result;
}

/**
 * Write one fixture: the bytes, the paper, the items and the provenance. The
 * provenance is written with the fields in the order the plan lists them, and
 * its `unknown` is the count of this render, so that the two files cannot drift
 * apart.
 *
 * @param  {string}       library      Name of the library, 'receiptline'
 * @param  {string}       name         Name of the fixture
 * @param  {Uint8Array}   bytes        The commands the library produced
 * @param  {Provenance}   provenance   The provenance of the capture, without `unknown`
 * @return {object}                    What the render produced, for the report
 */
export function write(library, name, bytes, provenance) {
  const target = path.join(directory, library);

  fs.mkdirSync(target, {recursive: true});

  const items = render(bytes, provenance);
  const paper = stitch(items, {width: provenance.width});

  const complete = Object.assign({}, provenance, {
    unknown: items.filter((item) => item.type === 'unknown').length,
  });

  const missing = PROVENANCE_FIELDS.filter((field) => typeof complete[field] === 'undefined');

  if (missing.length) {
    throw new Error(`The provenance of ${library}/${name} has no ${missing.join(', ')}`);
  }

  const ordered = {};

  for (const field of PROVENANCE_FIELDS) {
    ordered[field] = complete[field];
  }

  fs.writeFileSync(path.join(target, `${name}.bin`), bytes);
  fs.writeFileSync(path.join(target, `${name}.pbm`), toPbm(paper));
  fs.writeFileSync(path.join(target, `${name}.items.json`), JSON.stringify(commands(items), null, 2) + '\n');
  fs.writeFileSync(path.join(target, `${name}.json`), JSON.stringify(ordered, null, 2) + '\n');

  return {items, paper, unknown: unknown(items), provenance: ordered};
}

/**
 * One line per fixture for the report a capture script prints
 *
 * @param  {string}   name     Name of the fixture
 * @param  {object}   result   What write() returned
 * @return {string}            The line
 */
export function report(name, result) {
  const counted = Object.values(result.unknown).reduce((total, count) => total + count, 0);

  return `  ${name.padEnd(38)} ${String(result.paper.height).padStart(5)} rows  ` +
    `${String(result.items.length).padStart(3)} items  ${counted} unknown`;
}

export {COMMANDS};
