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

    The rule of the face: the first source is the face, the others are fitted
    to it.

    tools/generate.js reads a list of source fonts and a glyph comes from the
    first of them that has it. Only the first is measured, by metrics(): it is
    the face, and its advance, its ascender and its descender decide the scale
    everything else is drawn at. Every source behind it is not measured at all;
    it is fitted to that scale by inherit(), which takes the scale of the face
    and nothing of its own but the size of its em. A source at the em of the
    face is drawn at exactly the face's scaleX and scaleY, and a source at
    another em at those times the ratio of the two, so that an em of either
    font covers the same number of dots. Sarasa, whose em and whose reference
    advance are Iosevka's, therefore inherits the very numbers it used to
    measure for itself, to the last bit.

    That is what lets a source hold a script and no Latin, and the reason it
    has to is Noto. Google publishes Noto Sans Hebrew and Noto Sans Thai as the
    script alone, 151 and 140 glyphs with no `M` anywhere to measure, and the
    builds that do carry a Latin carry Noto's proportional one, whose `M` is
    902 units in the Hebrew and 918 in the Thai where Iosevka's is 500.
    Measuring such a source on its own would divide the cell by that advance
    and draw the script at a cap height of 9.5 dots beside a Latin of 17.6:
    correct by the letter of the old rule and wrong on the paper. Fitted to the
    face instead, the Hebrew and the Thai come out 13 to 14 dots tall, between
    the x height of the Latin and its cap height, which is where a receipt
    wants them. So METRIC_CHARACTERS are asked of the first source alone.

    Three more rules belong to the cell rather than to any one source, and all
    three hold for every source, the face included. All three are in
    contours().

    A glyph whose advance is zero, a combining mark, is centred in the cell by
    its ink. There is no advance to centre it in, and its ink is drawn where it
    sits over the letter it belongs to, which for a Thai mark is a third of an
    em to the left of the origin and for Iosevka's combining accents is wholly
    to the left of it: placed by the advance, such a glyph hangs out of the
    cell and prints as its right half or as nothing at all. The ink is centred
    on a dot and not on the middle of the cell, see the phase in contours().

    A glyph whose ink lies outside its own advance, on either side, is fitted
    by its ink: the cell is divided by the widest of the advance of the face,
    the advance of the glyph and the width of the ink, and the ink is pushed
    right by whatever of it lies left of the origin. The wide glyph rule
    measures advances and this one measures ink, so it catches what that one
    cannot: U+0E33, the Thai sara am, has an advance narrower than the face's
    and ink that runs two thirds of an em to the left of its origin, because
    the nikhahit half of it is drawn over the consonant in front of it, and a
    printer that gives it a cell of its own showed the right half alone.

    A Unicode format character, U+200B to U+200F, U+2028 to U+202E, U+2060 to
    U+2064 and U+FEFF, is an empty cell, whatever outline a source draws for
    it, and an empty cell even when no source has a glyph at all. It is an
    instruction to whatever lays out the text and never a character on the
    paper, and a printer that gives one cell to every code point has nothing to
    print for it. The fonts do not agree and neither of the two ways they
    disagree is printable here: Noto Sans Hebrew draws a full height marker for
    the bidi marks, and Iosevka draws the two joiners as a shape that straddles
    its origin, which the centring above would turn into exactly such a marker.
    tools/subset-font.js leaves them out of every subset it writes, this draws
    the empty cell for one that reaches it anyway, and tools/generate.js draws
    it for one that reaches no rasterizer at all, so that a format character is
    never the fallback box either.

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
    Every character metrics() measures a face on.

    The first source of tools/generate.js has to have all of them: it is the
    face, its advance width is what the cell is divided by and its ascender and
    its descender are what the squeeze is measured against, and a face without
    them would be fitted to .notdef, silently and wrongly. A source behind it
    needs none of them, because it is not measured: it is fitted to the face by
    inherit(), see the rule of the face above. tools/subset-font.js keeps these
    characters in a subset when the source has them, asks for none when it has
    not, and refuses a first source that lacks one.
*/

export const METRIC_CHARACTERS = [...new Set(ASCENDERS + DESCENDERS + REFERENCE + CAPITAL)].join('');

/*
    The Unicode format characters: the general category Cf of the code points a
    printer can be asked for, which is the zero width space and the bidi and
    joining controls of U+200B to U+200F, the line and paragraph separators and
    the bidi embedding controls of U+2028 to U+202E, the word joiner and the
    invisible operators of U+2060 to U+2064, and the byte order mark U+FEFF.

    Every source draws every one of them as an empty cell, see the rule of the
    face above and the place it is applied in contours(). The list is the whole
    of the category rather than the four code points of the set, because a
    source of a script nobody has added yet may have any of them.
*/

const FORMAT = [[0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]];

