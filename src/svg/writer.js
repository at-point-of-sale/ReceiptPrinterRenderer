import outlines from '../../data/fonts/outlines.js';
import Bitmap from '../bitmap.js';
import Font from '../font.js';
import {trace} from './trace.js';
import {toStoredPng} from './png.js';

/**
 * @typedef {import('../types.js').Layout} Layout
 * @typedef {import('../types.js').LineEntry} LineEntry
 * @typedef {import('../types.js').PageEntry} PageEntry
 * @typedef {import('../types.js').CutEntry} CutEntry
 * @typedef {import('../types.js').TextOperation} TextOperation
 * @typedef {import('../types.js').ImageOperation} ImageOperation
 * @typedef {import('../types.js').SvgOptions} SvgOptions
 */

/*
    The SVG writer.

    It turns a display list into one document: the glyphs of data/fonts/outlines.js
    as paths in a <defs>, one <g> per line and per page, a <use> per text cell,
    one <path> per run of rectangles and an <image> with an embedded PNG per
    image. It draws what the bitmap back-end draws, with outlines in the place of
    the dots of the packed font, and nothing else: it reads a list and writes a
    string, synchronously, and has no dependency of its own.

    Two rules of the paper the document has to reproduce, which the display
    list states and the bitmap back-end applies by construction:

      - A line is clipped to the width of its surface, because the line bitmap of
        the back-end has that width. One clipPath serves every line of the paper.
      - An area of a page is clipped to the intersection of the area and the
        page, because an area can be taller than the page it stands on.

    And one rule of the paper the document does not reproduce, on purpose: a
    glyph of the face is not clipped to its cell. The bitmap of a cell is the
    cell, and a glyph of the face that is taller than it, a brace, a
    parenthesis, a capital with two accents, is finished by hand on the dot
    grid for the printer. The vector output draws the face, and the face is
    not squeezed into the cell and not cut at its edge either: it is drawn as
    designed, where it lies, above the cell when it reaches above it, the way
    a typographer sets it. What is clipped to its cell is a glyph the stream
    downloaded, which is dots of the printer's own and has no face behind it:
    it is written with a clip in its own coordinate system, the cell moved
    back by the position of the glyph box in it, so that one clip path serves
    every size the cell is drawn at.

    And two the format states as rules rather than as fields: a cell that is
    inverted or turned by ESC V carries the underline and the upperline of the
    style while no line is drawn on it, and a glyph whose path is the empty
    string, the space, the carriage return and the no break space, draws nothing
    while its cell is still inverted and underlined.

    And one that is a field but is not a box: the right side character spacing
    of a cell lies behind its box, and the reverse ground and the lines of the
    cell run over it, the way the bitmap back-end paints them. It is drawn as it
    stands, the layout having cut it to the print area of its line already.
*/

/* The version of the display list this writer draws */

const VERSION = 1;

/* The defaults of the options */

const DEFAULTS = {
  units: 'dots',
  cutMarker: false,
  background: '#fff',
  ink: '#000',
};

/* How many of the units of an attribute one dot is, by the unit the caller
   asked for, at the resolution of the profile. The viewBox is always dots, so
   only the width and the height of the document are written in them */

const UNITS = {
  dots: {factor: (dpi) => 1, suffix: ''},
  mm: {factor: (dpi) => 25.4 / dpi, suffix: 'mm'},
  pt: {factor: (dpi) => 72 / dpi, suffix: 'pt'},
  px: {factor: (dpi) => 96 / dpi, suffix: 'px'},
};

/* The resolution of a list that does not carry one */

const DEFAULT_DPI = 203;

/* The built in font of the two printer fonts, for the cells the box set of the
   outlines has no entry for, which are the cell sizes of a profile of an
   application's own */

const GLYPH_FONTS = {A: '12x24', B: '8x16'};

/* Which font the box set of the outlines was traced with, per cell: the 12 by
   24 font in the 12 by 24 cell of font A, the 8 by 16 font in the 9 by 17 cell
   of an Epson and the 9 by 24 cell of a Star. A cell of another shape, or one
   of these with the other font, is traced at write time instead */

const BOX_FONTS = {'12x24': 'A', '9x17': 'B', '9x24': 'B'};

