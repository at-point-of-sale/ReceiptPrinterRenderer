import fs from 'node:fs';
import opentype from 'opentype.js';

/*
    Rasterize an outline font into the cells of a fixed cell bitmap font, for
    tools/generate.js.

    The font is monospaced, so it is fitted by its advance width: the advance of
    one character is exactly one cell, 12 dots for font A and 8 for font B, and
    nothing is scaled or squeezed per glyph. A face whose advance is half an em,
    which Iosevka is, therefore lands on an em of 24 dots in the 12 by 24 cell,
    and every glyph keeps the side bearings the designer gave it inside its
    advance, which is what keeps the rhythm of a line even.

    The baseline sits on a fixed row of the cell, row 18 of 24 in font A, and
    the cell is the limit: when the ascender or the descender of the face would
    leave the cell, the whole font is squeezed vertically, never horizontally,
    so that the advance stays exactly one cell wide. A single glyph that is
    taller than the cell, an accented capital, is squeezed vertically by itself
    with its baseline where it is, the way a small bitmap font draws them.

    A dot becomes ink when the outline covers enough of it, measured on a grid
    of samples per dot with a nonzero winding fill, the rule TrueType outlines
    are drawn with. The threshold is below a half on purpose: a stem that covers
    less than half of a dot still burns it, the way the heat of a thermal head
    bleeds into the dots around it.
*/

/* Glyphs that define the ascender and the descender of the face, and the glyph
   the advance width is measured on */

const ASCENDERS = 'Hbdhklt';
const DESCENDERS = 'gjpqy';
const REFERENCE = 'M';
const CAPITAL = 'H';

/* Number of line segments a curve is cut into before it is filled */

const SEGMENTS = 10;

/* A glyph is never squeezed to less than this fraction of the size of the font */

const MINIMUM_SQUEEZE = 0.7;

/**
 * Flatten the commands of an opentype path into closed polygons
 *
 * @param  {object}   path       Path of a glyph, in font units
 * @param  {number}   segments   Number of line segments a curve is cut into
 * @return {Array}               One array of [x, y] points per contour
 */
function flatten(path, segments) {
  const contours = [];

  let contour = null;
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;

  const close = () => {
    if (contour && contour.length > 2) {
      contours.push(contour);
    }

    contour = null;
  };

  for (const command of path.commands) {
    if (command.type === 'M') {
      close();
      contour = [[command.x, command.y]];
      startX = x = command.x;
      startY = y = command.y;
    } else if (command.type === 'L') {
      contour.push([command.x, command.y]);
      x = command.x;
      y = command.y;
    } else if (command.type === 'Q') {
      for (let step = 1; step <= segments; step++) {
        const t = step / segments;
        const u = 1 - t;

        contour.push([
          u * u * x + 2 * u * t * command.x1 + t * t * command.x,
          u * u * y + 2 * u * t * command.y1 + t * t * command.y,
        ]);
      }

      x = command.x;
      y = command.y;
    } else if (command.type === 'C') {
      for (let step = 1; step <= segments; step++) {
        const t = step / segments;
        const u = 1 - t;

        contour.push([
          u * u * u * x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          u * u * u * y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y,
        ]);
      }

      x = command.x;
      y = command.y;
    } else if (command.type === 'Z') {
      if (contour) {
        contour.push([startX, startY]);
      }

      close();
      x = startX;
      y = startY;
    }
  }

  close();

  return contours;
}

/**
 * The bounding box of a set of contours
 *
 * @param  {Array}    contours   Contours as flatten returned them
 * @return {object}              The box, or null when there is no ink
 */
function bounds(contours) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (const contour of contours) {
    for (const [x, y] of contour) {
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    }
  }

  return x1 === Infinity ? null : {x1, y1, x2, y2};
}

