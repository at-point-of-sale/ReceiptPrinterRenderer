import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer, {pieces} from '../../../src/receipt-printer-renderer.js';
import {toSvg} from '../../../src/svg.js';
import {stitch} from '../../../src/formats/stitch.js';
import {options} from '../../../test/helpers/external.js';
import {unavailable, fromPng, dotAgreement} from './shared.js';

/*
    Our own SVG as a column of the sheet, section 4 of the SVG plan.

    This module is not a reference renderer either. The others run another
    project's renderer over the bytes of a fixture; this one runs ours twice,
    once into dots and once into an SVG document, and puts the document itself
    on the page, so that the vector output is looked at as what it is: the
    browser draws it at whatever size the column has, and a zoom of the page
    zooms the outlines and not the pixels of a raster. What the column shows is
    whether the vector output is the receipt the bitmap output is: the text is
    the outlines of the same face the bitmaps were filled from, which differ at
    the edges of a stroke, and the rectangles and the images are the same dots.

    The figure carries the dot for dot agreement of the two, the measure of
    shared.js, which is the number test/svg.js asserts a bound of for the golden
    fixtures. For that number, and for the coarse agreement table of the page,
    the document is rasterized by resvg at one pixel per dot, which is the size
    the writer's viewBox is in, and thresholded at half. That raster is written
    next to the document as `.svg.png`, so what the number was measured on can
    be looked at, but the page does not show it: a raster at one pixel per dot
    is a bitmap again, and the column was made to show the vector output.

    Since section 24 the column shows the pieces of paper and not the roll,
    the way our own render is stitched per run of items: the list is split at
    its cuts with `pieces()` of the main entry and every piece is written as a
    document of its own, `.ours.svg` for the first and `.ours.N.svg` for the
    rest, which the page stacks with the gap that reads as the cut. The whole
    list is what the agreement is measured on, and the raster of it is written
    without a cut marker, so a dashed line the bitmap output does not have is
    not counted against it.

    resvg, @resvg/resvg-wasm, is a dev dependency of the tests, so this column
    needs no tool of its own; a checkout without it reports itself unavailable
    like any other module.
*/

export const name = 'svg';

export const title = 'our SVG, measured by resvg';

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
 * The SVG of one fixture, and how far it agrees with the bitmap of the same bytes
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

  const layout = renderer.layout(bytes);
  const paper = stitch(new ReceiptPrinterRenderer(options(fixture.provenance)).render(bytes), {
    width: fixture.provenance.width,
  });

  /* One document per piece of paper for the page, and one raster of the whole
     list for the agreement */

  const files = [];

  for (const [index, piece] of pieces(layout).entries()) {
    const written = index ? `${fixture.name}.ours.${index + 1}.svg` : `${fixture.name}.ours.svg`;

    fs.writeFileSync(path.join(target.directory, written), toSvg(piece));
    files.push(path.join(target.prefix, written));
  }

  const file = `${fixture.name}.svg.png`;
  const png = new module.Resvg(toSvg(layout), {fitTo: {mode: 'original'}}).render().asPng();

  fs.writeFileSync(path.join(target.directory, file), png);

  const bitmap = await fromPng(new Uint8Array(png));
  const measure = dotAgreement(paper, bitmap);

  return {
    tool: name,
    title,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: files[0],
    files,
    raster: path.join(target.prefix, file),
    bitmap,
    note: `${(measure.agreement * 100).toFixed(2)}% of the dots agree`,
    command: `toSvg(renderer.layout(bytes)), measured against the bitmap by @resvg/resvg-wasm ${version} ` +
      'at one pixel per dot',
  };
}