/* How the glyph box of a font fits the outlines, which are drawn in the 12 by
   24 cell of font A: font B is the same outline at two thirds, unless the
   glyphsB set of the generator has an entry of its own for the glyph */

const FONT_FIT = {A: 1, B: 2 / 3};

/* The row the glyph box of a font stands on, which is the baseline of the
   outlines for font A and two thirds of it for the 8 by 16 box of font B */

const FONT_BASELINE = {A: outlines.baseline, B: (outlines.baseline * 2) / 3};

/* The code points of the box drawing and block characters, which are stretched
   to the edges of their cell and come from the box set */

const BOX_FIRST = 0x2500;
const BOX_LAST = 0x259f;

/* The dashes of a cut marker, in dots */

const CUT_DASH = '12 8';

/**
 * A number as an attribute: at most six decimals, without the zero before the
 * point that every writer leaves out
 *
 * @param  {number}   value   The number
 * @return {string}           The number as it is written in the document
 */
function num(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  const text = String(rounded === 0 ? 0 : rounded);

  if (text.startsWith('0.')) {
    return text.slice(1);
  }

  if (text.startsWith('-0.')) {
    return `-${text.slice(2)}`;
  }

  return text;
}

/**
 * Escape an attribute value. The document carries no text of the receipt, only
 * numbers and identifiers of its own, and the two colours of the options, which
 * is the one thing a caller writes into it.
 *
 * @param  {string}   value   The value
 * @return {string}           The value, with the five characters escaped
 */
