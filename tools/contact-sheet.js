import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../src/receipt-printer-renderer.js';
import {toPng} from '../src/formats/png.js';
import {stitch} from '../src/formats/stitch.js';
import {libraries, fixtures, external, options, directory as source} from '../test/helpers/external.js';
import {modules, references} from './contact-sheet/references/index.js';
import {agreement} from './contact-sheet/references/shared.js';

/*
    The contact sheet of the external fixtures, sections 16 and 16b.

    It renders every fixture of test/fixtures/external to a PNG and writes an
    index.html next to them that lists every fixture with its provenance and its
    render, and for receiptline the SVG preview of the same document next to it,
    which is what the golden images were reviewed against.

    Next to our render it shows what other renderers make of the same bytes,
    where they are installed on this machine: thermal and ESCPost as images,
    esc2html of escpos-tools and escpos-emulator as HTML. Every tool is a module
    of tools/contact-sheet/references, and a tool that is not there is a
    "not available" cell, never a failure, so the sheet builds on a machine with
    none of them.

    For the two that produce an image the page also carries a coarse agreement
    metric: the reference is scaled to our width, and the table gives the rows
    that carry ink in both and the relative height difference. It is information
    for a maintainer, not a check; no test looks at it.

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
 * A number as a percentage, with its sign
 *
 * @param  {number}   value   The relative difference, or null
 * @return {string}           The percentage
 */
function percentage(value) {
  return value === null || typeof value === 'undefined' ?
    '&mdash;' :
    `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
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
 * One reference render as a figure or a link, and its row of the agreement
 * table
 *
 * @param  {object}   reference   What a reference module returned
 * @param  {object}   paper       Our render, for the metric
 * @param  {string}   name        Name of the fixture
 * @return {object}               The HTML of the cell and the row of the table
 */
function cell(reference, paper, name) {
  const title = `${escape(reference.tool)} ${escape(reference.version)}`;

  if (!reference.available) {
    return {
      html: `<figure class="missing"><figcaption>${title}</figcaption>
      <div class="unavailable">not available<br><span>${escape(reference.reason)}</span></div></figure>`,
      row: null,
    };
  }

  if (reference.kind === 'html') {
    return {
      html: `<figure><figcaption>${title}</figcaption>
      <div class="page"><a href="${escape(reference.file)}">${escape(path.basename(reference.file))}</a>
      <p>${escape(reference.note || 'HTML, opened in a browser')}</p></div></figure>`,
      row: null,
    };
  }

  const metric = agreement(paper, reference.bitmap);

  return {
    html: `<figure><figcaption>${title}, ${reference.bitmap.width} by ${reference.bitmap.height}${
      reference.note ? `, ${escape(reference.note)}` : ''}</figcaption>
      <img src="${escape(reference.file)}" alt="${escape(name)} by ${escape(reference.tool)}"></figure>`,
    row: Object.assign({fixture: name, tool: reference.tool}, metric),
  };
}

/**
 * The rows of the table of a library
 *
 * @param  {string}     library   Name of the library
 * @param  {object[]}   rows      The agreement rows of every library, appended to
 * @return {Promise<string>}      The HTML
 */
async function sheet(library, rows) {
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

    const found = await references({
      library,
      name,
      input: path.join(source, library, `${name}.bin`),
      provenance: fixture.provenance,
    }, {
      directory: path.join(target, library),
      prefix: library,
    });

    const cells = found.map((reference) => cell(reference, paper, name));

    for (const entry of cells) {
      if (entry.row) {
        rows.push(Object.assign({library}, entry.row));
      }
    }

    const provenance = Object.entries(fixture.provenance)
        .map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`)
        .join('\n');

    const commands = found.filter((reference) => reference.command)
        .map((reference) => `<tr><th>${escape(reference.tool)}</th><td>${escape(reference.command)}</td></tr>`)
        .join('\n');

    html += `<section>
  <h3>${escape(name)}</h3>
  <div class="fixture">
    <figure><figcaption>render, ${paper.width} by ${paper.height}</figcaption>
      <img src="${escape(file)}" alt="${escape(name)}"></figure>
    ${preview[name] ? `<figure><figcaption>receiptline preview</figcaption>
      <img src="${escape(path.join(library, `${name}.svg`))}" alt="${escape(name)} preview"></figure>` : ''}
    ${cells.map((entry) => entry.html).join('\n    ')}
    <table>${provenance}</table>
  </div>
  ${commands ? `<details><summary>the reference invocations</summary><table>${commands}</table></details>` : ''}
</section>\n`;

    const agreed = cells.filter((entry) => entry.row)
        .map((entry) => `${entry.row.tool} ${percentage(entry.row.heightDifference).replace('&mdash;', '-')}`)
        .join(', ');

    console.log(`  ${name.padEnd(38)} ${String(paper.height).padStart(5)} rows  ${agreed}`);
  }

  return html;
}