/**
 * Fill contours into a cell, with supersampling and a coverage threshold. The
 * fill rule is nonzero winding, the rule TrueType outlines are drawn with.
 *
 * @param  {Array}    contours    Contours in dot coordinates, y down
 * @param  {number}   width       Cell width in dots
 * @param  {number}   height      Cell height in dots
 * @param  {number}   samples     Number of samples per dot on each axis
 * @param  {number}   threshold   Fraction of a dot that has to be covered for it to be ink
 * @return {Uint8Array}           Packed rows of the cell
 */
function fill(contours, width, height, samples, threshold) {
  const rowBytes = Math.ceil(width / 8);
  const cell = new Uint8Array(rowBytes * height);
  const coverage = new Uint16Array(width * height);

  /* Every segment of every contour, closed */

  const edges = [];

  for (const contour of contours) {
    for (let index = 0; index < contour.length; index++) {
      const [x0, y0] = contour[index];
      const [x1, y1] = contour[(index + 1) % contour.length];

      if (y0 !== y1) {
        edges.push([x0, y0, x1, y1]);
      }
    }
  }

  if (edges.length === 0) {
    return cell;
  }

  const crossings = [];

  for (let sample = 0; sample < height * samples; sample++) {
    const y = (sample + 0.5) / samples;
    const row = (sample / samples) | 0;

    crossings.length = 0;

    for (const [x0, y0, x1, y1] of edges) {
      let direction = 0;

      if (y0 <= y && y1 > y) {
        direction = 1;
      } else if (y1 <= y && y0 > y) {
        direction = -1;
      } else {
        continue;
      }

      crossings.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), direction]);
    }

    if (crossings.length < 2) {
      continue;
    }

    crossings.sort((a, b) => a[0] - b[0]);

    let winding = 0;

    for (let index = 0; index < crossings.length - 1; index++) {
      winding += crossings[index][1];

      if (winding === 0) {
        continue;
      }

      /* The samples whose centre falls inside this span */

      const from = Math.max(0, Math.ceil(crossings[index][0] * samples - 0.5));
      const to = Math.min(width * samples - 1, Math.ceil(crossings[index + 1][0] * samples - 0.5) - 1);

      for (let column = from; column <= to; column++) {
        coverage[row * width + ((column / samples) | 0)]++;
      }
    }
  }

  const needed = threshold * samples * samples;

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (coverage[row * width + column] >= needed) {
        cell[row * rowBytes + (column >> 3)] |= 0x80 >> (column & 7);
      }
    }
  }

  return cell;
}

/**
 * An outline font, opened once and measured once, that draws its glyphs into
 * the cells of a bitmap font
 */
class Rasterizer {
  #font;
  #cache = new Map();

  /**
   * Open an outline font
   *
   * @param  {string}   file   Path to a TrueType font
   */
  constructor(file) {
    this.#font = opentype.parse(fs.readFileSync(file).buffer);
  }

  /**
   * The contours of one character, in font units, with the baseline at y = 0
   * and y pointing down
   *
   * @param  {number}   codepoint   Unicode code point
   * @return {Array}                Contours, or null when the font has no glyph
   */
  #contours(codepoint) {
    if (!this.#cache.has(codepoint)) {
      const index = this.#font.charToGlyphIndex(String.fromCodePoint(codepoint));
      const glyph = index ? this.#font.glyphs.get(index) : null;

      this.#cache.set(
          codepoint,
          glyph ? flatten(glyph.getPath(0, 0, this.#font.unitsPerEm), SEGMENTS) : null,
      );
    }

    return this.#cache.get(codepoint);
  }

  /**
   * The largest extent of a set of characters, in font units
   *
   * @param  {string}     characters   The characters to measure
   * @param  {Function}   pick         Takes a bounding box, returns the extent to compare
   * @return {number}                  The largest extent
   */
  #extent(characters, pick) {
    let value = 0;

    for (const character of characters) {
      const box = bounds(this.#contours(character.codePointAt(0)) || []);

      if (box) {
        value = Math.max(value, pick(box));
      }
    }

    return value;
  }

