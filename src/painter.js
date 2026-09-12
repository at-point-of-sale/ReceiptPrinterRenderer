import Bitmap from './bitmap.js';
import Font from './font.js';
import {barcode as encodeBarcode} from './symbologies/index.js';
import {qrcode as encodeQrcode} from './symbologies/qrcode.js';
import {pdf417 as encodePdf417} from './symbologies/pdf417.js';

/**
 * @typedef {import('./types.js').Bitmap} Bitmap
 * @typedef {import('./font.js').PackedFont} PackedFont
 */

/**
 * A cell size, as a printer profile describes it
 *
 * @typedef {object} CellSize
 * @property {number} width    Width of the cell in dots
 * @property {number} height   Height of the cell in dots
 */

/**
 * Printer family defaults, one of the entries of generated/profiles.js
 *
 * @typedef {object} Profile
 * @property {string} vendor                          Name of the printer family
 * @property {number} lineSpacing                     Default line spacing in dots
 * @property {number} motionUnit                      Default vertical motion units per dot
 * @property {number} [dpi]                           Resolution of the printer, for the horizontal motion unit of GS P
 * @property {{A: CellSize, B: CellSize}} fonts       Cell size of font A and font B
 */

/**
 * @typedef {object} PainterOptions
 * @property {number} width                   Width of the print area in dots, a multiple of 8
 * @property {Profile} profile                Printer family defaults
 * @property {string[]} [commands]            Command types that may appear in the output
 * @property {number} [maxHeight]             Maximum height of an image item, taller segments are split
 * @property {number} [lineSpacing]           Default line spacing in dots, defaults to the profile
 * @property {number} [feedThreshold]         Runs of blank rows at least this tall become feed items
 * @property {Object<string, PackedFont>} [font]   Font data, instead of the built in fonts
 */

/**
 * The human readable text of a barcode
 *
 * @typedef {object} HriOptions
 * @property {string} position   'none', 'above', 'below' or 'both'
 * @property {string} font       Font the text is drawn in, 'A' or 'B'
 */

/**
 * A barcode, as a parser asks the painter to draw it
 *
 * @typedef {object} BarcodeRequest
 * @property {string} symbology       Name of the symbology, see src/symbologies
 * @property {string} data            The value of the barcode
 * @property {number} moduleWidth     Width of the narrowest bar in dots
 * @property {number} height          Height of the bars in dots
 * @property {HriOptions} [hri]       Where the human readable text goes, and in which font
 */

/**
 * A QR code, as a parser asks the painter to draw it
 *
 * @typedef {object} QrcodeRequest
 * @property {Uint8Array} data     The bytes to encode
 * @property {number} moduleSize   Size of one module in dots
 * @property {string} errorLevel   Error correction level, 'L', 'M', 'Q' or 'H'
 */

/**
 * A PDF417 symbol, as a parser asks the painter to draw it
 *
 * @typedef {object} Pdf417Request
 * @property {Uint8Array} data              The bytes to encode
 * @property {number} [columns]             Data columns, 1 to 30, 0 for automatic
 * @property {number} [rows]                Rows, 3 to 90, 0 for automatic
 * @property {number} moduleWidth           Width of a module in dots
 * @property {number} rowHeight             Height of a row in modules
 * @property {number|string} [errorLevel]   Error correction level, 0 to 8, or 'auto'
 * @property {number} [errorRatio]          Check codewords per ten data codewords, for 'auto'
 * @property {boolean} [truncated]          Draw the truncated form of the symbol
 */

/**
 * How a kept image is drawn, as a parser asks the painter to print it
 *
 * @typedef {object} PrintRequest
 * @property {{x: number, y: number}} [scale]   Horizontal and vertical multiplier, 1 by default
 */

/**
 * The current print style, as the printers style commands set it
 *
 * @typedef {object} Style
 * @property {boolean} bold        Overstrike
 * @property {number} underline    Underline thickness in dots, 0, 1 or 2
 * @property {number} upperline    Upperline thickness in dots, 0, 1 or 2
 * @property {boolean} invert      White on black
 * @property {number} width        Horizontal size multiplier, 1 to 8
 * @property {number} height       Vertical size multiplier, 1 to 8
 * @property {boolean} upsideDown  Rotate every committed line by 180 degrees
 */

/**
 * The left margin and the width of the print area, in dots
 *
 * @typedef {object} Margins
 * @property {number} [left]    Left margin in dots, from the left edge of the paper
 * @property {number} [width]   Width of the print area in dots, null for the whole paper
 */