/**
 * The agreement table of the page: one row per fixture per reference that
 * produced an image
 *
 * @param  {object[]}   rows   What the sheets collected
 * @return {string}            The HTML
 */
function table(rows) {
  if (!rows.length) {
    return '<p>No reference renderer produced an image, so there is no agreement table. ' +
      'See the modules in <code>tools/contact-sheet/references</code> for what each of them needs.</p>';
  }

  const body = rows.map((row) => `<tr>
  <td>${escape(row.library)}/${escape(row.fixture)}</td><td>${escape(row.tool)}</td>
  <td class="number">${row.rows}</td><td class="number">${row.referenceRows}</td>
  <td class="number">${percentage(row.rowDifference)}</td>
  <td class="number">${row.height}</td><td class="number">${row.referenceHeight}</td>
  <td class="number">${percentage(row.heightDifference)}</td>
</tr>`).join('\n');

  return `<table class="agreement">
<thead><tr><th>Fixture</th><th>Reference</th><th>Ink rows, ours</th><th>Ink rows, theirs</th>
<th>Difference</th><th>Height, ours</th><th>Height, theirs</th><th>Difference</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

/**
 * Write the contact sheet
 */
async function main() {
  fs.rmSync(target, {recursive: true, force: true});
  fs.mkdirSync(target, {recursive: true});

  const rows = [];

  let body = '';

  const list = libraries();

  for (const library of list) {
    console.log(library);
    body += await sheet(library, rows);
  }

  const tools = modules.map((module) => {
    const ran = rows.some((row) => row.tool === module.name);

    return `<li><strong>${escape(module.name)}</strong> ${escape(module.version)}, ` +
      `${escape(module.kind)}${ran ? '' : ', see its module for what it needs'}</li>`;
  }).join('\n');

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
  details { margin-top: .75rem; color: #666; }
  details td { padding-right: .75rem; white-space: pre-wrap; }
  .unavailable { border: 1px dashed #ccc; color: #888; padding: 1rem; width: 14rem; background: #fafafa; }
  .unavailable span { color: #aaa; }
  .page { border: 1px solid #eee; padding: 1rem; width: 14rem; background: #fafafa; }
  .page p { color: #888; margin: .5rem 0 0; }
  .agreement { background: #fff; border: 1px solid #ddd; margin: 1rem 0; }
  .agreement th, .agreement td { padding: .2rem .75rem; border-bottom: 1px solid #eee; }
  .agreement thead th { background: #f0f0f0; }
  .number { text-align: right; }
</style>
</head>
<body>
<h1>External fixtures</h1>
<p>Every byte stream in <code>test/fixtures/external</code>, rendered by this package,
with the provenance of the capture and, where the tool is installed on this machine,
what the other renderers make of the same bytes. Generated by <code>npm run contact-sheet</code>,
not committed.</p>
<h2 id="references">Reference renderers</h2>
<ul>
${tools}
</ul>
<p>The agreement below is coarse and on purpose: the reference is scaled to our width, and what is
compared is the number of rows that carry any ink and the height. It says which fixtures are worth
looking at, nothing more, and no test fails on it.</p>
${table(rows)}
<nav><p>${list.map((library) => `<a href="#${escape(library)}">${escape(library)}</a>`).join(' &middot; ')}</p></nav>
${body}
</body>
</html>
`;

  fs.writeFileSync(path.join(target, 'index.html'), html);

  fs.writeFileSync(
      path.join(target, 'agreement.json'),
      JSON.stringify(rows, null, 2) + '\n',
  );

  console.log(`\n${path.join(target, 'index.html')}`);
}

main().catch((error) => {
  console.error(`The contact sheet failed: ${error.message}`);
  process.exitCode = 1;
});
