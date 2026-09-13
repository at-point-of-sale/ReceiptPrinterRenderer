import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../../../src/receipt-printer-renderer.js';
import {toSvg} from '../../../src/svg.js';
import {stitch} from '../../../src/formats/stitch.js';
import {options} from '../../../test/helpers/external.js';
import {unavailable, fromPng, dotAgreement} from './shared.js';

/*
    Our own SVG as a column of the sheet, section 4 of the SVG plan.

    This module is not a reference renderer either. The others run another
    project's renderer over the bytes of a fixture; this one runs ours twice,
    once into dots and once into an SVG document, and rasterizes the document
    with resvg so that the two can be looked at side by side. What it shows is
    whether the vector output is the receipt the bitmap output is: the text is
    the outlines of the same face the bitmaps were filled from, which differ at
    the edges of a stroke, and the rectangles and the images are the same dots.

    The figure carries the dot for dot agreement of the two, the measure of
    shared.js, which is the number test/svg.js asserts a bound of for the golden
    fixtures. The SVG itself is written next to the render and the caption links
    to it, so that a document can be opened in a browser from the sheet.

    resvg, @resvg/resvg-wasm, is a dev dependency of the tests, so this column
    needs no tool of its own; a checkout without it reports itself unavailable
    like any other module.
*/

export const name = 'svg';

export const title = 'our SVG, rasterized by resvg';

export const version = '2.6.2';

export const kind = 'image';

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/** resvg, loaded once, or the reason it could not be */

let resvg = null;

/**
 * The renderer of resvg, imported and initialized on the first fixture, so that
 * a machine without the module builds the sheet without this column
 *
 * @return {Promise<object>}   The module, or what went wrong
 */
async function load() {
  if (resvg) {
    return resvg;
  }

  try {
    const module = await import('@resvg/resvg-wasm');
    const wasm = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..', '..', '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm',
    );

    await module.initWasm(fs.readFileSync(wasm));

    resvg = {Resvg: module.Resvg};
  } catch (error) {
    resvg = {reason: `resvg did not load: ${error.message}`};
  }

  return resvg;
}

/**
 * The SVG of one fixture, rasterized
 *
 * @param  {object}              fixture   The fixture: library, name, input and provenance
 * @param  {object}              target    Where the render goes: directory and the path in the page
 * @return {Promise<Reference>}            The reference
 */
export async function reference(fixture, target) {
  const module = await load();

  if (!module.Resvg) {
    return unavailable(name, version, module.reason);
  }

  const bytes = new Uint8Array(fs.readFileSync(fixture.input));
  const renderer = new ReceiptPrinterRenderer(options(fixture.provenance));

  const document = toSvg(renderer.layout(bytes));
  const paper = stitch(new ReceiptPrinterRenderer(options(fixture.provenance)).render(bytes), {
    width: fixture.provenance.width,
  });

  const file = `${fixture.name}.svg.png`;
  const page = `${fixture.name}.ours.svg`;

  fs.writeFileSync(path.join(target.directory, page), document);
  fs.writeFileSync(
      path.join(target.directory, file),
      new module.Resvg(document, {fitTo: {mode: 'original'}}).render().asPng(),
  );

  const bitmap = await fromPng(new Uint8Array(fs.readFileSync(path.join(target.directory, file))));
  const measure = dotAgreement(paper, bitmap);

  return {
    tool: name,
    title,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    page: path.join(target.prefix, page),
    bitmap,
    note: `${(measure.agreement * 100).toFixed(2)}% of the dots agree`,
    command: `toSvg(renderer.layout(bytes)), rasterized by @resvg/resvg-wasm ${version}`,
  };
}