/* The built in fonts the two printer fonts are drawn from. Font A is the 12x24
   font, font B is the 8x16 font, centred in whatever cell the profile gives it,
   which is 9x17 on Epson and 9x24 on Star */

const GLYPH_FONTS = {A: '12x24', B: '8x16'};

/* How much a growing row buffer allocates the first time */

const INITIAL_ROWS = 256;

/* The style the human readable text of a barcode is drawn in, which is never
   the style of the text around it */

const PLAIN = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1};

/* The default tab stops of a printer, every eight characters of font A, and
   the most stops ESC D can set */

const TAB_INTERVAL = 8;
const MAX_TAB_STOPS = 32;

/* The code point of the glyph a multibyte character is drawn with, which the
   font draws as its fallback box */

const PLACEHOLDER = 0xfffd;

/* White dot rows between the bars of a barcode and its human readable text.
   The cell of the font has no room of its own above a capital, so without a
   gap the text touches the bars. Four dots is a legibility choice, it is not
   taken from a specification, and it is still to be compared with what an
   Epson puts on paper. */

const HRI_GAP = 4;

/**
 * The painter keeps the state of the printer, composes lines from cells,
 * accumulates the rows of the committed lines and cuts image items from them.
 * It is shared by the parsers of every language, so it knows nothing about
 * bytes or commands, only about text, styles and blocks.
 */
class Painter {
  #width;
  #profile;
  #commands;
  #maxHeight;
  #feedThreshold;

  #fonts;
  #cells;
  #cache;

  #style;
  #font;
  #align;
  #lineSpacing;
  #defaultLineSpacing;
  #spacing;
  #tabs;
  #margins;
  #upsideDown;

  #line;
  #definitions;

  #buffer;
  #rows;
  #capacity;
  #blankRuns;

  #items;

  /**
     * Create a painter
     *
     * @param  {PainterOptions}   options   How the printer this painter emulates behaves
     */
  constructor(options) {
    const settings = options || {};

    if (!Number.isInteger(settings.width) || settings.width < 8 || settings.width % 8 !== 0) {
      throw new Error('Width must be a positive multiple of 8 dots');
    }

    if (!settings.profile || !settings.profile.fonts) {
      throw new Error('A printer profile is required');
    }

    this.#width = settings.width;
    this.#profile = settings.profile;
    this.#commands = new Set(settings.commands || []);
    this.#maxHeight = typeof settings.maxHeight === 'undefined' ? null : settings.maxHeight;
    this.#feedThreshold = typeof settings.feedThreshold === 'undefined' ? 24 : settings.feedThreshold;

    if (this.#maxHeight !== null && (!Number.isInteger(this.#maxHeight) || this.#maxHeight < 1)) {
      throw new Error('Maximum height must be a positive integer');
    }

    if (!Number.isInteger(this.#feedThreshold) || this.#feedThreshold < 1) {
      throw new Error('Feed threshold must be a positive integer');
    }

    this.#defaultLineSpacing = typeof settings.lineSpacing === 'undefined' ?
      this.#profile.lineSpacing :
      settings.lineSpacing;

    if (!Number.isInteger(this.#defaultLineSpacing) || this.#defaultLineSpacing < 1) {
      throw new Error('Line spacing must be a positive integer');
    }

    /* The glyphs come from the built in fonts, unless an application supplied
       its own font data in the same packed format */

    this.#fonts = {
      A: settings.font ? new Font(settings.font[GLYPH_FONTS.A]) : Font.get(GLYPH_FONTS.A),
      B: settings.font ? new Font(settings.font[GLYPH_FONTS.B]) : Font.get(GLYPH_FONTS.B),
    };

    this.#cells = {
      A: this.#profile.fonts.A,
      B: this.#profile.fonts.B,
    };

    this.#cache = new Map();
    this.#items = [];

    /* The images the graphics commands define live as long as this painter
       does: they are the memory of the printer, which an initialize does not
       empty and which is still there for the next job */

    this.#definitions = new Map();

    this.#clear();
    this.reset();
  }

  /**
     * The printer profile this painter uses
     *
     * @return {Profile}   The profile
     */
  get profile() {
    return this.#profile;
  }

  /**
     * Width of the print area in dots
     *
     * @return {number}   Width in dots
     */
  get width() {
    return this.#width;
  }

