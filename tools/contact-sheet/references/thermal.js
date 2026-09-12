import fs from 'node:fs';
import path from 'node:path';

import {references, root, locate, run, unavailable, outOfScope, fromPng} from './shared.js';

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
*/

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

  return {
    tool: name,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    page: path.join(target.prefix, page),
    bitmap: await fromPng(new Uint8Array(fs.readFileSync(path.join(target.directory, file)))),
    note: result.stderr.trim() ? `reported ${result.stderr.trim().split('\n').length} errors` : '',
    command,
  };
}
