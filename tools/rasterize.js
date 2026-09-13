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

    There is one exception, and one only: a glyph whose own advance is wider
    than the advance the face is fitted by, a full width Japanese glyph in a
    face whose Latin is half an em, is fitted by its own advance instead of by
    that of the face, so that it fills the cell instead of hanging out of it to
    the right. See contours().

    A dot becomes ink when the outline covers enough of it, measured on a grid
    of samples per dot with a nonzero winding fill, the rule TrueType outlines
    are drawn with. The threshold is below a half on purpose: a stem that covers
    less than half of a dot still burns it, the way the heat of a thermal head
    bleeds into the dots around it.

    The placement of a glyph in its cell happens once, in contours(), and both
    things that are made of a glyph come out of that one set of placed contours:
    the bitmap, by flattening the curves and filling them, and the outline of
    generated/outlines.js, by writing the same contours out as path data with
    their curves intact. The fill is the only thing the two do differently.
*/

/* Glyphs that define the ascender and the descender of the face, and the glyph
   the advance width is measured on */

const ASCENDERS = 'Hbdhklt';
const DESCENDERS = 'gjpqy';
const REFERENCE = 'M';
const CAPITAL = 'H';

/*
    Every character metrics() measures the face on. A source font is fitted by
    its own metrics, so a subset of a source has to keep these whether or not
    the source contributes them to the font: a subset without them has no
    advance width to be fitted by. tools/subset-font.js keeps them.
*/

export const METRIC_CHARACTERS = [...new Set(ASCENDERS + DESCENDERS + REFERENCE + CAPITAL)].join('');

/* Number of line segments a curve is cut into before it is filled */

export const SEGMENTS = 10;

/*
    The fraction of a dot the outline has to cover for the dot to be ink. This
    is the value for Iosevka Medium at these sizes: well under a half, which is
    dot gain, the way the heat of a thermal head bleeds into the dots around a
    stem. A higher value thins the face until the light strokes of a `%` break,
    a lower one closes the counters of `a` and `e`. It lives here, with the fill
    it belongs to, so that tools/generate.js and the test that fills the
    outlines again cannot drift apart on it.
*/

export const INK_THRESHOLD = 0.45;

/* Samples per dot on each axis when the coverage of a dot is measured */

export const SAMPLES = 8;

/* A glyph is never squeezed to less than this fraction of the size of the font */

const MINIMUM_SQUEEZE = 0.7;

/**
 * Split the commands of an opentype path into contours, keeping the curves.
 *
 * A contour is an array of commands, `{type: 'M', x, y}`, `{type: 'L', x, y}`,
 * `{type: 'Q', x1, y1, x, y}`, `{type: 'C', x1, y1, x2, y2, x, y}` and
 * `{type: 'Z'}`, in the coordinates of the path. A contour that flattens to
 * fewer than three points carries no ink and is dropped here, so that every
 * consumer of the contours sees the same set.
 *
 * @param  {object}   path       Path of a glyph
 * @param  {number}   segments   Number of line segments a curve is cut into
 * @return {Array}               One array of commands per contour
 */
function contoursOf(path, segments) {
  const contours = [];

  let contour = null;
  let points = 0;

  const close = () => {
    if (contour && points > 2) {
      contours.push(contour);
    }

    contour = null;
    points = 0;
  };

  for (const command of path.commands) {
    if (command.type === 'M') {
      close();

      contour = [{type: 'M', x: command.x, y: command.y}];
      points = 1;

      continue;
    }

    if (!contour) {
      continue;
    }

    if (command.type === 'L') {
      contour.push({type: 'L', x: command.x, y: command.y});
      points += 1;
    } else if (command.type === 'Q') {
      contour.push({type: 'Q', x1: command.x1, y1: command.y1, x: command.x, y: command.y});
      points += segments;
    } else if (command.type === 'C') {
      contour.push({
        type: 'C',
        x1: command.x1, y1: command.y1,
        x2: command.x2, y2: command.y2,
        x: command.x, y: command.y,
      });
      points += segments;
    } else if (command.type === 'Z') {
      contour.push({type: 'Z'});
      points += 1;

      close();
    }
  }

  close();

  return contours;
}