  /**
     * Number of font A characters that fit on a line
     *
     * @return {number}   Number of columns
     */
  get columns() {
    return Math.floor(this.#width / this.#cells.A.width);
  }

  /**
     * Initialize the printer state: styles, font, alignment and line spacing.
     * The rows that were already committed and the items that were already
     * emitted are kept, which is what ESC @ does on a real printer.
     */
  reset() {
    this.#style = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1};
    this.#font = 'A';
    this.#align = 'left';
    this.#lineSpacing = this.#defaultLineSpacing;
    this.#spacing = 0;
    this.#tabs = null;
    this.#margins = {left: 0, width: null};
    this.#upsideDown = false;
    this.#line = this.#empty();
  }

  /**
     * Width of one character of the current font in dots, which is what the
     * margins and the tab stops of the Star commands are counted in
     *
     * @return {number}   Width of a cell in dots
     */
  get characterWidth() {
    return this.#cells[this.#font].width;
  }

  /**
     * Where the next cell goes, in dots from the left margin, which is what
     * ESC \ counts its distance from
     *
     * @return {number}   Position of the cursor
     */
  get cursor() {
    return this.#line.x;
  }

  /**
     * Append text to the current line, one cell per character, in the current
     * style. A character that does not fit on the rest of the line wraps to the
     * next one, the way a printer wraps.
     *
     * The string is already decoded, the parser owns the codepage.
     *
     * @param  {string}   value   The text to print
     */
  text(value) {
    for (const character of value) {
      const cell = this.#cell(character.codePointAt(0));

      this.#place(cell, this.#spacing * this.#style.width);
    }
  }

  /**
     * Append cells of the fallback glyph, which is what a multibyte character
     * becomes on a printer without the font for it. One Kanji character is two
     * cells wide, so that the layout around it stays right.
     *
     * @param  {number}   count   Number of cells to draw
     */
  placeholder(count) {
    for (let cell = 0; cell < count; cell++) {
      this.#place(this.#cell(PLACEHOLDER), this.#spacing * this.#style.width);
    }
  }

  /**
     * Change one or more style properties. Properties that are not given keep
     * their value.
     *
     * Upside down is not a property of a cell but of the line it lands on: it
     * rotates every line that is committed from here on, so it is kept apart
     * from the style the cells are drawn in.
     *
     * @param  {Partial<Style>}   changes   The properties to change
     */
  style(changes) {
    if (!changes) {
      return;
    }

    for (const property of ['bold', 'underline', 'upperline', 'invert', 'width', 'height']) {
      if (typeof changes[property] !== 'undefined') {
        this.#style[property] = changes[property];
      }
    }

    if (typeof changes.upsideDown !== 'undefined') {
      this.#upsideDown = changes.upsideDown === true;
    }
  }

  /**
     * Change the space that follows every cell, which ESC SP sets. The space is
     * scaled with the width multiplier, as the printer scales it, and it is not
     * part of the width the alignment centres, so a centred line with character
     * spacing is centred on its characters.
     *
     * @param  {number}   dots   Extra dots after every cell
     */
  spacing(dots) {
    if (!Number.isInteger(dots) || dots < 0) {
      return;
    }

    this.#spacing = dots;
  }

  /**
     * Move the cursor to an absolute position on the line, in dots from the
     * left margin, which is what ESC $ and HT do. A position beyond the print
     * area is ignored, the way a printer ignores it.
     *
     * @param  {number}   dots   Position in dots from the left margin
     */
  position(dots) {
    if (!Number.isInteger(dots) || dots < 0 || dots > this.#area()) {
      return;
    }

    this.#line.x = dots;
  }

  /**
     * Set the tab stops, in characters of the current font, which is what
     * ESC D does. An empty list cancels every stop, after which a tab does
     * nothing at all, and `null` goes back to the default of a stop every eight
     * characters, which is what an initialize does. Stops have to ascend, a
     * stop that does not ends the list, and a printer holds at most 32 of them.
     *
     * A character is as wide as the cell plus the character spacing of
     * `spacing()`, which is how the ESC/POS reference of ESC D defines the
     * unit: the character width includes the right side spacing.
     *
     * @param  {number[]|null}   columns   The stops in characters, [] for none, null for the defaults
     */
  tabs(columns) {
    if (columns === null || typeof columns === 'undefined') {
      this.#tabs = null;
      return;
    }

    if (!Array.isArray(columns)) {
      return;
    }

    const width = this.#tabUnit();
    const stops = [];

    for (const column of columns) {
      if (!Number.isInteger(column) || column < 1 || stops.length >= MAX_TAB_STOPS) {
        break;
      }

      const position = column * width;

      if (stops.length && position <= stops[stops.length - 1]) {
        break;
      }

      stops.push(position);
    }

    this.#tabs = stops;
  }

  /**
     * Move the cursor to the next tab stop, which is what HT does. A tab past
     * the last stop does nothing, and neither does a tab when every stop was
     * cancelled. A stop that lies outside the print area puts the cursor one
     * dot beyond the area instead, so that the next character wraps to a new
     * line, which is what the ESC/POS reference of HT describes.
     */
  tab() {
    const stops = this.#tabs === null ? this.#defaultTabs() : this.#tabs;
    const area = this.#area();

    for (const stop of stops) {
      if (stop <= this.#line.x) {
        continue;
      }

      this.#line.x = stop < area ? stop : area + 1;

      return;
    }
  }

  /**
     * Set the left margin and the width of the print area, both in dots.
     *
     * The commands that set them are only effective at the beginning of a
     * line, so a line that is already being composed, or whose cursor has been
     * moved, makes the whole command do nothing, the way a printer drops it.
     * A width that does not fit on the paper is clamped to it.
     *
     * @param  {Margins}   changes   The margins to change, the others keep their value
     */
  margins(changes) {
    if (!changes || this.#line.cells.length !== 0 || this.#line.x !== 0) {
      return;
    }

    this.#margins = {
      left: typeof changes.left === 'undefined' ? this.#margins.left : Math.max(0, changes.left),
      width: typeof changes.width === 'undefined' ? this.#margins.width : changes.width,
    };
  }

