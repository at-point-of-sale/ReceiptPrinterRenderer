import fs from 'node:fs';
import path from 'node:path';

import Bitmap from '../../../src/bitmap.js';
import {toPng} from '../../../src/formats/png.js';
import {references, root, locate, run, unavailable, outOfScope, fromPng} from './shared.js';

/*
    ESCPost as a reference renderer, section 16b.

    ESCPost, https://github.com/receiptful/escpost, Apache 2.0, v0.2.1, commit
    c4a766513c58cebf84bc4ec6c5da8514ae2e0d88. It renders an ESC/POS stream to
    one PNG per sheet with a printer profile of its own, so it is the closest
    thing to a second opinion on the same bytes this page has.

    It is a Rust program and ships no binary, so it has to be built once. There
    is no Docker here and the release profile of the workspace wants a frontend
    bundle that only a Docker or just build produces, so the debug binary is
    what is built; it renders the same pixels, slower.

        git clone https://github.com/receiptful/escpost build/references/escpost
        git -C build/references/escpost checkout c4a7665
        cd build/references/escpost && cargo build --bin escpost
        cp target/debug/escpost ../escpost-bin

    The module looks for the binary in this order:

      $RENDERER_ESCPOST
      build/references/escpost-bin
      build/references/escpost/target/debug/escpost
      build/references/escpost/target/release/escpost

    and reports itself unavailable when none of them is there. The exact
    invocation per fixture is on the contact sheet, next to the render.

    ESCPost cuts a stream into sheets and writes one PNG per sheet. The paper of
    this renderer is one image, so the sheets are stacked in the order of the
    manifest before they are compared.
*/

export const name = 'escpost';

export const version = '0.2.1 (c4a7665)';

export const kind = 'image';

/** The profiles of ESCPost, by the print width of the fixture */

const PROFILES = {576: 'REFERENCE', 384: 'NT-5890K'};

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/**
 * Where the binary is, or an empty string
 *
 * @return {string}   The path
 */
export function binary() {
  return locate([
    process.env.RENDERER_ESCPOST,
    path.join(references, 'escpost-bin'),
    path.join(references, 'escpost', 'target', 'debug', 'escpost'),
    path.join(references, 'escpost', 'target', 'release', 'escpost'),
  ]);
}

/**
 * Stack the sheets of a render into one bitmap, in the order they came out
 *
 * @param  {object[]}   sheets   The bitmaps
 * @return {object}              One bitmap
 */
function stack(sheets) {
  const width = Math.max(...sheets.map((sheet) => sheet.width));
  const height = sheets.reduce((total, sheet) => total + sheet.height, 0);
  const result = Bitmap.create(width, height);

  let offset = 0;

  for (const sheet of sheets) {
    Bitmap.blit(sheet, result, 0, offset);
    offset += sheet.height;
  }

  return result;
}

/**
 * What ESCPost makes of one fixture
 *
 * @param  {object}              fixture   The fixture: library, name, input and provenance
 * @param  {object}              target    Where the render goes: directory and the path in the page
 * @return {Promise<Reference>}            The reference
 */
export async function reference(fixture, target) {
  const scope = outOfScope(fixture);

  if (scope) {
    return unavailable(name, version, scope);
  }

  const tool = binary();

  if (!tool) {
    return unavailable(name, version, 'no escpost binary, see tools/contact-sheet/references/escpost.js');
  }

  const profile = PROFILES[fixture.provenance.width] || 'REFERENCE';
  const output = path.join(target.directory, `${fixture.name}.escpost`);

  fs.rmSync(output, {recursive: true, force: true});

  const args = [
    'render', fixture.input,
    '--format', 'binary',
    '--profile', profile,
    '--non-interactive',
    '--no-antialias',
    '--output-dir', output,
  ];

  const command = `${path.relative(root, tool) || tool} ${args.join(' ')}`;
  const result = await run(tool, args);

  if (result.code !== 0) {
    return Object.assign(
        unavailable(name, version, `escpost render failed: ${(result.stderr || result.error).trim()}`),
        {command},
    );
  }

  const sheets = fs.existsSync(output) ?
    fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort() :
    [];

  if (!sheets.length) {
    return Object.assign(unavailable(name, version, 'escpost wrote no sheet'), {command});
  }

  const bitmaps = [];

  for (const sheet of sheets) {
    bitmaps.push(await fromPng(new Uint8Array(fs.readFileSync(path.join(output, sheet)))));
  }

  /* ESCPost writes one sheet per cut; the sheet shows and measures them
     stacked in order, the way our own render stitches its items, so a receipt
     with cuts is seen whole and not as its first sheet alone */

  const bitmap = bitmaps.length === 1 ? bitmaps[0] : stack(bitmaps);
  const file = `${fixture.name}.escpost.png`;

  fs.writeFileSync(path.join(target.directory, file), await toPng(bitmap));

  return {
    tool: name,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    files: sheets.map((sheet) => path.join(target.prefix, `${fixture.name}.escpost`, sheet)),
    bitmap,
    note: sheets.length > 1 ? `${sheets.length} sheets, stacked` : '',
    command: `${command}, profile ${profile}`,
  };
}
