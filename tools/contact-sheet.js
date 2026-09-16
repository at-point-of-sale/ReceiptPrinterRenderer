import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../src/receipt-printer-renderer.js';
import {toPng} from '../src/formats/png.js';
import {stitch} from '../src/formats/stitch.js';
import {libraries, fixtures, external, options, directory as source} from '../test/helpers/external.js';
import {modules, references} from './contact-sheet/references/index.js';
import {agreement} from './contact-sheet/references/shared.js';
import {drivers, scripts, styles, header, script} from './contact-sheet/printing.js';

/*
    The contact sheet of the external fixtures, sections 16 and 16b.

    It renders every fixture of test/fixtures/external to a PNG and writes an
    index.html next to them that lists every fixture with its provenance and its
    render.

    Next to our render, in a grid of five equal columns, it shows our own SVG
    output, the document itself, and what other renderers make of the same bytes,
    where they are installed on this machine: ESCPost and thermal, both of which
    produce an image, and receiptio, which renders the document a receiptline
    fixture was made from rather than its bytes, see section 16f. Every tool is
    a module of tools/contact-sheet/references, and a tool that is not there is
    a "not available" cell, never a failure, so the sheet builds on a machine
    with none of them.

    The page also carries a coarse agreement metric per reference: the reference
    is scaled to our width, and the table gives the rows that carry ink in both
    and the relative height difference. It is information for a maintainer, not
    a check; no test looks at it.

    Since section 16g the sheet also prints. The header connects to a printer
    over USB, serial or Bluetooth with the drivers of the ecosystem, and every
    card has a button that sends that fixture's bytes to it as they are stored,
    see tools/contact-sheet/printing.js. Web USB and Web Serial need a secure
    context, so there is a server for the build directory next to it:

        npm run contact-sheet
        npm run contact-sheet:serve

    Everything it writes lands in build/contact-sheet and nothing of it is
    committed; build/ is in .gitignore. Run it to review a capture or to see
    what a change to the renderer did to the streams of the wild.
*/

/**
 * @typedef {import('../test/helpers/external.js').Provenance} Provenance
 * @typedef {import('../src/types.js').RenderItem} RenderItem
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
 * The items of a render split into the pieces of paper they print, section 24:
 * a run of items between two cuts, in the order they leave the printer. A
 * stream without a cut is one run, and a cut at the very end leaves an empty
 * run, which stitches to nothing and is dropped by the caller.
 *
 * @param  {RenderItem[]}            items   The items of a render
 * @return {Array<RenderItem[]>}             The runs, one per piece of paper
 */
function pieces(items) {
  const runs = [[]];

  for (const item of items || []) {
    if (item.type === 'cut') {
      runs.push([]);
    } else {
      runs[runs.length - 1].push(item);
    }
  }

  return runs;
}

/**
 * The images of one figure: the pieces of paper of a render, stacked in the
 * order they came out, with the gap between them that reads as the cut
 *
 * @param  {string[]}   files   Paths of the pieces, relative to the page
 * @param  {string}     alt     What the render is of
 * @return {string}             The HTML
 */
function images(files, alt) {
  const list = files.map((file, index) => `<img src="${escape(file)}" alt="${escape(alt)}${
    files.length > 1 ? `, piece ${index + 1} of ${files.length}` : ''}">`);

  return `<div class="pieces">${list.join('')}</div>`;
}

/**
 * One reference render as a figure, and its row of the agreement
 * table
 *
 * @param  {object}   reference   What a reference module returned
 * @param  {object}   paper       Our render, for the metric
 * @param  {string}   name        Name of the fixture
 * @return {object}               The HTML of the cell and the row of the table
 */
function cell(reference, paper, name) {
  /* A module that renders something else than our bytes says so in a title of
     its own, which is receiptio of section 16f and nothing else so far */

  const title = `${escape(reference.title || reference.tool)} ${escape(reference.version)}`;

  if (!reference.available) {
    return {
      html: `<figure class="missing"><figcaption>${title}</figcaption>
      <div class="unavailable">not available<br><span>${escape(reference.reason)}</span></div></figure>`,
      row: null,
    };
  }

  const metric = agreement(paper, reference.bitmap);

  return {
    html: `<figure><figcaption>${title}, ${reference.bitmap.width} by ${reference.bitmap.height}${
      reference.note ? `, ${escape(reference.note)}` : ''}${
      reference.flag ? `<br><span class="flag">${escape(reference.flag)}</span>` : ''}</figcaption>
      ${images(reference.files || [reference.file], `${name} by ${reference.tool}`)}</figure>`,
    row: Object.assign({fixture: name, tool: reference.tool, filtered: Boolean(reference.flag)}, metric),
  };
}