  /**
     * Change the font
     *
     * @param  {string}   name   'A' or 'B'
     */
  font(name) {
    if (name !== 'A' && name !== 'B') {
      throw new Error(`Unknown font ${name}`);
    }

    this.#font = name;
  }

  /**
     * Change the alignment, which is applied when the line is committed
     *
     * @param  {string}   value   'left', 'center' or 'right'
     */
  align(value) {
    if (value !== 'left' && value !== 'center' && value !== 'right') {
      throw new Error(`Unknown alignment ${value}`);
    }

    this.#align = value;
  }

  /**
     * Change the line spacing
     *
     * @param  {number|null}   dots   Line spacing in dots, null restores the default
     */
  lineSpacing(dots) {
    if (dots === null || typeof dots === 'undefined') {
      this.#lineSpacing = this.#defaultLineSpacing;
      return;
    }

    if (!Number.isInteger(dots) || dots < 0) {
      throw new Error('Line spacing must be a non-negative integer');
    }

    this.#lineSpacing = dots;
  }

  /**
     * Commit the current line and advance the paper. The line is as tall as the
     * tallest cell on it, but never shorter than the line spacing, so a line of
     * double height text is 48 dots and not 60. An empty line advances by the
     * line spacing alone.
     *
     * @param  {number}   [count]   Number of lines to advance, ESC d n feeds more than one
     */
  lineFeed(count = 1) {
    this.#commit(this.#lineSpacing * count);
  }

  /**
     * Commit the current line and advance the paper by a number of dot rows
     * instead of by whole lines, which is what ESC J does. A line that is
     * taller than the requested distance still advances by its own height, so
     * that nothing overlaps.
     *
     * @param  {number}   dots   Number of dot rows to advance
     */
  feed(dots) {
    this.#commit(Math.max(0, dots));
  }

  /**
     * Throw away the line that is being composed, without advancing the paper.
     * The Star CAN command cancels the print data of the line buffer, which is
     * this, and ESC @ does it as part of a full initialize.
     */
  cancel() {
    this.#line = this.#empty();
  }

  /**
     * Place a bitmap in the current line, at the cursor, as if it were one wide
     * cell. Column mode images are strips of 24 rows that sit inside normal
     * lines, this is how they get there.
     *
     * @param  {Bitmap}   bitmap   The strip to place
     */
  strip(bitmap) {
    this.#place(bitmap);
  }

