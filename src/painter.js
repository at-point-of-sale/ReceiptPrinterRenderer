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
 * @property {number} [pageHeight]                    Height of the page of page mode in dots
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
 * @property {boolean} rotate      Turn every character cell a quarter turn clockwise
 * @property {boolean} upsideDown  Rotate every committed line by 180 degrees
 */

/**
 * Which set a user defined glyph belongs to, and how wide its cell is
 *
 * @typedef {object} GlyphRequest
 * @property {boolean} [multibyte]   The glyph of a multibyte character code, drawn in a cell of two
 *                                   characters, instead of a glyph of the current font
 */

/**
 * The left margin and the width of the print area, in dots
 *
 * @typedef {object} Margins
 * @property {number} [left]    Left margin in dots, from the left edge of the paper
 * @property {number} [width]   Width of the print area in dots, null for the whole paper
 */

/**
 * The print area of page mode, in dots on the page
 *
 * @typedef {object} PageArea
 * @property {number} x        Horizontal origin, from the left edge of the page
 * @property {number} y        Vertical origin, from the top of the page
 * @property {number} width    Width of the area in dots, 0 for the rest of the page
 * @property {number} height   Height of the area in dots, 0 for the rest of the page
 */

/**
 * How a page is printed
 *
 * @typedef {object} PrintPageRequest
 * @property {boolean} [keep]   Keep the dots and the position, so the page can be printed again
 */

/**
 * How a position of page mode is set
 *
 * @typedef {object} PageVerticalRequest
 * @property {boolean} [relative]   Count the distance from the current position instead of the area
 */

/* The built in fonts the two printer fonts are drawn from. Font A is the 12x24
   font, font B is the 8x16 font, centred in whatever cell the profile gives it,
   which is 9x17 on Epson and 9x24 on Star */

const GLYPH_FONTS = {A: '12x24', B: '8x16'};

/* How much a growing row buffer allocates the first time */

const INITIAL_ROWS = 256;

/* The style the human readable text of a barcode is drawn in, which is never
   the style of the text around it */

const PLAIN = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1, rotate: false};

/* The set the user defined glyphs of a multibyte character code belong to.
   The glyphs of the single byte codes belong to the set of the font they were
   defined in, 'A' or 'B', so this name is not one of those */

const MULTIBYTE_GLYPHS = 'multibyte';

/* How many characters wide the cell of a multibyte glyph is, which is the two
   cells the placeholder of a multibyte character takes as well */

const MULTIBYTE_CELLS = 2;

/* The default tab stops of a printer, every eight characters of font A, and
   the most stops ESC D can set */

const TAB_INTERVAL = 8;
const MAX_TAB_STOPS = 32;

/* How tall the page of page mode is when the profile does not say, in dots.
   1662 dots is the page mode maximum of an Epson TM-T88 at 576 dots wide */

const DEFAULT_PAGE_HEIGHT = 1662;

/* The rotation the four print directions of page mode give the layout of a
   print area, see pageDirection() */

