/*
    Turn a 1-bit bitmap into SVG path data, for the glyphs a stream downloads,
    which the SVG writer traces with it, and for a box drawing character in a
    cell the box set of data/fonts/outlines.js has no entry for. The box set
    itself is geometry, written by ReceiptPrinterFontEditor from the rule that
    draws the range; the editor keeps a copy of this for the fallback glyph and
    for a code point of the range its rule has no drawing for.

    A dot could be a rectangle of its own, but a box drawing glyph is a handful
    of bars and a downloaded glyph is a drawing, so the runs of black dots are
    merged: the dots of a row become runs, a run becomes a rectangle, and a
    rectangle grows downwards for as long as the row below it has exactly the
    same run. That is a row by row merge, not the smallest set of rectangles a
    bitmap can be covered with, which is a harder problem and worth nothing
    here: a horizontal bar of a box drawing glyph comes out as one rectangle
    either way.

    The rectangles are in whole dots, in the frame of the bitmap, y down, and
    every one of them is a closed subpath of `M x y h w v h h -w Z`, which fills
    the same under either fill rule because the rectangles never overlap.
*/

/**
 * @typedef {import('../types.js').Bitmap} Bitmap
 */

/**
 * The rectangles a bitmap merges into, row by row
 *
 * @param  {Bitmap}   bitmap   A 1-bit bitmap, 1 is ink
 * @return {Array}             Rectangles as {x, y, width, height}, in the order they start
 */
export function rectangles(bitmap) {
  const rowBytes = (bitmap.width + 7) >> 3;
  const result = [];

  /* The rectangles that are still growing, by the run they were opened with */

  let open = new Map();

  for (let y = 0; y < bitmap.height; y++) {
    const next = new Map();

    let start = -1;

    /* One column beyond the width, so that a run that reaches the right edge
       of the bitmap is closed by the same code as any other */

    for (let x = 0; x <= bitmap.width; x++) {
      const ink = x < bitmap.width &&
        (bitmap.data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

      if (ink) {
        if (start < 0) {
          start = x;
        }

        continue;
      }

      if (start < 0) {
        continue;
      }

      const key = `${start}:${x}`;
      const grown = open.get(key);

      if (grown) {
        grown.height++;
        next.set(key, grown);
      } else {
        const rectangle = {x: start, y, width: x - start, height: 1};

        result.push(rectangle);
        next.set(key, rectangle);
      }

      start = -1;
    }

    open = next;
  }

  return result;
}

/**
 * Trace a bitmap into SVG path data of merged rectangles, in whole dots or in
 * a fraction of a dot when the path shares its units with another one
 *
 * @param  {Bitmap}   bitmap    A 1-bit bitmap, 1 is ink
 * @param  {number}   [units]   Path units per dot, one by default
 * @return {string}             SVG path data, empty when the bitmap has no ink
 */
export function trace(bitmap, units = 1) {
  let output = '';

  for (const rectangle of rectangles(bitmap)) {
    const width = rectangle.width * units;

    output += `M${rectangle.x * units} ${rectangle.y * units}` +
      `h${width}v${rectangle.height * units}h-${width}Z`;
  }

  return output;
}

export default trace;
