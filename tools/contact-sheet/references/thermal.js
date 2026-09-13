import fs from 'node:fs';
import path from 'node:path';

import {toPng} from '../../../src/formats/png.js';
import {references, root, locate, run, unavailable, outOfScope, fromPng, crop} from './shared.js';

/*
    thermal as a reference renderer, section 16b.

    thermal, https://github.com/zachzurn/thermal, MIT or Apache 2.0, commit
    9456874a850b8604d95eca428cca027750cd6188. It renders an ESC/POS stream to
    one PNG, which is what is compared here, and to HTML next to it, and it is
    the renderer whose own sample renders the eye review of the escpos-tools
    fixture was read against.

    It is a Rust library with no binary of its own: the repository renders its
    samples from a test. The shim next to this module,
    tools/contact-sheet/references/thermal-cli/, is ten lines of Rust that call
    the same two renderers on a file, and it pins the library by commit, so it
    builds without a checkout:

        cd tools/contact-sheet/references/thermal-cli
        CARGO_TARGET_DIR=../../../../build/references/thermal-cli cargo build --release
        cp ../../../../build/references/thermal-cli/release/thermal-cli \
           ../../../../build/references/thermal-bin

    The module looks for the binary in this order:

      $RENDERER_THERMAL
      build/references/thermal-bin
      build/references/thermal-cli/release/thermal-cli

    and reports itself unavailable when none of them is there.

    thermal renders one image for the whole stream, cuts included, so its render
    needs no stacking. It writes RGB, which the PNG reader of shared.js reduces
    to ink.

    Its paper is not configurable from outside: Context::default() of
    thermal_parser fixes a 3.2 inch canvas at 203 dots per inch with a margin
    of 0.1 inch on either side and three times that above the paper, 649 dots
    wide with a print area of 609 that starts 60 rows down, and the renderer
    keeps that context to itself. So the render is cropped to the print area
    here, the 20 dots of margin cut from both sides and the 60 rows from the
    top, before it is compared with our paper and shown on the sheet: the
    agreement metric then scales thermal's 609 dot print area to our paper
    width instead of scaling its margins along with it, the height it compares
    is the paper's and not the paper plus a margin, and the columns of the
    sheet line up. There is no margin below the paper.
*/

/* thermal's margins in dots, 0.1 inch at 203 dots per inch on either side
   and three times that above, the render_area of its default context */

const MARGIN = Math.floor(203 * 0.1);
const TOP = MARGIN * 3;

export const name = 'thermal';

export const version = '9456874';

export const kind = 'image';

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
    process.env.RENDERER_THERMAL,
    path.join(references, 'thermal-bin'),
    path.join(references, 'thermal-cli', 'release', 'thermal-cli'),
  ]);
}

/**
 * What thermal makes of one fixture
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
    return unavailable(name, version, 'no thermal binary, see tools/contact-sheet/references/thermal.js');
  }

  const file = `${fixture.name}.thermal.png`;
  const page = `${fixture.name}.thermal.html`;

  const args = [fixture.input, path.join(target.directory, file), path.join(target.directory, page)];
  const command = `${path.relative(root, tool) || tool} ${args.join(' ')}`;

  const result = await run(tool, args);

  if (result.code !== 0 || !fs.existsSync(path.join(target.directory, file))) {
    return Object.assign(
        unavailable(name, version, `thermal failed: ${(result.stderr || result.error).trim()}`),
        {command},
    );
  }

  /* The print area of the canvas, without thermal's margins, is what is
     compared and shown; the cropped image replaces thermal's own file */

  const canvas = await fromPng(new Uint8Array(fs.readFileSync(path.join(target.directory, file))));
  const bitmap = crop(canvas, MARGIN, TOP, canvas.width - 2 * MARGIN, canvas.height - TOP);

  fs.writeFileSync(path.join(target.directory, file), await toPng(bitmap));

  const errors = result.stderr.trim() ? `reported ${result.stderr.trim().split('\n').length} errors` : '';

  return {
    tool: name,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    page: path.join(target.prefix, page),
    bitmap,
    note: [`cropped to its print area from a ${canvas.width} by ${canvas.height} canvas`, errors].filter(Boolean).join(', '),
    command,
  };
}