/**
 * Whether a code point is a Unicode format character, which every source draws
 * as an empty cell
 *
 * @param  {number}    codepoint   Unicode code point
 * @return {boolean}               True when it is one
 */
export function isFormat(codepoint) {
  return FORMAT.some(([first, last]) => codepoint >= first && codepoint <= last);
}

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
   * The size of the em of this font, in font units
   *
   * @return {number}   Units per em
   */
  get unitsPerEm() {
    return this.#font.unitsPerEm;
  }

  /**
   * How the font is fitted into a cell of this size: the advance of the face
   * is made exactly one cell wide, and the font is squeezed vertically only
   * when its ascender or its descender would leave the cell.
   *
   * This measures a face, and tools/generate.js measures its first source
   * alone: the sources behind it are fitted to what comes out of here by
   * inherit(), see the rule of the face at the top of this file.
   *
   * @param  {object}   cell   Width, height and baseline row of the cell
   * @return {object}          The scale factors and the metrics they produce, in dots
   */
  metrics(cell) {
    const em = this.#font.unitsPerEm;

    const ascender = this.#extent(ASCENDERS, (box) => -box.y1);
    const descender = this.#extent(DESCENDERS, (box) => box.y2);
    const capital = this.#extent(CAPITAL, (box) => -box.y1);

    /* opentype.js answers a font without a character with .notdef, whose
       advance and whose outline are numbers of that font and not of the face,
       so a face that cannot be measured is refused here rather than fitted to
       .notdef quietly. All thirteen are asked for, not the reference alone:
       the ascender and the descender decide the squeeze the way the advance
       decides the scale, and a face missing a `y` is as unmeasurable as one
       missing an `M`, only less obviously so */

    const missing = [...METRIC_CHARACTERS].filter(
        (character) => !this.#font.charToGlyphIndex(character));

    if (missing.length) {
      throw new Error(
          `The face has no glyph for ${missing.map((character) => `'${character}'`).join(' ')}, ` +
          'which the fitting rule measures a face on',
      );
    }

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
      inherited: false,
      size: Number((scaleY * em).toFixed(2)),
      advanceEm: Number((advance / em).toFixed(3)),
      verticalCap: Number(verticalCap.toFixed(3)),
      cap: Number((capital * scaleY).toFixed(2)),
      ascender: Number((ascender * scaleY).toFixed(2)),
      descender: Number((descender * scaleY).toFixed(2)),
    };
  }

  /**
   * How a source behind the first one is fitted into the same cell: at the
   * scale of the face, whatever its own advance and its own ascender are.
   *
   * The first source is the face and is measured by metrics(). A later source
   * is never measured. It is drawn at the face's scale, corrected for the size
   * of its em alone, so that an em of either font covers the same number of
   * dots: at the same em, which Iosevka and all three sources behind it are,
   * the scale factors are the face's own numbers bit for bit, and at another
   * em they are those times the ratio of the two.
   *
   * The advance that comes out is the reference advance of the face written in
   * the units of this source. That is the number contours() divides the cell
   * by, so dividing by it gives back the inherited scale, and it is also the
   * width the wide glyph rule compares a glyph with: a letter this source
   * draws wider than the face's advance is fitted into the cell by its own
   * advance, the way a full width kanji is.
   *
   * The cap height, the ascender and the descender that come out are this
   * source's own, measured on its own glyphs at the inherited scale, and they
   * are zero for a source that has none of the characters they are measured
   * on, which a source without a Latin has not. They are reported, never used:
   * the fit is the face's.
   *
   * @param  {object}   face   The fit of the first source in that cell, from metrics()
   * @return {object}          The fit of this source in the same cell
   */
  inherit(face) {
    if (!face || typeof face !== 'object' || !(face.scaleX > 0) || !(face.scaleY > 0) ||
        !(face.advance > 0) || !(face.unitsPerEm > 0)) {
      throw new Error('A source is fitted to the metrics of the face, which are the metrics of the first source');
    }

    /* Through the getter rather than the table, so that the guard below is
       reachable without a font whose head table says its em holds no units */

    const em = this.unitsPerEm;

    if (!(em > 0)) {
      throw new Error('The font does not say how many units its em holds, so it cannot be fitted to the face');
    }

    /* The ratio of the two ems. One font unit of this source is worth this
       many font units of the face, so the scale of the face times the ratio is
       the scale that puts the two ems on the same number of dots. It is
       exactly 1 for a source at the em of the face, which leaves the scale
       factors of the face untouched to the last bit */

    const ratio = face.unitsPerEm / em;

    const scaleX = face.scaleX * ratio;
    const scaleY = face.scaleY * ratio;

    /* And the reference advance of the face in the units of this source, which
       is the same distance on the paper: cell.width / advance is scaleX again */

    const advance = face.advance / ratio;

    const ascender = this.#extent(ASCENDERS, (box) => -box.y1);
    const descender = this.#extent(DESCENDERS, (box) => box.y2);
    const capital = this.#extent(CAPITAL, (box) => -box.y1);

    return {
      scaleX,
      scaleY,
      advance,
      unitsPerEm: em,
      inherited: true,
      size: Number((scaleY * em).toFixed(2)),
      advanceEm: Number((advance / em).toFixed(3)),
      verticalCap: face.verticalCap,
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
   * @param  {object}   metrics     The fit of the font in that cell, from metrics() or inherit()
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

    /* A format character is an instruction and not a character: every source
       draws it as an empty cell whatever its outline says, see isFormat() and
       the rule of the face at the top of this file */

    if (isFormat(codepoint)) {
      return [];
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

       For a source behind the first one the advance of the face is the
       inherited one, the face's own advance written in the units of that
       source, so the rule reads the same and catches the same thing one script
       further along: the Hebrew and the Thai of the Noto subsets are drawn on
       anything from a fifth of an em to nine tenths of one where the face is
       fitted by half an em, so most of their letters are wider than the cell
       and are fitted into it here.

       A glyph whose advance is zero is the other kind of glyph a script
       brings, a combining mark: the sixteen niqqud of Hebrew, the sixteen
       vowel and tone marks of Thai, and the five combining accents of Iosevka,
       which a printer draws in a cell of their own on paper. There is no
       advance to centre such a glyph in, and its ink is drawn where it sits
       over the letter it belongs to, which for a Thai mark is a third of an em
       to the left of the origin and for an Iosevka accent is wholly to the
       left of it: centred by its advance it hangs over the left edge of the
       cell and prints as its right half, or as nothing at all, which is what
       the five accents did. So the width such a glyph occupies is the width of
       its ink, the cell is divided by the larger of that and the advance of
       the face exactly as above, and the ink is centred in the cell instead of
       the advance.
    */

    /*
       And the fourth rule, for a glyph whose ink is not where its advance says
       it is. A glyph of an advance of its own is placed by that advance and
       the cell shows what falls inside it, which is right for a face that
       draws inside its own advance and wrong for one that does not: U+0E33,
       the Thai sara am, has an advance of 415 units and ink from -279 to 337,
       because the nikhahit half of it is drawn over the consonant in front of
       it. Its advance is narrower than the face's, so the wide glyph rule does
       not fire, and its advance is not zero, so the centring does not either,
       and the nikhahit fell off the left edge of the cell in both fonts.

       So a glyph whose ink lies outside its own advance, on either side, is
       fitted by its ink: the cell is divided by the widest of the three, the
       advance of the face, the advance of the glyph and the width of the ink,
       and the ink is pushed right by whatever of it lies left of the origin.
       A glyph that overhangs by nothing is untouched by it, which is every
       glyph of Iosevka and of Sarasa; U+0E44 overhangs by nine units, a fifth
       of a dot, and the widest of the three is still the face's advance, so it
       lands where it landed.
    */

    const centred = outline.advance === 0;
    const ink = box.x2 - box.x1;

    const overhangs = !centred && (box.x1 < 0 || box.x2 > outline.advance);

    const advance = centred ?
      Math.max(metrics.advance, ink) :
      Math.max(metrics.advance, outline.advance, overhangs ? ink : 0);

    const scaleX = cell.width / advance;

    /*
       The phase of the centring. The ink is centred on a dot, not on the
       middle of the cell: in a cell of an even number of dots the middle is
       the boundary between two of them, and a mark that is narrower than a dot
       put across a boundary covers a quarter of each and burns neither. Seven
       of the sixteen niqqud of Hebrew are under a dot wide in the 8 by 16 cell
       of font B, five of them 0.94 dots, one 0.96 and one 0.69, and eight of
       the sixteen print an empty cell there when the phase is the middle of
       the cell.

       A mark whose ink is wider than the cell has already been fitted to it by
       the advance above and fills it exactly, so there is no phase to choose
       and the ink starts at the left edge; that is the same number the plain
       centring gives it.
    */

    const width = ink * scaleX;

    const offsetX = centred ?
      (width >= cell.width ? 0 : Math.floor(cell.width / 2) + 0.5 - width / 2) - box.x1 * scaleX :
      overhangs ?
        -Math.min(0, box.x1) * scaleX :
        (cell.width - advance * scaleX) / 2;

    return place(outline.contours, scaleX, scaleY, offsetX, cell.baseline);
  }

  /**
   * Draw one code point into a cell
   *
   * @param  {number}   codepoint   Unicode code point
   * @param  {object}   cell        Width, height and baseline row of the cell
   * @param  {object}   metrics     The fit of the font in that cell, from metrics() or inherit()
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
