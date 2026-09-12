import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

import {unavailable, outOfScope} from './shared.js';

/*
    escpos-emulator as a reference renderer, section 16b.

    escpos-emulator, https://github.com/lezram/escpos-emulator, MIT, 0.2.0. It
    is a printer emulator: a TCP server on port 9100 takes a job, its parser
    turns the bytes into lines of formatted segments, and a web page shows them
    as a receipt.

    Neither the port nor the page is wanted here, and neither is needed: the
    parser is a module of the package, `dist/escpos-parser.js`, and it hands a
    receipt to a callback. So the module drives the parser directly and writes
    the receipt out as HTML with the class names and the rules of the
    emulator's own page, `dist/html/index.html`: a div per line with its
    alignment, a span per segment with bold, underline, reverse, font B and the
    size multipliers. The parse is theirs, the page around it is this module's,
    which is what the caption on the contact sheet says.

    It is a dev dependency of this package, so `npm install` is the whole setup.
    The module reports itself unavailable when the package is not installed, and
    what it produces is HTML, so it is linked rather than shown and has no
    agreement metric.
*/

export const name = 'escpos-emulator';

export const version = '0.2.0';

export const kind = 'html';

/** The printer the emulator models, an Epson TM-M30III of 48 columns */

const MODEL = 'TM-M30III';

const require = createRequire(import.meta.url);

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/**
 * The parser and the printer model of the package, or null when it is not
 * installed
 *
 * @return {Promise<object>}   The two modules, or null
 */
async function parser() {
  try {
    const base = path.dirname(require.resolve('escpos-emulator/package.json'));

    return {
      EscPosParser: (await import(path.join(base, 'dist', 'escpos-parser.js'))).EscPosParser,
      getModel: (await import(path.join(base, 'dist', 'printer-model.js'))).getModel,
      version: JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version,
    };
  } catch {
    return null;
  }
}

/**
 * Escape text for HTML
 *
 * @param  {string}   text   The text
 * @return {string}          The text, with the five characters escaped
 */
function escape(text) {
  return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * One receipt of the emulator as HTML, the way its own page draws it
 *
 * @param  {object[]}   receipts   The receipts the parser handed over
 * @param  {string}     title      Name of the fixture
 * @param  {string}     release    Version of the package that parsed them
 * @return {string}                The page
 */
function page(receipts, title, release) {
  let body = '';

  for (const receipt of receipts) {
    body += '<div class="receipt">\n';

    for (const line of receipt.lines) {
      const classes = ['line', line.align === 'center' ? 'center' : '', line.align === 'right' ? 'right' : '']
          .filter((entry) => entry).join(' ');

      const segments = (line.segments || []).map((segment) => {
        const style = [
          'seg',
          segment.bold ? 'bold' : '',
          segment.underline === 1 ? 'underline-1' : '',
          segment.underline === 2 ? 'underline-2' : '',
          segment.reverse ? 'reverse' : '',
          segment.width > 1 ? `w${Math.min(segment.width, 4)}` : '',
          segment.height > 1 ? `h${Math.min(segment.height, 4)}` : '',
          segment.font === 'B' ? 'font-B' : '',
        ].filter((entry) => entry).join(' ');

        return `<span class="${style}">${escape(segment.text)}</span>`;
      }).join('');

      body += `  <div class="${classes}">${segments || '&nbsp;'}</div>\n`;
    }

    body += '</div>\n';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}, escpos-emulator</title>
<style>
  body { background: #f6f6f6; margin: 2rem; }
  .receipt { background: #fff; width: 48ch; padding: 1rem; margin: 0 0 1rem; border: 1px solid #ddd;
    font: 14px/1.25 ui-monospace, monospace; white-space: pre; }
  .line { min-height: 1.25em; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .underline-1 { text-decoration: underline; }
  .underline-2 { text-decoration: underline; text-decoration-thickness: 2px; }
  .reverse { background: #222; color: #fff; }
  .font-B { font-size: .75em; }
  .w2 { letter-spacing: .5ch; } .w3 { letter-spacing: 1ch; } .w4 { letter-spacing: 1.5ch; }
  .h2 { font-size: 2em; } .h3 { font-size: 3em; } .h4 { font-size: 4em; }
</style>
</head>
<body>
<p>${escape(title)} through the parser of escpos-emulator ${escape(release)}, drawn with the classes of its own page.
Images and symbols are not part of its model and do not appear.</p>
${body}</body>
</html>
`;
}

/**
 * What escpos-emulator makes of one fixture
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

  const module = await parser();

  if (!module) {
    return unavailable(name, version, 'escpos-emulator is not installed, run npm install');
  }

  const receipts = [];

  /* The parser writes a line to the console for every command its model does
     not know, which is most of a receipt of the wild, so it is quiet here and
     the count of what it did not know goes on the page instead */

  const log = console.log;
  const unknown = new Set();

  try {
    console.log = (message) => unknown.add(String(message));

    const instance = new module.EscPosParser(module.getModel(MODEL), (receipt) => receipts.push(receipt));

    instance.process(Buffer.from(fs.readFileSync(fixture.input)));
    instance.flush();
  } catch (error) {
    return unavailable(name, module.version, `the parser threw: ${error.message}`);
  } finally {
    console.log = log;
  }

  if (!receipts.length) {
    return unavailable(name, module.version, 'the parser produced no receipt from this stream');
  }

  const file = `${fixture.name}.escpos-emulator.html`;

  fs.writeFileSync(
      path.join(target.directory, file),
      page(receipts, `${fixture.library}/${fixture.name}`, module.version),
  );

  return {
    tool: name,
    version: module.version,
    available: true,
    reason: '',
    kind: 'html',
    file: path.join(target.prefix, file),
    note: [
      receipts.length > 1 ? `${receipts.length} receipts, one per cut` : '',
      unknown.size ? `${unknown.size} commands its model does not know` : '',
    ].filter((entry) => entry).join(', '),
    command: `node -e "new EscPosParser(getModel('${MODEL}'), …).process(<${fixture.name}.bin>)", ` +
      'see tools/contact-sheet/references/escpos-emulator.js',
  };
}
