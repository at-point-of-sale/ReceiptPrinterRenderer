import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer from '../../../src/receipt-printer-renderer.js';
import {toSvg} from '../../../src/svg.js';
import {toPng} from '../../../src/formats/png.js';
import {stitch} from '../../../src/formats/stitch.js';
import {options} from '../../../test/helpers/external.js';
import {unavailable, fromPng, dotAgreement, crop} from './shared.js';

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

    Since section 24 the column shows the pieces of paper and not the roll: the
    rasterized bitmap is sliced at the rows of the cut entries of the layout,
    one PNG per piece, the way our own render is stitched per run of items. The
    document itself stays one `.ours.svg`, and the whole bitmap is what the dot
    agreement is measured on. The rows line up because the writer's viewBox is
    dots and the document is written in dots, so resvg at `fitTo: original`
    rasterizes one pixel per dot and the height of the raster is the height of
    the layout, which is the height of the stitched paper.

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

  const layout = renderer.layout(bytes);
  const document = toSvg(layout);
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

  /* The pieces of paper: the raster sliced at the rows the layout says the
     paper is cut on, `the paper is cut between row y - 1 and row y`. The raster
     is dot for dot with the layout, but a rasterization of another height is
     read at its own scale rather than sliced at the wrong rows */

  const scale = layout.height ? bitmap.height / layout.height : 1;

  const rows = layout.entries
      .filter((entry) => entry.type === 'cut')
      .map((entry) => Math.max(0, Math.min(bitmap.height, Math.round(entry.y * scale))));

  const bounds = [0, ...rows, bitmap.height];

  const cuts = [];

  for (let index = 0; index + 1 < bounds.length; index++) {
    if (bounds[index + 1] > bounds[index]) {
      cuts.push({y: bounds[index], height: bounds[index + 1] - bounds[index]});
    }
  }

  /* A receipt that is cut is written as one PNG per piece, from the thresholded
     bitmap. A receipt that is not is left as resvg rasterized it, greys and
     all, which is the file the column has always shown */

  const files = [path.join(target.prefix, file)];

  if (cuts.length > 1) {
    for (const [index, piece] of cuts.entries()) {
      const written = index ? `${fixture.name}.svg.${index + 1}.png` : file;

      fs.writeFileSync(
          path.join(target.directory, written),
          await toPng(crop(bitmap, 0, piece.y, bitmap.width, piece.height)),
      );

      files[index] = path.join(target.prefix, written);
    }
  }

  return {
    tool: name,
    title,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    files,
    page: path.join(target.prefix, page),
    bitmap,
    note: `${(measure.agreement * 100).toFixed(2)}% of the dots agree`,
    command: `toSvg(renderer.layout(bytes)), rasterized by @resvg/resvg-wasm ${version}`,
  };
}