function escape(value) {
  return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A rectangle as path data of one closed subpath, the shape the tracer writes
 * and the shape the rectangles of a line are collected in
 *
 * @param  {number}   x        Left edge
 * @param  {number}   y        Top edge
 * @param  {number}   width    Width
 * @param  {number}   height   Height
 * @return {string}            The subpath
 */
function box(x, y, width, height) {
  return `M${num(x)} ${num(y)}h${num(width)}v${num(height)}h-${num(width)}Z`;
}

/**
 * The identifier of a code point in an element id, its hexadecimal without a
 * prefix, the way the outlines are keyed. A code point that is not a number
 * gives NaN, which is a name like any other and reaches no document: a list
 * whose code point is not a number draws the fallback glyph.
 *
 * @param  {number}   codepoint   The code point
 * @return {string}               The identifier
 */
function hex(codepoint) {
  return Number(codepoint).toString(16);
}

/**
 * An element id with nothing in it that could leave the attribute it is written
 * in. The writer builds its ids out of numbers, cell sizes and the name of a
 * font, which are fields of the list a caller hands it, so every one of them
 * passes through here and keeps its letters, its digits, its dashes and its
 * underscores and loses the rest.
 *
 * @param  {string}   name   The id as it was composed
 * @return {string}          The id as it is written
 */
function identifier(name) {
  return String(name).replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * The writer of one document. It collects the glyphs and the clip paths the
 * receipt uses while it writes the body, and assembles the two afterwards, so
 * that a document defines what it uses and nothing more.
 */
class SvgWriter {
  #layout;
  #options;
  #height;

  #defs;
  #clips;
  #traced;

  #body;

  /**
     * Create a writer
     *
     * @param  {Layout}       layout    The display list
     * @param  {SvgOptions}   options   How the document looks
     */
  constructor(layout, options) {
    this.#layout = layout;
    this.#options = options;

    /* A document of no height at all is not a document: a rasterizer refuses
       it and a browser draws nothing. A list of no height is a receipt that
       printed nothing, so it becomes one blank row of paper, which is the
       smallest thing that can be looked at */

    this.#height = Math.max(1, layout.height || 0);

    this.#defs = new Map();
    this.#clips = new Map();
    this.#traced = new Map();

    this.#body = [];
  }

  /**
     * The document
     *
     * @return {string}   The SVG
     */
  write() {
    const layout = this.#layout;
    const paper = this.#clip('paper', box(0, 0, layout.width, this.#height));

    for (const entry of layout.entries || []) {
      if (entry.type === 'line') {
        this.#line(entry, layout.width, paper);
      } else if (entry.type === 'page') {
        this.#page(entry);
      } else if (entry.type === 'cut' && this.#options.cutMarker) {
        this.#cut(entry);
      }
    }

    return this.#document();
  }

  /**
     * The document around the body that was written
     *
     * @return {string}   The SVG
     */
  #document() {
    const layout = this.#layout;
    const unit = UNITS[this.#options.units];
    const factor = unit.factor(layout.dpi || DEFAULT_DPI);

    const width = `${num(layout.width * factor)}${unit.suffix}`;
    const height = `${num(this.#height * factor)}${unit.suffix}`;

    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${num(layout.width)} ${num(this.#height)}" fill="${escape(this.#options.ink)}">`,
    ];

    if (this.#options.background !== null) {
      parts.push(
          `<rect width="${num(layout.width)}" height="${num(this.#height)}" ` +
          `fill="${escape(this.#options.background)}"/>`,
      );
    }

    /* The glyphs first, then the clip paths, which is the order the plan of the
       section writes them in and the order they are needed in */

    parts.push('<defs>');
    parts.push(...this.#defs.values());
    parts.push(...this.#clips.values());
    parts.push('</defs>');

    parts.push(...this.#body);
    parts.push('</svg>');

    return `${parts.join('\n')}\n`;
  }

  /**
     * Register a clip path, by the shape it clips to
     *
     * @param  {string}   name   Name of the clip path, which is its id
     * @param  {string}   data   The path data of the shape
     * @return {string}          The id
     */
  #clip(name, data) {
    const id = identifier(name);

    if (!this.#clips.has(id)) {
      this.#clips.set(id, `<clipPath id="${id}"><path d="${data}"/></clipPath>`);
    }

    return id;
  }

  /**
     * Register a glyph definition
     *
     * @param  {string}   id      Id of the path
     * @param  {string}   data    The path data
     * @param  {number}   units   Path units per dot, which becomes a scale on the path
     * @return {string}           The id
     */
  #define(id, data, units) {
    const name = identifier(id);

    if (!this.#defs.has(name)) {
      this.#defs.set(
          name,
          `<path id="${name}" d="${data}"${units === 1 ? '' : ` transform="scale(${num(1 / units)})"`}/>`,
      );
    }

    return name;
  }

  /**
     * A line box and its operations
     *
     * @param  {LineEntry}   entry     The line
     * @param  {number}      width     Width of the surface the line was laid out on
     * @param  {string}      [clip]    Id of the clip path of the surface, none inside an area
     */
  #line(entry, width, clip) {
    const operations = entry.operations || [];

    if (operations.length === 0) {
      return;
    }

    const transform = entry.rotation === 180 ?
      `translate(${num(width)} ${num(entry.y + entry.height)})rotate(180)` :
      `translate(0 ${num(entry.y)})`;

    const content = [];

    /* The rectangles that stand next to each other in the list become one path,
       which is what a barcode, a QR code, a PDF417 symbol and a DataBar are, so
       that a symbol of a thousand modules costs one element */

    let rectangles = [];

    const flush = () => {
      if (rectangles.length) {
        content.push(`<path shape-rendering="crispEdges" d="${rectangles.join('')}"/>`);
        rectangles = [];
      }
    };

    for (const operation of operations) {
      if (operation.type === 'rect') {
        rectangles.push(box(operation.x, operation.y, operation.width, operation.height));
        continue;
      }

      flush();

      if (operation.type === 'text') {
        this.#text(operation, content);
      } else if (operation.type === 'image') {
        this.#image(operation, content);
      }
    }

    flush();

    if (content.length === 0) {
      return;
    }

    this.#body.push(
        `<g transform="${transform}"${clip ? ` clip-path="url(#${clip})"` : ''}>${content.join('')}</g>`,
    );
  }

  /**
     * One cell of text: the inversion, the glyph, the bold overstrike and the
     * lines above and below it, each of them over the character spacing behind
     * the cell as well.
     *
     * A cell that is not turned is written in the coordinates of the line, one
     * element per piece and no group at all; a cell that is turned by ESC V is
     * written in the frame of its unturned cell, in a group that turns it, so
     * that both paths place the pieces the same way.
     *
     * @param  {TextOperation}   operation   The cell
     * @param  {string[]}        content     The elements of the line, appended to
     */
  #text(operation, content) {
    const scale = operation.scale;
    const style = operation.style;

    const rotated = operation.rotation === 90;
    const width = operation.cell.width * scale.x;
    const height = operation.cell.height * scale.y;

    /* The right side character spacing behind the cell, which the reverse and
       the underline of the cell cover, the way the bitmap back-end paints it.
       The pieces of a turned cell are drawn in its unturned frame, where the
       spacing lies before the top edge, because the turn is clockwise */

    const spacing = operation.spacing || 0;

    /* The pieces of a turned cell are placed in its unturned frame and the
       group turns the lot, the quarter turn clockwise about the top left corner
       of the unturned cell that the format describes */

    const x = rotated ? 0 : operation.x;
    const y = rotated ? 0 : operation.y;

    const parts = [];

    /* An inverted cell is the cell in the ink colour with the glyph in the
       colour of the paper. White paint is not what a printer does, it only ever
       adds ink, so an inverted cell that a reverse feed puts over a printed
       line differs from the paper; see the notes of the section */

    if (style.invert) {
      parts.push(rotated ?
        this.#rule(x, y - spacing, width, height + spacing) :
        this.#rule(x, y, width + spacing, height));
    }

    const paint = style.invert ? ` fill="${escape(this.#options.background || '#fff')}"` : '';

    this.#glyph(operation, x, y, paint, parts);

    /* A printer draws no line under a reverse or a turned character, and the
       cell still carries the thickness the style had */

    if (!style.invert && !rotated) {
      if (style.upperline > 0) {
        parts.push(this.#rule(x, y, width + spacing, Math.min(style.upperline, height)));
      }

      if (style.underline > 0) {
        const thickness = Math.min(style.underline, height);

        parts.push(this.#rule(x, y + height - thickness, width + spacing, thickness));
      }
    }

    if (parts.length === 0) {
      return;
    }

    if (!rotated) {
      content.push(...parts);
      return;
    }

    content.push(
        `<g transform="translate(${num(operation.x + height)} ${num(operation.y)})rotate(90)">` +
        `${parts.join('')}</g>`,
    );
  }

  /**
     * A black rectangle of a cell: the ground of an inverted one, or an
     * underline or an upperline across the whole cell and the character spacing
     * behind it, of the thickness of the style, which is in paper dots and does
     * not scale
     *
     * @param  {number}   x        Left edge of the cell
     * @param  {number}   y        Top of the rectangle
     * @param  {number}   width    Width of the scaled cell, with the spacing
     * @param  {number}   height   Height in dots
     * @return {string}            The element
     */
  #rule(x, y, width, height) {
    return `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"` +
      ' shape-rendering="crispEdges"/>';
  }

  /**
     * The glyph of a text cell, and the bold overstrike next to it. A glyph of
     * the face is drawn where it lies, outside its cell when it reaches outside
     * it; a downloaded glyph is clipped to the scaled cell, see the header
     *
     * @param  {TextOperation}   operation   The cell
     * @param  {number}          x           Left edge of the cell in the frame it is written in
     * @param  {number}          y           Top of the cell in the frame it is written in
     * @param  {string}          paint       The fill attribute of an inverted cell, or nothing
     * @param  {string[]}        parts       The pieces of the cell, appended to
     */
  #glyph(operation, x, y, paint, parts) {
    const shape = this.#shape(operation);

    if (!shape) {
      return;
    }

    const scale = operation.scale;

    /* Where the glyph box sits in the cell: centred horizontally and on the
       baseline of the cell vertically, which is what renderGlyph() does with
       the dots */

    const left = Math.floor((operation.cell.width - shape.width) / 2);
    const top = operation.baseline - shape.baseline;

    /* The scale of the element, and the clip of the cell in the coordinates the
       element is drawn in, which is where the clip of a clipped element lives.
       It is the same rectangle for every size a cell is drawn at, so one clip
       path serves every cell of a font in a cell of that shape */

    const fx = scale.x * shape.fit;
    const fy = scale.y * shape.fit;

    const clip = shape.clipped ? this.#cellClip(operation.cell, left, top, shape.fit) : '';

    parts.push(this.#use(shape, x + left * scale.x, y + top * scale.y, fx, fy, clip, paint));

    /* Bold is the glyph a second time one glyph dot to the right, which is
       scale.x paper dots. A downloaded glyph that reaches the right edge of
       its cell is cut there in bold as it is on the paper, so its overstrike
       is clipped to the same cell and not to a cell of its own */

    if (operation.style.bold) {
      const bolder = shape.clipped ? this.#cellClip(operation.cell, left + 1, top, shape.fit) : '';

      parts.push(this.#use(shape, x + (left + 1) * scale.x, y + top * scale.y, fx, fy, bolder, paint));
    }
  }

  /**
     * One glyph element: a reference to a definition, or the path of a glyph
     * the stream downloaded, which is a drawing of its own and is written where
     * it is used
     *
     * @param  {object}   shape   The glyph, as #shape() resolved it
     * @param  {number}   x       Left edge of the glyph box
     * @param  {number}   y       Top of the glyph box
     * @param  {number}   fx      Horizontal scale of the path
     * @param  {number}   fy      Vertical scale of the path
     * @param  {string}   clip    Id of the clip path of the cell, or an empty string for a glyph
     *                            that is drawn where it lies
     * @param  {string}   paint   The fill attribute of an inverted cell, or nothing
     * @return {string}           The element
     */
  #use(shape, x, y, fx, fy, clip, paint) {
    const scale = fx === 1 && fy === 1 ? '' : `scale(${num(fx)}${fx === fy ? '' : ` ${num(fy)}`})`;
    const move = x === 0 && y === 0 ? '' : `translate(${num(x)} ${num(y)})`;
    const transform = `${move}${scale}`;

    const attributes = `${transform ? ` transform="${transform}"` : ''}${
      clip ? ` clip-path="url(#${clip})"` : ''}${paint}`;

    return shape.id ?
      `<use href="#${shape.id}"${attributes}/>` :
      `<path d="${shape.data}"${attributes}/>`;
  }

  /**
     * The clip path of a cell, in the coordinates of the glyph element: the
     * cell, moved back by the position of the glyph box in it and measured in
     * the units of the glyph box, which makes it independent of the size the
     * cell is drawn at
     *
     * @param  {object}   cell   The unscaled cell
     * @param  {number}   left   Position of the glyph box in the cell
     * @param  {number}   top    Position of the glyph box in the cell
     * @param  {number}   fit    The scale the glyph box is drawn at, 1 or two thirds
     * @return {string}          The id of the clip path
     */
  #cellClip(cell, left, top, fit) {
    const x = -left / fit;
    const y = -top / fit;
    const width = cell.width / fit;
    const height = cell.height / fit;

    const name = `k${num(x)}_${num(y)}_${num(width)}_${num(height)}`.replace(/[.-]/g, (character) => {
      return character === '.' ? 'p' : 'm';
    });

    return this.#clip(name, box(x, y, width, height));
  }

  /**
     * What is drawn for a text cell: a definition and the box it is drawn in,
     * or a path of its own for a glyph the stream downloaded, or nothing at all
     * for a code point whose outline is empty, which the space, the carriage
     * return and the no break space are
     *
     * @param  {TextOperation}   operation   The cell
     * @return {object|null}                 The glyph, or null when nothing is drawn
     */
  #shape(operation) {
    const cell = operation.cell;

    /* The font of the operation is A or B and nothing else: it names a glyph
       box, a fit and a packed font here, and it reaches the id of a definition,
       so a list that carries anything else is read as font A */

    const font = operation.font === 'B' ? 'B' : 'A';

    /* A glyph the stream downloaded is a bitmap in the corner of an unscaled
       cell, so its box is the cell and its rectangles are traced where they are
       used: the stream defined it, no other receipt has it */

    if (operation.bitmap) {
      const data = trace(this.#crop(operation.bitmap, cell));

      return data ? {data, width: cell.width, baseline: operation.baseline, fit: 1, clipped: true} : null;
    }

    /* A code point that is not a whole number names no glyph of the outlines
       and is drawn with the fallback, the way a code point the face does not
       have is */

    const codepoint = Number.isInteger(operation.codepoint) ? operation.codepoint : outlines.fallback;

    if (codepoint >= BOX_FIRST && codepoint <= BOX_LAST) {
      return this.#boxShape(operation, font, codepoint, cell);
    }

    /* Font B is the outline of font A at two thirds, in its own 8 by 16 box,
       unless the generator found a glyph whose fit is not two thirds and gave
       it an entry of its own, which it draws unscaled */

    const own = font === 'B' && codepoint in outlines.glyphsB;
    const glyphs = own ? outlines.glyphsB : outlines.glyphs;
    const key = own || codepoint in outlines.glyphs ? codepoint : outlines.fallback;

    const data = glyphs[key];

    /* A code point whose path is the empty string is a glyph that is drawn with
       no ink at all, so it is asked for by name and not by truthiness */

    if (!(key in glyphs) || data === '') {
      return null;
    }

    /* The glyph box of the font, which is the cell of the outlines for font A
       and two thirds of it for font B, whether font B draws the path of font A
       at two thirds or an entry of its own that is already in that box */

    return {
      id: this.#define(`${own ? 'b' : 'a'}${hex(key)}`, data, outlines.units),
      width: outlines.cell.width * FONT_FIT[font],
      baseline: FONT_BASELINE[font],
      fit: own ? 1 : FONT_FIT[font],
    };
  }

  /**
     * What is drawn for a box drawing or block character: the rectangles of the
     * box set of the outlines for the cell of the operation, or, for a cell the
     * set has no entry for, which is a cell size of a profile of an
     * application's own, the cell the bitmap font renders traced at write time
     * and kept for the cells that follow
     *
     * @param  {TextOperation}   operation   The cell
     * @param  {string}          font        The font of the cell, A or B
     * @param  {number}          codepoint   The code point
     * @param  {object}          cell        The unscaled cell
     * @return {object|null}                 The glyph, or null when nothing is drawn
     */
  #boxShape(operation, font, codepoint, cell) {
    const size = `${cell.width}x${cell.height}`;
    const set = outlines.box[size];

    /* The box set was traced with the font of the cell it belongs to, so a cell
       of that shape in the other font is traced here instead */

    if (set && BOX_FONTS[size] === font && codepoint in set) {
      return set[codepoint] === '' ?
        null :
        {id: this.#define(`x${hex(codepoint)}-${size}`, set[codepoint], 1), width: cell.width,
          baseline: operation.baseline, fit: 1};
    }

    const name = `t${hex(codepoint)}-${font}-${size}`;

    if (!this.#traced.has(name)) {
      const packed = Font.get(GLYPH_FONTS[font]);

      const data = trace(packed.renderGlyph(packed.lookup(codepoint), {
        cellWidth: cell.width,
        cellHeight: cell.height,
        stretch: true,
      }));

      this.#traced.set(name, data);
    }

    const data = this.#traced.get(name);

    if (data === '') {
      return null;
    }

    return {
      id: this.#define(name, data, 1),
      width: cell.width,
      baseline: operation.baseline,
      fit: 1,
    };
  }

  /**
     * A downloaded glyph in its cell: the dots of the stream in the top left
     * corner of an unscaled cell of the operation, clipped by it, which is
     * where the bitmap back-end blits them
     *
     * @param  {object}   bitmap   The glyph as the stream defined it
     * @param  {object}   cell     The unscaled cell
     * @return {object}            The dots of the cell
     */
  #crop(bitmap, cell) {
    if (bitmap.width === cell.width && bitmap.height === cell.height) {
      return bitmap;
    }

    const result = Bitmap.create(cell.width, cell.height);

    Bitmap.blit(bitmap, result, 0, 0);

    return result;
  }

  /**
     * An image, as a PNG of one bit per dot in a data URL. The dots are not
     * smoothed: one dot of the paper is one pixel of the image.
     *
     * @param  {ImageOperation}   operation   The image
     * @param  {string[]}         content     The elements of the line, appended to
     */
  #image(operation, content) {
    const png = toStoredPng({width: operation.width, height: operation.height, data: operation.data});

    content.push(
        `<image x="${num(operation.x)}" y="${num(operation.y)}" ` +
        `width="${num(operation.width)}" height="${num(operation.height)}" ` +
        `image-rendering="pixelated" href="data:image/png;base64,${base64(png)}"/>`,
    );
  }

  /**
     * A page of page mode: one group per print area, clipped to the part of the
     * area that is on the page and turned by the print direction of the area,
     * with the lines of the area on the logical surface of that direction
     *
     * @param  {PageEntry}   entry   The page
     */
  #page(entry) {
    const areas = entry.areas || [];
    const groups = [];

    for (const area of areas) {
      const sideways = area.direction === 1 || area.direction === 3;
      const width = sideways ? area.height : area.width;

      const content = [];
      const body = this.#body;

      /* The lines of an area are written into the group of the area, so the
         body is borrowed for as long as they are laid out */

      this.#body = content;

      for (const box of area.entries || []) {
        if (box.type === 'line') {
          this.#line(box, width, null);
        }
      }

      this.#body = body;

      if (content.length === 0) {
        continue;
      }

      groups.push(
          `<g clip-path="url(#${this.#areaClip(entry, area)})">` +
          `<g transform="${this.#direction(area)}">${content.join('')}</g></g>`,
      );
    }

    if (groups.length === 0) {
      return;
    }

    this.#body.push(`<g transform="translate(0 ${num(entry.y)})">${groups.join('')}</g>`);
  }

  /**
     * The transform of a print area: the turn of its direction, about the
     * corner of the area the direction starts in
     *
     * @param  {object}   area   The print area
     * @return {string}          The transform
     */
  #direction(area) {
    if (area.direction === 1) {
      return `translate(${num(area.x)} ${num(area.y + area.height)})rotate(-90)`;
    }

    if (area.direction === 2) {
      return `translate(${num(area.x + area.width)} ${num(area.y + area.height)})rotate(180)`;
    }

    if (area.direction === 3) {
      return `translate(${num(area.x + area.width)} ${num(area.y)})rotate(90)`;
    }

    return `translate(${num(area.x)} ${num(area.y)})`;
  }

  /**
     * The clip path of a print area: the part of the area that is on the page,
     * since an area can be taller and wider than the page it stands on
     *
     * @param  {PageEntry}   entry   The page
     * @param  {object}      area    The print area
     * @return {string}              The id of the clip path
     */
  #areaClip(entry, area) {
    const x = Math.max(0, area.x);
    const y = Math.max(0, area.y);
    const right = Math.min(this.#layout.width, area.x + area.width);
    const bottom = Math.min(entry.height, area.y + area.height);

    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);

    return this.#clip(`q${num(x)}_${num(y)}_${num(width)}_${num(height)}`, box(x, y, width, height));
  }

  /**
     * A cut, as a dashed line across the paper at the row the paper is cut on
     *
     * @param  {CutEntry}   entry   The cut
     */
  #cut(entry) {
    this.#body.push(
        `<line x1="0" y1="${num(entry.y)}" x2="${num(this.#layout.width)}" y2="${num(entry.y)}" ` +
        `stroke="${escape(this.#options.ink)}" stroke-width="1" stroke-dasharray="${CUT_DASH}"/>`,
    );
  }
}