  /**
     * Commit the pending line, then draw a bitmap on a line of its own, aligned
     * the way the current alignment says, and advance the paper by its height.
     *
     * Blocks that are not laid out by the line mode, the rows of the Star
     * raster mode, ask for `margins: false`: they carry their own position and
     * are placed on the paper itself, so a left margin of the line mode does
     * not shift them and a print area does not clip them.
     *
     * @param  {Bitmap}   bitmap      The block to draw
     * @param  {object}   [options]   `{margins: false}` to ignore the print area
     */
  block(bitmap, options) {
    const paper = options ? options.margins === false : false;

    if (this.#line.cells.length) {
      this.lineFeed();
    } else {
      this.#line = this.#empty();
    }

    const line = Bitmap.create(this.#width, bitmap.height);
    const offset = paper ?
      this.#offset(bitmap.width, this.#width) :
      this.#margins.left + this.#offset(bitmap.width);

    Bitmap.blit(bitmap, line, offset, 0);

    this.#append(this.#upsideDown ? Bitmap.rotate180(line) : line);
  }

  /**
     * Keep an image for later, under a key of the parser's own making, such as
     * `nv:65:66` for the NV graphics of a key code or `nv-bit-image:1` for the
     * first image of an `FS q` definition.
     *
     * The images are the memory of the printer: they survive `reset()`, which
     * is what an initialize does, and `discard()`, so a definition in one
     * stream is still there in the next one. A definition without a bitmap
     * deletes the key, which is what the delete commands of the graphics group
     * do.
     *
     * @param  {string}        key      Name of the image
     * @param  {Bitmap|null}   bitmap   The image, or null to delete it
     */
  define(key, bitmap) {
    if (typeof key !== 'string') {
      return;
    }

    if (!bitmap) {
      this.#definitions.delete(key);
      return;
    }

    this.#definitions.set(key, bitmap);
  }

  /**
     * Delete every image whose key starts with a prefix, which is what the
     * commands that delete all NV or all download graphics do
     *
     * @param  {string}   prefix   The start of the keys to delete
     */
  forget(prefix) {
    for (const key of this.#definitions.keys()) {
      if (key.startsWith(prefix)) {
        this.#definitions.delete(key);
      }
    }
  }

  /**
     * Draw an image that was kept as a block, scaled by repeating its dots the
     * way the print commands of the graphics group scale it.
     *
     * A key that was never defined prints nothing at all and does not advance
     * the paper, which is what a printer does with an image it does not hold.
     * The parser reports the command instead, so the caller is told whether
     * anything was drawn.
     *
     * @param  {string}         key         Name of the image
     * @param  {PrintRequest}   [options]   How the image is scaled
     * @return {boolean}                    True when the image was drawn
     */
  print(key, options) {
    const bitmap = this.#definitions.get(key);

    if (!bitmap) {
      return false;
    }

    const scale = (options && options.scale) || {};
    const x = Number.isInteger(scale.x) && scale.x > 0 ? scale.x : 1;
    const y = Number.isInteger(scale.y) && scale.y > 0 ? scale.y : 1;

    this.block(Bitmap.scale(bitmap, x, y));

    return true;
  }

  /**
     * Draw a one dimensional barcode as a block, with its human readable text
     * above it, below it, or not at all.
     *
     * Data that is not valid for the symbology prints nothing, which is what
     * printer firmware does: the barcode is skipped and the paper does not
     * advance. Bars that are wider than the print area are skipped for the same
     * reason, an Epson prints nothing at all rather than a barcode no reader
     * can read. The human readable text is not part of that rule, it is centred
     * under the bars and clipped when it is wider than the paper.
     *
     * @param  {BarcodeRequest}   request   The barcode to draw
     */
  barcode(request) {
    const code = encodeBarcode(request.symbology, request.data);

    if (code === null || code.bars.length === 0) {
      return;
    }

    const moduleWidth = Math.max(1, request.moduleWidth || 1);
    const height = Math.max(1, request.height || 1);

    if (code.bars.reduce((total, width) => total + width, 0) * moduleWidth > this.#width) {
      return;
    }

    const position = (request.hri && request.hri.position) || 'none';
    const text = position === 'none' ? null : this.#textBitmap(code.text, (request.hri && request.hri.font) || 'A');

    /* The bars are one bitmap, the text one line of cells below them, above
       them, or both, with HRI_GAP dots of white in between, and the block is as
       wide as the wider of the two */

    const bars = Bitmap.create(code.bars.reduce((total, width) => total + width, 0) * moduleWidth, height);

    let x = 0;

    for (let index = 0; index < code.bars.length; index++) {
      const width = code.bars[index] * moduleWidth;

      if (index % 2 === 0) {
        for (let column = x; column < x + width; column++) {
          for (let row = 0; row < height; row++) {
            Bitmap.setPixel(bars, column, row, 1);
          }
        }
      }

      x += width;
    }

    if (text === null) {
      this.block(bars);
      return;
    }

    const above = position === 'above' || position === 'both';
    const below = position === 'below' || position === 'both';

    const margin = text.height + HRI_GAP;

    const width = Math.max(bars.width, text.width);
    const block = Bitmap.create(width, bars.height + (above ? margin : 0) + (below ? margin : 0));

    if (above) {
      Bitmap.blit(text, block, (width - text.width) >> 1, 0);
    }

    Bitmap.blit(bars, block, (width - bars.width) >> 1, above ? margin : 0);

    if (below) {
      Bitmap.blit(text, block, (width - text.width) >> 1, block.height - text.height);
    }

    this.block(block);
  }

  /**
     * Draw a QR code as a block. Nothing is printed when there is no data to
     * encode, when the data does not fit in the largest symbol of its error
     * correction level, or when the symbol would be wider than the print area,
     * which is what a printer does in all three cases.
     *
     * @param  {QrcodeRequest}   request   The QR code to draw
     */
  qrcode(request) {
    if (!request.data || request.data.length === 0) {
      return;
    }

    const symbol = encodeQrcode(request.data, request.errorLevel);
    const moduleSize = Math.max(1, request.moduleSize || 1);

    if (symbol === null || symbol.width * moduleSize > this.#width) {
      return;
    }

    this.block(Bitmap.scale(symbol, moduleSize, moduleSize));
  }

  /**
     * Draw a PDF417 symbol as a block. Nothing is printed when there is no data
     * to encode, when the data does not fit in the number of columns and rows
     * the commands ask for, or when the symbol would be wider than the print
     * area, the same three rules the QR code follows.
     *
     * A module is `moduleWidth` dots wide and a row is `rowHeight` modules
     * tall, so a row is `rowHeight * moduleWidth` dots, which is how both
     * printer languages describe the height of a row. The symbol carries no
     * quiet zone, as a printer draws none.
     *
     * @param  {Pdf417Request}   request   The symbol to draw
     */
  pdf417(request) {
    if (!request.data || request.data.length === 0) {
      return;
    }

    const moduleWidth = Math.max(1, request.moduleWidth || 1);
    const rowHeight = Math.max(1, request.rowHeight || 1);

    const symbol = encodePdf417(request.data, {
      columns: request.columns,
      rows: request.rows,
      errorLevel: request.errorLevel,
      errorRatio: request.errorRatio,
      truncated: request.truncated,
      rowHeight,
    });

    if (symbol === null) {
      return;
    }

    const width = symbol.modules[0].length * moduleWidth;

    if (width > this.#width) {
      return;
    }

    const height = rowHeight * moduleWidth;
    const bitmap = Bitmap.create(width, symbol.rows * height);

    for (let row = 0; row < symbol.rows; row++) {
      const modules = symbol.modules[row];

      for (let module = 0; module < modules.length; module++) {
        if (modules[module] === 0) {
          continue;
        }

        for (let x = module * moduleWidth; x < (module + 1) * moduleWidth; x++) {
          for (let y = row * height; y < (row + 1) * height; y++) {
            Bitmap.setPixel(bitmap, x, y, 1);
          }
        }
      }
    }

    this.block(bitmap);
  }

  /**
     * Handle a command.
     *
     * A command the driver supports flushes: the rows of the lines that are
     * finished become image items, so that the command lands between them in
     * the output, the way it stands in the byte stream. A line that is half
     * composed stays in the painter and continues afterwards, which is what a
     * printer does when it fires the drawer before the pending line prints.
     *
     * A command the driver does not support is dropped and changes nothing, per
     * the fallback table in the design: the blank lines the encoder fed before
     * a cut are already in the image and stay in the image it belongs to, and a
     * pulse or an unknown command leaves nothing behind at all.
     *
     * @param  {object}   item   The item to emit, cut, pulse or unknown
     */
  command(item) {
    if (!this.#commands.has(item.type)) {
      return;
    }

    this.#flush();
    this.#items.push(item);
  }

  /**
     * Finish the stream: commit whatever line is pending, flush the rows, and
     * return the items. The painter is empty and initialized afterwards, ready
     * for another stream, with the options it was built with.
     *
     * @return {object[]}   The items of this stream, in order
     */
  end() {
    if (this.#line.cells.length) {
      this.lineFeed();
    }

    this.#flush();

    const items = this.#items;

    this.discard();

    return items;
  }

  /**
     * Throw away everything this painter holds: the items that were not
     * returned yet, the rows that were not flushed, and the state. A renderer
     * uses it to make sure a stream that failed halfway leaves nothing behind
     * for the next one.
     */
  discard() {
    this.#items = [];
    this.#clear();
    this.reset();
  }

  /**
     * Drop every row that was committed but not flushed
     */
  #clear() {
    this.#buffer = new Uint8Array(Bitmap.rowBytes(this.#width) * INITIAL_ROWS);
    this.#capacity = INITIAL_ROWS;
    this.#rows = 0;
    this.#blankRuns = [];
  }