/**
 * Move contours into a cell: every coordinate is scaled and translated, the
 * control points of the curves with the rest, so that the shape of a curve is
 * the shape it had in the font
 *
 * @param  {Array}    contours   Contours as contoursOf returned them
 * @param  {number}   scaleX     Horizontal scale
 * @param  {number}   scaleY     Vertical scale
 * @param  {number}   offsetX    Horizontal offset, applied after the scale
 * @param  {number}   offsetY    Vertical offset, applied after the scale
 * @return {Array}               The placed contours
 */
function place(contours, scaleX, scaleY, offsetX, offsetY) {
  const x = (value) => value * scaleX + offsetX;
  const y = (value) => value * scaleY + offsetY;

  return contours.map((contour) => contour.map((command) => {
    if (command.type === 'Z') {
      return command;
    }

    if (command.type === 'Q') {
      return {type: 'Q', x1: x(command.x1), y1: y(command.y1), x: x(command.x), y: y(command.y)};
    }

    if (command.type === 'C') {
      return {
        type: 'C',
        x1: x(command.x1), y1: y(command.y1),
        x2: x(command.x2), y2: y(command.y2),
        x: x(command.x), y: y(command.y),
      };
    }

    return {type: command.type, x: x(command.x), y: y(command.y)};
  }));
}

/**
 * Flatten contours into closed polygons, cutting every curve into line segments
 *
 * @param  {Array}    contours   Contours as contoursOf or place returned them
 * @param  {number}   segments   Number of line segments a curve is cut into
 * @return {Array}               One array of [x, y] points per contour
 */
export function flatten(contours, segments) {
  const polygons = [];

  for (const contour of contours) {
    const polygon = [];

    let startX = 0;
    let startY = 0;
    let x = 0;
    let y = 0;

    for (const command of contour) {
      if (command.type === 'M') {
        polygon.push([command.x, command.y]);
        startX = x = command.x;
        startY = y = command.y;
      } else if (command.type === 'L') {
        polygon.push([command.x, command.y]);
        x = command.x;
        y = command.y;
      } else if (command.type === 'Q') {
        for (let step = 1; step <= segments; step++) {
          const t = step / segments;
          const u = 1 - t;

          polygon.push([
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

          polygon.push([
            u * u * u * x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
            u * u * u * y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y,
          ]);
        }

        x = command.x;
        y = command.y;
      } else if (command.type === 'Z') {
        polygon.push([startX, startY]);
        x = startX;
        y = startY;
      }
    }

    polygons.push(polygon);
  }

  return polygons;
}

/**
 * The bounding box of a set of polygons
 *
 * @param  {Array}    polygons   Polygons as flatten returned them
 * @return {object}              The box, or null when there is no ink
 */
function bounds(polygons) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y] of polygon) {
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    }
  }

  return x1 === Infinity ? null : {x1, y1, x2, y2};
}

/**
 * Fill polygons into a cell, with supersampling and a coverage threshold. The
 * fill rule is nonzero winding, the rule TrueType outlines are drawn with.
 *
 * @param  {Array}    polygons    Polygons in dot coordinates, y down
 * @param  {number}   width       Cell width in dots
 * @param  {number}   height      Cell height in dots
 * @param  {number}   samples     Number of samples per dot on each axis
 * @param  {number}   threshold   Fraction of a dot that has to be covered for it to be ink
 * @return {Uint8Array}           Packed rows of the cell
 */
