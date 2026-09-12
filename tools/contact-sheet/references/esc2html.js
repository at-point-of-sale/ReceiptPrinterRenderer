import fs from 'node:fs';
import path from 'node:path';

import {references, root, locate, run, unavailable, outOfScope} from './shared.js';

/*
    esc2html of escpos-tools as a reference renderer, section 16b.

    escpos-tools, https://github.com/receipt-print-hq/escpos-tools, MIT, commit
    4311694dd632e0f509eba691d26adf8c2f092daf. Its esc2html.php reads an ESC/POS
    stream and writes HTML: text with its inline formatting, and every image of
    the stream as a data URI.

    It is PHP and it needs two things this machine may not have. The first is
    the composer install of the repository:

        git clone https://github.com/receipt-print-hq/escpos-tools build/references/escpos-tools
        git -C build/references/escpos-tools checkout 4311694
        composer install -d build/references/escpos-tools

    The second is the imagick extension: every image command of the parser,
    ESC *, GS v 0 and the graphics group, builds its picture with Imagick, so a
    stream with an image is a fatal error without it. `php -m` says whether it
    is there, and this module checks the same thing and reports itself
    unavailable when it is not.

    The module looks for the script in this order:

      $RENDERER_ESC2HTML
      build/references/escpos-tools/esc2html.php

    and for PHP at $RENDERER_PHP, /opt/homebrew/bin/php or php on the PATH.

    What it produces is HTML, not an image, so it is linked from the contact
    sheet rather than shown next to the render, and it has no agreement metric:
    that needs two images. A converter would give one, but none of the
    headless browsers is a dependency of this package, see the notes of section
    16b.
*/

export const name = 'esc2html';

export const version = '4311694';

export const kind = 'html';

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/**
 * Where the PHP binary is, or an empty string
 *
 * @return {string}   The path
 */
function php() {
  return locate([
    process.env.RENDERER_PHP,
    '/opt/homebrew/bin/php',
    '/usr/local/bin/php',
    '/usr/bin/php',
  ]);
}

/**
 * Where the script is, or an empty string
 *
 * @return {string}   The path
 */
export function script() {
  return locate([
    process.env.RENDERER_ESC2HTML,
    path.join(references, 'escpos-tools', 'esc2html.php'),
  ]);
}

/** What the availability check found, so that it runs once per sheet */

let checked = null;

/**
 * Whether the tool can run here: PHP, the checkout with its composer install,
 * and the imagick extension the image commands need
 *
 * @return {Promise<object>}   Whether it can run and why not
 */
export async function available() {
  if (checked) {
    return checked;
  }

  const binary = php();
  const file = script();

  if (!binary) {
    checked = {ok: false, reason: 'no php on this machine'};
  } else if (!file) {
    checked = {ok: false, reason: 'no escpos-tools checkout, see tools/contact-sheet/references/esc2html.js'};
  } else if (!fs.existsSync(path.join(path.dirname(file), 'vendor', 'autoload.php'))) {
    checked = {ok: false, reason: 'the escpos-tools checkout has no composer install'};
  } else {
    const modules = await run(binary, ['-m']);

    checked = /^imagick$/im.test(modules.stdout) ?
      {ok: true, reason: '', binary, file} :
      {ok: false, reason: 'php has no imagick extension, which every image command of esc2html needs'};
  }

  return checked;
}

/**
 * What esc2html makes of one fixture
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

  const state = await available();

  if (!state.ok) {
    return unavailable(name, version, state.reason);
  }

  const file = `${fixture.name}.esc2html.html`;
  const command = `${state.binary} ${path.relative(root, state.file)} ${path.relative(root, fixture.input)}`;

  const result = await run(state.binary, [state.file, fixture.input], {cwd: path.dirname(state.file)});

  if (result.code !== 0 || !result.stdout.trim()) {
    return Object.assign(
        unavailable(name, version, `esc2html failed: ${(result.stderr || result.error).trim().slice(0, 200)}`),
        {command},
    );
  }

  fs.writeFileSync(path.join(target.directory, file), result.stdout);

  return {
    tool: name,
    version,
    available: true,
    reason: '',
    kind: 'html',
    file: path.join(target.prefix, file),
    note: 'HTML, so there is no agreement metric',
    command,
  };
}
