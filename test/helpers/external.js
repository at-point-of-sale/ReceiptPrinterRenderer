import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {names, fixture} from './fixtures.js';

/*
   The external fixtures of section 16: byte streams that other open source
   libraries produced, kept with their provenance, see the implementation plan.

   A fixture is four files in test/fixtures/external/<library>/:

     <example>.bin          the bytes the library produced
     <example>.pbm          the paper the renderer makes of them
     <example>.items.json   the items that are not images
     <example>.json         the provenance, the Provenance typedef below

   The licence text of a library is kept once, in the LICENSE file of its
   directory, and that file is not a fixture.
*/

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'external');

/**
 * Where a byte stream came from, how it was captured and what the renderer made
 * of it when the fixture was frozen. The fields are the ones the implementation
 * plan lists for section 16 plus `setup`, and no others; PROVENANCE_FIELDS
 * below is the same list for the test that checks it.
 *
 * `setup` is the one addition to the plan's list, which the plan allows: a
 * capture that needs a virtual environment or a composer install is only
 * reproducible when the install is written down next to the invocation, and
 * folding both into `command` makes that field unreadable. `setup` prepares the
 * machine, `command` produces the bytes, and running the two in that order
 * gives the stream back.
 *
 * @typedef {object} Provenance
 * @property {string} source           Repository of the library, an https URL
 * @property {string} file             Path of the input inside that repository
 * @property {string} commit           Commit of the repository the input was taken from
 * @property {string} licence          SPDX identifier, MIT, BSD or Apache-2.0
 * @property {string} setup            What has to be installed before `command` runs
 * @property {string} command          The exact invocation that produced the bytes
 * @property {string} version          Version of the library that produced them
 * @property {string} language         Language the renderer is constructed with
 * @property {number} columns          Columns of font A the library assumed
 * @property {number} width            Print width in dots the library assumed
 * @property {string} codepageMapping  Codepage mapping the library encoded with
 * @property {string} captured         Date of the capture, YYYY-MM-DD
 * @property {number} unknown          Number of unknown items of the render, when it was frozen
 * @property {string} notes            What the review of the golden image found
 */

/** The fields of a provenance file, in the order the plan writes them */

export const PROVENANCE_FIELDS = [
  'source', 'file', 'commit', 'licence', 'setup', 'command', 'version',
  'language', 'columns', 'width', 'codepageMapping', 'captured', 'unknown', 'notes',
];

/** The licences a library may be captured under, see the plan */

export const LICENCES = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];

/** The command types every external fixture is rendered with */

export const COMMANDS = ['cut', 'pulse', 'feed', 'unknown'];

/**
 * The libraries that have external fixtures
 *
 * @return {string[]}   The names of the directories, sorted
 */
export function libraries() {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
}

/**
 * The names of the fixtures of a library
 *
 * @param  {string}     library   Name of the directory, 'receiptline'
 * @return {string[]}             The names, sorted
 */
export function fixtures(library) {
  return names(path.join('external', library));
}

/**
 * One external fixture: the bytes, the golden paper, the items and the
 * provenance
 *
 * @param  {string}   library   Name of the directory, 'receiptline'
 * @param  {string}   name      Name of the fixture
 * @return {object}             The fixture, with its provenance
 */
export function external(library, name) {
  const result = fixture(path.join('external', library), name);

  result.provenance = JSON.parse(
      fs.readFileSync(path.join(directory, library, `${name}.json`), 'utf8'),
  );

  return result;
}

/**
 * The renderer options a provenance asks for
 *
 * @param  {Provenance}   provenance   The provenance of a fixture
 * @return {object}                    The options of the unified renderer
 */
export function options(provenance) {
  return {
    language: provenance.language,
    width: provenance.width,
    codepageMapping: provenance.codepageMapping,
    commands: COMMANDS,
  };
}

export {directory};