  /**
     * The cell of a code point, in a style and a font. Cells repeat a lot on a
     * receipt, so they are kept, and the painter only ever reads from them.
     *
     * @param  {number}   codepoint   Unicode code point
     * @param  {string}   [name]      Font of the cell, the current font when it is left out
     * @param  {Style}    [style]     Style of the cell, the current style when it is left out
     * @return {Bitmap}               The cell
     */
  #cell(codepoint, name, style) {
    name = name || this.#font;
    style = style || this.#style;

    const key = `${name}|${codepoint}|${style.bold ? 1 : 0}${style.underline}${style.upperline || 0}` +
      `${style.invert ? 1 : 0}|${style.width}x${style.height}`;

    if (this.#cache.has(key)) {
      return this.#cache.get(key);
    }

    const font = this.#fonts[name];
    const size = this.#cells[name];

    const cell = font.renderGlyph(font.lookup(codepoint), {
      cellWidth: size.width,
      cellHeight: size.height,
      widthMultiplier: style.width,
      heightMultiplier: style.height,
      bold: style.bold,
      underline: style.underline,
      upperline: style.upperline || 0,
      invert: style.invert,
      stretch: Font.isBoxDrawing(codepoint),
    });

    this.#cache.set(key, cell);

    return cell;
  }

  /**
     * A line of text as a bitmap of its own, in one font and without any style,
     * which is how a printer draws the human readable text of a barcode
     *
     * @param  {string}   text   The text to draw
     * @param  {string}   name   Font of the text, 'A' or 'B'
     * @return {Bitmap}          The text, one cell per character
     */
  #textBitmap(text, name) {
    const font = this.#cells[name] ? name : 'A';
    const size = this.#cells[font];

    const characters = Array.from(text);
    const bitmap = Bitmap.create(Math.max(0, characters.length * size.width), size.height);

    let x = 0;

    for (const character of characters) {
      Bitmap.blit(this.#cell(character.codePointAt(0), font, PLAIN), bitmap, x, 0);
      x += size.width;
    }

    return bitmap;
  }

  /**
     * An empty line, which is what a line is before anything is placed on it
     * and right after it is committed
     *
     * @return {object}   The line
     */
  #empty() {
    return {cells: [], x: 0, extent: 0, height: 0};
  }

  /**
     * Width of the print area in dots, the paper without the margins. A print
     * area that does not fit on the paper is clamped to it.
     *
     * @return {number}   Width in dots
     */
  #area() {
    const left = Math.min(this.#margins.left, this.#width);
    const width = this.#margins.width === null ? this.#width - left : this.#margins.width;

    return Math.max(0, Math.min(width, this.#width - left));
  }

  /**
     * The width of one character for the tab stops: the cell plus the character
     * spacing behind it, which is the unit the ESC/POS reference of ESC D uses
     *
     * @return {number}   Width in dots
     */
  #tabUnit() {
    return this.characterWidth + this.#spacing;
  }

  /**
     * The tab stops of a printer that was not given any: one every eight
     * characters of font A, over the width of the paper. A stop beyond the
     * print area is still a stop, tab() sends the cursor past the area for it.
     *
     * @return {number[]}   The stops in dots from the left margin
     */
  #defaultTabs() {
    const stops = [];
    const step = (this.#cells.A.width + this.#spacing) * TAB_INTERVAL;

    for (let stop = step; stop <= this.#width && stops.length < MAX_TAB_STOPS; stop += step) {
      stops.push(stop);
    }

    return stops;
  }

  /**
     * Put a cell on the current line, wrapping to the next line when it does
     * not fit on the rest of this one
     *
     * @param  {Bitmap}   cell        The cell to place
     * @param  {number}   [spacing]   Dots to leave behind the cell, the character spacing
     */
  #place(cell, spacing = 0) {
    if (this.#line.x > 0 && this.#line.x + cell.width > this.#area()) {
      this.lineFeed();
    }

    this.#line.cells.push({bitmap: cell, x: this.#line.x});
    this.#line.extent = Math.max(this.#line.extent, this.#line.x + cell.width);
    this.#line.x += cell.width + spacing;
    this.#line.height = Math.max(this.#line.height, cell.height);
  }

  /**
     * Where content of a given width starts, for the current alignment
     *
     * @param  {number}   used     Width of the content in dots
     * @param  {number}   [area]   Width of the print area, the current one when it is left out
     * @return {number}            Horizontal position of the left edge, from the left margin
     */
  #offset(used, area) {
    const free = Math.max(0, (typeof area === 'number' ? area : this.#area()) - used);

    if (this.#align === 'center') {
      return free >> 1;
    }

    if (this.#align === 'right') {
      return free;
    }

    return 0;
  }

  /**
     * Commit the current line: draw its cells into a line of the right height,
     * aligned inside the print area, and append the rows.
     *
     * @param  {number}   minimum   Smallest height of the line in dots
     */
  #commit(minimum) {
    const line = this.#line;
    const height = Math.max(minimum, line.height);
    const margins = this.#margins;
    const area = this.#area();

    this.#line = this.#empty();

    if (height === 0) {
      return;
    }

    if (line.cells.length === 0) {
      this.#appendBlank(height);
      return;
    }

    const bitmap = Bitmap.create(this.#width, height);
    const offset = margins.left + this.#offset(line.extent, area);

    for (const cell of line.cells) {
      Bitmap.blit(cell.bitmap, bitmap, offset + cell.x, 0);
    }

    this.#append(this.#upsideDown ? Bitmap.rotate180(bitmap) : bitmap);
  }

  /**
     * Make room for a number of rows in the buffer, doubling it when it is full
     *
     * @param  {number}   rows   Number of rows the buffer must hold
     */
  #reserve(rows) {
    if (rows <= this.#capacity) {
      return;
    }

    let capacity = this.#capacity;

    while (capacity < rows) {
      capacity *= 2;
    }

    const buffer = new Uint8Array(Bitmap.rowBytes(this.#width) * capacity);

    buffer.set(this.#buffer.subarray(0, Bitmap.rowBytes(this.#width) * this.#rows));

    this.#buffer = buffer;
    this.#capacity = capacity;
  }

  /**
     * Append the rows of a bitmap of the full print width, remembering which of
     * them are blank, so that flushing does not need a second pass
     *
     * @param  {Bitmap}   bitmap   The rows to append
     */
  #append(bitmap) {
    if (bitmap.height === 0) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#reserve(this.#rows + bitmap.height);
    this.#buffer.set(bitmap.data.subarray(0, rowBytes * bitmap.height), this.#rows * rowBytes);

    for (let y = 0; y < bitmap.height; y++) {
      const offset = (this.#rows + y) * rowBytes;

      let blank = true;

      for (let byte = 0; byte < rowBytes; byte++) {
        if (this.#buffer[offset + byte] !== 0) {
          blank = false;
          break;
        }
      }

      if (blank) {
        this.#markBlank(this.#rows + y);
      }
    }

    this.#rows += bitmap.height;
  }

  /**
     * Append rows that are white by construction, an empty line or the gap
     * below a line, without looking at them
     *
     * @param  {number}   count   Number of rows to append
     */
  #appendBlank(count) {
    if (count <= 0) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#reserve(this.#rows + count);
    this.#buffer.fill(0, this.#rows * rowBytes, (this.#rows + count) * rowBytes);

    for (let y = 0; y < count; y++) {
      this.#markBlank(this.#rows + y);
    }

    this.#rows += count;
  }

  /**
     * Record that a row is blank, extending the run it belongs to
     *
     * @param  {number}   row   The row that is blank
     */
  #markBlank(row) {
    const last = this.#blankRuns[this.#blankRuns.length - 1];

    if (last && last.end === row) {
      last.end = row + 1;
      return;
    }

    this.#blankRuns.push({start: row, end: row + 1});
  }

  /**
     * Emit the rows between two positions as image items, splitting them into
     * pieces of at most maxHeight. An image item is never empty.
     *
     * @param  {number}   start   First row
     * @param  {number}   end     Row after the last one
     */
  #emit(start, end) {
    const rowBytes = Bitmap.rowBytes(this.#width);
    const limit = this.#maxHeight || (end - start);

    for (let y = start; y < end; y += limit) {
      const height = Math.min(limit, end - y);

      this.#items.push({
        type: 'image',
        width: this.#width,
        height,
        data: this.#buffer.slice(y * rowBytes, (y + height) * rowBytes),
      });
    }
  }

  /**
     * Turn the rows that were committed into items and empty the buffer. Runs
     * of blank rows of at least feedThreshold dots become feed items and split
     * the image around them, but only when the driver supports feed, otherwise
     * they stay in the image as white rows.
     */
  #flush() {
    if (this.#rows === 0) {
      this.#blankRuns = [];
      return;
    }

    let position = 0;

    if (this.#commands.has('feed')) {
      for (const run of this.#blankRuns) {
        if (run.end - run.start < this.#feedThreshold) {
          continue;
        }

        this.#emit(position, run.start);
        this.#items.push({type: 'feed', height: run.end - run.start});

        position = run.end;
      }
    }

    this.#emit(position, this.#rows);

    this.#rows = 0;
    this.#blankRuns = [];
  }
}

export default Painter;