/**
 * Base64 of a byte array, without the APIs of one platform
 *
 * @param  {Uint8Array}   data   The bytes
 * @return {string}              The base64
 */
function base64(data) {
  let binary = '';

  for (let index = 0; index < data.length; index++) {
    binary += String.fromCharCode(data[index]);
  }

  /* eslint-disable no-undef */
  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  if (typeof Buffer === 'function') {
    return Buffer.from(data).toString('base64');
  }
  /* eslint-enable no-undef */

  throw new Error('No base64 encoder available on this platform');
}

/**
 * Turn a display list into an SVG document.
 *
 * The document is the paper of the list, `width` by `height` dots, with one
 * exception: a list of no height at all, a stream that printed nothing, becomes
 * a document of one blank row, because a document of no height is refused by a
 * rasterizer and drawn as nothing by a browser.
 *
 * @param  {Layout}       layout      The display list, as layout() returned it
 * @param  {SvgOptions}   [options]   How the document looks
 * @return {string}                   The SVG document
 */
function toSvg(layout, options) {
  if (!layout || typeof layout !== 'object') {
    throw new Error('A display list is required');
  }

  if (layout.version !== VERSION) {
    throw new Error(`Display list version ${layout.version} is not supported, this is version ${VERSION}`);
  }

  const settings = Object.assign({}, DEFAULTS, options || {});

  if (!Object.prototype.hasOwnProperty.call(UNITS, settings.units)) {
    throw new Error(`Unknown units ${settings.units}, must be one of ${Object.keys(UNITS).join(', ')}`);
  }

  return new SvgWriter(layout, settings).write();
}

export default toSvg;
export {toSvg, SvgWriter, VERSION};