export function fill(polygons, width, height, samples, threshold) {
  const rowBytes = Math.ceil(width / 8);
  const cell = new Uint8Array(rowBytes * height);
  const coverage = new Uint16Array(width * height);

  /* Every segment of every polygon, closed */

  const edges = [];

  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index++) {
      const [x0, y0] = polygon[index];
      const [x1, y1] = polygon[(index + 1) % polygon.length];

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

/*
    A cubic curve whose control points sit two thirds of the way to one point is
    a quadratic curve written out as a cubic, which is what a face of quadratic
    curves comes back as when it has been through a CFF table, the format
    opentype.js writes. The path writer below turns those back into quadratic
    curves, which are two numbers shorter each. The two thirds are rounded to
    whole font units on the way in, so the two ends of a curve disagree about
    where the control point was; they have to agree to within this, in dots, and
    the curve then takes the point between them, which is off by at most half of
    it and bends the curve by less than that again. A curve whose ends disagree
    by more than this is a curve that is really cubic, and it is written out as
    one.
*/

const QUADRATIC_TOLERANCE = 0.1;

/**
 * Write contours out as SVG path data, with the curves of the face intact.
 *
 * Coordinates are rounded to whole units, so a value of 10 units per dot keeps
 * a tenth of a dot. Every contour is closed with a Z, which is what the fill
 * does with it anyway, the command letter is left out when it repeats, and a
 * separator only stands where two numbers would otherwise run together. A
 * segment that ends where it started once the coordinates are rounded, which a
 * face has a few of per glyph, is left out: it is nothing to a fill and it is
 * the same nothing to this path.
 *
 * @param  {Array}    contours   Contours as place returned them, in dots
 * @param  {number}   units      Path units per dot
 * @return {string}              SVG path data
 */
export function pathData(contours, units) {
  const round = (value) => Math.round(value * units);

  let output = '';
  let previous = '';
  let current = null;

  const number = (value) => {
    const text = String(value);

    if (text.charCodeAt(0) !== 0x2d && /\d$/.test(output)) {
      output += ' ';
    }

    output += text;
  };

  const letter = (type) => {
    if (type !== previous) {
      output += type;
      previous = type;
    }
  };

  const write = (type, coordinates) => {
    const x = coordinates[coordinates.length - 2];
    const y = coordinates[coordinates.length - 1];

    if (type !== 'M' && current && coordinates.every((value, index) => value === current[index % 2])) {
      return;
    }

    letter(type);
    coordinates.forEach(number);

    current = [x, y];
  };

  for (const contour of contours) {
    const commands = contour.filter((command) => command.type !== 'Z');

    const start = commands[0];
    const last = commands[commands.length - 1];

    /* The last command of a contour that lands on its first point is the
       closing line, and the Z draws that line itself */

    const closing = last !== start && last.type === 'L' &&
      round(last.x) === round(start.x) && round(last.y) === round(start.y);

    /* Where the pen is, in dots, which is what a curve is measured against */

    let from = [start.x, start.y];

    for (const command of commands) {
      if (closing && command === last) {
        continue;
      }

      if (command.type === 'Q') {
        write('Q', [round(command.x1), round(command.y1), round(command.x), round(command.y)]);
      } else if (command.type === 'C') {
        /* The control point the quadratic curve would have, seen from each of
           the two ends of this curve */

        const first = [
          from[0] + 1.5 * (command.x1 - from[0]),
          from[1] + 1.5 * (command.y1 - from[1]),
        ];

        const second = [
          command.x + 1.5 * (command.x2 - command.x),
          command.y + 1.5 * (command.y2 - command.y),
        ];

        if (Math.abs(first[0] - second[0]) <= QUADRATIC_TOLERANCE &&
            Math.abs(first[1] - second[1]) <= QUADRATIC_TOLERANCE) {
          write('Q', [
            round((first[0] + second[0]) / 2), round((first[1] + second[1]) / 2),
            round(command.x), round(command.y),
          ]);
        } else {
          write('C', [
            round(command.x1), round(command.y1),
            round(command.x2), round(command.y2),
            round(command.x), round(command.y),
          ]);
        }
      } else {
        write(command.type, [round(command.x), round(command.y)]);
      }

      from = [command.x, command.y];
    }

    output += 'Z';
    previous = '';
    current = null;
  }

  return output;
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
   * The contours, the flattened polygons and the advance width of one
   * character, in font units, with the baseline at y = 0 and y pointing down
   *
   * @param  {number}   codepoint   Unicode code point
   * @return {object}               Contours, polygons and advance, or null when the font has no glyph
   */
  #outline(codepoint) {
    if (!this.#cache.has(codepoint)) {
      const index = this.#font.charToGlyphIndex(String.fromCodePoint(codepoint));
      const glyph = index ? this.#font.glyphs.get(index) : null;
      const contours = glyph ? contoursOf(glyph.getPath(0, 0, this.#font.unitsPerEm), SEGMENTS) : null;

      this.#cache.set(codepoint, contours ?
        {contours, polygons: flatten(contours, SEGMENTS), advance: glyph.advanceWidth} :
        null);
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
      const outline = this.#outline(character.codePointAt(0));
      const box = bounds(outline ? outline.polygons : []);

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
    return this.#outline(codepoint) !== null;
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
   * The contours of one code point as they sit in a cell: the fitting rule of
   * the font, the per glyph vertical squeeze and the baseline of the cell are
   * all in them, so they are the glyph, in dots, y down, and whatever is made
   * of the glyph is made of these
   *
   * @param  {number}   codepoint   Unicode code point
   * @param  {object}   cell        Width, height and baseline row of the cell
   * @param  {object}   metrics     The fit of the font in that cell, from metrics()
   * @param  {object}   options     Whether a glyph that is taller than the cell is squeezed or clipped
   * @return {Array}                The placed contours, empty for a glyph without ink,
   *                                or null when the font has no glyph
   */
  contours(codepoint, cell, metrics, options) {
    const {squeeze = true} = options || {};
    const outline = this.#outline(codepoint);

    if (!outline) {
      return null;
    }

    const box = bounds(outline.polygons);

    /* A glyph without ink, a space */

    if (!box) {
      return [];
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

    /*
       The glyph keeps the side bearings the designer gave it inside its
       advance, and the advance is the cell.

       The one exception to "nothing is scaled horizontally" is the advance the
       cell is divided by: a glyph whose own advance is wider than the advance
       the face is fitted by is fitted by its own. Without it such a glyph is
       drawn at the scale of the face, and since the advance of the face is
       exactly the cell the offset below is zero, so it starts at the left edge
       of the cell, runs past the right edge and is clipped there: the cell
       holds its left half and the rest is thrown away.

       It is made for the twelve kanji of the katakana codepage,
       円 年 月 日 時 分 秒 市 区 町 村 人, and the postal mark, which a Japanese face
       draws on a full em while the face is fitted by the half em of its Latin,
       and which a printer draws in the same cell as the rest. It catches every
       glyph a face draws on a full em, which in Iosevka is the em dash, the
       ellipsis, the arrows, the geometric shapes and the smileys of the tail
       of cp437, 34 of them: those held their left half before, so that an
       arrow printed as its stem with no head and an ellipsis as a dot and a
       half.

       The comparison is on the advance widths in whole font units, so that a
       glyph of exactly the advance of the face is never touched by it, and the
       offset is the one formula for both: it is zero whenever a glyph is
       fitted by its own advance, which both of these are.
    */

    const advance = Math.max(metrics.advance, outline.advance);

    const scaleX = cell.width / advance;
    const offsetX = (cell.width - advance * scaleX) / 2;

    return place(outline.contours, scaleX, scaleY, offsetX, cell.baseline);
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
    const {threshold, samples} = options;
    const contours = this.contours(codepoint, cell, metrics, options);

    if (!contours) {
      return null;
    }

    return fill(flatten(contours, SEGMENTS), cell.width, cell.height, samples, threshold);
  }
}

export default Rasterizer;
