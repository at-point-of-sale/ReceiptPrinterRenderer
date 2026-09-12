import fs from 'node:fs';
import path from 'node:path';

import {toPbm} from '../../src/formats/pbm.js';
import {stitch} from '../../src/formats/stitch.js';
import {commands} from '../../test/helpers/items.js';
import {PROVENANCE_FIELDS} from '../../test/helpers/external.js';
import {render, unknown, directory} from './shared.js';

/*
    Render the external fixtures again without capturing them, section 16c.

    A capture script needs the library that produced the stream, a virtual
    environment or a composer install, and it writes a new date into the
    provenance. A change in this renderer needs none of that: the bytes are in
    the repository and only the render of them moved. This script reads every
    .bin with the provenance next to it and writes the .pbm, the .items.json
    and the `unknown` count of that provenance again, and touches nothing else,
    so that a reclassified command or a command that is rendered for the first
    time shows up as a fixture change that is reviewed like any other.

        node tools/external/rerender.js                 every library
        node tools/external/rerender.js receiptline     one library
        node tools/external/rerender.js escpos-php demo one fixture

    It prints a line per fixture that changed and a total per library. Nothing
    here runs during npm test, see test/external.js for the test that reads
    what it wrote.
*/

/**
 * @typedef {import('../../test/helpers/external.js').Provenance} Provenance
 */

/**
 * The libraries that have fixtures
 *
 * @return {string[]}   The names of the directories, sorted
 */
function libraries() {
  return fs.readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
}

/**
 * The fixtures of a library
 *
 * @param  {string}     library   Name of the directory, 'receiptline'
 * @return {string[]}             The names, sorted
 */
function fixtures(library) {
  return fs.readdirSync(path.join(directory, library))
      .filter((name) => name.endsWith('.bin'))
      .map((name) => name.slice(0, -4))
      .sort();
}

/**
 * Render one fixture again and write what changed
 *
 * @param  {string}   library   Name of the directory, 'receiptline'
 * @param  {string}   name      Name of the fixture
 * @return {object}             What the render produced, for the report
 */
function rerender(library, name) {
  const target = path.join(directory, library, name);

  const bytes = new Uint8Array(fs.readFileSync(`${target}.bin`));
  const provenance = JSON.parse(fs.readFileSync(`${target}.json`, 'utf8'));

  const items = render(bytes, provenance);
  const paper = toPbm(stitch(items, {width: provenance.width}));
  const list = JSON.stringify(commands(items), null, 2) + '\n';

  const before = {
    paper: fs.readFileSync(`${target}.pbm`),
    items: fs.readFileSync(`${target}.items.json`, 'utf8'),
    unknown: provenance.unknown,
  };

  /* The provenance keeps its fields in the order the plan writes them, and the
     capture date of the capture: nothing was captured here */

  const ordered = {};

  for (const field of PROVENANCE_FIELDS) {
    ordered[field] = field === 'unknown' ?
      items.filter((item) => item.type === 'unknown').length :
      provenance[field];
  }

  fs.writeFileSync(`${target}.pbm`, paper);
  fs.writeFileSync(`${target}.items.json`, list);
  fs.writeFileSync(`${target}.json`, JSON.stringify(ordered, null, 2) + '\n');

  return {
    changed: {
      paper: !before.paper.equals(paper),
      items: before.items !== list,
      unknown: before.unknown !== ordered.unknown,
    },
    height: stitch(items, {width: provenance.width}).height,
    before: before.unknown,
    after: ordered.unknown,
    unknown: unknown(items),
  };
}

/**
 * Render the fixtures again
 *
 * @param  {string[]}   only   Name of a library and of its fixtures, empty for all of them
 */
function main(only) {
  const [library, ...names] = only;
  const list = library ? [library] : libraries();

  for (const entry of list) {
    const selected = fixtures(entry).filter((name) => names.length === 0 || names.includes(name));

    if (!selected.length) {
      throw new Error(`No such fixture, one of ${fixtures(entry).join(', ')}`);
    }

    let before = 0;
    let after = 0;
    let changed = 0;

    for (const name of selected) {
      const result = rerender(entry, name);
      const what = Object.keys(result.changed).filter((key) => result.changed[key]);

      before += result.before;
      after += result.after;

      if (what.length) {
        changed++;

        console.log(`  ${name.padEnd(38)} ${String(result.height).padStart(5)} rows  ` +
          `${result.before} to ${result.after} unknown  ${what.join(', ')} rewritten`);
      }
    }

    console.log(`${entry}: ${selected.length} fixtures, ${changed} changed, ` +
      `${before} to ${after} unknown items`);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
