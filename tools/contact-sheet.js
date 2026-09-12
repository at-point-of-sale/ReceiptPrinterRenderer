import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../src/receipt-printer-renderer.js';
import {toPng} from '../src/formats/png.js';
import {stitch} from '../src/formats/stitch.js';
import {libraries, fixtures, external, options} from '../test/helpers/external.js';

/*
    The contact sheet of the external fixtures, section 16.

    It renders every fixture of test/fixtures/external to a PNG and writes an
    index.html next to them that lists every fixture with its provenance and its
    render, and for receiptline the SVG preview of the same document next to it,
    which is what the golden images were reviewed against.

        npm run contact-sheet

    Everything it writes lands in build/contact-sheet and nothing of it is
    committed; build/ is in .gitignore. Run it to review a capture or to see
    what a change to the renderer did to the streams of the wild.
*/

/**
 * @typedef {import('../test/helpers/external.js').Provenance} Provenance
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const target = path.join(root, 'build', 'contact-sheet');

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
 * The SVG previews of a library, keyed by the name of the fixture, for the
 * libraries that have one. Only receiptline does, and its capture script knows
 * how to make them.
 *
 * @param  {string}   library   Name of the library
 * @return {Promise<object>}    The previews, empty when the library has none
 */
async function previews(library) {
  if (library !== 'receiptline') {
    return {};
  }

  try {
    const capture = await import('./external/receiptline/capture.js');
    const result = {};

    for (const item of capture.captures()) {
      result[item.name] = capture.preview(item);
    }

    return result;
  } catch (error) {
    console.log(`  no previews: ${error.message}`);
    return {};
  }
}

/**
 * The rows of the table of a library
 *
 * @param  {string}   library   Name of the library
 * @return {Promise<string>}    The HTML
 */
async function sheet(library) {
  const preview = await previews(library);

  let html = `<h2 id="${escape(library)}">${escape(library)}</h2>\n`;

  for (const name of fixtures(library)) {
    const fixture = external(library, name);
    const items = new ReceiptPrinterRenderer(options(fixture.provenance)).render(fixture.bytes);
    const paper = stitch(items, {width: fixture.provenance.width});

    const file = path.join(library, `${name}.png`);

    fs.mkdirSync(path.join(target, library), {recursive: true});
    fs.writeFileSync(path.join(target, file), await toPng(paper));

    if (preview[name]) {
      fs.writeFileSync(path.join(target, library, `${name}.svg`), preview[name]);
    }

    const provenance = Object.entries(fixture.provenance)
        .map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`)
        .join('\n');

    html += `<section>
  <h3>${escape(name)}</h3>
  <div class="fixture">
    <figure><figcaption>render, ${paper.width} by ${paper.height}</figcaption>
      <img src="${escape(file)}" alt="${escape(name)}"></figure>
    ${preview[name] ? `<figure><figcaption>receiptline preview</figcaption>
      <img src="${escape(path.join(library, `${name}.svg`))}" alt="${escape(name)} preview"></figure>` : ''}
    <table>${provenance}</table>
  </div>
</section>\n`;

    console.log(`  ${name.padEnd(38)} ${String(paper.height).padStart(5)} rows`);
  }

  return html;
}

/**
 * Write the contact sheet
 */
async function main() {
  fs.rmSync(target, {recursive: true, force: true});
  fs.mkdirSync(target, {recursive: true});

  let body = '';

  const list = libraries();

  for (const library of list) {
    console.log(library);
    body += await sheet(library);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>External fixtures</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 2rem; background: #f6f6f6; color: #222; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; border-bottom: 1px solid #ccc; }
  h3 { font-size: 1rem; margin: 0 0 .5rem; font-family: ui-monospace, monospace; }
  section { background: #fff; border: 1px solid #ddd; padding: 1rem; margin: 1rem 0; }
  .fixture { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
  figure { margin: 0; }
  figcaption { color: #666; margin-bottom: .25rem; }
  img { background: #fff; border: 1px solid #eee; image-rendering: pixelated; max-width: 600px; }
  table { border-collapse: collapse; }
  th { text-align: left; padding: 0 .75rem .1rem 0; font-weight: 600; vertical-align: top; white-space: nowrap; }
  td { padding: 0 0 .1rem; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>External fixtures</h1>
<p>Every byte stream in <code>test/fixtures/external</code>, rendered by this package,
with the provenance of the capture. Generated by <code>npm run contact-sheet</code>,
not committed.</p>
<nav><p>${list.map((library) => `<a href="#${escape(library)}">${escape(library)}</a>`).join(' &middot; ')}</p></nav>
${body}
</body>
</html>
`;

  fs.writeFileSync(path.join(target, 'index.html'), html);

  console.log(`\n${path.join(target, 'index.html')}`);
}

main().catch((error) => {
  console.error(`The contact sheet failed: ${error.message}`);
  process.exitCode = 1;
});