  /**
   * Whether the font has a glyph for a code point
   *
   * @param  {number}    codepoint   Unicode code point
   * @return {boolean}               True when it has one
   */
  has(codepoint) {
    return this.#contours(codepoint) !== null;
  }

  /**
   * How the font is fitted into a cell of this size: the advance of the face
   * is made exactly one cell wide, and the font is squeezed vertically only
   * when its ascender or its descender would leave the cell
   *
   * @param  {object}   cell   Width, height and baseline row of the cell
   * @return {object}          The scale factors and the metrics they produce, in dots
   */
  metrics(cell) {
    const em = this.#font.unitsPerEm;

    const ascender = this.#extent(ASCENDERS, (box) => -box.y1);
    const descender = this.#extent(DESCENDERS, (box) => box.y2);
    const capital = this.#extent(CAPITAL, (box) => -box.y1);

    const advance = this.#font.charToGlyph(REFERENCE).advanceWidth;
    const scaleX = cell.width / advance;

    /* The cell is the limit. A face that does not fit is squeezed vertically,
       which keeps the advance at exactly one cell wide */

    const verticalCap = Math.min(
        1,
        (cell.baseline - 0.2) / (ascender * scaleX),
        (cell.height - cell.baseline - 0.2) / (descender * scaleX),
    );

    const scaleY = scaleX * verticalCap;

    return {
      scaleX,
      scaleY,
      advance,
      unitsPerEm: em,
      size: Number((scaleY * em).toFixed(2)),
      advanceEm: Number((advance / em).toFixed(3)),
      verticalCap: Number(verticalCap.toFixed(3)),
      cap: Number((capital * scaleY).toFixed(2)),
      ascender: Number((ascender * scaleY).toFixed(2)),
      descender: Number((descender * scaleY).toFixed(2)),
    };
  }

  /**
   * Draw one code point into a cell
   *
   * @param  {number}   codepoint   Unicode code point
   * @param  {object}   cell        Width, height and baseline row of the cell
   * @param  {object}   metrics     The fit of the font in that cell, from metrics()
   * @param  {object}   options     Threshold, samples, and whether a glyph that is taller
   *                                than the cell is squeezed or clipped
   * @return {Uint8Array}           Packed rows of the cell, or null when the font has no glyph
   */
  glyph(codepoint, cell, metrics, options) {
    const {threshold, samples, squeeze = true} = options;
    const contours = this.#contours(codepoint);

    if (!contours) {
      return null;
    }

    const rowBytes = Math.ceil(cell.width / 8);
    const box = bounds(contours);

    /* A glyph without ink, a space */

    if (!box) {
      return new Uint8Array(rowBytes * cell.height);
    }

    /*
       A glyph that is taller than the cell, an accented capital for example, is
       squeezed vertically with its baseline where it is, which is what a small
       bitmap font does with them. A glyph that is drawn for a cell of another
       shape, a box drawing character of a face that draws them for a terminal
       line, is clipped by the cell instead: it keeps the scale of the font, so
       that every one of them puts its lines on the same dots.
    */

    let scaleY = metrics.scaleY;

    if (squeeze) {
      if (cell.baseline + box.y1 * scaleY < 0) {
        scaleY = Math.min(scaleY, cell.baseline / -box.y1);
      }

      if (cell.baseline + box.y2 * scaleY > cell.height) {
        scaleY = Math.min(scaleY, (cell.height - cell.baseline) / box.y2);
      }

      scaleY = Math.max(scaleY, metrics.scaleY * MINIMUM_SQUEEZE);
    }

    /* The glyph keeps the side bearings the designer gave it inside its
       advance, and the advance is the cell */

    const offsetX = (cell.width - metrics.advance * metrics.scaleX) / 2;

    const placed = contours.map((contour) => contour.map(([x, y]) => [
      x * metrics.scaleX + offsetX,
      y * scaleY + cell.baseline,
    ]));

    return fill(placed, cell.width, cell.height, samples, threshold);
  }
}

export default Rasterizer;