const PAGE_ROTATIONS = [null, Bitmap.rotate90, Bitmap.rotate180, Bitmap.rotate270];

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
 *
 * It holds the paper of the lines that were committed and not flushed yet, and
 * a position on it, which is where the print head is: a line is committed at
 * the position and the position moves on by its height, so the two are the same
 * number until a reverse feed moves the position back over rows that are
 * already on the paper, which the lines behind it are then drawn over.
 *
 * In page mode it composes a page instead of the paper: the lines and the
 * blocks go into a print area of a page held in memory, in the coordinate
 * system of the print direction, and the page reaches the paper as one block
 * when the stream prints it. Everything above works the same way inside the
 * area, the surface the layout happens on is the only thing that changes.
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
  #glyphs;
  #glyphSerial;

  #pageHeight;
  #pageSetup;
  #page;
  #held;

  #buffer;
  #rows;
  #position;
  #capacity;
  #blankRuns;
  #overprinted;

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

    this.#pageHeight = this.#profile.pageHeight || DEFAULT_PAGE_HEIGHT;

    this.#cache = new Map();
    this.#items = [];

    /* The images the graphics commands define live as long as this painter
       does: they are the memory of the printer, which an initialize does not
       empty and which is still there for the next job */

    this.#definitions = new Map();

    /* The user defined glyphs are the other memory of the printer, and the
       other lifetime: they live in RAM, so an initialize throws them away, see
       reset(). The serial number changes with every definition, so that a cell
       of a glyph that was redefined is never taken from the cache */

    this.#glyphs = new Map();
    this.#glyphSerial = 0;

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
    /* An initialize leaves page mode and throws the page away, which is what
       ESC @ does to the page buffer of a printer */

    this.page(false);

    this.#style = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1, rotate: false};
    this.#font = 'A';
    this.#align = 'left';
    this.#lineSpacing = this.#defaultLineSpacing;
    this.#spacing = 0;
    this.#tabs = null;
    this.#margins = {left: 0, width: null};
    this.#upsideDown = false;
    this.#line = this.#empty();

    /* The glyphs a stream downloaded live in the RAM of the printer, which an
       initialize clears, unlike the images of the graphics commands, which are
       its NV memory and survive */

    this.#glyphs.clear();

    /* The print area and the print direction of page mode are settings of the
       printer, not of one page: a stream sets them in standard mode or in page
       mode, they survive the page they were used on, and only an initialize
       puts them back. No area at all is the whole printable area */

    this.#pageSetup = {area: null, direction: 0};
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
     * Keep the glyph a stream downloaded for a character code, or cancel it
     * again with a bitmap of null.
     *
     * A single byte glyph belongs to the font that is current when it is
     * defined, so font A and font B hold a set of their own, and a multibyte
     * glyph belongs to a set of its own. The dots are kept as they were
     * defined; the cell they are drawn in is decided when they are printed,
     * because the size, the style and the font of that moment decide it.
     *
     * @param  {number}         code       The character code the glyph belongs to
     * @param  {Bitmap|null}    bitmap     The dots of the glyph, or null to cancel the definition
     * @param  {GlyphRequest}   [options]  Which set the glyph belongs to
     */
  defineGlyph(code, bitmap, options) {
    const key = this.#glyphKey(code, options);

    if (!bitmap) {
      this.#glyphs.delete(key);
      return;
    }

    this.#glyphSerial++;
    this.#glyphs.set(key, {bitmap, serial: this.#glyphSerial});
  }

  /**
     * Whether a character code has a glyph a stream downloaded, in the set the
     * options name
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set to look in
     * @return {boolean}                    True when the set holds a glyph for it
     */
  hasGlyph(code, options) {
    return this.#glyphs.has(this.#glyphKey(code, options));
  }

  /**
     * Append the glyph a stream downloaded for a character code, in the current
     * style, the way text() appends a built in one. The dots are placed in the
     * top left corner of the cell and the rest of the cell stays blank, which
     * is what a glyph that is narrower or shorter than the cell prints like.
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set the glyph belongs to
     * @return {boolean}                    True when the set held a glyph and it was placed
     */
  glyph(code, options) {
    const definition = this.#glyphs.get(this.#glyphKey(code, options));

    if (!definition) {
      return false;
    }

    const cells = options && options.multibyte ? MULTIBYTE_CELLS : 1;

    /* The character spacing follows every cell the glyph takes, so a multibyte
       glyph of two cells leaves the space placeholder(2) would have left */

    this.#place(this.#glyphCell(definition, cells), this.#spacing * this.#style.width * cells);

    return true;
  }

  /**
     * Change one or more style properties. Properties that are not given keep
     * their value.
     *
     * Upside down is not a property of a cell but of the line it lands on: it
     * rotates every line that is committed from here on, so it is kept apart
     * from the style the cells are drawn in. The rotation of ESC V is the other
     * way round, a property of the cell: every cell is turned a quarter turn
     * clockwise and the cells still go left to right along the line.
     *
     * @param  {Partial<Style>}   changes   The properties to change
     */
  style(changes) {
    if (!changes) {
      return;
    }

    for (const property of ['bold', 'underline', 'upperline', 'invert', 'width', 'height', 'rotate']) {
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
    if (!changes || this.#page || this.#line.cells.length !== 0 || this.#line.x !== 0) {
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
     * Commit the current line and move the paper back by a number of dot rows,
     * which is what the reverse feed commands do. The line is printed first,
     * because a reverse feed is a print command, and the paper then moves back
     * over the rows that are already on it, so that everything after this
     * overprints them.
     *
     * The move is clamped to the rows the painter still holds: the rows of the
     * lines that were already flushed to an image item are gone, and row 0 of
     * the buffer is the paper the reverse feed cannot reach past. A printer
     * clamps in the same place for its own reason, the mechanism, which is why
     * the commands that do this have a maximum of a few lines.
     *
     * @param  {number}   dots   Number of dot rows to move back
     */
  reverseFeed(dots) {
    this.#commit(0);

    if (!Number.isInteger(dots) || dots <= 0) {
      return;
    }

    /* In page mode the paper does not move at all, the position inside the
       print area does, and the top of the area is the clamp there */

    if (this.#page) {
      this.#page.y = Math.max(0, this.#page.y - dots);
      return;
    }

    this.#position = Math.max(0, this.#position - dots);
  }

  /**
     * Commit the current line and move the paper back by a number of lines
     * instead of by dot rows, which is what ESC e does. The line is the current
     * line spacing, the same unit lineFeed() advances by.
     *
     * @param  {number}   [count]   Number of lines to move back
     */
  reverseLineFeed(count = 1) {
    this.reverseFeed(this.#lineSpacing * count);
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
     * Whether the painter is composing a page instead of the paper
     *
     * @return {boolean}   True in page mode
     */
  get pageMode() {
    return this.#page !== null;
  }

  /**
     * Enter page mode, or leave it and throw the page away.
     *
     * Page mode is entered at the beginning of a line only, which is what the
     * commands that select it say: a line that already holds characters, or
     * whose cursor was moved, makes the printer drop the command. Leaving page
     * mode deletes everything the page held, dots and pending line alike; the
     * page only ever reaches the paper through printPage().
     *
     * @param  {boolean}   enabled   True to enter page mode, false to leave it
     */
  page(enabled) {
    if (enabled) {
      if (this.#page || this.#line.cells.length !== 0 || this.#line.x !== 0) {
        return;
      }

      const area = this.#pageSetup.area;

      this.#page = {
        bitmap: null,
        canvas: null,
        area: area || {x: 0, y: 0, width: this.#width, height: this.#pageHeight},
        direction: this.#pageSetup.direction,
        bottom: area ? area.y + area.height : 0,
        y: 0,
      };

      return;
    }

    if (!this.#page) {
      return;
    }

    this.#page = null;
    this.#line = this.#empty();

    this.#release();
  }

  /**
     * Set the print area of the page, in dots on the page. The origin is the
     * top left corner of the area, whatever the print direction is, and a width
     * or a height of zero is the rest of the page in that direction.
     *
     * An origin outside the page is ignored, the way the printer ignores it.
     * The area of a page that was given none is the whole page.
     *
     * The layout starts over in the new area, at its start position: what was
     * drawn in the area before this goes into the page, so a stream can compose
     * one page out of several areas.
     *
     * @param  {PageArea}   area   The print area
     */
  pageArea(area) {
    if (!area) {
      return;
    }

    const x = Number.isInteger(area.x) ? area.x : 0;
    const y = Number.isInteger(area.y) ? area.y : 0;

    if (x < 0 || y < 0 || x >= this.#width || y >= this.#pageHeight) {
      return;
    }

    /* A width or a height of zero is not an area, and the command that carries
       one does nothing at all, the way the printer ignores it */

    if (!Number.isInteger(area.width) || !Number.isInteger(area.height) ||
        area.width <= 0 || area.height <= 0) {
      return;
    }

    const width = Math.min(area.width, this.#width - x);
    const height = Math.min(area.height, this.#pageHeight - y);

    this.#pageSetup.area = {x, y, width, height};

    if (!this.#page) {
      return;
    }

    this.#compose();

    this.#page.area = this.#pageSetup.area;

    /* The page feeds the paper over every area it was given, this one included,
       whatever the areas hold */

    this.#page.bottom = Math.max(this.#page.bottom, y + height);
  }

  /**
     * Set the print direction of page mode, which is the direction the text
     * runs in and the corner of the print area it starts in:
     *
     *   0   left to right, from the top left, drawn as it is laid out
     *   1   bottom to top, from the bottom left, a quarter turn counter-clockwise
     *   2   right to left, from the bottom right, half a turn
     *   3   top to bottom, from the top right, a quarter turn clockwise
     *
     * The layout of a direction happens in a coordinate system of its own, in
     * which the text runs to the right and the lines go down as they always do,
     * and the whole of it is turned when it goes into the page. The area is as
     * wide as it is tall in the two sideways directions, so a line of direction
     * 1 is as long as the area is high.
     *
     * Like a new area, a new direction starts the layout over, at the start
     * position of the direction.
     *
     * @param  {number}   direction   0, 1, 2 or 3
     */
  pageDirection(direction) {
    if (!Number.isInteger(direction) || direction < 0 || direction > 3) {
      return;
    }

    this.#pageSetup.direction = direction;

    if (!this.#page) {
      return;
    }

    this.#compose();

    this.#page.direction = direction;
  }

  /**
     * Move the position along the vertical axis of the print direction, which
     * is what GS $ and GS \ do in page mode: the distance is counted from the
     * start of the print area, or from the position itself when it is relative.
     * A position outside the area is ignored, the way the printer ignores it.
     *
     * The characters that are on the line are drawn where they were placed
     * before the position moves, so a stream that lays a page out with these
     * commands gets what it asked for.
     *
     * @param  {number}                 dots        The distance in dots
     * @param  {PageVerticalRequest}    [options]   `{relative: true}` to count from the position
     */
  pageVertical(dots, options) {
    if (!this.#page || !Number.isInteger(dots)) {
      return;
    }

    const position = options && options.relative === true ? this.#page.y + dots : dots;

    if (position < 0 || position > this.#logical().height) {
      return;
    }

    this.#settle();

    this.#page.y = position;
  }

  /**
     * Throw the dots of the page away and keep the print area, which is what
     * CAN does in page mode
     */
  cancelPage() {
    if (!this.#page) {
      return;
    }

    this.#page.bitmap = null;
    this.#page.canvas = null;
    this.#page.y = 0;

    this.#line = this.#empty();
  }

  /**
     * Draw the page on the paper as one block and move the paper on by its
     * height, which is what FF and ESC FF do.
     *
     * The page is as tall as the print areas the stream set on it, so that the
     * paper advances over the whole area the way a printer feeds it, and as
     * tall as its dots when the stream set no area at all: a page that was
     * given neither an area nor a dot is not printed, which is what makes
     * entering and leaving page mode without anything in between cost nothing.
     *
     * `{keep: true}` keeps the dots, the area, the direction and the position,
     * so that the same page can be printed again.
     *
     * @param  {PrintPageRequest}   [options]   How the page is printed
     */
  printPage(options) {
    if (!this.#page) {
      return;
    }

    const keep = options ? options.keep === true : false;
    const position = this.#page.y;
    const cursor = this.#line.x;

    this.#compose();

    const page = this.#page;
    const height = Math.max(page.bottom, this.#inked(page.bitmap));

    if (height > 0) {
      /* The page is as tall as the areas it was given, dots or no dots, so it
         is drawn into a bitmap of that height rather than cut down to the rows
         that carry something: an area that stayed empty still feeds the paper,
         the way a printer feeds it */

      const bitmap = Bitmap.create(this.#width, height);

      if (page.bitmap) {
        Bitmap.blit(page.bitmap, bitmap, 0, 0);
      }

      /* The page carries its own positions, so it goes on the paper itself and
         not inside the margins of the line mode. Upside down printing is a
         standard mode setting and does not turn a page either */

      const upsideDown = this.#upsideDown;

      this.#page = null;
      this.#upsideDown = false;

      this.block(bitmap, {margins: false});

      this.#upsideDown = upsideDown;
      this.#page = page;
    }

    if (keep) {
      page.y = position;
      this.#line.x = cursor;
    } else {
      page.bitmap = null;
      page.canvas = null;
      page.y = 0;
    }

    this.#release();
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

    const line = Bitmap.create(this.#surface(), bitmap.height);
    const offset = paper ?
      this.#offset(bitmap.width, this.#surface()) :
      this.#left() + this.#offset(bitmap.width);

    Bitmap.blit(bitmap, line, offset, 0);

    this.#append(this.#turn(line));
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

    /* The height of the command, unless the specification of the symbology
       fixes the height of its symbol or gives it a least height, which the GS1
       DataBar family does. Those heights are in modules, so they grow with the
       width of a module, the way a printer draws them */

    let height = Math.max(1, request.height || 1);

    if (code.height && code.height.fixed) {
      height = code.height.fixed * moduleWidth;
    }

    if (code.height && code.height.minimum) {
      height = Math.max(height, code.height.minimum * moduleWidth);
    }

    if (code.bars.reduce((total, width) => total + width, 0) * moduleWidth > this.#surface()) {
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

    if (symbol === null || symbol.width * moduleSize > this.#surface()) {
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

    if (width > this.#surface()) {
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

    /* A cut or a drawer pulse that arrives while a page is being composed
       waits for that page: the page is not on the paper yet, so an item in
       front of it would tell the driver to cut paper that is still to be
       printed. Everything else, the unknown items, is a diagnostic and is
       reported where it stands */

    if (this.#page && (item.type === 'cut' || item.type === 'pulse')) {
      this.#held.push(item);
      return;
    }

    this.#flush();
    this.#items.push(item);
  }

  /**
     * Finish the stream: throw away the line that is still being composed,
     * flush the rows and return the items. The painter is empty and initialized
     * afterwards, ready for another stream, with the options it was built with.
     *
     * The unfinished line is discarded and not committed, because that is what
     * the printer does with it: the cells sit in the line buffer and nothing
     * prints them until a line feed, a print command or the next job arrives.
     * A receipt that ends its last line prints in full, the line feed of that
     * line committed it; text without its line feed stays in the buffer, the
     * way it does on paper.
     *
     * @return {object[]}   The items of this stream, in order
     */
  end() {
    /* A page the stream never printed does not reach the paper, the way the
       line that is being composed does not */

    this.page(false);
    this.cancel();

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
    this.#position = 0;
    this.#blankRuns = [];
    this.#overprinted = false;
    this.#page = null;
    this.#held = [];
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

    const key = `${name}|${codepoint}|${this.#styleKey(style)}`;

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
      rotate: this.#rotated(style),
      stretch: Font.isBoxDrawing(codepoint),
    });

    this.#cache.set(key, cell);

    return cell;
  }

  /**
     * The cell of a glyph a stream downloaded, in the current style and the
     * current font. The dots go in the top left corner of a cell of the font,
     * which is then drawn by the font itself, so that a downloaded glyph is
     * scaled, overstruck, underlined and inverted exactly as a built in one is.
     *
     * @param  {object}   definition   The glyph and the serial number of its definition
     * @param  {number}   cells        Width of the cell in characters of the current font
     * @return {Bitmap}                The cell
     */
  #glyphCell(definition, cells) {
    const style = this.#style;
    const key = `U|${this.#font}|${definition.serial}|${cells}|${this.#styleKey(style)}`;

    if (this.#cache.has(key)) {
      return this.#cache.get(key);
    }

    const font = this.#fonts[this.#font];
    const size = this.#cells[this.#font];

    /* A glyph that is narrower or shorter than the cell is placed at its top
       left corner, and one that is larger is clipped by it: the cell of the
       font is what a character takes on the line, whatever the stream defined */

    const glyph = Bitmap.create(size.width * cells, size.height);

    Bitmap.blit(definition.bitmap, glyph, 0, 0);

    const cell = font.renderGlyph(glyph, {
      cellWidth: glyph.width,
      cellHeight: glyph.height,
      widthMultiplier: style.width,
      heightMultiplier: style.height,
      bold: style.bold,
      underline: style.underline,
      upperline: style.upperline || 0,
      invert: style.invert,
      rotate: this.#rotated(style),
    });

    this.#cache.set(key, cell);

    return cell;
  }

  /**
     * The key a style is cached under, which is every property that changes a
     * dot of a cell
     *
     * @param  {Style}    style   The style
     * @return {string}           The key
     */
  #styleKey(style) {
    return `${style.bold ? 1 : 0}${style.underline}${style.upperline || 0}${style.invert ? 1 : 0}` +
      `${this.#rotated(style) ? 1 : 0}|${style.width}x${style.height}`;
  }

  /**
     * Whether the cells of a style are turned a quarter turn clockwise, which
     * is the rotation of ESC V. It is a standard mode command, so a page of
     * page mode is laid out upright whatever the setting is.
     *
     * @param  {Style}     style   The style
     * @return {boolean}           True when the cell is turned
     */
  #rotated(style) {
    return style.rotate === true && !this.#page;
  }

  /**
     * The key a user defined glyph is kept under: the set it belongs to and its
     * character code
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set the glyph belongs to
     * @return {string}                     The key
     */
  #glyphKey(code, options) {
    return `${options && options.multibyte ? MULTIBYTE_GLYPHS : this.#font}|${code}`;
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
    if (this.#page) {
      return this.#logical().width;
    }

    const left = this.#left();
    const width = this.#margins.width === null ? this.#width - left : this.#margins.width;

    return Math.max(0, Math.min(width, this.#width - left));
  }

  /**
     * The left margin of the line, which is the left edge of the paper in page
     * mode: the print area of the page is the margin there
     *
     * @return {number}   Left margin in dots
     */
  #left() {
    return this.#page ? 0 : Math.min(this.#margins.left, this.#width);
  }

  /**
     * Width of the surface the layout happens on: the paper in standard mode
     * and the print area of the page, in the coordinate system of the print
     * direction, in page mode
     *
     * @return {number}   Width in dots
     */
  #surface() {
    return this.#page ? this.#logical().width : this.#width;
  }

  /**
     * A line box the way it goes on the surface: turned by 180 degrees while
     * upside down printing is on, and never in page mode, where the reference
     * has ESC { as a standard mode command and the print direction is what
     * turns the layout
     *
     * @param  {Bitmap}   bitmap   The line box
     * @return {Bitmap}            The line box as it is drawn
     */
  #turn(bitmap) {
    return this.#upsideDown && !this.#page ? Bitmap.rotate180(bitmap) : bitmap;
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

    for (let stop = step; stop <= this.#surface() && stops.length < MAX_TAB_STOPS; stop += step) {
      stops.push(stop);
    }

    return stops;
  }

  /**
     * The size of the print area in the coordinate system of the print
     * direction: the two sideways directions lay their text out along the
     * height of the area and their lines along its width
     *
     * @return {{width: number, height: number}}   The size in dots
     */
  #logical() {
    const {area, direction} = this.#page;

    return direction === 1 || direction === 3 ?
      {width: area.height, height: area.width} :
      {width: area.width, height: area.height};
  }

  /**
     * The surface the current print area and direction are laid out on, made
     * the first time something is drawn on it
     *
     * @return {Bitmap}   The canvas
     */
  #canvas() {
    if (!this.#page.canvas) {
      const size = this.#logical();

      this.#page.canvas = Bitmap.create(size.width, size.height);
    }

    return this.#page.canvas;
  }

  /**
     * Draw the characters that are on the line where they were placed, without
     * moving the position, which is what a position command inside a page has
     * to do: a printer puts a character in the page as it reads it, this
     * painter keeps it on a line until something commits it.
     */
  #settle() {
    if (this.#line.cells.length === 0) {
      return;
    }

    const {x} = this.#line;
    const y = this.#page.y;

    this.#commit(0);

    this.#page.y = y;
    this.#line.x = x;
  }

  /**
     * Put what was laid out in the current print area into the page, turned by
     * the print direction, and start the area over. The page grows to hold it.
     */
  #compose() {
    const page = this.#page;

    this.#settle();

    this.#line = this.#empty();

    page.y = 0;

    if (!page.canvas) {
      return;
    }

    const rotate = PAGE_ROTATIONS[page.direction];
    const dots = rotate ? rotate(page.canvas) : page.canvas;

    page.canvas = null;

    const height = Math.max(page.area.y + dots.height, page.bitmap ? page.bitmap.height : 0);

    if (!page.bitmap || page.bitmap.height < height) {
      const grown = Bitmap.create(this.#width, height);

      if (page.bitmap) {
        Bitmap.blit(page.bitmap, grown, 0, 0);
      }

      page.bitmap = grown;
    }

    Bitmap.blit(dots, page.bitmap, page.area.x, page.area.y);
  }

  /**
     * The row below the last row of a bitmap that carries a dot, which is how
     * tall a page without a print area of its own is
     *
     * @param  {Bitmap|null}   bitmap   The page, or nothing at all
     * @return {number}                 Number of rows
     */
  #inked(bitmap) {
    if (!bitmap) {
      return 0;
    }

    const rowBytes = Bitmap.rowBytes(bitmap.width);

    for (let row = bitmap.height - 1; row >= 0; row--) {
      for (let byte = 0; byte < rowBytes; byte++) {
        if (bitmap.data[row * rowBytes + byte] !== 0) {
          return row + 1;
        }
      }
    }

    return 0;
  }

  /**
     * Emit the cut and pulse items that waited for the page, behind the rows
     * that are on the paper by now
     */
  #release() {
    if (this.#held.length === 0) {
      return;
    }

    const held = this.#held;

    this.#held = [];

    this.#flush();

    for (const item of held) {
      this.#items.push(item);
    }
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
    const left = this.#left();
    const area = this.#area();

    this.#line = this.#empty();

    if (height === 0) {
      return;
    }

    if (line.cells.length === 0) {
      this.#appendBlank(height);
      return;
    }

    const bitmap = Bitmap.create(this.#surface(), height);
    const offset = left + this.#offset(line.extent, area);

    for (const cell of line.cells) {
      Bitmap.blit(cell.bitmap, bitmap, offset + cell.x, 0);
    }

    this.#append(this.#turn(bitmap));
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
     * Append the rows of a bitmap of the full print width at the paper
     * position, remembering which of them are blank, so that flushing does not
     * need a second pass.
     *
     * A row beyond the rows the buffer holds is written and extends the paper.
     * A row inside them is a row a reverse feed moved the paper back over, so
     * it is drawn over with OR, the way a second pass of the print head adds
     * dots to the ones that are already there, and the blank runs are rescanned
     * at the flush because a row that was blank may not be blank any more.
     *
     * @param  {Bitmap}   bitmap   The rows to append
     */
  #append(bitmap) {
    if (bitmap.height === 0) {
      return;
    }

    /* In page mode the rows do not reach the paper at all, they go into the
       print area of the page at the position inside it. The blit combines them
       with OR, so a line that is printed over another one adds its dots the way
       the paper does, and a row past the bottom of the area is clipped, which
       is the printer discarding what does not fit in the area */

    if (this.#page) {
      Bitmap.blit(bitmap, this.#canvas(), 0, this.#page.y);
      this.#page.y += bitmap.height;
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#reserve(this.#position + bitmap.height);

    for (let y = 0; y < bitmap.height; y++) {
      const row = this.#position + y;
      const offset = row * rowBytes;
      const source = bitmap.data.subarray(y * rowBytes, (y + 1) * rowBytes);

      if (row < this.#rows) {
        for (let byte = 0; byte < rowBytes; byte++) {
          this.#buffer[offset + byte] |= source[byte];
        }

        this.#overprinted = true;
        continue;
      }

      this.#buffer.set(source, offset);

      let blank = true;

      for (let byte = 0; byte < rowBytes; byte++) {
        if (this.#buffer[offset + byte] !== 0) {
          blank = false;
          break;
        }
      }

      if (blank) {
        this.#markBlank(row);
      }
    }

    this.#advance(bitmap.height);
  }

  /**
     * Append rows that are white by construction, an empty line or the gap
     * below a line, without looking at them. White over a row the paper moved
     * back over changes nothing, so those rows are stepped over rather than
     * cleared.
     *
     * @param  {number}   count   Number of rows to append
     */
  #appendBlank(count) {
    if (count <= 0) {
      return;
    }

    if (this.#page) {
      this.#page.y += count;
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#reserve(this.#position + count);

    for (let y = 0; y < count; y++) {
      const row = this.#position + y;

      if (row < this.#rows) {
        continue;
      }

      this.#buffer.fill(0, row * rowBytes, (row + 1) * rowBytes);
      this.#markBlank(row);
    }

    this.#advance(count);
  }

  /**
     * Move the paper on by a number of rows, extending it when the position
     * passes the rows the buffer holds
     *
     * @param  {number}   count   Number of rows the paper moved
     */
  #advance(count) {
    this.#position += count;
    this.#rows = Math.max(this.#rows, this.#position);
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
     * Work out the blank runs of the whole buffer again. A reverse feed draws
     * ink over rows that were recorded as blank when they were appended, and
     * the runs of those rows are the only thing the painter cannot fix up while
     * it draws, so they are counted once, at the flush that reads them.
     */
  #rescan() {
    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#blankRuns = [];

    for (let row = 0; row < this.#rows; row++) {
      const offset = row * rowBytes;

      let blank = true;

      for (let byte = 0; byte < rowBytes; byte++) {
        if (this.#buffer[offset + byte] !== 0) {
          blank = false;
          break;
        }
      }

      if (blank) {
        this.#markBlank(row);
      }
    }
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
      this.#position = 0;
      this.#overprinted = false;
      return;
    }

    if (this.#overprinted) {
      this.#rescan();
    }

    let emitted = 0;

    if (this.#commands.has('feed')) {
      for (const run of this.#blankRuns) {
        if (run.end - run.start < this.#feedThreshold) {
          continue;
        }

        this.#emit(emitted, run.start);
        this.#items.push({type: 'feed', height: run.end - run.start});

        emitted = run.end;
      }
    }

    this.#emit(emitted, this.#rows);

    this.#rows = 0;
    this.#position = 0;
    this.#blankRuns = [];
    this.#overprinted = false;
  }
}

export default Painter;