/**
 * The rows of the table of a library
 *
 * @param  {string}     library   Name of the library
 * @param  {object[]}   rows      The agreement rows of every library, appended to
 * @param  {object}     bytes     The base64 of every fixture, for the print buttons, added to
 * @return {Promise<string>}      The HTML
 */
async function sheet(library, rows, bytes) {
  let html = `<div class="library"><h2 id="${escape(library)}">${escape(library)}</h2>\n`;

  for (const name of fixtures(library)) {
    const fixture = external(library, name);
    const items = new ReceiptPrinterRenderer(options(fixture.provenance)).render(fixture.bytes);
    const paper = stitch(items, {width: fixture.provenance.width});

    fs.mkdirSync(path.join(target, library), {recursive: true});

    /* One PNG per piece of paper, section 24: the items are split at every cut
       and every run stitched on its own, so that a cut is seen as a break
       between two images. The first piece keeps the name of the fixture, the
       rest are numbered, and the stitched whole above is what the agreement
       metric and the caption still speak of */

    const sheets = pieces(items)
        .map((run) => stitch(run, {width: fixture.provenance.width}))
        .filter((piece) => piece.height > 0);

    const files = [];

    for (const [index, piece] of (sheets.length ? sheets : [paper]).entries()) {
      const written = path.join(library, index ? `${name}.${index + 1}.png` : `${name}.png`);

      fs.writeFileSync(path.join(target, written), await toPng(piece));
      files.push(written);
    }

    const found = await references({
      library,
      name,
      input: path.join(source, library, `${name}.bin`),
      provenance: fixture.provenance,
      cuts: items.some((item) => item.type === 'cut'),
    }, {
      directory: path.join(target, library),
      prefix: library,
    });

    /* A tool that does not apply to a fixture, receiptio for a stream that did
       not come from a receiptline document, gets no cell at all; a tool that
       is missing on this machine gets a "not available" one */

    const cells = found
        .filter((reference) => reference.applicable !== false)
        .map((reference) => cell(reference, paper, name));

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

    const key = `${library}/${name}`;

    bytes[key] = Buffer.from(fixture.bytes).toString('base64');

    html += `<section data-language="${escape(fixture.provenance.language)}" data-columns="${
      fixture.provenance.columns}" data-width="${fixture.provenance.width}">
  <div class="title">
    <h3>${escape(name)} <span class="language">${escape(fixture.provenance.language)}, ${
  fixture.bytes.length} bytes</span></h3>
    <div class="print">
      <span class="result"></span>
      <button data-fixture="${escape(key)}" disabled>Print</button>
    </div>
  </div>
  <div class="fixture" style="--columns: ${cells.length + 1}">
    <figure><figcaption>render, ${paper.width} by ${paper.height}${
  files.length > 1 ? `, ${files.length} pieces` : ''}</figcaption>
      ${images(files, name)}</figure>
    ${cells.map((entry) => entry.html).join('\n    ')}
  </div>
  <details><summary>provenance</summary><table class="provenance">${provenance}</table></details>
  ${commands ? `<details><summary>the reference invocations</summary><table>${commands}</table></details>` : ''}
</section>\n`;

    const agreed = cells.filter((entry) => entry.row)
        .map((entry) => `${entry.row.tool} ${percentage(entry.row.heightDifference).replace('&mdash;', '-')}`)
        .join(', ');

    console.log(`  ${name.padEnd(38)} ${String(paper.height).padStart(5)} rows  ${agreed}`);
  }

  return html + '</div>\n';
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
  <td>${escape(row.library)}/${escape(row.fixture)}</td><td>${escape(row.tool)}${
  row.filtered ? ' <span class="flag" title="rendered after a pre-filter">pre-filtered</span>' : ''}</td>
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
  const bytes = {};

  let body = '';

  const list = libraries();

  for (const library of list) {
    console.log(library);
    body += await sheet(library, rows, bytes);
  }

  /* The drivers of the header, copied into the sheet, and the languages and
     the widths the fixtures come in, which is what the two filters offer: a
     width is a pair of columns and dots, since a fixture carries both */

  const found = drivers(target);

  const provenances = list.flatMap((library) => fixtures(library).map((name) => external(library, name).provenance));

  const languages = [...new Set(provenances.map((provenance) => provenance.language))].sort();

  const widths = [...new Map(provenances.map((provenance) =>
    [`${provenance.columns}|${provenance.width}`, {columns: provenance.columns, width: provenance.width}],
  )).values()].sort((a, b) => a.width - b.width || a.columns - b.columns);

  const tools = modules.map((module) => {
    const ran = rows.some((row) => row.tool === module.name);

    return `<li><strong>${escape(module.title || module.name)}</strong> ${escape(module.version)}, ` +
      `${escape(module.kind)}${ran ? '' : ', see its module for what it needs'}</li>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>External fixtures</title>
<style>
  /* The visual style of the ReceiptPrinterPlayground, inlined: an off white
     page, a grey header with white rounded controls, a toolbar band below it,
     white panels, monospace captions in grey. Only the look is borrowed */
  :root { --font-stack-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace; }
  body { margin: 0; padding: 0; background: #fbfbfb; color: #000; font-family: system-ui; font-size: 10pt; }
  main { padding: 5px 20px 20px; }
  h1 { font-size: 13pt; font-weight: 600; margin: 40px 0 8px; }
  h2 { font-size: 11pt; font-weight: 600; color: #444; margin: 30px 0 10px; }
  /* The sticky header is 61 dots tall, an anchor must land below it */
  h1, h2, section { scroll-margin-top: 76px; }
  h3 { font-size: 11pt; font-weight: 600; margin: 0 0 12px; font-family: var(--font-stack-mono); }
  h3 .language { font-weight: normal; color: #888; }
  p { color: #444; max-width: 60rem; }
  code { font-family: var(--font-stack-mono); font-size: 0.9em; }
  section { background: #f2f2f2; border-radius: 8px; padding: 24px 32px 20px; margin: 15px 0; }
  /* As many equal columns as the fixture has figures, five with receiptio and
     four without, over the whole width, and two rows: the captions on the
     first, aligned to the bottom, and the images on the second, so every image
     starts on the same line whatever the length of its caption. A figure is
     display: contents so that its caption and its image are placed separately */
  .fixture { display: grid; grid-template-columns: repeat(var(--columns, 5), 1fr); gap: 4px 24px; align-items: start; }
  figure { display: contents; }
  figcaption { grid-row: 1; align-self: end; color: #888; min-width: 0;
    font-family: var(--font-stack-mono); font-size: 11px; }
  figure > :not(figcaption) { grid-row: 2; min-width: 0; }
  /* The pieces of paper of one render, stacked with a gap between them, which
     with the dotted rules of the images reads as a cut, section 24 */
  .pieces { display: flex; flex-direction: column; gap: 6px; }
  img { display: block; width: 100%; height: auto; background: #fff; padding: 10px;
    border-top: 2px dotted #f2f2f2; border-bottom: 2px dotted #f2f2f2; border-left: none; border-right: none;
    box-sizing: border-box; }
  .unavailable { background: #f0f0f0; border-radius: 6px; color: #888; padding: 6px 8px;
    font-family: var(--font-stack-mono); font-size: 11px; }
  .unavailable span { color: #aaa; }
  figcaption .flag { color: #b26a00; }
  .title { display: flex; align-items: start; gap: 15px; }
  .title h3 { margin-right: auto; }
  table { border-collapse: collapse; font-size: 0.75rem; }
  th { text-align: left; padding: 0 12px 2px 0; font-weight: 600; color: #444; vertical-align: top;
    white-space: nowrap; }
  td { padding: 0 0 2px; font-family: var(--font-stack-mono); color: #444; }
  details { margin-top: 12px; color: #888; font-size: 0.75rem; }
  details table { margin-top: 8px; }
  details summary { cursor: pointer; user-select: none; }
  details td { padding-right: 12px; white-space: pre-wrap; }
  .agreement { background: #fff; border-radius: 8px; margin: 15px 0; }
  .agreement th, .agreement td { padding: 4px 12px; border-bottom: 1px solid #eee; }
  .agreement thead th { background: #eee; }
  .agreement thead th:first-child { border-radius: 8px 0 0 0; }
  .agreement thead th:last-child { border-radius: 0 8px 0 0; }
  .number { text-align: right; }
  .agreement .flag { color: #b26a00; font-size: 0.7rem; }
  ul { color: #444; }
${styles()}
</style>
</head>
<body>
${header(found, languages, widths, list)}
<main>
${body}
<h1 id="about">External fixtures</h1>
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
</main>
${scripts(found)}
${script(bytes, found)}
</body>
</html>
`;

  fs.writeFileSync(path.join(target, 'index.html'), html);

  fs.writeFileSync(
      path.join(target, 'agreement.json'),
      JSON.stringify(rows, null, 2) + '\n',
  );

  const printing = found.filter((driver) => driver.available)
      .map((driver) => `${driver.label} ${driver.version}`).join(', ');

  console.log(`\n${path.join(target, 'index.html')}`);
  console.log(`  ${Object.keys(bytes).length} fixtures to print with ${printing || 'no driver at all'}`);
  console.log('  npm run contact-sheet:serve, then http://localhost:8080');
}

main().catch((error) => {
  console.error(`The contact sheet failed: ${error.message}`);
  process.exitCode = 1;
});
